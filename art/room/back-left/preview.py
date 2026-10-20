#!/usr/bin/env python3
"""See/critique/fix previews for part "back-left" (library + window zone objects).

Composites the shell PNGs and this part's sprites in place on the 800x480 world canvas the way the engine orders
them (layer, shell first, then contact y, then item order), picking hotspot stages and room tiers.

Outputs (this folder):
  preview.png           full art at 2x (stage s1, tier 3)
  preview-crop4x.png    4x crop of this part's territory (world x 170..384, y 62..226), stage s1, tier 3
  preview-stages.png    the territory at 2x for s0 | s1 | s2 (tier 3)
  preview-tiers.png     the territory at 2x for t1 | t3 | t5 (stage s1)
  preview-hit.png       4x crop with hotspot boxes (white) and LED sockets (red), statue box (grey)
Prints the dark-pixel share of the territory.

Run: python3 art/room/back-left/preview.py [--all]   (--all also composites other parts' manifests)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROTO = ROOT / "docs" / "redesign" / "room-prototype"
AX0, AY0, AW, AH = -80, -96, 800, 480
CROP = (170, 62, 384, 226)
DARK = {"VOID", "INK", "INK_COOL", "BROWN_0", "BROWN_1", "BROWN_2", "TERRA_0", "LEAF_0", "LEAF_1", "PLUM_0",
        "SLATE_0", "GOLD_DK"}
PAL = json.loads((ROOT / "art" / "room" / "common" / "palette.json").read_text())
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h, _ in PAL["colors"]}
STATUE = (258, 149, 36, 81)


def pick(variants: dict, stage: str, tier: int) -> str | None:
    if stage in variants:
        return variants[stage]
    for t in range(tier, 0, -1):
        if f"t{t}" in variants:
            return variants[f"t{t}"]
    return variants.get("base") or variants.get("s1") or next(iter(variants.values()), None)


def load_items(all_parts: bool):
    items = []
    for mf in sorted((ROOT / "art" / "room").glob("*/manifest.json")):
        part = json.loads(mf.read_text())
        if not all_parts and part["part"] not in ("shell", "back-left"):
            continue
        items.extend(part["items"])
    return items


def compose(items, stage="s1", tier=3):
    canvas = Image.new("RGBA", (AW, AH), (12, 10, 12, 255))
    entries = []
    for order, it in enumerate(items):
        path = pick(it["variants"], stage, tier)
        if not path:
            continue
        im = Image.open(PROTO / path).convert("RGBA")
        shell = it["kind"] == "shell"
        entries.append((it["layer"], 0 if shell else 1, 0 if shell else it["y"] + im.height, order, it, im))
    entries.sort(key=lambda e: e[:4])
    for _, _, _, _, it, im in entries:
        canvas.alpha_composite(im, (it["x"] - AX0, it["y"] - AY0))
    return canvas


def crop(img, box=CROP):
    x0, y0, x1, y1 = box
    return img.crop((x0 - AX0, y0 - AY0, x1 - AX0, y1 - AY0))


def up(img, s):
    return img.resize((img.width * s, img.height * s), Image.NEAREST)


def dark_share(img) -> float:
    px = list(crop(img).convert("RGB").getdata())
    return sum(1 for p in px if RGB2N.get(p) in DARK) / len(px)


def strip(imgs, gap=8):
    w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
    out = Image.new("RGBA", (w, max(i.height for i in imgs)), (40, 40, 40, 255))
    x = 0
    for i in imgs:
        out.alpha_composite(i, (x, 0))
        x += i.width + gap
    return out


def main():
    all_parts = "--all" in sys.argv
    items = load_items(all_parts)
    day = compose(items)
    up(day, 2).save(HERE / "preview.png")
    up(crop(day), 4).save(HERE / "preview-crop4x.png")
    strip([up(crop(compose(items, s, 3)), 2) for s in ("s0", "s1", "s2")]).save(HERE / "preview-stages.png")
    strip([up(crop(compose(items, "s1", t)), 2) for t in (1, 3, 5)]).save(HERE / "preview-tiers.png")
    # hotspot / LED map
    hit = up(crop(day), 4)
    d = ImageDraw.Draw(hit)
    x0c, y0c = CROP[0], CROP[1]
    mine = [it for it in items if it.get("zone") in ("library", "window")]
    for it in mine:
        if it["kind"] != "hotspot":
            continue
        im = Image.open(PROTO / pick(it["variants"], "s1", 3)).convert("RGBA")
        bb = im.getbbox()
        bx0, by0 = (it["x"] + bb[0] - x0c) * 4, (it["y"] + bb[1] - y0c) * 4
        bx1, by1 = (it["x"] + bb[2] - x0c) * 4, (it["y"] + bb[3] - y0c) * 4
        d.rectangle([bx0, by0, bx1 - 1, by1 - 1], outline=(255, 255, 255, 255))
        lx, ly = it["led"]
        d.rectangle([(lx - x0c) * 4, (ly - y0c) * 4, (lx + 3 - x0c) * 4 - 1, (ly + 3 - y0c) * 4 - 1],
                    fill=(255, 40, 40, 255))
        d.text((bx0 + 2, by0 + 2), it["label"], fill=(255, 255, 255, 255))
    sx, sy, sw, sh = STATUE
    d.rectangle([(sx - x0c) * 4, (sy - y0c) * 4, (sx + sw - x0c) * 4, (sy + sh - y0c) * 4],
                outline=(150, 150, 150, 255))
    hit.save(HERE / "preview-hit.png")
    print(f"dark share in territory x {CROP[0]}..{CROP[2]}, y {CROP[1]}..{CROP[3]}: {dark_share(day):.1%}")


if __name__ == "__main__":
    sys.exit(main())
