export const PERMISSIONS = [
  ['bookings_view', 'See bookings', 'Agenda, customer details and completed jobs'],
  ['bookings_manage', 'Manage bookings', 'Add, approve, edit and reschedule bookings'],
  ['bookings_delete', 'Delete bookings', 'Permanently remove bookings'],
  ['job_cards', 'Job cards', 'Fill in job cards, photos and job status'],
  ['payments', 'Prices & payments', 'See and edit prices, payments and receipts'],
  ['checks', 'Checks', 'Run plate and vehicle checks'],
  ['admin', 'Admin centre', 'Add people and change who can do what'],
];

export const ROLES = {
  Owner: PERMISSIONS.map(([key]) => key),
  Manager: ['bookings_view', 'bookings_manage', 'bookings_delete', 'job_cards', 'payments', 'checks'],
  'Front desk': ['bookings_view', 'bookings_manage', 'payments', 'checks'],
  Mechanic: ['bookings_view', 'job_cards', 'checks'],
};
export const CUSTOM_ROLE = 'Custom';

// A role name only describes a preset, so changing the ticks makes the person Custom.
export function roleFor(permissions) {
  const match = Object.entries(ROLES).find(([, keys]) => keys.length === permissions.length && keys.every((key) => permissions.includes(key)));
  return match ? match[0] : CUSTOM_ROLE;
}
