import { describe, expect, it } from "vitest";
import { addDays } from "./time";
import {
  adherenceDerived,
  calorieTarget,
  foodDerived,
  formatAfterNoon,
  minutesAfterNoon,
  nights,
  ratingDerived,
  sleepAnchor,
  sleepDerived,
} from "./trackers";

const TODAY = "2026-10-15";
const CHI = "America/Chicago";

describe("sleep", () => {
  it("orders bedtimes across midnight", () => {
    expect(minutesAfterNoon("23:30")).toBe(690);
    expect(minutesAfterNoon("01:15")).toBe(795);
    expect(minutesAfterNoon("12:00")).toBe(0);
    expect(formatAfterNoon(minutesAfterNoon("00:45"))).toBe("12:45 AM");
    expect(formatAfterNoon(minutesAfterNoon("02:00"))).toBe("2:00 AM");
  });

  it("moves the anchor 15 minutes earlier per week, stopping at 12:45 AM", () => {
    const start = "2026-10-15";
    expect(formatAfterNoon(sleepAnchor(start, start))).toBe("2:00 AM");
    expect(formatAfterNoon(sleepAnchor(addDays(start, 6), start))).toBe("2:00 AM");
    expect(formatAfterNoon(sleepAnchor(addDays(start, 7), start))).toBe("1:45 AM");
    expect(formatAfterNoon(sleepAnchor(addDays(start, 35), start))).toBe("12:45 AM");
    expect(formatAfterNoon(sleepAnchor(addDays(start, 70), start))).toBe("12:45 AM");
  });

  it("marks nights in window within 45 minutes of the anchor, and measures hours", () => {
    // Anchor 2:00 AM CDT. 1:30 AM is in window, 3:00 AM is not.
    const list = nights(
      [
        { day: "2026-10-14", sleptAt: "2026-10-15T06:30:00Z", wokeAt: "2026-10-15T14:30:00Z" },
        { day: "2026-10-15", sleptAt: "2026-10-16T08:00:00Z", wokeAt: null },
      ],
      CHI,
      "2026-10-14",
    );
    expect(list[0]).toMatchObject({ day: "2026-10-14", hours: 8, inWindow: true });
    expect(list[1]).toMatchObject({ hours: null, inWindow: false });
  });

  it("derives logged days, in-window streak, and averages once there is enough data", () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ day: addDays(TODAY, -i), hours: 7 + (i % 2), bedtime: 840, anchor: 840, inWindow: i !== 5 }));
    const v = sleepDerived(list, TODAY);
    expect(v.sleep_logged_days).toBe(12);
    expect(v.sleep_in_window_streak).toBe(6);
    expect(v.sleep_avg_hours_14d).toBeCloseTo(7.5);
    expect(v.sleep_in_window_30d_pct).toBeUndefined();
  });
});

describe("food", () => {
  const meals = (day: string, cal: number, protein: number, fiber: number) => [
    { key: "meal_calories", value: cal / 2, day },
    { key: "meal_calories", value: cal / 2, day },
    { key: "meal_protein_g", value: protein, day },
    { key: "meal_fiber_g", value: fiber, day },
  ];
  const targets = { calories: 3500, proteinG: 200, calorieTolerancePct: 10 };

  it("sums meals per day and checks them against targets", () => {
    const entries = [
      ...meals(TODAY, 3400, 210, 39),
      ...meals(addDays(TODAY, -1), 3600, 205, 38),
      ...meals(addDays(TODAY, -2), 2900, 150, 20),
      ...meals(addDays(TODAY, -3), 3500, 200, 31),
    ];
    expect(foodDerived(entries, TODAY, targets)).toEqual({
      protein_target_days_7d: 3,
      calorie_target_streak: 2,
      fiber_30g_days_7d: 3,
      fiber_38g_streak: 2,
    });
  });

  it("adds the run burn on long-run days", () => {
    expect(calorieTarget(3500, 10)).toBe(4500);
    expect(calorieTarget(3500, null)).toBe(3500);
  });
});

describe("gut rating and adherence", () => {
  it("counts rating days and measures the gain over the first month", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ key: "gut_rating", value: i < 30 ? 2 : 3.5, day: addDays(TODAY, i - 59) }));
    expect(ratingDerived(entries)).toEqual({ gut_ratings_logged: 60, gut_rating_gain: 1.5 });
    expect(ratingDerived(entries.slice(0, 10))).toEqual({ gut_ratings_logged: 10 });
  });

  it("finds adherence streaks at each threshold", () => {
    const values = [100, 75, 75, 100, 50, 100, 100];
    const entries = values.map((v, i) => ({ key: "block_adherence_pct", value: v, day: addDays(TODAY, i - 6) }));
    expect(adherenceDerived(entries)).toEqual({ adherence_70_streak_days: 4, adherence_80_streak_days: 2, adherence_85_streak_days: 2 });
  });
});
