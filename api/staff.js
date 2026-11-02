import { staffAccount } from '../server/staff.js';

export default async function handler(req, res) {
  const result = await staffAccount(req.method, req.headers.authorization, req.body, process.env);
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'POST');
  res.status(result.status).json(result.body);
}
