import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, dateLabel, localDate, monthDays } from './utils.js';

export function DayMarkers({ booked, pending }) {
  return <span className="day-markers" aria-hidden="true">{booked > 0 && <b className="marker-booked">{booked}</b>}{pending > 0 && <b className="marker-pending">{pending}</b>}</span>;
}

export default function MonthCalendar({ date, jobs, onSelect }) {
  return <section className="month-calendar" aria-label="Monthly workshop calendar">
    <div className="month-heading"><button type="button" className="icon-button" aria-label="Previous month" onClick={() => onSelect(addMonths(date, -1))}><ChevronLeft size={20} /></button><h3 aria-live="polite">{dateLabel(date, { month: 'long', year: 'numeric' })}</h3><button type="button" className="icon-button" aria-label="Next month" onClick={() => onSelect(addMonths(date, 1))}><ChevronRight size={20} /></button></div>
    <div className="month-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="month-grid">{monthDays(date).map((day) => {
      const daily = jobs.filter((job) => job.booking_date === day);
      const pending = daily.filter((job) => job.status === 'Pending Confirmation').length;
      const booked = daily.filter((job) => job.status !== 'Pending Confirmation' && job.status !== 'Completed').length;
      return <button type="button" key={day} aria-pressed={date === day} aria-current={day === localDate() ? 'date' : undefined} aria-label={`${dateLabel(day)}, ${booked} booked${pending ? `, ${pending} pending` : ''}`} className={`${day.slice(0, 7) !== date.slice(0, 7) ? 'outside-month' : ''} ${date === day ? 'month-selected' : ''}`} onClick={() => onSelect(day)}><strong>{Number(day.slice(8))}</strong><DayMarkers booked={booked} pending={pending} /></button>;
    })}</div><div className="slot-legend calendar-legend"><span className="legend-day-booked">Booked</span><span className="legend-day-pending">Pending</span></div><p className="muted">Select a day to view its confirmed jobs below. Pending requests are shown in the review queue.</p>
  </section>;
}
