// v3.4 phase 2 turn audit: all eight turns (four walls, both directions) at golden hour and at night.
// On the frozen clock it steps each pan in 40 ms frames and measures, inside the page:
//   startPop - mean colour change (0..255) between the rest frame and the first pan frame
//   endPop   - mean colour change between the last pan frame and the landed rest frame
//   seam     - at every hand-over column between two views, the colour step across that column divided by the
//              steps of the columns around it (1 = invisible); the worst frame counts
//   ms       - pan time
// Run: node scripts/room-turn-audit.mjs [out-dir]   (writes turns.json and the middle frame of each turn)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const root = join(import.meta.dirname, "..");
const out = process.argv[2] || join(root, "docs/redesign/room-r6/captures/turns");
mkdirSync(out, { recursive: true });
const page0 = "file://" + join(root, "docs/redesign/room-prototype/index.html");

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const TURNS = [["front", 1], ["right", 1], ["back", 1], ["left", 1], ["front", -1], ["left", -1], ["back", -1], ["right", -1]];
const LOOKS = { golden: "el=4&p=85", night: "el=-25&p=85" };

const results = [];
for (const [look, q] of Object.entries(LOOKS)) {
  for (const [from, dir] of TURNS) {
    await page.goto(`${page0}?${q}&n=${Math.random()}#/room${from === "front" ? "" : "/" + from}`);
    await page.waitForFunction(() => window.ROOM && window.ROOM.debug);
    await page.evaluate(() => document.body.classList.add("photo"));
    await page.waitForTimeout(300);
    const r = await page.evaluate((dir) => {
      const R = window.ROOM;
      R.debug.freeze();
      R.debug.advance(16);
      const read = () => R.debug.readFrame().data;
      const W = R.render.canvas.width, H = R.render.canvas.height;
      const diff = (a, b) => {
        let s = 0;
        for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        return s / (a.length / 4) / 3;
      };
      const edge = (a, x) => {
        let s = 0;
        for (let y = 0; y < H; y += 2) {
          const i = (y * W + x) * 4;
          s += Math.abs(a[i] - a[i + 4]) + Math.abs(a[i + 1] - a[i + 5]) + Math.abs(a[i + 2] - a[i + 6]);
        }
        return s / (H / 2) / 3;
      };
      const rest = read().slice();
      R.turn(dir);
      let first = null, last = null, t = 0, frames = 0, seam = 1, seamStep = 0;
      while (R.render.turning && t < 3000) {
        const a = read();
        if (!first) first = a.slice();
        last = a.slice();
        frames++;
        for (const sx of (R.debug.state.turn || {}).seams || []) {
          const x = sx - 1;
          if (x < 8 || x > W - 9) continue;
          let around = 0;
          for (const d of [-6, -5, -4, -3, 3, 4, 5, 6]) around += edge(a, x + d);
          around /= 8;
          const at = Math.max(edge(a, x - 1), edge(a, x), edge(a, x + 1));
          const k = at / Math.max(1, around);
          if (k > seam) { seam = k; seamStep = at; }
        }
        R.debug.advance(40);
        t += 40;
      }
      R.debug.advance(16);
      const landed = read();
      return {
        to: R.state.view, ms: t, frames,
        startPop: first ? +diff(rest, first).toFixed(2) : 0,
        endPop: last ? +diff(last, landed).toFixed(2) : 0,
        seam: +seam.toFixed(2), seamStep: +seamStep.toFixed(1),
      };
    }, dir);
    const row = { look, from, dir: dir > 0 ? "right" : "left", ...r };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(join(out, "turns.json"), JSON.stringify(results, null, 1));
await browser.close();
