/* FORGE room prototype: relics.
 *
 * Three slots (left mount by the door, window niche, right bracket by the gym). An empty slot opens the
 * catalog: a pixel shop shelf of about 50 relics by category, plus a custom one. Choosing a relic sets
 * its title, linked skill, target or steps and an optional deadline (ROOM.data.relics, sample state).
 * An active relic panel shows progress and its forge state (iron, hot, gold); "Forge it" simulates
 * achieving it: anvil strike and hiss, and the relic moves to the trophy case (listed in the archive).
 * The engine draws the slot, the relic on its mount and the ember glow (engine/glow.js).
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  var K = ROOM.uikit;
  var h = K.h;

  // [category, default skill, [[name, icon word], ...]]
  var CATALOG = [
    ['Business and AI', 'dropshipping', [
      ['First sale', 'coin'], ['First $1,000 month', 'coins'], ['$10,000 month', 'vault'], ['Launch a store', 'storefront'],
      ['First product with 100 users', 'crowd'], ['First paying client', 'handshake'], ['Fully automated store', 'gear'],
      ['Sell a business', 'key'], ['Ship an app in a weekend', 'rocket'],
    ]],
    ['School', 'academics', [
      ['4.0 semester', 'scroll'], ["Dean's List", 'ribbon'], ['Research with a professor', 'flask'], ['Internship offer', 'briefcase'],
      ['Leadership role', 'flag'], ['Graduate with honors', 'cap'], ['Study abroad', 'globe'], ['Ace a final', 'star'],
    ]],
    ['Reading', 'reading', [
      ['25 books in a year', 'book'], ['Finish a classic', 'quill'], ['500 effective wpm', 'bolt'], ['100 books', 'tower'],
    ]],
    ['Athletics', 'running', [
      ['70.3 triathlon', 'trident'], ['Half marathon under 1:45', 'stopwatch'], ['First marathon', 'medal'],
      ['Marathon under 3:30', 'wing'], ['Bench 275', 'plate'], ['Squat 405', 'barbell'], ['190 lb lean', 'scale'],
      ['Sprint triathlon', 'wave'], ['1,000 miles in a year', 'road'],
    ]],
    ['Sleep', 'sleep', [['30 nights in window', 'moon'], ['A semester of good sleep', 'pillow']]],
    ['Nutrition', 'food', [['30 days of protein', 'egg'], ['Cook 15 meals', 'pan'], ['30 plants in a week', 'leaf']]],
    ['Mind', 'chess', [
      ['Chess 1500', 'pawn'], ['Chess 1800', 'knight'], ['Chess 2000', 'king'], ['100 days of meditation', 'lotus'],
      ['Plan every day for a semester', 'calendar'], ['365-day visualization', 'eye'],
    ]],
    ['College life', 'college-integration', [['Lead a club', 'banner'], ['Friends of a lifetime', 'hands'], ['A mentor professor', 'lamp']]],
    ['Life goals', null, [
      ['Europe trip', 'compass'], ['Launch a video channel', 'camera'], ['1,000 subscribers', 'bell'], ['Learn a language', 'speech'],
      ['Save a set amount', 'jar'], ['Climb a mountain', 'peak'], ['Run a race abroad', 'passport'],
    ]],
    ['Custom', null, [['Custom relic', 'anvil']]],
  ];
  var SKILL_HINT = { 'Mind': { 'meditation': /meditation/i, 'time-blocking': /plan/i, 'visualization': /visual/i }, 'Athletics': { strength: /bench|squat|lb/i, triathlon: /triathlon/i } };

  // 9x9 glyphs per category (the icon word is the accessible description).
  var GLYPH = {
    'Business and AI': ['..#####..', '.#.....#.', '#..###..#', '#.#....##', '#..###..#', '#.....#.#', '#..###..#', '.#.....#.', '..#####..'],
    School: ['....#....', '..#####..', '#########', '..#####..', '..#...#..', '..#####..', '....#....', '....#....', '...###...'],
    Reading: ['.........', '##.....##', '#.##.##.#', '#...#...#', '#...#...#', '#...#...#', '#...#...#', '##..#..##', '..##.##..'],
    Athletics: ['..#####..', '..#...#..', '...#.#...', '....#....', '..#####..', '.#.....#.', '.#..#..#.', '.#.....#.', '..#####..'],
    Sleep: ['...####..', '..##.....', '.##......', '.##......', '.##......', '.##......', '..##.....', '...####..', '.........'],
    Nutrition: ['.......##', '.....###.', '...####..', '..####...', '.####....', '.###.....', '.##......', '#........', '.........'],
    Mind: ['...###...', '..#####..', '...###...', '....#....', '...###...', '..#####..', '..#####..', '.#######.', '#########'],
    'College life': ['#........', '######...', '#######..', '######...', '#........', '#........', '#........', '#........', '#........'],
    'Life goals': ['....#....', '...###...', '..#.#.#..', '.#..#..#.', '....#....', '...###...', '..#####..', '.#######.', '#########'],
    Custom: ['.........', '#######..', '.########', '..######.', '...###...', '...###...', '..#####..', '.#######.', '.........'],
  };

  function catOf(name) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i][0] === name) return CATALOG[i];
    return CATALOG[CATALOG.length - 1];
  }
  function glyph(cat, tone, label) {
    return K.bitmap(GLYPH[cat] || GLYPH.Custom, { '#': tone || 'currentColor' }, 'relic-glyph', label);
  }
  function skillFor(cat, name) {
    var c = catOf(cat);
    var hint = SKILL_HINT[cat];
    if (hint) for (var k in hint) if (hint[k].test(name)) return k;
    return c[1];
  }

  /* ------------------------------------------------------------------ data */
  function sample() {
    return {
      slots: {
        left: { title: 'First $1,000 month', icon: 'coins', cat: 'Business and AI', skill: 'dropshipping', target: '$1,000 revenue in one month', deadline: '2026-12-31', progress: 0.42 },
        window: { title: 'Half marathon under 1:45', icon: 'stopwatch', cat: 'Athletics', skill: 'running', target: '13.1 mi in 1:44:59', deadline: '2027-03-14', progress: 0.7 },
        right: null,
      },
      trophies: [{ title: '30 days of protein', icon: 'egg', cat: 'Nutrition', day: '2026-09-28' }],
    };
  }
  function ensure() {
    var d = ROOM.data;
    if (!d) return null;
    if (!d.relics) d.relics = ROOM.dataKey === 'fresh' ? { slots: { left: null, window: null, right: null }, trophies: [] } : sample();
    d.relics.slots = d.relics.slots || { left: null, window: null, right: null };
    d.relics.trophies = d.relics.trophies || [];
    return d.relics;
  }
  ensure();
  if (typeof ROOM.on === 'function') ROOM.on('data', ensure);

  function get(slot) {
    var r = ensure();
    return r ? r.slots[slot] || null : null;
  }
  function changed() {
    K.emit('data');
    if (typeof ROOM.invalidate === 'function') ROOM.invalidate();
  }

  var SLOT_NAME = { left: 'Left mount by the door', window: 'Niche above the window', right: 'Right bracket by the gym' };
  var picking = {}; // slot -> catalog entry being configured

  /* ------------------------------------------------------------------ panel */
  function render(el, slot, ctx) {
    var rel = get(slot);
    if (picking[slot]) return renderForm(el, slot, ctx, picking[slot]);
    if (rel && !ctx.catalog) return renderActive(el, slot, ctx, rel);
    renderCatalog(el, slot, ctx);
  }

  function renderCatalog(el, slot, ctx) {
    el.appendChild(h('div', { class: 'px-label', text: SLOT_NAME[slot] + ' · pick a relic' }));
    el.appendChild(h('p', { class: 'p-text px-muted', text: 'A relic is one big goal. It sits on this mount and glows while you work on it.' }));
    CATALOG.forEach(function (c) {
      el.appendChild(h('div', { class: 'px-label relic-cat', text: c[0] }));
      var shelf = h('div', { class: 'relic-shelf', role: 'list' });
      c[2].forEach(function (r) {
        var b = h('button', { type: 'button', class: 'relic-item', role: 'listitem', 'data-k': 'relic-' + r[0], 'aria-label': r[0] + ', ' + r[1],
          on: { click: function () {
            picking[slot] = { cat: c[0], title: r[0] === 'Custom relic' ? '' : r[0], icon: r[1] };
            ctx.rerender();
          } } }, glyph(c[0]), h('span', { class: 'nm', text: r[0] }), h('span', { class: 'ic', 'aria-hidden': 'true', text: r[1].toUpperCase() }));
        shelf.appendChild(b);
      });
      el.appendChild(shelf);
    });
  }

  function field(id, label, input) {
    return h('div', { class: 'relic-field' }, h('label', { for: id, class: 'px-label', text: label }), input);
  }

  function renderForm(el, slot, ctx, p) {
    el.appendChild(h('div', { class: 'p-head' }, glyph(p.cat, null, p.icon), h('div', { class: 'p-head-main' }, h('h3', { class: 'p-name', text: p.title || 'Custom relic' }), h('div', { class: 'p-level', text: p.cat }))));
    var title = h('input', { id: 'relic-title', class: 'px-field', type: 'text', maxlength: '48', value: p.title, 'data-k': 'relic-title' });
    var skill = h('select', { id: 'relic-skill', class: 'px-field', 'data-k': 'relic-skill' });
    skill.appendChild(h('option', { value: '', text: 'No linked skill' }));
    var want = skillFor(p.cat, p.title);
    K.skills().forEach(function (s) {
      var o = h('option', { value: s.slug, text: s.name });
      if (s.slug === want) o.selected = true;
      skill.appendChild(o);
    });
    var target = h('input', { id: 'relic-target', class: 'px-field', type: 'text', maxlength: '80', placeholder: 'A number to hit, or steps separated by commas', 'data-k': 'relic-target' });
    var deadline = h('input', { id: 'relic-deadline', class: 'px-field', type: 'date', 'data-k': 'relic-deadline' });
    el.appendChild(field('relic-title', 'Title', title));
    el.appendChild(field('relic-skill', 'Linked skill', skill));
    el.appendChild(field('relic-target', 'Target or steps', target));
    el.appendChild(field('relic-deadline', 'Deadline (optional)', deadline));
    el.appendChild(h('div', { class: 'p-actions' },
      h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'relic-set', text: 'Set on the mount', on: { click: function () {
        var t = title.value.trim();
        if (!t) {
          K.announce('Give the relic a title.');
          title.focus();
          return;
        }
        var steps = target.value.indexOf(',') >= 0 ? target.value.split(',').map(function (x) {
          return { text: x.trim(), done: false };
        }) : null;
        ensure().slots[slot] = { title: t, icon: p.icon, cat: p.cat, skill: skill.value || null, target: steps ? null : target.value.trim(), steps: steps, deadline: deadline.value || null, progress: 0 };
        delete picking[slot];
        K.announce(t + ' is on the mount.');
        changed();
        ctx.rerender();
      } } }),
      h('button', { type: 'button', class: 'px-btn', 'data-k': 'relic-back', text: 'Back to the shelf', on: { click: function () {
        delete picking[slot];
        ctx.rerender();
      } } })));
  }

  var FORGE_NAME = { iron: 'Dark iron', hot: 'Glowing hot', gold: 'Cast gold' };

  function renderActive(el, slot, ctx, rel) {
    var st = ROOM.glow ? ROOM.glow.forgeState(rel) : 'iron';
    var pct = Math.round((rel.progress || 0) * 100);
    var sk = rel.skill && K.skill(rel.skill);
    el.appendChild(h('div', { class: 'p-head' }, glyph(rel.cat, null, rel.icon),
      h('div', { class: 'p-head-main' }, h('h3', { class: 'p-name', text: rel.title }), h('div', { class: 'p-level', text: FORGE_NAME[st] + ' · ' + SLOT_NAME[slot] })),
      h('div', { class: 'p-score px-num', 'aria-label': 'Progress ' + pct + '%' }, String(pct), h('small', { text: '%' }))));
    el.appendChild(h('span', { class: 'px-meter', role: 'meter', 'aria-label': 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
      h('i', { style: { width: 'calc(' + pct + '% - ' + (2 * pct) / 100 + 'px)' } })));
    var ul = h('ul', { class: 'p-list' });
    ul.appendChild(h('li', null, 'Linked skill', h('span', { class: 'px-chip', text: sk ? sk.name : 'None' })));
    if (rel.target) ul.appendChild(h('li', null, 'Target', h('span', { text: rel.target })));
    if (rel.deadline) ul.appendChild(h('li', null, 'Deadline', h('span', { class: 'px-num', text: rel.deadline })));
    el.appendChild(ul);
    if (rel.steps && rel.steps.length) {
      el.appendChild(h('div', { class: 'px-label', text: 'Steps' }));
      var sl = h('ul', { class: 'p-list' });
      rel.steps.forEach(function (s, i) {
        sl.appendChild(h('li', null, h('label', null, h('input', { type: 'checkbox', checked: s.done ? true : undefined, 'data-k': 'relic-step-' + i, on: { change: function (e) {
          s.done = e.target.checked;
          rel.progress = rel.steps.filter(function (x) {
            return x.done;
          }).length / rel.steps.length;
          changed();
          ctx.rerender();
        } } }), ' ' + s.text)));
      });
      el.appendChild(sl);
    }
    el.appendChild(h('p', { class: 'p-text px-muted', text: 'Under a third it is dark iron, then it glows hot, and at 100% it is cast in gold.' }));
    el.appendChild(h('div', { class: 'p-actions' },
      h('button', { type: 'button', class: 'px-btn', 'data-k': 'relic-plus', text: 'Add 10%', on: { click: function () {
        rel.progress = Math.min(1, (rel.progress || 0) + 0.1);
        changed();
        ctx.rerender();
      } } }),
      h('button', { type: 'button', class: 'px-btn is-primary', 'data-k': 'relic-forge', text: 'Forge it', on: { click: function () {
        forge(slot);
        ctx.close();
      } } }),
      h('button', { type: 'button', class: 'px-btn', 'data-k': 'relic-clear', text: 'Take it down', on: { click: function () {
        ensure().slots[slot] = null;
        K.announce('The mount is empty.');
        changed();
        ctx.rerender();
      } } })));
  }

  /** Achieve a relic: anvil strike and hiss, it moves to the trophy case, the slot empties. */
  function forge(slot) {
    var r = ensure();
    var rel = r.slots[slot];
    if (!rel) return;
    rel.progress = 1;
    if (ROOM.sound) {
      if (typeof ROOM.sound.anvil === 'function') ROOM.sound.anvil();
      if (typeof ROOM.sound.hiss === 'function') ROOM.sound.hiss();
    }
    if (typeof ROOM.pulseStatue === 'function') ROOM.pulseStatue(1.5);
    changed();
    // Let the cast-gold relic glow for a moment on its mount, then it goes to the trophy case.
    setTimeout(function () {
      r.trophies.push({ title: rel.title, icon: rel.icon, cat: rel.cat, day: (ROOM.data && ROOM.data.today) || '' });
      if (r.slots[slot] === rel) r.slots[slot] = null;
      changed();
    }, ROOM.state && ROOM.state.reducedMotion ? 0 : 900);
    K.announce(rel.title + ' is forged. It moves to the trophy case.');
  }

  /** Trophy case list for the archive panel. */
  function trophyList(el) {
    var r = ensure();
    el.appendChild(h('div', { class: 'px-label', text: 'Trophy case · ' + r.trophies.length }));
    if (!r.trophies.length) {
      el.appendChild(h('p', { class: 'p-text px-muted', text: 'Forged relics land here.' }));
      return;
    }
    var ul = h('ul', { class: 'p-list relic-trophies' });
    r.trophies.forEach(function (t) {
      ul.appendChild(h('li', null, h('span', { class: 'relic-t' }, glyph(t.cat, K.hex('GOLD'), t.icon), t.title), h('span', { class: 'px-num', text: t.day || '' })));
    });
    el.appendChild(ul);
  }

  ROOM.uiRelics = { CATALOG: CATALOG, get: get, render: render, forge: forge, trophyList: trophyList, ensure: ensure };
})();
