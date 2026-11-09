"use client";

import "./admin.css";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { centreOf, layoutSides, perimeterT, tileOfObject, type PlanObject } from "@/lib/admin-items";
import type { AdminData, AdminTile } from "@/lib/data/admin";
import { ExpandedPanel } from "./ExpandedPanel";
import { FloorPlan, type ObjState } from "./FloorPlan";
import { Tile } from "./Tile";

type Layout = { rows: number; rowN: number; cols: 1 | 2; phone: boolean };
const DEFAULT_LAYOUT: Layout = { rows: 4, rowN: 6, cols: 2, phone: false };
const TILE_H = 110;
const GAP = 12;

/** Liang-Barsky: the segment parameter (0..1) where (x1, y1) -> (x2, y2) first enters the rect; 1 if it never does. */
function entryT(x1: number, y1: number, x2: number, y2: number, l: number, t: number, r: number, b: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, x1 - l],
    [dx, r - x1],
    [-dy, y1 - t],
    [dy, b - y1],
  ] as const) {
    if (p === 0) {
      if (q < 0) return 1;
      continue;
    }
    const u = q / p;
    if (p < 0) t0 = Math.max(t0, u);
    else t1 = Math.min(t1, u);
  }
  return t0 <= t1 ? t0 : 1;
}

const subscribeResize = (fn: () => void) => {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
};
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;

/** Viewport -> how many tiles fit: rows per side column, tiles per top/bottom row, 1 or 2 columns per side. */
function measure(w: number, h: number): Layout {
  if (w < 900) return { rows: 0, rowN: 1, cols: 1, phone: true };
  const cols = w >= 1180 ? 2 : 1;
  const rows = Math.max(3, Math.min(7, Math.floor((h - 48 - 32 - 2 * (TILE_H + GAP) + GAP) / (TILE_H + GAP))));
  // the top and bottom rows line up with the five columns' width: as many tiles as fit at about 180 px
  const rowN = Math.max(4, Math.min(8, Math.floor((w - 32 + GAP) / (180 + GAP))));
  return { rows, rowN, cols, phone: false };
}

/**
 * The admin view: the room's floor plan in the middle, a tile per skill and feature around it (ordered clockwise by
 * where their object stands, so leader lines do not cross), dashed leader lines from tile to object. Clicking a tile
 * or an object goes to /admin/<id>; the server renders that dashboard and it opens here in a panel grown from the
 * tile. Esc or a click outside closes it. Phone: the plan stacks above a tile list.
 */
export function AdminView({ data, children }: { data: AdminData; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const item = path.startsWith("/admin/") ? decodeURIComponent(path.slice("/admin/".length)) : null;
  const viewport = useSyncExternalStore(subscribeResize, viewportKey, () => null);
  const layout = useMemo<Layout>(() => {
    if (!viewport) return DEFAULT_LAYOUT;
    const [w, h] = viewport.split("x").map(Number);
    return measure(w!, h!);
  }, [viewport]);
  const ready = viewport !== null;
  const [hot, setHot] = useState<string | null>(null);
  // what the user asked for before the server answered: a tile id, null (closed), or undefined (follow the URL)
  const [want, setWant] = useState<string | null | undefined>(undefined);
  const [prevItem, setPrevItem] = useState(item);
  if (prevItem !== item) {
    setPrevItem(item);
    setWant(undefined);
  }
  const shown = want === undefined ? item : want;
  const origin = useRef<DOMRect | null>(null);
  const opener = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ tile: string; obj: string; x1: number; y1: number; x2: number; y2: number; ex: number; ey: number }[]>([]);

  const tiles = data.tiles;
  const byId = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  // callout numbers: tiles with objects first, clockwise from the top-left corner, then the rest
  const { order, numOf, placed, unplaced } = useMemo(() => {
    const objs = new Map<string, PlanObject[]>();
    for (const o of data.plan.objects) {
      const t = tileOfObject(o);
      if (t && byId.has(t)) objs.set(t, [...(objs.get(t) ?? []), o]);
    }
    const placed = tiles
      .filter((t) => objs.has(t.id))
      .map((t) => {
        // a tile with several objects sits by its first one in the loop
        const ts = objs.get(t.id)!.map((o) => {
          const c = centreOf(o);
          return perimeterT(c.x, c.z);
        });
        return { id: t.id, t: Math.min(...ts) };
      })
      .sort((a, b) => a.t - b.t);
    const unplaced = tiles.filter((t) => !objs.has(t.id)).map((t) => t.id);
    const order = [...placed.map((p) => p.id), ...unplaced];
    const numOf = new Map(order.map((id, i) => [id, String(i + 1).padStart(2, "0")]));
    return { order, numOf, placed, unplaced };
  }, [data.plan.objects, tiles, byId]);

  const sides = useMemo(() => {
    if (layout.phone) return null;
    const sideCap = layout.rows * layout.cols;
    const s = layoutSides(placed, [], { top: layout.rowN, right: sideCap, bottom: layout.rowN, left: sideCap });
    // free slots in the side columns take the tiles without an object; the rest go to the bottom row
    const rest = [...unplaced];
    for (const k of ["left", "right"] as const) while (rest.length && s[k].length < sideCap) s[k].push(rest.shift()!);
    s.bottom.push(...rest);
    // inner column (next to the plan) first, so most leader lines do not cross a tile
    const split = (ids: string[]) => ({ inner: ids.slice(0, layout.rows), outer: ids.slice(layout.rows) });
    return { top: s.top, bottom: s.bottom, left: layout.cols === 2 ? split(s.left) : { inner: s.left, outer: [] }, right: layout.cols === 2 ? split(s.right) : { inner: s.right, outer: [] } };
  }, [layout, placed, unplaced]);

  // leader lines: tile edge (the side facing the plan) to the object's callout, in stage coordinates
  const drawLines = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || layout.phone) return setLines([]);
    const s = stage.getBoundingClientRect();
    const roomEl = stage.querySelector(".fp-room")?.getBoundingClientRect();
    const out: typeof lines = [];
    for (const g of stage.querySelectorAll<SVGGElement>(".fp-obj")) {
      const tile = g.dataset.tile!;
      const el = stage.querySelector<HTMLElement>(`.adm-tile[data-tile="${CSS.escape(tile)}"]`);
      const tag = g.querySelector(".fp-tag");
      if (!el || !tag) continue;
      const r = el.getBoundingClientRect();
      const o = tag.getBoundingClientRect();
      const ox = o.left + o.width / 2 - s.left;
      const oy = o.top + o.height / 2 - s.top;
      const side = el.closest("[data-side]")?.getAttribute("data-side");
      let x1 = r.left + r.width / 2 - s.left;
      let y1 = r.top + r.height / 2 - s.top;
      if (side === "top") y1 = r.bottom - s.top;
      else if (side === "bottom") y1 = r.top - s.top;
      else if (side === "left") x1 = r.right - s.left;
      else if (side === "right") x1 = r.left - s.left;
      // where the line meets the room's outline: at rest the line stops there, so the plan stays clean
      let ex = ox;
      let ey = oy;
      if (roomEl) {
        const t = entryT(x1, y1, ox, oy, roomEl.left - s.left, roomEl.top - s.top, roomEl.right - s.left, roomEl.bottom - s.top);
        ex = x1 + (ox - x1) * t;
        ey = y1 + (oy - y1) * t;
      }
      out.push({ tile, obj: g.dataset.obj!, x1, y1, x2: ox, y2: oy, ex, ey });
    }
    setLines(out);
  }, [layout.phone]);

  useLayoutEffect(() => {
    drawLines();
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => drawLines());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [drawLines, sides]);

  const open = useCallback(
    (id: string, from: Element) => {
      origin.current = from.getBoundingClientRect();
      opener.current = id;
      setWant(id);
      router.push(`/admin/${id}`, { scroll: false });
    },
    [router],
  );
  const close = useCallback(() => {
    setWant(null);
    router.push("/admin", { scroll: false });
    const id = opener.current ?? item;
    requestAnimationFrame(() => {
      const link = document.querySelector<HTMLElement>(`[data-tile-link="${CSS.escape(id ?? "")}"]`);
      link?.focus();
    });
  }, [router, item]);

  const stateOf = useCallback(
    (id: string): ObjState | null => {
      const t = byId.get(id);
      if (!t) return null;
      const off = t.status === "dormant" || t.status === "archived";
      return { num: numOf.get(id)!, warn: t.neglected && !off, off, logged: !!t.goal?.result, title: t.title };
    },
    [byId, numOf],
  );

  const tileEl = (id: string) => {
    const t = byId.get(id);
    if (!t) return null;
    return (
      <Tile
        key={id}
        tile={t}
        num={numOf.get(id)!}
        hot={hot === id}
        onHover={setHot}
        onOpen={(tid, from, e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab: let the link work
          e.preventDefault();
          open(tid, from);
        }}
      />
    );
  };

  const shownTile: AdminTile | null = shown ? (byId.get(shown) ?? null) : null;
  const warnCount = tiles.filter((t) => t.neglected && t.status === "active").length;

  return (
    <div className="adm" data-admin-view data-ready={ready || undefined}>
      <header className="adm-bar">
        <h1>FORGE / ADMIN</h1>
        <span className="adm-meta">
          {`${data.today}  OVERALL ${data.overall.display}/100  TIER ${data.overall.numeral}  ${tiles.length} TILES`}
          {warnCount > 0 && <span style={{ color: "var(--adm-amber)" }}>{`  ${warnCount} NEGLECTED`}</span>}
        </span>
        <span className="adm-spacer" />
        {/* a full load: the room's classic scripts start fresh */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="adm-btn" href="/" aria-label="Back to the room">
          ROOM
        </a>
      </header>

      <div
        ref={stageRef}
        className="adm-stage"
        style={{
          ["--adm-row-n" as string]: layout.rowN,
          ["--adm-plan-h" as string]: `${layout.rows * TILE_H + (layout.rows - 1) * GAP}px`,
          ["--adm-tile-h" as string]: `${TILE_H}px`,
        }}
      >
        {sides && (
          <svg className="adm-leaders" aria-hidden>
            {lines.map((l) => {
              const t = byId.get(l.tile);
              const warn = !!t?.neglected && t.status === "active";
              return (
                <g key={`${l.tile}:${l.obj}`} className={`${hot === l.tile ? "is-hot" : ""}${warn ? " is-warn" : ""}`}>
                  {hot === l.tile ? <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} /> : <line x1={l.x1} y1={l.y1} x2={l.ex} y2={l.ey} />}
                  <circle cx={l.x1} cy={l.y1} r={2} />
                </g>
              );
            })}
          </svg>
        )}
        {sides && (
          <>
            <div className="adm-row top" data-side="top">
              {sides.top.map(tileEl)}
            </div>
            <div className="adm-side left outer" data-side="left">
              {sides.left.outer.map(tileEl)}
            </div>
            <div className="adm-side left inner" data-side="left" style={layout.cols === 1 ? { gridColumn: "1 / 3" } : undefined}>
              {sides.left.inner.map(tileEl)}
            </div>
          </>
        )}
        <div className="adm-plan">
          <FloorPlan plan={data.plan} stateOf={stateOf} tileOf={(o) => tileOfObject(o)} hot={hot} onHover={setHot} onOpen={open} />
        </div>
        {sides && (
          <>
            <div className="adm-side right inner" data-side="right" style={layout.cols === 1 ? { gridColumn: "4 / 6" } : undefined}>
              {sides.right.inner.map(tileEl)}
            </div>
            <div className="adm-side right outer" data-side="right">
              {sides.right.outer.map(tileEl)}
            </div>
            <div className="adm-row bottom" data-side="bottom">
              {sides.bottom.map(tileEl)}
            </div>
          </>
        )}
        {!sides && (
          <div className="adm-list-phone" data-side="list">
            {order.map(tileEl)}
          </div>
        )}
      </div>

      {/* the page segment always renders (instant navigation); it shows only inside the panel */}
      {!(shown && item === shown) && <div hidden>{children}</div>}
      {shown && (
        <ExpandedPanel
          key={shown}
          title={shownTile?.title ?? shown}
          num={numOf.get(shown) ?? ""}
          originRef={origin}
          onClose={close}
        >
          {item === shown ? children : <p className="adm-loading">Loading.</p>}
        </ExpandedPanel>
      )}
    </div>
  );
}

