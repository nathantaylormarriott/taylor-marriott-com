import React, { useEffect, useRef } from 'react';

const VIEW_W = 40;
const VIEW_H = 13;
const MID = VIEW_H / 2;
const AMP = 3.15;
const PERIOD = 26;
const CYCLE_MS = 2400;

function buildWavePath(phase) {
  const parts = [];
  for (let x = 0; x <= VIEW_W; x += 0.75) {
    const y = MID + AMP * Math.sin((x / PERIOD) * Math.PI * 2 + phase);
    parts.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

function buildFlatPath() {
  return `M0,${MID} L${VIEW_W},${MID}`;
}

export default function AudioWave({ active = false, className = '' }) {
  const pathRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const moving = active && !reduceMotion;

    if (!moving) {
      path.setAttribute('d', buildFlatPath());
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const phase = ((now - start) / CYCLE_MS) * Math.PI * 2;
      path.setAttribute('d', buildWavePath(phase));
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active]);

  return (
    <svg
      className={`audio-wave ${active ? 'is-active' : ''} ${className}`.trim()}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      aria-hidden="true"
    >
      <path
        ref={pathRef}
        className="audio-wave-path"
        d={buildFlatPath()}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
