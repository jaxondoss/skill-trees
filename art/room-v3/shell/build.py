"""Room v3 shell: sky (L0), New Orleans outside (L1), the room shell split into depth bands L2..L5 (with
overlap margins so the dolly never opens seams), window casing, ceiling decor, pendants, string lights, rug
and the L6 frame crops. Run: python3 art/room-v3/shell/build.py
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403
import room  # noqa: E402

# ------------------------------------------------------------------ depth map of the room surfaces
r_ = (WX - VX) / F
a_ = -HALF - K * ZB
INF = np.float32(1e9)
with np.errstate(divide="ignore", invalid="ignore"):
    zf = np.where(WY > VY + 0.5, F * EYE / (WY - VY), INF)
    zc = np.where(WY < VY - 0.5, F * (CEIL - EYE) / (VY - WY), INF)
    zl = np.where(r_ < K, a_ / (r_ - K), INF)
    zr = np.where(r_ > -K, -a_ / (r_ + K), INF)
zl[zl <= 0] = INF
zr[zr <= 0] = INF
DEPTH = np.minimum.reduce([zf, zc, zl, zr, np.full_like(zf, ZB)])
SURF = np.argmin(np.stack([zf, zc, zl, zr, np.full_like(zf, ZB)]), 0)  # 0 floor 1 ceil 2 left 3 right 4 back


# ------------------------------------------------------------------ painting the shell
def floor(cv):
    zmin = 13.5
    cv.poly([P(-40, 0, ZB), P(40, 0, ZB), P(40, 0, zmin), P(-40, 0, zmin)], OAK_1)
    r = rng(1)
    pw = 0.42
    X, n = -32.0, 0
    while X < 32:
        off = (n * 2.7) % 7.0
        zs = [ZB]
        z = ZB - off - 1.0
        while z > zmin:
            zs.append(z)
            z -= 7.0
        zs.append(zmin)
        for a, b in zip(zs, zs[1:]):
            tone = [OAK_1, OAK_1, OAK_0, OAK_1, OAK_2, OAK_1][int(r.integers(0, 6))]
            cv.poly([P(X, 0, a), P(X + pw, 0, a), P(X + pw, 0, b), P(X, 0, b)], tone)
            for gi in range(2):  # grain
                gx = X + pw * (0.3 + 0.4 * gi) + r.uniform(-0.04, 0.04)
                za = a - r.uniform(0.3, 1.5)
                zb_ = max(b, za - r.uniform(1.5, 4.5))
                p0, p1 = P(gx, 0, za), P(gx + r.uniform(-0.03, 0.03), 0, zb_)
                if p1[1] - p0[1] > 3:
                    cv.line(*p0, *p1, OAK_0 if tone != OAK_0 else OAK_DK)
            if r.random() < 0.1:
                kz = r.uniform(b, a)
                kx, ky = P(X + pw / 2, 0, kz)
                if ky > 420:
                    cv.ell(kx - 2, ky - 1, kx + 1, ky + 1, OAK_DK)
            cv.line(*P(X, 0, b), *P(X + pw, 0, b), OAK_DK)  # end joint
        cv.line(*P(X, 0, ZB), *P(X, 0, zmin), OAK_DK)
        # a lighter sheen line on every 3rd board (premium finish)
        if n % 3 == 0:
            cv.line(*P(X + pw * 0.5, 0, ZB - 0.5), *P(X + pw * 0.5, 0, ZB - 4), OAK_2)
        X += pw
        n += 1


def ceiling(cv):
    cv.poly([P(-60, CEIL, ZB), P(60, CEIL, ZB), P(60, CEIL, 12), P(-60, CEIL, 12)], BROWN_0)
    X = -40.0
    while X < 40:
        cv.line(*P(X, CEIL, ZB), *P(X, CEIL, 14), INK)
        X += 1.0


def side_walls(cv):
    for side in "LR":
        zf_ = 28.5
        cv.poly([WP(side, ZB, CEIL), WP(side, zf_, CEIL), WP(side, zf_, 0), WP(side, ZB, 0)], OAK_DK)
        z, k = ZB, 0
        while z > zf_:
            z2 = z - 0.55
            if k % 3 == 1:
                wquad(cv, side, z2, z, 0.55, 11.5, BROWN_2)
            cv.line(*WP(side, z, 0.55), *WP(side, z, 11.5), BROWN_0)
            if k % 3 == 0:  # grain fleck
                p = WP(side, z - 0.27, 7.0 + (k % 5) * 0.6)
                cv.px(p[0], p[1], OAK_0)
            z, k = z2, k + 1
        wquad(cv, side, zf_, ZB, 0, 0.45, BROWN_0)       # baseboard
        wquad(cv, side, zf_, ZB, 0.45, 0.55, OAK_0)
        wquad(cv, side, zf_, ZB, 3.2, 3.38, OAK_0)       # chair rail
        wquad(cv, side, zf_, ZB, 3.2, 3.24, OAK_1)
        wquad(cv, side, zf_, ZB, 11.5, CEIL, BROWN_0)    # crown
        wquad(cv, side, zf_, ZB, 11.45, 11.5, OAK_0)


def back_wall(cv):
    bx0, by0 = P(-HALF, CEIL, ZB)
    bx1, by1 = P(HALF, 0, ZB)
    cv.rect(bx0, by0, bx1, by1, OAK_DK)
    X, k = -HALF, 0
    while X < HALF:
        x0, x1 = P(X, 0, ZB)[0], P(X + 0.55, 0, ZB)[0]
        if k % 3 == 1:
            cv.rect(x0, by0, x1, by1, BROWN_2)
        cv.line(x0, by0, x0, by1, BROWN_0)
        if k % 4 == 2:
            cv.px(x0 + 4, P(0, 7.3 + (k % 3) * 0.7, ZB)[1], OAK_0)
        X, k = X + 0.55, k + 1
    y = lambda h: P(0, h, ZB)[1]  # noqa: E731
    cv.rect(bx0, y(0.45), bx1, by1, BROWN_0)
    cv.rect(bx0, y(0.55), bx1, y(0.45), OAK_0)
    cv.rect(bx0, y(3.38), bx1, y(3.2), OAK_0)
    cv.line(bx0, y(3.38), bx1, y(3.38), OAK_1)
    cv.rect(bx0, by0, bx1, y(11.5), BROWN_0)
    cv.line(bx0, y(11.5), bx1, y(11.5), OAK_0)
    # inner corner shadows
    for side in "LR":
        x = bx0 if side == "L" else bx1
        cv.line(x, by0, x, by1, INK)


def beams(cv):
    for Zb in (46.6, 42.4, 38.2, 34.0):
        xl, xr = XL(Zb), XR(Zb)
        a, b = P(xl, CEIL, Zb), P(xr, CEIL, Zb)
        c_, d = P(xr, CEIL - 0.7, Zb), P(xl, CEIL - 0.7, Zb)
        cv.poly([a, b, c_, d], BROWN_1)
        e, f_ = P(XL(Zb + 0.7), CEIL - 0.7, Zb + 0.7), P(XR(Zb + 0.7), CEIL - 0.7, Zb + 0.7)
        cv.poly([d, c_, f_, e], OAK_DK)
        cv.line(*d, *c_, OAK_0)
        cv.line(*a, *b, INK)
        p, q = P(xl, CEIL - 0.78, Zb - 0.05), P(xr, CEIL - 0.78, Zb - 0.05)
        for x in range(max(-120, round(p[0])), min(1081, round(q[0]))):  # cable run along the beam
            t = (x + 120) / 1200
            cv.px(x, p[1] + 2 + 2 * abs(math.sin(t * 13 + Zb)), INK)


def window_hole(a):
    x0, y0, x1, y1 = WIN_RECT
    a[y0 - AY:y1 - AY + 1, x0 - AX:x1 - AX + 1] = T
    return a


def paint_shell():
    cv = Canvas()
    floor(cv)
    ceiling(cv)
    side_walls(cv)
    back_wall(cv)
    beams(cv)
    a = cv.arr()
    # walls must win over floor/ceiling exactly along the analytic surfaces
    return window_hole(a)


BANDS = {2: (44.0, 99.0), 3: (40.0, 44.0), 4: (35.0, 40.0), 5: (0.0, 35.0)}
MARGIN = 1.6  # feet: each band extends this far forward under the nearer band


def band_mask(layer):
    lo, hi = BANDS[layer]
    return (DEPTH >= lo - (MARGIN if layer < 5 else 0)) & (DEPTH < hi)


def emit_bands():
    base = paint_shell()
    lit = {"base": apply_light(base, night=False), "night": apply_light(base, night=True)}
    # cool moonlight on the night floor
    moon = room._mask([P(0.2, 0, 45.5), P(5.4, 0, 45.5), P(3.0, 0, 33.0), P(-3.2, 0, 33.0)]) & (SURF == 0) & (BAY < 0.22)
    lit["night"][moon] = SLATE_0
    for layer in (2, 3, 4, 5):
        m = band_mask(layer)

        def paint(cv, v, m=m):
            a = np.full((AH, AW), T, np.uint8)
            a[m] = lit[v][m]
            cv.set(a)

        emit(f"shell.l{layer}", zone="shell", kind="shell", layer=layer, paint=paint, variants=("base", "night"),
             light=False, rim=False, note=f"room shell band L{layer} (depth {BANDS[layer][0]:g}..{BANDS[layer][1]:g} ft)")


# ------------------------------------------------------------------ window view
MARG = 26


def view_rect():
    x0, y0, x1, y1 = WIN_RECT
    return x0 - MARG, y0 - MARG, x1 + MARG, y1 + MARG


def sky(cv, v):
    x0, y0, x1, y1 = view_rect()
    wy0, wy1 = WIN_RECT[1], WIN_RECT[3]
    if v == "base":
        bands = [(PLUM_1, 0.0), (TERRA_1, 0.16), (TERRA_2, 0.3), (RIM, 0.44), (ORANGE, 0.58), (GLOW, 0.72)]
    else:
        bands = [(INK, 0.0), (BROWN_1, 0.25), (SLATE_0, 0.5), (SLATE_0, 0.7)]
    for y in range(y0, y1 + 1):
        t = (y - wy0) / max(1, (wy1 - wy0))
        col = bands[0][0]
        for k, (c, s) in enumerate(bands):
            if t >= s:
                col = c
                nxt = bands[k + 1][1] if k + 1 < len(bands) else 9
                if (nxt - t) < 0.06 and BAYER[y % 4][(y // 4) % 4] > 0.5:
                    col = bands[min(k + 1, len(bands) - 1)][0]
        cv.line(x0, y, x1, y, col)
    r = rng(4)
    if v == "base":
        for k in range(10):
            cy = wy0 + 8 + int(r.integers(0, (wy1 - wy0) // 2))
            cx = x0 + int(r.integers(0, x1 - x0))
            ln = int(r.integers(14, 40))
            cv.line(cx, cy, cx + ln, cy, GLOW if cy > wy0 + 30 else RIM)
            cv.line(cx + 4, cy + 1, cx + ln - 6, cy + 1, TERRA_2)
        sx, sy = x0 + int((x1 - x0) * 0.62), wy0 + int((wy1 - wy0) * 0.6)
        cv.disc(sx, sy, 14, GLOW)
        cv.disc(sx, sy, 12, SUN)
        cv.disc(sx - 3, sy - 3, 5, CREAM)
    else:
        for k in range(26):
            cv.px(x0 + int(r.integers(0, x1 - x0)), wy0 + int(r.integers(0, (wy1 - wy0) * 0.6)), CREAM if k % 3 else SLATE_2)
        mx, my = x0 + int((x1 - x0) * 0.3), wy0 + 22
        cv.disc(mx, my, 8, SLATE_2)
        cv.disc(mx - 1, my - 1, 7, CREAM)
        cv.disc(mx + 3, my - 2, 6, SLATE_0)  # crescent bite
    hz = wy0 + int((wy1 - wy0) * 0.70)
    for k in range(0, x1 - x0 + 10, 3):  # far live oaks
        x = x0 + k
        hh = int(4 + 3 * math.sin(k * 0.21) + 2 * math.sin(k * 0.57))
        cv.line(x, hz - hh, x + 2, hz - hh, LEAF_1 if v == "base" else INK)
        cv.rect(x, hz - hh + 1, x + 2, y1, LEAF_0 if v == "base" else INK)


def outside(cv, v):
    x0, y0, x1, y1 = view_rect()
    wy0, wy1 = WIN_RECT[1], WIN_RECT[3]
    hz = wy0 + int((wy1 - wy0) * 0.70)
    night = v == "night"
    r = rng(7)
    x = x0 - 6
    k = 0
    while x < x1:  # shotgun houses
        w = int(r.integers(12, 20))
        hgt = int(r.integers(10, 16))
        base = hz + 14
        body = SLATE_0 if not night else BROWN_0
        cv.rect(x, base - hgt, x + w, y1, body)
        cv.poly([(x - 1, base - hgt), (x + w // 2, base - hgt - w // 2), (x + w + 1, base - hgt)], body)
        cv.line(x + w // 2, base - hgt - w // 2, x + w + 1, base - hgt, SLATE_1 if not night else BROWN_1)
        for wx in range(x + 3, x + w - 2, 5):
            lit_ = (wx // 5 + k) % 3 == 0 if not night else (wx // 5 + k) % 2 == 0
            cv.rect(wx, base - hgt + 4, wx + 1, base - hgt + 6, (GLOW if lit_ else INK))
        x += w + int(r.integers(1, 4))
        k += 1
    ty = hz + 20
    tx = x0 + MARG + int((x1 - x0 - 2 * MARG) * 0.16)
    cv.rect(x0, ty + 9, x1, y1, LEAF_0 if not night else INK)  # neutral ground
    cv.rect(tx, ty, tx + 34, ty + 9, CRT_0 if not night else TERRA_0)
    cv.rect(tx, ty, tx + 34, ty, TERRA_0)
    for wx in range(tx + 3, tx + 32, 5):
        cv.rect(wx, ty + 2, wx + 2, ty + 4, GLOW)
    cv.line(tx + 17, ty, tx + 22, ty - 6, INK)
    cv.line(x0, ty - 7, x1, ty - 7, INK)
    if night:  # streetcar headlight + streetlights
        cv.rect(tx + 35, ty + 4, tx + 36, ty + 5, SUN)
        for k2 in range(6):
            cv.line(tx + 37 + k2 * 2, ty + 4 + (k2 % 2), tx + 38 + k2 * 2, ty + 4 + (k2 % 2), CREAM if k2 < 3 else GLOW)
        for sx in (x0 + MARG + 12, x0 + MARG + 70, x1 - MARG - 18):
            cv.line(sx, ty - 18, sx, ty + 9, INK)
            cv.line(sx, ty - 18, sx + 4, ty - 18, INK)
            cv.rect(sx + 3, ty - 17, sx + 5, ty - 16, SUN)
            for dy in range(1, 9):
                if dy % 2:
                    cv.px(sx + 4 + (dy % 3) - 1, ty - 16 + dy * 3, GLOW)
    px_ = x0 + MARG + int((x1 - x0 - 2 * MARG) * 0.82)  # power pole + lines
    cv.line(px_, wy0 + 18, px_, y1, INK)
    cv.line(px_ - 6, wy0 + 22, px_ + 6, wy0 + 22, INK)
    for (a, b) in ((wy0 + 40, wy0 + 23), (wy0 + 46, wy0 + 29), (wy0 + 30, wy0 + 22)):
        for xx in range(x0, px_):
            t = (xx - x0) / max(1, px_ - x0)
            cv.px(xx, a + (b - a) * t + 5 * math.sin(math.pi * t), INK)
    r = rng(11)  # near oak top-right of the view
    for k in range(170):
        cx = x1 - MARG - int(abs(r.normal(0, 18)))
        cy = wy0 + int(abs(r.normal(0, 22)))
        cv.rect(cx, cy, cx + 2, cy + 1, (LEAF_0 if k % 3 else LEAF_1) if not night else (INK if k % 3 else LEAF_0))
    if not night:
        for k in range(30):
            cv.px(x1 - MARG - int(abs(r.normal(0, 16))), wy0 + int(abs(r.normal(0, 20))), GLOW)


def window_frame(cv, v):
    x0, y0, x1, y1 = WIN_RECT
    cv.rect(x0 - 6, y0 - 6, x1 + 6, y0 - 1, OAK_0)
    cv.rect(x0 - 6, y0, x0 - 1, y1, OAK_0)
    cv.rect(x1 + 1, y0, x1 + 6, y1, OAK_0)
    cv.line(x0 - 6, y0 - 6, x1 + 6, y0 - 6, OAK_1)
    cv.line(x0 - 2, y0, x0 - 2, y1, BROWN_0)
    cv.line(x1 + 1, y0, x1 + 1, y1, OAK_1)
    mx = (x0 + x1) // 2
    cv.rect(mx - 2, y0, mx + 1, y1, BROWN_0)
    cv.line(mx + 1, y0, mx + 1, y1, RIM if v == "base" else SLATE_1)
    ty = (y0 + y1) // 2 - 22
    cv.rect(x0, ty, x1, ty + 1, BROWN_0)
    cv.line(x0, ty + 2, x1, ty + 2, TERRA_1 if v == "base" else BROWN_1)
    # rolled blind (up) at the head
    cv.rect(x0 - 2, y0 - 1, x1 + 2, y0 + 4, CREAM if v == "base" else SLATE_2)
    cv.line(x0 - 2, y0 + 4, x1 + 2, y0 + 4, OAK_2 if v == "base" else SLATE_1)
    cv.line(x0 + 4, y0 + 5, x0 + 4, y0 + 12, INK)
    cv.px(x0 + 4, y0 + 13, GOLD)
    # sill
    cv.rect(x0 - 10, y1 + 1, x1 + 10, y1 + 4, OAK_1)
    cv.line(x0 - 10, y1 + 1, x1 + 10, y1 + 1, AMBER if v == "base" else SLATE_2)
    cv.rect(x0 - 8, y1 + 5, x1 + 8, y1 + 6, BROWN_0)


# ------------------------------------------------------------------ ceiling decor
def pendant_painter(X, Z, drop, cord_top=CEIL):
    def paint(cv, v):
        top = P(X, cord_top, Z)
        bot = P(X, CEIL - drop, Z)
        cv.line(*top, *bot, INK)
        x, y = bot
        lit = v == "night"
        if v == "t1":  # bare bulb
            cv.disc(x, y + 3, 2, GLOW if lit else AMBER)
            cv.px(x - 1, y + 2, CREAM)
            return
        shade = BROWN_1 if v in ("base", "night", "t3") else GOLD_DK
        rim = OAK_0 if shade == BROWN_1 else GOLD
        cv.poly([(x - 2, y), (x + 2, y), (x + 7, y + 7), (x - 7, y + 7)], shade)
        cv.line(x - 7, y + 7, x + 7, y + 7, rim)
        cv.line(x + 2, y + 1, x + 6, y + 6, rim)
        cv.rect(x - 2, y + 8, x + 2, y + 8, SUN if lit else GLOW)
        if lit:
            for k in range(1, 6):  # light falls under the shade
                cv.dither([(x - 6 - k, y + 8 + k * 4), (x + 6 + k, y + 8 + k * 4), (x + 7 + k, y + 12 + k * 4),
                           (x - 7 - k, y + 12 + k * 4)], GLOW if k < 3 else AMBER, 0.12 - k * 0.015)
    return paint


def skylight(cv, v):
    s = [P(-1.0, CEIL, 41.8), P(2.4, CEIL, 41.8), P(2.4, CEIL, 39.4), P(-1.0, CEIL, 39.4)]
    cv.poly(s, OAK_0)
    t = [P(-0.8, CEIL, 41.6), P(2.2, CEIL, 41.6), P(2.2, CEIL, 39.6), P(-0.8, CEIL, 39.6)]
    cv.poly(t, GLOW if v == "base" else SLATE_0)
    ys = [p[1] for p in t]
    cv.poly([t[0], t[1], ((t[1][0] + t[2][0]) / 2, (ys[1] + ys[2]) / 2), ((t[0][0] + t[3][0]) / 2, (ys[0] + ys[3]) / 2)],
            AMBER if v == "base" else INK)
    cv.line(*P(0.7, CEIL, 41.6), *P(0.7, CEIL, 39.6), OAK_0)
    if v == "night":
        cv.px(P(1.6, CEIL, 40.5)[0], P(1.6, CEIL, 40.5)[1], CREAM)


def pothos_painter(X, Z, length, seed):
    def paint(cv, v):
        x, y = P(X, CEIL - 0.75, Z)
        x, y = round(x), round(y) + 6
        cv.line(x - 6, y, x, y - 8, INK)
        cv.line(x + 6, y, x, y - 8, INK)
        pot(cv, x, y + 7, 6, 7, TERRA_1)
        r = rng(seed)
        for vv in range(5):
            vx = x - 6 + vv * 3
            yy = y + 7
            n = int(length * (0.45 + 0.55 * r.random()))
            for k in range(n):
                vx += int(r.integers(-1, 2)) if k % 3 == 0 else 0
                cv.px(vx, yy + k, LEAF_1)
                if k % 4 == 2:
                    cv.rect(vx - 2 + (k % 2) * 2, yy + k, vx + (k % 2) * 2, yy + k + 1, LEAF_2)
                    cv.px(vx - 1 + (k % 2) * 2, yy + k, LEAF_3)
        for k in range(9):
            cv.rect(x - 8 + k * 2 - 1, y - 1 + (k % 3), x - 8 + k * 2 + 1, y + 1 + (k % 3), LEAF_2)
    return paint


def string_lights(cv, v):
    if v == "t1":  # a coiled cable on a nail, not hung yet
        x, y = WP("L", 44.5, 9.6)
        cv.px(x, y - 3, OAK_2)
        cv.ell(x - 5, y - 2, x + 5, y + 6, INK, outline=True)
        cv.ell(x - 3, y, x + 3, y + 5, BROWN_1, outline=True)
        return
    lit = v == "night"
    many = v in ("t5", "night")
    for side in ("L",):
        z, k = ZB - 0.2, 0
        while z > 36.5:
            x, y = WP(side, z, 11.2 - 0.3 * abs(math.sin(k * 0.45)))
            cv.px(x, y, INK)
            if k % (3 if many else 5) == 0:
                cv.px(x, y + 1, (SUN if lit else GLOW) if k % 2 else (GLOW if lit else AMBER))
            z -= 0.14
            k += 1
    # and across the back wall top
    for xx in range(250, 452):
        t = (xx - 250) / 202
        y = P(0, 11.25, ZB)[1] + 4 * math.sin(math.pi * t * 3) ** 2
        cv.px(xx, y, INK)
        if xx % (9 if many else 15) == 0:
            cv.px(xx, y + 1, (SUN if lit else GLOW) if xx % 2 else (GLOW if lit else AMBER))


def ceiling_cables(cv, v):
    # cables drooping from the beam to the pendants and down the corner
    p0 = P(-4.0, CEIL - 0.78, 38.2)
    p1 = P(3.5, CEIL - 0.78, 42.4)
    pts = [(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t + 9 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 40)]
    cv.lines(pts, INK)
    x, y = P(HALF, 11.9, ZB)
    cv.lines([(x - 4, y), (x - 6, y + 40), (x - 5, y + 80)], VOID)


# ------------------------------------------------------------------ rug (window zone, tiers)
def rug(cv, v):
    if v in ("t1", "base"):  # small worn mat
        pts = fquad(cv, -3.7, -1.8, 41.0, 44.6, BROWN_2)
        fquad(cv, -3.55, -1.95, 41.3, 44.3, TERRA_0)
        for z in np.arange(41.6, 44.2, 0.7):
            cv.line(*P(-3.4, 0, z), *P(-2.1, 0, z), BROWN_1)
        return
    gild = v == "t5"
    X0, X1 = -4.8, -0.8
    pts = fquad(cv, X0, X1, 27.0, 45.2, TERRA_0)
    fquad(cv, X0 + 0.25, X1 - 0.25, 27.5, 44.9, GOLD_DK if gild else TERRA_1)
    fquad(cv, X0 + 0.4, X1 - 0.4, 27.9, 44.6, TERRA_1 if gild else TERRA_1)
    fquad(cv, X0 + 0.55, X1 - 0.55, 28.3, 44.3, TERRA_0 if gild else TERRA_1)
    for t in (0.33, 0.66):
        X = X0 + 0.55 + t * (X1 - X0 - 1.1)
        cv.line(*P(X, 0, 44.3), *P(X, 0, 28.3), BROWN_2 if not gild else GOLD_DK)
    for z in np.arange(29.0, 44.0, 1.7):
        a, b = P(X0 + 0.55, 0, z), P(X1 - 0.55, 0, z)
        cv.line(*a, *b, PLUM_1)
        cv.px((a[0] + b[0]) / 2, a[1], GOLD if gild else GLOW)
        if gild:
            cv.px((a[0] + b[0]) / 2 - 6, a[1], GOLD_DK)
            cv.px((a[0] + b[0]) / 2 + 6, a[1], GOLD_DK)
    fl = P(X0, 0, 27.0), P(X1, 0, 27.0)
    for k in range(0, 60, 3):  # fringe
        x = fl[0][0] + k * (fl[1][0] - fl[0][0]) / 60
        cv.line(x, fl[0][1], x, fl[0][1] + 2, CREAM)


# ------------------------------------------------------------------ L6 frame crops
def crop_speaker(cv, v):
    cv.rect(-120, 448, 6, 630, INK)
    cv.rect(-120, 448, 6, 451, BROWN_1)
    cv.rect(4, 448, 6, 630, BROWN_1)
    cv.disc(-50, 520, 34, VOID)
    cv.disc(-50, 520, 30, BROWN_1)
    cv.disc(-50, 520, 12, INK)
    cv.disc(-52, 518, 4, BROWN_2)
    cv.disc(-50, 470, 9, VOID)
    cv.disc(-50, 470, 5, BROWN_1)
    cv.px(-6, 600, CRT_1)


def crop_plant(cv, v):
    r = rng(31)
    for k in range(10):
        x0, y0 = -120 + k * 8, -90
        ex, ey = x0 + r.uniform(4, 34), y0 + r.uniform(50, 130)
        cv.line(x0, y0, ex, ey, LEAF_0)
        cv.poly([(ex - 10, ey - 4), (ex + 10, ey - 8), (ex + 6, ey + 6), (ex - 6, ey + 8)], INK if k % 2 else LEAF_0)
        cv.line(ex - 8, ey, ex + 8, ey - 3, INK)
    cv.rect(-120, -90, 8, -84, INK)


def crop_boxes(cv, v):
    cv.rect(952, 500, 1080, 630, OAK_0)
    cv.rect(952, 500, 1080, 504, OAK_1)
    cv.rect(990, 500, 997, 630, AMBER)
    cv.rect(1010, 530, 1030, 541, CREAM)
    cv.line(1012, 533, 1028, 533, BROWN_1)
    cv.line(1012, 536, 1022, 536, BROWN_1)
    cv.rect(970, 440, 1080, 500, OAK_DK)
    cv.rect(970, 440, 1080, 443, OAK_0)
    cv.line(1004, 444, 1004, 500, OAK_0)


def crop_cables(cv, v):
    for k, (sx, sy, ex, ey) in enumerate(((1080, -90, 950, 40), (1060, -90, 966, 70))):
        pts = [(sx + (ex - sx) * t + 10 * math.sin(t * 5 + k), sy + (ey - sy) * t) for t in np.linspace(0, 1, 40)]
        cv.lines(pts, VOID, 2)
    cv.rect(948, 36, 958, 46, INK)


def floor_cables(cv, v):
    for k, (sx, sy, ex, ey) in enumerate(((150, 630, 430, 400), (820, 630, 610, 372))):
        pts = [(sx + (ex - sx) * t + 16 * math.sin(t * 7 + k), sy + (ey - sy) * t + 5 * math.sin(t * 11 + k)) for t in np.linspace(0, 1, 70)]
        cv.lines(pts, VOID, 2)


def main():
    emit_bands()
    emit("shell.sky", zone="shell", kind="shell", layer=0, paint=sky, variants=("base", "night"), light=False, rim=False,
         note="golden-hour sky, sun, clouds, far live oaks (night: slate sky, moon, stars)")
    emit("shell.outside", zone="shell", kind="shell", layer=1, paint=outside, variants=("base", "night"), light=False, rim=False,
         note="shotgun houses, neutral ground, streetcar, power lines, near oak (night: lit windows, streetlights, headlight)")
    emit("shell.window", zone="window", kind="shell", layer=2, paint=window_frame, variants=("base", "night"), rim=False,
         note="window casing, mullion, rolled blind, sill")
    emit("window.skylight", zone="window", kind="decor", layer=3, paint=skylight, variants=("base", "night"), rim=False, light=False,
         note="small skylight between the beams")
    for zone, X, Z, drop, ly in (("kitchen", -16.0, 36.6, 3.2, 4), ("library", -6.0, 31.4, 3.6, 5), ("study", 9.6, 41.0, 3.0, 3)):
        emit(f"{zone}.pendant", zone=zone, kind="decor", layer=ly, paint=pendant_painter(X, Z, drop),
             variants=("base", "night", "t1", "t3", "t5"), note=f"{zone} pendant lamp (t1 bare bulb, t5 brass)")
    emit("bed.stringlights", zone="bed", kind="decor", layer=2, paint=string_lights, variants=("t1", "t2", "t5", "night"),
         note="string lights along the left wall and back wall top (tier II)")
    for zone, X, Z, ln, seed in (("library", -9.6, 42.4, 64, 3), ("study", 9.2, 42.4, 74, 8), ("kitchen", -14.6, 38.2, 54, 12)):
        emit(f"{zone}.pothos", zone=zone, kind="decor", layer=layer_for_z(Z), paint=pothos_painter(X, Z, ln, seed),
             note="trailing pothos hanging from a beam")
    emit("window.cables-ceiling", zone="window", kind="decor", layer=3, paint=ceiling_cables, light=False, rim=False,
         note="cable droop along the beams")
    emit("window.rug", zone="window", kind="decor", layer=5, paint=rug, variants=("base", "t1", "t3", "t5"), rim=False, contact="top",
         note="rug from the statue toward the viewer (t1 worn mat, t3 big rug, t5 gilded border)")
    emit("window.cables-floor", zone="window", kind="decor", layer=5, paint=floor_cables, rim=False, contact="top",
         note="cables snaking across the floor to the CRTs")
    emit("shell.crop.speaker", zone="shell", kind="decor", layer=6, paint=crop_speaker, rim=False, note="frame crop: speaker bottom-left")
    emit("shell.crop.plant", zone="shell", kind="decor", layer=6, paint=crop_plant, rim=False, light=False, note="frame crop: hanging leaves top-left")
    emit("shell.crop.boxes", zone="shell", kind="decor", layer=6, paint=crop_boxes, rim=False, note="frame crop: moving boxes bottom-right")
    emit("shell.crop.cables", zone="shell", kind="decor", layer=6, paint=crop_cables, rim=False, note="frame crop: cables top-right")
    finish("shell")


if __name__ == "__main__":
    main()
