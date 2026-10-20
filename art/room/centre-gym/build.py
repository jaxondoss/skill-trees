#!/usr/bin/env python3
"""FORGE v3 room, part "centre-gym": zone gym (key 7, front of the right wall) and the room centre.

Gym (right wall x 540..720 plus the floor in front of it):
  hotspots  STRENGTH  wall dumbbell rack over a flat bench (s0 a few light dumbbells, s1 fuller rack,
                      s2 heavy hex dumbbells, plates against the wall, chalk bucket)
            RUNNING   floating shoe shelf with race bibs pinned above it (s0 one old pair, s1 a pair and a
                      bib, s2 two pairs, three bibs and a medal)
            TRIATHLON road bike on an indoor trainer in front of the gym corner (base and s0..s2 under a
                      grey dust sheet; "awake": sheet off, clean red bike, helmet on the bars)
  decor     protein shelf (tubs, shaker, LED strip), bluetooth speaker, runner poster (t1/t3/t5), rubber
            flooring (t1/t3/t5), interval timer, wall mirror, towel, jump rope and bands, trophies (t1/t3/t5),
            wall fan, kettlebell, foam roller, yoga mat, water bottle, box under the bench, cables.
Centre (zone "room"): the obsidian statue (FORGE, t1..t5 kintsugi), its rug (t1/t3/t5), the sleeping dog
  (breathing anim, "wag" variant), a dog bowl and a chew toy, and the large statue close-up for the panel.

Geometry: things on or against the right wall use P(z, d, h): z = feet along the wall from the back corner
(x 464) toward the viewer, d = feet out from the wall into the room, h = feet above the floor. This mirrors
the left part's projection about x = 320, so it matches room.py's wall_point / wall_scale / depth_scale.

Run: python3 art/room/centre-gym/build.py     (deterministic: no global RNG, only fixed hashes and Bayer)
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

from PIL import Image, ImageDraw  # noqa: E402

PART = "centre-gym"
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h in HEX.items()}
B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bay(x: int, y: int) -> float:
    """4x4 Bayer threshold anchored to WORLD coordinates."""
    return (B4[y % 4][x % 4] + 0.5) / 16


def hsh(*v: int) -> float:
    h = 2166136261
    for a in v:
        h = ((h ^ (int(a) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535


# =============================================================== projection (right wall)
D = 50.0  # feet from the eye to the back wall
K = 0.55  # out-of-wall foreshortening (same as the left part)
PXF = 136 / 9  # px per foot at the back wall
WX = 397.42  # wall-bottom run in x per unit of scale (0.19375 rake)
EYE = 77 / PXF  # eye height in feet


def S(z: float) -> float:
    return D / (D - z)


def XR(s: float) -> float:
    return 464 + WX * (s - 1)


def P(z: float, d: float = 0.0, h: float = 0.0) -> tuple[float, float]:
    s = S(z)
    return XR(s) - 15 * K * d * s, 121 + 77 * s - PXF * h * s


def Pi(z, d=0.0, h=0.0) -> tuple[int, int]:
    x, y = P(z, d, h)
    return round(x), round(y)


def inv_side(x, y, d):
    s = (x - 464 + WX) / (WX - 15 * K * d)
    if s <= 0.2:
        return None
    return D * (1 - 1 / s), (121 + 77 * s - y) / (PXF * s)


def z_at(x: float) -> float:
    s = 1 + (x - 464) / WX
    return D * (1 - 1 / s)


# =============================================================== shell sampling
SHELL = {}  # layer -> composite of shell bands up to that layer (world-indexed via +80/+96)
TOPBAND = None


def _load_shell():
    global TOPBAND
    mf = ROOT / "art" / "room" / "shell" / "manifest.json"
    bands = []
    if mf.exists():
        for it in json.loads(mf.read_text())["items"]:
            if it["kind"] == "shell" and it["layer"] >= 2:
                p = OUT.parent / it["variants"]["base"]
                if p.exists():
                    bands.append((it["layer"], it["x"], it["y"], Image.open(p).convert("RGBA")))
    bands.sort(key=lambda b: b[0])
    top = [[-1] * 480 for _ in range(800)]
    for L in range(2, 6):
        im = Image.new("RGBA", (800, 480), (0, 0, 0, 0))
        for lay, x, y, b in bands:
            if lay <= L:
                im.alpha_composite(b, (x + 80, y + 96))
        SHELL[L] = im.load()
    for lay, x, y, b in bands:
        a = b.getchannel("A").load()
        for j in range(b.height):
            for i in range(b.width):
                if a[i, j]:
                    wx, wy = x + i + 80, y + j + 96
                    if 0 <= wx < 800 and 0 <= wy < 480:
                        top[wx][wy] = max(top[wx][wy], lay)
    TOPBAND = top


_load_shell()


def shell_at(x, y, layer=5):
    if not (0 <= x + 80 < 800 and 0 <= y + 96 < 480) or layer not in SHELL:
        return None
    r, g, b, a = SHELL[layer][x + 80, y + 96]
    return RGB2N.get((r, g, b)) if a else None


def topband(x, y):
    if not (0 <= x + 80 < 800 and 0 <= y + 96 < 480) or TOPBAND is None:
        return -1
    return TOPBAND[x + 80][y + 96]


# =============================================================== pen
class Pen:
    """World-space pen on a palette-locked sprite (spr). Colours are palette NAMES."""

    def __init__(self, x0: int, y0: int, x1: int, y1: int, layer: int = 4):
        self.ox, self.oy = x0, y0
        self.w, self.h = x1 - x0 + 1, y1 - y0 + 1
        self.layer = layer
        self.s = spr(self.w, self.h)

    def o(self, only):
        return only if only in (None, "opaque", "empty") else HEX[only]

    def inside(self, x, y):
        return 0 <= x - self.ox < self.w and 0 <= y - self.oy < self.h

    def px(self, x, y, n, only=None):
        x, y = round(x), round(y)
        if self.inside(x, y):
            self.s.px(x - self.ox, y - self.oy, None if n is None else HEX[n], only=self.o(only))

    def get(self, x, y):
        x, y = round(x), round(y)
        if not self.inside(x, y):
            return None
        v = self.s.get(x - self.ox, y - self.oy)
        return None if v is None else RGB2N[tuple(v[:3])]

    def line(self, a, b, n, only=None):
        self.s.line(round(a[0]) - self.ox, round(a[1]) - self.oy, round(b[0]) - self.ox, round(b[1]) - self.oy,
                    HEX[n], only=self.o(only))

    def rect(self, x0, y0, x1, y1, n, fill=True, only=None):
        self.s.rect(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, HEX[n], fill=fill, only=self.o(only))

    def poly(self, pts, n, only=None):
        self.s.polygon([(round(x) - self.ox, round(y) - self.oy) for x, y in pts], HEX[n], only=self.o(only))

    def ell(self, x0, y0, x1, y1, n, only=None):
        self.s.ellipse(round(x0) - self.ox, round(y0) - self.oy, round(x1) - self.ox, round(y1) - self.oy, HEX[n],
                       only=self.o(only))

    def circ(self, cx, cy, r, n, fill=True, only=None):
        self.s.circle(round(cx) - self.ox, round(cy) - self.oy, r, HEX[n], fill=fill, only=self.o(only))

    def dither(self, x0, y0, x1, y1, c1, c2, mix=0.5, only=None):
        a = c1 if c1 == "keep" else (None if c1 is None else HEX[c1])
        b = c2 if c2 == "keep" else (None if c2 is None else HEX[c2])
        self.s.dither(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, a, b, mix=mix, only=self.o(only))

    def sag(self, a, b, sag, n, only=None):
        x0, y0 = a
        x1, y1 = b
        steps = max(2, int(abs(x1 - x0)), int(abs(y1 - y0)))
        pts = [(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t + 4 * sag * t * (1 - t)))
               for t in (i / steps for i in range(steps + 1))]
        for p, q in zip(pts, pts[1:]):
            self.line(p, q, n, only=only)
        return pts

    def path(self, pts, n, only=None):
        for p, q in zip(pts, pts[1:]):
            self.line(p, q, n, only=only)

    def each(self, box=None):
        x0, y0, x1, y1 = box or (self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1)
        for y in range(max(y0, self.oy), min(y1, self.oy + self.h - 1) + 1):
            for x in range(max(x0, self.ox), min(x1, self.ox + self.w - 1) + 1):
                yield x, y

    def recolor(self, mapping, box=None, prob=1.0, seed=0):
        for x, y in list(self.each(box)):
            c = self.get(x, y)
            if c in mapping and (prob >= 1 or hsh(seed, x, y) < prob):
                self.px(x, y, mapping[c])

    def rim(self, match, n, dx, dy, prob=1.0, seed=0, box=None):
        """Light the edge of a form: pixels of a colour in `match` whose (dx, dy) neighbour is empty take n."""
        hits = []
        for x, y in self.each(box):
            c = self.get(x, y)
            if c is not None and (match is None or c in match):
                if self.get(x + dx, y + dy) is None and (prob >= 1 or hsh(seed, x // 2, y) < prob):
                    hits.append((x, y))
        for x, y in hits:
            self.px(x, y, n)

    def bounds(self):
        xs, ys = [], []
        for x, y in self.each():
            if self.get(x, y) is not None:
                xs.append(x)
                ys.append(y)
        return (min(xs), min(ys), max(xs), max(ys)) if xs else None

    def copy(self):
        p = Pen(self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1, self.layer)
        for x, y in self.each():
            c = self.get(x, y)
            if c:
                p.px(x, y, c)
        return p

    def paste(self, other: "Pen"):
        for x, y in other.each():
            c = other.get(x, y)
            if c:
                self.px(x, y, c)

    def save(self, name: str) -> str:
        return save(self.s, f"{PART}/{name}")


# =============================================================== faces and boxes
def side_q(z0, z1, h0, h1, d):
    return [P(z0, d, h0), P(z1, d, h0), P(z1, d, h1), P(z0, d, h1)]


def front_q(z, d0, d1, h0, h1):
    return [P(z, d0, h0), P(z, d1, h0), P(z, d1, h1), P(z, d0, h1)]


def top_q(z0, z1, d0, d1, h):
    return [P(z0, d0, h), P(z1, d0, h), P(z1, d1, h), P(z0, d1, h)]


def box(pen, z0, z1, d0, d1, h0, h1, side, front, top, rim="RIM", edge=None, rimback=True):
    """Box against or near the right wall. side = room-facing face (d1, window side), front = viewer face (z1)."""
    pen.poly(side_q(z0, z1, h0, h1, d1), side)
    if h1 < EYE and top:
        pen.poly(top_q(z0, z1, d0, d1, h1), top)
    pen.poly(front_q(z1, d0, d1, h0, h1), front)
    if edge:
        pen.line(Pi(z1, d1, h0), Pi(z1, d1, h1), edge)
    if rim:
        pen.line(Pi(z0, d1, h1), Pi(z1, d1, h1), rim)
        if rimback:
            pen.line(Pi(z0, d1, h0), Pi(z0, d1, h1), rim)


def disc(pen, zc, hc, r, d, col, n=20):
    """A disc in the wall-parallel plane at offset d (a dumbbell head or plate face)."""
    pts = [P(zc + r * math.cos(2 * math.pi * i / n), d, hc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pen.poly(pts, col)


def hexd(pen, zc, hc, r, d, col):
    pts = [P(zc + r * math.cos(math.pi / 6 + math.pi * i / 3), d, hc + r * math.sin(math.pi / 6 + math.pi * i / 3))
           for i in range(6)]
    pen.poly(pts, col)


FONT = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "110"],
    ":": ["0", "1", "0", "1", "0"],
}
SMALL = {  # 3x3 digits for tiny labels
    "0": ["111", "101", "111"], "1": ["110", "010", "111"], "2": ["110", "010", "011"],
    "3": ["111", "011", "111"], "4": ["101", "111", "001"], "5": ["011", "010", "110"],
    "7": ["111", "001", "001"], "8": ["111", "111", "111"], "9": ["111", "111", "001"],
}


def wall_text(pen, x_left, h_top, text, n, d=0.0, font=FONT):
    """Text on a raked plane: glyph columns on consecutive screen columns, each dropped to the plane's line."""
    x = x_left
    for ch in text:
        g = font.get(ch)
        if g:
            for i in range(len(g[0])):
                cx = x + i
                r = inv_side(cx + 0.5, 0, d)
                if r is None:
                    continue
                _, yy = P(r[0], d, h_top)
                for j in range(len(g)):
                    if g[j][i] == "1":
                        pen.px(cx, round(yy) + j, n)
            x += len(g[0]) + 1
        else:
            x += 3


def wall_rect(pen, z0, z1, h0, h1, col, d=0.0):
    pen.poly(side_q(z0, z1, h0, h1, d), col)


def wall_fn(pen, z0, z1, h0, h1, fn, d=0.0):
    """Per-pixel fill of a wall-parallel rectangle: fn(u, v, x, y) -> name|None, u 0..1 back->front, v 0..1
    top->bottom."""
    pts = side_q(z0, z1, h0, h1, d)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
        for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
            r = inv_side(x + 0.5, y + 0.5, d)
            if r is None:
                continue
            z, h = r
            if z0 <= z <= z1 and h0 <= h <= h1:
                n = fn((z - z0) / (z1 - z0), (h1 - h) / (h1 - h0), x, y)
                if n:
                    pen.px(x, y, n)


# =============================================================== light
WARM = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2",
        "BROWN_2": "TERRA_1", "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "ROSE_0": "ROSE_1", "PLUM_0": "PLUM_1",
        "LEAF_0": "LEAF_1", "LEAF_1": "LEAF_2", "GOLD_DK": "GOLD"}
WARM_SOFT = {"VOID": "INK", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2",
             "TERRA_0": "TERRA_1"}
RED = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "TERRA_0", "BROWN_1": "TERRA_0",
       "BROWN_2": "TERRA_0", "TERRA_0": "CRT_0", "ROSE_0": "ROSE_1"}


def glow(carrier: Pen | None, pens: list, cx, cy, rx, ry, mapping, strength=1.0, wall=True, box=None):
    """A small local light. Tints opaque pixels of every pen in `pens` inside the ellipse (Bayer falloff,
    world-anchored); if `carrier` is given and wall=True, also paints tinted shell pixels into the carrier where
    it is transparent (only where no higher shell band would cover them)."""
    x0, y0 = int(cx - rx), int(cy - ry)
    x1, y1 = int(cx + rx) + 1, int(cy + ry) + 1
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if box and not (box[0] <= x <= box[2] and box[1] <= y <= box[3]):
                continue
            r = math.hypot((x - cx) / rx, (y - cy) / ry)
            if r >= 1:
                continue
            if bay(x, y) >= (1 - r) * strength * 1.15:
                continue
            for p in pens:
                c = p.get(x, y)
                if c in mapping:
                    p.px(x, y, mapping[c])
            if carrier is not None and wall and carrier.inside(x, y) and carrier.get(x, y) is None:
                if any(p.get(x, y) is not None for p in pens if p is not carrier):
                    continue
                if topband(x, y) > carrier.layer:
                    continue
                c = shell_at(x, y, carrier.layer)
                if c in mapping:
                    carrier.px(x, y, mapping[c])


# =============================================================== registry
ITEMS: list[dict] = []


def reg(id_, variants: dict, **kw):
    ITEMS.append(dict(id=id_, variants=variants, **kw))


def band_overlap(pen: Pen) -> int:
    n = 0
    for x, y in pen.each():
        if pen.get(x, y) is not None and topband(x, y) > pen.layer:
            n += 1
    return n


# ============================================================================================ GYM
FLOOR_C = 226  # contact row of the flooring; everything standing on it is padded below this


# ---------------------------------------------------------------- strength: wall rack + bench
RACK_Z = (9.6, 12.0)
RACK_TIERS = (1.85, 2.75, 3.65)
BENCH = (9.3, 12.4, 0.35, 1.35, 1.22, 1.5)  # z0 z1 d0 d1 h0 h1 (pad)


def dumbbell(p, zc, h, r, near=1.05, far=0.2, colors=("INK", "BROWN_1", "BROWN_0"), handle="ROSE_0", hexa=True,
             lit=True):
    dark, face, mid = colors
    fn = hexd if hexa else disc
    # far head (room-facing face visible), handle, near head (thickness then face)
    fn(p, zc, h + r, r, far + 0.18, dark)
    fn(p, zc, h + r, r, far + 0.2, mid)
    p.line(Pi(zc, far + 0.2, h + r), Pi(zc, near - 0.2, h + r), handle)
    fn(p, zc, h + r, r, near - 0.2, dark)
    fn(p, zc, h + r, r, near, face)
    if lit:
        # 1 px rim on the window side (upper-left arc of the near face)
        pts = [Pi(zc + r * math.cos(a), near, h + r + r * math.sin(a)) for a in
               (math.pi * 0.55, math.pi * 0.75, math.pi * 0.95)]
        for q in pts:
            p.px(q[0], q[1], "RIM" if hsh(int(zc * 10), q[1]) < 0.7 else "ORANGE")


def strength(stage: int) -> Pen:
    p = Pen(530, 120, 600, FLOOR_C + 2, layer=4)
    z0, z1 = RACK_Z
    # wall plates (two vertical steel rails screwed to the wall)
    for zz in (z0 + 0.15, z1 - 0.15):
        wall_rect(p, zz - 0.09, zz + 0.09, 1.55, 4.2, "INK", d=0.02)
        p.px(*Pi(zz - 0.09, 0.02, 4.15), "BROWN_2")
    # s2: plates leaning on the wall behind the bench's back end
    if stage == 2:
        for i, (zc, r, col) in enumerate(((8.55, 0.72, "INK"), (8.75, 0.62, "BROWN_0"), (8.95, 0.5, "INK"))):
            disc(p, zc, r, r, 0.12 + i * 0.12, "VOID", n=24)
            disc(p, zc, r, r, 0.2 + i * 0.12, col, n=24)
            disc(p, zc, r, r * 0.25, 0.2 + i * 0.12, "BROWN_1", n=10)
            pts = [Pi(zc + r * math.cos(a), 0.2 + i * 0.12, r + r * math.sin(a)) for a in
                   [math.pi * (0.5 + k * 0.08) for k in range(7)]]
            for q in pts:
                p.px(q[0], q[1], "RIM" if i == 2 else "TERRA_1")
    # tiers: back rail at d 0.25, front lip at d 1.1
    for h in RACK_TIERS:
        p.line(Pi(z0, 0.25, h), Pi(z1, 0.25, h), "INK")
    # dumbbells per stage
    if stage == 0:
        sets = {RACK_TIERS[1]: [(10.3, 0.14, ("PLUM_0", "PLUM_1", "PLUM_0"), False),
                                (10.8, 0.14, ("PLUM_0", "PLUM_1", "PLUM_0"), False)],
                RACK_TIERS[0]: [(10.4, 0.17, ("TERRA_0", "TERRA_1", "TERRA_0"), False)]}
    elif stage == 1:
        sets = {RACK_TIERS[2]: [(10.1, 0.14, ("PLUM_0", "PLUM_1", "PLUM_0"), False),
                                (10.55, 0.14, ("PLUM_0", "PLUM_1", "PLUM_0"), False)],
                RACK_TIERS[1]: [(z, 0.19, ("INK", "BROWN_1", "BROWN_0"), True) for z in (10.0, 10.6, 11.2)],
                RACK_TIERS[0]: [(z, 0.23, ("INK", "BROWN_1", "BROWN_0"), True) for z in (10.1, 10.8, 11.5)]}
    else:
        sets = {RACK_TIERS[2]: [(z, 0.19, ("INK", "BROWN_1", "BROWN_0"), True) for z in (9.95, 10.45, 10.95, 11.45)],
                RACK_TIERS[1]: [(z, 0.23, ("INK", "BROWN_1", "BROWN_0"), True) for z in (10.0, 10.6, 11.2)],
                RACK_TIERS[0]: [(z, 0.28, ("INK", "BROWN_1", "BROWN_0"), True) for z in (10.1, 10.85, 11.55)]}
    for h in RACK_TIERS:
        for zc, r, cols, hexa in sets.get(h, []):
            dumbbell(p, zc, h + 0.06, r, colors=cols, hexa=hexa,
                     handle="ROSE_0" if hexa else "BROWN_2")
        # front lip of the tier (in front of the dumbbells' near handles)
        p.line(Pi(z0, 1.12, h), Pi(z1, 1.12, h), "BROWN_1")
        a, b = Pi(z0, 1.12, h - 0.05), Pi(z1, 1.12, h - 0.05)
        p.line(a, b, "INK")
        for t in range(0, 12, 3):
            q = Pi(z0 + (z1 - z0) * t / 12, 1.12, h)
            p.px(q[0], q[1], "RIM")
    # side brackets (front faces of the steel arms at both ends)
    for zz in (z0, z1):
        for h in RACK_TIERS:
            p.poly(front_q(zz, 0.0, 1.15, h - 0.12, h + 0.02), "INK")
        p.line(Pi(zz, 1.15, RACK_TIERS[0] - 0.12), Pi(zz, 1.15, RACK_TIERS[-1] + 0.02), "BROWN_1")
        for h in RACK_TIERS:
            q = Pi(zz, 1.2, h + 0.02)
            p.px(q[0], q[1], "RIM")
            p.px(q[0], q[1] + 1, "TERRA_1")
    # ---- bench (pad + two T legs)
    bz0, bz1, bd0, bd1, bh0, bh1 = BENCH
    for lz in (bz0 + 0.45, bz1 - 0.45):
        box(p, lz - 0.1, lz + 0.1, 0.2, 1.55, 0.0, 0.12, "INK", "VOID", "BROWN_1", rim="RIM", rimback=False)
        box(p, lz - 0.08, lz + 0.08, 0.75, 0.95, 0.12, bh0, "BROWN_0", "INK", None, rim=None)
        p.line(Pi(lz - 0.08, 0.95, 0.12), Pi(lz - 0.08, 0.95, bh0), "TERRA_1")
    box(p, bz0, bz1, bd0, bd1, bh0, bh1, "BROWN_0", "INK", "BROWN_1", rim="RIM", rimback=False)
    # stitching seam on the side, a scuff on the top
    p.line(Pi(bz0 + 0.2, bd1, bh0 + 0.1), Pi(bz1 - 0.2, bd1, bh0 + 0.1), "INK")
    q = Pi(bz0 + 0.6, (bd0 + bd1) / 2, bh1)
    p.px(q[0], q[1], "ROSE_0")
    p.px(q[0] + 1, q[1], "ROSE_0")
    # s2: chalk bucket on the floor in front of the bench
    if stage == 2:
        cz, cd = 10.95, 1.75
        box(p, cz - 0.3, cz + 0.3, cd - 0.3, cd + 0.3, 0.0, 0.75, "BROWN_2", "BROWN_1", "ROSE_1", rim="RIM")
        tq = top_q(cz - 0.22, cz + 0.22, cd - 0.22, cd + 0.22, 0.75)
        p.poly(tq, "CREAM")
        q = Pi(cz + 0.1, cd, 0.75)
        p.px(q[0], q[1], "ROSE_1")
        p.line(Pi(cz + 0.3, cd - 0.3, 0.45), Pi(cz + 0.3, cd + 0.3, 0.45), "TERRA_1")
    return p


# ---------------------------------------------------------------- running: shoe shelf + bibs
RUN_Z = (12.55, 14.45)
RUN_H = 2.95


def shoe(p, z0, length, h, upper, sole, accent=None, d=0.45, toe_back=True):
    """A running shoe in profile along the wall (toe toward the back corner when toe_back)."""
    z1 = z0 + length
    L = length
    # sole
    p.poly(side_q(z0, z1, h, h + 0.07, d), sole)
    # upper: a low heel collar at the front end, sloping to the toe
    pts = []
    for i in range(9):
        t = i / 8
        zz = z0 + L * t if toe_back else z1 - L * t
        prof = 0.11 + 0.25 * (t ** 0.9) if t < 0.85 else 0.36 - (t - 0.85) * 0.6
        pts.append(P(zz, d, h + 0.07 + prof))
    pts += [P(z1 if toe_back else z0, d, h + 0.07), P(z0 if toe_back else z1, d, h + 0.07)]
    p.poly(pts, upper)
    if accent:
        za, zb = (z0 + L * 0.35, z0 + L * 0.7) if toe_back else (z1 - L * 0.7, z1 - L * 0.35)
        p.line(Pi(za, d, h + 0.12), Pi(zb, d, h + 0.24), accent)
    # window-side highlight on the toe box (upper left)
    tz = z0 + L * 0.15 if toe_back else z1 - L * 0.15
    q = Pi(tz, d, h + 0.17)
    p.px(q[0], q[1] - 1, "RIM")
    # collar opening
    cz = z0 + L * 0.82 if toe_back else z1 - L * 0.82
    q = Pi(cz, d, h + 0.38)
    p.px(q[0], q[1], "VOID")
    p.px(q[0] + 1, q[1], "VOID")


def bib(p, z0, z1, h0, h1, num, tilt=0, stripe="CRT_0"):
    def fn(u, v, x, y):
        if v < 0.2:
            return stripe
        return "ROSE_0"
    wall_fn(p, z0, z1, h0, h1, fn, d=0.01)
    # the window-facing (left) edge catches light, the bottom edge sags slightly
    for h in (h0 + (h1 - h0) * k / 6 for k in range(7)):
        q = Pi(z0, 0.01, h)
        p.px(q[0], q[1], "ROSE_1")
    x_left = round(P(z0 + (z1 - z0) * 0.12, 0, 0)[0])
    wall_text(p, x_left, h0 + (h1 - h0) * 0.72, num, "BROWN_0", d=0.01)
    # safety pins at the four corners
    for zz, hh in ((z0 + 0.04, h1 - 0.04), (z1 - 0.04, h1 - 0.04)):
        q = Pi(zz, 0.02, hh)
        p.px(q[0], q[1], "AMBER")


def running(stage: int) -> Pen:
    p = Pen(588, 112, 632, 172, layer=4)
    z0, z1 = RUN_Z
    # floating shelf: board 0.12 ft thick, 0.85 ft deep
    box(p, z0, z1, 0.0, 0.85, RUN_H - 0.12, RUN_H, "BROWN_1", "BROWN_0", "BROWN_2", rim="RIM", rimback=True)
    p.line(Pi(z0, 0.0, RUN_H - 0.14), Pi(z1, 0.0, RUN_H - 0.14), "VOID")  # shadow under the shelf on the wall
    p.line(Pi(z0, 0.0, RUN_H - 0.2), Pi(z1, 0.0, RUN_H - 0.2), "INK")
    if stage == 0:
        # one old pair, worn and sagging
        shoe(p, z0 + 0.15, 0.95, RUN_H, "BROWN_2", "ROSE_0", accent=None, d=0.55)
        shoe(p, z0 + 0.3, 0.95, RUN_H, "BROWN_1", "ROSE_0", accent=None, d=0.25)
    elif stage == 1:
        shoe(p, z0 + 0.1, 0.95, RUN_H, "TERRA_1", "ROSE_1", accent="CRT_0", d=0.55)
        shoe(p, z0 + 0.25, 0.95, RUN_H, "TERRA_0", "ROSE_0", accent="CRT_0", d=0.25)
        bib(p, z0 + 0.35, z0 + 1.2, 3.45, 4.15, "42")
    else:
        shoe(p, z0 + 0.05, 0.9, RUN_H, "TERRA_1", "ROSE_1", accent="CRT_0", d=0.55)
        shoe(p, z0 + 0.18, 0.9, RUN_H, "TERRA_0", "ROSE_0", accent="CRT_0", d=0.25)
        shoe(p, z0 + 1.0, 0.85, RUN_H, "CRT_0", "ROSE_1", accent="CREAM", d=0.6)
        shoe(p, z0 + 1.08, 0.85, RUN_H, "TERRA_0", "ROSE_0", accent="CRT_0", d=0.3)
        bib(p, z0 + 0.05, z0 + 0.85, 3.35, 4.0, "42")
        bib(p, z0 + 0.95, z0 + 1.75, 3.45, 4.1, "17", stripe="TERRA_1")
        bib(p, z0 + 0.45, z0 + 1.25, 4.05, 4.7, "26", stripe="CRT_0")
        # medal on a ribbon from a pushpin, hanging over the right bib
        pin = Pi(z0 + 1.6, 0.02, 4.6)
        p.px(pin[0], pin[1], "AMBER")
        med = Pi(z0 + 1.6, 0.04, 3.85)
        p.line((pin[0] - 1, pin[1] + 1), (med[0] - 1, med[1] - 2), "CRT_0")
        p.line((pin[0] + 1, pin[1] + 1), (med[0] + 1, med[1] - 2), "TERRA_1")
        p.circ(med[0], med[1], 2, "GOLD_DK", fill=True)
        p.px(med[0] - 1, med[1] - 1, "GOLD")
        p.px(med[0], med[1] - 2, "AMBER")
    return p


# ---------------------------------------------------------------- triathlon: road bike hung on the wall
BW_D = 0.55  # the bike's plane, out from the wall (hooks)
AH = 6.15  # axle height ft
WR = 1.08  # wheel radius ft
ZR, ZF = 9.85, 13.3  # rear and front axle along the wall


def bp(z, h, d=BW_D):
    return P(z, d, h)


def wheel_poly(zc, hc, r, d=BW_D, n=32):
    return [P(zc + r * math.cos(2 * math.pi * i / n), d, hc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def punch(p: Pen, pts):
    img = Image.new("L", (p.w, p.h), 0)
    ImageDraw.Draw(img).polygon([(round(a) - p.ox, round(b) - p.oy) for a, b in pts], fill=1)
    m = img.load()
    for y in range(p.h):
        for x in range(p.w):
            if m[x, y]:
                p.s.px(x, y, None)


FR = dict(bb=(ZR + 1.35, AH - 0.22), seat=(ZR + 0.85, AH + 1.6), head_t=(ZF - 0.62, AH + 1.5),
          head_b=(ZF - 0.5, AH + 1.0), saddle=(ZR + 0.75, AH + 1.95), bars=(ZF - 0.72, AH + 1.85))


def wall_hooks(p):
    for zz in (ZR + 0.9, ZF - 1.0):
        a = Pi(zz, 0.02, AH + 1.7)
        b = Pi(zz, BW_D + 0.1, AH + 1.75)
        p.line(a, b, "INK")
        p.px(b[0], b[1] - 1, "INK")
        p.px(a[0], a[1] - 1, "BROWN_1")


def bike_awake() -> Pen:
    p = Pen(540, 58, 632, 134, layer=4)
    wall_hooks(p)
    for zc in (ZR, ZF):
        p.poly(wheel_poly(zc, AH, WR), "INK")
        p.poly(wheel_poly(zc, AH, WR - 0.1), "BROWN_1")
        punch(p, wheel_poly(zc, AH, WR - 0.2))
        c = bp(zc, AH)
        for k in range(8):
            q = wheel_poly(zc, AH, WR - 0.2, n=8)[k]
            p.line(c, q, "BROWN_2")
        p.circ(c[0], c[1], 1, "ROSE_0")
        # window-side rim on the tyre (back/left arc)
        for i, q in enumerate(wheel_poly(zc, AH, WR)):
            a = 2 * math.pi * i / 32
            if math.cos(a) < -0.3 and math.sin(a) > -0.6:
                p.px(q[0], q[1], "RIM")
    bb, seat, ht, hb = (bp(*FR[k]) for k in ("bb", "seat", "head_t", "head_b"))
    rear, front = bp(ZR, AH), bp(ZF, AH)
    for a, b in ((rear, bb), (rear, seat), (bb, seat), (bb, hb), (seat, ht), (ht, hb), (hb, front)):
        p.line(a, b, "CRT_0")
    p.line((seat[0], seat[1] - 1), (ht[0], ht[1] - 1), "CRT_1")  # lit top tube
    p.line((bb[0] + 1, bb[1]), (hb[0] + 1, hb[1]), "TERRA_0")
    # seat post and saddle
    sad = bp(*FR["saddle"])
    p.line(seat, sad, "ROSE_0")
    p.line(bp(ZR + 0.35, AH + 2.0), bp(ZR + 1.15, AH + 1.97), "INK")
    p.line(bp(ZR + 0.4, AH + 2.05), bp(ZR + 1.0, AH + 2.03), "INK")
    q = Pi(ZR + 0.35, BW_D, AH + 2.02)
    p.px(q[0], q[1], "RIM")
    # stem, bars and drops
    bars = bp(*FR["bars"])
    p.line(ht, bars, "INK")
    drop = [bp(ZF - 0.72, AH + 1.85), bp(ZF - 0.4, AH + 1.85), bp(ZF - 0.28, AH + 1.62), bp(ZF - 0.36, AH + 1.4),
            bp(ZF - 0.55, AH + 1.38)]
    p.path(drop, "INK")
    p.px(round(drop[1][0]), round(drop[1][1]) - 1, "ROSE_0")
    # crank and chainring
    p.circ(bb[0], bb[1], 2, "BROWN_1")
    p.px(round(bb[0]) - 1, round(bb[1]) - 2, "ROSE_0")
    p.line(bb, bp(ZR + 1.15, AH - 0.75), "ROSE_0")
    # bottle in the cage on the down tube
    b0 = bp(ZR + 1.6, AH + 0.25)
    b1 = bp(ZR + 1.95, AH + 0.85)
    p.line(b0, b1, "ROSE_1")
    p.line((b0[0], b0[1] + 1), (b1[0], b1[1] + 1), "ROSE_0")
    # helmet hanging from the bars by its strap
    hc = bp(ZF - 0.15, AH + 0.95, BW_D + 0.3)
    p.line(drop[2], (hc[0], hc[1] - 3), "INK")
    p.ell(hc[0] - 4, hc[1] - 3, hc[0] + 4, hc[1] + 3, "CRT_0")
    p.ell(hc[0] - 4, hc[1] - 3, hc[0] + 4, hc[1], "CRT_1", only="CRT_0")
    p.line((hc[0] - 4, hc[1] + 2), (hc[0] + 4, hc[1] + 2), "TERRA_0")
    for k in (-2, 0, 2):
        p.px(hc[0] + k, hc[1] - 1, "INK")
    p.px(hc[0] - 3, hc[1] - 2, "SUN")
    return p


def sheet_shape(stage):
    """Top contour (z, h) of the dust sheet over the hung bike, back to front."""
    top = [(ZR - 1.15, AH - 0.55), (ZR - 1.12, AH + 0.15), (ZR - 0.85, AH + 0.85), (ZR - 0.3, AH + 1.4),
           (ZR + 0.35, AH + 1.8), (ZR + 0.8, AH + 1.92), (ZR + 1.25, AH + 1.82), (ZR + 2.0, AH + 1.72),
           (ZF - 0.95, AH + 1.78), (ZF - 0.65, AH + 1.88), (ZF - 0.3, AH + 1.62), (ZF + 0.3, AH + 1.15),
           (ZF + 0.85, AH + 0.55), (ZF + 1.1, AH - 0.1), (ZF + 1.13, AH - 0.55)]
    if stage == 2:  # pulled back off the front half
        top = top[:8] + [(ZF - 1.4, AH + 1.0), (ZF - 1.5, AH - 0.6)]
    return top


def bike_covered(stage) -> Pen:
    """The bike on its wall hooks under a grey dust sheet. stage None/0: heavy dust, 1: lighter dust and a
    cycling cap hung on a hook, 2: sheet pulled back off the front wheel and bars, helmet hanging."""
    p = Pen(540, 58, 632, 134, layer=4)
    wall_hooks(p)
    # wheel bottoms (the sheet covers the rest)
    for zc in (ZR, ZF):
        p.poly(wheel_poly(zc, AH, WR), "INK")
        p.poly(wheel_poly(zc, AH, WR - 0.1), "BROWN_1")
        punch(p, wheel_poly(zc, AH, WR - 0.2))
    if stage == 2:
        # the uncovered front: fork, bars, spokes, red head tube, helmet hanging from the drops
        c = bp(ZF, AH)
        for k in range(8):
            p.line(c, wheel_poly(ZF, AH, WR - 0.2, n=8)[k], "BROWN_2")
        p.circ(c[0], c[1], 1, "ROSE_0")
        ht, hb = bp(*FR["head_t"]), bp(*FR["head_b"])
        p.line(ht, hb, "CRT_0")
        p.line(hb, c, "CRT_0")
        p.line(bp(ZF - 1.4, AH + 1.55), ht, "CRT_0")
        p.line(bp(ZF - 1.4, AH + 1.52), (ht[0], ht[1] - 1), "CRT_1")
        p.line(bp(ZF - 1.4, AH + 0.6), hb, "TERRA_0")
        bars = bp(*FR["bars"])
        p.line(ht, bars, "INK")
        drop = [bars, bp(ZF - 0.4, AH + 1.85), bp(ZF - 0.28, AH + 1.62), bp(ZF - 0.36, AH + 1.4),
                bp(ZF - 0.55, AH + 1.38)]
        p.path(drop, "INK")
        for i, q in enumerate(wheel_poly(ZF, AH, WR)):
            a = 2 * math.pi * i / 32
            if math.cos(a) < -0.3 and math.sin(a) > -0.6:
                p.px(q[0], q[1], "RIM")
        hc = bp(ZF - 0.15, AH + 0.95, BW_D + 0.3)
        p.line(drop[2], (hc[0], hc[1] - 3), "INK")
        p.ell(hc[0] - 4, hc[1] - 3, hc[0] + 4, hc[1] + 3, "CRT_0")
        p.ell(hc[0] - 4, hc[1] - 3, hc[0] + 4, hc[1], "CRT_1", only="CRT_0")
        p.line((hc[0] - 4, hc[1] + 2), (hc[0] + 4, hc[1] + 2), "TERRA_0")
        for k in (-2, 0, 2):
            p.px(hc[0] + k, hc[1] - 1, "INK")
        p.px(hc[0] - 3, hc[1] - 2, "SUN")
    sh = Pen(p.ox, p.oy, p.ox + p.w - 1, p.oy + p.h - 1, 4)
    top = sheet_shape(stage)
    z_a, z_b = top[0][0], top[-1][0]
    hem = []
    for k in range(25):
        zz = z_b - (z_b - z_a) * k / 24
        # scallops: the hem hangs lower between the drape points, catching on the wheels
        hh = AH - 0.6 - 0.1 * abs(math.sin((zz - ZR) * 2.2)) + 0.04 * hsh(77, k)
        hem.append(P(zz, 1.0, hh))
    outline = [P(z, 1.0, h) for z, h in top] + hem
    sh.poly(outline, "BROWN_1")
    # folds: troughs from the drape points down to the hem, lit ridge beside each (window side = left)
    peaks = [(ZR + 0.75, AH + 2.0), (ZR + 0.15, AH + 1.75), (ZR + 1.45, AH + 1.7), (ZR + 2.05, AH + 1.6),
             (ZF - 0.6, AH + 1.9), (ZF - 0.1, AH + 1.5), (ZR - 0.5, AH + 1.0), (ZF + 0.55, AH + 0.85)]
    for i, (zz, hh) in enumerate(peaks):
        if stage == 2 and zz > ZF - 1.5:
            continue
        a = P(zz, 1.0, hh - 0.15)
        b = P(zz + (0.25 if i % 2 else -0.2), 1.0, AH - 0.55)
        sh.line(a, b, "INK" if i % 3 else "BROWN_0", only="BROWN_1")
        sh.line((a[0] - 1, a[1] + 1), (b[0] - 1, b[1]), "BROWN_2", only="BROWN_1")
        if i % 2 == 0:
            sh.line((a[0] - 2, a[1] + 3), (a[0] - 2 + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4), "ROSE_0",
                   only="BROWN_1")
    # underside of the sheet in shadow (the eye is below it): a dark band along the hem
    for x, y in sh.each():
        if sh.get(x, y) in ("BROWN_1", "BROWN_2", "ROSE_0") and sh.get(x, y + 2) is None:
            sh.px(x, y, "BROWN_0")
    for x, y in sh.each():
        if sh.get(x, y) in ("BROWN_1", "BROWN_2") and sh.get(x, y + 1) is None:
            sh.px(x, y, "INK")
    # lit top ridge and window-side (back) edge of the sheet only
    xmid = bp(ZR + 0.6, 0)[0]
    sheetc = {"BROWN_1", "BROWN_2", "BROWN_0", "INK", "ROSE_0"}
    sh.rim(sheetc, "ROSE_0", 0, -1, prob=0.9, seed=3, box=(540, 58, 632, 120))
    sh.rim(sheetc, "RIM", -1, 0, prob=0.7, seed=4, box=(540, 58, round(xmid), 118))
    for x, y in sh.each((540, 58, round(xmid) + 8, 90)):
        if sh.get(x, y) == "ROSE_0" and sh.get(x, y - 1) is None and hsh(14, x) < 0.45:
            sh.px(x, y, "RIM")
    # dust on the up-facing ridge
    dust = {None: 0.5, 0: 0.5, 1: 0.2, 2: 0.15}[stage]
    for x, y in sh.each():
        c = sh.get(x, y)
        if c == "ROSE_0" and sh.get(x, y - 1) is None and hsh(11, x, y) < dust:
            sh.px(x, y, "BROWN_2" if hsh(12, x) < 0.4 else "ROSE_1")
        elif c == "BROWN_1" and hsh(13, x, y) < dust * 0.012:
            sh.px(x, y, "ROSE_0")
    p.paste(sh)
    # the crank and a pedal hang below the hem in the middle
    bb = bp(*FR["bb"])
    pd = bp(ZR + 1.2, AH - 0.85)
    p.line(bb, pd, "INK", only="empty")
    p.line((pd[0] - 2, pd[1]), (pd[0] + 1, pd[1]), "INK")
    p.px(round(pd[0]) - 2, round(pd[1]) - 1, "BROWN_2")
    for x, y in p.each():  # a second, sparser highlight row just under the ridge on the back half
        if p.get(x, y) == "BROWN_1" and p.get(x, y - 1) == "ROSE_0" and x < bp(ZR + 1.3, 0)[0] and hsh(6, x) < 0.5:
            p.px(x, y, "BROWN_2")
    if stage == 1:
        # cycling cap hung on a nail at the front end of the sheet
        n = Pi(ZF + 1.0, 0.02, AH + 1.55)
        p.px(n[0], n[1], "ROSE_0")
        p.rect(n[0] - 3, n[1] + 1, n[0] + 2, n[1] + 3, "TERRA_0")
        p.line((n[0] - 4, n[1] + 4), (n[0] + 1, n[1] + 4), "INK")
        p.px(n[0] - 3, n[1] + 1, "RIM")
        p.px(n[0], n[1] + 2, "CRT_0")
    return p


# ---------------------------------------------------------------- gym decor
def flooring(t: int) -> Pen:
    p = Pen(530, 205, 600, FLOOR_C - 1, layer=4)
    if t == 1:
        # one thin exercise mat on the bare tiles, a curled corner
        z0, z1, d0, d1 = 9.6, 12.6, 0.4, 1.7
        p.poly(top_q(z0, z1, d0, d1, 0.02), "PLUM_0")
        p.line(Pi(z0, d1, 0.02), Pi(z1, d1, 0.02), "PLUM_1")
        p.line(Pi(z1, d0, 0.02), Pi(z1, d1, 0.02), "INK")
        q = Pi(z1, d1, 0.05)
        p.px(q[0], q[1] - 1, "PLUM_1")
        p.px(q[0] + 1, q[1] - 1, "PLUM_0")
        return p
    z0, z1, d0, d1 = 9.15, 13.25, 0.0, 1.85
    # rubber tiles: near-black with 2 ft seams and a fleck texture
    def tile(zz, dd, x, y):
        if (zz - z0) % 2.0 < 0.08 or dd % 2.0 < 0.06:
            return "VOID"
        return "INK" if hsh(21, x, y) > 0.09 else "BROWN_1"
    pts = top_q(z0, z1, d0, d1, 0.01)
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
            den = 77
            s = (y + 0.5 - 121) / den
            zz = D * (1 - 1 / s)
            dd = (XR(s) - (x + 0.5)) / (15 * K * s)
            if z0 <= zz <= z1 and d0 <= dd <= d1:
                p.px(x, y, tile(zz, dd, x, y))
    # edge lip on the room side catches the sunbeam glow
    p.line(Pi(z0, d1, 0.01), Pi(z1, d1, 0.01), "BROWN_2")
    for k in range(0, 40, 3):
        q = Pi(z0 + (z1 - z0) * k / 40, d1, 0.01)
        p.px(q[0], q[1], "TERRA_1")
    if t >= 5:
        # a wooden lifting-platform inlay with a brass edge strip
        wz0, wz1, wd0, wd1 = 10.2, 12.3, 0.2, 1.6
        p.poly(top_q(wz0, wz1, wd0, wd1, 0.02), "TERRA_0")
        for k in range(1, 4):
            dd = wd0 + (wd1 - wd0) * k / 4
            p.line(Pi(wz0, dd, 0.02), Pi(wz1, dd, 0.02), "BROWN_2")
        p.line(Pi(wz0, wd1, 0.02), Pi(wz1, wd1, 0.02), "GOLD_DK")
        p.line(Pi(wz1, wd0, 0.02), Pi(wz1, wd1, 0.02), "GOLD_DK")
    return p


FW = (16.9, 19.2)  # front-wall decor column (z), x about 666..710 (layer 5)
SHELF_H = 4.05


def protein_shelf() -> Pen:
    p = Pen(656, 118, 716, 152, layer=5)
    z0, z1, h = FW[0], FW[1], SHELF_H
    box(p, z0, z1, 0.0, 0.8, h - 0.1, h, "BROWN_1", "BROWN_0", "BROWN_2", rim="RIM")
    for zz in (z0 + 0.3, z1 - 0.3):
        p.line(Pi(zz, 0.05, h - 0.12), Pi(zz, 0.6, h - 0.12), "INK")
        p.line(Pi(zz, 0.05, h - 0.12), Pi(zz, 0.05, h - 0.5), "INK")
    tubs = [(17.15, 0.75, "INK", "CRT_0"), (17.6, 0.6, "BROWN_0", "AMBER"), (18.05, 0.78, "INK", "ROSE_1"),
            (18.95, 0.42, "PLUM_0", "PLUM_1")]
    for zc, ht, body, label in tubs:
        xa, ya = Pi(zc, 0.42, h)
        _, yb = Pi(zc, 0.42, h + ht)
        w = 6 if ht > 0.5 else 4
        xl = xa - w // 2
        p.rect(xl, yb, xl + w - 1, ya - 1, body)
        p.rect(xl, yb + 2, xl + w - 1, yb + 4 + (1 if ht > 0.7 else 0), label)
        p.line((xl, yb), (xl + w - 1, yb), "BROWN_1")
        p.line((xl, yb - 1), (xl + w - 1, yb - 1), "INK")
        p.line((xl, yb), (xl, ya - 1), "RIM")
        p.px(xl + 1, yb + 3, "CREAM" if label == "CRT_0" else label)
    # shaker bottle
    xa, ya = Pi(18.5, 0.4, h)
    p.rect(xa - 1, ya - 9, xa + 1, ya - 1, "ROSE_0")
    p.rect(xa - 1, ya - 11, xa + 1, ya - 10, "INK")
    p.px(xa - 1, ya - 8, "ROSE_1")
    # amber LED strip under the shelf lip
    p.line(Pi(z0 + 0.1, 0.75, h - 0.12), Pi(z1 - 0.1, 0.75, h - 0.12), "AMBER")
    return p


def speaker() -> Pen:
    """Bluetooth speaker standing on the floor by the mirror: a fabric cylinder, red and amber LEDs."""
    p = Pen(620, 210, 640, 234, layer=4)
    xa, ya = Pi(14.75, 0.45, 0)
    p.rect(xa - 3, ya - 11, xa + 2, ya - 1, "BROWN_0")
    p.ell(xa - 3, ya - 13, xa + 2, ya - 10, "INK")
    p.line((xa - 3, ya - 10), (xa - 3, ya - 1), "RIM")
    for yy in range(ya - 9, ya - 1, 2):
        p.line((xa - 2, yy), (xa + 1, yy), "BROWN_1")
    p.px(xa - 1, ya - 12, "CRT_1")
    p.px(xa + 1, ya - 12, "AMBER")
    p.line((xa - 3, ya), (xa + 3, ya), "VOID")
    return p


def poster(t: int) -> Pen:
    """Runner poster high on the front wall: t1 a printout taped up, t3 framed print, t5 framed with a picture
    light."""
    p = Pen(656, 66, 716, 128, layer=5)
    z0, z1, h0, h1 = FW[0] + 0.05, FW[1] - 0.2, 5.15, 7.0
    if t >= 3:
        wall_rect(p, z0 - 0.08, z1 + 0.08, h0 - 0.1, h1 + 0.1, "INK", d=0.02)

    def art(u, v, x, y):
        if v > 0.82:
            return "BROWN_0" if t >= 3 else "BROWN_1"
        if v > 0.74:
            return "TERRA_0"
        if math.hypot((u - 0.62) * 1.2, v - 0.38) < 0.17:
            return "CRT_0"
        return "PLUM_0" if v < 0.45 else "TERRA_0" if v > 0.6 else "BROWN_2"
    wall_fn(p, z0, z1, h0, h1, art, d=0.03)
    fig = [((0.38, 0.33), (0.33, 0.55)), ((0.36, 0.38), (0.26, 0.48)), ((0.36, 0.38), (0.47, 0.45)),
           ((0.33, 0.55), (0.22, 0.7)), ((0.33, 0.55), (0.45, 0.66)), ((0.45, 0.66), (0.5, 0.74)),
           ((0.22, 0.7), (0.15, 0.68))]

    def uv(u, v):
        return P(z0 + (z1 - z0) * u, 0.03, h1 - (h1 - h0) * v)
    for a, b in fig:
        p.line(uv(*a), uv(*b), "VOID")
    q = uv(0.39, 0.27)
    p.rect(round(q[0]) - 1, round(q[1]) - 1, round(q[0]), round(q[1]), "VOID")
    for k in range(3, 14):
        q = uv(0.1 + k * 0.05, 0.88)
        if k % 4:
            p.px(q[0], q[1], "ROSE_0")
    if t == 1:
        for u, v in ((0.0, 0.0), (1.0, 0.0)):
            q = uv(u, v)
            p.px(q[0], q[1], "ROSE_1")
            p.px(q[0] + (1 if u == 0 else -1), q[1] + 1, "ROSE_0")
        q = uv(1.0, 1.0)
        p.px(q[0], q[1], None)
        p.px(q[0] - 1, q[1], "ROSE_0")
    else:
        p.line(Pi(z0 - 0.08, 0.04, h1 + 0.1), Pi(z1 + 0.08, 0.04, h1 + 0.1), "BROWN_2")
        p.line(Pi(z0 - 0.08, 0.04, h0 - 0.1), Pi(z0 - 0.08, 0.04, h1 + 0.1), "RIM")
    if t >= 5:
        a, b = Pi(z0 + 0.3, 0.3, h1 + 0.3), Pi(z1 - 0.3, 0.3, h1 + 0.3)
        p.line(a, b, "GOLD_DK")
        p.line((a[0], a[1] + 1), (b[0], b[1] + 1), "AMBER")
        glow(p, [p], (a[0] + b[0]) / 2, a[1] + 8, 18, 16, WARM, strength=1.0)
    return p


def timer() -> Pen:
    """Interval timer on the wall above the mirror: red LED digits; red glow on the wall; cord down."""
    p = Pen(620, 66, 670, 132, layer=4)
    z0, z1, h0, h1 = 15.0, 16.4, 6.05, 6.65
    wall_rect(p, z0, z1, h0, h1, "INK", d=0.05)
    p.line(Pi(z0, 0.06, h1), Pi(z1, 0.06, h1), "BROWN_1")
    p.line(Pi(z0, 0.06, h0), Pi(z0, 0.06, h1), "RIM")
    xl = round(P(z0 + 0.12, 0.05, 0)[0])
    wall_text(p, xl, h1 - 0.1, "0:45", "CRT_1", d=0.06)
    for x, y in p.each():
        if p.get(x, y) == "CRT_1" and hsh(5, x, y) < 0.35:
            p.px(x, y, "CRT_0")
    cx, cy = P((z0 + z1) / 2, 0.05, (h0 + h1) / 2)
    glow(p, [p], cx, cy, 20, 13, RED, strength=0.9, box=(620, 66, 659, 132))
    p.line(Pi(z1 - 0.12, 0.03, h0), Pi(z1 - 0.1, 0.03, 5.5), "VOID")
    return p


def mirror() -> Pen:
    """Full-length mirror leaning on the front of the right wall, catching the sunset as a warm streak."""
    p = Pen(628, 100, 662, 235, layer=4)
    z0, z1, h0, h1 = 15.1, 16.2, 0.15, 5.35

    def glass(u, v, x, y):
        k = u * 1.6 + v * 0.45
        if 0.62 < k < 0.8:
            return "ROSE_0" if 0.66 < k < 0.76 else "BROWN_2"
        if 0.86 < k < 0.9:
            return "BROWN_2"
        if v > 0.8:
            return "TERRA_0" if (x + y) % 3 else "BROWN_2"
        return "INK_COOL" if v < 0.3 else "BROWN_0"
    wall_rect(p, z0 - 0.1, z1 + 0.1, 0.0, h1 + 0.12, "INK", d=0.12)
    wall_fn(p, z0, z1, h0, h1, glass, d=0.13)
    p.line(Pi(z0 - 0.1, 0.14, 0.0), Pi(z0 - 0.1, 0.14, h1 + 0.12), "RIM")
    p.line(Pi(z0 - 0.1, 0.14, h1 + 0.12), Pi(z1 + 0.1, 0.14, h1 + 0.12), "TERRA_1")
    p.line(Pi(z0 - 0.1, 0.3, 0.0), Pi(z1 + 0.1, 0.3, 0.0), "VOID")
    return p


def towel() -> Pen:
    """Gym towel thrown over the top corner of the mirror."""
    p = Pen(628, 100, 652, 235, layer=4)
    hz, hh = 15.3, 5.5
    for i, (dz0, dz1, top, bot, col) in enumerate(((-0.32, 0.12, 0.0, 1.55, "TERRA_0"),
                                                   (-0.2, 0.3, 0.05, 1.25, "TERRA_1"))):
        pts = [P(hz + dz0, 0.2 + i * 0.05, hh - top), P(hz + dz1, 0.2 + i * 0.05, hh - top + 0.05),
               P(hz + dz1 + 0.05, 0.22 + i * 0.05, hh - bot), P(hz + dz0 - 0.05, 0.22 + i * 0.05, hh - bot - 0.15)]
        p.poly(pts, col)
    p.rim({"TERRA_1", "TERRA_0"}, "RIM", -1, 0, prob=0.8, seed=31)
    p.rim({"TERRA_1", "TERRA_0"}, "TERRA_2", 0, -1, prob=0.8, seed=32)
    p.line(Pi(hz - 0.18, 0.3, hh - 1.0), Pi(hz + 0.28, 0.3, hh - 0.95), "TERRA_0")
    p.line(Pi(hz - 0.18, 0.3, hh - 1.08), Pi(hz + 0.28, 0.3, hh - 1.03), "BROWN_2")
    return p


def jumprope() -> Pen:
    """Jump rope coiled on a hook with its two red handles hanging, and a plum resistance band."""
    p = Pen(656, 112, 680, 190, layer=5)
    hz, hh = 16.55, 3.45
    hk = Pi(hz, 0.02, hh)
    p.px(hk[0], hk[1], "ROSE_0")
    p.px(hk[0] + 1, hk[1], "INK")
    # band: a long flat loop
    p.line((hk[0], hk[1] + 1), Pi(hz - 0.2, 0.05, hh - 1.6), "PLUM_1")
    p.line((hk[0] + 1, hk[1] + 1), Pi(hz + 0.05, 0.05, hh - 1.55), "PLUM_1")
    p.line(Pi(hz - 0.2, 0.05, hh - 1.6), Pi(hz + 0.05, 0.05, hh - 1.55), "PLUM_0")
    # rope: two coils (ovals) hanging from the hook
    for k, (rz, rh) in enumerate(((0.35, 0.55), (0.3, 0.7))):
        c = P(hz + 0.02 * k, 0.08, hh - rh)
        rx = abs(P(hz + rz, 0.08, 0)[0] - P(hz, 0.08, 0)[0])
        ry = rh * PXF * S(hz)
        pts = [(c[0] + rx * math.cos(2 * math.pi * i / 20), c[1] + ry * math.sin(2 * math.pi * i / 20)) for i in
               range(21)]
        p.path(pts, "INK")
    # handles hanging below the coil
    for dz, dh in ((-0.18, 1.25), (0.16, 1.45)):
        a = Pi(hz + dz, 0.1, hh - dh)
        p.line((hk[0], hk[1] + 2), (a[0], a[1] - 1), "INK")
        p.rect(a[0] - 1, a[1], a[0], a[1] + 6, "CRT_0")
        p.px(a[0] - 1, a[1], "RIM")
        p.px(a[0], a[1] + 6, "TERRA_0")
    return p


def trophies(t: int) -> Pen:
    """Front wall under the protein shelf: t1 two medals on a nail, t3 a small shelf with a trophy and medals,
    t5 a lit glass display case with medals and trophies."""
    p = Pen(656, 136, 716, 212, layer=5)
    z0 = FW[0]
    if t == 1:
        nail = Pi(17.9, 0.02, 3.4)
        p.px(nail[0], nail[1], "ROSE_0")
        for k, (col, ln) in enumerate((("CRT_0", 0.9), ("PLUM_1", 1.15))):
            end = Pi(17.9 + (k - 0.5) * 0.3, 0.04, 3.4 - ln)
            p.line(nail, (end[0], end[1] - 2), col)
            p.line((nail[0] + 1, nail[1]), (end[0] + 1, end[1] - 2), "TERRA_0" if k == 0 else "PLUM_0")
            p.circ(end[0], end[1], 2, "GOLD_DK")
            p.px(end[0] - 1, end[1] - 1, "GOLD" if k == 0 else "AMBER")
        return p
    if t < 5:
        z1, h = z0 + 1.9, 3.0
        box(p, z0 + 0.1, z1, 0.0, 0.75, h - 0.12, h, "BROWN_1", "BROWN_0", "BROWN_2", rim="RIM")
        xa, ya = Pi(17.45, 0.4, h)
        p.rect(xa - 2, ya - 2, xa + 2, ya - 1, "INK")
        p.line((xa, ya - 3), (xa, ya - 5), "GOLD_DK")
        p.rect(xa - 2, ya - 9, xa + 2, ya - 6, "GOLD_DK")
        p.px(xa - 3, ya - 8, "GOLD_DK")
        p.px(xa + 3, ya - 8, "GOLD_DK")
        p.line((xa - 2, ya - 9), (xa - 2, ya - 6), "GOLD")
        p.px(xa - 1, ya - 9, "AMBER")
        for k, (zz, col) in enumerate(((18.15, "CRT_0"), (18.55, "TERRA_1"))):
            a = Pi(zz, 0.05, h - 0.15)
            b = Pi(zz, 0.06, h - 0.95 - k * 0.15)
            p.line(a, (b[0], b[1] - 2), col)
            p.circ(b[0], b[1], 2, "GOLD_DK")
            p.px(b[0] - 1, b[1] - 1, "AMBER")
        return p
    z1, h0, h1 = FW[1], 1.45, 3.8
    box(p, z0, z1, 0.0, 0.7, h0, h1, "INK", "INK", None, rim=None)
    wall_rect(p, z0 + 0.05, z1 - 0.05, h0 + 0.1, h1 - 0.1, "BROWN_0", d=0.0)
    shelves = (h0 + 0.1, h0 + 0.85, h0 + 1.6)
    for hh in shelves:
        p.line(Pi(z0 + 0.05, 0.35, hh), Pi(z1 - 0.05, 0.35, hh), "BROWN_2")
    for k, hh in enumerate(shelves):
        for j in range(3):
            zz = z0 + 0.4 + j * 0.65
            xa, ya = Pi(zz, 0.35, hh)
            if (j + k) % 2 == 0:
                p.rect(xa - 1, ya - 6, xa + 1, ya - 3, "GOLD_DK")
                p.px(xa, ya - 2, "GOLD_DK")
                p.rect(xa - 1, ya - 1, xa + 1, ya - 1, "INK")
                p.px(xa - 1, ya - 6, "GOLD")
            else:
                p.line((xa, ya - 7), (xa, ya - 4), "CRT_0")
                p.circ(xa, ya - 2, 1, "GOLD_DK")
                p.px(xa - 1, ya - 3, "AMBER")
    glow(None, [p], *P((z0 + z1) / 2, 0.3, h1 - 0.2), 14, 20, WARM, strength=1.1)
    p.line(Pi(z0, 0.7, h0), Pi(z0, 0.7, h1), "RIM")
    p.line(Pi(z0, 0.7, h1), Pi(z1, 0.7, h1), "TERRA_1")
    for k in range(3):
        q = Pi(z0 + 0.3 + k * 0.2, 0.7, h1 - 0.3 - k * 0.3)
        p.px(q[0], q[1], "ROSE_0")
    return p


def ledstrip() -> Pen:
    """Amber LED strip stuck under the running shelf, washing the wall below it."""
    p = Pen(588, 160, 632, 206, layer=4)
    z0, z1 = RUN_Z
    p.line(Pi(z0 + 0.1, 0.7, RUN_H - 0.13), Pi(z1 - 0.1, 0.7, RUN_H - 0.13), "AMBER")
    for k in range(0, 9):
        q = Pi(z0 + 0.2 + k * 0.2, 0.7, RUN_H - 0.13)
        if k % 3 == 1:
            p.px(q[0], q[1], "GLOW")
    cx, cy = P((z0 + z1) / 2, 0.0, RUN_H - 0.3)
    under = max(Pi(z, 0.0, RUN_H - 0.2)[1] for z in (z0, z1)) + 1
    glow(p, [p], cx, cy, 20, 12, WARM_SOFT, strength=0.75, box=(588, under, 632, 206))
    return p


def phone() -> Pen:
    """Phone lying on the bench with a workout timer on its screen."""
    p = Pen(560, 184, 580, FLOOR_C + 3, layer=4)
    q = Pi(11.25, 0.85, BENCH[5])
    p.rect(q[0] - 2, q[1] - 1, q[0] + 2, q[1], "INK")
    p.line((q[0] - 1, q[1] - 1), (q[0] + 1, q[1] - 1), "GLOW")
    p.px(q[0] - 1, q[1], "AMBER")
    glow(None, [p], q[0], q[1] - 1, 4, 3, WARM_SOFT, strength=0.6)
    return p


def boxfan() -> Pen:
    """Box fan on the front floor angled at the bench: dark frame, round grille, a cord to the outlet."""
    p = Pen(586, 196, 632, 252, layer=5)
    x0, x1, yb = 600, 626, 248
    yt = yb - 30
    # body: front face + a sliver of the left side (window side)
    p.rect(x0, yt, x1, yb, "INK")
    p.poly([(x0 - 4, yt + 3), (x0, yt), (x0, yb), (x0 - 4, yb - 2)], "BROWN_1")
    p.line((x0 - 4, yt + 3), (x0 - 4, yb - 2), "RIM")
    p.line((x0 - 4, yt + 3), (x0, yt), "RIM")
    p.line((x0, yt), (x1, yt), "BROWN_2")
    cx, cy, r = (x0 + x1) // 2, (yt + yb) // 2, 11
    p.circ(cx, cy, r, "BROWN_0")
    p.circ(cx, cy, r - 2, "INK")
    for k in range(-r + 2, r - 1, 3):
        p.line((cx + k, cy - r + 1), (cx + k, cy + r - 1), "BROWN_0", only="INK")
    for a in range(3):
        ang = a * 2.1 + 0.4
        p.line((cx, cy), (cx + round(7 * math.cos(ang)), cy + round(7 * math.sin(ang))), "BROWN_1")
    p.circ(cx, cy, 1, "BROWN_2")
    p.px(cx - 1, cy - 1, "ROSE_0")
    # knob and feet
    p.px(x1 - 3, yt + 3, "AMBER")
    p.line((x0 + 1, yb + 1), (x0 + 4, yb + 1), "VOID")
    p.line((x1 - 4, yb + 1), (x1 - 1, yb + 1), "VOID")
    # cord to the wall outlet
    p.sag((x0 - 2, yb - 2), (600, 236), 2, "INK")
    p.line((600, 236), (604, 202), "VOID")
    return p


def duffel() -> Pen:
    """Gym duffel bag slumped on the front floor, a terracotta stripe and a strap."""
    p = Pen(540, 214, 598, 250, layer=5)
    x0, x1, yb = 548, 590, 246
    p.ell(x0, yb - 20, x1, yb, "INK")
    p.ell(x0 + 2, yb - 19, x1 - 6, yb - 6, "BROWN_0", only="INK")
    p.line((x0 + 3, yb - 9), (x1 - 3, yb - 8), "TERRA_1", only="opaque")
    p.line((x0 + 3, yb - 10), (x1 - 3, yb - 9), "TERRA_0", only="opaque")
    # zipper along the top, strap loop
    p.line((x0 + 8, yb - 18), (x1 - 8, yb - 18), "BROWN_1")
    p.sag((x0 + 12, yb - 18), (x1 - 14, yb - 18), -6, "INK")
    # end pocket on the right, window rim on the left
    p.ell(x1 - 9, yb - 15, x1 - 1, yb - 3, "BROWN_0")
    p.rim({"INK", "BROWN_0"}, "RIM", -1, 0, prob=0.5, seed=71, box=(540, 226, 556, 250))
    p.rim({"INK", "BROWN_0"}, "BROWN_2", 0, -1, prob=0.7, seed=72, box=(540, 214, 598, 236))
    p.line((x0 + 4, yb + 1), (x1 - 4, yb + 1), "VOID")
    return p


def kettlebell() -> Pen:
    """Black kettlebell on the floor just past the bench's front end."""
    p = Pen(578, 196, 602, FLOOR_C + 1, layer=4)
    base = P(12.95, 0.8, 0)
    r = 4
    cx, cy = round(base[0]), round(base[1]) - r
    p.circ(cx, cy, r, "INK")
    p.circ(cx - 1, cy - 1, r - 2, "BROWN_0")
    p.px(cx - 2, cy - 2, "BROWN_1")
    p.line((cx - 3, cy - r), (cx - 3, cy - r - 3), "INK")
    p.line((cx + 3, cy - r), (cx + 3, cy - r - 3), "INK")
    p.line((cx - 2, cy - r - 4), (cx + 2, cy - r - 4), "INK")
    p.px(cx - 3, cy - r - 3, "RIM")
    p.px(cx - 2, cy - r - 4, "RIM")
    p.px(cx - r, cy, "RIM")
    p.px(cx - r + 1, cy - 2, "RIM")
    p.line((cx - 3, cy + r + 1), (cx + 3, cy + r + 1), "VOID")
    return p


def foamroller() -> Pen:
    """Foam roller lying on the floor along the wall, in front of the bench."""
    p = Pen(539, 205, 572, FLOOR_C + 3, layer=4)
    z0, z1, dc, r = 9.85, 11.35, 1.9, 0.25
    pts = [P(z0, dc, 2 * r), P(z1, dc, 2 * r), P(z1, dc, 0), P(z0, dc, 0)]
    p.poly(pts, "SLATE_0")
    p.poly([P(z0, dc, 2 * r), P(z1, dc, 2 * r), P(z1, dc, r * 1.3), P(z0, dc, r * 1.3)], "PLUM_1")
    p.line(P(z0, dc, 2 * r), P(z1, dc, 2 * r), "RIM")
    p.line(P(z0, dc, 0), P(z1, dc, 0), "VOID")
    # end face (front) as a small ellipse with the hollow core
    e = Pi(z1, dc, r)
    p.ell(e[0] - 2, e[1] - 4, e[0] + 2, e[1] + 4, "PLUM_0")
    p.px(e[0], e[1], "INK")
    p.recolor({"SLATE_0": "PLUM_0"})
    return p


def yogamat() -> Pen:
    """Rolled yoga mat standing in the back of the gym, leaning on the wall behind the bench's back end."""
    p = Pen(538, 168, 556, FLOOR_C + 1, layer=4)
    zc = 8.75
    b = P(zc, 0.3, 0)
    t = P(zc + 0.15, 0.08, 2.15)
    for k in range(-2, 3):
        p.line((b[0] + k, b[1]), (t[0] + k, t[1]), "LEAF_1" if k < 2 else "LEAF_0")
    p.line((b[0] - 2, b[1]), (t[0] - 2, t[1]), "LEAF_2")
    p.line((b[0] - 3, b[1] - 1), (t[0] - 3, t[1] + 1), "RIM")
    p.ell(t[0] - 3, t[1] - 1, t[0] + 2, t[1] + 1, "LEAF_0")
    p.px(round(t[0]), round(t[1]), "VOID")
    m = ((b[0] + t[0]) / 2, (b[1] + t[1]) / 2)
    p.line((m[0] - 2, m[1]), (m[0] + 2, m[1] + 1), "INK")
    p.line((b[0] - 2, b[1] + 1), (b[0] + 2, b[1] + 1), "VOID")
    return p


def bottle() -> Pen:
    p = Pen(570, 200, 584, FLOOR_C + 3, layer=4)
    xa, ya = Pi(12.35, 1.55, 0)
    p.rect(xa - 1, ya - 8, xa + 1, ya - 1, "SLATE_0")
    p.rect(xa - 1, ya - 10, xa + 1, ya - 9, "INK")
    p.px(xa, ya - 11, "INK")
    p.line((xa - 1, ya - 8), (xa - 1, ya - 2), "SLATE_1")
    p.px(xa - 1, ya - 6, "RIM")
    p.recolor({"SLATE_0": "PLUM_0", "SLATE_1": "PLUM_1"})
    p.line((xa - 1, ya), (xa + 2, ya), "VOID")
    return p


def benchbox() -> Pen:
    """Cardboard box of supplements under the bench."""
    p = Pen(540, 196, 590, FLOOR_C + 1, layer=4)
    box(p, 10.15, 11.25, 0.1, 0.95, 0.0, 0.62, "TERRA_0", "BROWN_2", "TERRA_1", rim="TERRA_2", rimback=False)
    p.line(Pi(10.15, 0.52, 0.62), Pi(11.25, 0.52, 0.62), "BROWN_2")
    q = Pi(10.6, 0.95, 0.35)
    p.px(q[0], q[1], "ROSE_0")
    p.px(q[0] + 1, q[1], "ROSE_0")
    return p


def cables() -> Pen:
    """An extension cord from the wall outlet along the baseboard and out across the floor to a red-lit power
    strip by the bench, with the speaker's charge cable plugged in."""
    p = Pen(560, 196, 640, 235, layer=4)
    out = (605, 201)  # the shell's outlet
    a = Pi(12.6, 0.15, 0.0)
    p.sag((out[0], out[1] + 1), (out[0] + 1, a[1]), 0, "INK")
    pts = [(out[0] + 1, a[1]), Pi(12.4, 1.45, 0), Pi(11.6, 1.75, 0), Pi(11.9, 2.35, 0)]
    for u, v in zip(pts, pts[1:]):
        p.sag(u, v, 1.5, "INK")
    e = pts[-1]
    p.rect(e[0] - 10, e[1] - 1, e[0], e[1] + 1, "BROWN_1")
    p.line((e[0] - 10, e[1] - 1), (e[0], e[1] - 1), "BROWN_2")
    p.px(e[0] - 1, e[1], "CRT_1")
    for k in (-8, -6, -4):
        p.px(e[0] + k, e[1], "INK")
    # speaker charge cable from the strip to the speaker by the mirror
    p.sag((e[0] - 5, e[1] + 2), Pi(14.6, 0.6, 0), 2, "VOID")
    return p


# ============================================================================================ CENTRE
SX0, SY0 = 258, 149  # statue sprite top-left (zones centre.statue)
SCX = 276  # centre column


# The figure as span keyframes in "62 units": per body part a list of (y, x_left, x_right) on a 24-column grid
# (centre 11.5); rows interpolate linearly, so the same figure rasterises cleanly at 1x (62 px) and for the
# close-up. Weight on the viewer-left leg: that hip is higher and that shoulder lower (contrapposto); the free
# leg's knee drops and turns in, its foot sits out to the side with the heel raised.
FIG = {
    "legL": [(33, 7, 11), (40, 8, 11.6), (47, 9, 12), (48.5, 9, 12), (49, 8, 12), (53, 8, 11.5), (57, 10, 11),
             (58.9, 10, 11), (59, 9, 11), (60, 8, 12), (61.9, 7, 12)],
    "legR": [(33, 12, 17), (40, 12, 16), (47, 12, 15), (48.5, 12.4, 15), (50, 13, 16.4), (53, 14, 17),
             (57, 15, 16.4), (58.9, 15, 16), (59, 15, 17), (60, 15, 18), (61.9, 16, 19)],
    "torso": [(10, 9, 14), (11, 7, 16), (12, 6, 16), (14.9, 6, 16), (15, 7, 16), (19.9, 7, 16), (20, 8, 15),
              (24.9, 8, 15), (25, 8, 16), (26, 7, 16), (28.9, 7, 16), (29, 7, 17), (33.9, 7, 17)],
    "armL": [(12, 4, 5), (13, 3, 5), (22, 3, 5), (23, 3, 4), (27, 3, 4), (30, 2, 4), (35, 2, 4), (36.9, 3, 4)],
    "armR": [(11, 17, 18), (12, 17, 19), (13, 17, 20), (14, 18, 20), (17.9, 18, 20), (18, 19, 21), (22, 19, 21),
             (23, 19, 20), (29, 18, 19), (30, 18, 20), (33, 18, 20), (34.9, 18, 19)],
    "neck": [(8, 11, 13), (9.9, 11, 13)],
    "head": [(0, 10, 13), (0.9, 10, 13), (1, 9, 14), (5.9, 9, 14), (6, 10, 14), (7, 10, 13.4), (7.9, 11, 13)],
}
PART_ORDER = ["legL", "legR", "torso", "armL", "armR", "neck", "head"]


def _span(keys, y):
    if y < keys[0][0] or y > keys[-1][0] + 0.1:
        return None
    for (y0, a0, b0), (y1, a1, b1) in zip(keys, keys[1:]):
        if y0 <= y <= y1:
            t = 0 if y1 == y0 else (y - y0) / (y1 - y0)
            return a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
    return keys[-1][1], keys[-1][2]


def figure_masks(k: float, W: int, H: int, cx: float, top: float):
    """Rasterise each body part at scale k (px per 62-unit) into a mask dict name -> set((x, y)); grid column
    11.5 lands on cx."""
    masks = {}
    ox = cx - 12 * k
    for name in PART_ORDER:
        m = set()
        for r in range(H):
            y = (r - top + 0.5) / k
            sp = _span(FIG[name], y)
            if not sp:
                continue
            xl, xr = sp
            c0 = math.ceil(xl * k - 0.5 + ox)
            c1 = math.ceil((xr + 1) * k - 0.5 + ox) - 1
            for c in range(c0, c1 + 1):
                if 0 <= c < W:
                    m.add((c, r))
        masks[name] = m
    return masks


def shade_figure(masks, W, H):
    """Obsidian: per-part cross-section shading, rim light from the window behind (stronger on the right)."""
    full = set().union(*masks.values())
    grid = {}
    for name in PART_ORDER:
        m = masks[name]
        rows = {}
        for x, y in m:
            rows.setdefault(y, []).append(x)
        ys = sorted(rows)
        if not ys:
            continue
        y0, y1 = ys[0], ys[-1]
        for y in ys:
            xs = sorted(rows[y])
            xl, xr = xs[0], xs[-1]
            w = xr - xl + 1
            vy = (y - y0) / max(1, y1 - y0)
            for x in xs:
                f = (x - xl) / max(1, w - 1)
                if w <= 2:
                    c = "INK_COOL" if x == xl else "VOID"
                elif f < 0.12:
                    c = "BROWN_0"
                elif f < 0.4:
                    c = "INK_COOL"
                elif f < 0.74:
                    c = "INK"
                else:
                    c = "VOID"
                # glassy specular streak a third of the way across, on the middle of long parts
                if w >= 4 and abs(f - 0.3) < 0.5 / w and 0.2 < vy < 0.6 and name in ("torso", "legL", "legR",
                                                                                      "armL", "armR"):
                    c = "SLATE_0"
                grid[(x, y)] = c
        # internal separations where this part overlaps earlier parts
        for x, y in m:
            if (x - 1, y) in full and (x - 1, y) not in m and (x - 1, y) in grid:
                grid[(x, y)] = "VOID"
    # rim light from the window behind and to the right: the outer right contour and the top edges glow; the
    # left contour gets a weak warm edge; edges facing the gaps (arm/torso, between the legs) stay dark
    rows = {}
    for x, y in full:
        rows.setdefault(y, []).append(x)
    for (x, y) in list(grid):
        right_out = (x + 1, y) not in full
        top_out = (x, y - 1) not in full
        left_out = (x - 1, y) not in full
        outer_r = x == max(rows[y])
        outer_l = x == min(rows[y])
        if top_out and (x, y + 1) in full and (outer_r or (x + 1, y - 1) not in full) and grid[(x, y)] != "BROWN_0":
            grid[(x, y)] = "RIM"
        elif right_out and outer_r:
            grid[(x, y)] = "RIM" if hsh(7, y // 2) < 0.85 else "TERRA_1"
        elif right_out:
            grid[(x, y)] = "TERRA_0" if hsh(9, y // 2) < 0.4 else "VOID"
        elif left_out and outer_l and hsh(8, y // 3) < 0.4:
            grid[(x, y)] = "TERRA_0"
    return grid, full


def veins(full, grid, tier: int, k: float, seed: int = 1):
    """Kintsugi cracks: deterministic random walks inside the figure; more and longer with tier."""
    inner = {(x, y) for (x, y) in full if all((x + dx, y + dy) in full for dx, dy in ((1, 0), (-1, 0), (0, 1),
                                                                                    (0, -1)))}
    ys = [y for _, y in full]
    ytop, ybot = min(ys), max(ys)
    n_cracks = {1: 2, 2: 4, 3: 6, 4: 9, 5: 13}[tier]
    length = {1: 4, 2: 6, 3: 9, 4: 12, 5: 16}[tier] * k
    # crack origins as fractions (fy along the body height, fx across): chest, shoulders, thighs, arms...
    seeds = [(0.24, 0.45), (0.62, 0.35), (0.35, 0.62), (0.75, 0.62), (0.1, 0.5), (0.47, 0.42), (0.86, 0.33),
             (0.3, 0.2), (0.54, 0.7), (0.4, 0.4), (0.68, 0.48), (0.2, 0.75), (0.93, 0.7), (0.15, 0.32)]
    out = {}
    for i in range(n_cracks):
        fy, fx = seeds[i]
        ty = round(ytop + (ybot - ytop) * fy)
        row = sorted(x for (x, y) in inner if y == ty)
        if not row:
            continue
        x = row[min(len(row) - 1, int(len(row) * fx))]
        y = ty
        dirx = 1 if hsh(seed, i) < 0.5 else -1
        diry = 1 if hsh(seed, i, 1) < 0.6 else -1
        steps = int(length * (0.7 + 0.6 * hsh(seed, i, 2)))
        for s in range(steps):
            out[(x, y)] = s
            r = hsh(seed, i, s, 3)
            if r < 0.45:
                y += diry
            elif r < 0.8:
                x += dirx
                y += diry
            else:
                x += dirx
            if hsh(seed, i, s, 4) < 0.08:
                dirx = -dirx
            if (x, y) not in inner:
                x -= dirx
                if (x, y) not in inner:
                    break
            # a branch now and then on higher tiers
            if tier >= 3 and s == steps // 2:
                bx, by = x, y
                for b in range(int(steps * 0.4)):
                    bx -= dirx if hsh(seed, i, b, 5) < 0.6 else 0
                    by += diry
                    if (bx, by) not in inner:
                        break
                    out[(bx, by)] = s + b
    kept = {}
    for (x, y), s in sorted(out.items(), key=lambda kv: kv[1]):
        if any(all(((x + ax, y + ay) in kept) for ax, ay in sq) for sq in
               (((1, 0), (0, 1), (1, 1)), ((-1, 0), (0, 1), (-1, 1)), ((1, 0), (0, -1), (1, -1)),
                ((-1, 0), (0, -1), (-1, -1)))):
            continue
        kept[(x, y)] = s
    for (x, y), s in kept.items():
        if tier == 1:
            c = "GOLD_DK"
        elif tier == 2:
            c = "GOLD" if s % 3 == 1 else "GOLD_DK"
        elif tier == 3:
            c = "GOLD"
        elif tier == 4:
            c = "SUN" if s % 7 == 0 else "GOLD"
        else:
            c = "SUN" if s % 4 == 0 else "GOLD"
        grid[(x, y)] = c


def plinth(p: Pen, cx: int, top: int, w: int, hgt: int, tier: int, plaque=True):
    """Dark stone plinth: cap (top face visible), body, base. t5 gilds the edges."""
    cap_w, body_w = w, w - 4
    xl, xr = cx - cap_w // 2, cx + cap_w // 2
    bl, br = cx - body_w // 2, cx + body_w // 2
    cap_h = max(3, round(hgt * 0.18))
    base_h = max(2, round(hgt * 0.14))
    y_body = top + cap_h
    y_base = top + hgt - base_h
    # cap top face (2 rows) + cap front
    p.rect(xl, top, xr, top + 1, "BROWN_1")
    p.line((xl + 1, top), (xr - 1, top), "RIM" if tier < 5 else "GOLD")
    p.rect(xl, top + 2, xr, y_body - 1, "BROWN_0")
    p.line((xl, top + 2), (xr, top + 2), "BROWN_2")
    # body
    p.rect(bl, y_body, br, y_base - 1, "BROWN_0")
    p.rect(br - max(2, body_w // 6), y_body, br, y_base - 1, "INK")
    p.rect(bl, y_body, bl, y_base - 1, "BROWN_1")
    p.line((bl, y_body), (br, y_body), "INK")
    # base
    p.rect(xl, y_base, xr, top + hgt - 1, "INK")
    p.line((xl, y_base), (xr, y_base), "BROWN_1")
    p.line((xl, top + hgt - 1), (xr, top + hgt - 1), "VOID")
    # stone texture
    for x, y in p.each((bl + 1, y_body + 1, br - 1, y_base - 2)):
        if p.get(x, y) == "BROWN_0" and hsh(51, x, y) < 0.07:
            p.px(x, y, "BROWN_1")
    if tier >= 5:
        for y in (top + 2, y_base):
            p.line((xl, y), (xr, y), "GOLD_DK")
            for x in range(xl, xr + 1, 3):
                p.px(x, y, "GOLD")
        p.line((xl, top), (xr, top), "GOLD")
        p.line((xl, top + 1), (xr, top + 1), "GOLD_DK")
        p.line((bl, y_body), (bl, y_base - 1), "GOLD_DK")
    if plaque:
        pw = max(9, body_w // 3 + (1 if (body_w // 3) % 2 == 0 else 0))
        ph = max(4, round(hgt * 0.2))
        py = y_body + max(2, round((y_base - y_body - ph) * 0.35))
        p.rect(cx - pw // 2, py, cx + pw // 2, py + ph - 1, "GOLD_DK")
        p.line((cx - pw // 2, py), (cx + pw // 2, py), "AMBER")
        for x in range(cx - pw // 2 + 2, cx + pw // 2 - 1):
            if x % 2 == 0:
                p.px(x, py + 2, "BROWN_0")
        if ph >= 6:
            for x in range(cx - pw // 2 + 2, cx + pw // 2 - 2):
                if x % 3:
                    p.px(x, py + 4, "BROWN_0")
        p.px(cx + pw // 2, py + ph - 1, "BROWN_0")


def statue(tier: int) -> Pen:
    p = Pen(SX0, SY0, SX0 + 35, SY0 + 80, layer=4)
    W, H = 36, 62
    masks = figure_masks(1.0, W, H, 18.0, 0.0)
    grid, full = shade_figure(masks, W, H)
    veins(full, grid, tier, 1.0)
    for (x, y), c in grid.items():
        p.px(SX0 + x, SY0 + y, c)
    plinth(p, SCX, SY0 + 62, 31, 19, tier)
    return p


def statue_closeup(tier: int) -> Pen:
    k = 1.55
    W, H = 64, round(62 * k) + 2
    hgt = 26
    p = Pen(0, 0, W - 1, H + hgt - 1, layer=6)
    masks = figure_masks(k, W, H, W / 2, 1.0)
    grid, full = shade_figure(masks, W, H)
    veins(full, grid, tier, k, seed=2)
    for (x, y), c in grid.items():
        p.px(x, y, c)
    plinth(p, W // 2, H, 50, hgt, tier)
    return p


STATUE_FOOT = None  # set after drawing: plinth pixels (for the rug cut-out)


def rug(t: int) -> Pen:
    p = Pen(236, 222, 316, 235, layer=4)
    y0, y1 = 222, 235

    def edges(y, xl0=236, xr0=316):
        k = (y - 121) / (y1 + 0.5 - 121)
        return 320 + (xl0 - 320) * k, 320 + (xr0 - 320) * k

    def lit(x, y):
        return shell_at(x, y, 4) in ("TERRA_1", "TERRA_2", "RIM", "GLOW", "AMBER", "ORANGE")

    if t == 1:
        # a thin woven mat, smaller, plain
        for y in range(225, 234):
            xl, xr = edges(y, 248, 304)
            for x in range(math.ceil(xl), int(xr) + 1):
                edge = y in (225, 233) or x in (math.ceil(xl), int(xr))
                c = "BROWN_1" if edge else ("BROWN_2" if (x + y) % 4 == 0 else "BROWN_1")
                if lit(x, y):
                    c = {"BROWN_1": "BROWN_2", "BROWN_2": "TERRA_1"}[c]
                p.px(x, y, c)
        return p
    for y in range(y0, y1 + 1):
        xl, xr = edges(y)
        for x in range(math.ceil(xl), int(xr) + 1):
            u = (x - xl) / (xr - xl)
            v = (y - y0) / (y1 - y0)
            border = u < 0.06 or u > 0.94 or v < 0.12 or v > 0.86
            inner_b = (0.09 < u < 0.11 or 0.89 < u < 0.91) and 0.15 < v < 0.83
            c = "PLUM_0"
            if u < 0.025 or u > 0.975 or v < 0.05 or v > 0.93:
                c = "INK"
            elif border:
                c = "TERRA_0" if (x // 2 + y) % 3 else "ROSE_0"
            elif inner_b:
                c = "ROSE_0"
            else:
                # kilim diamonds across the field
                du = abs(((u - 0.5) * 6) % 2 - 1)
                dv = abs(v - 0.5) * 2.2
                dd = du + dv
                if dd < 0.3:
                    c = "GOLD_DK" if t >= 5 else "TERRA_1"
                elif dd < 0.55:
                    c = "TERRA_0"
                elif dd < 0.72 and t >= 5:
                    c = "ROSE_0"
            if lit(x, y):
                c = {"PLUM_0": "PLUM_1", "TERRA_0": "TERRA_1", "ROSE_0": "ROSE_1", "TERRA_1": "TERRA_2",
                     "GOLD_DK": "GOLD", "INK": "BROWN_2"}.get(c, c)
            p.px(x, y, c)
        # front fringe
    if t >= 5:
        xl, xr = edges(y1)
        for x in range(math.ceil(xl), int(xr) + 1, 2):
            p.px(x, y1, "ROSE_1" if hsh(61, x) < 0.5 else "ROSE_0")
    # the window's mullion shadow and the statue's cast shadow across the rug
    for y in range(229, y1 + 1):
        for x in range(259, 292):
            sx = x + round((y - 229) * 0.45)
            if 262 <= sx <= 290 and p.get(x, y):
                c = p.get(x, y)
                p.px(x, y, {"TERRA_1": "TERRA_0", "TERRA_2": "TERRA_1", "ROSE_1": "ROSE_0", "ROSE_0": "BROWN_2",
                            "BROWN_2": "BROWN_0", "TERRA_0": "BROWN_0", "GOLD": "GOLD_DK", "PLUM_1": "PLUM_0",
                            "PLUM_0": "INK", "GOLD_DK": "BROWN_2"}.get(c, c))
    # cut out the plinth footprint (the statue is drawn first; the rug must not cover its base)
    if STATUE_FOOT:
        for x, y in STATUE_FOOT:
            p.px(x, y, None)
    return p


DOG_X, DOG_Y1 = 307, 221  # dog sprite left, bottom row (must stay above the L4 floor band at y 222)


DOG_BODY = {0: (9, 15), 1: (7, 17), 2: (5, 19), 3: (4, 20), 4: (3, 21), 5: (3, 21), 6: (3, 21), 7: (3, 21),
            8: (3, 21), 9: (3, 21), 10: (4, 20)}
DOG_HEAD = {4: (1, 4), 5: (0, 5), 6: (0, 6), 7: (-1, 6), 8: (-1, 6), 9: (0, 6), 10: (0, 6)}


def dog(breath: int = 0, wag: bool = False) -> Pen:
    """A black dog curled up asleep in the sunbeam, about 22 px long: head down on its paws at the left, body a
    rounded loaf, tail wrapped along the front. breath=1 lifts the back 1 px; wag lifts the tail."""
    x0, yb = DOG_X, DOG_Y1
    p = Pen(x0 - 2, yb - 12, x0 + 25, yb, layer=3)
    top = yb - 10  # row 0 of the grids

    def body_rows():
        for r, (a, b) in DOG_BODY.items():
            yield r, a, b
        if breath:  # the back rises: one extra row over the middle of the loaf
            yield -1, 10, 15
    # body
    for r, a, b in body_rows():
        for c in range(a, b + 1):
            p.px(x0 + c, top + r, "BROWN_0")
    # head (in front of the body)
    for r, (a, b) in DOG_HEAD.items():
        for c in range(a, b + 1):
            p.px(x0 + c, top + r, "BROWN_0")
    # light: the window is behind, the sunbeam is on the floor around it
    rim_px = []
    for x, y in p.each():
        if p.get(x, y) and p.get(x, y - 1) is None:
            rim_px.append((x, y))
    for x, y in rim_px:
        p.px(x, y, "RIM")
        if p.get(x, y + 1) == "BROWN_0":
            p.px(x, y + 1, "BROWN_2")
        if p.get(x, y + 2) == "BROWN_0" and hsh(91, x) < 0.5:
            p.px(x, y + 2, "BROWN_1")
    # the sunbeam warms the window-facing (left) flank of the loaf
    for y in range(top + 3, yb):
        for x in range(x0 + 3, x0 + 9):
            if p.get(x, y) == "BROWN_0" and p.get(x - 1, y) is None:
                p.px(x, y, "TERRA_0")
    for c in range(3, 21):
        p.px(x0 + c, yb, "INK")
    # rump curve: a lit edge where the hind leg folds
    for (x, y) in ((14, 4), (13, 5), (13, 6), (14, 7), (15, 7)):
        p.px(x0 + x, top + y, "BROWN_2")
    p.px(x0 + 16, top + 4, "BROWN_2")
    # head features: ear flopped back (black), closed eye, grey muzzle, nose, paws
    for (x, y) in ((3, 5), (4, 5), (5, 5), (4, 6), (5, 6), (4, 7), (5, 7), (5, 8)):
        p.px(x0 + x, top + y, "INK")
    p.px(x0 + 3, top + 4, "RIM")
    p.px(x0 + 1, top + 6, "INK")
    p.px(x0 + 2, top + 6, "INK")
    for (x, y) in ((-1, 7), (0, 7), (-1, 8), (0, 8), (1, 8), (0, 9), (1, 9)):
        p.px(x0 + x, top + y, "ROSE_0")
    p.px(x0 - 2, top + 8, "INK")
    p.px(x0 - 1, top + 7, "ROSE_1")
    for (x, y) in ((0, 10), (1, 10), (2, 10), (3, 10)):
        p.px(x0 + x, top + y, "ROSE_0")
    p.px(x0 + 4, top + 10, "BROWN_0")
    # collar with a brass tag
    for y in (6, 7, 8):
        p.px(x0 + 6, top + y, "CRT_0")
    p.px(x0 + 7, top + 9, "GOLD_DK")
    # tail
    if wag:
        for (x, y, c) in ((21, 6, "BROWN_0"), (22, 5, "BROWN_0"), (23, 4, "BROWN_2"), (23, 3, "BROWN_2"),
                          (24, 2, "RIM"), (22, 4, "RIM"), (24, 3, "BROWN_0")):
            p.px(x0 + x, top + y, c)
    else:
        for c in range(9, 21):
            p.px(x0 + c, top + 9, "BROWN_2" if c > 10 else "ROSE_0")
        p.px(x0 + 8, top + 9, "ROSE_0")
        p.px(x0 + 20, top + 8, "BROWN_2")
    return p


def dogbowl() -> Pen:
    p = Pen(338, 210, 350, 221, layer=3)
    p.ell(339, 215, 348, 220, "INK")
    p.ell(339, 215, 348, 218, "BROWN_1", only="INK")
    p.line((340, 215), (347, 215), "ROSE_0")
    p.line((341, 216), (346, 216), "SLATE_0")
    p.px(342, 216, "RIM")
    p.line((340, 220), (347, 220), "VOID")
    return p


def chewtoy() -> Pen:
    p = Pen(240, 208, 254, 221, layer=3)
    # a chewed rope toy: two knots and a twisted rope
    p.circ(243, 217, 2, "ROSE_0")
    p.circ(251, 215, 2, "TERRA_1")
    p.line((244, 216), (250, 215), "ROSE_1")
    p.line((244, 217), (250, 216), "TERRA_0")
    p.px(242, 215, "RIM")
    p.px(250, 213, "RIM")
    p.line((241, 220), (253, 218), "BROWN_0")
    return p


# ============================================================================================ BUILD
def main():
    global STATUE_FOOT
    gym, room = "gym", "room"
    # ---------------- gym hotspots
    st = {k: strength(k) for k in (0, 1, 2)}
    rn = {k: running(k) for k in (0, 1, 2)}
    bk = {"base": bike_covered(None), "s0": bike_covered(0), "s1": bike_covered(1), "s2": bike_covered(2),
          "awake": bike_awake()}
    # ---------------- gym decor
    fl = {f"t{t}": flooring(t) for t in (1, 3, 5)}
    fl["base"] = fl["t3"]
    po = {f"t{t}": poster(t) for t in (1, 3, 5)}
    po["base"] = po["t3"]
    tr = {f"t{t}": trophies(t) for t in (1, 3, 5)}
    tr["base"] = tr["t3"]
    shelf = protein_shelf()
    spk = speaker()
    tim = timer()
    mir = mirror()
    tow = towel()
    jr = jumprope()
    fan = boxfan()
    duf = duffel()
    kb = kettlebell()
    fr = foamroller()
    ym = yogamat()
    bt = bottle()
    bx = benchbox()
    cb = cables()
    led = ledstrip()
    ph = phone()
    # local lights: the LED strip under the protein shelf washes the wall and the trophies below it;
    # the speaker's LEDs; the power strip's switch
    sx, sy = P(18.05, 0.0, SHELF_H - 0.45)
    glow(shelf, [shelf] + list(tr.values()), sx, sy, 24, 12, WARM_SOFT, strength=0.8)
    glow(spk, [spk], *P(14.75, 0.45, 0.75), 8, 6, WARM_SOFT, strength=0.7)

    # ---------------- centre
    sta = {f"t{t}": statue(t) for t in (1, 2, 3, 4, 5)}
    sta["base"] = sta["t1"]
    foot = set()
    s1 = sta["t1"]
    for x, y in s1.each((SX0, SY0 + 62, SX0 + 35, SY0 + 80)):
        if s1.get(x, y) is not None:
            foot.add((x, y))
    STATUE_FOOT = foot
    rg = {f"t{t}": rug(t) for t in (1, 3, 5)}
    rg["base"] = rg["t3"]
    close = {f"t{t}": statue_closeup(t) for t in (1, 2, 3, 4, 5)}
    close["base"] = close["t1"]
    dg0, dg1, dgw = dog(0), dog(1), dog(0, wag=True)

    # ---------------- save + declare (declaration order breaks contact-y ties)
    def sv(pens: dict, name: str) -> dict:
        return {k: v.save(f"{name}-{k}") for k, v in pens.items()}

    def one(pen: Pen, name: str) -> dict:
        return {"base": pen.save(name)}

    report = {}

    def chk(id_, pens):
        for k, v in pens.items():
            n = band_overlap(v)
            if n:
                report[f"{id_}:{k}"] = n

    def put(id_, zone, kind, pens: dict, name, **kw):
        chk(id_, pens)
        first = next(iter(pens.values()))
        reg(id_, sv(pens, name) if len(pens) > 1 or "base" not in pens else one(first, name),
            zone=zone, kind=kind, layer=first.layer, x=first.ox, y=first.oy, **kw)

    # gym: wall and floor decor first, then the hotspots
    put("gym.flooring", gym, "decor", fl, "gym-flooring",
        note="floor under the bench: t1 one thin exercise mat on the bare tiles, t3 rubber gym tiles, "
             "t5 rubber tiles with a wooden lifting-platform inlay and a brass edge")
    put("gym.shelf", gym, "decor", {"base": shelf}, "gym-shelf",
        note="high wall shelf: three protein tubs, a small pre-workout tub, a shaker bottle, amber LED strip "
             "washing the wall below")
    put("gym.speaker", gym, "decor", {"base": spk}, "gym-speaker",
        note="bluetooth speaker lying on the protein shelf, red and amber status LEDs")
    put("gym.poster", gym, "decor", po, "gym-poster",
        note="runner poster above the rack (silhouette mid-stride against a red sun): t1 printout taped up, "
             "t3 framed print, t5 framed with a brass picture light")
    put("gym.timer", gym, "decor", {"base": tim}, "gym-timer",
        note="interval timer on the wall showing 0:45 in red LED digits, red glow on the wall, cord down")
    put("gym.mirror", gym, "decor", {"base": mir}, "gym-mirror",
        note="tall wall mirror on the front of the right wall, a warm diagonal streak of the sunset")
    put("gym.towel", gym, "decor", {"base": tow}, "gym-towel",
        note="terracotta gym towel folded over a wall hook beside the running shelf")
    put("gym.jumprope", gym, "decor", {"base": jr}, "gym-jumprope",
        note="jump rope with red handles and two resistance bands (plum, green) on a hook")
    put("gym.trophies", gym, "decor", tr, "gym-trophies",
        note="front wall: t1 two medals on a nail, t3 small shelf with a trophy and two medals, t5 a lit glass "
             "display case with medals and trophies")
    put("gym.fan", gym, "decor", {"base": fan}, "gym-fan",
        note="box fan on the front floor angled at the bench, amber knob light, cord to the wall outlet")
    put("gym.duffel", gym, "decor", {"base": duf}, "gym-duffel",
        note="black gym duffel with a terracotta stripe slumped on the front floor")
    put("gym.yogamat", gym, "decor", {"base": ym}, "gym-yogamat",
        note="rolled green yoga mat with a strap, leaning in the back of the gym")
    put("gym.kettlebell", gym, "decor", {"base": kb}, "gym-kettlebell",
        note="black kettlebell on the floor by the bench's back end")
    put("gym.box", gym, "decor", {"base": bx}, "gym-box",
        note="cardboard box of supplements pushed under the bench")
    put("gym.cables", gym, "decor", {"base": cb}, "gym-cables",
        note="speaker and fan cords to the wall outlet, an extension cord snaking across the floor to a "
             "red-lit power strip")
    # hotspots
    put("gym.strength", gym, "hotspot", st and {f"s{k}": v for k, v in st.items()}, "gym-strength",
        target={"skill": "strength"}, label="STRENGTH", led=list(Pi(BENCH[1], 0.85, 1.36)),
        note="wall dumbbell rack over a flat bench: s0 a few light neoprene dumbbells, s1 a fuller rack of hex "
             "dumbbells, s2 heavy hex dumbbells, plates leaning on the wall and a chalk bucket")
    put("gym.phone", gym, "decor", {"base": ph}, "gym-phone",
        note="phone lying on the bench, a workout timer glowing on its screen")
    put("gym.foamroller", gym, "decor", {"base": fr}, "gym-foamroller",
        note="plum foam roller lying on the floor in front of the bench")
    put("gym.bottle", gym, "decor", {"base": bt}, "gym-bottle",
        note="plum water bottle standing on the floor by the bench")
    put("gym.ledstrip", gym, "decor", {"base": led}, "gym-ledstrip",
        note="amber LED strip under the running shelf washing the wall below it")
    put("gym.running", gym, "hotspot", {f"s{k}": v for k, v in rn.items()}, "gym-running",
        target={"skill": "running"}, label="RUNNING", led=list(Pi(13.85, 0.85, RUN_H - 0.06)),
        note="floating shoe shelf with race bibs pinned above: s0 one pair of old shoes, s1 newer shoes and a "
             "bib, s2 two pairs, three bibs and a finisher medal")
    put("gym.bike", gym, "hotspot", bk, "gym-bike",
        target={"skill": "triathlon"}, label="TRIATHLON",
        led=list(Pi((ZR + ZF) / 2 + 0.3, 1.0, AH - 0.2)),
        note="road bike hung on wall hooks above the rack under a grey dust sheet (s0 heavy dust, s1 lighter "
             "dust and a cycling cap on a nail, s2 sheet pulled back off the front wheel, helmet hanging); "
             "awake: sheet off, clean red bike, helmet on the bars")
    # centre
    put("centre.dog", room, "decor", {"base": dg0, "wag": dgw}, "centre-dog",
        note="the dog curled up asleep in the sunbeam, collar with a tag; anim: slow breathing; wag: tail up")
    ITEMS[-1]["anim"] = {"frames": [ITEMS[-1]["variants"]["base"], dg1.save("centre-dog-breath")], "fps": 2}
    put("centre.bowl", room, "decor", {"base": dogbowl()}, "centre-bowl",
        note="the dog's water bowl near the TV stand")
    put("centre.toy", room, "decor", {"base": chewtoy()}, "centre-toy",
        note="a chewed rope toy left on the floor by the rug")
    put("centre.statue", room, "hotspot", sta, "centre-statue",
        target={"feature": "overall"}, label="FORGE", led=[284, 224],
        note="obsidian figure in contrapposto on a dark plinth with a brass plaque; gold kintsugi veins spread "
             "with room tier (t1 hairlines in GOLD_DK ... t5 veins in GOLD and SUN, gilded plinth edge)")
    put("centre.rug", room, "decor", rg, "centre-rug",
        note="rug under the statue: t1 a thin plain mat, t3 kilim with diamonds, t5 kilim with gold diamonds "
             "and a fringe; carries the sunbeam and the statue's shadow")
    put("centre.statue-closeup", room, "overlay", close, "centre-statue-closeup",
        note="large close-up of the statue for the statue panel only (UI), t1..t5 like the room statue")

    for it in ITEMS:
        item(it.pop("id"), **it)
    finish(PART)
    if report:
        print("WARNING band overlaps (pixels hidden by a higher shell band):", report)
    else:
        print("band overlaps: none")


if __name__ == "__main__":
    main()
