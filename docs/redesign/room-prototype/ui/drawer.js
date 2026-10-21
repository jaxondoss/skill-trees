/* FORGE room prototype: PROTOTYPE CONTROLS drawer (D, or the button bottom-right).
 *
 * Clearly outside the art (dashed frame, VOID). Every control writes ROOM.data or ROOM.state and emits
 * "data" or "state", so the room and the ui follow. A SAMPLE chip bottom-left says the data is not live.
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  var K = ROOM.uikit;
  ROOM.ui = ROOM.ui || {};
  var h = K.h;

  var SEASONS = ['spring', 'summer', 'fall', 'winter'];
  var HOLIDAYS = [['', 'None'], ['mardi-gras', 'Mardi Gras'], ['jazz-fest', 'Jazz Fest'], ['halloween', 'Halloween'], ['december', 'December']];
  var LEDS = ['auto', 'off', 'pending', 'half', 'full', 'blink'];

  var btn, chip, win, body;
  var isOpen = false;
  var opener = null;
  var selSkill = null;
  var tierAuto = true;
  var debug = { hits: false, focus: false };
  var focusLayer = null;

  function st() {
    return ROOM.state;
  }
  function setState(patch) {
    if (typeof ROOM.setState === 'function') ROOM.setState(patch);
    else {
      Object.keys(patch).forEach(function (k) {
        ROOM.state[k] = patch[k];
      });
      K.emit('state');
    }
    if (typeof ROOM.invalidate === 'function') ROOM.invalidate();
  }

  function build() {
    btn = h('button', { type: 'button', class: 'ui-drawer-btn', 'aria-expanded': 'false', 'aria-controls': 'ui-drawer', 'aria-label': 'Prototype controls', text: 'D · CONTROLS', on: { click: function () {
      toggle(undefined, { opener: btn });
    } } });
    chip = h('span', { class: 'px-chip ui-sample', 'aria-hidden': 'true' });
    body = h('div', { class: 'pxw-body' });
    win = h('section', { id: 'ui-drawer', class: 'pxw ui-drawer', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'drawer-title', hidden: true },
      h('div', { class: 'pxw-bar' }, h('h2', { class: 'pxw-title', id: 'drawer-title', text: 'Prototype controls' }),
        h('button', { type: 'button', class: 'px-tool', 'aria-label': 'Close prototype controls', on: { click: function () {
          toggle(false);
        } } }, K.icon('close'))),
      body);
    win.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggle(false);
      }
    });
    K.root().appendChild(chip);
    K.root().appendChild(btn);
    K.root().appendChild(win);
    syncChip();
  }

  function syncChip() {
    chip.textContent = (ROOM.dataKey === 'fresh' ? 'FRESH' : 'SAMPLE') + ' DATA · NOT LIVE';
  }

  function row(label, control, forId) {
    return h('div', { class: 'dr-row' }, forId ? h('label', { for: forId, text: label }) : h('span', { class: 'lbl', text: label }), control);
  }
  function seg(name, values, current, onPick, labels) {
    var wrap = h('div', { class: 'px-seg', role: 'group', 'aria-label': name });
    values.forEach(function (v, i) {
      wrap.appendChild(h('button', { type: 'button', 'aria-pressed': String(v) === String(current) ? 'true' : 'false', 'data-k': name + '-' + v, text: labels ? labels[i] : String(v), on: { click: function () {
        onPick(v);
        render();
      } } }));
    });
    return wrap;
  }
  function sw(label, on, fn, key) {
    return h('button', { type: 'button', role: 'switch', class: 'px-switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, 'data-k': key, on: { click: function () {
      fn(!on);
      render();
    } } }, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', { text: on ? 'ON' : 'OFF' }));
  }
  function select(id, options, value, onChange) {
    var s = h('select', { id: id, class: 'px-select', 'data-k': id });
    options.forEach(function (o) {
      var opt = h('option', { value: o[0], text: o[1] });
      if (String(o[0]) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () {
      onChange(s.value);
      render();
    });
    return s;
  }
  function range(id, min, max, value, onInput, valText) {
    var out = h('span', { class: 'val', text: valText ? valText(value) : String(value) });
    var r = h('input', { id: id, type: 'range', class: 'px-range', min: min, max: max, step: 1, value: value, 'data-k': id });
    r.addEventListener('input', function () {
      out.textContent = valText ? valText(+r.value) : r.value;
      onInput(+r.value);
    });
    return h('div', { class: 'dr-inline' }, r, out);
  }

  function render() {
    if (!win || win.hidden) return;
    var a = document.activeElement;
    var key = a && win.contains(a) && a.dataset ? a.dataset.k : null;
    var scroll = body.scrollTop;
    body.textContent = '';
    var d = ROOM.data || {};
    var s = ROOM.state;

    body.appendChild(h('div', { class: 'px-label', text: 'Data' }));
    body.appendChild(row('State', seg('preset', ['sample', 'fresh'], ROOM.dataKey || 'sample', function (v) {
      if (typeof ROOM.loadState === 'function') ROOM.loadState(v);
      else {
        ROOM.data = JSON.parse(JSON.stringify((window.ROOM_DATA || {})[v] || {}));
        ROOM.dataKey = v;
        K.emit('data');
      }
      selSkill = null;
      tierAuto = true;
      syncChip();
    }, ['Sample', 'Fresh'])));
    body.appendChild(row('Today %', range('dr-today', 0, 100, Math.round(d.todayP || 0), function (v) {
      d.todayP = v;
      K.emit('data');
    }, function (v) {
      return v + '%';
    }), 'dr-today'));

    body.appendChild(h('div', { class: 'px-label', text: 'Room' }));
    body.appendChild(row('Room tier', seg('tier', ['auto', 1, 2, 3, 4, 5], tierAuto ? 'auto' : s.roomTier, function (v) {
      if (v === 'auto') {
        tierAuto = true;
        setState({ roomTier: (d.overall && d.overall.tier) || 1 });
      } else {
        tierAuto = false;
        setState({ roomTier: v });
      }
    }, ['Auto', 'I', 'II', 'III', 'IV', 'V'])));
    body.appendChild(row('Night', sw('Night', !!s.night, function (v) {
      setState({ night: v });
    }, 'dr-night')));
    body.appendChild(row('Season', select('dr-season', SEASONS.map(function (x) {
      return [x, x.charAt(0).toUpperCase() + x.slice(1)];
    }), s.season, function (v) {
      setState({ season: v });
    }), 'dr-season'));
    body.appendChild(row('Holiday', select('dr-holiday', HOLIDAYS, s.holiday || '', function (v) {
      setState({ holiday: v || null });
    }), 'dr-holiday'));
    body.appendChild(row('Dog', seg('dog', ['sleep', 'neglect'], s.dog || 'sleep', function (v) {
      setState({ dog: v });
    }, ['Asleep', 'By dust'])));

    body.appendChild(h('div', { class: 'px-label', text: 'Skill' }));
    var skills = K.skills();
    if (!selSkill || !K.skill(selSkill)) selSkill = skills[0] && skills[0].slug;
    var sk = K.skill(selSkill);
    if (sk) {
      body.appendChild(row('Skill', select('dr-skill', skills.map(function (x) {
        return [x.slug, x.name + ' (' + x.display + ')'];
      }), selSkill, function (v) {
        selSkill = v;
      }), 'dr-skill'));
      body.appendChild(row('Score', range('dr-score', 0, 100, sk.display, function (v) {
        sk.display = v;
        sk.score = v;
        sk.levelName = v >= 67 ? 'mastery' : v >= 34 ? 'development' : 'foundation';
        K.emit('data');
      }), 'dr-score'));
      body.appendChild(row('Neglected', sw('Neglected', !!sk.neglected, function (v) {
        sk.neglected = v;
        K.emit('data');
      }, 'dr-neglect')));
      var leds = s.ledOverrides || (s.ledOverrides = {});
      body.appendChild(row('LED', seg('led', LEDS, leds[selSkill] || 'auto', function (v) {
        if (v === 'auto') delete leds[selSkill];
        else leds[selSkill] = v;
        setState({ ledOverrides: leds });
      }, ['Auto', 'Off', 'Ring', 'Half', 'Full', 'Blink'])));
    }

    body.appendChild(h('div', { class: 'px-label', text: 'Feel' }));
    body.appendChild(row('Reduced motion', sw('Reduced motion', !!s.reducedMotion, function (v) {
      setState({ reducedMotion: v });
    }, 'dr-motion')));
    body.appendChild(row('Sound', sw('Sound', s.muted === false, function (v) {
      if (ROOM.sound && ROOM.sound.setMuted) ROOM.sound.setMuted(!v);
      else setState({ muted: !v });
    }, 'dr-sound')));

    body.appendChild(h('div', { class: 'px-label', text: 'Debug' }));
    body.appendChild(row('Hit boxes', sw('Hit boxes', debug.hits, function (v) {
      debug.hits = v;
      document.body.classList.toggle('ui-debug-hits', v);
    }, 'dr-hits')));
    body.appendChild(row('Focus boxes', sw('Focus boxes', debug.focus, function (v) {
      debug.focus = v;
      drawFocusBoxes();
    }, 'dr-focus')));
    body.appendChild(h('p', { class: 'dr-note', text: 'Prototype only. Nothing here is part of the room.' }));

    body.scrollTop = scroll;
    if (key) {
      var b = win.querySelector('[data-k="' + key + '"]');
      if (b) b.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ debug: zone focus boxes */
  function drawFocusBoxes() {
    if (focusLayer) {
      focusLayer.remove();
      focusLayer = null;
    }
    if (!debug.focus) return;
    var R = ROOM.render;
    if (!R || typeof R.worldFromCss !== 'function' || !R.canvas || !R.view) return;
    var c = R.canvas.getBoundingClientRect();
    // worldFromCss is linear: sample it twice and invert (layer 0, camera at rest).
    var a = R.worldFromCss(0, 0), b = R.worldFromCss(100, 100);
    var sx = 100 / (b.x - a.x), sy = 100 / (b.y - a.y);
    focusLayer = h('div', { class: 'ui-debug-focus', 'aria-hidden': 'true' });
    (ROOM.zones || []).forEach(function (z) {
      if (!z.focus) return;
      var f = z.focus;
      focusLayer.appendChild(h('i', { style: {
        left: (c.left + (f[0] - a.x) * sx).toFixed(1) + 'px', top: (c.top + (f[1] - a.y) * sy).toFixed(1) + 'px',
        width: (f[2] * sx).toFixed(1) + 'px', height: (f[3] * sy).toFixed(1) + 'px',
      } }, h('span', { text: z.n + ' ' + z.name })));
    });
    K.root().appendChild(focusLayer);
  }
  var redrawTimer = 0;
  function redrawSoon() {
    if (!debug.focus) return;
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(drawFocusBoxes, 700); // after the dolly settles
  }

  /* ------------------------------------------------------------------ open / close */
  function toggle(open, opts) {
    opts = opts || {};
    var next = open == null ? !isOpen : !!open;
    if (next === isOpen) return;
    isOpen = next;
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      opener = opts.opener || (document.activeElement !== document.body ? document.activeElement : null);
      win.hidden = false;
      render();
      var first = K.focusables(body)[0];
      if (first) first.focus();
    } else {
      var had = win.contains(document.activeElement);
      win.hidden = true;
      if (had) K.restoreFocus(opener && opener.isConnected ? opener : btn);
      opener = null;
    }
  }

  build();
  K.on('data', function () {
    syncChip();
    if (isOpen && !(document.activeElement && document.activeElement.type === 'range' && win.contains(document.activeElement))) render();
  });
  K.on('state', function () {
    if (isOpen && !(document.activeElement && document.activeElement.type === 'range' && win.contains(document.activeElement))) render();
  });
  K.on('zone', redrawSoon);
  window.addEventListener('resize', redrawSoon);

  ROOM.ui.toggleDrawer = function (open) {
    toggle(open);
  };
})();
