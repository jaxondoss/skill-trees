/* FORGE room prototype: boot and hash routing.
 *
 * Routes mirror the app's /room/[[...zone]]: #/room is the whole room, #/room/<zone> a zone.
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
    if (!m) return { valid: false, zone: null };
    var z = m[1] && ROOM.zoneById(m[1]);
    return { valid: !m[1] || !!z, zone: z ? z.id : null };
  }
  function hashFor(zone) {
    if (PATH) return (zone ? '/room/' + zone : PATH.base || '/room') + window.location.search;
    return zone ? '#/room/' + zone : '#/room';
  }
  function current() {
    return PATH ? window.location.pathname + window.location.search : window.location.hash;
  }

  function onRoute() {
    var r = zoneFromHash();
    if (!r.valid) {
      history.replaceState(null, '', hashFor(ROOM.state.zone));
      return;
    }
    if (r.zone !== ROOM.state.zone) ROOM.go(r.zone, { push: false });
  }

  function boot() {
    var stage = document.getElementById('room-stage');
    var canvas = document.getElementById('room-canvas');
    ROOM.render.init(canvas, stage);
    ROOM.overlay.init(stage);
    ROOM.input.init(stage);
    document.body.classList.toggle('photo', !!ROOM.state.photo);

    // Initial route: jump straight to the zone, no dolly.
    var r = zoneFromHash();
    if (r.valid && r.zone) ROOM.go(r.zone, { push: false, instant: true });
    if (current() !== hashFor(ROOM.state.zone)) history.replaceState(null, '', hashFor(ROOM.state.zone));

    ROOM.on('zone', function (d) {
      if (d.push && current() !== hashFor(d.zone)) history.pushState(null, '', hashFor(d.zone));
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
