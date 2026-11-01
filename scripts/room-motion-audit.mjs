// Room motion audit: steps every kind of move with a frozen clock and reports, per move, the mean brightness of each
// frame and the largest frame-to-frame change (a pop) at its start, middle and end, with the rest-frame noise floor
// measured before the move (grain and dust) so pops can be read as "pop minus noise".
// Run: node scripts/room-motion-audit.mjs [out-dir] [extra query, e.g. "gl=off" or "el=-25" or "weather=rain"]
// (writes a contact sheet per move and audit.json when out-dir is given). The GPU tier is pinned (gltier=high).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const root = join(import.meta.dirname, "..");
const page0 = "file://" + join(root, "docs/redesign/room-prototype/index.html");
const out = process.argv[2] || null;
const extra = process.argv[3] || "";
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

function query() {
  const q = new URLSearchParams("el=4&p=85&weather=clear&gltier=high");
  for (const [k, v] of new URLSearchParams(extra)) q.set(k, v);
  return q.toString();
}
async function open(hash = "#/room", q = query()) {
  await page.goto(`${page0}?${q}&r=${Math.random()}${hash}`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16);
  });
}

// Step the frozen clock 16 ms at a time until the move settles; collect stats (and small thumbnails).
async function record(name, start) {
  const res = await page.evaluate(async (src) => {
    const R = window.ROOM;
    const stat = () => {
      const f = R.debug.readFrame();
      const d = f.data;
      let sum = 0;
      const W = f.width, H = f.height;
      const tw = 160, th = 100, thumb = new Uint8Array(tw * th * 3);
      for (let i = 0; i < d.length; i += 4 * 7) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const o = (Math.floor(((y + 0.5) * H) / th) * W + Math.floor(((x + 0.5) * W) / tw)) * 4;
          thumb.set([d[o], d[o + 1], d[o + 2]], (y * tw + x) * 3);
        }
      return { mean: sum / (d.length / (4 * 7)), thumb: Array.from(thumb) };
    };
    const busy = () => {
      const s = R.debug.state;
      return !!(s.turn || s.dolly || (R.nav ? R.nav.busy : R.feature && R.feature.busy && R.feature.busy()));
    };
    // the noise floor: 10 rest frames before the move
    const rest = [stat()];
    for (let i = 0; i < 10; i++) {
      R.debug.advance(16);
      rest.push(stat());
    }
    const list = [rest[rest.length - 1]];
    new Function(src)();
    R.debug.advance(0);
    list.push(stat());
    let n = 0;
    while (busy() && n < 200) {
      R.debug.advance(16);
      list.push(stat());
      n++;
    }
    const moving = list.length;
    for (let i = 0; i < 20; i++) {
      R.debug.advance(16);
      list.push(stat());
    }
    const d = (a, b) => {
      let s = 0;
      for (let k = 0; k < a.thumb.length; k++) s += Math.abs(a.thumb[k] - b.thumb[k]);
      return s / a.thumb.length;
    };
    let noise = 0;
    for (let i = 1; i < rest.length; i++) noise = Math.max(noise, d(rest[i - 1], rest[i]));
    return { list, noise, moving, snaps: R.debug.state.snaps, place: R.nav ? R.nav.place : null };
  }, start);
  const { list: frames, noise, moving } = res;
  const diffs = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].thumb, b = frames[i].thumb;
    let s = 0;
    for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
    diffs.push(s / a.length);
  }
  const means = frames.map((f) => f.mean);
  const n = diffs.length;
  // the move's own last frame vs the first rest frame (the landing): diffs[moving - 2]
  const landPop = diffs[Math.max(0, Math.min(n - 1, moving - 2))] || 0;
  const rep = {
    name,
    frames: frames.length,
    noise: noise.toFixed(2),
    landPop: landPop.toFixed(2),
    startOverNoise: Math.max(0, diffs[0] - noise).toFixed(2),
    endOverNoise: Math.max(0, landPop - noise).toFixed(2),
    place: res.place ? [res.place.mode, res.place.view, res.place.zone, res.place.item].filter(Boolean).join(":") : null,
    meanRange: [Math.min(...means).toFixed(1), Math.max(...means).toFixed(1)],
    meanStartEnd: [means[0].toFixed(1), means[means.length - 1].toFixed(1)],
    startPop: diffs[0].toFixed(2),
    maxPop: Math.max(...diffs).toFixed(2),
    maxAt: diffs.indexOf(Math.max(...diffs)),
    endPop: Math.max(...diffs.slice(Math.max(0, n - 24))).toFixed(2),
    settleNoise: Math.max(...diffs.slice(n - 10)).toFixed(2),
  };
  console.log(JSON.stringify(rep));
  all.push(rep);
  if (out) {
    // contact sheet: every 3rd frame, 8 across
    const pick = frames.filter((_, i) => i % 3 === 0);
    const cols = 8, rows = Math.ceil(pick.length / cols), tw = 160, th = 100;
    const W = cols * tw, H = rows * th;
    const rgb = Buffer.alloc(W * H * 3);
    pick.forEach((f, i) => {
      const ox = (i % cols) * tw, oy = Math.floor(i / cols) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < 3; c++) rgb[((oy + y) * W + ox + x) * 3 + c] = f.thumb[(y * tw + x) * 3 + c];
    });
    writeFileSync(join(out, name + ".ppm"), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), rgb]));
  }
  return rep;
}

const all = [];
const moves = [
  ["turn-front-right", "#/room", "ROOM.turn(1)"],
  ["turn-front-back", "#/room", "ROOM.turnTo('back')"],
  ["into-chess", "#/room", "ROOM.go('" + "__CHESS__" + "')"],
  ["zone-out", "#/room/__CHESS__", "ROOM.go(null)"],
  ["zone-to-zone", "#/room/__CHESS__", "ROOM.go('window')"],
  ["into-other-view", "#/room", "ROOM.go('__GYM__')"],
  // v3.5 moves
  ["turn-zoom-zone-zone", "#/room/window", "ROOM.go('study')"],
  ["lift-chess", "#/room/window", "ROOM.nav.request({mode: 'skill', item: 'library.chess'})"],
  ["drop-chess", "#/room/window/chess", "ROOM.nav.back()"],
  ["swap-chess-cushion", "#/room/window/chess", "ROOM.nav.request({mode: 'skill', item: 'bed.cushion'})"],
  ["lift-other-wall", "#/room", "ROOM.nav.request({mode: 'skill', item: 'bed.bed'})"],
  ["rise", "#/room/window", "ROOM.nav.up()", "overview"],
  ["descend", "#/room/overview", "ROOM.nav.down()", "overview"],
  ["chain-overview-skill", "#/room/overview", "ROOM.nav.request({mode: 'skill', item: 'gym.strength'})", "overview"],
];
await open();
const ids = await page.evaluate(() => ({ zones: window.ROOM.zones.map((z) => z.id + ":" + window.ROOM.viewOf(z)) }));
console.log(ids.zones.join(" "));
const zf = ids.zones.map((s) => s.split(":"));
const chess = (zf.find(([, v]) => v === "front" && /library/.test(zf.map((x) => x[0]).join())) || zf[0])[0];
const lib = zf.find(([z]) => z === "library") ? "library" : chess;
const gym = (zf.find(([z]) => z === "gym") || zf.find(([, v]) => v !== "front"))[0];
const hasOverview = await page.evaluate(() => !!(window.ROOM.nav && window.ROOM.nav.overviewOn && window.ROOM.nav.overviewOn()));
const hasNav = await page.evaluate(() => !!(window.ROOM.nav && window.ROOM.nav.tick));
for (const [name, hash, src, needs] of moves) {
  if (needs === "overview" && !hasOverview) continue;
  if (/ROOM\.nav/.test(src) && !hasNav) continue;
  const h = hash.replace("__CHESS__", lib);
  await open(h);
  await record(name, src.replace("__CHESS__", lib).replace("__GYM__", gym));
}
if (out) writeFileSync(join(out, "audit.json"), JSON.stringify({ query: query(), moves: all, errors }, null, 1));
if (errors.length) console.log("errors", errors);
await browser.close();
