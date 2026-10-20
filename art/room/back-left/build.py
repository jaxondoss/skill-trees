#!/usr/bin/env python3
"""FORGE v3 room, part "back-left": the LIBRARY (zone 3, back wall x 176..262) and the WINDOW zone objects
(zone 4, back wall x 262..378), plus the floor in front of both.

Library: tall bookshelf (READING), wall potion shelf with 15 bottles (ARCHIVE), low chess table with two stools
(CHESS), floor cushion (MEDITATION), and decor: shelf-top plant, globe, storage box, ladder, throw, framed print,
bookend ledge, floor lamp, record crate, magazine rack, desk fan, two floor book stacks.
Window: sill planter (GUT HEALTH), vision board (VISUALIZATION), big CRT on a low stand (TODAY), small CRT on a
tape deck (STATS), and decor: stand, amp, tape deck, plant and box on the small CRT, sill speaker, lamp, VHS,
console, remote, camera, power strip, cables.

Everything is drawn in WORLD coordinates through a palette-locked Pixel Art Studio sprite (room.spr). Objects on
the floor use a pinhole camera that matches the shell (horizon 121, 15.1 px/ft at the back wall, eye 5.1 ft).
Light: warm key from the window (x 284..368), so library objects carry a RIM edge on their right/top sides,
plus small local glows (lamp, CRT red, candle, LEDs) baked into the surfaces next to them.

Run: python3 art/room/back-left/build.py      (deterministic: no global RNG; hashes and fixed seeds only)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

PART = "back-left"
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h in HEX.items()}
B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bay(x: int, y: int) -> float:
    """4x4 Bayer threshold anchored to world coordinates."""
    return (B4[y % 4][x % 4] + 0.5) / 16


def hsh(*v: int) -> float:
    """Deterministic 0..1 hash of integers."""
    h = 2166136261
    for a in v:
        h = ((h ^ (int(a) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535


# ------------------------------------------------------------------ camera (matches the shell's back wall)
F = 302.0      # focal length in px: 15.1 px/ft at the back wall (Z = 20 ft)
CAMH = 5.1     # eye height in ft: floor at the back wall lands on y 198


def zof(y: float) -> float:
    """Distance (ft) of the floor row y."""
    return CAMH * F / (y - HORIZON)


def proj(X: float, Z: float, H: float) -> tuple[float, float]:
    """Screen point of lateral X ft (0 = centre), distance Z ft, height H ft."""
    return 320 + X * F / Z, HORIZON + (CAMH - H) * F / Z


def ppf(y: float) -> float:
    """Pixels per foot for an object whose front stands on floor row y."""
    return F / zof(y)


# ------------------------------------------------------------------ light maps (one step toward the light)
WARM = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2",
        "BROWN_2": "TERRA_1", "TERRA_0": "TERRA_1", "TERRA_1": "AMBER", "PLUM_0": "PLUM_1", "PLUM_1": "ROSE_1",
        "SLATE_0": "ROSE_0", "LEAF_0": "LEAF_1", "LEAF_1": "LEAF_2", "ROSE_0": "ROSE_1", "GOLD_DK": "GOLD",
        "AMBER": "GLOW", "CREAM": "CREAM"}
REDL = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "TERRA_0", "BROWN_1": "TERRA_0",
        "BROWN_2": "TERRA_0", "TERRA_0": "CRT_0", "TERRA_1": "CRT_0", "SLATE_0": "PLUM_0", "LEAF_1": "BROWN_2",
        "LEAF_0": "BROWN_0", "PLUM_0": "TERRA_0", "GOLD_DK": "TERRA_1"}
COOLL = {"VOID": "INK_COOL", "INK": "INK_COOL", "BROWN_0": "INK_COOL", "BROWN_1": "SLATE_0", "BROWN_2": "SLATE_0"}
LIT = {"TERRA_0": "TERRA_1", "BROWN_2": "ROSE_0", "PLUM_0": "PLUM_1", "SLATE_0": "SLATE_1", "LEAF_1": "LEAF_2",
       "GOLD_DK": "GOLD", "INK_COOL": "SLATE_0", "PLUM_1": "PLUM_2", "ROSE_0": "ROSE_1", "TERRA_1": "TERRA_2",
       "LEAF_0": "LEAF_1", "BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2", "CREAM": "CREAM", "INK": "BROWN_0"}


class Pen:
    """World-space pen on a palette-locked sprite. Box x0..x1, y0..y1 inclusive; `sort` pads transparent rows so
    that y + height (the engine's contact key) equals sort, which puts the sprite after what it rests on."""

    def __init__(self, x0: int, y0: int, x1: int, y1: int, sort: int | None = None):
        self.ox, self.oy = x0, y0
        self.w = x1 - x0 + 1
        self.h = max(y1 + 1, sort or 0) - y0
        self.s = spr(self.w, self.h)

    @staticmethod
    def c(n):
        return None if n is None else HEX[n]

    @staticmethod
    def o(only):
        return only if only in (None, "opaque", "empty") else HEX[only]

    def px(self, x, y, n, only=None):
        self.s.px(round(x) - self.ox, round(y) - self.oy, self.c(n), only=self.o(only))

    def line(self, x0, y0, x1, y1, n, only=None):
        self.s.line(round(x0) - self.ox, round(y0) - self.oy, round(x1) - self.ox, round(y1) - self.oy, self.c(n),
                    only=self.o(only))

    def rect(self, x0, y0, x1, y1, n, fill=True, only=None):
        self.s.rect(round(x0) - self.ox, round(y0) - self.oy, round(x1) - self.ox, round(y1) - self.oy, self.c(n),
                    fill=fill, only=self.o(only))

    def poly(self, pts, n, only=None):
        self.s.polygon([(round(x) - self.ox, round(y) - self.oy) for x, y in pts], self.c(n), only=self.o(only))

    def circ(self, cx, cy, r, n, fill=True, only=None):
        self.s.circle(round(cx) - self.ox, round(cy) - self.oy, r, self.c(n), fill=fill, only=self.o(only))

    def ell(self, x0, y0, x1, y1, n, only=None):
        self.s.ellipse(round(x0) - self.ox, round(y0) - self.oy, round(x1) - self.ox, round(y1) - self.oy,
                       self.c(n), only=self.o(only))

    def dither(self, x0, y0, x1, y1, c1, c2, mix=0.5, only=None):
        """Bayer dither anchored to world coordinates; c1/c2 may be "keep"."""
        for y in range(round(y0), round(y1) + 1):
            for x in range(round(x0), round(x1) + 1):
                n = c2 if mix > bay(x, y) else c1
                if n != "keep":
                    self.px(x, y, n, only=only)

    def get(self, x, y):
        if not self.inside(x, y):
            return None
        v = self.s.get(round(x) - self.ox, round(y) - self.oy)
        return None if v is None else RGB2N[tuple(v[:3])]

    def inside(self, x, y):
        return 0 <= round(x) - self.ox < self.w and 0 <= round(y) - self.oy < self.h

    def box(self):
        return self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1

    def recolor(self, mapping, box=None):
        x0, y0, x1, y1 = box or self.box()
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c in mapping:
                    self.px(x, y, mapping[c])

    def glow(self, cx, cy, r, mapping, gain=1.0, box=None, sy=1.0):
        """Local light: recolour opaque pixels near (cx, cy) one step along `mapping`, Bayer falloff."""
        x0, y0, x1, y1 = box or (round(cx - r), round(cy - r * sy), round(cx + r), round(cy + r * sy))
        hits = []
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                d = math.hypot(x - cx, (y - cy) / sy)
                t = gain * (1 - d / r)
                if t > bay(x, y):
                    c = self.get(x, y)
                    if c in mapping:
                        hits.append((x, y, mapping[c]))
        for x, y, n in hits:
            self.px(x, y, n)

    def edge(self, n, dx, dy, match=None, prob=1.0, seed=0, box=None):
        """Light an edge: opaque pixels (optionally of colours in `match`) whose (dx, dy) neighbour is empty."""
        x0, y0, x1, y1 = box or self.box()
        hits = []
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c is None or (match and c not in match):
                    continue
                if self.get(x + dx, y + dy) is None and (prob >= 1 or hsh(seed, x, y) < prob):
                    hits.append((x, y))
        for x, y in hits:
            self.px(x, y, n)

    def save(self, name: str) -> str:
        return save(self.s, f"{PART}/{name}")


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ books
SPINES = ["TERRA_0", "BROWN_2", "PLUM_0", "SLATE_0", "LEAF_1", "GOLD_DK", "INK_COOL", "TERRA_0", "BROWN_2",
          "PLUM_1", "ROSE_0", "TERRA_1", "LEAF_0", "TERRA_0", "SLATE_0", "BROWN_2"]


def books(P: Pen, x0: int, x1: int, ybot: int, seed: int, hmax: int = 14, hmin: int = 10, lean: bool = False,
          lit: float = 0.35) -> int:
    """A run of upright books from x0 to x1 (inclusive) standing on row ybot. Returns the next free x."""
    x, i, prev = x0, 0, None
    while x <= x1:
        r = hsh(seed, i, 1)
        w = (1, 2, 2, 2, 3, 3, 2)[int(r * 7)]
        w = min(w, x1 - x + 1)
        h = hmin + int(hsh(seed, i, 2) * (hmax - hmin + 1))
        col = SPINES[int(hsh(seed, i, 3) * len(SPINES))]
        if col == prev:
            col = SPINES[(SPINES.index(col) + 3) % len(SPINES)]
        prev = col
        top = ybot - h + 1
        P.rect(x, top, x + w - 1, ybot, col)
        if w >= 2 and hsh(seed, i, 4) < 0.5:  # title band
            band = "GOLD_DK" if col in ("TERRA_0", "PLUM_0", "INK_COOL", "LEAF_0", "SLATE_0") else "BROWN_0"
            by = top + 2 + int(hsh(seed, i, 5) * 2)
            P.line(x, by, x + w - 1, by, band)
        if hsh(seed, i, 6) < lit:  # top edge catching the window light
            P.line(x, top, x + w - 1, top, LIT.get(col, col))
        x += w
        if hsh(seed, i, 7) < 0.12:
            x += 1  # a gap
        i += 1
    if lean:
        h = hmax - 2
        for t in range(h):
            xx = x + 3 - int(t * 4 / h)
            P.rect(xx, ybot - t, xx + 1, ybot - t, "TERRA_0" if t < h - 1 else "TERRA_1")
        P.px(x + 3, ybot, "BROWN_0")
        x += 5
    return x


def lying(P: Pen, x: int, ybot: int, n: int, seed: int, wmin: int = 8, wmax: int = 12) -> int:
    """A stack of n books lying flat (spines toward the viewer). Returns the top row."""
    y = ybot
    for i in range(n):
        w = wmin + int(hsh(seed, i, 11) * (wmax - wmin + 1))
        off = int(hsh(seed, i, 12) * 3) - 1
        col = SPINES[int(hsh(seed, i, 13) * len(SPINES))]
        P.rect(x + off, y - 1, x + off + w - 1, y, col)
        P.line(x + off, y - 1, x + off + w - 1, y - 1, LIT.get(col, col))
        P.px(x + off + w - 1, y, "INK")
        y -= 2
    return y + 1


# =================================================================== LIBRARY
# Bookshelf: front face at Z = 19 ft (1 ft deep against the back wall), 3 ft wide, 6.4 ft tall.
BS_X0, BS_X1, BS_Y0, BS_Y1 = 179, 226, 100, 202
BAYS = [(103, 118), (121, 136), (139, 154), (157, 172), (175, 191)]
IN_X0, IN_X1 = 182, 223


def bookshelf(stage: str) -> Pen:
    P = Pen(178, 99, 232, BS_Y1, sort=204)
    # side face toward the window (lit, warm), 5 px of perspective wedge
    P.poly([(227, 100), (231, 101), (231, 198), (227, 202)], "TERRA_0")
    P.poly([(227, 100), (231, 101), (231, 150), (227, 162)], "TERRA_1", only="TERRA_0")
    P.line(227, 100, 227, 140, "RIM")
    P.line(231, 101, 231, 198, "BROWN_2")
    P.line(228, 180, 231, 178, "BROWN_2")
    # front frame
    P.rect(BS_X0, BS_Y0, BS_X1, BS_Y1, "BROWN_2")
    P.rect(IN_X0, 103, IN_X1, 191, "INK")
    for (a, b) in BAYS:
        P.line(IN_X0, a, IN_X1, a, "VOID")
        P.line(IN_X0, a, IN_X0, b, "VOID")
        P.line(IN_X1, a + 1, IN_X1, b, "BROWN_0")  # inner face of the right upright catches a little light
    for (a, b) in BAYS[:-1]:
        P.line(IN_X0, b + 1, IN_X1, b + 1, "BROWN_2")
        P.line(IN_X0, b + 2, IN_X1, b + 2, "BROWN_0")
    P.line(BS_X0, 100, BS_X1, 100, "TERRA_1")
    P.line(BS_X0, 101, BS_X1, 101, "BROWN_2")
    P.line(BS_X0, 102, BS_X1, 102, "BROWN_0")
    P.rect(BS_X0, 192, BS_X1, BS_Y1, "BROWN_0")
    P.line(BS_X0, 192, BS_X1, 192, "BROWN_2")
    P.line(BS_X0 + 2, 196, BS_X1 - 2, 196, "INK")  # kick plate seam
    P.line(BS_X0, BS_Y1, BS_X1, BS_Y1, "INK")
    P.line(BS_X0, 100, BS_X0, BS_Y1, "BROWN_0")
    P.line(181, 103, 181, 191, "BROWN_0")
    P.line(224, 103, 224, 191, "BROWN_0")
    P.line(BS_X1, 101, BS_X1, BS_Y1 - 1, "RIM")
    P.line(212, 100, BS_X1, 100, "RIM")
    P.line(BS_X1, 150, BS_X1, BS_Y1 - 1, "TERRA_1")  # the rim fades toward the floor

    yb = [b for (_, b) in BAYS]
    if stage == "s0":
        lying(P, 184, yb[0], 3, 1)
        books(P, 196, 198, yb[0], 2, hmax=11, hmin=10)
        books(P, 183, 191, yb[1], 3, lean=True)
        box_on_shelf(P, 207, yb[2], 12, 8)
        mug(P, 186, yb[2])
        lying(P, 200, yb[3], 2, 4)
        box_on_shelf(P, 184, yb[4], 20, 12, label=True)
    elif stage == "s1":
        x = books(P, 183, 202, yb[0], 11, lean=True)
        lying(P, x + 2, yb[0], 2, 12, wmin=7, wmax=9)
        lying(P, 183, yb[1], 3, 13, wmin=9, wmax=10)
        books(P, 196, 212, yb[1], 14)
        books(P, 183, 199, yb[2], 15, lean=True)
        mug(P, 214, yb[2])
        x = books(P, 183, 206, yb[3], 16)
        bookend(P, x + 1, yb[3])
        box_on_shelf(P, 184, yb[4], 18, 11, label=True)
        files(P, 205, 222, yb[4], 17)
    else:
        books(P, 183, IN_X1, yb[0], 21, lit=0.4)
        x = books(P, 183, 206, yb[1], 22)
        lying(P, x + 1, yb[1], 2, 23, wmin=6, wmax=7)
        x = books(P, 183, 214, yb[2], 24)
        lying(P, 216, yb[2], 4, 25, wmin=7, wmax=8)
        books(P, 183, IN_X1, yb[3], 26)
        books(P, 183, 214, yb[4], 27, hmax=15, hmin=13)
        lying(P, 215, yb[4], 3, 28, wmin=8, wmax=9)
        lying(P, 196, yb[1] - 12, 1, 29, wmin=9, wmax=9)  # a book lying on top of the row
        reading_lamp(P, 214, yb[1])
    return P


def box_on_shelf(P: Pen, x: int, ybot: int, w: int, h: int, label: bool = False):
    P.rect(x, ybot - h + 1, x + w - 1, ybot, "TERRA_0")
    P.line(x, ybot - h + 1, x + w - 1, ybot - h + 1, "TERRA_1")
    P.line(x + w - 1, ybot - h + 2, x + w - 1, ybot, "BROWN_2")
    P.line(x + w // 2, ybot - h + 1, x + w // 2, ybot - h + 3, "BROWN_2")  # tape
    if label:
        P.line(x + 3, ybot - h // 2, x + w - 5, ybot - h // 2, "ROSE_0")
        P.px(x + w - 4, ybot - h // 2, "BROWN_2")


def mug(P: Pen, x: int, ybot: int):
    P.rect(x, ybot - 3, x + 2, ybot, "SLATE_0")
    P.px(x + 3, ybot - 2, "SLATE_0")
    P.line(x, ybot - 3, x + 2, ybot - 3, "SLATE_1")


def bookend(P: Pen, x: int, ybot: int):
    P.rect(x, ybot - 5, x + 1, ybot, "GOLD_DK")
    P.px(x + 1, ybot - 5, "GOLD")
    P.line(x, ybot, x + 3, ybot, "GOLD_DK")


def files(P: Pen, x0: int, x1: int, ybot: int, seed: int):
    """Magazine files: tall boxes with a cut-out slope."""
    x = x0
    i = 0
    while x + 4 <= x1:
        col = ("SLATE_0", "BROWN_2", "PLUM_0")[i % 3]
        P.rect(x, ybot - 13, x + 4, ybot, col)
        P.line(x, ybot - 13, x + 4, ybot - 13, LIT[col])
        P.line(x + 1, ybot - 4, x + 3, ybot - 4, "INK")
        x += 6
        i += 1


def reading_lamp(P: Pen, x: int, ybot: int):
    """Banker's lamp inside the shelf: green shade, warm pool on the books around it."""
    P.rect(x, ybot - 1, x + 7, ybot, "GOLD_DK")
    P.line(x, ybot - 1, x + 7, ybot - 1, "GOLD")
    P.line(x + 3, ybot - 6, x + 3, ybot - 2, "GOLD_DK")
    P.rect(x, ybot - 9, x + 7, ybot - 7, "LEAF_2")
    P.line(x + 1, ybot - 10, x + 6, ybot - 10, "LEAF_1")
    P.line(x, ybot - 9, x + 7, ybot - 9, "LEAF_3")
    P.line(x + 1, ybot - 6, x + 6, ybot - 6, "SUN")
    P.glow(x + 3.5, ybot - 3, 14, WARM, gain=1.1, box=(IN_X0, BAYS[1][0], IN_X1, ybot + 2))
    P.line(x + 1, ybot - 6, x + 6, ybot - 6, "SUN")
    P.rect(x, ybot - 9, x + 7, ybot - 8, "LEAF_2")
    P.line(x, ybot - 9, x + 7, ybot - 9, "LEAF_3")


def shelf_plant(tier: int) -> Pen:
    """Decor on top of the bookshelf, left end. t1 a sad cactus, t3 a pothos trailing down the frame, t5 lush."""
    P = Pen(178, 76, 204, 160, sort=205)
    if tier == 1:
        P.rect(184, 95, 189, 99, "SLATE_0")
        P.line(184, 95, 189, 95, "SLATE_1")
        P.rect(186, 89, 187, 94, "LEAF_1")
        P.px(185, 91, "LEAF_1")
        P.px(188, 92, "LEAF_1")
        P.line(187, 89, 187, 93, "LEAF_2")
        return P
    # pot
    P.poly([(182, 93), (190, 93), (189, 99), (183, 99)], "TERRA_1")
    P.line(182, 93, 190, 93, "TERRA_2")
    P.line(189, 94, 189, 98, "RIM")
    P.line(183, 99, 189, 99, "TERRA_0")
    big = tier >= 5
    blobs = [(180, 86, 6), (185, 83, 6), (190, 86, 5), (183, 89, 4), (189, 90, 4)]
    if big:
        blobs += [(179, 80, 5), (192, 80, 5), (186, 78, 5), (195, 86, 4)]
    for i, (cx, cy, r) in enumerate(blobs):
        P.ell(cx - r // 2 - 1, cy - r // 2, cx + r // 2 + 1, cy + r // 2, "LEAF_1")
    for i, (cx, cy, r) in enumerate(blobs):
        P.px(cx + 1, cy - 1, "LEAF_2")
        P.px(cx, cy - 1, "LEAF_2")
        P.px(cx - 1, cy + 1, "LEAF_0")
    P.edge("LEAF_2", 0, -1, match={"LEAF_1"}, prob=0.6, seed=3)
    P.edge("RIM", 1, 0, match={"LEAF_1", "LEAF_2"}, prob=0.5, seed=4)
    # trailing vines down the left upright and along the crown
    vines = [(181, 99, 181, 150 if big else 132), (186, 99, 187, 118 if big else 110)]
    if big:
        vines.append((190, 99, 193, 126))
    for k, (x0, y0, x1, y1) in enumerate(vines):
        for y in range(y0, y1 + 1):
            t = (y - y0) / max(1, y1 - y0)
            x = round(lerp(x0, x1, t) + math.sin(y * 0.5 + k) * 0.6)
            P.px(x, y, "LEAF_0" if y % 2 else "LEAF_1")
            if (y + k) % 5 == 0:
                P.px(x + 1, y, "LEAF_2")
                P.px(x - 1, y + 1, "LEAF_1")
    return P


def globe() -> Pen:
    P = Pen(204, 85, 216, 99)
    P.circ(210, 91, 4, "SLATE_0")
    P.rect(207, 89, 209, 91, "LEAF_1")
    P.rect(211, 92, 213, 94, "LEAF_1")
    P.px(210, 88, "LEAF_1")
    P.px(212, 89, "SLATE_1")
    P.px(213, 90, "SLATE_1")
    P.px(214, 91, "RIM")
    P.px(213, 93, "SLATE_1")
    P.line(206, 87, 209, 86, "GOLD_DK")  # meridian ring
    P.line(205, 89, 205, 93, "GOLD_DK")
    P.line(206, 95, 208, 96, "GOLD_DK")
    P.line(210, 96, 210, 97, "GOLD_DK")
    P.rect(207, 98, 213, 99, "BROWN_0")
    P.line(207, 98, 213, 98, "GOLD_DK")
    P.px(213, 98, "GOLD")
    return P


def ladder() -> Pen:
    """Leaning wooden ladder resting on the shelf's crown, feet on the floor in front."""
    P = Pen(212, 101, 230, 207, sort=208)
    L0, L1 = (214, 103), (219, 206)
    R0, R1 = (221, 103), (227, 206)
    for dx in (0, 1):
        P.line(L0[0] + dx, L0[1], L1[0] + dx, L1[1], "BROWN_2" if dx == 0 else "TERRA_0")
        P.line(R0[0] + dx, R0[1], R1[0] + dx, R1[1], "BROWN_2" if dx == 0 else "RIM")
    for y in range(112, 204, 12):
        t = (y - 103) / 103
        xl = round(lerp(L0[0], L1[0], t)) + 2
        xr = round(lerp(R0[0], R1[0], t)) - 1
        P.line(xl, y, xr, y, "TERRA_1")
        P.line(xl, y + 1, xr, y + 1, "BROWN_0")
    P.px(214, 102, "INK")
    P.px(221, 102, "INK")
    P.line(219, 206, 220, 206, "INK")
    P.line(227, 206, 228, 206, "INK")
    return P


def throw() -> Pen:
    """A knitted throw folded over a ladder rung: terracotta knit, a plum stripe, a short fringe."""
    P = Pen(213, 150, 232, 170, sort=209)
    pts = [(216, 152), (228, 151), (229, 154), (230, 163), (228, 166), (224, 165), (220, 167), (217, 165),
           (215, 158)]
    P.poly(pts, "TERRA_0")
    P.line(216, 151, 228, 151, "TERRA_1")
    P.line(216, 152, 228, 152, "BROWN_2")
    P.line(215, 159, 230, 158, "PLUM_1", only="opaque")
    P.line(215, 160, 230, 159, "PLUM_0", only="opaque")
    for x in (219, 223):
        P.line(x, 154, x, 164, "BROWN_2", only="TERRA_0")
    P.line(226, 154, 227, 163, "TERRA_1", only="TERRA_0")
    P.edge("RIM", 1, 0, prob=0.85, seed=5)
    for x in range(217, 229, 2):
        for yy in range(169, 155, -1):
            if P.get(x, yy) is not None:
                P.px(x, yy + 1, "BROWN_2")
                break
    return P


# ---- wall: bookend ledge, framed print, potion shelf
def bookend_ledge() -> Pen:
    P = Pen(231, 69, 258, 82)
    P.rect(232, 79, 257, 80, "BROWN_2")
    P.line(232, 79, 257, 79, "TERRA_1")
    P.line(232, 81, 257, 81, "BROWN_0")
    P.line(252, 79, 257, 79, "RIM")
    P.px(234, 82, "INK")
    P.px(255, 82, "INK")
    bookend(P, 234, 78)
    x = books(P, 237, 246, 78, 41, hmax=8, hmin=6, lit=0.5)
    P.rect(x + 1, 72, x + 2, 78, "GOLD_DK")
    P.px(x + 1, 72, "GOLD")
    # hourglass
    P.line(251, 71, 255, 71, "GOLD_DK")
    P.line(251, 78, 255, 78, "GOLD_DK")
    P.poly([(252, 72), (254, 72), (253, 74)], "INK_COOL")
    P.poly([(252, 77), (254, 77), (253, 75)], "AMBER")
    P.px(253, 74, "AMBER")
    P.px(255, 72, "RIM")
    return P


def framed_print() -> Pen:
    """A jazz-night poster: plum sky, gold moon, a dark row of rooftops, a title bar."""
    P = Pen(232, 85, 256, 107)
    P.rect(233, 86, 255, 106, "BROWN_0")
    P.rect(235, 88, 253, 104, "PLUM_0")
    P.dither(235, 88, 253, 93, "keep", "INK", mix=0.4, only="PLUM_0")
    P.circ(248, 93, 3, "GOLD_DK")
    P.px(249, 92, "GOLD")
    P.poly([(235, 101), (238, 98), (241, 99), (244, 96), (247, 99), (250, 98), (253, 100), (253, 104),
            (235, 104)], "INK")
    P.px(240, 100, "AMBER")
    P.px(246, 99, "AMBER")
    P.line(237, 90, 243, 90, "ROSE_0")
    P.line(237, 92, 240, 92, "ROSE_0")
    P.line(235, 104, 253, 104, "TERRA_0")
    P.line(233, 86, 255, 86, "TERRA_1")
    P.line(248, 86, 255, 86, "RIM")
    P.line(255, 87, 255, 106, "BROWN_2")
    P.line(233, 106, 255, 106, "INK")
    return P


POTIONS_TOP = ["ai-building", "dropshipping", "academics", "reading", "college-integration", "time-blocking",
               "chess", "meditation"]
POTIONS_LOW = ["visualization", "strength", "running", "sleep", "triathlon", "food", "gut-health"]
SKILL_CAT = {"ai-building": "business", "dropshipping": "business", "academics": "school", "reading": "school",
             "college-integration": "school", "time-blocking": "mind", "chess": "mind", "meditation": "mind",
             "visualization": "mind", "strength": "athletics", "running": "athletics", "sleep": "athletics",
             "triathlon": "athletics", "food": "nutrition", "gut-health": "nutrition"}
SHAPES = ["flask", "vial", "round", "flask", "vial", "tall", "round", "vial"]


def bottle(P: Pen, x: int, ybot: int, shape: str, cat: str, fill: float, lamp: bool = False):
    """One small potion bottle standing on row ybot. Glass dark, liquid in the category's mid shade."""
    dk, mid, lt = PAL["categories"][cat]
    if shape == "vial":
        w, body_h, neck = 2, 5, 0
    elif shape == "tall":
        w, body_h, neck = 2, 6, 1
    elif shape == "round":
        w, body_h, neck = 3, 3, 1
    else:
        w, body_h, neck = 3, 4, 1
    top = ybot - body_h + 1
    P.rect(x, top, x + w - 1, ybot, "INK_COOL")
    if shape == "round":
        P.rect(x - 0, top - 1, x + w - 1, top - 1, "INK_COOL")
        P.px(x, top - 1, None)
        P.px(x + w - 1, top - 1, None)
    nx = x + (w - 1) // 2
    ny = top - (2 if shape == "round" else 1)
    for k in range(neck):
        P.px(nx, ny - k, "INK_COOL")
    cork_y = ny - neck
    P.px(nx, cork_y, "BROWN_2" if cat != "business" else "GOLD_DK")
    lvl = ybot - max(1, round(body_h * fill)) + 1
    P.rect(x, lvl, x + w - 1, ybot, mid)
    P.px(x + w - 1, lvl, lt)
    if w >= 2:
        P.px(x, ybot, dk)
    P.px(x + w - 1, top, "RIM" if not lamp else "GLOW")


def potion_shelf() -> Pen:
    P = Pen(230, 108, 260, 140)
    for by in (120, 135):
        P.rect(231, by, 258, by + 2, "BROWN_0")
        P.line(231, by, 258, by, "TERRA_1")
        P.line(231, by + 2, 258, by + 2, "INK")
        P.line(255, by, 258, by, "AMBER")  # the floor lamp beside it warms the end
        P.px(258, by + 1, "TERRA_1")
        for bx in (233, 255):
            P.px(bx, by + 3, "INK")
            P.line(bx, by + 4, bx + 1, by + 3, "INK")
    x = 232
    fills = [0.6, 0.5, 0.65, 0.55, 0.45, 0.6, 0.5, 0.55]
    for i, slug in enumerate(POTIONS_TOP):
        shape = SHAPES[i % len(SHAPES)]
        w = 2 if shape in ("vial", "tall") else 3
        bottle(P, x, 119, shape, SKILL_CAT[slug], fills[i], lamp=(i == len(POTIONS_TOP) - 1))
        x += w + 1
    x = 233
    for i, slug in enumerate(POTIONS_LOW):
        shape = SHAPES[(i + 3) % len(SHAPES)]
        w = 2 if shape in ("vial", "tall") else 3
        bottle(P, x, 134, shape, SKILL_CAT[slug], fills[(i + 2) % 8], lamp=(i == len(POTIONS_LOW) - 1))
        x += w + 1
    # a little brass plate on the lower board for the LED
    return P


def floor_lamp(tier: int) -> Pen:
    """Library floor lamp at the right end of the potion shelf. t1 clamp lamp, t3 drum shade, t5 brass."""
    P = Pen(254, 106, 272, 207, sort=207)
    if tier == 1:
        # clamp lamp on the shelf bracket, cord down to the floor
        P.rect(256, 121, 258, 123, "INK")
        P.poly([(257, 116), (262, 114), (264, 119), (259, 121)], "BROWN_1")
        P.line(257, 116, 262, 114, "RIM")
        P.line(260, 121, 264, 119, "CREAM")
        P.px(262, 120, "SUN")
        y = 124
        x = 258
        while y < 205:
            P.px(x, y, "INK")
            y += 1
            x = 258 + round(math.sin(y * 0.15) * 1.5)
        P.line(x, 205, x + 8, 205, "INK")
        return P
    gold = tier >= 5
    P.line(263, 123, 263, 203, "INK")
    P.line(264, 123, 264, 203, "GOLD_DK" if gold else "BROWN_2")
    if gold:
        P.px(264, 124, "GOLD")
        P.px(264, 160, "GOLD")
        P.px(264, 161, "GOLD")
    P.ell(259, 202, 268, 206, "INK")
    P.line(260, 202, 267, 202, "GOLD" if gold else "GOLD_DK")
    if gold:
        shade = [(258, 110), (268, 110), (271, 123), (255, 123)]
    else:
        shade = [(259, 113), (267, 113), (269, 122), (257, 122)]
    P.poly(shade, "AMBER")
    top_y, bot_y = shade[0][1], shade[2][1]
    P.dither(shade[3][0], top_y, shade[2][0], bot_y, "keep", "GLOW", mix=0.45, only="AMBER")
    if gold:
        for x in range(257, 271, 2):
            P.line(x, top_y + 1, x, bot_y - 1, "TERRA_1", only="opaque")
        P.line(258, top_y, 268, top_y, "GOLD")
    P.line(shade[0][0], top_y, shade[1][0], top_y, "TERRA_1")
    P.line(shade[3][0], bot_y, shade[2][0], bot_y, "SUN")
    P.px(shade[3][0], bot_y, "GLOW")
    P.px(shade[2][0], bot_y, "GLOW")
    P.line(shade[3][0], bot_y + 1, shade[2][0], bot_y + 1, None)
    P.px(263, bot_y + 1, "CREAM")  # bulb peeking out
    return P


def string_lights() -> Pen:
    """Warm string lights sagging along the top of the library wall, from the corner to the window frame."""
    P = Pen(176, 63, 279, 76)
    hooks = [(178, 66), (212, 65), (246, 66), (277, 66)]
    pts = []
    for (x0, y0), (x1, y1) in zip(hooks, hooks[1:]):
        for x in range(x0, x1):
            t = (x - x0) / (x1 - x0)
            pts.append((x, round(lerp(y0, y1, t) + 4 * 4 * t * (1 - t))))
    for x, y in pts:
        P.px(x, y, "INK")
    for (x, y) in hooks:
        P.px(x, y - 1, "BROWN_2")
    for i, (x, y) in enumerate(pts[3::5]):
        c = ("GLOW", "AMBER", "GLOW", "SUN", "AMBER", "GLOW")[i % 6]
        P.px(x, y + 1, c)
        if c in ("GLOW", "SUN") and i % 2 == 0:
            P.px(x, y + 2, "TERRA_1")
    return P


def wall_clock() -> Pen:
    P = Pen(243, 144, 257, 158)
    P.circ(250, 151, 5, "BROWN_0")
    P.circ(250, 151, 4, "ROSE_0")
    for (x, y) in ((250, 148), (253, 151), (250, 154), (247, 151)):
        P.px(x, y, "BROWN_2")
    P.line(250, 151, 250, 148, "INK")
    P.line(250, 151, 252, 152, "INK")
    P.px(250, 151, "CRT_0")
    P.px(253, 147, "RIM")
    P.px(254, 148, "RIM")
    P.px(255, 151, "AMBER")
    P.px(255, 152, "AMBER")
    return P


# ---- floor: record crate, magazine rack, desk fan, book stacks
def record_crate(tier: int) -> Pen:
    P = Pen(230, 180, 256, 205, sort=206)
    sleeves = ["TERRA_0", "SLATE_0", "PLUM_1", "CREAM", "BROWN_2", "TERRA_1", "INK", "GOLD_DK", "ROSE_0",
               "PLUM_0", "LEAF_1", "TERRA_0", "SLATE_1", "BROWN_2", "INK_COOL"]
    if tier >= 5:
        # walnut console with record slots and a lidded turntable
        P.poly([(250, 191), (254, 188), (254, 201), (250, 205)], "TERRA_0")
        P.rect(231, 191, 250, 204, "TERRA_0")
        P.poly([(231, 191), (250, 191), (254, 188), (235, 188)], "BROWN_2")
        P.line(231, 191, 250, 191, "TERRA_1")
        P.line(250, 191, 250, 204, "RIM")
        for i, x in enumerate(range(233, 249)):
            P.line(x, 194, x, 202, sleeves[i % len(sleeves)] if i % 3 else "INK")
        P.line(232, 193, 249, 193, "INK")
        P.line(232, 203, 249, 203, "INK")
        P.px(232, 205, "GOLD_DK")
        P.px(249, 205, "GOLD_DK")
        turntable(P, 235, 187, gold=True)
        return P
    if tier == 1:
        # cardboard box with open flaps
        P.rect(233, 194, 248, 204, "TERRA_1")
        P.dither(233, 194, 240, 204, "keep", "BROWN_2", mix=0.5, only="TERRA_1")
        P.poly([(233, 194), (230, 189), (232, 188), (235, 194)], "BROWN_2")
        P.poly([(248, 194), (252, 190), (253, 191), (249, 195)], "TERRA_1")
        P.line(248, 195, 248, 204, "RIM")
        for i, x in enumerate(range(235, 247)):
            P.line(x, 189 + (i % 3 == 0), x, 194, sleeves[i % len(sleeves)])
        P.line(233, 199, 248, 199, "BROWN_2")
        P.line(234, 204, 248, 204, "BROWN_0")
        return P
    # wooden crate (t3 base; t4 adds a turntable on top)
    P.poly([(249, 193), (252, 190), (252, 201), (249, 204)], "BROWN_0")
    P.dither(250, 190, 252, 201, "keep", "TERRA_0", mix=0.5, only="BROWN_0")
    if tier < 4:
        for i, x in enumerate(range(233, 249)):
            lean = 1 if i % 4 == 0 else 0
            P.line(x + lean, 187 + (i * 7) % 3, x, 193, sleeves[i % len(sleeves)])
            if sleeves[i % len(sleeves)] in ("CREAM", "SLATE_1"):
                P.px(x + lean, 187 + (i * 7) % 3, "ROSE_0")
    P.rect(232, 193, 249, 204, "INK")
    for y in (193, 197, 201):
        P.rect(232, y, 249, y + 2, "BROWN_2")
        P.line(232, y, 249, y, "TERRA_1")
    P.line(232, 193, 232, 204, "BROWN_0")
    P.line(249, 193, 249, 204, "RIM")
    P.line(232, 204, 249, 204, "INK")
    P.rect(236, 198, 238, 199, "INK")  # hand hole
    if tier >= 4:
        turntable(P, 234, 192, gold=False)
    return P


def turntable(P: Pen, x: int, ybot: int, gold: bool):
    """Record player resting with its front-bottom edge on row ybot (front face 3 rows, top face above)."""
    P.poly([(x, ybot - 3), (x + 15, ybot - 3), (x + 17, ybot - 7), (x + 3, ybot - 7)], "BROWN_1")
    P.ell(x + 3, ybot - 7, x + 12, ybot - 3, "INK")
    P.ell(x + 6, ybot - 6, x + 9, ybot - 4, "VOID")
    P.px(x + 7, ybot - 5, "CRT_0")
    P.line(x + 14, ybot - 6, x + 11, ybot - 4, "SLATE_1")
    P.rect(x, ybot - 2, x + 15, ybot, "BROWN_0" if not gold else "TERRA_0")
    P.line(x, ybot - 2, x + 15, ybot - 2, "GOLD_DK" if not gold else "GOLD")
    P.px(x + 13, ybot - 1, "CRT_1")
    P.px(x + 15, ybot - 1, "RIM")
    if gold:
        P.line(x + 1, ybot - 8, x + 16, ybot - 8, "SLATE_0")  # dust cover edge


def magazine_rack() -> Pen:
    """Wire magazine pocket hung on the wall under the potion shelf, three magazines sticking out."""
    P = Pen(230, 140, 243, 161)
    covers = [("SLATE_0", 142), ("PLUM_1", 144), ("TERRA_1", 143)]
    for i, (c, top) in enumerate(covers):
        x = 232 + i * 3
        P.rect(x, top, x + 4, 158, c)
        P.line(x, top, x + 4, top, LIT.get(c, c))
        P.line(x + 1, top + 2, x + 3, top + 2, "CREAM" if i == 1 else "INK")
        P.line(x + 4, top + 1, x + 4, 158, "BROWN_0")
    P.rect(231, 150, 241, 159, "INK")
    P.rect(232, 151, 240, 158, "BROWN_0")
    P.line(232, 152, 240, 152, "INK")
    P.line(232, 155, 240, 155, "INK")
    P.line(231, 150, 241, 150, "SLATE_0")
    P.px(241, 150, "RIM")
    P.px(241, 151, "RIM")
    return P


def desk_fan() -> Pen:
    """Small desk fan standing on top of the bookshelf."""
    P = Pen(214, 85, 227, 99)
    P.circ(221, 91, 4, "INK")
    P.circ(221, 91, 3, "BROWN_1")
    for (dx, dy) in ((0, -2), (2, 1), (-2, 1)):
        P.line(221, 91, 221 + dx, 91 + dy, "SLATE_0")
    P.px(221, 91, "GOLD_DK")
    for a in range(-90, 61, 25):
        r = math.radians(a)
        P.px(round(221 + 4 * math.cos(r)), round(91 + 4 * math.sin(r)), "RIM")
    P.line(221, 96, 221, 98, "INK")
    P.rect(218, 98, 224, 99, "BROWN_1")
    P.line(218, 98, 224, 98, "BROWN_2")
    P.px(224, 98, "RIM")
    return P


def book_stack(seed: int, x: int, ybot: int, n: int, sort: int) -> Pen:
    P = Pen(x - 2, ybot - 2 * n - 1, x + 12, ybot, sort=sort)
    lying(P, x, ybot, n, seed, wmin=9, wmax=11)
    return P


# ---- chess table with two stools
def chess(stage: str) -> Pen:
    P = Pen(200, 176, 262, 218, sort=219)
    cy = 216
    k = ppf(cy)
    X0 = (218 - 320) / k
    Zf = zof(cy)
    W, D, H = 1.5, 1.5, 1.45
    fl, fr = proj(X0, Zf, H), proj(X0 + W, Zf, H)
    bl, br = proj(X0, Zf + D, H), proj(X0 + W, Zf + D, H)
    ftop = round(fl[1])  # 189
    # left stool (behind-left)
    stool(P, 209, 216, 197)
    # back legs
    bk_floor = proj(X0 + W, Zf + D, 0)
    P.line(round(br[0]) - 1, round(br[1]) + 2, round(bk_floor[0]) - 1, round(bk_floor[1]), "INK")
    blf = proj(X0, Zf + D, 0)
    P.line(round(bl[0]) + 1, round(bl[1]) + 2, round(blf[0]) + 1, round(blf[1]), "INK")
    # right side apron (lit side faces the window)
    P.poly([(round(fr[0]), ftop), (round(br[0]), round(br[1])), (round(br[0]), round(br[1]) + 4),
            (round(fr[0]), ftop + 4)], "TERRA_0")
    P.line(round(fr[0]), ftop + 1, round(br[0]), round(br[1]) + 1, "TERRA_1")
    # top face
    top = [(round(fl[0]), ftop), (round(fr[0]), ftop), (round(br[0]), round(br[1])), (round(bl[0]), round(bl[1]))]
    P.poly(top, "BROWN_2")
    P.line(top[3][0], top[3][1], top[2][0], top[2][1], "BROWN_0")
    P.dither(230, round(br[1]), round(br[0]), ftop, "keep", "TERRA_0", mix=0.35, only="BROWN_2")
    # front apron + legs
    x0, x1 = round(fl[0]), round(fr[0]) - 1
    P.rect(x0, ftop + 1, x1, ftop + 4, "BROWN_0")
    P.line(x0, ftop + 1, x1, ftop + 1, "TERRA_0")
    P.line(x0, ftop, x1, ftop, "TERRA_1")
    P.line(x1 - 6, ftop, x1, ftop, "RIM")
    for lx in (x0 + 1, x1 - 1):
        P.rect(lx, ftop + 5, lx + 1, cy - 1, "BROWN_0")
        P.px(lx + 1, ftop + 5, "BROWN_2")
    P.line(x1, ftop + 5, x1, cy - 1, "TERRA_0")
    P.line(x0 + 1, cy - 1, x0 + 2, cy - 1, "INK")
    P.line(x1 - 1, cy - 1, x1, cy - 1, "INK")
    # the board (and what is on it)

    def at(u, v):
        """Point on the table top: u 0..1 left->right, v 0..1 front->back."""
        xl = lerp(top[0][0], top[3][0], v)
        xr = lerp(top[1][0], top[2][0], v)
        return lerp(xl, xr, u), lerp(top[0][1], top[3][1], v)

    if stage == "s0":
        # board still in its retail box, a bag of pieces next to it
        bx0, by = at(0.18, 0.25)
        P.poly([(bx0, by), (bx0 + 13, by), (bx0 + 16, by - 3), (bx0 + 3, by - 3)], "TERRA_1")
        P.rect(bx0, by + 1, bx0 + 13, by + 2, "TERRA_0")
        for i in range(4):
            P.px(bx0 + 4 + i * 2, by - 1 - (i % 2), "INK")
            P.px(bx0 + 5 + i * 2, by - 2 + (i % 2), "CREAM")
        P.line(bx0, by, bx0 + 13, by, "TERRA_2")
        P.px(bx0 + 13, by + 1, "RIM")
        sx, sy = at(0.8, 0.5)
        P.ell(sx - 2, sy - 2, sx + 2, sy, "ROSE_0")
        P.px(sx, sy - 3, "BROWN_2")
    else:
        # checkered board via the table-top mapping
        for y in range(round(br[1]), ftop + 1):
            for x in range(top[0][0], top[2][0] + 1):
                v = (ftop - y) / max(1, ftop - top[3][1])
                xl = lerp(top[0][0], top[3][0], v)
                xr = lerp(top[1][0], top[2][0], v)
                if xr == xl:
                    continue
                u = (x - xl) / (xr - xl)
                if 0.16 <= u <= 0.84 and 0.12 <= v <= 0.92:
                    i = int((u - 0.16) / 0.68 * 8)
                    j = int((v - 0.12) / 0.8 * 4)
                    P.px(x, y, "ROSE_0" if (i + j) % 2 == 0 else "BROWN_0")
        # board edge
        a, b, c, d = at(0.15, 0.1), at(0.85, 0.1), at(0.85, 0.94), at(0.15, 0.94)
        P.line(a[0], a[1] + 1, b[0], b[1] + 1, "INK")
        P.line(b[0] + 1, b[1] + 1, c[0] + 1, c[1], "GOLD_DK")

        def piece(u, v, white, tall):
            x, y = at(u, v)
            x, y = round(x), round(y)
            body = "ROSE_0" if white else "INK"
            head = ("CREAM" if tall >= 3 else "ROSE_1") if white else ("TERRA_1" if tall >= 3 else "BROWN_2")
            for k2 in range(tall):
                P.px(x, y - k2, body)
            P.px(x, y - tall, head)

        cols = [(i + 0.5) / 8 for i in range(8)]
        if stage == "s1":
            for i, u in enumerate(cols):
                uu = 0.16 + u * 0.68
                piece(uu, 0.36, True, 1)
                piece(uu, 0.82, False, 1)
            for i, u in enumerate(cols):
                uu = 0.16 + u * 0.68
                piece(uu, 0.16, True, 3 if i in (3, 4) else 2)
                piece(uu, 0.92, False, 3 if i in (3, 4) else 2)
        else:
            mid = [(0.3, 0.3, True, 1), (0.45, 0.42, True, 2), (0.62, 0.3, True, 3), (0.75, 0.2, True, 1),
                   (0.38, 0.7, False, 1), (0.55, 0.58, False, 2), (0.7, 0.82, False, 3), (0.25, 0.86, False, 1),
                   (0.5, 0.16, True, 2)]
            for u, v, wte, t in mid:
                piece(u, v, wte, t)
            # captured pieces on the right margin, trophy at the back right corner
            for n2, (u, v) in enumerate(((0.92, 0.2), (0.95, 0.35), (0.92, 0.5))):
                piece(u, v, n2 % 2 == 0, 1)
            tx, ty = at(0.92, 0.85)
            tx, ty = round(tx), round(ty)
            P.line(tx - 1, ty, tx + 1, ty, "GOLD_DK")
            P.px(tx, ty - 1, "GOLD_DK")
            P.rect(tx - 1, ty - 4, tx + 1, ty - 2, "GOLD")
            P.px(tx + 1, ty - 4, "SUN")
            P.px(tx - 2, ty - 3, "GOLD_DK")
            P.px(tx + 2, ty - 3, "GOLD_DK")
    # right stool (front-right, overlapping the table's side)
    stool(P, 254, 218, 199)
    return P


def stool(P: Pen, cx: int, contact: int, seat: int):
    """Small round stool: seat ellipse, three splayed legs."""
    P.line(cx - 4, seat + 2, cx - 5, contact - 1, "BROWN_0")
    P.line(cx + 4, seat + 2, cx + 5, contact - 1, "TERRA_0")
    P.line(cx, seat + 2, cx, contact - 2, "INK")
    P.line(cx - 4, seat + 9, cx + 4, seat + 9, "BROWN_0")
    P.ell(cx - 6, seat - 1, cx + 6, seat + 2, "BROWN_2")
    P.line(cx - 4, seat - 1, cx + 3, seat - 1, "TERRA_1")
    P.px(cx + 5, seat, "RIM")
    P.px(cx + 6, seat + 1, "RIM")
    P.line(cx - 5, seat + 2, cx + 5, seat + 2, "BROWN_0")


# ---- meditation corner
def meditation(stage: str) -> Pen:
    P = Pen(176, 186, 210, 220, sort=221)
    cy = 220
    k = ppf(cy)
    Zf = zof(cy)
    X0 = (179 - 320) / k
    W, D, H = 1.15, 1.0, 0.22
    fl, fr = proj(X0, Zf, H), proj(X0 + W, Zf, H)
    bl, br = proj(X0, Zf + D, H), proj(X0 + W, Zf + D, H)
    fy = round(fl[1])
    top = [(round(fl[0]), fy), (round(fr[0]), fy), (round(br[0]), round(br[1])), (round(bl[0]), round(bl[1]))]
    if stage == "s2":  # plant in the back-left corner of the mat, drawn first so the mat overlaps its pot
        P.poly([(177, 205), (183, 205), (182, 211), (178, 211)], "TERRA_0")
        P.line(177, 205, 183, 205, "TERRA_1")
        for (lx, ly, ex, ey) in ((180, 205, 177, 196), (180, 205, 181, 194), (180, 205, 185, 197),
                                 (180, 205, 178, 200), (180, 205, 184, 201)):
            P.line(lx, ly, ex, ey, "LEAF_1")
            P.rect(ex - 1, ey - 1, ex + 1, ey, "LEAF_1")
            P.px(ex + 1, ey - 1, "LEAF_2")
        P.px(182, 193, "RIM")
        P.px(186, 196, "RIM")
    P.poly(top, "PLUM_0")
    P.rect(top[0][0], fy + 1, top[1][0], cy - 1, "PLUM_0")
    P.line(top[0][0], fy + 1, top[1][0], fy + 1, "PLUM_1")
    P.line(top[0][0], cy - 1, top[1][0], cy - 1, "INK")
    P.poly([(top[1][0], fy), (top[2][0], top[2][1]), (top[2][0], top[2][1] + 2), (top[1][0], cy - 1)], "PLUM_0")
    P.line(top[0][0] + 1, fy - 1, top[1][0] - 1, fy - 1, "PLUM_1", only="PLUM_0")
    P.line(top[3][0], top[3][1], top[2][0], top[2][1], "PLUM_1")
    P.line(top[1][0], fy, top[2][0], top[2][1], "ROSE_1")  # piping on the window side
    if stage == "s0":
        # a crease and a folded corner: the cushion is flat and a bit neglected
        P.line(top[0][0] + 4, fy - 2, top[0][0] + 12, fy - 4, "PLUM_1")
        P.poly([(top[3][0], top[3][1]), (top[3][0] + 4, top[3][1]), (top[3][0] + 1, top[3][1] + 3)], "PLUM_1")
        return P
    if stage == "s2":
        zx = (top[0][0] + top[2][0]) // 2
        zy = (fy + top[3][1]) // 2
        # zafu: round pleated cushion, top lit from the window side (right)
        P.ell(zx - 7, zy - 3, zx + 7, zy + 2, "PLUM_0")
        P.ell(zx - 7, zy - 7, zx + 7, zy - 1, "PLUM_1")
        P.ell(zx - 1, zy - 7, zx + 6, zy - 3, "PLUM_2", only="PLUM_1")
        P.px(zx, zy - 5, "PLUM_0")
        P.px(zx + 1, zy - 5, "PLUM_1")
        for px_ in range(zx - 5, zx + 6, 2):
            P.px(px_, zy, "PLUM_1", only="PLUM_0")
        P.line(zx - 5, zy + 2, zx + 5, zy + 2, "INK", only="PLUM_0")
        P.px(zx + 7, zy - 4, "RIM")
        P.px(zx + 7, zy - 3, "RIM")
        P.px(zx + 6, zy - 6, "ROSE_1")
        # incense: holder on the floor at the left front, a thin stick with an ember and two wisps of smoke
        P.line(top[0][0] - 1, cy - 2, top[0][0] + 2, cy - 2, "GOLD_DK")
        P.line(top[0][0] + 1, cy - 3, top[0][0] + 4, cy - 10, "BROWN_2")
        P.px(top[0][0] + 4, cy - 11, "GLOW")
        sx0 = top[0][0] + 4
        for k, dx in enumerate((0, 1, 1, 0, 0, -1, -1, 0, 1)):
            P.px(sx0 + dx, cy - 12 - k, "ROSE_0" if k < 5 else "BROWN_2")
    # candle at the front right corner of the mat
    cx = top[1][0] + 2
    P.rect(cx, cy - 5, cx + 1, cy - 1, "CREAM")
    P.px(cx + 1, cy - 5, "AMBER")
    P.px(cx, cy - 6, "GLOW")
    P.px(cx, cy - 7, "SUN")
    P.line(cx - 1, cy - 1, cx + 2, cy - 1, "BROWN_2")
    # candle light on the mat: a small solid pool, brighter right next to the flame
    for (x, y, n) in ((cx - 1, cy - 3, "PLUM_1"), (cx - 2, cy - 2, "PLUM_1"), (cx - 3, cy - 2, "PLUM_1"),
                      (cx - 1, cy - 2, "ROSE_1"), (cx - 2, cy - 3, "PLUM_1"), (cx - 1, cy - 4, "PLUM_1")):
        if P.get(x, y) in ("PLUM_0", "PLUM_1"):
            P.px(x, y, n)
    return P


# =================================================================== WINDOW ZONE
def vision_board(stage: str) -> Pen:
    P = Pen(263, 84, 278, 112)
    P.rect(264, 85, 277, 111, "BROWN_0")
    P.rect(265, 86, 276, 110, "BROWN_2")
    P.dither(265, 86, 276, 110, "keep", "TERRA_0", mix=0.3, only="BROWN_2")
    P.line(264, 85, 277, 85, "TERRA_1")
    P.line(270, 85, 277, 85, "RIM")
    P.line(264, 111, 277, 111, "INK")
    P.px(264, 110, "AMBER")  # the library floor lamp is just below-left
    P.px(264, 109, "TERRA_1")
    pins = []

    def card(x0, y0, x1, y1, col, inner=None, pin="CRT_0"):
        P.rect(x0, y0, x1, y1, col)
        if inner:
            P.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 2, inner)
        P.line(x0 + 1, y1 + 1, x1 + 1, y1 + 1, "BROWN_0", only="BROWN_2")
        pins.append((x0 + (x1 - x0) // 2, y0, pin))

    if stage == "s0":
        pins += [(268, 90, "CRT_0"), (273, 97, "SLATE_1"), (269, 104, "GOLD")]
    elif stage == "s1":
        card(266, 88, 271, 94, "CREAM", "SLATE_1", "CRT_0")      # photo: sky over water
        P.line(267, 92, 270, 92, "LEAF_2")
        card(272, 95, 275, 100, "PLUM_1", None, "GOLD")          # magazine cut-out
        card(267, 101, 271, 104, "AMBER", None, "SLATE_1")       # sticky note
        P.line(268, 102, 270, 102, "TERRA_1")
    else:
        card(265, 87, 270, 93, "CREAM", "SLATE_1", "CRT_0")
        P.line(266, 91, 269, 91, "LEAF_2")
        card(271, 87, 276, 91, "PLUM_1", None, "GOLD")
        card(272, 93, 276, 99, "ROSE_0", "TERRA_0", "SLATE_1")
        P.px(274, 95, "GOLD")
        card(265, 95, 269, 99, "AMBER", None, "CRT_0")
        card(266, 101, 271, 106, "CREAM", "LEAF_1", "GOLD")
        P.px(268, 103, "LEAF_3")
        card(273, 101, 276, 104, "SLATE_0", None, "CRT_0")
        P.rect(270, 108, 276, 109, "CREAM")  # word strip
        P.line(271, 108, 275, 108, "INK", only="CREAM")
        P.px(273, 108, "CREAM")
        P.line(267, 89, 274, 96, "CRT_0", only="BROWN_2")  # string between goals
        P.px(275, 106, "GOLD")
        P.px(276, 105, "SUN")
    for x, y, c in pins:
        P.px(x, y, c)
    return P


SILL_Y = 153  # pots stand on the sill's top surface


def sill_plants(stage: str) -> Pen:
    """Planter trough on the sill, backlit by the sunset: dark leaves with a hot rim on their upper edges."""
    P = Pen(280, 118, 342, 157)
    # trough: front face in shadow, top edge catching the light
    P.rect(290, 147, 321, SILL_Y, "BROWN_0")
    P.line(290, 147, 321, 147, "TERRA_1")
    P.line(290, 146, 321, 146, "BROWN_1")
    P.line(291, 148, 320, 148, "BROWN_2")
    P.line(290, SILL_Y, 321, SILL_Y, "INK")
    P.line(321, 147, 321, SILL_Y - 1, "BROWN_2")
    for x in (296, 315):
        P.line(x, 149, x, SILL_Y - 1, "INK")

    def herb(x, h, seed, kind="leafy", lush=1.0):
        if kind == "sprout":
            P.line(x, 146, x, 146 - h, "LEAF_2")
            P.px(x - 1, 146 - h, "LEAF_3")
            P.px(x + 1, 146 - h - 1, "LEAF_3")
            P.px(x + 1, 146 - h, "LEAF_2")
            return
        if kind == "chive":
            for k in range(-2, 3):
                hh = h - abs(k) * 2 + int(hsh(seed, k) * 2)
                P.line(x + k, 146, x + k + (1 if k > 0 else -1 if k < 0 else 0), 146 - hh, "LEAF_1")
            return
        r = 2 + int(lush * 2)
        for k in range(int(4 * lush) + 2):
            ox = round((hsh(seed, k, 1) - 0.5) * (r * 2 + 2))
            oy = round(hsh(seed, k, 2) * h)
            P.ell(x + ox - r, 146 - oy - r, x + ox + r, 146 - oy + 1, "LEAF_1")
        P.line(x, 146, x, 146 - h // 2, "LEAF_0")

    if stage == "s0":
        P.rect(291, 145, 320, 146, "BROWN_0")
        herb(305, 4, 1, "sprout")
    elif stage == "s1":
        P.rect(291, 145, 320, 146, "BROWN_0")
        herb(294, 8, 11)
        herb(304, 11, 12, "chive")
        herb(313, 6, 13, lush=0.7)
        jar(P, 325, 7, 10, "AMBER", "TERRA_1", "ferment")
    else:
        P.rect(291, 145, 320, 146, "BROWN_0")
        herb(293, 14, 21, lush=1.4)
        herb(300, 20, 22, "chive")
        herb(307, 16, 23, lush=1.5)
        herb(316, 12, 24, lush=1.2)
        # small pot at the left end with a vine spilling over the sill front
        P.poly([(282, 145), (288, 145), (287, SILL_Y), (283, SILL_Y)], "TERRA_0")
        P.line(282, 145, 288, 145, "TERRA_1")
        P.ell(281, 137, 289, 145, "LEAF_1")
        for y in range(146, 157):
            P.px(283 + (y % 3 == 0), y, "LEAF_1" if y % 2 else "LEAF_0")
        jar(P, 324, 9, 14, "AMBER", "ROSE_0", "kombucha")
        jar(P, 335, 5, 8, "LEAF_1", "LEAF_2", "ferment")
    # backlight: dark leaves, hot rim on top/right edges, a few lit leaves inside
    P.edge("RIM", 0, -1, match={"LEAF_1", "LEAF_0", "LEAF_2"}, prob=0.75, seed=7)
    P.edge("ORANGE", 1, 0, match={"LEAF_1"}, prob=0.35, seed=8)
    P.recolor({"LEAF_1": "LEAF_0"}, box=(280, 140, 342, 146))
    return P


def jar(P: Pen, x: int, w: int, h: int, liquid: str, top: str, kind: str):
    """A glass jar on the sill: dark glass, liquid, cloth cover with a band; glass rim lit by the window."""
    y1 = SILL_Y - 1
    y0 = y1 - h + 1
    P.rect(x, y0 + 2, x + w - 1, y1, "INK_COOL")
    lvl = y0 + 3 + (1 if kind == "kombucha" else 2)
    P.rect(x + 1, lvl, x + w - 2, y1 - 1, liquid)
    if kind == "kombucha":
        P.line(x + 1, lvl, x + w - 2, lvl, top)  # the SCOBY
        P.dither(x + 1, lvl + 1, x + w - 2, y1 - 1, "keep", "TERRA_1", mix=0.3, only=liquid)
    else:
        P.dither(x + 1, lvl, x + w - 2, y1 - 1, "keep", top, mix=0.4, only=liquid)
    P.rect(x - 1, y0, x + w, y0 + 1, "ROSE_0")  # cloth cover
    P.line(x - 1, y0 + 2, x + w, y0 + 2, "BROWN_0")
    P.line(x, y0, x + w - 1, y0, "RIM")
    P.line(x + w - 1, y0 + 3, x + w - 1, y1 - 1, "GLOW")
    P.px(x, y1, "INK")


def sill_speaker(tier: int) -> Pen:
    P = Pen(350, 128, 370, 153)
    if tier == 1:
        P.rect(359, 143, 365, 152, "SLATE_0")
        P.line(359, 143, 365, 143, "RIM")
        P.circ(362, 148, 2, "INK")
        P.px(362, 148, "SLATE_1")
        P.line(358, 144, 358, 152, "INK_COOL")
        return P
    wood = tier >= 5
    body = "TERRA_0" if wood else "BROWN_0"
    x0, x1, y0 = (354, 368, 131) if wood else (355, 367, 134)
    P.poly([(x0 - 2, y0 + 2), (x0, y0), (x0, 152), (x0 - 2, 152)], "BROWN_0")
    P.line(x0 - 2, y0 + 2, x0 - 2, 152, "RIM")
    P.rect(x0, y0, x1, 152, body)
    P.line(x0, y0, x1, y0, "RIM")
    P.line(x1, y0 + 1, x1, 151, "BROWN_2")
    cx = (x0 + x1) // 2
    P.circ(cx, y0 + 4, 1, "INK")
    P.circ(cx, 152 - 6, 4, "INK")
    P.circ(cx, 152 - 6, 2, "BROWN_1")
    P.px(cx, 152 - 6, "INK")
    P.px(cx + 2, 152 - 8, "BROWN_2")
    if wood:
        P.rect(x0 + 1, y0 + 1, x1 - 1, y0 + 1, "GOLD_DK")
    P.line(x0, 152, x1, 152, "INK")
    return P


# ---- big CRT and its stand
TV_X0, TV_X1, TV_Y0, TV_Y1 = 302, 339, 158, 187
SCR = (305, 161, 336, 181)


def big_crt() -> Pen:
    P = Pen(300, 154, 341, 187, sort=206)
    # top face (CRT body tapering back toward the wall)
    P.poly([(TV_X0, TV_Y0), (TV_X1, TV_Y0), (TV_X1 - 3, 155), (TV_X0 + 3, 155)], "BROWN_1")
    P.line(TV_X0 + 3, 155, TV_X1 - 3, 155, "TERRA_0")
    P.dither(TV_X0 + 2, 156, TV_X1 - 2, 157, "keep", "TERRA_0", mix=0.4, only="BROWN_1")
    # bezel
    P.rect(TV_X0, TV_Y0, TV_X1, TV_Y1, "BROWN_1")
    P.line(TV_X0, TV_Y0, TV_X1, TV_Y0, "RIM")
    P.line(TV_X0, TV_Y0 + 1, TV_X0, TV_Y1, "INK")
    P.line(TV_X1, TV_Y0 + 1, TV_X1, TV_Y1, "BROWN_0")
    P.line(TV_X0, TV_Y1, TV_X1, TV_Y1, "INK")
    sx0, sy0, sx1, sy1 = SCR
    P.rect(sx0 - 1, sy0 - 1, sx1 + 1, sy1 + 1, "INK")
    # screen: a red sunset over water (flat clusters, no dither)
    P.rect(sx0, sy0, sx1, sy1, "CRT_0")
    hz = sy0 + 13
    P.circ(315, hz - 4, 6, "CRT_1")
    P.rect(sx0, hz, sx1, sy1, "TERRA_0")
    P.circ(315, hz - 4, 3, "GLOW")
    P.px(314, hz - 6, "SUN")
    P.px(315, hz - 6, "SUN")
    P.line(sx0, hz, sx1, hz, "CRT_0")
    for (x0, x1, y) in ((321, 334, sy0 + 3), (324, 331, sy0 + 4), (305, 311, sy0 + 6), (306, 309, sy0 + 7),
                        (308, 322, hz - 3), (309, 318, hz - 2), (326, 336, hz - 2), (305, 307, hz - 1)):
        P.line(x0, y, x1, y, "TERRA_0")
    for (x0, x1, y) in ((312, 318, hz + 2), (313, 317, hz + 4), (314, 316, hz + 6), (323, 327, hz + 3),
                        (306, 308, hz + 5), (330, 334, hz + 2)):
        P.line(x0, y, x1, y, "CRT_0")
    P.line(314, hz + 2, 316, hz + 2, "CRT_1")
    P.px(315, hz + 4, "CRT_1")
    P.line(sx0, sy0, sx1, sy0, "TERRA_0")
    P.line(sx0, sy1, sx1, sy1, "VOID")
    for (x, y) in ((sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)):
        P.px(x, y, "INK")
    P.px(sx0 + 1, sy0 + 1, "ROSE_1")
    P.px(sx0 + 2, sy0 + 1, "ROSE_1")
    P.px(sx0 + 1, sy0 + 2, "ROSE_1")
    # chin: brand plate, buttons, power light (the LED socket sits at the right end)
    P.line(316, 184, 323, 184, "BROWN_2")
    P.px(307, 184, "INK")
    P.px(309, 184, "INK")
    P.px(305, 185, "CRT_1")
    # red glow from the screen on the bezel around it
    P.glow((sx0 + sx1) / 2, (sy0 + sy1) / 2, 22, {"BROWN_1": "TERRA_0"}, gain=0.55, sy=0.7)
    P.line(TV_X0, TV_Y0, TV_X1, TV_Y0, "RIM")
    P.line(TV_X0 + 4, TV_Y0, TV_X0 + 12, TV_Y0, "ORANGE")
    return P


def tv_stand(tier: int) -> Pen:
    """Low stand under the big CRT (front x 300..342, top at y 188, contact 205) plus the red screen glow on
    the floor in front of it."""
    P = Pen(296, 182, 346, 209, sort=210)
    # red reflection on the floor tiles in front of the stand
    for y in range(205, 210):
        for x in range(302, 341):
            t = 1 - abs(x - 320) / 20 - (y - 205) / 6
            if t > bay(x, y) + 0.15:
                P.px(x, y, "CRT_0" if t > 0.75 and (x + y) % 3 == 0 else "TERRA_0")
    top = [(300, 188), (342, 188), (340, 183), (302, 183)]
    if tier == 1:
        # two red milk crates with a plank across
        P.poly(top, "BROWN_2")
        P.line(300, 188, 342, 188, "TERRA_1")
        for cx0 in (301, 323):
            P.rect(cx0, 189, cx0 + 17, 204, "TERRA_0")
            for yy in range(191, 203, 3):
                for xx in range(cx0 + 2, cx0 + 16, 3):
                    P.rect(xx, yy, xx + 1, yy + 1, "INK")
            P.line(cx0, 189, cx0 + 17, 189, "TERRA_1")
            P.line(cx0 + 17, 190, cx0 + 17, 204, "CRT_0")
        P.rect(305, 197, 316, 200, "INK")
        P.line(306, 198, 309, 198, "CREAM")
    else:
        wood = "TERRA_0" if tier >= 5 else "BROWN_0"
        P.poly(top, "BROWN_2")
        P.rect(300, 188, 342, 203, wood)
        P.line(300, 188, 342, 188, "TERRA_1")
        P.line(300, 189, 342, 189, "BROWN_2" if tier < 5 else "TERRA_1")
        P.rect(302, 191, 340, 201, "VOID")
        # VCR with a red clock
        P.rect(303, 193, 326, 197, "BROWN_1")
        P.line(303, 193, 326, 193, "BROWN_2")
        P.line(305, 195, 314, 195, "INK")
        for x in (318, 319, 321, 322):
            P.px(x, 195, "CRT_1")
        P.px(320, 196, "CRT_0")
        # VHS tapes on end
        for i, x in enumerate(range(329, 340, 2)):
            P.rect(x, 194, x + 1, 201, "INK" if i % 2 else "BROWN_1")
            P.px(x, 196, "CREAM" if i % 3 == 0 else "ROSE_0")
        P.line(303, 199, 326, 199, "BROWN_0")
        P.rect(304, 199, 320, 201, "INK_COOL")
        P.px(306, 200, "SLATE_1")
        if tier >= 5:
            for x in range(301, 342, 3):
                P.px(x, 202, "BROWN_2")
            P.line(300, 203, 342, 203, "TERRA_1")
            for lx in (301, 340):
                P.rect(lx, 204, lx + 1, 204, "GOLD")
        else:
            P.rect(300, 202, 342, 203, wood)
            for lx in (301, 340):
                P.px(lx, 204, "INK")
        P.line(342, 189, 342, 203, "TERRA_0")
    # red glow from the screen onto the stand top and front
    P.poly([(306, 188), (336, 188), (334, 184), (308, 184)], "TERRA_0", only="opaque")
    P.line(310, 188, 332, 188, "CRT_0")
    P.line(300, 188, 309, 188, "TERRA_1")
    P.line(333, 188, 342, 188, "TERRA_1")
    return P


# ---- small CRT on a tape deck on an amp
def amp() -> Pen:
    P = Pen(341, 186, 371, 204, sort=205)
    P.poly([(343, 194), (345, 192), (345, 204), (343, 204)], "TERRA_0")
    P.poly([(345, 192), (369, 192), (367, 189), (347, 189)], "BROWN_1")
    P.rect(345, 194, 369, 204, "BROWN_0")
    P.line(345, 193, 369, 193, "TERRA_1")
    P.line(345, 194, 369, 194, "BROWN_1")
    P.line(345, 204, 369, 204, "INK")
    P.line(369, 194, 369, 203, "BROWN_1")
    for kx in (349, 365):
        P.circ(kx, 199, 2, "INK")
        P.px(kx, 198, "SLATE_0")
        P.px(kx + 1, 199, "GOLD_DK")
    for i, x in enumerate(range(353, 362, 2)):
        P.px(x, 197, "CRT_1" if i < 3 else "CRT_0")
    P.line(353, 200, 361, 200, "INK")
    P.line(353, 201, 358, 201, "AMBER")
    P.px(359, 201, "TERRA_1")
    P.line(353, 202, 361, 202, "INK")
    return P


def tape_deck() -> Pen:
    P = Pen(342, 180, 370, 193, sort=206)
    P.poly([(344, 186), (346, 184), (346, 193), (344, 193)], "TERRA_0")
    P.poly([(346, 185), (368, 185), (366, 182), (348, 182)], "BROWN_1")
    P.rect(346, 186, 368, 193, "INK_COOL")
    P.line(346, 185, 368, 185, "RIM")
    for dx0 in (347, 357):
        P.rect(dx0, 187, dx0 + 8, 191, "INK")
        P.rect(dx0 + 2, 188, dx0 + 6, 189, "SLATE_0")
        P.px(dx0 + 3, 188, "BROWN_2")
        P.px(dx0 + 5, 188, "BROWN_2")
    P.px(366, 187, "CRT_1")
    P.px(366, 189, "AMBER")
    P.line(347, 192, 365, 192, "BROWN_1")
    for x in range(348, 364, 3):
        P.px(x, 192, "BROWN_2")
    return P


def small_crt() -> Pen:
    P = Pen(343, 161, 370, 185, sort=207)
    P.poly([(345, 168), (347, 166), (347, 185), (345, 185)], "TERRA_0")
    P.poly([(347, 166), (367, 166), (365, 162), (349, 162)], "BROWN_1")
    P.dither(349, 162, 365, 165, "keep", "BROWN_2", mix=0.3, only="BROWN_1")
    P.rect(347, 167, 367, 185, "BROWN_1")
    P.line(347, 166, 367, 166, "RIM")
    P.line(347, 167, 347, 185, "BROWN_0")
    P.line(347, 185, 367, 185, "INK")
    # screen: dim slate with a small bar chart
    P.rect(349, 169, 360, 181, "INK")
    P.rect(350, 170, 359, 180, "SLATE_0")
    P.line(350, 170, 359, 170, "INK_COOL")
    P.line(350, 180, 359, 180, "INK_COOL")
    for i, hgt in enumerate((3, 5, 4, 7, 6)):
        x = 351 + i * 2
        P.line(x, 179, x, 179 - hgt + 1, "SLATE_1")
    P.px(359, 172, "SLATE_2")
    P.line(351, 171, 354, 171, "SLATE_1")
    for (x, y) in ((350, 170), (359, 170), (350, 180), (359, 180)):
        P.px(x, y, "INK")
    # control panel
    P.rect(362, 169, 366, 177, "BROWN_0")
    P.circ(364, 171, 1, "INK")
    P.px(364, 171, "SLATE_0")
    P.circ(364, 175, 1, "INK")
    P.line(362, 182, 366, 182, "INK")
    P.glow(355, 175, 12, {"BROWN_1": "SLATE_0", "BROWN_0": "INK_COOL"}, gain=0.45)
    P.line(347, 166, 367, 166, "RIM")
    return P


def crt_plant() -> Pen:
    P = Pen(346, 150, 359, 165, sort=208)
    P.poly([(349, 159), (356, 159), (355, 164), (350, 164)], "TERRA_1")
    P.line(349, 159, 356, 159, "TERRA_2")
    P.line(350, 164, 355, 164, "TERRA_0")
    P.px(355, 160, "RIM")
    for (ex, ey) in ((347, 154), (350, 152), (353, 153), (357, 154), (352, 155), (348, 157), (358, 157)):
        P.line(352, 159, ex, ey, "LEAF_1")
        P.px(ex, ey, "LEAF_2")
    P.ell(349, 153, 355, 158, "LEAF_1")
    P.edge("RIM", 0, -1, match={"LEAF_1", "LEAF_2"}, prob=0.7, seed=9)
    P.px(353, 155, "LEAF_2")
    return P


def crt_box() -> Pen:
    P = Pen(358, 158, 368, 165, sort=208)
    P.poly([(359, 161), (367, 161), (366, 159), (360, 159)], "TERRA_1")
    P.rect(359, 161, 367, 165, "TERRA_0")
    P.line(359, 161, 367, 161, "RIM")
    P.line(362, 163, 365, 163, "BROWN_2")
    return P


def lamp(tier: int) -> Pen:
    """Small lamp on the floor at the right end of the window zone."""
    P = Pen(368, 186, 379, 210)
    if tier == 1:
        P.line(373, 192, 373, 208, "INK")
        P.ell(371, 207, 376, 209, "INK")
        P.circ(373, 191, 2, "CREAM")
        P.px(374, 190, "SUN")
        P.px(373, 194, "BROWN_2")
        P.glow(373, 191, 6, {"INK": "BROWN_2", "BROWN_2": "AMBER"}, gain=0.8)
        P.circ(373, 191, 2, "CREAM")
        P.px(374, 190, "SUN")
        return P
    if tier >= 5:
        # lava lamp: gold base, plum glass, two glowing blobs
        P.poly([(371, 202), (376, 202), (377, 209), (370, 209)], "GOLD_DK")
        P.line(371, 202, 376, 202, "GOLD")
        P.poly([(372, 189), (375, 189), (376, 201), (371, 201)], "PLUM_1")
        P.rect(373, 194, 374, 196, "CRT_1")
        P.px(372, 199, "GLOW")
        P.px(373, 199, "CRT_1")
        P.px(374, 191, "PLUM_3")
        P.rect(372, 187, 375, 188, "GOLD_DK")
        P.line(370, 209, 377, 209, "INK")
        return P
    # mushroom lamp: amber dome, short stem
    P.ell(369, 192, 378, 199, "AMBER")
    P.line(370, 196, 377, 196, "GLOW")
    P.line(369, 197, 378, 197, None)
    P.line(369, 198, 378, 198, None)
    P.line(369, 199, 378, 199, None)
    P.line(370, 196, 377, 196, "SUN")
    P.px(373, 193, "GLOW")
    P.rect(372, 197, 375, 208, "BROWN_1")
    P.line(372, 197, 375, 197, "CREAM")
    P.ell(370, 207, 377, 209, "INK")
    return P


def vhs_stack() -> Pen:
    P = Pen(346, 200, 362, 212, sort=212)
    y = 211
    for i in range(5):
        off = (0, 1, -1, 0, 1)[i]
        P.rect(348 + off, y - 1, 359 + off, y, "INK" if i % 2 else "BROWN_1")
        P.line(350 + off, y - 1, 355 + off, y - 1, "CREAM" if i == 4 else "ROSE_0" if i % 2 == 0 else "BROWN_2")
        P.px(359 + off, y - 1, "TERRA_1")
        y -= 2
    return P


def console() -> Pen:
    """Game console in front of the TV stand (red display like the reference), a pad with its cable."""
    P = Pen(306, 203, 340, 214, sort=214)
    P.poly([(309, 208), (329, 208), (327, 205), (311, 205)], "SLATE_0")
    P.line(311, 205, 327, 205, "SLATE_1")
    P.ell(315, 205, 322, 208, "INK_COOL")
    P.px(318, 206, "CRT_0")
    P.rect(309, 208, 329, 212, "BROWN_1")
    P.line(309, 208, 329, 208, "RIM")
    for x in (318, 319, 320, 322):
        P.px(x, 210, "CRT_1")
    P.line(311, 210, 314, 210, "INK")
    P.line(309, 212, 329, 212, "INK")
    P.glow(320, 207, 8, REDL, gain=0.5)
    # controller
    P.rect(332, 209, 338, 211, "INK_COOL")
    P.px(331, 210, "INK_COOL")
    P.px(339, 210, "INK_COOL")
    P.px(333, 209, "SLATE_0")
    P.px(337, 209, "CRT_0")
    P.line(330, 212, 331, 211, "INK")
    P.line(329, 213, 330, 212, "INK")
    return P


def remote() -> Pen:
    P = Pen(338, 212, 346, 217)
    P.line(339, 215, 344, 213, "INK")
    P.line(339, 216, 344, 214, "INK")
    P.px(340, 215, "CRT_0")
    P.px(343, 213, "SLATE_0")
    return P


def camera() -> Pen:
    """Vintage camera on the floor, lens toward the room's centre."""
    P = Pen(360, 208, 377, 220)
    P.rect(364, 211, 375, 218, "INK_COOL")
    P.rect(366, 209, 370, 210, "INK_COOL")
    P.line(364, 211, 375, 211, "SLATE_0")
    P.line(366, 209, 370, 209, "SLATE_1")
    P.circ(366, 215, 3, "INK")
    P.circ(366, 215, 2, "BROWN_1")
    P.px(365, 214, "SLATE_1")
    P.px(366, 215, "VOID")
    P.px(373, 213, "CRT_0")
    P.line(364, 219, 375, 219, "VOID")
    P.px(362, 217, "SLATE_0")  # strap
    P.line(361, 218, 362, 219, "INK")
    return P


def power_strip() -> Pen:
    P = Pen(284, 199, 300, 208, sort=208)
    P.rect(285, 203, 298, 206, "BROWN_1")
    P.line(285, 203, 298, 203, "BROWN_2")
    for x in (288, 292, 296):
        P.px(x, 204, "INK")
        P.px(x + 1, 204, "INK")
    P.px(286, 204, "CRT_1")
    P.line(285, 207, 298, 207, "INK")
    # cord up to the wall outlet at (300, 184), plugs
    P.line(299, 203, 299, 200, "INK")
    P.px(298, 199, "INK")
    return P


def cables_back() -> Pen:
    """Cables between the stack, the stand and the power strip, along the wall line (L2)."""
    P = Pen(284, 196, 372, 209)
    pts = [(298, 205), (300, 207), (304, 208), (312, 207), (322, 208), (334, 207), (342, 206), (346, 206)]
    for a, b in zip(pts, pts[1:]):
        P.line(a[0], a[1], b[0], b[1], "INK")
    pts = [(296, 206), (295, 208), (300, 209), (310, 209)]
    for a, b in zip(pts, pts[1:]):
        P.line(a[0], a[1], b[0], b[1], "VOID")
    P.line(370, 204, 371, 207, "INK")
    return P


def cables_front() -> Pen:
    """Loose loops on the floor in front of the TV (L3): console to the stand, a long loop to the lamp."""
    P = Pen(286, 208, 378, 221)
    loops = [
        [(307, 211), (303, 212), (298, 214), (294, 217), (297, 219), (305, 219), (316, 218), (326, 216),
         (334, 218), (346, 219), (356, 216), (362, 214)],
        [(306, 209), (300, 210), (292, 211), (289, 214), (292, 216), (299, 215)],
    ]
    for k, pts in enumerate(loops):
        for a, b in zip(pts, pts[1:]):
            P.line(a[0], a[1], b[0], b[1], "INK" if k != 1 else "VOID")
    # a few hot highlights where the sunbeam catches the cable
    for (x, y) in ((305, 219), (316, 218), (297, 219)):
        P.px(x, y - 1, "TERRA_1")
    return P


# =================================================================== declarations
def stages(fn, name):
    return {s: fn(s).save(f"{name}-{s}") for s in ("s0", "s1", "s2")}


def tiers(fn, name, ts=(1, 3, 5), base=3):
    v = {f"t{t}": fn(t).save(f"{name}-t{t}") for t in ts}
    v["base"] = v[f"t{base}"]
    return v


def build():
    # ---------------- library hotspots
    v = stages(bookshelf, "bookshelf")
    item("library.bookshelf", zone="library", kind="hotspot", layer=2, x=178, y=99, variants=v,
         target={"skill": "reading"}, label="READING", led=(201, 100),
         note="tall bookshelf: s0 a few books and boxes, s1 half full, s2 packed with a banker's lamp")
    item("library.potions", zone="library", kind="hotspot", layer=2, x=230, y=108,
         variants={"base": potion_shelf().save("potion-shelf")}, target={"feature": "archive"}, label="ARCHIVE",
         led=(243, 136), note="wall potion shelf: 15 bottles, one per skill, in category colours at a middling fill")
    v = stages(chess, "chess")
    item("library.chess", zone="library", kind="hotspot", layer=3, x=200, y=176, variants=v,
         target={"skill": "chess"}, label="CHESS", led=(229, 191),
         note="low chess table with two stools: s0 board in its box, s1 set up, s2 mid-game with a trophy")
    v = stages(meditation, "cushion")
    item("library.cushion", zone="library", kind="hotspot", layer=3, x=176, y=186, variants=v,
         target={"skill": "meditation"}, label="MEDITATION", led=(186, 217),
         note="floor cushion: s0 flat cushion, s1 plus a candle, s2 zafu, candle, incense and a plant")
    # ---------------- library decor
    item("library.shelf-plant", zone="library", kind="decor", layer=2, x=178, y=76,
         variants=tiers(shelf_plant, "shelf-plant"),
         note="plant on top of the bookshelf: t1 sad cactus, t3 pothos trailing down the frame, t5 lush fern")
    item("library.globe", zone="library", kind="decor", layer=2, x=204, y=85, variants={"base": globe().save("globe")},
         note="desk globe on top of the bookshelf")
    item("library.ladder", zone="library", kind="decor", layer=2, x=212, y=101,
         variants={"base": ladder().save("ladder")}, note="wooden ladder leaning on the bookshelf")
    item("library.throw", zone="library", kind="decor", layer=2, x=210, y=146,
         variants={"base": throw().save("throw")}, note="knitted throw folded over a ladder rung")
    item("library.ledge", zone="library", kind="decor", layer=2, x=231, y=69,
         variants={"base": bookend_ledge().save("ledge")}, note="wall ledge with brass bookends, small books, hourglass")
    item("library.print", zone="library", kind="decor", layer=2, x=232, y=85,
         variants={"base": framed_print().save("print")}, note="framed jazz-night print above the potion shelf")
    item("library.lamp", zone="library", kind="decor", layer=2, x=254, y=106,
         variants=tiers(floor_lamp, "floor-lamp"),
         note="reading lamp: t1 clamp lamp on the shelf bracket, t3 drum-shade floor lamp, t5 brass pleated lamp")
    item("library.string-lights", zone="library", kind="decor", layer=2, x=176, y=63,
         variants={"base": string_lights().save("string-lights")},
         note="warm string lights sagging along the top of the library wall")
    item("library.clock", zone="library", kind="decor", layer=2, x=243, y=144,
         variants={"base": wall_clock().save("wall-clock")}, note="round wall clock under the potion shelf")
    v = {f"t{t}": record_crate(t).save(f"records-t{t}") for t in (1, 3, 4, 5)}
    v["base"] = v["t3"]
    item("library.records", zone="library", kind="decor", layer=2, x=230, y=180, variants=v,
         note="records: t1 cardboard box, t3 wood crate, t4 crate with a record player, t5 walnut console")
    item("library.magazines", zone="library", kind="decor", layer=2, x=230, y=140,
         variants={"base": magazine_rack().save("magazine-rack")}, note="wall magazine pocket under the potion shelf")
    item("library.fan", zone="library", kind="decor", layer=2, x=214, y=85,
         variants={"base": desk_fan().save("desk-fan")}, note="small desk fan on top of the bookshelf")
    p = book_stack(51, 227, 205, 8, 206)
    item("library.books-floor", zone="library", kind="decor", layer=2, x=p.ox, y=p.oy,
         variants={"base": p.save("books-floor")}, note="tall stack of books on the floor beside the shelf")
    p = book_stack(52, 228, 210, 4, 211)
    item("library.books-under", zone="library", kind="decor", layer=3, x=p.ox, y=p.oy,
         variants={"base": p.save("books-under")}, note="short stack of books under the chess table")
    # ---------------- window hotspots
    v = stages(sill_plants, "sill-plants")
    item("window.sill-plants", zone="window", kind="hotspot", layer=2, x=280, y=118, variants=v,
         target={"skill": "gut-health"}, label="GUT HEALTH", led=(298, 149),
         note="planter on the sill: s0 one sprout, s1 herbs and a fermenting jar, s2 lush row with kombucha")
    v = stages(vision_board, "vision-board")
    item("window.vision-board", zone="window", kind="hotspot", layer=2, x=263, y=84, variants=v,
         target={"skill": "visualization"}, label="VISUALIZATION", led=(269, 107),
         note="cork vision board beside the window: s0 bare, s1 a few cut-outs, s2 covered")
    item("window.tv", zone="window", kind="hotspot", layer=2, x=300, y=154,
         variants={"base": big_crt().save("big-crt")}, target={"feature": "today"}, label="TODAY",
         led=(333, 183), note="big CRT on the low stand, screen glowing red with a small sun")
    item("window.small-crt", zone="window", kind="hotspot", layer=2, x=343, y=161,
         variants={"base": small_crt().save("small-crt")}, target={"feature": "stats"}, label="STATS",
         led=(362, 179), note="small CRT on the tape deck, dim slate screen with a bar chart")
    # ---------------- window decor
    item("window.stand", zone="window", kind="decor", layer=2, x=296, y=182, variants=tiers(tv_stand, "tv-stand"),
         note="TV stand plus the red screen glow on the floor: t1 milk crates, t3 low stand with VCR, t5 walnut")
    item("window.amp", zone="window", kind="decor", layer=2, x=341, y=186, variants={"base": amp().save("amp")},
         note="amplifier with knobs and red LEDs")
    item("window.tape-deck", zone="window", kind="decor", layer=2, x=342, y=180,
         variants={"base": tape_deck().save("tape-deck")}, note="double tape deck with red and amber LEDs")
    item("window.crt-plant", zone="window", kind="decor", layer=2, x=346, y=150,
         variants={"base": crt_plant().save("crt-plant")}, note="potted plant on top of the small CRT")
    item("window.crt-box", zone="window", kind="decor", layer=2, x=358, y=158,
         variants={"base": crt_box().save("crt-box")}, note="small box on top of the small CRT")
    item("window.speaker", zone="window", kind="decor", layer=2, x=350, y=128,
         variants=tiers(sill_speaker, "sill-speaker"),
         note="speaker on the sill: t1 cheap plastic, t3 bookshelf speaker, t5 walnut")
    item("window.lamp", zone="window", kind="decor", layer=3, x=368, y=186, variants=tiers(lamp, "lamp"),
         note="small floor lamp: t1 bare bulb, t3 mushroom lamp, t5 lava lamp")
    item("window.vhs", zone="window", kind="decor", layer=3, x=346, y=200,
         variants={"base": vhs_stack().save("vhs")}, note="stack of VHS tapes on the floor")
    item("window.console", zone="window", kind="decor", layer=3, x=306, y=203,
         variants={"base": console().save("console")}, note="game console with a red display and a pad")
    item("window.remote", zone="window", kind="decor", layer=3, x=338, y=212,
         variants={"base": remote().save("remote")}, note="TV remote on the floor")
    item("window.camera", zone="window", kind="decor", layer=3, x=360, y=208,
         variants={"base": camera().save("camera")}, note="vintage camera on the floor")
    item("window.power-strip", zone="window", kind="decor", layer=2, x=284, y=199,
         variants={"base": power_strip().save("power-strip")}, note="power strip with a red switch, cord to the outlet")
    item("window.cables-back", zone="window", kind="decor", layer=2, x=284, y=196,
         variants={"base": cables_back().save("cables-back")}, note="cables along the wall line")
    item("window.cables-front", zone="window", kind="decor", layer=3, x=286, y=208,
         variants={"base": cables_front().save("cables-front")}, note="cables snaking on the floor in front of the TV")
    finish(PART)


if __name__ == "__main__":
    build()
