#!/usr/bin/env python3
"""FORGE v3 room, part "left": the left wall. Zone kitchen (key 1) and zone bed (key 2).

Kitchen (front of the left wall, x -80..100): door with a corkboard (COLLEGE INTEGRATION), doormat (REVIEW,
alert letter), a tiny switchboard low by the door (SETTINGS), the mini fridge with hot plate and kettle (FOOD),
plus shoe rack, coat hooks, wall clock, microwave shelf, cart with dish rack and water jugs, trash bin,
calendar, hanging plant, broom, light switch, key bowl, welcome sign, power strip and cables.
Bed (back of the left wall, x 100..176): the bed (SLEEP, stages; frame by room tier), a bathroom scale leaning
on the bed foot (BODYWEIGHT), bedside wall shelf with alarm clock and charger, phone, poster, string lights,
plant shelf, guitar, headphones, laundry, hoodies, rug, slippers, cables.

Geometry: everything on or against the left wall is projected with P(z, d, h): z = feet along the wall from
the back corner (x 176) toward the viewer, d = feet out from the wall, h = feet above the floor. Lines parallel
to the wall follow the wall's own rake (they meet near (571, 121)); lines across the room are horizontal; heights
use the wall's scale (15.1 px per foot at the back, 136 px = 9 ft). This matches room.py's wall_point,
wall_scale and depth_scale.

Run: python3 art/room/left/build.py      (deterministic: no global RNG, only fixed hashes and Bayer)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

from PIL import Image  # noqa: E402

PART = "left"
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


# =============================================================== projection
D = 50.0  # feet from the eye to the back wall (sets how fast the wall foreshortens)
K = 0.55  # lateral (out-of-wall) foreshortening: the raked wall is drawn opened up, so depth reads shallower
PXF = 136 / 9  # px per foot at the back wall
WX = 397.42  # wall-bottom run in x per unit of scale (from the 0.19375 rake)
EYE = 77 / PXF  # eye height in feet (horizon)


def S(z: float) -> float:
    return D / (D - z)


def XW(s: float) -> float:
    return 176 - WX * (s - 1)


def P(z: float, d: float = 0.0, h: float = 0.0) -> tuple[float, float]:
    s = S(z)
    return XW(s) + 15 * K * d * s, 121 + 77 * s - PXF * h * s


def Pi(z, d=0.0, h=0.0) -> tuple[int, int]:
    x, y = P(z, d, h)
    return round(x), round(y)


def inv_side(x, y, d):
    s = (176 + WX - x) / (WX - 15 * K * d)
    if s <= 0.2:
        return None
    return D * (1 - 1 / s), (121 + 77 * s - y) / (PXF * s)


def inv_front(x, y, z):
    s = S(z)
    return (x - XW(s)) / (15 * K * s), (121 + 77 * s - y) / (PXF * s)


def inv_top(x, y, h):
    den = 77 - PXF * h
    s = (y - 121) / den
    if s <= 0.2:
        return None
    return D * (1 - 1 / s), (x - XW(s)) / (15 * K * s)


# =============================================================== pen
class Pen:
    """World-space pen on a palette-locked sprite. Colours are palette NAMES."""

    def __init__(self, x0: int, y0: int, x1: int, y1: int):
        self.ox, self.oy = x0, y0
        self.w, self.h = x1 - x0 + 1, y1 - y0 + 1
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
        if not self.inside(round(x), round(y)):
            return None
        v = self.s.get(round(x) - self.ox, round(y) - self.oy)
        return None if v is None else RGB2N[tuple(v[:3])]

    def line(self, a, b, n, only=None):
        self.s.line(a[0] - self.ox, a[1] - self.oy, b[0] - self.ox, b[1] - self.oy, HEX[n], only=self.o(only))

    def rect(self, x0, y0, x1, y1, n, fill=True, only=None):
        self.s.rect(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, HEX[n], fill=fill, only=self.o(only))

    def poly(self, pts, n, only=None):
        self.s.polygon([(round(x) - self.ox, round(y) - self.oy) for x, y in pts], HEX[n], only=self.o(only))

    def ell(self, x0, y0, x1, y1, n, only=None):
        self.s.ellipse(x0 - self.ox, y0 - self.oy, x1 - self.ox, y1 - self.oy, HEX[n], only=self.o(only))

    def circ(self, cx, cy, r, n, fill=True, only=None):
        self.s.circle(cx - self.ox, cy - self.oy, r, HEX[n], fill=fill, only=self.o(only))

    def sag(self, a, b, sag, n, only=None):
        x0, y0 = a
        x1, y1 = b
        steps = max(2, int(abs(x1 - x0)))
        pts = [(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t + 4 * sag * t * (1 - t)))
               for t in (i / steps for i in range(steps + 1))]
        for p, q in zip(pts, pts[1:]):
            self.line(p, q, n, only=only)
        return pts

    def bbox_of(self, pts):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (max(self.ox, int(min(xs)) - 1), max(self.oy, int(min(ys)) - 1),
                min(self.ox + self.w - 1, int(max(xs)) + 1), min(self.oy + self.h - 1, int(max(ys)) + 1))

    def opaque(self, x, y):
        return self.get(x, y) is not None

    def recolor(self, mapping, box=None, prob=1.0, seed=0):
        x0, y0, x1, y1 = box or (self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c in mapping and (prob >= 1 or hsh(seed, x, y) < prob):
                    self.px(x, y, mapping[c])

    def save(self, name: str) -> str:
        return save(self.s, f"{PART}/{name}")


# =============================================================== faces
def face(pen: Pen, kind: str, c: float, a0, a1, b0, b1, col, only=None):
    """Fill one plane rectangle.
    kind 'side': plane parallel to the wall at d = c, a = z, b = h.
    kind 'front': plane facing the viewer at z = c, a = d, b = h.
    kind 'top': horizontal plane at h = c, a = z, b = d.
    col: palette name, or fn(a, b, x, y) -> name | None."""
    if kind == "side":
        corners = [P(a0, c, b0), P(a1, c, b0), P(a1, c, b1), P(a0, c, b1)]
    elif kind == "front":
        corners = [P(c, a0, b0), P(c, a1, b0), P(c, a1, b1), P(c, a0, b1)]
    else:
        corners = [P(a0, b0, c), P(a1, b0, c), P(a1, b1, c), P(a0, b1, c)]
    x0, y0, x1, y1 = pen.bbox_of(corners)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if kind == "side":
                r = inv_side(x + 0.5, y + 0.5, c)
                if r is None:
                    continue
                a, b = r
            elif kind == "front":
                a, b = inv_front(x + 0.5, y + 0.5, c)
            else:
                r = inv_top(x + 0.5, y + 0.5, c)
                if r is None:
                    continue
                a, b = r
            if a0 <= a <= a1 and b0 <= b <= b1:
                n = col(a, b, x, y) if callable(col) else col
                if n:
                    pen.px(x, y, n, only=only)


def box(pen, z0, z1, d0, d1, h0, h1, front, side, top, rim="RIM", edge="INK", rimfront=True):
    """A box against (or near) the left wall. side = room-facing face (lit), front = viewer-facing face (shade)."""
    face(pen, "side", d1, z0, z1, h0, h1, side)
    if h1 < EYE:
        face(pen, "top", h1, z0, z1, d0, d1, top)
    face(pen, "front", z1, d0, d1, h0, h1, front)
    if edge:
        pen.line(Pi(z1, d0, h0), Pi(z1, d0, h1), edge)  # front-left silhouette
        pen.line(Pi(z1, d0, h0), Pi(z1, d1, h0), edge)  # front bottom
    if rim:
        pen.line(Pi(z0, d1, h1), Pi(z1, d1, h1), rim)  # lit top edge of the room face
        if rimfront:
            a, b = Pi(z1, d1, h1), Pi(z1, d1, h1 - min(0.5, (h1 - h0) * 0.5))
            pen.line(a, b, rim)


def contact_shadow(pen, z0, z1, d0, d1, n="VOID"):
    """1 px dark line where a floor object meets the floor (front and room side)."""
    pen.line(Pi(z1, d0, 0), Pi(z1, d1, 0), n)
    pen.line(Pi(z0, d1, 0), Pi(z1, d1, 0), n)


class Tex:
    """A flat texel grid of colour names, painted frontally then mapped onto a raked plane."""

    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.g = [[fill] * w for _ in range(h)]

    def px(self, x, y, n):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = n

    def rect(self, x0, y0, x1, y1, n, fill=True):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if fill or x in (x0, x1) or y in (y0, y1):
                    self.px(x, y, n)

    def line(self, x0, y0, x1, y1, n):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, n)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def text(self, x, y, s, n):
        for ch in s:
            g = FONT.get(ch)
            if g:
                for j, row in enumerate(g):
                    for i, b in enumerate(row):
                        if b == "1":
                            self.px(x + i, y + j, n)
            x += 4

    def at(self, u, v):
        return self.g[min(self.h - 1, max(0, int(v * self.h)))][min(self.w - 1, max(0, int(u * self.w)))]


def wall_tex(pen, z0, z1, h0, h1, tex: Tex, d=0.0, only=None):
    """Map a Tex onto the plane parallel to the wall at offset d; texel (0,0) = top-left as the viewer sees it
    (front end z1 at the left, top h1)."""
    def fn(z, h, x, y):
        return tex.at((z1 - z) / (z1 - z0), (h1 - h) / (h1 - h0))
    face(pen, "side", d, z0, z1, h0, h1, fn, only=only)


def wall_text(pen, x_left, z_ref, h_top, text, n, d=0.0):
    """Write 3x5 text on a raked plane without resampling: glyph columns sit on consecutive screen columns
    starting at x_left, each column dropped to the plane's line at height h_top."""
    x = x_left
    for ch in text:
        g = FONT.get(ch)
        if g:
            for i in range(len(g[0])):
                cx = x + i
                z, _ = inv_side(cx + 0.5, 0, d)
                _, yy = P(z, d, h_top)
                for j in range(5):
                    if g[j][i] == "1":
                        pen.px(cx, round(yy) + j, n)
            x += len(g[0]) + 1
        else:
            x += 4


def wall_size(z0, z1, h0, h1):
    """Approximate pixel size (w, h) of a wall rectangle, for authoring a Tex at about 1:1."""
    (xa, ya), (xb, yb) = P(z0, 0, h0), P(z1, 0, h0)
    (_, ya2), (_, yb2) = P(z0, 0, h1), P(z1, 0, h1)
    return max(2, round(abs(xa - xb))), max(2, round(((ya - ya2) + (yb - yb2)) / 2))


FONT = {
    "W": ["101", "101", "101", "111", "101"], "E": ["111", "100", "110", "100", "111"],
    "L": ["100", "100", "100", "100", "111"], "C": ["011", "100", "100", "100", "011"],
    "O": ["010", "101", "101", "101", "010"], "M": ["101", "111", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"], "R": ["110", "101", "110", "101", "101"],
    "U": ["101", "101", "101", "101", "111"], "F": ["111", "100", "110", "100", "100"],
    "H": ["101", "101", "111", "101", "101"], "S": ["011", "100", "010", "001", "110"],
    "T": ["111", "010", "010", "010", "010"], "A": ["010", "101", "111", "101", "101"],
    "N": ["1001", "1101", "1011", "1001", "1001"], "G": ["011", "100", "101", "101", "011"],
    "1": ["010", "110", "010", "010", "111"], "7": ["111", "001", "010", "010", "010"],
    "0": ["111", "101", "101", "101", "111"], "2": ["110", "001", "010", "100", "111"],
}

# =============================================================== shell sample (for light tints)
SHELL = Image.new("RGBA", (800, 480), (0, 0, 0, 0))
_smf = ROOT / "art" / "room" / "shell" / "manifest.json"
if _smf.exists():
    import json as _json

    for _it in _json.loads(_smf.read_text())["items"]:
        if _it["kind"] == "shell" and _it["layer"] >= 2:
            _p = OUT.parent / _it["variants"]["base"]
            if _p.exists():
                SHELL.alpha_composite(Image.open(_p).convert("RGBA"), (_it["x"] + 80, _it["y"] + 96))


def shell_at(x, y):
    if not (0 <= x + 80 < 800 and 0 <= y + 96 < 480):
        return None
    r, g, b, a = SHELL.getpixel((x + 80, y + 96))
    return RGB2N.get((r, g, b)) if a else None


WARM = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2",
        "BROWN_2": "TERRA_1", "TERRA_0": "TERRA_1", "TERRA_1": "TERRA_2", "ROSE_0": "ROSE_1", "PLUM_0": "PLUM_1",
        "SLATE_0": "ROSE_0", "LEAF_0": "LEAF_1", "LEAF_1": "LEAF_2", "GOLD_DK": "GOLD"}
WARM2 = {"VOID": "BROWN_2", "INK": "BROWN_2", "INK_COOL": "BROWN_2", "BROWN_0": "TERRA_1", "BROWN_1": "TERRA_1",
         "BROWN_2": "TERRA_2", "TERRA_0": "TERRA_2", "TERRA_1": "AMBER", "ROSE_0": "ROSE_1", "PLUM_0": "PLUM_1"}
RED = {"VOID": "BROWN_0", "INK": "BROWN_0", "INK_COOL": "BROWN_0", "BROWN_0": "TERRA_0", "BROWN_1": "TERRA_0",
       "BROWN_2": "TERRA_0", "TERRA_0": "CRT_0", "ROSE_0": "ROSE_1"}

GLOWS: list[tuple] = []  # (pen, cx, cy, r, mapping, inner_r, inner_mapping, x_max) applied after all pens exist


WASHES: list[tuple] = []  # (pen, z0, z1, h_top, rows) light falling down the wall from a strip


def wash(pen, z0, z1, h_top, rows=(WARM2, WARM2, WARM, WARM, WARM, "half")):
    WASHES.append((pen, z0, z1, h_top, rows))


def glow(pen, cx, cy, r, mapping=WARM, inner=0, inner_map=WARM2, xmax=175, own=True, sy=1.0):
    GLOWS.append((pen, cx, cy, r, mapping, inner, inner_map, xmax, own, sy))


# =============================================================== registry
PENS: dict[str, dict[str, Pen]] = {}
ITEMS: list[dict] = []


def reg(id_, variants: dict[str, Pen], **kw):
    PENS[id_] = variants
    ITEMS.append(dict(id=id_, **kw))


def pens_for(x0, y0, x1, y1, keys):
    return {k: Pen(x0, y0, x1, y1) for k in keys}


# ============================================================================================ BED ZONE
BZ0, BZ1, BW = 0.25, 6.55, 2.7  # bed along the wall (head at the back corner), width out from the wall
HB, HM = 0.8, 1.75  # top of the box spring / rail, top of the mattress
BED_BOX = (110, 118, 202, 209)  # frame bbox; contact 210


def bed_frame(t: int) -> Pen:
    p = Pen(*BED_BOX)
    if t == 1:
        # box spring straight on the floor: the "mattress on the floor" look
        box(p, BZ0, BZ1, 0, BW, 0, HB, "BROWN_1", lambda z, h, x, y: "ROSE_0" if h > HB - 0.1 else "BROWN_2",
            "BROWN_2", rim="TERRA_1")
        p.line(Pi(BZ1, 0, 0.02), Pi(BZ1, BW, 0.02), "VOID")
        face(p, "side", BW, BZ0, BZ1, 0.3, 0.36, "BROWN_1")
        contact_shadow(p, BZ0, BZ1, 0, BW)
        # a pillow propped against the wall at the head, no headboard
        return p
    # under-bed darkness and rails
    face(p, "side", BW, BZ0, BZ1, 0, HB, "VOID")
    face(p, "front", BZ1, 0, BW, 0, HB, "VOID")
    if t == 2:
        rail_s, rail_f, leg, top_c = "BROWN_1", "INK", "BROWN_1", "INK"
        face(p, "side", BW, BZ0, BZ1, HB - 0.18, HB, rail_s)
        face(p, "front", BZ1, 0, BW, HB - 0.18, HB, rail_f)
        # storage bin under the bed
        face(p, "side", BW - 0.4, 2.2, 4.6, 0.02, 0.45, lambda z, h, x, y: "BROWN_2" if h > 0.38 else "BROWN_1")
        for z in (BZ0 + 0.1, 3.4, BZ1 - 0.05):
            p.line(Pi(z, BW, 0), Pi(z, BW, HB - 0.18), leg)
        p.line(Pi(BZ1, 0.1, 0), Pi(BZ1, 0.1, HB), leg)
        # metal headboard: top bar plus vertical bars, standing at the head end
        hb_top = 2.55
        p.line(Pi(BZ0, 0, hb_top), Pi(BZ0, BW, hb_top), top_c)
        p.line(Pi(BZ0, 0, hb_top + 0.07), Pi(BZ0, BW, hb_top + 0.07), "RIM")
        for d in [i * BW / 6 for i in range(7)]:
            p.line(Pi(BZ0, d, HM), Pi(BZ0, d, hb_top), "INK")
        p.line(Pi(BZ0, BW, 0), Pi(BZ0, BW, hb_top), "BROWN_1")
        p.line(Pi(BZ0, BW, HM + 0.1), Pi(BZ0, BW, hb_top), "TERRA_1")
        p.line(Pi(BZ0, 0, HB), Pi(BZ1, 0, HB), "INK")
        p.line(Pi(BZ0, BW, HB), Pi(BZ1, BW, HB), "TERRA_1")
        return p
    if t == 3:
        wood_s = lambda z, h, x, y: ("BROWN_0" if abs(h - 0.48) < 0.05 else "BROWN_1") if h > 0.2 else "VOID"
        face(p, "side", BW, BZ0, BZ1, 0.15, HB, wood_s)
        face(p, "front", BZ1, 0, BW, 0.15, HB, "BROWN_1")
        for z in (BZ0 + 0.1, BZ1 - 0.06):
            p.line(Pi(z, BW, 0), Pi(z, BW, 0.2), "BROWN_1")
        p.line(Pi(BZ1, 0.1, 0), Pi(BZ1, 0.1, 0.2), "BROWN_1")
        p.line(Pi(BZ0, BW, HB), Pi(BZ1, BW, HB), "RIM")
        p.line(Pi(BZ1, 0, 0.15), Pi(BZ1, 0, HB), "INK")
        # solid wood headboard
        hb_top = 2.45
        face(p, "front", BZ0, 0, BW + 0.05, HM - 0.1, hb_top,
             lambda d, h, x, y: "BROWN_2" if (h > hb_top - 0.14) else ("BROWN_1" if (d / 0.55) % 1 < 0.2 else "INK"))
        p.line(Pi(BZ0, 0, hb_top + 0.05), Pi(BZ0, BW + 0.05, hb_top + 0.05), "RIM")
        p.line(Pi(BZ0, BW + 0.05, HM), Pi(BZ0, BW + 0.05, hb_top), "TERRA_1")
        return p
    # t5: upholstered tall headboard, warm wood rails with brass feet
    wood_s = lambda z, h, x, y: ("TERRA_1" if h > HB - 0.12 else "TERRA_0") if h > 0.22 else "VOID"
    face(p, "side", BW, BZ0, BZ1, 0.15, HB, wood_s)
    face(p, "front", BZ1, 0, BW, 0.15, HB, "BROWN_2")
    for z in (BZ0 + 0.1, BZ1 - 0.06):
        p.line(Pi(z, BW, 0), Pi(z, BW, 0.2), "GOLD_DK")
    p.px(*Pi(BZ1 - 0.06, BW, 0.0), "GOLD")
    p.line(Pi(BZ1, 0.1, 0), Pi(BZ1, 0.1, 0.2), "GOLD_DK")
    p.line(Pi(BZ0, BW, HB), Pi(BZ1, BW, HB), "ORANGE")
    p.line(Pi(BZ1, 0, 0.15), Pi(BZ1, 0, HB), "INK")
    hb_top = 3.1

    def tuft(d, h, x, y):
        if h > hb_top - 0.1 or d > BW - 0.05:
            return "GOLD_DK"
        if (x % 4 == 1 and y % 4 == 1) or (x % 4 == 3 and y % 4 == 3):
            return "PLUM_1" if h > 2.6 else "INK"
        return "PLUM_0"
    face(p, "front", BZ0, -0.05, BW + 0.1, HM - 0.1, hb_top, tuft)
    p.line(Pi(BZ0, -0.05, hb_top + 0.05), Pi(BZ0, BW + 0.1, hb_top + 0.05), "ORANGE")
    return p


reg("bed.frame", {"t1": bed_frame(1), "t2": bed_frame(2), "t3": bed_frame(3), "t5": bed_frame(5),
                  "base": bed_frame(3)},
    zone="bed", kind="decor", layer=2,
    note="bed frame by room tier: t1 box spring on the floor, t2 black metal frame, t3 wood, t5 upholstered headboard")

# ------------------------------------------------------------------ bed (SLEEP hotspot)
BED_HS = (108, 118, 204, 211)  # contact 212: drawn after the frame and the bedside shelf
SH_Z0, SH_Z1, SH_H = 0.35, 1.6, 2.5  # bedside wall shelf


def pillow(p, zc, dc, tilt=0, lit=True, n=("ROSE_0", "ROSE_1", "BROWN_2")):
    """A pillow standing up against the head: a soft rounded block, lit on its upper right."""
    x, y = Pi(zc, dc, HM + 0.1)
    w = 6
    p.rect(x - w + 1, y - 5 + tilt, x + w - 1, y + 1, n[0])
    p.line((x - w, y - 4 + tilt), (x - w, y), n[0])
    p.line((x + w, y - 4), (x + w, y - tilt), n[0])
    p.line((x - w + 1, y - 2 + tilt), (x - w + 1, y + 1), n[2])  # shade on the left
    p.line((x - w + 1, y + 1), (x + w - 1, y + 1), n[2])
    if lit:
        p.line((x, y - 5 + tilt), (x + w - 1, y - 5 + tilt), n[1])
        p.line((x + w, y - 4), (x + w, y - 1 - tilt), "RIM")


def mattress(p, sheet_top="BROWN_2", sheet_side="BROWN_2", sheet_front="BROWN_1"):
    box(p, BZ0 + 0.05, BZ1, 0, BW, HB, HM, sheet_front, sheet_side, sheet_top, rim="TERRA_1")
    p.line(Pi(BZ1, 0, HB), Pi(BZ1, BW, HB), "INK")


def blanket(p, z_from, drape_h, ripple=0.0, seed=0, fold=0.85):
    """The comforter over the mattress from z_from to the foot, hanging over the room side and the foot.
    Flat PLUM_0 top with a lit strip on the room edge; the hanging side is PLUM_1 with fold lines."""
    def top(z, d, x, y):
        if ripple and ((x + 2 * y + seed) % 11 == 0 or (x - y + seed) % 13 == 0):
            return "INK"
        return "PLUM_1" if d > BW - 0.3 else "PLUM_0"

    def side(z, h, x, y):
        # wavy hem; folds at uneven spacing that lean with the drape
        hh = drape_h + 0.06 * ((z * 3.1) % 1 < 0.5) + (ripple * 0.3 * hsh(seed, int(z * 2.5)) if ripple else 0)
        if h < hh:
            return None
        if h < hh + 0.08:
            return "PLUM_0"
        q = z + (h - drape_h) * 0.35
        k = int(q / fold)
        if (q / fold) % 1 < 0.12 + 0.12 * hsh(seed, k) and hsh(seed + 1, k) < 0.75:
            return "PLUM_0"
        return "PLUM_1"

    def front(d, h, x, y):
        hh = drape_h + (ripple * 0.3 * hsh(seed, int(d * 3)) if ripple else 0)
        if h < hh:
            return None
        return "INK" if (d / 0.9) % 1 < 0.12 else "PLUM_0"
    face(p, "top", HM + 0.06, z_from, BZ1, -0.02, BW + 0.06, top)
    face(p, "side", BW + 0.06, z_from, BZ1 + 0.03, drape_h - 0.3, HM + 0.06, side)
    face(p, "front", BZ1 + 0.03, -0.02, BW + 0.06, drape_h - 0.3, HM + 0.06, front)
    p.line(Pi(z_from, BW + 0.06, HM + 0.06), Pi(BZ1 + 0.03, BW + 0.06, HM + 0.06), "RIM")
    p.line(Pi(BZ1 + 0.03, BW + 0.06, HM + 0.06), Pi(BZ1 + 0.03, BW + 0.06, HM - 0.3), "TERRA_1")
    p.line(Pi(z_from, -0.02, HM + 0.06), Pi(z_from, BW + 0.06, HM + 0.06), "PLUM_1")


def bed_stage(stage: int) -> Pen:
    p = Pen(*BED_HS)
    mattress(p)
    if stage == 2:
        pillow(p, 0.75, 0.75)
        pillow(p, 0.75, 1.95)
        blanket(p, 1.95, 0.95)
        # folded top sheet band and a knit throw over the foot
        face(p, "top", HM + 0.07, 1.95, 2.3, -0.02, BW + 0.06, "ROSE_0")
        p.line(Pi(2.3, 0, HM + 0.07), Pi(2.3, BW + 0.06, HM + 0.07), "BROWN_2")
        face(p, "top", HM + 0.08, 5.3, 6.0, -0.02, BW + 0.06, lambda z, d, x, y: "TERRA_1" if z < 5.45 else "TERRA_0")
        face(p, "side", BW + 0.07, 5.3, 6.0, 0.9, HM + 0.08,
             lambda z, h, x, y: "TERRA_1" if z < 5.45 else ("BROWN_2" if (z - 5.3) % 0.3 < 0.06 else "TERRA_0"))
        # bedside lamp on (sits on the wall shelf)
        lx, ly = Pi(0.95, 0.45, SH_H + 0.12)
        p.rect(lx - 1, ly - 3, lx, ly, "BROWN_1")  # base and stem
        p.poly([(lx - 3, ly - 4), (lx + 2, ly - 4), (lx + 1, ly - 8), (lx - 2, ly - 8)], "GLOW")
        p.line((lx - 2, ly - 8), (lx + 1, ly - 8), "SUN")
        p.line((lx - 3, ly - 4), (lx + 2, ly - 4), "AMBER")
        glow(p, lx, ly - 6, 15, WARM, 7, WARM2, xmax=175)
    elif stage == 1:
        pillow(p, 0.7, 0.8)
        pillow(p, 1.2, 2.0, tilt=1)
        blanket(p, 2.1, 1.0, ripple=0.8, seed=7, fold=0.7)
        # a corner of the blanket folded back: sheet showing at the outer head corner
        face(p, "top", HM + 0.07, 2.1, 3.1, 1.7, BW + 0.06, lambda z, d, x, y: "BROWN_2" if d > 1.7 + (z - 2.1) else None)
        p.line(Pi(2.1, 1.7, HM + 0.07), Pi(3.1, BW, HM + 0.07), "PLUM_1")
        # lamp off on the shelf
        lx, ly = Pi(0.95, 0.45, SH_H + 0.12)
        p.rect(lx - 1, ly - 3, lx, ly, "BROWN_1")
        p.poly([(lx - 3, ly - 4), (lx + 2, ly - 4), (lx + 1, ly - 8), (lx - 2, ly - 8)], "BROWN_1")
        p.line((lx + 1, ly - 8), (lx + 2, ly - 4), "TERRA_1")
    else:
        # sheet bare and wrinkled, one pillow at the foot, the comforter dragged off onto the floor
        face(p, "top", HM + 0.01, BZ0 + 0.05, BZ1, 0, BW,
             lambda z, d, x, y: "ROSE_0" if (x * 2 + y * 5) % 13 == 0 and d > 1.2 else
             ("BROWN_1" if (x - y * 3) % 17 == 0 else None))
        pillow(p, 0.9, 1.3, tilt=1)
        pillow(p, 5.6, 1.6, tilt=-1)
        # comforter: a swoop down the room side and a heap on the floor beside the bed
        def heap(z, h, x, y):
            if h > HM + 0.05:
                return None
            edge = 3.3 + 1.5 * (h / HM)
            if z < edge or z > edge + 2.4 - h:
                return None
            return "PLUM_0" if (z * 1.4) % 1 < 0.15 else "PLUM_1"
        face(p, "side", BW + 0.08, 2.5, BZ1, 0, HM + 0.06, heap)
        for i in range(5):
            z = 3.0 + i * 0.75
            x, y = Pi(z, BW + 0.9, 0)
            r = 4 - (i % 2)
            p.ell(x - r - 2, y - r, x + r + 2, y + 1, "PLUM_0")
            p.ell(x - r, y - r, x + r, y - 1, "PLUM_1", only="PLUM_0")
            p.line((x - r - 1, y + 1), (x + r + 2, y + 1), "VOID")
        for i in range(5):
            z = 3.0 + i * 0.75
            x, y = Pi(z, BW + 0.9, 0)
            p.line((x - 1, y - 4 + (i % 2)), (x + 3, y - 3), "RIM")
    return p


BED_LED = Pi(BZ1, BW * 0.5, 1.2)
reg("bed.bed", {"s0": bed_stage(0), "s1": bed_stage(1), "s2": bed_stage(2)},
    zone="bed", kind="hotspot", layer=2, target={"skill": "sleep"}, label="SLEEP", led=BED_LED,
    hit=(112, 160, 86, 50),
    note="the bed along the left wall: s0 bare sheet and comforter on the floor, s1 roughly made, s2 made with the lamp on")

# ------------------------------------------------------------------ bedside wall shelf (nightstand)
p = Pen(160, 140, 182, 210)  # contact 211
box(p, SH_Z0, SH_Z1, 0, 1.0, SH_H - 0.1, SH_H, "INK", "BROWN_1", "BROWN_2", rim="RIM")
bx, by = Pi(SH_Z1 - 0.15, 0.1, SH_H - 0.1)
p.line((bx, by), (bx, by + 4), "INK")  # bracket
# alarm clock, red digits
cx, cy = Pi(1.35, 0.55, SH_H)
p.rect(cx - 3, cy - 4, cx + 1, cy - 1, "INK")
p.line((cx - 2, cy - 3), (cx, cy - 3), "CRT_1")
p.px(cx - 1, cy - 2, "CRT_0")
p.px(cx + 1, cy - 4, "RIM")
glow(p, cx - 1, cy - 3, 4, RED, 0, RED, xmax=175)
# a mug
mx, my = Pi(1.55, 0.75, SH_H)
p.rect(mx - 1, my - 3, mx + 1, my - 1, "BROWN_2")
p.px(mx + 1, my - 3, "RIM")
p.px(mx + 2, my - 2, "BROWN_2")
# charger cable falling from the shelf down the wall behind the bed
a = Pi(0.6, 0.0, SH_H - 0.1)
b = Pi(0.9, 0.0, HM + 0.2)
p.sag(a, b, 1, "INK")
reg("bed.nightstand", {"base": p}, zone="bed", kind="decor", layer=2,
    note="bedside wall shelf as the nightstand: alarm clock with red digits, a mug, phone charger cable")

# ------------------------------------------------------------------ phone glowing on the shelf
p = Pen(160, 140, 182, 212)  # contact 213, after the shelf and the bed
x, y = Pi(0.75, 0.55, SH_H)
p.line((x - 2, y - 1), (x + 1, y - 1), "INK")
p.line((x - 1, y - 2), (x + 1, y - 2), "CREAM")
p.px(x - 2, y - 2, "ROSE_1")
glow(p, x, y - 3, 7, WARM, 0, WARM, xmax=175)
reg("bed.phone", {"base": p}, zone="bed", kind="decor", layer=2,
    note="phone face up on the shelf, screen glowing (warm night mode), tinting the wall")

# ------------------------------------------------------------------ poster above the bed (tiers)
POS_BOX = (118, 80, 176, 160)


def poster(t: int) -> Pen:
    p = Pen(*POS_BOX)
    if t == 1:
        z0, z1, h0, h1 = 1.9, 4.1, 3.75, 5.65
        tw, th = wall_size(z0, z1, h0, h1)
        tx = Tex(tw, th, "ROSE_0")
        tx.rect(2, 2, tw - 3, th - 9, "BROWN_1")
        tx.rect(tw // 2 - 3, 5, tw // 2 + 2, 10, "TERRA_1")  # a printed red sun
        tx.line(2, th - 13, tw - 3, th - 13, "BROWN_2")
        for i in range(3):
            tx.line(3, th - 7 + i * 2, 3 + (tw - 8) * (3 - i) // 3, th - 7 + i * 2, "BROWN_2")
        tx.px(0, 0, "CREAM")
        tx.px(1, 0, "CREAM")
        tx.px(tw - 1, 0, "CREAM")
        tx.px(tw - 2, 0, "CREAM")
        wall_tex(p, z0, z1, h0, h1, tx)
        p.line(Pi(z0, 0, h1), Pi(z0, 0, h0 + 0.5), "TERRA_1")  # paper edge catches the light
        return p
    if t == 3:
        z0, z1, h0, h1 = 1.6, 4.4, 3.6, 5.95
        tw, th = wall_size(z0, z1, h0, h1)
        tx = Tex(tw, th, "INK")
        tx.rect(1, 1, tw - 2, th - 2, "PLUM_0")
        # concert poster: big moon disc, skyline, two lines of type
        cxp = tw // 2
        for yy in range(5, 14):
            for xx in range(1, tw - 1):
                if (xx - cxp) ** 2 * 1.6 + (yy - 9) ** 2 < 18:
                    tx.px(xx, yy, "TERRA_1" if yy < 9 else "TERRA_0")
        for xx in range(2, tw - 2):
            hgt = 3 + int(3 * hsh(xx // 2, 5))
            tx.rect(xx, 21 - hgt, xx, 20, "INK")
        tx.rect(3, 23, tw - 4, 24, "PLUM_1")
        tx.rect(4, 27, tw - 6, 27, "BROWN_2")
        tx.rect(4, 29, tw - 9, 29, "BROWN_2")
        wall_tex(p, z0, z1, h0, h1, tx)
        p.line(Pi(z0, 0.05, h1), Pi(z1, 0.05, h1), "RIM")
        p.line(Pi(z0, 0.05, h1), Pi(z0, 0.05, h0), "TERRA_1")
        return p
    z0, z1, h0, h1 = 1.4, 4.8, 3.35, 6.25
    tw, th = wall_size(z0, z1, h0, h1)
    tx = Tex(tw, th, "GOLD_DK")
    tx.rect(2, 2, tw - 3, th - 3, "BROWN_0")
    # a moody sunset painting: warm sky bands, dark marsh, a cypress
    for yy in range(3, th - 3):
        for xx in range(3, tw - 3):
            f = (yy - 3) / (th - 6)
            if f < 0.18:
                n = "TERRA_0"
            elif f < 0.36:
                n = "TERRA_1" if bay(xx, yy) < 0.6 else "TERRA_0"
            elif f < 0.45:
                n = "AMBER" if abs(xx - tw * 0.62) < 3 else "TERRA_1"
            else:
                n = "BROWN_1" if (xx + yy) % 7 else "INK"
            tx.px(xx, yy, n)
    for yy in range(8, th - 8):
        tx.px(8, yy, "INK")
        if yy < th - 14:
            tx.px(7 + (yy % 3 == 0), yy, "LEAF_0")
    tx.px(int(tw * 0.62), int((th - 6) * 0.38) + 3, "GLOW")
    wall_tex(p, z0, z1, h0, h1, tx)
    p.line(Pi(z0, 0.05, h1), Pi(z1, 0.05, h1), "GOLD")
    p.line(Pi(z0, 0.05, h1), Pi(z0, 0.05, h0), "GOLD")
    # picture light on top
    a, b = Pi(2.6, 0.2, h1 + 0.25), Pi(3.5, 0.2, h1 + 0.25)
    p.line(a, b, "GOLD_DK")
    p.line((a[0], a[1] + 1), (b[0], b[1] + 1), "GLOW")
    glow(p, (a[0] + b[0]) // 2, a[1] + 6, 10, WARM, 0, WARM, xmax=175, own=False)
    return p


reg("bed.poster", {"t1": poster(1), "t3": poster(3), "t5": poster(5), "base": poster(3)},
    zone="bed", kind="decor", layer=2,
    note="poster above the bed: t1 printout taped up, t3 framed concert poster, t5 large framed sunset painting with a picture light")

# ------------------------------------------------------------------ string lights (t2+)


def lights(t: int) -> Pen:
    p = Pen(112, 40, 177, 120)
    anchors = [0.0, 1.4, 2.9, 4.4, 5.9, 6.7]
    hh = 7.25
    bulbs = []
    for za, zb in zip(anchors, anchors[1:]):
        a, b = Pi(za, 0, hh), Pi(zb, 0, hh)
        pts = p.sag(a, b, 3 if t < 5 else 4, "INK")
        step = 4 if t < 5 else 3
        for i in range(2, len(pts) - 1, step):
            bulbs.append(pts[i])
    for i, (x, y) in enumerate(bulbs):
        n = ("GLOW", "AMBER", "SUN", "GLOW")[i % 4] if t >= 5 else ("AMBER", "GLOW")[i % 2]
        p.px(x, y + 1, n)
        if t >= 5 and i % 3 == 0:
            # clipped polaroids hanging from the line
            p.rect(x - 1, y + 3, x + 1, y + 6, "ROSE_0")
            p.px(x, y + 4, "PLUM_1")
        glow(p, x, y + 1, 3 if t < 5 else 4, WARM, 0, WARM, xmax=175, own=False)
    return p


reg("bed.lights", {"t2": lights(2), "t5": lights(5)}, zone="bed", kind="decor", layer=2,
    note="string lights along the wall over the bed (room tier 2+); t5 warmer and denser with clipped photos")

# ------------------------------------------------------------------ Tulane pennant high over the bed
p = Pen(120, 40, 176, 80)
z0, z1, h0, h1 = 0.8, 5.6, 7.55, 8.35
xl, xr = Pi(z1, 0.05, h1)[0], Pi(z0, 0.05, h1)[0]
for x in range(xl, xr + 1):
    z, _ = inv_side(x + 0.5, 0, 0.05)
    u = (z1 - z) / (z1 - z0)  # 0 at the point (left), 1 at the hoist (right)
    _, ytop = P(z, 0.05, h1)
    hgt = max(1, round(u * (P(z, 0.05, h0)[1] - ytop)))
    for j in range(hgt):
        p.px(x, round(ytop) + j, "LEAF_1" if j > 0 else "LEAF_2")
    if u > 0.9:
        for j in range(hgt):
            p.px(x, round(ytop) + j, "SLATE_0")
wall_text(p, xr - 32, (z0 + z1) / 2, h1 - 0.12, "TULANE", "ROSE_0", d=0.05)
p.line(Pi(z0, 0.05, h1 + 0.02), Pi(z1, 0.05, h1 + 0.02), "RIM")
p.px(*Pi(z0 + 0.05, 0.05, h1 + 0.08), "INK")
reg("bed.pennant", {"base": p}, zone="bed", kind="decor", layer=2,
    note="green TULANE pennant pinned high on the wall over the bed")

# ------------------------------------------------------------------ plant shelf with plants
p = Pen(110, 55, 150, 140)
PS_Z0, PS_Z1, PS_H = 4.6, 6.5, 5.45
box(p, PS_Z0, PS_Z1, 0, 0.8, PS_H - 0.1, PS_H, "INK", "BROWN_1", "BROWN_2", rim="RIM", rimfront=False)
for z in (PS_Z0 + 0.25, PS_Z1 - 0.25):
    a = Pi(z, 0.0, PS_H - 0.1)
    p.line(a, (a[0], a[1] + 3), "INK")
# pot 1: pothos with vines trailing down
x, y = Pi(4.95, 0.4, PS_H)
p.rect(x - 2, y - 4, x + 2, y - 1, "TERRA_0")
p.line((x + 2, y - 4), (x + 2, y - 1), "RIM")
p.ell(x - 5, y - 9, x + 4, y - 4, "LEAF_1")
p.px(x + 2, y - 8, "LEAF_2")
p.px(x + 3, y - 7, "LEAF_3")
p.px(x - 1, y - 9, "LEAF_2")
for k, (dx, ln) in enumerate(((-4, 13), (-1, 18), (3, 9))):
    for j in range(ln):
        xx = x + dx + (1 if (j // 4 + k) % 2 else 0)
        p.px(xx, y + j, "LEAF_1" if j % 3 else "LEAF_2")
# pot 2: small cactus
x, y = Pi(5.6, 0.4, PS_H)
p.rect(x - 1, y - 3, x + 1, y - 1, "BROWN_2")
p.rect(x - 1, y - 7, x, y - 4, "LEAF_1")
p.px(x + 1, y - 6, "LEAF_2")
p.px(x + 1, y - 3, "RIM")
# pot 3: snake plant, tall spiky leaves
x, y = Pi(6.2, 0.4, PS_H)
p.rect(x - 2, y - 4, x + 1, y - 1, "INK")
p.line((x + 1, y - 4), (x + 1, y - 1), "TERRA_1")
for dx, hgt, n in ((-2, 9, "LEAF_1"), (-1, 13, "LEAF_2"), (0, 11, "LEAF_1"), (1, 8, "LEAF_2")):
    p.line((x + dx, y - 5), (x + dx + (1 if dx > 0 else 0), y - 4 - hgt), n)
p.px(x, y - 15, "LEAF_3")
reg("bed.plantshelf", {"base": p}, zone="bed", kind="decor", layer=2,
    note="wall shelf over the bed foot: trailing pothos, a small cactus, a snake plant")

# ------------------------------------------------------------------ guitar on a wall hook
p = Pen(112, 95, 140, 195)
GZ = 5.35  # the guitar hangs flat on the wall, foreshortened along it
hx, hy = Pi(GZ, 0.15, 5.12)
p.px(hx, hy - 1, "INK")  # hook
p.rect(hx - 1, hy, hx + 1, hy + 4, "BROWN_1")  # headstock
p.px(hx + 1, hy + 1, "GOLD_DK")
p.px(hx - 1, hy + 2, "GOLD_DK")
p.px(hx + 1, hy, "RIM")
nb = hy + 21
p.line((hx, hy + 5), (hx, nb), "BROWN_1")  # neck
p.line((hx + 1, hy + 5), (hx + 1, nb), "BROWN_2")
p.px(hx + 1, hy + 9, "RIM")
p.px(hx + 1, hy + 14, "RIM")
# body: upper bout, waist, lower bout (TERRA_0 edge, TERRA_1 centre), lit on the right
ub_y, lb_y = nb + 4, nb + 12
p.ell(hx - 4, ub_y - 4, hx + 4, ub_y + 3, "TERRA_0")
p.ell(hx - 5, lb_y - 5, hx + 5, lb_y + 5, "TERRA_0")
p.rect(hx - 3, ub_y + 1, hx + 3, lb_y - 3, "TERRA_0")
p.ell(hx - 2, ub_y - 2, hx + 3, ub_y + 2, "TERRA_1", only="TERRA_0")
p.ell(hx - 3, lb_y - 3, hx + 4, lb_y + 4, "TERRA_1", only="TERRA_0")
for yy in range(ub_y - 5, lb_y + 6):
    for xx in range(hx + 6, hx - 1, -1):
        if p.get(xx, yy) in ("TERRA_0", "TERRA_1"):
            p.px(xx, yy, "RIM")
            break
for yy in range(ub_y - 5, lb_y + 6):
    for xx in range(hx - 6, hx + 1):
        if p.get(xx, yy) in ("TERRA_0", "TERRA_1"):
            p.px(xx, yy, "BROWN_1")
            break
p.circ(hx, ub_y + 2, 1, "INK")
p.line((hx - 2, lb_y + 2), (hx + 2, lb_y + 2), "INK")
p.line((hx, nb), (hx, lb_y + 2), "BROWN_2")  # strings over the body
reg("bed.guitar", {"base": p}, zone="bed", kind="decor", layer=2,
    note="acoustic guitar on a wall hook above the bed foot, sunburst, lit on its right edge")

# ------------------------------------------------------------------ Mardi Gras beads draped from the shelf bracket
p = Pen(126, 95, 146, 140)
bx0, by0 = Pi(PS_Z0 + 0.25, 0.05, PS_H - 0.12)
cols = ("PLUM_1", "GOLD", "LEAF_2")
for k, (dx, depth) in enumerate(((-1, 9), (1, 12), (0, 6))):
    for j in range(depth * 2 + 1):
        t = j / (depth * 2)
        x = bx0 + dx + round((t - 0.5) * 4)
        y = by0 + round(depth * (1 - (2 * t - 1) ** 2))
        if j % 2 == 0:
            p.px(x, y, cols[k])
reg("bed.beads", {"base": p}, zone="bed", kind="decor", layer=2,
    note="Mardi Gras beads (purple, gold, green) hanging from the plant-shelf bracket")

# ------------------------------------------------------------------ headphones on the shelf bracket
p = Pen(110, 105, 126, 150)
x, y = Pi(6.45, 0.15, 4.95)
p.px(x, y - 1, "INK")
p.line((x - 2, y + 1), (x - 2, y + 4), "INK")
p.line((x + 2, y + 1), (x + 2, y + 4), "INK")
p.line((x - 1, y), (x + 1, y), "INK")
p.rect(x - 3, y + 4, x - 2, y + 7, "BROWN_1")
p.rect(x + 2, y + 4, x + 3, y + 7, "BROWN_1")
p.px(x + 3, y + 4, "RIM")
p.px(x - 2, y + 5, "CRT_0")
reg("bed.headphones", {"base": p}, zone="bed", kind="decor", layer=2,
    note="over-ear headphones hanging from the plant-shelf bracket")

# ------------------------------------------------------------------ mirror between the bed and the door
p = Pen(96, 90, 118, 176)
z0, z1, h0, h1 = 6.95, 7.9, 2.35, 6.3


def mirror_px(z, h, x, y):
    u = (z1 - z) / (z1 - z0)
    if u < 0.12 or u > 0.88 or h < h0 + 0.12 or h > h1 - 0.12:
        return "BROWN_1"
    # glass: dark, with the window's glow as a soft diagonal streak
    k = (h - h0) * 1.0 - u * 2.6
    if 1.15 < k < 1.45:
        return "TERRA_1"
    if 1.0 < k < 1.65 or 2.1 < k < 2.2:
        return "TERRA_0"
    return "INK_COOL" if u > 0.5 else "INK"


face(p, "side", 0.06, z0, z1, h0, h1, mirror_px)
p.line(Pi(z0, 0.06, h1), Pi(z0, 0.06, h0), "RIM")
p.line(Pi(z0, 0.06, h1), Pi(z1, 0.06, h1), "TERRA_1")
reg("bed.mirror", {"base": p}, zone="bed", kind="decor", layer=3,
    note="tall mirror between the bed and the door, the sunset caught in it as a dim streak")

# ------------------------------------------------------------------ laundry basket (tiers) + hoodies on top
LB = (6.8, 7.95, 0.0, 1.25)  # z0, z1, d0, d1


def laundry(t: int) -> Pen:
    p = Pen(94, 180, 132, 214)  # contact 215
    z0, z1, d0, d1 = LB
    if t == 1:
        # clothes heaped on the floor
        for i, (z, d, r, n) in enumerate(((7.1, 0.5, 4, "BROWN_1"), (7.6, 0.9, 5, "BROWN_2"), (7.3, 1.4, 4, "PLUM_0"),
                                          (7.8, 0.3, 3, "SLATE_0"), (7.0, 1.9, 3, "BROWN_1"))):
            x, y = Pi(z, d, 0)
            p.ell(x - r - 1, y - r - 1, x + r + 1, y, n)
            p.line((x, y - r - 1), (x + r, y - r + 1), "TERRA_1" if i % 2 else "RIM")
        p.line(Pi(7.9, 0.0, 0), Pi(7.9, 2.0, 0), "VOID")
        return p
    if t == 3:
        body = lambda z, h, x, y: "INK" if (0.25 < h < 1.15 and y % 3 == 0 and x % 4 != 0) else "BROWN_1"
        box(p, z0, z1, d0, d1, 0, 1.35,
            lambda d, h, x, y: "VOID" if (0.25 < h < 1.15 and y % 3 == 0 and x % 4 != 0) else "BROWN_0", body,
            "VOID", rim="TERRA_2")
        face(p, "top", 1.36, z0 + 0.1, z1 - 0.1, d0 + 0.1, d1 - 0.1,
             lambda z, d, x, y: ("ROSE_0", "BROWN_2", "PLUM_0", "BROWN_1")[int(hsh(x // 2, y) * 4)])
        contact_shadow(p, z0, z1, d0, d1)
        return p
    # t5 woven hamper with a lid
    weave = lambda z, h, x, y: "TERRA_1" if (y // 2) % 2 else "TERRA_0"
    box(p, z0, z1, d0, d1, 0, 1.45, lambda d, h, x, y: "BROWN_2" if (y // 2) % 2 else "BROWN_1", weave,
        "BROWN_2", rim="ORANGE")
    face(p, "side", d1 + 0.02, z0, z1, 1.3, 1.45, "BROWN_2")
    contact_shadow(p, z0, z1, d0, d1)
    return p


reg("bed.laundry", {"t1": laundry(1), "t3": laundry(3), "t5": laundry(5), "base": laundry(3)},
    zone="bed", kind="decor", layer=3,
    note="laundry by the bed foot: t1 a heap on the floor, t3 a plastic basket, t5 a woven hamper with a lid")

p = Pen(94, 168, 132, 215)  # contact 216, sits on the laundry
for i, (n, lit) in enumerate((("BROWN_1", "TERRA_1"), ("PLUM_0", "PLUM_1"), ("INK", "TERRA_0"), ("TERRA_0", "RIM"))):
    h0 = 1.45 + i * 0.17
    box(p, 7.0 + 0.05 * (i % 2), 7.8 - 0.06 * (i % 3), 0.15 + 0.05 * i, 1.1, h0, h0 + 0.16, "INK", n, n, rim=lit,
        edge=None)
    a = Pi(7.8 - 0.06 * (i % 3), 0.15 + 0.05 * i, h0)
    p.line(a, (a[0] + 4, a[1]), "INK")
reg("bed.hoodies", {"base": p}, zone="bed", kind="decor", layer=3,
    note="stack of folded hoodies on top of the laundry")

# ------------------------------------------------------------------ rug in front of the bed (tiers)
RUG = (6.65, 8.45, 1.55, 6.1)


def rug(t: int) -> Pen:
    p = Pen(100, 205, 178, 214)  # contact 215
    z0, z1, d0, d1 = RUG
    if t == 1:
        # a thin bath towel thrown down as a mat
        face(p, "top", 0.01, 6.8, 7.9, 2.0, 4.3, lambda z, d, x, y: "ROSE_0" if (d - 2.0) % 0.8 < 0.12 else "BROWN_2")
        p.line(Pi(7.9, 2.0, 0), Pi(7.9, 4.3, 0), "BROWN_1")
        return p
    if t == 3:
        def f(z, d, x, y):
            if d < d0 + 0.25 or d > d1 - 0.25 or z < z0 + 0.15 or z > z1 - 0.15:
                return "TERRA_0"
            return "PLUM_0" if (d - d0) % 1.2 < 0.75 else "BROWN_1"
        face(p, "top", 0.01, z0, z1, d0, d1, f)
        p.line(Pi(z1, d0, 0), Pi(z1, d1, 0), "INK")
        p.line(Pi(z0, d1, 0), Pi(z1, d1, 0), "TERRA_1")
        return p

    def g(z, d, x, y):
        if d < d0 + 0.25 or d > d1 - 0.25 or z < z0 + 0.15 or z > z1 - 0.15:
            return "GOLD_DK" if (x + y) % 2 else "TERRA_0"
        k = int((d - d0) / 0.45) % 4
        return ("TERRA_0", "PLUM_0", "TERRA_1", "PLUM_0")[k]
    face(p, "top", 0.01, z0, z1, d0, d1, g)
    p.line(Pi(z1, d0, 0), Pi(z1, d1, 0), "INK")
    for d in [d0 + i * 0.3 for i in range(int((d1 - d0) / 0.3) + 1)]:
        x, y = Pi(z1, d, 0)
        p.px(x, y + 1, "ROSE_0")  # fringe
    p.line(Pi(z0, d1, 0), Pi(z1, d1, 0), "RIM")
    return p


reg("bed.rug", {"t1": rug(1), "t3": rug(3), "t5": rug(5), "base": rug(3)}, zone="bed", kind="decor", layer=3,
    note="rug in front of the bed: t1 a bath towel thrown down, t3 a plum and brown rug, t5 a patterned rug with fringe")

# ------------------------------------------------------------------ slippers on the rug
p = Pen(140, 205, 166, 216)  # contact 217
for z, d in ((7.0, 4.35), (7.1, 4.85)):
    x, y = Pi(z, d, 0)
    p.rect(x - 1, y - 1, x + 3, y, "BROWN_1")
    p.rect(x + 1, y - 2, x + 3, y - 1, "BROWN_2")
    p.px(x + 3, y - 2, "RIM")
    p.px(x - 1, y - 1, "ROSE_0")
reg("bed.slippers", {"base": p}, zone="bed", kind="decor", layer=3, note="a pair of slippers on the rug")

# ------------------------------------------------------------------ bathroom scale leaning on the bed foot (BODYWEIGHT)
p = Pen(118, 186, 150, 215)  # contact 216
SC = (6.62, 1.45, 2.45)  # z, d0, d1 (standing on its edge against the bed foot)
z, d0, d1 = SC
face(p, "front", z + 0.02, d0, d1, 0.02, 0.95, lambda d, h, x, y: "INK_COOL" if (d - d0) > 0.08 else "BROWN_1")
face(p, "front", z + 0.03, d0 + 0.08, d1 - 0.08, 0.1, 0.87, "INK_COOL")
p.line(Pi(z + 0.03, d0, 0.95), Pi(z + 0.03, d1, 0.95), "SLATE_0")
p.line(Pi(z + 0.03, d1, 0.95), Pi(z + 0.03, d1, 0.05), "RIM")
p.line(Pi(z + 0.03, d0, 0.0), Pi(z + 0.03, d1, 0.0), "VOID")
dx, dy = Pi(z + 0.03, (d0 + d1) / 2, 0.68)
p.rect(dx - 3, dy - 1, dx + 2, dy + 1, "VOID")
p.line((dx - 2, dy), (dx + 1, dy), "TERRA_1")  # dim readout
p.px(dx + 1, dy, "AMBER")
for k in (-1, 1):
    fx, fy = Pi(z + 0.03, (d0 + d1) / 2 + k * 0.25, 0.32)
    p.rect(fx - 1, fy - 1, fx, fy + 1, "INK")
SCALE_LED = Pi(z + 0.03, (d0 + d1) / 2, 0.4)
reg("bed.scale", {"base": p}, zone="bed", kind="hotspot", layer=3, target={"feature": "bodyweight"},
    label="BODYWEIGHT", led=SCALE_LED,
    note="dark glass bathroom scale stood on its edge against the bed foot, dim amber readout")

# ------------------------------------------------------------------ cables on the floor in front of the bed
p = Pen(98, 196, 178, 222)
pts = [Pi(4.6, BW + 0.1, 0), Pi(5.6, BW + 1.0, 0), Pi(6.9, 6.6, 0), Pi(8.6, 7.4, 0), Pi(9.6, 5.2, 0),
       Pi(10.6, 3.4, 0)]
for a, b in zip(pts, pts[1:]):
    p.sag(a, b, 1.5, "VOID")
p.sag(Pi(8.7, 7.4, 0), Pi(10.0, 6.0, 0), 1, "VOID")
reg("bed.cables", {"base": p}, zone="bed", kind="decor", layer=3,
    note="extension cable snaking out from under the bed across the floor toward the door side")

# ============================================================================================ KITCHEN
DZ0, DZ1, DH = 8.4, 11.0, 7.0  # door along the wall, height


def door() -> Pen:
    p = Pen(56, 70, 106, 221)  # contact 222
    cz0, cz1, ch = DZ0 - 0.25, DZ1 + 0.25, DH + 0.3

    def casing(z, h, x, y):
        return "BROWN_1"
    face(p, "side", 0.05, cz0, cz1, 0, ch, casing)

    def leaf(z, h, x, y):
        # raised panels: two tall panels, top and bottom rails; lit toward the window side (right)
        u = (DZ1 - z) / (DZ1 - DZ0)
        v = h / DH
        inpanel = 0.16 < u < 0.84 and (0.08 < v < 0.46 or 0.53 < v < 0.92)
        if inpanel:
            return "BROWN_0" if u < 0.7 else "BROWN_1"
        if u > 0.93:
            return "BROWN_2"
        return "BROWN_1"
    face(p, "side", 0.08, DZ0, DZ1, 0.02, DH, leaf)
    # panel grooves: dark on the shaded (left/top) edges, rim on the lit (right/bottom) edges
    for v0, v1 in ((0.08, 0.46), (0.53, 0.92)):
        zl, zr = DZ1 - 0.16 * (DZ1 - DZ0), DZ1 - 0.84 * (DZ1 - DZ0)
        p.line(Pi(zl, 0.08, v1 * DH), Pi(zr, 0.08, v1 * DH), "INK")
        p.line(Pi(zl, 0.08, v0 * DH), Pi(zl, 0.08, v1 * DH), "INK")
        p.line(Pi(zr, 0.08, v0 * DH), Pi(zr, 0.08, v1 * DH), "TERRA_1")
        p.line(Pi(zl, 0.08, v0 * DH), Pi(zr, 0.08, v0 * DH), "BROWN_2")
    # door edges and casing rim
    p.line(Pi(DZ1, 0.08, 0), Pi(DZ1, 0.08, DH), "INK")
    p.line(Pi(DZ0, 0.08, 0), Pi(DZ0, 0.08, DH), "INK")
    p.line(Pi(DZ1, 0.08, DH), Pi(DZ0, 0.08, DH), "INK")
    p.line(Pi(cz0, 0.05, 0), Pi(cz0, 0.05, ch), "RIM")
    p.line(Pi(cz1, 0.05, ch), Pi(cz0, 0.05, ch), "TERRA_1")
    p.line(Pi(cz1, 0.05, 0), Pi(cz1, 0.05, ch), "INK")
    # knob, deadbolt, peephole
    kx, ky = Pi(DZ1 - 0.3, 0.12, 3.1)
    p.px(kx, ky, "GOLD_DK")
    p.px(kx + 1, ky, "GOLD")
    p.px(kx, ky + 1, "INK")
    bx, by = Pi(DZ1 - 0.3, 0.12, 3.75)
    p.px(bx, by, "GOLD_DK")
    ex, ey = Pi((DZ0 + DZ1) / 2, 0.1, 5.85)
    p.px(ex, ey, "INK")
    # hallway light leaking under the door
    p.line(Pi(DZ1 - 0.05, 0.1, 0.02), Pi(DZ0 + 0.05, 0.1, 0.02), "AMBER")
    p.line(Pi(DZ1 - 0.2, 0.1, 0.06), Pi(DZ0 + 0.4, 0.1, 0.06), "TERRA_1")
    return p


reg("kitchen.door", {"base": door()}, zone="kitchen", kind="decor", layer=3,
    note="7 ft panel door in the left wall, brass knob and deadbolt, hallway light leaking under it")

# ------------------------------------------------------------------ welcome sign over the door
p = Pen(60, 55, 104, 92)
z0, z1, h0, h1 = 8.55, 10.85, 7.42, 8.05
face(p, "side", 0.05, z0, z1, h0, h1, lambda z, h, x, y: "INK" if h < h0 + 0.06 else "BROWN_1")
xl, xr = Pi(z1, 0.05, h1)[0], Pi(z0, 0.05, h1)[0]
wall_text(p, xl + max(1, (xr - xl - 26) // 2), (z0 + z1) / 2, h1 - 0.11, "WELCOME", "ROSE_0", d=0.05)
p.line(Pi(z0, 0.05, h1), Pi(z1, 0.05, h1), "RIM")
p.line(Pi(z0, 0.05, h1), Pi(z0, 0.05, h0), "TERRA_1")
reg("kitchen.welcome", {"base": p}, zone="kitchen", kind="decor", layer=3,
    note="small painted WELCOME plank over the door")

# ------------------------------------------------------------------ corkboard on the door (COLLEGE INTEGRATION)
CB = (8.85, 10.6, 3.65, 5.55)  # z0, z1, h0, h1 on the door face


def corkboard(stage: int) -> Pen:
    p = Pen(60, 100, 104, 221)  # contact 222: drawn after the door
    z0, z1, h0, h1 = CB
    tw, th = wall_size(z0, z1, h0, h1)
    tx = Tex(tw, th, "BROWN_2")
    for yy in range(th):
        for xx in range(tw):
            if hsh(xx, yy, 11) < 0.12:
                tx.px(xx, yy, "ROSE_0" if hsh(xx, yy, 12) < 0.5 else "BROWN_1")
    tx.rect(0, 0, tw - 1, th - 1, "INK", fill=False)
    tx.rect(1, 1, tw - 2, 1, "BROWN_1")
    if stage == 0:
        tx.rect(4, 6, 8, 11, "ROSE_0")  # a single note
        tx.line(5, 8, 7, 8, "BROWN_1")
        tx.px(6, 6, "CRT_0")
        tx.px(tw - 7, 14, "GOLD_DK")  # loose pins
        tx.px(tw - 5, 17, "SLATE_0")
    else:
        # flyers, a photo
        tx.rect(2, 3, 9, 13, "ROSE_0")
        tx.rect(3, 5, 8, 7, "TERRA_1")
        tx.line(3, 9, 8, 9, "BROWN_1")
        tx.line(3, 11, 7, 11, "BROWN_1")
        tx.px(5, 3, "CRT_0")
        tx.rect(tw - 9, 5, tw - 3, 12, "PLUM_1")
        tx.rect(tw - 8, 6, tw - 4, 7, "PLUM_3")
        tx.line(tw - 8, 9, tw - 4, 9, "PLUM_0")
        tx.px(tw - 6, 5, "GOLD")
        # photo
        tx.rect(5, th - 13, 11, th - 5, "ROSE_1")
        tx.rect(6, th - 12, 10, th - 8, "SLATE_0")
        tx.px(8, th - 10, "BROWN_2")
        tx.px(7, th - 9, "LEAF_1")
        if stage == 2:
            # packed: more flyers overlapping, club cards, a pennant across the top
            tx.rect(10, 8, 15, 17, "LEAF_1")
            tx.rect(11, 9, 14, 11, "LEAF_2")
            tx.line(11, 13, 14, 13, "LEAF_0")
            tx.px(12, 8, "CRT_1")
            tx.rect(tw - 10, th - 14, tw - 3, th - 9, "SLATE_1")
            tx.line(tw - 9, th - 12, tw - 4, th - 12, "SLATE_0")
            tx.px(tw - 6, th - 14, "GOLD")
            tx.rect(tw - 12, th - 7, tw - 7, th - 3, "ROSE_0")  # club card
            tx.px(tw - 10, th - 5, "CRT_0")
            tx.rect(2, 16, 6, 20, "AMBER")  # sticky note
            tx.rect(13, th - 8, 17, th - 4, "CREAM")  # ticket stub
            tx.line(14, th - 6, 16, th - 6, "TERRA_1")
            # pennant
            for i in range(tw - 4):
                hgt = max(0, 4 - i // 5)
                tx.line(2 + i, 2, 2 + i, 2 + hgt, "LEAF_2" if i < tw - 8 else "LEAF_1")
            tx.line(3, 3, 10, 3, "SLATE_1")
            tx.px(2, 2, "CREAM")
    wall_tex(p, z0, z1, h0, h1, tx, d=0.12)
    p.line(Pi(z0, 0.12, h1), Pi(z0, 0.12, h0), "RIM")
    p.line(Pi(z0, 0.12, h0), Pi(z1, 0.12, h0), "TERRA_0")
    return p


CB_LED = Pi(CB[0] + 0.3, 0.14, CB[2] + 0.25)
reg("kitchen.corkboard", {"s0": corkboard(0), "s1": corkboard(1), "s2": corkboard(2)},
    zone="kitchen", kind="hotspot", layer=3, target={"skill": "college-integration"}, label="COLLEGE INTEGRATION",
    led=CB_LED,
    note="corkboard on the door: s0 nearly empty, s1 a few flyers and a photo, s2 packed with flyers, club cards, a pennant")

# ------------------------------------------------------------------ doormat (REVIEW) with the alert letter
DM = (8.7, 10.8, 0.15, 2.0)


def doormat(alert: bool) -> Pen:
    p = Pen(60, 208, 118, 221)  # contact 222
    z0, z1, d0, d1 = DM

    def f(z, d, x, y):
        if d < d0 + 0.3 or d > d1 - 0.3 or z < z0 + 0.25 or z > z1 - 0.25:
            return "BROWN_1"
        return "BROWN_2"
    face(p, "top", 0.03, z0, z1, d0, d1, f)
    p.line(Pi(z1, d0, 0), Pi(z1, d1, 0), "INK")
    p.line(Pi(z0, d1, 0.03), Pi(z1, d1, 0.03), "TERRA_1")
    p.line(Pi(z0 + 0.1, d0, 0.03), Pi(z1 - 0.1, d0, 0.03), "TERRA_0")  # hallway light on the door edge
    if alert:
        # envelope with a red wax seal
        cx, cy = Pi(9.9, 1.1, 0.03)
        p.poly([(cx - 5, cy - 2), (cx + 3, cy - 2), (cx + 4, cy + 1), (cx - 4, cy + 1)], "CREAM")
        p.line((cx - 4, cy + 1), (cx + 4, cy + 1), "ROSE_0")
        p.line((cx - 5, cy - 2), (cx - 1, cy), "ROSE_1")
        p.line((cx - 1, cy), (cx + 3, cy - 2), "ROSE_1")
        p.rect(cx - 2, cy - 1, cx - 1, cy, "CRT_0")
        p.px(cx - 1, cy - 1, "CRT_1")
    return p


DM_LED = Pi(10.55, 1.05, 0.03)
reg("kitchen.doormat", {"base": doormat(False), "alert": doormat(True)}, zone="kitchen", kind="hotspot", layer=3,
    target={"feature": "review"}, label="REVIEW", led=(DM_LED[0], DM_LED[1] - 1),
    note="coir doormat in front of the door; alert: a letter with a red wax seal lying on it")

# ------------------------------------------------------------------ sneakers kicked off by the door
p = Pen(84, 210, 112, 221)  # contact 222, after the doormat
for z, d, flip in ((10.95, 2.45, 0), (11.2, 3.05, 1)):
    x, y = Pi(z, d, 0)
    if flip:
        p.rect(x - 2, y - 2, x + 3, y - 1, "BROWN_1")
        p.line((x - 2, y), (x + 3, y), "ROSE_0")
        p.px(x + 3, y - 2, "RIM")
    else:
        p.rect(x - 3, y - 2, x + 2, y - 1, "BROWN_1")
        p.rect(x - 3, y - 3, x - 1, y - 3, "BROWN_1")
        p.line((x - 3, y), (x + 2, y), "ROSE_0")
        p.px(x + 2, y - 2, "RIM")
reg("kitchen.sneakers", {"base": p}, zone="kitchen", kind="decor", layer=3,
    note="a pair of sneakers kicked off beside the doormat")

# ------------------------------------------------------------------ switchboard (SETTINGS), low by the door
SB = (11.45, 11.95, 1.05, 1.55)
p = Pen(48, 180, 64, 224)  # L4, contact 225 (before the fridge)
z0, z1, h0, h1 = SB
face(p, "side", 0.06, z0, z1, h0, h1, "INK")
face(p, "side", 0.07, z0 + 0.06, z1 - 0.06, h0 + 0.06, h1 - 0.06, "VOID")
for i, zt in enumerate((z1 - 0.13, z1 - 0.25, z1 - 0.37)):
    tx_, ty_ = Pi(zt, 0.08, h0 + 0.3 - 0.06 * (i == 1))
    p.px(tx_, ty_, "BROWN_2" if i != 1 else "ROSE_0")
    p.px(tx_, ty_ + 1, "BROWN_1")
lx, ly = Pi(z0 + 0.06, 0.08, h1 - 0.12)
p.px(lx, ly, "AMBER")
p.line(Pi(z0, 0.06, h1), Pi(z0, 0.06, h0), "BROWN_2")
glow(p, lx, ly, 2, WARM, 0, WARM, xmax=70)
SB_LED = Pi((z0 + z1) / 2, 0.08, h0 + 0.25)
reg("kitchen.switchboard", {"base": p}, zone="kitchen", kind="hotspot", layer=4, target={"feature": "settings"},
    label="SETTINGS", led=(SB_LED[0] - 1, SB_LED[1] - 1),
    note="tiny dark switch plate low on the wall by the door: three toggles and one amber LED")

# ------------------------------------------------------------------ light switch by the door
p = Pen(48, 130, 64, 160)
x, y = Pi(11.5, 0.05, 4.05)
p.rect(x - 1, y - 3, x, y + 1, "ROSE_0")
p.px(x, y - 1, "BROWN_1")
p.px(x - 1, y - 1, "INK")
p.px(x + 1, y - 3, "INK")
reg("kitchen.lightswitch", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="light switch plate beside the door frame")

# ------------------------------------------------------------------ broom leaning in the gap behind the fridge
p = Pen(30, 115, 72, 224)  # contact 225 so the fridge (contact 238) covers the bristles
a, b = Pi(12.15, 0.05, 4.75), Pi(12.95, 0.45, 0.6)
p.line(a, b, "BROWN_2")
p.line((a[0] + 1, a[1]), (b[0] + 1, b[1]), "TERRA_1")
p.px(a[0], a[1] - 1, "INK")
bx, by = b
p.poly([(bx - 2, by), (bx + 3, by), (bx + 4, by + 9), (bx - 3, by + 9)], "GOLD_DK")
p.line((bx + 3, by), (bx + 4, by + 9), "AMBER")
reg("kitchen.broom", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="broom leaning on the wall between the door and the fridge, bristles hidden behind the fridge")

# ------------------------------------------------------------------ fridge with hot plate and kettle (FOOD)
FZ0, FZ1, FD, FH = 13.25, 14.6, 1.6, 2.7


def fridge(stage: int) -> Pen:
    p = Pen(4, 140, 72, 231)  # contact 232 (its real floor line), so the cart and cables sort after it
    door_open = stage == 0
    body_side = lambda z, h, x, y: "BROWN_2" if z < FZ0 + 0.12 else "BROWN_1"
    box(p, FZ0, FZ1, 0, FD, 0, FH, "INK", body_side, "BROWN_2", rim="TERRA_2")
    # door seam and handle on the room face; freezer line
    p.line(Pi(FZ0 + 0.06, FD, 0.12), Pi(FZ0 + 0.06, FD, FH - 0.08), "INK")
    p.line(Pi(FZ1 - 0.03, FD, 0.12), Pi(FZ1 - 0.03, FD, FH - 0.08), "INK")
    p.line(Pi(FZ0 + 0.06, FD, FH - 0.55), Pi(FZ1 - 0.03, FD, FH - 0.55), "INK")
    hx, hy = Pi(FZ1 - 0.18, FD, FH - 0.75)
    p.line((hx, hy), (hx, hy + 9), "SLATE_0")
    p.line((hx + 1, hy), (hx + 1, hy + 9), "INK")
    # kick grille on the front
    p.line(Pi(FZ1, 0.15, 0.15), Pi(FZ1, FD - 0.15, 0.15), "BROWN_1")
    # stickers on the viewer-facing side panel
    sx, sy = Pi(FZ1, 0.6, 1.9)
    p.rect(sx - 1, sy - 1, sx + 2, sy + 1, "LEAF_1")
    p.px(sx, sy, "LEAF_2")
    sx, sy = Pi(FZ1, 1.15, 1.3)
    p.rect(sx - 1, sy - 1, sx + 1, sy + 1, "TERRA_0")
    if door_open:
        # door hinged at the front edge, swung open: a dim interior, one bulb, two bare wire shelves
        lo, hi = 0.12, FH - 0.58

        def inside(z, h, x, y):
            if (h - 0.75) % 0.6 < 0.06:
                return "ROSE_0"
            return "BROWN_2" if z < FZ0 + 0.35 and h > 1.2 else "BROWN_1"
        face(p, "side", FD - 0.02, FZ0 + 0.06, FZ1 - 0.03, lo, hi, inside)
        bx_, by_ = Pi(FZ0 + 0.2, FD, hi - 0.15)
        p.px(bx_, by_, "SUN")
        p.px(bx_ - 1, by_, "GLOW")
        p.px(bx_, by_ + 1, "AMBER")
        # the open door panel, hinged at the back edge, its front edge swung out toward the viewer
        L = FZ1 - FZ0 - 0.1
        tip = (FZ0 + L * 0.3, FD + L * 0.95)
        a0, b0 = P(FZ0 + 0.02, FD, lo), P(FZ0 + 0.02, FD, hi + 0.3)
        a1, b1 = P(tip[0], tip[1], lo), P(tip[0], tip[1], hi + 0.3)
        p.poly([a0, a1, b1, b0], "BROWN_1")
        p.line((round(a0[0]), round(a0[1])), (round(b0[0]), round(b0[1])), "RIM")
        p.line((round(a1[0]), round(a1[1])), (round(b1[0]), round(b1[1])), "INK")
        p.line((round(b0[0]), round(b0[1])), (round(b1[0]), round(b1[1])), "BROWN_2")
        p.line((round(a0[0]), round(a0[1])), (round(a1[0]), round(a1[1])), "INK")
        # light spilling on the floor beside the open door
        for i in range(5):
            fx, fy = Pi(FZ0 + 0.35 + i * 0.16, FD + 0.2 + i * 0.25, 0)
            p.line((fx, fy), (fx + 5 - i, fy), "TERRA_0" if i % 2 else "BROWN_2")
    # hot plate and kettle on top
    hp = (FZ0 + 0.15, FZ0 + 0.95, 0.2, 1.35)
    box(p, hp[0], hp[1], hp[2], hp[3], FH, FH + 0.12, "VOID", "INK", "INK", rim="BROWN_2", edge=None)
    kx, ky = Pi(FZ0 + 0.55, 0.75, FH + 0.12)
    coil = stage >= 1
    if coil:
        p.line((kx - 4, ky + 1), (kx + 4, ky + 1), "CRT_0")
        p.px(kx + 4, ky + 1, "CRT_1")
        glow(p, kx, ky, 5, RED, 0, RED, xmax=70, own=False)
        p.line((kx - 2, ky - 1), (kx + 2, ky - 1), "TERRA_0")  # coil glow on the kettle base
    # kettle: a squat steel body, lid knob, spout to the left, handle arching over
    p.rect(kx - 3, ky - 6, kx + 3, ky - 1, "BROWN_1")
    p.rect(kx - 2, ky - 7, kx + 2, ky - 7, "BROWN_1")
    p.line((kx + 2, ky - 6), (kx + 2, ky - 2), "BROWN_2")
    p.line((kx + 3, ky - 6), (kx + 3, ky - 1), "RIM")
    p.px(kx + 2, ky - 7, "AMBER")  # under-shelf light catching the lid
    p.line((kx - 3, ky - 6), (kx - 3, ky - 1), "INK")
    p.px(kx, ky - 8, "INK")
    p.line((kx - 4, ky - 4), (kx - 6, ky - 6), "BROWN_1")  # spout
    p.line((kx - 2, ky - 9), (kx + 2, ky - 9), "INK")  # handle
    p.px(kx - 3, ky - 8, "INK")
    p.px(kx + 3, ky - 8, "INK")
    p.line((kx - 3, ky - 1), (kx + 3, ky - 1), "INK")
    if stage == 2:
        for j, (ox_, oy_) in enumerate(((-6, -10), (-7, -12), (-6, -14))):
            p.px(kx + ox_, ky + oy_, "ROSE_0")
    # front of the top: stage props
    if stage == 0:
        # an empty instant-noodle cup
        cx, cy = Pi(FZ1 - 0.3, 0.9, FH)
        p.rect(cx - 1, cy - 3, cx + 1, cy - 1, "ROSE_0")
        p.px(cx + 1, cy - 3, "CREAM")
        p.px(cx - 1, cy - 1, "CRT_0")
    elif stage == 1:
        # fruit bowl and a grocery bag on the floor beside the fridge
        cx, cy = Pi(FZ1 - 0.35, 0.85, FH)
        p.rect(cx - 3, cy - 2, cx + 3, cy - 1, "BROWN_2")
        p.line((cx - 3, cy - 2), (cx + 3, cy - 2), "TERRA_1")
        p.px(cx - 2, cy - 3, "ORANGE")
        p.px(cx - 1, cy - 4, "CRT_0")
        p.px(cx, cy - 3, "LEAF_2")
        p.px(cx + 1, cy - 4, "GOLD")
        p.px(cx + 2, cy - 3, "CRT_0")
        gx, gy = Pi(13.9, FD + 0.75, 0)
        p.poly([(gx - 4, gy), (gx + 4, gy), (gx + 4, gy - 9), (gx - 4, gy - 9)], "BROWN_2")
        p.line((gx + 4, gy - 9), (gx + 4, gy), "RIM")
        p.line((gx - 4, gy - 9), (gx - 4, gy), "BROWN_1")
        p.line((gx - 3, gy - 10), (gx - 1, gy - 15), "ROSE_1")  # baguette
        p.line((gx - 2, gy - 10), (gx, gy - 15), "TERRA_1")
        p.rect(gx + 1, gy - 12, gx + 3, gy - 10, "LEAF_2")  # greens
        p.line((gx - 4, gy + 1), (gx + 5, gy + 1), "VOID")
    else:
        # meal-prep stack and a herb pot
        cx, cy = Pi(FZ1 - 0.35, 0.65, FH)
        for k in range(3):
            yy = cy - 1 - k * 3
            p.rect(cx - 3, yy - 2, cx + 3, yy, "INK")
            p.line((cx - 3, yy - 2), (cx + 3, yy - 2), "ROSE_0")
            p.px(cx - 1, yy - 1, ("LEAF_2", "AMBER", "TERRA_1")[k])
            p.px(cx + 1, yy - 1, ("CREAM", "LEAF_2", "ROSE_1")[k])
            p.px(cx + 3, yy - 1, "RIM")
        hx2, hy2 = Pi(FZ1 - 0.25, 1.35, FH)
        p.rect(hx2 - 2, hy2 - 3, hx2 + 1, hy2 - 1, "TERRA_0")
        p.line((hx2 + 1, hy2 - 3), (hx2 + 1, hy2 - 1), "RIM")
        p.ell(hx2 - 4, hy2 - 9, hx2 + 3, hy2 - 3, "LEAF_2")
        p.px(hx2 + 1, hy2 - 8, "LEAF_3")
        p.px(hx2 - 2, hy2 - 7, "LEAF_3")
        p.px(hx2, hy2 - 5, "LEAF_1")
        # a shopping list on the door
        lx2, ly2 = Pi(FZ1 - 0.5, FD, 1.6)
        p.rect(lx2 - 1, ly2 - 3, lx2 + 2, ly2 + 2, "ROSE_0")
        p.line((lx2, ly2 - 1), (lx2 + 1, ly2 - 1), "BROWN_1")
        p.line((lx2, ly2 + 1), (lx2 + 1, ly2 + 1), "BROWN_1")
        p.px(lx2, ly2 - 3, "CRT_0")
    contact_shadow(p, FZ0, FZ1, 0, FD)
    return p


FR_LED = Pi(FZ1, FD * 0.5, 2.25)
reg("kitchen.fridge", {"s0": fridge(0), "s1": fridge(1), "s2": fridge(2)}, zone="kitchen", kind="hotspot", layer=4,
    target={"skill": "food"}, label="FOOD", led=FR_LED, hit=(10, 160, 50, 75),
    note="mini fridge with a hot plate and kettle on top: s0 door ajar and empty, s1 groceries and a fruit bowl, "
         "s2 meal-prep stack and a herb pot")

# ------------------------------------------------------------------ microwave on a wall shelf
p = Pen(0, 100, 62, 150)
MS = (13.0, 15.0, 0.0, 1.25, 4.35)  # z0, z1, d0, d1, shelf top h
z0, z1, d0, d1, hs = MS
box(p, z0, z1, d0, d1, hs - 0.1, hs, "INK", "BROWN_1", "BROWN_2", rim="TERRA_2", rimfront=False)
for z in (z0 + 0.3, z1 - 0.3):
    a = Pi(z, 0.0, hs - 0.1)
    p.line(a, (a[0], a[1] + 4), "INK")
    p.line((a[0], a[1] + 4), (a[0] + 3, a[1]), "INK")
# warm LED strip under the shelf, lighting the wall below
la, lb = Pi(z0 + 0.15, d1 - 0.15, hs - 0.12), Pi(z1 - 0.15, d1 - 0.15, hs - 0.12)
p.line((la[0], la[1] + 1), (lb[0], lb[1] + 1), "AMBER")
wash(p, z0 + 0.1, z1 - 0.1, hs - 0.1)
mz0, mz1 = 13.2, 14.75
box(p, mz0, mz1, 0.05, 1.1, hs, hs + 0.95, "INK", "BROWN_1", "BROWN_1", rim="TERRA_2", rimfront=True)
face(p, "side", 1.11, mz0 + 0.12, mz1 - 0.55, hs + 0.15, hs + 0.82, "VOID")  # glass door
face(p, "side", 1.12, mz0 + 0.2, mz1 - 0.65, hs + 0.55, hs + 0.75, lambda z, h, x, y: "SLATE_0" if bay(x, y) < 0.3 else None)
dx_, dy_ = Pi(mz1 - 0.3, 1.11, hs + 0.75)
p.line((dx_ - 1, dy_), (dx_ + 1, dy_), "CRT_1")  # clock digits
glow(p, dx_, dy_, 2, RED, 0, RED, xmax=70, own=True)
for k in range(3):
    bx_, by_ = Pi(mz1 - 0.3, 1.11, hs + 0.5 - k * 0.12)
    p.px(bx_, by_, "BROWN_2")
reg("kitchen.microwave", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="microwave on a wall shelf above the fridge, red clock digits")

# ------------------------------------------------------------------ wall clock
p = Pen(-6, 60, 30, 110)
cx, cy = Pi(14.2, 0.05, 6.5)
p.ell(cx - 4, cy - 7, cx + 4, cy + 7, "INK")
p.ell(cx - 3, cy - 6, cx + 3, cy + 6, "ROSE_0")
p.line((cx, cy), (cx, cy - 4), "INK")
p.line((cx, cy), (cx + 2, cy + 1), "INK")
p.px(cx, cy + 5, "BROWN_2")
p.px(cx, cy - 5, "BROWN_2")
for yy in range(cy - 5, cy + 6):
    if p.get(cx + 4, yy) == "INK":
        p.px(cx + 4, yy, "RIM")
reg("kitchen.clock", {"base": p}, zone="kitchen", kind="decor", layer=4, note="round wall clock above the fridge corner")

# ------------------------------------------------------------------ hanging plant from the ceiling
p = Pen(36, 35, 76, 150)  # contact 151: after the microwave shelf
hz, hd, hh = 13.9, 2.4, 6.15
px_, py_ = Pi(hz, hd, hh)
ceil_y = round(62 - 0.15 * (176 - px_)) - 1
p.line((px_, ceil_y), (px_, py_ - 9), "INK")
p.line((px_ - 3, py_ - 3), (px_, py_ - 9), "BROWN_2")
p.line((px_ + 3, py_ - 3), (px_, py_ - 9), "BROWN_2")
p.rect(px_ - 3, py_ - 3, px_ + 3, py_ + 2, "TERRA_0")
p.line((px_ + 3, py_ - 3), (px_ + 3, py_ + 2), "RIM")
p.line((px_ - 3, py_ + 2), (px_ + 2, py_ + 2), "BROWN_0")
p.ell(px_ - 7, py_ - 9, px_ + 6, py_ - 3, "LEAF_1")
p.ell(px_ - 3, py_ - 9, px_ + 5, py_ - 5, "LEAF_2", only="LEAF_1")
p.px(px_ + 4, py_ - 6, "LEAF_3")
p.px(px_ + 2, py_ - 7, "LEAF_3")
for k, (dx, ln) in enumerate(((-6, 18), (-4, 26), (4, 14), (6, 22))):
    for j in range(ln):
        xx = px_ + dx + (1 if (j // 5 + k) % 2 else 0)
        n = "LEAF_2" if (j % 4 == 0) else ("LEAF_1" if j % 3 else "LEAF_0")
        if p.get(xx, py_ - 3 + j) not in ("TERRA_0", "RIM"):
            p.px(xx, py_ - 3 + j, n)
    p.px(px_ + dx + (1 if ((ln - 1) // 5 + k) % 2 else 0) + 1, py_ - 3 + ln - 2, "LEAF_2")
reg("kitchen.hangingplant", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="pothos in a terracotta pot hanging from the ceiling, vines trailing")

# ------------------------------------------------------------------ calendar: dining hall hours
p = Pen(-24, 105, 22, 160)
z0, z1, h0, h1 = 15.15, 16.4, 3.85, 5.3
face(p, "side", 0.03, z0, z1, h0, h1,
     lambda z, h, x, y: "TERRA_0" if h > h1 - 0.42 else ("BROWN_2" if (h - h0) % 0.24 < 0.05 else "ROSE_0"))
xl, xr = Pi(z1, 0.03, h1)[0], Pi(z0, 0.03, h1)[0]
wall_text(p, xl + 1, (z0 + z1) / 2, h1 - 0.07, "BRUFF", "ROSE_0", d=0.03)
for k, zc in enumerate((15.45, 15.75, 16.05)):
    cxk, cyk = Pi(zc, 0.03, h0 + 0.55 + 0.24 * (k % 2))
    p.px(cxk, cyk, "CRT_0")
p.line(Pi(z0, 0.03, h1), Pi(z0, 0.03, h0), "TERRA_1")
p.px(*Pi((z0 + z1) / 2, 0.03, h1 + 0.1), "INK")
reg("kitchen.calendar", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="dining hall hours calendar (BRUFF) with a few days circled")

# ------------------------------------------------------------------ cart with dish rack and water jugs (tiers)
CT = (15.0, 16.35, 0.0, 1.35, 2.55)


def cart(t: int) -> Pen:
    p = Pen(-26, 160, 24, 235)  # contact 236
    z0, z1, d0, d1, ht = CT
    if t == 1:
        # a moving box as the counter, jugs on the floor next to it
        box(p, z0 + 0.1, z1, d0, d1 - 0.1, 0, 1.75, "BROWN_1", "TERRA_0", "BROWN_2", rim="TERRA_1")
        p.line(Pi(z0 + 0.1, d1 - 0.1, 1.75), Pi(z1, d1 - 0.1, 1.75), "TERRA_1")
        p.line(Pi((z0 + z1) / 2, d1 - 0.1, 1.75), Pi((z0 + z1) / 2, d1 - 0.1, 1.2), "ROSE_0")  # tape
        top_h = 1.75
    else:
        frame = "INK" if t == 3 else "TERRA_0"
        side_c = "INK" if t == 3 else "TERRA_1"
        top_c = "BROWN_1" if t == 3 else "TERRA_1"
        for z in (z0 + 0.05, z1 - 0.05):
            p.line(Pi(z, d1, 0), Pi(z, d1, ht), frame)
        p.line(Pi(z1 - 0.05, d0 + 0.05, 0), Pi(z1 - 0.05, d0 + 0.05, ht), frame)
        for hh in (0.25, 1.3):
            face(p, "top", hh, z0, z1, d0, d1, "INK" if t == 3 else "BROWN_2")
            p.line(Pi(z0, d1, hh), Pi(z1, d1, hh), side_c)
            p.line(Pi(z1, d0, hh), Pi(z1, d1, hh), side_c)
        box(p, z0, z1, d0, d1, ht - 0.12, ht, "INK" if t == 3 else "BROWN_2", side_c, top_c,
            rim="TERRA_2" if t == 3 else "ORANGE", edge=None)
        # water jugs on the bottom shelf
        for i, z in enumerate((z0 + 0.35, z0 + 0.95)):
            jx, jy = Pi(z, 0.7, 0.27)
            p.rect(jx - 3, jy - 7, jx + 3, jy - 1, "INK_COOL")
            p.rect(jx - 1, jy - 9, jx + 1, jy - 8, "INK_COOL")
            p.px(jx, jy - 10, "ROSE_0")
            p.line((jx + 3, jy - 6), (jx + 3, jy - 2), "TERRA_1")
            p.line((jx - 2, jy - 4), (jx + 2, jy - 4), "SLATE_0")
        top_h = ht
    if t == 1:
        for i, z in enumerate((z1 + 0.15, z1 + 0.15)):
            jx, jy = Pi(z, 0.45 + i * 0.7, 0)
            p.rect(jx - 2, jy - 6, jx + 2, jy - 1, "INK_COOL")
            p.px(jx, jy - 7, "ROSE_0")
            p.line((jx + 2, jy - 5), (jx + 2, jy - 2), "TERRA_1")
    # dish rack with plates, a mug
    rz0, rz1 = z0 + 0.15, z1 - 0.25
    a, b = Pi(rz0, 0.25, top_h), Pi(rz1, 0.25, top_h)
    for k in range(5):
        z = rz0 + (rz1 - rz0) * (k + 0.5) / 5
        x, y = Pi(z, 0.55, top_h)
        p.line((x, y - 1), (x, y - 7), "ROSE_0" if k % 2 else "BROWN_2")
        p.px(x + 1, y - 6, "RIM" if k == 0 else "ROSE_1")
    p.line(Pi(rz0, 1.0, top_h + 0.12), Pi(rz1, 1.0, top_h + 0.12), "SLATE_0")
    p.line(Pi(rz0, 1.0, top_h), Pi(rz1, 1.0, top_h), "INK")
    mx, my = Pi(z1 - 0.2, 0.9, top_h)
    p.rect(mx - 1, my - 3, mx + 1, my - 1, "TERRA_0" if t < 5 else "PLUM_1")
    p.px(mx + 2, my - 2, "TERRA_0" if t < 5 else "PLUM_1")
    p.px(mx + 1, my - 3, "RIM")
    contact_shadow(p, z0, z1, d0, d1)
    return p


reg("kitchen.cart", {"t1": cart(1), "t3": cart(3), "t5": cart(5), "base": cart(3)}, zone="kitchen", kind="decor",
    layer=4, note="counter with the dish rack, a mug and two water jugs: t1 a taped moving box, t3 black wire cart, "
                  "t5 wood cart")

# ------------------------------------------------------------------ power strip and cables on the floor
p = Pen(-4, 140, 74, 236)
sx0, sy0 = Pi(14.85, 1.75, 0)
sx1, sy1 = Pi(14.85, 2.75, 0)
p.rect(sx0, sy0 - 2, sx1, sy0, "INK")
p.line((sx0, sy0 - 2), (sx1, sy0 - 2), "BROWN_1")
p.px(sx1 - 1, sy0 - 1, "CRT_1")
glow(p, sx1 - 1, sy0 - 1, 3, RED, 0, RED, xmax=74)
for i in range(3):
    p.px(sx0 + 2 + i * 3, sy0 - 1, "VOID")
# cords: to the fridge back, up the wall to the microwave, and out toward the door
p.sag((sx0 + 2, sy0 - 2), Pi(13.4, FD + 0.1, 0), 2, "VOID")
p.sag((sx0 + 5, sy0 - 2), Pi(12.8, 0.4, 0), 3, "INK")
p.sag((sx1, sy0 - 1), Pi(12.4, 3.6, 0), -2, "INK")
p.sag(Pi(12.4, 3.6, 0), Pi(11.3, 2.6, 0), 2, "INK")
reg("kitchen.cables", {"base": p}, zone="kitchen", kind="decor", layer=4,
    note="power strip on the floor with a lit red switch; cords to the fridge, up the wall to the microwave, toward the door")

# ------------------------------------------------------------------ high pantry shelf
p = Pen(-80, 40, 6, 100)
z0, z1, d0, d1, hs = 15.4, 18.6, 0.0, 1.0, 7.05
box(p, z0, z1, d0, d1, hs - 0.1, hs, "INK", "BROWN_1", "BROWN_2", rim="TERRA_1", rimfront=False)
for z in (z0 + 0.3, z1 - 0.3):
    a = Pi(z, 0.0, hs - 0.1)
    p.line(a, (a[0], a[1] + 4), "INK")
# cereal box, ramen packs, peanut butter jar, stacked bowls, a pot with a lid
box(p, 15.6, 16.1, 0.15, 0.85, hs, hs + 1.0, "BROWN_1", lambda z, h, x, y: "ROSE_0" if hs + 0.35 < h < hs + 0.6 else "TERRA_0",
    "TERRA_0", rim="TERRA_1", edge=None)
for k in range(3):
    box(p, 16.25, 16.95, 0.2, 0.9, hs + k * 0.2, hs + k * 0.2 + 0.18, "BROWN_1", "TERRA_0" if k != 1 else "TERRA_1",
        "TERRA_0", rim=None, edge="INK")
    lx_, ly_ = Pi(16.6, 0.9, hs + k * 0.2 + 0.09)
    p.px(lx_, ly_, "CRT_0")
box(p, 17.1, 17.4, 0.3, 0.7, hs, hs + 0.42, "BROWN_2", "AMBER", "GOLD_DK", rim=None, edge=None)
jx, jy = Pi(17.25, 0.5, hs + 0.42)
p.line((jx - 1, jy - 1), (jx + 1, jy - 1), "CRT_0")
for k in range(3):
    box(p, 17.6, 18.0, 0.2 + k * 0.02, 0.9 - k * 0.02, hs + k * 0.08, hs + k * 0.08 + 0.07, "BROWN_2", "ROSE_0", "ROSE_0",
        rim=None, edge=None)
box(p, 18.1, 18.5, 0.15, 0.85, hs, hs + 0.45, "INK", "INK_COOL", "INK", rim="TERRA_1", edge=None)
kx, ky = Pi(18.3, 0.5, hs + 0.45)
p.px(kx, ky - 1, "BROWN_2")
reg("kitchen.pantry", {"base": p}, zone="kitchen", kind="decor", layer=5,
    note="high pantry shelf: cereal box, ramen packs, a peanut butter jar, stacked bowls, a pot")

# ------------------------------------------------------------------ trash bin
p = Pen(-36, 200, -6, 240)
z0, z1, d0, d1 = 16.6, 17.25, 0.15, 1.05
box(p, z0, z1, d0, d1, 0, 1.45, "INK", "BROWN_1", "VOID", rim="TERRA_1")
face(p, "top", 1.45, z0 + 0.06, z1 - 0.06, d0 + 0.08, d1 - 0.08, "INK_COOL")
x, y = Pi(z1 - 0.2, (d0 + d1) / 2, 1.45)
p.line((x - 2, y - 1), (x + 1, y - 2), "ROSE_0")  # a crumpled wrapper sticking out
p.px(x + 2, y - 2, "CREAM")
contact_shadow(p, z0, z1, d0, d1)
reg("kitchen.trash", {"base": p}, zone="kitchen", kind="decor", layer=5, note="trash bin with a wrapper poking out")

# ------------------------------------------------------------------ coat hooks with jacket and cap (tiers)


def hooks(t: int) -> Pen:
    p = Pen(-80, 80, -16, 200)
    z0, z1, hh = 17.5, 19.4, 5.45
    if t == 1:
        nails = [18.2]
    else:
        rail = "INK" if t == 3 else "TERRA_0"
        face(p, "side", 0.06, z0, z1, hh - 0.08, hh + 0.12, rail)
        p.line(Pi(z0, 0.06, hh + 0.12), Pi(z1, 0.06, hh + 0.12), "TERRA_1" if t == 3 else "ORANGE")
        nails = [17.75, 18.35, 18.95]
    for z in nails:
        x, y = Pi(z, 0.1, hh)
        p.px(x, y, "GOLD" if t == 5 else "BROWN_2")
        p.px(x, y + 1, "GOLD_DK" if t == 5 else "INK")
    # jacket on the first hook: collar, shoulders, open front, sleeves hanging at the sides
    jx, jy = Pi(nails[0] if t == 1 else 17.75, 0.25, hh)
    p.poly([(jx - 1, jy + 1), (jx + 1, jy + 1), (jx + 6, jy + 5), (jx + 7, jy + 32), (jx - 6, jy + 33),
            (jx - 5, jy + 5)], "BROWN_1")
    p.line((jx - 5, jy + 6), (jx - 6, jy + 30), "INK")  # far sleeve in shade
    p.line((jx - 4, jy + 6), (jx - 5, jy + 30), "INK")
    p.line((jx + 6, jy + 6), (jx + 7, jy + 30), "TERRA_1")  # near sleeve catches the light
    p.line((jx + 5, jy + 7), (jx + 5, jy + 29), "BROWN_2")
    p.line((jx, jy + 4), (jx, jy + 32), "INK")  # open front
    p.line((jx - 2, jy + 2), (jx, jy + 5), "BROWN_2")  # collar
    p.line((jx + 2, jy + 2), (jx, jy + 5), "BROWN_2")
    p.line((jx - 5, jy + 31), (jx + 6, jy + 31), "BROWN_0")  # hem band
    p.px(jx + 7, jy + 31, "RIM")
    if t >= 3:
        # Tulane cap on the second hook, a tote on the third
        cx, cy = Pi(18.35, 0.25, hh)
        p.rect(cx - 3, cy + 1, cx + 3, cy + 5, "LEAF_1")  # crown
        p.line((cx - 2, cy), (cx + 2, cy), "LEAF_1")
        p.line((cx + 1, cy + 1), (cx + 3, cy + 4), "LEAF_2")
        p.line((cx - 6, cy + 6), (cx + 3, cy + 6), "LEAF_0")  # brim toward the viewer
        p.px(cx - 1, cy + 3, "SLATE_1")  # the T
        p.px(cx, cy + 2, "SLATE_1")
        p.px(cx - 2, cy + 2, "SLATE_1")
        p.line((cx + 4, cy + 2), (cx + 4, cy + 5), "RIM")
        p.px(cx, cy - 1, "INK")
        tx_, ty_ = Pi(18.95, 0.2, hh)
        p.line((tx_, ty_), (tx_ - 3, ty_ + 6), "BROWN_2")
        p.line((tx_, ty_), (tx_ + 3, ty_ + 6), "BROWN_2")
        p.rect(tx_ - 4, ty_ + 6, tx_ + 4, ty_ + 18, "BROWN_2" if t == 3 else "TERRA_0")
        p.line((tx_ + 4, ty_ + 6), (tx_ + 4, ty_ + 18), "TERRA_1")
        p.rect(tx_ - 2, ty_ + 9, tx_ + 1, ty_ + 12, "BROWN_1")
    else:
        # cap hangs on the same nail
        cx, cy = Pi(18.2, 0.45, hh - 0.35)
        p.rect(cx - 2, cy + 1, cx + 3, cy + 4, "LEAF_1")
        p.line((cx - 5, cy + 5), (cx + 3, cy + 5), "LEAF_0")
        p.px(cx, cy + 2, "SLATE_1")
        p.line((cx + 4, cy + 1), (cx + 4, cy + 4), "RIM")
    return p


reg("kitchen.hooks", {"t1": hooks(1), "t3": hooks(3), "t5": hooks(5), "base": hooks(3)}, zone="kitchen",
    kind="decor", layer=5,
    note="coat hooks by the door: jacket and a green Tulane cap; t1 a single nail, t3 black rail, t5 wood rail with brass hooks")

# ------------------------------------------------------------------ shoe rack with sneakers and the key bowl (tiers)


def shoes(t: int) -> Pen:
    p = Pen(-80, 190, -10, 250)
    z0, z1, d0, d1 = 17.4, 19.4, 0.0, 1.0
    if t == 1:
        # sneakers piled in a cardboard box
        box(p, z0 + 0.3, z1 - 0.4, d0, d1, 0, 0.9, "BROWN_1", "TERRA_0", "VOID", rim="TERRA_1")
        tops = [(17.9, 0.5, "ROSE_0"), (18.5, 0.4, "INK"), (18.2, 0.7, "CRT_0")]
        for z, d, n in tops:
            x, y = Pi(z, d, 0.9)
            p.rect(x - 3, y - 2, x + 3, y, n)
            p.px(x + 3, y - 2, "RIM")
        top = 0.9
    else:
        wood = t == 5
        for hh in (0.0, 0.5, 1.0):
            face(p, "top", hh + 0.05, z0, z1, d0, d1, "TERRA_0" if wood else "INK")
            p.line(Pi(z0, d1, hh + 0.05), Pi(z1, d1, hh + 0.05), "TERRA_1" if wood else "BROWN_1")
            p.line(Pi(z1, d0, hh + 0.05), Pi(z1, d1, hh + 0.05), "TERRA_1" if wood else "BROWN_1")
        for z in (z0, z1):
            p.line(Pi(z, d1, 0), Pi(z, d1, 1.05), "TERRA_1" if wood else "BROWN_1")
        p.line(Pi(z1, d0, 0), Pi(z1, d0, 1.05), "BROWN_1" if wood else "INK")
        p.line(Pi(z0, d1, 1.05), Pi(z1, d1, 1.05), "ORANGE" if wood else "RIM")
        pairs = [(17.8, "ROSE_0", "CREAM"), (18.45, "INK", "ROSE_0"), (19.05, "CRT_0", "ROSE_0")]
        for row, hh in enumerate((0.55, 0.05)):
            for i, (z, c1, c2) in enumerate(pairs):
                if row == 1 and i == 1:
                    continue
                for k in (0, 1):
                    x, y = Pi(z + k * 0.22, 0.5, hh)
                    p.rect(x - 3, y - 3, x + 2, y - 1, c1 if row == 0 else "BROWN_2")
                    p.line((x - 3, y - 1), (x + 2, y - 1), c2 if row == 0 else "BROWN_1")
                    p.px(x + 2, y - 3, "RIM")
        top = 1.05
    # key bowl on top with keys and a lanyard
    kx, ky = Pi(18.9, 0.5, top)
    p.rect(kx - 3, ky - 2, kx + 2, ky - 1, "BROWN_2")
    p.line((kx - 3, ky - 2), (kx + 2, ky - 2), "TERRA_1")
    p.px(kx - 1, ky - 3, "GOLD")
    p.px(kx, ky - 3, "GOLD_DK")
    p.line((kx + 2, ky - 1), (kx + 3, ky + 4), "LEAF_2")
    return p


reg("kitchen.shoes", {"t1": shoes(1), "t3": shoes(3), "t5": shoes(5), "base": shoes(3)}, zone="kitchen",
    kind="decor", layer=5,
    note="shoe rack with sneakers and the key bowl on top: t1 sneakers in a cardboard box, t3 black rack, t5 wood rack")

# ============================================================================================ glows and save


def apply_glows():
    """Light tints: shell pixels near each small light take a warmer colour (Bayer falloff). Pixels covered by any
    other item of this part are left alone (their own art carries the light)."""
    cover = {}
    for iid, vs in PENS.items():
        for pen in vs.values():
            for yy in range(pen.h):
                for xx in range(pen.w):
                    if pen.s.get(xx, yy) is not None:
                        cover.setdefault((pen.ox + xx, pen.oy + yy), set()).add(iid)
    owner = {id(pen): iid for iid, vs in PENS.items() for pen in vs.values()}
    for pen, cx, cy, r, mp, inner, imp, xmax, own, sy in GLOWS:
        me = owner[id(pen)]
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if x > xmax or not pen.inside(x, y):
                    continue
                dist = ((x - cx) ** 2 + ((y - cy) / sy) ** 2) ** 0.5
                if dist > r:
                    continue
                # solid core, then a 2 px Bayer edge (no screen-door wash)
                edge = (dist - (r - 2.5)) / 2.5
                if edge > 0 and bay(x, y) < edge:
                    continue
                cur = pen.get(x, y)
                if cur is not None:
                    if not own:
                        continue
                    base = cur
                else:
                    if cover.get((x, y), set()) - {me}:
                        continue
                    base = shell_at(x, y)
                    if base is None:
                        continue
                m = imp if dist <= inner else mp
                if base in m and m[base] != base:
                    if cur is not None and base in ("GLOW", "SUN", "AMBER", "CRT_1", "CREAM"):
                        continue
                    pen.px(x, y, m[base])
    for pen, z0, z1, h_top, rows in WASHES:
        me = owner[id(pen)]
        xa, xb = sorted((Pi(z0, 0, h_top)[0], Pi(z1, 0, h_top)[0]))
        for x in range(xa, xb + 1):
            z, _ = inv_side(x + 0.5, 0, 0)
            y0 = Pi(z, 0, h_top)[1]
            # soften the two ends
            end = min(x - xa, xb - x)
            for k, m in enumerate(rows):
                y = y0 + k
                if end < 2 and k > 1:
                    continue
                if m == "half":
                    if (x + y) % 2:
                        continue
                    m = WARM
                if not pen.inside(x, y) or pen.get(x, y) is not None or cover.get((x, y), set()) - {me}:
                    continue
                base = shell_at(x, y)
                if base in m:
                    pen.px(x, y, m[base])


apply_glows()

for it in ITEMS:
    iid = it.pop("id")
    variants = {k: pen.save(f"{iid.replace('.', '-')}-{k}") for k, pen in PENS[iid].items()}
    first = next(iter(PENS[iid].values()))
    item(iid, x=first.ox, y=first.oy, variants=variants, **it)

finish(PART)
