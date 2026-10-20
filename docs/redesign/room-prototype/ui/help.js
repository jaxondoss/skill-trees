/* FORGE room prototype: the "?" help sheet (keys, mouse, touch). A modal dialog; Esc or ? closes it. */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  var K = ROOM.uikit;
  ROOM.ui = ROOM.ui || {};
  var h = K.h;

  var KEYS = [
    [['1', '7'], 'Step into a zone'],
    [['Left', 'Right'], 'Next or previous zone'],
    [['Enter'], 'Step in, then the first object'],
    [['Tab'], "Walk the zone's objects"],
    [['Esc'], 'Close, then step back out'],
    [['Shift'], 'Hold to show every name'],
    [['T'], 'Today'],
    [['P'], 'Photo mode'],
    [['D'], 'Prototype controls'],
    [['?'], 'This sheet'],
  ];
  var TODAY_KEYS = [
    [['Up', 'Down'], 'Move between goals'],
    [['Space'], 'Log the planned tier, or undo'],
    [['1', '2', '3'], 'Floor, Standard, Stretch'],
    [['0'], 'Clear the log'],
    [['S'], 'Swap the goal (one a day)'],
  ];
  var MOUSE = [
    ['Move', 'The room shifts with the pointer'],
    ['Click an object', 'Open its panel'],
    ['Click the room', 'Step into that zone, or close a panel'],
    ['Right-click a goal', 'Pick a tier'],
    ['Drag a goal left', 'Swap it'],
  ];
  var TOUCH = [
    ['Drag', 'Pan along the room'],
    ['Tap', 'Step into a zone, then tap an object'],
    ['Swipe in a zone', 'Next zone'],
    ['Magnifier', 'Show every name'],
    ['Hold a goal', 'Pick a tier'],
    ['Swipe a goal left', 'Swap it'],
  ];

  var win, bClose, isOpen = false, opener = null;

  function keys(list) {
    var dl = h('dl', { class: 'help-list' });
    list.forEach(function (r) {
      var dt = h('dt');
      r[0].forEach(function (k, i) {
        if (i) dt.appendChild(document.createTextNode(r[0].length === 2 && /^\d$/.test(k) ? ' to ' : ' '));
        dt.appendChild(h('kbd', { text: k }));
      });
      dl.appendChild(dt);
      dl.appendChild(h('dd', { text: r[1] }));
    });
    return dl;
  }
  function pairs(list) {
    var dl = h('dl', { class: 'help-list' });
    list.forEach(function (r) {
      dl.appendChild(h('dt', { class: 'px-font', style: { fontSize: '9px', color: K.hex('GOLD') }, text: r[0] }));
      dl.appendChild(h('dd', { text: r[1] }));
    });
    return dl;
  }

  function build() {
    bClose = h('button', { type: 'button', class: 'px-tool', 'aria-label': 'Close help', on: { click: function () {
      toggle(false);
    } } }, K.icon('close'));
    var body = h('div', { class: 'pxw-body' },
      h('div', { class: 'help-cols' },
        h('div', null, h('div', { class: 'px-label', text: 'Keys' }), keys(KEYS)),
        h('div', null,
          h('div', { class: 'px-label', text: 'In Today' }), keys(TODAY_KEYS),
          h('div', { class: 'px-label', text: 'Mouse' }), pairs(MOUSE))),
      h('div', { class: 'px-label', text: 'Touch' }), pairs(TOUCH));
    win = h('section', { class: 'pxw ui-help', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title', hidden: true },
      h('div', { class: 'pxw-bar' }, h('h2', { class: 'pxw-title', id: 'help-title', text: 'Controls' }), bClose), body);
    K.root().appendChild(win);
    // While open, the sheet owns the keyboard: the room behind does not move.
    window.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        toggle(false);
        return;
      }
      if (e.key === 'Tab') K.trapTab(win, e);
      e.stopPropagation();
    }, true);
    document.addEventListener('pointerdown', function (e) {
      if (isOpen && !win.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        toggle(false);
      }
    }, true);
  }

  function toggle(open) {
    var next = open == null ? !isOpen : !!open;
    if (next === isOpen) return;
    isOpen = next;
    if (next) {
      opener = document.activeElement !== document.body ? document.activeElement : null;
      win.classList.toggle('is-sheet', K.isPhone());
      win.hidden = false;
      bClose.focus();
    } else {
      win.hidden = true;
      K.restoreFocus(opener);
      opener = null;
    }
  }

  build();
  ROOM.ui.toggleHelp = function (open) {
    toggle(open);
  };
})();
