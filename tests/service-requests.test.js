import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');

test('customers can describe any work they need', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  async function role(name, user, action) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`set role ${name}`);
    try { return await action(); }
    finally { await db.exec('reset role'); }
  }
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ['setup.sql', 'booking-updates.sql', 'job-cards.sql']) await db.exec(await sql(file));
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  const request = (service, reg = 'AB12CDE', date = '2099-01-01') => db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['James', 'Taylor', '07700 900123', reg, 'Ford', 'Focus', 2018, '1598', date, 'Pending Confirmation', service]);
  await role('anon', null, () => request('MOT'));
  const migration = await sql('service-requests.sql');
  await db.exec(migration);
  await db.exec(migration);

  await t.test('free-text requests are saved trimmed, and preset services still work', async () => {
    await role('anon', null, () => request('  Knocking noise from the front  ', 'AB12CDE', '2099-01-02'));
    await role('anon', null, () => request('Service', 'AB12CDE', '2099-01-03'));
    const rows = (await db.query('select service_type from public.jobs order by booking_date')).rows.map((row) => row.service_type);
    assert.deepEqual(rows, ['MOT', 'Knocking noise from the front', 'Service']);
  });
  await t.test('empty and overlong requests are rejected', async () => {
    for (const service of ['', '   ', null, 'x'.repeat(201)]) {
      await role('anon', null, () => assert.rejects(request(service, 'AB12CDE', '2099-01-09'), /200 characters or fewer/));
    }
    assert.equal((await db.query("select count(*)::int as count from public.jobs where booking_date='2099-01-09'")).rows[0].count, 0);
  });
  await t.test('owner can amend to any description within the limit', async () => {
    const id = (await db.query("select id from public.jobs where booking_date='2099-01-01'")).rows[0].id;
    const details = { first_name: 'James', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', year: 2018, engine_capacity: '1598', booking_date: '2099-01-01', status: 'Booked', payment_status: 'Unpaid', amount_due: 0, diagnosis_notes: '', parts_ordered: '', service_type: 'Clutch slipping' };
    await role('authenticated', owner, () => db.query('select public.amend_booking($1,$2)', [id, details]));
    assert.equal((await db.query('select service_type from public.jobs where id=$1', [id])).rows[0].service_type, 'Clutch slipping');
    await role('authenticated', owner, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [id, { ...details, service_type: 'x'.repeat(201) }]), /check the customer/));
    await role('authenticated', owner, () => db.query('select public.amend_booking($1,$2)', [id, { ...details, service_type: '' }]));
    assert.equal((await db.query('select service_type from public.jobs where id=$1', [id])).rows[0].service_type, '');
  });
});
