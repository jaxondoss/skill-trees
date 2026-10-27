import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { AUTH_COOKIE, sessionCookieValue, USER_ID } from "./stack/config.mjs";

export async function signIn(page: Page) {
  await page.context().addCookies([{ name: AUTH_COOKIE, value: sessionCookieValue(), domain: "localhost", path: "/" }]);
}

/** Runs SQL as the database owner against the e2e stack (RLS bypassed). */
export function sql(query: string): string {
  const { pgHost, pgPort } = JSON.parse(readFileSync(join(__dirname, "..", "..", ".e2e-stack.json"), "utf8"));
  return execFileSync("psql", ["-h", pgHost, "-p", String(pgPort), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", query], {
    encoding: "utf8",
  }).trim();
}

export const RACK = ["dropshipping", "strength", "running", "time-blocking", "academics"];

/** Back to a freshly onboarded user: no plans, history, or metrics; default rack (unlocked); suggested milestones claimed. */
export function resetUser() {
  sql(`
    delete from public.daily_plans where user_id = '${USER_ID}';
    delete from public.daily_completions where user_id = '${USER_ID}';
    delete from public.score_snapshots where user_id = '${USER_ID}';
    delete from public.rack_pins where user_id = '${USER_ID}';
    delete from public.metrics where user_id = '${USER_ID}';
    delete from public.skill_logs where user_id = '${USER_ID}';
    delete from public.assignments where user_id = '${USER_ID}';
    delete from public.sleep_sessions where user_id = '${USER_ID}';
    delete from public.integrations where user_id = '${USER_ID}';
    delete from public.weekly_reviews where user_id = '${USER_ID}';
    delete from public.journal_entries where user_id = '${USER_ID}';
    delete from public.relics where user_id = '${USER_ID}';
    delete from public.monthly_reviews where user_id = '${USER_ID}';
    delete from public.skills where user_id = '${USER_ID}' and slug like 'e2e-%';
    update public.milestones set claimed_at = case when suggest_claim then now() end, proof_value = null, proof_url = null where user_id = '${USER_ID}';
    update public.skills set status = case when slug = 'triathlon' then 'dormant' else 'active' end,
      archived_at = null, final_score = null, seen_tip_tier = 'foundation' where user_id = '${USER_ID}';
    update public.streak_state set current = 0, best = 0, broken_on = null, broken_length = null where user_id = '${USER_ID}';
    update public.non_negotiables set default_tier = 'standard' where user_id = '${USER_ID}';
    update public.profiles set focus_line = null, sound_on = false, seen_figure_tier = 1, onboarded_at = coalesce(onboarded_at, now()), statue_level = null where user_id = '${USER_ID}';
    insert into public.rack_pins (user_id, slot, skill_id, locked_until)
    select '${USER_ID}', s.slot, k.id, now()
    from unnest(array[${RACK.map((r) => `'${r}'`).join(",")}]) with ordinality as s(slug, slot)
    join public.skills k on k.slug = s.slug and k.user_id = '${USER_ID}';
  `);
}

/** App "today" in SQL: America/Chicago with the 4 AM rollover (the e2e user's settings). */
export const TODAY_SQL = `((now() at time zone 'America/Chicago') - interval '4 hours')::date`;

/** Past days (1..n back) where the skill's first non-negotiable was planned and logged at a tier. */
export function seedHistory(slug: string, days: number, result: "floor" | "standard" | "stretch" | null) {
  sql(`
    with nn as (
      select n.id, n.skill_id from public.non_negotiables n join public.skills s on s.id = n.skill_id
      where s.user_id = '${USER_ID}' and s.slug = '${slug}' order by n.sort limit 1
    ), d as (
      select ${TODAY_SQL} - g as day from generate_series(1, ${days}) g
    ), p as (
      insert into public.daily_plans (user_id, day, day_type, budget_min)
      select '${USER_ID}', d.day, 'class_light', 125 from d
      on conflict (user_id, day) do update set day_type = excluded.day_type
      returning id
    )
    insert into public.plan_goals (user_id, plan_id, skill_id, non_negotiable_id, kind, tier, title, text, result_tier, completed_at)
    select '${USER_ID}', p.id, nn.skill_id, nn.id, 'rack', 'standard', '${slug}', '${slug}', ${result ? `'${result}'` : "null"}, ${result ? "now()" : "null"}
    from p cross join nn;
  `);
}
