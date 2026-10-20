/* FORGE room prototype: the ROOM global, events, shared state, data and art selection.
 *
 * Loaded right after data.js and art.js (or test-fixture-art.js). Everything else attaches to ROOM.
 * Query flags (for demos and tests): ?state=fresh  ?night=1|0  ?p=0..100 (today %)  ?tier=1..5
 * ?motion=0 (reduced motion)  ?date=YYYY-MM-DD (season and holiday)
 */
(function () {
  'use strict';

  var ROOM = (window.ROOM = window.ROOM || {});
  var query = new URLSearchParams(window.location.search);
  ROOM.query = query;

  /* ------------------------------------------------------------------ events */
  var handlers = {};
  ROOM.on = function (name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    return function off() {
      handlers[name] = (handlers[name] || []).filter(function (h) {
        return h !== fn;
      });
    };
  };
  ROOM.emit = function (name, detail) {
    (handlers[name] || []).slice().forEach(function (fn) {
      try {
        fn(detail || {});
      } catch (err) {
        // One faulty listener must not stop the room from drawing.
        console.error('ROOM listener for "' + name + '" failed', err);
      }
    });
  };

  /* ------------------------------------------------------------------ art */
  ROOM.art = window.ROOM_ART || { palette: { colors: [], categories: {}, luts: {} }, zones: { zones: [] }, items: [], images: {} };
  ROOM.zones = ROOM.art.zones.zones || [];
  ROOM.zoneById = function (id) {
    for (var i = 0; i < ROOM.zones.length; i++) if (ROOM.zones[i].id === id) return ROOM.zones[i];
    return null;
  };
  ROOM.itemById = function (id) {
    var items = ROOM.art.items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  };

  // Colour name -> palette index, and index -> name.
  ROOM.C = {};
  ROOM.colorNames = [];
  (ROOM.art.palette.colors || []).forEach(function (c, i) {
    ROOM.C[c[0]] = i;
    ROOM.colorNames[i] = c[0];
  });
  ROOM.T = 255; // transparent index

  /* ------------------------------------------------------------------ data */
  var stateKey = query.get('state') === 'fresh' ? 'fresh' : 'sample';
  function cloneData(key) {
    var src = (window.ROOM_DATA || {})[key] || {};
    return JSON.parse(JSON.stringify(src));
  }
  ROOM.dataKey = stateKey;
  ROOM.data = cloneData(stateKey);
  if (query.has('p')) ROOM.data.todayP = Math.max(0, Math.min(100, Number(query.get('p')) || 0));

  /** Swap the whole data object for a preset ("sample" or "fresh") and tell everyone. */
  ROOM.loadState = function (key) {
    ROOM.dataKey = key === 'fresh' ? 'fresh' : 'sample';
    ROOM.data = cloneData(ROOM.dataKey);
    ROOM.emit('data', {});
  };

  ROOM.skillOf = function (item) {
    var slug = item && item.target && item.target.skill;
    if (!slug) return null;
    var skills = ROOM.data.skills || [];
    for (var i = 0; i < skills.length; i++) if (skills[i].slug === slug) return skills[i];
    return null;
  };
  ROOM.itemsForSkill = function (slug) {
    return ROOM.art.items.filter(function (it) {
      return it.target && it.target.skill === slug;
    });
  };

  /* ------------------------------------------------------------------ calendar: season and holiday */
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday, UTC.
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, month - 1, day);
  }
  var DAY = 86400000;
  ROOM.seasonOf = function (date) {
    var mo = date.getUTCMonth();
    return mo <= 1 || mo === 11 ? 'winter' : mo <= 4 ? 'spring' : mo <= 7 ? 'summer' : 'fall';
  };
  /** New Orleans holidays: Carnival (Twelfth Night to Mardi Gras), Jazz Fest, Halloween run-up, December. */
  ROOM.holidayOf = function (date) {
    var t = date.getTime(), y = date.getUTCFullYear(), mo = date.getUTCMonth(), d = date.getUTCDate();
    var mardiGras = easter(y) - 47 * DAY;
    if (t >= Date.UTC(y, 0, 6) && t <= mardiGras) return 'mardi-gras';
    if ((mo === 3 && d >= 23) || (mo === 4 && d <= 5)) return 'jazz-fest';
    if (mo === 9 && d >= 15) return 'halloween';
    if (mo === 11) return 'december';
    return null;
  };

  /* ------------------------------------------------------------------ state */
  var now = new Date();
  var hour = now.getHours();
  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    /* old browsers: motion on */
  }
  if (query.get('motion') === '0') reduced = true;
  var day = parseDay(query.get('date') || ROOM.data.today) || new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  ROOM.state = {
    zone: null,
    night: query.has('night') ? query.get('night') === '1' : hour >= 22 || hour < 5,
    season: ROOM.seasonOf(day),
    holiday: ROOM.holidayOf(day),
    roomTier: query.has('tier') ? +query.get('tier') : (ROOM.data.overall && ROOM.data.overall.tier) || 1,
    reducedMotion: reduced,
    muted: false,
    inspect: false,
    panel: null,
    todayOpen: false,
    photo: false,
    // Engine extras (not in the frozen contract; safe for the ui to read or set):
    dog: 'sleep', // 'sleep' at centre.dogSleep, or 'neglect' next to the most neglected skill's object
    ledOverrides: {}, // skill slug -> 'off'|'pending'|'half'|'full'|'blink' (demo drawer)
  };

  // The room tier follows data.overall.tier, unless something (the drawer, ?tier=) set it by hand.
  // When the data's own tier changes, it wins again.
  var lastDataTier = ROOM.data.overall && ROOM.data.overall.tier;
  ROOM.on('data', function () {
    var t = ROOM.data.overall && ROOM.data.overall.tier;
    if (t !== lastDataTier) {
      lastDataTier = t;
      if (t) ROOM.state.roomTier = t;
    }
  });

  /** Merge a patch into ROOM.state and broadcast it. */
  ROOM.setState = function (patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) ROOM.state[k] = patch[k];
    ROOM.emit('state', {});
  };

  /* ------------------------------------------------------------------ derived data */
  /** Display score 0..100 to object stage 0, 1 or 2. */
  ROOM.stageOf = function (display) {
    return display >= 67 ? 2 : display >= 34 ? 1 : 0;
  };
  /** Today's sky band from the completion percentage. */
  ROOM.rampOf = function (p) {
    return p >= 85 ? 'R4' : p >= 60 ? 'R3' : p >= 25 ? 'R2' : 'R1';
  };
  /** Which alerts are on: backpack (something due within 48 h), doormat (a review is waiting). */
  ROOM.alerts = function () {
    var d = ROOM.data;
    return {
      backpack: (d.dueSoon || []).some(function (x) {
        return x.hours != null && x.hours < 48;
      }),
      doormat: !!(d.review && (d.review.weekly || d.review.monthly)),
    };
  };

  /** Is this item's alert on? Backpack: due within 48 h. Doormat: a review is waiting. */
  ROOM.alertOn = function (item) {
    var a = ROOM.alerts();
    if (/doormat/.test(item.id)) return a.doormat;
    if (/backpack/.test(item.id)) return a.backpack;
    return false;
  };

  /** The score that picks an item's stage: its skill's display score, or the overall score for the statue. */
  ROOM.scoreOf = function (item) {
    var sk = ROOM.skillOf(item);
    if (sk) return sk.display;
    if (item.target && item.target.feature === 'overall' && ROOM.data.overall) return ROOM.data.overall.display;
    return null;
  };

  /**
   * Choose the variant key to draw for an item right now, or null to draw nothing.
   * Overlays appear only when one of their keys is active (holiday, season, alert, night); a base-only
   * overlay is always on. Other items: awake (an active skill), alert, night, dust/stage, room tier
   * (highest tN <= tier), then base.
   */
  ROOM.variantOf = function (item) {
    var v = item.variants || {};
    var st = ROOM.state;
    if (item.kind === 'overlay') {
      // Panel-only art (the statue close-up) is never drawn in the room.
      if (/closeup/.test(item.id)) return null;
      if (st.holiday && v[st.holiday]) return st.holiday;
      if (st.season && v[st.season]) return st.season;
      if (v.alert && ROOM.alertOn(item)) return 'alert';
      if (st.night && v.night) return 'night';
      return v.base ? 'base' : null;
    }
    var skill = ROOM.skillOf(item);
    if (v.awake && skill && skill.status === 'active') return 'awake';
    if (v.alert && ROOM.alertOn(item)) return 'alert';
    if (st.night && v.night) return 'night';
    var score = ROOM.scoreOf(item);
    if (score != null) {
      if (skill && skill.neglected && v.dust) return 'dust';
      var sk = 's' + ROOM.stageOf(score);
      if (v[sk]) return sk;
    }
    for (var t = st.roomTier || 1; t >= 1; t--) if (v['t' + t]) return 't' + t;
    if (v.base) return 'base';
    // Last resort: something rather than a hole (e.g. a hotspot drawn only with stage keys).
    return v.s1 ? 's1' : v.s0 ? 's0' : null;
  };

  /* ------------------------------------------------------------------ clock (debug can freeze it) */
  var frozen = null;
  ROOM.now = function () {
    return frozen != null ? frozen : performance.now();
  };
  ROOM.clock = {
    freeze: function () {
      frozen = performance.now();
    },
    advance: function (ms) {
      if (frozen == null) frozen = performance.now();
      frozen += ms;
    },
    thaw: function () {
      frozen = null;
    },
    get frozen() {
      return frozen != null;
    },
  };

  // Placeholders the engine files replace; they keep early callers (ui scripts) from crashing.
  ROOM.ui = ROOM.ui || {};
  ROOM.sound = ROOM.sound || {};
  ROOM.invalidate = function () {};
})();
