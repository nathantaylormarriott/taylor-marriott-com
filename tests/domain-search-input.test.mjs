import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripSearchNoise,
  parseSearchInput,
  validateLabel,
  primaryDomainForParsed,
} from '../shared/domain-search-input.js';
import { closeAlternativeLabels, domainsForLabels } from '../shared/domain-search-alternatives.js';

test('stripSearchNoise trims URL, www, paths and spaces', () => {
  assert.equal(stripSearchNoise('  HTTPS://WWW.Example.Co.UK/path?q=1  '), 'example.co.uk');
  assert.equal(stripSearchNoise('my business'), 'mybusiness');
});

test('parseSearchInput label mode defaults to co.uk com uk', () => {
  const p = parseSearchInput('acme-plumbers');
  assert.equal(p.ok, true);
  assert.equal(p.mode, 'label');
  assert.equal(p.label, 'acme-plumbers');
  assert.deepEqual(p.tlds, ['co.uk', 'com', 'uk']);
  assert.equal(primaryDomainForParsed(p), 'acme-plumbers.co.uk');
});

test('parseSearchInput accepts full apex domain', () => {
  const p = parseSearchInput('https://www.acme.co.uk/');
  assert.equal(p.ok, true);
  assert.equal(p.mode, 'domain');
  assert.equal(p.domain, 'acme.co.uk');
});

test('parseSearchInput rejects unsupported TLD with friendly message', () => {
  const p = parseSearchInput('shop.io');
  assert.equal(p.ok, false);
  assert.equal(p.code, 'tld');
  assert.match(p.message, /co\.uk/);
});

test('validateLabel rejects leading hyphen', () => {
  const v = validateLabel('-acme');
  assert.equal(v.ok, false);
  assert.match(v.message, /hyphen/i);
});

test('closeAlternativeLabels produces distinct near-miss names', () => {
  const alts = closeAlternativeLabels('acme');
  assert.ok(alts.length >= 3);
  assert.ok(alts.every((l) => l !== 'acme'));
  const domains = domainsForLabels(alts.slice(0, 2));
  assert.ok(domains.some((d) => d.endsWith('.co.uk')));
});
