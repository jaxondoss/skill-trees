/* FORGE room v3.5: the overview (ROOM.overview). W0 STUB: the contract of PLAN 2.4, inert (no overview yet).
 * camera() returns null, so render.js keeps the wall camera. The overview package (P4) replaces it.
 */
(function () {
  function camera() {
    return null;
  }

  if (typeof window !== 'undefined' && window.ROOM) {
    window.ROOM.overview = {
      camera: camera,
      snapshot: function () {
        return null;
      },
      anchor: function () {
        return null;
      },
      placeAt: function () {
        return null;
      },
      get heading() {
        return null;
      },
      toggleList: function () {},
      onEnter: function () {},
      onLeave: function () {},
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { camera: camera };
})();
