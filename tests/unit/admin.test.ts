import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminEmails, isAdmin } from "@/lib/admin";
import { FEATURE_OF, FEATURE_TILES, isTileId, itemFromSegments, layoutSides, perimeterT, sideOfT, tileOfObject, type Plan } from "@/lib/admin-items";

const root = join(__dirname, "..", "..");
const plan = JSON.parse(readFileSync(join(root, "public/room/plan.json"), "utf8")) as Plan & { missing: string[] };
const manifest = JSON.parse(readFileSync(join(root, "art/room-r6/manifest.json"), "utf8")).items as { id: string; kind: string; view: string; target?: { skill?: string; feature?: string } }[];
const hotspots = manifest.filter((m) => m.kind === "hotspot" && m.view !== "top");

describe("isAdmin", () => {
  it("matches ADMIN_EMAILS case-insensitively, trimming the comma list", () => {
    expect([...adminEmails(" A@x.com, b@Y.com ,,")]).toEqual(["a@x.com", "b@y.com"]);
    expect(isAdmin({ email: "B@y.com" }, "a@x.com,b@y.com")).toBe(true);
    expect(isAdmin({ email: "c@y.com" }, "a@x.com,b@y.com")).toBe(false);
  });
  it("is false with no env, no user or no email", () => {
    expect(isAdmin({ email: "a@x.com" }, "")).toBe(false);
    expect(isAdmin(null, "a@x.com")).toBe(false);
    expect(isAdmin({ email: null }, "a@x.com")).toBe(false);
    expect(isAdmin({ email: "" }, ",")).toBe(false);
  });
});

describe("plan.json", () => {
  it("has the room, four walls, the window and door, and a footprint per hotspot", () => {
    expect(plan.room).toEqual({ w: 28, d: 28, x0: -14, z0: -14 });
    expect(plan.walls.map((w) => w.side).sort()).toEqual(["back", "front", "left", "right"]);
    expect(plan.openings.map((o) => o.kind).sort()).toEqual(["door", "window"]);
    expect(plan.missing).toEqual([]);
    expect(plan.objects.map((o) => o.id).sort()).toEqual(hotspots.map((h) => h.id).sort());
  });
  it("keeps every footprint inside the room with a positive area", () => {
    for (const o of plan.objects) {
      expect(o.x0, o.id).toBeGreaterThanOrEqual(-14);
      expect(o.x1, o.id).toBeLessThanOrEqual(14);
      expect(o.z0, o.id).toBeGreaterThanOrEqual(-14);
      expect(o.z1, o.id).toBeLessThanOrEqual(14);
      expect(o.x1 - o.x0, o.id).toBeGreaterThan(0);
      expect(o.z1 - o.z0, o.id).toBeGreaterThan(0);
      if (o.wall) expect(["front", "right", "back", "left"]).toContain(o.wall);
    }
  });
  it("maps every hotspot to a tile", () => {
    for (const o of plan.objects) expect(tileOfObject(o), o.id).not.toBeNull();
    for (const f of Object.values(FEATURE_OF)) expect(FEATURE_TILES.map((t) => t.id)).toContain(f);
  });
});

describe("admin items", () => {
  it("turns route segments into tile ids and validates them", () => {
    expect(itemFromSegments(undefined)).toBeNull();
    expect(itemFromSegments(["s", "reading"])).toBe("s/reading");
    expect(itemFromSegments(["review", "month"])).toBe("review/month");
    expect(isTileId("s/reading", ["reading"])).toBe(true);
    expect(isTileId("s/nope", ["reading"])).toBe(false);
    expect(isTileId("settings", [])).toBe(true);
    expect(isTileId("../etc", [])).toBe(false);
  });
  it("orders the perimeter clockwise from the top-left corner (window wall at the top)", () => {
    expect(sideOfT(perimeterT(0, 14))).toBe("top");
    expect(sideOfT(perimeterT(14, 0))).toBe("right");
    expect(sideOfT(perimeterT(0, -14))).toBe("bottom");
    expect(sideOfT(perimeterT(-14, 0))).toBe("left");
    expect(perimeterT(-5, 14)).toBeLessThan(perimeterT(5, 14));
  });
  it("lays tiles out within capacity, spilling clockwise, and places every tile once", () => {
    const placed = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, t: 0.01 + i * 0.02 })); // all on top
    const out = layoutSides(placed, ["u1", "u2"], { top: 4, right: 4, bottom: 4, left: 4 });
    expect(out.top).toEqual(["t0", "t1", "t2", "t3"]);
    expect(out.right).toEqual(["t4", "t5", "t6", "t7"]);
    const all = [...out.top, ...out.right, ...out.bottom, ...out.left];
    expect(all.sort()).toEqual([...placed.map((p) => p.id), "u1", "u2"].sort());
  });
});
