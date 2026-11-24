import { Suspense } from "react";
import { APP_NAME } from "@/lib/brand";
import { logIn } from "./actions";

type Search = Promise<{ error?: string; next?: string }>;

const ERRORS: Record<string, string> = {
  invalid: "That email and password did not match. Try again.",
  missing: "Enter your email and password.",
};

/** The login screen: the only page that opens without a session. */
export default function LoginPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-16">
      <h1 className="font-display text-4xl tracking-tight text-gold">{APP_NAME}</h1>
      <Suspense fallback={<div className="tile h-64" aria-busy="true" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginForm({ searchParams }: { searchParams: Search }) {
  const { error, next } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.invalid) : null;
  return (
    <form action={logIn} className="tile space-y-4 p-5 text-sm" aria-label="Log in">
      <h2 className="text-base font-semibold">Log in</h2>
      {message && (
        <p role="alert" className="text-athletics">
          {message}
        </p>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block space-y-1">
        <span className="text-muted">Email</span>
        <input name="email" type="email" autoComplete="email" required className="block min-h-11 w-full rounded-chip border border-border bg-transparent px-3" />
      </label>
      <label className="block space-y-1">
        <span className="text-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="block min-h-11 w-full rounded-chip border border-border bg-transparent px-3" />
      </label>
      <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center rounded-chip border border-gold px-5 text-gold">
        Log in
      </button>
    </form>
  );
}
