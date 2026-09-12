import gsap from 'gsap';
import { CONFIG } from '../config';

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
      filter: 'none',
      clearProps: 'transform,filter',
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

function heroNavStart(wordCount, { wordStagger, wordDuration, reduced }) {
  if (reduced) return wordDuration * 0.55;
  return (wordCount - 1) * wordStagger + wordDuration * 0.68;
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

  if (!heroWords.length) {
    revealHeroTitle(root);
    onComplete?.();
    return { timeline: null, fallbackMs: 0 };
  }

  const wordStagger = reduced ? 0.09 : 0.18;
  const wordDuration = reduced ? 0.95 : 2.15;

  if (headEls?.length) {
    gsap.set(headEls, { opacity: 0, pointerEvents: 'auto' });
  }
  gsap.set(heroWords, { autoAlpha: 0 });
  if (footEl) gsap.set(footEl, { autoAlpha: 0 });

  const navStart = heroNavStart(heroWords.length, { wordStagger, wordDuration, reduced });

  const timeline = gsap.timeline({
    onComplete: () => {
      revealHeroTitle(root);
      onComplete?.();
    },
  });

  if (reduced) {
    timeline.to(heroWords, {
      autoAlpha: 1,
      duration: wordDuration,
      stagger: wordStagger,
    }, 0);

    if (headEls?.length) {
      timeline.to(headEls, { opacity: 1, duration: 1.2 }, navStart);
    }
    if (footEl) {
      timeline.to(footEl, { autoAlpha: 1, duration: 1.2 }, navStart + 0.1);
    }
  } else {
    timeline.fromTo(heroWords,
      { autoAlpha: 0, y: 16, filter: 'blur(9px)' },
      {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: wordDuration,
        ease: CONFIG.easeLong,
        stagger: { each: wordStagger, from: 'start' },
      },
      0,
    );

    if (headEls?.length) {
      timeline.fromTo(headEls,
        { opacity: 0, y: -14, filter: 'blur(6px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 2.4,
          ease: CONFIG.easeLong,
          pointerEvents: 'auto',
        },
        navStart,
      );
    }

    if (footEl) {
      timeline.fromTo(footEl,
        { autoAlpha: 0, y: 16, filter: 'blur(8px)' },
        {
          autoAlpha: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 2.0,
          ease: CONFIG.easeLong,
        },
        navStart + 0.14,
      );
    }
  }

  const fallbackMs = (navStart + (reduced ? 1.2 : 2.4) + (footEl ? 0.14 : 0) + 0.45) * 1000;

  return { timeline, fallbackMs };
}
