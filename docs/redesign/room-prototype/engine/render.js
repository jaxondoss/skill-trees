/* FORGE room prototype: renderer, camera controller and frame scheduler.
 *
 * At rest the room is drawn into an indexed framebuffer (one byte per world pixel, the visible window
 * plus 1 px), with every sprite passed through the current lighting LUT as it is blitted. Engine marks
 * (LEDs, outlines, dust, motes, nameplates, zone title) are written after the LUT, in true palette
 * colours. The buffer is expanded through a 256-entry RGBA table, put into a small canvas and drawn
 * once onto the device canvas at integer zoom z with smoothing off. Every frame is strictly in palette.
 *
 * Lighting changes use a 4x4 Bayer dissolve (16 steps) anchored to world coordinates: a pixel takes
 * the new LUT once its Bayer threshold is below the step.
 *
 * During the 450 ms dolly only, each layer is pre-rendered once into its own RGBA canvas and drawn per
 * frame at its own fractional zoom (camera.dollyLayer). Destination rectangles are snapped to whole
 * device pixels and smoothing is off, so sampling is nearest-neighbour and still never blends.
 * No globalAlpha anywhere: the dim is a LUT.
 *
 * Frames are drawn only on change. Ambient motion (anim sprites, LED blink, skill glow, embers) ticks
 * at 10 fps at most, phone-pan depth at 30 fps at most, the dolly, dissolve and phone pan at display
 * rate. Hidden tabs pause. There is no mouse-look parallax: layers separate only during the dolly and
 * while the phone pan moves.
 *
 * Stepping into a zone: an 80 ms anticipation pull-back, the push-in, then on landing the rest of the
 * room dims in DIM steps, the clicked object gets a spotlight pulse and opts.onArrive runs (the ui
 * opens the panel). World size, horizon and zones come from ROOM_ART.zones (camera.configure).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var CAM = ROOM.camera;
  CAM.configure(ROOM.art.zones || {});
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
  var RGB = [];
  ROOM.art.palette.colors.forEach(function (c, i) {
    var h = c[1];
    var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    RGB[i] = [r, g, b];
    RGBA[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  });
  RGBA[T] = 0;
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
  var composed = {};
  // The lighting state is a base ramp (R1..R4 or NIGHT) with DIM optionally applied on top.
  function lutFor(base, dim) {
    var key = base + (dim ? '+DIM' : '');
    if (!composed[key]) {
      var out = new Uint8Array(256);
      for (var i = 0; i < 256; i++) out[i] = dim ? LUT.DIM[LUT[base][i]] : LUT[base][i];
      composed[key] = out;
    }
    return composed[key];
  }
  // Compose a per-item colour remap (applied first) with a LUT.
  function chain(remap, lut) {
    var out = new Uint8Array(256);
    for (var i = 0; i < 256; i++) out[i] = lut[remap[i]];
    return out;
  }

  /* ------------------------------------------------------------------ lighting state and dissolve */
  var dimOn = false;
  var light = { key: null, base: null, from: null, to: null, t0: 0, dur: 0, step: 16 };

  function lightTarget() {
    var base = ROOM.state.night ? 'NIGHT' : ROOM.rampOf(ROOM.data.todayP || 0);
    return { base: base, dim: dimOn, key: base + (dimOn ? '+DIM' : '') };
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
      light.dur = t.base !== light.base ? 1200 : 300; // sky 1.2 s, dim 0.3 s
      light.t0 = now;
      light.key = t.key;
      light.base = t.base;
      light.step = ROOM.state.reducedMotion ? 16 : 0;
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
    ROOM.art.items.forEach(function (it, order) {
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
      };
      // Anim frames replace the base look only (a night or alert variant is a still).
      if (it.anim && it.anim.frames && it.anim.frames.length > 1 && (key === 'base' || !it.variants.base)) {
        d.frames = it.anim.frames;
        d.fps = Math.min(10, it.anim.fps || 4);
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
    if (ROOM.glow) ROOM.glow.relicDrawables().forEach(function (d) {
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

  /* ------------------------------------------------------------------ blitting */
  /**
   * Copy a sprite into an index buffer through two colour tables, skipping transparent pixels.
   * Pixels whose world-anchored Bayer threshold is below `step` use tB, the rest tA.
   * (bx, by) is the world position of the buffer's (0, 0).
   */
  function blit(dst, dw, dh, img, dx, dy, tA, tB, step, bx, by) {
    var sw = img.w, src = img.px;
    var x0 = Math.max(0, -dx), y0 = Math.max(0, -dy);
    var x1 = Math.min(sw, dw - dx), y1 = Math.min(img.h, dh - dy);
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
      if (ROOM.glow) {
        var sA = ROOM.glow.spotTable(d, tA, f.now);
        if (sA) {
          tA = sA;
          tB = tA === tB ? sA : ROOM.glow.spotTable(d, tB, f.now);
        }
      }
      blit(f.buf, f.w, f.h, img, dx, dy, tA, tB, f.step, f.x0, f.y0);
      if (opts.marks) {
        if (d.dust) ROOM.fx.drawDust(f, img, dx, dy);
        if (ROOM.glow) {
          if (opts.outline) ROOM.glow.drawSkillGlow(f, d, img, dx, dy);
          ROOM.glow.drawEmbers(f, d, img, dx, dy);
          ROOM.glow.drawSpotRing(f, d, img, dx, dy);
        }
        if (d.led && d.hotspot) ROOM.fx.drawLed(f, d, d.led[0] + f.offs[d.layer] - f.x0, d.led[1] - f.y0);
      }
      if (opts.outline && d.hotspot && !(d.skill && ROOM.glow) && (d.id === hoverId || d.id === focusId || ROOM.state.inspect)) {
        var ring = D.ring(img), col = lightCatColor(d.cat);
        for (var k = 0; k < ring.length; k += 2) plot(f, dx + ring[k], dy + ring[k + 1], col);
      }
    }
  }

  /* ------------------------------------------------------------------ view and camera */
  var stage, canvas, ctx;
  var view = null;
  var pan = { x: MID_X, v: 0, target: null, dragging: false };
  var panSpeed = 0; // smoothed pan speed (CSS px/s) that drives the phone-pan layer depth
  var arrive = null; // {item, fn}: what to do once the camera lands in a zone
  var hoverId = null, focusId = null;
  var lastZone = null;

  function zoneObj() {
    return ROOM.state.zone ? ROOM.zoneById(ROOM.state.zone) : null;
  }

  /** The camera at rest for the current state (zone view, room view, or the phone pan position). */
  function restCamera() {
    var z = zoneObj();
    if (z) return CAM.zoneCamera(view, z.focus);
    var cam = CAM.roomCamera(view, pan.x);
    if (view.mode === 'pan') cam.cx = pan.x; // unclamped while dragging, so the rubber band shows
    return cam;
  }

  function offsetsFor(z) {
    if (ROOM.state.reducedMotion || !view || view.mode !== 'pan' || ROOM.state.zone) return ZERO;
    return CAM.panDepthOffsets(panSpeed, view.s, z);
  }

  /* ------------------------------------------------------------------ rest frame */
  var fb = null, fbW = 0, fbH = 0, fbCanvas = null, fbCtx = null, fbImage = null, fbU32 = null;
  var lastRest = null;

  function ensureFb(w, h) {
    if (w === fbW && h === fbH && fb) return;
    fbW = w;
    fbH = h;
    fb = new Uint8Array(w * h);
    fbCanvas = fbCanvas || document.createElement('canvas');
    fbCanvas.width = w;
    fbCanvas.height = h;
    fbCtx = fbCanvas.getContext('2d', { colorSpace: 'srgb' });
    fbImage = fbCtx.createImageData(w, h);
    fbU32 = new Uint32Array(fbImage.data.buffer);
  }

  function renderRest(now) {
    var cam = restCamera();
    var z = cam.z;
    var org = CAM.origin(cam, view);
    var x0 = Math.floor(org.ox / z), y0 = Math.floor(org.oy / z);
    ensureFb(Math.ceil(view.Wd / z) + 1, Math.ceil(view.Hd / z) + 1);
    fb.fill(C.VOID); // beyond the painted art is VOID
    var offs = offsetsFor(z);
    var inZone = !!ROOM.state.zone;
    var f = { buf: fb, w: fbW, h: fbH, x0: x0, y0: y0, offs: offs, now: now, lutA: light.from, lutB: light.to, step: light.step, z: z, cam: cam, org: org };
    drawItems(
      f,
      function (d) {
        return !(inZone && d.layer === 6); // frame crops are hidden once settled in a zone
      },
      { marks: true, outline: true }
    );
    if (ROOM.glow) ROOM.glow.post(f, dimOn);
    if (ROOM.fx) ROOM.fx.drawMotes(f);
    if (ROOM.overlay && !ROOM.state.photo) ROOM.overlay.drawMarks(f);
    // Expand indices to RGBA and draw once at z.
    for (var i = 0; i < fb.length; i++) fbU32[i] = RGBA[fb[i]];
    fbCtx.putImageData(fbImage, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fbCanvas, x0 * z - org.ox, y0 * z - org.oy, fbW * z, fbH * z);
    lastRest = { cam: cam, org: org, offs: offs, z: z, x0: x0, y0: y0, key: [org.ox, org.oy, z, offs.join(','), sceneVersion, ROOM.state.zone, view.Wd, view.Hd].join('|') };
    if (ROOM.overlay) ROOM.overlay.sync(lastRest);
  }

  /* ------------------------------------------------------------------ dolly */
  var dolly = null;

  // Render the drawables passing `filter` into a transparent RGBA canvas covering world rect R.
  function layerCanvas(R, base, filter) {
    var buf = new Uint8Array(R.w * R.h).fill(T);
    var f = { buf: buf, w: R.w, h: R.h, x0: R.x, y0: R.y, offs: ZERO, now: base.now, lutA: base.lutA, lutB: base.lutB, step: base.step };
    var any = false;
    drawItems(
      f,
      function (d) {
        var ok = filter(d);
        any = any || ok;
        return ok;
      },
      { marks: true, outline: false }
    );
    if (!any) return null;
    var c = document.createElement('canvas');
    c.width = R.w;
    c.height = R.h;
    var cx = c.getContext('2d', { colorSpace: 'srgb' });
    var im = cx.createImageData(R.w, R.h);
    var u = new Uint32Array(im.data.buffer);
    for (var i = 0; i < buf.length; i++) u[i] = RGBA[buf[i]];
    cx.putImageData(im, 0, 0);
    return c;
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

  function startDolly(from, to, fromZone, toZone) {
    var now = ROOM.now();
    var plan = CAM.dollyPlan(from, to, view);
    // Every layer stays inside the union of the start and end windows (it scales about the pivot
    // between the two), plus pan depth and rounding margin.
    var R = padRect([CAM.visibleRect(from, view), CAM.visibleRect(to, view)], 12);
    var base = { now: now, lutA: light.from, lutB: light.to, step: light.step };
    var layers = [];
    for (var L = 0; L <= 5; L++) {
      layers[L] = layerCanvas(R, base, (function (L) {
        return function (d) {
          return d.layer === L;
        };
      })(L));
    }
    // Frame crops slide off (room -> zone) or back on (zone -> room); between zones they stay hidden.
    var leaving = !fromZone && !!toZone, returning = !!fromZone && !toZone;
    var crops = [];
    if (leaving || returning) {
      var roomCam = leaving ? from : to;
      var R6 = padRect([CAM.visibleRect(roomCam, view)], 12);
      [-1, 1].forEach(function (side) {
        var w = 0;
        var c = layerCanvas(R6, base, function (d) {
          var ok = d.layer === 6 && (d.x + d.img.w / 2 < MID_X ? -1 : 1) === side;
          if (ok) w = Math.max(w, d.img.w); // slide the widest crop on this side fully clear
          return ok;
        });
        if (c) crops.push({ canvas: c, side: side, w: w, R: R6 });
      });
    }
    dolly = {
      plan: plan,
      R: R,
      layers: layers,
      crops: crops,
      leaving: leaving,
      // Push-ins into a zone get an anticipation pull-back first (not on the way out).
      lead: toZone && !ROOM.state.reducedMotion ? CAM.ANTICIPATE_MS : 0,
      t0: now,
      oFrom: offsetsFor(from.z),
      oTo: offsetsFor(to.z),
    };
    if (ROOM.overlay) ROOM.overlay.setHidden(true);
  }

  // Draw a canvas covering world rect R with transform tr, snapped to whole device pixels.
  function drawSnapped(c, R, tr, shiftX) {
    var x0 = Math.round(R.x * tr.z + tr.tx + shiftX), x1 = Math.round((R.x + R.w) * tr.z + tr.tx + shiftX);
    var y0 = Math.round(R.y * tr.z + tr.ty), y1 = Math.round((R.y + R.h) * tr.z + tr.ty);
    ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0);
  }

  /** Draw one dolly frame. Returns false once the dolly has finished (u >= 1). */
  function renderDolly(now) {
    var t = now - dolly.t0;
    var u = Math.max(0, (t - dolly.lead) / CAM.DOLLY_MS);
    // Scale about the screen centre: pulls back during the lead, released by the push-in.
    var k = !dolly.lead ? 1 : t < dolly.lead ? CAM.anticipation(t) : CAM.release(u);
    if (u >= 1) {
      endDolly();
      return false;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID_CSS;
    ctx.fillRect(0, 0, view.Wd, view.Hd);
    var p = dolly.plan;
    for (var L = 0; L <= 5; L++) {
      if (!dolly.layers[L]) continue;
      drawSnapped(dolly.layers[L], dolly.R, CAM.scaleAbout(CAM.dollyLayer(p, L, u, dolly.oFrom[L], dolly.oTo[L]), k, view), 0);
    }
    dolly.crops.forEach(function (cr) {
      var cam = dolly.leaving ? p.from : p.to;
      var o6 = dolly.leaving ? dolly.oFrom[6] : dolly.oTo[6];
      var slide = CAM.frameSlide(u, cr.side, cr.w, dolly.leaving) * cam.z;
      drawSnapped(cr.canvas, cr.R, CAM.restTransform(cam, view, o6), slide);
    });
    lastDollyU = u;
    return true;
  }
  var lastDollyU = null;

  function endDolly() {
    dolly = null;
    lastDollyU = null;
    if (ROOM.overlay) ROOM.overlay.setHidden(false);
    dirty = true;
    landed();
  }

  // The camera is at rest in the target: spotlight pulse on the clicked object, then onArrive.
  function landed() {
    var a = arrive;
    arrive = null;
    if (!a) return;
    if (a.item && ROOM.glow) ROOM.glow.spotlight(a.item);
    if (a.fn) setTimeout(a.fn, ROOM.state.reducedMotion || !a.item ? 0 : 220);
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
    }
    return k + '|' + (ROOM.fx ? ROOM.fx.ambientKey(now) : '') + '|' + (ROOM.glow ? ROOM.glow.ambientKey(now) : '');
  }
  function hasAmbient() {
    if (ROOM.state.reducedMotion) return false;
    for (var i = 0; i < drawables.length; i++) if (drawables[i].frames) return true;
    return (ROOM.fx && ROOM.fx.hasAmbient()) || (ROOM.glow && ROOM.glow.hasAmbient());
  }
  function scheduleAmbient() {
    if (timer || document.hidden || !hasAmbient()) return;
    timer = setTimeout(function () {
      timer = 0;
      kick();
    }, 100); // ambient animation runs at 10 fps
  }

  function tick() {
    raf = 0;
    if (!view || !ctx) return;
    var now = ROOM.now();
    var dt = Math.max(0, Math.min(100, now - lastTick));
    lastTick = now;
    if (sceneDirty) {
      buildScene();
      dirty = true;
    }
    if (dolly) {
      if (renderDolly(now)) {
        kick();
        return;
      }
    }
    var busy = false;
    if (updateLighting(now)) dirty = true;
    if (light.step < 16) busy = true;

    // Phone pan: spring to the snap target after a release.
    if (view.mode === 'pan' && !ROOM.state.zone && pan.target != null && !pan.dragging) {
      var r = CAM.springStep(pan.x, pan.v, pan.target, Math.min(0.05, dt / 1000));
      pan.x = r.x;
      pan.v = r.v;
      if (CAM.springSettled(pan.x, pan.v, pan.target)) {
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
    if (ROOM.overlay && ROOM.overlay.busy(now)) {
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
    if (dolly) endDolly();
    var b = CAM.panBounds(view);
    pan.x = CAM.clamp(pan.x, b.min, b.max);
    document.documentElement.dataset.roomMode = view.mode;
    ROOM.emit('layout', { view: view });
    invalidate();
  }

  function init(canvasEl, stageEl) {
    canvas = canvasEl;
    stage = stageEl;
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
      invalidate();
    });
    ROOM.on('state', function () {
      sceneDirty = true;
      invalidate();
    });
  }

  /* ------------------------------------------------------------------ public API */
  /**
   * Step into a zone (id) or back out to the room (null) with the dolly.
   * opts.push (default true) asks the router to push a history entry; opts.instant skips the dolly.
   * opts.item: the clicked object (spotlight pulse on landing); opts.onArrive: called once the camera
   * is at rest (also when already in that zone).
   */
  ROOM.go = function (zoneId, opts) {
    opts = opts || {};
    var zone = zoneId ? ROOM.zoneById(zoneId) : null;
    if (zoneId && !zone) return false;
    var id = zone ? zone.id : null;
    var prev = ROOM.state.zone;
    if (id === prev) {
      if (opts.item || opts.onArrive) {
        arrive = { item: opts.item || null, fn: opts.onArrive || null };
        if (!dolly) landed();
      }
      return false;
    }
    if (dolly) endDolly();
    arrive = opts.item || opts.onArrive ? { item: opts.item || null, fn: opts.onArrive || null } : null;
    if (id !== 'window' && ROOM.state.statueLight) ROOM.state.statueLight = false;
    var from = view ? restCamera() : null;
    if (!id && prev && view && view.mode === 'pan') {
      // Back to the room on the phone: settle on the zone's stop.
      pan.x = ROOM.zoneById(prev).stop;
      pan.v = 0;
      pan.target = null;
    }
    ROOM.state.zone = id;
    if (id) lastZone = id;
    if (view && from && !opts.instant && !ROOM.state.reducedMotion) {
      if (sceneDirty) buildScene();
      startDolly(from, restCamera(), prev, id);
    }
    ROOM.emit('zone', { zone: id, from: prev, push: opts.push !== false });
    if (!dolly) landed();
    invalidate();
    return true;
  };

  ROOM.setDim = function (on) {
    dimOn = !!on;
    invalidate();
  };

  ROOM.invalidate = invalidate;

  /** Screen box (CSS px, viewport coordinates) of an item at rest, or null when it is not on view. */
  ROOM.itemRectCss = function (itemId) {
    if (!view) return null;
    var d = null;
    for (var i = 0; i < drawables.length; i++) if (drawables[i].id === itemId) d = drawables[i];
    if (!d || (d.layer === 6 && ROOM.state.zone)) return null;
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
    var cam = restCamera(), org = CAM.origin(cam, view), z = cam.z, o = offsetsFor(z)[d.layer];
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
    layout: layout,
    invalidate: invalidate,
    BAYER: BAYER,
    RGB: RGB,
    RGBA: RGBA,
    LUT: LUT,
    plot: plot,
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
    get dolly() {
      return dolly;
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
    get canvas() {
      return canvas;
    },
    pan: pan,
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
      return {
        view: view,
        camera: view ? restCamera() : null,
        zone: ROOM.state.zone,
        dolly: dolly ? { u: lastDollyU, from: dolly.plan.from, to: dolly.plan.to } : null,
        light: { key: light.key, step: light.step },
        offsets: view ? offsetsFor(restCamera().z) : ZERO,
        pan: { x: pan.x, v: pan.v, target: pan.target },
        drawn: drawables.length,
        fb: [fbW, fbH],
      };
    },
  };
})();
