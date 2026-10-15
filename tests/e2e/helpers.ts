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
    update public.milestones set claimed_at = case when suggest_claim then now() end, proof_value = null, proof_url = null where user_id = '${USER_ID}';
    update public.skills set status = case when slug = 'triathlon' then 'dormant' else 'active' end,
      archived_at = null, final_score = null, seen_tip_tier = 'foundation' where user_id = '${USER_ID}';
    update public.streak_state set current = 0, best = 0, broken_on = null, broken_length = null where user_id = '${USER_ID}';
    update public.profiles set sound_on = false, seen_figure_tier = 1, onboarded_at = coalesce(onboarded_at, now()) where user_id = '${USER_ID}';
    insert into public.rack_pins (user_id, slot, skill_id, locked_until)
    select '${USER_ID}', s.slot, k.id, now()
    from unnest(array[${RACK.map((r) => `'${r}'`).join(",")}]) with ordinality as s(slug, slot)
    join public.skills k on k.slug = s.slug and k.user_id = '${USER_ID}';
  `);
}
