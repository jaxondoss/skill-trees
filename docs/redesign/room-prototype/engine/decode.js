/* FORGE room prototype: decode ROOM_ART images.
 *
 * Each image in ROOM_ART.images is {w, h, rle, mat?}: base64 of byte pairs [count, index], row-major,
 * index 0..63 = palette colour, 255 = transparent. mat (art pass 6) is the material ID per pixel in the same
 * encoding (TEXTURE_SPEC section 4), decoded lazily the first time the renderer asks for it. Decoded images are cached by path and carry
 * the derived data the renderer needs: opaque bounds, the outline ring, and the top edge (dust).
 */
(function () {
  'use strict';
  var ROOM = typeof window !== 'undefined' ? window.ROOM : null;
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

  /* ------------------------------------------------------------------ v3.5 skill wire (D3 2.1) */
  // Chebyshev (square) dilation by r of a w x h 0/1 mask (outside the array counts as 0).
  function dilate(m, w, h, r) {
    var out = m;
    for (var k = 0; k < r; k++) {
      var a = new Uint8Array(w * h), b = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = y * w + x;
          a[i] = out[i] | (y > 0 ? out[i - w] : 0) | (y < h - 1 ? out[i + w] : 0);
        }
      }
      for (var y2 = 0; y2 < h; y2++) {
        for (var x2 = 0; x2 < w; x2++) {
          var j = y2 * w + x2;
          b[j] = a[j] | (x2 > 0 ? a[j - 1] : 0) | (x2 < w - 1 ? a[j + 1] : 0);
        }
      }
      out = b;
    }
    return out;
  }
  function invert(m) {
    var o = new Uint8Array(m.length);
    for (var i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1;
    return o;
  }

  /**
   * D3 2.1 skill wire of a w x h 0/1 object mask, the runtime twin of build.py wire_from_mask (no occlusion): the
   * orthogonal hull (every row and column filled between its extremes, 3 passes, then closed by 2 px), the line at
   * Chebyshev distance 2 outside it (one clear pixel between object and line), and 4 nodes at the line's diagonal
   * extremes in the order top-left (min x+y), top-right (max x-y), bottom-right (max x+y), bottom-left (max y-x),
   * ties first in row-major order. shape 'bbox' uses the mask's bounding box. Returns {hull: Int16Array [x, y, ...]
   * row-major in mask coordinates (may reach 3 px outside the mask), nodes: [x, y] x 4 flat} or null (empty mask).
   */
  function wireFromMask(mask, w, h, shape) {
    var P = 8, W = w + 2 * P, H = h + 2 * P;
    var m = new Uint8Array(W * H), any = false;
    var bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        m[(y + P) * W + x + P] = 1;
        any = true;
        if (x + P < bx0) bx0 = x + P;
        if (x + P > bx1) bx1 = x + P;
        if (y + P < by0) by0 = y + P;
        if (y + P > by1) by1 = y + P;
      }
    }
    if (!any) return null;
    var hm;
    if (shape === 'bbox') {
      hm = new Uint8Array(W * H);
      for (var yb = by0; yb <= by1; yb++) hm.fill(1, yb * W + bx0, yb * W + bx1 + 1);
    } else {
      hm = m;
      for (var pass = 0; pass < 3; pass++) {
        var r = new Uint8Array(W * H);
        for (var yr = 0; yr < H; yr++) {
          var lo = -1, hi = -1;
          for (var xr = 0; xr < W; xr++) {
            if (hm[yr * W + xr]) {
              if (lo < 0) lo = xr;
              hi = xr;
            }
          }
          if (lo >= 0) r.fill(1, yr * W + lo, yr * W + hi + 1);
        }
        var c = new Uint8Array(W * H);
        for (var xc = 0; xc < W; xc++) {
          var t = -1, b = -1;
          for (var yc = 0; yc < H; yc++) {
            if (r[yc * W + xc]) {
              if (t < 0) t = yc;
              b = yc;
            }
          }
          for (var yy = t; t >= 0 && yy <= b; yy++) c[yy * W + xc] = 1;
        }
        hm = c;
      }
      hm = invert(dilate(invert(dilate(hm, W, H, 2)), W, H, 2)); // closing by 2
    }
    var d2 = dilate(hm, W, H, 2), d1 = dilate(hm, W, H, 1);
    var pts = [];
    var n0 = -1, n1 = -1, n2 = -1, n3 = -1, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
    for (var yl = 0; yl < H; yl++) {
      for (var xl = 0; xl < W; xl++) {
        var k = yl * W + xl;
        if (!d2[k] || d1[k]) continue;
        var px = xl - P, py = yl - P, q = pts.length;
        pts.push(px, py);
        if (n0 < 0 || px + py < v0) {
          n0 = q;
          v0 = px + py;
        }
        if (n1 < 0 || px - py > v1) {
          n1 = q;
          v1 = px - py;
        }
        if (n2 < 0 || px + py > v2) {
          n2 = q;
          v2 = px + py;
        }
        if (n3 < 0 || py - px > v3) {
          n3 = q;
          v3 = py - px;
        }
      }
    }
    return {
      hull: new Int16Array(pts),
      nodes: [pts[n0], pts[n0 + 1], pts[n1], pts[n1 + 1], pts[n2], pts[n2 + 1], pts[n3], pts[n3 + 1]],
    };
  }

  /** Runtime skill wire of a decoded image (items without a build-exported wire), cached like the ring. */
  function wire(img, shape) {
    var key = shape === 'bbox' ? 'wireBox' : 'wireHull';
    if (img[key] === undefined) {
      var mask = new Uint8Array(img.w * img.h);
      for (var i = 0; i < mask.length; i++) mask[i] = img.px[i] !== T ? 1 : 0;
      img[key] = wireFromMask(mask, img.w, img.h, shape);
    }
    return img[key];
  }

  function ring(img) {
    if (!img.ring) img.ring = outlineRing(img);
    return img.ring;
  }
  function top(img) {
    if (!img.top) img.top = topEdge(img);
    return img.top;
  }

  var api = { get: get, decodeRle: decodeRle, mat: mat, ring: ring, top: top, opaque: opaque, wire: wire, wireFromMask: wireFromMask };
  if (ROOM) ROOM.decode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
