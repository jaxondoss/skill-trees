import "server-only";
import { googleConfigured, type CalendarEvent } from "@/integrations/googleCalendar";
import { addDays } from "@/engine/time";
import type { createClient } from "@/lib/supabase/server";
import { loadCalendarEvents } from "./googleCalendar";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** One day on the calendar wall: FORGE completion (closed days and today) and what was logged. */
export type WallDay = { p: number | null; logged: { name: string; tier: string }[] };
export type WallMonth = { days: Record<string, WallDay>; events: CalendarEvent[]; connected: boolean };

/** The month key ("2026-10") of a day key, and the days the 6 x 7 grid shows around that month. */
export function gridRange(month: string): { from: string; to: string } {
  const first = new Date(`${month}-01T00:00:00Z`);
  const from = addDays(`${month}-01`, -first.getUTCDay());
  return { from, to: addDays(from, 41) };
}

export function isMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/**
 * Everything the wall needs for one month: completion per day (the cached daily_completions, with today's live
 * value), the goals logged each day (skill name and tier), and the Google events of the grid's six weeks.
 */
export async function loadWallMonth(
  supabase: Supabase,
  month: string,
  opts: { today: string; todayP: number | null; timeZone: string },
): Promise<WallMonth> {
  const { from, to } = gridRange(month);
  const [compRes, goalRes, google] = await Promise.all([
    supabase.from("daily_completions").select("day, p").gte("day", from).lte("day", to),
    supabase
      .from("plan_goals")
      .select("result_tier, skills(name), daily_plans!inner(day)")
      .gte("daily_plans.day", from)
      .lte("daily_plans.day", to)
      .not("result_tier", "is", null),
    loadCalendarEvents(supabase, { timeMin: `${from}T00:00:00Z`, timeMax: `${addDays(to, 2)}T00:00:00Z`, timeZone: opts.timeZone }),
  ]);
  const days: Record<string, WallDay> = {};
  const get = (d: string) => (days[d] ??= { p: null, logged: [] });
  for (const r of (compRes.data ?? []) as { day: string; p: number }[]) if (r.day < opts.today) get(r.day).p = Math.round(Number(r.p));
  if (opts.todayP !== null && opts.today >= from && opts.today <= to) get(opts.today).p = Math.round(opts.todayP);
  type GoalRow = { result_tier: string; skills: { name: string } | { name: string }[] | null; daily_plans: { day: string } | { day: string }[] };
  for (const g of (goalRes.data ?? []) as unknown as GoalRow[]) {
    const day = Array.isArray(g.daily_plans) ? g.daily_plans[0]?.day : g.daily_plans?.day;
    const skill = Array.isArray(g.skills) ? g.skills[0] : g.skills;
    if (day && skill) get(day).logged.push({ name: skill.name, tier: g.result_tier });
  }
  return { days, events: google.events, connected: google.connected };
}

/** The calendar wall block of the room's data: the current month loaded, other months on demand. */
export async function loadCalendarWall(supabase: Supabase, opts: { today: string; todayP: number | null; timeZone: string }) {
  const month = opts.today.slice(0, 7);
  const m = await loadWallMonth(supabase, month, opts);
  return {
    connected: m.connected,
    configured: googleConfigured(),
    tz: opts.timeZone,
    addUrl: "https://calendar.google.com/calendar/r/eventedit",
    months: { [month]: { days: m.days, events: m.events } },
  };
}
