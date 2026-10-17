import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsClient, type SettingsData } from "@/components/settings/SettingsClient";
import { ADAPTERS } from "@/integrations/index";
import type { IntegrationRow } from "@/lib/data/rows";
import { createClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <h1 className="font-display text-3xl">Settings</h1>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <Settings />
        <Integrations />
      </Suspense>
    </main>
  );
}

async function Settings() {
  await connection();
  const supabase = await createClient();
  const [profile, template, overrides, keyDates] = await Promise.all([
    supabase.from("profiles").select("rollover_hour, daily_budget_min, sound_on, timezone").single(),
    supabase.from("schedule_templates").select("id, name, starts_on, ends_on").eq("is_active", true).maybeSingle(),
    supabase.from("day_overrides").select("id, kind, starts_on, ends_on, note").order("starts_on", { ascending: false }).limit(20),
    supabase.from("key_dates").select("id, label, kind, date, tentative, goal").order("date"),
  ]);
  const p = profile.data as { rollover_hour: number; daily_budget_min: number; sound_on: boolean; timezone: string };
  const t = template.data as { id: string; name: string; starts_on: string | null; ends_on: string | null } | null;
  const { data: days } = t ? await supabase.from("schedule_days").select("weekday, day_type, training_time").eq("template_id", t.id) : { data: [] };

  const data: SettingsData = {
    profile: { rolloverHour: p.rollover_hour, dailyBudgetMin: p.daily_budget_min, soundOn: p.sound_on, timezone: p.timezone },
    template: t ? { id: t.id, name: t.name, startsOn: t.starts_on, endsOn: t.ends_on } : null,
    days: ((days ?? []) as { weekday: number; day_type: SettingsData["days"][number]["dayType"]; training_time: string | null }[])
      .map((d) => ({ weekday: d.weekday, dayType: d.day_type, trainingTime: d.training_time?.slice(0, 5) ?? null }))
      .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)),
    overrides: ((overrides.data ?? []) as { id: string; kind: string; starts_on: string; ends_on: string; note: string | null }[]).map((o) => ({
      id: o.id,
      kind: o.kind,
      startsOn: o.starts_on,
      endsOn: o.ends_on,
      note: o.note,
    })),
    keyDates: (keyDates.data ?? []) as SettingsData["keyDates"],
  };
  return <SettingsClient data={data} />;
}

async function Integrations() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.from("integrations").select("provider, status, config, last_synced_at, last_error");
  const rows = (data ?? []) as IntegrationRow[];

  return (
    <section aria-label="Integrations" className="space-y-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">Integrations</h2>
      <p className="text-xs text-muted">Every integration is optional. Without one, the same numbers are entered by hand and the app works the same.</p>
      <ul className="space-y-2">
        {ADAPTERS.map((a) => {
          const row = rows.find((r) => r.provider === a.id);
          const status = row ? (row.status === "error" ? "Error" : "Connected") : a.available ? "Not connected" : "Needs setup";
          return (
            <li key={a.id} className="glass space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{a.label}</h3>
                <span className={`rounded-chip px-2.5 py-0.5 text-[11px] ${row?.status === "connected" ? "bg-nutrition/15 text-nutrition" : row ? "bg-athletics/15 text-athletics" : "bg-white/5 text-muted"}`}>{status}</span>
              </div>
              <p className="text-xs text-muted">{a.feeds}</p>
              {row?.last_error && <p className="text-xs text-athletics">Last sync failed: {row.last_error}</p>}
              {!a.available && (
                <p className="text-xs">
                  <span className="text-gold">Needs from you:</span> {a.needs.join("; ")}.
                </p>
              )}
              <Link href={a.fallback.href} className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-4">
                {a.available ? (row ? "Manage" : "Connect") : a.fallback.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
