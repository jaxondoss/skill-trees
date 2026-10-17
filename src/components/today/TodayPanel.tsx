"use client";

import { motion, useAnimationControls } from "framer-motion";
import { Lock, Plus } from "lucide-react";
import { addGoal } from "@/app/todo-actions";
import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { completeGoal, pinSkill, saveNote, swapGoal, unpinSkill } from "@/app/actions";
import { Bottle } from "@/components/bottle/Bottle";
import { useQueue } from "@/components/pwa/OfflineSync";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Sheet } from "@/components/ui/Sheet";
import type { Tier } from "@/engine/types";
import type { DashboardData, GoalView, SkillView } from "@/lib/data/dashboard";
import { enqueue, isNetworkError } from "@/lib/offline-queue";
import { centerOf, emitPulse } from "@/lib/pulse";
import { catClass } from "@/lib/palette";
import { playTink } from "@/lib/sound";

const TIER_LABEL: Record<Tier, string> = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
const OVERRIDE_LABEL: Record<string, string> = { exam_week: "Exam week", race_week: "Race week", sick: "Sick day", travel: "Travel" };
const LONG_PRESS_MS = 450;
const SWIPE_PX = 90;

type Props = Pick<DashboardData, "goals" | "rack" | "skills" | "categories" | "plan" | "soundOn"> & { catSlug: Record<string, string> };
const GAIN: Record<Tier, number> = { floor: 0.3, standard: 0.6, stretch: 1 };

/** Focus Rack and today's checklist (spec 4.1 D): tap, long-press, swipe, pin. */
export function TodayPanel({ goals: serverGoals, rack, skills, categories, plan, soundOn, catSlug }: Props) {
  // Logs waiting to sync from offline show as done until the server has them.
  const queue = useQueue();
  const base = useMemo(() => {
    if (!queue.length) return serverGoals;
    const byId = new Map(queue.map((q) => [q.goalId, q]));
    return serverGoals.map((g) => {
      const q = byId.get(g.id);
      return q ? { ...g, resultTier: q.tier, userNote: q.note === undefined ? g.userNote : q.note } : g;
    });
  }, [serverGoals, queue]);
  const [goals, setOptimistic] = useOptimistic(base, (state, u: { id: string; tier: Tier | null; note?: string | null }) =>
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

  const log = (g: GoalView, tier: Tier | null, note?: string | null, from?: Element | null) => {
    setMessage(null);
    const origin = centerOf(from ?? document.querySelector(`[data-goal="${g.id}"] button[aria-pressed]`));
    run(async () => {
      setOptimistic({ id: g.id, tier, note });
      if (tier) {
        emitPulse(g.categoryId, { category: catSlug[g.categoryId], gain: GAIN[tier], from: origin, skillId: g.skillId });
        if (soundOn) playTink(doneToday.current++);
      } else doneToday.current = Math.max(0, doneToday.current - 1);
      const offline = () =>
        enqueue({ goalId: g.id, tier, note, at: new Date().toISOString() })
          ? { ok: true as const }
          : { ok: false as const, error: "Offline, and this phone would not save the log. Try again when connected." };
      if (!navigator.onLine) return offline();
      try {
        return await completeGoal(g.id, tier, note);
      } catch (err) {
        if (isNetworkError(err)) return offline();
        throw err;
      }
    });
  };

  const groups = [
    { title: "Rack", goals: goals.filter((g) => g.kind === "rack") },
    { title: "Balance", goals: goals.filter((g) => g.kind === "balance") },
    { title: "Stretch (optional)", goals: goals.filter((g) => g.kind === "stretch") },
  ];

  const core = goals.filter((g) => g.kind !== "stretch");
  const doneCore = core.filter((g) => g.resultTier).length;
  const pct = core.length ? Math.round((100 * core.reduce((a, g) => a + (g.resultTier ? (g.resultTier === "floor" ? 0.5 : 1) : 0), 0)) / core.length) : 0;
  const addable = skills.filter((s) => s.status === "active");

  return (
    <section id="today" aria-label="Today" className="tile flex scroll-mt-24 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="lbl">Today</h2>
        <span className="num font-mono text-[11px] text-label">
          {doneCore} of {core.length} done
        </span>
      </div>
      <div className="-mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <b className="block h-full rounded-full bg-gradient-to-r from-[var(--r3)] to-[var(--r5)] shadow-[0_0_10px_var(--r4)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-5 gap-1.5" aria-label="Rack">
        {rack.map(({ slot, skill, daysLocked }) => (
          <button
            key={slot}
            type="button"
            onClick={() => (skill && daysLocked > 0 ? setMessage(`${skill.name} is locked for ${daysLocked} more day${daysLocked === 1 ? "" : "s"}.`) : setPinSlot(slot))}
            className={`sunk-row flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 ${skill ? catClass(catSlug[skill.categoryId]) : ""}`}
            data-cat={skill ? catSlug[skill.categoryId] : undefined}
            aria-label={skill ? `${skill.name}, ${skill.display}${daysLocked ? `, locked ${daysLocked} days` : ""}` : `Empty slot ${slot}. Pin a skill`}
          >
            {skill ? (
              <>
                <span className="w-full truncate text-center text-[10px] leading-tight font-semibold text-muted">{skill.name}</span>
                <span className="flex items-center gap-0.5 font-mono text-[12px] font-semibold text-[var(--ct)]">
                  <AnimatedNumber value={skill.display} />
                  {daysLocked > 0 && (
                    <span className="flex items-center text-[9px] text-label">
                      <Lock size={9} aria-hidden />
                      {daysLocked}d
                    </span>
                  )}
                </span>
              </>
            ) : (
              <Plus size={16} className="text-label" aria-hidden />
            )}
          </button>
        ))}
      </div>

      {(plan.overrides.length > 0 || plan.overBudget) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {plan.overrides.map((o) => (
            <span key={o} className="tier-chip">
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
        <p role="status" className="sunk-row px-3 py-2 text-sm text-muted">
          {message}
        </p>
      )}

      {goals.length === 0 && (
        <div className="grid place-items-center gap-1.5 rounded-[10px] border border-dashed border-white/10 bg-[rgba(16,16,24,0.5)] px-4 py-7 text-center text-muted">
          <b className="text-sm text-text">Nothing planned for today</b>
          <span className="text-xs">Add a goal below or on any skill page. Goals repeat on the days you pick.</span>
        </div>
      )}

      {groups.map(
        (group) =>
          group.goals.length > 0 && (
            <div key={group.title} className="space-y-1.5">
              <h3 className="lbl">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.goals.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    cat={catSlug[g.categoryId] ?? ""}
                    canSwap={!plan.swapUsed && g.kind !== "stretch" && !g.resultTier}
                    onToggle={(el) => log(g, g.resultTier ? null : g.tier, undefined, el)}
                    onOpen={() => setSheetGoal(g)}
                    onSwap={() => run(() => swapGoal(g.id))}
                  />
                ))}
              </ul>
            </div>
          ),
      )}
      {!plan.swapUsed && goals.some((g) => g.kind !== "stretch" && !g.resultTier) && (
        <p className="text-center text-[11px] text-label">Swipe a goal left to swap it. One swap per day. Hold a goal for tiers and notes.</p>
      )}

      <AddToday skills={addable} onAdd={(skillId, title) => run(async () => addGoal(skillId, title, { today: true }))} />

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

function AddToday({ skills, onAdd }: { skills: SkillView[]; onAdd: (skillId: string, title: string) => void }) {
  const [title, setTitle] = useState("");
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  if (!skills.length) return null;
  return (
    <form
      className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 pt-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd(skillId, title.trim());
        setTitle("");
      }}
    >
      <label htmlFor="add-today" className="sr-only">
        New goal for today
      </label>
      <input
        id="add-today"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={140}
        autoComplete="off"
        placeholder="Add a goal for today…"
        className="field-input min-w-0 text-sm"
      />
      <label htmlFor="add-today-skill" className="sr-only">
        Skill
      </label>
      <select
        id="add-today-skill"
        name="skill"
        value={skillId}
        onChange={(e) => setSkillId(e.target.value)}
        className="field-input text-sm max-sm:col-span-2 max-sm:row-start-1"
      >
        {skills.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button type="submit" className="min-h-10 rounded-lg border border-[var(--border)] bg-raised px-3 text-xs font-bold hover:border-[var(--border-strong)]">
        Add
      </button>
    </form>
  );
}

function GoalRow({
  goal,
  cat,
  canSwap,
  onToggle,
  onOpen,
  onSwap,
}: {
  goal: GoalView;
  cat: string;
  canSwap: boolean;
  onToggle: (el: Element | null) => void;
  onOpen: () => void;
  onSwap: () => void;
}) {
  const done = goal.resultTier !== null;
  const stretch = goal.kind === "stretch";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const checkRef = useRef<HTMLButtonElement>(null);
  const controls = useAnimationControls();
  const shownTier = goal.resultTier ?? goal.tier;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <li className={`relative ${catClass(cat)}`} data-cat={cat} data-goal={goal.id}>
      {canSwap && (
        <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs text-gold" aria-hidden>
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
          onToggle(checkRef.current);
        }}
        className={`sunk-row relative flex min-h-12 cursor-pointer touch-pan-y items-center gap-1.5 py-0.5 pr-1.5 pl-0.5 select-none ${stretch ? "border-dashed !border-white/10" : ""}`}
      >
        <button
          ref={checkRef}
          type="button"
          onClick={() => !longPressed.current && onToggle(checkRef.current)}
          className="flex size-11 shrink-0 items-center justify-center"
          aria-pressed={done}
          aria-label={`${done ? "Undo" : "Complete"}: ${goal.skillName}, ${goal.title}`}
        >
          <span className={`check-dot ${done ? "on" : ""}`}>
            {done && (
              <svg viewBox="0 0 20 20" className="size-3.5 text-[var(--on-cat)]" aria-hidden>
                <path d="M5 10.5l3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1 py-1.5">
          <p className={`text-[13px] leading-[17px] font-bold ${done ? "text-muted" : ""}`}>{goal.title}</p>
          <p className="text-[11.5px] leading-[15px] text-muted">
            <span className="mr-1.5 font-semibold whitespace-nowrap text-[var(--ct)]">{goal.skillName}</span>
            {goal.text}
          </p>
          {goal.note && <p className="mt-0.5 text-[11px] text-gold/90">{goal.note}</p>}
          {goal.userNote && <p className="mt-0.5 text-[11px] text-muted italic">{goal.userNote}</p>}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-11 shrink-0 flex-col items-end justify-center gap-1 pl-1"
          aria-label={`Options for ${goal.title}: tier, note, intention`}
        >
          <span className={`tier-chip ${shownTier === "stretch" ? "gold" : ""}`}>{TIER_LABEL[shownTier]}</span>
          {goal.estMin > 0 && <span className="num font-mono text-[11px] text-label max-sm:hidden">{goal.estMin}m</span>}
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
