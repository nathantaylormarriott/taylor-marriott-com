/**
 * Send billing mail as nathan@taylor-marriott.com through the Gmail API.
 * Uses the existing Google OAuth client. The refresh token needs gmail.send.
 * This module does not send unless a caller invokes sendBillingEmail.
 */
import { NATHAN_EMAIL } from './billing-notify.js';

export function buildRawEmail({ from, to, subject, text }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text || '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export async function sendBillingEmail({ to, subject, text, env = process.env, fetchImpl = fetch } = {}) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    const err = new Error('Google OAuth is not configured. Email not sent.');
    err.code = 'NO_GMAIL';
    throw err;
  }
  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.access_token) {
    const err = new Error('Gmail token refresh failed. Email not sent.');
    err.code = 'GMAIL_TOKEN';
    throw err;
  }
  const from = env.GMAIL_SEND_AS || NATHAN_EMAIL;
  const raw = buildRawEmail({ from, to, subject, text });
  const sendRes = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    const err = new Error((sendBody.error && sendBody.error.message) || 'Gmail send failed.');
    err.code = 'GMAIL_SEND';
    throw err;
  }
  return { id: sendBody.id || null, to, from };
}
