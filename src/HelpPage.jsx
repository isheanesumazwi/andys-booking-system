import { useState } from 'react';
import { ArrowRight, MapPin, Phone, Mail } from 'lucide-react';
import { SERVICES } from './utils.js';

const address = '1A Warwick Rd, Newport NP19 8JJ, United Kingdom';
const questions = [
  ['How do I book?', 'Choose the work you need, enter your contact and vehicle details, and request a preferred date. Andy will contact you to confirm your appointment.'],
  ['Is my booking confirmed straight away?', 'No. Online bookings are requests until the workshop confirms them. Please wait for confirmation before bringing your car in.'],
  ['Can I change or cancel my booking?', 'Call or email the workshop with your registration and booking date. Andy can amend or remove the booking for you.'],
  ['What if my registration is not found?', 'You can enter the make and model manually and continue booking. Some vehicles may not be available through the MOT history lookup.'],
  ['How much will the work cost?', 'Contact the workshop to discuss your vehicle and the work needed. Submitting a booking request does not provide a price quote.'],
  ['Where is the workshop?', `You can find us at ${address}. Use Go now below to open directions in your maps app.`],
];

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const apple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const destination = encodeURIComponent(address);
  const directions = apple ? `https://maps.apple.com/?daddr=${destination}` : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  const filtered = questions.filter((entry) => entry.join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <main className="help-main shell">
    <div className="help-heading"><p className="eyebrow">ABOUT AND HELP</p><h1>How can we help you?</h1><p className="muted">Friendly, local car care at Andy's Beechwood Car Care in Newport.</p></div>
    <section className="help-card" aria-labelledby="contact-heading">
      <h2 id="contact-heading">Get in touch</h2>
      <div className="contact-grid">
        <div><Phone size={22} /><h3>Call us</h3><a href="tel:+447915392353">+44 7915 392353</a></div>
        <div><Mail size={22} /><h3>Email us</h3><a href="mailto:Andybeechwoodnp@gmail.com">Andybeechwoodnp@gmail.com</a></div>
        <div><MapPin size={22} /><h3>Visit the workshop</h3><p>{address}</p><a className="button button-primary button-small" href={directions} target="_blank" rel="noreferrer">Go now <ArrowRight size={16} /></a><a className="map-reference" href="https://maps.app.goo.gl/LV7HDzL1RBqbHQYx6?g_st=ic" target="_blank" rel="noreferrer">View on Google Maps</a></div>
      </div>
      <iframe className="workshop-map" title="Map of Andy's Beechwood Car Care, 1A Warwick Road, Newport" src={`https://maps.google.com/maps?q=${destination}&output=embed`} loading="lazy" referrerPolicy="no-referrer" />
    </section>
    <section className="help-card service-start" aria-labelledby="service-heading"><div><h2 id="service-heading">Tell us what you need</h2><p className="muted">Choose a service to start your booking.</p></div><label className="field"><span>Tell us what you need</span><select value={service} onChange={(event) => setService(event.target.value)}><option value="">Please Select</option>{SERVICES.map((option) => <option key={option}>{option}</option>)}</select></label><a className="button button-primary" href={service ? `/book?service=${encodeURIComponent(service)}#booking-heading` : '/book#booking-heading'}>Get started <ArrowRight size={16} /></a></section>
    <section className="help-card faqs" aria-labelledby="faq-heading"><h2 id="faq-heading">Frequently asked questions</h2><label className="field"><span>Search FAQs</span><input type="search" placeholder="Enter a keyword" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{filtered.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}{filtered.length === 0 && <p role="status" className="muted">No matching questions. Please call or email us for help.</p>}</section>
  </main>;
}
