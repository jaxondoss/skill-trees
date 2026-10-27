/* FORGE room prototype: decode ROOM_ART images.
 *
 * Each image in ROOM_ART.images is {w, h, rle, mat?}: base64 of byte pairs [count, index], row-major,
 * index 0..63 = palette colour, 255 = transparent. mat (art pass 6) is the material ID per pixel in the same
 * encoding (TEXTURE_SPEC section 4), decoded lazily the first time the renderer asks for it. Decoded images are cached by path and carry
 * the derived data the renderer needs: opaque bounds, the outline ring, and the top edge (dust).
 */
(function () {
  'use strict';
  var ROOM = window.ROOM;
  var T = 255;
  var cache = Object.create(null);

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Decode one RLE stream to a Uint8Array of w*h palette indices. Throws on a length mismatch. */
  function decodeRle(w, h, rle) {
    var bytes = b64ToBytes(rle);
    var px = new Uint8Array(w * h);
    var p = 0;
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      var n = bytes[i];
      var v = bytes[i + 1];
      if (p + n > px.length) throw new Error('RLE overruns ' + w + 'x' + h);
      px.fill(v, p, p + n);
      p += n;
    }
    if (p !== px.length) throw new Error('RLE has ' + p + ' of ' + px.length + ' pixels');
    return px;
  }

  // Bounding box of the opaque pixels: [x, y, w, h] relative to the sprite, or null when empty.
  function opaqueBounds(img) {
    var x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
    for (var y = 0; y < img.h; y++) {
      var row = y * img.w;
      for (var x = 0; x < img.w; x++) {
        if (img.px[row + x] !== T) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  function opaque(img, x, y) {
    return x >= 0 && y >= 0 && x < img.w && y < img.h && img.px[y * img.w + x] !== T;
  }

  // Transparent pixels 4-adjacent to an opaque one (may lie one pixel outside the sprite).
  // Stored as a flat Int16Array [x0, y0, x1, y1, ...] in sprite coordinates.
  function outlineRing(img) {
    var pts = [];
    for (var y = -1; y <= img.h; y++) {
      for (var x = -1; x <= img.w; x++) {
        if (opaque(img, x, y)) continue;
        if (opaque(img, x - 1, y) || opaque(img, x + 1, y) || opaque(img, x, y - 1) || opaque(img, x, y + 1)) pts.push(x, y);
      }
    }
    return new Int16Array(pts);
  }

  // Top edge: the highest opaque pixel of every column, [x, y, ...] (where dust settles).
  function topEdge(img) {
    var pts = [];
    for (var x = 0; x < img.w; x++) {
      for (var y = 0; y < img.h; y++) {
        if (img.px[y * img.w + x] !== T) {
          pts.push(x, y);
          break;
        }
      }
    }
    return new Int16Array(pts);
  }

  /**
   * Get a decoded image by its ROOM_ART path. Returns null when the path is unknown or broken, so a
   * missing sprite never stops the room from drawing.
   * The result: {w, h, px: Uint8Array, bounds, ring (lazy), top (lazy)}.
   */
  function get(path) {
    if (!path) return null;
    if (path in cache) return cache[path];
    var src = ROOM.art.images[path];
    var img = null;
    if (src) {
      try {
        img = { path: path, w: src.w, h: src.h, px: decodeRle(src.w, src.h, src.rle) };
        img.bounds = opaqueBounds(img);
      } catch (err) {
        console.error('ROOM: cannot decode ' + path, err);
        img = null;
      }
    }
    cache[path] = img;
    return img;
  }

  /** Material IDs (Uint8Array w*h) of an image, or null when the bundle has none for it. */
  function mat(img) {
    if (img.mat !== undefined) return img.mat;
    var src = ROOM.art.images[img.path];
    img.mat = null;
    if (src && src.mat) {
      try {
        img.mat = decodeRle(src.w, src.h, src.mat);
      } catch (err) {
        console.error('ROOM: cannot decode materials of ' + img.path, err);
      }
    }
    return img.mat;
  }

  function ring(img) {
    if (!img.ring) img.ring = outlineRing(img);
    return img.ring;
  }
  function top(img) {
    if (!img.top) img.top = topEdge(img);
    return img.top;
  }

  ROOM.decode = { get: get, decodeRle: decodeRle, mat: mat, ring: ring, top: top, opaque: opaque };
})();
