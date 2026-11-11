// The skill hologram's data shaping (docs/redesign/room-prototype/engine/holo.js, pure helpers through module.exports)
// and the Lyfta summary behind the strength hologram (src/lib/data/lyftaSummary.ts).
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { muscleSplit, summarizeLyfta, type RawWorkout } from "@/lib/data/lyftaSummary";

const require = createRequire(import.meta.url);
const H = require("../../docs/redesign/room-prototype/engine/holo.js");

const skill = {
  slug: "reading",
  streak: 2,
  // 27 days before today, then today (overridden by today's goal)
  log28: [...Array(20).fill(0), 2, 0, 1, 0, 3, 2, 0, 0],
  goals: [{ floor: "10 pages", standard: "30 min", stretch: "60 min", minutes: { floor: 15, standard: 30, stretch: 65 } }],
};
// 2026-10-20 is a Tuesday
const data = { today: "2026-10-20", goals: [{ id: "reading-rack", skill: "reading", tier: "standard", result: "floor" }] };

describe("hologram data shaping", () => {
  it("log28: 28 ranks, today from today's goal; null without history", () => {
    const l = H.log28Of(skill, data);
    expect(l).toHaveLength(28);
    expect(l[27]).toBe(1);
    expect(l[26]).toBe(0);
    expect(H.log28Of({ slug: "x" }, data)).toBeNull();
  });
  it("weekOf: Monday-first week with minutes from the logged tier, last week beside it", () => {
    const w = H.weekOf(skill, data);
    expect(w.week.map((d: { dow: string }) => d.dow)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
    expect(w.week[0]).toMatchObject({ date: "2026-10-19", rank: 0, today: false });
    expect(w.week[1]).toMatchObject({ date: "2026-10-20", rank: 1, min: 15, today: true });
    expect(w.week[2].future).toBe(true);
    expect(w.min).toBe(15);
    expect(w.days).toBe(1);
    expect(w.elapsed).toBe(2);
    // last week Mon..Sun = log indices 19..25 (today, a Tuesday, is 27)
    expect(w.prev.map((d: { rank: number }) => d.rank)).toEqual([0, 2, 0, 1, 0, 3, 2]);
    expect(w.prevMin).toBe(30 + 15 + 65 + 30);
    expect(H.weekOf({ slug: "x" }, data).has).toBe(false);
  });
  it("heatOf counts logged days; muscleLevels quarters the top muscle; zero stays dim", () => {
    expect(H.heatOf(skill, data)).toMatchObject({ days: 5, streak: 2 });
    const m = H.muscleLevels({ triceps: 3541, abs: 3360, chest: 2157, shoulders: 1042, quads: 0 });
    expect(m.max).toBe(3541);
    expect(m.levels).toMatchObject({ triceps: 4, abs: 4, chest: 3, shoulders: 2, quads: 0, calves: 0 });
  });
  it("actionsOf: the goal's tiers, checked up to the logged one; a click logs or steps down", () => {
    const a = H.actionsOf(skill, data);
    expect(a.rows.map((r: { tier: string; checked: boolean; min: number }) => [r.tier, r.checked, r.min])).toEqual([
      ["floor", true, 15],
      ["standard", false, 30],
      ["stretch", false, 65],
    ]);
    expect(H.tierAfterClick(a.rows, "stretch")).toBe("stretch");
    expect(H.tierAfterClick(a.rows, "floor")).toBeNull();
    expect(H.actionsOf(skill, { today: "2026-10-20", goals: [] }).rows).toEqual([]);
  });
});

describe("Lyfta summary (the approved gym mockup's mapping)", () => {
  const set = (weight: string, reps: string) => ({ weight, reps });
  const workouts: RawWorkout[] = [
    {
      title: "Push",
      // 2026-11-10 03:00 UTC = Monday 9 Nov 19:00 in Los Angeles
      workout_perform_date: "2026-11-10 03:00:00",
      workout_duration: "0:57:00",
      total_volume: "1200",
      body_weight: "180",
      weight_unit: "lb",
      exercises: [
        { excercise_name: "Bench Press", exercise_type: "weight_reps", exercise_image: "x_Chest_small.png", sets: [set("100", "10")] },
        { excercise_name: "Dips", exercise_type: "full_bodyweight", exercise_image: "x_Upper-Arms_small.png", sets: [set("0", "1")] },
      ],
    },
    { title: "Legs", workout_perform_date: "2026-11-03 18:00:00", workout_duration: "1:04:00", total_volume: "500", body_weight: "180", exercises: [{ excercise_name: "Squat", exercise_type: "weight_reps", exercise_image: "x_Thighs_small.png", sets: [set("100", "5")] }] },
  ];
  it("days in America/Los_Angeles, Monday weeks, muscles over 7 days, lifts against the assumed plan", () => {
    const s = summarizeLyfta(workouts, { today: "2026-11-11" });
    expect(s.weekStart).toBe("2026-11-09");
    expect(s.week[0]).toMatchObject({ date: "2026-11-09", workouts: 1, minutes: 57, volume: 1200 });
    expect(s.week[3]!.future).toBe(true);
    expect(s.prevWeek[1]).toMatchObject({ date: "2026-11-03", workouts: 1, minutes: 64 });
    expect(s.schedule).toMatchObject({ plannedPerWeek: 4, assumed: true, doneThisWeek: 1, score: 0.25 });
    // bench 1000 lb: 75 % chest, 15 % shoulders, 10 % triceps; dips (180 + 0) x 1: 70 % triceps, 20 % chest
    expect(s.muscles7d.volume).toMatchObject({ chest: 786, shoulders: 168, triceps: 226, quads: 0 });
    expect(s.muscles28d.volume.quads).toBe(275);
    expect(s.timezone).toMatch(/America\/Los_Angeles \(assumed/);
  });
  it("muscle split by body part and name", () => {
    expect(muscleSplit({ excercise_name: "Hammer Curl", exercise_image: "a_Upper-Arms_small.png" })).toEqual({ forearms: 0.5, biceps: 0.5 });
    expect(muscleSplit({ excercise_name: "Lat Pulldown", exercise_image: "a_Back_small.png" })).toEqual({ upperBack: 0.85, biceps: 0.15 });
    expect(muscleSplit({ excercise_name: "Run", exercise_image: "a_Cardio_small.png" })).toEqual({});
  });
});
