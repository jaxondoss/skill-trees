import { describe, expect, it } from "vitest";
import { rec } from "./fixtures";
import { applyDifficulty, calibrationDrift, isFirstSunday, isSunday, monthStart, mostMissed, movers, previousMonthEnd, weekCompletion } from "./review";

describe("difficulty decisions", () => {
  it("moves one step and stops at the ends", () => {
    expect(applyDifficulty("standard", "level_up")).toBe("stretch");
    expect(applyDifficulty("stretch", "level_up")).toBe("stretch");
    expect(applyDifficulty("standard", "ease")).toBe("floor");
    expect(applyDifficulty("floor", "ease")).toBe("floor");
  });
});

describe("review days", () => {
  it("knows Sundays and the first Sunday of a month", () => {
    expect(isSunday("2026-10-18")).toBe(true);
    expect(isSunday("2026-10-15")).toBe(false);
    expect(isFirstSunday("2026-10-04")).toBe(true);
    expect(isFirstSunday("2026-10-11")).toBe(false);
    expect(monthStart("2026-10-15")).toBe("2026-10-01");
    expect(previousMonthEnd("2026-03-04")).toBe("2026-02-28");
  });
});

describe("week summary", () => {
  it("averages planned days only and counts days at 85%", () => {
    expect(weekCompletion([{ day: "a", p: 100 }, { day: "b", p: 85 }, { day: "c", p: 40 }, { day: "d", p: null }])).toEqual({ avg: 75, kept: 2, planned: 3 });
    expect(weekCompletion([]).avg).toBeNull();
  });

  it("picks the biggest riser and slipper, ignoring new skills and flat ones", () => {
    const now = new Map([["a", 40], ["b", 30], ["c", 50], ["new", 10]]);
    const before = new Map([["a", 35], ["b", 33], ["c", 50]]);
    expect(movers(now, before)).toEqual({ riser: { id: "a", delta: 5 }, slipper: { id: "b", delta: -3 } });
    expect(movers(new Map([["a", 5]]), new Map([["a", 5]]))).toEqual({ riser: null, slipper: null });
  });

  it("counts missed core goals before today", () => {
    const history = [
      rec("run", "2026-10-12", null),
      rec("run", "2026-10-13", "floor"),
      rec("run", "2026-10-14", null),
      rec("chess", "2026-10-12", null),
      rec("chess", "2026-10-15", null),
      rec("lift", "2026-10-12", "standard"),
    ];
    expect(mostMissed(history, "2026-10-12", "2026-10-15")).toEqual([
      { skillId: "run", missed: 2, scheduled: 3 },
      { skillId: "chess", missed: 1, scheduled: 1 },
    ]);
  });
});

describe("calibration", () => {
  it("flags skills that felt too high or too low in consecutive months", () => {
    const drift = calibrationDrift([{ a: "too_high", b: "right" }, { a: "too_high", b: "too_low", c: "too_low" }, { a: "too_high", b: "right", c: "too_low" }]);
    expect([...drift]).toEqual([["a", "too_high"], ["c", "too_low"]]);
    expect(calibrationDrift([{ a: "too_high" }]).size).toBe(0);
  });
});
