import React, { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { useShell } from '../layout/Shell';
import { bindLiquidGlassRoot, markAllLiquidGlassDirty } from '../lib/liquidGlassManager';
import { GLASS_FIELD_CONFIG } from '../lib/liquidGlassConfig';

const LiquidGlassRoot = forwardRef(function LiquidGlassRoot(
  {
    as: Tag = 'div',
    className = '',
    defaults = GLASS_FIELD_CONFIG,
    children,
    ...props
  },
  ref,
) {
  const rootRef = useRef(null);
  const bgRef = useRef(null);
  const { sceneApiRef, reduced } = useShell();

  const setRootRef = (node) => {
    rootRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  useLayoutEffect(() => {
    if (reduced || !rootRef.current) return undefined;
    return bindLiquidGlassRoot(rootRef.current, defaults);
  }, [reduced, defaults]);

  useEffect(() => {
    if (reduced) return undefined;

    const mirror = bgRef.current;
    const webgl = document.getElementById('webgl');
    if (!mirror || !webgl) return undefined;

    const ctx = mirror.getContext('2d');
    if (!ctx) return undefined;

    const sync = () => {
      const rect = webgl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || !webgl.width || !webgl.height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelW = Math.max(1, Math.round(rect.width * dpr));
      const pixelH = Math.max(1, Math.round(rect.height * dpr));

      if (mirror.width !== pixelW || mirror.height !== pixelH) {
        mirror.width = pixelW;
        mirror.height = pixelH;
        mirror.style.width = `${rect.width}px`;
        mirror.style.height = `${rect.height}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(webgl, 0, 0, rect.width, rect.height);
      markAllLiquidGlassDirty();
    };

    const unsub = sceneApiRef.current?.onAfterRender?.(sync);
    sync();
    return () => unsub?.();
  }, [sceneApiRef, reduced]);

  const classes = ['liquid-glass-root', className].filter(Boolean).join(' ');

  return (
    <Tag ref={setRootRef} className={classes} {...props}>
      {!reduced && (
        <canvas
          ref={bgRef}
          className="liquid-glass-bg"
          data-dynamic
          aria-hidden="true"
        />
      )}
      {children}
    </Tag>
  );
});

export default LiquidGlassRoot;
