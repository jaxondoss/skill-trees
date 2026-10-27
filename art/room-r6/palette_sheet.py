#!/usr/bin/env python3
"""FORGE art pass 6: the 64-colour palette (authoring source) and its review sheets.

The palette is authored here and written to art/room-r6/palette.json (the single source of truth the build,
the gate and the engine read). Indices 0..36 are the art pass 5 palette, unchanged in name and value.
Indices 37..63 are the 27 new colours named in TEXTURE_SPEC section 3, with hex values tuned so every
material ramp steps evenly in lightness (CIE L*) and keeps the hue drift of the existing 37.

Run:
  python3 art/room-r6/palette_sheet.py --write-palette   (palette.json only)
  python3 art/room-r6/palette_sheet.py                   (palette.json, then both sheets)
Out:
  art/room-r6/palette.json
  docs/redesign/room-r6/stills/palette-ramps@4x.png  (every ramp, new colours marked, hex labels)
  docs/redesign/room-r6/stills/swatches@4x.png       (each material as a 64x64 swatch at 4 light levels)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
R5_PALETTE = os.path.join(ROOT, "art", "room-r5", "palette.json")
OUT_PALETTE = os.path.join(HERE, "palette.json")
STILLS = os.path.join(ROOT, "docs", "redesign", "room-r6", "stills")

# ---------------------------------------------------------------- the 27 new colours (indices 37..63)
# (name, hex, use). Spec starting values, tuned where a ramp stepped unevenly:
#   OAK_3      a touch lighter than spec so it clears OAK_2 by a full step (L* 50 -> 59), just under AMBER
#   PLASTER_4  pulled down so the plaster ramp steps 8, 12, 16, 22, 28, 34 (spec value jumped 8 at the top)
#   COOL_*     spread apart: spec GLASS_DK and COOL_0 were 2 L* apart, and COOL_2 sat 44 L* under SLATE_2
#   GLASS_DK   one step under COOL_0
#   LINEN_*    LINEN_2 pulled down so BROWN_2 > LINEN_2 > LINEN_1 > CREAM steps ~22 L* each
NEW = [
    ("OAK_VD", "#2E1A12", "wood: deepest seam, knot core"),
    ("OAK_3", "#BC864B", "wood: grain highlight, worn edges"),
    ("PLASTER_1", "#2A1B26", "plaster ramp step 2"),
    ("PLASTER_2", "#43303B", "plaster ramp step 4"),
    ("PLASTER_3", "#553C49", "plaster ramp step 5 (patches, sanded)"),
    ("PLASTER_4", "#664955", "plaster ramp step 6 (chips, top lip)"),
    ("INK_2", "#221E24", "ceiling and dark wood mid"),
    ("PLUM_0", "#4A2E3A", "fabric deep fold (curtains, quilt)"),
    ("PLUM_4", "#F0B8C6", "fabric ridge highlight"),
    ("TERRA_VD", "#3F1312", "rug pile shadow, red runner deep"),
    ("SLATE_D", "#2A3638", "metal deep, cast iron"),
    ("SLATE_3", "#C4DADB", "chrome highlight band"),
    ("COOL_0", "#1F2836", "cool shadow anchor (glass, shade side)"),
    ("COOL_1", "#2E3B4F", "cool mid (window glass at night, steel)"),
    ("COOL_2", "#4A5B76", "cool light (reflections on glass)"),
    ("PAPER", "#D9C9A6", "paper, posters, book pages"),
    ("PAPER_DK", "#A8987A", "paper shade, fold, aged edge"),
    ("LEAF_4", "#B7CE74", "leaf translucent highlight"),
    ("GOLD_MID", "#A47A30", "gold ramp mid (knight tiers)"),
    ("GOLD_HI", "#F2D27A", "gold glint"),
    ("RAIN_0", "#5D7FA6", "rain streak far, drop shadow side"),
    ("RAIN_1", "#8FA9C9", "rain streak near"),
    ("RAIN_HI", "#C9DAEE", "drop glint, run head"),
    ("GLASS_DK", "#151B21", "CRT glass, dark glass"),
    ("LINEN_1", "#BCAA90", "sheets, pillow mid"),
    ("LINEN_2", "#7F6E5E", "sheets, pillow fold"),
    ("HAZE", "#4A3F4C", "fog, distance haze outside the window; light stone"),
]

# ---------------------------------------------------------------- material ramps (darkest to lightest)
# The first twelve are TEXTURE_SPEC section 3. The rest are small accent ramps so every one of the 64 colours
# has a ramp to step along (texture shifts, DARKER / BRIGHTER).
RAMPS = {
    "oak": ["OAK_VD", "OAK_DK", "OAK_0", "OAK_1", "OAK_2", "OAK_3", "AMBER"],
    "plaster": ["PLASTER_0", "PLASTER_1", "PLASTER", "PLASTER_2", "PLASTER_3", "PLASTER_4"],
    "dark_wood": ["VOID", "INK", "INK_2", "OAK_DK", "OAK_0"],
    "plum": ["PLUM_0", "PLUM_1", "PLUM_2", "PLUM_3", "PLUM_4"],
    "linen": ["BROWN_2", "LINEN_2", "LINEN_1", "CREAM"],
    "terra": ["TERRA_VD", "TERRA_0", "TERRA_1", "TERRA_2", "RIM"],
    "steel": ["SLATE_D", "SLATE_0", "SLATE_1", "SLATE_2", "SLATE_3"],
    "gold": ["GOLD_DK", "GOLD_MID", "GOLD", "GOLD_HI", "SUN"],
    "leaf": ["LEAF_0", "LEAF_1", "LEAF_2", "LEAF_3", "LEAF_4"],
    "paper": ["PAPER_DK", "PAPER", "CREAM"],
    "glass": ["GLASS_DK", "COOL_0", "COOL_1", "COOL_2", "SLATE_2"],
    "rain": ["RAIN_0", "RAIN_1", "RAIN_HI"],
    # accents
    "stone": ["INK", "BROWN_1", "HAZE", "PLUM_1"],
    "fire": ["TERRA_2", "RIM", "ORANGE", "GLOW", "SUN"],
    "crt": ["TERRA_0", "CRT_0", "CRT_1"],
    "energy": ["NAVY", "SLATE_1", "ENERGY", "ENERGY_HI"],
    "violet": ["PLUM_1", "VIOLET", "PLUM_3"],
}
# Which ramp a colour steps along when it sits on more than one (texture shifts use the material's ramp
# first; this is the fallback and the DARKER / BRIGHTER source for new colours).
PRIMARY = {
    "OAK_DK": "oak", "OAK_0": "oak", "INK": "dark_wood", "VOID": "dark_wood", "SLATE_2": "steel",
    "CREAM": "paper", "SUN": "gold", "PLUM_1": "plum", "TERRA_2": "terra", "TERRA_0": "terra",
    "SLATE_1": "steel", "BROWN_2": "linen",
}
TEXTURE_RAMPS = ["oak", "plaster", "dark_wood", "plum", "linen", "terra", "steel", "gold", "leaf", "paper",
                 "glass", "rain"]


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lab(h):
    """sRGB hex -> CIE L*a*b* (D65)."""
    c = [x / 255 for x in hex_rgb(h)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    X = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047
    Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    Z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))


# DARKER / BRIGHTER for the existing 37 as the engine has them today (fx.js / glow.js), so dust and glow on
# existing colours look the same. Targets that no longer exist in the palette (BROWN_0, INK_COOL, ROSE_*) are
# resolved here to the nearest real step; the engine treated them as identity.
ENGINE_DARKER = {
    "INK": "VOID", "BROWN_1": "INK", "BROWN_2": "BROWN_1", "TERRA_0": "TERRA_VD", "TERRA_1": "TERRA_0",
    "TERRA_2": "TERRA_1", "RIM": "TERRA_2", "ORANGE": "RIM", "GLOW": "ORANGE", "AMBER": "TERRA_1", "SUN": "GLOW",
    "GOLD": "GOLD_DK", "GOLD_DK": "BROWN_2", "LEAF_0": "INK", "LEAF_1": "LEAF_0", "LEAF_2": "LEAF_1",
    "LEAF_3": "LEAF_2", "SLATE_0": "SLATE_D", "SLATE_1": "SLATE_0", "SLATE_2": "SLATE_1", "PLUM_1": "PLUM_0",
    "PLUM_2": "PLUM_1", "PLUM_3": "PLUM_2", "CRT_0": "TERRA_0", "CRT_1": "CRT_0", "CREAM": "PAPER",
    "PLASTER_0": "INK", "PLASTER": "PLASTER_0", "NAVY": "INK", "ENERGY": "SLATE_1", "ENERGY_HI": "ENERGY",
    "VIOLET": "PLUM_1", "VOID": "VOID", "OAK_0": "OAK_DK", "OAK_1": "OAK_0", "OAK_2": "OAK_1",
    "OAK_DK": "OAK_VD",
}
ENGINE_BRIGHTER = {
    "VOID": "INK", "INK": "INK_2", "BROWN_1": "BROWN_2", "BROWN_2": "TERRA_1", "TERRA_0": "TERRA_1",
    "TERRA_1": "TERRA_2", "TERRA_2": "RIM", "RIM": "ORANGE", "ORANGE": "GLOW", "GLOW": "SUN", "AMBER": "GLOW",
    "SUN": "CREAM", "GOLD_DK": "GOLD", "GOLD": "SUN", "LEAF_0": "LEAF_1", "LEAF_1": "LEAF_2", "LEAF_2": "LEAF_3",
    "SLATE_0": "SLATE_1", "SLATE_1": "SLATE_2", "PLUM_1": "PLUM_2", "PLUM_2": "PLUM_3", "CRT_0": "CRT_1",
    "PLASTER_0": "PLASTER", "PLASTER": "PLUM_1", "NAVY": "SLATE_0", "ENERGY": "ENERGY_HI", "ENERGY_HI": "CREAM",
    "VIOLET": "PLUM_3", "LEAF_3": "LEAF_4", "SLATE_2": "SLATE_3", "PLUM_3": "PLUM_4", "CRT_1": "CRT_1",
    "CREAM": "CREAM", "OAK_DK": "OAK_0", "OAK_0": "OAK_1", "OAK_1": "OAK_2", "OAK_2": "OAK_3",
}
# Where the engine tables had no entry (or pointed at a removed name) the r6 value above is new; these are
# listed in TEXTURE_NOTES.md so the integrator can see every existing-colour change: INK (BROWN_0 -> INK_2),
# TERRA_0 (BROWN_0 -> TERRA_VD), SLATE_0 (INK_COOL -> SLATE_D), LEAF_0 (INK_COOL -> INK), PLUM_1 (ROSE_1 ->
# PLUM_2), CREAM (ROSE_1 -> PAPER), GOLD_DK unchanged, plus first entries for OAK_*, LEAF_3, SLATE_2, PLUM_3.


def ramp_of(name):
    if name in PRIMARY:
        return PRIMARY[name]
    for r, members in RAMPS.items():
        if name in members:
            return r
    return None


def build_palette():
    r5 = json.load(open(R5_PALETTE))
    colors = [list(c) for c in r5["colors"]]
    assert len(colors) == 37
    colors += [[n, h] for n, h, _ in NEW]
    names = [n for n, _ in colors]
    hexes = dict(colors)
    assert len(set(names)) == 64, "duplicate colour name"
    for r, members in RAMPS.items():
        for m in members:
            assert m in hexes, (r, m)
    L = {n: lab(h)[0] for n, h in colors}
    existing = set(names[:37])

    def step(name, k):
        r = RAMPS[ramp_of(name)]
        i = r.index(name)
        return r[max(0, min(len(r) - 1, i + k))]

    darker, brighter = {}, {}
    for n in names:
        if n in existing:
            darker[n] = ENGINE_DARKER.get(n, n)
            brighter[n] = ENGINE_BRIGHTER.get(n, n)
        else:
            darker[n] = step(n, -1)
            brighter[n] = step(n, +1)
    # ends of a ramp: one step past the end goes to the nearest darker / lighter colour in the whole palette
    LAB = {n: lab(h) for n, h in colors}

    def dist(a, b):
        return sum((x - y) ** 2 for x, y in zip(LAB[a], LAB[b])) ** 0.5
    for n in names:
        if darker[n] == n and n != "VOID":
            cands = [m for m in names if L[m] < L[n] - 2]
            darker[n] = min(cands, key=lambda m: dist(m, n)) if cands else n
        if brighter[n] == n and n not in ("CREAM", "SUN", "ENERGY_HI", "RAIN_HI", "SLATE_3"):
            cands = [m for m in names if L[m] > L[n] and ramp_of(m) == ramp_of(n)]
            if cands:
                brighter[n] = min(cands, key=lambda m: L[m])

    # LUTs: existing 37 keep their r5 entries; a new colour follows the nearest existing colour of its ramp
    # (TEXTURE_SPEC section 3). If that colour is unmapped in a LUT, the new colour stays itself (identity),
    # so the golden-hour LUT R4 stays a pure identity and texture is never flattened by a LUT.
    luts = {"_note": r5["luts"]["_note"] + " r6: every LUT lists all 64 colours explicitly; new colours "
            "follow the nearest existing colour of the same ramp (identity when that colour is unmapped)."}
    for key in ("R4", "R3", "R2", "R1", "NIGHT", "DIM"):
        src = r5["luts"].get(key, {})
        out = {}
        for n in names:
            if n in existing:
                out[n] = src.get(n, n)
                continue
            # nearest existing colour of the same ramp, unless it is far in value (over 25 L*); a ramp with
            # no such member (rain, the cool glass steps) uses the nearest existing colour overall
            members = [m for m in RAMPS[ramp_of(n)] if m in existing and abs(L[m] - L[n]) <= 25]
            if not members:
                members = [m for m in existing if dist(m, n) <= 15]
            if not members:
                out[n] = darker[n] if key == "DIM" else n
                continue
            e = min(members, key=lambda m: dist(m, n))
            t = src[e] if e in src else n
            # DIM and NIGHT never brighten a colour (a cool glass step following SLATE_2 would)
            if key in ("DIM", "NIGHT") and L[t] > L[n] + 1:
                t = darker[n] if key == "DIM" else n
            out[n] = t
        luts[key] = out

    pal = {
        "_note": "FORGE room palette, art pass 6: 64 colours (0..36 = art pass 5, unchanged; 37..63 new, "
                 "TEXTURE_SPEC section 3), index 255 = transparent. ramps: material ramps darkest to lightest "
                 "(the first twelve are the spec's; the rest are accent ramps). ramp_of: the ramp each colour "
                 "steps along. darker / brighter: one step down / up (engine DARKER in fx.js, BRIGHTER in "
                 "glow.js). Authored in art/room-r6/palette_sheet.py.",
        "colors": colors,
        "categories": r5["categories"],
        "luts": luts,
        "ramps": RAMPS,
        "texture_ramps": TEXTURE_RAMPS,
        "ramp_of": {n: ramp_of(n) for n in names},
        "darker": darker,
        "brighter": brighter,
        "new": [n for n, _, _ in NEW],
    }
    return pal


def write_palette():
    pal = build_palette()
    with open(OUT_PALETTE, "w") as f:
        json.dump(pal, f, indent=1)
        f.write("\n")
    print("wrote", os.path.relpath(OUT_PALETTE, ROOT))
    return pal


# ---------------------------------------------------------------- sheets
def _font(size):
    for f in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def ramp_sheet(path=None):
    """Every ramp darkest to lightest; new colours (37..63) carry a dot and a NEW tag; hex and L* labels."""
    pal = json.load(open(OUT_PALETTE))
    hexes = dict(pal["colors"])
    new = set(pal["new"])
    S = 4                       # 4x
    cw, ch = 30 * S, 22 * S     # one swatch (in output px)
    lab_w = 120 * S // 2
    rows = list(pal["ramps"].items())
    W = lab_w + max(len(r) for _, r in rows) * (cw + 3 * S) + 12 * S
    H = 30 * S + len(rows) * (ch + 22 * S)
    im = Image.new("RGB", (W, H), (24, 22, 26))
    d = ImageDraw.Draw(im)
    f1, f2 = _font(9 * S // 2 + 2), _font(7 * S // 2 + 1)
    d.text((8 * S, 6 * S), "FORGE palette, art pass 6: ramps darkest to lightest. Dot + NEW = proposed colour "
           "(indices 37..63); others unchanged from art pass 5.", fill=(230, 220, 200), font=f1)
    y = 24 * S
    for name, members in rows:
        tag = "" if name in pal["texture_ramps"] else "  (accent)"
        d.text((8 * S, y + ch // 2 - 6 * S), name + tag, fill=(230, 220, 200), font=f1)
        x = lab_w
        for n in members:
            h = hexes[n]
            d.rectangle([x, y, x + cw - 1, y + ch - 1], fill=hex_rgb(h))
            if n in new:
                d.ellipse([x + 3 * S, y + 3 * S, x + 7 * S, y + 7 * S], fill=(255, 255, 255), outline=(0, 0, 0))
            L = lab(h)[0]
            tc = (0, 0, 0) if L > 55 else (240, 240, 240)
            d.text((x + 2 * S, y + ch - 9 * S), f"L{L:.0f}", fill=tc, font=f2)
            d.text((x, y + ch + 2 * S), n + (" NEW" if n in new else ""), fill=(255, 210, 120) if n in new
                   else (200, 200, 200), font=f2)
            d.text((x, y + ch + 10 * S), h.upper(), fill=(170, 170, 170), font=f2)
            x += cw + 3 * S
        y += ch + 22 * S
    path = path or os.path.join(STILLS, "palette-ramps@4x.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print("wrote", os.path.relpath(path, ROOT))


# swatches: (label, material, kind, name, base colour, painter) on a 64 x 64 flat surface, 20 px per foot
def _sw_specs():
    def rect(a, x0, y0, x1, y1, c):
        a[y0:y1, x0:x1] = c
    yy, xx = np.mgrid[0:64, 0:64]

    def disc(cx, cy, rx, ry):
        return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1
    sp = []
    sp.append(("plaster T1", "plaster", 1, "wall-front", "PLASTER", None))
    sp.append(("plaster_venetian T5", "plaster", 1, "wall-front", "PLASTER", "t5"))
    sp.append(("wood_floor T1", "wood_floor", 2, "floor", "OAK_0", None))
    sp.append(("wood_floor T5", "wood_floor", 2, "floor", "OAK_0", "t5"))

    def drawer(a, m, N, M):
        a[:] = N["OAK_1"]
        a[:12] = N["OAK_2"]
        m[:] = M["wood_furniture"]
        a[34:37, 26:38] = N["SLATE_1"]
        m[34:37, 26:38] = M["metal_brushed"]
    sp.append(("wood_furniture", "custom", 4, "drawer", None, drawer))

    def ceil(a, m, N, M):
        a[:] = N["INK"]
        m[:] = M["wood_ceiling"]
    sp.append(("wood_ceiling", "custom", 3, "ceiling", None, ceil))
    sp.append(("fabric_cotton curtain", "fabric_cotton", 7, "curtain", "PLUM_2", None))
    sp.append(("fabric_velvet curtain T4", "fabric_cotton", 7, "curtain", "PLUM_2", "t4"))
    sp.append(("fabric_cotton quilt", "fabric_cotton", 6, "quilt", "PLUM_3", None))
    sp.append(("linen sheet", "fabric_cotton", 6, "sheet", "LINEN_1", None))

    def pillow(a, m, N, M):
        d = disc(32, 32, 28, 18)
        a[d] = N["LINEN_1"]
        m[d] = M["fabric_cotton"]
    sp.append(("linen pillow", "custom", 7, "pillow", None, pillow))

    def tapestry(a, m, N, M):
        a[:] = N["TERRA_0"]
        m[:] = M["fabric_cotton"]
        a[24:30, 18:46] = N["GOLD"]
        a[30:40, 28:36] = N["GOLD"]
    sp.append(("tapestry", "custom", 7, "tapestry", None, tapestry))

    def rug(a, m, N, M):
        a[:] = N["TERRA_1"]
        m[:] = M["rug_pile"]
        dd = (np.abs(xx - 32) + np.abs(yy - 32) * 1.6) < 9
        a[dd] = N["GOLD"]
    sp.append(("rug_pile", "custom", 6, "rug", None, rug))

    def paper(a, m, N, M):
        a[8:56, 12:52] = N["PAPER"]
        m[8:56, 12:52] = M["paper"]
        a[18:20, 18:46] = N["INK"]
        a[24:26, 18:40] = N["INK"]
    sp.append(("paper note", "custom", 7, "note", None, paper))

    def poster(a, m, N, M):
        a[6:58, 10:54] = N["SLATE_1"]
        a[30:58, 10:54] = N["LEAF_2"]
        a[14:24, 34:44] = N["SUN"]
        m[6:58, 10:54] = M["paper"]
    sp.append(("paper poster", "custom", 7, "poster", None, poster))
    sp.append(("cork", "cork", 7, "corkboard", "OAK_1", None))

    def fridge(a, m, N, M):
        a[2:62, 8:56] = N["SLATE_1"]
        m[2:62, 8:56] = M["metal_painted"]
    sp.append(("metal_painted", "custom", 4, "fridge", None, fridge))

    def brushed(a, m, N, M):
        a[16:48, 4:60] = N["SLATE_1"]
        m[16:48, 4:60] = M["metal_brushed"]
    sp.append(("metal_brushed", "custom", 4, "rack", None, brushed))

    def chrome(a, m, N, M):
        a[26:36, 2:62] = N["SLATE_1"]
        a[4:60, 28:36] = N["SLATE_1"]
        m[26:36, 2:62] = M["chrome"]
        m[4:60, 28:36] = M["chrome"]
    sp.append(("chrome", "custom", 4, "barbell", None, chrome))

    def iron(a, m, N, M):
        d = disc(32, 38, 20, 20)
        a[d] = N["SLATE_0"]
        m[d] = M["cast_iron"]
        a[10:20, 24:40] = N["SLATE_0"]
        m[10:20, 24:40] = M["cast_iron"]
    sp.append(("cast_iron", "custom", 4, "kettlebell", None, iron))

    def gold(a, m, N, M):
        d = disc(32, 32, 22, 22) & ~disc(32, 32, 12, 12)
        a[d] = N["GOLD"]
        m[d] = M["gold_metal"]
        a[50:60, 8:56] = N["GOLD"]
        m[50:60, 8:56] = M["gold_metal"]
    sp.append(("gold_metal", "custom", 4, "medal", None, gold))
    sp.append(("stone", "stone", 4, "pedestal", "BROWN_1", None))

    def window(a, m, N, M):
        for y0, c in ((0, "PLUM_2"), (18, "TERRA_2"), (30, "RIM"), (40, "LEAF_1")):
            a[y0:, :] = N[c]
        m[:] = M["glass_window"]
        a[:, 31:33] = N["OAK_DK"]
        m[:, 31:33] = M["wood_furniture"]
    sp.append(("glass_window", "custom", 7, "window", None, window))

    def crt(a, m, N, M):
        a[6:58, 4:60] = N["CRT_0"]
        m[6:58, 4:60] = M["glass_crt"]
        a[24:40, 16:48] = N["CRT_1"]
    sp.append(("glass_crt", "custom", 4, "crt", None, crt))

    def plastic(a, m, N, M):
        a[20:44, 6:58] = N["SLATE_0"]
        m[20:44, 6:58] = M["plastic"]
        a[28:32, 14:22] = N["INK"]
    sp.append(("plastic", "custom", 4, "controller", None, plastic))

    def plant(a, m, N, M):
        rr = np.random.Generator(np.random.PCG64(5))
        for i in range(14):
            cx, cy = rr.uniform(10, 54), rr.uniform(8, 44)
            ang = rr.uniform(0, np.pi)
            u = (xx - cx) * np.cos(ang) + (yy - cy) * np.sin(ang)
            v = -(xx - cx) * np.sin(ang) + (yy - cy) * np.cos(ang)
            d = (u / 9) ** 2 + (v / 3.5) ** 2 < 1
            a[d] = N["LEAF_2"] if i % 3 else N["LEAF_1"]
            m[d] = M["leaf"]
        p_ = (yy > 46) & (np.abs(xx - 32) < 14 - (yy - 46) * 0.3)
        a[p_] = N["TERRA_1"]
        m[p_] = M["terracotta"]
        s_ = (yy >= 44) & (yy <= 46) & (np.abs(xx - 32) < 13)
        a[s_] = N["OAK_DK"]
        m[s_] = M["soil"]
    sp.append(("leaf + soil + terracotta", "custom", 7, "plant", None, plant))

    def mug(a, m, N, M):
        a[16:56, 14:44] = N["CREAM"]
        m[16:56, 14:44] = M["ceramic"]
        a[24:44, 44:52] = N["CREAM"]
        a[28:40, 44:48] = 255
        m[24:44, 44:52] = M["ceramic"]
        m[28:40, 44:48] = 0
    sp.append(("ceramic", "custom", 4, "mug", None, mug))

    def books(a, m, N, M):
        x = 2
        rr = np.random.Generator(np.random.PCG64(7))
        cols = ["TERRA_1", "SLATE_1", "LEAF_2", "OAK_1", "GOLD_DK", "PLUM_2", "NAVY", "TERRA_0"]
        k = 0
        while x < 60:
            w = int(rr.integers(4, 8))
            top = int(rr.integers(8, 16))
            a[top:62, x:x + w] = N[cols[k % len(cols)]]
            m[top:62, x:x + w] = M["book_cloth"]
            x += w
            k += 1
    sp.append(("book_cloth", "custom", 4, "books", None, books))
    return sp


def swatch_sheet(path=None):
    """Each material as a 64 x 64 swatch textured by textures.apply() on a synthetic flat surface (20 px per
    foot, face-on), at 4 light levels (albedo x 0.35, 0.6, 0.85, 1.1 in linear light, preview only)."""
    sys.path.insert(0, HERE)
    import textures as tx
    Nn, M = tx.N, tx.MAT_ID
    S = 4
    levels = (0.35, 0.6, 0.85, 1.1)
    specs = _sw_specs()
    cols = 3
    cell_w = (4 * 64 + 3 * 4) * S + 24 * S
    cell_h = (64 + 16) * S
    rows_n = (len(specs) + cols - 1) // cols
    out = Image.new("RGB", (cols * cell_w + 16 * S, rows_n * cell_h + 26 * S), (24, 22, 26))
    d = ImageDraw.Draw(out)
    f1 = _font(8 * S // 2 + 3)
    d.text((8 * S, 6 * S), "FORGE materials, art pass 6: textures.apply() on flat 64x64 swatches (20 px/ft), "
           "albedo x 0.35 / 0.6 / 0.85 / 1.1 (linear, preview only)", fill=(230, 220, 200), font=f1)
    yy, xx = np.mgrid[0:64, 0:64].astype(np.float64)
    for i, (label, mat, kind, name, base, painter) in enumerate(specs):
        a = np.full((64, 64), 255, np.uint8)
        m = np.zeros((64, 64), np.uint8)
        tier = 1
        if painter in ("t4", "t5"):
            tier = int(painter[1])
            painter = None
        if painter is None:
            a[:] = Nn[base]
            m[:] = M[mat]
        else:
            painter(a, m, Nn, M)
        m[a == 255] = 0
        oid = np.where(a != 255, 10, 0).astype(np.int16)
        ft = 1 / 20
        if kind == 1:
            u, v = xx * ft + 2.0, (63 - yy) * ft + 2.2       # a wall patch from 2.2 ft up (scuff band)
        elif kind in (2, 3):
            u, v = xx * ft + 1.0, (63 - yy) * ft + 3.0
        else:
            u, v = xx * ft, (63 - yy) * ft
        if kind in (1, 2, 3):
            oid[:] = np.where(a != 255, {1: 1, 2: 4, 3: 5}[kind], 0)
        surf = {"kind": np.where(a != 255, kind, 0).astype(np.uint8), "u": u, "v": v, "dist": np.full((64, 64), 14.0)}
        if name == "ceiling":
            beam = (xx >= 26) & (xx < 38)
            a[beam] = Nn["OAK_DK"]
            surf["kind"][beam] = 4
            surf["u"] = np.where(beam, (63 - yy) * ft, u)
            surf["v"] = np.where(beam, xx * ft, v)
        names = {1: "wall-front", 4: "floor", 5: "ceiling", 10: name}
        tx.apply(a, m, surf, oid, names, None, "front", tier, 0, {"window_px": (0, 0)})
        rgb = np.zeros((64, 64, 3))
        ok = a < 64
        rgb[ok] = tx.RGB[a[ok]] / 255.0
        lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        cx0 = 8 * S + (i % cols) * cell_w
        cy0 = 22 * S + (i // cols) * cell_h
        d.text((cx0, cy0), label, fill=(230, 220, 200), font=f1)
        for j, k in enumerate(levels):
            l2 = np.clip(lin * k, 0, 1)
            s2 = np.where(l2 <= 0.0031308, l2 * 12.92, 1.055 * l2 ** (1 / 2.4) - 0.055)
            img = (np.clip(s2, 0, 1) * 255).astype(np.uint8)
            img[~ok] = (12, 10, 12)
            tile = Image.fromarray(img).resize((64 * S, 64 * S), Image.NEAREST)
            out.paste(tile, (cx0 + j * (64 + 4) * S, cy0 + 12 * S))
    path = path or os.path.join(STILLS, "swatches@4x.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    print("wrote", os.path.relpath(path, ROOT))


def main():
    write_palette()
    if "--write-palette" in sys.argv:
        return
    ramp_sheet()
    swatch_sheet()


if __name__ == "__main__":
    main()
