/* FORGE room prototype: what drives the light (LIGHTING_SPEC v1.1 section 6).
 *
 * PURE: no DOM, no WebGL, no time read inside the maths. Every function takes what it needs, so the same file
 * runs in the page (attached to ROOM.light) and in Vitest (module.exports), like engine/camera.js.
 *
 *   sunPosition(date, lat, lon)    low-precision solar elevation and azimuth (degrees), spec 6.1
 *   keyframeWeights(el, rising)    weights of the time-of-day keyframes, blended over 1 degree of elevation
 *   completionW(p)                 today's completion (0..100) to the drive value w (0..1), spec 6.2
 *   windowDirect(az, el, facing)   1 when the sun shines straight in through the window, 0 when it is diffuse sky
 *   state(now, opts)               everything the compositor needs for one moment (see the JSDoc on state)
 *   parseFlags(search)             debug query flags: ?t=HH:MM ?el= ?az= ?p= ?light= ?tier= ?retro=1
 *   gradeLut(params, n)            a generated n^3 RGBA8 colour-grade LUT (no hand-painted LUTs)
 *   lightingFromV33(viewConf, ...) bootstrap a views.<v>.lighting block (spec section 8) from the v3.3 glow list
 *   depthOf / yBaseOf              the aux depth byte <-> contact line mapping shared with render.js
 *
 * Colours inside state() are LINEAR rgb arrays (0..1+); hex strings are sRGB.
 * Owner decisions (2026-10) that override the spec tables: the completion range is wider (key 0.6 to 1.3, plus a
 * saturation and warmth shift), night has a moonlight key through the window plus practicals, the side views each
 * have one visible warm lamp, and the back view is lit by four ceiling pendants and window bounce only.
 */
(function () {
  'use strict';

  var RAD = Math.PI / 180;
  var NOLA = { lat: 29.95, lon: -90.07, facing: 250 };

  /* ------------------------------------------------------------------ small maths */
  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }
  function mix3(a, b, t) {
    return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  }
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    c = clamp(c, 0, 1);
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  /** '#RRGGBB' or [r, g, b] (0..255) to a linear rgb array. */
  function lin(c) {
    if (typeof c === 'string') c = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    return [srgbToLinear(c[0] / 255), srgbToLinear(c[1] / 255), srgbToLinear(c[2] / 255)];
  }
  function luma(c) {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /** Signed smallest difference a - b between two angles in degrees (-180..180). */
  function angleDiff(a, b) {
    var d = (((a - b) % 360) + 540) % 360 - 180;
    return d;
  }

  /* ------------------------------------------------------------------ 6.1 sun position */
  /**
   * Low-precision solar position (good to about 0.5 degree), spec 6.1 verbatim.
   * date: Date (or ms since epoch). Returns {elevation, azimuth} in degrees, azimuth clockwise from north.
   */
  function sunPosition(date, lat, lon) {
    if (lat == null) lat = NOLA.lat;
    if (lon == null) lon = NOLA.lon;
    var t = typeof date === 'number' ? date : date.getTime();
    var d = (t - Date.UTC(2000, 0, 1, 12)) / 86400000;
    var g = (357.529 + 0.98560028 * d) * RAD;
    var q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    var e = (23.439 - 0.00000036 * d) * RAD;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var ha = (gmst * 15 + lon) * RAD - ra;
    var la = lat * RAD;
    var el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
    var az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
    return { elevation: el / RAD, azimuth: (az / RAD + 360) % 360 };
  }

  /**
   * US Central time offset from UTC in hours (-5 in daylight saving time, else -6) for a UTC instant.
   * DST runs from the second Sunday of March 02:00 local to the first Sunday of November 02:00 local.
   */
  function centralOffset(ms) {
    var y = new Date(ms).getUTCFullYear();
    function nthSunday(month, n) {
      var first = new Date(Date.UTC(y, month, 1)).getUTCDay();
      return 1 + ((7 - first) % 7) + 7 * (n - 1);
    }
    var start = Date.UTC(y, 2, nthSunday(2, 2), 8); // 02:00 CST = 08:00 UTC
    var end = Date.UTC(y, 10, nthSunday(10, 1), 7); // 02:00 CDT = 07:00 UTC
    return ms >= start && ms < end ? -5 : -6;
  }
  /**
   * The instant that is HH:MM New Orleans local time on the New Orleans calendar day of `base` (ms).
   * Used by the ?t= flag so a faked clock means the room's local time, whatever the device time zone.
   */
  function atLocalTime(base, hh, mm) {
    var off = centralOffset(base);
    var local = new Date(base + off * 3600000); // shifted so the UTC fields read New Orleans wall time
    var guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - off * 3600000;
    var off2 = centralOffset(guess);
    return off2 === off ? guess : guess + (off - off2) * 3600000;
  }

  /* ------------------------------------------------------------------ 6.1 keyframes */
  /*
   * One row per keyframe. Spec table values, with these documented changes (GL_NOTES.md):
   * - ambient intensities are relative to the painted albedo (the art is already dark), so they are scaled up
   *   from the spec's 0.18 / 0.12 / 0.10 while keeping its colours and order;
   * - the night key is moonlight through the window at 0.45 (spec 0.25) so the moon spill reads;
   * - exposure, grain, sky level and the practical switches are part of the row.
   * Practicals: screens are always on; `lamps` = lamps and string lights; `desk` = the desk lamp.
   */
  var KEYFRAMES = {
    night: {
      key: '#4A5A9A', keyI: 0.5, shadowSoft: 1, shadowStr: 0.3, shafts: 0.07, bloom: 0.6, exposure: 1.3,
      amb: '#1A2040', ambI: 0.5, sky: 0.2, skyTint: '#5A6AB0', grain: 0.035, lamps: 1, desk: 1,
      grade: { shadow: '#1E2A44', shadowAmt: 0.55, high: '#A8B4FF', highAmt: 0.12, balance: -0.1, sat: 0.9, contrast: 1.04, lift: 0.015 },
    },
    blue: {
      key: '#6A6FB0', keyI: 0.55, shadowSoft: 1, shadowStr: 0.4, shafts: 0.05, bloom: 0.5, exposure: 1.2,
      amb: '#232A48', ambI: 0.52, sky: 0.45, skyTint: '#8A86C8', grain: 0.03, lamps: 1, desk: 1,
      grade: { shadow: '#212A48', shadowAmt: 0.5, high: '#FFB08A', highAmt: 0.15, balance: -0.05, sat: 0.95, contrast: 1.06, lift: 0.012 },
    },
    sunset: {
      key: '#FF5A2A', keyI: 1.1, shadowSoft: 0, shadowStr: 0.7, shafts: 0.3, bloom: 0.45, exposure: 1.05,
      amb: '#2A2E45', ambI: 0.58, sky: 0.95, skyTint: '#FFFFFF', grain: 0.025, lamps: 1, desk: 1,
      grade: { shadow: '#1E2632', shadowAmt: 0.5, high: '#FF7A3A', highAmt: 0.3, balance: 0.05, sat: 1.08, contrast: 1.1, lift: 0.01 },
    },
    golden: {
      key: '#FF8A3D', keyI: 1.25, shadowSoft: 0, shadowStr: 0.75, shafts: 0.35, bloom: 0.4, exposure: 1.06,
      amb: '#2A2E45', ambI: 0.58, sky: 1.0, skyTint: '#FFFFFF', grain: 0.02, lamps: 0, desk: 0,
      grade: { shadow: '#1E2632', shadowAmt: 0.5, high: '#FFA040', highAmt: 0.3, balance: 0.1, sat: 1.06, contrast: 1.1, lift: 0.008 },
    },
    day: {
      key: '#FFE2B8', keyI: 0.9, shadowSoft: 0, shadowStr: 0.45, shafts: 0.15, bloom: 0.25, exposure: 1.0,
      amb: '#2A3550', ambI: 0.75, sky: 1.0, skyTint: '#FFFFFF', grain: 0.02, lamps: 0, desk: 0,
      grade: { shadow: '#263040', shadowAmt: 0.32, high: '#FFE8C8', highAmt: 0.12, balance: 0.0, sat: 1.0, contrast: 1.05, lift: 0.01 },
    },
    dawn: {
      key: '#FF9F7A', keyI: 0.7, shadowSoft: 1, shadowStr: 0.5, shafts: 0.2, bloom: 0.3, exposure: 1.1,
      amb: '#2A3050', ambI: 0.55, sky: 0.7, skyTint: '#FFD8D0', grain: 0.025, lamps: 0, desk: 1,
      grade: { shadow: '#2A2E48', shadowAmt: 0.45, high: '#FFB090', highAmt: 0.22, balance: 0.0, sat: 0.96, contrast: 1.06, lift: 0.012 },
    },
  };
  var KEYFRAME_NAMES = ['night', 'blue', 'sunset', 'golden', 'day', 'dawn'];
  // Elevation bands (degrees). Evening: night | blue | sunset | golden | day. Morning: night | dawn | golden | day.
  var BANDS_EVENING = [['night', -Infinity, -6], ['blue', -6, -1], ['sunset', -1, 6], ['golden', 6, 18], ['day', 18, Infinity]];
  var BANDS_MORNING = [['night', -Infinity, -6], ['dawn', -6, 6], ['golden', 6, 18], ['day', 18, Infinity]];
  var BLEND_DEG = 1; // neighbouring keyframes blend over 1 degree of elevation (a few real minutes)

  function up(x) {
    return x === Infinity ? 1 : x === -Infinity ? 0 : smoothstep(-BLEND_DEG / 2, BLEND_DEG / 2, x);
  }
  /**
   * Keyframe weights for a sun elevation. rising: morning (the sun is east of the meridian), which swaps blue
   * hour and sunset for dawn. The weights are a partition of unity and continuous in elevation.
   */
  function keyframeWeights(el, rising) {
    var w = { night: 0, blue: 0, sunset: 0, golden: 0, day: 0, dawn: 0 };
    var bands = rising ? BANDS_MORNING : BANDS_EVENING;
    for (var i = 0; i < bands.length; i++) w[bands[i][0]] = up(el - bands[i][1]) - up(el - bands[i][2]);
    return w;
  }

  /** Blend the numeric and colour fields of the keyframe rows by weight (colours blended in linear). */
  function blendKeyframes(w) {
    var out = { keyColor: [0, 0, 0], ambientColor: [0, 0, 0], skyTint: [0, 0, 0] };
    var nums = ['keyI', 'shadowSoft', 'shadowStr', 'shafts', 'bloom', 'exposure', 'ambI', 'sky', 'grain', 'lamps', 'desk'];
    nums.forEach(function (k) {
      out[k] = 0;
    });
    KEYFRAME_NAMES.forEach(function (n) {
      var k = w[n];
      if (!k) return;
      var r = KEYFRAMES[n];
      nums.forEach(function (f) {
        out[f] += r[f] * k;
      });
      var kc = lin(r.key), ac = lin(r.amb), st = lin(r.skyTint);
      for (var c = 0; c < 3; c++) {
        out.keyColor[c] += kc[c] * k;
        out.ambientColor[c] += ac[c] * k;
        out.skyTint[c] += st[c] * k;
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ 6.1 window facing */
  /**
   * How directly the sun shines in: 1 when its azimuth is within about 60 degrees of the window facing and it
   * is above the horizon, falling to 0 by 80 degrees off (the key turns into diffuse sky light) or below -1.
   */
  function windowDirect(az, el, facing) {
    var off = Math.abs(angleDiff(az, facing == null ? NOLA.facing : facing));
    return (1 - smoothstep(60, 80, off)) * smoothstep(-1.5, 2, el);
  }

  /* ------------------------------------------------------------------ 6.2 completion */
  /** Today's completion percent to w: smoothstep(0, 0.85, p / 100) (85% = the streak-safe line). */
  function completionW(p) {
    return smoothstep(0, 0.85, clamp((p || 0) / 100, 0, 1));
  }
  /*
   * What w drives. Owner decision: wider than the spec table so 0% and 100% are clearly different.
   * [at w = 0, at w = 1].
   */
  var DRIVE = {
    key: [0.6, 1.3], // key intensity multiplier (spec 0.8..1.15)
    warmth: [-4, 10], // highlight hue shift toward gold, degrees (spec 0..8)
    saturation: [0.78, 1.12], // spec 0.85..1.1
    neon: [0.35, 1.0], // FORGE neon intensity, irregular flicker below 25%
    statueRim: [0.7, 1.4],
    shafts: [0.7, 1.15], // spec 0.8..1.1
    bloom: [0.85, 1.15],
    practical: [0.85, 1.1],
  };
  function drive(name, w) {
    return mix(DRIVE[name][0], DRIVE[name][1], w);
  }

  /* ------------------------------------------------------------------ debug flags */
  var TIER_NAMES = ['ultra', 'high', 'medium', 'low', 'off'];
  var DEBUG_VIEWS = ['albedo', 'light', 'depth', 'flags', 'shadow', 'refl', 'bloom', 'final'];
  /**
   * Parse the light debug flags from a query string ('?t=19:30&el=8'). Unknown or malformed values are left out.
   * ?tier= only counts as a GPU tier when it is a tier name: the numeric ?tier=1..5 is the room tier (core.js).
   */
  function parseFlags(search) {
    var out = {};
    var q = {};
    String(search || '')
      .replace(/^\?/, '')
      .split('&')
      .forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
        q[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      });
    var m = /^(\d{1,2}):(\d{2})$/.exec(q.t || '');
    if (m && +m[1] < 24 && +m[2] < 60) out.t = { h: +m[1], m: +m[2] };
    if (q.el != null && q.el !== '' && isFinite(+q.el)) out.el = clamp(+q.el, -90, 90);
    if (q.az != null && q.az !== '' && isFinite(+q.az)) out.az = ((+q.az % 360) + 360) % 360;
    if (q.p != null && q.p !== '' && isFinite(+q.p)) out.p = clamp(+q.p, 0, 100);
    if (DEBUG_VIEWS.indexOf(q.light) >= 0) out.light = q.light;
    var tier = (q.gltier || q.tier || '').toLowerCase();
    if (TIER_NAMES.indexOf(tier) >= 0) out.tier = tier;
    if (q.retro === '1' || q.retro === '0') out.retro = q.retro === '1';
    if (q.motion === '0') out.reducedMotion = true;
    return out;
  }

  /* ------------------------------------------------------------------ state */
  var MOON_ELEVATION = 35; // the moon key's fixed elevation for night shadows and the moon patch

  /**
   * Everything the compositor needs for one moment.
   * now: Date or ms since epoch (the device clock). opts (all optional):
   *   lat, lon, facing   location and window facing (default New Orleans, 250)
   *   p                  today's completion 0..100
   *   flags              parseFlags() output; t, el, az and p override the clock and the data
   *   rising             with a forced elevation: treat it as morning (default evening)
   * Returns {
   *   date, elevation, azimuth, rising, weights {night, blue, sunset, golden, day, dawn}, keyframe (heaviest),
   *   night (bool), nightness (0..1), w, direct (0..1), moon (0..1),
   *   keyColor (linear rgb), keyIntensity, shadowStrength, castShadow (0..1), shadowLength, shadowSoft,
   *   patchIntensity, patchElevation, lateral (degrees, sun azimuth minus facing), shafts, bloom, exposure,
   *   ambientColor (linear rgb, normalised), ambientIntensity, sky, skyTint, grain, rimGain,
   *   practicals {screens, lamps, desk}, neon, statueRim, saturation, warmth, practicalGain,
   *   grade {a, b, t} (the two keyframes whose LUTs blend, and the blend), bucket (0.5 degree elevation bucket)
   * }
   */
  function state(now, opts) {
    opts = opts || {};
    var flags = opts.flags || {};
    var lat = opts.lat != null ? opts.lat : NOLA.lat;
    var lon = opts.lon != null ? opts.lon : NOLA.lon;
    var facing = opts.facing != null ? opts.facing : NOLA.facing;
    var ms = now == null ? Date.now() : typeof now === 'number' ? now : now.getTime();
    if (flags.t) ms = atLocalTime(ms, flags.t.h, flags.t.m);
    var sun = sunPosition(ms, lat, lon);
    var el = sun.elevation, az = sun.azimuth;
    var rising = az < 180;
    if (flags.el != null) {
      el = flags.el;
      rising = !!opts.rising;
      az = flags.az != null ? flags.az : facing + (rising ? -100 : -12); // a forced evening sun shines in
    } else if (flags.az != null) az = flags.az;
    var p = flags.p != null ? flags.p : opts.p;
    var w = completionW(p);
    var weights = keyframeWeights(el, rising);
    var kf = blendKeyframes(weights);

    var heaviest = 'night', hw = -1, second = 'night', sw = -1;
    KEYFRAME_NAMES.forEach(function (n) {
      if (weights[n] > hw) {
        second = heaviest;
        sw = hw;
        heaviest = n;
        hw = weights[n];
      } else if (weights[n] > sw) {
        second = n;
        sw = weights[n];
      }
    });
    var nightness = weights.night + weights.blue * 0.5;
    var direct = windowDirect(az, el, facing);
    var moon = weights.night * 0.85 + weights.blue * 0.3; // moonlight through the window (owner decision)

    // Diffuse sky light when the sun is not in the window: cooler, no hard shadows, no patch, softer rim.
    var diffuse = lin('#9DB0D0');
    var dayish = 1 - nightness;
    var keyColor = mix3(kf.keyColor, mix3(kf.keyColor, diffuse, 0.65), (1 - direct) * dayish);
    var keyIntensity = kf.keyI * mix(1, 0.75, (1 - direct) * dayish) * drive('key', w);

    var shEl = Math.max(el, 2) * (1 - nightness) + MOON_ELEVATION * nightness;
    var shadowLength = clamp(1 / Math.tan(shEl * RAD), 0.3, 2.5);
    var castShadow = Math.max(direct * dayish, moon * 0.6);
    var ambient = kf.ambientColor;
    var al = luma(ambient) || 1;

    return {
      date: new Date(ms),
      elevation: el,
      azimuth: az,
      rising: rising,
      weights: weights,
      keyframe: heaviest,
      night: weights.night + weights.blue > 0.5,
      nightness: nightness,
      w: w,
      p: p == null ? null : p,
      direct: direct,
      moon: moon,
      keyColor: keyColor,
      keyIntensity: keyIntensity,
      shadowStrength: kf.shadowStr,
      castShadow: castShadow,
      shadowLength: shadowLength,
      shadowSoft: kf.shadowSoft,
      patchIntensity: 1.6 * keyIntensity * Math.max(direct * dayish, moon * 0.7),
      patchElevation: shEl,
      lateral: nightness > 0.5 ? 0 : angleDiff(az, facing),
      shafts: kf.shafts * drive('shafts', w) * Math.max(direct * dayish, moon * 0.25 + 0.1 * dayish),
      bloom: kf.bloom * drive('bloom', w),
      exposure: kf.exposure,
      ambientColor: [ambient[0] / al, ambient[1] / al, ambient[2] / al],
      ambientIntensity: kf.ambI,
      sky: kf.sky,
      skyTint: kf.skyTint,
      grain: kf.grain,
      rimGain: mix(0.5, 1, Math.max(direct * dayish, moon)),
      practicals: { screens: 1, lamps: clamp(kf.lamps, 0, 1), desk: clamp(Math.max(kf.desk, kf.lamps), 0, 1) },
      neon: drive('neon', w),
      statueRim: drive('statueRim', w),
      saturation: drive('saturation', w),
      warmth: drive('warmth', w),
      practicalGain: drive('practical', w),
      grade: { a: heaviest, b: sw > 0 ? second : heaviest, t: sw > 0 ? sw / (hw + sw) : 0 },
      bucket: Math.round(el * 2) / 2,
    };
  }

  /* ------------------------------------------------------------------ 5.4 generated grade LUT */
  /**
   * A colour-grade cube (n^3, RGBA8, red fastest, then green, then blue: the layout of a WebGL 3D texture
   * uploaded with width = height = depth = n). Input and output are display (sRGB) values.
   * params: {shadow, shadowAmt, high, highAmt, balance, sat, contrast, lift}: split toning toward the shadow
   * tint in the darks and the highlight tint in the lights (balance moves the split), then contrast about
   * mid grey, saturation and black lift.
   */
  function gradeLut(params, n) {
    n = n || 32;
    var out = new Uint8Array(n * n * n * 4);
    function tint(hex) {
      var c = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
      var l = luma(c) || 1;
      return [c[0] / l, c[1] / l, c[2] / l];
    }
    var ts = tint(params.shadow), th = tint(params.high);
    var bal = params.balance || 0;
    var i = 0;
    for (var b = 0; b < n; b++) {
      for (var g = 0; g < n; g++) {
        for (var r = 0; r < n; r++) {
          var c = [r / (n - 1), g / (n - 1), b / (n - 1)];
          var l = luma(c);
          var sw = (1 - smoothstep(0.0, 0.55 + bal * 0.3, l)) * params.shadowAmt;
          var hw = smoothstep(0.3 + bal * 0.3, 1.0, l) * params.highAmt;
          for (var k = 0; k < 3; k++) {
            var v = c[k];
            v = mix(v, ts[k] * l, sw);
            v = mix(v, Math.min(1.2, th[k] * l), hw);
            v = (v - 0.5) * params.contrast + 0.5;
            c[k] = v;
          }
          var l2 = luma(c);
          for (k = 0; k < 3; k++) {
            var s = mix(l2, c[k], params.sat);
            s = params.lift + s * (1 - params.lift);
            out[i++] = Math.round(clamp(s, 0, 1) * 255);
          }
          out[i++] = 255;
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ aux depth mapping */
  /**
   * The aux depth byte for a contact line (world y) in a view whose depth range is [top, bottom] (default: the
   * view's art rect, art.y .. art.y + art.h). Objects and floor pixels map to 1..254; 0 is the back wall, window
   * and sky; 255 the ceiling. render.js and the harness must write depth with this function.
   */
  function depthOf(yBase, top, bottom) {
    return 1 + Math.round(253 * clamp((yBase - top) / (bottom - top), 0, 1));
  }
  /** Inverse of depthOf: the contact line (world y) of a depth byte 1..254. */
  function yBaseOf(depth, top, bottom) {
    return top + ((depth - 1) / 253) * (bottom - top);
  }
  /** The depth range [top, bottom] of a lighting block or view conf. */
  function depthRange(lighting, viewConf) {
    if (lighting && lighting.depthRange) return lighting.depthRange;
    var a = (viewConf && viewConf.art) || { y: -116, h: 480 };
    return [a.y, a.y + a.h];
  }

  /* ------------------------------------------------------------------ section 8: v3.3 glow list converter */
  var ROLE_BY_RGB = [
    // [rgb, role, type]
    [[255, 64, 40], 'screen', 'area'],
    [[70, 255, 130], 'screen', 'area'],
    [[70, 226, 246], 'energy', 'point'],
    [[255, 112, 168], 'neon', 'line'],
    [[226, 112, 214], 'accent', 'point'],
    [[176, 104, 255], 'accent', 'point'],
  ];
  function sameRgb(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }
  function isKeyGlow(g) {
    return sameRgb(g.rgb, [255, 150, 64]) && g.rx >= 100;
  }
  function isMoonGlow(g) {
    return sameRgb(g.rgb, [70, 96, 200]);
  }
  function isBulb(g) {
    return g.rx < 12 && g.a <= 0.12 && sameRgb(g.rgb, [255, 176, 96]);
  }
  function round1(x) {
    return Math.round(x * 10) / 10;
  }
  function itemById(items, id) {
    for (var i = 0; i < (items || []).length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function firstItem(items, view, re) {
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      if ((it.view || 'main') === view && re.test(it.id)) return it;
    }
    return null;
  }

  /** Split bulb glows into strands: consecutive bulbs closer than `gap` px continue a strand. */
  function strands(bulbs, gap) {
    var out = [], cur = null;
    bulbs.forEach(function (b) {
      var last = cur && cur[cur.length - 1];
      if (last && Math.hypot(b.x - last.x, b.y - last.y) <= gap) cur.push(b);
      else {
        cur = [b];
        out.push(cur);
      }
    });
    return out;
  }
  /** Reduce a polyline to at most n points (keeps the ends). */
  function simplify(pts, n) {
    if (pts.length <= n) return pts;
    var out = [];
    for (var i = 0; i < n; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
    return out;
  }

  /**
   * Build a views.<v>.lighting block (LIGHTING_SPEC section 8 schema, plus the few fields listed in GL_NOTES.md)
   * from a v3.3 view conf (zones.views.<v>: art, core, horizon, vp, light {day, night}).
   *   viewConf  the view's conf (may lack .light: then only the defaults are produced)
   *   viewId    'main' | 'front' | 'left' | 'right' | 'back'
   *   items     optional ROOM_ART.items: used to find the window, the floor line and the owner's lamps
   * The result is a starting point for the integrator to curate; coordinates are world px of that view.
   * Rules: the big warm glows become the key; bulb strands become static line lights; glows with an anim
   * channel become dynamic lights (with their flicker gains); screen, neon and accent colours become area,
   * line and point lights; other warm glows become static points (night-only ones switch on at sunset);
   * at most 16 dynamic lights (the weakest extras are baked).
   */
  function lightingFromV33(viewConf, viewId, items) {
    viewConf = viewConf || {};
    var v = viewId === 'front' ? 'main' : viewId || 'main';
    var core = viewConf.core || { w: 556, h: 235 };
    var art = viewConf.art || { x: -122, y: -116, w: 800, h: 480 };
    var day = (viewConf.light && viewConf.light.day) || { glows: [] };
    var night = (viewConf.light && viewConf.light.night) || { glows: [] };

    // Floor line: the top of the view's floor shell, else the horizon + 88.
    var floorShell = items && firstItem(items, v, /^shell\.(?:[a-z]+-)?l5$/);
    var backLine = floorShell ? floorShell.y : (viewConf.horizon || 96) + 88;

    var L = {
      _note: 'Bootstrapped by ROOM.light.lightingFromV33 from the v3.3 glow list; curate by hand.',
      window: { rect: null, facing: NOLA.facing, mullions: [], blinds: { rows: 0, open: 1 }, base: backLine, lateral: 0 },
      key: { center: [core.w / 2, backLine + 12], radius: [220, 70], offscreen: null, wall: 0.25, scale: 1, bounce: 0 },
      floor: { backLine: backLine, bottom: core.h, squash: 1.0, seam: 'AMBER' },
      ambient: { day: '#2A3550', golden: '#2A2E45', night: '#1A2040' },
      lights: [],
      materials: { LEAF_1: { translucency: 0.5 }, LEAF_2: { translucency: 0.5 }, LEAF_3: { translucency: 0.5 } },
      noRim: ['poster-*', 'calendar-*', 'pennant-*'],
      vignette: { x: core.w / 2, y: core.h / 2, rx: core.w * 0.78, ry: core.h * 1.1, inner: 0.42, c: [0.55, 0.5, 0.58] },
      depthRange: [art.y, art.y + art.h],
      anims: day.anims || night.anims || {},
    };
    if (day.vignette) {
      var vg = day.vignette;
      L.vignette = { x: vg.x, y: vg.y, rx: vg.rx, ry: vg.ry, inner: vg.inner, c: [0.55, 0.5, 0.58] };
    }

    // Window rect: the sky / window glass shell when the window is in this view.
    var sky = items && (firstItem(items, v, /^shell\.sky$/) || firstItem(items, v, /^shell\.(?:[a-z]+-)?window$/));
    if (sky && v === 'main') {
      L.window.rect = [sky.x, sky.y, sky.w, sky.h];
      L.window.lateral = 1;
    }

    // The key: the floor glow (the lower of the big warm glows) sets the centre and radius.
    var keys = day.glows.filter(isKeyGlow).sort(function (a, b) {
      return b.y - a.y;
    });
    if (keys.length) {
      var kg = keys[0];
      var offscreen = kg.x < 0 || kg.x > core.w;
      L.key.center = [round1(kg.x), round1(kg.y)];
      var wash = keys.reduce(function (a, b) {
        return b.rx > a.rx ? b : a;
      }); // the widest warm wash sets how far a side key reaches
      L.key.radius = offscreen ? [round1(Math.max(kg.rx, wash.rx) * 0.85), round1(kg.ry * 1.6)] : [round1(kg.rx * 1.6), round1(kg.ry * 1.6)];
      if (offscreen) {
        L.key.offscreen = kg.x < 0 ? 'left' : 'right';
        L.key.wall = 0.6; // a side wall rakes; it is not the backlit window wall
        // The window is off screen on that side: a rect just past the edge, for the shafts and the patch.
        var wx = kg.x < 0 ? -150 : core.w + 10;
        L.window.rect = [wx, 20, 140, 130];
        L.window.base = backLine + 14;
        L.window.throw = [kg.x < 0 ? 1 : -1, 0.12];
      }
    } else if (L.window.rect) {
      var r = L.window.rect;
      L.key.center = [r[0] + r[2] / 2, backLine + 12];
    }
    // Shadows fan out from a point behind the window wall (the sun is far away and high): straight toward the
    // camera under the window, angled outward to the sides.
    if (L.window.rect && !L.key.offscreen) L.key.floor = [L.window.rect[0] + L.window.rect[2] / 2, round1(backLine - L.window.rect[3] * 0.9)];

    // Practicals.
    var lights = [];
    var nightOnly = function (g) {
      return !day.glows.some(function (d) {
        return Math.abs(d.x - g.x) < 2 && Math.abs(d.y - g.y) < 2 && sameRgb(d.rgb, g.rgb);
      });
    };
    var all = day.glows.concat(night.glows.filter(nightOnly));
    var bulbs = all.filter(isBulb);
    strands(bulbs, 13).forEach(function (s, i) {
      if (s.length < 3) return;
      var pts = simplify(s, 8).map(function (b) {
        return [round1(b.x), round1(b.y)];
      });
      lights.push({ id: 'string-lights-' + (i + 1), type: 'line', points: pts, bulbs: s.length, rgb: [255, 176, 96], intensity: 0.35, radius: 12, squash: 0.8, static: true, when: 'sunset', dayLevel: 0.3, role: 'string' });
    });
    // Coloured glows: pair each with the warm glow at the same centre (v3.3 drew a warm core plus a colour halo).
    var used = [];
    all.forEach(function (g, gi) {
      if (isKeyGlow(g) || isMoonGlow(g) || isBulb(g)) return;
      if (g.rx >= 100) return; // big wall washes: the key and the sun patch replace them
      var role = null, type = 'point';
      ROLE_BY_RGB.forEach(function (rr) {
        if (sameRgb(g.rgb, rr[0])) {
          role = rr[1];
          type = rr[2];
        }
      });
      if (!role) {
        // a warm core under a coloured halo is folded into that halo
        var halo = all.some(function (h) {
          return h !== g && !sameRgb(h.rgb, [255, 176, 96]) && Math.abs(h.x - g.x) < 3 && Math.abs(h.y - g.y) < 12 && !isKeyGlow(h);
        });
        if (halo) return;
        role = g.ch ? 'flicker' : 'lamp';
      }
      used.push(gi);
      var id = (g.ch || role) + '-' + Math.round(g.x) + '-' + Math.round(g.y);
      var roleK = role === 'energy' ? 0.45 : role === 'accent' ? 0.7 : 1;
      var Lg = { id: id, type: type, rgb: g.rgb.slice(), intensity: Math.round(Math.min(1.2, g.a * 3.5) * roleK * 100) / 100, radius: round1(Math.max(g.rx, g.ry) * 0.9), squash: round1((g.ry / g.rx) * 100) / 100, role: role };
      if (type === 'area') {
        Lg.rect = [round1(g.x - g.rx * 0.3), round1(g.y - g.ry * 0.25), round1(g.rx * 0.6), round1(g.ry * 0.5)];
        Lg.radius = round1(Math.max(g.rx, g.ry) * 0.9);
        Lg.squash = 1;
      } else if (type === 'line') {
        Lg.points = [[round1(g.x - g.rx * 0.35), round1(g.y)], [round1(g.x + g.rx * 0.35), round1(g.y)]];
        Lg.radius = round1(g.ry * 1.6);
        Lg.squash = 1;
        Lg.drive = 'completion';
      } else Lg.pos = [round1(g.x), round1(g.y)];
      if (g.ch) {
        Lg.channel = g.ch;
        if (g.ak && g.a) Lg.flicker = g.ak.map(function (a) {
          return Math.round((a / g.a) * 100) / 100;
        });
      }
      Lg.when = nightOnly(g) ? 'sunset' : 'always';
      if (!g.ch && role === 'lamp') Lg.static = true;
      lights.push(Lg);
    });

    // Owner decisions: one visible warm lamp per side view, four pendants on the back wall.
    if (v === 'left') {
      var counter = itemById(items, 'kitchen.counter');
      var cx0 = counter ? counter.x + 6 : 216, cx1 = counter ? counter.x + counter.w - 6 : 304, cy = counter ? counter.y + 4 : 114;
      lights.push({ id: 'kitchen-undercab', type: 'line', points: [[cx0, cy], [cx1, cy]], rgb: [255, 196, 128], intensity: 1.7, radius: 58, squash: 0.7, when: 'always', role: 'lamp' });
    }
    if (v === 'right') {
      var lamp = itemById(items, 'study.lamp-r');
      var lx = lamp ? lamp.x + 14 : 96, ly = lamp ? lamp.y + 6 : 148;
      lights.push({ id: 'desk-lamp', type: 'cone', pos: [lx, ly], dir: 100, angle: 80, rgb: [255, 190, 112], intensity: 1.2, radius: 70, when: 'always', role: 'lamp' });
    }
    if (v === 'back') {
      L.key.scale = 0; // no direct key: the window is behind the camera
      L.key.bounce = 0.32;
      L.key.wall = 1;
      L.window.rect = null;
      for (var pi = 1; pi <= 4; pi++) {
        lights.push({ id: 'pendant-' + pi, type: 'cone', pos: [Math.round((core.w * pi) / 5), 14], dir: 90, angle: 84, rgb: [255, 196, 132], intensity: 0.95, radius: 150, when: 'always', role: 'pendant' });
      }
    }

    // At most 16 dynamic lights: bake the weakest extras (a static light has no channel and no drive).
    var dyn = lights.filter(function (l) {
      return !l.static;
    });
    if (dyn.length > 16) {
      dyn
        .filter(function (l) {
          return !l.channel && !l.drive;
        })
        .sort(function (a, b) {
          return a.intensity - b.intensity;
        })
        .slice(0, dyn.length - 16)
        .forEach(function (l) {
          l.static = true;
        });
    }
    L.lights = lights;
    return L;
  }

  /** The lighting block of a view: the bundle's curated views.<v>.lighting, else bootstrapped from v3.3 data. */
  function lightingFor(viewConf, viewId, items) {
    if (viewConf && viewConf.lighting) return viewConf.lighting;
    return lightingFromV33(viewConf, viewId, items);
  }

  var light = {
    NOLA: NOLA,
    KEYFRAMES: KEYFRAMES,
    KEYFRAME_NAMES: KEYFRAME_NAMES,
    DRIVE: DRIVE,
    TIER_NAMES: TIER_NAMES,
    DEBUG_VIEWS: DEBUG_VIEWS,
    MOON_ELEVATION: MOON_ELEVATION,
    sunPosition: sunPosition,
    centralOffset: centralOffset,
    atLocalTime: atLocalTime,
    keyframeWeights: keyframeWeights,
    blendKeyframes: blendKeyframes,
    windowDirect: windowDirect,
    completionW: completionW,
    drive: drive,
    parseFlags: parseFlags,
    state: state,
    gradeLut: gradeLut,
    depthOf: depthOf,
    yBaseOf: yBaseOf,
    depthRange: depthRange,
    lightingFromV33: lightingFromV33,
    lightingFor: lightingFor,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    lin: lin,
    luma: luma,
    angleDiff: angleDiff,
    smoothstep: smoothstep,
    flags: {},
  };

  if (typeof window !== 'undefined') {
    try {
      light.flags = parseFlags(window.location ? window.location.search : '');
    } catch {
      light.flags = {};
    }
    /**
     * The state for right now from the device clock, today's completion and the query flags.
     * Cached for 1 s (the sun moves about 0.004 degree a second).
     */
    var cache = { t: -1e9, s: null, key: '' };
    light.current = function (extra) {
      var R = window.ROOM || {};
      var t = Date.now();
      var p = R.data ? R.data.todayP || 0 : 0;
      var key = p + '|' + JSON.stringify(extra || {});
      if (!cache.s || t - cache.t > 1000 || key !== cache.key) {
        var opts = { p: p, flags: light.flags };
        if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) opts[k] = extra[k];
        cache = { t: t, s: state(t, opts), key: key };
      }
      return cache.s;
    };
    if (window.ROOM) window.ROOM.light = light;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = light;
})();
