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
 * ((x + o_L)*z - ox, y*z - oy). The default room zoom z0 and the zone zooms are whole numbers, so
 * every art pixel covers the same number of device pixels at rest. There is no mouse-look parallax.
 * Every transform here is returned as {z, tx, ty}: device X = x*z + tx, Y = y*z + ty.
 */
(function () {
  'use strict';

  // World frame. Defaults are a 640x270 core; configure() reads the real frame from ROOM_ART.zones (v3.4: a
  // 556x352 core per wall inside an 800x560 painted art rect).
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
  // Dolly (v3.5): one lit plane, no per-layer parallax.
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
   * Room mode: the whole core fits (s = min(floor(Wd/CORE_W), floor(Hd/CORE_H))) and one art pixel is at
   * least MIN_CSS_PER_PX CSS px. Otherwise pan mode: s from the (small-viewport) height.
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
   * Default room framing z0: up to CLOSER (1.3x) nearer than the integer full view s, rounded down to a
   * whole number (even pixels) and never so close that the core no longer fits. Pan mode (phones) keeps s.
   * Adds z0, Wv0, Hv0 (window at z0).
   */
  function withDefaultZoom(v) {
    var z0 = v.s;
    if (v.mode === 'room') z0 = Math.max(v.s, Math.floor(Math.min(CLOSER * v.s, v.Wd / CORE_W, v.Hd / CORE_H) + 1e-9));
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
   * (cy = horizon + 0.08*Hv), clamped so the core stays fully visible when Hv >= CORE_H, and so the
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

  /**
   * Transform of the single dolly plane at progress u in [0, 1] (easeOutCubic). u = 0 and u = 1 are exactly the
   * rest transforms of the two cameras; in between the zoom is geometric about the pivot (or a lateral slide).
   */
  /**
   * Dolly easing (v3.5 motion pass): starts and ends at rest (the old easeOutCubic started at full speed: a jump on
   * the first frame), accelerates over the first 35 % (cubic in) and settles over the rest (cubic out), with the
   * speed continuous where they meet.
   */
  var DOLLY_PEAK = 0.35;
  function easeDolly(u) {
    u = clamp(u, 0, 1);
    var a = DOLLY_PEAK;
    if (u < a) return (u * u * u) / (a * a);
    var s = (u - a) / (1 - a), k = 1 - s;
    return a + (1 - a) * (1 - k * k * k);
  }
  /** The screen distance (device px) a dolly plan covers: zoom (log, over the half diagonal) plus the centre slide. */
  function dollyDistance(plan) {
    var v = plan.view, D = Math.hypot(v.Wd, v.Hd) / 2;
    var zm = Math.max(plan.z0, plan.z1);
    return Math.abs(Math.log(plan.z1 / plan.z0)) * D + Math.hypot(plan.c1.x - plan.c0.x, plan.c1.y - plan.c0.y) * zm;
  }
  /** Dolly length by distance: 380 ms for a short slide, about 520 ms for a zone step, at most 680 ms. */
  function dollyMs(dist) {
    return clamp(Math.round(340 * Math.pow(Math.max(1, dist) / 300, 0.35)), 380, 680);
  }
  function dollyAt(plan, u) {
    var view = plan.view;
    if (u <= 0) return restTransform(plan.from, view, 0);
    if (u >= 1) return restTransform(plan.to, view, 0);
    var e = easeDolly(u);
    if (plan.lateral) {
      var cx = plan.c0.x + (plan.c1.x - plan.c0.x) * e;
      var cy = plan.c0.y + (plan.c1.y - plan.c0.y) * e;
      return { z: plan.z0, tx: -cx * plan.z0 + view.Wd / 2, ty: -cy * plan.z0 + view.Hd / 2 };
    }
    var zL = plan.z0 * Math.pow(plan.z1 / plan.z0, e);
    var P = plan.P;
    return {
      z: zL,
      tx: -P.x * zL + (P.x - plan.c0.x) * plan.z0 + view.Wd / 2,
      ty: -P.y * zL + (P.y - plan.c0.y) * plan.z0 + view.Hd / 2,
    };
  }

  /**
   * Snapshot zoom: the largest divisor of z (integer) whose w x h world rect stays within maxPx pixels and
   * maxSide per side, so a move's end pose is an integer magnification of the snapshot. At least 1.
   */
  function snapZoom(z, w, h, maxPx, maxSide) {
    z = Math.max(1, Math.round(z));
    maxPx = maxPx || 6e6;
    maxSide = maxSide || 8192;
    for (var d = z; d >= 1; d--) {
      if (z % d) continue;
      if (w * d * h * d <= maxPx && w * d <= maxSide && h * d <= maxSide) return d;
    }
    return 1;
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
  function springStep(x, v, target, dt, w) {
    w = w || (2 * Math.PI) / SPRING_PERIOD_S;
    var A = x - target;
    var B = v + w * A;
    var ex = Math.exp(-w * dt);
    return { x: target + (A + B * dt) * ex, v: (v - w * B * dt) * ex };
  }

  /**
   * The spring rate for a release at (x, v) toward target (v3.5 motion pass): the 0.5 s spring, stiffened just enough
   * that a fling toward a near stop does not overshoot it and swing back (critical damping overshoots when the speed
   * toward the target exceeds w * distance). The release speed is kept as it is: no velocity jump.
   */
  function springRate(x, v, target) {
    var w = (2 * Math.PI) / SPRING_PERIOD_S, A = x - target;
    if (A * v < 0 && Math.abs(v) > w * Math.abs(A)) w = Math.min(150, Math.abs(v) / Math.abs(A));
    return w;
  }
  function springSettled(x, v, target) {
    return Math.abs(x - target) < 0.05 && Math.abs(v) < 0.5;
  }

  /* ------------------------------------------------------------------ zones */

  /** The zone whose territory contains world x, else the one with the nearest territory edge (gaps between
   *  territories go to the nearer neighbour, not the last zone). */
  function zoneAtX(x, zones) {
    var best = null, bd = Infinity;
    for (var i = 0; i < zones.length; i++) {
      var t = zones[i].territory;
      if (x >= t.x0 && x < t.x1) return zones[i];
      var d = x < t.x0 ? t.x0 - x : x - t.x1 + 1;
      if (d < bd) {
        bd = d;
        best = zones[i];
      }
    }
    return best;
  }
  /** The phone pan stops of a list of zones (the zones of one wall). */
  function zoneStops(zones) {
    return zones.map(function (z) {
      return z.stop;
    });
  }

  /* ------------------------------------------------------------------ turn (v3.5) */
  function easeInOut(u) {
    u = clamp(u, 0, 1);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  /** Geometric zoom between z0 and z1 at eased progress e; dip > 0 pulls out mid-way (zone to zone across walls). */
  function turnZoom(z0, z1, e, dip) {
    return z0 * Math.pow(z1 / z0, e) * (1 - (dip || 0) * Math.sin(Math.PI * e));
  }
  /**
   * Cubic Hermite from p0 (velocity v0, per unit s) to p1 (velocity 0) at s in [0, 1]: a retargeted turn keeps
   * its current angular velocity, so a second press never jerks the pan.
   */
  function hermite(p0, v0, p1, s) {
    s = clamp(s, 0, 1);
    var s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * v0 + (-2 * s3 + 3 * s2) * p1;
  }
  function hermiteSlope(p0, v0, p1, s) {
    s = clamp(s, 0, 1);
    var s2 = s * s;
    return (6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * v0 + (-6 * s2 + 6 * s) * p1;
  }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  var camera = {
    CORE_W: CORE_W,
    CORE_H: CORE_H,
    ART: ART,
    HORIZON: HORIZON,
    HORIZON_AT: HORIZON_AT,
    CLOSER: CLOSER,
    ZONE_FRACTION: ZONE_FRACTION,
    PAN_DEPTH: PAN_DEPTH,
    DOLLY_MS: DOLLY_MS,
    easeDolly: easeDolly,
    dollyDistance: dollyDistance,
    dollyMs: dollyMs,
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
    dollyAt: dollyAt,
    snapZoom: snapZoom,
    rubberBand: rubberBand,
    momentumTarget: momentumTarget,
    nearestStop: nearestStop,
    snapTarget: snapTarget,
    springStep: springStep,
    springRate: springRate,
    springSettled: springSettled,
    zoneAtX: zoneAtX,
    zoneStops: zoneStops,
    easeInOut: easeInOut,
    turnZoom: turnZoom,
    hermite: hermite,
    hermiteSlope: hermiteSlope,
    smoothstep: smoothstep,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = camera;
  if (typeof window !== 'undefined' && window.ROOM) window.ROOM.camera = camera;
})();
