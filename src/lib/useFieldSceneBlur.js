import { useEffect } from 'react';
import { registerFieldSceneBlur } from './fieldBlurRegistry';

export function useFieldSceneBlur(shellRef, canvasRef, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    return registerFieldSceneBlur(shellRef, canvasRef);
  }, [shellRef, canvasRef, enabled]);
}
