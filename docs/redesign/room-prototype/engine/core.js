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
  /** The zone an item lives in (its own zone field; the territory under it as a fallback). */
  ROOM.zoneOf = function (item) {
    if (!item) return null;
    return ROOM.zoneById(item.zone) || (ROOM.camera && ROOM.camera.zoneAtX ? ROOM.camera.zoneAtX(item.x, ROOM.zonesInView(item.view)) : null);
  };
  ROOM.itemById = function (id) {
    var items = ROOM.art.items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  };

  /* ------------------------------------------------------------------ views (art pass 6) */
  // One square room seen from its centre: four 90 degree views, front (the knight and the window), right (desks,
  // gym), back (the calendar wall), left (bed, kitchen). Turning right cycles front, right, back, left. Items carry
  // "view" and zones their view; zones.json views.<v> holds each view's frame (art, core, horizon, vp, yaw, f) and
  // its lighting. A bundle without views is all front. The overview (v3.5) is a place, never a fifth view.
  ROOM.VIEWS = ['front', 'right', 'back', 'left'];
  function normView(v) {
    return v || 'front';
  }
  ROOM.normView = normView;
  ROOM.viewOf = function (thing) {
    return normView(thing && thing.view);
  };
  /** The frame and light of a view (falls back to the top-level zones.json frame). */
  ROOM.viewConf = function (v) {
    var Z = ROOM.art.zones || {};
    var V = Z.views || {};
    v = normView(v);
    return V[v] || Z;
  };
  /** The views this bundle has, in turning order. */
  ROOM.viewList = function () {
    var V = (ROOM.art.zones || {}).views || {};
    var out = ROOM.VIEWS.filter(function (v) {
      return !!V[v];
    });
    return out.length ? out : ['front'];
  };
  ROOM.hasViews = function () {
    return ROOM.viewList().length > 1;
  };
  /** Zones that live in a view (default: the current one). */
  ROOM.zonesInView = function (v) {
    v = normView(v || (ROOM.state && ROOM.state.view));
    return ROOM.zones.filter(function (z) {
      return ROOM.viewOf(z) === v;
    });
  };
  /** The view a turn in direction dir (-1 left, +1 right) leads to from view v, or null: the views form a ring. */
  ROOM.viewToward = function (v, dir) {
    var list = ROOM.viewList();
    if (list.length < 2) return null;
    var i = list.indexOf(normView(v));
    if (i < 0) return null;
    return list[(i + (dir > 0 ? 1 : list.length - 1)) % list.length];
  };
  /** Turning direction (+1 right, -1 left) of the shortest turn from view a to view b (0 when equal). */
  ROOM.turnDir = function (a, b) {
    a = normView(a);
    b = normView(b);
    if (a === b) return 0;
    var list = ROOM.viewList(), n = list.length;
    var d = (list.indexOf(b) - list.indexOf(a) + n) % n;
    return d === n - 1 ? -1 : 1; // the opposite wall: always right
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

  /**
   * v3.5: the item whose state drives this one. Overview twins and hero overlays carry "of" (the room item's id);
   * their stage, skill, alert and growth come from that room item. Plain room items are their own state item.
   */
  ROOM.stateItem = function (it) {
    return it && it.of ? ROOM.itemById(it.of) || it : it;
  };
  ROOM.skillOf = function (item) {
    item = ROOM.stateItem(item);
    var slug = item && item.target && item.target.skill;
    if (!slug) return null;
    var skills = ROOM.data.skills || [];
    for (var i = 0; i < skills.length; i++) if (skills[i].slug === slug) return skills[i];
    return null;
  };
  /** The feature an item opens (calendar, overall, relic-left...), read through its state item. */
  ROOM.featureOf = function (item) {
    item = ROOM.stateItem(item);
    return (item && item.target && item.target.feature) || null;
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

  /* ------------------------------------------------------------------ the statue's level (v3.4) */
  // The plaque shows progress from the level to the next; the level only rises when UPGRADE is pressed at 100%,
  // and never drops. The knight's armour follows the level's tier: I..V from 0, 20, 40, 60, 80.
  // Demo flags: ?score=40.6 (overall score) and ?level=40.
  (function () {
    var o = ROOM.data.overall;
    if (!o) return;
    if (query.has('score') && isFinite(+query.get('score'))) o.score = +query.get('score');
    if (query.has('level') && isFinite(+query.get('level'))) o.level = Math.max(0, Math.min(100, Math.floor(+query.get('level'))));
  })();
  ROOM.levelOf = function () {
    var o = ROOM.data.overall || {};
    return o.level != null ? o.level : Math.max(0, Math.min(100, Math.floor(+o.score || 0)));
  };
  ROOM.tierOfLevel = function (level) {
    return Math.max(1, Math.min(5, 1 + Math.floor(level / 20)));
  };

  ROOM.state = {
    zone: null,
    view: 'front', // which of the four views is on screen (see ROOM.turn)
    night: query.has('night') ? query.get('night') === '1' : hour >= 22 || hour < 5,
    season: ROOM.seasonOf(day),
    holiday: ROOM.holidayOf(day),
    roomTier: query.has('tier') ? +query.get('tier') : ROOM.tierOfLevel(ROOM.levelOf()),
    reducedMotion: reduced,
    muted: false,
    inspect: false,
    panel: null,
    todayOpen: false,
    photo: false,
    // Engine extras (not in the frozen contract; safe for the ui to read or set):
    statueLight: false, // the statue's ceiling downlight (on after a statue click, off when leaving the window)
    // 'sleep' at centre.dogSleep, or 'neglect' (head up) next to the most neglected skill's object
    dog: (ROOM.data.skills || []).some(function (s) {
      return s.neglected;
    })
      ? 'neglect'
      : 'sleep',
    ledOverrides: {}, // skill slug -> 'off'|'pending'|'half'|'full'|'blink' (demo drawer)
  };

  // The room tier follows the statue level's tier, unless something (the drawer, ?tier=) set it by hand.
  // When the level's tier changes, it wins again.
  var lastDataTier = ROOM.tierOfLevel(ROOM.levelOf());
  ROOM.on('data', function () {
    var t = ROOM.tierOfLevel(ROOM.levelOf());
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
    item = ROOM.stateItem(item);
    var a = ROOM.alerts();
    if (/doormat/.test(item.id)) return a.doormat;
    if (/backpack/.test(item.id)) return a.backpack;
    return false;
  };

  /** The score that picks an item's stage: its skill's display score, or the overall score for the statue. */
  ROOM.scoreOf = function (item) {
    item = ROOM.stateItem(item);
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
    // v3.5 hero overlays (<id>.hero) float in the skill view only; they never draw in the room.
    if (/\.hero$/.test(item.id)) return null;
    // Twins ("of") keep their own variant images but take every state decision from the room item.
    var own = item;
    item = ROOM.stateItem(item);
    if (own.kind === 'overlay') {
      // Panel-only art (the statue close-up) is never drawn in the room.
      if (/closeup/.test(own.id)) return null;
      // The statue's ceiling downlight is on only after the statue was clicked.
      if (/downlight/.test(item.id)) return st.statueLight && v.base ? 'base' : null;
      if (st.holiday && v[st.holiday]) return st.holiday;
      if (st.season && v[st.season]) return st.season;
      if (v.alert && ROOM.alertOn(item)) return 'alert';
      if (st.night && v.night) return 'night';
      return v.base ? 'base' : null;
    }
    var skill = ROOM.skillOf(item);
    // Relic slots: "active" while a relic is set on that slot, else the empty mount.
    var rs = item.target && item.target.feature && /^relic-(left|window|right)$/.exec(item.target.feature);
    if (rs) {
      var rel = ROOM.data.relics && ROOM.data.relics.slots && ROOM.data.relics.slots[rs[1]];
      if (rel && v.active) return 'active';
      return v.base ? 'base' : v.empty ? 'empty' : null;
    }
    if (v.awake && skill && skill.status === 'active') return 'awake';
    // The dog lies with its head up (alert) when it keeps a neglected object company.
    if (v.alert && /(^|[.\-_])dog\b/.test(item.id)) return st.dog === 'neglect' ? 'alert' : v.base ? 'base' : null;
    if (v.alert && ROOM.alertOn(item)) return 'alert';
    if (st.night && v.night) return 'night';
    var score = ROOM.scoreOf(item);
    if (score != null) {
      if (skill && skill.neglected && v.dust) return 'dust';
      var sk = 's' + ROOM.stageOf(score);
      if (v[sk]) return sk;
    }
    // Growth pieces (water jug, money tree, medal wall): g0..g3 from the data.
    if (v.g0 || v.g1) {
      var g = ROOM.growthOf(item);
      for (var gi = g; gi >= 0; gi--) if (v['g' + gi]) return 'g' + gi;
    }
    for (var t = st.roomTier || 1; t >= 1; t--) if (v['t' + t]) return 't' + t;
    if (v.base) return 'base';
    // Last resort: something rather than a hole (e.g. a hotspot drawn only with stage keys).
    return v.s1 ? 's1' : v.s0 ? 's0' : null;
  };

  /**
   * Growth stage 0..3 for a growth piece: water jug from today's water, money tree from revenue this
   * month, medal wall from races finished. Data fields are optional; the linked skill's score stands in.
   */
  ROOM.growthOf = function (item) {
    item = ROOM.stateItem(item);
    var d = ROOM.data, id = item.id || '', frac = 0;
    function skillFrac(slug) {
      var s = (d.skills || []).filter(function (x) {
        return x.slug === slug;
      })[0];
      return s ? s.display / 100 : 0;
    }
    if (/water|jug/.test(id)) frac = d.water && d.water.goal ? d.water.today / d.water.goal : skillFrac('food');
    else if (/money|tree/.test(id)) frac = d.revenue && d.revenue.goal ? d.revenue.month / d.revenue.goal : skillFrac('dropshipping');
    else if (/medal/.test(id)) frac = d.races ? Math.min(1, (d.races.length || d.races) / 6) : skillFrac('running');
    return Math.max(0, Math.min(3, Math.floor(frac * 4)));
  };

  /* ------------------------------------------------------------------ v3.5 places and heroes */
  /**
   * The hero (skill view) art of a room item: {item, img, hero:{anchor, float, rimSide, authored, led}}.
   * Uses "<id>.hero" with the room item's current variant key (missing key: base); without a hero item, the room
   * sprite of the current variant (authored false, float false). Null for an unknown id or nothing to draw.
   */
  ROOM.heroOf = function (id) {
    var item = ROOM.itemById(id);
    if (!item) return null;
    var key = ROOM.variantOf(item);
    var h = ROOM.itemById(id + '.hero');
    var hv = h && h.variants;
    var img = hv ? hv[key] || hv.base || null : null;
    var meta = (h && img && h.hero) || {};
    if (!img) {
      img = key && item.variants ? item.variants[key] : null;
      if (!img) return null;
      meta = {};
    }
    var w = item.w || 0, hh = item.h || 0;
    return {
      item: item,
      img: img,
      hero: {
        anchor: meta.anchor || [Math.round(item.x + w / 2), item.y + hh],
        float: !!meta.float,
        rimSide: meta.rimSide || null,
        authored: !!meta.authored,
        led: meta.led || null,
      },
    };
  };
  /** Which scene the renderers draw: 'top' in the overview, else the current wall view. */
  ROOM.sceneKey = function () {
    var ov = ROOM.render && ROOM.render.sceneOverride;
    if (ov) return ov; // a snapshot of another scene is being drawn
    var p = ROOM.nav && (ROOM.nav.scenePlace || ROOM.nav.place);
    if (p && p.mode === 'overview') return 'top';
    return normView(ROOM.state && ROOM.state.view);
  };
  /** Where an item lives: {view, zone, feature, calendar} (calendar: the study wall calendar feature). */
  ROOM.placeOfItem = function (id) {
    var it = ROOM.stateItem(ROOM.itemById(id));
    if (!it) return null;
    var feature = ROOM.featureOf(it);
    return { view: normView(it.view), zone: it.zone || null, feature: feature, calendar: feature === 'calendar' };
  };

  /* ------------------------------------------------------------------ clock (debug can freeze it) */
  var frozen = null;
  var frameT = null; // the rAF timestamp of the frame being drawn (render.js tick): one time for the whole frame
  ROOM.now = function () {
    return frozen != null ? frozen : frameT != null ? frameT : performance.now();
  };
  ROOM.clock = {
    /** The time right now, ignoring the frame time: a leg starts when its planning (snapshot builds) is done. */
    real: function () {
      return frozen != null ? frozen : performance.now();
    },
    /** render.js: draw this frame at rAF time ts (null ends the frame). Never runs backwards. */
    frame: function (ts) {
      frameT = ts == null ? null : Math.max(ts, ROOM.clock.last || 0);
      if (frameT != null) ROOM.clock.last = frameT;
    },
    last: 0,
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
