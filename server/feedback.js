import { connection, passedSecurityCheck, rpc, UserError } from './bookings.js';
import { workshopInbox } from './mail.js';

const stars = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

// Customers rate the workshop and suggest improvements. Nothing is shown on the site until an admin approves it.
export async function submitFeedback(method, body, env, { fetcher = fetch, send = null, site = '' } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const { url, serviceKey } = connection(env);
  if (!url || !serviceKey) return { status: 503, body: { error: 'Feedback is not set up yet. Please call or email the workshop.' } };
  // People never see the trap field, so anything typed in it came from a bot. It gets a normal-looking reply.
  if (typeof body?.company === 'string' && body.company.trim()) return { status: 200, body: { ok: true } };
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const publish = body?.publish === true;
  try {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new UserError('Please choose a rating from 1 to 5 stars.');
    if (comment.length > 600) throw new UserError('Please keep your comments to 600 characters.');
    if (name.length > 60) throw new UserError('Please keep your name to 60 characters.');
    if (!(await passedSecurityCheck(body?.turnstile_token, env, fetcher))) throw new UserError('Please complete the security check and try again.');
    await rpc(url, serviceKey, 'submit_feedback', { p_rating: rating, p_comment: comment, p_name: name, p_publish: publish }, fetcher);
  } catch (err) {
    if (err instanceof UserError) return { status: err.status, body: { error: err.message } };
    console.error(`Feedback failed: ${err.message}`);
    return { status: 502, body: { error: 'Your feedback could not be sent. Please try again later.' } };
  }
  // A heads-up for the workshop. A failed email never loses the feedback.
  const to = workshopInbox(env);
  if (send && to) {
    const text = [`${stars(rating)} (${rating} out of 5)`, comment || '(No comments)', '', `From: ${name || 'Not given'}`,
      publish ? 'They are happy for this to be shown on the website.' : 'They asked for this to stay private.',
      '', `Approve or hide it in the Reviews section of the dashboard${site ? `: ${site}/admin` : '.'}`].join('\n');
    try { await send({ to, subject: `New ${rating}-star feedback to review`, text }); } catch (err) { console.error(`Email failed: ${err.message}`); }
  }
  return { status: 200, body: { ok: true } };
}
