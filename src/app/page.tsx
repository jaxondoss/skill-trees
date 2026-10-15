import { Suspense } from "react";
import { Archive } from "@/components/archive/Archive";
import { Banner } from "@/components/dashboard/Banner";
import { FigureStage } from "@/components/dashboard/FigureStage";
import { CompletionCalendar } from "@/components/calendar/CompletionCalendar";
import { StreakBreak } from "@/components/dashboard/StreakBreak";
import { TierUp } from "@/components/figure/TierUp";
import { TodayPanel } from "@/components/today/TodayPanel";
import { redirect } from "next/navigation";
import { loadDashboard } from "@/lib/data/dashboard";
import { isOnboarded } from "@/lib/data/onboarding";
import { supabasePublicEnv } from "@/lib/supabase/env";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col gap-5 pt-2 pb-12">
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  if (!supabasePublicEnv()) {
    return (
      <p className="glass p-4 text-sm text-muted">
        Supabase is not connected yet. Add the keys from .env.example to finish setup (see docs/SETUP.md).
      </p>
    );
  }

  // First run: onboarding comes before the first plan, so that plan uses the chosen rack.
  if (!(await isOnboarded())) redirect("/onboarding");
  const data = await loadDashboard();

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
      <Banner overall={data.overall} todayP={data.todayP} streak={data.streak} />

      <p className="-mt-2 px-1 text-center font-display text-sm text-muted italic">
        {data.focusLine ?? "No focus line yet. Write one in the Sunday review."}
      </p>

      <FigureStage categories={data.categories} tier={data.overall.tier} />
      <TodayPanel
        goals={data.goals}
        rack={data.rack}
        skills={data.skills}
        categories={data.categories}
        plan={data.plan}
        soundOn={data.soundOn}
      />
      <CompletionCalendar days={data.calendar} today={data.today} />
      <Archive categories={data.categories} skills={data.skills} />

      <nav className="flex justify-center gap-6 pt-4 text-xs text-muted">
        <a href="/settings" className="min-h-11 content-center underline-offset-4 hover:underline">
          Settings
        </a>
      </nav>
      <form action="/auth/signout" method="post" className="text-center">
        <button type="submit" className="min-h-11 px-4 text-xs text-muted underline-offset-4 hover:underline">
          Sign out
        </button>
      </form>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="glass h-16" />
      <div className="mx-auto h-4 w-40 rounded bg-white/5" />
      <div className="mx-auto w-full max-w-[520px] rounded-card bg-white/[0.02]" style={{ aspectRatio: "100 / 130" }} />
    </div>
  );
}
