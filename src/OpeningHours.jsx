import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import supabase from './supabaseClient.js';
import { reloadBookingSettings } from './BookingFields.jsx';
import { addDays, dateLabel, DEFAULT_SETTINGS, localDate, slotLabel, slotTimes } from './utils.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES = Array.from({ length: 33 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function DateList({ label, hint, dates, onChange, range = false }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  function add() {
    if (!from) return;
    const added = [];
    for (let day = from; day <= (range && to ? to : from) && added.length < 366; day = addDays(day, 1)) added.push(day);
    onChange([...new Set([...dates, ...added])].sort());
    setFrom('');
    setTo('');
  }
  return <div className="hours-dates">
    <h3>{label}</h3><p className="muted">{hint}</p>
    <div className="hours-date-add">
      <label className="field"><span>{range ? 'From' : 'Date'}</span><input type="date" min={localDate()} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      {range && <label className="field"><span>To (optional)</span><input type="date" min={from || localDate()} value={to} onChange={(e) => setTo(e.target.value)} /></label>}
      <button type="button" className="button button-outline" disabled={!from} onClick={add}><Plus size={16} /> Add</button>
    </div>
    {dates.length > 0 && <ul className="date-chips">{dates.map((day) => <li key={day}>{dateLabel(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}<button type="button" aria-label={`Remove ${dateLabel(day)}`} onClick={() => onChange(dates.filter((item) => item !== day))}><X size={14} /></button></li>)}</ul>}
  </div>;
}

// Lets the owner change opening days and hours, block holidays and open extra days without a developer.
export default function OpeningHours() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    supabase.rpc('get_booking_settings').then(({ data, error: dbError }) => {
      if (dbError || !data) { setError('Opening hours can be changed here once owner-tools.sql has been run in Supabase.'); return; }
      const loaded = { ...DEFAULT_SETTINGS, ...data };
      setSettings(loaded);
      setSaved(JSON.stringify(loaded));
    });
  }, []);
  if (!settings) return <section className="admin-panel hours-panel"><h2>Opening hours</h2>{error ? <p className="notice">{error}</p> : <p className="lookup-status"><LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading...</p>}</section>;

  const update = (patch) => { setError(''); setSettings((current) => ({ ...current, ...patch })); };
  const slots = slotTimes(settings);
  const dirty = JSON.stringify(settings) !== saved;
  async function save() {
    if (slots.length === 0) { setError('Leave at least an hour between opening and closing.'); return; }
    setBusy(true);
    setError('');
    const { slots: _, ...body } = settings;
    const { error: dbError } = await supabase.rpc('save_booking_settings', { p_settings: body });
    setBusy(false);
    if (dbError) { setError(dbError.message); return; }
    reloadBookingSettings();
    const next = { ...settings, slots };
    setSettings(next);
    setSaved(JSON.stringify(next));
  }

  return <section className="admin-panel hours-panel" aria-labelledby="hours-heading">
    <h2 id="hours-heading">Opening hours</h2>
    <p className="muted">What customers can book online. You can still add a booking on any day yourself.</p>
    <div className="field"><span>Open for bookings on</span><div className="day-toggles" role="group" aria-label="Open days">{DAYS.map((name, index) => {
      const day = index + 1;
      const on = settings.open_days.includes(day);
      return <button type="button" key={name} aria-pressed={on} onClick={() => update({ open_days: on ? settings.open_days.filter((item) => item !== day) : [...settings.open_days, day].sort() })}>{name}</button>;
    })}</div></div>
    <div className="two-columns">
      <label className="field"><span>Opening time</span><select value={settings.open_time} onChange={(e) => update({ open_time: e.target.value })}>{TIMES.map((time) => <option key={time} value={time}>{slotLabel(time)}</option>)}</select></label>
      <label className="field"><span>Closing time</span><select value={settings.close_time} onChange={(e) => update({ close_time: e.target.value })}>{TIMES.map((time) => <option key={time} value={time}>{slotLabel(time)}</option>)}</select></label>
    </div>
    <p className="hours-slots">{slots.length ? <>Hourly slots: {slots.map(slotLabel).join(', ')}</> : 'Leave at least an hour between opening and closing.'}</p>
    <DateList range label="Holidays and closed days" hint="No online bookings on these dates, even on a normal open day." dates={settings.closed_dates} onChange={(closed_dates) => update({ closed_dates })} />
    <DateList label="Extra open days" hint="Open for online bookings on these dates too, such as a Saturday." dates={settings.extra_dates} onChange={(extra_dates) => update({ extra_dates })} />
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="editor-footer"><span className="save-state" role="status">{busy ? 'Saving...' : dirty ? 'Unsaved changes' : <><Check size={16} /> Saved</>}</span><button type="button" className="button button-primary" disabled={busy || !dirty} onClick={() => { void save(); }}>Save opening hours</button></div>
  </section>;
}
