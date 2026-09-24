import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { getDiscoverySettings } from './discoverySettings.js';

function toCalendarDateTime(isoUtc, timezone) {
  return DateTime.fromISO(isoUtc, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

async function getAuth(settings) {
  if (settings.serviceAccountJson) {
    const creds = JSON.parse(settings.serviceAccountJson);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject: settings.impersonateEmail || undefined,
    });
    await auth.authorize();
    return auth;
  }

  if (settings.clientId && settings.clientSecret && settings.refreshToken) {
    const auth = new google.auth.OAuth2(settings.clientId, settings.clientSecret);
    auth.setCredentials({ refresh_token: settings.refreshToken });
    return auth;
  }

  throw new Error('Google Calendar credentials are not configured');
}

let cachedClient = null;
let cachedClientKey = '';

export async function getCalendarClient() {
  const settings = getDiscoverySettings();
  if (!settings.calendarConfigured) {
    throw new Error('Discovery booking is not configured');
  }

  const cacheKey = [
    settings.calendarId,
    settings.refreshToken,
    settings.serviceAccountJson,
    settings.impersonateEmail,
  ].join('|');

  if (cachedClient && cachedClientKey === cacheKey) {
    return cachedClient;
  }

  const auth = await getAuth(settings);
  const calendar = google.calendar({ version: 'v3', auth });
  cachedClient = { calendar, settings };
  cachedClientKey = cacheKey;
  return cachedClient;
}

export async function fetchBusyPeriods(timeMin, timeMax) {
  const { calendar, settings } = await getCalendarClient();
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: settings.timezone,
      items: [{ id: settings.calendarId }],
    },
  });

  const calBusy = response.data.calendars?.[settings.calendarId]?.busy || [];
  return calBusy.map((b) => ({ start: b.start, end: b.end }));
}

export async function createDiscoveryEvent({
  start,
  end,
  name,
  email,
  message,
  company,
}) {
  const { calendar, settings } = await getCalendarClient();
  const requestId = randomUUID();

  const descriptionParts = [
    'Discovery session booked via taylor-marriott.com',
    company ? `Company: ${company}` : null,
    message ? `\n${message}` : null,
  ].filter(Boolean);

  const response = await calendar.events.insert({
    calendarId: settings.calendarId,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: {
      summary: `Discovery call — ${name}`,
      description: descriptionParts.join('\n'),
      start: {
        dateTime: toCalendarDateTime(start, settings.timezone),
        timeZone: settings.timezone,
      },
      end: {
        dateTime: toCalendarDateTime(end, settings.timezone),
        timeZone: settings.timezone,
      },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const meetLink =
    response.data.hangoutLink ||
    response.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    null;

  return {
    eventId: response.data.id,
    meetLink,
    htmlLink: response.data.htmlLink,
  };
}
