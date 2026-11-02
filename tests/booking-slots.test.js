import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { addressLookup } from '../server/address.js';
import { BOOKING_SLOTS, bookingDates, isAutoConfirmed, normalizePostcode, slotLabel, validPostcode } from '../src/utils.js';

const owner = '11111111-1111-4111-8111-111111111111';
const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const json = (status, body) => new Response(JSON.stringify(body), { status });

test('booking helpers cover slots, days, postcodes and automatic confirmation', () => {
  assert.deepEqual(BOOKING_SLOTS.map(slotLabel), ['10:30am', '11:30am', '12:30pm', '1:30pm', '2:30pm', '3:30pm', '4:30pm']);
  const days = bookingDates('2026-11-01', 2);
  assert.deepEqual(days, ['2026-11-04', '2026-11-05', '2026-11-11', '2026-11-12']);
  assert.equal(normalizePostcode('np198jj'), 'NP19 8JJ');
  assert.equal(validPostcode('np19 8jj'), true);
  for (const bad of ['', 'NP19', '12345', 'NP19 8J']) assert.equal(validPostcode(bad), false);
  assert.equal(isAutoConfirmed(' major service '), true);
  assert.equal(isAutoConfirmed('Major service – knocking noise'), false);
  assert.equal(isAutoConfirmed('MOT'), false);
});

test('address lookup lists addresses with a key and falls back to a postcode check', async () => {
  const urls = [];
  const paid = await addressLookup('GET', 'np198jj', { IDEAL_POSTCODES_API_KEY: 'ak_test' }, async (url) => {
    urls.push(String(url));
    return json(200, { result: [{ line_1: '1A Warwick Road', line_2: '', line_3: '', post_town: 'Newport', postcode: 'NP19 8JJ' }] });
  });
  assert.match(urls[0], /api\.ideal-postcodes\.co\.uk\/v1\/postcodes\/NP19%208JJ/);
  assert.deepEqual(paid.body.addresses, [{ line_1: '1A Warwick Road', line_2: '', town: 'Newport', postcode: 'NP19 8JJ' }]);

  const free = await addressLookup('GET', 'NP19 8JJ', {}, async () => json(200, { result: { postcode: 'NP19 8JJ', admin_district: 'Newport' } }));
  assert.deepEqual(free, { status: 200, body: { postcode: 'NP19 8JJ', town: 'Newport', addresses: [] } });

  assert.equal((await addressLookup('GET', 'ZZ1 1ZZ', {}, async () => json(404, {}))).status, 404);
  assert.equal((await addressLookup('GET', 'nope', {}, async () => { throw new Error('not called'); })).status, 400);
  assert.equal((await addressLookup('POST', 'NP19 8JJ', {})).status, 405);
  const down = await addressLookup('GET', 'NP19 8JJ', {}, async () => { throw new Error('offline'); });
  assert.equal(down.status, 503);
  assert.match(down.body.error, /manually/);
  const original = console.error;
  console.error = () => {};
  const fallback = await addressLookup('GET', 'NP19 8JJ', { IDEAL_POSTCODES_API_KEY: 'bad' }, async (url) => (String(url).includes('ideal') ? json(402, {}) : json(200, { result: { postcode: 'NP19 8JJ', admin_district: 'Newport' } })));
  console.error = original;
  assert.equal(fallback.status, 200);
});

test('booking slot migration enforces days, slots and confirmation rules', async (t) => {
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
    create schema storage;
    create table auth.users(id uuid primary key);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ['setup.sql', 'booking-updates.sql', 'job-cards.sql', 'service-requests.sql']) await db.exec(await sql(file));
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  const migration = await sql('booking-slots.sql');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(await sql('job-photos.sql'));
  await db.exec(await sql('job-photos.sql'));

  // 2099-01-07 is a Wednesday, 2099-01-08 a Thursday and 2099-01-04 a Sunday.
  const booking = (patch = {}) => ({ first_name: 'James', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', year: 2018, engine_capacity: '1598', booking_date: '2099-01-07', booking_time: '10:30', service_type: 'MOT', customer_address: '1 High Street\nNewport', customer_postcode: 'NP19 8JJ', ...patch });
  const create = (patch) => db.query('select public.create_booking($1) as status', [booking(patch)]);
  const status = (rows) => rows.rows[0].status;

  await t.test('customers can only book Wednesdays and Thursdays in hourly slots', async () => {
    await role('anon', null, async () => {
      await assert.rejects(create({ booking_date: '2099-01-04' }), /Wednesdays and Thursdays/);
      await assert.rejects(create({ booking_date: '2099-01-05' }), /Wednesdays and Thursdays/);
      await assert.rejects(create({ booking_time: '11:00' }), /date and time/);
      await assert.rejects(create({ booking_time: '17:30' }), /date and time/);
      await assert.rejects(create({ booking_time: null }), /date and time/);
      await assert.rejects(create({ booking_date: '2021-01-06' }), /has passed/);
    });
  });
  await t.test('an address and valid postcode are mandatory', async () => {
    await role('anon', null, async () => {
      await assert.rejects(create({ customer_address: '' }), /full address/);
      await assert.rejects(create({ customer_address: null }), /full address/);
      await assert.rejects(create({ customer_postcode: 'nope' }), /full address/);
    });
    assert.equal((await db.query('select count(*)::int as count from public.jobs')).rows[0].count, 0);
  });
  await t.test('other work waits for confirmation and listed services confirm automatically', async () => {
    await role('anon', null, async () => {
      assert.equal(status(await create()), 'Pending Confirmation');
      assert.equal(status(await create({ booking_time: '11:30', reg_no: 'AB12CDF', phone: '07700 900124', service_type: 'Interim service' })), 'Booked');
      assert.equal(status(await create({ booking_time: '12:30', reg_no: 'AB12CDG', phone: '07700 900125', service_type: 'Full service' })), 'Booked');
      assert.equal(status(await create({ booking_time: '13:30', reg_no: 'AB12CDH', phone: '07700 900126', service_type: 'Major service' })), 'Booked');
      assert.equal(status(await create({ booking_time: '14:30', reg_no: 'AB12CDI', phone: '07700 900127', service_type: 'Major service – knocking noise' })), 'Pending Confirmation');
    });
    const row = (await db.query("select customer_address, customer_postcode from public.jobs where booking_time='10:30'")).rows[0];
    assert.deepEqual(row, { customer_address: '1 High Street\nNewport', customer_postcode: 'NP19 8JJ' });
  });
  await t.test('a taken or pending slot cannot be double booked', async () => {
    await role('anon', null, async () => {
      await assert.rejects(create({ reg_no: 'ZZ11ZZZ', phone: '07700 900130' }), /just been taken/);
      await assert.rejects(create({ booking_time: '11:30', reg_no: 'ZZ11ZZZ', phone: '07700 900130' }), /just been taken/);
    });
  });
  await t.test('the public slot board shows states but no customer details', async () => {
    const rows = await role('anon', null, () => db.query("select * from public.get_slot_availability('2099-01-07', '2099-01-07') order by slot_time"));
    assert.deepEqual(Object.keys(rows.rows[0]), ['slot_date', 'slot_time', 'state']);
    assert.deepEqual(rows.rows.map((row) => [row.slot_time, row.state]), [['10:30', 'pending'], ['11:30', 'booked'], ['12:30', 'booked'], ['13:30', 'booked'], ['14:30', 'pending']]);
    await role('anon', null, () => assert.rejects(db.query("select * from public.get_slot_availability('2099-01-01', '2099-12-01')"), /shorter date range/));
  });
  await t.test('older intake functions can no longer bypass the rules', async () => {
    await role('anon', null, async () => {
      await assert.rejects(db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', ['A', 'B', '07700 900140', 'QQ11QQQ', 'Ford', 'Ka', null, null, '2099-01-04', 'Pending Confirmation', 'MOT']), /permission denied/);
      await assert.rejects(db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['A', 'B', '07700 900140', 'QQ11QQQ', 'Ford', 'Ka', null, null, '2099-01-04', 'Pending Confirmation']), /permission denied/);
    });
  });
  await t.test('the owner can move a job to a Sunday and declining frees the slot', async () => {
    const id = (await db.query("select id from public.jobs where booking_time='10:30'")).rows[0].id;
    const details = { ...booking({ booking_date: '2099-01-04', booking_time: '12:30' }), status: 'Rescheduled', payment_status: 'Unpaid', amount_due: 0, diagnosis_notes: '', parts_ordered: '' };
    await role('authenticated', owner, () => db.query('select public.amend_booking($1,$2)', [id, details]));
    assert.equal((await db.query('select booking_date::text as day from public.jobs where id=$1', [id])).rows[0].day, '2099-01-04');
    const other = (await db.query("select id from public.jobs where booking_time='11:30'")).rows[0].id;
    const moved = { ...details, reg_no: 'AB12CDF', phone: '07700 900124' };
    await role('authenticated', owner, () => assert.rejects(db.query('select public.amend_booking($1,$2)', [other, moved]), /already has that date and time/));
    await role('authenticated', owner, () => db.query('select public.delete_booking($1)', [id]));
    await role('anon', null, async () => { assert.equal(status(await create({ booking_time: '10:30', reg_no: 'AB12CDE' })), 'Pending Confirmation'); });
  });
  await t.test('the owner can book any future day', async () => {
    const result = await role('authenticated', owner, () => create({ booking_date: '2099-01-04', booking_time: '15:30', reg_no: 'OW11NER', phone: '07700 900150' }));
    assert.equal(status(result), 'Booked');
  });
  await t.test('job photos are private to the owner', async () => {
    assert.equal((await db.query("select public from storage.buckets where id='job-photos'")).rows[0].public, false);
    await db.query("insert into storage.objects values ('job-photos', '1/before/a.jpg')");
    await role('authenticated', owner, async () => {
      assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
      await db.query("insert into storage.objects values ('job-photos', '1/after/b.jpg')");
    });
    const outsider = '22222222-2222-4222-8222-222222222222';
    await role('authenticated', outsider, async () => {
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
      await assert.rejects(db.query("insert into storage.objects values ('job-photos', '1/before/c.jpg')"), /row-level security/);
    });
  });
});
