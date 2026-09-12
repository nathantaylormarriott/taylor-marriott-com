import React, { useEffect, useState } from 'react';
import AudioWave from './AudioWave';
import { subscribeQuranPlayer, toggleQuran } from '../lib/quranPlayer';

export default function QuranToggle({ className = '' }) {
  const [player, setPlayer] = useState({
    playing: false,
    loading: false,
    surahName: '',
    reciterName: '',
    error: null,
  });

  useEffect(() => subscribeQuranPlayer(setPlayer), []);

  const ariaLabel = player.loading
    ? 'Loading Quran and ambience'
    : player.playing
      ? 'Pause Quran and ambience'
      : 'Play Quran and ambience';

  const title = player.surahName && player.reciterName
    ? `${player.reciterName} — ${player.surahName}`
    : 'Quran recitation and ambience';

  return (
    <button
      type="button"
      className={`head-quran head-action ${className}`.trim()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleQuran();
      }}
      aria-pressed={player.playing}
      aria-busy={player.loading}
      aria-label={player.surahName ? `${ariaLabel} — ${player.surahName}` : ariaLabel}
      title={title}
    >
      <AudioWave active={player.playing} />
      <span className="head-quran__label">Quran</span>
    </button>
  );
}
