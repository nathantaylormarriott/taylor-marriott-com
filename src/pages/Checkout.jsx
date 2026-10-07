import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import GlassButton from '../components/GlassButton';
import GlassField from '../components/GlassField';
import checkoutConfig from '../../config/checkout.json';
import { createCheckoutSession, searchDomains } from '../lib/checkoutApi';
import { useShell } from '../layout/Shell';
import { fadePageChromeIn, primeIncomingRoutePage, revealPageChromeInstant } from '../lib/pageTransition';

const SITE_PENCE = checkoutConfig.siteAmountPence;
const STORAGE_KEY = 'tm-checkout-selection-v1';

function formatGbp(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

function sanitizeLabel(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/&/g, 'and');
  s = s.replace(/[^a-z0-9-]+/g, '');
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 63);
}

function loadStoredSelection(placeId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.placeId !== placeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredSelection(payload) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const placeId = String(searchParams.get('place_id') || '').trim();
  const cancelled = searchParams.get('cancelled') === '1';

  const { reduced, finishRouteTransition, hubRouteHandoffRef } = useShell();
  const entranceRan = useRef(false);

  const [addDomain, setAddDomain] = useState(false);
  const [searchLabel, setSearchLabel] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [selectedPricePence, setSelectedPricePence] = useState(null);
  const [email, setEmail] = useState('');
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);

  const siteDisplay = useMemo(() => formatGbp(SITE_PENCE), []);

  useEffect(() => {
    if (!placeId) return;
    const stored = loadStoredSelection(placeId);
    if (stored) {
      setAddDomain(Boolean(stored.addDomain));
      if (stored.searchLabel) setSearchLabel(stored.searchLabel);
      if (stored.selectedDomain) {
        setSelectedDomain(stored.selectedDomain);
        setSelectedPricePence(stored.selectedPricePence ?? null);
      }
      if (stored.email) setEmail(stored.email);
    }
  }, [placeId]);

  useEffect(() => {
    if (!placeId) return;
    saveStoredSelection({
      placeId,
      addDomain,
      searchLabel,
      selectedDomain,
      selectedPricePence,
      email,
    });
  }, [placeId, addDomain, searchLabel, selectedDomain, selectedPricePence, email]);

  useEffect(() => {
    if (entranceRan.current) return;
    entranceRan.current = true;
    window.scrollTo(0, 0);
    const handoff = hubRouteHandoffRef.current;
    hubRouteHandoffRef.current = false;
    if (reduced || !handoff) {
      revealPageChromeInstant();
      finishRouteTransition();
      return;
    }
    primeIncomingRoutePage();
    fadePageChromeIn({ handoff: true, onComplete: finishRouteTransition });
  }, [finishRouteTransition, hubRouteHandoffRef, reduced]);

  const runSearch = useCallback(
    async (label) => {
      const q = sanitizeLabel(label);
      if (!q || !placeId) return;
      setSearching(true);
      setSearchError('');
      try {
        const data = await searchDomains({ placeId, q });
        setResults(data.results || []);
      } catch (err) {
        setResults([]);
        setSearchError(err.message || 'Could not search domains');
      } finally {
        setSearching(false);
      }
    },
    [placeId],
  );

  useEffect(() => {
    if (!addDomain || !placeId) return undefined;
    const q = sanitizeLabel(searchLabel);
    if (!q) {
      setResults([]);
      return undefined;
    }
    const t = window.setTimeout(() => runSearch(q), 400);
    return () => window.clearTimeout(t);
  }, [addDomain, placeId, searchLabel, runSearch]);

  const onSelectDomain = (row) => {
    if (row.state !== 'available' || row.clientPricePence == null) return;
    setSelectedDomain(row.domain);
    setSelectedPricePence(row.clientPricePence);
    setPayError('');
  };

  const onPay = async () => {
    if (!placeId) return;
    setPayError('');
    setPaying(true);
    try {
      const { url } = await createCheckoutSession({
        placeId,
        domain: addDomain && selectedDomain ? selectedDomain : null,
        email: email.trim() || undefined,
      });
      if (url) window.location.assign(url);
      else setPayError('No checkout URL returned');
    } catch (err) {
      setPayError(err.message || 'Payment could not start');
    } finally {
      setPaying(false);
    }
  };

  const domainYearlyDisplay =
    addDomain && selectedPricePence != null ? formatGbp(selectedPricePence) : null;

  if (!placeId) {
    return (
      <main className="checkout-page">
        <div className="checkout-card">
          <h1 className="checkout-title">Checkout</h1>
          <p className="checkout-lead">
            This link is missing your business reference. Open checkout from the link on your
            website preview, or contact us if you need help.
          </p>
          <p className="checkout-meta">
            <Link to="/website-for-your-business" className="website-offer-link">
              Website for your business
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="checkout-page" id="checkout-main">
      <div className="checkout-layout">
        <header className="checkout-header">
          <h1 className="checkout-title">Complete your website</h1>
          <p className="checkout-lead">
            One payment for your live site. Optionally add a domain we register and connect for you.
          </p>
          {cancelled ? (
            <p className="checkout-banner" role="status">
              Payment cancelled — nothing was charged. Your selections are kept below.
            </p>
          ) : null}
        </header>

        <section className="checkout-card" aria-labelledby="checkout-fee">
          <h2 id="checkout-fee" className="checkout-section-title">
            Your website
          </h2>
          <p className="checkout-line">
            <span>Website fee</span>
            <strong>{siteDisplay} one-time</strong>
          </p>
        </section>

        <section className="checkout-card" aria-labelledby="checkout-domain-toggle">
          <div className="checkout-toggle-row">
            <h2 id="checkout-domain-toggle" className="checkout-section-title">
              Add a domain
            </h2>
            <label className="checkout-switch">
              <input
                type="checkbox"
                checked={addDomain}
                onChange={(e) => {
                  setAddDomain(e.target.checked);
                  if (!e.target.checked) {
                    setSelectedDomain(null);
                    setSelectedPricePence(null);
                  }
                }}
              />
              <span className="checkout-switch__ui" aria-hidden="true" />
              <span className="visually-hidden">{addDomain ? 'On' : 'Off'}</span>
            </label>
          </div>

          {addDomain ? (
            <>
              <div className="checkout-search">
                <GlassField
                  id="checkout-domain-search"
                  label="Search name (letters, numbers, hyphens)"
                  name="domain_search"
                  value={searchLabel}
                  onChange={(e) => {
                    setSearchLabel(sanitizeLabel(e.target.value));
                    setSelectedDomain(null);
                    setSelectedPricePence(null);
                  }}
                  sceneBlur
                />
                {searching ? <p className="checkout-hint">Checking availability…</p> : null}
                {searchError ? (
                  <p className="checkout-error" role="alert">
                    {searchError}
                  </p>
                ) : null}
              </div>

              <ul className="checkout-results" aria-live="polite">
                {results.map((row) => {
                  const isSelected = selectedDomain === row.domain;
                  const selectable = row.state === 'available' && row.clientPricePence != null;
                  let statusLabel = '';
                  if (row.state === 'taken') statusLabel = 'Taken';
                  else if (row.state === 'premium') statusLabel = 'Not available';
                  else if (row.state === 'unresolved' || row.state === 'invalid') statusLabel = 'Try again';
                  else if (row.state === 'available') statusLabel = row.clientPriceDisplay || 'Available';

                  return (
                    <li
                      key={row.domain}
                      className={[
                        'checkout-result',
                        row.state === 'taken' || row.state === 'premium' ? 'checkout-result--muted' : '',
                        row.state === 'taken' ? 'checkout-result--struck' : '',
                        isSelected ? 'checkout-result--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="checkout-result__main">
                        <span className="checkout-result__domain">{row.domain}</span>
                        <span className="checkout-result__status">{statusLabel}</span>
                      </div>
                      {selectable ? (
                        <GlassButton
                          type="button"
                          className="checkout-select-btn"
                          onClick={() => onSelectDomain(row)}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </GlassButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>

        <section className="checkout-card checkout-summary" aria-labelledby="checkout-summary">
          <h2 id="checkout-summary" className="checkout-section-title">
            Summary
          </h2>
          <p className="checkout-line">
            <span>Website</span>
            <strong>{siteDisplay} one-time</strong>
          </p>
          {addDomain && selectedDomain ? (
            <p className="checkout-line">
              <span>Domain: {selectedDomain}</span>
              <strong>{domainYearlyDisplay} / year</strong>
            </p>
          ) : null}
          {addDomain ? (
            <p className="checkout-fineprint">
              The domain renews yearly at the same price. You can cancel any time.
            </p>
          ) : null}

          <div className="checkout-email">
            <GlassField
              id="checkout-email"
              label="Email (optional, for Stripe receipt)"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sceneBlur
            />
          </div>

          {payError ? (
            <p className="checkout-error" role="alert">
              {payError}
            </p>
          ) : null}

          <GlassButton
            type="button"
            className="checkout-pay-btn"
            disabled={paying || (addDomain && !selectedDomain)}
            onClick={onPay}
          >
            {paying ? 'Redirecting…' : 'Pay securely with Stripe'}
          </GlassButton>
        </section>
      </div>
    </main>
  );
}
