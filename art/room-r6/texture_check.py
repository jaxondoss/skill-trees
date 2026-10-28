#!/usr/bin/env python3
"""FORGE art pass 6: the texture gate (TEXTURE_SPEC section 9). Replaces merge.py's grain check for room-r6.

Two sides: TOO NOISY (per material class: isolated pixels, checkerboards, colours per 3x3 window) and TOO FLAT
(richness floors for the shell and for big objects: pair variation and ramp shades used), plus the base-shade
area split, hotspot silhouette contrast, palette and LUT completeness, determinism and the bundle size budget.

Definitions (per sprite, per material region = pixels of one material ID):
  iso     share of region pixels whose in-region 4-neighbours all differ from them
  chk     share of 2x2 windows (fully in the region) that are checkerboards (A = D, B = C, A != B)
  var     share of adjacent in-region pixel pairs that differ
  split   area share of the base shade (the mode), one ramp step away, two or more steps, and off-ramp
  max3x3  most distinct colours in any 3x3 window (region pixels only). The gate uses the share of windows
          over the class limit (at most MAX3_SHARE) so one seam crossing does not fail a 100k px floor;
          the raw maximum is reported too.

Use:
  errors = texture_check.run(proto_dir, image_paths)        (merge.py; prints the report)
  errors, report = texture_check.gate(proto_dir, manifest_items, images, palette)
    manifest_items  the manifest's items (id, kind, view, x, y, variants)
    images          {path: value}; value is a bundle entry {"w", "h", "rle", "mat"?}, or {"idx": array,
                    "mat": array}, or None (then <proto_dir>/<path> and its .mat.png sibling are read)
    palette         palette.json dict (64 colours, luts, darker, brighter)
    keyword args:   materials (materials.json dict), bundle_path (size budget), images2 (a second build's
                    images for the determinism check), front_views ({"front", "main"}: views the richness
                    floors apply to), r5_palette (dict, to check indices 0..36 are unchanged)
  CLI: python3 art/room-r6/texture_check.py [--src art/room-r6] [--proto docs/redesign/room-prototype]
                                            [--bundle path/to/art-v3.js]
"""
import argparse
import base64
import json
import os
import sys
import zlib

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# ---------------------------------------------------------------- thresholds
# Richness floors, calibrated in docs/redesign/room-r6/TEXTURE_NOTES.md (scripts/texture-metrics.py on the
# reference and the v3.3 shells). (var min, var max, min ramp shades with >= 1% of the region)
RICHNESS = {
    "wall": (0.06, 0.14, 4),       # v3.3 1.0..1.8%; spec 6..12%; ref quiet wall 33% lit (16 colours, 8 px grid)
    "floor": (0.15, 0.30, 5),      # v3.3 13.2%; spec 15..24%; ref tile floor 36% lit
    "ceiling": (0.08, 0.16, 4),    # v3.3 5.9%; spec 8..12%; kept the quietest shell surface
    "object": (0.08, 0.45, 4),     # solid-class objects, texture alone on the main material (see notes)
}
SURFACE_OF_MATERIAL = {"plaster": "wall", "plaster_venetian": "wall", "wood_floor": "floor",
                       "wood_ceiling": "ceiling"}
SPLIT_BASE = (0.55, 0.78)        # base shade share per material region (materials with "split": true)
MIN_REGION = 40                  # material regions smaller than this are not measured (LEDs, bulbs, glints)
MIN_NOISE = 100                  # share-based noise limits need a region this big (a few pixels of a 40 px region
                                 # swing the share by 5%+; the v3.3 grain check used 150)
MIN_RICH = 600
# drawn patterns: the noise limits measure texture, and a game board is a checkerboard by design
PATTERN_SPRITES = ("/library/chess.",)                   # richness floors and split apply to regions of 600 px or more
MIN_SHELL = 20000                # ... and for shell surfaces, to whole surfaces (a wall, the floor, the ceiling)
MAX3_SHARE = 0.003               # share of 3x3 windows allowed over the class's max3x3
HOTSPOT_STEPS = 2.0              # silhouette contrast in backdrop ramp steps (TEXTURE_SPEC 5.13)
HOTSPOT_FAIL_SHARE = 0.10        # share of a hotspot's silhouette allowed under 2 steps
SIZE_RAW = 3.0 * 1024 * 1024     # art-v3.js budget (TEXTURE_SPEC 8.2)
SIZE_BROTLI = 900 * 1024
LUT_KEYS = ("R1", "R2", "R3", "R4", "NIGHT", "DIM")


def load_json(path):
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------- metrics
def metrics(a, m=None, ramp=None, lstar=None):
    """Texture metrics of index image a over mask m (default: all non-255). ramp: list of palette indices
    (darkest to lightest) for the split; without it the split is by lightness rank of the colours used."""
    a = np.asarray(a)
    if m is None:
        m = a != 255
    m = np.asarray(m, bool)
    n = int(m.sum())
    out = {"n": n}
    if n == 0:
        return dict(out, iso=0.0, chk=0.0, var=0.0, max3x3=0, over3=0.0, split=(0, 0, 0, 0), shades=0, colors=0)
    H, W = a.shape
    ai = np.where(m, a.astype(np.int32), -1)
    p = np.pad(ai, 1, constant_values=-1)
    same = np.zeros((H, W), bool)
    has = np.zeros((H, W), bool)
    for dy, dx in ((0, 1), (2, 1), (1, 0), (1, 2)):
        nb = p[dy:dy + H, dx:dx + W]
        has |= nb >= 0
        same |= nb == ai
    iso = m & has & ~same
    out["iso"] = float(iso.sum()) / n
    A, B, C, D = ai[:-1, :-1], ai[:-1, 1:], ai[1:, :-1], ai[1:, 1:]
    full = (A >= 0) & (B >= 0) & (C >= 0) & (D >= 0)
    chk = full & (A == D) & (B == C) & (A != B)
    out["chk"] = float(chk.sum()) / max(1, int(full.sum()))
    ph = (ai[:, 1:] >= 0) & (ai[:, :-1] >= 0)
    pv = (ai[1:, :] >= 0) & (ai[:-1, :] >= 0)
    dif = int((ph & (ai[:, 1:] != ai[:, :-1])).sum() + (pv & (ai[1:, :] != ai[:-1, :])).sum())
    out["var"] = dif / max(1, int(ph.sum() + pv.sum()))
    st = np.stack([p[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)])
    st = np.sort(st, axis=0)
    distinct = ((st[1:] != st[:-1]) & (st[1:] >= 0)).sum(0) + (st[0] >= 0)
    d = distinct[m]
    out["max3x3"] = int(d.max())
    out["d3"] = d
    vals = a[m].astype(np.int64)
    cnt = np.bincount(vals, minlength=256)
    base = int(cnt.argmax())
    out["base"] = base
    out["colors"] = int((cnt > 0).sum())
    if ramp and base in ramp:
        pos = {c: i for i, c in enumerate(ramp)}
        b = pos[base]
        s0 = s1 = s2 = so = 0
        for c in np.nonzero(cnt)[0]:
            k = cnt[c]
            if c not in pos:
                so += k
            elif pos[c] == b:
                s0 += k
            elif abs(pos[c] - b) == 1:
                s1 += k
            else:
                s2 += k
        out["split"] = (s0 / n, s1 / n, s2 / n, so / n)
        out["shades"] = int(sum(1 for c in ramp if cnt[c] >= 0.01 * n))
    else:
        used = [c for c in np.nonzero(cnt)[0] if cnt[c] >= 0.005 * n]
        if lstar is not None:
            used.sort(key=lambda c: lstar[c])
        else:
            used.sort()
        b = used.index(base) if base in used else 0
        s0 = cnt[base] / n
        s1 = sum(cnt[c] for i, c in enumerate(used) if abs(i - b) == 1) / n
        s2 = 1 - s0 - s1
        out["split"] = (s0, s1, s2, 0.0)
        out["shades"] = int(sum(1 for c in used if cnt[c] >= 0.01 * n))
    return out


# ---------------------------------------------------------------- image decoding
def decode_rle(entry_rle, w, h):
    raw = base64.b64decode(entry_rle)
    out = np.empty(w * h, np.uint8)
    i = 0
    for k in range(0, len(raw), 2):
        nrun, v = raw[k], raw[k + 1]
        out[i:i + nrun] = v
        i += nrun
    return out.reshape(h, w)


def png_to_index(path, rgb_map):
    im = np.array(Image.open(path).convert("RGBA"))
    a = im[..., 3]
    key = (im[..., 0].astype(np.int32) << 16) | (im[..., 1].astype(np.int32) << 8) | im[..., 2]
    out = np.full(a.shape, 255, np.uint8)
    bad = np.zeros(a.shape, bool)
    for k in np.unique(key[a == 255]):
        sel = (key == k) & (a == 255)
        if int(k) in rgb_map:
            out[sel] = rgb_map[int(k)]
        else:
            bad |= sel
    semi = (a != 0) & (a != 255)
    return out, int(bad.sum()), int(semi.sum())


def load_image(path, value, proto_dir, rgb_map):
    """-> (idx, mat or None, errors)"""
    errs = []
    if isinstance(value, dict) and "idx" in value:
        return np.asarray(value["idx"]), (None if value.get("mat") is None else np.asarray(value["mat"])), errs
    if isinstance(value, dict) and "rle" in value:
        idx = decode_rle(value["rle"], value["w"], value["h"])
        mat = decode_rle(value["mat"], value["w"], value["h"]) if value.get("mat") else None
    else:
        idx = None
        mat = None
    fp = os.path.join(proto_dir, path)
    if idx is None:
        if not os.path.exists(fp):
            return None, None, [f"{path}: image missing"]
        idx, nbad, nsemi = png_to_index(fp, rgb_map)
        if nbad:
            errs.append(f"{path}: {nbad} off-palette pixels")
        if nsemi:
            errs.append(f"{path}: {nsemi} semi-transparent pixels")
    if mat is None:
        mp = fp[:-4] + ".mat.png" if fp.endswith(".png") else fp + ".mat.png"
        if os.path.exists(mp):
            mat = np.array(Image.open(mp))
            if mat.ndim == 3:
                mat = mat[..., 0]
    return idx, mat, errs


# ---------------------------------------------------------------- checks
def check_palette(palette, r5_palette=None):
    errs = []
    cols = palette.get("colors", [])
    names = [c[0] for c in cols]
    if len(cols) != 64:
        errs.append(f"palette: {len(cols)} colours (want 64)")
    if len(set(names)) != len(names):
        errs.append("palette: duplicate colour names")
    if r5_palette:
        for i, (n, h) in enumerate(r5_palette["colors"][:37]):
            if i >= len(cols) or cols[i][0] != n or cols[i][1].upper() != h.upper():
                errs.append(f"palette: index {i} changed ({n} {h})")
    ns = set(names)
    for key in LUT_KEYS:
        lut = palette.get("luts", {}).get(key)
        if lut is None:
            errs.append(f"palette: LUT {key} missing")
            continue
        miss = [n for n in names if n not in lut]
        badt = [n for n in names if n in lut and lut[n] not in ns]
        if miss:
            errs.append(f"palette: LUT {key} does not map {len(miss)} colours ({', '.join(miss[:5])})")
        if badt:
            errs.append(f"palette: LUT {key} maps to unknown colours ({', '.join(badt[:5])})")
    for key in ("darker", "brighter"):
        t = palette.get(key, {})
        miss = [n for n in names if n not in t or t[n] not in ns]
        if miss:
            errs.append(f"palette: {key} table incomplete ({', '.join(miss[:5])})")
    return errs


def region_report(path, idx, mat, materials, item_kind, view, front_views, lstar):
    """Noise limits, richness floors and split for every material region of one sprite."""
    errs, rows = [], []
    mats = {m["id"]: m for m in materials["materials"]}
    classes = materials["classes"]
    ramps = materials.get("_ramps", {})
    op = idx != 255
    if mat is None:
        if int(op.sum()) >= MIN_REGION:
            errs.append(f"{path}: no material map (.mat.png / bundle 'mat')")
        return errs, rows
    if mat.shape != idx.shape:
        return [f"{path}: material map size {mat.shape} != image {idx.shape}"], rows
    if (op & (mat == 0)).sum() > 0.02 * max(1, op.sum()):
        errs.append(f"{path}: {int((op & (mat == 0)).sum())} opaque pixels without a material")
    if ((idx == 255) & (mat != 255) & (mat != 0)).any():
        errs.append(f"{path}: material on transparent pixels")
    if (op & (idx >= 64)).any():
        errs.append(f"{path}: indices outside the 64-colour palette")
    for mid in np.unique(mat[op]):
        if mid in (0, 255):
            continue
        md = mats.get(int(mid))
        if md is None:
            errs.append(f"{path}: unknown material id {mid}")
            continue
        rm = op & (mat == mid)
        n = int(rm.sum())
        if n < MIN_REGION:
            continue
        shell_mat = md["name"] in SURFACE_OF_MATERIAL
        if shell_mat:
            # a shell surface seen through a sprite's cut (animation frames, margins, objects' backdrops) is
            # judged on its interior: a lone pixel at the cut edge is the cut, not texture noise
            inner = rm.copy()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                sh = np.zeros_like(rm)
                H_, W_ = rm.shape
                sh[max(0, -dy):H_ - max(0, dy), max(0, -dx):W_ - max(0, dx)] = \
                    rm[max(0, dy):H_ - max(0, -dy), max(0, dx):W_ - max(0, -dx)]
                inner &= sh
            if int(inner.sum()) >= MIN_REGION:
                rm = inner
                n = int(rm.sum())
            elif item_kind != "shell":
                continue                     # only crumbs of wall between moving leaves: nothing to judge
            if item_kind != "shell":
                continue                     # the backdrop in an object sprite is the shell plate's own pixels
                                             # (sway frames copy them), gated there
        ramp = ramps.get(md["ramp"]) if md["ramp"] else None
        mt = metrics(idx, rm, ramp, lstar)
        cls = classes[md["class"]]
        row = dict(path=path, material=md["name"], cls=md["class"], **{k: v for k, v in mt.items() if k != "d3"})
        rows.append(row)
        tag = f"{path} [{md['name']}]"
        if cls["iso"] is not None and n >= MIN_NOISE and not any(k in path for k in PATTERN_SPRITES):
            over = float((mt["d3"] > cls["max3x3"]).mean())
            row["over3"] = over
            if mt["iso"] > cls["iso"]:
                errs.append(f"{tag}: isolated {mt['iso']:.1%} > {cls['iso']:.1%}")
            if mt["chk"] > cls["chk"]:
                errs.append(f"{tag}: checkerboard {mt['chk']:.1%} > {cls['chk']:.1%}")
            if over > MAX3_SHARE:
                errs.append(f"{tag}: {over:.2%} of 3x3 windows exceed {cls['max3x3']} colours (max {mt['max3x3']})")
        if n >= MIN_RICH and view in front_views:
            surf = SURFACE_OF_MATERIAL.get(md["name"]) if item_kind == "shell" else None
            if surf and path.endswith("-margin.base.png"):
                surf = None                  # a margin plate re-projects the neighbour views' walls (gated there)
            if surf and n < MIN_SHELL:
                surf = None                  # a strip of wall in a margin or frame: noise limits only
            # objects: solid-class materials only (paper, books and glint metals carry drawn art / glints,
            # glass and screens carry content)
            # a wall, floor or ceiling material inside an object sprite is the backdrop seen through the sprite's
            # cut (sway frames, close-ups); the whole surface is gated in its shell sprite, so noise limits only
            if surf is None and item_kind != "shell" and md["class"] == "solid" and not shell_mat:
                surf = "object"
            if surf:
                lo, hi, shades = RICHNESS[surf]
                if not lo <= mt["var"] <= hi:
                    errs.append(f"{tag}: variation {mt['var']:.1%} outside {surf} target {lo:.0%}..{hi:.0%}")
                # shell: shades of the material's ramp; objects: any colour with 1%+ of the region (an object
                # is drawn in several tones per face, not always on its material's default ramp)
                nsh = mt["shades"] if surf != "object" else int((np.bincount(idx[rm], minlength=256) >= 0.01 * n).sum())
                if (ramp or surf == "object") and nsh < shades:
                    errs.append(f"{tag}: uses {nsh} shades (want {shades}+)")
            # split: the main material of shell surfaces and solid objects (a baseboard or wainscot on a
            # shell sprite is structure: lip, gap line and panel lines, not a base-shade field)
            # (shell surfaces: whole surfaces only, MIN_SHELL px; a crop of a wall can sit inside one patch)
            # objects are reported but not gated on split: one object region spans faces drawn in different
            # tones (top, front, side), so its mode is not a single texture field's base shade
            main = surf is not None and surf != "object" and n >= MIN_SHELL
            if main and md.get("split") and ramp and mt["base"] in ramp:
                b = mt["split"][0]
                if not SPLIT_BASE[0] <= b <= SPLIT_BASE[1]:
                    errs.append(f"{tag}: base shade {b:.0%} outside {SPLIT_BASE[0]:.0%}..{SPLIT_BASE[1]:.0%}")
    return errs, rows


def check_hotspots(items, decoded, lstar, step_l, ink=1):
    """Every hotspot keeps 2 ramp steps of contrast to the shell behind it on its silhouette, or an INK edge
    (selout's fallback, TEXTURE_SPEC 5.13)."""
    errs, rows = [], []
    by_view = {}
    for it in items:
        by_view.setdefault(it.get("view", "main"), []).append(it)
    for view, its in by_view.items():
        shells = sorted([i for i in its if i.get("kind") == "shell"], key=lambda i: i.get("layer", 0))
        if not shells:
            continue
        x0 = min(i["x"] for i in its)
        y0 = min(i["y"] for i in its)
        x1 = max(i["x"] + i["w"] for i in its)
        y1 = max(i["y"] + i["h"] for i in its)
        canvas = np.full((y1 - y0, x1 - x0), 255, np.uint8)
        for sh in shells:
            p = _base_variant(sh)
            if p not in decoded or decoded[p][0] is None:
                continue
            a = decoded[p][0]
            sub = canvas[sh["y"] - y0:sh["y"] - y0 + a.shape[0], sh["x"] - x0:sh["x"] - x0 + a.shape[1]]
            if sub.shape == a.shape:
                sub[a != 255] = a[a != 255]
        for it in its:
            if it.get("kind") != "hotspot":
                continue
            p = _base_variant(it)
            if p not in decoded or decoded[p][0] is None:
                continue
            a = decoded[p][0]
            oy, ox = it["y"] - y0, it["x"] - x0
            bd = np.full(a.shape, 255, np.uint8)
            hh = min(a.shape[0], canvas.shape[0] - oy)
            ww = min(a.shape[1], canvas.shape[1] - ox)
            bd[:hh, :ww] = canvas[oy:oy + hh, ox:ox + ww]
            m = a != 255
            comp = np.where(m, a, bd)
            fail = 0
            sil = 0
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                sh_m = np.zeros_like(m)
                H, W = m.shape
                ys0, ys1 = max(0, -dy), min(H, H - dy)
                xs0, xs1 = max(0, -dx), min(W, W - dx)
                sh_m[ys0:ys1, xs0:xs1] = m[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
                e = m & ~sh_m
                bb = np.full(m.shape, 255, np.uint8)
                bb[ys0:ys1, xs0:xs1] = comp[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
                ok = e & (bb != 255)
                ys, xs = np.nonzero(ok)
                if len(ys):
                    st = np.abs(lstar[a[ys, xs]] - lstar[bb[ys, xs]]) / step_l[bb[ys, xs]]
                    # an INK edge is the 5.13 fallback itself: it passes even on the darkest walls
                    fail += int(((st < HOTSPOT_STEPS) & (a[ys, xs] != ink)).sum())
                    sil += len(ys)
            share = fail / sil if sil else 0.0
            rows.append(dict(id=it["id"], view=view, silhouette=sil, fail=share))
            if share > HOTSPOT_FAIL_SHARE:
                errs.append(f"{it['id']}: {share:.0%} of its silhouette is under {HOTSPOT_STEPS:.0f} ramp steps "
                            f"from the backdrop (max {HOTSPOT_FAIL_SHARE:.0%}); selout should fall back to INK")
    return errs, rows


def _base_variant(it):
    v = it.get("variants", {})
    for k in ("base", "t1", "s1", "g2"):
        if k in v:
            return v[k]
    for k, p in v.items():
        if "night" not in k:
            return p
    return None


def check_size(bundle_path):
    errs, info = [], ""
    if not bundle_path or not os.path.exists(bundle_path):
        return errs, "size: no bundle given"
    raw = open(bundle_path, "rb").read()
    info = f"size: {len(raw) / 1024:.0f} KB raw"
    if len(raw) > SIZE_RAW:
        errs.append(f"bundle {len(raw) / 1024:.0f} KB raw > {SIZE_RAW / 1024:.0f} KB")
    try:
        import brotli  # noqa: F401
        b = len(brotli.compress(raw, quality=11))
        info += f", {b / 1024:.0f} KB brotli"
        if b > SIZE_BROTLI:
            errs.append(f"bundle {b / 1024:.0f} KB brotli > {SIZE_BROTLI / 1024:.0f} KB")
    except ImportError:
        z = len(zlib.compress(raw, 9))
        info += f", {z / 1024:.0f} KB zlib-9 (brotli module missing: budget not enforced, brotli is ~15% smaller)"
    return errs, info


def run(proto_dir, image_paths=None, manifest_items=None, palette=None, verbose=True, **kw):
    """merge.py entry point: gate the given sprite paths (relative to proto_dir; None = every manifest sprite).
    Loads palette.json and manifest.json from art/room-r6 unless given. Prints the report, returns the errors."""
    if palette is None:
        palette = load_json(os.path.join(HERE, "palette.json"))
    if manifest_items is None:
        mp = os.path.join(HERE, "manifest.json")
        manifest_items = load_json(mp)["items"] if os.path.exists(mp) else []
    images = None if image_paths is None else {str(p): None for p in image_paths}
    errs, rep = gate(proto_dir, manifest_items, images, palette, **kw)
    if verbose:
        print(rep)
    return errs


def gate(proto_dir, manifest_items, images, palette, materials=None, bundle_path=None, images2=None,
         front_views=("front", "main"), r5_palette=None):
    """The gate. Returns (errors: list of str, report: str)."""
    if materials is None:
        materials = load_json(os.path.join(HERE, "materials.json"))
    if r5_palette is None:
        p5 = os.path.join(ROOT, "art", "room-r5", "palette.json")
        r5_palette = load_json(p5) if os.path.exists(p5) else None
    names = [c[0] for c in palette["colors"]]
    N = {n: i for i, n in enumerate(names)}
    materials = dict(materials)
    materials["_ramps"] = {k: [N[c] for c in v] for k, v in palette.get("ramps", {}).items()}
    rgb = {}
    lstar = np.full(256, 50.0)
    for i, (n, h) in enumerate(palette["colors"]):
        r, g, b = (int(h[k:k + 2], 16) for k in (1, 3, 5))
        rgb[(r << 16) | (g << 8) | b] = i
        c = np.array([r, g, b]) / 255
        c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
        y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        lstar[i] = 116 * y ** (1 / 3) - 16 if y > 0.008856 else 903.3 * y
    step_l = np.full(256, 6.0)
    for k in palette.get("texture_ramps", []):
        r = materials["_ramps"][k]
        g = float(np.abs(np.diff(lstar[r])).mean())
        for i in r:
            if step_l[i] == 6.0:
                step_l[i] = g
    errs = check_palette(palette, r5_palette)
    report = [f"texture gate: {len(names)} colours, {len(materials['materials'])} materials"]
    decoded = {}
    paths_view = {}
    for it in manifest_items:
        for k, p in it.get("variants", {}).items():
            if "night" in k:
                continue
            paths_view[p] = (it.get("kind", "decor"), it.get("view", "main"))
    for p in sorted(images if images else paths_view):
        if p not in paths_view and images and p in images:
            paths_view[p] = ("decor", "main")
    all_rows = []
    for p in sorted(paths_view):
        if images is not None and p not in images:
            continue
        if ".night." in p or p.endswith(".night.png"):
            continue                       # painted night twins are fallback art, not albedo
        val = images.get(p) if images else None
        idx, mat, e = load_image(p, val, proto_dir, rgb)
        errs += e
        decoded[p] = (idx, mat)
        if idx is None:
            continue
        kind, view = paths_view[p]
        e, rows = region_report(p, idx, mat, materials, kind, view, set(front_views), lstar)
        errs += e
        all_rows += rows
    e, hrows = check_hotspots(manifest_items, decoded, lstar, step_l, ink=N.get("INK", 1))
    errs += e
    if images2 is not None:
        for p in sorted(images2):
            a = load_image(p, images2[p], proto_dir, rgb)[:2]
            b = decoded.get(p)
            if b is None:
                b = load_image(p, images.get(p) if images else None, proto_dir, rgb)[:2]
            same = all((x is None and y is None) or (x is not None and y is not None and np.array_equal(x, y))
                       for x, y in zip(a, b))
            if not same:
                errs.append(f"{p}: not deterministic (two builds differ)")
        report.append(f"determinism: {len(images2)} images compared")
    e, info = check_size(bundle_path)
    errs += e
    report.append(info)
    report.append(f"{'sprite [material]':58s} {'n':>7s} {'iso':>6s} {'chk':>6s} {'var':>6s} {'3x3':>4s} "
                  f"{'>3x3':>6s} {'base':>5s} {'1st':>5s} {'2+':>5s} {'sh':>3s}")
    for r in all_rows:
        sp = r["split"]
        report.append(f"{(r['path'] + ' [' + r['material'] + ']')[-58:]:58s} {r['n']:7d} {r['iso']:6.1%} "
                      f"{r['chk']:6.1%} {r['var']:6.1%} {r['max3x3']:4d} {r.get('over3', 0):6.2%} {sp[0]:5.0%} "
                      f"{sp[1]:5.0%} {sp[2]:5.0%} {r['shades']:3d}")
    for r in hrows:
        report.append(f"hotspot {r['id']} ({r['view']}): {r['fail']:.0%} of {r['silhouette']} silhouette px "
                      f"under {HOTSPOT_STEPS:.0f} steps")
    report.append(f"{len(errs)} error(s)")
    return errs, "\n".join(report)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=os.path.join(ROOT, "art", "room-r6"))
    ap.add_argument("--proto", default=os.path.join(ROOT, "docs", "redesign", "room-prototype"))
    ap.add_argument("--bundle", default=None)
    args = ap.parse_args()
    man = load_json(os.path.join(args.src, "manifest.json"))
    pal = load_json(os.path.join(args.src, "palette.json"))
    errs, rep = gate(args.proto, man["items"], None, pal, bundle_path=args.bundle)
    print(rep)
    if errs:
        print("\n".join("  " + e for e in errs))
        sys.exit(1)


if __name__ == "__main__":
    main()
