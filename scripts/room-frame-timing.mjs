// Room frame-timing harness (v3.5 motion pass): steps every kind of move with the engine clock frozen and advanced
// 16.7 ms per frame (display rate), and records per frame the camera pose (zoom, centre, pan angle), the hero rect
// (skill view / hologram), the phone pan x, the frame-to-frame pixel change and the main-thread cost of the frame
// (wall ms of the advance, SwiftShader). Reports per move: speed curve (screen px per frame), max step vs mean,
// jerk, stalls (a frame that stops inside the move), jumps (a frame far faster than its neighbours), the speed at
// leg boundaries (velocity resets), start/end pops (pixels), dissolve flicker (pixel change with no camera motion),
// and the cost of the request call (snapshot builds) and of the frames.
// Run: node scripts/room-frame-timing.mjs [out-dir] [extra query] [--phone] [--only=name,name]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const root = join(import.meta.dirname, "..");
const page0 = "file://" + join(root, "docs/redesign/room-prototype/index.html");
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));
const out = pos[0] || null;
const extra = pos[1] || "";
const phone = flags.includes("--phone");
const only = (flags.find((f) => f.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const FRAME = 16.7;
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage(
  phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

function query() {
  const q = new URLSearchParams("el=4&p=85&weather=clear&gltier=high");
  for (const [k, v] of new URLSearchParams(extra)) q.set(k, v);
  return q.toString();
}
async function open(hash) {
  await page.goto(`${page0}?${query()}&r=${Math.random()}${hash}`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16.7);
  });
}

// One move: src is evaluated at frame 0; steps (optional) is a list of [frame, src] run before that frame's advance.
async function record(name, src, steps = []) {
  const res = await page.evaluate(
    async ({ src, steps, FRAME }) => {
      const R = window.ROOM;
      const W = R.render.view.Wd, H = R.render.view.Hd;
      const tw = 96, th = 60;
      // thumbnails through a small canvas: reading the main canvas back would move it off the GPU and make the
      // frames that follow (not the page in real use) many times slower
      const tc = document.createElement("canvas");
      tc.width = tw;
      tc.height = th;
      const tx = tc.getContext("2d", { willReadFrequently: true });
      tx.imageSmoothingEnabled = false;
      const thumb = () => {
        tx.drawImage(R.render.canvas, 0, 0, tw, th);
        const d = tx.getImageData(0, 0, tw, th).data, t = new Uint8Array(tw * th * 3);
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
          t[j] = d[i];
          t[j + 1] = d[i + 1];
          t[j + 2] = d[i + 2];
        }
        return t;
      };
      const diff = (a, b) => {
        let s = 0;
        for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
        return s / a.length;
      };
      const pose = () => {
        const l = R.nav.leg, st = R.debug.state;
        const sk = st.skill && st.skill.rectDev ? st.skill.rectDev : null;
        let p;
        if (l && l.pose) p = Object.assign({ kind: l.kind }, l.pose);
        else {
          const c = st.camera; // rest camera {cx, cy, z}
          p = { kind: "rest", z: c.z, cx: c.cx, cy: c.cy };
        }
        if (p.tx != null) {
          p.cx = (W / 2 - p.tx) / p.z;
          p.cy = (H / 2 - p.ty) / p.z;
        }
        p.hero = sk ? { x: sk.x + sk.w / 2, y: sk.y + sk.h / 2, w: sk.w, k: st.skill.k, heroK: st.skill.heroK, haloK: st.skill.haloK } : null;
        p.pan = st.pan.x;
        p.dimK = R.nav.ls().dimK;
        p.busy = R.nav.busy || st.pan.target != null; // the phone pan spring is not a navigator move
        return p;
      };
      const rest = [thumb()];
      for (let i = 0; i < 6; i++) {
        R.debug.advance(FRAME);
        rest.push(thumb());
      }
      let noise = 0;
      for (let i = 1; i < rest.length; i++) noise = Math.max(noise, diff(rest[i - 1], rest[i]));
      const frames = [];
      let prev = rest[rest.length - 1];
      const p0 = pose();
      p0.ms = 0;
      p0.pop = 0;
      frames.push(p0);
      const s0 = R.render.snapStats.made;
      const tReq = performance.now();
      new Function(src)();
      const reqMs = performance.now() - tReq;
      let n = 0, idle = 0;
      while (n < 260 && idle < 8) {
        for (const [f, s] of steps) if (f === n) new Function(s)();
        const t0 = performance.now();
        R.debug.advance(FRAME);
        const ms = performance.now() - t0;
        const th2 = thumb();
        const p = pose();
        p.ms = ms;
        p.pop = diff(prev, th2);
        prev = th2;
        frames.push(p);
        if (!p.busy && !steps.some(([f]) => f > n)) idle++;
        else idle = 0;
        n++;
      }
      return { frames, noise, reqMs, snapsMade: R.render.snapStats.made - s0, W, H, place: R.nav.place };
    },
    { src, steps, FRAME },
  );
  const rep = analyse(name, res);
  console.log(JSON.stringify(rep));
  all.push(rep);
  if (out) writeFileSync(join(out, name + ".frames.json"), JSON.stringify(res.frames));
  return rep;
}

// screen speed (device px per frame) between two poses
function speed(a, b, W, H) {
  const D = Math.hypot(W, H) / 2;
  let cam = 0;
  if (a.th != null && b.th != null) cam = Math.abs(b.th - a.th) * b.F + Math.abs(Math.log(b.z / a.z)) * D + Math.abs(b.vx - a.vx);
  else if (a.s != null && b.s != null) cam = Math.abs(Math.log(b.s / a.s)) * D + Math.hypot(b.cx - a.cx, b.cy - a.cy);
  else if (a.cx != null && b.cx != null && a.z && b.z) cam = Math.abs(Math.log(b.z / a.z)) * D + Math.hypot(b.cx - a.cx, b.cy - a.cy) * b.z;
  else cam = NaN; // pose type changed (leg boundary): judged by pixels
  let hero = 0;
  if (a.hero && b.hero) hero = Math.hypot(b.hero.x - a.hero.x, b.hero.y - a.hero.y) + Math.abs(b.hero.w - a.hero.w) / 2;
  return { cam, hero };
}
function stats(v) {
  const m = v.filter((x) => Number.isFinite(x));
  if (!m.length) return null;
  const moving = m.filter((x) => x > 0.05);
  const mean = moving.reduce((a, b) => a + b, 0) / Math.max(1, moving.length);
  const max = Math.max(...m);
  let maxAcc = 0, jerk = 0;
  for (let i = 1; i < m.length; i++) maxAcc = Math.max(maxAcc, Math.abs(m[i] - m[i - 1]));
  for (let i = 2; i < m.length; i++) jerk = Math.max(jerk, Math.abs(m[i] - 2 * m[i - 1] + m[i - 2]));
  return { mean, max, maxAcc, jerk, frames: moving.length };
}
function analyse(name, res) {
  const f = res.frames, W = res.W, H = res.H;
  const sp = [];
  for (let i = 1; i < f.length; i++) sp.push(speed(f[i - 1], f[i], W, H));
  const busyN = f.filter((p) => p.busy).length;
  const cam = sp.map((s) => s.cam), hero = sp.map((s) => s.hero);
  // stalls: a frame with ~0 motion between moving frames inside the move; jumps: > 2.2x both neighbours' mean
  const tot = sp.map((s) => (Number.isFinite(s.cam) ? s.cam : 0) + s.hero);
  let first = tot.findIndex((x) => x > 0.05), last = tot.length - 1 - [...tot].reverse().findIndex((x) => x > 0.05);
  const stalls = [], jumps = [];
  if (first >= 0)
    for (let i = first + 1; i < last; i++) {
      const nb = (tot[i - 1] + tot[i + 1]) / 2;
      if (tot[i] < 0.15 * nb && nb > 1) stalls.push(i);
      if (tot[i] > 2.2 * nb && tot[i] > 4) jumps.push(i);
    }
  // leg boundaries: where pose kind changes
  const bounds = [];
  for (let i = 1; i < f.length; i++) if (f[i].kind !== f[i - 1].kind) bounds.push({ at: i, from: f[i - 1].kind, to: f[i].kind });
  // pixel flicker: pixel change on frames whose camera and hero did not move (dissolve steps, stepped halos)
  const flick = [];
  for (let i = 1; i < f.length; i++) if (f[i].busy && tot[i - 1] < 0.05 && f[i].pop > res.noise + 1.5) flick.push(+f[i].pop.toFixed(1));
  const pops = f.map((p) => p.pop);
  const ms = f.slice(1).map((p) => p.ms);
  const r = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const S = stats(cam), Hs = stats(hero);
  return {
    name,
    busyFrames: busyN,
    reqMs: r(res.reqMs),
    snapsMade: res.snapsMade,
    frameMs: { first: r(ms[0]), max: r(Math.max(...ms)), mean: r(ms.reduce((a, b) => a + b, 0) / ms.length) },
    cam: S && { mean: r(S.mean), max: r(S.max), maxOverMean: r(S.max / Math.max(1e-6, S.mean)), maxAcc: r(S.maxAcc), jerk: r(S.jerk), frames: S.frames },
    hero: Hs && Hs.frames ? { mean: r(Hs.mean), max: r(Hs.max), maxAcc: r(Hs.maxAcc), jerk: r(Hs.jerk), frames: Hs.frames } : null,
    stalls,
    jumps,
    bounds: bounds.map((b) => `${b.at}:${b.from}>${b.to}`),
    noise: r(res.noise),
    startPop: r(pops[1]),
    endPop: r(pops[Math.max(1, busyN)] || 0),
    maxPop: r(Math.max(...pops)),
    flicker: flick.length,
    flickMax: flick.length ? Math.max(...flick) : 0,
    place: [res.place.mode, res.place.view, res.place.zone, res.place.item].filter(Boolean).join(":"),
  };
}

const all = [];
const moves = phone
  ? [
      ["turn-90", "#/room", "ROOM.turn(1)"],
      ["turn-180", "#/room", "ROOM.turnTo('back')"],
      ["into-zone", "#/room", "ROOM.go('library')"],
      ["zone-out", "#/room/library", "ROOM.go(null)"],
      ["lift", "#/room/window", "ROOM.nav.request({mode: 'skill', item: 'library.chess'})"],
      ["holo-open", "#/room", "ROOM.nav.request({mode: 'skill', item: 'library.chess', holo: true})"],
      [
        "pan-fling",
        "#/room",
        "const P = ROOM.render.pan; P.dragging = true; P.target = null; P.v = 0; window.__x0 = P.x;",
        [1, 2, 3, 4, 5, 6].map((i) => [i, `ROOM.render.pan.x = window.__x0 + ${i * 9}; ROOM.render.pan.v = 9 * 60; ROOM.invalidate();`]).concat([
          [7, "const P = ROOM.render.pan, C = ROOM.camera; P.dragging = false; P.v = 9 * 60; P.target = C.snapTarget(P.x, P.v, C.zoneStops(ROOM.zonesInView()), C.panBounds(ROOM.render.view)); ROOM.invalidate();"],
        ]),
      ],
    ]
  : [
      ["turn-90", "#/room", "ROOM.turn(1)"],
      ["turn-180", "#/room", "ROOM.turnTo('back')"],
      ["turn-into-zone", "#/room", "ROOM.go('gym')"],
      ["zone-to-zone", "#/room/library", "ROOM.go('window')"],
      ["zone-to-zone-wall", "#/room/window", "ROOM.go('study')"],
      ["room-to-zone", "#/room", "ROOM.go('library')"],
      ["zone-to-room", "#/room/library", "ROOM.go(null)"],
      ["rise", "#/room/window", "ROOM.nav.up()"],
      ["descend", "#/room/overview", "ROOM.nav.down()"],
      ["overview-skill", "#/room/overview", "ROOM.nav.request({mode: 'skill', item: 'gym.strength'})"],
      ["lift", "#/room/window", "ROOM.nav.request({mode: 'skill', item: 'library.chess'})"],
      ["drop", "#/room/window/chess", "ROOM.nav.back()"],
      ["lift-other-wall", "#/room", "ROOM.nav.request({mode: 'skill', item: 'bed.bed'})"],
      ["holo-open", "#/room", "ROOM.nav.request({mode: 'skill', item: 'library.chess', holo: true})"],
      ["holo-close", "#/room", "ROOM.nav.request({mode: 'skill', item: 'library.chess', holo: true})", [[40, "ROOM.nav.back()"]]],
      // chained: a turn with two more presses (retarget), a turn then a queued zone, a dolly reversed mid-way
      ["turn-retarget", "#/room", "ROOM.turn(1)", [[12, "ROOM.turn(1)"], [24, "ROOM.turn(1)"]]],
      ["turn-then-zone", "#/room", "ROOM.turn(1)", [[20, "ROOM.go('gym')"]]],
      ["dolly-reverse", "#/room", "ROOM.go('library')", [[12, "ROOM.go(null)"]]],
      ["lift-reverse", "#/room/window", "ROOM.nav.request({mode: 'skill', item: 'library.chess'})", [[10, "ROOM.nav.back()"]]],
    ];
for (const [name, hash, src, steps] of moves) {
  if (only.length && !only.includes(name)) continue;
  await open(hash);
  try {
    await record(name, src, steps || []);
  } catch (e) {
    console.log(JSON.stringify({ name, error: String(e).slice(0, 300) }));
  }
}
if (out) writeFileSync(join(out, "timing.json"), JSON.stringify({ query: query(), phone, moves: all, errors }, null, 1));
if (errors.length) console.log("errors", errors.slice(0, 5));
await browser.close();
