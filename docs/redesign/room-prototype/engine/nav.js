/* FORGE room v3.5: the navigator (ROOM.nav), the only way the room moves (D4 as amended by PLAN 2.1-2.3).
 *
 * Place = {mode: 'wall'|'zone'|'overview'|'skill', view, zone, item, base, baseZone, ret}. A skill place keeps the
 * camera of its backdrop place (base 'wall' or 'zone' + baseZone); its zone is the item's own zone (routes). An
 * overview place remembers where Down/Esc return (ret). Every change of place is a Move made of legs:
 *   camera legs (render.js draws them from pre-lit shots): TURN (+ZOOM), DOLLY, RISE, DESCEND;
 *   live legs (static camera, live rest frames, skill.js animates the hero): LIFT, DROP, SWAP.
 * Interruptions (D4 5): same target ignored; back to the move's start reverses in place; one more Left/Right
 * retargets a turn (two walls ahead at most); anything else queues in one slot (latest wins) and runs at landing;
 * resize, hidden tab and context loss snap the move to its end. onLand never runs for a superseded move.
 * History: one entry per Move, pushed at its start; dismissals (closing a skill view, leaving the overview) pop the
 * entry the navigator itself pushed from exactly that place, else replace (R13). All timing runs on ROOM.now(), so
 * ROOM.debug.freeze()/advance() drives moves. Reduced motion: every move is instant (state at target in the same
 * tick). The navigation light state (ls) is owned here: focusK / dimK / poolK tween only on live legs and board dims.
 *
 * Pure helpers (planFor, policy, routeOf, parseRoute) are exported through module.exports for Vitest.
 */
(function () {
  'use strict';

  var RING = ['front', 'right', 'back', 'left'];
  var MS = { lift: 360, drop: 280, swap: 400, rise: 520, descend: 520, tween: 240, turn: [0, 640, 900, 1100] };
  var CAMERA_LEGS = { turn: 1, dolly: 1, rise: 1, descend: 1 };

  /* ------------------------------------------------------------------ places (pure) */
  function place(mode, view, zone, item, extra) {
    var p = { mode: mode, view: view || 'front', zone: zone || null, item: item || null, base: null, baseZone: null, ret: null };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }
  function same(a, b) {
    if (!a || !b || a.mode !== b.mode) return false;
    if (a.mode === 'overview') return true;
    if (a.view !== b.view) return false;
    if (a.mode === 'zone') return a.zone === b.zone;
    if (a.mode === 'skill') return a.item === b.item;
    return true;
  }
  /** The place a skill place sits on (its backdrop camera); other places are their own base. */
  function baseOf(p) {
    if (p.mode !== 'skill') return p;
    return p.base === 'zone' && p.baseZone ? place('zone', p.view, p.baseZone) : place('wall', p.view);
  }
  function ringStep(v, dir) {
    var i = RING.indexOf(v);
    return RING[(i + (dir > 0 ? 1 : 3)) % 4];
  }
  function ringDir(a, b) {
    var d = (RING.indexOf(b) - RING.indexOf(a) + 4) % 4;
    return d === 0 ? 0 : d === 3 ? -1 : 1;
  }
  function leg(kind, from, to, extra) {
    var l = { kind: kind, from: from, to: to };
    if (extra) for (var k in extra) l[k] = extra[k];
    return l;
  }
  /** The legs of a move from one place to another (PLAN 2.1 table). */
  function planFor(from, to) {
    if (same(from, to)) return [];
    if (to.mode === 'overview') {
      if (from.mode === 'skill') {
        var b0 = baseOf(from);
        return [leg('drop', from, b0), leg('rise', b0, to)];
      }
      return [leg('rise', from, to)];
    }
    if (from.mode === 'overview') {
      if (to.mode === 'skill') {
        var rest = baseOf(to);
        return [leg('descend', from, rest), leg('lift', rest, to)];
      }
      return [leg('descend', from, to)];
    }
    if (from.mode === 'skill') {
      var base = baseOf(from);
      if (to.mode === 'skill') {
        if (to.view === from.view) return [leg('swap', from, to)];
        var restTo = baseOf(to);
        return [leg('drop', from, base)].concat(planFor(base, restTo), [leg('lift', restTo, to)]);
      }
      return [leg('drop', from, base)].concat(planFor(base, to));
    }
    if (to.mode === 'skill') {
      if (to.view === from.view) return [leg('lift', from, to)];
      var r2 = baseOf(to);
      return planFor(from, r2).concat([leg('lift', r2, to)]);
    }
    if (from.view === to.view) return [leg('dolly', from, to)];
    var dir = ringDir(from.view, to.view);
    var steps = Math.abs((RING.indexOf(to.view) - RING.indexOf(from.view) + 4) % 4) === 2 ? 2 : 1;
    return [leg('turn', from, to, { dir: dir, steps: steps })];
  }
  /**
   * What to do with a request while a move runs (D4 5). cur = {from, to, legs, leg (index), pending}.
   * Returns 'start' (nothing running), 'ignore', 'reverse', 'retarget' or 'queue'.
   */
  function policy(cur, target) {
    if (!cur || !cur.to) return 'start';
    if (same(target, cur.to) || (cur.pending && same(target, cur.pending))) return 'ignore';
    var l = cur.legs[cur.leg || 0];
    if (same(target, cur.from) && cur.legs.length === 1 && l && l.kind !== 'swap' && !cur.reversed) return 'reverse';
    if (l && l.kind === 'turn' && cur.legs.length === 1 && !cur.reversed && cur.from.mode === 'wall' && cur.to.mode === 'wall' &&
      target.mode === 'wall' && target.view === ringStep(cur.to.view, l.dir) && (cur.ahead || l.steps) < 3) return 'retarget';
    return 'queue';
  }

  /* ------------------------------------------------------------------ routes (pure) */
  /** Path segment of a place: '' (front wall), 'right', '<zone>', 'overview', '<zone>/<item suffix>'. */
  function routeOf(p) {
    if (!p) return '';
    if (p.mode === 'overview') return 'overview';
    if (p.mode === 'skill') return p.zone + '/' + String(p.item).split('.').slice(1).join('-');
    if (p.mode === 'zone') return p.zone;
    return p.view === 'front' ? '' : p.view;
  }
  /** Parse a route path ('/room/a/b', '#/room/a', '/') into its segments, or null when it is not a room route. */
  function parseRoute(src) {
    src = String(src || '');
    if (src === '/' || src === '' || src === '#' || src === '#/') return { a: null, b: null };
    var m = /^#?\/room(?:\/([a-z-]+)(?:\/([a-z0-9-]+))?)?\/?$/.exec(src);
    return m ? { a: m[1] || null, b: m[2] || null } : null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { planFor: planFor, policy: policy, routeOf: routeOf, parseRoute: parseRoute, same: same, baseOf: baseOf, place: place };
  }
  if (typeof window === 'undefined' || !window.ROOM) return;

  /* ================================================================== browser */
  var ROOM = window.ROOM;
  var R = function () {
    return ROOM.render;
  };
  var PATH = window.ROOM_ROUTE || null;

  var cur = null; // landed place
  var scene = null; // the place rest frames draw (a live leg's target inside a move)
  var move = null; // {from, to, legs, i, leg, opts, pushed, reversed, ahead}
  var pending = null; // {place, opts}
  var tween = null; // {from: {focusK, dimK, poolK}, to, t0, dur}
  var boardDim = { k: 0, from: 0, to: 0, t0: 0 };
  var landPending = false;
  var pushed = []; // [{url, below}] entries the navigator pushed (R13)
  var ignorePop = 0;

  function reduced() {
    return !!ROOM.state.reducedMotion;
  }
  function overviewOn() {
    var V = (ROOM.art.zones || {}).views || {};
    return !!(V.top && ROOM.overview && ROOM.overview.camera);
  }

  /* ------------------------------------------------------------------ place helpers (data) */
  function wall(v) {
    return place('wall', ROOM.normView(v));
  }
  function zonePlace(id) {
    var z = ROOM.zoneById(id);
    return z ? place('zone', ROOM.viewOf(z), z.id) : null;
  }
  function zoneOfItem(it) {
    return ROOM.zoneOf ? ROOM.zoneOf(it) : ROOM.zoneById(it.zone);
  }
  /**
   * The place an item leads to: a skill place (R23: the study wall calendar leads to the calendar zone; the Today
   * feature and virtual ids are boards without a move: null). from: where the request starts (backdrop rule R2).
   */
  function skillPlaceOf(id, from) {
    var it = ROOM.itemById(id);
    if (!it) return null;
    var room = it.of ? ROOM.itemById(it.of) : it;
    if (!room || !room.target) return null;
    if (room.target.feature === 'calendar') return zonePlace('calendar');
    if (room.target.feature === 'today') return null;
    var z = zoneOfItem(room);
    var v = ROOM.viewOf(room);
    var p = place('skill', v, z ? z.id : null, room.id, { base: 'wall' });
    from = from ? baseOf(from) : null;
    if (from && from.view === v && from.mode === 'zone') {
      p.base = 'zone';
      p.baseZone = from.zone;
    }
    return p;
  }
  function isStatue(id) {
    var it = id && ROOM.itemById(id);
    return !!(it && ((it.target && it.target.feature === 'overall') || /statue/.test(it.id)));
  }
  /** Fill a partial place (from callers) into a full one. */
  function full(p, from) {
    if (!p) return null;
    if (p.mode === 'skill') {
      var sp = skillPlaceOf(p.item, from);
      if (sp && sp.mode === 'skill' && p.base) {
        sp.base = p.base;
        sp.baseZone = p.baseZone || null;
      }
      return sp;
    }
    if (p.mode === 'zone') return zonePlace(p.zone);
    if (p.mode === 'overview') {
      var ret = p.ret || (from && from.mode !== 'overview' ? baseOf(from) : wall('front'));
      return place('overview', ret.view, null, null, { ret: ret });
    }
    return wall(p.view || (from && from.view) || 'front');
  }

  /* ------------------------------------------------------------------ light state */
  function lsOf(p) {
    var zid = p.mode === 'zone' ? p.zone : p.mode === 'skill' && p.base === 'zone' ? p.baseZone : null;
    if (p.mode === 'skill') return { zone: zid, focusK: 0, dimK: 1, poolK: 0, skill: p.item, statueLight: isStatue(p.item) };
    if (p.mode === 'zone') return { zone: zid, focusK: 1, dimK: 0, poolK: 1, skill: null, statueLight: false };
    return { zone: null, focusK: 0, dimK: 0, poolK: 0, skill: null, statueLight: false };
  }
  function smooth(u) {
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u);
  }
  function boardDimK(now) {
    if (boardDim.from === boardDim.to) return boardDim.to;
    var u = (now - boardDim.t0) / MS.tween;
    if (u >= 1 || reduced()) {
      boardDim.from = boardDim.to;
      return boardDim.to;
    }
    return boardDim.from + (boardDim.to - boardDim.from) * smooth(u);
  }
  /** The navigation LightState now (PLAN 2.4). Never calls ROOM.render.ls (W0 gotcha). */
  function ls() {
    var now = ROOM.now();
    var p = scene || cur || placeFromState();
    var base = lsOf(p);
    var o = { zone: base.zone, focusK: base.focusK, dimK: base.dimK, poolK: base.poolK, skill: base.skill, statueLight: base.statueLight };
    if (tween) {
      var u = reduced() ? 1 : smooth((now - tween.t0) / tween.dur);
      ['focusK', 'dimK', 'poolK'].forEach(function (k) {
        o[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * u;
      });
      if (tween.zone !== undefined && u < 1) o.zone = tween.zone || o.zone;
    }
    o.dimK = Math.max(o.dimK, boardDimK(now));
    var Rr = R();
    var moving = !!move && !!move.leg && CAMERA_LEGS[move.leg.kind];
    return {
      scene: (Rr && Rr.sceneOverride) || ROOM.sceneKey(),
      zone: o.zone,
      focusK: o.focusK,
      dimK: o.dimK,
      poolK: o.poolK,
      hover: moving || !Rr ? null : Rr.hoverId,
      focus: moving || !Rr ? null : Rr.focusId,
      inspect: !!ROOM.state.inspect,
      skill: o.skill,
      statueLight: o.statueLight,
      snap: false,
    };
  }
  function startTween(fromP, toP, dur) {
    var a = lsOf(fromP), b = lsOf(toP);
    if (tween) {
      // continue from where a running tween is
      var now = ROOM.now(), u = smooth((now - tween.t0) / tween.dur);
      ['focusK', 'dimK', 'poolK'].forEach(function (k) {
        a[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * u;
      });
    }
    tween = { from: a, to: b, t0: ROOM.now(), dur: reduced() ? 0 : dur || MS.tween, zone: a.zone || b.zone };
  }

  function placeFromState() {
    var st = ROOM.state || {};
    var v = ROOM.normView(st.view);
    return st.zone ? place('zone', v, st.zone) : place('wall', v);
  }

  /* ------------------------------------------------------------------ history */
  function urlOf(p) {
    var seg = routeOf(p);
    if (PATH) return (seg ? '/room/' + seg : PATH.base || '/room') + window.location.search;
    return seg ? '#/room/' + seg : '#/room';
  }
  function curUrl() {
    return PATH ? window.location.pathname + window.location.search : window.location.hash || '#/room';
  }
  function sameUrl(a, b) {
    if (PATH) return a === b || (a.split('?')[0] === '/' && b.split('?')[0] === (PATH.base || '/room')) || (b.split('?')[0] === '/' && a.split('?')[0] === (PATH.base || '/room'));
    return a === b;
  }
  function push(url) {
    var below = curUrl();
    if (sameUrl(below, url)) return false;
    history.pushState(null, '', url);
    pushed.push({ url: url, below: below });
    if (pushed.length > 64) pushed.shift();
    return true;
  }
  function replace(url) {
    if (!sameUrl(curUrl(), url)) history.replaceState(null, '', url);
    var top = pushed[pushed.length - 1];
    if (top && top.url !== url) top.url = url;
  }
  /** A dismissal to place p: pop the entry the navigator pushed from p, else replace (R13). */
  function dismiss(p) {
    var url = urlOf(p), top = pushed[pushed.length - 1];
    if (top && sameUrl(top.url, curUrl()) && sameUrl(top.below, url)) {
      pushed.pop();
      ignorePop++;
      history.back();
      return;
    }
    replace(url);
  }

  /* ------------------------------------------------------------------ moves */
  function target() {
    return pending ? pending.place : move ? move.to : cur;
  }
  function busy() {
    var now = ROOM.now();
    if (move || pending || landPending) return true;
    if (tween && !reduced() && now - tween.t0 < tween.dur) return true;
    if (boardDim.from !== boardDim.to && !reduced() && now - boardDim.t0 < MS.tween) return true;
    if (ROOM.skill && ROOM.skill.busy && ROOM.skill.busy()) return true;
    return false;
  }

  /**
   * Go to place p. opts: {history (default true), instant, source, opener, dismiss}. Returns true when it starts,
   * retargets, reverses or queues a move.
   */
  function request(p, opts) {
    opts = opts || {};
    var from = target();
    var to = full(p, from);
    if (!to) return false;
    if (to.mode === 'overview' && !overviewOn()) return false;
    if (!move && !pending && same(to, cur)) {
      if (to.mode === 'skill' && !ROOM.state.panel) openBoard(to, opts);
      return false;
    }
    var pol = policy(move ? { from: move.from, to: move.to, legs: move.legs, leg: move.i, pending: pending && pending.place, reversed: move.reversed, ahead: move.ahead } : null, to);
    if (pol === 'ignore') return false;
    if (pol === 'reverse') return reverse(opts);
    if (pol === 'retarget') return retarget(to, opts);
    if (pol === 'queue') {
      pending = { place: to, opts: opts };
      if (opts.history !== false && !opts.dismiss) replace(urlOf(to));
      return true;
    }
    start(to, opts);
    return true;
  }

  function start(to, opts) {
    var from = cur;
    var legs = planFor(from, to);
    if (!legs.length) return;
    var instant = !!opts.instant || reduced() || !R() || !R().view;
    move = { from: from, to: to, legs: legs, i: -1, leg: null, opts: opts, reversed: false, ahead: legs[0].steps || 1 };
    if (opts.history !== false) {
      if (opts.dismiss) dismiss(to);
      else push(urlOf(to));
    }
    if (R()) R().setHover(null);
    ROOM.emit('nav', { phase: 'start', from: from, to: to, kind: legs.map(function (l) { return l.kind; }).join('+') });
    if (from.mode === 'skill' && to.mode !== 'skill') closeBoard();
    if (instant) {
      finishInstant();
      return;
    }
    nextLeg(ROOM.now());
  }

  // Apply every remaining leg at once (reduced motion, boot, resize snap) and land.
  function finishInstant() {
    var m = move;
    for (var i = Math.max(0, m.i); i < m.legs.length; i++) {
      var l = m.legs[i];
      if (i === m.i && l.r && R()) R().endLeg();
      if (l.kind === 'lift' && ROOM.skill && ROOM.skill.lift) ROOM.skill.lift(l.to.item, { instant: true, source: m.opts.source });
      if (l.kind === 'drop' && ROOM.skill && ROOM.skill.drop) ROOM.skill.drop({ instant: true });
      if (l.kind === 'swap' && ROOM.skill && ROOM.skill.swap) ROOM.skill.swap(l.to.item, { instant: true });
    }
    tween = null;
    scene = m.to;
    if (R()) R().applyPlace(m.to);
    land();
  }

  function nextLeg(now) {
    var m = move;
    m.i++;
    if (m.i >= m.legs.length) {
      land();
      return;
    }
    var l = m.legs[m.i];
    m.leg = l;
    l.t0 = now;
    var Rr = R();
    if (CAMERA_LEGS[l.kind]) {
      // render.js plans from the frame on screen; the destination is drawn with its arrival light
      scene = l.from;
      l.r = Rr.beginLeg({ kind: l.kind, from: l.from, to: l.to, lsFrom: lsFull(l.from), lsTo: lsFull(l.to), dir: l.dir });
      l.dur = l.r.dur;
      return;
    }
    // live legs: the camera stays; the room renders live; the light state tweens
    scene = l.to;
    Rr.applyPlace(l.to);
    var sk = ROOM.skill || {};
    var ms = 0;
    if (l.kind === 'lift') {
      startTween(l.from, l.to, MS.tween);
      ms = sk.lift ? sk.lift(l.to.item, { fromRectDev: itemRectDev(l.to.item), instant: false, source: m.opts.source }) || 0 : 0;
    } else if (l.kind === 'drop') {
      startTween(l.from, l.to, MS.tween);
      ms = sk.drop ? sk.drop({ instant: false }) || 0 : 0;
    } else if (l.kind === 'swap') {
      ms = sk.swap ? sk.swap(l.to.item) || 0 : 0;
    }
    l.dur = Math.max(ms, l.kind === 'swap' ? 0 : MS.tween);
  }
  function lsFull(p) {
    var o = lsOf(p);
    o.scene = p.mode === 'overview' ? 'top' : p.view;
    o.inspect = !!ROOM.state.inspect;
    return o;
  }
  function itemRectDev(id) {
    var r = ROOM.itemRectCss ? ROOM.itemRectCss(id) : null;
    var Rr = R();
    if (!r || !Rr || !Rr.canvas) return null;
    var c = Rr.canvas.getBoundingClientRect(), d = Rr.view ? Rr.view.dpr : 1;
    return { x: Math.round((r.left - c.left) * d), y: Math.round((r.top - c.top) * d), w: Math.round(r.width * d), h: Math.round(r.height * d) };
  }

  function land() {
    var m = move;
    var prev = cur;
    cur = m.to;
    scene = null;
    move = null;
    landPending = true;
    // mirrors for the legacy readers (overlay, calendar, statue, weather)
    var zid = cur.mode === 'zone' ? cur.zone : cur.mode === 'skill' && cur.base === 'zone' ? cur.baseZone : null;
    var prevZone = ROOM.state.zone || null;
    ROOM.state.zone = zid;
    ROOM.state.statueLight = cur.mode === 'skill' && isStatue(cur.item);
    if (R()) R().applyPlace(cur);
    if (prevZone !== zid) ROOM.emit('zone', { zone: zid, from: prevZone, push: false });
    if (!prev || prev.view !== cur.view) ROOM.emit('view', { view: cur.view, push: false });
    if ((prev && prev.mode === 'overview') !== (cur.mode === 'overview')) {
      ROOM.emit('overview', { on: cur.mode === 'overview', ret: cur.ret || null });
      if (ROOM.overview) {
        if (cur.mode === 'overview' && ROOM.overview.onEnter) ROOM.overview.onEnter();
        if (cur.mode !== 'overview' && ROOM.overview.onLeave) ROOM.overview.onLeave();
      }
    }
    ROOM.emit('nav', { phase: 'land', from: m.from, to: cur, place: cur, kind: m.legs.map(function (l) { return l.kind; }).join('+') });
    landPending = false;
    if (pending) {
      var p = pending;
      pending = null;
      // relative requests were resolved against the queued target already
      if (!same(p.place, cur)) start(p.place, p.opts);
      return;
    }
    if (cur.mode === 'skill' && !m.reversed) openBoard(cur, m.opts);
    if (ROOM.invalidate) ROOM.invalidate();
  }

  /* ------------------------------------------------------------------ interruptions */
  function reverse(opts) {
    var m = move;
    var now = ROOM.now();
    var l = m.leg;
    var t = l ? now - l.t0 : 0;
    var to = m.from;
    m.reversed = true;
    m.from = m.to;
    m.to = to;
    pending = null;
    if (opts.history !== false) replace(urlOf(to));
    if (l && !CAMERA_LEGS[l.kind]) {
      // a live leg (LIFT): the hero drops back from where it is and the light tweens back
      if (ROOM.skill && ROOM.skill.cancel) ROOM.skill.cancel('reverse');
      if (l.kind === 'lift') {
        startTween(l.to, l.from, Math.max(1, t));
        if (move.from.mode === 'skill') closeBoard();
      }
      l.kind = l.kind === 'lift' ? 'drop' : l.kind === 'drop' ? 'lift' : l.kind;
      var tmp = l.from;
      l.from = l.to;
      l.to = tmp;
      scene = l.to;
      R().applyPlace(l.to);
      l.t0 = now;
      l.dur = Math.max(1, t);
      ROOM.emit('nav', { phase: 'cancel', from: m.from, to: m.to, kind: 'reverse' });
      return true;
    }
    // a camera leg plays backwards from its current time at the same speed
    l.rev = { at: Math.min(t, l.dur), now0: now };
    l.swapEnds = true;
    ROOM.emit('nav', { phase: 'cancel', from: m.from, to: m.to, kind: 'reverse' });
    return true;
  }
  function retarget(to, opts) {
    var m = move, l = m.leg;
    var now = ROOM.now();
    if (!l || !l.r) {
      pending = { place: to, opts: opts };
      return true;
    }
    R().retargetTurn(l.r, { kind: 'turn', from: m.from, to: to, lsFrom: lsFull(m.from), lsTo: lsFull(to), dir: l.dir }, now - l.t0);
    l.dur = l.r.dur;
    l.to = to;
    m.to = to;
    m.ahead = (m.ahead || 1) + 1;
    if (opts.history !== false) replace(urlOf(to));
    ROOM.emit('nav', { phase: 'cancel', from: m.from, to: to, kind: 'retarget' });
    return true;
  }
  /** Land the running move at once (resize, hidden tab, context loss: D4 5.5). */
  function snapMove() {
    if (!move) return;
    if (move.leg && !CAMERA_LEGS[move.leg.kind] && ROOM.skill && ROOM.skill.cancel) ROOM.skill.cancel('snap');
    if (move.reversed && move.leg && move.leg.r) {
      // a reversed camera leg lands where it started
      move.legs = [move.leg];
      move.i = 0;
    }
    finishInstant();
  }

  /* ------------------------------------------------------------------ the clock (render.js tick calls it) */
  function tick(now) {
    if (!move) {
      if (tween && now - tween.t0 >= tween.dur) tween = null;
      return busy() ? 'live' : null;
    }
    var l = move.leg;
    if (!l) return 'live';
    var t = now - l.t0;
    if (l.rev) t = l.rev.at - (now - l.rev.now0);
    if (CAMERA_LEGS[l.kind]) {
      if (l.rev && t <= 0) {
        R().endLeg();
        move.legs = [l];
        move.i = 0;
        scene = move.to;
        land();
        return 'live';
      }
      if (R().drawLeg(l.r, Math.max(0, t))) return 'drawn';
      R().endLeg();
      scene = l.to;
      R().applyPlace(l.to);
      nextLeg(now);
      return 'live';
    }
    if (t >= l.dur) {
      if (l.kind === 'lift' && move.i === move.legs.length - 1) tween = null;
      nextLeg(now);
    }
    return 'live';
  }

  /* ------------------------------------------------------------------ boards */
  var closing = false;
  function openBoard(p, opts) {
    if (!ROOM.ui || typeof ROOM.ui.open !== 'function') return;
    if (ROOM.state.panel === p.item) return;
    // skill.js opens the board itself during LIFT (P3); this is the landing fallback (and the W0 stub path)
    ROOM.ui.open(p.item, { opener: (opts && opts.opener) || null, side: 'right', hero: true });
  }
  function closeBoard() {
    if (!ROOM.state.panel || !ROOM.ui || typeof ROOM.ui.close !== 'function') return;
    closing = true;
    try {
      ROOM.ui.close({ restore: true });
    } finally {
      closing = false;
    }
  }
  /** Board dim without a move (STATS, potions, ui: ids): not navigation, only the dim (D4 5.8). */
  function setBoardDim(on) {
    var p = scene || cur;
    var k = on ? 1 : 0;
    if (p && p.mode === 'skill') {
      boardDim = { k: 0, from: 0, to: 0, t0: 0 };
      return;
    }
    if (boardDim.to === k) return;
    var now = ROOM.now();
    boardDim = { k: k, from: boardDimK(now), to: k, t0: now };
    if (ROOM.invalidate) ROOM.invalidate();
  }

  /* ------------------------------------------------------------------ input helpers */
  function up(opts) {
    var t = target();
    if (!t || t.mode === 'overview' || !overviewOn()) return false;
    return request({ mode: 'overview', ret: baseOf(t) }, opts);
  }
  function down(opts) {
    var t = target();
    if (!t || t.mode !== 'overview') return false;
    return request(t.ret || wall('front'), Object.assign({ dismiss: true }, opts || {}));
  }
  /** Step out: skill -> its backdrop place; zone -> its wall; overview -> where it came from. */
  function back(opts) {
    var t = target();
    if (!t) return false;
    if (t.mode === 'skill') return request(baseOf(t), Object.assign({ dismiss: true }, opts || {}));
    if (t.mode === 'overview') return down(opts);
    if (t.mode === 'zone') return request(wall(t.view), opts);
    return false;
  }
  function go(zoneId, opts) {
    opts = opts || {};
    var o = { history: opts.push !== false && opts.history !== false, instant: !!opts.instant, source: opts.source };
    if (!zoneId) {
      var t = target();
      return request(wall(t ? t.view : ROOM.state.view), o);
    }
    if (!ROOM.zoneById(zoneId)) return false;
    return request({ mode: 'zone', zone: zoneId }, o);
  }
  function turnTo(v, opts) {
    opts = opts || {};
    v = ROOM.normView(v);
    if (ROOM.viewList().indexOf(v) < 0) return false;
    return request(wall(v), { history: opts.push !== false && opts.history !== false, instant: !!opts.instant });
  }
  function turn(dir, opts) {
    var t = target();
    var v = ROOM.viewToward(t ? t.view : ROOM.state.view, dir);
    return v ? turnTo(v, opts) : false;
  }

  /* ------------------------------------------------------------------ routes (browser) */
  /** The place a URL names, or null; {place, fix} where fix is the canonical URL to replace with. */
  function placeFromUrl(src) {
    var r = parseRoute(src);
    if (!r) return null;
    if (!r.a) return { place: wall('front') };
    if (r.a === 'overview' && !r.b) return overviewOn() ? { place: full({ mode: 'overview' }, cur) } : { place: wall('front'), fix: true };
    if (!r.b && r.a !== 'front' && ROOM.viewList().indexOf(r.a) >= 0) return { place: wall(r.a) };
    var z = ROOM.zoneById(r.a);
    if (!z) return null;
    if (!r.b) return { place: zonePlace(z.id) };
    var items = ROOM.art.items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind !== 'hotspot' || it.of || !it.target) continue;
      var iz = zoneOfItem(it);
      if (iz && iz.id === z.id && it.id.split('.').slice(1).join('-') === r.b) {
        var sp = skillPlaceOf(it.id, cur);
        if (sp) return { place: sp, fix: sp.mode !== 'skill' };
      }
    }
    return { place: zonePlace(z.id), fix: true };
  }
  /** Boot: land instantly on the URL's place (skill deep links open the board, base wall). */
  function boot(src) {
    cur = placeFromState();
    var r = placeFromUrl(src);
    if (r && r.place && !same(r.place, cur)) {
      if (r.place.mode === 'skill') r.place.base = 'wall';
      start(r.place, { history: false, instant: true, source: 'route' });
    } else if (R()) R().applyPlace(cur);
    var url = urlOf(cur);
    if (!sameUrl(curUrl(), url)) history.replaceState(null, '', url);
  }
  /** popstate / hashchange: animate to the URL's place (instant under reduced motion). */
  function route(src) {
    if (ignorePop > 0) {
      ignorePop--;
      return;
    }
    var top = pushed[pushed.length - 1];
    if (top && sameUrl(top.below, curUrl())) pushed.pop();
    else pushed = [];
    var r = placeFromUrl(src);
    if (!r) {
      history.replaceState(null, '', urlOf(target()));
      return;
    }
    var t = target();
    if (same(r.place, t)) return;
    request(r.place, { history: false, source: 'route' });
    if (r.fix) history.replaceState(null, '', urlOf(r.place));
  }

  /* ------------------------------------------------------------------ pre-warm */
  var warmTimer = 0, warmKey = '';
  function prewarm() {
    clearTimeout(warmTimer);
    warmTimer = 0;
    if (reduced() || busy() || document.hidden || !R() || !R().view || !cur || cur.mode === 'skill') return;
    if (navigator.webdriver && !/[?&]prewarm=1\b/.test(window.location.search)) return;
    var key = [cur.mode, cur.view, cur.zone, R().view.Wd, R().view.Hd].join('|');
    if (key === warmKey) return;
    warmKey = key;
    var jobs = [];
    [-1, 1].forEach(function (dir) {
      var v = ROOM.viewToward(cur.view, dir);
      if (v) jobs.push(function () {
        R().snap(wall(v), lsFull(wall(v)), (ROOM.viewConf(v) || {}).art, R().cameraFor(wall(v)).z);
      });
    });
    var idle = window.requestIdleCallback || function (fn) {
      return setTimeout(fn, 50);
    };
    (function run() {
      if (!jobs.length || busy()) return;
      idle(function () {
        if (busy()) return;
        var j = jobs.shift();
        try {
          j();
        } catch (e) {
          /* a pre-warm failure only costs the cache */
        }
        run();
      });
    })();
  }
  function schedulePrewarm() {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(prewarm, 1000);
  }

  /* ------------------------------------------------------------------ export */
  ROOM.on('nav', function (d) {
    if (d.phase === 'land') schedulePrewarm();
  });
  // A board closed by itself (Esc, Close, scrim) while its skill place is up: step back to the backdrop.
  ROOM.on('state', function () {
    if (closing) return;
    var t = target();
    if (t && t.mode === 'skill' && !ROOM.state.panel && !(move && move.leg && move.leg.kind === 'lift' && !move.reversed)) back();
  });

  ROOM.nav = {
    get place() {
      return cur || placeFromState();
    },
    get target() {
      return target();
    },
    get scenePlace() {
      return scene || cur || null;
    },
    get busy() {
      return busy();
    },
    get leg() {
      return move && move.leg && move.leg.r ? { kind: move.leg.kind, u: move.leg.r.u, dir: move.leg.r.dir } : null;
    },
    ls: ls,
    request: request,
    up: up,
    down: down,
    back: back,
    heading: function () {
      return false; // A1: Left/Right do nothing in the overview
    },
    whenIdle: function () {
      return new Promise(function (resolve) {
        (function wait() {
          if (!busy()) resolve();
          else setTimeout(wait, 16);
        })();
      });
    },
    // v3.5 wrappers and engine hooks
    go: go,
    turn: turn,
    turnTo: turnTo,
    tick: tick,
    snapMove: snapMove,
    setBoardDim: setBoardDim,
    skillPlaceOf: skillPlaceOf,
    placeFromUrl: placeFromUrl,
    urlOf: urlOf,
    boot: boot,
    route: route,
    overviewOn: overviewOn,
    planFor: planFor,
    policy: policy,
    routeOf: routeOf,
    parseRoute: parseRoute,
    debug: function () {
      return {
        place: cur,
        target: target(),
        move: move ? { kind: move.legs.map(function (l) { return l.kind; }).join('+'), leg: move.i, reversed: move.reversed } : null,
        pending: pending ? pending.place : null,
        pushed: pushed.length,
      };
    },
  };
  ROOM.feature = ROOM.feature || {};
  ROOM.feature.busy = function () {
    return busy();
  };
})();
