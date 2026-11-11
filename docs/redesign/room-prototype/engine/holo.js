/* FORGE room: the skill hologram (ROOM.holo; docs/redesign/room-r6/SKILL_TREE_HOLO.md, review round 3).
 *
 * A single click (or Enter) on a skill object opens its hologram: the navigator makes a skill place with holo: true,
 * skill.js lifts the object to the centre column (lit, the room dims) and calls ROOM.holo.show(id) where the skill
 * view would open its board. This file draws three small DOM/SVG holo nodes around the object, tethered to it:
 *   graph   the skill's key numbers with a key and a DAY / WEEK toggle (logged minutes or tiers from log28,
 *           skills[].series; strength: Lyfta sessions, minutes and volume when ROOM_LYFTA is present)
 *   visual  one skill-specific node (muscle map + weekly lift ring, 28-day heatmap, ring gauge, steps ladder,
 *           due list); honest: without data it says so
 *   today   the checks that set today's goal for the skill (floor / standard / stretch), logged through
 *           ROOM.uiToday.setResult, so the room's 'log' event (and the app's save) runs as for the Today HUD
 * The computer holds ai-building and dropshipping: one centre, each skill's nodes on its own side.
 * Pull-up (about 1.2 s, stepped): LIFT (skill.js) -> energising pulse -> frames unfold -> panels fly out -> tethers ->
 * content. Reduced motion: the final state at once. ROOM.holo.busy() keeps ROOM.nav.busy truthful meanwhile.
 * Pure data shaping (weekOf, heatOf, muscleLevels, actionsOf, lyftaWeek...) is exported through module.exports.
 */
(function () {
  'use strict';

  var TIERS = ['floor', 'standard', 'stretch'];
  var TIER_NAME = { floor: 'Floor', standard: 'Standard', stretch: 'Stretch' };
  var DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  // review round 3, decision 6: academics reads as mind (the data's category is still school)
  var CAT_OVERRIDE = { academics: 'mind' };
  var PLANNED_LIFTS = 4; // assumption: Lyfta has no schedule
  var MUSCLES = ['chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'upperBack', 'lowerBack', 'glutes', 'quads', 'hamstrings', 'calves'];

  /* ------------------------------------------------------------------ pure data shaping */
  function rankOf(t) {
    return t ? TIERS.indexOf(t) + 1 : 0;
  }
  function isoAdd(iso, days) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  /** Monday-based index (0 = Monday) of an ISO day. */
  function dowOf(iso) {
    return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
  }
  function goalToday(data, slug) {
    var gs = (data && data.goals) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].skill === slug) return gs[i];
    return null;
  }
  /**
   * The skill's last 28 days as tier ranks (0 none, 1 floor, 2 standard, 3 stretch), oldest first, today last.
   * From skills[].log28 (27 days before today + today) with today taken from today's goal when it is on the plan.
   * null when the data has no history for the skill.
   */
  function log28Of(skill, data) {
    if (!skill || !Array.isArray(skill.log28)) return null;
    var a = skill.log28.slice(-28).map(function (v) {
      return Math.max(0, Math.min(3, v | 0));
    });
    while (a.length < 28) a.unshift(0);
    var g = goalToday(data, skill.slug);
    if (g) a[27] = rankOf(g.result);
    return a;
  }
  function minutesFor(skill, rank) {
    var g = skill && skill.goals && skill.goals[0];
    if (!g || !g.minutes || !rank) return 0;
    return g.minutes[TIERS[rank - 1]] || 0;
  }
  /** This week (Monday first) and last week from log28: [{dow, date, rank, min, future, today}]. */
  function weekOf(skill, data) {
    var log = log28Of(skill, data);
    var today = (data && data.today) || new Date().toISOString().slice(0, 10);
    var di = dowOf(today);
    function wk(offset) {
      var out = [];
      for (var i = 0; i < 7; i++) {
        var back = di - i + offset * 7; // days before today
        var date = isoAdd(today, -back);
        var idx = 27 - back;
        var rank = log && idx >= 0 && idx <= 27 && back >= 0 ? log[idx] : 0;
        out.push({ dow: DOW[i], date: date, rank: rank, min: minutesFor(skill, rank), future: back < 0, today: back === 0 });
      }
      return out;
    }
    var cur = wk(0), prev = wk(1);
    var sum = function (w, k) {
      return w.reduce(function (s, d) {
        return s + (k === 'days' ? (d.rank ? 1 : 0) : d.min);
      }, 0);
    };
    return {
      has: !!log,
      week: cur,
      prev: prev,
      min: sum(cur, 'min'),
      prevMin: sum(prev, 'min'),
      days: sum(cur, 'days'),
      prevDays: sum(prev, 'days'),
      elapsed: di + 1,
      timed: !!(skill && skill.goals && skill.goals[0] && skill.goals[0].minutes && skill.goals[0].minutes.standard > 0),
    };
  }
  /** 28-day heatmap cells (oldest first) and the days logged. */
  function heatOf(skill, data) {
    var log = log28Of(skill, data);
    if (!log) return null;
    return {
      cells: log,
      days: log.filter(function (v) {
        return v > 0;
      }).length,
      streak: skill.streak != null ? skill.streak : null,
    };
  }
  /** Volume per muscle -> 0..4 (0: none; 1..4 quarters of this window's top muscle). */
  function muscleLevels(volume) {
    var max = 0;
    MUSCLES.forEach(function (k) {
      max = Math.max(max, (volume && volume[k]) || 0);
    });
    var out = {};
    MUSCLES.forEach(function (k) {
      var v = (volume && volume[k]) || 0;
      out[k] = v > 0 && max > 0 ? Math.max(1, Math.ceil((4 * v) / max)) : 0;
    });
    return { levels: out, max: max };
  }
  /** Today's checks for a skill: its goal's tiers; checked up to the logged tier. */
  function actionsOf(skill, data) {
    var g = goalToday(data, skill && skill.slug);
    var def = skill && skill.goals && skill.goals[0];
    if (!g || !def) return { goal: g, rows: [] };
    var r = rankOf(g.result);
    return {
      goal: g,
      rows: TIERS.map(function (t, i) {
        var min = def.minutes ? def.minutes[t] : 0;
        return { tier: t, label: TIER_NAME[t], text: def[t] || '', min: min || 0, checked: r >= i + 1, planned: g.tier === t };
      }),
    };
  }
  /** The tier a click on a row sets: an open row logs its tier; a checked row steps one tier down (or clears). */
  function tierAfterClick(rows, tier) {
    var i = TIERS.indexOf(tier);
    var row = rows[i];
    if (!row) return null;
    if (!row.checked) return tier;
    return i > 0 ? TIERS[i - 1] : null;
  }
  /** Lyfta summary (ROOM_LYFTA, scripts/room-lyfta-snapshot.mjs or src/lib/data/room.ts) -> graph and ring numbers. */
  function lyftaWeek(L) {
    if (!L || !Array.isArray(L.week)) return null;
    var sum = function (w, k) {
      return (w || []).reduce(function (s, d) {
        return s + (d[k] || 0);
      }, 0);
    };
    var sched = L.schedule || {};
    return {
      week: L.week,
      prev: L.prevWeek || [],
      sessions: sum(L.week, 'workouts'),
      prevSessions: sum(L.prevWeek, 'workouts'),
      min: sum(L.week, 'minutes'),
      volume: sum(L.week, 'volume'),
      prevVolume: sum(L.prevWeek, 'volume'),
      done: sched.doneThisWeek != null ? sched.doneThisWeek : sum(L.week, 'workouts'),
      planned: sched.plannedPerWeek || PLANNED_LIFTS,
      today: L.today || null,
      asOf: L.asOf || null,
    };
  }

  var PURE = {
    log28Of: log28Of, weekOf: weekOf, heatOf: heatOf, muscleLevels: muscleLevels, actionsOf: actionsOf,
    tierAfterClick: tierAfterClick, lyftaWeek: lyftaWeek, dowOf: dowOf, MUSCLES: MUSCLES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window === 'undefined' || !window.ROOM) return;

  /* ------------------------------------------------------------------ the node mix per skill */
  // side: which column each node sits in (L / R); just: how a column spreads its nodes (positions vary per skill)
  var MIX = {
    strength: { visual: 'muscles', L: ['graph', 'today'], R: ['visual'], just: { L: 'space-between', R: 'center' } },
    running: { visual: 'heat', L: ['visual'], R: ['graph', 'today'], just: { L: 'center', R: 'space-between' } },
    triathlon: { visual: 'ring', L: ['graph', 'visual'], R: ['today'], just: { L: 'space-around', R: 'end' } },
    chess: { visual: 'ring', ring: 'consistency', L: ['graph'], R: ['visual', 'today'], just: { L: 'start', R: 'space-around' } },
    meditation: { visual: 'heat', L: ['today'], R: ['graph', 'visual'], just: { L: 'center', R: 'space-between' } },
    reading: { visual: 'ladder', L: ['visual'], R: ['graph', 'today'], just: { L: 'center', R: 'space-between' } },
    academics: { visual: 'due', L: ['graph', 'visual'], R: ['today'], just: { L: 'space-between', R: 'center' } },
    sleep: { visual: 'heat', L: ['graph'], R: ['visual', 'today'], just: { L: 'end', R: 'space-between' } },
    visualization: { visual: 'ring', L: ['visual', 'today'], R: ['graph'], just: { L: 'space-around', R: 'start' } },
    'college-integration': { visual: 'heat', L: ['today', 'graph'], R: ['visual'], just: { L: 'space-between', R: 'end' } },
    food: { visual: 'ring', L: ['visual'], R: ['today', 'graph'], just: { L: 'start', R: 'space-between' } },
    'gut-health': { visual: 'ladder', L: ['graph', 'today'], R: ['visual'], just: { L: 'space-around', R: 'center' } },
    'ai-building': { visual: 'ladder', L: ['graph', 'visual', 'today'], R: [], just: { L: 'space-between' } },
    dropshipping: { visual: 'ring', R: ['graph', 'visual', 'today'], L: [], just: { R: 'space-between' } },
  };
  // paired skills share one centre (the computer); each skill's nodes keep to its own side
  var PAIRS = { computer: ['ai-building', 'dropshipping'] };

  /* ------------------------------------------------------------------ helpers */
  var K = null;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function hex(name) {
    var cs = (ROOM.art.palette && ROOM.art.palette.colors) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i][0] === name) return cs[i][1];
    return null;
  }
  function rampOf(skill) {
    var cat = CAT_OVERRIDE[skill.slug] || skill.category;
    var names = (ROOM.art.palette.categories || {})[cat] || ['TERRA_0', 'CRT_0', 'CRT_1'];
    var r = names.map(hex);
    return { dark: r[0] || '#621d1a', mid: r[1] || '#d2211a', light: r[2] || '#fc3827', cat: cat };
  }
  function reduced() {
    return !!ROOM.state.reducedMotion;
  }
  function isPhone() {
    return ROOM.uikit && ROOM.uikit.isPhone ? ROOM.uikit.isPhone() : window.innerWidth <= 640;
  }
  function skillBySlug(slug) {
    var s = (ROOM.data && ROOM.data.skills) || [];
    for (var i = 0; i < s.length; i++) if (s[i].slug === slug) return s[i];
    return null;
  }
  function itemForSlug(slug) {
    var its = ROOM.itemsForSkill ? ROOM.itemsForSkill(slug) : [];
    return its.length ? its[0] : null;
  }
  function lyfta() {
    return window.ROOM_LYFTA || (ROOM.data && ROOM.data.lyfta) || null;
  }
  function fmt(n) {
    return Math.round(n).toLocaleString('en-US');
  }
  function upper(s) {
    return String(s || '').toUpperCase();
  }
  function shortDate(iso) {
    if (!iso) return '';
    var m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return m[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10);
  }
  function seg(labels, active, onPick, name) {
    var g = el('div', 'hl-seg');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', name);
    labels.forEach(function (l) {
      var b = el('button', null, l);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(l === active));
      b.addEventListener('click', function () {
        onPick(l);
      });
      g.appendChild(b);
    });
    return g;
  }
  function empty(text) {
    return el('p', 'hl-empty', text);
  }

  /* ------------------------------------------------------------------ graph node */
  var view = {}; // slug -> 'DAY' | 'WEEK' (kept while the page is open)

  function barsSvg(w, opts) {
    // 7 day columns: this week's bars (filled), last week as a ghost outline, future days dotted
    var W = 252, H = 64, bw = 20, gap = (W - 7 * bw) / 6;
    var max = Math.max(1, opts.max);
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + (H + 14), width: W, height: H + 14, 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' });
    s.appendChild(sv('rect', { x: 0, y: H, width: W, height: 2, fill: 'var(--hl-dark)' }));
    w.week.forEach(function (d, i) {
      var x = Math.round(i * (bw + gap));
      var pv = opts.val(w.prev[i]);
      if (pv > 0) {
        // last week: a dashed tick at its height
        var ph = Math.max(2, Math.round(((H - 4) * pv) / max / 2) * 2);
        for (var dx = 0; dx < bw; dx += 6) s.appendChild(sv('rect', { x: x + dx, y: H - ph, width: 4, height: 2, fill: 'var(--hl-dim)' }));
      }
      var v = opts.val(d);
      if (v > 0) {
        var h = Math.max(4, Math.round(((H - 4) * v) / max / 2) * 2);
        s.appendChild(sv('rect', { x: x + 4, y: H - h, width: bw - 8, height: h, fill: 'var(--hl-mid)' }));
        s.appendChild(sv('rect', { x: x + 4, y: H - h, width: bw - 8, height: 2, fill: 'var(--hl-light)' }));
      } else if (d.future) {
        s.appendChild(sv('rect', { x: x + 8, y: H - 4, width: 4, height: 2, fill: 'var(--hl-dark)' }));
      }
      var t = sv('text', { x: x + bw / 2, y: H + 13, 'text-anchor': 'middle', class: d.today ? 'hl-ax now' : 'hl-ax' });
      t.textContent = d.today ? 'NOW' : d.dow.slice(0, 1);
      s.appendChild(t);
    });
    return s;
  }

  function lyftaSvg(lw) {
    // minutes (line, ramp light) and volume (line, gold) per day this week; last week's minutes dashed
    var W = 252, H = 64;
    var maxM = 10, maxV = 10;
    lw.week.concat(lw.prev).forEach(function (d) {
      maxM = Math.max(maxM, d.minutes || 0);
      maxV = Math.max(maxV, d.volume || 0);
    });
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + (H + 14), width: W, height: H + 14, 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' });
    s.appendChild(sv('rect', { x: 0, y: H, width: W, height: 2, fill: 'var(--hl-dark)' }));
    var xs = function (i) {
      return 10 + Math.round((i * (W - 20)) / 6 / 2) * 2;
    };
    var ys = function (v, m) {
      return Math.round((H - 4 - ((H - 8) * v) / m) / 2) * 2;
    };
    var line = function (pts, colour, dash) {
      var a = { points: pts.join(' '), fill: 'none', stroke: colour, 'stroke-width': 2, 'shape-rendering': 'auto' };
      if (dash) a['stroke-dasharray'] = '4 4';
      s.appendChild(sv('polyline', a));
    };
    var cut = lw.week.filter(function (d) {
      return !d.future;
    }).length;
    line(lw.prev.map(function (d, i) {
      return xs(i) + ',' + ys(d.minutes || 0, maxM);
    }), 'var(--hl-dim)', true);
    line(lw.week.slice(0, cut).map(function (d, i) {
      return xs(i) + ',' + ys(d.volume || 0, maxV);
    }), 'var(--hl-gold)');
    line(lw.week.slice(0, cut).map(function (d, i) {
      return xs(i) + ',' + ys(d.minutes || 0, maxM);
    }), 'var(--hl-light)');
    lw.week.forEach(function (d, i) {
      if (d.workouts > 0) s.appendChild(sv('rect', { x: xs(i) - 3, y: ys(d.minutes || 0, maxM) - 3, width: 6, height: 6, fill: 'var(--hl-cream)' }));
      var t = sv('text', { x: xs(i), y: H + 13, 'text-anchor': 'middle', class: i === cut - 1 ? 'hl-ax now' : 'hl-ax' });
      t.textContent = i === cut - 1 ? 'NOW' : d.dow.slice(0, 1);
      s.appendChild(t);
    });
    return s;
  }

  function keyRow(items) {
    var k = el('div', 'hl-key');
    items.forEach(function (it) {
      var s = el('span', 'k-' + it[0]);
      s.appendChild(el('i'));
      s.appendChild(document.createTextNode(it[1]));
      k.appendChild(s);
    });
    return k;
  }
  function stat(v, unit, sub) {
    var d = el('div', 'hl-stat');
    var b = el('b', null, v);
    if (unit) b.appendChild(el('small', null, unit));
    d.appendChild(b);
    if (sub) d.appendChild(el('span', null, sub));
    return d;
  }

  function graphNode(skill) {
    var slug = skill.slug;
    var mode = view[slug] || 'WEEK';
    var node = panel(skill, 'graph', slug === 'strength' && lyftaWeek(lyfta()) ? 'This week' : 'Progress');
    var head = node.querySelector('.hl-head');
    head.appendChild(
      seg(['DAY', 'WEEK'], mode, function (l) {
        view[slug] = l;
        refresh(node, graphNode(skill));
      }, skill.name + ' chart range'),
    );
    var body = node.querySelector('.hl-body');
    var lw = slug === 'strength' ? lyftaWeek(lyfta()) : null;
    if (lw) {
      if (mode === 'WEEK') {
        var row = el('div', 'hl-stats');
        row.appendChild(stat(String(lw.sessions), 'LIFTS', 'last wk ' + lw.prevSessions));
        row.appendChild(stat(fmt(lw.volume), 'LB', 'last wk ' + fmt(lw.prevVolume)));
        body.appendChild(row);
        body.appendChild(lyftaSvg(lw));
        body.appendChild(keyRow([['line', 'Minutes'], ['gold', 'Lifted'], ['dash', 'Last wk']]));
      } else {
        var t = lw.today || {};
        if (t.workouts > 0) {
          body.appendChild(stat(String(t.minutes), 'MIN', fmt(t.volume) + ' lb lifted today'));
          var ex = (t.sessions && t.sessions[0] && t.sessions[0].exercises) || [];
          var maxV = 1;
          ex.forEach(function (e) {
            maxV = Math.max(maxV, e.volume || 0);
          });
          ex.slice(0, 4).forEach(function (e) {
            var r = el('div', 'hl-ex');
            r.appendChild(el('span', null, e.name));
            var bar = el('i');
            var fill = el('b');
            fill.style.width = Math.round((100 * (e.volume || 0)) / maxV) + '%';
            bar.appendChild(fill);
            r.appendChild(bar);
            body.appendChild(r);
          });
        } else {
          body.appendChild(empty('No lift logged yet today.'));
          var last = (lw.week.concat([])).filter(function (d) {
            return d.workouts > 0;
          }).pop();
          if (last) body.appendChild(el('p', 'hl-note', 'Last: ' + last.dow + ', ' + last.minutes + ' min, ' + fmt(last.volume) + ' lb'));
        }
      }
      return node;
    }
    var w = weekOf(skill, ROOM.data);
    if (mode === 'WEEK') {
      if (!w.has) {
        body.appendChild(empty('No data yet.'));
        return node;
      }
      var r2 = el('div', 'hl-stats');
      if (w.timed) r2.appendChild(stat(String(w.min), 'MIN', 'last wk ' + w.prevMin));
      r2.appendChild(stat(w.days + '/' + w.elapsed, 'DAYS', 'last wk ' + w.prevDays + '/7'));
      body.appendChild(r2);
      var max = 0;
      w.week.concat(w.prev).forEach(function (d) {
        max = Math.max(max, w.timed ? d.min : d.rank);
      });
      body.appendChild(barsSvg(w, { max: w.timed ? max : 3, val: function (d) {
        return w.timed ? d.min : d.rank;
      } }));
      body.appendChild(keyRow([['bar', w.timed ? 'Minutes' : 'Tier hit'], ['dash', 'Last wk']]));
      if (Array.isArray(skill.series) && skill.series.length >= 2 && skill.logUnit) {
        var sr = skill.series;
        body.appendChild(el('p', 'hl-note', upper(skill.logUnit) + ' ' + sr[sr.length - 1] + ' (was ' + sr[0] + ')'));
      }
    } else {
      var a = actionsOf(skill, ROOM.data);
      var r3 = el('div', 'hl-stats');
      r3.appendChild(stat(String(skill.display != null ? skill.display : Math.round(skill.score || 0)), null, 'score'));
      r3.appendChild(stat((skill.consistency || 0) + '%', null, 'consistent'));
      body.appendChild(r3);
      var lad = el('div', 'hl-tierbar');
      lad.setAttribute('role', 'img');
      var got = a.goal ? rankOf(a.goal.result) : 0;
      lad.setAttribute('aria-label', a.goal ? 'Today: ' + (got ? TIER_NAME[TIERS[got - 1]] + ' logged' : 'open') : 'Not on today\'s plan');
      TIERS.forEach(function (t, i) {
        var c = el('span', got > i ? 'on' : '', TIER_NAME[t]);
        lad.appendChild(c);
      });
      body.appendChild(lad);
      body.appendChild(el('p', 'hl-note', a.goal ? (got ? TIER_NAME[TIERS[got - 1]] + ' logged today' : 'Open today') : 'Not on today\'s plan'));
    }
    return node;
  }

  /* ------------------------------------------------------------------ visual nodes */
  // The muscle figure: one half authored (16 px), mirrored to 32. Lowercase = muscle base, uppercase = its
  // highlight, x = ink outline, : = separation shadow, n = skin, p = shorts. See SKILL_TREE_HOLO.md (avatar).
  var FIG = {
    front: [
      '............xxxx', '...........xnnnn', '..........xnnnnn', '..........xnnnnn', '..........xnnnnn',
      '..........xnnnnn', '...........xnnnn', '............xnnn', '............xnnn', '..........xxuunn',
      '.......xxxuuuuun', '.....xxsSSxuuuuu', '....xsSSssxxcccc', '...xsSssssxcCCCc', '...xssssssxcCCCc',
      '...xsssssxcCCccc', '...xbsss:xcccccc', '...xbBbx.xcccc::', '...xbBbx.x::::aa', '...xbBbx.xooxaAa',
      '...xbBbx.xoox:::', '...xbbbx.xooxaAa', '...xbbbx.xooxaaa', '...x:::x.xoox:::', '..xfFffx.xooxaAa',
      '..xfFffx.xooxaaa', '..xfFfx..xoox:::', '..xfffx..xooxaAa', '..xfffx...xoxaaa', '..xfffx...xppppp',
      '..xffx....xppppp', '..xnnx....xqqqqp', '..xnnnx..xqQqqqx', '..xnnnx..xqQqqqx', '...xnx...xqQqqqx',
      '........xqQqqqqx', '........xqQqq:qx', '........xqQqq:qx', '........xqqqq:qx', '........xqqqq:qx',
      '........xqqqqqqx', '.........xqqqqx.', '.........xqqqqx.', '.........xnnnnx.', '.........xnnnnx.',
      '.........xkkKnx.', '........xkkKnnx.', '........xkKknnx.', '........xkkknnx.', '.........xkknx..',
      '.........xkknx..', '.........xknnx..', '.........xnnnx..', '........xnnnnx..', '........xxxxxx..',
    ],
    back: [
      '............xxxx', '...........xnnnn', '..........xnnnnn', '..........xnnnnn', '..........xnnnnn',
      '..........xnnnnn', '...........xnnnn', '............xnnn', '............xnnn', '..........xxuuuu',
      '.......xxxuuUUuu', '.....xxsSSxuUUuu', '....xsSSssxuuuu:', '...xsSssssxuuuu:', '...xssssssxuuuu:',
      '...xsssss:uuuuu:', '...xtsss:uuUuuu:', '...xtTs:xuuUuu::', '...xtTtx.xuuuu:l', '...xtTtx.xuuu:ll',
      '...xtTtx.xuu:lLl', '...xtttx.xu:llLl', '...xtttx.x:lllLl', '...x:::x.xllllll', '..xfFffx.xllllll',
      '..xfFffx.xllllll', '..xfFfx..xllllll', '..xfffx..xllllll', '..xfffx...xlllll', '..xfffx...xggggg',
      '..xffx....xgGGgg', '..xnnx....xgGGgg', '..xnnnx..xggGggg', '..xnnnx..xgggggx', '...xnx...xhhhhhx',
      '........xhHhhhhx', '........xhHhh:hx', '........xhHhh:hx', '........xhhhh:hx', '........xhhhh:hx',
      '........xhhhhhhx', '.........xhhhhx.', '.........xhhhhx.', '.........xnnnnx.', '.........xkkkkx.',
      '........xkKkkkx.', '........xkKkkkkx', '........xkKkkkkx', '........xkkkkkx.', '.........xkkkx..',
      '.........xkkkx..', '.........xnkkx..', '.........xnnnx..', '........xnnnnx..', '........xxxxxx..',
    ],
  };
  var REGION = { c: 'chest', s: 'shoulders', b: 'biceps', t: 'triceps', f: 'forearms', a: 'abs', o: 'obliques', u: 'upperBack', l: 'lowerBack', g: 'glutes', q: 'quads', h: 'hamstrings', k: 'calves' };
  // level -> [base, highlight]: 0 dim (clearly off), 1..4 strong steps toward hot cream
  var HEAT = [['#3a1c1c', '#4f2828'], ['#621d1a', '#8e2a22'], ['#a8221a', '#d2211a'], ['#fc3827', '#ff8a5c'], ['#f4e6c4', '#fffaf0']];

  function drawFigure(c, rows, levels) {
    var W = 32, H = rows.length;
    c.width = W;
    c.height = H;
    var g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    rows.forEach(function (half, y) {
      var r = (half + '................').slice(0, 16);
      var full = r + r.split('').reverse().join('');
      for (var x = 0; x < W; x++) {
        var ch = full[x];
        if (ch === '.') continue;
        var col;
        if (ch === 'x') col = '#141517';
        else if (ch === ':') col = '#1e0b0b';
        else if (ch === 'n') col = '#4a3838';
        else if (ch === 'p') col = '#2a2024';
        else {
          var lv = levels[REGION[ch.toLowerCase()]] || 0;
          col = HEAT[lv][ch === ch.toUpperCase() ? 1 : 0];
        }
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    });
  }

  function ringSvg(frac, label, sub, segs) {
    // a stepped ring gauge: segs blocks, lit up to frac
    var S = 92, r = 36, n = segs || 12;
    var s = sv('svg', { viewBox: '0 0 ' + S + ' ' + S, width: S, height: S, 'aria-hidden': 'true' });
    var lit = Math.round(Math.max(0, Math.min(1, frac)) * n);
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.06, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.06;
      var p = function (a, rr) {
        return (S / 2 + Math.cos(a) * rr).toFixed(1) + ' ' + (S / 2 + Math.sin(a) * rr).toFixed(1);
      };
      s.appendChild(sv('path', { d: 'M' + p(a0, r) + ' A' + r + ' ' + r + ' 0 0 1 ' + p(a1, r), fill: 'none', 'stroke-width': 8, stroke: i < lit ? 'var(--hl-light)' : 'var(--hl-deep)' }));
    }
    var t = sv('text', { x: S / 2, y: S / 2 + 4, 'text-anchor': 'middle', class: 'hl-ring-v' });
    t.textContent = label;
    s.appendChild(t);
    if (sub) {
      var u = sv('text', { x: S / 2, y: S / 2 + 18, 'text-anchor': 'middle', class: 'hl-ax' });
      u.textContent = sub;
      s.appendChild(u);
    }
    return s;
  }

  function musclesNode(skill) {
    var L = lyfta();
    var node = panel(skill, 'visual', 'Muscles');
    var body = node.querySelector('.hl-body');
    var lw = lyftaWeek(L);
    var top = el('div', 'hl-row');
    var done = lw ? lw.done : weekOf(skill, ROOM.data).days;
    var planned = lw ? lw.planned : PLANNED_LIFTS;
    top.appendChild(ringSvg(done / planned, done + '/' + planned, 'LIFTS', planned * 3));
    var cap = el('div', 'hl-cap');
    cap.appendChild(el('b', null, done + ' of ' + planned + ' lifts'));
    cap.appendChild(el('span', null, 'this week'));
    cap.appendChild(el('small', null, planned + ' planned (assumed)'));
    top.appendChild(cap);
    body.appendChild(top);
    var m = L && L.muscles7d ? muscleLevels(L.muscles7d.volume) : null;
    var figs = el('div', 'hl-figs');
    figs.setAttribute('role', 'img');
    var worked = m
      ? MUSCLES.filter(function (k) {
        return m.levels[k] > 0;
      })
      : [];
    figs.setAttribute('aria-label', m ? (worked.length ? 'Worked in the last 7 days: ' + worked.join(', ') : 'No muscles worked in the last 7 days') : 'No Lyfta data');
    ['front', 'back'].forEach(function (side) {
      var f = el('figure');
      var c = el('canvas');
      drawFigure(c, FIG[side], m ? m.levels : {});
      f.appendChild(c);
      f.appendChild(el('figcaption', null, upper(side)));
      figs.appendChild(f);
    });
    body.appendChild(figs);
    if (m) {
      var key = el('div', 'hl-heatkey');
      key.appendChild(el('span', null, '0'));
      HEAT.forEach(function (h) {
        var i = el('i');
        i.style.background = h[0];
        key.appendChild(i);
      });
      key.appendChild(el('span', null, fmt(m.max) + ' LB'));
      body.appendChild(key);
      body.appendChild(el('p', 'hl-note', 'Last 7 days, Lyfta' + (L.asOf ? ' ' + shortDate(L.asOf) : '')));
    } else body.appendChild(empty('No Lyfta data yet.'));
    return node;
  }

  function heatNode(skill) {
    var node = panel(skill, 'visual', '28 days');
    var body = node.querySelector('.hl-body');
    var h = heatOf(skill, ROOM.data);
    if (!h) {
      body.appendChild(empty('No data yet.'));
      return node;
    }
    var g = el('div', 'hl-heat');
    g.setAttribute('role', 'img');
    g.setAttribute('aria-label', h.days + ' of the last 28 days logged');
    h.cells.forEach(function (v, i) {
      var c = el('i', 'l' + v + (i === 27 ? ' now' : ''));
      g.appendChild(c);
    });
    body.appendChild(g);
    var r = el('div', 'hl-stats');
    r.appendChild(stat(h.days + '/28', 'DAYS', null));
    if (h.streak != null) r.appendChild(stat(String(h.streak), 'RUN', null));
    body.appendChild(r);
    return node;
  }

  function ringNode(skill, kind) {
    var cons = kind === 'consistency';
    var node = panel(skill, 'visual', cons ? 'Consistency' : 'This week');
    var body = node.querySelector('.hl-body');
    var row = el('div', 'hl-row');
    if (cons) {
      row.appendChild(ringSvg((skill.consistency || 0) / 100, (skill.consistency || 0) + '%', null, 10));
      var c1 = el('div', 'hl-cap');
      c1.appendChild(el('b', null, upper(skill.levelName || '')));
      c1.appendChild(el('span', null, 'level ' + (skill.level || 0)));
      row.appendChild(c1);
    } else {
      var w = weekOf(skill, ROOM.data);
      if (!w.has) {
        body.appendChild(empty(skill.status === 'dormant' ? 'Dormant. No logs yet.' : 'No data yet.'));
        return node;
      }
      row.appendChild(ringSvg(w.days / 7, w.days + '/7', 'DAYS', 7));
      var c2 = el('div', 'hl-cap');
      c2.appendChild(el('b', null, w.days + ' of 7 days'));
      c2.appendChild(el('span', null, 'last wk ' + w.prevDays));
      row.appendChild(c2);
    }
    body.appendChild(row);
    return node;
  }

  function ladderNode(skill) {
    var node = panel(skill, 'visual', 'Steps');
    var body = node.querySelector('.hl-body');
    var steps = skill.steps || [];
    if (!steps.length) {
      body.appendChild(empty('No steps yet.'));
      return node;
    }
    var done = steps.filter(function (s) {
      return s.claimed;
    }).length;
    var lad = el('div', 'hl-ladder');
    lad.setAttribute('role', 'img');
    lad.setAttribute('aria-label', done + ' of ' + steps.length + ' steps done');
    steps.forEach(function (s, i) {
      lad.appendChild(el('i', s.claimed ? 'on' : i === done ? 'next' : ''));
    });
    body.appendChild(lad);
    body.appendChild(stat(done + '/' + steps.length, 'STEPS', null));
    var next = steps.filter(function (s) {
      return !s.claimed;
    })[0];
    if (next) {
      var p = el('p', 'hl-next');
      p.appendChild(el('em', null, 'NEXT +' + next.points));
      p.appendChild(document.createTextNode(next.title));
      body.appendChild(p);
    }
    return node;
  }

  function dueNode(skill) {
    var node = panel(skill, 'visual', 'Due soon');
    var body = node.querySelector('.hl-body');
    var due = ((ROOM.data && ROOM.data.dueSoon) || []).slice().sort(function (a, b) {
      return a.hours - b.hours;
    });
    if (!due.length) {
      body.appendChild(empty('Nothing due this week.'));
      return node;
    }
    var ul = el('ul', 'hl-due');
    due.slice(0, 3).forEach(function (d) {
      var li = el('li');
      li.appendChild(el('span', null, d.name));
      li.appendChild(el('b', null, d.hours < 24 ? d.hours + 'H' : Math.round(d.hours / 24) + 'D'));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    return node;
  }

  function visualNode(skill) {
    var mix = MIX[skill.slug] || { visual: 'heat' };
    if (mix.visual === 'muscles') return musclesNode(skill);
    if (mix.visual === 'ring') return ringNode(skill, mix.ring);
    if (mix.visual === 'ladder') return ladderNode(skill);
    if (mix.visual === 'due') return dueNode(skill);
    return heatNode(skill);
  }

  /* ------------------------------------------------------------------ today node */
  function catIcon() {
    var c = el('canvas', 'hl-catpx');
    var rows = ['x.....x', 'xx...xx', 'xxxxxxx', 'xoxxxox', 'xxxpxxx', '.xxxxx.'];
    c.width = 7;
    c.height = 6;
    var g = c.getContext('2d');
    rows.forEach(function (r, y) {
      for (var x = 0; x < 7; x++) {
        if (r[x] === '.') continue;
        g.fillStyle = r[x] === 'o' ? '#141517' : r[x] === 'p' ? '#d98aa0' : '#f4e6c4';
        g.fillRect(x, y, 1, 1);
      }
    });
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  function todayNode(skill) {
    var node = panel(skill, 'today', 'Today');
    var body = node.querySelector('.hl-body');
    var a = actionsOf(skill, ROOM.data);
    var head = node.querySelector('.hl-head');
    if (!a.rows.length) {
      body.appendChild(empty('Not on today\'s plan.'));
    } else {
      var n = a.rows.filter(function (r) {
        return r.checked;
      }).length;
      head.appendChild(el('span', 'hl-sub', n + ' / 3'));
      var ul = el('div', 'hl-acts');
      ul.setAttribute('role', 'group');
      ul.setAttribute('aria-label', skill.name + ', today');
      a.rows.forEach(function (r) {
        var b = el('button', 'hl-act' + (r.planned ? ' planned' : ''));
        b.type = 'button';
        b.setAttribute('role', 'checkbox');
        b.setAttribute('aria-checked', String(r.checked));
        b.dataset.tier = r.tier;
        b.appendChild(el('span', 'box'));
        b.appendChild(el('span', 't', r.label));
        b.appendChild(el('span', 's', r.min ? r.min + ' min' : r.text));
        b.title = r.text;
        b.setAttribute('aria-label', r.label + ': ' + r.text);
        b.addEventListener('click', function () {
          var next = tierAfterClick(a.rows, r.tier);
          if (ROOM.uiToday && ROOM.uiToday.setResult) ROOM.uiToday.setResult(a.goal.id, next, b);
          else {
            a.goal.result = next;
            ROOM.emit('log', { goalId: a.goal.id, result: next });
            ROOM.emit('data');
          }
        });
        ul.appendChild(b);
      });
      body.appendChild(ul);
    }
    var cat = el('p', 'hl-cat');
    cat.appendChild(catIcon());
    cat.appendChild(document.createTextNode('or tell the cat'));
    body.appendChild(cat);
    return node;
  }

  /* ------------------------------------------------------------------ panels, layout, tethers */
  function panel(skill, kind, title) {
    var p = el('section', 'hl-panel hl-' + kind);
    if (open && open.slugs.length > 1) p.appendChild(el('p', 'hl-skill', upper(skill.name)));
    p.dataset.skill = skill.slug;
    p.dataset.kind = kind;
    var rp = rampOf(skill);
    p.style.setProperty('--hl-dark', rp.dark);
    p.style.setProperty('--hl-mid', rp.mid);
    p.style.setProperty('--hl-light', rp.light);
    var h = el('div', 'hl-head');
    var t = el('h3', null, title);
    t.id = 'hl-' + skill.slug + '-' + kind;
    p.setAttribute('aria-labelledby', t.id);
    h.appendChild(t);
    p.appendChild(h);
    p.appendChild(el('div', 'hl-body'));
    return p;
  }
  function refresh(oldNode, newNode) {
    newNode.style.cssText = oldNode.style.cssText;
    newNode.classList.add('hl-shown');
    var f = document.activeElement && oldNode.contains(document.activeElement) ? document.activeElement.textContent : null;
    oldNode.replaceWith(newNode);
    if (f) {
      var again = Array.prototype.filter.call(newNode.querySelectorAll('button'), function (b) {
        return b.textContent === f;
      })[0];
      if (again) again.focus({ preventScroll: true });
    }
    place();
  }

  var root = null, cols = null, tether = null, plate = null, foot = null;
  var open = null; // {id, slugs, t0}
  var until = 0, armed = false;
  var MS_PULL = 1200;
  var lastEnter = -1e9;
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.closest && e.target.closest('.hs, #overview-list')) lastEnter = performance.now();
  }, true);

  function build() {
    root = el('div', 'holo');
    root.id = 'room-holo';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.tabIndex = -1;
    tether = sv('svg', { class: 'hl-tethers', 'aria-hidden': 'true', 'shape-rendering': 'crispEdges' });
    root.appendChild(tether);
    root.appendChild(el('div', 'hl-pulse'));
    plate = el('div', 'hl-plate');
    root.appendChild(plate);
    cols = { L: el('div', 'hl-col hl-L'), R: el('div', 'hl-col hl-R') };
    root.appendChild(cols.L);
    root.appendChild(cols.R);
    foot = el('div', 'hl-foot');
    root.appendChild(foot);
    document.body.appendChild(root);
  }

  function slugsFor(id) {
    var it = ROOM.itemById(id);
    var sk = it ? ROOM.skillOf(it) : null;
    if (!sk) return [];
    var zone = ROOM.stateItem(it).zone;
    var pair = PAIRS[zone];
    if (pair && pair.indexOf(sk.slug) >= 0) return pair.slice();
    return [sk.slug];
  }

  function render() {
    var slugs = open.slugs;
    var skills = slugs.map(skillBySlug).filter(Boolean);
    if (!skills.length) return;
    var main = skills[0];
    var rp = rampOf(main);
    root.style.setProperty('--hl-dark', rp.dark);
    root.style.setProperty('--hl-mid', rp.mid);
    root.style.setProperty('--hl-light', rp.light);
    var it = ROOM.itemById(open.id);
    var zone = it ? ROOM.zoneById(ROOM.stateItem(it).zone) : null;
    root.setAttribute('aria-label', skills.map(function (s) {
      return s.name;
    }).join(' and ') + ' hologram');
    // title plate: zone / category, then the skill name(s)
    plate.textContent = '';
    plate.appendChild(el('p', 'hl-eyebrow', upper((zone && zone.name) || '') + ' / ' + upper((ROOM.data.categories || []).filter(function (c) {
      return c.slug === rp.cat;
    }).map(function (c) {
      return c.name;
    })[0] || rp.cat)));
    plate.appendChild(el('h2', 'hl-title' + (skills.length > 1 ? ' two' : ''), skills.map(function (s) {
      return s.name;
    }).join(' + ')));
    cols.L.textContent = '';
    cols.R.textContent = '';
    var order = 0;
    skills.forEach(function (s, si) {
      var mix = MIX[s.slug] || { L: ['graph'], R: ['visual', 'today'], just: {} };
      var sides = skills.length > 1 ? { L: si === 0 ? ['graph', 'visual', 'today'] : [], R: si === 1 ? ['graph', 'visual', 'today'] : [] } : mix;
      ['L', 'R'].forEach(function (side) {
        (sides[side] || []).forEach(function (kind) {
          var n = kind === 'graph' ? graphNode(s) : kind === 'today' ? todayNode(s) : visualNode(s);
          n.style.setProperty('--hl-i', String(order++));
          cols[side].appendChild(n);
        });
        cols[side].style.justifyContent = (mix.just && mix.just[side]) || 'space-between';
      });
    });
    foot.textContent = '';
    skills.forEach(function (s) {
      var b = el('button', 'hl-open', skills.length > 1 ? 'Open ' + s.name : 'Open skill');
      b.type = 'button';
      b.addEventListener('click', function () {
        openSkill(s.slug);
      });
      foot.appendChild(b);
    });
    var close = el('button', 'hl-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () {
      ROOM.nav.back();
    });
    foot.appendChild(close);
    foot.appendChild(el('p', 'hl-hint', isPhone() ? 'Back or tap the room to close' : 'Esc or click the room to close'));
  }

  function openSkill(slug) {
    var cur = open && open.id;
    var it = itemForSlug(slug);
    if (!it) return;
    if (cur && ROOM.stateItem(ROOM.itemById(cur)).id === it.id) {
      ROOM.nav.toBoard();
      return;
    }
    ROOM.nav.request({ mode: 'skill', item: it.id }, { source: 'holo' });
  }

  /** Position the plate, columns, foot and tethers around the hero (CSS px). */
  function place() {
    if (!open || !root) return;
    var hr = ROOM.skill && ROOM.skill.rectCss ? ROOM.skill.rectCss() : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!hr) hr = { left: vw / 2 - 60, right: vw / 2 + 60, top: vh / 2 - 80, bottom: vh / 2 + 80, width: 120, height: 160 };
    var phone = isPhone();
    root.classList.toggle('phone', phone);
    var cx = Math.round((hr.left + hr.right) / 2);
    root.style.setProperty('--hx', cx + 'px');
    root.style.setProperty('--hy', Math.round((hr.top + hr.bottom) / 2) + 'px');
    root.style.setProperty('--hs', Math.round(Math.max(hr.width, hr.height) * 0.9) + 'px');
    plate.style.left = cx + 'px';
    plate.style.top = Math.max(phone ? 60 : 8, Math.round(hr.top) - (phone ? 50 : 74)) + 'px';
    if (phone) {
      // phone: the nodes stack and scroll under the object
      var top = Math.round(hr.bottom + 8);
      cols.L.style.cssText = 'top:' + top + 'px;';
      cols.R.style.cssText = '';
      cols.L.classList.add('scroll');
      // one scrolling column: move R's nodes after L's, the foot first
      Array.prototype.slice.call(cols.R.children).forEach(function (n) {
        cols.L.appendChild(n);
      });
      if (foot.parentNode !== cols.L) cols.L.insertBefore(foot, cols.L.firstChild);
      while (tether.firstChild) tether.removeChild(tether.firstChild);
      return;
    }
    cols.L.classList.remove('scroll');
    if (foot.parentNode !== root) root.appendChild(foot);
    foot.style.left = cx + 'px';
    foot.style.top = Math.round(hr.bottom + 14) + 'px';
    var gap = 40, mT = 56, mB = 44;
    var lw = Math.min(268, Math.round(hr.left - gap - 16));
    var rw = Math.min(268, Math.round(vw - 16 - hr.right - gap));
    cols.L.style.cssText = 'left:' + Math.round(hr.left - gap - lw) + 'px;top:' + mT + 'px;width:' + lw + 'px;height:' + (vh - mT - mB) + 'px;justify-content:' + cols.L.style.justifyContent;
    cols.R.style.cssText = 'left:' + Math.round(hr.right + gap) + 'px;top:' + mT + 'px;width:' + rw + 'px;height:' + (vh - mT - mB) + 'px;justify-content:' + cols.R.style.justifyContent;
    drawTethers(hr);
  }

  // layout box (CSS px, viewport) without the fly-out transform
  function boxOf(p) {
    var c = p.offsetParent || root;
    var l = c.offsetLeft + p.offsetLeft, t = c.offsetTop + p.offsetTop;
    return { left: l, top: t, right: l + p.offsetWidth, bottom: t + p.offsetHeight };
  }
  function drawTethers(hr) {
    while (tether.firstChild) tether.removeChild(tether.firstChild);
    tether.setAttribute('width', window.innerWidth);
    tether.setAttribute('height', window.innerHeight);
    var ev = function (v) {
      return Math.round(v / 2) * 2;
    };
    Array.prototype.forEach.call(root.querySelectorAll('.hl-panel'), function (p, i) {
      var r = boxOf(p);
      p.style.setProperty('--fx', Math.round((hr.left + hr.right) / 2 - (r.left + r.right) / 2) + 'px');
      p.style.setProperty('--fy', Math.round((hr.top + hr.bottom) / 2 - (r.top + r.bottom) / 2) + 'px');
      var left = r.right < hr.left;
      var px = ev(left ? r.right : r.left);
      var py = ev(Math.min(Math.max(r.top + 22, hr.top + 12), r.bottom - 12));
      var hx = ev(left ? hr.left - 6 : hr.right + 6);
      var hy = ev(Math.min(Math.max(py, hr.top + 12 + i * 6), hr.bottom - 12));
      // the elbow sits by the panel, so the run into the object stays inside its height (clear of the title)
      var mx = ev(px + (left ? 14 : -14));
      var pts = [px, py, mx, py, mx, hy, hx, hy];
      var d = 'M' + pts[0] + ' ' + pts[1] + ' H' + pts[2] + ' V' + pts[5] + ' H' + pts[6];
      var len = Math.abs(mx - px) + Math.abs(hy - py) + Math.abs(hx - mx);
      var path = sv('path', { d: d, class: 'hl-wire', style: '--len:' + len + ';--hl-i:' + i });
      path.style.stroke = getComputedStyle(p).getPropertyValue('--hl-light') || '';
      tether.appendChild(path);
      tether.appendChild(sv('rect', { x: hx - 3, y: hy - 3, width: 6, height: 6, class: 'hl-node', style: '--hl-i:' + i, fill: path.style.stroke }));
      tether.appendChild(sv('rect', { x: px - (left ? 0 : 6), y: py - 3, width: 6, height: 6, class: 'hl-node', style: '--hl-i:' + i, fill: path.style.stroke }));
    });
  }

  /* ------------------------------------------------------------------ open / close */
  function show(id) {
    if (!root) build();
    var same = open && open.id === id;
    if (same && !root.hidden) {
      place();
      return;
    }
    // opened from the keyboard (Enter on a hotspot): focus moves to OPEN SKILL
    var keyboard = performance.now() - lastEnter < 1500;
    open = { id: id, slugs: slugsFor(id), t0: performance.now() };
    if (!open.slugs.length) {
      open = null;
      return;
    }
    root.hidden = false;
    render();
    root.classList.remove('instant', 'in');
    void root.offsetWidth;
    root.classList.add(reduced() ? 'instant' : 'in');
    until = reduced() ? 0 : open.t0 + MS_PULL;
    document.body.classList.add('holo-open');
    place();
    requestAnimationFrame(place);
    if (keyboard) {
      var first = root.querySelector('.hl-open');
      if (first) first.focus({ preventScroll: true });
    }
    ROOM.emit('holo', { phase: 'open', id: id, skills: open.slugs });
  }
  function hide() {
    if (!open) return;
    var id = open.id;
    open = null;
    until = 0;
    if (root) {
      root.hidden = true;
      root.classList.remove('in', 'instant');
    }
    document.body.classList.remove('holo-open');
    ROOM.emit('holo', { phase: 'close', id: id });
  }

  ROOM.on('nav', function (d) {
    if (!open || d.phase !== 'start') return;
    var to = d.to;
    if (!(to && to.mode === 'skill' && to.holo && to.item === open.id)) hide();
  });
  ROOM.on('skill', function (d) {
    if (open && d.phase === 'drop') hide();
  });
  ROOM.on('data', function () {
    if (!open || !root) return;
    var t0 = until;
    render();
    Array.prototype.forEach.call(root.querySelectorAll('.hl-panel'), function (p) {
      p.classList.add('hl-shown');
    });
    until = t0;
    place();
  });
  window.addEventListener('resize', function () {
    if (open) requestAnimationFrame(place);
  });
  ROOM.on('layout', function () {
    if (open) requestAnimationFrame(place);
  });

  ROOM.holo = {
    show: show,
    hide: hide,
    isOpen: function () {
      return !!open;
    },
    current: function () {
      return open ? { id: open.id, skills: open.slugs.slice() } : null;
    },
    /** A single click is waiting out the double-click interval (overlay.js): count it as busy. */
    armClick: function (on) {
      armed = !!on;
    },
    busy: function () {
      return armed || (!!open && performance.now() < until);
    },
    place: place,
    MIX: MIX,
  };
  for (var k in PURE) ROOM.holo[k] = PURE[k];
})();
