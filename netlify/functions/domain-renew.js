import { fulfilDomainRenewal, switchesFromEnv } from './_shared/domain-renew.js';
import { getRenewal, putRenewal, RENEWAL_DONE_STATUSES } from './_shared/domainRenewals.js';
import { getSubscriptionRecord } from './_shared/domainSubscriptions.js';
import { loadCheckoutConfigWithFx } from './_shared/checkout-config-async.js';
import { sendDomainRenewFailureEmail } from './_shared/checkout-mail.js';

/**
 * Background job: Porkbun renew for one paid subscription_cycle invoice (idempotent per invoice id).
 */
export default async (request) => {
  let invoiceId = '';
  try {
    invoiceId = String((await request.json()).invoiceId || '');
  } catch {
    return;
  }
  if (!/^in_(test|live)_[A-Za-z0-9]+$/.test(invoiceId)) return;

  const record = await getRenewal(invoiceId);
  if (!record || record.status !== 'queued') {
    console.info('[domain-renew] nothing to do', invoiceId, record && record.status);
    return;
  }
  await putRenewal(invoiceId, { ...record, status: 'processing' });

  const switches = switchesFromEnv();
  const config = await loadCheckoutConfigWithFx();
  let subscriptionLapsing = false;
  if (record.job && record.job.subscriptionId) {
    const subRec = await getSubscriptionRecord(record.job.subscriptionId);
    subscriptionLapsing = subRec && subRec.status === 'lapsing';
  }

  const result = await fulfilDomainRenewal(record.job, {
    ...switches,
    usdToGbp: config.usdToGbp,
    subscriptionLapsing,
  });

  const status = result.status === 'error' ? 'error' : result.status;
  await putRenewal(invoiceId, {
    ...record,
    status,
    lastResult: result,
    history: [...(record.history || []), { at: new Date().toISOString(), status, switches }].slice(-20),
  });
  if (status === 'error') {
    console.error('[domain-renew] FAILED', invoiceId, record.job.domain, JSON.stringify(result.error));
    try {
      await sendDomainRenewFailureEmail(record.job, result);
    } catch (err) {
      console.error('[domain-renew] alert email', err.message);
    }
  } else {
    console.info('[domain-renew]', invoiceId, record.job.domain, status);
  }
};

export const config = {
  background: true,
  path: '/api/domain-renew',
};
