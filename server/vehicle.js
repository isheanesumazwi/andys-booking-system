import { normalizeRegistration, validRegistration } from '../src/utils.js';

const tokenCaches = new WeakMap();
const dvsaScope = 'https://tapi.dvsa.gov.uk/.default';
const dvlaEnquiryUrl = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';

class DvsaError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function dvsaToken(env, fetcher, refresh = false) {
  let url;
  try {
    url = new URL(env.DVSA_TOKEN_URL);
  } catch {
    throw new DvsaError('DVSA_TOKEN_URL_INVALID');
  }
  if (url.origin !== 'https://login.microsoftonline.com' || !/^\/[a-f\d-]{36}\/oauth2\/v2\.0\/token$/i.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new DvsaError('DVSA_TOKEN_URL_INVALID');
  }
  if (env.DVSA_SCOPE_URL !== dvsaScope) throw new DvsaError('DVSA_SCOPE_INVALID');
  const key = JSON.stringify([env.DVSA_CLIENT_ID, env.DVSA_CLIENT_SECRET, url.href, env.DVSA_SCOPE_URL]);
  let cache = tokenCaches.get(fetcher);
  if (!cache || cache.key !== key || (refresh && !cache.pending)) {
    cache = { key, expiresAt: 0, token: null, pending: null };
    tokenCaches.set(fetcher, cache);
  }
  if (cache.token && cache.expiresAt > Date.now()) return cache.token;
  if (!cache.pending) {
    cache.pending = (async () => {
      let response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DVSA_CLIENT_ID, client_secret: env.DVSA_CLIENT_SECRET, scope: env.DVSA_SCOPE_URL }).toString(),
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new DvsaError('DVSA_AUTH_CONNECTION_FAILED');
      }
      if (!response.ok) throw new DvsaError('DVSA_AUTH_REJECTED', response.status);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new DvsaError('DVSA_AUTH_RESPONSE_INVALID');
      }
      if (!data || typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') {
        throw new DvsaError('DVSA_AUTH_RESPONSE_INVALID');
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
  let failureCode = 'DVSA_LOOKUP_CONNECTION_FAILED';
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
    if (!response.ok) throw new DvsaError('DVSA_LOOKUP_REJECTED', response.status);
    failureCode = 'DVSA_VEHICLE_RESPONSE_INVALID';
    return { status: 200, body: parseVehicle(await response.json()) };
  } catch (error) {
    // Provider bodies and fetch errors can contain credentials; never log them.
    const code = error instanceof DvsaError ? error.code : failureCode;
    const upstreamStatus = error instanceof DvsaError ? error.status : null;
    console.error('DVSA vehicle lookup failed:', { code, upstreamStatus });
    return { status: 502, body: { error: `Vehicle lookup is unavailable (${code}). Please enter your make and model manually.`, code } };
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
  const latestTest = Array.isArray(data.motTests)
    ? [...data.motTests].sort((left, right) => String(right.completedDate || '').localeCompare(String(left.completedDate || '')))[0]
    : null;
  return {
    make: make.trim().slice(0, 100),
    model: model.trim().slice(0, 100),
    year: Number.isInteger(year) && year >= 1886 && year <= new Date().getFullYear() + 1 ? year : null,
    engine_capacity: typeof capacity === 'string' || typeof capacity === 'number' ? String(capacity).slice(0, 50) : null,
    fuel_type: typeof (data.fuelType ?? data.fuel_type) === 'string' ? (data.fuelType ?? data.fuel_type).slice(0, 50) : null,
    colour: typeof (data.primaryColour ?? data.colour ?? data.color) === 'string' ? (data.primaryColour ?? data.colour ?? data.color).slice(0, 50) : null,
    mot_status: typeof latestTest?.testResult === 'string' ? latestTest.testResult.slice(0, 50) : null,
    mot_expiry_date: typeof latestTest?.expiryDate === 'string' ? latestTest.expiryDate : null,
    tax_status: null,
    tax_due_date: null,
    tax_lookup_configured: false,
    tax_lookup_error: false,
  };
}

function parseDvlaVehicle(payload) {
  const year = Number(payload?.yearOfManufacture);
  const capacity = payload?.engineCapacity;
  return {
    make: typeof payload?.make === 'string' ? payload.make.trim().slice(0, 100) : null,
    model: null,
    year: Number.isInteger(year) && year >= 1886 && year <= new Date().getFullYear() + 1 ? year : null,
    engine_capacity: typeof capacity === 'string' || typeof capacity === 'number' ? String(capacity).slice(0, 50) : null,
    fuel_type: typeof payload?.fuelType === 'string' ? payload.fuelType.slice(0, 50) : null,
    colour: typeof payload?.colour === 'string' ? payload.colour.slice(0, 50) : null,
    mot_status: typeof payload?.motStatus === 'string' ? payload.motStatus.slice(0, 50) : null,
    mot_expiry_date: typeof payload?.motExpiryDate === 'string' ? payload.motExpiryDate : null,
    tax_status: typeof payload?.taxStatus === 'string' ? payload.taxStatus.slice(0, 50) : null,
    tax_due_date: typeof payload?.taxDueDate === 'string' ? payload.taxDueDate : null,
    tax_lookup_configured: true,
    tax_lookup_error: false,
  };
}

async function dvlaLookup(registration, apiKey, fetcher) {
  const response = await fetcher(dvlaEnquiryUrl, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ registrationNumber: registration }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) {
    console.error('DVLA vehicle enquiry HTTP error:', response.status);
    return { status: 502 };
  }
  return { status: 200, body: parseDvlaVehicle(await response.json()) };
}

export async function vehicleLookup(method, registration, env, fetcher = fetch) {
  if (method !== 'GET') return { status: 405, body: { error: 'Only GET requests are supported.' } };
  if (typeof registration !== 'string' || !validRegistration(registration)) {
    return { status: 400, body: { error: 'Enter a valid vehicle registration.' } };
  }
  const provider = env.VEHICLE_API_PROVIDER || (env.DVSA_CLIENT_ID ? 'dvsa' : 'rapidapi');
  const reg = normalizeRegistration(registration);
  let result;
  if (provider === 'dvsa') {
    result = await dvsaLookup(reg, env, fetcher);
  } else if (provider !== 'rapidapi') {
    result = { status: 503, body: { error: 'Vehicle lookup provider is not configured correctly. Please enter your vehicle details manually.' } };
  } else if (!env.VEHICLE_API_URL || !env.RAPIDAPI_KEY) {
    result = { status: 503, body: { error: 'Vehicle lookup is not configured yet. Please enter your make and model manually.' } };
  } else {
    try {
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
        result = { status: 502, body: { error: 'The vehicle provider could not complete the lookup. Please enter the details manually.' } };
      } else {
        result = { status: 200, body: parseVehicle(await response.json()) };
      }
    } catch (error) {
      console.error('Vehicle lookup failed:', error.message);
      result = { status: 502, body: { error: 'Vehicle lookup failed. Please enter the make and model manually.' } };
    }
  }

  if (!env.DVLA_VES_API_KEY) return result;
  try {
    const enquiry = await dvlaLookup(reg, env.DVLA_VES_API_KEY, fetcher);
    if (enquiry.status === 200) {
      return {
        status: 200,
        body: {
          ...(result.status === 200 ? result.body : {}),
          ...enquiry.body,
          model: result.status === 200 ? result.body.model : null,
          year: enquiry.body.year ?? (result.status === 200 ? result.body.year : null),
          engine_capacity: enquiry.body.engine_capacity ?? (result.status === 200 ? result.body.engine_capacity : null),
          fuel_type: enquiry.body.fuel_type ?? (result.status === 200 ? result.body.fuel_type : null),
          colour: enquiry.body.colour ?? (result.status === 200 ? result.body.colour : null),
          mot_status: enquiry.body.mot_status ?? (result.status === 200 ? result.body.mot_status : null),
          mot_expiry_date: enquiry.body.mot_expiry_date ?? (result.status === 200 ? result.body.mot_expiry_date : null),
        },
      };
    }
    if (result.status === 200) return { ...result, body: { ...result.body, tax_lookup_configured: true, tax_lookup_error: true } };
  } catch {
    console.error('DVLA vehicle enquiry failed. Check the VES API key and provider availability.');
    if (result.status === 200) return { ...result, body: { ...result.body, tax_lookup_configured: true, tax_lookup_error: true } };
  }
  return result;
}
