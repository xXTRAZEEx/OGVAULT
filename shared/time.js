const WEEKDAYS = 7;

export function safeTimeZone(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const zone = String(raw || '').trim();
  if (!zone || zone.length > 80) return null;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return zone;
  } catch {
    return null;
  }
}

function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  let hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
    const rolled = addCalendarDays(year, month, day, 1);
    year = rolled.year;
    month = rolled.month;
    day = rolled.day;
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function addCalendarDays(year, month, day, days) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function timeZoneOffsetMs(ms, timeZone) {
  const parts = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall;
  for (let i = 0; i < 4; i += 1) {
    const next = wall - timeZoneOffsetMs(utc, timeZone);
    if (next === utc) return next;
    utc = next;
  }
  return utc;
}

function civilWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function nextSundayMidnight(ms, timeZone) {
  const parts = zonedParts(ms, timeZone);
  const dow = civilWeekday(parts.year, parts.month, parts.day);
  let add = (WEEKDAYS - dow) % WEEKDAYS;
  if (add === 0) add = WEEKDAYS;
  const next = addCalendarDays(parts.year, parts.month, parts.day, add);
  return zonedTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
}

export function localWeek(ms, timeZone) {
  const parts = zonedParts(ms, timeZone);
  const dow = civilWeekday(parts.year, parts.month, parts.day);
  const prev = addCalendarDays(parts.year, parts.month, parts.day, -dow);
  const start = zonedTimeToUtc(prev.year, prev.month, prev.day, 0, 0, 0, timeZone);
  const endsAt = nextSundayMidnight(ms, timeZone);
  return { start, endsAt };
}

export function localDay(ms, timeZone) {
  const parts = zonedParts(ms, timeZone);
  const start = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
  const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
  return { start, endsAt: zonedTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone) };
}

export function localMonth(ms, timeZone) {
  const parts = zonedParts(ms, timeZone);
  const start = zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, timeZone);
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  return { start, endsAt: zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, 0, timeZone) };
}

export function calendarWindow(period, timeZone, now = Date.now()) {
  if (period === 'daily') return localDay(now, timeZone);
  if (period === 'weekly') return localWeek(now, timeZone);
  if (period === 'monthly') return localMonth(now, timeZone);
  return null;
}
