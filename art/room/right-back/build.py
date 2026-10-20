#!/usr/bin/env python3
"""FORGE v3 room, part "right-back": zone study (key 5) and zone computer (key 6).

Study (back wall, x 378..464, plus the floor in front): study desk with a drawer pedestal, chair pushed in with
a jacket, backpack leaning on the desk (ACADEMICS, stages + alert), wall calendar (TIME BLOCKING, stages),
open notebook on the desk (JOURNAL), school-spirit pennant (original design), empty picture frame, clock,
corkboard with notes, small shelf with books and a pothos, desk lamp (tiers), textbook stack with headphones,
mug, pen cup, printer, trash can with paper balls, a box and a power strip under the desk, floor cables.

Computer (back part of the right wall, x 464..540, plus the floor in front): computer desk along the right wall
(tiers: folding desk, proper desk, custom desk), main monitor (AI BUILDING), second monitor (DROPSHIPPING),
sticky note on the main bezel (FOCUS), PC tower with red LEDs, keyboard and mouse, desk mic, speaker, webcam,
energy drink, cable tray, wall shelf with figures, router with blinking lights, poster (tiers; t5 is a neon
FORGE sign), chair (tiers), corner snake plant, floor cables.

Geometry
  Right wall: P(z, d, h) with z = feet along the wall from the back corner (x 464) toward the viewer, d = feet
  out from the wall toward the room, h = feet above the floor. Mirrors the left part's projection (same D, K,
  15.1 px per foot at the back wall) so both side walls agree with room.py's wall_point / depth_scale.
  Back wall: B(X, q, h) with X = back-wall x, q = feet out from the back wall, h = feet above the floor.

Draw order: the engine sorts by layer, contact y (y + image height), manifest order. Things standing on a desk
are padded with transparent rows so their contact y equals the desk's, and are declared after it.

Run: python3 art/room/right-back/build.py      (deterministic: no RNG, only fixed hashes and Bayer)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

PART = "right-back"
RGB2N = {tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)): n for n, h in HEX.items()}
B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bay(x: int, y: int) -> float:
    """4x4 Bayer threshold anchored to WORLD coordinates."""
    return (B4[int(y) % 4][int(x) % 4] + 0.5) / 16


def hsh(*v: int) -> float:
    h = 2166136261
    for a in v:
        h = ((h ^ (int(a) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535


# =============================================================== projection
D = 50.0  # eye to back wall, feet
K = 0.55  # out-of-wall foreshortening on the side walls (same as the left part)
PXF = 136 / 9  # px per foot at the back wall
WX = 397.42  # right-wall bottom run in x per unit of scale
DB = 30.0  # out-of-wall depth for back-wall furniture (slightly opened up so desk tops read)


def S(z):
    return D / (D - z)


def P(z, d=0.0, h=0.0):
    s = S(z)
    return 464 + WX * (s - 1) - 15 * K * d * s, 121 + 77 * s - PXF * h * s


def Pi(z, d=0.0, h=0.0):
    x, y = P(z, d, h)
    return round(x), round(y)


def SB(q):
    return DB / (DB - q)


def B(X, q=0.0, h=0.0):
    s = SB(q)
    return 320 + (X - 320) * s, 121 + (77 - PXF * h) * s


def Bi(X, q=0.0, h=0.0):
    x, y = B(X, q, h)
    return round(x), round(y)


def inv(kind, c, x, y):
    """Plane coordinates (a, b) of screen point (x, y) on a plane, or None."""
    if kind == "side":  # right wall parallel plane d = c: a = z, b = h
        s = (x - 464 + WX) / (WX - 15 * K * c)
        if s <= 0.3:
            return None
        return D * (1 - 1 / s), (121 + 77 * s - y) / (PXF * s)
    if kind == "front":  # plane z = c facing the viewer: a = d, b = h
        s = S(c)
        return (464 + WX * (s - 1) - x) / (15 * K * s), (121 + 77 * s - y) / (PXF * s)
    if kind == "top":  # horizontal plane h = c: a = z, b = d
        den = 77 - PXF * c
        if abs(den) < 1e-6:
            return None
        s = (y - 121) / den
        if s <= 0.3:
            return None
        return D * (1 - 1 / s), (464 + WX * (s - 1) - x) / (15 * K * s)
    if kind == "bfront":  # back-wall parallel plane q = c: a = X, b = h
        s = SB(c)
        return 320 + (x - 320) / s, (77 - (y - 121) / s) / PXF
    if kind == "btop":  # horizontal plane h = c over the back-wall furniture: a = X, b = q
        den = 77 - PXF * c
        s = (y - 121) / den
        if s <= 0.3:
            return None
        return 320 + (x - 320) / s, DB * (1 - 1 / s)
    if kind == "bside":  # plane X = c (left side of a back-wall box): a = q, b = h
        s = (x - 320) / (c - 320)
        if s <= 0.3:
            return None
        return DB * (1 - 1 / s), (77 - (y - 121) / s) / PXF
    raise ValueError(kind)


def corners(kind, c, a0, a1, b0, b1):
    if kind == "side":
        f = lambda a, b: P(a, c, b)  # noqa: E731
    elif kind == "front":
        f = lambda a, b: P(c, a, b)  # noqa: E731
    elif kind == "top":
        f = lambda a, b: P(a, b, c)  # noqa: E731
    elif kind == "bfront":
        f = lambda a, b: B(a, c, b)  # noqa: E731
    elif kind == "btop":
        f = lambda a, b: B(a, b, c)  # noqa: E731
    else:
        f = lambda a, b: B(c, a, b)  # noqa: E731
    return [f(a0, b0), f(a1, b0), f(a1, b1), f(a0, b1)]


# =============================================================== pen
class Pen:
    """World-space pen on a palette-locked sprite. Colours are palette NAMES."""

    def __init__(self, x0, y0, x1, y1):
        self.ox, self.oy = x0, y0
        self.w, self.h = x1 - x0 + 1, y1 - y0 + 1
        self.s = spr(self.w, self.h)

    def _o(self, only):
        return only if only in (None, "opaque", "empty") else HEX[only]

    def inside(self, x, y):
        return 0 <= x - self.ox < self.w and 0 <= y - self.oy < self.h

    def px(self, x, y, n, only=None):
        x, y = round(x), round(y)
        if not self.inside(x, y):
            return
        if only == "empty" and self.get(x, y) is not None:
            return
        if only == "opaque" and self.get(x, y) is None:
            return
        if only not in (None, "empty", "opaque") and self.get(x, y) != only:
            return
        self.s.px(x - self.ox, y - self.oy, None if n is None else HEX[n])

    def get(self, x, y):
        x, y = round(x), round(y)
        if not self.inside(x, y):
            return None
        v = self.s.get(x - self.ox, y - self.oy)
        if v is None or (len(v) > 3 and v[3] == 0):
            return None
        return RGB2N[tuple(v[:3])]

    def line(self, a, b, n, only=None):
        x0, y0 = round(a[0]), round(a[1])
        x1, y1 = round(b[0]), round(b[1])
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, n, only)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def rect(self, x0, y0, x1, y1, n, fill=True, only=None):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if fill or x in (x0, x1) or y in (y0, y1):
                    self.px(x, y, n, only)

    def poly(self, pts, n, only=None):
        """Scanline polygon fill on pixel centres."""
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
            yc = y + 0.5
            xs = []
            for (xa, ya), (xb, yb) in zip(pts, pts[1:] + pts[:1]):
                if (ya <= yc < yb) or (yb <= yc < ya):
                    xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(xs[i] - 0.5) - 1, int(xs[i + 1]) + 2):
                    if xs[i] <= x + 0.5 < xs[i + 1]:
                        self.px(x, y, n, only)

    def circ(self, cx, cy, r, n, fill=True, only=None):
        for y in range(cy - r - 1, cy + r + 2):
            for x in range(cx - r - 1, cx + r + 2):
                dd = (x - cx) ** 2 + (y - cy) ** 2
                if fill and dd <= r * r + r * 0.8:
                    self.px(x, y, n, only)
                elif not fill and r * r - r * 0.8 < dd <= r * r + r * 0.8:
                    self.px(x, y, n, only)

    def sag(self, a, b, sag, n, only=None):
        x0, y0 = a
        x1, y1 = b
        steps = max(2, int(abs(x1 - x0)) + int(abs(y1 - y0)))
        pts = [(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t + 4 * sag * t * (1 - t)))
               for t in (i / steps for i in range(steps + 1))]
        for p, q in zip(pts, pts[1:]):
            self.line(p, q, n, only=only)
        return pts

    def face(self, kind, c, a0, a1, b0, b1, col, only=None):
        """Fill a plane rectangle. col: palette name or fn(a, b, x, y) -> name | None."""
        cs = corners(kind, c, a0, a1, b0, b1)
        xs = [p[0] for p in cs]
        ys = [p[1] for p in cs]
        lo_a, hi_a = min(a0, a1), max(a0, a1)
        lo_b, hi_b = min(b0, b1), max(b0, b1)
        for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
            for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
                r = inv(kind, c, x + 0.5, y + 0.5)
                if r is None:
                    continue
                a, b = r
                if lo_a <= a <= hi_a and lo_b <= b <= hi_b:
                    n = col(a, b, x, y) if callable(col) else col
                    if n:
                        self.px(x, y, n, only)

    def cells(self, kind, c, a0, a1, b0, b1):
        """Pixels of a plane rectangle grouped by column: {x: [y...]} (for 1:1 screen content)."""
        out = {}
        cs = corners(kind, c, a0, a1, b0, b1)
        xs = [p[0] for p in cs]
        ys = [p[1] for p in cs]
        for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
            for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
                r = inv(kind, c, x + 0.5, y + 0.5)
                if r and a0 <= r[0] <= a1 and b0 <= r[1] <= b1:
                    out.setdefault(x, []).append(y)
        return out

    def recolor(self, mapping, box=None, prob=1.0, seed=0, test=None):
        x0, y0, x1, y1 = box or (self.ox, self.oy, self.ox + self.w - 1, self.oy + self.h - 1)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = self.get(x, y)
                if c in mapping and (prob >= 1 or hsh(seed, x, y) < prob) and (test is None or test(x, y)):
                    self.px(x, y, mapping[c])

    def bounds(self):
        xs, ys = [], []
        for y in range(self.oy, self.oy + self.h):
            for x in range(self.ox, self.ox + self.w):
                if self.get(x, y) is not None:
                    xs.append(x)
                    ys.append(y)
        return min(xs), min(ys), max(xs), max(ys)

    def save(self, name):
        return save(self.s, f"{PART}/{name}")


def pens(box, keys):
    return {k: Pen(*box) for k in keys}


def glow(pen, cx, cy, r, n, strength=0.5, sy=1.0, test=None):
    """Dithered halo of colour n into EMPTY pixels (it lands on the shell wall or floor underneath)."""
    for y in range(int(cy - r * sy) - 1, int(cy + r * sy) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            dd = (((x - cx) ** 2 + ((y - cy) / sy) ** 2) ** 0.5) / r
            if dd < 1 and bay(x, y) < strength * (1 - dd) and (test is None or test(x, y)):
                pen.px(x, y, n, only="empty")


def shade(pen, cx, cy, r, mapping, strength=0.6, sy=1.0, test=None):
    """Local light on OPAQUE pixels of this pen: remap colours by Bayer falloff around (cx, cy)."""
    for y in range(int(cy - r * sy) - 1, int(cy + r * sy) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            dd = (((x - cx) ** 2 + ((y - cy) / sy) ** 2) ** 0.5) / r
            c = pen.get(x, y)
            if c in mapping and dd < 1 and bay(x, y) < strength * (1 - dd) and (test is None or test(x, y)):
                pen.px(x, y, mapping[c])


WARM = {"BROWN_0": "BROWN_2", "BROWN_1": "BROWN_2", "INK": "BROWN_0", "BROWN_2": "TERRA_1", "TERRA_0": "TERRA_1",
        "TERRA_1": "TERRA_2", "ROSE_0": "ROSE_1", "VOID": "INK", "PLUM_0": "PLUM_1", "LEAF_0": "LEAF_1",
        "LEAF_1": "LEAF_2", "SLATE_0": "SLATE_1"}
REDLIT = {"INK": "TERRA_0", "BROWN_0": "TERRA_0", "BROWN_1": "TERRA_0", "BROWN_2": "TERRA_1", "VOID": "BROWN_0"}

# ---------------------------------------------------------------- tiny glyphs (neon sign)
GLYPH = {
    "F": ["####", "#...", "###.", "#...", "#...", "#..."],
    "O": [".##.", "#..#", "#..#", "#..#", "#..#", ".##."],
    "R": ["###.", "#..#", "###.", "#.#.", "#..#", "#..#"],
    "G": [".###", "#...", "#.##", "#..#", "#..#", ".##."],
    "E": ["####", "#...", "###.", "#...", "#...", "####"],
}

_registry: list[tuple[str, dict, dict]] = []


def reg(iid, variants: dict, **kw):
    """Save each variant pen and declare the item (all variants share the pen box)."""
    first = next(iter(variants.values()))
    out = {}
    for key, pen in variants.items():
        assert (pen.ox, pen.oy, pen.w, pen.h) == (first.ox, first.oy, first.w, first.h), iid
        out[key] = pen.save(f"{iid.replace('.', '-')}-{key}")
    if "anim" in kw and kw["anim"]:
        frames = []
        for i, fp in enumerate(kw["anim"]["frames"]):
            frames.append(fp.save(f"{iid.replace('.', '-')}-f{i}"))
        kw["anim"] = {"frames": frames, "fps": kw["anim"]["fps"]}
    item(iid, x=first.ox, y=first.oy, variants=out, **kw)


# =============================================================================================== STUDY
STUDY_CONTACT = 204  # study desk legs end on row 203
COMP_CONTACT = 209  # computer desk legs end on row 208


def pennant():
    p = Pen(383, 72, 424, 94)
    # wooden hoist dowel and the felt strip
    p.line((385, 74), (385, 92), "BROWN_2")
    p.px(385, 73, "RIM")
    p.px(385, 93, "BROWN_0")
    p.rect(386, 75, 388, 91, "SLATE_1")
    p.line((386, 75), (388, 75), "SLATE_2")
    p.line((386, 75), (386, 90), "SLATE_2")
    # green triangle with a slight droop toward the tip
    tri = [(389, 75), (389, 92), (421, 86), (421, 85)]
    p.poly(tri, "LEAF_2")
    # lower half in shade (light from above), top edge lit
    for x in range(389, 422):
        t = (x - 389) / 32
        ytop = 75 + t * 10.5
        ybot = 91.5 - t * 6
        for y in range(int(ytop), int(ybot) + 1):
            if p.get(x, y) == "LEAF_2" and y > ytop + (ybot - ytop) * 0.62:
                p.px(x, y, "LEAF_1")
        p.px(x, round(ytop + 0.4), "LEAF_3" if x < 405 else "LEAF_2", only="opaque")
    for x in range(389, 399):
        p.px(x, 75, "RIM" if x < 394 else "LEAF_3", only="opaque")
    # wave: a sky-blue swell across the middle (original motif, no lettering)
    for x in range(391, 417):
        t = (x - 391) / 25
        import math

        yc = 83 + 1.6 * math.sin(t * 2 * math.pi * 1.2 + 0.4) - t * 1.4
        p.px(x, round(yc), "SLATE_1", only="opaque")
        p.px(x, round(yc) - 1, "SLATE_2" if (x % 5) in (0, 1, 2) else "SLATE_1", only="opaque")
    # crest curl
    for xy in [(395, 80), (396, 79), (397, 79), (398, 80)]:
        p.px(*xy, "SLATE_2", only="opaque")
    # tacks and a shadow on the wall
    p.px(385, 73, "ROSE_0")
    for x in range(390, 422):
        t = (x - 389) / 32
        p.px(x, round(92.5 - t * 6), "BROWN_0", only="empty")
    p.line((389, 93), (389, 93), "BROWN_0")
    return p


def frame():
    p = Pen(421, 69, 443, 88)
    p.rect(422, 71, 441, 86, "TERRA_0")
    p.rect(424, 73, 439, 84, "INK")  # the engine paints the user's photo here (16 x 12 at x 424, y 73)
    p.line((422, 71), (441, 71), "TERRA_1")
    p.line((422, 71), (422, 86), "TERRA_1")
    for x in range(422, 430):
        p.px(x, 71, "RIM")
    p.px(422, 72, "RIM")
    p.line((441, 72), (441, 86), "BROWN_2")
    p.line((422, 86), (441, 86), "BROWN_0")
    p.line((423, 72), (440, 72), "BROWN_2")  # inner bevel, shadowed under the top rail
    p.line((423, 72), (423, 85), "BROWN_2")
    p.line((440, 73), (440, 85), "TERRA_1")
    p.line((424, 85), (440, 85), "TERRA_1")
    # grain specks
    for x, y in [(426, 86), (433, 71), (437, 86), (441, 78)]:
        p.px(x, y, "TERRA_0")
    p.px(431, 70, "BROWN_2")  # nail
    p.line((442, 72), (442, 87), "BROWN_0", only="empty")
    p.line((423, 87), (442, 87), "BROWN_0", only="empty")
    return p


def clock():
    p = Pen(445, 71, 460, 87)
    cx, cy = 452, 79
    p.circ(cx, cy, 5, "INK")
    p.circ(cx, cy, 4, "ROSE_0")
    for x, y in [(449, 76), (450, 75), (448, 77), (451, 75)]:
        p.px(x, y, "ROSE_1")
    for x, y in [(456, 82), (455, 83), (457, 81)]:
        p.px(x, y, "BROWN_2")
    for x, y in [(cx, cy - 4), (cx + 4, cy), (cx, cy + 4), (cx - 4, cy)]:
        p.px(x, y, "BROWN_2")
    p.line((cx, cy), (cx, cy - 3), "INK")
    p.line((cx, cy), (cx + 2, cy + 1), "INK")
    p.px(cx, cy, "VOID")
    p.px(cx - 1, cy + 2, "CRT_0")  # second hand tip
    for x, y in [(449, 74), (450, 74), (451, 74), (448, 75), (447, 76)]:
        p.px(x, y, "RIM")
    for x, y in [(457, 84), (456, 85), (455, 85), (458, 83), (454, 86), (453, 86)]:
        p.px(x, y, "BROWN_0", only="empty")
    return p


def calendar(stage):
    p = Pen(402, 94, 430, 134)
    x0, x1, y0, y1 = 404, 427, 97, 132
    p.px(415, 95, "BROWN_2")  # nail
    p.px(415, 96, "BROWN_0")
    p.rect(x0, y0, x1, y1, "ROSE_0")
    # picture page: a dusk skyline over water
    for y in range(98, 107):
        for x in range(405, 427):
            t = (y - 98) / 9
            n = "PLUM_0" if t < 0.3 else "PLUM_1" if t < 0.55 else "ROSE_1" if t < 0.66 else "TERRA_0"
            if t >= 0.3 and t < 0.55 and bay(x, y) < 0.3:
                n = "PLUM_0"
            p.px(x, y, n)
    p.circ(420, 103, 1, "AMBER")
    for x, h in [(405, 3), (406, 4), (407, 4), (408, 2), (409, 5), (410, 5), (411, 3), (412, 3), (413, 4), (414, 2),
                 (415, 2), (416, 3), (417, 6), (418, 6), (419, 3), (422, 2), (423, 4), (424, 4), (425, 3), (426, 2)]:
        for k in range(h):
            p.px(x, 104 - k, "INK" if k else "BROWN_0")
    for x in range(405, 427):
        p.px(x, 105, "TERRA_1" if bay(x, 105) < 0.5 else "TERRA_0")
        p.px(x, 106, "TERRA_0" if bay(x, 106) < 0.4 else "BROWN_0")
    # spiral binding
    for x in range(404, 428):
        p.px(x, 107, "INK" if x % 2 else "BROWN_2")
    p.px(404, 108, "ROSE_0")
    # month header and weekday row
    p.rect(405, 109, 426, 110, "TERRA_1")
    p.line((405, 109), (414, 109), "TERRA_2")
    for c in range(7):
        p.px(406 + c * 3, 111, "BROWN_2")
    # grid: 7 x 5 cells of 2 x 2, lines BROWN_2
    gx, gy = 405, 112
    for c in range(8):
        p.line((gx + c * 3, gy), (gx + c * 3, gy + 15), "BROWN_2")
    for r in range(6):
        p.line((gx, gy + r * 3), (gx + 21, gy + r * 3), "BROWN_2")

    def cell(c, r, n, full=True):
        x, y = gx + 1 + c * 3, gy + 1 + r * 3
        p.rect(x, y, x + 1, y + 1, n)

    def xmark(c, r, n="CRT_0"):
        x, y = gx + 1 + c * 3, gy + 1 + r * 3
        p.px(x, y, n)
        p.px(x + 1, y + 1, n)

    def block(r, c0, c1, n, hi=None):
        x0b, y = gx + 1 + c0 * 3, gy + 1 + r * 3
        x1b = gx + 1 + c1 * 3 + 1
        p.rect(x0b, y, x1b, y + 1, n)
        if hi:
            p.line((x0b, y), (x1b, y), hi)

    if stage >= 1:
        for c, r in [(0, 0), (1, 0), (2, 0), (4, 1), (0, 1), (2, 2)]:
            xmark(c, r)
        cell(5, 2, "AMBER")
        cell(3, 3, "SLATE_1")
        xmark(1, 1)
    if stage >= 2:
        block(0, 0, 4, "SLATE_1", "SLATE_2")
        block(0, 5, 6, "AMBER")
        block(1, 0, 2, "LEAF_2", "LEAF_3")
        block(1, 3, 4, "PLUM_2")
        block(1, 5, 6, "AMBER")
        block(2, 0, 4, "SLATE_1", "SLATE_2")
        block(2, 5, 5, "TERRA_1")
        block(3, 0, 1, "LEAF_2", "LEAF_3")
        block(3, 2, 4, "PLUM_2")
        block(3, 5, 6, "AMBER")
        block(4, 0, 2, "SLATE_1")
        xmark(6, 2, "CRT_1")
        xmark(3, 4, "CRT_0")
    # top edge catches the light, page shadow, curl
    p.line((x0, y0), (x1, y0), "TERRA_2")
    for x in range(x0, x0 + 7):
        p.px(x, y0, "RIM")
    p.line((x0, y0), (x0, y1), "ROSE_1")
    p.line((x1, y0 + 1), (x1, y1), "BROWN_2")
    p.line((x0 + 1, y1), (x1, y1), "BROWN_2")
    p.px(x1, y1, None)
    p.px(x1 - 1, y1 - 1, "BROWN_2")
    p.line((x1 + 1, y0 + 1), (x1 + 1, y1), "BROWN_0", only="empty")
    p.line((x0 + 1, y1 + 1), (x1, y1 + 1), "BROWN_0", only="empty")
    return p


def corkboard():
    p = Pen(430, 95, 463, 123)
    x0, y0, x1, y1 = 431, 97, 461, 120
    p.rect(x0, y0, x1, y1, "TERRA_0")
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            v = hsh(7, x, y)
            n = "BROWN_2" if v < 0.55 else "TERRA_0" if v < 0.9 else "TERRA_1"
            p.px(x, y, n)
    # frame
    p.rect(x0, y0, x1, y1, "BROWN_0", fill=False)
    p.line((x0, y0), (x1, y0), "TERRA_1")
    for x in range(x0, x0 + 9):
        p.px(x, y0, "RIM")
    p.line((x0, y0), (x0, y1), "TERRA_1")

    def note(x, y, w, h, n, lines=None, pin="CRT_1", fold=True):
        p.rect(x, y, x + w - 1, y + h - 1, n)
        if lines:
            for k in range(1, h - 1, 2):
                p.line((x + 1, y + k), (x + w - 2 - (k % 3 == 1), y + k), lines)
        if fold:
            p.px(x + w - 1, y + h - 1, "BROWN_0")
        p.px(x + w // 2, y, pin)

    note(433, 99, 6, 6, "AMBER", "TERRA_1")
    note(441, 100, 8, 5, "ROSE_1", "ROSE_0", pin="SLATE_2")
    note(451, 99, 5, 5, "PLUM_2", pin="AMBER")
    note(455, 106, 5, 6, "LEAF_2", "LEAF_1")
    # polaroid with a dark photo
    p.rect(434, 108, 440, 116, "ROSE_0")
    p.rect(435, 109, 439, 113, "SLATE_0")
    p.px(436, 112, "LEAF_1")
    p.px(437, 111, "LEAF_1")
    p.px(438, 110, "AMBER")
    p.px(437, 108, "CRT_1")
    # ticket stub and a receipt
    p.rect(443, 110, 451, 112, "TERRA_2")
    p.line((443, 111), (451, 111), "TERRA_1")
    p.px(447, 110, "INK")
    p.rect(450, 114, 452, 119, "ROSE_0")
    p.line((450, 116), (451, 116), "BROWN_2")
    p.px(451, 114, "CRT_1")
    # a string of yarn between two pins
    p.sag((441, 100), (455, 106), 1.2, "CRT_0")
    p.px(441, 100, "SLATE_2")
    p.line((x1 + 1, y0 + 1), (x1 + 1, y1 + 1), "BROWN_0", only="empty")
    p.line((x0 + 1, y1 + 1), (x1 + 1, y1 + 1), "BROWN_0", only="empty")
    return p


def small_shelf():
    p = Pen(382, 100, 403, 126)
    # books (spines facing out), light on their tops
    for x, h, n, hi in [(384, 8, "SLATE_0", "SLATE_1"), (385, 8, "SLATE_0", "SLATE_1"), (386, 7, "TERRA_0", "TERRA_1"),
                        (387, 7, "TERRA_0", "TERRA_1"), (388, 9, "PLUM_0", "PLUM_1"), (389, 9, "PLUM_0", "PLUM_1")]:
        p.line((x, 111 - h), (x, 111), n)
        p.px(x, 111 - h, hi)
    p.px(386, 107, "AMBER")
    p.px(388, 106, "ROSE_0")
    p.line((390, 104), (391, 111), "BROWN_2")  # a leaning book
    p.line((391, 104), (392, 111), "BROWN_1")
    p.px(390, 104, "RIM")
    # terracotta pot with a pothos
    p.rect(394, 107, 399, 111, "TERRA_1")
    p.line((394, 107), (399, 107), "TERRA_2")
    p.line((399, 108), (399, 111), "TERRA_0")
    p.line((394, 111), (399, 111), "TERRA_0")
    for x, y, n in [(395, 105, "LEAF_2"), (396, 104, "LEAF_2"), (397, 105, "LEAF_1"), (394, 106, "LEAF_1"),
                    (398, 106, "LEAF_2"), (399, 105, "LEAF_1"), (393, 105, "LEAF_2"), (396, 106, "LEAF_1"),
                    (395, 103, "LEAF_3"), (397, 103, "LEAF_1"), (400, 106, "LEAF_1")]:
        p.px(x, y, n)
    # board and brackets
    p.line((383, 112), (401, 112), "TERRA_1")
    for x in range(383, 390):
        p.px(x, 112, "RIM")
    p.line((383, 113), (401, 113), "BROWN_0")
    p.line((386, 114), (386, 116), "INK")
    p.px(387, 114, "INK")
    p.line((398, 114), (398, 116), "INK")
    p.px(397, 114, "INK")
    # trailing vines over the edge
    for pts in [[(399, 112), (400, 114), (401, 116), (401, 118), (400, 120), (400, 122)],
                [(396, 112), (396, 115), (395, 117), (395, 119)],
                [(401, 111), (402, 113), (402, 115)]]:
        for i, (x, y) in enumerate(pts):
            p.px(x, y, "LEAF_1" if i % 2 else "LEAF_2")
            if i % 2 == 0 and i:
                p.px(x + 1, y, "LEAF_2" if i % 4 == 0 else "LEAF_1")
    p.line((384, 114), (401, 114), "BROWN_0", only="empty")
    return p


def study_underdesk():
    p = Pen(386, 160, 452, 202)
    # shadow of the desk top on the wall under it: solid bands, a short dithered edge at the bottom
    for y in range(164, 198):
        for x in range(389, 425):
            if y < 170:
                p.px(x, y, "INK")
            elif y < 190 or (y < 194 and bay(x, y) < 0.5):
                p.px(x, y, "BROWN_0")
    # floor under the desk
    for y in range(198, 203):
        for x in range(389, 431):
            p.px(x, y, "INK" if y < 201 or bay(x, y) < 0.5 else "BROWN_0")
    # storage box at the back
    p.rect(392, 187, 404, 198, "BROWN_2")
    p.rect(392, 187, 404, 189, "TERRA_0")
    p.line((392, 187), (404, 187), "TERRA_1")
    p.line((392, 186), (395, 184), "BROWN_2")  # open flap
    p.line((395, 184), (397, 184), "TERRA_0")
    p.line((398, 190), (398, 198), "ROSE_0")  # tape
    p.line((404, 188), (404, 198), "BROWN_0")
    p.line((392, 198), (404, 198), "BROWN_0")
    p.px(400, 193, "ROSE_0")
    p.px(401, 193, "ROSE_0")
    # power strip with a red switch LED
    p.rect(408, 199, 420, 200, "BROWN_1")
    p.line((408, 199), (420, 199), "BROWN_2")
    for x in (411, 414, 417):
        p.px(x, 199, "INK")
    p.px(419, 199, "CRT_1")
    p.px(419, 198, "TERRA_0")
    p.px(420, 198, "TERRA_0")
    # cords up to the desk (lamp, printer)
    p.line((412, 199), (412, 186), "INK")
    p.sag((412, 186), (408, 166), 0.6, "INK")
    p.line((416, 199), (418, 190), "INK")
    p.sag((418, 190), (423, 167), -0.8, "BROWN_1")
    return p


def study_desk():
    p = Pen(383, 158, 452, STUDY_CONTACT - 1)
    X0, X1, Q = 384, 440, 2.0
    TOP = 2.5
    # top surface
    def top(a, b, x, y):
        if b > 1.7:
            return "TERRA_1"
        if b < 0.25:
            return "BROWN_0"
        return "TERRA_0" if hsh(3, x, y) < 0.18 else "BROWN_2"

    p.face("btop", TOP, X0, X1, 0, Q, top)
    # left side panel (faces the window): lit
    p.face("bside", X0, 0, Q, 0, TOP, lambda a, b, x, y: "TERRA_0" if b > 2.1 else "BROWN_2" if b > 0.15 else "BROWN_0")
    # apron
    p.face("bfront", Q, X0, X1, 2.25, TOP, lambda a, b, x, y: "BROWN_1" if b < 2.47 else "TERRA_1")
    # left panel front edge
    p.face("bfront", Q, X0, X0 + 2.6, 0, 2.25, lambda a, b, x, y: "BROWN_1" if a < X0 + 0.9 else "BROWN_0")
    # pedestal: side, front with three drawers
    p.face("bside", 424, 0.05, Q - 0.05, 0, 2.25, lambda a, b, x, y: "INK" if b < 2.0 else "BROWN_0")
    def drawers(a, b, x, y):
        for h in (0.08, 0.8, 1.55):
            if abs(b - h) < 0.06:
                return "INK"
        if b < 0.08:
            return "VOID"
        top_row = any(0 < b - h < 0.09 for h in (0.8, 1.55, 2.2))
        if top_row:
            return "BROWN_2"
        return "BROWN_1" if a > 426 else "BROWN_2"

    p.face("bfront", Q - 0.05, 424, X1, 0, 2.25, drawers)
    for hh in (1.9, 1.15, 0.45):
        x, y = Bi(432, Q, hh)
        p.line((x, y), (x + 3, y), "ROSE_0")
        p.px(x, y, "ROSE_1")
    # corner highlights: front-left edge of the top and the side panel
    x, y = Bi(X0, Q, TOP)
    p.px(x, y, "RIM")
    p.px(x + 1, y, "RIM")
    p.px(x + 2, y, "ORANGE")
    for k in range(3):
        xx, yy = Bi(X0 + 0.2 + k * 0.5, 0.0, TOP)
        p.px(xx, yy, "TERRA_1")
    # side panel's front vertical edge picks up the window
    for hh in [i / 10 for i in range(2, 24)]:
        xx, yy = Bi(X0, Q, hh)
        p.px(xx, yy, "TERRA_1" if hh > 1.2 else "BROWN_2")
    # feet
    xl, yl = Bi(X0, Q, 0)
    p.line((xl, yl - 1), (xl + 3, yl - 1), "VOID")
    return p


def wall_pool(p, cx, base, rx, ry, test):
    """Lamp light on the wall just above the desk: a half-ellipse, solid inner bands, one checker ring."""
    for y in range(base - ry - 1, base):
        for x in range(cx - rx - 1, cx + rx + 2):
            e = ((x - cx) / rx) ** 2 + ((y - base) / ry) ** 2
            if e >= 1 or not test(x, y):
                continue
            n = "TERRA_0" if e < 0.18 else "BROWN_2" if e < 0.55 else ("BROWN_2" if (x + y) % 2 else None)
            if n:
                p.px(x, y, n, only="empty")


def desk_pool(p, cx, r):
    """Light pool on the study desk top (rows 160..163): AMBER core, TERRA_1, a TERRA_0 fringe."""
    for y in range(160, 164):
        for x in range(cx - r, cx + r + 1):
            dd = abs(x - cx) / r + (0.15 if y == 160 else 0)
            n = "AMBER" if dd < 0.3 and y > 160 else "TERRA_1" if dd < 0.62 else "TERRA_0" if dd < 0.85 else (
                "TERRA_0" if dd < 1 and (x + y) % 2 else None)
            if n:
                p.px(x, y, n, only="empty")


def lamp(t):
    """Desk lamp. t1 clip lamp with a bare bulb, t3 black architect lamp, t5 brass banker's lamp."""
    p = Pen(384, 112, 416, STUDY_CONTACT - 1)
    test = lambda x, y: not (403 <= x <= 428 and y <= 133) and y < 160  # keep the wall light off the calendar
    if t == 1:
        # clipped to the shelf above, pointing down; the cord drops behind the desk
        p.line((398, 114), (398, 117), "INK")
        p.px(397, 114, "SLATE_0")
        p.px(399, 114, "SLATE_0")
        p.sag((398, 117), (402, 124), 0.8, "INK")
        p.poly([(400, 124), (405, 124), (407, 129), (398, 129)], "SLATE_0")
        p.line((400, 124), (405, 124), "SLATE_1")
        p.px(400, 125, "RIM")
        p.line((399, 129), (406, 129), "INK")
        p.rect(401, 130, 404, 131, "SUN")
        p.px(401, 131, "GLOW")
        p.px(404, 131, "GLOW")
        p.line((397, 117), (394, 158), "INK")  # cord
        wall_pool(p, 403, 160, 9, 14, test)
        desk_pool(p, 404, 9)
    elif t == 3:
        # base
        p.rect(389, 159, 395, 160, "INK")
        p.line((389, 159), (395, 159), "BROWN_2")
        p.px(389, 159, "RIM")
        # lower arm, spring, upper arm
        p.line((392, 158), (389, 141), "INK")
        p.line((393, 158), (390, 141), "BROWN_1")
        p.px(391, 150, "BROWN_2")
        p.px(390, 146, "BROWN_2")
        p.circ(389, 141, 1, "INK")
        p.px(388, 140, "RIM")
        p.line((389, 140), (399, 135), "INK")
        p.line((389, 139), (398, 134), "BROWN_1")
        p.px(392, 137, "RIM")
        p.px(394, 136, "RIM")
        # cone shade tipped down toward the notebook
        p.poly([(397, 133), (402, 132), (406, 138), (399, 141)], "INK")
        p.line((397, 133), (402, 132), "BROWN_2")
        p.px(397, 133, "RIM")
        p.px(398, 133, "RIM")
        p.line((402, 132), (406, 138), "BROWN_1")
        p.line((399, 141), (406, 138), "GLOW")
        p.px(402, 140, "SUN")
        p.px(403, 140, "SUN")
        p.px(401, 140, "GLOW")
        wall_pool(p, 404, 160, 11, 17, test)
        desk_pool(p, 408, 12)
        p.line((391, 160), (389, 162), "INK")  # cord off the back
    else:
        # brass base and stem, green glass shade
        p.rect(388, 158, 399, 160, "GOLD_DK")
        p.line((388, 158), (399, 158), "GOLD")
        p.px(388, 158, "SUN")
        p.line((393, 157), (393, 149), "GOLD_DK")
        p.line((392, 157), (392, 149), "GOLD")
        p.poly([(386, 148), (388, 143), (398, 143), (401, 148)], "LEAF_1")
        p.line((388, 143), (398, 143), "LEAF_3")
        p.line((387, 145), (397, 145), "LEAF_2")
        p.line((387, 146), (399, 146), "LEAF_2")
        p.px(386, 147, "LEAF_3")
        p.px(387, 144, "LEAF_3")
        p.line((386, 148), (401, 148), "GOLD")
        p.line((388, 149), (399, 149), "GLOW")
        p.line((391, 150), (396, 150), "AMBER")
        p.line((399, 149), (400, 153), "GOLD_DK")  # pull chain
        p.px(400, 154, "GOLD")
        wall_pool(p, 394, 160, 13, 12, test)
        desk_pool(p, 396, 15)
    return p


def textbooks():
    p = Pen(398, 140, 414, STUDY_CONTACT - 1)
    books = [(400, 411, "SLATE_0", "SLATE_1", 158, 160), (401, 410, "TERRA_0", "TERRA_1", 155, 157),
             (399, 409, "PLUM_0", "PLUM_1", 152, 154), (401, 411, "LEAF_0", "LEAF_1", 150, 151)]
    for x0, x1, n, hi, y0, y1 in books:
        p.rect(x0, y0, x1, y1, n)
        p.line((x0, y0), (x1, y0), hi)
        p.line((x0, y1), (x1, y1), "INK" if y1 - y0 > 1 else n)
        p.px(x1, y0, "ROSE_0")  # page block corner
        p.line((x1, y0 + 1), (x1, y1), "ROSE_0")
        p.px(x0 + 3, y0 + 1 if y1 - y0 > 1 else y0, "AMBER" if n != "LEAF_0" else "GOLD_DK")
    p.px(400, 158, "RIM")
    p.px(401, 155, "RIM")
    p.px(399, 152, "RIM")
    p.px(401, 150, "RIM")
    # headphones lying on top
    p.line((402, 148), (403, 145), "INK")
    p.line((404, 144), (408, 144), "INK")
    p.line((409, 145), (410, 148), "INK")
    p.px(403, 144, "INK")
    p.px(409, 144, "INK")
    p.line((404, 143), (408, 143), "BROWN_2")
    p.px(404, 143, "RIM")
    p.rect(401, 147, 403, 149, "BROWN_0")
    p.rect(409, 147, 411, 149, "BROWN_0")
    p.px(401, 147, "BROWN_2")
    p.px(409, 147, "BROWN_2")
    p.px(411, 149, "INK")
    return p


def notebook():
    p = Pen(409, 154, 429, STUDY_CONTACT - 1)
    # cover under the pages
    p.line((410, 163), (427, 163), "TERRA_0")
    p.px(410, 162, "TERRA_0")
    p.px(427, 162, "TERRA_0")
    # two pages dipping toward the gutter (lamp light from the left)
    p.poly([(411.5, 158), (416, 158), (419, 159), (419, 163), (411, 163)], "ROSE_1")
    p.poly([(420, 159), (423, 158), (426.5, 158), (427, 163), (420, 163)], "ROSE_1")
    for x in range(412, 416):
        p.px(x, 158, "CREAM")
    p.px(411, 159, "CREAM")
    p.px(412, 159, "CREAM")
    # gutter shadow
    p.line((419, 159), (419, 162), "BROWN_2")
    p.line((420, 160), (420, 162), "ROSE_0")
    # ruled lines
    for y in (160, 162):
        p.line((412, y), (417, y), "ROSE_0")
        p.line((422, y), (425, y), "ROSE_0")
    p.line((413, 161), (415, 161), "ROSE_0")
    p.px(414, 160, "ROSE_1")
    # ribbon over the front edge
    p.px(424, 163, "CRT_0")
    p.px(424, 164, "CRT_0")
    p.px(425, 165, "TERRA_0")
    # a pen across the right page
    p.line((421, 157), (426, 160), "INK")
    p.px(421, 157, "CRT_0")
    p.px(426, 160, "GOLD")
    p.px(423, 158, "BROWN_2")
    return p


def mug():
    p = Pen(426, 152, 433, STUDY_CONTACT - 1)
    p.rect(427, 155, 430, 160, "TERRA_1")
    p.line((427, 155), (427, 160), "TERRA_2")
    p.line((430, 156), (430, 160), "TERRA_0")
    p.line((428, 155), (429, 155), "INK")  # coffee
    p.px(427, 155, "RIM")
    p.px(430, 155, "TERRA_1")
    p.px(431, 156, "TERRA_0")
    p.px(432, 157, "TERRA_0")
    p.px(431, 158, "TERRA_0")
    p.line((427, 161), (430, 161), "INK")
    p.px(428, 158, "CREAM")  # a small printed mark
    p.px(429, 157, "ROSE_1")
    p.px(428, 153, "BROWN_2")  # thin steam
    p.px(429, 152, "BROWN_2")
    return p


def pencup():
    p = Pen(431, 148, 437, STUDY_CONTACT - 1)
    p.rect(432, 156, 435, 160, "BROWN_1")
    p.line((432, 156), (432, 160), "BROWN_2")
    p.line((432, 156), (435, 156), "INK")
    p.line((432, 161), (435, 161), "INK")
    p.line((433, 155), (432, 151), "CRT_0")
    p.px(432, 150, "INK")
    p.line((434, 155), (435, 150), "AMBER")
    p.px(435, 149, "INK")
    p.line((435, 155), (436, 152), "SLATE_1")
    p.px(433, 153, "BROWN_2")
    return p


def printer():
    p = Pen(436, 143, 451, STUDY_CONTACT - 1)
    # a sheet standing in the rear tray
    p.poly([(440, 144), (446, 144), (447, 152), (439, 152)], "ROSE_1")
    p.line((440, 144), (446, 144), "CREAM")
    p.line((447, 145), (447, 151), "ROSE_0")
    p.line((441, 147), (444, 147), "ROSE_0")
    p.line((441, 149), (445, 149), "ROSE_0")
    # body: one grey box with a rounded top
    p.rect(437, 152, 449, 160, "BROWN_1")
    p.line((438, 151), (448, 151), "BROWN_2")
    p.line((437, 152), (449, 152), "BROWN_2")
    p.px(438, 151, "RIM")
    p.px(437, 152, "RIM")
    p.px(439, 151, "RIM")
    p.line((437, 153), (437, 159), "BROWN_2")
    p.line((449, 153), (449, 160), "BROWN_0")
    # output slot and the tray lip with a printed page
    p.line((439, 156), (447, 156), "INK")
    p.line((439, 157), (447, 157), "ROSE_0")
    p.line((438, 158), (448, 158), "BROWN_2")
    # panel LEDs
    p.px(447, 154, "LEAF_3")
    p.px(445, 154, "AMBER")
    p.line((437, 160), (449, 160), "BROWN_0")
    p.line((437, 161), (449, 161), "INK")
    return p


def study_chair(t):
    """Chair pushed in under the desk, seen from behind; jacket over the back."""
    p = Pen(402, 162, 432, 207)
    if t == 1:
        # metal folding chair
        p.rect(409, 167, 423, 172, "BROWN_1")
        p.line((409, 167), (423, 167), "BROWN_2")
        p.px(409, 167, "RIM")
        p.line((409, 173), (423, 173), "INK")
        p.line((408, 167), (408, 207), "SLATE_0")
        p.line((424, 167), (424, 207), "INK")
        p.line((410, 184), (422, 184), "SLATE_0")  # seat edge
        p.line((410, 185), (422, 185), "INK")
        p.line((410, 186), (422, 203), "INK")  # cross legs
        p.line((422, 186), (410, 203), "INK")
        p.px(408, 207, "VOID")
        p.px(424, 207, "VOID")
        # grey hoodie thrown over
        p.poly([(411, 166), (420, 166), (421, 171), (418, 181), (412, 178)], "BROWN_2")
        p.line((411, 166), (420, 166), "ROSE_0")
        p.line((413, 170), (416, 177), "BROWN_1")
        p.line((418, 172), (418, 180), "BROWN_1")
        p.px(411, 167, "ROSE_0")
        p.line((414, 179), (414, 186), "ROSE_0")  # hood string
        return p
    if t == 3:
        # wooden chair: top rail, spindles, seat, legs
        p.rect(407, 167, 425, 169, "TERRA_0")
        p.line((407, 167), (425, 167), "TERRA_1")
        p.px(407, 167, "RIM")
        p.px(408, 167, "RIM")
        p.line((407, 170), (425, 170), "BROWN_0")
        for x in (411, 416, 421):
            p.line((x, 171), (x, 182), "BROWN_2")
            p.px(x + 1, 175, "BROWN_0")
        p.line((408, 168), (408, 207), "BROWN_2")
        p.line((409, 168), (409, 207), "BROWN_0")
        p.line((423, 168), (423, 207), "BROWN_1")
        p.line((424, 168), (424, 207), "BROWN_0")
        p.rect(407, 183, 425, 185, "TERRA_0")
        p.line((407, 183), (425, 183), "TERRA_1")
        p.line((407, 185), (425, 185), "BROWN_0")
        p.line((411, 186), (411, 202), "BROWN_0")
        p.line((420, 186), (420, 202), "INK")
        p.line((409, 196), (423, 196), "BROWN_1")
        p.px(408, 207, "VOID")
        p.px(424, 207, "VOID")
    else:
        # tufted leather office chair on a star base
        p.poly([(406, 169), (408, 166), (424, 166), (426, 169), (426, 184), (406, 184)], "BROWN_0")
        p.line((408, 166), (424, 166), "BROWN_2")
        p.px(407, 167, "RIM")
        p.px(408, 166, "RIM")
        p.line((406, 169), (406, 184), "BROWN_2")
        for x in (410, 416, 422):
            for y in (171, 177):
                p.px(x, y, "GOLD_DK")
                p.px(x - 1, y + 1, "INK")
                p.px(x + 1, y + 1, "INK")
        p.line((407, 175), (425, 175), "INK")
        p.line((406, 184), (426, 184), "INK")
        p.rect(404, 181, 406, 182, "INK")  # armrests
        p.rect(426, 181, 428, 182, "INK")
        p.px(404, 181, "BROWN_2")
        p.rect(415, 185, 417, 197, "INK")
        p.px(415, 186, "BROWN_2")
        for a, b in [((416, 198), (405, 203)), ((416, 198), (427, 203)), ((416, 198), (410, 206)),
                     ((416, 198), (422, 206))]:
            p.line(a, b, "INK")
        for x, y in [(405, 204), (427, 204), (410, 207), (422, 207)]:
            p.px(x, y, "VOID")
        p.px(406, 202, "BROWN_2")
    # jacket over the back (olive canvas), sleeve hanging on the left
    p.poly([(406, 166), (418, 166), (419, 170), (416, 180), (412, 186), (406, 183)], "PLUM_0")
    p.line((406, 166), (418, 166), "PLUM_1")
    p.line((406, 166), (406, 182), "PLUM_1")
    p.px(406, 166, "ROSE_1")
    p.px(407, 166, "ROSE_1")
    p.line((410, 168), (410, 182), "INK")  # fold
    p.line((414, 169), (413, 178), "INK")
    p.px(416, 168, "BROWN_2")  # collar
    p.px(417, 168, "BROWN_2")
    p.line((404, 174), (404, 188), "PLUM_0")  # sleeve
    p.line((405, 172), (405, 190), "PLUM_1")
    p.px(404, 189, "BROWN_2")
    p.px(405, 191, "BROWN_2")
    return p


def backpack(stage, alert=False):
    p = Pen(375, 170, 396, 205)
    if stage == 0:
        # slumped empty bag, folded over itself on the floor
        p.poly([(379, 197), (383, 194), (391, 195), (393, 199), (393, 205), (379, 205)], "LEAF_1")
        p.poly([(381, 196), (388, 193), (392, 196), (390, 199), (382, 199)], "LEAF_0")  # flopped top
        p.line((383, 193), (388, 193), "LEAF_2")
        p.line((379, 197), (379, 204), "LEAF_2")
        p.px(380, 196, "RIM")
        p.px(381, 195, "RIM")
        p.px(383, 194, "ORANGE")
        p.line((383, 200), (390, 200), "LEAF_0")  # pocket seam
        p.px(386, 199, "ROSE_0")
        p.line((380, 205), (393, 205), "INK")
        p.line((393, 199), (393, 204), "LEAF_0")
        p.sag((379, 203), (375, 205), 0.5, "INK")  # strap on the floor
        p.sag((392, 204), (395, 205), 0.4, "INK")
        return p
    # packed: upright, leaning on the desk's left panel
    body = [(381, 186), (383, 183), (389, 183), (391, 185), (392, 205), (380, 205)]
    p.poly(body, "LEAF_1")
    p.line((383, 183), (389, 183), "LEAF_2")
    for y in range(185, 205):
        p.px(380 + (y < 190), y, "LEAF_2")
        p.px(392 - (y < 197), y, "LEAF_0")
    p.px(381, 186, "RIM")
    p.px(382, 184, "RIM")
    p.px(383, 183, "ORANGE")
    p.px(384, 183, "RIM")
    p.px(380, 191, "RIM")
    p.px(380, 192, "TERRA_2")
    p.line((381, 205), (392, 205), "INK")
    # top handle
    p.line((385, 181), (387, 181), "INK")
    p.px(384, 182, "INK")
    p.px(388, 182, "INK")
    # zip arc
    p.line((383, 186), (389, 186), "LEAF_0")
    p.px(382, 187, "LEAF_0")
    p.px(390, 187, "LEAF_0")
    p.px(389, 186, "ROSE_0")
    # front pocket (LED socket lands at 384..386, 198..200)
    p.poly([(382, 195), (390, 195), (391, 204), (381, 204)], "LEAF_0")
    p.line((382, 195), (390, 195), "LEAF_2")
    p.line((382, 196), (390, 196), "INK")
    p.px(390, 196, "ROSE_0")
    p.line((381, 204), (391, 204), "INK")
    # side strap
    p.sag((380, 188), (379, 202), 0.6, "BROWN_0")
    p.px(379, 203, "INK")
    if stage == 2:
        # laptop slid in behind the top flap: grey shell, lit top and left edges, dark seam
        p.poly([(383.5, 177), (390.5, 175.5), (391.5, 184), (384.5, 185)], "SLATE_0")
        p.line((384, 177), (390, 176), "SLATE_1")
        p.line((384, 178), (384, 184), "SLATE_1")
        p.px(384, 177, "RIM")
        p.line((391, 177), (391, 183), "INK")
        p.line((385, 181), (390, 180), "INK")
        p.line((383, 183), (389, 183), "LEAF_2")
        # keychain: ring and a small green-and-blue fob (original, no logo)
        p.px(381, 197, "GOLD_DK")
        p.px(380, 198, "GOLD")
        p.rect(379, 199, 380, 201, "LEAF_2")
        p.px(379, 200, "SLATE_2")
        p.px(380, 201, "SLATE_1")
    if alert:
        # a red sheet sticking out of the top: something due within 48 h
        p.rect(385, 175, 390, 184, "CRT_0")
        p.line((385, 175), (390, 175), "CRT_1")
        p.line((385, 176), (385, 184), "CRT_1")
        p.line((386, 177), (389, 177), "TERRA_0")
        p.line((386, 179), (388, 179), "TERRA_0")
        p.px(390, 175, "TERRA_0")  # folded corner
        p.line((383, 183), (389, 183), "LEAF_2")
        p.line((384, 184), (390, 184), "LEAF_1")
    return p


def trash():
    p = Pen(436, 186, 466, 207)
    # slatted bin in front of the pedestal
    for y in range(195, 207):
        for x in range(447, 454):
            p.px(x, y, "BROWN_1" if x % 2 else "INK")
    p.line((447, 195), (447, 206), "BROWN_2")
    p.line((447, 194), (453, 194), "BROWN_2")
    p.line((448, 195), (453, 195), "INK")
    p.px(447, 194, "RIM")
    p.line((447, 206), (453, 206), "VOID")
    # paper balls peeking over the rim and on the floor
    for x, y in [(448, 192), (449, 192), (448, 193), (450, 193), (451, 191), (452, 192), (451, 192)]:
        p.px(x, y, "ROSE_0")
    p.px(448, 192, "ROSE_1")
    p.px(451, 191, "ROSE_1")
    for bx, by in [(441, 204), (444, 206), (456, 205), (459, 203)]:
        p.rect(bx, by, bx + 1, by + 1, "ROSE_0")
        p.px(bx, by, "ROSE_1")
        p.px(bx + 1, by + 1, "BROWN_2")
    return p


def study_cables():
    p = Pen(392, 198, 446, 208)
    pts = p.sag((420, 200), (431, 207), 1.0, "INK")
    p.sag((431, 207), (440, 206), -0.7, "INK")
    p.sag((410, 200), (398, 206), 1.2, "INK")
    p.sag((398, 206), (394, 203), -0.6, "INK")
    p.px(395, 203, "BROWN_2")
    p.px(426, 205, "BROWN_2")
    # phone charger end
    p.rect(440, 205, 442, 206, "BROWN_1")
    p.px(440, 205, "ROSE_0")
    return p


# ============================================================================================= COMPUTER
DZ0, DZ1, DD, DH = 1.0, 6.0, 2.5, 2.5  # computer desk: along z, depth, height


def comp_underdesk():
    p = Pen(448, 150, 527, COMP_CONTACT - 1)
    # wall under the desk: solid shadow under the top, a short checker edge lower down
    p.face("side", 0.0, DZ0, DZ1, 0, 2.3,
           lambda a, b, x, y: ("INK" if b > 1.55 or (b > 1.3 and (x + y) % 2) else None))
    # floor shadow under the desk
    p.face("top", 0.0, DZ0, DZ1, 0, DD, lambda a, b, x, y: "INK" if b < 1.9 or (x + y) % 2 else None)
    # cable tray along the wall
    p.face("side", 0.2, 1.5, 5.6, 1.9, 2.1, "INK")
    for z in [1.5 + i * 0.2 for i in range(21)]:
        x, y = Pi(z, 0.2, 2.1)
        p.px(x, y, "BROWN_2" if int(z * 5) % 2 else "BROWN_1")
    # cables sagging out of the tray
    for za, zb, sag, n in [(1.7, 2.6, 2.5, "INK"), (2.4, 3.3, 3.5, "BROWN_1"), (3.2, 4.1, 2.0, "INK"),
                           (3.8, 4.6, 1.5, "BROWN_1"), (4.6, 5.4, 2.0, "INK")]:
        a = Pi(za, 0.25, 1.9)
        b = Pi(zb, 0.25, 1.9)
        p.sag(a, b, sag, n)
    # drops to the power strip on the floor
    p.sag(Pi(3.0, 0.3, 1.9), Pi(3.3, 0.6, 0.1), 0.5, "INK")
    p.sag(Pi(3.6, 0.3, 1.9), Pi(3.6, 0.6, 0.1), -0.5, "BROWN_1")
    p.face("top", 0.12, 2.9, 4.1, 0.4, 0.75, "BROWN_1")
    for z in (3.1, 3.4, 3.7):
        x, y = Pi(z, 0.55, 0.12)
        p.px(x, y, "INK")
    x, y = Pi(4.0, 0.6, 0.12)
    p.px(x, y, "CRT_1")
    glow(p, x, y + 1, 3, "TERRA_0", 0.5)
    # corner snake plant pot sits back in the corner under the desk's end (drawn by corner_plant)
    return p


def tower():
    p = Pen(492, 186, 522, COMP_CONTACT - 1)
    z0, z1, d0, d1, h1 = 4.6, 5.8, 0.3, 1.75, 1.55
    # top (vents)
    p.face("top", h1, z0, z1, d0, d1, lambda a, b, x, y: "BROWN_1" if (x + y) % 3 else "INK")
    # room side: glass panel showing red-lit internals
    def side(a, b, x, y):
        if b < 0.1 or b > h1 - 0.08 or a < z0 + 0.06 or a > z1 - 0.06:
            return "BROWN_1"
        return "VOID" if b > h1 - 0.35 else "INK"

    p.face("side", d1, z0, z1, 0, h1, side)
    for zc, hc in [(4.95, 1.1), (5.45, 1.1)]:  # fans with red rings
        x, y = Pi(zc, d1, hc)
        p.circ(x, y, 2, "CRT_0", fill=False)
        p.px(x, y, "TERRA_0")
    x0, y0 = Pi(4.75, d1, 0.55)
    x1, y1 = Pi(5.65, d1, 0.55)
    p.line((x0, y0), (x1, y1), "TERRA_0")  # GPU
    p.line((x0, y0 + 1), (x1, y1 + 1), "INK")
    # front face toward the viewer: drive bay, LED strip, power button
    def front(a, b, x, y):
        if b < 0.08:
            return "VOID"
        return "BROWN_0" if 0.3 < b < 0.4 or 0.95 < b < 1.05 else "INK"

    p.face("front", z1, d0, d1, 0, h1, front)
    for hh in [i * 0.08 for i in range(2, 18)]:
        x, y = Pi(z1, d1 - 0.18, hh)
        p.px(x, y, "CRT_0")
    x, y = Pi(z1, d1 - 0.18, 1.35)
    p.px(x, y, "CRT_1")
    x, y = Pi(z1, 0.9, 1.35)
    p.px(x, y, "CRT_1")
    p.px(x - 1, y, "BROWN_2")
    x, y = Pi(z1, 0.9, 1.2)
    p.line((x - 3, y), (x + 1, y), "BROWN_1")
    # window-facing back edge
    for hh in [i * 0.1 for i in range(1, 16)]:
        x, y = Pi(z0, d1, hh)
        p.px(x, y, "TERRA_1" if hh > 0.8 else "BROWN_2")
    # red spill on the floor
    p.face("top", 0.0, 4.3, 6.4, d1, 2.7, lambda a, b, x, y: "TERRA_0" if bay(x, y) < 0.3 * (1 - (b - d1) / 1.0) else None,
           only="empty")
    return p


def comp_desk(t):
    """t1 folding table, t3 proper wood desk, t5 custom walnut slab on black steel with a warm LED strip."""
    p = Pen(448, 154, 527, COMP_CONTACT - 1)
    z0, z1, d1, h = DZ0, DZ1, DD, DH
    if t == 1:
        th = 0.08
        p.face("top", h, z0, z1, 0, d1, lambda a, b, x, y: "ROSE_0" if b > d1 - 0.12 else
               ("BROWN_2" if hsh(5, x, y) > 0.08 else "ROSE_0"))
        p.face("side", d1, z0, z1, h - th, h, "BROWN_2")
        p.face("front", z1, 0, d1, h - th, h, "BROWN_1")
        # splayed metal legs (A-frames at both ends) and a sagging brace
        for zz in (z0 + 0.25, z1 - 0.25):
            p.line(Pi(zz, d1 - 0.2, h - th), Pi(zz - 0.15, d1 - 0.05, 0), "SLATE_0")
            p.line(Pi(zz, 0.2, h - th), Pi(zz - 0.15, 0.05, 0), "INK")
            p.line(Pi(zz, d1 - 0.2, 1.2), Pi(zz, 0.2, 1.2), "INK")
        p.line(Pi(z0 + 0.25, d1 - 0.2, 0.6), Pi(z1 - 0.25, d1 - 0.2, 0.6), "INK")
        for k in range(30):
            zz = z0 + (z1 - z0) * k / 29
            x, y = Pi(zz, d1, h)
            p.px(x, y, "ROSE_1" if k < 10 else "ROSE_0")
        x, y = Pi(z0, d1, h)
        p.px(x, y, "RIM")
        return p
    if t == 3:
        th = 0.22
        p.face("top", h, z0, z1, 0, d1, lambda a, b, x, y: "TERRA_0" if hsh(9, round(a * 6), round(b * 3)) < 0.2 else
               ("BROWN_2" if b > 0.25 else "BROWN_0"))
        p.face("side", d1, z0, z1, h - th, h, lambda a, b, x, y: "BROWN_1" if b < h - 0.05 else "TERRA_1")
        p.face("front", z1, 0, d1, h - th, h, "BROWN_0")
        legs = [(z0 + 0.08, d1 - 0.12), (z1 - 0.12, d1 - 0.12), (z1 - 0.12, 0.12)]
        for zz, dd in legs:
            p.face("side", dd + 0.06, zz - 0.08, zz + 0.08, 0, h - th, "BROWN_0")
            p.face("front", zz + 0.08, dd - 0.06, dd + 0.06, 0, h - th, "INK")
            for hh in [i * 0.1 for i in range(1, 22)]:
                x, y = Pi(zz - 0.08, dd + 0.06, hh)
                p.px(x, y, "BROWN_2")
        # rim along the window-facing front edge
        for k in range(40):
            zz = z0 + (z1 - z0) * k / 39
            x, y = Pi(zz, d1, h)
            p.px(x, y, "RIM" if k < 8 else "TERRA_2" if k < 20 else "TERRA_1")
        x, y = Pi(z0, d1, h)
        p.px(x, y, "ORANGE")
        return p
    # t5 custom desk
    th = 0.3
    p.face("top", h, z0, z1, 0, d1, lambda a, b, x, y: "TERRA_1" if hsh(11, round(a * 8), round(b * 2.5)) < 0.22 else
           ("TERRA_0" if b > 0.25 else "BROWN_2"))
    p.face("side", d1, z0, z1, h - th, h, lambda a, b, x, y: "TERRA_0" if b > h - 0.12 else "BROWN_2")
    p.face("front", z1, 0, d1, h - th, h, lambda a, b, x, y: "BROWN_2" if (x + y) % 4 else "TERRA_0")
    # black steel sled frames at both ends
    for zz in (z0 + 0.15, z1 - 0.15):
        p.line(Pi(zz, d1 - 0.1, h - th), Pi(zz, d1 - 0.1, 0), "INK")
        p.line(Pi(zz, 0.1, h - th), Pi(zz, 0.1, 0), "INK")
        p.line(Pi(zz, d1 - 0.1, 0), Pi(zz, 0.1, 0), "INK")
        p.line(Pi(zz, d1 - 0.1, h - th), Pi(zz, 0.1, h - th), "VOID")
    for hh in [i * 0.1 for i in range(1, 22)]:
        x, y = Pi(z0 + 0.15, d1 - 0.1, hh)
        p.px(x - 1, y, "BROWN_2")
    # warm LED strip under the front edge and its spill on the floor
    for k in range(60):
        zz = z0 + 0.3 + (z1 - z0 - 0.6) * k / 59
        x, y = Pi(zz, d1 - 0.15, h - th - 0.04)
        p.px(x, y, "GLOW")
    p.face("top", 0.0, z0 + 0.2, z1 - 0.2, 0.6, d1 + 0.5,
           lambda a, b, x, y: ("TERRA_1" if bay(x, y) < 0.2 else "TERRA_0" if bay(x, y) < 0.55 else None), only="empty")
    for k in range(40):
        zz = z0 + (z1 - z0) * k / 39
        x, y = Pi(zz, d1, h)
        p.px(x, y, "RIM" if k < 10 else "TERRA_2")
    x, y = Pi(z0, d1, h)
    p.px(x, y, "ORANGE")
    return p


MAIN = dict(z0=1.7, z1=4.0, h0=3.25, h1=4.6, d=0.8)
SECOND = dict(z0=4.3, z1=5.8, h0=3.15, h1=4.25, d=0.85)


def screen_cells(p, m):
    """Screen pixels per column (x -> sorted ys), inside a 1-px bezel."""
    bz, bh = 0.08, 0.08
    return p.cells("side", m["d"], m["z0"] + bz, m["z1"] - bz, m["h0"] + 0.22, m["h1"] - bh)


def monitor_body(p, m, cheap=False):
    d = m["d"]
    body = "BROWN_1" if cheap else "INK"
    p.face("side", d, m["z0"], m["z1"], m["h0"], m["h1"], body)
    # thickness toward the viewer (end of the monitor) and the top edge
    p.face("front", m["z1"], d - 0.12, d, m["h0"], m["h1"], "BROWN_0" if not cheap else "BROWN_2")
    for k in range(30):
        zz = m["z0"] + (m["z1"] - m["z0"]) * k / 29
        x, y = Pi(zz, d, m["h1"])
        p.px(x, y, "RIM" if k < 5 else "BROWN_2" if not cheap else "ROSE_0")
    for hh in [m["h0"] + i * 0.08 for i in range(int((m["h1"] - m["h0"]) / 0.08) + 1)]:
        x, y = Pi(m["z0"], d, hh)
        p.px(x, y, "TERRA_1" if hh > (m["h0"] + m["h1"]) / 2 else "BROWN_2")


def fill_screen(p, cells, fn):
    cols = sorted(cells)
    W = len(cols)
    for ci, x in enumerate(cols):
        ys = sorted(cells[x])
        for ri, y in enumerate(ys):
            n = fn(ci, ri, W, len(ys), x, y)
            if n:
                p.px(x, y, n)


def dark_screen(ci, ri, W, H, x, y):
    if ci + ri * 0.4 in range(W // 3, W // 3 + 2) or abs((ci - ri * 0.5) - W * 0.45) < 0.8:
        return "BROWN_1"
    return "VOID" if ri < H * 0.15 else "INK"


def code_screen(busy):
    def fn(ci, ri, W, H, x, y):
        if ri == 0:
            return "BROWN_0" if ci > 2 else "CRT_0" if ci == 0 else "AMBER" if ci == 1 else "LEAF_2"
        split = int(W * 0.58) if busy else W + 1
        if busy and ci == split:
            return "BROWN_0"
        if ci < split:
            if ci == 0:
                return "BROWN_2" if ri % 2 == 0 else "INK"  # line numbers
            row = ri - 1
            if row % 2 == 1:
                return "INK"
            line = row // 2
            indent = [0, 1, 2, 2, 1, 2, 3, 3, 1, 0, 1, 2][line % 12]
            length = [7, 5, 8, 4, 6, 9, 5, 3, 7, 4, 8, 6][line % 12]
            c = ci - 2 - indent * 2
            if 0 <= c < length:
                tok = [("PLUM_3", 2), ("AMBER", 3), ("CREAM", 9), ("LEAF_3", 4), ("GLOW", 9)][(line + c // 3) % 5][0]
                if c < 2 and line % 3 == 0:
                    tok = "PLUM_2"
                if line == 7 and c == length - 1:
                    return "SUN"  # cursor
                return tok if (c + line) % 7 else "BROWN_2"
            return "INK"
        # right pane (busy): chat bubbles over a rising chart
        cj = ci - split - 1
        rw = W - split - 1
        if ri < H * 0.55:
            row = ri - 1
            if row % 3 == 2:
                return "INK"
            side = (row // 3) % 2
            if side == 0 and cj < rw - 2:
                return "BROWN_2" if cj else "ROSE_0"
            if side == 1 and cj > 1:
                return "TERRA_1" if cj < rw - 1 else "AMBER"
            return "INK"
        base = H - 2
        hgt = int(1 + cj * (H * 0.35) / max(1, rw))
        if ri >= base - hgt and ri < base:
            return "GLOW" if ri == base - hgt else "TERRA_0" if bay(x, y) < 0.5 else "INK"
        return "INK"

    return fn


def store_screen(ci, ri, W, H, x, y):
    # store dashboard: header bar, three product tiles, an order count
    if ri < 2:
        return "AMBER" if ri == 0 and ci < W * 0.4 else "TERRA_1"
    if ri == 2:
        return "INK"
    tile_w = max(3, (W - 2) // 3)
    if 3 <= ri <= 3 + tile_w - 1:
        k, c = divmod(ci - 1, tile_w)
        if 0 <= k < 3 and c < tile_w - 1 and ci >= 1:
            prod = ["LEAF_2", "PLUM_2", "SLATE_1"][k]
            r = ri - 3
            if r == tile_w - 2:
                return "ROSE_0"
            return prod if 0 < c < tile_w - 2 and 0 < r < tile_w - 2 else "BROWN_2"
        return "INK"
    r2 = ri - (3 + tile_w + 1)
    if r2 in (0, 2) and 1 <= ci < W - 2:
        return "BROWN_2" if ci < W * 0.6 else "LEAF_3" if r2 == 0 and ci < W * 0.75 else "INK"
    return "INK"


def charts_screen(ci, ri, W, H, x, y):
    if ri == 0:
        return "AMBER" if ci < W * 0.4 else "TERRA_1"
    if ri == 1:
        return "INK"
    # top half: line chart going up, bottom: bar chart, right column: order list
    if ci >= W - 4:
        r = ri - 2
        if r % 2 == 0 and ci < W - 1:
            return "LEAF_3" if r % 4 == 0 else "ROSE_0"
        return "INK"
    mid = H // 2
    if ri < mid:
        t = ci / max(1, W - 5)
        yl = int((mid - 2) * (1 - t) - 1.5 * ((ci * 7) % 3 == 0) + 2)
        if ri == yl or (ri == yl + 1 and ci % 2):
            return "GLOW" if ri == yl else "ORANGE"
        if ri > yl and bay(x, y) < 0.18:
            return "TERRA_0"
        return "INK"
    hbar = [3, 5, 4, 6, 7, 6, 8, 9, 7, 9, 10][ci % 11]
    if ci % 2 == 0 and ri >= H - min(hbar, H - mid - 1) - 1 and ri < H - 1:
        return "TERRA_1" if ci % 4 else "AMBER"
    if ri == H - 1:
        return "BROWN_0"
    return "INK"


def stand(p, m, books=False):
    zc = (m["z0"] + m["z1"]) / 2
    if books:
        # cheap: monitor propped on two textbooks
        p.face("top", m["h0"] - 0.02, zc - 0.55, zc + 0.55, m["d"] - 0.35, m["d"] + 0.45, "ROSE_0")
        p.face("side", m["d"] + 0.45, zc - 0.55, zc + 0.55, DH, DH + 0.35, lambda a, b, x, y: "SLATE_0" if b > DH + 0.18 else "TERRA_0")
        p.face("front", zc + 0.55, m["d"] - 0.35, m["d"] + 0.45, DH, DH + 0.35, "ROSE_0")
        p.face("side", m["d"] + 0.4, zc - 0.4, zc + 0.4, DH + 0.35, m["h0"], "BROWN_1")
        return
    p.face("side", m["d"] - 0.1, zc - 0.07, zc + 0.07, DH, m["h0"], "BROWN_0")
    p.face("top", DH + 0.03, zc - 0.4, zc + 0.4, m["d"] - 0.4, m["d"] + 0.35, "BROWN_0")
    x, y = Pi(zc - 0.07, m["d"] - 0.1, m["h0"] - 0.1)
    p.px(x, y, "BROWN_2")
    x, y = Pi(zc - 0.4, m["d"] + 0.35, DH + 0.03)
    p.px(x, y, "BROWN_2")


def screen_glow_on_desk(p, m, strength):
    """Screen light spilling onto the desk top in front of the monitor (lands on the desk sprite below)."""
    p.face("top", DH + 0.01, m["z0"] - 0.1, m["z1"] + 0.1, m["d"] + 0.3, DD - 0.05,
           lambda a, b, x, y: ("TERRA_0" if bay(x, y) < strength * (1 - (b - m["d"]) / 2.2) else None), only="empty")


def monitor_main(stage):
    p = Pen(462, 126, 500, COMP_CONTACT - 1)
    m = MAIN
    stand(p, m, books=(stage == 0))
    if stage > 0:
        screen_glow_on_desk(p, m, 0.45 if stage == 1 else 0.6)
    monitor_body(p, m, cheap=(stage == 0))
    cells = screen_cells(p, m)
    if stage == 0:
        fill_screen(p, cells, dark_screen)
        x, y = Pi(m["z1"] - 0.2, m["d"], m["h0"] + 0.04)
        p.px(x, y, "AMBER")  # standby
    else:
        fill_screen(p, cells, code_screen(stage == 2))
    return p


def monitor_second(stage):
    p = Pen(482, 126, 524, COMP_CONTACT - 1)
    m = SECOND
    stand(p, m, books=False) if stage else None
    if stage == 0:
        # cheap old monitor on a cardboard box
        p.face("top", m["h0"] - 0.02, 4.7, 5.4, 0.35, 1.3, "TERRA_1")
        p.face("side", 1.3, 4.7, 5.4, DH, m["h0"], lambda a, b, x, y: "TERRA_0" if bay(x, y) < 0.8 else "BROWN_2")
        p.face("front", 5.4, 0.35, 1.3, DH, m["h0"], "BROWN_2")
        x, y = Pi(4.9, 1.3, 2.9)
        p.line((x, y), (x + 3, y), "ROSE_0")
    if stage > 0:
        screen_glow_on_desk(p, m, 0.4 if stage == 1 else 0.55)
    monitor_body(p, m, cheap=(stage == 0))
    cells = screen_cells(p, m)
    if stage == 0:
        fill_screen(p, cells, dark_screen)
    elif stage == 1:
        fill_screen(p, cells, store_screen)
    else:
        fill_screen(p, cells, charts_screen)
        # shipping box at the end of the desk with tape and a label
        bz0, bz1, bd0, bd1, bh = 5.3, 5.95, 1.6, 2.4, DH + 0.5
        p.face("top", bh, bz0, bz1, bd0, bd1, lambda a, b, x, y: "ROSE_0" if abs(b - 2.0) < 0.06 else "TERRA_1")
        p.face("side", bd1, bz0, bz1, DH, bh, lambda a, b, x, y: "TERRA_1" if b > bh - 0.08 else "TERRA_0")
        p.face("front", bz1, bd0, bd1, DH, bh, "BROWN_2")
        x, y = Pi(5.55, bd1, DH + 0.3)
        p.rect(x, y, x + 2, y + 1, "ROSE_1")
        p.px(x, y, "CREAM")
        x, y = Pi(bz0, bd1, bh)
        p.px(x, y, "RIM")
        p.px(x + 1, y, "RIM")
    return p


NOTE = (MAIN["z0"] - 0.1, MAIN["z0"] + 0.36, MAIN["h1"] - 0.52, MAIN["h1"] - 0.04)


def led_on(m):
    """Top-left of a 3x3 LED centred on the monitor's chin."""
    x, y = Pi((m["z0"] + m["z1"]) / 2, m["d"], m["h0"] + 0.11)
    return (x - 1, y - 1)


def note_led():
    za, zb, ha, hb = NOTE
    x, y = Pi((za + zb) / 2, MAIN["d"] + 0.03, ha + 0.15)
    return (x - 1, y - 1)


def sticky_note():
    p = Pen(464, 126, 475, COMP_CONTACT - 1)
    m = MAIN
    za, zb, ha, hb = NOTE
    p.face("side", m["d"] + 0.03, za, zb, ha, hb, lambda a, b, x, y: "AMBER" if b > ha + 0.1 else "GOLD")
    x, y = Pi(za, m["d"] + 0.03, hb)
    p.px(x, y, "GLOW")
    p.px(x + 1, y, "GLOW")
    x, y = Pi(za + 0.1, m["d"] + 0.03, hb - 0.12)
    p.line((x, y), (x + 3, y), "TERRA_1")
    x, y = Pi(zb, m["d"] + 0.03, ha)
    p.px(x, y, "GOLD_DK")
    return p


def keyboard():
    p = Pen(456, 154, 500, COMP_CONTACT - 1)
    # mouse pad and mouse
    p.face("top", DH + 0.01, 3.75, 4.4, 1.5, 2.35, "INK_COOL")
    p.face("top", DH + 0.05, 4.0, 4.18, 1.82, 2.0, "BROWN_1")
    x, y = Pi(4.0, 1.95, DH + 0.06)
    p.px(x, y, "ROSE_0")
    x, y = Pi(4.09, 1.82, DH + 0.06)
    p.px(x, y, "CRT_0")
    # keyboard: body, key rows, lit far edge
    p.face("top", DH + 0.04, 2.1, 3.55, 1.55, 2.2, "INK")
    p.face("top", DH + 0.07, 2.17, 3.48, 1.62, 2.12,
           lambda a, b, x, y: ("BROWN_2" if b > 1.9 and x % 2 else "BROWN_1") if (x + 2 * y) % 3 else "INK")
    p.face("side", 2.2, 2.1, 3.55, DH, DH + 0.06, "VOID")
    for k in range(14):
        zz = 2.1 + 1.45 * k / 13
        x, y = Pi(zz, 1.55, DH + 0.06)
        p.px(x, y, "TERRA_0" if k % 3 else "ROSE_0")
    x, y = Pi(2.1, 2.2, DH + 0.06)
    p.px(x, y, "RIM")
    # cable up to the back
    p.sag(Pi(2.8, 1.55, DH + 0.04), Pi(2.6, 0.3, DH + 0.02), 0.6, "INK")
    return p


def mic():
    p = Pen(482, 136, 494, COMP_CONTACT - 1)
    zc, dc = 4.12, 1.35
    p.face("top", DH + 0.02, zc - 0.18, zc + 0.18, dc - 0.18, dc + 0.18, "INK")
    p.line(Pi(zc, dc, DH + 0.03), Pi(zc, dc, DH + 0.45), "BROWN_1")
    # capsule
    p.face("side", dc + 0.08, zc - 0.11, zc + 0.11, DH + 0.45, DH + 1.15,
           lambda a, b, x, y: ("ROSE_0" if b > DH + 0.8 and (x + y) % 2 else "BROWN_2" if b > DH + 0.8 else "INK"))
    x, y = Pi(zc - 0.11, dc + 0.08, DH + 1.12)
    p.px(x, y, "RIM")
    x, y = Pi(zc, dc + 0.08, DH + 0.62)
    p.px(x, y, "CRT_1")  # mute light
    return p


def speaker():
    """Small speaker turned toward the viewer, left of the main monitor."""
    p = Pen(462, 136, 478, COMP_CONTACT - 1)
    z0, z1, d0, d1, h1 = 1.1, 1.45, 0.15, 0.95, DH + 0.95
    p.face("top", h1, z0, z1, d0, d1, "BROWN_1")
    p.face("side", d1, z0, z1, DH, h1, "BROWN_1")
    p.face("front", z1, d0, d1, DH, h1, "INK")
    x, y = Pi(z1, (d0 + d1) / 2, DH + 0.32)
    p.circ(x, y, 2, "BROWN_1", fill=False)
    p.px(x, y, "BROWN_2")
    p.px(x - 1, y - 1, "BROWN_0")
    x, y = Pi(z1, (d0 + d1) / 2, DH + 0.75)
    p.px(x, y, "BROWN_2")
    p.px(x - 1, y, "BROWN_0")
    for hh in [DH + i * 0.08 for i in range(12)]:
        x, y = Pi(z0, d1, hh)
        p.px(x, y, "TERRA_1" if hh > DH + 0.5 else "BROWN_2")
    x, y = Pi(z0, d1, h1)
    p.px(x, y, "RIM")
    x, y = Pi(z1, d0 + 0.15, DH + 0.1)
    p.px(x, y, "CRT_1")
    return p


def webcam():
    p = Pen(476, 126, 486, COMP_CONTACT - 1)
    m = MAIN
    zc = 2.85
    p.face("side", m["d"] + 0.05, zc - 0.13, zc + 0.13, m["h1"], m["h1"] + 0.17, "INK")
    x, y = Pi(zc, m["d"] + 0.05, m["h1"] + 0.09)
    p.px(x, y, "SLATE_0")
    p.px(x + 1, y, "CRT_1")
    x, y = Pi(zc - 0.13, m["d"] + 0.05, m["h1"] + 0.17)
    p.px(x, y, "BROWN_2")
    return p


def drink():
    p = Pen(478, 150, 490, COMP_CONTACT - 1)
    zc, dc = 4.55, 2.15
    x, y = Pi(zc, dc, DH)
    p.rect(x, y - 5, x + 1, y - 1, "CRT_0")
    p.px(x, y - 5, "ROSE_0")
    p.px(x + 1, y - 5, "BROWN_2")
    p.px(x, y - 3, "CREAM")
    p.px(x + 1, y - 3, "ROSE_1")
    p.px(x, y - 4, "CRT_1")
    p.px(x + 1, y - 1, "TERRA_0")
    # a crushed one on the floor by the tower
    x, y = Pi(6.2, 2.0, 0)
    p.rect(x, y - 1, x + 2, y - 1, "CRT_0")
    p.px(x + 1, y - 2, "ROSE_0")
    p.px(x, y, "INK")
    return p


def shelf():
    p = Pen(466, 96, 526, 136)
    z0, z1, d1, hs = 1.4, 5.6, 0.75, 5.4
    # brackets
    for zz in (1.8, 5.2):
        a = Pi(zz, 0.02, hs - 0.5)
        b = Pi(zz, d1 - 0.1, hs)
        p.line(a, b, "INK")
        p.line(Pi(zz, 0.02, hs), a, "INK")
    # books (spines facing the room)
    for i, (n, hh) in enumerate([("SLATE_0", 0.75), ("TERRA_0", 0.7), ("PLUM_0", 0.82), ("LEAF_0", 0.66), ("BROWN_2", 0.72)]):
        za = 1.5 + i * 0.13
        p.face("side", 0.6, za, za + 0.11, hs, hs + hh, n)
        x, y = Pi(za, 0.6, hs + hh)
        p.px(x, y, "RIM" if i == 0 else "TERRA_1" if i < 3 else "BROWN_2")
    x, y = Pi(1.62, 0.6, hs + 0.5)
    p.px(x, y, "AMBER")
    # figure 1: small robot (boxy head, antenna, red eye)
    p.face("side", 0.45, 2.35, 2.6, hs, hs + 0.28, "BROWN_1")
    p.face("side", 0.45, 2.38, 2.57, hs + 0.3, hs + 0.52, "BROWN_2")
    x, y = Pi(2.47, 0.45, hs + 0.42)
    p.px(x, y, "CRT_1")
    x, y = Pi(2.47, 0.45, hs + 0.52)
    p.line((x, y), (x, y - 2), "INK")
    p.px(x, y - 3, "AMBER")
    x, y = Pi(2.38, 0.45, hs + 0.5)
    p.px(x, y, "RIM")
    # figure 2: little hooded character with a sword (generic)
    p.face("side", 0.45, 4.05, 4.25, hs, hs + 0.45, "PLUM_1")
    p.face("side", 0.45, 4.08, 4.22, hs + 0.45, hs + 0.62, "ROSE_0")
    x, y = Pi(4.06, 0.45, hs + 0.6)
    p.px(x, y, "RIM")
    x, y = Pi(4.3, 0.45, hs + 0.15)
    p.line((x, y), (x, y - 6), "SLATE_1")
    p.px(x, y - 6, "SLATE_2")
    # figure 3: a small gold trophy cup
    p.face("side", 0.4, 4.55, 4.75, hs, hs + 0.12, "GOLD_DK")
    p.face("side", 0.4, 4.6, 4.7, hs + 0.12, hs + 0.28, "GOLD_DK")
    p.face("side", 0.4, 4.52, 4.78, hs + 0.28, hs + 0.48, "GOLD")
    x, y = Pi(4.52, 0.4, hs + 0.46)
    p.px(x, y, "SUN")
    # pothos pot at the right end, trailing over the edge
    p.face("side", 0.55, 5.0, 5.45, hs, hs + 0.42, "TERRA_1")
    x, y = Pi(5.0, 0.55, hs + 0.42)
    p.px(x, y, "TERRA_2")
    leaves = [(5.05, 0.5), (5.2, 0.6), (5.35, 0.52), (5.1, 0.7), (5.28, 0.75), (4.95, 0.55), (5.45, 0.5)]
    for zz, hh in leaves:
        x, y = Pi(zz, 0.6, hs + 0.4 + hh * 0.5)
        p.px(x, y, "LEAF_2")
        p.px(x + 1, y, "LEAF_1")
    for zz, drop in [(5.1, 1.6), (5.4, 2.4), (5.25, 1.1)]:
        x0, y0 = Pi(zz, 0.78, hs)
        for k in range(int(drop * 6)):
            p.px(x0 + (k // 4) % 2, y0 + k, "LEAF_1" if k % 3 else "LEAF_2")
    # the board (we see its front edge and a sliver of the underside: it is above eye level)
    p.face("top", hs - 0.06, z0, z1, 0, d1, "INK")
    p.face("side", d1, z0, z1, hs - 0.08, hs, "BROWN_2")
    for k in range(36):
        zz = z0 + (z1 - z0) * k / 35
        x, y = Pi(zz, d1, hs)
        p.px(x, y, "RIM" if k < 6 else "TERRA_1" if k < 18 else "BROWN_2")
    return p


def router(frame_i):
    p = Pen(482, 112, 498, 132)
    z0, z1, d0, d1, hs = 3.0, 3.65, 0.15, 0.6, 5.4
    p.face("side", d1, z0, z1, hs, hs + 0.22, "INK")
    p.face("front", z1, d0, d1, hs, hs + 0.22, "VOID")
    for zz in (3.08, 3.57):
        a = Pi(zz, d1 - 0.1, hs + 0.22)
        p.line(a, (a[0], a[1] - 6), "INK")
        p.px(a[0], a[1] - 6, "BROWN_2")
    x, y = Pi(z0, d1, hs + 0.22)
    p.px(x, y, "RIM")
    leds = [("LEAF_3", "LEAF_3"), ("AMBER", "INK"), ("AMBER", "AMBER"), ("CRT_1", "INK")]
    for k, (a, b) in enumerate(leds):
        x, y = Pi(z0 + 0.12 + k * 0.13, d1, hs + 0.1)
        p.px(x, y, a if frame_i == 0 else b)
    return p


def comp_poster(t):
    p = Pen(470, 54, 526, 112)
    if t == 1:
        # a printout taped to the wall, a little crooked
        def page(a, b, x, y):
            row = int((7.9 - b) / 0.13)
            if 7.65 < b < 7.8 and 2.6 < a < 3.2:
                return "BROWN_2"
            if b < 7.5 and row % 2 == 0 and 2.55 < a < 3.35 - 0.1 * (row % 3):
                return "BROWN_2"
            return "ROSE_0"

        p.face("side", 0.02, 2.4, 3.5, 6.6, 7.95, page)
        for zz, hh in [(2.4, 7.95), (3.5, 7.95), (2.4, 6.6), (3.5, 6.6)]:
            x, y = Pi(zz, 0.02, hh)
            p.px(x, y, "ROSE_1")
        x, y = Pi(2.4, 0.02, 7.95)
        p.px(x + 1, y, "RIM")
        return p
    if t == 3:
        # framed poster: dusk sun over a skyline (original art)
        za, zb, ha, hb = 2.0, 4.4, 6.25, 8.45

        def art(a, b, x, y):
            u = (a - za) / (zb - za)
            v = (hb - b) / (hb - ha)
            if u < 0.05 or u > 0.95 or v < 0.04 or v > 0.96:
                return "INK"
            if v > 0.8:
                return "ROSE_0" if (0.15 < u < 0.7 and 0.85 < v < 0.88) else "BROWN_0"
            cu, cv = 0.55, 0.42
            if ((u - cu) * 2.3) ** 2 + (v - cv) ** 2 < 0.04:
                return "AMBER" if v < 0.4 else "TERRA_2"
            sky = int(((u * 7) % 2) * 0 + v * 6)
            if v > 0.55:
                hcol = 0.62 + 0.12 * ((int(u * 9) * 37) % 5) / 5
                return "INK" if v > hcol else "PLUM_0"
            return ["PLUM_0", "PLUM_0", "PLUM_1", "PLUM_1", "TERRA_0", "TERRA_0"][min(5, sky)]

        p.face("side", 0.03, za, zb, ha, hb, art)
        for hh in [ha + i * 0.08 for i in range(28)]:
            x, y = Pi(za, 0.03, hh)
            p.px(x, y, "TERRA_1" if hh > 7.2 else "BROWN_2")
        for k in range(26):
            zz = za + (zb - za) * k / 25
            x, y = Pi(zz, 0.03, hb)
            p.px(x, y, "RIM" if k < 6 else "TERRA_1")
        return p
    # t5: neon FORGE sign on a dark backplate, glowing on the wall
    text = "FORGE"
    x0, y0 = Pi(2.05, 0.04, 7.75)
    hcen = 7.3
    slope = (77 - PXF * hcen) / WX
    tmp = []
    cx = x0
    for ch in text:
        g = GLYPH[ch]
        for gy, row in enumerate(g):
            for gx, c in enumerate(row):
                if c == "#":
                    xx = cx + gx
                    tmp.append((xx, round(y0 + gy + slope * (xx - x0) * 1.0)))
        cx += 5
    xs = [t_[0] for t_ in tmp]
    ys = [t_[1] for t_ in tmp]
    # glow halo on the wall, then a tube outline, then the tubes
    for (x, y) in tmp:
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                dd = abs(dx) + abs(dy)
                if dd <= 3 and bay(x + dx, y + dy) < (0.5 if dd <= 1 else 0.28 if dd == 2 else 0.12):
                    p.px(x + dx, y + dy, "TERRA_0" if dd > 1 else "TERRA_1", only="empty")
    for (x, y) in tmp:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in tmp:
                p.px(x + dx, y + dy, "RIM", only=None if p.get(x + dx, y + dy) != "RIM" else None)
    for (x, y) in tmp:
        p.px(x, y, "GLOW")
    for (x, y) in tmp[::5]:
        p.px(x, y, "SUN")
    # mounting standoffs and the cord dropping to the shelf
    p.px(min(xs) - 2, min(ys) + 1, "BROWN_2")
    p.px(max(xs) + 2, max(ys) - 4, "BROWN_2")
    cxx = max(xs) - 1
    p.line((cxx, max(ys) + 2), (cxx + 1, max(ys) + 9), "INK")
    return p


def comp_chair(t):
    """Parked past the desk's front end, turned to face the viewer. Layer 3 (contact y >= 210)."""
    p = Pen(500, 118, 539, 214)
    zb, zf, d0, d1, zc, dc = 6.8, 7.85, 0.35, 1.75, 7.35, 1.05

    def outline_back(h0, h1, dl, dr, lit_from=3.1):
        # lit left edge (window side), dark right edge, top edge
        for hh in [h0 + i * 0.08 for i in range(int((h1 - h0) / 0.08) + 1)]:
            x, y = Pi(zb, dr, hh)
            p.px(x, y, "RIM" if hh > lit_from + 0.6 else "TERRA_1" if hh > lit_from else "BROWN_2")
            x, y = Pi(zb, dl, hh)
            p.px(x, y, "VOID")
        for k in range(16):
            x, y = Pi(zb, dr - (dr - dl) * k / 15, h1)
            p.px(x, y, "RIM" if k < 3 else "BROWN_2")

    if t == 1:
        # metal folding chair: small back panel on two tubes, flat seat, splayed legs
        for dd in (d0 + 0.1, d1 - 0.1):
            p.line(Pi(zb, dd, 3.45), Pi(zb, dd, 0), "SLATE_0" if dd > 1 else "INK")
            p.line(Pi(zf, dd, 1.5), Pi(zf + 0.1, dd, 0), "INK")
        p.face("front", zb, d0 + 0.1, d1 - 0.1, 2.85, 3.45, "BROWN_2")
        outline_back(2.85, 3.45, d0 + 0.1, d1 - 0.1, lit_from=2.9)
        p.face("top", 1.5, zb, zf, d0, d1, "BROWN_2")
        p.face("front", zf, d0, d1, 1.42, 1.5, "BROWN_0")
        x, y = Pi(zb, d1, 1.5)
        p.px(x, y, "RIM")
        p.line(Pi(zb + 0.1, d1 - 0.1, 0.5), Pi(zf, d1 - 0.1, 0.5), "INK")
        return p
    if t == 3:
        # office chair: padded grey back with a lumbar seam, seat cushion, armrests
        def back(a, b, x, y):
            if abs(b - 2.85) < 0.05:
                return "BROWN_0"
            if a > d1 - 0.35 and b > 2.9:
                return "BROWN_2"
            return "BROWN_1"

        p.line(Pi(zb + 0.05, dc, 2.25), Pi(zb + 0.25, dc, 1.7), "INK")  # spine
        p.face("front", zb, d0, d1, 2.25, 3.95, back)
        outline_back(2.25, 3.95, d0, d1)
        p.face("top", 1.7, zb + 0.05, zf, d0, d1, lambda a, b, x, y: "BROWN_2" if b > d1 - 0.25 else "BROWN_1")
        p.face("front", zf, d0, d1, 1.5, 1.7, "INK")
        for k in range(12):
            x, y = Pi(zf, d1 - (d1 - d0) * k / 11, 1.7)
            p.px(x, y, "BROWN_2" if k > 2 else "RIM")
        for dd in (d0 - 0.02, d1 + 0.02):
            p.line(Pi(zb + 0.15, dd, 2.45), Pi(zf - 0.25, dd, 2.45), "INK")
            p.line(Pi(zf - 0.4, dd, 1.7), Pi(zf - 0.4, dd, 2.45), "INK")
        x, y = Pi(zb + 0.15, d1 + 0.02, 2.45)
        p.px(x, y, "BROWN_2")
    else:
        # gaming chair: tall back with side bolsters, thin red piping, headrest pillow; no logos
        def back(a, b, x, y):
            u = (a - d0) / (d1 - d0)
            if abs(u - 0.16) < 0.03 or abs(u - 0.84) < 0.03:
                return "CRT_0" if b < 4.45 else "BROWN_0"
            if u < 0.16 or u > 0.84:
                return "INK"
            if 3.95 < b < 4.3:
                return "BROWN_2"
            if b > 4.3:
                return "BROWN_1"
            return "BROWN_0" if int((b - 2.2) / 0.3) % 2 else "BROWN_1"

        p.line(Pi(zb + 0.05, dc, 2.2), Pi(zb + 0.25, dc, 1.75), "INK")
        p.face("front", zb, d0 - 0.05, d1 + 0.05, 2.2, 4.6, back)
        outline_back(2.2, 4.6, d0 - 0.05, d1 + 0.05)
        p.face("top", 1.75, zb + 0.05, zf, d0, d1,
               lambda a, b, x, y: "CRT_0" if abs(b - d0 - 0.2) < 0.06 or abs(b - d1 + 0.2) < 0.06 else "BROWN_1")
        p.face("front", zf, d0, d1, 1.5, 1.75, "INK")
        for k in range(12):
            x, y = Pi(zf, d1 - (d1 - d0) * k / 11, 1.75)
            p.px(x, y, "RIM" if k < 3 else "BROWN_2")
        for dd in (d0 - 0.08, d1 + 0.08):
            p.line(Pi(zb + 0.15, dd, 2.55), Pi(zf - 0.2, dd, 2.55), "INK")
            p.line(Pi(zf - 0.35, dd, 1.75), Pi(zf - 0.35, dd, 2.55), "BROWN_0")
    # gas lift and a five-star base on casters
    p.line(Pi(zc, dc, 1.5), Pi(zc, dc, 0.35), "INK")
    x, y = Pi(zc, dc, 1.2)
    p.px(x - 1, y, "BROWN_2")
    hub = Pi(zc, dc, 0.3)
    for dz, dd in [(-0.55, -0.65), (-0.55, 0.65), (0.45, -0.75), (0.45, 0.75), (0.85, 0.0)]:
        tip = Pi(zc + dz, dc + dd, 0.12)
        p.line(hub, tip, "INK")
        p.px(tip[0], tip[1] + 1, "VOID")
    x, y = Pi(zc - 0.55, dc + 0.65, 0.12)
    p.px(x, y, "BROWN_2")
    return p


def pegboard():
    """Pegboard past the shelf, above the parked chair: headphones, a cable coil, a cap. Layer 3."""
    p = Pen(518, 80, 540, 128)
    z0, z1, h0, h1 = 6.55, 7.85, 5.0, 6.9

    def board(a, b, x, y):
        if a < z0 + 0.05 or b > h1 - 0.05:
            return "TERRA_0"
        holes = round((a - z0) * 5) % 2 == 0 and round((b - h0) * 5) % 2 == 0 and (x + y) % 2 == 0
        return "BROWN_0" if holes else "BROWN_2"

    p.face("side", 0.04, z0, z1, h0, h1, board)
    for k in range(12):
        x, y = Pi(z0 + (z1 - z0) * k / 11, 0.04, h1)
        p.px(x, y, "RIM" if k < 3 else "TERRA_1")
    for hh in [h0 + i * 0.1 for i in range(19)]:
        x, y = Pi(z0, 0.04, hh)
        p.px(x, y, "TERRA_1")
    for k in range(12):
        x, y = Pi(z0 + (z1 - z0) * k / 11, 0.04, h0)
        p.px(x, y + 1, "INK", only="empty")
    # headphones on a hook: dark band and ear cups against the lighter board
    cx, cy = Pi(6.95, 0.15, 6.45)
    p.px(cx, cy, "SLATE_1")
    p.line((cx - 3, cy + 7), (cx - 3, cy + 3), "INK")
    p.line((cx - 2, cy + 2), (cx - 1, cy + 1), "INK")
    p.line((cx, cy + 1), (cx + 1, cy + 1), "INK")
    p.line((cx + 2, cy + 2), (cx + 3, cy + 3), "INK")
    p.line((cx + 3, cy + 3), (cx + 3, cy + 7), "INK")
    p.px(cx - 2, cy + 2, "RIM")
    p.px(cx - 3, cy + 3, "RIM")
    p.rect(cx - 4, cy + 7, cx - 2, cy + 10, "INK")
    p.rect(cx + 2, cy + 7, cx + 4, cy + 10, "INK")
    p.px(cx - 4, cy + 7, "BROWN_2")
    p.px(cx - 4, cy + 8, "TERRA_1")
    p.px(cx + 3, cy + 10, "CRT_0")
    # cable coil
    x, y = Pi(7.5, 0.15, 6.55)
    p.circ(x, y + 3, 2, "INK", fill=False)
    p.px(x - 2, y + 2, "RIM")
    p.line((x, y + 5), (x + 1, y + 10), "INK")
    # cap
    x, y = Pi(7.5, 0.15, 5.45)
    p.poly([(x - 2, y), (x + 1, y - 2), (x + 4, y - 1), (x + 4, y + 2), (x - 2, y + 2)], "LEAF_1")
    p.line((x - 3, y + 2), (x + 4, y + 2), "LEAF_0")
    p.px(x - 1, y, "LEAF_2")
    p.px(x, y - 1, "LEAF_2")
    p.px(x + 1, y - 2, "LEAF_3")
    return p


def salt_lamp():
    """Small salt lamp on the shelf: a warm accent glow."""
    p = Pen(476, 104, 494, 126)
    hs = 5.4
    zc = 2.8
    x, y = Pi(zc, 0.4, hs)
    # glow on the wall behind
    for yy in range(y - 12, y + 1):
        for xx in range(x - 7, x + 8):
            e = ((xx - x) / 7) ** 2 + ((yy - (y - 4)) / 8) ** 2
            if e < 0.35:
                p.px(xx, yy, "TERRA_0", only="empty")
            elif e < 1 and (xx + yy) % 2:
                p.px(xx, yy, "BROWN_2", only="empty")
    # rock
    for dy, (a, b) in enumerate([(0, 1), (-1, 2), (-1, 2), (-2, 2), (-2, 3), (-2, 2)]):
        for dx in range(a, b + 1):
            n = "AMBER" if dx <= 0 else "TERRA_2"
            if dy == 0 or (dx == a and dy < 3):
                n = "GLOW"
            p.px(x + dx, y - 7 + dy, n)
    p.px(x, y - 6, "SUN")
    p.px(x - 1, y - 4, "GLOW")
    p.px(x + 2, y - 3, "TERRA_1")
    p.line((x - 2, y - 1), (x + 3, y - 1), "BROWN_2")
    p.px(x - 2, y - 1, "RIM")
    return p


def corner_plant():
    """Snake plant in a pot in the back corner between the two desks."""
    p = Pen(448, 128, 470, 203)
    zc, dc = 0.35, 0.9
    xb, yb = Pi(zc, dc, 0)
    # pot (on the floor, partly under the computer desk's end)
    p.poly([(xb - 4, yb - 9), (xb + 4, yb - 9), (xb + 3, yb), (xb - 3, yb)], "TERRA_1")
    p.line((xb - 4, yb - 9), (xb + 4, yb - 9), "TERRA_2")
    p.line((xb - 4, yb - 8), (xb + 4, yb - 8), "TERRA_0")
    p.line((xb + 3, yb - 7), (xb + 3, yb - 1), "TERRA_0")
    p.px(xb - 4, yb - 9, "RIM")
    # tall blade leaves
    blades = [(-3, 34, -2), (-1, 46, -1), (1, 52, 1), (3, 40, 2), (0, 30, 0), (2, 24, 3), (-2, 22, -3)]
    for bx, hgt, lean in blades:
        x0 = xb + bx
        for k in range(hgt):
            x = round(x0 + lean * (k / hgt) ** 2 * 2)
            y = yb - 10 - k
            w = 2 if k < hgt * 0.75 else 1
            for j in range(w):
                n = "LEAF_1" if (k + j + bx) % 5 else "LEAF_0"
                if j == 0 and k % 7 in (2, 3):
                    n = "LEAF_2"
                p.px(x + j, y, n)
            if k == hgt - 1:
                p.px(x, y, "LEAF_2")
    # rim on the window-facing edges of the tallest blades
    for bx, hgt, lean in blades[1:3]:
        for k in range(hgt // 2, hgt, 3):
            x = round(xb + bx + lean * (k / hgt) ** 2 * 2)
            p.px(x - 1, yb - 10 - k, "TERRA_2", only="empty")
    return p


def comp_cables():
    p = Pen(452, 196, 526, COMP_CONTACT - 1)
    a = Pi(3.4, 0.7, 0)
    b = Pi(4.6, 2.9, 0)
    c = Pi(6.2, 2.7, 0)
    d = Pi(5.8, 3.6, 0)
    p.sag(a, b, 1.5, "INK")
    p.sag(b, c, -1.0, "INK")
    p.sag(Pi(3.0, 0.6, 0), Pi(1.6, 3.3, 0), 1.2, "INK")
    p.sag(Pi(1.6, 3.3, 0), Pi(0.8, 4.4, 0), -0.8, "BROWN_1")
    p.sag(Pi(4.4, 1.2, 0), d, 1.0, "BROWN_1")
    for q in (b, c):
        p.px(q[0], q[1] - 1, "BROWN_2")
    return p


# ============================================================================================== BUILD
def build():
    # -------------------------------------------------------------- study: wall
    reg("study.pennant", {"base": pennant()}, zone="study", kind="decor", layer=2,
        note="school-spirit pennant, original design: green felt with a sky-blue wave, no lettering or crest")
    reg("study.frame", {"base": frame()}, zone="study", kind="decor", layer=2,
        note="empty wooden picture frame; inner dark area x 424..439, y 73..84 (16 x 12) is where the engine shows the user's image")
    reg("study.clock", {"base": clock()}, zone="study", kind="decor", layer=2, note="round wall clock with a red second hand")
    cal = {f"s{s}": calendar(s) for s in range(3)}
    reg("study.calendar", cal, zone="study", kind="hotspot", layer=2, target={"skill": "time-blocking"},
        label="TIME BLOCKING", led=(414, 129),
        note="wall calendar: s0 blank month, s1 a few days crossed off, s2 colour-blocked weeks")
    reg("study.corkboard", {"base": corkboard()}, zone="study", kind="decor", layer=2,
        note="corkboard with sticky notes, an index card, a polaroid, a ticket stub, red yarn")
    reg("study.shelf", {"base": small_shelf()}, zone="study", kind="decor", layer=2,
        note="small floating shelf with books and a trailing pothos in a terracotta pot")
    # -------------------------------------------------------------- study: desk and what is on it
    reg("study.underdesk", {"base": study_underdesk()}, zone="study", kind="decor", layer=2,
        note="shadow under the study desk, a storage box, power strip with a red LED, cords")
    reg("study.desk", {"base": study_desk()}, zone="study", kind="decor", layer=2,
        note="study desk against the back wall with a three-drawer pedestal")
    reg("study.lamp", {"t1": lamp(1), "t3": lamp(3), "t5": lamp(5), "base": lamp(3)}, zone="study", kind="decor", layer=2,
        note="desk lamp lighting the notebook: t1 clip lamp with a bare bulb, t3 architect lamp, t5 brass banker's lamp")
    reg("study.textbooks", {"base": textbooks()}, zone="study", kind="decor", layer=2,
        note="stack of textbooks with headphones lying on top")
    reg("study.notebook", {"base": notebook()}, zone="study", kind="hotspot", layer=2, target={"feature": "journal"},
        label="JOURNAL", led=(417, 163), hit=(409, 155, 20, 9), note="notebook open on the desk under the lamp, a pen on it")
    reg("study.mug", {"base": mug()}, zone="study", kind="decor", layer=2, note="coffee mug")
    reg("study.pencup", {"base": pencup()}, zone="study", kind="decor", layer=2, note="pen cup with a pen, a pencil, a marker")
    reg("study.printer", {"base": printer()}, zone="study", kind="decor", layer=2,
        note="small printer with paper in the tray and a green and an amber LED")
    reg("study.chair", {"t1": study_chair(1), "t3": study_chair(3), "t5": study_chair(5), "base": study_chair(3)},
        zone="study", kind="decor", layer=2,
        note="chair pushed in with a jacket over the back: t1 metal folding chair with a hoodie, t3 wooden chair, t5 tufted leather chair")
    bp = {"s0": backpack(0), "s1": backpack(1), "s2": backpack(2), "alert": backpack(1, alert=True)}
    reg("study.backpack", bp, zone="study", kind="hotspot", layer=2, target={"skill": "academics"}, label="ACADEMICS",
        led=(384, 198),
        note="backpack leaning on the desk: s0 slumped and empty, s1 packed, s2 packed with a laptop and a green keychain; alert: a red sheet sticking out (due within 48 h)")
    reg("study.trash", {"base": trash()}, zone="study", kind="decor", layer=2, note="mesh trash can with paper balls in and around it")
    reg("study.cables", {"base": study_cables()}, zone="study", kind="decor", layer=2,
        note="cords snaking out from under the study desk, a phone charger end")
    # -------------------------------------------------------------- computer
    reg("computer.poster", {"t1": comp_poster(1), "t3": comp_poster(3), "t5": comp_poster(5), "base": comp_poster(3)},
        zone="computer", kind="decor", layer=2,
        note="wall art above the shelf: t1 taped printout, t3 framed dusk poster, t5 neon FORGE sign glowing orange")
    reg("computer.shelf", {"base": shelf()}, zone="computer", kind="decor", layer=2,
        note="wall shelf with books, a small robot figure, a hooded figure with a sword, a trophy cup, a trailing pothos")
    reg("computer.router", {"base": router(0)}, zone="computer", kind="decor", layer=2,
        anim={"frames": [router(0), router(1)], "fps": 2}, note="router on the shelf with blinking green, amber and red lights")
    reg("computer.saltlamp", {"base": salt_lamp()}, zone="computer", kind="decor", layer=2,
        note="small salt lamp on the shelf, a warm glow on the wall")
    reg("computer.plant", {"base": corner_plant()}, zone="computer", kind="decor", layer=2,
        note="snake plant in a terracotta pot in the back corner between the desks")
    reg("computer.underdesk", {"base": comp_underdesk()}, zone="computer", kind="decor", layer=2,
        note="shadow under the computer desk, cable tray with sagging cables, floor power strip with a red LED")
    reg("computer.tower", {"base": tower()}, zone="computer", kind="decor", layer=2,
        note="PC tower under the desk: glass side with red-ringed fans, red LED strip and power light, red spill on the floor")
    reg("computer.desk", {"t1": comp_desk(1), "t3": comp_desk(3), "t5": comp_desk(5), "base": comp_desk(3)},
        zone="computer", kind="decor", layer=2,
        note="computer desk along the right wall: t1 folding table, t3 wood desk, t5 custom walnut slab on black steel with a warm LED strip")
    reg("computer.speaker", {"base": speaker()}, zone="computer", kind="decor", layer=2, note="small desk speaker with a red power LED")
    reg("computer.monitor-main", {f"s{s}": monitor_main(s) for s in range(3)}, zone="computer", kind="hotspot", layer=2,
        target={"skill": "ai-building"}, label="AI BUILDING", led=led_on(MAIN),
        note="main monitor: s0 dark screen propped on textbooks, s1 code on screen, s2 code plus chat and a rising chart")
    reg("computer.monitor-second", {f"s{s}": monitor_second(s) for s in range(3)}, zone="computer", kind="hotspot",
        layer=2, target={"skill": "dropshipping"}, label="DROPSHIPPING", led=led_on(SECOND),
        note="second monitor: s0 dark cheap screen on a cardboard box, s1 store dashboard, s2 busy charts plus a shipping box on the desk")
    reg("computer.note", {"base": sticky_note()}, zone="computer", kind="hotspot", layer=2, target={"feature": "focus"},
        label="FOCUS", led=note_led(), note="sticky note on the main monitor's bezel")
    reg("computer.webcam", {"base": webcam()}, zone="computer", kind="decor", layer=2, note="webcam on the main monitor with a red tally light")
    reg("computer.keyboard", {"base": keyboard()}, zone="computer", kind="decor", layer=2,
        note="keyboard lit by the screens, mouse on a pad")
    reg("computer.mic", {"base": mic()}, zone="computer", kind="decor", layer=2, note="desk mic on a short stand with a red mute light")
    reg("computer.drink", {"base": drink()}, zone="computer", kind="decor", layer=2,
        note="energy drink can on the desk and a crushed one on the floor")
    reg("computer.cables", {"base": comp_cables()}, zone="computer", kind="decor", layer=2,
        note="cables snaking across the floor from the power strip")
    reg("computer.chair", {"t1": comp_chair(1), "t3": comp_chair(3), "t5": comp_chair(5), "base": comp_chair(3)},
        zone="computer", kind="decor", layer=3,
        note="chair parked beside the desk: t1 metal folding chair, t3 mesh office chair, t5 gaming chair with red stripes")
    reg("computer.pegboard", {"base": pegboard()}, zone="computer", kind="decor", layer=3,
        note="pegboard on the wall above the parked chair with headphones, a cable coil and a cap")
    finish(PART)


if __name__ == "__main__":
    build()
