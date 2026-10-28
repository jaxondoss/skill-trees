import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/googleCalendar", () => ({ loadCalendarEvents: vi.fn() }));
const { gridRange, isMonth } = await import("@/lib/data/calendarWall");

describe("calendar wall months", () => {
  it("covers the six weeks the grid shows, starting on the Sunday on or before the 1st", () => {
    expect(gridRange("2026-10")).toEqual({ from: "2026-09-27", to: "2026-11-07" });
    expect(gridRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-03-14" });
  });
  it("accepts only YYYY-MM", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("../x")).toBe(false);
  });
});
