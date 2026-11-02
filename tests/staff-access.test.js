import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { staffAccount } from '../server/staff.js';
import { jobProgress } from '../src/jobCard.js';
import { CUSTOM_ROLE, PERMISSIONS, ROLES, roleFor } from '../src/permissions.js';

const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const mechanic = '22222222-2222-4222-8222-222222222222';
const desk = '33333333-3333-4333-8333-333333333333';
const stranger = '44444444-4444-4444-8444-444444444444';

test('role presets are recognised and changed ticks become custom', () => {
  for (const [name, keys] of Object.entries(ROLES)) assert.equal(roleFor([...keys].reverse()), name);
  assert.equal(roleFor(['checks']), CUSTOM_ROLE);
  assert.equal(ROLES.Owner.length, PERMISSIONS.length);
  assert.equal(ROLES.Mechanic.includes('payments'), false);
});

test('job progress leaves out price stages for people who cannot see prices', () => {
  const progress = jobProgress({ job_card: { checks: { 1: 'ok' } } }, false);
  assert.equal(progress.next, 'Record the work carried out');
  assert.deepEqual(progress.stages.map(([key]) => key), ['checked', 'worked', 'qc']);
});

test('staff account requests need an admin and keep secrets on the server', async (t) => {
  const env = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const body = { action: 'create', email: 'mech@example.com', password: 'temporary-pass' };
  const fake = (admin, status = 200) => { const calls = []; const fetcher = async (url, init) => { calls.push({ url, init }); return String(url).includes('has_permission') ? new Response(String(admin)) : new Response('{}', { status }); }; fetcher.calls = calls; return fetcher; };
  await t.test('rejects bad requests before contacting anything', async () => {
    const fetcher = fake(true);
    assert.equal((await staffAccount('GET', 'Bearer a', body, env, fetcher)).status, 405);
    assert.equal((await staffAccount('POST', '', body, env, fetcher)).status, 401);
    assert.equal((await staffAccount('POST', 'Bearer a', { ...body, password: 'short' }, env, fetcher)).status, 400);
    assert.equal((await staffAccount('POST', 'Bearer a', body, {}, fetcher)).status, 503);
    assert.equal(fetcher.calls.length, 0);
  });
  await t.test('non-admins never reach the service key', async () => {
    const fetcher = fake(false);
    assert.equal((await staffAccount('POST', 'Bearer a', body, env, fetcher)).status, 403);
    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0].init.headers.Authorization, 'Bearer a');
  });
  await t.test('admins can create logins and reset passwords', async () => {
    const fetcher = fake(true);
    assert.equal((await staffAccount('POST', 'Bearer a', body, env, fetcher)).status, 200);
    assert.equal(fetcher.calls[1].url, 'https://x.supabase.co/auth/v1/admin/users');
    assert.equal(JSON.parse(fetcher.calls[1].init.body).email_confirm, true);
    assert.equal((await staffAccount('POST', 'Bearer a', { action: 'reset', user_id: owner, password: 'temporary-pass' }, env, fetcher)).status, 200);
    assert.equal(fetcher.calls[3].init.method, 'PUT');
    assert.equal((await staffAccount('POST', 'Bearer a', body, env, fake(true, 422))).status, 409);
  });
});

test('staff migration enforces permissions in the database', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  async function as(user, action, name = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`set role ${name}`);
    try { return await action(); }
    finally { await db.exec('reset role'); }
  }
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ['setup.sql', 'booking-updates.sql', 'job-cards.sql', 'service-requests.sql', 'booking-slots.sql', 'job-photos.sql']) await db.exec(await sql(file));
  await db.query("insert into auth.users values ($1,'andy@example.com'),($2,'mech@example.com'),($3,'desk@example.com'),($4,'nobody@example.com')", [owner, mechanic, desk, stranger]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  const migration = await sql('staff-access.sql');
  await db.exec(migration);
  await db.exec(migration);

  const booking = { first_name: 'James', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', year: 2018, booking_date: '2099-01-07', booking_time: '10:30', service_type: 'MOT', customer_address: '1 High Street', customer_postcode: 'NP19 8JJ' };
  await as(null, () => db.query('select public.create_booking($1)', [booking]), 'anon');
  const id = (await db.query('select id from public.jobs')).rows[0].id;
  const add = (email, role, permissions) => db.query('select public.add_staff_member($1,$2,$3,$4)', [email, role, role, permissions]);
  const jobs = async () => (await db.query('select public.list_workshop_jobs() as jobs')).rows[0].jobs;
  const details = { ...booking, status: 'Booked', payment_status: 'Paid', amount_due: 120.5, diagnosis_notes: '', parts_ordered: '' };

  await t.test('the existing owner is carried over with full access', async () => {
    const profile = await as(owner, () => db.query('select public.my_staff_profile() as me'));
    assert.equal(profile.rows[0].me.role, 'Owner');
    assert.deepEqual(profile.rows[0].me.permissions, ROLES.Owner);
  });
  await t.test('only admins can manage the team', async () => {
    await as(stranger, () => assert.rejects(add('mech@example.com', 'Mechanic', ROLES.Mechanic), /permission to manage users/));
    await as(owner, () => add('mech@example.com', 'Mechanic', ROLES.Mechanic));
    await as(owner, () => add('desk@example.com', 'Front desk', ROLES['Front desk']));
    await as(mechanic, () => assert.rejects(db.query('select public.list_staff()'), /permission to manage users/));
    await as(mechanic, () => assert.rejects(add('nobody@example.com', 'Owner', ROLES.Owner), /permission to manage users/));
    await as(owner, () => assert.rejects(add('missing@example.com', 'Mechanic', ROLES.Mechanic), /No account exists/));
    await as(owner, () => assert.rejects(add('mech@example.com', 'Mechanic', ROLES.Mechanic), /already on the team/));
    await as(owner, () => assert.rejects(add('nobody@example.com', 'Bad', ['fly_rockets']), /check constraint/));
  });
  await t.test('nobody signed in can read or change tables directly', async () => {
    await as(owner, async () => {
      for (const table of ['jobs', 'customers', 'vehicles', 'staff', 'app_admins']) await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      await assert.rejects(db.query('update public.jobs set amount_due = 1'), /permission denied/);
      await assert.rejects(db.query('delete from public.jobs'), /permission denied/);
    });
    await as(null, () => assert.rejects(db.query('select public.list_workshop_jobs()'), /permission denied/), 'anon');
    await as(null, () => assert.rejects(db.query('select public.has_permission($1)', ['admin']), /permission denied/), 'anon');
  });
  await t.test('booking and approval rights are separate', async () => {
    await as(mechanic, () => assert.rejects(db.query('select public.approve_booking($1)', [id]), /permission to approve/));
    await as(mechanic, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [id, details]), /permission to change/));
    await as(mechanic, () => assert.rejects(db.query('select public.set_job_status($1,$2)', [id, 'In Progress']), /not confirmed yet/));
    await as(desk, () => db.query('select public.approve_booking($1)', [id]));
    await as(desk, () => assert.rejects(db.query('select public.approve_booking($1)', [id]), /already been handled/));
    await as(mechanic, () => db.query('select public.set_job_status($1,$2)', [id, 'In Progress']));
    await as(desk, () => assert.rejects(db.query('select public.delete_booking($1)', [id]), /permission to delete/));
  });
  await t.test('prices never reach someone without the payments permission', async () => {
    await as(desk, () => db.query('select public.amend_booking($1,$2)', [id, { ...details, status: 'In Progress' }]));
    await as(owner, () => db.query('select public.save_job_card($1,$2)', [id, { mileage: '100', parts: [{ description: 'Pads', unit_cost: '40' }], labour: [{ cost: '60' }] }]));
    const seen = (await as(mechanic, jobs))[0];
    assert.equal('amount_due' in seen, false);
    assert.equal('payment_status' in seen, false);
    assert.equal('parts' in seen.job_card, false);
    assert.equal('labour' in seen.job_card, false);
    assert.equal(seen.vehicle.customer.first_name, 'James');
    const full = (await as(desk, jobs))[0];
    assert.equal(Number(full.amount_due), 120.5);
    assert.equal(full.job_card.parts.length, 1);
  });
  await t.test('a mechanic saving a card keeps the prices they cannot see', async () => {
    await as(mechanic, () => db.query('select public.save_job_card($1,$2)', [id, { mileage: '200', parts: [], labour: [] }]));
    const card = (await db.query('select job_card from public.jobs where id=$1', [id])).rows[0].job_card;
    assert.equal(card.mileage, '200');
    assert.equal(card.parts.length, 1);
    assert.equal(card.labour.length, 1);
    await as(desk, () => assert.rejects(db.query('select public.save_job_card($1,$2)', [id, {}]), /permission to update job cards/));
  });
  await t.test('booking managers without payments cannot change money', async () => {
    await as(owner, () => db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [desk, 'Desk', 'Custom', ['bookings_view', 'bookings_manage'], true]));
    await as(desk, () => db.query('select public.amend_booking($1,$2)', [id, { ...details, status: 'In Progress', first_name: 'Jim', amount_due: 1, payment_status: 'Unpaid' }]));
    const row = (await db.query('select amount_due, payment_status from public.jobs where id=$1', [id])).rows[0];
    assert.equal(Number(row.amount_due), 120.5);
    assert.equal(row.payment_status, 'Paid');
    assert.equal((await db.query('select first_name from public.customers')).rows[0].first_name, 'Jim');
  });
  await t.test('payment-only staff change money but not booking details', async () => {
    await as(owner, () => db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [desk, 'Desk', 'Custom', ['payments'], true]));
    await as(desk, () => db.query('select public.amend_booking($1,$2)', [id, { ...details, status: 'In Progress', first_name: 'Hacked', amount_due: 99, payment_status: 'Paid' }]));
    assert.equal(Number((await db.query('select amount_due from public.jobs where id=$1', [id])).rows[0].amount_due), 99);
    assert.equal((await db.query('select first_name from public.customers')).rows[0].first_name, 'Jim');
  });
  await t.test('deactivating or removing someone ends their access at once', async () => {
    await as(owner, () => db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [mechanic, 'Mechanic', 'Mechanic', ROLES.Mechanic, false]));
    assert.deepEqual(await as(mechanic, jobs), []);
    assert.equal((await as(mechanic, () => db.query('select public.my_staff_profile() as me'))).rows[0].me, null);
    await as(mechanic, () => assert.rejects(db.query('select public.save_job_card($1,$2)', [id, {}]), /permission to update/));
    await as(owner, () => db.query('select public.remove_staff_member($1)', [mechanic]));
    assert.equal((await db.query('select count(*)::int as count from public.staff where user_id=$1', [mechanic])).rows[0].count, 0);
  });
  await t.test('the last administrator cannot be removed or locked out', async () => {
    await as(owner, async () => {
      await assert.rejects(db.query('select public.remove_staff_member($1)', [owner]), /at least one active administrator/);
      await assert.rejects(db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [owner, 'Andy', 'Owner', ROLES.Owner, false]), /at least one active administrator/);
      await assert.rejects(db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [owner, 'Andy', 'Mechanic', ROLES.Mechanic, true]), /at least one active administrator/);
    });
    assert.equal((await db.query('select active from public.staff where user_id=$1', [owner])).rows[0].active, true);
  });
  await t.test('customer booking rules still apply and staff keep owner booking rights', async () => {
    const sunday = { ...booking, reg_no: 'CD34EFG', phone: '07700 900200', booking_date: '2099-01-04' };
    await as(null, () => assert.rejects(db.query('select public.create_booking($1)', [sunday]), /Wednesdays and Thursdays/), 'anon');
    await as(owner, () => db.query('select public.create_booking($1)', [sunday]));
  });
  await t.test('only job card staff can add photos', async () => {
    await as(owner, () => db.query('select public.update_staff_member($1,$2,$3,$4,$5)', [desk, 'Desk', 'Custom', ['payments'], true]));
    await as(desk, () => assert.rejects(db.query("insert into storage.objects values ('job-photos','1/before/a.jpg')"), /row-level security/));
    await as(owner, () => db.query("insert into storage.objects values ('job-photos','1/before/a.jpg')"));
    assert.equal((await as(desk, () => db.query('select * from storage.objects'))).rows.length, 1);
  });
});
