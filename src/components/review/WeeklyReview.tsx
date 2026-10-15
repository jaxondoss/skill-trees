"use client";

import Link from "next/link";
import { useState } from "react";
import { requestDebrief, saveWeeklyReview } from "@/app/review-actions";
import { useAction } from "@/components/skill/useAction";
import { dayColor, NEUTRAL_CELL } from "@/engine/completion";
import { shortDate } from "@/engine/time";
import type { DropshipKey, WeeklyReviewData } from "@/lib/data/reviews";

type Data = Omit<WeeklyReviewData, "facts"> & { facts?: undefined };

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const TIER_NAME = { floor: "Floor", standard: "Standard", stretch: "Stretch" } as const;
const DROPSHIP_FIELDS: { key: DropshipKey; label: string; prefix: string }[] = [
  { key: "revenue_week_usd", label: "Revenue", prefix: "$" },
  { key: "ad_spend_week_usd", label: "Ad spend", prefix: "$" },
  { key: "orders_week", label: "Orders", prefix: "" },
];

const input = "h-11 w-full min-w-0 rounded-xl border border-border bg-black/30 px-3 text-sm";
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

/** Sunday review (spec 4.4): about three minutes, top to bottom. */
export function WeeklyReview({ data }: { data: Data }) {
  const [obstacle, setObstacle] = useState(data.obstacle);
  const [focusLine, setFocusLine] = useState(data.focusLine);
  const [decisions, setDecisions] = useState<Record<string, boolean | null>>(() => Object.fromEntries(data.suggestions.map((s) => [s.nonNegotiableId, s.decided])));
  const [dropship, setDropship] = useState<Record<DropshipKey, string>>(() => ({
    revenue_week_usd: data.dropship?.revenue_week_usd?.toString() ?? "",
    ad_spend_week_usd: data.dropship?.ad_spend_week_usd?.toString() ?? "",
    orders_week: data.dropship?.orders_week?.toString() ?? "",
  }));
  const [debrief, setDebrief] = useState(data.debrief);
  const save = useAction();
  const claude = useAction();

  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Week of {shortDate(data.weekStart)}. {data.isSunday ? "" : "Reviews are for Sunday, but you can look any time."}
      </p>

      <section aria-labelledby="wk-numbers" className="glass space-y-4 p-4">
        <h2 id="wk-numbers" className="sr-only">
          The week in numbers
        </h2>
        <ol className="grid grid-cols-7 gap-1.5" aria-label="Daily completion this week">
          {data.days.map((d, i) => (
            <li key={d.day} className="flex flex-col items-center gap-1">
              <span
                className={`grid aspect-square w-full place-items-center rounded-md text-[10px] ${d.p !== null && d.p >= 85 ? "ring-1 ring-gold" : ""}`}
                style={{ background: d.p === null || d.future ? NEUTRAL_CELL : dayColor(d.p) }}
                role="img"
                aria-label={`${shortDate(d.day)}: ${d.p === null ? (d.future ? "ahead" : "no plan") : `${Math.round(d.p)}%`}`}
              >
                <span className="num" aria-hidden>
                  {d.p === null ? "" : Math.round(d.p)}
                </span>
              </span>
              <span className="text-[10px] text-muted" aria-hidden>
                {DAY_LETTERS[i]}
              </span>
            </li>
          ))}
        </ol>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Completion" value={data.completion.avg === null ? "-" : `${Math.round(data.completion.avg)}%`} />
          <Stat label="Days at 85%" value={`${data.completion.kept} of 7`} />
          <Stat label="Streak" value={`${data.streak.current}`} sub={`best ${data.streak.best}`} />
        </dl>
        <p className="text-sm">
          {data.winningWeek ? "A winning week: 5 or more days at 85%." : `${Math.max(0, 5 - data.completion.kept)} more days at 85% makes a winning week.`}{" "}
          <span className="text-muted">
            Winning weeks so far: <span className="num">{data.winningWeeks}</span>.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Mover label="Biggest riser" m={data.riser} />
          <Mover label="Biggest slipper" m={data.slipper} />
        </div>
        {data.missed.length > 0 && (
          <p className="text-xs text-muted">
            Missed most:{" "}
            {data.missed.map((m, i) => (
              <span key={m.skillId}>
                {i > 0 && ", "}
                {m.name} <span className="num">{m.missed}</span> of <span className="num">{m.scheduled}</span>
              </span>
            ))}
            .
          </p>
        )}
      </section>

      <section aria-labelledby="wk-question" className="space-y-2">
        <h2 id="wk-question" className="font-display text-xl">
          What got in the way this week?
        </h2>
        <textarea value={obstacle} onChange={(e) => setObstacle(e.target.value)} maxLength={1000} rows={3} className={`${input} h-auto py-2`} aria-labelledby="wk-question" />
      </section>

      <section aria-labelledby="wk-focus" className="space-y-2">
        <h2 id="wk-focus" className="font-display text-xl">
          Next week&apos;s focus line
        </h2>
        <input value={focusLine} onChange={(e) => setFocusLine(e.target.value)} maxLength={80} placeholder="Win the morning" className={`${input} font-display italic`} aria-labelledby="wk-focus" />
        <p className="text-[11px] text-muted">Shows under the banner all week.</p>
      </section>

      {data.suggestions.length > 0 && (
        <section aria-labelledby="wk-diff" className="space-y-2">
          <h2 id="wk-diff" className="font-display text-xl">
            Difficulty
          </h2>
          <ul className="space-y-2">
            {data.suggestions.map((s) => {
              const choice = decisions[s.nonNegotiableId];
              const locked = s.decided === true;
              return (
                <li key={s.nonNegotiableId} className="glass space-y-2 p-3">
                  <p className="text-sm">
                    <span className="font-medium">{s.skillName}</span>: {s.message}
                  </p>
                  <p className="text-xs text-muted">
                    {locked ? `Default tier is now ${TIER_NAME[s.currentTier]}.` : `Default tier ${TIER_NAME[s.currentTier]} to ${TIER_NAME[s.nextTier]}.`}
                  </p>
                  {!locked && (
                    <div className="flex gap-2" role="group" aria-label={`${s.skillName} suggestion`}>
                      {[
                        [true, "Accept"],
                        [false, "Keep as is"],
                      ].map(([v, label]) => (
                        <button
                          key={String(label)}
                          type="button"
                          aria-pressed={choice === v}
                          onClick={() => setDecisions({ ...decisions, [s.nonNegotiableId]: v as boolean })}
                          className={`min-h-11 flex-1 rounded-xl border text-sm ${choice === v ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.dropship && (
        <section aria-labelledby="wk-store" className="space-y-2">
          <h2 id="wk-store" className="font-display text-xl">
            Store this week
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {DROPSHIP_FIELDS.map((f) => (
              <label key={f.key} className="space-y-1 text-xs text-muted">
                {f.label}
                <input
                  inputMode="decimal"
                  value={dropship[f.key]}
                  placeholder={f.prefix ? `${f.prefix}0` : "0"}
                  onChange={(e) => setDropship({ ...dropship, [f.key]: e.target.value })}
                  className={`${input} num text-text`}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        disabled={save.pending}
        className="min-h-12 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-50"
        onClick={() =>
          save.run(
            () =>
              saveWeeklyReview({
                obstacle,
                focusLine,
                decisions: data.suggestions.flatMap((s) => {
                  const v = decisions[s.nonNegotiableId];
                  return v === null || v === undefined ? [] : [{ nonNegotiableId: s.nonNegotiableId, kind: s.kind, accepted: v }];
                }),
                dropship: data.dropship
                  ? { revenue_week_usd: num(dropship.revenue_week_usd), ad_spend_week_usd: num(dropship.ad_spend_week_usd), orders_week: num(dropship.orders_week) }
                  : undefined,
              }),
            "Review saved.",
          )
        }
      >
        {data.saved ? "Update review" : "Save review"}
      </button>
      {save.line}

      {data.claude && (
        <section aria-labelledby="wk-debrief" className="space-y-2">
          <h2 id="wk-debrief" className="font-display text-xl">
            Debrief
          </h2>
          {debrief && <p className="whitespace-pre-line text-sm leading-relaxed">{debrief}</p>}
          <button
            type="button"
            disabled={claude.pending || !data.saved}
            onClick={() => claude.runData(() => requestDebrief(), setDebrief)}
            className="min-h-11 w-full rounded-xl border border-border text-sm disabled:opacity-40"
          >
            {claude.pending ? "Writing" : debrief ? "Write it again" : "Write a debrief with Claude"}
          </button>
          {!data.saved && <p className="text-[11px] text-muted">Save the review first; the debrief reads your answer.</p>}
          {claude.line}
        </section>
      )}

      <Link href="/review/month" className="block min-h-11 py-3 text-center text-sm text-muted underline-offset-4 hover:underline">
        Monthly review
      </Link>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border p-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num font-display text-2xl">{value}</dd>
      {sub && <dd className="num text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}

function Mover({ label, m }: { label: string; m: { name: string; delta: number; color: string } | null }) {
  return (
    <div className="rounded-xl border border-border p-2">
      <p className="text-[11px] text-muted">{label}</p>
      {m ? (
        <p>
          <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: m.color }} aria-hidden />
          {m.name} <span className="num text-muted">{signed(m.delta)}</span>
        </p>
      ) : (
        <p className="text-muted">None yet</p>
      )}
    </div>
  );
}
