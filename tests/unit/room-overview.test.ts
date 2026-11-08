// Room v3.5 overview (docs/redesign/room-prototype/engine/overview.js, D2-FINAL 2.2 / 2.6): the camera table, the
// pick-at-point logic (A3 nearest centre, territory cells) and the twins' state parity with their room items.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const O = require("../../docs/redesign/room-prototype/engine/overview.js");
const CORE = [0, 0, 360, 300];

// z, then the diorama's top-left in device px (= -ox, -oy)
const cam = (W: number, H: number, dpr: number, zRoom: number) => {
  const c = O.fitCamera(W, H, dpr, zRoom, CORE);
  return { z: c.z, x: -c.ox, y: -c.oy, w: 360 * c.z, h: 300 * c.z };
};

describe("fitCamera: the D2 2.2 table (integer zoom, integer origin, inside the safe box)", () => {
  it("1280x800 dpr1: z 2, 720x600 under the title", () => {
    const c = cam(1280, 800, 1, 2);
    expect(c.z).toBe(2);
    expect(c.x).toBe(280);
    expect(c.y).toBeGreaterThanOrEqual(100);
    expect(c.y + c.h).toBeLessThanOrEqual(800 - 52);
  });
  it("1440x900 dpr1: z 2, centred in 100..848", () => {
    const c = cam(1440, 900, 1, 2);
    expect(c.z).toBe(2);
    expect(c.x).toBe(360);
    expect(c.y).toBe(100 + Math.floor((900 - 52 - 100 - 600) / 2));
  });
  it("1920x1080 dpr1: z 3 (the room's zoom), 1080x900", () => {
    const c = cam(1920, 1080, 1, 3);
    expect(c.z).toBe(3);
    expect(c.y).toBeGreaterThanOrEqual(100);
    expect(c.y + c.h).toBeLessThanOrEqual(1080 - 52);
  });
  it("a room zoom that does not fit drops by whole steps (never fractional)", () => {
    expect(cam(1280, 800, 1, 4).z).toBe(2);
    expect(cam(1920, 1080, 1, 4).z).toBe(3);
  });
  it("phones: 1 CSS px per art px (z = dpr), x 15 CSS, y 140 CSS", () => {
    for (const dpr of [3, 2, 1]) {
      const c = cam(390 * dpr, 844 * dpr, dpr, 2 * dpr);
      expect(c.z).toBe(dpr);
      expect(c.x).toBe(15 * dpr);
      expect(c.y).toBe(140 * dpr);
    }
  });
  it("every origin is an integer", () => {
    for (const [W, H, d, z] of [[1366, 768, 1, 2], [1536, 864, 1.25, 2], [412, 915, 2.625, 3]]) {
      const c = O.fitCamera(W, H, d, z, CORE);
      expect(Number.isInteger(c.z)).toBe(true);
      expect(Number.isInteger(c.ox)).toBe(true);
      expect(Number.isInteger(c.oy)).toBe(true);
    }
  });
});

describe("anchorOf / placeFor (D2 2.6, A3)", () => {
  const top = {
    anchors: { front: [50, 0, 250, 170], window: [120, 0, 160, 110], gym: [270, 170, 60, 110] },
    territory: {
      room: [[0, 300], [360, 300], [360, 0], [0, 0]],
      cells: [
        { zone: "window", poly: [[0, 0], [360, 0], [360, 150], [0, 150]] },
        { zone: "gym", poly: [[0, 150], [360, 150], [360, 300], [0, 300]] },
      ],
    },
  };
  it("anchor: a zone place uses its zone, a wall place its wall", () => {
    expect(O.anchorOf(top.anchors, { mode: "zone", view: "front", zone: "window" })).toEqual({ x: 120, y: 0, w: 160, h: 110 });
    expect(O.anchorOf(top.anchors, { mode: "wall", view: "front", zone: null })).toEqual({ x: 50, y: 0, w: 250, h: 170 });
  });
  it("items: nearest centre wins, then the smaller box", () => {
    const items = [
      { of: "a", hit: [10, 10, 20, 20] },
      { of: "b", hit: [25, 10, 20, 20] },
      { of: "c", hit: [0, 0, 60, 60] },
    ];
    expect(O.placeFor(top, items, 18, 20)).toEqual({ item: "a" });
    expect(O.placeFor(top, items, 37, 20)).toEqual({ item: "b" });
    expect(O.placeFor(top, [{ of: "big", hit: [0, 0, 40, 40] }, { of: "small", hit: [10, 10, 20, 20] }], 20, 20)).toEqual({ item: "small" });
  });
  it("floor: the territory cell under the point; outside the room outline: nothing", () => {
    expect(O.placeFor(top, [], 100, 50)).toEqual({ zone: "window" });
    expect(O.placeFor(top, [], 100, 250)).toEqual({ zone: "gym" });
    expect(O.placeFor(top, [], 400, 50)).toBeNull();
  });
});

describe("the exported overview (art/room-r6 manifest + zones, when built)", () => {
  let items: Array<Record<string, unknown>> = [];
  let zones: Record<string, unknown> = {};
  try {
    items = JSON.parse(readFileSync("art/room-r6/manifest.json", "utf8")).items;
    zones = JSON.parse(readFileSync("art/room-r6/zones.json", "utf8"));
  } catch {
    /* not built */
  }
  const top = (zones.views as Record<string, Record<string, unknown>> | undefined)?.top;
  const run = top ? it : it.skip;
  run("every room hotspot has exactly one top twin with the same variant keys", () => {
    const room = items.filter((i) => i.kind === "hotspot" && ["front", "right", "back", "left"].includes(i.view as string) && !i.of);
    const twins = items.filter((i) => i.view === "top" && i.kind === "hotspot");
    expect(twins.length).toBe(room.length);
    for (const r of room) {
      const t = twins.filter((x) => x.of === r.id);
      expect(t.length, String(r.id)).toBe(1);
      expect(Object.keys(t[0].variants as object)).toEqual(expect.arrayContaining(Object.keys(r.variants as object)));
      expect(t[0].target).toBeUndefined();
    }
  });
  run("placeAt on every zone anchor centre lands in that zone or on one of its items", () => {
    const an = top!.anchors as Record<string, number[]>;
    const tw = items.filter((i) => i.view === "top" && i.kind === "hotspot");
    const zoneOfId = Object.fromEntries(items.filter((i) => i.view !== "top").map((i) => [i.id, i.zone]));
    for (const z of (zones.zones as Array<{ id: string }>).map((x) => x.id)) {
      const a = an[z];
      const p = O.placeFor(top, tw, a[0] + a[2] / 2, a[1] + a[3] / 2, 0);
      expect(p, z).not.toBeNull();
      expect(p.zone ?? zoneOfId[p.item], z).toBe(z);
    }
  });
});
