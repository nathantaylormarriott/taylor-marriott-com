import { useLayoutEffect } from 'react';
import { registerGlassSurface } from './glassBackdropRegistry';

export function useGlassSurface(shellRef, canvasRef) {
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;

    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return undefined;

    return registerGlassSurface(shellRef, canvasRef);
  }, [shellRef, canvasRef]);
}
