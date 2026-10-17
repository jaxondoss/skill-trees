import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { WeeklyReview } from "@/components/review/WeeklyReview";
import { loadWeeklyReview } from "@/lib/data/reviews";

export default function ReviewPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-5 py-4 pb-16">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <h1 className="font-display text-3xl">Weekly review</h1>
      <Suspense fallback={<div className="glass h-60" aria-busy="true" />}>
        <Loaded />
      </Suspense>
    </main>
  );
}

async function Loaded() {
  return <WeeklyReview data={await loadWeeklyReview()} />;
}
