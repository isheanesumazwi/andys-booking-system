import { submitFeedback } from '../server/feedback.js';
import { gmailSender } from '../server/mail.js';

export default async function handler(req, res) {
  const site = process.env.SITE_URL || `https://${req.headers.host}`;
  const result = await submitFeedback(req.method, req.body, process.env, { send: gmailSender(process.env), site });
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'POST');
  res.status(result.status).json(result.body);
}
