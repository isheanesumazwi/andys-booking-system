import { useState } from 'react';
import { BellRing, LoaderCircle, MessageCircle, Phone } from 'lucide-react';
import { dateLabel, motDueList, whatsappLink, WORKSHOP } from './utils.js';

const WINDOWS = [[30, 'Next 30 days'], [60, 'Next 60 days'], [90, 'Next 90 days'], [365, 'Next year']];

function reminder({ contact, due }) {
  const first = contact.name.split(' ')[0] || 'there';
  const car = [contact.make, contact.model].filter(Boolean).join(' ');
  return `Hi ${first}, it's Andy at ${WORKSHOP.name}. The MOT on your ${car} (${contact.reg_no}) is due around ${dateLabel(due)}. Reply here or book online at ${window.location.origin}/book to get it sorted.`;
}

export default function MotDue({ jobs, loading }) {
  const [within, setWithin] = useState(60);
  const due = motDueList(jobs, undefined, within);
  return <section className="agenda-panel mot-panel">
    <div className="agenda-heading"><div><h2>MOTs coming up</h2><p className="muted">Worked out from MOTs we've completed, a year on. Cars already booked in for an MOT are left out.</p></div>
      <label className="mot-window"><span className="sr-only">Show MOTs due in</span><select value={within} onChange={(e) => setWithin(Number(e.target.value))}>{WINDOWS.map(([days, label]) => <option key={days} value={days}>{label}</option>)}</select></label></div>
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={22} aria-hidden="true" /><h3>Loading...</h3></div>
      : due.length === 0 ? <div className="empty-state"><BellRing size={34} /><h3>No MOTs due.</h3><p>Nothing in this window. Try a longer one.</p></div>
      : <ul className="mot-list">{due.map((item) => {
        const link = whatsappLink(item.contact.phone, reminder(item));
        return <li key={item.contact.reg_no}>
          <strong className="registration">{item.contact.reg_no}</strong>
          <div className="mot-person"><strong>{item.contact.name || 'Customer'}</strong><span>{item.contact.make} {item.contact.model}</span><small>Last MOT {dateLabel(item.lastMot, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
          <div className="mot-due"><span className={item.overdue ? 'mot-overdue' : ''}>{item.overdue ? 'Overdue' : 'Due'} {dateLabel(item.due, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
          <div className="mot-actions">
            {link && <a className="button button-primary button-small whatsapp-button" href={link} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
            {item.contact.phone && <a className="button button-outline button-small" href={`tel:${item.contact.phone.replace(/[^\d+]/g, '')}`}><Phone size={15} /> Call</a>}
          </div>
        </li>;
      })}</ul>}
    <div className="agenda-footer"><span>{due.length} {due.length === 1 ? 'car' : 'cars'} due</span><span>WhatsApp opens with a reminder ready to send</span></div>
  </section>;
}
