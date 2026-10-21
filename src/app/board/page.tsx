import Link from "next/link";
import { Suspense } from "react";
import { PenLine } from "lucide-react";
import { NumberTiles } from "@/components/board/NumberTiles";
import { StatueHero } from "@/components/board/StatueHero";
import { ActivityTile, DueTile, NextUpTile, RingTile, SectionHeader, SkillGrid } from "@/components/board/Tiles";
import { TrendTile } from "@/components/board/TrendTile";
import { CompletionCalendar } from "@/components/calendar/CompletionCalendar";
import { StreakBreak } from "@/components/dashboard/StreakBreak";
import { TierUp } from "@/components/figure/TierUp";
import { Clock } from "@/components/shell/Clock";
import { JournalButton } from "@/components/shell/JournalDialog";
import { TodayPanel } from "@/components/today/TodayPanel";
import { FIGURE_TIERS } from "@/engine/scoring";
import { loadBoard } from "@/lib/data/board";
import { ensureOnboarded } from "@/lib/data/onboarding";
import { supabasePublicEnv } from "@/lib/supabase/env";

const MOOD: Record<string, string> = { heavy: "Heavy", strained: "Strained", steady: "Steady", clear: "Clear", locked_in: "Locked in" };

export default function BoardPage() {
  return (
    <main className="flex flex-1 flex-col pt-4 pb-6">
      <Suspense fallback={<BoardSkeleton />}>
        <Board />
      </Suspense>
    </main>
  );
}

async function Board() {
  if (!supabasePublicEnv()) {
    return (
      <p className="tile text-sm text-muted">Supabase is not connected yet. Add the keys from .env.example to finish setup (see docs/SETUP.md).</p>
    );
  }

  // First run: no walkthrough. Mark the profile onboarded before the first plan is built.
  await ensureOnboarded();
  const data = await loadBoard();
  const next = FIGURE_TIERS.find((t) => t.tier === data.overall.tier + 1);
  const pct = data.todayP === null ? 0 : Math.round(data.todayP);

  return (
    <>
      {data.tierUp && (
        <TierUp
          tier={data.tierUp.tier}
          numeral={data.tierUp.numeral}
          name={data.tierUp.name}
          scores={Object.fromEntries(data.categories.map((c) => [c.region, c.score ?? 0]))}
          soundOn={data.soundOn}
        />
      )}
      {!data.tierUp && data.streakBreak && <StreakBreak length={data.streakBreak.length} best={data.streakBreak.best} soundOn={data.soundOn} />}

      <header className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href="/board" className="flex items-center gap-2.5 text-sm font-extrabold tracking-[0.22em]" aria-label="FORGE, overview">
          <svg viewBox="0 0 26 26" width="26" height="26" aria-hidden>
            <rect x="1" y="1" width="24" height="24" rx="7" fill="#1d1e29" stroke="rgba(255,255,255,.12)" />
            <path d="M10 5 L13.5 11 L11 14 L15.5 18 L13.6 22" fill="none" stroke="#d4af37" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          FORGE
        </Link>
        <div className="flex items-baseline gap-3.5 max-sm:order-3 max-sm:w-full">
          <Clock className="font-sans text-[30px] leading-none font-extrabold tracking-tight sm:text-[44px]" />
          <span className="font-semibold text-muted">{data.dateLabel}</span>
          {data.dayType && <span className="tier-chip">{data.dayType}</span>}
        </div>
        <div className="flex-1 max-sm:hidden" />
        {data.focusLine && <span className="text-sm text-muted italic max-sm:order-4 max-sm:w-full">{data.focusLine}</span>}
        <span className="glass hidden min-h-9 items-center gap-2 !rounded-full px-3.5 text-xs font-semibold text-muted sm:inline-flex">
          <span className="size-[7px] rounded-full bg-gold" aria-hidden />
          Streak <b className="font-mono text-text">{data.streak.current}</b>
        </span>
        <JournalButton className="glass inline-flex min-h-9 items-center gap-2 !rounded-full px-3.5 text-xs font-semibold max-sm:ml-auto">
          <PenLine size={15} aria-hidden />
          Journal <kbd className="font-mono text-[11px] text-label max-sm:hidden">L</kbd>
        </JournalButton>
      </header>

      {(data.review.weekly || data.review.monthly) && (
        <Link href={data.review.monthly ? "/review/month" : "/review"} className="tile c-gold glow mb-3 flex min-h-12 items-center justify-between gap-3 !py-3 text-sm">
          <span>{data.review.monthly ? "First Sunday: monthly review, then the weekly one." : "Sunday review. About three minutes."}</span>
          <span className="font-bold text-gold">Start</span>
        </Link>
      )}

      <div className="grid grid-cols-12 items-start gap-3">
        <div className="col-span-12 self-stretch lg:col-span-7 xl:col-span-5 max-lg:order-2 [&>section]:h-full">
          <StatueHero
            overall={data.overall.display}
            tier={{ tier: data.overall.tier, numeral: data.overall.tierNumeral, name: data.overall.tierName, next: next?.min ?? null }}
            categories={data.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, score: c.score === null ? null : c.display }))}
          />
        </div>
        <div className="col-span-12 self-stretch lg:col-span-5 xl:col-span-4 max-lg:order-1 [&>section]:h-full">
          <TodayPanel
            goals={data.goals}
            rack={data.rack}
            skills={data.skills}
            categories={data.categories}
            plan={data.plan}
            soundOn={data.soundOn}
            catSlug={data.catSlug}
          />
        </div>
        <div className="col-span-12 grid gap-3 md:grid-cols-3 xl:col-span-3 xl:grid-cols-1 max-lg:order-3">
          <RingTile pct={pct} streak={data.streak.current} best={data.streak.best} />
          <NextUpTile items={data.schedule} dayType={data.dayType} />
          <DueTile items={data.due} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <SectionHeader title="Skills" meta={`${data.skills.filter((s) => s.status === "active").length} active`} />
        <SkillGrid data={data} />

        <SectionHeader title="Numbers" meta="Tap to log" />
        <NumberTiles tiles={data.numbers} />

        <SectionHeader title="Record" />
        <div className="col-span-12 md:col-span-6 xl:col-span-4 [&>section]:h-full">
          <CompletionCalendar days={data.calendar} today={data.today} />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-5 [&>section]:h-full">
          <TrendTile trend={data.trend} completion={data.calendar} />
        </div>
        <section className="tile c-mind col-span-12 xl:col-span-3" aria-labelledby="h-journal">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="h-journal" className="lbl">
              Journal
            </h2>
            <JournalButton className="min-h-8 rounded-lg border border-[var(--border)] bg-raised px-3 text-xs font-bold hover:border-[var(--border-strong)]">New entry</JournalButton>
          </div>
          {data.journal.length ? (
            <ul className="grid gap-2">
              {data.journal.map((j) => (
                <li key={j.id} className="sunk-row grid gap-1 px-3 py-2.5 text-[13px]">
                  <span>{j.body}</span>
                  <span className="flex gap-2 text-[11px] text-label">
                    {j.mood && <b className="font-semibold text-[var(--ct)]">{MOOD[j.mood]}</b>}
                    <span className="font-mono">{j.when}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">Quick notes about your day and your head. They save to Mind. Press L anywhere.</p>
          )}
        </section>
        <ActivityTile items={data.activity} />
      </div>
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-3" aria-busy="true" aria-label="Loading">
      <div className="col-span-12 h-12" />
      <div className="tile col-span-12 h-[560px] xl:col-span-5" />
      <div className="tile col-span-12 h-[560px] xl:col-span-4" />
      <div className="tile col-span-12 h-[560px] xl:col-span-3" />
    </div>
  );
}
