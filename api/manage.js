import { manageBooking } from '../server/bookings.js';
import { gmailSender } from '../server/mail.js';

export default async function handler(req, res) {
  const site = process.env.SITE_URL || `https://${req.headers.host}`;
  const result = await manageBooking(req.method, req.query?.t, req.body, process.env, { send: gmailSender(process.env), site });
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'GET, POST');
  res.status(result.status).json(result.body);
}
