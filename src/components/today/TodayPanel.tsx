"use client";

import { motion, useAnimationControls } from "framer-motion";
import { Lock, Plus } from "lucide-react";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { completeGoal, pinSkill, saveNote, swapGoal, unpinSkill } from "@/app/actions";
import { Bottle } from "@/components/bottle/Bottle";
import { Sheet } from "@/components/ui/Sheet";
import type { Tier } from "@/engine/types";
import type { DashboardData, GoalView, SkillView } from "@/lib/data/dashboard";
import { emitPulse } from "@/lib/pulse";
import { playTink } from "@/lib/sound";

const TIER_LABEL: Record<Tier, string> = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
const OVERRIDE_LABEL: Record<string, string> = { exam_week: "Exam week", race_week: "Race week", sick: "Sick day", travel: "Travel" };
const LONG_PRESS_MS = 450;
const SWIPE_PX = 90;

type Props = Pick<DashboardData, "goals" | "rack" | "skills" | "categories" | "plan" | "soundOn">;

/** Focus Rack and today's checklist (spec 4.1 D): tap, long-press, swipe, pin. */
export function TodayPanel({ goals: serverGoals, rack, skills, categories, plan, soundOn }: Props) {
  const [goals, setOptimistic] = useOptimistic(serverGoals, (state, u: { id: string; tier: Tier | null; note?: string | null }) =>
    state.map((g) => (g.id === u.id ? { ...g, resultTier: u.tier, userNote: u.note === undefined ? g.userNote : u.note } : g)),
  );
  const [, startTransition] = useTransition();
  const [sheetGoal, setSheetGoal] = useState<GoalView | null>(null);
  const [pinSlot, setPinSlot] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const doneToday = useRef(goals.filter((g) => g.resultTier).length);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setMessage(r.error ?? "Something went wrong.");
    });

  const log = (g: GoalView, tier: Tier | null, note?: string | null) => {
    setMessage(null);
    run(async () => {
      setOptimistic({ id: g.id, tier, note });
      if (tier) {
        emitPulse(g.categoryId);
        if (soundOn) playTink(doneToday.current++);
      } else doneToday.current = Math.max(0, doneToday.current - 1);
      return completeGoal(g.id, tier, note);
    });
  };

  const groups = [
    { title: "Rack", goals: goals.filter((g) => g.kind === "rack") },
    { title: "Balance", goals: goals.filter((g) => g.kind === "balance") },
    { title: "Stretch (optional)", goals: goals.filter((g) => g.kind === "stretch") },
  ];

  return (
    <section id="today" aria-label="Today" className="scroll-mt-24 space-y-4">
      <div className="shelf flex items-end justify-between gap-1 rounded-card px-2 pt-3 pb-2">
        {rack.map(({ slot, skill, daysLocked }) => (
          <button
            key={slot}
            type="button"
            onClick={() => (skill && daysLocked > 0 ? setMessage(`${skill.name} is locked for ${daysLocked} more day${daysLocked === 1 ? "" : "s"}.`) : setPinSlot(slot))}
            className="flex min-h-11 w-1/5 flex-col items-center gap-1"
            aria-label={skill ? `${skill.name}, ${skill.display}${daysLocked ? `, locked ${daysLocked} days` : ""}` : `Empty slot ${slot}. Pin a skill`}
          >
            {skill ? (
              <>
                <Bottle shape={skill.shape} color={skill.color} level={skill.score} neglected={skill.neglected} className="h-14 w-9" />
                <span className="w-full truncate text-center text-[10px] leading-tight text-muted">{skill.name}</span>
                <span className="num flex items-center gap-0.5 text-[11px]">
                  {skill.display}
                  {daysLocked > 0 && (
                    <span className="flex items-center text-[9px] text-muted">
                      <Lock size={9} aria-hidden />
                      {daysLocked}d
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="flex h-14 w-9 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                <Plus size={16} aria-hidden />
              </span>
            )}
          </button>
        ))}
      </div>

      {(plan.overrides.length > 0 || plan.overBudget) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {plan.overrides.map((o) => (
            <span key={o} className="rounded-chip border border-border px-2.5 py-1">
              {OVERRIDE_LABEL[o] ?? o}
            </span>
          ))}
          {plan.overBudget && (
            <span>
              Over today&apos;s budget: <span className="num">{plan.plannedMin}</span> of <span className="num">{plan.budgetMin}</span> min.
            </span>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="rounded-xl border border-border px-3 py-2 text-sm text-muted">
          {message}
        </p>
      )}

      {goals.length === 0 && <p className="text-sm text-muted">No goals today.</p>}

      {groups.map(
        (group) =>
          group.goals.length > 0 && (
            <div key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-medium tracking-wider text-muted uppercase">{group.title}</h3>
              <ul className="space-y-2">
                {group.goals.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    canSwap={!plan.swapUsed && g.kind !== "stretch" && !g.resultTier}
                    onToggle={() => log(g, g.resultTier ? null : g.tier)}
                    onOpen={() => setSheetGoal(g)}
                    onSwap={() => run(() => swapGoal(g.id))}
                  />
                ))}
              </ul>
            </div>
          ),
      )}
      {!plan.swapUsed && goals.some((g) => g.kind !== "stretch" && !g.resultTier) && (
        <p className="text-center text-[11px] text-muted">Swipe a goal left to swap it. One swap per day.</p>
      )}

      <GoalSheet
        goal={sheetGoal ? (goals.find((g) => g.id === sheetGoal.id) ?? null) : null}
        canSwap={!plan.swapUsed}
        onClose={() => setSheetGoal(null)}
        onLog={(g, tier) => {
          log(g, tier);
          setSheetGoal(null);
        }}
        onNote={(g, note) => run(() => saveNote(g.id, note))}
        onSwap={(g) => {
          setSheetGoal(null);
          run(() => swapGoal(g.id));
        }}
      />

      <PinSheet
        slot={pinSlot}
        current={rack.find((r) => r.slot === pinSlot)?.skill ?? null}
        skills={skills}
        categories={categories}
        onClose={() => setPinSlot(null)}
        onPin={(id) => {
          const slot = pinSlot!;
          setPinSlot(null);
          run(() => pinSkill(slot, id));
        }}
        onUnpin={() => {
          const slot = pinSlot!;
          setPinSlot(null);
          run(() => unpinSkill(slot));
        }}
      />
    </section>
  );
}

function GoalRow({
  goal,
  canSwap,
  onToggle,
  onOpen,
  onSwap,
}: {
  goal: GoalView;
  canSwap: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onSwap: () => void;
}) {
  const done = goal.resultTier !== null;
  const stretch = goal.kind === "stretch";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const controls = useAnimationControls();
  const shownTier = goal.resultTier ?? goal.tier;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <li className="relative">
      {canSwap && (
        <span className="absolute inset-y-0 right-0 flex items-center rounded-card pr-4 text-xs text-gold" aria-hidden>
          Swap
        </span>
      )}
      <motion.div
        drag={canSwap ? "x" : false}
        dragConstraints={{ left: -140, right: 0 }}
        dragElastic={0.15}
        dragSnapToOrigin
        animate={controls}
        onDragStart={clear}
        onDragEnd={(_, info) => {
          if (info.offset.x < -SWIPE_PX) onSwap();
        }}
        onTapStart={() => {
          longPressed.current = false;
          clear();
          timer.current = setTimeout(() => {
            longPressed.current = true;
            onOpen();
          }, LONG_PRESS_MS);
        }}
        onTapCancel={clear}
        onTap={(event) => {
          clear();
          if (longPressed.current) return;
          // Buttons inside the row handle their own clicks.
          if ((event.target as HTMLElement).closest("button")) return;
          onToggle();
        }}
        className={`glass relative flex min-h-14 cursor-pointer touch-pan-y items-center gap-3 overflow-hidden py-2 pr-2 pl-4 select-none ${
          stretch ? "border-dashed" : ""
        }`}
        style={{ background: "#151517" }}
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: goal.color }} aria-hidden />
        <button
          type="button"
          onClick={() => !longPressed.current && onToggle()}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors"
          style={done ? { background: goal.color, borderColor: goal.color } : { borderColor: "var(--border)" }}
          aria-pressed={done}
          aria-label={`${done ? "Undo" : "Complete"}: ${goal.skillName}, ${goal.title}`}
        >
          {done && (
            <svg viewBox="0 0 20 20" className="size-5 text-bg" aria-hidden>
              <path d="M5 10.5l3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">
            {goal.skillName} <span aria-hidden>·</span> {goal.title}
          </p>
          <p className={`text-sm leading-snug ${done ? "text-muted line-through" : ""}`}>{goal.text}</p>
          {goal.note && <p className="mt-0.5 text-[11px] text-gold/90">{goal.note}</p>}
          {goal.userNote && <p className="mt-0.5 text-[11px] text-muted italic">{goal.userNote}</p>}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-11 shrink-0 flex-col items-end justify-center gap-1 pl-1"
          aria-label={`Options for ${goal.title}: tier, note, intention`}
        >
          <span
            className={`rounded-chip px-2 py-0.5 text-[10px] ${shownTier === "stretch" ? "bg-gold/15 text-gold" : "bg-white/5 text-muted"}`}
          >
            {TIER_LABEL[shownTier]}
          </span>
          {goal.estMin > 0 && <span className="num text-[11px] text-muted">{goal.estMin} min</span>}
        </button>
      </motion.div>
    </li>
  );
}

function GoalSheet({
  goal,
  canSwap,
  onClose,
  onLog,
  onNote,
  onSwap,
}: {
  goal: GoalView | null;
  canSwap: boolean;
  onClose: () => void;
  onLog: (g: GoalView, tier: Tier | null) => void;
  onNote: (g: GoalView, note: string) => void;
  onSwap: (g: GoalView) => void;
}) {
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const note = goal && draft?.id === goal.id ? draft.text : (goal?.userNote ?? "");

  return (
    <Sheet open={goal !== null} onClose={onClose} title={goal ? `${goal.skillName}: ${goal.title}` : ""}>
      {goal && (
        <div className="space-y-4">
          {goal.intention && <p className="font-display text-sm text-muted italic">{goal.intention}</p>}
          <div className="space-y-2">
            {(["floor", "standard", "stretch"] as Tier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onLog(goal, t)}
                className={`flex min-h-12 w-full items-start gap-3 rounded-xl border px-3 py-2 text-left ${
                  goal.resultTier === t ? "border-gold/60 bg-gold/10" : "border-border"
                }`}
              >
                <span className="w-16 shrink-0 pt-0.5 text-xs text-gold">{TIER_LABEL[t]}</span>
                <span className="text-sm">{goal.tierTexts?.[t] ?? (t === goal.tier ? goal.text : TIER_LABEL[t])}</span>
              </button>
            ))}
          </div>
          {goal.resultTier && (
            <button type="button" onClick={() => onLog(goal, null)} className="min-h-11 text-sm text-muted underline underline-offset-4">
              Undo
            </button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onNote(goal, note);
              onClose();
            }}
          >
            <label htmlFor="goal-note" className="sr-only">
              One-line note
            </label>
            <input
              id="goal-note"
              value={note}
              maxLength={200}
              onChange={(e) => setDraft({ id: goal.id, text: e.target.value })}
              placeholder="One-line note"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm outline-none focus:border-gold"
            />
            <button type="submit" className="min-h-11 rounded-xl border border-border px-4 text-sm">
              Save
            </button>
          </form>
          {goal.kind !== "stretch" && !goal.resultTier && (
            <button
              type="button"
              disabled={!canSwap}
              onClick={() => onSwap(goal)}
              className="min-h-11 w-full rounded-xl border border-border text-sm disabled:opacity-40"
            >
              {canSwap ? "Swap for the next-best goal" : "Today's swap is used"}
            </button>
          )}
          {goal.reason && <p className="text-[11px] text-muted">Why this goal: {goal.reason}</p>}
        </div>
      )}
    </Sheet>
  );
}

function PinSheet({
  slot,
  current,
  skills,
  categories,
  onClose,
  onPin,
  onUnpin,
}: {
  slot: number | null;
  current: SkillView | null;
  skills: SkillView[];
  categories: DashboardData["categories"];
  onClose: () => void;
  onPin: (skillId: string) => void;
  onUnpin: () => void;
}) {
  return (
    <Sheet open={slot !== null} onClose={onClose} title={current ? `Slot ${slot}: ${current.name}` : `Pin a skill to slot ${slot}`}>
      <p className="mb-3 text-xs text-muted">A pinned skill stays on the rack for 7 days.</p>
      {current && (
        <button type="button" onClick={onUnpin} className="mb-4 min-h-11 w-full rounded-xl border border-border text-sm">
          Remove {current.name} from the rack
        </button>
      )}
      {categories.map((c) => {
        const options = skills.filter((s) => s.categoryId === c.id && s.status === "active" && !s.pinned);
        if (!options.length) return null;
        return (
          <div key={c.id} className="mb-3">
            <h3 className="mb-1.5 text-[11px] tracking-wider uppercase" style={{ color: c.color }}>
              {c.name}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {options.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPin(s.id)}
                  className="flex min-h-12 items-center gap-2 rounded-xl border border-border px-2 text-left"
                >
                  <Bottle shape={s.shape} color={s.color} level={s.score} className="h-9 w-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="num text-xs text-muted">{s.display}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}
