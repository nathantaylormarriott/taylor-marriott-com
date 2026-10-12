import { verifyStripeWebhook } from './_shared/domain-checkout.js';
import { orderFromEvent } from './_shared/domain-fulfil.js';
import { renewalFromInvoiceEvent, subscriptionDeletedFromEvent } from './_shared/domain-renew.js';
import { getOrder, putOrder, FINAL_STATUSES } from './_shared/domainOrders.js';
import { getRenewal, putRenewal, RENEWAL_DONE_STATUSES } from './_shared/domainRenewals.js';
import { putSubscriptionRecord, markSubscriptionLapsing, getSubscriptionRecord } from './_shared/domainSubscriptions.js';
import { checkoutAccountFromEvent, paymentFailedFromEvent, subscriptionStatusFromEvent } from './_shared/billing-events.js';
import { getAccount, putAccount, getDunning, putDunning } from './_shared/billing-store.js';
import { emptyDunning, isTerminalUnpaidStatus, reconcileDrift } from '../../shared/billing-lifecycle.js';
import { applySiteChange, writeClientPauseSwitch } from './_shared/billing-actions.js';
import { envFlag, readEnv } from './_shared/billing-env.js';
import { netlifyApi } from './_shared/netlify-sites.js';
import { sendCheckoutPaymentEmails, sendInvoicePaymentFailedEmail, sendSubscriptionLapsingEmail, subscriptionLapsingFromUpdatedEvent } from './_shared/checkout-mail.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function liveSiteDeps() {
  const token = readEnv('NETLIFY_AUTH_TOKEN');
  return {
    netlifyApi,
    writePause: ({ siteId, record }) => writeClientPauseSwitch({ siteId, record, token }),
  };
}

async function rememberCheckoutAccount(event) {
  const account = checkoutAccountFromEvent(event);
  if (!account) return;
  const existing = (await getAccount(account.id)) || {};
  await putAccount(account.id, {
    ...existing,
    ...account,
    phone: account.phone || existing.phone || null,
    localPaused: existing.localPaused === true,
  });
}

async function handlePaymentFailed(event) {
  try {
    await sendInvoicePaymentFailedEmail(event);
  } catch (err) {
    console.error('[stripe-webhook] invoice.payment_failed email', err.message);
  }
  const info = paymentFailedFromEvent(event);
  if (!info) return json({ received: true, ignored: true });
  const existing = (await getDunning(info.invoiceId)) || emptyDunning(info.invoiceId);
  if (existing.status !== 'paid' && existing.status !== 'uncollectible') {
    await putDunning(info.invoiceId, {
      ...existing,
      hostedInvoiceUrl: info.hostedInvoiceUrl || existing.hostedInvoiceUrl || null,
    });
  }
  if (info.subscriptionId) {
    const account = (await getAccount(info.subscriptionId)) || { id: info.subscriptionId };
    const stripeStatus = isTerminalUnpaidStatus(account.stripeStatus) ? account.stripeStatus : 'past_due';
    await putAccount(info.subscriptionId, {
      ...account,
      plan: info.plan || account.plan,
      domain: info.domain || account.domain || null,
      phone: info.phone || account.phone || null,
      email: info.email || account.email || null,
      placeId: info.placeId || account.placeId || null,
      netlifySiteId: info.netlifySiteId || account.netlifySiteId || null,
      netlifySiteName: info.netlifySiteName || account.netlifySiteName || null,
      stripeStatus,
      localPaused: account.localPaused === true,
    });
  }
  return json({ received: true, recorded: info.invoiceId, paused: false });
}

async function rememberSubscriptionStatus(event) {
  const info = subscriptionStatusFromEvent(event);
  if (!info) return null;
  const existing = (await getAccount(info.subscriptionId)) || { id: info.subscriptionId };
  const account = {
    ...existing,
    plan: info.plan || existing.plan,
    domain: info.domain || existing.domain || null,
    phone: info.phone || existing.phone || null,
    email: info.email || existing.email || null,
    customerId: info.customerId || existing.customerId || null,
    placeId: info.placeId || existing.placeId || null,
    netlifySiteId: info.netlifySiteId || existing.netlifySiteId || null,
    netlifySiteName: info.netlifySiteName || existing.netlifySiteName || null,
    stripeStatus: info.status,
    localPaused: existing.localPaused === true,
    domainDetached: existing.domainDetached === true,
  };
  await putAccount(info.subscriptionId, account);
  if (!info.terminal || account.localPaused || account.domainDetached) {
    return { updated: info.subscriptionId, paused: false, applied: false };
  }
  const drift = reconcileDrift({
    stripeStatus: info.status,
    localPaused: false,
    plan: account.plan,
    domainRenewalDue: account.plan !== 'monthly' || account.domainRenewalDue === true,
  });
  const live = envFlag('BILLING_ACTIONS_LIVE');
  if (drift.action === 'pause' && live) {
    await applySiteChange({ account, decision: drift, dryRun: false, deps: liveSiteDeps() });
    await putAccount(info.subscriptionId, {
      ...account,
      localPaused: drift.pauseSite === true,
      domainDetached: drift.detachDomain === true,
    });
  }
  return { updated: info.subscriptionId, paused: drift.action === 'pause', applied: live && drift.action === 'pause' };
}

async function handleCheckoutCompleted(event, base) {
  try {
    await rememberCheckoutAccount(event);
  } catch (err) {
    console.error('[stripe-webhook] billing account', err);
    return json({ error: 'could not store billing account' }, 500);
  }
  try {
    await sendCheckoutPaymentEmails(event);
  } catch (err) {
    console.error('[stripe-webhook] payment emails', err.message);
  }

  let order;
  try {
    order = orderFromEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] bad order', event.id, err.message);
    return json({ received: true, ignored: 'bad_domain' });
  }
  if (!order) {
    console.info('[stripe-webhook]', event.type, event.id, 'no domain to register');
    return json({ received: true, ignored: true });
  }

  try {
    const existing = await getOrder(order.sessionId);
    if (existing && FINAL_STATUSES.includes(existing.status)) {
      console.info('[stripe-webhook] duplicate', order.sessionId, existing.status);
      return json({ received: true, duplicate: existing.status });
    }
    await putOrder(order.sessionId, {
      ...(existing || {}),
      order,
      status: 'queued',
      registered: existing ? existing.registered === true : false,
      events: [...((existing && existing.events) || []), event.id].slice(-20),
    });
    if (order.subscriptionId) {
      const subExisting = (await getSubscriptionRecord(order.subscriptionId)) || {};
      await putSubscriptionRecord(order.subscriptionId, {
        ...subExisting,
        sessionId: order.sessionId,
        domain: order.domain,
        placeId: order.placeId,
        status: subExisting.status === 'lapsing' ? 'lapsing' : 'active',
        events: [...(subExisting.events || []), event.id].slice(-20),
      });
    }
  } catch (err) {
    console.error('[stripe-webhook] store', err);
    return json({ error: 'could not queue order' }, 500);
  }

  try {
    const res = await fetch(`${base}/api/domain-fulfil`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: order.sessionId }),
    });
    console.info('[stripe-webhook] queued', order.sessionId, order.domain, 'background', res.status);
  } catch (err) {
    console.error('[stripe-webhook] could not start background job', err.message);
    return json({ error: 'could not start fulfilment' }, 500);
  }
  return json({ received: true, queued: order.sessionId });
}

async function handleRenewalInvoice(event, base) {
  let job;
  try {
    job = renewalFromInvoiceEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] bad renewal', event.id, err.message);
    return json({ received: true, ignored: 'bad_renewal' });
  }
  if (!job) {
    return json({ received: true, ignored: true });
  }

  try {
    const existing = await getRenewal(job.invoiceId);
    if (existing && RENEWAL_DONE_STATUSES.includes(existing.status)) {
      console.info('[stripe-webhook] renewal duplicate', job.invoiceId, existing.status);
      return json({ received: true, duplicate: existing.status });
    }
    await putRenewal(job.invoiceId, {
      ...(existing || {}),
      job,
      status: 'queued',
      events: [...((existing && existing.events) || []), event.id].slice(-20),
    });
  } catch (err) {
    console.error('[stripe-webhook] renewal store', err);
    return json({ error: 'could not queue renewal' }, 500);
  }

  try {
    const res = await fetch(`${base}/api/domain-renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: job.invoiceId }),
    });
    console.info('[stripe-webhook] renewal queued', job.invoiceId, job.domain, res.status);
  } catch (err) {
    console.error('[stripe-webhook] could not start renewal job', err.message);
    return json({ error: 'could not start renewal' }, 500);
  }
  return json({ received: true, renewalQueued: job.invoiceId });
}

async function handleSubscriptionDeleted(event) {
  const info = subscriptionDeletedFromEvent(event);
  if (!info) return json({ received: true, ignored: true });

  try {
    await markSubscriptionLapsing(info.subscriptionId, info.eventId);
    if (info.subscriptionId) {
      const sub = await getSubscriptionRecord(info.subscriptionId);
      if (sub && sub.sessionId) {
        const ord = await getOrder(sub.sessionId);
        if (ord) {
          await putOrder(sub.sessionId, {
            ...ord,
            subscriptionStatus: 'lapsing',
            events: [...(ord.events || []), info.eventId].slice(-20),
          });
        }
      }
    }
    console.warn('[stripe-webhook] subscription lapsing', info.subscriptionId, info.domain);
    await rememberSubscriptionStatus(event);
  } catch (err) {
    console.error('[stripe-webhook] lapsing mark failed', err);
    return json({ error: 'could not mark lapsing' }, 500);
  }
  try {
    await sendSubscriptionLapsingEmail({ ...info, status: info.status || 'canceled' });
  } catch (err) {
    console.error('[stripe-webhook] lapsing email', err.message);
  }
  return json({ received: true, lapsing: info.subscriptionId });
}

async function handleSubscriptionUpdated(event) {
  const status = await rememberSubscriptionStatus(event);
  const info = subscriptionLapsingFromUpdatedEvent(event);
  if (info) {
    try {
      await markSubscriptionLapsing(info.subscriptionId, info.eventId);
    } catch (err) {
      console.error('[stripe-webhook] lapsing mark (updated)', err);
      return json({ error: 'could not mark lapsing' }, 500);
    }
    try {
      await sendSubscriptionLapsingEmail(info);
    } catch (err) {
      console.error('[stripe-webhook] lapsing email (updated)', err.message);
    }
    return json({ received: true, lapsing: info.subscriptionId, ...(status || {}) });
  }
  if (!status) return json({ received: true, ignored: true });
  return json({ received: true, ...status });
}

/**
 * Stripe webhooks: checkout (checkout.session.completed), renewals (invoice.paid),
 * failed payments (invoice.payment_failed), subscription lapsing (deleted / updated unpaid).
 */
export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch (err) {
    console.error('[stripe-webhook]', err.code || '', err.message);
    return json({ error: err.message }, err.code === 'BAD_STRIPE_SIGNATURE' ? 400 : 503);
  }

  const base = process.env.URL || new URL(request.url).origin;

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event, base);
    case 'invoice.paid':
      return handleRenewalInvoice(event, base);
    case 'invoice.payment_failed':
      return handlePaymentFailed(event);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);
    default:
      return json({ received: true, ignored: event.type });
  }
};

export const config = {
  path: '/api/stripe-webhook',
};
