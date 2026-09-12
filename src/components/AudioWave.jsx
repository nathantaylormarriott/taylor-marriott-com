import React from 'react';

const WAVE_PATH = 'M0,5 Q4,1 8,5 T16,5 T24,5 T32,5';
const FLAT_PATH = 'M0,5 L32,5';

export default function AudioWave({ active = false, className = '' }) {
  return (
    <svg
      className={`audio-wave ${active ? 'is-active' : ''} ${className}`.trim()}
      viewBox="0 0 32 10"
      aria-hidden="true"
    >
      {active ? (
        <g className="audio-wave-osc">
          <path
            className="audio-wave-path"
            d={WAVE_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <path
          className="audio-wave-path"
          d={FLAT_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
