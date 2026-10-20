/* FORGE room prototype: keyboard, mouse and touch.
 *
 * Keyboard: 1-7 zones; Left/Right loop through zones; Enter steps in (or into the zone's first
 * hotspot); Esc steps out; Tab stays inside the current zone; hold Shift 200 ms (no other key) for
 * inspect; T today, P photo mode, ? help, D demo drawer.
 * Mouse: horizontal parallax from the pointer; a click on the room (not on an object) steps into the
 * zone under it.
 * Touch / pan mode: drag pans 1:1 with rubber-banded edges, a release flings (velocity from the last
 * 100 ms) and snaps to the nearest zone stop; a tap steps into the zone under the finger; in a zone a
 * horizontal swipe moves to the next zone.
 *
 * The key handler is registered from main.js (after the ui scripts), so ui handlers run first and can
 * claim a key with preventDefault().
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

  /** The zone to step into from the room view: the last one, the nearest pan stop, or the window. */
  function defaultZone() {
    var R = ROOM.render;
    if (R.view && R.view.mode === 'pan') return CAM.zoneAtX(R.pan.x, ROOM.zones).id;
    return R.lastZone || 'window';
  }

  function step(dir) {
    var n = ROOM.zones.length;
    var i = zoneIndex(ROOM.state.zone);
    if (i < 0) i = dir > 0 ? -1 : n; // from the room: Right starts at 1, Left at 7
    ROOM.go(ROOM.zones[(i + dir + n) % n].id);
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
    // An open panel or sheet owns the keyboard (the ui closes it on Esc).
    if (ROOM.state.panel) return;

    var k = e.key;
    if (k >= '1' && k <= '9' && +k <= ROOM.zones.length) {
      ROOM.go(ROOM.zones[+k - 1].id);
      e.preventDefault();
      return;
    }
    switch (k) {
      case 'ArrowRight':
        step(1);
        e.preventDefault();
        return;
      case 'ArrowLeft':
        step(-1);
        e.preventDefault();
        return;
      case 'Enter': {
        var a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && a !== document.body) return; // the button handles it
        if (!ROOM.state.zone) ROOM.go(defaultZone());
        else {
          var first = ROOM.overlay.zoneButtons()[0];
          if (first) first.focus();
        }
        e.preventDefault();
        return;
      }
      case 'Escape':
        if (ROOM.state.inspect) setInspect(false);
        else if (ROOM.state.photo) togglePhoto();
        else if (ROOM.state.zone) ROOM.go(null);
        else return;
        e.preventDefault();
        return;
      case 'Tab':
        trapTab(e);
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
    if (!ROOM.state.zone) return;
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
    if (e.pointerType === 'mouse') {
      touch = false;
      if (!drag) ROOM.render.setPointer(CAM.deflection(e.clientX, window.innerWidth));
    }
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
    var panning = !onHotspot && !ROOM.state.zone && R.view && R.view.mode === 'pan';
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
      var stops = ROOM.zones.map(function (z) {
        return z.stop;
      });
      R.pan.target = CAM.snapTarget(R.pan.x, vel, stops, CAM.panBounds(v));
      ROOM.invalidate();
    }
    if (d.onHotspot || d.moved) {
      if (d.moved && ROOM.state.zone && touch && !d.onHotspot) swipe(e.clientX - d.x0, e.clientY - d.y0);
      return;
    }
    // A tap or click on the room itself.
    if (e.target !== R.canvas && !(e.target.id === 'room-hotspots')) return;
    if (!ROOM.state.zone) {
      var rect = R.canvas.getBoundingClientRect();
      var w = R.worldFromCss(e.clientX - rect.left, e.clientY - rect.top);
      ROOM.go(CAM.zoneAtX(w.x, ROOM.zones).id);
    }
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
        ROOM.render.pan.target = CAM.snapTarget(ROOM.render.pan.x, 0, ROOM.zones.map(function (z) {
          return z.stop;
        }), CAM.panBounds(ROOM.render.view));
        ROOM.invalidate();
      }
      drag = null;
    }
  }

  // Trackpads and wheels pan in pan mode, then snap after a short pause.
  var wheelTimer = 0;
  function onWheel(e) {
    var R = ROOM.render;
    if (!R.view || R.view.mode !== 'pan' || ROOM.state.zone) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    var b = CAM.panBounds(R.view);
    R.pan.target = null;
    R.pan.x = CAM.clamp(R.pan.x + (d * R.view.dpr) / R.restCamera().z, b.min, b.max);
    ROOM.invalidate();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () {
      R.pan.target = CAM.snapTarget(R.pan.x, 0, ROOM.zones.map(function (z) {
        return z.stop;
      }), b);
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
    document.documentElement.addEventListener('mouseleave', function () {
      ROOM.render.setPointer(0);
    });
  }

  ROOM.input = {
    init: init,
    get touch() {
      return touch;
    },
  };
})();
