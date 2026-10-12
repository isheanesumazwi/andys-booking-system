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
