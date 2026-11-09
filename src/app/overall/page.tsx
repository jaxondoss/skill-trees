import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { OverallDashboard } from "@/components/dashboards/OverallDashboard";

/** Explains the overall score: the equal-weighted mean of the five categories. */
export default function OverallPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/board" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Overview
      </Link>
      <Suspense fallback={<div className="glass h-64" aria-busy="true" />}>
        <OverallDashboard />
      </Suspense>
    </main>
  );
}
