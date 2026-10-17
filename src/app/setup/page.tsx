import Link from "next/link";
import { Suspense } from "react";
import { APP_NAME } from "@/lib/brand";

/** Shown only when the automatic owner sign-in is not set up yet, or the password was rejected. */
export default function SetupPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col justify-center gap-6 py-16">
      <h1 className="font-display text-4xl tracking-tight text-gold">{APP_NAME}</h1>
      <Suspense fallback={<div className="tile h-40" aria-busy="true" />}>
        <Reason searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Reason({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const failed = reason === "failed";
  return (
    <section className="tile space-y-4 p-5 text-sm leading-relaxed">
      <h2 className="text-base font-semibold">{failed ? "The owner sign-in was rejected." : "One step left before the dashboard opens."}</h2>
      <p className="text-muted">
        {failed
          ? "Supabase did not accept FORGE_OWNER_EMAIL and FORGE_OWNER_PASSWORD. Check that the user exists, is confirmed, and has that password."
          : "FORGE opens straight to your dashboard by signing in your account on the server. It needs two server env vars."}
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-muted">
        <li>In Supabase, open Authentication, then Users. Add a user with your email and a password, and tick Auto confirm.</li>
        <li>In Vercel, open the project settings, then Environment Variables. Add FORGE_OWNER_EMAIL and FORGE_OWNER_PASSWORD.</li>
        <li>Redeploy, then open the app.</li>
      </ol>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-chip border border-border px-5">
        Try again
      </Link>
    </section>
  );
}
