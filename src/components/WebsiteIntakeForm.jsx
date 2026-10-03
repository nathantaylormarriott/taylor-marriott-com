import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import ContactFormCard from './ContactFormCard';
import GlassButton from './GlassButton';
import GlassField from './GlassField';
import { FORM_NAME, submitWebsiteIntakeForm } from '../lib/websiteIntakeForm';

const FORM_ID = 'website-intake-form';

export default function WebsiteIntakeForm({ sourcePath = '/website-for-your-business' }) {
  const [status, setStatus] = useState('idle');
  const [wobbleFields, setWobbleFields] = useState([]);
  const [socialRows, setSocialRows] = useState([0]);

  const triggerWobble = (fields) => {
    setWobbleFields([]);
    requestAnimationFrame(() => {
      setWobbleFields(fields);
      window.setTimeout(() => setWobbleFields([]), 520);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    setStatus('sending');

    try {
      const result = await submitWebsiteIntakeForm(form);
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
      setSocialRows([0]);
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <ContactFormCard className="website-intake-card">
        <div className="website-intake-success" aria-live="polite">
          <h2 className="website-intake-success__title">Thank you — we&apos;ve received your details</h2>
          <p className="website-intake-success__body">
            A member of the Taylor-Marriott team will respond within{' '}
            <strong>24 hours</strong> with a tailored demo preview of your local business website,
            built from the information you shared.
          </p>
          <p className="website-intake-success__meta mono">
            Questions in the meantime?{' '}
            <a href="mailto:nathan@taylor-marriott.com">nathan@taylor-marriott.com</a>
          </p>
          <Link to="/" className="contact-submit website-intake-success__home">
            Return to home
          </Link>
        </div>
      </ContactFormCard>
    );
  }

  return (
    <ContactFormCard className="website-intake-card">
      <form
        id={FORM_ID}
        className="contact-form website-intake-form"
        name={FORM_NAME}
        method="POST"
        noValidate
        data-netlify="true"
        data-netlify-honeypot="bot-field"
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="form-name" value={FORM_NAME} />
        <input type="hidden" name="source_path" value={sourcePath} />
        <input type="hidden" name="submitted_at" value="" />

        <p className="contact-honeypot" hidden>
          <label>
            Don&apos;t fill this out:
            <input name="bot-field" tabIndex={-1} autoComplete="off" />
          </label>
        </p>

        <div className="website-intake-fields">
        <GlassField
          id="intake-name"
          label="Full name *"
          name="name"
          autoComplete="name"
          wobble={wobbleFields.includes('name')}
        />

        <GlassField
          id="intake-phone"
          label="Phone number *"
          name="phone"
          type="tel"
          autoComplete="tel"
          wobble={wobbleFields.includes('phone')}
        />

        <GlassField
          id="intake-business"
          label="Business name *"
          name="business_name"
          autoComplete="organization"
          wobble={wobbleFields.includes('business_name')}
        />

        <GlassField
          id="intake-email"
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          wobble={wobbleFields.includes('email')}
        />

        <GlassField
          id="intake-about"
          label="About your business"
          name="about"
          multiline
          rows={3}
        />

        <GlassField
          id="intake-gbp"
          label="Google Business Profile link"
          name="gbp_url"
          type="url"
          autoComplete="url"
          placeholder="Google Business Profile link"
          wobble={wobbleFields.includes('gbp_url')}
        />

        <div className="website-intake-form__social">
          {socialRows.map((rowId, index) => (
            <GlassField
              key={rowId}
              id={`intake-social-${rowId}`}
              label="Social link"
              name="social_url"
              type="url"
              placeholder="Social link"
              wobble={wobbleFields.includes(`social_url_${index}`)}
            />
          ))}
          <button
            type="button"
            className="website-intake-form__add-social"
            aria-label="Add another social link"
            onClick={() => setSocialRows((rows) => [...rows, Date.now()])}
          >
            <span className="website-intake-form__add-social-plus" aria-hidden="true">+</span>
            Social link
          </button>
        </div>
        </div>

        <GlassButton
          type="submit"
          className="contact-submit website-intake-form__submit"
          liquid={false}
          disabled={status === 'sending'}
        >
          {status === 'sending' ? 'Sending…' : 'Request preview'}
        </GlassButton>

        {status === 'error' && (
          <p className="contact-error mono">
            Something went wrong. Please try again or email{' '}
            <a href="mailto:nathan@taylor-marriott.com">nathan@taylor-marriott.com</a>.
          </p>
        )}
      </form>
    </ContactFormCard>
  );
}
