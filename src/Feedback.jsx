import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, MessageSquareText, Send, Star, Trash2, X } from 'lucide-react';
import supabase from './supabaseClient.js';
import { Field, Turnstile, TURNSTILE_SITE_KEY } from './BookingFields.jsx';
import { dateLabel } from './utils.js';

const RATING_WORDS = ['', 'Poor', 'Could be better', 'Okay', 'Good', 'Excellent'];
const COMMENT_LIMIT = 600;

function Stars({ rating, size = 16 }) {
  return <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= Math.round(rating) ? 'star-on' : 'star-off'} aria-hidden="true" />)}
  </span>;
}

function FeedbackDialog({ onClose }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [publish, setPublish] = useState(true);
  const [company, setCompany] = useState('');
  const [token, setToken] = useState('');
  const [tokenKey, setTokenKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!rating) { setError('Please choose a star rating.'); return; }
    if (TURNSTILE_SITE_KEY && !token) { setError('Please complete the security check.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, comment, name, publish, company, turnstile_token: token }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      setSent(true);
    } catch (err) {
      setError(`Your feedback could not be sent: ${err.message}`);
      if (TURNSTILE_SITE_KEY) { setToken(''); setTokenKey((value) => value + 1); }
    } finally { setBusy(false); }
  }

  return <dialog ref={ref} className="modal feedback-modal" aria-labelledby="feedback-title" onCancel={(e) => { e.preventDefault(); close.current(); }}>
    <header className="modal-header"><h2 id="feedback-title">{sent ? 'Thank you' : 'Your feedback'}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></header>
    <div className="modal-body">
      {sent ? <div className="feedback-sent" role="status">
        <CheckCircle2 size={36} aria-hidden="true" />
        <p><strong>Thanks for your feedback.</strong></p>
        <p className="muted">Andy reads every message. {publish ? 'Once approved, your review will appear on the website.' : "Your feedback stays private, as you asked."}</p>
        <button className="button button-primary" onClick={onClose}>Close</button>
      </div> : <form className="feedback-form" onSubmit={submit} noValidate>
        <fieldset className="rating-picker">
          <legend>How would you rate us?</legend>
          <div className="rating-stars" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}, ${RATING_WORDS[n]}`} className={n <= rating ? 'star-button star-on' : 'star-button'} onClick={() => { setRating(n); setError(''); }}><Star size={30} aria-hidden="true" /></button>)}
          </div>
          <span className="rating-word" aria-live="polite">{RATING_WORDS[rating] || 'Tap a star'}</span>
        </fieldset>
        <Field label="Your comments (optional)" hint={`What went well, or what could we do better on the site or in the workshop? ${comment.length}/${COMMENT_LIMIT}`}>
          <textarea rows={4} maxLength={COMMENT_LIMIT} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Field label="Your name as shown (optional)" hint="For example, Sam from Newport. Leave blank to post anonymously.">
          <input type="text" maxLength={60} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="consent"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> <span>Happy for this to be shown on our website once approved. Untick to keep it private.</span></label>
        <div className="trap" aria-hidden="true"><label>Company <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} /></label></div>
        <Turnstile key={tokenKey} onToken={setToken} />
        {error && <div className="notice" role="alert">{error}</div>}
        <button className="button button-primary button-wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Send size={17} />}{busy ? 'Sending...' : 'Send feedback'}</button>
      </form>}
    </div>
  </dialog>;
}

export function FeedbackButton({ className = 'feedback-link', children }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>{children || <><Star size={14} aria-hidden="true" /> Rate us</>}</button>
    {open && <FeedbackDialog onClose={() => setOpen(false)} />}
  </>;
}

// Approved reviews on the home page. Until there are any, a small invitation to leave the first one.
export function Reviews() {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.rpc('published_reviews').then(({ data: result, error }) => { if (alive && !error) setData(result); });
    return () => { alive = false; };
  }, []);
  const reviews = data?.reviews || [];
  return <section className="reviews shell" aria-labelledby="reviews-heading">
    <div className="reviews-heading">
      <div><p className="eyebrow"><span className="tiny-line" /> CUSTOMER REVIEWS</p><h2 id="reviews-heading">What our customers say</h2>
        {data?.count > 0 && <p className="reviews-average"><Stars rating={Number(data.average)} size={18} /> <strong>{Number(data.average).toFixed(1)}</strong> from {data.count} {data.count === 1 ? 'review' : 'reviews'}</p>}</div>
      <FeedbackButton className="button button-outline button-small"><MessageSquareText size={16} aria-hidden="true" /> Leave a review</FeedbackButton>
    </div>
    {reviews.length === 0 ? <p className="muted reviews-empty">No reviews yet. Been in recently? We'd love to hear how it went.</p>
      : <ul className="review-cards">{reviews.map((review) => <li key={review.id}>
        <Stars rating={review.rating} />
        {review.comment && <p>{review.comment}</p>}
        <small>{review.name || 'A customer'} · {dateLabel(review.date, { month: 'long', year: 'numeric' })}</small>
      </li>)}</ul>}
  </section>;
}

const FILTERS = [['Pending', 'To review'], ['Approved', 'On the website'], ['Hidden', 'Hidden'], ['all', 'All']];

// Admins approve reviews onto the website, or hide them. Private feedback can only be read and hidden.
export function FeedbackAdmin() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('Pending');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(null);
  const load = useCallback(async () => {
    setError('');
    const { data, error: dbError } = await supabase.rpc('list_feedback');
    if (dbError) { setError(dbError.code === 'PGRST202' ? 'Reviews are not set up yet. Run supabase/feedback.sql in Supabase.' : dbError.message); setItems([]); return; }
    setItems(data || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(item, action) {
    if (action === 'delete' && !window.confirm('Delete this feedback permanently?')) return;
    setWorking(item.id);
    setError('');
    const { error: dbError } = action === 'delete'
      ? await supabase.rpc('delete_feedback', { p_id: item.id })
      : await supabase.rpc('review_feedback', { p_id: item.id, p_status: action });
    setWorking(null);
    if (dbError) { setError(dbError.message); return; }
    await load();
  }

  const shown = (items || []).filter((item) => filter === 'all' || item.status === filter);
  const waiting = (items || []).filter((item) => item.status === 'Pending').length;
  return <section className="agenda-panel feedback-panel">
    <div className="agenda-heading"><div><h2>Reviews & feedback</h2><p className="muted">Approved reviews appear on the home page straight away. Private feedback is only seen here.</p></div>
      <label className="history-filter"><span className="sr-only">Show</span><select value={filter} onChange={(e) => setFilter(e.target.value)}>{FILTERS.map(([key, label]) => <option key={key} value={key}>{label}{key === 'Pending' && waiting ? ` (${waiting})` : ''}</option>)}</select></label></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {items === null ? <div className="empty-state"><LoaderCircle className="spin" size={22} aria-hidden="true" /><h3>Loading...</h3></div>
      : shown.length === 0 ? <div className="empty-state"><MessageSquareText size={34} aria-hidden="true" /><h3>Nothing here.</h3><p>{filter === 'Pending' ? 'No new feedback to review.' : 'No feedback in this list.'}</p></div>
      : <ul className="feedback-list">{shown.map((item) => <li key={item.id}>
        <div className="feedback-meta"><Stars rating={item.rating} /><span className={`feedback-status status-${item.status.toLowerCase()}`}>{item.status === 'Approved' ? 'On the website' : item.status === 'Pending' ? 'To review' : 'Hidden'}</span>{!item.can_publish && <span className="feedback-private">Private</span>}</div>
        <p className={item.comment ? '' : 'muted'}>{item.comment || 'No comments, just a rating.'}</p>
        <small>{item.display_name || 'No name given'} · {dateLabel(item.created_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</small>
        <div className="feedback-actions">
          {item.can_publish && item.status !== 'Approved' && <button className="button button-primary button-small" disabled={working === item.id} onClick={() => act(item, 'Approved')}><Eye size={15} /> Approve and publish</button>}
          {item.status !== 'Hidden' && <button className="button button-outline button-small" disabled={working === item.id} onClick={() => act(item, 'Hidden')}><EyeOff size={15} /> {item.status === 'Approved' ? 'Take off website' : 'Hide'}</button>}
          <button className="button button-danger button-small" disabled={working === item.id} onClick={() => act(item, 'delete')}><Trash2 size={15} /> Delete</button>
        </div>
      </li>)}</ul>}
  </section>;
}
