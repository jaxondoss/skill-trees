/* FORGE room prototype: TEST FIXTURE ART (engine development only).
 *
 * index.html loads this only when art.js is missing. It builds a minimal window.ROOM_ART in the same
 * format scripts/room-art.py writes (palette, zones, items, RLE base64 images; 255 = transparent), from
 * plain rectangles: the shell (sky, city, walls, tiled floor, a front floor band), three frame crops,
 * one sprite per skill (stages s0/s1/s2), the statue, the dog, backpack and doormat alerts, the
 * triathlon bike (awake), and a few decor items that exercise night, tier, holiday overlay and anim.
 * It is deliberately crude: it exists so the engine can be built and tested before the real art lands.
 */
(function () {
  'use strict';

  var PALETTE = {"_note":"FORGE v3 room master palette (32). m = measured from docs/references/sunset-room.jpg, o = owner, d = derived, n = new. Art is painted in the golden-hour state (R4); lighting states remap indices (luts). LEDs, outlines and nameplates are drawn by the engine after the LUT, so category colours stay true.","colors":[["VOID","#0C0A0C","m"],["INK","#141517","m"],["INK_COOL","#161D1B","m"],["BROWN_0","#281B1B","m"],["BROWN_1","#312D2A","m"],["BROWN_2","#50302E","m"],["TERRA_0","#621D1A","m"],["TERRA_1","#8E432D","m"],["TERRA_2","#B45B40","m"],["RIM","#DA6339","m"],["ORANGE","#F26B2A","o"],["GLOW","#F39041","m"],["AMBER","#CE8446","m"],["SUN","#FEF576","m"],["GOLD","#D9A441","n"],["GOLD_DK","#6E5422","n"],["ROSE_0","#815A50","m"],["ROSE_1","#AF5D4D","m"],["LEAF_0","#212C26","m"],["LEAF_1","#344136","m"],["LEAF_2","#3E6B35","o"],["LEAF_3","#7FA650","n"],["SLATE_0","#3E4F51","m"],["SLATE_1","#56858A","m"],["SLATE_2","#9CC0C2","n"],["PLUM_0","#3A292F","d"],["PLUM_1","#724F5B","d"],["PLUM_2","#AF4D61","d"],["PLUM_3","#D98AA0","n"],["CRT_0","#D2211A","m"],["CRT_1","#FC3827","m"],["CREAM","#F4E6C4","n"]],"categories":{"gold":["GOLD_DK","GOLD","SUN"],"business":["TERRA_1","AMBER","GLOW"],"school":["SLATE_0","SLATE_1","SLATE_2"],"athletics":["TERRA_0","CRT_0","CRT_1"],"nutrition":["LEAF_1","LEAF_2","LEAF_3"],"mind":["PLUM_1","PLUM_2","PLUM_3"]},"luts":{"_note":"Each LUT maps colour name -> colour name for art layers; unlisted colours stay. R4 = golden (85%+, identity), R3 = 60-84, R2 = 25-59, R1 = dark dusk 0-24, NIGHT = after 10 PM (completion then drives lamp sprites), DIM = room behind an open panel. Minimum ambient: nothing maps darker than BROWN_0 except things already dark.","R4":{},"R3":{"SUN":"SUN","GLOW":"ORANGE","RIM":"TERRA_2","SLATE_2":"SLATE_1"},"R2":{"SUN":"GLOW","GLOW":"ORANGE","ORANGE":"TERRA_2","RIM":"TERRA_1","TERRA_2":"TERRA_1","ROSE_1":"ROSE_0","SLATE_2":"SLATE_1","SLATE_1":"SLATE_0","LEAF_3":"LEAF_2"},"R1":{"SUN":"ROSE_1","GLOW":"TERRA_1","ORANGE":"TERRA_1","RIM":"BROWN_2","TERRA_2":"TERRA_0","TERRA_1":"BROWN_2","AMBER":"TERRA_1","ROSE_1":"PLUM_1","ROSE_0":"PLUM_0","SLATE_2":"SLATE_0","SLATE_1":"SLATE_0","LEAF_3":"LEAF_1","LEAF_2":"LEAF_1","CREAM":"ROSE_0","GOLD":"GOLD_DK"},"NIGHT":{"SUN":"CREAM","GLOW":"PLUM_1","ORANGE":"PLUM_0","RIM":"BROWN_1","TERRA_2":"BROWN_2","TERRA_1":"BROWN_1","ROSE_1":"PLUM_0","ROSE_0":"INK","SLATE_2":"SLATE_0","SLATE_1":"SLATE_0","LEAF_3":"LEAF_1","LEAF_2":"LEAF_0","AMBER":"BROWN_2","GOLD":"GOLD_DK"},"DIM":{"SUN":"AMBER","GLOW":"TERRA_2","ORANGE":"TERRA_1","RIM":"TERRA_1","TERRA_2":"TERRA_1","TERRA_1":"BROWN_2","AMBER":"TERRA_1","CREAM":"ROSE_0","SLATE_2":"SLATE_1","SLATE_1":"SLATE_0","LEAF_3":"LEAF_2","LEAF_2":"LEAF_1","ROSE_1":"ROSE_0","PLUM_3":"PLUM_2","GOLD":"GOLD_DK","CRT_1":"CRT_0"}}};
  var ZONES = {"_note":"World coordinates. The 640x270 core is x 0..640, y 0..270; the painted art spans x -80..720, y -96..384 (800x480). Keys 1-7 run left to right (also the arrow loop). focus = what a step-in frames (hotspots plus margin). territory = where that zone's art agent may paint (x range, plus y limits); shell, outside and centre parts are owned separately.","art":{"x":-80,"y":-96,"w":800,"h":480},"core":{"w":640,"h":270},"horizon":121,"vp":[320,121],"zones":[{"id":"kitchen","n":1,"name":"KITCHEN","focus":[-4,82,116,150],"stop":54,"territory":{"x0":-80,"x1":100}},{"id":"bed","n":2,"name":"BED","focus":[98,108,96,114],"stop":146,"territory":{"x0":100,"x1":176}},{"id":"library","n":3,"name":"LIBRARY","focus":[174,64,100,156],"stop":224,"territory":{"x0":176,"x1":262}},{"id":"window","n":4,"name":"WINDOW","focus":[262,64,116,160],"stop":320,"territory":{"x0":262,"x1":378}},{"id":"study","n":5,"name":"STUDY DESK","focus":[376,76,92,142],"stop":422,"territory":{"x0":378,"x1":464}},{"id":"computer","n":6,"name":"COMPUTER","focus":[446,100,100,120],"stop":496,"territory":{"x0":464,"x1":540}},{"id":"gym","n":7,"name":"GYM","focus":[528,84,116,156],"stop":586,"territory":{"x0":540,"x1":720}}],"shell":{"backWall":[176,62,464,198],"window":[284,70,368,152],"sill":[280,152,372,157],"leftWall":{"backEdgeX":176,"top":[62,0.15],"bottom":[198,0.19375]},"rightWall":"mirror of leftWall about x = 320","ceilingY":62,"floorBackY":198},"centre":{"statue":[258,149,36,81],"statueContactY":230,"rug":[236,222,80,16],"sunbeam":"floor patch from the window toward the statue and dog","dogSleep":[318,224]},"layers":{"_note":"Depth bands. Objects take the band of the floor row they stand on (contact y) or the wall they hang on. Parallax px at full mouse deflection = layer index.","L0":"sky, sun, clouds","L1":"New Orleans outside: city, live oaks, power lines, streetcar","L2":"back wall and everything on it, floor y < 210, side-wall columns x >= 114 (left) / x <= 526 (right): bed, computer desk","L3":"floor contact 210 <= y < 222; side walls x 52..114 / 526..588: door and corkboard, chess table, cushion, dog","L4":"floor contact 222 <= y < 236; side walls x -20..52 / 588..660: fridge, statue and rug, dumbbell rack, bench","L5":"floor contact y >= 236; side walls x < -20 / > 660: covered bike, front floor, front cables","L6":"frame crops: hanging plant top-left, filing cabinet bottom-left, speaker bottom-right, cables top-right; may intrude up to 12 px into the core, never over a hotspot"},"skills":{"_note":"Every skill maps to exactly one hotspot object.","food":"kitchen","college-integration":"kitchen","sleep":"bed","reading":"library","chess":"library","meditation":"library","visualization":"window","gut-health":"window","academics":"study","time-blocking":"study","ai-building":"computer","dropshipping":"computer","strength":"gym","running":"gym","triathlon":"gym"}};

  var C = {};
  PALETTE.colors.forEach(function (c, i) {
    C[c[0]] = i;
  });
  var CAT = {};
  Object.keys(PALETTE.categories).forEach(function (k) {
    CAT[k] = PALETTE.categories[k].map(function (n) {
      return C[n];
    });
  });
  var T = 255;

  /* ------------------------------------------------------------------ tiny painter */
  function Spr(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h).fill(T);
  }
  Spr.prototype.set = function (x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  };
  Spr.prototype.get = function (x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : T;
  };
  Spr.prototype.rect = function (x, y, w, h, c) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  };
  Spr.prototype.frame = function (x, y, w, h, c) {
    for (var i = 0; i < w; i++) {
      this.set(x + i, y, c);
      this.set(x + i, y + h - 1, c);
    }
    for (var j = 0; j < h; j++) {
      this.set(x, y + j, c);
      this.set(x + w - 1, y + j, c);
    }
    return this;
  };
  Spr.prototype.disc = function (cx, cy, r, c) {
    for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c);
    return this;
  };
  Spr.prototype.line = function (x0, y0, x1, y1, c) {
    var n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (var i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    return this;
  };
  Spr.prototype.clone = function () {
    var s = new Spr(this.w, this.h);
    s.px.set(this.px);
    return s;
  };

  /* ------------------------------------------------------------------ encoding (same as room-art.py) */
  function encode(s) {
    var bytes = [];
    var runV = -1, runN = 0;
    for (var i = 0; i < s.px.length; i++) {
      var v = s.px[i];
      if (v === runV && runN < 255) runN++;
      else {
        if (runN) bytes.push(runN, runV);
        runV = v;
        runN = 1;
      }
    }
    bytes.push(runN, runV);
    var bin = '';
    for (var k = 0; k < bytes.length; k += 4096) bin += String.fromCharCode.apply(null, bytes.slice(k, k + 4096));
    return { w: s.w, h: s.h, rle: btoa(bin) };
  }

  var images = {};
  var items = [];
  function save(s, id, variant) {
    var path = 'fixture/' + id + '/' + variant + '.png';
    images[path] = encode(s);
    return path;
  }
  function add(def, sprites) {
    var variants = {};
    Object.keys(sprites).forEach(function (k) {
      if (k !== 'anim') variants[k] = save(sprites[k], def.id, k);
    });
    def.variants = variants;
    if (sprites.anim) {
      def.anim.frames = sprites.anim.map(function (s, i) {
        return save(s, def.id, 'f' + i);
      });
    }
    def.part = 'fixture';
    items.push(def);
  }

  /* ------------------------------------------------------------------ shell geometry */
  function leftTop(x) { return 62 - 0.15 * (176 - x); }
  function leftBottom(x) { return 198 + 0.19375 * (176 - x); }
  function rightTop(x) { return leftTop(640 - x); }
  function rightBottom(x) { return leftBottom(640 - x); }
  function floorRow(y) { return Math.round(121 + 77 / (1 - 0.0375 * y)); }

  // Floor tile colour at world (x, y): terracotta with dark grout on equal-depth rows and radials to the VP.
  var GROUT_ROWS = {};
  for (var n = 0; n < 26; n++) GROUT_ROWS[floorRow(n)] = true;
  function floorColor(x, y) {
    if (GROUT_ROWS[y]) return C.BROWN_0;
    var xb = 320 + ((x - 320) * 77) / (y - 121); // project back onto the back-wall line
    var f = (xb - 176) / 16;
    if (Math.abs(f - Math.round(f)) * 16 < 77 / (y - 121) * 0.6) return C.BROWN_0;
    // The hot reflection of the window on the tiles.
    var rx = Math.abs(x - 326), ry = y - 250;
    if (ry > 0 && ry < 60 && rx < 22 - ry * 0.12) return ry % 7 < 2 ? C.TERRA_2 : (x + y) % 3 ? C.RIM : C.ORANGE;
    return C.TERRA_0;
  }
  function isFloor(x, y) {
    if (y < 198) return false;
    if (x < 176 && y < leftBottom(x)) return false;
    if (x > 464 && y < rightBottom(x)) return false;
    return true;
  }

  // Shell: everything (ceiling, walls, floor), window hole cut out. 800 x 480 at world (-80, -96).
  (function shell() {
    var s = new Spr(800, 480);
    for (var j = 0; j < 480; j++) {
      var y = j - 96;
      for (var i = 0; i < 800; i++) {
        var x = i - 80, c;
        if (isFloor(x, y)) c = floorColor(x, y);
        else if (x < 176 && y >= leftTop(x)) c = (x & 15) === 0 ? C.BROWN_0 : C.INK;
        else if (x > 464 && y >= rightTop(x)) c = (x & 15) === 0 ? C.BROWN_0 : C.INK;
        else if (y >= 62 && x >= 176 && x <= 464) c = C.BROWN_0;
        else c = C.VOID; // ceiling
        s.px[j * 800 + i] = c;
      }
    }
    var W = function (x, y, c) { s.set(x + 80, y + 96, c); };
    // Window opening (transparent), frame and mullion, sill with a rim of light.
    for (var y2 = 70; y2 < 152; y2++) for (var x2 = 284; x2 < 368; x2++) W(x2, y2, T);
    for (var k = 0; k < 2; k++) {
      for (var x3 = 282; x3 < 370; x3++) { W(x3, 68 + k, C.INK); }
      for (var y3 = 68; y3 < 152; y3++) { W(282 + k, y3, C.INK); W(368 + k, y3, C.INK); W(325 + k, y3, C.INK); }
    }
    for (var x4 = 280; x4 < 372; x4++) { W(x4, 152, C.RIM); for (var y4 = 153; y4 < 157; y4++) W(x4, y4, C.TERRA_1); }
    // Baseboards along the wall bottoms.
    for (var x5 = -80; x5 < 720; x5++) {
      var yb = x5 < 176 ? leftBottom(x5) : x5 > 464 ? rightBottom(x5) : 198;
      W(x5, Math.round(yb) - 1, C.BROWN_1);
      W(x5, Math.round(yb) - 2, C.BROWN_1);
    }
    // Rim light on the back-wall top edge, where the window light reaches.
    for (var x6 = 230; x6 < 420; x6++) W(x6, 62, (x6 & 1) ? C.TERRA_1 : C.BROWN_2);
    add({ id: 'shell.room', zone: 'shell', kind: 'shell', layer: 2, x: -80, y: -96, note: 'fixture shell' }, { base: s });

    // Front floor band (L5): the floor from y 236 down, so parallax shows depth against the back floor.
    var f = new Spr(800, 148);
    for (var j2 = 0; j2 < 148; j2++) for (var i2 = 0; i2 < 800; i2++) if (isFloor(i2 - 80, j2 + 236)) f.px[j2 * 800 + i2] = floorColor(i2 - 80, j2 + 236);
    add({ id: 'shell.floor-front', zone: 'shell', kind: 'shell', layer: 5, x: -80, y: 236, note: 'fixture front floor' }, { base: f });
  })();

  // Sky (L0): the window plus 24 px of margin. Hot bands, a sun, cloud streaks.
  (function sky() {
    var s = new Spr(140, 130); // world x 256..396, y 46..176
    var bands = [[0, C.TERRA_1], [26, C.TERRA_2], [44, C.RIM], [58, C.ORANGE], [70, C.GLOW]];
    for (var y = 0; y < 130; y++) {
      var c = C.TERRA_1;
      bands.forEach(function (b) { if (y >= b[0]) c = b[1]; });
      s.rect(0, y, 140, 1, c);
    }
    s.disc(326 - 256, 106 - 46, 10, C.GLOW).disc(326 - 256, 106 - 46, 8, C.SUN);
    [[40, 34, 26], [78, 42, 30], [52, 52, 18]].forEach(function (cl) { s.rect(cl[0], cl[1], cl[2], 1, C.AMBER).rect(cl[0] + 4, cl[1] - 1, cl[2] - 10, 1, C.GLOW); });
    add({ id: 'outside.sky', zone: 'outside', kind: 'shell', layer: 0, x: 256, y: 46, note: 'fixture sky' }, { base: s });
  })();

  // City (L1): slate blocks below the horizon, a power line, tree crowns.
  (function city() {
    var s = new Spr(116, 70); // world x 268..384, y 100..170
    var x = 0;
    var heights = [9, 14, 7, 18, 11, 6, 15, 10, 13, 8, 16, 12];
    var k = 0;
    while (x < 116) {
      var w = 7 + ((k * 5) % 6), h = heights[k % heights.length];
      s.rect(x, 21 - h + 8, w, 70, (k & 1) ? C.SLATE_0 : C.SLATE_1).rect(x, 21 - h + 8, w, 1, C.SLATE_2);
      for (var wy = 21 - h + 11; wy < 44; wy += 4) for (var wx = x + 2; wx < x + w - 1; wx += 3) s.set(wx, wy, C.INK_COOL);
      x += w + 1;
      k++;
    }
    for (var t = 0; t < 116; t += 9) s.disc(t, 46 + ((t * 7) % 5), 6, (t & 2) ? C.LEAF_1 : C.LEAF_0);
    s.rect(0, 52, 116, 18, C.LEAF_0);
    s.line(0, 18, 116, 24, C.INK);
    add({ id: 'outside.city', zone: 'outside', kind: 'shell', layer: 1, x: 268, y: 100, note: 'fixture city' }, { base: s });
  })();

  // Frame crops (L6).
  (function frames() {
    var p = new Spr(110, 136); // hanging plant, world (-80, -96)
    p.line(70, 0, 70, 96, C.INK);
    for (var i = 0; i < 26; i++) p.disc(40 + ((i * 13) % 60), 80 + ((i * 7) % 50), 5, i % 3 ? C.LEAF_0 : C.LEAF_1);
    p.disc(70, 100, 10, C.BROWN_1).rect(60, 100, 21, 10, C.TERRA_0);
    add({ id: 'frame.plant', zone: 'frame', kind: 'decor', layer: 6, x: -80, y: -96, note: 'hanging plant' }, { base: p });

    var cab = new Spr(88, 184); // filing cabinet, world (-80, 200)
    cab.rect(0, 0, 88, 184, C.SLATE_0).frame(0, 0, 88, 184, C.INK).rect(84, 0, 4, 184, C.INK_COOL);
    for (var d = 0; d < 3; d++) cab.frame(6, 8 + d * 56, 72, 50, C.INK).rect(36, 28 + d * 56, 12, 3, C.SLATE_1);
    cab.rect(87, 0, 1, 184, C.RIM);
    add({ id: 'frame.cabinet', zone: 'frame', kind: 'decor', layer: 6, x: -80, y: 200, note: 'filing cabinet' }, { base: cab });

    var sp = new Spr(88, 194); // speaker, world (632, 190)
    sp.rect(0, 0, 88, 194, C.BROWN_1).frame(0, 0, 88, 194, C.INK).rect(0, 0, 1, 194, C.RIM);
    sp.disc(44, 70, 26, C.INK).disc(44, 70, 18, C.BROWN_0).disc(44, 70, 6, C.INK).disc(44, 140, 12, C.INK);
    add({ id: 'frame.speaker', zone: 'frame', kind: 'decor', layer: 6, x: 632, y: 190, note: 'speaker' }, { base: sp });
  })();

  /* ------------------------------------------------------------------ hotspots */
  // A crude object: dark body, a category panel that grows with the stage, a rim on the window side.
  function object(w, h, cat, stage, side) {
    var s = new Spr(w, h);
    var ramp = CAT[cat];
    s.rect(0, 0, w, h, C.BROWN_1).frame(0, 0, w, h, C.INK);
    var ph = Math.max(2, Math.round((h - 4) * [0.35, 0.6, 0.85][stage]));
    s.rect(2, h - 2 - ph, w - 4, ph, stage === 0 ? ramp[0] : ramp[1]);
    if (stage === 2) s.rect(2, h - 2 - ph, w - 4, 1, ramp[2]).set(2, 2, C.GOLD);
    if (side === 'right') s.rect(w - 1, 1, 1, h - 2, C.RIM);
    else if (side === 'left') s.rect(0, 1, 1, h - 2, C.RIM);
    else s.rect(1, 0, w - 2, 1, C.RIM);
    return s;
  }
  function hotspot(id, zone, layer, x, y, w, h, skill, cat, side, extra) {
    var sp = { s0: object(w, h, cat, 0, side), s1: object(w, h, cat, 1, side), s2: object(w, h, cat, 2, side) };
    sp.base = sp.s1;
    if (extra) extra(sp);
    add({ id: id, zone: zone, kind: 'hotspot', layer: layer, x: x, y: y, target: { skill: skill }, label: skill.toUpperCase().replace(/-/g, ' '), led: [x + w - 5, y + 2], note: 'fixture ' + skill }, sp);
  }

  hotspot('kitchen.fridge', 'kitchen', 4, 14, 128, 30, 100, 'food', 'nutrition', 'right');
  hotspot('kitchen.door', 'kitchen', 3, 60, 104, 30, 106, 'college-integration', 'school', 'right');
  hotspot('bed.bed', 'bed', 2, 104, 172, 72, 34, 'sleep', 'athletics', 'right');
  hotspot('library.shelf', 'library', 2, 182, 96, 40, 100, 'reading', 'school', 'top');
  hotspot('library.chess', 'library', 3, 232, 194, 24, 20, 'chess', 'mind', 'top');
  hotspot('library.cushion', 'library', 3, 196, 206, 22, 8, 'meditation', 'mind', 'top');
  hotspot('window.board', 'window', 2, 264, 92, 16, 34, 'visualization', 'mind', 'right');
  hotspot('window.plant', 'window', 2, 348, 136, 14, 16, 'gut-health', 'nutrition', 'top');
  hotspot('study.desk', 'study', 2, 384, 160, 62, 38, 'academics', 'school', 'top');
  hotspot('study.calendar', 'study', 2, 420, 96, 26, 30, 'time-blocking', 'mind', 'top');
  hotspot('computer.monitor', 'computer', 2, 470, 140, 34, 30, 'ai-building', 'business', 'left');
  hotspot('computer.boxes', 'computer', 3, 512, 182, 26, 30, 'dropshipping', 'business', 'left');
  hotspot('gym.rack', 'gym', 4, 548, 196, 40, 34, 'strength', 'athletics', 'left');
  hotspot('gym.shoes', 'gym', 5, 566, 238, 18, 8, 'running', 'athletics', 'left');
  hotspot('gym.bike', 'gym', 5, 596, 196, 30, 50, 'triathlon', 'athletics', 'left', function (sp) {
    // Covered by a sheet unless the skill is active ("awake").
    ['s0', 's1', 's2'].forEach(function (k) {
      var c = new Spr(30, 50);
      c.rect(2, 8, 26, 42, C.ROSE_0).frame(2, 8, 26, 42, C.BROWN_2).rect(2, 8, 1, 42, C.ROSE_1).disc(15, 9, 6, C.ROSE_0);
      sp[k] = c;
    });
    var a = new Spr(30, 50);
    a.disc(7, 40, 8, C.INK).disc(7, 40, 6, T).disc(23, 40, 8, C.INK).disc(23, 40, 6, T).line(7, 40, 15, 26, C.CRT_0).line(15, 26, 23, 40, C.CRT_0).line(15, 26, 22, 24, C.CRT_1).rect(10, 22, 7, 2, C.INK);
    sp.awake = a;
    sp.base = sp.s0;
  });

  // Statue (feature: overall), GOLD pixels pulse.
  (function statue() {
    var s = new Spr(36, 81);
    s.rect(4, 62, 28, 19, C.BROWN_1).frame(4, 62, 28, 19, C.INK).rect(4, 62, 28, 1, C.RIM);
    s.disc(18, 8, 5, C.GOLD_DK).rect(13, 14, 10, 24, C.GOLD_DK).rect(9, 15, 4, 18, C.GOLD_DK).rect(23, 15, 4, 18, C.GOLD_DK);
    s.rect(13, 38, 4, 24, C.GOLD_DK).rect(19, 38, 4, 24, C.GOLD_DK);
    s.rect(22, 15, 1, 22, C.GOLD).rect(21, 4, 2, 8, C.GOLD).rect(26, 16, 1, 16, C.GOLD).rect(22, 38, 1, 24, C.GOLD).set(20, 3, C.SUN).set(22, 16, C.SUN);
    add({ id: 'window.statue', zone: 'window', kind: 'hotspot', layer: 4, x: 258, y: 149, target: { feature: 'overall' }, label: 'FORGE', led: [287, 213], note: 'fixture statue' }, { base: s });
  })();

  // Dog (decor, the engine moves it), with a 2-frame breathing anim.
  (function dog() {
    function frame(b) {
      var s = new Spr(18, 10);
      s.rect(2, 4 - b, 14, 6 + b, C.BROWN_2).rect(0, 5, 5, 5, C.BROWN_2).rect(0, 5, 2, 2, C.INK).rect(15, 7, 3, 2, C.BROWN_2).rect(2, 4 - b, 14, 1, C.TERRA_1);
      return s;
    }
    add({ id: 'window.dog', zone: 'window', kind: 'decor', layer: 3, x: 310, y: 214, anim: { fps: 1 }, note: 'fixture dog' }, { base: frame(0), anim: [frame(0), frame(1)] });
  })();

  // Backpack (feature: today; "alert" when something is due within 48 h) and doormat (review letter).
  (function alerts() {
    var b = new Spr(18, 16);
    b.rect(2, 2, 14, 14, C.SLATE_0).frame(2, 2, 14, 14, C.INK).rect(6, 0, 6, 3, C.INK).rect(15, 3, 1, 12, C.RIM);
    var ba = b.clone().rect(4, 6, 6, 4, C.CREAM).rect(4, 6, 6, 1, C.CRT_1);
    add({ id: 'kitchen.backpack', zone: 'kitchen', kind: 'hotspot', layer: 4, x: 64, y: 212, target: { feature: 'today' }, label: 'BACKPACK', led: [77, 214], note: 'fixture backpack' }, { base: b, alert: ba });
    var m = new Spr(28, 6);
    m.rect(0, 1, 28, 5, C.BROWN_2).frame(0, 1, 28, 5, C.BROWN_0);
    var ma = m.clone().rect(10, 0, 8, 4, C.CREAM).rect(10, 0, 8, 1, C.GOLD);
    add({ id: 'kitchen.doormat', zone: 'kitchen', kind: 'hotspot', layer: 4, x: 58, y: 226, target: { feature: 'review' }, label: 'DOORMAT', led: [81, 227], note: 'fixture doormat' }, { base: m, alert: ma });
  })();

  /* ------------------------------------------------------------------ decor that exercises variants */
  (function decor() {
    // Desk lamp: night variant has a lit bulb.
    var l = new Spr(10, 20);
    l.rect(4, 4, 2, 16, C.INK).rect(1, 18, 8, 2, C.INK).rect(0, 0, 10, 5, C.BROWN_1).rect(0, 4, 10, 1, C.RIM);
    var ln = l.clone().rect(2, 5, 6, 1, C.SUN).rect(1, 6, 8, 1, C.GLOW);
    add({ id: 'study.lamp', zone: 'study', kind: 'decor', layer: 2, x: 448, y: 140, note: 'desk lamp' }, { base: l, night: ln });

    // Poster with room-tier variants t1 (torn sheet), t3 (framed), t5 (gilded).
    function poster(frameC, inner) {
      var s = new Spr(22, 28);
      s.rect(0, 0, 22, 28, frameC).rect(2, 2, 18, 24, inner).rect(4, 6, 14, 2, C.CREAM).rect(4, 10, 10, 1, C.ROSE_1);
      return s;
    }
    add({ id: 'library.poster', zone: 'library', kind: 'decor', layer: 2, x: 232, y: 90, note: 'poster' }, { t1: poster(C.ROSE_0, C.PLUM_0), t3: poster(C.INK, C.PLUM_0), t5: poster(C.GOLD, C.PLUM_0) });

    // Holiday overlay: a pumpkin on the sill in the Halloween run-up.
    var pk = new Spr(10, 7);
    pk.disc(5, 4, 3, C.ORANGE).rect(2, 3, 7, 3, C.ORANGE).rect(4, 0, 2, 2, C.LEAF_2).set(3, 4, C.INK).set(7, 4, C.INK);
    add({ id: 'window.pumpkin', zone: 'window', kind: 'overlay', layer: 2, x: 290, y: 145, note: 'halloween pumpkin' }, { halloween: pk });

    // Ceiling fan with a 2-frame anim (ambient at 10 fps max).
    function fan(k) {
      var s = new Spr(48, 10);
      s.rect(23, 0, 2, 6, C.INK).rect(20, 5, 8, 3, C.BROWN_1);
      if (k) s.rect(0, 6, 20, 1, C.BROWN_2).rect(28, 6, 20, 1, C.BROWN_2);
      else s.rect(6, 7, 14, 1, C.BROWN_2).rect(28, 5, 14, 1, C.BROWN_2);
      return s;
    }
    add({ id: 'window.fan', zone: 'window', kind: 'decor', layer: 2, x: 296, y: 42, anim: { fps: 6 }, note: 'ceiling fan' }, { base: fan(0), anim: [fan(0), fan(1)] });

    // Computer desk under the monitor, a kitchen counter, a few plants.
    var d = new Spr(50, 36);
    d.rect(0, 0, 50, 4, C.BROWN_2).rect(0, 0, 1, 4, C.RIM).rect(2, 4, 3, 32, C.INK).rect(45, 4, 3, 32, C.INK);
    add({ id: 'computer.desk', zone: 'computer', kind: 'decor', layer: 2, x: 466, y: 170, note: 'computer desk' }, { base: d });
    var k2 = new Spr(40, 40);
    k2.rect(0, 0, 40, 40, C.BROWN_1).frame(0, 0, 40, 40, C.INK).rect(0, 0, 40, 2, C.TERRA_1).rect(39, 2, 1, 38, C.RIM);
    add({ id: 'kitchen.counter', zone: 'kitchen', kind: 'decor', layer: 3, x: -40, y: 180, note: 'counter' }, { base: k2 });
    [[160, 180, 'bed'], [366, 182, 'study'], [530, 150, 'computer'], [200, 150, 'library']].forEach(function (p, i) {
      var s = new Spr(14, 18);
      s.rect(3, 12, 8, 6, C.TERRA_1).rect(3, 12, 8, 1, C.RIM);
      for (var j = 0; j < 6; j++) s.disc(4 + ((j * 5) % 8), 4 + ((j * 3) % 8), 3, j % 2 ? C.LEAF_1 : C.LEAF_0);
      add({ id: p[2] + '.plant' + i, zone: p[2], kind: 'decor', layer: 2, x: p[0], y: p[1], note: 'plant' }, { base: s });
    });
  })();

  window.ROOM_ART = { palette: PALETTE, zones: ZONES, items: items, images: images, fixture: true };
})();
