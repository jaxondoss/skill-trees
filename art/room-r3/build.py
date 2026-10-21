#!/usr/bin/env python3
"""FORGE room, revision 3 stills (deterministic).

Chunky 16-bit look: flat clusters, 2-4 tones per material, dark 1 px outlines,
no dither except the sky and light pools (2-step checker bands).
Master art is 800x480; the default view is the 640x270 core at (80,96).
Camera ~9-10 ft from the back wall, ~60 deg: back wall x170..630 (72%),
side-wall slivers 90 px each (14%), vanishing point (400,212) = 43% of core.

Run:  python3 art/room-r3/build.py
Out:  docs/redesign/room-r3/stills/{full-room@2x.png, window-zone@2x.png, master@1x.png}
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
OUT = os.path.join(ROOT, "docs", "redesign", "room-r3", "stills")

# ---------------------------------------------------------------- palette
BASE = json.load(open(os.path.join(ROOT, "art", "room-v3", "common", "palette.json")))
SWAPS = {  # rarely used entries -> plaster + statue tones
    "BROWN_0": ("CHAR", "#1E2423", "charcoal plaster (shadow)"),
    "PLUM_1": ("WALL_G", "#2B3633", "slate-green plaster (main wall)"),
    "PLUM_2": ("STAT_1", "#19202C", "obsidian body, near-black blue"),
    "AMBER": ("STAT_2", "#2E3B50", "obsidian sheen, dark blue"),
    "BROWN_2": ("STAT_HI", "#C6DCEE", "cool blue-white specular"),
}
PAL = []
for name, hx, *_ in BASE["colors"]:
    if name in SWAPS:
        name, hx, _ = SWAPS[name]
    PAL.append((name, hx))
N = {n: i for i, (n, _) in enumerate(PAL)}
RGB = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for _, h in PAL]
FLAT = [v for t in RGB for v in t]


def write_proposal():
    prop = {
        "_note": "room-r3 palette proposal: v3 master palette with 5 rarely used entries swapped "
                 "for charcoal / slate-green plaster and obsidian statue tones.",
        "swaps": [{"from": k, "to": v[0], "hex": v[1], "why": v[2]} for k, v in SWAPS.items()],
        "colors": [[n, h] for n, h in PAL],
    }
    with open(os.path.join(HERE, "palette-proposal.json"), "w") as f:
        json.dump(prop, f, indent=1)


# ---------------------------------------------------------------- canvas
W, H = 800, 480
CORE = (80, 96, 720, 366)
VP = (400, 212)


class S:
    im = None
    d = None


def reset():
    S.im = Image.new("P", (W, H), N["VOID"])
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
    S.d.polygon([(int(round(x)), int(round(y))) for x, y in pts], fill=N[c],
                outline=N[ol] if ol else None)


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


# ---------------------------------------------------------------- tiny font
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001010010",
    "8": "111101111101111", "9": "111101111001111", "F": "111100110100100", "O": "111101101101111",
    "R": "110101110101101", "G": "111100101101111", "E": "111100110100111", "D": "110101101101110",
    ":": "000010000010000", "A": "010101111101101", "T": "111010010010010", "-": "000000111000000",
    "I": "111010010010111", "$": "011110010011110", " ": "000000000000000",
}


def text(x, y, s, c):
    for ch in s:
        g = FONT.get(ch, FONT[" "])
        for i, b in enumerate(g):
            if b == "1":
                P(x + i % 3, y + i // 3, c)
        x += 4
    return x


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


def pool(cx, cy, rx, ry, mp, reg=None, inner=0.55):
    """Light pool: inner ellipse fully remapped, outer ring on a 2x2 checker (2-step band)."""
    a = arr()
    ys, xs = np.mgrid[0:H, 0:W]
    dd = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2
    ok = dd <= 1.0
    if reg is not None:
        ok &= np.isin(RG, reg if isinstance(reg, (list, tuple)) else [reg])
    ring_ = ok & (dd > inner) & (((xs + ys) % 2) == 0)
    core = ok & (dd <= inner)
    sel = ring_ | core
    out = a.copy()
    for k, v in mp.items():
        out[sel & (a == N[k])] = N[v]
    put(out)


def remap_poly(pts, mp, reg=None):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in pts], fill=1)
    sel = np.array(m) == 1
    if reg is not None:
        sel &= np.isin(RG, reg)
    a = arr()
    out = a.copy()
    for k, v in mp.items():
        out[sel & (a == N[k])] = N[v]
    put(out)


# ---------------------------------------------------------------- props
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
            # small lying stack
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
        P(x, y, "LEAF_0"); P(x + 1, y, "LEAF_0"); P(x, y + 1, "LEAF_0")
        return
    P(x, y, "LEAF_1"); P(x + 1, y, "LEAF_2"); P(x - 1, y + 1, "LEAF_1"); P(x, y + 1, "LEAF_1")
    P(x + 1, y + 1, "LEAF_1")
    if rng.random() < 0.35:
        P(x + 1, y, "LEAF_3")


def plant(cx, yb, size, rng, pot="TERRA_1", tall=1.0, potw=None):
    pw = potw or max(4, size // 2 + 2)
    ph = max(3, size // 3)
    x0 = cx - pw // 2
    BOX(x0, yb - ph, x0 + pw - 1, yb, pot, hi=LIGHT.get(pot), sh="TERRA_0" if pot.startswith("TERRA") else "INK")
    top = yb - ph
    for i in range(size * 5):
        a = rng.uniform(math.pi * 1.05, math.pi * 1.95)
        r = rng.uniform(0.25, 1.0) * size
        x = cx + math.cos(a) * r * 0.9
        y = top - 1 + math.sin(a) * r * tall
        leaf(int(x), int(y), rng, dark=i < size * 2)


def snake_plant(cx, yb, h, rng):
    BOX(cx - 3, yb - 4, cx + 3, yb, "SLATE_0", hi="SLATE_1")
    for i, dx in enumerate((-2, -1, 0, 1, 2)):
        hh = h - abs(dx) * 3 - rng.randint(0, 3)
        L(cx + dx, yb - 5, cx + dx + (dx > 0) - (dx < 0), yb - 5 - hh, "LEAF_1" if i % 2 else "LEAF_2")
        P(cx + dx + (dx > 0) - (dx < 0), yb - 5 - hh, "LEAF_3")


def vine(x, y, length, rng, drift=0.0):
    for i in range(length):
        y += 1
        if rng.random() < 0.35:
            x += 1 if rng.random() < 0.5 + drift else -1
        P(x, y, "LEAF_0")
        if i % 3 == 1:
            s = 1 if (i // 3) % 2 else -1
            P(x + s, y, "LEAF_2"); P(x + 2 * s, y, "LEAF_1"); P(x + s, y + 1, "LEAF_1")
            if rng.random() < 0.3:
                P(x + s, y - 1, "LEAF_3")


def hanging_basket(x, ytop, ybask, rng, vines=4, vlen=40):
    L(x, ytop, x - 4, ybask, "INK"); L(x, ytop, x + 4, ybask, "INK")
    BOX(x - 5, ybask, x + 5, ybask + 5, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    for i in range(10):
        leaf(x - 5 + rng.randint(0, 10), ybask - 2 + rng.randint(-1, 1), rng)
    for i in range(vines):
        vine(x - 5 + i * 10 // max(1, vines - 1), ybask + 4, rng.randint(vlen // 2, vlen), rng)


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
        P(cx, y0 + 4, "SLATE_1")


def gear(x0, y0, x1, y1, rng, rim=None, face="CHAR"):
    BOX(x0, y0, x1, y1, "BROWN_1", hi="SLATE_0", sh="INK", rim=rim)
    R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, face)
    x = x0 + 3
    while x < x1 - 3:
        k = rng.random()
        if k < 0.3:
            P(x, (y0 + y1) // 2, "SLATE_1"); P(x, (y0 + y1) // 2 + 1, "INK")
        elif k < 0.45:
            P(x, y0 + 3, rng.choice(["CRT_1", "GLOW", "LEAF_3"]))
        elif k < 0.6 and x < x1 - 6:
            R(x, y0 + 3, x + 3, y0 + 4, "GLOW")
            x += 3
        else:
            P(x, y1 - 3, "INK")
        x += 2


def crt(x0, y0, x1, y1, screen="red", rim=None):
    BOX(x0, y0, x1, y1, "BROWN_1", hi="SLATE_0", sh="INK", rim=rim)
    sx0, sy0, sx1, sy1 = x0 + 3, y0 + 3, x1 - 6, y1 - 4
    if screen == "red":
        R(sx0, sy0, sx1, sy1, "CRT_0")
        for c in ((sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)):
            P(*c, "TERRA_0")
        cx, cy = (sx0 + sx1) // 2, (sy0 + sy1) // 2
        circ(cx - 4, cy - 2, 3, "CRT_1")
        P(cx - 4, cy - 2, "GLOW")
        for i, y in enumerate(range(sy0 + 3, sy1 - 1, 3)):
            L(cx + 1, y, cx + 4 + (i * 3) % 6, y, "CRT_1")
        L(sx0 + 2, sy1 - 2, sx1 - 2, sy1 - 2, "TERRA_0")
        L(sx0 + 2, sy1 - 2, sx0 + 2 + (sx1 - sx0) * 2 // 3, sy1 - 2, "GLOW")
    else:
        R(sx0, sy0, sx1, sy1, "SLATE_1")
        for c in ((sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)):
            P(*c, "SLATE_0")
        text(sx0 + 2, sy0 + 2, "72", "SLATE_2")
        L(sx0 + 2, sy1 - 2, sx1 - 3, sy1 - 2, "LEAF_3")
    # side panel knobs
    for i in range(3):
        P(x1 - 3, y0 + 4 + i * 3, "SLATE_1")
    P(x1 - 3, y1 - 3, "CRT_1")


def cable(pts, c="INK"):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        out += sag(x0, y0, x1, y1, 2, c)
    return out


def string_lights(x0, y0, x1, y1, s, step=7, seed=0):
    pts = sag(x0, y0, x1, y1, s, "INK")
    cols = ["GLOW", "SUN", "CRT_1", "SLATE_2", "GLOW", "PLUM_3"]
    dim = {"GLOW": "RIM", "SUN": "GLOW", "CRT_1": "CRT_0", "SLATE_2": "SLATE_1", "PLUM_3": "TERRA_2"}
    for i in range(seed % step, len(pts), step):
        x, y = pts[i]
        c = cols[(i // step + seed) % len(cols)]
        P(x, y + 1, c)
        P(x, y + 2, dim[c])


def frame(x0, y0, x1, y1, inner, fc="OAK_1"):
    BOX(x0, y0, x1, y1, fc, hi=LIGHT.get(fc), sh="OAK_DK")
    R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, inner)


# ---------------------------------------------------------------- shell
def shell(cone=False):
    a = np.full((H, W), N["VOID"], np.uint8)
    a[RG == 1] = N["CHAR"]
    a[RG == 2] = N["WALL_G"]
    a[RG == 3] = N["CHAR"]
    a[RG == 4] = N["CHAR"]
    # floor planks converging on the vanishing point
    ys, xs = np.mgrid[0:H, 0:W]
    fl = RG == 5
    z = np.clip(ys - 212, 1, None).astype(float)
    u = (xs - 400) * 88.0 / z + 400
    k = np.floor((u - 170) / 12).astype(int)
    frac = (u - 170) / 12 - k
    pw = 12 * z / 88
    col = np.where(k % 3 == 0, N["BROWN_1"], N["OAK_DK"])
    col = np.where(frac * pw < 1, N["VOID"], col)
    # plank end joints
    j1 = 304 + (np.abs(k * 37) % 50)
    j2 = j1 + 38 + (np.abs(k * 13) % 30)
    col = np.where((ys == j1) | (ys == j2), N["VOID"], col)
    # front shadow band
    sh = fl & (ys > 344)
    col = np.where(sh & (col == N["OAK_DK"]), N["BROWN_1"], col)
    col = np.where(sh & (ys > 352) & (col == N["BROWN_1"]), N["INK"], col)
    a[fl] = col[fl]
    # wall bands: ceiling shadow and corners (flat, no dither)
    a[(RG == 2) & (ys < 131)] = N["CHAR"]
    a[(RG == 2) & ((xs < 175) | (xs > 625))] = N["CHAR"]
    a[(RG == 3) & (ys > (lw(xs.clip(0, 170), 0.92)))] = N["INK"]
    a[(RG == 4) & (ys > (rw(xs.clip(630, 800), 0.92)))] = N["INK"]
    put(a)
    # baseboards
    R(170, 296, 630, 299, "CHAR"); L(170, 296, 630, 296, "INK")
    POLY(wq("L", 0, 170, 0, 0.018), "INK")
    POLY(wq("R", 630, 800, 0, 0.018), "INK")
    # plaster marks (flat)
    for x, y, l in ((190, 140, 5), (590, 150, 4), (360, 270, 6), (612, 230, 3)):
        L(x, y, x + l, y + 1, "CHAR"); P(x + 1, y - 1, "SLATE_0")
    # wall corners
    L(170, 124, 170, 300, "INK"); L(630, 124, 630, 300, "INK")
    L(170, 124, 630, 124, "VOID")
    L(0, 59, 170, 124, "VOID"); L(630, 124, 800, 59, "VOID")


def ceiling():
    rng = random.Random(11)

    def xl(y):
        return (y - 59) * 170 / 65

    # depth beams converge on the vanishing point
    for bx in (150, 250, 350, 450, 550, 650):
        s = 212 / 88
        x2 = 400 + (bx - 400) * s
        for o in (-1, 0, 1):
            L(bx + o, 124, x2 + o * 2, 0, "INK")
        L(bx + 2, 124, x2 + 5, 0, "VOID")
    # skylight (sunset sky, banded)
    pts = [(338, 99), (462, 99), (452, 109), (348, 109)]
    POLY(pts, "TERRA_1", "INK")
    POLY([(341, 104), (459, 104), (454, 108), (346, 108)], "RIM")
    for x in range(342, 458, 2):
        P(x, 103, "RIM")
    L(400, 99, 400, 109, "INK"); L(338, 99, 348, 109, "INK"); L(462, 99, 452, 109, "INK")
    L(338, 98, 462, 98, "INK")
    # cross beams (dark paint)
    for y0, y1 in ((112, 117), (88, 94), (60, 68), (20, 30)):
        a0, a1 = xl(y0), xl(y1)
        POLY([(a0, y0), (800 - a0, y0), (800 - a1, y1), (a1, y1)], "INK")
        L(a0, y0, 800 - a0, y0, "CHAR")
        L(a1, y1, 800 - a1, y1, "VOID")
    # conduit + cables
    sag(100, 100, 330, 119, 5, "INK")
    sag(330, 119, 640, 105, 7, "INK")
    sag(160, 96, 520, 96, 12, "VOID")
    sag(560, 100, 700, 92, 6, "TERRA_0")
    # downlight track over the statue
    R(280, 118, 330, 119, "INK")


def downlight(on):
    BOX(299, 117, 307, 123, "BROWN_1", hi="SLATE_0")
    L(300, 123, 306, 123, "SUN" if on else "SLATE_0")
    if on:
        P(303, 124, "SUN")


def pendants():
    # library pendant (dark metal dome, warm bulb)
    for x, ylen, shade in ((198, 142, "SLATE_0"), (566, 140, "CRT_0")):
        L(x, 90, x, ylen - 4, "INK")
        POLY([(x - 2, ylen - 4), (x + 2, ylen - 4), (x + 6, ylen + 2), (x - 6, ylen + 2)], shade, "INK")
        L(x - 5, ylen + 1, x + 5, ylen + 1, LIGHT.get(shade, "CRT_1"))
        L(x - 2, ylen + 3, x + 2, ylen + 3, "GLOW")
        P(x, ylen + 3, "SUN")


# ---------------------------------------------------------------- window zone
def window(niche_hot):
    rng = random.Random(21)
    gx0, gy0, gx1, gy1 = 344, 152, 498, 242
    # outer frame
    BOX(339, 147, 503, 247, "OAK_DK")
    # sky bands with 2-row checker transitions
    bands = [(gy0, "TERRA_1"), (163, "TERRA_2"), (175, "RIM"), (188, "ORANGE"), (201, "GLOW")]
    for i, (y, c) in enumerate(bands):
        yn = bands[i + 1][0] if i + 1 < len(bands) else gy1 + 1
        R(gx0, y, gx1, yn - 1, c)
        if i > 0:
            pc = bands[i - 1][1]
            for x in range(gx0, gx1 + 1):
                if x % 2 == 0:
                    P(x, y, pc)
    # clouds (flat streaks, lit undersides)
    for x0, x1, y, dark, lit in ((350, 410, 160, "TERRA_0", "RIM"), (420, 490, 167, "TERRA_1", "GLOW"),
                                 (362, 440, 178, "TERRA_1", "GLOW"), (440, 496, 185, "TERRA_2", "GLOW"),
                                 (346, 388, 190, "TERRA_2", "SUN"), (410, 470, 196, "RIM", "SUN")):
        R(x0, y, x1, y + 1, dark)
        R(x0 + 4, y - 1, x1 - 8, y - 1, dark)
        L(x0 + 2, y + 2, x1 - 3, y + 2, lit)
    # pale sun
    circ(392, 214, 11, "SUN")
    circ(392, 214, 7, "CREAM")
    for x in range(380, 405):
        P(x, 202 + (x % 2), "SUN") if abs(x - 392) < 8 else None
    # distant roofs (lighter slate)
    x = gx0
    while x < gx1:
        w = rng.randint(7, 12)
        h = rng.randint(6, 12)
        top = 232 - h
        POLY([(x, 236), (x, top + 3), (x + w // 2, top), (x + w, top + 3), (x + w, 236)], "SLATE_1")
        x += w + rng.randint(0, 2)
    # live oaks (dark green masses)
    def oak(cx, cy, rx, ry, seed):
        r2 = random.Random(seed)
        for i in range(60):
            a = r2.uniform(0, math.tau)
            rr = r2.uniform(0, 1) ** 0.6
            x, y = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
            ELL(x - 4, y - 3, x + 4, y + 3, "LEAF_0")
        for i in range(30):
            a = r2.uniform(math.pi, math.tau)
            rr = r2.uniform(0.5, 1)
            x, y = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr * 0.9
            R(x, y, x + 2, y, "LEAF_1")
            if r2.random() < 0.3:
                P(x + 1, y - 1, "LEAF_2")
    oak(352, 205, 16, 24, 3)
    L(354, 220, 356, 242, "INK"); L(355, 220, 357, 242, "LEAF_0")
    oak(486, 170, 26, 22, 4)
    oak(470, 222, 18, 10, 5)
    L(484, 186, 488, 242, "INK")
    # power poles and wires
    for px_, top in ((372, 178), (452, 182)):
        L(px_, top, px_, 242, "INK")
        L(px_ - 5, top + 3, px_ + 5, top + 3, "INK")
        P(px_ - 5, top + 2, "TERRA_0"); P(px_ + 5, top + 2, "TERRA_0")
    sag(gx0, 186, 367, 181, 2, "INK")
    sag(377, 181, 447, 185, 7, "INK")
    sag(367, 181, 447, 185, 9, "INK")
    sag(457, 185, gx1, 190, 4, "INK")
    sag(gx0, 214, gx1, 212, 3, "INK")  # streetcar wire
    # shotgun houses, front-gable silhouettes (slate)
    x = gx0 - 3
    while x < gx1:
        w = rng.randint(9, 13)
        h = rng.randint(12, 18)
        top = 242 - h
        POLY([(x, 242), (x, top + 4), (x + w // 2, top), (x + w, top + 4), (x + w, 242)], "SLATE_0", "INK")
        L(x + 1, top + 4, x + w // 2, top + 1, "TERRA_2")  # sun-lit roof edge
        if rng.random() < 0.6:
            P(x + w // 2, top + 8, "GLOW")
        if rng.random() < 0.5:
            R(x + 2, top + 10, x + 3, top + 12, "GOLD")
        R(x, 240, x + w, 242, "INK")
        x += w + rng.randint(1, 3)
    # streetcar (green, red trim) + rails
    BOX(420, 226, 452, 240, "LEAF_2", hi="LEAF_3", sh="LEAF_1")
    for xx in range(423, 450, 4):
        R(xx, 229, xx + 2, 231, "GLOW")
    L(421, 235, 451, 235, "CRT_0")
    L(436, 226, 442, 214, "INK")
    R(424, 240, 428, 241, "INK"); R(444, 240, 448, 241, "INK")
    L(gx0, 242, gx1, 242, "INK")
    # muntins + inner frame edges
    R(420, gy0, 421, gy1, "OAK_DK"); L(422, gy0, 422, gy1, "RIM")
    R(gx0, 196, gx1, 197, "OAK_DK"); L(gx0, 198, gx1, 198, "RIM")
    L(gx0 - 1, gy0, gx0 - 1, gy1, "OAK_0"); L(gx0, gy0 - 1, gx1, gy0 - 1, "OAK_0")
    # sill
    BOX(332, 243, 510, 249, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="t")
    R(334, 250, 508, 251, "INK")
    # candles: one lit per 7-day streak (3 lit)
    for i, x in enumerate(range(352, 400, 7)):
        BOX(x, 237, x + 3, 243, "CREAM", sh="OAK_2", ol="OAK_DK")
        P(x + 1, 236, "INK")
        if i < 3:
            P(x + 1, 234, "SUN"); P(x + 1, 235, "GLOW"); P(x + 2, 235, "RIM")
    # sill plants
    plant(410, 243, 5, rng, pot="SLATE_1")
    plant(342, 243, 4, rng, pot="TERRA_1")
    # curtain on the right, gathered (cool slate)
    POLY([(496, 145), (508, 145), (510, 250), (500, 250), (502, 200)], "SLATE_0", "INK")
    L(502, 147, 504, 248, "SLATE_1"); L(506, 147, 508, 248, "CHAR")
    L(497, 146, 501, 199, "RIM")
    R(336, 144, 512, 145, "INK")  # rod
    string_lights(334, 146, 512, 147, 9, step=8, seed=1)
    # relic niche above the window (arched, own ember light)
    niche(421, 127, niche_hot)


def niche(cx, top, hot):
    x0, x1, y1 = cx - 14, cx + 14, 146
    POLY([(x0, y1), (x0, top + 8), (cx, top), (x1, top + 8), (x1, y1)], "OAK_DK", "INK")
    inner = [(x0 + 3, y1 - 1), (x0 + 3, top + 9), (cx, top + 3), (x1 - 3, top + 9), (x1 - 3, y1 - 1)]
    POLY(inner, "VOID")
    L(x0, y1, x1, y1, "INK")
    if hot:
        # ember back-glow, 2-step band
        for y in range(top + 5, y1):
            for x in range(x0 + 4, x1 - 3):
                dd = ((x - cx) / 10) ** 2 + ((y - 139) / 9) ** 2
                if dd < 0.45:
                    P(x, y, "TERRA_0")
                elif dd < 1.0 and (x + y) % 2 == 0:
                    P(x, y, "TERRA_0")
    # finisher medal: striped ribbon + disc with swim / bike / run marks (original art)
    for i, c in enumerate(("CRT_0", "SLATE_2", "CREAM", "SLATE_2", "CRT_0")):
        L(cx - 6 + i, top + 6, cx - 2 + i // 2, top + 12, c)
        L(cx + 6 - i, top + 6, cx + 2 - i // 2, top + 12, c)
    body, edge, hi = ("ORANGE", "TERRA_0", "SUN") if hot else ("BROWN_1", "INK", "SLATE_0")
    circ(cx, top + 18, 6, edge)
    circ(cx, top + 18, 5, body)
    ring(cx, top + 18, 4, "GLOW" if hot else "CHAR")
    P(cx - 2, top + 15, hi); P(cx - 3, top + 16, hi)
    mk = "TERRA_0" if hot else "INK"
    P(cx - 3, top + 19, mk); P(cx - 2, top + 18, mk); P(cx - 1, top + 19, mk)  # wave
    P(cx, top + 18, mk); P(cx + 1, top + 19, mk)                               # wheel
    P(cx + 3, top + 17, mk); P(cx + 3, top + 18, mk); P(cx + 2, top + 20, mk); P(cx + 4, top + 20, mk)  # runner
    if hot:
        for x, y, c in ((cx - 5, top + 9, "GLOW"), (cx + 6, top + 6, "SUN"), (cx + 2, top + 3, "RIM"),
                        (cx - 8, top + 13, "RIM"), (cx + 9, top + 11, "GLOW")):
            P(x, y, c)
        L(x0 + 1, y1 - 1, x1 - 1, y1 - 1, "RIM")


def under_window(rng):
    # record crate + plants + radiator under the sill
    BOX(346, 280, 372, 300, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    for i, x in enumerate(range(348, 371, 2)):
        L(x, 272 + (i * 3) % 5, x, 281, ["INK", "CRT_0", "SLATE_1", "GOLD", "INK", "LEAF_2"][i % 6])
    BOX(394, 268, 438, 298, "SLATE_0", hi="SLATE_1", sh="INK")
    for x in range(397, 436, 3):
        L(x, 270, x, 296, "SLATE_1" if x % 2 else "CHAR")
    L(394, 269, 394, 297, "RIM")
    # things on the radiator: boxed camera, books, mug
    BOX(398, 262, 410, 268, "CREAM", sh="OAK_2")
    BOX(412, 263, 420, 268, "INK", hi="SLATE_0"); circ(416, 265, 1, "SLATE_2")
    books(424, 437, 267, 7, rng, flat_ok=False)
    plant(382, 300, 8, rng, pot="TERRA_1", tall=1.6)
    plant(442, 300, 5, rng, pot="SLATE_1")


def crt_stack(rng):
    # stand: amp + deck, big CRT (Today), small CRT on a speaker (score)
    gear(440, 282, 486, 300, rng, face="CHAR")
    gear(442, 274, 484, 282, rng, face="INK")
    crt(444, 242, 484, 274, "red")
    speaker(488, 276, 506, 300)
    crt(486, 256, 508, 276, "cyan")
    plant(497, 256, 4, rng, pot="OAK_1")  # tiny succulent on the small CRT
    BOX(452, 238, 468, 242, "CREAM", sh="OAK_2")  # box on top of the CRT
    L(446, 238, 446, 242, "SLATE_2"); P(446, 237, "SLATE_2")  # antenna


# ---------------------------------------------------------------- statue
def build_statue(cone):
    w, h = 64, 150
    m = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(m)

    def cap(pts):
        for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
            for i in range(n + 1):
                t = i / n
                x, y, r = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t
                md.ellipse([x - r, y - r, x + r, y + r], fill=255)

    md.ellipse([25, 0, 39, 18], fill=255)                 # head
    md.rectangle([29, 14, 35, 23], fill=255)              # neck
    md.polygon([(29, 19), (35, 19), (44, 25), (20, 25)], fill=255)
    md.polygon([(20, 25), (44, 25), (48, 32), (45, 44), (42, 58), (41, 66), (43, 74), (42, 80),
                (32, 84), (22, 80), (21, 74), (23, 66), (22, 58), (19, 44), (16, 32)], fill=255)
    cap([(18, 30, 4.5), (16, 32, 4.5), (12, 52, 3.4), (11, 74, 2.4)])     # left arm
    cap([(46, 30, 4.5), (48, 32, 4.5), (52, 52, 3.4), (53, 74, 2.4)])     # right arm
    md.ellipse([8, 73, 14, 88], fill=255)                               # open hands
    md.ellipse([50, 73, 56, 88], fill=255)
    cap([(26, 80, 6), (24, 96, 5.2), (23, 110, 3.8), (21, 121, 4.0), (20, 140, 2.4)])  # legs
    cap([(38, 80, 6), (40, 96, 5.2), (41, 110, 3.8), (43, 121, 4.0), (44, 140, 2.4)])
    md.polygon([(17, 141), (23, 141), (24, 148), (14, 148)], fill=255)  # feet, shoulder width
    md.polygon([(41, 141), (47, 141), (50, 148), (40, 148)], fill=255)
    M = np.array(m) > 0
    M[:, 31:34] &= ~((np.arange(h)[:, None] > 88) & (np.arange(h)[:, None] < 149))  # leg gap

    def inside(x, y):
        return 0 <= x < w and 0 <= y < h and M[y, x]

    px = {}
    # depth from edge (4-neighbour)
    D = np.zeros((h, w), int)
    cur = M.copy()
    for k in range(1, 5):
        er = cur.copy()
        er[1:, :] &= cur[:-1, :]; er[:-1, :] &= cur[1:, :]
        er[:, 1:] &= cur[:, :-1]; er[:, :-1] &= cur[:, 1:]
        D[cur & ~er] = k
        cur = er
    D[cur] = 5
    for y in range(h):
        for x in range(w):
            if not M[y, x]:
                continue
            d = D[y, x]
            c = "STAT_1"
            up, dn = not inside(x, y - 1), not inside(x, y + 1)
            lf, rt = not inside(x - 1, y), not inside(x + 1, y)
            outer_l = (x < 18 and 26 <= y <= 60) or (86 <= y <= 122 and x < 25) or y < 18 or (y < 34 and x < 20)
            outer_r = (x > 45 and 26 <= y <= 50) or (86 <= y <= 112 and x > 38) or y < 18 or (y < 34 and x > 44)
            if d == 1:
                if up and y < 34:
                    c = "STAT_HI"
                elif dn:
                    c = "INK"
                elif lf:
                    c = "STAT_HI" if outer_l else ("INK" if (20 <= x <= 44 and y > 86) or (15 <= x <= 22 and 30 < y < 76) else "STAT_2")
                elif rt:
                    c = "STAT_HI" if outer_r else ("INK" if (y > 86 and 20 <= x <= 44) or (x < 20 and 34 < y < 74) else "STAT_2")
                if c == "STAT_HI" and y > 76 and y < 89 and (x < 15 or x > 49):
                    c = "STAT_2"  # hands stay soft
                if c == "STAT_HI" and y > 140:
                    c = "STAT_2"
            elif d == 2:
                if not inside(x, y - 2) and y < 32:
                    c = "STAT_2"
            px[(x, y)] = c
    # anatomy (flat clusters)
    def s(x, y, c):
        if inside(x, y) and D[y, x] >= 2:
            px[(x, y)] = c
    for x in range(21, 31):
        s(x, 36 + (1 if x in (21, 22, 30) else 0), "INK")
        s(64 - x, 36 + (1 if x in (21, 22, 30) else 0), "INK")
    for x in range(24, 29):
        s(x, 29, "STAT_2"); s(x, 30, "STAT_2"); s(64 - x, 29, "STAT_2"); s(64 - x, 30, "STAT_2")
    for y in range(31, 66):
        s(32, y, "INK")
    for y in (46, 53, 60):
        for x in (29, 30, 31, 33, 34, 35):
            s(x, y, "INK")
    for y in (42, 49, 56):
        for x in (29, 35):
            s(x, y, "STAT_2"); s(x, y + 1, "STAT_2")
    s(32, 64, "VOID")
    for i in range(9):
        s(24 + i * 6 // 8, 67 + i, "INK"); s(40 - i * 6 // 8, 67 + i, "INK")
    for y in range(79, 88):
        for x in (31, 32, 33):
            s(x, y, "INK")
    for y in range(89, 104):
        s(26 - (y - 89) // 8, y, "STAT_2"); s(38 + (y - 89) // 8, y, "STAT_2")
    for x, y in ((23, 109), (24, 109), (40, 109), (41, 109)):
        s(x, y, "STAT_2")
    for y in range(115, 137):
        t = (y - 115) / 22
        s(round(23 - 2 * t), y, "STAT_2"); s(round(41 + 2 * t), y, "STAT_2")
    for y in range(36, 70):
        t = (y - 36) / 34
        s(round(14.5 - 2 * t), y, "STAT_2"); s(round(49.5 + 2 * t), y, "STAT_2")
    for x, y in ((25, 24), (26, 24), (27, 25), (28, 25), (36, 25), (37, 25), (38, 24), (39, 24)):
        s(x, y, "STAT_2")
    s(20, 30, "INK"); s(20, 31, "INK"); s(44, 30, "INK"); s(44, 31, "INK")
    # head: glossy spec, calm featureless face
    for x, y in ((29, 3), (30, 3), (29, 4), (30, 2)):
        px[(x, y)] = "STAT_HI"
    for x, y in ((35, 3), (36, 4)):
        s(x, y, "STAT_2")
    for x in (28, 29, 30, 34, 35, 36):
        s(x, 8, "INK")
    for y in (9, 10, 11):
        s(32, y, "STAT_2")
    s(32, 15, "STAT_2")
    for x in range(30, 35):
        if inside(x, 18):
            px[(x, 18)] = "INK"
    for x in (10, 12, 52, 54):
        for y in (84, 85, 86):
            s(x, y, "INK")
    if cone:
        for (x, y), c in list(px.items()):
            if y < 34 and not inside(x, y - 2):
                px[(x, y)] = "STAT_HI" if not inside(x, y - 1) else "STAT_2"
    # kintsugi, tier III: medium branching network (1 px gold, brighter junctions)
    rng = random.Random(303)
    gold = set()
    junc = set()

    def walk(x, y, n, dx_bias, depth=0):
        for i in range(n):
            if not (inside(x, y) and D[y, x] >= 2):
                return
            gold.add((x, y))
            r = rng.random()
            if r < 0.22 + dx_bias:
                x += 1
                if rng.random() < 0.5:
                    continue
            elif r < 0.44:
                x -= 1
                if rng.random() < 0.5:
                    continue
            y += 1
            if depth < 2 and i > 2 and rng.random() < 0.10:
                junc.add((x, y))
                walk(x, y, rng.randint(4, 10), rng.choice([-0.3, 0.3]), depth + 1)

    for sx, sy, n, b in ((33, 4, 12, 0.05), (22, 27, 16, 0.15), (40, 30, 22, -0.1), (27, 42, 24, 0.1),
                         (13, 40, 22, -0.05), (52, 44, 18, 0.0), (37, 64, 30, 0.05), (24, 92, 26, -0.05),
                         (40, 112, 18, 0.0)):
        junc.add((sx, sy))
        walk(sx, sy, n, b)
    for g in gold:
        px[g] = "GOLD"
    for j in junc:
        if j in gold:
            px[j] = "SUN"
    # outline: dark against the wall, warm on the window-facing right arm
    out = {}
    for (x, y) in list(px):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if q not in px:
                warm = dx == 1 and x >= 52 and 30 <= y <= 74
                out[q] = "RIM" if warm else ("TERRA_1" if dx == 1 and x >= 44 and 90 <= y <= 138 else "VOID")
    px.update(out)
    return px


def statue(cone):
    ox, oy = 271, 135
    for (x, y), c in build_statue(cone).items():
        P(ox + x, oy + y, c)
    # pedestal + plaque
    BOX(272, 284, 334, 288, "BROWN_1", hi="SLATE_0", sh="INK")
    BOX(275, 288, 331, 300, "CHAR", hi="BROWN_1", sh="INK")
    L(331, 289, 331, 299, "RIM")
    BOX(285, 290, 321, 298, "GOLD_DK", ol="INK")
    x = 288
    for _ in range(3):
        L(x, 292, x, 296, "GOLD"); x += 2
    P(x + 1, 294, "GOLD")
    text(x + 4, 292, "FORGED", "GOLD")


# ---------------------------------------------------------------- library (back wall left)
def library(rng):
    # tall bookcase
    BOX(174, 158, 226, 300, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    R(178, 162, 222, 292, "INK")
    L(175, 159, 175, 299, "OAK_1")
    shelves = [162, 184, 206, 228, 250, 272, 292]
    for i in range(len(shelves) - 1):
        y0, y1 = shelves[i], shelves[i + 1]
        R(178, y1 - 1, 222, y1, "OAK_1"); L(178, y1, 222, y1, "OAK_DK")
        x = 178
        k = i % 3
        if k == 0:
            x = books(178, 206, y1 - 2, 17, rng)
            plant(215, y1 - 2, 5, rng, pot="CREAM")
        elif k == 1:
            circ(184, y1 - 8, 5, "SLATE_1"); R(181, y1 - 10, 184, y1 - 8, "LEAF_2"); P(183, y1 - 5, "LEAF_2")
            L(184, y1 - 3, 184, y1 - 2, "INK")
            books(192, 222, y1 - 2, 17, rng)
        else:
            books(178, 204, y1 - 2, 16, rng)
            BOX(206, y1 - 10, 221, y1 - 2, "OAK_2", hi="GLOW", sh="OAK_1")
            L(206, y1 - 6, 221, y1 - 6, "OAK_1")
    R(178, 293, 222, 299, "OAK_0"); L(186, 296, 190, 296, "GOLD_DK"); L(208, 296, 212, 296, "GOLD_DK")
    # stacked on top of the bookcase, up to the ceiling
    BOX(176, 146, 194, 158, "OAK_2", hi="GLOW", sh="OAK_1")
    BOX(179, 138, 191, 146, "CREAM", sh="OAK_2")
    BOX(196, 150, 208, 158, "SLATE_1", hi="SLATE_2", sh="SLATE_0")
    plant(218, 158, 6, rng, pot="TERRA_1")
    vine(214, 158, 26, rng); vine(220, 158, 40, rng); vine(223, 157, 18, rng)
    # potion shelf: all 15 skill bottles (the archive)
    bcols = ["CRT_1", "GLOW", "LEAF_3", "SLATE_2", "PLUM_3", "GOLD", "SLATE_1", "ORANGE",
             "LEAF_2", "CREAM", "TERRA_2", "SUN", "CRT_0", "SLATE_2", "RIM"]
    for row, yb in enumerate((160, 174, 188)):
        R(229, yb + 1, 265, yb + 2, "OAK_1"); L(229, yb + 3, 265, yb + 3, "OAK_DK")
        P(231, yb + 4, "INK"); P(263, yb + 4, "INK")
        for j in range(5):
            c = bcols[row * 5 + j]
            x = 231 + j * 7
            BOX(x, yb - 6, x + 4, yb, c)
            P(x + 1, yb - 5, "CREAM" if c not in ("CREAM", "SUN") else "SLATE_2")
            R(x + 1, yb - 9, x + 3, yb - 7, "INK"); P(x + 2, yb - 8, "OAK_2")
    # trophy case (lit glass) with gold relics
    BOX(228, 194, 266, 300, "OAK_DK", hi="OAK_0", rim="r")
    R(231, 197, 263, 276, "SLATE_0")
    L(231, 197, 263, 197, "GLOW")
    for y in (218, 238, 258):
        L(231, y, 263, y, "SLATE_2"); L(231, y + 1, 263, y + 1, "CHAR")
    items = [(236, 216, "cup"), (248, 216, "medal"), (257, 216, "book"),
             (237, 236, "scroll"), (249, 236, "key"), (258, 236, "cup"),
             (238, 256, "bar"), (252, 256, "medal")]
    for x, yb, kind in items:
        if kind == "cup":
            R(x - 2, yb - 7, x + 2, yb - 4, "GOLD"); P(x - 3, yb - 6, "GOLD"); P(x + 3, yb - 6, "GOLD")
            L(x, yb - 3, x, yb - 1, "GOLD_DK"); L(x - 2, yb, x + 2, yb, "GOLD"); P(x - 1, yb - 7, "SUN")
        elif kind == "medal":
            L(x - 2, yb - 9, x, yb - 5, "CRT_0"); L(x + 2, yb - 9, x, yb - 5, "SLATE_2")
            circ(x, yb - 3, 2, "GOLD"); P(x - 1, yb - 4, "SUN")
        elif kind == "book":
            for i in range(3):
                R(x - 3 + i, yb - 2 - 2 * i, x + 2 - i, yb - 1 - 2 * i, "GOLD" if i % 2 else "GOLD_DK")
        elif kind == "scroll":
            R(x - 3, yb - 4, x + 3, yb - 2, "GOLD"); P(x - 4, yb - 3, "GOLD_DK"); P(x + 4, yb - 3, "GOLD_DK")
            P(x, yb - 3, "CRT_0")
        elif kind == "key":
            ring(x - 2, yb - 4, 2, "GOLD"); L(x, yb - 4, x + 4, yb - 4, "GOLD"); P(x + 4, yb - 3, "GOLD")
        elif kind == "bar":
            POLY([(x - 4, yb), (x + 4, yb), (x + 3, yb - 3), (x - 3, yb - 3)], "GOLD", "GOLD_DK")
            P(x - 2, yb - 2, "SUN")
    L(234, 200, 240, 212, "SLATE_2"); L(236, 200, 244, 214, "SLATE_2")  # glass glint
    BOX(230, 278, 264, 299, "OAK_0", hi="OAK_1", sh="OAK_DK")
    L(247, 279, 247, 298, "OAK_DK"); P(244, 288, "GOLD"); P(250, 288, "GOLD")
    # snake plant in the gap before the statue
    snake_plant(268, 300, 24, rng)
    # wall clock above potions
    circ(247, 137, 6, "INK"); circ(247, 137, 5, "CREAM"); L(247, 137, 247, 134, "INK"); L(247, 137, 249, 138, "INK")
    # reading chair (warm) with blanket (cool)
    BOX(180, 274, 214, 300, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    BOX(178, 288, 186, 312, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    BOX(208, 288, 216, 312, "TERRA_1", hi="TERRA_2", sh="TERRA_0", rim="r")
    BOX(185, 298, 209, 310, "TERRA_2", hi="RIM", sh="TERRA_1")
    POLY([(186, 276), (198, 276), (196, 300), (188, 304)], "LEAF_2", "INK")
    L(188, 278, 194, 278, "LEAF_3"); L(190, 284, 190, 300, "LEAF_1")
    R(180, 312, 182, 316, "INK"); R(212, 312, 214, 316, "INK")
    # floor lamp (warm)
    L(222, 240, 222, 314, "INK"); R(218, 314, 226, 316, "INK")
    POLY([(216, 238), (228, 238), (226, 228), (218, 228)], "GLOW", "INK")
    L(217, 237, 227, 237, "SUN"); L(219, 229, 225, 229, "CREAM")
    # chess table
    BOX(232, 302, 260, 306, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="r")
    for i in range(12):
        P(234 + i * 2, 301, "CREAM" if i % 2 else "INK"); P(235 + i * 2, 300, "INK" if i % 2 else "CREAM")
    for x, c in ((236, "CREAM"), (240, "CREAM"), (250, "INK"), (255, "INK"), (245, "CREAM")):
        L(x, 297, x, 299, c)
    L(246, 307, 246, 318, "OAK_DK"); R(241, 318, 251, 320, "INK")
    # finished-books stack by the chair (growth piece)
    yy = 316
    for i, c in enumerate(["SLATE_1", "TERRA_2", "LEAF_2", "GOLD_DK", "CREAM", "CRT_0"]):
        R(166 + i % 2, yy - 2, 176 - (i % 3), yy - 1, c)
        L(166 + i % 2, yy - 2, 176 - (i % 3), yy - 2, LIGHT.get(c, c))
        yy -= 2
    # framed print above the bookcase
    frame(232, 126, 262, 132, "SLATE_1")


# ---------------------------------------------------------------- study desk (back wall right)
def desk_zone(rng):
    # wall shelf
    R(512, 150, 626, 151, "OAK_1"); L(512, 152, 626, 152, "OAK_DK")
    P(516, 153, "INK"); P(620, 153, "INK")
    books(514, 538, 149, 10, rng, flat_ok=False)
    plant(546, 149, 5, rng, pot="TERRA_1"); vine(548, 151, 22, rng)
    BOX(554, 143, 560, 149, "CREAM"); P(556, 145, "OAK_1")
    speaker(564, 138, 576, 149)
    BOX(580, 142, 588, 149, "SLATE_1", hi="SLATE_2"); P(582, 144, "CRT_1"); P(586, 144, "CRT_1")
    plant(598, 149, 4, rng, pot="SLATE_0"); vine(600, 151, 16, rng)
    BOX(608, 140, 624, 149, "OAK_2", hi="GLOW", sh="OAK_1")
    # pennant (original Tulane-green / sky-blue design) and the empty photo frame
    L(515, 156, 515, 176, "INK")
    POLY([(516, 157), (550, 165), (516, 173)], "LEAF_2", "INK")
    R(516, 158, 519, 172, "SLATE_2")
    for x in range(524, 536):
        P(x, 164 + (1 if (x // 2) % 2 else 0), "CREAM")
    BOX(556, 156, 578, 178, "OAK_1", hi="OAK_2", sh="OAK_DK")
    R(558, 158, 576, 176, "SLATE_0"); P(559, 159, "SLATE_1")
    # corkboard (class schedule) and wall calendar
    BOX(512, 184, 562, 224, "OAK_1", hi="OAK_2", sh="OAK_DK", rim="l")
    R(514, 186, 560, 222, "OAK_2")
    R(517, 189, 535, 207, "CREAM")
    for y in range(192, 206, 3):
        L(519, y, 533, y, "SLATE_1")
    for x in range(522, 534, 4):
        L(x, 190, x, 206, "SLATE_0")
    P(526, 188, "CRT_1")
    for x, y, c in ((540, 190, "LEAF_3"), (549, 192, "PLUM_3"), (539, 204, "SLATE_2"), (551, 206, "GOLD"),
                    (520, 211, "CRT_1"), (530, 212, "CREAM")):
        R(x, y, x + 6, y + 6, c); P(x + 3, y, "CRT_1")
    BOX(566, 184, 592, 216, "CREAM", ol="INK")
    R(567, 185, 591, 189, "CRT_0")
    for y in range(192, 215, 4):
        L(568, y, 590, y, "OAK_2")
    for x in range(571, 590, 4):
        L(x, 191, x, 214, "OAK_2")
    for x, y in ((569, 193), (573, 197), (581, 201), (585, 205)):
        P(x, y, "CRT_1"); P(x + 1, y + 1, "CRT_1")
    circ(606, 198, 7, "INK"); circ(606, 198, 6, "CREAM"); L(606, 198, 606, 194, "INK"); L(606, 198, 609, 199, "INK")
    for x, y, c in ((596, 210, "GOLD"), (603, 214, "LEAF_3"), (612, 208, "PLUM_3")):
        R(x, y, x + 4, y + 4, c)
    # the desk
    R(508, 264, 628, 266, "OAK_1"); L(508, 263, 628, 263, "OAK_2"); L(508, 263, 508, 266, "RIM")
    R(508, 267, 628, 269, "OAK_0"); L(508, 270, 628, 270, "INK")
    R(511, 270, 513, 300, "OAK_DK")
    BOX(598, 270, 626, 300, "OAK_0", hi="OAK_1", sh="OAK_DK")
    for y in (279, 289):
        L(599, y, 625, y, "OAK_DK"); L(610, y - 4, 614, y - 4, "GOLD_DK")
    L(610, 294, 614, 294, "GOLD_DK")
    # desk lamp (off until Academics opens)
    R(516, 260, 524, 262, "INK"); L(520, 260, 526, 246, "INK"); L(526, 246, 536, 250, "INK")
    POLY([(532, 247), (540, 250), (538, 255), (531, 252)], "TERRA_1", "INK")
    # course books: one per class, grade dot, red bookmark for due-in-48h
    yy = 262
    for i, (c, dot, wd) in enumerate((("LEAF_2", "LEAF_3", 22), ("SLATE_1", "GOLD", 20),
                                       ("TERRA_2", "LEAF_3", 21), ("GOLD_DK", "CRT_1", 19), ("PLUM_3", "LEAF_3", 18))):
        x0 = 578 + (i % 2)
        BOX(x0, yy - 3, x0 + wd, yy, c, hi=LIGHT.get(c), ol="INK")
        P(x0 + wd - 3, yy - 1, dot)
        if i == 3:
            R(x0 + wd + 1, yy - 2, x0 + wd + 2, yy + 1, "CRT_1")
        yy -= 3
    # planner, pencil cup, mug, headphones
    R(542, 260, 560, 262, "CREAM"); L(551, 260, 551, 262, "OAK_2"); L(544, 261, 549, 261, "SLATE_1")
    BOX(562, 255, 567, 262, "SLATE_1"); P(563, 253, "GOLD"); P(565, 252, "CRT_0"); P(564, 254, "LEAF_3")
    BOX(569, 257, 574, 262, "CREAM"); P(575, 259, "CREAM"); P(571, 255, "SLATE_2")
    sag(528, 262, 538, 262, -6, "INK")
    # backpack, chair with jacket, trash can, floor plant
    BOX(514, 282, 534, 306, "SLATE_1", hi="SLATE_2", sh="SLATE_0", rim="l")
    BOX(517, 292, 531, 304, "SLATE_0", hi="SLATE_1"); L(518, 292, 530, 292, "TERRA_2")
    sag(518, 283, 530, 283, -6, "INK")
    BOX(550, 252, 580, 284, "BROWN_1", hi="SLATE_0", sh="INK", rim="l")
    POLY([(550, 254), (562, 254), (560, 290), (552, 292)], "LEAF_1", "INK")
    L(552, 256, 558, 256, "LEAF_2"); L(553, 262, 553, 288, "LEAF_0")
    BOX(548, 284, 584, 290, "BROWN_1", hi="SLATE_0")
    L(566, 291, 566, 302, "INK"); L(552, 304, 580, 304, "INK"); P(552, 305, "SLATE_0"); P(580, 305, "SLATE_0")
    BOX(588, 292, 598, 306, "SLATE_0", hi="SLATE_1"); P(590, 291, "CREAM"); P(593, 290, "CREAM")
    plant(616, 306, 9, rng, pot="TERRA_1", tall=1.8)


# ---------------------------------------------------------------- left sliver: door, kitchen, bed
def left_zone(rng):
    # far-left overscan: fridge + shelves (seen in zone zoom)
    POLY(wq("L", 10, 62, 0, 0.58), "SLATE_2", "INK")
    POLY(wq("L", 12, 60, 0.30, 0.31), "INK")
    L(56, lw(56, 0.4), 56, lw(56, 0.5), "INK")
    POLY(wq("L", 0, 70, 0.72, 0.74), "OAK_1", "INK")
    for x in range(4, 66, 7):
        y = lw(x, 0.74)
        BOX(x, y - 8, x + 4, y, rng.choice(["CREAM", "GOLD", "TERRA_2", "SLATE_1"]))
    # door with event-flyer board
    POLY(wq("L", 82, 111, 0, 0.6), "OAK_DK", "INK")
    POLY(wq("L", 85, 108, 0.0, 0.57), "OAK_0", "INK")
    POLY(wq("L", 88, 105, 0.06, 0.3), "OAK_DK")
    POLY(wq("L", 89, 104, 0.07, 0.29), "OAK_0")
    POLY(wq("L", 88, 105, 0.36, 0.52), "OAK_2", "INK")
    for x, f, c in ((90, 0.5, "CREAM"), (96, 0.49, "LEAF_3"), (100, 0.47, "CRT_1"), (91, 0.43, "SLATE_2"),
                    (98, 0.42, "GLOW"), (92, 0.39, "PLUM_3")):
        y = lw(x, f)
        R(x, y, x + 4, y + 6, c); P(x + 2, y, "CRT_0")
    circ(105, lw(105, 0.28), 1, "GOLD")
    L(108, lw(108, 0.57), 108, lw(108, 0.0), "RIM")
    # relic mount by the door (empty: subtle plus)
    POLY(wq("L", 113, 125, 0.43, 0.5), "OAK_1", "INK")
    cy = int(lw(119, 0.465)); L(117, cy, 121, cy, "SLATE_1"); L(119, cy - 2, 119, cy + 2, "SLATE_1")
    # switchboard
    POLY(wq("L", 113, 120, 0.3, 0.36), "CREAM", "INK")
    for i, c in enumerate(("LEAF_3", "CRT_1", "GLOW")):
        P(115 + i * 2, lw(115 + i * 2, 0.335), c)
    # kitchen: uppers, counter, lowers
    POLY(wq("L", 124, 156, 0.6, 0.82), "OAK_0", "INK")
    L(140, lw(140, 0.6), 140, lw(140, 0.82), "OAK_DK")
    P(137, lw(137, 0.66), "GOLD"); P(143, lw(143, 0.66), "GOLD")
    POLY(wq("L", 124, 156, 0.0, 0.23), "OAK_1", "INK")
    L(140, lw(140, 0.0), 140, lw(140, 0.23), "OAK_DK")
    POLY(wq("L", 122, 158, 0.23, 0.26), "SLATE_0", "INK")
    L(122, lw(122, 0.26), 158, lw(158, 0.26), "SLATE_1")
    POLY(wq("L", 124, 156, 0.45, 0.47), "OAK_1", "INK")
    for x, c in ((126, "CREAM"), (131, "GOLD"), (136, "TERRA_2"), (142, "LEAF_2"), (148, "CREAM")):
        y = lw(x, 0.47)
        BOX(x, y - 6, x + 4, y, c); P(x + 1, y - 7, "INK")
    for x in (128, 132, 136):
        L(x, lw(x, 0.44), x, lw(x, 0.38), "SLATE_0")
    y = lw(127, 0.26)
    ELL(124, y - 6, 136, y, "OAK_2", "INK")       # fruit basket
    for x, c in ((126, "CRT_1"), (129, "ORANGE"), (132, "LEAF_3"), (134, "GOLD")):
        circ(x, y - 7, 1, c)
    y = lw(142, 0.26)
    BOX(140, y - 12, 147, y, "SLATE_2", ol="INK")  # water jug, half full (growth piece)
    R(141, y - 5, 146, y - 1, "SLATE_1"); R(142, y - 14, 145, y - 12, "INK")
    y = lw(152, 0.26)
    BOX(150, y - 7, 156, y, "INK", hi="SLATE_0"); L(156, y - 5, 158, y - 6, "INK")  # kettle
    # AC unit up high
    POLY(wq("L", 120, 156, 0.86, 0.94), "CREAM", "INK")
    for f in (0.875, 0.895):
        L(122, lw(122, f), 154, lw(154, f), "SLATE_1")
    P(152, lw(152, 0.92), "LEAF_3")
    # bed (long side on the wall, foot toward the viewer)
    BOX(146, 268, 178, 286, "OAK_DK", hi="OAK_0")                 # headboard at the back wall
    BOX(150, 278, 162, 286, "CREAM", sh="OAK_2"); BOX(162, 279, 174, 287, "CREAM", sh="OAK_2")
    POLY([(140, 286), (178, 286), (180, 304), (136, 304)], "SLATE_1", "INK")
    L(142, 288, 176, 288, "SLATE_2"); L(150, 292, 166, 300, "SLATE_0"); L(158, 290, 172, 296, "SLATE_0")
    POLY([(138, 296), (152, 294), (156, 304), (140, 306)], "TERRA_2", "INK")  # rumpled throw
    BOX(134, 304, 182, 316, "OAK_0", hi="OAK_1", sh="OAK_DK", rim="r")
    R(136, 316, 138, 320, "INK"); R(178, 316, 180, 320, "INK")
    # nightstand shelf on the wall: alarm clock, plasma globe, lamp, paper-star jar
    POLY(wq("L", 140, 170, 0.36, 0.38), "OAK_1", "INK")
    y = lw(144, 0.38)
    BOX(141, y - 6, 151, y, "INK"); text(142, y - 5, "11", "CRT_1")
    y = lw(156, 0.38)
    R(153, y - 2, 159, y, "INK"); circ(156, y - 7, 4, "VOID"); ring(156, y - 7, 4, "SLATE_1")
    L(156, y - 7, 153, y - 10, "PLUM_3"); L(156, y - 7, 159, y - 9, "PLUM_3"); L(156, y - 7, 158, y - 4, "CREAM")
    P(156, y - 7, "CREAM")
    y = lw(165, 0.38)
    BOX(162, y - 7, 168, y, "SLATE_2", ol="INK")
    for p in ((163, -5, "GOLD"), (165, -3, "SUN"), (166, -6, "GLOW"), (164, -2, "GOLD")):
        P(p[0], y + p[1], p[2])
    # poster + string lights over the bed
    POLY(wq("L", 140, 166, 0.5, 0.68), "TERRA_1", "INK")
    POLY(wq("L", 143, 163, 0.53, 0.65), "ORANGE")
    circ(153, lw(153, 0.6), 3, "SUN")
    L(143, lw(143, 0.56), 163, lw(163, 0.56), "TERRA_0")
    string_lights(124, lw(124, 0.74), 170, lw(170, 0.72), 6, step=6, seed=2)
    # big leafy plant (gut health) + doormat with review letter + meditation cushion
    BOX(120, 318, 134, 334, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    for i in range(14):
        a = math.pi * (1.1 + 0.8 * i / 13)
        x, y = 127 + math.cos(a) * 16, 314 + math.sin(a) * 22
        POLY([(127, 318), (x - 3, y), (x + 3, y - 2)], "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0")
        P(x, y - 1, "LEAF_3")
    POLY([(104, 328), (122, 322), (128, 330), (108, 336)], "TERRA_0", "INK")
    R(110, 327, 115, 330, "CREAM"); L(110, 327, 112, 329, "OAK_2"); L(115, 327, 113, 329, "OAK_2")
    ELL(144, 320, 166, 330, "SLATE_0", "INK"); ELL(146, 320, 164, 326, "SLATE_1"); P(155, 323, "SLATE_2")
    R(160, 324, 164, 326, "OAK_2")  # slippers


# ---------------------------------------------------------------- right sliver: computer, gym
def right_zone(rng):
    # product whiteboard
    POLY(wq("R", 636, 666, 0.48, 0.66), "CREAM", "INK")
    POLY(wq("R", 636, 666, 0.48, 0.495), "SLATE_0")
    for x0, x1, f, c in ((639, 650, 0.62, "CRT_0"), (652, 662, 0.6, "SLATE_1"), (640, 648, 0.55, "LEAF_2"),
                         (650, 663, 0.53, "SLATE_1")):
        L(x0, rw(x0, f), x1, rw(x1, f), c)
    text(641, int(rw(641, 0.6)), "$", "LEAF_2")
    # relic bracket by the gym (empty, subtle plus)
    POLY(wq("R", 668, 682, 0.5, 0.56), "INK")
    POLY(wq("R", 669, 681, 0.505, 0.555), "BROWN_1")
    cy = int(rw(675, 0.53)); L(673, cy, 677, cy, "SLATE_1"); L(675, cy - 2, 675, cy + 2, "SLATE_1")
    # medal wall (growth piece), race bib, mileage poster
    POLY(wq("R", 686, 718, 0.66, 0.68), "OAK_1", "INK")
    for i, x in enumerate(range(688, 718, 6)):
        y = rw(x, 0.66)
        L(x, y, x + 2, y + 8, ["CRT_0", "SLATE_2", "LEAF_2", "GOLD"][i % 4])
        circ(x + 2, y + 10, 2, ["GOLD", "SLATE_2", "OAK_2", "GOLD", "GOLD"][i])
        P(x + 1, y + 9, "SUN")
    POLY(wq("R", 700, 718, 0.74, 0.92), "CREAM", "INK")
    for i in range(5):
        x = 702 + i * 3
        P(x, rw(x, 0.78 + 0.025 * i), "CRT_0"); P(x + 1, rw(x + 1, 0.79 + 0.025 * i), "CRT_0")
    POLY(wq("R", 676, 690, 0.4, 0.46), "CREAM", "INK")
    text(678, int(rw(678, 0.455)), "42", "INK")
    # computer desk (turned toward the viewer)
    POLY(wq("R", 628, 676, 0.2, 0.225), "OAK_1", "INK")
    L(628, rw(628, 0.225), 676, rw(676, 0.225), "OAK_2")
    L(632, rw(632, 0.2), 632, rw(632, 0), "OAK_DK"); L(672, rw(672, 0.2), 672, rw(672, 0), "OAK_DK")
    # monitors (cyan), keyboard, clutter
    BOX(632, 236, 650, 258, "INK", rim="l"); R(634, 238, 648, 254, "SLATE_1")
    for i, y in enumerate(range(240, 253, 2)):
        L(636 + (i % 3) * 2, y, 640 + (i * 5) % 8, y, "SLATE_2")
    P(641, 252, "CREAM")
    L(641, 259, 641, 266, "INK")
    BOX(648, 230, 672, 260, "INK"); R(650, 232, 670, 256, "SLATE_1")
    for i, hgt in enumerate((6, 10, 8, 14, 12)):
        R(653 + i * 3, 254 - hgt, 654 + i * 3, 254, "LEAF_3")
    L(652, 236, 668, 242, "GLOW")
    L(660, 261, 660, 266, "INK"); R(655, 266, 665, 267, "INK")
    R(636, 268, 660, 270, "INK"); L(637, 268, 659, 268, "SLATE_0")
    BOX(664, 262, 669, 269, "CRT_0"); P(665, 263, "CREAM")
    R(633, 233, 637, 236, "GOLD"); R(667, 227, 670, 230, "LEAF_3")
    # money tree (growth piece)
    BOX(673, 262, 679, 270, "CREAM", sh="OAK_2"); L(676, 262, 676, 252, "OAK_2"); L(675, 258, 677, 254, "OAK_1")
    for x, y in ((672, 250), (676, 247), (680, 250), (674, 253), (679, 254)):
        leaf(x, y, rng)
    # PC tower with LEDs
    BOX(648, 282, 664, 312, "INK", hi="SLATE_0")
    for y, c in ((286, "SLATE_2"), (290, "CRT_1"), (294, "LEAF_3")):
        L(651, y, 660, y, c)
    # weight rack (gym)
    for x in (684, 712):
        R(x, 214, x + 2, 334, "INK"); L(x + 1, 214, x + 1, 334, "SLATE_0")
    R(684, 214, 714, 216, "INK")
    R(678, 252, 720, 253, "SLATE_2")
    for x, c in ((678, "CRT_0"), (681, "INK"), (716, "CRT_0")):
        BOX(x, 240, x + 3, 266, c, hi=LIGHT.get(c, "SLATE_0"))
    for i, (y, c) in enumerate(((306, "CRT_0"), (311, "SLATE_1"), (316, "LEAF_2"), (321, "INK"))):
        BOX(692, y, 708, y + 4, c, hi=LIGHT.get(c, "SLATE_0"))
    # bike under a half-draped tarp (dormant triathlon), wheels showing
    for wx in (684, 714):
        circ(wx, 326, 11, "INK"); circ(wx, 326, 9, "CHAR"); ring(wx, 326, 9, "SLATE_0")
        for a in range(0, 180, 45):
            dx, dy = math.cos(math.radians(a)) * 8, math.sin(math.radians(a)) * 8
            L(wx - dx, 326 - dy, wx + dx, 326 + dy, "SLATE_1")
        circ(wx, 326, 1, "SLATE_2")
    L(684, 326, 698, 312, "CRT_0"); L(698, 312, 714, 326, "CRT_0"); L(684, 326, 700, 326, "CRT_0")
    BOX(694, 318, 702, 323, "CREAM")
    P(696, 320, "SLATE_1"); P(698, 321, "INK"); P(700, 320, "CRT_0")
    POLY([(690, 296), (720, 292), (726, 318), (712, 314), (704, 320), (696, 312), (686, 316)], "SLATE_1", "INK")
    L(694, 298, 704, 312, "SLATE_0"); L(708, 296, 714, 312, "SLATE_0"); L(692, 297, 718, 294, "SLATE_2")
    L(688, 296, 683, 292, "INK"); L(683, 292, 680, 293, "INK")  # handlebar poking out
    # shoes, foam roller, bottle
    BOX(662, 336, 672, 341, "CRT_1", hi="CREAM", sh="CREAM")
    BOX(672, 338, 682, 343, "CRT_1", hi="CREAM", sh="CREAM")
    BOX(644, 340, 662, 346, "SLATE_1", hi="SLATE_2", sh="SLATE_0"); circ(644, 343, 2, "SLATE_0")
    BOX(664, 322, 669, 334, "SLATE_2", ol="INK"); R(665, 320, 668, 322, "CRT_0")


# ---------------------------------------------------------------- floor layer
def rug():
    POLY([(262, 304), (350, 304), (372, 344), (236, 344)], "TERRA_0", "INK")
    POLY([(265, 306), (347, 306), (366, 341), (242, 341)], "TERRA_1")
    POLY([(268, 309), (344, 309), (360, 338), (248, 338)], "TERRA_0")
    for i, y in enumerate(range(312, 337, 6)):
        cx = 304 + (y - 304) * 0.0
        POLY([(cx, y - 3), (cx + 6, y), (cx, y + 3), (cx - 6, y)], "GOLD_DK")
        P(cx, y, "CREAM")
    for x in range(238, 372, 3):
        P(x, 345, "CREAM")


def sun_patch():
    pts = [(352, 304), (494, 304), (506, 352), (330, 352)]
    m1 = {"OAK_DK": "TERRA_1", "BROWN_1": "OAK_1", "VOID": "TERRA_0", "INK": "TERRA_0",
          "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "GOLD_DK": "GOLD"}
    remap_poly(pts, m1, reg=[5])
    # brighter core band
    m2 = {"TERRA_1": "RIM", "OAK_1": "TERRA_2", "TERRA_2": "ORANGE", "TERRA_0": "TERRA_1"}
    remap_poly([(370, 312), (476, 312), (484, 344), (356, 344)], m2, reg=[5])
    # muntin shadows
    L(423, 304, 421, 352, "TERRA_0"); L(424, 304, 422, 352, "TERRA_0")
    L(345, 327, 500, 327, "TERRA_0")


def dog():
    ELL(398, 318, 426, 331, "INK")
    ELL(399, 319, 425, 330, "OAK_2")
    ELL(402, 325, 424, 330, "OAK_1")
    circ(401, 321, 5, "INK"); circ(401, 321, 4, "OAK_2")
    L(398, 318, 396, 324, "OAK_1"); L(399, 318, 397, 324, "OAK_1")
    L(400, 321, 402, 321, "INK"); P(397, 323, "INK")
    L(424, 322, 428, 318, "OAK_1"); L(425, 322, 429, 319, "INK")
    L(406, 319, 418, 319, "GLOW")  # sun on the back


def floor_layer(rng):
    rug()
    sun_patch()
    dog()
    # cables across the floor
    cable([(470, 300), (452, 320), (380, 336), (300, 350), (230, 330), (222, 316)], "INK")
    cable([(648, 312), (600, 326), (540, 318), (506, 302)], "INK")
    cable([(160, 318), (200, 340), (260, 356), (340, 360)], "SLATE_0")
    cable([(440, 302), (470, 330), (560, 346), (640, 352), (700, 344)], "TERRA_0")
    # contact shadows
    for x0, x1, y in ((174, 226, 300), (228, 266, 300), (440, 508, 300), (598, 626, 300), (346, 372, 300)):
        L(x0, y + 1, x1, y + 1, "VOID")
    # stacked records + camera on the floor
    for i, c in enumerate(("INK", "CRT_0", "INK", "SLATE_1")):
        R(452, 316 - i, 470, 316 - i, c)
    BOX(476, 312, 486, 318, "INK", hi="SLATE_0"); circ(481, 315, 1, "SLATE_2")


def foreground(rng):
    # left: tall speaker + filing cabinet cropping the frame edge
    speaker(60, 300, 94, 376)
    speaker(64, 268, 92, 300)
    plant(78, 268, 6, rng, pot="SLATE_1")
    BOX(92, 336, 124, 380, "SLATE_0", hi="SLATE_1", sh="INK", rim="r")
    for y in (348, 362):
        L(93, y, 123, y, "INK"); R(104, y - 6, 112, y - 5, "SLATE_2")
    BOX(98, 328, 114, 336, "CREAM", sh="OAK_2")  # box on the cabinet
    BOX(116, 330, 122, 336, "TERRA_1"); P(118, 328, "CREAM")  # mug
    # right: amp + big plant cropping the edge
    gear(694, 342, 730, 380, rng, face="CHAR")
    for i in range(12):
        a = math.pi * (1.05 + 0.9 * i / 11)
        x, y = 728 + math.cos(a) * 30, 352 + math.sin(a) * 46
        POLY([(728, 350), (x - 4, y), (x + 4, y - 3)], "LEAF_1" if i % 2 else "LEAF_2", "LEAF_0")
        L((728 + x) / 2, (350 + y) / 2, x, y - 1, "LEAF_3" if i % 3 == 0 else "LEAF_0")
    BOX(716, 352, 744, 384, "TERRA_1", hi="TERRA_2", sh="TERRA_0")
    # cables in front
    cable([(70, 372), (180, 362), (300, 370), (420, 360), (560, 370), (700, 362)], "INK")
    cable([(94, 366), (220, 372), (380, 366)], "VOID")


# ---------------------------------------------------------------- lights
def lights(cone):
    pool(222, 236, 26, 22, {"WALL_G": "OAK_DK", "CHAR": "BROWN_1"}, reg=[2])          # reading lamp
    pool(216, 320, 34, 10, {"BROWN_1": "OAK_DK", "OAK_DK": "OAK_0"}, reg=[5])           # lamp floor pool
    pool(464, 258, 36, 26, {"WALL_G": "TERRA_0", "CHAR": "TERRA_0"}, reg=[2])          # big CRT red
    pool(466, 306, 34, 6, {"BROWN_1": "TERRA_0", "OAK_DK": "TERRA_0"}, reg=[5])         # red floor sheen
    pool(497, 266, 18, 16, {"WALL_G": "SLATE_0", "TERRA_0": "SLATE_0"}, reg=[2])        # small CRT cyan
    pool(654, 246, 30, 30, {"CHAR": "SLATE_0"}, reg=[4], inner=0.35)                   # monitors cyan
    pool(158, 238, 24, 20, {"CHAR": "BROWN_1"}, reg=[3])                                # bed shelf glow
    pool(198, 150, 22, 12, {"WALL_G": "SLATE_0", "CHAR": "WALL_G"}, reg=[2])           # pendant
    pool(566, 150, 22, 12, {"WALL_G": "SLATE_0", "CHAR": "WALL_G"}, reg=[2])
    pool(421, 138, 22, 14, {"WALL_G": "TERRA_0", "CHAR": "TERRA_0"}, reg=[2], inner=0.3)  # relic ember
    if cone:
        a = arr()
        out = a.copy()
        ys, xs = np.mgrid[0:H, 0:W]
        t = (ys - 124) / 176.0
        hw = 4 + t * 36
        dx = np.abs(xs - 303)
        incone = (ys >= 124) & (ys <= 300) & (dx <= hw) & (RG == 2)
        coreb = incone & (dx <= hw * 0.6)
        ringb = incone & ~coreb & (((xs + ys) % 2) == 0)
        sel = coreb | ringb
        for k, v in (("WALL_G", "SLATE_0"), ("CHAR", "WALL_G"), ("TERRA_0", "TERRA_1"), ("OAK_DK", "OAK_0")):
            out[sel & (a == N[k])] = N[v]
        put(out)
        pool(303, 306, 40, 8, {"BROWN_1": "OAK_DK", "OAK_DK": "OAK_0", "TERRA_0": "TERRA_1"}, reg=[5])


# ---------------------------------------------------------------- compose
def render(cone, hot):
    reset()
    shell()
    lights(cone)
    ceiling()
    library(random.Random(1))
    window(hot)
    under_window(random.Random(2))
    crt_stack(random.Random(3))
    statue(cone)
    desk_zone(random.Random(4))
    left_zone(random.Random(5))
    right_zone(random.Random(6))
    floor_layer(random.Random(7))
    # ceiling dressing in front of the walls
    string_lights(172, 127, 400, 129, 6, step=7, seed=0)
    string_lights(440, 129, 628, 127, 6, step=7, seed=3)
    pendants()
    downlight(cone)
    rng = random.Random(8)
    hanging_basket(146, 92, 112, rng, vines=4, vlen=46)
    hanging_basket(474, 96, 116, rng, vines=4, vlen=40)
    hanging_basket(660, 92, 108, rng, vines=3, vlen=44)
    foreground(random.Random(9))
    return S.im.convert("RGB")


def export(img, path, box, scale=2):
    crop = img.crop(box)
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
    crop.save(path)
    return crop.size


def main():
    os.makedirs(OUT, exist_ok=True)
    write_proposal()
    default = render(cone=False, hot=False)
    default.save(os.path.join(OUT, "master@1x.png"))
    print("full-room", export(default, os.path.join(OUT, "full-room@2x.png"), (80, 96, 720, 366)))
    focus = render(cone=True, hot=True)
    print("window-zone", export(focus, os.path.join(OUT, "window-zone@2x.png"), (258, 112, 530, 308)))
    cols = {c for _, c in default.getcolors(1 << 16)} | {c for _, c in focus.getcolors(1 << 16)}
    assert cols <= set(RGB), "off-palette colour"
    print("colours used:", len(cols), "/", len(RGB))
    if Sprite is not None:  # palette lock via Pixel Art Studio
        sp = Sprite(W, H, palette=[h for _, h in PAL])
        print("pixelstudio palette size:", len(sp.palette))


if __name__ == "__main__":
    main()
