import { normalizePostcode, validPostcode } from '../src/utils.js';

const manual = 'Please enter your address manually.';

// Full address lists need a paid provider. Without a key the postcode is still checked
// and the town filled in, and the customer types the rest.
async function idealPostcodes(postcode, env, fetcher) {
  const url = new URL(`https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(postcode)}`);
  url.searchParams.set('api_key', env.IDEAL_POSTCODES_API_KEY);
  url.searchParams.set('filter', 'line_1,line_2,line_3,post_town,postcode');
  const response = await fetcher(url);
  if (response.status === 404) return { status: 404, body: { error: `We couldn't find that postcode. ${manual}` } };
  if (!response.ok) throw new Error('ADDRESS_PROVIDER_FAILED');
  const { result } = await response.json();
  const addresses = result.map((item) => ({ line_1: item.line_1, line_2: [item.line_2, item.line_3].filter(Boolean).join(', '), town: item.post_town, postcode: item.postcode }));
  return { status: 200, body: { postcode: addresses[0]?.postcode || postcode, town: addresses[0]?.town || '', addresses } };
}

async function postcodesIo(postcode, fetcher) {
  const response = await fetcher(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  if (response.status === 404) return { status: 404, body: { error: `We couldn't find that postcode. ${manual}` } };
  if (!response.ok) throw new Error('POSTCODE_CHECK_FAILED');
  const { result } = await response.json();
  return { status: 200, body: { postcode: result.postcode, town: result.admin_district || '', addresses: [] } };
}

export async function addressLookup(method, postcode, env, fetcher = fetch) {
  if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed.' } };
  const normalized = normalizePostcode(postcode || '');
  if (!validPostcode(normalized)) return { status: 400, body: { error: 'Please enter a valid UK postcode.' } };
  try {
    if (env.IDEAL_POSTCODES_API_KEY) return await idealPostcodes(normalized, env, fetcher);
  } catch {
    console.error('Address provider lookup failed; falling back to postcode check.');
  }
  try {
    return await postcodesIo(normalized, fetcher);
  } catch {
    return { status: 503, body: { error: `Address lookup is unavailable right now. ${manual}` } };
  }
}
