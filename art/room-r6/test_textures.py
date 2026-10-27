#!/usr/bin/env python3
"""Self-test for the art pass 6 texture library and gate.

A tiny raycast version of the r6 room (INTERFACES 1: 28 x 28 ft, ceiling 13.5, camera at the centre, eye 7 ft,
four 90 degree views) at the master size, with a desk (box: front, side and top faces), a window with sky
content, a curtain, a poster and a rug. It fills the buffers exactly as the build must (img, mat, oid, names,
surf {kind, u, v, dist}, attention), runs textures.apply() and checks:
  1. the gate (texture_check) passes on the shell and the objects, tiers 1 and 5
  2. determinism: two runs are byte-identical
  3. world consistency: the same wall / floor / ceiling point seen from two adjacent views gets the same colour
  4. tiers change what is painted (T5 walls are venetian, the floor gets its border inlay, curtains velvet)
  5. selout / aa_curve / hotspot_contrast / attention_mask run and behave
Run: python3 art/room-r6/test_textures.py [--save]   (--save writes the stills to the scratch dir given by
     $TEXTURE_TEST_OUT, default /tmp/texture-test)
"""
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import textures as tx  # noqa: E402
import texture_check as tc  # noqa: E402

N = tx.N
M = tx.MAT_ID
W, H = 800, 560                   # the master size
F = tx.F_PX                        # 90 degrees across the 556 px core
CX, CY = W / 2, H / 2
HALF, CEIL, EYE = 14.0, 13.5, 7.0
YAW = {"front": 0.0, "right": 90.0, "back": 180.0, "left": 270.0}

# objects: (oid, name, material, base colour, kind, test) ; flat sprites are rectangles on a wall or floor
WIN = (-3.0, 3.0, 4.0, 10.5)       # window on the front wall: X0, X1, Y0, Y1
CURT = (3.0, 4.6, 3.6, 11.0)
POSTER = (6.0, 9.0, 6.0, 9.8)
RUG = (-2.6, 2.6, 3.0, 10.0)        # X0, X1, Z0, Z1 on the floor
DESK = (-12.5, -8.0, 0.0, 2.6, 8.0, 11.0)   # X0, X1, Y0, Y1, Z0, Z1
NAMES = {1: "wall-front", 2: "wall-right", 3: "wall-back", 4: "wall-left", 5: "floor", 6: "ceiling",
         10: "window", 11: "curtain-R", 12: "poster", 13: "rug", 14: "desk"}


def rays(view):
    a = math.radians(YAW[view])
    fwd = np.array([math.sin(a), 0.0, math.cos(a)])
    right = np.array([math.cos(a), 0.0, -math.sin(a)])
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    px = (xx + 0.5 - CX) / F
    py = -(yy + 0.5 - CY) / F
    d = right[None, None] * px[..., None] + np.array([0, 1.0, 0])[None, None] * py[..., None] + fwd[None, None]
    return d


def scene(view):
    """Raycast the room: returns img, mat, oid, surf, plus the hit points (X, Y, Z) for consistency checks."""
    d = rays(view)
    o = np.array([0.0, EYE, 0.0])
    t = np.full((H, W), np.inf)
    sid = np.zeros((H, W), np.int16)
    with np.errstate(divide="ignore", invalid="ignore"):
        for k, (axis, val) in enumerate(((2, HALF), (0, HALF), (2, -HALF), (0, -HALF), (1, 0.0), (1, CEIL)), 1):
            tt = (val - o[axis]) / d[..., axis]
            ok = (tt > 0) & (tt < t)
            t[ok] = tt[ok]
            sid[ok] = k
        # desk box (slab method), faces kinds 4 front, 5 side, 6 top
        X0, X1, Y0, Y1, Z0, Z1 = DESK
        lo = np.array([X0, Y0, Z0])
        hi = np.array([X1, Y1, Z1])
        t1 = (lo - o) / d
        t2 = (hi - o) / d
        tmin = np.minimum(t1, t2)
        tmax = np.maximum(t1, t2)
        tn = tmin.max(-1)
        tf = tmax.min(-1)
        hitb = (tn <= tf) & (tn > 0) & (tn < t)
        face = tmin.argmax(-1)
    t[hitb] = tn[hitb]
    sid[hitb] = 14
    P = o + d * t[..., None]
    X, Y, Z = P[..., 0], P[..., 1], P[..., 2]
    dist = t * np.linalg.norm(d, axis=-1)
    img = np.zeros((H, W), np.uint8)
    mat = np.zeros((H, W), np.uint8)
    kind = np.zeros((H, W), np.uint8)
    u = np.zeros((H, W))
    v = np.zeros((H, W))
    oid = sid.astype(np.int16).copy()
    for k in (1, 3):     # front / back walls: u = X (back mirrored so u runs left to right on the wall)
        s = sid == k
        img[s], mat[s], kind[s], u[s], v[s] = N["PLASTER"], M["plaster"], 1, X[s] * (1 if k == 1 else -1), Y[s]
    for k in (2, 4):     # right / left walls: u = Z
        s = sid == k
        img[s], mat[s], kind[s], u[s], v[s] = N["PLASTER"], M["plaster"], 1, Z[s] * (-1 if k == 2 else 1), Y[s]
    s = sid == 5
    img[s], mat[s], kind[s], u[s], v[s] = N["OAK_0"], M["wood_floor"], 2, X[s], Z[s]
    s = sid == 6
    img[s], mat[s], kind[s], u[s], v[s] = N["INK"], M["wood_ceiling"], 3, X[s], Z[s]
    # ceiling beams along Z (the ceiling object, kind 4 faces): every 6.5 ft, 0.7 ft wide, painted on the plane
    beam = s & (np.abs(((X + 3.25) % 6.5) - 3.25) < 0.35)
    img[beam], kind[beam], u[beam], v[beam] = N["OAK_DK"], 4, Z[beam], X[beam]
    # desk
    s = sid == 14
    fk = np.where(face == 1, 6, np.where(face == 2, 4, 5))
    img[s], mat[s] = N["OAK_1"], M["wood_furniture"]
    kind[s] = fk[s]
    top = s & (fk == 6)
    u[top], v[top] = X[top], Z[top]
    fr = s & (fk == 4)
    u[fr], v[fr] = X[fr], Y[fr]
    sd = s & (fk == 5)
    u[sd], v[sd] = Z[sd], Y[sd]
    img[top] = N["OAK_2"]
    # flat sprites on the front wall (kind 7) and the rug on the floor (kind 6)
    fw = sid == 1
    w = fw & (X > WIN[0]) & (X < WIN[1]) & (Y > WIN[2]) & (Y < WIN[3])
    sky = np.where(Y > 9.0, N["PLUM_2"], np.where(Y > 7.5, N["TERRA_2"], np.where(Y > 6.5, N["RIM"], N["LEAF_1"])))
    img[w], mat[w], oid[w], kind[w] = sky[w], M["glass_window"], 10, 7
    mull = fw & (np.abs(X) < 0.12) & (Y > WIN[2]) & (Y < WIN[3])
    img[mull], mat[mull], oid[mull], kind[mull] = N["OAK_DK"], M["wood_furniture"], 10, 7
    c = fw & (X > CURT[0]) & (X < CURT[1]) & (Y > CURT[2]) & (Y < CURT[3])
    img[c], mat[c], oid[c], kind[c] = N["PLUM_2"], M["fabric_cotton"], 11, 7
    p = fw & (X > POSTER[0]) & (X < POSTER[1]) & (Y > POSTER[2]) & (Y < POSTER[3])
    img[p], mat[p], oid[p], kind[p] = N["PAPER"], M["paper"], 12, 7
    pa = p & (np.abs(X - 7.5) < 0.8) & (np.abs(Y - 8.0) < 1.0)
    img[pa] = N["SLATE_1"]
    rg = (sid == 5) & (X > RUG[0]) & (X < RUG[1]) & (Z > RUG[2]) & (Z < RUG[3])
    img[rg], mat[rg], oid[rg], kind[rg] = N["TERRA_1"], M["rug_pile"], 13, 6
    star = rg & ((np.abs(X) < 0.35) & (np.abs(((Z - 3.0) % 2.0) - 1.0) < 0.12) |
                 (np.abs(X) < 0.10) & (np.abs(((Z - 3.0) % 2.0) - 1.0) < 0.3))
    img[star] = N["GOLD"]
    surf = {"kind": kind, "u": u, "v": v, "dist": dist}
    return img, mat, oid, surf, (X, Y, Z, sid)


def textured(view, tier, seed=1):
    img, mat, oid, surf, pts = scene(view)
    att = tx.attention_mask(H, W, [(300, 120, 500, 400)], kind=surf["kind"], ring=48)
    opts = {"window_px": (W / 2, 200) if view == "front" else None}
    tx.apply(img, mat, surf, oid, NAMES, att, view, tier, seed, opts)
    # the desk is a hotspot: selective outline with the 2-step legibility fallback (build step after texture)
    tx.selout(img, oid == 14, light_px=opts["window_px"], hotspot=True, add=True)
    return img, mat, oid, surf, pts


def rgb(img):
    out = np.zeros(img.shape + (3,), np.uint8)
    ok = img < 64
    out[ok] = tx.RGB[img[ok]]
    return out


def gate(view, tier, img, mat, oid):
    """Run the gate with the shell as one sprite and each object as its own sprite."""
    shell = np.isin(oid, [1, 2, 3, 4, 5, 6])
    images, items = {}, []
    a = np.where(shell, img, 255).astype(np.uint8)
    mm = np.where(shell, mat, 255).astype(np.uint8)
    images["test/shell.png"] = {"idx": a, "mat": mm}
    items.append({"id": "shell", "kind": "shell", "view": view, "x": 0, "y": 0, "w": W, "h": H, "layer": 0,
                  "variants": {"base": "test/shell.png"}})
    for o in (10, 11, 12, 13, 14):
        m = oid == o
        if m.sum() == 0:
            continue
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = np.where(m, img, 255)[y0:y1, x0:x1].astype(np.uint8)
        subm = np.where(m, mat, 255)[y0:y1, x0:x1].astype(np.uint8)
        p = f"test/{NAMES[o]}.png"
        images[p] = {"idx": sub, "mat": subm}
        items.append({"id": NAMES[o], "kind": "hotspot" if o == 14 else "decor", "view": view, "x": int(x0),
                      "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0), "layer": 1, "variants": {"base": p}})
    return tc.gate(None, items, images, tx.PALETTE)


def main():
    fails = []
    save = "--save" in sys.argv
    outdir = os.environ.get("TEXTURE_TEST_OUT", "/tmp/texture-test")
    if save:
        os.makedirs(outdir, exist_ok=True)

    # 1 + 2: gate and determinism, front view, tiers 1..5
    for tier in (1, 3, 5):
        a = textured("front", tier)
        b = textured("front", tier)
        if not (np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])):
            fails.append(f"tier {tier}: two runs differ (not deterministic)")
        errs, rep = gate("front", tier, a[0], a[1], a[2])
        print(f"--- gate, front view, tier {tier}")
        print(rep)
        fails += [f"T{tier}: {e}" for e in errs]
        if save:
            Image.fromarray(rgb(a[0])).resize((W * 2, H * 2), Image.NEAREST).save(f"{outdir}/front-t{tier}@2x.png")
    # 3: world consistency between adjacent views (front and right share the front-right corner)
    fa = textured("front", 1)
    ra = textured("right", 1)
    if save:
        Image.fromarray(rgb(ra[0])).resize((W * 2, H * 2), Image.NEAREST).save(f"{outdir}/right-t1@2x.png")
    Xf, Yf, Zf, sf = fa[4]
    Xr, Yr, Zr, sr = ra[4]
    # map every right-view pixel's hit point into the front view's pixel grid (same camera centre)
    dvec = np.stack([Xr, Yr - EYE, Zr], -1)
    zc = dvec[..., 2]
    vis = (zc > 0) & np.isin(sr, [1, 2, 5, 6])
    with np.errstate(divide="ignore", invalid="ignore"):
        fx = CX + F * dvec[..., 0] / zc - 0.5
        fy = CY - F * dvec[..., 1] / zc - 0.5
    near = vis & (np.abs(fx - np.round(fx)) < 0.2) & (np.abs(fy - np.round(fy)) < 0.2)
    fxi, fyi = np.round(fx).astype(int), np.round(fy).astype(int)
    near &= (fxi >= 0) & (fxi < W) & (fyi >= 0) & (fyi < H)
    ys, xs = np.nonzero(near)
    same_surface = sf[fyi[ys, xs], fxi[ys, xs]] == sr[ys, xs]
    ys, xs = ys[same_surface], xs[same_surface]
    match = ra[0][ys, xs] == fa[0][fyi[ys, xs], fxi[ys, xs]]
    share = float(match.mean()) if len(match) else 0.0
    print(f"--- world consistency front/right: {len(match)} shared samples, {share:.1%} identical")
    if len(match) < 200 or share < 0.9:
        fails.append(f"world consistency: {share:.1%} of {len(match)} shared samples identical (want 90%+)")
    # 4: tiers change the material
    t1, t5 = textured("front", 1), textured("front", 5)
    if not (t5[1] == tx.MAT_ID["plaster_venetian"]).any():
        fails.append("T5: no venetian plaster")
    if not ((t5[1] == tx.MAT_ID["fabric_velvet"]) & (t5[2] == 11)).any():
        fails.append("T5: curtains not velvet")
    if (t1[0] != t5[0]).mean() < 0.3:
        fails.append("tiers 1 and 5 look too alike")
    if not ((t5[1] == tx.MAT_ID["wood_furniture"]) & (t5[2] == 1)).any():
        fails.append("T5: no wainscot / baseboard on the wall")
    # 5: helpers
    img, mat, oid, surf, pts = scene("front")
    m = oid == 14
    before = img.copy()
    img[m & ~tx.nbr(m, 0, 1, False)] = N["INK"]
    tx.selout(img, m, light_px=(W / 2, 200), hotspot=True)
    ok, bad = tx.hotspot_contrast(img, m)
    if bad.any():
        fails.append(f"selout(hotspot=True) left {int(bad.sum())} low-contrast silhouette pixels")
    c = np.full((40, 40), N["PLASTER"], np.uint8)
    yy, xx = np.mgrid[0:40, 0:40]
    disc = (yy - 20) ** 2 + (xx - 20) ** 2 < 15 ** 2
    c[disc] = N["PLUM_3"]
    c2 = c.copy()
    tx.aa_curve(c2, disc)
    changed = int((c2 != c).sum())
    print(f"--- aa_curve on a disc: {changed} pixels")
    if changed < 8:
        fails.append("aa_curve changed too few pixels on a disc")
    box = np.zeros((40, 40), bool)
    box[5:30, 5:30] = True
    c3 = c.copy()
    tx.aa_curve(c3, box)
    if (c3 != c).any():
        fails.append("aa_curve touched a box corner")
    print("\n" + ("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
