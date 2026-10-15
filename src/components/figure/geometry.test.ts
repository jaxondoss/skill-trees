import { describe, expect, it } from "vitest";
import { BODY, mirror, regionVeins, VEIN_SHARE, visibleVeins, type Region } from "./geometry";

const REGIONS: Region[] = ["head", "left_arm", "right_arm", "left_leg_core", "right_leg_chest"];

describe("figure geometry", () => {
  it("mirrors absolute coordinates across the center line", () => {
    expect(mirror("M39.6 43.2 C38 44.2 37.2 46.5 37 49.5 Z")).toBe("M60.4 43.2 C62 44.2 62.8 46.5 63 49.5 Z");
    expect(BODY.rightArm).toBe(mirror(BODY.leftArm));
  });

  it("generates the same veins every time (server and client markup match)", () => {
    for (const r of REGIONS) expect(regionVeins(r)).toEqual(regionVeins(r));
  });

  it("gives every region veins, widest (trunks) first", () => {
    for (const r of REGIONS) {
      const v = regionVeins(r);
      expect(v.length).toBeGreaterThan(3);
      expect(v[0]!.width).toBeGreaterThanOrEqual(v.at(-1)!.width);
      expect(v.every((x) => /^M[\d. L-]+$/.test(x.d))).toBe(true);
    }
  });

  it("shows more veins at each higher tier, all of them at Sovereign", () => {
    for (const r of REGIONS) {
      const counts = [1, 2, 3, 4, 5].map((t) => visibleVeins(r, t).length);
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
      expect(counts[4]).toBe(regionVeins(r).length);
      expect(counts[0]).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(VEIN_SHARE)).toHaveLength(5);
  });
});
