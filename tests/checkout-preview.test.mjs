import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCheckoutPreviewHtml } from '../netlify/functions/_shared/checkout-preview-build.js';
import { normalizeCheckoutPreviewSite } from '../shared/checkout-preview-site.js';

describe('normalizeCheckoutPreviewSite', () => {
  it('accepts HTTPS Netlify app URLs without query or hash', () => {
    assert.equal(
      normalizeCheckoutPreviewSite('https://tmbulk-example.netlify.app/path?q=1#x'),
      'https://tmbulk-example.netlify.app/path',
    );
  });

  it('rejects non-Netlify hosts', () => {
    assert.equal(normalizeCheckoutPreviewSite('https://evil.com/'), '');
    assert.equal(normalizeCheckoutPreviewSite('http://tmbulk-x.netlify.app/'), '');
  });
});

describe('buildCheckoutPreviewHtml', () => {
  it('injects base href and scroll script and strips scripts', () => {
    const out = buildCheckoutPreviewHtml('https://tmbulk-x.netlify.app/', '<html><head></head><body><script>x</script></body></html>');
    assert.match(out, /<base href="https:\/\/tmbulk-x\.netlify\.app\/">/);
    assert.match(out, /__tmPreviewScroll/);
    assert.doesNotMatch(out, /<script>x<\/script>/);
  });
});
