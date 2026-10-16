import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, monthDays, localDate, money, normalizeRegistration, validRegistration, validateBooking } from '../src/utils.js';

const booking = { first_name: 'James', last_name: 'Taylor', phone: '07700 900123', reg_no: 'AB12 CDE', make: 'Ford', model: 'Focus', booking_date: addDays(localDate(), 1) };

test('registration normalization preserves only letters and numbers validation', () => {
  assert.equal(normalizeRegistration(' ab12 cde '), 'AB12CDE');
  assert.equal(validRegistration('ab12 cde'), true);
  for (const value of ['', 'A', 'AB-123', '123456789', '<script>']) assert.equal(validRegistration(value), false);
});
test('booking validates required details, phone and future date', () => {
  assert.equal(validateBooking(booking), '');
  for (const patch of [{ first_name: ' ' }, { last_name: '' }, { phone: 'abcdefg' }, { phone: '-------' }, { make: '' }, { model: '' }, { booking_date: '2020-01-01' }, { reg_no: '!!' }]) {
    assert.notEqual(validateBooking({ ...booking, ...patch }), '');
  }
});
test('date helpers handle month boundaries using local calendar dates', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(localDate(new Date(2026, 0, 2, 23)), '2026-01-02');
});
test('money formats GBP', () => {
  assert.equal(money(1234.5), '£1,234.50');
  assert.equal(money(null), '£0.00');
});
test('whole month calendar covers every date with Monday-first complete weeks', () => {
  const october = monthDays('2026-10-16');
  assert.equal(october[0], '2026-09-28');
  assert.equal(october.at(-1), '2026-11-01');
  assert.equal(october.length, 35);
  assert.equal(october.filter((day) => day.startsWith('2026-10')).length, 31);
  assert.equal(monthDays('2026-03-20').length, 42);
  assert.equal(monthDays('2024-02-20').filter((day) => day.startsWith('2024-02')).length, 29);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-01');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
});
test('amendments accept past appointments but never invalid dates or years', () => {
  assert.equal(validateBooking({ ...booking, booking_date: '2020-01-01' }, { allowPast: true }), '');
  for (const booking_date of ['2026-02-30', '2026-13-01', '', 'tomorrow']) {
    assert.notEqual(validateBooking({ ...booking, booking_date }, { allowPast: true }), '');
  }
  for (const year of ['1800', 'nope', '2020.5', '9999']) {
    assert.notEqual(validateBooking({ ...booking, year }), '');
  }
});
