"use client";

import { useId, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays } from "@/engine/time";

const RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: Infinity },
] as const;

/** Score history from daily snapshots (spec 4.2 and 4.3), 30d / 90d / all. */
export function ScoreChart({ points, color, today }: { points: { day: string; score: number }[]; color: string; today: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("30d");
  const id = useId().replace(/:/g, "");
  const days = RANGES.find((r) => r.label === range)!.days;
  const from = Number.isFinite(days) ? addDays(today, -(days - 1)) : "";
  const data = points.filter((p) => p.day >= from).map((p) => ({ ...p, score: Math.round(p.score * 10) / 10 }));
  const first = data[0]?.score;
  const last = data.at(-1)?.score;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {data.length < 2 ? (
            "History builds one point per day."
          ) : (
            <>
              <span className="num">{first}</span> to <span className="num">{last}</span> over {data.length} days
            </>
          )}
        </p>
        <div className="flex rounded-chip border border-border p-0.5" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={range === r.label}
              onClick={() => setRange(r.label)}
              className={`min-h-8 rounded-chip px-3 text-xs ${range === r.label ? "bg-white/10 text-text" : "text-muted"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-36" aria-hidden>
        {data.length >= 2 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -28 }}>
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity={0.35} />
                  <stop offset="1" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fill: "#8E8A84", fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#8E8A84", fontSize: 10 }} axisLine={false} tickLine={false} ticks={[0, 50, 100]} />
              <Tooltip
                contentStyle={{ background: "#141416", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#8E8A84" }}
                formatter={(v) => [v as number, "Score"]}
              />
              <Area type="monotone" dataKey="score" stroke={color} strokeWidth={2} fill={`url(#fill-${id})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
