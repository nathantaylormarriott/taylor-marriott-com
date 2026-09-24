import { DateTime } from 'luxon';
import { getDiscoverySettings } from './_shared/discoverySettings.js';
import { fetchBusyPeriods } from './_shared/googleCalendar.js';
import { filterBusySlots, generateCandidateSlots } from './_shared/slots.js';
import { handleOptions, jsonResponse } from './_shared/http.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const settings = getDiscoverySettings();
  if (!settings.calendarConfigured) {
    return jsonResponse(request, { error: 'Booking is not configured' }, 503);
  }

  const url = new URL(request.url);
  const daysParam = url.searchParams.get('days');
  const days = daysParam
    ? Math.min(Math.max(Number.parseInt(daysParam, 10) || settings.horizonDays, 1), settings.horizonDays)
    : Math.min(7, settings.horizonDays);

  const rangeStart = DateTime.now().setZone(settings.timezone);
  const rangeEnd = rangeStart.plus({ days });

  try {
    const candidates = generateCandidateSlots(settings, rangeStart, rangeEnd);
    const busy = await fetchBusyPeriods(
      rangeStart.toUTC().toISO(),
      rangeEnd.toUTC().toISO(),
    );
    const slots = filterBusySlots(candidates, busy);

    return jsonResponse(
      request,
      {
        timezone: settings.timezone,
        slotMinutes: settings.slotMinutes,
        horizonDays: settings.horizonDays,
        daysLoaded: days,
        slots,
      },
      200,
      {
        'Cache-Control': 'public, max-age=45, stale-while-revalidate=120',
      },
    );
  } catch (err) {
    console.error('[discovery-availability]', err);
    return jsonResponse(request, { error: 'Could not load availability' }, 500);
  }
};

export const config = {
  path: '/api/discovery/availability',
};
