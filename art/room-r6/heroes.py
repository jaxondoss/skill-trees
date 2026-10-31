#!/usr/bin/env python3
"""v3.5 authored heroes (PLAN 2.6, amendment A1): the READING floating book stack.

The skill view lifts the clicked item out of the room and floats it, lit, left of the board. Every other item uses
the isolate re-export from build.py (the object alone, nothing in front of it); READING gets authored art because its
room sprite is a container (the whole bookcase), not the skill: a stack of books that grows with the stage
(s0/s1/s2 = 3/5/7 books, a ribbon bookmark at s2).

Style: the room's book language (build.py books_row and the floor book-stack: BOOKC colours, a lighter top row),
drawn chunky: flat colour clusters, 1 px INK outline around every book (books share their edge rows), spine-out and
page-edge books alternating so it reads as a stack, the top book's cover seen from slightly above. Albedo only (the
engine lights it); palette indices only; every stage on the same 54 x 47 canvas, bottom-aligned, so the stack grows
upward from a fixed base. Materials: book_cloth (covers, spines, bands, outline), paper (page edges), fabric_cotton
(the ribbon).

Called by build.py export_live(): heroes.export(B, manifest) with B = the build module.
Preview: python3 art/room-r6/heroes.py [out.png]  (a review sheet: every stage at x6 on dark and plaster)
"""
import os
import sys

import numpy as np

W, H = 54, 47
# bottom to top: (length, height incl. its INK edge rows, x offset from the centre, kind, base, light, dark, band)
BOOKS = [
    (52, 8, 1, "spine", "TERRA_1", "TERRA_2", "TERRA_0", "GOLD"),
    (46, 7, 2, "pages", "SLATE_1", "SLATE_2", "SLATE_0", None),
    (49, 8, -3, "spine", "LEAF_2", "LEAF_3", "LEAF_1", "GOLD"),
    (45, 7, 0, "spine", "GOLD_MID", "GOLD", "GOLD_DK", "CREAM"),
    (42, 6, 3, "pages", "COOL_2", "RAIN_0", "COOL_1", None),
    (40, 7, -1, "spine", "OAK_2", "OAK_3", "OAK_1", "GOLD_DK"),
    (36, 6, 1, "spine", "PLUM_1", "PLUM_2", "PLUM_0", "GOLD"),
]
STAGES = {"s0": 3, "s1": 5, "s2": 7}
COVER = 3                                  # rows of the top book's cover seen from above (plus its INK edge row)


def book_stack(N, stage):
    """Palette-index array (H, W) with T = 255 transparent, and the material-name array, for one stage."""
    T = 255
    a = np.full((H, W), T, np.uint8)
    mat = np.full((H, W), "", object)

    def rect(x0, y0, x1, y1, c, m="book_cloth"):
        a[y0:y1 + 1, x0:x1 + 1] = N[c]
        mat[y0:y1 + 1, x0:x1 + 1] = m

    n = STAGES[stage]
    y = H - 1
    tops = []
    for L, h, dx, kind, base, light, dark, band in BOOKS[:n]:
        x0 = W // 2 - L // 2 + dx
        x1 = x0 + L - 1
        y0, y1 = y - h + 1, y
        rect(x0, y0, x1, y1, "INK")
        if kind == "spine":
            rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, base)
            rect(x0 + 1, y0 + 1, x1 - 1, y0 + 1, light)            # top highlight row (the room's LIGHTER)
            rect(x0 + 1, y1 - 1, x1 - 1, y1 - 1, dark)             # bottom shade row
            for bx in (x0 + 4, x1 - 6):                            # two 2 px bands near the spine ends
                rect(bx, y0 + 1, bx + 1, y1 - 1, band)
            mid = (y0 + y1) // 2
            rect(x0 + L // 2 - 6, mid, x0 + L // 2 + 5, mid, band)  # an abstract title bar (no words)
        else:
            # page edges toward us: the boards top and bottom, the rounded spine at the left end
            rect(x0 + 1, y0 + 1, x1 - 1, y0 + 1, light)
            rect(x0 + 1, y1 - 1, x1 - 1, y1 - 1, dark)
            rect(x0 + 1, y0 + 1, x0 + 2, y1 - 1, base)
            rect(x0 + 3, y0 + 2, x1 - 2, y1 - 2, "PAPER", "paper")
            for yy in range(y0 + 3, y1 - 1, 2):
                rect(x0 + 5, yy, x1 - 4, yy, "PAPER_DK", "paper")   # page lines, inset from the ends
            rect(x1 - 1, y0 + 1, x1 - 1, y1 - 1, base)             # the fore-edge board lip
        tops.append((x0, x1, y0, light, base))
        y = y0                                                     # the next book shares this INK edge row
    # the top book's cover, seen from slightly above: INK top edge and ends, the cover in its light colour (one flat
    # face; the INK edge row below it is the spine's top edge)
    x0, x1, y0, light, base = tops[-1]
    rect(x0, y0 - COVER - 1, x1, y0 - 1, "INK")
    rect(x0 + 1, y0 - COVER, x1 - 1, y0 - 1, light)
    if stage == "s2":
        # a red ribbon bookmark from the 5th book (page edges) hanging over the spines below, INK on both sides
        bx0, _, by0, _, _ = tops[4]
        rx = bx0 + 8
        ry0, ry1 = by0 + 2, by0 + 14
        rect(rx - 1, ry0, rx + 2, ry1 + 1, "INK", "fabric_cotton")
        rect(rx, ry0, rx, ry1, "CRT_0", "fabric_cotton")
        rect(rx + 1, ry0, rx + 1, ry1 - 1, "CRT_1", "fabric_cotton")   # cut at an angle: the light side ends first
    return a, mat


def reading(B):
    """{stage: (index array, material-id array)} in the build's palette and material ids."""
    out = {}
    for s in STAGES:
        a, m = book_stack(B.N, s)
        mid = np.zeros(a.shape, np.uint8)
        for name in ("book_cloth", "paper", "fabric_cotton"):
            mid[m == name] = B.MAT[name]
        out[s] = (a, mid)
    return out


def export(B, manifest):
    """Write library.bookshelf.hero (s0/s1/s2 + base alias) next to the room sprites and append its item."""
    room = next(i for i in manifest if i["id"] == "library.bookshelf")
    # lit where the books are: the anchor is the bookcase's centre (not its floor contact), the hero centred on it
    ax, ay = int(room["x"] + room["w"] / 2 + 0.5), int(room["y"] + room["h"] / 2 + 0.5)
    variants = {}
    for s, (a, mid) in reading(B).items():
        rel = f"{B.SPR_DIR}/front/library/bookshelf.hero.{s}.png"
        B.save_png(a, os.path.join(B.PROTO, rel))
        B.save_mat(mid, a, os.path.join(B.PROTO, rel[:-4] + ".mat.png"))
        variants[s] = rel
    variants["base"] = variants["s1"]
    manifest[:] = [i for i in manifest if i["id"] != "library.bookshelf.hero"]
    manifest.append({"id": "library.bookshelf.hero", "zone": room["zone"], "kind": "overlay", "of": room["id"],
                     "layer": 6, "x": ax - W // 2, "y": ay - H // 2, "w": W, "h": H, "variants": variants,
                     "view": room["view"],
                     "hero": {"anchor": [ax, ay], "float": True, "rimSide": "right", "authored": True, "led": None},
                     "note": "v3.5 authored hero: the READING floating book stack (3/5/7 books by stage, ribbon at s2)"})


def preview(out):
    """Review sheet: each stage at x6 on dark and plaster, and at x1 beside the room bookcase sprite."""
    from PIL import Image, ImageDraw
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    import build as B  # noqa: E402
    k = 6
    tiles = []
    for s, (a, _) in reading(B).items():
        for bg in ((22, 18, 26), (54, 35, 47), (96, 80, 92)):
            px = np.zeros((H, W, 3), np.uint8)
            px[:] = bg
            m = a != 255
            px[m] = B.RGB[a[m]]
            tiles.append((s, Image.fromarray(px).resize((W * k, H * k), Image.NEAREST)))
    sheet = Image.new("RGB", (3 * (W * k + 12), 3 * (H * k + 24)), (8, 8, 8))
    d = ImageDraw.Draw(sheet)
    for i, (s, t) in enumerate(tiles):
        x, y = (i % 3) * (W * k + 12), (i // 3) * (H * k + 24)
        sheet.paste(t, (x + 6, y + 20))
        d.text((x + 6, y + 4), f"READING hero {s} ({STAGES[s]} books) x{k}", fill=(240, 230, 200))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    preview(sys.argv[1] if len(sys.argv) > 1 else "reading-hero.png")
