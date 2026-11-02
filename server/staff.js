const json = (headers) => ({ 'Content-Type': 'application/json', ...headers });

async function isAdmin(url, anonKey, authorization, fetcher) {
  const response = await fetcher(`${url}/rest/v1/rpc/has_permission`, {
    method: 'POST',
    headers: json({ apikey: anonKey, Authorization: authorization }),
    body: JSON.stringify({ p_permission: 'admin' }),
  });
  return response.ok && (await response.json()) === true;
}

// Creating logins and setting passwords needs the service key, which never reaches the browser.
export async function staffAccount(method, authorization, body, env, fetcher = fetch) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return { status: 503, body: { error: 'Creating logins is not set up yet. Add SUPABASE_SERVICE_ROLE_KEY to the hosting settings.' } };
  }
  if (!/^Bearer \S+$/.test(authorization || '')) return { status: 401, body: { error: 'Please sign in again.' } };
  const { action, email, password, user_id: userId } = body || {};
  if (typeof password !== 'string' || password.length < 10 || password.length > 72) {
    return { status: 400, body: { error: 'Passwords must be 10 to 72 characters.' } };
  }
  const service = json({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
  try {
    if (!(await isAdmin(url, anonKey, authorization, fetcher))) return { status: 403, body: { error: 'You do not have permission to manage users.' } };
    if (action === 'create') {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { status: 400, body: { error: 'Please enter a valid email address.' } };
      const response = await fetcher(`${url}/auth/v1/admin/users`, { method: 'POST', headers: service, body: JSON.stringify({ email: email.trim(), password, email_confirm: true }) });
      if (response.status === 422) return { status: 409, body: { error: 'That email already has a login. Leave the password blank to add it to the team.' } };
      if (!response.ok) throw new Error('STAFF_ACCOUNT_CREATE_FAILED');
      return { status: 200, body: { ok: true } };
    }
    if (action === 'reset') {
      if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return { status: 400, body: { error: 'Choose a team member.' } };
      const response = await fetcher(`${url}/auth/v1/admin/users/${userId}`, { method: 'PUT', headers: service, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error('STAFF_PASSWORD_RESET_FAILED');
      return { status: 200, body: { ok: true } };
    }
    return { status: 400, body: { error: 'Unknown action.' } };
  } catch (err) {
    console.error(`Staff account request failed: ${err.message}`);
    return { status: 502, body: { error: 'The account service is unavailable. Please try again.' } };
  }
}
