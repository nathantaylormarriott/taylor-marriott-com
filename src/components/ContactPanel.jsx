import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { CONFIG } from '../config';
import ContactFormCard from './ContactFormCard';
import GlassButton from './GlassButton';
import GlassField from './GlassField';
import { submitContactForm } from '../lib/contactForm';
import nathanHeadshot from '../assets/nathan-headshot.webp';

const FORM_ID = 'contact-overlay-form';
const SUCCESS_AUTO_CLOSE_MS = 5000;

export default function ContactPanel({ onClose }) {
  const [status, setStatus] = useState('idle');
  const [wobbleFields, setWobbleFields] = useState([]);
  const wobbleTimerRef = useRef(null);
  const mainRef = useRef(null);
  const successRef = useRef(null);
  const successTweenRef = useRef(null);
  const autoCloseTimerRef = useRef(null);

  useLayoutEffect(() => {
    if (status !== 'success') return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    successTweenRef.current?.kill();

    if (reduced) {
      gsap.set(['.contact-intro-copy', mainRef.current], { autoAlpha: 0, visibility: 'hidden', filter: 'none' });
      gsap.set(successRef.current, { autoAlpha: 1, visibility: 'visible', filter: 'none' });
      return;
    }

    gsap.set(successRef.current, {
      visibility: 'visible',
      autoAlpha: 0,
      filter: 'blur(12px)',
    });

    successTweenRef.current = gsap.timeline()
      .to(['.contact-intro-copy', mainRef.current], {
        autoAlpha: 0,
        filter: 'blur(12px)',
        duration: 0.55,
        ease: 'power2.in',
      })
      .set(['.contact-intro-copy', mainRef.current], { visibility: 'hidden' })
      .to(successRef.current, {
        autoAlpha: 1,
        filter: 'blur(0px)',
        duration: 0.7,
        ease: CONFIG.ease,
      }, '-=0.08');

    return () => successTweenRef.current?.kill();
  }, [status]);

  useEffect(() => {
    if (status !== 'success') return;

    autoCloseTimerRef.current = window.setTimeout(onClose, SUCCESS_AUTO_CLOSE_MS);

    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [status, onClose]);

  const handleReturnHome = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    onClose();
  };

  const triggerWobble = (fields) => {
    if (wobbleTimerRef.current) clearTimeout(wobbleTimerRef.current);
    setWobbleFields([]);
    requestAnimationFrame(() => {
      setWobbleFields(fields);
      wobbleTimerRef.current = setTimeout(() => setWobbleFields([]), 520);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    setStatus('sending');

    try {
      const result = await submitContactForm(form);
      if (result.invalid?.length) {
        triggerWobble(result.invalid);
        setStatus('idle');
        return;
      }
      if (!result.ok) {
        setStatus('error');
        return;
      }
      setStatus('success');
      form.reset();
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className={`contact-inner${status === 'success' ? ' contact-inner--success' : ''}`}>
      <div className="contact-intro">
        <div className="contact-intro-copy">
          <div className="contact-portrait-wrap">
            <img
              className="contact-portrait"
              src={nathanHeadshot}
              alt="Nathan Taylor-Marriott"
              width={368}
              height={460}
              decoding="async"
            />
          </div>
          <div className="contact-intro-text">
            <h1 className="contact-title">Tell us about<br />your objective.</h1>
            <p className="contact-lead">
              We will get back to you as soon as possible.
            </p>
          </div>
        </div>

        {status === 'success' && (
          <div className="contact-success-view" ref={successRef} aria-live="polite">
            <h2 className="contact-success-title">Message sent</h2>
            <p className="contact-success-body">
              Thanks for reaching out — we'll be in touch soon.
            </p>
          </div>
        )}
      </div>

      {status === 'success' ? (
        <div className="contact-form-return">
          <GlassButton
            type="button"
            className="contact-submit"
            liquid={false}
            onClick={handleReturnHome}
          >
            Return to home
          </GlassButton>
        </div>
      ) : (
        <div className="contact-main" ref={mainRef}>
          <ContactFormCard>
            <form
            id={FORM_ID}
            className="contact-form"
            name="contact"
            method="POST"
            noValidate
            data-netlify="true"
            data-netlify-honeypot="bot-field"
            onSubmit={handleSubmit}
          >
            <input type="hidden" name="form-name" value="contact" />
            <p className="contact-honeypot" hidden>
              <label>
                Don't fill this out:
                <input name="bot-field" />
              </label>
            </p>

            <GlassField
              id="contact-name"
              label="Name"
              name="name"
              autoComplete="name"
              liquid={false}
              wobble={wobbleFields.includes('name')}
            />

            <GlassField
              id="contact-email"
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              liquid={false}
              wobble={wobbleFields.includes('email')}
            />

            <GlassField
              id="contact-phone"
              label="Phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              liquid={false}
            />

            <GlassField
              id="contact-company"
              label="Company"
              name="company"
              autoComplete="organization"
              liquid={false}
            />

            <GlassField
              id="contact-message"
              label="Message"
              name="message"
              multiline
              rows={1}
              liquid={false}
              wobble={wobbleFields.includes('message')}
            />

            <button
              className="contact-submit contact-submit--text"
              type="submit"
              disabled={status === 'sending'}
            >
              {status === 'sending' ? 'Sending…' : 'Start a conversation'}
            </button>

            {status === 'error' && (
              <p className="contact-error mono">
                Something went wrong. Please try again or email hello@taylor-marriott.com directly.
              </p>
            )}
          </form>
          </ContactFormCard>
        </div>
      )}
    </div>
  );
}
