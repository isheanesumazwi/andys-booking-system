import { addressLookup } from '../../server/address.js';

export default async function handler(request) {
  const postcode = new URL(request.url).searchParams.get('postcode');
  const result = await addressLookup(request.method, postcode, process.env);
  return Response.json(result.body, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.status === 405 ? { Allow: 'GET' } : {}),
    },
  });
}

export const config = { path: '/api/address' };
