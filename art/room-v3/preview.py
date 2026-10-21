"""Composite preview of the v3 room from the part manifests (not shipped; for the see-critique-fix loop).

python3 art/room-v3/preview.py [--tier 3] [--stage s1] [--night] [--out path.png] [--scale 2] [--full]
"""
import argparse
import json
from pathlib import Path

from PIL import Image

V3 = Path(__file__).resolve().parent
PROTO = V3.parents[1] / "docs" / "redesign" / "room-prototype"


def pick(it, tier, stage, night, active=False):
    v = it["variants"]
    if it["kind"] == "overlay":
        return None
    if night and "night" in v:
        return v["night"]
    if it["kind"] == "hotspot" and stage in v:
        return v[stage]
    if active and "active" in v:
        return v["active"]
    for t in range(tier, 0, -1):
        if f"t{t}" in v:
            return v[f"t{t}"]
    return v.get("base")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=3)
    ap.add_argument("--stage", default="s1")
    ap.add_argument("--night", action="store_true")
    ap.add_argument("--active", action="store_true")
    ap.add_argument("--overlay", action="append", default=[])
    ap.add_argument("--out", default=str(V3 / "preview.png"))
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args()
    items = []
    for mf in sorted(V3.glob("*/manifest.json")):
        items += json.loads(mf.read_text())["items"]
    order = {id(it): k for k, it in enumerate(items)}
    items.sort(key=lambda it: (it["layer"], it.get("contact", it["y"] + it.get("h", 0)) if it["kind"] not in ("shell",) else -1, order[id(it)]))
    canvas = Image.new("RGBA", (800, 480), (12, 10, 12, 255))  # art frame x -80..720, y -96..384
    for it in items:
        p = pick(it, a.tier, a.stage, a.night, a.active)
        if it["kind"] == "overlay" and it["id"] in a.overlay:
            p = it["variants"].get("base") or next(iter(it["variants"].values()))
        if not p:
            continue
        im = Image.open(PROTO / p).convert("RGBA")
        canvas.alpha_composite(im, (it["x"] + 80, it["y"] + 96))
    if not a.full:
        canvas = canvas.crop((80, 96, 720, 366))
    canvas = canvas.resize((canvas.width * a.scale, canvas.height * a.scale), Image.NEAREST)
    canvas.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
