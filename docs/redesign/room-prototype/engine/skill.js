/* FORGE room v3.5: the skill view (ROOM.skill). W0 STUB: the contract of PLAN 2.4, inert.
 *
 * open() opens the legacy board (ROOM.ui.open); there is no hero yet: atlasRows() is 0, frame() and heroState()
 * are null, drawCanvas2D() draws nothing, the legs take 0 ms. The skill package (P3) replaces it; layout() is a pure
 * function exported for Vitest.
 */
(function () {
  function layout() {
    throw new Error('TODO: ROOM.skill.layout (P3)');
  }

  if (typeof window !== 'undefined' && window.ROOM) {
    var ROOM = window.ROOM;
    ROOM.skill = {
      open: function (id, opts) {
        opts = opts || {};
        if (!id || !ROOM.ui || typeof ROOM.ui.open !== 'function') return false;
        ROOM.ui.open(id, { opener: opts.opener });
        return true;
      },
      close: function () {
        if (ROOM.ui && typeof ROOM.ui.close === 'function') ROOM.ui.close();
      },
      isOpen: function () {
        return false;
      },
      current: function () {
        return null;
      },
      rectCss: function () {
        return null;
      },
      layout: layout,
      heroState: function () {
        return null;
      },
      backdropCamera: function () {
        return null;
      },
      atlasRows: function () {
        return 0;
      },
      frame: function () {
        return null;
      },
      drawCanvas2D: function () {},
      lift: function () {
        return 0;
      },
      drop: function () {
        return 0;
      },
      swap: function () {
        return 0;
      },
      cancel: function () {},
      busy: function () {
        return false;
      },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { layout: layout };
})();
