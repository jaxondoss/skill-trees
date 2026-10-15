import { Lock, Plus } from "lucide-react";
import { Bottle } from "@/components/bottle/Bottle";
import type { DashboardData, GoalView } from "@/lib/data/dashboard";

const TIER_LABEL = { floor: "Floor", standard: "Standard", stretch: "Stretch" } as const;
const OVERRIDE_LABEL: Record<string, string> = {
  exam_week: "Exam week",
  race_week: "Race week",
  sick: "Sick day",
  travel: "Travel",
};

/** Focus Rack and today's checklist (spec 4.1 D). Read-only until Phase 3 adds logging. */
export function TodaySection({ data }: { data: DashboardData }) {
  const groups: { title: string; goals: GoalView[] }[] = [
    { title: "Rack", goals: data.goals.filter((g) => g.kind === "rack") },
    { title: "Balance", goals: data.goals.filter((g) => g.kind === "balance") },
    { title: "Stretch (optional)", goals: data.goals.filter((g) => g.kind === "stretch") },
  ];

  return (
    <section id="today" aria-label="Today" className="scroll-mt-24 space-y-4">
      <div className="shelf flex items-end justify-between gap-1 rounded-card px-2 pt-3 pb-2">
        {data.rack.map(({ slot, skill, daysLocked }) => {
          return (
            <div key={slot} className="flex w-1/5 flex-col items-center gap-1">
              {skill ? (
                <>
                  <Bottle
                    shape={skill.shape}
                    color={skill.color}
                    level={skill.score}
                    neglected={skill.neglected}
                    className="h-14 w-9"
                    label={`${skill.name} ${skill.display}`}
                  />
                  <span className="w-full truncate text-center text-[10px] leading-tight text-muted">{skill.name}</span>
                  <span className="num flex items-center gap-0.5 text-[11px]">
                    {skill.display}
                    {daysLocked > 0 && (
                      <span className="flex items-center text-[9px] text-muted" aria-label={`Locked for ${daysLocked} more days`}>
                        <Lock size={9} aria-hidden />
                        {daysLocked}d
                      </span>
                    )}
                  </span>
                </>
              ) : (
                <span className="flex h-14 w-9 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                  <Plus size={16} aria-label="Empty rack slot" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {(data.plan.overrides.length > 0 || data.plan.overBudget) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {data.plan.overrides.map((o) => (
            <span key={o} className="rounded-chip border border-border px-2.5 py-1">
              {OVERRIDE_LABEL[o] ?? o}
            </span>
          ))}
          {data.plan.overBudget && (
            <span>
              Over today&apos;s budget: <span className="num">{data.plan.plannedMin}</span> of{" "}
              <span className="num">{data.plan.budgetMin}</span> min.
            </span>
          )}
        </div>
      )}

      {data.goals.length === 0 && <p className="text-sm text-muted">No goals today.</p>}

      {groups.map(
        (group) =>
          group.goals.length > 0 && (
            <div key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-medium tracking-wider text-muted uppercase">{group.title}</h3>
              <ul className="space-y-2">
                {group.goals.map((g) => (
                  <GoalRow key={g.id} goal={g} />
                ))}
              </ul>
            </div>
          ),
      )}
    </section>
  );
}

function GoalRow({ goal }: { goal: GoalView }) {
  const done = goal.resultTier !== null;
  const stretch = goal.kind === "stretch";
  return (
    <li
      className={`glass relative flex min-h-14 items-center gap-3 overflow-hidden py-2 pr-3 pl-4 ${stretch ? "border-dashed" : ""}`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: goal.color }} aria-hidden />
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border"
        style={done ? { background: goal.color, borderColor: goal.color } : { borderColor: "var(--border)" }}
        role="img"
        aria-label={done ? "Done" : "Not done"}
      >
        {done && (
          <svg viewBox="0 0 20 20" className="size-5 text-bg" aria-hidden>
            <path d="M5 10.5l3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted">
          {goal.skillName} <span aria-hidden>·</span> {goal.title}
        </p>
        <p className={`text-sm leading-snug ${done ? "text-muted line-through" : ""}`}>{goal.text}</p>
        {goal.note && <p className="mt-0.5 text-[11px] text-gold/90">{goal.note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`rounded-chip px-2 py-0.5 text-[10px] ${goal.tier === "stretch" ? "bg-gold/15 text-gold" : "bg-white/5 text-muted"}`}
        >
          {TIER_LABEL[goal.tier]}
        </span>
        {goal.estMin > 0 && <span className="num text-[11px] text-muted">{goal.estMin} min</span>}
      </div>
    </li>
  );
}
