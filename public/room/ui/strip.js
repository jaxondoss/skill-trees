/* FORGE room prototype: ui kit (shared helpers for every ui file) and the corner strip.
 *
 * Corner strip, top-left: overall score with its tier numeral, today %, streak (one button that opens
 * the stats panel), the TODAY button, the mute toggle, help, and on touch a magnifier that toggles
 * ROOM.state.inspect. Everything codes against the frozen ROOM API and no-ops where a method is missing.
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  ROOM.ui = ROOM.ui || {};
  ROOM.state = ROOM.state || {};

  /* ================================================================== ui kit */
  var K = (ROOM.uikit = ROOM.uikit || {});

  var FALLBACK = {
    VOID: '#0C0A0C', INK: '#141517', INK_COOL: '#161D1B', BROWN_0: '#281B1B', BROWN_1: '#312D2A', BROWN_2: '#50302E',
    TERRA_0: '#621D1A', TERRA_1: '#8E432D', TERRA_2: '#B45B40', RIM: '#DA6339', ORANGE: '#F26B2A', GLOW: '#F39041',
    AMBER: '#CE8446', SUN: '#FEF576', GOLD: '#D9A441', GOLD_DK: '#6E5422', ROSE_0: '#815A50', ROSE_1: '#AF5D4D',
    LEAF_0: '#212C26', LEAF_1: '#344136', LEAF_2: '#3E6B35', LEAF_3: '#7FA650', SLATE_0: '#3E4F51', SLATE_1: '#56858A',
    SLATE_2: '#9CC0C2', PLUM_0: '#3A292F', PLUM_1: '#724F5B', PLUM_2: '#AF4D61', PLUM_3: '#D98AA0', CRT_0: '#D2211A',
    CRT_1: '#FC3827', CREAM: '#F4E6C4',
  };
  var FALLBACK_CATS = {
    gold: ['GOLD_DK', 'GOLD', 'SUN'], business: ['TERRA_1', 'AMBER', 'GLOW'], school: ['SLATE_0', 'SLATE_1', 'SLATE_2'],
    athletics: ['TERRA_0', 'CRT_0', 'CRT_1'], nutrition: ['LEAF_1', 'LEAF_2', 'LEAF_3'], mind: ['PLUM_1', 'PLUM_2', 'PLUM_3'],
  };
  function palette() {
    return (ROOM.art && ROOM.art.palette) || {};
  }
  /** Colour name -> hex (palette.json, else the built-in copy). */
  K.hex = function (name) {
    var cols = palette().colors || [];
    for (var i = 0; i < cols.length; i++) if (cols[i][0] === name) return cols[i][1];
    return FALLBACK[name] || '#FF00FF';
  };
  /** Category ramp as {dark, mid, light} hex. */
  K.cat = function (slug) {
    var cats = palette().categories || FALLBACK_CATS;
    var r = cats[slug] || FALLBACK_CATS[slug] || FALLBACK_CATS.gold;
    return { dark: K.hex(r[0]), mid: K.hex(r[1]), light: K.hex(r[2]), names: r };
  };
  K.catVars = function (el, slug) {
    var c = K.cat(slug);
    el.style.setProperty('--cat-dark', c.dark);
    el.style.setProperty('--cat-mid', c.mid);
    el.style.setProperty('--cat-light', c.light);
    return el;
  };

  /** Element builder: h('button', {class, text, attrs..., on: {click}}, children...). */
  K.h = function (tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) {
        el.addEventListener(ev, v[ev]);
      });
      else if (k === 'style') Object.keys(v).forEach(function (s) {
        if (s.indexOf('--') === 0) el.style.setProperty(s, v[s]);
        else el.style[s] = v[s];
      });
      else if (k === 'hidden') el.hidden = !!v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) {
      append(el, x);
    });
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }

  /** The one ui container (fonts, focus ring, colours scope to it). */
  K.root = function () {
    var r = document.getElementById('ui-root');
    if (!r) {
      r = K.h('div', { id: 'ui-root', class: 'ui-root' });
      document.body.appendChild(r);
    }
    return r;
  };

  var SVGNS = 'http://www.w3.org/2000/svg';
  /** Pixel bitmap -> crisp SVG. rows: strings; colors: char -> colour (or 'currentColor'). */
  K.bitmap = function (rows, colors, cls, label) {
    var w = 0;
    rows.forEach(function (r) {
      w = Math.max(w, r.length);
    });
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + rows.length);
    svg.setAttribute('class', 'px-icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('shape-rendering', 'crispEdges');
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
    } else svg.setAttribute('aria-hidden', 'true');
    rows.forEach(function (row, y) {
      // Merge horizontal runs of one colour into a single rect.
      var x = 0;
      while (x < row.length) {
        var ch = row[x];
        var col = colors[ch];
        if (!col) {
          x++;
          continue;
        }
        var x0 = x;
        while (x < row.length && row[x] === ch) x++;
        var rect = document.createElementNS(SVGNS, 'rect');
        rect.setAttribute('x', x0);
        rect.setAttribute('y', y);
        rect.setAttribute('width', x - x0);
        rect.setAttribute('height', 1);
        rect.setAttribute('fill', col);
        svg.appendChild(rect);
      }
    });
    return svg;
  };

  var ICONS = {
    speaker: ['....#......', '...##...#..', '.####.#..#.', '.####..#.#.', '.####..#.#.', '.####.#..#.', '...##...#..', '....#......'],
    muted: ['....#......', '...##......', '.####.#...#', '.####..#.#.', '.####...#..', '.####..#.#.', '...##.#...#', '....#......'],
    close: ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
    magnifier: ['..####...', '.#....#..', '#......#.', '#......#.', '#......#.', '#......#.', '.#....#..', '..#####..', '......###', '.......##'],
    flame: ['...#...', '...##..', '..###..', '.####.#', '.######', '#######', '###.###', '##...##', '.#####.'],
    pin: ['.#####.', '..###..', '..###..', '..###..', '#######', '...#...', '...#...', '...#...', '...#...'],
    check: ['.......##', '......##.', '##...##..', '.##.##...', '..###....', '...#.....'],
    undo: ['..#......', '.##......', '#######..', '.##....#.', '..#.....#', '........#', '.......#.', '..#####..'],
  };
  K.icon = function (name, cls) {
    return K.bitmap(ICONS[name] || ICONS.close, { '#': 'currentColor' }, cls);
  };

  /**
   * Mini potion bottle filled to a 0..100 score in its category colour (11 x 16 px art).
   * opts.dust adds speckles; opts.empty draws a dormant bottle.
   */
  K.bottle = function (score, catSlug, opts) {
    opts = opts || {};
    var c = K.cat(catSlug);
    // Interior span per row (null: no interior). Outline drawn around it.
    var spans = [null, null, [5, 5], [5, 5], [4, 6], [3, 7], [2, 8], [1, 9], [1, 9], [1, 9], [1, 9], [1, 9], [1, 9], [1, 9], [2, 8], null];
    var interiorRows = [];
    spans.forEach(function (s, y) {
      if (s && y >= 4) interiorRows.push(y);
    });
    var level = opts.empty ? 0 : Math.round((Math.max(0, Math.min(100, score || 0)) / 100) * interiorRows.length);
    var firstLiquid = interiorRows.length - level; // index into interiorRows
    var rows = [];
    for (var y = 0; y < 16; y++) {
      var r = '';
      for (var x = 0; x < 11; x++) {
        var ch = '.';
        if (y <= 1) ch = x >= 3 && x <= 7 ? (y === 0 ? 'k' : 'K') : '.';
        else if (y === 15) ch = x >= 2 && x <= 8 ? 'o' : '.';
        else {
          var s = spans[y];
          if (s) {
            if (x === s[0] - 1 || x === s[1] + 1) ch = 'o';
            else if (x >= s[0] && x <= s[1]) {
              var idx = interiorRows.indexOf(y);
              var liquid = idx >= 0 && idx >= firstLiquid && level > 0;
              if (liquid) ch = idx === firstLiquid ? 'L' : x === s[0] ? 'L' : 'M';
              else ch = x === s[0] + 1 && y >= 6 && y <= 9 ? 's' : 'g';
              if (opts.dust && y === 4 && (x === 4 || x === 6)) ch = 'd';
            }
          }
          if (opts.dust && y === 5 && (x === 2 || x === 8)) ch = 'd';
        }
        r += ch;
      }
      rows.push(r);
    }
    return K.bitmap(rows, {
      k: K.hex('AMBER'), K: K.hex('TERRA_1'), o: K.hex('VOID'), g: K.hex('BROWN_0'), s: K.hex('ROSE_0'),
      M: c.mid, L: c.light, d: K.hex('BROWN_2'),
    }, 'p-bottle', opts.label);
  };

  /** LED preview (3 x 3) in the engine's masks: off, pending, half, full, blink. */
  var LED_MASKS = { off: '555545555', pending: '222242222', half: '111131333', full: '232333232', blink: '232333232' };
  K.led = function (state, catSlug) {
    var c = K.cat(catSlug);
    var m = LED_MASKS[state] || LED_MASKS.off;
    var rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    var svg = K.bitmap(rows, { 1: c.dark, 2: c.mid, 3: c.light, 4: K.hex('VOID'), 5: K.hex('INK') }, 'led' + (state === 'blink' ? ' led-blink' : ''));
    return svg;
  };
  K.LED_TEXT = {
    off: 'Dark socket: no goal for this skill today.',
    pending: "Hollow ring: today's goal is waiting.",
    half: 'Half lit: logged at Floor.',
    full: 'Lit: done for today.',
    blink: 'Slow blink: missed last time. Never miss twice, so today the Floor is enough.',
  };

  /* ------------------------------------------------------------------ data helpers */
  K.data = function () {
    return ROOM.data || {};
  };
  K.skills = function () {
    return K.data().skills || [];
  };
  K.skill = function (slug) {
    var s = K.skills();
    for (var i = 0; i < s.length; i++) if (s[i].slug === slug) return s[i];
    return null;
  };
  K.goalsFor = function (slug) {
    return (K.data().goals || []).filter(function (g) {
      return g.skill === slug;
    });
  };
  K.items = function () {
    return (ROOM.art && ROOM.art.items) || [];
  };
  K.item = function (id) {
    if (typeof ROOM.itemById === 'function') return ROOM.itemById(id);
    var it = K.items();
    for (var i = 0; i < it.length; i++) if (it[i].id === id) return it[i];
    return null;
  };
  /** The hotspot item for a skill (null if the art has none yet). */
  K.itemForSkill = function (slug) {
    var list = typeof ROOM.itemsForSkill === 'function' ? ROOM.itemsForSkill(slug) : K.items().filter(function (it) {
      return it.target && (it.target.skill === slug || (it.target.skills || []).indexOf(slug) >= 0);
    });
    return list && list.length ? list[0].id : null;
  };
  /** The first hotspot whose target.feature is one of names. */
  K.itemForFeature = function (names) {
    var it = K.items();
    for (var i = 0; i < it.length; i++) {
      var f = it[i].target && it[i].target.feature;
      if (f && names.indexOf(f) >= 0) return it[i].id;
    }
    return null;
  };
  K.levelName = function (s) {
    var n = (s && s.levelName) || 'foundation';
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  K.TIERS = [
    { tier: 1, numeral: 'I', name: 'Raw', min: 0, items: ['Mattress on the floor', 'Bare bulb', 'Folding desk'] },
    { tier: 2, numeral: 'II', name: 'Awakened', min: 20, items: ['Bed frame', 'String lights', 'Desk lamp'] },
    { tier: 3, numeral: 'III', name: 'Forged', min: 40, items: ['Big rug', 'Desk chair', 'Framed posters'] },
    { tier: 4, numeral: 'IV', name: 'Ascendant', min: 60, items: ['Leather armchair', 'Wood bookcase', 'Plant wall'] },
    { tier: 5, numeral: 'V', name: 'Sovereign', min: 80, items: ['Neon FORGE sign', 'Gilded pedestal', 'Warm light everywhere'] },
  ];

  /* ------------------------------------------------------------------ env helpers */
  function mq(q) {
    try {
      return window.matchMedia(q).matches;
    } catch (e) {
      return false;
    }
  }
  K.isPhone = function () {
    return mq('(max-width: 640px)');
  };
  var sawTouch = false;
  K.isTouch = function () {
    return sawTouch || mq('(pointer: coarse)') || !!(ROOM.input && ROOM.input.touch);
  };
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' && !sawTouch) {
      sawTouch = true;
      if (typeof ROOM.emit === 'function') ROOM.emit('state', {});
    }
  }, true);
  K.reduced = function () {
    return !!ROOM.state.reducedMotion || mq('(prefers-reduced-motion: reduce)');
  };
  K.on = function (name, fn) {
    if (typeof ROOM.on === 'function') ROOM.on(name, fn);
  };
  K.emit = function (name, detail) {
    if (typeof ROOM.emit === 'function') ROOM.emit(name, detail || {});
  };
  K.store = {
    get: function (k) {
      try {
        return window.localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        window.localStorage.setItem(k, v);
      } catch (e) {
        /* not remembered */
      }
    },
  };

  /** Focusable elements inside a container, in order. */
  K.focusables = function (el) {
    return Array.prototype.filter.call(
      el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (n) {
        return !n.disabled && !n.hidden && n.tabIndex !== -1 && n.offsetParent !== null;
      },
    );
  };
  /** Keep Tab inside el. Returns true when handled. */
  K.trapTab = function (el, e) {
    if (e.key !== 'Tab') return false;
    var f = K.focusables(el);
    if (!f.length) return false;
    var i = f.indexOf(document.activeElement);
    var next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1;
    f[next].focus();
    e.preventDefault();
    return true;
  };
  /**
   * Put focus back on an element (the opener of a dialog). The engine re-appends its hotspot buttons
   * when the scene rebuilds (a "state" or "data" event), which drops focus, so try again after the
   * next frames if focus fell to the body.
   */
  K.restoreFocus = function (el) {
    if (!el) return;
    function tryIt() {
      if (el.isConnected && !el.hidden) el.focus({ preventScroll: true });
    }
    tryIt();
    var n = 0;
    (function again() {
      requestAnimationFrame(function () {
        var a = document.activeElement;
        if (!a || a === document.body) tryIt();
        if (++n < 3) again();
      });
    })();
  };
  /** Centre of an element in viewport CSS px. */
  K.centre = function (el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  /** Apply ui-only state classes (reduced motion) on the root. */
  K.syncRoot = function () {
    K.root().classList.toggle('ui-reduced', !!ROOM.state.reducedMotion);
  };

  /* ================================================================== corner strip */
  var strip, bStats, bToday, bMute, bHelp, bInspect, bMenu;
  var elTier, elScore, elToday, elMini, elStreak;

  function build() {
    var root = K.root();
    elTier = K.h('span', { class: 's-tier' });
    elScore = K.h('span', { class: 's-val' });
    elToday = K.h('span', { class: 's-val' });
    elMini = K.h('i');
    elStreak = K.h('span', { class: 's-val' });
    bStats = K.h('button', { type: 'button', class: 'strip-stats', on: { click: openStats } },
      elTier, elScore,
      K.h('span', { class: 's-sep', 'aria-hidden': 'true' }),
      K.h('span', { class: 's-lbl s-today-lbl', 'aria-hidden': 'true', text: 'DAY' }),
      elToday,
      K.h('span', { class: 's-mini', 'aria-hidden': 'true' }, elMini),
      K.h('span', { class: 's-sep', 'aria-hidden': 'true' }),
      K.icon('flame', 's-flame'),
      elStreak,
    );
    bToday = K.h('button', { type: 'button', class: 'strip-today', 'aria-expanded': 'false', text: 'TODAY', on: { click: function () {
      if (typeof ROOM.ui.toggleToday === 'function') ROOM.ui.toggleToday(undefined, { focus: true, opener: bToday });
    } } });
    bMute = K.h('button', { type: 'button', class: 'strip-icon strip-mute', on: { click: function () {
      var next = !ROOM.state.muted;
      if (ROOM.sound && typeof ROOM.sound.setMuted === 'function') ROOM.sound.setMuted(next);
      else {
        ROOM.state.muted = next;
        K.emit('state');
      }
      update();
    } } });
    bHelp = K.h('button', { type: 'button', class: 'strip-icon strip-help', 'aria-label': 'Help: controls', text: '?', on: { click: function () {
      if (typeof ROOM.ui.toggleHelp === 'function') ROOM.ui.toggleHelp(true);
    } } });
    bInspect = K.h('button', { type: 'button', class: 'strip-icon strip-inspect', 'aria-label': 'Inspect: show every name', on: { click: function () {
      ROOM.state.inspect = !ROOM.state.inspect;
      K.emit('state');
      if (typeof ROOM.invalidate === 'function') ROOM.invalidate();
      update();
    } } }, K.icon('magnifier'));
    // Phone: the strip collapses to score, today % and streak plus this menu (the rest folds into it).
    bMenu = K.h('button', { type: 'button', class: 'strip-icon strip-menu', 'aria-label': 'Menu', 'aria-expanded': 'false', on: { click: function () {
      setMenu(!strip.classList.contains('menu-open'));
    } } }, K.bitmap(['#######', '.......', '#######', '.......', '#######'], { '#': 'currentColor' }));
    [bToday, bMute, bHelp, bInspect].forEach(function (b) {
      b.classList.add('strip-more');
      b.addEventListener('click', function () {
        if (K.isPhone()) setMenu(false);
      });
    });
    strip = K.h('div', { class: 'ui-strip', role: 'group', 'aria-label': 'Status' }, bStats, bMenu, bToday, bMute, bHelp, bInspect);
    root.appendChild(strip);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && strip.classList.contains('menu-open')) {
        setMenu(false);
        bMenu.focus();
        e.stopPropagation();
      }
    }, true);
    update();
  }

  function setMenu(open) {
    strip.classList.toggle('menu-open', !!open);
    bMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openStats() {
    if (typeof ROOM.ui.openFeature === 'function') ROOM.ui.openFeature('stats', { opener: bStats });
    else if (typeof ROOM.ui.open === 'function') ROOM.ui.open(K.itemForFeature(['stats']) || 'ui:stats');
  }

  function update() {
    if (!strip) return;
    var d = K.data();
    var o = d.overall || {};
    var p = Math.round(d.todayP || 0);
    var streak = (d.streak && d.streak.current) || 0;
    elTier.textContent = o.numeral || 'I';
    elScore.textContent = o.display != null ? o.display : '--';
    elToday.textContent = p + '%';
    elMini.style.width = Math.round((30 * p) / 100) + 'px';
    elStreak.textContent = streak;
    bStats.setAttribute('aria-label', 'Stats: score ' + (o.display != null ? o.display : 0) + ', tier ' + (o.numeral || 'I') + ' ' + (o.name || '') + ', today ' + p + '%, streak ' + streak + (streak === 1 ? ' day' : ' days'));
    bToday.setAttribute('aria-label', "Jump to today's goals, " + p + '%');
    bToday.setAttribute('aria-expanded', ROOM.state.todayOpen ? 'true' : 'false');
    var muted = ROOM.state.muted !== false;
    bMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    bMute.setAttribute('aria-label', 'Mute');
    bMute.textContent = '';
    bMute.appendChild(K.icon(muted ? 'muted' : 'speaker'));
    bMute.title = muted ? 'Sound is off' : 'Sound is on';
    bInspect.hidden = !K.isTouch();
    bInspect.setAttribute('aria-pressed', ROOM.state.inspect ? 'true' : 'false');
    K.syncRoot();
  }
  K.updateStrip = update;

  build();
  K.on('data', update);
  K.on('state', update);
  K.on('log', update);
})();
