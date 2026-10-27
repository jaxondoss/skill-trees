import { describe, expect, it } from "vitest";
import { canUpgrade, initialLevel, levelProgress, tierOfLevel } from "@/engine/statue";

describe("statue level", () => {
  it("starts at the score's whole part", () => {
    expect(initialLevel(40.2)).toBe(40);
    expect(initialLevel(-3)).toBe(0);
    expect(initialLevel(130)).toBe(100);
  });
  it("shows progress from the level to the next, both ways, clamped", () => {
    expect(levelProgress(40.6, 40)).toBeCloseTo(0.6);
    expect(levelProgress(39.5, 40)).toBe(0); // the score fell back: the bar empties, the level stays
    expect(levelProgress(43, 40)).toBe(1);
  });
  it("upgrades only at 100%, one level at a time", () => {
    expect(canUpgrade(40.99, 40)).toBe(false);
    expect(canUpgrade(41, 40)).toBe(true);
    expect(canUpgrade(100, 100)).toBe(false);
  });
  it("changes armour only at 20, 40, 60 and 80", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(tierOfLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});
