"""FORGE room v3.5 overview (D2-FINAL 2.3): a fixed north-up "lid off" dollhouse of the whole room.

Imported by build.py's export_live hook (PLAN 2.6) as overview.export(B, manifest, zones) with B = the build module.
The scene functions of the four views are re-run through one high oblique camera (pj/sc/box3d/obj swapped for the
overview's versions, every object stashed in its own layer and composited far to near), the shell (floor, three cut
walls, the back-wall stub and section caps) is drawn as world polygons with world u/v for textures.apply, and the
hotspots that read wrong when projected get authored miniatures (OVERVIEW_STAMPS, overview_stamps.py).

Master: 560 x 400 px, camera pos (0, 54, -29) ft, target (0, 0, 3.2), f 515. Overview world px = master - (OX, OY)
with (OX, OY) = the core's top-left (100, 46): core = [0, 0, 360, 300].

Fast loop (top view only, ~20 s): cd art/room-r6 && python3 -c "import overview; overview.preview()"
"""
import math
import os
import sys
from contextlib import contextmanager

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

SIZE = (560, 400)
POS, TGT, FOC = (0.0, 54.0, -29.0), (0.0, 0.0, 3.2), 515.0
CORE = (100, 46, 460, 346)          # master crop of the diorama core (D2 2.1)
OX, OY = CORE[0], CORE[1]
STUB = 1.4                          # back wall cut height (ft)
CUT = 13.5                          # side and front walls: full height, cut at the ceiling line
WT = 0.5                            # wall thickness drawn by the section caps (ft)
SPR = "art-r6/top"

# objects never drawn in the overview: the roof's furniture (their light stays as floor pools) and the back wall's
# inner face pieces (seen from behind); hotspot objects with an authored miniature are drawn by the stamp instead
SKIP = {"beams", "string-1", "string-3", "string-x", "hang-plant", "pendant", "cal-pendant", "ceiling", "void",
        "drop-cloth", "paint-cans", "studio-stool", "brush-jars", "canvases", "olive-tree",
        "margin", "skylight"}

CAM = {}
LAST = {"s": 20.0}
REC = {}
STACK = []
LAYERS = []


class Ctx:
    B = None


def _B():
    """The build module: the one that imported us (export) or build.py (development loops)."""
    if Ctx.B is None:
        import build
        Ctx.B = build
    return Ctx.B


def set_cam(pos=POS, target=TGT, f=FOC, size=SIZE):
    pos = np.array(pos, float)
    fw = np.array(target, float) - pos
    fw /= np.linalg.norm(fw)
    rt = np.cross(np.array([0.0, 1.0, 0.0]), fw)
    rt /= np.linalg.norm(rt)
    up = np.cross(fw, rt)
    CAM.update(pos=pos, fw=fw, rt=rt, up=up, f=f, cx=size[0] / 2, cy=size[1] / 2)


def cam_proj(X, Y, Z):
    p = np.array([X, Y, Z], float) - CAM["pos"]
    zc = max(0.5, float(p @ CAM["fw"]))
    s = CAM["f"] / zc
    return CAM["cx"] + float(p @ CAM["rt"]) * s, CAM["cy"] - float(p @ CAM["up"]) * s, s, zc


def proj(X, Y, Z):
    """World ft -> master px (float)."""
    x, y, _, _ = cam_proj(X, Y, Z)
    return x, y


def world_px(X, Y, Z):
    """World ft -> overview world px (int), the coordinate system of the top.* items."""
    x, y = proj(X, Y, Z)
    return int(round(x)) - OX, int(round(y)) - OY


def unproject_floor(xs, ys, Y=0.0):
    """Master px (arrays) -> world (X, Z) on the plane at height Y."""
    C = CAM
    d = (C["fw"][None] + ((np.asarray(xs) + 0.5 - C["cx"]) / C["f"])[:, None] * C["rt"][None]
         - ((np.asarray(ys) + 0.5 - C["cy"]) / C["f"])[:, None] * C["up"][None])
    t = (Y - C["pos"][1]) / d[:, 1]
    return C["pos"][0] + t * d[:, 0], C["pos"][2] + t * d[:, 2]


# ---------------------------------------------------------------- the build's primitives, re-aimed
def _pj(x, Y, z):
    B = Ctx.B
    X, Z = B.to_world(x + B.XS["dx"], z + B.ZS["dz"])
    sx, sy, s, zc = cam_proj(X, Y, Z)
    LAST["s"] = s
    if STACK:
        REC.setdefault(STACK[-1], []).append((zc, Y, X, Z, z + B.ZS["dz"]))
    return sx, sy


def _sc(z):
    return LAST["s"]


def _box3d(X0, X1, Y0, Y1, z0, z1, front, side=None, top=None, ol="INK", bottom=None):
    """6-face box with back-face culling for the overview camera (D2 M1)."""
    B = Ctx.B
    side = side or front
    top = top or front
    c = {i: ((X1 if i & 1 else X0), (Y1 if i & 2 else Y0), (z1 if i & 4 else z0)) for i in range(8)}
    faces = {"front": ([4, 5, 7, 6], (0, 0, 1), front), "back": ([0, 1, 3, 2], (0, 0, -1), front),
             "top": ([2, 3, 7, 6], (0, 1, 0), top), "bottom": ([0, 1, 5, 4], (0, -1, 0), bottom or side),
             "left": ([0, 2, 6, 4], (-1, 0, 0), side), "right": ([1, 3, 7, 5], (1, 0, 0), side)}
    Xc, Yc, Zc = CAM["pos"]
    lx, lz = B.to_local(Xc, Zc)
    cam_local = np.array((lx - B.XS["dx"], Yc, lz - B.ZS["dz"]))
    order = []
    for k, (idx, n, col) in faces.items():
        ctr = np.mean([c[i] for i in idx], axis=0)
        v = cam_local - ctr
        if float(np.dot(v, n)) <= 0:
            continue
        order.append((float(np.linalg.norm(v)), k, idx, col))
    out = {}
    for _, k, idx, col in sorted(order, reverse=True):
        q = [_pj(*c[i]) for i in idx]
        B.POLY(q, col, ol)
        out[k] = q
    out["front"] = [_pj(*c[6]), _pj(*c[7]), _pj(*c[5]), _pj(*c[4])]
    return out


@contextmanager
def _obj(name, oid=None, emit=False, mat=None):
    """Draw one object into a private layer and stash it (composited far to near once every view is drawn)."""
    B = Ctx.B
    if oid is None:
        oid = B.G.nxt
        B.G.nxt += 1
    B.G.names[oid] = name
    if mat is not None:
        B.G.objmat[oid] = mat
    S = B.S
    prev = (S.im, S.d, S.em, S.de, S.face)
    B._begin()
    STACK.append(name)
    REC[name] = []
    key = name
    try:
        yield oid
    finally:
        STACK.pop()
        a = np.array(S.im)
        e = np.array(S.em) > 0
        zs = REC.pop(key, [])
        S.im, S.d, S.em, S.de, S.face = prev
        nm = name.split("@")[0]
        if (a != B.T).any() and nm not in SKIP and (STAMPING["on"] or nm not in STAMPS):
            ys = [p[1] for p in zs] or [1.0]
            pa = np.array(zs, float).reshape(-1, 5)
            spread = (np.ptp(pa[:, 2]) + np.ptp(pa[:, 3])) if len(pa) else 0.0
            if STAMPING["on"] or len(pa) < 3 or spread < 0.5:
                ys = ys + [1.0]           # a sprite stood on one anchor point is not a floor-flat piece
            # painter's depth: the camera depth of the object's floor footprint (a wall hanging is as far as its
            # wall, not as near as its height makes it)
            fw, P = CAM["fw"], CAM["pos"]
            dep = [(p[2] - P[0]) * fw[0] - P[1] * fw[1] + (p[3] - P[2]) * fw[2] for p in zs] or [999.0]
            # a piece resting on furniture (table-top height) sorts after the furniture it stands on
            ymin = min(p[1] for p in zs) if zs else 0.0
            if 0.5 < ymin < 3.6 and max(p[4] for p in zs) > 0.05:
                dep = [d - 1.2 * ymin for d in dep]
            LAYERS.append(dict(depth=float(np.median(dep)), ymax=float(max(ys)), i=len(LAYERS), name=name, img=a,
                               emit=e | emit, oid=oid, view=B.VIEW, pts=np.array(zs, float).reshape(-1, 5),
                               stamp=STAMPING["on"]))


def _books_row_guard(orig):
    def books_row(x0, x1, yb, hmax, rng, n_fill=1.0):
        if hmax < 5 or x1 - x0 < 3:
            return
        return orig(x0, x1, yb, hmax, rng, n_fill)
    return books_row


@contextmanager
def patched(B):
    """Swap the build's projection and object primitives for the overview's, restore on exit."""
    Ctx.B = B
    keep = {k: getattr(B, k) for k in ("pj", "sc", "box3d", "obj", "W", "H", "books_row", "face_record")}
    B.W, B.H = SIZE
    B.pj, B.sc, B.box3d, B.obj = _pj, _sc, _box3d, _obj
    B.books_row = _books_row_guard(keep["books_row"])
    B.face_record = lambda *a, **k: None
    try:
        yield
    finally:
        for k, v in keep.items():
            setattr(B, k, v)


def draw_objects(B, var=None, tod="golden", tier=3):
    """Run every view's scene code through the overview camera. Returns the stashed layers."""
    B.TOD, B.TIER = tod, tier
    B.VAR.clear()
    B.VAR.update(B.BASEVAR)
    B.VAR.update(var or {})
    B.AF.clear()
    B.PARTS.clear()
    B.PARTS.update(B.STATIC_PARTS)
    B.ISO["names"] = None
    B.REC["view"] = None
    B.G.ghost = False
    B.new_scene()
    LAYERS.clear()
    REC.clear()
    errors = []
    for v in B.VIEW_IDS:
        B.set_view(v)
        try:
            B.SCENES[v]()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{v}: {type(e).__name__}: {e}")
    B.set_view("front")
    try:
        B.corner_pieces()
    except Exception as e:  # noqa: BLE001
        errors.append(f"corners: {type(e).__name__}: {e}")
    draw_stamps(B)
    B.set_view("front")
    for L in LAYERS:
        if L["view"] in ("left", "right") and not L.get("stamp") and L["name"] not in KEEP_PROJECTED and len(L["pts"]) \
                and float(L["pts"][:, 4].max()) <= 0.05:
            footprint(B, L)
    if errors:
        print("overview: scene errors:", errors)
    return list(LAYERS)




# ---------------------------------------------------------------- M4 miniatures (authored at overview scale)
# Each miniature is drawn pixel by pixel at overview scale: flat clusters in the room item's own ramps, 1 px INK
# outline, nothing under 2 px. Templates: '.' empty, 'k' INK, any other character -> the legend colour (a legend
# value None drops that cell, e.g. the knight's cape below tier 3). Free-standing pieces are frontal sprites anchored
# at their world base point (the 3/4 view of the whole diorama); wall cards are world polygons on their wall plane.
LEGEND = {"k": "INK", "K": "INK_2", "w": "CREAM", "p": "PAPER", "P": "PAPER_DK", "g": "GOLD", "G": "GOLD_HI",
          "d": "GOLD_DK", "m": "GOLD_MID", "o": "OAK_0", "O": "OAK_1", "a": "OAK_2", "A": "OAK_3", "D": "OAK_DK",
          "V": "OAK_VD", "s": "SLATE_0", "S": "SLATE_1", "t": "SLATE_2", "T": "SLATE_3", "x": "SLATE_D",
          "e": "ENERGY", "E": "ENERGY_HI", "r": "CRT_0", "R": "CRT_1", "l": "LEAF_1", "L": "LEAF_2", "y": "LEAF_3",
          "Y": "LEAF_4", "u": "SUN", "n": "TERRA_1", "N": "TERRA_2", "z": "TERRA_0", "v": "VIOLET", "q": "PLUM_2",
          "Q": "PLUM_3", "b": "NAVY", "c": "COOL_1", "C": "COOL_2", "h": "BROWN_1", "f": "ORANGE", "j": "GLOW",
          "i": "RIM", "M": "AMBER", "1": "PLUM_1", "0": "VOID"}


def tpl(text, legend=None, **over):
    """Template string -> uint8 array (255 = empty). `over` maps template chars to palette names (None = empty)."""
    B = _B()
    lg = dict(LEGEND)
    lg.update(legend or {})
    lg.update(over)
    rows = [r for r in text.strip("\n").split("\n")]
    w = max(len(r) for r in rows)
    a = np.full((len(rows), w), 255, np.uint8)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "." or ch == " ":
                continue
            c = lg.get(ch, "?")
            if c is None:
                continue
            a[y, x] = B.N[c]
    ink = B.N["INK"]
    body = (a != 255) & (a != ink)
    near = np.zeros_like(body)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= np.roll(np.roll(body, dy, 0), dx, 1)
    a[(a == ink) & ~near] = 255           # an outline cell with no body next to it (a dropped cape) goes
    return a


KNIGHT = """
....kkkkk....
...kBBBBAk...
...kBkkkCk...
...kAAAACk...
.kkkkTATkkkk.
kBBATAAATABCk
kBATkAAAkTACk
kAAkkTAAkkCCk
kCAkcTTTckACk
.kkkcAEAckkk.
..kcAkTkAck..
..kckCEAkck..
..kckAEAkck..
..kckAEAkck..
.kccACEACcck.
.kccAkEkCcck.
.kccAkEkCcck.
.kcckAkCkcck.
.kcckAkCkcck.
.kkkkAkCkkkk.
....kAkCk....
...kkAkCkk...
...kBAkACk...
...kkkkkkk...
"""
KNIGHT_TIERS = {1: dict(B="SLATE_2", A="SLATE_1", C="SLATE_0", T="SLATE_0", c=None, E="SLATE_2"),
                2: dict(B="SLATE_2", A="SLATE_1", C="SLATE_0", T="GOLD", c=None, E="SLATE_3"),
                3: dict(B="GOLD", A="SLATE_1", C="SLATE_0", T="GOLD", c="CRT_0", E="ENERGY"),
                4: dict(B="GOLD_HI", A="GOLD", C="GOLD_MID", T="SLATE_0", c="CRT_0", E="ENERGY"),
                5: dict(B="SUN", A="GOLD_HI", C="GOLD", T="AMBER", c="CRT_0", E="ENERGY_HI")}


def mini_knight(B):
    t = int(B.TIER)
    a = tpl(KNIGHT, **KNIGHT_TIERS[t])
    if t >= 5:   # the halo
        h = np.full((a.shape[0] + 2, a.shape[1]), 255, np.uint8)
        h[2:] = a
        g = B.N["GOLD_HI"]
        h[0, 4:9] = g
        h[1, 3] = g
        h[1, 9] = g
        a = h
    put(B, a, -4.8, 1.0, 12.7)


CLOCK = """
.kkkkkkkk.
kzzzzzzzzk
kKRKRRKRKk
kKRKRKKRKk
kkkkkkkkkk
"""


def mini_clock(B):
    put(B, tpl(CLOCK), -13.2, 2.0, 9.8)


GLOBE = """
..kkkkk..
.kbvbbbk.
kbvbEbvbk
kbbEeEbbk
kvbbEbbvk
kbvbebvbk
.kbbvbbk.
..kkkkk..
.kssSssk.
.kkkkkkk.
"""


def mini_globe(B):
    put(B, tpl(GLOBE), -13.4, 5.85, 4.5)


BASKET = {0: """
..........
..........
.kkkkkkkk.
kAaaAaaaAk
kOaOaOaOOk
.kOOOOOOk.
..kkkkkk..
""", 1: """
...kk.....
..kRrk.kk.
.kkrrkkuuk
kAaaAaaaAk
kOaOaOaOOk
.kOOOOOOk.
..kkkkkk..
""", 2: """
..kkYk.kk.
.kRrkkkuuk
kRrrkfjkuk
kAaaAaaaAk
kOaOaOaOOk
.kOOOOOOk.
..kkkkkk..
"""}


def mini_basket(B):
    put(B, tpl(BASKET[B.stg("kitchen.food")]), -12.9, 2.95, -3.8)


ENVELOPE = """
kkkkkkkk
kwpppppwk
kpwppwpPk
kppwwppPk
kPPPPPPPk
kkkkkkkkk
"""


def mini_envelope(B):
    alert = B.vk("kitchen.doormat") == "alert"
    a = tpl(ENVELOPE)
    if alert:
        a[3, 4:6] = B.N["CRT_1"]
    put(B, a, -12.7, 2.96, -4.9)


JOURNAL = """
kkkkkkk.
kzzgzzzk
kNzgzzzk
kNzgzzzk
kkkkkkkk
"""
COURSES = """
.kkkkkkk.
kttttttSk
kkkkkkkkk
kNNNNNNzk
kkkkkkkkk
kyyyyyyLk
kkkkkkkkk
"""


def mini_journal(B):
    put(B, tpl(JOURNAL), 12.3, 2.56, 9.4)


def mini_courses(B):
    put(B, tpl(COURSES), 13.4, 2.55, 10.2)


RACK = """
.kk..........kk.
.kSk........kSk.
.kSkkkkkkkkkkSk.
.kSttttttttttSk.
.kSkkkkkkkkkkSk.
.kSk........kSk.
kkSkkk....kkkSkk
kPkSkk....kkSkPk
kPkSkTkkkkkSkkPk
kPkSkTttttttSkPk
kPkSkkkkkkkkSkPk
kkkSk......kSkkk
..kSk......kSk..
..kSk......kSk..
.kkSkk....kkSkk.
.kssSk....ksSsk.
.kkkkk....kkkkk.
"""
RACK_PLATES = {0: dict(P=None), 1: dict(P="CRT_0"), 2: dict(P="GOLD")}


def mini_rack(B):
    put(B, tpl(RACK, **RACK_PLATES[B.stg("gym.strength")]), 12.8, 0.0, -2.0)


SHOES = """
kkkkkkkkkk
kAaaaaaaOk
kaRrkRrkOk
kkkkkkkkkk
kaaaaaaaOk
kayLkaaaOk
kkkkkkkkkk
kOk....kOk
kkk....kkk
"""


def mini_shoes(B):
    put(B, tpl(SHOES), 13.4, 0.0, -7.2)


RELIC = """
.kkkkk.
kOaaaOk
kaxGxak
kaGGGak
kOaGaOk
.kkkkk.
"""
RELIC_GEM = {"base": ("SLATE_0", "SLATE_D"), "active": ("ENERGY", "ENERGY_HI"), "hot": ("GLOW", "SUN"),
             "gold": ("GOLD", "GOLD_HI")}


def mini_relic(B, item, X, Y, Z):
    g = RELIC_GEM.get(B.vk(item), RELIC_GEM["base"])
    put(B, tpl(RELIC, G=g[0], x=g[1]), X, Y, Z)


CAL_BOARD = """
kkkkkkkkkkkkkkkkkkkk
krRrRrRrRrRrRrRrRrRk
kpppppppppppppppppPk
kpPpPpPpPpPpPpPpPpPk
kpppppppppppppppppPk
kpPpPpPpPpPpRpPpPpPk
kpppppppppppppppppPk
kpPpPpPpPpPpPpPpPpPk
kPPPPPPPPPPPPPPPPPPk
kkkkkkkkkkkkkkkkkkkk
"""
CAL_DAY = """
kkkkkk
ksSSsk
kSttSk
kkkkkk
kSuuSk
kSuuSk
ksSSsk
kSSSSk
kkkkkk
"""


def mini_cal_board(B):
    put(B, tpl(CAL_BOARD), 3.0, STUB, -RS - 0.25)


def mini_cal_day(B):
    put(B, tpl(CAL_DAY), -7.0, STUB, -RS - 0.25)


# ---- side-wall cards: the side walls are seen almost edge-on from the overview camera, so a flush card is a sliver;
# like the projected wall clock, a card is drawn as a small frontal plate centred on its wall point (the dollhouse
# convention: wall pieces turn to face you)
def wall_pt(side, u, Y):
    X = -RS + 0.04 if side == "L" else RS - 0.04
    return (X, Y, u)


def card(w, h, frame, fill, hi=None):
    """INK outline, a 1 px frame, a flat fill; `hi` lights the frame's top and left (the window side)."""
    B = _B()
    a = np.full((h, w), B.N["INK"], np.uint8)
    a[1:-1, 1:-1] = B.N[frame]
    a[2:-2, 2:-2] = B.N[fill]
    if hi:
        a[1, 1:-1] = B.N[hi]
    return a


def dots(a, pts, c):
    B = _B()
    for x, y in pts:
        a[y, x] = B.N[c]
    return a


def put_wall(B, a, side, u, Y):
    put(B, a, *wall_pt(side, u, Y), ax=0.5, ay=0.5)


def mini_corkboard(B):
    k = B.stg("kitchen.door")
    a = card(11, 9, "OAK_1", "AMBER", hi="OAK_2")
    notes = [((3, 3), "CREAM"), ((6, 3), "SLATE_2"), ((3, 5), "SUN"), ((7, 5), "PLUM_3"), ((5, 4), "CREAM")]
    for (x, y), c in notes[:2 + k + (1 if k == 2 else 0)]:
        dots(a, [(x, y), (x + 1, y)], c)
    put_wall(B, a, "L", 0.45, 7.85)


def mini_switch(B):
    a = card(5, 7, "CREAM", "CREAM")
    dots(a, [(2, 2), (2, 4)], "SLATE_1")
    put_wall(B, a, "L", -6.25, 3.95)


def mini_schedule(B):
    key = B.vk("study.academics", "s1")
    k = {"s0": 0, "s1": 1, "s2": 2, "alert": 2}.get(key, 1)
    a = card(9, 11, "OAK_1", "OAK_DK", hi="OAK_2")
    cols = ["CREAM", "SLATE_2", "PLUM_3", "LEAF_3"] if key != "alert" else ["CRT_1", "CREAM", "CRT_1", "CREAM"]
    for i in range(2 + k):
        dots(a, [(2 + j, 2 + 2 * i) for j in range(5)], cols[i])
    put_wall(B, a, "R", 10.2, 6.4)


def mini_calendar(B):
    a = card(7, 9, "PAPER", "PAPER")
    a[1, 1:-1] = B.N["CRT_0"]
    a[2, 1:-1] = B.N["CRT_0"]
    dots(a, [(x, y) for y in (4, 6) for x in (2, 4)], "SLATE_1")
    dots(a, [(2, 6)], "CRT_1")
    put_wall(B, a, "R", 8.2, 6.55)


def mini_whiteboard(B):
    k = B.stg("computer.board")
    a = card(17, 12, "SLATE_2", "CREAM", hi="SLATE_3")
    line = [(2, 9), (3, 9), (4, 8), (5, 8), (6, 7), (7, 7), (8, 6), (9, 5), (10, 4), (11, 4)]
    for x, y in line[:4 + 3 * k]:
        a[y, x] = B.N["LEAF_2"]
    for i, c in enumerate(("CRT_0", "SLATE_0", "LEAF_2")):
        dots(a, [(x, 3 + i * 2) for x in range(11, 15)], c)
    put_wall(B, a, "R", 4.6, 6.95)


MONITORS = """
kkkkkkk.kkkkkkk
kcccccckcccccck
kcyyycckceeecck
kccLLLckccyycck
kcyycccckLLLcck
kccccccckcccccck
kkkkkkkkkkkkkkkk
.....kk...kk....
....kkkk.kkkk...
"""


def mini_monitors(B):
    put(B, tpl(MONITORS, c="COOL_0"), 12.45, 2.65, 4.7)


def mini_focus(B):
    n = tpl("""
kkkk
kguk
kggk
kkkk
""")
    put(B, n, 12.45, 4.4, 6.4, ay=0.5)


# object name -> (view the room draws it in, drawer). The room object is not drawn; the miniature takes its name,
# so the hotspot twin's mask and the wire still come from that name.
STAMPS = {
    "knight": ("front", mini_knight),
    "alarm-clock": ("left", mini_clock),
    "plasma-globe": ("left", mini_globe),
    "fruit-basket": ("left", mini_basket),
    "envelope": ("left", mini_envelope),
    "corkboard-kitchen": ("left", mini_corkboard),
    "switch-panel": ("left", mini_switch),
    "relic-mount-L": ("left", lambda B: mini_relic(B, "kitchen.relic", -13.9, 7.6, -2.2)),
    "journal": ("right", mini_journal),
    "course-books": ("right", mini_courses),
    "schedule-board": ("right", mini_schedule),
    "calendar": ("right", mini_calendar),
    "whiteboard": ("right", mini_whiteboard),
    "monitors": ("right", mini_monitors),
    "focus-note": ("right", mini_focus),
    "weight-rack": ("right", mini_rack),
    "shoe-shelf": ("right", mini_shoes),
    "relic-bracket-R": ("right", lambda B: mini_relic(B, "gym.relic", 13.9, 6.6, -12.35)),
    "cal-board": ("back", mini_cal_board),
    "cal-daybar": ("back", mini_cal_day),
}


def wproj(X, Y, Z):
    """Project a world point and record it for the current object's depth."""
    sx, sy, s, zc = cam_proj(X, Y, Z)
    if STACK:
        REC.setdefault(STACK[-1], []).append((zc, Y, X, Z, 0.0))
    return sx, sy


def put(B, a, X, Y, Z, ax=0.5, ay=1.0):
    """Paste a template array with its anchor (ax, ay of the array) on the projected world point."""
    sx, sy = wproj(X, Y, Z)
    h, w = a.shape
    x0 = int(round(sx - ax * w))
    y0 = int(round(sy - ay * h))
    for y in range(h):
        for x in range(w):
            if a[y, x] != 255:
                B.P(x0 + x, y0 + y, B.N_INV[int(a[y, x])])


def draw_stamps(B):
    STAMPING["on"] = True
    try:
        for name, (view, fn) in STAMPS.items():
            B.set_view(view)
            with _obj(name, mat=None):
                fn(B)
            if LAYERS and LAYERS[-1]["name"] == name:
                LAYERS[-1]["depth"] -= 3.0 + STAMP_BIAS.get(name, 0.0)
    finally:
        STAMPING["on"] = False


STAMPING = {"on": False}
# miniatures that sit on or behind a nearer piece (the knight on its pedestal, the clock behind the headboard) are
# composited this many feet nearer, so a hotspot is never hidden in the overview (D2 M4 coverage)
STAMP_BIAS = {"knight": 2.0, "alarm-clock": 8.0, "plasma-globe": 8.0, "calendar": 4.0, "course-books": 2.0,
              "shoe-shelf": 2.0, "whiteboard": 1.0}
KEEP_PROJECTED = {"wall-clock"}         # flush wall pieces that read right as projected
FOOT_SIZE = {"coat-hooks": (1.6, 0.7)}  # flush pieces drawn from one anchor: (along the wall, height) ft
FOOT_K = 2.6                            # footprint plate px per wall foot
FOOT_COLOURS = {"door": ("OAK_1", "OAK_DK"), "coat-hooks": ("OAK_1", "OAK_1"), "backsplash": ("PLASTER_4", "CREAM")}


def footprint(B, L):
    """M5: a flush side-wall decor piece becomes a footprint card on its wall: its two commonest colours, INK edge."""
    p = L["pts"]
    side = "L" if L["view"] == "left" else "R"
    u0, u1, y0, y1 = p[:, 3].min(), p[:, 3].max(), p[:, 1].min(), p[:, 1].max()
    if u1 - u0 < 0.3 or y1 - y0 < 0.3:
        w, h = FOOT_SIZE.get(L["name"], (1.0, 0.8))
        cu, cy = (u0 + u1) / 2, (y0 + y1) / 2
        u0, u1, y0, y1 = cu - w / 2, cu + w / 2, cy - h / 2, cy + h / 2
    vals, cnt = np.unique(L["img"][(L["img"] != B.T) & (L["img"] != B.N["INK"])], return_counts=True)
    order = [B.N_INV[int(v)] for v in vals[np.argsort(-cnt)]] or ["OAK_1"]
    c1, c2 = FOOT_COLOURS.get(L["name"], (order[0], order[1] if len(order) > 1 else order[0]))
    w = int(max(4, min(18, round((u1 - u0) * FOOT_K))))
    h = int(max(4, min(18, round((y1 - y0) * FOOT_K))))
    a = card(w, h, c1, c2) if w > 4 and h > 4 else card(w, h, c1, c1)
    prev = (B.S.im, B.S.d, B.S.em, B.S.de, B.S.face)
    B._begin()
    STACK.append(L["name"])
    put_wall(B, a, side, (u0 + u1) / 2, (y0 + y1) / 2)
    STACK.pop()
    REC.pop(L["name"], None)
    L["img"] = np.array(B.S.im)
    L["emit"] = np.zeros(L["img"].shape, bool)
    B.S.im, B.S.d, B.S.em, B.S.de, B.S.face = prev
    L["foot"] = True

# ---------------------------------------------------------------- the shell: ray cast floor, three walls, stub, caps
WALL_OID = {"front": (1, "wall-B"), "left": (2, "wall-L"), "right": (3, "wall-R"), "floor": (4, "floor"),
            "stub": (5, "stub"), "cap": (6, "cap")}
RS = 14.0


def shell_cast(B):
    """Per master pixel: the nearest shell surface hit by the overview camera's ray.
    Writes B.G.img/oid/mat/kind/su/sv/dist like build.shell() (world u/v: textures stay world-consistent)."""
    H, W = SIZE[1], SIZE[0]
    yy, xx = np.mgrid[0:H, 0:W]
    C = CAM
    d = (C["fw"][None, None] + ((xx + 0.5 - C["cx"]) / C["f"])[..., None] * C["rt"][None, None]
         - ((yy + 0.5 - C["cy"]) / C["f"])[..., None] * C["up"][None, None])
    P = C["pos"]
    best = np.full((H, W), np.inf)
    surf = np.zeros((H, W), np.uint8)     # index into SURF
    U = np.zeros((H, W))
    V = np.zeros((H, W))
    HX = np.zeros((H, W))
    HY = np.zeros((H, W))
    HZ = np.zeros((H, W))
    SURF = [None]

    def plane(axis, val, lims, sid, uf, vf, facing):
        dd = d[..., axis]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (val - P[axis]) / dd
        X, Y, Z = P[0] + t * d[..., 0], P[1] + t * d[..., 1], P[2] + t * d[..., 2]
        ok = (t > 0) & facing(dd)
        for ax, (lo, hi) in lims.items():
            q = (X, Y, Z)[ax]
            ok &= (q >= lo) & (q <= hi)
        ok &= t < best
        SURF.append(sid)
        k = len(SURF) - 1
        best[ok] = t[ok]
        surf[ok] = k
        U[ok] = uf(X, Y, Z)[ok]
        V[ok] = vf(X, Y, Z)[ok]
        HX[ok], HY[ok], HZ[ok] = X[ok], Y[ok], Z[ok]

    pos = lambda a: a > 0  # noqa: E731
    neg = lambda a: a < 0  # noqa: E731
    anyd = lambda a: np.ones(a.shape, bool)  # noqa: E731
    plane(1, 0.0, {0: (-RS, RS), 2: (-RS, RS)}, "floor", lambda X, Y, Z: X, lambda X, Y, Z: Z, neg)
    plane(0, -RS, {1: (0, CUT), 2: (-RS, RS)}, "left", lambda X, Y, Z: Z, lambda X, Y, Z: Y, neg)
    plane(0, RS, {1: (0, CUT), 2: (-RS, RS)}, "right", lambda X, Y, Z: -Z, lambda X, Y, Z: Y, pos)
    plane(2, RS, {1: (0, CUT), 0: (-RS, RS)}, "front", lambda X, Y, Z: X, lambda X, Y, Z: Y, pos)
    # section caps on the cut walls (the wall's thickness seen from above)
    plane(1, CUT, {0: (-RS - WT, -RS), 2: (-RS - WT, RS + WT)}, "cap", lambda X, Y, Z: X, lambda X, Y, Z: Z, neg)
    plane(1, CUT, {0: (RS, RS + WT), 2: (-RS - WT, RS + WT)}, "cap", lambda X, Y, Z: X, lambda X, Y, Z: Z, neg)
    plane(1, CUT, {0: (-RS, RS), 2: (RS, RS + WT)}, "cap", lambda X, Y, Z: X, lambda X, Y, Z: Z, neg)
    # the back wall, cut to a stub: its outer face and its cap
    plane(2, -RS - WT, {0: (-RS - WT, RS + WT), 1: (0, STUB)}, "stub", lambda X, Y, Z: -X, lambda X, Y, Z: Y, pos)
    plane(1, STUB, {0: (-RS - WT, RS + WT), 2: (-RS - WT, -RS)}, "cap", lambda X, Y, Z: X, lambda X, Y, Z: Z, neg)
    sid = np.array([s or "" for s in SURF], object)[surf]
    G, N, MAT = B.G, B.N, B.MAT
    img = np.full((H, W), N["VOID"], np.uint8)
    mat = np.zeros((H, W), np.uint8)
    kind = np.zeros((H, W), np.uint8)
    walls = (sid == "left") | (sid == "right") | (sid == "front")
    img[walls] = N["PLASTER"]
    mat[walls] = MAT["plaster"]
    kind[walls] = 1
    # baseboard (as in build.shell)
    base = walls & (HY < 0.45)
    img[base] = N["OAK_DK"]
    img[walls & (HY >= 0.40) & (HY < 0.45)] = N["OAK_0"]
    mat[base] = MAT["wood_furniture"]
    # the vertical corners: a 1 px darker seam where two walls meet
    wid = np.where(walls, surf, 0)
    edge = np.zeros((H, W), bool)
    edge[:, 1:] = (wid[:, 1:] != wid[:, :-1]) & walls[:, 1:] & walls[:, :-1]
    img[edge] = N["PLASTER_0"]
    fl = sid == "floor"
    pi = np.floor(HX / B.PLANK_W).astype(np.int32)
    mat[fl] = MAT["wood_floor"]
    kind[fl] = 2
    tones = np.array([N[c] for c in ("OAK_0", "OAK_0", "OAK_1", "OAK_0", "OAK_DK", "OAK_1", "OAK_0", "OAK_2")], np.uint8)
    seg = np.zeros((H, W), np.int32)
    for p in np.unique(pi[fl]):
        m = fl & (pi == p)
        off = B.hash01("plank-off", int(p)) * 6.0
        seglen = 5.0 + B.hash01("plank-len", int(p)) * 4.0
        seg[m] = np.floor((HZ[m] + 40 + off) / seglen).astype(np.int32)
    board = pi * 97 + seg
    tone_of = {}
    for b in np.unique(board[fl]):
        tone_of[int(b)] = int(B.hash01("tone", int(b)) * 8)
    if fl.any():
        img[fl] = tones[np.vectorize(tone_of.get)(board[fl])]
    bid = np.where(fl, board, -999999)
    sx = np.zeros((H, W), bool)
    sx[:, 1:] = (bid[:, 1:] != bid[:, :-1]) & fl[:, 1:] & fl[:, :-1]
    sy = np.zeros((H, W), bool)
    sy[1:, :] = (bid[1:, :] != bid[:-1, :]) & fl[1:, :] & fl[:-1, :]
    img[sx | sy] = N["OAK_VD"]
    stub = sid == "stub"
    img[stub] = N["PLASTER_2"]
    mat[stub] = MAT["plaster"]
    kind[stub] = 1
    cap = sid == "cap"
    img[cap] = N["PLASTER_3"]
    mat[cap] = MAT["plaster"]
    # INK edges on the section caps (the cut reads as a cut)
    capk = cap.astype(np.int8)
    ce = cap & ~(np.roll(cap, 1, 0) & np.roll(cap, -1, 0) & np.roll(cap, 1, 1) & np.roll(cap, -1, 1))
    img[ce] = N["INK"]
    se = stub & ~(np.roll(stub, 1, 1) & np.roll(stub, -1, 1)) | (stub & ~np.roll(stub, -1, 0))
    img[se] = N["INK"]
    del capk
    for name, (oid, nm) in WALL_OID.items():
        m = sid == name
        G.names[oid] = nm
        G.img[m] = img[m]
        G.oid[m] = oid
        G.mat[m] = mat[m]
        G.kind[m] = kind[m]
        G.su[m] = U[m]
        G.sv[m] = V[m]
        G.dist[m] = best[m]
    G.shell_mask = sid != ""
    G.floor_xz = (HX, HZ, fl)


def composite(B, layers):
    """Floor-level pieces (rugs, mats) first, then everything far to near."""
    G = B.G
    for L in sorted(layers, key=lambda d: (d["ymax"] > 0.2, -d["depth"], d["i"])):
        m = L["img"] != B.T
        G.img[m] = L["img"][m]
        G.oid[m] = L["oid"]
        G.emit[m] = L["emit"][m]
        G.kind[m] = 7
        ys, xs = np.nonzero(m)
        G.su[m] = xs / 20.0
        G.sv[m] = ys / 20.0
        G.dist[m] = L["depth"]


def render(B, var=None, tod="golden", textured=True, tier=3):
    """One overview render: albedo, oid, material, emit (B.G buffers, SIZE). Call inside patched(B)."""
    import textures
    layers = draw_objects(B, var, tod, tier)
    shell_cast(B)
    G = B.G
    G.shell_img = G.img.copy()
    composite(B, layers)
    B.assign_materials()
    st_ids = [L["oid"] for L in layers if L.get("stamp")]
    st_m = np.isin(G.oid, st_ids)
    st_px = G.img[st_m].copy()
    if textured:
        wx, wy = proj(3.4, 6.0, RS)
        textures.apply(G.img, G.mat, {"kind": G.kind, "u": G.su, "v": G.sv, "dist": G.dist}, G.oid, G.names,
                       np.full(G.img.shape, 0.7, np.float32), "top", 3, seed=0,
                       opts={"window_px": (int(wx), int(wy)), "wear_paths": B.WEAR_PATHS})
        B.fold_lone()
        B.cap_3x3()
        G.img[st_m] = st_px
    G.stamp_mask = st_m
    return G


def preview(path=None, scale=2):
    import build as B
    set_cam()
    with patched(B):
        img = render(B).img.copy()
    out = path or os.path.join(HERE, "..", "..", "..", "ov-preview.png")
    Image.fromarray(B.RGB[img]).resize((SIZE[0] * scale, SIZE[1] * scale), Image.NEAREST).save(out)
    return img


def debug_labels(path, scale=3):
    """Development: the albedo at `scale` with every object's visible bbox and name."""
    import build as B
    from PIL import ImageDraw
    set_cam()
    with patched(B):
        G = render(B, textured=False)
        img, oid, names = G.img.copy(), G.oid.copy(), dict(G.names)
    im = Image.fromarray(B.RGB[img]).resize((SIZE[0] * scale, SIZE[1] * scale), Image.NEAREST)
    d = ImageDraw.Draw(im)
    rng = np.random.RandomState(3)
    for o in np.unique(oid):
        if o < 10:
            continue
        ys, xs = np.nonzero(oid == o)
        c = tuple(int(v) for v in rng.randint(80, 255, 3))
        d.rectangle([xs.min() * scale, ys.min() * scale, xs.max() * scale + scale - 1, ys.max() * scale + scale - 1], outline=c)
        d.text((xs.min() * scale + 2, ys.min() * scale + 1), names.get(int(o), "?"), fill=c)
    im.save(path)


def crop4(img_or_path, box, path, scale=4):
    """Development: a master crop at `scale` (LOOK at every miniature this way)."""
    import build as B
    a = np.load(img_or_path) if isinstance(img_or_path, str) else img_or_path
    x0, y0, x1, y1 = box
    Image.fromarray(B.RGB[a[y0:y1, x0:x1]]).resize(((x1 - x0) * scale, (y1 - y0) * scale), Image.NEAREST).save(path)
