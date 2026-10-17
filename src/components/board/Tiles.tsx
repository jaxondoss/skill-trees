import Link from "next/link";
import type { ReactNode } from "react";
import { SkillIcon } from "@/components/board/SkillIcon";
export { RingTile } from "@/components/board/RingTile";
import type { ActivityItem, BoardData, DueItem, ScheduleItem } from "@/lib/data/board";
import type { SkillView } from "@/lib/data/dashboard";
import { CATEGORY_ORDER, catClass } from "@/lib/palette";

const TIER_LABEL = { floor: "Floor", standard: "Standard", stretch: "Stretch" } as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SectionHeader({ title, meta, id, children }: { title: string; meta?: ReactNode; id?: string; children?: ReactNode }) {
  return (
    <div className="sec col-span-full mt-5">
      <h2 id={id}>{title}</h2>
      {meta !== undefined && <span className="meta">{meta}</span>}
      {children}
    </div>
  );
}

export function NextUpTile({ items, dayType }: { items: ScheduleItem[]; dayType: string }) {
  return (
    <section className="tile" aria-labelledby="h-next">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="h-next" className="lbl">
          Next up
        </h2>
        <span className="font-mono text-[11px] text-label">{dayType}</span>
      </div>
      {items.length ? (
        <ul className="grid gap-1.5">
          {items.map((s, i) => (
            <li key={i} className={`grid grid-cols-[46px_minmax(0,1fr)] items-center gap-2.5 ${catClass(s.category)}`} data-cat={s.category}>
              <time className={`font-mono text-[11px] ${s.now ? "text-text" : "text-label"}`}>{s.time}</time>
              <div className={`sunk-row relative overflow-hidden py-2 pr-2.5 pl-3.5 ${s.now ? "!bg-[#171826]" : ""}`}>
                <span aria-hidden className="absolute inset-y-[7px] left-0 w-[3px] rounded-r bg-[var(--c)] shadow-[0_0_8px_var(--c)]" />
                <b className="block text-[13px] font-bold">{s.title}</b>
                <span className="text-[11.5px] text-muted">
                  {s.sub}
                  {s.end ? `, until ${s.end}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          No classes today. Class times live in <Link href="/settings" className="underline underline-offset-4">Settings</Link>.
        </p>
      )}
    </section>
  );
}

export function DueTile({ items }: { items: DueItem[] }) {
  return (
    <section className="tile c-school" aria-labelledby="h-due">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="h-due" className="lbl">
          Due soon
        </h2>
        <Link href="/s/academics" className="font-mono text-[11px] text-label hover:text-text">
          Academics
        </Link>
      </div>
      {items.length ? (
        <ul className="grid gap-1.5">
          {items.map((d) => (
            <li key={d.id} className="sunk-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2" data-cat="school">
              <div className="min-w-0">
                <b className="block truncate text-[13px] font-bold">{d.name}</b>
                {d.course && <span className="text-[11.5px] text-muted">{d.course}</span>}
              </div>
              <span className={`font-mono text-[11px] ${d.hours <= 48 ? "text-[var(--ct)]" : "text-muted"}`}>
                {d.hours <= 48 ? `${d.hours} h` : `${Math.round(d.hours / 24)} days`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Nothing due this week.</p>
      )}
    </section>
  );
}

export function SkillGrid({ data }: { data: BoardData }) {
  const order = (s: SkillView) => CATEGORY_ORDER.indexOf((data.catSlug[s.categoryId] ?? "") as (typeof CATEGORY_ORDER)[number]);
  const rank = (s: SkillView) => (s.status === "archived" ? 100 : 0) + order(s);
  const skills = [...data.skills].sort((a, b) => rank(a) - rank(b));
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {skills.map((s) => {
        const cat = data.catSlug[s.categoryId] ?? "";
        const info = data.skillInfo[s.id];
        const dormant = s.status === "dormant";
        const archived = s.status === "archived";
        let sub: string, status: string, quiet: boolean;
        if (archived) {
          sub = "Trophy Room";
          status = `Final score ${Math.round(s.finalScore ?? s.display)}`;
          quiet = true;
        } else if (dormant) {
          sub = "Dormant";
          status = "Wake it when you are ready";
          quiet = true;
        } else if (!info || (!info.goals && !info.steps)) {
          sub = "Empty to-do list";
          status = "Add your first goal";
          quiet = true;
        } else {
          sub = `${s.pinned ? "Rack, " : ""}${info.goals} goal${info.goals === 1 ? "" : "s"}, ${info.stepsDone} of ${info.steps} steps`;
          const t = info.today;
          status = t
            ? t.result
              ? `${t.title}, ${TIER_LABEL[t.result]}`
              : `${t.title} is open`
            : info.firstGoal
              ? `${info.firstGoal.name}, ${info.firstGoal.days.length === 7 ? "daily" : info.firstGoal.days.map((d) => DAY_SHORT[d]).join(" ")}`
              : "Steps only";
          quiet = !t?.result;
        }
        return (
          <Link
            key={s.id}
            href={`/s/${s.slug}`}
            className={`tile glow block min-h-[160px] pb-[18px] ${catClass(cat)} ${dormant || archived ? "opacity-70" : ""}`}
            data-cat={cat}
            data-skill-tile={s.id}
            aria-label={`${s.name}, ${archived ? "Trophy Room" : dormant ? "dormant" : s.display}. ${sub}. ${status}.`}
          >
            <span className="icon-tile">
              <SkillIcon slug={s.slug} size={18} />
            </span>
            <span className="absolute top-4 right-4 font-mono text-lg font-semibold">{dormant ? "-" : archived ? Math.round(s.finalScore ?? s.display) : s.display}</span>
            <div className="mt-3 text-[15px] leading-5 font-bold">{s.name}</div>
            <div className="text-xs text-muted">{sub}</div>
            <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${quiet ? "text-muted" : "text-[var(--ct)]"}`}>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">{status}</span>
            </div>
            <div className="bar3">
              <b style={{ ["--p" as string]: `${dormant ? 0 : s.display}%` }} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function ActivityTile({ items }: { items: ActivityItem[] }) {
  return (
    <section className="tile col-span-full" aria-labelledby="h-act">
      <h2 id="h-act" className="lbl mb-3">
        Activity
      </h2>
      {items.length ? (
        <ul className="grid gap-x-6 md:grid-cols-2">
          {items.slice(0, 8).map((a) => (
            <li key={a.id} className={`grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-[var(--border)] py-2 ${catClass(a.category)}`}>
              <i aria-hidden className="size-[7px] rounded-full bg-[var(--c)] shadow-[0_0_6px_var(--c)]" />
              {a.skillSlug ? (
                <Link href={`/s/${a.skillSlug}`} className="truncate text-[13px] hover:underline">
                  {a.what}
                </Link>
              ) : (
                <span className="truncate text-[13px]">{a.what}</span>
              )}
              <span className="text-[11px] text-label">{a.kind}</span>
              <span className="font-mono text-[11px] text-label">{a.when}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Everything you log shows up here, newest first.</p>
      )}
    </section>
  );
}
