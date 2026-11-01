#!/usr/bin/env node
/**
 * Room v3.5 skill view harness (P3; PLAN 3.5, D1-FINAL 6). Frozen clock, file:// prototype, pinned GPU tier.
 *
 *   node scripts/room-v35-skill.mjs <mode> [--root <prototype dir>] [--out <dir>] [--tier high|low|off] [--q "<query>"]
 *
 * Modes
 *   stills  settled skill view of library.bookshelf at 1280x800, 1440x900, 1920x1080, 390x844@3 at sunset (el 4),
 *           night and rain; plus gl=off at 1280. PNG per case.
 *   lift    contact sheet of a LIFT and a DROP (every 40 ms) at 1280x800: per frame hero rect, k, heroK, selK.
 *   ac      numbers: AC1 camera unchanged, AC2 luma step outside the hero rect per frame (noise floor subtracted),
 *           AC7 integer rect / monotonic k / top-left % k at rest, AC9 drop lands on the pre-click frame,
 *           AC6 frame time open vs closed (SwiftShader), AC10 reduced motion.
 * --tier off runs the Canvas2D path (gl=off). Heavy (Chromium + SwiftShader): run under flock S/heavy.lock.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const argv = process.argv.slice(2);
const mode = argv[0] || 'stills';
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const ROOT = path.resolve(opt('root', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs/redesign/room-prototype')));
const OUT = path.resolve(opt('out', 'room-v35-skill-out'));
const TIER = opt('tier', 'high');
const EXTRA = opt('q', '');
const ITEM = opt('item', 'library.bookshelf');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- PNG */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/* ---------------------------------------------------------------- browser */
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(w, h, dpr = 1, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: dpr > 1, hasTouch: dpr > 1, ...opts });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return page;
}
function query(q) {
  const tier = TIER === 'off' ? 'gl=off' : `gltier=${TIER}`;
  return `?${tier}&p=85&seed=1&weather=clear&${q}${EXTRA ? '&' + EXTRA : ''}`;
}
async function open(page, q, hash = '#/room') {
  await page.goto(`file://${ROOT}/index.html${query(q)}${hash}`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug && window.ROOM.render && window.ROOM.render.view, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.ROOM.debug.advance(16);
    window.ROOM.debug.advance(16);
  });
}
async function grab(page) {
  return page.evaluate(() => {
    const f = window.ROOM.debug.readFrame();
    return { w: f.width, h: f.height, data: Array.from(f.data) };
  });
}
function save(name, fr) {
  png(path.join(OUT, name + '.png'), fr.w, fr.h, Uint8Array.from(fr.data));
}
const skillState = (page) => page.evaluate(() => window.ROOM.debug.state.skill);
const advance = (page, ms) => page.evaluate((m) => window.ROOM.debug.advance(m), ms);
async function openSkill(page, id) {
  await page.evaluate((i) => window.ROOM.skill.open(i, { source: 'click' }), id);
}
async function settle(page, ms = 800) {
  for (let t = 0; t < ms; t += 40) await advance(page, 40);
}
function luma(d, i) {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}
/** Mean luma (0..255) of the frame outside rect r (device px; null = whole frame). */
function meanOutside(fr, r) {
  let s = 0, n = 0;
  for (let y = 0; y < fr.h; y++) {
    for (let x = 0; x < fr.w; x++) {
      if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      s += luma(fr.data, (y * fr.w + x) * 4);
      n++;
    }
  }
  return s / Math.max(1, n);
}
function meanAbsIn(a, b, r) {
  let s = 0, n = 0;
  for (let y = Math.max(0, r.y); y < Math.min(a.h, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(a.w, r.x + r.w); x++) {
      const i = (y * a.w + x) * 4;
      for (let c = 0; c < 3; c++) s += Math.abs(a.data[i + c] - b.data[i + c]);
      n += 3;
    }
  }
  return s / Math.max(1, n);
}

const report = { mode, root: ROOT, tier: TIER, item: ITEM, results: [] };
const STATES = { sunset: 'el=4', night: 'night=1&el=-25', rain: 'el=40&weather=rain&precip=60' };

if (mode === 'stills') {
  const cases = [
    [1280, 800, 1], [1440, 900, 1], [1920, 1080, 1], [390, 844, 3],
  ];
  for (const [w, h, d] of cases) {
    const page = await newPage(w, h, d);
    for (const [sn, q] of Object.entries(STATES)) {
      if (w !== 1280 && sn !== 'sunset' && !(w === 390 && sn === 'night')) continue;
      await open(page, q);
      await openSkill(page, ITEM);
      await settle(page);
      const st = await skillState(page);
      const fr = await grab(page);
      const name = `${ITEM}-${w}x${h}@${d}-${sn}-${TIER}`;
      save(name, fr);
      const r = { name, rect: st && st.rectDev, k: st && st.k, phase: st && st.phase };
      report.results.push(r);
      console.log(JSON.stringify(r));
    }
    await page.close();
  }
}

if (mode === 'lift') {
  const page = await newPage(1280, 800);
  await open(page, STATES.sunset);
  const frames = [];
  const before = await grab(page);
  frames.push(before);
  await openSkill(page, ITEM);
  const seq = [];
  for (let t = 0; t <= 440; t += 40) {
    await advance(page, t === 0 ? 0 : 40);
    seq.push({ t, ...(await skillState(page)) });
    frames.push(await grab(page));
  }
  await page.evaluate(() => window.ROOM.skill.close());
  for (let t = 0; t <= 360; t += 40) {
    await advance(page, t === 0 ? 0 : 40);
    seq.push({ t: 'drop+' + t, ...(await skillState(page)) });
    frames.push(await grab(page));
  }
  // contact sheet: frames at 1/4 scale, 4 per row
  const s = 4, cw = Math.floor(before.w / s), ch = Math.floor(before.h / s), cols = 4, rows = Math.ceil(frames.length / cols);
  const sheet = new Uint8Array(cw * cols * ch * rows * 4);
  frames.forEach((fr, n) => {
    const ox = (n % cols) * cw, oy = Math.floor(n / cols) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = ((y * s) * fr.w + x * s) * 4, di = ((oy + y) * cw * cols + ox + x) * 4;
      sheet[di] = fr.data[si];
      sheet[di + 1] = fr.data[si + 1];
      sheet[di + 2] = fr.data[si + 2];
      sheet[di + 3] = 255;
    }
  });
  png(path.join(OUT, `lift-sheet-${TIER}.png`), cw * cols, ch * rows, sheet);
  seq.forEach((x) => console.log(JSON.stringify({ t: x.t, phase: x.phase, rect: x.rectDev, k: x.k, heroK: x.heroK, selK: x.selK, haloK: x.haloK })));
  report.results.push({ seq });
}

if (mode === 'ac') {
  const page = await newPage(1280, 800);
  // noise floor: two rest frames 40 ms apart (grain, ambient)
  await open(page, STATES.sunset);
  const r0 = await grab(page);
  await advance(page, 40);
  const r1 = await grab(page);
  const noise = Math.abs(meanOutside(r0, null) - meanOutside(r1, null));
  const camBefore = await page.evaluate(() => JSON.stringify(window.ROOM.debug.state.camera));
  await openSkill(page, ITEM);
  const cams = [];
  const steps = [];
  let prev = r1;
  const ks = [];
  let prevRect = null;
  for (let t = 0; t <= 480; t += 40) {
    await advance(page, t === 0 ? 0 : 40);
    const st = await skillState(page);
    const fr = await grab(page);
    cams.push(await page.evaluate(() => JSON.stringify(window.ROOM.debug.state.camera)));
    // AC2: luma step outside the union of the hero rects of both frames (plus the halo: excluded by the rect grow)
    const rr = st && st.rectDev;
    const ex = rr ? { x: rr.x, y: rr.y, w: rr.w, h: rr.h } : null;
    const u = prevRect && ex ? { x: Math.min(prevRect.x, ex.x), y: Math.min(prevRect.y, ex.y), w: Math.max(prevRect.x + prevRect.w, ex.x + ex.w) - Math.min(prevRect.x, ex.x), h: Math.max(prevRect.y + prevRect.h, ex.y + ex.h) - Math.min(prevRect.y, ex.y) } : ex;
    const a = meanOutside(prev, u), b = meanOutside(fr, u);
    steps.push(+((Math.abs(b - a) / Math.max(1, a)) * 100).toFixed(2));
    if (st) ks.push({ k: st.k, x: st.rectDev.x, y: st.rectDev.y, w: st.rectDev.w, h: st.rectDev.h });
    prev = fr;
    prevRect = ex;
  }
  const settledSt = await skillState(page);
  const camOpen = cams.every((c) => c === camBefore);
  // AC7
  const kMono = ks.every((v, i) => i === 0 || v.k >= ks[i - 1].k);
  const intOk = ks.every((v) => [v.x, v.y, v.w, v.h, v.k].every(Number.isInteger));
  const tl = settledSt ? settledSt.rectDev.x % settledSt.k === 0 && settledSt.rectDev.y % settledSt.k === 0 : false;
  // AC9: close and compare the item area with the pre-click frame
  await page.evaluate(() => window.ROOM.skill.close());
  const cams2 = [];
  for (let t = 0; t <= 600; t += 40) {
    await advance(page, 40);
    cams2.push(await page.evaluate(() => JSON.stringify(window.ROOM.debug.state.camera)));
  }
  const after = await grab(page);
  const itemRect = await page.evaluate((id) => {
    const r = window.ROOM.itemRectCss(id), d = window.ROOM.render.view.dpr;
    return r ? { x: Math.round(r.left * d), y: Math.round(r.top * d), w: Math.round(r.width * d), h: Math.round(r.height * d) } : null;
  }, ITEM);
  const dropDiff = itemRect ? meanAbsIn(r1, after, itemRect) : null;
  const restNoise = itemRect ? meanAbsIn(r0, r1, itemRect) : null;
  const res = {
    noiseLumaPct: +((noise / Math.max(1, meanOutside(r0, null))) * 100).toFixed(3),
    AC1: { camUnchangedOpen: camOpen, camUnchangedClose: cams2.every((c) => c === camBefore) },
    AC2: { maxStepPct: Math.max(...steps), steps },
    AC7: { kSeq: ks.map((v) => v.k), kMonotonic: kMono, integer: intOk, topLeftModK: tl, settled: settledSt && settledSt.rectDev },
    AC9: { itemRect, dropMeanAbs: dropDiff && +dropDiff.toFixed(3), restNoise: restNoise && +restNoise.toFixed(3) },
  };
  // AC6: frame time with the hero open vs closed (wall clock of a forced render)
  const timeIt = () => page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) window.ROOM.debug.renderNow();
    return (performance.now() - t0) / 10;
  });
  const closedMs = await timeIt();
  await openSkill(page, ITEM);
  await settle(page);
  const openMs = await timeIt();
  res.AC6 = { closedMs: +closedMs.toFixed(2), openMs: +openMs.toFixed(2), ratio: +(openMs / closedMs).toFixed(3) };
  // AC10 reduced motion: open/close are one frame each
  const p2 = await newPage(1280, 800, 1, { reducedMotion: 'reduce' });
  await open(p2, STATES.sunset);
  await openSkill(p2, ITEM);
  await advance(p2, 16);
  const a16 = await grab(p2);
  const s16 = await skillState(p2);
  await advance(p2, 784);
  const a800 = await grab(p2);
  await p2.evaluate(() => window.ROOM.skill.close());
  await advance(p2, 16);
  const c16 = await grab(p2);
  await advance(p2, 784);
  const c800 = await grab(p2);
  const full = { x: 0, y: 0, w: a16.w, h: a16.h };
  res.AC10 = { openDiff16v800: +meanAbsIn(a16, a800, full).toFixed(3), closeDiff16v800: +meanAbsIn(c16, c800, full).toFixed(3), phase16: s16 && s16.phase };
  report.results.push(res);
  console.log(JSON.stringify(res, null, 1));
}

report.errors = errors;
fs.writeFileSync(path.join(OUT, `report-${mode}-${TIER}.json`), JSON.stringify(report, null, 1));
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 10));
await browser.close();
