/* FORGE room prototype: live weather in the window (TEXTURE_SPEC 7.1, INTERFACES 7).
 *
 * Source: the Open-Meteo forecast API for the room's fixed city (dorm preset: New Orleans,
 * lat 29.95, lon -90.07). The device location is never used. Fetched on load and every 15 minutes
 * while the tab is visible; the last response is cached in localStorage with its timestamp and used
 * for up to 3 hours when offline, else the window falls back to `clear`.
 *
 * What it draws (palette indices only, into f.buf, after the items are blitted and before the engine
 * marks), clipped to the window: pixels whose material (f.aux[i*3+2]) is 17 glass_window or 30 sky,
 * or 29 wet when the flags byte marks window glass (bit3):
 * - sky and outside remapped through small LUTs: overcast (desaturate, toward HAZE), fog (far layers
 *   stepped toward HAZE plus 2 dithered fog bands), storm, and the lightning flash (toward near white);
 * - a procedural cloud deck for partly (sparse) and overcast (80% cover) on sky pixels;
 * - rain outside the glass: 3 depth planes (1x3 RAIN_0, 1x4 RAIN_1, 1x5 RAIN_1 with a RAIN_HI head),
 *   180/240/320 px/s, count from precipitation (log scale), slant from the wind;
 * - beads on the glass (RAIN_HI over RAIN_0), reseeded every 20 s with a 400 ms dissolve;
 * - runs: 1 to 4 drops sliding down the glass at 20 to 60 px/s, wobbling 1 px, leaving a COOL_2
 *   trail that fades in 3 steps over 2 s;
 * - snow: slow 1 px flakes in 2 planes;
 * - drips: one pixel forming under the lip of a wet sill (material 29 without the glass flag) every
 *   1 to 3 s. This is the only write outside the window mask; setDebug({drips: false}) turns it off.
 *
 * Every field is deterministic per seed and anchored to world pixels (f.x0, f.y0), so drops do not
 * crawl when the camera moves, and animation reads only f.now, so a frozen clock gives stable frames.
 *
 * Lightning: flash(now) returns 0..1.8 for the GPU key light (LIGHTING_SPEC 12b u_flash). A sequence
 * is full for 2 frames, normal for 1, half for 1 (67 ms frames), sequences 8 to 25 s apart. Hard
 * limits (WCAG 2.3.1): never more than 1 sequence per 8 s, never 3 flashes within 1 s. Reduced motion:
 * no lightning, no runs, no falling rain; rain freezes as static beads, the sky stays overcast.
 *
 * Query flags: ?weather=clear|partly|overcast|fog|drizzle|rain|storm|snow  ?precip=0..20 (mm/h)
 * ?wind=0..60 (mph). Any of them switches the network off for the page.
 *
 * The pure helpers at the top (code mapping, curves, the flash scheduler, the cache rule) do not touch
 * the DOM and are exported through module.exports for Vitest, as engine/camera.js does.
 */
(function () {
  'use strict';

  /* ================================================================== pure helpers */

  var LAT = 29.95;
  var LON = -90.07;
  var API_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&current=weather_code,precipitation,rain,cloud_cover,wind_speed_10m,wind_direction_10m' +
    '&wind_speed_unit=mph&timezone=America%2FChicago';
  var STATES = ['clear', 'partly', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'];

  var FETCH_MS = 15 * 60 * 1000; // refetch interval while visible
  var CACHE_MAX_MS = 3 * 60 * 60 * 1000; // offline: cache usable for 3 hours
  var WET_MS = 20 * 60 * 1000; // the sill stays wet 20 minutes after rain

  // Lightning timing. A sequence starts once per SLOT, jittered by up to JITTER, so consecutive
  // sequences are SLOT - JITTER = 8 s to SLOT + JITTER = 25 s apart.
  var FLASH_SLOT = 16500;
  var FLASH_JITTER = 8500;
  var FLASH_FRAME = 67; // one "frame" of the flash pattern (about 2 display frames at 30 fps)
  var FLASH_MIN_GAP = 8000; // never more than 1 sequence per 8 s
  // [start frame, end frame, level]: full 2 frames, normal 1, half 1, then normal.
  var FLASH_PATTERN = [
    [0, 2, 1],
    [3, 4, 0.5],
  ];
  var FLASH_LEN = 4 * FLASH_FRAME;
  var FLASH_GAIN = 1.8; // key light multiplier at full flash

  /** 32-bit integer hash of three integers (murmur3 finaliser). */
  function hash3(a, b, c) {
    var h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  /** Uniform 0..1 from three integers. */
  function rnd(a, b, c) {
    return hash3(a, b, c) / 4294967296;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** WMO weather_code to a window state. Unknown or missing codes read as clear. */
  function stateForCode(code) {
    var c = Number(code);
    if (code == null || !isFinite(c)) return 'clear';
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'overcast';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c === 95 || c === 96 || c === 99) return 'storm';
    return 'clear';
  }

  /** True for the states that put water on the glass. */
  function isRainy(kind) {
    return kind === 'drizzle' || kind === 'rain' || kind === 'storm';
  }

  // Precipitation used when a precipitating state reports 0 mm (the API lags the weather code).
  var DEFAULT_PRECIP = { drizzle: 0.3, rain: 2, storm: 8, snow: 1 };

  /** The precipitation (mm/h, 0..20) to draw for a state and a reported amount. */
  function effectivePrecip(kind, mm) {
    if (!(kind in DEFAULT_PRECIP)) return 0;
    var v = Number(mm);
    if (v > 0 && isFinite(v)) return clamp(v, 0, 20);
    return DEFAULT_PRECIP[kind];
  }

  /**
   * Falling drops per 100x100 px for a precipitation in mm/h: 20 at 0.1 up to 160 at 8 or more,
   * on a log scale; linear from 0 below 0.1.
   */
  function dropDensity(mm) {
    var v = Number(mm);
    if (!(v > 0) || !isFinite(v)) return 0;
    if (v < 0.1) return 200 * v;
    var m = Math.min(v, 8);
    return 20 + (140 * Math.log(m / 0.1)) / Math.log(80);
  }

  /**
   * Horizontal px per vertical px for falling rain: wind (mph) / 40, clamped to 0..0.5, signed by
   * where the wind blows across the window. dirFrom is the meteorological direction (degrees the
   * wind comes from), facing the compass direction the window looks out to. Positive = drops move
   * right as they fall.
   */
  function windSlant(mph, dirFrom, facing) {
    var m = Number(mph);
    if (!(m > 0) || !isFinite(m)) return 0;
    var mag = Math.min(0.5, m / 40);
    var d = Number(dirFrom), fc = Number(facing) || 0;
    var across = isFinite(d) ? -Math.sin(((d - fc) * Math.PI) / 180) : 1;
    return across < 0 ? -mag : mag;
  }

  /** Start time (ms on the ROOM.now timeline) of flash sequence k for a seed. */
  function flashStart(seed, k) {
    return k * FLASH_SLOT + Math.floor(rnd(seed, k, 0x51f7) * (FLASH_JITTER + 1));
  }

  /** Flash sequence start times in [t0, t1). */
  function flashSequences(seed, t0, t1) {
    var out = [];
    for (var k = Math.floor(t0 / FLASH_SLOT) - 1; k * FLASH_SLOT < t1; k++) {
      var s = flashStart(seed, k);
      if (s >= t0 && s < t1) out.push(s);
    }
    return out;
  }

  /** Pattern level 0..1 at dt ms into a sequence. */
  function patternLevel(dt) {
    if (dt < 0 || dt >= FLASH_LEN) return 0;
    var fr = Math.floor(dt / FLASH_FRAME);
    for (var i = 0; i < FLASH_PATTERN.length; i++) {
      if (fr >= FLASH_PATTERN[i][0] && fr < FLASH_PATTERN[i][1]) return FLASH_PATTERN[i][2];
    }
    return 0;
  }

  /** {start, level 0..1} of the sequence covering time t (level 0 between flashes). */
  function flashAt(seed, t) {
    var k = Math.floor(t / FLASH_SLOT);
    var s = flashStart(seed, k);
    return { start: s, level: patternLevel(t - s) };
  }

  /** Flash onsets (times where the level rises from 0) in [t0, t1), for the photosensitivity check. */
  function flashOnsets(seed, t0, t1) {
    var out = [];
    flashSequences(seed, t0 - FLASH_LEN, t1).forEach(function (s) {
      FLASH_PATTERN.forEach(function (p) {
        var t = s + p[0] * FLASH_FRAME;
        if (t >= t0 && t < t1) out.push(t);
      });
    });
    return out;
  }

  /**
   * The runtime limiter behind the schedule: a sequence may start only if it is at least 8 s after
   * the last one that played, and only if fewer than 3 flash onsets would fall within 1 s.
   * guard = {last: start ms | null, onsets: [ms...]}. Returns true and records it when allowed.
   */
  function guardAllow(guard, start) {
    if (guard.last != null && start < guard.last) {
      // the clock moved backwards (a test or debug rewind): forget the history
      guard.last = null;
      guard.onsets = [];
    }
    if (guard.last != null && start === guard.last) return true;
    if (guard.last != null && start - guard.last < FLASH_MIN_GAP) return false;
    var mine = FLASH_PATTERN.map(function (p) {
      return start + p[0] * FLASH_FRAME;
    });
    var all = guard.onsets.concat(mine);
    for (var i = 0; i < all.length; i++) {
      var n = 0;
      for (var j = 0; j < all.length; j++) if (all[j] >= all[i] && all[j] < all[i] + 1000) n++;
      if (n >= 3) return false;
    }
    guard.last = start;
    guard.onsets = all.filter(function (t) {
      return t > start - 2000;
    });
    return true;
  }

  /** Is a cache entry {at} younger than the offline limit (3 hours) at wall time nowMs? */
  function cacheUsable(entry, nowMs) {
    if (!entry || !entry.data || !(entry.at > 0)) return false;
    var age = nowMs - entry.at;
    return age >= 0 && age < CACHE_MAX_MS;
  }

  /** Where the weather comes from: 'live' after a good fetch, else 'cache' (under 3 h), else 'clear'. */
  function pickSource(entry, nowMs, fetchOk) {
    if (fetchOk) return 'live';
    return cacheUsable(entry, nowMs) ? 'cache' : 'clear';
  }

  /** Fetch now? Only while visible, and only 15 minutes after the last attempt (or never tried). */
  function shouldFetch(lastAttemptMs, nowMs, visible) {
    if (!visible) return false;
    if (lastAttemptMs == null) return true;
    return nowMs - lastAttemptMs >= FETCH_MS || nowMs < lastAttemptMs;
  }

  /** Sill wetness: while it rains, and for 20 minutes after the last rainy reading. */
  function isWet(kind, lastRainAt, nowMs) {
    if (isRainy(kind)) return true;
    return lastRainAt > 0 && nowMs - lastRainAt >= 0 && nowMs - lastRainAt < WET_MS;
  }

  /** Open-Meteo JSON to {code, precip, cloud, wind, dir}, or null when it is not usable. */
  function parseCurrent(json) {
    var c = json && json.current;
    if (!c || c.weather_code == null) return null;
    var num = function (v) {
      var n = Number(v);
      return isFinite(n) ? n : 0;
    };
    return {
      code: num(c.weather_code),
      precip: Math.max(num(c.precipitation), num(c.rain)),
      cloud: num(c.cloud_cover),
      wind: num(c.wind_speed_10m),
      dir: num(c.wind_direction_10m),
    };
  }

  /** Read the debug query flags into overrides {weather?, precip?, wind?}. */
  function parseFlags(get) {
    var o = {};
    var w = get('weather');
    if (w && STATES.indexOf(w) >= 0) o.weather = w;
    var p = get('precip');
    if (p != null && p !== '' && isFinite(Number(p))) o.precip = clamp(Number(p), 0, 20);
    var wd = get('wind');
    if (wd != null && wd !== '' && isFinite(Number(wd))) o.wind = clamp(Number(wd), 0, 60);
    return o;
  }

  var pure = {
    LAT: LAT,
    LON: LON,
    API_URL: API_URL,
    STATES: STATES,
    FETCH_MS: FETCH_MS,
    CACHE_MAX_MS: CACHE_MAX_MS,
    WET_MS: WET_MS,
    FLASH_SLOT: FLASH_SLOT,
    FLASH_JITTER: FLASH_JITTER,
    FLASH_FRAME: FLASH_FRAME,
    FLASH_LEN: FLASH_LEN,
    FLASH_MIN_GAP: FLASH_MIN_GAP,
    FLASH_GAIN: FLASH_GAIN,
    hash3: hash3,
    rnd: rnd,
    stateForCode: stateForCode,
    isRainy: isRainy,
    effectivePrecip: effectivePrecip,
    dropDensity: dropDensity,
    windSlant: windSlant,
    flashStart: flashStart,
    flashSequences: flashSequences,
    flashAt: flashAt,
    flashOnsets: flashOnsets,
    patternLevel: patternLevel,
    guardAllow: guardAllow,
    cacheUsable: cacheUsable,
    pickSource: pickSource,
    shouldFetch: shouldFetch,
    isWet: isWet,
    parseCurrent: parseCurrent,
    parseFlags: parseFlags,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof window === 'undefined' || !window.ROOM) return;

  /* ================================================================== the room part */

  var ROOM = window.ROOM;
  var C = ROOM.C || {};
  var CACHE_KEY = 'forge.weather.v1';
  var SEED = 1;
  var STEP_MS = 1000 / 24; // rain and snow animate at 24 fps

  // Material IDs (TEXTURE_SPEC 4) and aux flag bits (INTERFACES 5).
  var MAT_GLASS = 17;
  var MAT_WET = 29;
  var MAT_SKY = 30;
  var FLAG_WINDOW = 8;

  function col(name, fallback) {
    return C[name] != null ? C[name] : fallback;
  }
  var K = {
    RAIN_0: col('RAIN_0', 57),
    RAIN_1: col('RAIN_1', 58),
    RAIN_HI: col('RAIN_HI', 59),
    COOL_0: col('COOL_0', 49),
    COOL_1: col('COOL_1', 50),
    COOL_2: col('COOL_2', 51),
    CREAM: col('CREAM', 31),
    HAZE: col('HAZE', 63),
    GLASS_DK: col('GLASS_DK', 60),
    SLATE_2: col('SLATE_2', 24),
  };

  // RGB used for the LUT maths when the bundle's palette does not have the r6 colours yet.
  var SPEC_HEX = {
    49: '#1E2632', 50: '#2B3646', 51: '#3D4A60', 57: '#5D7FA6', 58: '#8FA9C9', 59: '#C9DAEE',
    60: '#1A2228', 63: '#4A3F4C',
  };

  /* ------------------------------------------------------------------ state */
  var state = {
    kind: 'clear', // one of STATES
    code: 0, // WMO weather_code
    precip: 0, // mm/h as drawn (effectivePrecip)
    rawPrecip: 0, // mm as reported
    cloud: 0, // cloud cover %
    wind: 0, // mph
    dir: 270, // degrees the wind comes from
    slant: 0, // horizontal px per vertical px of falling rain
    source: 'default', // live | cache | clear | debug | default
    updatedAt: 0, // wall clock ms of the data
    lastRainAt: 0, // wall clock ms of the last rainy reading (sill wetness)
    error: null,
  };
  var live = null; // last parsed reading {code, precip, cloud, wind, dir} and its time
  var debug = { drips: true };
  var guard = { last: null, onsets: [] };
  var lastAttempt = null;
  var inited = false;
  var timer = 0;

  function reduced() {
    return !!(ROOM.state && ROOM.state.reducedMotion);
  }
  function night() {
    return !!(ROOM.state && ROOM.state.night);
  }

  function facing() {
    var v = ROOM.state && ROOM.state.view;
    var views = ROOM.art && ROOM.art.zones && ROOM.art.zones.views;
    var vw = views && (views[v] || views.main || views.front);
    var w = vw && vw.lighting && vw.lighting.window;
    return w && isFinite(w.facing) ? w.facing : 0;
  }

  /** Recompute the drawn state from the reading and the debug overrides. */
  function apply(reading, source) {
    var r = reading || { code: 0, precip: 0, cloud: 0, wind: 0, dir: 270 };
    var before = state.kind + '|' + state.precip + '|' + state.wind + '|' + state.source;
    var wasRainy = isRainy(state.kind);
    var kind = stateForCode(r.code);
    var precip = r.precip;
    var wind = r.wind;
    if (debug.weather) kind = debug.weather;
    else if (debug.precip > 0 && !isRainy(kind) && kind !== 'snow') kind = 'rain';
    if (debug.precip != null) precip = debug.precip;
    if (debug.wind != null) wind = debug.wind;
    state.kind = kind;
    state.code = r.code;
    state.rawPrecip = r.precip;
    state.precip = effectivePrecip(kind, precip);
    state.cloud = r.cloud;
    state.wind = wind;
    state.dir = debug.dir != null ? debug.dir : r.dir;
    state.slant = windSlant(wind, state.dir, facing());
    state.source = debug.weather || debug.precip != null || debug.wind != null ? 'debug' : source;
    var nowMs = Date.now();
    if (isRainy(kind)) state.lastRainAt = nowMs;
    else if (wasRainy) state.lastRainAt = nowMs;
    var after = state.kind + '|' + state.precip + '|' + state.wind + '|' + state.source;
    if (after !== before) {
      if (ROOM.emit) ROOM.emit('weather', state);
      if (ROOM.invalidate) ROOM.invalidate();
    }
  }

  /* ------------------------------------------------------------------ cache and fetch */
  function readCache() {
    try {
      var s = window.localStorage.getItem(CACHE_KEY);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  }
  function writeCache(entry) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
      /* private mode or quota: run without a cache */
    }
  }

  function fallback(err) {
    state.error = err ? String(err.message || err) : null;
    var nowMs = Date.now();
    if (live && nowMs - live.at < CACHE_MAX_MS) return apply(live.data, 'cache');
    var entry = readCache();
    if (pickSource(entry, nowMs, false) === 'cache') {
      if (entry.lastRainAt > state.lastRainAt) state.lastRainAt = entry.lastRainAt;
      live = { at: entry.at, data: entry.data };
      state.updatedAt = entry.at;
      return apply(entry.data, 'cache');
    }
    state.updatedAt = 0;
    apply(null, 'clear');
  }

  function fetchNow() {
    lastAttempt = Date.now();
    if (typeof fetch !== 'function' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      fallback(new Error('offline'));
      return;
    }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var kill = setTimeout(function () {
      if (ctl) ctl.abort();
    }, 10000);
    fetch(API_URL, ctl ? { signal: ctl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        clearTimeout(kill);
        var data = parseCurrent(json);
        if (!data) throw new Error('no current weather');
        var at = Date.now();
        live = { at: at, data: data };
        state.error = null;
        state.updatedAt = at;
        apply(data, 'live');
        writeCache({ at: at, data: data, lastRainAt: state.lastRainAt });
      })
      .catch(function (err) {
        clearTimeout(kill);
        fallback(err);
      });
  }

  function visible() {
    return typeof document === 'undefined' || !document.hidden;
  }
  function poll() {
    if (debug.offline) return;
    if (shouldFetch(lastAttempt, Date.now(), visible())) fetchNow();
  }

  /** Start: debug flags, then the cache, then the network (skipped when any debug flag is set). */
  function init() {
    if (inited) return;
    inited = true;
    var q = ROOM.query || new URLSearchParams((window.location && window.location.search) || '');
    var flags = parseFlags(function (k) {
      return q.get(k);
    });
    Object.keys(flags).forEach(function (k) {
      debug[k] = flags[k];
    });
    if (Object.keys(flags).length) debug.offline = true;
    var entry = readCache();
    var nowMs = Date.now();
    if (entry && entry.lastRainAt > 0) state.lastRainAt = entry.lastRainAt;
    if (cacheUsable(entry, nowMs)) {
      live = { at: entry.at, data: entry.data };
      state.updatedAt = entry.at;
      apply(entry.data, 'cache');
      // a reload within 15 minutes reuses the cache instead of refetching (kind to the free API)
      if (nowMs - entry.at < FETCH_MS) lastAttempt = entry.at;
    } else apply(null, debug.offline ? 'debug' : 'default');
    if (debug.offline) return;
    poll();
    timer = setInterval(poll, 60 * 1000);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) poll();
      });
  }

  /**
   * Debug overrides: setDebug({weather, precip, wind, dir, seed, drips, offline}). A key set to null
   * clears it; setDebug(null) clears everything and goes back to the network reading.
   */
  function setDebug(o) {
    if (o == null) {
      debug = { drips: true };
    } else {
      Object.keys(o).forEach(function (k) {
        if (o[k] == null) delete debug[k];
        else debug[k] = o[k];
      });
    }
    if (debug.weather && STATES.indexOf(debug.weather) < 0) delete debug.weather;
    if (debug.seed != null) SEED = debug.seed | 0;
    else SEED = 1;
    guard = { last: null, onsets: [] };
    apply(live ? live.data : null, live ? 'live' : state.source === 'debug' ? 'default' : state.source);
  }

  /* ------------------------------------------------------------------ palette LUTs */
  var rgbCache = null, rgbLen = -1;
  function paletteRgb() {
    var colors = (ROOM.art && ROOM.art.palette && ROOM.art.palette.colors) || [];
    if (rgbCache && rgbLen === colors.length) return rgbCache;
    var rgb = [];
    var hex = function (h) {
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    };
    colors.forEach(function (c, i) {
      if (c && typeof c[1] === 'string') rgb[i] = hex(c[1]);
    });
    var have = rgb.slice();
    Object.keys(SPEC_HEX).forEach(function (i) {
      if (!rgb[i]) rgb[i] = hex(SPEC_HEX[i]);
    });
    rgbCache = { rgb: rgb, have: have, hex: hex };
    rgbLen = colors.length;
    luts = {};
    return rgbCache;
  }

  // Redmean colour distance (cheap, close enough to perceptual for a 64-colour palette).
  function dist(a, b) {
    var rm = (a[0] + b[0]) / 2;
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }
  function nearest(c, pal, allow) {
    var best = -1, bd = Infinity;
    for (var i = 0; i < pal.have.length; i++) {
      var p = pal.have[i];
      if (!p || (allow && !allow[i])) continue;
      var d = dist(c, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * A 256-entry LUT: every palette colour desaturated by `desat`, moved `t` of the way to `target`
   * (RGB), optionally scaled by `gain`, then snapped to the nearest palette colour among the names in
   * `set` (all colours when the palette has fewer than 6 of them). 255 stays 255.
   */
  function makeLut(target, t, desat, gain, set) {
    var pal = paletteRgb();
    var allow = null;
    if (set) {
      allow = [];
      var found = 0;
      set.forEach(function (name) {
        if (C[name] != null && pal.have[C[name]]) {
          allow[C[name]] = true;
          found++;
        }
      });
      if (found < 6) allow = null;
    }
    var lut = new Uint8Array(256);
    for (var i = 0; i < 256; i++) lut[i] = i;
    for (var j = 0; j < pal.have.length; j++) {
      var c = pal.have[j];
      if (!c) continue;
      var y = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      var o = [0, 0, 0];
      for (var k = 0; k < 3; k++) {
        var v = c[k] + (y - c[k]) * (desat || 0);
        v = v + (target[k] - v) * t;
        o[k] = clamp(v * (gain || 1), 0, 255);
      }
      var n = nearest(o, pal, allow);
      if (n >= 0) lut[j] = n;
    }
    return lut;
  }

  /**
   * A ramp LUT: every palette colour's luminance placed between `lo` and `hi` (0..1) along the
   * named ramp (sorted dark to light). Monotone, so the sky keeps its banding but in the ramp's
   * tones. Falls back to an identity LUT when the palette lacks the ramp.
   */
  function rampLut(names, lo, hi) {
    var pal = paletteRgb();
    var lum = function (c) {
      return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    };
    var ramp = names.filter(function (n) {
      return C[n] != null && pal.have[C[n]];
    }).map(function (n) {
      return C[n];
    });
    ramp.sort(function (a, b) {
      return lum(pal.have[a]) - lum(pal.have[b]);
    });
    var out = new Uint8Array(256);
    for (var i = 0; i < 256; i++) out[i] = i;
    if (ramp.length < 2) return out;
    for (var j = 0; j < pal.have.length; j++) {
      if (!pal.have[j]) continue;
      var pos = lo + (hi - lo) * (lum(pal.have[j]) / 255);
      out[j] = ramp[clamp(Math.round(pos * (ramp.length - 1)), 0, ramp.length - 1)];
    }
    return out;
  }

  // Weather greys come from the cool and neutral ramps only, so a desaturated sky never snaps to a
  // warm paper or linen tone.
  var COOL = ['VOID', 'INK', 'INK_2', 'BROWN_1', 'NAVY', 'LEAF_0', 'LEAF_1', 'SLATE_D', 'SLATE_0', 'SLATE_1', 'SLATE_2',
    'SLATE_3', 'COOL_0', 'COOL_1', 'COOL_2', 'RAIN_0', 'RAIN_1', 'RAIN_HI', 'GLASS_DK', 'HAZE', 'PLASTER_0',
    'PLASTER_1', 'PLASTER', 'PLASTER_2', 'PLASTER_3', 'PLASTER_4', 'PLUM_0', 'PLUM_1', 'LINEN_2'];
  var FOGGY = COOL.concat(['LINEN_1']);
  var BRIGHT = COOL.concat(['CREAM', 'LINEN_1']);
  var COOLER = COOL.filter(function (n) {
    return n !== 'LINEN_2';
  });

  var luts = {};
  function lut(name) {
    var key = name + (night() ? ':n' : ':d');
    if (luts[key]) return luts[key];
    var pal = paletteRgb();
    var haze = pal.rgb[K.HAZE] || pal.hex('#4A3F4C');
    var nt = night();
    var L;
    switch (name) {
      // overcast: desaturate and move toward HAZE (lighter grey by day, haze itself at night)
      case 'ovcSky':
        L = nt ? rampLut(['INK', 'COOL_0', 'HAZE', 'PLASTER_4'], 0.1, 1.2) : rampLut(['HAZE', 'PLASTER_4', 'LINEN_2', 'LINEN_1'], -0.1, 1.15);
        break;
      case 'ovcGlass':
        L = makeLut(nt ? haze : [104, 96, 108], 0.25, 0.45, 1, COOL);
        break;
      // storm: darker and cooler
      // rain: the overcast sky one step cooler and darker
      case 'rainSky':
        L = nt ? rampLut(['INK', 'COOL_0', 'COOL_1', 'HAZE'], 0.1, 1.1) : rampLut(['COOL_2', 'HAZE', 'PLASTER_4', 'LINEN_2'], -0.1, 1.1);
        break;
      case 'rainCloud':
        L = nt ? rampLut(['INK', 'COOL_0', 'COOL_1'], 0.2, 1.4) : rampLut(['HAZE', 'PLASTER_4', 'LINEN_2'], 0.1, 1.2);
        break;
      case 'stormSky':
        L = makeLut(nt ? [40, 42, 56] : [84, 86, 100], 0.55, 0.8, 1, COOL);
        break;
      case 'stormGlass':
        L = makeLut(nt ? [34, 36, 48] : [70, 70, 84], 0.35, 0.55, 1, COOL);
        break;
      // cloud deck tones: body and underside
      case 'cloudHi':
        L = nt ? rampLut(['COOL_0', 'HAZE', 'PLASTER_4'], 0.3, 1.6) : rampLut(['LINEN_2', 'LINEN_1'], 0.2, 1.4);
        break;
      case 'cloudLo':
        L = nt ? rampLut(['INK', 'COOL_0', 'HAZE'], 0.3, 1.6) : rampLut(['PLASTER_4', 'LINEN_2'], 0.1, 1.2);
        break;
      case 'stormCloud':
        L = makeLut(nt ? [30, 32, 44] : [62, 64, 78], 0.65, 0.85, 1, COOL);
        break;
      // fog: 3 steps toward HAZE (by day a pale haze, at night HAZE itself)
      case 'fog1':
        L = makeLut(nt ? haze : [150, 140, 150], 0.3, 0.4, 1, FOGGY);
        break;
      case 'fog2':
        L = makeLut(nt ? haze : [160, 150, 160], 0.55, 0.6, 1, FOGGY);
        break;
      case 'fog3':
        L = makeLut(nt ? haze : [170, 160, 170], 0.8, 0.85, 1, FOGGY);
        break;
      // lightning: sky toward near white, glass (the outside) a step brighter
      case 'flashSky':
        L = makeLut([236, 240, 250], 0.85, 0.6, 1, BRIGHT);
        break;
      case 'flashSkyHalf':
        L = makeLut([220, 226, 240], 0.5, 0.5, 1, BRIGHT);
        break;
      case 'flashGlass':
        L = makeLut([200, 208, 226], 0.45, 0.5, 1, COOLER);
        break;
      case 'flashGlassHalf':
        L = makeLut([180, 188, 210], 0.22, 0.3, 1, COOLER);
        break;
      default:
        L = makeLut([0, 0, 0], 0, 0);
    }
    luts[key] = L;
    return L;
  }

  /* ------------------------------------------------------------------ the window mask */
  // mk: 0 outside the window, 1 glass (outside scenery), 2 sky, 3 wet sill (drips only).
  var mk = null;
  var box = { x0: 0, y0: 0, x1: -1, y1: -1 };
  var winRect = {}; // per view: world rect of the glass seen so far {x0, y0, x1, y1}

  function scanMask(f) {
    var n = f.w * f.h;
    if (!mk || mk.length < n) mk = new Uint8Array(n);
    var aux = f.aux, w = f.w;
    var x0 = f.w, y0 = f.h, x1 = -1, y1 = -1, wet = false;
    var h = f.h;
    for (var y = 0, i = 0; y < h; y++) {
      var rx0 = w, rx1 = -1;
      for (var x = 0; x < w; x++, i++) {
        var m = aux[i * 3 + 2], v = 0;
        if (m === MAT_GLASS) v = 1;
        else if (m === MAT_SKY) v = 2;
        else if (m === MAT_WET) v = aux[i * 3 + 1] & FLAG_WINDOW ? 1 : 3;
        mk[i] = v;
        if (v === 1 || v === 2) {
          if (rx0 === w) rx0 = x;
          rx1 = x;
        } else if (v === 3) wet = true;
      }
      if (rx1 >= 0) {
        if (rx0 < x0) x0 = rx0;
        if (rx1 > x1) x1 = rx1;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
    box.x0 = x0;
    box.y0 = y0;
    box.x1 = x1;
    box.y1 = y1;
    box.wet = wet;
    return x1 >= 0;
  }

  // The window's world rect: the lighting block's window.rect when present, else the union of every
  // glass extent seen in this view (so runs keep their lanes when the camera zooms in).
  function windowRect(f) {
    var v = ROOM.normView ? ROOM.normView(ROOM.state && ROOM.state.view) : (ROOM.state && ROOM.state.view) || 'front';
    var views = ROOM.art && ROOM.art.zones && ROOM.art.zones.views;
    var vw = views && views[v];
    var r = vw && vw.lighting && vw.lighting.window && vw.lighting.window.rect;
    if (r && r.length === 4) return { x0: r[0], y0: r[1], x1: r[0] + r[2] - 1, y1: r[1] + r[3] - 1 };
    var u = winRect[v];
    var b = { x0: box.x0 + f.x0, y0: box.y0 + f.y0, x1: box.x1 + f.x0, y1: box.y1 + f.y0 };
    if (!u) u = winRect[v] = b;
    else {
      u.x0 = Math.min(u.x0, b.x0);
      u.y0 = Math.min(u.y0, b.y0);
      u.x1 = Math.max(u.x1, b.x1);
      u.y1 = Math.max(u.y1, b.y1);
    }
    return u;
  }

  /* ------------------------------------------------------------------ drawing helpers */
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // Map our colour through the frame's lighting LUT (the CPU path); the GPU path passes identity.
  var outLut = null;
  function out(c) {
    return outLut ? outLut[c] : c;
  }

  function put(f, x, y, c, want) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    var i = y * f.w + x;
    var m = mk[i];
    if (want ? m === want : m === 1 || m === 2) f.buf[i] = c;
  }
  function putGlass(f, x, y, c, glint) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    var i = y * f.w + x;
    var m = mk[i];
    if (m !== 1 && m !== 2) return;
    f.buf[i] = c;
    // beads and run heads glint in the shader (wet: gloss 0.9, glint 1.0)
    if (glint) f.aux[i * 3 + 2] = MAT_WET;
  }

  // Smooth value noise on a world grid (cell px), 0..1.
  function vnoise(x, y, cell, seed) {
    var gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    var fx = x / cell - gx, fy = y / cell - gy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var a = rnd(gx, gy, seed), b = rnd(gx + 1, gy, seed), c = rnd(gx, gy + 1, seed), d = rnd(gx + 1, gy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /* ------------------------------------------------------------------ atmosphere (LUT passes) */
  function atmosphere(f, kind, flashLevel, wr, ox) {
    var sky = null, glass = null;
    if (kind === 'drizzle' || kind === 'rain') {
      sky = lut('rainSky');
      glass = lut('ovcGlass');
    } else if (kind === 'overcast' || kind === 'snow') {
      sky = lut('ovcSky');
      glass = lut('ovcGlass');
    } else if (kind === 'storm') {
      sky = lut('stormSky');
      glass = lut('stormGlass');
    }
    var fog = kind === 'fog';
    var fog1 = fog ? lut('fog1') : null, fog2 = fog ? lut('fog2') : null, fog3 = fog ? lut('fog3') : null;
    var clouds = kind === 'partly' ? 0.34 : kind === 'overcast' ? 0.8 : kind === 'storm' || kind === 'rain' ? 0.9 : 0;
    var cHi = clouds ? lut(kind === 'storm' ? 'stormCloud' : kind === 'rain' ? 'rainCloud' : 'cloudHi') : null;
    var cLo = clouds ? lut(kind === 'storm' ? 'stormCloud' : kind === 'rain' ? 'rainSky' : 'cloudLo') : null;
    var fsky = flashLevel >= 1 ? lut('flashSky') : flashLevel > 0 ? lut('flashSkyHalf') : null;
    var fgl = flashLevel >= 1 ? lut('flashGlass') : flashLevel > 0 ? lut('flashGlassHalf') : null;
    if (!sky && !fog && !clouds && !fsky) return;

    var t = reduced() ? 0 : f.now / 1000;
    var drift = Math.floor(t * (1.5 + state.wind / 8)); // cloud drift, whole px per s
    var wh = wr.y1 - wr.y0 + 1;
    var bandA = wr.y0 + Math.round(wh * 0.56), bandB = wr.y0 + Math.round(wh * 0.8);
    var near = wr.y0 + Math.round(wh * 0.82); // lowest part of the view: rooftops, nearest
    var fogShift = Math.floor(t * 3);
    var buf = f.buf, w = f.w;
    for (var y = box.y0; y <= box.y1; y++) {
      var wy = y + f.y0;
      var brow = (wy & 3) * 4;
      for (var x = box.x0; x <= box.x1; x++) {
        var i = y * w + x;
        var m = mk[i];
        if (m !== 1 && m !== 2) continue;
        var v = buf[i];
        var wx = x + f.x0 + ox;
        var th = BAYER[brow + (wx & 3)] / 16;
        if (fog) {
          var L = m === 2 ? fog3 : wy >= near ? fog1 : fog2;
          // two dithered bands of ground fog that drift slowly
          var dA = Math.abs(wy - bandA), dB = Math.abs(wy - bandB);
          var dB2 = Math.min(dA / 5, dB / 4);
          var wav = vnoise(wx + fogShift, wy, 12, 77);
          if (dB2 < 1 && th < (1 - dB2) * (0.55 + 0.45 * wav)) L = fog3;
          v = L[v];
        } else {
          if (m === 2 && clouds) {
            var n = vnoise(wx - drift, wy * 2.2, 22, 31) * 0.7 + vnoise(wx - drift, wy * 2, 8, 32) * 0.3;
            var edge = 1 - clouds; // threshold: coverage = 1 - edge
            if (n > edge + 0.05 || (n > edge && th < (n - edge) * 20)) {
              v = (n > edge + 0.22 || (n > edge + 0.16 && th < 0.5) ? cHi : cLo)[v];
            } else if (sky) v = sky[v];
          } else if (m === 2 && sky) v = sky[v];
          else if (m === 1 && glass) v = glass[v];
        }
        if (fsky) v = (m === 2 ? fsky : fgl)[v];
        buf[i] = v;
      }
    }
  }

  /* ------------------------------------------------------------------ rain outside */
  var TILE = 128;
  var PLANES = [
    { len: 3, speed: 180, share: 0.5, seed: 11 },
    { len: 4, speed: 240, share: 0.3, seed: 12 },
    { len: 5, speed: 320, share: 0.2, seed: 13 },
  ];

  function rainField(f, density, slant, t, ox, planes) {
    var nt = night();
    var x0 = box.x0 + f.x0 + ox, x1 = box.x1 + f.x0 + ox;
    var y0 = box.y0 + f.y0, y1 = box.y1 + f.y0 + 6;
    var tx0 = Math.floor((x0 - 8) / TILE), tx1 = Math.floor((x1 + 8) / TILE);
    var ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
    for (var p = 0; p < planes; p++) {
      var pl = PLANES[p];
      var per = (density * pl.share * TILE * TILE) / 10000;
      var body = nt ? (p === 0 ? K.COOL_2 : K.RAIN_0) : p === 0 ? K.RAIN_0 : K.RAIN_1;
      var head = p === 2 ? (nt ? K.RAIN_1 : K.RAIN_HI) : body;
      body = out(body);
      head = out(head);
      for (var ty = ty0; ty <= ty1; ty++) {
        for (var tx = tx0; tx <= tx1; tx++) {
          // whole drops per tile, with the fraction decided per tile so density is smooth
          var cnt = Math.floor(per + rnd(tx, ty, pl.seed + 100));
          for (var k = 0; k < cnt; k++) {
            var bx = rnd(tx * 4099 + k, ty, pl.seed) * TILE;
            var by = rnd(tx, ty * 4099 + k, pl.seed + 7) * TILE;
            var sp = pl.speed * (0.9 + 0.2 * rnd(k, tx + ty * 31, pl.seed + 3));
            var fall = by + sp * t;
            var yy = ((fall % TILE) + TILE) % TILE;
            var xx = (((bx + slant * fall) % TILE) + TILE) % TILE;
            var hx = tx * TILE + xx - f.x0 - ox;
            var hy = Math.floor(ty * TILE + yy - f.y0);
            for (var s = 0; s < pl.len; s++) {
              var px = Math.round(hx - slant * s);
              put(f, px, hy - s, s === 0 ? head : body);
            }
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ snow */
  function snowField(f, density, slant, t, ox) {
    var nt = night();
    var x0 = box.x0 + f.x0 + ox, x1 = box.x1 + f.x0 + ox;
    var y0 = box.y0 + f.y0, y1 = box.y1 + f.y0;
    var tx0 = Math.floor((x0 - 4) / TILE), tx1 = Math.floor((x1 + 4) / TILE);
    var ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
    var planes = [
      { speed: 11, share: 0.6, c: nt ? K.COOL_2 : K.RAIN_1, seed: 21 },
      { speed: 22, share: 0.4, c: nt ? K.RAIN_1 : K.CREAM, seed: 22 },
    ];
    for (var p = 0; p < planes.length; p++) {
      var pl = planes[p];
      var per = (density * pl.share * TILE * TILE) / 10000;
      var c = out(pl.c);
      for (var ty = ty0; ty <= ty1; ty++) {
        for (var tx = tx0; tx <= tx1; tx++) {
          var cnt = Math.floor(per + rnd(tx, ty, pl.seed + 100));
          for (var k = 0; k < cnt; k++) {
            var bx = rnd(tx * 4099 + k, ty, pl.seed) * TILE;
            var by = rnd(tx, ty * 4099 + k, pl.seed + 7) * TILE;
            var ph = rnd(k, tx, ty + pl.seed) * 6.283;
            var fall = by + pl.speed * t;
            var yy = ((fall % TILE) + TILE) % TILE;
            var sway = 1.6 * Math.sin(t * 1.3 + ph + fall / 17);
            var xx = (((bx + slant * 0.6 * fall + sway) % TILE) + TILE) % TILE;
            put(f, Math.round(tx * TILE + xx - f.x0 - ox), Math.floor(ty * TILE + yy - f.y0), c);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ beads on the glass */
  var BEAD_TILE = 64;
  var BEAD_MS = 20000;
  var DISSOLVE_MS = 400;

  function beadSet(f, gen, dens, keep, ox) {
    // keep(r): is a bead with dissolve hash r visible in this generation?
    var hi = out(night() ? K.RAIN_1 : K.RAIN_HI), lo = out(K.RAIN_0), one = out(night() ? K.RAIN_0 : K.RAIN_1);
    var x0 = box.x0 + f.x0 + ox, x1 = box.x1 + f.x0 + ox;
    var y0 = box.y0 + f.y0, y1 = box.y1 + f.y0;
    var per = (dens * BEAD_TILE * BEAD_TILE) / 10000;
    for (var ty = Math.floor(y0 / BEAD_TILE); ty <= Math.floor(y1 / BEAD_TILE); ty++) {
      for (var tx = Math.floor(x0 / BEAD_TILE); tx <= Math.floor(x1 / BEAD_TILE); tx++) {
        var cnt = Math.floor(per + rnd(tx, ty, gen * 7 + 41));
        for (var k = 0; k < cnt; k++) {
          if (!keep(rnd(k, tx * 131 + ty, gen + 43))) continue;
          var bx = Math.floor(tx * BEAD_TILE + rnd(tx * 977 + k, ty, gen + 44) * BEAD_TILE) - f.x0 - ox;
          var by = Math.floor(ty * BEAD_TILE + rnd(tx, ty * 977 + k, gen + 45) * BEAD_TILE) - f.y0;
          var big = rnd(k, ty, tx + gen * 3) < 0.45;
          if (big) {
            // 2 px bead: glint on top, shadow side below; both pixels must be glass
            var i0 = by * f.w + bx;
            if (bx < 0 || by < 0 || bx >= f.w || by + 1 >= f.h) continue;
            var m0 = mk[i0], m1 = mk[i0 + f.w];
            if ((m0 === 1 || m0 === 2) && (m1 === 1 || m1 === 2)) {
              putGlass(f, bx, by, hi, true);
              putGlass(f, bx, by + 1, lo, false);
            }
          } else putGlass(f, bx, by, one, false);
        }
      }
    }
  }

  function beads(f, dens, t, ox) {
    if (dens <= 0) return;
    if (reduced()) {
      beadSet(f, 0, dens, function () {
        return true;
      }, ox);
      return;
    }
    var gen = Math.floor(t / BEAD_MS);
    var into = t - gen * BEAD_MS;
    if (into < DISSOLVE_MS) {
      // the last 400 ms: old beads dissolve out as new ones dissolve in, pixel by pixel
      var u = into / DISSOLVE_MS;
      beadSet(f, gen - 1, dens, function (r) {
        return r >= u;
      }, ox);
      beadSet(f, gen, dens, function (r) {
        return r < u;
      }, ox);
    } else
      beadSet(f, gen, dens, function () {
        return true;
      }, ox);
  }

  /* ------------------------------------------------------------------ runs down the glass */
  var RUN_CYCLE = 12000;
  var TRAIL_MS = 2000;

  function runs(f, count, t, wr, ox) {
    var hi = out(K.RAIN_HI), body = out(night() ? K.RAIN_0 : K.RAIN_1), trail = out(K.COOL_2);
    var ww = wr.x1 - wr.x0 + 1, wh = wr.y1 - wr.y0 + 1;
    var tms = t * 1000;
    for (var j = 0; j < count; j++) {
      var phase = rnd(j, 5, 61) * RUN_CYCLE;
      var cyc = Math.floor((tms + phase) / RUN_CYCLE);
      var s = cyc * RUN_CYCLE - phase + rnd(j, cyc, 62) * 2000; // start time in the cycle
      var age = tms - s;
      if (age < 0) continue;
      var speed = 20 + 40 * rnd(j, cyc, 63); // px/s
      var x = wr.x0 + 2 + Math.floor(rnd(j, cyc, 64) * Math.max(1, ww - 4));
      var y0 = wr.y0 + Math.floor(rnd(j, cyc, 65) * wh * 0.5);
      var head = y0 + Math.floor((speed * age) / 1000);
      var gone = head - (speed * TRAIL_MS) / 1000;
      if (gone > wr.y1) continue;
      // walk the path from its start: 1 px wobble, decided every 5 rows
      var off = 0;
      for (var y = y0; y <= Math.min(head, wr.y1); y++) {
        if ((y - y0) % 5 === 4) {
          var r = rnd(j * 977 + cyc, y, 66);
          if (r < 0.25 && off > -1) off--;
          else if (r > 0.75 && off < 1) off++;
        }
        var bx = x + off - f.x0 - ox, by = y - f.y0;
        if (y === head) putGlass(f, bx, by, hi, true);
        else if (y === head - 1) putGlass(f, bx, by, body, false);
        else {
          // trail age at this row: 3 fading steps over 2 s (solid, half, quarter)
          var a = ((head - y) * 1000) / speed;
          if (a < TRAIL_MS / 3) putGlass(f, bx, by, trail, false);
          else if (a < (2 * TRAIL_MS) / 3) {
            if (((bx + f.x0 + by + f.y0) & 1) === 0) putGlass(f, bx, by, trail, false);
          } else if (a < TRAIL_MS) {
            if (((by + f.y0) & 3) === 0) putGlass(f, bx, by, trail, false);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ drips under a wet sill */
  function drips(f, t) {
    // lip pixels: wet (3) with a non-wet pixel below; one drip per 24 px of lip, every 1 to 3 s
    var c = out(K.RAIN_HI), c2 = out(K.RAIN_0);
    var w = f.w;
    var tms = t * 1000;
    for (var y = 0; y < f.h - 1; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (mk[row + x] !== 3 || mk[row + w + x] === 3) continue;
        var wx = x + f.x0;
        if (wx % 24 !== 0) continue;
        var lane = Math.floor(wx / 24);
        var per = 1000 + 2000 * rnd(lane, y + f.y0, 71);
        var ph = rnd(lane, 3, 72) * per;
        var a = (tms + ph) % per; // ms into this drip's cycle
        if (a < 500) {
          f.buf[row + w + x] = c2; // forming under the lip
        } else if (a < 750) {
          var fy = y + 1 + Math.floor(((a - 500) / 250) * 6);
          if (fy < f.h) f.buf[fy * w + x] = c;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ lightning */
  /** Key-light multiplier 0..1.8 for the GPU (u_flash); 0 outside storms and with reduced motion. */
  function flash(now) {
    if (state.kind !== 'storm' || reduced() || debug.lightning === false) return 0;
    var fa = flashAt(SEED, now);
    if (fa.level <= 0) return 0;
    if (!guardAllow(guard, fa.start)) return 0;
    return fa.level * FLASH_GAIN;
  }

  /* ------------------------------------------------------------------ draw */
  var lastMs = 0;

  /** Draw the weather into frame f (INTERFACES 5): after items are blitted, before engine marks. */
  function draw(f) {
    var t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!f || !f.buf || !f.aux) return;
    // clear and dry: nothing to draw, skip the mask scan
    if (state.kind === 'clear' && !(debug.drips !== false && wet())) {
      lastMs = 0;
      return;
    }
    paletteRgb();
    if (!scanMask(f)) return;
    var kind = state.kind;
    outLut = f.lutA ? (f.step >= 16 ? f.lutB : f.lutA) : null;
    var rm = reduced();
    var wr = windowRect(f);
    var oxOut = f.offs ? f.offs[1] || 0 : 0; // outside layer depth offset (phone pan)
    var oxWin = f.offs ? f.offs[2] || 0 : 0; // window layer
    var tq = rm ? 0 : (Math.floor(f.now / STEP_MS) * STEP_MS) / 1000;
    var fl = flash(f.now) / FLASH_GAIN;

    atmosphere(f, kind, fl, wr, oxOut);

    var rainy = isRainy(kind);
    if (rainy) {
      var dens = dropDensity(state.precip) * (kind === 'drizzle' ? 0.5 : 1);
      if (!rm) rainField(f, dens, state.slant, tq, oxOut, kind === 'drizzle' ? 2 : 3);
      var beadDens = Math.min(46, (kind === 'drizzle' ? 14 : 16) + dens * 0.18);
      beads(f, beadDens, rm ? 0 : f.now, oxWin);
      if (!rm && kind !== 'drizzle') {
        var n = kind === 'storm' ? 4 : clamp(1 + Math.floor(state.precip / 2), 1, 4);
        runs(f, n, f.now / 1000, wr, oxWin);
      }
    } else if (kind === 'snow') {
      var sd = 30 + 90 * clamp(state.precip / 4, 0, 1);
      snowField(f, sd, state.slant, rm ? 0 : f.now / 1000, oxOut);
    }
    if (box.wet && debug.drips !== false && !rm && wet()) drips(f, f.now / 1000);
    outLut = null;
    if (t0) lastMs = performance.now() - t0;
  }

  /* ------------------------------------------------------------------ scheduler hooks */
  function animated() {
    return !reduced() && (isRainy(state.kind) || state.kind === 'snow');
  }
  /** True while weather needs display-rate frames: falling rain or snow, and around each flash. */
  function busy(now) {
    if (animated()) return true;
    if (state.kind === 'storm' && !reduced()) {
      var next = flashAt(SEED, now + 150);
      return next.level > 0 || flashAt(SEED, now).level > 0;
    }
    return false;
  }
  function hasAmbient() {
    if (reduced()) return false;
    return state.kind !== 'clear' || wet();
  }
  /** Changes whenever the weather layer would draw something different. */
  function ambientKey(now) {
    var k = state.kind + ':' + state.precip + ':' + state.slant.toFixed(2);
    if (reduced()) return k;
    if (animated()) k += ':' + Math.floor(now / STEP_MS);
    else if (state.kind === 'partly' || state.kind === 'overcast' || state.kind === 'fog') k += ':' + Math.floor(now / 500);
    if (state.kind === 'storm') k += ':' + flash(now);
    return k;
  }
  /** Is the sill wet (raining now, or within 20 minutes after)? */
  function wet() {
    return isWet(state.kind, state.lastRainAt, Date.now());
  }
  /** Wind speed in mph (curtain sway above 15, leaf flutter above 25). */
  function wind() {
    return state.wind;
  }

  ROOM.weather = {
    state: state,
    init: init,
    draw: draw,
    flash: flash,
    busy: busy,
    hasAmbient: hasAmbient,
    ambientKey: ambientKey,
    wet: wet,
    wind: wind,
    setDebug: setDebug,
    fetchNow: fetchNow,
    pure: pure,
    lut: function (name) {
      return lut(name);
    },
    get lastMs() {
      return lastMs;
    },
    stop: function () {
      if (timer) clearInterval(timer);
      timer = 0;
    },
  };
})();
