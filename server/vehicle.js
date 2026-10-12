import { normalizeRegistration, validRegistration } from '../src/utils.js';

export function parseVehicle(payload) {
  const data = payload?.data?.vehicle ?? payload?.data ?? payload?.vehicle ?? payload?.VehicleDetails ?? payload;
  const make = data?.make ?? data?.Make ?? data?.CarMake?.CurrentTextValue;
  const model = data?.model ?? data?.Model ?? data?.CarModel?.CurrentTextValue;
  if (typeof make !== 'string' || typeof model !== 'string' || !make.trim() || !model.trim()) {
    throw new Error('The provider response did not contain a vehicle make and model.');
  }
  const rawYear = data.year ?? data.Year ?? data.yearOfManufacture ?? data.ManufactureYear;
  const year = Number(rawYear);
  const capacity = data.engine_capacity ?? data.engineCapacity ?? data.EngineCapacity ?? null;
  return {
    make: make.trim().slice(0, 100),
    model: model.trim().slice(0, 100),
    year: Number.isInteger(year) && year >= 1886 && year <= new Date().getFullYear() + 1 ? year : null,
    engine_capacity: typeof capacity === 'string' || typeof capacity === 'number' ? String(capacity).slice(0, 50) : null,
  };
}

export async function vehicleLookup(method, registration, env, fetcher = fetch) {
  if (method !== 'GET') return { status: 405, body: { error: 'Only GET requests are supported.' } };
  if (typeof registration !== 'string' || !validRegistration(registration)) {
    return { status: 400, body: { error: 'Enter a valid vehicle registration.' } };
  }
  if (!env.VEHICLE_API_URL || !env.RAPIDAPI_KEY) {
    return { status: 503, body: { error: 'Vehicle lookup is not configured yet. Please enter your make and model manually.' } };
  }
  try {
    const reg = normalizeRegistration(registration);
    const url = new URL(env.VEHICLE_API_URL.replaceAll('{registration}', encodeURIComponent(reg)));
    const host = env.RAPIDAPI_HOST || 'uk-vehicle-data1.p.rapidapi.com';
    if (url.protocol !== 'https:' || url.hostname !== host || !host.endsWith('.p.rapidapi.com')) {
      throw new Error('Vehicle API URL must use HTTPS and the configured RapidAPI host.');
    }
    const upstreamMethod = env.VEHICLE_API_METHOD || 'GET';
    if (!['GET', 'POST'].includes(upstreamMethod)) throw new Error('Vehicle API method must be GET or POST.');
    const body = upstreamMethod === 'POST' ? env.VEHICLE_API_BODY?.replaceAll('{registration}', reg) : undefined;
    if (upstreamMethod === 'POST') {
      if (!body) throw new Error('POST vehicle lookup requires VEHICLE_API_BODY.');
      JSON.parse(body);
    }
    const response = await fetcher(url, {
      method: upstreamMethod,
      headers: { 'X-RapidAPI-Key': env.RAPIDAPI_KEY, 'X-RapidAPI-Host': host, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('Vehicle provider HTTP error:', response.status);
      return { status: 502, body: { error: 'The vehicle provider could not complete the lookup. Please enter the details manually.' } };
    }
    return { status: 200, body: parseVehicle(await response.json()) };
  } catch (error) {
    console.error('Vehicle lookup failed:', error.message);
    return { status: 502, body: { error: 'Vehicle lookup failed. Please enter the make and model manually.' } };
  }
}
