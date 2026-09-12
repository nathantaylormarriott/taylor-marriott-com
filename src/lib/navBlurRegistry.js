import { drawNavProgressiveBlur } from './navProgressiveBlur';

let navBlurEntry = null;
let sceneApiRef = null;
let unsubscribeRender = null;
let resizeListener = null;
let visibilityListener = null;
let lastSyncMs = 0;
let pageVisible = true;
const SYNC_INTERVAL_MS = 33;

function syncNavBlur() {
  if (!pageVisible || !navBlurEntry) return;

  const now = performance.now();
  if (now - lastSyncMs < SYNC_INTERVAL_MS) return;
  lastSyncMs = now;

  const source = document.getElementById('webgl');
  if (!source) return;

  const shell = navBlurEntry.shellRef?.current;
  const layerCanvases = navBlurEntry.layerCanvasRefs
    ?.map((ref) => ref.current)
    .filter(Boolean);
  if (shell && layerCanvases?.length) {
    drawNavProgressiveBlur(shell, layerCanvases, source);
  }
}

function attachRenderHook() {
  if (unsubscribeRender || !sceneApiRef?.current?.onAfterRender) return;
  if (!navBlurEntry) return;
  unsubscribeRender = sceneApiRef.current.onAfterRender(syncNavBlur);
  lastSyncMs = 0;
  syncNavBlur();
}

function detachRenderHook() {
  unsubscribeRender?.();
  unsubscribeRender = null;
}

function ensureResizeListener() {
  if (resizeListener) return;
  resizeListener = () => {
    lastSyncMs = 0;
    syncNavBlur();
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
      syncNavBlur();
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
}

export function setNavBlurSceneApi(apiRef) {
  sceneApiRef = apiRef;
  if (navBlurEntry) attachRenderHook();
}

export function hasNavBlur() {
  return navBlurEntry !== null;
}

export function registerNavProgressiveBlur(shellRef, layerCanvasRefs) {
  navBlurEntry = { shellRef, layerCanvasRefs };
  ensureResizeListener();
  ensureVisibilityListener();
  attachRenderHook();
  lastSyncMs = 0;
  syncNavBlur();

  return () => {
    navBlurEntry = null;
    detachRenderHook();
  };
}
