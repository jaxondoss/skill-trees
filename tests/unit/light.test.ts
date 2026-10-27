// Room prototype light drivers (docs/redesign/room-prototype/engine/light.js): pure functions only.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const L = require("../../docs/redesign/room-prototype/engine/light.js");

const NAMES: string[] = L.KEYFRAME_NAMES;
const at = (iso: string) => new Date(iso);

describe("sunPosition (New Orleans)", () => {
  it("is above the horizon at local noon and below at local midnight", () => {
    // 2026-06-21 and 2026-12-21, 12:00 and 00:00 CDT/CST
    expect(L.sunPosition(at("2026-06-21T17:00:00Z")).elevation).toBeGreaterThan(60);
    expect(L.sunPosition(at("2026-12-21T18:00:00Z")).elevation).toBeGreaterThan(30);
    expect(L.sunPosition(at("2026-06-21T05:00:00Z")).elevation).toBeLessThan(-30);
    expect(L.sunPosition(at("2026-12-21T06:00:00Z")).elevation).toBeLessThan(-30);
  });
  it("rises in the east and sets in the west", () => {
    const morning = L.sunPosition(at("2026-10-27T13:00:00Z")); // 08:00 CDT
    const evening = L.sunPosition(at("2026-10-27T22:30:00Z")); // 17:30 CDT
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(135);
    expect(evening.azimuth).toBeGreaterThan(225);
    expect(evening.azimuth).toBeLessThan(270);
  });
  it("puts sunset near 18:15 local in late October", () => {
    const before = L.sunPosition(at("2026-10-27T23:00:00Z")).elevation; // 18:00 CDT
    const after = L.sunPosition(at("2026-10-27T23:30:00Z")).elevation; // 18:30 CDT
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(0);
  });
  it("maps ?t= to New Orleans wall time across DST", () => {
    const summer = L.atLocalTime(Date.UTC(2026, 6, 1, 12), 12, 0);
    const winter = L.atLocalTime(Date.UTC(2026, 0, 15, 12), 12, 0);
    expect(new Date(summer).toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(new Date(winter).toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });
});

describe("keyframe blending", () => {
  const sum = (w: Record<string, number>) => NAMES.reduce((a, n) => a + (w[n] ?? 0), 0);

  it("weights are a partition of unity at every elevation", () => {
    for (const rising of [false, true]) {
      for (let el = -30; el <= 70; el += 0.05) expect(sum(L.keyframeWeights(el, rising))).toBeCloseTo(1, 9);
    }
  });
  it("has no jumps: every weight and every blended value is continuous in elevation", () => {
    const step = 0.01;
    for (const rising of [false, true]) {
      let prev = L.blendKeyframes(L.keyframeWeights(-30, rising));
      let prevW = L.keyframeWeights(-30, rising);
      for (let el = -30 + step; el <= 70; el += step) {
        const w = L.keyframeWeights(el, rising);
        for (const n of NAMES) expect(Math.abs(w[n] - prevW[n])).toBeLessThan(0.03);
        const b = L.blendKeyframes(w);
        expect(Math.abs(b.keyI - prev.keyI)).toBeLessThan(0.02);
        expect(Math.abs(b.exposure - prev.exposure)).toBeLessThan(0.01);
        for (let c = 0; c < 3; c++) expect(Math.abs(b.keyColor[c] - prev.keyColor[c])).toBeLessThan(0.02);
        prev = b;
        prevW = w;
      }
    }
  });
  it("blends over 1 degree around each boundary", () => {
    expect(L.keyframeWeights(6.6, false).golden).toBe(1);
    expect(L.keyframeWeights(5.4, false).sunset).toBe(1);
    const mid = L.keyframeWeights(6, false);
    expect(mid.golden).toBeCloseTo(0.5, 6);
    expect(mid.sunset).toBeCloseTo(0.5, 6);
  });
  it("picks the spec bands (evening and morning)", () => {
    const top = (el: number, r: boolean) => {
      const w = L.keyframeWeights(el, r);
      return NAMES.reduce((a, n) => (w[n] > w[a] ? n : a), "night");
    };
    expect(top(-12, false)).toBe("night");
    expect(top(-3, false)).toBe("blue");
    expect(top(2, false)).toBe("sunset");
    expect(top(12, false)).toBe("golden");
    expect(top(40, false)).toBe("day");
    expect(top(0, true)).toBe("dawn");
  });
  it("state() over a whole faked day has no pops", () => {
    let prev = L.state(L.atLocalTime(Date.UTC(2026, 9, 27, 12), 0, 0), { p: 60 });
    for (let m = 1; m < 24 * 60; m++) {
      const s = L.state(L.atLocalTime(Date.UTC(2026, 9, 27, 12), Math.floor(m / 60), m % 60), { p: 60 });
      // A keyframe change takes about 5 real minutes (1 degree of elevation): at most ~10% a minute, never a pop.
      expect(Math.abs(s.keyIntensity - prev.keyIntensity)).toBeLessThan(0.15);
      expect(Math.abs(s.exposure - prev.exposure)).toBeLessThan(0.08); // 1 degree blend = a few real minutes
      expect(Math.abs(s.ambientIntensity - prev.ambientIntensity)).toBeLessThan(0.08);
      prev = s;
    }
  });
});

describe("completion w", () => {
  it("is smoothstep(0, 0.85, p/100), clamped", () => {
    expect(L.completionW(0)).toBe(0);
    expect(L.completionW(85)).toBe(1);
    expect(L.completionW(100)).toBe(1);
    expect(L.completionW(-5)).toBe(0);
    expect(L.completionW(42.5)).toBeCloseTo(0.5, 9);
    for (let p = 1; p <= 100; p++) expect(L.completionW(p)).toBeGreaterThanOrEqual(L.completionW(p - 1));
  });
  it("drives the widened ranges (owner decision)", () => {
    const lo = L.state(at("2026-10-27T22:30:00Z"), { p: 0 });
    const hi = L.state(at("2026-10-27T22:30:00Z"), { p: 100 });
    expect(hi.keyIntensity / lo.keyIntensity).toBeCloseTo(1.3 / 0.6, 6);
    expect(lo.saturation).toBeCloseTo(0.78, 6);
    expect(hi.saturation).toBeCloseTo(1.12, 6);
    expect(lo.neon).toBeCloseTo(0.35, 6);
    expect(hi.neon).toBe(1);
  });
});

describe("flags and helpers", () => {
  it("parses the debug flags; numeric ?tier= stays the room tier", () => {
    const f = L.parseFlags("?t=19:30&el=8&p=40&light=depth&tier=low");
    expect(f).toMatchObject({ t: { h: 19, m: 30 }, el: 8, p: 40, light: "depth", tier: "low" });
    expect(L.parseFlags("?tier=3").tier).toBeUndefined();
    expect(L.parseFlags("?t=25:00&light=nope")).toEqual({});
  });
  it("depthOf and yBaseOf round-trip within 2 px", () => {
    for (let y = -116; y <= 364; y += 7) expect(Math.abs(L.yBaseOf(L.depthOf(y, -116, 364), -116, 364) - y)).toBeLessThan(2);
    expect(L.depthOf(-500, -116, 364)).toBe(1);
    expect(L.depthOf(900, -116, 364)).toBe(254);
  });
  it("window facing: direct in the evening, diffuse in the morning", () => {
    expect(L.windowDirect(245, 10, 250)).toBe(1);
    expect(L.windowDirect(110, 10, 250)).toBe(0);
    expect(L.windowDirect(245, -5, 250)).toBe(0);
  });
  it("gradeLut is n^3 RGBA8", () => {
    const lut = L.gradeLut(L.KEYFRAMES.golden.grade, 8);
    expect(lut.length).toBe(8 * 8 * 8 * 4);
    expect(lut[3]).toBe(255);
  });
  it("lightingFromV33 bootstraps a capped block with defaults per view", () => {
    const back = L.lightingFromV33({ core: { w: 556, h: 235 } }, "back", []);
    expect(back.key.scale).toBe(0);
    expect(back.lights.filter((l: { role: string }) => l.role === "pendant")).toHaveLength(4);
    const left = L.lightingFromV33({ core: { w: 556, h: 235 } }, "left", []);
    expect(left.lights.some((l: { id: string }) => l.id === "kitchen-undercab")).toBe(true);
  });
});
