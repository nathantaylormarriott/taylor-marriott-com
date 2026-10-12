import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import GlassButton from '../components/GlassButton';
import GlassField from '../components/GlassField';
import checkoutConfig from '../../config/checkout.json';
import clientPreviewSites from '../../config/client-preview-sites.json';
import { domainRenewalUpfrontCopy } from '../../shared/domain-package.js';
import {
  PLAN_MONTHLY,
  PLAN_ONE_OFF,
  allowanceForPlan,
  domainExcessPence,
  firstInvoicePence,
  formatGbpPence,
  monthlyDomainCopy,
  oneOffRenewalCopy,
} from '../../shared/billing-plans.js';
import {
  normalizeCheckoutPreviewSite,
  normalizeCheckoutPreviewSiteFromApi,
} from '../../shared/checkout-preview-site.js';
import {
  createCheckoutSession,
  fetchClientPreviewSite,
  fetchDomainSuggestions,
  searchDomains,
} from '../lib/checkoutApi';
import CheckoutDeviceScreen from '../components/CheckoutDeviceScreen';
import { useShell } from '../layout/Shell';
import { fadePageChromeIn, primeIncomingRoutePage, revealPageChromeInstant } from '../lib/pageTransition';
import { parseSearchInput } from '../../shared/domain-search-input.js';

const SITE_PENCE = checkoutConfig.siteAmountPence;
const STORAGE_KEY = 'tm-checkout-selection-v1';
const SITE_URL_STORAGE_PREFIX = 'tm-checkout-site:';

function formatGbp(pence) {
  return `£${(pence / 100).toFixed(2)}`;
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
  const siteIdParam = String(searchParams.get('site_id') || '').trim();
  const cancelled = searchParams.get('cancelled') === '1';
  const contextBusiness = String(searchParams.get('business') || '').trim();
  const contextTrade = String(searchParams.get('trade') || '').trim();
  const contextTown = String(searchParams.get('town') || '').trim();

  const { reduced, finishRouteTransition, hubRouteHandoffRef } = useShell();
  const entranceRan = useRef(false);

  const [addDomain, setAddDomain] = useState(false);
  const [searchLabel, setSearchLabel] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [alternatives, setAlternatives] = useState([]);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [selectedPricePence, setSelectedPricePence] = useState(null);
  const [email, setEmail] = useState('');
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [plan, setPlan] = useState(PLAN_ONE_OFF);
  const [phone, setPhone] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const siteDisplay = useMemo(() => formatGbp(SITE_PENCE), []);

  useEffect(() => {
    if (!placeId) return undefined;
    const ac = new AbortController();
    const storageKey = `${SITE_URL_STORAGE_PREFIX}${placeId}`;

    (async () => {
      const fromQuery = normalizeCheckoutPreviewSite(searchParams.get('site'));
      const fromReferrer = normalizeCheckoutPreviewSite(document.referrer);
      let fromStorage = '';
      try {
        fromStorage = normalizeCheckoutPreviewSite(sessionStorage.getItem(storageKey));
      } catch {
        fromStorage = '';
      }
      let resolved = fromQuery || fromReferrer || fromStorage;
      if (!resolved) {
        try {
          const data = await fetchClientPreviewSite(placeId, {
            siteId: siteIdParam || undefined,
            signal: ac.signal,
          });
          if (data?.url) resolved = normalizeCheckoutPreviewSiteFromApi(data.url);
        } catch (err) {
          if (err.name !== 'AbortError') {
            /* unknown client — no mockup URL */
          }
        }
      }
      if (!resolved) {
        resolved = normalizeCheckoutPreviewSite(clientPreviewSites[placeId] || '');
      }
      if (!resolved) {
        setSiteUrl('');
        return;
      }
      try {
        sessionStorage.setItem(storageKey, resolved);
      } catch {
        /* ignore */
      }
      setSiteUrl(resolved);
    })();

    return () => ac.abort();
  }, [placeId, siteIdParam, searchParams]);

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
    async (raw) => {
      const q = String(raw || '').trim();
      if (!q || !placeId) return;
      const parsed = parseSearchInput(q);
      if (!parsed.ok) {
        setResults([]);
        setAlternatives([]);
        setSearchError(parsed.message || 'Enter a valid domain name.');
        return;
      }
      setSearching(true);
      setSearchError('');
      try {
        const data = await searchDomains({ placeId, q });
        setResults(data.results || []);
        setAlternatives(data.alternatives || []);
      } catch (err) {
        setResults([]);
        setAlternatives([]);
        setSearchError(err.message || 'Could not search domains');
      } finally {
        setSearching(false);
      }
    },
    [placeId],
  );

  useEffect(() => {
    if (!placeId) return undefined;
    const ac = new AbortController();
    setSuggestionsLoading(true);
    setSuggestionsError('');
    fetchDomainSuggestions({
      placeId,
      business: contextBusiness || undefined,
      trade: contextTrade || undefined,
      town: contextTown || undefined,
      signal: ac.signal,
    })
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setSuggestions([]);
        setSuggestionsError(err.message || 'Could not load suggestions');
      })
      .finally(() => setSuggestionsLoading(false));
    return () => ac.abort();
  }, [placeId, contextBusiness, contextTrade, contextTown]);

  useEffect(() => {
    if (!addDomain || !placeId) return undefined;
    const q = String(searchLabel || '').trim();
    if (!q) {
      setResults([]);
      setAlternatives([]);
      setSearchError('');
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

  const onSuggestionChip = (row) => {
    setSearchLabel(row.domain);
    setSelectedDomain(null);
    setSelectedPricePence(null);
    setPayError('');
  };

  const onPay = async () => {
    if (!placeId) return;
    setPayError('');
    setPaying(true);
    try {
      if (!termsAccepted) {
        setPayError('Tick the Terms and Privacy box to continue.');
        setPaying(false);
        return;
      }
      const { url } = await createCheckoutSession({
        placeId,
        siteId: siteIdParam || undefined,
        domain: addDomain && selectedDomain ? selectedDomain : null,
        email: email.trim() || undefined,
        plan,
        phone: phone.trim() || undefined,
        termsAccepted: true,
      });
      if (url) window.location.assign(url);
      else setPayError('No checkout URL returned');
    } catch (err) {
      setPayError(err.message || 'Payment could not start');
    } finally {
      setPaying(false);
    }
  };

  const selectedRenewalCopy =
    addDomain && selectedPricePence != null
      ? plan === PLAN_MONTHLY
        ? monthlyDomainCopy(selectedPricePence)
        : oneOffRenewalCopy(selectedPricePence, domainRenewalUpfrontCopy(selectedPricePence)?.match(/from ([^,]+)/)?.[1])
      : null;

  const payTodayPence =
    addDomain && selectedDomain
      ? firstInvoicePence(plan, selectedPricePence)
      : firstInvoicePence(plan, 0);
  const payTodayDisplay = formatGbpPence(payTodayPence);

  const priceNote = (pence) => {
    if (pence == null) return '';
    const excess = domainExcessPence(pence, allowanceForPlan(plan));
    if (excess === 0) return plan === PLAN_MONTHLY ? 'Included in £39' : 'Year 1 included';
    return `${formatGbpPence(excess)} extra today`;
  };

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
            £299 one-off, or £39/month with no minimum term. Cancel anytime.
          </p>
          {cancelled ? (
            <p className="checkout-banner" role="status">
              Payment cancelled. Nothing was charged. Your selections are kept below.
            </p>
          ) : null}
        </header>

        <section className="checkout-card" aria-label="Website preview">
          <div className="checkout-previews">
            <div className="checkout-device checkout-device--mac">
              <CheckoutDeviceScreen
                siteUrl={siteUrl}
                frameWidth={1440}
                frameHeight={935}
                label="Website preview on a computer"
              />
              <img className="checkout-device__frame" src="/checkout/macbook-preview.webp" alt="" />
            </div>
            <div className="checkout-device checkout-device--phone">
              <CheckoutDeviceScreen
                siteUrl={siteUrl}
                frameWidth={390}
                frameHeight={846}
                label="Website preview on a phone"
              />
              <img className="checkout-device__frame" src="/checkout/iphone-preview.webp" alt="" />
            </div>
          </div>
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
              <div className="checkout-suggestions" aria-labelledby="checkout-suggestions-title">
                <h3 id="checkout-suggestions-title" className="checkout-suggestions__title">
                  Suggested for your business
                </h3>
                {suggestionsLoading ? (
                  <div className="checkout-suggestions__skeleton" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="checkout-suggest-chip checkout-suggest-chip--skeleton" />
                    ))}
                  </div>
                ) : null}
                {!suggestionsLoading && suggestions.length ? (
                  <div className="checkout-suggestions__chips" role="list">
                    {suggestions.map((row) => {
                      const selected =
                        selectedDomain === row.domain || searchLabel.trim().toLowerCase() === row.domain;
                      return (
                        <button
                          key={row.domain}
                          type="button"
                          role="listitem"
                          className={[
                            'checkout-suggest-chip',
                            selected ? 'checkout-suggest-chip--selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-pressed={selected}
                          onClick={() => onSuggestionChip(row)}
                        >
                          <span className="checkout-suggest-chip__domain">{row.domain}</span>
                          <span className="checkout-suggest-chip__price">{priceNote(row.clientPricePence)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {!suggestionsLoading && !suggestions.length && !suggestionsError ? (
                  <p className="checkout-hint">Search below for a custom name.</p>
                ) : null}
                {suggestionsError ? (
                  <p className="checkout-hint">{suggestionsError}</p>
                ) : null}
              </div>

              <div className="checkout-search">
                <GlassField
                  id="checkout-domain-search"
                  label="Domain name (or paste a full address. We check .co.uk, .com and .uk)"
                  name="domain_search"
                  value={searchLabel}
                  onChange={(e) => {
                    setSearchLabel(e.target.value);
                    setSelectedDomain(null);
                    setSelectedPricePence(null);
                  }}
                  liquid={false}
                  sceneBlur={false}
                />
                {searching ? <p className="checkout-hint">Checking availability…</p> : null}
                {searchError ? (
                  <p className="checkout-error" role="alert">
                    {searchError}
                  </p>
                ) : null}
              </div>

              {alternatives.length ? (
                <div className="checkout-alternatives" aria-labelledby="checkout-alternatives-title">
                  <h3 id="checkout-alternatives-title" className="checkout-suggestions__title">
                    Similar names available
                  </h3>
                  <ul className="checkout-results">
                    {alternatives.map((row) => {
                      const isSelected = selectedDomain === row.domain;
                      return (
                        <li
                          key={`alt-${row.domain}`}
                          className={['checkout-result', isSelected ? 'checkout-result--selected' : '']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <div className="checkout-result__main">
                            <span className="checkout-result__domain">{row.domain}</span>
                            <span className="checkout-result__status">{row.clientPriceDisplay}/yr</span>
                          </div>
                          <GlassButton
                            type="button"
                            className="checkout-select-btn"
                            onClick={() => onSelectDomain(row)}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </GlassButton>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <ul className="checkout-results" aria-live="polite">
                {results.map((row) => {
                  const isSelected = selectedDomain === row.domain;
                  const selectable = row.state === 'available' && row.clientPricePence != null;
                  let statusLabel = '';
                  if (row.state === 'taken') statusLabel = 'Taken';
                  else if (row.state === 'premium') statusLabel = 'Not available';
                  else if (row.state === 'unresolved' || row.state === 'invalid') statusLabel = 'Try again';
                  else if (row.state === 'available') statusLabel = priceNote(row.clientPricePence);

                  return (
                    <li
                      key={row.domain}
                      className={[
                        'checkout-result',
                        row.state === 'taken' || row.state === 'premium'
                          ? 'checkout-result--muted'
                          : '',
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
                          onClick={() => onSuggestionChip(row)}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </GlassButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {selectedDomain && selectedRenewalCopy ? (
                <p className="checkout-renewal-upfront" role="status">
                  {selectedRenewalCopy}
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="checkout-card checkout-plans" aria-labelledby="checkout-plans">
          <h2 id="checkout-plans" className="checkout-section-title">
            How you pay
          </h2>
          <div className="checkout-plan-list">
            <label className={`checkout-plan${plan === PLAN_ONE_OFF ? ' checkout-plan--selected' : ''}`}>
              <input
                type="radio"
                name="plan"
                checked={plan === PLAN_ONE_OFF}
                onChange={() => setPlan(PLAN_ONE_OFF)}
              />
              <span className="checkout-plan__headline">£299 one-off</span>
              <span className="checkout-plan__detail">
                Includes the first year of a domain up to £20. Anything above £20 is added today.
                Then the domain renews yearly at the price shown.
              </span>
            </label>
            <label className={`checkout-plan checkout-plan--secondary${plan === PLAN_MONTHLY ? ' checkout-plan--selected' : ''}`}>
              <input
                type="radio"
                name="plan"
                checked={plan === PLAN_MONTHLY}
                onChange={() => setPlan(PLAN_MONTHLY)}
              />
              <span className="checkout-plan__headline">or £39/month, no minimum term, cancel anytime</span>
              <span className="checkout-plan__detail">
                The first £39 covers a domain up to £39. Anything above that is added to the first invoice.
                Later renewals are included in that month's £39, with no separate domain charge.
              </span>
            </label>
          </div>
        </section>

        <section className="checkout-card checkout-summary" aria-labelledby="checkout-summary">
          <h2 id="checkout-summary" className="checkout-section-title">
            Summary
          </h2>
          <p className="checkout-line">
            <span>Website</span>
            <strong>{plan === PLAN_MONTHLY ? '£39.00 / month' : `${siteDisplay} one-time`}</strong>
          </p>
          {addDomain && selectedDomain ? (
            <>
              <p className="checkout-line">
                <span>Domain: {selectedDomain}</span>
                <strong>{priceNote(selectedPricePence)}</strong>
              </p>
              {selectedRenewalCopy ? (
                <p className="checkout-renewal-upfront" role="status">
                  {selectedRenewalCopy}
                </p>
              ) : null}
            </>
          ) : null}
          <p className="checkout-line checkout-line--total">
            <span>{plan === PLAN_MONTHLY ? 'First invoice' : 'Pay today'}</span>
            <strong>{payTodayDisplay}</strong>
          </p>
          <p className="checkout-fineprint">
            The domain is registered for your site. If a renewal is not paid, the domain can lapse and
            the custom address is removed.
          </p>
          {plan === PLAN_MONTHLY ? (
            <p className="checkout-fineprint">
              Cancel anytime. If a payment stays unpaid, the site is paused until you pay. We retry
              once a day for 10 days and text you a pay link each time.
            </p>
          ) : (
            <p className="checkout-fineprint">
              We text and email 30, 14 and 7 days before a domain renewal, then charge the card on file.
            </p>
          )}
          {addDomain && !selectedDomain ? (
            <p className="checkout-fineprint">Choose a domain above, or continue with the website only.</p>
          ) : null}

          <div className="checkout-email">
            <GlassField
              id="checkout-phone"
              label="Mobile for payment texts (optional)"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              liquid={false}
              sceneBlur={false}
            />
            <GlassField
              id="checkout-email"
              label="Email (optional, for Stripe receipt)"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              liquid={false}
              sceneBlur={false}
            />
          </div>

          <label className="checkout-terms">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span>
              I agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.
            </span>
          </label>

          {payError ? (
            <p className="checkout-error" role="alert">
              {payError}
            </p>
          ) : null}

          <GlassButton
            type="button"
            className="checkout-pay-btn"
            disabled={paying || (addDomain && !selectedDomain) || !termsAccepted}
            onClick={onPay}
          >
            {paying ? 'Redirecting…' : 'Pay securely with Stripe'}
          </GlassButton>
        </section>
      </div>
    </main>
  );
}
