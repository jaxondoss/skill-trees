import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { IntegrationButtons, TestGemini } from "@/components/settings/ConnectionButtons";
import { SettingsClient, type SettingsData } from "@/components/settings/SettingsClient";
import { ADAPTERS } from "@/integrations/index";
import type { IntegrationRow } from "@/lib/data/rows";
import { createClient } from "@/lib/supabase/server";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function SettingsPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/board" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Overview
      </Link>
      <h1 className="font-display text-3xl">Settings</h1>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <Settings />
        <Connections />
        <Integrations searchParams={searchParams} />
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

/** Which server keys are set (names only, never values), so a missing one is obvious. */
const KEYS: { name: string; what: string; optional?: boolean }[] = [
  { name: "GEMINI_API_KEY", what: "Food photos, weekly debrief, reading tests" },
  { name: "LYFTA_API_KEY", what: "Lyfta workouts" },
  { name: "FORGE_OWNER_EMAIL", what: "Automatic sign-in" },
  { name: "FORGE_OWNER_PASSWORD", what: "Automatic sign-in" },
  { name: "STRAVA_CLIENT_ID", what: "Strava runs", optional: true },
  { name: "STRAVA_CLIENT_SECRET", what: "Strava runs", optional: true },
  { name: "INTEGRATIONS_KEY", what: "Encrypts Strava, Canvas and Google logins", optional: true },
  { name: "GOOGLE_CLIENT_ID", what: "Google Calendar on the calendar wall", optional: true },
  { name: "GOOGLE_CLIENT_SECRET", what: "Google Calendar on the calendar wall", optional: true },
  { name: "ANTHROPIC_API_KEY", what: "Backup AI if Gemini is down", optional: true },
];

async function Connections() {
  await connection();
  return (
    <section aria-label="Connection check" className="space-y-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">Connection check</h2>
      <p className="text-xs text-muted">Keys set in Vercel. Only whether each one is there shows here, never its value. A new key needs a redeploy before it shows.</p>
      <ul className="glass divide-y divide-border">
        {KEYS.map((k) => {
          const set = Boolean(process.env[k.name]);
          return (
            <li key={k.name} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block font-mono text-xs">{k.name}</span>
                <span className="block text-[11px] text-muted">{k.what}</span>
              </span>
              <span className={`shrink-0 rounded-chip px-2.5 py-0.5 text-[11px] ${set ? "bg-nutrition/15 text-nutrition" : k.optional ? "bg-white/5 text-muted" : "bg-athletics/15 text-athletics"}`}>
                {set ? "Set" : k.optional ? "Not set, optional" : "Missing"}
              </span>
            </li>
          );
        })}
      </ul>
      {process.env.GEMINI_API_KEY && <TestGemini />}
    </section>
  );
}

/** What the Google sign-in sent back, as a plain sentence. */
const GOOGLE_RESULT: Record<string, string> = {
  connected: "Google Calendar is connected. The calendar wall shows your events.",
  google_denied: "Google Calendar was not connected: access was declined on Google's screen.",
  google_state: "Google Calendar was not connected: the sign-in expired or came from another tab. Try again.",
  google_no_refresh_token: "Google sent no lasting access. Remove FORGE at myaccount.google.com/permissions, then connect again.",
  google_not_configured: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel and redeploy first.",
  integrations_key: "Add INTEGRATIONS_KEY in Vercel and redeploy first. It encrypts the Google login.",
  google_save_failed: "Google said yes, but saving the connection failed. Try again.",
  google_failed: "Google Calendar could not connect. Try again.",
  sign_in: "Sign in again, then connect Google Calendar.",
};

async function Integrations({ searchParams }: { searchParams: Search }) {
  await connection();
  const supabase = await createClient();
  const [{ data }, query] = await Promise.all([supabase.from("integrations").select("provider, status, config, last_synced_at, last_error"), searchParams]);
  const rows = (data ?? []) as IntegrationRow[];
  const googleResult = query.connected === "google_calendar" ? GOOGLE_RESULT.connected : typeof query.error === "string" ? GOOGLE_RESULT[query.error] : undefined;

  return (
    <section aria-label="Integrations" className="space-y-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">Integrations</h2>
      <p className="text-xs text-muted">Every integration is optional. Without one, the same numbers are entered by hand and the app works the same.</p>
      <ul className="space-y-2">
        {ADAPTERS.map((a) => {
          const row = rows.find((r) => r.provider === a.id);
          const status = row ? (row.status === "error" ? "Error" : "Connected") : a.available ? "Not connected" : "Needs setup";
          const google = a.id === "google_calendar";
          return (
            <li key={a.id} className="glass space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{a.label}</h3>
                <span className={`rounded-chip px-2.5 py-0.5 text-[11px] ${row?.status === "connected" ? "bg-nutrition/15 text-nutrition" : row ? "bg-athletics/15 text-athletics" : "bg-white/5 text-muted"}`}>{status}</span>
              </div>
              <p className="text-xs text-muted">{a.feeds}</p>
              {google && googleResult && <p className="text-xs" role="status">{googleResult}</p>}
              {row?.last_error && <p className="text-xs text-athletics">Last sync failed: {row.last_error}</p>}
              {!a.available && (
                <p className="text-xs">
                  <span className="text-gold">Needs from you:</span> {a.needs.join("; ")}.
                </p>
              )}
              {google && row?.last_synced_at && <p className="text-[11px] text-muted">Last read {new Date(row.last_synced_at).toLocaleString("en-US", { timeZone: "America/Chicago" })}. Events load live on the calendar wall.</p>}
              {!google && row?.last_synced_at && <p className="text-[11px] text-muted">Last sync {new Date(row.last_synced_at).toLocaleString("en-US", { timeZone: "America/Chicago" })}. Re-syncs every 6 hours when you open the app.</p>}
              {google && row && <IntegrationButtons provider={a.id} connected keySet />}
              {google && a.available && !row && (
                <a href="/api/google/connect" className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm">
                  Connect Google Calendar
                </a>
              )}
              {a.envKey && <IntegrationButtons provider={a.id} connected={Boolean(row)} keySet={Boolean(process.env[a.envKey])} />}
              {a.envKey && !row && !process.env[a.envKey] && <p className="text-xs text-muted">Add {a.envKey} in Vercel and redeploy to connect.</p>}
              <Link href={a.fallback.href} className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-4">
                {a.available && !a.envKey && !google ? (row ? "Manage" : "Connect") : a.fallback.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
