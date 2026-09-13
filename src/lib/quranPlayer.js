import { QURAN_ENABLED } from '../config';
import {
  fadeMeccaAmbienceIn,
  fadeMeccaAmbienceOut,
  stopMeccaAmbience,
} from './meccaAmbience';

export { QURAN_ENABLED };

/** Saad Al-Ghamdi — gapless surah audio on Quranicaudio CDN. */
const RECITER_NAME = 'Saad Al-Ghamdi';
const AUDIO_BASE = 'https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete';
const QURAN_VOLUME = 0.32;
const QURAN_WET_LEVEL = 0.72;
const QURAN_WET_SEND = 0.78;
const PREFETCH_AT = 0.78;
const FADE_MS = 550;
const REVERB_FADE_OUT_MS = 140;
export const GENTLE_FADE_MS = 3200;

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
let sessionUnlocked = false;
let userPaused = false;
let syncing = false;
let intentPlaying = false;
let listeners = new Set();

const state = {
  playing: false,
  unlocked: false,
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
  wetSend.gain.value = QURAN_WET_SEND;

  const preDelay = quranCtx.createDelay(0.1);
  preDelay.delayTime.value = 0.036;

  const reverb = createHaramReverb(quranCtx);

  const wetTone = quranCtx.createBiquadFilter();
  wetTone.type = 'lowpass';
  wetTone.frequency.value = 6800;
  wetTone.Q.value = 0.55;

  const wet = quranCtx.createGain();
  wet.gain.value = QURAN_WET_LEVEL;

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

function setReverbLevels(wetLevel, sendLevel) {
  if (!quranCtx) return;
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

function setReverbBypass(bypass) {
  setReverbLevels(bypass ? 0 : QURAN_WET_LEVEL, bypass ? 0 : QURAN_WET_SEND);
}

function fadeQuranReverb(wetTarget, sendTarget, durationMs = REVERB_FADE_OUT_MS) {
  if (!quranCtx || !quranWet || !quranWetSend) return Promise.resolve();

  const now = quranCtx.currentTime;
  const durationSec = Math.max(0.01, durationMs / 1000);

  quranWet.gain.cancelScheduledValues(now);
  quranWetSend.gain.cancelScheduledValues(now);
  quranWet.gain.setValueAtTime(quranWet.gain.value, now);
  quranWetSend.gain.setValueAtTime(quranWetSend.gain.value, now);
  quranWet.gain.linearRampToValueAtTime(wetTarget, now + durationSec);
  quranWetSend.gain.linearRampToValueAtTime(sendTarget, now + durationSec);

  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
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
    playSurah(next, { fadeIn: true }).catch((err) => setState({ error: err.message }));
  });
  audio.addEventListener('error', () => {
    if (!sessionActive) return;
    setState({ error: 'Playback failed' });
  });

  return audio;
}

async function playSurah(chapter, { fadeIn = false, fadeMs = FADE_MS } = {}) {
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
  if (fadeIn) await fadeQuranVolume(QURAN_VOLUME, fadeMs);

  setState({
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

async function resumeQuran(fadeMs = FADE_MS) {
  const player = ensureAudio();
  if (player.src && !player.ended) {
    await ensureQuranGraph(player);
    setReverbBypass(false);
    setQuranLevel(0);
    await player.play();
    await fadeQuranVolume(QURAN_VOLUME, fadeMs);
    setState({ surahName: surahName(state.surah), reciterName: RECITER_NAME });
    return;
  }
  await playSurah(state.surah ?? pickNextSurah(), { fadeIn: true, fadeMs });
}

export function canGestureStartQuran() {
  return !sessionActive && !sessionUnlocked && !userPaused && !syncing && !intentPlaying;
}

async function startSession({ fadeMs = FADE_MS } = {}) {
  setState({ loading: true, error: null });
  const fadeSec = fadeMs / 1000;

  if (!QURAN_ENABLED) {
    const started = await fadeMeccaAmbienceIn(fadeSec);
    sessionActive = started;
    sessionUnlocked = started || sessionUnlocked;
    setState({ playing: started, unlocked: sessionUnlocked, loading: false });
    if (!started) stopMeccaAmbience();
    return started;
  }

  if (!ready) await initQuranPlayer();

  const [ambienceResult, quranResult] = await Promise.allSettled([
    fadeMeccaAmbienceIn(fadeSec),
    state.surah ? resumeQuran(fadeMs) : playSurah(pickNextSurah(), { fadeIn: true, fadeMs }),
  ]);

  const started = quranResult.status === 'fulfilled';
  if (!intentPlaying) {
    sessionActive = false;
    if (audio && !audio.paused) audio.pause();
    stopMeccaAmbience();
    setState({ playing: false, unlocked: sessionUnlocked, loading: false });
    return false;
  }

  if (!started) {
    intentPlaying = false;
    sessionActive = false;
    stopMeccaAmbience();
    setState({
      playing: false,
      unlocked: sessionUnlocked,
      loading: false,
      error: 'Tap to start',
    });
    return false;
  }

  sessionActive = true;
  sessionUnlocked = true;
  userPaused = false;
  setState({
    playing: true,
    unlocked: true,
    loading: false,
    error: null,
  });

  if (ambienceResult.status !== 'fulfilled') {
    fadeMeccaAmbienceIn(fadeSec).catch(() => {});
  }

  return true;
}

async function applyPlaybackIntent(opts = {}) {
  if (syncing) return;
  syncing = true;
  try {
    while (true) {
      if (intentPlaying && !sessionActive) {
        const ok = await startSession(opts);
        if (!ok) {
          intentPlaying = false;
          break;
        }
        continue;
      }
      if (!intentPlaying && sessionActive) {
        await pauseMediaSession();
        continue;
      }
      break;
    }
  } finally {
    syncing = false;
  }
}

export async function resumeMediaSession(opts = {}) {
  intentPlaying = true;
  userPaused = false;
  await applyPlaybackIntent(opts);
  return sessionActive;
}

export async function pauseMediaSession() {
  if (!sessionActive && !intentPlaying) return;
  sessionActive = false;
  intentPlaying = false;
  userPaused = true;
  setState({ playing: false, unlocked: sessionUnlocked, loading: false });

  const jobs = [fadeMeccaAmbienceOut()];

  if (audio && !audio.paused) {
    jobs.push(
      (async () => {
        await ensureQuranGraph(audio);
        await Promise.all([
          fadeQuranReverb(0, 0, REVERB_FADE_OUT_MS),
          fadeQuranVolume(0, 180),
        ]);
        audio.pause();
      })()
    );
  } else if (quranCtx) {
    setReverbBypass(true);
    setQuranLevel(0);
  } else {
    stopMeccaAmbience();
  }

  await Promise.allSettled(jobs);
}

export async function startMediaSession(opts) {
  return resumeMediaSession(opts);
}

export async function startQuranPlayback(opts) {
  return resumeMediaSession(opts);
}

export async function playQuran(opts) {
  return resumeMediaSession(opts);
}

export function stopQuran() {
  return pauseMediaSession();
}

export async function toggleQuran() {
  const heardAsOn = sessionActive || intentPlaying;
  intentPlaying = !heardAsOn;
  userPaused = !intentPlaying;
  await applyPlaybackIntent();
}

export function destroyQuranPlayer() {
  sessionActive = false;
  sessionUnlocked = false;
  userPaused = false;
  intentPlaying = false;
  syncing = false;
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
    unlocked: false,
    error: null,
  });
}
