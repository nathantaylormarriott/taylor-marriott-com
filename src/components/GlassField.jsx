import React from 'react';
import GlassSurface from './GlassSurface';

export default function GlassField({
  id,
  label,
  name,
  type = 'text',
  autoComplete,
  wobble = false,
  optional = false,
  multiline = false,
  rows,
  placeholder,
}) {
  const InputTag = multiline ? 'textarea' : 'input';

  return (
    <div className={`contact-field${wobble ? ' contact-field--wobble' : ''}`}>
      <label className="contact-label mono" htmlFor={id}>
        {label}
        {optional && <span className="contact-optional"> (optional)</span>}
      </label>
      <GlassSurface variant="field" className="glass-surface--input">
        <InputTag
          id={id}
          className={`glass-surface__content contact-input${multiline ? ' contact-textarea' : ''}`}
          type={multiline ? undefined : type}
          name={name}
          autoComplete={autoComplete}
          rows={rows}
          placeholder={placeholder}
        />
      </GlassSurface>
    </div>
  );
}
