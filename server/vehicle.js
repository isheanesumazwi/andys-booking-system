import { normalizeRegistration, validRegistration } from '../src/utils.js';

const tokenCaches = new WeakMap();
const dvsaScope = 'https://tapi.dvsa.gov.uk/.default';

async function dvsaToken(env, fetcher, refresh = false) {
  const url = new URL(env.DVSA_TOKEN_URL);
  if (url.origin !== 'https://login.microsoftonline.com' || !/^\/[a-f\d-]{36}\/oauth2\/v2\.0\/token$/i.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid DVSA token URL configuration.');
  }
  if (env.DVSA_SCOPE_URL !== dvsaScope) throw new Error('Invalid DVSA scope configuration.');
  const key = JSON.stringify([env.DVSA_CLIENT_ID, env.DVSA_CLIENT_SECRET, url.href, env.DVSA_SCOPE_URL]);
  let cache = tokenCaches.get(fetcher);
  if (!cache || cache.key !== key || (refresh && !cache.pending)) {
    cache = { key, expiresAt: 0, token: null, pending: null };
    tokenCaches.set(fetcher, cache);
  }
  if (cache.token && cache.expiresAt > Date.now()) return cache.token;
  if (!cache.pending) {
    cache.pending = (async () => {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DVSA_CLIENT_ID, client_secret: env.DVSA_CLIENT_SECRET, scope: env.DVSA_SCOPE_URL }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`DVSA authentication HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || data.token_type?.toLowerCase() !== 'bearer') {
        throw new Error('Invalid DVSA authentication response.');
      }
      cache.token = data.access_token;
      cache.expiresAt = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
      return cache.token;
    })();
  }
  try { return await cache.pending; }
  finally { cache.pending = null; }
}

async function dvsaLookup(registration, env, fetcher) {
  if (![env.DVSA_CLIENT_ID, env.DVSA_CLIENT_SECRET, env.DVSA_API_KEY, env.DVSA_SCOPE_URL, env.DVSA_TOKEN_URL].every((value) => typeof value === 'string' && value.trim())) {
    return { status: 503, body: { error: 'Vehicle lookup is not configured yet. Please enter your make and model manually.' } };
  }
  try {
    const url = new URL(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`);
    const request = async (refresh) => fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await dvsaToken(env, fetcher, refresh)}`, 'X-API-Key': env.DVSA_API_KEY, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    let response = await request(false);
    if (response.status === 401) response = await request(true);
    if (response.status === 404) return { status: 404, body: { error: 'No vehicle was found in the MOT history service. Please enter your make and model manually.' } };
    if (response.status === 429) return { status: 429, body: { error: 'The vehicle lookup service is busy. Please try again later or enter your details manually.' } };
    if (!response.ok) throw new Error(`DVSA vehicle lookup HTTP ${response.status}`);
    return { status: 200, body: parseVehicle(await response.json()) };
  } catch {
    // Provider bodies and fetch errors can contain credentials; never log them.
    console.error('DVSA vehicle lookup failed. Check server configuration and provider availability.');
    return { status: 502, body: { error: 'Vehicle lookup is unavailable. Please enter your make and model manually.' } };
  }
}

export function parseVehicle(payload) {
  const data = payload?.data?.vehicle ?? payload?.data ?? payload?.vehicle ?? payload?.VehicleDetails ?? payload;
  const make = data?.make ?? data?.Make ?? data?.CarMake?.CurrentTextValue;
  const model = data?.model ?? data?.Model ?? data?.CarModel?.CurrentTextValue;
  if (typeof make !== 'string' || typeof model !== 'string' || !make.trim() || !model.trim()) {
    throw new Error('The provider response did not contain a vehicle make and model.');
  }
  const rawYear = data.year ?? data.Year ?? data.yearOfManufacture ?? data.ManufactureYear ?? data.manufactureYear ?? data.manufactureDate?.slice(0, 4);
  const year = Number(rawYear);
  const capacity = data.engine_capacity ?? data.engineCapacity ?? data.EngineCapacity ?? data.engineSize ?? null;
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
  const provider = env.VEHICLE_API_PROVIDER || (env.DVSA_CLIENT_ID ? 'dvsa' : 'rapidapi');
  if (provider === 'dvsa') return dvsaLookup(normalizeRegistration(registration), env, fetcher);
  if (provider !== 'rapidapi') return { status: 503, body: { error: 'Vehicle lookup provider is not configured correctly. Please enter your vehicle details manually.' } };
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
