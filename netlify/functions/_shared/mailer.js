/**
 * Transactional email via Google Gmail API (Workspace / Gmail — sends as your inbox).
 * Uses the same OAuth client as discovery; refresh token must include gmail.send.
 *
 * Optional legacy fallback: SENDGRID_API_KEY (not recommended).
 * Missing Gmail + SendGrid: logs and returns { skipped: true } — never blocks checkout.
 */

import { google } from 'googleapis';

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

export function mailConfig(env = process.env) {
  const fromEmail = String(
    env.CHECKOUT_FROM_EMAIL || env.SENDGRID_FROM_EMAIL || 'nathan@taylor-marriott.com',
  ).trim();
  const fromName = String(env.CHECKOUT_FROM_NAME || env.SENDGRID_FROM_NAME || 'Taylor-Marriott').trim();
  const replyTo = String(
    env.CHECKOUT_REPLY_TO || env.SENDGRID_REPLY_TO || fromEmail,
  ).trim();
  const alertTo = String(env.CHECKOUT_ALERT_EMAIL || 'nathan@taylor-marriott.com').trim();
  const sendgridApiKey = String(env.SENDGRID_API_KEY || '').trim();
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const gmailRefreshToken = String(
    env.GOOGLE_GMAIL_REFRESH_TOKEN || env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  ).trim();
  const gmailConfigured = Boolean(clientId && clientSecret && gmailRefreshToken);
  return {
    fromEmail,
    fromName,
    replyTo,
    alertTo,
    sendgridApiKey,
    clientId,
    clientSecret,
    gmailRefreshToken,
    gmailConfigured,
  };
}

export function formatFrom({ fromEmail, fromName }) {
  if (fromName) return `${fromName} <${fromEmail}>`;
  return fromEmail;
}

function encodeSubject(subject) {
  const s = String(subject || '');
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

export function buildRawEmail(msg, cfg) {
  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  const from = formatFrom(cfg);
  const replyTo = msg.replyTo || cfg.replyTo;
  const subject = encodeSubject(String(msg.subject || '').slice(0, 998));
  const text = msg.text || '';
  const html = msg.html;

  const lines = [`From: ${from}`, `To: ${toList.join(', ')}`, `Reply-To: ${replyTo}`, `Subject: ${subject}`];

  if (html) {
    const boundary = `tm_${Date.now().toString(36)}`;
    lines.push('MIME-Version: 1.0');
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(text);
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(html);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(text);
  }

  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

async function sendViaGmail(msg, cfg, opts = {}) {
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  oauth2.setCredentials({ refresh_token: cfg.gmailRefreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const raw = buildRawEmail(msg, cfg);
  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return { ok: true, provider: 'gmail' };
  } catch (err) {
    console.error('[mailer] Gmail API error', err.message);
    return { ok: false, error: err.message, skipped: false, provider: 'gmail' };
  }
}

async function sendViaSendGrid(msg, cfg, fetchFn) {
  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);

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

  const res = await fetchFn(SENDGRID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.sendgridApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'taylor-marriott-checkout',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[mailer] SendGrid error', res.status, detail.slice(0, 500));
    return { ok: false, status: res.status, skipped: false, provider: 'sendgrid' };
  }
  return { ok: true, provider: 'sendgrid' };
}

/**
 * @param {{ to: string|string[], subject: string, text: string, html?: string, replyTo?: string }} msg
 * @param {{ fetchFn?: typeof fetch, env?: Record<string,string>, gmailSend?: Function }} opts
 */
export async function sendMail(msg, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const cfg = mailConfig(opts.env);

  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (!toList.length) {
    console.warn('[mailer] no recipients — email skipped:', msg.subject);
    return { skipped: true, reason: 'no_recipients' };
  }

  if (typeof opts.gmailSend === 'function') {
    return opts.gmailSend({ ...msg, to: toList }, cfg);
  }

  if (cfg.gmailConfigured) {
    return sendViaGmail({ ...msg, to: toList }, cfg, opts);
  }

  if (cfg.sendgridApiKey) {
    return sendViaSendGrid({ ...msg, to: toList }, cfg, fetchFn);
  }

  console.warn(
    '[mailer] Gmail not configured (need GOOGLE_OAUTH_* + GOOGLE_GMAIL_REFRESH_TOKEN with gmail.send) — email skipped:',
    msg.subject,
  );
  return { skipped: true, reason: 'no_mailer' };
}
