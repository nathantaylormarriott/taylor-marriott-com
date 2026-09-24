import { DateTime } from 'luxon';
import { getDiscoverySettings } from './_shared/discoverySettings.js';
import { createDiscoveryEvent, fetchBusyPeriods } from './_shared/googleCalendar.js';
import { filterBusySlots, generateCandidateSlots, isValidSlotStart } from './_shared/slots.js';
import { handleOptions, jsonResponse } from './_shared/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const settings = getDiscoverySettings();
  if (!settings.calendarConfigured) {
    return jsonResponse(request, { error: 'Booking is not configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid JSON body' }, 400);
  }

  if (body.company_website) {
    return jsonResponse(request, { ok: true });
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  const company = String(body.company || '').trim();
  const start = String(body.start || '').trim();

  if (!name || name.length > 120) {
    return jsonResponse(request, { error: 'Please enter your name' }, 400);
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return jsonResponse(request, { error: 'Please enter a valid email' }, 400);
  }
  if (!start || !isValidSlotStart(start, settings)) {
    return jsonResponse(request, { error: 'That time is no longer available' }, 400);
  }

  const end = DateTime.fromISO(start, { zone: 'utc' })
    .plus({ minutes: settings.slotMinutes })
    .toUTC()
    .toISO();

  try {
    const rangeStart = DateTime.fromISO(start, { zone: 'utc' }).minus({ hours: 1 });
    const rangeEnd = DateTime.fromISO(end, { zone: 'utc' }).plus({ hours: 1 });
    const busy = await fetchBusyPeriods(rangeStart.toUTC().toISO(), rangeEnd.toUTC().toISO());
    const stillFree = filterBusySlots([{ start, end }], busy);
    if (!stillFree.length) {
      return jsonResponse(request, { error: 'That time was just taken — pick another slot' }, 409);
    }

    const event = await createDiscoveryEvent({
      start,
      end,
      name,
      email,
      message,
      company,
    });

    return jsonResponse(request, {
      ok: true,
      start,
      end,
      meetLink: event.meetLink,
      calendarLink: event.htmlLink,
    });
  } catch (err) {
    console.error('[discovery-book]', err);
    return jsonResponse(request, { error: 'Could not complete booking' }, 500);
  }
};

export const config = {
  path: '/api/discovery/book',
};
