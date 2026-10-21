"""FORGE v3 room v2: master scene at 960x540 (Pixel Art Studio, deterministic).

Paints the whole room as palette indices on one 960x540 grid (one-point perspective, side walls angled
toward the viewer like stage flats), runs an ordered-dither light pass (lighten/darken along hand-made
ramps), then exports through Sprite.save_png:
  docs/redesign/room-v2/stills/full-room.png (+@2x)       downlight OFF, niche empty
  docs/redesign/room-v2/stills/window-zone.png (+@2x)     same art, downlight ON + relic, crop 512x288
  docs/redesign/room-v2/stills/preview-gray.png           grayscale test
  art/room-v2/objects.json                                every object's rect in internal pixels
Palette = common/palette.json with the 4 swaps in palette-proposal.json (honey-oak wood tones).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "art" / "room" / "common"))
import room  # noqa: E402  (palette + pixel-studio Sprite)

OUT = ROOT / "docs" / "redesign" / "room-v2" / "stills"
W, H = 960, 540

# ------------------------------------------------------------------ palette (32, with 4 oak swaps)
SWAPS = {
    "INK_COOL": ("OAK_0", "#5C3721"),
    "ROSE_0": ("OAK_1", "#7E4C27"),
    "ROSE_1": ("OAK_2", "#A56A32"),
    "PLUM_0": ("OAK_DK", "#45291A"),
}
NAMES, HEXES = [], []
for name, hexv, _ in room.PAL["colors"]:
    if name in SWAPS:
        name, hexv = SWAPS[name]
    NAMES.append(name)
    HEXES.append(hexv)
I = {n: i for i, n in enumerate(NAMES)}
RGB = np.array([[int(h[k:k + 2], 16) for k in (1, 3, 5)] for h in HEXES], np.uint8)
g = globals()
for n, i in I.items():
    g[n] = i

LIGHTER = dict(VOID="INK", INK="BROWN_0", BROWN_0="BROWN_2", BROWN_1="BROWN_2", BROWN_2="OAK_0", OAK_DK="OAK_0",
               OAK_0="OAK_1", OAK_1="OAK_2", OAK_2="AMBER", AMBER="GOLD", GOLD="SUN", SUN="SUN", CREAM="CREAM",
               TERRA_0="TERRA_1", TERRA_1="TERRA_2", TERRA_2="RIM", RIM="ORANGE", ORANGE="GLOW", GLOW="SUN",
               GOLD_DK="GOLD", LEAF_0="LEAF_1", LEAF_1="LEAF_2", LEAF_2="LEAF_3", LEAF_3="LEAF_3",
               SLATE_0="SLATE_1", SLATE_1="SLATE_2", SLATE_2="CREAM", PLUM_1="PLUM_2", PLUM_2="PLUM_3",
               PLUM_3="CREAM", CRT_0="CRT_1", CRT_1="GLOW")
DARKER = dict(VOID="VOID", INK="VOID", BROWN_0="INK", BROWN_1="BROWN_0", BROWN_2="BROWN_0", OAK_DK="BROWN_0",
              OAK_0="OAK_DK", OAK_1="OAK_0", OAK_2="OAK_1", AMBER="OAK_2", GOLD="AMBER", SUN="GOLD", CREAM="AMBER",
              TERRA_0="BROWN_0", TERRA_1="TERRA_0", TERRA_2="TERRA_1", RIM="TERRA_2", ORANGE="RIM", GLOW="AMBER",
              GOLD_DK="OAK_DK", LEAF_0="INK", LEAF_1="LEAF_0", LEAF_2="LEAF_1", LEAF_3="LEAF_2", SLATE_0="INK",
              SLATE_1="SLATE_0", SLATE_2="SLATE_1", PLUM_1="BROWN_2", PLUM_2="PLUM_1", PLUM_3="PLUM_2",
              CRT_0="TERRA_0", CRT_1="CRT_0")
LUT_UP = np.array([I[LIGHTER[n]] for n in NAMES], np.uint8)
LUT_DN = np.array([I[DARKER[n]] for n in NAMES], np.uint8)
BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16
BAY = np.tile(BAYER, (H // 4 + 1, W // 4 + 1))[:H, :W]

# ------------------------------------------------------------------ projection (feet -> pixels)
F, VX, VY, EYE = 572.0, 480.0, 227.0, 5.5   # horizon at 42% (227/540)
ZB, HALF, CEIL, K = 26.0, 12.73, 12.0, 0.36  # back wall depth, half width, ceiling, side-wall inward angle


def P(X, h, Z):
    return (VX + F * X / Z, VY + F * (EYE - h) / Z)


def XL(Z):
    return -HALF + K * (ZB - Z)


def XR(Z):
    return HALF - K * (ZB - Z)


def WP(side, Z, h, off=0.0):
    """Point on a side wall (off = feet out from the wall into the room)."""
    X = XL(Z) + off if side == "L" else XR(Z) - off
    return P(X, h, Z)


# ------------------------------------------------------------------ canvas
class Canvas:
    def __init__(self):
        self.im = Image.new("L", (W, H), VOID)
        self.d = ImageDraw.Draw(self.im)
        self.objects: dict[str, list[int]] = {}

    def rect(self, x0, y0, x1, y1, c):
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1))
        self.d.rectangle([round(x0), round(y0), round(x1), round(y1)], fill=c)

    def poly(self, pts, c):
        self.d.polygon([(round(x), round(y)) for x, y in pts], fill=c)

    def line(self, x0, y0, x1, y1, c):
        self.d.line([round(x0), round(y0), round(x1), round(y1)], fill=c)

    def px(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.im.putpixel((round(x), round(y)), c)

    def ell(self, x0, y0, x1, y1, c, fill=True):
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1))
        if fill:
            self.d.ellipse([round(x0), round(y0), round(x1), round(y1)], fill=c)
        else:
            self.d.ellipse([round(x0), round(y0), round(x1), round(y1)], outline=c)

    def disc(self, cx, cy, r, c):
        for y in range(-r, r + 1):
            w = int(math.sqrt(r * r - y * y + r * 0.8))
            self.d.line([cx - w, cy + y, cx + w, cy + y], fill=c)

    def obj(self, name, x0, y0, x1, y1):
        self.objects[name] = [max(0, round(x0)), max(0, round(y0)), min(W, round(x1)) - max(0, round(x0)),
                              min(H, round(y1)) - max(0, round(y0))]

    def text(self, x, y, s, c):
        for ch in s:
            rows = FONT.get(ch, FONT[" "])
            for j, row in enumerate(rows):
                for i, b in enumerate(row):
                    if b == "1":
                        self.px(x + i, y + j, c)
            x += len(rows[0]) + 1
        return x


FONT = {
    "I": ["1", "1", "1", "1", "1"], "F": ["111", "100", "110", "100", "100"], "O": ["111", "101", "101", "101", "111"],
    "R": ["110", "101", "110", "101", "101"], "G": ["111", "100", "101", "101", "111"],
    "E": ["111", "100", "110", "100", "111"], "D": ["110", "101", "101", "101", "110"],
    "W": ["10001", "10001", "10101", "10101", "01010"], "L": ["100", "100", "100", "100", "111"],
    "C": ["111", "100", "100", "100", "111"], "M": ["10001", "11011", "10101", "10001", "10001"],
    "·": ["0", "0", "1", "0", "0"], " ": ["0", "0", "0", "0", "0"],
}


def quad(cv, a, b, c_, d, col):
    cv.poly([a, b, c_, d], col)


def wquad(cv, side, z0, z1, h0, h1, col, off=0.0):
    pts = [WP(side, z0, h1, off), WP(side, z1, h1, off), WP(side, z1, h0, off), WP(side, z0, h0, off)]
    cv.poly(pts, col)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def box(cv, X0, X1, h0, h1, Z0, Z1, top, front, side, rec=None):
    """Axis-aligned box; draws the faces the camera sees. Returns screen bbox."""
    pts = []
    if h1 < EYE:
        f = [P(X0, h1, Z0), P(X1, h1, Z0), P(X1, h1, Z1), P(X0, h1, Z1)]
        cv.poly(f, top); pts += f
    if X0 > 0:
        f = [P(X0, h0, Z0), P(X0, h0, Z1), P(X0, h1, Z1), P(X0, h1, Z0)]
        cv.poly(f, side); pts += f
    if X1 < 0:
        f = [P(X1, h0, Z0), P(X1, h0, Z1), P(X1, h1, Z1), P(X1, h1, Z0)]
        cv.poly(f, side); pts += f
    f = [P(X0, h0, Z0), P(X1, h0, Z0), P(X1, h1, Z0), P(X0, h1, Z0)]
    cv.poly(f, front); pts += f
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    bb = (min(xs), min(ys), max(xs), max(ys))
    if rec:
        cv.obj(rec, *bb)
    return bb


def wbox(cv, side, z0, z1, d, h0, h1, top, front, inner, rec=None):
    """Box standing against a side wall: depth z0..z1 (z1 > z0), sticking d feet out of the wall."""
    pts = []
    if h1 < EYE:
        f = [WP(side, z0, h1), WP(side, z0, h1, d), WP(side, z1, h1, d), WP(side, z1, h1)]
        cv.poly(f, top); pts += f
    f = [WP(side, z0, h0, d), WP(side, z1, h0, d), WP(side, z1, h1, d), WP(side, z0, h1, d)]
    cv.poly(f, inner); pts += f
    f = [WP(side, z0, h0), WP(side, z0, h0, d), WP(side, z0, h1, d), WP(side, z0, h1)]
    cv.poly(f, front); pts += f
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    bb = (min(xs), min(ys), max(xs), max(ys))
    if rec:
        cv.obj(rec, *bb)
    return bb


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ shell
def sky(cv, x0, y0, x1, y1):
    """Golden-hour New Orleans view through the window rect (screen)."""
    bands = [(PLUM_1, 0.0), (TERRA_1, 0.16), (TERRA_2, 0.3), (RIM, 0.44), (ORANGE, 0.58), (GLOW, 0.72)]
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0))
        col = bands[0][0]
        for k, (c, s) in enumerate(bands):
            if t >= s:
                col = c
                nxt = bands[k + 1][1] if k + 1 < len(bands) else 2
                if (nxt - t) < 0.05 and BAYER[y % 4][0] > 0.5:
                    col = bands[min(k + 1, len(bands) - 1)][0]
        cv.line(x0, y, x1, y, col)
    # streaky clouds
    r = rng(4)
    for k in range(9):
        cy = y0 + 10 + int(r.integers(0, (y1 - y0) // 2))
        cx = x0 + int(r.integers(-20, x1 - x0))
        ln = int(r.integers(14, 40))
        cv.line(cx, cy, cx + ln, cy, GLOW if cy > y0 + 30 else RIM)
        cv.line(cx + 4, cy + 1, cx + ln - 6, cy + 1, TERRA_2)
    sx, sy = x0 + int((x1 - x0) * 0.62), y0 + int((y1 - y0) * 0.62)
    cv.disc(sx, sy, 15, GLOW)
    cv.disc(sx, sy, 13, SUN)
    cv.disc(sx - 3, sy - 3, 6, CREAM)
    # live oaks far, shotgun houses, near oaks
    hz = y0 + int((y1 - y0) * 0.70)
    for k in range(0, x1 - x0 + 10, 3):
        x = x0 + k
        hh = int(4 + 3 * math.sin(k * 0.21) + 2 * math.sin(k * 0.57))
        cv.line(x, hz - hh, x + 2, hz - hh, LEAF_1)
        cv.rect(x, hz - hh + 1, x + 2, y1, LEAF_0)
    r = rng(7)
    x = x0 - 6
    while x < x1:
        w = int(r.integers(12, 20))
        hgt = int(r.integers(10, 16))
        base = hz + 14
        cv.rect(x, base - hgt, x + w, y1, SLATE_0)
        cv.poly([(x - 1, base - hgt), (x + w // 2, base - hgt - w // 2), (x + w + 1, base - hgt)], SLATE_0)
        cv.line(x + w // 2, base - hgt - w // 2, x + w + 1, base - hgt, SLATE_1)  # sun-side roof edge
        for wx in range(x + 3, x + w - 2, 5):
            cv.rect(wx, base - hgt + 4, wx + 1, base - hgt + 6, GLOW if (wx // 5) % 3 == 0 else INK)
        x += w + int(r.integers(1, 4))
    # streetcar on the neutral ground
    ty = hz + 20
    tx = x0 + int((x1 - x0) * 0.18)
    cv.rect(x0, ty + 9, x1, y1, LEAF_0)
    cv.rect(tx, ty, tx + 34, ty + 9, CRT_0)
    cv.rect(tx, ty, tx + 34, ty, TERRA_0)
    for wx in range(tx + 3, tx + 32, 5):
        cv.rect(wx, ty + 2, wx + 2, ty + 4, GLOW)
    cv.line(tx + 17, ty, tx + 22, ty - 6, INK)
    cv.line(x0, ty - 7, x1, ty - 7, INK)
    # power lines + pole
    px_ = x0 + int((x1 - x0) * 0.82)
    cv.line(px_, y0 + 20, px_, y1, INK)
    cv.line(px_ - 6, y0 + 24, px_ + 6, y0 + 24, INK)
    for k, (a, b) in enumerate([(y0 + 40, y0 + 25), (y0 + 46, y0 + 31), (y0 + 30, y0 + 24)]):
        for xx in range(x0, px_):
            t = (xx - x0) / max(1, px_ - x0)
            cv.px(xx, a + (b - a) * t + 5 * math.sin(math.pi * t), INK)
    # big near oak in the right pane top
    r = rng(11)
    for k in range(160):
        cx = x1 - int(abs(r.normal(0, 18)))
        cy = y0 + int(abs(r.normal(0, 22)))
        cv.rect(cx, cy, cx + 2, cy + 1, LEAF_0 if k % 3 else LEAF_1)
    for k in range(30):
        cx = x1 - int(abs(r.normal(0, 16)))
        cy = y0 + int(abs(r.normal(0, 20)))
        cv.px(cx, cy, GLOW)


def shell(cv):
    bx0, by0 = P(-HALF, CEIL, ZB)
    bx1, by1 = P(HALF, 0, ZB)
    # ceiling (wood boards toward the VP)
    cv.poly([(bx0, by0), (bx1, by0), WP("R", 4, CEIL), WP("L", 4, CEIL)], BROWN_0)
    for X in np.arange(-HALF, HALF, 1.0):
        a, b = P(X, CEIL, ZB), P(X, CEIL, 10)
        cv.line(*a, *b, INK)
    # walls: paneling
    for side in "LR":
        cv.poly([WP(side, ZB, CEIL), WP(side, 3, CEIL), WP(side, 3, 0), WP(side, ZB, 0)], OAK_DK)
        z = ZB
        k = 0
        while z > 4:
            z2 = z - 0.55
            if k % 3 == 1:
                wquad(cv, side, z2, z, 0.0, CEIL, BROWN_2)
            a, b = WP(side, z, 0.0), WP(side, z, CEIL)
            cv.line(*a, *b, BROWN_0)
            z, k = z2, k + 1
        wquad(cv, side, 3, ZB, 0, 0.45, BROWN_0)          # baseboard
        wquad(cv, side, 3, ZB, 0.45, 0.55, OAK_0)
        wquad(cv, side, 3, ZB, 3.2, 3.35, OAK_0)          # chair rail
        wquad(cv, side, 3, ZB, 11.5, 12.0, BROWN_0)       # crown
    cv.rect(bx0, by0, bx1, by1, OAK_DK)
    X, k = -HALF, 0
    while X < HALF:
        x0 = P(X, 0, ZB)[0]
        x1 = P(X + 0.55, 0, ZB)[0]
        if k % 3 == 1:
            cv.rect(x0, by0, x1, by1, BROWN_2)
        cv.line(x0, by0, x0, by1, BROWN_0)
        X, k = X + 0.55, k + 1
    cv.rect(bx0, P(0, 0.45, ZB)[1], bx1, by1, BROWN_0)
    cv.rect(bx0, P(0, 0.55, ZB)[1], bx1, P(0, 0.45, ZB)[1], OAK_0)
    cv.rect(bx0, P(0, 3.35, ZB)[1], bx1, P(0, 3.2, ZB)[1], OAK_0)
    cv.rect(bx0, by0, bx1, P(0, 11.5, ZB)[1], BROWN_0)
    cv.obj("back_wall", bx0, by0, bx1, by1)
    # floor: honey-oak planks running toward the statue / window
    zf = 6.0
    cv.poly([P(XL(ZB), 0, ZB), P(XR(ZB), 0, ZB), P(XR(zf), 0, zf), P(XL(zf), 0, zf)], OAK_1)
    r = rng(1)
    pw = 0.42
    X = -HALF
    n = 0
    while X < HALF:
        off = (n * 2.7) % 8.0
        zs = [ZB]
        z = ZB - off - 1.0
        while z > zf:
            zs.append(z)
            z -= 8.0
        zs.append(zf)
        for a, b in zip(zs, zs[1:]):
            tone = [OAK_1, OAK_1, OAK_0, OAK_1, OAK_2][int(r.integers(0, 5))]
            cv.poly([P(X, 0, a), P(X + pw, 0, a), P(X + pw, 0, b), P(X, 0, b)], tone)
            # grain: two wobbly streaks per board
            for gi in range(2):
                gx = X + pw * (0.3 + 0.4 * gi) + r.uniform(-0.05, 0.05)
                za = a - r.uniform(0.3, 1.5)
                zb_ = max(b, za - r.uniform(1.5, 5))
                p0, p1 = P(gx, 0, za), P(gx + r.uniform(-0.04, 0.04), 0, zb_)
                gcol = OAK_0 if tone != OAK_0 else OAK_DK
                if p1[1] - p0[1] > 3:
                    cv.line(*p0, *p1, gcol)
            if r.random() < 0.12:  # knot
                kz = r.uniform(b, a)
                kx, ky = P(X + pw / 2, 0, kz)
                if ky > 330:
                    cv.ell(kx - 2, ky - 1, kx + 1, ky + 1, OAK_DK)
            p, q = P(X, 0, b), P(X + pw, 0, b)
            cv.line(*p, *q, OAK_DK)  # end joint
        cv.line(*P(X, 0, ZB), *P(X, 0, zf), OAK_DK)
        X += pw
        n += 1
    # clip floor outside the angled walls (repaint wall bottoms)
    for side in "LR":
        edge = 0 if side == "L" else W
        cv.poly([WP(side, ZB, 0), WP(side, 3, 0), (edge, H + 200), (edge, by1)], OAK_DK)
        wquad(cv, side, 3, ZB, 0, 0.45, BROWN_0)
        wquad(cv, side, 3, ZB, 0.45, 0.55, OAK_0)
    # repaint wall below floor line (left/right triangles) with wall paneling
    for side in "LR":
        z = ZB
        k = 0
        while z > 4:
            z2 = z - 0.55
            if k % 3 == 1:
                wquad(cv, side, z2, z, 0.55, 3.2, BROWN_2)
            a, b = WP(side, z, 0.55), WP(side, z, 3.2)
            cv.line(*a, *b, BROWN_0)
            z, k = z2, k + 1


def beams(cv):
    for Zb in (25.2, 22.0, 18.8, 15.6):
        a, b = P(XL(Zb), CEIL, Zb), P(XR(Zb), CEIL, Zb)
        c_, d = P(XR(Zb), CEIL - 0.7, Zb), P(XL(Zb), CEIL - 0.7, Zb)
        cv.poly([a, b, c_, d], BROWN_1)
        e, f_ = P(XL(Zb), CEIL - 0.7, Zb + 0.6), P(XR(Zb), CEIL - 0.7, Zb + 0.6)
        cv.poly([d, c_, f_, e], OAK_DK)
        cv.line(*d, *c_, OAK_0)
        # cable run along the beam
        p, q = P(XL(Zb), CEIL - 0.75, Zb - 0.05), P(XR(Zb), CEIL - 0.75, Zb - 0.05)
        for x in range(round(p[0]), round(q[0]), 1):
            t = (x - p[0]) / (q[0] - p[0])
            cv.px(x, p[1] + 2 + 2 * abs(math.sin(t * 9)), INK)
    # skylight between beams
    s = [P(-0.8, CEIL, 21.6), P(2.4, CEIL, 21.6), P(2.4, CEIL, 19.2), P(-0.8, CEIL, 19.2)]
    cv.poly(s, OAK_0)
    t = [P(-0.6, CEIL, 21.4), P(2.2, CEIL, 21.4), P(2.2, CEIL, 19.4), P(-0.6, CEIL, 19.4)]
    cv.poly(t, GLOW)
    ys = [p[1] for p in t]
    cv.poly([t[0], t[1], ((t[1][0] + t[2][0]) / 2, (ys[1] + ys[2]) / 2), ((t[0][0] + t[3][0]) / 2, (ys[0] + ys[3]) / 2)], AMBER)
    cv.line(*P(0.8, CEIL, 21.4), *P(0.8, CEIL, 19.4), OAK_0)
    xs = [p[0] for p in s]
    cv.obj("skylight", min(xs), min(p[1] for p in s), max(xs), max(p[1] for p in s))


def pothos(cv, x, y, length, seed, rec):
    r = rng(seed)
    cv.rect(x - 6, y, x + 6, y + 6, TERRA_1)
    cv.rect(x - 6, y, x + 6, y, TERRA_2)
    cv.line(x - 6, y, x, y - 14, INK)
    cv.line(x + 6, y, x, y - 14, INK)
    for v in range(4):
        vx = x - 6 + v * 4
        yy = y + 6
        for k in range(int(length * (0.5 + 0.5 * r.random()))):
            vx += int(r.integers(-1, 2)) if k % 3 == 0 else 0
            cv.px(vx, yy + k, LEAF_1)
            if k % 5 == 2:
                cv.rect(vx - 2 + (k % 2) * 2, yy + k, vx + (k % 2) * 2, yy + k + 1, LEAF_2)
                cv.px(vx - 1 + (k % 2) * 2, yy + k, LEAF_3)
    for k in range(10):
        cv.rect(x - 8 + k * 2 - 1, y - 2 + (k % 3) - 1, x - 8 + k * 2 + 1, y + (k % 3), LEAF_2)
    cv.obj(rec, x - 10, y - 14, x + 10, y + length + 8)


def pendant(cv, X, Z, drop, rec):
    top = P(X, CEIL, Z)
    bot = P(X, CEIL - drop, Z)
    cv.line(*top, *bot, INK)
    x, y = bot
    cv.poly([(x - 2, y), (x + 2, y), (x + 6, y + 6), (x - 6, y + 6)], BROWN_1)
    cv.line(x - 6, y + 6, x + 6, y + 6, OAK_0)
    cv.rect(x - 2, y + 7, x + 2, y + 7, GLOW)
    cv.obj(rec, x - 7, top[1], x + 7, y + 8)


def string_lights(cv):
    for side in "LR":
        z = ZB
        k = 0
        while z > 9:
            x, y = WP(side, z, 11.3 - 0.25 * math.sin(k * 1.3))
            cv.px(x, y, INK)
            if k % 3 == 0:
                cv.px(x, y + 1, GLOW if k % 2 else AMBER)
            z -= 0.18
            k += 1
    cv.obj("string_lights", 0, 0, W, 110)


# ------------------------------------------------------------------ back wall: library
def library(cv):
    # bookshelf 9 ft
    x0, y0 = P(-12.4, 9.0, ZB - 1.2)
    x1, y1 = P(-9.0, 0, ZB - 1.2)
    box(cv, -12.4, -9.0, 0, 9.0, ZB - 1.2, ZB, OAK_0, OAK_DK, BROWN_0)
    cv.rect(x0 + 3, y0 + 4, x1 - 3, y1 - 4, BROWN_0)
    r = rng(21)
    spines = [TERRA_0, TERRA_1, SLATE_0, SLATE_1, LEAF_1, LEAF_2, PLUM_1, PLUM_2, GOLD_DK, CREAM, OAK_2, CRT_0]
    shelves = 6
    sh = (y1 - y0 - 8) / shelves
    for s in range(shelves):
        sy = y0 + 4 + s * sh
        cv.rect(x0 + 2, sy + sh - 2, x1 - 2, sy + sh, OAK_0)
        x = x0 + 4
        while x < x1 - 5:
            w = int(r.integers(2, 5))
            hgt = int(sh - 3 - r.integers(0, 6))
            if r.random() < 0.08:  # a lying stack / gap
                for k in range(3):
                    cv.rect(x, sy + sh - 3 - k * 2, x + 9, sy + sh - 4 - k * 2, spines[int(r.integers(0, 12))])
                x += 11
                continue
            c = spines[int(r.integers(0, 12))]
            cv.rect(x, sy + sh - 2 - hgt, x + w - 1, sy + sh - 3, c)
            cv.px(x + w // 2, sy + sh - hgt + 1, CREAM if c != CREAM else INK)
            if hgt > 8:
                cv.line(x, sy + sh - hgt + 4, x + w - 1, sy + sh - hgt + 4, INK)
            x += w + (1 if r.random() < 0.25 else 0)
    cv.obj("bookshelf", x0, y0, x1, y1)
    # trophy case, lit glass (6.2 ft)
    tx0, ty0 = P(-8.6, 6.2, ZB - 1.0)
    tx1, ty1 = P(-6.6, 0, ZB - 1.0)
    box(cv, -8.6, -6.6, 0, 6.2, ZB - 1.0, ZB, BROWN_2, BROWN_1, BROWN_0)
    cv.rect(tx0 + 3, ty0 + 3, tx1 - 3, ty1 - 18, SLATE_0)
    cv.rect(tx0 + 3, ty0 + 3, tx1 - 3, ty0 + 4, CREAM)          # inner light strip
    for k, sy in enumerate(range(int(ty0 + 30), int(ty1 - 18), 28)):
        cv.rect(tx0 + 3, sy, tx1 - 3, sy, SLATE_2)
        cx = (tx0 + tx1) / 2
        if k == 0:   # cup
            cv.rect(cx - 5, sy - 13, cx + 5, sy - 7, GOLD); cv.rect(cx - 1, sy - 6, cx + 1, sy - 3, GOLD_DK)
            cv.rect(cx - 4, sy - 2, cx + 4, sy - 1, GOLD_DK); cv.px(cx - 3, sy - 12, SUN)
            cv.px(cx - 7, sy - 12, GOLD); cv.px(cx + 7, sy - 12, GOLD); cv.px(cx - 6, sy - 10, GOLD); cv.px(cx + 6, sy - 10, GOLD)
        elif k == 1:  # medals on stands
            for dx in (-8, 0, 8):
                cv.disc(cx + dx, sy - 6, 3, GOLD if dx else SLATE_2)
                cv.line(cx + dx, sy - 10, cx + dx, sy - 13, CRT_0)
        elif k == 2:  # plaque + ball
            cv.rect(cx - 9, sy - 12, cx - 1, sy - 1, OAK_1); cv.rect(cx - 7, sy - 10, cx - 3, sy - 7, GOLD)
            cv.disc(cx + 6, sy - 4, 3, TERRA_2)
        else:
            cv.rect(cx - 3, sy - 10, cx + 3, sy - 1, SLATE_2)
    for gx in range(int(tx0 + 5), int(tx1 - 4), 9):  # glass glints
        cv.line(gx, ty0 + 8, gx + 3, ty0 + 5, SLATE_2)
    cv.rect(tx0 + 3, ty1 - 16, tx1 - 3, ty1 - 3, BROWN_1)
    cv.line(tx0 + 5, ty1 - 10, tx1 - 5, ty1 - 10, BROWN_0)
    cv.obj("trophy_case", tx0, ty0, tx1, ty1)
    # potion shelf: 15 small bottles
    sx0, _ = P(-6.35, 0, ZB)
    sx1, _ = P(-4.5, 0, ZB)
    cols = [CRT_1, LEAF_3, SLATE_2, PLUM_3, GLOW, PLUM_2, SLATE_1, GOLD, LEAF_2, RIM, CREAM, CRT_0, SLATE_2, LEAF_3, AMBER]
    for row in range(3):
        sy = P(0, 6.6 - row * 0.85, ZB)[1]
        cv.rect(sx0, sy, sx1, sy + 1, OAK_0)
        cv.line(sx0, sy + 2, sx1, sy + 2, BROWN_0)
        cv.line(sx0 + 2, sy + 2, sx0 + 2, sy + 5, OAK_DK); cv.line(sx1 - 2, sy + 2, sx1 - 2, sy + 5, OAK_DK)
        for b in range(5):
            bx = sx0 + 3 + b * ((sx1 - sx0 - 6) / 5)
            c = cols[row * 5 + b]
            hgt = 7 + (b + row) % 3 * 2
            cv.rect(bx, sy - hgt + 3, bx + 4, sy - 1, c)
            cv.rect(bx + 1, sy - hgt + 1, bx + 3, sy - hgt + 2, c)
            cv.rect(bx + 1, sy - hgt, bx + 3, sy - hgt, OAK_1)  # cork
            cv.px(bx + 1, sy - hgt + 4, CREAM)                  # glint
            cv.px(bx + 4, sy - 2, DARKER_I(c))
    cv.obj("potion_shelf", sx0, P(0, 7.6, ZB)[1], sx1, P(0, 4.7, ZB)[1])
    # framed poster above the trophy case (symbols only)
    px0, py0 = P(-8.5, 9.2, ZB)
    px1, py1 = P(-6.7, 7.0, ZB)
    cv.rect(px0, py0, px1, py1, INK)
    cv.rect(px0 + 2, py0 + 2, px1 - 2, py1 - 2, TERRA_1)
    cv.disc((px0 + px1) // 2, (py0 + py1) // 2 + 2, 9, RIM)
    cv.rect(px0 + 2, (py0 + py1) // 2 + 6, px1 - 2, py1 - 2, BROWN_2)
    cv.rect(px0 + 6, py0 + 6, px1 - 6, py0 + 7, CREAM)
    cv.obj("poster_library", px0, py0, px1, py1)


def DARKER_I(c):
    return int(LUT_DN[c])


def reading_corner(cv):
    # floor lamp in the corner
    bx, by = P(-11.9, 0, 23.6)
    tx, ty = P(-11.9, 5.4, 23.6)
    cv.line(bx, by, tx, ty, INK)
    cv.rect(bx - 6, by - 1, bx + 6, by, INK)
    cv.poly([(tx - 5, ty - 12), (tx + 5, ty - 12), (tx + 9, ty), (tx - 9, ty)], CREAM)
    cv.poly([(tx - 3, ty - 12), (tx + 5, ty - 12), (tx + 9, ty), (tx + 1, ty)], AMBER)
    cv.line(tx - 9, ty, tx + 9, ty, GLOW)
    cv.obj("reading_lamp", tx - 10, ty - 13, tx + 10, by)
    # reading chair (armchair) in front of the bookshelf
    box(cv, -11.4, -8.9, 0.0, 1.5, 21.6, 23.6, TERRA_1, TERRA_0, TERRA_0)
    box(cv, -11.4, -8.9, 1.5, 3.4, 23.0, 23.6, TERRA_1, TERRA_1, TERRA_0)       # back
    box(cv, -11.4, -10.9, 1.5, 2.3, 21.6, 23.0, TERRA_2, TERRA_0, TERRA_0)      # arm L
    box(cv, -9.4, -8.9, 1.5, 2.3, 21.6, 23.0, TERRA_2, TERRA_0, TERRA_0)        # arm R
    a = P(-10.9, 1.55, 21.8); b = P(-9.4, 1.55, 21.8)
    cv.line(*a, *b, TERRA_2)
    c0 = P(-10.6, 2.6, 23.0)
    cv.rect(c0[0], c0[1], c0[0] + 9, c0[1] + 7, PLUM_1)  # throw pillow
    cv.line(c0[0], c0[1], c0[0] + 9, c0[1], PLUM_2)
    for X in (-11.3, -9.0):
        p = P(X, 0, 21.7)
        cv.rect(p[0], p[1] - 3, p[0] + 1, p[1], INK)
    x0, y0 = P(-11.4, 3.4, 23.6); x1, y1 = P(-8.9, 0, 21.6)
    cv.obj("reading_chair", x0, y0, x1, y1)
    # open book on the armrest
    p = P(-9.15, 2.3, 22.2)
    cv.rect(p[0] - 4, p[1] - 2, p[0] + 4, p[1], CREAM)
    cv.line(p[0], p[1] - 2, p[0], p[1], OAK_2)
    # chess table
    box(cv, -7.6, -5.4, 2.2, 2.4, 20.4, 22.2, OAK_1, OAK_0, OAK_DK)
    for X in (-7.4, -5.6):
        a, b = P(X, 2.2, 20.5), P(X, 0, 20.5)
        cv.rect(a[0], a[1], a[0] + 2, b[1], OAK_DK)
        a, b = P(X, 2.2, 22.0), P(X, 0, 22.0)
        cv.line(a[0], a[1], a[0], b[1], BROWN_0)
    for i in range(8):
        for j in range(8):
            if (i + j) % 2:
                Xa, Za = -7.3 + i * 0.2, 20.6 + j * 0.2
                cv.poly([P(Xa, 2.41, Za), P(Xa + 0.2, 2.41, Za), P(Xa + 0.2, 2.41, Za + 0.2), P(Xa, 2.41, Za + 0.2)], CREAM)
            else:
                Xa, Za = -7.3 + i * 0.2, 20.6 + j * 0.2
                cv.poly([P(Xa, 2.41, Za), P(Xa + 0.2, 2.41, Za), P(Xa + 0.2, 2.41, Za + 0.2), P(Xa, 2.41, Za + 0.2)], BROWN_1)
    for (i, j, col) in [(1, 1, VOID), (3, 0, VOID), (5, 2, CREAM), (6, 6, CREAM), (2, 5, CREAM), (4, 3, VOID)]:
        x, y = P(-7.2 + i * 0.2, 2.41, 20.7 + j * 0.2)
        cv.rect(x - 1, y - 4, x + 1, y, col)
        cv.px(x, y - 5, col)
    x0, y0 = P(-7.6, 2.8, 22.2); x1, y1 = P(-5.4, 0, 20.4)
    cv.obj("chess_table", x0, y0, x1, y1)
    # stool
    box(cv, -5.0, -4.3, 1.4, 1.6, 20.0, 20.7, BROWN_2, BROWN_1, BROWN_0)
    a, b = P(-4.65, 1.4, 20.35), P(-4.65, 0, 20.35)
    cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], BROWN_1)


# ------------------------------------------------------------------ the statue
def statue(cv, light_on):
    Z = 24.6
    s = F / Z  # px per ft (~23.3)
    cx = P(-2.4, 0, Z)[0]
    floor_y = P(0, 0, Z)[1]
    # pedestal
    box(cv, -3.9, -0.9, 0, 1.5, Z - 1.4, Z + 0.1, BROWN_1, INK, VOID)
    px0, py0 = P(-3.9, 1.5, Z - 1.4)
    px1, py1 = P(-0.9, 0, Z - 1.4)
    cv.rect(px0, py0, px1, py0 + 2, BROWN_2)
    cv.line(px0, py0, px1, py0, RIM)
    cv.rect(px0, py1 - 3, px1, py1, BROWN_0)
    for k in range(14):
        cv.px(px0 + 4 + (k * 37) % int(px1 - px0 - 8), py0 + 6 + (k * 13) % int(py1 - py0 - 12), BROWN_1)
    # plaque "III · FORGED"
    tw = 3 * 2 + 3 * 2 + 1 + 6 * 4 + 1
    qx = round((px0 + px1) / 2 - tw / 2) - 3
    qy = round(py0 + 9)
    cv.rect(qx, qy, qx + tw + 5, qy + 9, GOLD_DK)
    cv.rect(qx + 1, qy + 1, qx + tw + 4, qy + 8, OAK_0)
    cv.line(qx, qy, qx + tw + 5, qy, GOLD)
    cv.text(qx + 3, qy + 2, "III · FORGED", GOLD)
    cv.obj("statue_plaque", qx, qy, qx + tw + 6, qy + 10)
    top = P(0, 1.5, Z - 0.7)[1]  # feet on pedestal top (inset)
    hpx = 10.0 * s  # 233 px figure
    u = hpx / 8.0   # one head
    feet = round(top + 4)

    def Y(k):  # k heads above the feet
        return feet - k * u

    # silhouette (front view, weight on the figure's right leg = screen left, left hip drops)
    body = [
        # head
        ("ell", cx - 0.36 * u, Y(8), cx + 0.36 * u, Y(7.05)),
        # neck
        ("poly", [(cx - 0.17 * u, Y(7.2)), (cx + 0.17 * u, Y(7.2)), (cx + 0.2 * u, Y(6.8)), (cx - 0.2 * u, Y(6.8))]),
        # torso (shoulders tilt: left shoulder higher (contrapposto counter to hips))
        ("poly", [(cx - 1.05 * u, Y(6.75)), (cx + 1.0 * u, Y(6.62)), (cx + 0.9 * u, Y(5.9)), (cx + 0.66 * u, Y(4.9)),
                  (cx + 0.6 * u, Y(4.25)), (cx + 0.72 * u, Y(3.85)), (cx - 0.68 * u, Y(3.97)), (cx - 0.62 * u, Y(4.35)),
                  (cx - 0.68 * u, Y(4.95)), (cx - 0.95 * u, Y(5.95))]),
        # standing leg (screen left), straight
        ("poly", [(cx - 0.68 * u, Y(3.97)), (cx + 0.05 * u, Y(3.9)), (cx - 0.12 * u, Y(2.1)), (cx - 0.18 * u, Y(1.9)),
                  (cx - 0.2 * u, Y(0.25)), (cx - 0.55 * u, Y(0.25)), (cx - 0.6 * u, Y(1.9)), (cx - 0.68 * u, Y(2.2))]),
        # relaxed leg (screen right), knee bent in, heel lifted
        ("poly", [(cx - 0.05 * u, Y(3.9)), (cx + 0.72 * u, Y(3.85)), (cx + 0.55 * u, Y(2.2)), (cx + 0.42 * u, Y(1.85)),
                  (cx + 0.52 * u, Y(0.35)), (cx + 0.2 * u, Y(0.3)), (cx + 0.05 * u, Y(1.85)), (cx + 0.02 * u, Y(2.2))]),
        # feet
        ("poly", [(cx - 0.6 * u, Y(0.3)), (cx - 0.15 * u, Y(0.3)), (cx - 0.1 * u, Y(0)), (cx - 0.7 * u, Y(0))]),
        ("poly", [(cx + 0.18 * u, Y(0.35)), (cx + 0.55 * u, Y(0.35)), (cx + 0.66 * u, Y(0.08)), (cx + 0.2 * u, Y(0.08))]),
        # arms: left arm (screen left) relaxed at side, right arm slightly away, hand loose
        ("poly", [(cx - 1.05 * u, Y(6.75)), (cx - 0.82 * u, Y(6.55)), (cx - 0.8 * u, Y(5.2)), (cx - 0.86 * u, Y(4.0)),
                  (cx - 0.9 * u, Y(3.35)), (cx - 1.12 * u, Y(3.3)), (cx - 1.15 * u, Y(4.1)), (cx - 1.12 * u, Y(5.3)),
                  (cx - 1.18 * u, Y(6.2))]),
        ("poly", [(cx + 1.0 * u, Y(6.62)), (cx + 1.15 * u, Y(6.1)), (cx + 1.12 * u, Y(5.1)), (cx + 1.22 * u, Y(4.1)),
                  (cx + 1.25 * u, Y(3.45)), (cx + 1.02 * u, Y(3.4)), (cx + 0.94 * u, Y(4.1)), (cx + 0.86 * u, Y(5.2)),
                  (cx + 0.8 * u, Y(6.4))]),
    ]
    groups = ["head", "head", "torso", "legL", "legR", "legL", "legR", "armL", "armR"]
    masks = {}
    for grp, part in zip(groups, body):
        im_ = Image.new("1", (W, H), 0)
        md = ImageDraw.Draw(im_)
        if part[0] == "ell":
            md.ellipse([round(v) for v in part[1:]], fill=1)
        else:
            md.polygon([(round(x), round(y)) for x, y in part[1]], fill=1)
        mm = np.array(im_, bool)
        masks[grp] = masks.get(grp, np.zeros((H, W), bool)) | mm
    yy, xx = np.mgrid[0:H, 0:W]
    split = Y(5.0)
    masks["chest"] = masks["torso"] & (yy < split)
    masks["abdomen"] = masks["torso"] & (yy >= split)
    del masks["torso"]
    m = np.zeros((H, W), bool)
    for v in masks.values():
        m |= v
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    a = np.array(cv.im)
    # darker recessed panel behind the figure so the silhouette separates from the wall
    near = np.zeros_like(m)
    for dy in range(-6, 7, 2):
        for dx in range(-6, 7, 2):
            near |= np.roll(np.roll(m, dy, 0), dx, 1)
    halo = near & ~m & (yy < py0)
    a[halo & np.isin(a, [OAK_DK, BROWN_2, OAK_0])] = BROWN_0
    rel = (xx - cx) / u
    PLATED = ("head", "chest", "armR", "legL")   # tier III: 4 of 7 sections plated + lit
    gold = np.zeros_like(m)
    for name, mm in masks.items():
        cxp = xs[mm[ys, xs]].mean() if mm.any() else cx
        relp = xx - cxp
        if name in PLATED:
            gold |= mm
            a[mm] = GOLD
            a[mm & (relp < -2)] = GOLD_DK
            a[mm & (relp < -2) & (relp > -5) & (BAY < 0.5)] = GOLD
            a[mm & (relp > 2)] = AMBER
        else:
            a[mm] = INK
            a[mm & (relp > 1)] = SLATE_0          # mid-tone plane facing the window
            a[mm & (relp > 1) & (BAY < 0.25)] = INK
            a[mm & (relp < -3)] = VOID
    # seams between sections (plating edges)
    for name, mm in masks.items():
        inner_top = mm & ~np.roll(mm, 1, 0) & np.roll(m, 1, 0)
        a[inner_top] = GOLD_DK if name in PLATED else VOID
    cv.im = Image.fromarray(a)
    cv.d = ImageDraw.Draw(cv.im)
    # face + anatomy hints
    hx, hy = cx, Y(7.5)
    cv.line(hx - 4, hy + 1, hx - 2, hy + 1, GOLD_DK)
    cv.line(hx + 2, hy + 1, hx + 4, hy + 1, GOLD_DK)
    cv.line(hx, hy + 2, hx, hy + 5, GOLD_DK)
    cv.line(cx - 0.5 * u, Y(5.7), cx - 0.05 * u, Y(5.5), GOLD_DK)
    cv.line(cx + 0.05 * u, Y(5.5), cx + 0.5 * u, Y(5.65), GOLD_DK)
    # strong rim light from the window side (2 px), cooler shadow edge on the left
    a = np.array(cv.im)
    right_edge = m & ~np.roll(m, -1, 1)
    right2 = np.roll(right_edge, -1, 1) & m
    left_edge = m & ~np.roll(m, 1, 1)
    a[right2 & ~gold] = RIM
    a[right_edge & ~gold] = GLOW
    a[right_edge & gold] = SUN
    a[right2 & gold] = GOLD
    a[left_edge & ~gold] = SLATE_1
    a[left_edge & gold] = GOLD_DK
    top_edge = m & ~np.roll(m, 1, 0)
    a[top_edge & ~gold] = RIM
    if light_on:
        a[top_edge] = SUN
        a[np.roll(top_edge, 1, 0) & m & gold] = SUN
        a[np.roll(top_edge, 1, 0) & m & ~gold & (BAY < 0.5)] = SLATE_1
    cv.im = Image.fromarray(a)
    cv.d = ImageDraw.Draw(cv.im)
    cv.obj("statue", x0, y0, x1 + 1, y1 + 1)
    cv.obj("statue_pedestal", px0, py0, px1, py1 + 1)
    return m, gold


def downlight(cv, on):
    X, Z = -2.4, 24.2
    x, y = P(X, CEIL, Z)
    cv.rect(x - 7, y - 1, x + 7, y + 2, BROWN_1)
    cv.rect(x - 5, y + 3, x + 5, y + 4, INK)
    cv.line(x - 5, y + 4, x + 5, y + 4, SUN if on else BROWN_2)
    cv.obj("statue_downlight", x - 8, y - 2, x + 8, y + 6)
    return x, y + 5


# ------------------------------------------------------------------ window wall
WIN = (-0.6, 6.6, 2.9, 9.2)


def window(cv, relic):
    X0, X1, h0, h1 = WIN
    x0, y1 = P(X0, h0, ZB)
    x1, y0 = P(X1, h1, ZB)
    x0, x1, y0, y1 = round(x0), round(x1), round(y0), round(y1)
    cv.rect(x0 - 5, y0 - 5, x1 + 5, y1 + 3, OAK_0)
    cv.rect(x0 - 4, y0 - 4, x1 + 4, y0 - 3, OAK_1)
    sky(cv, x0, y0, x1, y1)
    mx = (x0 + x1) // 2
    cv.rect(x0 - 2, y0 - 2, x1 + 2, y0, BROWN_0)
    cv.rect(mx - 2, y0, mx + 1, y1, BROWN_0)
    cv.line(mx + 1, y0, mx + 1, y1, RIM)           # mullion rim
    cv.rect(x0, (y0 + y1) // 2 - 22, x1, (y0 + y1) // 2 - 21, BROWN_0)  # transom bar
    cv.line(x0, (y0 + y1) // 2 - 20, x1, (y0 + y1) // 2 - 20, TERRA_1)
    cv.rect(x0 - 2, y0, x0, y1, BROWN_0)
    cv.rect(x1, y0, x1 + 2, y1, BROWN_0)
    # sill
    cv.rect(x0 - 9, y1 + 1, x1 + 9, y1 + 4, OAK_1)
    cv.line(x0 - 9, y1 + 1, x1 + 9, y1 + 1, AMBER)
    cv.rect(x0 - 7, y1 + 5, x1 + 7, y1 + 6, BROWN_0)
    # sill stuff: small succulent + mug
    cv.rect(x0 + 6, y1 - 5, x0 + 12, y1, TERRA_1)
    for k in range(5):
        cv.line(x0 + 7 + k, y1 - 6, x0 + 5 + k * 2, y1 - 11 + (k % 2) * 2, LEAF_1)
    cv.rect(x0 + 20, y1 - 5, x0 + 24, y1, CREAM)
    cv.px(x0 + 25, y1 - 3, CREAM)
    cv.obj("window", x0 - 5, y0 - 5, x1 + 5, y1 + 6)
    # arched relic niche above the window, its own ember light
    nx = round(P(3.0, 0, ZB)[0])
    ny0, ny1 = round(P(0, 11.7, ZB)[1]), round(P(0, 9.55, ZB)[1])
    hw = 19
    cv.rect(nx - hw, ny0 + hw, nx + hw, ny1, OAK_1)
    cv.disc(nx, ny0 + hw, hw, OAK_1)
    cv.rect(nx - hw + 3, ny0 + hw, nx + hw - 3, ny1 - 2, TERRA_0)
    cv.disc(nx, ny0 + hw, hw - 3, TERRA_0)
    cv.rect(nx - hw + 5, ny0 + hw + 4, nx + hw - 5, ny1 - 2, BROWN_2)
    cv.disc(nx, ny0 + hw + 2, hw - 6, BROWN_2)
    cv.rect(nx - hw + 3, ny1 - 3, nx + hw - 3, ny1 - 2, RIM)      # ember strip light
    cv.rect(nx - hw - 2, ny1, nx + hw + 2, ny1 + 2, OAK_0)
    cv.obj("relic_niche", nx - hw - 2, ny0, nx + hw + 3, ny1 + 3)
    if relic:
        medal(cv, nx, ny0 + hw + 8)
    return (x0, y0, x1, y1), (nx, ny1)


def medal(cv, cx, cy):
    # striped ribbon V
    for k in range(-1, 2):
        cv.line(cx - 9 + k, cy - 24, cx - 2 + k, cy - 6, [CRT_0, CREAM, SLATE_1][k + 1])
        cv.line(cx + 9 + k, cy - 24, cx + 2 + k, cy - 6, [SLATE_1, CREAM, CRT_0][k + 1])
    cv.disc(cx, cy + 4, 11, TERRA_0)
    cv.disc(cx, cy + 4, 10, CRT_0)
    cv.disc(cx, cy + 4, 9, RIM)
    cv.disc(cx - 1, cy + 3, 7, ORANGE)
    cv.disc(cx - 2, cy + 2, 3, GLOW)
    # swim / bike / run icons (3 px tall glyphs), dark on hot metal
    yy = cy + 4
    for dx, glyph in ((-7, ["010", "101", "000"]), (-2, ["101", "010", "101"]), (4, ["010", "110", "101"])):
        for j, row in enumerate(glyph):
            for i, b in enumerate(row):
                if b == "1":
                    cv.px(cx + dx + i, yy + j - 1, TERRA_0)
    cv.line(cx - 7, yy + 3, cx + 7, yy + 3, TERRA_1)
    cv.px(cx - 3, cy - 3, SUN)
    # rising embers
    for (dx, dy, c) in ((-12, -6, GLOW), (12, -10, ORANGE), (-7, -18, RIM), (8, -22, GLOW), (2, -28, ORANGE), (-14, -26, RIM)):
        cv.px(cx + dx, cy + dy, c)
    cv.obj("relic_medal", cx - 13, cy - 29, cx + 13, cy + 16)


def crt_stack(cv):
    # amp / deck tower
    box(cv, 4.4, 7.4, 0, 2.4, 24.6, 25.8, BROWN_1, INK, VOID)
    x0, y0 = P(4.4, 2.4, 24.6); x1, y1 = P(7.4, 0, 24.6)
    for k, (yy, kind) in enumerate([(y0 + 4, "deck"), (y0 + 18, "amp"), (y0 + 34, "eq")]):
        cv.line(x0 + 2, yy - 2, x1 - 2, yy - 2, BROWN_1)
        if kind == "deck":
            cv.rect(x0 + 5, yy, x0 + 24, yy + 8, VOID); cv.rect(x0 + 8, yy + 2, x0 + 20, yy + 5, BROWN_1)
            cv.rect(x1 - 18, yy + 2, x1 - 6, yy + 3, CRT_1)
        elif kind == "amp":
            for i in range(6):
                cv.disc(round(x0 + 10 + i * 10), round(yy + 5), 2, BROWN_1)
                cv.px(x0 + 10 + i * 10, yy + 4, SLATE_1)
            cv.px(x1 - 6, yy + 2, CRT_1)
        else:
            for i in range(10):
                h = 2 + (i * 7) % 6
                cv.line(x0 + 8 + i * 5, yy + 10 - h, x0 + 8 + i * 5, yy + 10, GLOW if i % 3 else CRT_1)
    cv.obj("amp_tower", x0, P(4.4, 2.4, 25.8)[1], x1 + 4, y1)
    # big CRT (red sun)
    box(cv, 4.6, 7.2, 2.4, 4.7, 24.4, 25.9, BROWN_2, BROWN_1, INK)
    cx0, cy0 = P(4.6, 4.7, 24.4); cx1, cy1 = P(7.2, 2.4, 24.4)
    sx0, sy0, sx1, sy1 = cx0 + 6, cy0 + 6, cx1 - 14, cy1 - 7
    cv.rect(sx0 - 2, sy0 - 2, sx1 + 2, sy1 + 2, INK)
    cv.rect(sx0, sy0, sx1, sy1, CRT_0)
    cv.rect(sx0, sy0 + (sy1 - sy0) * 0.62, sx1, sy1, TERRA_0)
    cv.disc(round((sx0 + sx1) / 2 - 4), round(sy0 + (sy1 - sy0) * 0.45), 7, CRT_1)
    for k in range(5):  # cloud streaks
        y = sy0 + 4 + k * 5
        cv.line(sx0 + 3 + (k * 11) % 20, y, sx0 + 12 + (k * 11) % 20, y, TERRA_0)
    for y in range(round(sy0), round(sy1), 2):  # scanlines
        cv.line(sx0, y, sx1, y, CRT_0 if y > sy0 + (sy1 - sy0) * 0.62 else TERRA_1) if y % 6 == 0 else None
    cv.rect(cx1 - 11, cy0 + 8, cx1 - 4, cy0 + 9, BROWN_0)
    cv.px(cx1 - 7, cy1 - 8, CRT_1)
    cv.rect(cx1 - 10, cy0 + 14, cx1 - 5, cy0 + 22, BROWN_0)
    cv.obj("crt_big", cx0, P(4.6, 4.7, 25.9)[1], cx1 + 4, cy1)
    # small CRT on top
    box(cv, 5.2, 6.7, 4.7, 5.9, 24.6, 25.6, BROWN_1, OAK_DK, INK)
    a0, b0 = P(5.2, 5.9, 24.6); a1, b1 = P(6.7, 4.7, 24.6)
    cv.rect(a0 + 3, b0 + 3, a1 - 9, b1 - 3, SLATE_0)
    cv.rect(a0 + 4, b0 + 4, a0 + 8, b0 + 5, SLATE_1)
    cv.rect(a1 - 6, b0 + 4, a1 - 3, b0 + 5, CRT_1)
    cv.line(a1 - 6, b0 + 8, a1 - 3, b0 + 8, BROWN_0)
    cv.obj("crt_small", a0, P(5.2, 5.9, 25.6)[1], a1 + 3, b1)
    # leafy plant in a pot beside the stack (like the reference)
    pot = P(3.6, 0, 24.4)
    cv.rect(pot[0] - 7, pot[1] - 14, pot[0] + 7, pot[1], TERRA_1)
    cv.line(pot[0] - 7, pot[1] - 14, pot[0] + 7, pot[1] - 14, TERRA_2)
    r = rng(9)
    for k in range(26):
        ang = r.uniform(-2.6, -0.5)
        ln = r.uniform(10, 30)
        ex, ey = pot[0] + math.cos(ang) * ln, pot[1] - 14 + math.sin(ang) * ln
        cv.line(pot[0], pot[1] - 14, ex, ey, LEAF_0)
        cv.ell(ex - 3, ey - 2, ex + 3, ey + 2, LEAF_1 if k % 3 else LEAF_2)
    cv.obj("plant_window", pot[0] - 30, pot[1] - 46, pot[0] + 30, pot[1])


# ------------------------------------------------------------------ study desk
def study(cv):
    Zd = 24.0
    box(cv, 8.0, 12.2, 2.5, 2.7, Zd, ZB, OAK_1, OAK_0, OAK_DK)
    for X in (8.1, 11.9):
        a, b = P(X, 2.5, Zd + 0.1), P(X, 0, Zd + 0.1)
        cv.rect(a[0], a[1], a[0] + 3, b[1], OAK_DK)
    d0, d1 = P(10.6, 2.5, Zd + 0.1), P(11.8, 1.0, Zd + 0.1)
    cv.rect(d0[0], d0[1], d1[0], d1[1], OAK_0)  # drawers
    cv.line(d0[0], (d0[1] + d1[1]) / 2, d1[0], (d0[1] + d1[1]) / 2, OAK_DK)
    cv.px((d0[0] + d1[0]) / 2, d0[1] + 5, AMBER)
    x0, y0 = P(8.0, 2.7, ZB); x1, y1 = P(12.2, 0, Zd)
    cv.obj("study_desk", x0, y0, x1, y1)
    # corkboard class schedule (grid of blank coloured blocks)
    c0 = P(8.4, 6.8, ZB); c1 = P(10.9, 4.6, ZB)
    cv.rect(c0[0] - 2, c0[1] - 2, c1[0] + 2, c1[1] + 2, OAK_0)
    cv.rect(c0[0], c0[1], c1[0], c1[1], TERRA_1)
    cols = [SLATE_1, LEAF_2, PLUM_2, GLOW, CREAM]
    for i in range(5):
        for j in range(4):
            if (i * 3 + j) % 4 != 3:
                bx = c0[0] + 3 + i * 10
                by = c0[1] + 4 + j * 11
                cv.rect(bx, by, bx + 8, by + 8, cols[(i + j) % 5])
                cv.line(bx + 1, by + 3, bx + 6, by + 3, BROWN_1)
                cv.line(bx + 1, by + 5, bx + 4, by + 5, BROWN_1)
                cv.px(bx + 4, by, CRT_1)
    cv.obj("schedule_corkboard", c0[0] - 2, c0[1] - 2, c1[0] + 2, c1[1] + 2)
    # wall calendar + planner
    k0 = P(11.2, 7.0, ZB); k1 = P(12.4, 5.1, ZB)
    cv.rect(k0[0], k0[1], k1[0], k1[1], CREAM)
    cv.rect(k0[0], k0[1], k1[0], k0[1] + 7, CRT_0)
    for i in range(5):
        for j in range(4):
            cv.rect(k0[0] + 2 + i * 5, k0[1] + 10 + j * 5, k0[0] + 4 + i * 5, k0[1] + 12 + j * 5, BROWN_2 if (i + j) % 7 else CRT_1)
    cv.line((k0[0] + k1[0]) / 2, k0[1] - 3, (k0[0] + k1[0]) / 2, k0[1], INK)
    cv.obj("wall_calendar", k0[0], k0[1] - 3, k1[0], k1[1])
    # pennant (Tulane green + sky blue, no crest/logo/text)
    p0 = P(8.3, 9.9, ZB); p1 = P(11.4, 8.3, ZB)
    cv.poly([(p0[0], p0[1]), (p1[0], (p0[1] + p1[1]) / 2), (p0[0], p1[1])], LEAF_2)
    cv.poly([(p0[0] + 4, p0[1] + 4), (p1[0] - 22, (p0[1] + p1[1]) / 2), (p0[0] + 4, p1[1] - 4)], LEAF_1)
    cv.line(p0[0], p0[1], p1[0], (p0[1] + p1[1]) / 2, SLATE_2)
    cv.line(p0[0], p1[1], p1[0], (p0[1] + p1[1]) / 2, SLATE_2)
    cv.rect(p0[0] - 3, p0[1], p0[0], p1[1], SLATE_2)
    for k in range(3):
        cv.line(p0[0] + 10 + k * 14, (p0[1] + p1[1]) / 2 - 1, p0[0] + 16 + k * 14, (p0[1] + p1[1]) / 2 - 1, SLATE_2)
    cv.obj("pennant", p0[0] - 3, p0[1], p1[0], p1[1])
    # empty picture frame
    f0 = P(11.6, 10.2, ZB); f1 = P(12.5, 8.6, ZB)
    cv.rect(f0[0], f0[1], f1[0], f1[1], GOLD_DK)
    cv.rect(f0[0] + 3, f0[1] + 3, f1[0] - 3, f1[1] - 3, BROWN_0)
    cv.line(f0[0], f0[1], f1[0], f0[1], GOLD)
    cv.obj("picture_frame", f0[0], f0[1], f1[0], f1[1])
    # desk top things
    ty = P(0, 2.7, 25.0)[1]
    # course books stack
    bx = P(8.4, 0, 25.0)[0]
    for k, c in enumerate([SLATE_1, CRT_0, LEAF_2, GOLD, PLUM_2, TERRA_2]):
        w = 26 - (k % 3) * 3
        cv.rect(bx + (k % 2) * 2, ty - 4 - k * 4, bx + w + (k % 2) * 2, ty - 1 - k * 4, c)
        cv.line(bx + (k % 2) * 2, ty - 1 - k * 4, bx + w + (k % 2) * 2, ty - 1 - k * 4, DARKER_I(c))
        cv.line(bx + 3 + (k % 2) * 2, ty - 3 - k * 4, bx + 7 + (k % 2) * 2, ty - 3 - k * 4, CREAM)
    cv.obj("course_books", bx, ty - 26, bx + 30, ty)
    # planner (open)
    px = P(9.9, 0, 24.6)[0]
    cv.poly([(px, ty), (px + 22, ty), (px + 20, ty - 4), (px + 2, ty - 4)], CREAM)
    cv.line(px + 11, ty, px + 11, ty - 4, OAK_2)
    cv.obj("planner", px, ty - 5, px + 22, ty + 1)
    # desk lamp
    lx = P(11.6, 0, 25.2)[0]
    cv.rect(lx - 5, ty - 2, lx + 5, ty, INK)
    cv.line(lx, ty - 2, lx - 6, ty - 18, BROWN_1)
    cv.line(lx - 6, ty - 18, lx - 14, ty - 26, BROWN_1)
    cv.poly([(lx - 18, ty - 30), (lx - 10, ty - 30), (lx - 6, ty - 23), (lx - 20, ty - 23)], TERRA_1)
    cv.line(lx - 20, ty - 23, lx - 6, ty - 23, SUN)
    cv.obj("desk_lamp", lx - 21, ty - 31, lx + 6, ty)
    # mug + pencil cup
    mx = P(11.0, 0, 24.3)[0]
    cv.rect(mx, ty - 6, mx + 5, ty, SLATE_1); cv.px(mx + 6, ty - 4, SLATE_1); cv.px(mx + 1, ty - 5, SLATE_2)
    cv.rect(mx - 10, ty - 7, mx - 6, ty, TERRA_1)
    for k in range(3):
        cv.line(mx - 9 + k, ty - 8, mx - 10 + k * 2, ty - 13, [GOLD, CRT_1, SLATE_2][k])
    # backpack on the floor in front-left of the desk
    bp = P(7.5, 0, 23.2)
    x, y = bp
    cv.rect(x - 12, y - 30, x + 12, y, SLATE_0)
    cv.rect(x - 12, y - 30, x + 12, y - 27, SLATE_1)
    cv.ell(x - 12, y - 36, x + 12, y - 24, SLATE_0)
    cv.line(x - 10, y - 33, x + 10, y - 33, SLATE_1)
    cv.rect(x - 8, y - 16, x + 8, y - 3, SLATE_1)
    cv.line(x - 8, y - 16, x + 8, y - 16, SLATE_2)
    cv.line(x - 6, y - 10, x + 6, y - 10, SLATE_0)
    cv.px(x + 6, y - 13, CRT_1)
    cv.line(x - 13, y - 26, x - 15, y - 6, INK)
    cv.obj("backpack", x - 16, y - 37, x + 13, y)
    # chair
    box(cv, 9.4, 10.9, 1.5, 1.7, 22.4, 23.6, BROWN_1, BROWN_0, INK)
    box(cv, 9.4, 10.9, 1.7, 3.6, 22.4, 22.6, BROWN_1, BROWN_1, INK)
    a, b = P(10.15, 1.5, 23.0), P(10.15, 0.3, 23.0)
    cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], INK)
    for X in (9.5, 10.8):
        p = P(X, 0.0, 23.0)
        cv.line(b[0], b[1], p[0], p[1], INK)
    x0, y0 = P(9.4, 3.6, 22.4); x1, y1 = P(10.9, 0, 22.4)
    cv.obj("desk_chair", x0, y0, x1, y1)


# ------------------------------------------------------------------ left wall
def left_side(cv):
    # nightstand with alarm clock + plasma globe on its shelf
    z0, z1 = 22.4, 23.7
    bb = wbox(cv, "L", z0, z1, 1.4, 0, 2.2, OAK_1, OAK_0, OAK_DK, "nightstand")
    sh = [WP("L", z0, 1.2, 1.4), WP("L", z1, 1.2, 1.4), WP("L", z1, 0.3, 1.4), WP("L", z0, 0.3, 1.4)]
    cv.poly([(p[0] + 2, p[1] + (1 if k < 2 else -1)) for k, p in enumerate(sh)], BROWN_0)
    gx, gy = WP("L", (z0 + z1) / 2, 0.75, 1.4)
    cv.rect(gx - 4, gy + 2, gx + 4, gy + 5, INK)
    cv.disc(round(gx), round(gy - 4), 6, PLUM_1)
    cv.disc(round(gx), round(gy - 4), 2, PLUM_3)
    for dx, dy in ((-4, -7), (4, -8), (-5, -1), (5, -2), (0, -9)):
        cv.line(gx, gy - 4, gx + dx, gy - 4 + dy + 4, PLUM_2)
    cv.px(gx - 3, gy - 8, CREAM)
    cv.obj("plasma_globe", gx - 7, gy - 11, gx + 7, gy + 6)
    cx, cy = WP("L", (z0 + z1) / 2, 2.2, 0.7)
    cv.rect(cx - 7, cy - 9, cx + 7, cy, INK)
    cv.rect(cx - 5, cy - 7, cx + 5, cy - 3, VOID)
    for k, dx in enumerate((-4, -2, 1, 3)):
        cv.rect(cx + dx, cy - 6, cx + dx, cy - 4, CRT_1)
    cv.px(cx, cy - 6, CRT_0)
    cv.obj("alarm_clock", cx - 7, cy - 9, cx + 8, cy + 1)
    # bed along the wall, headboard at the back end
    za, zb = 16.0, 22.2
    wbox(cv, "L", zb - 0.3, zb, 4.2, 0, 3.6, OAK_0, OAK_DK, OAK_0)                # headboard
    wbox(cv, "L", za, zb - 0.3, 4.2, 0.0, 1.3, OAK_0, OAK_DK, OAK_DK)             # frame
    wbox(cv, "L", za, zb - 0.3, 4.1, 1.3, 2.1, CREAM, SLATE_0, SLATE_1)           # mattress/sheet
    # duvet with folds
    wbox(cv, "L", za, zb - 2.3, 4.25, 1.4, 2.25, TERRA_1, TERRA_0, TERRA_1)
    for t in np.arange(za + 0.6, zb - 2.3, 0.9):
        a, b = WP("L", t, 2.25, 0.3), WP("L", t + 0.2, 2.25, 4.25)
        cv.line(*a, *b, TERRA_0)
        a2, b2 = WP("L", t + 0.1, 2.25, 4.25), WP("L", t + 0.1, 1.5, 4.25)
        cv.line(*a2, *b2, TERRA_0)
    a, b = WP("L", zb - 2.3, 2.25, 0.2), WP("L", zb - 2.3, 2.25, 4.25)
    cv.line(*a, *b, CREAM)
    # pillows
    for o in (0.4, 2.2):
        p = [WP("L", zb - 1.4, 2.5, o), WP("L", zb - 1.4, 2.5, o + 1.6), WP("L", zb - 0.4, 2.4, o + 1.6), WP("L", zb - 0.4, 2.4, o)]
        cv.poly(p, CREAM)
        cv.line(*p[0], *p[1], SLATE_2)
    xs = [WP("L", z, h, o)[0] for z in (za, zb) for h in (0, 3.6) for o in (0, 4.25)]
    ys = [WP("L", z, h, o)[1] for z in (za, zb) for h in (0, 3.6) for o in (0, 4.25)]
    cv.obj("bed", min(xs), min(ys), max(xs), max(ys))
    # poster above the bed (symbol: mountain + sun)
    q = wquad(cv, "L", 18.2, 20.6, 6.0, 8.6, INK)
    wquad(cv, "L", 18.35, 20.45, 6.15, 8.45, PLUM_1)
    pts = [WP("L", 18.35, 6.15), WP("L", 19.4, 7.9), WP("L", 20.45, 6.15)]
    cv.poly(pts, SLATE_0)
    sx, sy = WP("L", 19.0, 7.8)
    cv.disc(round(sx), round(sy), 4, GLOW)
    cv.obj("poster_bed", *q)
    # floor cushion
    c = P(XL(15.0) + 1.8, 0, 15.0)
    cv.ell(c[0] - 26, c[1] - 12, c[0] + 26, c[1] + 4, PLUM_1)
    cv.ell(c[0] - 22, c[1] - 12, c[0] + 22, c[1] - 1, PLUM_2)
    cv.line(c[0] - 6, c[1] - 7, c[0] + 6, c[1] - 7, PLUM_1)
    cv.obj("floor_cushion", c[0] - 26, c[1] - 12, c[0] + 26, c[1] + 4)
    # relic wall mount beside the door (empty slot: subtle plus)
    q = wquad(cv, "L", 15.0, 15.7, 5.0, 5.8, BROWN_0)
    wquad(cv, "L", 15.08, 15.62, 5.08, 5.72, OAK_0)
    mx, my = WP("L", 15.35, 5.4)
    cv.line(mx - 2, my, mx + 2, my, OAK_2)
    cv.line(mx, my - 2, mx, my + 2, OAK_2)
    cv.obj("relic_mount_door", *q)
    # switchboard (small dark panel) by the door
    q = wquad(cv, "L", 14.55, 14.85, 4.1, 4.7, INK)
    for hh in (4.25, 4.45):
        a = WP("L", 14.7, hh)
        cv.px(a[0], a[1], GLOW)
    cv.obj("switchboard", *q)
    # door with flyer board
    dz0, dz1 = 11.6, 14.3
    q = wquad(cv, "L", dz0 - 0.2, dz1 + 0.2, 0, 7.3, OAK_0)
    wquad(cv, "L", dz0, dz1, 0, 7.0, BROWN_2)
    wquad(cv, "L", dz0 + 0.3, dz1 - 0.3, 3.9, 6.6, OAK_DK)
    wquad(cv, "L", dz0 + 0.3, dz1 - 0.3, 0.4, 3.3, OAK_DK)
    hx, hy = WP("L", dz0 + 0.25, 3.5)
    cv.rect(hx - 1, hy - 1, hx + 2, hy, GOLD)
    cv.obj("door", *q)
    fb = wquad(cv, "L", dz0 + 0.5, dz1 - 0.5, 4.3, 6.2, OAK_1)   # flyer board on the door
    r = rng(14)
    for k in range(5):
        za_ = dz0 + 0.6 + (k % 3) * 0.48
        ha = 4.45 + (k // 3) * 0.85 + r.uniform(0, 0.2)
        wquad(cv, "L", za_, za_ + 0.4, ha, ha + 0.65, [CREAM, GLOW, SLATE_2, PLUM_3, LEAF_3][k])
        a, b = WP("L", za_ + 0.06, ha + 0.45), WP("L", za_ + 0.32, ha + 0.45)
        cv.line(*a, *b, BROWN_1)
        p = WP("L", za_ + 0.2, ha + 0.62)
        cv.px(p[0], p[1], CRT_1)
    cv.obj("flyer_board", *fb)
    # doormat with WELCOME
    m = [P(XL(dz1) + 0.3, 0, dz1), P(XL(dz1) + 2.6, 0, dz1), P(XL(dz0) + 2.6, 0, dz0), P(XL(dz0) + 0.3, 0, dz0)]
    cv.poly(m, BROWN_2)
    cv.poly([(m[0][0] + 3, m[0][1] + 2), (m[1][0] - 3, m[1][1] + 2), (m[2][0] - 3, m[2][1] - 3), (m[3][0] + 4, m[3][1] - 3)], TERRA_1)
    tx = (m[2][0] + m[3][0]) / 2 - 13
    ty = (m[0][1] + m[3][1]) / 2 + 2
    cv.text(round(tx), round(ty), "WELCOME", OAK_DK)
    cv.obj("doormat", min(p[0] for p in m), min(p[1] for p in m), max(p[0] for p in m), max(p[1] for p in m))
    # kitchen (front): base cabinets, counter, uppers
    kz0, kz1 = 7.6, 11.2
    wbox(cv, "L", kz0, kz1, 2.0, 0, 3.0, OAK_1, OAK_DK, BROWN_2)
    for t in np.arange(kz0 + 0.1, kz1, 1.2):
        a, b = WP("L", t, 2.8, 2.0), WP("L", t, 0.3, 2.0)
        cv.line(*a, *b, BROWN_0)
        p = WP("L", t + 0.6, 2.4, 2.0)
        cv.rect(p[0], p[1], p[0] + 1, p[1] + 5, GOLD_DK)
    q = wbox(cv, "L", kz0, kz1, 2.15, 2.95, 3.15, OAK_2, OAK_1, OAK_1)  # counter slab
    wquad(cv, "L", kz0, kz1, 3.15, 4.8, TERRA_0)                      # backsplash
    for hh in np.arange(3.3, 4.8, 0.35):
        a, b = WP("L", kz0, hh), WP("L", kz1, hh)
        cv.line(*a, *b, BROWN_2)
    wbox(cv, "L", kz0, kz1, 1.2, 5.2, 7.4, OAK_0, OAK_DK, BROWN_2)       # uppers
    for t in np.arange(kz0 + 0.1, kz1, 1.2):
        a, b = WP("L", t, 7.3, 1.2), WP("L", t, 5.3, 1.2)
        cv.line(*a, *b, BROWN_0)
    cv.obj("kitchen", *[round(v) for v in (0, WP("L", kz1, 7.4)[1], WP("L", kz1, 0, 2.15)[0] + 2, H)])
    # fruit basket on the counter
    fx, fy = WP("L", 10.2, 3.15, 1.2)
    cv.ell(fx - 14, fy - 7, fx + 14, fy + 4, OAK_0)
    cv.line(fx - 13, fy - 2, fx + 13, fy - 2, OAK_DK)
    for (dx, dy, c) in ((-8, -10, CRT_0), (-1, -12, LEAF_3), (6, -10, GLOW), (2, -7, CRT_1), (-5, -6, GOLD)):
        cv.disc(fx + dx, fy + dy, 4, c)
        cv.px(fx + dx - 1, fy + dy - 2, CREAM)
    cv.poly([(fx + 9, fy - 14), (fx + 16, fy - 19), (fx + 18, fy - 16), (fx + 12, fy - 11)], GOLD)
    cv.obj("fruit_basket", fx - 14, fy - 19, fx + 18, fy + 4)
    # water jug (big blue bottle on the counter)
    jx, jy = WP("L", 8.6, 3.15, 1.0)
    cv.rect(jx - 9, jy - 30, jx + 9, jy, SLATE_1)
    cv.rect(jx - 7, jy - 36, jx + 7, jy - 30, SLATE_1)
    cv.rect(jx - 3, jy - 40, jx + 3, jy - 36, SLATE_2)
    cv.line(jx - 6, jy - 26, jx - 6, jy - 4, SLATE_2)
    cv.line(jx - 9, jy - 16, jx + 9, jy - 16, SLATE_0)
    cv.obj("water_jug", jx - 9, jy - 40, jx + 9, jy)


def big_plant(cv, x, y, scale, seed, rec):
    """Big leafy floor plant (fiddle-leaf / monstera mix)."""
    cv.rect(x - 14 * scale, y - 26 * scale, x + 14 * scale, y, TERRA_1)
    cv.rect(x - 14 * scale, y - 26 * scale, x + 14 * scale, y - 23 * scale, TERRA_2)
    cv.line(x + 10 * scale, y - 22 * scale, x + 10 * scale, y, TERRA_0)
    r = rng(seed)
    for k in range(28):
        ang = r.uniform(-2.9, -0.25)
        ln = r.uniform(30, 95) * scale
        ex, ey = x + math.cos(ang) * ln, y - 26 * scale + math.sin(ang) * ln
        cv.line(x, y - 26 * scale, ex, ey, LEAF_0)
        lw, lh = r.uniform(6, 11) * scale, r.uniform(4, 7) * scale
        cv.ell(ex - lw, ey - lh, ex + lw, ey + lh, LEAF_1)
        cv.ell(ex - lw + 2, ey - lh, ex + lw - 2, ey, LEAF_2 if k % 2 else LEAF_1)
        cv.line(ex - lw + 2, ey, ex + lw - 2, ey, LEAF_0)
    cv.obj(rec, x - 100 * scale, y - 125 * scale, x + 100 * scale, y)


# ------------------------------------------------------------------ right wall
def right_side(cv):
    # computer desk along the wall (back)
    za, zb = 18.6, 23.4
    wbox(cv, "R", za, zb, 2.4, 2.5, 2.7, OAK_1, OAK_0, OAK_0)
    for t in (za + 0.1, zb - 0.2):
        a, b = WP("R", t, 2.5, 2.3), WP("R", t, 0, 2.3)
        cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], OAK_DK)
    tower = wbox(cv, "R", za + 0.3, za + 1.3, 1.8, 0, 1.9, BROWN_1, INK, BROWN_1)
    p = WP("R", za + 0.8, 1.6, 1.8)
    for k in range(3):
        cv.px(p[0] - 1 + k, p[1] + 1, [CRT_1, GLOW, SLATE_2][k])
    # monitors (two), whiteboard
    for (m0, m1, col) in ((19.6, 21.2, SLATE_0), (21.4, 23.0, SLATE_0)):
        wbox(cv, "R", m0, m1, 1.3, 3.2, 4.8, INK, INK, INK)
        q = [WP("R", m0 + 0.08, 4.7, 1.32), WP("R", m1 - 0.08, 4.7, 1.32), WP("R", m1 - 0.08, 3.3, 1.32), WP("R", m0 + 0.08, 3.3, 1.32)]
        cv.poly(q, col)
        for k in range(5):
            hh = 4.5 - k * 0.22
            a, b = WP("R", m0 + 0.25, hh, 1.33), WP("R", m0 + 0.25 + (0.4 + 0.5 * ((k * 3) % 4) / 3), hh, 1.33)
            cv.line(*a, *b, [SLATE_2, LEAF_3, SLATE_1, GLOW, SLATE_2][k])
        a, b = WP("R", (m0 + m1) / 2, 3.2, 1.0), WP("R", (m0 + m1) / 2, 2.7, 1.0)
        cv.line(*a, *b, INK)
    kb = [WP("R", 20.2, 2.72, 1.6), WP("R", 22.3, 2.72, 1.6), WP("R", 22.3, 2.72, 2.2), WP("R", 20.2, 2.72, 2.2)]
    cv.poly(kb, BROWN_1)
    cv.line(*kb[0], *kb[1], PLUM_2)   # keyboard RGB strip
    xs = [WP("R", z, h, o)[0] for z in (za, zb) for h in (0, 4.8) for o in (0, 2.4)]
    ys = [WP("R", z, h, o)[1] for z in (za, zb) for h in (0, 4.8) for o in (0, 2.4)]
    cv.obj("computer_setup", min(xs), min(ys), max(xs), max(ys))
    q = wquad(cv, "R", 19.0, 23.2, 5.4, 8.4, SLATE_2)   # product whiteboard
    wquad(cv, "R", 19.08, 23.12, 5.48, 8.32, CREAM)
    pts = [(19.5, 7.6), (20.3, 7.8), (21.2, 7.3), (22.4, 7.7)]
    for (z, h), (z2, h2) in zip(pts, pts[1:]):
        cv.line(*WP("R", z, h), *WP("R", z2, h2), SLATE_0)
    for z, h in pts:
        p = WP("R", z, h)
        cv.rect(p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1, CRT_0)
    for k, z in enumerate((19.4, 20.4, 21.4, 22.4)):   # flow boxes + arrows (symbols only)
        wquad(cv, "R", z, z + 0.6, 6.0, 6.6, [SLATE_1, LEAF_2, GLOW, PLUM_2][k])
        if k < 3:
            cv.line(*WP("R", z + 0.65, 6.3), *WP("R", z + 0.95, 6.3), INK)
    for z in (19.4, 20.6):
        cv.line(*WP("R", z, 5.75), *WP("R", z + 0.8, 5.75), BROWN_1)
    cv.obj("product_whiteboard", *q)
    # braided money tree on the desk
    mt = WP("R", za + 0.6, 2.7, 1.3)
    x, y = mt
    cv.rect(x - 5, y - 7, x + 5, y, CREAM)
    cv.line(x - 5, y - 7, x + 5, y - 7, SLATE_2)
    for k in range(16):
        cv.px(x - 1 + (1 if (k // 2) % 2 else -1), y - 8 - k, OAK_1)
        cv.px(x + 1 + (-1 if (k // 2) % 2 else 1), y - 8 - k, OAK_0)
    for (dx, dy) in ((-8, -26), (-3, -31), (4, -29), (9, -24), (0, -22), (-6, -20), (7, -18)):
        cv.ell(x + dx - 4, y + dy - 2, x + dx + 4, y + dy + 2, LEAF_2)
        cv.px(x + dx - 1, y + dy - 1, LEAF_3)
    cv.obj("money_tree", x - 12, y - 34, x + 13, y)
    # relic wall bracket near the gym (empty, subtle plus)
    q = wquad(cv, "R", 17.6, 18.3, 5.0, 5.8, BROWN_0)
    wquad(cv, "R", 17.68, 18.22, 5.08, 5.72, OAK_0)
    mx, my = WP("R", 17.95, 5.4)
    cv.line(mx - 2, my, mx + 2, my, OAK_2); cv.line(mx, my - 2, mx, my + 2, OAK_2)
    cv.obj("relic_bracket_gym", *q)
    # medal wall
    q = wquad(cv, "R", 15.0, 17.2, 6.4, 8.0, BROWN_0)
    for k in range(6):
        z = 15.25 + k * 0.33
        a = WP("R", z, 7.9)
        b = WP("R", z, 7.0 - (k % 2) * 0.3)
        cv.line(*a, *b, [CRT_0, SLATE_1, LEAF_2, PLUM_2, GLOW, SLATE_2][k])
        cv.disc(round(b[0]), round(b[1]) + 3, 3, GOLD if k % 3 else SLATE_2)
        cv.px(b[0] - 1, b[1] + 2, SUN if k % 3 else CREAM)
    cv.obj("medal_wall", *q)
    # mileage poster (bars, no words)
    q = wquad(cv, "R", 15.0, 17.0, 3.9, 6.1, CREAM)
    for k in range(7):
        z = 15.2 + k * 0.25
        hh = 4.2 + 0.25 * k + 0.25 * ((k * 5) % 3)
        cv.poly([WP("R", z, 4.1), WP("R", z + 0.16, 4.1), WP("R", z + 0.16, hh), WP("R", z, hh)], CRT_0 if k == 6 else TERRA_2)
    cv.line(*WP("R", 15.15, 4.1), *WP("R", 16.9, 4.1), INK)
    cv.obj("mileage_poster", *q)
    # hanging race bib
    q = wquad(cv, "R", 17.4, 18.2, 3.2, 3.9, CREAM)
    wquad(cv, "R", 17.4, 18.2, 3.75, 3.9, CRT_0)
    for z in (17.6, 17.8, 18.0):
        cv.line(*WP("R", z, 3.6), *WP("R", z, 3.35), INK)
    cv.line(*WP("R", 17.45, 3.9), *WP("R", 17.8, 4.3), INK)
    cv.line(*WP("R", 18.15, 3.9), *WP("R", 17.8, 4.3), INK)
    cv.obj("race_bib", *q)
    # weight rack (front of computer area)
    wr = wbox(cv, "R", 14.0, 15.6, 1.6, 0, 3.0, INK, INK, BROWN_1, "weight_rack")
    for k, hh in enumerate((0.6, 1.5, 2.4)):
        a, b = WP("R", 14.05, hh, 1.62), WP("R", 15.55, hh, 1.62)
        cv.line(*a, *b, BROWN_1)
        for j in range(3):
            z = 14.3 + j * 0.45
            p = WP("R", z, hh + 0.25, 1.65)
            r_ = 4 + (2 - k)
            cv.disc(round(p[0]), round(p[1]), r_, INK)
            cv.disc(round(p[0]), round(p[1]), r_ - 2, SLATE_0 if j % 2 else BROWN_1)
            cv.px(p[0] - 1, p[1] - r_ + 1, SLATE_1)
    # running shoes on the floor
    for k, z in enumerate((13.2, 12.6)):
        p = P(XR(z) - 1.4 - 0.4 * k, 0, z)
        cv.poly([(p[0] - 10, p[1]), (p[0] + 11, p[1]), (p[0] + 9, p[1] - 6), (p[0] - 2, p[1] - 9), (p[0] - 9, p[1] - 6)], CRT_0)
        cv.line(p[0] - 10, p[1], p[0] + 11, p[1], CREAM)
        cv.line(p[0] - 4, p[1] - 6, p[0] + 2, p[1] - 6, CREAM)
        cv.px(p[0] + 7, p[1] - 4, SLATE_2)
    a = P(XR(13.2) - 1.4, 0, 13.2)
    cv.obj("running_shoes", a[0] - 14, a[1] - 10, a[0] + 16, P(0, 0, 12.6)[1])
    # road bike on wall hooks, tarp half draped, emblem below
    bz0, bz1 = 8.6, 13.6
    off = 0.6

    def B(z, h):
        return WP("R", z, h, off)

    r1 = 1.15
    for zc in (bz0 + 1.2, bz1 - 1.2):
        pts = [B(zc + r1 * math.cos(t), 4.9 + r1 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 40)]
        cv.d.line([(round(x), round(y)) for x, y in pts], fill=INK, width=3)
        cv.d.line([(round(x), round(y)) for x, y in pts], fill=SLATE_0, width=1)
        c = B(zc, 4.9)
        for t in np.linspace(0, math.pi, 6):
            e = B(zc + r1 * math.cos(t), 4.9 + r1 * math.sin(t))
            e2 = B(zc - r1 * math.cos(t), 4.9 - r1 * math.sin(t))
            cv.line(*e, *e2, BROWN_1)
        cv.disc(round(c[0]), round(c[1]), 2, SLATE_1)
    rz, fz = bz1 - 1.2, bz0 + 1.2   # rear wheel at back, front toward viewer
    bb = B(rz - 1.5, 4.9)
    seat = B(rz - 0.75, 6.75)
    head = B(fz + 0.6, 6.65)
    for a_, b_ in ((B(rz, 4.9), bb), (bb, seat), (seat, B(rz, 4.9)), (seat, head), (bb, head), (head, B(fz, 4.9))):
        cv.d.line([round(a_[0]), round(a_[1]), round(b_[0]), round(b_[1])], fill=CRT_0, width=2)
    sd = B(rz - 0.8, 7.1)
    cv.d.line([round(sd[0]) - 7, round(sd[1]), round(sd[0]) + 6, round(sd[1])], fill=INK, width=2)
    hb = B(fz + 0.4, 7.0)
    cv.line(*head, *hb, INK)
    cv.d.arc([round(hb[0]) - 10, round(hb[1]) - 2, round(hb[0]), round(hb[1]) + 8], 180, 300, fill=INK)
    cv.disc(round(bb[0]), round(bb[1]), 3, SLATE_1)
    # hooks
    for z in (bz0 + 1.6, bz1 - 1.6):
        a, b = WP("R", z, 6.9), B(z, 6.4)
        cv.line(*a, *b, BROWN_1)
    # tarp over the rear half
    tp = [B(rz + 1.35, 6.0), B(rz + 0.6, 7.4), B(rz - 1.0, 7.55), B(rz - 1.9, 7.0), B(rz - 2.1, 5.2),
          B(rz - 1.7, 3.5), B(rz - 1.2, 3.9), B(rz - 0.6, 3.4), B(rz + 0.1, 3.95), B(rz + 0.8, 3.45), B(rz + 1.4, 4.4)]
    cv.poly(tp, SLATE_0)
    for k in range(5):
        z = rz - 1.6 + k * 0.65
        cv.line(*B(z, 7.2), *B(z - 0.15 + (k % 2) * 0.3, 3.8), INK)
    cv.line(*B(rz - 1.0, 7.5), *B(rz + 0.6, 7.35), SLATE_1)
    cv.line(*B(rz - 1.9, 6.9), *B(rz - 1.0, 7.5), SLATE_1)
    xs = [B(z, h)[0] for z in (bz0, bz1) for h in (3.4, 7.6)]
    ys = [B(z, h)[1] for z in (bz0, bz1) for h in (3.4, 7.6)]
    cv.obj("road_bike_tarp", min(xs), min(ys), max(xs), max(ys))
    # swim/bike/run emblem below (three linked rounded tiles, original mark)
    q = wquad(cv, "R", 9.8, 12.4, 2.0, 2.9, INK)
    for k, (col, z) in enumerate(((SLATE_1, 9.95), (CRT_0, 10.8), (GLOW, 11.65))):
        wquad(cv, "R", z, z + 0.65, 2.1, 2.8, col)
        cx, cy = WP("R", z + 0.32, 2.45)
        if k == 0:
            cv.line(cx - 3, cy + 1, cx + 3, cy + 1, INK); cv.line(cx - 2, cy - 1, cx + 2, cy - 1, INK)
        elif k == 1:
            cv.px(cx - 2, cy + 1, INK); cv.px(cx + 2, cy + 1, INK); cv.line(cx - 2, cy + 1, cx + 2, cy - 1, INK)
        else:
            cv.line(cx, cy - 2, cx - 1, cy + 2, INK); cv.line(cx, cy, cx + 2, cy + 2, INK)
    cv.obj("tri_emblem", *q)


# ------------------------------------------------------------------ floor pieces + foreground
def rug(cv):
    pts = [P(-3.9, 0, 23.0), P(-0.9, 0, 23.0), P(-0.3, 0, 12.0), P(-4.5, 0, 12.0)]
    cv.poly(pts, TERRA_0)
    inner = [P(-3.65, 0, 22.8), P(-1.15, 0, 22.8), P(-0.62, 0, 12.3), P(-4.18, 0, 12.3)]
    cv.poly(inner, TERRA_1)
    for t in (0.3, 0.7):
        X0 = -3.65 + t * 2.5
        X1 = -4.18 + t * 3.56
        cv.line(*P(X0, 0, 22.8), *P(X1, 0, 12.3), BROWN_2)
    for z in np.arange(13.0, 22.5, 1.6):
        a, b = P(-3.6, 0, z), P(-1.2 + (-0.6 + 1.15) * 0, 0, z)
        a = P(-3.65 - 0.05 * (22.8 - z), 0, z)
        b = P(-1.15 + 0.05 * (22.8 - z), 0, z)
        cv.line(*a, *b, PLUM_1)
        cv.px((a[0] + b[0]) / 2, a[1], GLOW)
    for k in range(0, 40, 3):
        x = pts[3][0] + k * (pts[2][0] - pts[3][0]) / 40
        cv.line(x, pts[3][1], x, pts[3][1] + 2, CREAM)
    cv.obj("rug", pts[3][0], pts[0][1], pts[2][0], pts[2][1] + 3)


def foreground(cv):
    # speaker bottom-left (crop)
    cv.rect(0, 410, 78, H, INK)
    cv.rect(0, 410, 78, 413, BROWN_1)
    cv.rect(76, 410, 78, H, BROWN_1)
    cv.disc(36, 470, 26, VOID)
    cv.disc(36, 470, 23, BROWN_1)
    cv.disc(36, 470, 9, INK)
    cv.disc(34, 468, 3, BROWN_2)
    cv.disc(36, 428, 8, VOID); cv.disc(36, 428, 4, BROWN_1)
    cv.px(66, 520, CRT_1)
    cv.obj("fg_speaker", 0, 410, 79, H)
    # big plant leaf bottom-left
    for k, (x0, y0, x1, y1) in enumerate(((60, 540, 150, 470), (90, 540, 190, 500), (40, 520, 120, 440))):
        cv.poly([(x0, y0), ((x0 + x1) / 2 - 12, (y0 + y1) / 2 - 14), (x1, y1), ((x0 + x1) / 2 + 12, (y0 + y1) / 2 + 10)], LEAF_0)
        cv.line(x0, y0, x1, y1, LEAF_1)
    cv.obj("fg_plant_leaf", 40, 440, 190, H)
    # chair back bottom-right
    cv.rect(820, 430, 900, H, INK)
    cv.rect(826, 436, 894, H, BROWN_1)
    for k in range(4):
        cv.line(830, 450 + k * 20, 890, 450 + k * 20, INK)
    cv.line(820, 430, 900, 430, TERRA_1)
    cv.obj("fg_chair_back", 820, 430, 901, H)
    # boxes bottom-right
    cv.rect(890, 470, W, H, OAK_0)
    cv.rect(890, 470, W, 474, OAK_1)
    cv.rect(920, 470, 926, H, AMBER)  # tape
    cv.rect(900, 495, 916, 505, CREAM)   # label (blank lines)
    cv.line(902, 498, 914, 498, BROWN_1); cv.line(902, 501, 910, 501, BROWN_1)
    cv.rect(905, 420, W, 470, OAK_DK)
    cv.rect(905, 420, W, 423, OAK_0)
    cv.line(930, 424, 930, 470, OAK_0)
    cv.obj("fg_boxes", 890, 420, W, H)
    # cables snaking into frame
    for k, (sx, sy, ex, ey) in enumerate(((150, 540, 420, 380), (780, 540, 610, 365), (0, 395, 200, 420))):
        pts = []
        for t in np.linspace(0, 1, 60):
            x = sx + (ex - sx) * t + 18 * math.sin(t * 7 + k)
            y = sy + (ey - sy) * t + 6 * math.sin(t * 11 + k)
            pts.append((round(x), round(y)))
        cv.d.line(pts, fill=VOID, width=2)
    cv.obj("fg_cables", 0, 365, W, H)


# ------------------------------------------------------------------ light pass
def light(cv, win_rect, statue_m, light_on, niche):
    a = np.array(cv.im)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    L = np.zeros((H, W), np.float32)
    wx0, wy0, wx1, wy1 = win_rect
    in_win = (xx >= wx0) & (xx <= wx1) & (yy >= wy0) & (yy <= wy1)
    # global ambient: darker toward ceiling / bottom; vignette outer 15%
    L -= 0.6
    L -= np.clip((150 - yy) / 150, 0, 1) * 0.9
    vx = np.clip(np.maximum(144 - xx, xx - (W - 144)) / 144, 0, 1)
    vy = np.clip(np.maximum(81 - yy, yy - (H - 81)) / 81, 0, 1)
    L -= np.maximum(vx, vy) * 1.6
    # sun patch on the floor: window projected toward the viewer/left
    def floor_xy(X, Z):
        return P(X, 0, Z)
    sp = [floor_xy(-0.2, 22.5), floor_xy(5.6, 22.5), floor_xy(3.4, 15.0), floor_xy(-3.6, 15.0)]
    m_im = Image.new("1", (W, H), 0)
    ImageDraw.Draw(m_im).polygon([(round(x), round(y)) for x, y in sp], fill=1)
    sun = np.array(m_im, bool)
    # mullion shadow inside the patch
    ms = [floor_xy(2.2, 22.5), floor_xy(2.6, 22.5), floor_xy(0.0, 15.0), floor_xy(-0.4, 15.0)]
    m2 = Image.new("1", (W, H), 0)
    ImageDraw.Draw(m2).polygon([(round(x), round(y)) for x, y in ms], fill=1)
    L += np.where(sun & ~np.array(m2, bool), 2.6, 0)
    # warm wash on the back wall around the window
    cxw, cyw = (wx0 + wx1) / 2, (wy0 + wy1) / 2
    d = np.sqrt(((xx - cxw) / 150) ** 2 + ((yy - cyw) / 120) ** 2)
    L += np.clip(1.0 - d, 0, 1) * 1.4

    def pool(x, y, rx, ry, amt):
        dd = np.sqrt(((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2)
        return np.clip(1.0 - dd, 0, 1) * amt

    rl = P(-11.9, 0, 22.8)
    L += pool(rl[0], rl[1] - 30, 70, 60, 1.4)                    # reading lamp
    dl = P(10.6, 2.7, 24.6)
    L += pool(dl[0] - 10, dl[1], 70, 40, 1.5)                    # desk lamp
    for X, Z in ((-6.5, 21.2), (10.0, 21.5)):                     # pendants
        p = P(X, 0, Z)
        L += pool(p[0], p[1], 55, 18, 1.0)
    crt = P(5.9, 3.5, 24.4)
    L += pool(crt[0], crt[1] + 60, 70, 60, 0.9)                  # CRT spill
    g = WP("L", 23.0, 1.0, 1.4)
    L += pool(g[0], g[1], 24, 24, 1.0)                           # plasma globe (<=24 px)
    L += pool(niche[0], niche[1] - 20, 24, 24, 1.0)              # niche ember light
    # skylight beam (soft column onto the floor centre)
    sk = P(0.8, 0, 19.5)
    L += pool(sk[0], sk[1], 60, 14, 0.8)
    if light_on:
        x, y = P(-2.4, CEIL, 24.2)
        fy = P(0, 0, 23.8)[1]
        cone = (yy > y + 4) & (yy < fy) & (np.abs(xx - x) < 6 + (yy - y) * 0.27)
        L += np.where(cone, 1.0, 0) + np.where(cone & (np.abs(xx - x) < 3 + (yy - y) * 0.16), 0.6, 0)
        L += np.where(statue_m, 0.0, 0)
        L += pool(x, fy, 70, 14, 1.2)
    L[in_win] = 0
    steps = np.floor(L + BAY).astype(np.int32)
    steps = np.clip(steps, -3, 3)
    out = a.copy()
    for k in range(3):
        up = steps > k
        out[up] = LUT_UP[out[up]]
        dn = steps < -k
        out[dn] = LUT_DN[out[dn]]
    # statue gold stays bright (the brightest thing after the window)
    out[statue_m] = a[statue_m]
    cv.im = Image.fromarray(out)
    cv.d = ImageDraw.Draw(cv.im)
    if light_on:
        x, y = P(-2.4, CEIL, 24.2)
        r = rng(77)
        for k in range(14):  # dust motes in the cone
            yy_ = y + 20 + r.uniform(0, 220)
            xx_ = x + r.uniform(-1, 1) * (4 + (yy_ - y) * 0.22)
            cv.px(xx_, yy_, CREAM if k % 3 else GLOW)
        # a few rising embers stay with the relic (drawn in medal())


# ------------------------------------------------------------------ scene
def paint(light_on: bool, relic: bool) -> Canvas:
    cv = Canvas()
    shell(cv)
    rug(cv)
    beams(cv)
    string_lights(cv)
    pothos(cv, round(P(-8.5, CEIL - 0.7, 22.0)[0]), round(P(0, CEIL - 0.7, 22.0)[1]) + 4, 60, 3, "pothos_left")
    pothos(cv, round(P(9.0, CEIL - 0.7, 22.0)[0]), round(P(0, CEIL - 0.7, 22.0)[1]) + 4, 70, 8, "pothos_right")
    pothos(cv, round(P(-11.0, CEIL - 0.7, 18.8)[0]), round(P(0, CEIL - 0.7, 18.8)[1]) + 4, 50, 12, "pothos_corner")
    library(cv)
    win, niche = window(cv, relic)
    crt_stack(cv)
    study(cv)
    reading_corner(cv)
    smask, _ = statue(cv, light_on)
    dl = downlight(cv, light_on)
    pendant(cv, -6.5, 21.2, 3.2, "pendant_chess")
    pendant(cv, 10.0, 21.5, 3.0, "pendant_study")
    left_side(cv)
    right_side(cv)
    bp = P(XL(9.2) + 1.6, 0, 9.2)
    big_plant(cv, bp[0] + 30, bp[1], 1.0, 17, "big_plant")
    light(cv, win, smask, light_on, niche)
    foreground(cv)
    # vignette also over the foreground crops
    a = np.array(cv.im)
    yy, xx = np.mgrid[0:H, 0:W]
    edge = np.maximum(np.clip(np.maximum(60 - xx, xx - (W - 60)) / 60, 0, 1), np.clip((yy - (H - 40)) / 40, 0, 1))
    dn = (edge + BAY) > 1.2
    a[dn] = LUT_DN[a[dn]]
    cv.im = Image.fromarray(a)
    cv.d = ImageDraw.Draw(cv.im)
    return cv


def to_sprite(cv, box_=None):
    a = np.array(cv.im)
    if box_:
        x0, y0, x1, y1 = box_
        a = a[y0:y1, x0:x1]
    rgb = RGB[a]
    rgba = np.dstack([rgb, np.full(a.shape, 255, np.uint8)])
    s = room.Sprite(a.shape[1], a.shape[0], palette=HEXES, snap=True)
    s.frames[0].cels["main"] = Image.fromarray(rgba, "RGBA")
    return s


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    proposal = {
        "_note": "Proposal: swap 4 rarely-used / near-duplicate entries of art/room/common/palette.json for honey-oak wood "
                 "tones (still 32 colours). Usage counts are pixels across the current prototype art.",
        "swaps": [
            {"slot": 2, "old": ["INK_COOL", "#161D1B"], "new": ["OAK_0", "#5C3721"], "why": "near-duplicate of INK (8080 px)"},
            {"slot": 16, "old": ["ROSE_0", "#815A50"], "new": ["OAK_1", "#7E4C27"], "why": "muted mauve, same value as the new floor mid"},
            {"slot": 17, "old": ["ROSE_1", "#AF5D4D"], "new": ["OAK_2", "#A56A32"], "why": "near-duplicate of TERRA_2 (3537 px)"},
            {"slot": 25, "old": ["PLUM_0", "#3A292F"], "new": ["OAK_DK", "#45291A"], "why": "near-duplicate of BROWN_1/BROWN_2; not a category colour"},
        ],
        "lut_patches": {"R1": {"OAK_2": "OAK_1", "OAK_1": "OAK_0"}, "NIGHT": {"OAK_2": "OAK_0", "OAK_1": "OAK_DK"},
                        "DIM": {"OAK_2": "OAK_1"},
                        "replace_targets": "every LUT value PLUM_0 -> BROWN_1, ROSE_0 -> OAK_DK"},
        "colors": [[n, h] for n, h in zip(NAMES, HEXES)],
    }
    (HERE / "palette-proposal.json").write_text(json.dumps(proposal, indent=1))

    full = paint(light_on=False, relic=False)
    s = to_sprite(full)
    s.save_png(str(OUT / "full-room.png"))
    s.save_png(str(OUT / "full-room@2x.png"), scale=2)
    lit = paint(light_on=True, relic=True)
    crop = (268, 68, 780, 356)  # 512x288 window zone (statue + window + niche + CRTs)
    z = to_sprite(lit, crop)
    z.save_png(str(OUT / "window-zone.png"))
    z.save_png(str(OUT / "window-zone@2x.png"), scale=2)
    gray = Image.open(OUT / "full-room.png").convert("L")
    gray.save(OUT / "preview-gray.png")
    luma = np.array(gray, np.float32)
    dark = float((luma <= 96).mean())
    objs = dict(full.objects)
    for k in ("relic_medal",):
        if k in lit.objects:
            objs[k] = lit.objects[k]
    objs["_window_zone_crop"] = [crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1]]
    (HERE / "objects.json").write_text(json.dumps({"internal": [W, H], "rects_xywh": objs}, indent=0))
    print(f"dark share (luma <= 96): {dark:.3f}; objects: {len(objs)}")


if __name__ == "__main__":
    main()
