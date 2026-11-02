import { staffAccount } from '../../server/staff.js';

export default async function handler(request) {
  const body = await request.json().catch(() => null);
  const result = await staffAccount(request.method, request.headers.get('authorization'), body, process.env);
  return Response.json(result.body, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.status === 405 ? { Allow: 'POST' } : {}),
    },
  });
}

export const config = { path: '/api/staff' };
