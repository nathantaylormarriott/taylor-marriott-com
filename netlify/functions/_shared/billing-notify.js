/**
 * Email via Gmail API (nathan@taylor-marriott.com) and SMS via Twilio.
 * Default is dry-run: nothing is sent. BILLING_NOTIFY_LIVE=1 sends, and only
 * to nathan@taylor-marriott.com unless BILLING_NOTIFY_CLIENTS=1.
 */

export const NATHAN_EMAIL = 'nathan@taylor-marriott.com';
export const TWILIO_FROM_E164 = '+447378961404';

export function notifyLive(env = process.env) {
  return String(env.BILLING_NOTIFY_LIVE || '') === '1';
}

export function clientsAllowed(env = process.env) {
  return String(env.BILLING_NOTIFY_CLIENTS || '') === '1';
}

export function gateRecipient({ email, phone, env = process.env }) {
  if (!notifyLive(env)) {
    return { dryRun: true, email: email || null, phone: phone || null };
  }
  if (clientsAllowed(env)) {
    return { dryRun: false, email: email || null, phone: phone || null };
  }
  return {
    dryRun: false,
    email: NATHAN_EMAIL,
    phone: null,
    redirected: true,
  };
}

export function buildReminderMessage({ whenLabel, priceLabel, manageUrl, domain }) {
  const who = domain ? ` for ${domain}` : '';
  return `Taylor-Marriott: domain renewal${who} on ${whenLabel} at ${priceLabel}. Manage or update your card: ${manageUrl}`;
}

export function buildDunningMessage({ hostedInvoiceUrl, attempt, domain }) {
  const who = domain ? ` (${domain})` : '';
  return `Taylor-Marriott: payment ${attempt} of 10 failed${who}. Pay here: ${hostedInvoiceUrl}`;
}

export function buildAlertMessage({ kind, siteName, detail }) {
  return `Taylor-Marriott billing ${kind}${siteName ? ` for ${siteName}` : ''}. ${detail}`;
}

/**
 * @param {object} deps optional sendEmail/sendSms for tests
 */
export async function deliverNotice(notice, deps = {}, env = process.env) {
  const gated = gateRecipient({ email: notice.email, phone: notice.phone, env });
  const payload = {
    ...notice,
    dryRun: gated.dryRun || deps.dryRun === true,
    toEmail: gated.email,
    toPhone: gated.dryRun ? notice.phone || null : gated.phone,
    redirected: gated.redirected === true,
  };
  if (payload.dryRun) {
    return { ...payload, sentEmail: false, sentSms: false };
  }
  let sentEmail = false;
  let sentSms = false;
  if (payload.toEmail && deps.sendEmail) {
    await deps.sendEmail({ to: payload.toEmail, subject: notice.subject, text: notice.text });
    sentEmail = true;
  }
  if (payload.toPhone && notice.sms && deps.sendSms) {
    await deps.sendSms({ to: payload.toPhone, from: TWILIO_FROM_E164, body: notice.sms });
    sentSms = true;
  }
  return { ...payload, sentEmail, sentSms };
}
