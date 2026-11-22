import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { submitFeedback } from '../server/feedback.js';

const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const mechanic = '22222222-2222-4222-8222-222222222222';

test('feedback: only approved, consented reviews reach the website', async (t) => {
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
  await db.exec(await sql('owner-tools.sql'));
  const migration = await sql('feedback.sql');
  await db.exec(migration);
  await db.exec(migration);

  const submit = (rating, comment, name, publish) => as(null, 'service_role', () => db.query('select public.submit_feedback($1, $2, $3, $4)', [rating, comment, name, publish]));
  const published = () => as(null, 'anon', async () => (await db.query('select public.published_reviews() as r')).rows[0].r);
  const list = () => as(owner, 'authenticated', async () => (await db.query('select public.list_feedback() as l')).rows[0].l);
  const review = (user, id, status) => as(user, 'authenticated', () => db.query('select public.review_feedback($1, $2)', [id, status]));

  await t.test('the public cannot write feedback or read the table directly', async () => {
    await assert.rejects(as(null, 'anon', () => db.query("select public.submit_feedback(5, 'Great', 'Sam', true)")), /permission denied/);
    await assert.rejects(as(null, 'anon', () => db.query('select * from public.feedback')), /permission denied/);
    await assert.rejects(as(null, 'anon', () => db.query('select public.list_feedback()')), /permission denied/);
  });
  await t.test('submissions are checked', async () => {
    await assert.rejects(submit(0, 'x', '', true), /rating from 1 to 5/);
    await assert.rejects(submit(6, 'x', '', true), /rating from 1 to 5/);
    await assert.rejects(submit(4, 'x'.repeat(601), '', true), /600 characters/);
    await assert.rejects(submit(4, 'ok', 'n'.repeat(61), true), /60 characters/);
  });
  let shared; let secret;
  await t.test('new feedback waits for approval', async () => {
    await submit(5, '  Quick and friendly.  ', ' Sam ', true);
    await submit(2, 'The booking form was hard to use on my phone.', '', false);
    const items = await list();
    assert.equal(items.length, 2);
    shared = items.find((i) => i.can_publish);
    secret = items.find((i) => !i.can_publish);
    assert.equal(shared.comment, 'Quick and friendly.');
    assert.equal(shared.display_name, 'Sam');
    assert.equal(shared.status, 'Pending');
    assert.equal((await published()).count, 0);
  });
  await t.test('only admins can see or review feedback', async () => {
    await assert.rejects(as(mechanic, 'authenticated', () => db.query('select public.list_feedback()')), /permission to see feedback/);
    await assert.rejects(review(mechanic, shared.id, 'Approved'), /permission to review feedback/);
    await assert.rejects(as(mechanic, 'authenticated', () => db.query('select public.delete_feedback($1)', [shared.id])), /permission to delete feedback/);
  });
  await t.test('approving publishes it straight away; private feedback can never be published', async () => {
    await review(owner, shared.id, 'Approved');
    const site = await published();
    assert.equal(site.count, 1);
    assert.equal(Number(site.average), 5);
    assert.equal(site.reviews[0].comment, 'Quick and friendly.');
    assert.equal(site.reviews[0].name, 'Sam');
    await assert.rejects(review(owner, secret.id, 'Approved'), /did not agree/);
    await review(owner, shared.id, 'Hidden');
    assert.equal((await published()).count, 0);
  });
  await t.test('admins can delete feedback', async () => {
    await as(owner, 'authenticated', () => db.query('select public.delete_feedback($1)', [secret.id]));
    assert.equal((await list()).length, 1);
  });
});

const env = { VITE_SUPABASE_URL: 'https://db.example', VITE_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', GMAIL_USER: 'andy@example.com' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('feedback is saved with the service key and the workshop is told', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url: String(url), key: options.headers.apikey, body: JSON.parse(options.body) }); return json(null); };
  const sent = [];
  const result = await submitFeedback('POST', { rating: 4, comment: ' Good job ', name: 'Sam', publish: true }, env, { fetcher, send: async (m) => sent.push(m), site: 'https://garage.example' });
  assert.equal(result.status, 200);
  assert.match(calls[0].url, /rpc\/submit_feedback$/);
  assert.equal(calls[0].key, 'service');
  assert.deepEqual(calls[0].body, { p_rating: 4, p_comment: 'Good job', p_name: 'Sam', p_publish: true });
  assert.equal(sent[0].to, 'andy@example.com');
  assert.match(sent[0].subject, /New 4-star feedback/);
  assert.match(sent[0].text, /garage\.example\/admin/);
});

test('feedback from bots, bad ratings and missing set-up are turned away', async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(String(url)); return json(null); };
  assert.equal((await submitFeedback('POST', { rating: 5, company: 'Spam Ltd' }, env, { fetcher })).status, 200);
  assert.equal((await submitFeedback('POST', { rating: 9 }, env, { fetcher })).status, 400);
  assert.equal((await submitFeedback('POST', { rating: 3, comment: 'x'.repeat(601) }, env, { fetcher })).status, 400);
  assert.equal((await submitFeedback('GET', null, env, { fetcher })).status, 405);
  assert.equal((await submitFeedback('POST', { rating: 3 }, { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, { fetcher })).status, 503);
  assert.equal(calls.length, 0);
});

test('feedback needs the security check when it is switched on', async () => {
  const fetcher = async (url) => (String(url).includes('turnstile') ? json({ success: false }) : json(null));
  const result = await submitFeedback('POST', { rating: 5, turnstile_token: 'bad' }, { ...env, TURNSTILE_SECRET_KEY: 'secret' }, { fetcher });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /security check/);
});
