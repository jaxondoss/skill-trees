import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MonthlyReview } from "@/components/review/MonthlyReview";
import { loadMonthlyReview } from "@/lib/data/reviews";

export default function MonthlyReviewPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-5 py-4 pb-16">
      <Link href="/review" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Weekly review
      </Link>
      <h1 className="font-display text-3xl">Monthly review</h1>
      <Suspense fallback={<div className="glass h-60" aria-busy="true" />}>
        <Loaded />
      </Suspense>
    </main>
  );
}

async function Loaded() {
  return <MonthlyReview data={await loadMonthlyReview()} />;
}
