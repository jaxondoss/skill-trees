/* FORGE room prototype: light the engine adds on top of the art (after the lighting LUT).
 *
 * Light order, brightest first: statue gold > relic embers > skill outlines > decor.
 * - Skill item glow (R3: only today's top-priority object at rest; the art has a resting outline on every
 *   skill object): a 1 px warm-gold outline on the outer silhouette, breathing
 *   30%..70% over 2.5 s (GOLD_DK..GOLD mixed through a fixed per-pixel threshold, so every frame stays in
 *   the palette); a 3-frame shimmer (one bright pixel; a plus with a CREAM centre and pastel arms; four
 *   dim tips) at 9 fps, once every 4-7 s per item with its own offset. Hover or focus: outline at 100%
 *   (SUN) plus one sparkle. Completed today: outline and sparkles off (the LED still shows done).
 *   Reduced motion: a static outline. Pure white exists only in the DOM ui, never on the canvas.
 * - Relic slots (left mount, window niche, right bracket): an empty slot shows a subtle pixel plus; an
 *   active relic shows on its mount (iron, hot or gold by progress) with an ember glow (orange to deep
 *   red, uneven flicker, rising ember pixels, brighter at night).
 * - Zone arrival: the rest of the room dims in DIM LUT steps (Bayer dissolve, soft 6 px edge); the
 *   clicked object gets a spotlight pulse; the zone's "it's on" lamp pool brightens (radius <= 24 px
 *   around zone.light, else a point in the focus box).
 * - Statue: a ceiling downlight cone with dust motes (or the art's "downlight" overlay when present).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var C = ROOM.C;
  var D = ROOM.decode;
  var T = 255;
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  /* ------------------------------------------------------------------ one step brighter */
  var BRIGHTER_NAMES = {
    VOID: 'INK', INK: 'BROWN_0', INK_COOL: 'LEAF_0', BROWN_0: 'BROWN_1', BROWN_1: 'BROWN_2', BROWN_2: 'TERRA_1',
    TERRA_0: 'TERRA_1', TERRA_1: 'TERRA_2', TERRA_2: 'RIM', RIM: 'ORANGE', ORANGE: 'GLOW', GLOW: 'SUN',
    AMBER: 'GLOW', SUN: 'CREAM', GOLD_DK: 'GOLD', GOLD: 'SUN', ROSE_0: 'ROSE_1', ROSE_1: 'AMBER',
    LEAF_0: 'LEAF_1', LEAF_1: 'LEAF_2', LEAF_2: 'LEAF_3', SLATE_0: 'SLATE_1', SLATE_1: 'SLATE_2',
    PLUM_0: 'PLUM_1', PLUM_1: 'ROSE_1', PLUM_2: 'PLUM_3', CRT_0: 'CRT_1',
    // R3 palette additions (plaster and obsidian)
    CHAR: 'WALL_G', WALL_G: 'SLATE_0', STAT_1: 'STAT_2', STAT_2: 'SLATE_0', STAT_HI: 'CREAM',
  };
  var BRIGHTER = new Uint8Array(256);
  for (var i = 0; i < 256; i++) BRIGHTER[i] = i;
  Object.keys(BRIGHTER_NAMES).forEach(function (k) {
    if (C[k] != null && C[BRIGHTER_NAMES[k]] != null) BRIGHTER[C[k]] = C[BRIGHTER_NAMES[k]];
  });
  var DIM = (function () {
    var l = new Uint8Array(256);
    for (var i = 0; i < 256; i++) l[i] = i;
    var m = (ROOM.art.palette.luts || {}).DIM || {};
    Object.keys(m).forEach(function (k) {
      if (C[k] != null && C[m[k]] != null) l[C[k]] = C[m[k]];
    });
    return l;
  })();

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    return (n ^ (n >>> 15)) >>> 0;
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function plot(f, x, y, c) {
    ROOM.render.plot(f, x, y, c);
  }
  function reduced() {
    return !!ROOM.state.reducedMotion;
  }

  /* ------------------------------------------------------------------ skill glow and shimmer */
  var SHIMMER_FRAME_MS = 111; // 9 fps
  var hoverSpark = { id: null, t0: 0 };

  function breath(now) {
    if (reduced()) return 0.5;
    var b = 0.5 + 0.2 * Math.sin((2 * Math.PI * now) / 2500);
    return Math.round(b * 20) / 20; // 0.05 steps, so the ambient key changes at most ~10x/s
  }

  function completed(d) {
    return ROOM.fx && ROOM.fx.ledStateOf(d) === 'full';
  }

  /** Shimmer frame (0, 1, 2) for a drawable now, or -1; plus the ring index it sits on. */
  function shimmerOf(d, ringN, now) {
    if (reduced() || !ringN) return null;
    var seed = hashStr(d.id);
    var period = 4000 + (seed % 3000);
    var off = hash(seed) % period;
    var cycle = Math.floor((now + off) / period);
    var t = (now + off) % period;
    if (t >= 3 * SHIMMER_FRAME_MS) return null;
    return { frame: Math.floor(t / SHIMMER_FRAME_MS), k: hash(seed + cycle * 7919) % ringN };
  }

  function drawSpark(f, x, y, frame) {
    if (frame === 0) plot(f, x, y, C.SUN);
    else if (frame === 1) {
      plot(f, x, y, C.CREAM);
      plot(f, x - 1, y, C.PLUM_3);
      plot(f, x + 1, y, C.PLUM_3);
      plot(f, x, y - 1, C.SLATE_2);
      plot(f, x, y + 1, C.SLATE_2);
    } else if (frame === 2) {
      plot(f, x - 2, y, C.GOLD_DK);
      plot(f, x + 2, y, C.GOLD_DK);
      plot(f, x, y - 2, C.GOLD_DK);
      plot(f, x, y + 2, C.GOLD_DK);
    }
  }

  /** Outline + shimmer for a skill hotspot (img drawn at buffer (dx, dy)). */
  function drawSkillGlow(f, d, img, dx, dy) {
    if (!d.skill || !d.hotspot || completed(d)) return;
    var R = ROOM.render;
    var ring = D.ring(img);
    var n = ring.length / 2;
    if (!n) return;
    var hot = d.id === R.hoverId || d.id === R.focusId || ROOM.state.inspect;
    if (hot) {
      for (var k = 0; k < ring.length; k += 2) plot(f, dx + ring[k], dy + ring[k + 1], C.SUN);
      // One sparkle when hover or focus begins, on the top-right of the silhouette.
      if (hoverSpark.id !== d.id) hoverSpark = { id: d.id, t0: f.now };
      var ht = f.now - hoverSpark.t0;
      if (!reduced() && ht < 3 * SHIMMER_FRAME_MS) {
        var best = 0;
        for (var j = 2; j < ring.length; j += 2) if (ring[j] - ring[j + 1] > ring[best] - ring[best + 1]) best = j;
        drawSpark(f, dx + ring[best], dy + ring[best + 1], Math.floor(ht / SHIMMER_FRAME_MS));
      }
      return;
    }
    // At rest only today's top-priority object breathes (the art carries every object's resting outline).
    if (!ROOM.fx || !ROOM.fx.topSkill || ROOM.fx.topSkill() !== d.skill.slug) return;
    var level = (breath(f.now) - 0.3) / 0.4; // 0..1 between 30% and 70%
    var cut = Math.round(level * 16);
    for (var q = 0; q < ring.length; q += 2) {
      var x = ring[q], y = ring[q + 1];
      plot(f, dx + x, dy + y, BAYER[((y + dy + f.y0) & 3) * 4 + ((x + dx + f.x0) & 3)] < cut ? C.GOLD : C.GOLD_DK);
    }
    var sh = shimmerOf(d, n, f.now);
    if (sh) drawSpark(f, dx + ring[sh.k * 2], dy + ring[sh.k * 2 + 1], sh.frame);
  }

  function clearHover() {
    var R = ROOM.render;
    if (hoverSpark.id && hoverSpark.id !== R.hoverId && hoverSpark.id !== R.focusId) hoverSpark.id = null;
  }

  /* ------------------------------------------------------------------ relics */
  var SLOTS = ['left', 'window', 'right'];
  var MEDAL = [
    '...ooo...',
    '..oabbo..',
    '.oabccbo.',
    'oabbccbbo',
    'oabbbbbbo',
    'oaabbbbao',
    '.oaabbao.',
    '..oaaao..',
    '...ooo...',
    'mMMMMMMMm',
    '.m.....m.',
  ];
  var PLUS = [
    '.........',
    '.........',
    '....p....',
    '....p....',
    '..ppppp..',
    '....p....',
    '....p....',
    '.........',
    '.........',
    'mMMMMMMMm',
    '.m.....m.',
  ];
  var FORGE = {
    iron: { a: 'INK_COOL', b: 'BROWN_1', c: 'SLATE_0' },
    hot: { a: 'TERRA_1', b: 'ORANGE', c: 'GLOW' },
    gold: { a: 'GOLD_DK', b: 'GOLD', c: 'SUN' },
  };
  var spriteCache = {};
  function makeSprite(rows, roles, key) {
    if (spriteCache[key]) return spriteCache[key];
    var h = rows.length, w = rows[0].length;
    var px = new Uint8Array(w * h).fill(T);
    var map = { o: C.INK, m: C.BROWN_0, M: C.BROWN_2, p: C.BROWN_2 };
    Object.keys(roles || {}).forEach(function (r) {
      map[r] = C[roles[r]];
    });
    for (var y = 0; y < h; y++)
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x];
        if (ch !== '.' && map[ch] != null) px[y * w + x] = map[ch];
      }
    var img = { path: 'engine:' + key, w: w, h: h, px: px, bounds: [0, 0, w, h] };
    spriteCache[key] = img;
    return img;
  }

  function relicData() {
    return ROOM.data.relics || null;
  }
  function relicIn(slot) {
    var r = relicData();
    return (r && r.slots && r.slots[slot]) || null;
  }
  function forgeState(rel) {
    var p = rel ? rel.progress || 0 : 0;
    return p >= 1 ? 'gold' : p >= 0.34 ? 'hot' : 'iron';
  }

  /** World anchor (top-left of the 9x11 slot sprite) for a slot: zones.json "relics", else defaults. */
  function slotAnchor(slot) {
    var Z = ROOM.art.zones || {};
    var given = Z.relics && Z.relics[slot];
    if (given) return [given[0], given[1]];
    var CW = (Z.core && Z.core.w) || 640;
    var k = CW / 640;
    if (slot === 'window') {
      var w = (Z.shell && Z.shell.window) || [284, 70, 368, 152];
      return [Math.round((w[0] + w[2]) / 2 - 4), Math.round(w[1] - 12 * k) + 1];
    }
    if (slot === 'left') {
      var door = ROOM.itemById('kitchen.door');
      var di = door && door.variants && D.get(door.variants.base);
      if (di && di.bounds) return [door.x + di.bounds[0] + di.bounds[2] + 4, door.y + di.bounds[1] + 18];
      return [Math.round(100 * k), Math.round(96 * k)];
    }
    return [Math.round(606 * k), Math.round(96 * k)];
  }

  /**
   * Relic slot drawables for the scene. Art items with target.feature "relic-<slot>" are used when
   * present (variant "active" when a relic is set); otherwise the engine synthesises the slot sprite.
   */
  function relicDrawables() {
    var out = [];
    SLOTS.forEach(function (slot) {
      var feat = 'relic-' + slot;
      var art = ROOM.art.items.filter(function (it) {
        return it.target && it.target.feature === feat;
      })[0];
      if (art) return; // the art item is drawn by the normal scene; render marks it via relicSlotOf()
      var rel = relicIn(slot);
      var img = rel ? makeSprite(MEDAL, FORGE[forgeState(rel)], 'relic-' + forgeState(rel)) : makeSprite(PLUS, null, 'relic-empty');
      var a = slotAnchor(slot);
      out.push({
        item: { id: 'relic.' + slot, zone: slot === 'left' ? 'kitchen' : slot === 'right' ? 'gym' : 'window', kind: 'hotspot', layer: 2, x: a[0], y: a[1], target: { feature: feat }, label: rel ? rel.title : 'Relic slot', variants: {} },
        id: 'relic.' + slot,
        key: rel ? 'active' : 'base',
        img: img,
        frames: null,
        fps: 0,
        layer: 2,
        x: a[0],
        y: a[1],
        order: 9000 + SLOTS.indexOf(slot),
        hotspot: true,
        shell: false,
        skill: null,
        cat: 'gold',
        dust: false,
        statue: false,
        dog: false,
        relic: slot,
        contact: a[1] + img.h,
        hit: [a[0], a[1], img.w, img.h],
        led: null,
      });
    });
    return out;
  }
  function relicSlotOf(d) {
    if (d.relic) return d.relic;
    var t = d.item && d.item.target;
    var m = t && t.feature && /^relic-(left|window|right)$/.exec(t.feature);
    return m ? m[1] : null;
  }

  /** Ember glow around an active relic (after the LUT). */
  function drawEmbers(f, d, img, dx, dy) {
    var slot = relicSlotOf(d);
    var rel = slot && relicIn(slot);
    if (!rel) return;
    var night = !!ROOM.state.night;
    var st = forgeState(rel);
    var b = img.bounds || [0, 0, img.w, img.h];
    var cx = dx + b[0] + b[2] / 2, cy = dy + b[1] + Math.min(b[3], 9) / 2;
    var R = night ? 11 : 8;
    // Uneven flicker: two incommensurate waves plus a hashed jitter, stepped at 10 fps.
    var tq = reduced() ? 0 : Math.floor(f.now / 100);
    var flick = reduced() ? 0.7 : 0.55 + 0.2 * Math.sin(tq * 0.9) + 0.15 * Math.sin(tq * 2.3 + 1) + ((hash(tq + hashStr(slot)) % 100) / 100) * 0.15;
    if (st === 'iron') flick *= 0.6;
    if (night) flick = Math.min(1, flick + 0.2);
    for (var y = Math.floor(cy - R); y <= cy + R; y++) {
      for (var x = Math.floor(cx - R); x <= cx + R; x++) {
        var ddx = x - cx, ddy = y - cy, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd > R) continue;
        var ix = x - dx, iy = y - dy;
        if (ix >= 0 && iy >= 0 && ix < img.w && iy < img.h && img.px[iy * img.w + ix] !== T) continue;
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
        var th = 16 * flick * (1 - dd / R) * 1.4;
        if (BAYER[((y + f.y0) & 3) * 4 + ((x + f.x0) & 3)] < th) {
          var p = y * f.w + x;
          var c = BRIGHTER[f.buf[p]];
          // Tint toward ember red: dark browns go TERRA, nothing goes past GLOW.
          if (c === C.BROWN_1 || c === C.BROWN_2 || c === C.INK || c === C.BROWN_0) c = dd < R * 0.5 ? C.TERRA_1 : C.TERRA_0;
          if (c === C.SUN || c === C.CREAM) c = C.GLOW;
          f.buf[p] = c;
        }
      }
    }
    if (reduced()) return;
    // Rising ember pixels: orange to deep red as they climb.
    var n = night ? 4 : st === 'iron' ? 1 : 3;
    var seed = hashStr(slot);
    for (var e = 0; e < n; e++) {
      var life = 1100 + (hash(seed + e) % 600);
      var t = (f.now + (hash(seed * 3 + e) % life)) % life;
      var u = t / life;
      var gen = Math.floor((f.now + (hash(seed * 3 + e) % life)) / life);
      var ex = cx + ((hash(seed + e * 13 + gen) % 7) - 3) + Math.round(Math.sin(u * 6 + e) * 1);
      var ey = cy - 3 - u * (night ? 16 : 12);
      var col = u < 0.3 ? C.GLOW : u < 0.6 ? C.ORANGE : u < 0.85 ? C.RIM : C.TERRA_0;
      plot(f, ex, ey, col);
    }
  }

  /* ------------------------------------------------------------------ arrival: spotlight, zone dim, lamps */
  var spot = null; // {id, t0}
  var zoneDim = { zone: null, t0: 0 };
  var lamp = { zone: null, t0: 0 };
  var SPOT_MS = 650;
  var DIM_MS = 300;

  function spotlight(id) {
    spot = id ? { id: id, t0: ROOM.now() } : null;
    ROOM.invalidate();
  }
  /** Colour table override for the spotlit drawable (brighter while the pulse is up), or null. */
  function spotTable(d, lut, now) {
    if (!spot || spot.id !== d.id) return null;
    var t = now - spot.t0;
    if (t < 0 || t >= SPOT_MS) return null;
    var out = new Uint8Array(256);
    var twice = t < SPOT_MS * 0.45;
    for (var i = 0; i < 256; i++) out[i] = twice ? BRIGHTER[BRIGHTER[lut[i]]] : BRIGHTER[lut[i]];
    return out;
  }
  function drawSpotRing(f, d, img, dx, dy) {
    if (!spot || spot.id !== d.id) return;
    var t = f.now - spot.t0;
    if (t < 0 || t >= SPOT_MS * 0.6) return;
    var ring = D.ring(img);
    for (var k = 0; k < ring.length; k += 2) plot(f, dx + ring[k], dy + ring[k + 1], t < SPOT_MS * 0.3 ? C.CREAM : C.SUN);
  }

  function zoneOf(id) {
    return id ? ROOM.zoneById(id) : null;
  }
  /** The zone whose "it's on" light is on: the zone in view, or the zone of the open panel's item. */
  function litZone() {
    if (ROOM.state.zone) return ROOM.state.zone;
    var p = ROOM.state.panel;
    var it = p && ROOM.itemById(p);
    return it && it.zone ? it.zone : null;
  }
  function lightPoint(z) {
    if (z.light) return { x: z.light[0], y: z.light[1], r: Math.min(24, z.light[2] || 22) };
    var f = z.focus;
    return { x: f[0] + f[2] / 2, y: f[1] + f[3] * 0.38, r: 22 };
  }

  function pool(f, p, strength) {
    var r = p.r;
    for (var y = Math.floor(p.y - r); y <= p.y + r; y++) {
      var by = y - f.y0;
      if (by < 0 || by >= f.h) continue;
      for (var x = Math.floor(p.x - r); x <= p.x + r; x++) {
        var bx = x - f.x0;
        if (bx < 0 || bx >= f.w) continue;
        var dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        if (BAYER[(y & 3) * 4 + (x & 3)] < 16 * strength * (1 - d / r) * 1.25) {
          var i = by * f.w + bx;
          f.buf[i] = BRIGHTER[f.buf[i]];
        }
      }
    }
  }

  /** Statue downlight: a pixel cone from the ceiling with dust motes (skipped if the art has one). */
  function statueCone(f) {
    if (!ROOM.state.statueLight) return;
    var R = ROOM.render, st = null, art = false;
    R.drawables.forEach(function (d) {
      if (d.statue && !st) st = d;
      if (/downlight/.test(d.id)) art = true;
    });
    if (!st) return;
    var Z = ROOM.art.zones || {};
    var top = (Z.shell && Z.shell.ceilingY) != null ? Z.shell.ceilingY - 6 : st.hit[1] - 50;
    var cx = st.hit[0] + st.hit[2] / 2;
    var baseY = st.hit[1] + st.hit[3] * 0.55;
    var halfTop = 2, halfBase = st.hit[2] * 0.75;
    if (!art) {
      for (var y = Math.floor(top); y <= baseY; y++) {
        var u = (y - top) / (baseY - top);
        var hw = halfTop + (halfBase - halfTop) * u;
        var dens = 16 * (0.55 - 0.35 * u);
        for (var x = Math.floor(cx - hw); x <= cx + hw; x++) {
          var bx = x - f.x0, by = y - f.y0;
          if (bx < 0 || by < 0 || bx >= f.w || by >= f.h) continue;
          var edge = Math.abs(x - cx) > hw - 1;
          if (BAYER[(y & 3) * 4 + (x & 3)] < (edge ? dens * 0.5 : dens)) {
            var i = by * f.w + bx;
            f.buf[i] = BRIGHTER[f.buf[i]];
          }
        }
      }
      // The fixture: a 5 px can at the apex.
      for (var k = -2; k <= 2; k++) plot(f, cx + k - f.x0, top - 1 - f.y0, C.INK);
      plot(f, cx - f.x0, top - f.y0, C.SUN);
    }
    // Dust motes drifting down through the cone.
    var n = 7;
    for (var m = 0; m < n; m++) {
      var per = 3000 + (hash(m + 11) % 2500);
      var tt = reduced() ? (hash(m) % per) : (f.now + (hash(m * 7) % per)) % per;
      var uu = tt / per;
      var my = top + 4 + uu * (baseY - top - 6);
      var span = (halfTop + (halfBase - halfTop) * uu) * 0.8;
      var mx = cx + Math.sin(uu * 5 + m * 1.7) * span * ((hash(m + 3) % 100) / 100);
      plot(f, mx - f.x0, my - f.y0, m % 3 ? C.CREAM : C.GLOW);
    }
  }

  /** Post-passes on the rest frame, before the marks: lamp pools, zone dim, statue cone. */
  function post(f, dimOn) {
    var now = f.now;
    // Lamp pools: the lit zone at full strength; at night, completion sets how many lamps are on.
    var lz = litZone();
    if (lz !== lamp.zone) lamp = { zone: lz, t0: now };
    var zones = ROOM.zones;
    if (ROOM.state.night) {
      var on = Math.round(((ROOM.data.todayP || 0) / 100) * zones.length);
      for (var i = 0; i < on; i++) if (zones[i].id !== lz) pool(f, Object.assign(lightPoint(zones[i]), { r: 16 }), 0.6);
    }
    if (lz) {
      var z = zoneOf(lz);
      var ramp = reduced() ? 1 : Math.min(1, (now - lamp.t0) / 250);
      if (z) pool(f, lightPoint(z), Math.max(0.2, ramp));
    }
    // Zone dim: the rest of the room steps down through the DIM LUT once the camera lands.
    var zid = ROOM.state.zone;
    if (zid !== zoneDim.zone) zoneDim = { zone: zid, t0: now };
    if (zid && !dimOn && !ROOM.render.dolly) {
      var zz = zoneOf(zid);
      var step = reduced() ? 16 : Math.min(16, Math.floor((16 * (now - zoneDim.t0)) / DIM_MS));
      if (zz && step > 0) {
        var fr = zz.focus, EDGE = 6;
        var fx0 = fr[0], fy0 = fr[1], fx1 = fr[0] + fr[2], fy1 = fr[1] + fr[3];
        for (var by = 0; by < f.h; by++) {
          var wy = by + f.y0;
          var oy = wy < fy0 ? fy0 - wy : wy >= fy1 ? wy - fy1 + 1 : 0;
          for (var bx = 0; bx < f.w; bx++) {
            var wx = bx + f.x0;
            var ox = wx < fx0 ? fx0 - wx : wx >= fx1 ? wx - fx1 + 1 : 0;
            var out = Math.max(ox, oy);
            if (!out) {
              bx = Math.max(bx, fx1 - f.x0 - 1); // skip the inside of the focus box
              continue;
            }
            var lim = out >= EDGE ? step : Math.floor((step * out) / EDGE);
            if (BAYER[(wy & 3) * 4 + (wx & 3)] < lim) {
              var p = by * f.w + bx;
              f.buf[p] = DIM[f.buf[p]];
            }
          }
        }
      }
    }
    statueCone(f);
  }

  /* ------------------------------------------------------------------ scheduler hooks */
  function anyGlow() {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if ((d.skill && d.hotspot) || relicSlotOf(d)) return true;
    }
    return !!ROOM.state.statueLight;
  }
  function hasAmbient() {
    return !reduced() && anyGlow();
  }
  function ambientKey(now) {
    return hasAmbient() ? String(Math.floor(now / 100)) : '';
  }
  function busy(now) {
    clearHover();
    if (spot && now - spot.t0 < SPOT_MS + 50) return true;
    if (ROOM.state.zone && now - zoneDim.t0 < DIM_MS + 50) return true;
    if (litZone() && now - lamp.t0 < 300) return true;
    return false;
  }

  ROOM.glow = {
    BRIGHTER: BRIGHTER,
    drawSkillGlow: drawSkillGlow,
    drawEmbers: drawEmbers,
    drawSpotRing: drawSpotRing,
    spotTable: spotTable,
    spotlight: spotlight,
    relicDrawables: relicDrawables,
    relicSlotOf: relicSlotOf,
    relicIn: relicIn,
    forgeState: forgeState,
    slotAnchor: slotAnchor,
    post: post,
    busy: busy,
    hasAmbient: hasAmbient,
    ambientKey: ambientKey,
    SLOTS: SLOTS,
  };
})();
