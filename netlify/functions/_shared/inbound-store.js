/**
 * Outreach store for inbound replies and the Day 0 / Day 3 / Day 10 sequencer.
 *
 * Blob store name: outreach (strong consistency).
 *   message/{MessageSid}  inbound message, idempotent on MessageSid
 *   lead/{E.164}           contact the sequencer reads
 *   suppress/{E.164}       block every future send on every channel
 *
 * A reply sets lead.replied and lead.repliedAt and halts lead.sequence.
 * An opt-out also writes the suppression list. isSuppressed is that list,
 * so a later saveLead for the same number stays blocked.
 */
import { getStore } from '@netlify/blobs';
import { accountsStore } from './billing-store.js';
import { isOptOut } from './inbound-opt-out.js';

const STORE_NAME = 'outreach';

let storeOverride = null;

export function setOutreachStoreForTests(store) {
  storeOverride = store;
}

export function outreachStore() {
  return storeOverride || getStore({ name: STORE_NAME, consistency: 'strong' });
}

export function toE164(input) {
  let raw = String(input || '').trim();
  raw = raw.replace(/^whatsapp:/i, '').trim();
  raw = raw.replace(/[^\d+]/g, '');
  if (!raw) return null;
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (raw.startsWith('0')) raw = `+44${raw.slice(1)}`;
  else if (!raw.startsWith('+')) raw = `+${raw}`;
  const digits = raw.slice(1);
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export function channelFromAddress(raw) {
  return /^whatsapp:/i.test(String(raw || '').trim()) ? 'whatsapp' : 'sms';
}

export function parseTwilioInbound(params, receivedAt) {
  const fromRaw = String((params && params.From) || '');
  const toRaw = String((params && params.To) || '');
  const whatsapp = channelFromAddress(fromRaw) === 'whatsapp'
    || channelFromAddress(toRaw) === 'whatsapp'
    || Boolean(params && params.WaId);
  const mediaParsed = Number.parseInt(String((params && params.NumMedia) || '0'), 10);
  const mediaCount = Number.isFinite(mediaParsed) && mediaParsed > 0 ? mediaParsed : 0;
  return {
    messageSid: String((params && (params.MessageSid || params.SmsSid)) || '').trim(),
    from: toE164(fromRaw),
    to: toE164(toRaw),
    channel: whatsapp ? 'whatsapp' : 'sms',
    body: String((params && params.Body) || ''),
    mediaCount,
    receivedAt: receivedAt || new Date().toISOString(),
  };
}

function messageKey(messageSid) {
  return `message/${messageSid}`;
}

function leadKey(phone) {
  return `lead/${phone}`;
}

function suppressKey(phone) {
  return `suppress/${phone}`;
}

export function emptySequence() {
  return {
    status: 'idle',
    touches: [],
    nextTouchOn: null,
    startedAt: null,
    haltReason: null,
    haltedAt: null,
  };
}

export function emptyLead(phone) {
  return {
    phone,
    businessName: null,
    previewUrl: null,
    placeId: null,
    replied: false,
    repliedAt: null,
    optedOut: false,
    optedOutAt: null,
    suppressed: false,
    lastChannel: null,
    lastMessageSid: null,
    sequence: emptySequence(),
    updatedAt: null,
  };
}

async function readJson(store, key) {
  return (await store.get(key, { type: 'json' })) || null;
}

export async function getMessage(messageSid, storeImpl = outreachStore()) {
  if (!messageSid) return null;
  return readJson(storeImpl, messageKey(messageSid));
}

export async function getLead(phone, storeImpl = outreachStore()) {
  const id = toE164(phone);
  if (!id) return null;
  return readJson(storeImpl, leadKey(id));
}

export async function isSuppressed(phone, storeImpl = outreachStore()) {
  const id = toE164(phone);
  if (!id) return false;
  const row = await readJson(storeImpl, suppressKey(id));
  return Boolean(row);
}

export async function hasReplied(phone, storeImpl = outreachStore()) {
  const lead = await getLead(phone, storeImpl);
  return Boolean(lead && lead.replied === true);
}

function haltedSequence(existing, at, reason) {
  return {
    ...emptySequence(),
    ...(existing && existing.sequence),
    status: 'halted',
    haltReason: reason,
    haltedAt: (existing && existing.sequence && existing.sequence.haltedAt) || at,
  };
}

export async function saveLead(phone, patch = {}, storeImpl = outreachStore()) {
  const id = toE164(phone);
  if (!id) {
    const err = new Error('Lead phone is not E.164.');
    err.code = 'BAD_PHONE';
    throw err;
  }
  const existing = (await getLead(id, storeImpl)) || emptyLead(id);
  const suppressed = existing.suppressed === true || (await isSuppressed(id, storeImpl));
  const sequence = {
    ...emptySequence(),
    ...(existing.sequence || {}),
    ...(patch.sequence || {}),
  };
  const next = {
    ...existing,
    ...patch,
    phone: id,
    sequence,
    updatedAt: new Date().toISOString(),
  };
  if (existing.replied === true || next.replied === true) {
    next.replied = true;
    next.repliedAt = existing.repliedAt || next.repliedAt || next.updatedAt;
    next.sequence = haltedSequence(next, next.repliedAt, next.sequence.haltReason || 'replied');
  }
  if (suppressed || next.optedOut === true) {
    next.suppressed = true;
    if (suppressed) next.optedOut = next.optedOut === true || existing.optedOut === true;
    next.sequence = haltedSequence(
      next,
      next.optedOutAt || next.repliedAt || next.updatedAt,
      next.optedOut ? 'opt-out' : 'suppressed',
    );
  }
  await storeImpl.setJSON(leadKey(id), next);
  return next;
}

export async function markReplied(phone, details = {}, storeImpl = outreachStore()) {
  const id = toE164(phone);
  if (!id) return null;
  const at = details.at || new Date().toISOString();
  const existing = (await getLead(id, storeImpl)) || emptyLead(id);
  const optOut = details.optOut === true;
  const lead = await saveLead(
    id,
    {
      replied: true,
      repliedAt: existing.repliedAt || at,
      lastChannel: details.channel || existing.lastChannel || null,
      lastMessageSid: details.messageSid || existing.lastMessageSid || null,
      optedOut: optOut || existing.optedOut === true,
      optedOutAt: optOut ? existing.optedOutAt || at : existing.optedOutAt || null,
      suppressed: optOut || existing.suppressed === true,
    },
    storeImpl,
  );
  if (optOut) {
    const prior = await readJson(storeImpl, suppressKey(id));
    if (!prior) {
      await storeImpl.setJSON(suppressKey(id), {
        phone: id,
        at,
        messageSid: details.messageSid || null,
        channel: details.channel || null,
      });
    }
  }
  return lead;
}

export async function listLeads(storeImpl = outreachStore()) {
  const listed = await storeImpl.list({ prefix: 'lead/' });
  const blobs = (listed && listed.blobs) || [];
  const leads = [];
  for (const blob of blobs) {
    if (!blob || !String(blob.key || '').startsWith('lead/')) continue;
    const lead = await readJson(storeImpl, blob.key);
    if (lead) leads.push(lead);
  }
  return leads;
}

export async function findBillingAccountByPhone(phone, storeImpl = accountsStore()) {
  if (!storeImpl || typeof storeImpl.list !== 'function') return null;
  const target = toE164(phone);
  if (!target) return null;
  const listed = await storeImpl.list();
  const blobs = (listed && listed.blobs) || [];
  for (const blob of blobs) {
    const account = await storeImpl.get(blob.key, { type: 'json' });
    if (account && toE164(account.phone) === target) return account;
  }
  return null;
}

export async function recordInboundMessage(input, storeImpl = outreachStore()) {
  const phone = toE164(input && input.from);
  if (!phone) {
    const err = new Error('From is not a usable phone number.');
    err.code = 'BAD_FROM';
    throw err;
  }
  const messageSid = String((input && input.messageSid) || '').trim();
  if (!messageSid) {
    const err = new Error('MessageSid is missing.');
    err.code = 'BAD_SID';
    throw err;
  }
  const existing = await getMessage(messageSid, storeImpl);
  if (existing) {
    return { duplicate: true, message: existing, lead: await getLead(phone, storeImpl) };
  }
  const body = String((input && input.body) || '');
  const optOut = isOptOut(body);
  const message = {
    messageSid,
    from: phone,
    to: input.to ? toE164(input.to) : null,
    channel: input.channel === 'whatsapp' ? 'whatsapp' : 'sms',
    body,
    mediaCount: Number.isInteger(input.mediaCount) && input.mediaCount > 0 ? input.mediaCount : 0,
    receivedAt: input.receivedAt || new Date().toISOString(),
    optOut,
    notified: false,
  };
  await storeImpl.setJSON(messageKey(messageSid), message);
  const lead = await markReplied(
    phone,
    {
      at: message.receivedAt,
      channel: message.channel,
      messageSid,
      optOut,
    },
    storeImpl,
  );
  return { duplicate: false, message, lead };
}

export async function markInboundNotified(messageSid, storeImpl = outreachStore()) {
  const existing = await getMessage(messageSid, storeImpl);
  if (!existing) return null;
  const next = { ...existing, notified: true };
  await storeImpl.setJSON(messageKey(messageSid), next);
  return next;
}
