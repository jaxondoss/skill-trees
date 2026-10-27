#!/usr/bin/env python3
"""Texture metrics for pixel art (TEXTURE_SPEC section 9, phase 0 calibration).

Computes, for an image or crops of it: iso (isolated pixels), chk (2x2 checkerboards), var (adjacent pairs
that differ), split (base shade / one step / two+ steps by lightness rank) and max3x3 (most colours in a 3x3
window), plus the number of shades with 1%+ of the area. The definitions are texture_check.metrics().

Non-indexed images (a JPEG reference) are first reduced to their native pixel grid (block mode of a
--pixel N grid, or --pixel auto to estimate N from where colour edges fall) and quantized to --colors K
colours (median cut over the whole image, so every crop shares one palette).

Usage:
  python3 scripts/texture-metrics.py IMAGE [--pixel auto|N] [--colors 48] [--crop name:x0,y0,x1,y1 ...]
          [--crop-native] [--save OUT.png] [--json]
  Crops are in source pixels unless --crop-native (then in native-grid pixels).
Examples:
  python3 scripts/texture-metrics.py docs/redesign/room-r6/refs/pixelized_theme_inspo.jpg --pixel auto \\
      --crop wall:40,1060,120,1320 --crop floor:300,1640,1100,1990
  python3 scripts/texture-metrics.py docs/redesign/room-prototype/art-r5/main/shell/l2.base.png
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "art", "room-r6"))
from texture_check import metrics  # noqa: E402


def lstar_of(rgb):
    c = rgb.astype(np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    return np.where(y > 0.008856, 116 * np.cbrt(y) - 16, 903.3 * y)


def estimate_pixel(rgb, smax=16):
    """Native pixel size of an upscaled pixel-art image: strong colour edges fall on multiples of the size.
    For each candidate s and phase, score = share of edge strength on that phase; the true size has one
    dominant phase. Returns (s, phase_x, phase_y, scores)."""
    a = rgb.astype(np.float64)
    gx = np.abs(np.diff(a, axis=1)).sum(-1).sum(0)        # edge strength between column x and x+1
    gy = np.abs(np.diff(a, axis=0)).sum(-1).sum(1)
    gx = np.where(gx > np.percentile(gx, 60), gx, 0)
    gy = np.where(gy > np.percentile(gy, 60), gy, 0)
    scores = {}
    best = None
    for s in range(2, smax + 1):
        bx = np.bincount(np.arange(len(gx)) % s, weights=gx, minlength=s)
        by = np.bincount(np.arange(len(gy)) % s, weights=gy, minlength=s)
        cx, cy = bx.max() / bx.sum(), by.max() / by.sum()
        # concentration relative to chance (1/s): 1.0 = all edges on one phase
        sc = (cx * s - 1) / (s - 1) * 0.5 + (cy * s - 1) / (s - 1) * 0.5
        scores[s] = round(float(sc), 3)
        if best is None or sc > best[0] + 0.02:
            best = (sc, s, int(bx.argmax()) + 1, int(by.argmax()) + 1)
    # prefer the largest s whose score is within 85% of the best (multiples of the true size score lower)
    s_best = best[1]
    for s in sorted(scores):
        if scores[s] >= 0.85 * best[0] and s % s_best == 0:
            s_best = s
    bx = np.bincount(np.arange(len(gx)) % s_best, weights=gx, minlength=s_best)
    by = np.bincount(np.arange(len(gy)) % s_best, weights=gy, minlength=s_best)
    return s_best, (int(bx.argmax()) + 1) % s_best, (int(by.argmax()) + 1) % s_best, scores


def to_native(rgb, s, px=0, py=0):
    """Block-median reduce to the native grid (one colour per s x s cell, phase px, py)."""
    a = rgb[py:, px:]
    h, w = a.shape[0] // s, a.shape[1] // s
    a = a[:h * s, :w * s].reshape(h, s, w, s, 3).transpose(0, 2, 1, 3, 4).reshape(h, w, s * s, 3)
    # the median of the inner pixels avoids JPEG ringing at block edges
    inner = a.reshape(h, w, s, s, 3)[:, :, s // 4:s - s // 4, s // 4:s - s // 4].reshape(h, w, -1, 3)
    return np.median(inner, axis=2).astype(np.uint8)


def quantize(rgb, k):
    im = Image.fromarray(rgb).quantize(colors=k, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    idx = np.array(im)
    pal = np.array(im.getpalette()[:3 * 256]).reshape(-1, 3)
    return idx, pal


def load_indexed(path):
    """An indexed (palette-exact) sprite: colours -> ids, transparent -> 255."""
    im = np.array(Image.open(path).convert("RGBA"))
    op = im[..., 3] == 255
    key = (im[..., 0].astype(np.int64) << 16) | (im[..., 1].astype(np.int64) << 8) | im[..., 2]
    uniq, inv = np.unique(key[op], return_inverse=True)
    idx = np.full(op.shape, 255, np.uint8)
    idx[op] = inv.astype(np.uint8)
    pal = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], -1)
    return idx, pal


def report(name, idx, pal, m=None):
    ls = np.full(256, 50.0)
    ls[:len(pal)] = lstar_of(pal.astype(np.uint8))
    mt = metrics(idx, m, None, ls)
    sp = mt["split"]
    return {"name": name, "n": mt["n"], "iso": round(mt["iso"], 4), "chk": round(mt["chk"], 4),
            "var": round(mt["var"], 4), "max3x3": mt["max3x3"], "p99_3x3": float(np.percentile(mt["d3"], 99)),
            "base": round(sp[0], 3), "step1": round(sp[1], 3), "step2": round(sp[2], 3), "shades": mt["shades"],
            "colors": mt["colors"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--pixel", default=None, help="native pixel size of an upscaled image (N or auto)")
    ap.add_argument("--colors", type=int, default=48)
    ap.add_argument("--crop", action="append", default=[], help="name:x0,y0,x1,y1")
    ap.add_argument("--crop-native", action="store_true")
    ap.add_argument("--save", default=None, help="save the native-grid quantized image (4x) here")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    rows = []
    for path in a.images:
        im = Image.open(path)
        s = 1
        if a.pixel or im.mode not in ("P", "RGBA", "LA") and path.lower().endswith((".jpg", ".jpeg", ".webp")):
            rgb = np.array(im.convert("RGB"))
            if a.pixel in (None, "auto"):
                s, px, py, scores = estimate_pixel(rgb)
                print(f"{path}: estimated native pixel {s} px (phase {px},{py}); scores {scores}", file=sys.stderr)
            else:
                s, px, py = int(a.pixel), 0, 0
            nat = to_native(rgb, s, px, py) if s > 1 else rgb
            idx, pal = quantize(nat, a.colors)
            if a.save:
                Image.fromarray(pal[idx].astype(np.uint8)).resize((idx.shape[1] * 4, idx.shape[0] * 4),
                                                                  Image.NEAREST).save(a.save)
        else:
            idx, pal = load_indexed(path)
        crops = a.crop or [f"all:0,0,{idx.shape[1] * s},{idx.shape[0] * s}"]
        for c in crops:
            nm, box = c.split(":")
            x0, y0, x1, y1 = (int(v) for v in box.split(","))
            if not a.crop_native and s > 1:
                x0, y0, x1, y1 = x0 // s, y0 // s, x1 // s, y1 // s
            sub = idx[y0:y1, x0:x1]
            rows.append(dict(report(f"{os.path.basename(path)}:{nm}", sub, pal), pixel=s))
    if a.json:
        print(json.dumps(rows, indent=1))
        return
    print(f"{'image:crop':40s} {'px':>3s} {'n':>7s} {'iso':>6s} {'chk':>6s} {'var':>6s} {'3x3':>4s} {'p99':>4s} "
          f"{'base':>5s} {'1st':>5s} {'2+':>5s} {'sh':>3s} {'cols':>4s}")
    for r in rows:
        print(f"{r['name'][-40:]:40s} {r['pixel']:3d} {r['n']:7d} {r['iso']:6.1%} {r['chk']:6.1%} {r['var']:6.1%} "
              f"{r['max3x3']:4d} {r['p99_3x3']:4.0f} {r['base']:5.0%} {r['step1']:5.0%} {r['step2']:5.0%} "
              f"{r['shades']:3d} {r['colors']:4d}")


if __name__ == "__main__":
    main()
