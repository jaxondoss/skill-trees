"use client";

import { useState, useTransition } from "react";
import { pinToFreeSlot, unpinSkill, type ActionResult } from "@/app/actions";
import { setSkillCategory } from "@/app/admin-actions";
import { setSkillStatus, updateNonNegotiable } from "@/app/skill-actions";
import type { Tier } from "@/engine/types";
import type { AdminSkill } from "@/lib/data/admin";

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const run = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { text: ok, err: false } : { text: r.error, err: true });
    });
  const status = (
    <p className={`adm-status${msg?.err ? " err" : ""}`} role="status">
      {msg?.text ?? ""}
    </p>
  );
  return { pending, run, status };
}

const STATUS: { s: AdminSkill["status"]; label: string }[] = [
  { s: "active", label: "ACTIVE" },
  { s: "dormant", label: "PAUSED" },
  { s: "archived", label: "ARCHIVED" },
];

/** ADMIN section of an expanded skill tile: lifecycle (status, rack pin, category) and the goals editor. */
export function AdminSkillActions({ skill, categories }: { skill: AdminSkill; categories: { id: string; name: string }[] }) {
  const { pending, run, status } = useRun();
  const locked = skill.pinLockedUntil !== null && new Date(skill.pinLockedUntil) > new Date();
  return (
    <section className="adm-sec" aria-labelledby="adm-sec-life">
      <h3 id="adm-sec-life">ADMIN / LIFECYCLE</h3>
      <div className="adm-sec-body">
        <div className="adm-fields" role="group" aria-label="Status">
          <span className="lbl-a">STATUS</span>
          {STATUS.map((x) => (
            <button
              key={x.s}
              type="button"
              className="adm-btn"
              aria-pressed={skill.status === x.s}
              disabled={pending || skill.status === x.s}
              onClick={() => run(() => setSkillStatus(skill.id, x.s), x.s === "active" ? "Restored to active." : x.s === "dormant" ? "Paused." : "Archived to the Trophy Room.")}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="adm-fields">
          <span className="lbl-a">RACK</span>
          {skill.pinSlot !== null ? (
            <>
              <span>{`Slot ${skill.pinSlot}${locked ? `, locked until ${skill.pinLockedUntil!.slice(0, 10)}` : ""}`}</span>
              <button type="button" className="adm-btn" disabled={pending || locked} onClick={() => run(() => unpinSkill(skill.pinSlot!), "Unpinned.")}>
                UNPIN
              </button>
            </>
          ) : (
            <button type="button" className="adm-btn" disabled={pending || skill.status !== "active"} onClick={() => run(() => pinToFreeSlot(skill.id), "Pinned for 7 days.")}>
              PIN TO RACK
            </button>
          )}
        </div>
        <label className="adm-fields">
          <span className="lbl-a">CATEGORY</span>
          <select
            value={skill.categoryId}
            disabled={pending}
            onChange={(e) => {
              const id = e.target.value;
              run(() => setSkillCategory(skill.id, id), "Category changed.");
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {status}
      </div>
      <h3 id="adm-sec-goals">ADMIN / GOALS</h3>
      <div className="adm-sec-body">
        {skill.goals.length === 0 && <p className="adm-muted">No goals yet. Add one in the To do list below.</p>}
        {skill.goals.map((g) => (
          <GoalForm key={g.id} goal={g} />
        ))}
      </div>
    </section>
  );
}

const TIER_ROWS: { t: Tier; label: string }[] = [
  { t: "floor", label: "FLOOR" },
  { t: "standard", label: "STANDARD" },
  { t: "stretch", label: "STRETCH" },
];

function GoalForm({ goal }: { goal: AdminSkill["goals"][number] }) {
  const { pending, run, status } = useRun();
  const [texts, setTexts] = useState(goal.texts);
  const [mins, setMins] = useState(goal.minutes);
  const [intention, setIntention] = useState(goal.intention);
  const id = goal.id.slice(0, 8);
  return (
    <form
      className="adm-goal"
      aria-label={`Goal: ${goal.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateNonNegotiable(goal.id, { texts, minutes: mins, intention, defaultTier: goal.defaultTier, daysOfWeek: goal.daysOfWeek }), "Saved. Applies from the next plan.");
      }}
    >
      <strong>{goal.name.toUpperCase()}</strong>
      {TIER_ROWS.map((r) => (
        <div className="adm-goal-row" key={r.t}>
          <span id={`g-${id}-${r.t}`}>{r.label}</span>
          <input
            className="adm-input"
            aria-labelledby={`g-${id}-${r.t}`}
            value={texts[r.t]}
            maxLength={200}
            required
            onChange={(e) => setTexts({ ...texts, [r.t]: e.target.value })}
          />
          <input
            className="adm-input"
            type="number"
            min={0}
            max={600}
            aria-label={`${r.label.toLowerCase()} minutes`}
            value={mins[r.t]}
            onChange={(e) => setMins({ ...mins, [r.t]: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })}
          />
        </div>
      ))}
      <label className="adm-goal-row">
        <span>INTENTION</span>
        <input className="adm-input" value={intention} maxLength={200} onChange={(e) => setIntention(e.target.value)} />
        <span />
      </label>
      <div className="adm-fields">
        <button type="submit" className="adm-btn" disabled={pending}>
          SAVE GOAL
        </button>
        {status}
      </div>
    </form>
  );
}

/** Archive tile: archived and paused skills, each with Restore. */
export function AdminArchive({ skills }: { skills: AdminSkill[] }) {
  const { pending, run, status } = useRun();
  const off = skills.filter((s) => s.status !== "active");
  return (
    <section className="adm-sec" aria-labelledby="adm-sec-arch">
      <h3 id="adm-sec-arch">ADMIN / ARCHIVE AND PAUSED</h3>
      <div className="adm-sec-body">
        {off.length === 0 ? (
          <p className="adm-muted">Every skill is active.</p>
        ) : (
          <ul className="adm-list">
            {off.map((s) => (
              <li key={s.id}>
                <span>
                  {s.name} <span className="adm-muted">{s.status === "archived" ? "archived" : "paused"}</span>
                </span>
                <button type="button" className="adm-btn" disabled={pending} onClick={() => run(() => setSkillStatus(s.id, "active"), `${s.name} restored.`)} aria-label={`Restore ${s.name}`}>
                  RESTORE
                </button>
              </li>
            ))}
          </ul>
        )}
        {status}
      </div>
    </section>
  );
}

type RelicView = { title: string; target: string | null; deadline: string | null; progress: number } | null;

/** Relics tile: the three mounts and the achieved trophies (read only; relics are edited in the room). */
export function AdminRelics({ slots, trophies }: { slots: Record<string, unknown>; trophies: unknown[] }) {
  const names: Record<string, string> = { left: "LEFT WALL (KITCHEN)", window: "WINDOW", right: "RIGHT WALL (GYM)" };
  return (
    <section className="adm-sec" aria-labelledby="adm-sec-relic">
      <h3 id="adm-sec-relic">RELICS</h3>
      <div className="adm-sec-body">
        <ul className="adm-list">
          {(["left", "window", "right"] as const).map((k) => {
            const r = slots[k] as RelicView;
            return (
              <li key={k}>
                <span>
                  <span className="adm-muted">{names[k]} </span>
                  {r ? `${r.title}${r.target ? `, target ${r.target}` : ""}${r.deadline ? `, by ${r.deadline}` : ""}` : "empty mount"}
                </span>
                {r && <span style={{ paddingRight: 12 }}>{`${Math.round(r.progress * 100)}%`}</span>}
              </li>
            );
          })}
        </ul>
        <p className="adm-muted">{trophies.length ? `Achieved: ${(trophies as { title: string; day: string }[]).map((t) => `${t.title} (${t.day})`).join(", ")}` : "No relic achieved yet."}</p>
        <p className="adm-muted">Mount, edit or retire a relic from its wall in the room.</p>
      </div>
    </section>
  );
}
