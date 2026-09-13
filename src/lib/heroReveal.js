import gsap from 'gsap';
import { CONFIG } from '../config';

const HERO_WORD = {
  reduced: { duration: 0.72, stagger: 0.065, y: 0, blur: 0, delay: 0 },
  full: {
    fadeDuration: 1.42,
    motionDuration: 1.78,
    stagger: 0.094,
    y: 5,
    blur: 8,
    delay: 0.14,
    fadeEase: 'sine.out',
    motionEase: 'power2.out',
  },
};

export function getHeroHeadEls(container) {
  const root = container?.querySelector ? container : document;
  return root.querySelectorAll('.logo, .site-head-actions');
}

/** Restore hero headline visibility after overlay close or interrupted entrances. */
export function revealHeroTitle(scope = document) {
  const root = scope?.querySelector ? scope : document;
  const words = root.querySelectorAll('.hero-title .split-word');
  const heroInner = root.querySelector('.hero-inner, .hero-title-center');

  if (words.length) {
    gsap.killTweensOf(words);
    gsap.set(words, {
      autoAlpha: 1,
      opacity: 1,
      visibility: 'visible',
      y: 0,
      filter: 'blur(0px)',
      clearProps: 'transform,filter,willChange',
    });
  }

  if (heroInner && window.scrollY < 120) {
    gsap.killTweensOf(heroInner);
    gsap.set(heroInner, {
      autoAlpha: 1,
      yPercent: 0,
      clearProps: 'transform',
    });
  }
}

export function revealHeroNav(container = document) {
  const headEls = getHeroHeadEls(container);
  if (!headEls.length) return;

  gsap.killTweensOf(headEls);
  gsap.set(headEls, {
    autoAlpha: 1,
    opacity: 1,
    visibility: 'visible',
    y: 0,
    filter: 'none',
    pointerEvents: 'auto',
    clearProps: 'transform,filter',
  });
}

function heroWordTiming(wordCount, reduced) {
  const cfg = reduced ? HERO_WORD.reduced : HERO_WORD.full;
  const span = wordCount > 1 ? (wordCount - 1) * cfg.stagger : 0;
  const motionDuration = reduced ? cfg.duration : cfg.motionDuration;
  const cascadeEnd = span + motionDuration;
  const navStart = reduced
    ? cascadeEnd * 0.5
    : Math.max(0.65, span * 0.38 + motionDuration * 0.5);

  return { cfg, span, cascadeEnd, navStart, motionDuration };
}

/** Word-by-word hero reveal; navbar (and optional footer) enter near the end. */
export function runHeroEntrance({
  scope,
  headEls,
  footEl = null,
  reduced = false,
  onComplete,
}) {
  const root = scope?.querySelector ? scope : document;
  const heroWords = root.querySelectorAll('.hero-title .split-word');
  const navEls = headEls?.length ? headEls : getHeroHeadEls(document);

  if (!heroWords.length) {
    revealHeroTitle(root);
    revealHeroNav(document);
    onComplete?.();
    return { timeline: null, fallbackMs: 0 };
  }

  const { cfg, navStart, cascadeEnd } = heroWordTiming(heroWords.length, reduced);

  if (navEls.length) {
    gsap.set(navEls, {
      autoAlpha: 0,
      y: -8,
      filter: 'blur(5px)',
      pointerEvents: 'none',
    });
  }
  if (footEl) gsap.set(footEl, { autoAlpha: 0, y: 12, filter: 'blur(6px)' });

  const timeline = gsap.timeline({
    delay: cfg.delay,
    onComplete: () => {
      gsap.set(heroWords, { clearProps: 'willChange' });
      revealHeroNav(document);
      onComplete?.();
    },
  });

  if (reduced) {
    timeline.fromTo(heroWords,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: cfg.duration, stagger: cfg.stagger },
      0,
    );
  } else {
    const wordStagger = { each: cfg.stagger, from: 'start' };

    gsap.set(heroWords, {
      autoAlpha: 0,
      opacity: 0,
      y: cfg.y,
      filter: `blur(${cfg.blur}px)`,
      force3D: true,
    });

    // Soft fade first — words materialise before the rise/blur fully resolves.
    timeline.to(heroWords, {
      autoAlpha: 1,
      opacity: 1,
      duration: cfg.fadeDuration,
      ease: cfg.fadeEase,
      stagger: wordStagger,
    }, 0);

    timeline.to(heroWords, {
      y: 0,
      filter: 'blur(0px)',
      duration: cfg.motionDuration,
      ease: cfg.motionEase,
      stagger: wordStagger,
      force3D: true,
    }, 0);
  }

  const navDuration = reduced ? 0.95 : 2.05;

  if (navEls.length) {
    timeline.to(navEls, {
      autoAlpha: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: navDuration,
      ease: CONFIG.ease,
      pointerEvents: 'auto',
    }, navStart);
  }

  if (footEl) {
    timeline.to(footEl, {
      autoAlpha: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: reduced ? 0.95 : 1.55,
      ease: CONFIG.ease,
    }, navStart + 0.1);
  }

  const fallbackMs = (cfg.delay + navStart + navDuration + 0.35) * 1000;

  return { timeline, fallbackMs };
}
