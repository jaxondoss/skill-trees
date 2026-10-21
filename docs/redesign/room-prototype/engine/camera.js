/* FORGE room prototype: camera maths.
 *
 * PURE: no DOM, no globals read, no time. Every function takes what it needs and returns plain
 * numbers or objects, so the same file runs in the page (attached to ROOM.camera) and in Vitest
 * (module.exports).
 *
 * Units
 *   world px   art pixels; the core is x 0..CORE_W, y 0..CORE_H (configure() reads it from zones.json)
 *   device px  physical canvas pixels (CSS px * devicePixelRatio)
 *   s          device px per world px in the room view (integer)
 *   z          device px per world px for the current camera (integer at rest, fractional mid-dolly)
 *
 * A camera at rest is {cx, cy, z}: the world point at the centre of the canvas and the zoom.
 * Its integer origin is ox = round(cx*z - Wd/2), oy = round(cy*z - Hd/2), and a world point (x, y)
 * on layer L with depth offset o_L (non-zero only while the phone pan moves) lands on device
 * ((x + o_L)*z - ox, y*z - oy). The default room zoom z0 may be fractional (1.3x closer than s);
 * zone zooms are integers. There is no mouse-look parallax.
 * Every transform here is returned as {z, tx, ty}: device X = x*z + tx, Y = y*z + ty.
 */
(function () {
  'use strict';

  // World frame. Defaults are the 640x270 core; configure() reads them from ROOM_ART.zones, so the
  // same maths runs on art.js and art-v3.js (960x540 core, ~1200x720 painted art).
  var CORE_W = 640;
  var CORE_H = 270;
  var ART = { x0: -80, y0: -96, x1: 720, y1: 384 };
  var HORIZON = 121;
  // Horizon height in the room view, as a fraction of the visible window from the top.
  var HORIZON_AT = 0.42;
  // Default framing: this much closer than the integer full view, never cropping the core.
  var CLOSER = 1.3;
  // A zone fills the screen at about this fraction of the core width.
  var ZONE_FRACTION = 1 / 3;
  // Room mode needs at least this many CSS px per art pixel; below it the view pans.
  // Scaled by 640/CORE_W, so a 960-wide core needs 1 CSS px per art pixel.
  var MIN_CSS_PER_PX_640 = 1.5;
  var MIN_CSS_PER_PX = MIN_CSS_PER_PX_640;
  // Phone zone framing width (world px at the 640 core) used instead of the focus width in pan mode.
  var FW_PHONE_640 = 88;
  var FW_PHONE = FW_PHONE_640;
  // Dolly: per-layer exponent on the eased progress (far layers lag, near layers lead).
  var GAMMA = [1.5, 1.25, 1.0, 0.94, 0.88, 0.82];
  var DOLLY_MS = 450;
  // Anticipation before a push-in: a short pull-back.
  var ANTICIPATE_MS = 80;
  var ANTICIPATE_K = 0.97;
  // Phone pan depth: layer lead/lag in world px at full pan speed (only while the pan moves).
  var PAN_DEPTH = [0, 1, 2, 3, 4, 5, 6];
  var PAN_DEPTH_SPEED = 600; // CSS px per second that counts as full speed
  // Phone pan.
  var MOMENTUM_S = 0.325;
  var SPRING_PERIOD_S = 0.5;
  var RUBBER = 0.35;

  /**
   * Read the world frame from a zones.json object ({core: {w, h}, art: {x, y, w, h}, horizon}).
   * Missing fields keep their current values. Returns the frame now in use.
   */
  function configure(z) {
    if (z && z.core && z.core.w > 0 && z.core.h > 0) {
      CORE_W = z.core.w;
      CORE_H = z.core.h;
    }
    if (z && z.art && z.art.w > 0) ART = { x0: z.art.x, y0: z.art.y, x1: z.art.x + z.art.w, y1: z.art.y + z.art.h };
    if (z && typeof z.horizon === 'number') HORIZON = z.horizon;
    FW_PHONE = Math.round((FW_PHONE_640 * CORE_W) / 640);
    MIN_CSS_PER_PX = (MIN_CSS_PER_PX_640 * 640) / CORE_W;
    camera.CORE_W = CORE_W;
    camera.CORE_H = CORE_H;
    camera.ART = ART;
    camera.HORIZON = HORIZON;
    camera.FW_PHONE = FW_PHONE;
    return { CORE_W: CORE_W, CORE_H: CORE_H, ART: ART, HORIZON: HORIZON };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Math.round rounds -2.5 to -2; depth offsets must be symmetric left/right, so round half away from 0.
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
    return withDefaultZoom({ Wd: Wd, Hd: Hd, dpr: dpr, s: s, mode: mode, Wv: Wd / s, Hv: Hd / s });
  }

  /**
   * Default room framing z0: CLOSER (1.3x) nearer than the integer full view s, but never so close
   * that the core no longer fits. Pan mode (phones) keeps s. Adds z0, Wv0, Hv0 (window at z0).
   */
  function withDefaultZoom(v) {
    var z0 = v.s;
    if (v.mode === 'room') z0 = Math.max(v.s, Math.min(CLOSER * v.s, v.Wd / CORE_W, v.Hd / CORE_H));
    v.z0 = z0;
    v.Wv0 = v.Wd / z0;
    v.Hv0 = v.Hd / z0;
    return v;
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
    return withDefaultZoom({ Wd: Wd, Hd: Hd, dpr: view.dpr, s: view.s, mode: view.mode, Wv: Wd / view.s, Hv: Hd / view.s });
  }

  /**
   * Vertical camera centre for the room view: the horizon sits at 42% of the visible window
   * (cy = horizon + 0.08*Hv), clamped so the core stays fully visible when Hv >= 270, and so the
   * window stays inside the painted art.
   */
  function horizonCy(Hv) {
    var v = HORIZON + (0.5 - HORIZON_AT) * Hv;
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
    var Wv = view.Wv0 || view.Wv;
    var half = Wv / 2;
    if (Wv >= ART.x1 - ART.x0) return { min: (ART.x0 + ART.x1) / 2, max: (ART.x0 + ART.x1) / 2 };
    return { min: ART.x0 + half, max: ART.x1 - half };
  }

  /** The room-view camera at the default zoom z0. Room mode is centred on the core; pan mode uses panX. */
  function roomCamera(view, panX) {
    var mid = CORE_W / 2;
    var z = view.z0 || view.s;
    var cx = view.mode === 'room' ? mid : panX == null ? mid : panX;
    return {
      cx: clampAxis(cx, view.Wd / z, ART.x0, ART.x1),
      cy: horizonCy(view.Hd / z),
      z: z,
    };
  }

  /**
   * Zone zoom. Room mode: an integer that shows about a third of the core across (ZONE_FRACTION)
   * while the zone's focus height still fits, at least floor(z0)+1, at most 3s.
   * Pan mode: the largest integer that fits FW_PHONE across, s+1..round(1.6s).
   * @param {number[]} focus [x, y, w, h] in world px
   */
  function zoneZoom(view, focus) {
    var fh = focus[3];
    if (view.mode === 'pan') {
      var zp = Math.floor(Math.min(view.Wd / FW_PHONE, view.Hd / fh));
      return clamp(zp, view.s + 1, Math.round(1.6 * view.s));
    }
    var zFit = Math.floor(Math.min(view.Wd / (CORE_W * ZONE_FRACTION), view.Hd / fh));
    return clamp(zFit, Math.floor(view.z0 || view.s) + 1, 3 * view.s);
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

  /** Transform of a layer with depth offset o (world px) for a camera at rest. */
  function restTransform(cam, view, o) {
    var org = origin(cam, view);
    return { z: cam.z, tx: (o || 0) * cam.z - org.ox, ty: -org.oy };
  }

  /** The world rectangle a camera at rest shows: {x, y, w, h} (fractional). */
  function visibleRect(cam, view) {
    var org = origin(cam, view);
    return { x: org.ox / cam.z, y: org.oy / cam.z, w: view.Wd / cam.z, h: view.Hd / cam.z };
  }

  /* ------------------------------------------------------------------ phone pan depth */

  /**
   * Layer lead/lag while the phone pan moves (no mouse-look anywhere): integer world-px offsets for
   * layers 0..6, o_L = -round(P_L * m * s/z), m = pan speed (CSS px/s) / PAN_DEPTH_SPEED in [-1, 1].
   * At rest (speed 0) every offset is 0, so the room realigns.
   */
  function panDepthOffsets(speedCss, s, z) {
    var m = clamp((speedCss || 0) / PAN_DEPTH_SPEED, -1, 1);
    var out = new Array(PAN_DEPTH.length);
    for (var L = 0; L < PAN_DEPTH.length; L++) out[L] = -roundHalfAway(PAN_DEPTH[L] * m * (s / z)) || 0;
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
   * oFrom/oTo are the layer's depth offsets (world px) at the two ends; they blend with e_L.
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
   * Anticipation pull-back before a push-in: the scale k (1 -> ANTICIPATE_K) at time t ms into the
   * ANTICIPATE_MS lead. After the lead the push-in releases it with the dolly progress (see release).
   */
  function anticipation(tMs) {
    return 1 - (1 - ANTICIPATE_K) * easeOut(tMs / ANTICIPATE_MS);
  }
  /** The pull-back left at dolly progress u (released with the eased progress). */
  function release(u) {
    return ANTICIPATE_K + (1 - ANTICIPATE_K) * easeOut(u);
  }

  /** Scale a transform by k about the screen centre. */
  function scaleAbout(tr, k, view) {
    if (k === 1) return tr;
    var cx = view.Wd / 2, cy = view.Hd / 2;
    return { z: tr.z * k, tx: (tr.tx - cx) * k + cx, ty: (tr.ty - cy) * k + cy };
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
    HORIZON_AT: HORIZON_AT,
    CLOSER: CLOSER,
    ZONE_FRACTION: ZONE_FRACTION,
    GAMMA: GAMMA,
    PAN_DEPTH: PAN_DEPTH,
    DOLLY_MS: DOLLY_MS,
    ANTICIPATE_MS: ANTICIPATE_MS,
    ANTICIPATE_K: ANTICIPATE_K,
    FW_PHONE: FW_PHONE,
    configure: configure,
    withDefaultZoom: withDefaultZoom,
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
    panDepthOffsets: panDepthOffsets,
    anticipation: anticipation,
    release: release,
    scaleAbout: scaleAbout,
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
