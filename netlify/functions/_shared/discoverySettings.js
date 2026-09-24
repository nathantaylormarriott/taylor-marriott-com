function envGet(key) {
  return process.env[key] ?? '';
}

function parseIntEnv(key, fallback) {
  const raw = envGet(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseWeekdays(raw) {
  if (!raw) return [1, 2, 3, 4, 5, 6, 7];
  return raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7);
}

export function getDiscoverySettings() {
  const calendarId = envGet('GOOGLE_CALENDAR_ID').trim();
  const serviceAccountJson = envGet('GOOGLE_SERVICE_ACCOUNT_JSON').trim();
  const clientId = envGet('GOOGLE_OAUTH_CLIENT_ID').trim();
  const clientSecret = envGet('GOOGLE_OAUTH_CLIENT_SECRET').trim();
  const refreshToken = envGet('GOOGLE_OAUTH_REFRESH_TOKEN').trim();
  const impersonateEmail = envGet('GOOGLE_CALENDAR_IMPERSONATE').trim();

  const hasServiceAccount = serviceAccountJson.length > 0;
  const hasOAuth = clientId && clientSecret && refreshToken;
  const calendarConfigured = Boolean(calendarId && (hasServiceAccount || hasOAuth));

  return {
    calendarId,
    serviceAccountJson,
    clientId,
    clientSecret,
    refreshToken,
    impersonateEmail,
    calendarConfigured,
    timezone: (envGet('DISCOVERY_TIMEZONE') || 'Europe/London').trim(),
    slotMinutes: parseIntEnv('DISCOVERY_SLOT_MINUTES', 30),
    hourStart: parseIntEnv('DISCOVERY_HOUR_START', 9),
    hourEnd: parseIntEnv('DISCOVERY_HOUR_END', 21),
    hourEndMinute: parseIntEnv('DISCOVERY_HOUR_END_MINUTE', 30),
    weekdays: parseWeekdays(envGet('DISCOVERY_WEEKDAYS')),
    minNoticeHours: parseIntEnv('DISCOVERY_MIN_NOTICE_HOURS', 4),
    horizonDays: parseIntEnv('DISCOVERY_HORIZON_DAYS', 28),
  };
}

export function getPublicDiscoveryConfig(settings = getDiscoverySettings()) {
  return {
    enabled: settings.calendarConfigured,
    slotMinutes: settings.slotMinutes,
    timezone: settings.timezone,
    hourStart: settings.hourStart,
    hourEnd: settings.hourEnd,
    horizonDays: settings.horizonDays,
  };
}
