/* FORGE room prototype: camera maths.
 *
 * PURE: no DOM, no globals read, no time. Every function takes what it needs and returns plain
 * numbers or objects, so the same file runs in the page (attached to ROOM.camera) and in Vitest
 * (module.exports).
 *
 * Units
 *   world px   art pixels; the 640x270 core is x 0..640, y 0..270, the painted art x -80..720, y -96..384
 *   device px  physical canvas pixels (CSS px * devicePixelRatio)
 *   s          device px per world px in the room view (integer)
 *   z          device px per world px for the current camera (integer at rest, fractional mid-dolly)
 *
 * A camera at rest is {cx, cy, z}: the world point at the centre of the canvas and the zoom.
 * Its integer origin is ox = round(cx*z - Wd/2), oy = round(cy*z - Hd/2), and a world point (x, y)
 * on layer L with parallax offset o_L lands on device ((x + o_L)*z - ox, y*z - oy).
 * Every transform here is returned as {z, tx, ty}: device X = x*z + tx, Y = y*z + ty.
 */
(function () {
  'use strict';

  var CORE_W = 640;
  var CORE_H = 270;
  var ART = { x0: -80, y0: -96, x1: 720, y1: 384 };
  var HORIZON = 121;
  // Room mode needs at least this many CSS px per art pixel; below it the view pans.
  var MIN_CSS_PER_PX = 1.5;
  // Phone zone framing width (world px) used instead of the focus width in pan mode.
  var FW_PHONE = 88;
  // Dolly: per-layer exponent on the eased progress (far layers lag, near layers lead).
  var GAMMA = [1.5, 1.25, 1.0, 0.94, 0.88, 0.82];
  var DOLLY_MS = 450;
  // Parallax amplitude per layer, in world px at full deflection, in the room view.
  var PARALLAX = [0, 1, 2, 3, 4, 5, 6];
  var PARALLAX_TAU_MS = 180;
  // Phone pan.
  var MOMENTUM_S = 0.325;
  var SPRING_PERIOD_S = 0.5;
  var RUBBER = 0.35;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Math.round rounds -2.5 to -2; parallax must be symmetric left/right, so round half away from 0.
  function roundHalfAway(v) {
    var r = v < 0 ? -Math.round(-v) : Math.round(v);
    return r === 0 ? 0 : r; // never -0
  }

  /* ------------------------------------------------------------------ viewport and scale */

  /**
   * Pick the integer scale and the mode for a device-pixel canvas.
   * Room mode: the whole core fits (s = min(floor(Wd/640), floor(Hd/270))) and one art pixel is at
   * least 1.5 CSS px. Otherwise pan mode: s from the (small-viewport) height, at least 1.5 CSS px.
   * @param {number} Wd device px width
   * @param {number} Hd device px height
   * @param {number} dpr devicePixelRatio
   * @param {number} [Hsmall] small-viewport height in device px (phones: 100svh * dpr); defaults to Hd
   */
  function viewFor(Wd, Hd, dpr, Hsmall) {
    var sRoom = Math.min(Math.floor(Wd / CORE_W), Math.floor(Hd / CORE_H));
    var mode, s;
    if (sRoom >= 1 && sRoom / dpr >= MIN_CSS_PER_PX) {
      mode = 'room';
      s = sRoom;
    } else {
      mode = 'pan';
      s = Math.max(Math.floor((Hsmall || Hd) / CORE_H), Math.ceil(MIN_CSS_PER_PX * dpr), 1);
    }
    return { Wd: Wd, Hd: Hd, dpr: dpr, s: s, mode: mode, Wv: Wd / s, Hv: Hd / s };
  }

  /**
   * On a resize, decide whether to recompute s. In pan mode (phones) a height-only change of 15%
   * or less keeps s, so the iOS toolbar collapsing does not make the room jump in size.
   */
  function shouldRescale(prev, Wd, Hd) {
    if (!prev) return true;
    if (Wd !== prev.Wd) return true;
    if (Hd === prev.Hd) return false;
    if (prev.mode === 'pan' && Math.abs(Hd - prev.Hd) / prev.Hd <= 0.15) return false;
    return true;
  }

  /** Same view with a new canvas size but the old scale and mode (see shouldRescale). */
  function resizeView(view, Wd, Hd) {
    return { Wd: Wd, Hd: Hd, dpr: view.dpr, s: view.s, mode: view.mode, Wv: Wd / view.s, Hv: Hd / view.s };
  }

  /**
   * Vertical camera centre for the room view: the horizon sits at 45% of the visible window
   * (cy = 121 + 0.05*Hv), clamped so the core stays fully visible when Hv >= 270, and so the
   * window stays inside the painted art.
   */
  function horizonCy(Hv) {
    var v = HORIZON + 0.05 * Hv;
    var lo = CORE_H - Hv / 2;
    var hi = Hv / 2;
    var cy = lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2;
    return clampAxis(cy, Hv, ART.y0, ART.y1);
  }

  // Keep a window of size `span` centred on c inside [a0, a1]; centre it when it is wider.
  function clampAxis(c, span, a0, a1) {
    if (span >= a1 - a0) return (a0 + a1) / 2;
    return clamp(c, a0 + span / 2, a1 - span / 2);
  }

  /** Horizontal bounds of the camera centre in the room view (used by the phone pan). */
  function panBounds(view) {
    var half = view.Wv / 2;
    if (view.Wv >= ART.x1 - ART.x0) return { min: (ART.x0 + ART.x1) / 2, max: (ART.x0 + ART.x1) / 2 };
    return { min: ART.x0 + half, max: ART.x1 - half };
  }

  /** The room-view camera. Room mode is centred on x 320; pan mode uses panX (clamped). */
  function roomCamera(view, panX) {
    var cx = view.mode === 'room' ? 320 : panX == null ? 320 : panX;
    return {
      cx: clampAxis(cx, view.Wv, ART.x0, ART.x1),
      cy: horizonCy(view.Hv),
      z: view.s,
    };
  }

  /**
   * Zone zoom: the largest integer that fits the focus box, at least s+1, at most 2s (room mode)
   * or round(1.6s) (pan mode, framing FW_PHONE world px across instead of the focus width).
   * @param {number[]} focus [x, y, w, h] in world px
   */
  function zoneZoom(view, focus) {
    var fw = view.mode === 'pan' ? FW_PHONE : focus[2];
    var fh = focus[3];
    var zMax = view.mode === 'pan' ? Math.round(1.6 * view.s) : 2 * view.s;
    var zFit = Math.floor(Math.min(view.Wd / fw, view.Hd / fh));
    return clamp(zFit, view.s + 1, zMax);
  }

  /** The camera for a zone: centred on its focus box, clamped so the window stays inside the art. */
  function zoneCamera(view, focus) {
    var z = zoneZoom(view, focus);
    return {
      cx: clampAxis(focus[0] + focus[2] / 2, view.Wd / z, ART.x0, ART.x1),
      cy: clampAxis(focus[1] + focus[3] / 2, view.Hd / z, ART.y0, ART.y1),
      z: z,
    };
  }

  /** Integer device-pixel origin of a camera at rest. */
  function origin(cam, view) {
    return { ox: Math.round(cam.cx * cam.z - view.Wd / 2), oy: Math.round(cam.cy * cam.z - view.Hd / 2) };
  }

  /** Transform of a layer with parallax offset o (world px) for a camera at rest. */
  function restTransform(cam, view, o) {
    var org = origin(cam, view);
    return { z: cam.z, tx: (o || 0) * cam.z - org.ox, ty: -org.oy };
  }

  /** The world rectangle a camera at rest shows: {x, y, w, h} (fractional). */
  function visibleRect(cam, view) {
    var org = origin(cam, view);
    return { x: org.ox / cam.z, y: org.oy / cam.z, w: view.Wd / cam.z, h: view.Hd / cam.z };
  }

  /* ------------------------------------------------------------------ parallax */

  /** Ease the smoothed deflection toward the target: m~ += (m - m~)(1 - e^(-dt/180ms)). */
  function easeParallax(mSmooth, mTarget, dtMs) {
    return mSmooth + (mTarget - mSmooth) * (1 - Math.exp(-Math.max(0, dtMs) / PARALLAX_TAU_MS));
  }

  /** Mouse x (CSS px) to deflection in [-1, 1]. */
  function deflection(px, width) {
    if (!(width > 0)) return 0;
    return clamp((px - width / 2) / (width / 2), -1, 1);
  }

  /**
   * Integer world-px offsets for layers 0..6: o_L = -roundHalfAway(P_L * m~ * s/z).
   * The s/z factor keeps the on-screen amplitude the same when zoomed in. Horizontal only.
   */
  function parallaxOffsets(mSmooth, s, z) {
    var out = new Array(PARALLAX.length);
    for (var L = 0; L < PARALLAX.length; L++) out[L] = -roundHalfAway(PARALLAX[L] * mSmooth * (s / z)) || 0; // no -0
    return out;
  }

  /* ------------------------------------------------------------------ dolly */

  function easeOut(u) {
    var k = 1 - clamp(u, 0, 1);
    return 1 - k * k * k;
  }

  /**
   * Plan a 450 ms dolly between two cameras at rest. The centres are re-derived from the integer
   * origins, so u = 0 and u = 1 reproduce the rest frames exactly. When the zoom changes, every
   * layer scales about one pivot P = (c1*z1 - c0*z0)/(z1 - z0), whose screen point never moves.
   */
  function dollyPlan(from, to, view) {
    var o0 = origin(from, view);
    var o1 = origin(to, view);
    var c0 = { x: (o0.ox + view.Wd / 2) / from.z, y: (o0.oy + view.Hd / 2) / from.z };
    var c1 = { x: (o1.ox + view.Wd / 2) / to.z, y: (o1.oy + view.Hd / 2) / to.z };
    var lateral = from.z === to.z;
    var P = lateral
      ? null
      : { x: (c1.x * to.z - c0.x * from.z) / (to.z - from.z), y: (c1.y * to.z - c0.y * from.z) / (to.z - from.z) };
    return { from: from, to: to, view: view, z0: from.z, z1: to.z, c0: c0, c1: c1, P: P, lateral: lateral };
  }

  /** Eased per-layer progress e_L = e(u)^gamma_L (layers above 5 use layer 5's exponent). */
  function layerProgress(L, u) {
    return Math.pow(easeOut(u), GAMMA[Math.min(Math.max(L, 0), GAMMA.length - 1)]);
  }

  /**
   * Transform of layer L (0..5) at dolly progress u in [0, 1].
   * oFrom/oTo are the layer's parallax offsets (world px) at the two ends; they blend with e_L.
   */
  function dollyLayer(plan, L, u, oFrom, oTo) {
    oFrom = oFrom || 0;
    oTo = oTo || 0;
    var view = plan.view;
    if (u <= 0) return restTransform(plan.from, view, oFrom);
    if (u >= 1) return restTransform(plan.to, view, oTo);
    var e = layerProgress(L, u);
    var o = oFrom + (oTo - oFrom) * e;
    if (plan.lateral) {
      var cx = plan.c0.x + (plan.c1.x - plan.c0.x) * e;
      var cy = plan.c0.y + (plan.c1.y - plan.c0.y) * e;
      return { z: plan.z0, tx: (o - cx) * plan.z0 + view.Wd / 2, ty: -cy * plan.z0 + view.Hd / 2 };
    }
    var zL = plan.z0 * Math.pow(plan.z1 / plan.z0, e);
    var P = plan.P;
    return {
      z: zL,
      tx: (o - P.x) * zL + (P.x - plan.c0.x) * plan.z0 + view.Wd / 2,
      ty: -P.y * zL + (P.y - plan.c0.y) * plan.z0 + view.Hd / 2,
    };
  }

  /**
   * L6 frame crops do not scale during a dolly; they slide off the nearest screen edge.
   * Returns the outward slide in world px: side * (w + 8) * min(1, u/0.6)^2 (side -1 left, +1 right).
   * `leaving` true when stepping into a zone; false when coming back to the room (slides in).
   */
  function frameSlide(u, side, w, leaving) {
    var k = Math.min(1, clamp(leaving ? u : 1 - u, 0, 1) / 0.6);
    return side * (w + 8) * k * k;
  }

  /* ------------------------------------------------------------------ phone pan */

  /** Rubber band past the bounds with 0.35 resistance. */
  function rubberBand(x, min, max) {
    if (x < min) return min - (min - x) * RUBBER;
    if (x > max) return max + (x - max) * RUBBER;
    return x;
  }

  /** Where a fling would come to rest: x + v * 325 ms (v in world px per second). */
  function momentumTarget(x, v) {
    return x + v * MOMENTUM_S;
  }

  function nearestStop(x, stops) {
    var best = stops[0];
    for (var i = 1; i < stops.length; i++) if (Math.abs(stops[i] - x) < Math.abs(best - x)) best = stops[i];
    return best;
  }

  /** The stop a release at (x, v) snaps to. */
  function snapTarget(x, v, stops, bounds) {
    var t = nearestStop(momentumTarget(x, v), stops);
    return bounds ? clamp(t, bounds.min, bounds.max) : t;
  }

  /**
   * Advance a critically damped spring (period 0.5 s) toward target by dt seconds, exactly:
   * x(t) - T = (A + B t) e^(-wt), A = x0 - T, B = v0 + w A.
   */
  function springStep(x, v, target, dt) {
    var w = (2 * Math.PI) / SPRING_PERIOD_S;
    var A = x - target;
    var B = v + w * A;
    var ex = Math.exp(-w * dt);
    return { x: target + (A + B * dt) * ex, v: (v - w * B * dt) * ex };
  }

  function springSettled(x, v, target) {
    return Math.abs(x - target) < 0.05 && Math.abs(v) < 0.5;
  }

  /* ------------------------------------------------------------------ zones */

  /** The zone whose territory contains world x (zones from zones.json). */
  function zoneAtX(x, zones) {
    for (var i = 0; i < zones.length; i++) {
      var t = zones[i].territory;
      if (x >= t.x0 && x < t.x1) return zones[i];
    }
    return x < 0 ? zones[0] : zones[zones.length - 1];
  }

  var camera = {
    CORE_W: CORE_W,
    CORE_H: CORE_H,
    ART: ART,
    HORIZON: HORIZON,
    GAMMA: GAMMA,
    PARALLAX: PARALLAX,
    DOLLY_MS: DOLLY_MS,
    FW_PHONE: FW_PHONE,
    clamp: clamp,
    roundHalfAway: roundHalfAway,
    viewFor: viewFor,
    shouldRescale: shouldRescale,
    resizeView: resizeView,
    horizonCy: horizonCy,
    panBounds: panBounds,
    roomCamera: roomCamera,
    zoneZoom: zoneZoom,
    zoneCamera: zoneCamera,
    origin: origin,
    restTransform: restTransform,
    visibleRect: visibleRect,
    easeParallax: easeParallax,
    deflection: deflection,
    parallaxOffsets: parallaxOffsets,
    easeOut: easeOut,
    dollyPlan: dollyPlan,
    layerProgress: layerProgress,
    dollyLayer: dollyLayer,
    frameSlide: frameSlide,
    rubberBand: rubberBand,
    momentumTarget: momentumTarget,
    nearestStop: nearestStop,
    snapTarget: snapTarget,
    springStep: springStep,
    springSettled: springSettled,
    zoneAtX: zoneAtX,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = camera;
  if (typeof window !== 'undefined' && window.ROOM) window.ROOM.camera = camera;
})();
