import gsap from 'gsap';
import { CONFIG } from '../config';

export const PAGE_BLUR = 'blur(12px)';
export const PAGE_HEAD_BLUR = 'blur(8px)';

export const PAGE_CHROME = '.page-content, .for-muslims-foot';
export const NAV_ACTIONS = '.site-head-actions';
export const NAV_ALL = '.logo, .site-head-actions';
export const CONTACT_FORM_REVEAL =
  '.contact-inner:not(.contact-inner--success) .contact-portrait, .contact-inner:not(.contact-inner--success) .contact-title, .contact-inner:not(.contact-inner--success) .contact-lead, .contact-inner:not(.contact-inner--success) .contact-main';
export const CONTACT_INTRO =
  '.contact-inner:not(.contact-inner--success) .contact-intro-copy';
export const CONTACT_MAIN =
  '.contact-inner:not(.contact-inner--success) .contact-main';

/** Page route timing — sequential out → pause → in (Yemen CTA pattern, not button CSS). */
const FADE_OUT = CONFIG.transitionDuration * 0.68;
const FADE_IN = CONFIG.transitionDuration * 0.52;
/** Pause after outgoing page fully exits before incoming fades in. */
const HANDOFF_GAP = CONFIG.transitionDuration * 0.22;
const FOOT_AFTER_NAV = 0.1;
const PAGE_EASE_OUT = 'power2.in';
const CONTACT_X = 3;

function footEl() {
  return document.querySelector('.for-muslims-foot');
}

/** Navbar stays fixed — clear any stale transition styles. */
export function ensureNavVisible() {
  gsap.killTweensOf(NAV_ALL);
  gsap.set(NAV_ALL, {
    autoAlpha: 1,
    visibility: 'visible',
    filter: 'none',
    pointerEvents: 'auto',
    y: 0,
    clearProps: 'transform,filter',
  });
}

/** Fade + blur page chrome out before handoff (nav unchanged). */
export function fadePageChromeOut({ onComplete } = {}) {
  ensureNavVisible();
  gsap.killTweensOf([PAGE_CHROME, CONTACT_FORM_REVEAL]);

  const timeline = gsap.timeline({
    onComplete: () => {
      gsap.set(PAGE_CHROME, { visibility: 'hidden', pointerEvents: 'none' });
      onComplete?.();
    },
  });

  timeline.to(PAGE_CHROME, {
    autoAlpha: 0,
    filter: PAGE_BLUR,
    duration: FADE_OUT,
    ease: PAGE_EASE_OUT,
  }, 0);

  return timeline;
}

/** Fade + blur page chrome in (nav unchanged). */
export function fadePageChromeIn({ onComplete, handoff = false } = {}) {
  ensureNavVisible();
  gsap.killTweensOf(PAGE_CHROME);

  gsap.set(PAGE_CHROME, { visibility: 'visible', pointerEvents: 'none' });

  const foot = footEl();
  if (foot) gsap.set(foot, { autoAlpha: 0, filter: PAGE_BLUR, y: 14 });

  const timeline = gsap.timeline({ onComplete });
  const revealAt = handoff ? HANDOFF_GAP : 0;

  timeline.to('.page-content', {
    autoAlpha: 1,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
    pointerEvents: 'auto',
  }, revealAt);

  if (foot) {
    timeline.to(foot, {
      autoAlpha: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: FADE_IN,
      ease: CONFIG.ease,
    }, revealAt + FOOT_AFTER_NAV);
  }

  return timeline;
}

export function prepareContactOverlay() {
  gsap.set('.contact-overlay', { autoAlpha: 1, visibility: 'visible', pointerEvents: 'auto' });
  gsap.set(CONTACT_FORM_REVEAL, { autoAlpha: 0, visibility: 'visible', filter: PAGE_BLUR });
  gsap.set('.contact-success-view', { autoAlpha: 0, visibility: 'hidden', filter: PAGE_BLUR });
}

export function animateContactOverlayEnter(onComplete) {
  gsap.killTweensOf(['.contact-overlay', CONTACT_FORM_REVEAL, PAGE_CHROME, NAV_ACTIONS]);

  prepareContactOverlay();

  const timeline = gsap.timeline({
    onComplete: () => {
      gsap.set(PAGE_CHROME, { visibility: 'hidden', pointerEvents: 'none' });
      gsap.set(NAV_ACTIONS, { visibility: 'hidden', pointerEvents: 'none' });
      onComplete?.();
    },
  });

  timeline.to(PAGE_CHROME, {
    autoAlpha: 0,
    filter: PAGE_BLUR,
    duration: FADE_OUT,
    ease: 'power2.in',
  }, 0);

  timeline.to(NAV_ACTIONS, {
    autoAlpha: 0,
    filter: PAGE_HEAD_BLUR,
    duration: FADE_OUT * 0.92,
    ease: 'power2.in',
    pointerEvents: 'none',
  }, 0);

  timeline.to(CONTACT_FORM_REVEAL, {
    autoAlpha: 1,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
    stagger: 0.06,
  }, FADE_OUT + HANDOFF_GAP);

  return timeline;
}

export function animateContactOverlayExit(onComplete) {
  gsap.killTweensOf(['.contact-inner', '.contact-inner *', CONTACT_FORM_REVEAL, PAGE_CHROME, NAV_ACTIONS]);

  gsap.set(PAGE_CHROME, { visibility: 'visible', pointerEvents: 'none' });
  gsap.set(NAV_ACTIONS, { visibility: 'visible', pointerEvents: 'none', autoAlpha: 0, y: -8, filter: PAGE_HEAD_BLUR });

  const foot = footEl();
  if (foot) gsap.set(foot, { autoAlpha: 0, y: 14, filter: PAGE_BLUR });

  const timeline = gsap.timeline({
    onComplete: () => {
      gsap.set('.contact-overlay', { visibility: 'hidden', pointerEvents: 'none', autoAlpha: 0 });
      onComplete?.();
    },
  });

  timeline.to(CONTACT_FORM_REVEAL, {
    autoAlpha: 0,
    filter: PAGE_BLUR,
    duration: FADE_OUT,
    stagger: 0.03,
    ease: 'power2.in',
  }, 0);

  const revealAt = FADE_OUT + HANDOFF_GAP;

  timeline.to('.page-content', {
    autoAlpha: 1,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
    pointerEvents: 'auto',
  }, revealAt);

  timeline.to(NAV_ACTIONS, {
    autoAlpha: 1,
    y: 0,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
    pointerEvents: 'auto',
  }, revealAt);

  if (foot) {
    timeline.to(foot, {
      autoAlpha: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: FADE_IN,
      ease: CONFIG.ease,
    }, revealAt + FOOT_AFTER_NAV);
  }

  return timeline;
}

export function primeIncomingRoutePage() {
  ensureNavVisible();
  gsap.set(PAGE_CHROME, { autoAlpha: 0, visibility: 'visible', filter: PAGE_BLUR, pointerEvents: 'none' });
}

export function primeContactPanels() {
  gsap.set(CONTACT_INTRO, {
    autoAlpha: 0,
    visibility: 'visible',
    x: -CONTACT_X,
    filter: PAGE_BLUR,
  });
  gsap.set(CONTACT_MAIN, {
    autoAlpha: 0,
    visibility: 'visible',
    x: CONTACT_X,
    filter: PAGE_BLUR,
  });
}

export function primeIncomingContactPage() {
  ensureNavVisible();
  gsap.set('.page-content', {
    autoAlpha: 1,
    visibility: 'visible',
    filter: 'none',
    pointerEvents: 'auto',
  });
  primeContactPanels();
}

export function revealContactPanelsInstant() {
  gsap.killTweensOf([CONTACT_INTRO, CONTACT_MAIN]);
  gsap.set([CONTACT_INTRO, CONTACT_MAIN], {
    autoAlpha: 1,
    visibility: 'visible',
    x: 0,
    filter: 'none',
    clearProps: 'transform,filter',
  });
}

/** Intro from left, form from right — blur + fade preserved. */
export function animateContactEntrance({ onComplete, handoff = false } = {}) {
  ensureNavVisible();
  gsap.killTweensOf([CONTACT_INTRO, CONTACT_MAIN]);

  const timeline = gsap.timeline({ onComplete });
  const revealAt = handoff ? HANDOFF_GAP : 0;

  timeline.to(CONTACT_INTRO, {
    autoAlpha: 1,
    x: 0,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
  }, revealAt);

  timeline.to(CONTACT_MAIN, {
    autoAlpha: 1,
    x: 0,
    filter: 'blur(0px)',
    duration: FADE_IN,
    ease: CONFIG.ease,
  }, revealAt + 0.05);

  return timeline;
}

export function fadeContactPageOut({ onComplete } = {}) {
  ensureNavVisible();
  gsap.killTweensOf([CONTACT_INTRO, CONTACT_MAIN, PAGE_CHROME]);

  const timeline = gsap.timeline({
    onComplete: () => {
      gsap.set(PAGE_CHROME, { visibility: 'hidden', pointerEvents: 'none' });
      onComplete?.();
    },
  });

  timeline.to(CONTACT_INTRO, {
    autoAlpha: 0,
    x: -CONTACT_X * 1.04,
    filter: PAGE_BLUR,
    duration: FADE_OUT,
    ease: PAGE_EASE_OUT,
  }, 0);

  timeline.to(CONTACT_MAIN, {
    autoAlpha: 0,
    x: CONTACT_X * 1.04,
    filter: PAGE_BLUR,
    duration: FADE_OUT,
    ease: PAGE_EASE_OUT,
  }, 0);

  timeline.to('.page-content', {
    autoAlpha: 0,
    filter: PAGE_BLUR,
    duration: FADE_OUT * 0.85,
    ease: PAGE_EASE_OUT,
    pointerEvents: 'none',
  }, FADE_OUT + HANDOFF_GAP);

  return timeline;
}

export function revealPageChromeInstant() {
  ensureNavVisible();
  gsap.killTweensOf([PAGE_CHROME, CONTACT_FORM_REVEAL]);
  gsap.set(PAGE_CHROME, {
    autoAlpha: 1,
    visibility: 'visible',
    filter: 'none',
    pointerEvents: 'auto',
    clearProps: 'transform,filter',
  });
  const foot = footEl();
  if (foot) {
    gsap.set(foot, { autoAlpha: 1, y: 0, filter: 'none', clearProps: 'transform,filter' });
  }
}
