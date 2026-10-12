import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isYearlyPriceIncludedInPackage,
  includedMaxPenceFromGbp,
  domainRenewalUpfrontCopy,
  DOMAIN_FIRST_YEAR_TRIAL_DAYS,
} from '../shared/domain-package.js';
import { buildSiteCheckoutParams } from '../netlify/functions/_shared/domain-checkout.js';

test('included max £20 allows 2000p not 2001p', () => {
  const max = includedMaxPenceFromGbp(20);
  assert.equal(isYearlyPriceIncludedInPackage(2000, max), true);
  assert.equal(isYearlyPriceIncludedInPackage(2001, max), false);
});

test('buildSiteCheckoutParams: £299 today, domain on trial 365 days', () => {
  const p = buildSiteCheckoutParams(
    {
      placeId: 'cid-1',
      domain: 'acme.co.uk',
      domainAmountPence: 1500,
      successUrl: 'https://x/y',
      cancelUrl: 'https://x/z',
    },
    { config: { siteAmountPence: 29900, renewalLeadDays: 30 } },
  );
  assert.equal(p.params.mode, 'subscription');
  assert.equal(p.params.line_items[0].price_data.unit_amount, 29900);
  assert.equal(p.params.line_items[1].price_data.unit_amount, 1500);
  assert.equal(p.params.subscription_data.trial_period_days, DOMAIN_FIRST_YEAR_TRIAL_DAYS);
  assert.equal(p.params.metadata.domain_first_year_included, '1');
  assert.ok(p.params.custom_text?.submit?.message?.includes('£299'));
});

test('buildSiteCheckoutParams adds domain excess above £20 onto today', () => {
  const p = buildSiteCheckoutParams(
    {
      placeId: 'cid-1',
      domain: 'big.com',
      domainAmountPence: 2500,
      successUrl: 'https://x/y',
      cancelUrl: 'https://x/z',
    },
    { config: { siteAmountPence: 29900 } },
  );
  assert.equal(p.excessPence, 500);
  assert.equal(p.params.line_items[0].price_data.unit_amount, 30400);
  assert.equal(p.params.line_items[1].price_data.unit_amount, 2500);
  assert.equal(p.params.subscription_data.trial_period_days, 365);
});
