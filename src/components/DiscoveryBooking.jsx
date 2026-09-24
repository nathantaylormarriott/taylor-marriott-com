import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DISCOVERY_BOOKING } from '../config';
import { useShell } from '../layout/Shell';
import DiscoveryScheduler from './DiscoveryScheduler';

function DiscoveryTeaserLink({ className, label }) {
  const location = useLocation();
  const { beginPageRouteTransition, reduced } = useShell();
  const onContact = location.pathname === '/contact';

  return (
    <Link
      to="/discovery-session"
      className={`discovery-booking discovery-booking--inline ${className}`.trim()}
      onClick={(e) => {
        if (reduced || !onContact) return;
        e.preventDefault();
        beginPageRouteTransition('/discovery-session');
      }}
    >
      {label}
      <span className="discovery-booking__hint">Pick a time · Google Meet</span>
    </Link>
  );
}

export default function DiscoveryBooking({ className = '', variant = 'teaser' }) {
  const { durationMinutes } = DISCOVERY_BOOKING;
  const label = `Book a ${durationMinutes}-minute discovery call`;

  if (variant === 'teaser') {
    return <DiscoveryTeaserLink className={className} label={label} />;
  }

  if (variant === 'page') {
    return <DiscoveryScheduler className={className} />;
  }

  return null;
}
