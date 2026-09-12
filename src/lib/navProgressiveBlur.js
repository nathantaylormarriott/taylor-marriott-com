const NAV_BLUR_MAX_DPR = 1.5;

/**
 * Progressive layers — same band structure as av-associates .gradient-blur.
 * Blur strengths are slightly restrained; canvas filter reads heavier than CSS backdrop-filter.
 */
export const NAV_PROGRESSIVE_BLUR_LAYERS = [
  { blur: 0.5, className: 'nav-progressive-blur__layer--before' },
  { blur: 1, className: 'nav-progressive-blur__layer--1' },
  { blur: 2, className: 'nav-progressive-blur__layer--2' },
  { blur: 4, className: 'nav-progressive-blur__layer--3' },
  { blur: 6, className: 'nav-progressive-blur__layer--4' },
  { blur: 10, className: 'nav-progressive-blur__layer--5' },
  { blur: 16, className: 'nav-progressive-blur__layer--6' },
  { blur: 24, className: 'nav-progressive-blur__layer--after' },
];

let scratchCanvas = null;
let scratchCtx = null;

function getScratch(width, height, dpr) {
  const pixelW = Math.max(1, Math.round(width * dpr));
  const pixelH = Math.max(1, Math.round(height * dpr));

  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCtx = scratchCanvas.getContext('2d', { alpha: true });
  }

  if (scratchCanvas.width !== pixelW || scratchCanvas.height !== pixelH) {
    scratchCanvas.width = pixelW;
    scratchCanvas.height = pixelH;
  }

  return scratchCtx;
}

function drawLayer(canvas, sourceCanvas, shellRect, blurPx) {
  if (!canvas || !sourceCanvas || shellRect.width <= 0 || shellRect.height <= 0) return;

  const sourceRect = sourceCanvas.getBoundingClientRect();
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, NAV_BLUR_MAX_DPR);
  const pixelW = Math.max(1, Math.round(shellRect.width * dpr));
  const pixelH = Math.max(1, Math.round(shellRect.height * dpr));

  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = `${shellRect.width}px`;
    canvas.style.height = `${shellRect.height}px`;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  // Extra vertical sampling room — backdrop-filter sees surrounding pixels; a tight crop looks harsh.
  const bleed = Math.min(72, Math.max(20, blurPx * 2.5));
  const captureHeight = shellRect.height + bleed * 2;

  const scaleX = sourceCanvas.width / sourceRect.width;
  const scaleY = sourceCanvas.height / sourceRect.height;
  const sx = (shellRect.left - sourceRect.left) * scaleX;
  const sy = (shellRect.top - sourceRect.top - bleed) * scaleY;
  const sw = shellRect.width * scaleX;
  const sh = captureHeight * scaleY;

  const scratch = getScratch(shellRect.width, captureHeight, dpr);
  if (!scratch) return;

  scratch.setTransform(dpr, 0, 0, dpr, 0, 0);
  scratch.clearRect(0, 0, shellRect.width, captureHeight);

  try {
    scratch.filter = `blur(${blurPx}px) saturate(1.2)`;
    scratch.drawImage(
      sourceCanvas,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      shellRect.width,
      captureHeight,
    );
    scratch.filter = 'none';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, shellRect.width, shellRect.height);
    ctx.drawImage(
      scratchCanvas,
      0,
      bleed * dpr,
      pixelW,
      pixelH,
      0,
      0,
      shellRect.width,
      shellRect.height,
    );
  } catch {
    // Canvas stays clear — nav remains readable.
  }
}

/** Progressive nav blur from live WebGL — CSS backdrop-filter cannot sample WebGL. */
export function drawNavProgressiveBlur(shellEl, layerCanvases, sourceCanvas) {
  if (!shellEl || !sourceCanvas || !layerCanvases?.length) return;

  const shellRect = shellEl.getBoundingClientRect();
  if (shellRect.width <= 0 || shellRect.height <= 0) return;

  if (sourceCanvas.style.display === 'none') return;

  layerCanvases.forEach((canvas, index) => {
    const blurPx = NAV_PROGRESSIVE_BLUR_LAYERS[index]?.blur ?? 10;
    drawLayer(canvas, sourceCanvas, shellRect, blurPx);
  });
}
