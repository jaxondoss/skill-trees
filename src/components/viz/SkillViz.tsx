"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { addMetric } from "@/app/skill-actions";
import { logEntry } from "@/app/todo-actions";
import { logDaily } from "@/app/tracker-actions";
import type { VizData } from "@/lib/data/skill";
import { buildViz, LIFT_KEYS } from "./charts";

type Result = { ok: boolean; error?: string };

/** The skill's own visualization tile (spec v2 r2, 6): reading line, chart, legend, and its log form. */
export function SkillViz({ data, skillId, skillName, dormant }: { data: VizData; skillId: string; skillName: string; dormant: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [focus, setFocus] = useState("bench_1rm");
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const built = useMemo(() => buildViz(data, w, focus), [data, w, focus]);
  if (!built) return null;

  return (
    <section className="tile glow col-span-12 !p-5" aria-labelledby="viz-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="lbl">{skillName}</div>
          <h3 id="viz-title" className="mt-1 text-[22px] leading-7 font-extrabold tracking-tight">
            {built.title}
          </h3>
          {/* Built from escaped values only (charts.ts esc). */}
          <p className="mt-1 max-w-[760px] text-sm text-muted [&_b]:font-bold [&_b]:text-text" dangerouslySetInnerHTML={{ __html: built.reading }} />
        </div>
        {data.slug === "strength" && built.svg && (
          <div className="inline-flex gap-[3px] rounded-[9px] border border-[var(--border)] bg-sunk p-[3px]" role="group" aria-label="Lift">
            {LIFT_KEYS.filter(([k]) => (data.series[k] ?? []).length).map(([k, name]) => (
              <button key={k} type="button" aria-pressed={focus === k} onClick={() => setFocus(k)} className="min-h-7 rounded-md px-3 text-xs font-semibold text-muted aria-pressed:bg-raised aria-pressed:text-text">
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={box}
        className="relative mt-5"
        onPointerMove={(e) => {
          const el = (e.target as Element).closest?.("[data-tip]");
          setTip(el ? { x: e.clientX, y: e.clientY, text: el.getAttribute("data-tip") ?? "" } : null);
        }}
        onPointerLeave={() => setTip(null)}
      >
        {built.svg && !dormant ? (
          <div dangerouslySetInnerHTML={{ __html: built.svg }} />
        ) : (
          <div className="grid min-h-[200px] place-items-center rounded-[10px] border border-dashed border-white/10 bg-[rgba(16,16,24,0.5)] px-6 text-center">
            <div className="grid max-w-sm gap-1.5">
              <b className="text-sm">{dormant ? `${skillName} is dormant` : "Nothing logged yet"}</b>
              <span className="text-xs text-muted">{dormant ? "Wake it from Manage below to start tracking." : built.empty}</span>
            </div>
          </div>
        )}
        {tip && (
          <span className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-[7px] bg-text px-2.5 py-1.5 text-[11.5px] font-semibold whitespace-nowrap text-bg" style={{ left: tip.x, top: tip.y }} role="status">
            {tip.text}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        {built.legend.map((l) => (
          <span key={l.l} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden
              className="block"
              style={
                l.t === "line"
                  ? { width: 12, height: 3, borderRadius: 3, background: l.k }
                  : l.t === "dash"
                    ? { width: 14, borderTop: `2px dashed ${l.k}` }
                    : l.t === "dot"
                      ? { width: 10, height: 10, borderRadius: "50%", background: l.k }
                      : l.t === "diamond"
                        ? { width: 9, height: 9, background: l.k, transform: "rotate(45deg)", borderRadius: 2 }
                        : { width: 10, height: 10, borderRadius: 3, background: l.k }
              }
            />
            {l.l}
          </span>
        ))}
      </div>

      {!dormant && <LogForm data={data} skillId={skillId} />}
    </section>
  );
}

const field = "field-input text-sm";
function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

function LogForm({ data, skillId }: { data: VizData; skillId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<string[]>([]);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const num = (k: string) => (v[k] ? Number(v[k]) : NaN);
  const go = (fn: () => Promise<Result>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? ok : (r.error ?? "Something went wrong."));
      if (r.ok) {
        setV({});
        setPicks([]);
      }
    });
  const all = async (calls: (() => Promise<Result>)[]) => {
    for (const c of calls) {
      const r = await c();
      if (!r.ok) return r;
    }
    return { ok: true };
  };
  const courses = [...new Set((data.series.course_grade ?? []).map((e) => String(e.meta?.course ?? "")).filter(Boolean))];
  const books = [...new Set((data.series.book_pages ?? []).map((e) => String(e.meta?.title ?? "")).filter(Boolean))];
  const bookTotal = (t: string) => Number((data.series.book_pages ?? []).filter((e) => e.meta?.title === t && e.meta?.total).at(-1)?.meta?.total ?? 0);

  let body: ReactNode = null,
    submit: (() => void) | null = null,
    cta = "Log";
  switch (data.slug) {
    case "ai-building":
      cta = "Log a ship";
      body = (
        <F label="What shipped">
          <input className={field} value={v.t ?? ""} onChange={set("t")} maxLength={140} placeholder="Store listing generator" />
        </F>
      );
      submit = () => v.t?.trim() && go(() => logEntry(skillId, "ship", 1, { title: v.t!.trim() }), `Logged: ${v.t}.`);
      break;
    case "dropshipping":
      cta = "Save this week";
      body = (
        <>
          <F label="Revenue $">
            <input className={field} type="number" inputMode="decimal" value={v.rev ?? ""} onChange={set("rev")} placeholder="690" />
          </F>
          <F label="Ad spend $">
            <input className={field} type="number" inputMode="decimal" value={v.ad ?? ""} onChange={set("ad")} placeholder="260" />
          </F>
          <F label="Orders">
            <input className={field} type="number" inputMode="numeric" value={v.orders ?? ""} onChange={set("orders")} placeholder="16" />
          </F>
        </>
      );
      submit = () =>
        go(
          () =>
            all([
              ...(Number.isFinite(num("rev")) ? [() => addMetric(skillId, "revenue_week_usd", num("rev"))] : []),
              ...(Number.isFinite(num("ad")) ? [() => addMetric(skillId, "ad_spend_week_usd", num("ad"))] : []),
              ...(Number.isFinite(num("orders")) ? [() => addMetric(skillId, "orders_week", num("orders"))] : []),
            ]),
          "Saved this week's numbers.",
        );
      break;
    case "academics":
      cta = "Save grade";
      body = (
        <>
          <F label="Course">
            <input className={field} list="viz-courses" value={v.c ?? ""} onChange={set("c")} maxLength={40} placeholder="MATH 1210" />
            <datalist id="viz-courses">
              {courses.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </F>
          <F label="Grade %">
            <input className={field} type="number" inputMode="decimal" value={v.g ?? ""} onChange={set("g")} placeholder="92.5" />
          </F>
          <F label="Target %">
            <input className={field} type="number" inputMode="decimal" value={v.t ?? ""} onChange={set("t")} placeholder="93" />
          </F>
        </>
      );
      submit = () =>
        v.c?.trim() && Number.isFinite(num("g")) && go(() => logEntry(skillId, "course_grade", num("g"), { course: v.c!.trim(), ...(Number.isFinite(num("t")) ? { target: num("t") } : {}) }), `${v.c} saved.`);
      break;
    case "reading":
      cta = "Log pages";
      body = (
        <>
          <F label="Book">
            <input className={field} list="viz-books" value={v.b ?? ""} onChange={set("b")} maxLength={80} placeholder="Deep Work" />
            <datalist id="viz-books">
              {books.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </F>
          <F label="Pages read">
            <input className={field} type="number" inputMode="numeric" value={v.p ?? ""} onChange={set("p")} placeholder="25" />
          </F>
          {v.b && !bookTotal(v.b) && (
            <F label="Pages in the book">
              <input className={field} type="number" inputMode="numeric" value={v.total ?? ""} onChange={set("total")} placeholder="296" />
            </F>
          )}
        </>
      );
      submit = () =>
        v.b?.trim() &&
        Number.isFinite(num("p")) &&
        go(() => logEntry(skillId, "book_pages", num("p"), { title: v.b!.trim(), ...(Number.isFinite(num("total")) ? { total: num("total") } : bookTotal(v.b!) ? { total: bookTotal(v.b!) } : {}) }), `${v.p} pages of ${v.b}.`);
      break;
    case "college-integration":
      cta = "Log a conversation";
      body = (
        <>
          <F label="Who">
            <input className={field} value={v.who ?? ""} onChange={set("who")} maxLength={60} placeholder="Studio partner" />
          </F>
          <F label="Where you know them from">
            <select className={field} value={v.where ?? "Classes"} onChange={set("where")}>
              {["Classes", "Clubs", "Dorm", "Professors"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </F>
        </>
      );
      submit = () => v.who?.trim() && go(() => logEntry(skillId, "conversation", 1, { who: v.who!.trim(), where: v.where ?? "Classes" }), `Logged a conversation with ${v.who}.`);
      break;
    case "time-blocking":
      cta = "Rate today";
      body = <Seg label="Blocks kept today" opts={["0", "25", "50", "75", "100"]} suffix="%" value={v.a} onPick={(a) => setV({ ...v, a })} />;
      submit = () => v.a && go(() => logDaily("block_adherence_pct", Number(v.a)), `Rated today at ${v.a}%.`);
      break;
    case "chess":
      cta = "Save rating";
      body = (
        <F label="Rating">
          <input className={field} type="number" inputMode="numeric" value={v.r ?? ""} onChange={set("r")} placeholder="1092" />
        </F>
      );
      submit = () => Number.isFinite(num("r")) && go(() => addMetric(skillId, "chess_rating", num("r")), `Rating saved: ${v.r}.`);
      break;
    case "visualization":
      cta = "Save rating";
      body = <Seg label="How vivid was today's session" opts={["1", "2", "3", "4", "5"]} value={v.v} onPick={(x) => setV({ ...v, v: x })} />;
      submit = () => v.v && go(() => addMetric(skillId, "vividness", Number(v.v)), `Vividness ${v.v} saved.`);
      break;
    case "strength":
      cta = "Log top set";
      body = (
        <>
          <F label="Lift">
            <select className={field} value={v.l ?? "bench_1rm"} onChange={set("l")}>
              {LIFT_KEYS.map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </F>
          <F label="Weight (lb)">
            <input className={field} type="number" inputMode="decimal" value={v.wt ?? ""} onChange={set("wt")} placeholder="235" />
          </F>
          <F label="Reps">
            <input className={field} type="number" inputMode="numeric" value={v.reps ?? ""} onChange={set("reps")} placeholder="3" />
          </F>
        </>
      );
      submit = () => {
        if (!Number.isFinite(num("wt")) || !Number.isFinite(num("reps"))) return;
        const e1rm = Math.round(num("wt") * (1 + num("reps") / 30));
        go(() => addMetric(skillId, v.l ?? "bench_1rm", e1rm), `${v.wt} x ${v.reps}, about ${e1rm} estimated max.`);
      };
      break;
    case "running":
      cta = "Log run";
      body = (
        <>
          <F label="Miles">
            <input className={field} type="number" inputMode="decimal" step="any" value={v.mi ?? ""} onChange={set("mi")} placeholder="4.5" />
          </F>
          <F label="Type">
            <select className={field} value={v.k ?? "Easy"} onChange={set("k")}>
              {["Easy", "Long", "Tempo", "Intervals"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </F>
        </>
      );
      submit = () =>
        Number.isFinite(num("mi")) &&
        go(() => all([() => addMetric(skillId, "run_mi", num("mi")), ...(v.k === "Long" ? [() => addMetric(skillId, "long_run_mi", num("mi"))] : [])]), `Logged ${v.mi} mi.`);
      break;
    case "triathlon":
      cta = "Log session";
      body = (
        <>
          <F label="Discipline">
            <select className={field} value={v.k ?? "swim_min"} onChange={set("k")}>
              <option value="swim_min">Swim</option>
              <option value="bike_min">Ride</option>
            </select>
          </F>
          <F label="Minutes">
            <input className={field} type="number" inputMode="numeric" value={v.m ?? ""} onChange={set("m")} placeholder="40" />
          </F>
        </>
      );
      submit = () => Number.isFinite(num("m")) && go(() => addMetric(skillId, v.k ?? "swim_min", num("m")), `Logged ${v.m} min.`);
      break;
    case "gut-health":
      cta = "Save today";
      body = (
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold text-muted">Kept today</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kept today">
            {data.habits.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={picks.includes(h)}
                onClick={() => setPicks(picks.includes(h) ? picks.filter((x) => x !== h) : [...picks, h])}
                className="min-h-9 rounded-lg border border-[var(--border)] bg-sunk px-3 text-xs font-semibold text-muted aria-pressed:border-transparent aria-pressed:bg-[var(--tint)] aria-pressed:text-[var(--ct)]"
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      );
      submit = () =>
        picks.length &&
        go(() => all(picks.map((h, i) => () => logEntry(skillId, "gut_habit", 1, { habit: h }, i === 0 ? { replaceToday: true } : {}))), `Saved ${picks.length} of ${data.habits.length} for today.`);
      break;
    default:
      return null;
  }

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        submit?.();
      }}
    >
      {body}
      <button type="submit" disabled={pending} className="min-h-10 rounded-lg bg-[var(--c)] px-3.5 text-xs font-bold text-[var(--on-cat)] disabled:opacity-60">
        {pending ? "Saving…" : cta}
      </button>
      {msg && (
        <span role="status" className="basis-full text-xs text-muted">
          {msg}
        </span>
      )}
    </form>
  );
}

function Seg({ label, opts, value, onPick, suffix = "" }: { label: string; opts: string[]; value?: string; onPick: (v: string) => void; suffix?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <div className="inline-flex gap-[3px] rounded-[9px] border border-[var(--border)] bg-sunk p-[3px]" role="group" aria-label={label}>
        {opts.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)} className="min-h-8 min-w-10 rounded-md px-2.5 text-xs font-semibold text-muted aria-pressed:bg-raised aria-pressed:text-text">
            {o}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}
