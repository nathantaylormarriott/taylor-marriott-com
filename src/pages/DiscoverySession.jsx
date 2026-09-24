import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import DiscoveryBooking from '../components/DiscoveryBooking';
import { useShell } from '../layout/Shell';
import {
  fadePageChromeIn,
  primeIncomingRoutePage,
  revealPageChromeInstant,
} from '../lib/pageTransition';

export default function DiscoverySession() {
  const { reduced, finishRouteTransition, hubRouteHandoffRef } = useShell();
  const entranceRan = useRef(false);

  useLayoutEffect(() => {
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
    fadePageChromeIn({
      handoff: true,
      onComplete: finishRouteTransition,
    });
  }, [finishRouteTransition, hubRouteHandoffRef, reduced]);

  return (
    <main className="discovery-session-page">
      <div className="discovery-session-inner">
        <div className="discovery-session-copy">
          <h1 className="discovery-session-title">
            Book a time<br />that works for you.
          </h1>
          <p className="discovery-session-lead">
            A focused 30-minute conversation about your objectives. At minimum, you&apos;ll leave
            with clearer insight into what&apos;s helping or holding back your growth — whether we
            work together or not.
          </p>
          <p className="discovery-session-alt">
            Prefer email?{' '}
            <Link to="/contact" className="discovery-session-alt__link">
              Send a message instead
            </Link>
          </p>
        </div>

        <div className="discovery-session-booking">
          <DiscoveryBooking variant="page" />
        </div>
      </div>
    </main>
  );
}
