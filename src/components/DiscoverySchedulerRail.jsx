import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function DiscoverySchedulerRail({
  ariaLabel,
  role,
  as: Tag = 'div',
  className = '',
  children,
}) {
  const railRef = useRef(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollBack(el.scrollLeft > 4);
    setCanScrollForward(maxScroll - el.scrollLeft > 4);
  }, []);

  const scrollBy = (direction) => {
    const el = railRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.72, 160);
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [updateScrollState, children]);

  return (
    <div className="discovery-scheduler__scroller">
      <button
        type="button"
        className="discovery-scheduler__arrow discovery-scheduler__arrow--prev"
        aria-label="Scroll earlier"
        disabled={!canScrollBack}
        onClick={() => scrollBy(-1)}
      >
        ‹
      </button>
      <div className="discovery-scheduler__rail-wrap">
        <Tag
          ref={railRef}
          className={`discovery-scheduler__rail ${className}`.trim()}
          role={role}
          aria-label={ariaLabel}
          onScroll={updateScrollState}
        >
          {children}
        </Tag>
      </div>
      <button
        type="button"
        className="discovery-scheduler__arrow discovery-scheduler__arrow--next"
        aria-label="Scroll later"
        disabled={!canScrollForward}
        onClick={() => scrollBy(1)}
      >
        ›
      </button>
    </div>
  );
}
