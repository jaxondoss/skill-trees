#!/usr/bin/env python3
"""FORGE dorm room, art pass 4: stills only (deterministic, Pixel Art Studio style).

Chunky 16-bit look: flat clusters, 1 px dark outlines, orange rim light toward the window, no grain.
Dither is used only for light falloff and the sky (single 50% checker band between two levels).

How it works
  1. A tiny one-point camera (pj) places everything in feet: X lateral, Y height, z distance in front of
     the back wall. 13 px per ft on the back wall, so the 7 ft door ruler = 91 px and the knight = 10 ft.
  2. Shell, window and every object are painted in flat "albedo" colours into one indexed 800x480 buffer,
     each object with its own id; light sources are flagged emissive.
  3. A light field (window wash + lamps - corner falloff - contact shadows) is quantised to 5 levels and
     every non-emissive pixel is remapped through per-time-of-day ramps (dark plum corners, warm lit faces).
  4. Rim pass: object edges facing the window get the rim colour. Then coloured light tints (CRT red,
     monitor green, plasma violet, knight cyan, neon pink) and the satin floor reflection.

Hidden design parameter: TOD in {dawn, midday, golden, night} (golden = default view).

Coordinates: master 800x480; default view = core (80, 96, 720, 366) = 640x270. VP = (400, 212) = 43%.
Run:  python3 art/room-r4/build.py            (stills, then the layered live export; --stills-only / --live-only)
Out:  docs/redesign/room-r4/stills/{room,lighting-strip,knight-tiers,glow-demo}@2x.png
      art/room-r4/palette-proposal.json
      live: docs/redesign/room-prototype/art-r4/<zone>/<name>.<variant>.png, art/room-r4/{manifest,zones,palette}.json
Then: python3 art/room-v3/merge.py --src room-r4 && node scripts/room-sync.mjs
"""
import json
import math
import os
import random
from contextlib import contextmanager

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs", "redesign", "room-r4", "stills")

# ---------------------------------------------------------------- palette (37 = v3 32 + r3 5; 6 swapped)
PAL = [
    ("VOID", "#0C0A0C"), ("INK", "#141517"), ("OAK_0", "#5C3721"), ("VIOLET", "#9466DA"),
    ("BROWN_1", "#312D2A"), ("BROWN_2", "#50302E"), ("TERRA_0", "#621D1A"), ("TERRA_1", "#8E432D"),
    ("TERRA_2", "#B45B40"), ("RIM", "#DA6339"), ("ORANGE", "#F26B2A"), ("GLOW", "#F39041"),
    ("AMBER", "#CE8446"), ("SUN", "#FEF576"), ("GOLD", "#D9A441"), ("GOLD_DK", "#6E5422"),
    ("OAK_1", "#7E4C27"), ("OAK_2", "#A56A32"), ("LEAF_0", "#212C26"), ("LEAF_1", "#344136"),
    ("LEAF_2", "#3E6B35"), ("LEAF_3", "#7FA650"), ("SLATE_0", "#3E4F51"), ("SLATE_1", "#56858A"),
    ("SLATE_2", "#9CC0C2"), ("OAK_DK", "#45291A"), ("PLUM_1", "#724F5B"), ("PLUM_2", "#AF4D61"),
    ("PLUM_3", "#D98AA0"), ("CRT_0", "#D2211A"), ("CRT_1", "#FC3827"), ("CREAM", "#F4E6C4"),
    ("PLASTER_0", "#1E151D"), ("PLASTER", "#36232F"), ("NAVY", "#1B2552"), ("ENERGY", "#3FD8E8"),
    ("ENERGY_HI", "#D4FFFB"),
]
SWAPS = [
    ("BROWN_0", "#281B1B", "VIOLET", "#9466DA", "plasma tendrils, lilac quilt, night string bulbs (BROWN_0 was near-duplicate of PLASTER_0)"),
    ("CHAR", "#1E2423", "PLASTER_0", "#1E151D", "plum-charcoal plaster, shadow / corner tone"),
    ("WALL_G", "#2B3633", "PLASTER", "#36232F", "plum-charcoal plaster, main wall tone (warm, not brown, not slate)"),
    ("STAT_1", "#19202C", "NAVY", "#1B2552", "knight visor depth + deep blue night window"),
    ("STAT_2", "#2E3B50", "ENERGY", "#3FD8E8", "knight energy lines, pedestal runes, visor glow"),
    ("STAT_HI", "#C6DCEE", "ENERGY_HI", "#D4FFFB", "knight luminous line core, bright visor (tier IV-V), beam core"),
]
N = {n: i for i, (n, _) in enumerate(PAL)}
RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for _, h in PAL] + [[0, 0, 0]] * (256 - len(PAL)), np.uint8)
T = 255
FLAT = [int(v) for v in RGB.flatten()]

# ---------------------------------------------------------------- camera
W, H = 800, 480
CORE = (80, 96, 720, 366)
F, D0, EYE, CX, CY = 559.0, 43.0, 6.77, 400.0, 212.0
WX, CEIL = 17.7, 13.5
TOD = "golden"
TIER = 3
FLAGS = {"beam": False}


def sc(z):
    return F / (D0 - z)


COMP = {"k": None}


def pj(X, Y, z):
    if COMP["k"] is not None and X != 0:
        g = WX - abs(X)
        X = math.copysign(WX - g * COMP["k"], X)
    s = sc(z)
    return (CX + X * s, CY - (Y - EYE) * s)


def pji(X, Y, z):
    x, y = pj(X, Y, z)
    return int(round(x)), int(round(y))


# ---------------------------------------------------------------- live-export state
# VAR: {R3 item id: variant key} for the layered export (empty = the approved stills: s1, g2, relics set).
# AF: {anim channel: frame index} for the moving lights (0 = the still).
VAR = {}
AF = {}
STAGE = {"s0": 0, "s1": 1, "s2": 2}
# objects that form the room shell (never cut out of the ghost render; see export_live)
SHELL_NAMES = {"ceiling", "wall-L", "wall-R", "wall-B", "floor", "window-view", "window-frame", "curtains"}


def vk(k, d="base"):
    return VAR.get(k, d)


def stg(k):
    """Stage 0..2 of a skill object (base = s1, the approved still)."""
    return STAGE.get(VAR.get(k, "s1"), 1)


def grow(k):
    """Growth 0..3 of a growth piece (base = g2)."""
    v = VAR.get(k, "g2")
    return int(v[1]) if v.startswith("g") else 2


def af(ch):
    return AF.get(ch, 0)


# ---------------------------------------------------------------- scene buffers
class G:
    img = None
    oid = None
    emit = None
    shadow = None
    order = {}
    names = {}
    nxt = 10
    ghost = False
    lights = []   # (cx, cy, rx, ry, amp)
    tints = []    # (cx, cy, rx, ry, kind, strength)


def new_scene():
    G.img = np.full((H, W), N["VOID"], np.uint8)
    G.oid = np.zeros((H, W), np.int16)
    G.emit = np.zeros((H, W), bool)
    G.shadow = np.zeros((H, W), np.float32)
    G.order = {0: 0}
    G.names = {0: "void"}
    G.nxt = 10
    G.lights = []
    G.tints = []
    G.gmask = {}
    G.screens = {}


class S:
    im = None
    d = None
    em = None
    de = None


def _begin():
    S.im = Image.new("P", (W, H), T)
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)
    S.em = Image.new("L", (W, H), 0)
    S.de = ImageDraw.Draw(S.em)


@contextmanager
def obj(name, oid=None, emit=False):
    if oid is None:
        oid = G.nxt
        G.nxt += 1
    G.names[oid] = name
    G.order[oid] = len(G.order) + 1
    prev = (S.im, S.d, S.em, S.de)
    _begin()
    yield oid
    a = np.array(S.im)
    m = a != T
    if G.ghost and name not in SHELL_NAMES:
        # ghost render (lit shell without objects): keep only the object's lights, tints and shadows
        G.gmask[name] = G.gmask.get(name, np.zeros((H, W), bool)) | m
        S.im, S.d, S.em, S.de = prev
        return
    G.img[m] = a[m]
    G.oid[m] = oid
    e = np.array(S.em) > 0
    G.emit[m] = e[m] | emit
    S.im, S.d, S.em, S.de = prev


def ci(c):
    if c.endswith("!"):
        return N[c[:-1]], 255
    return N[c], 0


def R(x0, y0, x1, y1, c):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    if x1 < x0 or y1 < y0:
        return
    i, e = ci(c)
    S.d.rectangle([x0, y0, x1, y1], fill=i)
    S.de.rectangle([x0, y0, x1, y1], fill=e)


def P(x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < W and 0 <= y < H:
        i, e = ci(c)
        S.im.putpixel((x, y), i)
        S.em.putpixel((x, y), e)


def L(x0, y0, x1, y1, c):
    i, e = ci(c)
    p = [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))]
    S.d.line(p, fill=i)
    S.de.line(p, fill=e)


def PL(pts, c):
    i, e = ci(c)
    p = [(int(round(x)), int(round(y))) for x, y in pts]
    S.d.line(p, fill=i)
    S.de.line(p, fill=e)


def POLY(pts, c, ol=None):
    i, e = ci(c)
    p = [(int(round(x)), int(round(y))) for x, y in pts]
    S.d.polygon(p, fill=i)
    S.de.polygon(p, fill=e)
    if ol:
        PL(p + [p[0]], ol)


def ELL(x0, y0, x1, y1, c, ol=None):
    i, e = ci(c)
    b = [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))]
    if b[2] < b[0] or b[3] < b[1]:
        return
    S.d.ellipse(b, fill=i)
    S.de.ellipse(b, fill=e)
    if ol:
        io, eo = ci(ol)
        S.d.ellipse(b, outline=io)
        S.de.ellipse(b, outline=eo)


def circ(cx, cy, r, c):
    ELL(cx - r, cy - r, cx + r, cy + r, c)


def ring(cx, cy, r, c):
    i, e = ci(c)
    b = [int(round(cx - r)), int(round(cy - r)), int(round(cx + r)), int(round(cy + r))]
    S.d.ellipse(b, outline=i)
    S.de.ellipse(b, outline=e)


def BOX(x0, y0, x1, y1, f, hi=None, sh=None, ol="INK"):
    R(x0, y0, x1, y1, ol)
    R(x0 + 1, y0 + 1, x1 - 1, y1 - 1, f)
    if hi:
        L(x0 + 1, y0 + 1, x1 - 1, y0 + 1, hi)
    if sh:
        L(x0 + 1, y1 - 1, x1 - 1, y1 - 1, sh)


def sag(x0, y0, x1, y1, s, c, n=None):
    n = n or max(2, int(abs(x1 - x0) + abs(y1 - y0)))
    pts = [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n + s * 4 * (i / n) * (1 - i / n)) for i in range(n + 1)]
    PL(pts, c)
    return pts


def light(cx, cy, rx, ry, amp):
    G.lights.append((cx, cy, rx, ry, amp))


def tint(cx, cy, rx, ry, kind, k=1.0):
    G.tints.append((cx, cy, rx, ry, kind, k))


# ---------------------------------------------------------------- 3D helpers
def box3d(X0, X1, Y0, Y1, z0, z1, front, side=None, top=None, ol="INK"):
    """Axis-aligned box in one-point perspective. Returns dict of face polygons."""
    side = side or front
    top = top or front
    a, b, c, d = pj(X0, Y1, z1), pj(X1, Y1, z1), pj(X1, Y0, z1), pj(X0, Y0, z1)
    faces = {}
    if Y1 < EYE:
        q = [pj(X0, Y1, z0), pj(X1, Y1, z0), b, a]
        POLY(q, top, ol)
        faces["top"] = q
    if X1 < 0:
        q = [pj(X1, Y1, z0), pj(X1, Y1, z1), pj(X1, Y0, z1), pj(X1, Y0, z0)]
        POLY(q, side, ol)
        faces["side"] = q
    if X0 > 0:
        q = [pj(X0, Y1, z0), pj(X0, Y1, z1), pj(X0, Y0, z1), pj(X0, Y0, z0)]
        POLY(q, side, ol)
        faces["side"] = q
    POLY([a, b, c, d], front, ol)
    faces["front"] = [a, b, c, d]
    return faces


def quad(pts, c, ol=None):
    POLY(pts, c, ol)


def wallq(side, z0, z1, Y0, Y1, inset=0.0):
    X = -WX + inset if side == "L" else WX - inset
    return [pj(X, Y1, z0), pj(X, Y1, z1), pj(X, Y0, z1), pj(X, Y0, z0)]


def wall_frame(side, z0, z1, Y0, Y1, fc, inner, ol="INK", m=0.18):
    quad(wallq(side, z0, z1, Y0, Y1, 0.02), fc, ol)
    quad(wallq(side, z0 + m, z1 - m, Y0 + m, Y1 - m, 0.03), inner)


def shadow_fp(X0, X1, z0, z1, k=1.4, grow=0.35):
    """Contact shadow footprint on the floor: inner (k) and a soft outer band (k/2)."""
    for g, kk in ((grow, k * 0.5), (0.0, k * 0.5)):
        m = Image.new("L", (W, H), 0)
        pts = [pj(X0 - g, 0, z0 - g * 0.3), pj(X1 + g, 0, z0 - g * 0.3), pj(X1 + g, 0, z1 + g), pj(X0 - g, 0, z1 + g)]
        ImageDraw.Draw(m).polygon([(int(round(x)), int(round(y))) for x, y in pts], fill=1)
        G.shadow[np.array(m) > 0] -= kk


def shadow_ell(cx, cy, rx, ry, k=1.4):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=1)
    G.shadow[np.array(m) > 0] -= k * 0.5
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse([cx - rx * 0.7, cy - ry * 0.6, cx + rx * 0.7, cy + ry * 0.6], fill=1)
    G.shadow[np.array(m) > 0] -= k * 0.5


# ---------------------------------------------------------------- tiny font (3x5)
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001010010",
    "8": "111101111101111", "9": "111101111001111", "F": "111100110100100", "O": "111101101101111",
    "R": "110101110101101", "G": "111100101101111", "E": "111100110100111", "D": "110101101101110",
    ":": "000010000010000", "A": "010101111101101", "T": "111010010010010", "-": "000000111000000",
    "I": "111010010010111", " ": "000000000000000", "W": "101101111111101", "U": "101101101101111",
    "K": "101101110101101", "N": "110101101101101", "S": "011100010001110", "C": "011100100100011",
    "V": "101101101101010", "L": "100100100100111", "M": "101111111101101", ".": "000000000000010",
    "H": "101101111101101", "Y": "101101010010010", "B": "110101110101110", "P": "110101110100100",
}


def text(x, y, s, c, gap=1):
    for ch in s:
        if ch == "|":  # 1 px roman numeral stroke
            for k in range(5):
                P(x, y + k, c)
            x += 2
            continue
        if ch == "*":  # middle dot
            P(x, y + 2, c)
            x += 2
            continue
        g = FONT.get(ch, FONT[" "])
        for i, b in enumerate(g):
            if b == "1":
                P(x + i % 3, y + i // 3, c)
        x += 3 + gap
    return x


def text_w(s, gap=1):
    w = 0
    for ch in s:
        w += 2 if ch in "|*" else 3 + gap
    return w - (gap if s and s[-1] not in "|*" else 1)


# ---------------------------------------------------------------- shared props
BOOKC = ["TERRA_1", "SLATE_1", "LEAF_2", "OAK_1", "GOLD_DK", "TERRA_0", "CREAM", "SLATE_0",
         "TERRA_2", "LEAF_1", "PLUM_1", "OAK_2", "PLUM_2", "NAVY"]
LIGHTER = {"TERRA_1": "TERRA_2", "SLATE_1": "SLATE_2", "LEAF_2": "LEAF_3", "OAK_1": "OAK_2",
           "GOLD_DK": "GOLD", "TERRA_0": "TERRA_1", "CREAM": "CREAM", "SLATE_0": "SLATE_1",
           "TERRA_2": "RIM", "LEAF_1": "LEAF_2", "PLUM_1": "PLUM_2", "OAK_2": "AMBER", "PLUM_2": "PLUM_3",
           "NAVY": "SLATE_0", "OAK_0": "OAK_1", "BROWN_1": "SLATE_0", "OAK_DK": "OAK_0"}


def books_row(x0, x1, yb, hmax, rng, n_fill=1.0):
    x = x0
    while x <= x1 - 1:
        if rng.random() > n_fill:
            x += 3
            continue
        if rng.random() < 0.1 and x1 - x >= 7:
            w = rng.randint(5, min(7, x1 - x))
            yy = yb
            for _ in range(rng.randint(2, 3)):
                col = rng.choice(BOOKC)
                R(x, yy - 1, x + w - 1, yy, col)
                L(x, yy - 1, x + w - 1, yy - 1, LIGHTER.get(col, col))
                yy -= 2
            x += w + 1
            continue
        w = rng.choice([2, 2, 3, 3])
        if x + w - 1 > x1:
            break
        h = rng.randint(max(4, hmax - 4), hmax)
        col = rng.choice(BOOKC)
        R(x, yb - h + 1, x + w - 1, yb, col)
        L(x, yb - h + 1, x + w - 1, yb - h + 1, LIGHTER.get(col, col))
        if rng.random() < 0.35:
            L(x, yb - h + 3, x + w - 1, yb - h + 3, "GOLD_DK" if col != "GOLD_DK" else "CREAM")
        x += w + (1 if rng.random() < 0.5 else 0)


def leaf(x, y, rng, dark=False, big=False):
    if dark:
        R(x, y, x + 1 + big, y + 1, "LEAF_0")
        return
    R(x - 1, y, x + 1 + big, y + 1, "LEAF_1")
    R(x, y, x + 1, y, "LEAF_2")
    if rng.random() < 0.3:
        P(x + 1, y, "LEAF_3")


def bush(cx, cy, rx, ry, rng, n=None, big=False):
    n = n or int((rx * ry) * 0.9) + 6
    for i in range(n):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, 1) ** 0.7
        x = cx + math.cos(a) * rx * rr
        y = cy + math.sin(a) * ry * rr
        leaf(int(x), int(y), rng, dark=(y > cy + ry * 0.2 and rng.random() < 0.6) or i < n // 4, big=big)


def big_leaf(x, y, ang, ln, wd, c="LEAF_2", edge="LEAF_0", vein="LEAF_1", hi=None):
    """Pointed leaf polygon from its stem point; flat fill, dark edge, vein."""
    ca, sa = math.cos(ang), math.sin(ang)
    tip = (x + ca * ln, y + sa * ln)
    m1 = (x + ca * ln * 0.45 - sa * wd, y + sa * ln * 0.45 + ca * wd)
    m2 = (x + ca * ln * 0.45 + sa * wd, y + sa * ln * 0.45 - ca * wd)
    POLY([(x, y), m1, tip, m2], c, edge)
    L(x, y, tip[0] - ca * 2, tip[1] - sa * 2, vein)
    if hi:
        P(m2[0] + ca, m2[1] + sa, hi)


def pot(x0, y0, x1, y1, c="TERRA_1"):
    BOX(x0, y0, x1, y1, c, hi=LIGHTER.get(c), sh="TERRA_0" if c.startswith("TERRA") else "INK")


def vine(x, y, length, rng, drift=0.0):
    for i in range(length):
        y += 1
        if rng.random() < 0.3:
            x += 1 if rng.random() < 0.5 + drift else -1
        P(x, y, "LEAF_0")
        if i % 3 == 1:
            s = 1 if (i // 3) % 2 else -1
            P(x + s, y, "LEAF_2")
            P(x + s, y + 1, "LEAF_1")


def flame(x, y, big=False):
    P(x, y, "SUN!")
    P(x, y - 1, "GLOW!")
    if big:
        P(x, y + 1, "SUN!")
        P(x, y - 2, "ORANGE!")


def string_lights(pts, step=7, seed=0, cols=("GLOW", "SUN", "CRT_1", "PLUM_3", "ENERGY", "GLOW")):
    PL(pts, "INK")
    k = seed
    for i in range(seed % step, len(pts), step):
        x, y = pts[i]
        c = cols[k % len(cols)]
        P(x, y + 1, c + "!")
        P(x + 1, y + 1, c + "!")
        P(x, y + 2, c + "!")
        k += 1
        light(x, y + 2, 9, 7, 0.35 if TOD == "night" else 0.15)


# ---------------------------------------------------------------- shell
WIN = (-1.5, 9.9, 2.8, 10.6)  # X0, X1, sill Y, top Y on the back wall


def shell():
    bw = (pji(-WX, CEIL, 0), pji(WX, 0, 0))
    (bx0, by0), (bx1, by1) = bw
    zf = 22.0
    # ceiling
    with obj("ceiling", 5):
        POLY([(0, 0), (W, 0), pj(WX, CEIL, zf), (bx1, by0), (bx0, by0), pj(-WX, CEIL, zf)], "PLASTER_0")
        ceiling_detail()
    # walls
    with obj("wall-L", 2):
        POLY([pj(-WX, CEIL, zf), (bx0, by0), (bx0, by1), pj(-WX, 0, zf)], "PLASTER")
        # baseboard + corner
        POLY([pj(-WX, 0.42, 0), pj(-WX, 0.42, zf), pj(-WX, 0, zf), pj(-WX, 0, 0)], "OAK_DK")
        L(*pj(-WX, 0.42, 0), *pj(-WX, 0.42, zf), "OAK_0")
        POLY([pj(-WX, CEIL, 0), pj(-WX, CEIL, zf), pj(-WX, CEIL - 0.3, zf), pj(-WX, CEIL - 0.3, 0)], "PLASTER_0")
    with obj("wall-R", 3):
        POLY([pj(WX, CEIL, zf), (bx1, by0), (bx1, by1), pj(WX, 0, zf)], "PLASTER")
        POLY([pj(WX, 0.42, 0), pj(WX, 0.42, zf), pj(WX, 0, zf), pj(WX, 0, 0)], "OAK_DK")
        L(*pj(WX, 0.42, 0), *pj(WX, 0.42, zf), "OAK_0")
        POLY([pj(WX, CEIL, 0), pj(WX, CEIL, zf), pj(WX, CEIL - 0.3, zf), pj(WX, CEIL - 0.3, 0)], "PLASTER_0")
    with obj("wall-B", 1):
        R(bx0, by0, bx1, by1, "PLASTER")
        R(bx0, by0, bx1, by0 + 3, "PLASTER_0")  # crown shadow
        R(bx0, by1 - 5, bx1, by1, "OAK_DK")
        L(bx0, by1 - 5, bx1, by1 - 5, "OAK_0")
        # flat plaster patches (no grain)
        rng = random.Random(7)
        for _ in range(26):
            x = rng.randint(bx0 + 4, bx1 - 30)
            y = rng.randint(by0 + 8, by1 - 20)
            L(x, y, x + rng.randint(4, 14), y, "PLASTER_0")
        L(bx0, by0, bx0, by1, "PLASTER_0")
        L(bx1, by0, bx1, by1, "PLASTER_0")
    with obj("floor", 4):
        floor_planks(bx0, bx1, by1, zf)


def floor_planks(bx0, bx1, by1, zf):
    POLY([(bx0, by1), (bx1, by1), pj(WX, 0, zf), (W, H), (0, H), pj(-WX, 0, zf)], "OAK_0")
    rng = random.Random(11)
    pw = 0.72
    X = -WX - 30
    k = 0
    while X < WX + 30:
        Xn = X + pw
        col = rng.choice(["OAK_0", "OAK_0", "OAK_1", "OAK_0", "OAK_DK"])
        if col != "OAK_0":
            POLY([pj(X, 0, 0), pj(Xn, 0, 0), pj(Xn, 0, 40), pj(X, 0, 40)], col)
        # end joints, staggered
        zj = rng.uniform(0.5, 4.0)
        while zj < 40:
            a, b = pj(X, 0, zj), pj(Xn, 0, zj)
            L(a[0], a[1], b[0], b[1], "OAK_DK")
            zj += rng.uniform(5.0, 9.0)
        a, b = pj(X, 0, 0), pj(X, 0, 40)
        L(a[0], a[1], b[0], b[1], "OAK_DK")
        X = Xn
        k += 1
    # clip planks to the floor region happens by object order (walls drawn before; floor drawn last over walls)
    # restore walls over the floor overspill
    m = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(m)
    md.polygon([(int(x), int(y)) for x, y in [(bx0, by1), (bx1, by1), pj(WX, 0, zf), (W, H), (0, H), pj(-WX, 0, zf)]], fill=1)
    a = np.array(S.im)
    a[np.array(m) == 0] = T
    S.im = Image.fromarray(a, "P")
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)


def ceiling_detail():
    # long beams converging on the window (along z), with lit undersides
    for X in (-13.0, -6.5, 6.5, 13.0):
        for z0, z1 in ((0, 22),):
            a0, a1 = pj(X - 0.35, CEIL, z0), pj(X - 0.35, CEIL, z1)
            b0, b1 = pj(X + 0.35, CEIL, z0), pj(X + 0.35, CEIL, z1)
            c0, c1 = pj(X - 0.35, CEIL - 0.55, z0), pj(X - 0.35, CEIL - 0.55, z1)
            d0, d1 = pj(X + 0.35, CEIL - 0.55, z0), pj(X + 0.35, CEIL - 0.55, z1)
            POLY([a0, a1, c1, c0], "OAK_DK")       # side
            POLY([c0, c1, d1, d0], "OAK_0")        # underside (catches light)
            POLY([b0, b1, d1, d0], "OAK_DK")
            L(*c0, *c1, "INK")
            L(*d0, *d1, "OAK_1" if X < 0 else "INK")
    # cross beams (along X)
    for z in (2.5, 7.0, 13.0):
        a, b = pj(-WX, CEIL - 0.6, z), pj(WX, CEIL - 0.6, z)
        c, d = pj(-WX, CEIL, z), pj(WX, CEIL, z)
        e, f = pj(-WX, CEIL - 0.6, z + 0.6), pj(WX, CEIL - 0.6, z + 0.6)
        POLY([c, d, b, a], "OAK_DK")
        POLY([a, b, f, e], "OAK_0")
        L(*e, *f, "INK")
        L(*a, *b, "OAK_1")
    # skylight between the middle beams
    sk = [pj(-4.0, CEIL, 8.0), pj(4.0, CEIL, 8.0), pj(4.0, CEIL, 12.4), pj(-4.0, CEIL, 12.4)]
    POLY(sk, "INK")
    inner = [pj(-3.6, CEIL, 8.3), pj(3.6, CEIL, 8.3), pj(3.6, CEIL, 12.1), pj(-3.6, CEIL, 12.1)]
    sky_cols = {"golden": ["PLUM_2!", "TERRA_2!", "RIM!"], "dawn": ["PLUM_1!", "PLUM_2!", "PLUM_3!"],
                "midday": ["SLATE_1!", "SLATE_2!", "SLATE_2!"], "night": ["NAVY!", "NAVY!", "SLATE_0!"]}[TOD]
    POLY(inner, sky_cols[0])
    y0 = int(min(p[1] for p in inner))
    y1 = int(max(p[1] for p in inner))
    xs = [p[0] for p in inner]
    hh = max(1, y1 - y0)
    for y in range(y0, y1 + 1):
        t = (y - y0) / hh
        c = sky_cols[2] if t > 0.66 else sky_cols[1] if t > 0.33 else sky_cols[0]
        L(min(xs) + 1, y, max(xs) - 1, y, c)
    if TOD == "night":
        P(sk[0][0] + 20, y0 + 3, "CREAM!")
        P(sk[0][0] + 60, y0 + 6, "CREAM!")
    # re-clip skylight trapezoid
    POLY([pj(-4.0, CEIL, 8.0), pj(-3.6, CEIL, 8.3), pj(-3.6, CEIL, 12.1), pj(-4.0, CEIL, 12.4)], "INK")
    POLY([pj(4.0, CEIL, 8.0), pj(3.6, CEIL, 8.3), pj(3.6, CEIL, 12.1), pj(4.0, CEIL, 12.4)], "INK")
    L(*pj(-3.6, CEIL, 12.1), *pj(3.6, CEIL, 12.1), "OAK_1")
    L(*pj(0, CEIL, 8.3), *pj(0, CEIL, 12.1), "INK")


def ceiling_life():
    rng = random.Random(5)
    # string lights along two long beams and one cross beam
    for X, sd in ((-6.5, 1), (6.5, 3)):
        pts = []
        for i in range(0, 60):
            z = i * 0.25
            x, y = pj(X, CEIL - 0.55, z)
            pts.append((x, y + 2 + 2.5 * abs(math.sin(i * 0.52))))
        with obj("string-%d" % sd, emit=False):
            string_lights(pts, step=6, seed=sd)
    a, b = pj(-12.0, CEIL - 0.6, 2.5), pj(12.0, CEIL - 0.6, 2.5)
    with obj("string-x"):
        pts = sag(a[0], a[1] + 1, b[0], b[1] + 1, 9, "INK")
        string_lights(pts, step=9, seed=2)
    # hanging plants
    for X, z, ln in ((-13.0, 4.5, 26), (15.2, 3.0, 22), (1.6, 9.5, 14)):
        with obj("hang-plant"):
            top = pj(X, CEIL - 0.55, z)
            bot = pj(X, CEIL - 2.3, z)
            s = sc(z)
            L(top[0], top[1], bot[0] - 4, bot[1], "INK")
            L(top[0], top[1], bot[0] + 4, bot[1], "INK")
            for i in range(5):
                vine(int(bot[0]) - 4 + i * 2, int(bot[1]) + 4, rng.randint(ln // 2, ln), rng)
            bush(bot[0], bot[1] - 1, 6, 3, rng, n=22)
            pot(bot[0] - 5, bot[1], bot[0] + 5, bot[1] + 5, "TERRA_1")
    # two pendants: reading chair, chess table
    for X, z, Yl in ((-9.6, 5.0, 9.2), (6.6, 13.0, 9.4)):
        with obj("pendant"):
            top = pj(X, CEIL, z)
            lx, ly = pj(X, Yl, z)
            L(top[0], max(top[1], 0), lx, ly - 4, "INK")
            POLY([(lx - 2, ly - 5), (lx + 2, ly - 5), (lx + 6, ly + 1), (lx - 6, ly + 1)], "GOLD_DK", "INK")
            L(lx - 5, ly, lx + 5, ly, "GOLD")
            on = TOD in ("golden", "night", "dawn")
            R(lx - 2, ly + 2, lx + 2, ly + 3, "SUN!" if on else "CREAM")
            R(lx - 1, ly + 2, lx, ly + 3, "CREAM!" if on else "CREAM")
            if on:
                light(lx, ly + 30, 46, 52, 0.9 if TOD == "night" else 0.5)


# ---------------------------------------------------------------- window
def window():
    X0, X1, Ys, Yt = WIN
    x0, y0 = pji(X0, Yt, 0)
    x1, y1 = pji(X1, Ys, 0)
    G.win = (x0, y0, x1, y1)
    with obj("window-view", emit=True):
        sky(x0, y0, x1, y1)
        outside(x0, y0, x1, y1)
    with obj("window-frame"):
        R(x0 - 4, y0 - 4, x1 + 4, y0 - 1, "OAK_DK")
        L(x0 - 4, y0 - 4, x1 + 4, y0 - 4, "INK")
        R(x0 - 4, y0, x0 - 1, y1, "OAK_DK")
        R(x1 + 1, y0, x1 + 4, y1, "OAK_DK")
        L(x0 - 4, y0 - 4, x0 - 4, y1, "INK")
        L(x1 + 4, y0 - 4, x1 + 4, y1, "INK")
        L(x0 - 1, y0, x0 - 1, y1, "INK")
        L(x1 + 1, y0, x1 + 1, y1, "INK")
        # mullions: 3 panes wide, transom
        for k in (1, 2):
            xm = x0 + (x1 - x0) * k // 3
            R(xm - 1, y0, xm + 1, y1, "OAK_DK")
            L(xm - 1, y0, xm - 1, y1, "INK")
            L(xm + 1, y0, xm + 1, y1, "OAK_0")
        yt = y0 + 24
        R(x0, yt - 1, x1, yt + 1, "OAK_DK")
        L(x0, yt + 1, x1, yt + 1, "INK")
        L(x0, yt - 1, x1, yt - 1, "OAK_0")
        # sill (top face visible)
        R(x0 - 7, y1 + 1, x1 + 7, y1 + 4, "OAK_1")
        L(x0 - 7, y1 + 1, x1 + 7, y1 + 1, "OAK_2")
        L(x0 - 7, y1 + 4, x1 + 7, y1 + 4, "INK")
        R(x0 - 5, y1 + 5, x1 + 5, y1 + 6, "OAK_DK")
    # curtain rod + curtains gathered at both sides
    with obj("curtains"):
        L(x0 - 16, y0 - 8, x1 + 16, y0 - 8, "INK")
        L(x0 - 16, y0 - 9, x1 + 16, y0 - 9, "GOLD_DK")
        circ(x0 - 17, y0 - 9, 1, "GOLD")
        circ(x1 + 17, y0 - 9, 1, "GOLD")
        for side in (-1, 1):
            xe = x0 - 1 if side < 0 else x1 + 1
            for yy in range(y0 - 8, y1 + 22):
                t = (yy - (y0 - 8)) / (y1 + 22 - (y0 - 8))
                pinch = 1 - 0.45 * math.exp(-((t - 0.62) / 0.12) ** 2)  # tie-back
                w = int(round((8 + 6 * t) * pinch))
                if side < 0:
                    xa, xb = xe - w + 2, xe + 4
                else:
                    xa, xb = xe - 4, xe + w - 2
                L(xa, yy, xb, yy, "PLUM_1")
                for f in range(xa + 2, xb - 1, 3):
                    P(f, yy, "PLUM_2" if (f - xa) % 6 == 2 else "BROWN_2")
                P(xa, yy, "INK")
                P(xb, yy, "INK")
            # tie-back band
            ty = int(y0 - 8 + 0.62 * (y1 + 30 - y0))
            L(xe - 9 if side < 0 else xe - 4, ty, xe + 4 if side < 0 else xe + 9, ty, "GOLD")
    # candle row on the sill (growth piece)
    with obj("candles"):
        for i, cx in enumerate(range(x0 + 6, x0 + 36, 6)):
            h = 4 + (i % 3)
            R(cx, y1 + 1 - h, cx + 1, y1, "CREAM")
            P(cx, y1 + 1 - h, "OAK_2")
            flame(cx, y1 - h - 1)
        light(x0 + 20, y1 - 6, 24, 12, 0.3)
    # relic niche above the window (ember)
    with obj("relic-niche"):
        nx = (x0 + x1) // 2 + 14
        ny = y0 - 11
        POLY([(nx - 7, ny + 1), (nx - 7, ny - 7), (nx - 4, ny - 10), (nx + 4, ny - 10), (nx + 7, ny - 7), (nx + 7, ny + 1)], "PLASTER_0", "INK")
        R(nx - 8, ny + 1, nx + 8, ny + 2, "OAK_1")
        L(nx - 8, ny + 2, nx + 8, ny + 2, "INK")
        relic_slot("window.relic", nx, ny - 3)
        G.niche = (nx, ny - 3)


RELIC = {"fr": None}


def relic_gem(x, y, frame=0, hot=False):
    if RELIC["fr"] is not None:
        frame = RELIC["fr"]
    cols = [("CRT_0", "ORANGE", "SUN"), ("TERRA_0", "RIM", "GLOW"), ("CRT_0", "GLOW", "SUN")][frame % 3]
    POLY([(x, y - 4), (x + 3, y - 1), (x, y + 3), (x - 3, y - 1)], cols[0] + "!", "INK")
    POLY([(x, y - 3), (x + 2, y - 1), (x, y + 1), (x - 1, y - 1)], cols[1] + "!")
    P(x, y - 2, cols[2] + "!")
    embers = [((-2, -6), (1, -9)), ((-3, -8), (2, -11), (0, -6)), ((-1, -10), (3, -7), (-3, -13))][frame % 3]
    for i, (dx, dy) in enumerate(embers):
        P(x + dx, y + dy, ("ORANGE!", "RIM!", "CRT_0!")[(i + frame) % 3])
    k = (1.0, 0.75, 1.2)[frame % 3]
    light(x, y, 14 * k, 12 * k, (0.6 if TOD == "night" else 0.35) * k)
    tint(x, y, (16 if not hot else 22) * k, (13 if not hot else 18) * k, "ember", k)


def relic_slot(rid, x, y, frame=0):
    """A relic mount's content: base = empty socket, active / hot = the ember gem, gold = a gold medallion."""
    v = vk(rid, "active")
    if v == "base":
        R(x - 1, y - 1, x + 1, y + 1, "INK")
        P(x, y - 1, "OAK_DK")
        return
    if v == "gold":
        circ(x, y - 1, 4, "INK")
        circ(x, y - 1, 3, "GOLD!")
        circ(x, y - 1, 1, "SUN!")
        P(x - 1, y - 3, "CREAM!")
        light(x, y, 14, 12, 0.4)
        return
    relic_gem(x, y, frame, hot=(v == "hot"))


def sky(x0, y0, x1, y1):
    hz = y1 - 22  # horizon line behind rooftops
    bands = {
        "golden": ["PLUM_2", "TERRA_2", "RIM", "ORANGE", "GLOW", "SUN"],
        "dawn": ["NAVY", "PLUM_1", "PLUM_2", "PLUM_3", "CREAM", "CREAM"],
        "midday": ["SLATE_1", "SLATE_1", "SLATE_2", "SLATE_2", "CREAM", "CREAM"],
        "night": ["INK", "NAVY", "NAVY", "NAVY", "SLATE_0", "PLUM_1"],
    }[TOD]
    n = len(bands)
    hb = (hz - y0) / n
    for i, c in enumerate(bands):
        ya = int(y0 + i * hb)
        yb = int(y0 + (i + 1) * hb)
        R(x0, ya, x1, yb, c)
        if i + 1 < n:  # 1-row checker transition (sky dither)
            for x in range(x0, x1 + 1):
                if (x + yb) % 2 == 0:
                    P(x, yb, bands[i + 1])
    R(x0, hz, x1, y1, bands[-1])
    sx = x0 + int((x1 - x0) * 0.47)
    if TOD == "golden":
        sy = hz - 10
        circ(sx, sy, 13, "SUN")
        circ(sx, sy, 10, "CREAM")
        clouds = [(x0 + 4, y0 + 10, 40, "TERRA_1", "RIM"), (x0 + 60, y0 + 18, 50, "TERRA_2", "GLOW"),
                  (sx - 30, sy - 3, 46, "RIM", "SUN"), (x1 - 46, y0 + 30, 40, "TERRA_2", "GLOW"),
                  (x0 + 10, sy + 6, 30, "ORANGE", "SUN")]
    elif TOD == "dawn":
        sy = hz - 2
        circ(sx + 20, sy, 8, "CREAM")
        clouds = [(x0 + 8, y0 + 12, 36, "PLUM_1", "PLUM_3"), (x1 - 50, y0 + 22, 44, "PLUM_2", "CREAM")]
    elif TOD == "midday":
        clouds = [(x0 + 8, y0 + 10, 34, "SLATE_2", "CREAM"), (x1 - 60, y0 + 20, 50, "SLATE_2", "CREAM"),
                  (x0 + 50, y0 + 34, 40, "SLATE_2", "CREAM")]
    else:
        mx, my = x1 - 34, y0 + 16
        circ(mx, my, 7, "CREAM")
        circ(mx + 3, my - 2, 6, "NAVY")
        rng = random.Random(3)
        for _ in range(16):
            P(rng.randint(x0 + 2, x1 - 2), rng.randint(y0 + 2, hz - 14), "CREAM")
        clouds = [(x0 + 10, y0 + 30, 40, "SLATE_0", "PLUM_1")]
    for cx, cy, w, c, lit in clouds:
        R(cx, cy, cx + w, cy + 1, c)
        R(cx + 5, cy - 1, cx + w - 9, cy - 1, c)
        L(cx + 3, cy + 2, cx + w - 4, cy + 2, lit)


def outside(x0, y0, x1, y1):
    night = TOD == "night"
    hz = y1 - 22
    rng = random.Random(21)
    far = "SLATE_0" if night else ("SLATE_1" if TOD != "dawn" else "PLUM_1")
    roofl = {"golden": "RIM", "dawn": "PLUM_3", "midday": "SLATE_2", "night": "SLATE_1"}[TOD]
    # far skyline (slate)
    x = x0
    while x < x1:
        w = rng.randint(6, 12)
        h = rng.randint(4, 10)
        POLY([(x, hz + 4), (x, hz - h + 3), (x + w // 2, hz - h), (x + w, hz - h + 3), (x + w, hz + 4)], far)
        if night and rng.random() < 0.6:
            P(x + w // 2, hz - h + 5, "GLOW")
        x += w + rng.randint(0, 2)
    # live oaks
    def oak(cx, cy, rx, ry, seed):
        r2 = random.Random(seed)
        for _ in range(int(rx * ry / 3)):
            a = r2.uniform(0, math.tau)
            rr = r2.uniform(0, 1) ** 0.6
            xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
            ELL(xx - 4, yy - 2, xx + 4, yy + 2, "LEAF_0")
        if not night:
            for _ in range(int(rx * ry / 9)):
                a = r2.uniform(math.pi * 1.0, math.pi * 1.8)
                rr = r2.uniform(0.55, 1)
                xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
                R(xx, yy, xx + 2, yy, "LEAF_1")
                if r2.random() < 0.35:
                    P(xx + 2, yy, roofl if TOD == "golden" else "LEAF_2")
        # spanish moss strands
        for _ in range(6):
            mx = r2.randint(int(cx - rx * 0.8), int(cx + rx * 0.8))
            my = int(cy + ry * 0.4)
            L(mx, my, mx, my + r2.randint(3, 6), "SLATE_0" if not night else "INK")

    oak(x0 + 10, y0 + 40, 22, 30, 3)
    L(x0 + 10, y0 + 56, x0 + 12, y1, "INK")
    L(x0 + 11, y0 + 56, x0 + 13, y1, "LEAF_0")
    oak(x1 - 14, y0 + 30, 26, 26, 4)
    L(x1 - 18, y0 + 46, x1 - 14, y1, "INK")
    # power lines + pole
    px = x1 - 40
    L(px, y0 + 14, px, y1, "INK")
    L(px - 6, y0 + 18, px + 6, y0 + 18, "INK")
    for dy, s in ((18, 6), (22, 8)):
        sag(x0, y0 + dy + 6, px - 6, y0 + dy, s, "INK")
        sag(px + 6, y0 + dy, x1, y0 + dy + 3, 2, "INK")
    sag(x0, hz - 6, x1, hz - 8, 4, "INK")
    # near rooftops: slate-blue shotgun houses with lit gables
    near = "NAVY" if night else ("SLATE_0" if TOD != "midday" else "SLATE_1")
    x = x0 - 2
    while x < x1:
        w = rng.randint(10, 15)
        h = rng.randint(10, 15)
        top = y1 - h
        POLY([(x, y1), (x, top + 4), (x + w // 2, top), (x + w, top + 4), (x + w, y1)], near, "INK")
        L(x + 1, top + 4, x + w // 2, top + 1, roofl)
        L(x + w // 2, top + 1, x + w - 1, top + 4, "SLATE_1" if not night else "SLATE_0")
        if night or rng.random() < 0.4:
            R(x + 3, top + 7, x + 4, top + 9, "GLOW" if night else "INK")
        if night and rng.random() < 0.5:
            R(x + w - 5, top + 7, x + w - 4, top + 9, "SUN")
        x += w + rng.randint(1, 3)
    # red streetcar on the neutral ground
    sx0 = x0 + int((x1 - x0) * 0.24)
    sy = y1 - 15
    BOX(sx0, sy, sx0 + 34, sy + 9, "CRT_0", hi="CRT_1", sh="TERRA_0")
    for wx in range(sx0 + 3, sx0 + 32, 4):
        R(wx, sy + 2, wx + 2, sy + 4, "SUN" if night else "CREAM" if TOD != "golden" else "GLOW")
    L(sx0 + 1, sy + 6, sx0 + 33, sy + 6, "GOLD_DK")
    L(sx0 + 16, sy, sx0 + 22, hz - 7, "INK")
    R(sx0 + 3, sy + 10, sx0 + 7, sy + 10, "INK")
    R(sx0 + 27, sy + 10, sx0 + 31, sy + 10, "INK")
    if night:
        P(sx0 + 34, sy + 7, "SUN")
    L(x0, y1, x1, y1, "INK")


# ---------------------------------------------------------------- knight (replaces the obsidian figure)
KH = 134  # 10 ft at ~13.4 px/ft


def knight_parts():
    """Front-view part polygons (right half, mirrored), y from helm top 0 to feet 134, x from centre."""
    return [
        ("cape", None),
        ("upperarm", [(13, 31), (19, 31), (21, 47), (16, 50), (13, 45)]),
        ("forearm", [(15, 48), (20, 51), (11, 63), (5, 63), (6, 59)]),
        ("leg", [(3, 70), (11, 70), (11, 90), (10, 96), (10, 120), (12, 126), (13, 134), (2, 134), (3, 124), (3, 96), (3, 90)]),
        ("knee", [(2, 89), (11, 89), (12, 93), (10, 98), (3, 98), (2, 93)]),
        ("sabaton", [(2, 125), (11, 125), (14, 131), (14, 134), (1, 134)]),
        ("fauld", [(0, 54), (10, 54), (12, 64), (12, 72), (4, 74), (0, 72)]),
        ("breast", [(0, 21), (9, 21), (12, 25), (12, 38), (10, 48), (8, 53), (0, 55)]),
        ("gorget", [(0, 17), (6, 17), (7, 22), (0, 23)]),
        ("helm", [(0, 0), (4, 0), (6, 2), (7, 6), (7, 14), (5, 18), (0, 19)]),
        ("pauldron", [(6, 20), (13, 18), (19, 21), (22, 26), (21, 32), (16, 33), (10, 30), (7, 25)]),
        ("hand", [(0, 58), (7, 58), (8, 61), (7, 68), (0, 69)]),
    ]


def knight(tier, cx, yb, glitch=False):
    """Draw the knight into a local canvas, shade per part, then stamp (emissive: baked lighting)."""
    Wk, Hk = 72, 160
    ox, oy = Wk // 2, 22  # local origin: centre x, helm top y
    pid = Image.new("L", (Wk, Hk), 0)
    pd = ImageDraw.Draw(pid)
    parts = knight_parts()
    names = [p[0] for p in parts]
    gold_parts = {1: set(), 2: set(), 3: set(), 4: {"breast", "helm", "gorget", "pauldron"},
                  5: set(names) | {"sword"}}[tier]
    # cape behind
    cape = None
    if tier >= 3:
        bot = 78 if tier < 5 else 133
        wb = 22 if tier < 5 else 28
        cape = [(-17, 22), (17, 22), (wb, bot), (wb - 6, bot + 2), (0, bot - 2), (-wb + 6, bot + 2), (-wb, bot)]
        pd.polygon([(ox + x, oy + y) for x, y in cape], fill=1)
    for k, (nm, poly) in enumerate(parts):
        if poly is None:
            continue
        for sgn in (1, -1):
            pts = [(ox + sgn * x, oy + y) for x, y in poly]
            if nm == "hand" and sgn == -1:
                continue
            pd.polygon(pts, fill=k + 2)
    # left hand lower, right hand on top (stacked on the pommel)
    pd.polygon([(ox - 7, oy + 61), (ox + 1, oy + 61), (ox + 1, oy + 70), (ox - 6, oy + 70), (ox - 8, oy + 65)],
               fill=names.index("hand") + 2)
    pd.polygon([(ox - 1, oy + 57), (ox + 8, oy + 57), (ox + 8, oy + 66), (ox - 1, oy + 66)], fill=names.index("hand") + 2)
    # sword: pommel above hands, guard, blade down between legs
    SW = 40
    pd.ellipse([ox - 2, oy + 53, ox + 2, oy + 57], fill=SW)
    pd.rectangle([ox - 1, oy + 69, ox + 1, oy + 73], fill=SW)
    pd.polygon([(ox - 11, oy + 73), (ox + 11, oy + 73), (ox + 12, oy + 76), (ox - 12, oy + 76)], fill=SW + 1)
    pd.polygon([(ox - 3, oy + 76), (ox + 3, oy + 76), (ox + 2, oy + 128), (ox, oy + 133), (ox - 2, oy + 128)], fill=SW + 2)
    A = np.array(pid)
    sil = A > 0
    out = np.full((Hk, Wk), T, np.uint8)
    em = np.zeros((Hk, Wk), bool)

    iron = ("BROWN_1", "SLATE_0", "SLATE_1", "SLATE_2")
    gold = ("GOLD_DK", "GOLD", "SUN", "CREAM")
    if tier == 1:
        iron = ("BROWN_1", "SLATE_0", "SLATE_1", "CREAM")
    capec = ("TERRA_0", "CRT_0", "CRT_1")

    for y in range(Hk):
        row = A[y]
        for x in range(Wk):
            p = row[x]
            if p == 0:
                continue
            if p == 1:
                # cape: folds
                c = capec[1] if (x // 3) % 2 else capec[0]
                if x > ox + 14 and y < oy + 60:
                    c = capec[2]
                out[y, x] = N[c]
                continue
            if p >= SW:
                nm = "sword"
            else:
                nm = names[p - 2]
            ramp = gold if nm in gold_parts else iron
            if nm == "sword" and tier < 5:
                ramp = ("SLATE_0", "SLATE_1", "SLATE_2", "CREAM") if p == SW + 2 else iron
                if p == SW + 1 and tier >= 3:
                    ramp = gold
            # local span of this part on the row
            xs = np.where(row == p)[0]
            u = (x - xs.min()) / max(1, xs.max() - xs.min())
            c = ramp[1]
            if u < 0.28:
                c = ramp[0]
            elif u > 0.72:
                c = ramp[2]
            if y > 0 and A[y - 1, x] != p and nm not in ("leg", "sword"):
                c = ramp[2]  # top light from the downlight
            if x + 1 < Wk and A[y, x + 1] == 0:
                c = ramp[3]  # window rim on the right edge
            out[y, x] = N[c]
    # seams between different parts
    seam = None
    if tier == 1:
        seam = "INK"
    elif tier == 2:
        seam = "GOLD"
    else:
        seam = "GOLD_DK" if tier < 5 else "AMBER"
    for y in range(1, Hk - 1):
        for x in range(1, Wk - 1):
            p = A[y, x]
            if p <= 1:
                continue
            q = A[y - 1, x]
            r = A[y, x - 1]
            if (q > 1 and q != p and not (q >= SW and p >= SW)) or (r > 1 and r != p and not (r >= SW and p >= SW)):
                out[y, x] = N[seam]
                if tier == 2:
                    em[y, x] = True
    # gold trim on pauldrons + gauntlets (III), helm crest ridge
    pa, ha = names.index("pauldron") + 2, names.index("hand") + 2
    fa = names.index("forearm") + 2
    if tier >= 3:
        for y in range(Hk):
            for x in range(Wk):
                p = A[y, x]
                if p in (pa, ha) or (p == fa and tier >= 3):
                    nb = [A[y + dy, x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= y + dy < Hk and 0 <= x + dx < Wk]
                    if any(n != p for n in nb):
                        if p == fa and not any(n == 0 for n in nb):
                            continue
                        out[y, x] = N["SUN" if x > ox else "GOLD"]
    # visor slit
    vis = {1: ("VOID", "VOID"), 2: ("NAVY", "ENERGY"), 3: ("NAVY", "ENERGY"), 4: ("ENERGY", "ENERGY_HI"), 5: ("ENERGY", "ENERGY_HI")}[tier]
    for x in range(ox - 5, ox + 6):
        out[oy + 8, x] = N[vis[0]]
        out[oy + 9, x] = N["INK"] if tier == 1 else N[vis[0]]
    if tier >= 2:
        for x in range(ox - 2 if tier == 2 else ox - 4, ox + (3 if tier == 2 else 5)):
            out[oy + 8, x] = N[vis[1]]
            em[oy + 8, x] = True
    out[oy + 11:oy + 16, ox] = N["INK" if tier < 5 else "GOLD_DK"]  # helm centre seam / breath line
    # energy lines
    if tier >= 3:
        core = "ENERGY" if tier == 3 else "ENERGY_HI"
        segs = [((-5, 25), (-4, 49)), ((5, 25), (4, 49)), ((-7, 57), (-8, 70)), ((7, 57), (8, 70)),
                ((-6, 99), (-6, 121)), ((6, 99), (6, 121)), ((-7, 73), (-7, 87)), ((7, 73), (7, 87)),
                ((14, 24), (19, 27)), ((-14, 24), (-19, 27)), ((0, 80), (0, 124))]
        if tier >= 4:
            segs += [((-3, 3), (-3, 7)), ((3, 3), (3, 7)), ((-17, 36), (-18, 46)), ((17, 36), (18, 46))]
        im2 = Image.new("L", (Wk, Hk), 0)
        d2 = ImageDraw.Draw(im2)
        for (ax, ay), (bx, by) in segs:
            d2.line([ox + ax, oy + ay, ox + bx, oy + by], fill=1)
        M = (np.array(im2) > 0) & sil
        out[M] = N[core]
        em[M] = True
        if tier >= 4:  # halo pixels beside the lines
            Mh = np.zeros_like(M)
            Mh[:, 1:] |= M[:, :-1]
            Mh[:, :-1] |= M[:, 1:]
            Mh &= sil & ~M
            Mh &= np.isin(out, [N["SLATE_0"], N["BROWN_1"], N["GOLD_DK"], N["INK"]])
            out[Mh] = N["ENERGY"]
            em[Mh] = True
    # chest emblem (IV, V): tiny anvil
    if tier >= 4:
        for dx, dy in ((-3, 0), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (3, 0), (-1, 1), (0, 1), (1, 1), (0, 2), (-2, 3), (-1, 3), (0, 3), (1, 3), (2, 3)):
            out[oy + 33 + dy, ox + dx] = N["ENERGY_HI"]
            em[oy + 33 + dy, ox + dx] = True
    # outline
    ol = np.zeros_like(sil)
    ol[1:, :] |= sil[:-1, :]
    ol[:-1, :] |= sil[1:, :]
    ol[:, 1:] |= sil[:, :-1]
    ol[:, :-1] |= sil[:, 1:]
    ol &= ~sil
    out[ol] = N["INK"]
    # crest / halo (V), plume (V)
    if tier >= 5:
        hal = Image.new("L", (Wk, Hk), 0)
        ImageDraw.Draw(hal).ellipse([ox - 14, oy - 12, ox + 14, oy + 14], outline=1)
        Mh = (np.array(hal) > 0) & (out == T)
        out[Mh] = N["SUN"]
        em[Mh] = True
        for i, (dx, dy) in enumerate(((0, -1), (1, -2), (-1, -2), (0, -3), (1, -4), (2, -5), (0, -5), (3, -6), (1, -6))):
            out[oy + dy, ox + dx] = N["CRT_1" if i % 3 else "CRT_0"]
    # glitch (tier-up hologram flicker)
    if glitch:
        rng = random.Random(9)
        for _ in range(7):
            y = rng.randint(0, Hk - 1)
            sh = rng.choice((-3, -2, 2, 3))
            out[y] = np.roll(out[y], sh)
            em[y] |= out[y] != T
            row = out[y]
            row[(row != T) & (np.arange(Wk) % 3 == 0)] = N["ENERGY"]
    # stamp
    x0 = int(cx) - ox
    y0 = int(yb) - KH - oy
    m = out != T
    a = np.array(S.im)
    e = np.array(S.em)
    hs, ws = a[y0:y0 + Hk, x0:x0 + Wk].shape
    a[y0:y0 + hs, x0:x0 + ws][m[:hs, :ws]] = out[:hs, :ws][m[:hs, :ws]]
    e[y0:y0 + hs, x0:x0 + ws][m[:hs, :ws]] = 255  # knight keeps its baked light (brightest object)
    S.im = Image.fromarray(a, "P")
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)
    S.em = Image.fromarray(e, "L")
    S.de = ImageDraw.Draw(S.em)


KN_X, KN_Z = -4.0, 1.3


def knight_zone():
    cx, _ = pj(KN_X, 0, 0)
    # tapestry with an original anvil-and-hammer emblem
    with obj("tapestry"):
        tx0, ty0 = pji(KN_X - 2.4, CEIL - 0.25, 0)
        tx1, ty1 = pji(KN_X + 2.4, 4.6, 0)
        L(tx0 - 3, ty0, tx1 + 3, ty0, "GOLD_DK")
        P(tx0 - 4, ty0, "GOLD")
        P(tx1 + 4, ty0, "GOLD")
        mid = (tx0 + tx1) // 2
        POLY([(tx0, ty0 + 1), (tx1, ty0 + 1), (tx1, ty1), (mid, ty1 + 9), (tx0, ty1)], "TERRA_0", "INK")
        POLY([(tx0 + 3, ty0 + 3), (tx1 - 3, ty0 + 3), (tx1 - 3, ty1 - 1), (mid, ty1 + 6), (tx0 + 3, ty1 - 1)], "PLUM_1")
        POLY([(tx0 + 4, ty0 + 4), (tx1 - 4, ty0 + 4), (tx1 - 4, ty1 - 2), (mid, ty1 + 4), (tx0 + 4, ty1 - 2)], "TERRA_0")
        for yy in range(ty0 + 4, ty1, 6):
            P(tx0 + 3, yy, "GOLD")
            P(tx1 - 3, yy, "GOLD")
        # emblem: anvil with a hammer striking, three sparks (original)
        ey = ty0 + 7
        R(mid - 8, ey + 9, mid + 7, ey + 10, "GOLD")          # anvil face
        POLY([(mid - 11, ey + 9), (mid - 8, ey + 9), (mid - 8, ey + 11)], "GOLD")  # horn
        R(mid - 4, ey + 11, mid + 3, ey + 13, "GOLD_DK")      # waist
        R(mid - 7, ey + 14, mid + 6, ey + 15, "GOLD")         # base
        L(mid + 1, ey + 7, mid + 8, ey, "OAK_2")              # hammer handle
        R(mid - 1, ey + 3, mid + 3, ey + 6, "GOLD")           # hammer head (tilted)
        P(mid - 1, ey + 3, "SUN")
        for dx, dy in ((-6, 5), (-9, 3), (-4, 2)):
            P(mid + dx, ey + dy, "SUN")
    # pedestal with runes
    with obj("pedestal"):
        f = box3d(KN_X - 1.8, KN_X + 1.8, 0, 1.0, KN_Z - 1.2, KN_Z + 1.0, "BROWN_1", side="INK", top="SLATE_0")
        (ax, ay), (bx, by), (cx2, cy2), (dx, dy) = f["front"]
        R(ax + 1, ay + 1, bx - 1, ay + 1, "SLATE_1")
        # plaque (tier name only)
        names = {1: "|*RAW", 2: "||*AWAKENED", 3: "|||*FORGED", 4: "|V*ASCENDANT", 5: "V*SOVEREIGN"}
        s = names[TIER].replace("V", "V")
        tw = text_w(s)
        px0 = int((ax + bx) / 2 - tw / 2) - 2
        BOX(px0, ay + 3, px0 + tw + 3, ay + 10, "GOLD_DK", hi="GOLD")
        text(px0 + 2, ay + 4, s, "SUN")
        # runes pulsing up the base: cyan marks + vertical lines on the corners
        for i, rx in enumerate(range(int(ax) + 3, int(bx) - 2, 5)):
            if px0 - 2 <= rx <= px0 + tw + 5:
                continue
            P(rx, ay + 5 + (i % 2), "ENERGY!")
            P(rx + 1, ay + 6 - (i % 2), "ENERGY!")
            P(rx, ay + 8, "SLATE_1")
        for x in (int(ax) + 1, int(bx) - 1):
            L(x, ay + 2, x, dy - 2, "ENERGY!")
        L(ax + 2, ay - 1, bx - 2, ay - 1, "ENERGY!")
        shadow_fp(KN_X - 1.8, KN_X + 1.8, KN_Z - 1.2, KN_Z + 1.0)
    # knight
    with obj("knight", emit=True):
        _, ky = pj(KN_X, 1.0, KN_Z)
        knight(TIER, cx, ky - 2)
    kx, ky = pj(KN_X, 5, KN_Z)
    light(kx, ky, 40, 80, 1.0)
    light(kx, pj(0, 0.5, KN_Z)[1], 46, 18, 0.8)
    tint(kx, pj(0, 1.0, KN_Z)[1] - 6, 34, 24, "cyan", 1.0)
    tint(kx, ky - 6, 30, 62, "cyan", 0.5 + 0.12 * TIER)
    if FLAGS["beam"]:
        G.beam = True


def decheck(name):
    """Resolve 2x2 checkerboards inside one object (keeps its clusters flat for the grain check)."""
    ids = [k for k, v in G.names.items() if v == name]
    m = np.isin(G.oid, ids)
    a = G.img
    for _ in range(4):
        A, B, C, D = a[:-1, :-1], a[:-1, 1:], a[1:, :-1], a[1:, 1:]
        w = (A == D) & (B == C) & (A != B) & m[:-1, :-1] & m[:-1, 1:] & m[1:, :-1] & m[1:, 1:]
        if not w.any():
            break
        ys, xs = np.nonzero(w)
        a[ys + 1, xs + 1] = a[ys, xs + 1]


def edge_light_knight():
    """Cyan pedestal light licking up the outer edges of the legs (after compositing)."""
    kid = [k for k, v in G.names.items() if v == "knight"][0]
    m = G.oid == kid
    cx, _ = pj(KN_X, 0, 0)
    _, ky = pj(KN_X, 1.0, KN_Z)
    for y in range(int(ky) - 26, int(ky) - 2):
        xs = np.where(m[y])[0]
        if len(xs) == 0:
            continue
        for x in (xs.min() + 1, xs.max() - 1):
            if G.img[y, x] != N["INK"] and (int(ky) - y) % 3 != 0:
                G.img[y, x] = N["ENERGY"]


# ---------------------------------------------------------------- zone 3: library (back wall left)
def library():
    rng = random.Random(31)
    # potion shelf on the wall (bubbling, glowing bottles)
    with obj("potions"):
        x0, y0 = pji(-14.3, 8.6, 0)
        x1, _ = pji(-12.3, 8.6, 0)
        for k, Yb in enumerate((8.6, 7.1)):
            _, yb = pji(0, Yb, 0)
            R(x0, yb, x1, yb + 2, "OAK_1")
            L(x0, yb + 2, x1, yb + 2, "INK")
            L(x0, yb, x1, yb, "OAK_2")
            cols = [("PLUM_2", "PLUM_3"), ("LEAF_2", "LEAF_3"), ("SLATE_1", "ENERGY"), ("CRT_0", "CRT_1"), ("GOLD", "SUN")]
            x = x0 + 2
            i = k * 2
            while x < x1 - 3:
                a, b = cols[i % len(cols)]
                h = 5 + (i % 3)
                R(x, yb - h, x + 3, yb - 1, "INK")
                R(x + 1, yb - h + 2, x + 2, yb - 1, a + "!")
                P(x + 1, yb - h + 3 + (i % 2), b + "!")
                R(x + 1, yb - h - 1, x + 2, yb - h, "OAK_2")  # cork
                if (i + af("potions")) % 2 == 0:
                    P(x + 2 - (i + af("potions")) % 2, yb - h - 2 - ((i + af("potions")) % 3), b + "!")  # bubble
                x += 5
                i += 1
        light((x0 + x1) / 2, (y0 + 0) + 8, 22, 22, 0.5)
        tint((x0 + x1) / 2, y0 + 6, 22, 20, "potion", 0.8)
    # bookcase (Reading): 9 ft
    with obj("bookcase"):
        f = box3d(-12.0, -8.6, 0, 9.0, 0, 1.1, "OAK_1", side="OAK_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 3, ay + 3, bx - 3, dy - 4, "OAK_DK")
        L(ax + 1, ay + 1, bx - 1, ay + 1, "OAK_2")
        shelves = 7
        hgt = (dy - 4 - (ay + 3)) / shelves
        for k in range(shelves):
            yb = int(ay + 3 + (k + 1) * hgt) - 1
            R(ax + 3, yb, bx - 3, yb + 1, "OAK_1")
            L(ax + 3, yb + 1, bx - 3, yb + 1, "OAK_0")
            if k < shelves - 1:
                books_row(ax + 4, bx - 4, yb - 1, int(hgt) - 3, rng,
                          n_fill=(0.3, 0.85, 1.0)[stg("library.bookshelf")] * (1 if k != 2 else 0.7))
                if stg("library.bookshelf") == 2 and k % 2 == 0:
                    R(bx - 6, yb - 6, bx - 5, yb - 1, "GOLD")   # gold bookends
            else:
                R(ax + 3, yb - int(hgt) + 3, bx - 3, yb - 1, "OAK_0")
                L((ax + bx) // 2, yb - int(hgt) + 3, (ax + bx) // 2, yb - 1, "OAK_DK")
        R(ax + 1, ay - 2, bx - 1, ay, "OAK_1")  # cornice
        L(ax, ay - 2, bx, ay - 2, "INK")
        shadow_fp(-12.0, -8.6, 0, 1.1)
    # trophy case (glass, soft steady light): relics inside
    with obj("trophy-case"):
        f = box3d(-8.3, -6.6, 0, 5.4, 0, 1.2, "OAK_DK", side="OAK_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 2, ay + 3, bx - 2, dy - 6, "SLATE_0")
        for k, yy in enumerate((ay + 18, ay + 36, ay + 54)):
            if yy < dy - 6:
                L(ax + 2, yy, bx - 2, yy, "SLATE_1")
        L(ax + 3, ay + 4, ax + 3, dy - 8, "SLATE_2")   # glass glint
        L(ax + 4, ay + 4, ax + 4, ay + 10, "CREAM")
        R(ax + 2, ay + 2, bx - 2, ay + 2, "CREAM!")    # soft top strip light
        # relics on shelves (small, one ember)
        cx = (ax + bx) // 2
        POLY([(cx - 3, ay + 17), (cx - 4, ay + 11), (cx + 4, ay + 11), (cx + 3, ay + 17)], "GOLD", "INK")
        R(cx - 1, ay + 31, cx + 2, ay + 35, "SLATE_2")
        P(cx, ay + 30, "CREAM")
        R(cx - 3, ay + 50, cx + 3, ay + 53, "OAK_2")
        P(cx - 1, ay + 49, "GOLD")
        shadow_fp(-8.3, -6.6, 0, 1.2)
        light(cx, ay + 20, 12, 22, 0.25)
    # floor lamp behind the chair
    with obj("floor-lamp"):
        bx_, by_ = pj(-10.2, 0, 2.6)
        tx_, ty_ = pj(-10.2, 5.4, 2.6)
        L(bx_, by_, tx_, ty_ + 3, "INK")
        R(bx_ - 3, by_ - 1, bx_ + 3, by_, "INK")
        on = TOD in ("golden", "night")
        shade = "SUN!" if on else "CREAM"
        POLY([(tx_ - 3, ty_ - 6), (tx_ + 3, ty_ - 6), (tx_ + 6, ty_ + 3), (tx_ - 6, ty_ + 3)], "GLOW!" if on else "AMBER", "INK")
        R(tx_ - 2, ty_ - 5, tx_ + 3, ty_ + 1, shade)
        L(tx_ - 5, ty_ + 2, tx_ + 5, ty_ + 2, "GLOW!" if on else "OAK_2")
        if on:
            light(tx_, ty_ + 18, 40, 50, 1.0 if TOD == "night" else 0.7)
        shadow_ell(bx_, by_, 6, 2)
    # reading chair + throw + cushion
    with obj("reading-chair"):
        X0, X1, z0, z1 = -11.4, -8.6, 3.6, 6.0
        box3d(X0, X1, 1.4, 3.6, z0, z0 + 0.8, "TERRA_0", side="TERRA_0", top="TERRA_1")  # tall back
        bt = pj(X0, 3.6, z0 + 0.8)
        bt2 = pj(X1, 3.6, z0 + 0.8)
        R(bt[0] + 2, bt[1] - 2, bt2[0] - 2, bt[1], "TERRA_1")  # rounded top roll
        L(bt[0] + 3, bt[1] - 2, bt2[0] - 3, bt[1] - 2, "TERRA_2")
        P(bt[0] + 1, bt[1] - 1, "INK")
        P(bt2[0] - 1, bt[1] - 1, "INK")
        box3d(X0, X1, 0.35, 1.4, z0, z1, "TERRA_1", side="TERRA_0", top="TERRA_2")   # seat
        box3d(X0, X0 + 0.55, 0.35, 2.3, z0, z1, "TERRA_1", side="TERRA_1", top="TERRA_2")  # left arm
        box3d(X1 - 0.55, X1, 0.35, 2.3, z0, z1, "TERRA_1", side="TERRA_0", top="TERRA_2")  # right arm
        a = pj(X0 + 0.7, 2.7, z0 + 0.85)
        b = pj(X1 - 0.7, 1.5, z0 + 0.85)
        R(a[0], a[1], b[0], b[1], "PLUM_2")      # cushion
        L(a[0], a[1], b[0], a[1], "PLUM_3")
        L(a[0], b[1], b[0], b[1], "PLUM_1")
        # throw blanket draped over the left arm
        t0, t1 = pj(X0 - 0.05, 2.35, z0 + 1.0), pj(X0 + 0.65, 1.0, z1 - 0.6)
        R(t0[0], t0[1], t1[0], t0[1] + 7, "SLATE_1")
        L(t0[0], t0[1], t1[0], t0[1], "SLATE_2")
        L(t0[0], t0[1] + 7, t1[0], t0[1] + 7, "SLATE_0")
        for xx in (pj(X0 + 0.15, 0, z1)[0], pj(X1 - 0.15, 0, z1)[0]):
            R(xx - 1, pj(0, 0, z1)[1], xx, pj(0, 0, z1)[1] + 1, "INK")
        shadow_fp(X0, X1, z0, z1)
    # side table with the finished-book stack (growth piece) beside it on the floor
    with obj("side-table"):
        box3d(-7.4, -6.2, 1.9, 2.1, 4.4, 5.4, "OAK_1", side="OAK_0", top="OAK_2")
        a = pj(-6.8, 0, 4.9)
        b = pj(-6.8, 1.9, 4.9)
        L(a[0], a[1], b[0], b[1], "OAK_DK")
        R(a[0] - 3, a[1] - 1, a[0] + 3, a[1], "OAK_0")
        mx, my = pj(-6.8, 2.1, 4.8)
        BOX(mx - 2, my - 4, mx + 2, my, "TERRA_1", hi="TERRA_2")   # mug
        P(mx + 3, my - 2, "INK")
        shadow_fp(-7.4, -6.2, 4.4, 5.4, k=1.0)
    with obj("book-stack"):
        bx_, by_ = pj(-7.4, 0, 6.6)
        cols = ["SLATE_1", "TERRA_1", "GOLD_DK", "LEAF_2", "PLUM_1", "CREAM"]
        y = by_
        for i, c in enumerate(cols):
            w = 11 - (i % 3)
            o = (i % 2)
            R(bx_ - w // 2 + o, y - 2, bx_ + w // 2 + o, y, c)
            L(bx_ - w // 2 + o, y - 2, bx_ + w // 2 + o, y - 2, LIGHTER.get(c, c))
            P(bx_ + w // 2 + o, y - 1, "INK")
            y -= 3
        shadow_ell(bx_, by_, 8, 2)


# ---------------------------------------------------------------- zone 2: bed (left wall back)
@contextmanager
def wallside(k=0.55):
    COMP["k"] = k
    yield
    COMP["k"] = None


def bed_zone():
    with wallside(0.72):
        _bed_zone()


def _bed_zone():
    rng = random.Random(41)
    # framed piece + small shelf with trailing plant and the plasma globe (on the left wall)
    with obj("bed-frame-art"):
        wall_frame("L", 1.2, 3.6, 5.0, 7.0, "OAK_1", "SLATE_0")
        q = wallq("L", 1.5, 3.3, 5.3, 6.7, 0.04)
        # simple mountain + sun art (original)
        POLY([q[3], q[2], pj(-WX + 0.04, 6.1, 2.7), pj(-WX + 0.04, 5.6, 2.1), pj(-WX + 0.04, 6.3, 1.8)], "PLUM_1")
        P(*pj(-WX + 0.04, 6.4, 2.9), "GOLD")
    with obj("bed-shelf"):
        q = wallq("L", 4.0, 6.2, 5.6, 5.85, 0.0)
        quad([q[0], q[1], pj(-WX + 0.8, 5.85, 6.2), pj(-WX + 0.8, 5.85, 4.0)], "OAK_2", "INK")
        quad([pj(-WX + 0.8, 5.85, 4.0), pj(-WX + 0.8, 5.85, 6.2), pj(-WX + 0.8, 5.6, 6.2), pj(-WX + 0.8, 5.6, 4.0)], "OAK_1", "INK")
        # trailing plant
        px, py = pj(-WX + 0.4, 5.85, 5.7)
        pot(px - 3, py - 4, px + 3, py, "TERRA_1")
        bush(px, py - 6, 5, 3, rng, n=18)
        for i in range(4):
            vine(int(px) - 3 + i * 2, int(py) + 1, rng.randint(10, 22), rng, drift=0.2)
    with obj("plasma-globe"):
        gx, gy = pj(-WX + 0.45, 6.45, 4.6)
        R(gx - 3, gy + 4, gx + 3, gy + 6, "INK")
        L(gx - 2, gy + 4, gx + 2, gy + 4, "SLATE_0")
        circ(gx, gy, 5, "INK")
        circ(gx, gy, 4, "NAVY!")
        ro = 0.55 * af("globe")
        for a in (0.3, 1.7, 2.9, 4.4, 5.5):
            L(gx, gy, gx + math.cos(a + ro) * 4, gy + math.sin(a + ro) * 4, "VIOLET!")
        P(gx + math.cos(1.7 + ro) * 4, gy + math.sin(1.7 + ro) * 4, "PLUM_3!")
        P(gx + math.cos(4.4 + ro) * 4, gy + math.sin(4.4 + ro) * 4, "PLUM_3!")
        circ(gx, gy, 1, "CREAM!")
        P(gx - 2, gy - 3, "CREAM")
        light(gx, gy, 26, 22, 0.6)
        tint(gx, gy, 28, 24, "violet", (1.0, 0.8, 1.2)[af("globe")])
    # headboard (against the back wall corner), platform bed along the left wall
    X0, X1, z0, z1 = -WX, -14.0, 0.2, 7.0
    with obj("headboard"):
        box3d(X0, X1, 0, 3.4, 0.0, 0.35, "OAK_1", side="OAK_0", top="OAK_2")
        a, b = pj(X0 + 0.3, 3.1, 0.36), pj(X1 - 0.3, 1.4, 0.36)
        R(a[0], a[1], b[0], b[1], "OAK_0")
        for X in (-17.0, -16.2, -15.4, -14.7):
            p, q2 = pj(X, 3.0, 0.36), pj(X, 1.5, 0.36)
            L(p[0], p[1], q2[0], q2[1], "OAK_DK")
    with obj("bed"):
        # platform
        box3d(X0, X1, 0, 0.9, z0, z1, "OAK_1", side="OAK_1", top="OAK_2")
        # mattress + lilac quilt (soft, rounded)
        f = box3d(X0, X1 - 0.1, 0.8, 1.7, z0 + 0.05, z1 - 0.1, "PLUM_1", side="VIOLET", top="VIOLET")
        # quilt squares on the top + stitched drape on the side
        for k in range(1, 7):
            z = z0 + 1.6 + (z1 - z0 - 1.6) * k / 7
            a, b = pj(X0, 1.7, z), pj(X1 - 0.1, 1.7, z)
            L(a[0], a[1], b[0], b[1], "PLUM_1")
            c, d = pj(X1 - 0.1, 1.7, z), pj(X1 - 0.1, 0.85, z)
            L(c[0], c[1], d[0], d[1], "PLUM_1")
            m = pj(X0 + 1.0, 1.7, z - 0.4)
            P(m[0], m[1], "PLUM_3")
        a, b = pj(X1 - 0.1, 1.65, z0 + 1.6), pj(X1 - 0.1, 1.65, z1 - 0.2)
        L(a[0], a[1], b[0], b[1], "PLUM_3")
        # sheet folded back at the head
        q = [pj(X0, 1.75, z0 + 1.15), pj(X1 - 0.1, 1.75, z0 + 1.15), pj(X1 - 0.1, 1.75, z0 + 1.6), pj(X0, 1.75, z0 + 1.6)]
        POLY(q, "CREAM", "INK")
        # folded throw at the foot
        fz = z1 - 1.1
        q = [pj(X0, 1.8, fz), pj(X1 - 0.05, 1.8, fz), pj(X1 - 0.05, 1.8, z1 - 0.2), pj(X0, 1.8, z1 - 0.2)]
        POLY(q, "SLATE_1", "INK")
        q2 = [pj(X1 - 0.05, 1.8, fz), pj(X1 - 0.05, 1.8, z1 - 0.2), pj(X1 - 0.05, 1.0, z1 - 0.2), pj(X1 - 0.05, 1.0, fz)]
        POLY(q2, "SLATE_0", "INK")
        # pillows at the head
        for zz, c in ((z0 + 0.15, "SLATE_2"), (z0 + 0.55, "CREAM")):
            a, b = pj(X0 + 0.1, 2.45, zz), pj(X1 - 0.3, 1.7, zz + 0.45)
            ELL(min(a[0], b[0]), a[1], max(a[0], b[0]), b[1] + 1, c, "INK")
            L(min(a[0], b[0]) + 2, a[1] + 1, max(a[0], b[0]) - 2, a[1] + 1, "CREAM")
        shadow_fp(X0, X1, z0, z1)
    # nightstand with alarm clock (Sleep) + jar of paper stars
    with obj("nightstand"):
        box3d(-14.0, -12.6, 0, 2.0, 0.05, 1.4, "OAK_1", side="OAK_0", top="OAK_2")
        a, b = pj(-13.9, 1.4, 1.41), pj(-12.7, 1.4, 1.41)
        L(a[0], a[1], b[0], b[1], "OAK_DK")
        P((a[0] + b[0]) / 2, a[1] + 2, "GOLD")
        shadow_fp(-14.0, -12.6, 0.05, 1.4)
    with obj("alarm-clock"):
        cx_, cy_ = pj(-13.6, 2.0, 0.8)
        BOX(cx_ - 4, cy_ - 5, cx_ + 3, cy_, "CRT_0", hi="CRT_1", sh="TERRA_0")
        R(cx_ - 3, cy_ - 3, cx_ + 2, cy_ - 2, "INK")
        P(cx_ - 2, cy_ - 3, "CRT_1!")
        P(cx_, cy_ - 3, "CRT_1!")
        P(cx_ + 1, cy_ - 2, "CRT_1!")
        P(cx_ - 4, cy_ - 6, "GOLD")
        P(cx_ + 3, cy_ - 6, "GOLD")
    with obj("star-jar"):
        jx, jy = pj(-13.0, 2.0, 0.8)
        BOX(jx - 2, jy - 6, jx + 2, jy, "SLATE_1", hi="SLATE_2")
        R(jx - 2, jy - 7, jx + 2, jy - 7, "OAK_2")
        for dx, dy, c in ((-1, -2, "GOLD"), (0, -4, "PLUM_3"), (1, -1, "SUN"), (0, -2, "CREAM")):
            P(jx + dx, jy + dy, c)
    # meditation: small round rug at the foot of the bed, cushion + candle
    with obj("med-rug"):
        rx, ry = pj(-11.6, 0, 8.6)
        s = sc(8.6)
        ELL(rx - 1.8 * s, ry - 0.42 * s, rx + 1.8 * s, ry + 0.42 * s, "PLUM_1", "INK")
        ELL(rx - 1.4 * s, ry - 0.3 * s, rx + 1.4 * s, ry + 0.3 * s, "PLUM_2")
        ELL(rx - 0.9 * s, ry - 0.18 * s, rx + 0.9 * s, ry + 0.18 * s, "PLUM_1")
    with obj("med-cushion"):
        rx, ry = pj(-11.9, 0, 8.6)
        ELL(rx - 9, ry - 6, rx + 9, ry + 2, "TERRA_1", "INK")
        ELL(rx - 7, ry - 6, rx + 7, ry - 2, "TERRA_2")
        P(rx, ry - 4, "TERRA_0")
        shadow_ell(rx, ry + 1, 10, 3, k=1.0)
    with obj("med-candle"):
        cx_, cy_ = pj(-10.0, 0, 8.4)
        if stg("bed.cushion") > 0:   # s0: the cushion alone
            BOX(cx_ - 2, cy_ - 6, cx_ + 1, cy_, "CREAM", hi="CREAM", sh="AMBER")
            flame(cx_, cy_ - 8, big=True)
            light(cx_, cy_ - 8, 16, 12, 0.5)


# ---------------------------------------------------------------- zone 1: kitchen (left wall front)
def kitchen():
    with wallside():
        _kitchen()


def _kitchen():
    rng = random.Random(51)
    # corkboard (College Integration) above the fridge
    with obj("corkboard-kitchen"):
        wall_frame("L", 7.3, 9.5, 6.7, 8.7, "OAK_1", "OAK_2")
        notes = ((7.6, 8.2, "CREAM"), (8.3, 8.3, "SLATE_2"), (8.9, 8.0, "PLUM_3"), (7.8, 7.4, "GOLD"),
                 (8.6, 7.3, "CREAM"), (9.0, 7.1, "TERRA_2"), (7.5, 7.0, "LEAF_3"), (8.1, 7.0, "SLATE_2"))
        for z, Y, c in notes[:(3, 6, 8)[stg("kitchen.door")]]:
            q = wallq("L", z, z + 0.45, Y - 0.5, Y, 0.04)
            quad(q, c)
            P(*pj(-WX + 0.05, Y - 0.05, z + 0.2), "CRT_1")
    # relic mount (left) above the counter
    with obj("relic-mount-L"):
        q = wallq("L", 10.4, 11.4, 7.7, 8.0, 0.0)
        quad([q[0], q[1], pj(-WX + 0.6, 8.0, 11.4), pj(-WX + 0.6, 8.0, 10.4)], "OAK_1", "INK")
        quad(wallq("L", 10.5, 11.3, 7.5, 7.7, 0.02), "OAK_DK", "INK")
        x, y = pj(-WX + 0.3, 8.6, 10.9)
        relic_slot("kitchen.relic", x, y)
    # fridge (real depth: side panel, door with handle facing the room)
    FX0, FX1, fz0, fz1 = -WX, -15.2, 7.3, 9.6
    with obj("fridge"):
        f = box3d(FX0, FX1, 0, 6.2, fz0, fz1, "SLATE_1", side="SLATE_2", top="SLATE_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        # side panel shading: darker toward the wall
        R(ax + 1, ay + 1, ax + (bx - ax) * 0.45, dy - 1, "SLATE_0")
        L(ax + 1, ay + 1, bx - 1, ay + 1, "SLATE_2")
        R(ax + 1, dy - 5, bx - 1, dy - 1, "INK")            # kick plate
        # magnets on the side panel
        for (u, v, c) in ((0.6, 0.25, "CRT_1"), (0.75, 0.32, "GOLD"), (0.55, 0.42, "LEAF_3")):
            P(ax + (bx - ax) * u, ay + (dy - ay) * v, c)
        # door split + handles on the room face
        a, b = pj(FX1, 4.1, fz0 + 0.05), pj(FX1, 4.1, fz1 - 0.05)
        L(a[0], a[1], b[0], b[1], "INK")
        h0, h1 = pj(FX1, 5.6, fz1 - 0.35), pj(FX1, 4.4, fz1 - 0.35)
        L(h0[0], h0[1], h1[0], h1[1], "CREAM")
        h0, h1 = pj(FX1, 3.8, fz1 - 0.35), pj(FX1, 2.6, fz1 - 0.35)
        L(h0[0], h0[1], h1[0], h1[1], "CREAM")
        shadow_fp(FX0, FX1, fz0, fz1)
    # open shelf with jars + small plant above the counter
    with obj("kitchen-shelf"):
        q = wallq("L", 10.2, 13.2, 5.7, 5.9, 0.0)
        quad([q[0], q[1], pj(-WX + 0.7, 5.9, 13.2), pj(-WX + 0.7, 5.9, 10.2)], "OAK_2", "INK")
        quad([pj(-WX + 0.7, 5.9, 10.2), pj(-WX + 0.7, 5.9, 13.2), pj(-WX + 0.7, 5.7, 13.2), pj(-WX + 0.7, 5.7, 10.2)], "OAK_1", "INK")
        for z, c in ((10.6, "SLATE_2"), (11.2, "GOLD"), (11.8, "CREAM")):
            x, y = pj(-WX + 0.35, 5.9, z)
            BOX(x - 2, y - 6, x + 2, y, c, hi="CREAM")
            R(x - 2, y - 7, x + 2, y - 7, "OAK_1")
        x, y = pj(-WX + 0.35, 5.9, 12.6)
        pot(x - 3, y - 4, x + 3, y, "TERRA_1")
        bush(x, y - 6, 4, 3, rng, n=12)
    # switch panel low by the counter (Settings)
    with obj("switch-panel"):
        quad(wallq("L", 9.75, 10.2, 3.3, 4.1, 0.02), "CREAM", "INK")
        a = pj(-WX + 0.05, 3.85, 9.95)
        P(a[0], a[1], "SLATE_1")
        P(a[0], a[1] + 3, "SLATE_1")
    # counter: hardwood lower cabinets + butcher-block top
    CX0, CX1, cz0, cz1 = -WX, -15.6, 9.8, 14.2
    with obj("counter"):
        f = box3d(CX0, CX1, 0, 2.9, cz0, cz1, "OAK_1", side="OAK_1", top="OAK_2")
        # doors on the room face
        for k in range(4):
            za = cz0 + 0.15 + k * (cz1 - cz0) / 4
            zb = za + (cz1 - cz0) / 4 - 0.3
            q = [pj(CX1, 2.5, za), pj(CX1, 2.5, zb), pj(CX1, 0.5, zb), pj(CX1, 0.5, za)]
            POLY(q, "OAK_0", "OAK_DK")
            k0 = pj(CX1, 2.2, zb - 0.2)
            P(k0[0], k0[1], "GOLD")
        a, b = pj(CX1, 0.4, cz0), pj(CX1, 0.4, cz1)
        L(a[0], a[1], b[0], b[1], "INK")
        # top edge (butcher block lip)
        a, b = pj(CX1 + 0.05, 2.95, cz0), pj(CX1 + 0.05, 2.95, cz1)
        L(a[0], a[1], b[0], b[1], "AMBER")
        shadow_fp(CX0, CX1, cz0, cz1)
    with obj("kettle"):
        x, y = pj(-16.8, 2.95, 10.5)
        ELL(x - 4, y - 7, x + 4, y, "SLATE_1", "INK")
        L(x - 2, y - 6, x + 1, y - 6, "SLATE_2")
        L(x + 4, y - 5, x + 6, y - 7, "INK")
        R(x - 1, y - 9, x + 1, y - 8, "INK")
    with obj("water-jug"):
        x, y = pj(-16.6, 2.95, 11.4)
        BOX(x - 3, y - 11, x + 3, y, "SLATE_2", hi="CREAM")
        lvl = (0, 2, 5, 8)[grow("kitchen.water")]
        if lvl:
            R(x - 2, y - lvl - 1, x + 2, y - 1, "SLATE_1")    # water line
            L(x - 2, y - lvl - 1, x + 2, y - lvl - 1, "SLATE_2")
        R(x - 1, y - 13, x + 1, y - 12, "SLATE_0")
    with obj("fruit-basket"):
        x, y = pj(-16.5, 2.95, 12.4)
        POLY([(x - 7, y - 4), (x + 7, y - 4), (x + 5, y), (x - 5, y)], "OAK_2", "INK")
        L(x - 6, y - 2, x + 6, y - 2, "OAK_1")
        fr = ((-4, "CRT_1"), (-1, "LEAF_3"), (2, "GLOW"), (4, "CRT_0"), (0, "SUN"))
        n = (2, 5, 5)[stg("kitchen.food")]
        for dx, c in fr[:n]:
            circ(x + dx, y - 6 if dx != 0 else y - 8, 2, c)
        if n == 5:
            P(x - 1, y - 9, "LEAF_2")
        if stg("kitchen.food") == 2:   # a bunch of grapes and a pear on top
            circ(x - 3, y - 10, 2, "PLUM_2")
            P(x - 3, y - 11, "PLUM_3")
            circ(x + 3, y - 10, 2, "LEAF_3")
    with obj("envelope"):
        x, y = pj(-16.3, 2.95, 13.5)
        POLY([(x - 6, y - 3), (x + 6, y - 3), (x + 5, y), (x - 7, y)], "CREAM", "INK")
        L(x - 6, y - 3, x, y - 1, "SLATE_2")
        L(x, y - 1, x + 6, y - 3, "SLATE_2")
        if vk("kitchen.doormat") == "alert":   # a review is waiting: flap up, red seal
            POLY([(x - 6, y - 3), (x + 6, y - 3), (x, y - 7)], "CREAM", "INK")
            R(x - 1, y - 4, x, y - 3, "CRT_1")
        else:
            R(x - 1, y - 2, x, y - 2, "CRT_0")   # wax seal
    # big leafy floor plant (Gut Health) in the front-left corner
    with obj("gut-plant"):
        px, py = pj(-14.0, 0, 13.6)
        s = sc(13.6)
        pot(px - 8, py - 11, px + 8, py, "TERRA_1")
        L(px - 7, py - 9, px + 7, py - 9, "TERRA_0")
        gs = stg("kitchen.gut")
        for i in range(13):
            if gs == 0 and i % 2:
                continue
            a = -math.pi / 2 + (i - 6) * 0.24 + 0.08 * math.sin(i * 2.3)
            ln = (18 + 10 * abs(math.cos(i * 1.3))) * (0.6, 1.0, 1.18)[gs]
            big_leaf(px + (i - 6) * 0.6, py - 10, a, ln, 6 + (i % 3),
                     "LEAF_1" if i % 3 == 0 else "LEAF_2", "LEAF_0", "LEAF_0", hi="LEAF_3")
        for i in range(5):
            a = -math.pi / 2 + (i - 2) * 0.45
            big_leaf(px, py - 10, a, 14, 5, "LEAF_2", "LEAF_0", "LEAF_1", hi="LEAF_3")
        shadow_ell(px, py, 12, 3)


# ---------------------------------------------------------------- zone 4: window + media + chess
def window_zone():
    rng = random.Random(61)
    with obj("floor-plant-window"):
        px, py = pj(-0.5, 0, 0.9)
        pot(px - 5, py - 9, px + 5, py, "SLATE_0")
        L(px, py - 9, px - 1, py - 40, "OAK_0")
        for i, (dy, a) in enumerate(((-14, -2.5), (-18, -0.6), (-23, -2.7), (-27, -0.4), (-31, -2.2), (-34, -0.9), (-38, -1.6))):
            big_leaf(px - 1, py + dy, a, 9, 4, "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0", "LEAF_0", hi="LEAF_3")
        shadow_ell(px, py, 8, 2)
    MX0, MX1 = 1.6, 6.4
    with obj("media-stand"):
        f = box3d(MX0, MX1, 0, 1.7, 0.0, 1.6, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        mid = (ax + bx) / 2
        R(ax + 2, ay + 3, mid - 1, dy - 3, "OAK_DK")
        R(mid + 1, ay + 3, bx - 2, dy - 3, "OAK_DK")
        R(ax + 4, ay + 6, mid - 4, ay + 9, "INK")    # console
        P(ax + 6, ay + 7, "LEAF_3!")
        for k in range(3):
            L(mid + 3, ay + 5 + k * 4, bx - 4, ay + 5 + k * 4, BOOKC[k * 3])
        shadow_fp(MX0, MX1, 0, 1.6)
    with obj("crt-big"):  # Today
        f = box3d(MX0 + 0.3, MX0 + 2.9, 1.7, 3.9, 0.15, 1.45, "BROWN_1", side="INK", top="SLATE_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 2, ay + 2, bx - 7, dy - 3, "INK")
        R(ax + 3, ay + 3, bx - 8, dy - 4, "CRT_0!")
        R(ax + 4, ay + 4, bx - 9, ay + 6, "CRT_1!")
        L(ax + 4, ay + 9, bx - 12, ay + 9, "TERRA_0!")
        circ((ax + bx - 11) / 2, ay + 11, 3, "ORANGE!")
        L(ax + 4, dy - 6, bx - 9, dy - 6, "TERRA_0!")
        for k in range(3):
            P(bx - 4, ay + 4 + k * 3, "SLATE_1")
        R(bx - 5, dy - 5, bx - 3, dy - 4, "CRT_1!")
        cx_, cy_ = (ax + bx) / 2, (ay + dy) / 2
        light(cx_, cy_ + 6, 30, 26, 0.8)
        tint(cx_, cy_ - 4, 30, 22, "red", (0.9, 0.7, 1.15)[af("crt")])
        G.screens["crt-big"] = (ax + 3, ay + 3, bx - 8, dy - 4)
    with obj("crt-small"):  # stats
        f = box3d(MX0 + 3.0, MX0 + 4.75, 1.7, 3.3, 0.3, 1.3, "SLATE_0", side="INK", top="SLATE_1")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 1, ay + 1, bx - 1, dy - 3, "INK")
        R(ax + 2, ay + 2, bx - 2, dy - 4, "TERRA_0!")
        L(ax + 3, ay + 3, bx - 3, ay + 3, "CRT_0!")
        G.screens["crt-small"] = (ax + 2, ay + 2, bx - 2, dy - 4)
        P(bx - 3, dy - 2, "CRT_1!")
        light((ax + bx) / 2, (ay + dy) / 2, 18, 16, 0.4)
        tint((ax + bx) / 2, (ay + dy) / 2 + 6, 18, 18, "red", (0.7, 0.55, 0.85)[af("crt")])
    # chess table + two chairs angled toward the window (right of the stand)
    TX, TZ = 8.3, 3.2
    with obj("chess-table"):
        s = sc(TZ)
        cx_, ty = pj(TX, 2.35, TZ)
        _, fy = pj(TX, 0, TZ)
        rx, ry = 1.05 * s, 0.38 * s
        L(cx_, ty, cx_, fy - 2, "INK")
        L(cx_ + 1, ty, cx_ + 1, fy - 2, "OAK_0")
        POLY([(cx_ - 7, fy), (cx_ - 3, fy - 3), (cx_ + 4, fy - 3), (cx_ + 8, fy)], "OAK_0", "INK")
        ELL(cx_ - rx, ty - ry + 2, cx_ + rx, ty + ry + 2, "OAK_0", "INK")
        ELL(cx_ - rx, ty - ry, cx_ + rx, ty + ry, "OAK_1", "INK")
        L(cx_ - rx + 3, ty - ry + 1, cx_ + rx - 3, ty - ry + 1, "OAK_2")
        # board (perspective 4x4 squares) + pieces
        for i in range(4):
            for j in range(3):
                x0 = cx_ - 6 + i * 3 + j * 0
                y0 = ty - 2 + j
                R(x0, y0, x0 + 2, y0, "CREAM" if (i + j) % 2 == 0 else "OAK_DK")
        for dx, c in ((-5, "INK"), (-2, "INK"), (2, "CREAM"), (5, "CREAM")):
            R(cx_ + dx, ty - 5, cx_ + dx, ty - 3, c)
            P(cx_ + dx, ty - 6, c)
        P(cx_ + 2, ty - 7, "CREAM")
        if stg("library.chess") == 2:   # chess clock
            R(cx_ + 7, ty - 4, cx_ + 12, ty - 1, "INK")
            P(cx_ + 8, ty - 3, "CREAM")
            P(cx_ + 11, ty - 3, "CREAM")
            P(cx_ + 9, ty - 5, "CRT_1")
        shadow_ell(cx_, fy, rx * 0.8, 3)
    with obj("chess-chair-L"):
        chair_back(TX - 1.9, TZ + 0.9, side=1)
    with obj("chess-chair-R"):
        chair_back(TX + 1.9, TZ + 0.9, side=-1)


def chair_back(X, z, side=-1):
    """Small wooden chair seen from behind, turned slightly toward the window (side = lean of the back)."""
    s = sc(z)
    x, yf = pj(X, 0, z)
    _, yfb = pj(X, 0, z - 1.0)
    _, ys = pj(X, 1.55, z)
    _, ysb = pj(X, 1.55, z - 1.0)
    w = int(0.62 * s)
    # far legs, seat (top face), near legs
    for lx in (x - w + 2 + side, x + w - 2 + side):
        L(lx, ysb, lx, yfb, "OAK_DK")
    POLY([(x - w + side * 2, ysb), (x + w + side * 2, ysb), (x + w, ys), (x - w, ys)], "OAK_1", "INK")
    L(x - w + 1, ys - 1, x + w - 1, ys - 1, "OAK_2")
    for lx in (x - w + 1, x + w - 1):
        L(lx, ys + 1, lx, yf, "OAK_0")
        P(lx, yf, "INK")
    L(x - w + 1, ys + 1, x + w - 1, ys + 1, "INK")
    # back: two posts + top rail + 3 spindles
    _, yt = pj(X, 3.1, z)
    for px_ in (x - w + 1, x + w - 1):
        L(px_, ys, px_ + side, yt, "OAK_0")
    R(x - w + 1 + side, yt, x + w - 1 + side, yt + 3, "OAK_1")
    L(x - w + 1 + side, yt, x + w - 1 + side, yt, "OAK_2")
    L(x - w + side, yt - 1, x + w + side, yt - 1, "INK")
    for k in (-1, 0, 1):
        L(x + k * (w // 2) + side, yt + 4, x + k * (w // 2), ys - 1, "OAK_DK")
    shadow_ell(x + side, (yf + yfb) / 2, w + 2, 3, k=1.0)


# ---------------------------------------------------------------- zone 5: study desk (back wall right)
def study():
    rng = random.Random(71)
    DX0, DX1 = 10.5, 14.9
    with obj("pennant"):
        a = pj(DX0 + 0.2, 9.4, 0)
        b = pj(DX0 + 3.4, 8.85, 0)
        c = pj(DX0 + 0.2, 8.3, 0)
        POLY([a, b, c], "LEAF_2", "INK")
        L(a[0] + 1, a[1] + 2, b[0] - 4, b[1], "SLATE_2")
        L(a[0] + 1, c[1] - 2, b[0] - 4, b[1], "SLATE_2")
        R(a[0] - 1, a[1], a[0], c[1], "CREAM")
        text(a[0] + 3, a[1] + 2, "TU", "CREAM")
    with obj("photo"):
        x0, y0 = pji(DX1 - 0.9, 9.6, 0)
        x1, y1 = pji(DX1 + 0.6, 8.3, 0)
        BOX(x0, y0, x1, y1, "OAK_2", hi="AMBER")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "SLATE_1")
        R(x0 + 2, y1 - 5, x1 - 2, y1 - 2, "LEAF_2")
        P(x0 + 5, y1 - 7, "CREAM")
        P(x0 + 9, y1 - 7, "TERRA_2")
        P(x0 + 5, y1 - 6, "PLUM_1")
        P(x0 + 9, y1 - 6, "PLUM_1")
    with obj("schedule-board"):  # Academics
        x0, y0 = pji(DX0 + 0.3, 7.4, 0)
        x1, y1 = pji(DX0 + 2.8, 5.2, 0)
        BOX(x0, y0, x1, y1, "OAK_1", hi="OAK_2")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "OAK_2")
        ss = stg("study.academics")
        for i in range(5):
            for j in range(4):
                c = "CREAM" if (i + j) % 3 else rng.choice(["SLATE_2", "PLUM_3", "GOLD", "LEAF_3"])
                if ss == 0 and i >= 2:
                    continue
                if ss == 2 and (i + j) % 3 == 0:
                    c = "GOLD"
                R(x0 + 4 + i * 6, y0 + 4 + j * 6, x0 + 7 + i * 6, y0 + 7 + j * 6, c)
        if vk("study.academics") == "alert":   # a red due note pinned over the corner
            R(x1 - 9, y1 - 10, x1 - 2, y1 - 3, "CRT_0")
            L(x1 - 8, y1 - 8, x1 - 4, y1 - 8, "CREAM")
            L(x1 - 8, y1 - 6, x1 - 5, y1 - 6, "CREAM")
            P(x1 - 6, y1 - 11, "INK")
        P(x0 + 4, y0 + 3, "CRT_1")
        P(x1 - 4, y0 + 3, "CRT_1")
    with obj("calendar"):  # Time Blocking, with a clear gap
        x0, y0 = pji(DX0 + 3.2, 7.6, 0)
        x1, y1 = pji(DX0 + 4.9, 5.3, 0)
        BOX(x0, y0, x1, y1, "CREAM", hi="CREAM", sh="SLATE_2")
        R(x0 + 1, y0 + 1, x1 - 1, y0 + 5, "CRT_0")
        P(x0 + 4, y0 - 1, "INK")
        P(x1 - 4, y0 - 1, "INK")
        for i in range(5):
            for j in range(4):
                cs = stg("study.time")
                if (i, j) in ((2, 1), (3, 1), (2, 2), (3, 2)):
                    if cs == 2:
                        R(x0 + 2 + i * 4, y0 + 8 + j * 5, x0 + 4 + i * 4, y0 + 10 + j * 5, "GOLD")
                    continue  # the gap
                if cs == 0 and j > 0:
                    continue
                c = "SLATE_1" if (i + j) % 2 else "TERRA_2"
                R(x0 + 2 + i * 4, y0 + 8 + j * 5, x0 + 4 + i * 4, y0 + 10 + j * 5, c)
    with obj("forge-sign", emit=False):  # the one neon sign
        x0, y0 = pji(DX0 + 1.9, 11.9, 0)
        BOX(x0 - 3, y0 - 3, x0 + text_w("FORGE") * 2 + 2, y0 + 12, "INK", hi="PLASTER_0")
        for dx, dy, c in ((0, 0, "PLUM_2!"), (1, 0, "PLUM_3!")):
            pass
        # 2x scaled neon letters
        xx = x0
        for ch in "FORGE":
            g = FONT[ch]
            for i, b in enumerate(g):
                if b == "1":
                    R(xx + (i % 3) * 2, y0 + (i // 3) * 2, xx + (i % 3) * 2 + 1, y0 + (i // 3) * 2 + 1, "PLUM_3!")
                    P(xx + (i % 3) * 2, y0 + (i // 3) * 2, "CREAM!")
            xx += 8
        cx_ = (x0 + xx) / 2
        light(cx_, y0 + 5, 30, 16, 0.6)
        tint(cx_, y0 + 5, 36, 18, "pink", 1.0)
    # desk
    with obj("desk"):
        f = box3d(DX0, DX1, 0, 2.55, 0, 2.2, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        # drawers on the right
        R(bx - 20, ay + 2, bx - 2, dy - 1, "OAK_0")
        for k in range(3):
            yy = ay + 2 + k * (dy - ay - 3) / 3
            L(bx - 20, yy, bx - 2, yy, "INK")
            R(bx - 12, yy + 3, bx - 10, yy + 3, "GOLD")
        L(ax + 2, ay + 3, bx - 22, ay + 3, "OAK_DK")
        R(ax + 2, ay + 4, ax + 4, dy - 1, "OAK_0")
        shadow_fp(DX0, DX1, 0, 2.2)
    # on the desk: lamp, books between bookends, mug of pens, journal, succulent
    with obj("desk-lamp"):
        bx_, by_ = pj(DX0 + 0.6, 2.55, 0.8)
        R(bx_ - 3, by_ - 1, bx_ + 3, by_, "INK")
        L(bx_, by_ - 1, bx_ + 3, by_ - 10, "INK")
        L(bx_ + 3, by_ - 10, bx_ + 8, by_ - 13, "INK")
        on = TOD == "night"
        POLY([(bx_ + 6, by_ - 16), (bx_ + 12, by_ - 12), (bx_ + 10, by_ - 9), (bx_ + 4, by_ - 12)], "LEAF_2", "INK")
        P(bx_ + 9, by_ - 10, "SUN!" if on else "CREAM")
        if on:
            cone = [(bx_ + 8, by_ - 10), (bx_ + 13, by_ - 9), (bx_ + 26, by_ + 1), (bx_ + 4, by_ + 1)]
            G.cones.append(cone)
            light(bx_ + 14, by_ - 2, 26, 18, 1.0)
    with obj("course-books"):
        x0, y0 = pji(DX0 + 1.7, 2.55, 0.5)
        R(x0, y0 - 9, x0 + 1, y0, "SLATE_0")
        books_row(x0 + 2, x0 + 16, y0, 9, random.Random(5))
        R(x0 + 17, y0 - 9, x0 + 18, y0, "SLATE_0")
    with obj("pen-mug"):
        x, y = pj(DX0 + 3.3, 2.55, 1.2)
        BOX(x - 3, y - 6, x + 3, y, "SLATE_1", hi="SLATE_2")
        for dx, c in ((-1, "CRT_1"), (0, "GOLD"), (1, "SLATE_2")):
            L(x + dx, y - 7, x + dx + (dx), y - 10, c)
    with obj("journal"):
        x, y = pj(DX0 + 3.6, 2.56, 1.8)
        POLY([(x - 6, y - 2), (x + 4, y - 3), (x + 6, y), (x - 4, y + 1)], "TERRA_0", "INK")
        L(x - 4, y - 1, x + 4, y - 2, "GOLD")
    with obj("succulent"):
        x, y = pj(DX1 - 0.5, 2.55, 0.7)
        pot(x - 3, y - 4, x + 3, y, "CREAM")
        for dx, dy in ((-2, -6), (0, -7), (2, -6), (-1, -5), (1, -5)):
            P(x + dx, y + dy, "LEAF_3" if dy == -7 else "LEAF_2")
    with obj("backpack"):  # leaning on the desk's left side
        x, y = pj(DX0 - 0.5, 0, 1.9)
        POLY([(x - 7, y), (x - 8, y - 14), (x - 5, y - 18), (x + 4, y - 18), (x + 6, y - 13), (x + 6, y)], "SLATE_0", "INK")
        R(x - 5, y - 9, x + 3, y - 3, "SLATE_1")
        L(x - 5, y - 9, x + 3, y - 9, "INK")
        L(x - 3, y - 17, x - 3, y - 11, "TERRA_1")
        P(x + 1, y - 6, "GOLD")
        shadow_ell(x, y, 8, 2, k=1.0)
    with obj("desk-chair"):
        X, z = DX0 + 2.2, 2.9
        s = sc(z)
        x, yf = pj(X, 0, z)
        seat = pj(X, 1.6, z)
        L(x, seat[1], x, yf - 3, "INK")
        for dx in (-7, 0, 7):
            L(x, yf - 3, x + dx, yf, "INK")
        R(x - 9, seat[1] - 3, x + 9, seat[1], "TERRA_0")
        L(x - 9, seat[1] - 3, x + 9, seat[1] - 3, "TERRA_1")
        back = pj(X, 3.3, z + 0.3)
        BOX(x - 7, back[1], x + 7, seat[1] - 4, "TERRA_0", hi="TERRA_1")
        L(x, seat[1] - 4, x, seat[1] - 3, "INK")
        shadow_ell(x, yf, 10, 3, k=1.0)


# ---------------------------------------------------------------- zone 6: computer (right wall back)
def computer():
    with wallside():
        _computer()


def _computer():
    rng = random.Random(81)
    with obj("whiteboard"):  # Dropshipping
        wall_frame("R", 0.6, 4.6, 5.4, 8.0, "SLATE_1", "CREAM", m=0.12)
        # sketched rising sales graph
        pts = [pj(WX - 0.04, 5.8 + 0.3 * k + 0.25 * (k % 2), 1.0 + 0.6 * k) for k in range(5)]
        PL(pts, "SLATE_0")
        PL([pj(WX - 0.04, 5.75, 0.95), pj(WX - 0.04, 7.6, 0.95)], "INK")
        st_ = ((3.4, 7.7, "GOLD"), (4.0, 7.6, "PLUM_3"), (3.7, 6.8, "LEAF_3"), (4.1, 6.4, "GOLD"),
               (2.9, 7.6, "SLATE_2"), (3.2, 6.5, "PLUM_3"))
        for z, Y, c in st_[:(1, 4, 6)[stg("computer.board")]]:
            quad(wallq("R", z, z + 0.4, Y - 0.45, Y, 0.05), c)
    with obj("pc-shelf"):  # small shelf with figurine + plant
        q = wallq("R", 1.0, 3.6, 8.7, 8.9, 0.0)
        quad([q[0], q[1], pj(WX - 0.7, 8.9, 3.6), pj(WX - 0.7, 8.9, 1.0)], "OAK_2", "INK")
        quad([pj(WX - 0.7, 8.9, 1.0), pj(WX - 0.7, 8.9, 3.6), pj(WX - 0.7, 8.7, 3.6), pj(WX - 0.7, 8.7, 1.0)], "OAK_1", "INK")
        x, y = pj(WX - 0.35, 8.9, 1.6)
        R(x - 1, y - 6, x + 1, y, "GOLD")    # figurine
        R(x - 2, y - 8, x + 2, y - 6, "GOLD")
        P(x, y - 9, "SUN")
        x, y = pj(WX - 0.35, 8.9, 2.9)
        pot(x - 3, y - 4, x + 3, y, "TERRA_1")
        bush(x, y - 6, 4, 3, rng, n=12)
        for i in range(2):
            vine(int(x) - 2 + i * 3, int(y) + 1, 10, rng)
    CX0, CX1, cz0, cz1 = 15.3, WX, 0.4, 4.6
    with obj("pc-desk"):
        box3d(CX0, CX1, 2.35, 2.55, cz0, cz1, "OAK_1", side="OAK_0", top="OAK_2")
        for z in (cz0 + 0.2, cz1 - 0.2):
            a, b = pj(CX0 + 0.15, 2.35, z), pj(CX0 + 0.15, 0, z)
            L(a[0], a[1], b[0], b[1], "INK")
            L(a[0] + 1, a[1], b[0] + 1, b[1], "OAK_0")
        shadow_fp(CX0, CX1, cz0, cz1, k=1.0)
    with obj("pc-tower"):
        f = box3d(16.1, 17.2, 0, 1.8, 3.2, 4.3, "INK", side="BROWN_1", top="SLATE_0")
        (ax, ay), (bx, by), _, _ = f["front"]
        P(ax + 2, ay + 3, "ENERGY")   # dim steady LED
        shadow_fp(16.1, 17.2, 3.2, 4.3, k=1.0)
    with obj("monitors"):  # AI Building: two monitors turned toward the room, green code
        for (za, zb, Xa, Xb, code) in ((0.5, 2.5, 16.3, 16.3, True), (2.6, 4.4, 16.3, 16.1, False)):
            q = [pj(Xa, 4.9, za), pj(Xb, 4.9, zb), pj(Xb, 3.2, zb), pj(Xa, 3.2, za)]
            POLY(q, "INK", "INK")
            qi = [pj(Xa - 0.05, 4.75, za + 0.15), pj(Xb - 0.05, 4.75, zb - 0.15), pj(Xb - 0.05, 3.35, zb - 0.15), pj(Xa - 0.05, 3.35, za + 0.15)]
            POLY(qi, "LEAF_0!" if code else "SLATE_0!")
            x0 = min(p[0] for p in qi) + 1
            x1 = max(p[0] for p in qi) - 1
            y0 = min(p[1] for p in qi) + 2
            y1 = max(p[1] for p in qi) - 2
            sc_ = af("terminal") if code else 0
            for k, yy in enumerate(range(int(y0), int(y1), 2)):
                k += sc_
                ln = (k * 5) % 7 + 2
                c = ("LEAF_3!" if k % 3 else "ENERGY!") if code else ("CREAM!" if k % 3 == 0 else "SLATE_2!" if k % 3 == 1 else "VIOLET!")
                L(x0 + (k % 2), yy, min(x1, x0 + ln), yy, c)
            st = pj((Xa + Xb) / 2, 3.2, (za + zb) / 2)
            L(st[0], st[1], st[0], st[1] + 3, "INK")
            R(st[0] - 3, st[1] + 3, st[0] + 2, st[1] + 4, "INK")
            if code:
                G.focus_at = pj(Xa, 4.95, za + 0.1)
        mx, my = pj(16.3, 4.0, 1.6)
        light(mx, my, 26, 30, 0.7)
        tint(pj(WX, 4.5, 1.6)[0] - 4, my - 6, 26, 34, "green", (1.0, 0.85, 1.15, 0.95)[af("terminal") % 4])
        kx, ky = pj(15.7, 2.55, 2.2)
        R(kx - 6, ky - 1, kx + 2, ky, "SLATE_0")   # keyboard
        L(kx - 6, ky - 1, kx + 2, ky - 1, "SLATE_1")
        sx, sy = pj(16.6, 2.55, 4.6)
        BOX(sx - 2, sy - 6, sx + 2, sy, "BROWN_1", hi="SLATE_0")   # speaker
        P(sx, sy - 3, "SLATE_1")
        ux, uy = pj(15.8, 2.55, 0.9)
        BOX(ux - 2, uy - 4, ux + 1, uy, "CREAM", hi="CREAM")   # mug
    with obj("focus-note"):   # weekly focus sticky note on the bezel
        n = G.focus_at
        R(n[0] - 1, n[1] - 1, n[0] + 3, n[1] + 2, "GOLD")
        L(n[0], n[1], n[0] + 2, n[1], "OAK_DK")
    with obj("headphones"):
        hx, hy = pj(WX - 0.05, 5.0, 4.75)
        P(hx, hy - 2, "SLATE_1")
        ring(hx, hy + 3, 3, "INK")
        R(hx - 3, hy + 4, hx - 2, hy + 7, "TERRA_1")
        R(hx + 2, hy + 4, hx + 3, hy + 7, "TERRA_1")
    with obj("pc-chair"):
        X, z = 14.0, 3.6
        x, yf = pj(X, 0, z)
        seat = pj(X, 1.7, z)
        L(x, seat[1], x, yf - 3, "INK")
        for dx in (-8, 0, 8):
            L(x, yf - 3, x + dx, yf, "INK")
            P(x + dx, yf, "SLATE_0")
        R(x - 9, seat[1] - 3, x + 9, seat[1], "BROWN_1")
        L(x - 9, seat[1] - 3, x + 9, seat[1] - 3, "SLATE_0")
        back = pj(X, 4.2, z)
        POLY([(x + 2, back[1]), (x + 9, back[1] + 2), (x + 9, seat[1] - 4), (x + 2, seat[1] - 4)], "BROWN_1", "INK")
        L(x + 3, back[1] + 2, x + 3, seat[1] - 6, "CRT_0")
        shadow_ell(x, yf, 11, 3, k=1.0)
    with obj("money-tree"):
        x, y = pj(13.6, 0, 5.4)
        pot(x - 5, y - 8, x + 5, y, "SLATE_1")
        for k in range(14):
            yy = y - 9 - k
            L(x - 1 + (k // 2) % 2, yy, x + (k // 2) % 2, yy, "OAK_1" if k % 2 else "OAK_0")
        lv = ((-4, -21), (5, -21), (0, -30), (-7, -26), (7, -26), (-10, -32), (9, -33))
        for (dx, dy) in lv[:(2, 3, 5, 7)[grow("computer.money")]]:
            ELL(x + dx - 4, y + dy - 3, x + dx + 4, y + dy + 3, "LEAF_2", "INK")
            P(x + dx, y + dy - 1, "LEAF_3")
        if grow("computer.money") == 3:
            circ(x + 2, y - 36, 1, "GOLD")
        shadow_ell(x, y, 7, 2)


# ---------------------------------------------------------------- zone 7: gym (right wall front)
def gym():
    with wallside(0.72):
        _gym()


def _gym():
    rng = random.Random(91)
    with obj("gym-timer"):  # red LED timer, high on the wall (moving light)
        q = wallq("R", 5.0, 6.3, 9.6, 10.4, 0.02)
        quad(q, "INK", "BROWN_1")
        seg = ((1, 1, 1, 1), (1, 0, 1, 1), (1, 1, 0, 1), (0, 1, 1, 0))[af("timer")]
        for k, z in enumerate((5.25, 5.5, 5.85, 6.1)):
            a = pj(WX - 0.05, 10.15, z)
            b = pj(WX - 0.05, 9.85, z)
            L(a[0], a[1], b[0], b[1], "CRT_1!" if seg[k] else "TERRA_0")
        m = pj(WX - 0.05, 10.0, 5.7)
        P(m[0], m[1], "CRT_0!" if af("timer") % 2 == 0 else "TERRA_0")
        light(m[0], m[1], 12, 10, 0.3)
        tint(m[0], m[1], 12, 9, "red", (0.6, 0.45, 0.7, 0.5)[af("timer")])
    with obj("medal-wall"):
        med = ((7.0, 7.5, "GOLD"), (7.5, 7.7, "SLATE_2"), (8.0, 7.4, "AMBER"), (7.3, 6.8, "GOLD"), (7.8, 6.7, "CREAM"),
               (8.4, 7.6, "GOLD"), (6.7, 6.9, "SLATE_2"))
        for z, Y, c in med[:(1, 3, 5, 7)[grow("gym.medals")]]:
            a = pj(WX - 0.03, Y + 0.5, z)
            b = pj(WX - 0.03, Y, z)
            L(a[0] - 1, a[1], b[0], b[1], "CRT_0")
            L(a[0] + 1, a[1], b[0], b[1], "SLATE_1")
            circ(b[0], b[1] + 2, 2, c)
            P(b[0] - 1, b[1] + 1, "CREAM")
        quad(wallq("R", 8.3, 9.0, 5.5, 6.4, 0.03), "CREAM", "INK")   # race bib
        a = pj(WX - 0.04, 6.05, 8.5)
        R(a[0], a[1], a[0] + 2, a[1] + 1, "CRT_0")
        P(a[0], a[1] - 3, "INK")
    with obj("shoe-shelf"):
        q = wallq("R", 6.9, 8.9, 3.3, 3.5, 0.0)
        quad([q[0], q[1], pj(WX - 0.9, 3.5, 8.9), pj(WX - 0.9, 3.5, 6.9)], "OAK_2", "INK")
        quad([pj(WX - 0.9, 3.5, 6.9), pj(WX - 0.9, 3.5, 8.9), pj(WX - 0.9, 3.3, 8.9), pj(WX - 0.9, 3.3, 6.9)], "OAK_1", "INK")
        for z, c in ((7.4, "CRT_1"), (8.3, "SLATE_2")):
            a = pj(WX - 0.5, 3.5, z)
            POLY([(a[0] - 4, a[1]), (a[0] + 4, a[1]), (a[0] + 4, a[1] - 3), (a[0] - 1, a[1] - 5), (a[0] - 4, a[1] - 4)], c, "INK")
            L(a[0] - 4, a[1] - 1, a[0] + 4, a[1] - 1, "CREAM")
    with obj("weight-rack"):  # Strength: open steel frame, plates on front pegs, dumbbells on the shelf
        RX0, RX1, rz0, rz1 = 15.8, WX, 4.9, 6.6
        posts = [(RX0, rz0), (RX0, rz1)]
        for X, z in [(RX1, rz0), (RX1, rz1)]:
            a, b = pj(X, 0, z), pj(X, 4.7, z)
            L(a[0], a[1], b[0], b[1], "INK")
        for Y in (0.9, 2.5, 4.6):  # rails along the wall
            a, b = pj(RX0, Y, rz0), pj(RX0, Y, rz1)
            L(a[0], a[1], b[0], b[1], "SLATE_0")
            L(a[0], a[1] + 1, b[0], b[1] + 1, "INK")
        top = [pj(RX0, 4.7, rz1), pj(RX1, 4.7, rz1)]
        L(top[0][0], top[0][1], top[1][0], top[1][1], "SLATE_0")
        for X, z in posts:
            a, b = pj(X, 0, z), pj(X, 4.7, z)
            R(a[0] - 1, b[1], a[0], a[1], "SLATE_0")
            L(a[0] - 1, b[1], a[0] - 1, a[1], "INK")
        # dumbbells on the lower shelf
        for z in (5.3, 5.8, 6.2):
            c = pj(RX0 + 0.3, 1.05, z)
            R(c[0] - 4, c[1] - 1, c[0] + 4, c[1], "SLATE_1")
            R(c[0] - 4, c[1] - 3, c[0] - 3, c[1] + 1, "INK")
            R(c[0] + 3, c[1] - 3, c[0] + 4, c[1] + 1, "INK")
        # plates on the front pegs (facing the camera), heavier = bigger
        fx, _ = pj(RX0 + 0.5, 0, rz1)
        plates = (((1.4, 7, "SLATE_0"),),
                  ((3.3, 9, "BROWN_1"), (3.3, 7, "SLATE_0"), (1.4, 10, "INK"), (1.4, 8, "CRT_0")),
                  ((3.3, 10, "INK"), (3.3, 8, "CRT_0"), (1.4, 11, "INK"), (1.4, 9, "GOLD_DK"), (1.4, 6, "CRT_0")))
        for Y, r, c in plates[stg("gym.strength")]:
            _, cy = pj(RX0, Y, rz1)
            circ(fx + (2 if r < 9 else 0), cy, r, "INK")
            circ(fx + (2 if r < 9 else 0), cy, r - 1, c)
            circ(fx + (2 if r < 9 else 0), cy, 2, "SLATE_1")
            P(fx + (2 if r < 9 else 0) - r + 3, cy - 3, "SLATE_2")
        # barbell on the top hooks
        a, b = pj(RX0 - 0.2, 4.4, rz0 - 0.4), pj(RX0 - 0.2, 4.4, rz1 + 0.4)
        L(a[0], a[1], b[0], b[1], "SLATE_2")
        for t in (a, b):
            R(t[0] - 1, t[1] - 4, t[0] + 1, t[1] + 4, "CRT_0")
        shadow_fp(RX0, RX1, rz0, rz1)
    with obj("foam-roller"):
        x, y = pj(14.6, 0.35, 12.0)
        R(x - 9, y - 3, x + 9, y + 3, "SLATE_1")
        L(x - 9, y - 2, x + 9, y - 2, "SLATE_2")
        ELL(x + 7, y - 3, x + 11, y + 3, "SLATE_0", "INK")
        L(x - 9, y - 3, x + 9, y - 3, "INK")
        L(x - 9, y + 3, x + 9, y + 3, "INK")
        L(x - 10, y - 3, x - 10, y + 3, "INK")
        shadow_ell(x, y + 3, 12, 2, k=1.0)
    with obj("relic-bracket-R"):
        q = wallq("R", 10.0, 10.9, 6.6, 6.9, 0.0)
        quad([q[0], q[1], pj(WX - 0.6, 6.9, 10.9), pj(WX - 0.6, 6.9, 10.0)], "OAK_1", "INK")
        a, b = pj(WX - 0.02, 6.6, 10.1), pj(WX - 0.5, 6.85, 10.1)
        L(a[0], a[1] + 4, b[0], b[1], "INK")
        x, y = pj(WX - 0.3, 7.5, 10.45)
        relic_slot("gym.relic", x, y, 1)
    with obj("bike"):  # Triathlon (dormant): wheels showing, tarp half draped, original swim-bike-run mark
        X = 16.7
        R_ = 1.1
        wz = (7.8, 10.5)
        for z in wz:
            cx_, cy_ = pj(X, R_, z)
            s = sc(z)
            Xe = WX - (WX - X) * COMP["k"]
            hw = Xe * F / (D0 - z) ** 2 * R_
            ELL(cx_ - hw, cy_ - R_ * s, cx_ + hw, cy_ + R_ * s, "INK")
            ELL(cx_ - hw + 1, cy_ - R_ * s + 2, cx_ + hw - 1, cy_ + R_ * s - 2, "BROWN_1")
            ELL(cx_ - hw + 2, cy_ - R_ * s + 3, cx_ + hw - 2, cy_ + R_ * s - 3, "PLASTER")
            L(cx_, cy_ - R_ * s + 3, cx_, cy_ + R_ * s - 3, "SLATE_0")
            L(cx_ - hw + 3, cy_, cx_ + hw - 3, cy_, "SLATE_0")
            P(cx_, cy_, "SLATE_2")
        p_bb = pj(X, 1.1, 9.2)
        p_seat = pj(X, 2.9, 9.5)
        p_head = pj(X, 2.85, 8.2)
        p_f = pj(X, R_, wz[0])
        p_r = pj(X, R_, wz[1])
        for a, b in ((p_bb, p_seat), (p_seat, p_head), (p_head, p_f), (p_bb, p_head), (p_bb, p_r), (p_seat, p_r)):
            L(a[0], a[1], b[0], b[1], "CRT_0")
        L(p_head[0], p_head[1] - 1, p_head[0] - 4, p_head[1] - 1, "INK")  # aero bars
        R(p_seat[0] - 2, p_seat[1] - 2, p_seat[0] + 3, p_seat[1] - 1, "INK")
        # tarp over the rear half (awake: tarp off, the mark sits on the frame)
        awake = vk("gym.bike") == "awake"
        t = [pj(X - 0.3, 3.4, 9.0), pj(X - 0.3, 3.0, 11.5), pj(X - 0.3, 0.7, 11.8), pj(X - 0.3, 1.4, 10.2), pj(X - 0.3, 1.9, 9.2)]
        if not awake:
            POLY(t, "SLATE_1", "INK")
            for k in range(3):
                a = pj(X - 0.3, 3.3 - k * 0.15, 9.4 + k * 0.7)
                b = pj(X - 0.3, 1.5, 10.0 + k * 0.6)
                L(a[0], a[1], b[0], b[1], "SLATE_0")
        m = pj(X - 0.32, 2.7, 10.2) if not awake else pj(X - 0.32, 3.6, 8.8)
        PL([(m[0] - 2, m[1]), (m[0] - 1, m[1] - 1), (m[0], m[1]), (m[0] + 1, m[1] - 1)], "CREAM")   # swim
        ring(m[0], m[1] + 4, 1, "CREAM")                                                            # bike
        R(m[0] - 1, m[1] + 7, m[0] + 1, m[1] + 8, "CREAM")                                          # run
        shadow_fp(X - 0.4, X + 0.4, 6.6, 11.6, k=1.0)
    with obj("bottle"):
        x, y = pj(15.4, 0, 8.6)
        BOX(x - 2, y - 8, x + 2, y, "ENERGY", hi="ENERGY_HI")
        R(x - 1, y - 10, x + 1, y - 9, "INK")
        shadow_ell(x, y, 3, 1, k=1.0)
    with obj("gym-plant"):  # corner plant framing the front right
        x, y = pj(16.4, 0, 14.2)
        pot(x - 6, y - 10, x + 6, y, "TERRA_1")
        for i in range(9):
            a = -math.pi / 2 + (i - 4) * 0.22
            ex, ey = x + math.cos(a) * 18, y - 10 + math.sin(a) * 44
            L(x, y - 10, ex, ey, "LEAF_1")
            L(x + 1, y - 10, ex + 1, ey, "LEAF_2" if i % 2 else "LEAF_0")
            P(ex, ey, "LEAF_3")
        shadow_ell(x, y, 9, 2)


# ---------------------------------------------------------------- rug to the knight
def rug():
    with obj("rug"):
        q = [pj(KN_X - 2.1, 0, 2.6), pj(KN_X + 2.1, 0, 2.6), pj(KN_X + 2.8, 0, 16.5), pj(KN_X - 2.8, 0, 16.5)]
        POLY(q, "TERRA_0", "INK")
        q2 = [pj(KN_X - 1.7, 0, 3.1), pj(KN_X + 1.7, 0, 3.1), pj(KN_X + 2.3, 0, 16.5), pj(KN_X - 2.3, 0, 16.5)]
        POLY(q2, "CRT_0")
        q3 = [pj(KN_X - 1.2, 0, 3.6), pj(KN_X + 1.2, 0, 3.6), pj(KN_X + 1.6, 0, 16.5), pj(KN_X - 1.6, 0, 16.5)]
        POLY(q3, "TERRA_0")
        for z in (5.0, 8.0, 11.0, 14.0):
            c = pj(KN_X, 0, z)
            s = sc(z)
            POLY([(c[0], c[1] - 0.25 * s * 0.5), (c[0] + 0.6 * s, c[1]), (c[0], c[1] + 0.25 * s * 0.5), (c[0] - 0.6 * s, c[1])], "GOLD")
        for z in [2.6 + 0.3 * k for k in range(0)]:
            pass


# ---------------------------------------------------------------- lighting
LEVEL_BASE = 2
DARK = {"VOID": "VOID", "INK": "VOID", "PLASTER_0": "VOID", "PLASTER": "PLASTER_0", "BROWN_2": "PLASTER",
        "BROWN_1": "INK", "TERRA_0": "PLASTER", "TERRA_1": "TERRA_0", "TERRA_2": "TERRA_1", "RIM": "TERRA_2",
        "ORANGE": "RIM", "GLOW": "AMBER", "AMBER": "OAK_2", "SUN": "GLOW", "GOLD": "GOLD_DK", "GOLD_DK": "OAK_DK",
        "OAK_2": "OAK_1", "OAK_1": "OAK_0", "OAK_0": "OAK_DK", "OAK_DK": "PLASTER_0", "LEAF_3": "LEAF_2",
        "LEAF_2": "LEAF_1", "LEAF_1": "LEAF_0", "LEAF_0": "INK", "SLATE_2": "SLATE_1", "SLATE_1": "SLATE_0",
        "SLATE_0": "BROWN_1", "PLUM_3": "PLUM_2", "PLUM_2": "PLUM_1", "PLUM_1": "BROWN_2", "CRT_1": "CRT_0",
        "CRT_0": "TERRA_0", "CREAM": "SLATE_2", "NAVY": "INK", "ENERGY": "SLATE_1", "ENERGY_HI": "ENERGY",
        "VIOLET": "PLUM_1"}
WARM = {"PLASTER_0": "PLASTER", "PLASTER": "BROWN_2", "BROWN_2": "TERRA_1", "BROWN_1": "BROWN_2",
        "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "TERRA_2": "RIM", "RIM": "ORANGE", "ORANGE": "GLOW",
        "AMBER": "GLOW", "GLOW": "SUN", "OAK_DK": "OAK_0", "OAK_0": "OAK_1", "OAK_1": "OAK_2", "OAK_2": "AMBER",
        "GOLD_DK": "GOLD", "GOLD": "SUN", "LEAF_0": "LEAF_1", "LEAF_1": "LEAF_2", "LEAF_2": "LEAF_3",
        "SLATE_0": "SLATE_1", "SLATE_1": "SLATE_2", "SLATE_2": "CREAM", "PLUM_1": "PLUM_2", "PLUM_2": "PLUM_3",
        "PLUM_3": "CREAM", "CRT_0": "CRT_1", "NAVY": "SLATE_0", "VIOLET": "PLUM_3"}
DAWN = dict(WARM, **{"PLASTER": "PLUM_1", "BROWN_2": "PLUM_1", "TERRA_1": "PLUM_2", "TERRA_2": "PLUM_3",
                     "RIM": "PLUM_3", "OAK_2": "OAK_2", "OAK_1": "OAK_2"})
NOON = dict(WARM, **{"PLASTER": "PLUM_1", "BROWN_2": "PLUM_1", "PLUM_1": "PLUM_3", "TERRA_1": "TERRA_2",
                     "RIM": "TERRA_2", "OAK_2": "AMBER", "SLATE_0": "SLATE_1"})
# night: plaster stays plum-charcoal (no navy mud); colour comes from the lamps, screens and the plasma globe
NIGHT_DARK = dict(DARK, **{"PLASTER_0": "PLASTER_0", "BROWN_2": "PLASTER", "SLATE_1": "SLATE_0", "TERRA_0": "PLASTER"})


def lut(mp):
    a = np.arange(256, dtype=np.uint8)
    for k, v in mp.items():
        a[N[k]] = N[v]
    return a


def compose(*luts):
    a = np.arange(256, dtype=np.uint8)
    for l in luts:
        a = l[a]
    return a


def tod_setup():
    """Per time of day: window wash sources, base level, ramps for levels 0..4."""
    win = G.win
    wx, wy = (win[0] + win[2]) / 2, (win[1] + win[3]) / 2
    d, w = lut(DARK), lut(WARM)
    if TOD == "golden":
        base = 1.3
        src = [(wx, wy + 10, 380, 240, 2.5), (wx, wy - 4, 130, 85, 1.0), (wx + 10, 345, 150, 45, 1.3),
               (wx, wy - 10, 240, 150, 0.55)]
        lv = [compose(d, d), d, None, w, compose(w, w)]
    elif TOD == "dawn":
        base = 0.7
        src = [(wx, wy + 10, 330, 210, 2.1), (wx, wy, 110, 70, 0.6)]
        dw = lut(DAWN)
        lv = [compose(d, d), d, None, dw, compose(dw, dw)]
    elif TOD == "midday":
        # less flat: a brighter window wash, a sun patch on the floor and darker corners
        base = 1.0
        src = [(wx, wy + 10, 420, 260, 1.8), (wx + 10, 345, 170, 45, 1.3), (wx, wy - 4, 120, 80, 0.6)]
        nw = lut(NOON)
        lv = [d, d, None, nw, compose(nw, nw)]
    else:
        base = 0.8
        src = [(wx, wy, 140, 90, 0.5)]
        nd = lut(NIGHT_DARK)
        lv = [compose(nd, nd), nd, None, w, compose(w, w)]
    return base, src, lv


def apply_lighting():
    base, src, lv = tod_setup()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    f = np.full((H, W), base, np.float32)
    lamp_k = {"golden": 1.0, "dawn": 0.6, "midday": 0.35, "night": 1.35}[TOD]
    for cx, cy, rx, ry, a in src:
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        f += a * np.clip(1 - dd, 0, 1) ** 1.1
    for cx, cy, rx, ry, a in G.lights:
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        f += a * lamp_k * np.clip(1 - dd, 0, 1) ** 0.9
    # corner + edge falloff (real darkness)
    ex = np.abs(xx - 400) / 320.0
    ey = np.abs(yy - 225) / 150.0
    r = np.sqrt(ex ** 2 * 0.85 + ey ** 2 * 0.6)
    f -= 2.1 * np.clip((r - 0.58) / 0.5, 0, 1)
    f += G.shadow
    # quantise with a single 50% checker band before each step
    fl = np.floor(f)
    fr = f - fl
    chk = (yy.astype(int) % 2) == 0   # falloff band: 1 px line dither (no checkerboard, no lone pixels)
    # objects step cleanly (flat clusters, no grain); the shell keeps a single checker band at each step
    lvl = fl + np.where(G.oid < 10, (fr > 0.78) & chk, fr > 0.89)
    lvl = np.clip(lvl, 0, 4).astype(np.int8)
    G.level = lvl
    out = G.img.copy()
    ne = ~G.emit
    for k in range(5):
        if lv[k] is None:
            continue
        m = ne & (lvl == k)
        out[m] = lv[k][G.img[m]]
    G.img = out


def rim_pass():
    win = G.win
    wx = (win[0] + win[2]) / 2
    oid, img = G.oid, G.img
    order = np.zeros(max(int(oid.max()), max(G.order)) + 1, np.int32)
    for k, v in G.order.items():
        order[k] = v
    ordr = order[oid]
    rim_c = {"golden": ("RIM", "GLOW"), "dawn": ("PLUM_2", "PLUM_3"), "midday": ("TERRA_2", "AMBER"),
             "night": ("TERRA_1", "TERRA_2")}[TOD]
    xs = np.arange(W)[None, :].repeat(H, 0)
    new = img.copy()
    for dirn in (1, -1):
        sel = (xs < wx - 4) if dirn == 1 else (xs > wx + 4)
        nb_oid = np.roll(oid, -dirn, axis=1)
        nb_ord = np.roll(ordr, -dirn, axis=1)
        m = sel & (oid >= 10) & ~G.emit & (nb_oid != oid) & (nb_ord < ordr)
        m &= G.level >= (2 if TOD == "night" else 1)
        m &= G.names_arr[oid] == 0
        hot = G.level >= 3
        new[m & ~hot] = N[rim_c[0]]
        new[m & hot] = N[rim_c[1]]
    G.img = new


TINTS = {
    "red": ({"PLASTER": "TERRA_0", "PLASTER_0": "TERRA_0", "BROWN_2": "TERRA_0", "NAVY": "TERRA_0", "OAK_DK": "TERRA_0", "OAK_0": "TERRA_1", "OAK_1": "TERRA_1", "INK": "TERRA_0"},
            {"TERRA_0": "CRT_0", "TERRA_1": "TERRA_2"}),
    "green": ({"PLASTER": "LEAF_1", "PLASTER_0": "LEAF_0", "BROWN_2": "LEAF_1", "NAVY": "LEAF_1", "INK": "LEAF_0", "OAK_DK": "LEAF_1", "BROWN_1": "LEAF_1"},
              {"LEAF_1": "LEAF_2", "LEAF_0": "LEAF_1"}),
    "violet": ({"PLASTER": "PLUM_1", "PLASTER_0": "PLUM_1", "BROWN_2": "PLUM_1", "NAVY": "PLUM_1", "INK": "PLASTER"},
               {"PLUM_1": "VIOLET", "PLASTER": "PLUM_1"}),
    "cyan": ({"PLASTER": "SLATE_0", "PLASTER_0": "NAVY", "BROWN_2": "SLATE_0", "NAVY": "SLATE_0", "TERRA_0": "PLUM_1", "TERRA_1": "PLUM_1", "BROWN_1": "SLATE_0"},
             {"SLATE_0": "SLATE_1", "NAVY": "SLATE_0", "PLUM_1": "SLATE_1"}),
    "pink": ({"PLASTER": "PLUM_1", "PLASTER_0": "PLASTER", "BROWN_2": "PLUM_1", "NAVY": "PLUM_1"},
             {"PLUM_1": "PLUM_2"}),
    "ember": ({"PLASTER": "TERRA_0", "PLASTER_0": "TERRA_0", "BROWN_2": "TERRA_1", "NAVY": "TERRA_0", "OAK_1": "TERRA_2", "OAK_0": "TERRA_1"},
              {"TERRA_0": "TERRA_1", "TERRA_1": "RIM"}),
    "potion": ({"PLASTER": "PLUM_1", "PLASTER_0": "PLASTER", "BROWN_2": "PLUM_1", "NAVY": "PLUM_1"},
               {"PLUM_1": "PLUM_2"}),
    "lamp": ({"PLASTER": "BROWN_2", "PLASTER_0": "PLASTER", "BROWN_2": "TERRA_1", "NAVY": "PLASTER", "OAK_0": "OAK_1", "OAK_DK": "OAK_0", "OAK_1": "OAK_2"},
             {"TERRA_1": "TERRA_2", "OAK_2": "AMBER", "OAK_1": "OAK_2"}),
}


def apply_tints():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    chk = (yy.astype(int) % 2) == 0
    boost = 1.35 if TOD == "night" else 1.0
    for cx, cy, rx, ry, kind, k in G.tints:
        k2 = k * boost
        rx2, ry2 = rx * (0.8 + 0.3 * k2), ry * (0.8 + 0.3 * k2)
        dd = ((xx - cx) / rx2) ** 2 + ((yy - cy) / ry2) ** 2
        outer = (dd <= 1.0) & ~G.emit & ~((dd > 0.8) & ~chk) & (G.oid < 10)
        inner = (dd <= 0.3 * k2) & ~G.emit & ((G.oid < 10) | (dd <= 0.12))
        m1, m2 = TINTS[kind]
        a = G.img
        l1 = lut(m1)
        a2 = a.copy()
        a2[outer] = l1[a[outer]]
        l2 = lut(m2)
        a2[inner] = l2[a2[inner]]
        G.img = a2


def floor_reflection():
    """Satin floor: mirrored window as soft vertical streaks + a broken glowing sun reflection (visible floor only)."""
    cols = {"night": ("NAVY", "SLATE_0", "SLATE_1", "CREAM"), "dawn": ("PLUM_1", "PLUM_2", "PLUM_3", "CREAM"),
            "midday": ("OAK_2", "AMBER", "SLATE_2", "CREAM"), "golden": ("TERRA_2", "RIM", "GLOW", "SUN")}[TOD]
    x0, y0, x1, y1 = G.win
    floor = G.oid == 4
    img = G.img
    rng = random.Random(4)
    fy = int(pj(0, 0, 0)[1])
    cx = x0 + int((x1 - x0) * 0.47) + 2
    top, bot = fy + 5, 367
    panes = [(x0 + 3, x0 + (x1 - x0) // 3 - 3), (x0 + (x1 - x0) // 3 + 3, x0 + 2 * (x1 - x0) // 3 - 3),
             (x0 + 2 * (x1 - x0) // 3 + 3, x1 - 3)]
    for y in range(top, bot):
        t = (y - top) / (bot - top)
        persp = 1 + 0.5 * t
        jit = rng.randint(-1, 1)
        for a, b in panes:
            xa = int(cx + (a - cx) * persp) + jit
            xb = int(cx + (b - cx) * persp) + jit
            for x in range(xa, xb + 1):
                if floor[y, x] and img[y, x] not in (N["OAK_DK"], N["VOID"], N["INK"], N["PLASTER_0"]):
                    if TOD == "night":
                        if y % 2 == 0:
                            img[y, x] = N[cols[0]]
                    elif t < 0.75 or y % 2 == 0:
                        img[y, x] = N[cols[0]] if img[y, x] not in (N[cols[1]], N[cols[2]]) else img[y, x]
        if TOD == "night":
            continue
        prof = math.sin(math.pi * min(1, max(0, (t - 0.04) / 0.92))) ** 0.6
        hw = {"golden": 34, "midday": 22, "dawn": 14}[TOD] * prof * persp * (0.6 + 0.5 * rng.random())
        off = rng.randint(-5, 5)
        if rng.random() < 0.22:
            hw *= 0.35  # broken band
        for x in range(int(cx - hw) + off, int(cx + hw) + off + 1):
            if not floor[y, x]:
                continue
            if img[y, x] in (N["OAK_DK"], N["PLASTER_0"], N["VOID"]):
                img[y, x] = N["TERRA_1"]   # plank seam catching the light
                continue
            u = abs(x - cx - off) / max(1, hw)
            c = cols[3] if u < 0.3 else cols[2] if u < 0.62 else cols[1]
            img[y, x] = N[c]
            G.emit[y, x] = True
    # red CRT reflection streak under the media stand
    crt = [k for k, v in G.names.items() if v == "crt-big"]
    if crt:
        ys, xs = np.where(G.gmask["crt-big"] if G.ghost else G.oid == crt[0])
        cxx = int(xs.mean())
        for y in range(fy + 3, fy + 24):
            if (y - fy) % 5 != 4:
                for x in range(cxx - 6 + (y % 2), cxx + 6, 2):
                    if floor[y, x]:
                        img[y, x] = N["CRT_0" if TOD == "night" else "TERRA_1"]


def beam_pass():
    if not FLAGS["beam"]:
        return
    cx, _ = pj(KN_X, 0, KN_Z)
    top = pj(KN_X, CEIL, KN_Z)[1]
    bot = pj(KN_X, 0, KN_Z + 1.3)[1]
    poly = [(cx - 11, top + 4), (cx + 11, top + 4), (cx + 40, bot), (cx - 40, bot)]
    core = [(cx - 6, top + 4), (cx + 6, top + 4), (cx + 24, bot), (cx - 24, bot)]
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in poly], fill=1)
    ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in core], fill=2)
    M = np.array(m)
    w = lut(WARM)
    up = compose(w, w)
    up2 = lut({"SUN": "CREAM", "GLOW": "SUN", "ORANGE": "GLOW", "RIM": "GLOW", "AMBER": "SUN", "TERRA_2": "GLOW",
               "TERRA_1": "RIM", "PLUM_2": "PLUM_3", "PLUM_3": "CREAM", "OAK_2": "SUN", "SLATE_1": "SLATE_2",
               "SLATE_2": "CREAM", "GOLD": "SUN", "BROWN_2": "TERRA_2", "PLUM_1": "PLUM_3"})
    yy, xx = np.mgrid[0:H, 0:W]
    chk = (yy % 2) == 0
    kid = [kk for kk, v in G.names.items() if v == "knight"][0]
    k = G.oid != kid
    a = G.img.copy()
    m1 = (M >= 1) & k & ~((M == 1) & ~chk & (np.abs(xx - cx) > (6 + 34 * (yy - top) / max(1, bot - top))))
    a[m1] = up[a[m1]]
    m2 = (M == 2) & k
    a[m2] = up2[a[m2]]
    # the knight itself catches the beam: brighten its top-lit pixels one step
    kn = (G.oid == kid) & (M >= 1)
    kl = lut({"SLATE_0": "SLATE_1", "SLATE_1": "SLATE_2", "BROWN_1": "SLATE_0", "GOLD_DK": "GOLD", "GOLD": "SUN", "TERRA_0": "CRT_0", "CRT_0": "CRT_1"})
    a[kn] = kl[a[kn]]
    G.img = a
    rng = random.Random(12)
    for _ in range(70):  # floating dust
        y = rng.uniform(top + 8, bot - 4)
        t = (y - top) / (bot - top)
        hw = 10 + 30 * t
        x = cx + rng.uniform(-hw, hw)
        if G.oid[int(y), int(x)] != kid:
            G.img[int(y), int(x)] = N["CREAM" if rng.random() < 0.6 else "SUN"]
    fx, fy = int(cx), int(top)
    G.img[fy - 2:fy + 4, fx - 6:fx + 7] = N["INK"]
    G.img[fy - 1:fy + 3, fx - 5:fx + 6] = N["SLATE_0"]
    G.img[fy + 3, fx - 5:fx + 6] = N["CREAM"]
    G.img[fy + 4, fx - 7:fx + 8] = N["SUN"]


def dust_cones():
    for cone in G.cones:
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in cone], fill=1)
        M = (np.array(m) > 0) & ~G.emit
        up = lut({"PLASTER": "BROWN_2", "BROWN_2": "TERRA_1", "OAK_1": "OAK_2", "OAK_2": "AMBER", "OAK_0": "OAK_1",
                  "SLATE_1": "SLATE_2", "PLASTER_0": "PLASTER", "NAVY": "PLASTER"})
        G.img[M] = up[G.img[M]]
        rng = random.Random(2 + 7 * af("dust"))
        ys, xs = np.where(M)
        for _ in range(8):
            i = rng.randrange(len(xs))
            G.img[ys[i], xs[i]] = N["CREAM"]


# ---------------------------------------------------------------- scene assembly
def build(tod="golden", tier=3, beam=False, ghost=False):
    global TOD, TIER
    TOD, TIER = tod, tier
    FLAGS["beam"] = beam
    new_scene()
    G.ghost = ghost
    G.cones = []
    G.beam = False
    shell()
    window()
    library()
    rug()
    G.rug_id = [k for k, v in G.names.items() if v == "rug"][0]
    knight_zone()
    window_zone_back()
    study()
    computer()
    bed_zone()
    kitchen()
    window_zone_front()
    gym()
    ceiling_life()
    # names array for rim pass
    mx = max(G.names) + 1
    G.names_arr = np.zeros(mx, np.int32)
    apply_lighting()
    # rim: all object ids except a few self-lit ones
    skip = {"knight", "window-view", "rug", "ceiling", "string-1", "string-3", "string-x", "forge-sign"}
    for k, v in G.names.items():
        if v in skip or k < 10:
            G.names_arr[k] = 1
    rim_pass()
    decheck("gut-plant")
    edge_light_knight()
    apply_tints()
    floor_reflection()
    dust_cones()
    beam_pass()
    return G.img.copy()


def window_zone_back():
    pass


def window_zone_front():
    window_zone()


# ---------------------------------------------------------------- export helpers
def to_rgb(a):
    return RGB[a]


def save(rgb, path, scale=2):
    im = Image.fromarray(rgb, "RGB")
    im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    return path


def crop(a, box):
    x0, y0, x1, y1 = box
    return a[y0:y1, x0:x1]


def label(rgb, s, x=3, y=3, c="CREAM"):
    """Small 3x5 label into an RGB array (documentation only, outside the art)."""
    for ch in s:
        g = FONT.get(ch, FONT[" "])
        for i, b in enumerate(g):
            if b == "1":
                rgb[y + i // 3, x + i % 3] = RGB[N[c]]
        x += 4


def write_palette_proposal():
    out = {
        "_note": "FORGE room R4 palette proposal: the R3 palette (v3 32 + 5 R3 colours = 37) with 6 entries swapped "
                 "for plum-charcoal plaster, the knight's energy/visor colours, the night sky and the plasma/quilt lilac. "
                 "Same count (37), same index order; index 255 = transparent.",
        "swaps": [{"from": a, "from_hex": ah, "to": b, "hex": bh, "why": why} for a, ah, b, bh, why in SWAPS],
        "colors": [[n, h] for n, h in PAL],
    }
    with open(os.path.join(HERE, "palette-proposal.json"), "w") as f:
        json.dump(out, f, indent=1)


def main():
    write_palette_proposal()
    x0, y0, x1, y1 = CORE
    # 1. room (golden hour, tier III)
    g = build("golden", 3)
    room = to_rgb(crop(g, CORE))
    save(room, os.path.join(OUT, "room@2x.png"))
    # 2. lighting strip (2x2: dawn, midday / golden, night)
    tiles = []
    for t in ("dawn", "midday", "golden", "night"):
        tiles.append(to_rgb(crop(build(t, 3), CORE)))
    gap = 6
    cw, ch = x1 - x0, y1 - y0
    strip = np.zeros((ch * 2 + gap * 3 + 14, cw * 2 + gap * 3, 3), np.uint8)
    strip[:] = RGB[N["VOID"]]
    for i, (t, tile) in enumerate(zip(("DAWN", "MIDDAY", "GOLDEN HOUR", "NIGHT"), tiles)):
        r, c = divmod(i, 2)
        yy = gap + 7 + r * (ch + gap + 4)
        xx = gap + c * (cw + gap)
        strip[yy:yy + ch, xx:xx + cw] = tile
        label(strip, t, xx, yy - 7, "CREAM")
    save(strip, os.path.join(OUT, "lighting-strip@2x.png"))
    # 3. knight close-ups: tiers I, III, V + beam
    kx = int(pj(KN_X, 0, 0)[0])
    box = (kx - 60, 118, kx + 60, 312)
    shots = [build("golden", 1), build("golden", 3), build("golden", 5), build("golden", 3, beam=True)]
    bw, bh = box[2] - box[0], box[3] - box[1]
    sheet = np.zeros((bh + 2 * gap + 8, 4 * bw + 5 * gap, 3), np.uint8)
    sheet[:] = RGB[N["VOID"]]
    for i, (s, lab) in enumerate(zip(shots, ("TIER I", "TIER III", "TIER V", "BEAM ON"))):
        xx = gap + i * (bw + gap)
        sheet[gap + 8:gap + 8 + bh, xx:xx + bw] = to_rgb(crop(s, box))
        label(sheet, lab, xx, gap, "CREAM")
        if i == 0:  # 7 ft door-height ruler (scale reference), floor line at the pedestal front
            fyy = int(pj(0, 0, 0)[1]) - box[1] + gap + 8
            top7 = int(pj(0, 7.0, 0)[1]) - box[1] + gap + 8
            rx = xx + 4
            sheet[top7:fyy, rx] = RGB[N["GOLD"]]
            for ft in range(8):
                yy = int(pj(0, ft, 0)[1]) - box[1] + gap + 8
                sheet[yy, rx:rx + (4 if ft in (0, 7) else 2)] = RGB[N["GOLD"]]
            label(sheet, "7", rx + 3, top7 - 6, "GOLD")
    save(sheet, os.path.join(OUT, "knight-tiers@2x.png"))
    # 4. glow demo
    glow_demo()


# ---------------------------------------------------------------- glow demo
def outline_mask(m):
    o = np.zeros_like(m)
    o[1:, :] |= m[:-1, :]
    o[:-1, :] |= m[1:, :]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    return o & ~m


def glow_demo():
    g = build("golden", 3)
    base = to_rgb(g).astype(np.float32)
    gold = np.array([255, 214, 102], np.float32)
    items = [("bookcase", "READING"), ("crt-big", "TODAY"), ("weight-rack", "STRENGTH")]
    tiles = []
    for name, lab in items:
        oid = [k for k, v in G.names.items() if v == name][0]
        m = G.oid == oid
        ys, xs = np.where(m)
        pad = 8
        bx0, by0, bx1, by1 = xs.min() - pad, ys.min() - pad, xs.max() + pad + 1, ys.max() + pad + 1
        ol = outline_mask(m)
        row = []
        for state in ("idle", "shimmer", "hover", "done"):
            img = base.copy()
            if state in ("idle", "shimmer", "hover"):
                a = 0.5 if state != "hover" else 1.0
                img[ol] = img[ol] * (1 - a) + gold * a
            if state == "shimmer":  # LEGO-style glint, middle of 3 frames: diagonal band across the silhouette
                yy, xx = np.mgrid[0:H, 0:W]
                cxm = (bx0 + bx1) / 2
                band = (np.abs((xx - cxm) + (yy - (by0 + by1) / 2) * 0.6) < 2) & m
                img[band] = img[band] * 0.35 + np.array([255, 250, 220]) * 0.65
            if state == "hover":  # one 4-point sparkle at the top-right
                sx, sy = xs.max() - 2, ys.min() + 3
                for dx, dy, k in ((0, 0, 1), (1, 0, .8), (-1, 0, .8), (0, 1, .8), (0, -1, .8), (2, 0, .5), (-2, 0, .5), (0, 2, .5), (0, -2, .5)):
                    img[sy + dy, sx + dx] = img[sy + dy, sx + dx] * (1 - k) + np.array([255, 255, 240]) * k
            t = img[by0:by1, bx0:bx1].clip(0, 255).astype(np.uint8)
            row.append(t)
        tiles.append((lab, row))
    # relic ember 3 frames (left relic mount, close crop)
    rel_frames = []
    for fr in range(3):
        g2 = build_relic_frame(fr)
        rel_frames.append(g2)
    gap = 6
    tw = max(t.shape[1] for _, r in tiles for t in r)
    th = max(t.shape[0] for _, r in tiles for t in r)
    sheet_w = gap + 4 * (tw + gap)
    rh = rel_frames[0].shape[0]
    rhs = [max(t.shape[0] for t in r) for _, r in tiles]
    sheet_h = gap + 9 + sum(h + gap + 8 for h in rhs) + rh + gap + 8
    sheet = np.zeros((sheet_h, sheet_w, 3), np.uint8)
    sheet[:] = RGB[N["VOID"]]
    for c, lab in enumerate(("IDLE", "IDLE GLINT", "HOVER", "DONE")):
        label(sheet, lab, gap + c * (tw + gap), gap)
    y = gap + 9
    for (lab, row), hh in zip(tiles, rhs):
        for c, t in enumerate(row):
            sheet[y:y + t.shape[0], gap + c * (tw + gap): gap + c * (tw + gap) + t.shape[1]] = t
        y += hh + gap + 8
    label(sheet, "RELIC EMBER 1-3", gap, y - 6)
    for c, t in enumerate(rel_frames):
        sheet[y:y + t.shape[0], gap + c * (t.shape[1] + gap): gap + c * (t.shape[1] + gap) + t.shape[1]] = t
    save(sheet, os.path.join(OUT, "glow-demo@2x.png"))


def build_relic_frame(fr):
    """Relic niche close crop with ember frame fr (orange -> deep red -> hot, uneven embers rising)."""
    RELIC["fr"] = fr
    g = build("golden", 3)
    RELIC["fr"] = None
    nx, ny = G.niche
    a = to_rgb(g)
    return a[int(ny) - 26:int(ny) + 16, int(nx) - 34:int(nx) + 34].copy()


# ================================================================ live export (layered art for the engine)
# Like art/room-r3: every object becomes its own sprite under the existing item ids, cut from full lit renders
# of the scene (one render per state tag), so the engine's composite of the base variants equals the approved
# still pixel for pixel. The shell plates come from a "ghost" render (the lit room with every object's lights,
# tints and shadows but without the objects) so a smaller variant never leaves a hole.
# Every variant also has a painted night twin "<key>.night" (rendered at night); the engine draws those without
# the NIGHT LUT. Moving lights are separate decor items with anim frames (and anim.night frames).
PROTO = os.path.join(ROOT, "docs", "redesign", "room-prototype")
SPR_DIR = "art-r4"
OX, OY = 80, 96   # master = world + (OX, OY)
MIN_HIT = 11      # world px: 44 CSS px at phone zone zoom
SKI = lambda s: {"skill": s}  # noqa: E731
FTR = lambda s: {"feature": s}  # noqa: E731
STGK = ("s0", "s1", "s2")
RELK = ("base", "active", "hot", "gold")
BASEVAR = {"kitchen.relic": "base", "window.relic": "base", "gym.relic": "base"}


def I(id_, zone, kind, objs, keys=("base",), alias=None, target=None, label=None, note="", screen=None, layer=None):
    """One live item. keys: rendered variant keys (each a state tag); alias: extra keys -> rendered key."""
    return dict(id=id_, zone=zone, kind=kind, objs=list(objs), keys=list(keys), alias=dict(alias or {}),
                target=target, label=label, note=note, screen=screen, layer=layer)


TA = {"t1": "base", "t3": "base", "t5": "base"}            # room-tier decor variants: same art for now (LATER)
SA = {"s0": "base", "s1": "base", "s2": "base"}            # stage keys on objects without stage art yet
STAGED = dict(keys=STGK, alias={"base": "s1"})


def live_items():
    it = []
    for sid, objs in (("shell.sky", ["window-view"]), ("shell.outside", []), ("shell.window", ["window-frame", "curtains"]),
                      ("shell.l2", ["wall-B"]), ("shell.l3", ["ceiling", "void"]), ("shell.l4", ["wall-L", "wall-R"]),
                      ("shell.l5", ["floor"])):
        it.append(I(sid, "shell", "shell", objs, ("base", "night"), layer={"shell.sky": 0, "shell.outside": 1}.get(sid, 2)))
    E = []   # empty placeholders: ids the R3 room had, no R4 counterpart (kept so nothing that names them breaks)
    # ceiling
    it += [I("window.skylight", "window", "decor", E, ("base", "night"), note="R4: the skylight is part of the ceiling plate"),
           I("window.cables-ceiling", "window", "decor", ["string-x"], note="R4: string lights on the front cross beam"),
           I("kitchen.pendant", "kitchen", "decor", E, ("base", "night"), alias={"t1": "base", "t3": "base", "t5": "base"}),
           I("library.pendant", "library", "decor", ["pendant@0"], ("base", "night"), alias=TA, note="R4: pendant over the reading chair"),
           I("study.pendant", "window", "decor", ["pendant@1"], ("base", "night"), alias=TA, note="R4: pendant over the chess table"),
           I("bed.stringlights", "bed", "decor", E, ("base", "night"), alias={"t1": "base", "t2": "base", "t5": "base"}),
           I("window.stringlights", "window", "decor", E, note="R4: string lights live on the beams (library/study ids)"),
           I("library.stringlights", "library", "decor", ["string-1"], note="R4: string lights along the left beam"),
           I("study.stringlights", "study", "decor", ["string-3"], note="R4: string lights along the right beam"),
           I("kitchen.pothos", "kitchen", "decor", ["hang-plant@0"], note="hanging plant, left"),
           I("library.pothos", "window", "decor", ["hang-plant@2"], note="hanging plant by the skylight"),
           I("study.pothos", "computer", "decor", ["hang-plant@1"], note="hanging plant, right")]
    # window zone
    it += [I("window.statue", "window", "hotspot", ["knight", "pedestal"], ("t1", "t2", "t3", "t4", "t5"), alias={"base": "t1"},
             target=FTR("overall"), label="FORGE",
             note="R4: the knight on its rune pedestal (I iron, II gold seams, III gold trim + energy lines + cape, "
                  "IV gold chest and helm + emblem, V fully golden with crest); plaque shows the tier name"),
           I("window.downlight-fixture", "window", "decor", E, note="R4: the fixture is drawn by the beam overlay"),
           I("window.tapestry", "window", "decor", ["tapestry"], note="R4: tapestry with the original anvil-and-hammer emblem"),
           I("library.sign", "study", "decor", ["forge-sign"], alias={"t1": "base", "t5": "base"}, note="R4: FORGE neon sign above the desk"),
           I("window.relic", "window", "hotspot", ["relic-niche"], RELK, target=FTR("relic-window"), label="RELIC",
             note="arched niche above the window: empty / ember gem / hot / gold"),
           I("window.candles", "window", "decor", ["candles"], note="streak candles on the sill"),
           I("window.sill-plant", "window", "decor", E), I("window.sill-books", "window", "decor", E), I("window.sill-mug", "window", "decor", E),
           I("window.vinyl", "window", "decor", ["media-stand"], note="R4: low media stand under the window"),
           I("window.radiator", "window", "decor", E), I("window.plant", "window", "decor", ["floor-plant-window"], note="floor plant between the stand and the knight"),
           I("window.plantwall", "window", "decor", E, alias={"t1": "base", "t4": "base"}), I("window.amp", "window", "decor", E),
           I("window.today", "window", "hotspot", ["crt-big"], target=FTR("today"), label="TODAY", screen="crt-big",
             note="big red CRT (Today): the engine blinks a cursor until the first log, then shows today's bar"),
           I("window.speaker", "window", "decor", E),
           I("window.stats", "window", "hotspot", ["crt-small"], target=FTR("stats"), label="STATS", screen="crt-small",
             note="small CRT: the engine alternates the overall score and the streak"),
           I("window.powerstrip", "window", "decor", E),
           I("window.rug", "window", "decor", ["rug"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="rug leading to the knight"),
           I("window.cables-floor", "window", "decor", E),
           I("library.chess", "window", "hotspot", ["chess-table"], STGK, alias={"base": "s1"}, target=SKI("chess"), label="CHESS",
             note="R4: chess table in the window zone (s2 chess clock)"),
           I("window.chess-chairs", "window", "decor", ["chess-chair-L", "chess-chair-R"], note="two chairs angled toward the window")]
    # library
    it += [I("library.bookshelf", "library", "hotspot", ["bookcase"], STGK, alias={"base": "s1"}, target=SKI("reading"), label="READING",
             note="9 ft bookcase (shelves fill with the score; s2 gold bookends)"),
           I("library.bookcase", "library", "decor", E, alias={"t1": "base", "t4": "base"}),
           I("library.shelf-plant", "library", "decor", E), I("library.globe", "library", "decor", E),
           I("library.potions", "library", "decor", ["potions"], note="potion shelf (bubbles are the library.potions-bubbles anim)"),
           I("library.archive", "library", "hotspot", ["trophy-case"], target=FTR("archive"), label="ARCHIVE", note="glass trophy case with relics"),
           I("library.snakeplant", "library", "decor", E), I("library.clock", "library", "decor", E),
           I("library.poster", "library", "decor", E, alias={"t1": "base", "t3": "base", "t5": "base"}),
           I("library.armchair", "library", "decor", ["reading-chair"], alias={"t1": "base", "t3": "base", "t4": "base"}, note="reading chair with a throw"),
           I("library.floorlamp", "library", "decor", ["floor-lamp"], note="floor lamp (reading pool)"),
           I("library.stool", "library", "decor", ["side-table"], note="R4: side table with a mug"),
           I("library.books-floor", "library", "decor", ["book-stack"], note="finished books stacked by the chair")]
    # study
    it += [I("study.shelf", "study", "decor", E), I("study.speaker", "study", "decor", E),
           I("study.pennant", "study", "decor", ["pennant"], note="original green and sky-blue pennant (no crest)"),
           I("study.photo", "study", "decor", ["photo"], note="photo frame"),
           I("study.academics", "study", "hotspot", ["schedule-board"], STGK + ("alert",), alias={"base": "s1"}, target=SKI("academics"),
             label="ACADEMICS", note="class-schedule corkboard (alert: a red due note)"),
           I("study.time", "study", "hotspot", ["calendar"], STGK, alias={"base": "s1"}, target=SKI("time-blocking"), label="TIME BLOCKING",
             note="wall calendar (more blocks by stage)"),
           I("study.clock", "study", "decor", E),
           I("study.desk", "study", "decor", ["desk"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="desk with drawers"),
           I("study.lamp", "study", "decor", ["desk-lamp"], ("base", "night"), alias={"t1": "base", "t2": "base", "t5": "base"}, note="desk lamp (on at night)"),
           I("study.courses", "study", "hotspot", ["course-books"], target=FTR("courses"), label="COURSES", note="course books between bookends"),
           I("study.journal", "study", "hotspot", ["journal"], target=FTR("journal"), label="JOURNAL", note="journal notebook"),
           I("study.mug", "study", "decor", ["pen-mug"], note="mug of pens"),
           I("study.headphones", "study", "decor", ["succulent"], note="R4: small succulent on the desk"),
           I("study.backpack", "study", "decor", ["backpack"], note="backpack leaning on the desk"),
           I("study.chair", "study", "decor", ["desk-chair"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="desk chair"),
           I("study.bin", "study", "decor", E), I("study.plant", "study", "decor", E)]
    # kitchen (left wall, front)
    it += [I("kitchen.microwave", "kitchen", "decor", ["fridge"], note="R4: fridge with real depth"),
           I("kitchen.table", "kitchen", "decor", ["kitchen-shelf"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="R4: open shelf with jars and a plant"),
           I("kitchen.hooks", "kitchen", "decor", E),
           I("kitchen.door", "kitchen", "hotspot", ["corkboard-kitchen"], STGK, alias={"base": "s1"}, target=SKI("college-integration"),
             label="COLLEGE INTEGRATION", note="R4: no door; the kitchen-wall corkboard of flyers, photos and tickets (more by stage)"),
           I("kitchen.clock", "kitchen", "decor", E),
           I("kitchen.doormat", "kitchen", "hotspot", ["envelope"], ("base", "alert"), target=FTR("review"), label="REVIEW",
             note="R4: envelope on the counter (alert: flap up, red seal)"),
           I("kitchen.shoes", "kitchen", "decor", E, alias={"t1": "base", "t3": "base"}),
           I("kitchen.settings", "kitchen", "hotspot", ["switch-panel"], target=FTR("settings"), label="SETTINGS", note="switch panel low by the counter"),
           I("kitchen.switch", "kitchen", "decor", E),
           I("kitchen.relic", "kitchen", "hotspot", ["relic-mount-L"], RELK, target=FTR("relic-left"), label="RELIC", note="relic mount above the counter"),
           I("kitchen.counter", "kitchen", "decor", ["counter"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="hardwood lower cabinets, butcher-block top"),
           I("kitchen.spices", "kitchen", "decor", E),
           I("kitchen.food", "kitchen", "hotspot", ["fruit-basket"], STGK, alias={"base": "s1"}, target=SKI("food"), label="FOOD", note="fruit basket on the counter"),
           I("kitchen.water", "kitchen", "decor", ["water-jug"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, note="water jug (fills g0..g3)"),
           I("kitchen.kettle", "kitchen", "decor", ["kettle"], note="kettle"),
           I("kitchen.board", "kitchen", "decor", E),
           I("kitchen.gut", "kitchen", "hotspot", ["gut-plant"], STGK, alias={"base": "s1"}, target=SKI("gut-health"), label="GUT HEALTH", note="big leafy floor plant"),
           I("kitchen.stool", "kitchen", "decor", E)]
    # bed (left wall, back)
    it += [I("bed.frame", "bed", "decor", ["bed", "headboard"], alias={"t1": "base", "t2": "base", "t5": "base"}, note="R4: low platform bed with the lilac quilt"),
           I("bed.bed", "bed", "hotspot", ["alarm-clock"], alias=SA, target=SKI("sleep"), label="SLEEP", note="R4: the alarm clock on the nightstand"),
           I("bed.nightstand", "bed", "decor", ["nightstand"], note="nightstand"),
           I("bed.shelf", "bed", "decor", ["bed-shelf"], note="wall shelf with a trailing plant"),
           I("bed.globe", "bed", "hotspot", ["plasma-globe"], alias=SA, target=SKI("visualization"), label="VISUALIZATION",
             note="plasma globe (tendrils and wall glow are the bed.globe-glow anim)"),
           I("bed.sconce", "bed", "decor", ["star-jar"], ("base", "night"), note="R4: jar of paper stars"),
           I("bed.charger", "bed", "decor", E),
           I("bed.poster", "bed", "decor", ["bed-frame-art"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="framed piece above the bed"),
           I("bed.runner", "bed", "decor", ["med-rug"], alias={"t3": "base"}, note="R4: small round rug at the foot of the bed"),
           I("bed.cushion", "bed", "hotspot", ["med-cushion", "med-candle"], STGK, alias={"base": "s1"}, target=SKI("meditation"), label="MEDITATION",
             note="meditation cushion and candle (s0 cushion only)"),
           I("bed.slippers", "bed", "decor", E), I("bed.hamper", "bed", "decor", E, alias={"t1": "base", "t3": "base", "t5": "base"})]
    # computer (right wall, back)
    it += [I("computer.board", "computer", "hotspot", ["whiteboard"], STGK, alias={"base": "s1"}, target=SKI("dropshipping"), label="DROPSHIPPING",
             note="product whiteboard (sticky notes by stage)"),
           I("computer.shelf", "computer", "decor", ["pc-shelf"], note="small shelf with a figurine and a plant"),
           I("computer.router", "computer", "decor", E),
           I("computer.desk", "computer", "decor", ["pc-desk"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="desk"),
           I("computer.led", "computer", "decor", ["pc-tower"], note="R4: PC tower with a dim steady LED"),
           I("computer.ai", "computer", "hotspot", ["monitors"], alias=SA, target=SKI("ai-building"), label="AI BUILDING",
             note="two monitors, keyboard, speaker (green code scroll is the computer.terminal anim)"),
           I("computer.focus", "computer", "hotspot", ["focus-note"], target=FTR("focus"), label="FOCUS", note="weekly focus sticky note"),
           I("computer.headset", "computer", "decor", ["headphones"], note="headphones on a hook"),
           I("computer.speakers", "computer", "decor", E), I("computer.can", "computer", "decor", E),
           I("computer.money", "computer", "decor", ["money-tree"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, note="braided money tree (g0..g3)"),
           I("computer.chair", "computer", "decor", ["pc-chair"], alias={"t1": "base", "t3": "base", "t5": "base"}, note="chair"),
           I("computer.cables", "computer", "decor", E, alias={"t1": "base", "t3": "base"}),
           I("computer.boxes", "computer", "decor", E), I("computer.mug", "computer", "decor", E)]
    # gym (right wall, front)
    it += [I("gym.relic", "gym", "hotspot", ["relic-bracket-R"], RELK, target=FTR("relic-right"), label="RELIC", note="relic bracket by the bike"),
           I("gym.light", "gym", "decor", E, ("base", "night")),
           I("gym.medals", "gym", "decor", ["medal-wall"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, note="medal wall and race bib (g0..g3)"),
           I("gym.trophies", "gym", "decor", E, alias={"t1": "base", "t3": "base", "t5": "base"}),
           I("gym.timer", "gym", "decor", ["gym-timer"], note="R4: red LED gym timer (digits are the gym.timer-led anim)"),
           I("gym.tiles", "gym", "decor", E, alias={"t1": "base", "t3": "base", "t5": "base"}),
           I("gym.strength", "gym", "hotspot", ["weight-rack"], STGK, alias={"base": "s1"}, target=SKI("strength"), label="STRENGTH",
             note="weight rack (heavier plates by stage)"),
           I("gym.rope", "gym", "decor", E), I("gym.mat", "gym", "decor", E),
           I("gym.bike", "gym", "hotspot", ["bike"], ("base", "awake"), alias=SA, target=SKI("triathlon"), label="TRIATHLON",
             note="tri bike under a half-draped tarp (awake: tarp off)"),
           I("gym.running", "gym", "hotspot", ["shoe-shelf"], alias=SA, target=SKI("running"), label="RUNNING", note="running shoes on a wall shelf"),
           I("gym.chalk", "gym", "decor", E), I("gym.bottle", "gym", "decor", ["bottle"], note="water bottle"),
           I("gym.roller", "gym", "decor", ["foam-roller"], note="foam roller"),
           I("gym.kettlebell", "gym", "decor", E), I("gym.bag", "gym", "decor", E),
           I("gym.plant", "gym", "decor", ["gym-plant"], note="corner plant")]
    for cid in ("shell.crop.speaker", "shell.crop.boxes", "shell.crop.plant", "shell.crop.cables"):
        it.append(I(cid, "shell", "decor", E, layer=6))
    return it


# moving lights: (item id, zone, channel, frames, frame sequence, fps)
ANIMS = [("window.crt-flicker", "window", "crt", 3, [0, 0, 1, 0, 2, 0, 0, 1], 8),
         ("bed.globe-glow", "bed", "globe", 3, [0, 1, 2, 1], 4),
         ("library.potions-bubbles", "library", "potions", 3, [0, 1, 2], 3),
         ("study.lamp-dust", "study", "dust", 3, [0, 1, 2], 2),
         ("computer.terminal", "computer", "terminal", 4, [0, 1, 2, 3], 3),
         ("gym.timer-led", "gym", "timer", 4, [0, 1, 2, 3], 2)]
ZONE_ON = {"kitchen": "kettle", "bed": "plasma-globe", "library": "floor-lamp", "study": "desk-lamp", "computer": "pc-tower",
           "gym": "gym-timer"}


class LR:
    cache = {}


def render(tag, tod="golden", var=None, tier=3, beam=False, ghost=False, anim=None):
    """Full lit render. Returns (img, oid, {name: [oids]}, ghost masks, screens)."""
    key = (tag, tod)
    if key in LR.cache:
        return LR.cache[key]
    VAR.clear()
    VAR.update(BASEVAR)
    VAR.update(var or {})
    AF.clear()
    AF.update(anim or {})
    img = build(tod, tier, beam=beam, ghost=ghost)
    names = {}
    for o in sorted(G.names):
        names.setdefault(G.names[o], []).append(o)
    r = (img, G.oid.copy(), names, dict(G.gmask), dict(G.screens), G.win)
    VAR.clear()
    AF.clear()
    LR.cache[key] = r
    return r


def obj_mask(r, objs):
    img, oid, names = r[0], r[1], r[2]
    m = np.zeros((H, W), bool)
    for o in objs:
        nm, _, k = o.partition("@")
        ids = names.get(nm, [])
        if nm == "void":
            ids = [0]
        elif k:
            ids = ids[int(k):int(k) + 1]
        elif len(ids) > 1:
            raise SystemExit(f"object {nm} is ambiguous ({len(ids)}); use {nm}@k")
        if not ids and nm != "void":
            raise SystemExit(f"unknown object {nm}")
        m |= np.isin(oid, ids)
    return m


TAGVAR = {}   # render tag -> {item id: key} (every item with that key is rendered in the same scene)


def tag_state(it, key):
    """(render tag, var, tier) for an item's rendered variant key."""
    if it["id"] == "window.statue":
        return key, {}, int(key[1])
    if key == "base":
        return "base", {}, 3
    return key, TAGVAR[key], 3


def bbox(a):
    ys, xs = np.nonzero(a != T)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def auto_layer(bottom):
    return 2 if bottom <= 302 else 3 if bottom <= 318 else 4 if bottom <= 334 else 5


def save_png(a, path):
    px = np.zeros((a.shape[0], a.shape[1], 4), np.uint8)
    px[..., :3] = RGB[a]
    px[..., 3] = np.where(a == T, 0, 255)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(px, "RGBA").save(path)


def r3_dog():
    """The R3 dog (base, alert) re-indexed into the R4 palette (swapped entries go to the nearest kept colour)."""
    p3 = json.load(open(os.path.join(ROOT, "art", "room-r3", "palette.json")))["colors"]
    rgb3 = {tuple(int(c[1][i:i + 2], 16) for i in (1, 3, 5)): k for k, c in enumerate(p3)}
    swapped = {3, 32, 33, 34, 35, 36}
    keep = [k for k in range(len(PAL)) if k not in swapped]
    out = {}
    for v in ("base", "alert"):
        im = np.array(Image.open(os.path.join(PROTO, "art-r3", "centre", f"dog.{v}.png")).convert("RGBA"))
        a = np.full(im.shape[:2], T, np.uint8)
        for y in range(im.shape[0]):
            for x in range(im.shape[1]):
                if im[y, x, 3] == 255:
                    k = rgb3[tuple(int(c) for c in im[y, x, :3])]
                    if k in swapped:
                        c = np.array(im[y, x, :3], int)
                        k = min(keep, key=lambda j: int(((RGB[j].astype(int) - c) ** 2).sum()))
                    a[y, x] = k
        out[v] = a
    return out


def derive_lut(src, dst, emit=None):
    """Most common target colour per source colour (a uniform LUT approximating a lighting change)."""
    mp = {}
    s, d = src.ravel(), dst.ravel()
    if emit is not None:
        s, d = s[~emit.ravel()], d[~emit.ravel()]
    for c in np.unique(s):
        if c == T:
            continue
        vals, cnt = np.unique(d[s == c], return_counts=True)
        t = int(vals[cnt.argmax()])
        if t != c:
            mp[PAL[c][0]] = PAL[t][0]
    return mp


def write_live_palette(luts):
    out = {
        "_note": "FORGE room R4 palette (art pass 4): the R3 palette with 6 entries swapped (see palette-proposal.json): "
                 "plum-charcoal plaster, the knight's energy and visor colours, the night sky and the plasma/quilt violet. "
                 "Same count (37), same index order. LUTs: R4 = golden hour (identity, the baked art), R3 = late afternoon, "
                 "R2 = midday, R1 = dawn (derived from the lighting strip renders: the most common target colour per colour), "
                 "NIGHT = after 10 PM for sprites without a painted night twin (every R4 sprite has one, drawn without "
                 "this LUT), DIM = room behind an open panel. Index 255 = transparent.",
        "colors": [[n, h] for n, h in PAL],
        "categories": json.load(open(os.path.join(ROOT, "art", "room-r3", "palette.json")))["categories"],
        "luts": luts,
    }
    with open(os.path.join(HERE, "palette.json"), "w") as f:
        json.dump(out, f, indent=1)


def export_live():
    items = live_items()
    TAGVAR.clear()
    for it in items:
        if it["kind"] != "shell" and it["id"] != "window.statue":
            for k in it["keys"]:
                if k not in ("base", "night"):
                    TAGVAR.setdefault(k, {})[it["id"]] = k
    base = render("base")
    night = render("night", "night")
    ghost = render("ghost", ghost=True)
    ghost_n = render("ghost-night", "night", ghost=True)
    root = os.path.join(PROTO, SPR_DIR)
    if os.path.isdir(root):
        for dp, _, fs in os.walk(root):
            for f in fs:
                if f.endswith(".png"):
                    os.remove(os.path.join(dp, f))
    built = []   # (item spec, {key: full-frame array}, {key: alias key})
    used = {}
    for it in items:
        arrays = {}
        if it["kind"] == "shell":
            for key, r in (("base", ghost), ("night", ghost_n)):
                m = obj_mask(r, it["objs"]) if it["objs"] else np.zeros((H, W), bool)
                arrays[key] = np.where(m, r[0], T).astype(np.uint8)
        else:
            for o in it["objs"]:
                used[o.split("@")[0] + ("@" + o.split("@")[1] if "@" in o else "")] = it["id"]
            for key in it["keys"]:
                if key == "night":
                    continue
                tag, var, tier = tag_state(it, key)
                tod_r = render(tag, var=var, tier=tier) if tag != "base" else base
                tod_n = render(tag, "night", var=var, tier=tier) if tag != "base" else night
                for k2, r in ((key, tod_r), (key + ".night", tod_n)):
                    m = obj_mask(r, it["objs"]) if it["objs"] else np.zeros((H, W), bool)
                    arrays[k2] = np.where(m, r[0], T).astype(np.uint8)
            if "night" in it["keys"]:
                arrays["night"] = arrays.pop("base.night")
        built.append((it, arrays))
    # every R4 object is exported once
    names = set()
    for nm, oids in base[2].items():
        if nm in SHELL_NAMES or nm == "void":
            continue
        names.update([nm] if len(oids) == 1 else [f"{nm}@{k}" for k in range(len(oids))])
    missing = sorted(names - set(used))
    if missing:
        raise SystemExit(f"R4 objects not exported: {missing}")
    # renders for the tiers, the beam, the variants (fills LR.cache) are done; build records
    manifest = []
    pal_rend = {}

    def write(it, arrays, alias, layer=None, extra=None):
        box = union([bbox(a) for a in arrays.values()])
        if box is None:   # an empty placeholder: one transparent pixel
            box = (OX, OY, OX + 1, OY + 1)
        x0, y0, x1, y1 = box
        zone, name = it["id"].split(".", 1)
        variants = {}
        for v, a in arrays.items():
            rel = f"{SPR_DIR}/{zone}/{name}.{v}.png"
            save_png(a[y0:y1, x0:x1], os.path.join(PROTO, rel))
            variants[v] = rel
        for v, src in alias.items():
            variants[v] = variants[src]
            if src + ".night" in variants:
                variants[v + ".night"] = variants[src + ".night"]
        lay = layer if layer is not None else (it.get("layer") if it.get("layer") is not None else auto_layer(y1))
        rec = {"id": it["id"], "zone": it["zone"], "kind": it["kind"], "layer": int(lay), "x": x0 - OX, "y": y0 - OY,
               "w": x1 - x0, "h": y1 - y0, "variants": variants}
        if it["kind"] == "hotspot":
            rec["target"], rec["label"] = it["target"], it["label"]
            # LED: on the object's lower right, inside its sprite
            a = arrays[it["keys"][0] if it["keys"][0] in arrays else "base"]
            ys, xs = np.nonzero(a != T)
            if not len(xs):
                raise SystemExit(f"{it['id']}: empty hotspot sprite")
            i = int(np.argmax(xs + ys))
            lx = min(max(int(xs[i]) - 3, x0), x1 - 3)
            ly = min(max(int(ys[i]) - 3, y0), y1 - 3)
            rec["led"] = [lx - OX, ly - OY]
            pw, ph = max(0, MIN_HIT - (x1 - x0)), max(0, MIN_HIT - (y1 - y0))
            rec["hit"] = [x0 - OX - pw // 2, y0 - OY - ph // 2, x1 - x0 + pw, y1 - y0 + ph]
        if extra:
            rec.update(extra)
        if it.get("note"):
            rec["note"] = it["note"]
        manifest.append(rec)
        return rec

    owner_layer = np.zeros((H, W), np.int8)
    for it, arrays in built:
        extra = None
        if it.get("screen"):
            sx0, sy0, sx1, sy1 = base[4][it["screen"]]
            extra = {"screen": [sx0 - OX, sy0 - OY, sx1 - sx0, sy1 - sy0]}
        rec = write(it, arrays, it["alias"], extra=extra)
        if it["kind"] != "shell":
            a = arrays.get("base", arrays.get(it["keys"][0]))
            owner_layer[(a != T) & (owner_layer < rec["layer"])] = rec["layer"]

    def top_layer(m):
        v = owner_layer[m]
        return int(min(5, max(2, v.max() if len(v) else 2)))

    # the dog (R3 sprite, re-indexed), placed by the engine at centre.dogSleep
    dog = r3_dog()
    dx, dy = 455, 352
    arrays = {}
    for v, a in dog.items():
        full = np.full((H, W), T, np.uint8)
        h_, w_ = a.shape
        full[dy - h_:dy, dx - w_ // 2:dx - w_ // 2 + w_] = a
        arrays[v] = full
    write(I("centre.dog", "window", "decor", []), arrays, {}, layer=4)
    # moving lights
    for aid, zone, ch, n, seq, fps in ANIMS:
        fr = {}
        for tod in ("golden", "night"):
            fr[tod] = [(base if tod == "golden" else night)[0]] + [
                render(f"anim-{ch}-{k}", tod, anim={ch: k})[0] for k in range(1, n)]
        m = np.zeros((H, W), bool)
        for tod in fr:
            for a in fr[tod][1:]:
                m |= a != fr[tod][0]
        if not m.any():
            raise SystemExit(f"anim {aid}: frames do not differ")
        arrays = {"base": np.where(m, fr["golden"][0], T).astype(np.uint8),
                  "night": np.where(m, fr["night"][0], T).astype(np.uint8)}
        for k in range(1, n):
            arrays[f"f{k}"] = np.where(m, fr["golden"][k], T).astype(np.uint8)
            arrays[f"n{k}"] = np.where(m, fr["night"][k], T).astype(np.uint8)
        rec = write(I(aid, zone, "decor", []), arrays, {}, layer=top_layer(m), extra=None)
        v = rec["variants"]
        fk = ["base"] + [f"f{k}" for k in range(1, n)]
        nk = ["night"] + [f"n{k}" for k in range(1, n)]
        rec["anim"] = {"frames": [v[fk[i]] for i in seq], "night": [v[nk[i]] for i in seq], "fps": fps}
        for k in range(1, n):
            del v[f"f{k}"], v[f"n{k}"]
        rec["note"] = f"R4 moving light ({ch}): anim frames over the base; anim.night over the night twin"
    # overlays: knight beam (downlight), close-up per tier, zone lamp dots
    beam = render("beam", var={}, beam=True)
    kn = obj_mask(beam, ["knight"])
    diff = (beam[0] != base[0]) & ~kn
    write(I("window.statue-downlight", "window", "overlay", []), {"base": np.where(diff, beam[0], T).astype(np.uint8)}, {},
          layer=top_layer(diff), extra={"note": "R4: the thick ceiling beam on the knight with floating dust (after a knight click)"})
    kx = int(pj(KN_X, 0, 0)[0])
    cb = (kx - 60, 118, kx + 60, 312)
    arrays = {}
    for t in range(1, 6):
        a = np.full((H, W), T, np.uint8)
        r = render(f"t{t}", var={}, tier=t)
        a[cb[1]:cb[3], cb[0]:cb[2]] = r[0][cb[1]:cb[3], cb[0]:cb[2]]
        arrays[f"t{t}"] = a
    write(I("window.statue-closeup", "window", "overlay", []), arrays, {"base": "t1"}, layer=6,
          extra={"note": "panel close-up of the knight per tier (never drawn in the room)"})
    zone_light = {}
    for zid, nm in ZONE_ON.items():
        m = obj_mask(base, [nm])
        ys, xs = np.nonzero(m)
        cx, cy = int(np.median(xs)), int(np.median(ys))
        zone_light[zid] = (cx - OX, cy - OY, 24)
        arrays = {}
        for key, r in (("base", base), ("night", night)):
            a = np.full((H, W), T, np.uint8)
            a[cy:cy + 2, cx:cx + 2] = r[0][cy:cy + 2, cx:cx + 2]
            arrays[key] = a
        write(I(zid + ".on", zid, "overlay", []), arrays, {}, layer=top_layer(arrays["base"] != T),
              extra={"note": "the zone's lamp point (same pixels as the art; the engine reads its position)"})
    zone_light["window"] = (int((base[5][0] + base[5][2]) / 2) - OX, int((base[5][1] + base[5][3]) / 2) - OY, 24)
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump({"part": "room-r4", "items": manifest}, f, indent=1)
    with open(os.path.join(HERE, "zones.json"), "w") as f:
        json.dump(make_zones(manifest, base, zone_light), f, indent=1)
    # LUTs from the lighting strip renders
    dawn = render("dawn", "dawn")[0]
    noon = render("midday", "midday")[0]
    luts = {
        "_note": "colour name -> colour name for art layers; unlisted colours stay. R4 golden (85%+), R3 60-84, R2 midday "
                 "25-59, R1 dawn 0-24, NIGHT after 10 PM (unpainted sprites only), DIM behind a panel.",
        "R4": {},
        "R3": {"GLOW": "ORANGE", "RIM": "TERRA_2", "AMBER": "OAK_2", "SUN": "GLOW", "ORANGE": "RIM"},
        "R2": derive_lut(base[0], noon),
        "R1": derive_lut(base[0], dawn),
        "NIGHT": derive_lut(base[0], night[0]),
        "DIM": {"SUN": "AMBER", "GLOW": "TERRA_2", "ORANGE": "TERRA_1", "RIM": "TERRA_1", "TERRA_2": "TERRA_1",
                "TERRA_1": "BROWN_2", "AMBER": "OAK_2", "OAK_2": "OAK_1", "CREAM": "OAK_2", "SLATE_2": "SLATE_1",
                "SLATE_1": "SLATE_0", "LEAF_3": "LEAF_2", "LEAF_2": "LEAF_1", "PLUM_3": "PLUM_2", "GOLD": "GOLD_DK",
                "CRT_1": "CRT_0", "PLASTER": "PLASTER_0", "PLASTER_0": "INK", "ENERGY_HI": "ENERGY", "ENERGY": "SLATE_1",
                "VIOLET": "PLUM_1", "NAVY": "INK"},
    }
    write_live_palette(luts)
    kinds = {}
    for r in manifest:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"live export: {len(manifest)} items {kinds}, {len(LR.cache)} renders")
    return manifest


ZONE_NAMES = [("kitchen", "KITCHEN"), ("bed", "BED"), ("library", "LIBRARY"), ("window", "WINDOW"), ("study", "STUDY DESK"),
              ("computer", "COMPUTER"), ("gym", "GYM")]


def make_zones(items, base, zone_light):
    AX, AY = -OX, -OY
    skills = {}
    zones = []
    for n, (zid, name) in enumerate(ZONE_NAMES, 1):
        hs = [i for i in items if i["zone"] == zid and i["kind"] == "hotspot"]
        for i in hs:
            if "skill" in i["target"]:
                skills[i["target"]["skill"]] = zid
        boxes = [(i["hit"][0], i["hit"][1], i["hit"][0] + i["hit"][2], i["hit"][1] + i["hit"][3]) for i in hs]
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        w = min(270, max(220, (x1 - x0) + 40, ((y1 - y0) + 24) * 16 / 9))
        h = w * 9 / 16
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fx = min(max(cx - w / 2, AX), AX + W - w)
        fy = min(max(cy - h / 2, AY), AY + H - h)
        zones.append({"id": zid, "n": n, "name": name, "focus": [round(fx), round(fy), round(w), round(h)],
                      "stop": round(cx), "phoneStop": round(min(max(cx, 60), 640 - 60)),
                      "hotspots": [i["id"] for i in hs], "territory": {"x0": round(x0), "x1": round(x1)},
                      "light": list(zone_light[zid])})
    for a, b in zip(zones, zones[1:]):
        if a["territory"]["x1"] > b["territory"]["x0"]:
            mid = round((a["stop"] + b["stop"]) / 2)
            a["territory"]["x1"] = min(a["territory"]["x1"], mid)
            b["territory"]["x0"] = max(b["territory"]["x0"], mid)
    statue = next(i for i in items if i["id"] == "window.statue")
    rug_ = next(i for i in items if i["id"] == "window.rug")
    (bx0, by0), (bx1, by1) = pji(-WX, CEIL, 0), pji(WX, 0, 0)
    wx0, wy0, wx1, wy1 = base[5]
    bt = pj(KN_X, CEIL, KN_Z)
    return {
        "_note": "R4 world coordinates (art px): master (800x480) = world + (80, 96). The 640x270 core is x 0..640, y 0..270; "
                 "the art spans x -80..720, y -96..384. Keys 1-7 run left to right. focus = what a zone step-in frames. "
                 "stop = zone centre x for the phone pan. light = the zone's lamp point [x, y, r]. "
                 "Generated by art/room-r4/build.py.",
        "art": {"x": AX, "y": AY, "w": W, "h": H},
        "core": {"w": 640, "h": 270},
        "horizon": int(CY) - OY,
        "vp": [int(CX) - OX, int(CY) - OY],
        "camera": {"defaultZoom": 1.3, "horizonPct": round((CY - OY) / 270, 3), "phoneDefaultX": 320,
                   "defaultZoomNote": "default view up to 1.3x closer than the full core (whole pixels); the phone pan starts "
                                      "centred on the knight, window and CRTs"},
        "zones": zones,
        "shell": {"backWall": [bx0 - OX, by0 - OY, bx1 - OX, by1 - OY], "window": [wx0 - OX, wy0 - OY, wx1 - OX, wy1 - OY],
                  "sill": [wx0 - 7 - OX, wy1 + 1 - OY, wx1 + 7 - OX, wy1 + 6 - OY], "ceilingY": by0 - OY, "floorBackY": by1 - OY,
                  "leftWall": {"formula": "one-point camera in art/room-r4/build.py (pj): side walls at X = -17.7 / +17.7 ft"},
                  "rightWall": "mirror of leftWall about master x = 400"},
        "centre": {"statue": [statue["x"], statue["y"], statue["w"], statue["h"]], "statueContactY": statue["y"] + statue["h"],
                   "rug": [rug_["x"], rug_["y"], rug_["w"], rug_["h"]], "downlight": [int(bt[0]) - OX, int(bt[1]) - OY],
                   "dogSleep": [455 - OX, 352 - OY], "sunbeam": "glowing sun reflection on the satin floor"},
        "relics": {"relic-left": "kitchen.relic", "relic-window": "window.relic", "relic-right": "gym.relic"},
        "layers": {"_note": "L0 sky, L1 outside, L2 shell plates (cut from the ghost render) and the back wall, L3-L5 objects by "
                            "contact depth; objects are disjoint cuts of one lit render, so draw order only matters for variants."},
        "skills": dict({"_note": "Every skill maps to exactly one hotspot object."}, **dict(sorted(skills.items()))),
    }


if __name__ == "__main__":
    import sys
    if "--live-only" not in sys.argv:
        main()
    if "--stills-only" not in sys.argv:
        export_live()
