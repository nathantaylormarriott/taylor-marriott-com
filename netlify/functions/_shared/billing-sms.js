/**
 * The only Twilio send. Refuses the message before any network call when it is
 * longer than 159 septets or not GSM-7.
 * From +447378961404 unless TWILIO_FROM_NUMBER is set.
 */
import { assertSmsBody } from '../../../shared/sms-gsm.js';
import { TWILIO_FROM_E164 } from './billing-notify.js';

export async function sendBillingSms({ to, body, env = process.env, fetchImpl = fetch } = {}) {
  const text = assertSmsBody(body);
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER || TWILIO_FROM_E164;
  if (!sid || !token) {
    const err = new Error('Twilio is not configured. SMS not sent.');
    err.code = 'NO_TWILIO';
    throw err;
  }
  if (!to) {
    const err = new Error('No mobile number. SMS not sent.');
    err.code = 'NO_PHONE';
    throw err;
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: text }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Twilio ${res.status}`);
    err.code = 'TWILIO';
    err.twilioCode = data.code || null;
    throw err;
  }
  return { sid: data.sid || null, status: data.status || 'sent', to, from };
}
