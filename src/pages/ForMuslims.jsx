import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { CONFIG, QURAN_ENABLED } from '../config';
import { useShell } from '../layout/Shell';
import ContactLink from '../components/ContactLink';
import { SplitWords } from '../components/shared';
import { bindMeccaAmbienceUnlock, destroyMeccaAmbience, startMeccaAmbience } from '../lib/meccaAmbience';
import { destroyQuranPlayer, startQuranPlayback } from '../lib/quranPlayer';

export default function ForMuslims() {
  const { containerRef, sceneApiRef, reduced } = useShell();
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
        if (QURAN_ENABLED) {
          await Promise.allSettled([startQuranPlayback(), startMeccaAmbience()]);
        } else {
          await startMeccaAmbience();
        }
      } catch {
        // Autoplay may be blocked until user taps Play Quran in the header.
      }
    };

    start();
    const unbindAmbience = bindMeccaAmbienceUnlock();
    return () => {
      cancelled = true;
      unbindAmbience();
      destroyQuranPlayer();
      destroyMeccaAmbience();
      startedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.defaults({ ease: CONFIG.ease });
      gsap.set(['.logo', '.head-action'], { autoAlpha: 0 });
      gsap.set('.hero-title .split-word', { autoAlpha: 0 });
      gsap.set('.closing-btn, .for-muslims-foot', { autoAlpha: 0 });

      const heroEntrance = gsap.timeline();
      if (reduced) {
        heroEntrance
          .from(['.logo', '.head-action'], { autoAlpha: 0, duration: 1.6 }, 0)
          .to('.hero-title .split-word', { autoAlpha: 1, duration: 1.2 }, 0)
          .to('.closing-btn, .for-muslims-foot', { autoAlpha: 1, duration: 1.2 }, 0.2);
      } else {
        heroEntrance
          .fromTo(['.logo', '.head-action'],
            { autoAlpha: 0, y: 14, filter: 'blur(6px)' },
            { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 2.8, ease: CONFIG.easeLong },
            0
          )
          .fromTo('.hero-title .split-word',
            { autoAlpha: 0, y: 22, filter: 'blur(8px)' },
            { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.8, ease: CONFIG.easeLong, stagger: { each: 0.14, from: 'start' } },
            0
          )
          .fromTo('.closing-btn, .for-muslims-foot',
            { autoAlpha: 0, y: 18, filter: 'blur(8px)' },
            { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.6, ease: CONFIG.easeLong, stagger: 0.12 },
            0.35
          );
      }
    }, containerRef);

    return () => {
      ctx.revert();
      gsap.set(['.logo', '.head-action'], {
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
    <main className="for-muslims">
      <section className="hero" id="hero">
        <div className="hero-inner">
          <h1 className="hero-title">
            <span className="hero-title-line"><SplitWords text="Thoughtful digital work" /></span>
            <span className="hero-title-line"><SplitWords text="for Muslim businesses" /></span>
            <span className="hero-title-line"><SplitWords text="and communities." /></span>
          </h1>
          <ContactLink className="closing-btn">Start a Conversation</ContactLink>
        </div>
      </section>

      <footer className="for-muslims-foot">
        <a
          href="https://www.patreon.com/monarelief/about"
          className="for-muslims-charity-btn"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Proud to Support Mona Relief—Aid in Yemen. Please consider donating on Patreon."
          onClick={() => { startMeccaAmbience(); }}
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
