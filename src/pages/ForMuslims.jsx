import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { revealHeroTitle, runHeroEntrance } from '../lib/heroReveal';
import { useShell } from '../layout/Shell';
import { SplitWords } from '../components/shared';
import { destroyMeccaAmbience } from '../lib/meccaAmbience';
import { destroyQuranPlayer, startMediaSession, canGestureStartQuran, GENTLE_FADE_MS } from '../lib/quranPlayer';

export default function ForMuslims() {
  const { containerRef, sceneApiRef, reduced } = useShell();
  const mainRef = useRef(null);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    sceneApiRef.current?.setScrollImmediate?.(0);
  }, [sceneApiRef]);

  useEffect(() => {
    document.documentElement.classList.add('for-muslims-route');
    return () => document.documentElement.classList.remove('for-muslims-route');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const onGesture = (event) => {
      if (cancelled || !canGestureStartQuran()) return;
      if (event.target?.closest?.('.head-quran')) return;
      startMediaSession({ fadeMs: GENTLE_FADE_MS }).catch(() => {});
    };

    window.addEventListener('pointerdown', onGesture, { capture: true });

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', onGesture, { capture: true });
      destroyQuranPlayer();
      destroyMeccaAmbience();
    };
  }, []);

  useLayoutEffect(() => {
    const root = mainRef.current;
    if (!root) return undefined;

    let entranceFrame = 0;
    let heroFallbackTimer = 0;

    const ctx = gsap.context(() => {
      gsap.defaults({ ease: CONFIG.ease });

      const startHeroEntrance = () => {
        const footEl = root.querySelector('.for-muslims-foot');
        const headEls = containerRef.current?.querySelectorAll('.logo, .head-action');
        const { fallbackMs } = runHeroEntrance({
          scope: root,
          headEls,
          footEl,
          reduced,
          onComplete: () => window.clearTimeout(heroFallbackTimer),
        });
        heroFallbackTimer = window.setTimeout(() => revealHeroTitle(root), fallbackMs || 4200);
      };

      entranceFrame = requestAnimationFrame(startHeroEntrance);
    }, root);

    return () => {
      cancelAnimationFrame(entranceFrame);
      window.clearTimeout(heroFallbackTimer);
      ctx.revert();
      revealHeroTitle(root);
      gsap.set(containerRef.current?.querySelectorAll('.logo, .head-action'), {
        autoAlpha: 1,
        opacity: 1,
        visibility: 'visible',
        y: 0,
        filter: 'none',
        pointerEvents: 'auto',
        clearProps: 'transform,filter',
      });
    };
  }, [reduced, containerRef]);

  return (
    <main className="for-muslims" ref={mainRef}>
      <section className="hero" id="hero">
        <div className="hero-title-center">
          <h1 className="hero-title">
            <span className="hero-title-line"><SplitWords text="Thoughtful digital work" /></span>
            <span className="hero-title-line"><SplitWords text="for Muslim businesses" /></span>
            <span className="hero-title-line"><SplitWords text="and communities." /></span>
          </h1>
        </div>
      </section>

      <footer className="for-muslims-foot">
        <a
          href="https://www.patreon.com/monarelief/about"
          className="for-muslims-charity-btn"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Proud to Support Mona Relief—Aid in Yemen. Please consider donating on Patreon."
        >
          <span className="for-muslims-charity-label">
            <span className="for-muslims-charity-copy">
              Proud to Support Mona Relief—Aid in Yemen
            </span>
            <span className="for-muslims-charity-donate" aria-hidden="true">
              Please Consider Donating <span className="for-muslims-charity-icon">↗</span>
            </span>
          </span>
        </a>
      </footer>
    </main>
  );
}
