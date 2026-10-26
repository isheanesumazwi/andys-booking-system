export const JOB_STATUSES = ['Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed'];
export const PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Pay Later'];
export const WORKSHOP = { name: "Andy's Beechwood Car Care", address: '1A Warwick Rd, Newport NP19 8JJ, United Kingdom', phone: '+44 7915 392353', email: 'Andybeechwoodnp@gmail.com' };
export const SERVICES = ['MOT', 'MOT and Service', 'Service', 'Oil and oil filter change', 'Brake pads, discs and repair', 'Starter Motor replacement', 'Alternator replacement', 'Fault Finder'];
export const normalizeRegistration = (value) => value.toUpperCase().replace(/\s/g, '');
export const validRegistration = (value) => /^[A-Z0-9]{2,8}$/.test(normalizeRegistration(value));
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (date, days) => {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDate(result);
};
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
