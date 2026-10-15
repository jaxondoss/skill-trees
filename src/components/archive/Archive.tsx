"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bottle } from "@/components/bottle/Bottle";
import type { CategoryView, SkillView } from "@/lib/data/dashboard";

type Filter = { kind: "all" } | { kind: "category"; id: string } | { kind: "neglected" } | { kind: "rising" } | { kind: "dormant" };

const SESSION_KEY = "forge.archiveFilled";

/** Skill archive (spec 4.1 F): one shelf per category, bottles by score, then the Trophy Room. */
export function Archive({ categories, skills }: { categories: CategoryView[]; skills: SkillView[] }) {
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  // Bottles fill from empty on the first view per session. They mount only once that is known,
  // because the fill animation starts from the level a bottle mounts with.
  const [mode, setMode] = useState<"pending" | "cascade" | "static">("pending");
  useEffect(() => {
    let first = false;
    try {
      first = !sessionStorage.getItem(SESSION_KEY);
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage unavailable (private mode): skip the cascade.
    }
    const frame = requestAnimationFrame(() => setMode(first ? "cascade" : "static"));
    return () => cancelAnimationFrame(frame);
  }, []);
  const cascade = mode === "cascade";

  const matches = (s: SkillView) => {
    switch (filter.kind) {
      case "all":
        return s.status !== "archived";
      case "category":
        return s.status !== "archived" && s.categoryId === filter.id;
      case "neglected":
        return s.neglected;
      case "rising":
        return s.status === "active" && (s.trendDelta ?? 0) > 2;
      case "dormant":
        return s.status === "dormant";
    }
  };

  const shelves = categories
    .map((c) => ({
      category: c,
      bottles: skills
        .filter((s) => s.categoryId === c.id && matches(s))
        .sort((a, b) => Number(a.status === "dormant") - Number(b.status === "dormant") || b.score - a.score),
    }))
    .filter((s) => s.bottles.length > 0);
  const trophies = skills.filter((s) => s.status === "archived");

  const chips: { label: string; filter: Filter }[] = [
    { label: "All", filter: { kind: "all" } },
    ...categories.map((c) => ({ label: c.name, filter: { kind: "category" as const, id: c.id } })),
    { label: "Neglected", filter: { kind: "neglected" } },
    { label: "Rising", filter: { kind: "rising" } },
    { label: "Dormant", filter: { kind: "dormant" } },
  ];
  const isActive = (f: Filter) => f.kind === filter.kind && (f.kind !== "category" || (filter.kind === "category" && f.id === filter.id));

  let index = 0;
  return (
    <section aria-label="Skill archive" className="space-y-4">
      <h2 className="font-display text-xl">Archive</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="toolbar" aria-label="Filter skills">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setFilter(chip.filter)}
            aria-pressed={isActive(chip.filter)}
            className={`min-h-9 shrink-0 rounded-chip border px-3.5 text-xs transition-colors ${
              isActive(chip.filter) ? "border-gold/60 bg-gold/10 text-gold" : "border-border text-muted"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {shelves.length === 0 && <p className="text-sm text-muted">Nothing here right now.</p>}

      {shelves.map(({ category, bottles }) => (
        <div key={category.id} className="space-y-1.5">
          <h3 className="text-[11px] font-medium tracking-wider uppercase" style={{ color: category.color }}>
            {category.name}
          </h3>
          <div className="shelf flex items-end gap-1 overflow-x-auto rounded-xl px-2 pt-3 pb-2">
            {bottles.map((s) =>
              mode === "pending" ? (
                <div key={s.id} className="h-[118px] w-[72px] shrink-0" />
              ) : (
                <BottleSlot key={s.id} skill={s} cascade={cascade} delay={(index++ % 15) * 0.05} />
              ),
            )}
          </div>
        </div>
      ))}

      {filter.kind === "all" && trophies.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium tracking-wider text-gold uppercase">Trophy Room</h3>
          <div className="shelf flex items-end gap-1 overflow-x-auto rounded-xl px-2 pt-3 pb-2">
            {trophies.map((s) => (
              <BottleSlot key={s.id} skill={{ ...s, display: Math.round(s.finalScore ?? s.score) }} cascade={false} delay={0} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BottleSlot({ skill: s, cascade, delay }: { skill: SkillView; cascade: boolean; delay: number }) {
  const dormant = s.status === "dormant";
  return (
    <Link href={`/s/${s.slug}`} className="flex w-[72px] shrink-0 flex-col items-center gap-1">
      <Bottle
        shape={s.shape}
        color={s.color}
        level={s.status === "archived" ? (s.finalScore ?? s.score) : s.score}
        neglected={s.neglected}
        dormant={dormant}
        fillFromEmpty={cascade}
        delay={delay}
        className="h-20 w-12"
        label={`${s.name}, ${dormant ? "dormant" : `score ${s.display}`}`}
      />
      <span className="w-full truncate text-center text-[11px] leading-tight">{s.name}</span>
      <span className="num flex items-center gap-1 text-[11px] text-muted">
        {dormant ? "Dormant" : s.display}
        {s.trendArrow && (
          <span className={s.trendArrow === "up" ? "text-nutrition" : "text-athletics"} aria-label={`Trend ${s.trendArrow}`}>
            {s.trendArrow === "up" ? "▲" : "▼"}
          </span>
        )}
      </span>
    </Link>
  );
}
