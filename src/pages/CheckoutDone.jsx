import React, { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShell } from '../layout/Shell';
import { fadePageChromeIn, primeIncomingRoutePage, revealPageChromeInstant } from '../lib/pageTransition';

const STORAGE_KEY = 'tm-checkout-selection-v1';

function readStoredDomain() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.selectedDomain || null;
  } catch {
    return null;
  }
}

export default function CheckoutDone() {
  const [searchParams] = useSearchParams();
  const sessionId = String(searchParams.get('session_id') || '').trim();
  const domain = readStoredDomain();

  const { reduced, finishRouteTransition, hubRouteHandoffRef } = useShell();
  const entranceRan = useRef(false);

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

  return (
    <main className="checkout-page checkout-done">
      <div className="checkout-card checkout-done__card">
        <h1 className="checkout-title">
          {domain ? 'Your domain is being connected' : 'Payment received'}
        </h1>
        {domain ? (
          <p className="checkout-lead">
            Thanks, payment received. We&apos;re registering <strong>{domain}</strong> and pointing it
            at your website. This usually takes under an hour, sometimes up to 24 hours while DNS
            updates. We&apos;ll email you when it&apos;s live.
          </p>
        ) : (
          <p className="checkout-lead">
            Thanks, your website is confirmed. We&apos;ll be in touch about next steps.
          </p>
        )}
        {sessionId ? (
          <p className="checkout-fineprint checkout-done__ref">Reference: {sessionId}</p>
        ) : null}
        <p className="checkout-meta">
          <Link to="/" className="website-offer-link">
            Back to Taylor-Marriott
          </Link>
        </p>
      </div>
    </main>
  );
}
