import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheckoutBusinessContext, stripLegalSuffixes } from '../netlify/functions/_shared/checkout-business-context.js';
import {
  cleanBusinessWords,
  generateDomainLabelCandidates,
  generateSuggestionDomainCandidates,
  expandLabelsToDomains,
} from '../netlify/functions/_shared/domain-suggest-candidates.js';
import { filterMappedSuggestions } from '../netlify/functions/_shared/domain-suggest-filter.js';

test('stripLegalSuffixes removes Ltd/Limited', () => {
  assert.equal(stripLegalSuffixes('Acme Plumbing Ltd'), 'Acme Plumbing');
  assert.equal(stripLegalSuffixes('Foo LLP.'), 'Foo');
});

test('resolveCheckoutBusinessContext prefers query params over registry', () => {
  const ctx = resolveCheckoutBusinessContext('cid-5705786826933327223', {
    business: 'Override Co',
    trade: 'plumbing',
    town: 'Nuneaton',
  });
  assert.equal(ctx.businessName, 'Override Co');
  assert.equal(ctx.trade, 'plumbing');
  assert.equal(ctx.town, 'Nuneaton');
});

test('generateDomainLabelCandidates builds varied compact labels', () => {
  const labels = generateDomainLabelCandidates({
    businessName: 'S&R Construction',
    trade: 'construction',
    town: 'Atherstone',
  }).map((x) => x.label);
  assert.ok(labels.some((l) => l.includes('sandrconstruction')), labels.join(','));
  assert.ok(labels.some((l) => l.includes('atherstone')));
  assert.ok(labels.some((l) => l.includes('construction')));
  assert.ok(labels.length >= 4 && labels.length <= 6);
});

test('expandLabelsToDomains caps at 15 across co.uk com uk', () => {
  const labels = generateDomainLabelCandidates({
    businessName: 'Acme Builders',
    trade: 'builders',
    town: 'Rugby',
  });
  const domains = expandLabelsToDomains(labels);
  assert.ok(domains.length <= 15);
  assert.ok(domains.every((d) => /\.(co\.uk|com|uk)$/.test(d.domain)));
});

test('filterMappedSuggestions drops taken premium and cost guard failures', () => {
  const rows = [
    {
      domain: 'free.co.uk',
      state: 'available',
      clientPricePence: 1500,
      clientPriceDisplay: '£15.00',
      _quote: { price: '5.66', renewalPrice: '5.66' },
    },
    {
      domain: 'taken.co.uk',
      state: 'taken',
      clientPricePence: 1500,
    },
    {
      domain: 'prem.com',
      state: 'premium',
      clientPricePence: 2000,
    },
    {
      domain: 'expensive.co.uk',
      state: 'available',
      clientPricePence: 1500,
      _quote: { price: '25.00', renewalPrice: '25.00' },
    },
  ];
  const out = filterMappedSuggestions(rows, { usdToGbp: 0.79 });
  assert.deepEqual(
    out.map((r) => r.domain),
    ['free.co.uk'],
  );
});

test('cleanBusinessWords handles ampersand and punctuation', () => {
  assert.deepEqual(cleanBusinessWords('Smith & Sons Ltd.'), ['Smith', 'and', 'Sons']);
});
