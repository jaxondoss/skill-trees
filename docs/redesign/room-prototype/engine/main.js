/* FORGE room prototype: boot and hash routing.
 *
 * Routes mirror the app's /room/[[...zone]]: #/room is the whole room, #/room/<zone> a zone.
 * Every step in or out pushes a history entry, so the browser Back button walks back through zones.
 * Loaded last, after the ui scripts.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;

  function zoneFromHash() {
    var m = /^#\/room(?:\/([a-z-]+))?/.exec(window.location.hash || '');
    if (!m) return { valid: false, zone: null };
    var z = m[1] && ROOM.zoneById(m[1]);
    return { valid: !m[1] || !!z, zone: z ? z.id : null };
  }
  function hashFor(zone) {
    return zone ? '#/room/' + zone : '#/room';
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
    history.replaceState(null, '', hashFor(ROOM.state.zone) + '');

    ROOM.on('zone', function (d) {
      if (d.push && window.location.hash !== hashFor(d.zone)) history.pushState(null, '', hashFor(d.zone));
    });
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);

    ROOM.debug = {
      /** The device canvas pixels (ImageData) as last drawn. */
      readFrame: function () {
        return ROOM.render.readFrame();
      },
      /** Engine internals: view, camera, dolly progress, lighting step, parallax offsets, pan. */
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
