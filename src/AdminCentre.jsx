import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Trash2, UserPlus, UserX } from 'lucide-react';
import { Field } from './BookingFields.jsx';
import { CUSTOM_ROLE, PERMISSIONS, ROLES, roleFor } from './permissions.js';
import supabase from './supabaseClient.js';

const emptyPerson = { full_name: '', email: '', password: '', role: 'Mechanic', permissions: ROLES.Mechanic };

function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), (value) => letters[value % letters.length]).join('');
}

async function accountRequest(body) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The account could not be updated.');
}

function RoleSelect({ value, disabled, label, onChange }) {
  return <select aria-label={label} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
    {Object.keys(ROLES).map((role) => <option key={role}>{role}</option>)}
    {value === CUSTOM_ROLE && <option>{CUSTOM_ROLE}</option>}
  </select>;
}

function AddPerson({ onAdded, onError }) {
  const [person, setPerson] = useState(emptyPerson);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setPerson((current) => ({ ...current, ...patch }));
  async function add(event) {
    event.preventDefault();
    setBusy(true);
    onError('');
    try {
      if (person.password) await accountRequest({ action: 'create', email: person.email, password: person.password });
      const { error } = await supabase.rpc('add_staff_member', { p_email: person.email, p_name: person.full_name, p_role: person.role, p_permissions: person.permissions });
      if (error) throw error;
      onAdded(`${person.full_name} has been added.${person.password ? ` Give them their email and temporary password: ${person.password}` : ''}`);
      setPerson(emptyPerson);
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }
  return <form className="admin-panel" onSubmit={add}>
    <h3>Add a team member</h3>
    <fieldset disabled={busy}>
      <div className="two-columns">
        <Field label="Full name"><input required maxLength={80} value={person.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
        <Field label="Email"><input required type="email" autoComplete="off" value={person.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      </div>
      <div className="two-columns">
        <Field label="Temporary password" hint="Leave blank if they already have a login."><span className="postcode-input"><input autoComplete="new-password" maxLength={72} value={person.password} onChange={(e) => set({ password: e.target.value })} /><button type="button" className="button button-outline" onClick={() => set({ password: temporaryPassword() })}>Generate</button></span></Field>
        <Field label="Role"><RoleSelect label="Role for new team member" value={person.role} onChange={(role) => set({ role, permissions: ROLES[role] })} /></Field>
      </div>
      <div className="permission-ticks" role="group" aria-label="Permissions for new team member">{PERMISSIONS.map(([key, label, description]) => <label key={key} className="check-label" title={description}><input type="checkbox" checked={person.permissions.includes(key)} onChange={(e) => { const permissions = e.target.checked ? [...person.permissions, key] : person.permissions.filter((item) => item !== key); set({ permissions, role: roleFor(permissions) }); }} /> {label}</label>)}</div>
    </fieldset>
    <button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <UserPlus size={16} />} Add team member</button>
  </form>;
}

export function ChangePassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    if (password.length < 10) { setError('Passwords must be at least 10 characters.'); return; }
    setBusy(true);
    setError('');
    const { error: authError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (authError) setError(authError.message); else onDone();
  }
  return <form onSubmit={save}>
    <Field label="New password"><input type="password" required minLength={10} maxLength={72} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
    {error && <p className="notice" role="alert">{error}</p>}
    <button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>
  </form>;
}

export default function AdminCentre({ currentUserId, onChanged }) {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const { data, error: dbError } = await supabase.rpc('list_staff');
    setLoading(false);
    if (dbError) setError(dbError.message); else setTeam(data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(action, success = '') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (err) { setError(err.message); }
    await load();
    onChanged();
    setBusy(false);
  }
  const update = (person, patch) => run(async () => {
    const next = { ...person, ...patch };
    const { error: dbError } = await supabase.rpc('update_staff_member', { p_user_id: next.user_id, p_name: next.full_name, p_role: next.role, p_permissions: next.permissions, p_active: next.active });
    if (dbError) throw dbError;
  });
  function reset(person) {
    if (!window.confirm(`Set a new temporary password for ${person.full_name}? Their current password will stop working.`)) return;
    const password = temporaryPassword();
    void run(() => accountRequest({ action: 'reset', user_id: person.user_id, password }), `New temporary password for ${person.full_name}: ${password}`);
  }
  function remove(person) {
    if (!window.confirm(`Remove ${person.full_name} from the team? They will lose access to the workshop straight away.`)) return;
    void run(async () => {
      const { error: dbError } = await supabase.rpc('remove_staff_member', { p_user_id: person.user_id });
      if (dbError) throw dbError;
    }, `${person.full_name} has been removed.`);
  }

  return <div className="admin-centre">
    <section className="admin-panel">
      <h3>Who can do what</h3>
      <p className="muted">Tick what each person can do. Changes save straight away and apply within 30 seconds.</p>
      {error && <p className="notice" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
      {loading ? <p className="muted">Loading the team...</p> : <div className="team-table-wrap"><table className="team-table">
        <thead><tr><th scope="col">Person</th><th scope="col">Role</th>{PERMISSIONS.map(([key, label, description]) => <th scope="col" key={key} title={description}>{label}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>{team.map((person) => <tr key={person.user_id} className={person.active ? '' : 'team-inactive'}>
          <th scope="row"><strong>{person.full_name}{person.user_id === currentUserId ? ' (you)' : ''}</strong><small>{person.email}</small>{!person.active && <small>Deactivated</small>}</th>
          <td><RoleSelect label={`Role for ${person.full_name}`} disabled={busy} value={person.role in ROLES ? person.role : CUSTOM_ROLE} onChange={(role) => update(person, { role, permissions: ROLES[role] })} /></td>
          {PERMISSIONS.map(([key, label]) => <td key={key} className="team-tick"><input type="checkbox" aria-label={`${label} for ${person.full_name}`} disabled={busy} checked={person.permissions.includes(key)} onChange={(e) => { const permissions = e.target.checked ? [...person.permissions, key] : person.permissions.filter((item) => item !== key); update(person, { permissions, role: roleFor(permissions) }); }} /></td>)}
          <td><div className="team-actions">
            <button type="button" className="icon-button" disabled={busy} title="Set a new temporary password" aria-label={`Reset password for ${person.full_name}`} onClick={() => reset(person)}><KeyRound size={15} /></button>
            <button type="button" className="icon-button" disabled={busy} title={person.active ? 'Deactivate' : 'Reactivate'} aria-label={`${person.active ? 'Deactivate' : 'Reactivate'} ${person.full_name}`} aria-pressed={!person.active} onClick={() => update(person, { active: !person.active })}><UserX size={15} /></button>
            <button type="button" className="icon-button" disabled={busy} title="Remove from team" aria-label={`Remove ${person.full_name}`} onClick={() => remove(person)}><Trash2 size={15} /></button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <AddPerson onError={setError} onAdded={(text) => { setMessage(text); void load(); }} />
    <section className="admin-panel">
      <h3>What each permission allows</h3>
      <dl className="permission-guide">{PERMISSIONS.map(([key, label, description]) => <div key={key}><dt>{label}</dt><dd>{description}</dd></div>)}</dl>
    </section>
  </div>;
}
