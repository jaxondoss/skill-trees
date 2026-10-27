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
