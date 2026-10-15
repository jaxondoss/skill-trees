import { Suspense } from "react";
import { APP_NAME } from "@/lib/brand";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const CATEGORY_TOKENS = [
  { name: "Business", color: "var(--business)" },
  { name: "School", color: "var(--school)" },
  { name: "Mind", color: "var(--mind)" },
  { name: "Athletics", color: "var(--athletics)" },
  { name: "Nutrition", color: "var(--nutrition)" },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col gap-6 py-4">
      {/* Banner placeholder (spec 4.1 A). Real values arrive in Phase 2. */}
      <header className="glass sticky top-2 z-10 flex items-center justify-between px-4 py-3">
        <div className="leading-tight">
          <div className="num text-2xl font-semibold">--</div>
          <div className="font-display text-xs tracking-wide text-gold">{APP_NAME}</div>
        </div>
        <div className="flex gap-5 text-right text-xs text-muted">
          <Stat label="Today" value="--" />
          <Stat label="Streak" value="--" />
          <Stat label="7d" value="--" />
        </div>
      </header>

      <section aria-label="Categories" className="grid grid-cols-2 gap-3">
        {CATEGORY_TOKENS.map((c) => (
          <div
            key={c.name}
            className="glass flex h-20 items-end p-3 last:col-span-2"
            style={{ boxShadow: `0 0 24px -12px ${c.color}` }}
          >
            <span className="text-sm" style={{ color: c.color }}>
              {c.name}
            </span>
          </div>
        ))}
      </section>

      <Suspense fallback={<p className="text-sm text-muted">Loading your account.</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num text-base text-text">{value}</div>
      <div>{label}</div>
    </div>
  );
}

async function Account() {
  if (!supabasePublicEnv()) {
    return (
      <p className="glass p-4 text-sm text-muted">
        Supabase is not connected yet. Add the keys from .env.example to finish setup (see docs/SETUP.md).
      </p>
    );
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : null;
  const { count } = await supabase.from("skills").select("id", { count: "exact", head: true });

  return (
    <div className="glass flex items-center justify-between gap-4 p-4 text-sm">
      <p className="text-muted">
        {email ?? "Signed in"}. <span className="num text-text">{count ?? 0}</span> skills seeded.
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="min-h-11 rounded-chip border border-border px-4 text-muted">
          Sign out
        </button>
      </form>
    </div>
  );
}
