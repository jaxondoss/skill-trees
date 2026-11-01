/* FORGE room v3.5: the overview (D2-FINAL, PLAN 2.4 / 3.6, amendments A1 and A3).
 *
 * A fixed north-up "lid off" dollhouse of the whole room (art: art/room-r6/overview.py -> zones.views.top and the
 * top.* items). The navigator (nav.js) owns the move (RISE / DESCEND) and the place; this file supplies:
 *   camera(Wd, Hd, dpr, zRoom) -> {z, ox, oy}   integer zoom and device-px origin (world = (device + o) / z)
 *   snapshot(ls)                                the overview frame through render.snap (scene 'top')
 *   anchor(place) -> {x, y, w, h}               the overview rect a wall's or zone's rest framing covers
 *   placeAt(xCss, yCss) -> Place | null         item under the pointer -> its skill place, floor -> zone, else null
 *   heading                                     the wall the overview returns to (nav.place.ret.view)
 *   toggleList(), onEnter(), onLeave()          the pick list (#overview-list) and the hint / LIST plates
 * and the mark pass 'heading': a you-are-here diamond at the room centre with a checker wedge toward that wall
 * (static: A1 drops the heading move and its flash).
 * Pure helpers (fitCamera, anchorOf, inPoly, placeFor) are exported for vitest (tests/unit/room-overview.test.ts).
 */
(function () {
  var TITLE_CSS = 100; // the title plate and #nav-up end here (D2 2.2)
  var HINT_CSS = 52; // the hint row at the bottom
  var SIDE_CSS = 15;
  var PHONE_TOP_CSS = 140;
  var PHONE_MAX_CSS = 700; // a viewport narrower than this is laid out as a phone

  /**
   * D2 2.2: z = the room's integer zoom, dropped by whole steps until the core fits the safe box; a phone shows the
   * whole diorama at 1 CSS px per art px (z = dpr). Returns {z, ox, oy}: integer zoom and integer device origin.
   */
  function fitCamera(Wd, Hd, dpr, zRoom, core) {
    dpr = dpr || 1;
    var cw = core ? core[2] : 360, ch = core ? core[3] : 300;
    var phone = Wd / dpr < PHONE_MAX_CSS;
    var z, x, y;
    if (phone) {
      z = Math.max(1, Math.round(dpr));
      while (z > 1 && cw * z > Wd - 2 * SIDE_CSS * dpr) z--;
      x = Math.floor((Wd - cw * z) / 2);
      y = Math.round(PHONE_TOP_CSS * dpr);
      if (y + ch * z > Hd) y = Math.max(0, Hd - ch * z);
    } else {
      z = Math.max(1, Math.round(zRoom || 2));
      var top = Math.round(TITLE_CSS * dpr), bottom = Hd - Math.round(HINT_CSS * dpr);
      while (z > 1 && (cw * z > Wd - 2 * SIDE_CSS * dpr || ch * z > bottom - top)) z--;
      x = Math.floor((Wd - cw * z) / 2);
      y = top + Math.max(0, Math.floor((bottom - top - ch * z) / 2));
    }
    return { z: z, ox: -x, oy: -y, phone: phone };
  }

  /** The overview rect of a place: its zone's anchor, else its wall's (a skill place uses its zone, then wall). */
  function anchorOf(anchors, place) {
    if (!anchors || !place) return null;
    var a = (place.zone && anchors[place.zone]) || (place.baseZone && anchors[place.baseZone]) || anchors[place.view];
    if (place.mode === 'wall' || place.mode === 'overview') a = anchors[place.view] || a;
    return a ? { x: a[0], y: a[1], w: a[2], h: a[3] } : null;
  }

  function inPoly(poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /**
   * Pure placeAt core. items: [{of, hit:[x,y,w,h], layer}] (overview px); reach: extra px around each hit box.
   * An item whose (grown) box holds the point wins; ties go to the nearest centre, then the smaller box (A3, D2 2.6).
   * Else the floor territory cell under the point names a zone; outside the room outline: null.
   * Returns {item} | {zone} | null.
   */
  function placeFor(top, items, x, y, reach) {
    reach = reach || 0;
    var best = null, bd = Infinity, ba = Infinity;
    for (var i = 0; i < items.length; i++) {
      var h = items[i].hit;
      if (!h) continue;
      if (x < h[0] - reach || x > h[0] + h[2] + reach || y < h[1] - reach || y > h[1] + h[3] + reach) continue;
      var dx = h[0] + h[2] / 2 - x, dy = h[1] + h[3] / 2 - y, d = dx * dx + dy * dy, a = h[2] * h[3];
      if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && a < ba)) {
        best = items[i];
        bd = d;
        ba = a;
      }
    }
    if (best) return { item: best.of };
    var terr = top && top.territory;
    if (!terr || !terr.room || !inPoly(terr.room, x, y)) return null;
    var cells = terr.cells || [];
    for (var k = 0; k < cells.length; k++) if (inPoly(cells[k].poly, x, y)) return { zone: cells[k].zone };
    // between cells (the raster hull leaves seams): the nearest zone anchor centre
    var an = top.anchors || {}, bz = null, bzd = Infinity;
    cells.forEach(function (c) {
      var a = an[c.zone];
      if (!a) return;
      var ddx = a[0] + a[2] / 2 - x, ddy = a[1] + a[3] / 2 - y, dd = ddx * ddx + ddy * ddy;
      if (dd < bzd) {
        bzd = dd;
        bz = c.zone;
      }
    });
    return bz ? { zone: bz } : null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fitCamera: fitCamera, anchorOf: anchorOf, inPoly: inPoly, placeFor: placeFor };
  }
  if (typeof window === 'undefined' || !window.ROOM) return;

  /* ------------------------------------------------------------------ runtime */
  var ROOM = window.ROOM;
  function topConf() {
    var z = ROOM.art && ROOM.art.zones;
    return (z && z.views && z.views.top) || null;
  }
  function coreOf(t) {
    var c = t && t.core;
    return c ? (Array.isArray(c) ? c : [0, 0, c.w, c.h]) : [0, 0, 360, 300];
  }

  function camera(Wd, Hd, dpr, zRoom) {
    var t = topConf();
    if (!t) return null;
    var c = fitCamera(Wd, Hd, dpr, zRoom, coreOf(t));
    return { z: c.z, ox: c.ox, oy: c.oy };
  }

  function anchor(place) {
    var t = topConf();
    return t ? anchorOf(t.anchors, place) : null;
  }

  function twins() {
    return (ROOM.art.items || []).filter(function (it) {
      return it.view === 'top' && it.kind === 'hotspot' && it.of;
    });
  }

  function placeAt(xCss, yCss) {
    var t = topConf(), R = ROOM.render;
    if (!t || !R || !R.worldFromCss || !R.view) return null;
    var w = R.worldFromCss(xCss, yCss);
    var cam = R.restCamera ? R.restCamera() : null;
    var z = cam ? cam.z : 2, dpr = R.view.dpr || 1;
    // the overlay grows every target to 44 CSS px: the same reach here (in overview px)
    var reach = Math.max(0, (22 * dpr) / z - 4);
    var hit = placeFor(t, twins(), w.x, w.y, reach);
    if (!hit) return null;
    if (hit.item) {
      var it = ROOM.itemById ? ROOM.itemById(hit.item) : null;
      if (it && it.target && it.target.feature === 'calendar') return { mode: 'zone', zone: 'calendar', view: 'back' };
      return { mode: 'skill', item: hit.item };
    }
    var zn = ROOM.zoneById ? ROOM.zoneById(hit.zone) : null;
    return zn ? { mode: 'zone', zone: zn.id, view: zn.view } : null;
  }

  function snapshot(ls) {
    var R = ROOM.render, t = topConf();
    if (!R || !R.snap || !t) return null;
    var c = coreOf(t), cam = R.restCamera ? R.restCamera() : null;
    return R.snap({ mode: 'overview' }, ls || {}, { x: c[0], y: c[1], w: c[2], h: c[3] }, cam ? cam.z : 2);
  }

  function retView() {
    var n = ROOM.nav, p = n && (n.target || n.place);
    return p && p.mode === 'overview' && p.ret ? ROOM.normView(p.ret.view) : null;
  }

  /* ---- the you-are-here marker (mark pass 'heading') */
  var WEDGE = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
  function drawHeading(f, ls) {
    if (!ls || ls.scene !== 'top') return;
    var t = topConf(), v = retView();
    if (!t || !t.anchors || !v) return;
    var R = ROOM.render, C = ROOM.C;
    var sun = C.SUN, ink = C.INK;
    if (sun == null || ink == null) return;
    var cen = t.marker || centreOf(t);
    var cx = cen[0] - f.x0, cy = cen[1] - f.y0, dep = 250;
    // a 50 % checker wedge on the floor toward the wall Down returns to (9 px long, widening)
    var d = WEDGE[v] || [0, -1];
    for (var s = 3; s <= 11; s++) {
      var half = Math.floor((s - 2) / 2);
      for (var q = -half; q <= half; q++) {
        var x = cx + d[0] * s + (d[0] ? 0 : q), y = cy + d[1] * s + (d[1] ? 0 : q);
        if ((x + y) % 2 === 0) R.plotMark(f, x, y, sun, dep);
      }
    }
    // the 5 px diamond: SUN core, INK rim
    for (var dy = -3; dy <= 3; dy++) {
      for (var dx = -3; dx <= 3; dx++) {
        var m = Math.abs(dx) + Math.abs(dy);
        if (m <= 2) R.plotMark(f, cx + dx, cy + dy, sun, dep);
        else if (m === 3) R.plotMark(f, cx + dx, cy + dy, ink, dep);
      }
    }
  }
  function centreOf(t) {
    // the room centre on the floor (the art exports it; the middle of the front and back anchors otherwise)
    var f = t.anchors.front, b = t.anchors.back;
    return f && b ? [Math.round(f[0] + f[2] / 2), Math.round((f[1] + f[3] + b[1]) / 2)] : [180, 150];
  }

  /* ---- DOM: the pick list, the hint and LIST plates */
  var list = null, hint = null, listBtn = null, listOpen = false, visits = 0;
  var STATE_WORD = { full: 'logged today', half: 'started', top: 'top priority', pending: 'open goal', neglect: 'dusty', off: '' };
  function titleCase(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/(^|\s)\S/g, function (c) {
        return c.toUpperCase();
      });
  }
  function stateOf(it) {
    var sk = ROOM.skillOf ? ROOM.skillOf(it) : null;
    var slug = sk && (sk.slug || sk.id);
    var ms = ROOM.markStateOf && slug ? ROOM.markStateOf(slug) : null;
    if (ms && STATE_WORD[ms] != null) return { word: STATE_WORD[ms], swatch: ms === 'full' ? 'gold' : ms === 'neglect' ? 'dusty' : 'cream' };
    var v = ROOM.variantOf ? ROOM.variantOf(it) : null;
    var m = /^s(\d)$/.exec(v || '');
    if (m) return { word: 'stage ' + (Number(m[1]) + 1), swatch: 'cream' };
    if (v === 'alert') return { word: 'needs a look', swatch: 'gold' };
    return { word: '', swatch: 'cream' };
  }
  function labelOf(room) {
    return titleCase(room.label || room.id.split('.').pop());
  }
  function activate(id) {
    var it = ROOM.itemById ? ROOM.itemById(id) : null;
    if (!it || !ROOM.nav) return;
    if (it.target && it.target.feature === 'calendar') ROOM.nav.request({ mode: 'zone', zone: 'calendar', view: 'back' }, { source: 'overview' });
    else ROOM.nav.request({ mode: 'skill', item: id }, { source: 'overview', opener: document.activeElement });
  }
  function buildList() {
    if (!list) {
      list = document.createElement('nav');
      list.id = 'overview-list';
      list.setAttribute('aria-label', 'Room items');
      list.hidden = true;
      (document.getElementById('room-stage') || document.body).appendChild(list);
      list.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-of]');
        if (b) activate(b.getAttribute('data-of'));
      });
      list.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
    }
    var zones = (ROOM.zones || []).slice();
    var tw = twins();
    var html = [];
    zones.forEach(function (z) {
      var rows = tw.filter(function (t) {
        var r = ROOM.itemById(t.of);
        return r && r.zone === z.id;
      });
      if (!rows.length) return;
      rows.sort(function (a, b) {
        return a.x - b.x;
      });
      html.push('<h3 class="ovl-zone">' + titleCase(z.name) + '</h3>');
      rows.forEach(function (t) {
        var r = ROOM.stateItem ? ROOM.stateItem(t) : ROOM.itemById(t.of);
        var s = stateOf(r);
        html.push(
          '<button type="button" class="ovl-row" data-of="' + t.of + '">' +
            '<span class="ovl-swatch is-' + s.swatch + '" aria-hidden="true"></span>' +
            '<span class="ovl-name">' + labelOf(r) + '</span>' +
            (s.word ? '<span class="ovl-state">' + s.word + '</span>' : '') +
            '</button>'
        );
      });
    });
    list.innerHTML = html.join('');
  }
  function isPhone() {
    var R = ROOM.render;
    return R && R.view ? R.view.Wd / (R.view.dpr || 1) < PHONE_MAX_CSS : window.innerWidth < PHONE_MAX_CSS;
  }
  function placeList() {
    if (!list) return;
    var R = ROOM.render;
    list.classList.toggle('is-phone', isPhone());
    if (isPhone() && R && R.view) {
      var c = camera(R.view.Wd, R.view.Hd, R.view.dpr, 1);
      var t = topConf(), core = coreOf(t);
      var bottom = (core[3] * c.z - c.oy) / (R.view.dpr || 1);
      list.style.top = Math.round(bottom + 12) + 'px';
    } else list.style.top = '';
    list.hidden = !(isPhone() || listOpen);
  }
  function plates() {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'overview-hint';
      hint.className = 'ov-plate';
      hint.textContent = 'DOWN OR ESC ROOM   TAB ITEMS';
      hint.setAttribute('aria-hidden', 'true');
      listBtn = document.createElement('button');
      listBtn.type = 'button';
      listBtn.id = 'overview-listbtn';
      listBtn.className = 'ov-plate';
      listBtn.textContent = 'LIST';
      listBtn.setAttribute('aria-controls', 'overview-list');
      listBtn.setAttribute('aria-expanded', 'false');
      listBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleList();
      });
      listBtn.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
      var host = document.getElementById('room-stage') || document.body;
      host.appendChild(hint);
      host.appendChild(listBtn);
    }
    hint.hidden = visits > 3 || isPhone();
    listBtn.hidden = isPhone();
  }

  function toggleList(on) {
    if (!retView()) return;
    listOpen = on != null ? !!on : !listOpen;
    if (listBtn) listBtn.setAttribute('aria-expanded', String(listOpen || isPhone()));
    buildList();
    placeList();
    if (listOpen && list && !isPhone()) {
      var b = list.querySelector('button');
      if (b) b.focus();
    }
  }
  function onEnter() {
    visits++;
    buildList();
    plates();
    placeList();
    if (listBtn) listBtn.setAttribute('aria-expanded', String(listOpen || isPhone()));
    document.documentElement.classList.add('room-overview');
  }
  function onLeave() {
    if (list) list.hidden = true;
    if (hint) hint.hidden = true;
    if (listBtn) listBtn.hidden = true;
    listOpen = false;
    document.documentElement.classList.remove('room-overview');
  }
  // state changes (a log, a stage) refresh the rows' state words while the overview is up
  if (ROOM.on) {
    ROOM.on('state', function () {
      if (retView() && list && !list.hidden) buildList();
    });
    ROOM.on('resize', function () {
      if (retView()) {
        plates();
        placeList();
      }
    });
  }
  window.addEventListener('resize', function () {
    if (retView()) {
      plates();
      placeList();
    }
  });

  if (ROOM.render && ROOM.render.addMarkPass) ROOM.render.addMarkPass('heading', drawHeading);

  ROOM.overview = {
    camera: camera,
    snapshot: snapshot,
    anchor: anchor,
    placeAt: placeAt,
    get heading() {
      return retView();
    },
    toggleList: toggleList,
    onEnter: onEnter,
    onLeave: onLeave,
    fitCamera: fitCamera,
    placeFor: placeFor,
  };
})();
