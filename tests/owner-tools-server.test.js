import test from 'node:test';
import assert from 'node:assert/strict';
import { bookOnline, manageBooking, notifyCustomer } from '../server/bookings.js';
import { customerEmail } from '../server/mail.js';
import { calendarEvent, googleCalendarLink, icsFile } from '../src/calendar.js';
import { bookingDates, isOpenOn, jobsCsv, motDueList, openingHoursText, slotTimes, whatsappLink } from '../src/utils.js';

const env = { VITE_SUPABASE_URL: 'https://db.example', VITE_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', GMAIL_USER: 'andy@example.com' };
const token = '6f1c2a54-7b7e-4c3a-9d0e-1a2b3c4d5e6f';
const booking = { job_id: 7, status: 'Booked', booking_date: '2099-01-07', booking_time: '10:30', service_type: 'Interim service', reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', first_name: 'James', email: 'james@example.com', can_change: true };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeDatabase(routes) {
  const calls = [];
  const fetcher = async (url, options) => {
    const name = String(url).split('/rpc/')[1] || String(url);
    calls.push({ name, key: options?.headers?.apikey, auth: options?.headers?.Authorization, body: options?.body });
    return routes[name] ? routes[name](options) : json({ code: '42883', message: 'missing' }, 404);
  };
  return { fetcher, calls };
}
const details = { first_name: 'James', phone: '07700 900123', booking_date: '2099-01-07', booking_time: '10:30', privacy_accepted: true, sneaky: 'x' };

test('online booking runs the checks, books with the service key and emails both sides', async () => {
  const { fetcher, calls } = fakeDatabase({ book_online: () => json({ ...booking, token }) });
  const sent = [];
  const result = await bookOnline('POST', { details }, env, { fetcher, send: async (m) => sent.push(m), site: 'https://garage.example' });
  assert.equal(result.status, 200);
  assert.equal(result.body.token, token);
  assert.equal(result.body.emailed, true);
  assert.equal(calls[0].key, 'service');
  assert.equal(JSON.parse(calls[0].body).p_details.sneaky, undefined);
  assert.deepEqual(sent.map((m) => m.to), ['james@example.com', 'andy@example.com']);
  assert.match(sent[0].text, /https:\/\/garage\.example\/manage\?t=6f1c2a54/);
  assert.match(sent[1].subject, /New online booking: AB12CDE/);
});

test('bots filling the hidden field get a normal reply and nothing is booked', async () => {
  const { fetcher, calls } = fakeDatabase({});
  const result = await bookOnline('POST', { details, company: 'Spam Ltd' }, env, { fetcher });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 0);
});

test('the Turnstile check is required once a secret is set', async () => {
  const { fetcher, calls } = fakeDatabase({ 'https://challenges.cloudflare.com/turnstile/v0/siteverify': () => json({ success: false }) });
  const routed = async (url, options) => (String(url).includes('turnstile') ? json({ success: false }) : fetcher(url, options));
  const result = await bookOnline('POST', { details, turnstile_token: 'bad' }, { ...env, TURNSTILE_SECRET_KEY: 'secret' }, { fetcher: routed });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /security check/);
  assert.equal(calls.length, 0);
});

test('database messages reach the customer, and older databases still take bookings', async () => {
  const refused = fakeDatabase({ book_online: () => json({ code: 'P0001', message: 'That time has just been taken. Please choose another.' }, 400) });
  assert.equal((await bookOnline('POST', { details }, env, { fetcher: refused.fetcher })).body.error, 'That time has just been taken. Please choose another.');
  const older = fakeDatabase({ book_online: () => json({ code: 'PGRST202' }, 404), create_booking: () => json('Pending Confirmation') });
  const result = await bookOnline('POST', { details }, env, { fetcher: older.fetcher });
  assert.deepEqual(result.body, { status: 'Pending Confirmation' });
  assert.equal(older.calls[1].key, 'anon');
  assert.equal(JSON.parse(older.calls[1].body).p_details.privacy_accepted, undefined);
});

test('customers manage bookings only with a valid private link', async () => {
  const { fetcher } = fakeDatabase({ booking_by_token: () => json(booking), cancel_booking_by_token: () => json({ ...booking, status: 'Cancelled', can_change: false }) });
  assert.equal((await manageBooking('GET', 'not-a-token', null, env, { fetcher })).status, 404);
  assert.equal((await manageBooking('GET', token, null, env, { fetcher })).body.booking.reg_no, 'AB12CDE');
  const sent = [];
  const result = await manageBooking('POST', null, { token, action: 'cancel' }, env, { fetcher, send: async (m) => sent.push(m), site: 'https://garage.example' });
  assert.equal(result.body.booking.status, 'Cancelled');
  assert.match(sent[0].subject, /cancelled/);
  assert.equal(sent[0].attachments.length, 0);
  assert.match(sent[1].subject, /Customer cancelled/);
});

test('only people who manage bookings can email a customer', async () => {
  const sent = [];
  const send = async (m) => sent.push(m);
  const denied = fakeDatabase({ has_permission: () => json(false) });
  assert.equal((await notifyCustomer('POST', 'Bearer user', { job_id: 7 }, env, { fetcher: denied.fetcher, send })).status, 403);
  const allowed = fakeDatabase({ has_permission: () => json(true), booking_email_details: () => json({ ...booking, token }) });
  const result = await notifyCustomer('POST', 'Bearer user', { job_id: 7, kind: 'confirmed' }, env, { fetcher: allowed.fetcher, send, site: 'https://garage.example' });
  assert.deepEqual(result.body, { ok: true, to: 'james@example.com' });
  assert.equal(allowed.calls[0].auth, 'Bearer user');
  assert.match(sent[0].subject, /confirmed/);
  assert.equal((await notifyCustomer('POST', 'Bearer user', { job_id: 7 }, env, { fetcher: allowed.fetcher, send: null })).status, 503);
});

test('emails carry a calendar file and the private link only while it can be used', () => {
  const email = customerEmail('booked', { ...booking, token }, 'https://garage.example');
  assert.match(email.subject, /You're booked in/);
  assert.match(email.attachments[0].content, /DTSTART:20990107T103000/);
  assert.doesNotMatch(customerEmail('update', { ...booking, can_change: false, token }, 'https://garage.example').text, /manage\?t=/);
});

test('calendar files and links use the booked hour', () => {
  const event = calendarEvent(booking);
  const file = icsFile(event, 'abc');
  assert.match(file, /DTEND:20990107T113000/);
  assert.ok(file.split('\r\n').every((line) => line.length <= 75));
  assert.match(googleCalendarLink(event), /dates=20990107T103000%2F20990107T113000/);
});

test('opening hours drive the days and slots offered', () => {
  const settings = { open_days: [6], open_time: '09:00', close_time: '12:30', closed_dates: ['2099-01-10'], extra_dates: ['2099-01-14'] };
  assert.deepEqual(slotTimes(settings), ['09:00', '10:00', '11:00']);
  assert.equal(isOpenOn('2099-01-10', settings), false);
  assert.equal(isOpenOn('2099-01-17', settings), true);
  assert.deepEqual(bookingDates('2099-01-09', 2, settings), ['2099-01-14', '2099-01-17']);
  assert.equal(openingHoursText(settings), 'Saturdays, 9:00am to 12:30pm');
});

test('WhatsApp links use the international number', () => {
  assert.equal(whatsappLink('07700 900123', 'Hi there'), 'https://wa.me/447700900123?text=Hi%20there');
  assert.equal(whatsappLink('+44 7700 900123', 'x'), 'https://wa.me/447700900123?text=x');
  assert.equal(whatsappLink('123', 'x'), '');
});

test('MOTs fall due a year after the last one, unless already booked in', () => {
  const car = (reg, extra) => ({ service_type: 'MOT', vehicle: { reg_no: reg, make: 'Ford', model: 'Ka', customer: { first_name: 'A', last_name: 'B', phone: '07700900123' } }, ...extra });
  const jobs = [
    car('DUE1', { status: 'Completed', booking_date: '2025-12-01', completed_at: '2025-12-01T10:00:00Z' }),
    car('OLD1', { status: 'Completed', booking_date: '2025-11-01' }),
    car('BOOKED', { status: 'Completed', booking_date: '2025-12-05' }),
    car('BOOKED', { status: 'Booked', booking_date: '2026-11-30' }),
    car('LATER', { status: 'Completed', booking_date: '2026-06-01' }),
    car('GONE', { status: 'Cancelled', booking_date: '2025-12-02' }),
  ];
  const due = motDueList(jobs, '2026-11-16', 60);
  assert.deepEqual(due.map((item) => [item.contact.reg_no, item.due, item.overdue]), [['OLD1', '2026-11-01', true], ['DUE1', '2026-12-01', false]]);
});

test('spreadsheet export escapes text and hides prices without permission', () => {
  const job = { booking_date: '2099-01-07', booking_time: '10:30:00', status: 'Booked', amount_due: 45, payment_status: 'Unpaid', service_type: '=HYPERLINK("x")', customer_address: '1 High St\nNewport', vehicle: { reg_no: 'AB12CDE', make: 'Ford', model: 'Focus', customer: { first_name: 'James', last_name: 'Taylor, Jr', phone: '07700900123' } } };
  const withCosts = jobsCsv([job], true);
  assert.ok(withCosts.startsWith('﻿Booking date'));
  assert.match(withCosts, /"'=HYPERLINK\(""x""\)"/);
  assert.match(withCosts, /"James Taylor, Jr"/);
  assert.match(withCosts, /45\.00,Unpaid/);
  assert.doesNotMatch(jobsCsv([job], false), /Amount due|45\.00/);
});
