import { vehicleLookup } from '../server/vehicle.js';

export default async function handler(req, res) {
  const result = await vehicleLookup(req.method, req.query.registration, process.env);
  res.setHeader('Cache-Control', 'no-store');
  if (result.status === 405) res.setHeader('Allow', 'GET');
  res.status(result.status).json(result.body);
}
