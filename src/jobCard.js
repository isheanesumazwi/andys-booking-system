export const CHECK_RESULTS = [['ok', 'OK'], ['advisory', 'Advisory'], ['repair', 'Repair reqd']];
export const WHEEL_POSITIONS = [['osf', 'O/S F'], ['nsf', 'N/S F'], ['osr', 'O/S R'], ['nsr', 'N/S R'], ['spare', 'Spare']];
export const DAMAGE_TYPES = ['Scratch', 'Dent', 'Chip', 'Crack', 'Scuff', 'Rust', 'Missing'];

// Numbering and wording follow the workshop's paper service checklist.
export const CHECKLIST = [
  { title: 'General checks', items: [
    [1, 'Fit protective covers to seat, floor and steering wheel'],
    [2, 'Timing belt replacement interval', [['timing_miles', 'miles'], ['timing_years', 'yr']]],
    [3, 'Damage to bodywork'],
    [4, 'Review vehicle history'],
    [5, 'All seat belts'],
    [6, 'Remove internal contamination'],
    [7, 'Operation of ABS and air bag warning lights'],
    [8, 'Air conditioning/heater operation'],
    [9, 'Wiper blades and washers'],
    [10, 'Horn'],
    [11, 'Headlight alignment'],
    [12, 'Door hinge, locks, and bonnet catch lubrication'],
    [13, 'Interior and exterior lights'],
    [14, 'Fuel cap'],
  ] },
  { title: 'Engine bay checks', items: [
    [15, 'Cooling system and fan operation'],
    [16, 'Anti-freeze protection', [['antifreeze_c', '°C']]],
    [17, 'Power steering operation and fluid condition'],
    [18, 'Auxiliary drive belts'],
    [19, 'Engine breather system'],
    [20, 'Vacuum pipes'],
    [21, 'Brake fluid condition'],
    [22, 'Throttle body'],
    [23, 'Battery level and lubricate terminals'],
    [24, 'Check oil level. Top up all under bonnet fluid levels'],
    [25, 'Replace fuel filter'],
    [26, 'Replace spark plugs'],
    [27, 'Replace air filter'],
    [28, 'Replace pollen filter'],
  ] },
  { title: 'Raised vehicle checks', items: [
    [29, 'Exhaust condition and security'],
    [30, 'Fit new sump plug washer and oil filter'],
    [31, 'All steering, suspension joints, mountings and gaiters'],
    [32, 'Top up gearbox oil level'],
    [33, 'Top up axle and transfer box oil levels'],
    [34, 'Brake pipes and fuel lines'],
    [35, 'Suspension dampers & road springs'],
    [36, 'CV gaiters and joints for wear or splits'],
    [37, "All wheel bearings for excessive 'play' and noise (adjust)"],
    [38, 'Clutch cable/cylinder'],
    [39, 'Grease all greasing points'],
    [40, 'Operation and condition of front brakes'],
    [41, 'Operation and condition of rear brakes (inc. handbrake)'],
    [42, 'Carry out brake report'],
  ] },
  { title: 'Lowered vehicle checks & to finish', items: [
    [43, 'Refill engine with specified grade oil', [['oil_grade', 'grade']]],
    [44, 'Torque wheel nuts/studs. Locking wheel nut location', [['locking_nut_location', 'location']]],
    [45, 'Re-check engine oil level'],
    [46, 'Road test vehicle and report any findings'],
    [47, 'Carry out emission report'],
    [48, 'Reset service interval indicator'],
    [49, 'Ensure all upholstery, gear lever, steering, etc. are clean'],
    [50, 'Stamp service book(s)'],
  ] },
];

export const CHECK_LABELS = Object.fromEntries(CHECKLIST.flatMap((section) => section.items.map(([id, label]) => [id, label])));

const wheels = (fields) => Object.fromEntries(WHEEL_POSITIONS.map(([key]) => [key, Object.fromEntries(fields.map((field) => [field, '']))]));

export const emptyCard = () => ({
  mileage: '', oil_level: '', chassis: '', concern: '', diagnosis: '',
  checks: {}, values: {},
  tyres: wheels(['condition', 'pressure', 'tread']), tyre_size: '', torque: '', tyre_kit_expiry: '', tyres_replace: false,
  brakes: wheels(['pads', 'discs']), brake_fluid_replace: false,
  emissions: { fuel: '', hc: '', co: '', co2: '', o2: '', lambda: '', km: '' },
  damage: {}, inspection_notes: '',
  parts: [], labour: [],
  work_notes: '', additional_work: '', advisory_report: '',
  qc_notes: '', qc_passed: false, technician: '', date_in: '', date_completed: '', photo_taken: false, photo_shared: false,
});

const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

// Fill in any fields missing from cards saved by older versions of the app.
export function normalizeCard(raw) {
  const card = object(raw);
  const base = emptyCard();
  const merged = { ...base, ...card };
  for (const key of ['checks', 'values', 'emissions', 'damage']) merged[key] = { ...base[key], ...object(card[key]) };
  for (const key of ['tyres', 'brakes']) {
    merged[key] = Object.fromEntries(WHEEL_POSITIONS.map(([wheel]) => [wheel, { ...base[key][wheel], ...object(object(card[key])[wheel]) }]));
  }
  merged.parts = Array.isArray(card.parts) ? card.parts.map((part) => ({ description: '', part_no: '', qty: '1', unit_cost: '', ...object(part) })) : [];
  merged.labour = Array.isArray(card.labour) ? card.labour.map((line) => ({ description: '', hours: '', rate: '', ...object(line) })) : [];
  return merged;
}

const amount = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };
const pence = (value) => Math.round(value * 100) / 100;
export const partCost = (part) => pence(amount(part.qty) * amount(part.unit_cost));
export const labourCost = (line) => pence(amount(line.hours) * amount(line.rate));

export function cardTotals(card) {
  const parts = pence(card.parts.reduce((sum, part) => sum + partCost(part), 0));
  const labour = pence(card.labour.reduce((sum, line) => sum + labourCost(line), 0));
  return { parts, labour, total: pence(parts + labour) };
}

export function checkSummary(card) {
  const counts = { ok: 0, advisory: 0, repair: 0 };
  for (const value of Object.values(card.checks)) if (value in counts) counts[value] += 1;
  return counts;
}
