/* FORGE room prototype: what sits on top of the art.
 *
 * Canvas marks (drawn into the framebuffer after the LUT, true palette colours):
 *   - nameplates: 3x5 pixel font on a GOLD_DK plate, "STRENGTH 52", shown for the hovered or focused
 *     hotspot, or for every visible hotspot in inspect mode, de-overlapped greedily upward;
 *   (the zone title is a DOM canvas, #zone-title: 5x7 pixel font, revealed in Bayer steps within
 *   ~120 ms of the click, also during the dolly; on a phone it sits below the HUD strip).
 * DOM (accessible):
 *   - one transparent <button> per hotspot over its hit box, named like "Strength, 52";
 *     at least 24 CSS px on fine pointers, 44 on touch (where they exist only in zone view);
 *     nearer layer on top, then the smaller box; DOM order (left to right) is the tab order;
 *   - zone dots (1..7), and a polite live region announcing the zone.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var C = ROOM.C;

  /* ------------------------------------------------------------------ fonts */
  // 3x5: five rows of three bits per glyph.
  var F3 = {
    A: '010 101 111 101 101', B: '110 101 110 101 110', C: '011 100 100 100 011', D: '110 101 101 101 110',
    E: '111 100 110 100 111', F: '111 100 110 100 100', G: '011 100 101 101 011', H: '101 101 111 101 101',
    I: '111 010 010 010 111', J: '001 001 001 101 010', K: '101 101 110 101 101', L: '100 100 100 100 111',
    M: '101 111 111 101 101', N: '110 101 101 101 101', O: '010 101 101 101 010', P: '110 101 110 100 100',
    Q: '010 101 101 110 011', R: '110 101 110 101 101', S: '011 100 010 001 110', T: '111 010 010 010 010',
    U: '101 101 101 101 111', V: '101 101 101 101 010', W: '101 101 111 111 101', X: '101 101 010 101 101',
    Y: '101 101 010 010 010', Z: '111 001 010 100 111',
    0: '111 101 101 101 111', 1: '010 110 010 010 111', 2: '110 001 010 100 111', 3: '110 001 010 001 110',
    4: '101 101 111 001 001', 5: '111 100 110 001 110', 6: '011 100 110 101 010', 7: '111 001 010 010 010',
    8: '010 101 010 101 010', 9: '010 101 011 001 110',
    ' ': '000 000 000 000 000', '-': '000 000 111 000 000', '.': '000 000 000 000 010', ',': '000 000 000 010 100',
    ':': '000 010 000 010 000', '%': '101 001 010 100 101', '/': '001 001 010 100 100', '?': '110 001 010 000 010',
    '!': '010 010 010 000 010', "'": '010 010 000 000 000', '&': '010 101 010 101 011', '+': '000 010 111 010 000',
  };
  // 5x7: seven rows of five bits (zone titles).
  var F5 = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
    ' ': '00000 00000 00000 00000 00000 00000 00000',
  };
  function parseFont(src) {
    var out = {};
    Object.keys(src).forEach(function (ch) {
      out[ch] = src[ch].split(' ').map(function (row) {
        return row.split('').map(Number);
      });
    });
    return out;
  }
  var FONT3 = parseFont(F3);
  var FONT5 = parseFont(F5);

  function glyphs(font, text) {
    return String(text)
      .toUpperCase()
      .split('')
      .map(function (ch) {
        return font[ch] || font[' '];
      });
  }
  function textWidth(font, text) {
    var g = glyphs(font, text);
    return g.reduce(function (w, gl) {
      return w + gl[0].length + 1;
    }, -1);
  }
  /** Call put(x, y) for every lit pixel of `text` with its top-left at (x, y). */
  function eachPixel(font, text, x, y, put) {
    glyphs(font, text).forEach(function (gl) {
      for (var r = 0; r < gl.length; r++) for (var c = 0; c < gl[r].length; c++) if (gl[r][c]) put(x + c, y + r);
      x += gl[0].length + 1;
    });
  }

  /* ------------------------------------------------------------------ names */
  function titleCase(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/(^|[\s-])([a-z])/g, function (m, a, b) {
        return a + b.toUpperCase();
      });
  }
  /** Accessible name: "Strength, 52"; features by label, alerts spelled out. */
  function nameOf(d) {
    var it = d.item;
    if (d.skill) return d.skill.name + ', ' + d.skill.display;
    var label = titleCase(it.label || it.id.split('.').pop());
    if (it.target && it.target.feature === 'overall' && ROOM.data.overall) return 'Overall, ' + ROOM.data.overall.display;
    if (/backpack/.test(it.id) && ROOM.alertOn(it)) return label + ', something due within 48 hours';
    if (/doormat/.test(it.id) && ROOM.alertOn(it)) return label + ', a review is waiting';
    return label;
  }
  /** Nameplate text: "STRENGTH 52". */
  function plateOf(d) {
    var it = d.item;
    var label = String(it.label || (d.skill && d.skill.name) || it.id.split('.').pop()).toUpperCase();
    var score = ROOM.scoreOf(it);
    return score != null ? label + ' ' + score : label;
  }

  /* ------------------------------------------------------------------ canvas marks */
  var titleT0 = -1e9;
  var titleText = null;

  function currentTitle() {
    var R = ROOM.render;
    if (ROOM.state.zone) return ROOM.zoneById(ROOM.state.zone).name;
    if (R.view && R.view.mode === 'pan') {
      // On the phone the room view pans; name the zone whose stop is nearest.
      var x = R.pan.x, best = null;
      ROOM.zones.forEach(function (z) {
        if (!best || Math.abs(z.stop - x) < Math.abs(best.stop - x)) best = z;
      });
      return best ? best.name : null;
    }
    return null;
  }

  function drawMarks(f) {
    var R = ROOM.render;
    var visTop = Math.ceil(f.org.oy / f.z - f.y0);
    var visLeft = f.org.ox / f.z - f.x0;
    var visW = R.view.Wd / f.z;

    // Nameplates.
    var plates = [];
    var inZone = !!ROOM.state.zone;
    R.drawables.forEach(function (d) {
      if (!d.hotspot || (inZone && d.layer === 6)) return;
      if (!(ROOM.state.inspect || d.id === R.hoverId || d.id === R.focusId)) return;
      var text = plateOf(d);
      var w = textWidth(FONT3, text) + 4, h = 9;
      var cx = d.hit[0] + d.hit[2] / 2 + f.offs[d.layer] - f.x0;
      plates.push({ x: Math.round(cx - w / 2), y: d.hit[1] - f.y0 - h - 2, w: w, h: h, text: text });
    });
    // Greedy de-overlap: lowest plate keeps its place, any plate it collides with moves up.
    plates.sort(function (a, b) {
      return b.y - a.y;
    });
    var placed = [];
    plates.forEach(function (p) {
      p.x = Math.max(Math.ceil(visLeft) + 1, Math.min(Math.floor(visLeft + visW) - p.w - 1, p.x));
      for (var guard = 0; guard < 40; guard++) {
        var hit = null;
        for (var i = 0; i < placed.length; i++) {
          var q = placed[i];
          if (p.x < q.x + q.w + 1 && q.x < p.x + p.w + 1 && p.y < q.y + q.h + 1 && q.y < p.y + p.h + 1) hit = q;
        }
        if (!hit) break;
        p.y = hit.y - p.h - 1;
      }
      p.y = Math.max(visTop + 1, p.y);
      placed.push(p);
    });
    placed.forEach(function (p) {
      for (var y = 0; y < p.h; y++)
        for (var x = 0; x < p.w; x++) {
          var edge = x === 0 || y === 0 || x === p.w - 1 || y === p.h - 1;
          R.plot(f, p.x + x, p.y + y, edge ? C.INK : C.GOLD_DK);
        }
      eachPixel(FONT3, p.text, p.x + 2, p.y + 2, function (x, y) {
        R.plot(f, x, y, C.CREAM);
      });
    });
  }

  function busy() {
    return false;
  }

  /* ------------------------------------------------------------------ DOM: zone title */
  var titleCanvas = null, titleRaf = 0;
  var TITLE_MS = 120;

  function hexOf(name) {
    var c = ROOM.art.palette.colors[C[name]];
    return c ? c[1] : '#000';
  }

  /** Show the current title (zone name, or on a phone the nearest zone), revealed in Bayer steps. */
  function updateTitle() {
    if (!titleCanvas) return;
    var title = currentTitle();
    if (title === titleText) return;
    titleText = title;
    titleT0 = performance.now();
    cancelAnimationFrame(titleRaf);
    if (!title) {
      titleCanvas.hidden = true;
      return;
    }
    var tw = textWidth(FONT5, title) + 1, th = 8;
    titleCanvas.width = tw;
    titleCanvas.height = th;
    var scale = Math.max(2, Math.round(3 * Math.min(1, window.innerWidth / 900)));
    titleCanvas.style.width = tw * scale + 'px';
    titleCanvas.style.height = th * scale + 'px';
    titleCanvas.setAttribute('aria-hidden', 'true');
    titleCanvas.hidden = false;
    var ctx = titleCanvas.getContext('2d');
    var cream = hexOf('CREAM'), dark = hexOf('VOID');
    var B = ROOM.render.BAYER;
    function frame() {
      var step = ROOM.state.reducedMotion ? 16 : Math.min(16, Math.floor((16 * (performance.now() - titleT0)) / TITLE_MS) + 4);
      ctx.clearRect(0, 0, tw, th);
      var put = function (col, ox) {
        ctx.fillStyle = col;
        eachPixel(FONT5, title, ox, ox, function (x, y) {
          if (B[(y & 3) * 4 + (x & 3)] < step) ctx.fillRect(x, y, 1, 1);
        });
      };
      put(dark, 1);
      put(cream, 0);
      if (step < 16) titleRaf = requestAnimationFrame(frame);
    }
    frame();
  }

  /* ------------------------------------------------------------------ DOM: hotspot buttons */
  var layer, dotsNav, live;
  var buttons = {}; // id -> button
  var builtVersion = -1;
  var lastKey = '';

  function isTouch() {
    return ROOM.input ? ROOM.input.touch : window.matchMedia('(pointer: coarse)').matches;
  }

  function zoneOfItem(it) {
    return ROOM.zoneById(it.zone) || ROOM.camera.zoneAtX(it.x, ROOM.zones);
  }

  /**
   * A click on an object: dolly into its zone (anticipation, push-in), spotlight pulse on landing,
   * then its panel slides in. The statue zooms to the window and switches its downlight on.
   */
  function activate(d) {
    var zone = zoneOfItem(d.item);
    if (!ROOM.state.zone && isTouch()) {
      ROOM.go(zone.id); // on touch: tap a zone first, then the hotspot
      return;
    }
    ROOM.emit('hotspot', { item: d.item });
    var statue = d.statue;
    var target = statue ? 'window' : zone.id;
    var opener = document.activeElement;
    ROOM.go(target, {
      item: d.id,
      onArrive: function () {
        if (statue) {
          ROOM.state.statueLight = true;
          ROOM.invalidate();
        }
        if (ROOM.ui && typeof ROOM.ui.open === 'function') ROOM.ui.open(d.id, { opener: opener });
      },
    });
  }

  // (Re)create the buttons when the scene changes; order them left to right by zone, then x.
  function build() {
    var R = ROOM.render;
    var hot = R.drawables.filter(function (d) {
      return d.hotspot;
    });
    hot.sort(function (a, b) {
      return zoneOfItem(a.item).n - zoneOfItem(b.item).n || a.hit[0] - b.hit[0];
    });
    var keep = {};
    hot.forEach(function (d) {
      var b = buttons[d.id];
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'hs';
        b.dataset.id = d.id;
        b.addEventListener('click', function () {
          var cur = findDrawable(b.dataset.id);
          if (cur) activate(cur);
        });
        b.addEventListener('pointerenter', function (e) {
          if (e.pointerType === 'mouse') ROOM.render.setHover(b.dataset.id);
        });
        b.addEventListener('pointerleave', function () {
          if (ROOM.render.hoverId === b.dataset.id) ROOM.render.setHover(null);
        });
        b.addEventListener('focus', function () {
          ROOM.render.setFocus(b.dataset.id);
        });
        b.addEventListener('blur', function () {
          if (ROOM.render.focusId === b.dataset.id) ROOM.render.setFocus(null);
        });
        buttons[d.id] = b;
      }
      b.dataset.zone = zoneOfItem(d.item).id;
      b.setAttribute('aria-label', nameOf(d));
      layer.appendChild(b); // appending in order sets the DOM (tab) order
      keep[d.id] = true;
    });
    Object.keys(buttons).forEach(function (id) {
      if (!keep[id]) {
        buttons[id].remove();
        delete buttons[id];
      }
    });
    builtVersion = R.sceneVersion;
  }

  function findDrawable(id) {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Position the buttons for the frame just drawn (rest = {org, z, offs, key}). */
  function sync(rest) {
    var R = ROOM.render;
    if (!layer) return;
    if (builtVersion !== R.sceneVersion) {
      build();
      lastKey = '';
    }
    var touch = isTouch();
    updateTitle();
    var key = rest.key + '|' + touch + '|' + ROOM.state.photo;
    if (key === lastKey) return;
    lastKey = key;
    var v = R.view, dpr = v.dpr, zone = ROOM.state.zone;
    var minSize = touch ? 44 : 24;
    var W = v.Wd / dpr, H = v.Hd / dpr;
    R.drawables.forEach(function (d) {
      var b = buttons[d.id];
      if (!b) return;
      var h = d.hit, o = rest.offs[d.layer];
      var left = ((h[0] + o) * rest.z - rest.org.ox) / dpr;
      var top = (h[1] * rest.z - rest.org.oy) / dpr;
      var w = (h[2] * rest.z) / dpr, hh = (h[3] * rest.z) / dpr;
      // Grow small targets around their centre.
      if (w < minSize) {
        left -= (minSize - w) / 2;
        w = minSize;
      }
      if (hh < minSize) {
        top -= (minSize - hh) / 2;
        hh = minSize;
      }
      var onScreen = left + w > 0 && top + hh > 0 && left < W && top < H;
      var usable = onScreen && !(touch && !zone) && !(zone && d.layer === 6);
      b.hidden = !usable;
      // In a zone, Tab walks that zone's hotspots only.
      b.tabIndex = usable && (!zone || b.dataset.zone === zone) ? 0 : -1;
      b.style.left = left.toFixed(2) + 'px';
      b.style.top = top.toFixed(2) + 'px';
      b.style.width = w.toFixed(2) + 'px';
      b.style.height = hh.toFixed(2) + 'px';
      // Nearer layer on top, then the smaller box.
      b.style.zIndex = String(d.layer * 1000 + Math.max(0, 999 - Math.round(Math.sqrt(w * hh))));
    });
  }

  function setHidden(hidden) {
    if (layer) layer.classList.toggle('moving', !!hidden);
  }

  /** The tabbable hotspot buttons of the current zone, in tab order. */
  function zoneButtons() {
    if (!layer) return [];
    return Array.prototype.filter.call(layer.querySelectorAll('button.hs'), function (b) {
      return !b.hidden && b.tabIndex === 0;
    });
  }

  /* ------------------------------------------------------------------ DOM: zone dots and live region */
  function buildDots() {
    dotsNav.innerHTML = '';
    ROOM.zones.forEach(function (z) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'zone-dot';
      b.dataset.zone = z.id;
      b.setAttribute('aria-label', titleCase(z.name) + ' (' + z.n + ')');
      b.addEventListener('click', function () {
        ROOM.go(ROOM.state.zone === z.id ? null : z.id);
      });
      dotsNav.appendChild(b);
    });
    updateDots();
  }
  function updateDots() {
    Array.prototype.forEach.call(dotsNav.children, function (b) {
      if (b.dataset.zone === ROOM.state.zone) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }

  function ensure(id, tag, parent, cls) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement(tag);
      el.id = id;
      if (cls) el.className = cls;
      parent.appendChild(el);
    }
    return el;
  }

  function init(stage) {
    layer = ensure('room-hotspots', 'div', stage);
    dotsNav = ensure('zone-dots', 'nav', document.body);
    dotsNav.setAttribute('aria-label', 'Zones');
    live = ensure('room-live', 'div', document.body, 'sr-only');
    titleCanvas = ensure('zone-title', 'canvas', document.body);
    titleCanvas.hidden = true;
    live.setAttribute('aria-live', 'polite');
    buildDots();
    ROOM.on('zone', function (d) {
      updateDots();
      updateTitle(); // within ~120 ms of the click, while the dolly runs
      var z = d.zone && ROOM.zoneById(d.zone);
      live.textContent = z ? titleCase(z.name) : 'Room';
    });
    ROOM.on('data', function () {
      builtVersion = -1;
    });
  }

  ROOM.overlay = {
    init: init,
    drawMarks: drawMarks,
    busy: busy,
    sync: sync,
    setHidden: setHidden,
    zoneButtons: zoneButtons,
    nameOf: nameOf,
    plateOf: plateOf,
    textWidth: function (text) {
      return textWidth(FONT3, text);
    },
  };
})();
