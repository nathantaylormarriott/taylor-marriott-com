import gsap from 'gsap';

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
      clearProps: 'transform',
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
