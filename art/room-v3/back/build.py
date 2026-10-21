"""Room v3 back wall: library (zone 3), window zone props (zone 4: CRTs, amp tower, sill, plant wall) and the
study (zone 5). The statue, niche and downlight live in statue-relics/. Run: python3 art/room-v3/back/build.py
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403


def bw(X0, X1, h0, h1, Z=ZB):
    """Back-wall rect (x0, y0, x1, y1) for X0..X1, h0..h1."""
    x0, y1 = P(X0, h0, Z)
    x1, y0 = P(X1, h1, Z)
    return round(x0), round(y0), round(x1), round(y1)


SPINES = [TERRA_0, TERRA_1, SLATE_0, SLATE_1, LEAF_1, LEAF_2, PLUM_1, PLUM_2, GOLD_DK, CREAM, OAK_2, CRT_0]


def books_row(cv, x0, x1, ybase, hmax, seed, fill=1.0, gold=False):
    r = rng(seed)
    x = x0
    while x < x1 - 3:
        if r.random() > fill:
            x += int(r.integers(3, 8))
            continue
        w = int(r.integers(2, 5))
        hgt = int(hmax - r.integers(0, max(1, hmax // 3)))
        if r.random() < 0.07 and x + 9 < x1:
            for k in range(3):
                cv.rect(x, ybase - 2 - k * 2, x + 8, ybase - 1 - k * 2, SPINES[int(r.integers(0, 12))])
            x += 10
            continue
        c = SPINES[int(r.integers(0, 12))]
        cv.rect(x, ybase - hgt, x + w - 1, ybase - 1, c)
        cv.px(x + w // 2, ybase - hgt + 2, GOLD if gold and r.random() < 0.6 else (CREAM if c != CREAM else INK))
        if hgt > 8:
            cv.line(x, ybase - hgt + 4, x + w - 1, ybase - hgt + 4, INK if not gold else GOLD_DK)
        x += w + (1 if r.random() < 0.2 else 0)


# ------------------------------------------------------------------ library (zone 3)
BS = (-11.9, -8.9, 46.6, 48.0, 9.0)


def bookshelf(cv, v):
    X0, X1, Z0, Z1, H = BS
    st = int(v[1])
    shadow(cv, X0 - 0.1, X1 + 0.4, Z0 - 0.5, Z1, 0.5)
    box(cv, X0, X1, 0, H, Z0, Z1, OAK_0, OAK_DK, BROWN_0)
    x0, y0 = P(X0, H, Z0)
    x1, y1 = P(X1, 0, Z0)
    cv.rect(x0 + 3, y0 + 4, x1 - 3, y1 - 4, BROWN_0)
    shelves = 6
    sh = (y1 - y0 - 8) / shelves
    for s in range(shelves):
        sy = y0 + 4 + s * sh
        cv.rect(x0 + 2, sy + sh - 2, x1 - 2, sy + sh, OAK_0)
        cv.line(x0 + 2, sy + sh - 2, x1 - 2, sy + sh - 2, OAK_1)
        fill = (0.45, 0.9, 1.0)[st]
        books_row(cv, x0 + 4, x1 - 3, sy + sh - 2, int(sh - 3), 21 + s, fill, gold=(st == 2))
    if st == 2:  # bookends + a small brass object
        cv.rect(x1 - 7, y0 + 4 + sh - 9, x1 - 5, y0 + 4 + sh - 3, GOLD)
        cv.disc(x0 + 9, y0 + 4 + 3 * sh - 5, 3, GOLD)
    # arm lamp clamped to the right side, reaching over the chair
    ax, ay = P(X1, 5.6, Z0)
    tip = P(X1 - 0.9, 5.3, Z0 - 1.4)
    cv.line(ax, ay, ax + 6, ay - 8, INK)
    cv.line(ax + 6, ay - 8, tip[0], tip[1], INK)
    sx, sy = tip
    cv.poly([(sx - 4, sy), (sx + 4, sy), (sx + 7, sy + 7), (sx - 7, sy + 7)], TERRA_1)
    cv.line(sx - 7, sy + 7, sx + 7, sy + 7, GLOW if st else AMBER)


def armchair(cv, v):
    X0, X1, Z0, Z1 = -10.9, -8.6, 43.4, 45.2
    leather = v == "t4" or v == "t5"
    seat, dark, hi = (TERRA_0, BROWN_0, TERRA_1) if leather else (PLUM_1, BROWN_2, PLUM_2)
    if v == "t1":  # beanbag
        c = P((X0 + X1) / 2, 0, 44.2)
        shadow(cv, X0, X1, 43.6, 44.8, 0.5)
        cv.ell(c[0] - 22, c[1] - 26, c[0] + 22, c[1] + 2, BROWN_2)
        cv.ell(c[0] - 18, c[1] - 24, c[0] + 16, c[1] - 6, PLUM_1)
        cv.line(c[0] - 10, c[1] - 14, c[0] + 8, c[1] - 12, BROWN_2)
        return
    shadow(cv, X0 - 0.1, X1 + 0.2, Z0 - 0.3, Z1, 0.55)
    box(cv, X0, X1, 0.3, 1.5, Z0, Z1, hi, seat, dark)
    box(cv, X0, X1, 1.5, 3.4, Z1 - 0.5, Z1, hi, seat, dark)
    box(cv, X0, X0 + 0.45, 1.5, 2.3, Z0, Z1 - 0.5, hi, dark, dark)
    box(cv, X1 - 0.45, X1, 1.5, 2.3, Z0, Z1 - 0.5, hi, dark, dark)
    for X in (X0 + 0.1, X1 - 0.15):
        p = P(X, 0, Z0 + 0.1)
        cv.rect(p[0], p[1] - 4, p[0] + 1, p[1], INK if not leather else GOLD_DK)
    if leather:  # tufting + brass studs
        bx0, by0 = P(X0 + 0.3, 3.2, Z1 - 0.5)
        bx1, by1 = P(X1 - 0.3, 1.7, Z1 - 0.5)
        for i in range(3):
            for j in range(2):
                cv.px(bx0 + 4 + i * (bx1 - bx0 - 8) / 2, by0 + 4 + j * (by1 - by0 - 8), BROWN_0)
        a, b = P(X0, 1.5, Z0), P(X1, 1.5, Z0)
        for k in range(0, int(b[0] - a[0]), 3):
            cv.px(a[0] + k, a[1] + 1, GOLD)
    c0 = P(X0 + 0.5, 2.7, Z1 - 0.6)
    cv.rect(c0[0], c0[1], c0[0] + 9, c0[1] + 7, CREAM if leather else PLUM_2)  # pillow
    cv.line(c0[0], c0[1], c0[0] + 9, c0[1], SLATE_2 if leather else PLUM_3)
    p = P(X1 - 0.25, 2.3, Z0 + 0.6)
    cv.rect(p[0] - 4, p[1] - 2, p[0] + 3, p[1], CREAM)  # open book on the arm
    cv.line(p[0], p[1] - 2, p[0], p[1], OAK_2)


def trophy_case(cv, v):
    X0, X1, Z0, Z1, H = -8.6, -6.9, 47.0, 48.0, 6.2
    shadow(cv, X0, X1 + 0.3, Z0 - 0.4, Z1, 0.5)
    box(cv, X0, X1, 0, H, Z0, Z1, BROWN_2, BROWN_1, BROWN_0)
    tx0, ty0 = P(X0, H, Z0)
    tx1, ty1 = P(X1, 0, Z0)
    cv.rect(tx0 + 2, ty0 + 2, tx1 - 2, ty1 - 16, SLATE_0)
    cv.rect(tx0 + 2, ty0 + 2, tx1 - 2, ty0 + 3, CREAM)
    cx = (tx0 + tx1) / 2
    for k, sy in enumerate(range(int(ty0 + 26), int(ty1 - 16), 24)):
        cv.rect(tx0 + 2, sy, tx1 - 2, sy, SLATE_2)
        if k == 0:
            cv.rect(cx - 5, sy - 12, cx + 5, sy - 7, GOLD); cv.rect(cx - 1, sy - 6, cx + 1, sy - 3, GOLD_DK)
            cv.rect(cx - 4, sy - 2, cx + 4, sy - 1, GOLD_DK); cv.px(cx - 3, sy - 11, SUN)
            cv.px(cx - 7, sy - 11, GOLD); cv.px(cx + 7, sy - 11, GOLD)
        elif k == 1:
            for dx in (-7, 0, 7):
                cv.disc(cx + dx, sy - 5, 3, GOLD if dx else SLATE_2)
                cv.line(cx + dx, sy - 9, cx + dx, sy - 12, CRT_0)
        elif k == 2:
            cv.rect(cx - 8, sy - 11, cx - 1, sy - 1, OAK_1); cv.rect(cx - 6, sy - 9, cx - 3, sy - 6, GOLD)
            cv.disc(cx + 5, sy - 4, 3, TERRA_2)
        else:
            cv.rect(cx - 3, sy - 9, cx + 3, sy - 1, SLATE_2)
    for gx in range(int(tx0 + 4), int(tx1 - 3), 8):
        cv.line(gx, ty0 + 8, gx + 3, ty0 + 5, SLATE_2)
    cv.rect(tx0 + 2, ty1 - 14, tx1 - 2, ty1 - 3, BROWN_1)
    cv.line(tx0 + 4, ty1 - 9, tx1 - 4, ty1 - 9, BROWN_0)
    cv.px(cx, ty1 - 11, GOLD_DK)


def potion_shelf(cv, v):
    sx0, _ = P(-6.6, 0, ZB)
    sx1, _ = P(-5.0, 0, ZB)
    cols = [CRT_1, LEAF_3, SLATE_2, PLUM_3, GLOW, PLUM_2, SLATE_1, GOLD, LEAF_2, RIM, CREAM, CRT_0, SLATE_2, LEAF_3, AMBER]
    for row in range(3):
        sy = P(0, 6.9 - row * 0.85, ZB)[1]
        cv.rect(sx0, sy, sx1, sy + 1, OAK_0)
        cv.line(sx0, sy, sx1, sy, OAK_1)
        cv.line(sx0, sy + 2, sx1, sy + 2, BROWN_0)
        cv.line(sx0 + 2, sy + 2, sx0 + 2, sy + 5, OAK_DK); cv.line(sx1 - 2, sy + 2, sx1 - 2, sy + 5, OAK_DK)
        for b in range(5):
            bx = sx0 + 2 + b * ((sx1 - sx0 - 4) / 5)
            c = cols[row * 5 + b]
            hgt = 7 + (b + row) % 3 * 2
            cv.rect(bx, sy - hgt + 3, bx + 3, sy - 1, c)
            cv.rect(bx + 1, sy - hgt + 1, bx + 2, sy - hgt + 2, c)
            cv.rect(bx + 1, sy - hgt, bx + 2, sy - hgt, OAK_1)
            cv.px(bx + 1, sy - hgt + 4, CREAM)
            cv.px(bx + 3, sy - 2, dn(c))


def bookcase2(cv, v):
    X0, X1, Z0, Z1 = -6.7, -4.9, 46.8, 48.0
    if v == "t1":  # milk crates with books
        shadow(cv, X0, X1, Z0 - 0.3, Z1, 0.45)
        for k, (a, b) in enumerate(((X0, X0 + 0.9), (X0 + 0.95, X1))):
            box(cv, a, b, 0, 1.1, Z0, Z1, BROWN_1, TERRA_0 if k else SLATE_0, INK)
            x0, y0 = P(a, 1.1, Z0)
            x1, y1 = P(b, 0, Z0)
            for gx in range(int(x0) + 2, int(x1) - 1, 3):
                cv.line(gx, y0 + 2, gx, y1 - 2, INK)
        box(cv, X0 + 0.2, X0 + 1.1, 1.1, 2.2, Z0 + 0.1, Z1, BROWN_1, SLATE_0, INK)
        x0, y0 = P(X0 + 0.2, 2.2, Z0 + 0.1)
        books_row(cv, x0 + 2, x0 + 15, y0 + 18, 12, 5)
        return
    shadow(cv, X0, X1 + 0.2, Z0 - 0.3, Z1, 0.5)
    box(cv, X0, X1, 0, 2.6, Z0, Z1, OAK_1, OAK_0, OAK_DK)
    x0, y0 = P(X0, 2.6, Z0)
    x1, y1 = P(X1, 0, Z0)
    cv.rect(x0 + 2, y0 + 3, x1 - 2, y1 - 3, BROWN_0)
    mid = (y0 + y1) / 2
    cv.rect(x0 + 2, mid, x1 - 2, mid + 1, OAK_0)
    books_row(cv, x0 + 3, x1 - 2, mid, int(mid - y0 - 4), 61, 0.95)
    for k in range(5):  # vinyl spines
        cv.line(x0 + 4 + k * 2, mid + 3, x0 + 4 + k * 2, y1 - 4, [CRT_0, SLATE_1, CREAM, PLUM_2, GOLD_DK][k])
    # record player on top (tier IV)
    rx, ry = P((X0 + X1) / 2, 2.6, Z0 + 0.5)
    cv.rect(rx - 12, ry - 4, rx + 12, ry, INK)
    cv.line(rx - 12, ry - 4, rx + 12, ry - 4, OAK_0)
    cv.ell(rx - 8, ry - 5, rx + 4, ry - 2, VOID)
    cv.px(rx - 2, ry - 4, CRT_0)
    cv.line(rx + 7, ry - 6, rx + 2, ry - 3, SLATE_2)


def lib_poster(cv, v):
    x0, y0, x1, y1 = bw(-8.5, -7.0, 7.2, 9.4)
    if v == "t1":  # taped paper
        cv.rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, CREAM)
        cv.disc((x0 + x1) / 2, (y0 + y1) / 2, 6, TERRA_2)
        cv.rect(x0 + 2, (y0 + y1) / 2 + 3, x1 - 2, y1 - 2, OAK_2)
        for (tx, ty) in ((x0 + 1, y0 + 1), (x1 - 4, y0 + 1)):
            cv.rect(tx, ty, tx + 3, ty + 1, SLATE_2)
        return
    gold = v == "t5"
    cv.rect(x0, y0, x1, y1, GOLD_DK if gold else INK)
    cv.line(x0, y0, x1, y0, GOLD if gold else BROWN_2)
    cv.rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, TERRA_1)
    cv.disc((x0 + x1) // 2, (y0 + y1) // 2 + 2, 8, RIM)
    cv.rect(x0 + 2, (y0 + y1) // 2 + 5, x1 - 2, y1 - 2, BROWN_2)
    cv.rect(x0 + 5, y0 + 5, x1 - 5, y0 + 6, CREAM)


def neon(cv, v):
    x0, y0, x1, y1 = bw(-11.6, -8.9, 9.6, 11.2)
    if v != "t5":  # a small wall shelf with a trailing plant + books
        sy = y1 - 2
        cv.rect(x0 + 6, sy, x1 - 6, sy + 2, OAK_0)
        cv.line(x0 + 6, sy, x1 - 6, sy, OAK_1)
        cv.line(x0 + 9, sy + 3, x0 + 12, sy + 6, OAK_DK)
        cv.line(x1 - 9, sy + 3, x1 - 12, sy + 6, OAK_DK)
        pot(cv, x0 + 14, sy, 4, 6, TERRA_1)
        leafy(cv, x0 + 14, sy - 6, 6, 1.2, 9, size=(3, 5), reach=(4, 10))
        books_row(cv, x1 - 22, x1 - 8, sy, 9, 7)
        return
    cv.rect(x0, y0, x1, y1, INK)
    cv.rect(x0, y0, x1, y0, BROWN_1)
    tx = round((x0 + x1) / 2 - text_w("FORGE"))
    ty = round((y0 + y1) / 2 - 5)
    # 2x neon letters with a red tube glow
    tmp = Canvas()
    tmp.text(tx, ty, "FORGE", CRT_1)
    a = tmp.arr()
    m = a != T
    ys, xs = np.nonzero(m)
    p1 = 1 / S  # one art pixel in design units: letters are 2x2 art px blocks with a 1 px tube glow
    for y, x in zip(ys, xs):
        wx, wy = to_du(x + AX, y + AY)
        gx, gy = tx + (wx - tx) * 2, ty + (wy - ty) * 2
        cv.rect(gx - p1, gy - p1, gx + 2 * p1, gy + 2 * p1, CRT_0)
    for y, x in zip(ys, xs):
        wx, wy = to_du(x + AX, y + AY)
        gx, gy = tx + (wx - tx) * 2, ty + (wy - ty) * 2
        cv.rect(gx, gy, gx + p1, gy + p1, CRT_1)
        cv.px(gx, gy, GLOW)


def chess(cv, v):
    st = int(v[1])
    X0, X1, Z0, Z1 = -7.0, -5.0, 30.6, 32.2
    shadow(cv, X0, X1 + 0.3, Z0 - 0.2, Z1, 0.55)
    for X in (X0 + 0.2, X1 - 0.3):
        for Z in (Z0 + 0.15, Z1 - 0.2):
            a, b = P(X, 2.2, Z), P(X, 0, Z)
            cv.rect(a[0], a[1], a[0] + 2, b[1], OAK_DK if Z < Z1 - 0.3 else BROWN_0)
    box(cv, X0, X1, 2.2, 2.4, Z0, Z1, OAK_1, OAK_0, OAK_DK)
    n = 8
    bx0, bx1, bz0, bz1 = X0 + 0.2, X1 - 0.2, Z0 + 0.15, Z1 - 0.15
    dx, dz = (bx1 - bx0) / n, (bz1 - bz0) / n
    for i in range(n):
        for j in range(n):
            Xa, Za = bx0 + i * dx, bz0 + j * dz
            cv.poly([P(Xa, 2.41, Za), P(Xa + dx, 2.41, Za), P(Xa + dx, 2.41, Za + dz), P(Xa, 2.41, Za + dz)],
                    CREAM if (i + j) % 2 else BROWN_1)
    if st == 0:  # pieces still in their box
        p = P(X1 - 0.5, 2.41, Z0 + 0.5)
        cv.rect(p[0] - 10, p[1] - 6, p[0] + 6, p[1], OAK_0)
        cv.line(p[0] - 10, p[1] - 6, p[0] + 6, p[1] - 6, OAK_2)
        return
    pieces = [(0, 0, VOID), (2, 1, VOID), (4, 0, VOID), (6, 1, VOID), (1, 6, CREAM), (3, 7, CREAM), (5, 6, CREAM), (7, 7, CREAM)]
    if st == 2:
        pieces += [(3, 3, VOID), (4, 4, CREAM), (2, 4, CREAM), (5, 2, VOID)]
    for (i, j, col) in pieces:
        x, y = P(bx0 + (i + 0.5) * dx, 2.41, bz0 + (j + 0.5) * dz)
        cv.rect(x - 1, y - 5, x + 1, y, col)
        cv.px(x, y - 6, col)
        cv.px(x + (1 if col == VOID else -1), y - 4, SLATE_1 if col == VOID else SLATE_2)
    if st == 2:  # chess clock
        p = P(X0 + 0.3, 2.41, Z0 + 0.4)
        cv.rect(p[0], p[1] - 6, p[0] + 12, p[1], INK)
        cv.rect(p[0] + 2, p[1] - 4, p[0] + 4, p[1] - 2, CREAM)
        cv.rect(p[0] + 7, p[1] - 4, p[0] + 9, p[1] - 2, CREAM)
        cv.px(p[0] + 3, p[1] - 8, GOLD)


def chess_stool(cv, v):
    X0, X1, Z = -8.3, -7.5, 31.0
    shadow(cv, X0, X1, Z - 0.3, Z + 0.6, 0.5)
    box(cv, X0, X1, 1.5, 1.7, Z, Z + 0.7, BROWN_2, BROWN_1, BROWN_0)
    a, b = P((X0 + X1) / 2, 1.5, Z + 0.35), P((X0 + X1) / 2, 0, Z + 0.35)
    cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], BROWN_1)
    cv.line(a[0] - 6, b[1], a[0] + 6, b[1], BROWN_0)


def lib_books_floor(cv, v):
    p = P(-9.6, 0, 40.5)
    shadow(cv, -10.2, -9.0, 40.2, 41.0, 0.5)
    for k, c in enumerate([SLATE_0, CRT_0, OAK_2, PLUM_1, LEAF_1]):
        w = 18 - (k % 2) * 3
        cv.rect(p[0] - 9 + (k % 2) * 2, p[1] - 3 - k * 3, p[0] - 9 + w + (k % 2) * 2, p[1] - 1 - k * 3, c)
        cv.line(p[0] - 9 + (k % 2) * 2, p[1] - 1 - k * 3, p[0] - 9 + w + (k % 2) * 2, p[1] - 1 - k * 3, dn(c))
    cv.rect(p[0] - 4, p[1] - 19, p[0], p[1] - 16, CREAM)  # mug on top
    cv.px(p[0] + 1, p[1] - 18, CREAM)


def wall_clock(cv, v):
    x, y = P(-5.8, 8.9, ZB)
    cv.disc(x, y, 8, OAK_0)
    cv.disc(x, y, 6, CREAM)
    cv.line(x, y, x, y - 4, INK)
    cv.line(x, y, x + 3, y + 1, INK)
    cv.px(x, y - 6, BROWN_1)
    cv.px(x, y + 6, BROWN_1)


def globe_top(cv, v):
    x, y = P(-10.0, 9.0, 47.0)
    cv.rect(x - 4, y - 2, x + 4, y, OAK_DK)
    cv.line(x, y - 3, x, y - 4, GOLD_DK)
    cv.disc(x, y - 10, 6, SLATE_1)
    cv.disc(x - 1, y - 11, 3, LEAF_2)
    cv.px(x + 3, y - 13, SLATE_2)
    cv.ell(x - 7, y - 17, x + 7, y - 3, GOLD_DK, outline=True)


def shelf_plant(cv, v):
    x, y = P(-11.2, 9.0, 47.2)
    pot(cv, x, y, 5, 6, TERRA_1)
    r = rng(44)
    for vv in range(4):
        vx, yy = x - 6 + vv * 3, y - 2
        for k in range(int(20 + r.integers(0, 30))):
            vx += int(r.integers(-1, 2)) if k % 3 == 0 else 0
            cv.px(vx - 4, yy + k, LEAF_1)
            if k % 4 == 1:
                cv.rect(vx - 6, yy + k, vx - 4, yy + k + 1, LEAF_2)
    leafy(cv, x, y - 6, 6, 1.1, 4, size=(3, 5), reach=(4, 9))


def reading_on(cv, v):
    X1, Z0 = BS[1], BS[2]
    sx, sy = P(X1 - 0.9, 5.3, Z0 - 1.4)
    cv.line(sx - 7, sy + 7, sx + 7, sy + 7, SUN)
    cv.rect(sx - 3, sy + 8, sx + 3, sy + 8, CREAM)
    for k in range(1, 10):
        cv.dither([(sx - 7 - k * 2, sy + 8 + k * 5), (sx + 7 + k * 2, sy + 8 + k * 5), (sx + 8 + k * 2, sy + 13 + k * 5),
                   (sx - 8 - k * 2, sy + 13 + k * 5)], GLOW if k < 4 else AMBER, max(0.03, 0.16 - k * 0.015))


# ------------------------------------------------------------------ window zone props (zone 4)
CRT = (5.4, 7.8)


def amp_tower(cv, v):
    X0, X1 = CRT
    shadow(cv, X0 - 0.2, X1 + 0.3, 46.0, 47.6, 0.55)
    box(cv, X0, X1, 0, 2.4, 46.4, 47.6, BROWN_1, INK, VOID)
    x0, y0 = P(X0, 2.4, 46.4)
    x1, y1 = P(X1, 0, 46.4)
    for yy, kind in ((y0 + 4, "deck"), (y0 + 17, "amp"), (y0 + 31, "eq")):
        cv.line(x0 + 2, yy - 2, x1 - 2, yy - 2, BROWN_1)
        if kind == "deck":
            cv.rect(x0 + 4, yy, x0 + 20, yy + 7, VOID); cv.rect(x0 + 7, yy + 2, x0 + 17, yy + 4, BROWN_1)
            cv.rect(x1 - 14, yy + 2, x1 - 5, yy + 3, CRT_1)
        elif kind == "amp":
            for i in range(5):
                cv.disc(x0 + 8 + i * 8, yy + 4, 2, BROWN_1)
                cv.px(x0 + 8 + i * 8, yy + 3, SLATE_1)
            cv.px(x1 - 5, yy + 2, CRT_1)
        else:
            for i in range(8):
                h = 2 + (i * 7) % 6
                cv.line(x0 + 6 + i * 5, yy + 9 - h, x0 + 6 + i * 5, yy + 9, GLOW if i % 3 else CRT_1)


def crt_big(cv, v):
    box(cv, 5.6, 7.6, 2.4, 4.7, 46.2, 47.6, BROWN_2, BROWN_1, INK)
    cx0, cy0 = P(5.6, 4.7, 46.2)
    cx1, cy1 = P(7.6, 2.4, 46.2)
    sx0, sy0, sx1, sy1 = cx0 + 5, cy0 + 5, cx1 - 11, cy1 - 6
    cv.rect(sx0 - 2, sy0 - 2, sx1 + 2, sy1 + 2, INK)
    cv.rect(sx0, sy0, sx1, sy1, CRT_0)
    cv.rect(sx0, sy0 + (sy1 - sy0) * 0.62, sx1, sy1, TERRA_0)
    cv.disc((sx0 + sx1) / 2 - 3, sy0 + (sy1 - sy0) * 0.45, 6, CRT_1)
    for k in range(4):
        y = sy0 + 4 + k * 5
        cv.line(sx0 + 3 + (k * 7) % 12, y, sx0 + 10 + (k * 7) % 12, y, TERRA_0)
    for y in range(round(sy0), round(sy1), 3):
        cv.line(sx0, y, sx1, y, CRT_0 if y > sy0 + (sy1 - sy0) * 0.62 else TERRA_1)
    cv.px(sx0 + 1, sy0 + 1, CREAM)
    cv.rect(cx1 - 9, cy0 + 7, cx1 - 4, cy0 + 8, BROWN_0)
    cv.px(cx1 - 6, cy1 - 7, CRT_1)
    cv.rect(cx1 - 8, cy0 + 12, cx1 - 4, cy0 + 18, BROWN_0)


def crt_small(cv, v):
    box(cv, 6.0, 7.2, 4.7, 5.9, 46.4, 47.4, BROWN_1, OAK_DK, INK)
    a0, b0 = P(6.0, 5.9, 46.4)
    a1, b1 = P(7.2, 4.7, 46.4)
    cv.rect(a0 + 3, b0 + 3, a1 - 7, b1 - 3, SLATE_0)
    for k in range(4):  # little stat bars
        h = 2 + (k * 5) % 6
        cv.line(a0 + 5 + k * 3, b1 - 4 - h, a0 + 5 + k * 3, b1 - 4, SLATE_2 if k != 2 else LEAF_3)
    cv.rect(a1 - 5, b0 + 4, a1 - 3, b0 + 5, CRT_1)
    cv.line(a1 - 5, b0 + 8, a1 - 3, b0 + 8, BROWN_0)
    cv.line((a0 + a1) / 2, b0 - 1, (a0 + a1) / 2 - 6, b0 - 9, INK)  # rabbit ears
    cv.line((a0 + a1) / 2, b0 - 1, (a0 + a1) / 2 + 5, b0 - 10, INK)


def window_plant(cv, v):
    p = P(4.0, 0, 46.3)
    shadow(cv, 3.5, 4.6, 46.0, 46.8, 0.55)
    pot(cv, p[0], p[1], 6, 12, TERRA_1)
    leafy(cv, p[0], p[1] - 12, 20, 0.9, 9, reach=(8, 26), size=(4, 7))


def sill_props(cv, v):
    x0, y0, x1, y1 = WIN_RECT
    if v == "base":
        pass
    cv.rect(x0 + 5, y1 - 4, x0 + 10, y1, TERRA_1)
    for k in range(5):
        cv.line(x0 + 6 + k, y1 - 5, x0 + 4 + k * 2, y1 - 9 + (k % 2) * 2, LEAF_2)
    cv.px(x0 + 6, y1 - 9, LEAF_3)


def sill_mug(cv, v):
    x0, y0, x1, y1 = WIN_RECT
    cv.rect(x0 + 18, y1 - 5, x0 + 22, y1, CREAM)
    cv.px(x0 + 23, y1 - 3, CREAM)
    cv.px(x0 + 19, y1 - 7, SLATE_2)
    cv.px(x0 + 20, y1 - 9, SLATE_2)


def sill_books(cv, v):
    x0, y0, x1, y1 = WIN_RECT
    for k, c in enumerate([SLATE_1, OAK_2, CRT_0]):
        cv.rect(x1 - 30, y1 - 2 - k * 3, x1 - 16 + (k % 2) * 2, y1 - k * 3, c)


def vinyl_crate(cv, v):
    X0, X1, Z0, Z1 = 0.6, 2.2, 44.6, 45.6
    shadow(cv, X0, X1 + 0.2, Z0 - 0.2, Z1, 0.5)
    box(cv, X0, X1, 0, 1.0, Z0, Z1, BROWN_1, OAK_0, OAK_DK)
    x0, y0 = P(X0, 1.0, Z0)
    x1, y1 = P(X1, 0, Z0)
    for k in range(9):
        cv.line(x0 + 2 + k * 3, y0 - 6 + (k % 3), x0 + 2 + k * 3, y0, [CRT_0, CREAM, SLATE_1, GOLD_DK, PLUM_2][k % 5])
    cv.line(x0 + 2, y0 + 4, x1 - 2, y0 + 4, OAK_DK)


def plant_wall(cv, v):
    x0, y0, x1, y1 = bw(7.05, 8.35, 6.0, 10.0)
    if v != "t4" and v != "t5":
        x, y = (x0 + x1) / 2, y0 + 16
        cv.line(x, y0 - 4, x, y - 8, INK)
        pot(cv, x, y, 5, 7, TERRA_1)
        leafy(cv, x, y - 7, 7, 1.0, 21, size=(3, 5), reach=(4, 10))
        return
    cv.rect(x0, y0, x1, y1, OAK_DK)
    cv.rect(x0, y0, x1, y0 + 1, OAK_0)
    for k in range(5):
        yy = y0 + 6 + k * 13
        leafy(cv, (x0 + x1) / 2 + (k % 2) * 4 - 2, yy + 6, 7, 1.6, 30 + k, size=(3, 6), reach=(3, 9), up_bias=-1.2)
    for k in range(3):
        cv.px(x0 + 3 + k * 8, y1 - 2, LEAF_3)


def power_strip(cv, v):
    a = P(4.7, 0.05, 45.4)
    cv.rect(a[0], a[1] - 2, a[0] + 16, a[1], INK)
    cv.px(a[0] + 1, a[1] - 2, CRT_1)
    for k in range(3):
        cv.px(a[0] + 5 + k * 4, a[1] - 1, BROWN_1)


# ------------------------------------------------------------------ study (zone 5)
DESK = (8.6, 11.2, 45.6, 47.8, 2.7)


def desk(cv, v):
    X0, X1, Z0, Z1, H = DESK
    shadow(cv, X0 - 0.1, X1 + 0.3, Z0 - 0.4, Z1, 0.5)
    if v == "t1":  # folding table
        box(cv, X0, X1, H - 0.12, H, Z0, Z1, SLATE_2, SLATE_1, SLATE_0)
        for X in (X0 + 0.15, X1 - 0.2):
            a, b = P(X, H - 0.12, Z0 + 0.15), P(X, 0, Z0 + 0.15)
            cv.line(a[0], a[1], b[0], b[1], INK)
            a2, b2 = P(X, H - 0.12, Z1 - 0.2), P(X + 0.3, 0, Z0 + 0.6)
            cv.line(a2[0], a2[1], b2[0], b2[1], BROWN_0)
        return
    top = OAK_1 if v != "t5" else OAK_2
    box(cv, X0, X1, H - 0.2, H, Z0, Z1, top, OAK_0, OAK_DK)
    for X in (X0 + 0.1, X1 - 0.25):
        a, b = P(X, H - 0.2, Z0 + 0.1), P(X, 0, Z0 + 0.1)
        cv.rect(a[0], a[1], a[0] + 2, b[1], OAK_DK)
    d0, d1 = P(X1 - 1.1, H - 0.2, Z0 + 0.1), P(X1 - 0.15, 1.0, Z0 + 0.1)
    cv.rect(d0[0], d0[1], d1[0], d1[1], OAK_0)
    cv.line(d0[0], (d0[1] + d1[1]) / 2, d1[0], (d0[1] + d1[1]) / 2, OAK_DK)
    cv.px((d0[0] + d1[0]) / 2, d0[1] + 4, AMBER if v != "t5" else GOLD)
    cv.px((d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2 + 4, AMBER if v != "t5" else GOLD)
    if v == "t5":  # warm LED strip under the top
        a, b = P(X0, H - 0.22, Z0), P(X1, H - 0.22, Z0)
        cv.line(a[0], a[1] + 1, b[0], b[1] + 1, GLOW)


def desk_y():
    return P(0, DESK[4], 46.6)[1]


def corkboard(cv, v):
    st = int(v[1]) if v[0] == "s" else 1
    x0, y0, x1, y1 = bw(8.7, 10.6, 4.6, 6.8)
    cv.rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, OAK_0)
    cv.line(x0 - 2, y0 - 2, x1 + 2, y0 - 2, OAK_1)
    cv.rect(x0, y0, x1, y1, TERRA_1)
    for k in range(18):
        cv.px(x0 + 2 + (k * 7) % (x1 - x0 - 3), y0 + 2 + (k * 5) % (y1 - y0 - 3), TERRA_2)
    cols = [SLATE_1, LEAF_2, PLUM_2, GLOW, CREAM]
    cells = [(i, j) for i in range(4) for j in range(4) if (i * 3 + j) % 4 != 3]
    n = {0: 4, 1: len(cells) - 2, 2: len(cells)}[st]
    for k, (i, j) in enumerate(cells[:n]):
        bx = x0 + 2 + i * 8
        by = y0 + 3 + j * 9
        cv.rect(bx, by, bx + 6, by + 6, cols[(i + j) % 5])
        cv.line(bx + 1, by + 3, bx + 5, by + 3, BROWN_1)
        cv.line(bx + 1, by + 5, bx + 3, by + 5, BROWN_1)
        cv.px(bx + 3, by, CRT_1 if (i + j) % 2 else SLATE_2)
    if st == 2:  # gold star sticker
        sx, sy = x1 - 5, y0 + 4
        cv.px(sx, sy - 2, GOLD); cv.line(sx - 2, sy, sx + 2, sy, GOLD); cv.px(sx, sy - 1, SUN)
        cv.px(sx - 1, sy + 1, GOLD); cv.px(sx + 1, sy + 1, GOLD)
    if v == "alert":  # red sheet: something due in under 48 h
        ax, ay = x0 + 9, y0 + 6
        cv.poly([(ax, ay), (ax + 14, ay - 1), (ax + 15, ay + 17), (ax + 1, ay + 18)], CRT_0)
        cv.line(ax, ay, ax + 14, ay - 1, CRT_1)
        for k in range(4):
            cv.line(ax + 3, ay + 4 + k * 3, ax + 11 - (k % 2) * 3, ay + 4 + k * 3, TERRA_0)
        cv.px(ax + 7, ay, CREAM)


def calendar(cv, v):
    st = int(v[1])
    x0, y0, x1, y1 = bw(10.8, 11.9, 4.9, 6.9)
    cv.rect(x0, y0, x1, y1, CREAM)
    cv.rect(x0, y0, x1, y0 + 5, CRT_0)
    cv.line((x0 + x1) / 2, y0 - 3, (x0 + x1) / 2, y0, INK)
    cols = [SLATE_1, LEAF_2, GLOW, PLUM_2, TERRA_2]
    for i in range(4):
        for j in range(5):
            filled = st == 2 or (st == 1 and (i + j * 2) % 3 == 0)
            c = cols[(i + j) % 5] if filled else (BROWN_2 if (i + j) % 7 else CRT_1)
            cv.rect(x0 + 2 + i * 4, y0 + 8 + j * 5, x0 + 4 + i * 4, y0 + 10 + j * 5, c)
    # planner on a hook below
    px0, py0, px1, py1 = bw(10.95, 11.75, 3.6, 4.6)
    cv.rect(px0, py0, px1, py1, BROWN_1 if st == 0 else PLUM_1)
    cv.line(px0, py0, px1, py0, PLUM_2 if st else BROWN_2)
    cv.line(px0 + 2, py0 + 2, px0 + 2, py1 - 1, CREAM)
    if st:
        cv.rect(px1 - 3, py0 + 3, px1 - 1, py0 + 5, GLOW)


def course_books(cv, v):
    y = desk_y()
    bx = P(8.8, 0, 46.6)[0]
    for k, c in enumerate([SLATE_1, CRT_0, LEAF_2, GOLD, PLUM_2, TERRA_2]):
        w = 14 - (k % 3) * 2
        cv.rect(bx + (k % 2), y - 3 - k * 3, bx + w + (k % 2), y - 1 - k * 3, c)
        cv.line(bx + (k % 2), y - 1 - k * 3, bx + w + (k % 2), y - 1 - k * 3, dn(c))
        cv.px(bx + 2 + (k % 2), y - 2 - k * 3, CREAM)


def notebook(cv, v):
    y = desk_y()
    nx = P(9.85, 0, 46.4)[0]
    cv.poly([(nx, y), (nx + 12, y), (nx + 11, y - 3), (nx + 1, y - 3)], INK)
    cv.poly([(nx + 1, y - 1), (nx + 11, y - 1), (nx + 10, y - 3), (nx + 2, y - 3)], TERRA_0)
    cv.line(nx + 3, y - 2, nx + 3, y - 1, GOLD_DK)
    cv.line(nx + 6, y - 4, nx + 13, y - 6, GOLD)  # pen
    cv.px(nx + 13, y - 6, INK)


def desk_lamp(cv, v):
    y = desk_y()
    lx = P(11.0, 0, 46.8)[0]
    if v == "t1":  # clip lamp on the desk edge
        cv.rect(lx - 2, y - 3, lx + 1, y, INK)
        cv.line(lx, y - 3, lx - 3, y - 14, INK)
        cv.ell(lx - 9, y - 19, lx - 1, y - 12, SLATE_0)
        cv.line(lx - 8, y - 12, lx - 2, y - 12, AMBER)
        return
    lit = v == "night"
    cv.rect(lx - 4, y - 2, lx + 4, y, INK)
    cv.line(lx, y - 2, lx - 5, y - 15, BROWN_1)
    cv.line(lx - 5, y - 15, lx - 11, y - 21, BROWN_1)
    cv.poly([(lx - 15, y - 25), (lx - 8, y - 25), (lx - 5, y - 19), (lx - 17, y - 19)], TERRA_1 if v != "t5" else GOLD_DK)
    cv.line(lx - 17, y - 19, lx - 5, y - 19, SUN if lit else GLOW)
    if lit:
        cv.rect(lx - 14, y - 18, lx - 8, y - 18, CREAM)


def study_on(cv, v):
    y = desk_y()
    lx = P(11.0, 0, 46.8)[0]
    cv.line(lx - 17, y - 19, lx - 5, y - 19, SUN)
    cv.rect(lx - 14, y - 18, lx - 8, y - 18, CREAM)
    for k in range(1, 6):
        cv.dither([(lx - 17 - k * 4, y - 18 + k * 3), (lx - 3 + k * 4, y - 18 + k * 3), (lx - 2 + k * 4, y - 15 + k * 3),
                   (lx - 18 - k * 4, y - 15 + k * 3)], GLOW if k < 3 else AMBER, max(0.04, 0.2 - k * 0.03))


def study_chair(cv, v):
    X0, X1, Z0, Z1 = 9.4, 10.6, 43.6, 44.6
    shadow(cv, X0, X1 + 0.2, Z0 - 0.2, Z1, 0.5)
    if v == "t1":  # stool
        box(cv, X0 + 0.2, X1 - 0.2, 1.6, 1.8, Z0 + 0.2, Z1 - 0.2, BROWN_2, BROWN_1, BROWN_0)
        for X in (X0 + 0.3, X1 - 0.35):
            a, b = P(X, 1.6, Z0 + 0.3), P(X, 0, Z0 + 0.3)
            cv.line(a[0], a[1], b[0], b[1], BROWN_1)
        return
    box(cv, X0, X1, 1.5, 1.7, Z0, Z1, BROWN_1, BROWN_0, INK)
    box(cv, X0, X1, 1.7, 3.7, Z1 - 0.2, Z1, BROWN_1, BROWN_1 if v != "t5" else TERRA_0, INK)
    a, b = P((X0 + X1) / 2, 1.5, Z0 + 0.5), P((X0 + X1) / 2, 0.3, Z0 + 0.5)
    cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], INK)
    for X in (X0 + 0.1, X1 - 0.1):
        p = P(X, 0.0, Z0 + 0.5)
        cv.line(b[0], b[1], p[0], p[1], INK)


def backpack(cv, v):
    x, y = P(8.0, 0, 44.6)
    shadow(cv, 7.6, 8.5, 44.3, 44.9, 0.5)
    cv.rect(x - 8, y - 22, x + 8, y, SLATE_0)
    cv.ell(x - 8, y - 27, x + 8, y - 17, SLATE_0)
    cv.line(x - 6, y - 25, x + 6, y - 25, SLATE_1)
    cv.rect(x - 5, y - 12, x + 5, y - 2, SLATE_1)
    cv.line(x - 5, y - 12, x + 5, y - 12, SLATE_2)
    cv.line(x - 4, y - 7, x + 4, y - 7, SLATE_0)
    cv.px(x + 4, y - 10, CRT_1)
    cv.line(x - 9, y - 19, x - 11, y - 4, INK)


def pennant(cv, v):
    x0, y0, x1, y1 = bw(8.6, 11.2, 8.4, 9.8)
    my = (y0 + y1) / 2
    cv.poly([(x0, y0), (x1, my), (x0, y1)], LEAF_2)
    cv.poly([(x0 + 4, y0 + 4), (x1 - 18, my), (x0 + 4, y1 - 4)], LEAF_1)
    cv.line(x0, y0, x1, my, SLATE_2)
    cv.line(x0, y1, x1, my, SLATE_2)
    cv.rect(x0 - 3, y0, x0, y1, SLATE_2)
    for k in range(3):  # blank stripe marks, no text or crest
        cv.line(x0 + 8 + k * 10, my - 1, x0 + 13 + k * 10, my - 1, SLATE_2)


def photo_frame(cv, v):
    x0, y0, x1, y1 = bw(11.4, 12.4, 8.2, 9.9)
    cv.rect(x0, y0, x1, y1, GOLD_DK)
    cv.line(x0, y0, x1, y0, GOLD)
    cv.rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, BROWN_0)
    cv.line(x0 + 3, y1 - 3, x1 - 3, y0 + 3, BROWN_1)


def wall_shelf(cv, v):
    x0, y0, x1, y1 = bw(10.9, 12.5, 7.1, 7.3)
    cv.rect(x0, y0, x1, y1, OAK_0)
    cv.line(x0, y0, x1, y0, OAK_1)
    pot(cv, x0 + 6, y0, 3, 5, CREAM)
    leafy(cv, x0 + 6, y0 - 5, 5, 1.0, 14, size=(2, 4), reach=(3, 7))
    cv.rect(x1 - 9, y0 - 7, x1 - 3, y0 - 1, OAK_DK)
    cv.px(x1 - 6, y0 - 5, GLOW)


def trash_bin(cv, v):
    x, y = P(11.6, 0, 44.4)
    shadow(cv, 11.3, 12.0, 44.2, 44.7, 0.5)
    cv.poly([(x - 6, y - 14), (x + 6, y - 14), (x + 5, y), (x - 5, y)], BROWN_1)
    cv.line(x - 6, y - 14, x + 6, y - 14, BROWN_2)
    cv.poly([(x - 3, y - 17), (x + 1, y - 19), (x + 3, y - 15), (x - 2, y - 14)], CREAM)


def headphones(cv, v):
    x, y = P(12.45, 5.6, ZB)
    cv.px(x, y - 9, GOLD_DK)
    cv.ell(x - 6, y - 8, x + 6, y + 4, INK, outline=True)
    cv.rect(x - 7, y + 1, x - 4, y + 6, BROWN_1)
    cv.rect(x + 4, y + 1, x + 7, y + 6, BROWN_1)
    cv.px(x - 6, y + 2, CRT_1)


def desk_mug(cv, v):
    y = desk_y()
    mx = P(10.55, 0, 47.2)[0]
    cv.rect(mx, y - 6, mx + 4, y - 1, SLATE_1)
    cv.px(mx + 5, y - 4, SLATE_1)
    cv.px(mx + 1, y - 5, SLATE_2)
    for k in range(3):
        cv.line(mx - 5 + k, y - 7, mx - 6 + k * 2, y - 12, [GOLD, CRT_1, SLATE_2][k])
    cv.rect(mx - 6, y - 6, mx - 3, y - 1, TERRA_1)


def main():
    # library (zone 3)
    emit("library.bookshelf", zone="library", kind="hotspot", layer=2, paint=bookshelf, variants=("s0", "s1", "s2"),
         target={"skill": "reading"}, label="READING", note="9 ft bookshelf with a clamp reading lamp")
    emit("library.armchair", zone="library", kind="decor", layer=3, paint=armchair, variants=("base", "t1", "t3", "t4"),
         note="reading chair (t1 beanbag, t3 fabric armchair, t4 tufted leather)")
    emit("library.archive", zone="library", kind="hotspot", layer=2, paint=trophy_case, target={"feature": "archive"},
         label="ARCHIVE", note="lit glass trophy case")
    emit("library.potions", zone="library", kind="decor", layer=2, paint=potion_shelf, note="potion shelf, 15 small bottles")
    emit("library.bookcase", zone="library", kind="decor", layer=2, paint=bookcase2, variants=("base", "t1", "t4"),
         note="low case under the potions (t1 milk crates, t4 wood bookcase + record player)")
    emit("library.poster", zone="library", kind="decor", layer=2, paint=lib_poster, variants=("base", "t1", "t3", "t5"),
         note="sunset poster (t1 taped, t3 framed, t5 gilt frame)")
    emit("library.sign", zone="library", kind="decor", layer=2, paint=neon, variants=("base", "t1", "t5"),
         note="wall shelf with plant; t5 neon FORGE sign")
    emit("library.chess", zone="library", kind="hotspot", layer=5, paint=chess, variants=("s0", "s1", "s2"),
         target={"skill": "chess"}, label="CHESS", note="chess table (s0 boxed set, s2 game + clock)")
    emit("library.stool", zone="library", kind="decor", layer=5, paint=chess_stool, note="stool by the chess table")
    emit("library.books-floor", zone="library", kind="decor", layer=3, paint=lib_books_floor, note="book stack + mug on the floor")
    emit("library.clock", zone="library", kind="decor", layer=2, paint=wall_clock, note="round wall clock")
    emit("library.globe", zone="library", kind="decor", layer=2, paint=globe_top, note="desk globe on the bookshelf top")
    emit("library.shelf-plant", zone="library", kind="decor", layer=2, paint=shelf_plant, note="trailing plant on the bookshelf top")
    emit("library.on", zone="library", kind="overlay", layer=3, paint=reading_on, light=False, rim=False,
         note="'it's on' light: reading lamp lit with a pool over the chair")
    # window zone (zone 4)
    emit("window.amp", zone="window", kind="decor", layer=2, paint=amp_tower, note="tape deck / amp / EQ tower under the CRTs")
    emit("window.today", zone="window", kind="hotspot", layer=2, paint=crt_big, target={"feature": "today"}, label="TODAY",
         light=False, note="big CRT (red sun) on the amp tower")
    emit("window.stats", zone="window", kind="hotspot", layer=2, paint=crt_small, target={"feature": "stats"}, label="STATS",
         light=False, note="small CRT with stat bars on top")
    emit("window.plant", zone="window", kind="decor", layer=2, paint=window_plant, note="leafy plant in a pot by the window")
    emit("window.sill-plant", zone="window", kind="decor", layer=2, paint=sill_props, note="succulent on the sill")
    emit("window.sill-mug", zone="window", kind="decor", layer=2, paint=sill_mug, note="steaming mug on the sill")
    emit("window.sill-books", zone="window", kind="decor", layer=2, paint=sill_books, note="three paperbacks on the sill")
    emit("window.vinyl", zone="window", kind="decor", layer=2, paint=vinyl_crate, note="vinyl crate in the sun patch")
    emit("window.plantwall", zone="window", kind="decor", layer=2, paint=plant_wall, variants=("base", "t1", "t4"),
         note="t1 one hanging pot, t4 plant wall panel")
    emit("window.powerstrip", zone="window", kind="decor", layer=2, paint=power_strip, note="power strip with a red LED")
    # study (zone 5)
    emit("study.desk", zone="study", kind="decor", layer=2, paint=desk, variants=("base", "t1", "t3", "t5"),
         note="study desk (t1 folding table, t3 oak desk, t5 custom with LED strip)")
    emit("study.academics", zone="study", kind="hotspot", layer=2, paint=corkboard, variants=("s0", "s1", "s2", "alert"),
         target={"skill": "academics"}, label="ACADEMICS", note="class corkboard (alert: red sheet, due < 48 h)")
    emit("study.time", zone="study", kind="hotspot", layer=2, paint=calendar, variants=("s0", "s1", "s2"),
         target={"skill": "time-blocking"}, label="TIME BLOCKING", note="wall calendar + planner on a hook")
    emit("study.courses", zone="study", kind="hotspot", layer=2, paint=course_books, target={"feature": "courses"},
         label="COURSES", note="course books stack, one coloured spine per course")
    emit("study.journal", zone="study", kind="hotspot", layer=2, paint=notebook, target={"feature": "journal"},
         label="JOURNAL", note="notebook + pen on the desk")
    emit("study.lamp", zone="study", kind="decor", layer=2, paint=desk_lamp, variants=("base", "night", "t1", "t2", "t5"),
         note="desk lamp (t1 clip lamp, t2 desk lamp)")
    emit("study.chair", zone="study", kind="decor", layer=3, paint=study_chair, variants=("base", "t1", "t3", "t5"),
         note="desk chair (t1 stool, t3 chair)")
    emit("study.backpack", zone="study", kind="decor", layer=2, paint=backpack, note="backpack by the desk")
    emit("study.pennant", zone="study", kind="decor", layer=2, paint=pennant, note="green + sky-blue pennant, no crest or text")
    emit("study.photo", zone="study", kind="decor", layer=2, paint=photo_frame,
         note="photo frame; engine draws public/room/user/wall-frame.png inside the dark opening if present")
    emit("study.shelf", zone="study", kind="decor", layer=2, paint=wall_shelf, note="small wall shelf, plant + speaker")
    emit("study.bin", zone="study", kind="decor", layer=2, paint=trash_bin, note="waste bin with a crumpled sheet")
    emit("study.headphones", zone="study", kind="decor", layer=2, paint=headphones, note="headphones on a wall hook")
    emit("study.mug", zone="study", kind="decor", layer=2, paint=desk_mug, note="mug + pencil cup")
    emit("study.on", zone="study", kind="overlay", layer=3, paint=study_on, light=False, rim=False,
         note="'it's on' light: desk lamp lit with a pool on the desk")
    finish("back")


if __name__ == "__main__":
    main()
