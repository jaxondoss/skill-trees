#!/usr/bin/env python3
"""Composite the room art in place on the 800x480 world canvas and save previews for the see/critique/fix loop.

Reads every art/room/*/manifest.json (shell plus whatever other parts exist), picks variants the way the engine
will (night, room tier, season), draws by layer, shell first, then contact y, then item order.

Outputs (in this folder):
  preview.png          full art at 2x (day, tier 3)
  preview-crop4x.png   4x crop of the window, floor centre and the ceiling (world x 176..464, y 30..270)
  preview-night.png    full art at 2x with night variants
  preview-tier1.png / preview-tier5.png   2x, other room tiers
  preview-parallax.png 4x crop with each layer shifted by its index (full deflection) to check band seams
Prints the share of dark pixels in the 640x270 core.

Run: python3 art/room/shell/preview.py
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
DARK = {"VOID", "INK", "INK_COOL", "BROWN_0", "BROWN_1", "BROWN_2", "TERRA_0", "LEAF_0", "LEAF_1", "PLUM_0",
        "SLATE_0", "GOLD_DK"}
PAL = json.loads((ROOT / "art" / "room" / "common" / "palette.json").read_text())
RGB2N = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)): n for n, h, _ in PAL["colors"]}


def pick(variants: dict, night: bool, tier: int, season: str | None) -> str | None:
    if night and "night" in variants:
        return variants["night"]
    if season and season in variants:
        return variants[season]
    for t in range(tier, 0, -1):
        if f"t{t}" in variants:
            return variants[f"t{t}"]
    return variants.get("base") or variants.get("s1") or next(iter(variants.values()), None)


def compose(night=False, tier=3, season=None, shift=0, only_parts=None):
    items = []
    for mf in sorted((ROOT / "art" / "room").glob("*/manifest.json")):
        part = json.loads(mf.read_text())
        if only_parts and part["part"] not in only_parts:
            continue
        for n, it in enumerate(part["items"]):
            items.append((it, n))
    canvas = Image.new("RGBA", (AW, AH), (12, 10, 12, 255))
    entries = []
    for order, (it, n) in enumerate(items):
        path = pick(it["variants"], night, tier, season)
        if not path:
            continue
        im = Image.open(PROTO / path).convert("RGBA")
        contact = it["y"] + im.height
        entries.append((it["layer"], 0 if it["kind"] == "shell" else 1, contact if it["kind"] != "shell" else 0,
                        order, it, im))
    entries.sort(key=lambda e: e[:4])
    for layer, _, _, _, it, im in entries:
        canvas.alpha_composite(im, (it["x"] - AX0 + shift * layer, it["y"] - AY0))
    return canvas


def dark_share(img: Image.Image) -> float:
    import numpy as np

    core = np.array(img.crop((0 - AX0, 0 - AY0, 640 - AX0, 270 - AY0)).convert("RGB")).reshape(-1, 3)
    dark = sum(1 for p in map(tuple, core.tolist()) if RGB2N.get(p) in DARK)
    return dark / len(core)


def up(img, s):
    return img.resize((img.width * s, img.height * s), Image.NEAREST)


def main():
    day = compose()
    up(day, 2).save(HERE / "preview.png")
    crop = day.crop((176 - AX0, 30 - AY0, 464 - AX0, 270 - AY0))
    up(crop, 4).save(HERE / "preview-crop4x.png")
    up(day.crop((0 - AX0, 0 - AY0, 640 - AX0, 270 - AY0)), 2).save(HERE / "preview-core.png")
    night = compose(night=True)
    up(night, 2).save(HERE / "preview-night.png")
    up(compose(tier=1), 2).save(HERE / "preview-tier1.png")
    up(compose(tier=5), 2).save(HERE / "preview-tier5.png")
    par = compose(shift=1)
    up(par.crop((-80 - AX0, 0 - AY0, 240 - AX0, 270 - AY0)), 4).save(HERE / "preview-parallax.png")
    par2 = compose(shift=-1)
    up(par2.crop((400 - AX0, 0 - AY0, 720 - AX0, 270 - AY0)), 4).save(HERE / "preview-parallax-r.png")
    print(f"dark share in core: day {dark_share(day):.1%}, night {dark_share(night):.1%}")


if __name__ == "__main__":
    sys.exit(main())
