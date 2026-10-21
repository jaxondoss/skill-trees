"""Room v3 left wall: kitchen + door (zone 1) and bed (zone 2), on the raked left flat that grows toward the
viewer. Run: python3 art/room-v3/left/build.py
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

L = "L"
CNT = (30.3, 34.8, 1.8)        # counter z0, z1, depth
DOOR = (36.4, 38.6)
TABLE = (-13.2, -10.4, 22.4, 24.6, 2.6)
BED = (39.8, 44.6, 3.0)        # z0 (foot), z1 (head), width out of the wall
NS = (44.8, 46.2, 1.3)         # nightstand


# ------------------------------------------------------------------ kitchen (zone 1)
def counter(cv, v):
    z0, z1, d = CNT
    wood = {"t1": (BROWN_1, BROWN_0, INK, SLATE_0), "t3": (OAK_1, OAK_DK, BROWN_2, OAK_2),
            "t5": (OAK_1, OAK_DK, BROWN_2, CREAM)}.get(v, (OAK_1, OAK_DK, BROWN_2, OAK_2))
    top, face, end, slab = wood
    wshadow(cv, L, z0, z1 + 0.2, d + 0.3, 0.5)
    wbox(cv, L, z0, z1, d, 0, 3.0, top, face, end)
    for t in np.arange(z0 + 0.2, z1, 1.1):
        a, b = WP(L, t, 2.8, d), WP(L, t, 0.4, d)
        cv.line(*a, *b, BROWN_0)
        p = WP(L, t + 0.55, 2.45, d)
        cv.rect(p[0], p[1], p[0] + 1, p[1] + 5, GOLD_DK if v != "t5" else GOLD)
    wbox(cv, L, z0, z1, d + 0.12, 2.95, 3.15, slab, up(slab), up(slab))
    wquad(cv, L, z0, z1, 3.15, 4.8, TERRA_0 if v != "t5" else SLATE_0)  # backsplash tile
    for hh in np.arange(3.35, 4.8, 0.35):
        cv.line(*WP(L, z0, hh), *WP(L, z1, hh), BROWN_2 if v != "t5" else SLATE_1)
    for t in np.arange(z0, z1, 0.5):
        cv.line(*WP(L, t, 3.15), *WP(L, t, 4.8), BROWN_2 if v != "t5" else SLATE_1)
    wbox(cv, L, z0, z1 - 0.2, 1.1, 5.2, 7.4, OAK_0, face, end)  # uppers
    for t in np.arange(z0 + 0.1, z1 - 0.2, 1.1):
        cv.line(*WP(L, t, 7.3, 1.1), *WP(L, t, 5.3, 1.1), BROWN_0)
        p = WP(L, t + 0.5, 5.5, 1.1)
        cv.px(p[0], p[1], GOLD_DK)
    a, b = WP(L, z0, 5.18, 1.1), WP(L, z1 - 0.2, 5.18, 1.1)
    cv.line(*a, *b, GLOW if v == "t5" else AMBER)  # under-cabinet light


def gut_plant(cv, v):
    st = int(v[1])
    x, y = WP(L, 34.5, 3.15, 0.9)
    pot(cv, x, y, 8, 14, TERRA_1 if st < 2 else CREAM)
    n, reach, cols = {0: (7, (10, 24), (LEAF_1, LEAF_1, OAK_2)), 1: (16, (14, 36), (LEAF_1, LEAF_2, LEAF_1)),
                      2: (26, (16, 40), (LEAF_2, LEAF_1, LEAF_3, LEAF_2))}[st]
    r = rng(17)
    for k in range(n):  # monstera-ish split leaves
        ang = -1.45 + r.uniform(-1.2, 1.1)
        ln = r.uniform(*reach)
        ex, ey = x + math.cos(ang) * ln, y - 14 + math.sin(ang) * ln
        cv.line(x, y - 14, ex, ey, LEAF_0)
        lw = r.uniform(6, 10)
        lh = lw * 0.6
        c = cols[k % len(cols)]
        cv.ell(ex - lw, ey - lh, ex + lw, ey + lh, LEAF_0)
        cv.ell(ex - lw + 1, ey - lh, ex + lw - 1, ey + lh - 1, c)
        cv.line(ex - lw + 2, ey, ex + lw - 2, ey - 1, LEAF_0)
        if st:
            cv.line(ex - 2, ey - lh + 1, ex - 1, ey, LEAF_0)  # leaf split
        cv.px(ex - lw * 0.4, ey - lh * 0.5, LEAF_3)
    if st == 0:
        cv.px(x - 6, y - 15, OAK_2)
        cv.px(x + 5, y - 16, OAK_1)


def kettle(cv, v):
    x, y = WP(L, 31.6, 3.15, 0.9)
    cv.ell(x - 9, y - 14, x + 9, y, SLATE_1)
    cv.rect(x - 9, y - 4, x + 9, y, SLATE_0)
    cv.line(x + 9, y - 10, x + 14, y - 14, SLATE_1)
    cv.ell(x - 4, y - 18, x + 4, y - 13, INK)
    cv.px(x - 5, y - 10, SLATE_2)


def microwave(cv, v):
    wbox(cv, L, 32.3, 33.5, 1.4, 3.15, 4.4, BROWN_1, INK, BROWN_0)
    a = WP(L, 32.45, 4.2, 1.4)
    b = WP(L, 33.0, 3.35, 1.4)
    cv.poly([a, (b[0], a[1] + (b[1] - a[1]) * 0.1), b, (a[0], b[1])], SLATE_0)
    p = WP(L, 33.3, 3.9, 1.4)
    cv.rect(p[0], p[1], p[0] + 1, p[1] + 1, CRT_1)


def spice_rack(cv, v):
    wquad(cv, L, 30.6, 32.0, 5.6, 5.75, OAK_0, 0.0)
    for k, t in enumerate(np.arange(30.7, 31.9, 0.22)):
        a = WP(L, t, 5.75, 0.15)
        cv.rect(a[0], a[1] - 6, a[0] + 3, a[1], [CRT_0, GOLD, LEAF_2, CREAM, TERRA_2, SLATE_1][k % 6])
        cv.line(a[0], a[1] - 6, a[0] + 3, a[1] - 6, BROWN_0)


def cutting_board(cv, v):
    pts = wquad(cv, L, 30.9, 31.9, 3.3, 4.5, OAK_2, 0.08)
    cv.line(*pts[0], *pts[1], AMBER)
    h = WP(L, 31.4, 4.35, 0.1)
    cv.px(h[0], h[1], BROWN_0)


def table(cv, v):
    X0, X1, Z0, Z1, H = TABLE
    top, leg = {"t1": (SLATE_1, INK), "t5": (OAK_2, OAK_DK)}.get(v, (OAK_1, OAK_DK))
    shadow(cv, X0 - 0.2, X1 + 0.2, Z0 - 0.3, Z1 + 0.1, 0.55)
    for X in (X0 + 0.2, X1 - 0.3):
        for Z in (Z0 + 0.2, Z1 - 0.3):
            a, b = P(X, H, Z), P(X, 0, Z)
            cv.rect(a[0], a[1], a[0] + (3 if Z < Z1 - 0.4 else 2), b[1], leg if Z < Z1 - 0.4 else dn(leg))
    box(cv, X0, X1, H - 0.18, H, Z0, Z1, top, dn(top), dn(top, 2))
    if v == "t5":  # butcher block stripes
        for k in range(1, 6):
            X = X0 + k * (X1 - X0) / 6
            cv.line(*P(X, H, Z0), *P(X, H, Z1), OAK_1)
    a, b = P(X0, H, Z0), P(X1, H, Z0)
    cv.line(*a, *b, up(top))


def fruit_basket(cv, v):
    st = int(v[1])
    x, y = P(-11.9, TABLE[4], 23.3)
    cv.ell(x - 15, y - 8, x + 15, y + 3, OAK_0)
    cv.ell(x - 13, y - 9, x + 13, y - 3, OAK_DK)
    for k in range(-12, 13, 4):
        cv.line(x + k, y - 4, x + k + 2, y + 2, OAK_DK)
    fruits = {0: [(-4, -7, OAK_2), (5, -6, TERRA_1)],
              1: [(-8, -9, CRT_0), (-1, -11, LEAF_3), (6, -9, GLOW), (2, -6, CRT_1), (-5, -5, GOLD)],
              2: [(-9, -10, CRT_0), (-2, -13, LEAF_3), (6, -10, GLOW), (2, -7, CRT_1), (-6, -6, GOLD), (9, -6, PLUM_2), (-11, -6, LEAF_2)]}[st]
    for (dx, dy, c) in fruits:
        cv.disc(x + dx, y + dy, 4, c)
        cv.px(x + dx - 1, y + dy - 2, CREAM if st else OAK_1)
    if st >= 1:
        cv.poly([(x + 9, y - 15), (x + 16, y - 20), (x + 18, y - 17), (x + 12, y - 12)], GOLD)  # banana
        cv.line(x + 9, y - 15, x + 16, y - 20, SUN)
    if st == 2:  # leafy greens on the side
        leafy(cv, x - 14, y - 4, 6, 0.8, 3, size=(3, 5), reach=(5, 11), up_bias=-2.2)


def water_jug(cv, v):
    g = int(v[1]) if v.startswith("g") else 2
    x, y = P(-10.95, TABLE[4], 23.1)
    cv.rect(x - 7, y - 26, x + 7, y, SLATE_0)
    cv.rect(x - 5, y - 31, x + 5, y - 26, SLATE_0)
    cv.rect(x - 2, y - 35, x + 2, y - 31, SLATE_2)
    lvl = [y - 3, y - 10, y - 18, y - 25][g]
    if g:
        cv.rect(x - 6, lvl, x + 6, y - 1, SLATE_1)
        cv.line(x - 6, lvl, x + 6, lvl, SLATE_2)
    cv.line(x - 5, y - 24, x - 5, y - 4, SLATE_2)
    for k in range(4):  # tick marks: goal ladder
        cv.line(x + 4, y - 6 - k * 6, x + 6, y - 6 - k * 6, CREAM)


def stool(cv, v):
    X0, X1, Z0 = -9.8, -9.0, 22.0
    shadow(cv, X0, X1, Z0 - 0.2, Z0 + 0.8, 0.5)
    box(cv, X0, X1, 2.0, 2.2, Z0, Z0 + 0.8, OAK_0, OAK_DK, BROWN_0)
    for X in (X0 + 0.08, X1 - 0.15):
        a, b = P(X, 2.0, Z0 + 0.1), P(X, 0, Z0 + 0.1)
        cv.rect(a[0], a[1], a[0] + 1, b[1], OAK_DK)
    a, b = P(X0, 0.8, Z0 + 0.1), P(X1, 0.8, Z0 + 0.1)
    cv.line(*a, *b, BROWN_0)


def door(cv, v):
    st = int(v[1])
    dz0, dz1 = DOOR
    wquad(cv, L, dz0 - 0.18, dz1 + 0.18, 0, 7.3, OAK_0)
    wquad(cv, L, dz0 - 0.18, dz1 + 0.18, 7.18, 7.3, OAK_1)
    wquad(cv, L, dz0, dz1, 0, 7.0, BROWN_2)
    wquad(cv, L, dz0 + 0.25, dz1 - 0.25, 3.9, 6.65, OAK_DK)
    wquad(cv, L, dz0 + 0.25, dz1 - 0.25, 0.4, 3.3, OAK_DK)
    for (h0, h1) in ((3.9, 6.65), (0.4, 3.3)):
        cv.line(*WP(L, dz1 - 0.25, h1), *WP(L, dz1 - 0.25, h0), OAK_0)  # window-facing bevel
    hx, hy = WP(L, dz1 - 0.2, 3.5)
    cv.rect(hx - 1, hy - 1, hx + 2, hy, GOLD)
    cv.px(hx + 2, hy - 1, SUN)
    fb = wquad(cv, L, dz0 + 0.45, dz1 - 0.45, 4.3, 6.2, OAK_1)  # flyer board
    cv.line(*fb[0], *fb[1], OAK_2)
    cols = [CREAM, GLOW, SLATE_2, PLUM_3, LEAF_3]
    n = {0: 1, 1: 3, 2: 5}[st]
    r = rng(14)
    for k in range(n):
        za = dz0 + 0.55 + (k % 3) * 0.42
        ha = 4.45 + (k // 3) * 0.85 + r.uniform(0, 0.2)
        wquad(cv, L, za, za + 0.36, ha, ha + 0.62, cols[k])
        cv.line(*WP(L, za + 0.06, ha + 0.42), *WP(L, za + 0.3, ha + 0.42), BROWN_1)
        cv.line(*WP(L, za + 0.06, ha + 0.28), *WP(L, za + 0.24, ha + 0.28), BROWN_1)
        p = WP(L, za + 0.18, ha + 0.6)
        cv.px(p[0], p[1], CRT_1)
    if st == 2:  # small pennant ribbon on the board
        a, b = WP(L, dz0 + 1.6, 6.0), WP(L, dz0 + 1.9, 5.7)
        cv.line(*a, *b, LEAF_2)
        cv.px(b[0], b[1] + 1, SLATE_2)


def doormat(cv, v):
    dz0, dz1 = DOOR
    m = [P(XL(dz1) + 0.3, 0, dz1), P(XL(dz1) + 2.4, 0, dz1), P(XL(dz0) + 2.4, 0, dz0), P(XL(dz0) + 0.3, 0, dz0)]
    cv.poly(m, BROWN_2)
    cv.poly([(m[0][0] + 2, m[0][1] + 1), (m[1][0] - 2, m[1][1] + 1), (m[2][0] - 3, m[2][1] - 2), (m[3][0] + 3, m[3][1] - 2)], TERRA_1)
    tw = text_w("WELCOME")
    cx = (m[0][0] + m[1][0] + m[2][0] + m[3][0]) / 4
    cy = (m[0][1] + m[3][1]) / 2
    cv.text(round(cx - tw / 2), round(cy - 2), "WELCOME", BROWN_0)
    if v == "alert":  # a letter waiting on the mat
        lx, ly = cx + 10, cy - 1
        cv.poly([(lx - 7, ly - 2), (lx + 6, ly - 4), (lx + 8, ly + 2), (lx - 5, ly + 4)], CREAM)
        cv.line(lx - 7, ly - 2, lx + 1, ly + 1, SLATE_2)
        cv.line(lx + 1, ly + 1, lx + 6, ly - 4, SLATE_2)
        cv.px(lx + 1, ly + 1, CRT_0)


def switchboard(cv, v):
    q = wquad(cv, L, 38.85, 39.35, 3.6, 4.5, INK)
    wquad(cv, L, 38.9, 39.3, 3.65, 4.45, BROWN_1)
    for k, hh in enumerate((3.8, 4.0, 4.2)):
        a = WP(L, 39.0, hh)
        b = WP(L, 39.2, hh)
        cv.line(*a, *b, BROWN_0)
        cv.px(b[0], b[1], [GLOW, LEAF_3, CRT_1][k])


def coat_hooks(cv, v):
    wquad(cv, L, 34.7, 36.1, 6.55, 6.75, OAK_0)
    for t in (34.95, 35.4, 35.85):
        a = WP(L, t, 6.6, 0.0)
        b = WP(L, t, 6.5, 0.25)
        cv.line(*a, *b, GOLD_DK)
    j = [WP(L, 35.0, 6.5, 0.2), WP(L, 35.6, 6.45, 0.2), WP(L, 35.75, 4.9, 0.25), WP(L, 34.85, 4.8, 0.25)]
    cv.poly(j, SLATE_0)  # rain jacket
    cv.line(*j[0], *j[3], SLATE_1)
    cap = WP(L, 35.85, 6.4, 0.25)
    cv.ell(cap[0] - 5, cap[1] - 2, cap[0] + 5, cap[1] + 4, CRT_0)
    cv.line(cap[0] - 5, cap[1] + 3, cap[0] + 7, cap[1] + 3, TERRA_0)


def sneakers(cv, v):
    if v == "t1":  # pile by the door
        for k, (X, Z, c) in enumerate(((-17.4, 35.4, SLATE_1), (-16.6, 35.0, CREAM), (-17.0, 34.6, CRT_0))):
            p = P(X, 0, Z)
            cv.poly([(p[0] - 8, p[1]), (p[0] + 9, p[1] - 1), (p[0] + 7, p[1] - 5), (p[0] - 2, p[1] - 7), (p[0] - 7, p[1] - 4)], c)
            cv.line(p[0] - 8, p[1], p[0] + 9, p[1] - 1, CREAM if c != CREAM else SLATE_2)
        return
    wbox(cv, L, 34.5, 36.1, 1.0, 0, 0.9, OAK_1, OAK_0, OAK_DK)  # shoe rack
    for k, (t, c) in enumerate(((34.75, CRT_0), (35.25, SLATE_1), (35.75, CREAM))):
        p = WP(L, t, 0.92, 0.5)
        cv.poly([(p[0] - 7, p[1]), (p[0] + 7, p[1]), (p[0] + 5, p[1] - 4), (p[0] - 2, p[1] - 6), (p[0] - 6, p[1] - 3)], c)
        cv.line(p[0] - 7, p[1], p[0] + 7, p[1], CREAM if c != CREAM else SLATE_2)


def k_clock(cv, v):
    x, y = WP(L, 37.5, 8.1)
    cv.ell(x - 6, y - 8, x + 6, y + 8, OAK_0)
    cv.ell(x - 4, y - 6, x + 4, y + 6, CREAM)
    cv.line(x, y, x, y - 4, INK)
    cv.line(x, y, x + 2, y + 1, INK)


def light_switch(cv, v):
    wquad(cv, L, 36.05, 36.25, 4.0, 4.5, CREAM)
    p = WP(L, 36.15, 4.25)
    cv.px(p[0], p[1], SLATE_1)


def kitchen_on(cv, v):
    x, y = P(-16.0, CEIL - 3.2, 36.6)
    cv.rect(x - 2, y + 8, x + 2, y + 8, SUN)
    cv.line(x - 6, y + 7, x + 6, y + 7, GOLD)
    for k in range(1, 12):
        cv.dither([(x - 7 - k * 3, y + 9 + k * 6), (x + 7 + k * 3, y + 9 + k * 6), (x + 8 + k * 3, y + 15 + k * 6),
                   (x - 8 - k * 3, y + 15 + k * 6)], GLOW if k < 4 else AMBER, max(0.03, 0.14 - k * 0.01))


# ------------------------------------------------------------------ bed (zone 2)
def bed_frame(cv, v):
    z0, z1, w = BED
    wshadow(cv, L, z0 - 0.2, z1 + 0.2, w + 0.3, 0.55)
    if v == "t1":  # mattress on pallets
        for k in range(2):
            h0 = k * 0.6
            wbox(cv, L, z0, z1, w, h0, h0 + 0.5, OAK_2, OAK_1, OAK_0)
            for t in np.arange(z0 + 0.4, z1, 0.9):
                a, b = WP(L, t, h0 + 0.45, w), WP(L, t + 0.3, h0 + 0.05, w)
                cv.rect(a[0], a[1], b[0], b[1], BROWN_0)
        return
    gild = v == "t5"
    wbox(cv, L, z1 - 0.25, z1, w + 0.1, 0, 2.6, OAK_0, OAK_DK, OAK_0)  # low headboard
    hb = [WP(L, z1 - 0.25, 2.6, 0.1), WP(L, z1 - 0.25, 2.6, w + 0.1)]
    cv.line(*hb[0], *hb[1], GOLD if gild else OAK_1)
    for o in np.arange(0.4, w, 0.6):
        cv.line(*WP(L, z1 - 0.25, 2.5, o), *WP(L, z1 - 0.25, 2.0, o), BROWN_0)
    wbox(cv, L, z0, z1 - 0.25, w + 0.1, 0.0, 1.2, OAK_0, OAK_DK, OAK_DK)  # rails
    wbox(cv, L, z0, z0 + 0.2, w + 0.1, 0.0, 1.7, OAK_0, OAK_DK, OAK_0)    # footboard
    cv.line(*WP(L, z0, 1.7, 0.0), *WP(L, z0, 1.7, w + 0.1), GOLD if gild else OAK_1)
    for o in (0.15, w - 0.05):
        a, b = WP(L, z0 + 0.05, 1.7, o), WP(L, z0 + 0.05, 0, o)
        cv.line(*a, *b, BROWN_0)


def bed(cv, v):
    st = int(v[1])
    z0, z1, w = BED
    za, zb = z0 + 0.2, z1 - 0.25
    wbox(cv, L, za, zb, w - 0.05, 1.2, 1.95, CREAM, SLATE_1, SLATE_2)  # mattress / sheet
    duv = TERRA_1
    if st == 0:  # unmade: duvet bunched, pillow askew
        pts = [WP(L, za, 2.3, 0.2), WP(L, za + 2.1, 2.6, 0.4), WP(L, za + 2.6, 2.2, w), WP(L, za + 0.2, 2.1, w + 0.05)]
        cv.poly(pts, duv)
        cv.poly([WP(L, za, 2.1, w + 0.05), WP(L, za + 2.6, 2.2, w), WP(L, za + 2.4, 1.3, w + 0.1), WP(L, za, 1.2, w + 0.1)], TERRA_0)
        for t in (0.6, 1.3, 1.9):
            cv.line(*WP(L, za + t, 2.4, 0.4), *WP(L, za + t + 0.3, 2.2, w), TERRA_0)
        p = [WP(L, zb - 1.0, 2.35, 0.9), WP(L, zb - 1.3, 2.4, 2.4), WP(L, zb - 0.3, 2.2, 2.6), WP(L, zb - 0.2, 2.2, 1.0)]
        cv.poly(p, CREAM)
        cv.line(*p[0], *p[1], SLATE_2)
        return
    wbox(cv, L, za, zb - 1.6, w + 0.1, 1.3, 2.2, duv, TERRA_0, duv)
    for t in np.arange(za + 0.5, zb - 1.6, 0.8):
        cv.line(*WP(L, t, 2.2, 0.3), *WP(L, t + 0.15, 2.2, w + 0.1), TERRA_0)
        cv.line(*WP(L, t + 0.1, 2.2, w + 0.1), *WP(L, t + 0.1, 1.4, w + 0.1), TERRA_0)
    cv.line(*WP(L, zb - 1.6, 2.2, 0.1), *WP(L, zb - 1.6, 2.2, w + 0.1), CREAM)  # turned-down sheet
    for o in ((0.25, 1.4), (1.55, 2.75)):
        p = [WP(L, zb - 1.15, 2.45, o[0]), WP(L, zb - 1.15, 2.45, o[1]), WP(L, zb - 0.25, 2.35, o[1]), WP(L, zb - 0.25, 2.35, o[0])]
        cv.poly(p, CREAM)
        cv.line(*p[0], *p[1], SLATE_2)
    if st == 2:  # knit throw across the foot + accent pillow
        wbox(cv, L, za, za + 1.0, w + 0.15, 1.6, 2.25, PLUM_2, PLUM_1, PLUM_2)
        for t in np.arange(za + 0.1, za + 1.0, 0.25):
            cv.line(*WP(L, t, 2.25, 0.2), *WP(L, t, 2.25, w + 0.1), PLUM_1)
        p = [WP(L, zb - 1.5, 2.5, 0.9), WP(L, zb - 1.5, 2.5, 2.0), WP(L, zb - 1.1, 2.4, 2.0), WP(L, zb - 1.1, 2.4, 0.9)]
        cv.poly(p, GOLD_DK)
        cv.line(*p[0], *p[1], GOLD)
    # alarm clock on the nightstand
    cx, cy = WP(L, (NS[0] + NS[1]) / 2, 2.6, 0.65)
    cv.rect(cx - 6, cy - 8, cx + 6, cy, INK)
    cv.rect(cx - 4, cy - 6, cx + 4, cy - 3, VOID)
    for dx in (-3, -1, 1, 3):
        cv.rect(cx + dx, cy - 5, cx + dx, cy - 4, CRT_1)


def bed_hit():
    z0, z1, w = BED
    pts = [WP(L, z, h, o) for z in (z0, z1) for h in (0, 2.6) for o in (0, w + 0.15)]
    cx, cy = WP(L, (NS[0] + NS[1]) / 2, 2.6, 0.65)
    xs = [p[0] for p in pts] + [cx + 6]
    ys = [p[1] for p in pts] + [cy - 8]
    return (round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)))


def nightstand(cv, v):
    z0, z1, d = NS
    wshadow(cv, L, z0, z1, d + 0.2, 0.5)
    wbox(cv, L, z0, z1, d, 0, 2.6, OAK_1, OAK_0, OAK_DK)
    sh = [WP(L, z0 + 0.1, 1.2, d), WP(L, z1 - 0.1, 1.2, d), WP(L, z1 - 0.1, 0.3, d), WP(L, z0 + 0.1, 0.3, d)]
    cv.poly(sh, BROWN_0)  # open shelf
    cv.line(*WP(L, z0 + 0.1, 1.3, d), *WP(L, z1 - 0.1, 1.3, d), OAK_DK)
    cv.line(*WP(L, z0, 2.6, d), *WP(L, z1, 2.6, d), OAK_2)


def globe(cv, v):
    st = int(v[1])
    wbox(cv, L, 45.0, 46.2, 0.8, 4.15, 4.3, OAK_1, OAK_0, OAK_0)  # small shelf above the nightstand
    b = WP(L, 45.2, 4.15, 0.05)
    cv.line(b[0], b[1], b[0] + 3, b[1] + 5, OAK_DK)
    gx, gy = WP(L, 45.6, 4.3, 0.45)
    cv.rect(gx - 4, gy - 3, gx + 4, gy, INK)
    cv.disc(gx, gy - 9, 6, PLUM_1)
    cv.disc(gx, gy - 9, 2, PLUM_3 if st else PLUM_2)
    arcs = {0: ((-4, -3), (4, -4)), 1: ((-4, -7), (4, -8), (-5, -1), (5, -2)),
            2: ((-4, -7), (4, -8), (-5, -1), (5, -2), (0, -10), (-2, 3))}[st]
    for dx, dy in arcs:
        cv.line(gx, gy - 9, gx + dx, gy - 9 + dy + 3, PLUM_2 if st < 2 else PLUM_3)
        cv.px(gx + dx, gy - 9 + dy + 3, PLUM_3 if st else PLUM_2)
    cv.px(gx - 3, gy - 13, CREAM)


def cushion(cv, v):
    st = int(v[1])
    c = P(-11.5, 0, 34.0)
    shadow(cv, -12.6, -10.4, 33.3, 34.7, 0.5)
    if st >= 1:  # thin mat under the cushion
        fquad(cv, -12.8, -10.2, 33.0, 35.2, SLATE_0)
        fquad(cv, -12.7, -10.3, 33.1, 35.1, SLATE_1 if st == 2 else SLATE_0)
    cv.ell(c[0] - 18, c[1] - 9, c[0] + 18, c[1] + 4, PLUM_1)
    cv.ell(c[0] - 15, c[1] - (11 if st else 8), c[0] + 15, c[1] - 1, PLUM_2)
    cv.line(c[0] - 5, c[1] - 6, c[0] + 5, c[1] - 6, PLUM_1)
    cv.px(c[0], c[1] - 6, GOLD_DK)
    if st == 2:  # candle with a tiny smoke curl
        x, y = c[0] + 26, c[1] - 1
        cv.rect(x - 2, y - 6, x + 2, y, CREAM)
        cv.px(x, y - 7, INK)
        cv.px(x, y - 8, GLOW)
        cv.px(x, y - 9, SUN)
        for k in range(4):
            cv.px(x + (1 if k % 2 else -1), y - 11 - k * 2, SLATE_1)


def sconce(cv, v):
    x, y = WP(L, 44.1, 5.6)
    lit = v == "night"
    cv.rect(x - 1, y - 2, x + 1, y + 4, GOLD_DK)
    cv.line(x, y + 1, x + 5, y - 1, GOLD_DK)
    cv.poly([(x + 2, y - 8), (x + 8, y - 8), (x + 10, y - 1), (x + 1, y - 1)], CREAM if lit else OAK_2)
    cv.line(x + 1, y - 1, x + 10, y - 1, SUN if lit else GLOW)


def bed_on(cv, v):
    x, y = WP(L, 44.1, 5.6)
    cv.poly([(x + 2, y - 8), (x + 8, y - 8), (x + 10, y - 1), (x + 1, y - 1)], CREAM)
    cv.line(x + 1, y - 1, x + 10, y - 1, SUN)
    for k in range(1, 7):
        cv.dither([(x - 4 - k * 4, y + k * 5), (x + 14 + k * 4, y + k * 5), (x + 15 + k * 4, y + 5 + k * 5),
                   (x - 5 - k * 4, y + 5 + k * 5)], GLOW if k < 3 else AMBER, max(0.03, 0.18 - k * 0.025))


def bed_poster(cv, v):
    z0, z1 = 41.2, 43.8
    if v == "t1":
        wquad(cv, L, z0 + 0.2, z1 - 0.2, 6.2, 8.4, CREAM)
        pts = [WP(L, z0 + 0.2, 6.2), WP(L, (z0 + z1) / 2, 7.8), WP(L, z1 - 0.2, 6.2)]
        cv.poly(pts, SLATE_1)
        for t in (z0 + 0.25, z1 - 0.35):
            p = WP(L, t, 8.35)
            cv.rect(p[0], p[1], p[0] + 2, p[1] + 1, SLATE_2)
        return
    gild = v == "t5"
    wquad(cv, L, z0, z1, 6.0, 8.6, GOLD_DK if gild else INK)
    wquad(cv, L, z0 + 0.12, z1 - 0.12, 6.12, 8.48, PLUM_1)
    cv.poly([WP(L, z0 + 0.12, 6.12), WP(L, (z0 + z1) / 2 + 0.2, 7.9), WP(L, z1 - 0.12, 6.12)], SLATE_0)
    cv.poly([WP(L, z0 + 0.8, 6.12), WP(L, z0 + 1.6, 7.2), WP(L, z1 - 0.12, 6.12)], LEAF_1)
    sx, sy = WP(L, z0 + 0.8, 7.7)
    cv.disc(sx, sy, 4, GLOW)
    cv.line(*WP(L, z0, 8.6), *WP(L, z1, 8.6), GOLD if gild else BROWN_2)


def hamper(cv, v):
    X0, X1, Z0, Z1 = -13.0, -12.0, 46.6, 47.6
    shadow(cv, X0, X1 + 0.2, Z0 - 0.2, Z1, 0.5)
    if v == "t1":  # laundry pile
        c = P(-12.5, 0, 47.0)
        cv.ell(c[0] - 12, c[1] - 9, c[0] + 10, c[1] + 1, SLATE_0)
        cv.ell(c[0] - 6, c[1] - 12, c[0] + 6, c[1] - 4, CRT_0)
        cv.ell(c[0] - 10, c[1] - 6, c[0] - 1, c[1] - 1, CREAM)
        return
    box(cv, X0, X1, 0, 1.9, Z0, Z1, OAK_0 if v != "t5" else TERRA_1, OAK_1 if v != "t5" else TERRA_2, OAK_0)
    x0, y0 = P(X0, 1.9, Z0)
    x1, y1 = P(X1, 0, Z0)
    for gy in range(int(y0) + 3, int(y1) - 1, 3):
        cv.line(x0 + 1, gy, x1 - 1, gy, OAK_0 if v != "t5" else TERRA_1)
    cv.rect(x0 + 3, y0 - 3, x0 + 9, y0, CREAM)


def slippers(cv, v):
    for k, X in enumerate((-12.6, -12.0)):
        p = P(X, 0, 38.9 - k * 0.3)
        cv.ell(p[0] - 6, p[1] - 3, p[0] + 6, p[1] + 1, PLUM_1)
        cv.ell(p[0] - 3, p[1] - 4, p[0] + 3, p[1] - 1, PLUM_2)


def runner(cv, v):
    X0 = XL(39.4) + 3.2
    pts = fquad(cv, X0, X0 + 1.6, 39.6, 44.2, BROWN_2 if v != "t3" else SLATE_0)
    fquad(cv, X0 + 0.12, X0 + 1.48, 39.8, 44.0, TERRA_0 if v != "t3" else SLATE_1)
    for z in np.arange(40.3, 43.8, 0.9):
        cv.line(*P(X0 + 0.2, 0, z), *P(X0 + 1.4, 0, z), PLUM_1)


def bed_shelf(cv, v):
    wquad(cv, L, 44.5, 46.0, 8.9, 9.05, OAK_0, 0.0)
    wbox(cv, L, 44.5, 46.0, 0.6, 8.75, 8.9, OAK_1, OAK_0, OAK_0)
    p = WP(L, 44.9, 8.9, 0.3)
    pot(cv, p[0], p[1], 4, 6, CREAM)
    leafy(cv, p[0], p[1] - 6, 6, 1.0, 51, size=(3, 4), reach=(3, 8))
    q = WP(L, 45.6, 8.9, 0.3)
    for k, c in enumerate([CRT_0, SLATE_1, GOLD_DK]):
        cv.rect(q[0] + k * 3, q[1] - 9 + (k % 2), q[0] + k * 3 + 2, q[1] - 1, c)


def charger(cv, v):
    a = WP(L, 45.2, 0.5)
    pts = [a, (a[0] + 4, a[1] + 8), (a[0] - 3, a[1] + 14), (a[0] + 2, a[1] + 19)]
    cv.lines(pts, VOID)
    cv.rect(a[0] - 1, a[1] - 2, a[0] + 2, a[1], CREAM)


def hoodie(cv, v):
    a = WP(L, 39.9, 6.8, 0.05)
    cv.px(a[0], a[1] - 1, GOLD_DK)
    pts = [WP(L, 39.75, 6.7, 0.15), WP(L, 40.1, 6.7, 0.15), WP(L, 40.25, 5.0, 0.25), WP(L, 39.65, 4.9, 0.25)]
    cv.poly(pts, PLUM_1)
    cv.line(*pts[0], *pts[3], PLUM_2)
    m = WP(L, 39.95, 5.4, 0.22)
    cv.px(m[0], m[1], CREAM)


def main():
    # kitchen
    emit("kitchen.counter", zone="kitchen", kind="decor", layer=5, paint=counter, variants=("base", "t1", "t3", "t5"),
         note="base cabinets, counter, tile backsplash, uppers with under-cabinet light")
    emit("kitchen.gut", zone="kitchen", contact=430, kind="hotspot", layer=5, paint=gut_plant, variants=("s0", "s1", "s2"),
         target={"skill": "gut-health"}, label="GUT HEALTH", hit=None, note="big leafy monstera in a pot on the counter")
    emit("kitchen.kettle", zone="kitchen", contact=430, kind="decor", layer=5, paint=kettle, note="kettle on the counter")
    emit("kitchen.microwave", zone="kitchen", contact=430, kind="decor", layer=5, paint=microwave, note="microwave on the counter")
    emit("kitchen.spices", zone="kitchen", contact=430, kind="decor", layer=5, paint=spice_rack, note="spice rack on the backsplash")
    emit("kitchen.board", zone="kitchen", contact=430, kind="decor", layer=5, paint=cutting_board, note="cutting board leaning on the tiles")
    emit("kitchen.table", zone="kitchen", kind="decor", layer=5, paint=table, variants=("base", "t1", "t3", "t5"),
         note="small kitchen table in the front-left (t1 folding, t3 oak, t5 butcher block)")
    emit("kitchen.food", zone="kitchen", contact=520, kind="hotspot", layer=5, paint=fruit_basket, variants=("s0", "s1", "s2"),
         target={"skill": "food"}, label="FOOD", note="fruit basket on the table (bodyweight logs in the Food panel)")
    emit("kitchen.water", zone="kitchen", contact=520, kind="decor", layer=5, paint=water_jug, variants=("base", "g0", "g1", "g2", "g3"),
         note="water jug growth piece (g0 empty .. g3 full)")
    emit("kitchen.stool", zone="kitchen", kind="decor", layer=5, paint=stool, note="stool at the table")
    emit("kitchen.door", zone="kitchen", kind="hotspot", layer=4, paint=door, variants=("s0", "s1", "s2"),
         target={"skill": "college-integration"}, label="COLLEGE INTEGRATION", note="front door with a flyer board")
    emit("kitchen.doormat", zone="kitchen", kind="hotspot", layer=4, paint=doormat, variants=("base", "alert"),
         target={"feature": "review"}, label="REVIEW", contact="top", note="WELCOME doormat (alert: a letter waits)")
    emit("kitchen.settings", zone="kitchen", kind="hotspot", layer=4, paint=switchboard, target={"feature": "settings"},
         label="SETTINGS", note="small switchboard by the door")
    emit("kitchen.hooks", zone="kitchen", kind="decor", layer=4, paint=coat_hooks, note="coat hooks, rain jacket, cap")
    emit("kitchen.shoes", zone="kitchen", kind="decor", layer=5, paint=sneakers, variants=("base", "t1", "t3"),
         note="sneakers (t1 pile, t3 shoe rack)")
    emit("kitchen.clock", zone="kitchen", kind="decor", layer=4, paint=k_clock, note="wall clock above the door")
    emit("kitchen.switch", zone="kitchen", kind="decor", layer=4, paint=light_switch, note="light switch")
    emit("kitchen.on", zone="kitchen", kind="overlay", layer=4, paint=kitchen_on, light=False, rim=False,
         note="'it's on' light: kitchen pendant lit")
    # bed
    emit("bed.frame", zone="bed", contact=380, kind="decor", layer=3, paint=bed_frame, variants=("base", "t1", "t2", "t5"),
         note="t1 pallets, t2 wood frame + headboard, t5 gilt edge")
    emit("bed.nightstand", zone="bed", kind="decor", layer=2, paint=nightstand, note="nightstand with an open shelf")
    emit("bed.globe", zone="bed", kind="hotspot", layer=2, contact=370, paint=globe, variants=("s0", "s1", "s2"),
         target={"skill": "visualization"}, label="VISUALIZATION", rim=False, note="plasma globe on the nightstand shelf")
    emit("bed.bed", zone="bed", contact=381, kind="hotspot", layer=3, paint=bed, variants=("s0", "s1", "s2"), hit=bed_hit(),
         target={"skill": "sleep"}, label="SLEEP", note="bed with bedding + alarm clock on the nightstand")
    emit("bed.cushion", zone="bed", kind="hotspot", layer=5, paint=cushion, variants=("s0", "s1", "s2"),
         target={"skill": "meditation"}, label="MEDITATION", contact="top", note="floor cushion (s1 mat, s2 candle)")
    emit("bed.sconce", zone="bed", kind="decor", layer=2, paint=sconce, variants=("base", "night"), note="bedside wall sconce")
    emit("bed.poster", zone="bed", kind="decor", layer=3, paint=bed_poster, variants=("base", "t1", "t3", "t5"),
         note="mountain + sun poster (t1 taped, t3 framed, t5 gilt)")
    emit("bed.hamper", zone="bed", kind="decor", layer=2, paint=hamper, variants=("base", "t1", "t3", "t5"),
         note="laundry (t1 pile, t3 basket, t5 woven hamper)")
    emit("bed.slippers", zone="bed", kind="decor", layer=4, paint=slippers, note="slippers by the bed")
    emit("bed.runner", zone="bed", kind="decor", layer=3, paint=runner, variants=("base", "t3"), contact="top",
         note="bedside runner rug")
    emit("bed.shelf", zone="bed", kind="decor", layer=2, paint=bed_shelf, note="wall shelf above the headboard")
    emit("bed.charger", zone="bed", kind="decor", layer=2, paint=charger, light=False, note="phone charger cable")
    emit("bed.on", zone="bed", kind="overlay", layer=3, paint=bed_on, light=False, rim=False,
         note="'it's on' light: bedside sconce lit")
    finish("left")


if __name__ == "__main__":
    main()
