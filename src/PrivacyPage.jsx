import { WORKSHOP } from './utils.js';

// Plain-English policy for a small garage. The owner should check it matches how they actually work.
const SECTIONS = [
  ['Who we are', `${WORKSHOP.name}, ${WORKSHOP.address}, is responsible for the personal information you give us. You can contact us on ${WORKSHOP.phone} or at ${WORKSHOP.email}.`],
  ['What we collect', 'When you book, we collect your name, phone number, email address, home address and postcode, your vehicle registration, make and model, and the work you need. When we work on your car, we keep job notes, inspection photos, parts, prices and payment status.'],
  ['Why we use it', 'We use your details to arrange and confirm your booking, contact you about it, carry out and record the work, and give you a receipt. This is needed to provide the service you ask for. We may also send a reminder when your MOT is due, which you can ask us to stop at any time.'],
  ['Who we share it with', 'We do not sell your information. Trusted services store and process it for us: Supabase (our booking database), Netlify (our website), Google Gmail (our emails), and Cloudflare Turnstile (a spam check on the booking form). Your registration is checked with the DVSA MOT history service, and your postcode with an address lookup service. Some of these companies may process data outside the UK, with legal safeguards in place.'],
  ['How long we keep it', 'We keep booking and job records for up to six years, because we need them for our accounts. After that we delete them. You can ask us to delete your details sooner if we no longer need them.'],
  ['Your rights', "You can ask to see the information we hold about you, have it corrected, or have it deleted. You can also object to how we use it. Contact us using the details above. If you're unhappy with how we handle your information, you can complain to the Information Commissioner's Office at ico.org.uk."],
  ['Cookies', "This site doesn't use advertising or tracking cookies. The spam check on the booking form may set a cookie that's needed to tell people and bots apart."],
];

export default function PrivacyPage() {
  return <main className="help-main shell privacy-page">
    <div className="help-heading"><p className="eyebrow">PRIVACY POLICY</p><h1>How we look after your details</h1><p className="muted">Last updated November 2026.</p></div>
    <section className="help-card">{SECTIONS.map(([heading, text]) => <div key={heading} className="privacy-section"><h2>{heading}</h2><p>{text}</p></div>)}</section>
  </main>;
}
