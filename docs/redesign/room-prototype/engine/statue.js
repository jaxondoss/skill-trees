/* FORGE room: the statue's level (v3.4 phase 2).
 *
 * The plaque on the knight's pedestal (item.plaque, the engraved field the art leaves empty) shows the level, a
 * progress bar to the next level and the next level: "40 [=====     ] 41". The bar is the overall score's distance
 * above the level (0..1). It follows the live score both ways; the level only rises, one step per press of
 * UPGRADE, which appears on the plaque at 100% and pulses (no auto-upgrade). The bar is drawn in gold ramp steps
 * and flagged emissive in the aux buffer, so the light model makes it glow.
 *
 * A level-up is a short moment: a band of gold climbs the knight and the pedestal, the plaque drains and the new
 * level is engraved column by column. When the new level crosses a tier (20, 40, 60, 80) the armour changes under
 * the band (ROOM.state.roomTier) and the bell rings. Reduced motion: the level and the plaque change at once.
 *
 * Events: ROOM.emit('upgrade', {from, to}) (the app saves it with the upgradeStatue action).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var C = ROOM.C;
  var T = 255;
  var SURGE_MS = 1400, SURGE_TIER_MS = 2200, PULSE_MS = 600;

  // 3x5 glyphs, rows of 3 bits
  var GLYPH = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    U: '101101101101111', P: '110101110100100', G: '111100101101111', R: '110101110101101', A: '010101111101101',
    D: '110101101101110', E: '111100110100111', M: '101111111101101', X: '101101010101101',
  };
  function col(name, fb) {
    return C[name] != null ? C[name] : C[fb];
  }
  // the gold ramp, darkest to lightest
  var RAMP = [col('GOLD_DK', 'GOLD'), C.GOLD, col('SUN', 'GOLD'), col('CREAM', 'SUN')];
  var INK = C.INK, FIELD = col('INK_2', 'INK');

  var surge = null; // {t0, dur, from, to, tier, tierSet}

  /** Level, score and progress for the plaque. */
  function info() {
    var o = ROOM.data.overall || {};
    var score = +o.score || 0;
    var level = ROOM.levelOf();
    var max = level >= 100;
    return {
      level: level,
      next: max ? null : level + 1,
      score: score,
      into: max ? 1 : Math.max(0, Math.min(1, score - level)),
      ready: !max && score >= level + 1,
    };
  }

  function say(text) {
    if (ROOM.uikit && ROOM.uikit.announce) ROOM.uikit.announce(text);
  }
  function now() {
    return ROOM.now();
  }
  function reduced() {
    return !!ROOM.state.reducedMotion;
  }

  /** Raise the level by one (only at 100%). Returns false when it cannot. */
  function upgrade() {
    var i = info();
    if (!i.ready || surge) return false;
    var from = i.level, to = from + 1;
    ROOM.data.overall.level = to;
    var tier = ROOM.tierOfLevel(to) > ROOM.tierOfLevel(from);
    ROOM.emit('upgrade', { from: from, to: to });
    if (ROOM.sound) {
      if (tier && ROOM.sound.bell) ROOM.sound.bell();
      else if (ROOM.sound.anvil) ROOM.sound.anvil();
    }
    if (reduced()) {
      if (tier) ROOM.setState({ roomTier: ROOM.tierOfLevel(to) });
      say('The statue reached level ' + to + '.');
    } else {
      surge = { t0: now(), dur: tier ? SURGE_TIER_MS : SURGE_MS, from: from, to: to, tier: tier, tierSet: false };
      say('The statue reached level ' + to + '.');
    }
    if (ROOM.invalidate) ROOM.invalidate();
    return true;
  }

  /** Surge progress 0..1, or -1 when no surge is playing. Ends the surge when it is over. */
  function phase(t) {
    if (!surge) return -1;
    var u = (t - surge.t0) / surge.dur;
    if (u >= 1) {
      if (surge.tier && !surge.tierSet) ROOM.setState({ roomTier: ROOM.tierOfLevel(surge.to) });
      surge = null;
      return -1;
    }
    if (surge.tier && !surge.tierSet && u >= 0.5) {
      surge.tierSet = true;
      ROOM.setState({ roomTier: ROOM.tierOfLevel(surge.to) }); // the armour changes under the band
    }
    return Math.max(0, u);
  }

  /* ------------------------------------------------------------------ drawing */
  // One engine pixel: palette index into the buffer, and (when the frame has an aux buffer) the emissive flag so
  // the GPU light model makes it glow.
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
  function textWidth(s) {
    return s.length ? s.length * 4 - 1 : 0;
  }
  function text(f, x, y, s, c, glow, clipX) {
    for (var k = 0; k < s.length; k++) {
      var g = GLYPH[s[k]];
      if (!g) continue;
      for (var i = 0; i < 15; i++) {
        if (g[i] !== '1') continue;
        var gx = x + k * 4 + (i % 3);
        if (clipX != null && gx >= clipX) continue;
        px(f, gx, y + ((i / 3) | 0), c, glow);
      }
    }
  }
  // gold ramp step for a position u (0..1) along the bar, lifted by `up` steps
  function gold(u, up) {
    var s = u < 0.34 ? 0 : u < 0.67 ? 1 : 2;
    return RAMP[Math.max(0, Math.min(3, s + up))];
  }

  /** The plaque field: level, bar (or UPGRADE), next level. (fx, fy, fw, fh) in buffer px. */
  function drawPlaque(f, fx, fy, fw, fh, t, u) {
    var i = info();
    var level = i.level, into = i.into, ready = i.ready;
    var reveal = 1; // share of the level digits engraved (the re-engraving during a surge)
    if (u >= 0) {
      if (u < 0.55) {
        level = surge.from;
        into = 1;
        ready = false;
      } else {
        var k = Math.min(1, (u - 0.55) / 0.35);
        reveal = k;
        into = 1 + (i.into - 1) * k;
        ready = false;
      }
    }
    // the gold frame (lit edge on top and left) around the dark engraved field
    for (var fxx = -1; fxx <= fw; fxx++) {
      px(f, fx + fxx, fy - 1, RAMP[2], false);
      px(f, fx + fxx, fy + fh, RAMP[0], false);
    }
    for (var fyy = 0; fyy < fh; fyy++) {
      px(f, fx - 1, fy + fyy, RAMP[1], false);
      px(f, fx + fw, fy + fyy, RAMP[0], false);
    }
    for (var yy = 0; yy < fh; yy++) for (var xx = 0; xx < fw; xx++) px(f, fx + xx, fy + yy, FIELD, false);
    var ty = fy + Math.max(0, ((fh - 5) / 2) | 0);
    var ls = String(level), rs = level >= 100 ? 'MAX' : String(level + 1);
    var lw = textWidth(ls), rw = textWidth(rs);
    // the level, engraved left to right while it is revealed
    var lx = fx + 2;
    var clip = reveal < 1 ? lx + Math.round(lw * reveal) : null;
    text(f, lx, ty, ls, RAMP[2], true, clip);
    // the engraving tool: one glint at the reveal edge (a full-height line would read as a "1")
    if (clip != null && clip < lx + lw) px(f, clip, ty + 2, RAMP[3], true);
    text(f, fx + fw - 2 - rw, ty, rs, RAMP[1], true);
    // the bar between them
    var bx = lx + lw + 3, bw = fx + fw - 2 - rw - 3 - bx;
    if (bw < 4) return;
    if (ready) {
      // UPGRADE: the whole bar lit, pulsing one ramp step, the word engraved into it
      var up = reduced() ? 1 : Math.floor(t / PULSE_MS) % 2 ? 1 : 0;
      // the glow is the ring around the bar (emissive, so it blooms); the lettered field stays unbloomed so
      // the word reads
      for (var y5 = -1; y5 <= 5; y5++)
        for (var x5 = -1; x5 <= bw; x5++) {
          var ring = y5 < 0 || y5 > 4 || x5 < 0 || x5 >= bw;
          if (ring) px(f, bx + x5, ty + y5, RAMP[Math.min(3, 2 + up)], true);
          else px(f, bx + x5, ty + y5, gold(0.5, y5 === 0 ? 1 : 0), false);
        }
      var word = bw >= textWidth('UPGRADE') + 2 ? 'UPGRADE' : 'UP';
      text(f, bx + ((bw - textWidth(word)) / 2 | 0), ty, word, INK, false);
      return;
    }
    var by = fy + Math.max(0, ((fh - 3) / 2) | 0);
    var n = Math.round(bw * Math.max(0, Math.min(1, into)));
    for (var x = 0; x < bw; x++) {
      var uu = x / Math.max(1, bw - 1);
      for (var r = 0; r < 3; r++) {
        if (x < n) {
          var c = x === n - 1 && n < bw ? RAMP[3] : gold(uu, r === 0 ? 1 : r === 2 ? -1 : 0);
          px(f, bx + x, by + r, c, true);
        } else px(f, bx + x, by + r, r === 2 ? FIELD : INK, false);
      }
    }
  }

  // Luminance of each palette index (0..1), for the surge's gold mapping.
  var LUM = null;
  function lum(c) {
    if (!LUM) {
      LUM = new Float32Array(256);
      var rgb = ROOM.render.RGB;
      for (var k = 0; k < rgb.length; k++) if (rgb[k]) LUM[k] = (0.2126 * rgb[k][0] + 0.7152 * rgb[k][1] + 0.0722 * rgb[k][2]) / 255;
    }
    return LUM[c];
  }

  /** The gold band climbing the knight and pedestal (sprite rows, bottom to top, over the first 75%). */
  function drawSurge(f, img, dx, dy, u) {
    var climb = Math.min(1, u / 0.75);
    var centre = img.h - climb * (img.h + 14);
    var half = 6;
    var y0 = Math.max(0, Math.floor(centre - half)), y1 = Math.min(img.h, Math.ceil(centre + half));
    for (var y = y0; y < y1; y++) {
      var k = 1 - Math.abs(y - centre) / half;
      if (k <= 0) continue;
      var up = k > 0.66 ? 1 : 0;
      for (var x = 0; x < img.w; x++) {
        var v = img.px[y * img.w + x];
        if (v === T) continue;
        var l = lum(v);
        var s = l < 0.25 ? 0 : l < 0.5 ? 1 : 2;
        px(f, dx + x, dy + y, RAMP[Math.min(3, s + up)], true);
      }
    }
  }

  /** Called by the renderer right after the statue's sprite is drawn. */
  function draw(f, d, img, dx, dy) {
    var t = f.now != null ? f.now : now();
    var u = phase(t);
    if (u >= 0 && !reduced()) drawSurge(f, img, dx, dy, u);
    var pl = d.item.plaque;
    if (pl && ROOM.data.overall) {
      var ox = dx - d.item.x, oy = dy - d.item.y;
      drawPlaque(f, pl[0] + ox, pl[1] + oy, pl[2], pl[3], t, u);
    }
  }

  /* ------------------------------------------------------------------ scheduler hooks */
  function busy(t) {
    return phase(t) >= 0;
  }
  function hasAmbient() {
    return info().ready && !reduced();
  }
  function ambientKey(t) {
    return hasAmbient() ? String(Math.floor(t / PULSE_MS) % 2) : '';
  }
  /** 0..1 envelope for the GPU's statue burst while a surge plays. */
  function burst(t) {
    var u = phase(t);
    return u < 0 ? 0 : Math.sin(Math.PI * Math.min(1, u / 0.85));
  }

  /* ------------------------------------------------------------------ the UPGRADE button */
  // A real button over the plaque (at least 44 px), so UPGRADE works by mouse, touch and keyboard. The canvas
  // draws the glowing word; the button carries the name and the focus ring.
  var btn = null;
  function ensureButton() {
    if (btn) return btn;
    var layer = document.getElementById('room-hotspots');
    if (!layer) return null;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'statue-upgrade';
    btn.hidden = true;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      upgrade();
      sync();
    });
    btn.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
    });
    layer.appendChild(btn);
    return btn;
  }
  function sync() {
    var b = ensureButton();
    if (!b) return;
    var R = ROOM.render, i = info();
    var d = null;
    var list = R.drawables || [];
    for (var k = 0; k < list.length; k++) if (list[k].statue && list[k].item.plaque) d = list[k];
    if (!d || !i.ready || surge || R.turning || R.dolly) {
      b.hidden = true;
      return;
    }
    var pl = d.item.plaque, sx = d.x - d.item.x, sy = d.y - d.item.y;
    var r = R.cssRectOf({ hit: [pl[0] + sx, pl[1] + sy, pl[2], pl[3]], layer: d.layer });
    var w = Math.max(44, r.width), h = Math.max(44, r.height);
    b.style.left = (r.left - (w - r.width) / 2).toFixed(1) + 'px';
    b.style.top = (r.top - (h - r.height) / 2).toFixed(1) + 'px';
    b.style.width = w.toFixed(1) + 'px';
    b.style.height = h.toFixed(1) + 'px';
    b.setAttribute('aria-label', 'Upgrade the statue to level ' + (i.level + 1));
    b.title = 'Upgrade to level ' + (i.level + 1);
    b.hidden = false;
  }

  ROOM.statue = {
    info: info,
    upgrade: upgrade,
    draw: draw,
    busy: busy,
    hasAmbient: hasAmbient,
    ambientKey: ambientKey,
    burst: burst,
    sync: sync,
    get surge() {
      return surge;
    },
  };
})();
