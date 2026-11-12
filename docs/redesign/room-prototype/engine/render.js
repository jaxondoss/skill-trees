/* FORGE room prototype: renderer, move renderer and frame scheduler.
 *
 * At rest the room is drawn into an indexed framebuffer (one byte per world pixel, the visible window plus 1 px)
 * with every sprite passed through the current lighting LUT as it is blitted, and an aux buffer (depth, flags,
 * material; docs/redesign/room-r6/INTERFACES.md section 5). Engine marks go through plotMark (raw palette colour).
 * The WebGL2 compositor (ROOM.gl) lights the frame from those buffers; without it the v3.3 path expands the indices
 * through the palette and lays the Canvas2D light (drawLight) over it. Rest frames are at integer zoom, drawn with
 * smoothing off; the only colours outside the palette come from the light layers and Bayer dissolves.
 *
 * v3.5: what a frame shows is decided by the navigator (engine/nav.js): drawFrame reads an explicit LightState
 * (ls: zone focus, panel dim, pools, hover, skill) and never the globals. Every move is drawn from pre-lit rest
 * renders ("shots" and snapshots made by drawFrame itself, GPU or LUT path), scaled by nearest neighbour and
 * snapped to whole device pixels; lighting changes during a move are 4x4 Bayer dissolves anchored to the world.
 * DOLLY: one lit plane (no per-layer parallax). TURN: a pure yaw that re-projects the columns of each wall's
 * master, with zoom and centre terms for TURN+ZOOM. RISE/DESCEND: the wall frame shrinks onto its anchor in the
 * overview while the overview grows about it. LIFT/DROP/SWAP keep the camera still and draw live rest frames.
 *
 * Frames are drawn only on change. Ambient motion (anim sprites, LEDs, embers) ticks at 10 fps at most, phone-pan
 * depth at 30 fps at most, moves and the phone pan at display rate. Hidden tabs pause.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var CAM = ROOM.camera;
  CAM.configure(ROOM.viewConf ? ROOM.viewConf(ROOM.state.view) : ROOM.art.zones || {});
  var MID_X = CAM.CORE_W / 2;
  var D = ROOM.decode;
  var C = ROOM.C;
  var T = 255;
  // 4x4 ordered-dither thresholds, row-major: BAYER[(y & 3) * 4 + (x & 3)].
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var ZERO = [0, 0, 0, 0, 0, 0, 0];

  /* ------------------------------------------------------------------ palette and LUTs */
  // Index -> packed RGBA for a little-endian Uint32Array view of ImageData (0xAABBGGRR). 255 = clear.
  var RGBA = new Uint32Array(256);
  var EXPAND = RGBA; // Canvas2D index -> RGBA for unmarked pixels (v3.5 hook; marks always use RGBA)
  var RGB = [];
  ROOM.art.palette.colors.forEach(function (c, i) {
    var h = c[1];
    var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    RGB[i] = [r, g, b];
    RGBA[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  });
  RGBA[T] = 0;
  // A7: the Canvas2D floor of engine marks, 0.7 x palette (lightened over the lit frame).
  var MARK_FLOOR = new Uint32Array(256);
  RGB.forEach(function (c, i) {
    MARK_FLOOR[i] = ((255 << 24) | (Math.round(c[2] * 0.7) << 16) | (Math.round(c[1] * 0.7) << 8) | Math.round(c[0] * 0.7)) >>> 0;
  });
  // Material table (art/room-r6/materials.json in the bundle): name -> id, and the flags the aux buffer needs.
  var MATS = (ROOM.art.materials && ROOM.art.materials.materials) || [];
  var MAT_ID = {};
  var MAT_EMIT = new Uint8Array(256);
  MATS.forEach(function (m) {
    MAT_ID[m.name] = m.id;
    if (m.emissive > 0) MAT_EMIT[m.id] = 1;
  });
  var M_FLOOR = MAT_ID.wood_floor || 3, M_CEIL = MAT_ID.wood_ceiling || 5, M_LEAF = MAT_ID.leaf || 21;
  var M_GLASS = MAT_ID.glass_window || 17, M_SKY = MAT_ID.sky || 30;
  var VOID_CSS = ROOM.art.palette.colors[C.VOID] ? ROOM.art.palette.colors[C.VOID][1] : '#000';

  function identity() {
    var l = new Uint8Array(256);
    for (var i = 0; i < 256; i++) l[i] = i;
    return l;
  }
  function lutFrom(map) {
    var l = identity();
    Object.keys(map || {}).forEach(function (from) {
      if (from[0] === '_') return;
      if (C[from] != null && C[map[from]] != null) l[C[from]] = C[map[from]];
    });
    return l;
  }
  var LUT = {};
  ['R1', 'R2', 'R3', 'R4', 'NIGHT', 'DIM'].forEach(function (k) {
    LUT[k] = lutFrom((ROOM.art.palette.luts || {})[k]);
  });
  LUT.ID = identity();
  var composed = {};
  // The lighting state is a base ramp (R1..R4 or NIGHT) with DIM optionally applied on top.
  function lutFor(base, dim) {
    var key = base + (dim ? '+DIM' : '');
    if (!composed[key]) {
      var out = new Uint8Array(256);
      for (var i = 0; i < 256; i++) out[i] = dim ? LUT.DIM[LUT[base][i]] : LUT[base][i];
      out.base = base;
      out.dim = dim;
      composed[key] = out;
    }
    return composed[key];
  }
  // Painted night twins ("night" or "<key>.night" variants) are already lit for the night: they skip the
  // NIGHT ramp (DIM still applies).
  function paintedLut(l) {
    return l && l.base === 'NIGHT' ? lutFor('R4', l.dim) : l;
  }
  // Compose a per-item colour remap (applied first) with a LUT.
  function chain(remap, lut) {
    var out = new Uint8Array(256);
    for (var i = 0; i < 256; i++) out[i] = lut[remap[i]];
    return out;
  }

  /* ------------------------------------------------------------------ lighting state and dissolve */
  var light = { key: null, base: null, from: null, to: null, t0: 0, dur: 0, step: 16 };

  /** True when the WebGL2 compositor lights this frame (the art is then drawn as plain albedo). */
  var gpuReady = false; // set by enableGpu(); cleared for the session when frame() returns null
  function gpuOn() {
    return gpuReady && !!ROOM.gl && !ROOM.gl.lost && ROOM.gl.tier !== 'off';
  }
  /** Start the WebGL2 compositor when the browser has it (main.js calls this once at boot). */
  function enableGpu() {
    if (!ROOM.gl || !ROOM.gl.supported() || !ROOM.gl.init()) return false;
    // ?night=1 with no clock override: the GPU light shows 11 PM too
    var q = window.location.search;
    var L = ROOM.light && ROOM.light.flags;
    if (L && /[?&]night=1\b/.test(q) && !L.t && L.el == null) L.t = { h: 23, m: 0 };
    ROOM.gl.setPalette(ROOM.art.palette.colors);
    if (ROOM.art.materials) ROOM.gl.setMaterials(ROOM.art.materials.materials || ROOM.art.materials);
    gpuReady = true;
    invalidate();
    return true;
  }
  function lightTarget() {
    // On the GPU path the sprites go in as albedo (identity) and the compositor applies light and dim itself.
    var gpu = gpuOn();
    var base = gpu ? 'ID' : ROOM.state.night ? 'NIGHT' : ROOM.rampOf(ROOM.data.todayP || 0);
    return { base: base, dim: false, key: base }; // the panel dim is a Bayer step per frame (ls.dimK)
  }
  /** Advance the dissolve. Returns true when the frame must be redrawn. */
  function updateLighting(now) {
    var t = lightTarget();
    if (light.key === null) {
      light.key = t.key;
      light.base = t.base;
      light.from = light.to = lutFor(t.base, t.dim);
      light.step = 16;
      return true;
    }
    if (t.key !== light.key) {
      // A new target: dissolve from the current target (a dissolve in progress snaps to its end).
      light.from = light.to;
      light.to = lutFor(t.base, t.dim);
      light.dur = 1200; // a sky ramp change dissolves over 1.2 s
      if (t.base === 'ID' || light.base === 'ID') light.dur = 0; // switching to or from the GPU path snaps
      light.t0 = now;
      light.key = t.key;
      light.base = t.base;
      light.step = ROOM.state.reducedMotion || !light.dur ? 16 : 0;
      if (light.step === 16) light.from = light.to;
      return true;
    }
    if (light.step < 16) {
      var step = Math.max(0, Math.min(16, Math.floor((16 * (now - light.t0)) / light.dur)));
      if (step !== light.step) {
        light.step = step;
        if (step === 16) light.from = light.to;
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ scene: what to draw */
  var drawables = [];
  var sceneDirty = true;
  var sceneVersion = 0;

  function categoryOf(item, skill) {
    if (skill) return skill.category;
    return item.target ? 'gold' : null;
  }

  /** Pick variants, place the dog, sort by layer, shell first, contact y, item order. */
  function buildScene() {
    var list = [];
    var curView = ROOM.sceneKey(); // 'top' in the overview (v3.5), else the wall view (sceneOverride in snapshots)
    var noRim = noRimTest();
    ROOM.art.items.forEach(function (it, order) {
      if (ROOM.viewOf(it) !== curView) return;
      var key = ROOM.variantOf(it);
      if (!key) return;
      var img = D.get(it.variants[key]);
      if (!img) return;
      var skill = ROOM.skillOf(it);
      var d = {
        item: it,
        id: it.id,
        key: key,
        img: img,
        frames: null,
        fps: 0,
        layer: Math.max(0, Math.min(6, it.layer | 0)),
        x: it.x,
        y: it.y,
        order: order,
        hotspot: it.kind === 'hotspot',
        shell: it.kind === 'shell',
        skill: skill,
        cat: categoryOf(it, skill),
        // Engine dust only when the art has no "dust" variant of its own.
        dust: !!(skill && skill.neglected && key !== 'dust'),
        statue: !!(it.target && it.target.feature === 'overall') || (it.kind === 'hotspot' && /statue/.test(it.id)),
        dog: /(^|[.\-_])dog\b/.test(it.id),
        // aux flags every pixel of this item carries (bit7 no rim), and its fallback material
        auxFlags: noRim(it.id) ? 128 : 0,
        mat0: (it.material && MAT_ID[it.material]) || 0,
      };
      // Anim frames replace the base look only (a night or alert variant is a still).
      if (it.anim && it.anim.frames && it.anim.frames.length > 1 && (key === 'base' || !it.variants.base)) {
        d.frames = it.anim.frames;
        d.fps = Math.min(10, it.anim.fps || 4);
      }
      // Night: an item's painted twin of the chosen variant ("<key>.night"), with its own anim frames.
      if (ROOM.state.night && key !== 'night' && it.variants[key + '.night']) {
        var twin = D.get(it.variants[key + '.night']);
        if (twin) {
          d.key = key + '.night';
          d.img = twin;
          img = twin;
        }
      }
      d.painted = d.key === 'night' || /\.night$/.test(d.key);
      if (d.painted && it.anim && it.anim.night && it.anim.night.length > 1 && (d.key === 'night' || d.key === 'base.night')) {
        d.frames = it.anim.night;
        d.fps = Math.min(10, it.anim.fps || 4);
      } else if (d.painted && !(it.anim && it.anim.night)) {
        d.frames = null;
      }
      if (d.dog && ROOM.fx) ROOM.fx.placeDog(d);
      d.contact = d.y + img.h;
      var dx = d.x - it.x, dy = d.y - it.y;
      d.hit = it.hit
        ? [it.hit[0] + dx, it.hit[1] + dy, it.hit[2], it.hit[3]]
        : img.bounds
          ? [d.x + img.bounds[0], d.y + img.bounds[1], img.bounds[2], img.bounds[3]]
          : [d.x, d.y, img.w, img.h];
      d.led = it.led ? [it.led[0] + dx, it.led[1] + dy] : null;
      list.push(d);
    });
    if (ROOM.glow && curView !== 'top') ROOM.glow.relicDrawables().forEach(function (d) {
      list.push(d);
    });
    // Layer, then shell plates before objects (a full-height shell plate would otherwise sort last
    // by contact y and cover its layer), then contact y, then manifest order.
    list.sort(function (a, b) {
      return a.layer - b.layer || (b.shell ? 1 : 0) - (a.shell ? 1 : 0) || a.contact - b.contact || a.order - b.order;
    });
    drawables = list;
    sceneDirty = false;
    sceneVersion++;
  }

  function imageOf(d, now) {
    if (!d.frames || ROOM.state.reducedMotion) return d.img;
    var i = Math.floor((now / 1000) * d.fps) % d.frames.length;
    return D.get(d.frames[i]) || d.img;
  }

  /** zones.json views.<v>.lighting.noRim globs ("*poster*") as one test on item ids. */
  function noRimTest() {
    var L = (ROOM.viewConf(ROOM.sceneKey()) || {}).lighting;
    var pats = (L && L.noRim) || [];
    if (!pats.length) return function () {
      return false;
    };
    var re = new RegExp(pats.map(function (g) {
      return '^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    }).join('|'));
    return function (id) {
      return re.test(id);
    };
  }

  /* ------------------------------------------------------------------ blitting */
  /**
   * Copy a sprite into an index buffer through two colour tables, skipping transparent pixels.
   * Pixels whose world-anchored Bayer threshold is below `step` use tB, the rest tA.
   * (bx, by) is the world position of the buffer's (0, 0).
   */
  function blit(dst, dw, dh, img, dx, dy, tA, tB, step, bx, by, clip) {
    var sw = img.w, src = img.px;
    var x0 = Math.max(0, -dx), y0 = Math.max(0, -dy);
    var x1 = Math.min(sw, dw - dx), y1 = Math.min(img.h, dh - dy);
    if (clip) {
      x0 = Math.max(x0, clip[0] - dx);
      y0 = Math.max(y0, clip[1] - dy);
      x1 = Math.min(x1, clip[2] - dx);
      y1 = Math.min(y1, clip[3] - dy);
    }
    if (x0 >= x1 || y0 >= y1) return;
    var mixing = step > 0 && step < 16 && tA !== tB;
    var t = step >= 16 ? tB : tA;
    for (var y = y0; y < y1; y++) {
      var si = y * sw, di = (y + dy) * dw + dx, v, x;
      if (!mixing) {
        for (x = x0; x < x1; x++) {
          v = src[si + x];
          if (v !== T) dst[di + x] = t[v];
        }
      } else {
        var brow = ((y + dy + by) & 3) * 4;
        for (x = x0; x < x1; x++) {
          v = src[si + x];
          if (v !== T) dst[di + x] = (BAYER[brow + ((x + dx + bx) & 3)] < step ? tB : tA)[v];
        }
      }
    }
  }

  /**
   * The aux twin of blit (INTERFACES.md section 5): for every opaque sprite pixel, byte 0 depth, byte 1 flags,
   * byte 2 material ID. Shell plates sit at depth 0 except the floor (its own row scaled) and the ceiling (255);
   * objects take their contact row. Materials come from the sprite's mat channel, else the item's material.
   */
  function blitAux(f, d, img, dx, dy, clip) {
    var aux = f.aux;
    if (!aux) return;
    var dw = f.w, dh = f.h, sw = img.w, src = img.px;
    var mat = D.mat ? D.mat(img) : null;
    var x0 = Math.max(0, -dx), y0 = Math.max(0, -dy);
    var x1 = Math.min(sw, dw - dx), y1 = Math.min(img.h, dh - dy);
    if (clip) {
      x0 = Math.max(x0, clip[0] - dx);
      y0 = Math.max(y0, clip[1] - dy);
      x1 = Math.min(x1, clip[2] - dx);
      y1 = Math.min(y1, clip[3] - dy);
    }
    if (x0 >= x1 || y0 >= y1) return;
    var H = CAM.CORE_H || 352, hz = CAM.HORIZON || H * 0.4;
    var objDepth = markDepth(d);
    var ls = f.ls || NO_LS;
    var hot = (ls.hover && d.id === ls.hover) || (ls.focus && d.id === ls.focus);
    var base = d.auxFlags | (hot ? 64 : 0);
    var m0 = d.mat0;
    for (var y = y0; y < y1; y++) {
      var si = y * sw, wy = y + dy + f.y0;
      var floorDepth = Math.max(1, Math.min(254, 1 + Math.round((253 * (wy - hz)) / Math.max(1, H - hz))));
      for (var x = x0; x < x1; x++) {
        if (src[si + x] === T) continue;
        var m = mat ? mat[si + x] : m0;
        if (m === T) continue;
        if (!m) m = m0;
        var o = ((y + dy) * dw + x + dx) * 3;
        var fl = base, dep = objDepth;
        if (MAT_EMIT[m]) fl |= 1;
        if (m === M_FLOOR && d.shell) {
          fl |= 2;
          dep = floorDepth;
        } else if (m === M_CEIL && d.shell) dep = 255;
        if (m === M_GLASS || m === M_SKY) fl |= 8;
        if (m === M_LEAF) fl |= 32;
        aux[o] = dep;
        aux[o + 1] = fl;
        aux[o + 2] = m;
      }
    }
  }

  /**
   * Aux depth (byte 0) of a drawable: shell plates 0, objects their contact row (1..254). Takes a drawable or a
   * contact row (world y). Engine marks drawn on an item use its depth.
   */
  function markDepth(d) {
    if (d && typeof d === 'object' && d.shell) return 0;
    var contact = typeof d === 'number' ? d : d.contact;
    var H = CAM.CORE_H || 352, hz = CAM.HORIZON || H * 0.4;
    return Math.max(1, Math.min(254, 1 + Math.round((253 * (contact - hz)) / Math.max(1, H - hz))));
  }

  /**
   * v3.5: the only writer of engine marks (wires, nodes, LEDs, plates). Buffer coordinates, bounds-checked.
   * Writes the palette index, aux depth and flags (default bit4 engine mark + bit7 no rim; bit6 is always cleared),
   * material 0, and sets f.mark so the Canvas2D expansion shows the raw palette colour.
   */
  function plotMark(f, x, y, c, depth, flags) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    var i = y * f.w + x;
    f.buf[i] = c;
    if (f.aux) {
      var o = i * 3;
      f.aux[o] = depth == null ? 0 : depth;
      f.aux[o + 1] = (flags == null ? 16 | 128 : flags) & ~64;
      f.aux[o + 2] = 0;
    }
    if (f.mark) f.mark[i] = 1;
  }

  /* v3.5 mark passes (wire, overview heading): run after drawItems, before weather, in registration order. */
  var markPasses = [];
  function addMarkPass(name, fn) {
    for (var i = 0; i < markPasses.length; i++) {
      if (markPasses[i].name === name) {
        markPasses[i].fn = fn;
        return;
      }
    }
    markPasses.push({ name: name, fn: fn });
  }
  /** Write one palette index at buffer coordinates (bounds-checked). Used by the engine marks. */
  function plot(f, x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < f.w && y < f.h) f.buf[y * f.w + x] = c;
  }

  function lightCatColor(cat) {
    var ramp = cat && ROOM.art.palette.categories[cat];
    return ramp ? C[ramp[2]] : C.CREAM;
  }

  /**
   * Draw the drawables that pass `filter` into frame f = {buf, w, h, x0, y0, offs, now, lutA, lutB, step}.
   * opts.marks: LEDs and dust; opts.outline: hover/focus/inspect outlines.
   */
  function drawItems(f, filter, opts) {
    var dustA = null, dustB = null, statA = null, statB = null;
    var gold = ROOM.fx ? ROOM.fx.statueColor(f.now) : -1;
    for (var i = 0; i < drawables.length; i++) {
      var d = drawables[i];
      if (!filter(d)) continue;
      var img = imageOf(d, f.now);
      var dx = d.x + f.offs[d.layer] - f.x0;
      var dy = d.y - f.y0;
      var tA = f.lutA, tB = f.lutB;
      if (d.painted) {
        tA = paintedLut(tA);
        tB = paintedLut(tB);
      }
      if (d.dust) {
        // Neglect: the whole object one step darker (then lit as usual).
        if (!dustA) {
          dustA = chain(ROOM.fx.DARKER, f.lutA);
          dustB = f.lutA === f.lutB ? dustA : chain(ROOM.fx.DARKER, f.lutB);
        }
        tA = dustA;
        tB = dustB;
      } else if (d.statue && gold >= 0) {
        // Gold pulse: palette cycling on the statue's GOLD pixels, after the LUT (true colour).
        if (!statA) {
          statA = new Uint8Array(f.lutA);
          statA[C.GOLD] = gold;
          statB = new Uint8Array(f.lutB);
          statB[C.GOLD] = gold;
        }
        tA = statA;
        tB = statB;
      }
      if (d.item.drift) {
        drawDrift(f, d, img, dx, dy, tA, tB);
        continue;
      }
      blit(f.buf, f.w, f.h, img, dx, dy, tA, tB, f.step, f.x0, f.y0);
      if (f.aux) blitAux(f, d, img, dx, dy);
      if (d.statue && ROOM.statue) ROOM.statue.draw(f, d, img, dx, dy); // plaque and level-up surge
      if (ROOM.calendar && (d.id === 'calendar.board' || d.id === 'calendar.daybar')) ROOM.calendar.draw(f, d); // the calendar wall
      if (opts.marks) {
        if (d.dust) ROOM.fx.drawDust(f, img, dx, dy);
        if (ROOM.fx.drawScreen && d.item.screen) ROOM.fx.drawScreen(f, d, dx, dy);
        if (ROOM.glow && (!f.ls || f.ls.scene !== 'top')) {
          // A5: embers and glows assume a wall view; the overview has its own light
          ROOM.glow.drawEmbers(f, d, img, dx, dy);
        }
        if (d.led && d.hotspot) ROOM.fx.drawLed(f, d, d.led[0] + f.offs[d.layer] - f.x0, d.led[1] - f.y0);
      }
    }
  }

  /* ------------------------------------------------------------------ window drift (art pass 5) */
  /**
   * Offset (world px) of a drift sprite at time now: "wrap" slides a tile at speed px/s (drawn twice,
   * span apart); "pass" crosses span px every period s, with an optional vertical wave. Reduced motion
   * holds the first frame.
   */
  function driftOffset(dr, now) {
    var t = ROOM.state.reducedMotion ? 0 : now / 1000;
    if (dr.mode === 'wrap') return { x: (t * dr.speed) % dr.span, y: 0 };
    // the sprite was exported at u = 0; the art build's stills at time t use u = t / period + phase
    var u = (t / dr.period + (dr.phase || 0)) % 1;
    return { x: Math.round(u * dr.span), y: Math.round((dr.ampY || 0) * Math.sin(u * (dr.freqY || 0))) };
  }
  function drawDrift(f, d, img, dx, dy, tA, tB) {
    var dr = d.item.drift;
    var c = dr.clip;
    var clip = [c[0] + f.offs[d.layer] - f.x0, c[1] - f.y0, c[0] + c[2] + f.offs[d.layer] - f.x0, c[1] + c[3] - f.y0];
    var o = driftOffset(dr, f.now);
    blit(f.buf, f.w, f.h, img, dx + Math.floor(o.x), dy + o.y, tA, tB, f.step, f.x0, f.y0, clip);
    if (f.aux) blitAux(f, d, img, dx + Math.floor(o.x), dy + o.y, clip);
    if (dr.mode === 'wrap') {
      blit(f.buf, f.w, f.h, img, dx + Math.floor(o.x) - dr.span, dy, tA, tB, f.step, f.x0, f.y0, clip);
      if (f.aux) blitAux(f, d, img, dx + Math.floor(o.x) - dr.span, dy, clip);
    }
  }

  /* ------------------------------------------------------------------ smooth light (art pass 5) */
  function lightSpec() {
    var vc = ROOM.viewConf ? ROOM.viewConf(ROOM.sceneKey()) : null;
    var L = vc && vc.light;
    return L ? (ROOM.state.night ? L.night : L.day) : null;
  }
  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(4) + ')';
  }
  function chanFrame(spec, ch, now) {
    var an = spec.anims && spec.anims[ch];
    if (!an || ROOM.state.reducedMotion) return 0;
    return an.seq[Math.floor((now / 1000) * an.fps) % an.seq.length];
  }
  /**
   * Lay the view's light over the frame just drawn: tr maps world to device px (x * z + tx).
   * Warm wash and glows use "screen", the oval vignette "multiply"; falloff stops come from the art build.
   */
  /** dim: the panel dim 0..1 (a boolean is read as 0 or 1); the light keeps 55 % at full dim. */
  function drawLight(tr, now, dim, target) {
    var spec = lightSpec();
    var tctx = target ? target.ctx : ctx;
    if (!spec || !tctx) return;
    var W = target ? target.W : canvas.width, H = target ? target.H : canvas.height, k = 1 - 0.45 * Math.max(0, Math.min(1, +dim || 0));
    tctx.save();
    tctx.globalCompositeOperation = 'screen';
    tctx.fillStyle = rgba(spec.ambient.rgb, spec.ambient.a * k);
    tctx.fillRect(0, 0, W, H);
    var stops = spec.stops, fall = spec.fall;
    for (var i = 0; i < spec.glows.length; i++) {
      var g = spec.glows[i];
      var a = g.a;
      if (g.ch && g.ak) a = g.ak[chanFrame(spec, g.ch, now)] != null ? g.ak[chanFrame(spec, g.ch, now)] : a;
      a *= k;
      if (a <= 0.002) continue;
      var cx = g.x * tr.z + tr.tx, cy = g.y * tr.z + tr.ty, rx = g.rx * tr.z, ry = g.ry * tr.z;
      if (cx + rx < 0 || cx - rx > W || cy + ry < 0 || cy - ry > H) continue;
      tctx.setTransform(1, 0, 0, ry / rx, cx, cy);
      var gr = tctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      for (var j = 0; j < stops.length; j++) gr.addColorStop(stops[j], rgba(g.rgb, a * fall[j]));
      tctx.fillStyle = gr;
      tctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
    }
    // the active zone's lamp pool (glow.js), warm and smooth
    var pools = ROOM.glow && ROOM.glow.pools ? ROOM.glow.pools() : [];
    for (var q = 0; q < pools.length; q++) {
      var pl = pools[q];
      var px = pl.x * tr.z + tr.tx, py = pl.y * tr.z + tr.ty, pr = pl.r * tr.z;
      tctx.setTransform(1, 0, 0, 1, px, py);
      var pg = tctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      for (var pj = 0; pj < stops.length; pj++) pg.addColorStop(stops[pj], rgba([255, 190, 112], pl.a * k * fall[pj]));
      tctx.fillStyle = pg;
      tctx.fillRect(-pr, -pr, 2 * pr, 2 * pr);
    }
    var v = spec.vignette;
    var vx = v.x * tr.z + tr.tx, vy = v.y * tr.z + tr.ty, vr = v.rx * tr.z;
    tctx.setTransform(1, 0, 0, v.ry / v.rx, vx, vy);
    tctx.globalCompositeOperation = 'multiply';
    var vg = tctx.createRadialGradient(0, 0, 0, 0, 0, vr);
    var vs = spec.vstops || [0, 0.25, 0.5, 0.75, 1];
    vg.addColorStop(0, '#fff');
    for (var m = 0; m < vs.length; m++) {
      var t = vs[m], e = t * t * (3 - 2 * t);
      var col = [0, 1, 2].map(function (c) {
        return Math.round(255 * (1 - e * (1 - v.c[c])));
      });
      vg.addColorStop(v.inner + t * (1 - v.inner), 'rgb(' + col.join(',') + ')');
    }
    tctx.fillStyle = vg;
    // cover the whole canvas (the gradient pads beyond its radius with the last stop)
    var inv = v.rx / v.ry;
    tctx.fillRect(-vx - 10, (-vy - 10) * inv, W + 20, (H + 20) * inv);
    tctx.restore();
  }
  function lightKey(now) {
    var spec = lightSpec();
    if (!spec || !spec.anims || ROOM.state.reducedMotion) return '';
    var k = '';
    Object.keys(spec.anims).forEach(function (ch) {
      k += chanFrame(spec, ch, now) + ',';
    });
    return k;
  }

  /* ------------------------------------------------------------------ view and camera */
  var canvas, ctx;
  var view = null;
  var pan = { x: MID_X, v: 0, target: null, dragging: false };
  var panSpeed = 0; // smoothed pan speed (CSS px/s) that drives the phone-pan layer depth
  var hoverId = null, focusId = null;
  var lastZone = null;
  var NO_LS = { scene: 'front', zone: null, focusK: 0, dimK: 0, poolK: 0, hover: null, focus: null, inspect: false, skill: null, statueLight: false, snap: false };

  /** LightState from the globals (boot, before nav.js is ready); nav.js supplies the real one. */
  function legacyLs() {
    var zone = ROOM.state.zone || null;
    return {
      scene: ROOM.sceneKey(),
      zone: zone,
      focusK: zone ? 1 : 0,
      dimK: ROOM.state.panel ? 1 : 0,
      poolK: zone ? 1 : 0,
      hover: hoverId,
      focus: focusId,
      inspect: !!ROOM.state.inspect,
      skill: null,
      statueLight: !!ROOM.state.statueLight,
      snap: false,
    };
  }
  // nav.ls() must not call back into ROOM.render.ls() (mutual recursion): it builds its own state.
  function currentLs() {
    return ROOM.nav && typeof ROOM.nav.ls === 'function' ? ROOM.nav.ls() || legacyLs() : legacyLs();
  }
  /** The place whose camera the rest frame uses (the navigator's landed place, or a live leg's target). */
  function restPlace() {
    var n = ROOM.nav;
    var p = n && (n.scenePlace || n.place);
    if (p) return p;
    var st = ROOM.state;
    return st.zone ? { mode: 'zone', view: ROOM.normView(st.view), zone: st.zone } : { mode: 'wall', view: ROOM.normView(st.view), zone: null };
  }
  function overviewCamera() {
    if (!ROOM.overview || !ROOM.overview.camera) return null;
    var oc = ROOM.overview.camera(view.Wd, view.Hd, view.dpr, CAM.roomCamera(view, pan.x).z);
    if (!oc) return null;
    // overview.js returns {z, ox, oy}; CAM.origin works on centres: {cx, cy, z} with the same integer origin
    if (oc.cx != null) return oc;
    return { cx: (oc.ox + view.Wd / 2) / oc.z, cy: (oc.oy + view.Hd / 2) / oc.z, z: oc.z };
  }
  /** Rest camera of a place (CAM must be configured for its wall). Skill places use their backdrop camera. */
  function cameraFor(p) {
    if (p.mode === 'overview') {
      var oc = overviewCamera();
      if (oc) return oc;
    }
    var zid = p.mode === 'zone' ? p.zone : p.mode === 'skill' && p.base === 'zone' ? p.baseZone || p.zone : null;
    var z = zid ? ROOM.zoneById(zid) : null;
    if (z) return CAM.zoneCamera(view, z.focus);
    var same = ROOM.normView(p.view) === ROOM.normView(ROOM.state.view);
    var cam = CAM.roomCamera(view, same ? pan.x : MID_X);
    if (view.mode === 'pan' && same) cam.cx = pan.x; // unclamped while dragging, so the rubber band shows
    return cam;
  }
  /** The camera at rest for the current place. */
  function restCamera() {
    return cameraFor(restPlace());
  }

  function offsetsFor(z, ls) {
    ls = ls || currentLs();
    if (ROOM.state.reducedMotion || !view || view.mode !== 'pan' || ls.zone || ls.snap || ls.scene === 'top') return ZERO;
    return CAM.panDepthOffsets(panSpeed, view.s, z);
  }

  /* ------------------------------------------------------------------ rest frame */
  var fb = null, fbAux = null, fbMark = null, fbW = 0, fbH = 0, fbA = 0;
  var fbCanvas = null, fbCtx = null, fbImage = null, fbU32 = null;
  var lastRest = null;

  // Buffers hold w x (h + atlas rows): the skill view's hero atlas sits below the room rows (f.h stays the room).
  function ensureFb(w, h) {
    var A = ROOM.skill && ROOM.skill.atlasRows ? ROOM.skill.atlasRows() | 0 : 0;
    if (w === fbW && h === fbH && A === fbA && fb) return;
    var sameCanvas = w === fbW && h === fbH && fbCanvas;
    fbW = w;
    fbH = h;
    fbA = A;
    fb = new Uint8Array(w * (h + A));
    fbAux = new Uint8Array(w * (h + A) * 3);
    fbMark = new Uint8Array(w * (h + A));
    if (sameCanvas) return;
    fbCanvas = fbCanvas || document.createElement('canvas');
    fbCanvas.width = w;
    fbCanvas.height = h;
    fbCtx = fbCanvas.getContext('2d', { colorSpace: 'srgb' });
    fbImage = fbCtx.createImageData(w, h);
    fbU32 = new Uint32Array(fbImage.data.buffer);
  }

  function hoverRect(ls) {
    var id = ls.snap ? null : ls.hover || ls.focus;
    if (!id) return null;
    for (var i = 0; i < drawables.length; i++) {
      var h = drawables[i].id === id && drawables[i].hit;
      if (h) return { x: h[0], y: h[1], w: h[2], h: h[3] };
    }
    return null;
  }
  // How much the sky's cover takes off direct sun: 0 clear .. 0.85 storm (the live weather layer's state).
  var COVER = { clear: 0, partly: 0.25, overcast: 0.7, fog: 0.75, drizzle: 0.7, rain: 0.8, snow: 0.75, storm: 0.85 };
  /** The light state for now, with the weather's cloud cover dimming the sun: less key, patch, shafts and
   *  cast shadow, a little less saturation. The practical lights are untouched. */
  function weatherLight() {
    var st = ROOM.light && ROOM.light.current ? ROOM.light.current() : null;
    var w = ROOM.weather && ROOM.weather.state;
    if (!st || !w) return st;
    var k = Math.max(COVER[w.kind] || 0, Math.min(0.7, (w.cloud || 0) / 100 * 0.7));
    if (!k) return st;
    var o = {};
    for (var key in st) o[key] = st[key];
    var sun = 1 - k * (1 - (st.nightness || 0)); // at night the moon key is already weak
    ['direct', 'patchIntensity', 'castShadow', 'shafts'].forEach(function (f) {
      if (typeof o[f] === 'number') o[f] *= sun;
    });
    if (typeof o.keyIntensity === 'number') o.keyIntensity *= 1 - 0.55 * k;
    if (typeof o.saturation === 'number') o.saturation *= 1 - 0.2 * k;
    if (typeof o.warmth === 'number') o.warmth *= 1 - k;
    // the light through cloud is grey and cool: the key colour moves toward an overcast sky's
    var kc = st.keyColor;
    if (kc && kc.length === 3) {
      var lum = 0.2126 * kc[0] + 0.7152 * kc[1] + 0.0722 * kc[2];
      var grey = [lum * 0.86, lum * 0.94, lum * 1.12];
      o.keyColor = [0, 1, 2].map(function (i) {
        return kc[i] + (grey[i] - kc[i]) * k;
      });
    }
    return o;
  }

  /**
   * Options the GPU compositor takes with each frame (INTERFACES.md section 6, PLAN 2.4): explicit dim and zone
   * focus k from the LightState. focus carries both the v3.5 shape ({rect, k}) and the rect fields gl.js read
   * before it.
   */
  function gpuOpts(now, ls) {
    var z = ls.zone && ls.focusK > 0 ? ROOM.zoneById(ls.zone) : null;
    var fr = z && z.focus ? { x: z.focus[0], y: z.focus[1], w: z.focus[2], h: z.focus[3] } : null;
    return {
      dim: ls.dimK || 0,
      focus: fr ? { x: fr.x, y: fr.y, w: fr.w, h: fr.h, rect: fr, k: ls.focusK } : null,
      hover: hoverRect(ls),
      pools: ROOM.glow && ROOM.glow.pools ? ROOM.glow.pools() : null,
      statueBurst: Math.max(ls.statueLight ? 1 : 0, ROOM.statue ? ROOM.statue.burst(now) : 0),
      flash: ROOM.weather ? ROOM.weather.flash(now) : 0,
      state: weatherLight(),
    };
  }

  /**
   * Draw the place in ls (scene, focus, dim, hover) into target {ctx, W, H} (device px) for camera cam with device
   * origin org. The main canvas uses it every rest frame; shots and snapshots use it offscreen.
   */
  function drawFrame(now, cam, org, target, marks, ls) {
    ls = ls || currentLs();
    var z = cam.z;
    var x0 = Math.floor(org.ox / z), y0 = Math.floor(org.oy / z);
    ensureFb(Math.ceil(target.W / z) + 1, Math.ceil(target.H / z) + 1);
    fb.fill(C.VOID); // beyond the painted art is VOID
    fbAux.fill(0);
    fbMark.fill(0);
    var offs = marks ? offsetsFor(z, ls) : ZERO;
    var inZone = !!ls.zone;
    var gpu = gpuOn();
    // gl=off: the panel dim is a Bayer step between the ramp and the ramp + DIM (16 steps of ls.dimK)
    var lutA = light.from, lutB = light.to, step = light.step;
    if (!gpu && light.step >= 16 && light.base) {
      var dk = Math.round(16 * Math.max(0, Math.min(1, ls.dimK || 0)));
      lutA = lutFor(light.base, false);
      lutB = dk ? lutFor(light.base, true) : lutA;
      step = dk;
    }
    var f = {
      buf: fb, aux: fbAux, mark: fbMark, w: fbW, h: fbH, x0: x0, y0: y0, offs: offs, now: now,
      lutA: lutA, lutB: lutB, step: step, z: z, cam: cam, org: org, atlas: null, ls: ls,
    };
    drawItems(
      f,
      function (d) {
        return !(inZone && d.layer === 6); // frame crops are hidden in a zone
      },
      { marks: marks, outline: marks }
    );
    for (var mp = 0; mp < markPasses.length; mp++) markPasses[mp].fn(f, ls, now);
    var sk = ROOM.skill && ROOM.skill.frame ? ROOM.skill.frame(f, ls, now) : null;
    if (ROOM.weather && ls.scene !== 'top') ROOM.weather.draw(f);
    if (marks) {
      if (ROOM.glow) ROOM.glow.post(f, ls, gpu);
      if (ROOM.fx && ls.scene !== 'top') ROOM.fx.drawMotes(f);
      if (ROOM.overlay && !ROOM.state.photo) ROOM.overlay.drawMarks(f, ls);
    }
    var tc = target.ctx;
    tc.imageSmoothingEnabled = false;
    var lit = null;
    if (gpu) {
      ROOM.gl.setView(ls.scene, (ROOM.viewConf(ls.scene) || {}).lighting || null);
      f.sceneVersion = sceneVersion;
      var go = gpuOpts(now, ls);
      if (sk) {
        go.hero = sk.hero || null;
        go.halo = sk.halo || null;
        go.atlas = f.atlas;
      }
      lit = ROOM.gl.frame(f, go);
      if (!lit && !ROOM.gl.lost && ROOM.gl.tier === 'off') gpuReady = false;
    }
    if (lit) {
      tc.drawImage(lit, 0, 0, fbW * z, fbH * z, x0 * z - org.ox, y0 * z - org.oy, fbW * z, fbH * z);
    } else {
      // Expand indices to RGBA and draw once at z, then the Canvas2D light (the v3.3 path).
      // Marked pixels (f.mark) always take the raw palette colour; EXPAND is the hook for a room-wide remap.
      var n = fbW * fbH, ex = EXPAND, anyMark = false;
      for (var i = 0; i < n; i++) {
        if (fbMark[i]) anyMark = true;
        fbU32[i] = fbMark[i] ? RGBA[fb[i]] : ex[fb[i]];
      }
      fbCtx.putImageData(fbImage, 0, 0);
      tc.drawImage(fbCanvas, x0 * z - org.ox, y0 * z - org.oy, fbW * z, fbH * z);
      var tr = { z: z, tx: -org.ox, ty: -org.oy };
      drawLight(tr, now, ls.dimK || 0, target);
      // A7: marks are lit like the art (drawLight above) but never below 70 % of their palette colour: lighten
      // (per-channel max) with a layer that holds only the marked pixels at 0.7 x palette.
      if (anyMark) {
        for (var j = 0; j < n; j++) fbU32[j] = fbMark[j] ? MARK_FLOOR[fb[j]] : 0;
        fbCtx.putImageData(fbImage, 0, 0);
        tc.globalCompositeOperation = 'lighten';
        tc.drawImage(fbCanvas, x0 * z - org.ox, y0 * z - org.oy, fbW * z, fbH * z);
        tc.globalCompositeOperation = 'source-over';
      }
      if (ROOM.skill && ROOM.skill.drawCanvas2D) ROOM.skill.drawCanvas2D(tc, f, tr, now, ls);
    }
    return { offs: offs, x0: x0, y0: y0, gpu: !!lit };
  }

  function renderRest(now) {
    var cam = restCamera();
    var org = CAM.origin(cam, view);
    var ls = currentLs();
    var r = drawFrame(now, cam, org, { ctx: ctx, W: view.Wd, H: view.Hd }, true, ls);
    var z = cam.z;
    lastRest = {
      cam: cam, org: org, offs: r.offs, z: z, x0: r.x0, y0: r.y0, gpu: r.gpu, ls: ls,
      key: [org.ox, org.oy, z, r.offs.join(','), sceneVersion, ls.scene, ls.zone, ls.skill, view.Wd, view.Hd].join('|'),
    };
    if (ROOM.overlay) ROOM.overlay.sync(lastRest);
    if (ROOM.statue) ROOM.statue.sync(lastRest);
    if (ROOM.calendar) ROOM.calendar.sync(lastRest);
  }

  /* ------------------------------------------------------------------ scenes, shots and snapshots (v3.5) */
  var sceneOverride = null; // the scene a snapshot draws (core.js sceneKey reads it)
  var dataStamp = 0; // bumped on every data or state change: snapshot cache key
  function sceneOf(p) {
    return p && p.mode === 'overview' ? 'top' : ROOM.normView(p && p.view);
  }
  /** Run fn with the scene (drawables, camera frame, ROOM.state.view) of place p, then restore the current one. */
  function withScene(p, fn) {
    var key = sceneOf(p);
    if (key === ROOM.sceneKey() && !sceneOverride) {
      if (sceneDirty) buildScene();
      return fn();
    }
    var sv = ROOM.state.view, so = sceneOverride, sl = drawables, sver = sceneVersion, sd = sceneDirty;
    sceneOverride = key;
    if (key !== 'top') {
      ROOM.state.view = key;
      CAM.configure(ROOM.viewConf(key));
    }
    try {
      buildScene();
      return fn();
    } finally {
      sceneOverride = so;
      ROOM.state.view = sv;
      CAM.configure(ROOM.viewConf(sv));
      drawables = sl;
      sceneVersion = sver;
      sceneDirty = sd;
    }
  }
  function lsFor(p, ls) {
    var o = {};
    for (var k in NO_LS) o[k] = ls && ls[k] !== undefined ? ls[k] : NO_LS[k];
    o.scene = sceneOf(p);
    o.hover = null;
    o.focus = null;
    o.snap = true;
    return o;
  }
  function placeKey(p) {
    return [p.mode, p.view, p.zone, p.item, p.base, p.baseZone].join(':');
  }
  function lsKey(l) {
    var r2 = function (v) {
      return Math.round((v || 0) * 100);
    };
    return [l.scene, l.zone, r2(l.focusK), r2(l.dimK), r2(l.poolK), l.inspect ? 1 : 0, l.skill, l.statueLight ? 1 : 0].join(',');
  }
  function newCanvas(W, H) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, W);
    c.height = Math.max(1, H);
    var cx = c.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = VOID_CSS;
    cx.fillRect(0, 0, c.width, c.height);
    return { c: c, cx: cx };
  }
  var maxTex = 0;
  function maxTexture() {
    if (!maxTex) maxTex = (ROOM.gl && ROOM.gl.maxTextureSize) || 8192;
    return maxTex;
  }

  var snapCache = new Map(), snapBytes = 0, SNAP_CAP = 96 * 1024 * 1024;
  var snapStats = { made: 0, hits: 0, lastMs: 0, maxMs: 0, maxPx: 0 };
  /**
   * Render place p with light state ls over world rect (art px) at snapshot zoom zS into an offscreen canvas
   * (PLAN 2.4). Same drawFrame as the rest frame (GPU or LUT path); grain frozen, no hover. LRU cache, 96 MB.
   * Returns {canvas, rect, z}.
   */
  function snap(p, ls, rect, zS) {
    var x = Math.floor(rect.x), y = Math.floor(rect.y);
    var R = { x: x, y: y, w: Math.ceil(rect.x + rect.w) - x, h: Math.ceil(rect.y + rect.h) - y };
    zS = Math.max(1, Math.round(zS || 1));
    var l = lsFor(p, ls);
    var key = [placeKey(p), lsKey(l), R.x, R.y, R.w, R.h, zS, light.key, dataStamp, ROOM.state.night ? 1 : 0,
      gpuOn() ? ROOM.gl.tier : 'off', Math.floor(ROOM.now() / 60000)].join('|');
    var hit = snapCache.get(key);
    if (hit) {
      snapCache.delete(key);
      snapCache.set(key, hit);
      snapStats.hits++;
      return hit;
    }
    var t0 = performance.now();
    var nc = newCanvas(R.w * zS, R.h * zS);
    withScene(p, function () {
      drawFrame(ROOM.now(), { z: zS }, { ox: R.x * zS, oy: R.y * zS }, { ctx: nc.cx, W: nc.c.width, H: nc.c.height }, true, l);
    });
    var s = { canvas: nc.c, rect: R, z: zS };
    snapStats.made++;
    snapStats.lastMs = performance.now() - t0;
    snapStats.maxMs = Math.max(snapStats.maxMs, snapStats.lastMs);
    snapStats.maxPx = Math.max(snapStats.maxPx, nc.c.width * nc.c.height);
    snapCache.set(key, s);
    snapBytes += nc.c.width * nc.c.height * 4;
    while (snapBytes > SNAP_CAP && snapCache.size > 1) {
      var k0 = snapCache.keys().next().value;
      var o = snapCache.get(k0);
      snapBytes -= o.canvas.width * o.canvas.height * 4;
      snapCache.delete(k0);
    }
    return s;
  }
  function dropSnapshots() {
    snapCache.clear();
    snapBytes = 0;
  }
  /** A wall's full master (its whole art rect) at the largest zoom dividing z within 6 MP. */
  function master(p, ls, z) {
    var a = (ROOM.viewConf(sceneOf(p)) || {}).art || { x: CAM.ART.x0, y: CAM.ART.y0, w: CAM.ART.x1 - CAM.ART.x0, h: CAM.ART.y1 - CAM.ART.y0 };
    return snap(p, ls, a, CAM.snapZoom(z, a.w, a.h, 6e6, maxTexture()));
  }

  /**
   * A shot: place p at rest, exactly as the rest frame would draw it (screen size, the place's rest camera).
   * {canvas, cam, org, wx, wy, s}: canvas px (0, 0) is world (wx, wy), s canvas px per world px.
   */
  function shot(p, ls) {
    var out = null;
    withScene(p, function () {
      var cam = cameraFor(p), org = CAM.origin(cam, view);
      var nc = newCanvas(view.Wd, view.Hd);
      drawFrame(ROOM.now(), cam, org, { ctx: nc.cx, W: view.Wd, H: view.Hd }, true, lsFor(p, ls));
      out = { canvas: nc.c, cam: cam, org: org, wx: org.ox / cam.z, wy: org.oy / cam.z, s: cam.z };
    });
    return out;
  }
  /** The main canvas as it is now (the frame the move starts from), as a shot of camera cam. */
  function grab(cam) {
    var nc = newCanvas(canvas.width, canvas.height);
    nc.cx.drawImage(canvas, 0, 0);
    var org = CAM.origin(cam, view);
    return { canvas: nc.c, cam: cam, org: org, wx: org.ox / cam.z, wy: org.oy / cam.z, s: cam.z };
  }
  function snapAsShot(sn) {
    return { canvas: sn.canvas, wx: sn.rect.x, wy: sn.rect.y, s: sn.z };
  }

  /* ------------------------------------------------------------------ Bayer dissolve */
  var scratch = null, scratchCtx = null, patCache = {};
  function ensureScratch() {
    if (!scratch) {
      scratch = document.createElement('canvas');
      scratchCtx = scratch.getContext('2d', { colorSpace: 'srgb' });
    }
    if (scratch.width !== canvas.width || scratch.height !== canvas.height) {
      scratch.width = canvas.width;
      scratch.height = canvas.height;
    }
    scratchCtx.imageSmoothingEnabled = false;
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    return scratchCtx;
  }
  function bayerPattern(step, cell) {
    var key = step + ':' + cell;
    if (patCache[key]) return patCache[key];
    var c = document.createElement('canvas');
    c.width = c.height = 4 * cell;
    var x = c.getContext('2d');
    x.fillStyle = '#000';
    for (var i = 0; i < 16; i++) if (BAYER[i] < step) x.fillRect((i & 3) * cell, (i >> 2) * cell, cell, cell);
    patCache[key] = c;
    return c;
  }
  /**
   * Bayer dissolve onto the main canvas: drawA paints the old image on the main canvas, drawB the new one on the
   * scratch canvas; k (0..1) of the new shows through a 4x4 Bayer mask of cell device px anchored at (ax, ay)
   * (the world origin on screen, so the stipple does not crawl). Colours stay those of one image or the other.
   */
  function dissolve(drawA, drawB, k, cell, ax, ay) {
    var step = Math.max(0, Math.min(16, Math.round(16 * k)));
    if (step < 16) drawA(ctx);
    if (step <= 0) return;
    if (step >= 16) {
      drawB(ctx);
      return;
    }
    var sc = ensureScratch();
    drawB(sc);
    cell = Math.max(1, Math.round(cell));
    var pat = sc.createPattern(bayerPattern(step, cell), 'repeat');
    var P = 4 * cell;
    var mx = ((Math.round(ax) % P) + P) % P, my = ((Math.round(ay) % P) + P) % P;
    sc.globalCompositeOperation = 'destination-in';
    sc.translate(mx, my);
    sc.fillStyle = pat;
    sc.fillRect(-mx, -my, scratch.width, scratch.height);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0);
  }
  function clearVoid(c) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = VOID_CSS;
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  /** Draw a shot under world transform tr (device = world * z + t), snapped to whole device pixels. */
  function drawShot(c, sh, tr) {
    if (!sh) return;
    var x0 = Math.round(sh.wx * tr.z + tr.tx), y0 = Math.round(sh.wy * tr.z + tr.ty);
    var x1 = Math.round((sh.wx + sh.canvas.width / sh.s) * tr.z + tr.tx);
    var y1 = Math.round((sh.wy + sh.canvas.height / sh.s) * tr.z + tr.ty);
    c.drawImage(sh.canvas, x0, y0, x1 - x0, y1 - y0);
  }
  function contains(a, b) {
    return a.x <= b.x + 0.01 && a.y <= b.y + 0.01 && a.x + a.w >= b.x + b.w - 0.01 && a.y + a.h >= b.y + b.h - 0.01;
  }
  function padRect(rects, pad) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(function (r) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    });
    x0 = Math.floor(x0) - pad;
    y0 = Math.floor(y0) - pad;
    return { x: x0, y: y0, w: Math.ceil(x1) + pad - x0, h: Math.ceil(y1) + pad - y0 };
  }

  /* ------------------------------------------------------------------ legs (drawn by the navigator's clock) */
  /** The camera of a place right now, with the scene's frame configured (for the plan of a leg). */
  function camOf(p) {
    var c = null;
    withScene(p, function () {
      c = cameraFor(p);
    });
    return c;
  }

  /**
   * Prepare a camera leg. spec: {kind: 'dolly'|'turn'|'rise'|'descend', from, to, lsFrom, lsTo, dir, steps, dur}.
   * The current canvas is the first frame (exact); the destination's rest frame is the last one (exact).
   */
  function beginLeg(spec) {
    var now = ROOM.now();
    if (light.key === null) updateLighting(now);
    if (sceneDirty) buildScene();
    var leg = { kind: spec.kind, spec: spec, t0: now };
    var fromCam = lastRest && lastRest.cam ? lastRest.cam : camOf(spec.from);
    if (spec.kind === 'dolly') planDolly(leg, spec, fromCam);
    else if (spec.kind === 'turn') planTurn(leg, spec, fromCam);
    else planRise(leg, spec, fromCam);
    if (ROOM.overlay) ROOM.overlay.setHidden(true);
    return leg;
  }

  function planDolly(leg, spec, fromCam) {
    var to = spec.to;
    if (spec.from.mode === 'zone' && to.mode === 'wall' && view.mode === 'pan') {
      // back to the wall on the phone: settle on the zone's stop
      var zf = ROOM.zoneById(spec.from.zone);
      if (zf) {
        pan.x = zf.stop;
        pan.v = 0;
        pan.target = null;
      }
    }
    var toCam = camOf(to);
    leg.plan = CAM.dollyPlan(fromCam, toCam, view);
    var R = padRect([CAM.visibleRect(fromCam, view), CAM.visibleRect(toCam, view)], 12);
    leg.A = [grab(fromCam)];
    leg.B = [shot(to, spec.lsTo)];
    if (!contains(CAM.visibleRect(fromCam, view), R)) leg.A.unshift(snapAsShot(snap(spec.from, spec.lsFrom, R, CAM.snapZoom(fromCam.z, R.w, R.h, 6e6, maxTexture()))));
    if (!contains(CAM.visibleRect(toCam, view), R)) leg.B.unshift(snapAsShot(snap(to, spec.lsTo, R, CAM.snapZoom(toCam.z, R.w, R.h, 6e6, maxTexture()))));
    // v3.5 motion pass: no anticipation pull-back (it read as a stall then a jump); the length follows the screen
    // distance the dolly covers (CAM.dollyMs), so a short slide is short and a long push-in does not race
    leg.lead = 0;
    leg.move = CAM.dollyMs(CAM.dollyDistance(leg.plan));
    leg.dur = leg.move;
  }
  function drawDolly(leg, t) {
    var u = Math.max(0, Math.min(1, t / leg.move));
    var tr = CAM.dollyAt(leg.plan, u);
    var kB = CAM.smoothstep(0.2, 0.9, u);
    leg.u = u;
    leg.pose = { z: tr.z, tx: tr.tx, ty: tr.ty };
    var paint = function (list) {
      return function (c) {
        clearVoid(c);
        for (var i = 0; i < list.length; i++) drawShot(c, list[i], tr);
      };
    };
    dissolve(paint(leg.A), paint(leg.B), kB, tr.z, tr.tx, tr.ty);
  }

  /* TURN: the four views are 90 degree faces of one camera, so a turn is a pure yaw: every screen column at angle
   * phi shows the column at angle phi + theta of whichever view owns that direction, scaled vertically about the
   * horizon by cos(a) / cos(phi). Each wall in the chain is one lit master (whole art rect); the walls hand over at
   * the room corners (45 degrees) with a 10 degree blend. TURN+ZOOM adds a geometric zoom and a vanishing-point
   * slide between the two cameras. The exact first and last frames are re-projected the same way and dissolve
   * into the masters over the first 120 ms and out of them over the last 200 ms, so both ends are pixel exact
   * even where a master is a magnified snapshot (TURN_EDGE_DISSOLVE, D4 3.4). */
  var SEAM_BAND = (10 * Math.PI) / 180, EDGE_IN = 120, EDGE_OUT = 200;
  function vpOf(v) {
    var vc = ROOM.viewConf(v) || {};
    return vc.vp || [CAM.CORE_W / 2, CAM.HORIZON];
  }
  function planTurn(leg, spec, fromCam) {
    var fromV = ROOM.normView(spec.from.view), toV = ROOM.normView(spec.to.view);
    var dir = spec.dir || ROOM.turnDir(fromV, toV) || 1;
    var chain = [fromV], v = fromV;
    while (v !== toV && chain.length < 4) {
      v = ROOM.viewToward(v, dir);
      chain.push(v);
    }
    leg.dir = dir;
    leg.chain = chain;
    leg.steps = chain.length - 1;
    var toCam = camOf(spec.to);
    leg.z0 = fromCam.z;
    leg.z1 = toCam.z;
    leg.dip = spec.from.mode === 'zone' && spec.to.mode === 'zone' ? 0.25 : 0;
    var vp = vpOf(fromV);
    var o0 = CAM.origin(fromCam, view), o1 = CAM.origin(toCam, view);
    leg.vx0 = vp[0] * fromCam.z - o0.ox;
    leg.vy0 = vp[1] * fromCam.z - o0.oy;
    var vp1 = vpOf(toV);
    leg.vx1 = vp1[0] * toCam.z - o1.ox;
    leg.vy1 = vp1[1] * toCam.z - o1.oy;
    leg.f = (ROOM.viewConf(fromV) || {}).f || CAM.CORE_W / 2;
    leg.srcs = [];
    for (var i = 0; i < chain.length; i++) addMaster(leg, i, spec);
    var exA = grab(fromCam), exB = shot(spec.to, spec.lsTo);
    leg.exA = { c: exA.canvas, vx: vp[0] * fromCam.z - o0.ox, vy: vp[1] * fromCam.z - o0.oy, s: fromCam.z };
    leg.exB = { c: exB.canvas, vx: vp1[0] * toCam.z - o1.ox, vy: vp1[1] * toCam.z - o1.oy, s: toCam.z };
    leg.th0 = 0;
    leg.th1 = leg.steps * (Math.PI / 2) * dir;
    leg.v0 = 0;
    leg.tStart = 0;
    leg.dur = spec.dur || [0, 640, 900, 1100][leg.steps] || 900;
    leg.dur0 = leg.dur;
  }
  function addMaster(leg, i, spec) {
    var cv = leg.chain[i], last = leg.chain.length - 1;
    var p = i === 0 ? spec.from : i === last ? spec.to : { mode: 'wall', view: cv, zone: null };
    var l = i === 0 ? spec.lsFrom : i === last ? spec.lsTo : null;
    if (i === last && p.mode === 'skill') l = spec.lsTo;
    var zRef = i === 0 ? leg.z0 : i === last ? leg.z1 : Math.min(leg.z0, leg.z1);
    var m = master({ mode: 'wall', view: cv }, l, zRef);
    var vp = vpOf(cv);
    leg.srcs[i] = { c: m.canvas, vx: (vp[0] - m.rect.x) * m.z, vy: (vp[1] - m.rect.y) * m.z, s: m.z };
  }
  /** Retarget a running turn one more wall in its direction (D4 5.3): keeps the current angular velocity. */
  function retargetTurn(leg, spec, t) {
    var th = turnAngle(leg, t), dth = turnSlope(leg, t);
    leg.chain.push(ROOM.normView(spec.to.view));
    leg.steps = leg.chain.length - 1;
    leg.spec = spec;
    var toCam = camOf(spec.to), o1 = CAM.origin(toCam, view), vp1 = vpOf(spec.to.view);
    // the old target wall becomes an intermediate master (room light); the new one takes the arrival light
    addMaster(leg, leg.chain.length - 2, { from: leg.spec.from, to: { mode: 'wall', view: leg.chain[leg.chain.length - 2] } });
    addMaster(leg, leg.chain.length - 1, spec);
    var exB = shot(spec.to, spec.lsTo);
    leg.exB = { c: exB.canvas, vx: vp1[0] * toCam.z - o1.ox, vy: vp1[1] * toCam.z - o1.oy, s: toCam.z };
    leg.z1 = toCam.z;
    leg.vx1 = vp1[0] * toCam.z - o1.ox;
    leg.vy1 = vp1[1] * toCam.z - o1.oy;
    var target = leg.steps * (Math.PI / 2) * leg.dir;
    var rem = Math.abs(target - th) / (Math.PI / 2);
    var dur = Math.max(240, 640 * rem);
    leg.th0 = th;
    leg.th1 = target;
    leg.v0 = dth * dur; // radians per unit of the new segment
    leg.tStart = t;
    leg.dur = t + dur;
    leg.retargeted = true;
  }
  function turnAngle(leg, t) {
    var span = leg.dur - leg.tStart;
    var s = span > 0 ? (t - leg.tStart) / span : 1;
    if (!leg.retargeted) return leg.th0 + (leg.th1 - leg.th0) * CAM.easeInOut(s);
    return CAM.hermite(leg.th0, leg.v0, leg.th1, s);
  }
  function turnSlope(leg, t) {
    var span = Math.max(1, leg.dur - leg.tStart);
    if (!leg.retargeted) {
      var s = (t - leg.tStart) / span, e = 1e-3;
      return (leg.th1 - leg.th0) * (CAM.easeInOut(s + e) - CAM.easeInOut(s - e)) / (2 * e) / span;
    }
    return CAM.hermiteSlope(leg.th0, leg.v0, leg.th1, (t - leg.tStart) / span) / span;
  }
  function drawTurn(leg, t) {
    var W = canvas.width;
    var th = turnAngle(leg, t);
    var p = Math.abs(th) / Math.max(1e-6, leg.steps * (Math.PI / 2)); // progress of the camera terms
    var zc = CAM.turnZoom(leg.z0, leg.z1, p, leg.dip);
    var vx = leg.vx0 + (leg.vx1 - leg.vx0) * p, vy = leg.vy0 + (leg.vy1 - leg.vy0) * p;
    var F = leg.f * zc, step = Math.max(2, Math.round(W / 640));
    var geo = { th: th, F: F, zc: zc, vx: vx, vy: vy, step: step };
    leg.u = p;
    leg.pose = { th: th, F: F, z: zc, vx: vx, vy: vy };
    var paint = function (exact, which) {
      return function (c) {
        clearVoid(c);
        turnColumns(c, leg, geo, null, -1);
        if (exact) turnColumns(c, leg, geo, exact, which);
      };
    };
    // within a hundredth of a degree of either end the exact frame is drawn as it is (no column resampling)
    var nearEnd = Math.abs(leg.th1 - th) < 2e-4 && t > leg.dur - 32;
    if (nearEnd || (Math.abs(th) < 2e-4 && !leg.retargeted)) {
      clearVoid(ctx);
      ctx.drawImage(nearEnd ? leg.exB.c : leg.exA.c, 0, 0);
      return;
    }
    if (t < EDGE_IN && !leg.retargeted) dissolve(paint(null), paint(leg.exA, 0), 1 - t / EDGE_IN, zc, 0, 0);
    else if (t > leg.dur - EDGE_OUT) dissolve(paint(null), paint(leg.exB, leg.steps), Math.min(1, (t - (leg.dur - EDGE_OUT)) / (EDGE_OUT - 32)), zc, 0, 0);
    else paint(null)(ctx);
  }
  // Every column of a turn frame from the masters; with exact, only view `which`'s columns that the exact shot holds.
  function turnColumns(c, leg, g, exact, which) {
    var W = canvas.width;
    for (var x = 0; x < W; x += g.step) {
      var phi = Math.atan((x + g.step / 2 - g.vx) / g.F);
      var a = phi + g.th;
      var n = Math.round(a / (Math.PI / 2));
      var k = n * leg.dir;
      if (k < 0 || k > leg.steps) continue;
      var la = a - n * (Math.PI / 2);
      if (exact) {
        if (k === which) column(c, exact, la, phi, x, g, 1, true);
        continue;
      }
      column(c, leg.srcs[k], la, phi, x, g, 1, false);
      // near the corner where two walls hand over, the neighbour's column blends in (both masters hold valid
      // pixels 10 degrees past their edge), so the two walls' light meets as a gradient, not a line
      var d = Math.PI / 4 - Math.abs(la);
      if (d < SEAM_BAND) {
        var n2 = n + (la > 0 ? 1 : -1), k2 = n2 * leg.dir;
        if (k2 >= 0 && k2 <= leg.steps) column(c, leg.srcs[k2], a - n2 * (Math.PI / 2), phi, x, g, 0.5 * (1 - d / SEAM_BAND), false);
      }
    }
    c.globalAlpha = 1;
  }
  // One screen column: the source column at view angle la, scaled about the horizon by cos(la)/cos(phi) and by the
  // current zoom over the source's scale.
  function column(c, src, la, phi, x, g, alpha, clip) {
    var ca = Math.cos(la), cp = Math.cos(phi);
    var m = g.zc / src.s;
    var sx = src.vx + leg_f(g) * src.s * Math.tan(la);
    var sw = (g.step * cp * cp) / (ca * ca) / m;
    if (clip && (sx - sw / 2 < 0 || sx + sw / 2 > src.c.width)) return;
    var sc = (ca / cp) * m;
    var Hs = src.c.height;
    c.globalAlpha = alpha;
    c.drawImage(src.c, Math.max(0, sx - sw / 2), 0, Math.max(1, sw), Hs, x, g.vy - src.vy * sc, g.step, Hs * sc);
  }
  function leg_f(g) {
    return g.F / g.zc;
  }

  /* RISE / DESCEND (D2 2.7): the wall frame shrinks about its centre toward its anchor on the overview while the
   * overview grows from 1/s_A to 1 about the same point; Bayer k = smoothstep(.15, .75, u). DESCEND is the exact
   * time reverse toward the destination's anchor. */
  function planRise(leg, spec, fromCam) {
    var rise = spec.kind === 'rise';
    var wallP = rise ? spec.from : spec.to, ovP = rise ? spec.to : spec.from;
    var wallShot = rise ? grab(fromCam) : shot(wallP, spec.lsTo);
    var ovShot = rise ? shot(ovP, spec.lsTo) : grab(fromCam);
    var oc = overviewCamera();
    var a = ROOM.overview && ROOM.overview.anchor ? ROOM.overview.anchor(wallP) : null;
    var W = view.Wd, H = view.Hd;
    var ax = W / 2, ay = H / 2, aw = W * 0.5;
    if (oc && a) {
      var oo = CAM.origin(oc, view);
      ax = (a.x + a.w / 2) * oc.z - oo.ox;
      ay = (a.y + a.h / 2) * oc.z - oo.oy;
      aw = a.w * oc.z;
    }
    leg.wall = wallShot.canvas;
    leg.ov = ovShot.canvas;
    leg.ax = ax;
    leg.ay = ay;
    leg.sA = CAM.clamp(aw / W, 0.35, 0.8);
    leg.rise = rise;
    leg.dur = spec.dur || 520;
  }
  function drawRise(leg, t) {
    var u = Math.max(0, Math.min(1, t / leg.dur));
    var ur = leg.rise ? u : 1 - u; // the RISE parameter
    var e = CAM.easeInOut(ur);
    var W = view.Wd, H = view.Hd;
    var s = Math.pow(leg.sA, e);
    var cx = W / 2 + (leg.ax - W / 2) * e, cy = H / 2 + (leg.ay - H / 2) * e;
    var g = s / leg.sA;
    leg.u = u;
    leg.pose = { s: s, cx: cx, cy: cy };
    var wall = function (c) {
      clearVoid(c);
      var x0 = Math.round(cx - (W / 2) * s), y0 = Math.round(cy - (H / 2) * s);
      c.drawImage(leg.wall, x0, y0, Math.round(cx + (W / 2) * s) - x0, Math.round(cy + (H / 2) * s) - y0);
    };
    var ov = function (c) {
      clearVoid(c);
      var x0 = Math.round(cx - leg.ax * g), y0 = Math.round(cy - leg.ay * g);
      c.drawImage(leg.ov, x0, y0, Math.round(cx + (W - leg.ax) * g) - x0, Math.round(cy + (H - leg.ay) * g) - y0);
    };
    var kOv = CAM.smoothstep(0.15, 0.75, ur);
    dissolve(wall, ov, kOv, Math.max(1, Math.round((lastRest ? lastRest.z : 2) * s)), cx, cy);
  }

  /** Draw a camera leg at time t (ms since its start) on the main canvas. Returns false when t is past its end. */
  function drawLeg(leg, t) {
    if (t >= leg.dur) return false;
    ctx.save();
    if (leg.kind === 'dolly') drawDolly(leg, t);
    else if (leg.kind === 'turn') drawTurn(leg, t);
    else drawRise(leg, t);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    return true;
  }
  function endLeg() {
    if (ROOM.overlay) ROOM.overlay.setHidden(false);
    dirty = true;
  }

  /**
   * Land the renderer on place p: wall frame, scene and pan of its view. The navigator calls it when a move or a
   * leg lands (and for instant moves). Returns true when the wall changed.
   */
  function applyPlace(p) {
    var v = ROOM.normView(p.view || ROOM.state.view);
    var changed = v !== ROOM.normView(ROOM.state.view);
    if (changed) {
      ROOM.state.view = v;
      CAM.configure(ROOM.viewConf(v));
      pan.x = CAM.CORE_W / 2;
      pan.v = 0;
      pan.target = null;
    }
    var zid = p.mode === 'zone' ? p.zone : p.mode === 'skill' && p.base === 'zone' ? p.baseZone || p.zone : null;
    if (zid) lastZone = zid;
    sceneDirty = true;
    invalidate();
    return changed;
  }

  /* ------------------------------------------------------------------ scheduler */
  var raf = 0, timer = 0, dirty = true, lastTick = 0, lastDepthDraw = -1e9, lastOffsKey = '', lastAmbient = '';

  function kick() {
    if (!raf && !document.hidden && view) raf = requestAnimationFrame(tick);
  }
  function invalidate() {
    dirty = true;
    kick();
  }

  function ambientKey(now) {
    if (ROOM.state.reducedMotion) return '';
    var k = '';
    for (var i = 0; i < drawables.length; i++) {
      var d = drawables[i];
      if (d.frames) k += (Math.floor((now / 1000) * d.fps) % d.frames.length) + ',';
      if (d.item.drift) {
        var o = driftOffset(d.item.drift, now);
        k += Math.floor(o.x) + ':' + o.y + ',';
      }
    }
    return k + '|' + lightKey(now) + '|' + (ROOM.fx ? ROOM.fx.ambientKey(now) : '') + '|' + (ROOM.glow ? ROOM.glow.ambientKey(now) : '') +
      '|' + (ROOM.weather ? ROOM.weather.ambientKey(now) : '') + '|' + (ROOM.statue ? ROOM.statue.ambientKey(now) : '') + '|' + (ROOM.calendar ? ROOM.calendar.ambientKey(now) : '') + '|' + (gpuOn() && ROOM.gl.ambientKey ? ROOM.gl.ambientKey(now) : '');
  }
  function hasAmbient() {
    if (ROOM.state.reducedMotion) return false;
    for (var i = 0; i < drawables.length; i++) if (drawables[i].frames || drawables[i].item.drift) return true;
    if (lightKey(0) !== '') return true;
    if (ROOM.weather && ROOM.weather.hasAmbient()) return true;
    if (ROOM.statue && ROOM.statue.hasAmbient()) return true;
    if (ROOM.calendar && ROOM.calendar.hasAmbient()) return true;
    if (gpuOn() && ROOM.gl.hasAmbient && ROOM.gl.hasAmbient()) return true;
    return (ROOM.fx && ROOM.fx.hasAmbient()) || (ROOM.glow && ROOM.glow.hasAmbient());
  }
  function scheduleAmbient() {
    if (timer || document.hidden || !hasAmbient()) return;
    timer = setTimeout(function () {
      timer = 0;
      kick();
    }, 100); // ambient animation runs at 10 fps
  }

  // rAF only: every frame samples the moves at its rAF timestamp (one time per frame, even pacing; a dropped frame
  // simply lands the motion where that later time puts it). Under ROOM.debug.freeze() the frozen clock rules.
  function tick(ts) {
    raf = 0;
    if (!view || !ctx) return;
    ROOM.clock.frame(ROOM.clock.frozen || typeof ts !== 'number' ? null : ts);
    try {
      frameTick();
    } finally {
      ROOM.clock.frame(null);
    }
  }
  function frameTick() {
    var now = ROOM.now();
    var dt = Math.max(0, Math.min(67, now - lastTick)); // up to 4 dropped frames are made up
    lastTick = now;
    if (sceneDirty) {
      buildScene();
      dirty = true;
    }
    var busy = false;
    // The navigator runs moves on this clock: a camera leg draws the frame itself; live legs (lift, drop, swap)
    // and light-state tweens ask for rest frames at display rate.
    var nv = ROOM.nav && ROOM.nav.tick ? ROOM.nav.tick(now) : null;
    if (nv === 'drawn') {
      kick();
      return;
    }
    if (nv === 'live') {
      dirty = true;
      busy = true;
    }
    // On the GPU path the sun clock decides night (night sky, lamps on), unless ?night= says otherwise.
    if (gpuOn() && ROOM.light && ROOM.light.current && !/[?&]night=/.test(window.location.search)) {
      var nt = !!ROOM.light.current().night;
      if (nt !== !!ROOM.state.night) {
        ROOM.state.night = nt;
        sceneDirty = true;
        buildScene();
        dirty = true;
      }
    }
    if (updateLighting(now)) dirty = true;
    if (light.step < 16) busy = true;

    // Phone pan: spring to the snap target after a release.
    if (view.mode === 'pan' && !ROOM.state.zone && pan.target != null && !pan.dragging) {
      var r = CAM.springStep(pan.x, pan.v, pan.target, dt / 1000); // exact for any dt: no slow-down on a dropped frame
      pan.x = r.x;
      pan.v = r.v;
      if (ROOM.state.reducedMotion || CAM.springSettled(pan.x, pan.v, pan.target)) {
        pan.x = pan.target;
        pan.v = 0;
        pan.target = null;
      }
      dirty = true;
      busy = true;
    }
    // On the phone, layers lead and lag with the pan speed, then realign at rest (no mouse-look).
    var speedTarget = view.mode === 'pan' && !ROOM.state.zone ? (pan.v * view.s) / view.dpr : 0;
    panSpeed += (speedTarget - panSpeed) * (1 - Math.exp(-dt / 180));
    if (Math.abs(speedTarget - panSpeed) < 1) panSpeed = speedTarget;
    else busy = true;
    var offsKey = offsetsFor(restCamera().z).join(',');
    if (offsKey !== lastOffsKey) {
      if (now - lastDepthDraw >= 33 || ROOM.clock.frozen) {
        lastOffsKey = offsKey;
        lastDepthDraw = now;
        dirty = true;
      } else busy = true; // 30 fps cap: come back next frame
    }
    if (ROOM.fx && ROOM.fx.busy(now)) {
      dirty = true;
      busy = true;
    }
    if (ROOM.glow && ROOM.glow.busy(now)) {
      dirty = true;
      busy = true;
    }
    if ((ROOM.statue && ROOM.statue.busy(now)) || (ROOM.weather && ROOM.weather.busy(now)) || (gpuOn() && ROOM.gl.busy && ROOM.gl.busy(now))) {
      dirty = true;
      busy = true;
    }
    var ak = ambientKey(now);
    if (ak !== lastAmbient) {
      lastAmbient = ak;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      renderRest(now);
    }
    if (busy && !ROOM.clock.frozen) kick();
    else scheduleAmbient();
  }

  /* ------------------------------------------------------------------ layout */
  function smallViewportHeight(dpr) {
    var probe = document.getElementById('svh-probe');
    if (!probe) return 0;
    return Math.round(probe.getBoundingClientRect().height * dpr);
  }

  function layout(Wd, Hd) {
    if (!(Wd > 0 && Hd > 0)) return;
    var dpr = window.devicePixelRatio || 1;
    if (!view || view.dpr !== dpr || CAM.shouldRescale(view, Wd, Hd)) {
      var hs = smallViewportHeight(dpr);
      view = CAM.viewFor(Wd, Hd, dpr, hs > 0 ? Math.min(hs, Hd) : Hd);
    } else {
      view = CAM.resizeView(view, Wd, Hd);
    }
    if (canvas.width !== Wd) canvas.width = Wd;
    if (canvas.height !== Hd) canvas.height = Hd;
    ctx.imageSmoothingEnabled = false; // resizing a canvas resets its context state
    if (ROOM.nav && ROOM.nav.snapMove) ROOM.nav.snapMove(); // a resize lands any move at once (D4 5.5)
    dropSnapshots();
    var b = CAM.panBounds(view);
    pan.x = CAM.clamp(pan.x, b.min, b.max);
    document.documentElement.dataset.roomMode = view.mode;
    ROOM.emit('layout', { view: view });
    invalidate();
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    // Exact device pixels where the browser reports them; otherwise round(css * dpr).
    var ro = new ResizeObserver(function (entries) {
      var e = entries[0];
      var dp = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
      var dpr = window.devicePixelRatio || 1;
      var w = Math.round(e.contentRect.width * dpr), h = Math.round(e.contentRect.height * dpr);
      // Trust the exact device box only when it agrees with css * dpr (emulated DPR in headless
      // Chromium reports CSS pixels there).
      if (dp && Math.abs(dp.inlineSize - w) <= 1 && Math.abs(dp.blockSize - h) <= 1) layout(dp.inlineSize, dp.blockSize);
      else layout(w, h);
    });
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' });
    } catch (err) {
      ro.observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (ROOM.nav && ROOM.nav.snapMove) ROOM.nav.snapMove();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(timer);
        timer = 0;
      } else {
        lastTick = ROOM.now();
        invalidate();
      }
    });
    ROOM.on('data', function () {
      sceneDirty = true;
      dataStamp++;
      invalidate();
    });
    ROOM.on('state', function () {
      sceneDirty = true;
      dataStamp++;
      invalidate();
    });
    ROOM.on('gltier', dropSnapshots);
  }

  /* ------------------------------------------------------------------ public API */
  // v3.5: the navigator (engine/nav.js) is the only way to move; these are thin wrappers over it (one release).
  ROOM.go = function (zoneId, opts) {
    return ROOM.nav ? ROOM.nav.go(zoneId, opts) : false;
  };
  ROOM.turn = function (dir, opts) {
    return ROOM.nav ? ROOM.nav.turn(dir, opts) : false;
  };
  ROOM.turnTo = function (v, opts) {
    return ROOM.nav ? ROOM.nav.turnTo(v, opts) : false;
  };
  ROOM.setDim = function (on) {
    if (ROOM.nav && ROOM.nav.setBoardDim) ROOM.nav.setBoardDim(!!on);
    invalidate();
  };

  ROOM.invalidate = invalidate;

  /** Screen box (CSS px, viewport coordinates) of an item at rest, or null when it is not on view. */
  ROOM.itemRectCss = function (itemId) {
    if (!view) return null;
    var d = null;
    for (var i = 0; i < drawables.length; i++) if (drawables[i].id === itemId) d = drawables[i];
    if (!d || (d.layer === 6 && currentLs().zone)) return null;
    var r = cssRectOf(d);
    var c = canvas.getBoundingClientRect();
    var box = { left: r.left + c.left, top: r.top + c.top, width: r.width, height: r.height };
    box.right = box.left + box.width;
    box.bottom = box.top + box.height;
    box.x = box.left;
    box.y = box.top;
    if (box.right < c.left || box.left > c.right || box.bottom < c.top || box.top > c.bottom) return null;
    return box;
  };

  // A drawable's hit box in CSS px relative to the canvas, for the camera at rest.
  function cssRectOf(d) {
    var cam = restCamera(), org = CAM.origin(cam, view), z = cam.z, o = offsetsFor(z)[d.layer] || 0;
    var h = d.hit;
    return {
      left: ((h[0] + o) * z - org.ox) / view.dpr,
      top: (h[1] * z - org.oy) / view.dpr,
      width: (h[2] * z) / view.dpr,
      height: (h[3] * z) / view.dpr,
    };
  }

  /** CSS point (relative to the canvas) to world coordinates for the camera at rest (layer 0 offsets). */
  function worldFromCss(x, y) {
    var cam = restCamera(), org = CAM.origin(cam, view);
    return { x: (x * view.dpr + org.ox) / cam.z, y: (y * view.dpr + org.oy) / cam.z };
  }

  ROOM.render = {
    init: init,
    enableGpu: enableGpu,
    // v3.5 moves (nav.js drives them on ROOM.now())
    beginLeg: beginLeg,
    drawLeg: drawLeg,
    endLeg: endLeg,
    retargetTurn: retargetTurn,
    turnAngle: turnAngle,
    applyPlace: applyPlace,
    /** Draw the current place at rest now (the navigator calls it before planning a leg mid-move). */
    restNow: function () {
      if (view && ctx) renderRest(ROOM.now());
    },
    cameraFor: function (p) {
      return view ? camOf(p) : null;
    },
    snap: snap,
    shot: shot,
    dropSnapshots: dropSnapshots,
    get snapStats() {
      return snapStats;
    },
    get sceneOverride() {
      return sceneOverride;
    },
    get gpu() {
      return gpuOn();
    },
    layout: layout,
    invalidate: invalidate,
    BAYER: BAYER,
    RGB: RGB,
    RGBA: RGBA,
    LUT: LUT,
    plot: plot,
    // v3.5 seams (PLAN 2.4)
    blit: blit,
    blitAux: blitAux,
    plotMark: plotMark,
    markDepth: markDepth,
    drawLight: drawLight,
    addMarkPass: addMarkPass,
    ls: currentLs,
    legacyLs: legacyLs,
    lightCatColor: lightCatColor,
    cssRectOf: cssRectOf,
    worldFromCss: worldFromCss,
    restCamera: function () {
      return view ? restCamera() : null;
    },
    get view() {
      return view;
    },
    get drawables() {
      if (sceneDirty) buildScene();
      return drawables;
    },
    get sceneVersion() {
      return sceneVersion;
    },
    // compat getters (one release): true while a DOLLY / TURN leg runs
    get dolly() {
      var l = ROOM.nav && ROOM.nav.leg;
      return l && l.kind === 'dolly' ? { u: l.u } : null;
    },
    get turning() {
      var l = ROOM.nav && ROOM.nav.leg;
      return !!(l && l.kind === 'turn');
    },
    get lastZone() {
      return lastZone;
    },
    get light() {
      return { key: light.key, step: light.step };
    },
    get offsets() {
      return view ? offsetsFor(restCamera().z) : ZERO;
    },
    get lastRest() {
      return lastRest;
    },
    get canvas() {
      return canvas;
    },
    pan: pan,
    weatherLight: weatherLight,
    setHover: function (id) {
      if (hoverId !== id) {
        hoverId = id;
        invalidate();
      }
    },
    setFocus: function (id) {
      if (focusId !== id) {
        focusId = id;
        invalidate();
      }
    },
    get hoverId() {
      return hoverId;
    },
    get focusId() {
      return focusId;
    },
    /** Run one scheduler tick now (tests drive frames with a frozen clock). */
    renderNow: function () {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      tick();
    },
    readFrame: function () {
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    },
    debugInfo: function () {
      var l = ROOM.nav && ROOM.nav.leg;
      return {
        view: ROOM.state.view,
        viewport: view,
        camera: view ? restCamera() : null,
        zone: ROOM.state.zone,
        nav: ROOM.nav && ROOM.nav.debug ? ROOM.nav.debug() : null,
        turn: l && l.kind === 'turn' ? { dir: l.dir, u: l.u } : null,
        dolly: l && l.kind === 'dolly' ? { u: l.u } : null,
        snaps: snapStats,
        light: { key: light.key, step: light.step },
        offsets: view ? offsetsFor(restCamera().z) : ZERO,
        pan: { x: pan.x, v: pan.v, target: pan.target },
        drawn: drawables.length,
        fb: [fbW, fbH],
      };
    },
  };
})();
