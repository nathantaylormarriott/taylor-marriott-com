import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, mailConfig } from '../netlify/functions/_shared/mailer.js';
import {
  sendEmailOnce,
  memoryCheckoutEmailStore,
  setCheckoutEmailStoreForTests,
  wasEmailSent,
} from '../netlify/functions/_shared/checkoutEmailLog.js';
import { checkoutSessionFromEvent } from '../netlify/functions/_shared/checkout-mail-context.js';
import {
  sendCheckoutPaymentEmails,
  sendDomainFulfilEmails,
  sendDomainRenewFailureEmail,
  sendInvoicePaymentFailedEmail,
  sendSubscriptionLapsingEmail,
  invoicePaymentFailedFromEvent,
  subscriptionLapsingFromUpdatedEvent,
} from '../netlify/functions/_shared/checkout-mail.js';
import {
  previewUrlFromRegistry,
  previewUrlFromConfig,
} from '../netlify/functions/_shared/checkout-preview-resolve.js';

test('mailer skips when Gmail and SendGrid not configured', async () => {
  const r = await sendMail({ to: 'a@b.com', subject: 't', text: 'x' }, { env: {} });
  assert.equal(r.skipped, true);
});

test('mailer sends via Gmail when OAuth configured', async () => {
  let captured = null;
  const r = await sendMail(
    { to: 'client@example.com', subject: 'Hi', text: 'Body' },
    {
      env: {
        GOOGLE_OAUTH_CLIENT_ID: 'cid',
        GOOGLE_OAUTH_CLIENT_SECRET: 'sec',
        GOOGLE_GMAIL_REFRESH_TOKEN: 'rt',
        CHECKOUT_FROM_EMAIL: 'nathan@taylor-marriott.com',
      },
      gmailSend: async (msg) => {
        captured = msg;
        return { ok: true, provider: 'gmail' };
      },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(captured.to[0], 'client@example.com');
});

test('mailer sends via SendGrid when only SendGrid configured', async () => {
  let captured = null;
  const fetchFn = async (url, init) => {
    captured = { url, init };
    return { ok: true, text: async () => '' };
  };
  const r = await sendMail(
    { to: 'client@example.com', subject: 'Hi', text: 'Body' },
    { env: { SENDGRID_API_KEY: 'SG.test', SENDGRID_FROM_EMAIL: 'nathan@taylor-marriott.com' }, fetchFn },
  );
  assert.equal(r.ok, true);
  assert.equal(captured.url, 'https://api.sendgrid.com/v3/mail/send');
});

test('sendEmailOnce is idempotent', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  let calls = 0;
  const sendFn = async () => {
    calls += 1;
    return { ok: true };
  };
  const a = await sendEmailOnce('key-1', sendFn, store);
  const b = await sendEmailOnce('key-1', sendFn, store);
  assert.equal(calls, 1);
  assert.equal(a.sent, true);
  assert.equal(b.duplicate, true);
  assert.equal(await wasEmailSent('key-1', store), true);
  setCheckoutEmailStoreForTests(null);
});

test('checkout payment emails: Nathan + client once each', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  const sendMailMock = async (msg) => {
    sent.push(msg);
    return { ok: true };
  };
  const event = {
    id: 'evt_pay',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        object: 'checkout.session',
        id: 'cs_test_mail1',
        livemode: false,
        payment_status: 'paid',
        mode: 'subscription',
        amount_total: 29900,
        currency: 'gbp',
        client_reference_id: 'cid-5705786826933327223',
        customer_details: { email: 'buyer@example.com' },
        metadata: {
          product_type: 'site_checkout',
          place_id: 'cid-5705786826933327223',
          domain: 'example.co.uk',
          domain_amount_pence: '1500',
        },
      },
    },
  };
  const session = checkoutSessionFromEvent(event);
  assert.ok(session.business);
  await sendCheckoutPaymentEmails(event, { sendMail: sendMailMock, env: { SENDGRID_API_KEY: 'x', CHECKOUT_ALERT_EMAIL: 'nathan@taylor-marriott.com' } });
  await sendCheckoutPaymentEmails(event, { sendMail: sendMailMock, env: { SENDGRID_API_KEY: 'x', CHECKOUT_ALERT_EMAIL: 'nathan@taylor-marriott.com' } });
  assert.equal(sent.length, 2);
  assert.ok(sent.some((m) => m.to === 'nathan@taylor-marriott.com'));
  assert.ok(sent.some((m) => m.to === 'buyer@example.com'));
  setCheckoutEmailStoreForTests(null);
});

test('domain fulfil dry-run: Nathan only, not client', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  await sendDomainFulfilEmails(
    {
      order: {
        sessionId: 'cs_test_dry',
        domain: 'x.co.uk',
        placeId: 'cid-1',
        livemode: false,
        customerEmail: 'buyer@example.com',
      },
      result: { status: 'dry_run' },
      switches: { purchaseLive: false, connectLive: false },
    },
    { sendMail: async (m) => (sent.push(m), { ok: true }), env: { SENDGRID_API_KEY: 'x' } },
  );
  await sendDomainFulfilEmails(
    {
      order: {
        sessionId: 'cs_test_dry',
        domain: 'x.co.uk',
        placeId: 'cid-1',
        livemode: false,
        customerEmail: 'buyer@example.com',
      },
      result: { status: 'dry_run' },
      switches: { purchaseLive: false, connectLive: false },
    },
    { sendMail: async (m) => (sent.push(m), { ok: true }), env: { SENDGRID_API_KEY: 'x' } },
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /DRY-RUN/);
  setCheckoutEmailStoreForTests(null);
});

test('domain fulfil connected: client live email once', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  await sendDomainFulfilEmails(
    {
      order: {
        sessionId: 'cs_test_live',
        domain: 'live.co.uk',
        placeId: 'cid-1',
        livemode: true,
        customerEmail: 'buyer@example.com',
      },
      result: { status: 'connected' },
      switches: { purchaseLive: true, connectLive: true },
    },
    { sendMail: async (m) => (sent.push(m), { ok: true }), env: { SENDGRID_API_KEY: 'x' } },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'buyer@example.com');
  assert.match(sent[0].subject, /live/i);
  setCheckoutEmailStoreForTests(null);
});

test('domain fulfil error alerts Nathan', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  await sendDomainFulfilEmails(
    {
      order: { sessionId: 'cs_test_err', domain: 'bad.co.uk', placeId: 'p', livemode: true },
      result: { status: 'error', error: { code: 'NO_SITE', message: 'missing' } },
      switches: {},
    },
    { sendMail: async (m) => (sent.push(m), { ok: true }), env: { SENDGRID_API_KEY: 'x' } },
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /fulfilment failed/i);
  setCheckoutEmailStoreForTests(null);
});

test('domain renew failure alerts Nathan', async () => {
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  await sendDomainRenewFailureEmail(
    { invoiceId: 'in_test_1', domain: 'd.co.uk', placeId: 'p', subscriptionId: 'sub_1' },
    { error: { code: 'ERR', message: 'boom' } },
    { sendMail: async (m) => (sent.push(m), { ok: true }), env: { SENDGRID_API_KEY: 'x' } },
  );
  assert.match(sent[0].subject, /renewal failed/i);
  setCheckoutEmailStoreForTests(null);
});

test('invoice.payment_failed parsed and alerts', async () => {
  const event = {
    type: 'invoice.payment_failed',
    livemode: false,
    data: {
      object: {
        object: 'invoice',
        id: 'in_fail_1',
        subscription: 'sub_x',
        attempt_count: 2,
        metadata: {},
        parent: {
          subscription_details: {
            metadata: { product_type: 'site_checkout', domain: 'shop.co.uk', place_id: 'pid' },
          },
        },
      },
    },
  };
  const info = invoicePaymentFailedFromEvent(event);
  assert.equal(info.domain, 'shop.co.uk');
  const store = memoryCheckoutEmailStore();
  setCheckoutEmailStoreForTests(store);
  const sent = [];
  await sendInvoicePaymentFailedEmail(event, {
    sendMail: async (m) => (sent.push(m), { ok: true }),
    env: { SENDGRID_API_KEY: 'x' },
  });
  assert.equal(sent.length, 1);
  setCheckoutEmailStoreForTests(null);
});

test('subscription updated unpaid triggers lapsing alert payload', () => {
  const info = subscriptionLapsingFromUpdatedEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        object: 'subscription',
        id: 'sub_u',
        status: 'unpaid',
        metadata: { product_type: 'site_checkout', domain: 'a.co.uk', place_id: 'p' },
      },
    },
  });
  assert.equal(info.status, 'unpaid');
  assert.equal(info.domain, 'a.co.uk');
});

test('preview URL from registry and config', () => {
  assert.equal(
    previewUrlFromRegistry('cid-5705786826933327223'),
    'https://tmbulk-s-and-r-construction-atherstone.netlify.app/',
  );
  assert.equal(previewUrlFromRegistry('unknown'), '');
  assert.equal(
    previewUrlFromConfig('cid-5705786826933327223', {
      'cid-5705786826933327223': 'https://tmbulk-s-and-r-construction-atherstone.netlify.app/',
    }),
    'https://tmbulk-s-and-r-construction-atherstone.netlify.app/',
  );
  assert.equal(previewUrlFromConfig('other', { other: 123 }), '');
});

test('mailConfig defaults', () => {
  const c = mailConfig({});
  assert.equal(c.fromEmail, 'nathan@taylor-marriott.com');
  assert.equal(c.alertTo, 'nathan@taylor-marriott.com');
});
