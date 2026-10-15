"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeOnboarding } from "@/app/skill-actions";
import type { DayType } from "@/engine/types";
import { APP_NAME } from "@/lib/brand";
import type { OnboardingData } from "@/lib/data/onboarding";

const PRINCIPLES = [
  ["Identity over outcomes.", "Each log is a vote for who you are becoming."],
  ["Honest numbers or no numbers.", "Every point is earned against a milestone, a metric, or logged consistency."],
  ["The 85% zone.", "Goals aim for about 85% completion. 100% every day means they are too easy."],
  ["Thirty seconds or it dies.", "A full day of logging takes under 30 seconds."],
  ["Forgiving, never fake.", "A miss costs something visible but never erases earned capability."],
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_TYPES: { value: DayType; label: string }[] = [
  { value: "class_light", label: "Light class day" },
  { value: "class_heavy", label: "Heavy class day" },
  { value: "weekend", label: "Weekend" },
  { value: "break", label: "Break" },
];
const STEPS = ["Principles", "Schedule", "Milestones", "Baselines", "Focus Rack", "Focus line"];

export function Onboarding({ data }: { data: OnboardingData }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [schedule, setSchedule] = useState(data.schedule);
  const [claims, setClaims] = useState<string[]>(data.suggested.map((m) => m.id));
  const [baselines, setBaselines] = useState(data.baselines.map((b) => ({ ...b, text: b.value === null ? "" : String(b.value) })));
  const [chess, setChess] = useState(data.chess);
  const [rack, setRack] = useState<string[]>(data.rack.slice(0, 5));
  const [focusLine, setFocusLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const finish = () =>
    start(async () => {
      setError(null);
      const r = await completeOnboarding({
        claims,
        metrics: baselines.filter((b) => b.text.trim() !== "" && Number.isFinite(Number(b.text))).map((b) => ({ skillId: b.skillId, key: b.key, value: Number(b.text) })),
        rack,
        schedule: schedule.map((d) => ({ weekday: d.weekday, dayType: d.dayType, trainingTime: d.trainingTime })),
        chess: { platform: chess.platform, username: chess.username },
        focusLine,
      });
      if (!r.ok) setError(r.error);
      else router.push("/");
    });

  const toggle = <T,>(list: T[], item: T, max = Infinity) => (list.includes(item) ? list.filter((x) => x !== item) : list.length < max ? [...list, item] : list);
  const input = "h-11 rounded-xl border border-border bg-black/30 px-3 text-sm";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className="font-display text-gold">{APP_NAME}</span>
        <span className="num text-xs text-muted">
          {step + 1} / {STEPS.length}: {STEPS[step]}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-gold" : "bg-white/10"}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="flex-1 space-y-4"
          aria-label={STEPS[step]}
        >
          {step === 0 && (
            <>
              <h1 className="font-display text-3xl leading-tight">Every log is a vote for who you are becoming.</h1>
              <ol className="space-y-3">
                {PRINCIPLES.map(([head, body], i) => (
                  <li key={head} className="flex gap-3">
                    <span className="num mt-0.5 text-sm text-gold">{i + 1}</span>
                    <p className="text-sm">
                      <span className="font-medium">{head}</span> <span className="text-muted">{body}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="font-display text-2xl">Your week</h1>
              <p className="text-sm text-muted">Prefilled from your Fall 2026 schedule. Times marked with a dot were read from your planner grid; check them.</p>
              <ul className="space-y-2">
                {schedule.map((d, i) => (
                  <li key={d.weekday} className="glass space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{DAY_NAMES[d.weekday]}</span>
                      <select
                        aria-label={`${DAY_NAMES[d.weekday]} day type`}
                        value={d.dayType}
                        onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, dayType: e.target.value as DayType } : x)))}
                        className={`${input} h-11 text-xs`}
                      >
                        {DAY_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {d.classes.length > 0 && (
                      <p className="text-[11px] leading-relaxed text-muted">
                        {d.classes.map((c) => `${c.course} ${c.start}${c.confirm ? " •" : ""}`).join(", ")}
                      </p>
                    )}
                    <label className="flex items-center justify-between gap-2 text-xs text-muted">
                      Training
                      <input
                        type="time"
                        value={d.trainingTime ?? ""}
                        onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, trainingTime: e.target.value || null } : x)))}
                        className={`${input} num h-11 text-xs`}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-display text-2xl">Milestones you already hold</h1>
              <p className="text-sm text-muted">Uncheck anything that is not true yet. Honest numbers or no numbers.</p>
              <ul className="space-y-2">
                {data.suggested.map((m) => {
                  const on = claims.includes(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setClaims(toggle(claims, m.id))}
                        className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left ${on ? "border-gold/50 bg-gold/[0.06]" : "border-border"}`}
                      >
                        <span className={`flex size-6 items-center justify-center rounded-md border ${on ? "border-gold bg-gold text-bg" : "border-border"}`}>{on ? "✓" : ""}</span>
                        <span className="flex-1">
                          <span className="block text-[11px]" style={{ color: m.color }}>
                            {m.skillName}
                          </span>
                          <span className="block text-sm">{m.title}</span>
                        </span>
                        <span className="num text-xs text-muted">+{m.points}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-display text-2xl">Baselines</h1>
              <p className="text-sm text-muted">Where you are today. Leave a field empty to skip it. The reading test lives on the Reading page.</p>
              <div className="space-y-2">
                {baselines.map((b, i) => (
                  <label key={b.key} className="glass flex items-center justify-between gap-3 p-3">
                    <span className="text-sm">{b.label}</span>
                    <span className="flex items-center gap-2">
                      <input
                        inputMode="decimal"
                        value={b.text}
                        onChange={(e) => setBaselines(baselines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                        className={`${input} num w-24 text-right`}
                      />
                      <span className="w-6 text-xs text-muted">{b.unit}</span>
                    </span>
                  </label>
                ))}
                <div className="glass space-y-2 p-3">
                  <span className="text-sm">Chess account (for rating sync later)</span>
                  <div className="flex gap-2">
                    {(["chess.com", "lichess"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={chess.platform === p}
                        onClick={() => setChess({ ...chess, platform: chess.platform === p ? null : p })}
                        className={`min-h-11 flex-1 rounded-xl border text-sm ${chess.platform === p ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Chess username"
                    placeholder="Username"
                    value={chess.username}
                    onChange={(e) => setChess({ ...chess, username: e.target.value })}
                    className={`${input} w-full`}
                  />
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="font-display text-2xl">Focus Rack</h1>
              <p className="text-sm text-muted">
                Up to 5 skills get a goal every day they are scheduled. Each pin locks for 7 days. <span className="num">{rack.length}</span> / 5 chosen.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {data.skills.map((s) => {
                  const idx = rack.indexOf(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={idx >= 0}
                      onClick={() => setRack(toggle(rack, s.id, 5))}
                      className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left ${idx >= 0 ? "border-gold/50 bg-gold/[0.06]" : "border-border"}`}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="flex-1 text-sm leading-tight">{s.name}</span>
                      {idx >= 0 && <span className="num text-xs text-gold">{idx + 1}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="font-display text-2xl">This week&apos;s focus line</h1>
              <p className="text-sm text-muted">One short line you will see under the banner all week. You rewrite it every Sunday.</p>
              <input
                aria-label="Focus line"
                value={focusLine}
                maxLength={80}
                onChange={(e) => setFocusLine(e.target.value)}
                placeholder="Win the morning"
                className={`${input} w-full font-display text-lg italic`}
              />
            </>
          )}
        </motion.section>
      </AnimatePresence>

      {error && (
        <p role="alert" className="text-sm text-athletics">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="min-h-12 flex-1 rounded-xl border border-border text-sm">
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={step === 4 && rack.length === 0}
            onClick={() => setStep(step + 1)}
            className="min-h-12 flex-[2] rounded-xl bg-gold font-medium text-bg disabled:opacity-50"
          >
            Continue
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={finish} className="min-h-12 flex-[2] rounded-xl bg-gold font-medium text-bg disabled:opacity-60">
            {pending ? "Setting up" : "Start"}
          </button>
        )}
      </div>
    </div>
  );
}
