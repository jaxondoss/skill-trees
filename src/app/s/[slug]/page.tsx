import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { SkillIcon } from "@/components/board/SkillIcon";
import { SectionHeader } from "@/components/board/Tiles";
import { ScoreChart } from "@/components/charts/ScoreChart";
import { IdentityLine } from "@/components/skill/IdentityLine";
import { LogPanel, MetricsPanel, SkillActions, TipUnlock } from "@/components/skill/SkillClient";
import { GoalsTile, StepsTile } from "@/components/skill/TodoLists";
import { SkillTracker } from "@/components/skill/Trackers";
import { SkillViz } from "@/components/viz/SkillViz";
import { loadSkillPage } from "@/lib/data/skill";
import { catClass, MARK, isCategorySlug } from "@/lib/palette";

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

/** Skill page (spec v2 r2, 5): header, the to-do lists, the skill's numbers, recent and history. */
export default function SkillPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <main className="flex flex-1 flex-col pt-4 pb-6">
      <Suspense fallback={<div className="tile h-64" aria-busy="true" />}>
        <Skill params={params} />
      </Suspense>
    </main>
  );
}

function Section({ title, children, note, className = "" }: { title: string; children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <section className={`tile ${className}`} aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="lbl">{title}</h2>
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
  const cat = d.category.slug;
  const color = isCategorySlug(cat) ? MARK[cat] : d.category.color;
  const dormant = d.skill.status === "dormant";
  const archived = d.skill.status === "archived";
  const level = Math.round(d.level);
  const shownScore = dormant ? "--" : archived ? Math.round(d.skill.finalScore ?? d.score) : d.display;

  return (
    <div className={`grid grid-cols-12 gap-3 ${catClass(cat)}`}>
      {d.tipUnlocked && <TipUnlock skillId={d.skill.id} tier={d.tipUnlocked} soundOn={d.soundOn} />}
      {d.claimed.length > 0 && (
        <p role="status" className="sunk-row col-span-12 px-3 py-2 text-sm text-gold">
          Claimed: {d.claimed.join(", ")}
        </p>
      )}

      <header className="tile glow col-span-12 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 !p-5 max-md:grid-cols-[minmax(0,1fr)_auto]">
        <span className="icon-tile !size-[52px] !rounded-[14px] max-md:hidden">
          <SkillIcon slug={d.skill.slug} size={26} />
        </span>
        <div className="min-w-0">
          <Link href="/board" className="-ml-2 inline-flex min-h-9 items-center gap-1 rounded-lg pr-3 pl-1 text-sm font-bold text-muted hover:bg-raised hover:text-text">
            <ChevronLeft size={16} aria-hidden />
            Overview
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2">
            <Link href={`/c/${cat}`} className="lbl hover:text-text">
              {d.category.name}
            </Link>
            {d.rack.pinned && <span className="lbl">on the rack</span>}
            {dormant && <span className="lbl">dormant</span>}
            {archived && <span className="lbl text-gold">Trophy Room</span>}
          </div>
          <h1 className="mt-0.5 text-[34px] leading-[1.05] font-extrabold tracking-tight max-sm:text-[28px]">{d.skill.name}</h1>
          <IdentityLine skillId={d.skill.id} skillName={d.skill.name} initial={d.skill.identity ?? ""} />
          {d.skill.hundredMeans && <p className="mt-1 max-w-[640px] text-xs text-label">100 means: {d.skill.hundredMeans}</p>}
        </div>
        <div className="flex items-center gap-5">
          <dl className="grid min-w-[150px] gap-2 max-md:hidden">
            <div className="flex justify-between gap-4">
              <dt className="text-xs text-muted">Goals</dt>
              <dd className="font-mono text-[15px] font-semibold">{d.nonNegotiables.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-xs text-muted">Steps</dt>
              <dd className="font-mono text-[15px] font-semibold">
                {d.milestones.filter((m) => m.claimedAt).length} of {d.milestones.length}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-xs text-muted">Level from steps</dt>
              <dd className="font-mono text-[15px] font-semibold text-gold">{level}</dd>
            </div>
          </dl>
          <div className="ring cat" style={{ ["--p" as string]: dormant ? 0 : shownScore, ["--size" as string]: "96px" }} aria-label={`Score ${shownScore}`} role="img">
            <span className="font-mono text-2xl font-bold text-[var(--ct)]">{shownScore}</span>
          </div>
        </div>
      </header>

      <SectionHeader title="To do" meta="Tap a row to fill in the details" />
      <div className="col-span-12 lg:col-span-6 [&>section]:h-full">
        <GoalsTile
          skillId={d.skill.id}
          skillName={d.skill.name}
          goals={d.nonNegotiables}
          ideas={d.ideas.goals}
          soundOn={d.soundOn}
          categoryId={d.category.id}
          categorySlug={cat}
          active={d.skill.status === "active"}
        />
      </div>
      <div className="col-span-12 lg:col-span-6 [&>section]:h-full">
        <StepsTile skillId={d.skill.id} skillName={d.skill.name} steps={d.milestones} ideas={d.ideas.steps} soundOn={d.soundOn} />
      </div>

      <SectionHeader title="The numbers" />
      <SkillViz data={d.viz} skillId={d.skill.id} skillName={d.skill.name} dormant={dormant} />
      {d.tracker.kind !== "none" && d.skill.status === "active" && (
        <Section title={TRACKER_TITLE[d.tracker.kind] ?? "Track"} className="col-span-12 lg:col-span-6">
          <SkillTracker tracker={d.tracker} color={color} />
        </Section>
      )}
      {d.metrics.length > 0 && (
        <Section title="Metrics" className={`col-span-12 ${d.tracker.kind !== "none" && d.skill.status === "active" ? "lg:col-span-6" : ""}`}>
          {d.skill.metricsNote && <p className="mb-2 text-xs text-muted">{d.skill.metricsNote}</p>}
          <MetricsPanel skillId={d.skill.id} metrics={d.metrics} today={d.today} />
        </Section>
      )}

      <Section title="Score" className="col-span-12 lg:col-span-5">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="sunk-row p-3">
            <p className="text-[11px] text-muted">Level (L)</p>
            <p className="font-mono text-2xl font-semibold text-gold">{level}</p>
            <p className="text-[11px] text-label">Claimed step points, capped at 100. Misses never lower it.</p>
          </div>
          <div className="sunk-row p-3">
            <p className="text-[11px] text-muted">Consistency (C)</p>
            <p className="font-mono text-2xl font-semibold">{Math.round(d.consistency)}</p>
            <p className="text-[11px] text-label">
              Last 28 days, recent days weigh more. {d.countedDays < 7 ? `Settling: ${d.countedDays} of 7 days logged, so it starts near 50.` : `${d.countedDays} scheduled days counted.`}
            </p>
          </div>
        </div>
        <p className="font-mono text-xs text-muted">
          Score = 0.7 x {level} + 0.3 x {Math.round(d.consistency)} = {d.score.toFixed(1)}
        </p>
        <div className="mt-3">
          <ScoreChart points={d.history} color={color} today={d.today} />
        </div>
      </Section>
      <Section title="Log" className="col-span-12 lg:col-span-7">
        <LogPanel skillId={d.skill.id} log={d.log} />
      </Section>

      <Section
        title={`Guidance: ${TIER_NAME[d.tipTier]}`}
        className="col-span-12 lg:col-span-7"
        note={<span className="font-mono text-[11px] text-label">Next tier at {d.tipTier === "foundation" ? 34 : d.tipTier === "development" ? 67 : "max"}</span>}
      >
        {d.tips.length ? (
          <ul className="space-y-2">
            {d.tips.map((t) => (
              <li key={t} className="flex gap-2 text-sm">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--c)]" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No guidance written for this tier yet.</p>
        )}
      </Section>
      <Section title="Manage" className="col-span-12 lg:col-span-5">
        <SkillActions data={d} />
      </Section>
    </div>
  );
}
