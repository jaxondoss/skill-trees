import type { DayKey } from "./types";

const MS_PER_DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The day an instant belongs to. Before the rollover hour (local wall time), work
 * still counts for the previous day: 1:30 AM with a 4 AM rollover is yesterday.
 */
export function dayKey(instant: Date, timeZone: string, rolloverHour: number): DayKey {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const local: DayKey = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < rolloverHour ? addDays(local, -1) : local;
}

function toUtcMs(day: DayKey): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: DayKey, n: number): DayKey {
  return fromUtcMs(toUtcMs(day) + n * MS_PER_DAY);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: DayKey): number {
  return new Date(toUtcMs(day)).getUTCDay();
}

/** Monday of the week containing day. */
export function weekStart(day: DayKey): DayKey {
  return addDays(day, -((weekday(day) + 6) % 7));
}
