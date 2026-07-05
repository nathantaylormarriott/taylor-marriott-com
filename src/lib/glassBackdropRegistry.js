import {
  GLASS_BLUR_PX,
  GLASS_MAX_DPR,
  drawGlassSurface,
  disposeMasterBackdrop,
  updateMasterBackdrop,
} from './glassBackdrop';

const surfaces = new Set();
let sceneApiRef = null;
let unsubscribeRender = null;
let resizeListener = null;
let visibilityListener = null;
let lastSyncMs = 0;
let pageVisible = true;
const SYNC_INTERVAL_MS = 33;

export function getGlassSurfaceCount() {
  return surfaces.size;
}

export function setGlassSceneApi(apiRef) {
  sceneApiRef = apiRef;
  if (surfaces.size > 0) attachRenderHook();
}

function syncAllSurfaces() {
  if (!pageVisible || surfaces.size === 0) return;

  const now = performance.now();
  if (now - lastSyncMs < SYNC_INTERVAL_MS) return;
  lastSyncMs = now;

  const source = document.getElementById('webgl');
  if (!source) return;

  const ok = updateMasterBackdrop(source, { blurPx: GLASS_BLUR_PX, maxDpr: GLASS_MAX_DPR });
  if (!ok) return;

  for (const entry of surfaces) {
    const shell = entry.shellRef?.current;
    const canvas = entry.canvasRef?.current;
    if (!shell || !canvas) continue;
    drawGlassSurface(shell, canvas);
  }
}

function attachRenderHook() {
  if (unsubscribeRender || !sceneApiRef?.current?.onAfterRender) return;
  unsubscribeRender = sceneApiRef.current.onAfterRender(syncAllSurfaces);
  lastSyncMs = 0;
  syncAllSurfaces();
}

function detachRenderHook() {
  unsubscribeRender?.();
  unsubscribeRender = null;
  disposeMasterBackdrop();
}

function ensureResizeListener() {
  if (resizeListener) return;
  resizeListener = () => {
    lastSyncMs = 0;
    disposeMasterBackdrop();
    syncAllSurfaces();
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
      syncAllSurfaces();
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
}

function removeGlobalListenersIfIdle() {
  if (surfaces.size > 0) return;
  if (resizeListener) {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }
}

export function registerGlassSurface(shellRef, canvasRef) {
  const entry = { shellRef, canvasRef };
  surfaces.add(entry);
  ensureResizeListener();
  ensureVisibilityListener();
  attachRenderHook();
  lastSyncMs = 0;
  syncAllSurfaces();

  return () => {
    surfaces.delete(entry);
    if (surfaces.size === 0) {
      detachRenderHook();
      removeGlobalListenersIfIdle();
    }
  };
}
