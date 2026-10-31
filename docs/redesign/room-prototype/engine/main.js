/* FORGE room prototype: boot and routing.
 *
 * Routes mirror the app's /room/[[...zone]] (PLAN 2.2): the bare base path is the front wall, /room/right|back|left
 * the other walls, /room/<zone> a zone, /room/overview the overview, /room/<zone>/<item> an item's skill view (the
 * item's own zone: library.chess stands in the window zone, so /room/window/chess). The navigator (engine/nav.js)
 * owns history: one entry per move, pushed at its start; Back animates to the previous place. Without
 * window.ROOM_ROUTE (the static prototype) routes live in the hash. Loaded last, after the ui scripts.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;

  // Path routing (the app sets window.ROOM_ROUTE = {base: '/'} or {base: '/room'}); else the hash.
  var PATH = window.ROOM_ROUTE || null;
  function src() {
    return PATH ? window.location.pathname : window.location.hash || '';
  }

  function boot() {
    var stage = document.getElementById('room-stage');
    var canvas = document.getElementById('room-canvas');
    ROOM.render.init(canvas, stage);
    ROOM.overlay.init(stage);
    ROOM.input.init(stage);
    document.body.classList.toggle('photo', !!ROOM.state.photo);
    if (ROOM.weather) ROOM.weather.init();
    if (!/[?&]gl=off\b/.test(window.location.search)) ROOM.render.enableGpu();
    // the overview path is reserved: no zone or wall may use it
    if (ROOM.zoneById('overview') || ROOM.viewList().indexOf('overview') >= 0) throw new Error('room: "overview" is a reserved route');
    // Initial route: land straight on the URL's place (a skill deep link opens its board), no move.
    ROOM.nav.boot(src());
    window.addEventListener('popstate', function () {
      ROOM.nav.route(src());
    });

    ROOM.debug = {
      /** The device canvas pixels (ImageData) as last drawn. */
      readFrame: function () {
        return ROOM.render.readFrame();
      },
      /** Engine internals: view, camera, dolly progress, lighting step, phone-pan depth offsets, pan. */
      get state() {
        return ROOM.render.debugInfo();
      },
      /** Freeze the engine clock, step it, and draw a frame synchronously (for tests). */
      freeze: function () {
        ROOM.clock.freeze();
      },
      advance: function (ms) {
        ROOM.clock.advance(ms);
        ROOM.render.renderNow();
      },
      thaw: function () {
        ROOM.clock.thaw();
        ROOM.invalidate();
      },
      renderNow: function () {
        ROOM.render.renderNow();
      },
      /** The palette as [[r, g, b], ...] for frame checks. */
      palette: ROOM.render.RGB,
    };
    ROOM.emit('ready', {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
