"""Room v3 statue + relics: the ~10 ft obsidian figure (gold plating by section, tiers I..V), its backlit
alcove and pedestal + plaque, the ceiling downlight overlay (with dust motes), the panel close-up, and the
three relic slots (left mount by the door, window niche, right bracket by the gym).
Run: python3 art/room-v3/statue-relics/build.py
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from room import *  # noqa: E402,F401,F403

ZS = 46.4          # figure depth
SX = -2.8         # figure centre X
PED = (SX - 1.9, SX + 1.9, 45.5, 47.2)  # pedestal X0, X1, Z0 (front), Z1
PED_H = 1.5
SECTIONS = ["chest", "head", "armR", "legL", "armL", "legR", "abdomen"]  # plating order
PLATED = {1: 0, 2: 2, 3: 4, 4: 6, 5: 7}
TIER_NAME = {1: "I · RAW", 2: "II · AWAKENED", 3: "III · FORGED", 4: "IV · ASCENDANT", 5: "V · SOVEREIGN"}


def figure_masks(cx, feet, u):
    """Section masks for the figure (front view, contrapposto), in art-array coordinates."""
    def Y(k):
        return feet - k * u
    body = [
        ("head", "ell", (cx - 0.36 * u, Y(8), cx + 0.36 * u, Y(7.05))),
        ("head", "poly", [(cx - 0.17 * u, Y(7.2)), (cx + 0.17 * u, Y(7.2)), (cx + 0.2 * u, Y(6.8)), (cx - 0.2 * u, Y(6.8))]),
        ("torso", "poly", [(cx - 1.05 * u, Y(6.75)), (cx + 1.0 * u, Y(6.62)), (cx + 0.9 * u, Y(5.9)), (cx + 0.66 * u, Y(4.9)),
                           (cx + 0.6 * u, Y(4.25)), (cx + 0.72 * u, Y(3.85)), (cx - 0.68 * u, Y(3.97)), (cx - 0.62 * u, Y(4.35)),
                           (cx - 0.68 * u, Y(4.95)), (cx - 0.95 * u, Y(5.95))]),
        ("legL", "poly", [(cx - 0.68 * u, Y(3.97)), (cx + 0.05 * u, Y(3.9)), (cx - 0.12 * u, Y(2.1)), (cx - 0.18 * u, Y(1.9)),
                          (cx - 0.2 * u, Y(0.25)), (cx - 0.55 * u, Y(0.25)), (cx - 0.6 * u, Y(1.9)), (cx - 0.68 * u, Y(2.2))]),
        ("legR", "poly", [(cx - 0.05 * u, Y(3.9)), (cx + 0.72 * u, Y(3.85)), (cx + 0.55 * u, Y(2.2)), (cx + 0.42 * u, Y(1.85)),
                          (cx + 0.52 * u, Y(0.35)), (cx + 0.2 * u, Y(0.3)), (cx + 0.05 * u, Y(1.85)), (cx + 0.02 * u, Y(2.2))]),
        ("legL", "poly", [(cx - 0.6 * u, Y(0.3)), (cx - 0.15 * u, Y(0.3)), (cx - 0.1 * u, Y(0)), (cx - 0.7 * u, Y(0))]),
        ("legR", "poly", [(cx + 0.18 * u, Y(0.35)), (cx + 0.55 * u, Y(0.35)), (cx + 0.66 * u, Y(0.08)), (cx + 0.2 * u, Y(0.08))]),
        ("armL", "poly", [(cx - 1.05 * u, Y(6.75)), (cx - 0.82 * u, Y(6.55)), (cx - 0.8 * u, Y(5.2)), (cx - 0.86 * u, Y(4.0)),
                          (cx - 0.9 * u, Y(3.35)), (cx - 1.12 * u, Y(3.3)), (cx - 1.15 * u, Y(4.1)), (cx - 1.12 * u, Y(5.3)),
                          (cx - 1.18 * u, Y(6.2))]),
        ("armR", "poly", [(cx + 1.0 * u, Y(6.62)), (cx + 1.15 * u, Y(6.1)), (cx + 1.12 * u, Y(5.1)), (cx + 1.22 * u, Y(4.1)),
                          (cx + 1.25 * u, Y(3.45)), (cx + 1.02 * u, Y(3.4)), (cx + 0.94 * u, Y(4.1)), (cx + 0.86 * u, Y(5.2)),
                          (cx + 0.8 * u, Y(6.4))]),
    ]
    masks = {}
    for name, kind, geo in body:
        im = Image.new("1", (AW, AH), 0)
        d = ImageDraw.Draw(im)
        if kind == "ell":
            x0, y0, x1, y1 = geo
            d.ellipse([round(x0 - AX), round(y0 - AY), round(x1 - AX), round(y1 - AY)], fill=1)
        else:
            d.polygon([(round(x - AX), round(y - AY)) for x, y in geo], fill=1)
        masks[name] = masks.get(name, np.zeros((AH, AW), bool)) | np.array(im, bool)
    yy = np.arange(AH)[:, None] + AY
    split = Y(5.0)
    masks["chest"] = masks["torso"] & (yy < split)
    masks["abdomen"] = masks["torso"] & (yy >= split)
    del masks["torso"]
    return masks, Y


def paint_figure(cv, cx, feet, u, tier, top_lit=False, halo=True):
    masks, Y = figure_masks(cx, feet, u)
    m = np.zeros((AH, AW), bool)
    for v in masks.values():
        m |= v
    a = cv.arr()
    xx = np.arange(AW)[None, :] + AX
    if halo:  # backlight: a warm, uneven halo hugging the silhouette so it never merges with the wall
        near = np.zeros_like(m)
        for r_, col, dens in ((7, TERRA_0, 0.55), (4, TERRA_1, 0.6), (2, RIM, 0.75)):
            ring = np.zeros_like(m)
            for dy in range(-r_, r_ + 1, 1):
                for dx in range(-r_, r_ + 1, 1):
                    if dx * dx + dy * dy <= r_ * r_:
                        ring |= np.roll(np.roll(m, dy, 0), dx, 1)
            sel = ring & ~m & (BAY < dens) & (a != T)
            a[sel] = col
            near |= ring
    plated = set(SECTIONS[:PLATED[tier]])
    gold = np.zeros_like(m)
    for name, mm in masks.items():
        ys, xs = np.nonzero(mm)
        cxp = xs.mean() + AX if len(xs) else cx
        relp = xx - cxp
        if name in plated:
            gold |= mm
            a[mm] = GOLD
            a[mm & (relp < -2)] = GOLD_DK
            a[mm & (relp < -2) & (relp > -5) & (BAY < 0.5)] = GOLD
            a[mm & (relp > 2)] = AMBER
            a[mm & (relp > u * 0.18) & (BAY < 0.35)] = SUN if name in ("chest", "head") else GOLD
        else:
            a[mm] = INK
            a[mm & (relp > 1)] = SLATE_0
            a[mm & (relp > 1) & (BAY < 0.25)] = INK
            a[mm & (relp < -3)] = VOID
    for name, mm in masks.items():  # seams between sections
        seam = mm & ~np.roll(mm, 1, 0) & np.roll(m, 1, 0)
        a[seam] = GOLD_DK if name in plated else VOID
    cv.set(a)
    hx, hy = cx, Y(7.5)
    s = max(1, round(u / 23))
    face = GOLD_DK if "head" in plated else VOID
    cv.line(hx - 4 * s, hy + s, hx - 2 * s, hy + s, face)
    cv.line(hx + 2 * s, hy + s, hx + 4 * s, hy + s, face)
    cv.line(hx, hy + 2 * s, hx, hy + 5 * s, face)
    pc = GOLD_DK if "chest" in plated else VOID
    cv.line(cx - 0.5 * u, Y(5.7), cx - 0.05 * u, Y(5.5), pc)
    cv.line(cx + 0.05 * u, Y(5.5), cx + 0.5 * u, Y(5.65), pc)
    ac = GOLD_DK if "abdomen" in plated else VOID
    for k in range(3):
        cv.line(cx - 0.3 * u, Y(4.85 - k * 0.3), cx + 0.3 * u, Y(4.85 - k * 0.3), ac)
    if tier == 5:  # eyes glow
        for ex in (hx - 3 * s, hx + 3 * s):
            cv.rect(ex - s, hy + s, ex + s - 1, hy + s, SUN)
            cv.px(ex, hy + s - 1, CREAM)
    a = cv.arr()
    right_edge = m & ~np.roll(m, -1, 1)
    right2 = np.roll(right_edge, -1, 1) & m
    left_edge = m & ~np.roll(m, 1, 1)
    top_edge = m & ~np.roll(m, 1, 0)
    a[right2 & ~gold] = RIM
    a[right_edge & ~gold] = GLOW
    a[right_edge & gold] = SUN
    a[right2 & gold] = GOLD
    a[left_edge & ~gold] = SLATE_1
    a[left_edge & gold] = GOLD_DK
    a[top_edge & ~gold] = RIM
    if top_lit:
        a[top_edge] = SUN
        a[np.roll(top_edge, 1, 0) & m & gold] = SUN
        a[np.roll(top_edge, 1, 0) & m & ~gold & (BAY < 0.5)] = SLATE_1
    cv.set(a)
    return m


def alcove(cv):
    X0, X1 = SX - 1.9, SX + 1.9
    x0, y0 = P(X0, 11.85, ZB)
    x1, y1 = P(X1, PED_H, ZB)
    r = (x1 - x0) / 2
    cv.rect(x0 - 1, y0 + r, x1 + 1, y1, OAK_0)
    cv.disc((x0 + x1) / 2, y0 + r, round(r) + 1, OAK_0)
    cv.rect(x0, y0 + r, x1, y1, BROWN_0)
    cv.disc((x0 + x1) / 2, y0 + r, round(r), BROWN_0)
    # backlight wash inside the recess: warmer toward the lower centre
    a = cv.arr()
    cxw = (x0 + x1) / 2
    ins = a == BROWN_0
    d = np.sqrt(((WX - cxw) / (r * 1.1)) ** 2 + ((WY - (y0 + y1) * 0.55) / ((y1 - y0) * 0.65)) ** 2)
    a[ins & (d < 0.95) & (BAY < 0.5)] = TERRA_0
    a[ins & (d < 0.7) & (BAY < 0.6)] = TERRA_1
    a[ins & (d < 0.45) & (BAY < 0.5)] = TERRA_2
    cv.set(a)
    cv.line(x0 - 2, y1, x1 + 2, y1, GLOW)  # hidden LED strip at the alcove floor


def pedestal(cv, tier):
    X0, X1, Z0, Z1 = PED
    if tier <= 2:
        top, face, side, edge = BROWN_2, BROWN_1, INK, OAK_0
    elif tier <= 4:
        top, face, side, edge = SLATE_2, SLATE_1, SLATE_0, CREAM
    else:
        top, face, side, edge = SUN, GOLD, GOLD_DK, SUN
    shadow(cv, X0 - 0.3, X1 + 0.3, Z0 - 0.4, Z1, 0.55)
    box(cv, X0, X1, 0, PED_H, Z0, Z1, top, face, side)
    px0, py0 = P(X0, PED_H, Z0)
    px1, py1 = P(X1, 0, Z0)
    cv.line(px0, py0, px1, py0, edge)
    cv.rect(px0, py1 - 3, px1, py1, dn(face))
    cv.rect(px0, py0 + 2, px1, py0 + 3, dn(face) if tier < 5 else GOLD_DK)
    if tier <= 2:
        for k in range(16):
            cv.px(px0 + 3 + (k * 37) % int(px1 - px0 - 6), py0 + 6 + (k * 13) % int(py1 - py0 - 10), BROWN_2)
    elif tier <= 4:
        pts = [(px0 + 4, py0 + 6), (px0 + 14, py0 + 12), (px0 + 22, py0 + 9), (px0 + 30, py0 + 18)]
        cv.lines(pts, SLATE_1)
        cv.lines([(px1 - 6, py0 + 5), (px1 - 14, py0 + 14), (px1 - 10, py1 - 5)], SLATE_1)
    else:
        for k in range(0, int(px1 - px0), 6):
            cv.px(px0 + k, py0 + 5, SUN)
    name = TIER_NAME[tier]
    tw = text_w(name)
    qx = round((px0 + px1) / 2 - tw / 2) - 3
    qy = round(py0 + 9)
    plate_bg = OAK_0 if tier < 5 else INK
    cv.rect(qx, qy, qx + tw + 5, qy + 8, GOLD_DK)
    cv.rect(qx + 1, qy + 1, qx + tw + 4, qy + 7, plate_bg)
    cv.line(qx, qy, qx + tw + 5, qy, GOLD)
    cv.text(qx + 3, qy + 2, name, GOLD if tier < 5 else SUN)
    return (px0, py0, px1, py1)


def statue_paint(cv, v):
    tier = int(v[1]) if v.startswith("t") else 1
    alcove(cv)
    pedestal(cv, tier)
    cx = P(SX, 0, ZS)[0]
    feet = round(P(0, PED_H, ZS - 0.3)[1]) + 2
    u = 10.0 * (F / ZS) / 8.0
    paint_figure(cv, cx, feet, u, tier)


def closeup_paint(cv, v):
    tier = int(v[1]) if v.startswith("t") else 1
    cx, feet = 300, 560
    u = 2 * 10.0 * (F / ZS) / 8.0
    cv.rect(cx - 120, feet - 8 * u - 40, cx + 120, feet + 40, BROWN_0)  # backdrop panel
    a = cv.arr()
    sel = (a == BROWN_0) & (np.sqrt(((WX - cx) / 110) ** 2 + ((WY - (feet - 4 * u)) / 230) ** 2) < 0.8) & (BAY < 0.5)
    a[sel] = TERRA_0
    cv.set(a)
    cv.rect(cx - 80, feet, cx + 80, feet + 40, BROWN_1 if tier <= 2 else SLATE_2 if tier <= 4 else GOLD)
    cv.line(cx - 80, feet, cx + 80, feet, up(BROWN_1 if tier <= 2 else SLATE_2 if tier <= 4 else GOLD, 2))
    paint_figure(cv, cx, feet, u, tier)


DL = (SX, 45.2)  # downlight X, Z


def fixture(cv, v):
    x, y = P(DL[0], CEIL, DL[1])
    cv.rect(x - 8, y - 1, x + 8, y + 2, BROWN_1)
    cv.line(x - 8, y - 1, x + 8, y - 1, OAK_0)
    cv.rect(x - 5, y + 3, x + 5, y + 4, INK)
    cv.line(x - 5, y + 4, x + 5, y + 4, BROWN_2)


def statue_mask():
    cx = P(SX, 0, ZS)[0]
    feet = round(P(0, PED_H, ZS - 0.3)[1]) + 2
    u = 10.0 * (F / ZS) / 8.0
    masks, _ = figure_masks(cx, feet, u)
    m = np.zeros((AH, AW), bool)
    for mm in masks.values():
        m |= mm
    return m


SMASK = statue_mask()


def downlight(cv, v, motes_seed=None):
    x, y = P(DL[0], CEIL, DL[1])
    fy = P(0, 0, 45.0)[1]
    cv.rect(x - 8, y - 1, x + 8, y + 2, BROWN_1)
    cv.rect(x - 5, y + 3, x + 5, y + 4, INK)
    cv.line(x - 5, y + 4, x + 5, y + 4, SUN)
    cv.line(x - 4, y + 5, x + 4, y + 5, CREAM)
    a = cv.arr()
    rel = WY - (y + 6)
    cone = (rel > 0) & (WY < fy) & (np.abs(WX - x) < 7 + rel * 0.25)
    core = cone & (np.abs(WX - x) < 3 + rel * 0.13)
    sel = cone & ~SMASK & (BAY < 0.07)
    a[sel] = GLOW
    a[core & ~SMASK & (BAY < 0.12) & (BAY >= 0.07)] = CREAM
    # light lands on the statue: top edges go white-gold
    top = SMASK & ~np.roll(SMASK, 1, 0)
    a[top & cone] = SUN
    a[np.roll(top, 1, 0) & SMASK & cone & (BAY < 0.5)] = SUN
    # pool on the floor in front of the pedestal
    pd = np.sqrt(((WX - x) / 70) ** 2 + ((WY - (fy + 2)) / 9) ** 2)
    a[(pd < 1) & (BAY < 0.3) & ~SMASK] = AMBER
    a[(pd < 0.6) & (BAY < 0.3) & ~SMASK] = GOLD
    cv.set(a)
    r = rng(77 if motes_seed is None else motes_seed)
    for k in range(16):
        yy = y + 16 + r.uniform(0, fy - y - 24)
        xx = x + r.uniform(-1, 1) * (5 + (yy - y) * 0.22)
        cv.px(xx, yy, CREAM if k % 3 else GLOW)


# ------------------------------------------------------------------ relics
def medal(cv, cx, cy, state="iron", s=1.0):
    """Hanging medal. iron = forged dark iron with ember edges; hot = glowing; gold = cast gold."""
    rr = max(4, round(8 * s))
    for k in range(-1, 2):
        cv.line(cx - rr + k, cy - rr * 2.2, cx - 2 + k, cy - rr * 0.6, [CRT_0, CREAM, SLATE_1][k + 1])
        cv.line(cx + rr + k, cy - rr * 2.2, cx + 2 + k, cy - rr * 0.6, [SLATE_1, CREAM, CRT_0][k + 1])
    ring, body, hi, glyph = {"iron": (TERRA_0, BROWN_1, SLATE_0, RIM), "hot": (CRT_0, RIM, ORANGE, TERRA_0),
                             "gold": (GOLD_DK, GOLD, SUN, GOLD_DK)}[state]
    cv.disc(cx, cy + 2, rr + 1, ring)
    cv.disc(cx, cy + 2, rr, body)
    cv.disc(cx - 1, cy + 1, max(1, rr - 3), hi if state != "iron" else BROWN_2)
    cv.px(cx - rr // 2, cy - rr // 2 + 2, SUN if state != "iron" else ORANGE)
    # swim / bike / run marks (original, 3 px glyphs)
    for dx, g in ((-4, ["010", "101", "000"]), (-1, ["101", "010", "101"]), (2, ["010", "110", "101"])):
        for j, row in enumerate(g):
            for i, b in enumerate(row):
                if b == "1":
                    cv.px(cx + dx + i, cy + 1 + j, glyph)
    if state == "iron":  # ember edge on the lower rim
        for t in np.linspace(0.2, math.pi - 0.2, 9):
            cv.px(cx + math.cos(t) * (rr + 1), cy + 2 + math.sin(t) * (rr + 1), RIM if int(t * 7) % 2 else ORANGE)
    for (dx, dy, c) in ((-rr - 3, -3, GLOW), (rr + 3, -6, ORANGE), (-rr, -rr - 6, RIM), (rr - 1, -rr - 9, GLOW), (1, -rr * 2 - 6, ORANGE)):
        cv.px(cx + dx, cy + dy, c)


def plus(cv, x, y, c=OAK_2):
    cv.line(x - 2, y, x + 2, y, c)
    cv.line(x, y - 2, x, y + 2, c)


def wall_mount(side, z0, z1, h0, h1):
    def paint(cv, v):
        wquad(cv, side, z0, z1, h0, h1, BROWN_0)
        wquad(cv, side, z0 + 0.06, z1 - 0.06, h0 + 0.07, h1 - 0.07, OAK_0)
        wquad(cv, side, z0 + 0.06, z1 - 0.06, h1 - 0.12, h1 - 0.07, OAK_1)
        mx, my = WP(side, (z0 + z1) / 2, (h0 + h1) / 2)
        hook = WP(side, (z0 + z1) / 2, h1 - 0.15, 0.1)
        cv.px(hook[0], hook[1], GOLD_DK)
        if v == "base":
            plus(cv, mx, my)
        else:
            state = {"active": "iron", "hot": "hot", "gold": "gold"}[v]
            medal(cv, mx, my + 2, state, 0.85)
    return paint


NICHE_X = 3.0


def niche(cv, v):
    nx = round(P(NICHE_X, 0, ZB)[0])
    ny0, ny1 = round(P(0, 11.7, ZB)[1]), round(P(0, 9.55, ZB)[1])
    hw = 18
    cv.rect(nx - hw, ny0 + hw, nx + hw, ny1, OAK_1)
    cv.disc(nx, ny0 + hw, hw, OAK_1)
    cv.rect(nx - hw + 3, ny0 + hw, nx + hw - 3, ny1 - 2, TERRA_0)
    cv.disc(nx, ny0 + hw, hw - 3, TERRA_0)
    cv.rect(nx - hw + 5, ny0 + hw + 3, nx + hw - 5, ny1 - 2, BROWN_2)
    cv.disc(nx, ny0 + hw + 2, hw - 6, BROWN_2)
    cv.rect(nx - hw + 3, ny1 - 3, nx + hw - 3, ny1 - 2, RIM if v != "base" else TERRA_1)
    cv.rect(nx - hw - 2, ny1, nx + hw + 2, ny1 + 2, OAK_0)
    cv.line(nx - hw - 2, ny1, nx + hw + 2, ny1, OAK_2)
    if v == "base":
        plus(cv, nx, ny0 + hw + 4)
    else:
        medal(cv, nx, ny0 + hw + 4, {"active": "iron", "hot": "hot", "gold": "gold"}[v], 1.2)


def main():
    emit("window.statue", zone="window", kind="hotspot", layer=2, paint=statue_paint,
         variants=("base", "t1", "t2", "t3", "t4", "t5"), target={"feature": "overall"}, label="FORGE",
         light=False, rim=False, contact=round(P(0, 0, PED[2])[1]),
         note="10 ft obsidian figure, backlit alcove, gold plating by section (0/2/4/6/7), pedestal stone/marble/gilded + tier plaque")
    emit("window.downlight-fixture", zone="window", kind="decor", layer=2, paint=fixture, rim=False,
         note="ceiling downlight above the statue (off)")
    emit("window.statue-downlight", zone="window", kind="overlay", layer=3, paint=downlight, light=False, rim=False,
         anim={"frames": [lambda cv, s=s: downlight(cv, "base", s) for s in (101, 202, 303)], "fps": 4},
         note="shown when the statue is selected: downlight on, cone, dust motes (anim frames move the motes)")
    emit("window.statue-closeup", zone="window", kind="overlay", layer=6, paint=closeup_paint,
         variants=("base", "t1", "t2", "t3", "t4", "t5"), light=False, rim=False,
         note="panel close-up of the statue at 2x detail, per tier")
    emit("window.relic", zone="window", kind="hotspot", layer=2, paint=niche, variants=("base", "active", "hot", "gold"),
         target={"feature": "relic-window"}, label="RELIC", rim=False,
         note="arched relic niche above the window (base: empty with a pixel plus; active: forged iron medal)")
    emit("kitchen.relic", zone="kitchen", kind="hotspot", layer=3, paint=wall_mount("L", 38.8, 39.6, 5.1, 6.1),
         variants=("base", "active", "hot", "gold"), target={"feature": "relic-left"}, label="RELIC", rim=False,
         note="left relic wall mount beside the door")
    emit("gym.relic", zone="gym", kind="hotspot", layer=3, paint=wall_mount("R", 41.0, 41.8, 5.1, 6.1),
         variants=("base", "active", "hot", "gold"), target={"feature": "relic-right"}, label="RELIC", rim=False,
         note="right relic bracket by the gym")
    finish("statue-relics")


if __name__ == "__main__":
    main()
