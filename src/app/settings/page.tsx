import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SettingsDashboard } from "@/components/dashboards/SettingsDashboard";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function SettingsPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/board" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Overview
      </Link>
      <h1 className="font-display text-3xl">Settings</h1>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <SettingsDashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
