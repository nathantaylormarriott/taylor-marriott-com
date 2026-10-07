import { handleOptions, jsonResponse } from './_shared/http.js';
import {
  loadCheckoutConfig,
  livePorkbunClientPricePence,
} from './_shared/checkout-config.js';
import { checkDomain, getTldPricing, normalizeDomain } from './_shared/porkbun-client.js';
import {
  checkToAvailabilityState,
  quoteFromCheckAndTld,
} from './_shared/domainSearchMap.js';
import {
  createSiteCheckoutSession,
  siteCheckoutIdempotencyKey,
} from './_shared/domain-checkout.js';

const PLACE_ID_RE = /^[^\s?#&=]{6,256}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveCheckoutBaseUrl(request, config) {
  if (config.checkoutBaseUrl) return config.checkoutBaseUrl.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}/checkout`;
  return null;
}

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid JSON body' }, 400);
  }

  const config = loadCheckoutConfig();
  if (config.usdToGbp == null) {
    return jsonResponse(request, { error: 'usdToGbp_not_set' }, 503);
  }

  const placeId = String(body.place_id || '').trim();
  const emailRaw = body.email == null || body.email === '' ? '' : String(body.email).trim();
  const domainRaw = body.domain == null || body.domain === '' ? null : String(body.domain).trim();

  if (!placeId || !PLACE_ID_RE.test(placeId)) {
    return jsonResponse(request, { error: 'Invalid place_id' }, 400);
  }
  if (emailRaw && (!EMAIL_RE.test(emailRaw) || emailRaw.length > 254)) {
    return jsonResponse(request, { error: 'Invalid email' }, 400);
  }

  const checkoutBase = resolveCheckoutBaseUrl(request, config);
  if (!checkoutBase) {
    return jsonResponse(request, { error: 'Checkout base URL not configured' }, 503);
  }

  let domain = null;
  let domainAmountPence = null;

  if (domainRaw) {
    try {
      domain = normalizeDomain(domainRaw);
    } catch {
      return jsonResponse(request, { error: 'Invalid domain' }, 400);
    }

    try {
      const [check, tldPricing] = await Promise.all([
        checkDomain(domain),
        getTldPricing(config.offeredTlds),
      ]);
      const state = checkToAvailabilityState(check);
      if (state === 'taken') {
        return jsonResponse(request, { error: 'domain_taken', domain }, 409);
      }
      if (state === 'premium') {
        return jsonResponse(request, { error: 'domain_premium', domain }, 409);
      }
      if (state === 'unresolved') {
        return jsonResponse(request, { error: 'domain_unresolved', domain }, 409);
      }

      const quote = quoteFromCheckAndTld(check, tldPricing);
      const priced = livePorkbunClientPricePence(quote, config);
      if (priced.pence == null) {
        return jsonResponse(
          request,
          { error: priced.reason || 'no_registrar_price', domain },
          409,
        );
      }
      domainAmountPence = priced.pence;
    } catch (err) {
      console.error('[create-session] domain check', err);
      if (err.code === 'NO_PORKBUN') {
        return jsonResponse(request, { error: 'Domain check not configured' }, 503);
      }
      return jsonResponse(request, { error: 'Could not verify domain' }, 502);
    }
  }

  const successUrl = `${checkoutBase}/done?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${checkoutBase}?place_id=${encodeURIComponent(placeId)}&cancelled=1`;

  try {
    const idempotencyKey = siteCheckoutIdempotencyKey(placeId, domain);
    const result = await createSiteCheckoutSession(
      {
        placeId,
        domain,
        domainAmountPence,
        customerEmail: emailRaw || undefined,
        successUrl,
        cancelUrl,
      },
      { idempotencyKey, config },
    );

    if (!result.session?.url) {
      return jsonResponse(request, { error: 'Could not create checkout session' }, 500);
    }

    return jsonResponse(request, { url: result.session.url }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[create-session]', err);
    if (err.code === 'NO_STRIPE') {
      return jsonResponse(request, { error: 'Payments are not configured' }, 503);
    }
    if (err.code === 'BAD_CHECKOUT_INPUT') {
      return jsonResponse(request, { error: err.message }, 400);
    }
    if (err.code === 'STRIPE') {
      return jsonResponse(request, { error: err.message }, 502);
    }
    return jsonResponse(request, { error: 'Could not create checkout session' }, 500);
  }
};

export const config = {
  path: '/api/create-session',
};
