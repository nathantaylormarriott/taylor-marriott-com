import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryStore } from '../netlify/functions/_shared/billing-store.js';
import { getLead, markReplied, markSitePurchased } from '../netlify/functions/_shared/inbound-store.js';
import { outreachAuthorized } from '../netlify/functions/_shared/outreach-auth.js';
import { handleOutreachEnrol } from '../netlify/functions/outreach-enrol.js';
import { handleOutreachStatus } from '../netlify/functions/outreach-status.js';
import { config as eveningConfig, handleOutreachEvening } from '../netlify/functions/outreach-evening.js';
import { config as day0Config, handleOutreachDay0 } from '../netlify/functions/outreach-day0.js';
import { handleOutreachStop } from '../netlify/functions/outreach-stop.js';
import { runOutreachDay } from '../netlify/functions/_shared/outreach-run.js';
import {
  addLondonDays,
  canSend,
  checkSmsBody,
  daysBetween,
  dueStep,
  londonDate,
  WHATSAPP_DAILY_LIMIT,
} from '../shared/outreach-sequence.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SECRET = 'test-outreach-secret';
const PHONE = '+447911123456';
const LINK = 'https://taylor-marriott.com/p/abcd1234';

function store() {
  return memoryStore();
}

function enrolBody(overrides = {}) {
  return {
    phone: PHONE,
    email: 'owner@example.co.uk',
    channel: 'sms',
    businessName: 'Example Plumbing',
    trade: 'plumber',
    town: 'Atherstone',
    previewUrl: LINK,
    place_id: 'ChIJexample',
    site_id: 'example-site',
    ...overrides,
  };
}

function enrolRequest(body, secret = SECRET) {
  const headers = { 'content-type': 'application/json' };
  if (secret != null) headers['x-outreach-admin-secret'] = secret;
  return new Request('https://taylor-marriott.com/api/outreach-enrol', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function enrol(storeImpl, body, opts = {}) {
  const res = await handleOutreachEnrol(enrolRequest(body, opts.secret === undefined ? SECRET : opts.secret), {
    env: opts.env || { OUTREACH_ADMIN_SECRET: SECRET },
    store: storeImpl,
    now: () => new Date(opts.now || '2026-01-15T10:00:00.000Z'),
  });
  return { res, json: await res.json() };
}

function twilioFetch(calls) {
  return async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    const params = new URLSearchParams(init.body);
    const sid = params.get('ContentSid') ? 'MM_test' : 'SM_test';
    return new Response(JSON.stringify({ sid, status: 'queued' }), { status: 201 });
  };
}

const liveEnv = {
  OUTREACH_ADMIN_SECRET: SECRET,
  OUTREACH_SEND_LIVE: '1',
  TWILIO_ACCOUNT_SID: 'AC_test',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_FROM_NUMBER: '+447378961404',
};

test('London due dates stay on the calendar across GMT and BST', () => {
  assert.equal(londonDate('2026-01-15T10:00:00.000Z'), '2026-01-15');
  assert.equal(dueStep('2026-01-15T10:00:00.000Z', '2026-01-15T10:00:00.000Z', []).day, 0);
  assert.equal(dueStep('2026-01-15T10:00:00.000Z', '2026-01-17T10:00:00.000Z', [0]), null);
  assert.equal(dueStep('2026-01-15T10:00:00.000Z', '2026-01-18T10:00:00.000Z', [0]).day, 3);
  assert.equal(dueStep('2026-01-15T10:00:00.000Z', '2026-01-25T10:00:00.000Z', [0, 3]).day, 10);
  assert.equal(dueStep('2026-01-15T10:00:00.000Z', '2026-01-25T10:00:00.000Z', []).day, 0);

  assert.equal(londonDate('2026-03-28T23:30:00.000Z'), '2026-03-28');
  assert.equal(londonDate('2026-03-29T00:30:00.000Z'), '2026-03-29');
  assert.equal(daysBetween('2026-03-28', '2026-04-07'), 10);
  assert.equal(addLondonDays('2026-03-28', 10), '2026-04-07');
  assert.equal(dueStep('2026-03-28T10:00:00.000Z', '2026-04-06T22:30:00.000Z', [0, 3]), null);
  assert.equal(dueStep('2026-03-28T10:00:00.000Z', '2026-04-06T23:30:00.000Z', [0, 3]).day, 10);
  assert.equal(dueStep('2026-03-28T10:00:00.000Z', '2026-04-06T23:30:00.000Z', []).day, 0);

  assert.equal(londonDate('2026-10-24T22:30:00.000Z'), '2026-10-24');
  assert.equal(londonDate('2026-10-24T23:30:00.000Z'), '2026-10-25');
  assert.equal(daysBetween('2026-10-20', '2026-10-30'), 10);
  assert.equal(dueStep('2026-10-20T09:00:00.000Z', '2026-10-29T23:30:00.000Z', [0, 3]), null);
  assert.equal(dueStep('2026-10-20T09:00:00.000Z', '2026-10-30T00:30:00.000Z', [0, 3]).day, 10);
});

test('SMS guard rejects length, non-GSM-7, em dashes, and opt-out lines', () => {
  assert.equal(checkSmsBody('A'.repeat(159)).ok, true);
  assert.equal(checkSmsBody('A'.repeat(160)).reason, 'too-long');
  assert.equal(checkSmsBody('Cafe \u2014 preview').reason, 'em-dash');
  assert.equal(checkSmsBody('Hello \u{1F600}').reason, 'not-gsm7');
  assert.equal(checkSmsBody('Preview ready STOP to opt out').reason, 'opt-out-line');
  const files = [
    'config/outreach-copy.json',
    'docs/OUTREACH-SEQUENCER.md',
    'shared/outreach-sequence.js',
    'netlify/functions/outreach-evening.js',
    'netlify/functions/outreach-day0.js',
    'netlify/functions/outreach-stop.js',
    'netlify/functions/outreach-enrol.js',
    'netlify/functions/outreach-status.js',
    'netlify/functions/_shared/outreach-run.js',
    'netlify/functions/_shared/outreach-send.js',
    'netlify/functions/_shared/outreach-auth.js',
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(text.includes('\u2014'), false, file);
  }
  const copy = fs.readFileSync(path.join(ROOT, 'config/outreach-copy.json'), 'utf8');
  assert.equal(/stop to opt out/i.test(copy), false);
});

test('daily cap and WhatsApp 250 limit', () => {
  assert.equal(WHATSAPP_DAILY_LIMIT, 250);
  assert.equal(canSend({ sentToday: 20, whatsappSentToday: 0, cap: 20, channel: 'sms' }).reason, 'daily-cap');
  assert.equal(canSend({ sentToday: 19, whatsappSentToday: 250, cap: 300, channel: 'whatsapp' }).reason, 'whatsapp-cap');
  assert.equal(canSend({ sentToday: 19, whatsappSentToday: 250, cap: 300, channel: 'sms' }).ok, true);
});

test('follow-ups fire at 18:00 and 19:00 UTC and send only at 19:00 London', async () => {
  assert.equal(eveningConfig.schedule, '0 18,19 * * *');
  assert.equal(day0Config.schedule, '*/10 * * * *');
  const skipped = await handleOutreachEvening(new Request('https://example.com'), {
    env: liveEnv,
    store: store(),
    now: () => new Date('2026-07-15T19:30:00.000Z'),
  });
  assert.equal((await skipped.json()).skipped, 'outside-london-hour');
  const winterSkip = await handleOutreachEvening(new Request('https://example.com'), {
    env: liveEnv,
    store: store(),
    now: () => new Date('2026-01-15T18:30:00.000Z'),
  });
  assert.equal((await winterSkip.json()).londonHour, 18);
  const summer = await handleOutreachEvening(new Request('https://example.com'), {
    env: liveEnv,
    store: store(),
    now: () => new Date('2026-07-15T18:30:00.000Z'),
  });
  assert.equal((await summer.json()).dryRun, false);
  const winter = await handleOutreachEvening(new Request('https://example.com'), {
    env: liveEnv,
    store: store(),
    now: () => new Date('2026-01-15T19:30:00.000Z'),
  });
  assert.equal((await winter.json()).dryRun, false);
});

test('auth fails closed when the secret is missing or wrong', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(outreachAuthorized(new Request('https://example.com'), {}), false);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.some((line) => line.includes('OUTREACH_ADMIN_SECRET') && line.includes('fail closed')));

  const missing = await handleOutreachEnrol(enrolRequest(enrolBody(), 'anything'), { env: {}, store: store() });
  assert.equal(missing.status, 403);
  const wrong = await enrol(store(), enrolBody(), { secret: 'nope' });
  assert.equal(wrong.res.status, 403);
  const status = await handleOutreachStatus(new Request('https://taylor-marriott.com/api/outreach-status'), {
    env: { OUTREACH_ADMIN_SECRET: SECRET },
    store: store(),
  });
  assert.equal(status.status, 403);
});

test('enrol refuses a missing preview and a second enrol, and a reply does not block it', async () => {
  const leads = store();
  const missing = await enrol(leads, enrolBody({ previewUrl: '  ' }));
  assert.equal(missing.res.status, 400);
  assert.equal(missing.json.error, 'missing_preview_url');
  assert.equal(await getLead(PHONE, leads), null);

  const repliedStore = store();
  await repliedStore.setJSON(`suppress/${PHONE}`, { phone: PHONE, at: '2026-01-01T00:00:00.000Z' });
  await markReplied(PHONE, { at: '2026-01-01T00:00:00.000Z', channel: 'sms', optOut: true }, repliedStore);
  const replied = await enrol(repliedStore, enrolBody());
  assert.equal(replied.res.status, 200);
  assert.equal(replied.json.status, 'active');
  assert.equal((await getLead(PHONE, repliedStore)).optedOut, true);

  const once = store();
  const ok = await enrol(once, enrolBody());
  assert.equal(ok.res.status, 200);
  assert.equal(ok.json.day0At, '2026-01-15T10:00:00.000Z');
  const again = await enrol(once, enrolBody());
  assert.equal(again.json.error, 'already_enrolled');

  const longName = await enrol(store(), enrolBody({ businessName: 'A'.repeat(150) }));
  assert.equal(longName.json.error, 'too-long');
  const emoji = await enrol(store(), enrolBody({ businessName: 'Hello \u{1F600}' }));
  assert.equal(emoji.json.error, 'not-gsm7');
});

test('dry run logs the SMS and records nothing; live sends once', async () => {
  const leads = store();
  await enrol(leads, enrolBody(), { now: '2026-01-15T10:00:00.000Z' });
  const calls = [];
  const logs = [];
  const dry = await runOutreachDay({
    env: { ...liveEnv, OUTREACH_SEND_LIVE: '0' },
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    log: (line) => logs.push(line),
  });
  assert.equal(dry.dryRun, true);
  assert.equal(calls.length, 0);
  assert.equal((await getLead(PHONE, leads)).sequence.touches.length, 0);
  assert.match(logs.join('\n'), /dry run would send day 0 sms/);
  assert.equal(/stop to opt out/i.test(logs.join('\n')), false);

  const liveCalls = [];
  const live = await runOutreachDay({
    env: liveEnv,
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(liveCalls),
  });
  assert.equal(live.dryRun, false);
  assert.equal(liveCalls.length, 1);
  const params = new URLSearchParams(liveCalls[0].body);
  assert.equal(params.get('To'), PHONE);
  assert.equal(params.get('From'), '+447378961404');
  assert.equal(params.has('ContentSid'), false);
  assert.match(params.get('Body'), /PLACEHOLDER day 0 preview Example Plumbing/);
  assert.equal(/stop to opt out/i.test(params.get('Body')), false);
  const lead = await getLead(PHONE, leads);
  assert.equal(lead.sequence.touches.length, 1);
  assert.equal(lead.sequence.touches[0].day, 0);
  assert.equal(lead.sequence.touches[0].messageSid, 'SM_test');
  assert.equal(lead.sequence.touches[0].status, 'queued');
  assert.equal(lead.sequence.status, 'active');

  const rerun = [];
  await runOutreachDay({
    env: liveEnv,
    store: leads,
    now: new Date('2026-01-15T10:30:00.000Z'),
    fetchImpl: twilioFetch(rerun),
  });
  assert.equal(rerun.length, 0);
  assert.equal((await getLead(PHONE, leads)).sequence.touches.length, 1);
});

test('Day 3 and Day 10 send once, then the lead is complete, including across BST', async () => {
  const leads = store();
  await enrol(leads, enrolBody(), { now: '2026-03-28T10:00:00.000Z' });
  const calls = [];
  const runAt = async (iso) => runOutreachDay({
    env: liveEnv,
    store: leads,
    now: new Date(iso),
    fetchImpl: twilioFetch(calls),
  });
  await runAt('2026-04-06T22:30:00.000Z');
  assert.equal(calls.length, 1);
  assert.equal((await getLead(PHONE, leads)).sequence.touches[0].day, 0);
  await runAt('2026-04-06T22:30:00.000Z');
  assert.equal(calls.length, 2);
  assert.deepEqual((await getLead(PHONE, leads)).sequence.touches.map((touch) => touch.day), [0, 3]);
  await runAt('2026-04-06T22:30:00.000Z');
  assert.equal(calls.length, 2);
  await runAt('2026-04-06T23:30:00.000Z');
  const lead = await getLead(PHONE, leads);
  assert.deepEqual(lead.sequence.touches.map((touch) => touch.day), [0, 3, 10]);
  assert.equal(lead.sequence.status, 'complete');
  assert.equal(lead.sequence.nextTouchOn, null);
  await runAt('2026-04-07T09:00:00.000Z');
  assert.equal(calls.length, 3);
});

test('a reply or STOP does not stop the sequence; purchase and manual stop do', async () => {
  const replied = store();
  await enrol(replied, enrolBody(), { now: '2026-01-05T02:00:00.000Z' });
  const calls = [];
  await runOutreachDay({
    env: liveEnv,
    store: replied,
    now: new Date('2026-01-05T02:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    onlyDays: [0],
  });
  await markReplied(PHONE, { at: '2026-01-06T12:00:00.000Z', channel: 'sms', optOut: true }, replied);
  const afterStop = await getLead(PHONE, replied);
  assert.equal(afterStop.replied, true);
  assert.equal(afterStop.optedOut, true);
  assert.equal(afterStop.sequence.status, 'active');
  assert.equal(await replied.get(`suppress/${PHONE}`, { type: 'json' }), null);
  await runOutreachDay({
    env: liveEnv,
    store: replied,
    now: new Date('2026-01-08T19:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    onlyDays: [3, 10],
  });
  assert.equal(calls.length, 2);
  assert.equal((await getLead(PHONE, replied)).sequence.status, 'active');

  const bought = store();
  await enrol(bought, enrolBody({ site_id: 'site-bought' }), { now: '2026-01-05T02:00:00.000Z' });
  await runOutreachDay({
    env: liveEnv,
    store: bought,
    now: new Date('2026-01-05T02:00:00.000Z'),
    fetchImpl: twilioFetch([]),
    onlyDays: [0],
  });
  const stopped = await markSitePurchased('site-bought', { plan: 'one_off', source: 'checkout' }, bought);
  assert.equal(stopped[0].purchased, true);
  assert.equal(stopped[0].sequence.status, 'stopped');
  assert.equal(stopped[0].sequence.haltReason, 'purchased');
  const afterBuy = [];
  await runOutreachDay({
    env: liveEnv,
    store: bought,
    now: new Date('2026-01-08T19:00:00.000Z'),
    fetchImpl: twilioFetch(afterBuy),
    onlyDays: [3, 10],
  });
  assert.equal(afterBuy.length, 0);

  const manual = store();
  await enrol(manual, enrolBody(), { now: '2026-01-05T02:00:00.000Z' });
  const stopRes = await handleOutreachStop(new Request('https://taylor-marriott.com/api/outreach-stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-outreach-admin-secret': SECRET },
    body: JSON.stringify({ phone: PHONE }),
  }), { env: { OUTREACH_ADMIN_SECRET: SECRET }, store: manual });
  assert.equal(stopRes.status, 200);
  assert.equal((await getLead(PHONE, manual)).sequence.haltReason, 'manual');
  const denied = await handleOutreachStop(new Request('https://taylor-marriott.com/api/outreach-stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: PHONE }),
  }), { env: {}, store: manual });
  assert.equal(denied.status, 403);
});

test('daily cap stops the third lead and a rerun does not exceed it', async () => {
  const leads = store();
  const phones = ['+447911000001', '+447911000002', '+447911000003'];
  for (const phone of phones) {
    await enrol(leads, enrolBody({ phone }), { now: '2026-01-15T10:00:00.000Z' });
  }
  const calls = [];
  const env = { ...liveEnv, OUTREACH_DAILY_CAP: '2' };
  await runOutreachDay({
    env,
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
  });
  assert.equal(calls.length, 2);
  await runOutreachDay({
    env,
    store: leads,
    now: new Date('2026-01-15T10:05:00.000Z'),
    fetchImpl: twilioFetch(calls),
  });
  assert.equal(calls.length, 2);
  assert.equal((await getLead(phones[2], leads)).sequence.touches.length, 0);
});

test('WhatsApp uses the Content template and skips when the SID is unset', async () => {
  const refused = await enrol(store(), enrolBody({ channel: 'whatsapp', businessName: 'Cafe \u2014 Bros' }));
  assert.equal(refused.json.error, 'em-dash');

  const open = store();
  await enrol(open, enrolBody({ channel: 'whatsapp' }), { now: '2026-01-15T10:00:00.000Z' });
  const logs = [];
  const calls = [];
  await runOutreachDay({
    env: liveEnv,
    store: open,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    log: (line) => logs.push(line),
  });
  assert.equal(calls.length, 0);
  assert.match(logs.join('\n'), /WHATSAPP_CONTENT_SID_DAY0 is not set \(template tm_website_preview_v2\)/);
  assert.equal((await getLead(PHONE, open)).sequence.touches.length, 0);

  const sent = [];
  await runOutreachDay({
    env: { ...liveEnv, WHATSAPP_CONTENT_SID_DAY0: 'HXday0preview' },
    store: open,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(sent),
  });
  const params = new URLSearchParams(sent[0].body);
  assert.equal(params.get('ContentSid'), 'HXday0preview');
  assert.equal(params.get('To'), `whatsapp:${PHONE}`);
  assert.equal(params.get('From'), 'whatsapp:+447378961404');
  assert.equal(params.has('Body'), false);
  assert.deepEqual(JSON.parse(params.get('ContentVariables')), {
    1: 'Example Plumbing',
    2: LINK,
  });

  const later = [];
  const day3logs = [];
  await runOutreachDay({
    env: { ...liveEnv, WHATSAPP_CONTENT_SID_DAY0: 'HXday0preview' },
    store: open,
    now: new Date('2026-01-18T10:00:00.000Z'),
    fetchImpl: twilioFetch(later),
    log: (line) => day3logs.push(line),
  });
  assert.equal(later.length, 0);
  assert.match(day3logs.join('\n'), /WHATSAPP_CONTENT_SID_DAY3 is not set/);
  assert.deepEqual((await getLead(PHONE, open)).sequence.touches.map((touch) => touch.day), [0]);
});

test('WhatsApp daily limit does not block SMS', async () => {
  const leads = store();
  await enrol(leads, enrolBody({ phone: '+447911000010', channel: 'whatsapp' }), { now: '2026-01-15T10:00:00.000Z' });
  await enrol(leads, enrolBody({ phone: '+447911000011', channel: 'whatsapp' }), { now: '2026-01-15T10:00:00.000Z' });
  await enrol(leads, enrolBody({ phone: '+447911000012', channel: 'sms' }), { now: '2026-01-15T10:00:00.000Z' });
  const calls = [];
  await runOutreachDay({
    env: { ...liveEnv, WHATSAPP_CONTENT_SID_DAY0: 'HXday0preview', OUTREACH_DAILY_CAP: '10' },
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    whatsappDailyLimit: 1,
  });
  assert.equal(calls.length, 2);
  const kinds = calls.map((call) => new URLSearchParams(call.body).has('ContentSid'));
  assert.deepEqual(kinds, [true, false]);
  assert.equal((await getLead('+447911000011', leads)).sequence.touches.length, 0);
});

test('email goes through the Gmail mailer and dry run does not call it', async () => {
  const leads = store();
  await enrol(leads, enrolBody({ channel: 'email' }), { now: '2026-01-15T10:00:00.000Z' });
  let mailed = 0;
  await runOutreachDay({
    env: { OUTREACH_ADMIN_SECRET: SECRET },
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    sendMail: async () => {
      mailed += 1;
      return { ok: true, id: 'should-not-send' };
    },
  });
  assert.equal(mailed, 0);
  assert.equal((await getLead(PHONE, leads)).sequence.touches.length, 0);

  const sent = [];
  await runOutreachDay({
    env: { ...liveEnv },
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    sendMail: async (msg) => {
      sent.push(msg);
      return { ok: true, id: 'gmail-abc', provider: 'gmail' };
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.co.uk');
  assert.match(sent[0].subject, /PLACEHOLDER preview for Example Plumbing/);
  assert.match(sent[0].text, /PLACEHOLDER day 0/);
  assert.equal(/stop to opt out/i.test(sent[0].text), false);
  const lead = await getLead(PHONE, leads);
  assert.equal(lead.sequence.touches[0].messageSid, 'gmail-abc');
  assert.equal(lead.sequence.touches[0].channel, 'email');
});

test('Day 0 sends at enrolment, including outside the 19:00 window', async () => {
  const leads = store();
  const calls = [];
  const logs = [];
  const res = await handleOutreachEnrol(enrolRequest(enrolBody()), {
    env: liveEnv,
    store: leads,
    now: () => new Date('2026-01-15T02:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
    log: (line) => logs.push(line),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.day0.day, 0);
  assert.equal(body.day0.id, 'SM_test');
  assert.equal((await getLead(PHONE, leads)).sequence.touches.length, 1);
  const again = [];
  await handleOutreachDay0(new Request('https://example.com'), {
    env: liveEnv,
    store: leads,
    now: () => new Date('2026-01-15T02:10:00.000Z'),
    fetchImpl: twilioFetch(again),
  });
  assert.equal(again.length, 0);
  assert.equal(/stop to opt out/i.test(logs.join('\n')), false);
});

test('a Twilio STOP block is logged and the next lead still sends', async () => {
  const leads = store();
  await enrol(leads, enrolBody({ phone: '+447911000021' }), { now: '2026-01-15T02:00:00.000Z' });
  await enrol(leads, enrolBody({ phone: '+447911000022' }), { now: '2026-01-15T02:00:00.000Z' });
  const calls = [];
  const logs = [];
  await runOutreachDay({
    env: liveEnv,
    store: leads,
    now: new Date('2026-01-15T02:00:00.000Z'),
    onlyDays: [0],
    log: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      calls.push(init.body);
      const to = new URLSearchParams(init.body).get('To');
      if (to === '+447911000021') {
        return new Response(JSON.stringify({
          code: 21610,
          message: 'Attempt to send to unsubscribed recipient',
        }), { status: 400 });
      }
      return new Response(JSON.stringify({ sid: 'SM_next', status: 'queued' }), { status: 201 });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal((await getLead('+447911000021', leads)).sequence.touches.length, 0);
  assert.equal((await getLead('+447911000022', leads)).sequence.touches[0].messageSid, 'SM_next');
  assert.match(logs.join('\n'), /21610/);
  assert.match(logs.join('\n'), /Continuing/);
});

test('an already paid site is enrolled stopped and Day 0 is not sent', async () => {
  const leads = store();
  const accounts = store();
  await accounts.setJSON('cs_paid', {
    id: 'cs_paid',
    netlifySiteId: 'example-site',
    stripeStatus: 'active',
    plan: 'one_off',
  });
  const calls = [];
  const res = await handleOutreachEnrol(enrolRequest(enrolBody()), {
    env: liveEnv,
    store: leads,
    accounts,
    now: () => new Date('2026-01-15T02:00:00.000Z'),
    fetchImpl: twilioFetch(calls),
  });
  const body = await res.json();
  assert.equal(body.purchased, true);
  assert.equal(body.status, 'stopped');
  assert.equal(calls.length, 0);
});

test('status lists step, next due date, and stop flags', async () => {
  const leads = store();
  await enrol(leads, enrolBody(), { now: '2026-01-15T10:00:00.000Z' });
  await runOutreachDay({
    env: liveEnv,
    store: leads,
    now: new Date('2026-01-15T10:00:00.000Z'),
    fetchImpl: twilioFetch([]),
  });
  const res = await handleOutreachStatus(new Request('https://taylor-marriott.com/api/outreach-status', {
    headers: { 'x-outreach-admin-secret': SECRET },
  }), { env: { OUTREACH_ADMIN_SECRET: SECRET }, store: leads });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].step, 0);
  assert.equal(body.leads[0].nextDueOn, '2026-01-18');
  assert.equal(body.leads[0].replied, false);
  assert.equal(body.leads[0].suppressed, false);
  assert.equal(body.leads[0].complete, false);
});
