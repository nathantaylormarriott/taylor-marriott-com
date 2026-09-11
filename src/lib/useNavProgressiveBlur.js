import { useLayoutEffect } from 'react';
import { registerNavProgressiveBlur } from './glassBackdropRegistry';

export function useNavProgressiveBlur(shellRef, layerCanvasRefs) {
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;

    const shell = shellRef.current;
    if (!shell) return undefined;

    const canvases = layerCanvasRefs
      .map((ref) => ref.current)
      .filter(Boolean);
    if (canvases.length === 0) return undefined;

    return registerNavProgressiveBlur(shellRef, layerCanvasRefs);
  }, [shellRef, layerCanvasRefs]);
}
