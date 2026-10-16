import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const outsider = '22222222-2222-4222-8222-222222222222';

test('booking migrations enforce transactional edits and owner-only deletion', async (t) => {
  const db = new PGlite();
  const setup = await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/booking-updates.sql', import.meta.url), 'utf8');
  async function role(name, user, action) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`set role ${name}`);
    try { return await action(); }
    finally { await db.exec('reset role'); }
  }
  const request = (service = 'MOT', date = '2099-01-01') => db.query(
    'select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['James', 'Taylor', '07700 900123', 'AB12 CDE', 'Ford', 'Focus', 2018, '1598', date, 'Pending Confirmation', service],
  );
  const details = { first_name: 'Jane', last_name: 'Smith', phone: '07700 900124', reg_no: 'XY12ABC', make: 'Honda', model: 'Civic', year: 2019, engine_capacity: '1800', booking_date: '2099-01-02', service_type: 'MOT and Service', status: 'Rescheduled', payment_status: 'Pay Later', amount_due: 123.45, diagnosis_notes: 'Test notes', parts_ordered: 'Brake pads' };
  let id;
  t.after(() => db.close());
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await db.exec(setup);
    await db.query('insert into auth.users values ($1),($2)', [owner, outsider]);
    await db.query('insert into public.app_admins values ($1)', [owner]);

    await t.test('setup grants owner-only deletion before later migrations run', async () => {
      await role('anon', null, () => db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['Setup', 'Only', '07700 900555', 'ZZ11ZZZ', 'Ford', 'Fiesta', 2017, '999', '2099-02-01', 'Pending Confirmation']));
      const setupOnlyId = (await db.query("select id from public.jobs where booking_date='2099-02-01'")).rows[0].id;
      await role('authenticated', outsider, async () => {
        assert.equal((await db.query('delete from public.jobs where id=$1 returning id', [setupOnlyId])).rows.length, 0);
        await assert.rejects(db.query('select public.delete_booking($1)', [setupOnlyId]), /Only the workshop owner/);
      });
      await role('authenticated', owner, async () => {
        await db.query('select public.delete_booking($1)', [setupOnlyId]);
      });
      assert.equal((await db.query('select count(*)::int as count from public.jobs where id=$1', [setupOnlyId])).rows[0].count, 0);
      await role('authenticated', owner, () => assert.rejects(db.query('select public.delete_booking($1)', [setupOnlyId]), /no longer exists/));
    });

    await db.exec(migration);

    await t.test('migration can be reapplied without data loss', async () => {
      await db.exec(migration);
      await role('anon', null, () => request());
      const { rows } = await db.query('select * from public.jobs');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].service_type, 'MOT');
      assert.equal(rows[0].status, 'Pending Confirmation');
      id = rows[0].id;
      await db.exec(migration);
      assert.equal((await db.query('select count(*)::int as count from public.jobs')).rows[0].count, 1);
    });
    await t.test('anonymous intake rejects invalid services and duplicate bookings', async () => {
      await role('anon', null, async () => {
        await assert.rejects(request('Unsupported'), /supported service/);
        await assert.rejects(request(), /already a request or booking/);
        await assert.rejects(db.query('select * from public.jobs'), /permission denied/);
        await assert.rejects(db.query('select * from public.customers'), /permission denied/);
        await assert.rejects(db.query('select public.amend_booking($1,$2)', [id, details]), /permission denied/);
        await assert.rejects(db.query('delete from public.jobs where id=$1', [id]), /permission denied/);
        await assert.rejects(db.query('select public.delete_booking($1)', [id]), /permission denied/);
      });
    });
    await t.test('authenticated non-owner cannot amend, read or delete bookings', async () => {
      await role('authenticated', outsider, async () => {
        await assert.rejects(db.query('select public.amend_booking($1,$2)', [id, details]), /Only the workshop owner/);
        assert.equal((await db.query('select * from public.jobs')).rows.length, 0);
        assert.equal((await db.query('delete from public.jobs where id=$1 returning id', [id])).rows.length, 0);
        await assert.rejects(db.query('select public.delete_booking($1)', [id]), /Only the workshop owner/);
      });
    });
    await t.test('owner can correct all details and persist them atomically', async () => {
      await role('authenticated', owner, () => db.query('select public.amend_booking($1,$2)', [id, details]));
      const row = (await db.query(`select j.*, j.booking_date::text as booking_date, v.reg_no, v.make, v.model, v.year, v.engine_capacity, c.first_name, c.last_name, c.phone
        from public.jobs j join public.vehicles v on v.id=j.vehicle_id join public.customers c on c.id=v.customer_id where j.id=$1`, [id])).rows[0];
      for (const [key, value] of Object.entries(details)) assert.equal(key === 'amount_due' ? Number(row[key]) : row[key], value, key);
    });
    await t.test('invalid edit rolls back all customer, vehicle and job changes', async () => {
      for (const patch of [{ service_type: 'Invalid' }, { amount_due: -1 }, { amount_due: 1.234 }, { year: 1700 }, { phone: 'bad' }, { first_name: '' }, { booking_date: '2026-02-30' }, { status: 'Invalid' }, { parts_ordered: 'x'.repeat(10001) }]) {
        await role('authenticated', owner, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [id, { ...details, first_name: 'Should not save', ...patch }])));
      }
      assert.equal((await db.query("select first_name from public.customers where phone='07700 900124'")).rows[0].first_name, 'Jane');
    });
    await t.test('rescheduling cannot collide with another active booking', async () => {
      await role('anon', null, () => db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        ['Jane', 'Smith', '07700 900124', 'XY12ABC', 'Honda', 'Civic', 2019, '1800', '2099-01-03', 'Pending Confirmation', 'Service']));
      await role('authenticated', owner, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [id, { ...details, booking_date: '2099-01-03' }]), /already has a booking/));
      assert.equal((await db.query('select booking_date::text as booking_date from public.jobs where id=$1', [id])).rows[0].booking_date, '2099-01-02');
    });
    await t.test('completed historic records remain editable', async () => {
      await role('authenticated', owner, () => db.query('select public.amend_booking($1,$2)', [id, { ...details, status: 'Completed', booking_date: '2020-01-01' }]));
      assert.equal((await db.query('select booking_date::text as booking_date from public.jobs where id=$1', [id])).rows[0].booking_date, '2020-01-01');
    });
    await t.test('legacy ten-argument intake remains compatible', async () => {
      await role('anon', null, () => db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['Alex', 'Brown', '07700 900125', 'CD34EFG', 'Toyota', 'Yaris', null, null, '2099-01-05', 'Pending Confirmation']));
      assert.equal((await db.query("select service_type from public.jobs where booking_date='2099-01-05'")).rows[0].service_type, '');
    });
    await t.test('registration conflicts do not corrupt existing vehicles or contacts', async () => {
      await role('authenticated', owner, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [id, { ...details, reg_no: 'CD34EFG', first_name: 'Not saved' }]), /belongs to another vehicle/));
      assert.equal((await db.query("select first_name from public.customers where phone='07700 900124'")).rows[0].first_name, 'Jane');
    });
    await t.test('deletion removes only the selected booking and survives subsequent reads', async () => {
      await role('authenticated', owner, async () => {
        await db.query('select public.delete_booking($1)', [id]);
        assert.equal((await db.query('select * from public.jobs where id=$1', [id])).rows.length, 0);
        await assert.rejects(db.query('select public.amend_booking($1,$2)', [id, details]), /no longer exists/);
      });
      assert.equal((await db.query('select count(*)::int as count from public.jobs')).rows[0].count, 2);
      assert.equal((await db.query('select count(*)::int as count from public.vehicles')).rows[0].count, 3);
      assert.equal((await db.query('select count(*)::int as count from public.customers')).rows[0].count, 3);
    });
});
