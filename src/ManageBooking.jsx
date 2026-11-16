import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, LoaderCircle, Phone, X } from 'lucide-react';
import { AddToCalendar, SlotPicker } from './BookingFields.jsx';
import { dateLabel, slotLabel, WORKSHOP } from './utils.js';

const STATUS_TEXT = { 'Pending Confirmation': 'Awaiting confirmation', Booked: 'Confirmed', Rescheduled: 'Confirmed', 'In Progress': 'In the workshop', Completed: 'Completed', Cancelled: 'Cancelled', 'No-show': 'Missed' };

// Customers reach this page from the private link on their confirmation screen and emails.
export default function ManageBooking() {
  const token = new URLSearchParams(window.location.search).get('t') || '';
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/manage?t=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'This booking link is not valid.');
        if (alive) setBooking(data.booking);
      })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  async function act(body, message) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Please try again.');
      setBooking(data.booking);
      setMoving(false);
      setDone(message(data.booking));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const cancel = () => {
    if (!window.confirm('Cancel this booking? The time will be given to someone else.')) return;
    void act({ action: 'cancel' }, () => 'Your booking has been cancelled.');
  };
  const chooseDate = (day) => { setDate(day); setTime(''); setError(''); };
  const chooseTime = useCallback((slot) => { setTime(slot); setError(''); }, []);
  const move = () => {
    if (!date || !time) { setError('Please choose a day and time.'); return; }
    void act({ action: 'move', date, time }, (next) => (next.status === 'Booked' ? 'Your booking has moved. See you then!' : 'Your change has been sent. Andy will confirm your new time shortly.'));
  };

  return <main className="public-main manage-main shell">
    <section className="booking-card manage-card" aria-labelledby="manage-heading">
      <p className="eyebrow">YOUR BOOKING</p>
      <h1 id="manage-heading">{booking ? `${booking.reg_no} · ${booking.make} ${booking.model}` : 'Manage your booking'}</h1>
      {loading && <p className="lookup-status" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Finding your booking...</p>}
      {done && <div className="notice notice-success" role="status"><CheckCircle2 size={16} /> {done}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
      {booking && <>
        <dl className="review-list manage-details">
          <div><dt>When</dt><dd><span>{booking.booking_time ? `${dateLabel(booking.booking_date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${slotLabel(booking.booking_time)}` : dateLabel(booking.booking_date)}</span></dd></div>
          <div><dt>Service</dt><dd><span>{booking.service_type || 'To be confirmed'}</span></dd></div>
          <div><dt>Status</dt><dd><span className={`manage-status manage-${booking.status.toLowerCase().replaceAll(' ', '-')}`}>{STATUS_TEXT[booking.status] || booking.status}</span></dd></div>
        </dl>
        {booking.booking_time && booking.status !== 'Cancelled' && booking.status !== 'Completed' && <AddToCalendar booking={booking} uid={token} />}
        {booking.can_change && !moving && <div className="manage-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => { setMoving(true); setDone(''); }}><CalendarDays size={17} /> Change day or time</button>
          <button type="button" className="button button-outline" disabled={busy} onClick={cancel}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <X size={16} />} Cancel booking</button>
        </div>}
        {moving && <div className="wizard manage-move">
          <SlotPicker date={date} time={time} keep={`${booking.booking_date} ${booking.booking_time}`} onDate={chooseDate} onTime={chooseTime} />
          <div className="manage-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={move}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={17} />} Move my booking</button>
            <button type="button" className="button button-outline" disabled={busy} onClick={() => setMoving(false)}>Keep my current time</button>
          </div>
        </div>}
        {!booking.can_change && booking.status !== 'Cancelled' && <p className="muted">This booking can't be changed online any more. Please call us if anything has changed.</p>}
      </>}
      <p className="manage-help"><Phone size={15} /> Need a hand? Call <a href={`tel:${WORKSHOP.phone.replace(/[^\d+]/g, '')}`}>{WORKSHOP.phone}</a></p>
    </section>
  </main>;
}
