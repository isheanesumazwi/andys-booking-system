import { useEffect, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import supabase from './supabaseClient.js';
import { BOOKING_SLOTS, bookingDates, dateLabel, localDate, normalizePostcode, slotLabel, validPostcode } from './utils.js';

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function AddressFields({ form, onChange }) {
  const [addresses, setAddresses] = useState([]);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function find() {
    if (!validPostcode(form.customer_postcode)) { setMessage('Please enter a valid UK postcode.'); return; }
    setBusy(true);
    setMessage('');
    setAddresses([]);
    try {
      const response = await fetch(`/api/address?postcode=${encodeURIComponent(form.customer_postcode)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Address lookup is unavailable. Please enter your address manually.');
      onChange({ customer_postcode: data.postcode, address_town: data.town });
      setAddresses(data.addresses);
      if (!data.addresses.length) { setManual(true); setMessage('Postcode found. Please add your house number and street.'); }
    } catch (err) {
      setManual(true);
      setMessage(err.message);
    } finally { setBusy(false); }
  }

  function choose(value) {
    if (value === '') return;
    setManual(true);
    if (value === 'manual') return;
    const address = addresses[Number(value)];
    onChange({ address_line1: address.line_1, address_line2: address.line_2, address_town: address.town, customer_postcode: address.postcode });
  }

  return <>
    <Field label="Postcode"><span className="postcode-input"><input required maxLength={8} autoComplete="postal-code" autoCapitalize="characters" placeholder="e.g. NP19 8JJ" value={form.customer_postcode} onChange={(e) => onChange({ customer_postcode: e.target.value.toUpperCase() })} onBlur={() => onChange({ customer_postcode: normalizePostcode(form.customer_postcode) })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }} /><button type="button" className="button button-outline" disabled={busy} onClick={find}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Search size={16} />} Find address</button></span></Field>
    {message && <p className="lookup-status" role="status">{message}</p>}
    {addresses.length > 0 && <Field label="Choose your address"><select defaultValue="" onChange={(e) => choose(e.target.value)}><option value="">Select your address</option>{addresses.map((address, index) => <option key={`${address.line_1}-${index}`} value={index}>{[address.line_1, address.line_2].filter(Boolean).join(', ')}</option>)}<option value="manual">My address isn't listed</option></select></Field>}
    {manual ? <>
      <Field label="Address line 1"><input required maxLength={100} autoComplete="address-line1" placeholder="House number and street" value={form.address_line1} onChange={(e) => onChange({ address_line1: e.target.value })} /></Field>
      <Field label="Address line 2 (optional)"><input maxLength={100} autoComplete="address-line2" value={form.address_line2} onChange={(e) => onChange({ address_line2: e.target.value })} /></Field>
      <Field label="Town or city"><input required maxLength={80} autoComplete="address-level2" value={form.address_town} onChange={(e) => onChange({ address_town: e.target.value })} /></Field>
    </> : <button type="button" className="text-button" onClick={() => setManual(true)}>Enter address manually</button>}
  </>;
}

const SLOT_STATES = { pending: 'waiting for confirmation', booked: 'already booked' };

export function SlotPicker({ admin = false, date, time, refresh = 0, onDate, onTime }) {
  const [taken, setTaken] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const today = localDate();
  const now = new Date().toTimeString().slice(0, 5);

  useEffect(() => {
    if (!date || !supabase) return;
    let alive = true;
    const load = async () => {
      const { data, error: dbError } = await supabase.rpc('get_slot_availability', { p_from: date, p_to: date });
      if (!alive) return;
      setLoading(false);
      if (dbError) { setError('Available times could not be loaded. Please try again.'); return; }
      setError('');
      setTaken(Object.fromEntries(data.map((slot) => [slot.slot_time, slot.state])));
    };
    setLoading(true);
    setTaken({});
    void load();
    const timer = setInterval(() => { void load(); }, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [date, refresh]);

  useEffect(() => { if (time && taken[time]) onTime(''); }, [taken, time, onTime]);

  const past = (slot) => date === today && slot <= now;
  return <>
    {admin
      ? <Field label="Date" hint="This booking will be added as Booked. Any day can be used here."><input aria-label="Booking date" type="date" required min={today} value={date} onChange={(e) => onDate(e.target.value)} /></Field>
      : <div className="field"><span>Choose a day</span><div className="date-options" role="group" aria-label="Available days">{bookingDates().map((day) => <button type="button" key={day} aria-pressed={date === day} onClick={() => onDate(day)}><small>{dateLabel(day, { weekday: 'short' })}</small><strong>{dateLabel(day, { day: 'numeric', month: 'short' })}</strong></button>)}</div><small>We're booking in on Wednesdays and Thursdays.</small></div>}
    {date && <div className="field">
      <span>Choose a time{loading ? '...' : ''}</span>
      <div className="slot-grid" role="group" aria-label="Available times">{BOOKING_SLOTS.map((slot) => {
        const state = taken[slot];
        const unavailable = Boolean(state) || past(slot);
        return <button type="button" key={slot} className={state ? `slot-${state}` : ''} disabled={unavailable} aria-pressed={time === slot} aria-label={`${slotLabel(slot)}${state ? `, ${SLOT_STATES[state]}` : past(slot) ? ', time has passed' : ''}`} onClick={() => onTime(slot)}>{slotLabel(slot)}</button>;
      })}</div>
      <div className="slot-legend"><span className="legend-free">Available</span><span className="legend-pending">Awaiting confirmation</span><span className="legend-booked">Booked</span></div>
      {Object.values(taken).includes('pending') && <p className="slot-note">Amber times are waiting to be confirmed. Check again in 30 minutes, as they may open up if a booking is declined, or choose another time.</p>}
      {error && <p className="lookup-status" role="alert">{error}</p>}
    </div>}
  </>;
}
