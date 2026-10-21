#!/usr/bin/env python3
"""Parity check: the R3 art (art/room-r3/manifest.json + zones.json) against the live bundle it replaces.

Baseline: docs/redesign/room-prototype/art-v3.prev.js when present (the rollback copy), else art-v3.js.
Fails (exit 1) on: a missing item id; a changed hotspot target; a missing variant key; a hotspot without a
label or LED, or with its 3x3 LED outside its sprite; a tap area under 44 CSS px at phone zone zoom
(375x812 @3x: zone zoom 12 device px = 4 CSS px per world px, so at least 11 world px each way); a missing
zones.json key the engine reads.
Run: python3 art/room-r3/parity.py   (merge.py --src room-r3 runs it before swapping the bundle)
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROTO = HERE.parents[1] / "docs" / "redesign" / "room-prototype"

# Phone zone zoom, mirroring engine/camera.js (pan mode): s = max(floor(Hd/270), ceil(1.5 dpr)),
# zone z = clamp(floor(min(Wd / 88, Hd / focus_h)), s + 1, round(1.6 s)); CSS px per world px = z / dpr.
PHONE = (375, 812, 3)
FW_PHONE = 88


def css_per_world(focus_h):
    w, h, dpr = PHONE
    Wd, Hd = w * dpr, h * dpr
    s = max(Hd // 270, math.ceil(1.5 * dpr), 1)
    z = math.floor(min(Wd / FW_PHONE, Hd / focus_h))
    z = min(max(z, s + 1), round(1.6 * s))
    return z / dpr


def load_bundle(path: Path) -> dict:
    t = path.read_text()
    t = t[t.index("window.ROOM_ART = ") + len("window.ROOM_ART = "):].rstrip().rstrip(";")
    return json.loads(t)


def baseline_path() -> Path:
    prev = PROTO / "art-v3.prev.js"
    return prev if prev.exists() else PROTO / "art-v3.js"


ZONE_KEYS = ["core", "horizon", "vp", "camera", "zones", "shell", "centre", "relics", "layers", "skills"]
CENTRE_KEYS = ["statue", "statueContactY", "rug", "downlight", "dogSleep"]


def check(items: list, zones: dict, base: dict) -> list:
    errs = []
    new = {i["id"]: i for i in items}
    for b in base["items"]:
        n = new.get(b["id"])
        if not n:
            errs.append(f"missing id {b['id']}")
            continue
        if b.get("target") != n.get("target"):
            errs.append(f"{b['id']}: target {b.get('target')} -> {n.get('target')}")
        miss = set(b["variants"]) - set(n["variants"])
        if miss:
            errs.append(f"{b['id']}: missing variants {sorted(miss)}")
    zone_h = {z["id"]: z["focus"][3] for z in zones.get("zones", [])}
    for n in items:
        if n["kind"] != "hotspot":
            continue
        if not (n.get("target") and n.get("label") and n.get("led")):
            errs.append(f"{n['id']}: hotspot needs target, label and led")
            continue
        lx, ly = n["led"]
        if not (n["x"] <= lx <= n["x"] + n["w"] - 3 and n["y"] <= ly <= n["y"] + n["h"] - 3):
            errs.append(f"{n['id']}: LED {n['led']} outside its sprite {[n['x'], n['y'], n['w'], n['h']]}")
        hit = n.get("hit") or [n["x"], n["y"], n["w"], n["h"]]
        k = css_per_world(zone_h.get(n["zone"], 152))
        if min(hit[2], hit[3]) * k < 44:
            errs.append(f"{n['id']}: tap area {hit[2]}x{hit[3]} world px = {hit[2] * k:.0f}x{hit[3] * k:.0f} CSS px (< 44)")
    for k in ZONE_KEYS:
        if k not in zones:
            errs.append(f"zones.json: missing {k}")
    for k in CENTRE_KEYS:
        if k not in zones.get("centre", {}):
            errs.append(f"zones.json: missing centre.{k}")
    for z in zones.get("zones", []):
        for k in ("id", "n", "name", "focus", "stop", "phoneStop", "hotspots", "territory"):
            if k not in z:
                errs.append(f"zones.json zone {z.get('id')}: missing {k}")
    ids = {i["id"] for i in items}
    for slot, iid in zones.get("relics", {}).items():
        if iid not in ids:
            errs.append(f"zones.json relics.{slot}: unknown item {iid}")
    return errs


def run(items=None, zones=None) -> list:
    items = items if items is not None else json.loads((HERE / "manifest.json").read_text())["items"]
    zones = zones if zones is not None else json.loads((HERE / "zones.json").read_text())
    bp = baseline_path()
    base = load_bundle(bp)
    errs = check(items, zones, base)
    hs = [i for i in items if i["kind"] == "hotspot"]
    print(f"parity vs {bp.name}: {len(base['items'])} baseline ids, {len(items)} new items "
          f"({len(hs)} hotspots), {len(errs)} problems")
    return errs


if __name__ == "__main__":
    e = run()
    for x in e:
        print("  " + x)
    sys.exit(1 if e else 0)
