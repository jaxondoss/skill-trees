import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Bottle } from "@/components/bottle/Bottle";
import { ScoreChart } from "@/components/charts/ScoreChart";
import { LogPanel, MetricsPanel, MilestoneLadder, NonNegotiableCard, SkillActions, TipUnlock } from "@/components/skill/SkillClient";
import { SkillTracker } from "@/components/skill/Trackers";
import { loadSkillPage } from "@/lib/data/skill";

const TRACKER_TITLE: Record<string, string> = {
  sleep: "Sleep log",
  food: "Today's fuel",
  gut: "Daily rating",
  adherence: "Block adherence",
  assignments: "Assignments",
  chess: "Rating sync",
  timer: "Sit",
  woop: "WOOP",
  reading: "Reading test",
};

const TIER_NAME = { foundation: "Foundation", development: "Development", mastery: "Mastery" } as const;

/** Skill detail (spec 4.3). */
export default function SkillPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <main className="flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <Suspense fallback={<div className="glass h-64" aria-busy="true" />}>
        <Skill params={params} />
      </Suspense>
    </main>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">{title}</h2>
        {note}
      </div>
      {children}
    </section>
  );
}

async function Skill({ params }: { params: PageProps<"/s/[slug]">["params"] }) {
  const { slug } = await params;
  const d = await loadSkillPage(slug);
  if (!d) notFound();
  const color = d.category.color;
  const dormant = d.skill.status === "dormant";
  const archived = d.skill.status === "archived";

  return (
    <>
      {d.tipUnlocked && <TipUnlock skillId={d.skill.id} tier={d.tipUnlocked} soundOn={d.soundOn} />}
      {d.claimed.length > 0 && (
        <p role="status" className="rounded-xl border border-gold/30 bg-gold/[0.06] px-3 py-2 text-sm text-gold">
          Claimed: {d.claimed.join(", ")}
        </p>
      )}

      {/* 1. Hero */}
      <header className="flex items-center gap-5">
        <Bottle
          shape={d.shape}
          color={color}
          level={archived ? (d.skill.finalScore ?? d.score) : d.score}
          dormant={dormant}
          fillFromEmpty
          className="h-40 w-24 shrink-0"
          label={`${d.skill.name} bottle`}
        />
        <div className="min-w-0 space-y-1">
          <Link href={`/c/${d.category.slug}`} className="-my-3 inline-flex min-h-11 items-center text-[11px] tracking-wider uppercase" style={{ color }}>
            {d.category.name}
          </Link>
          <h1 className="font-display text-3xl leading-tight">{d.skill.name}</h1>
          <p className="flex items-baseline gap-2">
            <span className="num text-4xl font-semibold">{dormant ? "--" : archived ? Math.round(d.skill.finalScore ?? d.score) : d.display}</span>
            <span className="font-display text-sm text-gold">{dormant ? "Dormant" : archived ? "Trophy Room" : TIER_NAME[d.tipTier]}</span>
          </p>
        </div>
      </header>
      {d.skill.identity && <p className="font-display text-2xl leading-snug">{d.skill.identity}</p>}
      {d.skill.hundredMeans && <p className="text-sm text-muted">100 means: {d.skill.hundredMeans}</p>}

      {/* 2. Score breakdown */}
      <Section title="Score">
        <div className="grid grid-cols-2 gap-3">
          <div className="glass p-3">
            <p className="text-[11px] text-muted">Level (L)</p>
            <p className="num text-2xl">{Math.round(d.level)}</p>
            <p className="text-[11px] text-muted">Claimed milestone points, capped at 100. Misses never lower it.</p>
          </div>
          <div className="glass p-3">
            <p className="text-[11px] text-muted">Consistency (C)</p>
            <p className="num text-2xl">{Math.round(d.consistency)}</p>
            <p className="text-[11px] text-muted">
              Last 28 days, recent days weigh more. {d.countedDays < 7 ? `Settling: ${d.countedDays} of 7 days logged, so it starts near 50.` : `${d.countedDays} scheduled days counted.`}
            </p>
          </div>
        </div>
        <p className="num text-xs text-muted">
          Score = 0.7 x {Math.round(d.level)} + 0.3 x {Math.round(d.consistency)} = {d.score.toFixed(1)}
        </p>
      </Section>

      {/* Daily tracker for this skill (manual stand-ins for integrations). */}
      {d.tracker.kind !== "none" && d.skill.status === "active" && (
        <Section title={TRACKER_TITLE[d.tracker.kind] ?? "Track"}>
          <SkillTracker tracker={d.tracker} color={color} />
        </Section>
      )}

      {/* 3. History */}
      <Section title="History">
        <ScoreChart points={d.history} color={color} today={d.today} />
      </Section>

      {/* 4. Non-negotiables */}
      <Section title="Non-negotiables">
        {d.nonNegotiables.map((nn) => (
          <NonNegotiableCard key={nn.id} nn={nn} color={color} />
        ))}
      </Section>

      {/* 5. Milestones */}
      <Section
        title="Milestones"
        note={
          <span className="num text-xs text-muted">
            {d.milestones.filter((m) => m.claimedAt).reduce((s, m) => s + m.points, 0)} / {d.milestones.reduce((s, m) => s + m.points, 0)} pts
          </span>
        }
      >
        <MilestoneLadder milestones={d.milestones} color={color} soundOn={d.soundOn} />
      </Section>

      {/* 6. Tips */}
      <Section title={`Guidance: ${TIER_NAME[d.tipTier]}`} note={<span className="text-[11px] text-muted">Next tier at {d.tipTier === "foundation" ? 34 : d.tipTier === "development" ? 67 : "max"}</span>}>
        <ul className="space-y-2">
          {d.tips.map((t) => (
            <li key={t} className="flex gap-2 text-sm">
              <span className="mt-2 size-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </Section>

      {/* 7. Metrics */}
      {d.metrics.length > 0 && (
        <Section title="Metrics">
          {d.skill.metricsNote && <p className="text-xs text-muted">{d.skill.metricsNote}</p>}
          <MetricsPanel skillId={d.skill.id} metrics={d.metrics} today={d.today} />
        </Section>
      )}

      {/* 8. Log */}
      <Section title="Log">
        <LogPanel skillId={d.skill.id} log={d.log} />
      </Section>

      {/* 9. Actions */}
      <Section title="Manage">
        <SkillActions data={d} />
      </Section>
    </>
  );
}
