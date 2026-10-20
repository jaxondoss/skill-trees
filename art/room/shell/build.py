#!/usr/bin/env python3
"""FORGE v3 room, part "shell": the room everything else sits on.

L0 sky (golden hour + night), L1 New Orleans through the window (day, night, fall), the painted room shell
(back wall, raked side walls, ceiling with conduit, terracotta floor in one-point perspective with the window
reflection and a sunbeam) split into parallax bands L2..L5, the window frame with blinds (L2), ceiling
fixtures (AC, two pendants, fan) and the L6 frame crops.

Run: python3 art/room/shell/build.py     (deterministic: every random choice uses a fixed seed or a hash)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

import numpy as np  # noqa: E402

PART = "shell"
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h in HEX.items()}
IDX = {n: i for i, n in enumerate(NAMES)}
B4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])


def bay(x: int, y: int) -> float:
    """4x4 Bayer threshold anchored to WORLD coordinates (same grid as the engine's LUT dissolve)."""
    return (B4[y % 4][x % 4] + 0.5) / 16


def hsh(*v: int) -> float:
    """Deterministic 0..1 hash of integers (no global RNG anywhere in this script)."""
    h = 2166136261
    for a in v:
        h = ((h ^ (int(a) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535


class Pen:
    """World-space pen on a palette-locked sprite (spr). Colours are palette NAMES. The sprite's top-left
    pixel sits at world (ox, oy); every call takes world coordinates and forwards to the Sprite method."""

    def __init__(self, w: int, h: int, ox: int, oy: int):
        self.s = spr(w, h)
        self.w, self.h, self.ox, self.oy = w, h, ox, oy

    @staticmethod
    def c(n):
        return None if n is None else HEX[n]

    def o(self, only):
        return only if only in (None, "opaque", "empty") else HEX[only]

    def px(self, x, y, n, only=None):
        self.s.px(round(x) - self.ox, round(y) - self.oy, self.c(n), only=self.o(only))

    def line(self, x0, y0, x1, y1, n, only=None):
        self.s.line(round(x0) - self.ox, round(y0) - self.oy, round(x1) - self.ox, round(y1) - self.oy, self.c(n),
                    only=self.o(only))

    def rect(self, x0, y0, x1, y1, n, fill=True, only=None):
        self.s.rect(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, self.c(n), fill=fill, only=self.o(only))

    def poly(self, pts, n, only=None):
        self.s.polygon([(round(x) - self.ox, round(y) - self.oy) for x, y in pts], self.c(n), only=self.o(only))

    def circ(self, cx, cy, r, n, fill=True, only=None):
        self.s.circle(cx - self.ox, cy - self.oy, r, self.c(n), fill=fill, only=self.o(only))

    def ell(self, x0, y0, x1, y1, n, only=None):
        self.s.ellipse(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, self.c(n), only=self.o(only))

    def dither(self, x0, y0, x1, y1, c1, c2, mix=0.5, only=None):
        a = c1 if c1 == "keep" else self.c(c1)
        b = c2 if c2 == "keep" else self.c(c2)
        # shift so the Bayer grid stays anchored to world coordinates
        self.s.dither(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, a, b, mix=mix, only=self.o(only))

    def grad(self, x0, y0, x1, y1, names, only=None):
        self.s.gradient_dither(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, [HEX[n] for n in names],
                               only=self.o(only))

    def get(self, x, y):
        v = self.s.get(round(x) - self.ox, round(y) - self.oy)
        return None if v is None else RGB2N[tuple(v[:3])]

    def inside(self, x, y):
        return 0 <= x - self.ox < self.w and 0 <= y - self.oy < self.h

    def sag(self, x0, y0, x1, y1, sag, n, only=None):
        """A hanging wire: straight chord plus a parabolic sag, drawn as 1 px Bresenham steps."""
        steps = max(2, int(abs(x1 - x0)))
        pts = []
        for i in range(steps + 1):
            t = i / steps
            pts.append((round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t + 4 * sag * t * (1 - t))))
        for a, b in zip(pts, pts[1:]):
            self.line(a[0], a[1], b[0], b[1], n, only=only)

    def rim(self, match, n, dx, dy, prob=1.0, seed=0, box=None):
        """Light the edge of a form: opaque pixels of a colour in `match` whose (dx, dy) neighbour is empty
        (or a colour not in match) take colour n. prob < 1 breaks the rim into clusters."""
        x0, y0, x1, y1 = box or (self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1)
        hits = []
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c in match:
                    nb = self.get(x + dx, y + dy) if self.inside(x + dx, y + dy) else None
                    if nb not in match and (prob >= 1 or hsh(seed, x // 2, y) < prob):
                        hits.append((x, y))
        for x, y in hits:
            self.px(x, y, n)

    def recolor(self, mapping, box=None):
        x0, y0, x1, y1 = box or (self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c in mapping:
                    self.px(x, y, mapping[c])


# =============================================================== L0 sky
SUN_C = (337, 113)
SUN_R = 8
SKY = (260, 46, 132, 130)  # x, y, w, h: window 284..368 x 70..152 plus a 24 px parallax margin


def cloud(P: Pen, blobs, body, rim, top=None, seed=0, rimprob=0.85):
    """A cloud from ellipses (x0, y0, x1, y1); lit from BELOW by the low sun (bright underside rim)."""
    tmp = Pen(P.w, P.h, P.ox, P.oy)
    for b in blobs:
        tmp.ell(*b, body)
    tmp.rim({body}, rim, 0, 1, prob=rimprob, seed=seed)
    if top:
        tmp.rim({body}, top, 0, -1, prob=0.6, seed=seed + 1)
    for y in range(P.oy, P.oy + P.h):
        for x in range(P.ox, P.ox + P.w):
            c = tmp.get(x, y)
            if c:
                P.px(x, y, c)


def draw_sky(mode: str) -> Pen:
    x0, y0, w, h = SKY
    P = Pen(w, h, x0, y0)
    x1, y1 = x0 + w - 1, y0 + h - 1
    if mode == "night":
        bands = [(y0, "INK"), (88, "PLUM_0"), (124, "PLUM_1")]
    else:
        bands = [(y0, "ROSE_0"), (76, "ROSE_1"), (93, "ORANGE"), (107, "GLOW")]
    for i, (by, n) in enumerate(bands):
        end = bands[i + 1][0] - 1 if i + 1 < len(bands) else y1
        P.rect(x0, by, x1, end, n)
    for i in range(1, len(bands)):
        by = bands[i][0]
        P.grad(x0, by - 3, x1, by + 2, [bands[i - 1][1], bands[i][1]])
    if mode == "night":
        # moon, a few stars, one moonlit streak
        P.circ(299, 84, 4, "CREAM")
        P.px(298, 83, "SLATE_2"); P.px(301, 85, "SLATE_2"); P.px(300, 86, "SLATE_2"); P.px(299, 86, "SLATE_2")
        for i in range(16):
            sx = x0 + 6 + int(hsh(7, i) * (w - 12))
            sy = y0 + 4 + int(hsh(8, i) * 52)
            if abs(sx - 299) > 8 or abs(sy - 84) > 8:
                P.px(sx, sy, "CREAM" if i % 3 == 0 else "PLUM_3")
        cloud(P, [(262, 96, 300, 99), (284, 94, 316, 98), (330, 102, 380, 105)], "PLUM_0", "PLUM_1", seed=3)
        return P
    # golden hour: halo then the disc
    P.circ(SUN_C[0], SUN_C[1], SUN_R + 2, "SUN", fill=False)
    P.dither(SUN_C[0] - SUN_R - 2, SUN_C[1] - SUN_R - 2, SUN_C[0] + SUN_R + 2, SUN_C[1] + SUN_R + 2,
             "keep", "GLOW", mix=0.5, only="SUN")
    P.circ(SUN_C[0], SUN_C[1], SUN_R, "SUN")
    # clouds, lit from below; brightest rims nearest the sun
    cloud(P, [(258, 58, 296, 66), (276, 54, 312, 63), (300, 60, 330, 66)], "ROSE_1", "GLOW", top="ROSE_0", seed=11)
    cloud(P, [(330, 66, 396, 72), (352, 63, 384, 69)], "ROSE_1", "GLOW", seed=12)
    cloud(P, [(284, 80, 334, 85), (300, 78, 322, 84), (318, 82, 360, 86)], "TERRA_2", "SUN", top="ROSE_1",
          seed=13)
    cloud(P, [(258, 92, 300, 96), (270, 90, 290, 95)], "RIM", "GLOW", seed=14)
    cloud(P, [(346, 98, 376, 101), (356, 96, 370, 100)], "RIM", "SUN", seed=15)
    cloud(P, [(318, 101, 334, 103)], "GLOW", "SUN", seed=16)
    # small lit puffs like the reference's broken cloud line
    for i, (px_, py_) in enumerate([(296, 72), (304, 74), (342, 77), (286, 88), (366, 90), (276, 76)]):
        P.rect(px_, py_, px_ + 2 + i % 2, py_, "TERRA_2")
        P.rect(px_, py_ + 1, px_ + 2 + i % 2, py_ + 1, "GLOW")
    return P


# =============================================================== L1 outside
OUT = (268, 54, 116, 114)

ROLES_DAY = dict(far="ROSE_0", far_dk="PLUM_1", far_rim="RIM", face="SLATE_1", side="SLATE_0", trim="INK_COOL",
                 ridge="GLOW", win="INK_COOL", win_lit="INK_COOL", street="INK_COOL", rail="SLATE_0",
                 car="CRT_0", car_dk="TERRA_0", car_win="GLOW", car_lit="CREAM", pole="INK", wire="INK",
                 t0="LEAF_0", t1="LEAF_1", t2="LEAF_2", trim_leaf="GLOW", moss="ROSE_0", grass="LEAF_1",
                 grass_lit="LEAF_2", lamp="BROWN_0", lamp_lit="BROWN_0", trunk="INK")
ROLES_NIGHT = dict(ROLES_DAY, far="PLUM_0", far_dk="INK_COOL", far_rim="PLUM_0", face="SLATE_0", side="INK_COOL",
                   trim="INK", ridge="SLATE_0", win="INK", win_lit="SUN", street="INK", rail="INK_COOL",
                   car_win="SUN", car_lit="SUN", pole="VOID", wire="VOID", t0="INK_COOL", t1="LEAF_0",
                   t2="LEAF_1", trim_leaf="LEAF_1", moss="INK_COOL", grass="LEAF_0", grass_lit="LEAF_0",
                   lamp="BROWN_0", lamp_lit="SUN", trunk="VOID")
ROLES_FALL = dict(ROLES_DAY, t0="TERRA_0", t1="TERRA_1", t2="AMBER", trim_leaf="GLOW", moss="ROSE_0",
                  grass="BROWN_2", grass_lit="TERRA_1")


def canopy(P: Pen, R: dict, blobs, seed: int, light=(-1, 1)):
    """Leaf mass from circles: dark clumps, mid clumps shifted toward the light, sparse light leaves, a rim
    (the rim pass is limited to the clumps' bounding box)."""
    for i, (cx, cy, r) in enumerate(blobs):
        P.circ(cx, cy, r, R["t0"])
    for i, (cx, cy, r) in enumerate(blobs):
        if r >= 3:
            P.circ(cx + light[0], cy - 1, r - 2, R["t1"], only=R["t0"])
    for i, (cx, cy, r) in enumerate(blobs):
        if r >= 4 and hsh(seed, i) > 0.4:
            P.circ(cx + light[0] * 2, cy - 2, max(1, r - 4), R["t2"], only=R["t1"])
    match = {R["t0"], R["t1"], R["t2"]}
    box = (max(P.ox, min(cx - r for cx, cy, r in blobs) - 1), max(P.oy, min(cy - r for cx, cy, r in blobs) - 1),
           min(P.ox + P.w - 1, max(cx + r for cx, cy, r in blobs) + 1),
           min(P.oy + P.h - 1, max(cy + r for cx, cy, r in blobs) + 1))
    P.rim(match, R["trim_leaf"], light[0], -1, prob=0.45, seed=seed, box=box)


def shotgun(P: Pen, R: dict, x: int, base: int, w: int, h: int, i: int, night: bool):
    """Front-gabled shotgun house: face, gable, side strip toward the vanishing point, two tall windows, porch."""
    gh = (w + 1) // 2
    top = base - h
    P.rect(x, top, x + w - 1, base, R["face"])
    for k in range(gh):  # gable rows narrow upward
        P.rect(x + k, top - gh + k, x + w - 1 - k, top - gh + k, R["face"])
    # roof edges: dark eaves, lit ridge
    P.line(x - 1, top, x + gh - 1, top - gh + 1, R["trim"])
    P.line(x + w, top, x + w - gh, top - gh + 1, R["trim"])
    P.px(x + gh - 1, top - gh, R["ridge"])
    P.px(x + w - gh, top - gh, R["ridge"])
    P.line(x + w - gh + 1, top - gh + 1, x + w, top, R["ridge"])  # sun-side slope catches the light
    side = 2 if x + w // 2 > 320 else -2  # we see the side facing the vanishing point
    sx = x - 2 if side < 0 else x + w
    if side > 0:
        sx = x + w + 1
    sx = x + w if side < 0 else x - 2
    P.rect(sx, top + 1, sx + 1, base, R["side"])
    # porch roof and posts
    py = top + h // 3
    P.rect(x - 1, py, x + w, py, R["trim"])
    P.px(x, py + 1, R["trim"]); P.px(x + w - 1, py + 1, R["trim"])
    # tall windows and door
    lit = night and hsh(31, i) > 0.45
    for k, wx in enumerate((x + 1, x + w - 3)):
        col = R["win_lit"] if (lit and k == 0) or (night and hsh(32, i, k) > 0.7) else R["win"]
        P.rect(wx, py + 2, wx + 1, min(base - 1, py + 5), col)
    if w >= 9:
        P.rect(x + w // 2 - 1, py + 3, x + w // 2, base, R["trim"])
    if hsh(33, i) > 0.55:  # camelback: taller rear block peeking over the roof
        P.rect(x + 2, top - gh - 3, x + w - 3, top - gh + 1, R["side"])
        P.px(x + w - 3, top - gh - 3, R["ridge"])


def draw_outside(mode: str) -> Pen:
    R = {"night": ROLES_NIGHT, "fall": ROLES_FALL}.get(mode, ROLES_DAY)
    night = mode == "night"
    x0, y0, w, h = OUT
    P = Pen(w, h, x0, y0)
    x1, y1 = x0 + w - 1, y0 + h - 1
    # far skyline: CBD towers on the left (sun stays in open sky), low roofs across
    for (a, top, b) in [(270, 100, 274), (276, 94, 280), (282, 104, 287), (289, 98, 292), (304, 108, 309),
                        (313, 110, 317)]:
        P.rect(a, top, b, 124, R["far"])
        P.line(b, top + 1, b, 124, R["far_rim"])
        if night:
            for yy in range(top + 2, 122, 3):
                if hsh(41, a, yy) > 0.6:
                    P.px(a + 1 + int(hsh(42, a, yy) * (b - a - 1)), yy, "AMBER")
    P.line(277, 90, 277, 93, R["far"])  # spire
    for i, xx in enumerate(range(x0, x1 + 1, 5)):
        hgt = 3 + int(hsh(43, i) * 5)
        P.rect(xx, 121 - hgt, xx + 4, 126, R["far_dk"] if i % 3 else R["far"])
    # shotgun row
    xx, i = x0 - 3, 0
    while xx < x1:
        wv = 8 + int(hsh(51, i) * 3)
        hv = 8 + int(hsh(52, i) * 4)
        shotgun(P, R, xx, 137, wv, hv, i, night)
        xx += wv + 3 + int(hsh(53, i) * 2)
        i += 1
    # street, rails, the streetcar and its wire
    P.rect(x0, 138, x1, 141, R["street"])
    P.line(x0, 141, x1, 141, R["rail"])
    P.line(x0, 124, x1, 125, R["wire"])
    cx = 299
    P.rect(cx, 131, cx + 19, 139, R["car"])
    P.rect(cx + 1, 130, cx + 18, 130, R["car_dk"])
    P.rect(cx, 138, cx + 19, 139, R["car_dk"])
    for k in range(5):
        P.rect(cx + 2 + k * 3, 133, cx + 3 + k * 3, 134, R["car_win"] if k != 2 or night else R["car_lit"])
    P.rect(cx + 17, 132, cx + 18, 136, R["car_dk"])  # door
    P.px(cx + 19, 136, "SUN" if night else "GLOW")  # headlight
    P.line(cx + 6, 129, cx + 11, 125, R["pole"])  # trolley pole
    P.px(cx + 3, 140, R["pole"]); P.px(cx + 16, 140, R["pole"])
    # neutral ground grass
    P.rect(x0, 142, x1, 145, R["grass"])
    for k in range(x0, x1, 3):
        if hsh(61, k) > 0.5:
            P.px(k, 142, R["grass_lit"])
    # street lamp
    P.line(352, 126, 352, 142, R["pole"])
    P.rect(349, 125, 352, 125, R["pole"])
    P.px(349, 126, R["lamp_lit"])
    if night:
        P.px(348, 126, "GLOW"); P.px(349, 127, "AMBER"); P.px(349, 141, "AMBER"); P.px(350, 141, "BROWN_2")
    # live oak: the big canopy top right, moss hanging, trunk behind the jamb
    P.rect(364, 96, 369, 150, R["trunk"])
    P.line(364, 104, 354, 96, R["trunk"]); P.line(364, 103, 354, 95, R["trunk"])
    canopy(P, R, [(380, 82, 10), (368, 80, 8), (358, 88, 6), (374, 96, 8), (384, 102, 7), (362, 98, 5),
                  (351, 86, 4), (378, 70, 9), (364, 70, 6), (352, 76, 4), (370, 108, 4), (384, 112, 4)],
           seed=71)
    for k in range(12):
        mx = 348 + int(hsh(72, k) * 36)
        my = 100 + int(hsh(73, k) * 12)
        if P.get(mx, my) in (R["t0"], R["t1"]):
            ln = 2 + int(hsh(74, k) * 4)
            P.line(mx, my + 1, mx, my + ln, R["moss"])
    # power pole (left pane) and wires across the sun
    P.rect(295, 92, 296, 152, R["pole"])
    P.rect(287, 99, 305, 99, R["pole"])
    P.rect(290, 104, 293, 108, R["pole"])  # transformer can
    for k, (ax, ty, sg) in enumerate([(287, 104, 6), (296, 109, 8), (305, 113, 9)]):
        P.px(ax, 98, R["pole"])
        P.sag(ax, 98, x1, ty, sg, R["wire"])
        P.sag(x0, 101 + k * 2, ax, 98, 2, R["wire"])
    P.sag(296, 101, 330, 120, 3, R["wire"])  # service drop to a house
    # small trees and the bushes along the bottom of the view
    canopy(P, R, [(272, 120, 6), (279, 116, 5), (285, 124, 5), (276, 128, 6)], seed=81, light=(1, 1))
    canopy(P, R, [(348, 132, 5), (356, 128, 6), (362, 134, 5)], seed=82)
    canopy(P, R, [(x0 + 4 + k * 9, 150 + (k % 2) * 2, 6 + (k % 3)) for k in range(14)], seed=83, light=(1, 1))
    P.rect(x0, 156, x1, y1, R["t0"])
    return P


# =============================================================== window (L2)
WIN = (278, 64, 98, 97)  # sprite box


def draw_window(mode: str) -> Pen:
    x0, y0, w, h = WIN
    P = Pen(w, h, x0, y0)
    # outer frame (head interrupted where the AC unit sits on it)
    P.rect(281, 67, 370, 69, "BROWN_0")
    P.rect(281, 67, 283, 152, "BROWN_0")
    P.rect(368, 67, 370, 152, "BROWN_0")
    P.line(281, 67, 370, 67, "INK")
    P.line(281, 67, 281, 152, "INK")
    P.line(370, 67, 370, 152, "INK")
    P.rect(300, 67, 340, 67, None)
    # lit returns: sun is right of centre, so faces looking right catch it
    P.line(283, 70, 283, 151, "RIM")
    P.line(368, 70, 368, 151, "TERRA_0")
    P.line(284, 69, 367, 69, "TERRA_1")
    # mullion
    P.rect(325, 70, 326, 151, "BROWN_0")
    P.line(326, 70, 326, 151, "RIM")
    P.line(324, 70, 324, 151, "INK")
    # sill: lit top, dark face
    P.rect(279, 152, 372, 157, "BROWN_2")
    P.line(279, 152, 372, 152, "RIM")
    P.rect(279, 153, 372, 154, "TERRA_1")
    P.dither(284, 153, 367, 154, "keep", "TERRA_2", mix=0.35)
    P.rect(279, 155, 372, 157, "BROWN_0")
    P.line(279, 155, 372, 155, "BROWN_2")
    P.line(280, 158, 371, 158, "VOID")
    P.px(279, 152, "BROWN_2"); P.px(372, 152, "TERRA_1")
    if mode == "night":
        # blinds lowered and closed for the night; one bent slat leaves a sliver of the night outside
        P.rect(284, 70, 367, 71, "BROWN_0")
        for y in range(72, 149):
            P.rect(284, y, 367, y, ("BROWN_1", "BROWN_1", "BROWN_0")[(y - 72) % 3])
        P.rect(284, 149, 367, 150, "BROWN_0")
        P.line(284, 151, 367, 151, "BROWN_2")
        P.dither(284, 72, 367, 148, "keep", "BROWN_2", mix=0.25, only="BROWN_1")  # lamp-lit slats, soft
        P.rect(300, 96, 312, 96, None)  # the bent slat
        P.rect(302, 97, 310, 97, None)
        P.line(299, 95, 313, 95, "BROWN_2")
        for lx in (290, 324, 361):  # ladder tapes
            P.line(lx, 72, lx, 148, "BROWN_0")
        P.line(287, 151, 287, 156, "INK")
    else:
        # half-open blinds: a raised stack, then three slats tilted open (sky shows between them)
        P.rect(284, 70, 367, 71, "BROWN_0")
        for y in range(72, 76):
            P.rect(284, y, 367, y, "BROWN_1" if y % 2 else "BROWN_2")
        for y in (77, 80):
            P.rect(284, y, 367, y, "BROWN_1")
            P.rect(284, y + 1, 367, y + 1, "TERRA_1")
        P.rect(284, 83, 367, 83, "BROWN_0")
        P.line(284, 84, 367, 84, "RIM")
        P.line(290, 72, 290, 83, "BROWN_0"); P.line(361, 72, 361, 83, "BROWN_0")
        # pull cords with tassels
        P.line(287, 85, 287, 118, "INK")
        P.rect(286, 119, 288, 121, "BROWN_0")
        P.px(288, 119, "RIM")
        P.line(363, 85, 363, 104, "INK")
        P.rect(362, 105, 364, 107, "BROWN_0")
    return P


# =============================================================== the painted shell (L2..L5 source)
AX0, AY0, AW, AH = -80, -96, 800, 480
TW = 18  # tile width in back-wall pixels (about 1.1 ft)
CEIL_ROWS = (52.7, 43.4, 32.6)  # ceiling y at the wall column boundaries x = 114, 52, -20


def shell_fields():
    xs = np.arange(AX0, AX0 + AW)
    ys = np.arange(AY0, AY0 + AH)
    X, Y = np.meshgrid(xs, ys)
    Xf, Yf = X.astype(float), Y.astype(float)
    left, right = X < 176, X > 464
    top = np.where(left, 62 - 0.15 * (176 - Xf), np.where(right, 62 - 0.15 * (Xf - 464), 62.0))
    bot = np.where(left, 198 + 0.19375 * (176 - Xf), np.where(right, 198 + 0.19375 * (Xf - 464), 198.0))
    topr, botr = np.floor(top + 0.5), np.floor(bot + 0.5)
    ceil = Y < topr
    floor = Y >= botr
    wall = ~ceil & ~floor
    hole = (X >= 284) & (X < 368) & (Y >= 70) & (Y < 152)
    BAY = (B4[Y % 4, X % 4] + 0.5) / 16
    return dict(X=X, Y=Y, Xf=Xf, Yf=Yf, left=left, right=right, top=top, bot=bot, topr=topr, botr=botr,
                ceil=ceil, floor=floor, wall=wall, hole=hole, BAY=BAY)


def paint_base(f, night=False):
    """Per-pixel base: ceiling, walls, floor tiles, beam, reflection. Returns an index grid (-1 = empty)."""
    X, Y, Xf, Yf, BAY = f["X"], f["Y"], f["Xf"], f["Yf"], f["BAY"]
    G = np.full(X.shape, -1, dtype=np.int16)
    I = IDX

    def put(mask, name):
        G[mask] = I[name]

    def zone(dist, w=2.0):
        """Solid inside (dist > 0) with a narrow Bayer transition about w px wide: no screen-door wallpaper."""
        return np.clip(dist / w + 0.5, 0, 1) > BAY

    # ---- ceiling: dark slab, a lighter band toward the back wall, a warm bounce above the window, front darker
    ceil = f["ceil"]
    put(ceil, "INK")
    put(ceil & zone(Yf - 55.5), "BROWN_0")
    if not night:
        e = 1 - np.hypot((Xf - 326) / 44, (Yf - 63) / 9)
        put(ceil & zone(e * 9, 2), "BROWN_2")
    put(ceil & zone(8 - Yf, 3), "VOID")

    # ---- back wall: plaster, shadowed under the ceiling and into the corners, bounce light under the window
    back = f["wall"] & ~f["left"] & ~f["right"]
    put(back, "BROWN_1")
    put(back & zone(66.5 - Yf), "BROWN_0")
    put(back & zone(np.maximum(182 - Xf, Xf - 458), 3), "BROWN_0")
    put(back & (Yf >= 188) & (np.abs(Xf - 326) <= 36), "BROWN_2")  # floor bounce, low and solid
    put(back & (Y >= 192), "BROWN_0")  # baseboard
    put(back & (Y == 192), "BROWN_2")
    if not night:
        put(back & (Y == 192) & (np.abs(Xf - 324) < 46), "TERRA_1")
        put(back & (Y == 192) & (np.abs(Xf - 324) < 20), "RIM")
    put(back & (Y == 197), "INK")
    put(back & (Y == 62), "INK")
    put(f["hole"], "VOID")  # cleared to transparent below

    # ---- side walls: darker flats, a lighter strip toward the back corner, darker high up, baseboard
    side = f["wall"] & (f["left"] | f["right"])
    put(side, "BROWN_0")
    v = (f["botr"] - Yf) / np.maximum(1, f["botr"] - f["topr"])
    dx = np.where(f["left"], 176 - Xf, Xf - 464)
    put(side & zone(10 - dx, 4) & (v < 0.86), "BROWN_1")
    put(side & zone((v - 0.86) * 60, 2), "INK")
    scale = (f["bot"] - f["top"]) / 136
    bt = np.floor(5 * scale + 0.5)
    base = side & (Yf >= f["botr"] - bt)
    put(base, "INK")
    put(base & (Yf == f["botr"] - bt), "BROWN_2")
    put(base & (Yf == f["botr"] - bt) & (dx < 30), "TERRA_1")
    topline = side & (Yf == f["topr"])
    put(topline, "VOID")
    put(f["wall"] & ((X == 176) | (X == 464)), "INK")
    put(f["wall"] & ((X == 175) | (X == 465)) & (Y < 190), "BROWN_1")

    # ---- floor: terracotta in one-point perspective toward the vanishing point (320, 121)
    fl = f["floor"]
    s = np.where(fl, (Yf - 121) / 77, 1.0)
    u = (Xf - 320) / s
    D = 288 * (1 - 1 / s)
    col = np.floor(u / TW + 0.5).astype(np.int64)
    row = np.floor(D / TW).astype(np.int64)
    grout = np.zeros(X.shape, bool)
    grout[1:, :] |= row[1:, :] != row[:-1, :]
    for iy in range(AH):
        yv = AY0 + iy
        if yv < 198:
            continue
        s0, s1 = (yv - 0.5 - 121) / 77, (yv + 0.5 - 121) / 77
        sm = (yv - 121) / 77
        for k in range(-60, 61):
            b = k * TW - TW / 2
            xa, xb = 320 + b * s0, 320 + b * s1
            lo, hi = min(xa, xb), max(xa, xb)
            if hi - lo < 1:
                p0 = p1 = int(math.floor(320 + b * sm + 0.5))
            else:
                p0, p1 = int(math.floor(lo + 0.5)), int(math.floor(hi + 0.5)) - 1
            a0, a1 = max(p0 - AX0, 0), min(p1 - AX0, AW - 1)
            if a0 <= a1:
                grout[iy, a0:a1 + 1] = True
    grout &= fl
    hv = (((col * 92837111) ^ (row * 689287499)) & 1023) / 1023.0
    # light is judged once per TILE (at its centre), so colours never change inside a tile
    uc, Dc = col * TW, (row + 0.5) * TW
    du = uc - 12
    Lt = np.exp(-(du / 96) ** 2) * (0.45 + 0.55 * np.exp(-Dc / 150))
    Lt *= np.clip(1.2 - Dc / 340, 0.3, 1)
    Lt += 0.10 * np.exp(-Dc / 24)  # bounce right at the back wall
    v = Lt + (hv - 0.5) * 0.16
    tile = np.full(X.shape, I["BROWN_0"], dtype=np.int16)
    tile[v >= 0.14] = I["BROWN_2"]
    tile[(v >= 0.40) & (hv > 0.45)] = I["TERRA_0"]
    tile[v >= 0.55] = I["TERRA_0"]
    tile[v >= 0.90] = I["TERRA_1"]
    # glossy top edge on lit tiles (the edge facing the window catches it)
    topedge = np.zeros(X.shape, bool)
    topedge[1:, :] = grout[:-1, :] & ~grout[1:, :]
    gloss = topedge & (Lt > 0.40) & (hv > 0.3)
    step = {I["BROWN_0"]: I["BROWN_2"], I["BROWN_2"]: I["TERRA_0"], I["TERRA_0"]: I["TERRA_1"],
            I["TERRA_1"]: I["TERRA_2"]}
    for a_, b_ in step.items():
        tile[gloss & (tile == a_)] = b_
    gcol = np.where(tile == I["BROWN_0"], I["INK"], I["BROWN_0"])
    gcol = np.where(Lt > 0.50, I["TERRA_0"], gcol)  # grout catches the light near the window
    gcol = np.where(Lt > 0.72, I["TERRA_1"], gcol)
    floorcol = np.where(grout, gcol, tile)

    # sunbeam: quad from the window base toward the statue; mullion shadow; soft (dithered) edges
    quad = [(292, 201), (354, 201), (318, 238), (246, 238)]

    def edge_d(ax, ay, bx, by):
        nx, ny = by - ay, -(bx - ax)
        ln = math.hypot(nx, ny)
        return ((Xf - ax) * nx + (Yf - ay) * ny) / ln

    ds = []
    for i in range(4):
        (ax, ay), (bx, by) = quad[i], quad[(i + 1) % 4]
        nx, ny = by - ay, -(bx - ax)
        sgn = 1 if (300 - ax) * nx + (220 - ay) * ny > 0 else -1  # (300, 220) is inside: positive = inside
        ds.append(sgn * edge_d(ax, ay, bx, by))
    inner = np.minimum.reduce(ds)
    beam = fl & (inner > 0) & ((inner > 2.0) | (BAY < inner / 2.0)) & (not night)
    core = beam & (inner > 7) & (BAY < np.clip((inner - 7) / 10, 0, 0.6))
    m_d = np.abs(edge_d(322.6, 201, 280.6, 238))
    shadow = beam & (m_d < 1.6)
    floorcol = np.where(beam & ~grout, I["TERRA_1"], floorcol)
    floorcol = np.where(beam & grout, I["RIM"], floorcol)
    floorcol = np.where(beam & topedge & ~shadow, I["TERRA_2"], floorcol)
    floorcol = np.where(shadow, np.where(grout, I["TERRA_1"], I["TERRA_0"]), floorcol)

    # reflection of the window, painted as streaks. Stylised mirror: window row wy maps to floor row
    # y = 239 + (155 - wy) / 2.2, so the sill sits just under the rug and the sun's hot spot lands near y 258,
    # inside the core. Per tile row: ragged ends, a few unlit tiles, grout lit; Bayer fade toward the viewer.
    def refl_colour(x, wy):
        dx = abs(x - SUN_C[0])
        if wy >= 140:
            return "TERRA_1"
        if wy >= 120:
            return "TERRA_2" if dx < 14 else "TERRA_1"
        if wy >= 104:
            return "GLOW" if dx <= 4 else "ORANGE" if dx <= 13 else "RIM"
        if wy >= 92:
            return "ORANGE" if dx <= 7 else "RIM" if dx < 24 else "TERRA_2"
        if wy >= 82:
            return "TERRA_2" if dx < 20 else "TERRA_1"
        return "TERRA_0"

    def halfwidth(wy):  # widest at the sun, narrower near the rug and toward the viewer
        return 18 + 22 * math.exp(-((wy - SUN_C[1]) / 26) ** 2)

    bright = {I[n] for n in ("GLOW", "ORANGE", "RIM", "TERRA_2")}
    for iy in range(AH):
        y = AY0 + iy
        if y < 240 or y > 300:
            continue
        sb = y // 2  # 2 px streaks
        wy = 152 - (y - 240) * 2.2
        cx = 328 + int(hsh(96, sb) * 5) - 2
        hw = halfwidth(wy) - (y - 240 < 3) * 8
        li = int(cx - hw + hsh(97, sb) * 8 - 4)
        ri = int(cx + hw + hsh(98, sb) * 8 - 4)
        fade = np.clip((y - 266) / 30, 0, 0.95)
        for x in range(li, ri + 1):
            ix = x - AX0
            if not fl[iy, ix] or (fade > 0 and bay(x, y) < fade):
                continue
            if hsh(94, sb, x // 7) < 0.12 and abs(x - SUN_C[0]) > 8:
                continue  # breaks in the streak
            n = refl_colour(x, wy)
            if x == 325 and sb % 2 == 0:
                n = "TERRA_0"  # the mullion, broken by the ripple
            if night:  # blinds down: only a faint plum sheen of the night sky
                n = {"GLOW": "PLUM_1", "ORANGE": "PLUM_1", "RIM": "PLUM_0", "TERRA_2": "PLUM_0"}.get(n)
                if n is None or bay(x, y) < 0.35:
                    continue
            m = I[n]
            if grout[iy, ix]:
                floorcol[iy, ix] = I["BROWN_1"] if night else I["RIM"] if m in bright else I["TERRA_1"]
            else:
                floorcol[iy, ix] = m
    G[fl] = floorcol[fl]
    return G


def layer_grid(f):
    X, Y, Yf = f["X"], f["Y"], f["Yf"]
    L = np.full(X.shape, 2, dtype=np.int8)
    fl = f["floor"]
    L[fl & (Y >= 210)] = 3
    L[fl & (Y >= 222)] = 4
    L[fl & (Y >= 236)] = 5
    ce = f["ceil"]
    L[ce & (Yf < CEIL_ROWS[0])] = 3
    L[ce & (Yf < CEIL_ROWS[1])] = 4
    L[ce & (Yf < CEIL_ROWS[2])] = 5
    side = f["wall"] & (f["left"] | f["right"])
    xl = np.where(f["left"], X, 640 - X)
    L[side & (xl < 114)] = 3
    L[side & (xl < 52)] = 4
    L[side & (xl < -20)] = 5
    return L


def paint_details(M: Pen, night: bool = False):
    """Hand-placed shell details on the full-art master (world coordinates)."""
    # --- back wall: panel seams, outlets, a thermostat, a water stain in the corner
    # old tape marks where posters used to hang, a hairline crack, nail holes
    for (tx, ty, tw, th) in ((198, 92, 30, 40), (392, 84, 26, 34)):
        for cx_, cy_ in ((tx, ty), (tx + tw, ty), (tx, ty + th), (tx + tw, ty + th)):
            M.rect(cx_, cy_, cx_ + 1, cy_, "BROWN_2", only="BROWN_1")
    M.line(450, 70, 446, 80, "BROWN_0", only="BROWN_1"); M.line(446, 80, 447, 88, "BROWN_0", only="BROWN_1")
    for nx_, ny_ in ((252, 100), (420, 132), (190, 150)):
        M.px(nx_, ny_, "INK", only="BROWN_1")
    for ox_, oy_ in ((214, 183), (434, 183), (300, 184)):
        M.rect(ox_, oy_, ox_ + 3, oy_ + 4, "ROSE_0")
        M.px(ox_ + 1, oy_ + 1, "INK"); M.px(ox_ + 1, oy_ + 3, "INK")
        M.line(ox_ + 3, oy_, ox_ + 3, oy_ + 4, "BROWN_2")
    M.rect(378, 120, 381, 124, "BROWN_2"); M.px(379, 121, "CRT_0"); M.line(378, 124, 381, 124, "BROWN_0")
    M.rect(180, 64, 192, 66, "BROWN_0", only="BROWN_1")
    M.ell(180, 63, 196, 70, "BROWN_0", only="BROWN_1")
    # --- side walls: seams at equal depth steps, outlets, a conduit drop in the right corner
    for side in ("left", "right"):
        for xw in (126, 63):
            x = xw if side == "left" else 640 - xw
            t, b = wall_point(side, x, 1)[1], wall_point(side, x, 0)[1]
            M.line(x, t + 2, x, b - 8, "INK", only="BROWN_0")
        for xw, vv in ((150, 0.12), (36, 0.10)):
            x = xw if side == "left" else 640 - xw
            sc = wall_scale(side, x)
            px_, py_ = wall_point(side, x, vv)
            ww, hh = max(3, round(3 * sc)), max(4, round(5 * sc))
            M.rect(px_, py_ - hh, px_ + ww - 1, py_, "BROWN_2")
            M.px(px_ + ww // 2, py_ - hh + 1, "INK"); M.px(px_ + ww // 2, py_ - 2, "INK")
    for y in range(64, 196):  # conduit running down the right back corner
        M.px(462, y, "BROWN_2" if y % 18 else "BROWN_1")
        M.px(461, y, "BROWN_1")
    M.rect(459, 186, 463, 192, "BROWN_1"); M.line(459, 186, 463, 186, "BROWN_2")

    # --- ceiling: conduit parallel to the back wall, two runs receding toward the viewer, boxes, wires
    def ray(x0, t):  # ceiling point straight out from back-wall top point (x0, 62), away from the VP
        return 320 + (x0 - 320) * t, 121 - 59 * t

    for x0, lit in ((236, 1), (404, -1)):  # a pipe pair each side, widening toward the viewer
        for dxp, colr in ((0, "BROWN_1"), (5, "BROWN_1")):
            a0, a1 = ray(x0 + dxp, 1.0), ray(x0 + dxp, 3.7)
            b0, b1 = ray(x0 + dxp + 2.2, 1.0), ray(x0 + dxp + 2.2, 3.7)
            M.poly([a0, a1, b1, b0], colr)
            e0, e1 = (b0, b1) if lit > 0 else (a0, a1)
            M.line(e0[0], e0[1], e1[0], e1[1], "BROWN_2")
            d0, d1 = (a0, a1) if lit > 0 else (b0, b1)
            M.line(d0[0], d0[1], d1[0], d1[1], "INK")
        for t in (1.3, 1.75, 2.35, 3.1):  # straps
            a, b = ray(x0 - 1, t), ray(x0 + 8.5, t)
            M.line(a[0], a[1], b[0], b[1], "INK")
            M.line(a[0], a[1] + 1, b[0], b[1] + 1, "BROWN_0")
    yc = 49
    xl_ = 176 - (62 - yc) / 0.15
    M.line(xl_ + 2, yc, 640 - xl_ - 2, yc, "BROWN_1")
    M.line(xl_ + 2, yc + 1, 640 - xl_ - 2, yc + 1, "BROWN_2")
    if not night:
        M.line(286, yc + 1, 366, yc + 1, "TERRA_0", only="BROWN_2")
    for sx in range(int(xl_) + 20, int(640 - xl_) - 10, 34):
        M.px(sx, yc, "INK"); M.px(sx, yc + 1, "INK")
    for bx in (205, 320, 420):
        M.rect(bx - 2, yc - 1, bx + 2, yc + 2, "BROWN_1")
        M.line(bx - 2, yc + 2, bx + 2, yc + 2, "BROWN_2")
        M.px(bx - 2, yc - 1, "INK")
    # loose cables: one from the conduit to the AC, two draped across the front ceiling
    M.sag(340, yc + 2, 342, 62, 1, "INK")
    M.sag(236, 50, 160, 40, 4, "INK")
    M.sag(410, 52, 520, 30, 12, "BROWN_0")
    M.sag(130, 24, 40, 6, 6, "INK")
    # smoke detector with a red LED
    M.rect(258, 39, 266, 41, "BROWN_1"); M.line(258, 39, 266, 39, "BROWN_2"); M.px(264, 41, "CRT_1")
    M.px(264, 42, "TERRA_0")
    # front beam across the ceiling near the viewer (frames the top of the core)
    M.rect(AX0, -20, AX0 + AW - 1, 5, "INK", only="opaque")
    M.rect(AX0, 2, AX0 + AW - 1, 5, "BROWN_0", only="opaque")
    M.line(AX0, 6, AX0 + AW - 1, 6, "BROWN_1", only="opaque")
    M.line(AX0, -21, AX0 + AW - 1, -21, "VOID", only="opaque")
    for bx in range(-70, 720, 64):
        M.rect(bx, -18, bx + 1, 5, "VOID", only="opaque")
    if not night:
        M.line(250, 6, 400, 6, "BROWN_2", only="BROWN_1")


# =============================================================== fixtures
def pendant(x: int, style: str, lit: bool, side: int) -> Pen:
    """Pendant hanging from the ceiling conduit box (y 49). side = +1 when the window is to its right.
    Seen from slightly below: dome, then the dark opening with the bulb peeking out."""
    P = Pen(19, 24, x - 9, 48)
    P.line(x, 52, x, 57, "INK")
    if style == "t1":  # Raw: bare bulb on a cord, the spare cord looped over the conduit
        P.rect(x - 1, 57, x + 1, 59, "INK")
        P.px(x + side, 58, "BROWN_1")
        if lit:
            P.rect(x - 2, 60, x + 2, 62, "SUN"); P.rect(x - 1, 63, x + 1, 63, "SUN")
            P.px(x - 2, 60, "GLOW"); P.px(x + 2, 60, "GLOW"); P.px(x, 64, "GLOW")
            P.px(x - 3, 61, "AMBER"); P.px(x + 3, 61, "AMBER"); P.px(x, 65, "AMBER")
        else:
            P.rect(x - 2, 60, x + 2, 62, "ROSE_0"); P.rect(x - 1, 63, x + 1, 63, "ROSE_0")
            P.line(x + side * 2, 60, x + side * 2, 61, "CREAM")
            P.px(x - side * 2, 62, "BROWN_2")
        P.sag(x, 53, x - 8 * side, 51, 4, "INK")
        return P
    body, hi, dk, glint = {"t3": ("BROWN_1", "BROWN_2", "INK", "ROSE_0"),
                           "t5": ("GOLD_DK", "GOLD", "BROWN_0", "SUN")}[style]
    P.rect(x - 1, 57, x + 1, 58, dk)
    rows = [(59, 2), (60, 3), (61, 4), (62, 5), (63, 6), (64, 7), (65, 7)]
    for yy, hw in rows:
        P.rect(x - hw, yy, x + hw, yy, body)
    for yy, hw in rows:  # window-side flank of the dome catches the light
        P.px(x + hw * side, yy, hi)
        if hw >= 4:
            P.px(x + (hw - 1) * side, yy, hi)
    P.px(x + 2 * side, 60, glint)
    P.line(x - 7, 65, x + 7, 65, dk if style == "t3" else "GOLD_DK")
    P.px(x + 7 * side, 65, hi)
    if lit:
        P.line(x - 6, 66, x + 6, 66, "GLOW")
        P.rect(x - 2, 66, x + 2, 66, "SUN")
        P.rect(x - 1, 67, x + 1, 67, "CREAM")
        P.px(x - 4, 67, "AMBER"); P.px(x + 4, 67, "AMBER"); P.px(x, 68, "AMBER")
    else:
        P.line(x - 6, 66, x + 6, 66, "INK")
        P.rect(x - 1, 66, x + 1, 66, "ROSE_0")
        P.px(x + side, 66, "ROSE_1")
    return P


def fan(style: str) -> Pen:
    """Ceiling fan at x 320 (depth band L4), seen from slightly below, with a small light kit."""
    P = Pen(74, 18, 283, 33)
    x = 320
    body = {"t1": "BROWN_1", "t3": "BROWN_1", "t5": "GOLD_DK"}[style]
    body_hi = {"t1": "BROWN_2", "t3": "BROWN_2", "t5": "GOLD"}[style]
    blade = {"t1": "ROSE_0", "t3": "BROWN_2", "t5": "TERRA_1"}[style]
    blade_hi = {"t1": "ROSE_1", "t3": "TERRA_1", "t5": "TERRA_2"}[style]
    P.rect(x - 3, 34, x + 3, 35, body)  # ceiling canopy
    P.line(x - 3, 34, x + 3, 34, "INK")
    P.rect(x, 36, x + 1, 39, "INK")  # downrod
    P.px(x + 1, 37, body_hi)
    # blades: long side pair almost edge-on, tapering; then the motor over their roots
    P.poly([(x - 4, 41), (x - 34, 42), (x - 35, 44), (x - 4, 45)], blade)
    P.poly([(x + 4, 41), (x + 34, 42), (x + 35, 44), (x + 4, 45)], blade)
    P.line(x - 34, 42, x - 5, 41, "BROWN_0")
    P.line(x + 5, 41, x + 34, 42, "BROWN_0")
    P.line(x - 33, 44, x - 6, 45, blade_hi)  # undersides pick up the warm floor bounce
    P.line(x + 6, 45, x + 33, 44, blade_hi)
    P.poly([(x - 3, 45), (x + 3, 45), (x + 4, 48), (x - 4, 48)], blade)  # front blade, foreshortened
    P.line(x - 4, 48, x + 4, 48, blade_hi)
    P.rect(x - 5, 40, x + 5, 44, body)  # motor housing
    P.line(x - 5, 40, x + 5, 40, "INK")
    P.line(x - 4, 44, x + 4, 44, "BROWN_0")
    P.line(x + 2, 41, x + 4, 41, body_hi); P.px(x + 4, 42, body_hi)
    P.rect(x - 2, 45, x + 2, 46, "ROSE_0")  # light kit glass
    P.line(x - 2, 47, x + 2, 47, "BROWN_2")
    P.px(x + 1, 45, "ROSE_1")
    if style == "t5":
        P.line(x - 5, 43, x + 5, 43, "GOLD"); P.px(x + 3, 41, "SUN")
    if style == "t1":
        P.poly([(x + 22, 43), (x + 35, 44), (x + 35, 45), (x + 22, 45)], None)  # a cracked, shorter blade
        P.line(x + 20, 45, x + 24, 46, blade)
    P.line(x - 3, 47, x - 3, 49, "INK")  # pull chain
    P.px(x - 3, 50, "GOLD_DK")
    return P


def ac_unit() -> Pen:
    P = Pen(46, 10, 299, 61)
    P.rect(300, 62, 340, 67, "BROWN_2")
    P.line(300, 62, 340, 62, "ROSE_0")
    P.line(300, 67, 340, 67, "INK")
    P.line(300, 62, 300, 67, "BROWN_0")
    P.line(340, 63, 340, 67, "BROWN_0")
    P.line(302, 66, 338, 66, "BROWN_0")
    for vx in range(304, 337, 3):
        P.px(vx, 65, "BROWN_0")
    P.px(336, 63, "CRT_1"); P.px(335, 63, "TERRA_0"); P.px(337, 63, "TERRA_0"); P.px(336, 64, "TERRA_0")
    P.line(302, 63, 318, 63, "ROSE_0")
    P.line(341, 64, 343, 64, "INK"); P.line(343, 64, 343, 69, "INK")
    return P


# =============================================================== L6 frame crops
def clamp_core(P: Pen, limit: int = 12) -> Pen:
    """Frame crops may reach at most `limit` px into the 640x270 core: erase anything deeper."""
    for y in range(max(P.oy, 0), min(P.oy + P.h, 270)):
        for x in range(max(P.ox, 0), min(P.ox + P.w, 640)):
            if min(x + 1, 640 - x, y + 1, 270 - y) > limit and P.get(x, y):
                P.px(x, y, None)
    return P


def crop_plant(style: str) -> Pen:
    # drawn in the pot's own frame, then the pen is re-anchored so the pot hangs 30 px right, 14 px lower:
    # its lit right edge and a few vines reach about 10 px into the core
    DX, DY = 30, 14
    P = Pen(110, 176, -80 - DX, -96 - DY)
    R = dict(t0="LEAF_0", t1="LEAF_1", t2="LEAF_2", trim_leaf="GLOW")
    # macrame cords from the beam
    for ax in (-56, -40, -24):
        P.line(-40, -20 - DY + 6, ax, -6, "BROWN_2")
    P.rect(-41, -21 - DY + 6, -39, -20 - DY + 6, "BROWN_1")
    # pot, lit on its right (window) side
    P.poly([(-58, -6), (-22, -6), (-26, 12), (-54, 12)], "TERRA_0")
    P.rect(-59, -7, -21, -4, "TERRA_1")
    P.line(-59, -7, -21, -7, "TERRA_2")
    for y in range(-3, 12):
        P.px(-25 - (y + 3) // 4, y, "RIM")
    P.line(-54, 12, -26, 12, "BROWN_0")
    for y in range(-3, 12):  # shadow side of the pot, away from the window
        P.line(-57 + (y + 3) // 5, y, -50 + (y + 3) // 5, y, "BROWN_2", only="TERRA_0")
    vines = {"t1": 2, "t3": 5, "t5": 7}[style]
    leafy = {"t1": 0.35, "t3": 0.75, "t5": 0.95}[style]
    for k in range(vines):
        vx = -56 + k * 5 + int(hsh(101, k) * 3)
        ln = 20 + int(hsh(102, k) * (50 if style != "t1" else 20))
        drift = -(k % 3)  # vines lean toward the art edge, away from the kitchen
        pts = [(vx + round(math.sin(i / 7 + k) * 2) + i * drift // 10, -5 + i) for i in range(ln)]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            P.line(ax, ay, bx, by, "LEAF_0")
        for i in range(2, ln, 4):
            if hsh(103, k, i) < leafy:
                lx, ly = pts[i]
                d = 1 if (i // 4) % 2 else -1
                P.rect(lx + d, ly, lx + d * 2, ly + 1, "LEAF_1")
                P.px(lx + d * 2, ly, "LEAF_2" if d > 0 else "LEAF_1")
                if d > 0 and hsh(104, k, i) > 0.82:
                    P.px(lx + d * 3, ly, "GLOW" if style != "t1" else "LEAF_2")
    if style != "t1":
        canopy(P, R, [(-50, -10, 6), (-40, -12, 7), (-30, -9, 6), (-45, -16, 4), (-34, -17, 4)], seed=105,
               light=(1, 1))
    else:
        canopy(P, R, [(-44, -9, 4), (-36, -10, 4)], seed=106, light=(1, 1))
        P.recolor({"LEAF_2": "BROWN_2"})
    if style == "t5":
        P.circ(-44, -14, 2, "LEAF_3", only="LEAF_1")
    P.ox, P.oy = -80, -96
    return clamp_core(P)


def crop_cabinet() -> Pen:
    P = Pen(92, 150, -80, 234)
    # top surface (seen from above), front face cropped by the art edge, right face toward the VP
    P.poly([(-80, 240), (-6, 240), (8, 236), (-80, 236)], "BROWN_2")
    P.line(-80, 236, 8, 236, "BROWN_1")
    P.line(-6, 240, 8, 236, "RIM")
    P.rect(-80, 241, -6, 383, "BROWN_1")
    P.poly([(-5, 241), (8, 237), (8, 383), (-5, 383)], "BROWN_0")
    P.line(-5, 241, -5, 383, "RIM")
    P.line(-80, 241, -6, 241, "BROWN_2")
    for dy in (241, 290, 339):  # drawers
        P.rect(-74, dy + 6, -10, dy + 44, "BROWN_0", fill=False)
        P.line(-73, dy + 7, -11, dy + 7, "INK")
        P.rect(-50, dy + 14, -36, dy + 16, "ROSE_0")
        P.line(-50, dy + 16, -36, dy + 16, "BROWN_2")
        P.rect(-46, dy + 22, -40, dy + 26, "BROWN_2")
        P.line(-46, dy + 22, -40, dy + 22, "ROSE_0")
    # stuff on top: paper stack, a mug lit on its right
    P.rect(-60, 232, -36, 237, "ROSE_0")
    P.line(-60, 232, -36, 232, "ROSE_1")
    P.line(-60, 235, -36, 235, "BROWN_2")
    P.rect(-28, 228, -21, 237, "TERRA_1")
    P.line(-21, 228, -21, 237, "RIM")
    P.line(-28, 228, -21, 228, "TERRA_2")
    P.rect(-20, 230, -19, 234, "TERRA_0")
    P.rect(-27, 229, -22, 229, "BROWN_0")
    return clamp_core(P)


def crop_speaker() -> Pen:
    P = Pen(92, 146, 628, 238)
    # top (seen from above), left face toward the VP (lit edge), big front face cropped by the edge
    P.poly([(632, 246), (648, 241), (719, 241), (719, 246)], "BROWN_2")
    P.line(632, 246, 648, 241, "RIM")
    P.poly([(632, 247), (648, 242), (648, 383), (632, 383)], "BROWN_0")
    P.line(632, 247, 632, 383, "RIM")
    P.rect(648, 242, 719, 383, "BROWN_1")
    P.line(648, 242, 648, 383, "INK")
    P.line(649, 242, 719, 242, "BROWN_2")
    for gy in range(250, 384, 7):  # wood grain on the side
        P.line(634, gy, 646, gy - 1, "BROWN_1", only="BROWN_0")
    # tweeter and woofer
    P.circ(686, 270, 6, "INK"); P.circ(686, 270, 4, "BROWN_0"); P.circ(686, 270, 1, "ROSE_0")
    P.px(683, 267, "BROWN_2")
    P.circ(688, 326, 26, "INK"); P.circ(688, 326, 23, "BROWN_0"); P.circ(688, 326, 20, "INK", fill=False)
    P.circ(688, 326, 9, "BROWN_1"); P.circ(688, 326, 4, "INK")
    for a in range(200, 260, 6):  # rim light on the cone's window-facing edge
        r = math.radians(a)
        P.px(688 + round(math.cos(r) * 23), 326 - round(math.sin(r) * 23), "TERRA_1")
    P.px(659, 372, "CRT_1"); P.px(660, 372, "TERRA_0"); P.px(658, 372, "TERRA_0")
    P.sag(640, 383, 628, 360, -4, "INK")
    return clamp_core(P)


def crop_cables() -> Pen:
    """Cables looping off the front beam at the top-right; a power strip hangs down the right edge."""
    P = Pen(184, 176, 536, -96)
    for k, (a, b, sg, colr, lit) in enumerate([((540, 5), (719, 9), 5, "BROWN_1", "BROWN_2"),
                                               ((588, 5), (719, -2), 8, "BROWN_0", "BROWN_2"),
                                               ((612, 5), (719, 24), 9, "BROWN_1", "ROSE_0"),
                                               ((660, 5), (719, 50), 8, "TERRA_0", "BROWN_2")]):
        P.sag(a[0], a[1] + 1, b[0], b[1] + 1, sg, "VOID")
        P.sag(a[0], a[1], b[0], b[1], sg, colr)
        P.sag(a[0], a[1] - 1, b[0], b[1] - 1, sg, lit)
    for zx in (566, 600, 628):  # cable ties on the beam
        P.rect(zx, 3, zx + 1, 7, "BROWN_2")
    # power strip on its own cord down the right edge, red switch lit
    P.line(634, 6, 634, 21, "INK")
    P.rect(631, 22, 637, 44, "BROWN_1"); P.line(631, 22, 637, 22, "BROWN_2"); P.line(631, 22, 631, 44, "RIM")
    P.px(634, 25, "CRT_1"); P.px(634, 26, "TERRA_0")
    for yy in (30, 34, 38, 42):
        P.px(633, yy, "INK"); P.px(635, yy, "INK")
    P.sag(635, 45, 660, 70, 6, "INK")
    return clamp_core(P)


# =============================================================== build
def main():
    def sv(P: Pen, name: str) -> str:
        return save(P.s, f"{PART}/{name}")

    # L0 / L1
    sky = {m: draw_sky(m) for m in ("base", "night")}
    out = {m: draw_outside(m) for m in ("base", "night", "fall")}
    item("shell.sky", zone="room", kind="shell", layer=0, x=SKY[0], y=SKY[1],
         variants={"base": sv(sky["base"], "sky"), "night": sv(sky["night"], "sky-night")},
         note="golden-hour sky with the sun and lit clouds; night sky with moon and stars")
    item("shell.outside", zone="room", kind="shell", layer=1, x=OUT[0], y=OUT[1],
         variants={"base": sv(out["base"], "outside"), "night": sv(out["night"], "outside-night"),
                   "fall": sv(out["fall"], "outside-fall")},
         note="New Orleans: shotgun houses, live oak with moss, power pole and wires, red streetcar")
    win = {m: draw_window(m) for m in ("base", "night")}

    f = shell_fields()
    L = layer_grid(f)
    names = {2: "back wall, ceiling over it, near floor rows, back side-wall columns",
             3: "floor rows 210..222, side-wall columns 52..114, ceiling band",
             4: "floor rows 222..236 with the sunbeam, side-wall columns -20..52, ceiling band",
             5: "front floor with the window reflection, outer wall columns, front ceiling and beam"}
    bands = {}
    for mode in ("base", "night"):
        G = paint_base(f, night=mode == "night")
        G[f["hole"]] = -1
        M = Pen(AW, AH, AX0, AY0)
        for iy in range(AH):
            rowv = G[iy]
            for ix in range(AW):
                v = rowv[ix]
                if v >= 0:
                    M.s.px(ix, iy, MASTER[v])
        paint_details(M, night=mode == "night")
        # split into parallax bands; each band overdraws 8 px under its nearer neighbour
        arr = np.array(M.s._img())
        opaque = arr[:, :, 3] > 0
        for k in (2, 3, 4, 5):
            own = (L == k) & opaque
            dil = own.copy()
            for _ in range(8):
                d2 = dil.copy()
                d2[1:, :] |= dil[:-1, :]; d2[:-1, :] |= dil[1:, :]
                d2[:, 1:] |= dil[:, :-1]; d2[:, :-1] |= dil[:, 1:]
                dil = d2
            mask = own | (dil & (L > k) & opaque)
            ys_, xs_ = np.nonzero(mask)
            y0, y1, x0, x1 = ys_.min(), ys_.max(), xs_.min(), xs_.max()
            B = Pen(int(x1 - x0 + 1), int(y1 - y0 + 1), int(x0 + AX0), int(y0 + AY0))
            for yy, xx in zip(ys_, xs_):
                B.s.px(int(xx - x0), int(yy - y0), tuple(int(c) for c in arr[yy, xx]))
            bands.setdefault(k, {})[mode] = (B, sv(B, f"l{k}" + ("-night" if mode == "night" else "")))
    for k in (2, 3, 4, 5):
        B = bands[k]["base"][0]
        assert (B.ox, B.oy) == (bands[k]["night"][0].ox, bands[k]["night"][0].oy)
        item(f"shell.l{k}", zone="room", kind="shell", layer=k, x=B.ox, y=B.oy,
             variants={"base": bands[k]["base"][1], "night": bands[k]["night"][1]},
             note=f"room shell band L{k}: {names[k]}; draw first in its layer")

    item("shell.window", zone="room", kind="shell", layer=2, x=WIN[0], y=WIN[1],
         variants={"base": sv(win["base"], "window"), "night": sv(win["night"], "window-night")},
         note="window frame, mullion, sill, half-open blinds (night: blinds lowered); draw right after shell.l2")
    item("shell.ac", zone="room", kind="decor", layer=2, x=299, y=61, variants={"base": sv(ac_unit(), "ac")},
         note="mini-split AC above the window with a red standby LED")
    for nm, x, sd in (("library", 205, 1), ("desk", 420, -1)):
        v = {"base": sv(pendant(x, "t3", False, sd), f"pendant-{nm}"),
             "night": sv(pendant(x, "t3", True, sd), f"pendant-{nm}-night"),
             "t1": sv(pendant(x, "t1", False, sd), f"pendant-{nm}-t1"),
             "t3": sv(pendant(x, "t3", False, sd), f"pendant-{nm}-t3"),
             "t5": sv(pendant(x, "t5", False, sd), f"pendant-{nm}-t5")}
        item(f"shell.pendant.{nm}", zone="room", kind="decor", layer=3, x=x - 9, y=48, variants=v,
             note=f"pendant lamp over the {nm}: t1 bare bulb, t3 dark dome, t5 brass dome; night lit")
    item("shell.fan", zone="room", kind="decor", layer=4, x=283, y=33,
         variants={"base": sv(fan("t3"), "fan"), "t1": sv(fan("t1"), "fan-t1"), "t3": sv(fan("t3"), "fan-t3"),
                   "t5": sv(fan("t5"), "fan-t5")},
         note="ceiling fan at x 320: t1 cheap fan with a bent blade, t3 dark blades, t5 wood and brass")
    item("shell.crop.plant", zone="room", kind="decor", layer=6, x=-80, y=-96,
         variants={"base": sv(crop_plant("t3"), "crop-plant"), "t1": sv(crop_plant("t1"), "crop-plant-t1"),
                   "t3": sv(crop_plant("t3"), "crop-plant-t3"), "t5": sv(crop_plant("t5"), "crop-plant-t5")},
         note="frame crop: hanging pothos top-left (t1 sparse, t5 lush)")
    item("shell.crop.cabinet", zone="room", kind="decor", layer=6, x=-80, y=234,
         variants={"base": sv(crop_cabinet(), "crop-cabinet")}, note="frame crop: filing cabinet bottom-left")
    item("shell.crop.speaker", zone="room", kind="decor", layer=6, x=628, y=238,
         variants={"base": sv(crop_speaker(), "crop-speaker")}, note="frame crop: big floor speaker bottom-right")
    item("shell.crop.cables", zone="room", kind="decor", layer=6, x=536, y=-96,
         variants={"base": sv(crop_cables(), "crop-cables")},
         note="frame crop: cables and a power strip hanging top-right")
    finish(PART)


if __name__ == "__main__":
    main()
