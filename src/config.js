export const CONFIG = {
  scrollWeight: 1.7,
  scrollEasing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  ease: 'power3.out',
  easeLong: 'expo.out',
  stars: { desktop: 6000, mobile: 6000 },
  scrollFactor: 0.18,
  transitionScroll: 720,
  transitionDuration: 1.15,
  transitionNebulaZoom: 2.2,
};

/** Set to true to restore portfolio, arrival, closing, and footer on the home page. */
export const HOME_BELOW_HERO = false;

export const CLIENT_PORTAL_URL = 'https://portal.taylor-marriott.com';

export const SCENE_THEMES = {
  home: {
    nebula: { colorA: '#FF4D9D', colorB: '#46E5FF', intensity: 0.38 },
  },
  contact: {
    nebula: { colorA: '#C4A1FF', colorB: '#5CE1B8', intensity: 0.42 },
  },
};
