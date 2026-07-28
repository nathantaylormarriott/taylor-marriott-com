import React, { useRef, useState } from 'react';
import ContactHubAction from '../components/ContactHubAction';
import GlassField from '../components/GlassField';
import { submitContactForm } from '../lib/contactForm';
import { CONTACT } from '../config';

function formatPhoneDisplay(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('44') && digits.length >= 12) {
    const local = `0${digits.slice(2)}`;
    return `${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return phone;
}

const WHATSAPP_MESSAGE = encodeURIComponent("Hi Taylor-Marriott — I'd like to discuss a project.");

export default function Contact() {
  const [status, setStatus] = useState('idle');
  const [wobbleFields, setWobbleFields] = useState([]);
  const wobbleTimerRef = useRef(null);
  const formSectionRef = useRef(null);

  const triggerWobble = (fields) => {
    if (wobbleTimerRef.current) clearTimeout(wobbleTimerRef.current);
    setWobbleFields([]);
    requestAnimationFrame(() => {
      setWobbleFields(fields);
      wobbleTimerRef.current = setTimeout(() => setWobbleFields([]), 520);
    });
  };

  const scrollToForm = () => {
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    <main className="contact-hub">
      <div className="contact-hub__inner">
        <header className="contact-hub__header">
          <p className="contact-hub__kicker mono">Get in touch</p>
          <h1 className="contact-hub__title">Start a conversation</h1>
          <p className="contact-hub__lead">
            Call, message, or email — however you prefer to reach us.
          </p>
        </header>

        <nav className="contact-hub__actions" aria-label="Contact options">
          <ContactHubAction
            href={`tel:${CONTACT.phone}`}
            label="Call"
            detail={formatPhoneDisplay(CONTACT.phone)}
            icon="phone"
          />
          <ContactHubAction
            href={`https://wa.me/${CONTACT.whatsapp}?text=${WHATSAPP_MESSAGE}`}
            label="WhatsApp"
            detail="Message us directly"
            icon="whatsapp"
            external
          />
          <ContactHubAction
            href={`mailto:${CONTACT.email}`}
            label="Email"
            detail={CONTACT.email}
            icon="email"
          />
          <ContactHubAction
            type="button"
            label="Send a message"
            detail="Project enquiry form"
            icon="form"
            onClick={scrollToForm}
          />
        </nav>

        <section
          className="contact-hub__form-section"
          id="hub-form"
          ref={formSectionRef}
          aria-labelledby="hub-form-heading"
        >
          <h2 className="contact-hub__form-heading mono" id="hub-form-heading">
            Project enquiry
          </h2>

          {status === 'success' ? (
            <div className="contact-hub__success" aria-live="polite">
              <h3 className="contact-hub__success-title">Message sent</h3>
              <p className="contact-hub__success-body">
                Thanks for reaching out — we'll be in touch within one working day.
              </p>
              <button
                type="button"
                className="contact-submit contact-hub__success-reset"
                onClick={() => setStatus('idle')}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form
              className="contact-form contact-hub__form"
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
                id="hub-contact-name"
                label="Name"
                name="name"
                autoComplete="name"
                wobble={wobbleFields.includes('name')}
              />

              <GlassField
                id="hub-contact-email"
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                wobble={wobbleFields.includes('email')}
              />

              <GlassField
                id="hub-contact-company"
                label="Company"
                name="company"
                autoComplete="organization"
                optional
              />

              <GlassField
                id="hub-contact-message"
                label="Project details"
                name="message"
                multiline
                rows={4}
                placeholder="What are you building? Timeline or budget in mind?"
                wobble={wobbleFields.includes('message')}
              />

              <button className="contact-submit contact-hub__submit" type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send message'}
              </button>

              {status === 'error' && (
                <p className="contact-error mono">
                  Something went wrong. Please try again or email {CONTACT.email} directly.
                </p>
              )}
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
