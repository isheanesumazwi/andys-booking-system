import { customerEmail, workshopEmail, workshopInbox } from './mail.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_FIELDS = ['first_name', 'last_name', 'phone', 'email', 'reg_no', 'make', 'model', 'year', 'engine_capacity',
  'booking_date', 'booking_time', 'service_type', 'customer_address', 'customer_postcode', 'change_request', 'privacy_accepted'];

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function connection(env) {
  return { url: env.SUPABASE_URL || env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

// Messages raised by our database functions are written for customers, so they are passed on.
export async function rpc(url, key, name, args, fetcher, authorization = `Bearer ${key}`) {
  const response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  if (data?.code === 'P0001' && data.message) throw new UserError(data.message);
  const error = new Error(`RPC_${name}_FAILED`);
  error.code = data?.code;
  throw error;
}

function failure(err, label) {
  if (err instanceof UserError) return { status: err.status, body: { error: err.message } };
  console.error(`${label} failed: ${err.message}`);
  return { status: 502, body: { error: 'The booking service is unavailable. Please try again or call the workshop.' } };
}

// Email is a courtesy: a failed send never undoes a booking.
async function deliver(send, messages) {
  if (!send) return;
  for (const message of messages) {
    if (!message.to) continue;
    try { await send(message); } catch (err) { console.error(`Email failed: ${err.message}`); }
  }
}

export async function passedSecurityCheck(token, env, fetcher) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
  });
  return response.ok && (await response.json()).success === true;
}

export async function bookOnline(method, body, env, { fetcher = fetch, send = null, site = '' } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const { url, anonKey, serviceKey } = connection(env);
  if (!url || !anonKey) return { status: 503, body: { error: 'Online booking is not set up yet. Please call the workshop.' } };
  // People never see the trap field, so anything typed in it came from a bot. It gets a normal-looking reply.
  if (typeof body?.company === 'string' && body.company.trim()) return { status: 200, body: { status: 'Pending Confirmation' } };
  const details = Object.fromEntries(BOOKING_FIELDS.filter((key) => body?.details?.[key] !== undefined).map((key) => [key, body.details[key]]));
  try {
    if (!(await passedSecurityCheck(body?.turnstile_token, env, fetcher))) throw new UserError('Please complete the security check and try again.');
    if (!serviceKey) return { status: 200, body: { status: await rpc(url, anonKey, 'create_booking', { p_details: details }, fetcher) } };
    let booking;
    try {
      booking = await rpc(url, serviceKey, 'book_online', { p_details: details }, fetcher);
    } catch (err) {
      // Until owner-tools.sql is run the database only has the older public function.
      if (err.code !== 'PGRST202') throw err;
      const { privacy_accepted: _, ...older } = details;
      return { status: 200, body: { status: await rpc(url, anonKey, 'create_booking', { p_details: older }, fetcher) } };
    }
    if (booking.status === 'Already Booked') return { status: 200, body: { status: booking.status } };
    await deliver(send, [customerEmail('booked', booking, site), workshopEmail('booked', booking, site, workshopInbox(env))]);
    return { status: 200, body: { status: booking.status, token: booking.token, emailed: Boolean(send && booking.email), booking } };
  } catch (err) { return failure(err, 'Online booking'); }
}

export async function manageBooking(method, token, body, env, { fetcher = fetch, send = null, site = '' } = {}) {
  if (method !== 'GET' && method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const { url, serviceKey } = connection(env);
  if (!url || !serviceKey) return { status: 503, body: { error: 'Online changes are not set up yet. Please call the workshop.' } };
  const key = method === 'GET' ? token : body?.token;
  if (typeof key !== 'string' || !UUID.test(key)) return { status: 404, body: { error: 'This booking link is not valid.' } };
  try {
    if (method === 'GET') {
      const booking = await rpc(url, serviceKey, 'booking_by_token', { p_token: key }, fetcher);
      return booking ? { status: 200, body: { booking } } : { status: 404, body: { error: 'This booking link is not valid.' } };
    }
    let booking;
    if (body.action === 'cancel') booking = await rpc(url, serviceKey, 'cancel_booking_by_token', { p_token: key }, fetcher);
    else if (body.action === 'move') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !/^\d{2}:\d{2}$/.test(body.time || '')) throw new UserError('Please choose a date and time.');
      booking = await rpc(url, serviceKey, 'move_booking_by_token', { p_token: key, p_date: body.date, p_time: body.time }, fetcher);
    } else throw new UserError('Unknown action.');
    const kind = body.action === 'cancel' ? 'cancelled' : 'moved';
    await deliver(send, [customerEmail(kind, { ...booking, token: key }, site), workshopEmail(kind, booking, site, workshopInbox(env))]);
    return { status: 200, body: { booking } };
  } catch (err) { return failure(err, 'Booking change'); }
}

// Staff emails go only to the address on the booking, and only from people who manage bookings.
export async function notifyCustomer(method, authorization, body, env, { fetcher = fetch, send = null, site = '' } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const { url, anonKey, serviceKey } = connection(env);
  if (!url || !anonKey || !serviceKey) return { status: 503, body: { error: 'Emails are not set up yet. Add SUPABASE_SERVICE_ROLE_KEY to the hosting settings.' } };
  if (!send) return { status: 503, body: { error: 'Emails are not set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD to the hosting settings.' } };
  if (!/^Bearer \S+$/.test(authorization || '')) return { status: 401, body: { error: 'Please sign in again.' } };
  const jobId = Number(body?.job_id);
  const kind = body?.kind === 'confirmed' ? 'confirmed' : 'update';
  if (!Number.isSafeInteger(jobId) || jobId < 1) return { status: 400, body: { error: 'Choose a booking.' } };
  try {
    if ((await rpc(url, anonKey, 'has_permission', { p_permission: 'bookings_manage' }, fetcher, authorization)) !== true) {
      throw new UserError('You do not have permission to email customers.', 403);
    }
    const booking = await rpc(url, serviceKey, 'booking_email_details', { p_job_id: jobId }, fetcher);
    if (!booking.email) throw new UserError('This booking has no email address.');
    if (!booking.booking_time) throw new UserError('Set a time on the booking before emailing the customer.');
    await send(customerEmail(kind, booking, site));
    return { status: 200, body: { ok: true, to: booking.email } };
  } catch (err) {
    if (err instanceof UserError) return { status: err.status, body: { error: err.message } };
    console.error(`Customer email failed: ${err.message}`);
    return { status: 502, body: { error: 'The email could not be sent. Please try again.' } };
  }
}
