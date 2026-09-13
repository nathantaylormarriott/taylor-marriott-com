import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import AudioWave from './AudioWave';
import { subscribeQuranPlayer, toggleQuran } from '../lib/quranPlayer';

/** Unlock: hold long width while blurred, then snap short. Lock: snap long immediately under blur. */
const UNLOCK_WIDTH_DELAY_MS = 380;
const SWAP_MASK_MS = 760;

function measureLabelWidth(copyEl, shortEl, unlocked) {
  const target = unlocked ? shortEl : copyEl;
  return target?.scrollWidth ?? 0;
}

export default function QuranToggle({ className = '' }) {
  const [player, setPlayer] = useState({
    playing: false,
    unlocked: false,
    loading: false,
    surahName: '',
    reciterName: '',
    error: null,
  });
  const copyRef = useRef(null);
  const shortRef = useRef(null);
  const skipUnlockSwap = useRef(true);
  const [labelWidth, setLabelWidth] = useState(null);
  const [layoutSwapping, setLayoutSwapping] = useState(false);

  useEffect(() => subscribeQuranPlayer(setPlayer), []);

  const unlocked = player.unlocked;

  const syncLabelWidth = useCallback(() => {
    const width = measureLabelWidth(copyRef.current, shortRef.current, unlocked);
    if (width > 0) setLabelWidth(width);
  }, [unlocked]);

  useLayoutEffect(() => {
    const width = measureLabelWidth(copyRef.current, shortRef.current, false);
    if (width > 0) setLabelWidth(width);
  }, []);

  useLayoutEffect(() => {
    if (skipUnlockSwap.current) {
      skipUnlockSwap.current = false;
      return undefined;
    }

    setLayoutSwapping(true);

    let widthTimer;
    if (unlocked) {
      widthTimer = window.setTimeout(() => {
        syncLabelWidth();
      }, UNLOCK_WIDTH_DELAY_MS);
    } else {
      syncLabelWidth();
    }

    const clearTimer = window.setTimeout(() => {
      setLayoutSwapping(false);
    }, SWAP_MASK_MS);

    return () => {
      if (widthTimer) window.clearTimeout(widthTimer);
      window.clearTimeout(clearTimer);
      setLayoutSwapping(false);
      syncLabelWidth();
    };
  }, [unlocked, syncLabelWidth]);

  useEffect(() => {
    window.addEventListener('resize', syncLabelWidth);
    return () => window.removeEventListener('resize', syncLabelWidth);
  }, [syncLabelWidth]);

  const ariaLabel = player.loading
    ? 'Loading Quran and ambience'
    : player.playing
      ? 'Pause Quran and ambience'
      : unlocked
        ? 'Play Quran and ambience'
        : 'Listen to Quran';

  const title = player.surahName && player.reciterName
    ? `${player.reciterName} — ${player.surahName}`
    : 'Quran recitation and ambience';

  const onToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleQuran();
  };

  return (
    <button
      type="button"
      className={[
        'head-quran',
        'head-action',
        unlocked ? 'head-quran--unlocked' : '',
        layoutSwapping ? 'head-quran--layout-swapping' : '',
        className,
      ].filter(Boolean).join(' ')}
      onPointerDown={onToggle}
      aria-pressed={player.playing}
      aria-busy={player.loading}
      aria-label={player.surahName ? `${ariaLabel} — ${player.surahName}` : ariaLabel}
      title={title}
    >
      <AudioWave active={player.playing} />
      <span
        className="head-quran__label"
        style={labelWidth != null ? { width: `${labelWidth}px` } : undefined}
      >
        <span className="head-quran__copy" ref={copyRef}>Listen to Quran</span>
        <span className="head-quran__short" ref={shortRef} aria-hidden={!unlocked}>Quran</span>
      </span>
    </button>
  );
}
