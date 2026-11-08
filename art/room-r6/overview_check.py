#!/usr/bin/env python3
"""FORGE room v3.5: the overview gate (D2-FINAL 2.3, PLAN 3.6 step 2, amendment A10).

merge.py runs it with run(items, zones) -> errors (every art/<src>/*_check.py). Checks:
  - zones.views.top is complete (art, core, lighting, light, anchors for every wall and zone, territory)
  - every room hotspot has exactly one `of` twin (top.<id>, kind hotspot, view top); no top.* item has target/label;
    every twin carries the room item's variant keys, a hit box of at least MIN_HIT art px, a wire
  - M4 coverage: every twin has real pixels (no hotspot falls back to an empty or footprint-only sprite)
  - palette and alpha of every top.* sprite (64 colours, binary alpha)
  - A10: the texture gate's noise limits and hotspot silhouette rule on the top view (texture_check.gate; the
    richness floors apply to the front view only, as for the room's side views)
  - budget: the overview adds <= 350 KB to art-v3.js (images encoded the way merge.py stores them)
CLI: python3 art/room-r6/overview_check.py  (reads art/room-r6/manifest.json and zones.json)
"""
import base64
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PROTO = os.path.join(ROOT, "docs", "redesign", "room-prototype")
VIEWS = ("front", "right", "back", "left")
MIN_HIT = 11            # art px; overlay.js grows every overview target to 44 CSS, the phone uses nearest centre (A3)
MIN_PX = 12             # a twin with fewer opaque pixels than this is not a miniature
BUDGET = 350 * 1024


def _rgb_map():
    pal = json.load(open(os.path.join(HERE, "palette.json")))["colors"]
    return {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, (_, h, *_r) in enumerate(pal)}


def _encoded_size(path, rgb):
    """Bytes the image takes in art-v3.js (merge.py's RLE + base64 + its material map), JSON-wrapped."""
    im = np.array(Image.open(path).convert("RGBA"))
    idx = np.full(im.shape[:2], 255, np.int32)
    op = im[..., 3] > 0
    for (r, g, b), n in rgb.items():
        idx[op & (im[..., 0] == r) & (im[..., 1] == g) & (im[..., 2] == b)] = n

    def rle(v):
        out = bytearray()
        i = 0
        v = v.ravel().tolist()
        while i < len(v):
            j = i
            while j < len(v) and v[j] == v[i] and j - i < 255:
                j += 1
            out += bytes((j - i, v[i] & 255))
            i = j
        return len(base64.b64encode(bytes(out)))
    n = rle(idx) + 40
    mp = path[:-4] + ".mat.png"
    if os.path.exists(mp):
        n += rle(np.array(Image.open(mp).convert("L")))
    return n


def run(items, zones, proto=PROTO, verbose=True):
    errs = []
    top = (zones.get("views") or {}).get("top")
    if not top:
        return ["zones.views.top missing (art/room-r6/overview.py did not run)"]
    for k in ("art", "core", "lighting", "light", "anchors", "territory"):
        if k not in top:
            errs.append(f"views.top.{k} missing")
    lt = top.get("lighting", {})
    for k in ("ambient", "key", "lights", "noRim"):
        if k not in lt:
            errs.append(f"views.top.lighting.{k} missing")
    if "top.*" not in lt.get("noRim", []):
        errs.append("views.top.lighting.noRim must hold 'top.*'")
    anchors = top.get("anchors", {})
    for v in VIEWS:
        if v not in anchors:
            errs.append(f"views.top.anchors.{v} missing")
    for z in zones.get("zones", []):
        if z["id"] not in anchors:
            errs.append(f"views.top.anchors.{z['id']} missing")
    core = top.get("core", [0, 0, 360, 300])
    for k, a in anchors.items():
        if a[2] <= 0 or a[3] <= 0 or a[0] < -2 or a[1] < -8 or a[0] + a[2] > core[2] + 2 or a[1] + a[3] > core[3] + 2:
            errs.append(f"anchor {k} {a} outside the core {core}")
    if "top" in [v for v in zones.get("camera", {}).get("views", [])]:
        errs.append("zones.camera.views must not list 'top' (ROOM.VIEWS stays 4)")

    room_hs = [i for i in items if i.get("kind") == "hotspot" and i.get("view") in VIEWS and not i.get("of")]
    tops = [i for i in items if i.get("view") == "top"]
    twins = {}
    for t in tops:
        if not (t["id"].startswith("top.") or t["id"].startswith("shell.top")):
            errs.append(f"{t['id']}: a top-view item must be named top.* or shell.top*")
        if "target" in t or "label" in t:
            errs.append(f"{t['id']}: top.* items carry no target/label (the twin's room item does)")
        if t.get("kind") == "hotspot":
            if not t.get("of"):
                errs.append(f"{t['id']}: hotspot twin without `of`")
            twins.setdefault(t.get("of"), []).append(t)
    for h in room_hs:
        tw = twins.get(h["id"], [])
        if len(tw) != 1:
            errs.append(f"{h['id']}: {len(tw)} overview twins (want exactly 1)")
            continue
        t = tw[0]
        if t["id"] != "top." + h["id"]:
            errs.append(f"{t['id']}: twin of {h['id']} must be top.{h['id']}")
        miss = sorted(set(h["variants"]) - set(t["variants"]))
        if miss:
            errs.append(f"{t['id']}: variant keys {miss} of its room twin are missing")
        hit = t.get("hit")
        if not hit or hit[2] < MIN_HIT or hit[3] < MIN_HIT:
            errs.append(f"{t['id']}: hit {hit} smaller than {MIN_HIT} art px")
        if not t.get("wire") or "base" not in t["wire"]:
            errs.append(f"{t['id']}: no wire")
    for o in twins:
        if o not in {h["id"] for h in room_hs}:
            errs.append(f"top twin of unknown room item {o}")

    rgb = _rgb_map()
    size = 0
    seen = set()
    for t in tops:
        for k, p in t["variants"].items():
            if p in seen:
                continue
            seen.add(p)
            fp = os.path.join(proto, p)
            if not os.path.exists(fp):
                errs.append(f"{t['id']}: missing image {p}")
                continue
            im = np.array(Image.open(fp).convert("RGBA"))
            a = im[..., 3]
            if ((a != 0) & (a != 255)).any():
                errs.append(f"{p}: semi-transparent pixels")
            op = a == 255
            cols = {tuple(int(v) for v in c) for c in im[op][:, :3]}
            off = [c for c in cols if c not in rgb]
            if off:
                errs.append(f"{p}: {len(off)} off-palette colours")
            if t.get("kind") == "hotspot" and op.sum() < MIN_PX:
                errs.append(f"{t['id']}.{k}: only {int(op.sum())} px (M4: every hotspot gets a real miniature)")
            size += _encoded_size(fp, rgb)
        if t.get("wire"):
            size += len(json.dumps(t["wire"], separators=(",", ":")))
    if size > BUDGET:
        errs.append(f"overview adds {size / 1024:.0f} KB > {BUDGET // 1024} KB")

    # A10: the texture and outline rules of texture_check.py, on the top view (richness floors included)
    try:
        sys.path.insert(0, HERE)
        import texture_check
        pal = json.load(open(os.path.join(HERE, "palette.json")))
        imgs = {p: None for t in tops for p in t["variants"].values()}
        # the room's side views get the noise limits and the silhouette rule (richness floors: front view only)
        e, rep = texture_check.gate(proto, tops, imgs, pal, front_views=())
        errs += [f"texture (top): {x}" for x in e]
    except ImportError:
        errs.append("texture_check.py not importable")
    if verbose:
        print(f"overview_check: {len(tops)} top items, {len(twins)} twins, {size / 1024:.0f} KB, {len(errs)} problems")
    return errs


if __name__ == "__main__":
    items = json.load(open(os.path.join(HERE, "manifest.json")))["items"]
    zones = json.load(open(os.path.join(HERE, "zones.json")))
    e = run(items, zones)
    print("\n".join(e) or "ok")
    sys.exit(1 if e else 0)
