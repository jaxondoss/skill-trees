"use client";

import { Brain, Briefcase, CalendarCheck, Dumbbell, GraduationCap, LayoutGrid, Leaf, PenLine, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { JOURNAL_EVENT } from "@/lib/journal-event";

const CATS = [
  { slug: "business", name: "Business", Icon: Briefcase },
  { slug: "school", name: "School", Icon: GraduationCap },
  { slug: "athletics", name: "Athletics", Icon: Dumbbell },
  { slug: "mind", name: "Mind", Icon: Brain },
  { slug: "nutrition", name: "Nutrition", Icon: Leaf },
];
const HIDDEN = ["/login", "/onboarding", "/auth"];

const item =
  "relative flex min-h-[52px] min-w-12 flex-col items-center justify-center gap-[3px] rounded-xl px-2 py-1.5 text-[10.5px] leading-[13px] font-semibold text-muted transition-colors hover:bg-white/[0.04] hover:text-text max-sm:flex-1 lg:min-w-[62px]";
const active = "bg-raised text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]";

/** The floating dock (laptop) and bottom tab bar (phone). */
export function Dock({ categoryPath }: { categoryPath?: string }) {
  const path = usePathname();
  if (HIDDEN.some((h) => path.startsWith(h))) return null;
  const cat = categoryPath ?? (path.startsWith("/c/") ? path.slice(3) : null);

  return (
    <nav
      aria-label="Sections"
      className="dock fixed inset-x-0 bottom-0 z-30 flex justify-around gap-1 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-[calc(18px+env(safe-area-inset-bottom))] sm:left-1/2 sm:-translate-x-1/2 sm:justify-start sm:rounded-[18px] sm:p-1.5"
    >
      <Link href="/" className={`${item} ${path === "/" ? active : ""}`} aria-current={path === "/" ? "page" : undefined}>
        <LayoutGrid size={18} strokeWidth={1.75} aria-hidden />
        <span className="max-lg:sm:sr-only">Overview</span>
        {path === "/" && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-gold shadow-[0_0_6px_var(--gold)]" />}
      </Link>
      {CATS.map(({ slug, name, Icon }) => (
        <Link
          key={slug}
          href={`/c/${slug}`}
          className={`${item} c-${slug} max-sm:hidden ${cat === slug ? active : ""}`}
          aria-current={cat === slug ? "page" : undefined}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          <span className="max-lg:sr-only">{name}</span>
          <span aria-hidden className="absolute top-2 right-3 size-1.5 rounded-full bg-[var(--c)] shadow-[0_0_6px_var(--c)]" />
        </Link>
      ))}
      <span aria-hidden className="my-2 w-px bg-[var(--border-strong)] max-sm:hidden" />
      <button type="button" className={item} onClick={() => window.dispatchEvent(new Event(JOURNAL_EVENT))}>
        <PenLine size={18} strokeWidth={1.75} aria-hidden />
        <span className="max-lg:sm:sr-only">Journal</span>
      </button>
      <Link href="/review" className={`${item} ${path.startsWith("/review") ? active : ""}`} aria-current={path.startsWith("/review") ? "page" : undefined}>
        <CalendarCheck size={18} strokeWidth={1.75} aria-hidden />
        <span className="max-lg:sm:sr-only">Review</span>
      </Link>
      <Link href="/settings" className={`${item} ${path.startsWith("/settings") ? active : ""}`} aria-current={path.startsWith("/settings") ? "page" : undefined}>
        <Settings size={18} strokeWidth={1.75} aria-hidden />
        <span className="max-lg:sm:sr-only">Settings</span>
      </Link>
    </nav>
  );
}
