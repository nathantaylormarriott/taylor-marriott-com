import { DateTime } from 'luxon';

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function generateCandidateSlots(settings, rangeStart, rangeEnd) {
  const {
    timezone,
    slotMinutes,
    hourStart,
    hourEnd,
    hourEndMinute,
    weekdays,
    minNoticeHours,
  } = settings;

  const slots = [];
  const minStart = DateTime.now().setZone(timezone).plus({ hours: minNoticeHours });
  let cursor = rangeStart.setZone(timezone).startOf('day');
  const lastDay = rangeEnd.setZone(timezone).startOf('day');

  while (cursor <= lastDay) {
    if (weekdays.includes(cursor.weekday)) {
      let slotStart = cursor.set({
        hour: hourStart,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      const dayEnd = cursor.set({
        hour: hourEnd,
        minute: hourEndMinute ?? 0,
        second: 0,
        millisecond: 0,
      });

      while (slotStart.plus({ minutes: slotMinutes }) <= dayEnd) {
        const slotEnd = slotStart.plus({ minutes: slotMinutes });
        if (slotStart >= minStart && slotStart >= rangeStart && slotEnd <= rangeEnd.plus({ days: 1 })) {
          slots.push({
            start: slotStart.toUTC().toISO(),
            end: slotEnd.toUTC().toISO(),
          });
        }
        slotStart = slotStart.plus({ minutes: slotMinutes });
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  return slots;
}

export function filterBusySlots(slots, busyPeriods) {
  if (!busyPeriods.length) return slots;

  return slots.filter((slot) => {
    const slotStart = DateTime.fromISO(slot.start).toMillis();
    const slotEnd = DateTime.fromISO(slot.end).toMillis();
    return !busyPeriods.some((busy) => {
      const busyStart = DateTime.fromISO(busy.start).toMillis();
      const busyEnd = DateTime.fromISO(busy.end).toMillis();
      return overlaps(slotStart, slotEnd, busyStart, busyEnd);
    });
  });
}

export function isValidSlotStart(isoStart, settings) {
  const start = DateTime.fromISO(isoStart, { zone: 'utc' });
  if (!start.isValid) return false;

  const end = start.plus({ minutes: settings.slotMinutes });
  const rangeStart = DateTime.now().setZone(settings.timezone);
  const rangeEnd = rangeStart.plus({ days: settings.horizonDays });

  const candidates = generateCandidateSlots(
    settings,
    rangeStart,
    rangeEnd,
  );

  return candidates.some((s) => s.start === start.toUTC().toISO() && s.end === end.toUTC().toISO());
}
