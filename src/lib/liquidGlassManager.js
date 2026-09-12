import { LiquidGlass } from '@ybouane/liquidglass';
import { GLASS_FIELD_CONFIG } from './liquidGlassConfig';

/** @type {Map<HTMLElement, { instance: import('@ybouane/liquidglass').LiquidGlass | null, defaults: object, token: number }>} */
const roots = new Map();
const pending = new Set();

function getDirectGlassElements(root) {
  return [...root.children].filter((el) => el.classList.contains('glass-surface'));
}

async function initRoot(root) {
  const entry = roots.get(root);
  if (!entry) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    entry.instance?.destroy();
    entry.instance = null;
    return;
  }

  const glassElements = getDirectGlassElements(root);
  if (glassElements.length === 0) {
    entry.instance?.destroy();
    entry.instance = null;
    return;
  }

  const token = ++entry.token;
  entry.instance?.destroy();
  entry.instance = null;

  try {
    const instance = await LiquidGlass.init({
      root,
      glassElements,
      defaults: entry.defaults,
    });
    if (token !== entry.token || !roots.has(root)) {
      instance.destroy();
      return;
    }
    entry.instance = instance;
  } catch (err) {
    console.warn('[liquidglass] init failed', err);
  }
}

function scheduleInit(root) {
  if (!root || pending.has(root)) return;
  pending.add(root);
  requestAnimationFrame(() => {
    pending.delete(root);
    initRoot(root);
  });
}

export function bindLiquidGlassRoot(root, defaults = GLASS_FIELD_CONFIG) {
  if (!root) return () => {};

  if (!roots.has(root)) {
    roots.set(root, { instance: null, defaults, token: 0 });
    const observer = new MutationObserver(() => scheduleInit(root));
    observer.observe(root, { childList: true });
    roots.get(root).observer = observer;
  } else {
    roots.get(root).defaults = defaults;
  }

  scheduleInit(root);

  return () => {
    const entry = roots.get(root);
    if (!entry) return;
    entry.observer?.disconnect();
    entry.token += 1;
    entry.instance?.destroy();
    roots.delete(root);
  };
}

export function markAllLiquidGlassDirty() {
  for (const entry of roots.values()) {
    entry.instance?.markChanged();
  }
}

export function hasLiquidGlassRoots() {
  return roots.size > 0;
}
