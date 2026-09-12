const canvases = new Set();
let unsubscribeRender = null;
let sceneApiRef = null;

function syncAllRefractCanvases() {
  const source = document.getElementById('webgl');
  if (!source || canvases.size === 0) return;

  const rect = source.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const pixelW = Math.max(1, Math.round(rect.width * dpr));
  const pixelH = Math.max(1, Math.round(rect.height * dpr));

  for (const canvasRef of canvases) {
    const canvas = canvasRef.current;
    if (!canvas) continue;

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) continue;

    try {
      ctx.drawImage(
        source,
        0,
        0,
        source.width,
        source.height,
        0,
        0,
        pixelW,
        pixelH,
      );
    } catch {
      // Canvas may be tainted or not ready yet.
    }
  }
}

function attachRenderHook() {
  if (unsubscribeRender || !sceneApiRef?.current?.onAfterRender) return;
  if (canvases.size === 0) return;
  unsubscribeRender = sceneApiRef.current.onAfterRender(syncAllRefractCanvases);
  syncAllRefractCanvases();
}

function detachRenderHook() {
  unsubscribeRender?.();
  unsubscribeRender = null;
}

export function setSceneRefractApi(apiRef) {
  sceneApiRef = apiRef;
  if (canvases.size > 0) attachRenderHook();
}

export function hasSceneRefractCanvases() {
  return canvases.size > 0;
}

export function registerSceneRefractCanvas(canvasRef) {
  canvases.add(canvasRef);
  attachRenderHook();
  syncAllRefractCanvases();

  return () => {
    canvases.delete(canvasRef);
    if (canvases.size === 0) detachRenderHook();
  };
}
