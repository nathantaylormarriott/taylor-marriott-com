import { drawSceneBlurLayer } from './navProgressiveBlur';

/** Matches the nav stack's mid-band blur strength. */
export const FIELD_SCENE_BLUR_PX = 10;

const fields = new Set();
let sceneApiRef = null;
let unsubscribeRender = null;
let resizeListener = null;
let visibilityListener = null;
let lastSyncMs = 0;
let pageVisible = true;
const SYNC_INTERVAL_MS = 33;

function syncFieldBlurs() {
  if (!pageVisible || fields.size === 0) return;

  const now = performance.now();
  if (now - lastSyncMs < SYNC_INTERVAL_MS) return;
  lastSyncMs = now;

  const source = document.getElementById('webgl');
  if (!source || source.style.display === 'none') return;

  for (const entry of fields) {
    const shell = entry.shellRef?.current;
    const canvas = entry.canvasRef?.current;
    if (!shell || !canvas) continue;

    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    drawSceneBlurLayer(canvas, source, rect, FIELD_SCENE_BLUR_PX);
  }
}

function attachRenderHook() {
  if (unsubscribeRender || !sceneApiRef?.current?.onAfterRender) return;
  if (fields.size === 0) return;
  unsubscribeRender = sceneApiRef.current.onAfterRender(syncFieldBlurs);
  lastSyncMs = 0;
  syncFieldBlurs();
}

function detachRenderHook() {
  unsubscribeRender?.();
  unsubscribeRender = null;
}

function ensureResizeListener() {
  if (resizeListener) return;
  resizeListener = () => {
    lastSyncMs = 0;
    syncFieldBlurs();
  };
  window.addEventListener('resize', resizeListener, { passive: true });
}

function ensureVisibilityListener() {
  if (visibilityListener || typeof document === 'undefined') return;
  pageVisible = document.visibilityState !== 'hidden';
  visibilityListener = () => {
    pageVisible = document.visibilityState !== 'hidden';
    if (pageVisible) {
      lastSyncMs = 0;
      syncFieldBlurs();
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
}

export function setFieldBlurSceneApi(apiRef) {
  sceneApiRef = apiRef;
  if (fields.size > 0) attachRenderHook();
}

export function hasFieldBlur() {
  return fields.size > 0;
}

export function registerFieldSceneBlur(shellRef, canvasRef) {
  const entry = { shellRef, canvasRef };
  fields.add(entry);
  ensureResizeListener();
  ensureVisibilityListener();
  attachRenderHook();
  lastSyncMs = 0;
  syncFieldBlurs();

  return () => {
    fields.delete(entry);
    if (fields.size === 0) detachRenderHook();
  };
}
