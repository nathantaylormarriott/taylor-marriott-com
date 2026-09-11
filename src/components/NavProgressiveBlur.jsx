import React, { useRef } from 'react';
import { NAV_PROGRESSIVE_BLUR_LAYERS } from '../lib/navProgressiveBlur';
import { useNavProgressiveBlur } from '../lib/useNavProgressiveBlur';

/**
 * Progressive top blur for the fixed nav — canvas snapshots of the WebGL scene.
 * CSS backdrop-filter cannot sample a WebGL canvas, so this mirrors the
 * Forest Sanctuary gradient-blur stack using 2D canvas blur per layer.
 */
export default function NavProgressiveBlur() {
  const shellRef = useRef(null);
  const layerRefs = useRef(
    NAV_PROGRESSIVE_BLUR_LAYERS.map(() => React.createRef()),
  );

  useNavProgressiveBlur(shellRef, layerRefs.current);

  return (
    <div ref={shellRef} className="nav-progressive-blur" aria-hidden>
      {NAV_PROGRESSIVE_BLUR_LAYERS.map((layer, index) => (
        <canvas
          key={layer.className}
          ref={layerRefs.current[index]}
          className={`nav-progressive-blur__layer ${layer.className}`}
        />
      ))}
    </div>
  );
}
