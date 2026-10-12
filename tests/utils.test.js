import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate, money, normalizeRegistration, validRegistration, validateBooking } from '../src/utils.js';

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
