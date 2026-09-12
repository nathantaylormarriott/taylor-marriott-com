import { QURAN_ENABLED } from '../config';
import {
  fadeMeccaAmbienceIn,
  fadeMeccaAmbienceOut,
  startMeccaAmbience,
  stopMeccaAmbience,
} from './meccaAmbience';

export { QURAN_ENABLED };

/** Saad Al-Ghamdi — gapless surah audio on Quranicaudio CDN. */
const RECITER_NAME = 'Saad Al-Ghamdi';
const AUDIO_BASE = 'https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete';
const QURAN_VOLUME = 0.22;
const PREFETCH_AT = 0.78;
const FADE_MS = 550;

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
let quranCtx = null;
let quranSource = null;
let quranWetSend = null;
let quranWet = null;
let quranGain = null;
let ready = false;
let prefetchScheduled = false;
let pendingNextChapter = null;
let playQueue = [];
let sessionActive = false;
let toggling = false;
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

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function getQuranLevel() {
  if (quranGain) return quranGain.gain.value;
  return audio?.volume ?? 0;
}

function setQuranLevel(value) {
  if (quranGain) quranGain.gain.value = value;
  else if (audio) audio.volume = value;
}

function createHaramReverb(ctx) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 4.8);
  const impulse = ctx.createBuffer(2, len, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let early = 1;
      if (t < 0.025) early = 0.2 + t * 14;
      else if (t < 0.11) early = 1.12;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.05) * early;
    }
  }

  const node = ctx.createConvolver();
  node.buffer = impulse;
  return node;
}

async function ensureQuranGraph(player) {
  if (quranSource) {
    if (quranCtx?.state === 'suspended') await quranCtx.resume();
    return;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  quranCtx = new Ctx();
  quranSource = quranCtx.createMediaElementSource(player);
  player.volume = 1;

  const dry = quranCtx.createGain();
  dry.gain.value = 0.62;

  const wetSend = quranCtx.createGain();
  wetSend.gain.value = 0.78;

  const preDelay = quranCtx.createDelay(0.1);
  preDelay.delayTime.value = 0.036;

  const reverb = createHaramReverb(quranCtx);

  const wetTone = quranCtx.createBiquadFilter();
  wetTone.type = 'lowpass';
  wetTone.frequency.value = 6800;
  wetTone.Q.value = 0.55;

  const wet = quranCtx.createGain();
  wet.gain.value = 0.72;

  quranGain = quranCtx.createGain();
  quranGain.gain.value = 0;

  quranWetSend = wetSend;
  quranWet = wet;

  quranSource.connect(dry);
  quranSource.connect(wetSend);
  wetSend.connect(preDelay);
  preDelay.connect(reverb);
  reverb.connect(wetTone);
  wetTone.connect(wet);
  dry.connect(quranGain);
  wet.connect(quranGain);
  quranGain.connect(quranCtx.destination);

  if (quranCtx.state === 'suspended') {
    await quranCtx.resume();
  }
}

function setReverbBypass(bypass) {
  if (!quranCtx) return;
  const wetLevel = bypass ? 0 : 0.72;
  const sendLevel = bypass ? 0 : 0.78;
  const now = quranCtx.currentTime;
  if (quranWet) {
    quranWet.gain.cancelScheduledValues(now);
    quranWet.gain.setValueAtTime(wetLevel, now);
  }
  if (quranWetSend) {
    quranWetSend.gain.cancelScheduledValues(now);
    quranWetSend.gain.setValueAtTime(sendLevel, now);
  }
}

function fadeQuranVolume(target, duration = FADE_MS) {
  const from = getQuranLevel();
  if (Math.abs(from - target) < 0.001) {
    setQuranLevel(target);
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const t = smoothstep(Math.min(1, (now - start) / duration));
      setQuranLevel(from + (target - from) * t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function teardownQuranGraph() {
  quranSource = null;
  quranWetSend = null;
  quranWet = null;
  quranGain = null;
  if (quranCtx) {
    quranCtx.close().catch(() => {});
    quranCtx = null;
  }
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
  if (prefetchScheduled || !state.surah || !sessionActive) return;
  prefetchScheduled = true;
  pendingNextChapter = pickNextSurah([state.surah]);
  prefetchChapter(pendingNextChapter);
}

function onTimeUpdate() {
  if (!audio?.duration || !sessionActive) return;
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
  audio.crossOrigin = 'anonymous';
  audio.preload = 'none';
  audio.volume = 0;

  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('ended', () => {
    if (!sessionActive) return;
    prefetchScheduled = false;
    const next = pendingNextChapter ?? pickNextSurah(state.surah ? [state.surah] : []);
    pendingNextChapter = null;
    playSurah(next, { fadeIn: true }).catch((err) => setState({ error: err.message, playing: false }));
  });
  audio.addEventListener('error', () => {
    setState({ error: 'Playback failed', playing: false });
  });

  return audio;
}

async function playSurah(chapter, { fadeIn = false } = {}) {
  if (!ELIGIBLE_SURAHS.includes(chapter)) throw new Error('Surah not available');

  const url = surahUrl(chapter);
  const player = ensureAudio();
  setState({ loading: true, error: null });
  prefetchScheduled = false;

  await ensureQuranGraph(player);
  setReverbBypass(false);

  const resolved = player.src ? new URL(player.src, window.location.href).href : '';
  if (resolved !== url) {
    player.preload = 'auto';
    player.src = url;
    player.load();
    await waitForPlayback(player);
  }

  if (fadeIn) setQuranLevel(0);
  else setQuranLevel(QURAN_VOLUME);
  await player.play();
  if (fadeIn) await fadeQuranVolume(QURAN_VOLUME);

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

async function resumeQuran() {
  const player = ensureAudio();
  if (player.src && !player.ended) {
    await ensureQuranGraph(player);
    setReverbBypass(false);
    setQuranLevel(0);
    await player.play();
    await fadeQuranVolume(QURAN_VOLUME);
    setState({ playing: true, surahName: surahName(state.surah), reciterName: RECITER_NAME });
    return;
  }
  await playSurah(state.surah ?? pickNextSurah(), { fadeIn: true });
}

export async function resumeMediaSession() {
  if (sessionActive) return true;
  sessionActive = true;
  setState({ loading: true, playing: true, error: null });

  if (!QURAN_ENABLED) {
    const started = await fadeMeccaAmbienceIn();
    setState({ playing: started, loading: false });
    return started;
  }

  if (!ready) await initQuranPlayer();

  const [ambienceResult, quranResult] = await Promise.allSettled([
    fadeMeccaAmbienceIn(),
    state.surah ? resumeQuran() : playSurah(pickNextSurah(), { fadeIn: true }),
  ]);

  const started = ambienceResult.status === 'fulfilled' || quranResult.status === 'fulfilled';
  if (!started) sessionActive = false;

  setState({
    playing: sessionActive,
    loading: false,
    error: sessionActive ? null : 'Tap the wave button to start',
  });

  return sessionActive;
}

export async function pauseMediaSession() {
  if (!sessionActive) return;
  sessionActive = false;
  setState({ playing: false, loading: false });

  const jobs = [fadeMeccaAmbienceOut()];

  if (audio && !audio.paused) {
    jobs.push(
      (async () => {
        await ensureQuranGraph(audio);
        setReverbBypass(true);
        await fadeQuranVolume(0);
        audio.pause();
        setQuranLevel(QURAN_VOLUME);
        setReverbBypass(false);
      })()
    );
  }

  await Promise.allSettled(jobs);
}

export async function startMediaSession() {
  return resumeMediaSession();
}

export async function startQuranPlayback() {
  return resumeMediaSession();
}

export async function playQuran() {
  return resumeMediaSession();
}

export function stopQuran() {
  return pauseMediaSession();
}

export async function toggleQuran() {
  if (toggling) return;
  toggling = true;
  try {
    if (sessionActive) await pauseMediaSession();
    else await resumeMediaSession();
  } finally {
    toggling = false;
  }
}

export function destroyQuranPlayer() {
  sessionActive = false;
  toggling = false;
  teardownQuranGraph();
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
  stopMeccaAmbience();
  setState({
    playing: false,
    loading: false,
    surah: null,
    surahName: '',
    reciterName: '',
    error: null,
  });
}
