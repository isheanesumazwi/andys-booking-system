import { manageBooking } from '../../server/bookings.js';
import { gmailSender } from '../../server/mail.js';

export default async function handler(request) {
  const url = new URL(request.url);
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const site = process.env.SITE_URL || process.env.URL || url.origin;
  const result = await manageBooking(request.method, url.searchParams.get('t'), body, process.env, { send: gmailSender(process.env), site });
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.status === 405 ? { Allow: 'GET, POST' } : {}) } });
}

export const config = { path: '/api/manage' };
