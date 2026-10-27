// Room prototype live weather (docs/redesign/room-prototype/engine/weather.js), pure helpers only.
// The engine file is a classic script that also exports through module.exports, so it can be required here.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const W = require("../../docs/redesign/room-prototype/engine/weather.js");

describe("WMO code mapping", () => {
  const rows: [number | null, string][] = [
    [0, "clear"],
    [1, "clear"],
    [2, "partly"],
    [3, "overcast"],
    [45, "fog"],
    [48, "fog"],
    [51, "drizzle"],
    [53, "drizzle"],
    [55, "drizzle"],
    [56, "drizzle"],
    [57, "drizzle"],
    [61, "rain"],
    [63, "rain"],
    [65, "rain"],
    [66, "rain"],
    [67, "rain"],
    [80, "rain"],
    [81, "rain"],
    [82, "rain"],
    [71, "snow"],
    [73, "snow"],
    [75, "snow"],
    [77, "snow"],
    [85, "snow"],
    [86, "snow"],
    [95, "storm"],
    [96, "storm"],
    [99, "storm"],
  ];
  it.each(rows)("code %s is %s", (code, state) => {
    expect(W.stateForCode(code)).toBe(state);
  });
  it("unknown, missing and junk codes read as clear", () => {
    for (const c of [4, 10, 44, 50, 58, 60, 68, 70, 78, 84, 87, 94, 97, 100, -1, null, undefined, NaN, "x"]) {
      expect(W.stateForCode(c)).toBe("clear");
    }
  });
  it("every state is listed", () => {
    expect(W.STATES).toEqual(["clear", "partly", "overcast", "fog", "drizzle", "rain", "storm", "snow"]);
  });
});

describe("precipitation to drop density", () => {
  it("20 per 100x100 at 0.1 mm/h, 160 at 8 and above", () => {
    expect(W.dropDensity(0.1)).toBeCloseTo(20, 6);
    expect(W.dropDensity(8)).toBeCloseTo(160, 6);
    expect(W.dropDensity(20)).toBeCloseTo(160, 6);
  });
  it("is a log scale between the ends", () => {
    // the geometric midpoint of 0.1 and 8 lands halfway
    expect(W.dropDensity(Math.sqrt(0.1 * 8))).toBeCloseTo(90, 6);
  });
  it("is zero for no rain and monotone", () => {
    expect(W.dropDensity(0)).toBe(0);
    expect(W.dropDensity(-3)).toBe(0);
    expect(W.dropDensity(NaN)).toBe(0);
    let prev = -1;
    for (let mm = 0; mm <= 20; mm += 0.05) {
      const d = W.dropDensity(mm);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
  it("precipitating states always draw something, dry states nothing", () => {
    expect(W.effectivePrecip("rain", 0)).toBeGreaterThan(0);
    expect(W.effectivePrecip("drizzle", 0)).toBeGreaterThan(0);
    expect(W.effectivePrecip("storm", 0)).toBeGreaterThan(W.effectivePrecip("rain", 0));
    expect(W.effectivePrecip("rain", 5)).toBe(5);
    expect(W.effectivePrecip("rain", 50)).toBe(20);
    expect(W.effectivePrecip("clear", 5)).toBe(0);
    expect(W.effectivePrecip("fog", 1)).toBe(0);
  });
});

describe("wind slant", () => {
  it("is mph / 40, clamped to 0..0.5", () => {
    expect(W.windSlant(0, 270, 0)).toBe(0);
    expect(W.windSlant(-10, 270, 0)).toBe(0);
    expect(W.windSlant(10, 270, 0)).toBeCloseTo(0.25, 9);
    expect(W.windSlant(20, 270, 0)).toBeCloseTo(0.5, 9);
    expect(W.windSlant(60, 270, 0)).toBe(0.5);
    expect(W.windSlant(1000, 90, 0)).toBe(-0.5);
  });
  it("never exceeds 0.5 in magnitude for any speed and direction", () => {
    for (let mph = 0; mph <= 80; mph += 3) {
      for (let dir = 0; dir < 360; dir += 15) {
        expect(Math.abs(W.windSlant(mph, dir, 250))).toBeLessThanOrEqual(0.5);
      }
    }
  });
  it("takes its sign from where the wind blows across the window", () => {
    // window looking north: a west wind blows to the right, an east wind to the left
    expect(W.windSlant(20, 270, 0)).toBeGreaterThan(0);
    expect(W.windSlant(20, 90, 0)).toBeLessThan(0);
    // window looking south: mirrored
    expect(W.windSlant(20, 270, 180)).toBeLessThan(0);
    expect(W.windSlant(20, 90, 180)).toBeGreaterThan(0);
  });
});

describe("lightning scheduler (photosensitivity)", () => {
  const HOUR = 3600 * 1000;
  for (const seed of [1, 2, 7, 42, 1234]) {
    it(`seed ${seed}: sequences 8 to 25 s apart over 6 hours`, () => {
      const s = W.flashSequences(seed, 0, 6 * HOUR);
      expect(s.length).toBeGreaterThan(6 * 3600 / 25);
      for (let i = 1; i < s.length; i++) {
        const gap = s[i] - s[i - 1];
        expect(gap).toBeGreaterThanOrEqual(8000);
        expect(gap).toBeLessThanOrEqual(25000);
      }
    });
    it(`seed ${seed}: never 3 flashes within 1 s`, () => {
      const on = W.flashOnsets(seed, 0, 6 * HOUR);
      for (let i = 0; i + 2 < on.length; i++) expect(on[i + 2] - on[i]).toBeGreaterThanOrEqual(1000);
    });
  }
  it("the pattern is full, off, half, then off", () => {
    const F = W.FLASH_FRAME;
    expect(W.patternLevel(0)).toBe(1);
    expect(W.patternLevel(2 * F - 1)).toBe(1);
    expect(W.patternLevel(2 * F)).toBe(0);
    expect(W.patternLevel(3 * F)).toBe(0.5);
    expect(W.patternLevel(4 * F)).toBe(0);
    expect(W.patternLevel(-1)).toBe(0);
  });
  it("flashAt samples the schedule; level 1.8 maximum at the key light", () => {
    const start = W.flashSequences(3, 0, 60000)[0];
    expect(W.flashAt(3, start + 5).level).toBe(1);
    expect(W.flashAt(3, start + 5).level * W.FLASH_GAIN).toBeCloseTo(1.8, 9);
    expect(W.flashAt(3, start - 1000).level).toBe(0);
  });
  it("the guard refuses a sequence within 8 s of the last", () => {
    const g = { last: null, onsets: [] };
    expect(W.guardAllow(g, 10000)).toBe(true);
    expect(W.guardAllow(g, 10000)).toBe(true); // the same sequence, sampled again
    expect(W.guardAllow(g, 17999)).toBe(false);
    expect(W.guardAllow(g, 18000)).toBe(true);
    expect(W.guardAllow(g, 18500)).toBe(false);
  });
  it("the guard resets when the clock moves backwards", () => {
    const g = { last: null, onsets: [] };
    expect(W.guardAllow(g, 50000)).toBe(true);
    expect(W.guardAllow(g, 1000)).toBe(true);
  });
  it("the guard never lets 3 onsets into 1 s, even with a short minimum gap", () => {
    // simulate a hostile caller hammering the guard every 50 ms for a minute
    const g = { last: null, onsets: [] };
    const played: number[] = [];
    for (let t = 0; t < 60000; t += 50) {
      if (W.guardAllow(g, t) && played[played.length - 1] !== t) {
        played.push(t, t + 3 * W.FLASH_FRAME);
      }
    }
    for (let i = 0; i + 2 < played.length; i++) expect(played[i + 2]! - played[i]!).toBeGreaterThanOrEqual(1000);
    for (let i = 2; i < played.length; i += 2) expect(played[i]! - played[i - 2]!).toBeGreaterThanOrEqual(8000);
  });
});

describe("cache and fetch rules", () => {
  const now = Date.UTC(2026, 9, 27, 18, 0, 0);
  const entry = (ageMs: number) => ({ at: now - ageMs, data: { code: 61, precip: 1, cloud: 90, wind: 8, dir: 200 } });
  it("a cache under 3 hours old is used offline", () => {
    expect(W.cacheUsable(entry(0), now)).toBe(true);
    expect(W.cacheUsable(entry(3 * 3600e3 - 1), now)).toBe(true);
    expect(W.pickSource(entry(2 * 3600e3), now, false)).toBe("cache");
  });
  it("an older, missing, broken or future cache falls back to clear", () => {
    expect(W.cacheUsable(entry(3 * 3600e3), now)).toBe(false);
    expect(W.pickSource(entry(5 * 3600e3), now, false)).toBe("clear");
    expect(W.pickSource(null, now, false)).toBe("clear");
    expect(W.pickSource({ at: now }, now, false)).toBe("clear");
    expect(W.pickSource(entry(-60000), now, false)).toBe("clear");
  });
  it("a good fetch always wins", () => {
    expect(W.pickSource(null, now, true)).toBe("live");
    expect(W.pickSource(entry(10 * 3600e3), now, true)).toBe("live");
  });
  it("fetches every 15 minutes, only while visible", () => {
    expect(W.shouldFetch(null, now, true)).toBe(true);
    expect(W.shouldFetch(null, now, false)).toBe(false);
    expect(W.shouldFetch(now - 14 * 60e3, now, true)).toBe(false);
    expect(W.shouldFetch(now - 15 * 60e3, now, true)).toBe(true);
    expect(W.shouldFetch(now - 60 * 60e3, now, false)).toBe(false);
  });
  it("the sill stays wet 20 minutes after rain", () => {
    expect(W.isWet("rain", 0, now)).toBe(true);
    expect(W.isWet("clear", now - 19 * 60e3, now)).toBe(true);
    expect(W.isWet("clear", now - 20 * 60e3, now)).toBe(false);
    expect(W.isWet("snow", 0, now)).toBe(false);
  });
});

describe("API and flags", () => {
  it("asks for New Orleans, never the device location", () => {
    expect(W.API_URL).toContain("latitude=29.95");
    expect(W.API_URL).toContain("longitude=-90.07");
    expect(W.API_URL).toContain("wind_speed_unit=mph");
    expect(W.API_URL).toContain("weather_code");
  });
  it("parses the current block", () => {
    const r = W.parseCurrent({
      current: { weather_code: 63, precipitation: 2.4, rain: 2.6, cloud_cover: 100, wind_speed_10m: 14, wind_direction_10m: 200 },
    });
    expect(r).toEqual({ code: 63, precip: 2.6, cloud: 100, wind: 14, dir: 200 });
    expect(W.parseCurrent({})).toBeNull();
    expect(W.parseCurrent(null)).toBeNull();
  });
  it("reads and clamps the debug flags", () => {
    const q = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
    expect(W.parseFlags(q({ weather: "storm", precip: "50", wind: "-4" }))).toEqual({ weather: "storm", precip: 20, wind: 0 });
    expect(W.parseFlags(q({ weather: "hail", precip: "x" }))).toEqual({});
  });
});
