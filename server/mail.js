import nodemailer from 'nodemailer';
import { calendarEvent, icsFile } from '../src/calendar.js';
import { dateLabel, slotLabel, WORKSHOP } from '../src/utils.js';

// Sent from the workshop's Gmail with an app password. Gmail allows about 500 emails a day.
export function gmailSender(env) {
  const user = env.GMAIL_USER;
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  return (message) => transport.sendMail({ from: `"${WORKSHOP.name}" <${user}>`, replyTo: user, ...message });
}

export const workshopInbox = (env) => env.WORKSHOP_NOTIFY_EMAIL || env.GMAIL_USER || '';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const when = (booking) => `${dateLabel(booking.booking_date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${slotLabel(booking.booking_time)}`;

function lead(kind, booking) {
  const date = when(booking);
  if (booking.status === 'Cancelled') return ['Your booking has been cancelled', `Your booking for ${date} has been cancelled. We hope to see you another time.`];
  if (kind === 'confirmed') return ['Your booking is confirmed', `Good news: Andy has confirmed your booking for ${date}. See you then!`];
  if (kind === 'moved') return booking.status === 'Booked'
    ? ['Your booking has moved', `Your booking has moved to ${date}. See you then!`]
    : ['Change request received', `Thanks. Andy will confirm your new time of ${date} shortly. Please wait for confirmation before bringing your car in.`];
  if (kind === 'booked') return booking.status === 'Booked'
    ? ["You're booked in", `Thanks for booking with us. Your ${booking.service_type || 'booking'} is confirmed for ${date}.`]
    : ['Booking request received', `Thanks for your request for ${date}. Andy will confirm it shortly. Please wait for confirmation before bringing your car in.`];
  return ['An update on your booking', `Here are the latest details of your booking for ${date}.`];
}

export function customerEmail(kind, booking, site) {
  const [heading, intro] = lead(kind, booking);
  const rows = [
    ['When', when(booking)],
    ['Service', booking.service_type || 'To be confirmed'],
    ['Car', [booking.reg_no, booking.make, booking.model].filter(Boolean).join(' ')],
    ['Status', booking.status === 'Pending Confirmation' ? 'Awaiting confirmation' : booking.status],
    ['Where', WORKSHOP.address],
  ];
  const manage = booking.can_change && booking.token ? `${site}/manage?t=${booking.token}` : '';
  const text = [
    `Hi ${booking.first_name || 'there'},`, '', intro, '',
    ...rows.map(([label, value]) => `${label}: ${value}`), '',
    ...(manage ? [`Need to change or cancel? Use your private link: ${manage}`, ''] : []),
    `Questions? Call ${WORKSHOP.phone} or reply to this email.`, '', WORKSHOP.name,
  ].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#24382f;max-width:520px;line-height:1.6">
<h2 style="color:#183c30;margin:0 0 12px">${escapeHtml(heading)}</h2>
<p>Hi ${escapeHtml(booking.first_name || 'there')},</p><p>${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin:16px 0">${rows.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#788179">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`).join('')}</table>
${manage ? `<p><a href="${escapeHtml(manage)}" style="display:inline-block;background:#183c30;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Change or cancel my booking</a></p>` : ''}
<p>Questions? Call <a href="tel:${WORKSHOP.phone.replace(/[^\d+]/g, '')}">${escapeHtml(WORKSHOP.phone)}</a> or reply to this email.</p>
<p>${escapeHtml(WORKSHOP.name)}</p></div>`;
  const attachments = booking.status === 'Cancelled' ? [] : [{ filename: 'booking.ics', content: icsFile(calendarEvent(booking), booking.job_id), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
  return { to: booking.email, subject: `${heading}: ${when(booking)}`, text, html, attachments };
}

export function workshopEmail(kind, booking, site, to) {
  const what = kind === 'cancelled' ? 'Customer cancelled' : kind === 'moved' ? 'Customer moved a booking' : 'New online booking';
  const status = booking.status === 'Pending Confirmation' ? 'needs confirming' : booking.status.toLowerCase();
  return {
    to,
    subject: `${what}: ${booking.reg_no} on ${when(booking)} (${status})`,
    text: [`${what}.`, '', `When: ${when(booking)}`, `Service: ${booking.service_type || ''}`, `Car: ${[booking.reg_no, booking.make, booking.model].filter(Boolean).join(' ')}`,
      `Customer: ${booking.first_name || ''}${booking.email ? ` (${booking.email})` : ''}`, `Status: ${booking.status}`, '', `Open the workshop: ${site}/admin`].join('\n'),
  };
}
