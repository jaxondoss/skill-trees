"""Shared helpers for the FORGE v3 room art (Pixel Art Studio build scripts).

Every part (shell, outside, kitchen-bed, ...) has art/room/<part>/build.py which imports this module,
draws sprites with Pixel Art Studio's Sprite, saves them with `save()` and declares them with `item()`.
`finish(part)` writes art/room/<part>/manifest.json. scripts/room-art.py merges all parts into the
prototype (docs/redesign/room-prototype/art/).

Coordinates are WORLD coordinates (the 640x270 core is x 0..640, y 0..270; the painted art spans
x -80..720, y -96..384). A sprite saved at (x, y) has its top-left pixel at world (x, y).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # skill-trees
COMMON = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "redesign" / "room-prototype" / "art"

_studio = os.environ.get("PIXELSTUDIO") or "/home/user/skill-pack/.claude/skills/pixel-art-studio/scripts"
sys.path.insert(0, _studio)
from pixelstudio import Sprite, mix, ramp  # noqa: E402,F401

PAL = json.loads((COMMON / "palette.json").read_text())
ZONES = json.loads((COMMON / "zones.json").read_text())
NAMES = [c[0] for c in PAL["colors"]]
HEX = {name: hexv for name, hexv, _ in PAL["colors"]}
C = type("C", (), {name: hexv for name, hexv in HEX.items()})  # C.VOID == "#0C0A0C"
CAT = {k: [HEX[n] for n in v] for k, v in PAL["categories"].items()}  # CAT["mind"] = [dark, mid, light]
MASTER = [HEX[n] for n in NAMES]

HORIZON = ZONES["horizon"]
VP = tuple(ZONES["vp"])
BACK = ZONES["shell"]["backWall"]  # x0, y0, x1, y1
WINDOW = ZONES["shell"]["window"]


def spr(w: int, h: int) -> Sprite:
    """A transparent sprite locked to the master palette (off-palette colours snap to the nearest)."""
    return Sprite(w, h, palette=MASTER, snap=True)


# ---------------------------------------------------------------- geometry
def left_wall_top(x: float) -> float:
    return 62 - 0.15 * (176 - x)


def left_wall_bottom(x: float) -> float:
    return 198 + 0.19375 * (176 - x)


def right_wall_top(x: float) -> float:
    return left_wall_top(640 - x)


def right_wall_bottom(x: float) -> float:
    return left_wall_bottom(640 - x)


def wall_point(side: str, x: float, v: float) -> tuple[int, int]:
    """Point on a side wall at column x and height fraction v (0 = floor line, 1 = ceiling line)."""
    top, bot = (left_wall_top(x), left_wall_bottom(x)) if side == "left" else (right_wall_top(x), right_wall_bottom(x))
    return round(x), round(bot - v * (bot - top))


def wall_scale(side: str, x: float) -> float:
    """Pixels per 'back-wall pixel' at column x (1.0 at the back wall edge, grows toward the viewer)."""
    top, bot = (left_wall_top(x), left_wall_bottom(x)) if side == "left" else (right_wall_top(x), right_wall_bottom(x))
    return (bot - top) / (BACK[3] - BACK[1])


def floor_halfwidth(y: float) -> float:
    """Half the floor width at row y (floor runs between the side-wall bottoms)."""
    x_left = 176 - (y - 198) / 0.19375
    return 320 - x_left


def floor_point(u: float, y: float) -> tuple[int, int]:
    """Floor point at lateral u (-1 = left wall, 0 = centre, 1 = right wall) on row y (>= 198)."""
    return round(320 + u * floor_halfwidth(y)), round(y)


def depth_scale(contact_y: float) -> float:
    """Scale of an object standing on floor row contact_y relative to one standing at the back wall (1.0)."""
    return (contact_y - HORIZON) / (BACK[3] - HORIZON)


def layer_for_floor(contact_y: float) -> int:
    return 2 if contact_y < 210 else 3 if contact_y < 222 else 4 if contact_y < 236 else 5


def layer_for_wall(side: str, x: float) -> int:
    xl = x if side == "left" else 640 - x
    return 2 if xl >= 114 else 3 if xl >= 52 else 4 if xl >= -20 else 5


# ---------------------------------------------------------------- output
_items: list[dict] = []


def save(s: Sprite, rel: str) -> str:
    """Save a sprite at 1x to docs/redesign/room-prototype/art/<rel>.png and check it is palette-strict."""
    path = OUT / f"{rel}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    s.save_png(str(path))
    check_png(path)
    return f"art/{rel}.png"


def check_png(path: Path) -> None:
    from PIL import Image

    im = Image.open(path).convert("RGBA")
    allowed = {tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)) for h in MASTER}
    bad = set()
    for r, g, b, a in im.getdata():
        if a not in (0, 255):
            raise ValueError(f"{path}: semi-transparent pixel (alpha {a}); use 0 or 255 only")
        if a == 255 and (r, g, b) not in allowed:
            bad.add((r, g, b))
    if bad:
        raise ValueError(f"{path}: {len(bad)} off-palette colours, e.g. {sorted(bad)[:5]}")


def item(
    id: str,
    *,
    zone: str,
    kind: str,
    layer: int,
    x: int,
    y: int,
    variants: dict[str, str],
    target: dict | None = None,
    label: str | None = None,
    led: tuple[int, int] | None = None,
    hit: tuple[int, int, int, int] | None = None,
    anim: dict | None = None,
    note: str = "",
) -> None:
    """Declare one sprite in the room.

    kind: "hotspot" | "decor" | "shell" | "overlay" (overlays are alerts, night lights, holiday decor...).
    variants: keys "base", stage "s0"/"s1"/"s2", "dust" (optional override), "night", room tier "t1".."t5",
      alert states ("alert"), season ("spring", "summer", "fall", "winter"), holiday ("mardi-gras",
      "jazz-fest", "halloween", "december"), "awake" (triathlon). Values are paths returned by save().
    target (hotspots): {"skill": "<slug>"} or {"feature": "today"|"stats"|"overall"|"archive"|"journal"|
      "focus"|"review"|"settings"|"bodyweight"|"sun"}.
    label: nameplate text, e.g. "STRENGTH". led: world (x, y) of the 3x3 LED socket. hit: world rect.
    anim: {"frames": [paths], "fps": n} for ambient motion.
    note: one line naming the object, used in the spec's decor inventory.
    """
    assert kind in ("hotspot", "decor", "shell", "overlay"), kind
    assert 0 <= layer <= 6, layer
    if kind == "hotspot":
        assert target and label and led, f"{id}: hotspots need target, label and led"
    _items.append(
        {k: v for k, v in dict(id=id, zone=zone, kind=kind, layer=layer, x=x, y=y, variants=variants, target=target,
                                label=label, led=list(led) if led else None, hit=list(hit) if hit else None,
                                anim=anim, note=note).items() if v not in (None, "")}
    )


def finish(part: str) -> None:
    out = ROOT / "art" / "room" / part / "manifest.json"
    out.write_text(json.dumps({"part": part, "items": _items}, indent=1))
    hot = sum(1 for i in _items if i["kind"] == "hotspot")
    dec = sum(1 for i in _items if i["kind"] == "decor")
    print(f"{part}: {len(_items)} items ({hot} hotspots, {dec} decor) -> {out.relative_to(ROOT)}")
