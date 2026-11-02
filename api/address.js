import { addressLookup } from '../server/address.js';

export default async function handler(req, res) {
  const result = await addressLookup(req.method, req.query.postcode, process.env);
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'GET');
  res.status(result.status).json(result.body);
}
