import { useEffect, useState } from 'react';
import { BadgeCheck, CarFront, Check, Camera, ChevronRight, ClipboardCheck, LoaderCircle, NotebookPen, Package, Plus, ScanSearch, Search, Stethoscope, Trash2 } from 'lucide-react';
import { CHECK_LABELS, CHECK_RESULTS, CHECKLIST, DAMAGE_TYPES, JOB_PHOTO_BUCKET, WHEEL_POSITIONS, cardTotals, checkSummary, jobProgress, labourCost, partCost, withLabourCost } from './jobCard.js';
import { dateLabel, jobContact, jobMatches, money, slotLabel, WORKSHOP } from './utils.js';
import { Field } from './BookingFields.jsx';
import supabase from './supabaseClient.js';

function Step({ number, title, icon: Icon, summary, children }) {
  return <details className="card-step" open>
    <summary><span className="card-step-number">{number}</span><Icon size={18} /><strong>{title}</strong>{summary && <small>{summary}</small>}</summary>
    <div className="card-step-body">{children}</div>
  </details>;
}

function ChecklistSection({ section, card, onCheck, onValue, onAllOk }) {
  const done = section.items.filter(([id]) => card.checks[id]).length;
  return <div className="checklist-section">
    <div className="checklist-heading"><h4>{section.title}</h4><small>{done} of {section.items.length} checked</small><button type="button" className="button button-outline button-small" onClick={() => onAllOk(section)}>Mark unset as OK</button></div>
    <div className="checklist-columns" aria-hidden="true"><span>No.</span><span>Check</span><div>{CHECK_RESULTS.map(([value, text]) => <span key={value}>{text}</span>)}</div></div>
    {section.items.map(([id, label, inputs = []]) => <div className="checklist-row" key={id}>
      <span className="checklist-number">{id}</span>
      <div className="checklist-label"><span>{label}</span>{inputs.length > 0 && <div className="checklist-inputs">{inputs.map(([key, suffix]) => <label key={key} className="checklist-input"><input aria-label={`${label} ${suffix}`} maxLength={80} value={card.values[key] || ''} onChange={(e) => onValue(key, e.target.value)} /><small>{suffix}</small></label>)}</div>}</div>
      <div className="check-buttons" role="group" aria-label={`${id}. ${label}`}>{CHECK_RESULTS.map(([value, text]) => <button type="button" key={value} className={`check-${value}`} aria-pressed={card.checks[id] === value} onClick={() => onCheck(id, card.checks[id] === value ? null : value)}>{card.checks[id] === value && <Check size={14} aria-hidden="true" />}<span>{text}</span></button>)}</div>
    </div>)}
  </div>;
}

function WheelTable({ caption, rows, values, wheels, onChange }) {
  return <div className="wheel-table-wrap"><table className="wheel-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col" />{wheels.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
    <tbody>{rows.map(([field, label]) => <tr key={field}><th scope="row">{label}</th>{wheels.map(([wheel, wheelLabel]) => <td key={wheel}><input aria-label={`${caption} ${label} ${wheelLabel}`} maxLength={40} value={values[wheel][field]} onChange={(e) => onChange(wheel, field, e.target.value)} /></td>)}</tr>)}</tbody>
  </table></div>;
}

const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;
// Top-down view, front of the car at the top. O/S (offside, driver's side in the UK) is on the right.
const ZONES = [
  ['front_bumper', 'Front bumper', 'M70 18Q130 4 190 18L192 40H68Z'],
  ['bonnet', 'Bonnet', 'M68 42H192L188 120H72Z'],
  ['windscreen', 'Windscreen', 'M74 122H186L176 156H84Z'],
  ['roof', 'Roof', rect(84, 158, 92, 112)],
  ['rear_window', 'Rear window', 'M84 272H176L184 300H76Z'],
  ['boot', 'Boot / tailgate', 'M72 302H188L190 380H70Z'],
  ['rear_bumper', 'Rear bumper', 'M68 382H192L190 404Q130 418 70 404Z'],
  ['nsf_wing', 'N/S front wing', rect(44, 44, 22, 76)],
  ['nsf_door', 'N/S front door', rect(44, 122, 22, 90)],
  ['nsr_door', 'N/S rear door', rect(44, 214, 22, 86)],
  ['nsr_quarter', 'N/S rear quarter', rect(44, 302, 22, 78)],
  ['osf_wing', 'O/S front wing', rect(194, 44, 22, 76)],
  ['osf_door', 'O/S front door', rect(194, 122, 22, 90)],
  ['osr_door', 'O/S rear door', rect(194, 214, 22, 86)],
  ['osr_quarter', 'O/S rear quarter', rect(194, 302, 22, 78)],
  ['nsf_mirror', 'N/S mirror', rect(24, 128, 18, 16)],
  ['osf_mirror', 'O/S mirror', rect(218, 128, 18, 16)],
  ['nsf_wheel', 'N/S front wheel', rect(30, 58, 12, 50)],
  ['nsr_wheel', 'N/S rear wheel', rect(30, 318, 12, 50)],
  ['osf_wheel', 'O/S front wheel', rect(218, 58, 12, 50)],
  ['osr_wheel', 'O/S rear wheel', rect(218, 318, 12, 50)],
];
const ZONE_LABELS = Object.fromEntries(ZONES.map(([id, label]) => [id, label]));

function VehicleInspection({ damage, onChange }) {
  const [selected, setSelected] = useState('bonnet');
  const mark = damage[selected] || { types: [], note: '' };
  const update = (next) => {
    const rest = { ...damage };
    if (next.types.length || next.note.trim()) rest[selected] = next; else delete rest[selected];
    onChange(rest);
  };
  const marked = ZONES.filter(([id]) => damage[id]);
  return <div className="inspection">
    <svg className="inspection-car" viewBox="0 -14 260 450" role="group" aria-label="Vehicle body diagram. Select a panel to record damage.">
      <text x="130" y="-2" className="diagram-label">FRONT</text>
      <text x="130" y="430" className="diagram-label">REAR</text>
      <text x="8" y="215" className="diagram-label" transform="rotate(-90 8 215)">N/S</text>
      <text x="254" y="215" className="diagram-label" transform="rotate(90 254 215)">O/S</text>
      {ZONES.map(([id, label, d]) => <path key={id} d={d} role="button" tabIndex={0} aria-label={`${label}${damage[id] ? `: ${damage[id].types.join(', ') || 'note'}` : ''}`} aria-pressed={selected === id}
        className={`zone ${damage[id] ? 'zone-damaged' : ''} ${selected === id ? 'zone-selected' : ''}`}
        onClick={() => setSelected(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(id); } }}><title>{label}</title></path>)}
    </svg>
    <div className="inspection-panel">
      <h4>{ZONE_LABELS[selected]}</h4>
      <div className="damage-types" role="group" aria-label={`Damage on ${ZONE_LABELS[selected]}`}>{DAMAGE_TYPES.map((type) => <button type="button" key={type} aria-pressed={mark.types.includes(type)} onClick={() => update({ ...mark, types: mark.types.includes(type) ? mark.types.filter((item) => item !== type) : [...mark.types, type] })}>{type}</button>)}</div>
      <Field label="Panel note"><input maxLength={300} placeholder="e.g. 3cm scratch near handle" value={mark.note} onChange={(e) => update({ ...mark, note: e.target.value })} /></Field>
      {damage[selected] && <button type="button" className="button button-outline button-small" onClick={() => update({ types: [], note: '' })}>Clear this panel</button>}
      <h4 className="marked-heading">Marked panels ({marked.length})</h4>
      {marked.length === 0 ? <p className="muted">No damage recorded. Select a panel on the diagram to mark it.</p> : <ul className="marked-list">{marked.map(([id, label]) => <li key={id}><button type="button" onClick={() => setSelected(id)}><strong>{label}</strong> {damage[id].types.join(', ')}{damage[id].note && ` – ${damage[id].note}`}</button></li>)}</ul>}
    </div>
  </div>;
}

// Phone photos are shrunk before upload. Files a browser can't decode go up unchanged.
async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.82); });
    return blob || file;
  } catch { return file; }
}

const PHOTO_STAGES = [['before', 'Before'], ['after', 'After']];

function InspectionPhotos({ jobId, photos, onChange }) {
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const paths = photos.map((photo) => photo.path).join('|');

  useEffect(() => {
    const missing = paths ? paths.split('|').filter((path) => !urls[path]) : [];
    if (!missing.length || !supabase) return;
    let alive = true;
    supabase.storage.from(JOB_PHOTO_BUCKET).createSignedUrls(missing, 3600).then(({ data, error: storageError }) => {
      if (!alive) return;
      if (storageError) { setError(`Photos could not be loaded: ${storageError.message}`); return; }
      setUrls((current) => ({ ...current, ...Object.fromEntries(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl])) }));
    });
    return () => { alive = false; };
  }, [paths, urls]);

  async function upload(stage, files) {
    setBusy(stage);
    setError('');
    try {
      for (const file of files) {
        const blob = await shrinkPhoto(file);
        const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'jpg';
        const path = `${jobId}/${stage}/${crypto.randomUUID()}.${extension}`;
        const { error: storageError } = await supabase.storage.from(JOB_PHOTO_BUCKET).upload(path, blob, { contentType: blob.type });
        if (storageError) throw storageError;
        onChange((current) => [...current, { path, stage, taken_at: new Date().toISOString() }]);
      }
    } catch (err) { setError(`Photo could not be uploaded: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function remove(photo) {
    if (!window.confirm('Remove this photo permanently?')) return;
    setError('');
    const { error: storageError } = await supabase.storage.from(JOB_PHOTO_BUCKET).remove([photo.path]);
    if (storageError) { setError(`Photo could not be removed: ${storageError.message}`); return; }
    onChange((current) => current.filter((item) => item.path !== photo.path));
  }

  return <div className="inspection-photos">
    {PHOTO_STAGES.map(([stage, label]) => {
      const items = photos.filter((photo) => photo.stage === stage);
      return <section key={stage}>
        <h4>{label} photos ({items.length})</h4>
        <div className="photo-grid">{items.map((photo) => <div className="photo-tile" key={photo.path}>
          <a href={urls[photo.path]} target="_blank" rel="noreferrer">{urls[photo.path] ? <img src={urls[photo.path]} alt={`${label} repair`} /> : <span>Loading...</span>}</a>
          <button type="button" className="icon-button" aria-label={`Remove ${label.toLowerCase()} photo`} onClick={() => remove(photo)}><Trash2 size={14} /></button>
        </div>)}</div>
        <label className={`button button-outline button-small photo-add ${busy ? 'photo-busy' : ''}`}>{busy === stage ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Camera size={15} />}{busy === stage ? 'Uploading...' : `Add ${label.toLowerCase()} photo`}<input type="file" accept="image/*" multiple disabled={Boolean(busy)} onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) void upload(stage, files); }} /></label>
      </section>;
    })}
    {error && <p className="notice" role="alert">{error}</p>}
  </div>;
}

function LineItems({ caption, lines, columns, cost, blank, onChange, transform = (line) => line }) {
  const update = (index, key, value) => onChange(lines.map((line, i) => (i === index ? transform({ ...line, [key]: value }, key) : line)));
  return <div className="line-items">
    <h4>{caption}</h4>
    {lines.length === 0 && <p className="muted">Nothing added yet.</p>}
    {lines.map((line, index) => <div className="line-item" key={index}>
      {columns.map(([key, label, props]) => <Field key={key} label={label}><input {...props} value={line[key]} onChange={(e) => update(index, key, e.target.value)} /></Field>)}
      {cost && <div className="line-cost"><small>Cost</small><strong>{money(cost(line))}</strong></div>}
      <button type="button" className="icon-button" aria-label={`Remove ${caption.toLowerCase()} line ${index + 1}`} onClick={() => onChange(lines.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" className="button button-outline button-small" onClick={() => onChange([...lines, blank])}><Plus size={15} /> Add {caption.toLowerCase()} line</button>
  </div>;
}

const money2 = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };

export function JobCardForm({ jobId, card, showCosts = true, onChange }) {
  const set = (key, value) => onChange((current) => ({ ...current, [key]: value }));
  const setIn = (group, key, value) => onChange((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  const setWheel = (group) => (wheel, field, value) => onChange((current) => ({ ...current, [group]: { ...current[group], [wheel]: { ...current[group][wheel], [field]: value } } }));
  const allOk = (section) => onChange((current) => ({ ...current, checks: { ...current.checks, ...Object.fromEntries(section.items.filter(([id]) => !current.checks[id]).map(([id]) => [id, 'ok'])) } }));
  const counts = checkSummary(card);
  const totals = cardTotals(card);
  const finishing = CHECKLIST.at(-1);
  const checklistProps = { card, onCheck: (id, value) => setIn('checks', id, value), onValue: (key, value) => setIn('values', key, value), onAllOk: allOk };
  return <div className="job-card">
    <Step number="1" title="Diagnosis & inspection" icon={Stethoscope} summary={`${counts.ok} OK · ${counts.advisory} advisory · ${counts.repair} repair`}>
      <div className="three-columns">
        <Field label="Mileage"><input inputMode="numeric" maxLength={20} value={card.mileage} onChange={(e) => set('mileage', e.target.value)} /></Field>
        <Field label="Oil level pre-service (%)"><input inputMode="numeric" maxLength={10} value={card.oil_level} onChange={(e) => set('oil_level', e.target.value)} /></Field>
        <Field label="Chassis / VIN"><input maxLength={40} value={card.chassis} onChange={(e) => set('chassis', e.target.value.toUpperCase())} /></Field>
      </div>
      <Field label="Customer's concern"><textarea rows={2} maxLength={2000} placeholder="What the customer reported" value={card.concern} onChange={(e) => set('concern', e.target.value)} /></Field>
      <Field label="Diagnosis findings (the investigation)"><textarea rows={4} maxLength={5000} placeholder="Tests carried out, fault codes, what was found..." value={card.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} /></Field>
      {CHECKLIST.slice(0, -1).map((section) => <ChecklistSection key={section.title} section={section} {...checklistProps} />)}
      <WheelTable caption="Tyre report" wheels={WHEEL_POSITIONS} rows={[['condition', 'Condition'], ['pressure', 'Pressure'], ['tread', 'Tread /mm']]} values={card.tyres} onChange={setWheel('tyres')} />
      <div className="three-columns">
        <Field label="Tyre size"><input maxLength={40} placeholder="e.g. 205/55 R16" value={card.tyre_size} onChange={(e) => set('tyre_size', e.target.value)} /></Field>
        <Field label="Torque (Nm)"><input maxLength={20} value={card.torque} onChange={(e) => set('torque', e.target.value)} /></Field>
        <Field label="Tyre kit expiry"><input maxLength={20} value={card.tyre_kit_expiry} onChange={(e) => set('tyre_kit_expiry', e.target.value)} /></Field>
      </div>
      <label className="check-label"><input type="checkbox" checked={card.tyres_replace} onChange={(e) => set('tyres_replace', e.target.checked)} /> Tyres need replacing</label>
      <WheelTable caption="Brake report" wheels={WHEEL_POSITIONS.slice(0, 4)} rows={[['pads', 'Pads & shoes'], ['discs', 'Discs & drums']]} values={card.brakes} onChange={setWheel('brakes')} />
      <label className="check-label"><input type="checkbox" checked={card.brake_fluid_replace} onChange={(e) => set('brake_fluid_replace', e.target.checked)} /> Brake fluid needs replacing</label>
      <div className="emissions">
        <h4>Emissions</h4>
        <Field label="Fuel"><select value={card.emissions.fuel} onChange={(e) => setIn('emissions', 'fuel', e.target.value)}><option value="">Not tested</option><option>Petrol</option><option>Diesel</option></select></Field>
        {[['hc', 'HC (ppm)'], ['co', 'CO (%)'], ['co2', 'CO₂ (%)'], ['o2', 'O₂ (%)'], ['lambda', 'λ'], ['km', 'Km⁻¹']].map(([key, label]) => <Field key={key} label={label}><input inputMode="decimal" maxLength={12} value={card.emissions[key]} onChange={(e) => setIn('emissions', key, e.target.value)} /></Field>)}
      </div>
    </Step>
    <Step number="2" title="Digital vehicle inspection" icon={ScanSearch} summary={`${Object.keys(card.damage).length} panels marked`}>
      <VehicleInspection damage={card.damage} onChange={(damage) => set('damage', damage)} />
      <InspectionPhotos jobId={jobId} photos={card.photos} onChange={(update) => onChange((current) => ({ ...current, photos: update(current.photos) }))} />
      <Field label="Inspection notes"><textarea rows={2} maxLength={2000} placeholder="General condition, existing damage pointed out to the customer..." value={card.inspection_notes} onChange={(e) => set('inspection_notes', e.target.value)} /></Field>
    </Step>
    {showCosts &&     <Step number="3" title="Estimated parts & labour" icon={Package} summary={money(totals.total)}>
      <LineItems caption="Parts" lines={card.parts} cost={partCost} blank={{ description: '', part_no: '', qty: '1', unit_cost: '' }} onChange={(parts) => set('parts', parts)}
        columns={[['description', 'Part', { maxLength: 200, required: true }], ['part_no', 'Part no.', { maxLength: 60 }], ['qty', 'Qty', { type: 'number', min: '0', step: '1', inputMode: 'numeric' }], ['unit_cost', 'Unit price (£)', money2]]} />
      <LineItems caption="Labour" lines={card.labour} blank={{ description: '', hours: '', rate: '', cost: '' }} transform={withLabourCost} onChange={(labour) => set('labour', labour)}
        columns={[['description', 'Work', { maxLength: 200, required: true }], ['hours', 'Hours (optional)', { type: 'number', min: '0', step: '0.25', inputMode: 'decimal' }], ['rate', 'Rate £/hr (optional)', money2], ['cost', 'Labour cost (£)', money2]]} />
      <p className="muted small-text">Type the labour cost directly, or enter hours and a rate to work it out.</p>
      <dl className="card-totals"><div><dt>Parts</dt><dd>{money(totals.parts)}</dd></div><div><dt>Labour</dt><dd>{money(totals.labour)}</dd></div><div><dt>Total</dt><dd>{money(totals.total)}</dd></div></dl>
    </Step>}
    <Step number={showCosts ? 4 : 3} title="Work carried out" icon={NotebookPen}>
      <Field label="Work carried out notes"><textarea rows={4} maxLength={5000} placeholder="What was done, parts fitted, readings..." value={card.work_notes} onChange={(e) => set('work_notes', e.target.value)} /></Field>
      <Field label="Additional work required"><textarea rows={3} maxLength={3000} placeholder="One item per line" value={card.additional_work} onChange={(e) => set('additional_work', e.target.value)} /></Field>
      <Field label="Advisory & technical report"><textarea rows={3} maxLength={5000} value={card.advisory_report} onChange={(e) => set('advisory_report', e.target.value)} /></Field>
    </Step>
    <Step number={showCosts ? 5 : 4} title="Quality control & testing" icon={BadgeCheck} summary={card.qc_passed ? 'Passed' : 'Not signed off'}>
      <ChecklistSection section={finishing} {...checklistProps} />
      <Field label="Road test & QC notes"><textarea rows={3} maxLength={3000} placeholder="Road test findings, warning lights, leaks..." value={card.qc_notes} onChange={(e) => set('qc_notes', e.target.value)} /></Field>
      <div className="three-columns">
        <Field label="Technician"><input maxLength={80} value={card.technician} onChange={(e) => set('technician', e.target.value)} /></Field>
        <Field label="Date in" hint="Defaults to the booking date"><input type="date" value={card.date_in} onChange={(e) => set('date_in', e.target.value)} /></Field>
        <Field label="Date completed"><input type="date" value={card.date_completed} onChange={(e) => set('date_completed', e.target.value)} /></Field>
      </div>
      <div className="qc-checks">
        <label className="check-label"><input type="checkbox" checked={card.qc_passed} onChange={(e) => set('qc_passed', e.target.checked)} /> Quality control passed, vehicle ready for collection</label>
        <label className="check-label"><input type="checkbox" checked={card.photo_taken} onChange={(e) => set('photo_taken', e.target.checked)} /> Photo taken for electronic record</label>
        <label className="check-label"><input type="checkbox" checked={card.photo_shared} onChange={(e) => set('photo_shared', e.target.checked)} /> Photo shared with customer</label>
      </div>
    </Step>
  </div>;
}

export function Receipt({ jobId, details, card, issued }) {
  const totals = cardTotals(card);
  const advisories = Object.entries(card.checks).filter(([, value]) => value === 'advisory' || value === 'repair').map(([id, value]) => `${CHECK_LABELS[id]}${value === 'repair' ? ' (repair required)' : ' (advisory)'}`);
  const extra = card.additional_work.split('\n').map((line) => line.trim()).filter(Boolean);
  const parts = card.parts.filter((part) => part.description.trim() || partCost(part));
  const labour = card.labour.filter((line) => line.description.trim() || labourCost(line));
  const date = (value) => (value ? dateLabel(value) : '—');
  return <article className="receipt">
    <header className="receipt-header">
      <div><h2>{WORKSHOP.name}</h2><p>{WORKSHOP.address}</p><p>{WORKSHOP.phone} · {WORKSHOP.email}</p></div>
      <div className="receipt-meta"><strong>RECEIPT</strong><span>No. {jobId}</span><span>Issued {dateLabel(issued)}</span></div>
    </header>
    <section className="receipt-parties">
      <div><h3>Customer</h3><p>{details.first_name} {details.last_name}</p><p>{details.phone}</p>{details.customer_address && <p className="receipt-address">{details.customer_address}</p>}{details.customer_postcode && <p>{details.customer_postcode}</p>}</div>
      <div><h3>Vehicle</h3><p><strong>{details.reg_no}</strong></p><p>{details.make} {details.model}{details.year ? ` (${details.year})` : ''}</p>{card.mileage && <p>Mileage: {card.mileage}</p>}</div>
      <div><h3>Service dates</h3><p>Booked: {date(details.booking_date)}{details.booking_time ? ` at ${slotLabel(details.booking_time)}` : ''}</p><p>Date in: {date(card.date_in || details.booking_date)}</p><p>Completed: {date(card.date_completed)}</p></div>
    </section>
    {details.service_type && <p className="receipt-service"><strong>Service:</strong> {details.service_type}</p>}
    <table className="receipt-table">
      <caption>Labour</caption>
      <thead><tr><th scope="col">Description</th><th scope="col">Hours</th><th scope="col">Cost</th></tr></thead>
      <tbody>{labour.length ? labour.map((line, i) => <tr key={i}><td>{line.description}</td><td>{line.hours || '—'}</td><td>{money(labourCost(line))}</td></tr>) : <tr><td colSpan={3}>No labour charged</td></tr>}</tbody>
    </table>
    <table className="receipt-table">
      <caption>Parts</caption>
      <thead><tr><th scope="col">Part</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Cost</th></tr></thead>
      <tbody>{parts.length ? parts.map((part, i) => <tr key={i}><td>{part.description}{part.part_no && <small> ({part.part_no})</small>}</td><td>{part.qty}</td><td>{money(part.unit_cost)}</td><td>{money(partCost(part))}</td></tr>) : <tr><td colSpan={4}>No parts supplied</td></tr>}</tbody>
    </table>
    <dl className="receipt-totals">
      <div><dt>Labour</dt><dd>{money(totals.labour)}</dd></div>
      <div><dt>Parts</dt><dd>{money(totals.parts)}</dd></div>
      <div className="receipt-grand"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
      <div><dt>Payment</dt><dd>{details.payment_status === 'Paid' ? 'Paid in full' : `${details.payment_status} – ${money(details.amount_due)} due`}</dd></div>
    </dl>
    {card.work_notes.trim() && <section className="receipt-notes"><h3>Work carried out</h3><p>{card.work_notes}</p></section>}
    {(advisories.length > 0 || extra.length > 0) && <section className="receipt-notes"><h3>Advisories & recommended work</h3><ul>{[...advisories, ...extra].map((item) => <li key={item}>{item}</li>)}</ul></section>}
    <footer className="receipt-footer">Thank you for choosing {WORKSHOP.name}.</footer>
  </article>;
}

const BOARD_FILTERS = [['active', 'In the workshop'], ['completed', 'Completed'], ['all', 'All jobs']];

export function JobCardsBoard({ jobs, loading, authorized, showCosts = true, onOpen }) {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const term = search.toLowerCase().trim();
  const listed = jobs
    .filter((job) => job.status !== 'Pending Confirmation')
    .filter((job) => filter === 'all' || (filter === 'completed' ? job.status === 'Completed' : job.status !== 'Completed'))
    .filter((job) => jobMatches(job, term, showCosts))
    .map((job) => ({ job, progress: jobProgress(job, showCosts) }));
  if (filter !== 'active') listed.reverse();
  return <section className="agenda-panel job-board">
    <div className="agenda-heading">
      <div><h2>Job cards</h2><p className="muted">Each job moves through checked, priced, work done, QC and paid. Open a card to carry on where you left off.</p></div>
      <div className="search-input"><Search size={17} /><input aria-label="Search job cards" placeholder="Search name or registration" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    </div>
    <div className="calendar-view-toggle board-filters" role="group" aria-label="Show job cards">{BOARD_FILTERS.map(([key, label]) => <button key={key} type="button" className="button button-small button-outline" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {loading ? <div className="empty-state"><h3>Loading job cards...</h3></div> : !authorized ? <div className="empty-state"><h3>Workshop connection required</h3></div> : listed.length === 0 ? <div className="empty-state"><ClipboardCheck size={34} /><h3>{search ? 'No matching job cards.' : 'No job cards here.'}</h3><p>{filter === 'active' ? 'Approved bookings appear here ready for their job card.' : 'Try another filter.'}</p></div> :
      <div className="board-grid">{listed.map(({ job, progress }) => <button type="button" key={job.id} className="board-card" onClick={() => onOpen(job)} aria-label={`Open job card for ${job.vehicle?.reg_no}`}>
        <div className="board-card-top"><strong className="registration">{job.vehicle?.reg_no}</strong><span className={`status status-${job.status.toLowerCase().replaceAll(' ', '-')}`}><span />{job.status}</span></div>
        <div className="board-card-vehicle"><CarFront size={16} /><div><strong>{job.vehicle?.make} {job.vehicle?.model}</strong><span>{jobContact(job).name} · {dateLabel(job.booking_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>{job.service_type && <span>{job.service_type}</span>}</div></div>
        <ol className="stage-track" style={{ gridTemplateColumns: `repeat(${progress.stages.length}, minmax(0, 1fr))` }} aria-label={`${progress.completed} of ${progress.stages.length} stages complete`}>{progress.stages.map(([key, label]) => <li key={key} className={progress.done[key] ? 'stage-done' : ''}><span />{label}</li>)}</ol>
        <div className="board-card-footer"><span className={progress.next ? 'next-step' : 'next-step next-done'}>{progress.next ? `Next: ${progress.next}` : 'All stages complete'}</span>{showCosts && <strong>{money(cardTotals(progress.card).total)}</strong>}<ChevronRight size={16} /></div>
      </button>)}</div>}
    <div className="agenda-footer"><span>{listed.length} {listed.length === 1 ? 'job card' : 'job cards'}</span></div>
  </section>;
}
