import { QURAN_ENABLED } from '../config';
import { startMeccaAmbience } from './meccaAmbience';

export { QURAN_ENABLED };

/** Saad Al-Ghamdi — gapless surah audio on Quranicaudio CDN. */
const RECITER_NAME = 'Saad Al-Ghamdi';
const AUDIO_BASE = 'https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete';
const QURAN_VOLUME = 0.29;
const PREFETCH_AT = 0.78;

/** Surahs under ~10 min for this reciter (file size cap used when list was built). */
const ELIGIBLE_SURAHS = [
  1, 61, 62, 63, 64, 66, 70, 71, 73, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
  105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
];

const SURAHS = {
  1: 'Al-Fatiha',
  61: 'As-Saf',
  62: 'Al-Jumu\'ah',
  63: 'Al-Munafiqun',
  64: 'At-Taghabun',
  66: 'At-Tahrim',
  70: 'Al-Ma\'arij',
  71: 'Nuh',
  73: 'Al-Muzzammil',
  75: 'Al-Qiyamah',
  76: 'Al-Insan',
  77: 'Al-Mursalat',
  78: 'An-Naba',
  79: 'An-Nazi\'at',
  80: 'Abasa',
  81: 'At-Takwir',
  82: 'Al-Infitar',
  83: 'Al-Mutaffifin',
  84: 'Al-Inshiqaq',
  85: 'Al-Buruj',
  86: 'At-Tariq',
  87: 'Al-A\'la',
  88: 'Al-Ghashiyah',
  89: 'Al-Fajr',
  90: 'Al-Balad',
  91: 'Ash-Shams',
  92: 'Al-Layl',
  93: 'Ad-Duhaa',
  94: 'Ash-Sharh',
  95: 'At-Tin',
  96: 'Al-Alaq',
  97: 'Al-Qadr',
  98: 'Al-Bayyinah',
  99: 'Az-Zalzalah',
  100: 'Al-Adiyat',
  101: 'Al-Qari\'ah',
  102: 'At-Takathur',
  103: 'Al-Asr',
  104: 'Al-Humazah',
  105: 'Al-Fil',
  106: 'Quraysh',
  107: 'Al-Ma\'un',
  108: 'Al-Kawthar',
  109: 'Al-Kafirun',
  110: 'An-Nasr',
  111: 'Al-Masad',
  112: 'Al-Ikhlas',
  113: 'Al-Falaq',
  114: 'An-Nas',
};

let audio = null;
let prefetchAudio = null;
let ready = false;
let prefetchScheduled = false;
let pendingNextChapter = null;
let playQueue = [];
let listeners = new Set();

const state = {
  playing: false,
  loading: false,
  surah: null,
  surahName: '',
  reciterName: '',
  error: null,
};

function emit() {
  listeners.forEach((fn) => fn({ ...state }));
}

function setState(patch) {
  Object.assign(state, patch);
  emit();
}

function surahUrl(chapter) {
  const id = String(chapter).padStart(3, '0');
  return `${AUDIO_BASE}//${id}.mp3`;
}

function surahName(chapter) {
  return SURAHS[chapter] ?? `Surah ${chapter}`;
}

function reshuffleQueue() {
  playQueue = [...ELIGIBLE_SURAHS];
  for (let i = playQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playQueue[i], playQueue[j]] = [playQueue[j], playQueue[i]];
  }
}

function pickNextSurah(exclude = []) {
  if (!playQueue.length) reshuffleQueue();

  const tries = playQueue.length;
  for (let i = 0; i < tries; i++) {
    const chapter = playQueue.shift();
    if (!exclude.includes(chapter)) return chapter;
    playQueue.push(chapter);
  }

  return ELIGIBLE_SURAHS[Math.floor(Math.random() * ELIGIBLE_SURAHS.length)];
}

function prefetchChapter(chapter) {
  if (!ELIGIBLE_SURAHS.includes(chapter)) return;

  if (prefetchAudio) {
    prefetchAudio.pause();
    prefetchAudio.removeAttribute('src');
    prefetchAudio.load();
    prefetchAudio = null;
  }

  prefetchAudio = new Audio();
  prefetchAudio.preload = 'auto';
  prefetchAudio.src = surahUrl(chapter);
  prefetchAudio.load();
}

function schedulePrefetch() {
  if (prefetchScheduled || !state.surah) return;
  prefetchScheduled = true;
  pendingNextChapter = pickNextSurah([state.surah]);
  prefetchChapter(pendingNextChapter);
}

function onTimeUpdate() {
  if (!audio?.duration || !state.playing) return;
  if (audio.currentTime / audio.duration >= PREFETCH_AT) schedulePrefetch();
}

function waitForPlayback(player) {
  if (player.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Buffer failed'));
    };
    const cleanup = () => {
      player.removeEventListener('canplay', onReady);
      player.removeEventListener('error', onErr);
    };
    player.addEventListener('canplay', onReady);
    player.addEventListener('error', onErr);
  });
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.volume = QURAN_VOLUME;

  audio.addEventListener('playing', () => setState({ playing: true }));
  audio.addEventListener('pause', () => setState({ playing: false }));
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('ended', () => {
    prefetchScheduled = false;
    const next = pendingNextChapter ?? pickNextSurah(state.surah ? [state.surah] : []);
    pendingNextChapter = null;
    playSurah(next).catch((err) => setState({ error: err.message, playing: false }));
  });
  audio.addEventListener('error', () => {
    setState({ error: 'Playback failed', playing: false });
  });

  return audio;
}

async function playSurah(chapter) {
  if (!ELIGIBLE_SURAHS.includes(chapter)) throw new Error('Surah not available');

  const url = surahUrl(chapter);
  const player = ensureAudio();
  setState({ loading: true, error: null });
  prefetchScheduled = false;

  if (player.src !== url) {
    player.preload = 'auto';
    player.src = url;
    player.load();
    await waitForPlayback(player);
  }

  await player.play();
  setState({
    playing: true,
    loading: false,
    surah: chapter,
    surahName: surahName(chapter),
    reciterName: RECITER_NAME,
  });
}

export function subscribeQuranPlayer(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export async function initQuranPlayer() {
  if (!QURAN_ENABLED) return;
  if (ready) return;
  reshuffleQueue();
  ready = true;
}

async function ensureAmbience() {
  try {
    await startMeccaAmbience();
  } catch {
    // Ambience may stay blocked until a later gesture.
  }
}

export async function startQuranPlayback() {
  if (!QURAN_ENABLED) {
    await ensureAmbience();
    return;
  }
  if (!ready) await initQuranPlayer();
  await Promise.all([playSurah(pickNextSurah()), ensureAmbience()]);
}

export async function playQuran() {
  if (!QURAN_ENABLED) {
    await ensureAmbience();
    return;
  }
  if (!ready) await initQuranPlayer();
  if (!state.surah) {
    await Promise.all([playSurah(pickNextSurah()), ensureAmbience()]);
    return;
  }
  const player = ensureAudio();
  if (player.src && !player.ended) {
    await Promise.all([player.play(), ensureAmbience()]);
    setState({ playing: true });
    return;
  }
  await playSurah(state.surah);
}

export function stopQuran() {
  if (!audio) return;
  audio.pause();
  setState({ playing: false });
}

export function toggleQuran() {
  if (!QURAN_ENABLED) {
    return ensureAmbience();
  }
  if (state.playing) {
    stopQuran();
    return;
  }
  return playQuran();
}

export function destroyQuranPlayer() {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
  }
  if (prefetchAudio) {
    prefetchAudio.pause();
    prefetchAudio.removeAttribute('src');
    prefetchAudio.load();
    prefetchAudio = null;
  }
  ready = false;
  prefetchScheduled = false;
  pendingNextChapter = null;
  playQueue = [];
  setState({
    playing: false,
    loading: false,
    surah: null,
    surahName: '',
    reciterName: '',
    error: null,
  });
}
