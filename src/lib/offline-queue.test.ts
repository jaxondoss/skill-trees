import { describe, expect, it } from "vitest";
import { enqueue, isNetworkError, readQueue, removeFromQueue } from "./offline-queue";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("offline queue", () => {
  it("keeps one entry per goal, latest tap wins", () => {
    const s = memory();
    enqueue({ goalId: "a", tier: "standard", at: "2026-10-15T20:00:00Z" }, s);
    enqueue({ goalId: "b", tier: "floor", at: "2026-10-15T20:01:00Z" }, s);
    enqueue({ goalId: "a", tier: null, at: "2026-10-15T20:02:00Z" }, s);
    expect(readQueue(s).map((e) => [e.goalId, e.tier])).toEqual([
      ["b", "floor"],
      ["a", null],
    ]);
  });

  it("removes only the entries that were replayed", () => {
    const s = memory();
    enqueue({ goalId: "a", tier: "standard", at: "t1" }, s);
    const sent = readQueue(s);
    enqueue({ goalId: "a", tier: "stretch", at: "t2" }, s); // tapped again while syncing
    removeFromQueue(sent, s);
    expect(readQueue(s)).toEqual([{ goalId: "a", tier: "stretch", at: "t2" }]);
  });

  it("survives corrupt storage", () => {
    const s = memory();
    s.setItem("forge.offline-queue", "{not json");
    expect(readQueue(s)).toEqual([]);
  });

  it("tells network failures from app errors", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Only today's goals can be logged."))).toBe(false);
  });
});
