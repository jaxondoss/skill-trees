"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";
import {
  addOverride,
  deleteKeyDate,
  deleteOverride,
  rebuildToday,
  saveKeyDate,
  startSemester,
  updateProfile,
  updateScheduleDay,
} from "@/app/settings-actions";
import { clearStarterLists } from "@/app/todo-actions";
import type { DayType } from "@/engine/types";

export type SettingsData = {
  profile: { rolloverHour: number; dailyBudgetMin: number; soundOn: boolean; timezone: string };
  template: { id: string; name: string; startsOn: string | null; endsOn: string | null } | null;
  days: { weekday: number; dayType: DayType; trainingTime: string | null }[];
  overrides: { id: string; kind: string; startsOn: string; endsOn: string; note: string | null }[];
  keyDates: { id: string; label: string; kind: "race" | "exam" | "other"; date: string | null; tentative: boolean; goal: string | null }[];
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_TYPES: [DayType, string][] = [
  ["class_light", "Light class day"],
  ["class_heavy", "Heavy class day"],
  ["weekend", "Weekend"],
  ["break", "Break"],
];
const OVERRIDES: [string, string][] = [
  ["exam_week", "Exam week"],
  ["race_week", "Race week"],
  ["sick", "Sick"],
  ["travel", "Travel or break"],
];
const input = "h-11 min-w-0 rounded-xl border border-border bg-black/30 px-3 text-sm";
const button = "min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40";

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, ok = "Saved.", after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error });
      if (r.ok) after?.();
    });
  const line = msg && (
    <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-nutrition" : "text-athletics"}`}>
      {msg.text}
    </p>
  );
  return { pending, run, line };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsClient({ data }: { data: SettingsData }) {
  return (
    <div className="space-y-8">
      <General profile={data.profile} />
      <Schedule data={data} />
      <Overrides overrides={data.overrides} />
      <KeyDates dates={data.keyDates} />
      <StartingContent />
      <Section title="Data">
        <a href="/api/export" className={`${button} inline-flex items-center`} download>
          Export everything (JSON)
        </a>
      </Section>
    </div>
  );
}

function General({ profile }: { profile: SettingsData["profile"] }) {
  const [form, setForm] = useState(profile);
  const { pending, run, line } = useAction();
  return (
    <Section title="General">
      <form
        className="glass space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateProfile(form));
        }}
      >
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Day starts at
            <span className="block text-[11px] text-muted">Work before this hour counts for the previous day.</span>
          </span>
          <select aria-label="Day starts at" value={form.rolloverHour} onChange={(e) => setForm({ ...form, rolloverHour: Number(e.target.value) })} className={`${input} num`}>
            {Array.from({ length: 13 }, (_, h) => (
              <option key={h} value={h}>
                {h === 0 ? "12 AM" : h === 12 ? "12 PM" : `${h} AM`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Daily skill time
            <span className="block text-[11px] text-muted">Training and zero-minute habits do not count.</span>
          </span>
          <span className="flex items-center gap-2">
            <input aria-label="Daily skill time" type="number" min={15} max={600} value={form.dailyBudgetMin} onChange={(e) => setForm({ ...form, dailyBudgetMin: Number(e.target.value) })} className={`${input} num w-20`} />
            <span className="text-xs text-muted">min</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Time zone</span>
          <input aria-label="Time zone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={`${input} w-48`} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span>Sound</span>
          <input type="checkbox" checked={form.soundOn} onChange={(e) => setForm({ ...form, soundOn: e.target.checked })} className="size-6 accent-[#D4AF37]" />
        </label>
        <button type="submit" disabled={pending} className={`${button} w-full`}>
          Save
        </button>
        {line}
      </form>
    </Section>
  );
}

function Schedule({ data }: { data: SettingsData }) {
  const [semester, setSemester] = useState({ name: "", startsOn: "", endsOn: "" });
  const { pending, run, line } = useAction();
  const t = data.template;
  return (
    <Section title={t ? `Weekly schedule: ${t.name}` : "Weekly schedule"}>
      {t && (
        <p className="num text-xs text-muted">
          {t.startsOn} to {t.endsOn}
        </p>
      )}
      <ul className="space-y-2">
        {data.days.map((d) => (
          <li key={d.weekday} className="glass flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="w-24 text-sm">{DAY_NAMES[d.weekday]}</span>
            <select
              aria-label={`${DAY_NAMES[d.weekday]} day type`}
              defaultValue={d.dayType}
              onChange={(e) => t && run(() => updateScheduleDay(t.id, { ...d, dayType: e.target.value as DayType }))}
              className={`${input} text-xs`}
            >
              {DAY_TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label={`${DAY_NAMES[d.weekday]} training time`}
              type="time"
              defaultValue={d.trainingTime ?? ""}
              onBlur={(e) => t && run(() => updateScheduleDay(t.id, { ...d, trainingTime: e.target.value || null }))}
              className={`${input} num text-xs`}
            />
          </li>
        ))}
      </ul>
      <button type="button" disabled={pending} onClick={() => run(() => rebuildToday(), "Today's plan will rebuild on the dashboard.")} className={`${button} w-full`}>
        Rebuild today&apos;s plan with these settings
      </button>
      <details className="glass p-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm">Start a new semester</summary>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => startSemester(semester), "New semester started from a copy of this week.");
          }}
        >
          <input aria-label="Semester name" placeholder="Spring 2027" value={semester.name} onChange={(e) => setSemester({ ...semester, name: e.target.value })} className={`${input} w-full`} />
          <div className="flex gap-2">
            <input aria-label="Semester starts" type="date" value={semester.startsOn} onChange={(e) => setSemester({ ...semester, startsOn: e.target.value })} className={`${input} num flex-1`} />
            <input aria-label="Semester ends" type="date" value={semester.endsOn} onChange={(e) => setSemester({ ...semester, endsOn: e.target.value })} className={`${input} num flex-1`} />
          </div>
          <button type="submit" disabled={pending} className={`${button} w-full`}>
            Start semester
          </button>
        </form>
      </details>
      {line}
    </Section>
  );
}

type OverrideKind = "exam_week" | "race_week" | "sick" | "travel";

function Overrides({ overrides }: { overrides: SettingsData["overrides"] }) {
  const [form, setForm] = useState<{ kind: OverrideKind; startsOn: string; endsOn: string }>({ kind: "exam_week", startsOn: "", endsOn: "" });
  const { pending, run, line } = useAction();
  const label = Object.fromEntries(OVERRIDES);
  return (
    <Section title="Day overrides">
      <p className="text-xs text-muted">
        Exam week lifts Academics to Stretch; Sick drops everything to Floor; Travel pauses Academics. Race week also turns on by itself in the 7 days before a race.
      </p>
      {overrides.length > 0 && (
        <ul className="space-y-1">
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-xl border border-border pl-3 text-sm">
              <span>
                {label[o.kind] ?? o.kind}{" "}
                <span className="num text-xs text-muted">
                  {o.startsOn} to {o.endsOn}
                </span>
              </span>
              <button type="button" onClick={() => run(() => deleteOverride(o.id), "Removed.")} className="flex size-11 items-center justify-center text-muted" aria-label={`Remove ${label[o.kind]}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addOverride(form), "Added. Use Rebuild if it starts today.", () => setForm({ ...form, startsOn: "", endsOn: "" }));
        }}
      >
        <select aria-label="Override" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OverrideKind })} className={`${input} w-full`}>
          {OVERRIDES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input aria-label="Override starts" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} className={`${input} num flex-1`} />
          <input aria-label="Override ends" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className={`${input} num flex-1`} />
        </div>
        <button type="submit" disabled={pending || !form.startsOn || !form.endsOn} className={`${button} w-full`}>
          Add override
        </button>
      </form>
      {line}
    </Section>
  );
}

function KeyDates({ dates }: { dates: SettingsData["keyDates"] }) {
  const { pending, run, line } = useAction();
  const [draft, setDraft] = useState<{ label: string; kind: "race" | "exam" | "other"; date: string; tentative: boolean; goal: string }>({ label: "", kind: "race", date: "", tentative: false, goal: "" });
  return (
    <Section title="Races and key dates">
      <p className="text-xs text-muted">Races drive Race Build (running outranks lifting in the last 4 weeks) and Race Week.</p>
      <ul className="space-y-2">
        {dates.map((d) => (
          <KeyDateRow key={d.id} d={d} />
        ))}
      </ul>
      <form
        className="glass space-y-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveKeyDate(null, { ...draft, date: draft.date || null, goal: draft.goal || null }), "Added.", () => setDraft({ ...draft, label: "", date: "", goal: "" }));
        }}
      >
        <div className="flex gap-2">
          <input aria-label="New date name" placeholder="Name" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={`${input} flex-1`} />
          <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as typeof draft.kind })} className={input}>
            <option value="race">Race</option>
            <option value="exam">Exam</option>
            <option value="other">Other</option>
          </select>
        </div>
        <input aria-label="New date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${input} num w-full`} />
        <button type="submit" disabled={pending || !draft.label} className={`${button} w-full`}>
          Add date
        </button>
      </form>
      {line}
    </Section>
  );
}

function KeyDateRow({ d }: { d: SettingsData["keyDates"][number] }) {
  const [form, setForm] = useState({ label: d.label, kind: d.kind, date: d.date ?? "", tentative: d.tentative, goal: d.goal ?? "" });
  const { pending, run, line } = useAction();
  return (
    <li className="glass space-y-2 p-3">
      <div className="flex items-center gap-2">
        <input aria-label={`${d.label} name`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={`${input} flex-1`} />
        <button type="button" onClick={() => run(() => deleteKeyDate(d.id), "Removed.")} className="flex size-11 items-center justify-center text-muted" aria-label={`Delete ${d.label}`}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input aria-label={`${d.label} date`} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${input} num flex-1`} />
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={form.tentative} onChange={(e) => setForm({ ...form, tentative: e.target.checked })} className="size-5 accent-[#D4AF37]" />
          Tentative
        </label>
      </div>
      <input aria-label={`${d.label} goal`} placeholder="Goal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className={`${input} w-full`} />
      <button type="button" disabled={pending} onClick={() => run(() => saveKeyDate(d.id, { ...form, date: form.date || null, goal: form.goal || null }))} className={`${button} w-full`}>
        Save
      </button>
      {line}
    </li>
  );
}

/** Opt in to empty to-do lists (spec v2 r2, 7). Typed confirmation; claimed steps stay. */
function StartingContent() {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Section title="Starting content">
      <div className="glass space-y-3 p-4 text-sm">
        <p className="text-muted">
          New accounts start with an empty to-do list on every skill. This account was set up with the starter goals and steps. Clear them to fill each list in yourself; claimed steps stay, so no level is lost.
        </p>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={button}>
            Start with empty lists
          </button>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await clearStarterLists(word);
                if (!r.ok) return setResult(r.error);
                setResult(`Cleared ${r.data.goals} goals and ${r.data.steps} open steps. Starter ideas are on each skill page.`);
                setOpen(false);
                setWord("");
              });
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs text-muted">Type clear to remove every goal and every open step</span>
              <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" aria-label="Type clear to confirm" className={`${input} w-full`} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className={button}>
                Cancel
              </button>
              <button type="submit" disabled={pending || word.trim().toLowerCase() !== "clear"} className={`${button} disabled:opacity-40`}>
                {pending ? "Clearing…" : "Clear the lists"}
              </button>
            </div>
          </form>
        )}
        {result && (
          <p role="status" className="text-xs text-muted">
            {result}
          </p>
        )}
      </div>
    </Section>
  );
}
