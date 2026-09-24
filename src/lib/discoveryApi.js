const CONFIG_URL = '/api/discovery/config';
const AVAILABILITY_URL = '/api/discovery/availability';
const BOOK_URL = '/api/discovery/book';

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || 'Something went wrong';
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

export async function fetchDiscoveryConfig() {
  const response = await fetch(CONFIG_URL);
  return parseJson(response);
}

const INITIAL_AVAILABILITY_DAYS = 7;

export async function fetchDiscoveryAvailability(days = INITIAL_AVAILABILITY_DAYS) {
  const response = await fetch(`${AVAILABILITY_URL}?days=${days}`);
  return parseJson(response);
}

export { INITIAL_AVAILABILITY_DAYS };

export async function bookDiscoverySession(payload) {
  const response = await fetch(BOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export function formatSlotLabel(iso, timezone) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${day}, ${time}`;
}

export function formatSlotTime(iso, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDayChip(iso, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

export function slotDayKey(iso, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function formatDayHeading(iso, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso));
}
