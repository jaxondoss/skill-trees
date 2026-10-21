#!/usr/bin/env python3
"""FORGE room, revision 3: the live layered art (deterministic, Pixel Art Studio style).

Chunky flat 16-bit look: flat clusters, 2-4 tones per material, dark 1 px outlines, no dither
(light pools are flat 2-tone ellipses, the sky is 5 flat bands).

Every object is drawn by its own function into a transparent 800x480 master buffer, cropped to the union
of its variants and saved as `docs/redesign/room-prototype/art-r3/<zone>/<name>.<variant>.png` under the
item ids the engine already uses (art-v3). The stills are composited from those same sprites in the
engine's draw order (layer, shell first, contact y, manifest order), so stills and live art cannot drift.

Coordinates: master (800x480) = world + (80, 96). The 640x270 core is master (80, 96, 720, 366).
Camera ~9-10 ft from the back wall: back wall master x 170..630, side walls are 14% slivers,
vanishing point master (400, 212) = world (320, 116).

Run:  python3 art/room-r3/build.py
Out:  art/room-r3/{manifest.json, zones.json, palette.json}, docs/redesign/room-prototype/art-r3/**,
      docs/redesign/room-r3/stills/*.png
Then: python3 art/room-v3/merge.py --src room-r3   (parity check, palette + grain checks, writes art-v3.js)
"""
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, "/home/user/skill-pack/.claude/skills/pixel-art-studio/scripts")
try:
    from pixelstudio import Sprite  # palette-locked export check
except Exception:  # pragma: no cover
    Sprite = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PROTO = os.path.join(ROOT, "docs", "redesign", "room-prototype")
SPR_DIR = "art-r3"  # sprite paths are relative to PROTO
STILLS = os.path.join(ROOT, "docs", "redesign", "room-r3", "stills")

# ---------------------------------------------------------------- palette
# The v3 master palette (32, unchanged so the engine's colour names keep working) plus 5 R3 colours.
BASE = json.load(open(os.path.join(ROOT, "art", "room-v3", "common", "palette.json")))
EXTRA = [("CHAR", "#1E2423", "charcoal plaster (shadow)"),
         ("WALL_G", "#2B3633", "slate-green plaster (main wall)"),
         ("STAT_1", "#19202C", "obsidian body, near-black blue"),
         ("STAT_2", "#2E3B50", "obsidian sheen, dark blue"),
         ("STAT_HI", "#C6DCEE", "cool blue-white specular (short runs only)")]
PAL = [(c[0], c[1]) for c in BASE["colors"]] + [(n, h) for n, h, _ in EXTRA]
N = {n: i for i, (n, _) in enumerate(PAL)}
RGB = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for _, h in PAL]
T = 255  # transparent index
FLAT = [v for t in RGB for v in t] + [0, 0, 0] * (256 - len(RGB))


def write_palette():
    luts = json.loads(json.dumps(BASE["luts"]))
    luts["R1"].update({"WALL_G": "CHAR", "STAT_HI": "STAT_2"})
    luts["R2"].update({"STAT_HI": "SLATE_1"})
    luts["NIGHT"].update({"WALL_G": "CHAR", "CHAR": "INK", "STAT_HI": "STAT_2", "STAT_2": "STAT_1"})
    luts["DIM"].update({"WALL_G": "CHAR", "CHAR": "INK", "STAT_HI": "STAT_2", "STAT_2": "STAT_1"})
    out = {
        "_note": "FORGE room R3 palette: the v3 master palette (32, same names and order) plus 5 R3 colours "
                 "(charcoal and slate-green plaster, obsidian statue tones). Index 255 = transparent.",
        "colors": [[n, h, d] for (n, h), d in zip(PAL, [c[2] if len(c) > 2 else "" for c in BASE["colors"]] + [e[2] for e in EXTRA])],
        "categories": BASE["categories"],
        "luts": luts,
    }
    with open(os.path.join(HERE, "palette.json"), "w") as f:
        json.dump(out, f, indent=1)


# ---------------------------------------------------------------- canvas
W, H = 800, 480
OX, OY = 80, 96  # master = world + (OX, OY)
CORE = (80, 96, 720, 366)
VP = (400, 212)


class S:
    im = None
    d = None


def reset(fill=T):
    S.im = Image.new("P", (W, H), fill)
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)


def arr():
    return np.array(S.im)


def put(a):
    S.im = Image.fromarray(a.astype(np.uint8), "P")
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)


def R(x0, y0, x1, y1, c):
    if x1 < x0 or y1 < y0:
        return
    S.d.rectangle([x0, y0, x1, y1], fill=N[c])


def P(x, y, c):
    x, y = int(x), int(y)
    if 0 <= x < W and 0 <= y < H:
        S.im.putpixel((x, y), N[c])


def L(x0, y0, x1, y1, c):
    S.d.line([int(x0), int(y0), int(x1), int(y1)], fill=N[c])


def PL(pts, c):
    S.d.line([(int(x), int(y)) for x, y in pts], fill=N[c])


def POLY(pts, c, ol=None):
    S.d.polygon([(int(round(x)), int(round(y))) for x, y in pts], fill=N[c], outline=N[ol] if ol else None)


def ELL(x0, y0, x1, y1, c, ol=None):
    S.d.ellipse([x0, y0, x1, y1], fill=N[c], outline=N[ol] if ol else None)


def BOX(x0, y0, x1, y1, f, hi=None, sh=None, ol="INK", rim=None):
    R(x0, y0, x1, y1, ol)
    R(x0 + 1, y0 + 1, x1 - 1, y1 - 1, f)
    if hi:
        L(x0 + 1, y0 + 1, x1 - 1, y0 + 1, hi)
    if sh:
        L(x0 + 1, y1 - 1, x1 - 1, y1 - 1, sh)
    if rim == "r":
        L(x1, y0 + 1, x1, y1 - 1, "RIM")
    elif rim == "l":
        L(x0, y0 + 1, x0, y1 - 1, "RIM")
    elif rim == "t":
        L(x0 + 1, y0, x1 - 1, y0, "RIM")


def circ(cx, cy, r, c):
    S.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=N[c])


def ring(cx, cy, r, c):
    S.d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=N[c])


def sag(x0, y0, x1, y1, s, c, n=None):
    n = n or max(2, int(abs(x1 - x0) + abs(y1 - y0)))
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + s * 4 * t * (1 - t)))
    PL(pts, c)
    return pts


def remap(mp, sel=None):
    a = arr()
    out = a.copy()
    for k, v in mp.items():
        m = a == N[k]
        if sel is not None:
            m &= sel
        out[m] = N[v]
    put(out)


# ---------------------------------------------------------------- tiny font (3x5)
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001010010",
    "8": "111101111101111", "9": "111101111001111", "F": "111100110100100", "O": "111101101101111",
    "R": "110101110101101", "G": "111100101101111", "E": "111100110100111", "D": "110101101101110",
    ":": "000010000010000", "A": "010101111101101", "T": "111010010010010", "-": "000000111000000",
    "I": "111010010010111", "$": "011110010011110", " ": "000000000000000", "W": "101101111111101",
    "K": "101101110101101", "N": "110101101101101", "S": "011100010001110", "C": "011100100100011",
    "V": "101101101101010", "L": "100100100100111", "M": "101111111101101", ".": "000000010000000",
}


def text(x, y, s, c, gap=1):
    for ch in s:
        g = FONT.get(ch, FONT[" "])
        for i, b in enumerate(g):
            if b == "1":
                P(x + i % 3, y + i // 3, c)
        x += 3 + gap
    return x


def text_w(s, gap=1):
    return len(s) * (3 + gap) - gap


# ---------------------------------------------------------------- geometry
def lw(x, f):
    yt = 59 + 65 * x / 170
    yb = 365 - 65 * x / 170
    return yb - f * (yb - yt)


def rw(x, f):
    return lw(800 - x, f)


def wq(side, xa, xb, fa, fb):
    fn = lw if side == "L" else rw
    return [(xa, fn(xa, fb)), (xb, fn(xb, fb)), (xb, fn(xb, fa)), (xa, fn(xa, fa))]


def regions():
    reg = Image.new("L", (W, H), 0)
    rd = ImageDraw.Draw(reg)
    rd.polygon([(0, 0), (800, 0), (800, 59), (630, 124), (170, 124), (0, 59)], fill=1)
    rd.rectangle([170, 124, 630, 300], fill=2)
    rd.polygon([(0, 59), (170, 124), (170, 300), (0, 365)], fill=3)
    rd.polygon([(800, 59), (630, 124), (630, 300), (800, 365)], fill=4)
    rd.polygon([(0, 365), (170, 300), (630, 300), (800, 365), (800, 480), (0, 480)], fill=5)
    return np.array(reg)


RG = regions()
YS, XS = np.mgrid[0:H, 0:W]


def pool(cx, cy, rx, ry, mp, reg=None, inner=0.45, core=None):
    """Flat 2-tone light pool: outer ellipse remapped with mp, the inner ellipse with core (or mp twice)."""
    a = arr()
    dd = ((XS - cx) / rx) ** 2 + ((YS - cy) / ry) ** 2
    ok = dd <= 1.0
    if reg is not None:
        ok &= np.isin(RG, reg if isinstance(reg, (list, tuple)) else [reg])
    out = a.copy()
    for k, v in mp.items():
        out[ok & (a == N[k])] = N[v]
    cmap = core
    if cmap is None:
        cmap = {k: mp.get(v, v) for k, v in mp.items()}
    cm = ok & (dd <= inner)
    for k, v in cmap.items():
        out[cm & (a == N[k])] = N[v]
    put(out)


def remap_poly(pts, mp, reg=None):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in pts], fill=1)
    sel = np.array(m) == 1
    if reg is not None:
        sel &= np.isin(RG, reg)
    remap(mp, sel)


# ---------------------------------------------------------------- shared props
BOOKC = ["TERRA_1", "SLATE_1", "LEAF_2", "OAK_1", "GOLD_DK", "TERRA_0", "CREAM", "SLATE_0",
         "TERRA_2", "LEAF_1", "CRT_0", "OAK_2", "SLATE_2"]
LIGHT = {"TERRA_1": "TERRA_2", "SLATE_1": "SLATE_2", "LEAF_2": "LEAF_3", "OAK_1": "OAK_2",
         "GOLD_DK": "GOLD", "TERRA_0": "TERRA_1", "CREAM": "CREAM", "SLATE_0": "SLATE_1",
         "TERRA_2": "RIM", "LEAF_1": "LEAF_2", "CRT_0": "CRT_1", "OAK_2": "GLOW",
         "SLATE_2": "CREAM", "OAK_0": "OAK_1", "BROWN_1": "SLATE_0"}


def books(x0, x1, yb, hmax, rng, flat_ok=True):
    x = x0
    while x <= x1 - 1:
        if flat_ok and rng.random() < 0.12 and x1 - x >= 8:
            w = rng.randint(6, min(9, x1 - x))
            yy = yb
            for _ in range(rng.randint(2, 3)):
                col = rng.choice(BOOKC)
                R(x, yy - 1, x + w - 1, yy, col)
                L(x, yy - 1, x + w - 1, yy - 1, LIGHT.get(col, col))
                yy -= 2
                w -= rng.randint(0, 1)
            x += w + 2
            continue
        w = rng.choice([2, 2, 3, 3, 3, 4])
        if x + w - 1 > x1:
            break
        h = rng.randint(max(4, hmax - 5), hmax)
        col = rng.choice(BOOKC)
        R(x, yb - h + 1, x + w - 1, yb, col)
        L(x, yb - h + 1, x + w - 1, yb - h + 1, LIGHT.get(col, col))
        if rng.random() < 0.4:
            L(x, yb - h + 3, x + w - 1, yb - h + 3, "GOLD_DK" if col != "GOLD_DK" else "CREAM")
        x += w + (1 if rng.random() < 0.6 else 0)
    return x


def leaf(x, y, rng, dark=False):
    if dark:
        P(x, y, "LEAF_0"); P(x + 1, y, "LEAF_0"); P(x, y + 1, "LEAF_0"); P(x + 1, y + 1, "LEAF_0")
        return
    R(x - 1, y, x + 1, y + 1, "LEAF_1")
    P(x + 1, y, "LEAF_2"); P(x, y, "LEAF_2")
    if rng.random() < 0.35:
        P(x + 1, y, "LEAF_3")


def plant(cx, yb, size, rng, pot="TERRA_1", tall=1.0, potw=None):
    pw = potw or max(4, size // 2 + 2)
    ph = max(3, size // 3)
    x0 = cx - pw // 2
    top = yb - ph
    for i in range(size * 5):
        a = rng.uniform(math.pi * 1.05, math.pi * 1.95)
        r = rng.uniform(0.25, 1.0) * size
        x = cx + math.cos(a) * r * 0.9
        y = top - 1 + math.sin(a) * r * tall
        leaf(int(x), int(y), rng, dark=i < size * 2)
    BOX(x0, yb - ph, x0 + pw - 1, yb, pot, hi=LIGHT.get(pot), sh="TERRA_0" if pot.startswith("TERRA") else "INK")


def snake_plant(cx, yb, h, rng):
    for i, dx in enumerate((-2, -1, 0, 1, 2)):
        hh = h - abs(dx) * 3 - rng.randint(0, 3)
        L(cx + dx, yb - 5, cx + dx + (dx > 0) - (dx < 0), yb - 5 - hh, "LEAF_1" if i % 2 else "LEAF_2")
        P(cx + dx + (dx > 0) - (dx < 0), yb - 5 - hh, "LEAF_3")
    BOX(cx - 3, yb - 4, cx + 3, yb, "SLATE_0", hi="SLATE_1")


def vine(x, y, length, rng, drift=0.0):
    for i in range(length):
        y += 1
        if rng.random() < 0.35:
            x += 1 if rng.random() < 0.5 + drift else -1
        P(x, y, "LEAF_0")
        if i % 3 == 1:
            s = 1 if (i // 3) % 2 else -1
            P(x + s, y, "LEAF_2"); P(x + 2 * s, y, "LEAF_1"); P(x + s, y + 1, "LEAF_1"); P(x + 2 * s, y + 1, "LEAF_1")


def hanging_basket(x, ytop, ybask, rng, vines=4, vlen=40):
    L(x, ytop, x - 4, ybask, "INK"); L(x, ytop, x + 4, ybask, "INK")
    for i in range(vines):
        vine(x - 5 + i * 10 // max(1, vines - 1), ybask + 4, rng.randint(vlen // 2, vlen), rng)
    for i in range(8):
        leaf(x - 4 + rng.randint(0, 8), ybask - 2 + rng.randint(-1, 0), rng)
    BOX(x - 5, ybask, x + 5, ybask + 5, "TERRA_1", hi="TERRA_2", sh="TERRA_0")


def speaker(x0, y0, x1, y1, rim=None):
    BOX(x0, y0, x1, y1, "BROWN_1", hi="SLATE_0", sh="INK", rim=rim)
    w = x1 - x0
    cx = (x0 + x1) // 2
    r = max(2, w // 2 - 2)
    cy = y1 - r - 2
    circ(cx, cy, r, "INK")
    if r > 2:
        circ(cx, cy, r - 1, "CHAR")
    circ(cx, cy, max(1, r // 3), "SLATE_0")
    if y1 - y0 > 2 * r + 8:
        circ(cx, y0 + 4, 1, "INK")


def gear(x0, y0, x1, y1, rng, rim=None, face="CHAR"):
    BOX(x0, y0, x1, y1, "BROWN_1", hi="SLATE_0", sh="INK", rim=rim)
    R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, face)
    x = x0 + 3
    while x < x1 - 4:
        k = rng.random()
        if k < 0.35:
            R(x, (y0 + y1) // 2, x + 1, (y0 + y1) // 2 + 1, "SLATE_1")
        elif k < 0.6 and x < x1 - 6:
            R(x, y0 + 3, x + 3, y0 + 4, "GLOW")
            x += 3
        else:
            R(x, y1 - 4, x + 1, y1 - 3, "INK")
        x += 3


def cable(pts, c="INK"):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        out += sag(x0, y0, x1, y1, 2, c)
    return out


BULBS = ["GLOW", "SUN", "CRT_1", "SLATE_2", "PLUM_3"]


def string_lights(x0, y0, x1, y1, s, step=9, seed=0, lit=True, n_max=None):
    """Wire with 2x2 bulbs in fixed colours (no single-pixel twinkles)."""
    pts = sag(x0, y0, x1, y1, s, "INK")
    k = 0
    for i in range(seed % step, len(pts), step):
        if n_max is not None and k >= n_max:
            break
        x, y = pts[i]
        c = BULBS[(i // step + seed) % len(BULBS)] if lit else "SLATE_0"
        R(x, y + 1, x + 1, y + 2, c)
        k += 1


def frame(x0, y0, x1, y1, inner, fc="OAK_1"):
    BOX(x0, y0, x1, y1, fc, hi=LIGHT.get(fc), sh="OAK_DK")
    R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, inner)


def pendant_lamp(x, ytop, ylen, v, shade="SLATE_0"):
    """Pendant: t1 bare bulb, base/t3 dark dome, t5 brass dome. night = brighter bulb ring."""
    tr = tier(v)
    L(x, ytop, x, ylen - 4, "INK")
    if tr <= 2:
        R(x - 1, ylen - 4, x + 1, ylen - 2, "INK")
        R(x - 1, ylen - 1, x + 1, ylen + 1, "SUN")
        P(x, ylen + 2, "GLOW")
        return
    body, hi = (shade, LIGHT.get(shade, "CRT_1")) if tr < 5 else ("GOLD_DK", "GOLD")
    POLY([(x - 2, ylen - 4), (x + 2, ylen - 4), (x + 6, ylen + 2), (x - 6, ylen + 2)], body, "INK")
    L(x - 5, ylen + 1, x + 5, ylen + 1, hi)
    R(x - 2, ylen + 3, x + 2, ylen + 4, "GLOW" if v != "night" else "SUN")
    R(x - 1, ylen + 3, x, ylen + 4, "SUN")


def stage(v):
    return {"s0": 0, "s2": 2}.get(v, 1)


def tier(v):
    return int(v[1]) if v and v[0] == "t" and v[1:].isdigit() else 3


# ---------------------------------------------------------------- registry
ITEMS = []


def reg(id_, zone, kind, fn, variants=("base",), layer=None, target=None, label=None, led=None, note="",
        lit=False, still=None, extra=None):
    ITEMS.append(dict(order=len(ITEMS), id=id_, zone=zone, kind=kind, fn=fn, variants=list(variants), layer=layer, target=target,
                      label=label, led=led, note=note, lit=lit, still=still, extra=extra or {}))


# ---------------------------------------------------------------- shell (one opaque canvas, cut into plates)
def shell_canvas(night=False):
    reset(N["VOID"])
    a = np.full((H, W), N["VOID"], np.uint8)
    a[RG == 1] = N["CHAR"]
    a[RG == 2] = N["WALL_G"]
    a[RG == 3] = N["CHAR"]
    a[RG == 4] = N["CHAR"]
    fl = RG == 5
    z = np.clip(YS - 212, 1, None).astype(float)
    u = (XS - 400) * 88.0 / z + 400
    k = np.floor((u - 170) / 12).astype(int)
    frac = (u - 170) / 12 - k
    pw = 12 * z / 88
    col = np.where(k % 3 == 0, N["BROWN_1"], N["OAK_DK"])
    col = np.where(frac * pw < 1, N["VOID"], col)
    j1 = 304 + (np.abs(k * 37) % 50)
    j2 = j1 + 38 + (np.abs(k * 13) % 30)
    col = np.where((YS == j1) | (YS == j2), N["VOID"], col)
    sh = fl & (YS > 344)
    col = np.where(sh & (col == N["OAK_DK"]), N["BROWN_1"], col)
    col = np.where(sh & (YS > 352) & (col == N["BROWN_1"]), N["INK"], col)
    a[fl] = col[fl]
    a[(RG == 2) & (YS < 131)] = N["CHAR"]
    a[(RG == 2) & ((XS < 175) | (XS > 625))] = N["CHAR"]
    a[(RG == 3) & (YS > (lw(XS.clip(0, 170), 0.92)))] = N["INK"]
    a[(RG == 4) & (YS > (rw(XS.clip(630, 800), 0.92)))] = N["INK"]
    put(a)
    R(170, 296, 630, 299, "CHAR"); L(170, 296, 630, 296, "INK")
    POLY(wq("L", 0, 170, 0, 0.018), "INK")
    POLY(wq("R", 630, 800, 0, 0.018), "INK")
    for x, y, l in ((190, 140, 5), (590, 150, 4), (360, 270, 6), (612, 230, 3)):
        L(x, y, x + l, y + 1, "CHAR")
    L(170, 124, 170, 300, "INK"); L(630, 124, 630, 300, "INK")
    L(170, 124, 630, 124, "VOID")
    L(0, 59, 170, 124, "VOID"); L(630, 124, 800, 59, "VOID")
    ceiling_shell()
    lights(night)
    if not night:
        sun_patch()


def ceiling_shell():
    def xl(y):
        return (y - 59) * 170 / 65

    for bx in (150, 250, 350, 450, 550, 650):
        x2 = 400 + (bx - 400) * 212 / 88
        for o in (-1, 0, 1):
            L(bx + o, 124, x2 + o * 2, 0, "INK")
        L(bx + 2, 124, x2 + 5, 0, "VOID")
    for y0, y1 in ((112, 117), (88, 94), (60, 68), (20, 30)):
        a0, a1 = xl(y0), xl(y1)
        POLY([(a0, y0), (800 - a0, y0), (800 - a1, y1), (a1, y1)], "INK")
        L(a0, y0, 800 - a0, y0, "CHAR")
        L(a1, y1, 800 - a1, y1, "VOID")
    R(280, 118, 330, 119, "INK")  # downlight track over the statue


def lights(night):
    """Lamp pools on the shell (flat 2-tone, no dither). Every skill object sits in a pool or the sun patch."""
    W2 = {"WALL_G": "SLATE_0", "CHAR": "WALL_G"}
    WARM = {"WALL_G": "OAK_DK", "CHAR": "BROWN_1"}
    FLOOR = {"BROWN_1": "OAK_DK", "OAK_DK": "OAK_0", "VOID": "BROWN_1"}
    pool(226, 236, 30, 26, WARM, reg=[2], core={"WALL_G": "OAK_0", "CHAR": "OAK_DK"})          # reading lamp
    pool(222, 322, 40, 12, FLOOR, reg=[5])                                                    # reading floor
    pool(198, 152, 26, 14, W2, reg=[2])                                                        # library pendant
    pool(464, 258, 34, 24, {"WALL_G": "OAK_DK", "CHAR": "OAK_DK"}, reg=[2], core={"WALL_G": "GOLD_DK", "CHAR": "OAK_DK"})  # Today CRT amber
    pool(498, 268, 18, 14, {"WALL_G": "OAK_DK"}, reg=[2])                                      # stats LCD
    pool(566, 186, 44, 34, WARM, reg=[2], inner=0.2)                                             # study pendant (corkboard, calendar)
    pool(566, 304, 50, 10, FLOOR, reg=[5])                                                     # study floor
    pool(650, 246, 26, 30, {"CHAR": "SLATE_0"}, reg=[4], inner=0.3)                            # monitors cyan
    pool(150, 236, 22, 22, {"CHAR": "BROWN_1"}, reg=[3], core={"CHAR": "OAK_DK"})              # bed shelf (globe)
    pool(162, 316, 34, 12, FLOOR, reg=[5])                                                     # bed + cushion floor
    pool(106, 232, 24, 52, {"CHAR": "BROWN_1"}, reg=[3], core={"CHAR": "OAK_DK"})              # door lamp
    pool(108, 334, 30, 9, FLOOR, reg=[5])                                                      # door floor
    pool(138, 270, 20, 18, {"CHAR": "BROWN_1"}, reg=[3])                                       # kitchen counter
    pool(678, 250, 30, 44, {"CHAR": "BROWN_1"}, reg=[4], core={"CHAR": "OAK_DK"})              # gym pendant
    pool(672, 336, 42, 12, FLOOR, reg=[5])                                                     # gym floor
    pool(421, 138, 20, 12, {"WALL_G": "TERRA_0", "CHAR": "TERRA_0"}, reg=[2], inner=0.3)       # relic niche ember
    if night:
        pool(421, 200, 90, 60, {"WALL_G": "SLATE_0"}, reg=[2], inner=0.2)                     # moonlight


def sun_patch():
    pts = [(352, 304), (494, 304), (506, 352), (330, 352)]
    remap_poly(pts, SUN1, reg=[5])
    remap_poly([(370, 312), (476, 312), (484, 344), (356, 344)], SUN2, reg=[5])
    L(423, 304, 421, 352, "TERRA_0"); L(424, 304, 422, 352, "TERRA_0")
    L(345, 327, 500, 327, "TERRA_0")


SUN1 = {"OAK_DK": "TERRA_1", "BROWN_1": "OAK_1", "VOID": "TERRA_0", "INK": "TERRA_0",
        "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "GOLD_DK": "GOLD"}
SUN2 = {"TERRA_1": "RIM", "OAK_1": "TERRA_2", "TERRA_2": "ORANGE", "TERRA_0": "TERRA_1"}


# ---------------------------------------------------------------- window view (sky, outside, frame)
GX0, GY0, GX1, GY1 = 344, 152, 498, 242


def sky(v):
    night = v == "night"
    bands = ([(GY0, "INK"), (166, "SLATE_0"), (182, "SLATE_0"), (196, "SLATE_1"), (212, "SLATE_1")] if night else
             [(GY0, "TERRA_1"), (166, "TERRA_2"), (182, "RIM"), (198, "ORANGE"), (212, "GLOW")])
    for i, (y, c) in enumerate(bands):
        yn = bands[i + 1][0] if i + 1 < len(bands) else GY1 + 1
        R(GX0, y, GX1, yn - 1, c)
    if night:
        circ(470, 166, 6, "CREAM"); circ(472, 164, 5, "SLATE_0")
        return
    for x0, x1, y, dark, lit in ((350, 410, 160, "TERRA_0", "RIM"), (420, 490, 170, "TERRA_1", "GLOW"),
                                 (362, 440, 188, "TERRA_2", "GLOW"), (440, 496, 194, "RIM", "SUN")):
        R(x0, y, x1, y + 1, dark)
        R(x0 + 4, y - 1, x1 - 8, y - 1, dark)
        L(x0 + 2, y + 2, x1 - 3, y + 2, lit)
    circ(392, 216, 11, "SUN")
    circ(392, 216, 7, "CREAM")


def outside(v):
    night = v == "night"
    rng = random.Random(21)
    x = GX0
    while x < GX1:
        w = rng.randint(7, 12)
        h = rng.randint(6, 12)
        top = 232 - h
        POLY([(x, 236), (x, top + 3), (x + w // 2, top), (x + w, top + 3), (x + w, 236)], "SLATE_0" if night else "SLATE_1")
        x += w + rng.randint(0, 2)

    def oak(cx, cy, rx, ry, seed):
        r2 = random.Random(seed)
        for i in range(60):
            a = r2.uniform(0, math.tau)
            rr = r2.uniform(0, 1) ** 0.6
            xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
            ELL(xx - 4, yy - 3, xx + 4, yy + 3, "LEAF_0")
        if night:
            return
        for i in range(30):
            a = r2.uniform(math.pi, math.tau)
            rr = r2.uniform(0.5, 1)
            xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr * 0.9
            R(xx, yy, xx + 2, yy + 1, "LEAF_1")

    oak(352, 205, 16, 24, 3)
    L(354, 220, 356, 242, "INK"); L(355, 220, 357, 242, "LEAF_0")
    oak(486, 170, 26, 22, 4)
    oak(470, 222, 18, 10, 5)
    L(484, 186, 488, 242, "INK")
    for px_, top in ((372, 178), (452, 182)):
        L(px_, top, px_, 242, "INK")
        L(px_ - 5, top + 3, px_ + 5, top + 3, "INK")
    sag(GX0, 186, 367, 181, 2, "INK")
    sag(377, 181, 447, 185, 7, "INK")
    sag(367, 181, 447, 185, 9, "INK")
    sag(457, 185, GX1, 190, 4, "INK")
    sag(GX0, 214, GX1, 212, 3, "INK")
    x = GX0 - 3
    while x < GX1:
        w = rng.randint(9, 13)
        h = rng.randint(12, 18)
        top = 242 - h
        POLY([(x, 242), (x, top + 4), (x + w // 2, top), (x + w, top + 4), (x + w, 242)], "INK" if night else "SLATE_0", "INK")
        if not night:
            L(x + 1, top + 4, x + w // 2, top + 1, "TERRA_2")
        if rng.random() < 0.6:
            R(x + w // 2, top + 7, x + w // 2 + 1, top + 8, "GLOW")
        if rng.random() < 0.5 or night:
            R(x + 2, top + 10, x + 3, top + 12, "GOLD")
        R(x, 240, x + w, 242, "INK")
        x += w + rng.randint(1, 3)
    BOX(420, 226, 452, 240, "LEAF_1" if night else "LEAF_2", hi="LEAF_3", sh="LEAF_1")
    for xx in range(423, 450, 4):
        R(xx, 229, xx + 2, 231, "GLOW")
    L(421, 235, 451, 235, "CRT_0")
    L(436, 226, 442, 214, "INK")
    R(424, 240, 428, 241, "INK"); R(444, 240, 448, 241, "INK")
    L(GX0, 242, GX1, 242, "INK")
    # clip to the glass
    a = arr()
    m = np.ones_like(a, bool)
    m[GY0:GY1 + 1, GX0:GX1 + 1] = False
    a[m] = T
    put(a)


def window_frame(v):
    BOX(339, 147, 503, 247, "OAK_DK")
    R(GX0, GY0, GX1, GY1, "OAK_DK")  # glass hole filled below
    R(420, GY0, 421, GY1, "OAK_DK"); L(422, GY0, 422, GY1, "RIM" if v != "night" else "OAK_0")
    R(GX0, 196, GX1, 197, "OAK_DK"); L(GX0, 198, GX1, 198, "RIM" if v != "night" else "OAK_0")
    L(GX0 - 1, GY0, GX0 - 1, GY1, "OAK_0"); L(GX0, GY0 - 1, GX1, GY0 - 1, "OAK_0")
    BOX(332, 243, 510, 249, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="t" if v != "night" else None)
    R(334, 250, 508, 251, "INK")
    POLY([(496, 145), (508, 145), (510, 250), (500, 250), (502, 200)], "SLATE_0", "INK")
    L(502, 147, 504, 248, "SLATE_1"); L(506, 147, 508, 248, "CHAR")
    if v != "night":
        L(497, 146, 501, 199, "RIM")
    R(336, 144, 512, 145, "INK")
    # punch the glass (sky and outside show through)
    a = arr()
    hole = np.zeros_like(a, bool)
    hole[GY0:GY1 + 1, GX0:GX1 + 1] = True
    hole[GY0:GY1 + 1, 420:423] = False
    hole[196:199, GX0:GX1 + 1] = False
    hole &= ~((XS >= 496) & (YS <= 250) & (a != N["OAK_DK"]))  # curtain stays
    a[hole & (a == N["OAK_DK"])] = T
    put(a)


# ---------------------------------------------------------------- window zone objects
def candles(v):
    for i, x in enumerate(range(352, 400, 7)):
        BOX(x, 237, x + 3, 243, "CREAM", sh="OAK_2", ol="OAK_DK")
        P(x + 1, 236, "INK")
        if i < 3:
            R(x + 1, 233, x + 2, 235, "GLOW"); P(x + 1, 233, "SUN")


def sill_plant_a(v):
    plant(410, 243, 5, random.Random(31), pot="SLATE_1")


def sill_plant_b(v):
    plant(342, 243, 4, random.Random(32), pot="TERRA_1")


def sill_mug(v):
    BOX(482, 237, 488, 243, "CREAM", sh="SLATE_2"); L(489, 239, 490, 241, "CREAM")


def win_stringlights(v):
    string_lights(334, 146, 512, 147, 9, step=10, seed=1)


def niche(v):
    """Relic niche above the window. base: empty (subtle plus); active iron; hot; gold."""
    cx, top = 421, 127
    x0, x1, y1 = cx - 14, cx + 14, 146
    POLY([(x0, y1), (x0, top + 8), (cx, top), (x1, top + 8), (x1, y1)], "OAK_DK", "INK")
    inner = [(x0 + 3, y1 - 1), (x0 + 3, top + 9), (cx, top + 3), (x1 - 3, top + 9), (x1 - 3, y1 - 1)]
    POLY(inner, "VOID")
    L(x0, y1, x1, y1, "INK")
    if v == "base":
        L(cx - 2, top + 16, cx + 2, top + 16, "SLATE_0"); L(cx, top + 14, cx, top + 18, "SLATE_0")
        return
    hot = v in ("hot", "gold")
    if v == "hot":
        POLY([(x0 + 4, y1 - 1), (x0 + 4, top + 11), (cx, top + 6), (x1 - 4, top + 11), (x1 - 4, y1 - 1)], "TERRA_0")
    if v == "gold":
        POLY([(x0 + 4, y1 - 1), (x0 + 4, top + 11), (cx, top + 6), (x1 - 4, top + 11), (x1 - 4, y1 - 1)], "GOLD_DK")
    for i, c in enumerate(("CRT_0", "SLATE_2", "CREAM", "SLATE_2", "CRT_0")):
        L(cx - 6 + i, top + 6, cx - 2 + i // 2, top + 12, c)
        L(cx + 6 - i, top + 6, cx + 2 - i // 2, top + 12, c)
    body, edge, hi = {"active": ("BROWN_1", "INK", "SLATE_0"), "hot": ("ORANGE", "TERRA_0", "SUN"),
                      "gold": ("GOLD", "GOLD_DK", "SUN")}[v]
    circ(cx, top + 18, 6, edge)
    circ(cx, top + 18, 5, body)
    ring(cx, top + 18, 4, "GLOW" if hot else "CHAR")
    R(cx - 3, top + 15, cx - 2, top + 16, hi)
    mk = "TERRA_0" if hot else "INK"
    P(cx - 3, top + 19, mk); P(cx - 2, top + 18, mk); P(cx - 1, top + 19, mk)
    P(cx, top + 18, mk); P(cx + 1, top + 19, mk)
    P(cx + 3, top + 17, mk); P(cx + 3, top + 18, mk); P(cx + 2, top + 20, mk); P(cx + 4, top + 20, mk)
    if hot:
        L(x0 + 1, y1 - 1, x1 - 1, y1 - 1, "RIM")


def vinyl(v):
    BOX(346, 280, 372, 300, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    for i, x in enumerate(range(348, 371, 2)):
        L(x, 272 + (i * 3) % 5, x, 281, ["INK", "CRT_0", "SLATE_1", "GOLD", "INK", "LEAF_2"][i % 6])


def radiator(v):
    BOX(394, 268, 438, 298, "SLATE_0", hi="SLATE_1", sh="INK")
    for x in range(397, 436, 3):
        L(x, 270, x, 296, "SLATE_1" if x % 2 else "CHAR")
    L(394, 269, 394, 297, "RIM")
    BOX(398, 262, 410, 268, "CREAM", sh="OAK_2")
    BOX(412, 263, 420, 268, "INK", hi="SLATE_0"); R(415, 264, 416, 265, "SLATE_2")
    books(424, 437, 267, 7, random.Random(33), flat_ok=False)


def win_plant(v):
    plant(382, 300, 8, random.Random(34), pot="TERRA_1", tall=1.6)


def plantwall(v):
    t = tier(v)
    if t <= 2:
        plant(442, 300, 3, random.Random(35), pot="SLATE_1")
    elif t >= 4:
        plant(442, 300, 7, random.Random(35), pot="SLATE_1", tall=1.4)
    else:
        plant(442, 300, 5, random.Random(35), pot="SLATE_1")


def amp(v):
    rng = random.Random(3)
    gear(440, 282, 486, 300, rng, face="CHAR")
    gear(442, 274, 484, 282, rng, face="INK")


def crt_frame(x0, y0, x1, y1):
    BOX(x0, y0, x1, y1, "BROWN_1", hi="SLATE_0", sh="INK")
    for i in range(3):
        R(x1 - 3, y0 + 4 + i * 3, x1 - 2, y0 + 4 + i * 3, "SLATE_1")
    return x0 + 3, y0 + 3, x1 - 6, y1 - 4


def today_crt(v):
    """Big CRT (Today). Idle: dim amber screen; the engine blinks a cursor until the first log."""
    sx0, sy0, sx1, sy1 = crt_frame(444, 242, 484, 274)
    R(sx0, sy0, sx1, sy1, "GOLD_DK")
    for c in ((sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)):
        P(*c, "OAK_DK")
    for i, (y, w) in enumerate(((sy0 + 3, 14), (sy0 + 7, 10), (sy0 + 11, 16), (sy0 + 15, 8))):
        R(sx0 + 3, y, sx0 + 3 + w, y + 1, "OAK_DK")
    BOX(452, 238, 468, 242, "CREAM", sh="OAK_2")
    L(446, 238, 446, 242, "SLATE_2"); P(446, 237, "SLATE_2")


def stats_crt(v):
    """Small CRT (stats): amber LCD; the engine alternates "72 OVR" and the streak with a flame."""
    sx0, sy0, sx1, sy1 = crt_frame(484, 254, 512, 276)
    R(sx0, sy0, sx1, sy1, "OAK_DK")
    for c in ((sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)):
        P(*c, "INK")
    plant(498, 254, 4, random.Random(36), pot="OAK_1")


def win_speaker(v):
    speaker(488, 276, 508, 300)


def powerstrip(v):
    for i, c in enumerate(("INK", "CRT_0", "INK", "SLATE_1")):
        R(452, 316 - i, 470, 316 - i, c)
    BOX(476, 312, 486, 318, "INK", hi="SLATE_0"); R(480, 314, 481, 315, "SLATE_2")


# ---------------------------------------------------------------- statue
def statue_mask(k=1):
    w, h = 64 * k, 150 * k
    m = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(m)

    def S_(*v):
        return [x * k for x in v]

    def cap(pts):
        for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2 * k) + 1
            for i in range(n + 1):
                t = i / n
                x, y, r = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t
                md.ellipse(S_(x - r, y - r, x + r, y + r), fill=255)

    md.ellipse(S_(25, 0, 39, 18), fill=255)
    md.rectangle(S_(29, 14, 35, 23), fill=255)
    md.polygon([(x * k, y * k) for x, y in [(29, 19), (35, 19), (44, 25), (20, 25)]], fill=255)
    md.polygon([(x * k, y * k) for x, y in [(20, 25), (44, 25), (48, 32), (45, 44), (42, 58), (41, 66), (43, 74), (42, 80),
                                            (32, 84), (22, 80), (21, 74), (23, 66), (22, 58), (19, 44), (16, 32)]], fill=255)
    cap([(18, 30, 4.5), (16, 32, 4.5), (12, 52, 3.4), (11, 74, 2.4)])
    cap([(46, 30, 4.5), (48, 32, 4.5), (52, 52, 3.4), (53, 74, 2.4)])
    md.ellipse(S_(8, 73, 14, 88), fill=255)
    md.ellipse(S_(50, 73, 56, 88), fill=255)
    cap([(26, 80, 6), (24, 96, 5.2), (23, 110, 3.8), (21, 121, 4.0), (20, 140, 2.4)])
    cap([(38, 80, 6), (40, 96, 5.2), (41, 110, 3.8), (43, 121, 4.0), (44, 140, 2.4)])
    md.polygon([(x * k, y * k) for x, y in [(17, 141), (23, 141), (24, 148), (14, 148)]], fill=255)
    md.polygon([(x * k, y * k) for x, y in [(41, 141), (47, 141), (50, 148), (40, 148)]], fill=255)
    M = np.array(m) > 0
    yy = np.arange(h)[:, None]
    M[:, 31 * k:34 * k] &= ~((yy > 88 * k) & (yy < 149 * k))
    return M


def depth_map(M, n=5):
    D = np.zeros(M.shape, int)
    cur = M.copy()
    for k in range(1, n):
        er = cur.copy()
        er[1:, :] &= cur[:-1, :]; er[:-1, :] &= cur[1:, :]
        er[:, 1:] &= cur[:, :-1]; er[:, :-1] &= cur[:, 1:]
        D[cur & ~er] = k
        cur = er
    D[cur] = n
    return D


def statue_body():
    """Obsidian body at 1x: flat STAT_1 with STAT_2 planes; a broken cool rim on the window (right) side only."""
    M = statue_mask(1)
    h, w = M.shape
    D = depth_map(M)

    def inside(x, y):
        return 0 <= x < w and 0 <= y < h and M[y, x]

    px = {}
    for y in range(h):
        for x in range(w):
            if not M[y, x]:
                continue
            c = "STAT_1"
            if D[y, x] == 1:
                rt = not inside(x + 1, y)
                up = not inside(x, y - 1)
                dn = not inside(x, y + 1)
                if dn:
                    c = "INK"
                elif rt and x >= 30:
                    # window-facing contour: broken 1 px rim (gaps every 7th-8th row), STAT_HI on short runs
                    # broken cool rim: short SLATE_1 runs with gaps, STAT_HI only on a few 2 px specks
                    c = "SLATE_1" if (y // 3) % 3 != 2 else "STAT_2"
                    if y in (3, 4, 28, 29):
                        c = "STAT_HI"
                elif up and y < 30 and x >= 30:
                    c = "STAT_2"
                else:
                    c = "INK" if not rt else "STAT_1"
            px[(x, y)] = c

    def s(x, y, c):
        if inside(x, y) and D[y, x] >= 2:
            px[(x, y)] = c

    for x in range(21, 31):
        s(x, 36 + (1 if x in (21, 22, 30) else 0), "INK")
        s(64 - x, 36 + (1 if x in (21, 22, 30) else 0), "INK")
    for x in range(36, 41):
        s(x, 29, "STAT_2"); s(x, 30, "STAT_2")
    for y in range(31, 66):
        s(32, y, "INK")
    for y in (46, 53, 60):
        for x in (29, 30, 31, 33, 34, 35):
            s(x, y, "INK")
    for y in (42, 49, 56):
        s(35, y, "STAT_2"); s(35, y + 1, "STAT_2"); s(34, y, "STAT_2")
    for i in range(9):
        s(24 + i * 6 // 8, 67 + i, "INK"); s(40 - i * 6 // 8, 67 + i, "INK")
    for y in range(79, 88):
        for x in (31, 32, 33):
            s(x, y, "INK")
    for y in range(89, 104):
        s(38 + (y - 89) // 8, y, "STAT_2"); s(39 + (y - 89) // 8, y, "STAT_2")
    for y in range(115, 137):
        t = (y - 115) / 22
        s(round(41 + 2 * t), y, "STAT_2")
    for y in range(36, 70):
        t = (y - 36) / 34
        s(round(49.5 + 2 * t), y, "STAT_2"); s(round(50.5 + 2 * t), y, "STAT_2")
    s(20, 30, "INK"); s(20, 31, "INK"); s(44, 30, "INK"); s(44, 31, "INK")
    for x, y in ((34, 3), (35, 3), (35, 4)):
        px[(x, y)] = "STAT_2"
    for x in (28, 29, 30, 34, 35, 36):
        s(x, 8, "INK")
    for x in range(30, 35):
        if inside(x, 18):
            px[(x, 18)] = "INK"
    return px, M, D


def crack_network(M, D, k=1, seed=303):
    """Kintsugi trunks in growth order: list of (pixels, junctions). Smooth 1 px lines, no zigzags."""
    rng = random.Random(seed)
    h, w = M.shape

    def ok(x, y):
        return 0 <= x < w and 0 <= y < h and M[y, x] and D[y, x] >= 2

    def walk(x, y, n, lean, depth, out, junc):
        # mostly downward, with diagonal steps that keep their direction for a while (no zigzags)
        d = 1 if rng.random() < 0.5 + lean else -1
        for i in range(n):
            if not ok(x, y):
                return
            out.append((x, y))
            if rng.random() < 0.12:
                d = -d
            if rng.random() < 0.45:
                x += d
            y += 1
            if depth < 2 and i > 4 * k and rng.random() < 0.08:
                junc.append((x, y))
                walk(x - d, y, rng.randint(5 * k, 12 * k), -0.4 * d, depth + 1, out, junc)

    # chest seed first (tier I), then trunks: chest, shoulders, arms, abdomen, legs, head
    starts = [(32, 40, 18, 0.0), (22, 27, 20, 0.15), (42, 30, 26, -0.1), (13, 40, 24, -0.05), (52, 44, 22, 0.0),
              (36, 62, 30, 0.05), (25, 92, 28, -0.05), (40, 110, 22, 0.0), (33, 4, 12, 0.05)]
    nets = []
    for sx, sy, n, b in starts:
        out, junc = [], [(sx * k, sy * k)]
        walk(sx * k, sy * k, n * k, b, 0, out, junc)
        nets.append((out, junc))
    return nets


TIER_TRUNKS = {1: 0, 2: 2, 3: 5, 4: 7, 5: 9}


def statue_pixels(t, k=1):
    """Statue body plus tier cracks. k=1 full view; k=2 close-up (body upscaled, cracks 1 px at 2x)."""
    px, M, D = statue_body()
    if k == 2:
        big = {}
        for (x, y), c in px.items():
            for dy in (0, 1):
                for dx in (0, 1):
                    big[(2 * x + dx, 2 * y + dy)] = c
        px = big
        M = statue_mask(2)
        D = depth_map(M)
    nets = crack_network(M, D, k)
    gold, junc = set(), set()
    for out, j in nets[:TIER_TRUNKS[t]]:
        gold.update(out)
        junc.update(j)
    # tier I: a single gold seed at the chest
    cx, cy = 32 * k, 40 * k
    for dx in range(-k, k + 1):
        for dy in range(-k, k + 1):
            if abs(dx) + abs(dy) <= k:
                gold.add((cx + dx, cy + dy))
    junc.add((cx, cy))
    for g in gold:
        if g in px:
            px[g] = "GOLD"
    for j in junc:
        if j in px and px[j] == "GOLD":
            px[j] = "SUN"
    if t >= 4:  # flakes
        rng = random.Random(77)
        pts = sorted(gold)
        for _ in range(6 if t == 4 else 12):
            x, y = rng.choice(pts)
            for q in ((x + 1, y), (x + 1, y + 1), (x, y + 1)):
                if q in px and px[q] in ("STAT_1", "STAT_2"):
                    px[q] = "GOLD_DK"
    if t == 5:  # glowing eyes
        for x in (29, 30, 34, 35):
            for yy in range(k):
                for xx in range(k):
                    px[(x * k + xx, 8 * k + yy)] = "SUN"
    return px


GOLD_UNION = set()


def statue_fig(v):
    t = tier(v) if v != "base" else 3
    ox, oy = 271, 135
    px = statue_pixels(t)
    for (x, y), c in px.items():
        P(ox + x, oy + y, c)
    pedestal(t)


NUMERAL = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}
TIER_NAME = {1: "RAW", 2: "AWAKENED", 3: "FORGED", 4: "ASCENDANT", 5: "SOVEREIGN"}
PLAQUE = (277, 287, 329, 299)  # master rect of the plaque


def pedestal(t):
    mat = {1: ("BROWN_1", "SLATE_0", "INK"), 2: ("CHAR", "BROWN_1", "INK"), 3: ("SLATE_0", "SLATE_1", "INK"),
           4: ("OAK_DK", "OAK_0", "INK"), 5: ("GOLD_DK", "GOLD", "OAK_DK")}[t]
    BOX(272, 283, 334, 287, mat[0], hi=mat[1], sh=mat[2])
    BOX(274, 286, 332, 300, "CHAR", hi="BROWN_1", sh="INK")
    L(332, 287, 332, 299, "RIM")
    if t == 1:
        L(276, 292, 279, 296, "INK"); L(328, 290, 330, 293, "INK")
    if t == 5:
        L(275, 299, 331, 299, "GOLD")
    x0, y0, x1, y1 = PLAQUE
    BOX(x0, y0, x1, y1, "OAK_DK", ol="INK")
    L(x0 + 1, y0 + 1, x1 - 1, y0 + 1, "GOLD_DK")
    s = NUMERAL[t] + " " + TIER_NAME[t]
    tw = text_w(s)
    text((x0 + x1 + 1) // 2 - tw // 2, y0 + 2, s, "GOLD")


def closeup(v):
    """Panel close-up (never drawn in the room): statue at 2x with 1 px kintsugi branches."""
    t = tier(v) if v != "base" else 3
    ox, oy = 212 - 64, 80
    for (x, y), c in statue_pixels(t, k=2).items():
        P(ox + x, oy + y, c)
    # outline
    a = arr()
    op = a != T
    ring_ = np.zeros_like(op)
    ring_[1:, :] |= op[:-1, :]; ring_[:-1, :] |= op[1:, :]; ring_[:, 1:] |= op[:, :-1]; ring_[:, :-1] |= op[:, 1:]
    a[ring_ & ~op] = N["VOID"]
    put(a)
    BOX(ox - 6, oy + 300, ox + 134, oy + 316, "CHAR", hi="BROWN_1", sh="INK")
    s = NUMERAL[t] + " " + TIER_NAME[t]
    text(ox + 64 - text_w(s) // 2, oy + 306, s, "GOLD")


def downlight_fixture(v):
    BOX(299, 117, 307, 123, "BROWN_1", hi="SLATE_0")
    L(300, 123, 306, 123, "SLATE_0")


def sign(v):
    """Small FORGE plate left of the downlight (t1 paper card, base brass plate, t5 neon)."""
    t = tier(v)
    x0, y0 = 266, 126
    if t <= 2:
        R(x0 + 2, y0, x0 + 25, y0 + 8, "SLATE_2"); L(x0 + 2, y0 + 8, x0 + 25, y0 + 8, "SLATE_1")
        text(x0 + 4, y0 + 2, "FORGE", "INK")
        R(x0 + 13, y0 - 1, x0 + 14, y0, "CRT_0")
    elif t >= 5:
        BOX(x0, y0 - 1, x0 + 27, y0 + 9, "INK", ol="VOID")
        text(x0 + 4, y0 + 2, "FORGE", "SUN")
        L(x0 + 1, y0, x0 + 26, y0, "GLOW"); L(x0 + 1, y0 + 8, x0 + 26, y0 + 8, "GLOW")
    else:
        BOX(x0 + 1, y0, x0 + 26, y0 + 8, "GOLD_DK", ol="INK")
        text(x0 + 4, y0 + 2, "FORGE", "GOLD")


# ---------------------------------------------------------------- library (back wall left)
def bookshelf(v):
    st = stage(v)
    rng = random.Random(1)
    BOX(174, 158, 226, 300, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    R(178, 162, 222, 292, "INK")
    L(175, 159, 175, 299, "OAK_1")
    shelves = [162, 184, 206, 228, 250, 272, 292]
    for i in range(len(shelves) - 1):
        y0, y1 = shelves[i], shelves[i + 1]
        R(178, y1 - 1, 222, y1, "OAK_1"); L(178, y1, 222, y1, "OAK_DK")
        full = st >= 1 or i in (2, 4)
        kk = i % 3
        if not full:
            if i == 0:
                books(178, 186, y1 - 2, 15, rng, flat_ok=False)
            continue
        if kk == 0:
            books(178, 206, y1 - 2, 17, rng)
            plant(215, y1 - 2, 5, rng, pot="CREAM")
        elif kk == 1:
            circ(184, y1 - 8, 5, "SLATE_1"); R(181, y1 - 10, 184, y1 - 8, "LEAF_2"); R(183, y1 - 5, 184, y1 - 4, "LEAF_2")
            L(184, y1 - 3, 184, y1 - 2, "INK")
            books(192, 222, y1 - 2, 17, rng)
        else:
            books(178, 204, y1 - 2, 16, rng)
            BOX(206, y1 - 10, 221, y1 - 2, "OAK_2", hi="GLOW", sh="OAK_1")
            L(206, y1 - 6, 221, y1 - 6, "OAK_1")
        if st == 2 and i in (1, 4):
            R(219, y1 - 9, 221, y1 - 2, "GOLD"); L(219, y1 - 9, 221, y1 - 9, "SUN")  # gold bookends
    R(178, 293, 222, 299, "OAK_0"); L(186, 296, 190, 296, "GOLD_DK"); L(208, 296, 212, 296, "GOLD_DK")
    # clamp reading lamp on the side (the reading pool)
    L(225, 214, 229, 210, "INK")
    POLY([(226, 206), (234, 206), (232, 212), (228, 212)], "GLOW", "INK")
    L(228, 211, 232, 211, "SUN")


def bookcase_top(v):
    t = tier(v)
    rng = random.Random(41)
    if t <= 2:  # moving boxes, taped
        BOX(176, 144, 196, 158, "OAK_2", hi="GLOW", sh="OAK_1"); L(186, 144, 186, 158, "CREAM")
        BOX(198, 148, 214, 158, "OAK_1", hi="OAK_2", sh="OAK_0"); L(206, 148, 206, 158, "CREAM")
        return
    BOX(176, 146, 194, 158, "OAK_2", hi="GLOW", sh="OAK_1")
    BOX(179, 138, 191, 146, "CREAM", sh="OAK_2")
    BOX(196, 150, 208, 158, "SLATE_1", hi="SLATE_2", sh="SLATE_0")
    if t >= 4:  # record crate
        BOX(196, 142, 208, 150, "INK", hi="SLATE_0")
        for x in range(198, 207, 2):
            L(x, 140, x, 143, "CRT_0" if x % 4 else "SLATE_2")


def shelf_plant(v):
    rng = random.Random(42)
    vine(214, 158, 26, rng); vine(220, 158, 40, rng)
    plant(218, 158, 6, rng, pot="TERRA_1")


def lib_globe(v):
    circ(203, 140, 4, "SLATE_1"); R(200, 138, 203, 140, "LEAF_2"); R(203, 142, 205, 143, "LEAF_2")
    L(203, 145, 203, 147, "INK"); R(200, 148, 206, 149, "OAK_DK")


def potions(v):
    bcols = ["CRT_1", "GLOW", "LEAF_3", "SLATE_2", "PLUM_3", "GOLD", "SLATE_1", "ORANGE",
             "LEAF_2", "CREAM", "TERRA_2", "SUN", "CRT_0", "SLATE_2", "RIM"]
    for row, yb in enumerate((160, 174, 188)):
        R(229, yb + 1, 265, yb + 2, "OAK_1"); L(229, yb + 3, 265, yb + 3, "OAK_DK")
        for j in range(5):
            c = bcols[row * 5 + j]
            x = 231 + j * 7
            BOX(x, yb - 6, x + 4, yb, c)
            R(x + 1, yb - 5, x + 1, yb - 4, "CREAM" if c not in ("CREAM", "SUN") else "SLATE_2")
            R(x + 1, yb - 9, x + 3, yb - 7, "INK")


def archive(v):
    BOX(228, 194, 266, 300, "OAK_DK", hi="OAK_0", rim="r")
    R(231, 197, 263, 276, "SLATE_0")
    L(231, 197, 263, 197, "GLOW")
    for y in (218, 238, 258):
        L(231, y, 263, y, "SLATE_2"); L(231, y + 1, 263, y + 1, "CHAR")
    for x, yb, kind in ((236, 216, "cup"), (248, 216, "medal"), (257, 216, "book"),
                        (237, 236, "scroll"), (249, 236, "key"), (258, 236, "cup"),
                        (238, 256, "bar"), (252, 256, "medal")):
        if kind == "cup":
            R(x - 2, yb - 7, x + 2, yb - 4, "GOLD"); P(x - 3, yb - 6, "GOLD"); P(x + 3, yb - 6, "GOLD")
            L(x, yb - 3, x, yb - 1, "GOLD_DK"); L(x - 2, yb, x + 2, yb, "GOLD"); R(x - 1, yb - 7, x, yb - 6, "SUN")
        elif kind == "medal":
            L(x - 2, yb - 9, x, yb - 5, "CRT_0"); L(x + 2, yb - 9, x, yb - 5, "SLATE_2")
            circ(x, yb - 3, 2, "GOLD"); P(x - 1, yb - 4, "SUN")
        elif kind == "book":
            for i in range(3):
                R(x - 3 + i, yb - 2 - 2 * i, x + 2 - i, yb - 1 - 2 * i, "GOLD" if i % 2 else "GOLD_DK")
        elif kind == "scroll":
            R(x - 3, yb - 4, x + 3, yb - 2, "GOLD"); P(x - 4, yb - 3, "GOLD_DK"); P(x + 4, yb - 3, "GOLD_DK")
        elif kind == "key":
            ring(x - 2, yb - 4, 2, "GOLD"); L(x, yb - 4, x + 4, yb - 4, "GOLD"); P(x + 4, yb - 3, "GOLD")
        elif kind == "bar":
            POLY([(x - 4, yb), (x + 4, yb), (x + 3, yb - 3), (x - 3, yb - 3)], "GOLD", "GOLD_DK")
    L(234, 200, 240, 212, "SLATE_2"); L(235, 200, 241, 212, "SLATE_2")
    BOX(230, 278, 264, 299, "OAK_0", hi="OAK_1", sh="OAK_DK")
    L(247, 279, 247, 298, "OAK_DK"); P(244, 288, "GOLD"); P(250, 288, "GOLD")


def snakeplant(v):
    snake_plant(268, 300, 24, random.Random(43))


def lib_clock(v):
    circ(247, 137, 6, "INK"); circ(247, 137, 5, "CREAM"); L(247, 137, 247, 134, "INK"); L(247, 137, 249, 138, "INK")


def armchair(v):
    t = tier(v)
    dx = 6
    if t <= 2:  # beanbag
        ELL(180 + dx, 290, 216 + dx, 316, "SLATE_0", "INK"); ELL(184 + dx, 292, 210 + dx, 306, "SLATE_1")
        L(188 + dx, 296, 200 + dx, 294, "SLATE_2")
        return
    body, hi, sh = ("TERRA_1", "TERRA_2", "TERRA_0") if t == 3 else ("OAK_0", "OAK_1", "OAK_DK")
    BOX(180 + dx, 274, 214 + dx, 300, body, hi=hi, sh=sh)
    BOX(178 + dx, 288, 186 + dx, 312, body, hi=hi, sh=sh)
    BOX(208 + dx, 288, 216 + dx, 312, body, hi=hi, sh=sh, rim="r")
    BOX(185 + dx, 298, 209 + dx, 310, hi, hi=LIGHT.get(hi, hi), sh=body)
    if t >= 4:  # tufted leather buttons
        for x in (190, 197, 204):
            P(x + dx, 282, "OAK_DK"); P(x + 3 + dx, 288, "OAK_DK")
    else:
        POLY([(186 + dx, 276), (198 + dx, 276), (196 + dx, 300), (188 + dx, 304)], "LEAF_2", "INK")
        L(188 + dx, 278, 194 + dx, 278, "LEAF_3"); L(190 + dx, 284, 190 + dx, 300, "LEAF_1")
    R(180 + dx, 312, 182 + dx, 316, "INK"); R(212 + dx, 312, 214 + dx, 316, "INK")


def floorlamp(v):
    L(232, 240, 232, 314, "INK"); R(228, 314, 236, 316, "INK")
    POLY([(226, 238), (238, 238), (236, 228), (228, 228)], "GLOW", "INK")
    L(227, 237, 237, 237, "SUN"); L(229, 229, 235, 229, "CREAM")


def chess(v):
    st = stage(v)
    BOX(238, 302, 266, 306, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="r")
    for i in range(12):
        P(240 + i * 2, 301, "CREAM" if i % 2 else "INK"); P(241 + i * 2, 300, "INK" if i % 2 else "CREAM")
    pieces = ((242, "CREAM"), (246, "CREAM"), (256, "INK"), (261, "INK"), (251, "CREAM")) if st >= 1 else ((244, "CREAM"), (258, "INK"))
    for x, c in pieces:
        L(x, 297, x, 299, c); P(x, 296, c)
    if st == 2:  # chess clock + small trophy
        BOX(254, 294, 262, 299, "INK", hi="SLATE_0"); P(256, 296, "GLOW"); P(260, 296, "GLOW")
    L(252, 307, 252, 318, "OAK_DK"); R(247, 318, 257, 320, "INK")


def lib_stool(v):
    BOX(198, 314, 212, 318, "OAK_1", hi="OAK_2", sh="OAK_DK"); R(199, 319, 200, 323, "INK"); R(210, 319, 211, 323, "INK")


def books_floor(v):
    yy = 318
    for i, c in enumerate(["SLATE_1", "TERRA_2", "LEAF_2", "GOLD_DK", "CREAM", "CRT_0"]):
        R(238 + i % 2, yy - 2, 248 - (i % 3), yy - 1, c)
        L(238 + i % 2, yy - 2, 248 - (i % 3), yy - 2, LIGHT.get(c, c))
        yy -= 2


def lib_poster(v):
    t = tier(v)
    if t <= 2:
        R(234, 126, 260, 132, "SLATE_2"); R(240, 128, 246, 130, "SLATE_1")
        return
    frame(232, 125, 262, 133, "SLATE_1", fc="GOLD_DK" if t >= 5 else "OAK_1")
    R(240, 128, 254, 129, "TERRA_1")


def lib_pendant(v):
    pendant_lamp(198, 90, 142, v)


# ---------------------------------------------------------------- study (back wall right)
def study_shelf(v):
    rng = random.Random(4)
    R(512, 150, 626, 151, "OAK_1"); L(512, 152, 626, 152, "OAK_DK")
    books(514, 538, 149, 10, rng, flat_ok=False)
    plant(546, 149, 5, rng, pot="TERRA_1"); vine(548, 151, 22, rng)
    BOX(554, 143, 560, 149, "CREAM")
    BOX(580, 142, 588, 149, "SLATE_1", hi="SLATE_2")
    plant(598, 149, 4, rng, pot="SLATE_0")
    BOX(608, 140, 624, 149, "OAK_2", hi="GLOW", sh="OAK_1")


def study_speakers_shelf(v):
    speaker(564, 138, 576, 149)


def pennant(v):
    L(515, 156, 515, 176, "INK")
    POLY([(516, 157), (550, 165), (516, 173)], "LEAF_2", "INK")
    R(516, 158, 519, 172, "SLATE_2")
    for x in range(524, 536, 2):
        R(x, 164, x + 1, 165, "CREAM")


def photo(v):
    BOX(556, 156, 578, 178, "OAK_1", hi="OAK_2", sh="OAK_DK")
    R(558, 158, 576, 176, "SLATE_0"); R(559, 159, 560, 160, "SLATE_1")


def corkboard(v):
    st = stage(v)
    BOX(512, 184, 562, 224, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="l")
    R(514, 186, 560, 222, "OAK_2")
    R(517, 189, 535, 207, "CREAM")
    for y in range(192, 206, 3):
        L(519, y, 533, y, "SLATE_1")
    for x in range(522, 534, 4):
        L(x, 190, x, 206, "SLATE_0")
    notes = [(540, 190, "LEAF_3"), (549, 192, "PLUM_3"), (539, 204, "SLATE_2"), (551, 206, "GOLD"),
             (520, 211, "CRT_1"), (530, 212, "CREAM")]
    for x, y, c in notes[: (2 if st == 0 else 4 if st == 1 else 6)]:
        R(x, y, x + 6, y + 6, c); P(x + 3, y, "INK")
    if st == 2:
        POLY([(556, 212), (558, 216), (562, 216), (559, 219), (560, 222), (556, 220), (552, 222), (553, 219), (550, 216), (554, 216)], "GOLD", "GOLD_DK")
    if v == "alert":  # a due note pinned on top
        BOX(538, 196, 552, 210, "CRT_1", ol="TERRA_0"); R(541, 200, 549, 200, "CREAM"); R(541, 204, 547, 204, "CREAM")


def calendar(v):
    st = stage(v)
    BOX(566, 184, 592, 216, "CREAM", ol="INK")
    R(567, 185, 591, 189, "CRT_0")
    for y in range(192, 215, 4):
        L(568, y, 590, y, "OAK_2")
    for x in range(571, 590, 4):
        L(x, 191, x, 214, "OAK_2")
    cells = [(569, 193), (573, 193), (577, 197), (581, 197), (585, 201), (569, 201), (573, 205), (577, 209), (581, 209)]
    for x, y in cells[: (2 if st == 0 else 5 if st == 1 else 9)]:
        R(x, y, x + 1, y + 1, "LEAF_2")


def study_clock(v):
    circ(606, 198, 7, "INK"); circ(606, 198, 6, "CREAM"); L(606, 198, 606, 194, "INK"); L(606, 198, 609, 199, "INK")
    for x, y, c in ((596, 210, "GOLD"), (603, 214, "LEAF_3"), (612, 208, "PLUM_3")):
        R(x, y, x + 4, y + 4, c)


def study_desk(v):
    t = tier(v)
    if t <= 2:  # folding table
        R(508, 264, 628, 266, "SLATE_1"); L(508, 263, 628, 263, "SLATE_2")
        L(512, 267, 520, 300, "INK"); L(520, 267, 512, 300, "INK")
        L(616, 267, 624, 300, "INK"); L(624, 267, 616, 300, "INK")
        return
    R(508, 264, 628, 266, "OAK_1"); L(508, 263, 628, 263, "OAK_2"); L(508, 263, 508, 266, "RIM")
    R(508, 267, 628, 269, "OAK_0"); L(508, 270, 628, 270, "INK")
    R(511, 270, 513, 300, "OAK_DK")
    BOX(598, 270, 626, 300, "OAK_0", hi="OAK_1", sh="OAK_DK")
    for y in (279, 289):
        L(599, y, 625, y, "OAK_DK"); L(610, y - 4, 614, y - 4, "GOLD" if t >= 5 else "GOLD_DK")
    L(610, 294, 614, 294, "GOLD" if t >= 5 else "GOLD_DK")
    if t >= 5:
        L(509, 271, 597, 271, "GLOW")


def desk_lamp(v):
    t = tier(v)
    lit = v == "night"
    if t <= 1:  # clamp lamp, bare bulb
        L(520, 262, 524, 248, "INK"); R(523, 245, 525, 247, "SUN" if lit else "CREAM")
        return
    R(516, 260, 524, 262, "INK"); L(520, 260, 526, 246, "INK"); L(526, 246, 536, 250, "INK")
    sh = "GOLD_DK" if t >= 5 else "TERRA_1"
    POLY([(532, 247), (540, 250), (538, 255), (531, 252)], sh, "INK")
    if lit:
        L(532, 254, 538, 256, "SUN"); P(536, 257, "GLOW")


def courses(v):
    yy = 262
    for i, (c, dot, wd) in enumerate((("LEAF_2", "LEAF_3", 22), ("SLATE_1", "GOLD", 20),
                                       ("TERRA_2", "LEAF_3", 21), ("GOLD_DK", "CRT_1", 19), ("PLUM_3", "LEAF_3", 18))):
        x0 = 578 + (i % 2)
        BOX(x0, yy - 3, x0 + wd, yy, c, hi=LIGHT.get(c), ol="INK")
        R(x0 + wd - 3, yy - 2, x0 + wd - 2, yy - 1, dot)
        if i == 3:
            R(x0 + wd + 1, yy - 2, x0 + wd + 2, yy + 1, "CRT_1")
        yy -= 3


def journal(v):
    R(542, 259, 560, 262, "CREAM"); L(551, 259, 551, 262, "OAK_2"); L(544, 260, 549, 260, "SLATE_1"); L(553, 260, 558, 260, "SLATE_1")


def study_mug(v):
    BOX(562, 255, 567, 262, "SLATE_1"); R(563, 252, 563, 254, "GOLD"); R(565, 251, 565, 254, "CRT_0")
    BOX(569, 257, 574, 262, "CREAM"); L(575, 259, 575, 260, "CREAM")


def headphones(v):
    sag(528, 262, 538, 262, -6, "INK"); R(527, 259, 529, 262, "SLATE_0"); R(537, 259, 539, 262, "SLATE_0")


def backpack(v):
    BOX(514, 282, 534, 306, "SLATE_1", hi="SLATE_2", sh="SLATE_0", rim="l")
    BOX(517, 292, 531, 304, "SLATE_0", hi="SLATE_1"); L(518, 292, 530, 292, "TERRA_2")
    sag(518, 283, 530, 283, -6, "INK")
    if v == "alert":
        R(526, 279, 532, 287, "CREAM"); L(527, 281, 531, 281, "CRT_0")


def study_chair(v):
    t = tier(v)
    if t <= 2:  # stool
        BOX(552, 284, 580, 290, "OAK_1", hi="OAK_2", sh="OAK_DK")
        L(556, 291, 554, 305, "INK"); L(576, 291, 578, 305, "INK")
        return
    body, hi = ("BROWN_1", "SLATE_0") if t < 5 else ("OAK_DK", "OAK_0")
    BOX(550, 252, 580, 284, body, hi=hi, sh="INK", rim="l")
    POLY([(550, 254), (562, 254), (560, 290), (552, 292)], "LEAF_1", "INK")
    L(552, 256, 558, 256, "LEAF_2"); L(553, 262, 553, 288, "LEAF_0")
    BOX(548, 284, 584, 290, body, hi=hi)
    L(566, 291, 566, 302, "INK"); L(552, 304, 580, 304, "INK"); P(552, 305, "SLATE_0"); P(580, 305, "SLATE_0")


def study_bin(v):
    BOX(588, 292, 598, 306, "SLATE_0", hi="SLATE_1"); R(590, 290, 591, 291, "CREAM"); P(593, 290, "CREAM")


def study_plant(v):
    plant(616, 306, 9, random.Random(44), pot="TERRA_1", tall=1.8)


def study_pendant(v):
    pendant_lamp(566, 90, 140, v, shade="CRT_0")


def back_stringlights_l(v):
    string_lights(172, 127, 400, 129, 6, step=10, seed=0)


def back_stringlights_r(v):
    string_lights(440, 129, 628, 127, 6, step=10, seed=3)


# ---------------------------------------------------------------- left sliver: door, kitchen, bed
def fridge(v):
    """kitchen.microwave: fridge in the bleed with the microwave on top."""
    POLY(wq("L", 10, 58, 0, 0.56), "SLATE_2", "INK")
    POLY(wq("L", 12, 56, 0.30, 0.31), "INK")
    L(52, lw(52, 0.38), 52, lw(52, 0.5), "INK")
    POLY(wq("L", 14, 52, 0.57, 0.66), "INK")
    POLY(wq("L", 16, 40, 0.585, 0.645), "SLATE_0")
    R(46, lw(46, 0.62), 48, lw(46, 0.62) + 1, "LEAF_3")


def wall_shelf_left(v):
    """kitchen.table: open shelf in the bleed (t1 bare plank, t3 jars, t5 jars + plant)."""
    t = tier(v)
    rng = random.Random(5)
    POLY(wq("L", 0, 64, 0.72, 0.74), "OAK_1", "INK")
    n = 3 if t <= 2 else 8
    for i, x in enumerate(range(4, 60, 7)):
        if i >= n:
            break
        y = lw(x, 0.74)
        BOX(x, y - 8, x + 4, y, rng.choice(["CREAM", "GOLD", "TERRA_2", "SLATE_1"]))
    if t >= 5:
        plant(58, lw(58, 0.74), 4, rng, pot="TERRA_1")


DOOR_X0, DOOR_X1 = 94, 120


def door(v):
    st = stage(v)
    POLY(wq("L", DOOR_X0, DOOR_X1, 0, 0.6), "OAK_DK", "INK")
    POLY(wq("L", DOOR_X0 + 3, DOOR_X1 - 3, 0.0, 0.57), "OAK_0", "INK")
    POLY(wq("L", DOOR_X0 + 6, DOOR_X1 - 6, 0.06, 0.3), "OAK_DK")
    POLY(wq("L", DOOR_X0 + 7, DOOR_X1 - 7, 0.07, 0.29), "OAK_0")
    POLY(wq("L", DOOR_X0 + 5, DOOR_X1 - 5, 0.36, 0.52), "OAK_2", "INK")
    flyers = [(DOOR_X0 + 7, 0.5, "CREAM"), (DOOR_X0 + 13, 0.49, "LEAF_3"), (DOOR_X0 + 7, 0.43, "SLATE_2"),
              (DOOR_X0 + 14, 0.42, "GLOW"), (DOOR_X0 + 9, 0.39, "PLUM_3")]
    for x, f, c in flyers[: (2 if st == 0 else 4 if st == 1 else 5)]:
        y = lw(x, f)
        R(x, y, x + 4, y + 6, c); P(x + 2, y, "CRT_0")
    circ(DOOR_X1 - 4, lw(DOOR_X1 - 4, 0.28), 1, "GOLD")
    L(DOOR_X1 - 3, lw(DOOR_X1 - 3, 0.57), DOOR_X1 - 3, lw(DOOR_X1 - 3, 0.0), "RIM")


def door_lamp(v):
    """kitchen.pendant: the door lamp (wall sconce above the door) that gives the door its own pool."""
    t = tier(v)
    x = (DOOR_X0 + DOOR_X1) // 2
    y = lw(x, 0.64)
    L(x, y - 6, x, y - 2, "INK")
    if t <= 2:
        R(x - 1, y - 2, x + 1, y, "SUN")
        return
    POLY([(x - 4, y - 2), (x + 4, y - 3), (x + 3, y + 1), (x - 3, y + 2)], "GOLD_DK" if t >= 5 else "SLATE_0", "INK")
    R(x - 2, y + 1, x + 1, y + 2, "SUN" if v == "night" else "GLOW")


def doormat(v):
    POLY([(96, 336), (122, 328), (132, 334), (106, 343)], "TERRA_0", "INK")
    L(100, 336, 122, 330, "TERRA_1")
    if v == "alert":
        R(108, 332, 114, 336, "CREAM"); L(108, 332, 111, 334, "OAK_2"); L(114, 332, 111, 334, "OAK_2")


def door_shoes(v):
    t = tier(v)
    pairs = [(84, 340), (90, 343)] if t >= 3 else [(86, 342)]
    for x, y in pairs:
        R(x, y, x + 5, y + 2, "SLATE_1" if t >= 3 else "OAK_0"); R(x, y - 1, x + 2, y - 1, "INK"); L(x, y + 2, x + 5, y + 2, "INK")


def hooks(v):
    x = 84
    L(x, lw(x, 0.56), x + 8, lw(x + 8, 0.56), "OAK_1")
    POLY([(x + 1, lw(x + 1, 0.55)), (x + 6, lw(x + 6, 0.55)), (x + 7, lw(x + 7, 0.36)), (x, lw(x, 0.38))], "SLATE_0", "INK")
    L(x + 3, lw(x + 3, 0.53), x + 3, lw(x + 3, 0.40), "SLATE_1")


def kitchen_clock(v):
    x = 107
    y = lw(x, 0.76)
    circ(x, y, 5, "INK"); circ(x, y, 4, "CREAM"); L(x, y, x, y - 3, "INK"); L(x, y, x + 2, y + 1, "INK")


def settings_box(v):
    POLY(wq("L", 123, 130, 0.30, 0.37), "CREAM", "INK")
    for i, c in enumerate(("LEAF_3", "CRT_1")):
        R(125 + i * 3, lw(125 + i * 3, 0.345), 125 + i * 3, lw(125 + i * 3, 0.345) + 1, c)


def light_switch(v):
    POLY(wq("L", 124, 128, 0.42, 0.46), "CREAM", "INK")
    R(126, lw(126, 0.445), 126, lw(126, 0.445) + 1, "INK")


COUNTER_X0, COUNTER_X1 = 132, 160


def counter(v):
    t = tier(v)
    x0, x1 = COUNTER_X0, COUNTER_X1
    mid = (x0 + x1) // 2
    if t >= 2:
        POLY(wq("L", x0, x1, 0.62, 0.80), "OAK_0" if t < 5 else "OAK_DK", "INK")
        L(mid, lw(mid, 0.62), mid, lw(mid, 0.80), "OAK_DK")
        P(mid - 3, lw(mid - 3, 0.66), "GOLD"); P(mid + 3, lw(mid + 3, 0.66), "GOLD")
        L(x0 + 1, lw(x0 + 1, 0.615), x1 - 1, lw(x1 - 1, 0.615), "GLOW")  # under-cabinet light
    POLY(wq("L", x0, x1, 0.0, 0.23), "OAK_1" if t >= 3 else "SLATE_0", "INK")
    L(mid, lw(mid, 0.0), mid, lw(mid, 0.23), "OAK_DK")
    POLY(wq("L", x0 - 2, x1 + 2, 0.23, 0.26), "SLATE_0" if t < 5 else "SLATE_1", "INK")
    L(x0 - 2, lw(x0 - 2, 0.26), x1 + 2, lw(x1 + 2, 0.26), "SLATE_1" if t < 5 else "CREAM")


def spices(v):
    for x, c in ((135, "CREAM"), (139, "GOLD"), (143, "TERRA_2")):
        y = lw(x, 0.81)
        BOX(x, y - 5, x + 3, y, c)


def food(v):
    st = stage(v)
    y = lw(136, 0.26)
    ELL(132, y - 6, 143, y, "OAK_2", "INK")
    fruit = [(134, "CRT_1"), (137, "ORANGE"), (139, "LEAF_3"), (141, "GOLD")]
    for x, c in fruit[: (1 if st == 0 else 3 if st == 1 else 4)]:
        R(x, y - 8, x + 1, y - 7, c)
    if st == 2:
        R(137, y - 10, 139, y - 9, "LEAF_2")


def water(v):
    g = int(v[1]) if v.startswith("g") else 2
    x = 145
    y = lw(x, 0.26)
    BOX(x, y - 12, x + 6, y, "SLATE_2", ol="INK")
    if g > 0:
        R(x + 1, y - 1 - g * 3, x + 5, y - 1, "SLATE_1")
    R(x + 2, y - 14, x + 5, y - 12, "INK")


def cutting_board(v):
    POLY(wq("L", 150, 157, 0.29, 0.40), "OAK_2", "INK")
    L(153, lw(153, 0.41), 153, lw(153, 0.43), "INK")


def kettle(v):
    x = 156
    y = lw(x, 0.26)
    BOX(x - 2, y - 7, x + 4, y, "INK", hi="SLATE_0"); L(x + 4, y - 5, x + 6, y - 6, "INK")


def gut(v):
    """Gut health: big leafy floor plant by the counter (s0 small, s2 lush with a bloom)."""
    st = stage(v)
    cx, yb = 122, 336
    n = 8 if st == 0 else 13 if st == 1 else 15
    rr = 12 if st == 0 else 16 if st == 1 else 19
    for i in range(n):
        a = math.pi * (1.1 + 0.8 * i / max(1, n - 1))
        x, y = cx + math.cos(a) * rr, yb - 18 + math.sin(a) * rr * 1.35
        POLY([(cx, yb - 16), (x - 3, y), (x + 3, y - 2)], "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0")
        R(x, y - 1, x + 1, y - 1, "LEAF_3")
    if st == 2:
        R(cx - 1, yb - 30, cx + 1, yb - 28, "PLUM_3")
    BOX(cx - 7, yb - 16, cx + 7, yb, "TERRA_1", hi="TERRA_2", sh="TERRA_0")


def nightstand(v):
    """bed.nightstand: crate nightstand at the head of the bed."""
    BOX(132, 292, 142, 306, "OAK_1", hi="OAK_2", sh="OAK_DK")
    L(133, 299, 141, 299, "OAK_DK")
    BOX(134, 288, 140, 292, "SLATE_1", hi="SLATE_2")


def kitchen_stool(v):
    BOX(126, 316, 138, 319, "OAK_1", hi="OAK_2", sh="OAK_DK")
    L(127, 320, 126, 330, "INK"); L(137, 320, 138, 330, "INK"); L(127, 325, 137, 325, "OAK_DK")


def bed_frame(v):
    t = tier(v)
    if t <= 1:  # pallets
        BOX(140, 306, 186, 312, "OAK_1", hi="OAK_2", sh="OAK_DK")
        for x in (148, 160, 172):
            L(x, 307, x, 311, "OAK_DK")
        return
    BOX(146, 266, 180, 286, "OAK_DK", hi="OAK_0" if t < 5 else "GOLD")
    BOX(138, 304, 186, 316, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    R(140, 316, 142, 320, "INK"); R(182, 316, 184, 320, "INK")
    if t >= 5:
        L(139, 305, 185, 305, "GOLD")


def bed_bed(v):
    st = stage(v)
    BOX(150, 278, 162, 286, "CREAM", sh="OAK_2"); BOX(162, 279, 174, 287, "CREAM", sh="OAK_2")
    POLY([(144, 286), (180, 286), (184, 306), (140, 306)], "SLATE_1", "INK")
    L(146, 288, 178, 288, "SLATE_2"); L(154, 292, 168, 300, "SLATE_0"); L(160, 290, 174, 296, "SLATE_0")
    if st >= 1:
        POLY([(142, 296), (156, 294), (160, 306), (144, 306)], "TERRA_2", "INK")
    if st == 2:
        L(146, 300, 176, 300, "GOLD_DK")


def nightshelf(v):
    """bed.shelf: small wall shelf above the bed head (right of the kitchen)."""
    POLY(wq("L", 150, 170, 0.36, 0.38), "OAK_1", "INK")


def bed_globe(v):
    st = stage(v)
    y = lw(156, 0.38)
    R(153, y - 2, 159, y, "INK"); circ(156, y - 7, 4, "VOID"); ring(156, y - 7, 4, "SLATE_1")
    arms = (((153, -10), "PLUM_3"), ((159, -9), "PLUM_3"), ((158, -4), "CREAM"))
    for (x, dy), c in arms[: (1 if st == 0 else 2 if st == 1 else 3)]:
        L(156, y - 7, x, y + dy, c)
    R(155, y - 8, 156, y - 7, "CREAM")


def sconce(v):
    """bed.sconce: paper-star jar lamp on the shelf (brighter at night)."""
    y = lw(165, 0.38)
    BOX(162, y - 7, 168, y, "SLATE_2", ol="INK")
    for p in ((163, -5, "GOLD"), (165, -3, "SUN" if v == "night" else "GOLD"), (165, -6, "GLOW")):
        R(p[0], y + p[1], p[0] + 1, y + p[1], p[2])


def charger(v):
    y = lw(152, 0.38)
    R(150, y - 3, 152, y - 1, "INK"); P(151, y - 2, "LEAF_3")


def bed_poster(v):
    """Small framed photo above the bed (the loud poster that competed with the door was cut)."""
    t = tier(v)
    if t <= 2:
        POLY(wq("L", 154, 164, 0.50, 0.58), "SLATE_2")
        return
    POLY(wq("L", 152, 166, 0.48, 0.60), "GOLD_DK" if t >= 5 else "OAK_1", "INK")
    POLY(wq("L", 154, 164, 0.50, 0.58), "SLATE_0")
    POLY(wq("L", 156, 162, 0.51, 0.54), "TERRA_1")


def bed_strings(v):
    t = tier(v)
    if t <= 1:
        string_lights(146, lw(146, 0.72), 168, lw(168, 0.71), 2, step=10, seed=2, n_max=2)
        return
    string_lights(132, lw(132, 0.84), 170, lw(170, 0.72), 6, step=8 if t < 5 else 6, seed=2)


def hamper(v):
    t = tier(v)
    if t <= 2:  # laundry pile
        ELL(186, 318, 200, 326, "SLATE_1", "INK"); R(190, 318, 195, 320, "TERRA_1")
        return
    BOX(188, 312, 200, 326, "OAK_2" if t < 5 else "OAK_1", hi="GLOW" if t < 5 else "OAK_2", sh="OAK_1")
    for y in (316, 320):
        L(189, y, 199, y, "OAK_1")


def cushion(v):
    st = stage(v)
    ELL(148, 322, 170, 332, "SLATE_0", "INK"); ELL(150, 322, 168, 328, "SLATE_1"); R(158, 324, 159, 325, "SLATE_2")
    if st >= 1:
        R(152, 318, 158, 321, "PLUM_3")  # folded shawl
    if st == 2:
        R(164, 318, 166, 321, "CREAM"); R(165, 316, 165, 317, "GLOW")  # candle


def slippers(v):
    R(172, 330, 176, 332, "OAK_2"); R(174, 333, 178, 335, "OAK_2"); L(172, 332, 176, 332, "OAK_1"); L(174, 335, 178, 335, "OAK_1")


def runner(v):
    t = tier(v)
    if t >= 3:
        POLY([(140, 320), (178, 320), (182, 334), (136, 334)], "SLATE_0", "INK")
        L(140, 322, 178, 322, "SLATE_1")
    else:
        POLY([(146, 322), (172, 322), (174, 330), (144, 330)], "OAK_DK", "INK")


def kitchen_relic(v):
    x0, x1 = 123, 133
    POLY(wq("L", x0, x1, 0.50, 0.58), "OAK_1", "INK")
    cy = int(lw(128, 0.54))
    if v == "base":
        L(126, cy, 130, cy, "SLATE_1"); L(128, cy - 2, 128, cy + 2, "SLATE_1")
        return
    body, edge = {"active": ("BROWN_1", "INK"), "hot": ("ORANGE", "TERRA_0"), "gold": ("GOLD", "GOLD_DK")}[v]
    circ(128, cy, 3, edge); circ(128, cy, 2, body)
    P(127, cy - 1, "SUN" if v != "active" else "SLATE_0")
    if v == "hot":
        P(129, cy - 5, "GLOW")


# ---------------------------------------------------------------- right sliver: computer, gym
def whiteboard(v):
    st = stage(v)
    POLY(wq("R", 636, 662, 0.48, 0.66), "CREAM", "INK")
    POLY(wq("R", 636, 662, 0.48, 0.495), "SLATE_0")
    lines = ((639, 650, 0.62, "CRT_0"), (652, 660, 0.6, "SLATE_1"), (640, 648, 0.55, "LEAF_2"), (650, 660, 0.53, "SLATE_1"))
    for x0, x1, f, c in lines[: (2 if st == 0 else 3 if st == 1 else 4)]:
        L(x0, rw(x0, f), x1, rw(x1, f), c)
    text(641, int(rw(641, 0.6)), "$", "LEAF_2")
    if st == 2:
        R(655, rw(655, 0.64), 659, rw(655, 0.64) + 3, "GOLD")


def comp_shelf(v):
    POLY(wq("R", 634, 660, 0.72, 0.74), "OAK_1", "INK")
    y = rw(640, 0.74)
    BOX(638, y - 7, 646, y, "SLATE_1"); BOX(650, rw(650, 0.74) - 5, 656, rw(650, 0.74), "CREAM")


def comp_desk(v):
    t = tier(v)
    x0, x1 = 628, 664
    if t <= 2:
        POLY(wq("R", x0, x1, 0.2, 0.215), "SLATE_1", "INK")
        L(632, rw(632, 0.2), 636, rw(636, 0), "INK"); L(660, rw(660, 0.2), 656, rw(656, 0), "INK")
        return
    POLY(wq("R", x0, x1, 0.2, 0.225), "OAK_1" if t < 5 else "OAK_DK", "INK")
    L(x0, rw(x0, 0.225), x1, rw(x1, 0.225), "OAK_2" if t < 5 else "GOLD")
    L(632, rw(632, 0.2), 632, rw(632, 0), "OAK_DK"); L(660, rw(660, 0.2), 660, rw(660, 0), "OAK_DK")


def comp_ai(v):
    st = stage(v)
    BOX(632, 238, 646, 256, "INK", rim="l"); R(634, 240, 644, 252, "SLATE_1")
    for i, y in enumerate(range(242, 251, 2)):
        L(636 + (i % 3), y, 638 + (i * 5) % 6, y, "SLATE_2")
    L(639, 257, 639, 264, "INK")
    BOX(646, 232, 664, 258, "INK"); R(648, 234, 662, 254, "SLATE_1")
    bars = (6, 10, 8, 14) if st >= 1 else (4, 6)
    for i, hgt in enumerate(bars):
        R(650 + i * 3, 252 - hgt, 651 + i * 3, 252, "LEAF_3")
    L(655, 259, 655, 264, "INK"); R(651, 264, 659, 265, "INK")
    if st == 2:  # third monitor, portrait
        BOX(664, 234, 672, 256, "INK"); R(666, 236, 670, 254, "SLATE_1"); L(667, 240, 669, 240, "SLATE_2")
    # tower under the desk
    BOX(634, 282, 648, 312, "INK", hi="SLATE_0")
    for y, c in ((286, "SLATE_2"), (290, "CRT_1"), (294, "LEAF_3")):
        L(637, y, 645, y, c)


def keyboard(v):
    """computer.speakers: keyboard and mouse on the desk."""
    R(634, 266, 652, 268, "INK"); L(635, 266, 651, 266, "SLATE_0"); R(655, 266, 657, 268, "SLATE_0")


def comp_mug(v):
    BOX(658, 260, 663, 267, "CRT_0"); R(659, 261, 660, 262, "CREAM")


def comp_focus(v):
    R(633, 233, 637, 236, "GOLD"); L(633, 237, 637, 237, "GOLD_DK")


def comp_headset(v):
    sag(645, 236, 649, 236, -4, "INK"); R(644, 236, 645, 239, "SLATE_0")


def comp_led(v):
    L(629, rw(629, 0.196), 663, rw(663, 0.196), "SLATE_2")


def comp_can(v):
    R(629, 260, 631, 264, "CRT_1"); L(629, 260, 631, 260, "SLATE_2")


def money(v):
    g = int(v[1]) if v.startswith("g") else 2
    rng = random.Random(6)
    BOX(666, 300, 674, 310, "CREAM", sh="OAK_2")
    L(670, 300, 670, 290 - g * 3, "OAK_2"); L(669, 296, 671, 292, "OAK_1")
    for i, (x, y) in enumerate(((666, 290), (670, 286), (674, 290), (668, 293), (673, 294), (667, 284), (673, 283), (670, 280))):
        if i < 2 + g * 2:
            leaf(x, y - g * 3 + 3, rng)


def comp_chair(v):
    t = tier(v)
    if t <= 2:
        BOX(650, 300, 664, 304, "OAK_1", hi="OAK_2"); L(652, 305, 652, 316, "INK"); L(662, 305, 662, 316, "INK")
        return
    body = "BROWN_1" if t < 5 else "OAK_DK"
    BOX(652, 280, 664, 302, body, hi="SLATE_0" if t < 5 else "OAK_0", sh="INK")
    BOX(648, 302, 666, 307, body, hi="SLATE_0")
    L(657, 308, 657, 316, "INK"); L(650, 317, 664, 317, "INK")


def comp_cables(v):
    t = tier(v)
    if t <= 2:
        cable([(648, 312), (630, 318), (612, 314)], "INK"); cable([(640, 312), (626, 322), (606, 318)], "SLATE_0")
    else:
        cable([(648, 312), (600, 326), (540, 318), (506, 302)], "INK")


def comp_boxes(v):
    BOX(612, 312, 628, 324, "OAK_2", hi="GLOW", sh="OAK_1"); L(620, 312, 620, 324, "CREAM")
    BOX(614, 304, 626, 312, "OAK_1", hi="OAK_2", sh="OAK_0")


def router(v):
    """computer.router: router on the shelf above the desk."""
    y = rw(658, 0.74)
    R(656, y - 3, 660, y - 1, "INK"); P(657, y - 2, "LEAF_3"); L(659, y - 5, 659, y - 3, "INK")


GYM_DX = -20


def rack(v):
    st = stage(v)
    d = GYM_DX
    for x in (684 + d, 712 + d):
        R(x, 214, x + 2, 334, "INK"); L(x + 1, 214, x + 1, 334, "SLATE_0")
    R(684 + d, 214, 714 + d, 216, "INK")
    R(678 + d, 252, 720 + d, 253, "SLATE_2")
    plates = ((678, "CRT_0"), (681, "INK"), (716, "CRT_0")) if st >= 1 else ((681, "INK"),)
    if st == 2:
        plates += ((675, "GOLD_DK"), (719, "INK"))
    for x, c in plates:
        BOX(x + d, 240, x + 3 + d, 266, c, hi=LIGHT.get(c, "SLATE_0"))
    for i, (y, c) in enumerate(((306, "CRT_0"), (311, "SLATE_1"), (316, "LEAF_2"), (321, "INK"))):
        if st >= 1 or i >= 2:
            BOX(692 + d, y, 708 + d, y + 4, c, hi=LIGHT.get(c, "SLATE_0"))


def bike(v):
    """Triathlon: bike under a half-draped tarp (dormant); awake = tarp off, bars up."""
    st = stage(v)
    d = -12
    for wx in (686 + d, 716 + d):
        circ(wx, 326, 11, "INK"); circ(wx, 326, 9, "CHAR"); ring(wx, 326, 9, "SLATE_0")
        L(wx - 8, 326, wx + 8, 326, "SLATE_1"); L(wx, 318, wx, 334, "SLATE_1")
        R(wx - 1, 325, wx + 1, 327, "SLATE_2")
    frame_c = "CRT_0" if st >= 1 else "SLATE_0"
    L(686 + d, 326, 700 + d, 312, frame_c); L(700 + d, 312, 716 + d, 326, frame_c); L(686 + d, 326, 702 + d, 326, frame_c)
    L(700 + d, 312, 698 + d, 306, "INK"); R(695 + d, 305, 700 + d, 306, "INK")
    L(714 + d, 314, 716 + d, 308, "INK"); R(713 + d, 307, 718 + d, 308, "INK")
    if v != "awake":
        POLY([(692 + d, 296), (722 + d, 292), (728 + d, 318), (714 + d, 314), (706 + d, 320), (698 + d, 312), (688 + d, 316)], "SLATE_1", "INK")
        L(696 + d, 298, 706 + d, 312, "SLATE_0"); L(710 + d, 296, 716 + d, 312, "SLATE_0"); L(694 + d, 297, 720 + d, 294, "SLATE_2")
    elif st == 2:
        R(706 + d, 318, 709 + d, 321, "GOLD")


def gym_relic(v):
    x0, x1 = 668, 680
    POLY(wq("R", x0, x1, 0.5, 0.56), "INK")
    POLY(wq("R", x0 + 1, x1 - 1, 0.505, 0.555), "BROWN_1")
    cy = int(rw(674, 0.53))
    if v == "base":
        L(672, cy, 676, cy, "SLATE_1"); L(674, cy - 2, 674, cy + 2, "SLATE_1")
        return
    body, edge = {"active": ("BROWN_1", "INK"), "hot": ("ORANGE", "TERRA_0"), "gold": ("GOLD", "GOLD_DK")}[v]
    circ(674, cy, 3, edge); circ(674, cy, 2, body)
    P(673, cy - 1, "SUN" if v != "active" else "SLATE_0")


def medals(v):
    g = int(v[1]) if v.startswith("g") else 2
    POLY(wq("R", 684, 712, 0.68, 0.70), "OAK_1", "INK")
    cols = ["GOLD", "SLATE_2", "OAK_2", "GOLD", "GOLD"]
    for i, x in enumerate(range(686, 712, 6)):
        if i >= 1 + g:
            break
        y = rw(x, 0.68)
        L(x, y, x + 2, y + 8, ["CRT_0", "SLATE_2", "LEAF_2", "GOLD"][i % 4])
        circ(x + 2, y + 10, 2, cols[i]); P(x + 1, y + 9, "SUN")


def bib(v):
    """gym.trophies: race bib (t1), plus a finisher photo (t3), in a gold frame (t5)."""
    t = tier(v)
    POLY(wq("R", 676, 690, 0.40, 0.46), "CREAM", "INK")
    text(678, int(rw(678, 0.455)), "42", "INK")
    if t >= 3:
        POLY(wq("R", 692, 704, 0.40, 0.47), "GOLD_DK" if t >= 5 else "OAK_1", "INK")
        POLY(wq("R", 694, 702, 0.415, 0.455), "SLATE_1")


def mileage(v):
    """gym.timer: mileage chart poster high on the wall."""
    POLY(wq("R", 700, 718, 0.74, 0.92), "CREAM", "INK")
    for i in range(5):
        x = 702 + i * 3
        R(x, rw(x, 0.78 + 0.025 * i), x + 1, rw(x, 0.78 + 0.025 * i) + 1, "CRT_0")


def gym_tiles(v):
    t = tier(v)
    d = GYM_DX
    if t <= 2:
        POLY([(676 + d, 330), (720 + d, 330), (726 + d, 340), (672 + d, 340)], "BROWN_1", "INK")
        return
    POLY([(670 + d, 328), (722 + d, 328), (730 + d, 342), (664 + d, 342)], "INK", "VOID")
    for x in range(676 + d, 724 + d, 12):
        L(x, 329, x - 3, 341, "BROWN_1")
    L(668 + d, 335, 726 + d, 335, "BROWN_1")
    if t >= 5:
        L(671 + d, 328, 721 + d, 328, "GOLD_DK")


def shoes(v):
    """Running: shoes by the rack (s0 one pair, s2 + race shirt)."""
    st = stage(v)
    BOX(646, 336, 656, 341, "CRT_1", hi="CREAM", sh="CREAM")
    if st >= 1:
        BOX(656, 338, 666, 343, "CRT_1", hi="CREAM", sh="CREAM")
    if st == 2:
        POLY([(630, 340), (644, 338), (646, 346), (632, 348)], "SLATE_2", "INK")


def roller(v):
    BOX(612, 340, 630, 346, "SLATE_1", hi="SLATE_2", sh="SLATE_0"); circ(612, 343, 2, "SLATE_0")


def bottle(v):
    BOX(640, 322, 645, 334, "SLATE_2", ol="INK"); R(641, 320, 644, 322, "CRT_0")


def kettlebell(v):
    circ(700, 344, 4, "INK"); circ(700, 344, 3, "BROWN_1"); ring(700, 338, 2, "INK"); P(699, 343, "SLATE_0")


def gym_bag(v):
    BOX(704, 336, 722, 346, "SLATE_0", hi="SLATE_1", sh="INK"); sag(708, 336, 718, 336, -4, "INK")


def rope(v):
    d = GYM_DX
    sag(686 + d, 220, 686 + d, 250, 3, "TERRA_1"); R(685 + d, 250, 687 + d, 254, "INK")


def yoga_mat(v):
    BOX(632, 300, 637, 326, "LEAF_1", hi="LEAF_2", sh="LEAF_0")


def chalk(v):
    BOX(616, 328, 624, 336, "CREAM", sh="SLATE_2"); L(617, 327, 623, 327, "INK")


def gym_light(v):
    x = 678
    L(x, 76, x, 140, "INK")
    POLY([(x - 2, 140), (x + 2, 140), (x + 6, 146), (x - 6, 146)], "SLATE_0", "INK")
    L(x - 5, 145, x + 5, 145, "SLATE_1")
    R(x - 2, 147, x + 2, 148, "SUN" if v == "night" else "GLOW")


# ---------------------------------------------------------------- ceiling dressing, floor, foreground
def skylight(v):
    pts = [(338, 99), (462, 99), (452, 109), (348, 109)]
    if v == "night":
        POLY(pts, "INK", "INK"); POLY([(341, 104), (459, 104), (454, 108), (346, 108)], "SLATE_0")
    else:
        POLY(pts, "TERRA_1", "INK")
        POLY([(341, 104), (459, 104), (454, 108), (346, 108)], "RIM")
    L(400, 99, 400, 109, "INK"); L(338, 98, 462, 98, "INK")


def cables_ceiling(v):
    sag(100, 100, 330, 119, 5, "INK")
    sag(330, 119, 640, 105, 7, "INK")
    sag(160, 96, 520, 96, 12, "VOID")
    sag(560, 100, 700, 92, 6, "TERRA_0")


def rug(v):
    t = tier(v)
    if t <= 2:  # small worn mat
        POLY([(282, 312), (334, 312), (344, 334), (270, 334)], "BROWN_1", "INK")
        L(284, 314, 332, 314, "OAK_DK")
    else:
        bord = "GOLD" if t >= 5 else "TERRA_0"
        POLY([(262, 304), (350, 304), (372, 344), (236, 344)], bord, "INK")
        POLY([(265, 306), (347, 306), (366, 341), (242, 341)], "TERRA_1")
        POLY([(268, 309), (344, 309), (360, 338), (248, 338)], "TERRA_0")
        for y in range(312, 337, 8):
            POLY([(304, y - 3), (310, y), (304, y + 3), (298, y)], "GOLD_DK")
            R(304, y, 304, y, "CREAM")
        for x in range(238, 372, 4):
            R(x, 345, x + 1, 345, "CREAM")
    remap_poly([(352, 304), (494, 304), (506, 352), (330, 352)], SUN1)
    remap_poly([(370, 312), (476, 312), (484, 344), (356, 344)], SUN2)


def cables_floor(v):
    cable([(470, 300), (452, 320), (380, 336), (300, 350), (230, 330), (226, 316)], "INK")
    cable([(160, 318), (200, 340), (260, 356), (340, 360)], "SLATE_0")
    cable([(440, 302), (470, 330), (560, 346), (600, 352)], "TERRA_0")


def dog(v):
    """Dog in the sun patch, ~32x16, cream with a brown ear and back patch, red collar.
    base: asleep, head down on its front paws; alert (neglect): lying, head up and ears forward."""
    x0, y0 = 398, 318
    B, SH, E = "CREAM", "SLATE_2", "OAK_1"
    ELL(x0 + 9, y0 + 5, x0 + 30, y0 + 15, B)              # body
    ELL(x0 + 21, y0 + 6, x0 + 31, y0 + 15, B)             # haunch
    R(x0 + 2, y0 + 13, x0 + 13, y0 + 15, B)               # front legs stretched forward
    L(x0 + 32, y0 + 11, x0 + 34, y0 + 8, B); L(x0 + 33, y0 + 11, x0 + 35, y0 + 8, B)  # tail
    if v == "alert":
        R(x0 + 8, y0 + 4, x0 + 13, y0 + 12, B)            # neck
        ELL(x0 + 3, y0 + 0, x0 + 13, y0 + 9, B)           # raised head
        R(x0 - 1, y0 + 4, x0 + 4, y0 + 7, B)              # snout
    else:
        ELL(x0 + 3, y0 + 6, x0 + 13, y0 + 14, B)          # head resting on the paws
        R(x0 - 1, y0 + 10, x0 + 4, y0 + 13, B)            # snout
    # 1 px dark outline around the silhouette
    a = arr()
    op = a != T
    nb = np.zeros_like(op)
    nb[1:, :] |= op[:-1, :]; nb[:-1, :] |= op[1:, :]; nb[:, 1:] |= op[:, :-1]; nb[:, :-1] |= op[:, 1:]
    a[nb & ~op] = N["INK"]
    put(a)
    L(x0 + 11, y0 + 14, x0 + 28, y0 + 14, SH)            # belly shade
    L(x0 + 22, y0 + 8, x0 + 22, y0 + 13, SH)             # haunch line
    R(x0 + 15, y0 + 6, x0 + 20, y0 + 8, E)               # back patch
    L(x0 + 12, y0 + 6, x0 + 26, y0 + 6, "SUN")           # sun on the back
    R(x0 + 2, y0 + 14, x0 + 3, y0 + 15, SH)              # paw
    if v == "alert":
        R(x0 - 1, y0 + 4, x0 + 0, y0 + 5, "VOID")         # nose
        R(x0 + 5, y0 + 3, x0 + 6, y0 + 3, "VOID")         # open eye
        POLY([(x0 + 8, y0 + 0), (x0 + 12, y0 + 1), (x0 + 12, y0 + 7), (x0 + 9, y0 + 5)], E)  # ear
        R(x0 + 9, y0 + 9, x0 + 13, y0 + 10, "CRT_1")      # collar
    else:
        R(x0 - 1, y0 + 10, x0 + 0, y0 + 11, "VOID")       # nose
        L(x0 + 5, y0 + 9, x0 + 7, y0 + 9, "INK")          # closed eye
        POLY([(x0 + 8, y0 + 6), (x0 + 12, y0 + 7), (x0 + 12, y0 + 13), (x0 + 9, y0 + 12)], E)  # ear flap
        R(x0 + 13, y0 + 8, x0 + 13, y0 + 13, "CRT_1")     # collar


def basket_kitchen(v):
    hanging_basket(140, 92, 112, random.Random(8), vines=4, vlen=40)


def basket_window(v):
    hanging_basket(474, 96, 116, random.Random(9), vines=4, vlen=36)


def basket_comp(v):
    hanging_basket(652, 92, 108, random.Random(10), vines=3, vlen=40)


def crop_speaker(v):
    speaker(56, 300, 90, 376)
    speaker(60, 268, 88, 300)
    plant(74, 268, 6, random.Random(11), pot="SLATE_1")


def crop_cabinet(v):
    BOX(30, 336, 62, 380, "SLATE_0", hi="SLATE_1", sh="INK", rim="r")
    for y in (348, 362):
        L(31, y, 61, y, "INK"); R(42, y - 6, 50, y - 5, "SLATE_2")
    BOX(36, 328, 52, 336, "CREAM", sh="OAK_2")


def crop_plant(v):
    rng = random.Random(12)
    for i in range(12):
        a = math.pi * (1.05 + 0.9 * i / 11)
        x, y = 752 + math.cos(a) * 30, 352 + math.sin(a) * 46
        POLY([(752, 350), (x - 4, y), (x + 4, y - 3)], "LEAF_1" if i % 2 else "LEAF_2", "LEAF_0")
        L((752 + x) / 2, (350 + y) / 2, x, y - 1, "LEAF_3" if i % 3 == 0 else "LEAF_0")
    BOX(740, 352, 768, 384, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    gear(706, 352, 736, 384, rng, face="CHAR")


def crop_cables(v):
    cable([(70, 372), (180, 362), (300, 370), (420, 360), (560, 370), (700, 362)], "INK")
    cable([(94, 366), (220, 372), (380, 366)], "VOID")


def on_dot(x, y):
    def f(v):
        R(x, y, x + 1, y + 1, "SUN")
    return f


# ---------------------------------------------------------------- registry: every item, engine order data
SK = lambda s: {"skill": s}  # noqa: E731
FT = lambda s: {"feature": s}  # noqa: E731
STG = ("s0", "s1", "s2", "base")
REL = ("base", "active", "hot", "gold")


def register():
    ITEMS.clear()
    # shell plates (cut from one canvas; see build_shell)
    for sid in ("shell.sky", "shell.outside", "shell.window", "shell.l2", "shell.l3", "shell.l4", "shell.l5"):
        reg(sid, "shell", "shell", None, ("base", "night"))
    # ceiling dressing
    reg("window.skylight", "window", "decor", skylight, ("base", "night"), layer=2, lit=True, note="skylight (sunset sky, night: dark)")
    reg("window.cables-ceiling", "window", "decor", cables_ceiling, layer=2, note="conduit and cables across the ceiling")
    reg("kitchen.pendant", "kitchen", "decor", door_lamp, ("base", "night", "t1", "t3", "t5"), layer=4, lit=True, note="door lamp above the door (t1 bare bulb, t3 dome, t5 brass); gives the door its own pool")
    reg("library.pendant", "library", "decor", lib_pendant, ("base", "night", "t1", "t3", "t5"), layer=2, lit=True, note="library pendant (t1 bare bulb, t3 dome, t5 brass)")
    reg("study.pendant", "study", "decor", study_pendant, ("base", "night", "t1", "t3", "t5"), layer=2, lit=True, note="study pendant (t1 bare bulb, t3 red dome, t5 brass)")
    reg("bed.stringlights", "bed", "decor", bed_strings, ("base", "night", "t1", "t2", "t5"), layer=3, lit=True, note="string lights over the bed, 2x2 bulbs (t1 two bulbs)")
    reg("window.stringlights", "window", "decor", win_stringlights, layer=2, lit=True, note="R3: string lights along the window rod")
    reg("library.stringlights", "library", "decor", back_stringlights_l, layer=2, lit=True, note="R3: string lights, back wall left")
    reg("study.stringlights", "study", "decor", back_stringlights_r, layer=2, lit=True, note="R3: string lights, back wall right")
    reg("kitchen.pothos", "kitchen", "decor", basket_kitchen, layer=3, note="hanging basket, left")
    reg("library.pothos", "library", "decor", basket_window, layer=2, note="hanging basket over the CRTs")
    reg("study.pothos", "study", "decor", basket_comp, layer=3, note="hanging basket over the computer desk")
    # window zone
    reg("window.statue", "window", "hotspot", statue_fig, ("base", "t1", "t2", "t3", "t4", "t5"), layer=2, target=FT("overall"),
        label="FORGE", led=(330, 280), note="obsidian figure, kintsugi cracks grow by tier (I seed at the chest .. V full network, flakes, eyes); pedestal and plaque by tier",
        extra={"plaque": PLAQUE})
    reg("window.downlight-fixture", "window", "decor", downlight_fixture, layer=2, note="ceiling downlight above the statue")
    reg("library.sign", "library", "decor", sign, ("base", "t1", "t5"), layer=2, lit=True, note="FORGE plate left of the downlight (t1 paper card, t5 neon)")
    reg("window.relic", "window", "hotspot", niche, REL, layer=2, target=FT("relic-window"), label="RELIC", led=(432, 141), note="arched niche above the window: empty / iron / hot / gold medal")
    reg("window.candles", "window", "decor", candles, layer=2, lit=True, note="R3: streak candles on the sill")
    reg("window.sill-plant", "window", "decor", sill_plant_a, layer=2, note="sill plant (slate pot)")
    reg("window.sill-books", "window", "decor", sill_plant_b, layer=2, note="sill plant (terracotta pot)")
    reg("window.sill-mug", "window", "decor", sill_mug, layer=2, note="mug on the sill")
    reg("window.vinyl", "window", "decor", vinyl, layer=2, note="record crate under the window")
    reg("window.radiator", "window", "decor", radiator, layer=2, note="R3: radiator with a boxed camera and books")
    reg("window.plant", "window", "decor", win_plant, layer=2, note="tall floor plant under the window")
    reg("window.plantwall", "window", "decor", plantwall, ("base", "t1", "t4"), layer=2, note="small floor plant by the radiator (t1 sprout, t4 lush)")
    reg("window.amp", "window", "decor", amp, layer=2, note="amp and tape deck under the Today CRT")
    reg("window.today", "window", "hotspot", today_crt, layer=2, target=FT("today"), label="TODAY", led=(479, 268),
        note="big CRT (Today): idle dim amber; the engine blinks a cursor until the first log, then shows today's bar",
        extra={"screen": (447, 245, 478, 270)})
    reg("window.speaker", "window", "decor", win_speaker, layer=2, note="R3: speaker under the stats CRT")
    reg("window.stats", "window", "hotspot", stats_crt, layer=2, target=FT("stats"), label="STATS", led=(505, 270),
        note="small CRT, amber LCD: the engine alternates the overall score and the streak",
        extra={"screen": (487, 257, 507, 273)})
    reg("window.powerstrip", "window", "decor", powerstrip, layer=3, note="records and a camera on the floor")
    reg("window.rug", "window", "decor", rug, ("base", "t1", "t3", "t5"), layer=2, note="rug in the sun patch (t1 worn mat, t3 rug, t5 gold border)")
    reg("window.cables-floor", "window", "decor", cables_floor, layer=2, note="cables across the floor")
    reg("centre.dog", "window", "decor", dog, ("base", "alert"), layer=4, note="R3: the dog, asleep in the sun patch; alert = lying, head up (neglect)")
    # library
    reg("library.bookshelf", "library", "hotspot", bookshelf, STG, layer=2, target=SK("reading"), label="READING", led=(219, 286),
        note="9 ft bookcase with a clamp reading lamp (s0 sparse, s2 gold bookends)")
    reg("library.bookcase", "library", "decor", bookcase_top, ("base", "t1", "t4"), layer=2, note="boxes stacked on the bookcase (t1 taped moving boxes, t4 record crate)")
    reg("library.shelf-plant", "library", "decor", shelf_plant, layer=2, note="trailing plant on the bookcase")
    reg("library.globe", "library", "decor", lib_globe, layer=2, note="desk globe on the bookcase")
    reg("library.potions", "library", "decor", potions, layer=2, note="potion shelf: 15 skill bottles")
    reg("library.archive", "library", "hotspot", archive, layer=2, target=FT("archive"), label="ARCHIVE", led=(259, 292), note="lit trophy case with gold relics")
    reg("library.snakeplant", "library", "decor", snakeplant, layer=2, note="R3: snake plant before the statue")
    reg("library.clock", "library", "decor", lib_clock, layer=2, note="wall clock")
    reg("library.poster", "library", "decor", lib_poster, ("base", "t1", "t3", "t5"), layer=2, note="framed print above the potions (t1 paper, t5 gold frame)")
    reg("library.armchair", "library", "decor", armchair, ("base", "t1", "t3", "t4"), layer=3, note="reading chair (t1 beanbag, t3 fabric, t4 leather)")
    reg("library.floorlamp", "library", "decor", floorlamp, layer=3, lit=True, note="R3: floor lamp (reading pool)")
    reg("library.chess", "library", "hotspot", chess, STG, layer=3, target=SK("chess"), label="CHESS", led=(262, 312), note="chess table (s2 chess clock)")
    reg("library.stool", "library", "decor", lib_stool, layer=3, note="footstool")
    reg("library.books-floor", "library", "decor", books_floor, layer=3, note="finished books stacked on the floor")
    # study
    reg("study.shelf", "study", "decor", study_shelf, layer=2, note="wall shelf with books, plants, boxes")
    reg("study.speaker", "study", "decor", study_speakers_shelf, layer=2, note="R3: small speaker on the shelf")
    reg("study.pennant", "study", "decor", pennant, layer=2, note="original green and sky-blue pennant (no crest)")
    reg("study.photo", "study", "decor", photo, layer=2, note="empty photo frame")
    reg("study.academics", "study", "hotspot", corkboard, ("s0", "s1", "s2", "alert", "base"), layer=2, target=SK("academics"), label="ACADEMICS",
        led=(556, 218), note="corkboard with the class schedule (alert: a red due note)")
    reg("study.time", "study", "hotspot", calendar, STG, layer=2, target=SK("time-blocking"), label="TIME BLOCKING", led=(587, 211), note="wall calendar (more blocks by stage)")
    reg("study.clock", "study", "decor", study_clock, layer=2, note="R3: wall clock and sticky notes")
    reg("study.desk", "study", "decor", study_desk, ("base", "t1", "t3", "t5"), layer=2, note="desk (t1 folding table, t5 gold pulls and LED)")
    reg("study.lamp", "study", "decor", desk_lamp, ("base", "night", "t1", "t2", "t5"), layer=2, lit=True, note="desk lamp (t1 clamp bulb, t5 brass; lit at night)")
    reg("study.courses", "study", "hotspot", courses, layer=2, target=FT("courses"), label="COURSES", led=(596, 255), note="course books, one per class")
    reg("study.journal", "study", "hotspot", journal, layer=2, target=FT("journal"), label="JOURNAL", led=(556, 258), note="planner")
    reg("study.mug", "study", "decor", study_mug, layer=2, note="pencil cup and mug")
    reg("study.headphones", "study", "decor", headphones, layer=2, note="headphones on the desk")
    reg("study.backpack", "study", "decor", backpack, ("base", "alert"), layer=3, note="backpack (alert: a sheet sticking out)")
    ITEMS[-1]["variants"] = ["base"]  # v3 keeps the backpack base-only; the alert lives on study.academics
    reg("study.chair", "study", "decor", study_chair, ("base", "t1", "t3", "t5"), layer=3, note="desk chair with a jacket (t1 stool)")
    reg("study.bin", "study", "decor", study_bin, layer=3, note="waste bin")
    reg("study.plant", "study", "decor", study_plant, layer=3, note="R3: tall floor plant")
    # left sliver
    reg("kitchen.microwave", "kitchen", "decor", fridge, layer=4, note="fridge with the microwave on top (bleed)")
    reg("kitchen.table", "kitchen", "decor", wall_shelf_left, ("base", "t1", "t3", "t5"), layer=4, note="open shelf in the bleed (t1 bare, t5 plant)")
    reg("kitchen.hooks", "kitchen", "decor", hooks, layer=4, note="coat hook with a jacket")
    reg("kitchen.door", "kitchen", "hotspot", door, STG, layer=4, target=SK("college-integration"), label="COLLEGE INTEGRATION", led=(112, 300),
        note="door with the event-flyer board (more flyers by stage)")
    reg("kitchen.clock", "kitchen", "decor", kitchen_clock, layer=4, note="clock above the door")
    reg("kitchen.doormat", "kitchen", "hotspot", doormat, ("base", "alert"), layer=4, target=FT("review"), label="REVIEW", led=(124, 331), note="doormat (alert: a letter)")
    reg("kitchen.shoes", "kitchen", "decor", door_shoes, ("base", "t1", "t3"), layer=5, note="shoes by the door")
    reg("kitchen.settings", "kitchen", "hotspot", settings_box, layer=4, target=FT("settings"), label="SETTINGS", led=(126, 251), note="fuse box")
    reg("kitchen.switch", "kitchen", "decor", light_switch, layer=4, note="light switch")
    reg("kitchen.relic", "kitchen", "hotspot", kitchen_relic, REL, layer=4, target=FT("relic-left"), label="RELIC", led=(130, 216), note="relic mount by the door")
    reg("kitchen.counter", "kitchen", "decor", counter, ("base", "t1", "t3", "t5"), layer=3, note="counter, uppers with under-cabinet light (t1 no uppers)")
    reg("kitchen.spices", "kitchen", "decor", spices, layer=3, note="jars on the uppers")
    reg("kitchen.food", "kitchen", "hotspot", food, STG, layer=3, target=SK("food"), label="FOOD", led=(142, 276), note="fruit basket on the counter")
    reg("kitchen.water", "kitchen", "decor", water, ("base", "g0", "g1", "g2", "g3"), layer=3, note="water jug (fills g0..g3)")
    reg("kitchen.kettle", "kitchen", "decor", kettle, layer=3, note="kettle")
    reg("kitchen.board", "kitchen", "decor", cutting_board, layer=3, note="cutting board hanging on the backsplash")
    reg("kitchen.gut", "kitchen", "hotspot", gut, STG, layer=5, target=SK("gut-health"), label="GUT HEALTH", led=(126, 330), note="big leafy plant by the counter")
    reg("bed.frame", "bed", "decor", bed_frame, ("base", "t1", "t2", "t5"), layer=3, note="bed frame and headboard (t1 pallets, t5 gilded)")
    reg("bed.bed", "bed", "hotspot", bed_bed, STG, layer=4, target=SK("sleep"), label="SLEEP", led=(176, 300), note="mattress, pillows and duvet")
    reg("bed.nightstand", "bed", "decor", nightstand, layer=3, note="crate nightstand")
    reg("kitchen.stool", "kitchen", "decor", kitchen_stool, layer=4, note="step stool by the counter")
    reg("bed.shelf", "bed", "decor", nightshelf, layer=3, note="wall shelf above the bed head")
    reg("bed.globe", "bed", "hotspot", bed_globe, STG, layer=3, target=SK("visualization"), label="VISUALIZATION", led=(158, 233), note="plasma globe on the shelf")
    reg("bed.sconce", "bed", "decor", sconce, ("base", "night"), layer=3, lit=True, note="paper-star jar lamp")
    reg("bed.charger", "bed", "decor", charger, layer=3, note="phone on its charger")
    reg("bed.poster", "bed", "decor", bed_poster, ("base", "t1", "t3", "t5"), layer=3, note="small framed photo (the loud poster was cut)")
    reg("bed.runner", "bed", "decor", runner, ("base", "t3"), layer=4, note="bedside runner")
    reg("bed.cushion", "bed", "hotspot", cushion, STG, layer=4, target=SK("meditation"), label="MEDITATION", led=(166, 327), note="meditation cushion (s1 shawl, s2 candle)")
    reg("bed.slippers", "bed", "decor", slippers, layer=4, note="slippers")
    reg("bed.hamper", "bed", "decor", hamper, ("base", "t1", "t3", "t5"), layer=4, note="laundry (t1 pile, t3 hamper)")
    # right sliver
    reg("computer.board", "computer", "hotspot", whiteboard, STG, layer=3, target=SK("dropshipping"), label="DROPSHIPPING", led=(656, 250),
        note="product whiteboard")
    reg("computer.shelf", "computer", "decor", comp_shelf, layer=3, note="shelf above the whiteboard")
    reg("computer.router", "computer", "decor", router, layer=3, note="router on the shelf")
    reg("computer.desk", "computer", "decor", comp_desk, ("base", "t1", "t3", "t5"), layer=3, note="computer desk (t1 folding, t5 dark oak + gold edge)")
    reg("computer.led", "computer", "decor", comp_led, layer=3, lit=True, note="LED strip under the desk top")
    reg("computer.ai", "computer", "hotspot", comp_ai, STG, layer=3, target=SK("ai-building"), label="AI BUILDING", led=(641, 305), note="two monitors and the tower (s2 third monitor)")
    reg("computer.focus", "computer", "hotspot", comp_focus, layer=3, target=FT("focus"), label="FOCUS", led=(634, 231), note="sticky note on the monitor")
    reg("computer.headset", "computer", "decor", comp_headset, layer=3, note="headset on the monitor")
    reg("computer.speakers", "computer", "decor", keyboard, layer=3, note="keyboard and mouse")
    reg("computer.can", "computer", "decor", comp_can, layer=3, note="can")
    reg("computer.money", "computer", "decor", money, ("base", "g0", "g1", "g2", "g3"), layer=3, note="money tree (grows g0..g3)")
    reg("computer.chair", "computer", "decor", comp_chair, ("base", "t1", "t3", "t5"), layer=4, note="desk chair (t1 stool)")
    reg("computer.cables", "computer", "decor", comp_cables, ("base", "t1", "t3"), layer=3, note="cables (t1 tangled)")
    reg("computer.boxes", "computer", "decor", comp_boxes, layer=4, note="shipping boxes")
    reg("computer.mug", "computer", "decor", comp_mug, layer=3, note="R3: mug on the desk")
    reg("gym.relic", "gym", "hotspot", gym_relic, REL, layer=4, target=FT("relic-right"), label="RELIC", led=(676, 216), note="relic bracket")
    reg("gym.light", "gym", "decor", gym_light, ("base", "night"), layer=4, lit=True, note="gym pendant (pool over rack, bike, shoes)")
    reg("gym.medals", "gym", "decor", medals, ("base", "g0", "g1", "g2", "g3"), layer=4, note="medal wall (g0..g3)")
    reg("gym.trophies", "gym", "decor", bib, ("base", "t1", "t3", "t5"), layer=4, note="race bib and finisher photo")
    reg("gym.timer", "gym", "decor", mileage, layer=4, note="mileage chart poster")
    reg("gym.tiles", "gym", "decor", gym_tiles, ("base", "t1", "t3", "t5"), layer=4, note="rubber floor tiles under the rack")
    reg("gym.strength", "gym", "hotspot", rack, STG, layer=4, target=SK("strength"), label="STRENGTH", led=(686, 318), note="weight rack (plates by stage)")
    reg("gym.rope", "gym", "decor", rope, layer=4, note="jump rope on the rack")
    reg("gym.mat", "gym", "decor", yoga_mat, layer=4, note="rolled mat against the wall")
    reg("gym.bike", "gym", "hotspot", bike, ("s0", "s1", "s2", "awake", "base"), layer=5, target=SK("triathlon"), label="TRIATHLON", led=(696, 334),
        note="bike under a half-draped tarp (awake: tarp off)")
    reg("gym.running", "gym", "hotspot", shoes, STG, layer=5, target=SK("running"), label="RUNNING", led=(662, 334), note="running shoes")
    reg("gym.chalk", "gym", "decor", chalk, layer=5, note="chalk bucket")
    reg("gym.bottle", "gym", "decor", bottle, layer=5, note="bottle")
    reg("gym.roller", "gym", "decor", roller, layer=5, note="foam roller")
    reg("gym.kettlebell", "gym", "decor", kettlebell, layer=5, note="kettlebell")
    reg("gym.bag", "gym", "decor", gym_bag, layer=5, note="gym bag")
    # foreground crops
    reg("shell.crop.speaker", "shell", "decor", crop_speaker, layer=6, note="left speakers cropping the frame")
    reg("shell.crop.boxes", "shell", "decor", crop_cabinet, layer=6, note="filing cabinet cropping the frame")
    reg("shell.crop.plant", "shell", "decor", crop_plant, layer=6, note="big plant and amp cropping the right edge")
    reg("shell.crop.cables", "shell", "decor", crop_cables, layer=6, note="cables in front")
    # overlays
    reg("window.statue-downlight", "window", "overlay", None, layer=3, note="statue downlight on: flat 2-tone cone, floor pool, lit side of the statue one step up")
    reg("window.statue-closeup", "window", "overlay", closeup, ("base", "t1", "t2", "t3", "t4", "t5"), layer=6, note="panel close-up (never drawn in the room)")
    for zid, (x, y) in (("kitchen", (106, 214)), ("bed", (164, 225)), ("library", (231, 236)), ("study", (535, 256)),
                        ("computer", (647, 248)), ("gym", (677, 147))):
        reg(zid + ".on", zid, "overlay", on_dot(x, y), layer=4 if zid in ("kitchen", "gym") else 3, lit=True, note="the zone's lamp bulb")


# ---------------------------------------------------------------- per-sprite post passes
PROP_DN = {"OAK_2": "OAK_1", "OAK_1": "OAK_0", "OAK_0": "OAK_DK", "TERRA_2": "TERRA_1", "TERRA_1": "TERRA_0",
           "RIM": "TERRA_2", "SLATE_2": "SLATE_1", "SLATE_1": "SLATE_0", "LEAF_3": "LEAF_2", "LEAF_2": "LEAF_1",
           "LEAF_1": "LEAF_0", "CREAM": "SLATE_2", "PLUM_3": "PLUM_1", "GOLD": "GOLD_DK", "CRT_0": "TERRA_1",
           "CRT_1": "CRT_0", "ORANGE": "RIM", "GLOW": "OAK_2", "SUN": "GLOW"}


def post(it, a):
    """Props one value step darker; skill objects get a 1 px lighter resting outline."""
    if it["kind"] == "decor" and not it["lit"] and it["zone"] != "shell":
        out = a.copy()
        for k, v in PROP_DN.items():
            out[a == N[k]] = N[v]
        a = out
    if it["kind"] == "hotspot" and it["target"] and "skill" in it["target"]:
        op = a != T
        nb = np.zeros_like(op)
        nb[1:, :] |= ~op[:-1, :]; nb[:-1, :] |= ~op[1:, :]; nb[:, 1:] |= ~op[:, :-1]; nb[:, :-1] |= ~op[:, 1:]
        edge = op & nb & np.isin(a, [N["INK"], N["VOID"], N["CHAR"]])
        a = a.copy()
        a[edge] = N["SLATE_0"]
    return a


def draw(it, v):
    reset(T)
    it["fn"](v)
    return post(it, arr())


# ---------------------------------------------------------------- shell plates
def build_shell():
    """Return {variant: {plate id: full-frame array}} with disjoint plates."""
    out = {}
    for v in ("base", "night"):
        shell_canvas(night=(v == "night"))
        full = arr()
        reset(T); sky(v); a_sky = arr()
        reset(T); outside(v); a_out = arr()
        reset(T); window_frame(v); a_win = arr()
        glass = np.zeros((H, W), bool)
        glass[GY0:GY1 + 1, GX0:GX1 + 1] = True
        win = a_win != T
        plates = {}
        plates["shell.sky"] = np.where(glass, a_sky, T)
        plates["shell.outside"] = np.where(glass & (a_out != T), a_out, T)
        plates["shell.window"] = np.where(win, a_win, T)
        taken = glass | win
        for pid, rg in (("shell.l2", 2), ("shell.l3", 1), ("shell.l4", (3, 4)), ("shell.l5", (5, 0))):
            m = np.isin(RG, rg if isinstance(rg, tuple) else (rg,)) & ~taken
            plates[pid] = np.where(m, full, T)
            taken |= m
        out[v] = plates
    return out


SHELL_LAYER = {"shell.sky": 0, "shell.outside": 1}


# ---------------------------------------------------------------- build
def bbox(a):
    ys, xs = np.nonzero(a != T)
    if not len(xs):
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def auto_layer(bottom):
    return 2 if bottom <= 302 else 3 if bottom <= 318 else 4 if bottom <= 334 else 5


def default_variant(it):
    vs = it["variants"]
    for k in (it.get("still"), "s1", "t3", "g2", "base"):
        if k and k in vs:
            return k
    return vs[0]


def render_all():
    """Draw every item variant. Returns list of dicts with arrays, union boxes, still variant."""
    shell = build_shell()
    built = []
    for it in ITEMS:
        if it["kind"] == "shell":
            arrays = {v: shell[v][it["id"]] for v in it["variants"]}
        elif it["fn"] is None:
            continue
        else:
            arrays = {v: draw(it, v) for v in it["variants"]}
        box = union([bbox(a) for a in arrays.values()])
        layer = it["layer"] if it["layer"] is not None else (SHELL_LAYER.get(it["id"], 2) if it["kind"] == "shell" else auto_layer(box[3]))
        if it["kind"] == "shell":
            layer = SHELL_LAYER.get(it["id"], 2)
        built.append(dict(it=it, arrays=arrays, box=box, layer=layer))
    return built


def engine_order(built):
    def key(b):
        x0, y0, x1, y1 = b["box"]
        return (b["layer"], 0 if b["it"]["kind"] == "shell" else 1, y1, b["it"]["order"])
    return sorted([b for b in built if b["it"]["kind"] != "overlay" or b["it"]["id"].endswith(".on")], key=key)


def composite(built, state=None):
    """Composite the room like the engine does. state: {id: variant}. Returns (image array, owner ids)."""
    state = state or {}
    canvas = np.full((H, W), N["VOID"], np.uint8)
    owner = np.full((H, W), -1, np.int32)
    for b in engine_order(built):
        it = b["it"]
        v = state.get(it["id"], default_variant(it))
        if v is None or v not in b["arrays"]:
            continue
        a = b["arrays"][v]
        m = a != T
        canvas[m] = a[m]
        owner[m] = it["order"]
    return canvas, owner


def downlight_overlay(built, canvas, owner):
    """Statue downlight on: flat 2-tone cone (inner GOLD_DK, outer TERRA_0 steps) from the fixture to a floor pool;
    the statue's lit side one step up (never over a pixel that is gold in any tier)."""
    out = canvas.copy()
    ids = {i: it["id"] for i, it in enumerate(ITEMS)}
    shell_ids = {i for i, it in enumerate(ITEMS) if it["kind"] == "shell"}
    is_shell = np.isin(owner, list(shell_ids))
    rug_i = [i for i, it in enumerate(ITEMS) if it["id"] == "window.rug"][0]
    stat_i = [i for i, it in enumerate(ITEMS) if it["id"] == "window.statue"][0]
    cx, top, bot = 303, 124, 300
    t = (YS - top) / (bot - top)
    hw = np.floor(3 + t * 34)  # stepped edges (whole pixels per row group)
    hw = hw - (hw % 2)
    dx = np.abs(XS - cx)
    cone = (YS >= top) & (YS <= bot) & (dx <= hw) & (RG == 2) & is_shell
    inner = cone & (dx <= np.floor(hw * 0.55))
    outer = cone & ~inner
    for k, v in (("WALL_G", "TERRA_0"), ("CHAR", "TERRA_0"), ("TERRA_0", "TERRA_1"), ("OAK_DK", "TERRA_0"), ("SLATE_0", "TERRA_0")):
        out[outer & (canvas == N[k])] = N[v]
    for k, v in (("WALL_G", "GOLD_DK"), ("CHAR", "GOLD_DK"), ("TERRA_0", "GOLD_DK"), ("OAK_DK", "GOLD_DK"), ("SLATE_0", "GOLD_DK")):
        out[inner & (canvas == N[k])] = N[v]
    # floor pool: bright ellipse (2 flat tones) on floor and rug
    dd = ((XS - cx) / 44.0) ** 2 + ((YS - 306) / 9.0) ** 2
    fl = (dd <= 1) & (is_shell | (owner == rug_i)) & (RG == 5)
    fmap1 = {"BROWN_1": "OAK_0", "OAK_DK": "OAK_1", "VOID": "OAK_DK", "INK": "OAK_DK", "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "GOLD_DK": "GOLD"}
    fmap2 = {"BROWN_1": "OAK_1", "OAK_DK": "OAK_2", "VOID": "OAK_0", "INK": "OAK_0", "TERRA_0": "TERRA_2", "TERRA_1": "RIM", "GOLD_DK": "GOLD"}
    for k, v in fmap1.items():
        out[fl & (dd > 0.45) & (canvas == N[k])] = N[v]
    for k, v in fmap2.items():
        out[fl & (dd <= 0.45) & (canvas == N[k])] = N[v]
    # lit side of the statue (right of the centre line), excluding any tier's gold pixels
    st = [b for b in built if b["it"]["id"] == "window.statue"][0]
    goldany = np.zeros((H, W), bool)
    for a in st["arrays"].values():
        goldany |= np.isin(a, [N["GOLD"], N["SUN"], N["GOLD_DK"]])
    lit = (owner == stat_i) & (XS >= cx) & ~goldany & (YS < 283)
    for k, v in (("STAT_1", "STAT_2"), ("STAT_2", "SLATE_0"), ("INK", "STAT_1")):
        out[lit & (canvas == N[k])] = N[v]
    diff = out != canvas
    return np.where(diff, out, T)


def save_png(a, path):
    im = Image.fromarray(a.astype(np.uint8), "P")
    im.putpalette(FLAT)
    rgba = Image.new("RGBA", im.size)
    px = np.zeros((a.shape[0], a.shape[1], 4), np.uint8)
    rgb = np.array(RGB + [(0, 0, 0)] * (256 - len(RGB)), np.uint8)
    px[..., :3] = rgb[a]
    px[..., 3] = np.where(a == T, 0, 255)
    Image.fromarray(px, "RGBA").save(path)


def to_rgb(a):
    rgb = np.array(RGB + [(0, 0, 0)] * (256 - len(RGB)), np.uint8)
    return Image.fromarray(rgb[np.where(a == T, N["VOID"], a)], "RGB")


def build():
    write_palette()
    register()
    built = render_all()
    canvas, owner = composite(built)
    dl = downlight_overlay(built, canvas, owner)
    for b in built:
        if b["it"]["id"] == "window.statue-downlight":
            break
    else:
        it = [i for i in ITEMS if i["id"] == "window.statue-downlight"][0]
        built.append(dict(it=it, arrays={"base": dl}, box=bbox(dl), layer=3))
    manifest = []
    root = os.path.join(PROTO, SPR_DIR)
    if os.path.isdir(root):
        for dp, _, fs in os.walk(root):
            for f in fs:
                if f.endswith(".png"):
                    os.remove(os.path.join(dp, f))
    for b in built:
        it = b["it"]
        x0, y0, x1, y1 = b["box"]
        zone, name = it["id"].split(".", 1)
        variants = {}
        for v, a in b["arrays"].items():
            rel = f"{SPR_DIR}/{zone}/{name}.{v}.png"
            os.makedirs(os.path.join(PROTO, SPR_DIR, zone), exist_ok=True)
            save_png(a[y0:y1, x0:x1], os.path.join(PROTO, rel))
            variants[v] = rel
        rec = {"id": it["id"], "zone": it["zone"], "kind": it["kind"], "layer": b["layer"], "x": int(x0 - OX), "y": int(y0 - OY),
               "w": int(x1 - x0), "h": int(y1 - y0), "variants": variants}
        if it["kind"] == "hotspot":
            rec["target"] = it["target"]
            rec["label"] = it["label"]
            lx, ly = it["led"]
            lx = min(max(lx, x0), x1 - 3)
            ly = min(max(ly, y0), y1 - 3)
            rec["led"] = [int(lx - OX), int(ly - OY)]
            # tap area: opaque union bounds padded to at least MIN_HIT world px (44 CSS px at phone zone zoom)
            hx0, hy0, hx1, hy1 = x0, y0, x1, y1
            pw, ph = max(0, MIN_HIT - (hx1 - hx0)), max(0, MIN_HIT - (hy1 - hy0))
            rec["hit"] = [int(hx0 - OX - pw // 2), int(hy0 - OY - ph // 2), int(hx1 - hx0 + pw), int(hy1 - hy0 + ph)]
        for k, val in it["extra"].items():
            if k in ("screen", "plaque"):
                ax0, ay0, ax1, ay1 = val
                rec[k] = [int(ax0 - OX), int(ay0 - OY), int(ax1 - ax0), int(ay1 - ay0)]
        if it["note"]:
            rec["note"] = it["note"]
        manifest.append(rec)
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump({"part": "room-r3", "items": manifest}, f, indent=1)
    zones = make_zones(manifest)
    with open(os.path.join(HERE, "zones.json"), "w") as f:
        json.dump(zones, f, indent=1)
    stills(built, canvas, dl)
    kinds = {}
    for r in manifest:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"{len(manifest)} items {kinds}")


MIN_HIT = 11  # world px: phone (375x812 @3x) zone zoom is 12 device px = 4 CSS px per world px


# ---------------------------------------------------------------- zones.json
ZONES = [("kitchen", "KITCHEN"), ("bed", "BED"), ("library", "LIBRARY"), ("window", "WINDOW"), ("study", "STUDY DESK"),
         ("computer", "COMPUTER"), ("gym", "GYM")]
SKILLS = {"food": "kitchen", "gut-health": "kitchen", "college-integration": "kitchen", "sleep": "bed", "meditation": "bed",
          "visualization": "bed", "reading": "library", "chess": "library", "academics": "study", "time-blocking": "study",
          "ai-building": "computer", "dropshipping": "computer", "strength": "gym", "running": "gym", "triathlon": "gym"}
ZONE_LIGHT = {"kitchen": (106 - OX, 214 - OY, 22), "bed": (160 - OX, 232 - OY, 22), "library": (226 - OX, 236 - OY, 24),
              "window": (421 - OX, 230 - OY, 24), "study": (566 - OX, 200 - OY, 24), "computer": (650 - OX, 246 - OY, 22),
              "gym": (678 - OX, 250 - OY, 24)}


def make_zones(items):
    AX, AY, AW, AH = -OX, -OY, W, H
    zones = []
    for n, (zid, name) in enumerate(ZONES, 1):
        hs = [i for i in items if i["zone"] == zid and i["kind"] == "hotspot"]
        boxes = [(i["hit"][0], i["hit"][1], i["hit"][0] + i["hit"][2], i["hit"][1] + i["hit"][3]) for i in hs]
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        w = min(270, max(220, (x1 - x0) + 40, ((y1 - y0) + 24) * 16 / 9))
        h = w * 9 / 16
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fx = min(max(cx - w / 2, AX), AX + AW - w)
        fy = min(max(cy - h / 2, AY), AY + AH - h)
        zones.append({"id": zid, "n": n, "name": name, "focus": [round(fx), round(fy), round(w), round(h)],
                      "stop": round(cx), "phoneStop": round(min(max(cx, 60), 640 - 60)),
                      "hotspots": [i["id"] for i in hs], "territory": {"x0": round(x0), "x1": round(x1)},
                      "light": list(ZONE_LIGHT[zid])})
    # keep territories ordered and non-overlapping for zoneAtX
    for a, b in zip(zones, zones[1:]):
        if a["territory"]["x1"] > b["territory"]["x0"]:
            mid = round((a["stop"] + b["stop"]) / 2)
            a["territory"]["x1"] = min(a["territory"]["x1"], mid)
            b["territory"]["x0"] = max(b["territory"]["x0"], mid)
    statue = next(i for i in items if i["id"] == "window.statue")
    rug_ = next(i for i in items if i["id"] == "window.rug")
    return {
        "_note": "R3 world coordinates (art px): master (800x480) = world + (80, 96). The 640x270 core is x 0..640, y 0..270; "
                 "the painted art spans x -80..720, y -96..384. Keys 1-7 run left to right. focus = what a zone step-in frames "
                 "(16:9, hotspots plus margin, 15-20% of the neighbours visible). stop = zone centre x for the phone pan. "
                 "light = the zone's lamp pool [x, y, r]. Generated by art/room-r3/build.py.",
        "art": {"x": AX, "y": AY, "w": AW, "h": AH},
        "core": {"w": 640, "h": 270},
        "horizon": VP[1] - OY,
        "vp": [VP[0] - OX, VP[1] - OY],
        "camera": {"defaultZoom": 1.3, "horizonPct": round((VP[1] - OY) / 270, 3), "phoneDefaultX": 320,
                   "defaultZoomNote": "default view up to 1.3x closer than the full core (whole pixels); the phone pan starts "
                                      "centred on the statue, window and CRTs"},
        "zones": zones,
        "shell": {"backWall": [170 - OX, 124 - OY, 630 - OX, 300 - OY], "window": [GX0 - OX, GY0 - OY, GX1 - OX, GY1 - OY],
                  "sill": [332 - OX, 243 - OY, 510 - OX, 249 - OY], "ceilingY": 124 - OY, "floorBackY": 300 - OY,
                  "leftWall": {"formula": "master: top y = 59 + 65 x / 170, bottom y = 365 - 65 x / 170 (x 0..170)"},
                  "rightWall": "mirror of leftWall about master x = 400"},
        "centre": {"statue": [statue["x"], statue["y"], statue["w"], statue["h"]], "statueContactY": statue["y"] + statue["h"],
                   "rug": [rug_["x"], rug_["y"], rug_["w"], rug_["h"]], "downlight": [303 - OX, 124 - OY],
                   "dogSleep": [412 - OX, 334 - OY], "sunbeam": "floor patch from the window across the rug"},
        "relics": {"relic-left": "kitchen.relic", "relic-window": "window.relic", "relic-right": "gym.relic"},
        "layers": {"_note": "L0 sky, L1 outside, L2 shell plates and the back wall, L3-L5 side walls and floor by depth, L6 frame crops."},
        "skills": dict({"_note": "Every skill maps to exactly one hotspot object."}, **SKILLS),
    }


# ---------------------------------------------------------------- stills
def leds(img, built, state=None):
    """Draw the engine's LEDs (3x3 done with a white centre) into a still, for review."""
    a = img.copy()
    for b in built:
        it = b["it"]
        if it["kind"] != "hotspot":
            continue
        lx, ly = it["led"]
        x0, y0, x1, y1 = b["box"]
        lx, ly = min(max(lx, x0), x1 - 3), min(max(ly, y0), y1 - 3)
        cat = "gold"
        ramp_ = BASE["categories"][cat]
        for k in range(9):
            c = "CREAM" if k == 4 else ramp_[2]
            a[ly + k // 3, lx + k % 3] = N[c]
    return a


def export(a, path, box, scale=2):
    im = to_rgb(a).crop(box)
    im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    im.save(path)
    return im.size


def stills(built, canvas, dl):
    os.makedirs(STILLS, exist_ok=True)
    to_rgb(canvas).save(os.path.join(STILLS, "master@1x.png"))
    print("full-room", export(canvas, os.path.join(STILLS, "full-room@2x.png"), CORE))
    on = canvas.copy()
    m = dl != T
    on[m] = dl[m]
    hot, _ = composite(built, {"window.relic": "hot", "window.statue": "t3"})
    hot[m] = dl[m]
    print("window-zone", export(hot, os.path.join(STILLS, "window-zone@2x.png"), (258, 112, 530, 308)))
    # review sheet: stages 0/1/2, tiers 1 and 5, night
    def st_all(k):
        return {b["it"]["id"]: k for b in built if k in b["it"]["variants"]}
    for name, state in (("stage0", st_all("s0")), ("stage2", st_all("s2")), ("tier1", st_all("t1")),
                        ("tier5", st_all("t5")), ("night", st_all("night"))):
        img, _ = composite(built, state)
        export(img, os.path.join(STILLS, f"review-{name}@1x.png"), CORE, scale=1)
    closeups = [b for b in built if b["it"]["id"] == "window.statue-closeup"][0]
    tiles = []
    for t in range(1, 6):
        a = closeups["arrays"][f"t{t}"]
        bx = closeups["box"]
        tiles.append(to_rgb(a[bx[1]:bx[3], bx[0]:bx[2]]))
    sheet = Image.new("RGB", (sum(t.width for t in tiles) + 8 * 4, tiles[0].height), RGB[N["VOID"]])
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0)); x += t.width + 8
    sheet.save(os.path.join(STILLS, "statue-tiers@1x.png"))
    cols = set(np.unique(canvas)) - {T}
    print("colours used:", len(cols), "/", len(RGB))
    if Sprite is not None:
        sp = Sprite(8, 8, palette=[h for _, h in PAL])
        print("pixelstudio palette size:", len(sp.palette))


if __name__ == "__main__":
    build()
