/* FORGE room: the calendar wall on the back view (v3.4 phase 3).
 *
 * The art paints two empty fields on the back wall (zones.json views.back.calendar: month, day, world px); this
 * module engraves into them, in palette colours, right after their sprites are drawn:
 *   - the month board: a title (month, today's date), what is on now and when the next event starts, weekday
 *     letters and a 6 x 7 grid. Past days are coloured by that day's FORGE completion (dark red at 0% to light
 *     green at 85%, gold fill and outline at 85% or more), future days are greyed, today is a cyan wireframe with
 *     a pulsing marker. Each cell lists the day's Google events the way Google does (all-day bars, then timed
 *     events with a colour dot and a start time), "+N" when they do not fit.
 *   - the day bar: the selected day's FORGE detail (completion, what was logged) and its Google events on an hour
 *     scale from 6 AM to 3 AM, with a moving "now" line on today.
 * Google colours are drawn as the nearest palette colour (true pixel art: the frame stays in the 64 colours).
 *
 * Data: ROOM.data.calendarWall = { connected, configured, tz, addUrl, months: { 'YYYY-MM': { days: { 'YYYY-MM-DD':
 * { p, logged: [{ name, tier }] } }, events: [{ id, calendar, title, start, end, allDay, color }] } } }.
 * Other months load through ROOM.calendarSource(month) -> Promise (the app fetches /api/calendar).
 *
 * In the calendar zone every day cell is a real button (select the day), the arrows change month, and ADD opens
 * Google Calendar on that day. The study desk's wall calendar and the board lead here.
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var C = ROOM.C;
  var PULSE_MS = 700;

  /* ------------------------------------------------------------------ the 3x5 font */
  var FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
    4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111',
    9: '111101111001111', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000', '+': '000010111010000',
    '%': '101001010100101', '/': '001001010100100', "'": '010010000000000', ',': '000000000010100', '!': '010010010000010',
    '?': '110001010000010', '&': '010101010101011', '(': '010100100100010', ')': '010001001001010', '<': '001010100010001',
    '>': '100010001010100', '#': '101111101111101',
  };
  function col(name, fb) {
    return C[name] != null ? C[name] : C[fb];
  }
  function px(f, x, y, c, glow) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    var i = y * f.w + x;
    f.buf[i] = c;
    if (f.aux) {
      if (glow) f.aux[i * 3 + 1] |= 1;
      else f.aux[i * 3 + 1] &= ~1;
    }
  }
  function rect(f, x, y, w, h, c, glow) {
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) px(f, x + xx, y + yy, c, glow);
  }
  function frame(f, x, y, w, h, c, glow) {
    for (var xx = 0; xx < w; xx++) {
      px(f, x + xx, y, c, glow);
      px(f, x + xx, y + h - 1, c, glow);
    }
    for (var yy = 1; yy < h - 1; yy++) {
      px(f, x, y + yy, c, glow);
      px(f, x + w - 1, y + yy, c, glow);
    }
  }
  function tw(s, scale) {
    return s.length ? (s.length * 4 - 1) * (scale || 1) : 0;
  }
  /** Text in the 3x5 font (upper case); scale 2 for the title. Returns the width drawn. */
  function text(f, x, y, s, c, scale, glow, maxW) {
    scale = scale || 1;
    s = String(s).toUpperCase();
    if (maxW != null) s = fit(s, maxW, scale);
    for (var k = 0; k < s.length; k++) {
      var g = FONT[s[k]];
      if (!g) continue;
      for (var i = 0; i < 15; i++) {
        if (g[i] !== '1') continue;
        for (var sy = 0; sy < scale; sy++)
          for (var sx = 0; sx < scale; sx++) px(f, x + (k * 4 + (i % 3)) * scale + sx, y + ((i / 3) | 0) * scale + sy, c, glow);
      }
    }
    return tw(s, scale);
  }
  function fit(s, maxW, scale) {
    var n = Math.floor((maxW / (scale || 1) + 1) / 4);
    return s.length <= n ? s : s.slice(0, Math.max(0, n));
  }

  /* ------------------------------------------------------------------ colours */
  // completion 0..85%: dark red to light green, in palette steps; 85% and up is gold
  var RAMP = ['TERRA_VD', 'TERRA_0', 'TERRA_1', 'TERRA_2', 'AMBER', 'GOLD_MID', 'LEAF_2', 'LEAF_3', 'LEAF_4'].map(function (n) {
    return col(n, 'SLATE_1');
  });
  var LIGHT_TILE = {};
  [col('TERRA_2'), col('AMBER'), col('GOLD_MID'), col('LEAF_3'), col('LEAF_4'), col('GOLD')].forEach(function (c) {
    LIGHT_TILE[c] = true;
  });
  function dayColor(p) {
    if (p >= 85) return col('GOLD');
    var i = Math.max(0, Math.min(RAMP.length - 1, Math.floor((p / 85) * RAMP.length)));
    return RAMP[i];
  }
  // nearest palette colour of a Google hex colour (cached)
  var near = {};
  function paletteOf(hex) {
    hex = (hex || '#039be5').toLowerCase();
    if (near[hex] != null) return near[hex];
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var best = col('RAIN_0', 'SLATE_1'), bd = 1e9, rgb = ROOM.render.RGB;
    for (var k = 2; k < rgb.length; k++) {
      var c = rgb[k];
      if (!c) continue;
      // weighted RGB distance (red, green, blue weights for perceived difference)
      var dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      var d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    near[hex] = best;
    return best;
  }
  function inkOn(c) {
    var rgb = ROOM.render.RGB[c] || [0, 0, 0];
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 120 ? C.INK : col('CREAM');
  }

  /* ------------------------------------------------------------------ dates and time */
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function cal() {
    return ROOM.data.calendarWall || null;
  }
  function tz() {
    var c = cal();
    return (c && c.tz) || undefined;
  }
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function ymd(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function addDays(s, n) {
    var d = parseDay(s);
    d.setUTCDate(d.getUTCDate() + n);
    return ymd(d);
  }
  // wall-clock parts of an instant in the owner's time zone
  var fmt = null;
  function parts(ms) {
    if (!fmt) {
      try {
        fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (e) {
        fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }
    var o = {};
    fmt.formatToParts(new Date(ms)).forEach(function (p) {
      o[p.type] = p.value;
    });
    var h = +o.hour % 24;
    return { day: o.year + '-' + o.month + '-' + o.day, h: h, m: +o.minute, mins: h * 60 + +o.minute };
  }
  // an event's span on the wall clock: day keys and minutes (all-day: whole days, end exclusive)
  function span(e) {
    if (e.allDay) return { allDay: true, startDay: e.start.slice(0, 10), endDay: e.end.slice(0, 10) };
    var a = parts(Date.parse(e.start)), b = parts(Date.parse(e.end));
    return { allDay: false, startDay: a.day, endDay: b.day, a: a, b: b, t0: Date.parse(e.start), t1: Date.parse(e.end) };
  }
  function clock(mins) {
    var h = Math.floor(mins / 60) % 24, m = mins % 60;
    var ap = h < 12 ? 'A' : 'P';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + pad(m) : '') + ap;
  }
  function wallNow() {
    // the engine clock (frozen in tests) on the owner's wall clock
    return parts(ROOM.now() < 1e11 ? Date.now() : ROOM.now());
  }
  function todayKey() {
    return ROOM.data.today || wallNow().day;
  }

  /* ------------------------------------------------------------------ state */
  var state = { month: null, selected: null, loading: {} };
  function monthKey(day) {
    return day.slice(0, 7);
  }
  function curMonth() {
    if (!state.month) state.month = monthKey(todayKey());
    return state.month;
  }
  function selected() {
    if (!state.selected) state.selected = todayKey();
    return state.selected;
  }
  function monthData(m) {
    var c = cal();
    var md = c && c.months && c.months[m];
    if (!md && c && !state.loading[m] && typeof ROOM.calendarSource === 'function') {
      state.loading[m] = true;
      Promise.resolve(ROOM.calendarSource(m))
        .then(function (res) {
          if (res && cal()) {
            cal().months = cal().months || {};
            cal().months[m] = res;
            if (res.connected != null) cal().connected = res.connected;
          }
        })
        .catch(function () {})
        .then(function () {
          state.loading[m] = false;
          ROOM.invalidate();
        });
    }
    return md || { days: {}, events: [] };
  }
  function dayInfo(day) {
    return monthData(monthKey(day)).days[day] || null;
  }
  function eventsOn(day) {
    // Google's month view: an event shows on every calendar date it touches
    var md = monthData(monthKey(day));
    var out = [];
    (md.events || []).forEach(function (e) {
      var s = span(e);
      var last = s.allDay ? addDays(s.endDay, -1) : s.b.mins === 0 && s.endDay > s.startDay ? addDays(s.endDay, -1) : s.endDay;
      if (s.startDay <= day && day <= last) out.push({ e: e, s: s });
    });
    out.sort(function (x, y) {
      if (x.s.allDay !== y.s.allDay) return x.s.allDay ? -1 : 1;
      return (x.s.t0 || 0) - (y.s.t0 || 0) || String(x.e.title).localeCompare(String(y.e.title));
    });
    return out;
  }
  // the FORGE day (4 AM boundary) on the day bar: events overlapping 6 AM of `day` to 3 AM of the next day
  function barEvents(day) {
    var list = eventsOn(day).concat(eventsOn(addDays(day, 1))).filter(function (x, i, arr) {
      return arr.findIndex(function (y) {
        return y.e.id === x.e.id;
      }) === i;
    });
    var out = [];
    list.forEach(function (x) {
      if (x.s.allDay) {
        if (x.s.startDay <= day && day < x.s.endDay) out.push({ e: x.e, allDay: true });
        return;
      }
      var a = minutesFrom(day, x.s.startDay, x.s.a.mins), b = minutesFrom(day, x.s.endDay, x.s.b.mins);
      var lo = 6 * 60, hi = 27 * 60;
      if (b <= lo || a >= hi) return;
      out.push({ e: x.e, a: Math.max(lo, a), b: Math.min(hi, b), start: a });
    });
    return out;
  }
  function minutesFrom(day, d, mins) {
    var diff = Math.round((parseDay(d) - parseDay(day)) / 86400000);
    return diff * 1440 + mins;
  }

  /* ------------------------------------------------------------------ layout */
  function rects() {
    var vc = ROOM.viewConf('back');
    return vc && vc.calendar ? vc.calendar : null;
  }
  // grid geometry of the month board, in world px
  function monthLayout(r) {
    var x = r[0], y = r[1], w = r[2], h = r[3];
    var titleH = 13, nowH = 8, headH = 8;
    var gy = y + 3 + titleH + nowH + headH;
    var cw = Math.floor((w - 6) / 7), ch = Math.floor((y + h - 3 - gy) / 6);
    var gx = x + Math.floor((w - cw * 7) / 2);
    return { x: x, y: y, w: w, h: h, gx: gx, gy: gy, cw: cw, ch: ch, titleY: y + 3, nowY: y + 3 + titleH, headY: gy - headH + 1 };
  }
  function firstCell(m) {
    var d = parseDay(m + '-01');
    return addDays(m + '-01', -d.getUTCDay());
  }

  /* ------------------------------------------------------------------ drawing: the month */
  function drawMonth(f, r, t) {
    var L = monthLayout(r);
    var m = curMonth(), today = todayKey(), sel = selected();
    var md = monthData(m);
    var cream = col('CREAM'), gold = col('GOLD'), cyan = col('ENERGY', 'SLATE_2'), dim = col('PLASTER_4', 'SLATE_0');
    // title: the month big, today's date on the right, month arrows
    var mm = +m.slice(5, 7) - 1;
    text(f, L.x + 12, L.titleY, MONTHS[mm] + ' ' + m.slice(0, 4), cream, 2);
    text(f, L.x + 3, L.titleY + 3, '<', col('SLATE_2'), 1);
    var td = parseDay(today);
    var tdl = 'TODAY ' + WD[td.getUTCDay()] + ' ' + td.getUTCDate() + ' ' + MONTHS[td.getUTCMonth()].slice(0, 3);
    var rx = L.x + L.w - 8;
    text(f, rx, L.titleY + 3, '>', col('SLATE_2'), 1);
    text(f, rx - 4 - tw(tdl), L.titleY + 3, tdl, gold, 1, true);
    // now and next
    drawNowNext(f, L.x + 3, L.nowY, L.w - 6, t);
    // weekday letters
    for (var k = 0; k < 7; k++) text(f, L.gx + k * L.cw + 2, L.headY, 'SMTWTFS'[k], col('SLATE_1'), 1);
    if (!cal()) return;
    var day = firstCell(m);
    for (var i = 0; i < 42; i++) {
      var cx = L.gx + (i % 7) * L.cw, cy = L.gy + ((i / 7) | 0) * L.ch;
      drawCell(f, day, cx, cy, L.cw - 1, L.ch - 1, monthKey(day) === m, today, sel, md, t);
      day = addDays(day, 1);
    }
    if (cal().connected === false) {
      var msg = cal().configured === false ? 'GOOGLE CALENDAR IS NOT SET UP' : 'CONNECT GOOGLE CALENDAR IN SETTINGS';
      rect(f, L.x + (L.w - tw(msg)) / 2 - 3, L.y + L.h - 11, tw(msg) + 6, 8, C.INK);
      text(f, L.x + (L.w - tw(msg)) / 2, L.y + L.h - 10, msg, col('SLATE_2'), 1);
    }
  }

  function drawCell(f, day, x, y, w, h, inMonth, today, sel, md, t) {
    var cream = col('CREAM');
    var n = String(+day.slice(8, 10));
    if (!inMonth) {
      text(f, x + 2, y + 2, n, col('PLASTER_3', 'SLATE_0'), 1);
      return;
    }
    var info = dayInfo(day);
    var fill, num, outline = null, glow = false;
    if (day === today) {
      fill = col('INK_2', 'INK');
      num = col('ENERGY', 'SLATE_2');
      outline = col('ENERGY', 'SLATE_2');
      glow = true;
    } else if (day > today) {
      fill = col('COOL_0', 'SLATE_D');
      num = col('COOL_2', 'SLATE_0');
    } else if (info && info.p != null) {
      fill = dayColor(info.p);
      num = inkOn(fill);
      if (info.p >= 85) {
        outline = col('GOLD_HI', 'SUN');
        glow = true;
      }
    } else {
      fill = C.INK;
      num = col('SLATE_0');
    }
    rect(f, x, y, w, h, fill, glow && day !== today);
    if (outline) frame(f, x, y, w, h, outline, glow);
    text(f, x + 2, y + 2, n, num, 1, day === today);
    if (day === today) {
      // the "you are here" marker: a pulsing dot in the corner
      var on = ROOM.state.reducedMotion || Math.floor(t / PULSE_MS) % 2 === 0;
      rect(f, x + w - 4, y + 2, 2, 2, on ? col('ENERGY_HI', 'CREAM') : col('ENERGY', 'SLATE_2'), true);
    }
    if (day === sel) frame(f, x - 1, y - 1, w + 2, h + 2, cream, false);
    // events: all-day bars, then timed events (dot, time, title); "+N" when they do not fit
    var evs = eventsOn(day);
    var line = 6, top = y + 8, rows = Math.floor((h - 9) / line);
    if (rows < 1) return;
    var shown = evs.length > rows ? rows - 1 : evs.length;
    for (var k = 0; k < shown; k++) {
      var ev = evs[k], ec = paletteOf(ev.e.color), ly = top + k * line;
      if (ev.s.allDay || ev.s.startDay !== day) {
        rect(f, x + 1, ly, w - 2, 5, ec);
        text(f, x + 2, ly, ev.e.title, inkOn(ec), 1, false, w - 4);
      } else {
        rect(f, x + 1, ly + 1, 2, 2, ec);
        var lbl = clock(ev.s.a.mins) + ' ' + ev.e.title;
        text(f, x + 4, ly, lbl, inkOn(fill) === C.INK ? C.INK : cream, 1, false, w - 5);
      }
    }
    if (evs.length > shown) text(f, x + 2, top + shown * line, '+' + (evs.length - shown), inkOn(fill) === C.INK ? C.INK : col('SLATE_2'), 1);
  }

  function drawNowNext(f, x, y, w, t) {
    var now = Date.now(), today = todayKey();
    var evs = eventsOn(today).concat(eventsOn(addDays(today, 1)));
    var cur = null, next = null;
    evs.forEach(function (x2) {
      if (x2.s.allDay) return;
      if (x2.s.t0 <= now && now < x2.s.t1 && !cur) cur = x2;
      if (x2.s.t0 > now && (!next || x2.s.t0 < next.s.t0)) next = x2;
    });
    var cyan = col('ENERGY', 'SLATE_2');
    var label = cur ? 'NOW ' + cur.e.title : 'NOTHING ON NOW';
    var used = text(f, x, y, label, cur ? cyan : col('SLATE_1'), 1, !!cur, w - 60);
    if (cur) rect(f, x - 2, y + 1, 1, 3, paletteOf(cur.e.color));
    var nx = '';
    if (next) {
      var mins = Math.round((next.s.t0 - now) / 60000);
      nx = mins < 60 ? 'NEXT IN ' + Math.max(1, mins) + ' MIN' : 'NEXT ' + clock(next.s.a.mins);
    } else nx = 'NO MORE TODAY';
    text(f, x + w - tw(nx), y, nx, col('GOLD'), 1);
    return used;
  }

  /* ------------------------------------------------------------------ drawing: the day bar */
  function drawDay(f, r, t) {
    var x = r[0] + 3, y = r[1] + 3, w = r[2] - 6, h = r[3] - 6;
    var day = selected(), today = todayKey();
    var d = parseDay(day);
    var cream = col('CREAM'), gold = col('GOLD');
    text(f, x, y, WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3), cream, 1);
    // ADD (opens Google Calendar on this day)
    text(f, x + w - tw('+ADD'), y, '+ADD', col('ENERGY', 'SLATE_2'), 1, true);
    // FORGE detail
    var info = dayInfo(day);
    var yy = y + 8;
    if (day > today) text(f, x, yy, 'AHEAD', col('COOL_2', 'SLATE_0'), 1);
    else if (info && info.p != null) {
      var c = dayColor(info.p);
      rect(f, x, yy - 1, tw(info.p + '%') + 4, 7, c, info.p >= 85);
      text(f, x + 2, yy, info.p + '%', inkOn(c), 1);
      text(f, x + tw(info.p + '%') + 7, yy, day === today ? 'SO FAR' : 'DONE', col('SLATE_2'), 1);
    } else text(f, x, yy, 'NO RECORD', col('SLATE_0'), 1);
    yy += 8;
    var logged = (info && info.logged) || [];
    var maxLines = 3;
    for (var k = 0; k < Math.min(maxLines, logged.length); k++) {
      var lg = logged[k];
      rect(f, x, yy + 1, 2, 2, lg.tier === 'stretch' ? gold : lg.tier === 'floor' ? col('SLATE_1') : col('LEAF_3'));
      text(f, x + 4, yy, lg.name, cream, 1, false, w - 4);
      yy += 6;
    }
    if (logged.length > maxLines) {
      text(f, x + 4, yy, '+' + (logged.length - maxLines) + ' MORE', col('SLATE_1'), 1);
      yy += 6;
    }
    yy += 2;
    rect(f, x, yy, w, 1, col('PLASTER_3', 'SLATE_0'));
    yy += 3;
    // all-day events
    var evs = barEvents(day);
    evs.filter(function (x2) {
      return x2.allDay;
    }).slice(0, 2).forEach(function (x2) {
      var ec = paletteOf(x2.e.color);
      rect(f, x + 10, yy, w - 10, 5, ec);
      text(f, x + 11, yy, x2.e.title, inkOn(ec), 1, false, w - 12);
      yy += 6;
    });
    // the hour scale, 6 AM to 3 AM
    var top = yy + 1, bottom = y + h - 1, hours = 21;
    var ph = (bottom - top) / hours;
    for (var hr = 0; hr <= hours; hr++) {
      var ty = Math.round(top + hr * ph);
      var hh = (6 + hr) % 24;
      rect(f, x + 9, ty, w - 9, 1, hr % 3 === 0 ? col('PLASTER_4', 'SLATE_0') : col('PLASTER_2', 'INK_2'));
      if (hr % 3 === 0 && hr < hours) text(f, x, ty + 1, clock(hh * 60).replace(':00', ''), col('SLATE_1'), 1);
    }
    evs.filter(function (x2) {
      return !x2.allDay;
    }).forEach(function (x2, i) {
      var y0 = Math.round(top + ((x2.a - 360) / 60) * ph), y1 = Math.max(y0 + 3, Math.round(top + ((x2.b - 360) / 60) * ph));
      var ec = paletteOf(x2.e.color);
      rect(f, x + 11, y0, w - 11, y1 - y0, ec);
      rect(f, x + 10, y0, 1, y1 - y0, inkOn(ec) === C.INK ? col('CREAM') : C.INK);
      if (y1 - y0 >= 6) text(f, x + 12, y0 + 1, x2.e.title, inkOn(ec), 1, false, w - 13);
    });
    // now: a cyan line across today's scale
    if (day === today) {
      var n = wallNow();
      var mins = n.day === today ? n.mins : n.mins + 1440;
      if (mins >= 360 && mins <= 27 * 60) {
        var ny = Math.round(top + ((mins - 360) / 60) * ph);
        rect(f, x + 8, ny, w - 8, 1, col('ENERGY', 'SLATE_2'), true);
        rect(f, x + 6, ny - 1, 2, 3, col('ENERGY_HI', 'CREAM'), true);
      }
    }
  }

  /** Called by the renderer right after the board's or the day bar's sprite is drawn. */
  function draw(f, d) {
    var r = rects();
    if (!r) return;
    var t = f.now != null ? f.now : ROOM.now();
    var ox = (f.offs ? f.offs[d.layer] || 0 : 0) - f.x0, oy = -f.y0;
    var shift = function (q) {
      return [q[0] + ox + (d.x - d.item.x), q[1] + oy + (d.y - d.item.y), q[2], q[3]];
    };
    var bf = { buf: f.buf, aux: f.aux, w: f.w, h: f.h };
    if (d.id === 'calendar.board' && r.month) drawMonth(bf, shift(r.month), t);
    if (d.id === 'calendar.daybar' && r.day) drawDay(bf, shift(r.day), t);
  }

  /* ------------------------------------------------------------------ buttons (in the calendar zone) */
  var layer = null, btns = [], btnKey = '';
  function cssRect(x, y, w, h) {
    var d = null, list = ROOM.render.drawables || [];
    for (var k = 0; k < list.length; k++) if (list[k].id === 'calendar.board') d = list[k];
    return ROOM.render.cssRectOf({ hit: [x, y, w, h], layer: d ? d.layer : 3 });
  }
  function place(b, r) {
    var w = Math.max(r.width, 24), h = Math.max(r.height, 24);
    b.style.left = (r.left - (w - r.width) / 2).toFixed(1) + 'px';
    b.style.top = (r.top - (h - r.height) / 2).toFixed(1) + 'px';
    b.style.width = w.toFixed(1) + 'px';
    b.style.height = h.toFixed(1) + 'px';
  }
  function addUrl(day) {
    var base = (cal() && cal().addUrl) || 'https://calendar.google.com/calendar/r/eventedit';
    var a = day.replace(/-/g, ''), b = addDays(day, 1).replace(/-/g, '');
    return base + '?dates=' + a + '/' + b;
  }
  function describe(day) {
    var d = parseDay(day), info = dayInfo(day), n = eventsOn(day).length;
    var s = WD_LONG[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].charAt(0) + MONTHS[d.getUTCMonth()].slice(1).toLowerCase();
    if (day === todayKey()) s += ', today';
    if (info && info.p != null && day <= todayKey()) s += ', ' + info.p + '% complete';
    s += ', ' + (n === 1 ? '1 event' : n + ' events');
    return s;
  }
  function select(day) {
    state.selected = day;
    if (monthKey(day) !== curMonth()) state.month = monthKey(day);
    ROOM.emit('calendar', { day: day });
    if (ROOM.uikit && ROOM.uikit.announce) ROOM.uikit.announce(describe(day));
    ROOM.invalidate();
  }
  function shiftMonth(n) {
    var d = parseDay(curMonth() + '-01');
    d.setUTCMonth(d.getUTCMonth() + n);
    state.month = ymd(d).slice(0, 7);
    ROOM.invalidate();
  }
  function sync() {
    if (!layer) layer = document.getElementById('room-hotspots');
    if (!layer) return;
    var R = ROOM.render, r = rects();
    var on = r && ROOM.state.zone === 'calendar' && ROOM.normView(ROOM.state.view) === 'back' && !R.turning && !R.dolly;
    var key = on ? [curMonth(), selected(), R.sceneVersion, JSON.stringify(R.restCamera && R.restCamera())].join('|') : 'off';
    if (key === btnKey) return;
    btnKey = key;
    btns.forEach(function (b) {
      b.remove();
    });
    btns = [];
    if (!on) return;
    var L = monthLayout(r.month);
    var day = firstCell(curMonth());
    var make = function (label, onClick, cls) {
      var b = document.createElement(cls === 'link' ? 'a' : 'button');
      if (cls === 'link') {
        b.href = '#';
        b.target = '_blank';
        b.rel = 'noopener';
      } else b.type = 'button';
      b.className = 'cal-hit';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (onClick) onClick(e);
      });
      layer.appendChild(b);
      btns.push(b);
      return b;
    };
    for (var i = 0; i < 42; i++) {
      (function (dd, i) {
        if (monthKey(dd) !== curMonth()) return;
        var b = make(describe(dd), function () {
          select(dd);
        });
        if (dd === selected()) b.setAttribute('aria-pressed', 'true');
        place(b, cssRect(L.gx + (i % 7) * L.cw, L.gy + ((i / 7) | 0) * L.ch, L.cw - 1, L.ch - 1));
      })(day, i);
      day = addDays(day, 1);
    }
    place(make('Previous month', function () {
      shiftMonth(-1);
    }), cssRect(L.x + 1, L.titleY, 9, 11));
    place(make('Next month', function () {
      shiftMonth(1);
    }), cssRect(L.x + L.w - 10, L.titleY, 9, 11));
    var add = make('Add an event on ' + describe(selected()).split(',')[0] + ' in Google Calendar', null, 'link');
    add.href = addUrl(selected());
    place(add, cssRect(r.day[0] + r.day[2] - 22, r.day[1] + 1, 20, 9));
  }

  /** The board, the day bar or the study wall calendar was clicked: go to the calendar wall. */
  function openFromItem() {
    if (ROOM.state.zone !== 'calendar' && ROOM.zoneById('calendar')) ROOM.go('calendar');
  }

  function ambientKey(t) {
    if (ROOM.normView(ROOM.state.view) !== 'back' || ROOM.state.reducedMotion) return '';
    // the today marker pulses; the now line moves once a minute
    return Math.floor(t / PULSE_MS) % 2 + ':' + Math.floor(Date.now() / 60000);
  }
  function hasAmbient() {
    return ROOM.normView(ROOM.state.view) === 'back' && !!cal();
  }

  ROOM.calendar = {
    draw: draw,
    sync: sync,
    select: select,
    shiftMonth: shiftMonth,
    openFromItem: openFromItem,
    ambientKey: ambientKey,
    hasAmbient: hasAmbient,
    get month() {
      return curMonth();
    },
    get selected() {
      return selected();
    },
    // for tests and the deliverables
    pure: { dayColor: dayColor, paletteOf: paletteOf, span: span, eventsOn: eventsOn, barEvents: barEvents, addUrl: addUrl, describe: describe },
  };
})();
