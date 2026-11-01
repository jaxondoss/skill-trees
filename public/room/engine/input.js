/* FORGE room prototype: keyboard, mouse and touch (v3.5 input map, PLAN 2.3). Every move goes through the
 * navigator (ROOM.nav.request); relative inputs (next zone, turn) resolve against nav.target, so a press during a
 * move counts from where the move is going.
 *
 * Keyboard: 1-8 step into a zone (overview: descend into it); Left/Right turn on a wall, walk the zones in a zone
 * (global order, across walls); Up rises to the overview (from a skill view: closes it and rises); Down or Esc in
 * the overview goes back; Enter steps in (wall: default zone; zone: first hotspot; overview: back); Esc steps out
 * (inspect > photo > zone); Tab stays inside the current zone; hold Shift 200 ms for inspect; L lists the
 * overview's items; T today, P photo mode, ? help, D demo drawer.
 * Mouse: a click on the room (not on an object) steps into the zone under it; in the overview, into the zone
 * under it (overview.placeAt). Clicks and taps during a move are ignored.
 * Touch / pan mode: drag pans 1:1 with rubber-banded edges, a release flings and snaps to the nearest zone stop of
 * this wall; a tap steps into the zone under the finger; in a zone a horizontal swipe moves to the next zone; in
 * the overview a tap picks the nearest item (A3).
 *
 * The key handler is registered from main.js (after the ui scripts), so ui handlers run first and can claim a key
 * with preventDefault() (the Today HUD rows claim Up/Down).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var CAM = ROOM.camera;

  var SHIFT_HOLD_MS = 200;
  var shiftTimer = 0;
  var touch = false;
  try {
    touch = window.matchMedia('(pointer: coarse)').matches;
  } catch (e) {
    /* assume a mouse */
  }

  function zoneIndex(id) {
    for (var i = 0; i < ROOM.zones.length; i++) if (ROOM.zones[i].id === id) return i;
    return -1;
  }

  function nav() {
    return ROOM.nav;
  }
  function tgt() {
    return ROOM.nav.target || {};
  }
  function goZone(id) {
    return nav().request({ mode: 'zone', zone: id }, { source: 'key' });
  }

  /** The zone to step into from a wall: the last one on this wall, the nearest pan stop, or the window. */
  function defaultZone() {
    var R = ROOM.render;
    var v = tgt().view || ROOM.state.view;
    var zs = ROOM.zonesInView(v);
    if (R.view && R.view.mode === 'pan') return CAM.zoneAtX(R.pan.x, zs).id;
    var last = R.lastZone && ROOM.zoneById(R.lastZone);
    if (last && ROOM.viewOf(last) === ROOM.normView(v)) return last.id;
    return zs.length ? (zs.filter(function (z) { return z.id === 'window'; })[0] || zs[0]).id : 'window';
  }

  /** The previous / next zone in the global order (it may be on another wall). */
  function step(dir) {
    var n = ROOM.zones.length;
    var i = zoneIndex(tgt().zone);
    if (i < 0) i = dir > 0 ? -1 : n;
    goZone(ROOM.zones[(i + dir + n) % n].id);
  }

  function setInspect(on) {
    if (ROOM.state.inspect === on) return;
    ROOM.state.inspect = on;
    ROOM.emit('state', {});
  }
  function cancelShift() {
    clearTimeout(shiftTimer);
    shiftTimer = 0;
  }

  function togglePhoto() {
    ROOM.state.photo = !ROOM.state.photo;
    document.body.classList.toggle('photo', ROOM.state.photo);
    ROOM.emit('state', {});
  }

  function callUi(name) {
    var fn = ROOM.ui && ROOM.ui[name];
    if (typeof fn === 'function') fn.call(ROOM.ui);
  }

  function typing(t) {
    if (!t || !t.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
  }

  function onKeyDown(e) {
    if (e.key === 'Shift') {
      if (!e.repeat && !shiftTimer && !ROOM.state.inspect) {
        shiftTimer = setTimeout(function () {
          shiftTimer = 0;
          setInspect(true);
        }, SHIFT_HOLD_MS);
      }
      return;
    }
    // Any other key cancels a Shift hold (Shift+Tab must not open inspect).
    cancelShift();
    if (ROOM.state.inspect && e.key !== 'Escape') setInspect(false);
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target)) return;
    var k = e.key;
    var t = tgt();
    // An open panel or sheet owns the keyboard (the ui closes it on Esc), except Up: close and rise (A9).
    if (ROOM.state.panel) {
      if (k === 'ArrowUp' && t.mode === 'skill' && nav().overviewOn()) {
        nav().up();
        e.preventDefault();
      }
      return;
    }
    var over = t.mode === 'overview';
    if (k >= '1' && k <= '9' && +k <= ROOM.zones.length) {
      if (t.mode !== 'skill') goZone(ROOM.zones[+k - 1].id);
      e.preventDefault();
      return;
    }
    switch (k) {
      case 'ArrowUp':
        if (nav().up()) e.preventDefault();
        return;
      case 'ArrowDown':
        if (over && nav().down()) e.preventDefault();
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        // On a wall the arrows turn; in a zone they walk the zones; in the overview they do nothing (A1).
        var dir = k === 'ArrowRight' ? 1 : -1;
        if (over) return;
        if (t.mode === 'zone') step(dir);
        else if (t.mode === 'wall') nav().turn(dir);
        e.preventDefault();
        return;
      }
      case 'Enter': {
        var a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && a !== document.body) return; // the button handles it
        if (over) nav().down();
        else if (t.mode === 'wall') goZone(defaultZone());
        else {
          var first = ROOM.overlay.zoneButtons()[0];
          if (first) first.focus();
        }
        e.preventDefault();
        return;
      }
      case 'Escape':
        if (over) nav().down();
        else if (ROOM.state.inspect) setInspect(false);
        else if (ROOM.state.photo) togglePhoto();
        else if (t.mode === 'zone' || t.mode === 'skill') nav().back();
        else return;
        e.preventDefault();
        return;
      case 'Tab':
        trapTab(e);
        return;
      case 'l':
      case 'L':
        if (over && ROOM.overview && ROOM.overview.toggleList) {
          ROOM.overview.toggleList();
          e.preventDefault();
        }
        return;
      case 't':
      case 'T':
        callUi('toggleToday');
        e.preventDefault();
        return;
      case 'p':
      case 'P':
        togglePhoto();
        e.preventDefault();
        return;
      case '?':
        callUi('toggleHelp');
        e.preventDefault();
        return;
      case 'd':
      case 'D':
        callUi('toggleDrawer');
        e.preventDefault();
        return;
    }
  }

  // In a zone, Tab and Shift+Tab cycle through that zone's hotspots and wrap.
  function trapTab(e) {
    if (tgt().mode !== 'zone') return;
    var list = ROOM.overlay.zoneButtons();
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    if (i < 0 && !document.activeElement.closest('#room-hotspots')) {
      // Focus is elsewhere (a ui control): let the browser move it normally.
      if (document.activeElement !== document.body) return;
    }
    var next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i < 0 || i === list.length - 1 ? 0 : i + 1;
    list[next].focus();
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') {
      cancelShift();
      setInspect(false);
    }
  }

  /* ------------------------------------------------------------------ pointer */
  var drag = null; // {id, x0, y0, t0, pan0, samples: [{t, x}], moved}
  var TAP_PX = 8;

  function onPointerMove(e) {
    if (e.pointerType === 'mouse') touch = false;
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (Math.abs(dx) > TAP_PX || Math.abs(dy) > TAP_PX) drag.moved = true;
    var R = ROOM.render, v = R.view;
    if (drag.panning) {
      var b = CAM.panBounds(v);
      var z = R.restCamera().z;
      // 1:1 drag: CSS px -> device px -> world px.
      R.pan.x = CAM.rubberBand(drag.pan0 - (dx * v.dpr) / z, b.min, b.max);
      var now = ROOM.now();
      drag.samples.push({ t: now, x: R.pan.x });
      while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
      var s0 = drag.samples[0];
      R.pan.v = now > s0.t ? ((R.pan.x - s0.x) * 1000) / (now - s0.t) : 0;
      ROOM.invalidate();
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    touch = e.pointerType !== 'mouse';
    var onHotspot = e.target.closest && e.target.closest('button.hs');
    var R = ROOM.render;
    var panning = !onHotspot && tgt().mode === 'wall' && !nav().busy && R.view && R.view.mode === 'pan';
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: ROOM.now(), pan0: R.pan.x, samples: [], moved: false, panning: panning, onHotspot: !!onHotspot };
    if (panning) {
      R.pan.dragging = true;
      R.pan.target = null;
      R.pan.v = 0;
      drag.samples.push({ t: drag.t0, x: R.pan.x });
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {
        /* not capturable: fine */
      }
    }
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    var R = ROOM.render, v = R.view;
    if (d.panning) {
      R.pan.dragging = false;
      var now = ROOM.now();
      // Only movement in the last 100 ms counts toward the fling.
      var recent = d.samples.filter(function (s) {
        return now - s.t <= 100;
      });
      var vel = 0;
      if (recent.length >= 2) {
        var a = recent[0], b = recent[recent.length - 1];
        vel = b.t > a.t ? ((b.x - a.x) * 1000) / (b.t - a.t) : 0;
      }
      R.pan.v = vel;
      R.pan.target = CAM.snapTarget(R.pan.x, vel, CAM.zoneStops(ROOM.zonesInView()), CAM.panBounds(v));
      ROOM.invalidate();
    }
    if (d.onHotspot || d.moved) {
      if (d.moved && tgt().mode === 'zone' && touch && !d.onHotspot && !nav().busy) swipe(e.clientX - d.x0, e.clientY - d.y0);
      return;
    }
    // A tap or click on the room itself (ignored while the room moves: the thing under the pointer is moving).
    if (e.target !== R.canvas && !(e.target.id === 'room-hotspots')) return;
    if (nav().busy) return;
    var rect = R.canvas.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    var t = tgt();
    if (t.mode === 'overview') {
      // A3: a tap picks the nearest item centre within reach (touch), else the zone under it
      var hit = touch ? nearestOverviewItem(cx, cy) : null;
      if (hit) {
        nav().request({ mode: 'skill', item: hit }, { source: 'overview' });
        return;
      }
      var p = ROOM.overview && ROOM.overview.placeAt ? ROOM.overview.placeAt(cx, cy) : null;
      if (p) nav().request(p, { source: 'overview' });
      return;
    }
    if (t.mode === 'wall') {
      var w = R.worldFromCss(cx, cy);
      goZone(CAM.zoneAtX(w.x, ROOM.zonesInView(t.view)).id);
    }
  }

  // The overview item whose hit-box centre is nearest the tap (CSS px, canvas-relative), within 32 CSS px.
  function nearestOverviewItem(x, y) {
    var R = ROOM.render, best = null, bd = 32 * 32;
    R.drawables.forEach(function (d) {
      if (!d.hotspot || !d.item.of) return;
      var r = R.cssRectOf(d);
      var dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
      var dd = dx * dx + dy * dy;
      if (dd < bd || (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height && dd < bd * 4)) {
        bd = Math.min(bd, dd);
        best = d.item.of;
      }
    });
    return best;
  }

  // In a zone on touch: a horizontal swipe moves to the neighbouring zone.
  function swipe(dx, dy) {
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    step(dx < 0 ? 1 : -1);
  }

  function onPointerCancel(e) {
    if (drag && e.pointerId === drag.id) {
      if (drag.panning) {
        ROOM.render.pan.dragging = false;
        ROOM.render.pan.target = CAM.snapTarget(ROOM.render.pan.x, 0, CAM.zoneStops(ROOM.zonesInView()), CAM.panBounds(ROOM.render.view));
        ROOM.invalidate();
      }
      drag = null;
    }
  }

  // Trackpads and wheels pan in pan mode, then snap after a short pause.
  var wheelTimer = 0;
  function onWheel(e) {
    var R = ROOM.render;
    if (!R.view || R.view.mode !== 'pan' || tgt().mode !== 'wall' || nav().busy) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    var b = CAM.panBounds(R.view);
    R.pan.target = null;
    R.pan.x = CAM.clamp(R.pan.x + (d * R.view.dpr) / R.restCamera().z, b.min, b.max);
    ROOM.invalidate();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () {
      R.pan.target = CAM.snapTarget(R.pan.x, 0, CAM.zoneStops(ROOM.zonesInView()), b);
      ROOM.invalidate();
    }, 140);
    e.preventDefault();
  }

  function init(stage) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () {
      cancelShift();
      setInspect(false);
    });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    stage.addEventListener('wheel', onWheel, { passive: false });
  }

  ROOM.input = {
    init: init,
    get touch() {
      return touch;
    },
  };
})();
