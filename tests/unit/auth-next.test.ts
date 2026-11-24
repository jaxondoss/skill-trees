import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/board")).toBe("/board");
    expect(safeNext("/s/food?day=2026-11-24")).toBe("/s/food?day=2026-11-24");
  });
  it("falls back to the dashboard for anything else", () => {
    for (const bad of [null, undefined, "", "board", "https://evil.example", "//evil.example", "/\\evil.example", "/x\nhttps://evil", "/login", "/login?next=/board"]) {
      expect(safeNext(bad), String(bad)).toBe("/");
    }
  });
});
