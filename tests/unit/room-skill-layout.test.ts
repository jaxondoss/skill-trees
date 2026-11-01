// Room v3.5 skill view layout (docs/redesign/room-prototype/engine/skill.js, D1-FINAL 3.1): a pure function that
// places the floating hero left of the board (laptop) or above the 58svh sheet (phone) at an integer zoom.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const S = require("../../docs/redesign/room-prototype/engine/skill.js");
const C = require("../../docs/redesign/room-prototype/engine/camera.js");
const ZONES = require("../../art/room/common/zones.json");

type L = { x: number; y: number; k: number; box: { x: number; y: number; w: number; h: number }; phone: boolean };
const layout: (o: Record<string, unknown>) => L = S.layout;

// [name, vw, vh, dpr, zRoom, zZone] (zooms as camera.js gives them for the front wall and the library zone)
const VIEWPORTS: [string, number, number, number][] = [
  ["1280x800", 1280, 800, 1],
  ["1440x900", 1440, 900, 1],
  ["1920x1080", 1920, 1080, 1],
  ["1366x768", 1366, 768, 1],
  ["390x844@3", 390, 844, 3],
  ["360x740@3", 360, 740, 3],
];
const zones = ZONES.zones as { id: string; focus: number[] }[];
const library = (zones.find((z) => z.id === "library") ?? zones[0])!;
function zoomsFor(w: number, h: number, dpr: number) {
  C.configure(ZONES.views ? ZONES.views.front : ZONES);
  const v = C.viewFor(Math.round(w * dpr), Math.round(h * dpr), dpr);
  return { zRoom: C.roomCamera(v, null).z as number, zZone: C.zoneCamera(v, library.focus).z as number };
}

// hero sprite sizes (art px): the authored reading stack, the statue, the rack, the bed clock isolate, a tiny note
const HEROES: [string, number, number][] = [
  ["reading", 54, 47],
  ["statue", 98, 183],
  ["strength", 136, 167],
  ["bed", 12, 9],
  ["focus", 6, 5],
];

describe("skill view layout: every breakpoint and hero", () => {
  for (const [vn, vw, vh, dpr] of VIEWPORTS) {
    for (const [hn, hw, hh] of HEROES) {
      it(`${vn} ${hn}`, () => {
        const z = zoomsFor(vw, vh, dpr);
        const L = layout({ vw, vh, dpr, heroW: hw, heroH: hh, ...z });
        expect(Number.isInteger(L.k)).toBe(true);
        expect(L.k).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(L.x) && Number.isInteger(L.y)).toBe(true);
        expect(L.x % L.k).toBe(0);
        expect(L.y % L.k).toBe(0);
        // inside the clear box (device px)
        expect(L.x).toBeGreaterThanOrEqual(L.box.x);
        expect(L.y).toBeGreaterThanOrEqual(L.box.y);
        expect(L.x + hw * L.k).toBeLessThanOrEqual(L.box.x + L.box.w);
        expect(L.y + hh * L.k).toBeLessThanOrEqual(L.box.y + L.box.h);
        if (!L.phone) {
          // AC8: hero right <= board left - 12 (board = vw - 432 css)
          expect((L.x + hw * L.k) / dpr).toBeLessThanOrEqual(vw - 432 - 12);
        } else {
          // AC8 phone: hero bottom <= sheet top - 8 (sheet at 58svh)
          expect((L.y + hh * L.k) / dpr).toBeLessThanOrEqual(vh * 0.42 - 8);
          expect(L.y / dpr).toBeGreaterThanOrEqual(92);
        }
        // never smaller than the room it came from when it fits (min(zRoom + 1, fit))
        if (hw * (z.zRoom + 1) <= L.box.w * 0.92 && (hh + 10) * (z.zRoom + 1) <= L.box.h * 0.92) {
          expect(L.k).toBeGreaterThanOrEqual(z.zRoom + 1);
        }
      });
    }
  }
});

describe("D1 examples (reading stack 54x47, statue)", () => {
  const k = (vw: number, vh: number, dpr: number, hw = 54, hh = 47) =>
    layout({ vw, vh, dpr, heroW: hw, heroH: hh, ...zoomsFor(vw, vh, dpr) }).k;
  it("1280 k 6 (324x282 css)", () => expect(k(1280, 800, 1)).toBe(6));
  it("1440 k 6", () => expect(k(1440, 900, 1)).toBe(6));
  it("1920 k 9", () => expect(k(1920, 1080, 1)).toBe(9));
  it("statue at 1280 k 3", () => expect(k(1280, 800, 1, 98, 183)).toBe(3));
  it("phone: the stack is at least 9 device px per art px and 64 css tall", () => {
    const kk = k(390, 844, 3);
    expect(kk).toBeGreaterThanOrEqual(9);
    expect((47 * kk) / 3).toBeGreaterThanOrEqual(64);
  });
});

describe("formula pieces", () => {
  it("laptop box: x 56..board-12, y 62..vh-52 (device px)", () => {
    const L = layout({ vw: 1280, vh: 800, dpr: 2, heroW: 20, heroH: 20, zRoom: 4, zZone: 8 });
    expect(L.box).toEqual({ x: 112, y: 124, w: (1280 - 432 - 12 - 56) * 2, h: (800 - 52 - 62) * 2 });
  });
  it("an explicit board rect moves the box edge", () => {
    const L = layout({ vw: 1280, vh: 800, dpr: 1, board: { x: 700 }, heroW: 20, heroH: 20, zRoom: 2, zZone: 4 });
    expect(L.box.x + L.box.w).toBe(688);
  });
  it("phone band: y 92..sheetTop-8", () => {
    const L = layout({ vw: 390, vh: 844, dpr: 3, sheetTop: 400, heroW: 20, heroH: 20, zRoom: 7, zZone: 11 });
    expect(L.phone).toBe(true);
    expect(L.box.y).toBe(276);
    expect(L.box.y + L.box.h).toBe(1176);
  });
  it("caps: k <= 3 zRoom and <= 2 zZone unless the room zoom + 1 rule lifts it", () => {
    const L = layout({ vw: 1920, vh: 1080, dpr: 1, heroW: 6, heroH: 5, zRoom: 2, zZone: 3 });
    expect(L.k).toBe(Math.min(6, 6));
  });
});

describe("timeline helpers", () => {
  it("kAt walks every integer, monotonic, ends exactly", () => {
    const seq = Array.from({ length: 11 }, (_, i) => S.kAt(2, 6, i / 10));
    expect(seq[0]).toBe(2);
    expect(seq[10]).toBe(6);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    expect(new Set(seq)).toEqual(new Set([2, 3, 4, 5, 6]));
    expect(S.kAt(6, 2, 0.999)).toBe(2);
    expect(S.kAt(4, 4, 0.5)).toBe(4);
  });
  it("stepK quantises to Bayer steps", () => {
    expect(S.stepK(0.3, 4)).toBe(0.25);
    expect(S.stepK(1, 3)).toBe(1);
    expect(S.stepK(-1, 3)).toBe(0);
  });
});
