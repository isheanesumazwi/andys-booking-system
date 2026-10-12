import { vehicleLookup } from '../../server/vehicle.js';

export default async function handler(request) {
  const registration = new URL(request.url).searchParams.get('registration');
  const result = await vehicleLookup(request.method, registration, process.env);
  return Response.json(result.body, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.status === 405 ? { Allow: 'GET' } : {}),
    },
  });
}

export const config = { path: '/api/vehicle' };
