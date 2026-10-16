import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVehicle, vehicleLookup } from '../server/vehicle.js';

const env = { RAPIDAPI_KEY: 'test-key', RAPIDAPI_HOST: 'uk-vehicle-data1.p.rapidapi.com', VEHICLE_API_URL: 'https://uk-vehicle-data1.p.rapidapi.com/lookup?registration={registration}' };
test('parses common provider response shapes without leaking provider payload', () => {
  assert.deepEqual(parseVehicle({ data: { make: 'Ford', model: 'Focus', yearOfManufacture: '2018', engineCapacity: 1598, secret: 'ignored' } }), { make: 'Ford', model: 'Focus', year: 2018, engine_capacity: '1598' });
  assert.equal(parseVehicle({ CarMake: { CurrentTextValue: 'Volkswagen' }, CarModel: { CurrentTextValue: 'Golf' } }).model, 'Golf');
  assert.throws(() => parseVehicle({ error: 'not found' }));
});
test('rejects unsupported methods and invalid registration without provider calls', async () => {
  const fetcher = () => { throw new Error('Must not call provider'); };
  assert.equal((await vehicleLookup('POST', 'AB12CDE', env, fetcher)).status, 405);
  assert.equal((await vehicleLookup('GET', '../../', env, fetcher)).status, 400);
});
test('unconfigured lookup explicitly supports manual entry', async () => {
  const result = await vehicleLookup('GET', 'AB12CDE', {});
  assert.equal(result.status, 503);
  assert.match(result.body.error, /manually/);
});
test('requests encoded registration with secret only in server headers', async () => {
  const result = await vehicleLookup('GET', 'ab12 cde', env, async (url, options) => {
    assert.equal(url.searchParams.get('registration'), 'AB12CDE');
    assert.equal(options.headers['X-RapidAPI-Key'], 'test-key');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ make: 'Ford', model: 'Focus' }) };
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.make, 'Ford');
  assert.equal('secret' in result.body, false);
});
test('POST provider uses configured body and normalized registration', async () => {
  const result = await vehicleLookup('GET', 'ab12 cde', { ...env, VEHICLE_API_METHOD: 'POST', VEHICLE_API_BODY: '{"registration":"{registration}"}' }, async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).registration, 'AB12CDE');
    return { ok: true, json: async () => ({ Make: 'Ford', Model: 'Focus' }) };
  });
  assert.equal(result.status, 200);
});
test('provider failures are explicit errors, not successful empty vehicles', async () => {
  assert.equal((await vehicleLookup('GET', 'AB12CDE', env, async () => ({ ok: false, status: 429 }))).status, 502);
  assert.equal((await vehicleLookup('GET', 'AB12CDE', env, async () => ({ ok: true, json: async () => ({}) }))).status, 502);
});
test('never sends credentials to a mismatched host', async () => {
  let called = false;
  const result = await vehicleLookup('GET', 'AB12CDE', { ...env, VEHICLE_API_URL: 'https://example.com/' }, async () => { called = true; });
  assert.equal(result.status, 502);
  assert.equal(called, false);
});

const dvsa = {
  VEHICLE_API_PROVIDER: 'dvsa',
  DVSA_CLIENT_ID: 'test-client',
  DVSA_CLIENT_SECRET: 'test+secret&with=symbols',
  DVSA_API_KEY: 'test-api-key',
  DVSA_SCOPE_URL: 'https://tapi.dvsa.gov.uk/.default',
  DVSA_TOKEN_URL: 'https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token',
};
const tokenResponse = (token = 'test-token', expires_in = 3600) => ({ ok: true, status: 200, json: async () => ({ token_type: 'Bearer', access_token: token, expires_in }) });
const dvsaVehicle = { registration: 'AB12CDE', make: 'FORD', model: 'FOCUS', manufactureDate: '2018-04-01', engineSize: '1598', motTests: [{ private: 'not returned' }] };
const vehicleResponse = () => ({ ok: true, status: 200, json: async () => dvsaVehicle });

test('DVSA uses client credentials, official endpoint, and server-only headers with cached token', async () => {
  let tokens = 0;
  let lookups = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.hostname === 'login.microsoftonline.com') {
      tokens++;
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'client_credentials');
      assert.equal(body.get('client_secret'), dvsa.DVSA_CLIENT_SECRET);
      assert.equal(body.get('client_id'), dvsa.DVSA_CLIENT_ID);
      assert.equal(body.get('scope'), dvsa.DVSA_SCOPE_URL);
      return tokenResponse();
    }
    lookups++;
    assert.equal(url.href, 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/AB12CDE');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.headers['X-API-Key'], dvsa.DVSA_API_KEY);
    return vehicleResponse();
  };
  const results = await Promise.all([vehicleLookup('GET', 'ab12 cde', dvsa, fetcher), vehicleLookup('GET', 'AB12CDE', dvsa, fetcher)]);
  assert.equal(tokens, 1);
  assert.equal(lookups, 2);
  for (const result of results) assert.deepEqual(result, { status: 200, body: { make: 'FORD', model: 'FOCUS', year: 2018, engine_capacity: '1598' } });
  await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher);
  assert.equal(tokens, 1);
});
test('DVSA missing configuration, untrusted token URLs and scopes never send credentials', async () => {
  let called = false;
  const fetcher = async () => { called = true; throw new Error('Unexpected request'); };
  assert.equal((await vehicleLookup('GET', 'AB12CDE', { ...dvsa, DVSA_API_KEY: '' }, fetcher)).status, 503);
  for (const patch of [
    { DVSA_TOKEN_URL: 'https://example.com/token' },
    { DVSA_TOKEN_URL: `${dvsa.DVSA_TOKEN_URL}?redirect=https://example.com` },
    { DVSA_TOKEN_URL: dvsa.DVSA_TOKEN_URL.replace('https:', 'http:') },
    { DVSA_SCOPE_URL: 'https://example.com/.default' },
  ]) assert.equal((await vehicleLookup('GET', 'AB12CDE', { ...dvsa, ...patch }, fetcher)).status, 502);
  assert.equal(called, false);
});
test('DVSA retries once with a fresh token on 401', async () => {
  let tokens = 0;
  let lookups = 0;
  const fetcher = async (url, options) => {
    if (url.hostname === 'login.microsoftonline.com') return tokenResponse(`token-${++tokens}`);
    lookups++;
    if (lookups === 1) return { ok: false, status: 401 };
    assert.equal(options.headers.Authorization, 'Bearer token-2');
    return vehicleResponse();
  };
  assert.equal((await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher)).status, 200);
  assert.equal(tokens, 2);
  assert.equal(lookups, 2);
});
test('DVSA handles not found, throttling, upstream and authentication failures without secrets', async () => {
  for (const status of [404, 429, 403, 500, 401]) {
    const fetcher = async (url) => url.hostname === 'login.microsoftonline.com' ? tokenResponse() : { ok: false, status };
    const result = await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher);
    assert.equal(result.status, [404, 429].includes(status) ? status : 502);
    assert.match(result.body.error, /manually/);
    assert.equal(JSON.stringify(result).includes('test-token'), false);
  }
  for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({ access_token: 'test-token' }) }]) {
    assert.equal((await vehicleLookup('GET', 'AB12CDE', dvsa, async () => response)).status, 502);
  }
});
test('DVSA expired tokens are renewed and failed authentication is not cached', async () => {
  let tokens = 0;
  const fetcher = async (url) => {
    if (url.hostname !== 'login.microsoftonline.com') return vehicleResponse();
    tokens++;
    return tokens === 1 ? { ok: false, status: 503 } : tokenResponse('short-lived', 1);
  };
  assert.equal((await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher)).status, 502);
  assert.equal((await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher)).status, 200);
  assert.equal((await vehicleLookup('GET', 'AB12CDE', dvsa, fetcher)).status, 200);
  assert.equal(tokens, 3);
});
