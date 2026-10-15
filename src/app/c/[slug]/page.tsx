import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Bottle } from "@/components/bottle/Bottle";
import { CategoryIcon } from "@/components/dashboard/CategoryIcon";
import { loadDashboard } from "@/lib/data/dashboard";

/** Category page. Phase 4 adds the score history chart; this version explains every score. */
export default function CategoryPage({ params }: PageProps<"/c/[slug]">) {
  return (
    <main className="flex flex-1 flex-col gap-5 py-4">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <Suspense fallback={<div className="glass h-40" aria-busy="true" />}>
        <Category params={params} />
      </Suspense>
    </main>
  );
}

async function Category({ params }: { params: PageProps<"/c/[slug]">["params"] }) {
  const { slug } = await params;
  const data = await loadDashboard();
  const category = data.categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const skills = data.skills
    .filter((s) => s.categoryId === category.id && s.status !== "archived")
    .sort((a, b) => Number(a.status === "dormant") - Number(b.status === "dormant") || b.score - a.score);
  const ids = new Set(skills.map((s) => s.id));
  const goals = data.goals.filter((g) => g.kind !== "stretch" && ids.has(g.skillId));

  return (
    <>
      <header className="flex items-end justify-between">
        <h1 className="flex items-center gap-2 font-display text-3xl" style={{ color: category.color }}>
          <CategoryIcon icon={category.icon} size={24} />
          {category.name}
        </h1>
        <div className="text-right">
          <div className="num text-3xl font-semibold">{category.display ?? "--"}</div>
          <div className="text-[11px] text-muted">Priority-weighted average</div>
        </div>
      </header>

      <ul className="space-y-2">
        {skills.map((s) => (
          <li key={s.id} className="glass flex items-center gap-4 p-3">
            <Bottle
              shape={s.shape}
              color={s.color}
              level={s.score}
              neglected={s.neglected}
              dormant={s.status === "dormant"}
              className="h-16 w-10 shrink-0"
              label={s.name}
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg leading-tight">{s.name}</p>
              {s.status === "dormant" ? (
                <p className="text-xs text-muted">Dormant. Not counted in scores or goals.</p>
              ) : (
                <p className="text-xs text-muted">
                  Level <span className="num text-text">{Math.round(s.level)}</span>, Consistency{" "}
                  <span className="num text-text">{Math.round(s.consistency)}</span>
                  {s.neglected && <span className="text-business">, neglected</span>}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="num text-xl">{s.status === "dormant" ? "--" : s.display}</div>
              <div className="text-[10px] text-muted">0.7 L + 0.3 C</div>
            </div>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">Today</h2>
        {goals.length === 0 ? (
          <p className="text-sm text-muted">No {category.name} goals today.</p>
        ) : (
          <ul className="space-y-1.5">
            {goals.map((g) => (
              <li key={g.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2 rounded-full"
                  style={g.resultTier ? { background: g.color } : { boxShadow: `inset 0 0 0 1px ${g.color}` }}
                  aria-label={g.resultTier ? "Done" : "Not done"}
                />
                {g.skillName}: {g.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
