import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CHECKLIST, cardTotals, checkSummary, emptyCard, jobProgress, labourCost, normalizeCard, withLabourCost } from '../src/jobCard.js';

const owner = '11111111-1111-4111-8111-111111111111';
const outsider = '22222222-2222-4222-8222-222222222222';
const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');

test('checklist matches the paper service checklist numbering', () => {
  const ids = CHECKLIST.flatMap((section) => section.items.map(([id]) => id));
  assert.deepEqual(ids, Array.from({ length: 50 }, (_, i) => i + 1));
});

test('older or partial job cards are filled with defaults', () => {
  const card = normalizeCard({ mileage: '52000', tyres: { osf: { tread: '4' } }, parts: [{ description: 'Oil filter' }], checks: { 3: 'repair' } });
  assert.equal(card.mileage, '52000');
  assert.deepEqual(card.tyres.osf, { condition: '', pressure: '', tread: '4' });
  assert.deepEqual(card.tyres.spare, { condition: '', pressure: '', tread: '' });
  assert.deepEqual(card.parts[0], { description: 'Oil filter', part_no: '', qty: '1', unit_cost: '' });
  assert.equal(card.work_notes, '');
  for (const raw of [null, undefined, [], 'text', { parts: 'bad', tyres: [] }]) assert.deepEqual(normalizeCard(raw), emptyCard());
  assert.deepEqual(checkSummary(card), { ok: 0, advisory: 0, repair: 1 });
});

test('receipt totals multiply quantities and hours, ignoring blank or negative values', () => {
  const card = normalizeCard({
    parts: [{ description: 'Pads', qty: '2', unit_cost: '24.99' }, { description: 'Bad', qty: '-1', unit_cost: '10' }, { description: 'Blank', qty: '', unit_cost: '5' }],
    labour: [{ description: 'Fit pads', hours: '1.5', rate: '45' }, { description: 'Diagnosis', hours: '0.1', rate: '0.3' }],
  });
  assert.deepEqual(cardTotals(card), { parts: 49.98, labour: 67.53, total: 117.51 });
});

test('manual labour cost overrides hours x rate, which fills it in when both are entered', () => {
  assert.equal(labourCost({ description: 'Diagnosis', hours: '', rate: '', cost: '35' }), 35);
  assert.equal(labourCost({ description: 'Fit', hours: '2', rate: '45', cost: '80' }), 80);
  assert.equal(labourCost({ description: 'Old line', hours: '2', rate: '45' }), 90);
  assert.equal(labourCost({ description: 'Blank', hours: '', rate: '', cost: '' }), 0);
  assert.deepEqual(withLabourCost({ hours: '1.5', rate: '50', cost: '' }, 'rate'), { hours: '1.5', rate: '50', cost: '75.00' });
  assert.deepEqual(withLabourCost({ hours: '1.5', rate: '', cost: '60' }, 'hours'), { hours: '1.5', rate: '', cost: '60' });
  assert.deepEqual(withLabourCost({ hours: '1.5', rate: '50', cost: '60' }, 'cost'), { hours: '1.5', rate: '50', cost: '60' });
});

test('job progress follows checked, priced, authorised, work done, QC and paid', () => {
  assert.deepEqual(jobProgress({ job_card: {}, payment_status: 'Unpaid' }).completed, 0);
  assert.equal(jobProgress({ job_card: {}, payment_status: 'Unpaid' }).next, 'Start the inspection');
  assert.equal(jobProgress({ job_card: { checks: { 1: null } }, payment_status: 'Unpaid' }).done.checked, false);
  const priced = jobProgress({ job_card: { checks: { 1: 'ok' }, labour: [{ description: 'Pads', cost: '40' }] }, payment_status: 'Unpaid' });
  assert.equal(priced.next, 'Get customer authorisation');
  const done = jobProgress({ job_card: { diagnosis: 'Worn pads', parts: [{ description: 'Pads', qty: '1', unit_cost: '30' }], authorised: true, work_notes: 'Fitted', qc_passed: true }, payment_status: 'Paid' });
  assert.equal(done.completed, 6);
  assert.equal(done.next, null);
});

test('job card migration stores cards for the owner only', async (t) => {
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
  await db.exec(await sql('setup.sql'));
  await db.exec(await sql('booking-updates.sql'));
  await db.query('insert into auth.users values ($1),($2)', [owner, outsider]);
  await db.query('insert into public.app_admins values ($1)', [owner]);
  await role('anon', null, () => db.query('select public.request_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['James', 'Taylor', '07700 900123', 'AB12 CDE', 'Ford', 'Focus', 2018, '1598', '2099-01-01', 'Pending Confirmation', 'Service']));
  const migration = await sql('job-cards.sql');
  await db.exec(migration);
  await db.exec(migration);
  const id = (await db.query('select id from public.jobs')).rows[0].id;
  const card = { mileage: '52000', checks: { 1: 'ok', 40: 'repair' }, parts: [{ description: 'Pads', qty: '2', unit_cost: '24.99' }] };

  await t.test('existing jobs start with an empty card', async () => {
    assert.deepEqual((await db.query('select job_card from public.jobs where id=$1', [id])).rows[0].job_card, {});
  });
  await t.test('anonymous and non-owner users cannot save cards', async () => {
    await role('anon', null, () => assert.rejects(db.query('select public.save_job_card($1,$2)', [id, card]), /permission denied/));
    await role('authenticated', outsider, () => assert.rejects(db.query('select public.save_job_card($1,$2)', [id, card]), /Only the workshop owner/));
  });
  await t.test('owner cannot bypass the RPC with a direct column update', async () => {
    await role('authenticated', owner, () => assert.rejects(db.query('update public.jobs set job_card=$2 where id=$1', [id, card]), /permission denied/));
  });
  await t.test('owner saves and replaces the card without touching booking details', async () => {
    await role('authenticated', owner, () => db.query('select public.save_job_card($1,$2)', [id, card]));
    const row = (await db.query('select job_card, status, service_type from public.jobs where id=$1', [id])).rows[0];
    assert.deepEqual(row.job_card, card);
    assert.equal(row.status, 'Pending Confirmation');
    assert.equal(row.service_type, 'Service');
    await role('authenticated', owner, () => db.query('select public.save_job_card($1,$2)', [id, { mileage: '1' }]));
    assert.deepEqual((await db.query('select job_card from public.jobs where id=$1', [id])).rows[0].job_card, { mileage: '1' });
  });
  await t.test('invalid, oversized and missing cards are rejected', async () => {
    await role('authenticated', owner, async () => {
      for (const bad of [[1, 2], 'text', null, { notes: 'x'.repeat(200001) }]) {
        await assert.rejects(db.query('select public.save_job_card($1,$2::jsonb)', [id, bad === null ? null : JSON.stringify(bad)]), /invalid or too large/);
      }
      await assert.rejects(db.query('select public.save_job_card($1,$2)', [id + 999, card]), /no longer exists/);
    });
    assert.deepEqual((await db.query('select job_card from public.jobs where id=$1', [id])).rows[0].job_card, { mileage: '1' });
  });
});
