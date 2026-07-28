import React from 'react';
import GlassSurface from './GlassSurface';

const ICONS = {
  phone: (
    <svg className="contact-hub__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 3.5c.4-.9 1.5-1.2 2.3-.6l1.8 1.3c.7.5.9 1.4.5 2.1l-.8 1.4c-.2.4-.1.9.2 1.2 1.5 1.5 3.1 3.1 4.6 4.6.3.3.8.4 1.2.2l1.4-.8c.7-.4 1.6-.2 2.1.5l1.3 1.8c.6.8.3 1.9-.6 2.3l-1.6.7c-1 .4-2.1.2-3-.4-2.2-1.5-4.4-3.7-6.5-6.5-.6-.9-.8-2-.4-3l.7-1.6Z"
        fill="currentColor"
      />
    </svg>
  ),
  whatsapp: (
    <svg className="contact-hub__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.3A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 0 1 6.6 12.8l.3.5-.2.5-1.1 2.7 2.8-1.1.5-.2.5.3a8.2 8.2 0 0 1-9.4-15.5ZM8.4 9.3c.2-.5.4-.5.7-.5h.6c.2 0 .4 0 .5.4l.8 1.9c.1.2.1.4 0 .6l-.5.6c-.1.2-.1.3 0 .5.4.7 1.2 1.6 2 2 .2.1.3.1.5 0l.6-.5c.2-.1.4-.1.6 0l1.9.8c.3.1.4.3.4.5v.6c0 .3 0 .5-.5.7-1 .4-2.2.5-3.5-.2-1.8-.9-3.4-2.5-4.3-4.3-.7-1.3-.6-2.5-.2-3.5Z"
        fill="currentColor"
      />
    </svg>
  ),
  email: (
    <svg className="contact-hub__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5Zm0 1.2 8 5 8-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  form: (
    <svg className="contact-hub__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Zm3 6.5h6M9 13.5h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export default function ContactHubAction({
  href,
  label,
  detail,
  icon = 'form',
  external = false,
  onClick,
  type = 'link',
}) {
  const content = (
    <span className="glass-surface__content contact-hub__action-body">
      {ICONS[icon]}
      <span className="contact-hub__action-copy">
        <span className="contact-hub__action-label">{label}</span>
        {detail && <span className="contact-hub__action-detail">{detail}</span>}
      </span>
    </span>
  );

  if (type === 'button') {
    return (
      <GlassSurface
        as="button"
        type="button"
        variant="pill"
        className="contact-hub__action"
        onClick={onClick}
      >
        {content}
      </GlassSurface>
    );
  }

  return (
    <GlassSurface
      as="a"
      variant="pill"
      className="contact-hub__action"
      href={href}
      onClick={onClick}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {content}
    </GlassSurface>
  );
}
