/* FORGE room prototype: effects the engine draws on top of the art.
 *
 * - LEDs (3x3 at item.led, after the LUT, true colour) from today's goals for the item's skill:
 *   no goal = off (dark socket), result null = pending (hollow ring), floor = half, standard or
 *   stretch = done (solid light shade with a CREAM centre and a 1 px dark keyline, about twice as bright
 *   as pending), goal.nmt and not done = slow blink (the only blinking state). Today's top-priority
 *   object (never-miss-twice, then Focus Rack pins, then the lowest score with a goal still open) gets
 *   the one slow pulse.
 * - Screens drawn after the LUT: the Today CRT (dim amber, blinking cursor until the first log, then
 *   today's bar), the stats CRT (alternates the overall score "72 OVR" and the streak with a flame),
 *   the statue plaque (5 tier pips and the in-tier bar).
 * - Dust on neglected skills: the object one step darker plus BROWN_2/ROSE_0 speckles on its top edge.
 * - Light motes for the logging loop (row -> LED -> statue), queued, never blocking input.
 * - The statue's gold pulse: palette cycling GOLD_DK > GOLD > SUN on its GOLD pixels.
 * - Dog placement: asleep at centre.dogSleep, or beside the most neglected skill's object when
 *   ROOM.state.dog === 'neglect' (the demo drawer can set it).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var C = ROOM.C;

  /* ------------------------------------------------------------------ one step darker (dust) */
  var DARKER_NAMES = {
    INK: 'VOID', INK_COOL: 'INK', BROWN_0: 'INK', BROWN_1: 'BROWN_0', BROWN_2: 'BROWN_1',
    TERRA_0: 'BROWN_0', TERRA_1: 'TERRA_0', TERRA_2: 'TERRA_1', RIM: 'TERRA_2', ORANGE: 'RIM', GLOW: 'ORANGE',
    AMBER: 'TERRA_1', SUN: 'GLOW', GOLD: 'GOLD_DK', GOLD_DK: 'BROWN_2', ROSE_0: 'BROWN_2', ROSE_1: 'ROSE_0',
    LEAF_0: 'INK_COOL', LEAF_1: 'LEAF_0', LEAF_2: 'LEAF_1', LEAF_3: 'LEAF_2', SLATE_0: 'INK_COOL',
    SLATE_1: 'SLATE_0', SLATE_2: 'SLATE_1', PLUM_0: 'BROWN_0', PLUM_1: 'PLUM_0', PLUM_2: 'PLUM_1',
    PLUM_3: 'PLUM_2', CRT_0: 'TERRA_0', CRT_1: 'CRT_0', CREAM: 'ROSE_1',
    // R3 palette additions (plaster and obsidian)
    CHAR: 'INK', WALL_G: 'CHAR', STAT_1: 'INK', STAT_2: 'STAT_1', STAT_HI: 'STAT_2',
    // R4 palette swaps (plum plaster, night navy, knight energy, plasma violet)
    PLASTER_0: 'INK', PLASTER: 'PLASTER_0', NAVY: 'INK', ENERGY: 'SLATE_1', ENERGY_HI: 'ENERGY', VIOLET: 'PLUM_1',
  };
  var DARKER = new Uint8Array(256);
  for (var i = 0; i < 256; i++) DARKER[i] = i;
  Object.keys(DARKER_NAMES).forEach(function (k) {
    if (C[k] != null && C[DARKER_NAMES[k]] != null) DARKER[C[k]] = C[DARKER_NAMES[k]];
  });

  function ramp(cat) {
    var r = (cat && ROOM.art.palette.categories[cat]) || ROOM.art.palette.categories.gold;
    return [C[r[0]], C[r[1]], C[r[2]]];
  }

  /* ------------------------------------------------------------------ LEDs */
  /** LED state for a skill from today's goals (or a drawer override). */
  function ledForSkill(slug) {
    var o = ROOM.state.ledOverrides && ROOM.state.ledOverrides[slug];
    if (o) return o;
    var goals = (ROOM.data.goals || []).filter(function (g) {
      return g.skill === slug;
    });
    if (!goals.length) return 'off';
    var r = function (want) {
      return goals.some(function (g) {
        return want.indexOf(g.result) >= 0;
      });
    };
    if (r(['standard', 'stretch'])) return 'full';
    if (r(['floor'])) return 'half';
    if (goals.some(function (g) {
      return g.nmt && !g.result;
    })) return 'blink';
    return 'pending';
  }

  /** LED state for a drawable: its skill; the statue shows today's band; alert items blink when on. */
  function ledStateOf(d) {
    if (d.skill) return ledForSkill(d.skill.slug);
    var o = ROOM.state.ledOverrides && ROOM.state.ledOverrides[d.id];
    if (o) return o;
    var it = d.item;
    if (it.target && it.target.feature === 'overall') {
      var p = ROOM.data.todayP || 0;
      return p >= 85 ? 'full' : p >= 25 ? 'half' : 'pending';
    }
    if (it.variants && it.variants.alert) return ROOM.alertOn(it) ? 'blink' : 'off';
    return 'off';
  }

  var BLINK_MS = 800; // slow blink: 1.6 s period
  var flash = null; // {id, until}: the LED a mote just reached

  // 3x3 masks, row-major: 0 none, 1 dark, 2 mid, 3 light, 4 VOID, 5 INK, 6 SUN, 7 CREAM.
  var MASKS = {
    off: [5, 5, 5, 5, 4, 5, 5, 5, 5],
    pending: [2, 2, 2, 2, 4, 2, 2, 2, 2],
    pulse: [3, 3, 3, 3, 2, 3, 3, 3, 3],
    half: [1, 1, 1, 1, 3, 1, 3, 3, 3],
    full: [3, 3, 3, 3, 7, 3, 3, 3, 3],
    flash: [3, 6, 3, 6, 7, 6, 3, 6, 3],
  };
  var PULSE_MS = 700;

  /* ------------------------------------------------------------------ today's priority */
  /**
   * Priority rank of an open goal (lower first): never-miss-twice, then Focus Rack pins, then the
   * lowest display score. The Today list sorts by the same key.
   */
  // Scores are snapshotted once per day so logging a goal (which moves its score) never reorders the list.
  var rankDay = null, rankScore = {};
  function rankGoal(g) {
    var sk = skillBySlug(g.skill);
    if (rankDay !== ROOM.data.today) {
      rankDay = ROOM.data.today;
      rankScore = {};
    }
    if (sk && rankScore[sk.slug] == null) rankScore[sk.slug] = sk.display;
    return [g.nmt ? 0 : 1, sk && sk.pinned ? 0 : 1, sk ? rankScore[sk.slug] : 999];
  }
  function cmpRank(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  function skillBySlug(slug) {
    var list = ROOM.data.skills || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }
  /** The skill slug of today's top-priority open goal, or null when everything is logged. */
  function topSkill() {
    var open = (ROOM.data.goals || []).filter(function (g) {
      return g.skill && !g.result;
    });
    if (!open.length) return null;
    open.sort(function (a, b) {
      return cmpRank(rankGoal(a), rankGoal(b));
    });
    return open[0].skill;
  }

  /** Draw a drawable's LED with its top-left at buffer coordinates (x, y). */
  function drawLed(f, d, x, y) {
    var state = ledStateOf(d);
    if (flash && flash.id === d.id && f.now < flash.until) state = 'flash';
    else if (state === 'blink') state = Math.floor(f.now / BLINK_MS) % 2 ? 'pending' : 'full';
    else if (state === 'pending' && d.skill && d.skill.slug === topSkill() && !ROOM.state.reducedMotion)
      state = Math.floor(f.now / PULSE_MS) % 2 ? 'pending' : 'pulse';
    var m = MASKS[state] || MASKS.off;
    var rp = ramp(d.cat);
    var col = [0, rp[0], rp[1], rp[2], C.VOID, C.INK, C.SUN, C.CREAM];
    if (state === 'full' || state === 'flash') {
      // 1 px dark keyline around a done LED
      for (var k2 = -1; k2 <= 3; k2++) {
        ROOM.render.plot(f, x + k2, y - 1, C.VOID);
        ROOM.render.plot(f, x + k2, y + 3, C.VOID);
        ROOM.render.plot(f, x - 1, y + k2, C.VOID);
        ROOM.render.plot(f, x + 3, y + k2, C.VOID);
      }
    }
    for (var k = 0; k < 9; k++) if (m[k]) ROOM.render.plot(f, x + (k % 3), y + ((k / 3) | 0), col[m[k]]);
  }

  /* ------------------------------------------------------------------ screens and the plaque */
  // 3x5 digits (rows of 3 bits) drawn 2x tall on the stats LCD.
  var DIG = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    O: '111101101101111', V: '101101101101010', R: '110101110101101', D: '110101101101110',
  };
  var FLAME = ['..o..', '.oo..', '.oyo.', 'oyyo.', 'oyyyo', 'oysyo', '.ooo.'];
  function glyph(f, x, y, ch, c, tall) {
    var g = DIG[ch];
    if (!g) return;
    for (var i = 0; i < 15; i++) {
      if (g[i] !== '1') continue;
      var gx = x + (i % 3), gy = y + ((i / 3) | 0) * (tall ? 2 : 1);
      ROOM.render.plot(f, gx, gy, c);
      if (tall) ROOM.render.plot(f, gx, gy + 1, c);
    }
  }
  function loggedToday() {
    return (ROOM.data.goals || []).some(function (g) {
      return !!g.result;
    });
  }
  var SCREEN_MS = 2600; // stats LCD alternation
  var CURSOR_MS = 530;

  /** Screens (Today CRT, stats LCD) and the statue plaque, drawn right after the item's sprite. */
  function drawScreen(f, d, dx, dy) {
    var it = d.item, R = ROOM.render;
    var ox = dx - it.x, oy = dy - it.y; // world -> buffer for this drawable
    if (it.screen && it.target && it.target.feature === 'today') {
      var s = it.screen, x = s[0] + ox, y = s[1] + oy;
      if (!loggedToday()) {
        if (ROOM.state.reducedMotion || Math.floor(f.now / CURSOR_MS) % 2 === 0)
          for (var cy = 0; cy < 4; cy++) for (var cx = 0; cx < 2; cx++) R.plot(f, x + 20 + cx, y + 2 + cy, C.GLOW);
      } else {
        var bw = s[2] - 6, p = Math.max(0, Math.min(100, ROOM.data.todayP || 0));
        var fill = Math.round((bw * p) / 100);
        for (var bx = 0; bx < bw; bx++)
          for (var by = 0; by < 2; by++) R.plot(f, x + 3 + bx, y + s[3] - 4 + by, bx < fill ? C.GLOW : C.OAK_DK);
      }
    }
    if (it.screen && it.target && it.target.feature === 'stats') {
      var t = it.screen, sx = t[0] + ox, sy = t[1] + oy;
      var phase = ROOM.state.reducedMotion ? 0 : Math.floor(f.now / SCREEN_MS) % 2;
      var ov = ROOM.data.overall ? String(ROOM.data.overall.display) : '--';
      var streak = ROOM.data.streak ? ROOM.data.streak.current || 0 : 0;
      if (phase === 0) {
        var gx = sx + 1;
        ov.split('').forEach(function (ch) {
          glyph(f, gx, sy + 2, ch, C.GLOW, true);
          gx += 4;
        });
        if (ov.length <= 2)
          ['O', 'V', 'R'].forEach(function (ch, i) {
            glyph(f, sx + 9 + i * 4, sy + 8, ch, C.GOLD, false);
          });
      } else {
        for (var r = 0; r < FLAME.length; r++)
          for (var q = 0; q < 5; q++) {
            var ch2 = FLAME[r][q];
            if (ch2 !== '.') R.plot(f, sx + 1 + q, sy + 3 + r, ch2 === 'o' ? C.ORANGE : ch2 === 'y' ? C.GLOW : C.SUN);
          }
        var str = String(Math.min(999, streak));
        var gx2 = sx + 8;
        str.split('').forEach(function (ch) {
          glyph(f, gx2, sy + 2, ch, C.GLOW, true);
          gx2 += 4;
        });
        if (str.length < 3) glyph(f, gx2, sy + 7, 'D', C.GOLD, false);
      }
    }
    if (it.plaque && d.statue && ROOM.data.overall) {
      var pl = it.plaque, px0 = pl[0] + ox, py0 = pl[1] + oy;
      var tier = Math.max(1, Math.min(5, ROOM.data.overall.tier || 1));
      var disp = ROOM.data.overall.display || 0;
      var into = tier >= 5 ? Math.min(1, (disp - 80) / 20) : Math.max(0, Math.min(1, (disp - (tier - 1) * 20) / 20));
      for (var i = 0; i < 5; i++)
        for (var a = 0; a < 3; a++)
          for (var b = 0; b < 2; b++) R.plot(f, px0 + 4 + i * 4 + a, py0 + 8 + b, i < tier ? C.GOLD : C.INK);
      var bx0 = px0 + 25, bw2 = pl[2] - 29, bf = Math.round(bw2 * into);
      for (var e = 0; e < bw2; e++)
        for (var g2 = 0; g2 < 2; g2++) R.plot(f, bx0 + e, py0 + 8 + g2, e < bf ? C.GOLD : C.INK);
    }
  }

  /* ------------------------------------------------------------------ dust */
  /** Speckles on the top edge of a neglected object (lit by the current LUT, like the art). */
  function drawDust(f, img, dx, dy) {
    var top = ROOM.decode.top(img);
    var a = f.lutA[C.BROWN_2], b = f.lutA[C.ROSE_0];
    for (var k = 0; k < top.length; k += 2) {
      var x = top[k], y = top[k + 1];
      var h = ((x * 2654435761) ^ (y * 40503) ^ (img.w * 97)) >>> 0;
      var r = (h >>> 7) % 8;
      if (r < 3) ROOM.render.plot(f, dx + x, dy + y, a);
      else if (r === 3) ROOM.render.plot(f, dx + x, dy + y, b);
      if (r === 0 && ROOM.decode.opaque(img, x, y + 1)) ROOM.render.plot(f, dx + x, dy + y + 1, b);
    }
  }

  /* ------------------------------------------------------------------ dog */
  function mostNeglectedItem() {
    var skills = (ROOM.data.skills || []).filter(function (s) {
      return s.neglected;
    });
    skills.sort(function (a, b) {
      return a.display - b.display;
    });
    for (var i = 0; i < skills.length; i++) {
      var items = ROOM.itemsForSkill(skills[i].slug);
      if (items.length) return items[0];
    }
    return null;
  }

  /** Move the dog drawable (d.x, d.y) before the scene is sorted. */
  function placeDog(d) {
    var img = d.img;
    if (ROOM.state.dog === 'neglect') {
      var it = mostNeglectedItem();
      var key = it && ROOM.variantOf(it);
      var tImg = key && ROOM.decode.get(it.variants[key]);
      if (tImg) {
        var b = tImg.bounds || [0, 0, tImg.w, tImg.h];
        var left = it.x + b[0], right = left + b[2], contact = Math.max(it.y + b[1] + b[3], 212);
        // Lie on the floor beside it, on whichever side keeps the dog inside x 12..628.
        d.x = right + 2 + img.w <= 628 ? right + 2 : Math.max(12, left - 2 - img.w);
        d.y = contact - img.h;
        return;
      }
    }
    var ds = ROOM.art.zones.centre && ROOM.art.zones.centre.dogSleep;
    if (ds) {
      d.x = Math.round(ds[0] - img.w / 2);
      d.y = ds[1] - img.h;
    }
  }

  /* ------------------------------------------------------------------ statue pulse */
  var pulse = null; // {t0, dur}
  var CYCLE = ['GOLD_DK', 'GOLD', 'SUN'];

  /** Palette index the statue's GOLD pixels take now, or -1 when not pulsing. */
  function statueColor(now) {
    if (!pulse) return -1;
    var t = now - pulse.t0;
    if (t < 0 || t >= pulse.dur) return -1;
    return C[CYCLE[Math.floor(t / 100) % 3]];
  }

  ROOM.pulseStatue = function (gain) {
    var g = Math.max(0.5, Math.min(3, gain == null ? 1 : gain));
    pulse = { t0: ROOM.now(), dur: Math.round(600 * g) };
    ROOM.invalidate();
  };

  /* ------------------------------------------------------------------ motes */
  var queue = [];
  var active = null;

  function findDrawable(id) {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function statuePoint() {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.statue) return { x: d.hit[0] + d.hit[2] / 2, y: d.hit[1] + d.hit[3] * 0.3 };
    }
    return { x: 276, y: 175 };
  }

  /**
   * A light mote from a CSS point (viewport coordinates) to an item's LED (520 ms, the LED flashes),
   * then to the statue (400 ms), then the statue pulses. Resolves when done. Motes queue.
   */
  ROOM.mote = function (fromCssPoint, itemId) {
    return new Promise(function (resolve) {
      queue.push({ from: fromCssPoint || { x: 0, y: 0 }, id: itemId, resolve: resolve });
      pump();
    });
  };

  function pump() {
    if (active || !queue.length) return;
    var m = queue.shift();
    var R = ROOM.render;
    var now = ROOM.now();
    if (!R.view || ROOM.state.reducedMotion) {
      // Reduced motion: no mote and no gold pulse; the LED simply changes state.
      ROOM.invalidate();
      m.resolve();
      pump();
      return;
    }
    var rect = R.canvas.getBoundingClientRect();
    var p0 = R.worldFromCss(m.from.x - rect.left, m.from.y - rect.top);
    var s = statuePoint();
    var d = findDrawable(m.id);
    var box = d && ROOM.itemRectCss(m.id);
    var legs = [];
    if (d && box) {
      var o = R.offsets[d.layer] || 0;
      var led = d.led ? { x: d.led[0] + 1 + o, y: d.led[1] + 1 } : { x: d.hit[0] + d.hit[2] / 2 + o, y: d.hit[1] + d.hit[3] / 2 };
      legs.push({ a: p0, b: led, dur: 520, lift: 24, flashId: d.id });
      legs.push({ a: led, b: s, dur: 400, lift: 14 });
    } else {
      // The object is off view (or under the HUD): go straight from the row to the statue.
      legs.push({ a: p0, b: s, dur: 520, lift: 24 });
    }
    active = { legs: legs, i: 0, t0: now, m: m, trail: [] };
    ROOM.invalidate();
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  // Point on the arc of a leg at progress t (quadratic Bezier lifted above the midpoint).
  function legPoint(leg, t) {
    var cx = (leg.a.x + leg.b.x) / 2, cy = Math.min(leg.a.y, leg.b.y) - leg.lift;
    var u = 1 - t;
    return { x: u * u * leg.a.x + 2 * u * t * cx + t * t * leg.b.x, y: u * u * leg.a.y + 2 * u * t * cy + t * t * leg.b.y };
  }

  function stepMotes(now) {
    if (!active) return;
    var leg = active.legs[active.i];
    var t = (now - active.t0) / leg.dur;
    if (t >= 1) {
      if (leg.flashId) flash = { id: leg.flashId, until: now + 160 };
      active.t0 += leg.dur;
      active.i++;
      active.trail = [];
      if (active.i >= active.legs.length) {
        ROOM.pulseStatue(1);
        var done = active.m;
        active = null;
        done.resolve();
        pump();
      }
    }
  }

  function drawMotes(f) {
    if (!active) return;
    var leg = active.legs[active.i];
    var t = Math.max(0, Math.min(1, (f.now - active.t0) / leg.dur));
    var trail = [C.GLOW, C.ORANGE, C.RIM];
    for (var k = 3; k >= 1; k--) {
      var pt = legPoint(leg, ease(Math.max(0, t - k * 0.05)));
      ROOM.render.plot(f, pt.x - f.x0, pt.y - f.y0, trail[k - 1]);
    }
    var p = legPoint(leg, ease(t));
    var x = Math.round(p.x - f.x0), y = Math.round(p.y - f.y0);
    ROOM.render.plot(f, x, y, C.SUN);
    ROOM.render.plot(f, x + 1, y, C.SUN);
    ROOM.render.plot(f, x, y + 1, C.SUN);
    ROOM.render.plot(f, x + 1, y + 1, C.CREAM);
  }

  /* ------------------------------------------------------------------ scheduler hooks */
  /** True while something here needs display-rate frames (motes, the pulse, an LED flash). */
  function busy(now) {
    stepMotes(now);
    if (active) return true;
    if (pulse && now - pulse.t0 < pulse.dur + 100) return true;
    if (flash && now < flash.until + 50) return true;
    return false;
  }

  function hasBlink() {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) if (list[i].hotspot && list[i].led && ledStateOf(list[i]) === 'blink') return true;
    return false;
  }
  function hasAmbient() {
    if (ROOM.state.reducedMotion) return hasBlink();
    return true; // the Today cursor or the stats LCD alternation, the priority pulse
  }
  function ambientKey(now) {
    if (ROOM.state.reducedMotion) return hasBlink() ? String(Math.floor(now / BLINK_MS) % 2) : '';
    return [Math.floor(now / BLINK_MS) % 2, Math.floor(now / PULSE_MS) % 2, Math.floor(now / CURSOR_MS) % 2, Math.floor(now / SCREEN_MS) % 2].join('');
  }

  ROOM.fx = {
    DARKER: DARKER,
    ledForSkill: ledForSkill,
    ledStateOf: ledStateOf,
    drawLed: drawLed,
    drawScreen: drawScreen,
    topSkill: topSkill,
    rankGoal: rankGoal,
    cmpRank: cmpRank,
    drawDust: drawDust,
    placeDog: placeDog,
    statueColor: statueColor,
    drawMotes: drawMotes,
    busy: busy,
    hasAmbient: hasAmbient,
    ambientKey: ambientKey,
    get moteQueue() {
      return queue.length + (active ? 1 : 0);
    },
  };
})();
