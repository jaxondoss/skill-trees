/* FORGE room prototype: the Today HUD.
 *
 * A pixel window (right side on a laptop, bottom sheet on a phone) titled from the data
 * ("TODAY · TUE 20 OCT · CLASS HEAVY"), a completion bar drawn as a strip of sky (dusk to gold), and
 * today's goals in RACK, BALANCE and STRETCH groups.
 *   Tap a row: log the planned tier, or undo. Long-press (450 ms) or right-click: tier menu.
 *   Swipe a row left or press S: swap it for the next-best goal (once per day).
 *   Keys inside: Up/Down move, Space toggles, 1/2/3 pick Floor/Standard/Stretch, 0 clears, Esc closes.
 * A log updates ROOM.data (goal.result, todayP), emits "log" and "data", fires ROOM.mote without
 * waiting for it, and tinks. UNDO shows in the header for 5 s after a log or swap.
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  var K = ROOM.uikit;
  ROOM.ui = ROOM.ui || {};

  var WEIGHT = { floor: 0.5, standard: 1, stretch: 1.2 };
  var TIERS = ['floor', 'standard', 'stretch'];
  var LETTER = { floor: 'F', standard: 'S', stretch: 'X' };
  var NAME = { floor: 'Floor', standard: 'Standard', stretch: 'Stretch' };
  var GROUPS = [
    { kind: 'rack', title: 'RACK' },
    { kind: 'balance', title: 'BALANCE' },
    { kind: 'stretch', title: 'STRETCH', opt: 'OPTIONAL' },
  ];
  var LONG_PRESS_MS = 450;
  var SWIPE_PX = 70;
  var UNDO_MS = 5000;

  /* ------------------------------------------------------------------ live region */
  if (!K.announce) {
    var live = K.h('div', { class: 'ui-sr', 'aria-live': 'polite', id: 'ui-live' });
    K.root().appendChild(live);
    K.announce = function (text) {
      live.textContent = '';
      setTimeout(function () {
        live.textContent = text;
      }, 30);
    };
  }

  /* ------------------------------------------------------------------ data */
  function goals() {
    return (ROOM.data && ROOM.data.goals) || [];
  }
  function goalById(id) {
    var g = goals();
    for (var i = 0; i < g.length; i++) if (g[i].id === id) return g[i];
    return null;
  }
  function core() {
    return goals().filter(function (g) {
      return g.kind !== 'stretch';
    });
  }
  /** todayP: floor 0.5, standard 1, stretch 1.2 over the core goals; stretch goals add to the numerator only. */
  function recompute(d) {
    var list = d.goals || [];
    var n = list.filter(function (g) {
      return g.kind !== 'stretch';
    }).length;
    if (!n) return d.todayP || 0;
    var num = list.reduce(function (a, g) {
      return a + (g.result ? WEIGHT[g.result] || 0 : 0);
    }, 0);
    d.todayP = Math.min(100, Math.round((100 * num) / n));
    // Keep today's square on the wall calendar in step.
    (d.calendar || []).forEach(function (c) {
      if (c.day === d.today) c.p = d.todayP;
    });
    return d.todayP;
  }
  function skillGoal(g) {
    var s = K.skill(g.skill);
    return (s && s.goals && s.goals[0]) || null;
  }
  /** Text and minutes for a goal at a tier (the skill's ladder, else the goal's own text). */
  function tierText(g, tier) {
    var sg = skillGoal(g);
    return (sg && sg[tier]) || g.text || '';
  }
  function tierMin(g, tier) {
    var sg = skillGoal(g);
    var m = sg && sg.minutes && sg.minutes[tier];
    return m != null ? m : g.estMin;
  }
  function catOf(g) {
    var s = K.skill(g.skill);
    return s ? s.category : 'gold';
  }
  function canSwap(g) {
    return !(ROOM.data && ROOM.data.swapUsed) && g.kind !== 'stretch' && !g.result;
  }
  function swapsLeft() {
    return ROOM.data && ROOM.data.swapUsed ? 0 : 1;
  }

  /* ------------------------------------------------------------------ logging */
  var undoState = null; // {type: 'log', goalId, prev} | {type: 'swap', index, goal, prevUsed}
  var undoTimer = 0;

  function pointFor(fromEl) {
    if (fromEl && fromEl.isConnected) {
      var box = fromEl.querySelector && fromEl.querySelector('.t-box');
      return K.centre(box || fromEl);
    }
    return { x: window.innerWidth - 60, y: 80 };
  }

  /**
   * Set a goal's result (a tier, or null to undo). opts.silent: no mote, tink or UNDO (used by undo).
   * Logging never waits on the animation: the data, events and sound go out at once.
   */
  function setResult(goalId, tier, fromEl, opts) {
    opts = opts || {};
    var d = ROOM.data;
    var g = goalById(goalId);
    if (!d || !g) return false;
    tier = tier || null;
    var prev = g.result || null;
    if (prev === tier) return false;
    var doneBefore = goals().filter(function (x) {
      return x.result;
    }).length;
    var from = pointFor(fromEl); // measure before the re-render replaces the row
    g.result = tier;
    recompute(d);
    K.emit('log', { goalId: goalId, result: tier });
    K.emit('data');
    if (tier && !opts.silent) {
      if (typeof ROOM.mote === 'function') {
        try {
          var p = ROOM.mote(from, K.itemForSkill(g.skill));
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) {
          /* the room is still loading: the log stands */
        }
      }
      if (ROOM.sound && typeof ROOM.sound.tink === 'function') ROOM.sound.tink(doneBefore);
    }
    if (!opts.silent) {
      setUndo({ type: 'log', goalId: goalId, prev: prev });
      K.announce(tier ? g.title + ' logged at ' + NAME[tier] + '. Today ' + d.todayP + '%.' : g.title + ' undone. Today ' + d.todayP + '%.');
    }
    return true;
  }

  /** Toggle: open goal -> its planned tier; done goal -> undo. */
  function toggle(goalId, fromEl) {
    var g = goalById(goalId);
    if (!g) return;
    setResult(goalId, g.result ? null : g.tier || 'standard', fromEl);
  }

  /** Swap an open core goal for the next-best skill not already on today's list. Once per day. */
  function swap(goalId) {
    var d = ROOM.data;
    var g = goalById(goalId);
    if (!d || !g) return false;
    if (!canSwap(g)) {
      K.announce(d.swapUsed ? "Today's swap is used." : 'Only open core goals can be swapped.');
      return false;
    }
    var taken = {};
    goals().forEach(function (x) {
      taken[x.skill] = true;
    });
    var cands = K.skills().filter(function (s) {
      return s.status === 'active' && !taken[s.slug] && s.goals && s.goals.length;
    });
    cands.sort(function (a, b) {
      return (b.neglected ? 1 : 0) - (a.neglected ? 1 : 0) || a.display - b.display;
    });
    var s = cands[0];
    if (!s) {
      K.announce('Nothing left to swap in today.');
      return false;
    }
    var tier = g.tier === 'stretch' ? 'standard' : g.tier || 'standard';
    var sg = s.goals[0];
    var next = {
      id: s.slug + '-' + g.kind, skill: s.slug, kind: g.kind, tier: tier, title: sg.name, text: sg[tier] || sg.standard,
      estMin: (sg.minutes && sg.minutes[tier]) || 0, result: null, nmt: false, swappedFrom: g.id,
    };
    var idx = d.goals.indexOf(g);
    d.goals.splice(idx, 1, next);
    var prevUsed = !!d.swapUsed;
    d.swapUsed = true;
    recompute(d);
    K.emit('swap', { goalId: g.id });
    K.emit('data');
    if (!d.live) setUndo({ type: 'swap', index: idx, goal: g, prevUsed: prevUsed, nextId: next.id });
    K.announce('Swapped ' + g.title + ' for ' + s.name + ': ' + next.title + '.');
    focusGoal(next.id);
    return true;
  }

  function setUndo(u) {
    undoState = u;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () {
      undoState = null;
      renderHead();
    }, UNDO_MS);
    renderHead();
  }
  function undo() {
    var u = undoState;
    if (!u) return;
    undoState = null;
    clearTimeout(undoTimer);
    var d = ROOM.data;
    if (u.type === 'log') {
      setResult(u.goalId, u.prev, null, { silent: true });
      K.announce('Undone.');
      focusGoal(u.goalId);
    } else if (u.type === 'swap' && d && d.goals[u.index] && d.goals[u.index].id === u.nextId) {
      d.goals.splice(u.index, 1, u.goal);
      d.swapUsed = u.prevUsed;
      recompute(d);
      K.emit('data');
      K.announce('Swap undone.');
      focusGoal(u.goal.id);
    }
    renderHead();
  }

  /* ------------------------------------------------------------------ window */
  var isOpen = false;
  var pinned = K.store.get('forge-room-today-pin') === '1';
  var opener = null;
  var win, bar, title, bPin, bClose, body, head, sub, skyFill, skyPct, listWrap;

  function build() {
    title = K.h('h2', { class: 'pxw-title', id: 'today-title' });
    bPin = K.h('button', { type: 'button', class: 'px-tool', 'aria-label': 'Pin open', on: { click: function () {
      pinned = !pinned;
      K.store.set('forge-room-today-pin', pinned ? '1' : '0');
      bPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    } } }, K.icon('pin'));
    bPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    bClose = K.h('button', { type: 'button', class: 'px-tool', 'aria-label': 'Close today', on: { click: function () {
      setOpen(false, { restore: true });
    } } }, K.icon('close'));
    bar = K.h('div', { class: 'pxw-bar' }, title, bPin, bClose);
    head = K.h('div', { class: 'today-head' });
    listWrap = K.h('div', { class: 'today-groups' });
    body = K.h('div', { class: 'pxw-body' }, head, listWrap);
    win = K.h('section', { class: 'pxw today-hud', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'today-title', hidden: true }, bar, body);
    win.addEventListener('keydown', onKey);
    K.root().appendChild(win);
  }

  function renderHead() {
    if (!win) return;
    var d = ROOM.data || {};
    title.textContent = ['TODAY', d.weekdayLabel, d.dayType].filter(Boolean).join(' · ');
    var p = Math.round(d.todayP || 0);
    var c = core();
    var done = c.filter(function (g) {
      return g.result;
    }).length;
    head.textContent = '';
    skyFill = K.h('span', { class: 'sky-fill' });
    skyFill.style.width = 'calc(' + p + '% - ' + (2 * p) / 100 + 'px)';
    skyFill.style.backgroundSize = (10000 / Math.max(p, 1)).toFixed(2) + '% 100%';
    var track = K.h('span', { class: 'sky-track', 'aria-hidden': 'true' }, skyFill,
      [25, 60, 85].map(function (t) {
        return K.h('span', { class: 'sky-tick', style: { left: t + '%' } });
      }));
    skyPct = K.h('span', { class: 'sky-pct', text: p + '%' });
    var bar = K.h('div', { class: 'sky-bar', role: 'meter', 'aria-label': "Today's completion", 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p }, track, skyPct);
    var bUndo = undoState ? K.h('button', { type: 'button', class: 'today-undo', on: { click: undo }, 'aria-label': 'Undo the last change' }, 'UNDO') : null;
    sub = K.h('div', { class: 'today-sub' },
      K.h('span', { class: 'px-num', text: c.length ? done + ' OF ' + c.length + ' CORE' : 'NO CORE GOALS' }),
      K.h('span', { class: 'grow' }),
      c.length ? K.h('span', { text: swapsLeft() ? '1 SWAP LEFT' : 'SWAP USED' }) : null,
      bUndo);
    head.appendChild(bar);
    head.appendChild(sub);
    bPin.hidden = K.isPhone();
  }

  function renderList() {
    var keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.goal : null;
    listWrap.textContent = '';
    var all = goals();
    if (!all.length) {
      listWrap.appendChild(K.h('p', { class: 'today-empty', text: 'No goals yet. Pick skills for the rack and today fills in.' }));
      return;
    }
    GROUPS.forEach(function (gr) {
      var list = all.filter(function (g) {
        return g.kind === gr.kind;
      });
      if (!list.length) return;
      var hid = 'today-group-' + gr.kind;
      listWrap.appendChild(K.h('h3', { class: 'today-group', id: hid }, gr.title, gr.opt ? K.h('span', { class: 'opt', text: gr.opt }) : null));
      var ul = K.h('ul', { class: 'today-list', 'aria-labelledby': hid });
      list.forEach(function (g) {
        ul.appendChild(row(g));
      });
      listWrap.appendChild(ul);
    });
    if (!K.isTouch()) {
      listWrap.appendChild(K.h('p', { class: 'today-hint' },
        'Click to log, right-click for tiers. Keys ', K.h('kbd', { text: '1' }), K.h('kbd', { text: '2' }), K.h('kbd', { text: '3' }),
        ' pick a tier, ', K.h('kbd', { text: 'S' }), ' swaps.'));
    } else {
      listWrap.appendChild(K.h('p', { class: 'today-hint', text: 'Tap to log. Hold for tiers. Swipe left to swap (one a day).' }));
    }
    if (keep) focusGoal(keep, true);
  }

  function row(g) {
    var tier = g.result || g.tier || 'standard';
    var done = !!g.result;
    var min = tierMin(g, tier);
    var descId = 'today-desc-' + g.id;
    var btn = K.h('button', {
      type: 'button', class: 't-row', 'data-goal': g.id, 'data-result': g.result || '',
      'aria-pressed': done ? 'true' : 'false',
      'aria-label': (done ? 'Undo: ' : 'Complete: ') + g.title,
      'aria-describedby': descId,
    },
      K.h('span', { class: 't-box', 'aria-hidden': 'true' }, done ? K.icon('check') : null),
      K.h('span', { class: 't-main' },
        K.h('span', { class: 't-title' }, g.title, g.nmt && !done ? K.h('i', { class: 't-nmt', title: 'Never miss twice' }) : null),
        K.h('span', { class: 't-text', text: tierText(g, tier) })),
      K.h('span', { class: 't-meta', 'aria-hidden': 'true' },
        K.h('span', { class: 't-cat' }),
        K.h('span', { class: 't-tier', 'data-tier': tier, text: LETTER[tier] }),
        K.h('span', { class: 't-min' }, min ? String(min) : '--', min ? K.h('small', { text: 'M' }) : null)),
      K.h('span', { class: 'ui-sr', id: descId, text: (done ? 'Done at ' : 'Planned ') + NAME[tier] + (min ? ', ' + min + ' minutes' : '') + '. ' + (K.skill(g.skill) ? K.skill(g.skill).name + '. ' : '') + (g.nmt && !done ? 'Never miss twice. ' : '') }),
    );
    K.catVars(btn, catOf(g));
    wireRow(btn, g.id);
    return K.h('li', { class: canSwap(g) ? '' : 'no-swap', 'data-goal': g.id }, btn);
  }

  /* ------------------------------------------------------------------ gestures */
  function wireRow(btn, id) {
    var press = null; // {x0, y0, timer, dragging, dx, pid}
    var suppress = false;

    btn.addEventListener('click', function (e) {
      if (suppress) {
        suppress = false;
        e.preventDefault();
        return;
      }
      toggle(id, btn);
    });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!menu) openMenu(id, btn, e.clientX, e.clientY);
    });
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      press = { x0: e.clientX, y0: e.clientY, dx: 0, dragging: false, pid: e.pointerId };
      press.timer = setTimeout(function () {
        if (!press || press.dragging) return;
        suppress = true;
        var p = press;
        press = null;
        openMenu(id, btn, p.x0, p.y0);
      }, LONG_PRESS_MS);
    });
    btn.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.pid) return;
      var dx = e.clientX - press.x0, dy = e.clientY - press.y0;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(press.timer);
      if (!press.dragging && dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        press.dragging = true;
        btn.classList.add('is-dragging');
        try {
          btn.setPointerCapture(e.pointerId);
        } catch (err) {
          /* fine */
        }
      }
      if (press.dragging) {
        press.dx = Math.max(-120, Math.min(0, dx));
        btn.style.transform = 'translateX(' + press.dx + 'px)';
      }
    });
    function end(commit) {
      if (!press) return;
      clearTimeout(press.timer);
      var p = press;
      press = null;
      if (p.dragging) {
        suppress = true;
        setTimeout(function () {
          suppress = false;
        }, 80);
        btn.classList.remove('is-dragging');
        btn.style.transform = '';
        if (commit && p.dx <= -SWIPE_PX) swap(id);
      }
    }
    btn.addEventListener('pointerup', function () {
      end(true);
    });
    btn.addEventListener('pointercancel', function () {
      end(false);
    });
    btn.addEventListener('lostpointercapture', function (e) {
      // Touch starts with an implicit capture on the inner span; only our own capture ending counts.
      if (e.target === btn && press && press.dragging) end(true);
    });
  }

  /* ------------------------------------------------------------------ tier menu */
  var menu = null;
  function openMenu(id, btn, x, y) {
    closeMenu();
    var g = goalById(id);
    if (!g) return;
    var items = TIERS.map(function (t, i) {
      return K.h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': g.result === t ? 'true' : 'false', 'data-tier': t, tabindex: '-1' },
        NAME[t], K.h('span', { class: 'k', text: String(i + 1) }));
    });
    var undoItem = K.h('button', { type: 'button', role: 'menuitem', 'data-tier': '', tabindex: '-1' }, 'Undo', K.h('span', { class: 'k', text: '0' }));
    if (!g.result) undoItem.setAttribute('aria-disabled', 'true');
    var swapItem = canSwap(g) ? K.h('button', { type: 'button', role: 'menuitem', 'data-swap': '1', tabindex: '-1' }, 'Swap', K.h('span', { class: 'k', text: 'S' })) : null;
    menu = K.h('div', { class: 'px-menu', role: 'menu', 'aria-label': 'Tier for ' + g.title }, items, undoItem, swapItem);
    menu._for = { id: id, btn: btn };
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[role^="menuitem"]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      var target = menu._for;
      closeMenu(true);
      if (b.dataset.swap) swap(target.id);
      else setResult(target.id, b.dataset.tier || null, rowBtn(target.id));
    });
    menu.addEventListener('keydown', onMenuKey);
    K.root().appendChild(menu);
    // Place it by the row, inside the viewport.
    var r = btn.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = x != null ? x - mw / 2 : r.right - mw - 8;
    var top = r.bottom + 2;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 2);
    left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    var first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-tier="' + (g.tier || 'standard') + '"]');
    (first || items[0]).focus();
  }
  function menuItems() {
    return menu ? Array.prototype.slice.call(menu.querySelectorAll('[role^="menuitem"]')) : [];
  }
  function onMenuKey(e) {
    var list = menuItems();
    var i = list.indexOf(document.activeElement);
    var k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      var n = k === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n].focus();
    } else if (k === 'Home') list[0].focus();
    else if (k === 'End') list[list.length - 1].focus();
    else if (k === 'Escape') closeMenu(true);
    else if (k === 'Tab') closeMenu(true);
    else if (k >= '0' && k <= '3') {
      var t = menu._for;
      closeMenu(true);
      setResult(t.id, k === '0' ? null : TIERS[+k - 1], rowBtn(t.id));
    } else if (k === 's' || k === 'S') {
      var t2 = menu._for;
      closeMenu(true);
      swap(t2.id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function closeMenu(refocus) {
    if (!menu) return;
    var f = menu._for;
    menu.remove();
    menu = null;
    if (refocus && f) {
      var b = rowBtn(f.id);
      if (b) b.focus();
    }
  }
  document.addEventListener('pointerdown', function (e) {
    if (menu && !menu.contains(e.target)) closeMenu(false);
  }, true);

  /* ------------------------------------------------------------------ keyboard */
  function rows() {
    return win ? Array.prototype.slice.call(win.querySelectorAll('.t-row')) : [];
  }
  function rowBtn(id) {
    return win ? win.querySelector('.t-row[data-goal="' + id + '"]') : null;
  }
  function focusGoal(id, quiet) {
    var b = rowBtn(id);
    if (b && isOpen) b.focus({ preventScroll: !!quiet });
  }
  function focusFirst() {
    var r = rows();
    var first = r.filter(function (b) {
      return b.getAttribute('aria-pressed') !== 'true';
    })[0] || r[0];
    (first || bClose).focus();
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    var onRow = t && t.classList && t.classList.contains('t-row');
    var k = e.key;
    if (k === 'Escape') {
      setOpen(false, { restore: true });
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      var r = rows();
      if (!r.length) return;
      var i = r.indexOf(t);
      var n = i < 0 ? 0 : k === 'ArrowDown' ? Math.min(r.length - 1, i + 1) : Math.max(0, i - 1);
      r[n].focus();
    } else if (onRow && k >= '1' && k <= '3') {
      setResult(t.dataset.goal, TIERS[+k - 1], t);
    } else if (onRow && (k === '0' || k === 'Delete' || k === 'Backspace')) {
      setResult(t.dataset.goal, null, t);
    } else if (onRow && (k === 's' || k === 'S')) {
      swap(t.dataset.goal);
    } else if (onRow && (k === 'ContextMenu' || (k === 'F10' && e.shiftKey))) {
      openMenu(t.dataset.goal, t);
    } else if (onRow && (k === 'u' || k === 'U') && undoState) {
      undo();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /* ------------------------------------------------------------------ open / close */
  function layout() {
    if (!win) return;
    win.classList.toggle('is-sheet', K.isPhone());
  }

  function setOpen(open, opts) {
    opts = opts || {};
    if (!win) return;
    if (open === isOpen) {
      if (open && opts.focus) focusFirst();
      return;
    }
    isOpen = open;
    ROOM.state.todayOpen = open;
    if (open) {
      opener = opts.opener || (document.activeElement !== document.body ? document.activeElement : null);
      layout();
      render();
      win.hidden = false;
      if (opts.focus !== false) focusFirst();
    } else {
      closeMenu(false);
      var hadFocus = win.contains(document.activeElement);
      win.hidden = true;
      if (hadFocus && opts.restore !== false && opener) K.restoreFocus(opener);
      opener = null;
    }
    K.emit('state');
  }

  function render() {
    if (!win || !isOpen) return;
    renderHead();
    renderList();
  }

  // Click outside closes the HUD unless it is pinned (laptop) or the click is on other ui.
  document.addEventListener('pointerdown', function (e) {
    if (!isOpen || (pinned && !K.isPhone())) return;
    var t = e.target;
    if (win.contains(t) || (menu && menu.contains(t))) return;
    if (t.closest && t.closest('.ui-strip, .ui-drawer, .ui-drawer-btn, .ui-help, .ui-panel')) return;
    setOpen(false, { restore: false });
  }, true);

  build();
  K.on('data', render);
  window.addEventListener('resize', function () {
    layout();
    if (isOpen) renderHead();
  });

  /* ------------------------------------------------------------------ public */
  ROOM.ui.toggleToday = function (open, opts) {
    var next = open == null ? !isOpen : !!open;
    setOpen(next, opts || { focus: true, restore: true });
  };
  ROOM.uiToday = {
    setResult: setResult,
    toggle: toggle,
    swap: swap,
    recompute: function () {
      return ROOM.data ? recompute(ROOM.data) : 0;
    },
    get open() {
      return isOpen;
    },
    get pinned() {
      return pinned && !K.isPhone();
    },
    NAME: NAME,
    LETTER: LETTER,
    tierText: tierText,
    tierMin: tierMin,
  };

  // A pinned HUD comes back open on a laptop.
  if (pinned && !K.isPhone()) setOpen(true, { focus: false });
})();
