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
    keep = {k: getattr(B, k) for k in ("pj", "sc", "box3d", "obj", "W", "H", "books_row", "face_record", "sky")}
    B.W, B.H = SIZE
    B.pj, B.sc, B.box3d, B.obj = _pj, _sc, _box3d, _obj
    B.books_row = _books_row_guard(keep["books_row"])
    B.face_record = lambda *a, **k: None

    def sky(x0, y0, x1, y1):
        # the window is shorter in the overview: the night sky's star rows can run out of room
        try:
            keep["sky"](x0, y0, x1, y1)
        except ValueError:
            B.R(x0, y0, x1, y1, "NAVY" if B.TOD == "night" else "PLUM_2")
    B.sky = sky
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
krrrrrrrrrrrrrrrrrrk
kpppppppppppppppppPk
kpPPpPPpPPpPPpPPppPk
kpppppppppppppppppPk
kpPPpPPpPPpRRpPPppPk
kpppppppppppppppppPk
kpPPpPPpPPpPPpPPppPk
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


ARCHIVE = """
kkkkkkkkk
kDwwwwwDk
kDtssssDk
kDtgggsDk
kDtsgssDk
kDtgggsDk
kDSSSSSDk
kDtssssDk
kDtsTssDk
kDtTTTsDk
kDSSSSSDk
kDtssssDk
kDtaaasDk
kDtAaasDk
kDSSSSSDk
kDDDDDDDk
kkkkkkkkk
"""


def mini_archive(B):
    put(B, tpl(ARCHIVE), -7.5, 0.0, 12.8)


# object name -> (view the room draws it in, drawer). The room object is not drawn; the miniature takes its name,
# so the hotspot twin's mask and the wire still come from that name.
STAMPS = {
    "knight": ("front", mini_knight),
    "trophy-case": ("front", mini_archive),
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
    mat[ce] = MAT["cast_iron"]
    se = stub & ~(np.roll(stub, 1, 1) & np.roll(stub, -1, 1)) | (stub & ~np.roll(stub, -1, 0))
    img[se] = N["INK"]
    mat[se] = MAT["cast_iron"]
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


def stamp_materials(B):
    """Palette index -> material ID for miniature pixels."""
    fam = {"OAK": "wood_furniture", "LEAF": "leaf", "SLATE": "metal_painted", "GOLD": "gold_metal", "SUN": "gold_metal",
           "AMBER": "gold_metal", "PLUM": "fabric_cotton", "TERRA": "fabric_cotton", "CRT": "fabric_cotton",
           "CREAM": "paper", "PAPER": "paper", "ENERGY": "neon", "VIOLET": "glass_crt", "NAVY": "glass_crt",
           "COOL": "glass_crt", "INK": "cast_iron", "VOID": "cast_iron", "BROWN": "cast_iron", "GLOW": "bulb",
           "ORANGE": "bulb", "RIM": "fabric_cotton", "PLASTER": "plaster"}
    out = np.zeros(256, np.uint8)
    for i, nm in B.N_INV.items():
        out[i] = B.MAT[fam.get(nm.split("_")[0], "plastic")]
    return out


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
    # miniatures: material by colour family, their INK outline its own (cast iron) region, so each flat cluster is
    # judged as the cluster it is (the texture gate measures per material region)
    fam = stamp_materials(B)
    G.mat[st_m] = fam[G.img[st_m]]
    if textured:
        wx, wy = proj(3.4, 6.0, RS)
        textures.apply(G.img, G.mat, {"kind": G.kind, "u": G.su, "v": G.sv, "dist": G.dist}, G.oid, G.names,
                       np.full(G.img.shape, 0.7, np.float32), "top", 3, seed=0,
                       opts={"window_px": (int(wx), int(wy)), "wear_paths": B.WEAR_PATHS})
        # hotspots read against their backdrop (TEXTURE_SPEC 5.13), as build.apply_textures does in the room
        hs = set()
        for v in B.VIEW_IDS:
            hs |= B.hotspot_objects(v)
        for nm in sorted(hs - set(STAMPS)):
            ids = [o for o, n in G.names.items() if n.split("@")[0] == nm and o >= 10]
            m = np.isin(G.oid, ids)
            if not m.any():
                continue
            before = G.img.copy()
            textures.selout(G.img, m, backdrop=G.shell_img, light_px=(int(wx), int(wy)), hotspot=True, add=True)
            grown = (G.img != before) & ~m & ~st_m
            if grown.any():
                vals, cnt = np.unique(G.mat[m], return_counts=True)
                G.oid[grown] = ids[0]
                G.mat[grown] = vals[np.argmax(cnt)]
            _, fail = textures.hotspot_contrast(G.img, m | grown, G.shell_img, steps=4.0)
            G.img[fail & ~st_m] = B.N["INK"]
        B.fold_lone()
        B.cap_3x3(passes=20)
        G.img[st_m] = st_px
    G.stamp_mask = st_m
    return G


# ---------------------------------------------------------------- export (build.py hook)
GLOW_K = 0.4            # overview px per room px at a typical depth (glow radii drawn in room px by the scenes)
MIN_HIT = 11            # same floor as the room's hotspots (overlay.js grows every target to 44 CSS)


def _render_key(B, k, tod="golden"):
    """One state render: the room's per-key variable map across the four views (build.tag_state rules)."""
    if k.startswith("t") and k[1:].isdigit():
        return render(B, {}, tod, tier=int(k[1:]))
    var = {}
    if k not in ("base", "night"):
        for v in B.VIEW_IDS:
            var.update(B.TAGVAR.get((v, k), {}))
    return render(B, var, tod)


def _snap(G):
    return {"img": G.img.copy(), "mat": G.mat.copy(), "oid": G.oid.copy(), "names": dict(G.names),
            "screens": dict(G.screens), "glows": list(G.glows)}


def _mask(r, objs):
    want = {o.split("@")[0] for o in objs}
    ids = [o for o, n in r["names"].items() if o >= 10 and n.split("@")[0] in want]
    return np.isin(r["oid"], ids)


def _shell_only(B, tod):
    """The complete shell plate (floor, three walls, stub, caps) with no objects, textured (world u/v)."""
    import textures
    B.TOD = tod
    B.new_scene()
    shell_cast(B)
    G = B.G
    wx, wy = proj(3.4, 6.0, RS)
    textures.apply(G.img, G.mat, {"kind": G.kind, "u": G.su, "v": G.sv, "dist": G.dist}, G.oid, G.names,
                   np.full(G.img.shape, 0.7, np.float32), "top", 3, seed=0,
                   opts={"window_px": (int(wx), int(wy)), "wear_paths": B.WEAR_PATHS})
    fold_shell(G.img, G.mat, G.shell_mask)
    return {"img": G.img.copy(), "mat": G.mat.copy(), "mask": G.shell_mask.copy()}


def _write(B, item_id, view, arrays, mats, rel_dir):
    """Crop every variant to the union bbox and save PNG + .mat.png. Returns (x0, y0, x1, y1) master, variants."""
    box = B.union([B.bbox(a) for a in arrays.values()])
    if box is None:
        return None, {}
    x0, y0, x1, y1 = box
    zone, name = item_id.split(".", 1) if "." in item_id else ("shell", item_id)
    variants = {}
    for k, a in arrays.items():
        rel = f"{SPR}/{rel_dir or zone}/{name}.{k}.png"
        B.save_png(a[y0:y1, x0:x1], os.path.join(B.PROTO, rel))
        B.save_mat(mats[k][y0:y1, x0:x1], a[y0:y1, x0:x1], os.path.join(B.PROTO, rel[:-4] + ".mat.png"))
        variants[k] = rel
    return box, variants


def _dedupe(arrays, mats):
    """Variant arrays identical to base become aliases (one image)."""
    alias = {}
    base = arrays.get("base")
    for k in list(arrays):
        if k != "base" and base is not None and np.array_equal(arrays[k], base):
            alias[k] = "base"
            del arrays[k]
            mats.pop(k, None)
    return alias


def fold_shell(img, mat, mask, passes=4):
    """A lone pixel (no 4-neighbour of its colour in its material region) takes its region neighbours' commonest
    colour: the compressed side walls turn fine plaster marks into specks (TEXTURE_SPEC 9 noise rule)."""
    H, W = img.shape
    for _ in range(passes):
        nb = []
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            c = np.full((H, W), -1, np.int32)
            m = np.full((H, W), -1, np.int32)
            ys0, ys1 = max(0, dy), H + min(0, dy)
            xs0, xs1 = max(0, dx), W + min(0, dx)
            c[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx] = img[ys0:ys1, xs0:xs1]
            m[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx] = np.where(mask[ys0:ys1, xs0:xs1], mat[ys0:ys1, xs0:xs1].astype(np.int32), -1)
            nb.append((c, m))
        same = np.zeros((H, W), bool)
        has = np.zeros((H, W), bool)
        for c, m in nb:
            inr = m == mat
            same |= inr & (c == img)
            has |= inr
        lone = mask & has & ~same
        if not lone.any():
            break
        ys, xs = np.nonzero(lone)
        for y, x in zip(ys, xs):
            vals = [int(c[y, x]) for c, m in nb if m[y, x] == mat[y, x]]
            img[y, x] = max(set(vals), key=vals.count)


def anchors_of(B, items, zone_items):
    """zones.views.top.anchors: per wall the overview rect its rest framing covers (the wall and the floor wedge in
    front of it), per zone the union of its twins (padded): D4's anchor(place) data."""
    out = {}
    walls = {"front": [(-RS, 0, RS), (RS, 0, RS), (-RS, CUT, RS), (RS, CUT, RS)],
             "back": [(-RS, 0, -RS), (RS, 0, -RS), (-RS, STUB, -RS - WT), (RS, STUB, -RS - WT)],
             "left": [(-RS, 0, -RS), (-RS, 0, RS), (-RS, CUT, -RS), (-RS, CUT, RS)],
             "right": [(RS, 0, -RS), (RS, 0, RS), (RS, CUT, -RS), (RS, CUT, RS)]}
    for v, pts in walls.items():
        pp = [world_px(*p) for p in pts + [(0.0, 0.0, 0.0)]]
        x0, y0 = min(p[0] for p in pp), min(p[1] for p in pp)
        x1, y1 = max(p[0] for p in pp), max(p[1] for p in pp)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, CORE[2] - CORE[0]), min(y1, CORE[3] - CORE[1])
        out[v] = [x0, y0, x1 - x0, y1 - y0]
    for z, its in zone_items.items():
        if not its:
            continue
        x0 = min(i["x"] for i in its) - 6
        y0 = min(i["y"] for i in its) - 6
        x1 = max(i["x"] + i["w"] for i in its) + 6
        y1 = max(i["y"] + i["h"] for i in its) + 6
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        w, h = max(40, x1 - x0), max(30, y1 - y0)
        cw, ch = CORE[2] - CORE[0], CORE[3] - CORE[1]
        ax0, ay0 = max(0, int(round(cx - w / 2))), max(0, int(round(cy - h / 2)))
        ax1, ay1 = min(cw, int(round(cx + w / 2))), min(ch, int(round(cy + h / 2)))
        out[z] = [ax0, ay0, ax1 - ax0, ay1 - ay0]
    return out


def territory_of(anchors, zones_list):
    """Floor territory per zone for placeAt (empty-floor click = DESCEND into that zone): the floor quad split by
    nearest zone centre, as polygons in overview px; plus the whole room outline (outside = nothing)."""
    floor = [world_px(-RS, 0, -RS), world_px(RS, 0, -RS), world_px(RS, 0, RS), world_px(-RS, 0, RS)]
    top = [world_px(-RS, CUT, RS), world_px(RS, CUT, RS)]
    room = [floor[0], floor[1], world_px(RS, CUT, -RS), top[1], top[0], world_px(-RS, CUT, -RS)]
    cells = []
    cs = {z: (a[0] + a[2] / 2, a[1] + a[3] / 2) for z, a in anchors.items() if z in zones_list}
    # raster Voronoi over the room outline at 4 px, then each cell's convex hull
    from PIL import ImageDraw
    w, h = CORE[2] - CORE[0], CORE[3] - CORE[1]
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in room], fill=1)
    M = np.array(m) > 0
    ys, xs = np.nonzero(M[::4, ::4])
    ys, xs = ys * 4, xs * 4
    names = list(cs)
    C = np.array([cs[z] for z in names])
    d = (xs[:, None] - C[None, :, 0]) ** 2 + (ys[:, None] - C[None, :, 1]) ** 2
    own = d.argmin(1)
    for k, z in enumerate(names):
        pts = np.stack([xs[own == k], ys[own == k]], 1)
        if len(pts) < 3:
            continue
        cells.append({"zone": z, "poly": _hull(pts)})
    return {"room": [list(map(int, p)) for p in room], "cells": cells}


def _hull(pts):
    pts = sorted(set(map(tuple, pts.tolist())))
    if len(pts) < 3:
        return [list(p) for p in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return [[int(x), int(y)] for x, y in lo[:-1] + hi[:-1]]


def lighting_top(B, r_day, r_night):
    """zones.views.top.lighting: the same schema as the wall views (LIGHTING_SPEC 8), lights re-projected."""
    tint_rgb = {"red": (255, 64, 40), "green": (70, 255, 130), "violet": (176, 104, 255), "cyan": (70, 226, 246),
                "pink": (255, 112, 168), "ember": (255, 118, 44), "potion": (226, 112, 214), "lamp": (255, 186, 104),
                "warm": (255, 176, 96), "sun": (255, 150, 64)}

    def lights(glows, tag):
        out, seen = [], set()
        for i, g in enumerate(glows):
            c = g["c"]
            rgb = tint_rgb.get(c, (255, 176, 96)) if isinstance(c, str) else tuple(c)
            x, y = g["x"] - OX, g["y"] - OY
            if not (-20 <= x <= CORE[2] - CORE[0] + 20 and -20 <= y <= CORE[3] - CORE[1] + 20):
                continue
            key = (round(x / 5), round(y / 5), c if isinstance(c, str) else "rgb")
            if key in seen:
                continue
            seen.add(key)
            lt = {"id": f"top-{tag}{i}", "type": "point", "pos": [round(x, 1), round(y, 1)], "rgb": list(rgb),
                  "intensity": round(min(2.0, g["a"] * 4.5), 3),
                  "radius": round(max(8.0, max(g["rx"], g["ry"]) * 1.1 * GLOW_K), 1), "when": "always"}
            if g.get("ch"):
                lt["channel"] = g["ch"]
            out.append(lt)
        return out
    kx, ky = world_px(3.4, 0.0, 9.0)
    back = world_px(0.0, 0.0, RS)[1]
    mull = [list(world_px(x, 0.0, 9.6)) for x in (1.7, 5.2)]
    return {"floor": {"backLine": back, "bottom": CORE[3] - CORE[1], "squash": 1.0, "seam": "AMBER", "reflect": 0},
            "ambient": {"day": "#2A3550", "golden": "#2A2E45", "night": "#1A2040"},
            "facing": None, "yaw": None,
            "window": {"rect": None},
            "key": {"center": [kx, ky], "radius": [96, 44], "offscreen": None, "mullions": mull},
            "lights": lights(r_day["glows"], ""), "lightsNight": lights(r_night["glows"], "n"),
            "materials": {"LEAF_1": {"translucency": 0.5}}, "noRim": ["top.*"]}


def light_top(r_day, r_night):
    """zones.views.top.light: the Canvas2D (gl=off) overlay, same schema as build.fallback_spec."""
    def spec(r, night):
        wx, wy = world_px(3.4, 6.0, RS)
        kx, ky = world_px(3.4, 0.0, 9.0)
        gl = ([dict(x=wx, y=wy, rx=60, ry=26, rgb=[70, 96, 200], a=0.14)] if night else
              [dict(x=kx, y=ky, rx=110, ry=60, rgb=[255, 150, 64], a=0.22),
               dict(x=wx, y=wy + 6, rx=50, ry=24, rgb=[255, 150, 64], a=0.18)])
        lamp = 1.45 if night else 1.0
        for g in r["glows"]:
            c = g["c"]
            rgb = list(GLOW_RGB.get(c, (255, 176, 96)) if isinstance(c, str) else c)
            gl.append(dict(x=round(g["x"] - OX, 1), y=round(g["y"] - OY, 1), rx=round(g["rx"] * GLOW_K, 1),
                           ry=round(g["ry"] * GLOW_K, 1), rgb=rgb, a=round(min(0.95, g["a"] * lamp), 3)))
            if g.get("ch"):
                gl[-1]["ch"] = g["ch"]
        amb = ((255, 120, 50), 0.06) if not night else ((40, 48, 110), 0.10)
        vc = (0.30, 0.17, 0.20) if not night else (0.20, 0.17, 0.30)
        w, h = CORE[2] - CORE[0], CORE[3] - CORE[1]
        return {"ambient": {"rgb": list(amb[0]), "a": amb[1]}, "glows": gl,
                "vignette": dict(x=w // 2, y=h // 2, rx=w * 0.75, ry=h * 0.75, inner=0.5, c=list(vc)),
                "stops": STOPS_, "fall": FALL_, "vstops": VSTOPS_}
    return {"day": spec(r_day, False), "night": spec(r_night, True)}


GLOW_RGB = {"warm": (255, 176, 96), "red": (255, 64, 40), "green": (70, 255, 130), "violet": (176, 104, 255),
            "cyan": (70, 226, 246), "pink": (255, 112, 168), "ember": (255, 118, 44), "potion": (226, 112, 214),
            "lamp": (255, 186, 104), "sun": (255, 150, 64)}
STOPS_ = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]
FALL_ = [round((1 - d * d) ** 2, 4) for d in STOPS_]
VSTOPS_ = [i / 8 for i in range(9)]


def export(B, manifest, zones):
    """build.py hook: append the top.* items to the manifest and write zones['views']['top'] (D2-FINAL 2.3)."""
    import shutil
    shutil.rmtree(os.path.join(B.PROTO, SPR), ignore_errors=True)
    globals()["GLOW_RGB"].update(getattr(B, "GLOW_RGB", {}))
    set_cam()
    room = [r for r in manifest if r.get("view") in B.VIEW_IDS]
    by_id = {r["id"]: r for r in room}
    defs = {}
    for v in B.VIEW_IDS:
        for it in B.ITEMS[v]():
            defs[it["id"]] = it
    hotspots = [r for r in room if r["kind"] == "hotspot" and not r.get("of") and not r["id"].endswith(".hero")]
    keys = sorted({k for r in hotspots for k in defs[r["id"]]["keys"]} - {"night"})
    out = []
    with patched(B):
        renders = {}
        for k in ["base"] + [k for k in keys if k != "base"]:
            renders[k] = _snap(_render_key(B, k))
        renders["night"] = _snap(render(B, {}, "night"))
        shell_day = _shell_only(B, "golden")
        shell_night = _shell_only(B, "night")
        base = renders["base"]
        claimed = np.zeros(base["img"].shape, bool)
        zone_items = {}
        # 1) hotspot twins
        for r in hotspots:
            it = defs[r["id"]]
            ks = [k for k in it["keys"] if k != "night"] or ["base"]
            arrays, mats = {}, {}
            for k in ks:
                rr = renders[k] if k in renders else base
                m = _mask(rr, it["objs"])
                arrays[k] = np.where(m, rr["img"], B.T).astype(np.uint8)
                mats[k] = rr["mat"]
            if "night" in it["keys"]:
                m = _mask(renders["night"], it["objs"])
                arrays["night"] = np.where(m, renders["night"]["img"], B.T).astype(np.uint8)
                mats["night"] = renders["night"]["mat"]
            claimed |= _mask(base, it["objs"])
            alias = dict(it["alias"])
            ali2 = _dedupe(arrays, mats) if "base" in arrays else {}
            box, variants = _write(B, r["id"], "top", arrays, mats, None)
            if box is None:
                raise SystemExit(f"overview: {r['id']} has no pixels in the overview")
            for k, src in ali2.items():
                variants[k] = variants[src]
            for k, src in alias.items():
                if src in variants and k not in variants:
                    variants[k] = variants[src]
            for k in r["variants"]:          # same keys as the room twin
                if k not in variants:
                    variants[k] = variants.get(alias.get(k, "base")) or next(iter(variants.values()))
            x0, y0, x1, y1 = box
            rec = {"id": "top." + r["id"], "zone": r["zone"], "kind": "hotspot", "view": "top", "of": r["id"],
                   "layer": 4, "x": x0 - OX, "y": y0 - OY, "w": x1 - x0, "h": y1 - y0, "variants": variants}
            pw, ph = max(0, MIN_HIT - (x1 - x0)), max(0, MIN_HIT - (y1 - y0))
            rec["hit"] = [x0 - OX - pw // 2, y0 - OY - ph // 2, x1 - x0 + pw, y1 - y0 + ph]
            a = next(iter(arrays.values()))
            ys, xs = np.nonzero(a != B.T)
            i = int(np.argmax(xs + ys))
            rec["led"] = [min(max(int(xs[i]) - 2, x0), x1 - 2) - OX, min(max(int(ys[i]) - 2, y0), y1 - 2) - OY]
            if r.get("screen") and it.get("screen") in base["screens"]:
                sx0, sy0, sx1, sy1 = base["screens"][it["screen"]]
                if sx1 - sx0 >= 3 and sy1 - sy0 >= 2:
                    rec["screen"] = [int(sx0) - OX, int(sy0) - OY, int(sx1 - sx0), int(sy1 - sy0)]
            # D3 wire for the overview twin (rest / hot only: no cage)
            wires = {}
            for k, aa in arrays.items():
                if k == "night":
                    continue
                w = B.wire_from_mask(aa != B.T, None, B.WIRE_SHAPE.get(r["id"], "hull"))
                if w is None:
                    continue
                wires[k] = {"hull": [int(v) for q in w["pts"] for v in (q[0] - x0, q[1] - y0)],
                            "nodes": [int(v) for q in w["nodes"] for v in (q[0] - x0, q[1] - y0)],
                            "cage": None, "cageNodes": None, "gate": None}
            bk = "base" if "base" in wires else next(iter(wires))
            rec["wire"] = {"base": wires[bk]}
            rec["wire"].update({k: d for k, d in wires.items() if k != bk and d != wires[bk]})
            rec["note"] = "v3.5 overview twin (D2): " + ("authored miniature" if any(
                o.split("@")[0] in STAMPS for o in it["objs"]) else "re-projected through the overview camera")
            out.append(rec)
            zone_items.setdefault(r["zone"], []).append(rec)
        # 2) decor: the room's decor items, visible pixels (base, + night where the room has a night variant)
        used = set()
        for v in B.VIEW_IDS:
            for it in B.ITEMS[v]():
                if it["kind"] != "decor" or not it["objs"] or it["id"] in used:
                    continue
                m = _mask(base, it["objs"]) & ~claimed
                if m.sum() < 4:
                    continue
                used.add(it["id"])
                claimed |= m
                arrays = {"base": np.where(m, base["img"], B.T).astype(np.uint8)}
                mats = {"base": base["mat"]}
                if "night" in it["keys"]:
                    mn = _mask(renders["night"], it["objs"]) & m
                    arrays["night"] = np.where(mn, renders["night"]["img"], B.T).astype(np.uint8)
                    mats["night"] = renders["night"]["mat"]
                    _dedupe(arrays, mats)
                box, variants = _write(B, it["id"], "top", arrays, mats, None)
                if "night" not in variants and "night" in it["keys"]:
                    variants["night"] = variants["base"]
                x0, y0, x1, y1 = box
                out.append({"id": "top." + it["id"], "zone": it["zone"], "kind": "decor", "view": "top", "layer": 3,
                            "x": x0 - OX, "y": y0 - OY, "w": x1 - x0, "h": y1 - y0, "variants": variants,
                            "note": "v3.5 overview decor (D2 M1/M5)"})
        # 3) the rest of the objects (window, curtains, corner pieces): one shell overlay, base + night
        rest = (base["oid"] >= 10) & ~claimed
        restn = (renders["night"]["oid"] >= 10) & rest
        arrays = {"base": np.where(rest, base["img"], B.T).astype(np.uint8),
                  "night": np.where(restn, renders["night"]["img"], B.T).astype(np.uint8)}
        mats = {"base": base["mat"], "night": renders["night"]["mat"]}
        box, variants = _write(B, "shell.top-window", "top", arrays, mats, "shell")
        x0, y0, x1, y1 = box
        out.append({"id": "shell.top-window", "zone": "shell", "kind": "shell", "view": "top", "layer": 2,
                    "x": x0 - OX, "y": y0 - OY, "w": x1 - x0, "h": y1 - y0, "variants": variants,
                    "note": "v3.5 overview: window, curtains and corner pieces"})
        # 4) the shell plate: floor, three cut walls, the back-wall stub, section caps (complete under everything)
        sm = shell_day["mask"]
        arrays = {"base": np.where(sm, shell_day["img"], B.T).astype(np.uint8)}
        mats = {"base": shell_day["mat"]}
        box, variants = _write(B, "shell.top", "top", arrays, mats, "shell")
        variants["night"] = variants["base"]
        x0, y0, x1, y1 = box
        out.append({"id": "shell.top", "zone": "shell", "kind": "shell", "view": "top", "layer": 1,
                    "x": x0 - OX, "y": y0 - OY, "w": x1 - x0, "h": y1 - y0, "variants": variants,
                    "note": "v3.5 overview shell plate (D2 2.1): lid off, back wall cut to a stub, section caps"})
        del shell_night
        lighting = lighting_top(B, renders["base"], renders["night"])
        light = light_top(renders["base"], renders["night"])
    manifest.extend(out)
    anchors = anchors_of(B, out, zone_items)
    zone_ids = [z["id"] for z in zones.get("zones", [])]
    w, h = CORE[2] - CORE[0], CORE[3] - CORE[1]
    zones.setdefault("views", {})["top"] = {
        "art": {"x": -OX, "y": -OY, "w": SIZE[0], "h": SIZE[1]}, "core": [0, 0, w, h],
        "camera": {"pos": list(POS), "target": list(TGT), "f": FOC, "master": list(SIZE), "crop": list(CORE)},
        "lighting": lighting, "light": light, "anchors": anchors, "territory": territory_of(anchors, zone_ids),
        "_note": "v3.5 overview (D2-FINAL): world px = master - crop top-left; core = the diorama rect the engine "
                 "fits; anchors = the overview rect of each wall's rest framing and each zone (anchor(place))."}
    print(f"  view top: {len(out)} items ({sum(1 for r in out if r['kind'] == 'hotspot')} twins)")
    return out


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


def dev_export():
    """Development: run export() against the committed manifest/zones (no full build); prints a summary."""
    import json
    import build as B
    man = json.load(open(os.path.join(HERE, "manifest.json")))["items"]
    man = [r for r in man if r.get("view") != "top"]
    for v in B.VIEW_IDS:
        for it in B.ITEMS[v]():
            if it["kind"] != "shell" and it["id"] != "window.statue":
                for k in it["keys"]:
                    if k not in ("base", "night"):
                        B.TAGVAR.setdefault((v, k), {})[it["id"]] = k
    zones = json.load(open(os.path.join(HERE, "zones.json")))
    out = export(B, man, zones)
    return out, zones
