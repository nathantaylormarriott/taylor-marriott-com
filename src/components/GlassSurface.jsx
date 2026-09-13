import React, { forwardRef, useMemo, useRef } from 'react';
import { useShell } from '../layout/Shell';
import { getGlassConfig } from '../lib/liquidGlassConfig';
import { useFieldSceneBlur } from '../lib/useFieldSceneBlur';

const GlassSurface = forwardRef(function GlassSurface(
  {
    as: Tag = 'div',
    variant = 'field',
    className = '',
    liquid = true,
    sceneBlur = false,
    style,
    children,
    ...props
  },
  ref,
) {
  const { reduced } = useShell();
  const useLiquid = liquid && !reduced;
  const useSceneBlur = sceneBlur && !reduced;
  const shellRef = useRef(null);
  const blurRef = useRef(null);

  useFieldSceneBlur(shellRef, blurRef, useSceneBlur);

  const config = useMemo(
    () => JSON.stringify(getGlassConfig(variant)),
    [variant],
  );

  const classes = [
    'glass-surface',
    `glass-surface--${variant}`,
    useLiquid ? '' : useSceneBlur ? 'glass-surface--scene-blur' : 'glass-surface--fallback',
    className,
  ].filter(Boolean).join(' ');

  const setShellRef = (node) => {
    shellRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <Tag
      ref={setShellRef}
      className={classes}
      data-config={useLiquid ? config : undefined}
      style={style}
      {...props}
    >
      {useSceneBlur && (
        <canvas
          ref={blurRef}
          className="glass-surface__blur"
          aria-hidden="true"
        />
      )}
      {!useLiquid && <span className="glass-surface__tint" aria-hidden="true" />}
      {children}
    </Tag>
  );
});

export default GlassSurface;
