/* FORGE room v3.5: the navigator (ROOM.nav). W0 STUB: the contract of PLAN 2.4 over the legacy movers.
 *
 * Place = {mode: 'wall'|'zone'|'overview'|'skill', view, zone, item, base, ret}. In this stub the place is read
 * from ROOM.state (wall or zone), request() delegates to ROOM.go / ROOM.turnTo / ROOM.ui.open, busy mirrors the
 * legacy dolly and turn, and ls() is render.js's legacy LightState builder. The nav package (P1) replaces it.
 */
(function () {
  var ROOM = window.ROOM;

  function placeNow() {
    var st = ROOM.state || {};
    var view = ROOM.normView(st.view);
    if (st.zone) return { mode: 'zone', view: view, zone: st.zone, item: null, base: null, ret: null };
    return { mode: 'wall', view: view, zone: null, item: null, base: null, ret: null };
  }

  function busy() {
    var R = ROOM.render;
    return !!(R && (R.dolly || R.turning));
  }

  function request(place, opts) {
    opts = opts || {};
    if (!place) return false;
    var legacy = { instant: !!opts.instant, push: opts.history !== false };
    if (place.mode === 'skill') {
      if (!place.item || !ROOM.ui || typeof ROOM.ui.open !== 'function') return false;
      ROOM.ui.open(place.item, { opener: opts.opener });
      return true;
    }
    if (place.mode === 'zone') return ROOM.go(place.zone, legacy);
    if (place.mode === 'wall') {
      var cur = ROOM.normView(ROOM.state.view);
      var v = ROOM.normView(place.view || cur);
      if (v !== cur) return ROOM.turnTo(v, legacy);
      return ROOM.state.zone ? ROOM.go(null, legacy) : false;
    }
    return false; // overview: not in the stub
  }

  function whenIdle() {
    return new Promise(function (resolve) {
      (function wait() {
        if (!busy()) resolve();
        else setTimeout(wait, 16);
      })();
    });
  }

  ROOM.nav = {
    get place() {
      return placeNow();
    },
    get target() {
      return null;
    },
    get busy() {
      return busy();
    },
    ls: function () {
      return ROOM.render && ROOM.render.legacyLs ? ROOM.render.legacyLs() : null;
    },
    request: request,
    up: function () {
      return false;
    },
    down: function () {
      return false;
    },
    back: function () {
      return false;
    },
    heading: function () {
      return false;
    },
    whenIdle: whenIdle,
  };
})();
