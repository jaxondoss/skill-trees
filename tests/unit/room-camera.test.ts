// Room prototype camera maths (docs/redesign/room-prototype/engine/camera.js).
// The engine file is a classic script that also exports through module.exports, so it can be required here.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const C = require("../../docs/redesign/room-prototype/engine/camera.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ZONES = require("../../art/room/common/zones.json");

type Zone = { id: string; focus: number[]; stop: number };
const zones: Zone[] = ZONES.zones;
const STOPS = zones.map((z) => z.stop);

// CSS size at dpr -> device px (the page uses the device-pixel-content-box; this is the same for whole numbers).
const view = (w: number, h: number, dpr: number) => C.viewFor(Math.round(w * dpr), Math.round(h * dpr), dpr);

describe("device table", () => {
  const rows: [string, number, number, number, number, string, number, number][] = [
    ["Jaxon 1440x702@2", 1440, 702, 2, 4, "room", 720, 351],
    ["1440x900@2", 1440, 900, 2, 4, "room", 720, 450],
    ["1470x830@2", 1470, 830, 2, 4, "room", 735, 415],
    ["1920x950@1", 1920, 950, 1, 3, "room", 640, 317],
    ["1536x730@1.25", 1536, 730, 1.25, 3, "room", 640, 304],
    ["1366x650@1", 1366, 650, 1, 2, "room", 683, 325],
    ["390x844@3 phone", 390, 844, 3, 9, "pan", 130, 281],
  ];
  it.each(rows)("%s", (_name, w, h, dpr, s, mode, wv, hv) => {
    const v = view(w!, h!, dpr!);
    expect(v.s).toBe(s);
    expect(v.mode).toBe(mode);
    expect(Math.round(v.Wv)).toBe(wv);
    expect(Math.round(v.Hv)).toBe(hv);
  });
});

describe("mode rule", () => {
  it("room mode needs at least 1.5 CSS px per art pixel", () => {
    for (const [w, h, dpr] of [
      [1440, 702, 2],
      [1920, 950, 1],
      [1366, 650, 1],
      [2560, 1440, 1],
    ]) {
      const v = view(w!, h!, dpr!);
      expect(v.mode).toBe("room");
      expect(v.s / dpr!).toBeGreaterThanOrEqual(1.5);
      expect(v.s).toBe(Math.min(Math.floor(v.Wd / 640), Math.floor(v.Hd / 270)));
    }
  });
  it("falls back to pan mode with s = max(floor(H/270), ceil(1.5 dpr))", () => {
    const small = view(1024, 700, 1); // sRoom 1 at 1x is under 1.5 CSS px
    expect(small.mode).toBe("pan");
    expect(small.s).toBe(2);
    expect(small.Wv).toBe(512);
    const tablet = view(820, 1180, 2);
    expect(tablet.mode).toBe("pan");
    expect(tablet.s).toBe(Math.max(Math.floor(2360 / 270), 3));
  });
  it("uses the small viewport height on phones when given", () => {
    const v = C.viewFor(1170, 2532, 3, 2200);
    expect(v.s).toBe(Math.max(Math.floor(2200 / 270), 5));
  });
  it("keeps s on small height-only changes in pan mode", () => {
    const v = view(390, 844, 3);
    expect(C.shouldRescale(v, v.Wd, Math.round(v.Hd * 0.9))).toBe(false);
    expect(C.shouldRescale(v, v.Wd, Math.round(v.Hd * 0.8))).toBe(true);
    expect(C.shouldRescale(v, v.Wd + 3, v.Hd)).toBe(true);
    const laptop = view(1440, 702, 2);
    expect(C.shouldRescale(laptop, laptop.Wd, laptop.Hd + 10)).toBe(true);
  });
  it("frames the room 1.3x closer than the integer view, never cropping the core", () => {
    for (const [w, h, dpr] of [
      [1440, 702, 2],
      [1440, 900, 2],
      [1920, 950, 1],
      [1366, 650, 1],
      [2560, 1440, 1],
    ]) {
      const v = view(w!, h!, dpr!);
      expect(v.z0).toBeGreaterThanOrEqual(v.s);
      expect(v.z0).toBeLessThanOrEqual(1.3 * v.s + 1e-9);
      const r = C.visibleRect(C.roomCamera(v), v);
      expect(r.x).toBeLessThanOrEqual(1 / v.z0);
      expect(r.x + r.w).toBeGreaterThanOrEqual(640 - 1 / v.z0);
      expect(r.y).toBeLessThanOrEqual(1 / v.z0);
      expect(r.y + r.h).toBeGreaterThanOrEqual(270 - 1 / v.z0);
    }
    const laptop = view(1440, 702, 2);
    expect(laptop.z0).toBeCloseTo(4.5); // core width bound (1.3 * 4 = 5.2 would crop it)
    expect(view(390, 844, 3).z0).toBe(9); // pan mode keeps s
  });
  it("puts the horizon near 42% of the visible window and keeps the core visible", () => {
    const v = view(2560, 1440, 1);
    const cam = C.roomCamera(v);
    const Hv = v.Hd / cam.z;
    const top = cam.cy - Hv / 2;
    expect((121 - top) / Hv).toBeCloseTo(0.42, 2);
    expect(top).toBeLessThanOrEqual(0);
    expect(top + Hv).toBeGreaterThanOrEqual(270);
  });
  it("reads the world frame from zones.json (960x540 core)", () => {
    try {
      C.configure({ core: { w: 960, h: 540 }, art: { x: -120, y: -90, w: 1200, h: 720 }, horizon: 227 });
      const v = C.viewFor(2880, 1620, 2);
      expect(v.mode).toBe("room");
      const r = C.visibleRect(C.roomCamera(v), v);
      expect(r.x).toBeLessThanOrEqual(0.5);
      expect(r.x + r.w).toBeGreaterThanOrEqual(959.5);
      expect(C.FW_PHONE).toBe(132);
      const laptop = C.viewFor(2880, 1404, 2); // s 2 (1404/540), so 1.3x closer applies: z0 2.6
      expect(laptop.mode).toBe("room");
      expect(laptop.s).toBe(2);
      expect(laptop.z0).toBeCloseTo(2.6);
      expect(C.zoneAtX(1100, zones).id).toBe("gym");
    } finally {
      C.configure({ core: { w: 640, h: 270 }, art: { x: -80, y: -96, w: 800, h: 480 }, horizon: 121 });
    }
    expect(C.CORE_W).toBe(640);
  });
});

describe("zone zoom", () => {
  it("shows about a third of the room across on laptops and desktops", () => {
    for (const [w, h, dpr] of [
      [1440, 702, 2],
      [1440, 900, 2],
      [1920, 950, 1],
      [1536, 730, 1.25],
      [1366, 650, 1],
    ]) {
      const v = view(w!, h!, dpr!);
      for (const z of zones) {
        const zz = C.zoneZoom(v, z.focus);
        expect(Number.isInteger(zz)).toBe(true);
        expect(zz).toBeGreaterThan(v.z0);
        expect(zz).toBeLessThanOrEqual(3 * v.s);
        const across = v.Wd / zz / 640;
        expect(across, z.id).toBeGreaterThanOrEqual(0.3);
        expect(across, z.id).toBeLessThanOrEqual(0.6);
      }
    }
  });
  it("is 13 for every zone on the phone", () => {
    const phone = view(390, 844, 3);
    for (const z of zones) expect(C.zoneZoom(phone, z.focus)).toBe(13);
  });
  it("clamps the zone camera so the window stays inside the art", () => {
    const v = view(1440, 702, 2);
    const kitchen = C.zoneCamera(v, zones[0]!.focus);
    const gym = C.zoneCamera(v, zones[6]!.focus);
    for (const [cam, z] of [
      [kitchen, zones[0]!],
      [gym, zones[6]!],
    ] as const) {
      const r = C.visibleRect(cam, v);
      const fx = z.focus[0]! + z.focus[2]! / 2;
      expect(fx).toBeGreaterThanOrEqual(r.x);
      expect(fx).toBeLessThanOrEqual(r.x + r.w);
    }
    for (const z of zones) {
      const r = C.visibleRect(C.zoneCamera(v, z.focus), v);
      expect(r.x).toBeGreaterThanOrEqual(-80 - 1 / 8);
      expect(r.x + r.w).toBeLessThanOrEqual(720 + 1 / 8);
    }
  });
});

describe("dolly", () => {
  const devices = [view(1440, 702, 2), view(1920, 950, 1), view(390, 844, 3)];
  const point = (t: { z: number; tx: number; ty: number }, x: number, y: number) => [x * t.z + t.tx, y * t.z + t.ty];

  it("lands exactly on the rest frames for every layer, both directions", () => {
    for (const v of devices) {
      const room = C.roomCamera(v, 320);
      for (const z of zones) {
        const zone = C.zoneCamera(v, z.focus);
        for (const [a, b] of [
          [room, zone],
          [zone, room],
        ]) {
          const plan = C.dollyPlan(a, b, v);
          for (let L = 0; L <= 5; L++) {
            expect(C.dollyLayer(plan, L, 0)).toEqual(C.restTransform(a, v, 0));
            expect(C.dollyLayer(plan, L, 1)).toEqual(C.restTransform(b, v, 0));
            // The formula itself converges on the same frames (not only the u <= 0 / u >= 1 shortcut).
            const near0 = C.dollyLayer(plan, L, 1e-12);
            const near1 = C.dollyLayer(plan, L, 1 - 1e-6);
            const r0 = C.restTransform(a, v, 0);
            const r1 = C.restTransform(b, v, 0);
            expect(near0.z).toBeCloseTo(r0.z, 6);
            expect(near0.tx).toBeCloseTo(r0.tx, 4);
            expect(near0.ty).toBeCloseTo(r0.ty, 4);
            expect(near1.z).toBeCloseTo(r1.z, 6);
            expect(near1.tx).toBeCloseTo(r1.tx, 3);
            expect(near1.ty).toBeCloseTo(r1.ty, 3);
          }
        }
      }
    }
  });

  it("keeps the pivot's screen point fixed for every layer and every u", () => {
    for (const v of devices) {
      const room = C.roomCamera(v, 320);
      for (const z of zones) {
        const plan = C.dollyPlan(room, C.zoneCamera(v, z.focus), v);
        const P = plan.P;
        const fixed = point(C.dollyLayer(plan, 0, 0), P.x, P.y);
        for (let L = 0; L <= 5; L++) {
          for (let i = 0; i <= 20; i++) {
            const [X, Y] = point(C.dollyLayer(plan, L, i / 20), P.x, P.y);
            expect(X).toBeCloseTo(fixed[0]!, 6);
            expect(Y).toBeCloseTo(fixed[1]!, 6);
          }
        }
      }
    }
  });

  it("zooms monotonically, near layers ahead of far layers", () => {
    const v = devices[0];
    const plan = C.dollyPlan(C.roomCamera(v), C.zoneCamera(v, zones[2]!.focus), v);
    for (let L = 0; L <= 5; L++) {
      let prev = 0;
      for (let i = 0; i <= 30; i++) {
        const zL = C.dollyLayer(plan, L, i / 30).z;
        expect(zL).toBeGreaterThanOrEqual(prev);
        prev = zL;
      }
    }
    const mid = (L: number) => C.dollyLayer(plan, L, 0.3).z;
    expect(mid(5)).toBeGreaterThan(mid(2));
    expect(mid(2)).toBeGreaterThan(mid(0));
  });

  it("bounds the tear between adjacent floor bands (on-screen points)", () => {
    // The review estimated about 5 px near the pivot; with the kitchen and gym pivots far off-screen the
    // worst on-screen case is about 11.7 world px. Shell bands need at least 12 px of overdraw.
    const v = devices[0];
    const room = C.roomCamera(v);
    for (const z of zones) {
      const plan = C.dollyPlan(room, C.zoneCamera(v, z.focus), v);
      for (let L = 2; L < 5; L++) {
        for (let i = 1; i < 30; i++) {
          const a = C.dollyLayer(plan, L, i / 30);
          const b = C.dollyLayer(plan, L + 1, i / 30);
          for (let x = -40; x <= 680; x += 8) {
            const X = x * a.z + a.tx;
            if (X < 0 || X > v.Wd) continue;
            expect(Math.abs(X - (x * b.z + b.tx)) / a.z).toBeLessThanOrEqual(12);
          }
        }
      }
    }
  });

  it("moves laterally between zones at the same zoom", () => {
    const v = devices[0];
    const cams = zones.map((z) => C.zoneCamera(v, z.focus));
    let pair: [number, number] | null = null;
    for (let i = 0; i < cams.length && !pair; i++)
      for (let j = i + 1; j < cams.length && !pair; j++) if (cams[i].z === cams[j].z) pair = [i, j];
    expect(pair).not.toBeNull();
    const [a, b] = [cams[pair![0]], cams[pair![1]]];
    const plan = C.dollyPlan(a, b, v);
    expect(plan.lateral).toBe(true);
    for (let L = 0; L <= 5; L++) {
      expect(C.dollyLayer(plan, L, 0.5).z).toBe(a.z);
      expect(C.dollyLayer(plan, L, 1)).toEqual(C.restTransform(b, v, 0));
    }
  });

  it("slides frame crops fully out by u = 0.6 and back in", () => {
    expect(C.frameSlide(0, -1, 40, true)).toBeCloseTo(0);
    expect(C.frameSlide(0.6, -1, 40, true)).toBe(-48);
    expect(C.frameSlide(1, 1, 40, false)).toBeCloseTo(0);
    expect(C.frameSlide(0, 1, 40, false)).toBe(48);
  });
});

describe("anticipation and phone pan depth", () => {
  it("pulls back about 3% over 80 ms, then releases with the push-in", () => {
    expect(C.anticipation(0)).toBe(1);
    expect(C.anticipation(80)).toBeCloseTo(0.97);
    expect(C.release(0)).toBeCloseTo(0.97);
    expect(C.release(1)).toBe(1);
    const v = view(1440, 702, 2);
    const tr = C.restTransform(C.roomCamera(v), v, 0);
    const k = C.scaleAbout(tr, 0.97, v);
    // the screen centre stays put
    const wx = (v.Wd / 2 - tr.tx) / tr.z;
    expect(wx * k.z + k.tx).toBeCloseTo(v.Wd / 2);
  });
  it("has no mouse-look: only the moving phone pan offsets layers, and rest is 0", () => {
    expect(C.parallaxOffsets).toBeUndefined();
    expect(C.deflection).toBeUndefined();
    expect(C.panDepthOffsets(0, 9, 9)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const o = C.panDepthOffsets(600, 9, 9);
    expect(o).toEqual([0, -1, -2, -3, -4, -5, -6]);
    o.forEach((x: number) => expect(Object.is(x, -0)).toBe(false));
    expect(C.panDepthOffsets(-6000, 9, 9)[6]).toBe(6);
  });
});

describe("phone pan", () => {
  const v = view(390, 844, 3);
  const bounds = C.panBounds(v);

  it("snaps a fling to a zone stop and settles", () => {
    for (const [x0, v0] of [
      [200, 300],
      [200, -300],
      [320, 0],
      [10, -900],
      [600, 1200],
      [150, 40],
    ]) {
      const target = C.snapTarget(x0, v0, STOPS, bounds);
      expect(STOPS).toContain(target);
      let x = x0;
      let vel = v0;
      let t = 0;
      while (!C.springSettled(x, vel, target) && t < 5) {
        ({ x, v: vel } = C.springStep(x, vel, target, 1 / 60));
        t += 1 / 60;
      }
      expect(t).toBeLessThan(2);
      expect(Math.abs(x! - target)).toBeLessThan(0.05);
    }
  });
  it("picks the stop nearest the momentum target", () => {
    expect(C.momentumTarget(200, 400)).toBeCloseTo(330);
    expect(C.snapTarget(200, 400, STOPS, bounds)).toBe(320);
    expect(C.snapTarget(200, 0, STOPS, bounds)).toBe(224);
  });
  it("rubber-bands past the bounds", () => {
    expect(C.rubberBand(bounds.min - 100, bounds.min, bounds.max)).toBeCloseTo(bounds.min - 35);
    expect(C.rubberBand(bounds.max + 10, bounds.min, bounds.max)).toBeCloseTo(bounds.max + 3.5);
    expect(C.rubberBand(300, bounds.min, bounds.max)).toBe(300);
  });
  it("maps world x to the zone territory", () => {
    expect(C.zoneAtX(54, zones).id).toBe("kitchen");
    expect(C.zoneAtX(320, zones).id).toBe("window");
    expect(C.zoneAtX(700, zones).id).toBe("gym");
  });
});
