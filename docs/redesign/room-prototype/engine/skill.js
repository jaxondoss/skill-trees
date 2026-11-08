/* FORGE room v3.5: the skill view (ROOM.skill; D1-FINAL as amended by PLAN R1-R11, A6, A8).
 *
 * The camera never moves for an item on the wall you face: the item lifts out of the frame in whole-pixel zoom
 * steps and floats, lit, left of the board (laptop) or above the bottom sheet (phone). The navigator (nav.js) owns
 * the Move, history and the light-state tweens (dimK/focusK/poolK); this file owns the hero: which art, where it is
 * on screen (layout), its timeline (LIFT, DROP, SWAP, in-place dissolve, bob), and how it is drawn:
 *   GPU     frame() blits the hero (albedo + aux, bit6) into the atlas rows below the room rows; gl.js lights them in
 *           the same frame at their world place (worldOf), adds the SELECT light (slot 0, heroI * selK) and draws
 *           them at integer k (P7, Bayer dissolve heroK). The halo (display darkening, key halo, pool, contact
 *           shadow) is drawn by the grade pass on the room grid from opts.halo.
 *   gl=off  drawCanvas2D() draws the halo on the room grid and an offscreen hero lit through the ramp LUT (never
 *           DIM) plus drawLight (source-atop), at integer k with smoothing off.
 * The room item stays drawn (the "socket"; wire.js styles it while ls.skill is set). layout() is pure and exported
 * for Vitest (module.exports). All times are on ROOM.now(), so ROOM.debug.freeze()/advance() drives the timeline.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ layout (pure) */
  var BOARD_W = 420; // .ui-panel width (ui.css)
  var GAP = 12; // --ui-gap

  /**
   * Where the hero sits and at which integer zoom (D1 3.1). Inputs in CSS px except zRoom/zZone (device zooms) and
   * hero size (art px). Returns device px {x, y, k, box}: top-left snapped to a multiple of k, inside the clear box.
   *   laptop (vw > 640): clear box x 56..board.x - 12, y 62..vh - 52 (board always right: x = vw - 432)
   *   phone: band x 0..vw, y 92..sheetTop - 8 (sheet fixed at 58svh: sheetTop = 0.42 vh)
   */
  function layout(o) {
    var dpr = o.dpr || 1;
    var phone = o.phone != null ? !!o.phone : o.vw <= 640;
    var bx0, bx1, by0, by1;
    if (phone) {
      var st = o.sheetTop != null ? o.sheetTop : o.vh * 0.42;
      bx0 = 0;
      bx1 = o.vw;
      by0 = 92;
      by1 = st - 8;
    } else {
      var bl = o.board && o.board.x != null ? o.board.x : o.vw - GAP - BOARD_W;
      bx0 = 56;
      bx1 = bl - 12;
      by0 = 62;
      by1 = o.vh - 52;
    }
    // device px; the box edges round inwards so the hero never crosses them
    bx0 = Math.ceil(bx0 * dpr);
    by0 = Math.ceil(by0 * dpr);
    bx1 = Math.floor(bx1 * dpr);
    by1 = Math.floor(by1 * dpr);
    var bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
    var hw = Math.max(1, o.heroW), hh = Math.max(1, o.heroH);
    var zR = Math.max(1, o.zRoom | 0), zZ = Math.max(1, (o.zZone || o.zRoom * 2) | 0);
    var fit = Math.floor(Math.min((bw * 0.92) / hw, (bh * 0.92) / (hh + 10)));
    var want = Math.max(zZ + 1, Math.ceil(((phone ? 0.55 : 0.4) * bh) / hh));
    var k = Math.max(Math.min(want, fit, 3 * zR, 2 * zZ), Math.min(zR + 1, fit));
    k = Math.max(1, k | 0);
    var w = hw * k, h = hh * k;
    var cx = bx0 + bw / 2, cy = by0 + 0.47 * bh;
    var x = Math.round((cx - w / 2) / k) * k, y = Math.round((cy - h / 2) / k) * k;
    // inside the box (multiples of k); a hero larger than the box stays centred on it
    if (w <= bw) {
      if (x < bx0) x = Math.ceil(bx0 / k) * k;
      if (x + w > bx1) x = Math.floor((bx1 - w) / k) * k;
    }
    if (h <= bh) {
      if (y < by0) y = Math.ceil(by0 / k) * k;
      if (y + h > by1) y = Math.floor((by1 - h) / k) * k;
    }
    return { x: x, y: y, k: k, box: { x: bx0, y: by0, w: bw, h: bh }, phone: phone };
  }

  /* ------------------------------------------------------------------ pure timeline helpers */
  var MS = { lift: 360, drop: 280, swapDrop: 200, swapLift: 200, inPlace: 240, dim: 240, bob: 1200, hide: 120 };
  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function easeOut(u) {
    u = clamp01(u);
    return 1 - (1 - u) * (1 - u) * (1 - u);
  }
  function easeIn(u) {
    u = clamp01(u);
    return u * u * u;
  }
  /** Integer zoom at u on a flight from k0 to k1: every integer in between, equal slices of u. */
  function kAt(k0, k1, u) {
    var n = Math.abs(k1 - k0);
    if (!n) return k1;
    if (u >= 1) return k1;
    var s = Math.min(n, Math.floor(clamp01(u) * (n + 1)));
    return k0 + (k1 > k0 ? s : -s);
  }
  /** A Bayer dissolve value quantised to `steps` steps (0..1). */
  function stepK(v, steps) {
    return Math.floor(clamp01(v) * steps + 1e-6) / steps;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { layout: layout, kAt: kAt, stepK: stepK, MS: MS };
  }
  if (typeof window === 'undefined' || !window.ROOM) return;

  /* ================================================================== engine */
  var ROOM = window.ROOM;
  var C = ROOM.C;
  var T = 255;

  function R() {
    return ROOM.render;
  }
  function reduced() {
    return !!ROOM.state.reducedMotion;
  }
  function isPhone() {
    return ROOM.uikit && ROOM.uikit.isPhone ? ROOM.uikit.isPhone() : window.innerWidth <= 640;
  }

  var cur = null; // the hero: {id, room, heroItem, img, imgId, aw, ah, off, meta, slug}
  var anim = null; // {kind, t0, dur, from, to, ease, heroKAt(t), haloKAt(t), next}
  var shown = null; // {x, y, k} at rest once LIFT finished (device px of the main canvas)
  var shownAt = 0;
  var phase = 'closed'; // closed | lift | shown | drop
  var boardOpened = false;
  var boardOpts = null; // pending board options (skill tab) for the next LIFT
  var tall = { on: false, t0: 0 }; // phone sheet dragged tall: the hero hides in 2 Bayer steps
  var rowsMax = 0; // atlas rows, grow-only (D1 2.1.1)
  var last = null; // last computed state (heroState) for drawCanvas2D and rectCss
  var bobTimer = 0;
  var deferred = false; // LIFT asked for before the renderer had a view (boot): place the hero on the first frame
  var focusBack = null; // the control that opened the skill view (focus returns there once the hero has landed)

  /**
   * Focus back to the opener after DROP: the hotspot buttons are hidden while the hero flies, so try for up to
   * about a second until it is visible again (else the item's hotspot button, matched by data-id).
   */
  function refocus(id) {
    var el = focusBack;
    focusBack = null;
    var n = 0;
    (function again() {
      var a = document.activeElement;
      if (a && a !== document.body && !(a.closest && a.closest('.hs'))) return; // the user moved on
      var t = el && el.isConnected ? el : document.querySelector('.hs[data-id="' + id + '"]');
      if (t && !t.hidden && t.offsetParent !== null) {
        t.focus({ preventScroll: true });
        if (document.activeElement === t) return;
      }
      if (++n < 60) requestAnimationFrame(again);
    })();
  }

  /* ------------------------------------------------------------------ hero resolve */
  function resolve(id) {
    var h = ROOM.heroOf ? ROOM.heroOf(id) : null;
    if (!h) return null;
    var img = ROOM.decode.get(h.img);
    if (!img) return null;
    var hi = ROOM.itemById(id + '.hero');
    var hv = hi && hi.variants;
    var usesHero = !!(hv && (hv[ROOM.variantOf(h.item)] === h.img || hv.base === h.img));
    // atlas texel (1, 1) is the sprite's (0, 0): one texel of margin for the rim
    var ox = usesHero ? hi.x : h.item.x, oy = usesHero ? hi.y : h.item.y;
    if (!usesHero) {
      // the room sprite's own anchor: the variant can be offset from the item box (drawables carry d.x/d.y)
      var ds = R() ? R().drawables : [];
      for (var i = 0; i < ds.length; i++) {
        if (ds[i].id === id) {
          ox = ds[i].x;
          oy = ds[i].y;
        }
      }
    }
    var sk = ROOM.skillOf ? ROOM.skillOf(h.item) : null;
    return {
      id: id,
      room: h.item,
      img: img,
      imgId: h.img,
      meta: h.hero,
      aw: img.w + 2,
      ah: img.h + 2,
      off: [ox - 1, oy - 1],
      slug: sk ? sk.slug : null,
      layer: Math.max(0, Math.min(6, h.item.layer | 0)),
    };
  }

  /* ------------------------------------------------------------------ geometry (device px of the main canvas) */
  function viewport() {
    var V = R() && R().view;
    if (!V) return null;
    var c = R().canvas
      ? R().canvas.getBoundingClientRect()
      : { left: 0, top: 0, width: V.Wd / V.dpr, height: V.Hd / V.dpr };
    return { V: V, c: c };
  }
  function restCam() {
    var vp = viewport();
    if (!vp) return null;
    var cam = R().restCamera();
    if (!cam) return null;
    return { cam: cam, org: ROOM.camera.origin(cam, vp.V), z: cam.z, V: vp.V, c: vp.c };
  }
  /** The hero's art rect at the room camera (pixel-identical to the room item), or null when not on screen. */
  function roomRect(h) {
    var rc = restCam();
    if (!rc) return null;
    var o = (R().offsets || [])[h.layer] || 0;
    var x = Math.round((h.off[0] + o) * rc.z - rc.org.ox), y = Math.round(h.off[1] * rc.z - rc.org.oy);
    var r = { x: x, y: y, k: rc.z };
    // on screen: the sprite's opaque box at least 60 % inside the canvas, and not under the board's side
    var b = h.img.bounds || [0, 0, h.img.w, h.img.h];
    var x0 = x + (1 + b[0]) * rc.z, y0 = y + (1 + b[1]) * rc.z, x1 = x0 + b[2] * rc.z, y1 = y0 + b[3] * rc.z;
    var ix = Math.max(0, Math.min(rc.V.Wd, x1) - Math.max(0, x0));
    var iy = Math.max(0, Math.min(rc.V.Hd, y1) - Math.max(0, y0));
    var vis = (ix * iy) / Math.max(1, (x1 - x0) * (y1 - y0));
    // a layer-6 frame crop is hidden in a zone (render.js): nothing to lift from
    if (h.layer === 6 && ROOM.nav && ROOM.nav.ls && ROOM.nav.ls().zone) vis = 0;
    return vis >= 0.6 ? r : null;
  }
  function zooms(h) {
    var rc = restCam();
    var zR = rc ? rc.z : 2;
    try {
      var zr = ROOM.camera.roomCamera(rc.V, null);
      if (zr && zr.z) zR = zr.z;
    } catch (e) {
      /* keep the rest zoom */
    }
    var zZ = zR * 2;
    var zn = h && h.room && ROOM.zoneOf ? ROOM.zoneOf(h.room) : null;
    if (zn && zn.focus && rc) {
      try {
        zZ = ROOM.camera.zoneCamera(rc.V, zn.focus).z || zZ;
      } catch (e) {
        /* default */
      }
    }
    return { zRoom: zR, zZone: zZ };
  }
  function targetOf(h) {
    var vp = viewport();
    if (!vp) return null;
    var z = zooms(h);
    var phone = isPhone();
    var L = layout({
      vw: vp.c.width, vh: vp.c.height, dpr: vp.V.dpr, phone: phone, sheetTop: phone ? vp.c.height * 0.42 : null,
      heroW: h.img.w, heroH: h.img.h, zRoom: z.zRoom, zZone: z.zZone,
    });
    // layout() places the sprite; the atlas starts one texel (the rim margin) up and left
    return { x: L.x - L.k, y: L.y - L.k, k: L.k };
  }

  /* ------------------------------------------------------------------ timeline */
  function stateAt(now) {
    if (!cur) return null;
    if (deferred && !anim && !shown) {
      var dt = targetOf(cur);
      if (dt) {
        shown = { x: dt.x, y: dt.y, k: dt.k };
        deferred = false;
      }
    }
    var s;
    if (anim) {
      var t = Math.max(0, now - anim.t0);
      var u = anim.dur > 0 ? clamp01(t / anim.dur) : 1;
      var a = anim.from, b = anim.to;
      var e = anim.ease(u);
      var k = kAt(a.k, b.k, u);
      // the centre eases; the top-left is integer device px
      var ca = [a.x + (cur.aw * a.k) / 2, a.y + (cur.ah * a.k) / 2];
      var cb = [b.x + (cur.aw * b.k) / 2, b.y + (cur.ah * b.k) / 2];
      var cx = ca[0] + (cb[0] - ca[0]) * e, cy = ca[1] + (cb[1] - ca[1]) * e;
      var x = u >= 1 ? b.x : u <= 0 ? a.x : Math.round(cx - (cur.aw * k) / 2);
      var y = u >= 1 ? b.y : u <= 0 ? a.y : Math.round(cy - (cur.ah * k) / 2);
      if (anim.rise) y += Math.round(anim.rise * (1 - stepK(u, 4))) * k;
      s = {
        x: x, y: y, k: k,
        selK: a.selK + (b.selK - a.selK) * u,
        heroK: anim.heroKAt(t, u),
        haloK: anim.haloKAt(t, u),
        u: u,
      };
    } else if (shown) {
      s = { x: shown.x, y: shown.y, k: shown.k, selK: 1, heroK: 1, haloK: 1, u: 1 };
    } else return null;
    // bob: float heroes only, 1 art px every 1200 ms, stepped (not under reduced motion)
    s.up = false;
    if (!anim && shown && cur.meta.float && !reduced()) {
      s.up = Math.floor((now - shownAt) / MS.bob) % 2 === 1;
      if (s.up) s.y -= s.k;
    }
    // the phone sheet dragged tall hides the hero (2 Bayer steps)
    var hk = tall.on ? 1 - stepK((now - tall.t0) / MS.hide, 2) : tall.t0 ? stepK((now - tall.t0) / MS.hide, 2) : 1;
    if (reduced()) hk = tall.on ? 0 : 1;
    s.heroK *= hk;
    return s;
  }

  function startAnim(kind, from, to, dur, opts) {
    opts = opts || {};
    anim = {
      kind: kind, t0: ROOM.now(), dur: dur, from: from, to: to,
      ease: opts.ease || easeOut,
      heroKAt: opts.heroKAt || function () {
        return 1;
      },
      haloKAt: opts.haloKAt || function () {
        return to.haloK;
      },
      rise: opts.rise || 0,
      boardAt: opts.boardAt != null ? opts.boardAt : -1,
      next: opts.next || null,
    };
    if (ROOM.invalidate) ROOM.invalidate();
  }
  function snapshot(now) {
    var s = stateAt(now);
    return s ? { x: s.x, y: s.y - (s.up ? -s.k : 0), k: s.k, selK: s.selK, heroK: s.heroK, haloK: s.haloK } : null;
  }

  /** Advance the timeline (frame() and busy() call it): board at u 0.66 / 0, phase events, chained anims. */
  function pump(now) {
    if (!anim) return;
    var t = now - anim.t0;
    if (anim.boardAt >= 0 && t >= anim.boardAt && !boardOpened) openBoard();
    if (t < anim.dur) return;
    var a = anim;
    anim = null;
    if (a.kind === 'lift' || a.kind === 'inplace') {
      shown = { x: a.to.x, y: a.to.y, k: a.to.k };
      shownAt = now;
      phase = 'shown';
      if (!boardOpened) openBoard();
      ROOM.emit('skill', { id: cur.id, phase: 'shown' });
      scheduleBob();
    } else if (a.kind === 'drop') {
      var id = cur ? cur.id : null;
      if (a.next) {
        a.next(now);
      } else {
        cur = null;
        shown = null;
        phase = 'closed';
        last = null;
        ROOM.emit('skill', { id: id, phase: 'closed' });
        refocus(id);
      }
    }
    if (ROOM.invalidate) ROOM.invalidate();
  }

  function scheduleBob() {
    if (bobTimer) clearTimeout(bobTimer);
    bobTimer = 0;
    if (!cur || !shown || anim || !cur.meta.float || reduced() || (ROOM.clock && ROOM.clock.frozen)) return;
    var now = ROOM.now();
    var wait = MS.bob - ((now - shownAt) % MS.bob);
    bobTimer = setTimeout(function () {
      bobTimer = 0;
      if (ROOM.invalidate) ROOM.invalidate();
      scheduleBob();
    }, Math.max(16, wait + 4));
  }

  function openBoard() {
    boardOpened = true;
    if (!cur || !ROOM.ui || typeof ROOM.ui.open !== 'function') return;
    if (ROOM.state.panel === cur.id) return;
    var o = { side: 'right', hero: true };
    if (boardOpts && boardOpts.skill) o.skill = boardOpts.skill;
    if (boardOpts && boardOpts.opener) o.opener = boardOpts.opener;
    else if (focusBack) o.opener = focusBack;
    boardOpts = null;
    ROOM.ui.open(cur.id, o);
  }

  /* ------------------------------------------------------------------ legs (nav.js calls them) */
  /** LIFT: returns the leg length in ms (0 when instant). */
  function lift(id, opts) {
    opts = opts || {};
    var h = resolve(id);
    if (!h) return 0;
    if (bobTimer) clearTimeout(bobTimer);
    if (!cur || phase === 'closed') {
      var ae = document.activeElement;
      focusBack = (boardOpts && boardOpts.opener) || (ae && ae !== document.body ? ae : null);
    }
    cur = h;
    rowsMax = Math.max(rowsMax, h.ah + 8);
    shown = null;
    anim = null;
    boardOpened = false;
    tall = { on: false, t0: 0 };
    phase = 'lift';
    ROOM.emit('skill', { id: id, phase: 'lift' });
    var to = targetOf(h);
    if (!to) {
      // boot (deep link) before the renderer has a view: the hero is placed at its rest spot on the first frame
      deferred = true;
      phase = 'shown';
      shownAt = ROOM.now();
      openBoard();
      ROOM.emit('skill', { id: id, phase: 'shown' });
      return 0;
    }
    deferred = false;
    to.selK = 1;
    to.heroK = 1;
    to.haloK = 1;
    if (opts.instant || reduced()) {
      shown = { x: to.x, y: to.y, k: to.k };
      shownAt = ROOM.now();
      phase = 'shown';
      openBoard();
      ROOM.emit('skill', { id: id, phase: 'shown' });
      if (ROOM.invalidate) ROOM.invalidate();
      return 0;
    }
    var phone = isPhone();
    var dur = opts.dur || MS.lift;
    var from = roomRect(h);
    var halo = function (t) {
      // socket, darkening, halo and pool come in over 120..360 ms in 3 Bayer steps (scaled to the leg)
      var s = (t - dur / 3) / ((2 * dur) / 3);
      return t < dur / 3 ? 0 : stepK(s + 1 / 3, 3);
    };
    if (!from) {
      // not on screen: the hero materialises in place (4 Bayer steps, 3 art px rise), no flight
      var d2 = Math.min(dur, MS.inPlace);
      startAnim('inplace', { x: to.x, y: to.y, k: to.k, selK: 0, heroK: 0, haloK: 0 }, to, d2, {
        heroKAt: function (t) {
          return stepK(t / d2 + 0.25, 4);
        },
        haloKAt: function (t) {
          return stepK(t / d2 + 1 / 3, 3);
        },
        rise: 3,
        boardAt: phone ? 0 : Math.round(d2 * 0.66),
      });
      return d2;
    }
    from.selK = 0;
    from.heroK = h.meta.authored ? 0 : 1;
    from.haloK = 0;
    var n = Math.abs(to.k - from.k) + 1;
    startAnim('lift', from, to, dur, {
      ease: easeOut,
      // authored art differs from the room sprite: it dissolves in over the first two zoom steps
      heroKAt: h.meta.authored
        ? function (t, u) {
          return stepK(u / Math.min(1, 2 / n), 4);
        }
        : function () {
          return 1;
        },
      haloKAt: halo,
      boardAt: phone ? 0 : Math.round(dur * 0.66),
    });
    return dur;
  }

  /** DROP: back onto the room item (pixel-identical landing). Returns ms. */
  function drop(opts, next) {
    opts = opts || {};
    if (!cur) return 0;
    if (bobTimer) clearTimeout(bobTimer);
    var now = ROOM.now();
    var id = cur.id;
    var from = snapshot(now);
    phase = 'drop';
    shown = null;
    ROOM.emit('skill', { id: id, phase: 'drop' });
    if (opts.instant || reduced() || !from) {
      anim = null;
      if (next) {
        next(now);
        return 0;
      }
      cur = null;
      phase = 'closed';
      last = null;
      ROOM.emit('skill', { id: id, phase: 'closed' });
      refocus(id);
      if (ROOM.invalidate) ROOM.invalidate();
      return 0;
    }
    var dur = opts.dur || MS.drop;
    var to = roomRect(cur);
    var h = cur;
    var haloOut = function (t) {
      return from.haloK * (1 - stepK(t / Math.min(dur, MS.dim), 3));
    };
    if (!to) {
      // no room item on screen: dissolve out where it is
      var gone = { x: from.x, y: from.y, k: from.k, selK: 0, heroK: 0, haloK: 0 };
      startAnim('drop', from, gone, Math.min(dur, MS.inPlace), {
        ease: easeIn,
        heroKAt: function (t) {
          return from.heroK * (1 - stepK(t / Math.min(dur, MS.inPlace) + 0.25, 4));
        },
        haloKAt: function (t) {
          return Math.max(0, haloOut(t));
        },
        next: next,
      });
      return anim.dur;
    }
    to.selK = 0;
    to.heroK = h.meta.authored ? 0 : 1;
    to.haloK = 0;
    var n = Math.abs(to.k - from.k) + 1;
    startAnim('drop', from, to, dur, {
      ease: easeIn,
      heroKAt: h.meta.authored
        ? function (t, u) {
          // authored art dissolves out over the last two zoom steps, onto the room item
          var w = Math.min(1, 2 / n);
          return from.heroK * stepK((1 - u) / w, 4);
        }
        : function () {
          return from.heroK;
        },
      haloKAt: function (t) {
        return Math.max(0, haloOut(t));
      },
      next: next,
    });
    return dur;
  }

  /** SWAP i -> j on the same backdrop: DROP(i) then LIFT(j), one hero at a time; the dim stays at 1. */
  function swap(id, opts) {
    opts = opts || {};
    if (!cur || opts.instant || reduced()) {
      if (cur) drop({ instant: true });
      lift(id, { instant: true });
      return 0;
    }
    var pendingBoard = boardOpts;
    var d = drop({ dur: MS.swapDrop }, function () {
      boardOpts = pendingBoard;
      lift(id, { dur: MS.swapLift });
      // the board follows at once: it is already open for i
      openBoard();
    });
    return d + MS.swapLift;
  }

  /** Interruptions (nav.js): 'reverse' plays the running leg back from the current frame; 'snap' stops it. */
  function cancel(how) {
    var now = ROOM.now();
    if (how === 'snap' || !anim || !cur) {
      anim = null;
      return;
    }
    var a = anim;
    var t = Math.max(1, now - a.t0);
    var s = snapshot(now);
    if (a.kind === 'lift' || a.kind === 'inplace') {
      var to = roomRect(cur) || { x: s.x, y: s.y, k: s.k };
      to.selK = 0;
      to.heroK = cur.meta.authored || a.kind === 'inplace' ? 0 : 1;
      to.haloK = 0;
      phase = 'drop';
      ROOM.emit('skill', { id: cur.id, phase: 'drop' });
      var h0 = s.heroK, l0 = s.haloK;
      startAnim('drop', s, to, t, {
        ease: easeIn,
        heroKAt: function (tt, u) {
          return cur.meta.authored || a.kind === 'inplace' ? h0 * stepK(1 - u, 4) : 1;
        },
        haloKAt: function (tt, u) {
          return l0 * stepK(1 - u, 3);
        },
      });
    } else if (a.kind === 'drop') {
      var tgt = shown || targetOf(cur);
      if (!tgt) return;
      phase = 'lift';
      ROOM.emit('skill', { id: cur.id, phase: 'lift' });
      var h1 = s.heroK, l1 = s.haloK;
      startAnim('lift', s, { x: tgt.x, y: tgt.y, k: tgt.k, selK: 1, heroK: 1, haloK: 1 }, t, {
        ease: easeOut,
        heroKAt: function (tt, u) {
          return h1 + (1 - h1) * stepK(u, 4);
        },
        haloKAt: function (tt, u) {
          return l1 + (1 - l1) * stepK(u, 3);
        },
        boardAt: -1,
      });
      boardOpened = false; // nav does not reopen the board after a reversed move: open it when the hero is up
    }
  }

  function busy() {
    var now = ROOM.now();
    pump(now);
    if (anim) return true;
    if (tall.t0 && now - tall.t0 < MS.hide && !reduced()) return true;
    return false;
  }

  /* ------------------------------------------------------------------ frame: atlas rows + gl opts */
  function heroState(now) {
    if (now == null) now = ROOM.now();
    var s = stateAt(now);
    if (!s || !cur) return null;
    return {
      rectDev: { x: s.x, y: s.y, w: cur.aw * s.k, h: cur.ah * s.k },
      k: s.k,
      heroK: s.heroK,
      selK: s.selK,
      haloK: s.haloK,
      up: s.up,
      id: cur.id,
      variant: cur.imgId,
    };
  }

  function rimSideOf(h) {
    if (h.meta.rimSide) return h.meta.rimSide;
    var v = ROOM.normView(h.room.view);
    var Lg = (ROOM.viewConf && (ROOM.viewConf(v) || {}).lighting) || {};
    var wr = Lg.window && Lg.window.rect;
    if (wr) return wr[0] + wr[2] / 2 < h.off[0] + h.aw / 2 ? 'left' : 'right';
    // the window wall is on the left when you face the right wall, and on the right facing the left wall
    return v === 'right' ? 'left' : 'right';
  }
  var RIM = { off: 'GOLD_DK', pending: 'GOLD', top: 'GOLD', half: 'SUN', full: 'SUN', neglect: 'SLATE_2' };
  function rimColour(h) {
    var st = ROOM.markStateOf && h.slug ? ROOM.markStateOf(h.slug) : null;
    var name = RIM[st] || 'GOLD';
    if (C[name] == null) name = C.GOLD != null ? 'GOLD' : 'INK';
    return C[name];
  }
  /** The rim texels (atlas coordinates): 1 art px outside the silhouette on the key side, rows with an edge. */
  function rimOf(h) {
    var key = h.imgId + '|' + rimSideOf(h);
    if (h.rimKey === key) return h.rim;
    var img = h.img, out = [], right = rimSideOf(h) === 'right';
    for (var y = 0; y < img.h; y++) {
      var x = -1;
      if (right) {
        for (var i = img.w - 1; i >= 0; i--) if (img.px[y * img.w + i] !== T) {
          x = i + 1;
          break;
        }
      } else {
        for (var j = 0; j < img.w; j++) if (img.px[y * img.w + j] !== T) {
          x = j - 1;
          break;
        }
      }
      if (x >= -1 && x <= img.w && (right ? x > 0 : x < img.w - 1)) out.push(x + 1, y + 1);
    }
    h.rim = out;
    h.rimKey = key;
    return out;
  }
  function heroTables(f) {
    // the ramp (or night) LUT, never DIM: GPU frames carry the identity; gl=off frames step DIM in through lutB
    var a = f.lutA, b = f.lutB, step = f.step;
    if (b && b.dim && !(a && a.dim)) return { a: a, b: a, step: 16 };
    if (a && a.dim && R().LUT) return { a: R().LUT.ID, b: R().LUT.ID, step: 16 };
    return { a: a || R().LUT.ID, b: b || a || R().LUT.ID, step: step == null ? 16 : step };
  }

  function frame(f, ls, now) {
    if (!cur || !R()) return null;
    if (ls && (ls.snap || ls.scene === 'top')) return null;
    pump(now);
    var s = stateAt(now);
    if (!cur || !s) {
      last = null;
      return null;
    }
    // follow the live state of the item (stage, dust, relic): the variant can change while open
    var h0 = ROOM.heroOf(cur.id);
    if (h0 && h0.img !== cur.imgId) {
      var nh = resolve(cur.id);
      if (nh) {
        cur = nh;
        rowsMax = Math.max(rowsMax, nh.ah + 8);
      }
    }
    var h = cur;
    var ay = f.h + 8;
    var fits = h.aw <= f.w && f.buf.length >= f.w * (ay + h.ah) && f.aux && f.aux.length >= f.w * (ay + h.ah) * 3;
    var z = f.z, org = f.org || { ox: f.x0 * z, oy: f.y0 * z };
    last = { s: s, f: { z: z, org: org }, h: h };
    if (fits) {
      // albedo through the ramp (identity on the GPU path), then aux: contact depth, item flags + bit6, materials
      var tb = heroTables(f);
      var abuf = f.buf.subarray(ay * f.w, (ay + h.ah) * f.w);
      R().blit(abuf, f.w, h.ah, h.img, 1, 1, tb.a, tb.b, tb.step, h.off[0], h.off[1]);
      var d = {
        id: h.id + '.hero', shell: false, contact: h.meta.anchor ? h.meta.anchor[1] : h.off[1] + h.ah,
        auxFlags: 64, mat0: 0, layer: h.layer,
      };
      var sub = { aux: f.aux.subarray(ay * f.w * 3, (ay + h.ah) * f.w * 3), w: f.w, h: h.ah, y0: 0 };
      sub.ls = { hover: null, focus: null };
      R().blitAux(sub, d, h.img, 1, 1);
      // the rim on the key side (A6), a mark texel (bit4: lit like the art, never below 70 %) the hero pass draws
      if (s.selK >= 0.5) {
        var rim = rimOf(h), rc = rimColour(h), dep = R().markDepth(d.contact);
        for (var i = 0; i < rim.length; i += 2) {
          var o = (ay + rim[i + 1]) * f.w + rim[i];
          f.buf[o] = rc;
          f.aux[o * 3] = dep;
          f.aux[o * 3 + 1] = 16 | 64 | 128;
          f.aux[o * 3 + 2] = 0;
          if (f.mark) f.mark[o] = 1;
        }
      }
      f.atlas = { y: ay, w: h.aw, h: h.ah, off: [h.off[0], h.off[1]] };
    }
    var SEL = (ROOM.light && ROOM.light.SELECT) || {};
    var gain = SEL.heroGain && SEL.heroGain[h.id] != null ? SEL.heroGain[h.id] : 1;
    var hero = fits ? { x: s.x, y: s.y, k: s.k, K: s.heroK, selK: s.selK * gain } : null;
    return { hero: hero, halo: haloOf(s, h, z, org) };
  }

  /** Halo geometry (world px of the room grid) for the hero on screen (D1 3.2). */
  function haloOf(s, h, z, org) {
    if (!(s.haloK > 0)) return null;
    var b = h.img.bounds || [0, 0, h.img.w, h.img.h];
    var k = s.k;
    var hx = s.x + (1 + b[0]) * k, hy = s.y + (1 + b[1]) * k + (s.up ? k : 0), hw = b[2] * k, hh = b[3] * k;
    var cxD = hx + hw / 2, cyD = hy + hh / 2;
    var w = function (d) {
      return d / z;
    };
    var cx = (cxD + org.ox) / z, cy = (cyD + org.oy) / z;
    var bottom = (hy + hh + 7 * k + org.oy) / z;
    var sx = Math.max(1, w(0.42 * hw)), sy = Math.max(1, w(3 * k));
    var shx = Math.max(1, w(0.3 * hw - (s.up ? k : 0))), shy = Math.max(1, w(1.5 * k));
    return {
      cx: cx, cy: cy, r: Math.max(4, w(0.62 * Math.max(hw, hh))), k: s.haloK,
      pool: { cx: cx, cy: bottom, rx: sx, ry: sy },
      shadow: { cx: cx, cy: bottom - w(k), rx: shx, ry: shy },
    };
  }

  /* ------------------------------------------------------------------ Canvas2D (gl=off, context lost) */
  var c2 = { hero: null, lit: null, rim: null, key: '', halo: null, haloKey: '' };
  function canvasOf(w, h, c) {
    c = c || document.createElement('canvas');
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  }
  function keyRgb() {
    var st = R().weatherLight ? R().weatherLight() : ROOM.light && ROOM.light.current ? ROOM.light.current() : null;
    var kc = (st && st.keyColor) || [1, 0.85, 0.6];
    var m = Math.max(kc[0], kc[1], kc[2]) || 1;
    var l2s = (ROOM.light && ROOM.light.linearToSrgb) || function (x) {
      return x;
    };
    return [0, 1, 2].map(function (i) {
      return Math.round(255 * Math.max(0, Math.min(1, l2s(kc[i] / m))));
    });
  }
  function drawCanvas2D(tc, f, tr, now, ls) {
    if (!cur || !last || !R()) return;
    if (ls && (ls.snap || ls.scene === 'top')) return;
    var s = last.s, h = last.h, z = tr.z;
    var BAYER = R().BAYER;
    // ---- halo, pool and contact shadow on the room grid (world px, world-anchored Bayer rings)
    var ha = haloOf(s, h, z, { ox: -tr.tx, oy: -tr.ty });
    if (ha) {
      var pl = ha.pool, sh = ha.shadow;
      var x0 = Math.floor(Math.min(ha.cx - ha.r, pl.cx - pl.rx)), x1 = Math.ceil(Math.max(ha.cx + ha.r, pl.cx + pl.rx));
      var y0 = Math.floor(Math.min(ha.cy - ha.r, pl.cy - pl.ry)), y1 = Math.ceil(Math.max(ha.cy + ha.r, pl.cy + pl.ry));
      var kr = keyRgb(), ink = R().RGB[C.INK] || [20, 16, 24];
      var geo = [x0, y0, x1, y1, ha.cx, ha.cy, ha.r, pl.cx, pl.cy, pl.rx, pl.ry, sh.rx, sh.ry, ha.k, kr.join(',')];
      var hk = geo.map(function (v) {
        return typeof v === 'number' ? Math.round(v * 4) / 4 : v;
      }).join('|');
      var W = x1 - x0, H = y1 - y0;
      if (W > 0 && H > 0 && W * H < 4e6) {
        if (c2.haloKey !== hk) {
          c2.halo = canvasOf(W, H, c2.halo);
          var hc = c2.halo.getContext('2d');
          var im = hc.createImageData(W, H), px = im.data;
          var ring = function (t, b) {
            return t >= 1 ? 0 : Math.max(0, Math.min(3, Math.floor((1 - t) * 3 + b)));
          };
          for (var yy = 0; yy < H; yy++) {
            for (var xx = 0; xx < W; xx++) {
              var wx = x0 + xx, wy = y0 + yy, px0 = wx + 0.5, py0 = wy + 0.5;
              var b = (BAYER[(wy & 3) * 4 + (wx & 3)] + 0.5) / 16;
              var mul = 1, add = [0, 0, 0];
              var mix = function (col, wgt) {
                if (!(wgt > 0)) return;
                mul *= 1 - wgt;
                for (var q = 0; q < 3; q++) add[q] = add[q] * (1 - wgt) + col[q] * wgt;
              };
              var rh = ring(Math.hypot(px0 - ha.cx, py0 - ha.cy) / Math.max(ha.r, 1), b);
              var m = 1 - (0.5 * rh) / 3 * ha.k;
              mul *= m;
              for (var q0 = 0; q0 < 3; q0++) add[q0] *= m;
              mix(kr, (rh > 2.5 ? 0.1 : rh > 1.5 ? 0.06 : rh > 0.5 ? 0.03 : 0) * ha.k);
              var rp = ring(Math.hypot((px0 - pl.cx) / Math.max(pl.rx, 1), (py0 - pl.cy) / Math.max(pl.ry, 1)), b);
              mix(kr, (rp > 2.5 ? 0.26 : rp > 1.5 ? 0.16 : rp > 0.5 ? 0.08 : 0) * ha.k);
              var rs = Math.hypot((px0 - sh.cx) / Math.max(sh.rx, 1), (py0 - sh.cy) / Math.max(sh.ry, 1));
              if (rs < 1 && (rs < 0.75 || b > 0.5)) mix(ink, 0.75 * ha.k);
              var A = 1 - mul, o4 = (yy * W + xx) * 4;
              if (A <= 0.002) continue;
              px[o4] = Math.round(add[0] / A);
              px[o4 + 1] = Math.round(add[1] / A);
              px[o4 + 2] = Math.round(add[2] / A);
              px[o4 + 3] = Math.round(A * 255);
            }
          }
          hc.putImageData(im, 0, 0);
          c2.haloKey = hk;
        }
        tc.save();
        tc.imageSmoothingEnabled = false;
        tc.drawImage(c2.halo, x0 * z + tr.tx, y0 * z + tr.ty, W * z, H * z);
        tc.restore();
      }
    }
    // ---- the hero: ramp LUT (never DIM), lit by the view's Canvas2D light at its world place, rim on top
    if (!(s.heroK > 0)) return;
    var tb = heroTables(f);
    var lk = [h.imgId, tb.a && tb.a.base, tb.b && tb.b.base, tb.step, stepK(s.heroK, 16), s.selK >= 0.5 ? 1 : 0,
      R().light ? R().light.key : '', Math.floor(now / 100)].join('|');
    if (c2.key !== lk) {
      var aw = h.aw, ah = h.ah;
      var idx = new Uint8Array(aw * ah).fill(T);
      R().blit(idx, aw, ah, h.img, 1, 1, tb.a, tb.b, tb.step, h.off[0], h.off[1]);
      var K = s.heroK;
      c2.hero = canvasOf(aw, ah, c2.hero);
      var hctx = c2.hero.getContext('2d');
      var him = hctx.createImageData(aw, ah), u32 = new Uint32Array(him.data.buffer), RGBA = R().RGBA;
      for (var p = 0; p < idx.length; p++) {
        if (idx[p] === T) continue;
        var lx = p % aw, ly = (p / aw) | 0;
        if ((BAYER[(ly & 3) * 4 + (lx & 3)] + 0.5) / 16 > K) continue;
        u32[p] = RGBA[idx[p]];
      }
      hctx.putImageData(him, 0, 0);
      c2.lit = canvasOf(aw, ah, c2.lit);
      var lctx = c2.lit.getContext('2d');
      lctx.globalCompositeOperation = 'copy';
      lctx.drawImage(c2.hero, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      R().drawLight({ z: 1, tx: -h.off[0], ty: -h.off[1] }, now, 0, { ctx: lctx, W: aw, H: ah });
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(c2.hero, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      if (s.selK >= 0.5) {
        // marks keep the raw palette colour (f.mark rule)
        var rim = rimOf(h), rc = R().RGB[rimColour(h)];
        lctx.fillStyle = 'rgb(' + rc[0] + ',' + rc[1] + ',' + rc[2] + ')';
        for (var r2 = 0; r2 < rim.length; r2 += 2) {
          var rx = rim[r2], ry = rim[r2 + 1];
          if ((BAYER[(ry & 3) * 4 + (rx & 3)] + 0.5) / 16 <= K) lctx.fillRect(rx, ry, 1, 1);
        }
      }
      c2.key = lk;
    }
    tc.save();
    tc.imageSmoothingEnabled = false;
    tc.drawImage(c2.lit, s.x, s.y, h.aw * s.k, h.ah * s.k);
    tc.restore();
  }

  /* ------------------------------------------------------------------ façades */
  /** Open the skill view of an item (through the navigator). Virtual ids and boards without art: no move. */
  function open(id, opts) {
    opts = opts || {};
    if (!id) return false;
    var nav = ROOM.nav;
    var p = nav && nav.skillPlaceOf ? nav.skillPlaceOf(id, nav.target) : null;
    if (!p || !nav.request) {
      if (!ROOM.ui || typeof ROOM.ui.open !== 'function') return false;
      return !!ROOM.ui.open(id, { opener: opts.opener, skill: opts.skill, focus: true });
    }
    boardOpts = { skill: opts.skill || null, opener: opts.opener || null };
    var ro = { source: opts.source || 'click', opener: opts.opener, instant: opts.instant };
    if (p.mode !== 'skill') return !!nav.request(p, ro);
    var t = nav.target;
    if (t && t.mode === 'skill' && t.item === p.item) {
      // already here: only the board (a tab switch from a board link)
      if (ROOM.ui && ROOM.ui.open) ROOM.ui.open(p.item, { side: 'right', hero: true, skill: opts.skill, focus: true });
      return true;
    }
    nav.request({ mode: 'skill', item: p.item }, ro);
    return true;
  }
  function close(opts) {
    opts = opts || {};
    var t = ROOM.nav && ROOM.nav.target;
    if (!t || t.mode !== 'skill') return false;
    return ROOM.nav.back({ instant: !!opts.instant });
  }
  /** R2: the backdrop camera of a skill place: the zone/wall camera you came from on that wall, else its wall rest. */
  function backdropCamera(place, from) {
    if (!R() || !R().cameraFor || !place) return null;
    var onWall = from && (from.mode === 'wall' || from.mode === 'zone');
    if (onWall && ROOM.normView(from.view) === ROOM.normView(place.view)) return R().cameraFor(from);
    return R().cameraFor({ mode: 'wall', view: place.view, zone: null });
  }
  function rectCss() {
    var st = heroState(ROOM.now());
    var vp = viewport();
    if (!st || !vp) return null;
    var d = vp.V.dpr, r = st.rectDev;
    var l = vp.c.left + r.x / d, t = vp.c.top + r.y / d;
    return { left: l, top: t, width: r.w / d, height: r.h / d, right: l + r.w / d, bottom: t + r.h / d };
  }
  /** The phone sheet dragged to 84svh (on) or back to 58svh: the hero hides / shows in 2 Bayer steps. */
  function sheetTall(on) {
    on = !!on;
    if (tall.on === on) return;
    tall = { on: on, t0: ROOM.now() };
    if (ROOM.invalidate) ROOM.invalidate();
  }

  ROOM.on('layout', function () {
    // a resize lands any move (nav.snapMove); the hero takes the new layout at once
    if (cur && shown && !anim) {
      var to = targetOf(cur);
      if (to) shown = { x: to.x, y: to.y, k: to.k };
    }
  });
  // the pointer is inside the hero rect: nothing (no accidental close); ui/panel.js asks before its scrim closes
  function hitHero(xCss, yCss) {
    var r = rectCss();
    return !!(r && xCss >= r.left && xCss < r.right && yCss >= r.top && yCss < r.bottom);
  }

  ROOM.skill = {
    open: open,
    close: close,
    isOpen: function () {
      return !!cur && phase !== 'drop' && phase !== 'closed';
    },
    current: function () {
      return cur ? cur.id : null;
    },
    rectCss: rectCss,
    hitHero: hitHero,
    layout: layout,
    heroState: heroState,
    backdropCamera: backdropCamera,
    atlasRows: function () {
      return rowsMax;
    },
    frame: frame,
    drawCanvas2D: drawCanvas2D,
    lift: lift,
    drop: function (opts) {
      return drop(opts);
    },
    swap: swap,
    cancel: cancel,
    busy: busy,
    sheetTall: sheetTall,
    get phase() {
      return phase;
    },
  };

  // ROOM.debug.state.skill (PLAN 2.4): debugInfo is read on every access, so extend it here
  var baseInfo = R() && R().debugInfo;
  if (baseInfo) {
    R().debugInfo = function () {
      var o = baseInfo.apply(this, arguments);
      var st = cur ? heroState(ROOM.now()) : null;
      o.skill = cur
        ? {
          id: cur.id, phase: phase, open: ROOM.skill.isOpen(), rectDev: st && st.rectDev, k: st && st.k,
          heroK: st && st.heroK, selK: st && st.selK, haloK: st && st.haloK, authored: !!cur.meta.authored,
          float: !!cur.meta.float, target: targetOf(cur), atlasRows: rowsMax,
        }
        : null;
      return o;
    };
  }
})();
