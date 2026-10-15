"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col justify-center gap-4 py-16">
      <h1 className="font-display text-2xl">Something broke.</h1>
      <p className="text-sm text-muted">{error.message || "The page could not load."}</p>
      <button type="button" onClick={reset} className="min-h-11 w-fit rounded-chip border border-border px-5 text-sm">
        Try again
      </button>
    </main>
  );
}
