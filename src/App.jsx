import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, CalendarDays, CarFront, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, KeyRound, ClipboardList, CreditCard, House, LoaderCircle, LogOut, Menu, Plus, Printer, Search, ShieldCheck, UsersRound, X } from 'lucide-react';
import supabase, { configurationError } from './supabaseClient.js';
import { addDays, BOOKING_SLOTS, dateLabel, JOB_STATUSES, localDate, jobContact, jobMatches, money, normalizePostcode, normalizeRegistration, PAYMENT_STATUSES, SERVICE_PACKAGES, SERVICES, slotLabel, validPostcode, validRegistration, validateBooking } from './utils.js';
import { cardTotals, JOB_PHOTO_BUCKET, normalizeCard } from './jobCard.js';
import AdminCentre, { ChangePassword } from './AdminCentre.jsx';
import { AddressFields, Field, SlotPicker } from './BookingFields.jsx';
import HelpPage from './HelpPage.jsx';
import { JobCardForm, JobCardsBoard, Receipt } from './JobCard.jsx';
import PhotoCarousel from './PhotoCarousel.jsx';
import MonthCalendar, { DayMarkers } from './MonthCalendar.jsx';

const emptyBooking = { first_name: '', last_name: '', phone: '', reg_no: '', make: '', model: '', year: '', engine_capacity: '', booking_date: '', booking_time: '', service_type: '', customer_postcode: '', address_line1: '', address_line2: '', address_town: '' };

function Notice({ children, success = false }) {
  return children ? <div className={`notice ${success ? 'notice-success' : ''}`} role={success ? 'status' : 'alert'}>{children}</div> : null;
}

function Spinner() { return <LoaderCircle className="spin" size={18} aria-hidden="true" />; }

const validService = (value) => value.trim().length > 0 && value.trim().length <= 200;

// The three service packages come first. Customers can also describe any job in their own words.
function ServicePicker({ value, onChange, required = false }) {
  const pick = (service) => onChange(!value.trim() || SERVICES.includes(value) ? service : `${service} – ${value}`.slice(0, 200));
  return <div className="service-picker">
    <p className="service-chips-label">Popular services, confirmed straight away:</p>
    <div className="service-packages" role="group" aria-label="Popular services">{SERVICE_PACKAGES.map(([name, description]) => <button type="button" key={name} aria-pressed={value === name} onClick={() => pick(name)}><strong>{name}</strong><span>{description}</span></button>)}</div>
    <Field label="Tell us what you need"><textarea required={required} rows={3} maxLength={200} placeholder="Describe the problem or the work you'd like done, e.g. knocking noise from the front when braking" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
    <p className="service-chips-label">Or tap a common job:</p>
    <div className="service-chips" role="group" aria-label="Common jobs">{SERVICES.slice(SERVICE_PACKAGES.length).map((service) => <button type="button" key={service} aria-pressed={value === service} onClick={() => pick(service)}>{service}</button>)}</div>
  </div>;
}

function BookingForm({ admin = false, onCreated }) {
  const [form, setForm] = useState(() => {
    const service = new URLSearchParams(window.location.search).get('service');
    return { ...emptyBooking, service_type: SERVICES.includes(service) ? service : '' };
  });
  const [lookup, setLookup] = useState({ state: 'idle', message: '' });
  const [retry, setRetry] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [alreadyBooked, setAlreadyBooked] = useState(false);
  const [changing, setChanging] = useState(false);
  const registration = normalizeRegistration(form.reg_no);

  useEffect(() => {
    setConfirmed(false);
    if (!validRegistration(registration)) {
      setLookup({ state: 'idle', message: '' });
      return;
    }
    const controller = new AbortController();
    setLookup({ state: 'waiting', message: '' });
    const timer = setTimeout(async () => {
      setLookup({ state: 'loading', message: '' });
      try {
        const response = await fetch(`/api/vehicle?registration=${encodeURIComponent(registration)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Vehicle lookup is unavailable. Please enter your vehicle details manually.');
        if (controller.signal.aborted) return;
        setForm((current) => ({ ...current, make: data.make, model: data.model, year: data.year || '', engine_capacity: data.engine_capacity || '' }));
        setLookup({ state: 'found', message: `We found your ${data.make} ${data.model} ${data.year}.` });
      } catch (err) {
        if (controller.signal.aborted) return;
        setLookup({ state: 'failed', message: err.message });
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [registration, retry]);

  function change(key, value) {
    setError('');
    setForm((current) => ({ ...current, [key]: value, ...(key === 'reg_no' ? { make: '', model: '', year: '', engine_capacity: '' } : {}) }));
    if (key === 'make' || key === 'model') {
      setLookup((current) => current.state === 'found' ? { state: 'manual', message: 'Using your manually corrected vehicle details.' } : current);
      setConfirmed(false);
    }
  }

  const chooseDate = (day) => { setError(''); setForm((current) => ({ ...current, booking_date: day, booking_time: '' })); };
  const chooseTime = useCallback((slot) => { setError(''); setForm((current) => ({ ...current, booking_time: slot })); }, []);

  async function submit(event, changeRequest = false) {
    event?.preventDefault();
    const validation = validateBooking(form);
    if (validation) { setError(validation); return; }
    if (!validService(form.service_type)) { setError('Please tell us what work you need.'); return; }
    if (!form.address_line1.trim() || !form.address_town.trim() || !validPostcode(form.customer_postcode)) { setError('Please enter your full address and postcode.'); return; }
    if (!form.booking_time) { setError('Please choose a time.'); return; }
    if (lookup.state === 'found' && !confirmed) { setError('Please confirm that the vehicle details are correct.'); return; }
    if (configurationError) { setError(configurationError); return; }
    setBusy(true);
    setError('');
    try {
      const { data, error: dbError } = await supabase.rpc('create_booking', { p_details: {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        reg_no: registration,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year ? Number(form.year) : null,
        engine_capacity: form.engine_capacity.trim() || null,
        booking_date: form.booking_date,
        booking_time: form.booking_time,
        service_type: form.service_type.trim(),
        customer_address: [form.address_line1, form.address_line2, form.address_town].map((line) => line.trim()).filter(Boolean).join('\n'),
        customer_postcode: normalizePostcode(form.customer_postcode),
        change_request: changeRequest,
      } });
      if (dbError) throw dbError;
      if (data === 'Already Booked') { setAlreadyBooked(true); return; }
      setAlreadyBooked(false);
      setChanging(changeRequest);
      setSent(data);
      onCreated?.();
    } catch (err) {
      setError(`Booking could not be saved: ${err.message}`);
      setSlotRefresh((value) => value + 1);
    } finally { setBusy(false); }
  }

  if (sent) return <div className="booking-success">
    <span className="success-icon"><CheckCircle2 size={38} /></span>
    <p className="eyebrow">ALL SET</p>
    <h2>{admin ? 'Booking added.' : sent === 'Booked' ? "You're booked in." : 'Request received.'}</h2>
    <p>{admin ? 'The vehicle is now on your workshop agenda.' : sent === 'Booked' ? `Your ${form.service_type.trim()} is confirmed. See you then!` : changing ? 'Your change request has been sent. Andy will review it, and your existing booking stays in place until then.' : 'Booking request sent! Andy will review your request shortly.'}</p>
    <div className="confirmation-details"><strong className="registration">{registration}</strong><span>{dateLabel(form.booking_date)} at {slotLabel(form.booking_time)}</span></div>
    {!admin && sent !== 'Booked' && <p className="muted">This is a request, not a confirmed appointment. Andy will contact you on the phone number you provided.</p>}
    <button className="button button-outline" onClick={() => { setSent(''); setForm({ ...emptyBooking }); }}>Make another booking <ArrowRight size={16} /></button>
  </div>;

  return <form onSubmit={submit} className="booking-form">
    <fieldset disabled={busy}>
      <ServicePicker required value={form.service_type} onChange={(value) => change('service_type', value)} />
      <div className="form-section-label"><span>01</span> YOUR DETAILS</div>
      <div className="two-columns">
        <Field label="First name"><input autoComplete="given-name" required maxLength={80} placeholder="e.g. James" value={form.first_name} onChange={(e) => change('first_name', e.target.value)} /></Field>
        <Field label="Last name"><input autoComplete="family-name" required maxLength={80} placeholder="e.g. Taylor" value={form.last_name} onChange={(e) => change('last_name', e.target.value)} /></Field>
      </div>
      <Field label="Phone number" hint="We'll use this to confirm your booking."><input type="tel" autoComplete="tel" required maxLength={25} placeholder="e.g. 07700 900123" value={form.phone} onChange={(e) => change('phone', e.target.value)} /></Field>
      <div className="form-section-label"><span>02</span> YOUR ADDRESS</div>
      <AddressFields form={form} onChange={(patch) => { setError(''); setForm((current) => ({ ...current, ...patch })); }} />
      <div className="form-section-label"><span>03</span> YOUR VEHICLE</div>
      <Field label="Vehicle registration">
        <div className="registration-input"><span>UK</span><input required maxLength={10} autoCapitalize="characters" spellCheck={false} placeholder="AB12 CDE" value={form.reg_no} onChange={(e) => change('reg_no', e.target.value.toUpperCase())} /><button type="button" aria-label="Look up vehicle registration" title="Look up vehicle" disabled={!validRegistration(registration) || lookup.state === 'loading'} onClick={() => setRetry((value) => value + 1)}>{lookup.state === 'loading' ? <Spinner /> : <Search size={19} />}</button></div>
      </Field>
      {lookup.state === 'loading' && <p className="lookup-status" role="status">Looking up your vehicle...</p>}
      {lookup.message && <div className={`lookup-status ${lookup.state === 'found' ? 'lookup-found' : ''}`} role="status">{lookup.state === 'found' && <CheckCircle2 size={17} />} {lookup.message}</div>}
      {lookup.state === 'found' && <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Yes, this is my vehicle</label>}
      <div className="two-columns">
        <Field label="Make"><input required maxLength={100} placeholder="e.g. Ford" value={form.make} onChange={(e) => change('make', e.target.value)} /></Field>
        <Field label="Model"><input required maxLength={100} placeholder="e.g. Focus" value={form.model} onChange={(e) => change('model', e.target.value)} /></Field>
      </div>
      {admin && <div className="two-columns">
        <Field label="Year (optional)"><input type="number" min={1886} max={new Date().getFullYear() + 1} value={form.year} onChange={(e) => change('year', e.target.value)} /></Field>
        <Field label="Engine capacity (optional)"><input maxLength={50} placeholder="e.g. 1598 cc" value={form.engine_capacity} onChange={(e) => change('engine_capacity', e.target.value)} /></Field>
      </div>}
      <div className="form-section-label"><span>04</span> DATE AND TIME</div>
      <SlotPicker admin={admin} date={form.booking_date} time={form.booking_time} refresh={slotRefresh} onDate={chooseDate} onTime={chooseTime} />
    </fieldset>
    <Notice>{error}</Notice>
    {alreadyBooked ? <div className="already-booked" role="alert"><strong>This car is already booked in with us.</strong><p>Do you want to change that booking to the day and time you've chosen?</p><div><button type="button" className="button button-primary" disabled={busy} onClick={() => submit(null, true)}>{busy ? <Spinner /> : <Check size={16} />} Yes, change my booking</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setAlreadyBooked(false)}>No, keep it</button></div></div> : <button className="button button-primary button-wide" disabled={busy || lookup.state === 'loading' || lookup.state === 'waiting'}>{busy ? <Spinner /> : <CalendarDays size={18} />}{busy ? 'Saving booking...' : admin ? 'Add booking' : 'Request a booking'}{!busy && <ArrowRight size={18} />}</button>}
    {!admin && <p className="form-footer"><ShieldCheck size={14} /> Your details are only used to manage your booking.</p>}
  </form>;
}

function PublicPage() {
  const help = ['/about', '/help'].includes(window.location.pathname.replace(/\/$/, ''));
  return <div className="public-page">
    <header className="public-header shell"><nav className="public-nav" aria-label="Main navigation"><a href="/book" aria-current={!help ? 'page' : undefined}>Book a service</a><a href="/help" aria-current={help ? 'page' : undefined}>About & help</a><a className="staff-link" href="/admin"><ShieldCheck size={15} /> Workshop login <ArrowRight size={15} /></a></nav></header>
    {help ? <HelpPage /> : <main className="public-main shell">
      <section className="hero">
        <p className="eyebrow"><span className="tiny-line" /> YOUR LOCAL WORKSHOP</p>
        <h1>Good care.<br />For your car.<br /><span>And your peace<br className="desktop-break" /> of mind.</span></h1>
        <p className="hero-description">A friendly face. Honest advice. A car that's ready for the road. Book your next visit with Andy's Beechwood Car Care.</p>
        <div className="hero-features"><span><CheckCircle2 size={17} /> Personal service</span><span><CheckCircle2 size={17} /> Straightforward booking</span></div>
        <div className="free-offers"><span><strong>FREE</strong> Battery check</span><span><strong>FREE</strong> Suspension and safety check</span></div>
        <PhotoCarousel />
      </section>
      <section className="booking-card" aria-labelledby="booking-heading">
        <div className="booking-card-header"><span className="small-icon"><CalendarDays size={21} /></span><span className="pill">LET'S GET YOU BOOKED IN</span></div>
        <h2 id="booking-heading">Book your car service here.</h2><p className="muted">A few details, and we'll take it from there.</p>
        <BookingForm />
      </section>
    </main>}
    <footer className="public-footer shell"><span>&copy; {new Date().getFullYear()} Andy's Beechwood Car Care</span><a href="/help">Contact, directions & FAQs</a></footer>
  </div>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event) {
    event.preventDefault();
    if (configurationError) { setError(configurationError); return; }
    setBusy(true);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><a href="/" className="back-link"><ArrowLeft size={17} /> Back to booking</a><div className="login-card"><div className="login-heading"><span className="small-icon"><ShieldCheck size={23} /></span><p className="eyebrow">WORKSHOP ACCESS</p><h1>Welcome back.</h1><p className="muted">Sign in to keep your workshop moving.</p></div><form onSubmit={login}><Field label="Email address"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field><Notice>{error}</Notice><button className="button button-primary button-wide" disabled={busy}>{busy ? <Spinner /> : <ShieldCheck size={17} />}{busy ? 'Signing in...' : 'Sign in to workshop'}<ArrowRight size={17} /></button></form><p className="form-footer">Private access for the workshop team.</p></div></div>;
}

function Modal({ title, onClose, children, className = '' }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby="modal-title" onCancel={(e) => { e.preventDefault(); close.current(); }}><header className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></header><div className="modal-body">{children}</div></dialog>;
}

function jobDraft(job) {
  const vehicle = job.vehicle;
  const customer = vehicle?.customer;
  return { booking_date: job.booking_date, booking_time: job.booking_time?.slice(0, 5) || '', customer_address: job.customer_address || '', customer_postcode: job.customer_postcode || '', status: job.status, service_type: job.service_type || '', diagnosis_notes: job.diagnosis_notes || '', parts_ordered: job.parts_ordered || '', amount_due: String(job.amount_due ?? 0), payment_status: job.payment_status || 'Unpaid', first_name: customer?.first_name || '', last_name: customer?.last_name || '', phone: customer?.phone || '', reg_no: vehicle?.reg_no || '', make: vehicle?.make || '', model: vehicle?.model || '', year: String(vehicle?.year || ''), engine_capacity: vehicle?.engine_capacity || '' };
}

function JobEditor({ job, initialTab = 'booking', can, onClose, onSaved, onDeleted }) {
  const [draft, setDraft] = useState(() => jobDraft(job));
  const [saved, setSaved] = useState(() => JSON.stringify(jobDraft(job)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const savingRef = useRef(false);
  const [tab, setTab] = useState(initialTab);
  const [card, setCard] = useState(() => normalizeCard(job.job_card));
  const [savedCard, setSavedCard] = useState(() => JSON.stringify(normalizeCard(job.job_card)));
  const [cardSaving, setCardSaving] = useState(false);
  const [cardError, setCardError] = useState('');
  const [jobStatus, setJobStatus] = useState(job.status);
  const cardSavingRef = useRef(false);
  const cardDirty = JSON.stringify(card) !== savedCard;
  const totals = cardTotals(card);
  const dirty = JSON.stringify(draft) !== saved;
  const customer = job.vehicle?.customer;
  const vehicle = job.vehicle;
  const change = (key, value) => { setError(''); setDraft((current) => ({ ...current, [key]: value })); };
  const save = useCallback(async () => {
    if (savingRef.current || deletingRef.current) return false;
    const validation = validateBooking(draft, { allowPast: true });
    if (validation) { setError(validation); return false; }
    if (draft.service_type.length > 200) { setError('Keep the work description to 200 characters or fewer.'); return false; }
    if (!draft.booking_date || !JOB_STATUSES.includes(draft.status) || !PAYMENT_STATUSES.includes(draft.payment_status)) {
      setError('Please choose a date, job status, and payment status.'); return false;
    }
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(draft.amount_due) || Number(draft.amount_due) > 99999999.99) {
      setError('Enter a valid amount between 0 and 99,999,999.99 with up to two decimal places.'); return false;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const { error: dbError } = await supabase.rpc('amend_booking', { p_job_id: job.id, p_details: { ...draft, reg_no: normalizeRegistration(draft.reg_no), amount_due: Number(draft.amount_due), year: draft.year ? Number(draft.year) : null } });
      if (dbError) throw dbError;
      setSaved(JSON.stringify(draft));
      onSaved();
      return true;
    } catch (err) { setError(`Changes could not be saved: ${err.message}`); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }, [draft, job, onSaved]);
  useEffect(() => {
    if (!dirty || saving || deleting || error) return;
    const timer = setTimeout(() => { void save(); }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, saving, deleting, error, save]);
  async function changeStatus(status) {
    setCardError('');
    const { error: dbError } = await supabase.rpc('set_job_status', { p_job_id: job.id, p_status: status });
    if (dbError) { setCardError(`Job status could not be changed: ${dbError.message}`); return; }
    setJobStatus(status);
    setDraft((current) => ({ ...current, status }));
    setSaved((current) => JSON.stringify({ ...JSON.parse(current), status }));
    onSaved();
  }
  const changeCard = (update) => { setCardError(''); setCard(update); };
  const saveCard = useCallback(async () => {
    if (cardSavingRef.current || deletingRef.current) return false;
    cardSavingRef.current = true;
    setCardSaving(true);
    setCardError('');
    try {
      const { error: dbError } = await supabase.rpc('save_job_card', { p_job_id: job.id, p_card: card });
      if (dbError) throw dbError;
      setSavedCard(JSON.stringify(card));
      onSaved();
      return true;
    } catch (err) { setCardError(`Job card could not be saved: ${err.message}`); return false; }
    finally { cardSavingRef.current = false; setCardSaving(false); }
  }, [card, job, onSaved]);
  useEffect(() => {
    if (!cardDirty || cardSaving || deleting || cardError) return;
    const timer = setTimeout(() => { void saveCard(); }, 1000);
    return () => clearTimeout(timer);
  }, [cardDirty, cardSaving, deleting, cardError, saveCard]);
  const close = () => {
    if (savingRef.current || cardSavingRef.current || deletingRef.current) { setError('Please wait for the current operation to finish.'); return; }
    if ((dirty || cardDirty) && !window.confirm('Your changes have not been saved. Close and discard them?')) return;
    onClose();
  };
  useEffect(() => {
    if (!dirty && !cardDirty) return;
    const handler = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, cardDirty]);

  async function deleteBooking() {
    if (savingRef.current || cardSavingRef.current || deletingRef.current) return;
    const persisted = JSON.parse(saved);
    if (!window.confirm(`Permanently delete booking ${persisted.reg_no} on ${dateLabel(persisted.booking_date)}? This removes the booking, notes and payment record and cannot be undone. Other bookings are kept.`)) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    try {
      const { error: dbError } = await supabase.rpc('delete_booking', { p_job_id: job.id });
      if (dbError) throw dbError;
      if (card.photos.length) await supabase.storage.from(JOB_PHOTO_BUCKET).remove(card.photos.map((photo) => photo.path));
      onDeleted(job.id);
      onClose();
    } catch (err) { setError(`Booking could not be deleted: ${err.message}`); }
    finally { deletingRef.current = false; setDeleting(false); }
  }

  const receiptDetails = job.contact_phone ? { ...draft, first_name: job.contact_name, last_name: '', phone: job.contact_phone } : draft;
  const tabs = [['booking', 'Booking'], ...(can('job_cards') ? [['card', 'Job card']] : []), ...(can('payments') ? [['receipt', 'Receipt']] : [])];
  const canEdit = can('bookings_manage');
  return <Modal title="Job record" onClose={close} className="modal-wide">
    <div className="job-summary"><strong className="registration">{vehicle?.reg_no || 'No registration'}</strong><div><h3>{vehicle?.make} {vehicle?.model}</h3><p>{customer?.first_name} {customer?.last_name}{vehicle?.year ? ` / ${vehicle.year}` : ''}{vehicle?.engine_capacity ? ` / ${vehicle.engine_capacity}` : ''}</p></div></div>
    {customer?.phone && <a className="phone-link" href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`}>{customer.phone} <ArrowRight size={15} /></a>}
    <ContactFlag job={job} />
    <div className="editor-tabs" role="tablist" aria-label="Job record sections">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`} aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'card' && <div role="tabpanel" id="panel-card" aria-labelledby="tab-card">
      {!canEdit && job.status !== 'Pending Confirmation' && <Field label="Job status"><select value={jobStatus} onChange={(e) => { void changeStatus(e.target.value); }}>{JOB_STATUSES.filter((status) => status !== 'Pending Confirmation').map((status) => <option key={status}>{status}</option>)}</select></Field>}
      <JobCardForm jobId={job.id} card={card} showCosts={can('payments')} onChange={changeCard} />
      <Notice>{cardError}</Notice>
      <div className="editor-footer"><span className="save-state" role="status">{cardSaving ? <><Spinner /> Saving...</> : cardDirty ? 'Unsaved changes' : <><Check size={16} /> Job card saved</>}</span><button type="button" className="button button-primary" disabled={cardSaving || deleting || !cardDirty} onClick={() => { void saveCard(); }}>{cardSaving ? 'Saving...' : 'Save job card'}</button></div>
      <p className="muted small-text">The job card saves automatically after you stop typing.</p>
    </div>}
    {tab === 'receipt' && <div role="tabpanel" id="panel-receipt" aria-labelledby="tab-receipt">
      <div className="receipt-actions">
        <button type="button" className="button button-primary" onClick={() => window.print()}><Printer size={17} /> Print receipt</button>
        {Number(draft.amount_due) !== totals.total && <button type="button" className="button button-outline" disabled={saving} onClick={() => change('amount_due', totals.total.toFixed(2))}>Set amount due to {money(totals.total)}</button>}
      </div>
      <p className="muted small-text">Labour and parts come from the job card. Amount due on the booking: {money(draft.amount_due)} ({draft.payment_status}).</p>
      <Notice>{error || cardError}</Notice>
      <Receipt jobId={job.id} details={receiptDetails} card={card} issued={localDate()} />
    </div>}
    {can('payments') && createPortal(<div className="print-receipt"><Receipt jobId={job.id} details={receiptDetails} card={card} issued={localDate()} /></div>, document.body)}
    {tab === 'booking' && <div role="tabpanel" id="panel-booking" aria-labelledby="tab-booking">
    <form onSubmit={async (e) => { e.preventDefault(); if (await save()) onClose(); }}>
      <fieldset disabled={saving || deleting || !canEdit}>
        <p className="muted editor-warning">Customer details are shared with their other bookings. Vehicle corrections apply to all bookings for this vehicle.</p>
        <div className="two-columns"><Field label="First name"><input required maxLength={80} value={draft.first_name} onChange={(e) => change('first_name', e.target.value)} /></Field><Field label="Last name"><input required maxLength={80} value={draft.last_name} onChange={(e) => change('last_name', e.target.value)} /></Field></div>
        <Field label="Phone number"><input required type="tel" maxLength={25} value={draft.phone} onChange={(e) => change('phone', e.target.value)} /></Field>
        <Field label="Vehicle registration"><input required maxLength={10} value={draft.reg_no} onChange={(e) => change('reg_no', e.target.value.toUpperCase())} /></Field>
        <div className="two-columns"><Field label="Make"><input required maxLength={100} value={draft.make} onChange={(e) => change('make', e.target.value)} /></Field><Field label="Model"><input required maxLength={100} value={draft.model} onChange={(e) => change('model', e.target.value)} /></Field></div>
        <div className="two-columns"><Field label="Year (optional)"><input type="number" min={1886} max={new Date().getFullYear() + 1} value={draft.year} onChange={(e) => change('year', e.target.value)} /></Field><Field label="Engine capacity (optional)"><input maxLength={50} value={draft.engine_capacity} onChange={(e) => change('engine_capacity', e.target.value)} /></Field></div>
        <ServicePicker value={draft.service_type} onChange={(value) => change('service_type', value)} />
        <div className="two-columns"><Field label="Booking date" hint="Change the date to move this job, including to a Sunday."><input type="date" required value={draft.booking_date} onChange={(e) => { change('booking_date', e.target.value); if (e.target.value !== draft.booking_date && draft.status !== 'Pending Confirmation' && draft.status !== 'Completed') change('status', 'Rescheduled'); }} /></Field><Field label="Job status"><select value={draft.status} onChange={(e) => change('status', e.target.value)}>{JOB_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field></div>
        <div className="two-columns"><Field label="Time"><select value={draft.booking_time} onChange={(e) => change('booking_time', e.target.value)}><option value="">No time set</option>{BOOKING_SLOTS.map((slot) => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}</select></Field><Field label="Postcode"><input maxLength={8} value={draft.customer_postcode} onChange={(e) => change('customer_postcode', e.target.value.toUpperCase())} /></Field></div>
        <Field label="Customer address"><textarea rows={3} maxLength={290} value={draft.customer_address} onChange={(e) => change('customer_address', e.target.value)} /></Field>
        <Field label="Diagnosis & service notes"><textarea rows={5} maxLength={10000} placeholder="What's happening with this vehicle?" value={draft.diagnosis_notes} onChange={(e) => change('diagnosis_notes', e.target.value)} /></Field>
        <Field label="Parts ordered"><textarea rows={3} maxLength={10000} placeholder="Parts, part numbers, supplier details..." value={draft.parts_ordered} onChange={(e) => change('parts_ordered', e.target.value)} /></Field>
      </fieldset>
      {can('payments') && <fieldset disabled={saving || deleting}>
        <div className="two-columns"><Field label="Amount due (£)"><input type="number" min="0" max="99999999.99" step="0.01" required value={draft.amount_due} onChange={(e) => change('amount_due', e.target.value)} /></Field><Field label="Payment status"><select value={draft.payment_status} onChange={(e) => change('payment_status', e.target.value)}>{PAYMENT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field></div>
      </fieldset>}
      {(canEdit || can('payments')) ? <>
      <Notice>{error}</Notice><div className="editor-footer"><span className="save-state" role="status">{saving ? <><Spinner /> Saving...</> : dirty ? 'Unsaved changes' : <><Check size={16} /> All changes saved</>}</span><button className="button button-primary" disabled={saving || deleting}>{saving ? 'Saving...' : 'Save & close'}</button></div>
      <p className="muted small-text">Changes save automatically after you stop typing. Moving a pending request does not approve it.</p>
      </> : <p className="muted small-text">You can view this booking but not change it.</p>}
    </form>
    {can('bookings_delete') && <div className="delete-booking"><p className="muted">Remove a test or incorrect booking permanently. The customer, vehicle and other bookings are retained.</p><button type="button" className="button button-danger" disabled={saving || deleting} onClick={deleteBooking}>{deleting ? <Spinner /> : <X size={16} />}{deleting ? 'Deleting...' : 'Delete booking'}</button></div>}
    </div>}
  </Modal>;
}

// Set when a known vehicle was booked with a phone number that doesn't match our records.
function ContactFlag({ job }) {
  if (!job.contact_phone) return null;
  return <p className="contact-flag" role="note"><strong>{job.replaces_job_id ? 'Change request:' : 'Different contact:'}</strong> {job.contact_name}, <a href={`tel:${job.contact_phone.replace(/[^\d+]/g, '')}`}>{job.contact_phone}</a>. This number differs from the one on file for this vehicle.{job.replaces_job_id ? ' Check it is the right person. Approving replaces the existing booking; deleting this request keeps it.' : ''}</p>;
}

function Status({ value }) {
  return <span className={`status status-${value.toLowerCase().replaceAll(' ', '-')}`}><span />{value}</span>;
}

function JobRow({ job, view, showCosts, onOpen }) {
  const who = jobContact(job);
  return <button className="job-row" onClick={onOpen} aria-label={`Open job ${who.reg_no}`}>
    <div className="vehicle-cell"><span className="car-cell-icon"><CarFront size={21} /></span><div><strong className="reg-text">{who.reg_no}</strong><span>{who.make} {who.model}</span><small>{who.name}</small>{job.service_type && <small>{job.service_type}</small>}</div></div>
    <div className="job-status-cell">{job.booking_time && <small>{slotLabel(job.booking_time)}</small>}{view !== 'agenda' && <small>{dateLabel(job.booking_date, { day: 'numeric', month: 'short', year: 'numeric' })}</small>}{view === 'history' && job.completed_at && <small>Completed {dateLabel(job.completed_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</small>}<Status value={job.status} /></div>
    <div>{showCosts && <Status value={job.payment_status} />}</div><strong className="amount-cell">{showCosts && money(job.amount_due)}</strong>{view === 'history' && showCosts ? <Printer size={18} className="row-arrow" aria-label="View receipt" /> : <ChevronRight size={18} className="row-arrow" />}
  </button>;
}

function PlateLookup({ enabled }) {
  const [registration, setRegistration] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalizedRegistration = normalizeRegistration(registration);

  async function lookup(event) {
    event.preventDefault();
    if (!validRegistration(normalizedRegistration)) {
      setError('Enter a valid registration with 2–8 letters or numbers.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(`/api/vehicle?registration=${encodeURIComponent(normalizedRegistration)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Vehicle lookup is unavailable.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const facts = result && [
    ['Make', result.make],
    ['Model', result.model],
    ['Year', result.year],
    ['Engine capacity', result.engine_capacity ? `${result.engine_capacity} cc` : null],
    ['Fuel', result.fuel_type],
    ['Colour', result.colour],
    ['MOT status', result.mot_status],
    ['MOT expiry', result.mot_expiry_date],
    ['Tax status', result.tax_lookup_error ? 'Unavailable' : result.tax_status],
    ['Tax due', result.tax_lookup_error ? 'Unavailable' : result.tax_due_date],
  ];

  return <section className="plate-lookup-panel">
    <div className="plate-lookup-heading"><span className="stat-icon"><CarFront size={21} /></span><div><h2>Checks</h2><p className="muted">Check the vehicle details and latest MOT information for workshop use.</p></div></div>
    <form className="plate-lookup-form" onSubmit={lookup}>
      <Field label="Vehicle registration"><input required maxLength={10} autoCapitalize="characters" spellCheck={false} placeholder="AB12 CDE" value={registration} onChange={(event) => { setRegistration(event.target.value.toUpperCase()); setResult(null); setError(''); }} /></Field>
      <button className="button button-primary" type="submit" disabled={!enabled || busy}>{busy ? <Spinner /> : <Search size={17} />}{busy ? 'Checking plate...' : 'Check plate'}</button>
    </form>
    <Notice>{error}</Notice>
    {result && <div className="plate-result" aria-live="polite">
      <div className="plate-result-title"><strong className="registration">{normalizedRegistration}</strong><h3>Car details</h3><span>{result.tax_lookup_error ? 'Tax details could not be checked.' : result.tax_lookup_configured ? 'DVLA vehicle and tax details' : 'DVSA MOT history'}</span></div>
      <dl className="vehicle-details-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not available'}</dd></div>)}</dl>
      {!result.tax_lookup_configured && <p className="muted plate-lookup-note">Tax details require a separate DVLA Vehicle Enquiry Service API key. The DVSA MOT History API key does not provide tax status.</p>}
    </div>}
  </section>;
}

function Dashboard({ session }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(localDate());
  const [week, setWeek] = useState(localDate());
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [profile, setProfile] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [view, setView] = useState('agenda');
  const [calendarView, setCalendarView] = useState('week');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const { data: me, error: permissionError } = await supabase.rpc('my_staff_profile');
      if (permissionError) throw permissionError;
      if (!me) throw new Error('This account does not have workshop access. Ask the workshop administrator to add you in the admin centre.');
      if (request !== requestRef.current) return;
      setProfile(me);
      setAuthorized(true);
      const { data: records, error: dbError } = await supabase.rpc('list_workshop_jobs');
      if (dbError) throw dbError;
      if (request === requestRef.current) { setJobs(records); setError(''); }
    } catch (err) { if (request === requestRef.current) setError(err.message); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { ++requestRef.current; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [load]);

  async function approve(job) {
    setApproving(job.id);
    try {
      const { error: dbError } = await supabase.rpc('approve_booking', { p_job_id: job.id });
      if (dbError) throw dbError;
      await load();
    } catch (err) { setError(`Approval failed: ${err.message}`); }
    finally { setApproving(null); }
  }
  async function logout() {
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError(`Sign out failed: ${authError.message}`);
  }
  const can = useCallback((permission) => Boolean(profile?.permissions.includes(permission)), [profile]);
  const nav = [
    can('bookings_view') && { key: 'agenda', icon: CalendarDays, label: 'Workshop agenda' },
    can('payments') && { key: 'payments', icon: CreditCard, label: 'Payments' },
    can('job_cards') && { key: 'cards', icon: ClipboardCheck, label: 'Job cards' },
    (can('bookings_view') || can('payments')) && { key: 'history', icon: ClipboardList, label: 'Completed jobs' },
    can('checks') && { key: 'lookup', icon: Search, label: 'Checks' },
    can('admin') && { key: 'admin', icon: UsersRound, label: 'Admin centre' },
  ].filter(Boolean);
  const allowedView = nav.some((item) => item.key === view);
  const firstView = nav[0]?.key;
  useEffect(() => { if (profile && !allowedView && firstView) setView(firstView); }, [profile, allowedView, firstView]);
  const jobsView = !['lookup', 'admin'].includes(view) && allowedView;
  const showCosts = can('payments');
  const pending = jobs.filter((job) => job.status === 'Pending Confirmation');
  const active = jobs.filter((job) => ['Booked', 'In Progress', 'Rescheduled'].includes(job.status));
  const outstanding = jobs.filter((job) => job.payment_status !== 'Paid' && job.status !== 'Pending Confirmation').reduce((sum, job) => sum + Number(job.amount_due || 0), 0);
  const filtered = jobs.filter((job) => {
    if (job.status === 'Pending Confirmation') return false;
    if (view === 'agenda' && job.booking_date !== date) return false;
    if (view === 'payments' && (job.payment_status === 'Paid' || Number(job.amount_due) <= 0)) return false;
    if (view === 'history' && job.status !== 'Completed') return false;
    return jobMatches(job, search, showCosts);
  });
  // Past receipts are easier to find with the most recent job first.
  if (view === 'history') filtered.reverse();
  const open = (job, tab = 'booking') => setEditing({ job, tab });
  const savedJob = useCallback(() => { void load(); }, [load]);
  const title = view === 'agenda' ? 'Workshop agenda' : view === 'payments' ? 'Payment tracking' : view === 'history' ? 'Completed jobs' : view === 'cards' ? 'Job cards' : view === 'admin' ? 'Admin centre' : 'Checks';

  return <div className="admin-layout">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}><div className="sidebar-label">YOUR WORKSHOP</div><nav>{nav.map(({ key, icon: Icon, label }) => <button key={key} className={view === key ? 'nav-active' : ''} onClick={() => { setView(key); setSearch(''); setMobileMenu(false); }}><Icon size={19} />{label}</button>)}<a href="/" target="_blank" rel="noreferrer"><House size={19} /> Public booking page <ArrowRight size={15} /></a></nav><div className="sidebar-bottom"><div className="owner-avatar">{(profile?.full_name || 'A').slice(0, 1).toUpperCase()}</div><div><strong>{profile?.full_name || 'Workshop team'}</strong><small>{profile?.role || session.user.email}</small></div><button onClick={() => setChangingPassword(true)} aria-label="Change password" title="Change password"><KeyRound size={17} /></button><button onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div></aside>
    {mobileMenu && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <div className="admin-main">
      <header className="admin-topbar"><button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={22} /></button><span><span className="dot" /> WORKSHOP MANAGEMENT</span><span className="topbar-date">{dateLabel(localDate(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></header>
      <main className="dashboard-content">
        <div className="page-heading"><div><p className="eyebrow">A GOOD DAY TO GET THINGS MOVING</p><h1>{title}<span>.</span></h1><p className="muted">{view === 'admin' ? 'Manage your team and who can do what.' : view === 'lookup' ? 'Quick vehicle checks for the workshop.' : 'Your bookings, your jobs, everything in one place.'}</p></div>{can('bookings_manage') && view !== 'admin' && <button className="button button-primary" disabled={!authorized} onClick={() => setCreating(true)}><Plus size={18} /> Add booking</button>}</div>
        <Notice>{error}</Notice>{error && <button className="button button-outline retry-button" onClick={load}>Retry connection</button>}
        {jobsView && <div className="stats-grid"><div className="stat-card"><span className="stat-icon"><CalendarDays size={21} /></span><div><small>On the books today</small><strong>{active.filter((job) => job.booking_date === localDate()).length}<span>vehicles</span></strong></div></div><div className="stat-card"><span className="stat-icon amber"><Clock3 size={21} /></span><div><small>Awaiting confirmation</small><strong>{pending.length}<span>requests</span></strong></div></div>{showCosts && <div className="stat-card"><span className="stat-icon"><CreditCard size={21} /></span><div><small>Outstanding payments</small><strong>{money(outstanding)}</strong></div></div>}</div>}
        {jobsView && pending.length > 0 && <section className="approval-section"><div className="section-title"><div><span className="amber-dot" /><h2>New booking requests</h2><span className="count-badge">{pending.length}</span></div><small>A quick review, then they're on the agenda.</small></div><div className="approval-list">{pending.map((job) => <div className="approval-card" key={job.id}><strong className="registration">{job.vehicle?.reg_no}</strong><div className="approval-person"><strong>{job.vehicle?.customer?.first_name} {job.vehicle?.customer?.last_name}</strong><span>{job.vehicle?.make} {job.vehicle?.model} &middot; {dateLabel(job.booking_date, { day: 'numeric', month: 'short' })}{job.booking_time && ` at ${slotLabel(job.booking_time)}`}</span>{job.service_type && <span>{job.service_type}</span>}{job.customer_address && <span>{job.customer_address.replaceAll('\n', ', ')}, {job.customer_postcode}</span>}<ContactFlag job={job} />{job.vehicle?.customer?.phone && <a href={`tel:${job.vehicle.customer.phone.replace(/[^\d+]/g, '')}`}>{job.vehicle.customer.phone}</a>}</div><div className="approval-actions"><button className="button button-outline button-small" disabled={approving !== null} onClick={() => open(job)}>{can('bookings_manage') ? 'Edit / delete booking' : 'View booking'}</button>{can('bookings_manage') && <button className="button button-primary button-small" disabled={approving !== null} onClick={() => approve(job)}>{approving === job.id ? <Spinner /> : <Check size={16} />} Approve booking</button>}</div></div>)}</div></section>}
        {!allowedView ? null : view === 'admin' ? <AdminCentre currentUserId={session.user.id} onChanged={savedJob} /> : view === 'lookup' ? <PlateLookup enabled={authorized} /> : view === 'cards' ? <JobCardsBoard jobs={jobs} loading={loading} authorized={authorized} showCosts={showCosts} onOpen={(job) => open(job, 'card')} /> : <section className={`agenda-panel ${calendarView === 'month' ? 'calendar-month' : ''}`}>
          {view === 'agenda' && <div className="calendar-view-toggle" role="group" aria-label="Calendar view"><button className="button button-small button-outline" aria-pressed={calendarView === 'week'} onClick={() => { setCalendarView('week'); setWeek(date); }}>Week</button><button className="button button-small button-outline" aria-pressed={calendarView === 'month'} onClick={() => setCalendarView('month')}>Whole month</button>{calendarView === 'month' && <button className="button button-small button-outline" onClick={() => setDate(localDate())}>Today</button>}</div>}
          {view === 'agenda' && calendarView === 'month' && <MonthCalendar date={date} jobs={jobs} onSelect={(day) => { setDate(day); setWeek(day); }} />}
          <div className="agenda-heading"><div><h2>{view === 'agenda' ? 'Your daily line-up' : view === 'payments' ? 'Outstanding balances' : 'Job history'}</h2><p className="muted">{view === 'agenda' ? dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : view === 'history' ? 'Most recent first. Open a job to view or print its receipt.' : 'Across all booking dates'}</p></div><div className="search-input"><Search size={17} /><input aria-label="Search jobs" placeholder={view === 'history' ? 'Name, car, amount or date' : 'Search name or registration'} value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          {view === 'agenda' && <><div className="calendar-controls"><button className="button button-outline button-small" onClick={() => { setDate(localDate()); setWeek(localDate()); }}>Today</button><label className="date-jump"><CalendarDays size={16} /><input type="date" aria-label="Go to agenda date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setWeek(e.target.value); } }} /></label><div className="week-controls"><button className="icon-button" aria-label="Previous seven days" onClick={() => { setWeek(addDays(week, -7)); setDate(addDays(week, -7)); }}><ChevronLeft size={20} /></button><button className="icon-button" aria-label="Next seven days" onClick={() => { setWeek(addDays(week, 7)); setDate(addDays(week, 7)); }}><ChevronRight size={20} /></button></div></div><div className="date-tabs">{Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((day) => { const count = active.filter((job) => job.booking_date === day).length; const held = pending.filter((job) => job.booking_date === day).length; return <button key={day} aria-pressed={date === day} className={date === day ? 'date-active' : ''} onClick={() => setDate(day)}><small>{dateLabel(day, { weekday: 'short' })}</small><strong>{dateLabel(day, { day: 'numeric' })}</strong>{count || held ? <DayMarkers booked={count} pending={held} /> : <span>No active jobs</span>}</button>; })}</div></>}
          <div className="job-table"><div className="job-table-head"><span>VEHICLE / CUSTOMER</span><span>{view === 'agenda' ? 'JOB STATUS' : 'DATE / STATUS'}</span><span>{showCosts && 'PAYMENT'}</span><span>{showCosts && 'AMOUNT'}</span><span /></div>
            {loading ? <div className="empty-state"><Spinner /><h3>Loading your workshop...</h3></div> : !authorized ? <div className="empty-state"><ShieldCheck size={34} /><h3>Workshop connection required</h3><p>Check the message above, then retry.</p></div> : filtered.length === 0 ? <div className="empty-state"><CalendarDays size={36} /><h3>{search ? 'No matching vehicles.' : view === 'agenda' ? 'A little breathing room.' : 'All clear.'}</h3><p>{search ? 'Try a different name or registration.' : view === 'agenda' ? 'No confirmed jobs for this day. Add a booking or choose another date.' : 'There are no jobs to show in this view.'}</p></div> : filtered.map((job) => <JobRow key={job.id} job={job} view={view} showCosts={showCosts} onOpen={() => open(job, view === 'history' && showCosts ? 'receipt' : 'booking')} />)}
          </div><div className="agenda-footer"><span>{filtered.length} {filtered.length === 1 ? 'job' : 'jobs'}{view === 'agenda' ? ' on this day' : ' in this view'}</span><span><span className="dot" /> Refreshes every 30 seconds</span></div>
        </section>}
        <footer className="dashboard-footer">Andy's Beechwood Car Care <span>Less admin. More time under the bonnet.</span></footer>
      </main>
    </div>
    {editing && <JobEditor key={editing.job.id} job={editing.job} initialTab={editing.tab} can={can} onClose={() => setEditing(null)} onSaved={savedJob} onDeleted={(id) => { ++requestRef.current; setJobs((current) => current.filter((job) => job.id !== id)); void load(); }} />}
    {changingPassword && <Modal title="Change password" onClose={() => setChangingPassword(false)}><ChangePassword onDone={() => setChangingPassword(false)} /></Modal>}
    {creating && <Modal title="Add a workshop booking" onClose={() => { if (window.confirm('Close the booking form? Any unsent details will be lost.')) setCreating(false); }}><BookingForm admin onCreated={() => { setCreating(false); void load(); }} /></Modal>}
  </div>;
}

export default function App() {
  const admin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(admin);
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    if (!admin || !supabase) { setChecking(false); return; }
    let alive = true;
    let authEventReceived = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || authEventReceived) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setChecking(false);
    }).catch((error) => { if (alive) { setAuthError(error.message); setChecking(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true;
      if (alive) { setSession(nextSession); setAuthError(''); setChecking(false); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [admin]);
  if (!admin) return <PublicPage />;
  if (checking) return <div className="app-loading"><Spinner /><p>Opening your workshop...</p></div>;
  if (session) return <Dashboard key={session.user.id} session={session} />;
  return <><Notice>{authError || configurationError}</Notice><Login /></>;
}
