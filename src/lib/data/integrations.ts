import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, parseKey } from "@/integrations/crypto";
import { adapterFor } from "@/integrations/index";
import { loadProfile } from "./context";
import type { IntegrationEvent, ProviderId } from "@/integrations/types";

/** How often a connected integration re-syncs on app open. */
export const SYNC_EVERY_MS = 6 * 3_600_000;

/** Writes adapter events like manual entries. Re-running a sync replaces, never duplicates. */
async function applyEvents(supabase: SupabaseClient, uid: string, provider: ProviderId, events: IntegrationEvent[]) {
  const { data: skills } = await supabase.from("skills").select("id, slug");
  const skillId = new Map(((skills ?? []) as { id: string; slug: string }[]).map((s) => [s.slug, s.id]));

  for (const e of events) {
    if (e.kind === "metric") {
      await supabase.from("metrics").delete().eq("key", e.key).eq("day", e.day).eq("source", provider);
      await supabase.from("metrics").insert({ user_id: uid, skill_id: skillId.get(e.skillSlug) ?? null, key: e.key, value: e.value, day: e.day, source: provider });
    } else if (e.kind === "assignment") {
      await supabase.from("assignments").upsert(
        { user_id: uid, source: provider, external_id: e.externalId, course: e.course, name: e.name, due_at: e.dueAt, started: e.started, submitted: e.submitted },
        { onConflict: "user_id,source,external_id" },
      );
    } else {
      const sid = skillId.get(e.skillSlug);
      if (!sid) continue;
      const { data: goals } = await supabase
        .from("plan_goals")
        .select("id, kind, result_tier, daily_plans!inner(day)")
        .eq("skill_id", sid)
        .eq("daily_plans.day", e.day)
        .neq("kind", "stretch")
        .is("result_tier", null);
      const goal = (goals ?? [])[0] as { id: string } | undefined;
      if (goal) await supabase.from("plan_goals").update({ result_tier: e.tier, completed_at: new Date().toISOString() }).eq("id", goal.id);
    }
  }
}

/** Runs one provider's sync and records the outcome on its row. Never throws. */
export async function syncProvider(supabase: SupabaseClient, uid: string, provider: ProviderId, today: string): Promise<{ ok: boolean; error?: string; events: number }> {
  const adapter = adapterFor(provider);
  const { data } = await supabase.from("integrations").select("config, secret_ciphertext").eq("provider", provider).maybeSingle();
  if (!adapter || !data) return { ok: false, error: "Not connected.", events: 0 };
  const row = data as { config: unknown; secret_ciphertext: string | null };

  try {
    const config = adapter.connect(row.config);
    const secret = row.secret_ciphertext
      ? decryptSecret(row.secret_ciphertext, parseKey(process.env.INTEGRATIONS_KEY))
      : adapter.envKey
        ? (process.env[adapter.envKey] ?? null)
        : null;
    const raw = await adapter.sync(config, secret, fetch);
    const profile = await loadProfile(supabase);
    const events = adapter.mapToEvents(raw, { today, config, timeZone: profile.timezone, rolloverHour: profile.rollover_hour });
    await applyEvents(supabase, uid, provider, events);
    await supabase.from("integrations").update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null }).eq("provider", provider);
    return { ok: true, events: events.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Sync failed.";
    await supabase.from("integrations").update({ status: "error", last_synced_at: new Date().toISOString(), last_error: error }).eq("provider", provider);
    return { ok: false, error, events: 0 };
  }
}

/** On app open: sync any connected integration whose last sync is older than 6 hours. */
export async function syncDue(
  supabase: SupabaseClient,
  uid: string,
  today: string,
  rows: { provider: ProviderId; last_synced_at: string | null }[],
  now: Date,
): Promise<boolean> {
  const due = rows.filter((r) => adapterFor(r.provider)?.available && (!r.last_synced_at || now.getTime() - new Date(r.last_synced_at).getTime() > SYNC_EVERY_MS));
  for (const r of due) await syncProvider(supabase, uid, r.provider, today);
  return due.length > 0;
}
