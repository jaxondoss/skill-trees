"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addSkill, saveMonthlyReview } from "@/app/review-actions";
import { setSkillStatus } from "@/app/skill-actions";
import { Figure } from "@/components/figure/Figure";
import type { Region } from "@/components/figure/geometry";
import { useAction } from "@/components/skill/useAction";
import type { Calibration } from "@/engine/review";
import type { loadMonthlyReview } from "@/lib/data/reviews";

type Data = Awaited<ReturnType<typeof loadMonthlyReview>>;

const CHOICES: [Calibration, string][] = [
  ["too_high", "Too high"],
  ["right", "Right"],
  ["too_low", "Too low"],
];
const DRIFT: Record<Calibration, string> = {
  too_high: "Felt too high for a few months. The easy milestones may be worth too many points.",
  too_low: "Felt too low for a few months. The hard milestones may be worth too few points.",
  right: "",
};
const input = "h-11 w-full min-w-0 rounded-xl border border-border bg-black/30 px-3 text-sm";

/** First-Sunday review (spec 4.4): calibrate, compare the figure, add or archive skills. */
export function MonthlyReview({ data }: { data: Data }) {
  const [calibrations, setCalibrations] = useState<Record<string, Calibration>>(() =>
    Object.fromEntries(data.skills.flatMap((s) => (s.calibration ? [[s.id, s.calibration]] : []))),
  );
  const [notes, setNotes] = useState(data.notes);
  const [newSkill, setNewSkill] = useState({ name: "", categoryId: data.categories[0]?.id ?? "", identity: "" });
  const [archiving, setArchiving] = useState<string | null>(null);
  const save = useAction();
  const skillAction = useAction();
  const router = useRouter();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{data.monthLabel}.</p>

      <section aria-labelledby="mo-figure" className="space-y-2">
        <h2 id="mo-figure" className="font-display text-xl">
          This month and last
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <FigureCard label="End of last month" fig={data.lastMonth} id="last" />
          <FigureCard label="Now" fig={data.now} id="now" />
        </div>
      </section>

      <section aria-labelledby="mo-cal" className="space-y-3">
        <div>
          <h2 id="mo-cal" className="font-display text-xl">
            Does this number feel true?
          </h2>
          <p className="text-xs text-muted">Your answers are kept month to month to tune milestone weights.</p>
        </div>
        <ul className="space-y-3">
          {data.skills.map((s) => (
            <li key={s.id} className="glass space-y-2 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/s/${s.slug}`} className="-my-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium">
                  <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.name}
                  {s.status === "dormant" && <span className="ml-1 text-xs text-muted">(dormant)</span>}
                </Link>
                <span className="num font-display text-xl">
                  {s.display}
                  {s.delta !== null && <span className="ml-1 text-xs text-muted">{`${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(1)}`}</span>}
                </span>
              </div>
              <div className="flex gap-1.5" role="group" aria-label={`${s.name}: does ${s.display} feel true?`}>
                {CHOICES.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={calibrations[s.id] === v}
                    onClick={() => setCalibrations({ ...calibrations, [s.id]: v })}
                    className={`min-h-11 flex-1 rounded-xl border text-xs ${calibrations[s.id] === v ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {s.drift && <p className="text-[11px] text-muted">{DRIFT[s.drift]}</p>}
              {s.points < 100 && (
                <p className="text-[11px] text-athletics">
                  Milestones total <span className="num">{s.points}</span> of 100.{" "}
                  <Link href={`/s/${s.slug}`} className="underline">
                    Add more
                  </Link>
                </p>
              )}
              <div className="flex justify-end">
                {archiving === s.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    Archive {s.name}? Its score is kept as final.
                    <button type="button" className="min-h-11 px-2 text-athletics" onClick={() => skillAction.run(() => setSkillStatus(s.id, "archived"), `${s.name} archived.`, () => setArchiving(null))}>
                      Archive
                    </button>
                    <button type="button" className="min-h-11 px-2 text-muted" onClick={() => setArchiving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="min-h-11 px-2 text-xs text-muted" onClick={() => setArchiving(s.id)}>
                    Archive
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {skillAction.line}
      </section>

      <section aria-labelledby="mo-notes" className="space-y-2">
        <h2 id="mo-notes" className="font-display text-xl">
          Notes
        </h2>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} className={`${input} h-auto py-2`} aria-labelledby="mo-notes" />
      </section>

      <button
        type="button"
        disabled={save.pending}
        onClick={() => save.run(() => saveMonthlyReview({ calibrations, notes }), "Monthly review saved.")}
        className="min-h-12 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-50"
      >
        {data.saved ? "Update monthly review" : "Save monthly review"}
      </button>
      {save.line}

      <section aria-labelledby="mo-add" className="space-y-2">
        <h2 id="mo-add" className="font-display text-xl">
          Add a skill
        </h2>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            skillAction.runData(() => addSkill(newSkill), (slug) => router.push(`/s/${slug}`));
          }}
        >
          <input aria-label="Skill name" placeholder="Name" value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} maxLength={40} className={input} />
          <select aria-label="Category" value={newSkill.categoryId} onChange={(e) => setNewSkill({ ...newSkill, categoryId: e.target.value })} className={input}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input aria-label="Identity" placeholder="I am someone who..." value={newSkill.identity} onChange={(e) => setNewSkill({ ...newSkill, identity: e.target.value })} maxLength={200} className={input} />
          <button type="submit" disabled={skillAction.pending || newSkill.name.trim().length < 2} className="min-h-11 w-full rounded-xl border border-border text-sm disabled:opacity-40">
            Add skill
          </button>
          <p className="text-[11px] text-muted">It starts with a 10, 30, or 45 minute daily goal and no milestones. Its page asks for milestones until they total 100.</p>
        </form>
      </section>
    </div>
  );
}

function FigureCard({ label, fig, id }: { label: string; fig: Data["now"] | null; id: string }) {
  return (
    <figure className="glass flex flex-col items-center p-2">
      {fig ? (
        <svg viewBox="22 8 56 122" className="h-48 w-full" role="img" aria-label={`${label}: overall ${fig.display ?? "unknown"}`}>
          <Figure id={`month-${id}`} tier={fig.tier ?? 1} scores={fig.scores as Partial<Record<Region, number>>} />
        </svg>
      ) : (
        <div className="grid h-48 place-items-center text-center text-xs text-muted">No snapshot from last month yet.</div>
      )}
      <figcaption className="text-xs text-muted">
        {label}
        {fig?.display != null && (
          <>
            : <span className="num text-text">{fig.display}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
