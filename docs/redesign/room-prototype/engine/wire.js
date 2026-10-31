/* FORGE room v3.5: skill wires and cages (ROOM.wire). W0 STUB: the contract of PLAN 2.4, inactive.
 * While active is false render.js keeps the v3.4 skill glow and feature ring (PLAN R16). The wire package (P5)
 * replaces it and registers the 'wire' mark pass.
 */
(function () {
  var ROOM = window.ROOM;
  ROOM.wire = {
    active: false,
    data: function () {
      return null;
    },
    styleOf: function () {
      return null;
    },
    draw: function () {},
  };
  ROOM.markStateOf = function () {
    return null;
  };
})();
