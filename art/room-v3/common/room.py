"""Shared kit for the FORGE room v3 art (Pixel Art Studio build scripts, deterministic).

Adapted from art/room/common/room.py (layered manifest format) and art/room-v2/build.py (the approved look:
honey-oak floor, wood paneling, beams, warm light hierarchy). Every part (shell, left, back, right,
statue-relics) has art/room-v3/<part>/build.py which paints objects with this kit and declares them with
emit(); finish(part) writes art/room-v3/<part>/manifest.json. art/room-v3/merge.py bundles everything into
docs/redesign/room-prototype/art-v3.js.

OUTPUT FRAME (the first room's): the 640x270 core is x 0..640, y 0..270; the painted art spans x -80..720,
y -96..384 (800x480). Horizon y 121, vanishing point (320, 121). The side walls are v1's raked flats:
  left wall top    y = 62 - 0.15    * (176 - x)      (back corner x 176)
  left wall bottom y = 198 + 0.19375 * (176 - x)
  right wall mirrors about x = 320; back wall x 176..464, y 62..198.

DESIGN UNITS: the build scripts place objects in feet with a one-point projection P(X, h, Z) (side walls splay
outward, X = -HALF - K (ZB - Z)) and add small offsets in design units (du). P returns du, a finer grid
centred on (480, 227); 1 du = 0.625 art px (art = (320, 121) + 0.625 (du - (480, 227))). Canvas rasterises
every shape natively at art resolution (shapes are redrawn, never resampled); text glyphs, single pixels and
1 px lines stay one art pixel, so small details come out chunky. Manifests and zones.json are in art px.

STYLE RULES (the first room's look): flat colour clusters, 2-4 tones per material, no Bayer dither on walls,
floor or objects (dither only for the sky and soft light pools, at most 2-step bands); each object is lit by
one flat light step, gets a dark 1 px outline and one light edge toward the window. merge.py rejects sprites
with too many isolated pixels or 2x2 checkerboards (grain check).
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]  # skill-trees
COMMON = Path(__file__).resolve().parent
V3 = COMMON.parent  # art/room-v3
PROTO = ROOT / "docs" / "redesign" / "room-prototype"
OUT = PROTO / "art-v3"

_studio = os.environ.get("PIXELSTUDIO") or "/home/user/skill-pack/.claude/skills/pixel-art-studio/scripts"
sys.path.insert(0, _studio)
from pixelstudio import Sprite  # noqa: E402,F401  (palette tooling; sprites are written palette-strict below)

PAL = json.loads((COMMON / "palette.json").read_text())
NAMES = [c[0] for c in PAL["colors"]]
HEXES = [c[1] for c in PAL["colors"]]
I = {n: i for i, n in enumerate(NAMES)}
RGB = np.array([[int(h[k:k + 2], 16) for k in (1, 3, 5)] for h in HEXES], np.uint8)
T = 255  # transparent index
C = type("C", (), dict(I))  # C.OAK_1 -> index
globals().update(I)  # VOID, INK, OAK_0 ... as module-level ints (from room import *)

# ------------------------------------------------------------------ frame + projection
AX, AY, AW, AH = -80, -96, 800, 480  # art frame (art px)
CORE_W, CORE_H = 640, 270  # core (art px)
DCORE_W, DCORE_H = 960, 540  # the core in design units (light field)
VX, VY = 480.0, 227.0  # vanishing point in design units
OX, OY = 320.0, 121.0  # vanishing point in art px
S = 0.625  # art px per design unit


def to_art(x, y):
    return OX + (x - VX) * S, OY + (y - VY) * S


def to_du(x, y):
    return VX + (x - OX) / S, VY + (y - OY) / S
ZB, HALF, CEIL, EYE = 48.0, 12.7, 12.0, 6.795
F = 18.13 * ZB  # back wall: 18.13 px per foot
K = (EYE / 0.19375 - HALF) / ZB  # side-wall splay; reproduces the v1 slopes


def P(X, h, Z):
    return (VX + F * X / Z, VY + F * (EYE - h) / Z)


def XL(Z):
    return -HALF - K * (ZB - Z)


def XR(Z):
    return HALF + K * (ZB - Z)


def WP(side, Z, h, off=0.0):
    """Point on a side wall at depth Z, height h; off = feet out from the wall into the room."""
    X = XL(Z) + off if side == "L" else XR(Z) - off
    return P(X, h, Z)


def wall_z(side, x):
    """Depth of the side-wall column at screen x."""
    r = (x - VX) / F
    a = -HALF - K * ZB
    return a / (r - K) if side == "L" else -a / (r + K)


BACK = (round(P(-HALF, 0, ZB)[0]), round(P(0, CEIL, ZB)[1]), round(P(HALF, 0, ZB)[0]), round(P(0, 0, ZB)[1]))  # du


def art_rect(r):
    (x0, y0), (x1, y1) = to_art(r[0], r[1]), to_art(r[2], r[3])
    return round(x0), round(y0), round(x1), round(y1)


BACK_ART = art_rect(BACK)

# ------------------------------------------------------------------ light ramps
LIGHTER = dict(VOID="INK", INK="BROWN_0", BROWN_0="BROWN_2", BROWN_1="BROWN_2", BROWN_2="OAK_0", OAK_DK="OAK_0",
               OAK_0="OAK_1", OAK_1="OAK_2", OAK_2="AMBER", AMBER="GOLD", GOLD="SUN", SUN="SUN", CREAM="CREAM",
               TERRA_0="TERRA_1", TERRA_1="TERRA_2", TERRA_2="RIM", RIM="ORANGE", ORANGE="GLOW", GLOW="SUN",
               GOLD_DK="GOLD", LEAF_0="LEAF_1", LEAF_1="LEAF_2", LEAF_2="LEAF_3", LEAF_3="LEAF_3",
               SLATE_0="SLATE_1", SLATE_1="SLATE_2", SLATE_2="CREAM", PLUM_1="PLUM_2", PLUM_2="PLUM_3",
               PLUM_3="CREAM", CRT_0="CRT_1", CRT_1="GLOW")
DARKER = dict(VOID="VOID", INK="VOID", BROWN_0="INK", BROWN_1="BROWN_0", BROWN_2="BROWN_0", OAK_DK="BROWN_0",
              OAK_0="OAK_DK", OAK_1="OAK_0", OAK_2="OAK_1", AMBER="OAK_2", GOLD="AMBER", SUN="GOLD", CREAM="SLATE_2",
              TERRA_0="BROWN_0", TERRA_1="TERRA_0", TERRA_2="TERRA_1", RIM="TERRA_2", ORANGE="RIM", GLOW="AMBER",
              GOLD_DK="OAK_DK", LEAF_0="INK", LEAF_1="LEAF_0", LEAF_2="LEAF_1", LEAF_3="LEAF_2", SLATE_0="INK",
              SLATE_1="SLATE_0", SLATE_2="SLATE_1", PLUM_1="BROWN_2", PLUM_2="PLUM_1", PLUM_3="PLUM_2",
              CRT_0="TERRA_0", CRT_1="CRT_0")
UP = np.arange(256, dtype=np.uint8)
DN = np.arange(256, dtype=np.uint8)
for n in NAMES:
    UP[I[n]] = I[LIGHTER[n]]
    DN[I[n]] = I[DARKER[n]]


def up(c, k=1):
    for _ in range(k):
        c = int(UP[c])
    return c


def dn(c, k=1):
    for _ in range(k):
        c = int(DN[c])
    return c


BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16
# art-anchored Bayer (only for the sky and soft light pools); WX/WY = design-unit position of each art pixel
_yy, _xx = np.mgrid[0:AH, 0:AW]
WX = (VX + (_xx + AX - OX) / S).astype(np.float32)
WY = (VY + (_yy + AY - OY) / S).astype(np.float32)
BAY = BAYER[(_yy + AY) % 4, (_xx + AX) % 4]
AXG = (_xx + AX).astype(np.float32)  # art px grids
AYG = (_yy + AY).astype(np.float32)


def A(x, y):
    """Author in art px: returns design units for an art-px point (frame crops, edge-anchored pieces)."""
    return to_du(x, y)


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ canvas (world coords, index image)
FONT = {
    "A": ["010", "101", "111", "101", "101"], "C": ["011", "100", "100", "100", "011"],
    "D": ["110", "101", "101", "101", "110"], "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"], "G": ["011", "100", "101", "101", "011"],
    "I": ["1", "1", "1", "1", "1"], "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
    "M": ["10001", "11011", "10101", "10001", "10001"], "N": ["1001", "1101", "1011", "1001", "1001"],
    "O": ["010", "101", "101", "101", "010"], "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
    "W": ["10001", "10001", "10101", "10101", "01010"], "·": ["0", "0", "1", "0", "0"], " ": ["0", "0", "0", "0", "0"],
}


def text_w(s):
    """Width of a label in design units (glyphs are drawn one art pixel per glyph pixel)."""
    return (sum(len(FONT[ch][0]) + 1 for ch in s) - 1) / 0.625


class Canvas:
    def __init__(self):
        self.im = Image.new("L", (AW, AH), T)
        self.d = ImageDraw.Draw(self.im)

    @staticmethod
    def q(x, y):
        return (round(OX + (x - VX) * S - AX), round(OY + (y - VY) * S - AY))

    def rect(self, x0, y0, x1, y1, c):
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1))
        self.d.rectangle([*self.q(x0, y0), *self.q(x1, y1)], fill=c)

    def poly(self, pts, c):
        self.d.polygon([self.q(x, y) for x, y in pts], fill=c)

    def line(self, x0, y0, x1, y1, c, w=1):
        self.d.line([*self.q(x0, y0), *self.q(x1, y1)], fill=c, width=max(1, round(w * S)))

    def lines(self, pts, c, w=1):
        self.d.line([self.q(x, y) for x, y in pts], fill=c, width=max(1, round(w * S)))

    def px(self, x, y, c):
        x, y = self.q(x, y)
        if 0 <= x < AW and 0 <= y < AH:
            self.im.putpixel((x, y), c)

    def ell(self, x0, y0, x1, y1, c, outline=False):
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1))
        if outline:
            self.d.ellipse([*self.q(x0, y0), *self.q(x1, y1)], outline=c)
        else:
            self.d.ellipse([*self.q(x0, y0), *self.q(x1, y1)], fill=c)

    def disc(self, cx, cy, r, c):
        """Filled disc; r in design units (drawn natively at art resolution, at least 1 px)."""
        px_, py_ = self.q(cx, cy)
        rr = max(1, round(r * S))
        for y in range(-rr, rr + 1):
            w = int(math.sqrt(max(0, rr * rr - y * y + rr * 0.8)))
            self.d.line([(px_ - w, py_ + y), (px_ + w, py_ + y)], fill=c)

    def text(self, x, y, s, c):
        """Pixel font at native art size (one glyph pixel = one art pixel). Returns the end x in du."""
        px_, py_ = self.q(x, y)
        for ch in s:
            rows = FONT.get(ch, FONT[" "])
            for j, row in enumerate(rows):
                for i, b in enumerate(row):
                    if b == "1" and 0 <= px_ + i < AW and 0 <= py_ + j < AH:
                        self.im.putpixel((px_ + i, py_ + j), c)
            px_ += len(rows[0]) + 1
        return x + (text_w(s) + 1) / S

    def arr(self):
        return np.array(self.im)

    def set(self, a):
        self.im = Image.fromarray(a.astype(np.uint8))
        self.d = ImageDraw.Draw(self.im)

    def dither(self, pts, c, density=0.5, soft=False):
        """Shadow/tint polygon. Style rule: flat fill (no checkerboard) when density >= 0.35, nothing below.
        soft=True keeps a real Bayer pattern (sky and light pools only)."""
        m = Image.new("1", (AW, AH), 0)
        ImageDraw.Draw(m).polygon([self.q(x, y) for x, y in pts], fill=1)
        mm = np.array(m, bool) & ((BAY < density) if soft else np.bool_(density >= 0.35))
        a = self.arr()
        a[mm] = c
        self.set(a)


# ------------------------------------------------------------------ 3D-ish primitives
def quad(cv, pts, c):
    cv.poly(pts, c)


def wquad(cv, side, z0, z1, h0, h1, c, off=0.0):
    pts = [WP(side, z0, h1, off), WP(side, z1, h1, off), WP(side, z1, h0, off), WP(side, z0, h0, off)]
    cv.poly(pts, c)
    return pts


def fquad(cv, X0, X1, Z0, Z1, c, h=0.0):
    pts = [P(X0, h, Z1), P(X1, h, Z1), P(X1, h, Z0), P(X0, h, Z0)]
    cv.poly(pts, c)
    return pts


def box(cv, X0, X1, h0, h1, Z0, Z1, top, front, side):
    """Axis-aligned box (Z0 = near face). Draws the faces the camera sees."""
    if h1 < EYE:
        cv.poly([P(X0, h1, Z0), P(X1, h1, Z0), P(X1, h1, Z1), P(X0, h1, Z1)], top)
    if h0 > EYE:
        cv.poly([P(X0, h0, Z0), P(X1, h0, Z0), P(X1, h0, Z1), P(X0, h0, Z1)], side)
    if X0 > 0:
        cv.poly([P(X0, h0, Z0), P(X0, h0, Z1), P(X0, h1, Z1), P(X0, h1, Z0)], side)
    if X1 < 0:
        cv.poly([P(X1, h0, Z0), P(X1, h0, Z1), P(X1, h1, Z1), P(X1, h1, Z0)], side)
    cv.poly([P(X0, h0, Z0), P(X1, h0, Z0), P(X1, h1, Z0), P(X0, h1, Z0)], front)


def wbox(cv, side, z0, z1, d, h0, h1, top, face, end, o0=0.0):
    """Box against a side wall: depth z0..z1 (z0 = near end), from o0 to d feet out of the wall."""
    if h1 < EYE:
        cv.poly([WP(side, z0, h1, o0), WP(side, z0, h1, d), WP(side, z1, h1, d), WP(side, z1, h1, o0)], top)
    cv.poly([WP(side, z0, h0, d), WP(side, z1, h0, d), WP(side, z1, h1, d), WP(side, z0, h1, d)], face)
    cv.poly([WP(side, z0, h0, o0), WP(side, z0, h0, d), WP(side, z0, h1, d), WP(side, z0, h1, o0)], end)


def shadow(cv, X0, X1, Z0, Z1, density=0.5, c=None):
    """Soft contact shadow on the floor (dithered)."""
    cv.dither([P(X0, 0, Z1), P(X1, 0, Z1), P(X1, 0, Z0), P(X0, 0, Z0)], OAK_DK if c is None else c, density)


def wshadow(cv, side, z0, z1, d, density=0.5):
    cv.dither([WP(side, z0, 0, -0.05), WP(side, z1, 0, -0.05), WP(side, z1, 0, d), WP(side, z0, 0, d)], OAK_DK, density)


def leafy(cv, x, y, n, spread, seed, cols=None, size=(5, 9), up_bias=-1.6, reach=(14, 40)):
    """A clump of leaves on stems from (x, y)."""
    cols = cols or (LEAF_1, LEAF_2, LEAF_1, LEAF_3)
    r = rng(seed)
    for k in range(n):
        ang = up_bias + r.uniform(-spread, spread)
        ln = r.uniform(*reach)
        ex, ey = x + math.cos(ang) * ln, y + math.sin(ang) * ln
        cv.line(x, y, ex, ey, LEAF_0)
        lw = r.uniform(*size)
        lh = lw * 0.55
        cv.ell(ex - lw, ey - lh, ex + lw, ey + lh, LEAF_0)
        cv.ell(ex - lw + 1, ey - lh, ex + lw - 1, ey + lh - 1, cols[k % len(cols)])
        cv.line(ex - lw + 2, ey, ex + lw - 2, ey - 1, LEAF_0)
        cv.px(ex - lw * 0.4, ey - lh * 0.5, LEAF_3)


def pot(cv, x, y, w, h, c=TERRA_1):
    cv.poly([(x - w, y - h), (x + w, y - h), (x + w - 2, y), (x - w + 2, y)], c)
    cv.rect(x - w - 1, y - h - 2, x + w + 1, y - h, up(c))
    cv.line(x + w - 3, y - h + 1, x + w - 4, y - 1, dn(c))


# ------------------------------------------------------------------ light field (world, golden hour)
WIN = (-0.6, 6.6, 2.9, 9.2)  # window X0, X1, h0 (sill), h1 (head) on the back wall
WIN_RECT = (round(P(WIN[0], 0, ZB)[0]), round(P(0, WIN[3], ZB)[1]), round(P(WIN[1], 0, ZB)[0]), round(P(0, WIN[2], ZB)[1]))


def pool(x, y, rx, ry, amt):
    dd = np.sqrt(((WX - x) / rx) ** 2 + ((WY - y) / ry) ** 2)
    return np.clip(1.0 - dd, 0, 1) * amt


def _mask(pts):
    m = Image.new("1", (AW, AH), 0)
    ImageDraw.Draw(m).polygon([Canvas.q(x, y) for x, y in pts], fill=1)
    return np.array(m, bool)


SUN_PATCH = [P(-0.4, 0, 45.5), P(6.4, 0, 45.5), P(3.8, 0, 30.0), P(-4.6, 0, 30.0)]
SUN_MULLION = [P(2.7, 0, 45.5), P(3.2, 0, 45.5), P(0.0, 0, 30.0), P(-0.5, 0, 30.0)]
_LF = {}


def light_field(night=False):
    if night in _LF:
        return _LF[night]
    L = np.zeros((AH, AW), np.float32)
    L -= 0.55
    L -= np.clip((210 - WY) / 300, 0, 1) * 0.6  # ceiling falls off
    # vignette: outer 15% of the core gently, the bleed strongly
    # vignette in art px: outer band of the core gently, the bleed strongly
    vx = np.clip(np.maximum(90 - AXG, AXG - (CORE_W - 90)) / 90, 0, 1)
    vy = np.clip(np.maximum(40 - AYG, AYG - (CORE_H - 40)) / 40, 0, 1)
    L -= np.minimum(np.hypot(vx, vy), 1) * 0.75  # rounded corners, so the light bands never form a box
    bx = np.clip(np.maximum(-AXG, AXG - CORE_W) / 80, 0, 1)
    by = np.clip(np.maximum(-AYG, AYG - CORE_H) / 110, 0, 1)
    L -= np.minimum(np.hypot(bx, by), 1) * 1.2
    wx0, wy0, wx1, wy1 = WIN_RECT
    cxw, cyw = (wx0 + wx1) / 2, (wy0 + wy1) / 2
    if not night:
        sun = _mask(SUN_PATCH) & ~_mask(SUN_MULLION)
        L += np.where(sun, 2.4, 0)
        d = np.sqrt(((WX - cxw) / 210) ** 2 + ((WY - cyw) / 150) ** 2)
        L += np.clip(1.0 - d, 0, 1) * 1.5  # warm wash around the window
        sk = P(0.9, 0, 40.0)
        L += pool(sk[0], sk[1], 70, 16, 0.7)  # skylight on the floor
    else:
        moon = _mask([P(0.2, 0, 45.5), P(5.4, 0, 45.5), P(3.0, 0, 33.0), P(-3.2, 0, 33.0)])
        L += np.where(moon, 0.9, 0)
        d = np.sqrt(((WX - cxw) / 160) ** 2 + ((WY - cyw) / 110) ** 2)
        L += np.clip(1.0 - d, 0, 1) * 0.6
        L -= 0.35
    # mid lights (radius <= 24 px): CRTs, plasma globe, niche, LED clusters
    for (x, y) in MID_LIGHTS:
        L += pool(x, y, 24, 24, 0.9)
    # lamp pools (soft, low)
    for (x, y, rx, ry, amt) in LAMP_POOLS:
        L += pool(x, y, rx, ry, amt)
    _LF[night] = L
    return L


MID_LIGHTS: list = []  # filled below once objects are placed (positions in world px)
LAMP_POOLS: list = []


def _init_lights():
    crt = P(6.4, 3.6, 46.4)
    MID_LIGHTS.extend([(crt[0], crt[1] + 20), WP("L", 45.6, 4.6, 0.45), (P(3.0, 10.4, ZB)[0], P(0, 10.4, ZB)[1]),
                       WP("R", 44.0, 4.0, 1.4)])
    for X, Z, h in ((-10.2, 44.5, 0.0), (9.6, 46.0, 2.7)):
        x, y = P(X, h, Z)
        LAMP_POOLS.append((x, y, 46, 22, 0.8))


_init_lights()


def apply_light(a, night=False, extra=None, flat=False):
    """Light an index image. Default: flat bands (round the light field, no dither). flat=True: one light
    step for the whole sprite (the median over its pixels), so objects read as flat colour clusters; an
    extra (glow) field still adds its own rounded bands on top."""
    L = light_field(night)
    m = a != T
    if flat and m.any():
        base = float(np.median(L[m]))
        steps = np.full(a.shape, int(np.clip(np.floor(base + 0.5), -2, 2)), np.int32)
        if extra is not None:
            steps = steps + np.floor(extra + 0.5).astype(np.int32)
        steps = np.clip(steps, -3, 3)
    else:
        if extra is not None:
            L = L + extra
        steps = np.clip(np.floor(L + 0.5), -3, 3).astype(np.int32)
    out = a.copy()
    for k in range(3):
        u = m & (steps > k)
        out[u] = UP[out[u]]
        d = m & (steps < -k)
        out[d] = DN[out[d]]
    return out


def rimlight(a, side):
    """The first room's edge treatment: one light edge toward the window (and the top), a dark 1 px outline
    (two steps darker) on every other outer edge."""
    m = a != T
    out = a.copy()
    top = m & ~np.roll(m, 1, 0)
    bot = m & ~np.roll(m, -1, 0)
    lft = m & ~np.roll(m, 1, 1)
    rgt = m & ~np.roll(m, -1, 1)
    lit = top | (rgt if side == "right" else lft if side == "left" else np.zeros_like(m))
    edge = top | bot | lft | rgt
    dark = edge & ~lit
    out[dark] = DN[DN[a[dark]]]
    out[lit] = UP[a[lit]]
    return out


# ------------------------------------------------------------------ output
_items: list[dict] = []
_part = {"name": None}


def check_png(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    allowed = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in HEXES}
    arr = np.array(im)
    if not np.isin(arr[..., 3], (0, 255)).all():
        raise ValueError(f"{path}: semi-transparent pixel")
    op = arr[arr[..., 3] == 255][:, :3]
    bad = {tuple(p) for p in np.unique(op, axis=0)} - allowed if len(op) else set()
    if bad:
        raise ValueError(f"{path}: off-palette {sorted(bad)[:5]}")


def save_arr(a, rel):
    path = OUT / f"{rel}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    rgba = np.zeros(a.shape + (4,), np.uint8)
    m = a != T
    rgba[m, :3] = RGB[a[m]]
    rgba[m, 3] = 255
    Image.fromarray(rgba, "RGBA").save(path)
    check_png(path)
    return f"art-v3/{rel}.png"


def auto_led(a):
    """Pick the bottom-right-most fully opaque 3x3 spot of the sprite (top-left world px of the LED)."""
    m = a != T
    ok = m.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            ok &= np.roll(np.roll(m, -dy, 0), -dx, 1)
    ys, xs = np.nonzero(ok)
    if not len(ys):
        ys, xs = np.nonzero(m)
    k = int(np.argmax(xs * 0.6 + ys))
    return int(xs[k]), int(ys[k])


def side_of(x0, x1):
    cx = (x0 + x1) / 2
    return "right" if cx < 330 else "left" if cx > 640 else "top"


def emit(id, *, zone, kind, layer, paint, variants=("base",), target=None, label=None, led=None, hit=None,
         light=True, rim=True, note="", night_light=None, anim=None, contact=None, extra=None):
    """Paint every variant with paint(cv, variant), light it, crop all to the union box, save and declare.

    led: None = automatic on the sprite; (x, y) world px. hit: (x0, y0, x1, y1) world rect or None.
    anim: {"frames": [painter...], "fps": n} painters take cv. extra: callable(variant) -> extra light array.
    """
    assert kind in ("hotspot", "decor", "shell", "overlay"), kind
    arrs = {}
    painters = [(v, (lambda cv, v=v: paint(cv, v))) for v in variants]
    if anim:
        painters += [(f"f{i}", fr) for i, fr in enumerate(anim["frames"])]
    for v, fn in painters:
        cv = Canvas()
        fn(cv)
        a = cv.arr()
        if (a != T).any():
            ys, xs = np.nonzero(a != T)
            sd = side_of(*to_du(xs.min() + AX, 0)[:1], *to_du(xs.max() + AX, 0)[:1])
            if light:
                ex = extra(v) if extra else None
                a = apply_light(a, night=(v == "night"), extra=ex, flat=(contact != "top"))
            if rim:
                a = rimlight(a, sd)
        arrs[v] = a
    union = np.zeros((AH, AW), bool)
    for a in arrs.values():
        union |= a != T
    if not union.any():
        raise ValueError(f"{id}: empty sprite")
    ys, xs = np.nonzero(union)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    base = id.replace(".", "/", 1)
    paths = {}
    for v, a in arrs.items():
        paths[v] = save_arr(a[y0:y1, x0:x1], f"{base}.{v}")
    var = {v: paths[v] for v in variants}
    var.setdefault("base", paths[variants[0]])
    an = {"frames": [paths[f"f{i}"] for i in range(len(anim["frames"]))], "fps": anim["fps"]} if anim else None
    wx, wy = int(x0 + AX), int(y0 + AY)
    # led / hit / contact arrive in design units; manifests are in art px
    if led is not None:
        led = tuple(round(v) for v in to_art(*led))
    if hit is not None:
        hit = art_rect(hit)
    if contact == "top":  # flat floor pieces (rugs, mats) sort behind whatever stands on them
        contact = wy
    elif contact is not None:
        contact = round(to_art(0, contact)[1])
    if kind == "hotspot":
        assert target and label, id
        if led is None:
            a0 = arrs[variants[0]][y0:y1, x0:x1]
            lx, ly = auto_led(a0)
            led = (wx + lx, wy + ly)
        bx = hit or (wx, wy, wx + int(x1 - x0), wy + int(y1 - y0))
        cb = (max(0, bx[0]), max(0, bx[1]), min(CORE_W, bx[2]), min(CORE_H, bx[3]))
        inside = max(0, cb[2] - cb[0]) * max(0, cb[3] - cb[1]) / max(1, (bx[2] - bx[0]) * (bx[3] - bx[1]))
        assert inside >= 0.7, f"{id}: hotspot mostly outside the core {bx}"
        if cb != tuple(bx):
            hit = cb  # clip the hit box to the core
        assert 0 <= led[0] < CORE_W and 0 <= led[1] < CORE_H, f"{id}: LED outside the core"
    item = dict(id=id, zone=zone, kind=kind, layer=layer, x=wx, y=wy, w=int(x1 - x0), h=int(y1 - y0), variants=var,
                target=target, label=label, led=[int(led[0]), int(led[1])] if led else None,
                hit=[int(hit[0]), int(hit[1]), int(hit[2] - hit[0]), int(hit[3] - hit[1])] if hit else None,
                anim=an, contact=contact, note=note)
    _items.append({k: v for k, v in item.items() if v not in (None, "")})
    return item


def layer_for_z(Z):
    return 2 if Z >= 44 else 3 if Z >= 40 else 4 if Z >= 35 else 5


def finish(part: str) -> None:
    out = V3 / part / "manifest.json"
    out.write_text(json.dumps({"part": part, "items": _items}, indent=1))
    hot = sum(1 for i in _items if i["kind"] == "hotspot")
    dec = sum(1 for i in _items if i["kind"] == "decor")
    print(f"{part}: {len(_items)} items ({hot} hotspots, {dec} decor)")
