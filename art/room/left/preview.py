#!/usr/bin/env python3
"""See / critique / fix previews for part "left" (kitchen + bed on the left wall).

Composites the shell plus this part's items on the 800x480 world canvas the way the engine draws them
(layer, shell first, contact y = y + image height, manifest order) and saves, in this folder:
  preview.png          full art at 2x: hotspots at stage s1, room tier 3, no alert
  preview-crop4x.png   4x crop of the left territory (world x -80..200, y 30..250)
  preview-s0.png / preview-s2.png   4x crops with every hotspot at s0 / s2 (s2 also with the doormat alert)
  preview-t1.png / preview-t5.png   4x crops at room tier 1 / tier 5
Also prints: pixels of each item that a later shell band would paint over (must be 0), the dark share of the
left territory, and the hotspot boxes.

Run: python3 art/room/left/preview.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROTO = ROOT / "docs" / "redesign" / "room-prototype"
AX0, AY0, AW, AH = -80, -96, 800, 480
PAL = json.loads((ROOT / "art" / "room" / "common" / "palette.json").read_text())
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h, _ in PAL["colors"]}
DARK = {"VOID", "INK", "INK_COOL", "BROWN_0", "BROWN_1", "BROWN_2", "TERRA_0", "LEAF_0", "LEAF_1", "PLUM_0",
        "SLATE_0", "GOLD_DK"}
CROP = (-80, 30, 200, 250)


def load(part):
    mf = ROOT / "art" / "room" / part / "manifest.json"
    return json.loads(mf.read_text())["items"] if mf.exists() else []


def pick(it, stage, tier, alert):
    v = it["variants"]
    if alert and "alert" in v:
        return v["alert"]
    if f"s{stage}" in v:
        return v[f"s{stage}"]
    for t in range(tier, 0, -1):
        if f"t{t}" in v:
            return v[f"t{t}"]
    return v.get("base") or v.get("s1") or v.get("s0")


def compose(stage=1, tier=3, alert=False):
    items = [(it, n) for n, it in enumerate(load("shell") + load("left"))]
    canvas = Image.new("RGBA", (AW, AH), (12, 10, 12, 255))
    entries = []
    for it, order in items:
        path = pick(it, stage, tier, alert)
        if not path:
            continue
        im = Image.open(PROTO / path).convert("RGBA")
        shell = it["kind"] == "shell"
        entries.append((it["layer"], 0 if shell else 1, 0 if shell else it["y"] + im.height, order, it, im))
    entries.sort(key=lambda e: e[:4])
    for _, _, _, _, it, im in entries:
        canvas.alpha_composite(im, (it["x"] - AX0, it["y"] - AY0))
    return canvas


def band_check():
    """Opaque pixels of each left item that a shell band of a HIGHER layer covers (they would vanish)."""
    shells = [(it["layer"], it, Image.open(PROTO / it["variants"]["base"]).convert("RGBA"))
              for it in load("shell") if it["kind"] == "shell" and it["layer"] >= 2]
    bad = {}
    for it in load("left"):
        for key, path in it["variants"].items():
            im = Image.open(PROTO / path).convert("RGBA")
            a = im.load()
            n = 0
            for L, sit, sim in shells:
                if L <= it["layer"]:
                    continue
                sa = sim.load()
                for y in range(im.height):
                    for x in range(im.width):
                        if a[x, y][3]:
                            wx, wy = it["x"] + x - sit["x"], it["y"] + y - sit["y"]
                            if 0 <= wx < sim.width and 0 <= wy < sim.height and sa[wx, wy][3]:
                                n += 1
            if n:
                bad[f"{it['id']}:{key}"] = n
    return bad


def up(img, s):
    return img.resize((img.width * s, img.height * s), Image.NEAREST)


def crop(img, box=CROP):
    x0, y0, x1, y1 = box
    return img.crop((x0 - AX0, y0 - AY0, x1 - AX0, y1 - AY0))


def dark_share(img, box):
    c = crop(img, box).convert("RGB")
    px = list(c.getdata())
    return sum(1 for p in px if RGB2N.get(p) in DARK) / len(px)


def main():
    day = compose()
    up(day, 2).save(HERE / "preview.png")
    up(crop(day), 4).save(HERE / "preview-crop4x.png")
    up(crop(compose(stage=0)), 4).save(HERE / "preview-s0.png")
    up(crop(compose(stage=2, alert=True)), 4).save(HERE / "preview-s2.png")
    up(crop(compose(tier=1)), 4).save(HERE / "preview-t1.png")
    up(crop(compose(tier=5)), 4).save(HERE / "preview-t5.png")
    print("dark share, left territory (x -80..176, y 0..270):", f"{dark_share(day, (-80, 0, 176, 270)):.1%}")
    bad = band_check()
    print("band overlaps (must be empty):", bad or "none")
    for it in load("left"):
        if it["kind"] == "hotspot":
            print(f"  hotspot {it['id']:22s} layer {it['layer']} at ({it['x']},{it['y']}) led {it['led']} "
                  f"hit {it.get('hit')}")


if __name__ == "__main__":
    sys.exit(main())
