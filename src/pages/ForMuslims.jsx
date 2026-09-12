import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { revealHeroTitle } from '../lib/heroReveal';
import { useShell } from '../layout/Shell';
import { SplitWords } from '../components/shared';
import { destroyMeccaAmbience } from '../lib/meccaAmbience';
import { destroyQuranPlayer, startMediaSession } from '../lib/quranPlayer';

export default function ForMuslims() {
  const { containerRef, sceneApiRef, reduced } = useShell();
  const mainRef = useRef(null);
  const startedRef = useRef(false);

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

    const start = async () => {
      try {
        if (cancelled || startedRef.current) return;
        startedRef.current = true;
        await startMediaSession();
      } catch {
        // Autoplay is often blocked until the visitor taps the wave button.
      }
    };

    start();
    return () => {
      cancelled = true;
      destroyQuranPlayer();
      destroyMeccaAmbience();
      startedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const root = mainRef.current;
    if (!root) return undefined;

    let entranceFrame = 0;
    let heroFallbackTimer = 0;

    const ctx = gsap.context(() => {
      gsap.defaults({ ease: CONFIG.ease });

      const runHeroEntrance = () => {
        const heroWords = root.querySelectorAll('.hero-title .split-word');
        const footEl = root.querySelector('.for-muslims-foot');
        const headEls = containerRef.current?.querySelectorAll('.logo, .head-action');

        if (!heroWords.length) {
          revealHeroTitle(root);
          return;
        }

        gsap.set(headEls, { autoAlpha: 0 });
        gsap.set(heroWords, { autoAlpha: 0 });
        if (footEl) gsap.set(footEl, { autoAlpha: 0 });

        const finishHeroEntrance = () => {
          window.clearTimeout(heroFallbackTimer);
          revealHeroTitle(root);
        };

        const heroEntrance = gsap.timeline({ onComplete: finishHeroEntrance });
        if (reduced) {
          heroEntrance
            .from(headEls, { autoAlpha: 0, duration: 1.6 }, 0)
            .to(heroWords, { autoAlpha: 1, duration: 1.2 }, 0);
          if (footEl) heroEntrance.to(footEl, { autoAlpha: 1, duration: 1.2 }, 0.2);
        } else {
          heroEntrance
            .fromTo(headEls,
              { autoAlpha: 0, y: -14, filter: 'blur(6px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 2.8, ease: CONFIG.easeLong },
              0
            )
            .fromTo(heroWords,
              { autoAlpha: 0, y: 22, filter: 'blur(8px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.8, ease: CONFIG.easeLong, stagger: { each: 0.14, from: 'start' } },
              0
            );
          if (footEl) {
            heroEntrance.fromTo(footEl,
              { autoAlpha: 0, y: 18, filter: 'blur(8px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.6, ease: CONFIG.easeLong },
              0.35
            );
          }
        }

        heroFallbackTimer = window.setTimeout(finishHeroEntrance, 3200);
      };

      entranceFrame = requestAnimationFrame(runHeroEntrance);
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
