import { livePorkbunClientPricePence, formatGbp, tldOf } from './checkout-config.js';

export function porkbunRowToSearchResult(row, tldPricing, config) {
  const domain = row.domain;
  const tld = tldOf(domain);
  const tldRow = (tldPricing && tldPricing[tld]) || {};

  let state;
  if (row.state === 'unresolved' || row.state === 'missing') state = 'unresolved';
  else if (row.state === 'invalid') state = 'invalid';
  else if (row.premium === true) state = 'premium';
  else if (row.available === false) state = 'taken';
  else if (row.available === true) state = 'available';
  else state = 'unresolved';

  const quote = {
    domain,
    tld,
    price: row.price,
    renewalPrice: row.renewalPrice,
    registrationUsd: row.price ?? tldRow.registration,
    renewalUsd: row.renewalPrice ?? tldRow.renewal,
  };

  let clientPricePence = null;
  let clientPriceDisplay = null;
  if (state === 'available') {
    const priced = livePorkbunClientPricePence(quote, config);
    if (priced.pence != null) {
      clientPricePence = priced.pence;
      clientPriceDisplay = formatGbp(priced.pence);
    }
  }

  return {
    domain,
    tld,
    state,
    clientPricePence,
    clientPriceDisplay,
  };
}

export function quoteFromCheckAndTld(check, tldPricing) {
  const tld = tldOf(check.domain);
  const tldRow = (tldPricing && tldPricing[tld]) || {};
  return {
    domain: check.domain,
    tld,
    price: check.price,
    renewalPrice: check.renewalPrice,
    registrationUsd: check.price ?? tldRow.registration,
    renewalUsd: check.renewalPrice ?? tldRow.renewal,
  };
}

export function checkToAvailabilityState(check) {
  if (check.premium === true) return 'premium';
  if (check.available === false) return 'taken';
  if (check.available !== true) return 'unresolved';
  return 'available';
}
