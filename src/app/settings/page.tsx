import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ADAPTERS } from "@/integrations/index";
import type { IntegrationRow } from "@/lib/data/rows";
import { createClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <h1 className="font-display text-3xl">Settings</h1>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <Integrations />
      </Suspense>
    </main>
  );
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
              <Link href={a.available ? a.fallback.href : a.fallback.href} className="inline-flex min-h-9 items-center text-xs text-muted underline underline-offset-4">
                {a.available ? (row ? "Manage" : "Connect") : a.fallback.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
