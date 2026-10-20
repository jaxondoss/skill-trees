#!/usr/bin/env python3
"""See / critique / fix previews for part "centre-gym" (gym on the right wall + the room centre).

Composites the shell, every other part that exists (for context) and this part on the 800x480 world canvas
the way the engine draws them (layer, shell first, contact y = y + image height, manifest order) and saves:
  preview.png             full art at 2x: hotspots at s1, room tier 3
  preview-crop4x.png      4x crop of the gym (world x 500..720, y 30..262)
  preview-centre4x.png    4x crop of the centre (world x 226..356, y 140..240)
  preview-stages.png      4x gym crops at s0 | s2 (bike awake on the s2 crop)
  preview-tiers.png       4x crops at tier 1 | tier 5 (gym and centre)
  preview-statue.png      the statue t1..t5 at 6x and the close-up t1..t5 at 3x
Prints the dark share of the gym territory and the hotspot boxes.

Run: python3 art/room/centre-gym/preview.py
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
ME = "centre-gym"
GYM = (500, 30, 720, 262)
CEN = (226, 140, 356, 240)


def parts():
    out = []
    for d in sorted((ROOT / "art" / "room").iterdir()):
        if d.name in ("common",) or not (d / "manifest.json").exists():
            continue
        out.append(d.name)
    out.sort(key=lambda n: (n != "shell", n))
    return out


def load(part):
    return json.loads((ROOT / "art" / "room" / part / "manifest.json").read_text())["items"]


def pick(it, stage, tier, awake):
    v = it["variants"]
    if awake and "awake" in v:
        return v["awake"]
    if f"s{stage}" in v:
        return v[f"s{stage}"]
    for t in range(tier, 0, -1):
        if f"t{t}" in v:
            return v[f"t{t}"]
    return v.get("base") or v.get("s1") or v.get("s0")


def compose(stage=1, tier=3, awake=False, only_me=False):
    items = []
    for part in parts():
        if only_me and part not in ("shell", ME):
            continue
        items += load(part)
    canvas = Image.new("RGBA", (AW, AH), (12, 10, 12, 255))
    entries = []
    for order, it in enumerate(items):
        if it["kind"] == "overlay":
            continue
        path = pick(it, stage, tier, awake)
        if not path:
            continue
        im = Image.open(PROTO / path).convert("RGBA")
        shell = it["kind"] == "shell"
        entries.append((it["layer"], 0 if shell else 1, 0 if shell else it["y"] + im.height, order, it, im))
    entries.sort(key=lambda e: e[:4])
    for _, _, _, _, it, im in entries:
        canvas.alpha_composite(im, (it["x"] - AX0, it["y"] - AY0))
    return canvas


def up(img, s):
    return img.resize((img.width * s, img.height * s), Image.NEAREST)


def crop(img, box):
    x0, y0, x1, y1 = box
    return img.crop((x0 - AX0, y0 - AY0, x1 - AX0, y1 - AY0))


def side(*ims, gap=8):
    w = sum(i.width for i in ims) + gap * (len(ims) - 1)
    h = max(i.height for i in ims)
    out = Image.new("RGBA", (w, h), (40, 40, 40, 255))
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + gap
    return out


def dark_share(img, box):
    c = crop(img, box).convert("RGB")
    px = list(c.getdata())
    return sum(1 for p in px if RGB2N.get(p) in DARK) / len(px)


def main():
    day = compose()
    up(day, 2).save(HERE / "preview.png")
    up(crop(day, GYM), 4).save(HERE / "preview-crop4x.png")
    up(crop(day, CEN), 4).save(HERE / "preview-centre4x.png")
    up(side(crop(compose(stage=0), GYM), crop(compose(stage=2, awake=True), GYM)), 3).save(HERE / "preview-stages.png")
    t1, t5 = compose(tier=1), compose(tier=5)
    up(side(crop(t1, GYM), crop(t5, GYM), crop(t1, CEN), crop(t5, CEN)), 3).save(HERE / "preview-tiers.png")
    mine = load(ME)
    st = next(i for i in mine if i["id"] == "centre.statue")
    cl = next(i for i in mine if i["id"] == "centre.statue-closeup")
    bg = (40, 27, 27, 255)
    small = [Image.alpha_composite(Image.new("RGBA", Image.open(PROTO / st["variants"][f"t{t}"]).size, bg),
                                   Image.open(PROTO / st["variants"][f"t{t}"]).convert("RGBA")) for t in range(1, 6)]
    big = [Image.alpha_composite(Image.new("RGBA", Image.open(PROTO / cl["variants"][f"t{t}"]).size, bg),
                                 Image.open(PROTO / cl["variants"][f"t{t}"]).convert("RGBA")) for t in range(1, 6)]
    a = up(side(*small, gap=4), 6)
    b = up(side(*big, gap=4), 3)
    sheet = Image.new("RGBA", (max(a.width, b.width), a.height + b.height + 12), (30, 30, 30, 255))
    sheet.paste(a, (0, 0))
    sheet.paste(b, (0, a.height + 12))
    sheet.save(HERE / "preview-statue.png")
    print("dark share, gym territory (x 540..720, y 30..262):", f"{dark_share(day, (540, 30, 720, 262)):.1%}")
    print("dark share, whole core:", f"{dark_share(day, (0, 0, 640, 270)):.1%}")
    for it in mine:
        if it["kind"] == "hotspot":
            im = Image.open(PROTO / next(iter(it["variants"].values())))
            bb = im.getbbox()
            print(f"  hotspot {it['id']:16s} L{it['layer']} sprite ({it['x']},{it['y']}) "
                  f"opaque x {it['x'] + bb[0]}..{it['x'] + bb[2] - 1} y {it['y'] + bb[1]}..{it['y'] + bb[3] - 1} "
                  f"led {it['led']}")


if __name__ == "__main__":
    sys.exit(main())
