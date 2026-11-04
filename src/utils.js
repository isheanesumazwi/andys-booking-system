export const JOB_STATUSES = ['Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed'];
export const PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Pay Later'];
export const WORKSHOP = { name: "Andy's Beechwood Car Care", address: '1A Warwick Rd, Newport NP19 8JJ, United Kingdom', phone: '+44 7915 392353', email: 'Andybeechwoodnp@gmail.com' };
export const SERVICE_PACKAGES = [
  ['Interim service', 'Oil and oil filter change'],
  ['Full service', 'Oil, oil and air filter change, plus a top-up of brake fluid and coolant if needed'],
  ['Major service', 'Oil, oil and air filter change, brake fluid and coolant flushed and replaced, and a new pollen filter'],
];
export const isAutoConfirmed = (service) => SERVICE_PACKAGES.some(([name]) => name.toLowerCase() === service.trim().toLowerCase());
export const BOOKING_SLOTS = ['10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30'];
export const slotLabel = (slot) => { const hour = Number(slot.slice(0, 2)); return `${hour > 12 ? hour - 12 : hour}:${slot.slice(3, 5)}${hour >= 12 ? 'pm' : 'am'}`; };
export const OPENING_HOURS = 'Wednesdays and Thursdays, 10:30am to 5:30pm';
export const SERVICES = [...SERVICE_PACKAGES.map(([name]) => name), 'MOT', 'MOT and Service', 'Service', 'Brake pads, discs and repair', 'Starter Motor replacement', 'Alternator replacement', 'Fault Finder'];
export const normalizeRegistration = (value) => value.toUpperCase().replace(/\s/g, '');
export const normalizePostcode = (value) => {
  const compact = value.toUpperCase().replace(/\s/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
};
export const validPostcode = (value) => /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(normalizePostcode(value));
export const validRegistration = (value) => /^[A-Z0-9]{2,8}$/.test(normalizeRegistration(value));
export const validEmail = (value) => value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (date, days) => {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDate(result);
};
// Online booking days. Sundays are arranged by the workshop after confirming a job.
export function bookingDates(from = localDate(), weeks = 8) {
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i)).filter((day) => [3, 4].includes(new Date(`${day}T12:00:00`).getDay()));
}
export const addMonths = (date, months) => {
  const result = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  result.setMonth(result.getMonth() + months);
  return localDate(result);
};
export function monthDays(date) {
  const first = `${date.slice(0, 7)}-01`;
  const offset = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;
  const days = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => addDays(first, i - offset));
}
export const dateLabel = (date, options = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', options);
export const money = (amount) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(amount || 0));
// Completed jobs show their saved copy; other jobs show who booked them.
export function jobContact(job) {
  const record = job.completed_record;
  const customer = job.vehicle?.customer;
  return {
    name: record?.name || job.contact_name || `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
    phone: record?.phone || job.contact_phone || customer?.phone || '',
    email: record?.email || job.contact_email || '',
    reg_no: record?.reg_no || job.vehicle?.reg_no || '',
    make: record?.make || job.vehicle?.make || '',
    model: record?.model || job.vehicle?.model || '',
  };
}
const dateTerms = (date) => (date ? `${date} ${dateLabel(date)} ${dateLabel(date, { day: '2-digit', month: '2-digit', year: 'numeric' })}` : '');
// Every word typed must match, so "ford 120" or "5 nov" narrow the list.
export function jobMatches(job, search, showCosts = false) {
  const { name, reg_no: reg, make, model } = jobContact(job);
  const amount = showCosts ? `${Number(job.amount_due || 0)} ${Number(job.amount_due || 0).toFixed(2)} ${money(job.amount_due)}` : '';
  const text = `${reg} ${make} ${model} ${name} ${job.service_type || ''} ${amount} ${dateTerms(job.booking_date)} ${dateTerms(job.completed_at?.slice(0, 10) || job.job_card?.date_completed)}`.toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}
export function validateBooking(form, { allowPast = false } = {}) {
  if (!form.first_name.trim() || !form.last_name.trim()) return 'Please enter your first and last name.';
  if (form.first_name.trim().length > 80 || form.last_name.trim().length > 80) return 'Names must be 80 characters or fewer.';
  if (!/^\+?[\d ()-]{7,25}$/.test(form.phone) || form.phone.replace(/\D/g, '').length < 7) return 'Please enter a valid contact phone number.';
  if (!validRegistration(form.reg_no)) return 'Please enter a registration with 2-8 letters or numbers.';
  if (!form.make.trim() || !form.model.trim()) return 'Please enter the vehicle make and model, or use vehicle lookup.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.booking_date) || localDate(new Date(`${form.booking_date}T12:00:00`)) !== form.booking_date || (!allowPast && form.booking_date < localDate())) return allowPast ? 'Please choose a valid booking date.' : 'Please choose today or a future booking date.';
  if (form.year && (!Number.isInteger(Number(form.year)) || Number(form.year) < 1886 || Number(form.year) > new Date().getFullYear() + 1)) return 'Please enter a valid vehicle year.';
  return '';
}
