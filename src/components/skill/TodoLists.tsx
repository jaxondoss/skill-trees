"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { completeGoal } from "@/app/actions";
import { claimMilestone, unclaimMilestone } from "@/app/skill-actions";
import { addGoal, addStep, deleteGoal, deleteStep, updateGoal, updateStep } from "@/app/todo-actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatMetric } from "@/engine/metrics";
import type { Tier } from "@/engine/types";
import type { MilestoneView, SkillPageData } from "@/lib/data/skill";
import { centerOf, emitPulse } from "@/lib/pulse";
import { playPour, playTink } from "@/lib/sound";
import { createClient } from "@/lib/supabase/client";

type Result = { ok: boolean; error?: string };
type Goal = SkillPageData["nonNegotiables"][number];
const TIER_LABEL: Record<Tier, string> = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
const TIERS: Tier[] = ["floor", "standard", "stretch"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GAIN: Record<Tier, number> = { floor: 0.3, standard: 0.6, stretch: 1 };
const SIZES: [string, number][] = [
  ["Small", 5],
  ["Medium", 10],
  ["Large", 20],
];

const daysText = (d: number[]) => (d.length === 7 ? "Daily" : d.join() === "1,2,3,4,5" ? "Weekdays" : d.map((x) => DAYS[x]).join(" "));

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else after?.();
    });
  return { pending, error, run };
}

function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-[10px] border border-dashed border-white/10 bg-[rgba(16,16,24,0.5)] px-4 py-7 text-center text-muted">
      <b className="text-sm text-text">{title}</b>
      <span className="text-xs">{body}</span>
      {children}
    </div>
  );
}

function Adder({ id, placeholder, onAdd, pending }: { id: string; placeholder: string; onAdd: (title: string) => void; pending: boolean }) {
  const [v, setV] = useState("");
  return (
    <form
      className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.trim()) return;
        onAdd(v.trim());
        setV("");
      }}
    >
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <input id={id} value={v} onChange={(e) => setV(e.target.value)} maxLength={140} autoComplete="off" placeholder={placeholder} className="field-input min-w-0 text-sm" />
      <button type="submit" disabled={pending} className="flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] bg-raised px-3 text-xs font-bold hover:border-[var(--border-strong)] disabled:opacity-60">
        <Plus size={14} aria-hidden />
        Add
      </button>
    </form>
  );
}

// ───────────────────────────── Goals (non-negotiables)

export function GoalsTile({ skillId, skillName, goals, ideas, soundOn, categoryId, categorySlug, active }: {
  skillId: string;
  skillName: string;
  goals: Goal[];
  ideas: SkillPageData["ideas"]["goals"];
  soundOn: boolean;
  categoryId: string;
  categorySlug: string;
  active: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  const [shown, setResult] = useOptimistic(goals, (state, u: { id: string; result: Tier | null }) =>
    state.map((g) => (g.todayGoal?.id === u.id ? { ...g, todayGoal: { ...g.todayGoal, result: u.result } } : g)),
  );

  const log = (g: Goal, el: Element | null) => {
    const t = g.todayGoal;
    if (!t) return;
    const next = t.result ? null : t.tier;
    run(async () => {
      setResult({ id: t.id, result: next });
      if (next) {
        emitPulse(categoryId, { category: categorySlug, gain: GAIN[next], from: centerOf(el), skillId });
        if (soundOn) playTink(0);
      }
      return completeGoal(t.id, next);
    });
  };

  const addIdea = (i: (typeof ideas)[number]) =>
    run(async () => {
      const r = await addGoal(skillId, i.name);
      if (!r.ok) return r;
      return updateGoal(r.data.id, { name: i.name, intention: "", texts: { floor: i.floor, standard: i.standard, stretch: i.stretch }, minutes: i.minutes, daysOfWeek: i.days });
    });

  return (
    <section className="tile flex flex-col" aria-label="Goals">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="lbl">Goals</h2>
        <span className="font-mono text-[11px] text-label">Repeat on the days you pick</span>
      </div>
      {shown.length ? (
        <ul className="grid gap-1.5">
          {shown.map((g) => (
            <GoalRow key={g.id} g={g} editing={editing === g.id} onEdit={() => setEditing(editing === g.id ? null : g.id)} onLog={(el) => log(g, el)} onDone={() => setEditing(null)} active={active} />
          ))}
        </ul>
      ) : (
        <Empty title="No goals yet" body={`What will you do for ${skillName}, and on which days?`}>
          {ideas.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {ideas.slice(0, 3).map((i) => (
                <button key={i.name} type="button" onClick={() => addIdea(i)} className="tier-chip flex min-h-7 items-center gap-1 hover:text-text">
                  <Plus size={12} aria-hidden />
                  {i.name}
                </button>
              ))}
            </div>
          )}
        </Empty>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-athletics">
          {error}
        </p>
      )}
      <Adder
        id={`add-goal-${skillId}`}
        placeholder={`Add a goal for ${skillName}…`}
        pending={pending}
        onAdd={(title) =>
          run(async () => {
            const r = await addGoal(skillId, title);
            if (r.ok) {
              setEditing(r.data.id);
              router.refresh();
            }
            return r;
          })
        }
      />
    </section>
  );
}

function GoalRow({ g, editing, onEdit, onLog, onDone, active }: { g: Goal; editing: boolean; onEdit: () => void; onLog: (el: Element | null) => void; onDone: () => void; active: boolean }) {
  const t = g.todayGoal;
  const done = !!t?.result;
  const shownTier = t?.result ?? t?.tier ?? g.defaultTier;
  return (
    <li className="sunk-row" data-goal-row={g.id}>
      <div className="flex min-h-12 items-center gap-1.5 py-0.5 pr-1.5 pl-0.5">
        <button
          type="button"
          disabled={!t || !active}
          onClick={(e) => onLog(e.currentTarget)}
          className="flex size-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
          aria-pressed={done}
          aria-label={t ? (done ? `Undo ${g.name} today` : `Mark ${g.name} done today`) : `${g.name} is not on today's plan`}
          title={t ? undefined : "Not on today's plan"}
        >
          <span className={`check-dot ${done ? "on" : ""}`} />
        </button>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 py-1.5 text-left">
          <span className={`block text-[13px] leading-[17px] font-bold ${done ? "text-muted" : ""}`}>{g.name}</span>
          <span className="block text-[11.5px] leading-[15px] text-muted">
            <span className="mr-1.5 font-semibold text-[var(--ct)]">{daysText(g.daysOfWeek)}</span>
            {g.intention || g.texts[shownTier]}
          </span>
        </button>
        <span className={`tier-chip ${shownTier === "stretch" ? "gold" : ""}`}>{TIER_LABEL[shownTier]}</span>
        {g.minutes[shownTier] > 0 && <span className="font-mono text-[11px] text-label max-sm:hidden">{g.minutes[shownTier]} min</span>}
        <button type="button" onClick={onEdit} aria-expanded={editing} aria-label={`Edit ${g.name}`} className="grid size-9 place-items-center rounded-lg text-label hover:bg-raised hover:text-text">
          <Pencil size={14} aria-hidden />
        </button>
      </div>
      {editing && <GoalEditor g={g} onDone={onDone} />}
    </li>
  );
}

function GoalEditor({ g, onDone }: { g: Goal; onDone: () => void }) {
  const [form, setForm] = useState({ name: g.name, intention: g.intention, texts: g.texts, minutes: g.minutes, daysOfWeek: g.daysOfWeek });
  const { pending, error, run } = useRun();
  return (
    <form
      className="mx-1.5 mb-2 grid gap-2.5 rounded-[9px] border border-[var(--border-strong)] bg-[#15151e] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateGoal(g.id, form), onDone);
      }}
    >
      <label className="grid gap-1 text-[11.5px] font-semibold text-muted">
        Name
        <input className="field-input text-sm text-text" value={form.name} maxLength={140} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[11.5px] font-semibold text-muted">
        What the task involves
        <textarea
          className="field-input text-sm text-text"
          rows={2}
          maxLength={200}
          value={form.intention}
          placeholder="Where, how, what counts as done"
          onChange={(e) => setForm({ ...form, intention: e.target.value })}
        />
      </label>
      {TIERS.map((t) => (
        <div key={t} className="grid grid-cols-[minmax(0,1fr)_76px] items-end gap-2">
          <label className="grid gap-1 text-[11.5px] font-semibold text-muted">
            {TIER_LABEL[t]}
            <input
              className="field-input text-sm text-text"
              value={form.texts[t]}
              maxLength={200}
              placeholder={t === "floor" ? "The bad-day minimum" : t === "standard" ? "What a normal day looks like" : "The great-day version"}
              onChange={(e) => setForm({ ...form, texts: { ...form.texts, [t]: e.target.value } })}
            />
          </label>
          <input
            type="number"
            min={0}
            max={600}
            inputMode="numeric"
            aria-label={`${TIER_LABEL[t]} minutes`}
            className="field-input font-mono text-sm text-text"
            value={form.minutes[t]}
            onChange={(e) => setForm({ ...form, minutes: { ...form.minutes, [t]: Number(e.target.value) || 0 } })}
          />
        </div>
      ))}
      <fieldset>
        <legend className="lbl mb-1.5">Repeats on</legend>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => {
            const on = form.daysOfWeek.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={d}
                onClick={() => setForm({ ...form, daysOfWeek: on ? form.daysOfWeek.filter((x) => x !== i) : [...form.daysOfWeek, i] })}
                className="size-9 rounded-lg border border-[var(--border)] bg-sunk text-[11px] font-bold text-muted aria-pressed:border-transparent aria-pressed:bg-[var(--tint)] aria-pressed:text-[var(--ct)]"
              >
                {d.slice(0, 1)}
              </button>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-athletics">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => run(() => deleteGoal(g.id), onDone)} className="min-h-9 px-2 text-xs font-bold text-muted hover:text-text">
          Delete
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="min-h-9 rounded-lg border border-[var(--border)] bg-raised px-3 text-xs font-bold">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="min-h-9 rounded-lg bg-[var(--c)] px-3 text-xs font-bold text-[var(--on-cat)] disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-label">Changes apply from tomorrow&apos;s plan.</p>
    </form>
  );
}

// ───────────────────────────── Steps (milestones)

export function StepsTile({ skillId, skillName, steps, ideas, soundOn }: { skillId: string; skillName: string; steps: MilestoneView[]; ideas: SkillPageData["ideas"]["steps"]; soundOn: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<MilestoneView | null>(null);
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, run } = useRun();
  const earned = steps.filter((s) => s.claimedAt).reduce((a, s) => a + s.points, 0);

  const claim = () =>
    run(
      async () => {
        if (!claiming) return { ok: true };
        let path: string | null = null;
        if (file) {
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          if (!data.user) return { ok: false, error: "Sign in again." };
          path = `${data.user.id}/${claiming.id}-${Date.now()}.${file.name.split(".").pop() ?? "jpg"}`;
          const up = await supabase.storage.from("proofs").upload(path, file, { upsert: false });
          if (up.error) return { ok: false, error: `Photo upload failed: ${up.error.message}` };
        }
        const r = await claimMilestone(claiming.id, { value: value ? Number(value) : null, path });
        if (r.ok && soundOn) playPour();
        return r;
      },
      () => {
        setClaiming(null);
        setValue("");
        setFile(null);
      },
    );

  return (
    <section className="tile flex flex-col" aria-label="Steps">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="lbl">Steps</h2>
        <span className="font-mono text-[11px] text-label">
          Level <b className="text-gold">{Math.min(100, earned)}</b> of 100
        </span>
      </div>
      {steps.length ? (
        <ul className="grid gap-1.5">
          {steps.map((m) => (
            <li key={m.id} className="sunk-row">
              <div className="flex min-h-12 items-center gap-1.5 py-0.5 pr-1.5 pl-0.5">
                <button
                  type="button"
                  onClick={() => (m.claimedAt ? run(() => unclaimMilestone(m.id)) : setClaiming(m))}
                  className="flex size-11 shrink-0 items-center justify-center"
                  aria-pressed={!!m.claimedAt}
                  aria-label={m.claimedAt ? `Claimed ${m.title}. Unclaim it` : `Claim ${m.title}`}
                >
                  <span className={`check-dot ${m.claimedAt ? "on" : ""}`} style={m.claimedAt ? { ["--c" as string]: "var(--gold)" } : undefined} />
                </button>
                <button type="button" onClick={() => setEditing(editing === m.id ? null : m.id)} className="min-w-0 flex-1 py-1.5 text-left">
                  <span className={`block text-[13px] leading-[17px] font-bold ${m.claimedAt ? "text-muted" : ""}`}>{m.title}</span>
                  {m.note && <span className="block text-[11.5px] leading-[15px] text-muted">{m.note}</span>}
                  {m.progress && !m.claimedAt && <StepProgress p={m.progress} />}
                  {m.claimedAt && (
                    <span className="block text-[11px] text-label">
                      Claimed {m.claimedAt.slice(0, 10)}
                      {m.proofValue !== null && <span className="ml-2 font-mono">Proof: {m.proofValue}</span>}
                    </span>
                  )}
                </button>
                {m.claimedAt && (
                  <button type="button" onClick={() => run(() => unclaimMilestone(m.id))} className="min-h-9 px-1.5 text-[11px] font-semibold text-label underline-offset-2 hover:text-text hover:underline">
                    Undo
                  </button>
                )}
                <span className={`font-mono text-[11px] font-semibold ${m.claimedAt ? "text-gold" : "text-label"}`}>+{m.points}</span>
                <button type="button" onClick={() => setEditing(editing === m.id ? null : m.id)} aria-expanded={editing === m.id} aria-label={`Edit ${m.title}`} className="grid size-9 place-items-center rounded-lg text-label hover:bg-raised hover:text-text">
                  <Pencil size={14} aria-hidden />
                </button>
              </div>
              {editing === m.id && <StepEditor m={m} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No steps yet" body={`The milestones between you and 100 in ${skillName}.`}>
          {ideas.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {ideas.slice(0, 3).map((i) => (
                <button key={i.title} type="button" onClick={() => run(() => addStep(skillId, i.title, i.points))} className="tier-chip flex min-h-7 max-w-full items-center gap-1 hover:text-text">
                  <Plus size={12} aria-hidden />
                  <span className="truncate">{i.title}</span>
                </button>
              ))}
            </div>
          )}
        </Empty>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-athletics">
          {error}
        </p>
      )}
      <Adder
        id={`add-step-${skillId}`}
        placeholder="Add a step…"
        pending={pending}
        onAdd={(title) =>
          run(async () => {
            const r = await addStep(skillId, title, 10);
            if (r.ok) {
              setEditing(r.data.id);
              router.refresh();
            }
            return r;
          })
        }
      />

      <Sheet open={claiming !== null} onClose={() => setClaiming(null)} title={claiming ? `Claim: ${claiming.title}` : ""}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            claim();
          }}
        >
          <p className="text-sm text-muted">Claim it only if it is true. Proof is optional and stays private.</p>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Proof number (optional)</span>
            <input type="number" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="field-input w-full font-mono text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Proof photo (optional)</span>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted" />
          </label>
          {error && (
            <p role="alert" className="text-xs text-athletics">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-gold font-bold text-bg disabled:opacity-60">
            {pending ? "Claiming…" : `Claim +${claiming?.points ?? 0}`}
          </button>
        </form>
      </Sheet>
    </section>
  );
}

function StepProgress({ p }: { p: NonNullable<MilestoneView["progress"]> }) {
  const show = (v: number) => formatMetric(p.def ?? undefined, v);
  const pct = p.current === null ? 0 : p.op === "gte" ? Math.min(1, p.current / p.target) : Math.min(1, p.target / Math.max(p.current, 1));
  return (
    <span className="mt-1 block">
      <span className="block text-[11px] text-muted">
        {p.label}: <span className="font-mono text-text">{p.current === null ? "--" : show(p.current)}</span> / <span className="font-mono">{show(p.target)}</span>
        {p.op === "lte" ? " or faster" : ""}
      </span>
      <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-white/5">
        <span className="block h-full rounded-full bg-[var(--c)]" style={{ width: `${pct * 100}%` }} />
      </span>
    </span>
  );
}

function StepEditor({ m, onDone }: { m: MilestoneView; onDone: () => void }) {
  const [form, setForm] = useState({ title: m.title, note: m.note ?? "", points: m.points });
  const { pending, error, run } = useRun();
  return (
    <form
      className="mx-1.5 mb-2 grid gap-2.5 rounded-[9px] border border-[var(--border-strong)] bg-[#15151e] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateStep(m.id, form), onDone);
      }}
    >
      <label className="grid gap-1 text-[11.5px] font-semibold text-muted">
        Step
        <input className="field-input text-sm text-text" value={form.title} maxLength={140} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[11.5px] font-semibold text-muted">
        Details
        <textarea
          className="field-input text-sm text-text"
          rows={2}
          maxLength={500}
          value={form.note}
          placeholder="What done looks like, links, who to ask"
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <fieldset>
        <legend className="lbl mb-1.5">Size</legend>
        <div className="inline-flex flex-wrap gap-[3px] rounded-[9px] border border-[var(--border)] bg-sunk p-[3px]">
          {SIZES.map(([label, pts]) => (
            <button key={label} type="button" aria-pressed={form.points === pts} onClick={() => setForm({ ...form, points: pts })} className="min-h-7 rounded-md px-3 text-xs font-semibold text-muted aria-pressed:bg-raised aria-pressed:text-text">
              {label}, {pts}
            </button>
          ))}
          {!SIZES.some(([, p]) => p === form.points) && (
            <span className="flex min-h-7 items-center rounded-md bg-raised px-3 font-mono text-xs text-text" aria-label={`${form.points} points`}>
              {form.points}
            </span>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-athletics">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!m.claimedAt ? (
          <button type="button" onClick={() => run(() => deleteStep(m.id), onDone)} className="min-h-9 px-2 text-xs font-bold text-muted hover:text-text">
            Delete
          </button>
        ) : (
          <span className="text-[11px] text-label">Claimed steps keep their points.</span>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="min-h-9 rounded-lg border border-[var(--border)] bg-raised px-3 text-xs font-bold">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="min-h-9 rounded-lg bg-[var(--c)] px-3 text-xs font-bold text-[var(--on-cat)] disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
