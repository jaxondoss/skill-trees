// Art pass 6 (v3.4) phase 1 deliverables: stills per view (golden hour, night, rain), the render pass strip,
// room tier T1 vs T5, 0% vs 100% completion, a 360 degree turn capture and GPU frame times per tier.
// Run: node scripts/room-r6-deliverables.mjs   (writes docs/redesign/room-r6/stills and captures)
// Headless Chromium renders WebGL2 with SwiftShader (software), so the frame times are a floor, not real GPU numbers.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const root = join(import.meta.dirname, "..");
const page0 = "file://" + join(root, "docs/redesign/room-prototype/index.html");
const stills = join(root, "docs/redesign/room-r6/stills");
const caps = join(root, "docs/redesign/room-r6/captures");
mkdirSync(stills, { recursive: true });
mkdirSync(caps, { recursive: true });
const only = process.argv[2] || "all";

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// golden hour: sun 4 degrees up in the evening; night: 25 degrees below; rain: a grey afternoon
const LOOKS = { golden: "el=4&p=85", night: "el=-25&p=85", rain: "el=22&p=85&weather=rain&precip=6&wind=12&seed=3" };
const VIEWS = ["front", "right", "back", "left"];

async function open(query, view = "front") {
  await page.goto(`${page0}?${query}#/room${view === "front" ? "" : "/" + view}`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.evaluate(() => document.body.classList.add("photo"));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16);
  });
  await page.waitForTimeout(150);
}
async function shot(name) {
  await page.screenshot({ path: join(stills, name + ".png") });
}

if (only === "all" || only === "stills") {
  for (const v of VIEWS)
    for (const [look, q] of Object.entries(LOOKS)) {
      await open(q, v);
      await shot(`${v}-${look}`);
      console.log("still", v, look);
    }
}
if (only === "all" || only === "passes") {
  for (const pass of ["albedo", "light", "refl", "final"]) {
    await open(`${LOOKS.golden}&light=${pass}`);
    await shot(`pass-${pass}`);
  }
  await open(LOOKS.golden + "&gl=off");
  await shot("pass-canvas2d-fallback");
  for (const t of [1, 5]) {
    await open(`${LOOKS.golden}&tier=${t}`);
    await shot(`tier-T${t}`);
  }
  for (const p of [0, 100]) {
    await open(`el=4&p=${p}`);
    await shot(`completion-${p}`);
  }
  console.log("passes, tiers, completion");
}
if (only === "all" || only === "turn") {
  // 360 degrees: four right turns at golden hour on the frozen clock, 40 ms steps
  await open(LOOKS.golden);
  const frames = [];
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => window.ROOM.turn(1));
    for (let t = 0; t <= 680; t += 40) {
      await page.evaluate(() => window.ROOM.debug.advance(40));
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 800 } });
      frames.push(buf);
    }
  }
  frames.forEach((b, i) => writeFileSync(join(caps, `turn360-${String(i).padStart(3, "0")}.png`), b));
  console.log("turn frames", frames.length);
}
if (only === "turns8") {
  // phase 2: every turn (four walls, both directions) at golden hour and night, 40 ms frames, half size
  const dir8 = join(caps, "turns");
  mkdirSync(dir8, { recursive: true });
  const TURNS = [["front", 1], ["right", 1], ["back", 1], ["left", 1], ["front", -1], ["left", -1], ["back", -1], ["right", -1]];
  for (const look of ["golden", "night"])
    for (const [from, dir] of TURNS) {
      await open(LOOKS[look], from);
      await page.evaluate((d) => window.ROOM.turn(d), dir);
      let i = 0;
      while ((await page.evaluate(() => window.ROOM.render.turning)) && i < 40) {
        await page.screenshot({ path: join(dir8, `${look}-${from}-${dir > 0 ? "right" : "left"}-${String(i).padStart(2, "0")}.png`), scale: "css" });
        await page.evaluate(() => window.ROOM.debug.advance(40));
        i++;
      }
      await page.evaluate(() => window.ROOM.debug.advance(16));
      await page.screenshot({ path: join(dir8, `${look}-${from}-${dir > 0 ? "right" : "left"}-${String(i).padStart(2, "0")}.png`) });
      console.log("turn", look, from, dir, i, "frames");
    }
}
if (only === "plaque") {
  // phase 2: the plaque at 0%, 60% and 100% (UPGRADE showing), and the level-up moment
  const box = async () =>
    page.evaluate(() => {
      const d = window.ROOM.render.drawables.find((x) => x.statue && x.item.plaque);
      const pl = d.item.plaque;
      const r = window.ROOM.render.cssRectOf({ hit: [pl[0] - 40, pl[1] - 150, pl[2] + 80, pl[3] + 170], layer: d.layer });
      return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(800 - Math.max(0, r.top), r.height) };
    });
  for (const [name, score] of [["0", 40.0], ["60", 40.6], ["100", 41.3]]) {
    await open(`${LOOKS.golden}&level=40&score=${score}`);
    await page.screenshot({ path: join(stills, `plaque-${name}.png`), clip: await box() });
  }
  await page.goto(`${page0}?${LOOKS.golden}&level=40&score=41.3&n=${Math.random()}#/room`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.ROOM.debug.freeze(); window.ROOM.debug.advance(16); });
  const clip = await box();
  await page.locator(".statue-upgrade").click();
  await page.evaluate(() => document.body.classList.add("photo"));
  for (let i = 0; i < 9; i++) {
    await page.evaluate(() => window.ROOM.debug.advance(160));
    await page.screenshot({ path: join(stills, `levelup-${i}.png`), clip });
  }
  // a tier-crossing level-up (39 to 40): the armour changes under the gold band
  await page.goto(`${page0}?${LOOKS.golden}&level=39&score=40.4&n=${Math.random()}#/room`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.ROOM.debug.freeze(); window.ROOM.debug.advance(16); });
  await page.locator(".statue-upgrade").click();
  await page.evaluate(() => document.body.classList.add("photo"));
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.ROOM.debug.advance(200));
    await page.screenshot({ path: join(stills, `tierup-${i}.png`), clip });
  }
  console.log("plaque, level-up, tier-up");
}
if (only === "calendar") {
  // phase 3: the calendar wall at golden hour and night, a past month (the red to green to gold range), and the day
  // bar for today and for a clicked past day
  const wall = async (q) => {
    await page.goto(`${page0}?${q}&n=${Math.random()}#/room/calendar`);
    await page.waitForFunction(() => window.ROOM && window.ROOM.debug && window.ROOM.state.zone === "calendar");
    await page.waitForTimeout(1500);
  };
  const dayBar = () =>
    page.evaluate(() => {
      const r = window.ROOM.viewConf("back").calendar.day;
      const c = window.ROOM.render.cssRectOf({ hit: [r[0] - 4, r[1] - 4, r[2] + 8, r[3] + 8], layer: 3 });
      return { x: Math.max(0, c.left), y: Math.max(0, c.top), width: c.width, height: c.height };
    });
  await wall(LOOKS.golden);
  await page.screenshot({ path: join(stills, "calendar-golden.png") });
  await page.screenshot({ path: join(stills, "daybar-today.png"), clip: await dayBar() });
  await page.evaluate(() => window.ROOM.calendar.shiftMonth(-1));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(stills, "calendar-past-month.png") });
  await page.evaluate(() => window.ROOM.calendar.select(window.ROOM.calendar.month + "-17"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(stills, "daybar-past-day.png"), clip: await dayBar() });
  await wall(LOOKS.night);
  await page.screenshot({ path: join(stills, "calendar-night.png") });
  // the back view from the room (not zoomed), golden hour
  await page.goto(`${page0}?${LOOKS.golden}&n=${Math.random()}#/room/back`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  await page.evaluate(() => document.body.classList.add("photo"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(stills, "back-golden.png") });
  console.log("calendar wall");
}
if (only === "all" || only === "fps") {
  const rows = [];
  for (const tier of ["ultra", "high", "medium", "low"]) {
    await page.goto(`${page0}?${LOOKS.golden}&gltier=${tier}#/room`);
    await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
    const r = await page.evaluate(async () => {
      const R = window.ROOM;
      const t = [];
      for (let i = 0; i < 30; i++) {
        const a = performance.now();
        R.render.renderNow();
        R.render.readFrame(); // waits for the GPU (the frame is read back)
        t.push(performance.now() - a);
      }
      t.sort((x, y) => x - y);
      return { gpu: R.render.gpu, tier: R.gl.tier, p50: t[15], p95: t[28] };
    });
    rows.push(r);
  }
  await page.goto(`${page0}?${LOOKS.golden}&gl=off#/room`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
  rows.push(
    await page.evaluate(() => {
      const R = window.ROOM, t = [];
      for (let i = 0; i < 30; i++) {
        const a = performance.now();
        R.render.renderNow();
        R.render.readFrame(); // waits for the GPU (the frame is read back)
        t.push(performance.now() - a);
      }
      t.sort((x, y) => x - y);
      return { gpu: R.render.gpu, tier: "canvas2d", p50: t[15], p95: t[28] };
    }),
  );
  writeFileSync(join(caps, "fps.json"), JSON.stringify(rows, null, 1));
  console.log(rows);
}
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
