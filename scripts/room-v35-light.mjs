#!/usr/bin/env node
/**
 * Room v3.5 light harness (P2; PLAN 3.4). Pinned GPU tier, frozen clock, file:// prototype.
 *
 *   node scripts/room-v35-light.mjs <mode> [--root <prototype dir>] [--out <dir>] [--tier high|low] [--q "<extra query>"]
 *
 * Modes
 *   stills   4 walls at el 4 / -25 / rain: PNG per wall and state (also run with --root on a baseline copy).
 *   framing  framing independence: each wall at rest under two viewports (different zoom and origin); the colours
 *            of every world pixel both frames show are compared (mean abs diff, per channel 0..255), plus the
 *            same-viewport noise floor. Also the data-light set ("front-10" present) with hover on and off.
 *   crisp    T5 on rest frames with light=albedo: every pixel in the palette, every z x z block uniform.
 *   hero     forced hero (ROOM.debug.forceHero via opts injection; skill.js untouched): hero mean L* vs albedo L*,
 *            hero / ring luma, k integer, pixels in palette under light=albedo, at el 4, 40, -25, night, rain.
 *
 * Heavy (Chromium + SwiftShader): run under flock S/heavy.lock. Writes PNG + JSON into --out.
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
const OUT = path.resolve(opt('out', 'room-v35-light-out'));
const TIER = opt('tier', 'high');
const EXTRA = opt('q', '');
const ONLY = opt('only', '');
const BASE = opt('base', ''); // stills: also render this prototype dir and report the mean abs diff
fs.mkdirSync(OUT, { recursive: true });

const WALLS = { front: '#/room', right: '#/room/right', back: '#/room/back', left: '#/room/left' };
const STATES = { el4: 'el=4', 'el-25': 'el=-25', rain: 'el=40&weather=rain&precip=60', el40: 'el=40', night: 'night=1&el=-25' };

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
async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return page;
}
async function open(page, q, hash, root = ROOT) {
  const url = `file://${root}/index.html?gltier=${TIER}&p=85&seed=1&weather=clear&${q}${EXTRA ? '&' + EXTRA : ''}${hash}`;
  await page.goto(url);
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
function meanAbs(a, b) {
  let s = 0, n = 0, mx = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      s += d;
      n++;
      if (d > mx) mx = d;
    }
  }
  return { mean: +(s / Math.max(1, n)).toFixed(3), max: mx };
}

/** In-page: the world-pixel colours of rect R (world px) sampled at the centre of each world px. */
const WORLD_SAMPLE = `(R) => {
  const ROOM = window.ROOM, cam = ROOM.render.restCamera(), view = ROOM.render.view, org = ROOM.camera.origin(cam, view);
  const fr = ROOM.debug.readFrame(), z = cam.z, out = [];
  for (let wy = R.y; wy < R.y + R.h; wy++) for (let wx = R.x; wx < R.x + R.w; wx++) {
    const dx = Math.floor(wx * z - org.ox + z / 2), dy = Math.floor(wy * z - org.oy + z / 2);
    if (dx < 0 || dy < 0 || dx >= fr.width || dy >= fr.height) { out.push(-1, -1, -1); continue; }
    const i = (dy * fr.width + dx) * 4; out.push(fr.data[i], fr.data[i + 1], fr.data[i + 2]);
  }
  return out;
}`;
const VISIBLE = `() => { const ROOM = window.ROOM, cam = ROOM.render.restCamera(), v = ROOM.render.view, o = ROOM.camera.origin(cam, v);
  return { x0: Math.ceil(o.ox / cam.z), y0: Math.ceil(o.oy / cam.z), x1: Math.floor((o.ox + v.Wd) / cam.z) - 1, y1: Math.floor((o.oy + v.Hd) / cam.z) - 1, z: cam.z }; }`;

const report = { mode, root: ROOT, tier: TIER, results: [] };

/* ---------------------------------------------------------------- modes */
if (mode === 'stills') {
  const page = await newPage(1280, 800);
  for (const [sn, q] of Object.entries(STATES)) {
    if (sn === 'el40' || sn === 'night') continue;
    for (const [wn, hash] of Object.entries(WALLS)) {
      if (ONLY && !ONLY.split(',').includes(wn)) continue;
      await open(page, q, hash);
      const fr = await grab(page);
      save(`${wn}-${sn}`, fr);
      const r = { wall: wn, state: sn };
      if (BASE) {
        await open(page, q, hash, BASE);
        const fb = await grab(page);
        save(`${wn}-${sn}-base`, fb);
        r.vsBase = meanAbs(fr.data, fb.data);
      }
      report.results.push(r);
      console.log(JSON.stringify(r));
    }
  }
}

if (mode === 'framing') {
  const A = await newPage(1280, 800), B = await newPage(1920, 1080);
  for (const [wn, hash] of Object.entries(WALLS)) {
    for (const sn of ['el4', 'el-25']) {
      await open(A, STATES[sn], hash);
      await open(B, STATES[sn], hash);
      const va = await A.evaluate(VISIBLE), vb = await B.evaluate(VISIBLE);
      const R = { x: Math.max(va.x0, vb.x0) + 2, y: Math.max(va.y0, vb.y0) + 2 };
      R.w = Math.min(va.x1, vb.x1) - 2 - R.x;
      R.h = Math.min(va.y1, vb.y1) - 2 - R.y;
      const a = await A.evaluate(`(${WORLD_SAMPLE})(${JSON.stringify(R)})`);
      const b = await B.evaluate(`(${WORLD_SAMPLE})(${JSON.stringify(R)})`);
      // noise floor: the same page re-rendered after advancing the frozen clock by one grain step
      await A.evaluate(() => window.ROOM.debug.advance(84));
      const a2 = await A.evaluate(`(${WORLD_SAMPLE})(${JSON.stringify(R)})`);
      let s = 0, n = 0, s2 = 0, big = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] < 0 || b[i] < 0) continue;
        const d = Math.abs(a[i] - b[i]);
        s += d;
        s2 += Math.abs(a[i] - a2[i]);
        n++;
        if (d > 24) big++;
      }
      // diff image (world res): |a - b| x 4
      const img = new Uint8Array(R.w * R.h * 4);
      for (let p = 0; p < R.w * R.h; p++) {
        const d = Math.min(255, 4 * Math.max(Math.abs(a[p * 3] - b[p * 3]), Math.abs(a[p * 3 + 1] - b[p * 3 + 1]), Math.abs(a[p * 3 + 2] - b[p * 3 + 2])));
        img.set([d, d, d, 255], p * 4);
      }
      png(path.join(OUT, `framing-${wn}-${sn}.png`), R.w, R.h, img);
      const st = await A.evaluate(() => window.ROOM.gl.stats());
      report.results.push({ wall: wn, state: sn, rect: R, zA: va.z, zB: vb.z, meanAbs: +(s / n).toFixed(3), noise: +(s2 / n).toFixed(3), over24: +(big / n).toFixed(4), lights: st.lights, lightIds: st.lightIds });
      console.log(wn, sn, 'z', va.z, vb.z, 'meanAbs', (s / n).toFixed(3), 'noise', (s2 / n).toFixed(3), '>24', (big / n).toFixed(4));
    }
  }
  // hover does not evict data lights (front-10 stays)
  await open(A, STATES.el4, WALLS.front);
  const before = await A.evaluate(() => window.ROOM.gl.stats().lightIds);
  const hov = await A.evaluate(() => {
    const ROOM = window.ROOM, d = ROOM.render.drawables.find((x) => x.hotspot && x.item.hit);
    const g = ROOM.gl.frame;
    ROOM.gl.frame = (f, o) => g(f, Object.assign(o, { hover: { x: d.item.hit[0], y: d.item.hit[1], w: d.item.hit[2], h: d.item.hit[3] } }));
    ROOM.debug.advance(16);
    ROOM.gl.frame = g;
    return { id: d.id, ids: ROOM.gl.stats().lightIds, reserved: ROOM.gl.stats().reserved };
  });
  const r = { hoverId: hov.id, before, after: hov.ids, reserved: hov.reserved, front10Before: before.includes('front-10'), front10After: hov.ids.includes('front-10'), same: JSON.stringify(before) === JSON.stringify(hov.ids) };
  report.results.push({ hover: r });
  console.log('hover', JSON.stringify(r));
}

if (mode === 'crisp') {
  const page = await newPage(1280, 800);
  for (const [wn, hash] of Object.entries(WALLS)) {
    await open(page, 'el=4&light=albedo', hash);
    const res = await page.evaluate(() => {
      const ROOM = window.ROOM, fr = ROOM.debug.readFrame(), cam = ROOM.render.restCamera(), v = ROOM.render.view, o = ROOM.camera.origin(cam, v), z = cam.z;
      const pal = new Set((ROOM.art.palette.colors || []).map((c) => (Array.isArray(c) ? c[1] : c).toLowerCase()));
      const hex = (i) => '#' + [0, 1, 2].map((k) => fr.data[i + k].toString(16).padStart(2, '0')).join('');
      let off = 0, n = 0, nonUni = 0, blocks = 0;
      for (let y = 0; y < fr.height; y++) for (let x = 0; x < fr.width; x++) {
        n++;
        if (!pal.has(hex((y * fr.width + x) * 4))) off++;
      }
      // z x z blocks aligned to the world grid must be uniform
      const bx0 = (z - (o.ox % z)) % z, by0 = (z - (o.oy % z)) % z;
      for (let y = by0; y + z <= fr.height; y += z) for (let x = bx0; x + z <= fr.width; x += z) {
        blocks++;
        const i0 = (y * fr.width + x) * 4;
        let ok = true;
        for (let yy = 0; yy < z && ok; yy++) for (let xx = 0; xx < z; xx++) {
          const i = ((y + yy) * fr.width + x + xx) * 4;
          if (fr.data[i] !== fr.data[i0] || fr.data[i + 1] !== fr.data[i0 + 1] || fr.data[i + 2] !== fr.data[i0 + 2]) { ok = false; break; }
        }
        if (!ok) nonUni++;
      }
      return { z, offPalette: off, pixels: n, blocks, nonUniform: nonUni };
    });
    report.results.push({ wall: wn, ...res });
    console.log(wn, JSON.stringify(res));
  }
}

if (mode === 'hero') {
  // Force a hero: the room sprite of a hotspot of the wall (the isolate fallback) in the atlas rows, lit in the same
  // gl.frame; dim 1, halo at the world point under the hero. Measures hero L* vs albedo L* and hero / ring luma.
  const FORCE = `(cfg) => {
    const ROOM = window.ROOM, d = ROOM.render.drawables.find((x) => x.id === cfg.id) || ROOM.render.drawables.find((x) => x.hotspot);
    const img = d.img, A = img.h + 8;
    ROOM.skill.atlasRows = () => A;
    const g = ROOM.gl.__orig || ROOM.gl.frame; ROOM.gl.__orig = g;
    window.__hero = { id: d.id, w: img.w, h: img.h };
    ROOM.gl.frame = (f, o) => {
      const at = { y: f.h + 4, w: img.w, h: img.h, off: [d.x, d.y] };
      if (f.buf.length < f.w * (at.y + at.h)) return g(f, o);
      for (let y = f.h; y < f.h + A; y++) for (let x = 0; x < f.w; x++) { const i = y * f.w + x; f.buf[i] = 0; f.aux[i * 3] = 0; f.aux[i * 3 + 1] = 0; f.aux[i * 3 + 2] = 0; }
      ROOM.render.blit(f.buf, f.w, f.h + A, img, 0, at.y, f.lutA, f.lutB, f.step, 0, 0);
      ROOM.render.blitAux({ aux: f.aux, w: f.w, h: f.h + A, y0: 0 }, d, img, 0, at.y);
      for (let y = at.y; y < at.y + at.h; y++) for (let x = 0; x < at.w; x++) { const i = (y * f.w + x) * 3; if (f.aux[i] || f.aux[i + 1] || f.aux[i + 2]) f.aux[i + 1] |= 64; }
      const z = f.z, k = cfg.k || z + 1, hx = cfg.x, hy = cfg.y;
      const wx = (hx + img.w * k / 2 + f.org.ox) / z, wy = (hy + img.h * k / 2 + f.org.oy) / z;
      const r = 0.62 * Math.max(img.w, img.h) * k / z;
      window.__hero.rect = { x: hx, y: hy, w: img.w * k, h: img.h * k, k };
      return g(f, Object.assign(o, { dim: cfg.dim, atlas: at, hero: { x: hx, y: hy, k, K: 1, selK: cfg.selK }, halo: cfg.halo ? { cx: wx, cy: wy, r, k: 1,
        pool: { cx: wx, cy: wy + (img.h * k / 2 + 7 * k) / z, rx: 0.42 * img.w * k / z, ry: 3 * k / z }, shadow: { cx: wx, cy: wy + (img.h * k / 2 + 7 * k) / z, rx: 0.3 * img.w * k / z, ry: 1.5 * k / z } } : null }));
    };
    ROOM.render.layout && ROOM.render.layout();
    ROOM.debug.advance(16); ROOM.debug.advance(16);
    return window.__hero;
  }`;
  const MEASURE = `() => {
    const ROOM = window.ROOM, fr = ROOM.debug.readFrame(), H = window.__hero, R = H.rect, k = R.k;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const Y = (i) => 0.2126 * lin(fr.data[i]) + 0.7152 * lin(fr.data[i + 1]) + 0.0722 * lin(fr.data[i + 2]);
    const Ls = (y) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
    const d = ROOM.render.drawables.find((x) => x.id === H.id), img = d.img;
    let sY = 0, sL = 0, n = 0, ring = 0, rn = 0;
    for (let ly = 0; ly < img.h; ly++) for (let lx = 0; lx < img.w; lx++) {
      if (img.px[ly * img.w + lx] === 255) continue;
      const x = R.x + lx * k + (k >> 1), y = R.y + ly * k + (k >> 1);
      if (x < 0 || y < 0 || x >= fr.width || y >= fr.height) continue;
      const yy = Y((y * fr.width + x) * 4); sY += yy; sL += Ls(yy); n++;
    }
    for (let y = R.y - 20; y < R.y + R.h + 20; y++) for (let x = R.x - 20; x < R.x + R.w + 20; x++) {
      if (x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h) continue;
      if (x < 0 || y < 0 || x >= fr.width || y >= fr.height) continue;
      ring += Y((y * fr.width + x) * 4); rn++;
    }
    return { id: H.id, n, meanY: sY / n, meanL: sL / n, ringY: ring / rn, stats: ROOM.gl.stats().hero };
  }`;
  const page = await newPage(1280, 800);
  const items = (opt('items', 'front:,right:,back:')).split(',');
  for (const it of items) {
    const [wn, id] = it.split(':');
    for (const sn of ['el4', 'el40', 'el-25', 'night', 'rain']) {
      const cfg = { id, x: 180, y: 160, dim: 1, selK: 1, halo: true };
      await open(page, STATES[sn] + '&light=albedo', WALLS[wn]);
      const h0 = await page.evaluate(`(${FORCE})(${JSON.stringify(cfg)})`);
      const alb = await page.evaluate(MEASURE);
      await open(page, STATES[sn], WALLS[wn]);
      await page.evaluate(`(${FORCE})(${JSON.stringify(cfg)})`);
      const lit = await page.evaluate(MEASURE);
      save(`hero-${wn}-${h0.id}-${sn}`, await grab(page));
      // the same item in the room, not selected (for the "follows the room" ratio)
      const r = { wall: wn, id: h0.id, state: sn, albL: +alb.meanL.toFixed(2), heroL: +lit.meanL.toFixed(2), dL: +(lit.meanL - alb.meanL).toFixed(2), ratioRing: +(lit.meanY / lit.ringY).toFixed(2), hero: lit.stats };
      report.results.push(r);
      console.log(JSON.stringify(r));
    }
  }
}

report.errors = errors;
fs.writeFileSync(path.join(OUT, `${mode}.json`), JSON.stringify(report, null, 1));
if (errors.length) console.log('errors', errors.slice(0, 5));
await browser.close();
