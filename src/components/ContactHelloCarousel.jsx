import React, { useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';

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

export default function ContactHelloCarousel({ reduced = false }) {
  const trackRef = useRef(null);
  const tweenRef = useRef(null);

  const items = useMemo(() => [...HELLOS, ...HELLOS], []);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    tweenRef.current?.kill();
    gsap.set(track, { x: 0 });

    if (reduced) return undefined;

    const start = () => {
      const segment = track.scrollWidth / 2;
      if (!segment) return;

      tweenRef.current = gsap.to(track, {
        x: -segment,
        duration: segment / PX_PER_SEC,
        ease: 'none',
        repeat: -1,
      });
    };

    start();

    const onResize = () => {
      tweenRef.current?.kill();
      gsap.set(track, { x: 0 });
      start();
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      tweenRef.current?.kill();
    };
  }, [reduced]);

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
