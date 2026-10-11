/**
 * Transactional email via SendGrid HTTP API (no SDK — works in Netlify Functions).
 * Missing SENDGRID_API_KEY: logs once per send attempt and returns { skipped: true }.
 */

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

export function mailConfig(env = process.env) {
  const apiKey = String(env.SENDGRID_API_KEY || '').trim();
  const fromEmail = String(env.SENDGRID_FROM_EMAIL || 'nathan@taylor-marriott.com').trim();
  const fromName = String(env.SENDGRID_FROM_NAME || 'Taylor-Marriott').trim();
  const replyTo = String(env.SENDGRID_REPLY_TO || 'nathan@taylor-marriott.com').trim();
  const alertTo = String(env.CHECKOUT_ALERT_EMAIL || 'nathan@taylor-marriott.com').trim();
  return { apiKey, fromEmail, fromName, replyTo, alertTo };
}

export function formatFrom({ fromEmail, fromName }) {
  if (fromName) return `${fromName} <${fromEmail}>`;
  return fromEmail;
}

/**
 * @param {{ to: string|string[], subject: string, text: string, html?: string, replyTo?: string }} msg
 * @param {{ fetchFn?: typeof fetch, env?: Record<string,string> }} opts
 */
export async function sendMail(msg, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const cfg = mailConfig(opts.env);
  if (!cfg.apiKey) {
    console.warn('[mailer] SENDGRID_API_KEY not set — email skipped:', msg.subject);
    return { skipped: true, reason: 'no_api_key' };
  }
  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (!toList.length) {
    console.warn('[mailer] no recipients — email skipped:', msg.subject);
    return { skipped: true, reason: 'no_recipients' };
  }

  const body = {
    personalizations: [{ to: toList.map((email) => ({ email })) }],
    from: { email: cfg.fromEmail, name: cfg.fromName || undefined },
    reply_to: { email: msg.replyTo || cfg.replyTo },
    subject: String(msg.subject || '').slice(0, 998),
    content: [{ type: 'text/plain', value: msg.text || '' }],
  };
  if (msg.html) {
    body.content.push({ type: 'text/html', value: msg.html });
  }

  try {
    const res = await fetchFn(SENDGRID_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taylor-marriott-checkout',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[mailer] SendGrid error', res.status, detail.slice(0, 500));
      return { ok: false, status: res.status, skipped: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('[mailer] send failed', err.message);
    return { ok: false, error: err.message, skipped: false };
  }
}
