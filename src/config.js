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

/** Quran playback + header toggle on /for-muslims. */
export const QURAN_ENABLED = true;

export const CLIENT_PORTAL_URL = 'https://portal.taylor-marriott.com';

/** Client portal gate — simple download unlock (not hardened auth). */
export const PORTAL = {
  username: 'guy',
  password: 'esxbgt2026',
  downloadUrl: '/downloads/ES-x-BGT.zip',
  downloadName: 'ES x BGT.zip',
};

/** Public contact channels — update phone/whatsapp with your business numbers. */
export const CONTACT = {
  email: 'hello@taylor-marriott.com',
  phone: '+447831798112',
  whatsapp: '447831798112',
};

/** Discovery sessions — availability + booking via /api/discovery (Google Calendar API). */
export const DISCOVERY_BOOKING = {
  durationMinutes: Number(import.meta.env.VITE_DISCOVERY_SLOT_MINUTES) || 30,
};

export const SCENE_THEMES = {
  home: {
    nebula: { colorA: '#FF4D9D', colorB: '#46E5FF', intensity: 0.24 },
  },
  contact: {
    nebula: { colorA: '#C4A1FF', colorB: '#5CE1B8', intensity: 0.26 },
  },
  muslims: {
    nebula: { colorA: '#1F9D6A', colorB: '#D4AF37', intensity: 0.25 },
  },
};
