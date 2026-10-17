"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addMetric } from "@/app/skill-actions";
import type { NumberTile } from "@/lib/data/board";
import { catClass } from "@/lib/palette";

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120,
    h = 30,
    lo = Math.min(...values),
    hi = Math.max(...values),
    sp = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - lo) / sp) * (h - 8)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg className="absolute right-3.5 bottom-[22px] h-[30px] w-[42%] max-sm:hidden" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path
        d={pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")}
        fill="none"
        stroke="var(--ct)"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--ct)" />
    </svg>
  );
}

/** Six readouts. Each tile is its own input: click, type, Enter (spec v2 5a). */
export function NumberTiles({ tiles }: { tiles: NumberTile[] }) {
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <NumberTileView key={t.key} t={t} />
      ))}
    </div>
  );
}

function NumberTileView({ t }: { t: NumberTile }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cls = `tile glow block min-h-[132px] text-left ${catClass(t.category)}`;
  const body = (
    <>
      <span className="lbl block">{t.label}</span>
      <Spark values={t.series} />
      <div className="mt-3 font-mono text-[26px] leading-[30px] font-semibold tracking-tight text-[var(--ct)]">
        {t.display === null ? (
          <span className="text-label">-</span>
        ) : (
          <>
            {t.display}
            {t.unit && t.unit !== "$" && <small className="ml-1 text-xs text-muted">{t.unit}</small>}
          </>
        )}
      </div>
    </>
  );

  if (!t.logKey || !t.skillId) {
    return (
      <Link href={`/s/${t.skillSlug}`} className={cls} data-cat={t.category}>
        {body}
        <div className="text-xs text-muted">{t.value === null ? "Log the first one" : "Open to log"}</div>
      </Link>
    );
  }

  if (!editing) {
    return (
      <button type="button" className={cls} data-cat={t.category} onClick={() => setEditing(true)} aria-label={`${t.label}: ${t.display ?? "none yet"}. Log a new value`}>
        {body}
        <div className="text-xs text-muted">{error ?? (t.value === null ? "Tap to log the first one" : "Tap to log")}</div>
      </button>
    );
  }

  const id = `num-${t.key}`;
  return (
    <form
      className={`${cls} cursor-text`}
      data-cat={t.category}
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(value);
        if (!value || !Number.isFinite(v)) return setEditing(false);
        start(async () => {
          const r = await addMetric(t.skillId!, t.logKey!, v);
          setError(r.ok ? null : r.error);
          setEditing(false);
          setValue("");
        });
      }}
    >
      <label htmlFor={id} className="lbl block">
        {t.label}
      </label>
      <input
        id={id}
        name={t.logKey}
        type="number"
        step="any"
        inputMode="decimal"
        autoFocus
        autoComplete="off"
        value={value}
        placeholder={t.display ?? ""}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        onBlur={() => !value && setEditing(false)}
        className="field-input mt-2.5 w-full font-mono text-lg"
      />
      <div className="mt-1 text-xs text-muted">{pending ? "Saving…" : "Enter to save, Esc to cancel"}</div>
    </form>
  );
}
