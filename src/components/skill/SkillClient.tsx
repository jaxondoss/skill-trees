"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { pinToFreeSlot } from "@/app/actions";
import {
  addLog,
  addMetric,
  addMilestone,
  claimMilestone,
  deleteMetric,
  markTipSeen,
  setSkillStatus,
  unclaimMilestone,
  updateNonNegotiable,
  updateSkill,
} from "@/app/skill-actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatMetric, parseDuration, type MetricDef } from "@/engine/metrics";
import type { Tier } from "@/engine/types";
import type { HeatDay, MilestoneView, SkillPageData } from "@/lib/data/skill";
import { createClient } from "@/lib/supabase/client";
import { playBell, playPour } from "@/lib/sound";

type Result = { ok: boolean; error?: string };
const TIER_LABEL: Record<Tier, string> = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function useAction() {
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

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-xs text-athletics">
      {error}
    </p>
  ) : null;
}

// ───────────────────────────── Heat strip

export function HeatStrip({ days, color }: { days: HeatDay[]; color: string }) {
  const done = days.filter((d) => d.state !== "missed" && d.state !== "none").length;
  const scheduled = days.filter((d) => d.state !== "none").length;
  return (
    <div>
      <div className="flex gap-[3px]" role="img" aria-label={`Last 28 days: done on ${done} of ${scheduled} scheduled days`}>
        {days.map((d) => (
          <span
            key={d.day}
            title={`${d.day}: ${d.state}`}
            className="h-4 flex-1 rounded-[3px]"
            style={{
              background:
                d.state === "none" ? "rgba(255,255,255,0.04)" : d.state === "missed" ? "#7A1018" : color,
              opacity: d.state === "floor" ? 0.55 : 1,
              boxShadow: d.state === "stretch" ? "inset 0 0 0 1px #D4AF37" : undefined,
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted">
        28 days: <span className="num">{done}</span> of <span className="num">{scheduled}</span> scheduled days done
      </p>
    </div>
  );
}

// ───────────────────────────── Non-negotiable editor

type NN = SkillPageData["nonNegotiables"][number];

export function NonNegotiableCard({ nn, color }: { nn: NN; color: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ texts: nn.texts, minutes: nn.minutes, intention: nn.intention, defaultTier: nn.defaultTier, daysOfWeek: nn.daysOfWeek });
  const { pending, error, run } = useAction();
  const tiers: Tier[] = ["floor", "standard", "stretch"];

  return (
    <div className="glass space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg">{nn.name}</h3>
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-2 text-xs text-muted underline underline-offset-4">
          Edit
        </button>
      </div>
      <dl className="space-y-1.5 text-sm">
        {tiers.map((t) => (
          <div key={t} className="flex gap-3">
            <dt className={`w-16 shrink-0 text-xs ${t === nn.defaultTier ? "text-gold" : "text-muted"}`}>{TIER_LABEL[t]}</dt>
            <dd className="flex-1">
              {nn.texts[t]}
              {nn.countsAgainstBudget && nn.minutes[t] > 0 && <span className="num text-xs text-muted"> ({nn.minutes[t]} min)</span>}
            </dd>
          </div>
        ))}
      </dl>
      {nn.intention && <p className="font-display text-sm text-muted italic">{nn.intention}</p>}
      <p className="text-[11px] text-muted">
        {nn.daysOfWeek.length === 7 ? "Every day" : nn.daysOfWeek.map((d) => WEEKDAYS[d]).join(", ")}
        {!nn.countsAgainstBudget && ". Outside the time budget"}
      </p>
      <HeatStrip days={nn.heat} color={color} />

      <Sheet open={open} onClose={() => setOpen(false)} title={`Edit ${nn.name}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateNonNegotiable(nn.id, form), () => setOpen(false));
          }}
        >
          {tiers.map((t) => (
            <div key={t} className="space-y-1">
              <label className="text-xs text-muted" htmlFor={`t-${t}`}>
                {TIER_LABEL[t]}
              </label>
              <div className="flex gap-2">
                <input
                  id={`t-${t}`}
                  value={form.texts[t]}
                  onChange={(e) => setForm({ ...form, texts: { ...form.texts, [t]: e.target.value } })}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  max={600}
                  aria-label={`${TIER_LABEL[t]} minutes`}
                  value={form.minutes[t]}
                  onChange={(e) => setForm({ ...form, minutes: { ...form.minutes, [t]: Number(e.target.value) } })}
                  className="num h-11 w-20 rounded-xl border border-border bg-black/30 px-2 text-sm"
                />
              </div>
            </div>
          ))}
          <label className="block space-y-1">
            <span className="text-xs text-muted">Implementation intention</span>
            <input
              value={form.intention}
              onChange={(e) => setForm({ ...form, intention: e.target.value })}
              className="h-11 w-full rounded-xl border border-border bg-black/30 px-3 text-sm"
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Default tier</legend>
            <div className="flex gap-2">
              {tiers.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={form.defaultTier === t}
                  onClick={() => setForm({ ...form, defaultTier: t })}
                  className={`min-h-11 flex-1 rounded-xl border text-sm ${form.defaultTier === t ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                >
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Days</legend>
            <div className="flex gap-1">
              {WEEKDAYS.map((w, d) => {
                const on = form.daysOfWeek.includes(d);
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForm({ ...form, daysOfWeek: on ? form.daysOfWeek.filter((x) => x !== d) : [...form.daysOfWeek, d] })}
                    className={`min-h-11 flex-1 rounded-lg border text-xs ${on ? "border-gold/60 bg-gold/10 text-gold" : "border-border text-muted"}`}
                  >
                    {w.slice(0, 2)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <ErrorLine error={error} />
          <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-60">
            Save. Applies from tomorrow&apos;s plan
          </button>
        </form>
      </Sheet>
    </div>
  );
}

// ───────────────────────────── Milestone ladder

export function MilestoneLadder({ milestones, color, soundOn }: { milestones: MilestoneView[]; color: string; soundOn: boolean }) {
  const [claiming, setClaiming] = useState<MilestoneView | null>(null);
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, run } = useAction();

  const submit = () =>
    run(async () => {
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
    }, () => {
      setClaiming(null);
      setValue("");
      setFile(null);
    });

  return (
    <ol className="relative space-y-2 border-l border-border pl-4">
      {milestones.map((m) => (
        <li key={m.id} className="relative">
          <span
            className="absolute top-3 -left-[21px] size-2.5 rounded-full"
            style={m.state === "claimed" ? { background: "#D4AF37" } : m.state === "next" ? { background: color } : { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}
            aria-hidden
          />
          <div
            className={`rounded-xl border p-3 ${
              m.state === "claimed" ? "border-gold/30 bg-gold/[0.06]" : m.state === "next" ? "border-white/20 bg-white/[0.04]" : "border-transparent opacity-55"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className={`text-sm ${m.state === "claimed" ? "text-gold" : ""}`}>{m.title}</p>
              <span className="num shrink-0 text-xs text-muted">+{m.points}</span>
            </div>
            {m.progress && m.state !== "claimed" && <Progress p={m.progress} color={color} />}
            {m.state === "claimed" && (
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
                <span>Claimed {m.claimedAt?.slice(0, 10)}</span>
                {m.proofValue !== null && <span className="num">Proof: {m.proofValue}</span>}
                {m.proofUrl && (
                  <a href={m.proofUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Photo
                  </a>
                )}
                <button type="button" onClick={() => run(() => unclaimMilestone(m.id))} className="min-h-8 underline underline-offset-2">
                  Undo
                </button>
              </div>
            )}
            {m.state !== "claimed" && m.type !== "streak" && (m.state === "next" || !m.progress) && (
              <button
                type="button"
                onClick={() => setClaiming(m)}
                className={`mt-2 min-h-10 rounded-chip px-4 text-xs ${m.state === "next" ? "bg-gold text-bg" : "border border-border text-muted"}`}
              >
                Claim
              </button>
            )}
          </div>
        </li>
      ))}
      <ErrorLine error={error} />

      <Sheet open={claiming !== null} onClose={() => setClaiming(null)} title={claiming ? `Claim: ${claiming.title}` : ""}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-muted">Claim it only if it is true. Proof is optional and stays private.</p>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Proof number (optional)</span>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="num h-11 w-full rounded-xl border border-border bg-black/30 px-3 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Proof photo (optional)</span>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted" />
          </label>
          <ErrorLine error={error} />
          <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-60">
            {pending ? "Claiming" : `Claim +${claiming?.points ?? 0}`}
          </button>
        </form>
      </Sheet>
    </ol>
  );
}

function Progress({ p, color }: { p: NonNullable<MilestoneView["progress"]>; color: string }) {
  const show = (v: number) => formatMetric(p.def ?? undefined, v);
  const pct =
    p.current === null ? 0 : p.op === "gte" ? Math.min(1, p.current / p.target) : Math.min(1, p.target / Math.max(p.current, 1));
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] text-muted">
        {p.label}: <span className="num text-text">{p.current === null ? "--" : show(p.current)}</span> / <span className="num">{show(p.target)}</span>
        {p.op === "lte" ? " or faster" : ""}
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

// ───────────────────────────── Metrics panel

export function MetricsPanel({ skillId, metrics, today }: { skillId: string; metrics: SkillPageData["metrics"]; today: string }) {
  return (
    <div className="space-y-3">
      {metrics.map((m) => (
        <MetricRow key={m.def.key} skillId={skillId} metric={m} today={today} />
      ))}
    </div>
  );
}

function MetricRow({ skillId, metric, today }: { skillId: string; metric: SkillPageData["metrics"][number]; today: string }) {
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const { pending, error, run } = useAction();
  const def: MetricDef = metric.def;
  const parse = () => (def.format === "time" ? parseDuration(value) : value === "" ? null : Number(value));

  return (
    <div className="glass space-y-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm">{def.label}</p>
        <p className="num text-lg">{metric.current === null ? "--" : formatMetric(def, metric.current)}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parse();
          if (v === null || Number.isNaN(v)) return;
          run(() => addMetric(skillId, def.key, v, day), () => setValue(""));
        }}
      >
        <input
          aria-label={`${def.label} value`}
          inputMode={def.format === "time" ? "text" : "decimal"}
          placeholder={def.format === "time" ? "h:mm:ss" : def.unit || "value"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="num h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm"
        />
        <input
          type="date"
          aria-label="Date"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value)}
          className="num h-11 w-[132px] rounded-xl border border-border bg-black/30 px-2 text-xs"
        />
        <button type="submit" disabled={pending || !value} className="min-h-11 rounded-xl border border-border px-3 text-sm disabled:opacity-40">
          Add
        </button>
      </form>
      <ErrorLine error={error} />
      {metric.entries.length > 0 && (
        <ul className="space-y-1">
          {(showAll ? metric.entries : metric.entries.slice(0, 3)).map((e) => (
            <li key={e.id} className="flex items-center justify-between text-xs text-muted">
              <span className="num">{e.day}</span>
              <span className="num text-text">{formatMetric(def, e.value)}</span>
              <button type="button" onClick={() => run(() => deleteMetric(e.id))} className="flex size-8 items-center justify-center" aria-label={`Delete ${e.day} entry`}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {metric.entries.length > 3 && (
            <li>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="min-h-8 text-xs text-muted underline underline-offset-2">
                {showAll ? "Show less" : `Show all ${metric.entries.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────── Log

export function LogPanel({ skillId, log }: { skillId: string; log: SkillPageData["log"] }) {
  const [text, setText] = useState("");
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addLog(skillId, text), () => setText(""));
        }}
      >
        <input
          aria-label="New log line"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="One line about today"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm"
        />
        <button type="submit" disabled={pending || !text.trim()} className="min-h-11 rounded-xl border border-border px-3 text-sm disabled:opacity-40">
          Log
        </button>
      </form>
      <ErrorLine error={error} />
      {log.length === 0 ? (
        <p className="text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {log.map((l, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="num w-20 shrink-0 text-xs text-muted">{l.day.slice(5)}</span>
              <span className={l.source === "goal" ? "text-muted italic" : ""}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────── Actions

export function SkillActions({ data }: { data: SkillPageData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"archived" | "dormant" | null>(null);
  const [form, setForm] = useState({ name: data.skill.name, identity: data.skill.identity, priorityWeight: data.skill.priorityWeight as 1 | 2 | 3 });
  const [ceiling, setCeiling] = useState({ title: "", points: 10 });
  const { pending, error, run } = useAction();
  const { status } = data.skill;

  const button = (label: string, onClick: () => void, disabled = false): ReactNode => (
    <button type="button" disabled={disabled || pending} onClick={onClick} className="min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40">
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      {data.atCeiling && status === "active" && (
        <form
          className="glass space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addMilestone(data.skill.id, ceiling), () => setCeiling({ title: "", points: 10 }));
          }}
        >
          <p className="text-sm">Every milestone is claimed. Raise the ceiling with a harder one.</p>
          <div className="flex gap-2">
            <input
              aria-label="New milestone"
              value={ceiling.title}
              onChange={(e) => setCeiling({ ...ceiling, title: e.target.value })}
              placeholder="Next milestone"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm"
            />
            <input
              type="number"
              aria-label="Points"
              min={1}
              max={30}
              value={ceiling.points}
              onChange={(e) => setCeiling({ ...ceiling, points: Number(e.target.value) })}
              className="num h-11 w-16 rounded-xl border border-border bg-black/30 px-2 text-sm"
            />
            <button type="submit" className="min-h-11 rounded-xl border border-border px-3 text-sm">
              Add
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {button("Edit", () => setEditing(true))}
        {status === "active" &&
          !data.rack.pinned &&
          button("Pin to rack", () => run(() => pinToFreeSlot(data.skill.id)))}
        {data.rack.pinned && <span className="flex min-h-11 items-center px-2 text-xs text-muted">On the rack{data.rack.daysLocked ? `, locked ${data.rack.daysLocked}d` : ""}</span>}
        {status === "dormant" && button("Awaken", () => run(() => setSkillStatus(data.skill.id, "active")))}
        {status === "archived" && button("Restore", () => run(() => setSkillStatus(data.skill.id, "active")))}
        {status === "active" && button("Make dormant", () => setConfirm("dormant"))}
        {status !== "archived" && button("Archive", () => setConfirm("archived"))}
      </div>
      <ErrorLine error={error} />

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "archived" ? `Archive ${data.skill.name}?` : `Make ${data.skill.name} dormant?`}>
        <p className="mb-4 text-sm text-muted">
          {confirm === "archived"
            ? `It moves to the Trophy Room with a final score of ${data.display}. Claimed milestones are kept. You can restore it.`
            : "It leaves scores and daily goals until you awaken it. Claimed milestones are kept."}
        </p>
        <button
          type="button"
          onClick={() =>
            run(
              () => setSkillStatus(data.skill.id, confirm!),
              () => {
                setConfirm(null);
                if (confirm === "archived") router.push("/");
              },
            )
          }
          className="min-h-11 w-full rounded-xl border border-border text-sm"
        >
          {confirm === "archived" ? "Archive" : "Make dormant"}
        </button>
      </Sheet>

      <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${data.skill.name}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateSkill(data.skill.id, form), () => setEditing(false));
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-black/30 px-3 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Identity statement (present tense)</span>
            <input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-black/30 px-3 text-sm" />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Priority weight (category score and goal engine)</legend>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={form.priorityWeight === w}
                  onClick={() => setForm({ ...form, priorityWeight: w })}
                  className={`min-h-11 flex-1 rounded-xl border text-sm ${form.priorityWeight === w ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                >
                  {w === 3 ? "3 critical" : w === 2 ? "2 core" : "1 supporting"}
                </button>
              ))}
            </div>
          </fieldset>
          <ErrorLine error={error} />
          <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-60">
            Save
          </button>
        </form>
      </Sheet>
    </div>
  );
}

// ───────────────────────────── Tip tier unlock moment

export function TipUnlock({ skillId, tier, soundOn }: { skillId: string; tier: "foundation" | "development" | "mastery"; soundOn: boolean }) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    void markTipSeen(skillId, tier);
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.button
          type="button"
          onClick={close}
          onAnimationStart={() => soundOn && playBell()}
          className="fixed inset-x-4 top-20 z-40 mx-auto flex max-w-sm items-center gap-3 rounded-card border border-gold/40 bg-[#17150f] p-4 text-left shadow-2xl"
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-gold/15 text-gold">
            <Check size={18} aria-hidden />
          </span>
          <span>
            <span className="block font-display text-base text-gold">New guidance unlocked</span>
            <span className="block text-xs text-muted capitalize">{tier} tips. Tap to continue.</span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
