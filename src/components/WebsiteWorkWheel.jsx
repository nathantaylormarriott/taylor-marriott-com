import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const WORK = [
  { title: 'Genoxo Solutions', href: 'https://genoxosolutions.com/' },
  { title: 'Big Green Tent', href: 'https://thebgt.org/' },
  { title: 'Azalia Dolls', href: 'https://azaliadolls.com/' },
  { title: 'Belaisy', href: 'https://belaisy.netlify.app/' },
  { title: 'Contourwear', href: 'https://main--contourwear.netlify.app/' },
  { title: 'Saathi Snacks', href: 'https://saathisnacks.com/' },
  { title: 'Aylesbury Health & Wellness', href: 'https://aylesburyhealthandwellness.netlify.app/' },
  { title: 'Baita Palmarusso', href: 'https://baita-palmarusso-demo.netlify.app/' },
];

const CARD_H = 0.38;
const CARD_MAX_W = 0.34;
const CARD_RATIO = 1.45;
const STEP = 40;
const DRUM = 2.22;
const LENS = 2.7;
const RING_R = 1.14;
const BOW = 1.82;
const TITLE = 0.124;
const INDEX = 0.04;
const CULL = 1.6;
const WHEEL_UNITS = 900;
const DRAG_UNITS = 420;
const SETTLE = 140;
const EASE = 0.12;
const SITE_W = 1280;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (deg) => (deg * Math.PI) / 180;
const bowAt = (drumDeg, bow) => -bow * (1 - Math.cos(rad(drumDeg)));

function place(ringDeg, drumDeg, ringR, drumR, bow, m) {
  return (
    `translateX(${m * bowAt(drumDeg, bow)}px)` +
    ` rotateZ(${(1 - m) * ringDeg}deg) translateY(${-(1 - m) * ringR}px)` +
    ` rotateX(${m * drumDeg}deg) translateZ(${m * drumR}px)`
  );
}

export default function WebsiteWorkWheel() {
  const stageRef = useRef(null);
  const wheelRef = useRef(null);
  const cardRefs = useRef([]);
  const labelRef = useRef(null);
  const titleRef = useRef(null);
  const turn = useRef(0);
  const target = useRef(0);
  const drag = useRef(null);
  const settling = useRef(0);

  const [active, setActive] = useState(0);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);

  const count = WORK.length;
  const last = Math.max(count - 1, 0);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const read = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const metrics = useMemo(() => {
    const { w, h } = stage;
    const cardW = Math.min(h * CARD_H * CARD_RATIO, w * CARD_MAX_W);
    const cardH = cardW / CARD_RATIO || 0;
    const ringR = cardH * RING_R;
    const ringScale = count
      ? clamp((((2 * Math.PI * ringR) / count) * 0.82) / (cardW || 1), 0.16, 1)
      : 1;
    return {
      cardW,
      cardH,
      ringR,
      ringScale,
      drumR: cardH * DRUM,
      bow: cardH * BOW,
      depth: cardH * LENS,
      title: cardH * TITLE,
      index: cardH * INDEX,
      siteScale: cardW / SITE_W,
    };
  }, [stage, count]);

  useEffect(() => {
    if (!stage.h) return undefined;
    let frame = 0;
    const { ringR, ringScale, drumR, bow } = metrics;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const gap = target.current - turn.current;
      if (Math.abs(gap) < 0.0005) turn.current = target.current;
      else turn.current += gap * (reduced ? 1 : EASE);

      const t = turn.current;
      const m = clamp(t, 0, 1);
      const pos = Math.max(0, t - 1);

      if (wheelRef.current) {
        wheelRef.current.style.transform = `translateZ(${-m * drumR}px)`;
      }

      for (let i = 0; i < count; i += 1) {
        const d = i - pos;
        const card = cardRefs.current[i];
        if (card) {
          card.style.transform = place(d * (360 / count), d * STEP, ringR, drumR, bow, m);
          card.style.opacity = m > 0.5 && Math.abs(d) > CULL ? '0' : '1';
          card.style.zIndex = String(Math.round(100 - Math.abs(d) * 2));
        }
        const face = card?.firstElementChild;
        if (face) face.style.transform = `scale(${lerp(ringScale, 1, m)})`;
      }

      if (labelRef.current) labelRef.current.style.opacity = String(1 - m);
      if (titleRef.current) titleRef.current.style.opacity = String(m);
      const near = clamp(Math.round(pos), 0, last);
      setActive((prev) => (prev === near ? prev : near));
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [metrics, stage.h, count, last, reduced]);

  const to = useCallback((next) => {
    target.current = clamp(next, 0, last + 1);
  }, [last]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      const next = target.current + event.deltaY / WHEEL_UNITS;
      if (next > 0 && next < last + 1) event.preventDefault();
      to(next);
      window.clearTimeout(settling.current);
      settling.current = window.setTimeout(() => to(Math.round(target.current)), SETTLE);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(settling.current);
    };
  }, [to, last]);

  return (
    <section className="work-wheel" aria-label="Selected work">
      <div
        ref={stageRef}
        tabIndex={0}
        role="listbox"
        aria-label="Selected work"
        aria-activedescendant={`works-wheel-${active}`}
        className="work-wheel__stage"
        style={{ perspective: `${metrics.depth}px` }}
        onPointerDown={(event) => {
          drag.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          to(target.current + (drag.current - event.clientY) / DRAG_UNITS);
          drag.current = event.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
          if (target.current > 1) to(Math.round(target.current));
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') to(Math.round(target.current) + 1);
          else if (event.key === 'ArrowUp') to(Math.round(target.current) - 1);
          else return;
          event.preventDefault();
        }}
      >
        <div ref={wheelRef} className="work-wheel__rotor">
          {WORK.map((item, i) => (
            <a
              key={item.href}
              id={`works-wheel-${i}`}
              role="option"
              aria-selected={i === active}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              ref={(node) => {
                cardRefs.current[i] = node;
              }}
              className="work-wheel__card"
              style={{
                width: metrics.cardW,
                height: metrics.cardH,
                marginLeft: -metrics.cardW / 2,
                marginTop: -metrics.cardH / 2,
              }}
            >
              <span className="work-wheel__face">
                <iframe
                  className="work-wheel__site"
                  title={item.title}
                  src={item.href}
                  tabIndex={-1}
                  loading="lazy"
                  style={{ transform: `scale(${metrics.siteScale || 0.2})` }}
                />
                <span className="work-wheel__action">View</span>
              </span>
            </a>
          ))}
        </div>
      </div>

      <div
        ref={labelRef}
        className="work-wheel__label"
        style={{ fontSize: metrics.title || '1.5rem' }}
      >
        Selected work
      </div>
      <div
        ref={titleRef}
        className="work-wheel__title"
        style={{ fontSize: metrics.title || '1.5rem' }}
      >
        {WORK[active]?.title}
      </div>

      <ol className="work-wheel__index" style={{ fontSize: metrics.index || '0.75rem' }}>
        {WORK.map((item, i) => (
          <li key={item.href}>
            <button
              type="button"
              onClick={() => to(i + 1)}
              className={i === active ? 'is-current' : undefined}
            >
              {item.title}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
