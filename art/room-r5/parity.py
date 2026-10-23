#!/usr/bin/env python3
"""Parity check for art pass 5: art/room-r5/{manifest,zones}.json against the R3 bundle it replaces.

Same rules as art/room-r3/parity.py (every id, target and variant key kept; hotspots with label, LED inside the
sprite and a tap area of at least 44 CSS px at phone zone zoom; every zones.json key the engine reads), with the
baseline docs/redesign/room-prototype/art-v3.r3.js (the R3 rollback copy) when present, else art-v3.js.
Run: python3 art/room-r5/parity.py   (merge.py --src room-r5 runs it before swapping the bundle)
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


def run(items=None, zones=None) -> list:
    items = items if items is not None else json.loads((HERE / "manifest.json").read_text())["items"]
    zones = zones if zones is not None else json.loads((HERE / "zones.json").read_text())
    bp = baseline_path()
    base = R3.load_bundle(bp)
    errs = R3.check(items, zones, base)
    hs = [i for i in items if i["kind"] == "hotspot"]
    print(f"parity vs {bp.name}: {len(base['items'])} baseline ids, {len(items)} new items "
          f"({len(hs)} hotspots), {len(errs)} problems")
    return errs


if __name__ == "__main__":
    e = run()
    for x in e:
        print("  " + x)
    sys.exit(1 if e else 0)
