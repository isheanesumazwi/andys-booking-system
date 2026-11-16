import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const mechanic = '22222222-2222-4222-8222-222222222222';

test('owner tools: opening hours, cancellations, private links and online checks', async (t) => {
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
    create role service_role;
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
  await db.query("insert into auth.users values ($1,'andy@example.com'), ($2,'mech@example.com')", [owner, mechanic]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  await db.exec(await sql('staff-access.sql'));
  await db.query("insert into public.staff (user_id, full_name, email, role, permissions) values ($1, 'Mech', 'mech@example.com', 'Mechanic', '{bookings_view,job_cards}')", [mechanic]);
  await db.exec(await sql('booking-contacts.sql'));
  const migration = await sql('owner-tools.sql');
  await db.exec(migration);
  await db.exec(migration);

  const details = (patch = {}) => ({ first_name: 'James', last_name: 'Taylor', phone: '07700 900123', email: 'james@example.com', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', booking_date: '2099-01-07', booking_time: '10:30', service_type: 'Interim service', customer_address: '1 High Street', customer_postcode: 'NP19 8JJ', privacy_accepted: true, ...patch });
  const online = (patch) => as(null, 'service_role', async () => (await db.query('select public.book_online($1) as result', [details(patch)])).rows[0].result);
  const byToken = (token) => as(null, 'service_role', async () => (await db.query('select public.booking_by_token($1) as result', [token])).rows[0].result);
  const status = async (id) => (await db.query('select status from public.jobs where id=$1', [id])).rows[0].status;

  await t.test('the default hours give the seven existing slots', async () => {
    const settings = await as(null, 'anon', async () => (await db.query('select public.get_booking_settings() as s')).rows[0].s);
    assert.deepEqual(settings.slots, ['10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30']);
    assert.deepEqual(settings.open_days, [3, 4]);
  });
  await t.test('the public can no longer book around the server checks', async () => {
    await assert.rejects(as(null, 'anon', () => db.query('select public.create_booking($1)', [details()])), /permission denied/);
    await assert.rejects(as(null, 'anon', () => db.query('select public.book_online($1)', [details()])), /permission denied/);
    await assert.rejects(as(null, 'anon', () => db.query('select public.booking_by_token($1)', ['00000000-0000-4000-8000-000000000000'])), /permission denied/);
  });
  let first;
  await t.test('an online booking records consent and returns a private link', async () => {
    await assert.rejects(online({ privacy_accepted: false }), /privacy policy/);
    first = await online();
    assert.equal(first.status, 'Booked');
    assert.match(first.token, /^[0-9a-f-]{36}$/);
    assert.equal(first.reg_no, 'AB12CDE');
    assert.equal(first.can_change, true);
    assert.ok((await db.query('select consented_at from public.jobs where id=$1', [first.job_id])).rows[0].consented_at);
    assert.equal((await byToken(first.token)).job_id, first.job_id);
  });
  await t.test('a customer can move their booking to a free open slot', async () => {
    const move = (date, time) => as(null, 'service_role', () => db.query('select public.move_booking_by_token($1,$2,$3)', [first.token, date, time]));
    await assert.rejects(move('2099-01-05', '10:30'), /not taking online bookings/);
    await assert.rejects(move('2099-01-07', '09:30'), /choose a date and time/);
    await move('2099-01-08', '12:30');
    const moved = await byToken(first.token);
    assert.equal(moved.booking_date, '2099-01-08');
    assert.equal(moved.booking_time, '12:30');
    assert.equal(moved.status, 'Booked');
  });
  await t.test('cancelling frees the slot for someone else', async () => {
    await as(null, 'service_role', () => db.query('select public.cancel_booking_by_token($1)', [first.token]));
    assert.equal(await status(first.job_id), 'Cancelled');
    assert.equal((await byToken(first.token)).can_change, false);
    await assert.rejects(as(null, 'service_role', () => db.query('select public.cancel_booking_by_token($1)', [first.token])), /no longer be changed/);
    const free = await as(null, 'anon', async () => (await db.query("select * from public.get_slot_availability('2099-01-08','2099-01-08')")).rows);
    assert.deepEqual(free, []);
    const other = await online({ first_name: 'Priya', last_name: 'Shah', phone: '07700 900999', reg_no: 'XY12ZZZ', booking_date: '2099-01-08', booking_time: '12:30', service_type: 'Brakes' });
    assert.equal(other.status, 'Pending Confirmation');
  });
  await t.test('one phone can make three online bookings a day', async () => {
    await online({ booking_date: '2099-01-14' });
    await online({ booking_date: '2099-01-21' });
    await assert.rejects(online({ booking_date: '2099-01-28' }), /several bookings today/);
  });
  await t.test('the owner can change the hours, block holidays and open extra days', async () => {
    const save = (user, settings) => as(user, 'authenticated', () => db.query('select public.save_booking_settings($1)', [settings]));
    await assert.rejects(save(mechanic, { open_days: [3], open_time: '09:00', close_time: '12:00' }), /permission/);
    await assert.rejects(save(owner, { open_days: [3], open_time: '09:15', close_time: '12:00' }), /half hour/);
    await save(owner, { open_days: [3, 4], open_time: '09:00', close_time: '12:00', closed_dates: ['2099-02-04'], extra_dates: ['2099-02-07'] });
    const settings = await as(null, 'anon', async () => (await db.query('select public.get_booking_settings() as s')).rows[0].s);
    assert.deepEqual(settings.slots, ['09:00', '10:00', '11:00']);
    assert.deepEqual(settings.closed_dates, ['2099-02-04']);
    await assert.rejects(online({ phone: '07700 900111', reg_no: 'HOL1DAY', booking_date: '2099-02-04', booking_time: '09:00' }), /not taking online bookings/);
    assert.equal((await online({ phone: '07700 900111', reg_no: 'SAT1DAY', booking_date: '2099-02-07', booking_time: '09:00' })).status, 'Booked');
    await assert.rejects(online({ phone: '07700 900222', reg_no: 'OLD1SLT', booking_date: '2099-02-11', booking_time: '10:30' }), /choose a date and time/);
  });
  await t.test('staff can cancel or record a no-show, and mechanics cannot cancel', async () => {
    const job = (await db.query("select id from public.jobs where status = 'Booked' order by id limit 1")).rows[0].id;
    await assert.rejects(as(mechanic, 'authenticated', () => db.query("select public.set_job_status($1,'Cancelled')", [job])), /valid job status/);
    await as(mechanic, 'authenticated', () => db.query("select public.set_job_status($1,'No-show')", [job]));
    assert.equal(await status(job), 'No-show');
    const email = await as(null, 'service_role', async () => (await db.query('select public.booking_email_details($1) as d', [job])).rows[0].d);
    assert.equal(email.email, 'james@example.com');
    assert.match(email.token, /^[0-9a-f-]{36}$/);
    assert.equal(email.can_change, false);
  });
});
