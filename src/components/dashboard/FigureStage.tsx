import Link from "next/link";
import { Figure } from "@/components/figure/Figure";
import { REGION_PARTS, type Region } from "@/components/figure/geometry";
import type { CategoryView } from "@/lib/data/dashboard";
import { CategoryIcon } from "./CategoryIcon";
import { PulseLayer } from "./PulseLayer";

/**
 * Figure stage (spec 4.1 C). Everything is laid out in one 100 x 130 coordinate space:
 * the SVG uses it as its viewBox and the HTML boxes use the same numbers as percentages,
 * so energy lines meet the boxes exactly at any width.
 */
const W = 100;
const H = 130;

const BOX: Record<string, { x: number; y: number; w: number; h: number; anchor: [number, number] }> = {
  top_center: { x: 30, y: 0, w: 40, h: 19, anchor: [50, 19] },
  top_left: { x: 0, y: 24, w: 30, h: 36, anchor: [30, 44] },
  top_right: { x: 70, y: 24, w: 30, h: 36, anchor: [70, 44] },
  bottom_left: { x: 0, y: 84, w: 30, h: 36, anchor: [30, 100] },
  bottom_right: { x: 70, y: 84, w: 30, h: 36, anchor: [70, 100] },
};

const REGION_TARGET: Record<string, [number, number]> = {
  head: [50, 26.5],
  left_arm: [38.5, 50],
  right_arm: [61.5, 50],
  left_leg_core: [46.5, 98],
  right_leg_chest: [53.5, 98],
};

export function FigureStage({ categories, tier }: { categories: CategoryView[]; tier: number }) {
  const scores = Object.fromEntries(categories.map((c) => [c.region, c.score ?? 0])) as Partial<Record<Region, number>>;

  return (
    <section aria-label="Categories" className="relative mx-auto w-full max-w-[520px]" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden={false}>
        {/* energy lines: brightness by category score, particles flow toward the figure */}
        {categories.map((c) => {
          const box = BOX[c.position];
          const to = REGION_TARGET[c.region];
          if (!box || !to) return null;
          const s = c.score ?? 0;
          return (
            <g key={c.id}>
              <line x1={box.anchor[0]} y1={box.anchor[1]} x2={to[0]} y2={to[1]} stroke={c.color} strokeWidth="0.35" opacity={0.12 + 0.5 * (s / 100)} />
              <line
                x1={box.anchor[0]}
                y1={box.anchor[1]}
                x2={to[0]}
                y2={to[1]}
                stroke={c.color}
                strokeWidth="0.7"
                strokeLinecap="round"
                strokeDasharray="0.1 3.5"
                opacity={0.25 + 0.6 * (s / 100)}
                className="energy-flow"
              />
            </g>
          );
        })}

        <PulseLayer
          lines={categories.flatMap((c) => {
            const box = BOX[c.position];
            const to = REGION_TARGET[c.region];
            return box && to ? [{ categoryId: c.id, from: box.anchor, to, color: c.color }] : [];
          })}
        />

        {/* figure: layered stone, veins, aura (spec 5.3); regions are tap targets */}
        <g className="figure-idle">
          <Figure id="stage" tier={tier} scores={scores} />
          {categories.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} aria-label={`${c.name}: ${c.display ?? "no score"}`}>
              {(REGION_PARTS[c.region as Region] ?? []).map((d) => (
                <path key={d} d={d} fill="transparent" />
              ))}
            </Link>
          ))}
          {/* Torso center opens the overall breakdown. */}
          <Link href="/overall" aria-label="Overall score">
            <circle cx="50" cy="58" r="4" fill="transparent" />
          </Link>
        </g>
      </svg>

      {categories.map((c) => {
        const box = BOX[c.position];
        if (!box) return null;
        return (
          <Link
            key={c.id}
            href={`/c/${c.slug}`}
            className="glass absolute flex flex-col justify-between overflow-hidden p-2.5 transition-transform active:scale-[0.98]"
            style={{
              left: `${box.x}%`,
              top: `${(box.y / H) * 100}%`,
              width: `${box.w}%`,
              height: `${(box.h / H) * 100}%`,
              boxShadow: `0 0 28px -14px ${c.color}, inset 0 0 0 1px ${c.color}22`,
            }}
          >
            <CategoryBox c={c} compact={c.position === "top_center"} />
          </Link>
        );
      })}
    </section>
  );
}

function CategoryBox({ c, compact }: { c: CategoryView; compact: boolean }) {
  const dots =
    c.dots.length > 0 ? (
      <div className="flex gap-1" aria-label={`${c.dots.filter(Boolean).length} of ${c.dots.length} goals done today`}>
        {c.dots.map((done, i) => (
          <span
            key={i}
            className="size-1.5 rounded-full"
            style={done ? { background: c.color } : { boxShadow: `inset 0 0 0 1px ${c.color}99` }}
          />
        ))}
      </div>
    ) : null;
  const lowest = c.lowest && (
    <p className={`text-[10px] leading-tight text-muted ${compact ? "truncate" : "line-clamp-2"}`}>
      Lowest: {c.lowest.name} (<span className="num">{c.lowest.display}</span>)
    </p>
  );

  if (compact) {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: c.color }}>
            <CategoryIcon icon={c.icon} size={13} />
            {c.name}
          </span>
          <ScoreArc value={c.display} color={c.color} />
        </div>
        <div className="flex items-center justify-between gap-2">
          {lowest}
          {dots}
        </div>
      </>
    );
  }

  return (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: c.color }}>
        <CategoryIcon icon={c.icon} size={13} />
        <span className="truncate">{c.name}</span>
      </span>
      <ScoreArc value={c.display} color={c.color} />
      {dots ?? <span className="h-1.5" />}
      {lowest}
    </>
  );
}

function ScoreArc({ value, color }: { value: number | null; color: string }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex size-9 items-center justify-center">
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--border)" strokeWidth="1.5" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (value ?? 0) / 100)}
        />
      </svg>
      <span className="num text-sm font-semibold">{value ?? "--"}</span>
    </span>
  );
}
