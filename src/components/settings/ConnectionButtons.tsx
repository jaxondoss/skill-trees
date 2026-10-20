"use client";

import { useState } from "react";
import { connectLyfta, disconnect, syncNow, testGemini } from "@/app/tracker-actions";
import { useAction } from "@/components/skill/useAction";
import type { ProviderId } from "@/integrations/types";

const button = "min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40";

/** Sync and disconnect for a connected integration, or connect for Lyfta. */
export function IntegrationButtons({ provider, connected, keySet }: { provider: ProviderId; connected: boolean; keySet: boolean }) {
  const { pending, run, line } = useAction();
  const [unit, setUnit] = useState<"lb" | "kg">("lb");

  if (connected) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => run(() => syncNow(provider), "Synced.")} className={button}>
            {pending ? "Syncing" : "Sync now"}
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => disconnect(provider), "Disconnected. Manual entry still works.")} className={button}>
            Disconnect
          </button>
        </div>
        {line}
      </div>
    );
  }
  if (provider !== "lyfta") return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
          Lyfta weights in
          <select value={unit} onChange={(e) => setUnit(e.target.value as "lb" | "kg")} className="min-h-11 rounded-xl border border-border bg-black/30 px-3 text-sm text-text">
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
        <button type="button" disabled={pending || !keySet} onClick={() => run(() => connectLyfta({ unit }), "Connected. Pulled the last 30 days.")} className={button}>
          {pending ? "Connecting" : "Connect Lyfta"}
        </button>
      </div>
      {line}
    </div>
  );
}

/** Round trip to Gemini with the server's key. The key itself never reaches the browser. */
export function TestGemini() {
  const { pending, run, line } = useAction();
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending} onClick={() => run(testGemini, "Gemini answered. Food photos, debriefs and reading tests use it.")} className={button}>
        {pending ? "Testing" : "Test Gemini"}
      </button>
      {line}
    </div>
  );
}
