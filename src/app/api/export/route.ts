import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Every table the user owns, as one JSON file (spec 4.5). Encrypted integration secrets are never included. */
const TABLES: Record<string, string> = {
  profiles: "*",
  categories: "*",
  skills: "*",
  milestones: "*",
  non_negotiables: "*",
  schedule_templates: "*",
  schedule_days: "*",
  day_overrides: "*",
  key_dates: "*",
  rack_pins: "*",
  daily_plans: "*",
  plan_goals: "*",
  metrics: "*",
  skill_logs: "*",
  score_snapshots: "*",
  daily_completions: "*",
  streak_state: "*",
  assignments: "*",
  sleep_sessions: "*",
  integrations: "provider, status, config, last_synced_at, last_error, created_at",
};
const PAGE = 1000;

export async function GET() {
  const supabase = await createClient();
  const { data: who } = await supabase.auth.getClaims();
  if (!who?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const out: Record<string, unknown[]> = {};
  for (const [table, columns] of Object.entries(TABLES)) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: `${table}: ${error.message}` }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    out[table] = rows;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, tables: out }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="forge-export-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
