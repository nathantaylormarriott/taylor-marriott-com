/** Distant mosque swift ambience — bioacoustic Web Audio synthesis. */

const MASTER_GAIN = 1.32;
const CLOSE_PEAK = 0.1;
const MID_PEAK = 0.061;
const FAR_PEAK = 0.034;
const MAX_VOICES = 3;
const WET_IDLE = 0.2;
const WET_DUCKED = 0.11;
const FLYOVER_STEPS = 10;
const FADE_SEC = 0.55;

let audioCtx = null;
let isPlaying = false;
let swiftTimer = null;
let reverbNode = null;
let masterGain = null;
let dryGain = null;
let wetGain = null;
let compressor = null;
let unlockBound = false;
let noiseBuffer = null;
let activeVoices = 0;
let windBedNodes = [];

function easeCos(u) {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
}

function closeness(u) {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
}

function dopplerFactor(u) {
  return 1 + 0.048 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
}

function contourHz(u, startHz, peakHz, endHz) {
  if (u < 0.44) {
    const t = u / 0.44;
    return startHz * Math.pow(peakHz / startHz, t);
  }
  const t = (u - 0.44) / 0.56;
  return peakHz * Math.pow(Math.max(1, endHz) / peakHz, t);
}

function envelope(u) {
  if (u < 0.045) return Math.max(0.0001, u / 0.045);
  if (u > 0.82) return Math.max(0.0001, (1 - u) / 0.18);
  return 1;
}

function createGrandCourtyardReverb(ctx) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 1.85);
  const impulse = ctx.createBuffer(2, len, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const early = t < 0.04 ? 0.38 : 1;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 4.6) * early;
    }
  }

  const node = ctx.createConvolver();
  node.buffer = impulse;
  return node;
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.97 + white * 0.03;
    data[i] = white * 0.35 + last * 0.65;
  }
  noiseBuffer = buffer;
  return noiseBuffer;
}

function setupListener(ctx) {
  const listener = ctx.listener;
  const now = ctx.currentTime;
  if (listener.positionX) {
    listener.positionX.setValueAtTime(0, now);
    listener.positionY.setValueAtTime(1.6, now);
    listener.positionZ.setValueAtTime(0, now);
    listener.forwardX.setValueAtTime(0, now);
    listener.forwardY.setValueAtTime(0, now);
    listener.forwardZ.setValueAtTime(-1, now);
    listener.upX.setValueAtTime(0, now);
    listener.upY.setValueAtTime(1, now);
    listener.upZ.setValueAtTime(0, now);
  } else if (listener.setPosition) {
    listener.setPosition(0, 1.6, 0);
    listener.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

function setupEnvironment(ctx) {
  setupListener(ctx);

  masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(MASTER_GAIN, ctx.currentTime + 2.4);

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, ctx.currentTime);
  compressor.knee.setValueAtTime(14, ctx.currentTime);
  compressor.ratio.setValueAtTime(3.4, ctx.currentTime);
  compressor.attack.setValueAtTime(0.006, ctx.currentTime);
  compressor.release.setValueAtTime(0.22, ctx.currentTime);

  dryGain = ctx.createGain();
  dryGain.gain.setValueAtTime(0.88, ctx.currentTime);

  wetGain = ctx.createGain();
  wetGain.gain.setValueAtTime(WET_IDLE, ctx.currentTime);

  reverbNode = createGrandCourtyardReverb(ctx);

  dryGain.connect(masterGain);
  reverbNode.connect(wetGain);
  wetGain.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);
}

function connectVoice(node, dryAmount) {
  const drySend = audioCtx.createGain();
  const wetSend = audioCtx.createGain();
  drySend.gain.value = dryAmount;
  wetSend.gain.value = Math.max(0.1, 0.42 - dryAmount * 0.28);
  node.connect(drySend);
  node.connect(wetSend);
  drySend.connect(dryGain);
  wetSend.connect(reverbNode);
}

function setPannerPos(panner, x, y, z, time, ramp) {
  if (panner.positionX) {
    if (ramp) {
      panner.positionX.linearRampToValueAtTime(x, time);
      panner.positionY.linearRampToValueAtTime(y, time);
      panner.positionZ.linearRampToValueAtTime(z, time);
    } else {
      panner.positionX.setValueAtTime(x, time);
      panner.positionY.setValueAtTime(y, time);
      panner.positionZ.setValueAtTime(z, time);
    }
    return;
  }
  if (panner.setPosition) panner.setPosition(x, y, z);
}

function updateReverbDuck() {
  if (!wetGain || !audioCtx) return;
  const t = audioCtx.currentTime;
  const target = activeVoices >= 2 ? WET_DUCKED : WET_IDLE;
  wetGain.gain.cancelScheduledValues(t);
  wetGain.gain.setTargetAtTime(target, t, 0.09);
}

function acquireVoice() {
  if (activeVoices >= MAX_VOICES) return false;
  activeVoices += 1;
  updateReverbDuck();
  return true;
}

function releaseVoice(afterSec) {
  window.setTimeout(() => {
    activeVoices = Math.max(0, activeVoices - 1);
    updateReverbDuck();
  }, Math.max(50, afterSec * 1000));
}

function startWindBed() {
  if (!audioCtx || windBedNodes.length) return;

  const noise = getNoiseBuffer(audioCtx);
  const now = audioCtx.currentTime;

  const windSrc = audioCtx.createBufferSource();
  windSrc.buffer = noise;
  windSrc.loop = true;

  const windBp = audioCtx.createBiquadFilter();
  windBp.type = 'bandpass';
  windBp.frequency.value = 1650;
  windBp.Q.value = 0.55;

  const windGain = audioCtx.createGain();
  windGain.gain.setValueAtTime(0.0001, now);
  windGain.gain.exponentialRampToValueAtTime(0.0072, now + 4);

  const windLfo = audioCtx.createOscillator();
  windLfo.type = 'sine';
  windLfo.frequency.value = 0.07 + Math.random() * 0.04;
  const windLfoDepth = audioCtx.createGain();
  windLfoDepth.gain.value = 0.0026;
  windLfo.connect(windLfoDepth);
  windLfoDepth.connect(windGain.gain);

  windSrc.connect(windBp);
  windBp.connect(windGain);
  connectVoice(windGain, 0.68);

  windSrc.start(now);
  windLfo.start(now);
  windBedNodes = [windSrc, windLfo];
}

function stopWindBed() {
  windBedNodes.forEach((node) => {
    try { node.stop(); } catch { /* already stopped */ }
  });
  windBedNodes = [];
}

function makeTrajectory() {
  const fromLeft = Math.random() < 0.5;
  return {
    fromLeft,
    span: 5.6 + Math.random() * 2.4,
    height: 2.5 + Math.random() * 1.8,
    zFar: 4.6 + Math.random() * 2,
    zNear: 1.35 + Math.random() * 1.15,
  };
}

function positionAt(traj, u) {
  const e = easeCos(u);
  const x0 = traj.fromLeft ? -traj.span : traj.span;
  const x1 = traj.fromLeft ? traj.span : -traj.span;
  return {
    x: x0 + (x1 - x0) * e,
    y: traj.height,
    z: traj.zFar + (traj.zNear - traj.zFar) * closeness(u),
  };
}

function createHrtfPanner() {
  const panner = audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 28;
  panner.rolloffFactor = 0.32;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  if (panner.orientationX) {
    panner.orientationX.value = 0;
    panner.orientationY.value = 0;
    panner.orientationZ.value = -1;
  }
  return panner;
}

function createSwiftScream(time, opts) {
  const {
    startHz,
    peakHz,
    endHz,
    duration,
    peak,
    dryAmount,
    brightness,
    trajectory,
    countVoice = true,
  } = opts;

  if (countVoice && !acquireVoice()) return false;

  const traj = trajectory || makeTrajectory();
  const panner = createHrtfPanner();
  const air = audioCtx.createBiquadFilter();
  air.type = 'highpass';
  air.Q.setValueAtTime(0.65, time);

  const distanceLp = audioCtx.createBiquadFilter();
  distanceLp.type = 'lowpass';
  distanceLp.Q.setValueAtTime(0.7, time);

  const band = audioCtx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.setValueAtTime(6.4, time);

  const voiceGain = audioCtx.createGain();
  const carrier = audioCtx.createOscillator();
  carrier.type = 'sawtooth';
  const modulator = audioCtx.createOscillator();
  modulator.type = 'sine';
  const modHz = 72 + Math.random() * 55;
  const modDepth = audioCtx.createGain();
  modDepth.gain.setValueAtTime(18 + Math.random() * 22, time);

  const harmonic = audioCtx.createOscillator();
  harmonic.type = 'triangle';
  const harmonicGain = audioCtx.createGain();
  harmonicGain.gain.setValueAtTime(0.22, time);

  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer(audioCtx);
  noise.loop = true;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.Q.setValueAtTime(4.2, time);
  const noiseGain = audioCtx.createGain();

  modulator.connect(modDepth);
  modDepth.connect(carrier.frequency);
  carrier.connect(band);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(band);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(band);
  band.connect(air);
  air.connect(distanceLp);
  distanceLp.connect(voiceGain);
  voiceGain.connect(panner);
  connectVoice(panner, dryAmount);

  for (let i = 0; i <= FLYOVER_STEPS; i++) {
    const u = i / FLYOVER_STEPS;
    const t = time + duration * u;
    const pos = positionAt(traj, u);
    const close = closeness(u);
    const dop = dopplerFactor(u);
    const hz = contourHz(u, startHz, peakHz, endHz) * dop;
    const gain = Math.max(0.0001, peak * (0.2 + 0.8 * close) * envelope(u));
    const lpHz = 1500 + close * 5400;
    const hpHz = brightness + (1 - close) * 420;
    const ramp = i > 0;

    setPannerPos(panner, pos.x, pos.y, pos.z, t, ramp);

    if (ramp) {
      carrier.frequency.linearRampToValueAtTime(hz, t);
      harmonic.frequency.linearRampToValueAtTime(hz * 1.01, t);
      band.frequency.linearRampToValueAtTime(hz, t);
      noiseFilter.frequency.linearRampToValueAtTime(hz * 0.92, t);
      distanceLp.frequency.linearRampToValueAtTime(lpHz, t);
      air.frequency.linearRampToValueAtTime(hpHz, t);
      voiceGain.gain.linearRampToValueAtTime(gain, t);
      noiseGain.gain.linearRampToValueAtTime(gain * 0.34, t);
    } else {
      setPannerPos(panner, pos.x, pos.y, pos.z, t, false);
      carrier.frequency.setValueAtTime(hz, t);
      harmonic.frequency.setValueAtTime(hz * 1.01, t);
      band.frequency.setValueAtTime(hz, t);
      noiseFilter.frequency.setValueAtTime(hz * 0.92, t);
      distanceLp.frequency.setValueAtTime(lpHz, t);
      air.frequency.setValueAtTime(hpHz, t);
      voiceGain.gain.setValueAtTime(gain, t);
      noiseGain.gain.setValueAtTime(gain * 0.34, t);
    }
  }

  modulator.frequency.setValueAtTime(modHz, time);
  modulator.frequency.exponentialRampToValueAtTime(modHz * 1.28, time + duration * 0.4);

  const stopAt = time + duration + 0.03;
  carrier.start(time);
  modulator.start(time);
  harmonic.start(time);
  noise.start(time);
  carrier.stop(stopAt);
  modulator.stop(stopAt);
  harmonic.stop(stopAt);
  noise.stop(stopAt);

  if (countVoice) releaseVoice(duration + 0.05);
  return true;
}

function birdDistance() {
  const roll = Math.random();
  const peakJitter = 0.78 + Math.random() * 0.4;
  if (roll < 0.1) {
    return {
      peak: CLOSE_PEAK * peakJitter,
      dryAmount: 0.86,
      brightness: 2100,
      startHz: 4300 + Math.random() * 500,
      peakHz: 6200 + Math.random() * 900,
    };
  }
  if (roll < 0.62) {
    return {
      peak: MID_PEAK * peakJitter,
      dryAmount: 0.62,
      brightness: 2500,
      startHz: 3900 + Math.random() * 450,
      peakHz: 5600 + Math.random() * 800,
    };
  }
  return {
    peak: FAR_PEAK * peakJitter,
    dryAmount: 0.34,
    brightness: 3000,
    startHz: 3500 + Math.random() * 400,
    peakHz: 5000 + Math.random() * 700,
  };
}

function playBirdPass(time, dist, trajectory) {
  const duration = 0.44 + Math.random() * 0.34;
  const endHz = dist.peakHz * (0.88 + Math.random() * 0.05);
  const traj = trajectory || makeTrajectory();

  return createSwiftScream(time, {
    startHz: dist.startHz,
    peakHz: dist.peakHz,
    endHz,
    duration,
    peak: dist.peak,
    dryAmount: dist.dryAmount,
    brightness: dist.brightness,
    trajectory: traj,
  });
}

function playKaabaFlyover() {
  if (!isPlaying || !audioCtx || audioCtx.state !== 'running') return;
  if (activeVoices >= MAX_VOICES) return;

  const now = audioCtx.currentTime;
  const roll = Math.random();
  const traj = makeTrajectory();

  if (roll < 0.7 || activeVoices >= MAX_VOICES - 1) {
    playBirdPass(now, birdDistance(), traj);
    return;
  }

  if (roll < 0.9) {
    playBirdPass(now, birdDistance(), traj);
    const stagger = 0.22 + Math.random() * 0.36;
    const follow = {
      ...makeTrajectory(),
      fromLeft: traj.fromLeft,
      height: traj.height + (Math.random() * 0.6 - 0.2),
    };
    playBirdPass(now + stagger, birdDistance(), follow);
    return;
  }

  const count = Math.min(3, MAX_VOICES - activeVoices);
  for (let i = 0; i < count; i++) {
    const t = now + i * (0.24 + Math.random() * 0.3);
    const drift = {
      ...traj,
      span: traj.span + (i - 1) * 0.45,
      height: traj.height + (i - 1) * 0.35,
    };
    playBirdPass(t, birdDistance(), drift);
  }
}

function nextFlyoverDelay() {
  const gap = Math.random();
  if (gap < 0.16) return 580 + Math.random() * 420;
  if (gap < 0.7) return 1250 + Math.random() * 1650;
  return 2650 + Math.random() * 2300;
}

function startFlockSimulation() {
  startWindBed();
  playKaabaFlyover();

  function loop() {
    if (!isPlaying) return;
    swiftTimer = setTimeout(() => {
      playKaabaFlyover();
      loop();
    }, nextFlyoverDelay());
  }
  loop();
}

export function isMeccaAmbiencePlaying() {
  return isPlaying;
}

export async function startMeccaAmbience() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    audioCtx = new Ctx();
    setupEnvironment(audioCtx);
  }

  try {
    await audioCtx.resume();
  } catch {
    return false;
  }

  if (audioCtx.state !== 'running') return false;

  if (!isPlaying) {
    isPlaying = true;
    startFlockSimulation();
  }
  return true;
}

export function bindMeccaAmbienceUnlock() {
  if (typeof window === 'undefined' || unlockBound) return () => {};
  unlockBound = true;

  const unlock = () => {
    startMeccaAmbience();
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    unlockBound = false;
  };
}

function waitMs(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

export function stopMeccaAmbience() {
  isPlaying = false;
  if (swiftTimer) {
    clearTimeout(swiftTimer);
    swiftTimer = null;
  }
  stopWindBed();
  activeVoices = 0;
}

export async function fadeMeccaAmbienceIn() {
  const started = await startMeccaAmbience();
  if (!started || !masterGain || !audioCtx) return false;
  const t = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(0.0001, t);
  masterGain.gain.exponentialRampToValueAtTime(MASTER_GAIN, t + FADE_SEC);
  return true;
}

export async function fadeMeccaAmbienceOut() {
  if (!masterGain || !audioCtx || !isPlaying) {
    stopMeccaAmbience();
    return;
  }
  const t = audioCtx.currentTime;
  const level = masterGain.gain.value;
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(level, t);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, t + FADE_SEC);
  await waitMs(FADE_SEC * 1000 + 40);
  stopMeccaAmbience();
}

export function destroyMeccaAmbience() {
  stopMeccaAmbience();
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  reverbNode = null;
  masterGain = null;
  dryGain = null;
  wetGain = null;
  compressor = null;
  noiseBuffer = null;
}
