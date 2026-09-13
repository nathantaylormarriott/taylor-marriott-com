import React from 'react';
import GlassSurface from './GlassSurface';

export default function GlassField({
  id,
  label,
  name,
  type = 'text',
  autoComplete,
  wobble = false,
  multiline = false,
  rows,
  placeholder,
  form,
  liquid = true,
  sceneBlur = false,
}) {
  const InputTag = multiline ? 'textarea' : 'input';
  const fieldPlaceholder = placeholder ?? label;

  return (
    <div className={`contact-field${wobble ? ' contact-field--wobble' : ''}`}>
      <GlassSurface
        variant="field"
        liquid={liquid}
        sceneBlur={sceneBlur}
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
