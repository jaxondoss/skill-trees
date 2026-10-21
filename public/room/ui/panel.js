/* FORGE room prototype: the pixel panel.
 *
 * ROOM.ui.open(itemId) opens a pixel window (one side on a laptop, a bottom sheet on a phone) and dims
 * the room. Skill hotspots get a header (name, potion bottle filled to the score, level) and tabs:
 * TODAY, STEPS, DATA, NOTES; two skills on one object (the computer) get skill tabs. Feature hotspots:
 * statue (overall, categories, the upgrade tree), stats CRT, today CRT (opens the Today HUD), potion
 * shelf (archive), wall calendar, notebook (journal), doormat (review letter), switchboard (settings),
 * sticky note (focus line). Esc, the close button or a click on the room closes it.
 * Virtual ids work without art: "ui:stats", "ui:statue", "ui:skill:<slug>", ... (ROOM.ui.openFeature).
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  var K = ROOM.uikit;
  ROOM.ui = ROOM.ui || {};
  var h = K.h;

  var FEATURES = {
    statue: { title: 'FORGE', aliases: ['overall', 'statue', 'forge', 'score'], re: /statue|forge/ },
    stats: { title: 'STATS', aliases: ['stats', 'crt-stats', 'stats-crt'], re: /stats/ },
    today: { title: 'TODAY', aliases: ['today', 'crt-today', 'today-crt'], re: /today/ },
    archive: { title: 'POTION SHELF', aliases: ['archive', 'potions', 'potion-shelf', 'shelf', 'bottles'], re: /potion|archive/ },
    calendar: { title: 'WALL CALENDAR', aliases: ['calendar', 'wall-calendar', 'completion'], re: /wall-?calendar/ },
    journal: { title: 'NOTEBOOK', aliases: ['journal', 'notebook'], re: /notebook|journal/ },
    review: { title: 'DOORMAT', aliases: ['review', 'doormat', 'letter', 'mail'], re: /doormat|letter/ },
    settings: { title: 'SWITCHBOARD', aliases: ['settings', 'switchboard'], re: /switchboard|settings/ },
    focus: { title: 'STICKY NOTE', aliases: ['focus', 'sticky', 'sticky-note', 'focus-line'], re: /sticky/ },
    courses: { title: 'COURSE BOOKS', aliases: ['courses', 'course-books', 'textbooks', 'books'], re: /course|textbook/ },
    relic: { title: 'RELIC', aliases: ['relic'], re: /^relic/ },
  };
  // Two skills that live on one object get skill tabs.
  var SHARED = { 'ai-building': ['ai-building', 'dropshipping'], dropshipping: ['ai-building', 'dropshipping'] };
  var UNITS = {
    'ai-building': 'commits', dropshipping: 'revenue $', academics: 'study min', reading: 'pages', 'college-integration': 'people met',
    'time-blocking': 'blocks planned', chess: 'rapid rating', meditation: 'minutes', visualization: 'minutes', strength: 'top set kg',
    running: 'km', sleep: 'hours', triathlon: 'minutes', food: 'protein g', 'gut-health': 'plant servings',
  };

  /* ------------------------------------------------------------------ resolve an id */
  function featureFromName(name) {
    if (!name) return null;
    for (var k in FEATURES) if (FEATURES[k].aliases.indexOf(name) >= 0) return k;
    return null;
  }
  function resolve(id) {
    if (!id) return null;
    // Relic slots: engine-drawn ("relic.left") or art items with target.feature "relic-<slot>".
    var rm = /^relic\.(left|window|right)$/.exec(id);
    var rit = !rm && K.item(id);
    var rf = rit && rit.target && rit.target.feature && /^relic-(left|window|right)$/.exec(rit.target.feature);
    if (rm || rf) return { id: id, kind: 'feature', feature: 'relic', slot: (rm || rf)[1], item: rit || null };
    // Bodyweight lives in the Food panel (no scale hotspot of its own).
    if (rit && rit.target && rit.target.feature === 'bodyweight') {
      var food = K.itemForSkill('food');
      return food ? resolve(food) : resolve('ui:skill:food');
    }
    var m = /^ui:skill:(.+)$/.exec(id);
    if (m) return K.skill(m[1]) ? { id: id, kind: 'skill', skills: [m[1]], skill: m[1], item: null } : null;
    m = /^ui:(.+)$/.exec(id);
    if (m) return FEATURES[m[1]] ? { id: id, kind: 'feature', feature: m[1], item: null } : null;
    var it = K.item(id);
    if (!it) return null;
    var t = it.target || {};
    var slugs = t.skills || (t.skill ? [t.skill] : null);
    if (slugs && slugs.length) {
      var tabs = slugs.length > 1 ? slugs : SHARED[slugs[0]] && it.zone === 'computer' ? SHARED[slugs[0]] : slugs;
      tabs = tabs.filter(function (s) {
        return K.skill(s);
      });
      if (!tabs.length) return null;
      return { id: id, kind: 'skill', skills: tabs, skill: tabs.indexOf(slugs[0]) >= 0 ? slugs[0] : tabs[0], item: it };
    }
    var f = featureFromName(t.feature);
    if (!f) {
      for (var k in FEATURES) if (FEATURES[k].re.test(id)) f = k;
    }
    return f ? { id: id, kind: 'feature', feature: f, item: it } : { id: id, kind: 'feature', feature: null, item: it };
  }

  /* ------------------------------------------------------------------ window */
  var scrim, win, titleEl, bClose, body;
  var cur = null; // resolved target
  var opener = null;
  var tabOf = {}; // remembered tab per skill
  var skillOf = {}; // remembered skill tab per object

  function build() {
    scrim = h('div', { class: 'ui-scrim', hidden: true, 'aria-hidden': 'true', on: { pointerdown: function (e) {
      e.preventDefault();
      close();
    } } });
    titleEl = h('h2', { class: 'pxw-title', id: 'panel-title' });
    bClose = h('button', { type: 'button', class: 'px-tool', 'aria-label': 'Close', 'data-k': 'close', on: { click: function () {
      close();
    } } }, K.icon('close'));
    body = h('div', { class: 'pxw-body' });
    win = h('section', { class: 'pxw ui-panel', role: 'dialog', 'aria-modal': 'true', hidden: true },
      h('div', { class: 'pxw-bar' }, titleEl, bClose), body);
    K.root().appendChild(scrim);
    K.root().appendChild(win);
    window.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!cur || win.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      K.trapTab(win, e);
      e.stopPropagation();
    }
  }

  function sideFor(id) {
    if (ROOM.uiToday && ROOM.uiToday.open && ROOM.uiToday.pinned) return 'left';
    var r = typeof ROOM.itemRectCss === 'function' && K.item(id) ? ROOM.itemRectCss(id) : null;
    if (r && r.left + r.width / 2 > window.innerWidth * 0.55) return 'left';
    return 'right';
  }

  function open(id, opts) {
    opts = opts || {};
    var r = resolve(id);
    if (!r) return false;
    if (r.kind === 'feature' && r.feature === 'today') {
      if (cur) close({ restore: false });
      if (typeof ROOM.ui.toggleToday === 'function') ROOM.ui.toggleToday(true, { focus: true, opener: opts.opener });
      return true;
    }
    var wasOpen = !!cur;
    if (!wasOpen) opener = opts.opener || (document.activeElement !== document.body ? document.activeElement : null);
    cur = r;
    if (r.kind === 'skill' && opts.skill && r.skills.indexOf(opts.skill) >= 0) r.skill = opts.skill;
    else if (r.kind === 'skill' && skillOf[id] && r.skills.indexOf(skillOf[id]) >= 0 && !opts.skill) r.skill = skillOf[id];
    // An unpinned Today HUD steps aside.
    if (ROOM.uiToday && ROOM.uiToday.open && !ROOM.uiToday.pinned && typeof ROOM.ui.toggleToday === 'function') ROOM.ui.toggleToday(false, { restore: false });
    ROOM.state.panel = id;
    var phone = K.isPhone();
    win.classList.toggle('is-sheet', phone);
    win.classList.toggle('side-left', !phone && sideFor(id) === 'left');
    win.classList.toggle('side-right', phone || sideFor(id) !== 'left');
    render();
    scrim.hidden = false;
    win.hidden = false;
    if (typeof ROOM.setDim === 'function') ROOM.setDim(true);
    K.emit('state');
    if (!wasOpen || opts.focus) focusInto();
    return true;
  }

  function focusInto() {
    var first = win.querySelector('[role="tab"][aria-selected="true"]') || K.focusables(body)[0] || bClose;
    first.focus();
  }

  function close(opts) {
    opts = opts || {};
    if (!cur) return;
    cur = null;
    win.hidden = true;
    scrim.hidden = true;
    body.textContent = '';
    ROOM.state.panel = null;
    if (typeof ROOM.setDim === 'function') ROOM.setDim(false);
    K.emit('state');
    var o = opener;
    opener = null;
    if (opts.restore !== false && o) K.restoreFocus(o);
  }

  /** Re-render the open panel, keeping focus on the same control (data-k). */
  function render() {
    if (!cur) return;
    var a = document.activeElement;
    var key = a && win.contains(a) && a.dataset ? a.dataset.k : null;
    var scroll = body.scrollTop;
    body.textContent = '';
    K.catVars(win, 'gold');
    if (cur.kind === 'skill') renderSkill();
    else renderFeature();
    body.scrollTop = scroll;
    if (key) {
      var b = win.querySelector('[data-k="' + key + '"]');
      if (b) b.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ tabs */
  /** Accessible tablist; defs: [{key, label}]; render(key, panelEl). Arrow keys move and select. */
  function tabs(name, defs, selected, onSelect, cls) {
    var list = h('div', { class: 'px-tabs' + (cls ? ' ' + cls : ''), role: 'tablist', 'aria-label': name });
    var pid = 'ptab-' + name.replace(/\W+/g, '-').toLowerCase();
    var buttons = defs.map(function (d) {
      var sel = d.key === selected;
      var b = h('button', {
        type: 'button', role: 'tab', id: pid + '-' + d.key, 'aria-selected': sel ? 'true' : 'false', 'aria-controls': pid + '-panel',
        tabindex: sel ? '0' : '-1', 'data-k': 'tab-' + name + '-' + d.key, text: d.label,
        on: { click: function () {
          onSelect(d.key);
        } },
      });
      list.appendChild(b);
      return b;
    });
    list.addEventListener('keydown', function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      var n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = buttons.length - 1;
      if (n == null) return;
      e.preventDefault();
      onSelect(defs[n].key);
      var b = win.querySelector('[data-k="tab-' + name + '-' + defs[n].key + '"]');
      if (b) b.focus();
    });
    var panel = h('div', { role: 'tabpanel', id: pid + '-panel', 'aria-labelledby': pid + '-' + selected, tabindex: '-1' });
    return { list: list, panel: panel };
  }

  /* ------------------------------------------------------------------ skill panel */
  function renderSkill() {
    var slug = cur.skill;
    var s = K.skill(slug);
    if (!s) return;
    var zone = cur.item && typeof ROOM.zoneById === 'function' ? ROOM.zoneById(cur.item.zone) : null;
    titleEl.textContent = zone ? zone.name : 'SKILL';
    win.setAttribute('aria-label', s.name);
    K.catVars(win, s.category);

    if (cur.skills.length > 1) {
      var st = tabs('Skills on this object', cur.skills.map(function (k) {
        return { key: k, label: (K.skill(k) || { name: k }).name };
      }), slug, function (k) {
        cur.skill = k;
        skillOf[cur.id] = k;
        render();
      }, 'is-skills');
      body.appendChild(st.list);
    }

    var dormant = s.status !== 'active';
    body.appendChild(h('div', { class: 'p-head' },
      K.bottle(s.display, s.category, { dust: s.neglected, empty: dormant, label: s.name + ' bottle, ' + s.display + ' of 100' }),
      h('div', { class: 'p-head-main' },
        h('h3', { class: 'p-name', text: s.name }),
        h('div', { class: 'p-level', text: K.levelName(s) + (dormant ? ' · ' + s.status.toUpperCase() : s.neglected ? ' · DUSTY' : '') })),
      h('div', { class: 'p-score px-num', 'aria-label': 'Score ' + s.display }, String(s.display), h('small', { text: 'OF 100' }))));

    var tab = tabOf[slug] || 'today';
    var t = tabs('Sections', [
      { key: 'today', label: 'Today' },
      { key: 'steps', label: 'Steps' },
      { key: 'data', label: 'Data' },
      { key: 'notes', label: 'Notes' },
    ], tab, function (k) {
      tabOf[slug] = k;
      render();
    });
    body.appendChild(t.list);
    body.appendChild(t.panel);
    ({ today: skillToday, steps: skillSteps, data: skillData, notes: skillNotes })[tab](s, t.panel);
    if (slug === 'food') bodyweight(body);
  }

  /* Bodyweight: logged in the Food panel (the room has no scale hotspot). */
  function bodyweight(el) {
    var d = K.data();
    var log = (d.bodyweight = d.bodyweight || (d.live ? [] : [{ day: 'OCT 13', lb: 182.4 }, { day: 'OCT 16', lb: 181.8 }, { day: 'OCT 19', lb: 181.2 }]));
    el.appendChild(h('div', { class: 'px-label', text: 'Bodyweight · lb' }));
    var ul = h('ul', { class: 'p-list' });
    log.slice(-4).forEach(function (r) {
      ul.appendChild(h('li', null, r.day, h('span', { class: 'px-num', text: String(r.lb) })));
    });
    el.appendChild(ul);
    var input = h('input', { id: 'bw-input', class: 'lcd', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '000.0', 'data-k': 'bw' });
    function save() {
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!isFinite(v) || v < 60 || v > 500) {
        K.announce('Enter a weight in pounds.');
        input.focus();
        return;
      }
      log.push({ day: (d.weekdayLabel || 'TODAY').replace(/^\w+ /, ''), lb: Math.round(v * 10) / 10 });
      K.emit('bodyweight', { lb: Math.round(v * 10) / 10 });
      if (ROOM.sound && typeof ROOM.sound.pour === 'function') ROOM.sound.pour();
      K.announce('Bodyweight saved.');
      K.emit('data');
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    el.appendChild(h('label', { for: 'bw-input', class: 'px-label', text: 'Log bodyweight' }));
    el.appendChild(h('div', { class: 'lcd-row' }, input, h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'bw-save', text: 'Save', on: { click: save } })));
  }

  /* Course books: one book per course, coloured spines (sample courses unless data has its own). */
  var SAMPLE_COURSES = [
    { code: 'CMPS 1500', name: 'Intro to Computer Science', grade: 'A-', tone: 'LEAF_3', due: ['Lab 6 · Thu'] },
    { code: 'MATH 1210', name: 'Calculus I', grade: 'B+', tone: 'AMBER', due: ['Problem set 7 · Fri'] },
    { code: 'ECON 1010', name: 'Intro to Microeconomics', grade: 'A', tone: 'LEAF_3', due: [] },
    { code: 'ENGL 1010', name: 'Writing', grade: 'B', tone: 'AMBER', due: ['Essay draft · Mon'] },
    { code: 'TIDE 1520', name: 'First-year seminar', grade: 'A', tone: 'LEAF_3', due: [] },
  ];
  function fCourses(el) {
    var d = K.data();
    var acad = K.skill('academics') || {};
    var courses = (acad.config && acad.config.courses) || d.courses || SAMPLE_COURSES;
    var due = d.dueSoon || [];
    el.appendChild(h('div', { class: 'px-label', text: 'This semester · ' + courses.length + ' courses' }));
    var ul = h('ul', { class: 'p-courses' });
    courses.forEach(function (c) {
      var code = c.code || c.name;
      var items = (c.due || []).slice();
      due.forEach(function (x) {
        if (x.name && x.name.indexOf(code) === 0 && items.indexOf(x.name) < 0) items.push(x.name.replace(code + ': ', '') + ' · ' + Math.round(x.hours) + ' h');
      });
      ul.appendChild(h('li', null,
        h('span', { class: 'dot', 'aria-hidden': 'true', style: { background: K.hex(c.tone || (/^A/.test(c.grade || '') ? 'LEAF_3' : /^B/.test(c.grade || '') ? 'AMBER' : 'CRT_1')) } }),
        h('span', { class: 'c-main' }, h('b', { text: code }), h('span', { text: c.name || '' }),
          h('small', { text: items.length ? 'Due: ' + items.join(', ') : 'Nothing due' })),
        h('span', { class: 'px-chip', 'aria-label': 'Grade ' + (c.grade || 'none'), text: c.grade || '--' }),
        h('button', { type: 'button', class: 'px-btn', 'data-k': 'canvas-' + code, text: 'Open in Canvas', on: { click: function () {
          K.announce('Canvas is not connected in this prototype.');
        } } })));
    });
    el.appendChild(ul);
  }

  function ledState(slug) {
    if (ROOM.fx && typeof ROOM.fx.ledForSkill === 'function') return ROOM.fx.ledForSkill(slug);
    var g = K.goalsFor(slug);
    if (!g.length) return 'off';
    if (g.some(function (x) {
      return x.result === 'standard' || x.result === 'stretch';
    })) return 'full';
    if (g.some(function (x) {
      return x.result === 'floor';
    })) return 'half';
    if (g.some(function (x) {
      return x.nmt && !x.result;
    })) return 'blink';
    return 'pending';
  }

  function ladder(s, goal) {
    var sg = (s.goals && s.goals[0]) || {};
    var dl = h('dl', { class: 'p-ladder' });
    ['floor', 'standard', 'stretch'].forEach(function (t) {
      if (!sg[t]) return;
      var plan = goal && (goal.result ? goal.result === t : goal.tier === t);
      var min = sg.minutes && sg.minutes[t];
      dl.appendChild(h('dt', { text: { floor: 'F', standard: 'S', stretch: 'X' }[t], title: { floor: 'Floor', standard: 'Standard', stretch: 'Stretch' }[t] }));
      dl.appendChild(h('dd', { class: plan ? 'is-plan' : '' }, h('span', { class: 'ui-sr', text: { floor: 'Floor: ', standard: 'Standard: ', stretch: 'Stretch: ' }[t] }), sg[t], plan ? h('span', { class: 'ui-sr', text: goal.result ? ' (logged)' : ' (planned)' }) : null));
      dl.appendChild(h('dd', { class: 'm', text: min ? min + 'M' : '' }));
    });
    return dl;
  }

  function skillToday(s, el) {
    var goal = K.goalsFor(s.slug)[0];
    var sg = (s.goals && s.goals[0]) || {};
    if (goal) {
      var kind = { rack: 'RACK', balance: 'BALANCE', stretch: 'STRETCH, OPTIONAL' }[goal.kind] || '';
      el.appendChild(h('div', { class: 'px-label', text: "Today's goal · " + kind }));
      el.appendChild(h('p', { class: 'p-text' }, h('b', { text: goal.title }), goal.nmt && !goal.result ? h('span', { class: 'px-chip', style: { marginLeft: '8px', color: K.hex('CRT_1') }, text: 'Never miss twice' }) : null));
      el.appendChild(ladder(s, goal));
      var acts = h('div', { class: 'p-actions', role: 'group', 'aria-label': 'Log ' + goal.title });
      ['floor', 'standard', 'stretch'].forEach(function (t) {
        var on = goal.result === t;
        acts.appendChild(h('button', {
          type: 'button', class: 'px-btn' + (!goal.result && goal.tier === t ? ' is-primary' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-k': 'log-' + t,
          text: { floor: 'Floor', standard: 'Standard', stretch: 'Stretch' }[t],
          on: { click: function (e) {
            if (ROOM.uiToday) ROOM.uiToday.setResult(goal.id, on ? null : t, e.currentTarget);
          } },
        }));
      });
      if (goal.result) acts.appendChild(h('button', { type: 'button', class: 'px-btn', 'data-k': 'log-undo', text: 'Undo', on: { click: function () {
        if (ROOM.uiToday) ROOM.uiToday.setResult(goal.id, null, null);
      } } }));
      el.appendChild(acts);
    } else {
      el.appendChild(h('div', { class: 'px-label', text: "Today's goal" }));
      el.appendChild(h('p', { class: 'p-text px-muted', text: s.status === 'active' ? 'Not on today\'s list. The ladder is ready when it comes back.' : 'This skill is ' + s.status + '. No goals until it wakes.' }));
      if (sg.name) el.appendChild(h('p', { class: 'p-text' }, h('b', { text: sg.name })));
      el.appendChild(ladder(s, null));
    }
    if (sg.intention) {
      el.appendChild(h('div', { class: 'px-label', text: 'Intention' }));
      el.appendChild(h('p', { class: 'p-quote', text: sg.intention }));
    }
    var state = ledState(s.slug);
    el.appendChild(h('div', { class: 'p-led' }, K.led(state, s.category),
      h('div', null, h('div', { class: 'px-font', style: { fontSize: '9px', color: K.hex('GOLD'), marginBottom: '3px' }, text: 'The LED on the object' }), K.LED_TEXT[state] || '')));
  }

  function skillSteps(s, el) {
    var steps = s.steps || [];
    var got = 0, all = 0;
    steps.forEach(function (st) {
      all += st.points;
      if (st.claimed) got += st.points;
    });
    el.appendChild(h('div', { class: 'px-label', text: 'Steps · ' + got + ' of ' + all + ' points' }));
    if (!steps.length) {
      el.appendChild(h('p', { class: 'px-muted', text: 'No steps yet.' }));
      return;
    }
    var ol = h('ol', { class: 'p-steps' });
    steps.forEach(function (st) {
      ol.appendChild(h('li', { class: st.claimed ? 'is-claimed' : '' },
        h('span', { class: 'tick', 'aria-hidden': 'true' }),
        h('span', { class: 't' }, h('span', { class: 'ui-sr', text: st.claimed ? 'Claimed: ' : 'Open: ' }), st.title),
        h('span', { class: 'pts', text: '+' + st.points })));
    });
    el.appendChild(ol);
  }

  // Deterministic placeholder history per skill (labelled SAMPLE).
  function sampleSeries(slug, n, level) {
    var seed = 0;
    for (var i = 0; i < slug.length; i++) seed = (seed * 31 + slug.charCodeAt(i)) >>> 0;
    var out = [];
    for (var k = 0; k < n; k++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out.push(Math.max(0.08, Math.min(1, (level / 100) * 0.7 + ((seed >>> 8) % 1000) / 2400)));
    }
    return out;
  }

  function skillData(s, el) {
    var logs = (s.log = s.log || []);
    var live = !!K.data().live;
    var base = live ? (s.series || []).map(function (v, _i, a) {
      var m = Math.max.apply(null, a.concat([1]));
      return Math.max(0.08, v / m);
    }) : sampleSeries(s.slug, 14 - Math.min(logs.length, 7), s.display || 10);
    var max = 1;
    logs.forEach(function (v) {
      max = Math.max(max, v);
    });
    el.appendChild(h('div', { class: 'px-label', text: live ? (base.length ? 'Last ' + base.length + ' entries' : 'No numbers logged yet') : 'Last 14 days · sample' }));
    var chart = h('div', { class: 'p-chart', role: 'img', 'aria-label': 'Bar chart placeholder, last 14 days' + (logs.length ? ', latest ' + logs[logs.length - 1] : '') });
    base.forEach(function (v) {
      chart.appendChild(h('i', { style: { height: Math.round(v * 100) + '%' } }));
    });
    logs.slice(-7).forEach(function (v) {
      chart.appendChild(h('i', { class: 'is-new', style: { height: Math.max(6, Math.round((v / max) * 100)) + '%' } }));
    });
    el.appendChild(chart);
    el.appendChild(h('div', { class: 'p-chart-cap', 'aria-hidden': 'true' }, h('span', { text: '14D AGO' }), h('span', { text: 'TODAY' })));

    if (live) el.appendChild(h('a', { class: 'px-btn', href: '/s/' + s.slug, 'data-k': 'skill-page', text: 'Full skill page' }));
    if (live && !s.logKey) return;
    var unit = (live ? s.logUnit : UNITS[s.slug]) || 'value';
    var inputId = 'lcd-' + s.slug;
    var status = h('p', { class: 'p-saved', role: 'status' });
    var input = h('input', { id: inputId, class: 'lcd', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '000', 'data-k': 'lcd' });
    function save() {
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!isFinite(v)) {
        status.style.color = K.hex('CRT_1');
        status.textContent = 'ENTER A NUMBER';
        input.focus();
        return;
      }
      logs.push(v);
      if (ROOM.sound && typeof ROOM.sound.pour === 'function') ROOM.sound.pour();
      K.emit('metric', { skill: s.slug, key: s.logKey || null, value: v });
      K.emit('data');
      var st = win.querySelector('.p-saved');
      if (st) st.textContent = 'SAVED ' + v + ' ' + unit.toUpperCase();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    el.appendChild(h('label', { for: inputId, class: 'px-label', text: 'Log a number · ' + unit }));
    el.appendChild(h('div', { class: 'lcd-row' }, input, h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'lcd-save', text: 'Save', on: { click: save } })));
    el.appendChild(status);
  }

  function skillNotes(s, el) {
    el.appendChild(h('div', { class: 'px-label', text: 'Identity' }));
    el.appendChild(h('p', { class: 'p-quote', text: s.identity || 'No identity line yet.' }));
    el.appendChild(h('div', { class: 'px-label', text: 'Status' }));
    var cat = (K.data().categories || []).filter(function (c) {
      return c.slug === s.category;
    })[0];
    var ul = h('ul', { class: 'p-list' });
    ul.appendChild(h('li', null, 'Category', h('span', { class: 'px-chip', text: cat ? cat.name : s.category })));
    ul.appendChild(h('li', null, 'Consistency, 28 days', h('span', { class: 'px-num', text: (s.consistency || 0) + '%' })));
    ul.appendChild(h('li', null, 'Level', h('span', { class: 'px-chip', text: K.levelName(s) })));
    if (s.pinned) ul.appendChild(h('li', null, 'On the rack', h('span', { class: 'px-chip is-on', text: 'Pinned' })));
    if (s.neglected) ul.appendChild(h('li', null, 'Neglected', h('span', { class: 'px-chip', text: 'Dust on it' })));
    el.appendChild(ul);
  }

  /* ------------------------------------------------------------------ feature panels */
  function renderFeature() {
    var f = cur.feature;
    var def = FEATURES[f];
    titleEl.textContent = def ? def.title : String((cur.item && cur.item.label) || 'OBJECT').toUpperCase();
    if (f === 'relic') {
      var rel = ROOM.uiRelics && ROOM.uiRelics.get(cur.slot);
      titleEl.textContent = rel ? 'RELIC' : 'RELIC SLOT';
    }
    win.setAttribute('aria-label', def ? titleCase(def.title) : 'Object');
    var fn = {
      statue: fStatue, stats: fStats, archive: fArchive, calendar: fCalendar, journal: fJournal,
      review: fReview, settings: fSettings, focus: fFocus, courses: fCourses,
      relic: function (el) {
        if (ROOM.uiRelics) ROOM.uiRelics.render(el, cur.slot, { rerender: render, close: close, h: h, K: K });
      },
    }[f];
    if (fn) fn(body);
    else body.appendChild(h('div', { class: 'p-none' }, h('b', { text: 'Nothing here yet' }), 'This object has no panel in the prototype.'));
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function overallBlock(el) {
    var o = K.data().overall || {};
    el.appendChild(h('div', { class: 'p-big' },
      h('span', { class: 'px-num', text: String(o.display != null ? o.display : 0) }),
      h('span', { class: 'px-chip', text: (o.numeral || 'I') + ' ' + (o.name || 'Raw') })));
  }

  function fStatue(el) {
    var d = K.data();
    var o = d.overall || {};
    el.appendChild(h('div', { class: 'px-label', text: 'Overall score' }));
    overallBlock(el);
    var next = K.TIERS.filter(function (t) {
      return t.min > (o.display || 0);
    })[0];
    el.appendChild(h('p', { class: 'p-text', text: 'Tier ' + (o.numeral || 'I') + ' ' + (o.name || 'Raw') + (next ? ' · next threshold ' + next.min + ' (' + next.numeral + ' ' + next.name + ')' : ' · top tier') }));
    el.appendChild(h('p', { class: 'p-text px-muted', text: next ? next.min - (o.display || 0) + ' points to ' + next.numeral + ' ' + next.name + '. Categories count equally, so a lopsided week holds the room back.' : 'Sovereign. The room is complete.' }));

    el.appendChild(h('div', { class: 'px-label', text: 'Five categories' }));
    var ul = h('ul', { class: 'p-cats' });
    (d.categories || []).forEach(function (c) {
      var v = Math.round(c.score || 0);
      var li = h('li', null, h('span', { class: 'n', text: c.name }),
        h('span', { class: 'px-meter', role: 'meter', 'aria-label': c.name, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': v },
          h('i', { style: { width: 'calc(' + v + '% - ' + (2 * v) / 100 + 'px)' } })),
        h('span', { class: 'v', text: String(v) }));
      K.catVars(li, c.slug);
      ul.appendChild(li);
    });
    el.appendChild(ul);

    // Upgrade tree: a slider across tiers I to V listing each tier's room items.
    var now = o.tier || 1;
    el.appendChild(h('div', { class: 'px-label', text: 'Upgrade tree' }));
    var card = h('div', { class: 'tier-card', 'aria-live': 'polite' });
    var marks = h('div', { class: 'tier-marks', 'aria-hidden': 'true' });
    K.TIERS.forEach(function (t) {
      marks.appendChild(h('span', { class: t.tier === now ? 'is-now' : '', text: t.numeral }));
    });
    var range = h('input', { type: 'range', class: 'px-range', min: 1, max: 5, step: 1, value: now, 'aria-label': 'Room tier', 'data-k': 'tier-range' });
    function show(v) {
      var t = K.TIERS[v - 1];
      range.setAttribute('aria-valuetext', t.numeral + ' ' + t.name + (t.tier === now ? ', current' : ''));
      card.classList.toggle('is-now', t.tier === now);
      card.textContent = '';
      card.appendChild(h('h3', null, t.numeral + ' ' + t.name.toUpperCase(), h('small', { text: t.tier === now ? 'NOW · FROM ' + t.min : t.tier < now ? 'REACHED · FROM ' + t.min : 'FROM ' + t.min })));
      var list = h('ul');
      t.items.forEach(function (x) {
        list.appendChild(h('li', { text: x }));
      });
      card.appendChild(list);
    }
    range.addEventListener('input', function () {
      show(+range.value);
    });
    el.appendChild(h('div', { class: 'tier-track' }, range, marks));
    el.appendChild(card);
    show(now);
    var earned = [];
    K.TIERS.forEach(function (t) {
      if (t.tier <= now && t.tier > 1) earned = earned.concat(t.items);
    });
    el.appendChild(h('div', { class: 'px-label', text: 'Earned' }));
    var er = h('ul', { class: 'p-earned' });
    (earned.length ? earned : ['Nothing yet. Tier II starts at 20.']).forEach(function (x) {
      er.appendChild(h('li', { class: earned.length ? 'px-chip is-on' : 'px-muted', text: x }));
    });
    el.appendChild(er);
    el.appendChild(h('p', { class: 'p-text px-muted', style: { marginTop: '8px' }, text: 'Higher tiers replace items. The room never empties.' }));
  }

  function keptCount(d) {
    return (d.calendar || []).filter(function (c) {
      return c.p != null && c.p >= 85;
    }).length;
  }

  function fStats(el) {
    var d = K.data();
    var st = d.streak || {};
    el.appendChild(h('div', { class: 'px-label', text: 'Score' }));
    overallBlock(el);
    el.appendChild(h('div', { class: 'p-stats' },
      h('div', { class: 'p-stat' }, h('b', { text: String(st.current || 0) }), h('span', { text: 'STREAK' })),
      h('div', { class: 'p-stat' }, h('b', { text: String(st.best || 0) }), h('span', { text: 'BEST' })),
      h('div', { class: 'p-stat' }, h('b', { text: Math.round(d.todayP || 0) + '%' }), h('span', { text: 'TODAY' }))));
    el.appendChild(h('div', { class: 'px-label', text: 'Last 35 days' }));
    el.appendChild(h('p', { class: 'p-text', text: keptCount(d) + ' kept days (85% or more). A kept day adds to the streak; a day under 85% resets it.' }));
    el.appendChild(h('div', { class: 'p-actions' },
      h('button', { type: 'button', class: 'px-btn', 'data-k': 'to-cal', text: 'Open calendar', on: { click: function () {
        openFeature('calendar');
      } } }),
      h('button', { type: 'button', class: 'px-btn', 'data-k': 'to-statue', text: 'Open statue', on: { click: function () {
        openFeature('statue');
      } } })));
  }

  function fArchive(el) {
    var d = K.data();
    el.appendChild(h('div', { class: 'px-label', text: 'All skills · ' + K.skills().length }));
    var order = (d.categories || []).map(function (c) {
      return c.slug;
    });
    var list = K.skills().slice().sort(function (a, b) {
      return order.indexOf(a.category) - order.indexOf(b.category);
    });
    var grid = h('div', { class: 'p-shelf' });
    list.forEach(function (s) {
      var dormant = s.status === 'dormant', archived = s.status === 'archived';
      var stateTxt = archived ? 'ARCHIVED' : dormant ? 'DORMANT' : s.neglected ? 'DUSTY' : K.levelName(s).toUpperCase();
      var b = h('button', {
        type: 'button', class: (dormant ? 'is-dormant ' : '') + (archived ? 'is-archived ' : '') + (s.neglected ? 'is-dusty' : ''),
        'aria-label': s.name + ', ' + s.display + ', ' + stateTxt.toLowerCase(), 'data-k': 'shelf-' + s.slug,
        on: { click: function () {
          open(K.itemForSkill(s.slug) || 'ui:skill:' + s.slug, { skill: s.slug, focus: true });
        } },
      }, K.bottle(s.display, s.category, { dust: s.neglected, empty: dormant || archived }),
        h('span', { class: 'nm', text: s.name }), h('span', { class: 'sc', text: String(s.display) }), h('span', { class: 'st', text: stateTxt }));
      K.catVars(b, s.category);
      grid.appendChild(b);
    });
    el.appendChild(grid);
    el.appendChild(h('p', { class: 'p-text px-muted', style: { marginTop: '10px' }, text: 'Dormant and archived skills keep their bottle and their steps. Pick one to open it.' }));
    if (ROOM.uiRelics) ROOM.uiRelics.trophyList(el);
  }

  var RAMP = [
    { max: 20, c: 'CRT_0', name: '0-19' },
    { max: 40, c: 'RIM', name: '20-39' },
    { max: 60, c: 'AMBER', name: '40-59' },
    { max: 85, c: 'LEAF_2', name: '60-84' },
    { max: 101, c: 'LEAF_3', name: '85+' },
  ];
  function rampOf(p) {
    for (var i = 0; i < RAMP.length; i++) if (p < RAMP[i].max) return RAMP[i];
    return RAMP[RAMP.length - 1];
  }
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }

  function tally(n) {
    var wrap = h('div', { class: 'tally', role: 'img', 'aria-label': n + ' tally marks' });
    for (var g = 0; g < Math.ceil(n / 5); g++) {
      var k = Math.min(5, n - g * 5);
      var rows = [];
      for (var y = 0; y < 11; y++) {
        var r = '';
        for (var x = 0; x < 11; x++) {
          var bar = x % 2 === 1 && (x - 1) / 2 < Math.min(k, 4) && y >= 1 && y <= 9;
          var slash = k === 5 && y >= 1 && y <= 9 && x === 10 - y;
          r += bar || slash ? '#' : '.';
        }
        rows.push(r);
      }
      wrap.appendChild(K.bitmap(rows, { '#': 'currentColor' }));
    }
    return wrap;
  }

  function fCalendar(el) {
    var d = K.data();
    var days = (d.calendar || []).slice();
    if (d.today && !days.some(function (c) {
      return c.day === d.today;
    })) days.push({ day: d.today, p: Math.round(d.todayP || 0), live: true });
    var st = d.streak || {};
    el.appendChild(h('div', { class: 'px-label', text: 'Completion · last ' + days.length + ' days' }));
    if (!days.length) {
      el.appendChild(h('div', { class: 'p-none' }, h('b', { text: 'Blank calendar' }), 'Days fill in as you log.'));
    } else {
      var grid = h('div', { class: 'cal', role: 'grid', 'aria-label': 'Completion calendar' });
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (x) {
        grid.appendChild(h('span', { class: 'dow', 'aria-hidden': 'true', text: x }));
      });
      var first = parseDay(days[0].day);
      var lead = first ? (first.getUTCDay() + 6) % 7 : 0;
      for (var i = 0; i < lead; i++) grid.appendChild(h('span', { 'aria-hidden': 'true' }));
      days.forEach(function (c) {
        var dt = parseDay(c.day);
        var label = dt ? dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : c.day;
        var none = c.p == null;
        var r = none ? null : rampOf(c.p);
        var kept = !none && c.p >= 85;
        var cell = h('span', {
          class: 'day' + (none ? ' is-none' : '') + (kept ? ' is-kept' : '') + (c.day === d.today ? ' is-today' : ''),
          role: 'gridcell',
          'aria-label': label + ': ' + (none ? 'no data' : c.p + '%' + (kept ? ', kept' : '')) + (c.day === d.today ? ', today' : ''),
          text: dt ? String(dt.getUTCDate()) : '',
        });
        if (r) cell.style.background = K.hex(r.c);
        grid.appendChild(cell);
      });
      el.appendChild(grid);
      var legend = h('div', { class: 'cal-legend', 'aria-hidden': 'true' }, 'LESS');
      RAMP.forEach(function (r) {
        legend.appendChild(h('i', { style: { background: K.hex(r.c) } }));
      });
      legend.appendChild(document.createTextNode('MORE · '));
      legend.appendChild(h('i', { style: { background: K.hex('LEAF_3'), outline: '2px solid ' + K.hex('GOLD'), outlineOffset: '-2px' } }));
      legend.appendChild(document.createTextNode('KEPT'));
      el.appendChild(legend);
    }
    el.appendChild(h('div', { class: 'px-label', text: 'Streak · ' + (st.current || 0) + ' days · best ' + (st.best || 0) }));
    if (st.current) el.appendChild(tally(st.current));
    else el.appendChild(h('p', { class: 'px-muted', text: 'No streak yet. One kept day starts it.' }));
  }

  var MOODS = [
    { key: 1, name: 'Rough', c: 'CRT_0', mouth: [[2, 6], [3, 5], [4, 5], [5, 5], [6, 6]] },
    { key: 2, name: 'Low', c: 'RIM', mouth: [[2, 6], [3, 6], [4, 5], [5, 5], [6, 5]] },
    { key: 3, name: 'Okay', c: 'AMBER', mouth: [[3, 6], [4, 6], [5, 6]] },
    { key: 4, name: 'Good', c: 'LEAF_2', mouth: [[2, 5], [3, 6], [4, 6], [5, 6], [6, 5]] },
    { key: 5, name: 'Great', c: 'LEAF_3', mouth: [[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [3, 6], [4, 6], [5, 6]] },
  ];
  function face(m) {
    var base = ['..#####..', '.#.....#.', '#.......#', '#..#.#..#', '#.......#', '#.......#', '#.......#', '.#.....#.', '..#####..'];
    var rows = base.map(function (r, y) {
      return r.split('').map(function (ch, x) {
        if (ch === '#') return '#';
        if (y >= 1 && y <= 7 && x >= 1 && x <= 7 && !(y === 1 && (x === 1 || x === 7)) && !(y === 7 && (x === 1 || x === 7))) {
          if (y === 3 && (x === 3 || x === 5)) return 'e';
          for (var i = 0; i < m.mouth.length; i++) if (m.mouth[i][0] === x && m.mouth[i][1] === y) return 'e';
          return 'f';
        }
        return '.';
      }).join('');
    });
    return K.bitmap(rows, { '#': K.hex('VOID'), f: K.hex(m.c), e: K.hex('VOID') });
  }

  function fJournal(el) {
    var d = K.data();
    var j = (d.journal = d.journal || { mood: null, text: '' });
    el.appendChild(h('div', { class: 'px-label', text: 'How was today' }));
    var group = h('div', { class: 'moods', role: 'radiogroup', 'aria-label': 'Mood' });
    var buttons = MOODS.map(function (m) {
      var on = j.mood === m.key;
      var b = h('button', {
        type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': m.name, title: m.name, 'data-k': 'mood-' + m.key,
        tabindex: on || (!j.mood && m.key === 3) ? '0' : '-1',
        on: { click: function () {
          j.mood = m.key;
          render();
        } },
      }, face(m));
      group.appendChild(b);
      return b;
    });
    group.addEventListener('keydown', function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(4, i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1) : null;
      if (n == null) return;
      e.preventDefault();
      j.mood = MOODS[n].key;
      render();
      var nb = win.querySelector('[data-k="mood-' + j.mood + '"]');
      if (nb) nb.focus();
    });
    el.appendChild(group);
    var ta = h('textarea', { id: 'journal-text', 'data-k': 'journal', rows: 6, placeholder: 'One honest line is enough.' });
    ta.value = j.text || '';
    ta.addEventListener('input', function () {
      j.text = ta.value;
    });
    el.appendChild(h('div', { class: 'page' }, h('h3', null, h('label', { for: 'journal-text', text: (d.weekdayLabel || 'Today') + ' · page' })), ta));
    el.appendChild(h('p', { class: 'p-text px-muted', style: { marginTop: '8px' }, text: 'Kept in this page only. Sample state, nothing is sent.' }));
  }

  function fReview(el) {
    var d = K.data();
    var rv = d.review || {};
    if (!rv.weekly && !rv.monthly) {
      el.appendChild(h('div', { class: 'p-none' }, h('b', { text: 'No letter today' }), 'A letter lands here when a weekly or monthly review is waiting.'));
      return;
    }
    var last7 = (d.calendar || []).slice(-7);
    var kept = last7.filter(function (c) {
      return c.p != null && c.p >= 85;
    }).length;
    var top = K.skills().filter(function (s) {
      return s.status === 'active';
    }).sort(function (a, b) {
      return b.display - a.display;
    })[0];
    var dusty = K.skills().filter(function (s) {
      return s.neglected;
    }).map(function (s) {
      return s.name;
    });
    el.appendChild(h('div', { class: 'letter' },
      h('h3', { text: rv.monthly ? 'Monthly review' : 'Weekly review' }),
      h('p', { text: kept + ' of the last ' + last7.length + ' days kept.' }),
      top ? h('p', { text: 'Strongest: ' + top.name + ' at ' + top.display + '.' }) : null,
      h('p', { text: dusty.length ? 'Gathering dust: ' + dusty.join(', ') + '. Pick one for the rack.' : 'Nothing is gathering dust.' }),
      h('p', { text: 'Ten minutes. Then the rack for next week.' })));
    el.appendChild(h('div', { class: 'p-actions' }, h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'review-start', text: 'Start review', on: { click: function () {
      K.announce('The review flow is not in this prototype.');
    } } })));
  }

  function sw(label, on, fn, key) {
    return h('button', { type: 'button', role: 'switch', class: 'px-switch', 'aria-checked': on ? 'true' : 'false', 'data-k': key, on: { click: fn } },
      h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', { text: on ? 'ON' : 'OFF' }), h('span', { class: 'ui-sr', text: label }));
  }
  function fSettings(el) {
    var st = ROOM.state;
    el.appendChild(h('div', { class: 'px-label', text: 'Room' }));
    var ul = h('ul', { class: 'p-list' });
    ul.appendChild(h('li', null, 'Sound', sw('Sound', st.muted === false, function () {
      if (ROOM.sound && ROOM.sound.setMuted) ROOM.sound.setMuted(st.muted === false);
      render();
    }, 'set-sound')));
    ul.appendChild(h('li', null, 'Reduced motion', sw('Reduced motion', !!st.reducedMotion, function () {
      st.reducedMotion = !st.reducedMotion;
      K.emit('state');
      render();
    }, 'set-motion')));
    ul.appendChild(h('li', null, 'Night after 10 PM', h('span', { class: 'px-chip is-on', text: 'Auto' })));
    el.appendChild(ul);
    el.appendChild(h('div', { class: 'px-label', text: 'Placeholders' }));
    var ph = h('ul', { class: 'p-list' });
    ['Reminders', 'Canvas', 'Lyfta', 'Strava', 'Apple Health', 'Export data'].forEach(function (x) {
      ph.appendChild(h('li', null, x, h('span', { class: 'px-chip', text: 'Not in prototype' })));
    });
    el.appendChild(ph);
  }

  function fFocus(el) {
    var d = K.data();
    el.appendChild(h('div', { class: 'sticky' }, h('p', { text: d.focusLine || 'No focus line yet.' }), h('small', { text: 'FOCUS · ' + (d.weekdayLabel || '') })));
    var input = h('input', { id: 'focus-line', class: 'px-field', type: 'text', maxlength: '60', value: d.focusLine || '', 'data-k': 'focus-input' });
    function save() {
      d.focusLine = input.value.trim();
      K.emit('focus', { line: d.focusLine });
      K.emit('data');
      K.announce('Focus line saved.');
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    el.appendChild(h('label', { for: 'focus-line', class: 'px-label', text: 'Rewrite the line' }));
    el.appendChild(h('div', { class: 'lcd-row' }, input, h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'focus-save', text: 'Save', on: { click: save } })));
  }

  /* ------------------------------------------------------------------ public */
  function openFeature(name, opts) {
    var f = FEATURES[name] ? name : featureFromName(name);
    if (!f) return false;
    var id = K.itemForFeature(FEATURES[f].aliases) || 'ui:' + f;
    return open(id, Object.assign({ focus: true }, opts || {}));
  }

  build();
  K.on('data', function () {
    if (cur) render();
  });
  window.addEventListener('resize', function () {
    if (!cur) return;
    var phone = K.isPhone();
    win.classList.toggle('is-sheet', phone);
    if (phone) {
      win.classList.remove('side-left');
      win.classList.add('side-right');
    }
  });

  ROOM.ui.open = function (itemId, opts) {
    return open(itemId, opts);
  };
  ROOM.ui.close = function () {
    close();
  };
  ROOM.ui.openFeature = openFeature;
  ROOM.ui.panelOpen = function () {
    return !!cur;
  };
})();
