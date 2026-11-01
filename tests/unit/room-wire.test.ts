// Room v3.5 skill wires (D3-FINAL): the runtime hull (decode.js wireFromMask) and the pure wire.js parts.
// Both engine files are classic scripts that also export through module.exports.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const D = require("../../docs/redesign/room-prototype/engine/decode.js");
const W = require("../../docs/redesign/room-prototype/engine/wire.js");

type Wire = { hull: Int16Array; nodes: number[] };

function mask(rows: string[]) {
  const h = rows.length, w = rows[0]!.length, m = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => (m[y * w + x] = c === "#" ? 1 : 0)));
  return { m, w, h };
}
function wireOf(rows: string[], shape?: string): Wire {
  const { m, w, h } = mask(rows);
  return D.wireFromMask(m, w, h, shape);
}
const key = (x: number, y: number) => x + "," + y;
function pointSet(r: Wire) {
  const s = new Set<string>();
  for (let i = 0; i < r.hull.length; i += 2) s.add(key(r.hull[i]!, r.hull[i + 1]!));
  return s;
}
/** Every line pixel has exactly two 4-neighbours on the line or is a corner (closed loop, no 1 px gap). */
function closedLoop(r: Wire) {
  const s = pointSet(r);
  // 8-connected walk from the first pixel reaches every pixel
  const pts = [...s];
  const seen = new Set([pts[0]]);
  const stack = [pts[0]];
  while (stack.length) {
    const [x = 0, y = 0] = stack.pop()!.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const k = key(x + dx, y + dy);
        if (s.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
  }
  if (seen.size !== s.size) return false;
  // no end points: every pixel has >= 2 line neighbours (8-connected)
  for (const p of pts) {
    const [x = 0, y = 0] = p.split(",").map(Number);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && s.has(key(x + dx, y + dy))) n++;
    if (n < 2) return false;
  }
  return true;
}
/** Chebyshev distance from (x, y) to the nearest object pixel. */
function cheb(rows: string[], x: number, y: number) {
  let best = 1e9;
  rows.forEach((r, yy) => [...r].forEach((c, xx) => c === "#" && (best = Math.min(best, Math.max(Math.abs(xx - x), Math.abs(yy - y))))));
  return best;
}

describe("D.wire hull (D3 2.1)", () => {
  it("rectangle: closed loop at Chebyshev 2, nodes at the corners", () => {
    const rows = ["######", "######", "######", "######"];
    const r = wireOf(rows);
    expect(r.hull.length / 2).toBe(2 * (10 + 8) - 4);
    expect(closedLoop(r)).toBe(true);
    expect(r.nodes).toEqual([-2, -2, 7, -2, 7, 5, -2, 5]);
    for (let i = 0; i < r.hull.length; i += 2) expect(cheb(rows, r.hull[i]!, r.hull[i + 1]!)).toBe(2);
  });

  it("ring with a hole: the hole is filled, one outer loop only", () => {
    const rows = ["#######", "#.....#", "#.....#", "#.....#", "#######"];
    const r = wireOf(rows);
    expect(closedLoop(r)).toBe(true);
    for (let i = 0; i < r.hull.length; i += 2) {
      const x = r.hull[i]!, y = r.hull[i + 1]!;
      expect(x < 0 || x > 6 || y < 0 || y > 4).toBe(true);
    }
    expect(r.nodes).toEqual([-2, -2, 8, -2, 8, 6, -2, 6]);
  });

  it("U shape: the notch is closed (orthogonal hull), the line stays one loop", () => {
    const rows = ["##....##", "##....##", "##....##", "########"];
    const r = wireOf(rows);
    expect(closedLoop(r)).toBe(true);
    // the top edge runs straight across the notch
    for (let x = -1; x <= 8; x++) expect(pointSet(r).has(key(x, -2))).toBe(true);
  });

  it("diagonal: a staircase hull, closed, nodes at the diagonal extremes, never touching the object", () => {
    const rows = ["#.....", ".#....", "..#...", "...#..", "....#.", ".....#"];
    const r = wireOf(rows);
    expect(closedLoop(r)).toBe(true);
    for (let i = 0; i < r.hull.length; i += 2) expect(cheb(rows, r.hull[i]!, r.hull[i + 1]!)).toBeGreaterThanOrEqual(2);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < r.hull.length; i += 2) {
      xs.push(r.hull[i]!);
      ys.push(r.hull[i + 1]!);
    }
    const sums = xs.map((x, i) => x + ys[i]!);
    expect(r.nodes[0]! + r.nodes[1]!).toBe(Math.min(...sums));
    expect(r.nodes[4]! + r.nodes[5]!).toBe(Math.max(...sums));
    const bbox = wireOf(rows, "bbox");
    expect(bbox.nodes).toEqual([-2, -2, 7, -2, 7, 7, -2, 7]);
  });

  it("a 1 px gap in the object is bridged: still one loop", () => {
    const rows = ["###.###", "###.###", "###.###"];
    const r = wireOf(rows);
    expect(closedLoop(r)).toBe(true);
    expect(r.hull.length / 2).toBe(2 * (11 + 7) - 4);
  });

  it("empty mask gives null", () => {
    expect(wireOf(["...", "..."])).toBeNull();
  });
});

describe("cage gate (D3 2.1: over <= 5, under >= -2 per side)", () => {
  // gate values of the P6-M1 bundle
  it("bike fails, chess fails, board passes, ai passes at 5", () => {
    expect(W.gatePass({ over: [8, 4, 17, 9], under: [0, 0, 0, 0] })).toBe(false);
    expect(W.gatePass({ over: [11, 4, 17, 10], under: [0, 0, 0, 0] })).toBe(false);
    expect(W.gatePass({ over: [1, 0, 1, 1], under: [0, 0, 0, 0] })).toBe(true);
    expect(W.gatePass({ over: [5, 0, 5, 0], under: [-2, 0, 0, -2] })).toBe(true);
    expect(W.gatePass({ over: [0, 0, 0, 0], under: [-3, 0, 0, 0] })).toBe(false);
    expect(W.gatePass(null)).toBe(false);
  });
});

describe("markState", () => {
  it.each([
    ["active", "off", false, false, "off"],
    ["active", "off", false, true, "neglect"],
    ["active", "pending", false, true, "pending"],
    ["active", "pending", true, false, "top"],
    ["active", "blink", true, false, "top"],
    ["active", "half", true, false, "half"],
    ["active", "full", false, false, "full"],
    ["dormant", "pending", false, false, null],
    ["archived", "off", false, false, null],
  ])("%s %s top=%s neglected=%s -> %s", (status, led, top, neg, want) => {
    expect(W.markState(status, led, top, neg)).toBe(want);
  });
});

describe("styleFor (D3 2.2 table)", () => {
  const base = { skill: true, feature: false, scene: "front", hovered: false, inspect: false, skillOpen: null, cage: true };
  const pick = (s: Record<string, unknown> | null) => s && [s.kind, s.line, s.node, s.breathe, s.dash, s.bit4];

  it.each([
    ["off", ["wire", "GOLD_MID", "GOLD_MID", false, false, true]],
    ["pending", ["wire", "GOLD", "GOLD_HI", false, false, true]],
    ["top", ["wire", "GOLD", "SUN", true, false, true]],
    ["half", ["wire", "GOLD_HI", "GOLD", false, false, true]],
    ["full", ["wire", "GOLD_HI", "CREAM", false, false, true]],
    ["neglect", ["wire", "SLATE_1", "SLATE_1", false, false, true]],
  ])("rest %s", (state, want) => {
    expect(pick(W.styleFor({ ...base, state }))).toEqual(want);
  });

  it("dormant or archived: no mark at rest, hot wire (never a cage) on hover", () => {
    expect(W.styleFor({ ...base, state: null })).toBeNull();
    expect(pick(W.styleFor({ ...base, state: null, hovered: true }))).toEqual(["hot", "SUN", "CREAM", false, false, true]);
  });
  it("neglected floor item falls back to PAPER_DK", () => {
    expect(pick(W.styleFor({ ...base, state: "neglect", lightNeglect: true }))).toEqual(["wire", "PAPER_DK", "PAPER_DK", false, false, true]);
  });
  it("hover: cage SUN when the gate passes, else hot wire SUN", () => {
    expect(pick(W.styleFor({ ...base, state: "pending", hovered: true }))).toEqual(["cage", "SUN", "CREAM", false, false, true]);
    expect(pick(W.styleFor({ ...base, state: "pending", hovered: true, cage: false }))).toEqual(["hot", "SUN", "CREAM", false, false, true]);
    expect(W.styleFor({ ...base, state: "pending", hovered: true }).ink).toBe("INK");
  });
  it("Shift inspect: GOLD_HI cage or hot wire; the hovered one SUN", () => {
    expect(pick(W.styleFor({ ...base, state: "off", inspect: true }))).toEqual(["cage", "GOLD_HI", "CREAM", false, false, true]);
    expect(pick(W.styleFor({ ...base, state: "off", inspect: true, cage: false }))).toEqual(["hot", "GOLD_HI", "CREAM", false, false, true]);
    expect(pick(W.styleFor({ ...base, state: "off", inspect: true, hovered: true }))![1]).toBe("SUN");
  });
  it("features: nothing at rest, hot wire on attention, never a cage", () => {
    const f = { ...base, skill: false, feature: true, state: null };
    expect(W.styleFor(f)).toBeNull();
    expect(pick(W.styleFor({ ...f, hovered: true }))).toEqual(["hot", "SUN", "CREAM", false, false, true]);
    expect(pick(W.styleFor({ ...f, inspect: true }))).toEqual(["hot", "GOLD_HI", "CREAM", false, false, true]);
  });
  it("skill view: the item is a dashed GOLD_DK socket with bit4; other rest wires drop bit4; no attention", () => {
    expect(pick(W.styleFor({ ...base, state: "pending", skillOpen: "self" }))).toEqual(["socket", "GOLD_DK", null, false, true, true]);
    expect(pick(W.styleFor({ ...base, state: "pending", skillOpen: "other" }))).toEqual(["wire", "GOLD", "GOLD_HI", false, false, false]);
    expect(pick(W.styleFor({ ...base, state: "pending", skillOpen: "other", hovered: true }))![0]).toBe("wire");
    expect(W.styleFor({ ...base, skill: false, feature: true, state: null, skillOpen: "other" })).toBeNull();
  });
  it("overview: rest wire, hot wire on attention, never a cage", () => {
    const o = { ...base, scene: "top", state: "pending" };
    expect(pick(W.styleFor(o))![0]).toBe("wire");
    expect(pick(W.styleFor({ ...o, hovered: true }))![0]).toBe("hot");
    expect(pick(W.styleFor({ ...o, inspect: true }))![0]).toBe("hot");
  });
  it("draw-on: 1/3, 2/3, full at 0, 40, 80 ms; complete under reduced motion", () => {
    expect(W.drawOnK(0, false)).toBeCloseTo(1 / 3);
    expect(W.drawOnK(39, false)).toBeCloseTo(1 / 3);
    expect(W.drawOnK(40, false)).toBeCloseTo(2 / 3);
    expect(W.drawOnK(80, false)).toBe(1);
    expect(W.drawOnK(0, true)).toBe(1);
  });
});
