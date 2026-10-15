import { describe, expect, it } from "vitest";
import { cellStyle, computeStreak, dailyCompletion, dayColor, NEUTRAL_CELL, winningWeeks } from "./completion";
import { addDays } from "./time";
import type { GoalKind, Tier } from "./types";

const TODAY = "2026-10-15";
const g = (result: Tier | null, kind: GoalKind = "rack") => ({ kind, result });

describe("daily completion P", () => {
  it("scores Stretch 1.2, Standard 1.0, Floor 0.5, missed 0", () => {
    expect(dailyCompletion([g("standard"), g("standard"), g("standard")]).p).toBe(100);
    expect(dailyCompletion([g("floor"), g("standard"), g(null), g("standard")]).p).toBeCloseTo(62.5);
    expect(dailyCompletion([g("stretch"), g("standard"), g("floor"), g(null)]).p).toBeCloseTo(67.5);
  });

  it("counts the stretch goal in the numerator only", () => {
    const day = [g("standard"), g("standard"), g(null), g(null), g("stretch", "stretch")];
    expect(dailyCompletion(day)).toEqual({ p: expect.closeTo(80), nCore: 4 });
    expect(dailyCompletion(day.slice(0, 4)).p).toBe(50);
  });

  it("caps at 100", () => {
    expect(dailyCompletion([g("stretch"), g("stretch"), g("stretch", "stretch")]).p).toBe(100);
  });

  it("gives an all-Floor sick day 50%", () => {
    expect(dailyCompletion([g("floor"), g("floor"), g("floor")]).p).toBe(50);
  });

  it("returns null for a day with no core goals", () => {
    expect(dailyCompletion([])).toEqual({ p: null, nCore: 0 });
    expect(dailyCompletion([g("stretch", "stretch")]).p).toBeNull();
  });
});

describe("streak", () => {
  const seq = (start: string, ps: (number | null)[]) => ps.map((p, i) => ({ day: addDays(start, i), p }));

  it("counts consecutive days at 85% or more", () => {
    const days = seq(addDays(TODAY, -5), [90, 85, 100, 88, 95]);
    expect(computeStreak(days, TODAY)).toMatchObject({ current: 5, best: 5, todayCounted: false, lastBreak: null });
  });

  it("breaks below 85 and remembers the break for the crack animation", () => {
    const days = seq(addDays(TODAY, -7), [90, 90, 90, 90, 90, 84.9, 90]);
    expect(computeStreak(days, TODAY)).toMatchObject({
      current: 1,
      best: 5,
      lastBreak: { on: addDays(TODAY, -2), length: 5 },
    });
  });

  it("breaks on an all-Floor sick day (50%)", () => {
    expect(computeStreak(seq(addDays(TODAY, -3), [90, 90, 50]), TODAY).current).toBe(0);
  });

  it("does not break on an open today below 85, and counts today once it reaches 85", () => {
    const past = seq(addDays(TODAY, -3), [90, 90, 90]);
    expect(computeStreak([...past, { day: TODAY, p: 40 }], TODAY)).toMatchObject({ current: 3, todayCounted: false });
    expect(computeStreak([...past, { day: TODAY, p: 85 }], TODAY)).toMatchObject({ current: 4, best: 4, todayCounted: true });
  });

  it("treats a day with no plan after the first plan as a break", () => {
    const days = [...seq(addDays(TODAY, -5), [90, 90]), ...seq(addDays(TODAY, -2), [90, 90])];
    expect(computeStreak(days, TODAY)).toMatchObject({ current: 2, best: 2 });
  });

  it("ignores days before the first plan, and returns zero with no history", () => {
    expect(computeStreak(seq(addDays(TODAY, -2), [null, 90]), TODAY).current).toBe(1);
    expect(computeStreak([], TODAY)).toEqual({ current: 0, best: 0, todayCounted: false, lastBreak: null });
  });
});

describe("winning weeks", () => {
  it("counts weeks with 5 or more days at 85%", () => {
    const mon = "2026-10-05";
    const days = [90, 90, 90, 90, 90, 10, 10, 90, 90, 90, 90, 10, 10, 10].map((p, i) => ({ day: addDays(mon, i), p }));
    expect(winningWeeks(days)).toEqual([
      { weekStart: "2026-10-05", keptDays: 5, winning: true },
      { weekStart: "2026-10-12", keptDays: 4, winning: false },
    ]);
  });
});

describe("calendar colors", () => {
  it("hits the spec anchors at 0, 50, and 100 and clamps outside", () => {
    expect(dayColor(0)).toBe("#7a1018");
    expect(dayColor(50)).toBe("#8a6a12");
    expect(dayColor(100)).toBe("#0e6b35");
    expect(dayColor(-20)).toBe("#7a1018");
    expect(dayColor(140)).toBe("#0e6b35");
  });

  it("interpolates in OKLCH, so midpoints differ from plain RGB mixing", () => {
    // RGB halfway between red and amber anchors would be #823d15.
    expect(dayColor(25)).not.toBe("#823d15");
    expect(dayColor(25)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("styles cells: neutral for future and unplanned days, gold outline at 85%+", () => {
    expect(cellStyle({ day: addDays(TODAY, 1), p: 90 }, TODAY)).toEqual({ fill: NEUTRAL_CELL, goldOutline: false, isToday: false });
    expect(cellStyle({ day: addDays(TODAY, -1), p: null }, TODAY).fill).toBe(NEUTRAL_CELL);
    expect(cellStyle({ day: addDays(TODAY, -1), p: 85 }, TODAY).goldOutline).toBe(true);
    expect(cellStyle({ day: addDays(TODAY, -1), p: 84 }, TODAY).goldOutline).toBe(false);
    expect(cellStyle({ day: TODAY, p: 40 }, TODAY)).toMatchObject({ isToday: true, fill: dayColor(40) });
  });
});
