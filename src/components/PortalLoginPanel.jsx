import React, { useRef, useState } from 'react';
import { CLIENT_PORTAL_URL } from '../config';
import GlassField from './GlassField';

export default function PortalLoginPanel() {
  const [wobbleFields, setWobbleFields] = useState([]);
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
    const form = e.target;
    const invalid = [];

    if (!form.username.value.trim()) invalid.push('username');
    if (!form.password.value.trim()) invalid.push('password');

    if (invalid.length) {
      triggerWobble(invalid);
      return;
    }

    window.location.href = CLIENT_PORTAL_URL;
  };

  return (
    <div className="portal-login contact-inner">
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
      </form>
    </div>
  );
}
