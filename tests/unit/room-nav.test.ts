// Room v3.5 navigator (docs/redesign/room-prototype/engine/nav.js): the pure planner, the interruption policy and
// the route format. The engine file is a classic script that also exports its pure helpers through module.exports.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const N = require("../../docs/redesign/room-prototype/engine/nav.js");

type Place = { mode: string; view: string; zone: string | null; item: string | null; base?: string | null; baseZone?: string | null };
const wall = (v: string): Place => N.place("wall", v);
const zone = (v: string, z: string): Place => N.place("zone", v, z);
const skill = (v: string, z: string, item: string, base = "wall", baseZone: string | null = null): Place =>
  N.place("skill", v, z, item, { base, baseZone });
const overview = (ret: Place): Place => N.place("overview", ret.view, null, null, { ret });
const kinds = (from: Place, to: Place) => N.planFor(from, to).map((l: { kind: string }) => l.kind).join("+");

describe("planFor: the legs of every move (PLAN 2.1)", () => {
  it("walls and zones", () => {
    expect(kinds(wall("front"), wall("right"))).toBe("turn");
    expect(kinds(wall("front"), wall("back"))).toBe("turn");
    expect(N.planFor(wall("front"), wall("back"))[0]).toMatchObject({ dir: 1, steps: 2 });
    expect(N.planFor(wall("front"), wall("left"))[0]).toMatchObject({ dir: -1, steps: 1 });
    expect(kinds(wall("front"), zone("front", "window"))).toBe("dolly");
    expect(kinds(zone("front", "window"), wall("front"))).toBe("dolly");
    expect(kinds(zone("front", "window"), zone("front", "library"))).toBe("dolly");
    expect(kinds(zone("front", "window"), zone("right", "gym"))).toBe("turn"); // TURN+ZOOM
    expect(kinds(wall("front"), wall("front"))).toBe("");
  });
  it("skill views: same wall lifts in place (R1), other walls turn first, overview descends first (R3)", () => {
    expect(kinds(wall("front"), skill("front", "window", "library.chess"))).toBe("lift");
    expect(kinds(zone("front", "library"), skill("front", "window", "library.chess", "zone", "library"))).toBe("lift");
    expect(kinds(wall("right"), skill("front", "window", "library.chess"))).toBe("turn+lift");
    expect(kinds(overview(wall("front")), skill("left", "bed", "bed.bed"))).toBe("descend+lift");
    const chain = N.planFor(overview(wall("front")), skill("left", "bed", "bed.bed"));
    expect(chain[0].to).toMatchObject({ mode: "wall", view: "left" }); // the item's wall rest, never a zone
  });
  it("closing, swapping and leaving a skill view", () => {
    const s = skill("front", "window", "library.chess", "zone", "window");
    expect(kinds(s, zone("front", "window"))).toBe("drop");
    expect(N.baseOf(s)).toMatchObject({ mode: "zone", zone: "window" });
    expect(kinds(s, wall("front"))).toBe("drop+dolly");
    expect(kinds(s, skill("front", "window", "bed.cushion", "zone", "window"))).toBe("swap");
    expect(kinds(s, skill("left", "bed", "bed.bed"))).toBe("drop+turn+lift");
    expect(kinds(s, overview(zone("front", "window")))).toBe("drop+rise"); // A9: Up closes and rises
  });
  it("overview", () => {
    expect(kinds(wall("back"), overview(wall("back")))).toBe("rise");
    expect(kinds(zone("right", "gym"), overview(zone("right", "gym")))).toBe("rise");
    expect(kinds(overview(wall("front")), zone("left", "kitchen"))).toBe("descend");
  });
});

describe("policy: a request while a move runs (D4 5)", () => {
  const turnMove = (from: Place, to: Place) => ({ from, to, legs: N.planFor(from, to), leg: 0 });
  it("ignores the same target, reverses back to the start, queues the rest", () => {
    const m = { from: wall("front"), to: zone("front", "window"), legs: N.planFor(wall("front"), zone("front", "window")), leg: 0 };
    expect(N.policy(null, wall("front"))).toBe("start");
    expect(N.policy(m, zone("front", "window"))).toBe("ignore");
    expect(N.policy(m, wall("front"))).toBe("reverse");
    expect(N.policy(m, zone("front", "library"))).toBe("queue");
    expect(N.policy({ ...m, pending: zone("front", "library") }, zone("front", "library"))).toBe("ignore");
    expect(N.policy({ ...m, reversed: true }, wall("front"))).toBe("queue"); // a reversed move is not reversed again
  });
  it("retargets a turn one wall further, three quarter turns at most", () => {
    const m = turnMove(wall("front"), wall("right"));
    expect(N.policy(m, wall("back"))).toBe("retarget");
    expect(N.policy(m, wall("left"))).toBe("queue"); // the other way: queued, not a retarget
    expect(N.policy({ ...turnMove(wall("front"), wall("back")), ahead: 2 }, wall("left"))).toBe("retarget"); // A4: three presses land on the left wall
    const far = { from: wall("right"), to: wall("front"), legs: [{ kind: "turn", dir: 1, steps: 3 }], leg: 0, ahead: 3 };
    expect(N.policy(far, wall("right"))).toBe("reverse");
    expect(N.policy({ ...far, from: wall("back") }, wall("right"))).toBe("queue"); // a fourth press waits
  });
  it("Esc during a lift reverses it (a drop from the current frame); a chain is never reversed", () => {
    const s = skill("front", "window", "library.chess");
    expect(N.policy({ from: wall("front"), to: s, legs: N.planFor(wall("front"), s), leg: 0 }, wall("front"))).toBe("reverse");
    const c = skill("left", "bed", "bed.bed");
    expect(N.policy({ from: wall("front"), to: c, legs: N.planFor(wall("front"), c), leg: 0 }, wall("front"))).toBe("queue");
  });
});

describe("routes (PLAN 2.2, A4)", () => {
  it("formats every place", () => {
    expect(N.routeOf(wall("front"))).toBe("");
    expect(N.routeOf(wall("right"))).toBe("right");
    expect(N.routeOf(zone("front", "window"))).toBe("window");
    expect(N.routeOf(overview(wall("front")))).toBe("overview");
    // the item's real zone: the chess table stands in the window zone
    expect(N.routeOf(skill("front", "window", "library.chess"))).toBe("window/chess");
    expect(N.routeOf(skill("front", "window", "window.statue"))).toBe("window/statue");
  });
  it("parses app paths and prototype hashes, and round-trips", () => {
    expect(N.parseRoute("/")).toEqual({ a: null, b: null });
    expect(N.parseRoute("/room")).toEqual({ a: null, b: null });
    expect(N.parseRoute("/room/right")).toEqual({ a: "right", b: null });
    expect(N.parseRoute("#/room/window/chess")).toEqual({ a: "window", b: "chess" });
    expect(N.parseRoute("/room/overview/")).toEqual({ a: "overview", b: null });
    expect(N.parseRoute("/stats")).toBeNull();
    expect(N.parseRoute("/room/a/b/c")).toBeNull();
    for (const p of [wall("back"), zone("right", "gym"), skill("right", "gym", "gym.strength"), overview(wall("front"))]) {
      const r = N.parseRoute("/room/" + N.routeOf(p));
      expect([r.a, r.b].filter(Boolean).join("/")).toBe(N.routeOf(p));
    }
  });
});
