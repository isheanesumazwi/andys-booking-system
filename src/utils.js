export const JOB_STATUSES = ['Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed'];
export const PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Pay Later'];
export const normalizeRegistration = (value) => value.toUpperCase().replace(/\s/g, '');
export const validRegistration = (value) => /^[A-Z0-9]{2,8}$/.test(normalizeRegistration(value));
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (date, days) => {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDate(result);
};
export const dateLabel = (date, options = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', options);
export const money = (amount) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(amount || 0));
export function validateBooking(form) {
  if (!form.first_name.trim() || !form.last_name.trim()) return 'Please enter your first and last name.';
  if (form.first_name.trim().length > 80 || form.last_name.trim().length > 80) return 'Names must be 80 characters or fewer.';
  if (!/^\+?[\d ()-]{7,25}$/.test(form.phone) || form.phone.replace(/\D/g, '').length < 7) return 'Please enter a valid contact phone number.';
  if (!validRegistration(form.reg_no)) return 'Please enter a registration with 2-8 letters or numbers.';
  if (!form.make.trim() || !form.model.trim()) return 'Please enter the vehicle make and model, or use vehicle lookup.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.booking_date) || form.booking_date < localDate()) return 'Please choose today or a future booking date.';
  return '';
}
