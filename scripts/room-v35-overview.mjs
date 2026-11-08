#!/usr/bin/env node
/**
 * Room v3.5 overview harness (P4; PLAN 3.6 step 5, D2-FINAL 5 AC5 / AC7 / AC8). Frozen clock, file:// prototype.
 *
 *   node scripts/room-v35-overview.mjs <mode> [--root <prototype dir>] [--out <dir>] [--tier high|low]
 *
 * Modes
 *   stills  the overview at 1280x800, 1920x1080, 1440x900 and phone 390x844@3 (sunset, night, rain, gl=off), page
 *           screenshots with the chrome, plus the front wall rest at the same states for comparison.
 *   crisp   AC5 / T5: light=albedo, every device pixel of the diorama a palette colour and every z x z block uniform;
 *           the diorama does not overlap the title, #nav-up, the strip or the plates (four viewports).
 *   light   AC7: per hotspot, the twin's mean L* in the overview over the item's mean L* on its wall at rest (median
 *           0.8..1.25), mean hue shift, and the whole-frame mean luma vs the front wall (within 12 %); el 4 and -25,
 *           GPU and gl=off.
 *   rise    a RISE contact sheet (front wall -> overview), frames every 40 ms of the 520 ms move.
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
const OUT = path.resolve(opt('out', 'room-v35-overview-out'));
const TIER = opt('tier', 'high');
fs.mkdirSync(OUT, { recursive: true });

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
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
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

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(vw, vh, dpr = 1, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}
async function open(page, q, hash) {
  const gl = /gl=off/.test(q) ? '' : `gltier=${TIER}&`;
  await page.goto(`file://${ROOT}/index.html?${gl}p=85&seed=1&weather=clear&motion=0&${q}${hash}`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug && window.ROOM.render && window.ROOM.render.view, null, { timeout: 90000 });
  await page.waitForFunction(() => !window.ROOM.nav || !window.ROOM.nav.busy, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16);
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.ROOM.debug.advance(16));
}
const grab = (page) => page.evaluate(() => {
  const f = window.ROOM.debug.readFrame();
  return { w: f.width, h: f.height, data: Array.from(f.data) };
});
const save = (name, fr) => png(path.join(OUT, name + '.png'), fr.w, fr.h, Uint8Array.from(fr.data));
const STATES = { sunset: 'el=4', night: 'night=1&el=-25', rain: 'el=40&weather=rain&precip=60', gloff: 'el=4&gl=off' };
const VIEWPORTS = { '1280': [1280, 800, 1, false], '1920': [1920, 1080, 1, false], '1440': [1440, 900, 1, false], phone: [390, 844, 3, true] };

/** In-page: the diorama's device rect and the chrome rects (CSS px). */
const LAYOUT = `() => {
  const R = window.ROOM.render, v = R.view, cam = R.restCamera(), org = window.ROOM.camera.origin(cam, v);
  const t = window.ROOM.art.zones.views.top, c = Array.isArray(t.core) ? t.core : [0, 0, t.core.w, t.core.h];
  const d = { x: (c[0] * cam.z - org.ox) / v.dpr, y: (c[1] * cam.z - org.oy) / v.dpr, w: c[2] * cam.z / v.dpr, h: c[3] * cam.z / v.dpr };
  const rect = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null;
    const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, s } : null; };
  const chrome = ['#nav-up', '#zone-title', '.strip', '#strip', '#overview-hint', '#overview-listbtn'].map(rect).filter(Boolean);
  return { z: cam.z, dpr: v.dpr, diorama: d, chrome, scrollW: document.scrollingElement.scrollWidth, innerW: innerWidth };
}`;
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const report = { mode, errors };
if (mode === 'stills') {
  for (const [vk, [w, h, dpr, mob]] of Object.entries(VIEWPORTS)) {
    const page = await newPage(w, h, dpr, mob);
    for (const [sk, q] of Object.entries(STATES)) {
      if (vk !== '1280' && vk !== 'phone' && sk !== 'sunset') continue;
      await open(page, q, '#/room/overview');
      await page.screenshot({ path: path.join(OUT, `overview-${vk}-${sk}.png`) });
      if (vk === '1280') {
        await open(page, q, '#/room');
        await page.screenshot({ path: path.join(OUT, `front-${vk}-${sk}.png`) });
      }
    }
    await page.context().close();
  }
} else if (mode === 'crisp') {
  report.crisp = {};
  for (const [vk, [w, h, dpr, mob]] of Object.entries(VIEWPORTS)) {
    const page = await newPage(w, h, dpr, mob);
    await open(page, 'el=4&light=albedo', '#/room/overview');
    const r = await page.evaluate(`(${LAYOUT})()`);
    const res = await page.evaluate((L) => {
      const ROOM = window.ROOM, f = ROOM.debug.readFrame(), z = L.z, dpr = L.dpr;
      const pal = new Set((ROOM.art.palette.colors || []).map((c) => c[1].toLowerCase()));
      const hex = (i) => '#' + [0, 1, 2].map((k) => f.data[i + k].toString(16).padStart(2, '0')).join('');
      const x0 = Math.round(L.diorama.x * dpr), y0 = Math.round(L.diorama.y * dpr);
      const x1 = x0 + Math.round(L.diorama.w * dpr), y1 = y0 + Math.round(L.diorama.h * dpr);
      let off = 0, blocks = 0, bad = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * f.width + x) * 4;
        n++;
        if (!pal.has(hex(i))) off++;
      }
      for (let by = y0; by + z <= y1; by += z) for (let bx = x0; bx + z <= x1; bx += z) {
        blocks++;
        const i0 = (by * f.width + bx) * 4;
        let ok = true;
        for (let dy = 0; dy < z && ok; dy++) for (let dx = 0; dx < z; dx++) {
          const i = ((by + dy) * f.width + bx + dx) * 4;
          if (f.data[i] !== f.data[i0] || f.data[i + 1] !== f.data[i0 + 1] || f.data[i + 2] !== f.data[i0 + 2]) { ok = false; break; }
        }
        if (!ok) bad++;
      }
      return { pixels: n, offPalette: off, blocks, nonUniform: bad };
    }, r);
    res.overlaps = r.chrome.filter((c) => overlap(c, r.diorama)).map((c) => c.s);
    res.z = r.z;
    res.diorama = r.diorama;
    res.hScroll = r.scrollW > r.innerW;
    report.crisp[vk] = res;
    await page.context().close();
  }
} else if (mode === 'light') {
  report.light = {};
  const page = await newPage(1280, 800);
  const MEAN = `(ids) => {
    const ROOM = window.ROOM, R = ROOM.render, cam = R.restCamera(), org = ROOM.camera.origin(cam, R.view), f = ROOM.debug.readFrame(), z = cam.z;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const Lstar = (r, g, b) => { const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; };
    const out = {}; let tot = 0, tn = 0;
    for (let i = 0; i < f.data.length; i += 16) { tot += 0.299 * f.data[i] + 0.587 * f.data[i + 1] + 0.114 * f.data[i + 2]; tn++; }
    out._luma = tot / tn;
    R.drawables.forEach((d) => {
      const id = d.item.of || d.id;
      if (!d.hotspot || !ids.includes(id)) return;
      const h = d.hit; let s = 0, n = 0, rs = 0, gs = 0, bs = 0;
      for (let wy = h[1]; wy < h[1] + h[3]; wy++) for (let wx = h[0]; wx < h[0] + h[2]; wx++) {
        const dx = Math.floor(wx * z - org.ox + z / 2), dy = Math.floor(wy * z - org.oy + z / 2);
        if (dx < 0 || dy < 0 || dx >= f.width || dy >= f.height) continue;
        const i = (dy * f.width + dx) * 4; s += Lstar(f.data[i], f.data[i + 1], f.data[i + 2]); rs += f.data[i]; gs += f.data[i + 1]; bs += f.data[i + 2]; n++;
      }
      if (n) out[id] = { L: s / n, rgb: [rs / n, gs / n, bs / n] };
    });
    return out;
  }`;
  const hue = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const [sk, q] of Object.entries({ el4: 'el=4', 'el-25': 'el=-25', 'el4-gloff': 'el=4&gl=off', 'el-25-gloff': 'el=-25&gl=off' })) {
    await open(page, q, '#/room/overview');
    const ids = await page.evaluate(() => window.ROOM.art.items.filter((i) => i.view === 'top' && i.kind === 'hotspot').map((i) => i.of));
    const ov = await page.evaluate(`(${MEAN})(${JSON.stringify(ids)})`);
    const room = {};
    for (const [w, hash] of Object.entries({ front: '#/room', right: '#/room/right', back: '#/room/back', left: '#/room/left' })) {
      await open(page, q, hash);
      const m = await page.evaluate(`(${MEAN})(${JSON.stringify(ids)})`);
      if (w === 'front') room._luma = m._luma;
      for (const k of Object.keys(m)) if (k !== '_luma') room[k] = m[k];
    }
    const ratios = [], hues = [];
    for (const id of ids) {
      if (!ov[id] || !room[id]) continue;
      ratios.push(ov[id].L / Math.max(1, room[id].L));
      let dh = Math.abs(hue(ov[id].rgb) - hue(room[id].rgb));
      hues.push(Math.min(dh, 360 - dh));
    }
    ratios.sort((a, b) => a - b);
    hues.sort((a, b) => a - b);
    report.light[sk] = {
      n: ratios.length, medianRatio: +ratios[ratios.length >> 1].toFixed(3), medianHue: +hues[hues.length >> 1].toFixed(1),
      lumaOverview: +ov._luma.toFixed(1), lumaFront: +room._luma.toFixed(1), lumaRel: +(ov._luma / room._luma - 1).toFixed(3),
    };
  }
} else if (mode === 'rise') {
  const page = await newPage(1280, 800);
  await page.goto(`file://${ROOT}/index.html?gltier=${TIER}&p=85&seed=1&weather=clear&el=4#/room`);
  await page.waitForFunction(() => window.ROOM && window.ROOM.debug && window.ROOM.nav && !window.ROOM.nav.busy, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.ROOM.debug.freeze();
    window.ROOM.debug.advance(16);
  });
  const frames = [];
  await page.evaluate(() => window.ROOM.nav.up());
  for (let t = 0; t <= 560; t += 40) {
    frames.push(await grab(page));
    await page.evaluate(() => window.ROOM.debug.advance(40));
  }
  const s = 4, cw = Math.floor(frames[0].w / s), ch = Math.floor(frames[0].h / s), cols = 5, rows = Math.ceil(frames.length / cols);
  const sheet = new Uint8Array(cw * cols * ch * rows * 4);
  frames.forEach((f, k) => {
    const ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y * s) * f.w + x * s) * 4, o = ((oy + y) * cw * cols + ox + x) * 4;
      sheet[o] = f.data[i]; sheet[o + 1] = f.data[i + 1]; sheet[o + 2] = f.data[i + 2]; sheet[o + 3] = 255;
    }
  });
  png(path.join(OUT, 'rise-sheet.png'), cw * cols, ch * rows, sheet);
  save('rise-last', frames[frames.length - 1]);
}
await browser.close();
fs.writeFileSync(path.join(OUT, `overview-${mode}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
