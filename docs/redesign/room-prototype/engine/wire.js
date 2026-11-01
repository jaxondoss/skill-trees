/* FORGE room v3.5: skill wires and cages (ROOM.wire, D3-FINAL with PLAN amendments A2, A7, A8).
 *
 * - Skill wire (rest, every active skill): a 1 art px line one clear pixel outside the object's orthogonal hull
 *   plus 4 vertex nodes (2x2) at its diagonal extremes, coloured by state on one gold heat ramp: GOLD_DK idle,
 *   GOLD open goal, GOLD_HI logged, a Bayer breath GOLD/GOLD_DK for today's top priority, SLATE_1 when neglected.
 * - Attention (hover, keyboard focus, touch hold; Shift inspect for every hotspot): the item's 3D wire cage (visible
 *   box edges, INK keyline, 3x3 CREAM vertex nodes with an INK border) when its box passes the build's gate, else
 *   the hot wire (the skill wire in SUN or GOLD_HI with an INK sandwich and 3x3 nodes). Cages only for skills;
 *   features get the hot wire on attention and nothing at rest. Never cages in the overview.
 * - Skill view open on an item: that item keeps a dashed GOLD_DK "socket" wire (engine mark); other rest wires
 *   lose bit4 so they recede with the room dim (PLAN R9).
 * Every pixel goes through ROOM.render.plotMark (aux bit4 engine mark + bit7 no rim): the GPU lights marks like the
 * art but never below 70 % of their palette colour (A7); the Canvas2D path shows them palette-true.
 * Data: item.wire[variantKey] from the build (occlusion removed); runtime fallback ROOM.decode.wire(img).
 * Motion: cage draw-on 3 x 40 ms from a hover change (reset on navigation), hover sparkle, 2 x 80 ms log flash,
 * the top-priority breath. Reduced motion: complete cage, breath fixed at 50 %, no sparkle, no flash.
 */
(function () {
  'use strict';
  var ROOM = typeof window !== 'undefined' ? window.ROOM : null;
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  /* ------------------------------------------------------------------ pure parts (vitest) */
  var GATE = { over: 5, under: -2 };
  /** The cage gate (D3 2.1): overshoot <= 5 and undershoot >= -2 art px on every side. */
  function gatePass(gate) {
    if (!gate || !gate.over || !gate.under) return false;
    for (var i = 0; i < 4; i++) if (!(gate.over[i] <= GATE.over) || !(gate.under[i] >= GATE.under)) return false;
    return true;
  }

  // Rest colours per mark state (D3 2.2): [line, node].
  var REST = {
    off: ['GOLD_DK', 'GOLD_DK'],
    pending: ['GOLD', 'GOLD_HI'],
    top: ['GOLD', 'SUN'],
    half: ['GOLD_HI', 'GOLD'],
    full: ['GOLD_HI', 'CREAM'],
    neglect: ['SLATE_1', 'SLATE_1'],
  };

  /**
   * The D3 2.2 style table, pure. o = {skill: bool, feature: bool, state: markStateOf result, scene, hovered: bool
   * (hover or keyboard focus on this item), inspect: bool, skillOpen: null | 'self' | 'other', cage: bool (gate
   * passed, data present), lightNeglect: bool (PAPER_DK fallback)}. Colours are palette names.
   * Returns {kind: 'wire'|'hot'|'cage'|'socket', line, node, ink, breathe, dash, bit4} or null.
   */
  function styleFor(o) {
    var top = o.scene === 'top';
    if (o.skillOpen === 'self') {
      return { kind: 'socket', line: 'GOLD_DK', node: null, ink: null, breathe: false, dash: true, bit4: true };
    }
    var attn = !o.skillOpen && (o.hovered || o.inspect);
    if (attn && (o.skill || o.feature)) {
      var line = o.hovered ? 'SUN' : 'GOLD_HI';
      var kind = o.skill && o.cage && !top && o.state ? 'cage' : 'hot';
      return { kind: kind, line: line, node: 'CREAM', ink: 'INK', breathe: false, dash: false, bit4: true };
    }
    if (!o.skill || !o.state || !REST[o.state]) return null;
    var c = REST[o.state];
    if (o.state === 'neglect' && o.lightNeglect) c = ['PAPER_DK', 'PAPER_DK'];
    return {
      kind: 'wire',
      line: c[0],
      node: c[1],
      ink: null,
      breathe: o.state === 'top',
      dash: false,
      bit4: !o.skillOpen, // R9: other items recede with the room dim while the skill view is open
    };
  }

  /** Mark state of a skill from its LED state, the top priority and neglect (pure; see ROOM.markStateOf). */
  function markState(status, led, isTop, neglected) {
    if (status && status !== 'active') return null;
    if (led === 'full') return 'full';
    if (led === 'half') return 'half';
    if (led && led !== 'off') return isTop ? 'top' : 'pending';
    return neglected ? 'neglect' : 'off';
  }

  /** Draw-on fraction (1/3, 2/3, 1) of a cage t ms after attention began (3 steps x 40 ms). */
  function drawOnK(t, reduced) {
    if (reduced || t == null || t >= 80) return 1;
    return t < 40 ? 1 / 3 : 2 / 3;
  }

  var pure = { gatePass: gatePass, styleFor: styleFor, markState: markState, drawOnK: drawOnK, REST: REST, GATE: GATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (!ROOM) return;

  /* ------------------------------------------------------------------ engine */
  var C = ROOM.C;
  var D = ROOM.decode;
  var LIGHT_NEGLECT = { 'bed.cushion': 1 }; // floor items on a lit rug: neglected wire in PAPER_DK (D3 AC1)
  var DRAW_ON_MS = 40, SPARK_MS = 111, FLASH_MS = 80;

  function reduced() {
    return !!ROOM.state.reducedMotion;
  }
  // The 10-line breath of glow.js (2.5 s, 30..70 %, 0.05 steps), duplicated (PLAN 3.7: glow.js is P1's).
  function breath(now) {
    if (reduced()) return 0.5;
    var b = 0.5 + 0.2 * Math.sin((2 * Math.PI * now) / 2500);
    return Math.round(b * 20) / 20;
  }
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    return (n ^ (n >>> 15)) >>> 0;
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function skillBySlug(slug) {
    var list = (ROOM.data && ROOM.data.skills) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }

  /** 'off'|'pending'|'top'|'half'|'full'|'neglect' for an active skill, null otherwise (wire, LED, aria, board). */
  ROOM.markStateOf = function (slug) {
    var sk = skillBySlug(slug);
    if (!sk) return null;
    var fx = ROOM.fx;
    var led = fx ? fx.ledForSkill(slug) : 'off';
    return markState(sk.status, led, !!(fx && fx.topSkill() === slug), !!sk.neglected);
  };

  /* ---------------------------------------------------------------- data */
  var dataCache = Object.create(null);
  // Pre-computed draw lists: cage pixel distance to its nearest corner node (draw-on) and the cage's max.
  function cageDist(cage, nodes) {
    var n = cage.length / 2, dist = new Uint16Array(n), mx = 0;
    for (var i = 0; i < n; i++) {
      var best = 65535;
      for (var k = 0; k + 1 < nodes.length; k += 2) {
        var d = Math.max(Math.abs(cage[i * 2] - nodes[k]), Math.abs(cage[i * 2 + 1] - nodes[k + 1]));
        if (d < best) best = d;
      }
      dist[i] = best;
      if (best > mx) mx = best;
    }
    return { dist: dist, max: mx };
  }

  /**
   * Wire data of an item for a variant key: {hull, nodes, cage|null, cageNodes|null, gate, cageOK, built} in art px
   * relative to the item's x, y. Bundle field first (key, else base), else the runtime fallback (no cage).
   */
  function data(item, variantKey, img) {
    if (!item) return null;
    var key = String(variantKey || 'base').replace(/\.night$/, '');
    var ck = item.id + '|' + key;
    if (ck in dataCache) return dataCache[ck];
    var w = item.wire && (item.wire[key] || item.wire.base);
    var out = null;
    if (w && w.hull) {
      out = {
        hull: w.hull,
        nodes: w.nodes || [],
        cage: w.cage || null,
        cageNodes: w.cageNodes || null,
        gate: w.gate || null,
        built: true,
      };
    } else {
      if (!img && item.variants) img = D.get(item.variants[key] || item.variants.base);
      var r = img && D.wire ? D.wire(img, item.wireShape) : null;
      if (r) out = { hull: r.hull, nodes: r.nodes, cage: null, cageNodes: null, gate: null, built: false };
    }
    if (out) {
      out.cageOK = !!(out.cage && out.cage.length && gatePass(out.gate));
      if (out.cageOK) out.cd = cageDist(out.cage, out.cageNodes && out.cageNodes.length ? out.cageNodes : out.cage.slice(0, 2));
    }
    // Relic drawables have no bundle item; their sprite can change, so only bundle items are cached.
    if (item.wire || (ROOM.itemById && ROOM.itemById(item.id))) dataCache[ck] = out;
    return out;
  }

  /* ---------------------------------------------------------------- style */
  function drawableById(id) {
    var list = ROOM.render.drawables;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function isFeature(d) {
    return !d.skill && !!(d.item && d.item.target);
  }
  function wireOf(d) {
    return data(d.item, d.key, d.img);
  }

  function styleOfD(d, ls) {
    if (!d || !d.hotspot) return null;
    ls = ls || ROOM.render.ls();
    var roomId = (d.item && d.item.of) || d.id;
    var skillOpen = ls.skill ? (ls.skill === roomId || ls.skill === d.id ? 'self' : 'other') : null;
    var wd = wireOf(d);
    var st = d.skill ? ROOM.markStateOf(d.skill.slug) : null;
    var s = styleFor({
      skill: !!d.skill,
      feature: isFeature(d),
      state: st,
      scene: ls.scene,
      hovered: !ls.snap && (ls.hover === d.id || ls.focus === d.id),
      inspect: !ls.snap && !!ls.inspect,
      skillOpen: skillOpen,
      cage: !!(wd && wd.cageOK),
      lightNeglect: !!LIGHT_NEGLECT[roomId],
    });
    if (!s || !wd) return null;
    s.state = st;
    s.lineName = s.line;
    s.line = C[s.line];
    s.node = s.node ? C[s.node] : null;
    s.ink = s.ink ? C[s.ink] : null;
    return s;
  }

  /** Style of an item id under ls (default: the current one), palette indices; null = no mark. */
  function styleOf(id, ls) {
    return styleOfD(drawableById(id), ls);
  }

  /* ---------------------------------------------------------------- motion state */
  var attn = { id: undefined, t0: 0 }; // draw-on and hover sparkle start
  var flash = null; // {slug, t0}: log flash
  function resetMotion() {
    attn = { id: undefined, t0: 0 };
  }

  /* ---------------------------------------------------------------- drawing */
  var plotMark = ROOM.render.plotMark;
  function px(f, x, y, c, dep, fl, own) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    plotMark(f, x, y, c, dep, fl);
    if (!own) f.mark[y * f.w + x] = 0;
  }
  // An INK keyline pixel: never over another mark nor over an object nearer than the owner (its depth > dep + 6).
  function ink(f, x, y, c, dep, fl) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    var i = y * f.w + x;
    if (f.mark[i]) return;
    if (f.aux) {
      var a = f.aux[i * 3];
      if (a > dep + 6 && !(f.aux[i * 3 + 1] & 2)) return;
    }
    plotMark(f, x, y, c, dep, fl);
  }
  var N4 = [1, 0, -1, 0, 0, 1, 0, -1];
  var N8 = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

  function sparkle(f, x, y, frame, dep, fl) {
    if (frame === 0) px(f, x, y, C.SUN, dep, fl, true);
    else if (frame === 1) {
      px(f, x, y, C.CREAM, dep, fl, true);
      px(f, x - 1, y, C.PLUM_3, dep, fl, true);
      px(f, x + 1, y, C.PLUM_3, dep, fl, true);
      px(f, x, y - 1, C.SLATE_2, dep, fl, true);
      px(f, x, y + 1, C.SLATE_2, dep, fl, true);
    } else if (frame === 2) {
      px(f, x - 2, y, C.GOLD_DK, dep, fl, true);
      px(f, x + 2, y, C.GOLD_DK, dep, fl, true);
      px(f, x, y - 2, C.GOLD_DK, dep, fl, true);
      px(f, x, y + 2, C.GOLD_DK, dep, fl, true);
    }
  }

  /** 3x3 node centred on (x, y) with an optional 1 px INK border (5x5). */
  function bigNode(f, x, y, c, k, dep, fl) {
    if (k != null) for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) if (a === -2 || a === 2 || b === -2 || b === 2) ink(f, x + a, y + b, k, dep, fl);
    for (var p = -1; p <= 1; p++) for (var q = -1; q <= 1; q++) px(f, x + p, y + q, c, dep, fl, true);
  }

  /**
   * Draw item id's mark into frame f. style: a styleOf result, or 'rest'|'hot'|'cage'|'socket'|'hover' (hover =
   * cage when the gate passes, else hot), or omitted (the current style). Buffer origin from the drawable.
   */
  function draw(f, id, style) {
    var d = typeof id === 'string' ? drawableById(id) : id;
    if (!d) return;
    var wd = wireOf(d);
    if (!wd) return;
    var s = style;
    if (!s || typeof s === 'string') {
      var cur = styleOfD(d, null);
      if (typeof s === 'string') {
        var name = s === 'hover' ? (wd.cageOK && d.skill ? 'cage' : 'hot') : s;
        if (name === 'rest') s = cur && cur.kind === 'wire' ? cur : styleFor({ skill: true, state: 'off' });
        else if (name === 'socket') s = styleFor({ skillOpen: 'self' });
        else s = { kind: name === 'cage' && !wd.cageOK ? 'hot' : name, line: 'SUN', node: 'CREAM', ink: 'INK', bit4: true };
        if (typeof s.line === 'string') {
          s = Object.assign({}, s);
          s.line = C[s.line];
          s.node = s.node ? C[s.node] : null;
          s.ink = s.ink ? C[s.ink] : null;
        }
      } else s = cur;
    }
    if (!s) return;
    var bx = d.x + (f.offs ? f.offs[d.layer] || 0 : 0) - f.x0;
    var by = d.y - f.y0;
    var dep = ROOM.render.markDepth(d);
    var fl = s.bit4 ? 16 | 128 : 128;
    var own = !!s.bit4;
    var now = f.now;
    var hull = wd.hull, nodes = wd.nodes, i, x, y;
    var line = s.line, node = s.node;
    var slug = d.skill && d.skill.slug;
    // Log flash: 2 x 80 ms SUN (frames 0 and 2 of 3).
    if (flash && slug === flash.slug && s.kind === 'wire' && !reduced()) {
      var ft = now - flash.t0;
      if (ft >= 0 && ft < 3 * FLASH_MS && Math.floor(ft / FLASH_MS) !== 1) {
        line = C.SUN;
        node = C.SUN;
      }
    }
    if (s.kind === 'cage') {
      var cage = wd.cage, cd = wd.cd;
      var k = attn.id === d.id && !s.static ? drawOnK(now - attn.t0, reduced()) : 1;
      var lim = k >= 1 ? 1e9 : Math.ceil(cd.max * k);
      for (i = 0; i < cage.length; i += 2) {
        if (cd.dist[i >> 1] > lim) continue;
        x = bx + cage[i];
        y = by + cage[i + 1];
        for (var n = 0; n < 8; n += 2) ink(f, x + N4[n], y + N4[n + 1], s.ink, dep, fl);
      }
      for (i = 0; i < cage.length; i += 2) if (cd.dist[i >> 1] <= lim) px(f, bx + cage[i], by + cage[i + 1], line, dep, fl, true);
      var cn = wd.cageNodes || [];
      for (i = 0; i + 1 < cn.length; i += 2) bigNode(f, bx + cn[i], by + cn[i + 1], node, s.ink, dep, fl);
      hoverSpark(f, d, s, bx, by, cn.length ? cn : nodes, dep, fl);
      return;
    }
    if (s.kind === 'hot') {
      for (i = 0; i < hull.length; i += 2) {
        x = bx + hull[i];
        y = by + hull[i + 1];
        for (var m = 0; m < 16; m += 2) ink(f, x + N8[m], y + N8[m + 1], s.ink, dep, fl);
      }
      for (i = 0; i < hull.length; i += 2) px(f, bx + hull[i], by + hull[i + 1], line, dep, fl, true);
      for (i = 0; i + 1 < nodes.length; i += 2) bigNode(f, bx + nodes[i], by + nodes[i + 1], node, s.ink, dep, fl);
      hoverSpark(f, d, s, bx, by, nodes, dep, fl);
      return;
    }
    if (s.kind === 'socket') {
      // dashed 2 on / 2 off along rows and columns (art px, so the dash does not crawl with the camera)
      for (i = 0; i < hull.length; i += 2) if ((((hull[i] + hull[i + 1]) >> 1) & 1) === 0) px(f, bx + hull[i], by + hull[i + 1], line, dep, fl, true);
      return;
    }
    // rest wire
    if (s.breathe) {
      var cut = Math.round(((breath(now) - 0.3) / 0.4) * 16);
      for (i = 0; i < hull.length; i += 2) {
        x = bx + hull[i];
        y = by + hull[i + 1];
        var bay = BAYER[((d.y + hull[i + 1]) & 3) * 4 + ((d.x + hull[i]) & 3)]; // art px: steady under the camera
        px(f, x, y, line === C.SUN ? C.SUN : bay < cut ? C.GOLD : C.GOLD_DK, dep, fl, own);
      }
    } else for (i = 0; i < hull.length; i += 2) px(f, bx + hull[i], by + hull[i + 1], line, dep, fl, own);
    // 2x2 nodes, grown outward from the corner they mark (TL, TR, BR, BL)
    var OX = [-1, 0, 0, -1], OY = [-1, -1, 0, 0];
    for (i = 0; i + 1 < nodes.length && i < 8; i += 2) {
      var nx = bx + nodes[i] + OX[i >> 1], ny = by + nodes[i + 1] + OY[i >> 1];
      for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) px(f, nx + a, ny + b, node, dep, fl, own);
    }
    // top priority: the existing shimmer, one sparkle every 4-7 s on the wire
    if (s.breathe && !reduced() && hull.length && !f.snapFrame) {
      var seed = hashStr(d.id), period = 4000 + (seed % 3000), off = hash(seed) % period;
      var t = (now + off) % period;
      if (t < 3 * SPARK_MS) {
        var q = hash(seed + Math.floor((now + off) / period) * 7919) % (hull.length / 2);
        sparkle(f, bx + hull[q * 2], by + hull[q * 2 + 1], Math.floor(t / SPARK_MS), dep, fl);
      }
    }
  }

  // One sparkle at the top-right node when attention begins (3 frames x 111 ms; never under reduced motion).
  function hoverSpark(f, d, s, bx, by, nodes, dep, fl) {
    if (reduced() || attn.id !== d.id || !nodes.length) return;
    var t = f.now - attn.t0;
    if (t < 0 || t >= 3 * SPARK_MS) return;
    var best = 0;
    for (var i = 2; i + 1 < nodes.length; i += 2) if (nodes[i] - nodes[i + 1] > nodes[best] - nodes[best + 1]) best = i;
    sparkle(f, bx + nodes[best] + 1, by + nodes[best + 1] - 3, Math.floor(t / SPARK_MS), dep, fl);
  }

  /* ---------------------------------------------------------------- the mark pass */
  var lastPassMs = 0;
  function pass(f, ls) {
    if (!ROOM.wire.active) return;
    var t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    ls = ls || ROOM.render.ls();
    plotMark = ROOM.render.plotMark;
    if (!ls.snap) {
      var a = ls.hover || ls.focus || (ls.inspect ? '*inspect' : null);
      if (a !== attn.id) attn = { id: a, t0: f.now };
    }
    var list = ROOM.render.drawables;
    var inZone = !!ROOM.state.zone;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d.hotspot || (inZone && d.layer === 6)) continue;
      var s = styleOfD(d, ls);
      if (!s) continue;
      if (ls.snap) s.static = true;
      draw(f, d, s);
    }
    if (t0) lastPassMs = performance.now() - t0;
  }

  /** True while a wire animation needs display-rate frames (draw-on, hover sparkle, log flash). */
  function busy(now) {
    if (reduced()) return false;
    if (attn.id && now - attn.t0 < Math.max(3 * DRAW_ON_MS, 3 * SPARK_MS) + 20) return true;
    if (flash && now - flash.t0 < 3 * FLASH_MS + 20) return true;
    return false;
  }

  ROOM.on('log', function (e) {
    if (!e || !e.result) return;
    var goals = (ROOM.data && ROOM.data.goals) || [];
    for (var i = 0; i < goals.length; i++) {
      if (goals[i].id === e.goalId && goals[i].skill) {
        flash = { slug: goals[i].skill, t0: ROOM.now() };
        if (ROOM.invalidate) ROOM.invalidate();
        return;
      }
    }
  });
  ROOM.on('nav', function (e) {
    if (e && e.phase === 'start') resetMotion();
  });
  ROOM.on('view', resetMotion);

  ROOM.wire = {
    active: true,
    data: function (item, variantKey) {
      if (typeof item === 'string') item = ROOM.itemById(item);
      return data(item, variantKey || (item ? ROOM.variantOf(item) : null));
    },
    styleOf: styleOf,
    draw: draw,
    busy: busy,
    gatePass: gatePass,
    styleFor: styleFor,
    get lastPassMs() {
      return lastPassMs;
    },
  };
  ROOM.render.addMarkPass('wire', pass);
})();
