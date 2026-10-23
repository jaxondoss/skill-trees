#!/usr/bin/env python3
"""FORGE dorm room, art pass 5: three views (main, left, right), smooth light, layered live export.

Art pass 5 changes on top of pass 4 (deterministic, Pixel Art Studio style):
  * Views: VIEW in {main, left, right}. Each view is its own one-point camera (set_view): the left view faces the
    left wall (bed, kitchen), the right view faces the right wall (dropshipping desk, gym) with the study desk on
    its left side wall. World coordinates stay the room's; local() maps them into the view's frame.
  * Light: objects are baked at one flat ramp level each (no rings inside the art); every light circle, the window
    wash and the vignette are a smooth RGB overlay (overlay_rgb) that the engine redraws with canvas gradients
    from the same spec (zones.json views.<v>.light).
  * Window: mountains behind the rooftops; clouds, birds and the streetcar move (separate drift sprites live).


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
OUT = os.path.join(ROOT, "docs", "redesign", "room-r5", "stills")

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
CORE4 = (80, 96, 720, 366)
F, D0, EYE, CX, CY = 559.0, 43.0, 6.77, 400.0, 212.0
WX, CEIL = 17.7, 13.5
RW, RD = 17.7, 22.0          # room half width (X) and depth (z) in world feet
XCAM = 0.0
VIEW = "main"
TOD = "golden"
TIER = 3
FLAGS = {"beam": False}
# Per-view camera: F, D0 (camera distance from the view's back wall), EYE, CX, CY (vanishing point in the master),
# WX (half width of the view's back wall), XCAM (camera lateral position), core crop (the default framing,
# 15% closer than pass 4's 640x270 core: 556x235).
VIEWS = {
    "main": dict(F=559.0, D0=43.0, EYE=6.77, CX=400.0, CY=212.0, WX=RW, XCAM=0.0, core=(122, 116, 678, 351)),
    "left": dict(F=456.0, D0=24.0, EYE=4.6, CX=425.0, CY=226.0, WX=RD / 2, XCAM=1.0, core=(122, 116, 678, 351)),
    "right": dict(F=456.0, D0=24.0, EYE=4.6, CX=556.0, CY=226.0, WX=RD / 2, XCAM=3.4, core=(122, 116, 678, 351)),
}
CORE = VIEWS["main"]["core"]


def set_view(v):
    global F, D0, EYE, CX, CY, WX, XCAM, VIEW, CORE
    c = VIEWS[v]
    F, D0, EYE, CX, CY, WX, XCAM, CORE = c["F"], c["D0"], c["EYE"], c["CX"], c["CY"], c["WX"], c["XCAM"], c["core"]
    VIEW = v


def local(X, z):
    """World (X, z) -> the view's local (lateral, depth from its back wall)."""
    if VIEW == "left":
        return RD / 2 - z, X + RW
    if VIEW == "right":
        return z - RD / 2, RW - X
    return X, z


ZS = {"dz": 0.0}


def sc(z):
    return F / (D0 - z - ZS["dz"])


COMP = {"k": None}


@contextmanager
def zshift(dz):
    ZS["dz"] = dz
    yield
    ZS["dz"] = 0.0


def pj(X, Y, z):
    if COMP["k"] is not None and X != 0:
        g = WX - abs(X)
        X = math.copysign(WX - g * COMP["k"], X)
    s = sc(z)
    return (CX + (X - XCAM) * s, CY - (Y - EYE) * s)


def wp(X, Y, z):
    """Project a world point in any view."""
    lx, lz = local(X, z)
    return pj(lx, Y, lz)


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
SHELL_NAMES = {"ceiling", "wall-L", "wall-R", "wall-B", "floor", "window-view", "window-sky", "window-frame", "curtains",
               "window-side"}


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
    G.glows = []
    G.win = None
    G.sunfloor = (0, 330)
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


GLOW_RGB = {"warm": (255, 176, 96), "red": (255, 64, 40), "green": (70, 255, 130), "violet": (176, 104, 255),
            "cyan": (70, 226, 246), "pink": (255, 112, 168), "ember": (255, 118, 44), "potion": (226, 112, 214),
            "lamp": (255, 186, 104), "sun": (255, 150, 64)}
CH = {"ch": None}   # anim channel that the next light()/tint() calls belong to (their strength follows its frames)


def light(cx, cy, rx, ry, amp):
    G.lights.append((cx, cy, rx, ry, amp))
    G.glows.append(dict(x=cx, y=cy, rx=rx * 1.2, ry=ry * 1.2, c="warm", a=0.20 * amp, ch=CH["ch"]))


def tint(cx, cy, rx, ry, kind, k=1.0):
    G.tints.append((cx, cy, rx, ry, kind, k))
    G.glows.append(dict(x=cx, y=cy, rx=rx * 1.6, ry=ry * 1.6, c=kind, a=0.20 * k, ch=CH["ch"]))


@contextmanager
def channel(ch):
    CH["ch"] = ch
    yield
    CH["ch"] = None


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
    if X1 < XCAM:
        q = [pj(X1, Y1, z0), pj(X1, Y1, z1), pj(X1, Y0, z1), pj(X1, Y0, z0)]
        POLY(q, side, ol)
        faces["side"] = q
    if X0 > XCAM:
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


def floor_plant(X, z, kind="snake", k=0, h=1.0, potc="TERRA_1"):
    """Floor plants that sway: snake plant blades, a fiddle-leaf fig, or a fern."""
    px, py = pj(X, 0, z)
    s_ = sc(z) / 14.0
    if kind == "snake":
        pot(px - 5 * s_, py - 8 * s_, px + 5 * s_, py, potc)
        for i in range(7):
            a = -math.pi / 2 + (i - 3) * 0.16 + 0.05 * swv(k + i)
            ln = (22 + 9 * abs(math.sin(i * 1.7))) * h * s_
            bx, by = px + (i - 3) * 1.2 * s_, py - 8 * s_
            tip = (bx + math.cos(a) * ln, by + math.sin(a) * ln)
            POLY([(bx - 1.5 * s_, by), (bx + 1.5 * s_, by), tip], "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0")
            L(bx, by - 2, tip[0], tip[1] + 2, "LEAF_3" if i % 3 == 0 else "LEAF_1")
    elif kind == "fiddle":
        pot(px - 6 * s_, py - 10 * s_, px + 6 * s_, py, potc)
        top = py - 46 * h * s_
        L(px, py - 10 * s_, px + swv(k), top, "OAK_0")
        for i in range(9):
            yy = py - (16 + i * 3.4) * h * s_
            side = 1 if i % 2 else -1
            big_leaf(px + swv(k + i) * (i / 9), yy, -math.pi / 2 + side * (0.9 - i * 0.06) + 0.06 * swv(k + i),
                     9 * s_ + 2, 4 * s_ + 1, "LEAF_2" if i % 3 else "LEAF_1", "LEAF_0", "LEAF_0", hi="LEAF_3")
    else:   # fern
        pot(px - 6 * s_, py - 8 * s_, px + 6 * s_, py, potc)
        for i in range(11):
            a = -math.pi / 2 + (i - 5) * 0.27 + 0.06 * swv(k + i)
            ln = (16 + 6 * math.cos(i * 1.3)) * h * s_
            bx, by = px, py - 8 * s_
            pts = [(bx + math.cos(a) * ln * t + math.sin(t * 3) * 0.6, by + math.sin(a) * ln * t + (ln * 0.25) * t * t)
                   for t in (0, 0.25, 0.5, 0.75, 1.0)]
            PL(pts, "LEAF_1")
            for (x_, y_) in pts[1:]:
                P(x_ - 1, y_, "LEAF_2")
                P(x_ + 1, y_ - 1, "LEAF_2" if i % 2 else "LEAF_3")
    shadow_ell(px, py, 9 * s_, 2)


def pot(x0, y0, x1, y1, c="TERRA_1"):
    BOX(x0, y0, x1, y1, c, hi=LIGHTER.get(c), sh="TERRA_0" if c.startswith("TERRA") else "INK")


def swv(k=0):
    """Gentle plant sway: -1..1 px by the 'sway' anim frame (frame 0 = the still), phase k per plant."""
    return (0, 1, 0, -1)[(af("sway") + k) % 4]


def vine(x, y, length, rng, drift=0.0, sw=0):
    x0 = x
    for i in range(length):
        y += 1
        if rng.random() < 0.3:
            x0 += 1 if rng.random() < 0.5 + drift else -1
        x = x0 + int(round(sw * (i / max(1, length)) ** 1.5 * 1.6))
        P(x, y, "LEAF_0")
        if i % 3 == 1:
            s = 1 if (i // 3) % 2 else -1
            P(x + s, y, "LEAF_2")
            P(x + s, y + 1, "LEAF_1")
            if i % 9 == 4 and TOD == "golden":
                P(x + s, y, "LEAF_3")   # sunset catching a leaf


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
        POLY([(0, 0), (W, 0), pj(WX, CEIL, zf), (bx1, by0), (bx0, by0), pj(-WX, CEIL, zf)], "INK")
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
    # long beams converging on the window (along z): dark and moody, a thin warm lip on the undersides
    for X in (-13.0, -6.5, 6.5, 13.0):
        a0, a1 = pj(X - 0.35, CEIL, 0), pj(X - 0.35, CEIL, 22)
        b0, b1 = pj(X + 0.35, CEIL, 0), pj(X + 0.35, CEIL, 22)
        c0, c1 = pj(X - 0.35, CEIL - 0.55, 0), pj(X - 0.35, CEIL - 0.55, 22)
        d0, d1 = pj(X + 0.35, CEIL - 0.55, 0), pj(X + 0.35, CEIL - 0.55, 22)
        POLY([a0, a1, c1, c0], "INK")          # side
        POLY([c0, c1, d1, d0], "OAK_DK")       # underside
        POLY([b0, b1, d1, d0], "INK")
        L(*c0, *c1, "VOID")
        L(*d0, *d1, "OAK_0" if X < 0 else "VOID")
    # cross beams (along X)
    for z in (2.5, 7.0, 13.0):
        a, b = pj(-WX, CEIL - 0.6, z), pj(WX, CEIL - 0.6, z)
        c, d = pj(-WX, CEIL, z), pj(WX, CEIL, z)
        e, f = pj(-WX, CEIL - 0.6, z + 0.6), pj(WX, CEIL - 0.6, z + 0.6)
        POLY([c, d, b, a], "INK")
        POLY([a, b, f, e], "OAK_DK")
        L(*e, *f, "VOID")
        L(*a, *b, "OAK_0")
    # planks between the beams (dark seams)
    for X in (-15.5, -11.0, -9.0, -4.0, -2.0, 2.0, 4.0, 9.0, 11.0, 15.5):
        a, b = pj(X, CEIL, 0), pj(X, CEIL, 22)
        L(*a, *b, "VOID")
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
    POLY([pj(-4.0, CEIL, 8.0), pj(-3.6, CEIL, 8.3), pj(-3.6, CEIL, 12.1), pj(-4.0, CEIL, 12.4)], "INK")
    POLY([pj(4.0, CEIL, 8.0), pj(3.6, CEIL, 8.3), pj(3.6, CEIL, 12.1), pj(4.0, CEIL, 12.4)], "INK")
    L(*pj(-3.6, CEIL, 12.1), *pj(3.6, CEIL, 12.1), "OAK_0")
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
    # hanging plants dangling from the ceiling (sway)
    for k, (X, z, ln) in enumerate(((-13.0, 4.5, 26), (15.2, 3.0, 22), (1.6, 9.5, 14), (-9.6, 11.0, 24),
                                    (10.0, 11.5, 22), (-7.4, 1.8, 18))):
        hanging_plant(X, z, ln, rng, k)
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


def hanging_plant(X, z, ln, rng, k=0, top_y=None, drop=2.3, name="hang-plant"):
    with obj(name):
        top = pj(X, CEIL - 0.55 if top_y is None else top_y, z)
        bot = pj(X, (CEIL if top_y is None else top_y + 0.55) - drop, z)
        sw = swv(k)
        bx = bot[0] + (1 if sw > 0 else 0) * 0
        L(top[0], top[1], bx - 4, bot[1], "INK")
        L(top[0], top[1], bx + 4, bot[1], "INK")
        for i in range(5):
            vine(int(bx) - 4 + i * 2, int(bot[1]) + 4, rng.randint(ln // 2, ln), rng, sw=swv(k + i))
        bush(bx, bot[1] - 1, 6, 3, rng, n=22)
        pot(bx - 5, bot[1], bx + 5, bot[1] + 5, "TERRA_1")


# ---------------------------------------------------------------- window
def window():
    X0, X1, Ys, Yt = WIN
    x0, y0 = pji(X0, Yt, 0)
    x1, y1 = pji(X1, Ys, 0)
    G.win = (x0, y0, x1, y1)
    with obj("window-sky", emit=True):
        sky(x0, y0, x1, y1)
    with obj("window-view", emit=True):
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


# window animation: TM["t"] = seconds since the loop start; PARTS = which window pieces this render draws
TM = {"t": 0.0}
PARTS = {"sky", "sun", "clouds", "birds", "far", "tram"}
CLOUD_V = 2.0      # px per second (the engine drifts the cloud strip at this speed)
TRAM_PERIOD = 18.0  # s between streetcar passes
BIRD_PERIOD = 23.0


def clipR(x0, y0, x1, y1, c, cx0, cx1):
    R(max(x0, cx0), y0, min(x1, cx1), y1, c)


def cloud(cx, cy, w, c, lit, dark, cx0, cx1):
    """A puffy flat cloud: three stacked rows with a lit top edge and a darker base."""
    clipR(cx + 2, cy + 2, cx + w - 2, cy + 3, dark, cx0, cx1)
    clipR(cx, cy, cx + w, cy + 2, c, cx0, cx1)
    clipR(cx + w * 0.18, cy - 2, cx + w * 0.62, cy - 1, c, cx0, cx1)
    clipR(cx + w * 0.30, cy - 3, cx + w * 0.50, cy - 3, c, cx0, cx1)
    clipR(cx + w * 0.62, cy - 1, cx + w * 0.82, cy - 1, c, cx0, cx1)
    clipR(cx + w * 0.22, cy - 3, cx + w * 0.46, cy - 3, lit, cx0, cx1)
    clipR(cx + w * 0.14, cy - 1, cx + w * 0.22, cy - 1, lit, cx0, cx1)
    clipR(cx + w * 0.64, cy - 1, cx + w * 0.78, cy - 1, lit, cx0, cx1)


def cloud_list(x0, y0, x1, sy):
    if TOD == "golden":
        return [(0.02, y0 + 10, 40, "TERRA_1", "RIM", "TERRA_0"), (0.30, y0 + 19, 52, "TERRA_2", "GLOW", "TERRA_1"),
                (0.62, y0 + 8, 34, "TERRA_1", "RIM", "TERRA_0"), (0.78, y0 + 31, 40, "TERRA_2", "GLOW", "TERRA_1"),
                (0.12, sy - 2, 46, "RIM", "SUN", "TERRA_2"), (0.52, sy + 8, 30, "ORANGE", "SUN", "RIM")]
    if TOD == "dawn":
        return [(0.05, y0 + 12, 36, "PLUM_1", "PLUM_3", "PLASTER"), (0.66, y0 + 22, 44, "PLUM_2", "CREAM", "PLUM_1")]
    if TOD == "midday":
        return [(0.05, y0 + 10, 34, "SLATE_2", "CREAM", "SLATE_1"), (0.60, y0 + 20, 50, "SLATE_2", "CREAM", "SLATE_1"),
                (0.30, y0 + 34, 40, "SLATE_2", "CREAM", "SLATE_1")]
    return [(0.08, y0 + 30, 40, "SLATE_0", "PLUM_1", "NAVY"), (0.58, y0 + 14, 30, "NAVY", "SLATE_0", "INK")]


def sky(x0, y0, x1, y1):
    hz = y1 - 22  # horizon line behind rooftops
    ww = x1 - x0
    bands = {
        "golden": ["PLUM_2", "TERRA_2", "RIM", "ORANGE", "GLOW", "SUN"],
        "dawn": ["NAVY", "PLUM_1", "PLUM_2", "PLUM_3", "CREAM", "CREAM"],
        "midday": ["SLATE_1", "SLATE_1", "SLATE_2", "SLATE_2", "CREAM", "CREAM"],
        "night": ["INK", "NAVY", "NAVY", "NAVY", "SLATE_0", "PLUM_1"],
    }[TOD]
    sx = x0 + int(ww * 0.47)
    sy = hz - 18 if TOD == "golden" else hz - 2
    if "sky" in PARTS:
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
        if TOD == "night":
            mx, my = x1 - 34, y0 + 16
            circ(mx, my, 7, "CREAM")
            circ(mx + 3, my - 2, 6, "NAVY")
            rng = random.Random(3)
            for _ in range(22):
                P(rng.randint(x0 + 2, x1 - 2), rng.randint(y0 + 2, hz - 24), "CREAM")
    if "sun" in PARTS:
        if TOD == "golden":
            circ(sx, sy, 15, "SUN")
            circ(sx, sy, 12, "CREAM")
            for k, yy in enumerate((sy + 5, sy + 9, sy + 12)):   # heat bands across the low sun
                L(sx - 14 + k, yy, sx + 14 - k, yy, "SUN")
        elif TOD == "dawn":
            circ(sx + 20, sy, 8, "CREAM")
    if "clouds" in PARTS:
        span = ww + 70
        for fx, cy, w, c, lit, dark in cloud_list(x0, y0, x1, sy):
            cx = x0 - 60 + ((fx * span + TM["t"] * CLOUD_V) % span)
            cloud(cx, cy, w, c, lit, dark, x0, x1)
    if "birds" in PARTS and TOD != "night":
        birds(x0, y0, x1, ((TM["t"] / BIRD_PERIOD) + BIRD_PHASE) % 1.0, int(TM["t"] * 4) % 2)


BIRD_PHASE, TRAM_PHASE = 0.45, 0.43


def birds(x0, y0, x1, u, flap, clip=True):
    """A small flock crossing the window (u in 0..1 across; drift: x = u * (ww + 60), y = 6 sin(7u))."""
    ww = x1 - x0
    bx = x0 - 30 + u * (ww + 60)
    by = y0 + 30 + 6 * math.sin(u * 7)
    if True:
        for k, (dx, dy) in enumerate(((0, 0), (-7, 3), (-12, -2), (-17, 4))):
            x, y = int(round(bx + dx)), int(round(by + dy))
            if not clip or (x0 + 1 <= x - 2 and x + 2 <= x1 - 1):
                c = "INK" if TOD == "golden" else "BROWN_1"
                if (flap + k) % 2:
                    P(x - 2, y, c); P(x - 1, y + 1, c); P(x, y, c); P(x + 1, y + 1, c); P(x + 2, y, c)
                else:
                    P(x - 2, y + 1, c); P(x - 1, y, c); P(x, y + 1, c); P(x + 1, y, c); P(x + 2, y + 1, c)


def mountains(x0, y0, x1, y1, hz):
    """Two ranges far behind the rooftops in the sunset colours: hazy far peaks, a nearer range with lit ridges."""
    night = TOD == "night"
    far = {"golden": ("PLUM_2", "PLUM_3", "TERRA_2"), "dawn": ("PLUM_1", "PLUM_2", "PLUM_3"),
           "midday": ("SLATE_1", "SLATE_2", "SLATE_2"), "night": ("NAVY", "SLATE_0", "SLATE_0")}[TOD]
    near = {"golden": ("PLUM_1", "RIM", "TERRA_2"), "dawn": ("PLASTER", "PLUM_2", "PLUM_1"),
            "midday": ("SLATE_0", "SLATE_1", "SLATE_1"), "night": ("INK", "NAVY", "NAVY")}[TOD]

    def profile(seed, amp, base, sharp):
        r = random.Random(seed)
        ph = [r.uniform(0, 6.28) for _ in range(4)]
        out = {}
        for xx in range(x0, x1 + 1):
            u = (xx - x0) / 40.0
            v = (0.55 * abs(math.sin(u * 1.1 + ph[0])) + 0.30 * abs(math.sin(u * 2.3 + ph[1])) ** sharp
                 + 0.15 * abs(math.sin(u * 5.1 + ph[2])))
            out[xx] = int(base - amp * v)
        return out

    for prof_args, cols in (((7, 30, hz - 2, 0.7), far), ((11, 20, hz + 3, 1.4), near)):
        pr = profile(*prof_args)
        col, ridge, face = cols
        for xx in range(x0, x1 + 1):
            yy = pr[xx]
            L(xx, yy, xx, prof_args[2] + 14, col)
        for xx in range(x0 + 1, x1):
            yy = pr[xx]
            if night:
                if xx % 7 == 0:
                    P(xx, yy, ridge)
                continue
            if pr[xx - 1] > yy or (pr[xx - 1] == yy and pr[xx + 1] > yy):
                P(xx, yy, ridge)                       # sunlit edge on the rising slopes
                if pr[xx - 1] - yy >= 1:
                    P(xx, yy + 1, face)
            # sunlit faces: a band below the ridge on slopes that face the sun (left of the light)
            if pr[xx - 1] > yy and (xx % 3):
                for k in range(2, 4):
                    P(xx, yy + k, face)


def outside(x0, y0, x1, y1):
    night = TOD == "night"
    hz = y1 - 22
    rng = random.Random(21)
    far = "SLATE_0" if night else ("SLATE_1" if TOD != "dawn" else "PLUM_1")
    roofl = {"golden": "RIM", "dawn": "PLUM_3", "midday": "SLATE_2", "night": "SLATE_1"}[TOD]
    if "far" in PARTS:
        mountains(x0, y0, x1, y1, hz)
        # far skyline (low, slate)
        x = x0
        while x < x1:
            w = rng.randint(6, 12)
            h = rng.randint(3, 7)
            POLY([(x, hz + 4), (x, hz - h + 3), (x + w // 2, hz - h), (x + w, hz - h + 3), (x + w, hz + 4)], far)
            if night and rng.random() < 0.6:
                P(x + w // 2, hz - h + 5, "GLOW")
            x += w + rng.randint(0, 2)

        def oak(cx, cy, rx, ry, seed):
            r2 = random.Random(seed)
            for _ in range(int(rx * ry / 3)):
                a = r2.uniform(0, math.tau)
                rr = r2.uniform(0, 1) ** 0.6
                xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
                ELL(max(x0, xx - 4), yy - 2, min(x1, xx + 4), yy + 2, "LEAF_0")
            if not night:
                for _ in range(int(rx * ry / 9)):
                    a = r2.uniform(math.pi * 1.0, math.pi * 1.8)
                    rr = r2.uniform(0.55, 1)
                    xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
                    if x0 <= xx <= x1 - 2:
                        R(xx, yy, xx + 2, yy, "LEAF_1")
                        if r2.random() < 0.35:
                            P(xx + 2, yy, roofl if TOD == "golden" else "LEAF_2")
            for _ in range(6):
                mx = r2.randint(int(cx - rx * 0.8), int(cx + rx * 0.8))
                my = int(cy + ry * 0.4)
                if x0 <= mx <= x1:
                    L(mx, my, mx, my + r2.randint(3, 6), "SLATE_0" if not night else "INK")

        oak(x0 + 10, y0 + 40, 22, 30, 3)
        L(x0 + 10, y0 + 56, x0 + 12, y1, "INK")
        L(x0 + 11, y0 + 56, x0 + 13, y1, "LEAF_0")
        oak(x1 - 14, y0 + 30, 26, 26, 4)
        L(x1 - 18, y0 + 46, x1 - 14, y1, "INK")
        px = x1 - 40
        L(px, y0 + 14, px, y1, "INK")
        L(px - 6, y0 + 18, px + 6, y0 + 18, "INK")
        for dy, s_ in ((18, 6), (22, 8)):
            sag(x0, y0 + dy + 6, px - 6, y0 + dy, s_, "INK")
            sag(px + 6, y0 + dy, x1, y0 + dy + 3, 2, "INK")
        sag(x0, hz - 6, x1, hz - 8, 4, "INK")
        near = "NAVY" if night else ("SLATE_0" if TOD != "midday" else "SLATE_1")
        x = x0 - 2
        while x < x1:
            w = rng.randint(10, 15)
            h = rng.randint(10, 15)
            top = y1 - h
            xa, xb = max(x0, x), min(x1, x + w)
            POLY([(xa, y1), (xa, top + 4), (x + w // 2, top), (xb, top + 4), (xb, y1)], near, "INK")
            L(xa + 1, top + 4, x + w // 2, top + 1, roofl)
            L(x + w // 2, top + 1, xb - 1, top + 4, "SLATE_1" if not night else "SLATE_0")
            if night or rng.random() < 0.4:
                R(x + 3, top + 7, x + 4, top + 9, "GLOW" if night else "INK")
            if night and rng.random() < 0.5:
                R(x + w - 5, top + 7, x + w - 4, top + 9, "SUN")
            x += w + rng.randint(1, 3)
    if "tram" in PARTS:
        tram(x0, y1, hz, night)
    if "far" in PARTS:
        L(x0, y1, x1, y1, "INK")


def tram(x0, y1, hz, night, u=None, clip=True):
    """The red streetcar on the neutral ground (drives left to right every TRAM_PERIOD s;
    drift: x = u * (ww + 80))."""
    x1 = G.win[2]
    if u is None:
        u = ((TM["t"] / TRAM_PERIOD) + TRAM_PHASE) % 1.0
    sx0 = x0 - 40 + int(u * ((x1 - x0) + 80))
    sy = y1 - 15
    cl0, cl1 = (x0, x1) if clip else (-9999, 9999)

    def r(a, b, c, d, col):
        clipR(a, b, c, d, col, cl0, cl1)
    r(sx0, sy, sx0 + 34, sy + 9, "INK")
    r(sx0 + 1, sy + 1, sx0 + 33, sy + 8, "CRT_0")
    r(sx0 + 1, sy + 1, sx0 + 33, sy + 1, "CRT_1")
    r(sx0 + 1, sy + 8, sx0 + 33, sy + 8, "TERRA_0")
    for wx in range(sx0 + 3, sx0 + 32, 4):
        r(wx, sy + 2, wx + 2, sy + 4, "SUN" if night else "CREAM" if TOD != "golden" else "GLOW")
    r(sx0 + 1, sy + 6, sx0 + 33, sy + 6, "GOLD_DK")
    if not clip or (x0 <= sx0 + 16 and sx0 + 22 <= x1):
        L(sx0 + 16, sy, sx0 + 22, hz - 7, "INK")   # trolley pole
    r(sx0 + 3, sy + 10, sx0 + 7, sy + 10, "INK")
    r(sx0 + 27, sy + 10, sx0 + 31, sy + 10, "INK")
    if night:
        r(sx0 + 34, sy + 7, sx0 + 34, sy + 7, "SUN")


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
        x0, y0 = pji(-15.6, 8.6, 0)
        x1, _ = pji(-13.2, 8.6, 0)
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
    # bookcase (Reading): the tall dark case with a rolling ladder and plants spilling off the top
    BX0, BX1, BH = -12.8, -8.6, 10.4
    with obj("bookcase"):
        f = box3d(BX0, BX1, 0, BH, 0, 1.2, "OAK_DK", side="INK", top="OAK_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 3, ay + 4, bx - 3, dy - 5, "VOID")                 # deep dark back
        L(ax + 1, ay + 1, bx - 1, ay + 1, "OAK_0")
        R(ax + 1, ay + 2, ax + 2, dy - 2, "OAK_0")                # side posts catch a little light
        L(bx - 1, ay + 2, bx - 1, dy - 2, "INK")
        R(ax, ay - 3, bx, ay - 1, "OAK_0")                        # cornice
        L(ax - 1, ay - 3, bx + 1, ay - 3, "INK")
        L(ax, ay - 1, bx, ay - 1, "INK")
        # rail for the ladder across the front, just under the cornice
        L(ax - 2, ay + 5, bx + 2, ay + 5, "GOLD_DK")
        P(ax - 2, ay + 5, "GOLD")
        P(bx + 2, ay + 5, "GOLD")
        shelves = 8
        hgt = (dy - 5 - (ay + 4)) / shelves
        for k in range(shelves):
            yb = int(ay + 4 + (k + 1) * hgt) - 1
            R(ax + 3, yb, bx - 3, yb + 1, "OAK_0")
            L(ax + 3, yb + 1, bx - 3, yb + 1, "INK")
            if k < shelves - 1:
                books_row(ax + 4, bx - 4, yb - 1, int(hgt) - 3, rng,
                          n_fill=(0.3, 0.85, 1.0)[stg("library.bookshelf")] * (1 if k not in (2, 5) else 0.6))
                if stg("library.bookshelf") == 2 and k % 2 == 0:
                    R(bx - 6, yb - 6, bx - 5, yb - 1, "GOLD")   # gold bookends
                if k == 2:
                    G.shelf_plant = (bx - 9, yb)
                if k == 5:   # a globe-shaped bookend ornament
                    circ(bx - 8, yb - 3, 2, "SLATE_1")
                    P(bx - 9, yb - 4, "SLATE_2")
            else:
                R(ax + 3, yb - int(hgt) + 3, bx - 3, yb - 1, "OAK_DK")
                L((ax + bx) // 2, yb - int(hgt) + 3, (ax + bx) // 2, yb - 1, "INK")
                P((ax + bx) // 2 - 3, yb - int(hgt) // 2 + 1, "GOLD_DK")
                P((ax + bx) // 2 + 3, yb - int(hgt) // 2 + 1, "GOLD_DK")
        shadow_fp(BX0, BX1, 0, 1.2)
    with obj("bookcase-plants"):
        px, yb = G.shelf_plant   # a small trailing plant on a shelf
        pot(px - 2, yb - 4, px + 2, yb, "TERRA_1")
        for i in range(2):
            vine(px - 1 + i * 2, yb, 7 + i * 3, rng, sw=swv(i + 1))
        # plants spilling off the top: a pothos and a fern, vines trailing down the front
        (tx0, ty0), (tx1, _) = pj(BX0, BH, 0.6), pj(BX1, BH, 0.6)
        for k, (cx, w) in enumerate(((tx0 + 9, 6), (tx1 - 10, 7))):
            pot(cx - 4, ty0 - 7, cx + 4, ty0 - 1, "TERRA_1" if k == 0 else "SLATE_0")
            bush(cx, ty0 - 10, w, 4, rng, n=30)
            for i in range(5 if k == 0 else 4):
                vine(int(cx) - 5 + i * 3, int(ty0) - 2, rng.randint(14, 34), rng, drift=0.1 * (i - 2), sw=swv(k + i))
        for i in range(4):   # one long strand that reaches past the top shelves
            vine(int(tx0) + 18 + i * 4, int(ty0) - 1, rng.randint(10, 22), rng, sw=swv(i))
    with obj("ladder"):
        # rolling library ladder hooked on the rail, leaning out to the floor
        for X in (-12.15, -11.25):
            t, b = pj(X, BH - 0.85, 1.25), pj(X, 0, 3.2)
            L(t[0], t[1], b[0], b[1], "OAK_1")
            L(t[0] + 1, t[1], b[0] + 1, b[1], "OAK_0")
            R(b[0] - 1, b[1] - 1, b[0] + 2, b[1] + 1, "INK")   # wheel
            P(b[0], b[1] - 1, "SLATE_1")
            P(t[0], t[1] - 1, "GOLD")                          # hook on the rail
        for k in range(1, 11):
            u = k / 11
            Y = (BH - 0.85) * (1 - u)
            zz = 1.25 + (3.2 - 1.25) * u
            a_, b_ = pj(-12.15, Y, zz), pj(-11.25, Y, zz)
            L(a_[0] + 1, a_[1], b_[0], b_[1], "OAK_2" if k % 2 else "OAK_1")
        shadow_ell(*pj(-11.7, 0, 3.2), 9, 2, k=1.0)
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
        with channel("globe"):
            tint(gx, gy, 28, 24, "violet", (1.0, 0.8, 1.2)[af("globe")])
    # headboard (against the back wall corner), platform bed along the left wall
    X0, X1, z0, z1 = -WX, -14.0, 0.2, 7.0
    with obj("bed-rug"):
        bed_rug(-WX + 0.15, -11.9, 0.25, 8.6)
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
        box3d(-14.0, -12.95, 0, 2.0, 0.05, 1.4, "OAK_1", side="OAK_0", top="OAK_2")
        a, b = pj(-13.9, 1.4, 1.41), pj(-13.05, 1.4, 1.41)
        L(a[0], a[1], b[0], b[1], "OAK_DK")
        P((a[0] + b[0]) / 2, a[1] + 2, "GOLD")
        shadow_fp(-14.0, -12.95, 0.05, 1.4)
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
        jx, jy = pj(-13.25, 2.0, 0.6)
        BOX(jx - 2, jy - 6, jx + 2, jy, "SLATE_1", hi="SLATE_2")
        R(jx - 2, jy - 7, jx + 2, jy - 7, "OAK_2")
        for dx, dy, c in ((-1, -2, "GOLD"), (0, -4, "PLUM_3"), (1, -1, "SUN"), (0, -2, "CREAM")):
            P(jx + dx, jy + dy, c)


def bed_rug(X0, X1, z0, z1):
    """Big rug under the whole bed: plum field, cream border, a terra diamond row."""
    q = [pj(X0, 0, z0), pj(X1, 0, z0), pj(X1, 0, z1), pj(X0, 0, z1)]
    POLY(q, "PLUM_1", "INK")
    m = 0.35
    q2 = [pj(X0 + m, 0, z0 + m), pj(X1 - m, 0, z0 + m), pj(X1 - m, 0, z1 - m), pj(X0 + m, 0, z1 - m)]
    PL(q2 + [q2[0]], "CREAM")
    m = 0.6
    q3 = [pj(X0 + m, 0, z0 + m), pj(X1 - m, 0, z0 + m), pj(X1 - m, 0, z1 - m), pj(X0 + m, 0, z1 - m)]
    PL(q3 + [q3[0]], "PLUM_2")
    Xc = X1 - 1.0
    for k in range(6):
        z = z0 + 1.0 + k * (z1 - z0 - 2.0) / 5
        c = pj(Xc, 0, z)
        ss = sc(z) * 0.18
        POLY([(c[0], c[1] - ss), (c[0] + ss * 1.6, c[1]), (c[0], c[1] + ss), (c[0] - ss * 1.6, c[1])], "TERRA_1")
    # fringe on the room edge
    for k in range(14):
        z = z0 + (z1 - z0) * (k + 0.5) / 14
        a = pj(X1, 0, z)
        P(a[0] + 1, a[1], "CREAM")


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
            big_leaf(px - 1, py + dy, a + 0.07 * swv(i), 9, 4, "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0", "LEAF_0", hi="LEAF_3")
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
        with channel("crt"):
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
        with channel("crt"):
            tint((ax + bx) / 2, (ay + dy) / 2 + 6, 18, 18, "red", (0.7, 0.55, 0.85)[af("crt")])
    # chess: a big 8x8 board on its own stand, pieces mid-game, a stool beside it
    TX, TZ = 8.7, 3.4
    with obj("chess-table"):
        cx_, ty = pj(TX, 2.6, TZ)
        _, fy = pj(TX, 0, TZ)
        # pedestal stand: turned post, wide foot
        R(cx_ - 2, ty + 6, cx_ + 2, fy - 4, "INK")
        R(cx_ - 1, ty + 6, cx_ + 1, fy - 4, "OAK_1")
        P(cx_ - 1, ty + 12, "OAK_2")
        R(cx_ - 3, ty + 14, cx_ + 3, ty + 16, "OAK_0")
        POLY([(cx_ - 11, fy), (cx_ - 5, fy - 4), (cx_ + 5, fy - 4), (cx_ + 11, fy)], "OAK_0", "INK")
        L(cx_ - 6, fy - 3, cx_ + 6, fy - 3, "OAK_1")
        # board: slightly tilted toward the room so all 64 squares read
        bw, bd = 34, 15
        x0b, y0b = cx_ - bw // 2, ty - bd + 4
        POLY([(x0b - 3, y0b + bd + 2), (x0b + bw + 3, y0b + bd + 2), (x0b + bw + 1, y0b - 2), (x0b - 1, y0b - 2)], "OAK_DK", "INK")
        R(x0b - 3, y0b + bd + 3, x0b + bw + 3, y0b + bd + 5, "OAK_0")       # board edge (front face)
        L(x0b - 3, y0b + bd + 5, x0b + bw + 3, y0b + bd + 5, "INK")
        for j in range(8):          # rows from the back (narrower) to the front
            ya = y0b + int(j * bd / 8)
            yb = y0b + int((j + 1) * bd / 8) - 1
            inset = (7 - j) * 0.25
            for i in range(8):
                xa = int(round(x0b + inset + i * (bw - 2 * inset) / 8))
                xb = int(round(x0b + inset + (i + 1) * (bw - 2 * inset) / 8)) - 1
                R(xa, ya, xb, max(ya, yb), "CREAM" if (i + j) % 2 == 0 else "OAK_1")

        def sq(i, j):
            inset = (7 - j) * 0.25
            xa = x0b + inset + (i + 0.5) * (bw - 2 * inset) / 8
            ya = y0b + (j + 0.75) * bd / 8
            return int(round(xa)), int(round(ya))
        # pieces: (file, rank-from-back, colour, kind) 0 pawn, 1 rook, 2 knight, 3 bishop, 4 queen, 5 king
        pcs = [(0, 0, "INK", 1), (4, 0, "INK", 5), (5, 0, "INK", 1), (2, 1, "INK", 3), (0, 1, "INK", 0), (1, 1, "INK", 0),
               (5, 1, "INK", 0), (6, 1, "INK", 0), (7, 2, "INK", 0), (3, 2, "INK", 0), (5, 2, "INK", 2), (4, 3, "INK", 0),
               (3, 4, "CREAM", 0), (4, 4, "CREAM", 4), (2, 5, "CREAM", 2), (0, 6, "CREAM", 0), (1, 6, "CREAM", 0),
               (5, 6, "CREAM", 0), (6, 6, "CREAM", 0), (7, 6, "CREAM", 0), (2, 6, "CREAM", 3), (0, 7, "CREAM", 1),
               (4, 7, "CREAM", 5), (7, 7, "CREAM", 1)]
        for fi, rk, col, kind in sorted(pcs, key=lambda p: p[1]):
            x, y = sq(fi, rk)
            dark = col == "INK"
            body = "BROWN_1" if dark else "CREAM"
            hi = "SLATE_0" if dark else "SUN"
            h = (3, 4, 5, 5, 6, 7)[kind]
            R(x - 1, y - 1, x + 1, y, "INK")                 # base
            P(x, y - 1, body)
            R(x, y - h, x, y - 2, body)
            P(x - 1, y - 2, "INK" if not dark else body)
            if kind == 0:
                P(x, y - h, hi)
            elif kind == 1:   # rook: notched top
                P(x - 1, y - h, body); P(x + 1, y - h, body)
            elif kind == 2:   # knight: head to one side
                P(x + (1 if dark else -1), y - h + 1, body); P(x, y - h, hi)
            elif kind == 3:
                P(x, y - h, hi); P(x, y - h - 1, "INK" if not dark else hi)
            elif kind == 4:
                P(x - 1, y - h, body); P(x + 1, y - h, body); P(x, y - h - 1, "GOLD")
            else:
                P(x, y - h - 1, "GOLD"); P(x - 1, y - h, "GOLD"); P(x + 1, y - h, "GOLD")
        if stg("library.chess") == 2:   # chess clock on the board's edge
            R(x0b + bw + 4, y0b + bd - 2, x0b + bw + 10, y0b + bd + 2, "INK")
            P(x0b + bw + 5, y0b + bd - 1, "CREAM")
            P(x0b + bw + 9, y0b + bd - 1, "CREAM")
            P(x0b + bw + 7, y0b + bd - 3, "CRT_1")
        shadow_ell(cx_, fy, 14, 3)
    with obj("chess-stool"):
        x, yf = pj(TX + 2.3, 0, TZ + 0.6)
        _, ys = pj(TX + 2.3, 1.6, TZ + 0.6)
        ELL(x - 7, ys - 3, x + 7, ys + 2, "OAK_1", "INK")
        L(x - 5, ys - 2, x + 5, ys - 2, "OAK_2")
        for dx in (-5, -1, 3, 6):
            L(x + dx * 0.9, ys + 2, x + dx * 1.2, yf, "OAK_0" if dx < 3 else "OAK_DK")
        L(x - 5, (ys + yf) // 2 + 2, x + 6, (ys + yf) // 2 + 2, "OAK_DK")
        shadow_ell(x, yf, 8, 2, k=1.0)
    # meditation: small rug, cushion and candle in front of the window, facing the sunset
    MX, MZ = 3.9, 4.4
    with obj("med-rug"):
        rx, ry = pj(MX, 0, MZ)
        s_ = sc(MZ)
        ELL(rx - 1.9 * s_, ry - 0.40 * s_, rx + 1.9 * s_, ry + 0.40 * s_, "PLUM_1", "INK")
        ELL(rx - 1.5 * s_, ry - 0.29 * s_, rx + 1.5 * s_, ry + 0.29 * s_, "PLUM_2")
        ELL(rx - 1.0 * s_, ry - 0.18 * s_, rx + 1.0 * s_, ry + 0.18 * s_, "PLUM_1")
        for k in range(-3, 4):
            P(rx + k * 0.5 * s_, ry + 0.40 * s_ + 1, "CREAM")
    with obj("med-cushion"):
        rx, ry = pj(MX, 0, MZ - 0.15)
        ELL(rx - 10, ry - 6, rx + 10, ry + 2, "TERRA_1", "INK")
        ELL(rx - 8, ry - 6, rx + 8, ry - 2, "TERRA_2")
        L(rx - 5, ry - 5, rx + 5, ry - 5, "RIM")
        P(rx, ry - 4, "TERRA_0")
        shadow_ell(rx, ry + 1, 11, 3, k=1.0)
    with obj("med-candle"):
        cx_, cy_ = pj(MX + 1.7, 0, MZ - 0.6)
        if stg("bed.cushion") > 0:   # s0: the cushion alone
            BOX(cx_ - 2, cy_ - 7, cx_ + 1, cy_, "CREAM", hi="CREAM", sh="AMBER")
            R(cx_ - 3, cy_ - 1, cx_ + 2, cy_, "GOLD_DK")
            with channel("candle"):
                fl = af("candle")
                P(cx_, cy_ - 8, "SUN!")
                P(cx_ - (fl == 1), cy_ - 9, "GLOW!")
                if fl != 2:
                    P(cx_, cy_ - 10, "ORANGE!")
                light(cx_, cy_ - 8, 18, 14, (0.55, 0.45, 0.65)[fl])


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
    """Dropshipping desk on the right wall (business only): whiteboard, two green-code monitors, mesh chair."""
    rng = random.Random(81)
    with obj("whiteboard"):  # Dropshipping: a good-sized board on the side wall
        wall_frame("R", 0.3, 5.4, 5.0, 8.9, "SLATE_1", "CREAM", m=0.12)
        pts = [pj(WX - 0.04, 5.6 + 0.42 * k + 0.3 * (k % 2), 0.8 + 0.75 * k) for k in range(6)]
        PL(pts, "SLATE_0")                                   # rising sales line
        PL([pj(WX - 0.04, 5.5, 0.7), pj(WX - 0.04, 8.4, 0.7)], "INK")
        PL([pj(WX - 0.04, 5.5, 0.7), pj(WX - 0.04, 5.5, 4.9)], "INK")
        for k in range(3):                                   # product columns
            a_, b_ = pj(WX - 0.04, 8.3 - k * 0.35, 3.0), pj(WX - 0.04, 8.3 - k * 0.35, 4.6)
            L(a_[0], a_[1], b_[0], b_[1], ("CRT_0", "SLATE_0", "LEAF_2")[k])
        st_ = ((3.4, 7.7, "GOLD"), (4.1, 7.5, "PLUM_3"), (3.7, 6.7, "LEAF_3"), (4.4, 6.4, "GOLD"),
               (2.7, 7.9, "SLATE_2"), (3.1, 6.2, "PLUM_3"))
        for z, Y, c in st_[:(1, 4, 6)[stg("computer.board")]]:
            quad(wallq("R", z, z + 0.4, Y - 0.45, Y, 0.05), c)
        P(*pj(WX - 0.05, 8.75, 0.5), "CRT_1")
    with obj("pc-shelf"):  # shelf of shipping boxes and a label roll
        q = wallq("R", 1.0, 4.4, 9.4, 9.6, 0.0)
        quad([q[0], q[1], pj(WX - 0.8, 9.6, 4.4), pj(WX - 0.8, 9.6, 1.0)], "OAK_2", "INK")
        quad([pj(WX - 0.8, 9.6, 1.0), pj(WX - 0.8, 9.6, 4.4), pj(WX - 0.8, 9.4, 4.4), pj(WX - 0.8, 9.4, 1.0)], "OAK_1", "INK")
        for z, w, h in ((1.5, 0.9, 0.9), (2.5, 0.8, 0.6), (3.5, 0.7, 0.75)):
            box3d(WX - 0.75, WX - 0.1, 9.6, 9.6 + h, z - w / 2, z + w / 2, "AMBER", side="OAK_2", top="OAK_2")
            a_ = pj(WX - 0.75, 9.6 + h * 0.6, z)
            P(a_[0], a_[1], "CREAM")
    CX0, CX1, cz0, cz1 = 14.7, WX, 0.4, 5.0
    with obj("pc-desk"):  # a solid walnut desk with a drawer column
        box3d(CX0, CX1, 2.3, 2.6, cz0, cz1, "OAK_1", side="OAK_0", top="OAK_2")
        box3d(CX0 + 0.2, CX1, 0, 2.3, cz1 - 1.5, cz1 - 0.1, "OAK_0", side="OAK_DK", top="OAK_1")
        for Y in (0.75, 1.5):
            a_, b_ = pj(CX0 + 0.2, Y, cz1 - 1.45), pj(CX0 + 0.2, Y, cz1 - 0.15)
            L(a_[0], a_[1], b_[0], b_[1], "INK")
            m_ = pj(CX0 + 0.2, Y + 0.35, cz1 - 0.8)
            P(m_[0], m_[1], "GOLD")
        a_, b_ = pj(CX0 + 0.15, 2.3, cz0 + 0.2), pj(CX0 + 0.15, 0, cz0 + 0.2)
        L(a_[0], a_[1], b_[0], b_[1], "INK")
        L(a_[0] + 1, a_[1], b_[0] + 1, b_[1], "OAK_0")
        shadow_fp(CX0, CX1, cz0, cz1, k=1.0)
    with obj("pc-tower"):
        f = box3d(16.3, 17.3, 0, 1.7, 0.6, 1.7, "INK", side="BROWN_1", top="SLATE_0")
        (ax, ay), (bx, by), _, _ = f["front"]
        P(ax + 2, ay + 3, "LEAF_3!")   # status LED
        shadow_fp(16.3, 17.3, 0.6, 1.7, k=1.0)
    with obj("monitors"):  # AI Building: two monitors side by side, hacker-green text scrolling on both
        with channel("terminal"):
            for k, (za, zb) in enumerate(((0.7, 2.6), (2.75, 4.65))):
                Xa = 16.4
                q = [pj(Xa, 5.0, za), pj(Xa, 5.0, zb), pj(Xa, 3.2, zb), pj(Xa, 3.2, za)]
                POLY(q, "INK", "INK")
                qi = [pj(Xa - 0.05, 4.85, za + 0.12), pj(Xa - 0.05, 4.85, zb - 0.12), pj(Xa - 0.05, 3.35, zb - 0.12), pj(Xa - 0.05, 3.35, za + 0.12)]
                POLY(qi, "LEAF_0!")
                x0 = min(p[0] for p in qi) + 1
                x1 = max(p[0] for p in qi) - 1
                y0 = min(p[1] for p in qi) + 2
                y1 = max(p[1] for p in qi) - 2
                sc_ = af("terminal") + k * 2
                for j, yy in enumerate(range(int(y0), int(y1), 2)):
                    j2 = j + sc_
                    ln = (j2 * 5) % 7 + 2
                    c = "LEAF_3!" if j2 % 3 else "ENERGY!" if k == 0 else "LEAF_2!"
                    L(x0 + (j2 % 2), yy, min(x1, x0 + ln), yy, c)
                st = pj(Xa, 3.2, (za + zb) / 2)
                L(st[0], st[1], st[0], st[1] + 3, "INK")
                R(st[0] - 3, st[1] + 3, st[0] + 2, st[1] + 4, "INK")
                if k == 0:
                    G.focus_at = pj(Xa, 5.05, za + 0.1)
            mx, my = pj(16.3, 4.1, 2.7)
            light(mx, my, 30, 30, 0.7)
            tint(pj(WX, 4.5, 2.7)[0] - 4, my - 6, 28, 34, "green", (1.0, 0.85, 1.15, 0.95)[af("terminal") % 4])
        kx, ky = pj(15.6, 2.6, 2.6)
        R(kx - 7, ky - 1, kx + 2, ky, "SLATE_0")   # keyboard
        L(kx - 7, ky - 1, kx + 2, ky - 1, "SLATE_1")
        R(kx + 4, ky - 1, kx + 6, ky, "INK")       # mouse
    with obj("focus-note"):   # weekly focus sticky note on the bezel
        n = G.focus_at
        R(n[0] - 1, n[1] - 1, n[0] + 3, n[1] + 2, "GOLD")
        L(n[0], n[1], n[0] + 2, n[1], "OAK_DK")
    with obj("headphones"):   # label printer with a strip of labels
        hx, hy = pj(16.0, 2.6, 4.5)
        BOX(hx - 4, hy - 4, hx + 3, hy, "CREAM", hi="CREAM", sh="SLATE_2")
        R(hx - 3, hy - 3, hx + 2, hy - 3, "INK")
        L(hx + 3, hy - 2, hx + 6, hy + 1, "CREAM")
    with obj("pc-chair"):  # black ergonomic mesh chair (seen from the room, back toward the camera side)
        X, z = 14.0, 3.0
        x, yf = pj(X, 0, z)
        seat = pj(X, 1.75, z)
        L(x, seat[1], x, yf - 4, "SLATE_0")
        L(x + 1, seat[1], x + 1, yf - 4, "INK")
        for dx in (-9, -4, 0, 5, 9):
            L(x, yf - 4, x + dx, yf - (1 if abs(dx) < 6 else 0), "INK")
            P(x + dx, yf, "SLATE_0")
        R(x - 9, seat[1] - 3, x + 8, seat[1], "INK")
        L(x - 9, seat[1] - 3, x + 8, seat[1] - 3, "SLATE_0")
        back_t = pj(X + 0.6, 4.6, z)[1]
        POLY([(x + 2, back_t), (x + 9, back_t + 1), (x + 10, seat[1] - 6), (x + 7, seat[1] - 3), (x + 2, seat[1] - 4)], "INK", "INK")
        for yy in range(int(back_t) + 2, int(seat[1]) - 5, 2):   # mesh weave
            L(x + 3, yy, x + 8, yy, "BROWN_1")
        R(x + 4, back_t - 3, x + 8, back_t, "INK")                   # headrest
        L(x - 7, seat[1] - 6, x + 2, seat[1] - 6, "INK")              # armrest
        L(x - 6, seat[1] - 6, x - 6, seat[1] - 3, "SLATE_0")
        shadow_ell(x, yf, 12, 3, k=1.0)
    with obj("money-tree"):
        x, y = pj(13.7, 0, 6.2)
        pot(x - 5, y - 8, x + 5, y, "SLATE_1")
        for k in range(14):
            yy = y - 9 - k
            L(x - 1 + (k // 2) % 2, yy, x + (k // 2) % 2, yy, "OAK_1" if k % 2 else "OAK_0")
        lv = ((-4, -21), (5, -21), (0, -30), (-7, -26), (7, -26), (-10, -32), (9, -33))
        for i, (dx, dy) in enumerate(lv[:(2, 3, 5, 7)[grow("computer.money")]]):
            dx += swv(i) if abs(dx) > 6 else 0
            ELL(x + dx - 4, y + dy - 3, x + dx + 4, y + dy + 3, "LEAF_2", "INK")
            P(x + dx, y + dy - 1, "LEAF_3")
        if grow("computer.money") == 3:
            circ(x + 2, y - 36, 1, "GOLD")
        shadow_ell(x, y, 7, 2)
    with obj("ship-boxes"):   # stacked shipping boxes by the desk
        box3d(16.2, WX, 0, 1.3, 5.3, 6.6, "AMBER", side="OAK_2", top="OAK_2")
        box3d(16.6, WX, 1.3, 2.2, 5.5, 6.4, "OAK_2", side="OAK_1", top="AMBER")
        a_ = pj(16.2, 0.9, 5.95)
        R(a_[0] - 1, a_[1] - 1, a_[0] + 1, a_[1], "CREAM")
        shadow_fp(16.2, WX, 5.3, 6.6, k=1.0)


# ---------------------------------------------------------------- zone 7: gym (right wall front)
def gym():
    # art pass 5: the gym moved ~10 ft toward the front of the right wall (only a hint shows in the main view)
    with wallside(0.72), zshift(3.6):
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


def light_field():
    """The smooth light field (window wash + lamps + contact shadows - corner falloff), used only to pick each
    object's one flat ramp level; the visible gradients come from the RGB overlay."""
    base, src, lv = tod_setup()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    f = np.full((H, W), base, np.float32)
    lamp_k = {"golden": 1.0, "dawn": 0.6, "midday": 0.35, "night": 1.35}[TOD]
    for cx, cy, rx, ry, a in src:
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        f += a * np.clip(1 - dd, 0, 1) ** 1.1
    for cx, cy, rx, ry, a in G.lights:
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        f += 0.6 * a * lamp_k * np.clip(1 - dd, 0, 1) ** 0.9
    return f, lv


LVL_FORCE = {"bookcase": 1, "ladder": 2, "ceiling": 2}


def apply_lighting():
    """Flat ramp level per object (median of the light field over its pixels, clamped to 1..3); the room shell
    stays at the albedo level, one step darker under contact shadows. No rings: every gradient is the overlay."""
    f, lv = light_field()
    lvl = np.full((H, W), 2, np.int8)
    oid = G.oid
    ids = np.unique(oid)
    for o in ids:
        if o < 10:
            continue
        m = oid == o
        v = float(np.median(f[m]))
        lvl[m] = LVL_FORCE.get(G.names.get(o), int(np.clip(round(v - 0.35), 1, 3)))
    shell = oid < 10
    sh = np.clip(np.round(G.shadow), -2, 0).astype(np.int8)
    lvl[shell] = 2 + sh[shell]
    lvl = np.clip(lvl, 0, 4)
    G.level = lvl
    out = G.img.copy()
    ne = ~G.emit
    for k in range(5):
        if lv[k] is None:
            continue
        m = ne & (lvl == k)
        out[m] = lv[k][G.img[m]]
    G.img = out


# ---------------------------------------------------------------- smooth light overlay (shared with the engine)
# Falloff of every light: (1 - d^2)^2 sampled at these stops (the engine builds canvas gradients from the same
# stops), d = elliptical distance / radius. Lights are drawn with "screen"; the vignette with "multiply".
STOPS = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]
FALL = [(1 - d * d) ** 2 for d in STOPS]


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def light_spec():
    """The view's light overlay in master px: ambient wash, window/sun lights, lamp and tint glows, vignette."""
    win = G.win
    gl = []
    if win is not None and VIEW == "main":
        wx, wy = (win[0] + win[2]) / 2, (win[1] + win[3]) / 2
        ww = win[2] - win[0]
        if TOD == "golden":
            gl += [dict(x=wx, y=wy + 40, rx=ww * 2.5, ry=ww * 1.6, c="sun", a=0.20),
                   dict(x=wx, y=wy + 10, rx=ww * 0.95, ry=ww * 0.75, c="sun", a=0.18),
                   dict(x=wx + G.sunfloor[0], y=G.sunfloor[1], rx=ww * 0.8, ry=ww * 0.28, c="sun", a=0.18)]
        elif TOD == "night":
            gl += [dict(x=wx, y=wy, rx=ww * 1.2, ry=ww * 0.8, c=(70, 96, 200), a=0.14)]
        elif TOD == "dawn":
            gl += [dict(x=wx, y=wy + 20, rx=ww * 2.2, ry=ww * 1.5, c=(236, 140, 170), a=0.26)]
        else:
            gl += [dict(x=wx, y=wy + 20, rx=ww * 2.4, ry=ww * 1.6, c=(255, 236, 200), a=0.24)]
    if VIEW != "main" and TOD != "night":
        c = {"golden": "sun", "dawn": (236, 140, 170), "midday": (255, 236, 200)}[TOD]
        sx = 820 if VIEW == "left" else -20
        gl += [dict(x=sx, y=250, rx=640, ry=380, c=c, a=0.36), dict(x=sx, y=330, rx=340, ry=130, c=c, a=0.24)]
    elif VIEW != "main":
        gl += [dict(x=820 if VIEW == "left" else -20, y=200, rx=420, ry=300, c=(70, 96, 200), a=0.12)]
    lamp = {"golden": 1.0, "dawn": 0.7, "midday": 0.45, "night": 1.45}[TOD]
    for g in G.glows:
        g2 = dict(g)
        g2["a"] = g["a"] * lamp
        gl.append(g2)
    amb = {"golden": ((255, 120, 50), 0.06), "dawn": ((214, 126, 160), 0.10), "midday": ((255, 226, 190), 0.12),
           "night": ((40, 48, 110), 0.10)}[TOD]
    vig = dict(VIGNETTE[VIEW])
    vig["c"] = {"golden": (0.30, 0.17, 0.20), "dawn": (0.30, 0.22, 0.30), "midday": (0.42, 0.34, 0.34),
                "night": (0.20, 0.17, 0.30)}[TOD]
    out = []
    for g in gl:
        c = g["c"]
        out.append(dict(x=round(float(g["x"]), 1), y=round(float(g["y"]), 1), rx=round(float(g["rx"]), 1),
                        ry=round(float(g["ry"]), 1), rgb=list(GLOW_RGB[c] if isinstance(c, str) else c),
                        a=round(float(min(0.95, g["a"])), 3), ch=g.get("ch")))
    return {"ambient": {"rgb": list(amb[0]), "a": amb[1]}, "glows": out, "vignette": vig}


# soft oval vignette per view (master px): multiply by a colour that eases from white (d <= inner) to c (d >= 1)
VIGNETTE = {"main": dict(x=400, y=236, rx=420, ry=250, inner=0.42),
            "left": dict(x=400, y=236, rx=430, ry=260, inner=0.40),
            "right": dict(x=400, y=236, rx=430, ry=260, inner=0.40)}


VSTOPS = [i / 8 for i in range(9)]


def interp_stops(d, vals):
    return np.interp(d, STOPS, vals)


def overlay_rgb(img, spec, mults=None):
    """Apply a light spec to an indexed image -> RGB uint8 (exactly what the engine's canvas overlay draws)."""
    out = RGB[img].astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]].astype(np.float32)
    a = spec["ambient"]
    c = np.array(a["rgb"], np.float32) / 255.0 * a["a"]
    out = out + c * (1 - out)
    for i, g in enumerate(spec["glows"]):
        k = (mults or {}).get(i, 1.0)
        d = np.sqrt(((xx - g["x"]) / g["rx"]) ** 2 + ((yy - g["y"]) / g["ry"]) ** 2)
        x0, x1 = int(max(0, g["x"] - g["rx"])), int(min(img.shape[1], g["x"] + g["rx"] + 1))
        y0, y1 = int(max(0, g["y"] - g["ry"])), int(min(img.shape[0], g["y"] + g["ry"] + 1))
        if x1 <= x0 or y1 <= y0:
            continue
        dd = d[y0:y1, x0:x1]
        f = np.where(dd < 1, interp_stops(np.minimum(dd, 1), FALL), 0) * g["a"] * k
        c = np.array(g["rgb"], np.float32) / 255.0
        sub = out[y0:y1, x0:x1]
        out[y0:y1, x0:x1] = sub + (f[..., None] * c) * (1 - sub)
    v = spec["vignette"]
    d = np.sqrt(((xx - v["x"]) / v["rx"]) ** 2 + ((yy - v["y"]) / v["ry"]) ** 2)
    t = np.clip((d - v["inner"]) / (1 - v["inner"]), 0, 1)
    t = np.interp(t, VSTOPS, [x * x * (3 - 2 * x) for x in VSTOPS])   # smoothstep at the engine's stops
    vc = np.array(v["c"], np.float32)
    out = out * (1 - t[..., None] * (1 - vc))
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


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
def build(tod="golden", tier=3, beam=False, ghost=False, view="main"):
    global TOD, TIER
    TOD, TIER = tod, tier
    set_view(view)
    FLAGS["beam"] = beam
    new_scene()
    G.ghost = ghost
    G.cones = []
    G.beam = False
    if view == "main":
        scene_main()
    elif view == "left":
        scene_left()
    else:
        scene_right()
    mx = max(G.names) + 1
    G.names_arr = np.zeros(mx, np.int32)
    apply_lighting()
    skip = {"knight", "window-view", "window-sky", "rug", "ceiling", "bookcase", "string-1", "string-3", "string-x", "forge-sign",
            "window-side", "string-side-4", "string-side-5"}
    for k, v in G.names.items():
        if v in skip or k < 10:
            G.names_arr[k] = 1
    if G.win is not None:
        rim_pass()
    for nm in ("gut-plant", "plant-entry", "plant-study", "gym-plant", "floor-plant-window"):
        if nm in G.names.values():
            decheck(nm)
    if view == "main":
        edge_light_knight()
        floor_reflection()
    elif G.win is not None:
        side_floor_light()
    dust_cones()
    beam_pass()
    G.spec = light_spec()
    set_view("main")
    return G.img.copy()


def scene_main():
    shell()
    window()
    with obj("plant-study"):
        floor_plant(10.1, 2.4, "snake", 1)
    library()
    rug()
    G.rug_id = [k for k, v in G.names.items() if v == "rug"][0]
    knight_zone()
    study()
    computer()
    bed_zone()
    kitchen()
    window_zone()
    gym()
    ceiling_life()


def lit(img=None):
    """Indexed render -> RGB with the smooth light overlay of the last build."""
    return overlay_rgb(G.img if img is None else img, G.spec)


# ================================================================ side views
# Local frame of a side view: X lateral along its back wall (-11..11), z distance from that wall, Y up.
# Left view: back wall = the room's left wall; its right side wall = the room's back wall (window side).
# Right view: back wall = the room's right wall; its left side wall = the room's back wall.
SIDE_ZF = 21.0   # draw walls and floor up to this depth (the camera stands at D0 = 24)


def side_shell(rng_seed=0):
    bw = (pji(-WX, CEIL, 0), pji(WX, 0, 0))
    (bx0, by0), (bx1, by1) = bw
    zf = SIDE_ZF
    with obj("ceiling", 5):
        POLY([(-50, -50), (W + 50, -50), pj(WX, CEIL, zf), (bx1, by0), (bx0, by0), pj(-WX, CEIL, zf)], "INK")
        # beams along the view (the room's cross beams) and across it (the room's long beams)
        for X in (-6.0, 0.0, 6.0) if VIEW == "left" else (-8.5, -4.0, 2.0):
            a0, a1 = pj(X - 0.35, CEIL - 0.55, 0), pj(X - 0.35, CEIL - 0.55, zf)
            b0, b1 = pj(X + 0.35, CEIL - 0.55, 0), pj(X + 0.35, CEIL - 0.55, zf)
            c0, c1 = pj(X - 0.35, CEIL, 0), pj(X - 0.35, CEIL, zf)
            POLY([a0, a1, b1, b0], "OAK_DK")
            POLY([c0, c1, a1, a0], "VOID")
            L(*a0, *a1, "OAK_0")
        for z in (4.7, 11.2):
            a, b = pj(-WX, CEIL - 0.55, z), pj(WX, CEIL - 0.55, z)
            c, d = pj(-WX, CEIL, z), pj(WX, CEIL, z)
            POLY([c, d, b, a], "INK")
            e, f = pj(-WX, CEIL - 0.55, z + 0.7), pj(WX, CEIL - 0.55, z + 0.7)
            POLY([a, b, f, e], "OAK_DK")
            L(*a, *b, "OAK_0")
    with obj("wall-L", 2):
        POLY([pj(-WX, CEIL, zf), (bx0, by0), (bx0, by1), pj(-WX, 0, zf)], "PLASTER")
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
        R(bx0, by0, bx1, by0 + 4, "PLASTER_0")
        R(bx0, by1 - 7, bx1, by1, "OAK_DK")
        L(bx0, by1 - 7, bx1, by1 - 7, "OAK_0")
        rng = random.Random(17 + rng_seed)
        for _ in range(30):
            x = rng.randint(bx0 + 4, bx1 - 30)
            y = rng.randint(by0 + 8, by1 - 24)
            L(x, y, x + rng.randint(4, 14), y, "PLASTER_0")
        L(bx0, by0, bx0, by1, "PLASTER_0")
        L(bx1, by0, bx1, by1, "PLASTER_0")
    with obj("floor", 4):
        POLY([(bx0, by1), (bx1, by1), pj(WX, 0, zf), (W + 50, H + 50), (-50, H + 50), pj(-WX, 0, zf)], "OAK_0")
        rng = random.Random(11 + rng_seed)
        pw = 0.72
        z = 0.0
        while z < zf:
            zn = z + pw
            col = rng.choice(["OAK_0", "OAK_0", "OAK_1", "OAK_0", "OAK_DK"])
            if col != "OAK_0":
                POLY([pj(-WX, 0, z), pj(WX, 0, z), pj(WX, 0, zn), pj(-WX, 0, zn)], col)
            a_, b_ = pj(-WX - 4, 0, z), pj(WX + 4, 0, z)
            L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
            xj = -WX + rng.uniform(0.5, 4.0)
            while xj < WX:
                a_, b_ = pj(xj, 0, z), pj(xj, 0, zn)
                L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
                xj += rng.uniform(5.0, 9.0)
            z = zn
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon([(int(x), int(y)) for x, y in [(bx0, by1), (bx1, by1), pj(WX, 0, zf), (W + 50, H + 50), (-50, H + 50), pj(-WX, 0, zf)]], fill=1)
        a = np.array(S.im)
        a[np.array(m) == 0] = T
        S.im = Image.fromarray(a, "P")
        S.im.putpalette(FLAT)
        S.d = ImageDraw.Draw(S.im)


def lbox(X0, X1, Y0, Y1, z0, z1, front, side=None, top=None, ol="INK"):
    return box3d(X0, X1, Y0, Y1, z0, z1, front, side, top, ol)


def wall_string_lights(X0, X1, Y, z=0.05, seed=0):
    a, b = pj(X0, Y, z), pj(X1, Y, z)
    with obj("string-side-%d" % seed):
        pts = []
        n = int(abs(b[0] - a[0]))
        for i in range(n + 1):
            t = i / max(1, n)
            x = a[0] + (b[0] - a[0]) * t
            y = a[1] + (b[1] - a[1]) * t + 7 * abs(math.sin(t * math.pi * 3))
            pts.append((x, y))
        string_lights(pts, step=8, seed=seed)


# ---------------------------------------------------------------- left view: bed + kitchen + entry
def scene_left():
    G.win = (840, 170, 960, 300)      # the window is off to the right (behind the room's back wall)
    G.sunfloor = (-120, 330)
    rng = random.Random(141)
    side_shell(1)
    # --- right side wall (the room's back wall): potion shelf and the bookcase seen edge-on
    with obj("potions"):
        for k, Yb in enumerate((8.6, 7.1)):
            q = wallq("R", 2.1, 4.5, Yb - 0.15, Yb, 0.0)
            quad([q[0], q[1], pj(WX - 0.6, Yb, 4.5), pj(WX - 0.6, Yb, 2.1)], "OAK_2", "INK")
            cols = [("PLUM_2", "PLUM_3"), ("LEAF_2", "LEAF_3"), ("SLATE_1", "ENERGY"), ("CRT_0", "CRT_1"), ("GOLD", "SUN")]
            for i, z in enumerate((2.4, 2.9, 3.4, 3.9, 4.3)):
                a_, b_ = cols[(i + k * 2) % 5]
                x, y = pj(WX - 0.3, Yb, z)
                h = int(6 + (i % 3) + z * 0.4)
                R(x - 1, y - h, x + 2, y - 1, "INK")
                R(x, y - h + 2, x + 1, y - 1, a_ + "!")
                P(x, y - h + 3, b_ + "!")
                R(x, y - h - 1, x + 1, y - h, "OAK_2")
                with channel("potions"):
                    if (i + af("potions")) % 2 == 0:
                        P(x + 1 - (i + af("potions")) % 2, y - h - 2 - ((i + af("potions")) % 3), b_ + "!")
        x, y = pj(WX - 0.3, 7.8, 3.3)
        light(x, y, 26, 30, 0.5)
        tint(x, y, 22, 26, "potion", 0.8)
    with obj("bookcase"):
        f = lbox(9.8, WX, 0, 10.4, 4.9, 9.1, "OAK_DK", side="OAK_DK", top="OAK_0")
        if "side" in f:
            q = f["side"]
            for k in range(1, 8):
                Y = 10.4 * k / 8
                a_, b_ = pj(9.8, Y, 4.9), pj(9.8, Y, 9.1)
                L(a_[0], a_[1], b_[0], b_[1], "OAK_0")
                for j in range(9):
                    z = 5.1 + j * 0.45
                    p0, p1 = pj(9.8, Y + 0.08, z), pj(9.8, Y + 1.0 - 0.1 * (j % 3), z)
                    L(p0[0], p0[1], p1[0], p1[1], BOOKC[(j * 3 + k) % len(BOOKC)])
                    if (j + k) % 4 == 0:
                        L(p0[0] + 1, p0[1], p1[0] + 1, p1[1], LIGHTER.get(BOOKC[(j * 3 + k) % len(BOOKC)], "CREAM"))
            PL(q + [q[0]], "INK")
    # --- left wall (the view's back wall), right to left: bed, kitchen, entry
    with obj("bed-frame-art"):
        fx0, fy0 = pji(7.2, 7.2, 0)
        fx1, fy1 = pji(9.9, 5.0, 0)
        BOX(fx0, fy0, fx1, fy1, "OAK_1", hi="OAK_2")
        R(fx0 + 3, fy0 + 3, fx1 - 3, fy1 - 3, "SLATE_0")
        # original mountain + sun art
        POLY([(fx0 + 3, fy1 - 3), (fx0 + 14, fy0 + 14), (fx0 + 22, fy0 + 22), (fx0 + 32, fy0 + 9), (fx1 - 3, fy1 - 10), (fx1 - 3, fy1 - 3)], "PLUM_1")
        L(fx0 + 14, fy0 + 14, fx0 + 18, fy0 + 18, "PLUM_2")
        L(fx0 + 32, fy0 + 9, fx0 + 36, fy0 + 13, "PLUM_2")
        circ(fx1 - 12, fy0 + 9, 3, "GOLD")
    with obj("bed-shelf"):
        a_, b_ = pji(4.6, 5.85, 0), pji(7.0, 5.6, 0)
        lbox(4.6, 7.0, 5.6, 5.85, 0, 0.8, "OAK_1", side="OAK_0", top="OAK_2")
        px, py = pj(5.2, 5.85, 0.4)
        pot(px - 4, py - 5, px + 4, py, "TERRA_1")
        bush(px, py - 8, 6, 4, rng, n=24)
        for i in range(5):
            vine(int(px) - 4 + i * 2, int(py) + 1, rng.randint(12, 30), rng, drift=0.1, sw=swv(i))
        bx_, by_ = pj(6.6, 5.85, 0.45)    # little books
        for i, c in enumerate(("SLATE_1", "TERRA_1", "GOLD_DK")):
            R(bx_ - 6 + i * 3, by_ - 7 + i, bx_ - 4 + i * 3, by_ - 1, c)
    with obj("plasma-globe"):
        gx, gy = pj(6.3, 6.6, 0.4)
        R(gx - 4, gy + 5, gx + 4, gy + 8, "INK")
        L(gx - 3, gy + 5, gx + 3, gy + 5, "SLATE_0")
        circ(gx, gy, 7, "INK")
        circ(gx, gy, 6, "NAVY!")
        with channel("globe"):
            ro = 0.55 * af("globe")
            for a in (0.3, 1.7, 2.9, 4.4, 5.5):
                L(gx, gy, gx + math.cos(a + ro) * 6, gy + math.sin(a + ro) * 6, "VIOLET!")
            P(gx + math.cos(1.7 + ro) * 6, gy + math.sin(1.7 + ro) * 6, "PLUM_3!")
            P(gx + math.cos(4.4 + ro) * 6, gy + math.sin(4.4 + ro) * 6, "PLUM_3!")
            circ(gx, gy, 1, "CREAM!")
            P(gx - 3, gy - 4, "CREAM")
            light(gx, gy, 30, 26, 0.6)
            tint(gx, gy, 32, 28, "violet", (1.0, 0.8, 1.2)[af("globe")])
    with obj("bed-rug"):
        q = [pj(2.0, 0, 0.15), pj(10.9, 0, 0.15), pj(10.9, 0, 5.9), pj(2.0, 0, 5.9)]
        POLY(q, "PLUM_1", "INK")
        q2 = [pj(2.4, 0, 0.4), pj(10.6, 0, 0.4), pj(10.6, 0, 5.6), pj(2.4, 0, 5.6)]
        PL(q2 + [q2[0]], "CREAM")
        q3 = [pj(2.8, 0, 0.7), pj(10.2, 0, 0.7), pj(10.2, 0, 5.3), pj(2.8, 0, 5.3)]
        PL(q3 + [q3[0]], "PLUM_2")
        for k in range(9):
            c = pj(3.4 + k * 0.85, 0, 4.6)
            ss = sc(4.6) * 0.18
            POLY([(c[0], c[1] - ss * 0.6), (c[0] + ss * 1.4, c[1]), (c[0], c[1] + ss * 0.6), (c[0] - ss * 1.4, c[1])], "TERRA_1")
        a_, b_ = pj(2.0, 0, 5.9), pj(10.9, 0, 5.9)
        for x in range(int(a_[0]) + 1, int(b_[0]), 3):
            P(x, a_[1] + 1, "CREAM")
    with obj("headboard"):
        lbox(10.6, 11.0, 0, 3.6, 0, 3.7, "OAK_1", side="OAK_0", top="OAK_2")
        for z in (0.6, 1.4, 2.2, 3.0):
            a_, b_ = pj(10.6, 3.3, z), pj(10.6, 1.4, z)
            L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
    with obj("bed"):
        X0, X1 = 4.0, 10.6
        lbox(X0, X1, 0, 0.9, 0.0, 3.7, "OAK_1", side="OAK_0", top="OAK_2")
        a_, b_ = pj(X0 + 0.3, 0.5, 3.71), pj(X1 - 0.3, 0.5, 3.71)
        L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
        # mattress
        lbox(X0 + 0.05, X1 - 0.05, 0.8, 1.7, 0.1, 3.6, "CREAM", side="SLATE_2", top="CREAM")
        # pillows at the head (right)
        for k, (zz, c) in enumerate(((0.35, "SLATE_2"), (1.9, "CREAM"))):
            a_, b_ = pj(X1 - 1.6, 2.6, zz + 1.5), pj(X1 - 0.2, 1.7, zz + 1.5)
            ELL(a_[0], a_[1], b_[0], b_[1] + 2, c, "INK")
            L(a_[0] + 3, a_[1] + 1, b_[0] - 3, a_[1] + 1, "CREAM")
        # lilac quilt over the top and draped down the front, folded back at the pillows
        qt = [pj(X0 + 0.05, 1.78, 0.1), pj(X1 - 1.8, 1.78, 0.1), pj(X1 - 1.8, 1.78, 3.62), pj(X0 + 0.05, 1.78, 3.62)]
        POLY(qt, "VIOLET", "INK")
        a_, b_ = pj(X0 + 0.05, 1.78, 3.62), pj(X1 - 1.8, 0.75, 3.75)
        R(a_[0], a_[1], b_[0], b_[1], "VIOLET")
        L(a_[0], a_[1] + 1, b_[0], a_[1] + 1, "PLUM_3")
        L(a_[0], b_[1] - 1, b_[0], b_[1] - 1, "PLUM_1")
        L(a_[0], b_[1], b_[0], b_[1], "INK")
        L(a_[0], a_[1], a_[0], b_[1], "INK")
        L(b_[0], a_[1], b_[0], b_[1], "INK")
        for k in range(1, 9):        # quilt squares: stitches on the drape and the top
            x = a_[0] + (b_[0] - a_[0]) * k / 9
            L(x, a_[1] + 2, x, b_[1] - 2, "PLUM_2" if k % 2 else "VIOLET")
            tq = pj(X0 + (X1 - 1.8 - X0) * k / 9, 1.78, 2.0)
            P(tq[0], tq[1], "PLUM_3")
        fb = [pj(X1 - 1.8, 1.82, 0.1), pj(X1 - 1.3, 1.82, 0.1), pj(X1 - 1.3, 1.82, 3.62), pj(X1 - 1.8, 1.82, 3.62)]
        POLY(fb, "CREAM", "INK")    # sheet folded back
        # folded slate throw across the foot
        ft = [pj(X0 + 0.3, 1.86, 0.2), pj(X0 + 1.5, 1.86, 0.2), pj(X0 + 1.5, 1.86, 3.66), pj(X0 + 0.3, 1.86, 3.66)]
        POLY(ft, "SLATE_1", "INK")
        a_, b_ = pj(X0 + 0.3, 1.86, 3.66), pj(X0 + 1.5, 1.0, 3.8)
        R(a_[0], a_[1], b_[0], b_[1], "SLATE_0")
        L(a_[0], a_[1], b_[0], a_[1], "SLATE_2")
        PL([(a_[0], a_[1]), (a_[0], b_[1]), (b_[0], b_[1]), (b_[0], a_[1])], "INK")
        shadow_fp(X0, X1, 0, 3.7)
    with obj("nightstand"):
        lbox(9.6, 10.9, 0, 2.0, 3.75, 5.1, "OAK_1", side="OAK_0", top="OAK_2")
        a_, b_ = pj(9.75, 1.3, 5.11), pj(10.75, 1.3, 5.11)
        L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
        m_ = pj(10.25, 1.6, 5.11)
        R(m_[0] - 1, m_[1], m_[0] + 1, m_[1], "GOLD")
        shadow_fp(9.6, 10.9, 3.75, 5.1)
    with obj("alarm-clock"):
        cx_, cy_ = pj(10.0, 2.0, 4.5)
        BOX(cx_ - 6, cy_ - 7, cx_ + 5, cy_, "CRT_0", hi="CRT_1", sh="TERRA_0")
        R(cx_ - 4, cy_ - 5, cx_ + 3, cy_ - 2, "INK")
        for dx in (-3, -1, 1, 2):
            P(cx_ + dx, cy_ - 4, "CRT_1!")
        P(cx_ - 1, cy_ - 3, "CRT_1!")
        P(cx_ - 6, cy_ - 8, "GOLD")
        P(cx_ + 5, cy_ - 8, "GOLD")
        light(cx_, cy_ - 4, 12, 10, 0.25)
    with obj("star-jar"):
        jx, jy = pj(10.55, 2.0, 4.2)
        BOX(jx - 3, jy - 8, jx + 3, jy, "SLATE_1", hi="SLATE_2")
        R(jx - 3, jy - 9, jx + 3, jy - 9, "OAK_2")
        for dx, dy, c in ((-1, -2, "GOLD"), (0, -5, "PLUM_3"), (1, -1, "SUN"), (0, -3, "CREAM"), (-1, -6, "GOLD")):
            P(jx + dx, jy + dy, c)
    # --- kitchen
    with obj("corkboard-kitchen"):
        x0, y0 = pji(1.5, 8.9, 0)
        x1, y1 = pji(3.8, 6.8, 0)
        BOX(x0, y0, x1, y1, "OAK_1", hi="OAK_2")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "OAK_2")
        notes = ((0.08, 0.12, "CREAM", 7, 6), (0.40, 0.10, "SLATE_2", 8, 7), (0.72, 0.15, "PLUM_3", 6, 8),
                 (0.12, 0.55, "GOLD", 9, 6), (0.45, 0.52, "CREAM", 6, 9), (0.70, 0.60, "TERRA_2", 8, 6),
                 (0.25, 0.30, "LEAF_3", 6, 5), (0.58, 0.32, "SLATE_2", 7, 6))
        for u, v, c, w_, h_ in notes[:(3, 6, 8)[stg("kitchen.door")]]:
            nx, ny = x0 + 3 + u * (x1 - x0 - 6), y0 + 3 + v * (y1 - y0 - 6)
            R(nx, ny, nx + w_, ny + h_, c)
            L(nx + 1, ny + 2, nx + w_ - 2, ny + 2, "SLATE_0" if c == "CREAM" else "INK")
            P(nx + w_ // 2, ny, "CRT_1")
    with obj("relic-mount-L"):
        lbox(-0.6, 0.6, 7.6, 7.85, 0, 0.7, "OAK_1", side="OAK_0", top="OAK_2")
        a_ = pj(0, 7.85, 0.35)
        L(a_[0] - 3, a_[1] + 2, a_[0] - 1, a_[1] + 7, "INK")
        L(a_[0] + 3, a_[1] + 2, a_[0] + 1, a_[1] + 7, "INK")
        x, y = pj(0, 8.5, 0.35)
        relic_slot("kitchen.relic", x, y)
    FX0, FX1 = 1.4, 3.8
    with obj("fridge"):
        f = lbox(FX0, FX1, 0, 6.3, 0, 2.5, "SLATE_1", side="SLATE_0", top="SLATE_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        L(ax + 1, ay + 1, bx - 1, ay + 1, "SLATE_2")
        L(ax + 1, ay + 1, ax + 1, dy - 1, "SLATE_2")
        yd = ay + (dy - ay) * 0.34
        L(ax + 1, yd, bx - 1, yd, "INK")
        R(ax + 1, dy - 5, bx - 1, dy - 1, "INK")
        R(bx - 6, ay + 6, bx - 5, yd - 5, "CREAM")
        R(bx - 6, yd + 4, bx - 5, yd + 26, "CREAM")
        for (u, v, c) in ((0.25, 0.5, "CRT_1"), (0.4, 0.58, "GOLD"), (0.3, 0.7, "LEAF_3"), (0.55, 0.45, "CREAM")):
            R(ax + (bx - ax) * u, ay + (dy - ay) * v, ax + (bx - ax) * u + 1, ay + (dy - ay) * v + 1, c)
        # a photo and a takeout menu on the door
        R(ax + 8, ay + (dy - ay) * 0.6, ax + 15, ay + (dy - ay) * 0.6 + 8, "CREAM")
        R(ax + 9, ay + (dy - ay) * 0.6 + 1, ax + 14, ay + (dy - ay) * 0.6 + 5, "SLATE_1")
        shadow_fp(FX0, FX1, 0, 2.5)
    with obj("switch-panel"):
        x0, y0 = pji(-4.3, 4.4, 0)
        x1, y1 = pji(-3.8, 3.4, 0)
        BOX(x0, y0, x1, y1, "CREAM", hi="CREAM", sh="SLATE_2")
        P((x0 + x1) // 2, y0 + 4, "SLATE_1")
        P((x0 + x1) // 2, y0 + 10, "SLATE_1")
    with obj("backsplash"):
        x0, y0 = pji(-3.4, 4.6, 0)
        x1, y1 = pji(1.25, 2.95, 0)
        R(x0, y0, x1, y1, "SLATE_2")
        for yy in range(y0, y1, 5):
            L(x0, yy, x1, yy, "SLATE_1")
            for xx in range(x0 + (yy // 5 % 2) * 4, x1, 8):
                L(xx, yy, xx, min(y1, yy + 4), "SLATE_1")
        L(x0, y0, x1, y0, "OAK_1")
    with obj("kitchen-shelf"):
        lbox(-3.0, 0.6, 5.7, 5.95, 0, 0.9, "OAK_2", side="OAK_1", top="OAK_2")
        for i, (X, c) in enumerate(((-2.6, "SLATE_2"), (-2.0, "GOLD"), (-1.4, "CREAM"), (-0.8, "TERRA_2"))):
            x, y = pj(X, 5.95, 0.45)
            BOX(x - 3, y - 8, x + 3, y, c, hi="CREAM")
            R(x - 3, y - 9, x + 3, y - 9, "OAK_1")
        x, y = pj(0.1, 5.95, 0.45)
        pot(x - 4, y - 5, x + 4, y, "TERRA_1")
        bush(x, y - 8, 5, 3, rng, n=16)
        for i in range(3):
            vine(int(x) - 3 + i * 3, int(y) + 1, rng.randint(8, 16), rng, sw=swv(i + 2))
    with obj("counter"):
        CX0, CX1 = -3.4, 1.25
        f = lbox(CX0, CX1, 0, 2.95, 0, 2.2, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        for k in range(4):
            xa = ax + 3 + k * (bx - ax - 4) / 4
            xb = xa + (bx - ax - 4) / 4 - 3
            POLY([(xa, ay + 6), (xb, ay + 6), (xb, dy - 6), (xa, dy - 6)], "OAK_0", "OAK_DK")
            P(xb - 2 if k % 2 == 0 else xa + 2, ay + 10, "GOLD")
        R(ax + 1, dy - 4, bx - 1, dy - 1, "INK")
        R(ax - 1, ay - 2, bx + 1, ay, "AMBER")      # butcher-block lip
        L(ax - 1, ay - 2, bx + 1, ay - 2, "SUN")
        L(ax - 1, ay + 1, bx + 1, ay + 1, "INK")
        shadow_fp(CX0, CX1, 0, 2.2)
    with obj("kettle"):
        x, y = pj(0.6, 2.95, 1.0)
        ELL(x - 6, y - 10, x + 6, y, "SLATE_1", "INK")
        L(x - 3, y - 9, x + 2, y - 9, "SLATE_2")
        L(x + 6, y - 7, x + 9, y - 10, "INK")
        R(x - 2, y - 12, x + 2, y - 11, "INK")
        R(x - 7, y - 1, x + 7, y, "INK")             # base
        with channel("kettle"):
            on = af("kettle") % 2 == 0
            P(x + 5, y - 1, "CRT_1!" if on else "TERRA_0")
            for k in range(3):                         # steam curl
                sx = x + 9 + ((af("kettle") + k) % 3) - 1
                P(sx, y - 12 - k * 3, "CREAM" if k < 2 else "SLATE_2")
            light(x + 5, y - 1, 10, 8, 0.25)
    with obj("water-jug"):
        x, y = pj(-0.5, 2.95, 1.0)
        BOX(x - 4, y - 15, x + 4, y, "SLATE_2", hi="CREAM")
        lvl = (0, 3, 7, 11)[grow("kitchen.water")]
        if lvl:
            R(x - 3, y - lvl - 1, x + 3, y - 1, "SLATE_1")
            L(x - 3, y - lvl - 1, x + 3, y - lvl - 1, "SLATE_2")
        R(x - 2, y - 17, x + 2, y - 16, "SLATE_0")
    with obj("fruit-basket"):
        x, y = pj(-1.6, 2.95, 1.1)
        POLY([(x - 10, y - 6), (x + 10, y - 6), (x + 7, y), (x - 7, y)], "OAK_2", "INK")
        L(x - 9, y - 3, x + 9, y - 3, "OAK_1")
        fr = ((-6, "CRT_1"), (-2, "LEAF_3"), (2, "GLOW"), (6, "CRT_0"), (0, "SUN"))
        n = (2, 5, 5)[stg("kitchen.food")]
        for dx, c in fr[:n]:
            circ(x + dx, y - 8 if dx != 0 else y - 11, 3, c)
        if n == 5:
            P(x - 1, y - 14, "LEAF_2")
        if stg("kitchen.food") == 2:
            circ(x - 4, y - 13, 2, "PLUM_2")
            circ(x + 4, y - 13, 2, "LEAF_3")
    with obj("envelope"):
        x, y = pj(-2.7, 2.96, 1.3)
        POLY([(x - 7, y - 4), (x + 7, y - 4), (x + 6, y), (x - 8, y)], "CREAM", "INK")
        L(x - 7, y - 4, x, y - 1, "SLATE_2")
        L(x, y - 1, x + 7, y - 4, "SLATE_2")
        if vk("kitchen.doormat") == "alert":
            POLY([(x - 7, y - 4), (x + 7, y - 4), (x, y - 9)], "CREAM", "INK")
            R(x - 1, y - 5, x + 1, y - 4, "CRT_1")
        else:
            R(x - 1, y - 2, x, y - 2, "CRT_0")
    with obj("kitchen-stool"):
        x, yf = pj(-0.6, 0, 3.4)
        _, ys = pj(-0.6, 2.2, 3.4)
        ELL(x - 8, ys - 3, x + 8, ys + 2, "OAK_1", "INK")
        L(x - 6, ys - 2, x + 6, ys - 2, "OAK_2")
        for dx in (-6, -2, 2, 6):
            L(x + dx * 0.9, ys + 2, x + dx * 1.15, yf, "OAK_0")
        L(x - 6, (ys + yf) // 2 + 3, x + 6, (ys + yf) // 2 + 3, "OAK_DK")
        shadow_ell(x, yf, 9, 2, k=1.0)
    with obj("gut-plant"):
        px, py = pj(-2.8, 0, 3.9)
        pot(px - 9, py - 13, px + 9, py, "TERRA_1")
        L(px - 8, py - 10, px + 8, py - 10, "TERRA_0")
        gs = stg("kitchen.gut")
        for i in range(13):
            if gs == 0 and i % 2:
                continue
            a = -math.pi / 2 + (i - 6) * 0.24 + 0.08 * math.sin(i * 2.3) + 0.05 * swv(i)
            ln = (22 + 12 * abs(math.cos(i * 1.3))) * (0.6, 1.0, 1.18)[gs]
            big_leaf(px + (i - 6) * 0.7, py - 12, a, ln, 7 + (i % 3),
                     "LEAF_1" if i % 3 == 0 else "LEAF_2", "LEAF_0", "LEAF_0", hi="LEAF_3")
        shadow_ell(px, py, 13, 3)
    with obj("wall-clock"):
        x, y = pj(-4.6, 8.3, 0)
        circ(x, y, 7, "INK")
        circ(x, y, 6, "CREAM")
        L(x, y, x, y - 4, "INK")
        L(x, y, x + 3, y + 1, "INK")
        P(x, y - 5, "CRT_0")
    # --- entry: door, hooks, mat, shoes
    with obj("door"):
        x0, y0 = pji(-8.4, 7.1, 0)
        x1, y1 = pji(-5.2, 0, 0)
        R(x0 - 3, y0 - 3, x1 + 3, y1, "OAK_DK")
        L(x0 - 3, y0 - 3, x1 + 3, y0 - 3, "INK")
        R(x0, y0, x1, y1, "OAK_1")
        for (ya, yb) in ((y0 + 6, y0 + (y1 - y0) * 0.45), (y0 + (y1 - y0) * 0.52, y1 - 8)):
            R(x0 + 6, ya, x1 - 6, yb, "OAK_0")
            L(x0 + 6, ya, x1 - 6, ya, "OAK_DK")
            L(x0 + 6, ya, x0 + 6, yb, "OAK_DK")
        circ(x1 - 7, y0 + (y1 - y0) * 0.5, 2, "GOLD")
        P(x1 - 8, y0 + (y1 - y0) * 0.5 - 1, "SUN")
        R((x0 + x1) // 2 - 1, y0 + 14, (x0 + x1) // 2 + 1, y0 + 15, "GOLD_DK")   # peephole
        L(x0, y1 - 1, x1, y1 - 1, "INK")
    with obj("coat-hooks"):
        x0, y0 = pji(-10.6, 6.2, 0)
        x1, _ = pji(-9.0, 6.2, 0)
        R(x0, y0, x1, y0 + 3, "OAK_1")
        L(x0, y0 + 3, x1, y0 + 3, "INK")
        for k, xx in enumerate(range(x0 + 4, x1 - 2, 10)):
            P(xx, y0 + 4, "GOLD")
            P(xx, y0 + 5, "GOLD")
        # a jacket and a tote on the hooks
        jx = x0 + 6
        POLY([(jx - 6, y0 + 6), (jx + 6, y0 + 6), (jx + 9, y0 + 38), (jx - 9, y0 + 38)], "SLATE_0", "INK")
        L(jx, y0 + 7, jx, y0 + 36, "INK")
        R(jx - 7, y0 + 24, jx - 4, y0 + 26, "SLATE_1")
        tx = x1 - 8
        R(tx - 6, y0 + 16, tx + 6, y0 + 30, "CREAM")
        L(tx - 6, y0 + 16, tx + 6, y0 + 16, "INK")
        L(tx - 4, y0 + 6, tx - 2, y0 + 16, "OAK_2")
        L(tx + 4, y0 + 6, tx + 2, y0 + 16, "OAK_2")
        PL([(tx - 6, y0 + 16), (tx - 6, y0 + 30), (tx + 6, y0 + 30), (tx + 6, y0 + 16)], "INK")
    with obj("doormat"):
        q = [pj(-8.6, 0, 0.3), pj(-5.0, 0, 0.3), pj(-5.0, 0, 2.2), pj(-8.6, 0, 2.2)]
        POLY(q, "OAK_0", "INK")
        q2 = [pj(-8.2, 0, 0.6), pj(-5.4, 0, 0.6), pj(-5.4, 0, 1.9), pj(-8.2, 0, 1.9)]
        PL(q2 + [q2[0]], "AMBER")
    with obj("shoes-entry"):
        for k, (X, z, c) in enumerate(((-9.4, 1.0, "SLATE_1"), (-9.0, 1.6, "CRT_0"))):
            x, y = pj(X, 0, z)
            POLY([(x - 7, y), (x + 6, y), (x + 6, y - 3), (x, y - 5), (x - 7, y - 4)], c, "INK")
            L(x - 7, y - 1, x + 6, y - 1, "CREAM")
    with obj("plant-entry"):
        floor_plant(-10.0, 3.2, "fiddle", 3, h=1.25, potc="SLATE_0")
    # hanging plants and string lights along the top of the wall
    hanging_plant(7.0, 2.2, 24, rng, 1, top_y=CEIL, drop=4.7, name="hang-plant")
    hanging_plant(-1.0, 1.6, 20, rng, 2, top_y=CEIL, drop=4.5, name="hang-plant")
    hanging_plant(-10.0, 3.0, 24, rng, 3, top_y=CEIL, drop=4.8, name="hang-plant")
    wall_string_lights(-10.5, 10.5, 9.7, seed=4)


# ---------------------------------------------------------------- right view: dropshipping desk, gym, study desk
def side_text(z0, Y0, s, c, px=0.12, gap=1):
    """FORGE-style 3x5 letters painted on the left side wall (X = -WX), each font pixel px ft square."""
    zz = z0
    for ch in s:
        g = FONT.get(ch, FONT[" "])
        for i, bt in enumerate(g):
            if bt == "1":
                u, v = i % 3, i // 3
                q = [pj(-WX + 0.05, Y0 - v * px, zz - u * px), pj(-WX + 0.05, Y0 - v * px, zz - (u + 1) * px),
                     pj(-WX + 0.05, Y0 - (v + 1) * px, zz - (u + 1) * px), pj(-WX + 0.05, Y0 - (v + 1) * px, zz - u * px)]
                POLY(q, c)
        zz -= (3 + gap) * px


def side_cells(z0, z1, Y0, Y1, nx, ny, colf, pad=0.08):
    for i in range(nx):
        for j in range(ny):
            c = colf(i, j)
            if not c:
                continue
            za = z0 - (z0 - z1) * i / nx - pad
            zb = z0 - (z0 - z1) * (i + 1) / nx + pad
            Ya = Y0 - (Y0 - Y1) * j / ny - pad
            Yb = Y0 - (Y0 - Y1) * (j + 1) / ny + pad
            quad([pj(-WX + 0.04, Ya, za), pj(-WX + 0.04, Ya, zb), pj(-WX + 0.04, Yb, zb), pj(-WX + 0.04, Yb, za)], c)


SEG = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
       "7": "abc", "8": "abcdefg", "9": "abfgcd"}


def seg7(x, y, s_, h):
    """Red LED digits, 7 segments each (lit segments emissive, unlit dark red)."""
    w = max(4, h // 2 + 1)
    m = h // 2
    for ch in s_:
        if ch == ":":
            P(x + 1, y + m - 2, "CRT_1!")
            P(x + 1, y + m + 2, "CRT_1!")
            x += 4
            continue
        on = SEG.get(ch, "")
        segs = {"a": (x + 1, y, x + w - 1, y), "g": (x + 1, y + m, x + w - 1, y + m), "d": (x + 1, y + h, x + w - 1, y + h),
                "f": (x, y + 1, x, y + m - 1), "b": (x + w, y + 1, x + w, y + m - 1),
                "e": (x, y + m + 1, x, y + h - 1), "c": (x + w, y + m + 1, x + w, y + h - 1)}
        for k, (a, b, c, d) in segs.items():
            L(a, b, c, d, "CRT_1!" if k in on else "TERRA_0")
        x += w + 3


def scene_right():
    G.win = (-160, 170, -40, 300)     # the window is off to the left (on the room's back wall)
    rng = random.Random(171)
    side_shell(2)
    # --- left side wall (the room's back wall): window glimpse, study desk, its corkboard and calendar, FORGE sign
    with obj("window-side", emit=True):
        bands = {"golden": ["PLUM_2", "TERRA_2", "RIM", "ORANGE", "GLOW", "SUN"],
                 "dawn": ["NAVY", "PLUM_1", "PLUM_2", "PLUM_3", "CREAM", "CREAM"],
                 "midday": ["SLATE_1", "SLATE_1", "SLATE_2", "SLATE_2", "CREAM", "CREAM"],
                 "night": ["INK", "NAVY", "NAVY", "NAVY", "SLATE_0", "PLUM_1"]}[TOD]
        for k, c in enumerate(bands):
            Ya = 10.6 - k * (7.8 / 6)
            Yb = Ya - 7.8 / 6
            quad([pj(-WX, Ya, 7.8), pj(-WX, Ya, 20.0), pj(-WX, Yb, 20.0), pj(-WX, Yb, 7.8)], c)
        quad([pj(-WX, 3.6, 7.8), pj(-WX, 3.6, 20.0), pj(-WX, 2.8, 20.0), pj(-WX, 2.8, 7.8)],
             "SLATE_0" if TOD != "night" else "NAVY")   # rooftops
        for Y in (2.8, 10.6, 8.2):
            PL([pj(-WX + 0.02, Y, 7.6), pj(-WX + 0.02, Y, 20.0)], "OAK_DK" if Y != 8.2 else "INK")
        for z in (7.8, 11.6):
            PL([pj(-WX + 0.02, 10.8, z), pj(-WX + 0.02, 2.6, z)], "OAK_DK")
        quad([pj(-WX + 0.6, 2.8, 7.6), pj(-WX + 0.6, 2.8, 20.0), pj(-WX, 2.8, 20.0), pj(-WX, 2.8, 7.6)], "OAK_1", "INK")
    with obj("curtains"):
        for z0_ in (7.2,):
            quad([pj(-WX + 0.3, 11.2, z0_), pj(-WX + 0.3, 11.2, z0_ + 0.8), pj(-WX + 0.3, 1.0, z0_ + 1.2), pj(-WX + 0.3, 1.0, z0_)], "PLUM_1", "INK")
            for k in range(3):
                PL([pj(-WX + 0.3, 11.0, z0_ + 0.2 + k * 0.2), pj(-WX + 0.3, 1.2, z0_ + 0.25 + k * 0.3)], "PLUM_2" if k % 2 else "BROWN_2")
    with obj("forge-sign"):
        q = [pj(-WX + 0.05, 12.4, 5.6), pj(-WX + 0.05, 12.4, 2.4), pj(-WX + 0.05, 11.3, 2.4), pj(-WX + 0.05, 11.3, 5.6)]
        POLY(q, "INK", "PLASTER_0")
        side_text(5.35, 12.15, "FORGE", "PLUM_3!", px=0.17)
        c = pj(-WX, 11.85, 4.0)
        light(c[0], c[1], 26, 22, 0.6)
        tint(c[0], c[1], 30, 22, "pink", 1.0)
    with obj("pennant"):
        q = [pj(-WX + 0.04, 9.4, 7.0), pj(-WX + 0.04, 8.85, 4.0), pj(-WX + 0.04, 8.3, 7.0)]
        POLY(q, "LEAF_2", "INK")
        PL([pj(-WX + 0.05, 9.25, 6.8), pj(-WX + 0.05, 8.85, 4.6)], "SLATE_2")
    with obj("photo"):
        quad([pj(-WX + 0.04, 9.6, 3.5), pj(-WX + 0.04, 9.6, 2.2), pj(-WX + 0.04, 8.3, 2.2), pj(-WX + 0.04, 8.3, 3.5)], "OAK_2", "INK")
        quad([pj(-WX + 0.05, 9.4, 3.35), pj(-WX + 0.05, 9.4, 2.35), pj(-WX + 0.05, 8.5, 2.35), pj(-WX + 0.05, 8.5, 3.35)], "SLATE_1")
        quad([pj(-WX + 0.06, 8.8, 3.35), pj(-WX + 0.06, 8.8, 2.35), pj(-WX + 0.06, 8.5, 2.35), pj(-WX + 0.06, 8.5, 3.35)], "LEAF_2")
    with obj("schedule-board"):  # Academics corkboard
        quad([pj(-WX + 0.03, 7.5, 7.0), pj(-WX + 0.03, 7.5, 4.3), pj(-WX + 0.03, 5.1, 4.3), pj(-WX + 0.03, 5.1, 7.0)], "OAK_1", "INK")
        quad([pj(-WX + 0.04, 7.35, 6.85), pj(-WX + 0.04, 7.35, 4.45), pj(-WX + 0.04, 5.25, 4.45), pj(-WX + 0.04, 5.25, 6.85)], "OAK_2")
        ss = stg("study.academics")
        side_cells(6.75, 4.55, 7.25, 5.35, 5, 4, lambda i, j: None if (ss == 0 and i >= 2) else
                   ("GOLD" if ss == 2 and (i + j) % 3 == 0 else "CREAM" if (i + j) % 3 else ("SLATE_2", "PLUM_3", "GOLD", "LEAF_3")[(i * 3 + j) % 4]))
        if vk("study.academics") == "alert":
            quad([pj(-WX + 0.06, 6.0, 4.95), pj(-WX + 0.06, 6.0, 4.5), pj(-WX + 0.06, 5.4, 4.5), pj(-WX + 0.06, 5.4, 4.95)], "CRT_0")
    with obj("calendar"):  # Time Blocking
        quad([pj(-WX + 0.03, 7.6, 3.95), pj(-WX + 0.03, 7.6, 2.25), pj(-WX + 0.03, 5.3, 2.25), pj(-WX + 0.03, 5.3, 3.95)], "CREAM", "INK")
        quad([pj(-WX + 0.04, 7.55, 3.9), pj(-WX + 0.04, 7.55, 2.3), pj(-WX + 0.04, 7.15, 2.3), pj(-WX + 0.04, 7.15, 3.9)], "CRT_0")
        cs = stg("study.time")
        side_cells(3.85, 2.35, 7.0, 5.4, 5, 4, lambda i, j: ("GOLD" if cs == 2 else None) if (i, j) in ((2, 1), (3, 1), (2, 2), (3, 2))
                   else None if (cs == 0 and j > 0) else ("SLATE_1" if (i + j) % 2 else "TERRA_2"), pad=0.06)
    with obj("desk"):   # the study desk, seen from its side; drawers face the room (toward the camera's right)
        f = lbox(-WX, -8.8, 0, 2.55, 2.8, 6.7, "OAK_1", side="OAK_1", top="OAK_2")
        if "side" in f:
            q = f["side"]
            for Y in (0.85, 1.7):
                PL([pj(-8.8, Y, 2.9), pj(-8.8, Y, 4.3)], "INK")
                m_ = pj(-8.8, Y + 0.4, 3.6)
                P(m_[0], m_[1], "GOLD")
            PL([pj(-8.8, 2.3, 4.4), pj(-8.8, 2.3, 6.6)], "OAK_DK")
            quad([pj(-8.8, 2.45, 2.85), pj(-8.8, 2.45, 4.4), pj(-8.8, 0.1, 4.4), pj(-8.8, 0.1, 2.85)], "OAK_0", "INK")
        shadow_fp(-WX, -8.8, 2.8, 6.7)
    with obj("desk-lamp"):
        bx_, by_ = pj(-10.2, 2.55, 6.2)
        R(bx_ - 4, by_ - 1, bx_ + 4, by_, "INK")
        L(bx_, by_ - 1, bx_ + 4, by_ - 13, "INK")
        L(bx_ + 4, by_ - 13, bx_ + 10, by_ - 17, "INK")
        on = TOD == "night"
        POLY([(bx_ + 7, by_ - 21), (bx_ + 15, by_ - 16), (bx_ + 12, by_ - 12), (bx_ + 4, by_ - 16)], "LEAF_2", "INK")
        P(bx_ + 11, by_ - 13, "SUN!" if on else "CREAM")
        if on:
            G.cones.append([(bx_ + 10, by_ - 13), (bx_ + 16, by_ - 12), (bx_ + 30, by_ + 1), (bx_ + 5, by_ + 1)])
            light(bx_ + 16, by_ - 2, 30, 20, 1.0)
    with obj("course-books"):
        x0, y0 = pji(-10.3, 2.55, 5.4)
        R(x0, y0 - 12, x0 + 1, y0, "SLATE_0")
        books_row(x0 + 2, x0 + 18, y0, 11, random.Random(5))
        R(x0 + 19, y0 - 12, x0 + 20, y0, "SLATE_0")
    with obj("pen-mug"):
        x, y = pj(-9.6, 2.55, 3.9)
        BOX(x - 3, y - 8, x + 3, y, "SLATE_1", hi="SLATE_2")
        for dx, c in ((-1, "CRT_1"), (0, "GOLD"), (1, "SLATE_2")):
            L(x + dx, y - 9, x + dx * 2, y - 13, c)
    with obj("journal"):
        x, y = pj(-9.4, 2.56, 4.7)
        POLY([(x - 8, y - 2), (x + 5, y - 4), (x + 8, y), (x - 5, y + 1)], "TERRA_0", "INK")
        L(x - 5, y - 1, x + 5, y - 3, "GOLD")
    with obj("succulent"):
        x, y = pj(-10.4, 2.55, 3.3)
        pot(x - 4, y - 5, x + 4, y, "CREAM")
        for dx, dy in ((-3, -7), (0, -9), (3, -7), (-1, -6), (1, -6)):
            P(x + dx, y + dy, "LEAF_3" if dy == -9 else "LEAF_2")
    with obj("desk-chair"):
        x, yf = pj(-8.0, 0, 5.0)
        seat = pj(-8.0, 1.6, 5.0)
        L(x, seat[1], x, yf - 3, "INK")
        for dx in (-9, 0, 9):
            L(x, yf - 3, x + dx, yf, "INK")
        R(x - 11, seat[1] - 4, x + 11, seat[1], "TERRA_0")
        L(x - 11, seat[1] - 4, x + 11, seat[1] - 4, "TERRA_1")
        back = pj(-8.6, 3.3, 5.0)
        BOX(back[0] - 3, back[1], back[0] + 4, seat[1] - 4, "TERRA_0", hi="TERRA_1")
        shadow_ell(x, yf, 12, 3, k=1.0)
    with obj("backpack"):
        x, y = pj(-9.0, 0, 7.6)
        POLY([(x - 9, y), (x - 10, y - 18), (x - 6, y - 23), (x + 5, y - 23), (x + 8, y - 17), (x + 8, y)], "SLATE_0", "INK")
        R(x - 6, y - 12, x + 4, y - 4, "SLATE_1")
        L(x - 6, y - 12, x + 4, y - 12, "INK")
        L(x - 4, y - 22, x - 4, y - 14, "TERRA_1")
        P(x + 1, y - 8, "GOLD")
        shadow_ell(x, y, 10, 2, k=1.0)
    with obj("plant-study"):
        floor_plant(-8.4, 8.0, "snake", 1, h=1.15)
    # --- back wall (the room's right wall): dropshipping desk
    with obj("whiteboard"):
        x0, y0 = pji(-9.3, 8.9, 0)
        x1, y1 = pji(-3.9, 5.0, 0)
        BOX(x0, y0, x1, y1, "SLATE_1", hi="SLATE_2")
        R(x0 + 3, y0 + 3, x1 - 3, y1 - 3, "CREAM")
        R(x0 + 6, y1 - 2, x1 - 6, y1, "SLATE_0")        # marker tray
        for k, c in enumerate(("CRT_0", "LEAF_2", "NAVY")):
            R(x0 + 10 + k * 5, y1 - 3, x0 + 13 + k * 5, y1 - 3, c)
        gx0, gy1 = x0 + 10, y1 - 10
        L(gx0, y0 + 8, gx0, gy1, "INK")
        L(gx0, gy1, gx0 + 52, gy1, "INK")
        pts = [(gx0 + 4 + k * 8, gy1 - 4 - k * 5 - (3 if k % 2 else 0)) for k in range(7)]
        PL(pts, "LEAF_2")
        for x_, y_ in pts:
            P(x_, y_, "INK")
        for k in range(3):     # product columns
            L(x1 - 40, y0 + 10 + k * 7, x1 - 12, y0 + 10 + k * 7, ("CRT_0", "SLATE_0", "LEAF_2")[k])
            R(x1 - 44, y0 + 9 + k * 7, x1 - 42, y0 + 11 + k * 7, ("CRT_0", "SLATE_0", "LEAF_2")[k])
        st_ = ((0.62, 0.55, "GOLD"), (0.75, 0.62, "PLUM_3"), (0.70, 0.78, "LEAF_3"), (0.86, 0.72, "GOLD"),
               (0.55, 0.75, "SLATE_2"), (0.88, 0.52, "PLUM_3"))
        for u, v, c in st_[:(1, 4, 6)[stg("computer.board")]]:
            nx, ny = x0 + u * (x1 - x0), y0 + v * (y1 - y0)
            R(nx, ny, nx + 6, ny + 6, c)
            L(nx + 1, ny + 2, nx + 4, ny + 2, "OAK_DK")
        P(x0 + 2, y0 + 2, "CRT_1")
    with obj("pc-shelf"):
        lbox(-8.7, -4.9, 9.4, 9.65, 0, 0.9, "OAK_2", side="OAK_1", top="OAK_2")
        for X, w, h in ((-8.1, 0.9, 0.9), (-7.0, 0.8, 0.6), (-5.9, 0.7, 0.8)):
            lbox(X - w / 2, X + w / 2, 9.65, 9.65 + h, 0.1, 0.8, "AMBER", side="OAK_2", top="OAK_2")
            a_ = pj(X, 9.65 + h * 0.55, 0.8)
            R(a_[0] - 2, a_[1] - 1, a_[0] + 2, a_[1], "CREAM")
    with obj("pc-desk"):
        f = lbox(-9.0, -4.4, 2.3, 2.65, 0, 2.6, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = lbox(-5.9, -4.5, 0, 2.3, 0.2, 2.5, "OAK_0", side="OAK_DK", top="OAK_1")["front"]
        for k in range(3):
            yy = ay + 2 + k * (dy - ay - 3) / 3
            L(ax + 1, yy, bx - 1, yy, "INK")
            R((ax + bx) / 2 - 2, yy + 3, (ax + bx) / 2 + 2, yy + 3, "GOLD")
        for X in (-8.8,):
            a_, b_ = pj(X, 2.3, 2.45), pj(X, 0, 2.45)
            R(a_[0] - 1, a_[1], a_[0] + 1, b_[1], "OAK_0")
            L(a_[0] - 1, a_[1], a_[0] - 1, b_[1], "INK")
        shadow_fp(-9.0, -4.4, 0, 2.6, k=1.0)
    with obj("pc-tower"):
        f = lbox(-8.7, -7.6, 0, 1.8, 0.4, 1.6, "INK", side="BROWN_1", top="SLATE_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        for k in range(4):
            L(ax + 2, ay + 4 + k * 3, bx - 2, ay + 4 + k * 3, "BROWN_1")
        P(bx - 3, ay + 2, "LEAF_3!")
    with obj("monitors"):  # AI Building
        with channel("terminal"):
            for k, (Xa, Xb) in enumerate(((-8.7, -6.75), (-6.6, -4.65))):
                x0, y0 = pji(Xa, 5.0, 1.2)
                x1, y1 = pji(Xb, 3.25, 1.2)
                BOX(x0, y0, x1, y1, "INK")
                R(x0 + 2, y0 + 2, x1 - 2, y1 - 3, "LEAF_0!")
                sc_ = af("terminal") + k * 2
                for j, yy in enumerate(range(y0 + 4, y1 - 4, 3)):
                    j2 = j + sc_
                    ln = (j2 * 7) % 13 + 4
                    c = "LEAF_3!" if j2 % 3 else ("ENERGY!" if k == 0 else "LEAF_2!")
                    L(x0 + 4 + 2 * (j2 % 2), yy, min(x1 - 4, x0 + 4 + ln), yy, c)
                if (af("terminal") + k) % 2 == 0:
                    R(x0 + 4, y1 - 6, x0 + 6, y1 - 5, "LEAF_3!")   # cursor
                st = ((x0 + x1) // 2, y1)
                R(st[0] - 1, st[1], st[0] + 1, st[1] + 6, "INK")
                R(st[0] - 6, st[1] + 6, st[0] + 6, st[1] + 7, "INK")
                if k == 0:
                    G.focus_at = (x0 + 3, y0 - 1)
            mx, my = pj(-6.7, 4.1, 1.2)
            light(mx, my, 44, 34, 0.75)
            tint(mx, my - 4, 40, 34, "green", (1.0, 0.85, 1.15, 0.95)[af("terminal") % 4])
        kx, ky = pj(-6.7, 2.65, 1.9)
        R(kx - 12, ky - 2, kx + 8, ky, "SLATE_0")
        L(kx - 12, ky - 2, kx + 8, ky - 2, "SLATE_1")
        R(kx + 12, ky - 2, kx + 15, ky, "INK")
    with obj("focus-note"):
        n = G.focus_at
        R(n[0] - 1, n[1] - 1, n[0] + 4, n[1] + 3, "GOLD")
        L(n[0], n[1] + 1, n[0] + 3, n[1] + 1, "OAK_DK")
    with obj("headphones"):   # label printer
        hx, hy = pj(-5.0, 2.65, 2.0)
        BOX(hx - 6, hy - 6, hx + 5, hy, "CREAM", hi="CREAM", sh="SLATE_2")
        R(hx - 4, hy - 4, hx + 3, hy - 4, "INK")
        L(hx + 5, hy - 3, hx + 9, hy, "CREAM")
    with obj("pc-chair"):  # black ergonomic mesh chair, seen from behind
        x, yf = pji(-6.7, 0, 3.7)
        _, sy = pji(-6.7, 1.8, 3.7)
        _, ty = pji(-6.7, 3.9, 3.9)
        R(x - 1, sy, x + 1, yf - 5, "SLATE_0")
        L(x - 1, sy, x - 1, yf - 5, "INK")
        for dx in (-12, -6, 0, 6, 12):
            L(x, yf - 5, x + dx, yf - (2 if abs(dx) < 8 else 0), "INK")
            R(x + dx - 1, yf - 1, x + dx + 1, yf, "SLATE_0")
        R(x - 13, sy - 3, x + 13, sy + 1, "INK")                                # seat edge
        L(x - 12, sy - 3, x + 12, sy - 3, "BROWN_1")
        back = [(x - 9, ty + 3), (x - 6, ty), (x + 6, ty), (x + 9, ty + 3), (x + 11, sy - 12), (x + 8, sy - 6), (x - 8, sy - 6), (x - 11, sy - 12)]
        POLY(back, "INK", "INK")
        for yy in range(ty + 2, sy - 7, 2):                                    # mesh weave
            L(x - 8, yy, x + 8, yy, "BROWN_1")
        for xx in range(x - 7, x + 8, 3):
            L(xx, ty + 2, xx, sy - 8, "BROWN_1")
        L(x - 9, ty + 3, x + 9, ty + 3, "SLATE_0")
        R(x - 1, sy - 6, x + 1, sy - 3, "INK")                                 # spine to the seat
        for sdx in (-1, 1):                                                    # armrests
            L(x + sdx * 14, sy - 10, x + sdx * 14, sy - 3, "SLATE_0")
            L(x + sdx * 16, sy - 10, x + sdx * 11, sy - 10, "INK")
        shadow_ell(x, yf, 15, 3, k=1.0)
    with obj("ship-boxes"):
        lbox(-4.2, -3.0, 0, 1.3, 0.1, 1.5, "AMBER", side="OAK_2", top="OAK_2")
        lbox(-4.1, -3.2, 1.3, 2.1, 0.3, 1.3, "OAK_2", side="OAK_1", top="AMBER")
        a_ = pj(-3.6, 0.8, 1.5)
        R(a_[0] - 4, a_[1] - 2, a_[0] + 4, a_[1] + 2, "CREAM")
        L(a_[0] - 3, a_[1], a_[0] + 2, a_[1], "INK")
        shadow_fp(-4.2, -3.0, 0.1, 1.5, k=1.0)
    with obj("money-tree"):
        x, y = pj(-10.0, 0, 1.2)
        pot(x - 7, y - 10, x + 7, y, "SLATE_1")
        for k in range(18):
            yy = y - 11 - k
            L(x - 1 + (k // 2) % 2, yy, x + (k // 2) % 2, yy, "OAK_1" if k % 2 else "OAK_0")
        lv = ((-5, -27), (6, -27), (0, -38), (-9, -33), (9, -33), (-12, -40), (11, -41))
        for i, (dx, dy) in enumerate(lv[:(2, 3, 5, 7)[grow("computer.money")]]):
            dx += swv(i) if abs(dx) > 7 else 0
            ELL(x + dx - 5, y + dy - 4, x + dx + 5, y + dy + 4, "LEAF_2", "INK")
            P(x + dx, y + dy - 2, "LEAF_3")
        if grow("computer.money") == 3:
            circ(x + 2, y - 46, 1, "GOLD")
        shadow_ell(x, y, 9, 2)
    # --- gym
    with obj("gym-mat"):
        q = [pj(-2.6, 0, 0.1), pj(7.0, 0, 0.1), pj(7.0, 0, 5.4), pj(-2.6, 0, 5.4)]
        POLY(q, "INK", "VOID")
        for X in (-0.2, 2.2, 4.6):
            PL([pj(X, 0, 0.1), pj(X, 0, 5.4)], "BROWN_1")
        for z in (1.9, 3.7):
            PL([pj(-2.6, 0, z), pj(7.0, 0, z)], "BROWN_1")
    with obj("gym-timer"):
        x0, y0 = pji(-1.6, 9.9, 0)
        x1, y1 = pji(1.2, 9.0, 0)
        BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
        with channel("timer"):
            digits = ("0:45", "0:44", "0:43", "0:42")[af("timer")]
            seg7(x0 + 4, y0 + 3, digits, y1 - y0 - 6)
            dw = (x1 - x0 - 10) // 4
            mx = x0 + 4 + 2 * dw
            P(mx, y0 + 5, "CRT_0!" if af("timer") % 2 == 0 else "TERRA_0")
            P(mx, y1 - 5, "CRT_0!" if af("timer") % 2 == 0 else "TERRA_0")
            light((x0 + x1) / 2, (y0 + y1) / 2, 22, 14, 0.35)
            tint((x0 + x1) / 2, (y0 + y1) / 2, 24, 16, "red", (0.6, 0.45, 0.7, 0.5)[af("timer")])
    with obj("race-photos"):
        for k, (X0, X1, Y0, Y1) in enumerate(((2.0, 3.6, 8.4, 7.0), (3.9, 5.2, 8.6, 7.5), (5.5, 6.6, 8.2, 6.9))):
            x0, y0 = pji(X0, Y0, 0)
            x1, y1 = pji(X1, Y1, 0)
            BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
            R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, ("SLATE_1", "TERRA_2", "SLATE_2")[k])
            R(x0 + 2, y1 - 6, x1 - 2, y1 - 2, ("LEAF_2", "OAK_1", "SLATE_0")[k])      # ground / track / water
            fx = (x0 + x1) // 2 + (k - 1) * 3                                          # a tiny runner figure
            P(fx, y1 - 11, "INK"); L(fx, y1 - 10, fx, y1 - 8, "INK")
            P(fx - 1, y1 - 7, "INK"); P(fx + 1, y1 - 7, "INK")
            if k == 1:
                L(x0 + 2, y1 - 9, x1 - 2, y1 - 9, "CREAM")   # finish tape
    with obj("medal-wall"):
        x0, y0 = pji(2.2, 6.5, 0)
        x1, _ = pji(6.2, 6.5, 0)
        R(x0, y0, x1, y0 + 2, "OAK_2")
        L(x0, y0 + 2, x1, y0 + 2, "INK")
        R(x0 - 2, y0 - 1, x0, y0 + 3, "GOLD_DK")
        R(x1, y0 - 1, x1 + 2, y0 + 3, "GOLD_DK")
        med = ("GOLD", "SLATE_2", "AMBER", "GOLD", "CREAM", "GOLD", "SLATE_2")
        n = (1, 3, 5, 7)[grow("gym.medals")]
        for k in range(n):
            mx = x0 + 6 + k * (x1 - x0 - 12) / 6
            L(mx - 2, y0 + 3, mx, y0 + 12, ("CRT_0", "NAVY", "LEAF_2")[k % 3])
            L(mx + 2, y0 + 3, mx, y0 + 12, ("SLATE_1", "CREAM", "GOLD")[k % 3])
            circ(mx, y0 + 15, 3, "INK")
            circ(mx, y0 + 15, 2, med[k])
            P(mx - 1, y0 + 14, "CREAM")
        # race bib pinned below
        bx0, by0 = pji(-0.2, 8.3, 0)
        bx1, by1 = pji(1.0, 7.4, 0)
        BOX(bx0, by0, bx1, by1, "CREAM", hi="CREAM", sh="SLATE_2")
        R(bx0 + 3, by0 + 4, bx1 - 3, by0 + 7, "CRT_0")
        P(bx0 + 1, by0 + 1, "INK"); P(bx1 - 1, by0 + 1, "INK")
    with obj("symbol-poster"):     # no words: a laurel around a rising sun over three peaks
        x0, y0 = pji(7.0, 9.0, 0)
        x1, y1 = pji(9.0, 5.6, 0)
        BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "TERRA_0")
        cx_, cy_ = (x0 + x1) // 2, (y0 + y1) // 2
        circ(cx_, cy_ + 2, 9, "GOLD")
        circ(cx_, cy_ + 2, 7, "TERRA_0")
        circ(cx_, cy_ + 2, 4, "SUN")
        POLY([(cx_ - 12, cy_ + 13), (cx_ - 4, cy_ + 3), (cx_, cy_ + 8), (cx_ + 5, cy_ + 1), (cx_ + 12, cy_ + 13)], "INK")
        for k in range(5):
            P(cx_ - 13 + k, cy_ - 6 + k * 3, "LEAF_3")
            P(cx_ + 13 - k, cy_ - 6 + k * 3, "LEAF_3")
    with obj("relic-bracket-R"):
        lbox(9.4, 10.3, 6.6, 6.85, 0, 0.7, "OAK_1", side="OAK_0", top="OAK_2")
        a_ = pj(9.85, 6.6, 0.05)
        L(a_[0], a_[1] + 6, a_[0] + 4, a_[1], "INK")
        x, y = pj(9.85, 7.3, 0.35)
        relic_slot("gym.relic", x, y, 1)
    with obj("weight-rack"):  # Strength: a power rack, plates on the pegs, dumbbells below
        RX0, RX1 = -2.2, 1.2
        for X in (RX0, RX1):
            for z in (0.3, 2.3):
                a_, b_ = pj(X, 0, z), pj(X, 7.0, z)
                R(a_[0] - 1, b_[1], a_[0] + 1, a_[1], "SLATE_0" if z > 1 else "INK")
                L(a_[0] - 1, b_[1], a_[0] - 1, a_[1], "INK")
                for Y in np.arange(2.0, 6.6, 0.5):
                    p_ = pj(X, Y, z)
                    P(p_[0], p_[1], "SLATE_1")
        for Y in (7.0,):
            PL([pj(RX0, Y, 2.3), pj(RX1, Y, 2.3)], "SLATE_0")
            PL([pj(RX0, Y, 0.3), pj(RX1, Y, 0.3)], "INK")
        # barbell racked on the J-hooks
        a_, b_ = pj(RX0 - 0.9, 4.6, 2.3), pj(RX1 + 0.9, 4.6, 2.3)
        L(a_[0], a_[1], b_[0], b_[1], "SLATE_2")
        L(a_[0], a_[1] + 1, b_[0], b_[1] + 1, "SLATE_0")
        plates = (((5, "SLATE_0"),), ((9, "BROWN_1"), (7, "SLATE_0")), ((11, "INK"), (9, "CRT_0"), (6, "GOLD_DK")))[stg("gym.strength")]
        for t in (a_, b_):
            for k, (r_, c) in enumerate(plates):
                ox = (k * 2 + 1) * (1 if t is b_ else -1)
                R(t[0] + ox - 1, t[1] - r_, t[0] + ox + 1, t[1] + r_, "INK")
                R(t[0] + ox, t[1] - r_ + 1, t[0] + ox, t[1] + r_ - 1, c)
        # plate storage pegs + dumbbell row on the floor
        for k, (r_, c) in enumerate(((9, "INK"), (7, "CRT_0"), (5, "SLATE_0"))):
            cx_, cy_ = pj(-0.5 + k * 0.9, 0.9, 0.6)
            circ(cx_, cy_ - r_ + 9, r_, "INK")
            circ(cx_, cy_ - r_ + 9, r_ - 1, c)
            circ(cx_, cy_ - r_ + 9, 1, "SLATE_1")
        shadow_fp(RX0, RX1, 0.3, 2.3)
    with obj("kettlebells"):
        for k, (X, r_, c) in enumerate(((1.9, 5, "INK"), (2.6, 4, "CRT_0"), (3.2, 3, "LEAF_1"))):
            x, y = pj(X, 0, 1.4)
            circ(x, y - r_, r_, "INK")
            circ(x, y - r_, r_ - 1, c)
            ring(x, y - 2 * r_ - 2, 2, "INK")
            P(x - r_ + 2, y - r_ - 2, "SLATE_1")
            shadow_ell(x, y, r_ + 2, 1, k=1.0)
    with obj("chalk"):
        x, y = pj(1.6, 0, 3.2)
        BOX(x - 5, y - 9, x + 5, y, "SLATE_2", hi="CREAM")
        R(x - 4, y - 10, x + 4, y - 9, "CREAM")
        P(x - 2, y - 11, "CREAM"); P(x + 1, y - 12, "CREAM")
        shadow_ell(x, y, 6, 2, k=1.0)
    with obj("shoe-shelf"):     # Running: a sneaker shelf, three pairs
        f = lbox(3.5, 5.9, 0, 2.6, 0, 1.1, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        for k, yb in enumerate((ay + (dy - ay) * 0.5, dy - 2)):
            L(ax + 1, yb, bx - 1, yb, "OAK_DK")
        for k, (u, row, c) in enumerate(((0.2, 0, "CRT_1"), (0.62, 0, "SLATE_2"), (0.35, 1, "LEAF_3"))):
            x = ax + (bx - ax) * u
            y = (ay + (dy - ay) * 0.5) if row == 0 else dy - 2
            for j in (0, 9):
                POLY([(x + j - 4, y - 1), (x + j + 5, y - 1), (x + j + 5, y - 4), (x + j, y - 7), (x + j - 4, y - 6)], c, "INK")
                L(x + j - 4, y - 2, x + j + 5, y - 2, "CREAM")
        shadow_fp(3.5, 5.9, 0, 1.1)
    with obj("gym-bag"):
        x, y = pj(4.6, 0, 2.7)
        POLY([(x - 12, y), (x - 13, y - 9), (x - 10, y - 12), (x + 10, y - 12), (x + 13, y - 9), (x + 12, y)], "NAVY", "INK")
        L(x - 10, y - 11, x + 10, y - 11, "SLATE_0")
        PL([(x - 6, y - 12), (x - 3, y - 17), (x + 3, y - 17), (x + 6, y - 12)], "INK")
        R(x - 3, y - 7, x + 3, y - 5, "CRT_0")
        shadow_ell(x, y, 13, 2, k=1.0)
    with obj("bike"):  # Triathlon: side profile against the wall, tarp half draped (awake: tarp off)
        R_ = 1.15
        zb = 0.9
        wf, wr = pj(8.9, R_, zb), pj(6.5, R_, zb)
        rr = R_ * sc(zb)
        for (cx_, cy_) in (wf, wr):
            circ(cx_, cy_, rr, "INK")
            circ(cx_, cy_, rr - 2, "BROWN_1")
            circ(cx_, cy_, rr - 3, "PLASTER")
            for k in range(6):
                a = k * math.pi / 3
                L(cx_, cy_, cx_ + math.cos(a) * (rr - 3), cy_ + math.sin(a) * (rr - 3), "SLATE_0")
            circ(cx_, cy_, 2, "SLATE_2")
        p_bb = pj(7.5, 1.2, zb)
        p_seat = pj(7.0, 3.1, zb)
        p_head = pj(8.5, 3.0, zb)
        for a, b in ((p_bb, p_seat), (p_seat, p_head), (p_head, wf), (p_bb, p_head), (p_bb, wr), (p_seat, wr)):
            L(a[0], a[1], b[0], b[1], "CRT_0")
            L(a[0], a[1] + 1, b[0], b[1] + 1, "TERRA_0")
        L(p_head[0], p_head[1] - 2, p_head[0] + 9, p_head[1] - 2, "INK")      # aero bars
        L(p_head[0], p_head[1] - 1, p_head[0] + 4, p_head[1] - 1, "INK")
        R(p_seat[0] - 5, p_seat[1] - 3, p_seat[0] + 4, p_seat[1] - 2, "INK")   # saddle
        circ(p_bb[0], p_bb[1], 3, "SLATE_0")
        awake = vk("gym.bike") == "awake"
        if not awake:
            # tarp over the saddle and the rear wheel only, so the frame and front wheel still read
            t = [(p_seat[0] - 9, p_seat[1] - 5), (p_seat[0] + 10, p_seat[1] - 4), (p_bb[0] + 6, p_bb[1] + 2),
                 (p_bb[0] + 2, wr[1] + rr - 1), (wr[0] - rr - 1, wr[1] + rr - 3), (wr[0] - rr - 3, wr[1] - 4)]
            POLY(t, "SLATE_1", "INK")
            for k in range(3):
                L(t[0][0] + 4 + k * 7, t[0][1] + 2, t[0][0] + k * 9 - 4, wr[1] + rr - 4, "SLATE_0")
            L(t[0][0] + 1, t[0][1] + 1, t[1][0] - 2, t[1][1] + 1, "SLATE_2")
        m = (p_bb[0] - 2, p_bb[1] - 12) if not awake else (p_head[0] - 14, p_head[1] + 4)
        PL([(m[0] - 2, m[1]), (m[0] - 1, m[1] - 1), (m[0], m[1]), (m[0] + 1, m[1] - 1)], "CREAM")
        ring(m[0], m[1] + 4, 1, "CREAM")
        R(m[0] - 1, m[1] + 7, m[0] + 1, m[1] + 8, "CREAM")
        shadow_fp(5.3, 10.1, 0.5, 1.3, k=1.0)
    with obj("foam-roller"):
        x, y = pj(-0.8, 0.35, 4.4)
        R(x - 13, y - 4, x + 13, y + 4, "SLATE_1")
        L(x - 13, y - 3, x + 13, y - 3, "SLATE_2")
        ELL(x + 10, y - 4, x + 16, y + 4, "SLATE_0", "INK")
        L(x - 13, y - 4, x + 13, y - 4, "INK")
        L(x - 13, y + 4, x + 13, y + 4, "INK")
        L(x - 14, y - 4, x - 14, y + 4, "INK")
        shadow_ell(x, y + 4, 15, 2, k=1.0)
    with obj("bottle"):
        x, y = pj(6.3, 0, 2.6)
        BOX(x - 3, y - 11, x + 3, y, "ENERGY", hi="ENERGY_HI")
        R(x - 2, y - 13, x + 2, y - 12, "INK")
        shadow_ell(x, y, 4, 1, k=1.0)
    with obj("gym-plant"):
        floor_plant(10.2, 1.4, "fern", 2, h=1.3)
    hanging_plant(-9.6, 2.4, 24, rng, 4, top_y=CEIL, drop=5.3, name="hang-plant")
    hanging_plant(5.6, 2.6, 22, rng, 5, top_y=CEIL, drop=5.2, name="hang-plant")
    wall_string_lights(-10.5, 10.5, 10.0, seed=5)


def wall_sun_patch():
    """Sunset light through the window lands on the view's back wall as three slanted pane patches (baked on the
    plaster only; the overlay adds the soft warm glow over them)."""
    if TOD == "night":
        return
    up = compose(lut(WARM), lut(WARM)) if TOD == "golden" else lut(WARM)
    wall = G.oid == 1
    side = 1 if VIEW == "left" else -1
    X0 = 2.2 if VIEW == "left" else -2.8
    for k in range(3):
        xa = X0 + side * k * 2.15
        xb = xa + side * 1.8
        q = [pj(xa, 9.4, 0), pj(xb, 9.4, 0), pj(xb - side * 1.6, 3.3, 0), pj(xa - side * 1.6, 3.3, 0)]
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon([(int(round(x)), int(round(y))) for x, y in q], fill=1)
        M = (np.array(m) > 0) & wall
        G.img[M] = up[G.img[M]]
    c = pj(X0 + side * 2.6, 6.3, 0)
    G.glows.append(dict(x=c[0], y=c[1], rx=150, ry=90, c="sun", a=0.22, ch=None))


def side_floor_light():
    """Right view: the window's light lands on the floor by the study desk as three warm pane slabs (baked)."""
    wall_sun_patch()
    if VIEW != "right" or TOD == "night":
        return
    cols = {"golden": ("TERRA_2", "RIM", "GLOW"), "dawn": ("PLUM_1", "PLUM_2", "PLUM_3"),
            "midday": ("OAK_2", "AMBER", "SLATE_2")}[TOD]
    floor = G.oid == 4
    for k, (z0, z1) in enumerate(((8.6, 11.6), (12.0, 15.0), (15.4, 18.4))):
        for band, (xa, xb, c) in enumerate(((-11.0, -9.6, cols[2]), (-9.6, -8.2, cols[1]), (-8.2, -6.6, cols[0]))):
            q = [pj(xa + (z0 - 8.6) * 0.12, 0, z0), pj(xb + (z0 - 8.6) * 0.12, 0, z0),
                 pj(xb + (z1 - 8.6) * 0.12, 0, z1), pj(xa + (z1 - 8.6) * 0.12, 0, z1)]
            m = Image.new("L", (W, H), 0)
            ImageDraw.Draw(m).polygon([(int(round(x)), int(round(y))) for x, y in q], fill=1)
            M = (np.array(m) > 0) & floor
            G.img[M] = np.where(G.img[M] == N["OAK_DK"], N["TERRA_1"], N[c])


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


def still(view, tod="golden", scale=3, t=0.0, full=False):
    """One view, lit with the smooth overlay, cropped to its core (or the full master)."""
    TM["t"] = t
    build(tod, 3, view=view)
    rgb = overlay_rgb(G.img, G.spec)
    TM["t"] = 0.0
    x0, y0, x1, y1 = (0, 0, W, H) if full else VIEWS[view]["core"]
    a = rgb[y0:y1, x0:x1]
    return np.array(Image.fromarray(a).resize((a.shape[1] * scale, a.shape[0] * scale), Image.NEAREST))


def main():
    write_palette_proposal()
    os.makedirs(OUT, exist_ok=True)
    for view, tod, name in (("main", "golden", "main"), ("main", "night", "main-night"), ("left", "golden", "left"),
                            ("right", "golden", "right"), ("left", "night", "left-night"), ("right", "night", "right-night")):
        Image.fromarray(still(view, tod)).save(os.path.join(OUT, f"{name}@3x.png"))
    # lighting strip of the main view (dawn, midday, golden, night)
    tiles = [still("main", t, 1) for t in ("dawn", "midday", "golden", "night")]
    gap = 6
    ch, cw = tiles[0].shape[:2]
    strip = np.zeros((ch * 2 + gap * 3 + 14, cw * 2 + gap * 3, 3), np.uint8)
    strip[:] = RGB[N["VOID"]]
    for i, (t, tile) in enumerate(zip(("DAWN", "MIDDAY", "GOLDEN HOUR", "NIGHT"), tiles)):
        r, c = divmod(i, 2)
        yy = gap + 7 + r * (ch + gap + 4)
        xx = gap + c * (cw + gap)
        strip[yy:yy + ch, xx:xx + cw] = tile
        label(strip, t, xx, yy - 7, "CREAM")
    save(strip, os.path.join(OUT, "lighting-strip@2x.png"))


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
# Like art pass 4: every object becomes its own sprite, cut from full lit renders of its view (one render per state
# tag), so the engine's composite of the base variants equals the approved still (before the light overlay, which
# the engine draws from zones.json views.<v>.light). Shell plates come from a "ghost" render (the lit room with every
# object's lights and shadows but without the objects). Every variant has a painted night twin "<key>.night".
# Art pass 5 adds views: every item carries "view" (main, left, right); the engine draws one view at a time.
# Objects seen in two views keep their canonical id in the view that holds their zone; the other view's copy gets
# a suffix (-m main, -l left, -r right) with the same target, so a click there turns to the zone's view.
PROTO = os.path.join(ROOT, "docs", "redesign", "room-prototype")
SPR_DIR = "art-r5"
OX, OY = VIEWS["main"]["core"][0], VIEWS["main"]["core"][1]   # master = world + (OX, OY), same for every view
MIN_HIT = 11      # world px: 44 CSS px at phone zone zoom
SKI = lambda s: {"skill": s}  # noqa: E731
FTR = lambda s: {"feature": s}  # noqa: E731
STGK = ("s0", "s1", "s2")
RELK = ("base", "active", "hot", "gold")
BASEVAR = {"kitchen.relic": "base", "window.relic": "base", "gym.relic": "base"}
ZONE_VIEW = {"kitchen": "left", "bed": "left", "library": "main", "window": "main", "study": "main",
             "computer": "right", "gym": "right"}
STATIC_PARTS = {"sky", "sun", "far"}    # the window plates; clouds, birds and the streetcar are drift sprites


def I(id_, zone, kind, objs, keys=("base",), alias=None, target=None, label=None, note="", screen=None, layer=None, view="main"):
    """One live item. keys: rendered variant keys (each a state tag); alias: extra keys -> rendered key."""
    return dict(id=id_, zone=zone, kind=kind, objs=list(objs), keys=list(keys), alias=dict(alias or {}),
                target=target, label=label, note=note, screen=screen, layer=layer, view=view)


TA = {"t1": "base", "t3": "base", "t5": "base"}            # room-tier decor variants: same art for now (LATER)
SA = {"s0": "base", "s1": "base", "s2": "base"}            # stage keys on objects without stage art yet
E = []   # empty placeholders: ids the R3 room had with no counterpart (kept so nothing that names them breaks)

# objects seen in two views: (canonical item spec kwargs) -> copies are generated with a suffix in the other view
BED = [("bed.frame", "decor", ["bed", "headboard"], ("base",), {"t1": "base", "t2": "base", "t5": "base"}, None, None, "platform bed, lilac quilt"),
       ("bed.bed", "hotspot", ["alarm-clock"], ("base",), SA, SKI("sleep"), "SLEEP", "the alarm clock on the nightstand"),
       ("bed.nightstand", "decor", ["nightstand"], ("base",), {}, None, None, "nightstand"),
       ("bed.shelf", "decor", ["bed-shelf"], ("base",), {}, None, None, "wall shelf with a trailing plant"),
       ("bed.globe", "hotspot", ["plasma-globe"], ("base",), SA, SKI("visualization"), "VISUALIZATION", "plasma globe"),
       ("bed.sconce", "decor", ["star-jar"], ("base", "night"), {}, None, None, "jar of paper stars"),
       ("bed.poster", "decor", ["bed-frame-art"], ("base",), TA, None, None, "framed mountain piece above the bed"),
       ("bed.rug", "decor", ["bed-rug"], ("base",), {}, None, None, "art pass 5: big rug under the whole bed")]
KITCHEN = [("kitchen.microwave", "decor", ["fridge"], ("base",), {}, None, None, "fridge"),
           ("kitchen.table", "decor", ["kitchen-shelf"], ("base",), TA, None, None, "open shelf with jars and a plant"),
           ("kitchen.door", "hotspot", ["corkboard-kitchen"], STGK, {"base": "s1"}, SKI("college-integration"), "COLLEGE INTEGRATION", "kitchen corkboard (more by stage)"),
           ("kitchen.doormat", "hotspot", ["envelope"], ("base", "alert"), {}, FTR("review"), "REVIEW", "envelope on the counter (alert: flap up)"),
           ("kitchen.settings", "hotspot", ["switch-panel"], ("base",), {}, FTR("settings"), "SETTINGS", "switch panel by the counter"),
           ("kitchen.relic", "hotspot", ["relic-mount-L"], RELK, {}, FTR("relic-left"), "RELIC", "relic mount above the counter"),
           ("kitchen.counter", "decor", ["counter"], ("base",), TA, None, None, "lower cabinets, butcher-block top"),
           ("kitchen.food", "hotspot", ["fruit-basket"], STGK, {"base": "s1"}, SKI("food"), "FOOD", "fruit basket"),
           ("kitchen.water", "decor", ["water-jug"], ("g0", "g1", "g2", "g3"), {"base": "g2"}, None, None, "water jug (g0..g3)"),
           ("kitchen.kettle", "decor", ["kettle"], ("base",), {}, None, None, "kettle"),
           ("kitchen.gut", "hotspot", ["gut-plant"], STGK, {"base": "s1"}, SKI("gut-health"), "GUT HEALTH", "big leafy floor plant")]
COMPUTER = [("computer.board", "hotspot", ["whiteboard"], STGK, {"base": "s1"}, SKI("dropshipping"), "DROPSHIPPING", "big whiteboard (sticky notes by stage)"),
            ("computer.shelf", "decor", ["pc-shelf"], ("base",), {}, None, None, "shelf of shipping boxes"),
            ("computer.desk", "decor", ["pc-desk"], ("base",), TA, None, None, "walnut desk with drawers"),
            ("computer.led", "decor", ["pc-tower"], ("base",), {}, None, None, "PC tower with a status LED"),
            ("computer.ai", "hotspot", ["monitors"], ("base",), SA, SKI("ai-building"), "AI BUILDING", "two monitors, green code"),
            ("computer.focus", "hotspot", ["focus-note"], ("base",), {}, FTR("focus"), "FOCUS", "weekly focus sticky note"),
            ("computer.headset", "decor", ["headphones"], ("base",), {}, None, None, "art pass 5: label printer"),
            ("computer.money", "decor", ["money-tree"], ("g0", "g1", "g2", "g3"), {"base": "g2"}, None, None, "money tree (g0..g3)"),
            ("computer.chair", "decor", ["pc-chair"], ("base",), TA, None, None, "black ergonomic mesh chair"),
            ("computer.boxes", "decor", ["ship-boxes"], ("base",), {}, None, None, "stacked shipping boxes")]
GYM = [("gym.relic", "hotspot", ["relic-bracket-R"], RELK, {}, FTR("relic-right"), "RELIC", "relic bracket"),
       ("gym.medals", "decor", ["medal-wall"], ("g0", "g1", "g2", "g3"), {"base": "g2"}, None, None, "medal hanger (g0..g3)"),
       ("gym.timer", "decor", ["gym-timer"], ("base",), {}, None, None, "red LED gym timer (digits: gym.timer-led anim)"),
       ("gym.strength", "hotspot", ["weight-rack"], STGK, {"base": "s1"}, SKI("strength"), "STRENGTH", "power rack (heavier plates by stage)"),
       ("gym.bike", "hotspot", ["bike"], ("base", "awake"), SA, SKI("triathlon"), "TRIATHLON", "tri bike under a tarp (awake: tarp off)"),
       ("gym.running", "hotspot", ["shoe-shelf"], ("base",), SA, SKI("running"), "RUNNING", "sneaker shelf"),
       ("gym.bottle", "decor", ["bottle"], ("base",), {}, None, None, "water bottle"),
       ("gym.roller", "decor", ["foam-roller"], ("base",), {}, None, None, "foam roller"),
       ("gym.plant", "decor", ["gym-plant"], ("base",), {}, None, None, "corner plant")]
STUDY_SIDE = [("study.pennant", "decor", ["pennant"], ("base",), {}, None, None, "pennant"),
              ("study.photo", "decor", ["photo"], ("base",), {}, None, None, "photo frame"),
              ("study.academics", "hotspot", ["schedule-board"], STGK + ("alert",), {"base": "s1"}, SKI("academics"), "ACADEMICS", "class-schedule corkboard"),
              ("study.time", "hotspot", ["calendar"], STGK, {"base": "s1"}, SKI("time-blocking"), "TIME BLOCKING", "wall calendar"),
              ("study.desk", "decor", ["desk"], ("base",), TA, None, None, "study desk"),
              ("study.lamp", "decor", ["desk-lamp"], ("base", "night"), {"t1": "base", "t2": "base", "t5": "base"}, None, None, "desk lamp"),
              ("study.courses", "hotspot", ["course-books"], ("base",), {}, FTR("courses"), "COURSES", "course books"),
              ("study.journal", "hotspot", ["journal"], ("base",), {}, FTR("journal"), "JOURNAL", "journal"),
              ("study.mug", "decor", ["pen-mug"], ("base",), {}, None, None, "mug of pens"),
              ("study.headphones", "decor", ["succulent"], ("base",), {}, None, None, "succulent"),
              ("study.backpack", "decor", ["backpack"], ("base",), {}, None, None, "backpack"),
              ("study.chair", "decor", ["desk-chair"], ("base",), TA, None, None, "desk chair"),
              ("study.plant", "decor", ["plant-study"], ("base",), {}, None, None, "snake plant by the desk"),
              ("library.sign", "decor", ["forge-sign"], ("base",), {"t1": "base", "t5": "base"}, None, None, "FORGE neon sign")]


def spec_items(specs, view, suffix="", zone_of=None):
    out = []
    for sid, kind, objs, keys, alias, target, label, note in specs:
        zone = zone_of or sid.split(".")[0]
        if zone == "library" and sid == "library.sign":
            zone = "study"
        out.append(I(sid + suffix, zone, kind, objs, keys, alias, target, label,
                     note + ("" if not suffix else f" ({view} view copy of {sid})"), view=view))
    return out


def live_items_main():
    it = []
    for sid, objs in (("shell.sky", ["window-sky"]), ("shell.outside", ["window-view"]), ("shell.window", ["window-frame", "curtains"]),
                      ("shell.l2", ["wall-B"]), ("shell.l3", ["ceiling", "void"]), ("shell.l4", ["wall-L", "wall-R"]),
                      ("shell.l5", ["floor"])):
        it.append(I(sid, "shell", "shell", objs, ("base", "night"), layer={"shell.sky": 0, "shell.outside": 1}.get(sid, 2)))
    it += [I("window.skylight", "window", "decor", E, ("base", "night"), note="the skylight is part of the ceiling plate"),
           I("window.cables-ceiling", "window", "decor", ["string-x"], note="string lights on the front cross beam"),
           I("kitchen.pendant", "kitchen", "decor", E, ("base", "night"), alias=TA),
           I("library.pendant", "library", "decor", ["pendant@0"], ("base", "night"), alias=TA, note="pendant over the reading chair"),
           I("study.pendant", "window", "decor", ["pendant@1"], ("base", "night"), alias=TA, note="pendant, front right"),
           I("bed.stringlights", "bed", "decor", ["string-side-4"], ("base", "night"), alias={"t1": "base", "t2": "base", "t5": "base"},
             view="left", note="string lights along the left wall (left view)"),
           I("window.stringlights", "window", "decor", E),
           I("library.stringlights", "library", "decor", ["string-1"], note="string lights along the left beam"),
           I("study.stringlights", "study", "decor", ["string-3"], note="string lights along the right beam"),
           I("kitchen.pothos", "kitchen", "decor", ["hang-plant@0"], note="hanging plant, left"),
           I("study.pothos", "computer", "decor", ["hang-plant@1"], note="hanging plant, right"),
           I("library.pothos", "window", "decor", ["hang-plant@2"], note="hanging plant by the skylight"),
           I("library.pothos-2", "library", "decor", ["hang-plant@3"], note="hanging plant, front left"),
           I("window.pothos-2", "study", "decor", ["hang-plant@4"], note="hanging plant, front right"),
           I("library.pothos-3", "library", "decor", ["hang-plant@5"], note="hanging plant over the trophy case")]
    it += [I("window.statue", "window", "hotspot", ["knight", "pedestal"], ("t1", "t2", "t3", "t4", "t5"), alias={"base": "t1"},
             target=FTR("overall"), label="FORGE", note="the knight on its rune pedestal (tiers I..V); plaque shows the tier name"),
           I("window.downlight-fixture", "window", "decor", E),
           I("window.tapestry", "window", "decor", ["tapestry"], note="tapestry, anvil-and-hammer emblem"),
           I("library.sign", "study", "decor", ["forge-sign"], alias={"t1": "base", "t5": "base"}, note="FORGE neon sign"),
           I("window.relic", "window", "hotspot", ["relic-niche"], RELK, target=FTR("relic-window"), label="RELIC", note="niche above the window"),
           I("window.candles", "window", "decor", ["candles"], note="streak candles on the sill"),
           I("window.sill-plant", "window", "decor", E), I("window.sill-books", "window", "decor", E), I("window.sill-mug", "window", "decor", E),
           I("window.vinyl", "window", "decor", ["media-stand"], note="media stand under the window"),
           I("window.radiator", "window", "decor", E), I("window.plant", "window", "decor", ["floor-plant-window"]),
           I("window.plantwall", "window", "decor", E, alias={"t1": "base", "t4": "base"}), I("window.amp", "window", "decor", E),
           I("window.today", "window", "hotspot", ["crt-big"], target=FTR("today"), label="TODAY", screen="crt-big", note="big red CRT (Today)"),
           I("window.speaker", "window", "decor", E),
           I("window.stats", "window", "hotspot", ["crt-small"], target=FTR("stats"), label="STATS", screen="crt-small", note="small CRT"),
           I("window.powerstrip", "window", "decor", E),
           I("window.rug", "window", "decor", ["rug"], alias=TA, note="rug leading to the knight"),
           I("window.cables-floor", "window", "decor", E),
           I("library.chess", "window", "hotspot", ["chess-table"], STGK, alias={"base": "s1"}, target=SKI("chess"), label="CHESS",
             note="art pass 5: a big 8x8 board on its own stand (s2 chess clock)"),
           I("window.chess-chairs", "window", "decor", ["chess-stool"], note="a stool beside the chess stand"),
           I("bed.runner", "window", "decor", ["med-rug"], alias={"t3": "base"}, note="art pass 5: meditation rug in front of the window"),
           I("bed.cushion", "window", "hotspot", ["med-cushion", "med-candle"], STGK, alias={"base": "s1"}, target=SKI("meditation"),
             label="MEDITATION", note="art pass 5: cushion and candle facing the sunset (s0 cushion only)")]
    it += [I("library.bookshelf", "library", "hotspot", ["bookcase", "bookcase-plants", "ladder"], STGK, alias={"base": "s1"},
             target=SKI("reading"), label="READING",
             note="tall dark bookcase with a rolling ladder and plants spilling off the top (shelves fill with the score)"),
           I("library.bookcase", "library", "decor", E, alias={"t1": "base", "t4": "base"}),
           I("library.shelf-plant", "library", "decor", E), I("library.globe", "library", "decor", E),
           I("library.potions", "library", "decor", ["potions"], note="potion shelf"),
           I("library.archive", "library", "hotspot", ["trophy-case"], target=FTR("archive"), label="ARCHIVE", note="glass trophy case"),
           I("library.snakeplant", "library", "decor", E), I("library.clock", "library", "decor", E),
           I("library.poster", "library", "decor", E, alias=TA),
           I("library.armchair", "library", "decor", ["reading-chair"], alias={"t1": "base", "t3": "base", "t4": "base"}),
           I("library.floorlamp", "library", "decor", ["floor-lamp"]),
           I("library.stool", "library", "decor", ["side-table"], note="side table with a mug"),
           I("library.books-floor", "library", "decor", ["book-stack"])]
    it += [I("study.shelf", "study", "decor", E), I("study.speaker", "study", "decor", E), I("study.clock", "study", "decor", E),
           I("study.bin", "study", "decor", E)]
    it += spec_items([x for x in STUDY_SIDE if x[0] != "library.sign"], "main")
    # copies of the side walls' objects (the zones live in the side views)
    it += spec_items(BED, "main", "-m") + spec_items(KITCHEN, "main", "-m")
    it += spec_items(COMPUTER, "main", "-m") + spec_items(GYM, "main", "-m")
    # placeholders for R3 ids with no counterpart
    for pid, z in (("kitchen.hooks", "kitchen"), ("kitchen.clock", "kitchen"), ("kitchen.shoes", "kitchen"), ("kitchen.switch", "kitchen"),
                   ("kitchen.spices", "kitchen"), ("kitchen.board", "kitchen"), ("bed.charger", "bed"), ("bed.slippers", "bed"),
                   ("bed.hamper", "bed"), ("computer.router", "computer"), ("computer.speakers", "computer"), ("computer.can", "computer"),
                   ("computer.cables", "computer"), ("computer.mug", "computer"), ("gym.light", "gym"), ("gym.tiles", "gym"),
                   ("gym.rope", "gym")):
        it.append(I(pid, z, "decor", E, ("base", "night") if pid == "gym.light" else ("base",),
                    alias=TA if pid in ("gym.tiles", "bed.hamper") else ({"t1": "base", "t3": "base"} if pid in ("kitchen.shoes", "computer.cables") else {})))
    for cid in ("shell.crop.speaker", "shell.crop.boxes", "shell.crop.plant", "shell.crop.cables"):
        it.append(I(cid, "shell", "decor", E, layer=6))
    return it


def live_items_left():
    it = [I("shell.left-l2", "shell", "shell", ["wall-B"], ("base", "night"), layer=2, view="left"),
          I("shell.left-l3", "shell", "shell", ["ceiling", "void"], ("base", "night"), layer=2, view="left"),
          I("shell.left-l4", "shell", "shell", ["wall-L", "wall-R"], ("base", "night"), layer=2, view="left"),
          I("shell.left-l5", "shell", "shell", ["floor"], ("base", "night"), layer=2, view="left")]
    it += spec_items(BED, "left") + spec_items(KITCHEN, "left")
    it[-0:] += []
    for x in it:
        if x["id"] == "kitchen.counter":
            x["objs"] = ["counter", "backsplash"]
    it += [I("kitchen.stool", "kitchen", "decor", ["kitchen-stool"], view="left", note="stool at the counter"),
           I("kitchen.clock-l", "kitchen", "decor", ["wall-clock"], view="left", note="wall clock"),
           I("kitchen.hooks-l", "kitchen", "decor", ["coat-hooks"], view="left", note="coat hooks with a jacket and a tote"),
           I("kitchen.entry", "kitchen", "decor", ["door", "doormat"], view="left", note="art pass 5: the room's entry door and mat"),
           I("kitchen.shoes-l", "kitchen", "decor", ["shoes-entry"], view="left", note="shoes by the door"),
           I("kitchen.plant", "kitchen", "decor", ["plant-entry"], view="left", note="fiddle-leaf fig by the door"),
           I("library.potions-l", "library", "decor", ["potions"], view="left", note="potion shelf on the side wall (left view copy)"),
           I("library.bookshelf-l", "library", "hotspot", ["bookcase"], target=SKI("reading"), label="READING", view="left",
             note="the bookcase edge-on (left view copy of library.bookshelf)"),
           I("bed.pothos", "bed", "decor", ["hang-plant@0"], view="left"), I("kitchen.pothos-l", "kitchen", "decor", ["hang-plant@1"], view="left"),
           I("kitchen.pothos-l2", "kitchen", "decor", ["hang-plant@2"], view="left")]
    return it


def live_items_right():
    it = [I("shell.right-l2", "shell", "shell", ["wall-B"], ("base", "night"), layer=2, view="right"),
          I("shell.right-l3", "shell", "shell", ["ceiling", "void"], ("base", "night"), layer=2, view="right"),
          I("shell.right-l4", "shell", "shell", ["wall-L", "wall-R"], ("base", "night"), layer=2, view="right"),
          I("shell.right-l5", "shell", "shell", ["floor"], ("base", "night"), layer=2, view="right"),
          I("shell.right-window", "shell", "shell", ["window-side", "curtains"], ("base", "night"), layer=2, view="right")]
    it += spec_items(COMPUTER, "right") + spec_items(GYM, "right") + spec_items(STUDY_SIDE, "right", "-r")
    it += [I("gym.mat", "gym", "decor", ["gym-mat"], view="right", note="rubber mat on the wood floor"),
           I("gym.kettlebell", "gym", "decor", ["kettlebells"], view="right", note="three kettlebells"),
           I("gym.chalk", "gym", "decor", ["chalk"], view="right", note="chalk bucket"),
           I("gym.bag", "gym", "decor", ["gym-bag"], view="right", note="gym bag"),
           I("gym.trophies", "gym", "decor", ["race-photos"], alias=TA, view="right", note="art pass 5: framed race photos"),
           I("gym.poster", "gym", "decor", ["symbol-poster"], view="right", note="symbol poster, no words"),
           I("computer.pothos-r", "computer", "decor", ["hang-plant@0"], view="right"),
           I("gym.pothos", "gym", "decor", ["hang-plant@1"], view="right"),
           I("gym.stringlights", "gym", "decor", ["string-side-5"], ("base", "night"), view="right")]
    return it


# moving lights per view: (item id, zone, channel, frames, frame sequence, fps)
ANIMS = {
    "main": [("window.crt-flicker", "window", "crt", 3, [0, 0, 1, 0, 2, 0, 0, 1], 8),
             ("bed.globe-glow-m", "bed", "globe", 3, [0, 1, 2, 1], 4),
             ("library.potions-bubbles", "library", "potions", 3, [0, 1, 2], 3),
             ("study.lamp-dust", "study", "dust", 3, [0, 1, 2], 2),
             ("computer.terminal-m", "computer", "terminal", 4, [0, 1, 2, 3], 3),
             ("window.candle", "window", "candle", 3, [0, 1, 0, 2, 1, 0], 6),
             ("window.plants-sway", "window", "sway", 4, [0, 1, 2, 3], 2)],
    "left": [("bed.globe-glow", "bed", "globe", 3, [0, 1, 2, 1], 4),
             ("kitchen.kettle-led", "kitchen", "kettle", 3, [0, 1, 2], 3),
             ("library.potions-bubbles-l", "library", "potions", 3, [0, 1, 2], 3),
             ("kitchen.plants-sway", "kitchen", "sway", 4, [0, 1, 2, 3], 2)],
    "right": [("computer.terminal", "computer", "terminal", 4, [0, 1, 2, 3], 3),
              ("gym.timer-led", "gym", "timer", 4, [0, 1, 2, 3], 2),
              ("study.lamp-dust-r", "study", "dust", 3, [0, 1, 2], 2),
              ("gym.plants-sway", "gym", "sway", 4, [0, 1, 2, 3], 2)],
}
ZONE_ON = {"kitchen": ("left", "kettle"), "bed": ("left", "plasma-globe"), "library": ("main", "floor-lamp"),
           "study": ("main", "desk-lamp"), "computer": ("right", "pc-tower"), "gym": ("right", "gym-timer")}


class LR:
    cache = {}


def render(tag, tod="golden", var=None, tier=3, beam=False, ghost=False, anim=None, view="main"):
    """Full lit render of a view. Returns (img, oid, {name: [oids]}, ghost masks, screens, window, light spec)."""
    key = (view, tag, tod)
    if key in LR.cache:
        return LR.cache[key]
    VAR.clear()
    VAR.update(BASEVAR)
    VAR.update(var or {})
    AF.clear()
    AF.update(anim or {})
    PARTS.clear()
    PARTS.update(STATIC_PARTS)
    img = build(tod, tier, beam=beam, ghost=ghost, view=view)
    PARTS.update({"clouds", "birds", "tram"})
    names = {}
    for o in sorted(G.names):
        names.setdefault(G.names[o], []).append(o)
    r = (img, G.oid.copy(), names, dict(G.gmask), dict(G.screens), G.win, G.spec)
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


TAGVAR = {}   # (view, render tag) -> {item id: key} (every item with that key is rendered in the same scene)


def tag_state(it, key):
    """(render tag, var, tier) for an item's rendered variant key."""
    if it["id"] == "window.statue":
        return key, {}, int(key[1])
    if key == "base":
        return "base", {}, 3
    return key, TAGVAR[(it["view"], key)], 3


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


def auto_layer(bottom, view="main"):
    if view != "main":
        return 2 if bottom <= 318 else 3 if bottom <= 336 else 4 if bottom <= 352 else 5
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
        "_note": "FORGE room palette (art pass 5 uses the art pass 4 palette, 37 colours, index 255 = transparent). "
                 "LUTs: R4 = golden hour (identity, the baked art), R3 = late afternoon, R2 = midday, R1 = dawn, "
                 "NIGHT = after 10 PM for sprites without a painted night twin, DIM = room behind an open panel. "
                 "The smooth light (glows, warm wash, vignette) is not in the palette art: the engine draws it from "
                 "zones.json views.<view>.light.",
        "colors": [[n, h] for n, h in PAL],
        "categories": json.load(open(os.path.join(ROOT, "art", "room-r3", "palette.json")))["categories"],
        "luts": luts,
    }
    with open(os.path.join(HERE, "palette.json"), "w") as f:
        json.dump(out, f, indent=1)


def world_spec(spec, anims_spec):
    """A light spec in world coordinates (master - (OX, OY)), with per-frame strengths for channel glows."""
    out = {"ambient": spec["ambient"], "glows": [], "vignette": dict(spec["vignette"])}
    v = out["vignette"]
    v["x"], v["y"] = v["x"] - OX, v["y"] - OY
    v["c"] = [round(c, 3) for c in v["c"]]
    for g in spec["glows"]:
        g2 = dict(g)
        g2["x"], g2["y"] = round(g["x"] - OX, 1), round(g["y"] - OY, 1)
        if not g2.get("ch"):
            g2.pop("ch", None)
        out["glows"].append(g2)
    for i, g in enumerate(out["glows"]):
        ch = g.get("ch")
        if ch and ch in anims_spec:
            g["ak"] = anims_spec[ch]["ak"].get(i, [g["a"]] * anims_spec[ch]["n"])
    out["anims"] = {ch: {"seq": v["seq"], "fps": v["fps"]} for ch, v in anims_spec.items()}
    out["stops"] = STOPS
    out["fall"] = [round(x, 4) for x in FALL]
    out["vstops"] = VSTOPS
    return out


def drift_sprites(tod):
    """Window drift sprites (clouds tile, birds flock frames, streetcar) for the main view, in master px."""
    out = {}
    set_view("main")
    global TOD
    TOD = tod
    new_scene()
    X0, X1, Ys, Yt = WIN
    x0, y0 = pji(X0, Yt, 0)
    x1, y1 = pji(X1, Ys, 0)
    G.win = (x0, y0, x1, y1)
    ww = x1 - x0
    hz = y1 - 22
    sy = hz - 18 if TOD == "golden" else hz - 2
    span = ww + 70

    def grab(fn):
        new_scene()
        G.win = (x0, y0, x1, y1)
        with obj("piece", emit=True):
            fn()
        a = G.img.copy()
        a[G.oid == 0] = T
        return a
    out["clouds"] = (grab(lambda: [cloud(x0 - 60 + fx * span, cy, w, c, lit, dark, -9999, 9999)
                                   for fx, cy, w, c, lit, dark in cloud_list(x0, y0, x1, sy)]),
                     dict(mode="wrap", speed=CLOUD_V, span=span, clip=[x0 - OX, y0 - OY, ww + 1, y1 - y0 + 1]))
    if tod != "night":
        fr = [grab(lambda f=f: birds(x0, y0, x1, 0.0, f, clip=False)) for f in (0, 1)]
        out["birds"] = (fr, dict(mode="pass", period=BIRD_PERIOD, phase=BIRD_PHASE, span=ww + 60, ampY=6, freqY=7,
                                 clip=[x0 - OX, y0 - OY, ww + 1, y1 - y0 + 1]))
    out["tram"] = (grab(lambda: tram(x0, y1, hz, tod == "night", u=0.0, clip=False)),
                   dict(mode="pass", period=TRAM_PERIOD, phase=TRAM_PHASE, span=ww + 80, ampY=0, freqY=0,
                        clip=[x0 - OX, y0 - OY, ww + 1, y1 - y0 + 1]))
    return out


def export_view(view, manifest, used_all):
    items = {"main": live_items_main, "left": live_items_left, "right": live_items_right}[view]()
    for it in items:
        if it["kind"] != "shell" and it["id"] != "window.statue":
            for k in it["keys"]:
                if k not in ("base", "night"):
                    TAGVAR.setdefault((it["view"], k), {})[it["id"]] = k
    base = render("base", view=view)
    night = render("night", "night", view=view)
    ghost = render("ghost", ghost=True, view=view)
    ghost_n = render("ghost-night", "night", ghost=True, view=view)
    built = []
    used = {}
    for it in items:
        if it["view"] != view:
            # an item drawn in another view's scene (bed.stringlights lives in the left view)
            continue
        arrays = {}
        if it["kind"] == "shell":
            for key, r in (("base", ghost), ("night", ghost_n)):
                m = obj_mask(r, it["objs"]) if it["objs"] else np.zeros((H, W), bool)
                arrays[key] = np.where(m, r[0], T).astype(np.uint8)
        else:
            for o in it["objs"]:
                used[o] = it["id"]
            for key in it["keys"]:
                if key == "night":
                    continue
                tag, var, tier = tag_state(it, key)
                tod_r = render(tag, var=var, tier=tier, view=view) if tag != "base" else base
                tod_n = render(tag, "night", var=var, tier=tier, view=view) if tag != "base" else night
                for k2, r in ((key, tod_r), (key + ".night", tod_n)):
                    m = obj_mask(r, it["objs"]) if it["objs"] else np.zeros((H, W), bool)
                    arrays[k2] = np.where(m, r[0], T).astype(np.uint8)
            if "night" in it["keys"]:
                arrays["night"] = arrays.pop("base.night")
        built.append((it, arrays))
    # every object of the view is exported exactly once
    names = set()
    for nm, oids in base[2].items():
        if nm in SHELL_NAMES or nm == "void" or nm == "string-side-4":
            continue
        names.update([nm] if len(oids) == 1 else [f"{nm}@{k}" for k in range(len(oids))])
    missing = sorted(n for n in names - set(used) if n.split("@")[0] not in used)
    if missing:
        raise SystemExit(f"{view}: objects not exported: {missing}")

    def write(it, arrays, alias, layer=None, extra=None):
        box = union([bbox(a) for a in arrays.values()])
        if box is None:   # an empty placeholder: one transparent pixel
            box = (OX, OY, OX + 1, OY + 1)
        x0, y0, x1, y1 = box
        zone, name = it["id"].split(".", 1)
        variants = {}
        for v, a in arrays.items():
            rel = f"{SPR_DIR}/{view}/{zone}/{name}.{v}.png"
            save_png(a[y0:y1, x0:x1], os.path.join(PROTO, rel))
            variants[v] = rel
        for v, src in alias.items():
            variants[v] = variants[src]
            if src + ".night" in variants:
                variants[v + ".night"] = variants[src + ".night"]
        lay = layer if layer is not None else (it.get("layer") if it.get("layer") is not None else auto_layer(y1, view))
        rec = {"id": it["id"], "zone": it["zone"], "kind": it["kind"], "layer": int(lay), "x": x0 - OX, "y": y0 - OY,
               "w": x1 - x0, "h": y1 - y0, "variants": variants}
        if view != "main":
            rec["view"] = view
        if it["kind"] == "hotspot":
            rec["target"], rec["label"] = it["target"], it["label"]
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

    # bed.stringlights is listed with the main items (an R3 id) but drawn in the left view
    if view == "left":
        sl = next(i for i in live_items_main() if i["id"] == "bed.stringlights")
        arrays = {"base": np.where(obj_mask(base, sl["objs"]), base[0], T).astype(np.uint8),
                  "night": np.where(obj_mask(night, sl["objs"]), night[0], T).astype(np.uint8)}
        write(sl, arrays, sl["alias"])
        used["string-side-4"] = sl["id"]
    # moving lights (+ the strength of their glows per frame)
    anims_spec = {}
    for aid, zone, ch, n, seq, fps in ANIMS[view]:
        fr = {}
        ak = {}
        for tod in ("golden", "night"):
            rs = [(base if tod == "golden" else night)] + [render(f"anim-{ch}-{k}", tod, anim={ch: k}, view=view) for k in range(1, n)]
            fr[tod] = [r[0] for r in rs]
            if tod == "golden":
                for gi, g in enumerate(rs[0][6]["glows"]):
                    if g.get("ch") == ch:
                        ak[gi] = [round(float(r[6]["glows"][gi]["a"]), 3) if gi < len(r[6]["glows"]) else g["a"] for r in rs]
        m = np.zeros((H, W), bool)
        for tod in fr:
            for a in fr[tod][1:]:
                m |= a != fr[tod][0]
        if ch == "sway" and m.any():
            # whole leaf clusters around the moving pixels (inside the plants that move), not a dust of pixels
            oid = base[1]
            movers = np.unique(oid[m])
            d = m.copy()
            for _ in range(3):
                d = d | np.roll(d, 1, 0) | np.roll(d, -1, 0) | np.roll(d, 1, 1) | np.roll(d, -1, 1)
            m = d & np.isin(oid, movers)
        anims_spec[ch] = {"seq": seq, "fps": fps, "n": n, "ak": ak}
        if not m.any():
            if not ak:
                raise SystemExit(f"anim {aid}: frames do not differ")
            continue   # a light-only flicker (the overlay glow follows the channel)
        arrays = {"base": np.where(m, fr["golden"][0], T).astype(np.uint8),
                  "night": np.where(m, fr["night"][0], T).astype(np.uint8)}
        for k in range(1, n):
            arrays[f"f{k}"] = np.where(m, fr["golden"][k], T).astype(np.uint8)
            arrays[f"n{k}"] = np.where(m, fr["night"][k], T).astype(np.uint8)
        rec = write(I(aid, zone, "decor", [], view=view), arrays, {}, layer=top_layer(m) if ch != "sway" else 5)
        vv = rec["variants"]
        fk = ["base"] + [f"f{k}" for k in range(1, n)]
        nk = ["night"] + [f"n{k}" for k in range(1, n)]
        rec["anim"] = {"frames": [vv[fk[i]] for i in seq], "night": [vv[nk[i]] for i in seq], "fps": fps}
        for k in range(1, n):
            del vv[f"f{k}"], vv[f"n{k}"]
        rec["note"] = f"moving light ({ch}): anim frames over the base; anim.night over the night twin"
    extra_c = {}
    if view == "main":
        dog = r3_dog()
        dx, dy = 455, 352
        arrays = {}
        for v, a in dog.items():
            full = np.full((H, W), T, np.uint8)
            h_, w_ = a.shape
            full[dy - h_:dy, dx - w_ // 2:dx - w_ // 2 + w_] = a
            arrays[v] = full
        write(I("centre.dog", "window", "decor", []), arrays, {}, layer=4)
        # window drift: clouds, birds, streetcar (the engine moves them; see drift)
        dsp = {t: drift_sprites(t) for t in ("golden", "night")}
        for nm, zone, lay in (("clouds", "window", 0), ("birds", "window", 0), ("tram", "window", 1)):
            g = dsp["golden"].get(nm)
            n_ = dsp["night"].get(nm)
            if nm == "birds":
                arrays = {"base": g[0][0], "f1": g[0][1]}
                empty = np.full((H, W), T, np.uint8)
                arrays["night"] = empty
                rec = write(I("window." + nm, zone, "decor", []), arrays, {}, layer=lay)
                vv = rec["variants"]
                rec["anim"] = {"frames": [vv["base"], vv["f1"]], "fps": 4}
                del vv["f1"]
            else:
                rec = write(I("window." + nm, zone, "decor", []), {"base": g[0], "night": n_[0]}, {}, layer=lay)
            d = dict(g[1])
            rec["drift"] = d
            rec["note"] = {"clouds": "cloud strip, wraps across the window at drift.speed px/s",
                           "birds": "a small flock crossing every drift.period s (2-frame flap)",
                           "tram": "the red streetcar crossing every drift.period s"}[nm]
        # overlays: knight beam, close-up per tier
        beam = render("beam", var={}, beam=True)
        kn = obj_mask(beam, ["knight"])
        diff = (beam[0] != base[0]) & ~kn
        write(I("window.statue-downlight", "window", "overlay", []), {"base": np.where(diff, beam[0], T).astype(np.uint8)}, {},
              layer=top_layer(diff), extra={"note": "the ceiling beam on the knight with floating dust (after a knight click)"})
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
    for zid, (zv, nm) in ZONE_ON.items():
        if zv != view:
            continue
        m = obj_mask(base, [nm])
        ys, xs = np.nonzero(m)
        cx, cy = int(np.median(xs)), int(np.median(ys))
        zone_light[zid] = (cx - OX, cy - OY, 24)
        arrays = {}
        for key, r in (("base", base), ("night", night)):
            a = np.full((H, W), T, np.uint8)
            a[cy:cy + 2, cx:cx + 2] = r[0][cy:cy + 2, cx:cx + 2]
            arrays[key] = a
        write(I(zid + ".on", zid, "overlay", [], view=view), arrays, {}, layer=top_layer(arrays["base"] != T),
              extra={"note": "the zone's lamp point (same pixels as the art; the engine reads its position)"})
    if view == "main":
        zone_light["window"] = (int((base[5][0] + base[5][2]) / 2) - OX, int((base[5][1] + base[5][3]) / 2) - OY, 24)
    light_ = {"day": world_spec(base[6], anims_spec), "night": world_spec(night[6], anims_spec)}
    return base, night, zone_light, light_


def export_live():
    root = os.path.join(PROTO, SPR_DIR)
    if os.path.isdir(root):
        for dp, _, fs in os.walk(root):
            for f in fs:
                if f.endswith(".png"):
                    os.remove(os.path.join(dp, f))
    manifest = []
    TAGVAR.clear()
    res = {}
    for v in ("main", "left", "right"):
        res[v] = export_view(v, manifest, None)
        print(f"  view {v}: {sum(1 for r in manifest if r.get('view', 'main') == v)} items")
    ids = [r["id"] for r in manifest]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate ids: {sorted(dup)}")
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump({"part": "room-r5", "items": manifest}, f, indent=1)
    zone_light = {}
    for v in res:
        zone_light.update(res[v][2])
    with open(os.path.join(HERE, "zones.json"), "w") as f:
        json.dump(make_zones(manifest, res, zone_light), f, indent=1)
    base, night = res["main"][0], res["main"][1]
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


def make_zones(items, res, zone_light):
    AX, AY = -OX, -OY
    skills = {}
    zones = []
    CW, CH_ = CORE[2] - CORE[0], CORE[3] - CORE[1]
    for n, (zid, name) in enumerate(ZONE_NAMES, 1):
        zv = ZONE_VIEW[zid]
        hs = [i for i in items if i["zone"] == zid and i["kind"] == "hotspot" and i.get("view", "main") == zv
              and not i["id"].endswith(("-m", "-l", "-r"))]
        for i in hs:
            if "skill" in i["target"]:
                skills[i["target"]["skill"]] = zid
        boxes = [(i["hit"][0], i["hit"][1], i["hit"][0] + i["hit"][2], i["hit"][1] + i["hit"][3]) for i in hs]
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        w = min(250, max(196, (x1 - x0) + 36, ((y1 - y0) + 24) * 16 / 9))
        h = w * 9 / 16
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fx = min(max(cx - w / 2, AX), AX + W - w)
        fy = min(max(cy - h / 2, AY), AY + H - h)
        zones.append({"id": zid, "n": n, "name": name, "view": zv, "focus": [round(fx), round(fy), round(w), round(h)],
                      "stop": round(cx), "phoneStop": round(min(max(cx, 60), CW - 60)),
                      "hotspots": [i["id"] for i in hs], "territory": {"x0": round(x0), "x1": round(x1)},
                      "light": list(zone_light[zid])})
    for v in ("main", "left", "right"):
        zs = sorted([z for z in zones if z["view"] == v], key=lambda z: z["stop"])
        for a, b in zip(zs, zs[1:]):
            if a["territory"]["x1"] > b["territory"]["x0"]:
                mid = round((a["stop"] + b["stop"]) / 2)
                a["territory"]["x1"] = min(a["territory"]["x1"], mid)
                b["territory"]["x0"] = max(b["territory"]["x0"], mid)
        if zs:
            zs[0]["territory"]["x0"] = min(zs[0]["territory"]["x0"], AX)
            zs[-1]["territory"]["x1"] = max(zs[-1]["territory"]["x1"], AX + W)
    statue = next(i for i in items if i["id"] == "window.statue")
    rug_ = next(i for i in items if i["id"] == "window.rug")
    set_view("main")
    (bx0, by0), (bx1, by1) = pji(-WX, CEIL, 0), pji(WX, 0, 0)
    wx0, wy0, wx1, wy1 = res["main"][0][5]
    bt = pj(KN_X, CEIL, KN_Z)
    views = {}
    for v in ("main", "left", "right"):
        c = VIEWS[v]
        views[v] = {"art": {"x": AX, "y": AY, "w": W, "h": H}, "core": {"w": CW, "h": CH_},
                    "horizon": int(c["CY"]) - OY, "vp": [int(c["CX"]) - OX, int(c["CY"]) - OY],
                    "light": res[v][3]}
    return {
        "_note": "Art pass 5 world coordinates (art px): master (800x480) = world + (122, 116) in every view. The default "
                 "view is the 556x235 core (15% closer than pass 4's 640x270). Three views: main (the knight and the "
                 "window), left (bed, kitchen), right (dropshipping desk, gym); each item has view (default main), each "
                 "zone its view; views.<v> holds that view's frame and its smooth light (glows drawn with screen, the "
                 "vignette with multiply, falloff stops shared with art/room-r5/build.py). Keys 1-7 run kitchen..gym. "
                 "Generated by art/room-r5/build.py.",
        "art": {"x": AX, "y": AY, "w": W, "h": H},
        "core": {"w": CW, "h": CH_},
        "horizon": int(VIEWS["main"]["CY"]) - OY,
        "vp": [int(VIEWS["main"]["CX"]) - OX, int(VIEWS["main"]["CY"]) - OY],
        "camera": {"defaultZoom": 1.3, "horizonPct": round((VIEWS["main"]["CY"] - OY) / CH_, 3), "phoneDefaultX": CW // 2,
                   "turnMs": 760, "defaultZoomNote": "default view up to 1.3x closer than the 556x235 core (whole pixels)"},
        "views": views,
        "zones": zones,
        "shell": {"backWall": [bx0 - OX, by0 - OY, bx1 - OX, by1 - OY], "window": [wx0 - OX, wy0 - OY, wx1 - OX, wy1 - OY],
                  "sill": [wx0 - 7 - OX, wy1 + 1 - OY, wx1 + 7 - OX, wy1 + 6 - OY], "ceilingY": by0 - OY, "floorBackY": by1 - OY,
                  "leftWall": {"formula": "one-point camera in art/room-r5/build.py (pj): side walls at X = -17.7 / +17.7 ft"},
                  "rightWall": "mirror of leftWall about master x = 400"},
        "centre": {"statue": [statue["x"], statue["y"], statue["w"], statue["h"]], "statueContactY": statue["y"] + statue["h"],
                   "rug": [rug_["x"], rug_["y"], rug_["w"], rug_["h"]], "downlight": [int(bt[0]) - OX, int(bt[1]) - OY],
                   "dogSleep": [455 - OX, 352 - OY], "sunbeam": "glowing sun reflection on the satin floor"},
        "relics": {"relic-left": "kitchen.relic", "relic-window": "window.relic", "relic-right": "gym.relic"},
        "layers": {"_note": "L0 sky (+ cloud and bird drift), L1 outside (+ streetcar), L2 shell plates and the back wall, "
                            "L3-L5 objects by contact depth (side views: deeper cut-offs), L5 plant sway; view-scoped."},
        "skills": dict({"_note": "Every skill maps to exactly one zone; copies in other views turn to it."}, **dict(sorted(skills.items()))),
    }


if __name__ == "__main__":
    import sys
    if "--live-only" not in sys.argv:
        main()
    if "--stills-only" not in sys.argv:
        export_live()
