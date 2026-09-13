import React, { useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import {
  CONTACT_HELLO_STOP_EVENT,
  contactHelloScrollRampStart,
} from '../lib/pageTransition';

const HELLOS = [
  { text: 'Hello', lang: 'en' },
  { text: 'Ciao', lang: 'it' },
  { text: 'こんにちは', lang: 'ja' },
  { text: 'Labas', lang: 'lt' },
  { text: 'مرحبًا', lang: 'ar' },
  { text: 'Hola', lang: 'es' },
  { text: 'Привет', lang: 'ru' },
  { text: '你好', lang: 'zh' },
  { text: 'Bonjour', lang: 'fr' },
  { text: '안녕하세요', lang: 'ko' },
  { text: 'Hallo', lang: 'de' },
];

const PX_PER_SEC = 24;
const RAMP_S = 3.2;

export default function ContactHelloCarousel({ reduced = false, entranceHandoff = false }) {
  const trackRef = useRef(null);
  const rampTweenRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const scrollStateRef = useRef({ speed: 0, x: 0, segment: 0 });

  const items = useMemo(() => [...HELLOS, ...HELLOS], []);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const stopScroll = () => {
      if (scrollTimerRef.current) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      rampTweenRef.current?.kill();
      rampTweenRef.current = null;
      gsap.ticker.remove(tick);
      scrollStateRef.current.speed = 0;
    };

    const tick = () => {
      const state = scrollStateRef.current;
      if (state.speed <= 0 || state.segment <= 0) return;

      state.x += state.speed * (gsap.ticker.deltaRatio() / 60);
      if (state.x >= state.segment) state.x %= state.segment;
      gsap.set(track, { x: -state.x });
    };

    const startScrollRamp = () => {
      const segment = track.scrollWidth / 2;
      if (!segment) return;

      scrollStateRef.current.segment = segment;
      scrollStateRef.current.x = 0;
      scrollStateRef.current.speed = 0;
      gsap.set(track, { x: 0 });

      gsap.ticker.add(tick);
      rampTweenRef.current = gsap.to(scrollStateRef.current, {
        speed: PX_PER_SEC,
        duration: RAMP_S,
        ease: 'power2.out',
      });
    };

    stopScroll();
    gsap.set(track, { x: 0 });

    if (reduced) return stopScroll;

    scrollTimerRef.current = window.setTimeout(
      startScrollRamp,
      contactHelloScrollRampStart(entranceHandoff) * 1000,
    );

    const onResize = () => {
      const wasMoving = scrollStateRef.current.speed > 0;
      stopScroll();
      gsap.set(track, { x: 0 });
      if (wasMoving) startScrollRamp();
    };

    const onPageExit = () => stopScroll();

    window.addEventListener('resize', onResize);
    window.addEventListener(CONTACT_HELLO_STOP_EVENT, onPageExit);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener(CONTACT_HELLO_STOP_EVENT, onPageExit);
      stopScroll();
    };
  }, [entranceHandoff, reduced]);

  return (
    <div
      className="contact-hello-carousel"
      role="img"
      aria-label="Hello in English, Italian, Japanese, Lithuanian, Arabic, Spanish, Russian, Chinese, French, Korean, and German"
    >
      <div className="contact-hello-carousel__viewport">
        <div className="contact-hello-carousel__track" ref={trackRef}>
          {items.map((item, index) => (
            <span
              key={`${item.lang}-${index}`}
              className="contact-hello-carousel__word"
              lang={item.lang}
              dir={item.lang === 'ar' ? 'rtl' : 'ltr'}
            >
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
