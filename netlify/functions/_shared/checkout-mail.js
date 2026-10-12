import { mailConfig, sendMail } from './mailer.js';
import { sendEmailOnce } from './checkoutEmailLog.js';
import {
  checkoutSessionFromEvent,
  formatAmount,
  renewalCopyForSession,
  stripeCustomerUrl,
  stripeSessionUrl,
} from './checkout-mail-context.js';
import { CLIENT_SITES } from './client-sites.js';
import { subscriptionMetadataFromInvoiceHelper } from './checkout-mail-stripe-events.js';

function dryRunPrefix(livemode, fulfilDryRun) {
  if (fulfilDryRun) return '[DRY-RUN fulfilment] ';
  if (!livemode) return '[Stripe test mode] ';
  return '';
}

export async function sendCheckoutPaymentEmails(event, opts = {}) {
  const session = checkoutSessionFromEvent(event);
  if (!session) return { ignored: true };

  const cfg = mailConfig(opts.env);
  const send = opts.sendMail || sendMail;
  const once = opts.sendEmailOnce || sendEmailOnce;
  const modeLabel = session.mode === 'subscription' ? 'subscription (website + domain)' : 'one-off (website)';

  const renewal = renewalCopyForSession(session);
  const businessLine = session.business ? `Business: ${session.business}\n` : '';
  const domainLine = session.domain ? `Domain: ${session.domain}\n` : 'Domain: (none — website only)\n';

  const nathanSubject = `${dryRunPrefix(session.livemode, false)}New checkout payment — ${session.business || session.placeId || session.sessionId}`;
  const nathanText = [
    `${dryRunPrefix(session.livemode, false)}A client completed checkout.`,
    '',
    businessLine.trim(),
    `place_id: ${session.placeId || '—'}`,
    domainLine.trim(),
    `Amount paid today: ${formatAmount(session)}`,
    `Stripe mode: ${modeLabel}`,
    `Session: ${stripeSessionUrl(session)}`,
    session.customerId ? `Customer: ${stripeCustomerUrl(session)}` : null,
    session.customerEmail ? `Client email: ${session.customerEmail}` : null,
    renewal ? renewal.line : null,
  ]
    .filter(Boolean)
    .join('\n');

  await once(`payment:nathan:${session.sessionId}`, () =>
    send({
      to: cfg.alertTo,
      subject: nathanSubject,
      text: nathanText,
    }),
  );

  if (session.customerEmail) {
    const bought =
      session.domain && renewal
        ? `Website (£299) and domain ${session.domain} (year one included). ${renewal.line}`
        : 'Website package (£299 one-time).';
    const nextSteps = session.domain
      ? 'We are registering your domain and connecting it to your site. We will email you when your domain is live (usually within an hour, sometimes up to 24 hours while DNS updates).'
      : 'We will be in touch about next steps for your live website.';

    const clientText = [
      'Thank you for your payment.',
      '',
      `What you bought: ${bought}`,
      '',
      'What happens next:',
      nextSteps,
      '',
      'If you have questions, reply to this email.',
      '',
      `Reference: ${session.sessionId}`,
    ].join('\n');

    await once(`payment:client:${session.sessionId}`, () =>
      send({
        to: session.customerEmail,
        subject: 'Payment received — Taylor-Marriott',
        text: clientText,
      }),
    );
  }

  return { ok: true };
}

export async function sendDomainFulfilEmails(
  { order, result, switches },
  opts = {},
) {
  if (!order || !order.sessionId) return { ignored: true };
  const cfg = mailConfig(opts.env);
  const send = opts.sendMail || sendMail;
  const once = opts.sendEmailOnce || sendEmailOnce;
  const status = result && result.status;
  const purchaseLive = switches && switches.purchaseLive === true && order.livemode === true;
  const connectLive = switches && switches.connectLive === true;
  const fulfilDryRun = !purchaseLive || !connectLive || status === 'dry_run' || status === 'registered';

  const registry = order.placeId ? CLIENT_SITES[order.placeId] : null;
  const business = (registry && registry.business) || order.placeId || '—';

  if (status === 'error' || status === 'error_after_register') {
    const err = (result && result.error) || {};
    const text = [
      'Domain fulfilment failed after a paid checkout.',
      '',
      `Business: ${business}`,
      `place_id: ${order.placeId || '—'}`,
      `Domain: ${order.domain}`,
      `Session: ${order.sessionId}`,
      `Status: ${status}`,
      `Error: ${err.code || 'ERROR'} — ${err.message || 'unknown'}`,
      '',
      'What to do: check Porkbun, Netlify site mapping, and DOMAIN_PURCHASE_LIVE / DOMAIN_CONNECT_LIVE. Re-run fulfilment from the stored order if needed.',
    ].join('\n');
    await once(`fulfil:fail:nathan:${order.sessionId}`, () =>
      send({ to: cfg.alertTo, subject: `[ALERT] Domain fulfilment failed — ${order.domain}`, text }),
    );
    return { alerted: true };
  }

  if (fulfilDryRun || status === 'dry_run' || (status === 'registered' && !connectLive)) {
    const text = [
      '[DRY-RUN] Domain fulfilment finished (no client “domain live” email sent).',
      '',
      `Business: ${business}`,
      `place_id: ${order.placeId || '—'}`,
      `Domain: ${order.domain}`,
      `Session: ${order.sessionId}`,
      `Result status: ${status}`,
      `DOMAIN_PURCHASE_LIVE: ${switches && switches.purchaseLive ? '1' : '0'}`,
      `DOMAIN_CONNECT_LIVE: ${switches && switches.connectLive ? '1' : '0'}`,
      `Stripe livemode: ${order.livemode ? 'yes' : 'no (test)'}`,
    ].join('\n');
    await once(`fulfil:dryrun:nathan:${order.sessionId}`, () =>
      send({ to: cfg.alertTo, subject: `[DRY-RUN] Domain fulfilment complete — ${order.domain}`, text }),
    );
    return { dryRunNotice: true };
  }

  if (status === 'connected' && order.customerEmail) {
    const text = [
      `Good news — your domain ${order.domain} is now connected to your website.`,
      '',
      'It may take a little time for DNS and SSL to finish worldwide. If you do not see it yet, try again in an hour.',
      '',
      'If anything looks wrong, reply to this email.',
    ].join('\n');
    await once(`fulfil:live:client:${order.sessionId}`, () =>
      send({
        to: order.customerEmail,
        subject: `Your domain ${order.domain} is live`,
        text,
      }),
    );
    return { clientNotified: true };
  }

  return { noop: true };
}

export async function sendDomainRenewFailureEmail(job, result, opts = {}) {
  if (!job || !job.invoiceId) return { ignored: true };
  const cfg = mailConfig(opts.env);
  const send = opts.sendMail || sendMail;
  const once = opts.sendEmailOnce || sendEmailOnce;
  const err = (result && result.error) || {};
  const registry = job.placeId ? CLIENT_SITES[job.placeId] : null;

  const text = [
    'Domain renewal at Porkbun failed after a paid Stripe invoice.',
    '',
    `Business: ${(registry && registry.business) || '—'}`,
    `place_id: ${job.placeId || '—'}`,
    `Domain: ${job.domain}`,
    `Invoice: ${job.invoiceId}`,
    `Subscription: ${job.subscriptionId || '—'}`,
    `Error: ${err.code || 'ERROR'} — ${err.message || 'unknown'}`,
    '',
    'What to do: verify Porkbun balance, domain status, and DOMAIN_PURCHASE_LIVE. Client may need manual renewal.',
  ].join('\n');

  await once(`renew:fail:nathan:${job.invoiceId}`, () =>
    send({ to: cfg.alertTo, subject: `[ALERT] Domain renewal failed — ${job.domain}`, text }),
  );
  return { alerted: true };
}

export async function sendInvoicePaymentFailedEmail(event, opts = {}) {
  const info = invoicePaymentFailedFromEvent(event);
  if (!info) return { ignored: true };
  const cfg = mailConfig(opts.env);
  const send = opts.sendMail || sendMail;
  const once = opts.sendEmailOnce || sendEmailOnce;
  const registry = info.placeId ? CLIENT_SITES[info.placeId] : null;

  const text = [
    "A client's yearly domain payment failed in Stripe.",
    '',
    `Business: ${(registry && registry.business) || '—'}`,
    `place_id: ${info.placeId || '—'}`,
    `Domain: ${info.domain || '—'}`,
    `Invoice: ${info.invoiceId}`,
    `Subscription: ${info.subscriptionId || '—'}`,
    `Attempt: ${info.attemptCount ?? '—'}`,
    '',
    'What to do: Stripe will retry (Smart Retries). If the subscription becomes unpaid or is cancelled, the domain will lapse — no Porkbun renew until invoice.paid.',
  ].join('\n');

  await once(`invoice-failed:nathan:${info.invoiceId}`, () =>
    send({
      to: cfg.alertTo,
      subject: `[ALERT] Domain subscription payment failed — ${info.domain || info.invoiceId}`,
      text,
    }),
  );
  return { alerted: true };
}

export async function sendSubscriptionLapsingEmail(info, opts = {}) {
  if (!info || !info.subscriptionId) return { ignored: true };
  const cfg = mailConfig(opts.env);
  const send = opts.sendMail || sendMail;
  const once = opts.sendEmailOnce || sendEmailOnce;
  const registry = info.placeId ? CLIENT_SITES[info.placeId] : null;

  const text = [
    'A domain subscription was cancelled or is unpaid — domain marked lapsing.',
    '',
    `Business: ${(registry && registry.business) || '—'}`,
    `place_id: ${info.placeId || '—'}`,
    `Domain: ${info.domain || '—'}`,
    `Subscription: ${info.subscriptionId}`,
    `Stripe status: ${info.status || '—'}`,
    '',
    'What to do: no further Porkbun renewals will run for this subscription. Domain may expire at the registrar unless the client pays or you intervene.',
  ].join('\n');

  await once(`lapsing:nathan:${info.subscriptionId}`, () =>
    send({
      to: cfg.alertTo,
      subject: `[ALERT] Domain subscription lapsing — ${info.domain || info.subscriptionId}`,
      text,
    }),
  );
  return { alerted: true };
}

export function invoicePaymentFailedFromEvent(event) {
  if (!event || event.type !== 'invoice.payment_failed') return null;
  const inv = event.data && event.data.object;
  if (!inv || inv.object !== 'invoice') return null;
  const m = subscriptionMetadataFromInvoiceHelper(inv);
  if (m.product_type !== 'site_checkout') return null;
  const domain = String(m.domain || '').trim();
  return {
    eventId: event.id,
    invoiceId: inv.id,
    subscriptionId: inv.subscription || null,
    placeId: m.place_id || null,
    domain: domain || null,
    attemptCount: inv.attempt_count ?? null,
    livemode: event.livemode === true && inv.livemode === true,
  };
}

export function subscriptionLapsingFromUpdatedEvent(event) {
  if (!event || event.type !== 'customer.subscription.updated') return null;
  const sub = event.data && event.data.object;
  if (!sub || sub.object !== 'subscription') return null;
  const m = sub.metadata || {};
  if (m.product_type !== 'site_checkout') return null;
  const status = String(sub.status || '');
  if (!['unpaid', 'canceled'].includes(status)) return null;
  const domain = String(m.domain || '').trim();
  return {
    eventId: event.id,
    subscriptionId: sub.id,
    placeId: m.place_id || null,
    domain: domain || null,
    status,
    livemode: event.livemode === true && sub.livemode === true,
  };
}
