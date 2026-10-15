import { describe, expect, it } from "vitest";
import { addDays, dayKey, daysBetween, weekStart, weekday } from "./time";

const CHI = "America/Chicago";
const at = (iso: string) => new Date(iso);

describe("dayKey: 4 AM rollover in Central time", () => {
  it("puts 1:30 AM work on the previous day", () => {
    // 2026-10-16 01:30 CDT
    expect(dayKey(at("2026-10-16T06:30:00Z"), CHI, 4)).toBe("2026-10-15");
  });

  it("starts the new day at exactly 4:00 AM", () => {
    expect(dayKey(at("2026-10-16T08:59:59Z"), CHI, 4)).toBe("2026-10-15"); // 3:59:59 AM
    expect(dayKey(at("2026-10-16T09:00:00Z"), CHI, 4)).toBe("2026-10-16"); // 4:00 AM
  });

  it("keeps late evening on the same day", () => {
    expect(dayKey(at("2026-10-16T04:30:00Z"), CHI, 4)).toBe("2026-10-15"); // 11:30 PM
  });

  it("handles the fall-back night (Nov 1, 2026), where 1:30 AM happens twice", () => {
    expect(dayKey(at("2026-11-01T06:30:00Z"), CHI, 4)).toBe("2026-10-31"); // 1:30 CDT
    expect(dayKey(at("2026-11-01T07:30:00Z"), CHI, 4)).toBe("2026-10-31"); // 1:30 CST
    expect(dayKey(at("2026-11-01T09:59:00Z"), CHI, 4)).toBe("2026-10-31"); // 3:59 CST
    expect(dayKey(at("2026-11-01T10:00:00Z"), CHI, 4)).toBe("2026-11-01"); // 4:00 CST
  });

  it("handles the spring-forward night (Mar 14, 2027), where 2 AM is skipped", () => {
    expect(dayKey(at("2027-03-14T07:59:00Z"), CHI, 4)).toBe("2027-03-13"); // 1:59 CST
    expect(dayKey(at("2027-03-14T08:30:00Z"), CHI, 4)).toBe("2027-03-13"); // 3:30 CDT
    expect(dayKey(at("2027-03-14T09:00:00Z"), CHI, 4)).toBe("2027-03-14"); // 4:00 CDT
  });

  it("respects a custom rollover hour", () => {
    expect(dayKey(at("2026-10-16T05:30:00Z"), CHI, 0)).toBe("2026-10-16"); // 12:30 AM, midnight rollover
    expect(dayKey(at("2026-10-16T10:00:00Z"), CHI, 6)).toBe("2026-10-15"); // 5:00 AM, 6 AM rollover
    expect(dayKey(at("2026-10-16T11:00:00Z"), CHI, 6)).toBe("2026-10-16"); // 6:00 AM
  });

  it("works in other time zones", () => {
    expect(dayKey(at("2026-10-15T17:00:00Z"), "Asia/Tokyo", 4)).toBe("2026-10-15"); // 2:00 AM Oct 16 JST
    expect(dayKey(at("2026-10-15T19:00:00Z"), "Asia/Tokyo", 4)).toBe("2026-10-16"); // 4:00 AM JST
  });
});

describe("day arithmetic", () => {
  it("adds days across month, year, and leap day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-15", -28)).toBe("2026-09-17");
  });

  it("counts days between, ignoring DST", () => {
    expect(daysBetween("2026-10-15", "2026-10-15")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
  });

  it("knows weekdays and Monday week starts", () => {
    expect(weekday("2026-10-15")).toBe(4); // Thursday
    expect(weekday("2026-10-18")).toBe(0); // Sunday
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
});
