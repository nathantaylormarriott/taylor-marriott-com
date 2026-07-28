import React, { useRef, useState } from 'react';
import { PORTAL } from '../config';
import GlassField from './GlassField';

function triggerDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function PortalLoginPanel() {
  const [wobbleFields, setWobbleFields] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const wobbleTimerRef = useRef(null);

  const triggerWobble = (fields) => {
    if (wobbleTimerRef.current) clearTimeout(wobbleTimerRef.current);
    setWobbleFields([]);
    requestAnimationFrame(() => {
      setWobbleFields(fields);
      wobbleTimerRef.current = setTimeout(() => setWobbleFields([]), 520);
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const form = e.target;
    const invalid = [];

    if (!form.username.value.trim()) invalid.push('username');
    if (!form.password.value.trim()) invalid.push('password');

    if (invalid.length) {
      triggerWobble(invalid);
      return;
    }

    const username = form.username.value.trim();
    const password = form.password.value;

    if (username !== PORTAL.username || password !== PORTAL.password) {
      setError('Invalid username or password.');
      triggerWobble(['username', 'password']);
      return;
    }

    setSuccess(true);
    triggerDownload(PORTAL.downloadUrl, PORTAL.downloadName);
  };

  return (
    <div className="portal-login contact-inner">
      {success ? (
        <div className="portal-login-success" aria-live="polite">
          <h2 className="contact-success-title">Access granted</h2>
          <p className="contact-success-body">
            Your download should start automatically. If it didn&apos;t, use the button below.
          </p>
          <button
            type="button"
            className="contact-submit portal-login-submit"
            onClick={() => triggerDownload(PORTAL.downloadUrl, PORTAL.downloadName)}
          >
            Download again
          </button>
        </div>
      ) : (
        <form className="portal-login-form contact-form" noValidate onSubmit={handleSubmit}>
          <GlassField
            id="portal-username"
            label="Username"
            name="username"
            autoComplete="username"
            wobble={wobbleFields.includes('username')}
          />

          <GlassField
            id="portal-password"
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            wobble={wobbleFields.includes('password')}
          />

          <button className="contact-submit portal-login-submit" type="submit">
            Access
          </button>

          {error && (
            <p className="contact-error mono portal-login-error">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}
