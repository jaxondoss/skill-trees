"use client";

import { Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/app/actions";
import {
  addAssignment,
  addMeal,
  completeSkillGoalToday,
  connectChess,
  deleteAssignment,
  disconnect,
  logDaily,
  logSleep,
  saveWoop,
  syncNow,
  updateAssignment,
} from "@/app/tracker-actions";
import type { Tracker } from "@/lib/data/skill";
import { playTink } from "@/lib/sound";
import { MealPhoto } from "./MealPhoto";
import { ReadingTest } from "./ReadingTest";
import { useAction } from "./useAction";

const input = "h-11 min-w-0 rounded-xl border border-border bg-black/30 px-3 text-sm";
const button = "min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40";

export function SkillTracker({ tracker, color }: { tracker: Tracker; color: string }) {
  switch (tracker.kind) {
    case "sleep":
      return <SleepTracker t={tracker} />;
    case "food":
      return <FoodTracker t={tracker} color={color} />;
    case "gut":
      return <Scale label="How do you feel today? Energy and digestion, 1 to 5." values={[1, 2, 3, 4, 5]} current={tracker.today} onPick={(v) => logDaily("gut_rating", v)} />;
    case "adherence":
      return (
        <Scale
          label="Tonight: how many of today's blocks did you keep?"
          values={[0, 25, 50, 75, 100]}
          suffix="%"
          current={tracker.today}
          onPick={(v) => logDaily("block_adherence_pct", v)}
        />
      );
    case "assignments":
      return <Assignments t={tracker} />;
    case "chess":
      return <Chess t={tracker} />;
    case "timer":
      return <MeditationTimer />;
    case "woop":
      return <WoopFlow />;
    case "reading":
      return <ReadingTest t={tracker} />;
    default:
      return null;
  }
}

function SleepTracker({ t }: { t: Extract<Tracker, { kind: "sleep" }> }) {
  const { pending, run, line } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Tonight&apos;s anchor: <span className="num text-text">{t.anchorTonight}</span>. In window means within 45 minutes of it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={pending || t.open} onClick={() => run(() => logSleep("sleep"), "Good night.")} className={`${button} flex items-center justify-center gap-2`}>
          <Moon size={16} aria-hidden /> Going to sleep
        </button>
        <button type="button" disabled={pending || !t.open} onClick={() => run(() => logSleep("wake"), "Morning logged.")} className={`${button} flex items-center justify-center gap-2`}>
          <Sun size={16} aria-hidden /> Awake
        </button>
      </div>
      {line}
      {t.nights.length > 0 && (
        <ul className="space-y-1 text-xs">
          {t.nights.map((n) => (
            <li key={n.day + n.bedtime} className="flex justify-between text-muted">
              <span className="num">{n.day.slice(5)}</span>
              <span className="num">{n.bedtime}</span>
              <span className="num text-text">{n.hours === null ? "--" : `${n.hours.toFixed(1)} h`}</span>
              <span className={n.inWindow ? "text-nutrition" : "text-athletics"}>{n.inWindow ? "In window" : "Outside"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FoodTracker({ t, color }: { t: Extract<Tracker, { kind: "food" }>; color: string }) {
  const [meal, setMeal] = useState({ calories: "", proteinG: "", fiberG: "" });
  const { pending, run, line } = useAction();
  const bars: [string, number, number, string][] = [
    ["Calories", t.totals.calories, t.targets.calories, ""],
    ["Protein", t.totals.proteinG, t.targets.proteinG, " g"],
    ["Fiber", t.totals.fiberG, t.targets.fiberG, " g"],
  ];
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {bars.map(([label, value, target, unit]) => (
          <div key={label}>
            <div className="flex justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="num">
                {Math.round(value)}
                {unit} / {target}
                {unit}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (100 * value) / target)}%`, background: color }} />
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted">
          <span className="num">{t.meals}</span> meals logged today.{t.claude ? "" : " Photo logging turns on once GEMINI_API_KEY is set. Quick-add works now."}
        </p>
      </div>
      {t.claude && <MealPhoto />}
      <form
        className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addMeal({ calories: Number(meal.calories || 0), proteinG: Number(meal.proteinG || 0), fiberG: Number(meal.fiberG || 0) }),
            "Meal added.",
            () => setMeal({ calories: "", proteinG: "", fiberG: "" }),
          );
        }}
      >
        <input aria-label="Calories" inputMode="numeric" placeholder="kcal" value={meal.calories} onChange={(e) => setMeal({ ...meal, calories: e.target.value })} className={`${input} num`} />
        <input aria-label="Protein grams" inputMode="numeric" placeholder="protein g" value={meal.proteinG} onChange={(e) => setMeal({ ...meal, proteinG: e.target.value })} className={`${input} num`} />
        <input aria-label="Fiber grams" inputMode="numeric" placeholder="fiber g" value={meal.fiberG} onChange={(e) => setMeal({ ...meal, fiberG: e.target.value })} className={`${input} num`} />
        <button type="submit" disabled={pending || !meal.calories} className={button}>
          Add
        </button>
      </form>
      {line}
    </div>
  );
}

function Scale({ label, values, suffix = "", current, onPick }: { label: string; values: number[]; suffix?: string; current: number | null; onPick: (v: number) => Promise<ActionResult> }) {
  const { pending, run, line } = useAction();
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{label}</p>
      <div className="flex gap-2" role="group" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            disabled={pending}
            aria-pressed={current === v}
            onClick={() => run(() => onPick(v))}
            className={`num min-h-12 flex-1 rounded-xl border text-sm ${current === v ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
          >
            {v}
            {suffix}
          </button>
        ))}
      </div>
      {line}
    </div>
  );
}

function Assignments({ t }: { t: Extract<Tracker, { kind: "assignments" }> }) {
  const [form, setForm] = useState({ name: "", course: "", due: "" });
  const { pending, run, line } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Start every assignment 48 hours before it is due. An unstarted one due within 48 hours becomes today&apos;s Academics goal.</p>
      {t.items.length > 0 && (
        <ul className="space-y-2">
          {t.items.map((a) => {
            const urgent = a.urgent;
            return (
              <li key={a.id} className={`rounded-xl border p-3 ${urgent ? "border-athletics/50" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm">{a.course ? `${a.course}: ${a.name}` : a.name}</p>
                    <p className="num text-[11px] text-muted">
                      Due {new Date(a.dueAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {urgent && <span className="text-athletics">, within 48 hours</span>}
                    </p>
                  </div>
                  <button type="button" onClick={() => run(() => deleteAssignment(a.id))} className="flex size-11 shrink-0 items-center justify-center text-muted" aria-label={`Delete ${a.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button type="button" aria-pressed={a.started} onClick={() => run(() => updateAssignment(a.id, { started: !a.started }))} className={`min-h-11 rounded-chip border px-3 text-xs ${a.started ? "border-gold/60 text-gold" : "border-border text-muted"}`}>
                    {a.started ? "Started" : "Mark started"}
                  </button>
                  <button type="button" onClick={() => run(() => updateAssignment(a.id, { submitted: true }), "Submitted.")} className="min-h-11 rounded-chip border border-border px-3 text-xs text-muted">
                    Submitted
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.due) return;
          run(() => addAssignment({ name: form.name, course: form.course || null, dueAt: new Date(form.due).toISOString() }), "Added.", () => setForm({ name: "", course: "", due: "" }));
        }}
      >
        <div className="flex gap-2">
          <input aria-label="Course" placeholder="Course" value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} className={`${input} w-28`} />
          <input aria-label="Assignment" placeholder="Assignment" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} flex-1`} />
        </div>
        <div className="flex gap-2">
          <input aria-label="Due" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={`${input} num flex-1`} />
          <button type="submit" disabled={pending || !form.name || !form.due} className={button}>
            Add
          </button>
        </div>
      </form>
      {line}
    </div>
  );
}

function Chess({ t }: { t: Extract<Tracker, { kind: "chess" }> }) {
  const [form, setForm] = useState({ platform: (t.connection?.platform as "lichess" | "chess.com") || "lichess", username: t.connection?.username ?? "", timeControl: (t.connection?.timeControl as "rapid") ?? "rapid" });
  const { pending, run, line } = useAction();
  if (t.connection) {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          Syncing <span className="text-gold">{t.connection.username}</span> on {t.connection.platform}, {t.connection.timeControl}.
        </p>
        <p className="text-[11px] text-muted">
          {t.connection.lastSyncedAt ? `Last sync ${new Date(t.connection.lastSyncedAt).toLocaleString("en-US")}.` : "Not synced yet."} Re-syncs every 6 hours when you open the app.
        </p>
        {t.connection.lastError && <p className="text-xs text-athletics">Last sync failed: {t.connection.lastError}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => run(() => syncNow("chess"), "Synced.")} className={button}>
            Sync now
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => disconnect("chess"), "Disconnected. Manual entry still works.")} className={button}>
            Disconnect
          </button>
        </div>
        {line}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => connectChess(form), "Connected.");
      }}
    >
      <p className="text-sm text-muted">Connect a public account to sync your rating. Username only, no password.</p>
      <div className="flex gap-2">
        {(["lichess", "chess.com"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={form.platform === p} onClick={() => setForm({ ...form, platform: p })} className={`min-h-11 flex-1 rounded-xl border text-sm ${form.platform === p ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}>
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input aria-label="Chess username" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={`${input} flex-1`} />
        <select aria-label="Time control" value={form.timeControl} onChange={(e) => setForm({ ...form, timeControl: e.target.value as "rapid" })} className={input}>
          <option value="rapid">Rapid</option>
          <option value="blitz">Blitz</option>
          <option value="classical">Classical</option>
        </select>
      </div>
      <button type="submit" disabled={pending || !form.username} className={`${button} w-full`}>
        Connect
      </button>
      {line}
    </form>
  );
}

/** Minimal sit timer (spec 12.14): start, soft bell at the end, completes today's goal at the matching tier. */
function MeditationTimer() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(10);
  const [left, setLeft] = useState(0);
  const { run, line } = useAction();
  const done = useRef(false);

  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const ms = endsAt - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0 && !done.current) {
        done.current = true;
        playTink(0);
        setTimeout(() => playTink(4), 700);
        const tier = minutes >= 20 ? "stretch" : minutes >= 10 ? "standard" : "floor";
        run(() => completeSkillGoalToday("meditation", tier), `Sat ${minutes} minutes. Logged.`, () => setEndsAt(null));
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, minutes, run]);

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return (
    <div className="space-y-3">
      {endsAt ? (
        <div className="space-y-3 text-center">
          <p className="num font-display text-6xl" aria-live="off">
            {mm}:{String(ss).padStart(2, "0")}
          </p>
          <button type="button" onClick={() => setEndsAt(null)} className={button}>
            Stop
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2" role="group" aria-label="Sit length">
            {[3, 10, 20, 30].map((m) => (
              <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={`num min-h-11 flex-1 rounded-xl border text-sm ${minutes === m ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}>
                {m} min
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              done.current = false;
              setEndsAt(Date.now() + minutes * 60_000);
            }}
            className="min-h-12 w-full rounded-xl bg-gold font-medium text-bg"
          >
            Start
          </button>
          <p className="text-[11px] text-muted">3 min counts as Floor, 10 as Standard, 20 or more as Stretch.</p>
        </>
      )}
      {line}
    </div>
  );
}

const WOOP_STEPS = [
  { key: "wish", label: "Wish", hint: "What do you want from today's hardest goal?" },
  { key: "outcome", label: "Outcome", hint: "The best result, seen clearly." },
  { key: "obstacle", label: "Obstacle", hint: "What inside you is most likely to get in the way?" },
  { key: "plan", label: "Plan", hint: "If [obstacle], then I will [action]." },
] as const;

/** Guided WOOP (spec 12.15): four short fields, saved to the log; completes today's goal. */
function WoopFlow() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({ wish: "", outcome: "", obstacle: "", plan: "" });
  const { pending, run, line } = useAction();
  const current = WOOP_STEPS[step]!;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Mental contrasting: see the outcome, then the obstacle, then the if-then plan. Step <span className="num">{step + 1}</span> of 4.
      </p>
      <label className="block space-y-1">
        <span className="font-display text-lg text-gold">{current.label}</span>
        <input
          aria-label={current.label}
          value={values[current.key]}
          placeholder={current.hint}
          onChange={(e) => setValues({ ...values, [current.key]: e.target.value })}
          className={`${input} w-full`}
        />
      </label>
      <div className="flex gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className={`${button} flex-1`}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button type="button" disabled={!values[current.key].trim()} onClick={() => setStep(step + 1)} className={`${button} flex-[2]`}>
            Next
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !values.plan.trim()}
            onClick={() =>
              run(() => saveWoop(values), "WOOP saved to the log.", () => {
                setValues({ wish: "", outcome: "", obstacle: "", plan: "" });
                setStep(0);
              })
            }
            className="min-h-11 flex-[2] rounded-xl bg-gold text-sm font-medium text-bg disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
      {line}
    </div>
  );
}
