import React, { useEffect, useState } from 'react';
import AudioWave from './AudioWave';
import { subscribeQuranPlayer, toggleQuran } from '../lib/quranPlayer';

export default function QuranToggle({ className = '' }) {
  const [player, setPlayer] = useState({
    playing: false,
    unlocked: false,
    loading: false,
    surahName: '',
    reciterName: '',
    error: null,
  });

  useEffect(() => subscribeQuranPlayer(setPlayer), []);

  const unlocked = player.unlocked;

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
      className={`head-quran head-action ${unlocked ? 'head-quran--unlocked' : ''} ${className}`.trim()}
      onPointerDown={onToggle}
      aria-pressed={player.playing}
      aria-busy={player.loading}
      aria-label={player.surahName ? `${ariaLabel} — ${player.surahName}` : ariaLabel}
      title={title}
    >
      <AudioWave active={player.playing} />
      <span className="head-quran__label">
        <span className="head-quran__copy">Listen to Quran</span>
        <span className="head-quran__short" aria-hidden={!unlocked}>Quran</span>
      </span>
    </button>
  );
}
