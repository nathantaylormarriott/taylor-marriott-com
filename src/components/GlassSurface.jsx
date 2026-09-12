import React, { forwardRef, useMemo } from 'react';
import { useShell } from '../layout/Shell';
import { getGlassConfig } from '../lib/liquidGlassConfig';

const GlassSurface = forwardRef(function GlassSurface(
  {
    as: Tag = 'div',
    variant = 'field',
    className = '',
    liquid = true,
    style,
    children,
    ...props
  },
  ref,
) {
  const { reduced } = useShell();
  const useLiquid = liquid && !reduced;

  const config = useMemo(
    () => JSON.stringify(getGlassConfig(variant)),
    [variant],
  );

  const classes = [
    'glass-surface',
    `glass-surface--${variant}`,
    useLiquid ? '' : 'glass-surface--fallback',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Tag
      ref={ref}
      className={classes}
      data-config={useLiquid ? config : undefined}
      style={style}
      {...props}
    >
      {!useLiquid && <span className="glass-surface__tint" aria-hidden="true" />}
      {children}
    </Tag>
  );
});

export default GlassSurface;
