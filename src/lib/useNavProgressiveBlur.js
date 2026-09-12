import { useLayoutEffect } from 'react';
import { registerNavProgressiveBlur } from './navBlurRegistry';

export function useNavProgressiveBlur(shellRef, layerCanvasRefs) {
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;

    const canvases = layerCanvasRefs
      .map((ref) => ref.current)
      .filter(Boolean);
    if (canvases.length === 0) return undefined;

    return registerNavProgressiveBlur(shellRef, layerCanvasRefs);
  }, [shellRef, layerCanvasRefs]);
}
