"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { rampColor } from "@/lib/palette";

type Point = { day: string; score: number };

/** Overall score (gold area) or daily completion (ramp bars), 30 days. One scale per chart. */
export function TrendTile({ trend, completion }: { trend: Point[]; completion: { day: string; p: number }[] }) {
  const [mode, setMode] = useState<"score" | "done">("score");
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = 170,
    P = { l: 34, r: 10, t: 12, b: 22 };
  const last30 = completion.slice(-30);
  let chart: React.ReactNode;
  if (mode === "done") {
    if (!last30.length) chart = <p className="text-xs text-muted">Completion shows up after your first day with goals.</p>;
    else {
      const bw = (w - P.l - P.r) / last30.length,
        y = (p: number) => P.t + (1 - p / 100) * (h - P.t - P.b);
      chart = (
        <svg className="chart block" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Daily completion for the last ${last30.length} days`}>
          <line x1={P.l} x2={w - P.r} y1={y(85)} y2={y(85)} stroke="var(--gold)" strokeDasharray="3 4" strokeOpacity=".7" />
          <text x={P.l - 6} y={y(85) + 3.5} textAnchor="end">
            85
          </text>
          <text x={P.l - 6} y={y(0) + 3.5} textAnchor="end">
            0
          </text>
          {last30.map((d, i) => {
            const x = P.l + i * bw + 1;
            return (
              <g key={d.day}>
                <rect x={x} y={y(d.p)} width={Math.max(1, bw - 2)} height={y(0) - y(d.p)} rx={2} fill={rampColor(d.p) ?? "var(--r0)"}>
                  <title>{`${d.day}: ${Math.round(d.p)}%`}</title>
                </rect>
                {d.p >= 85 && <rect x={x} y={y(d.p)} width={Math.max(1, bw - 2)} height={2} fill="var(--gold)" />}
              </g>
            );
          })}
        </svg>
      );
    }
  } else if (trend.length < 2) {
    chart = <p className="text-xs text-muted">Your score line starts after two days of scores.</p>;
  } else {
    const v = trend.map((t) => t.score),
      lo = Math.floor(Math.min(...v) - 2),
      hi = Math.ceil(Math.max(...v) + 2);
    const x = (i: number) => P.l + (i / (v.length - 1)) * (w - P.l - P.r),
      y = (s: number) => P.t + (1 - (s - lo) / (hi - lo || 1)) * (h - P.t - P.b);
    const line = v.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(s).toFixed(1)}`).join("");
    const lastV = v[v.length - 1]!;
    chart = (
      <svg className="chart block" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Overall score from ${v[0]!.toFixed(1)} to ${lastV.toFixed(1)}`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d4af37" stopOpacity=".28" />
            <stop offset="1" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[lo, Math.round((lo + hi) / 2), hi].map((g) => (
          <g key={g}>
            <line x1={P.l} x2={w - P.r} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.06)" />
            <text x={P.l - 6} y={y(g) + 3.5} textAnchor="end">
              {g}
            </text>
          </g>
        ))}
        <path d={`${line}L${x(v.length - 1)} ${h - P.b}L${x(0)} ${h - P.b}Z`} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke="var(--gold)" strokeWidth="2.2" />
        <circle cx={x(v.length - 1)} cy={y(lastV)} r="4.5" fill="var(--gold)" style={{ filter: "drop-shadow(0 0 6px #d4af37)" }} />
        <text className="lab" x={x(v.length - 1) - 8} y={y(lastV) - 10} textAnchor="end" fill="var(--gold)" style={{ fill: "var(--gold)" }}>
          {lastV.toFixed(1)}
        </text>
        <text x={P.l} y={h - 4}>
          {trend[0]!.day.slice(5)}
        </text>
        <text x={w - P.r} y={h - 4} textAnchor="end">
          Today
        </text>
      </svg>
    );
  }

  return (
    <section className="tile" aria-labelledby="h-trend">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="h-trend" className="lbl">
          {mode === "done" ? "Completion, 30 days" : "Overall score, 30 days"}
        </h2>
        <div className="inline-flex gap-[3px] rounded-[9px] border border-[var(--border)] bg-sunk p-[3px]" role="group" aria-label="Chart">
          {(["score", "done"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="min-h-7 rounded-md px-3 text-xs font-semibold text-muted aria-pressed:bg-raised aria-pressed:text-text"
            >
              {m === "score" ? "Score" : "Completion"}
            </button>
          ))}
        </div>
      </div>
      <div ref={box}>{chart}</div>
    </section>
  );
}
