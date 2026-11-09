"use client";

import Link from "next/link";
import { useState, useTransition, type MouseEvent } from "react";
import { completeGoal } from "@/app/actions";
import type { Tier } from "@/engine/types";
import type { AdminTile } from "@/lib/data/admin";

const TIERS: { t: Tier; k: string; name: string }[] = [
  { t: "floor", k: "F", name: "floor" },
  { t: "standard", k: "S", name: "standard" },
  { t: "stretch", k: "X", name: "stretch" },
];

/** 30-day sparkline, 0..100 on a fixed scale so tiles compare at a glance. */
function Spark({ values }: { values: number[] }) {
  const w = 100;
  const h = 22;
  if (values.length < 2) {
    return (
      <span className="t-spark t-nohist" aria-hidden>
        NO HISTORY
      </span>
    );
  }
  const step = w / (values.length - 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(2)} ${(h - 1 - (Math.max(0, Math.min(100, v)) / 100) * (h - 2)).toFixed(2)}`).join(" ");
  return (
    <svg className="t-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path className="base" d={`M0 ${h - 0.5} H${w}`} />
      <path d={d} />
    </svg>
  );
}

export function tileGlyph(t: AdminTile): string {
  if (t.status === "archived") return "x";
  if (t.status === "dormant") return "=";
  if (t.neglected) return "!";
  if (t.goal?.result) return "*";
  return "";
}

/**
 * One skill or feature tile: callout number, name, score/100 and stage, a 30-day sparkline, streak and days since
 * the last log (amber when neglected). Skill tiles with a goal today carry quick log buttons (F, S, X, undo).
 * The whole tile is a link to /admin/<id> (Enter expands it); the log buttons sit above that link.
 */
export function Tile({
  tile,
  num,
  hot,
  onHover,
  onOpen,
}: {
  tile: AdminTile;
  num: string;
  hot: boolean;
  onHover: (id: string | null) => void;
  onOpen: (id: string, from: Element, e: MouseEvent) => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const off = tile.status === "dormant" || tile.status === "archived";
  const warn = tile.neglected && !off;
  const glyph = tileGlyph(tile);
  const log = (tier: Tier | null) =>
    start(async () => {
      if (!tile.goal) return;
      const r = await completeGoal(tile.goal.id, tier);
      setErr(r.ok ? null : r.error);
    });

  const facts: string[] = [];
  if (tile.streak !== null) facts.push(`STREAK ${tile.streak}`);
  if (tile.kind === "skill") facts.push(tile.daysSince === null ? "--" : tile.daysSince === 0 ? "TODAY" : `${tile.daysSince}D AGO`);

  return (
    <article
      className={`adm-tile${hot ? " is-hot" : ""}${warn ? " is-warn" : ""}${off ? " is-off" : ""}`}
      data-tile={tile.id}
      onMouseEnter={() => onHover(tile.id)}
      onMouseLeave={() => onHover(null)}
      aria-label={`${num} ${tile.title}`}
    >
      <div className="t-head">
        <span className="t-num" aria-hidden>
          {num}
        </span>
        <Link
          href={`/admin/${tile.id}`}
          prefetch={false}
          scroll={false}
          className="t-link"
          data-tile-link={tile.id}
          onFocus={() => onHover(tile.id)}
          onBlur={() => onHover(null)}
          onClick={(e) => onOpen(tile.id, e.currentTarget.closest(".adm-tile") ?? e.currentTarget, e)}
        >
          {tile.title}
          {glyph && <span aria-hidden>{` ${glyph}`}</span>}
          <span className="adm-sr">
            {tile.score !== null ? `, score ${tile.score} of 100` : ""}
            {tile.stage ? `, ${tile.stage}` : ""}
            {tile.streak !== null ? `, streak ${tile.streak}` : ""}
            {tile.kind === "skill" ? (tile.daysSince === null ? ", never logged" : `, last logged ${tile.daysSince} days ago`) : ""}
            {warn ? ", neglected" : ""}
            {off ? `, ${tile.status === "dormant" ? "paused" : "archived"}` : ""}
            {". Open"}
          </span>
        </Link>
      </div>
      <div className="t-mid" aria-hidden>
        <span className="t-score">
          {tile.score !== null ? tile.score : "--"}
          {tile.score !== null && <small>/100</small>}
        </span>
        <span className="t-stage">
          {warn ? <span className="t-warn">NEGLECTED</span> : <span>{tile.stage}</span>}
          <span>{facts.join("  ") || tile.note}</span>
        </span>
      </div>
      <div className="t-foot">
        <Spark values={tile.spark} />
        {tile.kind === "skill" && tile.goal && !off && (
          <span className="t-log" role="group" aria-label={`Log ${tile.title}: ${tile.goal.title}`}>
            {TIERS.map((x) => (
              <button
                key={x.t}
                type="button"
                aria-pressed={tile.goal!.result === x.t}
                aria-label={`Log ${tile.title} at ${x.name}`}
                disabled={pending}
                onClick={() => log(x.t)}
              >
                {x.k}
              </button>
            ))}
            <button type="button" aria-label={`Undo ${tile.title} log`} disabled={pending || !tile.goal.result} onClick={() => log(null)}>
              <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden>
                <path d="M4 1 L1 4 L4 7 M1 4 H8 A3 3 0 0 1 8 10" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </span>
        )}
      </div>
      {err && (
        <p role="alert" className="adm-sr">
          {err}
        </p>
      )}
    </article>
  );
}
