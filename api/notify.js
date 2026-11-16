import { notifyCustomer } from '../server/bookings.js';
import { gmailSender } from '../server/mail.js';

export default async function handler(req, res) {
  const site = process.env.SITE_URL || `https://${req.headers.host}`;
  const result = await notifyCustomer(req.method, req.headers.authorization, req.body, process.env, { send: gmailSender(process.env), site });
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'POST');
  res.status(result.status).json(result.body);
}
