"""Room v3 right wall: computer (zone 6) and gym (zone 7), on the raked right flat that grows toward the viewer.
Run: python3 art/room-v3/right/build.py
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

R = "R"
CD = (41.8, 46.2, 2.4, 2.7)  # computer desk z0, z1, depth, height
BIKE = (34.6, 38.3, 0.6)
RACK = (7.6, 9.8, 23.0, 24.2)


# ------------------------------------------------------------------ computer (zone 6)
def cdesk(cv, v):
    z0, z1, d, H = CD
    wshadow(cv, R, z0, z1, d + 0.3, 0.5)
    top, face = {"t1": (SLATE_1, SLATE_0), "t5": (OAK_2, OAK_0)}.get(v, (OAK_1, OAK_0))
    wbox(cv, R, z0, z1, d, H - 0.2, H, top, face, face)
    for t in (z0 + 0.1, z1 - 0.2):
        a, b = WP(R, t, H - 0.2, d - 0.1), WP(R, t, 0, d - 0.1)
        cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], OAK_DK if v != "t1" else INK)
    if v == "t5":
        cv.line(*WP(R, z0, H - 0.22, d), *WP(R, z1, H - 0.22, d), GLOW)
    else:
        cv.line(*WP(R, z0, H, d), *WP(R, z1, H, d), up(top))


def computer(cv, v):
    st = int(v[1])
    z0, z1, d, H = CD
    wbox(cv, R, z0 + 0.3, z0 + 1.3, 1.9, 0, 1.9, BROWN_1, INK, BROWN_1, o0=0.3)  # tower under the desk
    p = WP(R, z0 + 0.8, 1.6, 1.9)
    for k in range(3):
        cv.px(p[0] - 1 + k, p[1] + 1, [CRT_1, GLOW, SLATE_2][k] if st else BROWN_2)
    if st == 2:
        cv.line(*WP(R, z0 + 0.35, 0.3, 1.9), *WP(R, z0 + 1.25, 0.3, 1.9), PLUM_2)
    mons = [(42.6, 44.1), (44.3, 45.8)] + ([(41.95, 42.45)] if st == 2 else [])
    for k, (m0, m1) in enumerate(mons):
        top = 4.7 if k < 2 else 5.3
        wbox(cv, R, m0, m1, 1.25, 3.05, top, INK, INK, INK, o0=1.05)
        q = [WP(R, m0 + 0.08, top - 0.1, 1.27), WP(R, m1 - 0.08, top - 0.1, 1.27), WP(R, m1 - 0.08, 3.15, 1.27),
             WP(R, m0 + 0.08, 3.15, 1.27)]
        on = st >= 1 or k == 0
        cv.poly(q, SLATE_0 if on else VOID)
        if on:
            for j in range(6 if st else 3):
                hh = top - 0.3 - j * 0.22
                a = WP(R, m0 + 0.2 + (j % 3) * 0.1, hh, 1.28)
                b = WP(R, m0 + 0.35 + 0.25 * (1 + (j * 3) % 4), hh, 1.28)
                cv.line(*a, *b, [SLATE_2, LEAF_3, SLATE_1, GLOW, SLATE_2, PLUM_3][j] if st else SLATE_1)
        s0_, s1_ = WP(R, (m0 + m1) / 2, 3.05, 1.15), WP(R, (m0 + m1) / 2, H, 1.15)
        cv.line(*s0_, *s1_, INK)
    kb = [WP(R, 42.8, H + 0.02, 1.6), WP(R, 44.8, H + 0.02, 1.6), WP(R, 44.8, H + 0.02, 2.2), WP(R, 42.8, H + 0.02, 2.2)]
    cv.poly(kb, BROWN_1)
    cv.line(*kb[0], *kb[1], PLUM_2 if st else BROWN_2)
    m = WP(R, 45.2, H + 0.02, 1.9)
    cv.rect(m[0] - 2, m[1] - 1, m[0] + 1, m[1], INK)


def whiteboard(cv, v):
    st = int(v[1])
    q = wquad(cv, R, 42.4, 46.0, 5.4, 8.4, SLATE_2)
    wquad(cv, R, 42.48, 45.92, 5.48, 8.32, CREAM)
    cv.line(*WP(R, 42.4, 5.4, 0.1), *WP(R, 46.0, 5.4, 0.1), SLATE_1)  # marker tray
    if st == 0:
        cv.line(*WP(R, 42.8, 7.6), *WP(R, 43.6, 7.6), SLATE_1)
        wquad(cv, R, 44.2, 44.7, 6.6, 7.1, GLOW)
        return
    for k, z in enumerate((42.7, 43.6, 44.5)):
        wquad(cv, R, z, z + 0.55, 6.6, 7.2, [SLATE_1, LEAF_2, GLOW][k])
        if k < 2:
            cv.line(*WP(R, z + 0.6, 6.9), *WP(R, z + 0.85, 6.9), INK)
    for z in (42.8, 43.9):
        cv.line(*WP(R, z, 6.0), *WP(R, z + 0.8, 6.0), BROWN_1)
    pts = [(42.8, 7.6), (43.4, 7.75), (44.0, 7.5), (44.9, 7.9)] if st == 1 else [(42.8, 7.5), (43.5, 7.7), (44.2, 7.85), (44.9, 8.15), (45.6, 8.2)]
    for (z, h), (z2, h2) in zip(pts, pts[1:]):
        cv.line(*WP(R, z, h), *WP(R, z2, h2), SLATE_0)
    for z, h in pts:
        p = WP(R, z, h)
        cv.rect(p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1, CRT_0 if st == 1 else LEAF_2)
    if st == 2:  # second lane + check marks
        wquad(cv, R, 45.3, 45.8, 6.6, 7.2, PLUM_2)
        for z in (42.75, 43.65):
            a = WP(R, z + 0.1, 6.45)
            cv.line(a[0], a[1], a[0] + 2, a[1] + 2, LEAF_2)
            cv.line(a[0] + 2, a[1] + 2, a[0] + 5, a[1] - 2, LEAF_2)


def sticky(cv, v):
    wquad(cv, R, 42.55, 42.95, 4.82, 5.3, GLOW)
    cv.line(*WP(R, 42.62, 5.18), *WP(R, 42.9, 5.18), BROWN_2)
    cv.line(*WP(R, 42.62, 5.04), *WP(R, 42.82, 5.04), BROWN_2)
    cv.line(*WP(R, 42.55, 5.3), *WP(R, 42.95, 5.3), SUN)


def money_tree(cv, v):
    g = int(v[1]) if v.startswith("g") else 2
    x, y = WP(R, 42.15, CD[3], 1.7)
    cv.rect(x - 5, y - 7, x + 5, y, CREAM)
    cv.line(x - 5, y - 7, x + 5, y - 7, SLATE_2)
    ht = [6, 10, 14, 17][g]
    for k in range(ht):
        cv.px(x - 1 + (1 if (k // 2) % 2 else -1), y - 8 - k, OAK_1)
        cv.px(x + 1 + (-1 if (k // 2) % 2 else 1), y - 8 - k, OAK_0)
    leaves = [(-4, -14), (3, -15), (0, -12)] + ([(-7, -20), (5, -21), (-1, -24)] if g >= 1 else []) + \
             ([(-9, -26), (8, -26), (0, -29), (-4, -30)] if g >= 2 else []) + ([(-11, -32), (10, -31), (3, -34), (-5, -36)] if g >= 3 else [])
    for (dx, dy) in leaves:
        dy = max(dy, -8 - ht - 6)
        cv.ell(x + dx - 4, y + dy - 2, x + dx + 4, y + dy + 2, LEAF_2)
        cv.px(x + dx - 1, y + dy - 1, LEAF_3)
    if g == 3:
        cv.px(x + 6, y - 28, GOLD)
        cv.px(x - 6, y - 22, GOLD)


def cchair(cv, v):
    z0, z1 = 42.4, 43.6
    o0, o1 = 2.7, 3.9
    wshadow_pts = [WP(R, z0, 0, o0), WP(R, z1, 0, o0), WP(R, z1, 0, o1), WP(R, z0, 0, o1)]
    cv.dither(wshadow_pts, OAK_DK, 0.5)
    if v == "t1":
        wbox(cv, R, z0 + 0.2, z1 - 0.2, o1 - 0.2, 1.6, 1.8, BROWN_2, BROWN_1, BROWN_0, o0=o0 + 0.2)
        a, b = WP(R, (z0 + z1) / 2, 1.6, (o0 + o1) / 2), WP(R, (z0 + z1) / 2, 0, (o0 + o1) / 2)
        cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], BROWN_1)
        return
    seat = TERRA_0 if v == "t5" else SLATE_0
    wbox(cv, R, z0, z1, o1, 1.5, 1.8, up(seat), seat, seat, o0=o0)
    wbox(cv, R, z0, z1, o1, 1.8, 4.2, up(seat), seat, dn(seat), o0=o1 - 0.25)  # back faces the desk
    if v != "t5":
        cv.line(*WP(R, z0 + 0.15, 4.0, o1 - 0.1), *WP(R, z0 + 0.15, 2.0, o1 - 0.1), CRT_0)  # racing stripe
    a, b = WP(R, (z0 + z1) / 2, 1.5, (o0 + o1) / 2), WP(R, (z0 + z1) / 2, 0.3, (o0 + o1) / 2)
    cv.rect(a[0] - 1, a[1], a[0] + 1, b[1], INK)
    for o in (o0, o1):
        p = WP(R, (z0 + z1) / 2, 0.05, o)
        cv.line(b[0], b[1], p[0], p[1], INK)


def speakers(cv, v):
    for z in (45.75, 41.95):
        wbox(cv, R, z, z + 0.4, 0.9, CD[3], CD[3] + 1.0, BROWN_1, INK, BROWN_1, o0=0.4)
        c = WP(R, z, CD[3] + 0.45, 0.65)
        cv.disc(c[0], c[1], 2, BROWN_1)
        cv.px(c[0], c[1], SLATE_1)


def router(cv, v):
    wbox(cv, R, 45.0, 45.6, 0.7, CD[3], CD[3] + 0.25, INK, BROWN_1, INK, o0=0.2)
    for k, t in enumerate((45.1, 45.25, 45.4)):
        p = WP(R, t, CD[3] + 0.12, 0.7)
        cv.px(p[0], p[1], [LEAF_3, LEAF_3, GLOW][k])
    for t in (45.1, 45.5):
        cv.line(*WP(R, t, CD[3] + 0.25, 0.3), *WP(R, t, CD[3] + 0.9, 0.3), INK)


def ccables(cv, v):
    if v == "t1":
        for k in range(4):
            pts = [WP(R, 42.4 + k * 0.6, CD[3] - 0.2, 0.3 + (k % 2) * 0.4)]
            pts += [WP(R, 42.6 + k * 0.5, 1.2 - (k % 2) * 0.4, 0.8 + k * 0.2), WP(R, 42.8 + k * 0.4, 0.05, 1.2 + k * 0.3)]
            cv.lines(pts, VOID)
        p = WP(R, 43.4, 0.05, 1.6)
        cv.ell(p[0] - 8, p[1] - 3, p[0] + 8, p[1] + 2, VOID, outline=True)
        return
    wquad(cv, R, 42.2, 46.0, 2.35, 2.45, INK, 0.05)  # cable tray under the desk
    cv.line(*WP(R, 44.0, 2.35, 0.05), *WP(R, 44.0, 0.05, 0.05), INK)


def boxes(cv, v):
    X0, X1, Z0, Z1 = 7.9, 9.1, 36.0, 37.0
    shadow(cv, X0, X1 + 0.2, Z0 - 0.2, Z1, 0.5)
    box(cv, X0, X1, 0, 1.0, Z0, Z1, OAK_1, OAK_0, OAK_DK)
    box(cv, X0 + 0.15, X1 - 0.25, 1.0, 1.7, Z0 + 0.2, Z1 - 0.1, OAK_2, OAK_1, OAK_0)
    a, b = P(X0, 1.0, Z0), P(X1, 0, Z0)
    cv.line((a[0] + b[0]) / 2, a[1], (a[0] + b[0]) / 2, b[1], AMBER)
    c = P(X0 + 0.3, 0.6, Z0)
    cv.rect(c[0], c[1], c[0] + 7, c[1] + 4, CREAM)
    cv.line(c[0] + 1, c[1] + 2, c[0] + 5, c[1] + 2, BROWN_1)


def ledstrip(cv, v):
    for t in np.arange(41.9, 46.2, 0.06):
        p = WP(R, t, 4.95)
        cv.px(p[0], p[1], PLUM_2 if int(t * 10) % 3 else PLUM_3)


def headset(cv, v):
    a = WP(R, 46.05, 4.4)
    cv.px(a[0], a[1] - 9, GOLD_DK)
    cv.ell(a[0] - 5, a[1] - 8, a[0] + 5, a[1] + 3, INK, outline=True)
    cv.rect(a[0] - 6, a[1], a[0] - 3, a[1] + 5, BROWN_1)
    cv.rect(a[0] + 3, a[1], a[0] + 6, a[1] + 5, BROWN_1)
    cv.px(a[0] + 4, a[1] + 1, PLUM_2)


def fig_shelf(cv, v):
    wbox(cv, R, 43.0, 45.4, 0.5, 8.75, 8.9, OAK_1, OAK_0, OAK_0)
    for k, (t, c) in enumerate(((43.3, CRT_0), (43.8, SLATE_1), (44.3, GOLD), (44.9, LEAF_2))):
        p = WP(R, t, 8.9, 0.25)
        cv.rect(p[0] - 1, p[1] - 6, p[0] + 1, p[1], c)
        cv.px(p[0], p[1] - 7, up(c))


def can(cv, v):
    p = WP(R, 45.6, CD[3], 2.0)
    cv.rect(p[0] - 2, p[1] - 6, p[0] + 2, p[1], LEAF_3)
    cv.line(p[0] - 2, p[1] - 6, p[0] + 2, p[1] - 6, SLATE_2)
    cv.px(p[0], p[1] - 3, INK)


def computer_on(cv, v):
    for (m0, m1) in ((42.6, 44.1), (44.3, 45.8)):
        q = [WP(R, m0 + 0.08, 4.6, 1.27), WP(R, m1 - 0.08, 4.6, 1.27), WP(R, m1 - 0.08, 3.15, 1.27), WP(R, m0 + 0.08, 3.15, 1.27)]
        cv.dither(q, SLATE_1, 0.35)
        cv.dither([WP(R, m0 - 0.4, 2.72, 1.3), WP(R, m1 + 0.4, 2.72, 1.3), WP(R, m1 + 0.6, 2.72, 2.6), WP(R, m0 - 0.6, 2.72, 2.6)],
                  SLATE_2, 0.12)
    for k in range(1, 5):
        cv.dither([WP(R, 42.4, 3.0 - k * 0.6, 1.4 + k * 0.3), WP(R, 46.0, 3.0 - k * 0.6, 1.4 + k * 0.3),
                   WP(R, 46.0, 2.6 - k * 0.6, 1.6 + k * 0.3), WP(R, 42.4, 2.6 - k * 0.6, 1.6 + k * 0.3)], SLATE_1, 0.08)


# ------------------------------------------------------------------ gym (zone 7)
def bike(cv, v):
    st = int(v[1]) if v[0] == "s" else 1
    awake = v == "awake"
    bz0, bz1, off = BIKE

    def B(z, h):
        return WP(R, z, h, off)

    r1 = 1.1
    for zc in (bz0 + 1.15, bz1 - 1.15):
        pts = [B(zc + r1 * math.cos(t), 4.9 + r1 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 48)]
        cv.lines(pts, INK, 3)
        cv.lines(pts, SLATE_0 if not awake else SLATE_1, 1)
        c = B(zc, 4.9)
        for t in np.linspace(0, math.pi, 7):
            e = B(zc + r1 * math.cos(t), 4.9 + r1 * math.sin(t))
            e2 = B(zc - r1 * math.cos(t), 4.9 - r1 * math.sin(t))
            cv.line(*e, *e2, BROWN_1)
        cv.disc(c[0], c[1], 2, SLATE_1)
    rz, fz = bz0 + 1.15, bz1 - 1.15  # rear wheel toward the viewer, front toward the back
    bb = B(rz + 1.45, 4.9)
    seat = B(rz + 0.75, 6.7)
    head = B(fz - 0.55, 6.6)
    for a_, b_ in ((B(rz, 4.9), bb), (bb, seat), (seat, B(rz, 4.9)), (seat, head), (bb, head), (head, B(fz, 4.9))):
        cv.line(*a_, *b_, CRT_0, 2)
    sd = B(rz + 0.8, 7.05)
    cv.line(sd[0] - 6, sd[1], sd[0] + 6, sd[1], INK, 2)
    hb = B(fz - 0.4, 6.95)
    cv.line(*head, *hb, INK)
    cv.lines([hb, (hb[0] - 4, hb[1] + 2), (hb[0] - 5, hb[1] + 6)], INK)
    cv.disc(bb[0], bb[1], 3, SLATE_1)
    for z in (bz0 + 1.5, bz1 - 1.5):  # hooks
        cv.line(*WP(R, z, 6.9), *B(z, 6.4), BROWN_1)
    if not awake:  # tarp over the front half (wheels showing below)
        tp = [B(rz - 0.2, 6.3), B(rz + 0.2, 7.35), B(rz + 1.2, 7.5), B(rz + 1.9, 7.0), B(rz + 2.0, 5.9),
              B(rz + 1.6, 5.3), B(rz + 1.1, 5.7), B(rz + 0.6, 5.2), B(rz + 0.1, 5.6)]
        cv.poly(tp, SLATE_0)
        for k in range(4):
            z = rz + 0.3 + k * 0.45
            cv.line(*B(z, 7.3), *B(z + 0.1 - (k % 2) * 0.2, 5.5), SLATE_1 if k % 2 else INK)
        cv.line(*B(rz + 0.2, 7.35), *B(rz + 1.2, 7.5), SLATE_2)
        cv.line(*B(rz + 1.0, 7.5), *B(rz + 1.9, 7.0), SLATE_1)
    # original swim / bike / run emblem below: three linked tiles
    wquad(cv, R, 35.3, 37.7, 2.0, 2.9, INK)
    lit = 3 if awake else st + 1
    for k, (col, z) in enumerate(((SLATE_1, 35.45), (CRT_0, 36.25), (GLOW, 37.05))):
        wquad(cv, R, z, z + 0.55, 2.1, 2.8, col if k < lit else BROWN_1)
        cx, cy = WP(R, z + 0.27, 2.45)
        c = INK if k < lit else BROWN_0
        if k == 0:
            cv.line(cx - 2, cy + 1, cx + 2, cy + 1, c); cv.line(cx - 1, cy - 1, cx + 1, cy - 1, c)
        elif k == 1:
            cv.px(cx - 2, cy + 1, c); cv.px(cx + 2, cy + 1, c); cv.line(cx - 2, cy + 1, cx + 2, cy - 1, c)
        else:
            cv.line(cx, cy - 2, cx - 1, cy + 2, c); cv.line(cx, cy, cx + 2, cy + 2, c)


def running(cv, v):
    st = int(v[1])
    q = wquad(cv, R, 38.7, 40.7, 3.9, 6.0, CREAM)  # mileage poster: bars, no words
    n = {0: 3, 1: 5, 2: 7}[st]
    for k in range(7):
        z = 38.85 + k * 0.25
        hh = 4.2 + 0.2 * k + 0.2 * ((k * 5) % 3)
        c = (CRT_0 if k == n - 1 else TERRA_2) if k < n else BROWN_2
        cv.poly([WP(R, z, 4.1), WP(R, z + 0.15, 4.1), WP(R, z + 0.15, hh if k < n else 4.25), WP(R, z, hh if k < n else 4.25)], c)
    cv.line(*WP(R, 38.8, 4.1), *WP(R, 40.6, 4.1), INK)
    cv.line(*WP(R, 38.7, 6.0), *WP(R, 40.7, 6.0), SLATE_2)
    for k, z0 in enumerate((38.75,) + ((39.55,) if st == 2 else ())):  # race bibs
        wquad(cv, R, z0, z0 + 0.65, 2.95, 3.6, CREAM)
        wquad(cv, R, z0, z0 + 0.65, 3.48, 3.6, CRT_0 if k == 0 else SLATE_1)
        for z in (z0 + 0.15, z0 + 0.3, z0 + 0.45):
            cv.line(*WP(R, z, 3.35), *WP(R, z, 3.1), INK)
        cv.line(*WP(R, z0 + 0.05, 3.6), *WP(R, z0 + 0.32, 3.85), INK)
        cv.line(*WP(R, z0 + 0.6, 3.6), *WP(R, z0 + 0.32, 3.85), INK)
    # running shoes hanging by the laces
    hk = WP(R, 40.35, 3.6)
    cv.px(hk[0], hk[1], GOLD_DK)
    for k, (dz, dh) in enumerate(((-0.2, 0.0), (0.15, -0.25))):
        p = WP(R, 40.35 + dz, 2.6 + dh, 0.2)
        cv.line(hk[0], hk[1], p[0], p[1] - 5, GOLD if st == 2 else CREAM)
        cv.poly([(p[0] - 6, p[1]), (p[0] + 6, p[1] - 1), (p[0] + 5, p[1] - 5), (p[0] - 1, p[1] - 7), (p[0] - 5, p[1] - 4)], CRT_0)
        cv.line(p[0] - 6, p[1], p[0] + 6, p[1] - 1, CREAM)
        cv.px(p[0] + 3, p[1] - 3, SLATE_2)


def medal_wall(cv, v):
    g = int(v[1]) if v.startswith("g") else 2
    wquad(cv, R, 38.7, 40.7, 6.5, 8.0, BROWN_0)
    wquad(cv, R, 38.7, 40.7, 7.85, 8.0, OAK_0)
    n = [1, 3, 5, 7][g]
    for k in range(n):
        z = 38.9 + k * 0.26
        a = WP(R, z, 7.85)
        b = WP(R, z, 7.1 - (k % 2) * 0.3)
        cv.line(*a, *b, [CRT_0, SLATE_1, LEAF_2, PLUM_2, GLOW, SLATE_2, CRT_1][k])
        cv.disc(b[0], b[1] + 3, 3, GOLD if k % 3 else SLATE_2)
        cv.px(b[0] - 1, b[1] + 2, SUN if k % 3 else CREAM)


def rack(cv, v):
    st = int(v[1])
    X0, X1, Z0, Z1 = RACK
    shadow(cv, X0 - 0.3, X1 + 0.3, Z0 - 0.3, Z1 + 0.2, 0.55)
    for X in (X0, X1 - 0.15):  # A-frame plate tree uprights
        a, b = P(X + 0.05, 2.6, (Z0 + Z1) / 2), P(X + 0.05, 0, Z0)
        cv.line(*a, *b, INK, 3)
        cv.line(*a, *P(X + 0.05, 0, Z1), BROWN_1, 2)
    box(cv, X0, X1, 0, 0.25, Z0, Z1, BROWN_1, INK, INK)
    bar = [P(X0 - 0.4, 2.45, (Z0 + Z1) / 2), P(X1 + 0.4, 2.45, (Z0 + Z1) / 2)]
    cv.line(*bar[0], *bar[1], SLATE_1, 2)
    cv.line(bar[0][0], bar[0][1] - 1, bar[1][0], bar[1][1] - 1, SLATE_2)
    plates = {0: [(0.9, 1)], 1: [(0.9, 2), (1.6, 1)], 2: [(0.9, 3), (1.6, 2), (0.4, 2)]}[st]
    for (hh, n) in plates:
        for side, X in ((-1, X0 + 0.25), (1, X1 - 0.3)):
            for j in range(n):
                c = P(X - side * 0.05 * j, hh, Z0 - 0.05 - j * 0.12)
                r = 13 - j * 2 if hh > 0.5 else 8
                cv.disc(c[0], c[1], r, INK)
                cv.disc(c[0], c[1], r - 2, BROWN_1 if j % 2 else SLATE_0)
                cv.disc(c[0], c[1], 2, VOID)
                cv.px(c[0] - r // 2, c[1] - r + 2, SLATE_1)
    for side in (0, 1):  # collars on the bar
        e = bar[side]
        cv.rect(e[0] - 2, e[1] - 4, e[0] + 2, e[1] + 4, INK if st < 2 else GOLD_DK)
    if st == 2:  # chalk bucket
        c = P(X1 + 0.6, 0, Z0 + 0.2)
        cv.rect(c[0] - 6, c[1] - 10, c[0] + 6, c[1], CREAM)
        cv.line(c[0] - 6, c[1] - 10, c[0] + 6, c[1] - 10, SLATE_2)
        cv.px(c[0] - 2, c[1] - 11, CREAM)


def tiles(cv, v):
    if v == "t1":  # just a towel on the floor
        fquad(cv, 8.2, 9.6, 25.0, 26.4, SLATE_1)
        fquad(cv, 8.2, 9.6, 25.0, 25.3, CREAM)
        return
    X0, X1, Z0, Z1 = 6.8, 11.8, 21.5, 26.5
    fquad(cv, X0, X1, Z0, Z1, INK)
    n = 5
    for i in range(n):
        for j in range(n):
            a = X0 + i * (X1 - X0) / n
            z = Z0 + j * (Z1 - Z0) / n
            fquad(cv, a + 0.04, a + (X1 - X0) / n - 0.04, z + 0.04, z + (Z1 - Z0) / n - 0.04,
                  (BROWN_1 if (i + j) % 2 else INK) if v != "t5" else (TERRA_0 if (i + j) % 2 else BROWN_1))
    if v == "t5":
        cv.line(*P(X0, 0, Z0), *P(X1, 0, Z0), GOLD_DK)


def kettlebell(cv, v):
    c = P(13.4, 0, 30.0)
    shadow(cv, 13.0, 13.9, 29.7, 30.3, 0.5)
    cv.ell(c[0] - 9, c[1] - 14, c[0] + 9, c[1], INK)
    cv.ell(c[0] - 7, c[1] - 12, c[0] + 6, c[1] - 2, BROWN_1)
    cv.ell(c[0] - 6, c[1] - 22, c[0] + 6, c[1] - 11, INK, outline=True)
    cv.px(c[0] - 4, c[1] - 10, SLATE_1)


def gym_bag(cv, v):
    c = P(13.2, 0, 27.6)
    shadow(cv, 12.4, 14.0, 27.2, 28.0, 0.5)
    cv.ell(c[0] - 24, c[1] - 18, c[0] + 22, c[1], SLATE_0)
    cv.line(c[0] - 20, c[1] - 12, c[0] + 18, c[1] - 12, SLATE_1)
    cv.lines([(c[0] - 14, c[1] - 17), (c[0] - 4, c[1] - 28), (c[0] + 8, c[1] - 17)], INK, 2)
    cv.px(c[0] + 10, c[1] - 8, CRT_1)


def foam_roller(cv, v):
    a, b = P(10.6, 0.3, 31.5), P(12.4, 0.3, 31.2)
    cv.line(*a, *b, PLUM_1, 7)
    cv.line(a[0], a[1] - 3, b[0], b[1] - 3, PLUM_2)
    cv.ell(b[0] - 3, b[1] - 4, b[0] + 3, b[1] + 4, PLUM_2)


def water_bottle(cv, v):
    c = P(10.4, 0, 25.4)
    cv.rect(c[0] - 4, c[1] - 18, c[0] + 4, c[1], SLATE_1)
    cv.rect(c[0] - 2, c[1] - 22, c[0] + 2, c[1] - 18, INK)
    cv.line(c[0] - 2, c[1] - 15, c[0] - 2, c[1] - 3, SLATE_2)


def jump_rope(cv, v):
    a = WP(R, 34.9, 6.6)
    cv.px(a[0], a[1], GOLD_DK)
    pts = [(a[0] + 9 * math.sin(t) * (1 - t / 6), a[1] + t * 9) for t in np.linspace(0, 6, 30)]
    cv.lines(pts, CRT_0)
    cv.rect(pts[-1][0] - 1, pts[-1][1], pts[-1][0] + 1, pts[-1][1] + 6, INK)


def timer(cv, v):
    q = wquad(cv, R, 35.4, 37.0, 8.6, 9.2, INK)
    for k, t in enumerate(np.arange(35.6, 36.9, 0.3)):
        a = WP(R, t, 8.75)
        b = WP(R, t + 0.18, 9.05)
        cv.rect(a[0], b[1], b[0], a[1], CRT_1 if k != 2 else INK)
    p = WP(R, 36.2, 8.9)
    cv.px(p[0], p[1], CRT_0)


def trophies(cv, v):
    wbox(cv, R, 38.7, 40.8, 0.6, 8.6, 8.75, OAK_1, OAK_0, OAK_0)
    n = {"t1": 1, "t3": 3, "t5": 5}.get(v, 3)
    for k in range(n):
        p = WP(R, 38.9 + k * 0.42, 8.75, 0.3)
        g = GOLD if (k % 2 == 0 or v == "t5") else SLATE_2
        cv.rect(p[0] - 3, p[1] - 9, p[0] + 3, p[1] - 6, g)
        cv.rect(p[0] - 1, p[1] - 5, p[0] + 1, p[1] - 2, dn(g))
        cv.rect(p[0] - 3, p[1] - 1, p[0] + 3, p[1], OAK_DK)
        cv.px(p[0] - 2, p[1] - 9, SUN if g == GOLD else CREAM)


def yoga_mat(cv, v):
    a = WP(R, 38.2, 0.0, 0.4)
    cv.rect(a[0] - 4, a[1] - 30, a[0] + 4, a[1], PLUM_2)
    cv.ell(a[0] - 4, a[1] - 33, a[0] + 4, a[1] - 27, PLUM_3)
    cv.ell(a[0] - 2, a[1] - 31, a[0] + 2, a[1] - 29, PLUM_1)


def gym_light(cv, v):
    x, y = WP(R, 37.0, 9.7, 0.1)
    lit = v == "night"
    cv.rect(x - 2, y - 2, x + 2, y + 1, INK)
    cv.ell(x - 5, y + 1, x + 5, y + 11, SUN if lit else AMBER)
    for k in range(-4, 5, 3):
        cv.line(x + k, y + 1, x + k, y + 11, INK)
    cv.line(x - 5, y + 6, x + 5, y + 6, INK)


def gym_on(cv, v):
    x, y = WP(R, 37.0, 9.7, 0.1)
    cv.ell(x - 5, y + 1, x + 5, y + 11, SUN)
    for k in range(-4, 5, 3):
        cv.line(x + k, y + 1, x + k, y + 11, INK)
    for k in range(1, 12):
        cv.dither([(x - 10 - k * 5, y + 10 + k * 8), (x + 10 + k * 3, y + 10 + k * 8), (x + 11 + k * 3, y + 16 + k * 8),
                   (x - 11 - k * 5, y + 16 + k * 8)], GLOW if k < 4 else AMBER, max(0.03, 0.14 - k * 0.01))


def chalk_marks(cv, v):
    for k in range(5):
        p = P(8.0 + k * 0.4, 0, 25.6 + (k % 2) * 0.4)
        cv.px(p[0], p[1], CREAM)


def main():
    emit("computer.desk", zone="computer", kind="decor", layer=3, paint=cdesk, variants=("base", "t1", "t3", "t5"),
         note="computer desk along the right wall (t1 folding, t3 oak, t5 oak + LED)")
    emit("computer.ai", zone="computer", kind="hotspot", layer=3, paint=computer, variants=("s0", "s1", "s2"),
         target={"skill": "ai-building"}, label="AI BUILDING", light=False, note="tower + two monitors (s2 third monitor)")
    emit("computer.board", zone="computer", kind="hotspot", layer=3, paint=whiteboard, variants=("s0", "s1", "s2"),
         target={"skill": "dropshipping"}, label="DROPSHIPPING", note="product whiteboard (flow boxes, sales line)")
    emit("computer.focus", zone="computer", kind="hotspot", layer=3, paint=sticky, target={"feature": "focus"},
         label="FOCUS", rim=False, note="sticky note: today's focus line")
    emit("computer.money", zone="computer", kind="decor", layer=3, paint=money_tree, variants=("base", "g0", "g1", "g2", "g3"),
         note="braided money tree growth piece (g0 sprout .. g3 full + gold)")
    emit("computer.chair", zone="computer", kind="decor", layer=3, paint=cchair, variants=("base", "t1", "t3", "t5"),
         note="desk chair (t1 stool, t3 gaming chair, t5 leather)")
    emit("computer.speakers", zone="computer", kind="decor", layer=3, paint=speakers, note="desk speakers")
    emit("computer.router", zone="computer", kind="decor", layer=2, paint=router, light=False, note="router with blinking LEDs")
    emit("computer.cables", zone="computer", kind="decor", layer=3, paint=ccables, variants=("base", "t1", "t3"),
         note="t1 cable nest, t3 tidy tray")
    emit("computer.boxes", zone="computer", kind="decor", layer=4, paint=boxes, note="shipping boxes with a blank label")
    emit("computer.led", zone="computer", kind="decor", layer=3, paint=ledstrip, light=False, note="plum LED strip on the wall")
    emit("computer.headset", zone="computer", kind="decor", layer=2, paint=headset, note="headset on a hook")
    emit("computer.shelf", zone="computer", kind="decor", layer=3, paint=fig_shelf, note="figurine shelf above the whiteboard")
    emit("computer.can", zone="computer", kind="decor", layer=3, paint=can, note="drink can on the desk")
    emit("computer.on", zone="computer", kind="overlay", layer=3, paint=computer_on, light=False, rim=False,
         note="'it's on' light: monitor glow on the desk")
    emit("gym.bike", zone="gym", kind="hotspot", layer=5, paint=bike, variants=("s0", "s1", "s2", "awake"),
         target={"skill": "triathlon"}, label="TRIATHLON", note="road bike on wall hooks, tarp half draped; emblem below; awake = tarp off")
    emit("gym.running", zone="gym", kind="hotspot", layer=4, paint=running, variants=("s0", "s1", "s2"),
         target={"skill": "running"}, label="RUNNING", note="mileage poster, race bib, running shoes on a hook")
    emit("gym.medals", zone="gym", kind="decor", layer=4, paint=medal_wall, variants=("base", "g0", "g1", "g2", "g3"),
         note="medal wall growth piece (g0 1 medal .. g3 7)")
    emit("gym.tiles", zone="gym", kind="decor", layer=5, paint=tiles, variants=("base", "t1", "t3", "t5"), contact="top",
         note="t1 towel, t3 rubber floor tiles, t5 terracotta tiles")
    emit("gym.strength", zone="gym", kind="hotspot", layer=5, paint=rack, variants=("s0", "s1", "s2"),
         target={"skill": "strength"}, label="STRENGTH", note="plate tree + barbell (s2 chalk bucket)")
    emit("gym.kettlebell", zone="gym", kind="decor", layer=5, paint=kettlebell, note="kettlebell")
    emit("gym.bag", zone="gym", kind="decor", layer=5, paint=gym_bag, note="gym bag")
    emit("gym.roller", zone="gym", kind="decor", layer=5, paint=foam_roller, note="foam roller")
    emit("gym.bottle", zone="gym", kind="decor", layer=5, paint=water_bottle, note="water bottle by the rack")
    emit("gym.rope", zone="gym", kind="decor", layer=5, paint=jump_rope, note="jump rope on a hook")
    emit("gym.timer", zone="gym", kind="decor", layer=4, paint=timer, light=False, note="interval timer, red digits")
    emit("gym.trophies", zone="gym", kind="decor", layer=4, paint=trophies, variants=("base", "t1", "t3", "t5"),
         note="trophy shelf (1 / 3 / 5 cups)")
    emit("gym.mat", zone="gym", kind="decor", layer=4, paint=yoga_mat, note="rolled yoga mat against the wall")
    emit("gym.light", zone="gym", kind="decor", layer=4, paint=gym_light, variants=("base", "night"), note="caged wall lamp")
    emit("gym.chalk", zone="gym", kind="decor", layer=5, paint=chalk_marks, light=False, contact="top", note="chalk dust on the floor")
    emit("gym.on", zone="gym", kind="overlay", layer=4, paint=gym_on, light=False, rim=False,
         note="'it's on' light: caged gym lamp lit")
    finish("right")


if __name__ == "__main__":
    main()
