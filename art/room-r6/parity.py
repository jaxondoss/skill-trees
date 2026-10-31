#!/usr/bin/env python3
"""Parity check for art pass 6: art/room-r6/{manifest,zones}.json against the R3 bundle it replaces.

Same rules as art/room-r3/parity.py (every id, target and variant key kept; hotspots with label, LED inside the
sprite and a tap area of at least 44 CSS px at phone zone zoom; every zones.json key the engine reads), with the
baseline docs/redesign/room-prototype/art-v3.r3.js (the R3 rollback copy) when present, else art-v3.js.
Run: python3 art/room-r6/parity.py   (merge.py --src room-r6 runs it before swapping the bundle)
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("parity_r3", HERE.parent / "room-r3" / "parity.py")
R3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R3)
PROTO = R3.PROTO


def baseline_path() -> Path:
    r3 = PROTO / "art-v3.r3.js"
    return r3 if r3.exists() else PROTO / "art-v3.js"


RETIRED = ("study.time: target", "study.time: missing variants",
           # v3.5: the never-shown statue close-up (228 KB) is replaced by window.statue.hero
           "missing id window.statue-closeup")
CAGE_OVER, CAGE_UNDER = 5, -2


def check_v35(items) -> list:
    """v3.5 data gates (PLAN 3.8): wires on every hotspot (every active skill), cages only on skills and only when the
    gate passes, nodes on the line; <id>.hero overlays: of an existing hotspot, no target/hit, variant keys a subset
    of the room item's, layer 6, hero meta."""
    errs = []
    by_id = {i["id"]: i for i in items}
    for it in items:
        if it["kind"] == "hotspot" and not it.get("of"):
            w = it.get("wire")
            if not w or "base" not in w:
                errs.append(f"{it['id']}: no wire.base")
                continue
            for k, d in w.items():
                if k != "base" and k not in it["variants"]:
                    errs.append(f"{it['id']}: wire key {k} is not a variant")
                hull = d.get("hull") or []
                if len(hull) < 8 or len(hull) % 2 or len(d.get("nodes") or []) != 8:
                    errs.append(f"{it['id']}.wire.{k}: hull/nodes malformed")
                    continue
                pts = set(zip(hull[0::2], hull[1::2]))
                if any(q not in pts for q in zip(d["nodes"][0::2], d["nodes"][1::2])):
                    errs.append(f"{it['id']}.wire.{k}: a node is not on the line")
                if d.get("cage") is not None:
                    if "skill" not in (it.get("target") or {}):
                        errs.append(f"{it['id']}.wire.{k}: cage on a feature")
                    over = (d.get("gate") or {}).get("over") or []
                    if len(over) != 4 or not all(CAGE_UNDER <= o <= CAGE_OVER for o in over):
                        errs.append(f"{it['id']}.wire.{k}: cage fails the gate {over}")
    for it in items:
        if not it["id"].endswith(".hero"):
            continue
        room = by_id.get(it.get("of"))
        if not room or it["id"] != room["id"] + ".hero":
            errs.append(f"{it['id']}: of {it.get('of')} is not its room item")
            continue
        if it.get("target") or it.get("hit") or it["kind"] != "overlay" or it.get("layer") != 6:
            errs.append(f"{it['id']}: a hero is a layer-6 overlay with no target or hit")
        extra = set(it["variants"]) - set(room["variants"])
        if extra:
            errs.append(f"{it['id']}: variants {sorted(extra)} not on {room['id']}")
        h = it.get("hero") or {}
        if not (isinstance(h.get("anchor"), list) and len(h["anchor"]) == 2 and "float" in h and "authored" in h):
            errs.append(f"{it['id']}: hero meta needs anchor, float, authored")
    return errs


def run(items=None, zones=None) -> list:
    items = items if items is not None else json.loads((HERE / "manifest.json").read_text())["items"]
    zones = zones if zones is not None else json.loads((HERE / "zones.json").read_text())
    bp = baseline_path()
    base = R3.load_bundle(bp)
    # v3.4 phase 3 retired the Time Blocking skill (archived, history kept): the study wall calendar keeps its id
    # but now opens the calendar wall, so its target and stage variants change on purpose.
    errs = [e for e in R3.check(items, zones, base) if not e.startswith(RETIRED)] + check_v35(items)
    hs = [i for i in items if i["kind"] == "hotspot"]
    print(f"parity vs {bp.name}: {len(base['items'])} baseline ids, {len(items)} new items "
          f"({len(hs)} hotspots), {len(errs)} problems")
    return errs


if __name__ == "__main__":
    e = run()
    for x in e:
        print("  " + x)
    sys.exit(1 if e else 0)
