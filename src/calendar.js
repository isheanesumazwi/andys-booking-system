import { WORKSHOP } from './utils.js';

// Times are written without a timezone, so calendars read them as local time, which is UK time for our customers.
function stamp(date, time, addMinutes = 0) {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes + addMinutes;
  return `${date.replaceAll('-', '')}T${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}00`;
}

export function calendarEvent({ booking_date: date, booking_time: time, service_type: service, reg_no: reg, status }) {
  const waiting = status === 'Pending Confirmation';
  return {
    title: `${service || 'Car service'} at Beechwood Car Care${waiting ? ' (awaiting confirmation)' : ''}`,
    details: `${reg ? `Vehicle: ${reg}. ` : ''}Questions? Call ${WORKSHOP.phone}.`,
    location: WORKSHOP.address,
    start: stamp(date, time),
    end: stamp(date, time, 60),
  };
}

const escapeText = (value) => String(value).replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r?\n/g, '\\n');
// Calendar files wrap lines longer than 75 characters onto continuation lines that start with a space.
const fold = (line) => (line ? line.match(/.{1,74}/g).join('\r\n ') : line);

export function icsFile(event, uid) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Beechwood Car Care//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@beechwood-car-care`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${event.start}`,
    `DTEND:${event.end}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.details)}`,
    `LOCATION:${escapeText(event.location)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

export function googleCalendarLink(event) {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.title);
  url.searchParams.set('dates', `${event.start}/${event.end}`);
  url.searchParams.set('details', event.details);
  url.searchParams.set('location', event.location);
  url.searchParams.set('ctz', 'Europe/London');
  return url.toString();
}
