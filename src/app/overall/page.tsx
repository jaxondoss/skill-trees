import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ScoreChart } from "@/components/charts/ScoreChart";
import { CategoryIcon } from "@/components/dashboard/CategoryIcon";
import { FIGURE_TIERS } from "@/engine/scoring";
import { loadDashboard } from "@/lib/data/dashboard";
import { loadHistory } from "@/lib/data/history";

/** Explains the overall score: the equal-weighted mean of the five categories. */
export default function OverallPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col gap-6 py-4 pb-16">
      <Link href="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 pr-3 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />
        Dashboard
      </Link>
      <Suspense fallback={<div className="glass h-64" aria-busy="true" />}>
        <Overall />
      </Suspense>
    </main>
  );
}

async function Overall() {
  const [data, history] = await Promise.all([loadDashboard(), loadHistory("overall")]);
  const counted = data.categories.filter((c) => c.score !== null);
  const next = FIGURE_TIERS.find((t) => t.min > data.overall.display);

  return (
    <>
      <header className="space-y-1">
        <h1 className="font-display text-3xl">Overall</h1>
        <p className="flex items-baseline gap-2">
          <span className="num text-5xl font-semibold">{data.overall.display}</span>
          <span className="font-display text-gold">
            Tier {data.overall.tierNumeral}: {data.overall.tierName}
          </span>
        </p>
        <p className="text-sm text-muted">
          The average of the five categories, weighted equally on purpose: a lopsided life should not reach Sovereign.
          {next && (
            <>
              {" "}
              <span className="num">{next.min - data.overall.display}</span> points to {next.name}.
            </>
          )}
        </p>
      </header>

      <ScoreChart points={history} color="#D4AF37" today={data.today} />

      <ul className="space-y-2">
        {data.categories.map((c) => (
          <li key={c.id}>
            <Link href={`/c/${c.slug}`} className="glass flex min-h-14 items-center gap-3 px-4 py-3">
              <CategoryIcon icon={c.icon} size={18} style={{ color: c.color }} />
              <span className="flex-1">
                <span className="block text-sm">{c.name}</span>
                {c.lowest && <span className="block text-[11px] text-muted">Lowest: {c.lowest.name} ({c.lowest.display})</span>}
              </span>
              <span className="num text-xl">{c.display ?? "--"}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="num text-xs text-muted">
        ({counted.map((c) => c.display).join(" + ")}) / {counted.length} = {data.overall.score.toFixed(1)}
      </p>

      <section className="space-y-2" aria-label="Tiers">
        <h2 className="text-[11px] font-medium tracking-wider text-muted uppercase">Tiers</h2>
        <ol className="space-y-1">
          {FIGURE_TIERS.map((t, i) => {
            const max = FIGURE_TIERS[i + 1] ? FIGURE_TIERS[i + 1]!.min - 1 : 100;
            const current = t.name === data.overall.tierName;
            return (
              <li key={t.name} className={`flex justify-between rounded-lg px-3 py-2 text-sm ${current ? "bg-gold/10 text-gold" : "text-muted"}`}>
                <span>
                  {t.numeral}. {t.name}
                </span>
                <span className="num">
                  {t.min} to {max}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
