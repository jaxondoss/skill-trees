#!/usr/bin/env node
/**
 * Room v3.5 wire harness (P5; PLAN 3.7, D3-FINAL 5). Pinned GPU tier, frozen clock, file:// prototype.
 *
 *   node scripts/room-v35-wire.mjs <mode> [--root <prototype dir>] [--out <dir>] [--tier high|low]
 *
 * Modes
 *   ac      D3 AC1 (state colour under light=albedo, contrast >= 3:1 at light=final), AC2/A7 (marks >= 70 % of the
 *           palette colour - 2 at el 4, el -25 night, rain), AC3 (0 cages at rest; hover 1 cage or hot wire; Shift
 *           one attention mark per skill), AC6 (reduced motion: frame at 16 ms == 3000 ms, rest and hover),
 *           AC7 (forced ls.skill: socket on the item, others without bit4), AC8 (hotspot button rects equal with
 *           wires on and off), AC9 (mark pass ms per rest frame), AC10 (hover keeps the data-light set).
 *   stills  4 walls x {rest, hover, shift} x {golden, night, rain, gloff} + phone zone, PNG into --out.
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
const mode = argv[0] || 'ac';
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const ROOT = path.resolve(opt('root', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs/redesign/room-prototype')));
const OUT = path.resolve(opt('out', 'room-v35-wire-out'));
const TIER = opt('tier', 'high');
const ONLY = opt('only', '');
fs.mkdirSync(OUT, { recursive: true });

const WALLS = { front: '#/room', right: '#/room/right', back: '#/room/back', left: '#/room/left' };
const STATES = { golden: 'el=4', night: 'el=-25&night=1', rain: 'el=40&weather=rain&precip=60', gloff: 'el=4&gl=off' };
const HOVER = { front: 'library.chess', right: 'computer.board', back: 'calendar.board', left: 'bed.globe' };

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
async function newPage(w, h, extra = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...extra });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return page;
}
async function open(page, q, hash) {
  const gl = /gl=off/.test(q) ? '' : `gltier=${TIER}&`;
  const weather = /weather=/.test(q) ? '' : 'weather=clear&';
  await page.goto(`file://${ROOT}/index.html?${gl}${weather}p=85&seed=1&${q}${hash}`);
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
const set = (page, fn, arg) => page.evaluate(fn, arg);
const hover = (page, id) =>
  set(page, (i) => {
    window.ROOM.render.setHover(i);
    window.ROOM.debug.advance(400);
  }, id);
const inspect = (page, on) =>
  set(page, (v) => {
    window.ROOM.state.inspect = v;
    window.ROOM.invalidate();
    window.ROOM.debug.advance(400);
  }, on);

/**
 * In-page: every wire-marked hotspot with its style and the device-space samples of its hull: wire colour, outer
 * neighbour colour, palette colour of the line. Hull pixels covered by another mark drawn later are skipped
 * (pixels shared with another item's hull or nodes, LED rects).
 */
const SAMPLE = `() => {
  const ROOM = window.ROOM, R = ROOM.render, cam = R.restCamera(), v = R.view, org = ROOM.camera.origin(cam, v);
  const fr = ROOM.debug.readFrame(), z = cam.z, offs = R.offsets, pal = ROOM.debug.palette;
  const at = (wx, wy) => { const dx = Math.floor(wx * z - org.ox + z / 2), dy = Math.floor(wy * z - org.oy + z / 2);
    if (dx < 0 || dy < 0 || dx >= fr.width || dy >= fr.height) return null; const i = (dy * fr.width + dx) * 4;
    return [fr.data[i], fr.data[i + 1], fr.data[i + 2]]; };
  const owned = new Map(), items = [];
  for (const d of R.drawables) {
    if (!d.hotspot) continue;
    const s = ROOM.wire.styleOf(d.id); if (!s) continue;
    const wd = ROOM.wire.data(d.item, d.key); if (!wd) continue;
    const ox = d.x + (offs[d.layer] || 0), oy = d.y;
    const pts = [];
    for (let i = 0; i < wd.hull.length; i += 2) { const k = (ox + wd.hull[i]) + ',' + (oy + wd.hull[i + 1]); owned.set(k, (owned.get(k) || 0) + 1); pts.push([ox + wd.hull[i], oy + wd.hull[i + 1]]); }
    const nodes = []; for (let i = 0; i < wd.nodes.length; i += 2) nodes.push([ox + wd.nodes[i], oy + wd.nodes[i + 1]]);
    const b = d.img.bounds || [0, 0, d.img.w, d.img.h];
    items.push({ id: d.id, kind: s.kind, state: s.state || null, line: s.line, lineRGB: pal[s.line], ox, oy, pts, nodes,
      cx: d.x + (offs[d.layer] || 0) + b[0] + b[2] / 2, cy: d.y + b[1] + b[3] / 2, led: d.led ? [d.led[0] + (offs[d.layer] || 0), d.led[1]] : null });
  }
  const near = (p, list, r) => list.some((n) => Math.abs(n[0] - p[0]) <= r && Math.abs(n[1] - p[1]) <= r);
  for (const it of items) {
    it.samples = [];
    for (const p of it.pts) {
      if (owned.get(p[0] + ',' + p[1]) > 1) continue;
      if (near(p, it.nodes, 1)) continue;
      if (it.led && p[0] >= it.led[0] - 1 && p[0] <= it.led[0] + 3 && p[1] >= it.led[1] - 1 && p[1] <= it.led[1] + 3) continue;
      const c = at(p[0], p[1]); if (!c) continue;
      const dxo = p[0] - it.cx, dyo = p[1] - it.cy;
      const o = Math.abs(dxo) * 1.0 > Math.abs(dyo) ? [Math.sign(dxo), 0] : [0, Math.sign(dyo) || 1];
      const n = at(p[0] + o[0], p[1] + o[1]);
      it.samples.push([c, n]);
    }
    delete it.pts;
  }
  return items;
}`;
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const report = { mode, root: ROOT, tier: TIER, ac: {}, errors };
const ok = (name, pass, detail) => {
  report.ac[name] = report.ac[name] || [];
  report.ac[name].push({ pass, ...detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail));
};

if (mode === 'ac') {
  const page = await newPage(1280, 800);
  for (const [wn, hash] of Object.entries(WALLS)) {
    if (ONLY && !ONLY.split(',').includes(wn)) continue;
    // AC1: state colour (albedo) and contrast (final)
    await open(page, 'el=4&light=albedo', hash);
    const alb = await page.evaluate(`(${SAMPLE})()`);
    await open(page, 'el=4', hash);
    const fin = await page.evaluate(`(${SAMPLE})()`);
    for (const it of alb) {
      if (it.kind !== 'wire' || it.state === 'top') continue;
      const hit = it.samples.filter((s) => s[0].every((v, k) => Math.abs(v - it.lineRGB[k]) <= 2)).length;
      const f = fin.find((x) => x.id === it.id);
      const wl = median(f.samples.map((s) => lum(s[0]))), nl = median(f.samples.filter((s) => s[1]).map((s) => lum(s[1])));
      const cr = (Math.max(wl, nl) + 0.05) / (Math.min(wl, nl) + 0.05);
      const frac = hit / Math.max(1, it.samples.length);
      ok('AC1', frac >= 0.9 && cr >= 3, { wall: wn, id: it.id, state: it.state, frac: +frac.toFixed(3), n: it.samples.length, contrast: +cr.toFixed(2) });
    }
    // AC3 rest: no cage; AC9 pass ms
    const rest = await page.evaluate(() => {
      const R = window.ROOM.render, out = { cages: 0, marks: 0, ms: [] };
      for (const d of R.drawables) {
        const s = d.hotspot && window.ROOM.wire.styleOf(d.id);
        if (s) out.marks++;
        if (s && s.kind === 'cage') out.cages++;
      }
      for (let i = 0; i < 20; i++) {
        window.ROOM.debug.advance(16);
        out.ms.push(window.ROOM.wire.lastPassMs);
      }
      return out;
    });
    ok('AC3-rest', rest.cages === 0, { wall: wn, marks: rest.marks, cages: rest.cages });
    const ms = median(rest.ms);
    ok('AC9', ms < 0.3, { wall: wn, medianMs: +ms.toFixed(3), maxMs: +Math.max(...rest.ms).toFixed(3) });
    // AC10: hover keeps the data lights
    const l0 = await page.evaluate(() => (window.ROOM.gl && window.ROOM.gl.stats ? window.ROOM.gl.stats().lightIds : null));
    await hover(page, HOVER[wn]);
    const l1 = await page.evaluate(() => (window.ROOM.gl && window.ROOM.gl.stats ? window.ROOM.gl.stats().lightIds : null));
    const hov = await page.evaluate(() => {
      const R = window.ROOM.render, kinds = {};
      for (const d of R.drawables) {
        const s = d.hotspot && window.ROOM.wire.styleOf(d.id);
        if (s && s.kind !== 'wire') kinds[d.id] = s.kind;
      }
      return kinds;
    });
    const att = Object.keys(hov);
    ok('AC3-hover', att.length === 1 && att[0] === HOVER[wn], { wall: wn, attention: hov });
    ok('AC10', JSON.stringify(l0) === JSON.stringify(l1), { wall: wn, before: l0 && l0.length, after: l1 && l1.length });
    await hover(page, null);
    await inspect(page, true);
    const sh = await page.evaluate(() => {
      const R = window.ROOM.render, out = { skills: 0, attn: 0, cages: 0 };
      for (const d of R.drawables) {
        if (!d.hotspot || !d.skill || d.skill.status !== 'active') continue;
        out.skills++;
        const s = window.ROOM.wire.styleOf(d.id);
        if (s && (s.kind === 'cage' || s.kind === 'hot')) out.attn++;
        if (s && s.kind === 'cage') out.cages++;
      }
      return out;
    });
    ok('AC3-shift', sh.attn === sh.skills, { wall: wn, ...sh });
    await inspect(page, false);
    // AC2 / A7 at three light states
    for (const [sn, q] of [['el4', 'el=4'], ['night', 'el=-25&night=1'], ['rain', 'el=40&weather=rain&precip=60']]) {
      await open(page, q, hash);
      const it = await page.evaluate(`(${SAMPLE})()`);
      let n = 0, bad = 0, worst = 1;
      for (const x of it) {
        if (x.kind !== 'wire' || x.state === 'top') continue;
        for (const s of x.samples) {
          n++;
          let r = 9;
          for (let k = 0; k < 3; k++) if (x.lineRGB[k] > 8) r = Math.min(r, (s[0][k] + 2) / x.lineRGB[k]);
          worst = Math.min(worst, r);
          if (r < 0.7) bad++;
        }
      }
      ok('AC2-A7', bad / Math.max(1, n) < 0.02, { wall: wn, state: sn, n, below70: bad, worstRatio: +worst.toFixed(3) });
    }
  }
  // AC6 reduced motion (front wall, rest and hover)
  const rm = await newPage(1280, 800, { reducedMotion: 'reduce' });
  await open(rm, 'el=4', WALLS.front);
  const same = async () =>
    rm.evaluate(() => {
      const a = window.ROOM.debug.readFrame().data;
      window.ROOM.debug.advance(2984);
      const b = window.ROOM.debug.readFrame().data;
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    });
  ok('AC6-rest', (await same()) === 0, {});
  await rm.evaluate(() => {
    window.ROOM.render.setHover('library.chess');
    window.ROOM.debug.advance(16);
  });
  ok('AC6-hover', (await same()) === 0, {});
  // AC7: forced skill view on the chess board (nav stub: ls() override)
  await open(page, 'el=4', WALLS.front);
  const ac7 = await page.evaluate(() => {
    const ROOM = window.ROOM, ls0 = ROOM.nav.ls;
    ROOM.nav.ls = () => Object.assign(ls0(), { skill: 'library.chess', dimK: 1 });
    ROOM.debug.advance(16);
    const out = {};
    for (const d of ROOM.render.drawables) {
      const s = d.hotspot && ROOM.wire.styleOf(d.id);
      if (s) out[d.id] = s.kind + (s.bit4 ? '+bit4' : '') + (s.dash ? '+dash' : '');
    }
    ROOM.nav.ls = ls0;
    return out;
  });
  const others = Object.entries(ac7).filter(([k]) => k !== 'library.chess');
  ok('AC7', ac7['library.chess'] === 'socket+bit4+dash' && others.every(([, v]) => v === 'wire'), { styles: ac7 });
  // AC8: hotspot button rects with wires on and off
  const rects = () =>
    page.evaluate(() => Array.from(document.querySelectorAll('.hs')).map((b) => [b.dataset.id, ...Object.values(b.getBoundingClientRect().toJSON()).map(Math.round)].join(',')).sort().join(';'));
  const r1 = await rects();
  await page.evaluate(() => {
    window.ROOM.wire.active = false;
    window.ROOM.debug.advance(16);
  });
  const r2 = await rects();
  await page.evaluate(() => {
    window.ROOM.wire.active = true;
    window.ROOM.debug.advance(16);
  });
  ok('AC8', r1 === r2 && r1.length > 0, { buttons: r1.split(';').length });
}

if (mode === 'stills') {
  const page = await newPage(1280, 800);
  for (const [sn, q] of Object.entries(STATES)) {
    for (const [wn, hash] of Object.entries(WALLS)) {
      if (ONLY && !ONLY.split(',').includes(wn)) continue;
      await open(page, q, hash);
      save(`${wn}-${sn}-rest`, await grab(page));
      await hover(page, HOVER[wn]);
      save(`${wn}-${sn}-hover`, await grab(page));
      await hover(page, null);
      await inspect(page, true);
      save(`${wn}-${sn}-shift`, await grab(page));
      await inspect(page, false);
    }
  }
  const phone = await newPage(390, 844, { deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await open(phone, 'el=4', '#/room/library');
  save('phone-library-rest', await grab(phone));
}

fs.writeFileSync(path.join(OUT, `${mode}.json`), JSON.stringify(report, null, 1));
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
