import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { jobContact, jobMatches } from '../src/utils.js';

const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';

test('known vehicles booked with a different phone are held for review', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  async function as(user, role, action) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`set role ${role}`);
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
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ['setup.sql', 'booking-updates.sql', 'job-cards.sql', 'service-requests.sql', 'booking-slots.sql', 'job-photos.sql']) await db.exec(await sql(file));
  await db.query("insert into auth.users values ($1,'andy@example.com')", [owner]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  await db.exec(await sql('staff-access.sql'));
  const migration = await sql('booking-contacts.sql');
  await db.exec(migration);
  await db.exec(migration);

  const booking = (patch = {}) => ({ first_name: 'James', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', year: 2018, booking_date: '2099-01-07', booking_time: '10:30', service_type: 'Interim service', customer_address: '1 High Street', customer_postcode: 'NP19 8JJ', email: 'James@Example.com', ...patch });
  const create = (patch, user = null, role = 'anon') => as(user, role, async () => (await db.query('select public.create_booking($1) as status', [booking(patch)])).rows[0].status);
  const job = async (time) => (await db.query('select * from public.jobs where booking_time=$1', [time])).rows[0];

  assert.equal(await create(), 'Booked');
  const other = { first_name: 'Priya', last_name: 'Shah', phone: '07700 900999' };
  const later = { booking_time: '13:30', booking_date: '2099-01-28' };
  const count = async () => (await db.query('select count(*)::int as count from public.jobs')).rows[0].count;

  await t.test('the same number in another format counts as the same customer', async () => {
    assert.equal(await create({ phone: '+44 7700 900123', booking_time: '11:30', booking_date: '2099-01-14' }), 'Booked');
    assert.equal(await create({ phone: '0044 7700 900123', booking_time: '12:30', booking_date: '2099-01-21' }), 'Booked');
    assert.equal((await job('11:30')).contact_phone, '');
    assert.equal((await db.query('select count(*)::int as count from public.customers')).rows[0].count, 1);
    assert.equal((await job('11:30')).contact_email, 'james@example.com');
  });
  await t.test('online bookings need a valid email', async () => {
    const before = await count();
    await assert.rejects(create({ email: '', booking_time: '15:30', booking_date: '2099-01-14' }), /valid email/);
    await assert.rejects(create({ email: 'james@example', booking_time: '15:30', booking_date: '2099-01-14' }), /valid email/);
    await assert.rejects(create({ ...other, ...later, email: 'nope', change_request: true }), /valid email/);
    assert.equal(await count(), before);
  });
  await t.test('a different number on an actively booked car is asked first and saves nothing', async () => {
    const before = await count();
    assert.equal(await create({ ...other, ...later }), 'Already Booked');
    assert.equal(await count(), before);
    await assert.rejects(create({ ...other, ...later, phone: 'not a phone' }), /check your contact details/);
    await assert.rejects(create({ ...other, booking_date: '2099-01-04' }), /Wednesdays and Thursdays/);
    await assert.rejects(create({ ...other, ...later, customer_address: '' }), /full address/);
  });
  await t.test('a change request waits for review and leaves the customer on file alone', async () => {
    assert.equal(await create({ ...other, ...later, change_request: true, make: 'Fake' }), 'Pending Confirmation');
    const row = await job('13:30');
    assert.equal(row.contact_name, 'Priya Shah');
    assert.equal(row.contact_phone, '07700 900999');
    assert.ok(row.replaces_job_id);
    assert.deepEqual((await db.query('select first_name, phone from public.customers')).rows, [{ first_name: 'James', phone: '07700 900123' }]);
    assert.equal((await db.query('select make from public.vehicles')).rows[0].make, 'Ford');
  });
  await t.test('approving a change request replaces the old booking and keeps its job card', async () => {
    const row = await job('13:30');
    await db.query('update public.jobs set job_card=$1 where id=$2', [{ mileage: '100' }, row.replaces_job_id]);
    await as(owner, 'authenticated', () => db.query('select public.approve_booking($1)', [row.id]));
    const approved = await job('13:30');
    assert.equal(approved.status, 'Booked');
    assert.equal(approved.replaces_job_id, null);
    assert.equal(approved.job_card.mileage, '100');
    assert.equal((await db.query('select count(*)::int as count from public.jobs where id=$1', [row.replaces_job_id])).rows[0].count, 0);
  });
  await t.test('declining a change request keeps the existing booking', async () => {
    assert.equal(await create({ ...other, booking_time: '14:30', booking_date: '2099-02-04', change_request: true }), 'Pending Confirmation');
    const row = await job('14:30');
    await as(owner, 'authenticated', () => db.query('select public.delete_booking($1)', [row.id]));
    assert.equal((await db.query('select count(*)::int as count from public.jobs where id=$1', [row.replaces_job_id])).rows[0].count, 1);
  });
  await t.test('completing a job saves a copy and stops it blocking new bookings', async () => {
    const seen = await as(owner, 'authenticated', async () => (await db.query('select public.list_workshop_jobs() as jobs')).rows[0].jobs);
    for (const item of seen) await as(owner, 'authenticated', () => db.query('select public.set_job_status($1,$2)', [item.id, 'Completed']));
    const done = await job('11:30');
    assert.ok(done.completed_at);
    assert.deepEqual(done.completed_record, { name: 'James Taylor', phone: '07700 900123', email: 'james@example.com', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus' });
    assert.equal((await job('13:30')).completed_record.name, 'Priya Shah');
    assert.equal(await create({ first_name: 'Sam', last_name: 'New', phone: '07700 900777', booking_time: '15:30', booking_date: '2099-03-04' }), 'Booked');
    const fresh = await job('15:30');
    assert.equal(fresh.contact_name, 'Sam New');
    assert.equal(fresh.replaces_job_id, null);
    assert.equal(done.completed_record.name, 'James Taylor');
  });
  await t.test('corrections refresh the copy and reopening a job clears it', async () => {
    const done = await job('11:30');
    const details = { first_name: 'Jim', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', booking_date: '2099-01-14', booking_time: '11:30', status: 'Completed', payment_status: 'Paid', amount_due: 10, service_type: 'MOT', diagnosis_notes: '', parts_ordered: '', customer_address: 'x', customer_postcode: '' };
    await as(owner, 'authenticated', () => db.query('select public.amend_booking($1,$2)', [done.id, details]));
    assert.equal((await job('11:30')).completed_record.name, 'Jim Taylor');
    await as(owner, 'authenticated', () => db.query('select public.save_job_card($1,$2)', [done.id, { mileage: '5' }]));
    assert.equal((await job('11:30')).completed_at.getTime(), done.completed_at.getTime());
    await as(owner, 'authenticated', () => db.query('select public.set_job_status($1,$2)', [done.id, 'Booked']));
    const reopened = await job('11:30');
    assert.equal(reopened.completed_record, null);
    assert.equal(reopened.completed_at, null);
  });
  await t.test('the workshop can book a known car directly', async () => {
    assert.equal(await create({ ...other, email: '', booking_time: '16:30', booking_date: '2099-03-08' }, owner, 'authenticated'), 'Booked');
  });
});

test('completed jobs can be found by name, car, amount and dates', () => {
  const job = { booking_date: '2026-11-05', completed_at: '2026-11-06T10:00:00Z', amount_due: 120.5, service_type: 'Full service', job_card: {}, vehicle: { reg_no: 'NEW1', make: 'Now', model: 'Different', customer: { first_name: 'Later', last_name: 'Change', phone: '1' } }, completed_record: { name: 'James Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus' } };
  for (const term of ['james', 'TAYLOR', 'ford focus', 'ab12', '120.50', '£120', '2026-11-05', '5 november', '05/11/2026', '6 nov', 'ford 120']) assert.equal(jobMatches(job, term, true), true, term);
  for (const term of ['later', 'ford 999', '7 nov']) assert.equal(jobMatches(job, term, true), false, term);
  assert.equal(jobMatches(job, '120.50', false), false);
  assert.equal(jobMatches({ ...job, completed_record: null, contact_name: 'Sam New', contact_phone: '07' }, 'sam', true), true);
  assert.equal(jobContact({ contact_name: 'Sam', contact_phone: '07', vehicle: { customer: { first_name: 'A', last_name: 'B', phone: '1' } } }).name, 'Sam');
});
