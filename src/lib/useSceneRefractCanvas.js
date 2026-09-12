import { useEffect, useRef } from 'react';
import { registerSceneRefractCanvas } from './sceneRefractRegistry';

export function useSceneRefractCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => registerSceneRefractCanvas(canvasRef), []);

  return canvasRef;
}
