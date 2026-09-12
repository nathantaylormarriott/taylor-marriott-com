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
  form,
}) {
  const InputTag = multiline ? 'textarea' : 'input';
  const fieldPlaceholder = placeholder ?? (optional ? `${label} (optional)` : label);

  return (
    <div className={`contact-field${wobble ? ' contact-field--wobble' : ''}`}>
      <label className="contact-label contact-label--sr-only" htmlFor={id}>
        {label}
        {optional && ' (optional)'}
      </label>
      <GlassSurface
        variant="field"
        className={`glass-surface--input contact-form-item${multiline ? ' glass-surface--textarea' : ''}`}
      >
        <InputTag
          id={id}
          className={`glass-surface__content contact-input${multiline ? ' contact-textarea' : ''}`}
          type={multiline ? undefined : type}
          name={name}
          form={form}
          autoComplete={autoComplete}
          rows={rows}
          placeholder={fieldPlaceholder}
          aria-label={label}
        />
      </GlassSurface>
    </div>
  );
}
