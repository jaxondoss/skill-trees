import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { CategoryDashboard } from "@/components/dashboards/CategoryDashboard";

/** Category page (spec 4.2): every skill as a bottle, score history, and today's goals. */
export default function CategoryPage({ params }: PageProps<"/c/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-5 py-4 pb-16">
      <Link href="/board" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Overview
      </Link>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <Category params={params} />
      </Suspense>
    </main>
  );
}

async function Category({ params }: { params: PageProps<"/c/[slug]">["params"] }) {
  const { slug } = await params;
  return <CategoryDashboard slug={slug} />;
}
