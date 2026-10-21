"""Write art/room-v3/common/zones.json (same schema as art/room/common/zones.json) from the room geometry and
the hotspots in the part manifests. Run after the part builds: python3 art/room-v3/common/make_zones.py
"""
import json
from pathlib import Path

from room import (AH, AW, AX, AY, BACK, CEIL, CORE_H, CORE_W, F, HALF, K, P, VX, VY, WIN_RECT, ZB, EYE, WP)

V3 = Path(__file__).resolve().parents[1]
ZONES = [("kitchen", "KITCHEN"), ("bed", "BED"), ("library", "LIBRARY"), ("window", "WINDOW"), ("study", "STUDY DESK"),
         ("computer", "COMPUTER"), ("gym", "GYM")]
SKILLS = {"food": "kitchen", "gut-health": "kitchen", "college-integration": "kitchen", "sleep": "bed", "meditation": "bed",
          "visualization": "bed", "reading": "library", "chess": "library", "academics": "study", "time-blocking": "study",
          "ai-building": "computer", "dropshipping": "computer", "strength": "gym", "running": "gym", "triathlon": "gym"}


def main():
    items = []
    for mf in sorted(V3.glob("*/manifest.json")):
        items += json.loads(mf.read_text())["items"]
    zones = []
    for n, (zid, name) in enumerate(ZONES, 1):
        hs = [i for i in items if i["zone"] == zid and i["kind"] == "hotspot"]
        boxes = [(i["hit"][0], i["hit"][1], i["hit"][0] + i["hit"][2], i["hit"][1] + i["hit"][3]) if i.get("hit")
                 else (i["x"], i["y"], i["x"] + i["w"], i["y"] + i["h"]) for i in hs]
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        w = min(400, max(330, (x1 - x0) + 36, ((y1 - y0) + 30) * 16 / 9))  # ~1/3 of the room
        h = w * 9 / 16
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fx = min(max(cx - w / 2, AX), AX + AW - w)
        fy = min(max(cy - h / 2, AY), AY + AH - h)
        zones.append({"id": zid, "n": n, "name": name, "focus": [round(fx), round(fy), round(w), round(h)],
                      "stop": round(cx), "phoneStop": round(min(max(cx, 90), CORE_W - 90)),
                      "hotspots": [i["id"] for i in hs], "territory": {"x0": round(x0), "x1": round(x1)}})
    statue = next(i for i in items if i["id"] == "window.statue")
    rug = next(i for i in items if i["id"] == "window.rug")
    out = {
        "_note": "World coordinates. The 960x540 core is x 0..960, y 0..540; the painted art spans x -120..1080, y -90..630 "
                 "(1200x720, core centred, so laptops never letterbox). Keys 1-7 run left to right (also the arrow loop). "
                 "focus = what a zone step-in frames (~1/3 of the room, 16:9, hotspots plus margin). stop = zone centre x for "
                 "the phone pan; phoneStop is clamped for a 180 px wide portrait slice. territory = x range of the zone's hotspots.",
        "art": {"x": AX, "y": AY, "w": AW, "h": AH},
        "core": {"w": CORE_W, "h": CORE_H},
        "horizon": round(VY),
        "vp": [round(VX), round(VY)],
        "camera": {"defaultZoom": 1.3, "defaultZoomNote": "default view is 1.3x closer than the full core but still shows "
                   "the whole room (crop the outer margin first); no mouse-look parallax; depth layers move only during the "
                   "zoom dolly and the phone pan", "horizonPct": round(VY / CORE_H, 3)},
        "zones": zones,
        "shell": {
            "backWall": list(BACK), "window": list(WIN_RECT), "sill": [WIN_RECT[0] - 10, WIN_RECT[3] + 1, WIN_RECT[2] + 10, WIN_RECT[3] + 6],
            "leftWall": {"backEdgeX": BACK[0], "top": [BACK[1], 0.15], "bottom": [BACK[3], 0.19375],
                         "formula": "top y = 133 - 0.15 (250 - x); bottom y = 350 + 0.19375 (250 - x) (v1 raked flats x1.6)"},
            "rightWall": "mirror of leftWall about x = 480",
            "ceilingY": BACK[1], "floorBackY": BACK[3],
            "projection": {"F": round(F, 2), "ZB": ZB, "HALF": HALF, "CEIL": CEIL, "EYE": EYE, "K": round(K, 5),
                           "note": "P(X, h, Z) = (480 + F X / Z, 227 + F (EYE - h) / Z); left wall X = -HALF - K (ZB - Z)"},
        },
        "centre": {"statue": [statue["x"], statue["y"], statue["w"], statue["h"]], "statueContactY": statue.get("contact"),
                   "rug": [rug["x"], rug["y"], rug["w"], rug["h"]],
                   "downlight": [round(P(-2.8, CEIL, 45.2)[0]), round(P(-2.8, CEIL, 45.2)[1])],
                   "sunbeam": "floor patch from the window toward the statue and the rug"},
        "relics": {"relic-left": "kitchen.relic", "relic-window": "window.relic", "relic-right": "gym.relic"},
        "layers": {
            "_note": "Depth bands (feet from the camera, back wall at 48). Objects take the band of their NEAREST floor contact or "
                     "wall depth. No mouse parallax: layers separate only during the zoom dolly and the phone pan. Shell bands "
                     "overlap 1.6 ft into the nearer band so a dolly never opens seams. Items may carry 'contact' (sort key); "
                     "use it instead of y + h when present (flat rugs/mats use their top edge, things on a counter or table "
                     "sort after it).",
            "L0": "sky, sun, clouds, far oaks (window view)",
            "L1": "New Orleans outside: shotgun houses, streetcar, power lines, near oak",
            "L2": "back wall and everything on it; depth >= 44 ft: library, statue, window, CRTs, study desk, nightstand",
            "L3": "depth 40..44: bed, armchair, computer desk, whiteboard, both relic mounts",
            "L4": "depth 35..40: door, doormat, switchboard, running wall, medals",
            "L5": "depth < 35: counter, kitchen table, cushion, chess table, rug, bike, weight rack, front floor",
            "L6": "frame crops in the bleed (speaker, leaves, boxes, cables); never over a hotspot",
        },
        "skills": dict({"_note": "Every skill maps to exactly one hotspot object. Bodyweight logs in the Food panel."}, **SKILLS),
    }
    (Path(__file__).resolve().parent / "zones.json").write_text(json.dumps(out, indent=1))
    for z in zones:
        print(z["id"], z["focus"], len(z["hotspots"]))


if __name__ == "__main__":
    main()
