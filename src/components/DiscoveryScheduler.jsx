import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bookDiscoverySession,
  fetchDiscoveryAvailability,
  fetchDiscoveryConfig,
  formatDayChip,
  formatSlotLabel,
  formatSlotTime,
  INITIAL_AVAILABILITY_DAYS,
  slotDayKey,
} from '../lib/discoveryApi';
import { emailPattern } from '../lib/contactForm';
import { burstDiscoveryConfetti } from '../lib/discoveryConfetti';
import ContactFormCard from './ContactFormCard';
import DiscoverySchedulerRail from './DiscoverySchedulerRail';
import GlassButton from './GlassButton';
import GlassField from './GlassField';

const FORM_ID = 'discovery-book-form';

function mergeSlots(existing, incoming) {
  const map = new Map();
  for (const slot of [...existing, ...incoming]) {
    map.set(slot.start, slot);
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function groupSlotsByDay(slots, timezone) {
  const map = new Map();
  for (const slot of slots) {
    const key = slotDayKey(slot.start, timezone);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(slot);
  }
  return map;
}

export default function DiscoveryScheduler() {
  const [phase, setPhase] = useState('loading');
  const [config, setConfig] = useState(null);
  const [timezone, setTimezone] = useState('Europe/London');
  const [slots, setSlots] = useState([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedStart, setSelectedStart] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [wobbleFields, setWobbleFields] = useState([]);
  const activeDayRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const availability = await fetchDiscoveryAvailability(INITIAL_AVAILABILITY_DAYS);
        if (cancelled) return;
        setConfig({
          enabled: true,
          slotMinutes: availability.slotMinutes,
          timezone: availability.timezone,
          horizonDays: availability.horizonDays ?? INITIAL_AVAILABILITY_DAYS,
        });
        setTimezone(availability.timezone);
        setSlots(availability.slots || []);
        setPhase('pick');

        const horizon = availability.horizonDays ?? 28;
        if (horizon > INITIAL_AVAILABILITY_DAYS) {
          fetchDiscoveryAvailability(horizon)
            .then((extended) => {
              if (cancelled) return;
              setSlots((prev) => mergeSlots(prev, extended.slots || []));
            })
            .catch(() => {});
        }
      } catch {
        try {
          const cfg = await fetchDiscoveryConfig();
          if (cancelled) return;
          if (!cfg.enabled) {
            setPhase('unconfigured');
            return;
          }
          setConfig(cfg);
          setTimezone(cfg.timezone);
          const availability = await fetchDiscoveryAvailability(INITIAL_AVAILABILITY_DAYS);
          if (cancelled) return;
          setSlots(availability.slots || []);
          setPhase('pick');
        } catch {
          if (!cancelled) setPhase('unconfigured');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const slotsByDay = useMemo(
    () => groupSlotsByDay(slots, timezone),
    [slots, timezone],
  );

  const dayKeys = useMemo(() => [...slotsByDay.keys()], [slotsByDay]);

  useEffect(() => {
    if (!selectedDay && dayKeys.length) {
      setSelectedDay(dayKeys[0]);
    }
  }, [dayKeys, selectedDay]);

  useEffect(() => {
    activeDayRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [selectedDay]);

  const daySlots = selectedDay ? slotsByDay.get(selectedDay) || [] : [];
  const selectedSlot = daySlots.find((s) => s.start === selectedStart);

  const triggerWobble = (fields) => {
    setWobbleFields([]);
    requestAnimationFrame(() => {
      setWobbleFields(fields);
      window.setTimeout(() => setWobbleFields([]), 520);
    });
  };

  const handleBook = async (e) => {
    e.preventDefault();
    setError('');
    const form = e.target;
    const name = form.elements.namedItem('name')?.value?.trim() ?? '';
    const email = form.elements.namedItem('email')?.value?.trim() ?? '';
    const company = form.elements.namedItem('company')?.value?.trim() ?? '';
    const message = form.elements.namedItem('message')?.value?.trim() ?? '';
    const honeypot = form.elements.namedItem('company_website')?.value?.trim() ?? '';

    const invalid = [];
    if (!name) invalid.push('name');
    if (!email || !emailPattern.test(email)) invalid.push('email');
    if (invalid.length) {
      triggerWobble(invalid);
      return;
    }

    setStatus('sending');
    try {
      const result = await bookDiscoverySession({
        start: selectedStart,
        name,
        email,
        company,
        message,
        company_website: honeypot,
      });
      setSuccess(result);
      setPhase('success');
      setStatus('idle');
      burstDiscoveryConfetti();
    } catch (err) {
      setStatus('idle');
      setError(err.message || 'Could not complete booking');
      if (err.status === 409) {
        setPhase('pick');
        setSelectedStart('');
        const availability = await fetchDiscoveryAvailability(config?.horizonDays ?? 14);
        setSlots(availability.slots || []);
      }
    }
  };

  if (phase === 'loading') {
    return (
      <div className="discovery-scheduler discovery-scheduler--loading" aria-busy="true">
        <div className="discovery-scheduler__block">
          <p className="discovery-scheduler__kicker">Date</p>
          <div className="discovery-scheduler__scroller">
            <span className="discovery-scheduler__arrow discovery-scheduler__arrow--prev" aria-hidden="true" />
            <div className="discovery-scheduler__rail discovery-scheduler__rail--skeleton">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="discovery-scheduler__chip discovery-scheduler__chip--skeleton" />
              ))}
            </div>
            <span className="discovery-scheduler__arrow discovery-scheduler__arrow--next" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'unconfigured') {
    return (
      <div className="discovery-booking discovery-booking--page discovery-booking--unconfigured">
        <p className="discovery-booking__lead">
          Online booking is not connected yet. Use the contact form and we&apos;ll arrange a call.
        </p>
        <GlassButton
          type="button"
          className="contact-submit discovery-booking__btn"
          liquid={false}
          onClick={() => {
            window.location.href = '/contact';
          }}
        >
          Go to contact
        </GlassButton>
      </div>
    );
  }

  if (phase === 'success' && success) {
    return (
      <div className="discovery-scheduler__success" aria-live="polite">
        <h2 className="discovery-scheduler__success-title">You&apos;re booked</h2>
        <p className="discovery-scheduler__success-body">
          {formatSlotLabel(success.start, timezone)} ({config?.slotMinutes}-minute discovery call)
        </p>
        {success.meetLink ? (
          <a
            className="discovery-scheduler__meet-link"
            href={success.meetLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Google Meet link
          </a>
        ) : (
          <p className="discovery-scheduler__success-hint">
            Check your email for the calendar invite and Meet link.
          </p>
        )}
        <button
          type="button"
          className="discovery-scheduler__back-link"
          onClick={() => {
            setPhase('pick');
            setSuccess(null);
            setSelectedStart('');
          }}
        >
          Book another time
        </button>
      </div>
    );
  }

  if (phase === 'details' && selectedSlot) {
    return (
      <div className="discovery-scheduler discovery-scheduler--details">
        <button
          type="button"
          className="discovery-scheduler__back-link"
          onClick={() => {
            setPhase('pick');
            setError('');
          }}
        >
          ← Choose a different time
        </button>

        <ContactFormCard className="discovery-scheduler__card">
          <form id={FORM_ID} className="contact-form discovery-scheduler__form" onSubmit={handleBook}>
            <p className="discovery-scheduler__selected">
              {formatSlotLabel(selectedStart, timezone)}
            </p>
            <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="discovery-scheduler__honeypot" aria-hidden="true" />
            <GlassField
              id="discovery-name"
              label="Name"
              name="name"
              autoComplete="name"
              wobble={wobbleFields.includes('name')}
              form={FORM_ID}
            />
            <GlassField
              id="discovery-email"
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              wobble={wobbleFields.includes('email')}
              form={FORM_ID}
            />
            <GlassField
              id="discovery-company"
              label="Company (optional)"
              name="company"
              autoComplete="organization"
              form={FORM_ID}
            />
            <GlassField
              id="discovery-message"
              label="What would you like to discuss? (optional)"
              name="message"
              multiline
              rows={3}
              form={FORM_ID}
            />
            {error ? <p className="discovery-scheduler__error">{error}</p> : null}
            <GlassButton
              type="submit"
              className="contact-submit discovery-scheduler__submit"
              liquid={false}
              disabled={status === 'sending'}
            >
              {status === 'sending' ? 'Booking…' : 'Confirm booking'}
            </GlassButton>
          </form>
        </ContactFormCard>
      </div>
    );
  }

  if (!dayKeys.length) {
    return (
      <p className="discovery-scheduler__status">
        No open slots in the next few weeks.{' '}
        <Link to="/contact" className="discovery-session-alt__link">
          Send a message
        </Link>{' '}
        instead.
      </p>
    );
  }

  return (
    <div className="discovery-scheduler">
      <div className="discovery-scheduler__block">
        <p className="discovery-scheduler__kicker">Date</p>
        <DiscoverySchedulerRail
          role="tablist"
          ariaLabel="Choose a day"
          className="discovery-scheduler__days"
        >
          {dayKeys.map((key) => {
            const firstSlot = slotsByDay.get(key)[0];
            const isActive = selectedDay === key;
            const label = formatDayChip(firstSlot.start, timezone);
            return (
              <button
                key={key}
                ref={isActive ? activeDayRef : null}
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={isActive}
                className={`discovery-scheduler__chip discovery-scheduler__day${isActive ? ' discovery-scheduler__chip--active' : ''}`}
                onClick={() => {
                  setSelectedDay(key);
                  setSelectedStart('');
                }}
              >
                {label}
              </button>
            );
          })}
        </DiscoverySchedulerRail>
      </div>

      <div className="discovery-scheduler__block">
        <p className="discovery-scheduler__kicker">Time</p>
        <DiscoverySchedulerRail as="ul" ariaLabel="Choose a time" className="discovery-scheduler__times">
          {daySlots.map((slot) => (
            <li key={slot.start}>
              <button
                type="button"
                className={`discovery-scheduler__chip discovery-scheduler__time${selectedStart === slot.start ? ' discovery-scheduler__chip--active' : ''}`}
                onClick={() => {
                  setSelectedStart(slot.start);
                  setPhase('details');
                }}
              >
                {formatSlotTime(slot.start, timezone)}
              </button>
            </li>
          ))}
        </DiscoverySchedulerRail>
      </div>
    </div>
  );
}
