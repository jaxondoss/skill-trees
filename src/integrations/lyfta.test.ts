import { describe, expect, it } from "vitest";
import { LYFTA_BASE, liftKey, lyftaAdapter, parseWorkouts, workoutDay } from "./lyfta";

const page = (workouts: unknown[], total_pages = 1, current_page = 1) => ({ status: true, count: workouts.length, total_pages, current_page, limit: 100, workouts });
const workout = (date: string, exercises: unknown[], body_weight: string | null = null) => ({
  id: date,
  title: "Push",
  body_weight,
  workout_perform_date: date,
  total_volume: 0,
  exercises,
});
const ex = (name: string, sets: [string, string, boolean?][]) => ({
  exercise_id: 1,
  excercise_name: name,
  exercise_type: "weight_reps",
  sets: sets.map(([weight, reps, done]) => ({ id: 1, weight, reps, rir: null, is_completed: done ?? true })),
});

describe("lyfta", () => {
  it("reads string weights and reps, Lyfta's exercise name spelling, and paging", () => {
    const r = parseWorkouts(page([workout("2026-10-19", [ex("Bench Press (Barbell)", [["185", "5"]])], "181.4")], 3));
    expect(r.totalPages).toBe(3);
    expect(r.workouts[0]).toMatchObject({ bodyWeight: 181.4, exercises: [{ name: "Bench Press (Barbell)", sets: [{ weight: 185, reps: 5, completed: true }] }] });
    expect(parseWorkouts({}).workouts).toEqual([]);
  });

  it("counts only the barbell main lifts", () => {
    expect(liftKey("Bench Press (Barbell)")).toBe("bench_1rm");
    expect(liftKey("Incline Bench Press (Dumbbell)")).toBeNull();
    expect(liftKey("Squat (Barbell)")).toBe("squat_1rm");
    expect(liftKey("Bulgarian Split Squat")).toBeNull();
    expect(liftKey("Deadlift (Barbell)")).toBe("deadlift_1rm");
    expect(liftKey("Romanian Deadlift")).toBeNull();
    expect(liftKey("Lat Pulldown")).toBeNull();
  });

  it("puts a late workout on the right day by the 4 AM boundary", () => {
    expect(workoutDay("2026-10-19", "America/Chicago", 4)).toBe("2026-10-19");
    // 1:30 AM Chicago on the 20th still belongs to the 19th.
    expect(workoutDay("2026-10-20T06:30:00Z", "America/Chicago", 4)).toBe("2026-10-19");
    expect(workoutDay("2026-10-20 18:00:00", "America/Chicago", 4)).toBe("2026-10-20");
  });

  it("maps workouts to a completed Strength goal, top sets, and bodyweight", () => {
    const raw = parseWorkouts(
      page([
        workout("2026-10-19", [ex("Bench Press (Barbell)", [["185", "5"], ["205", "1"], ["225", "0"], ["215", "1", false]]), ex("Squat (Barbell)", [["100", "3"]])], "82"),
        workout("2026-10-17", [ex("Lat Pulldown", [["120", "10"]])]),
      ]),
    );
    const events = lyftaAdapter.mapToEvents(raw, { today: "2026-10-19", config: { unit: "kg" }, timeZone: "America/Chicago", rolloverHour: 4 });
    expect(events.filter((e) => e.kind === "goal_complete").map((e) => e.kind === "goal_complete" && e.day)).toEqual(["2026-10-17", "2026-10-19"]);
    expect(events).toContainEqual({ kind: "metric", skillSlug: "strength", key: "bench_1rm", value: 451.9, day: "2026-10-19" });
    expect(events).toContainEqual({ kind: "metric", skillSlug: "strength", key: "squat_1rm", value: 220.5, day: "2026-10-19" });
    expect(events).toContainEqual({ kind: "metric", skillSlug: "strength", key: "bodyweight_lb", value: 180.8, day: "2026-10-19" });
  });

  it("syncs every page with the bearer key and explains a rejected key", async () => {
    const urls: string[] = [];
    let auth = "";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      auth = new Headers(init.headers).get("authorization") ?? "";
      const p = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify(page([workout(`2026-10-1${p}`, [])], 2, p)), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await lyftaAdapter.sync({ unit: "lb" }, "k3y", fetchImpl);
    expect(raw.workouts).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(new RegExp(`^${LYFTA_BASE}\\?from=\\d{4}-\\d{2}-\\d{2}&to=\\d{4}-\\d{2}-\\d{2}&limit=100&page=1$`));
    expect(auth).toBe("Bearer k3y");

    const denied = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(lyftaAdapter.sync({ unit: "lb" }, "bad", denied)).rejects.toThrow(/rejected the API key/);
    await expect(lyftaAdapter.sync({ unit: "lb" }, null, denied)).rejects.toThrow(/LYFTA_API_KEY/);
  });
});
