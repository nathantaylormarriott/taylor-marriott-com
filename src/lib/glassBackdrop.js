export const GLASS_TINT_FIELD = 'rgba(255, 255, 255, 0.06)';
export const GLASS_TINT_PILL = 'rgba(255, 255, 255, 0.15)';
export const GLASS_BLUR_PX = 20;
export const GLASS_MAX_DPR = 1.25;

let masterCanvas = null;
let masterCtx = null;
let masterSourceRect = null;

function ensureMasterCanvas(width, height, dpr) {
  const pixelW = Math.max(1, Math.round(width * dpr));
  const pixelH = Math.max(1, Math.round(height * dpr));

  if (!masterCanvas) {
    masterCanvas = document.createElement('canvas');
    masterCtx = masterCanvas.getContext('2d', { alpha: true });
  }

  if (masterCanvas.width !== pixelW || masterCanvas.height !== pixelH) {
    masterCanvas.width = pixelW;
    masterCanvas.height = pixelH;
  }

  return masterCtx;
}

/**
 * One WebGL read + one blur per frame into a shared master canvas.
 * Field canvases crop from this — fast and reliable.
 */
export function updateMasterBackdrop(sourceCanvas, options = {}) {
  if (!sourceCanvas) return false;

  const blurPx = options.blurPx ?? GLASS_BLUR_PX;
  const maxDpr = options.maxDpr ?? GLASS_MAX_DPR;
  const sourceRect = sourceCanvas.getBoundingClientRect();
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return false;

  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const ctx = ensureMasterCanvas(sourceRect.width, sourceRect.height, dpr);
  if (!ctx) return false;

  masterSourceRect = sourceRect;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sourceRect.width, sourceRect.height);

  try {
    ctx.filter = `blur(${blurPx}px) saturate(1.6)`;
    ctx.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      0,
      0,
      sourceRect.width,
      sourceRect.height,
    );
    ctx.filter = 'none';
    return true;
  } catch {
    return false;
  }
}

/** Crop the pre-blurred master snapshot into a glass surface canvas. */
export function drawGlassSurface(shellEl, glassCanvas) {
  if (!shellEl || !glassCanvas || !masterCanvas || !masterCtx || !masterSourceRect) return;

  const rect = shellEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, GLASS_MAX_DPR);
  const pixelW = Math.max(1, Math.round(rect.width * dpr));
  const pixelH = Math.max(1, Math.round(rect.height * dpr));

  if (glassCanvas.width !== pixelW || glassCanvas.height !== pixelH) {
    glassCanvas.width = pixelW;
    glassCanvas.height = pixelH;
    glassCanvas.style.width = `${rect.width}px`;
    glassCanvas.style.height = `${rect.height}px`;
  }

  const ctx = glassCanvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const scaleX = masterCanvas.width / masterSourceRect.width;
  const scaleY = masterCanvas.height / masterSourceRect.height;
  const sx = (rect.left - masterSourceRect.left) * scaleX;
  const sy = (rect.top - masterSourceRect.top) * scaleY;
  const sw = rect.width * scaleX;
  const sh = rect.height * scaleY;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  try {
    ctx.drawImage(masterCanvas, sx, sy, sw, sh, 0, 0, rect.width, rect.height);
  } catch {
    // Tint layer still renders.
  }
}

export function disposeMasterBackdrop() {
  masterCanvas = null;
  masterCtx = null;
  masterSourceRect = null;
}
