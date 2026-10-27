/* FORGE room prototype: boot and hash routing.
 *
 * Routes mirror the app's /room/[[...zone]]: #/room is the whole room (front view), #/room/<zone> a zone, and
 * #/room/right, #/room/back, #/room/left the other three views (art pass 6: every view keeps its own URL).
 * Every step in or out pushes a history entry, so the browser Back button walks back through zones.
 * Loaded last, after the ui scripts.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;

  // Path routing (the app sets window.ROOM_ROUTE = {base: '/'} or {base: '/room'}): /room/<zone> is a zone and
  // the base path is the whole room. Without it (the static prototype) routes live in the hash.
  var PATH = window.ROOM_ROUTE || null;
  function zoneFromHash() {
    var src = PATH ? window.location.pathname : window.location.hash || '';
    var m = PATH ? /^\/room(?:\/([a-z-]+))?\/?$/.exec(src) || (src === '/' ? ['/', ''] : null) : /^#\/room(?:\/([a-z-]+))?/.exec(src);
    if (!m) return { valid: false, zone: null, view: null };
    if (m[1] && m[1] !== 'front' && ROOM.viewList().indexOf(m[1]) >= 0) return { valid: true, zone: null, view: m[1] };
    var z = m[1] && ROOM.zoneById(m[1]);
    return { valid: !m[1] || !!z, zone: z ? z.id : null, view: z ? ROOM.viewOf(z) : 'front' };
  }
  /** The URL of a zone, or with no zone of the view on screen (the front view is the bare base path). */
  function hashFor(zone, view) {
    view = ROOM.normView(view === undefined ? ROOM.state.view : view);
    var seg = zone || (view !== 'front' ? view : '');
    if (PATH) return (seg ? '/room/' + seg : PATH.base || '/room') + window.location.search;
    return seg ? '#/room/' + seg : '#/room';
  }
  function current() {
    return PATH ? window.location.pathname + window.location.search : window.location.hash;
  }

  var routing = false;
  function onRoute() {
    routing = true;
    try {
      route();
    } finally {
      routing = false;
    }
  }
  function route() {
    var r = zoneFromHash();
    if (!r.valid) {
      history.replaceState(null, '', hashFor(ROOM.state.zone));
      return;
    }
    if (r.zone !== ROOM.state.zone) ROOM.go(r.zone, { push: false });
    if (!r.zone && r.view && r.view !== ROOM.normView(ROOM.state.view)) ROOM.turnTo(r.view, { push: false });
  }

  function boot() {
    var stage = document.getElementById('room-stage');
    var canvas = document.getElementById('room-canvas');
    ROOM.render.init(canvas, stage);
    ROOM.overlay.init(stage);
    ROOM.input.init(stage);
    document.body.classList.toggle('photo', !!ROOM.state.photo);

    // Initial route: jump straight to the zone, no dolly.
    if (ROOM.weather) ROOM.weather.init();
    if (!/[?&]gl=off\b/.test(window.location.search)) ROOM.render.enableGpu();
    var r = zoneFromHash();
    if (r.valid && r.zone) ROOM.go(r.zone, { push: false, instant: true });
    else if (r.valid && r.view && r.view !== 'front') ROOM.turnTo(r.view, { push: false, instant: true });
    if (current() !== hashFor(ROOM.state.zone)) history.replaceState(null, '', hashFor(ROOM.state.zone));

    ROOM.on('zone', function (d) {
      if (d.push && current() !== hashFor(d.zone)) history.pushState(null, '', hashFor(d.zone));
    });
    // A turn with no zone: the view's own URL (a turn on the way into a zone is covered by the zone's URL).
    ROOM.on('view', function (d) {
      if (ROOM.state.zone || d.push === false || routing) return;
      if (current() !== hashFor(null, d.view)) history.pushState(null, '', hashFor(null, d.view));
    });
    window.addEventListener('popstate', onRoute);
    if (!PATH) window.addEventListener('hashchange', onRoute);

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
