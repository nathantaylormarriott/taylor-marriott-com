import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { memoryStore } from '../netlify/functions/_shared/billing-store.js';
import { isOptOut } from '../netlify/functions/_shared/inbound-opt-out.js';
import {
  findBillingAccountByPhone,
  getLead,
  getMessage,
  hasReplied,
  isSuppressed,
  listLeads,
  markReplied,
  parseTwilioInbound,
  saveLead,
  setOutreachStoreForTests,
  toE164,
} from '../netlify/functions/_shared/inbound-store.js';
import { handleTwilioInbound } from '../netlify/functions/twilio-inbound.js';
import { publicWebhookUrl } from '../netlify/functions/_shared/twilio-request.js';

const TOKEN = 'test-auth-token';
const URL = 'https://taylor-marriott.com/api/twilio-inbound';
const NOW = '2026-10-20T12:00:00.000Z';

function sign(params, url = URL, token = TOKEN) {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) data += key + params[key];
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

function useStore() {
  const store = memoryStore();
  setOutreachStoreForTests(store);
  return store;
}

function requestFor(params, { signature = sign(params), url = 'http://internal.local/api/twilio-inbound', tokenHeader = true } = {}) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'taylor-marriott.com',
  };
  if (tokenHeader && signature != null) headers['x-twilio-signature'] = signature;
  return new Request(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
}

function baseParams(overrides = {}) {
  return {
    MessageSid: 'SM111',
    From: '+447911123456',
    To: '+447378961404',
    Body: 'Hello, is this the preview?',
    NumMedia: '0',
    ...overrides,
  };
}

async function post(params, opts = {}) {
  const store = opts.store || useStore();
  const sent = [];
  const env = {
    TWILIO_AUTH_TOKEN: opts.token === undefined ? TOKEN : opts.token,
    INBOUND_NOTIFY_LIVE: opts.live ? '1' : '0',
  };
  const res = await handleTwilioInbound(requestFor(params, opts.request || {}), {
    env,
    store,
    now: () => opts.now || NOW,
    findBillingAccountByPhone: opts.findBillingAccountByPhone || (async () => null),
    sendMail: async (msg) => {
      sent.push(msg);
      if (opts.sendResult) return opts.sendResult;
      return { ok: true };
    },
  });
  return { res, store, sent, text: await res.text() };
}

test('public webhook URL uses forwarded proto and host', () => {
  const request = new Request('http://internal.local/api/twilio-inbound?x=1', {
    headers: {
      'x-forwarded-proto': 'https,http',
      'x-forwarded-host': 'taylor-marriott.com, internal.local',
    },
  });
  assert.equal(publicWebhookUrl(request), 'https://taylor-marriott.com/api/twilio-inbound?x=1');
});

test('signature: valid SMS is stored, invalid and missing token are 403', async () => {
  const params = baseParams();
  const ok = await post(params, { live: true });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers.get('content-type'), 'text/xml; charset=utf-8');
  assert.equal(ok.text, '<?xml version="1.0" encoding="UTF-8"?><Response/>');
  assert.equal(ok.text.includes('<Message'), false);
  assert.equal(ok.sent.length, 1);
  const stored = await getMessage('SM111', ok.store);
  assert.equal(stored.from, '+447911123456');
  assert.equal(stored.channel, 'sms');
  assert.equal(stored.body, params.Body);
  assert.equal(stored.notified, true);

  const bad = await post(params, {
    store: useStore(),
    request: { signature: 'not-the-signature' },
  });
  assert.equal(bad.res.status, 403);
  assert.equal(await getMessage('SM111', bad.store), null);
  assert.equal(bad.sent.length, 0);

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const missing = await post(params, { token: '', store: useStore() });
    assert.equal(missing.res.status, 403);
    assert.equal(await getMessage('SM111', missing.store), null);
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((line) => line.includes('TWILIO_AUTH_TOKEN') && line.includes('fail closed')));
});

test('signature must match the forwarded public URL, not the internal URL', async () => {
  const params = baseParams({ MessageSid: 'SM-url' });
  const internal = sign(params, 'http://internal.local/api/twilio-inbound');
  const rejected = await post(params, { request: { signature: internal } });
  assert.equal(rejected.res.status, 403);

  const accepted = await post(params, { request: { signature: sign(params) } });
  assert.equal(accepted.res.status, 200);
});

test('WhatsApp prefix is normalised to E.164 and channel whatsapp', async () => {
  const params = baseParams({
    MessageSid: 'SM-wa',
    From: 'whatsapp:+44 7911 123456',
    To: 'whatsapp:+447378961404',
    Body: 'Got the preview',
    NumMedia: '2',
  });
  const parsed = parseTwilioInbound(params, NOW);
  assert.equal(parsed.channel, 'whatsapp');
  assert.equal(parsed.from, '+447911123456');
  assert.equal(parsed.to, '+447378961404');
  assert.equal(parsed.mediaCount, 2);
  assert.equal(toE164('07911123456'), '+447911123456');

  const { res, store, sent } = await post(params, { live: true });
  assert.equal(res.status, 200);
  const message = await getMessage('SM-wa', store);
  assert.equal(message.channel, 'whatsapp');
  assert.equal(message.mediaCount, 2);
  assert.match(sent[0].text, /Channel: WhatsApp/);
  assert.match(sent[0].text, /Media: 2/);
  assert.equal(sent[0].to, 'nathan@taylor-marriott.com');
});

test('MessageSid is idempotent and does not email twice', async () => {
  const store = useStore();
  const params = baseParams({ MessageSid: 'SM-dup', Body: 'First reply' });
  const first = await post(params, { store, live: true, now: NOW });
  const second = await post(params, { store, live: true, now: '2026-10-21T09:00:00.000Z' });
  assert.equal(first.res.status, 200);
  assert.equal(second.res.status, 200);
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 0);
  const leads = await listLeads(store);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].repliedAt, NOW);
  assert.equal(await hasReplied('+447911123456', store), true);
});

test('opt-out phrases suppress, ordinary stop sentences do not', () => {
  const yes = [
    'STOP',
    'stop.',
    'STOPALL',
    'unsubscribe',
    'Please unsubscribe me',
    'cancel',
    'END',
    'quit',
    'stop texting',
    'please stop texting me',
    'not interested',
    'No thanks, not interested',
    'REMOVE ME',
    'please remove me from your list',
    "don't text me",
    'stop texting me about the website',
    'I am not interested',
  ];
  const no = [
    'stop by tomorrow?',
    'Can you stop by tomorrow?',
    'stop by the shop tomorrow',
    'end of the day',
    'cancel my appointment',
    'not interested, what is the price?',
    'hello',
    '',
  ];
  for (const body of yes) assert.equal(isOptOut(body), true, body);
  for (const body of no) assert.equal(isOptOut(body), false, body);
});

test('opt-out writes the suppression list; a normal reply only sets replied', async () => {
  const store = useStore();
  const opt = await post(
    baseParams({ MessageSid: 'SM-stop', Body: 'STOP', From: '+447900000001' }),
    { store, live: false },
  );
  assert.equal(opt.res.status, 200);
  assert.equal(await isSuppressed('+447900000001', store), true);
  assert.equal(await isSuppressed('07900000001', store), true);
  assert.equal(await hasReplied('+447900000001', store), true);
  const stopped = await getLead('+447900000001', store);
  assert.equal(stopped.replied, true);
  assert.equal(stopped.sequence.status, 'halted');
  assert.equal(stopped.sequence.haltReason, 'opt-out');

  await post(
    baseParams({ MessageSid: 'SM-chat', Body: 'stop by tomorrow?', From: '+447900000002' }),
    { store, live: false },
  );
  assert.equal(await hasReplied('+447900000002', store), true);
  assert.equal(await isSuppressed('+447900000002', store), false);
  const chatting = await getLead('+447900000002', store);
  assert.equal(chatting.optedOut, false);
  assert.equal(chatting.sequence.status, 'halted');
  assert.equal(chatting.sequence.haltReason, 'replied');

  const revived = await saveLead(
    '+447900000002',
    { sequence: { status: 'active', nextTouchOn: '2026-10-23' } },
    store,
  );
  assert.equal(revived.sequence.status, 'halted');
  assert.equal(revived.replied, true);

  await markReplied('+447900000003', { at: NOW, channel: 'sms', messageSid: 'SM-manual' }, store);
  assert.equal(await hasReplied('+44 7900 000003', store), true);
  assert.equal(await isSuppressed('+447900000003', store), false);
});

test('notify live includes lead profile; notify off only logs', async () => {
  const store = useStore();
  await saveLead(
    '+447911123456',
    {
      businessName: 'S&R Construction',
      previewUrl: 'https://tmbulk-s-and-r-construction-atherstone.netlify.app/',
      placeId: 'cid-5705786826933327223',
      sequence: { status: 'active', touches: [{ day: 0, channel: 'sms' }] },
    },
    store,
  );

  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  let dry;
  try {
    dry = await post(baseParams({ MessageSid: 'SM-dry', Body: 'Yes please' }), { store, live: false });
  } finally {
    console.info = original;
  }
  assert.equal(dry.sent.length, 0);
  assert.ok(logs.some((line) => line.includes('INBOUND_NOTIFY_LIVE is off')));
  assert.ok(logs.some((line) => line.includes('S&R Construction')));
  assert.ok(logs.some((line) => line.includes('Yes please')));

  const live = await post(
    baseParams({ MessageSid: 'SM-live', Body: 'STOP', From: '+447922222222' }),
    {
      store,
      live: true,
      findBillingAccountByPhone: async () => ({
        phone: '+447922222222',
        businessName: 'Atherstone Roofs',
        placeId: 'cid-5705786826933327223',
      }),
    },
  );
  assert.equal(live.sent.length, 1);
  const mail = live.sent[0];
  assert.equal(mail.to, 'nathan@taylor-marriott.com');
  assert.match(mail.subject, /SMS opt-out from \+447922222222/);
  assert.match(mail.text, /From: \+447922222222/);
  assert.match(mail.text, /Channel: SMS/);
  assert.match(mail.text, /Opt-out: yes/);
  assert.match(mail.text, /Atherstone Roofs/);
  assert.match(mail.text, /tmbulk-s-and-r-construction-atherstone\.netlify\.app/);
  assert.equal(mail.text.includes('\u2014'), false);
});

test('billing account phone fills business and preview when the lead has none', async () => {
  const accounts = memoryStore();
  await accounts.setJSON('sub_1', {
    phone: '07933 000111',
    businessName: 'North Plumbing',
    placeId: 'cid-5705786826933327223',
  });
  const found = await findBillingAccountByPhone('+447933000111', accounts);
  assert.equal(found.businessName, 'North Plumbing');

  const { sent, res } = await post(
    baseParams({ MessageSid: 'SM-bill', From: '+447933000111', Body: 'Who is this?' }),
    {
      live: true,
      findBillingAccountByPhone: async (phone) => findBillingAccountByPhone(phone, accounts),
    },
  );
  assert.equal(res.status, 200);
  assert.match(sent[0].text, /North Plumbing/);
  assert.match(sent[0].text, /Preview: https:\/\/tmbulk-s-and-r-construction-atherstone\.netlify\.app\//);
});

test('non-POST is 405 and a signed body without MessageSid is 400', async () => {
  const store = useStore();
  const get = await handleTwilioInbound(new Request(URL, { method: 'GET' }), {
    env: { TWILIO_AUTH_TOKEN: TOKEN },
    store,
  });
  assert.equal(get.status, 405);

  const bad = await post(baseParams({ MessageSid: '' }), { store });
  assert.equal(bad.res.status, 400);
  assert.equal(await hasReplied('+447911123456', store), false);
});
