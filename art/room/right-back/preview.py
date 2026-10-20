#!/usr/bin/env python3
"""See / critique / fix previews for part "right-back" (zone study on the back wall, zone computer on the right wall).

Composites the shell plus every part's items on the 800x480 world canvas the way the engine draws them
(layer, shell plates first, contact y = y + image height, manifest order) and saves, in this folder:
  preview.png             full art at 2x: hotspots at s1, room tier 3, no alert
  preview-crop4x.png      4x crop of the territory (world x 370..546, y 40..222)
  preview-s0.png / -s2.png  4x crops with every right-back hotspot at s0 / s2 (s2 also with the backpack alert)
  preview-t1.png / -t5.png  4x crops at room tier 1 / tier 5
  preview-leds.png        4x crop at s1 with the hotspot LED sockets (full) drawn in, to check placement
Prints: pixels of each item a later shell band would paint over (must be 0), the dark share of the territory,
and the hotspot boxes.

Run: python3 art/room/right-back/preview.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROTO = ROOT / "docs" / "redesign" / "room-prototype"
PART = "right-back"
AX0, AY0, AW, AH = -80, -96, 800, 480
PAL = json.loads((ROOT / "art" / "room" / "common" / "palette.json").read_text())
HEXN = {n: h for n, h, _ in PAL["colors"]}
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h, _ in PAL["colors"]}
DARK = {"VOID", "INK", "INK_COOL", "BROWN_0", "BROWN_1", "BROWN_2", "TERRA_0", "LEAF_0", "LEAF_1", "PLUM_0",
        "SLATE_0", "GOLD_DK"}
CROP = (370, 40, 546, 222)


def load(part):
    mf = ROOT / "art" / "room" / part / "manifest.json"
    return json.loads(mf.read_text())["items"] if mf.exists() else []


def parts():
    return sorted(p.parent.name for p in (ROOT / "art" / "room").glob("*/manifest.json"))


def pick(it, stage, tier, alert, mine):
    v = it["variants"]
    st = stage if mine else 1
    if alert and mine and "alert" in v:
        return v["alert"]
    if f"s{st}" in v:
        return v[f"s{st}"]
    for t in range(tier, 0, -1):
        if f"t{t}" in v:
            return v[f"t{t}"]
    return v.get("base") or v.get("s1") or v.get("s0")


def compose(stage=1, tier=3, alert=False, only_mine=False, leds=False):
    items = []
    for part in parts():
        if only_mine and part not in ("shell", PART):
            continue
        for it in load(part):
            items.append((it, part == PART))
    canvas = Image.new("RGBA", (AW, AH), (12, 10, 12, 255))
    entries = []
    for order, (it, mine) in enumerate(items):
        path = pick(it, stage, tier, alert, mine)
        if not path:
            continue
        im = Image.open(PROTO / path).convert("RGBA")
        shell = it["kind"] == "shell"
        entries.append((it["layer"], 0 if shell else 1, 0 if shell else it["y"] + im.height, order, it, im, mine))
    entries.sort(key=lambda e: e[:4])
    sun = tuple(int(HEXN["SUN"][i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    for _, _, _, _, it, im, mine in entries:
        canvas.alpha_composite(im, (it["x"] - AX0, it["y"] - AY0))
        if leds and mine and it["kind"] == "hotspot":
            lx, ly = it["led"]
            for k in range(9):
                canvas.putpixel((lx + k % 3 - AX0, ly + k // 3 - AY0), sun)
    return canvas


def band_check():
    """Opaque pixels of each of my items that a shell band of a HIGHER layer covers (they would vanish)."""
    shells = [(it["layer"], it, Image.open(PROTO / it["variants"]["base"]).convert("RGBA"))
              for it in load("shell") if it["kind"] == "shell" and it["layer"] >= 2]
    bad = {}
    for it in load(PART):
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
    up(crop(compose(tier=5, stage=2)), 4).save(HERE / "preview-t5.png")
    up(crop(compose(leds=True)), 4).save(HERE / "preview-leds.png")
    print("dark share, territory (x 378..540, y 50..210):", f"{dark_share(day, (378, 50, 540, 210)):.1%}")
    print("dark share, core 640x270:", f"{dark_share(day, (0, 0, 640, 270)):.1%}")
    bad = band_check()
    print("band overlaps (must be empty):", bad or "none")
    for it in load(PART):
        if it["kind"] == "hotspot":
            print(f"  hotspot {it['id']:24s} layer {it['layer']} at ({it['x']},{it['y']}) led {it['led']} hit {it.get('hit')}")


if __name__ == "__main__":
    sys.exit(main())
