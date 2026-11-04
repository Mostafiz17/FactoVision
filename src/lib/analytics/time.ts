/**
 * Calendar and time-zone arithmetic for analytics (pure, no IO).
 *
 * Boundaries are local calendar days in an IANA time zone. Offsets come from
 * Intl, so daylight-saving transitions follow the runtime's tz database: a
 * spring-forward day is 23 hours long, a fall-back day is 25 hours long.
 *
 * Every window is half-open: [start, endExclusive). An instant t belongs to the
 * window when start <= t < endExclusive AND t <= asOf (replay cutoff).
 */

export const DAY_MS = 86_400_000;
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 366;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Throws RangeError for any string that is not a known IANA zone (e.g. "UTC", "Europe/Berlin"). */
export function assertTimeZone(timeZone: string): string {
  try {
    formatter(timeZone);
  } catch {
    throw new RangeError(`Unknown IANA time zone: ${timeZone}`);
  }
  return timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    assertTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (positive east of UTC). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function formatKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Calendar date ("YYYY-MM-DD") of `instant` as seen on the wall clock of `timeZone`. */
export function localDayKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return formatKey(p.year, p.month, p.day);
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const m = DAY_KEY.exec(key);
  if (!m) throw new RangeError(`Invalid day key: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Invalid day key: ${key}`);
  }
  return { year, month, day };
}

/** Calendar arithmetic on day keys (no time zone involved). */
export function addDays(key: string, delta: number): string {
  const { year, month, day } = parseDayKey(key);
  const t = new Date(Date.UTC(year, month - 1, day + delta));
  return formatKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function dayKeysBetween(startKey: string, endKey: string): string[] {
  if (startKey > endKey) throw new RangeError(`Day range is reversed: ${startKey} > ${endKey}`);
  const keys: string[] = [];
  for (let k = startKey; k <= endKey; k = addDays(k, 1)) keys.push(k);
  return keys;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** ISO-style week key: the Monday on or before `key`. Weeks start Monday. */
export function weekStartKey(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7));
}

/**
 * The first instant of local calendar day `key` in `timeZone`.
 * Two correction passes resolve offsets that change across the day boundary.
 * If local midnight does not exist (a zone that skips midnight), the result is
 * the first instant of that wall-clock day as the zone reports it.
 */
export function startOfLocalDay(key: string, timeZone: string): Date {
  const { year, month, day } = parseDayKey(key);
  const naive = Date.UTC(year, month - 1, day);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const secondGuess = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(secondGuess);
}

export interface AnalysisWindow {
  timeZone: string;
  days: number;
  asOf: Date;
  startDay: string;
  endDay: string;
  dayKeys: string[];
  start: Date;
  endExclusive: Date;
}

/** Window = the `days` local calendar days ending on the day that contains `asOf`. */
export function buildWindow(asOf: Date, timeZone: string, days: number): AnalysisWindow {
  if (Number.isNaN(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  if (!Number.isInteger(days) || days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
    throw new RangeError(`days must be an integer between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS}`);
  }
  assertTimeZone(timeZone);
  const endDay = localDayKey(asOf, timeZone);
  const startDay = addDays(endDay, -(days - 1));
  return {
    timeZone,
    days,
    asOf,
    startDay,
    endDay,
    dayKeys: dayKeysBetween(startDay, endDay),
    start: startOfLocalDay(startDay, timeZone),
    endExclusive: startOfLocalDay(addDays(endDay, 1), timeZone),
  };
}

/** Window membership for an event/instant, including the replay cutoff. */
export function inWindow(window: AnalysisWindow, instant: Date): boolean {
  const t = instant.getTime();
  return t >= window.start.getTime() && t < window.endExclusive.getTime() && t <= window.asOf.getTime();
}

/** Elapsed fractional days between two instants (0 if reversed). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}
