/**
 * Channel senders for the outreach sequence.
 * SMS uses the Twilio messages API. WhatsApp uses an approved Content template
 * (ContentSid + ContentVariables). Day 3 and Day 10 are outside the 24 hour
 * window, so they are templates too. Email uses the Gmail mailer.
 * Do not append an opt-out line. Twilio still handles SMS STOP on its side.
 */
import { sendBillingSms } from './billing-sms.js';
import { TWILIO_FROM_E164, NATHAN_EMAIL } from './billing-notify.js';
import { mailConfig, sendMail } from './mailer.js';
import { toE164 } from './inbound-store.js';

export const OUTREACH_FROM_EMAIL = NATHAN_EMAIL;

export async function sendOutreachSms({ to, body, env, fetchImpl }) {
  const result = await sendBillingSms({ to, body, env, fetchImpl });
  return { ok: true, id: result.sid || null, status: result.status || 'sent', channel: 'sms' };
}

export async function sendOutreachWhatsapp({ to, contentSid, variables, env, fetchImpl }) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = toE164(env.TWILIO_FROM_NUMBER) || TWILIO_FROM_E164;
  if (!sid || !token) {
    const err = new Error('Twilio is not configured. WhatsApp not sent.');
    err.code = 'NO_TWILIO';
    throw err;
  }
  if (!contentSid) {
    const err = new Error('WhatsApp ContentSid is not set. Not sent.');
    err.code = 'NO_CONTENT_SID';
    throw err;
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: `whatsapp:${to}`,
        From: `whatsapp:${from}`,
        ContentSid: contentSid,
        ContentVariables: JSON.stringify(variables || {}),
      }).toString(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Twilio ${res.status}`);
    err.code = 'TWILIO';
    err.twilioCode = data.code || null;
    throw err;
  }
  return {
    ok: true,
    id: data.sid || null,
    status: data.status || 'sent',
    channel: 'whatsapp',
  };
}

export async function sendOutreachEmail({ to, subject, text, env, sendMailImpl }) {
  const mailEnv = {
    ...env,
    CHECKOUT_FROM_EMAIL: OUTREACH_FROM_EMAIL,
    CHECKOUT_FROM_NAME: (env && env.CHECKOUT_FROM_NAME) || 'Taylor-Marriott',
    CHECKOUT_REPLY_TO: OUTREACH_FROM_EMAIL,
  };
  const send = sendMailImpl || sendMail;
  if (!sendMailImpl && !mailConfig(mailEnv).gmailConfigured) {
    return { ok: false, skipped: true, reason: 'no-gmail', channel: 'email' };
  }
  const result = await send(
    { to, subject, text },
    { env: mailEnv },
  );
  if (!result || result.ok === false || result.skipped) {
    return {
      ok: false,
      skipped: Boolean(result && result.skipped),
      reason: (result && (result.reason || result.error)) || 'email-failed',
      channel: 'email',
    };
  }
  return {
    ok: true,
    id: result.id || result.messageId || null,
    status: 'sent',
    channel: 'email',
  };
}
