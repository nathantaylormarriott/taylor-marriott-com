import { fulfilDomainOrder, switchesFromEnv } from './_shared/domain-fulfil.js';
import { getOrder, putOrder } from './_shared/domainOrders.js';
import { loadCheckoutConfigWithFx } from './_shared/checkout-config-async.js';

/**
 * Background job. Only acts on orders the signed Stripe webhook stored with
 * status "queued", so calling this URL directly cannot buy anything new.
 */
export default async (request) => {
  let sessionId = '';
  try {
    sessionId = String((await request.json()).sessionId || '');
  } catch {
    return;
  }
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return;

  const record = await getOrder(sessionId);
  if (!record || record.status !== 'queued') {
    console.info('[domain-fulfil] nothing to do', sessionId, record && record.status);
    return;
  }
  await putOrder(sessionId, { ...record, status: 'processing' });

  const switches = switchesFromEnv();
  const config = await loadCheckoutConfigWithFx();
  const result = await fulfilDomainOrder(record.order, {
    ...switches,
    usdToGbp: config.usdToGbp,
    alreadyRegistered: record.registered === true,
  });

  const registered = record.registered === true || result.registered === true;
  // A failure after a real registration keeps "registered" so a replay only retries DNS/Netlify.
  const status = result.status === 'error' ? (registered ? 'error_after_register' : 'error') : result.status;
  await putOrder(sessionId, {
    ...record,
    status,
    registered,
    lastResult: result,
    history: [...(record.history || []), { at: new Date().toISOString(), status, switches }].slice(-20),
  });
  console.info('[domain-fulfil]', sessionId, record.order.domain, status, JSON.stringify(result.error || {}));
};

export const config = {
  background: true,
  path: '/api/domain-fulfil',
};
