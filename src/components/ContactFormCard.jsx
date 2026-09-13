import React, { useRef } from 'react';
import { useShell } from '../layout/Shell';
import { useFieldSceneBlur } from '../lib/useFieldSceneBlur';

export default function ContactFormCard({ children }) {
  const shellRef = useRef(null);
  const blurRef = useRef(null);
  const { reduced } = useShell();

  useFieldSceneBlur(shellRef, blurRef, !reduced);

  return (
    <div ref={shellRef} className="contact-form-card">
      <canvas
        ref={blurRef}
        className="contact-form-card__blur"
        aria-hidden="true"
      />
      <span className="contact-form-card__surface" aria-hidden="true" />
      {children}
    </div>
  );
}
