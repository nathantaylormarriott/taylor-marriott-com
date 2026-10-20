/**
 * Email Nathan when someone replies. INBOUND_NOTIFY_LIVE=1 sends.
 * Any other value logs only, same pattern as BILLING_NOTIFY_LIVE.
 * This does not text or WhatsApp the sender.
 */
import { CLIENT_SITES } from './client-sites.js';
import { previewUrlFromRegistry } from './checkout-preview-resolve.js';
import { readEnv } from './billing-env.js';
import { NATHAN_EMAIL } from './billing-notify.js';
import { sendMail } from './mailer.js';

export function inboundNotifyLive(env = process.env) {
  return readEnv('INBOUND_NOTIFY_LIVE', env) === '1';
}

export function profileFromLead(lead, account) {
  const placeId = (lead && lead.placeId) || (account && account.placeId) || null;
  let businessName = (lead && lead.businessName) || (account && account.businessName) || null;
  let previewUrl = (lead && lead.previewUrl) || null;
  if (!previewUrl && account && account.netlifySiteName) {
    previewUrl = `https://${account.netlifySiteName}.netlify.app/`;
  }
  if (!previewUrl && placeId) {
    const fromRegistry = previewUrlFromRegistry(placeId);
    if (fromRegistry) previewUrl = fromRegistry;
  }
  if (!businessName && placeId && CLIENT_SITES[placeId]) {
    businessName = CLIENT_SITES[placeId].business || null;
  }
  return {
    businessName: businessName || null,
    previewUrl: previewUrl || null,
    placeId,
  };
}

export function inboundNoticeText({ message, profile, optOut }) {
  const channelLabel = message.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const business = profile && profile.businessName ? profile.businessName : 'not on file';
  const preview = profile && profile.previewUrl ? profile.previewUrl : 'not on file';
  const body = String(message.body || '').trim();
  const messageText = body || '(no text)';
  return [
    'A reply arrived on the Taylor-Marriott outreach number.',
    '',
    `From: ${message.from}`,
    `Channel: ${channelLabel}`,
    `Opt-out: ${optOut ? 'yes' : 'no'}`,
    `Business: ${business}`,
    `Preview: ${preview}`,
    `Media: ${message.mediaCount || 0}`,
    `Message sid: ${message.messageSid}`,
    '',
    'Message:',
    messageText,
  ].join('\n');
}

export function inboundNoticeSubject({ message, optOut }) {
  const channelLabel = message.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const kind = optOut ? 'opt-out' : 'reply';
  return `${channelLabel} ${kind} from ${message.from}`;
}

export async function notifyInboundReply({ message, lead, account, env = process.env, send = sendMail } = {}) {
  const optOut = Boolean(message && message.optOut);
  const profile = profileFromLead(lead, account);
  const subject = inboundNoticeSubject({ message, optOut });
  const text = inboundNoticeText({ message, profile, optOut });
  if (!inboundNotifyLive(env)) {
    console.info('[twilio-inbound] INBOUND_NOTIFY_LIVE is off. Email not sent.');
    console.info(text);
    return { sent: false, dryRun: true, subject, text, profile };
  }
  const result = await send({ to: NATHAN_EMAIL, subject, text }, { env });
  if (!result || result.ok !== true) {
    const err = new Error((result && (result.error || result.reason)) || 'inbound notify email failed');
    err.code = 'NOTIFY_FAILED';
    throw err;
  }
  return { sent: true, dryRun: false, subject, text, profile, result };
}
