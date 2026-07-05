import React, { forwardRef, useRef } from 'react';
import { useGlassSurface } from '../lib/useGlassSurface';

/**
 * Unified glass stack (bottom → top):
 * 1. canvas — blurred WebGL snapshot
 * 2. tint — fields 6%, buttons 15%
 * 3. content — interactive child
 */
const GlassSurface = forwardRef(function GlassSurface(
  {
    as: Tag = 'div',
    variant = 'field',
    className = '',
    children,
    ...props
  },
  ref,
) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);

  const setShellRef = (node) => {
    shellRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  useGlassSurface(shellRef, canvasRef);

  return (
    <Tag
      ref={setShellRef}
      className={`glass-surface glass-surface--${variant}${className ? ` ${className}` : ''}`}
      {...props}
    >
      <canvas className="glass-surface__canvas" ref={canvasRef} aria-hidden="true" />
      <div className="glass-surface__tint" aria-hidden="true" />
      {children}
    </Tag>
  );
});

export default GlassSurface;
