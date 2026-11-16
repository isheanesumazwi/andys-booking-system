import { notifyCustomer } from '../../server/bookings.js';
import { gmailSender } from '../../server/mail.js';

export default async function handler(request) {
  const body = await request.json().catch(() => null);
  const site = process.env.SITE_URL || process.env.URL || new URL(request.url).origin;
  const result = await notifyCustomer(request.method, request.headers.get('authorization'), body, process.env, { send: gmailSender(process.env), site });
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.status === 405 ? { Allow: 'POST' } : {}) } });
}

export const config = { path: '/api/notify' };
