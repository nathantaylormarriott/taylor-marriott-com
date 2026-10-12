import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSmsBody, gsmSeptetLength } from '../shared/sms-gsm.js';
import {
  WORST_BUSINESS,
  WORST_DOMAIN,
  WORST_LINK,
  WORST_PRICE,
  WORST_WHEN,
  smsDunning,
  smsPause,
  smsReminder,
  smsResume,
  worstCaseSms,
} from '../shared/sms-templates.js';
import { sendBillingSms } from '../netlify/functions/_shared/billing-sms.js';
import { createShortLink, readShortLink, setShortLinkStoreForTests } from '../netlify/functions/_shared/short-link.js';
import { memoryStore } from '../netlify/functions/_shared/billing-store.js';

const LONG_INVOICE = `https://invoice.stripe.com/i/acct_1AbCdEfGhIjKlMnO/live_${'a'.repeat(180)}`;

test('worst-case SMS templates are GSM-7 and at most 159 septets', () => {
  const rows = worstCaseSms();
  assert.deepEqual(rows.map((row) => row.id), ['dunning', 'reminder', 'pause', 'resume']);
  for (const row of rows) {
    assert.equal(gsmSeptetLength(row.body), row.length);
    assert.ok(row.length <= 159, `${row.id} is ${row.length}`);
    assert.ok(row.body.includes(WORST_BUSINESS), row.id);
    assert.ok(row.body.includes(WORST_DOMAIN), row.id);
    assert.ok(row.body.includes(WORST_LINK), row.id);
    assert.equal(assertSmsBody(row.body), row.body);
  }
  const reminder = rows.find((row) => row.id === 'reminder');
  assert.ok(reminder.body.includes(WORST_WHEN));
  assert.ok(reminder.body.includes(WORST_PRICE));
  assert.ok(reminder.body.includes('30d'));
  for (const days of [14, 7]) {
    const body = smsReminder({
      business: WORST_BUSINESS,
      domain: WORST_DOMAIN,
      days,
      whenLabel: WORST_WHEN,
      priceLabel: WORST_PRICE,
      link: WORST_LINK,
    });
    assert.ok(body.length <= reminder.length);
    assert.ok(body.length <= 159);
    if (days < 10) assert.ok(body.length < reminder.length);
  }
  const clipped = smsDunning({
    business: `${WORST_BUSINESS} and sons`,
    domain: `${WORST_DOMAIN}.example`,
    attempt: 10,
    link: WORST_LINK,
  });
  assert.ok(clipped.length <= 159);
  assert.equal(clipped.includes('and sons'), false);
});

test('sendBillingSms refuses over-length and non-GSM-7 before Twilio', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('Twilio was called');
  };
  const env = { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'test-token' };
  const tooLong = 'a'.repeat(160);
  await assert.rejects(sendBillingSms({ to: '+447000000000', body: tooLong, env, fetchImpl }), { code: 'SMS_TOO_LONG' });
  await assert.rejects(sendBillingSms({ to: '+447000000000', body: 'Pay \u2014 now', env, fetchImpl }), { code: 'SMS_NOT_GSM7' });
  await assert.rejects(sendBillingSms({ to: '+447000000000', body: 'Pay \u2019 now', env, fetchImpl }), { code: 'SMS_NOT_GSM7' });
  await assert.rejects(sendBillingSms({ to: '+447000000000', body: 'Pay \u{1F600}', env, fetchImpl }), { code: 'SMS_NOT_GSM7' });
  assert.equal(calls, 0);
  assert.throws(() => smsPause({ business: WORST_BUSINESS, domain: WORST_DOMAIN, link: LONG_INVOICE }), { code: 'SMS_TOO_LONG' });
});

test('sendBillingSms sends a short GSM-7 body', async () => {
  let sent = '';
  const env = { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM_NUMBER: '+447378961404' };
  const result = await sendBillingSms({
    to: '+447000000000',
    body: smsResume({ business: 'Acme', domain: 'acme.co.uk', link: WORST_LINK }),
    env,
    fetchImpl: async (_url, init) => {
      sent = init.body;
      return new Response(JSON.stringify({ sid: 'SM_test' }), { status: 201 });
    },
  });
  assert.equal(result.sid, 'SM_test');
  assert.match(sent, /taylor-marriott.com%2Fp%2Fabcd1234|taylor-marriott.com\/p\/abcd1234/);
});

test('short link stores a Stripe URL and redirects', async () => {
  const store = memoryStore();
  setShortLinkStoreForTests(store);
  const link = await createShortLink(LONG_INVOICE, store);
  assert.match(link, /^https:\/\/taylor-marriott.com\/p\/[A-Za-z0-9]{8}$/);
  assert.equal(link.length, WORST_LINK.length);
  const id = link.slice(link.lastIndexOf('/') + 1);
  const { default: redirect } = await import('../netlify/functions/pay-redirect.js');
  const res = await redirect(new Request(`https://taylor-marriott.com/p/${id}`));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), LONG_INVOICE);
  await assert.rejects(createShortLink('https://evil.example/invoice', store), { code: 'BAD_PAY_LINK' });
  await store.setJSON('badlink1', { url: 'https://evil.example/phish' });
  assert.equal(await readShortLink('badlink1', store), null);
  const missing = await redirect(new Request('https://taylor-marriott.com/p/missing1'));
  assert.equal(missing.status, 404);
});
