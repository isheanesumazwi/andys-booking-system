import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { config } from '../netlify/functions/vehicle.mjs';

test('Netlify function preserves the frontend API route', () => {
  assert.equal(config.path, '/api/vehicle');
});

test('Netlify function returns JSON validation errors without caching', async () => {
  const response = await handler(new Request('https://example.netlify.app/api/vehicle?registration=!!'));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.match((await response.json()).error, /registration/);
});

test('Netlify function rejects unsupported methods with Allow header', async () => {
  const response = await handler(new Request('https://example.netlify.app/api/vehicle', { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET');
});
