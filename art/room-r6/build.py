#!/usr/bin/env python3
"""FORGE dorm room, art pass 6 (v3.4): one continuous four-wall room, albedo only, material and surface maps.

What changed from art pass 5 (art/room-r5/build.py, which this file is forked from)
  * Geometry: one square room, 28 x 28 ft, ceiling 13.5 ft, the camera at its centre (0, EYE, 0). The four views
    (front, right, back, left) are 90 degree faces of that one camera (a cube-map strip), so a turn is a pure yaw
    and every corner is the same 3D geometry in both views that meet there. World axes: X right, Y up, Z toward
    the window (front wall at Z = +14).
  * Each view draws its own wall's furniture in that wall's local frame (lateral X along the wall, z = distance
    from the wall, camera at z = D0 = 14), keeping every object inside its wedge (|X| + z <= 14) so no object is
    cut by a diagonal. Shell surfaces, beams, string lights, hanging plants and the four corner objects are world
    geometry drawn in every view. Each view's outer margins (rays beyond 45 degrees) are then filled by
    re-projecting the neighbour view, so a wide screen shows the true corner.
  * Albedo only (TEXTURE_SPEC golden rule): no baked light levels, rim, tints, reflections, sun patch or painted
    night twins. Light is the engine's (LIGHTING_SPEC). Every pixel also carries a material ID and surface
    coordinates (kind, u, v in feet, distance) for the texture library (art/room-r6/textures.py) and the shader.
  * 64-colour palette (art/room-r6/palette.json).

Run:  python3 art/room-r6/build.py            (stills, then the layered live export; --stills-only / --live-only)
Out:  docs/redesign/room-r6/stills/*, docs/redesign/room-prototype/art-r6/<view>/..., art/room-r6/{manifest,zones}.json
Then: python3 art/room-v3/merge.py --src room-r6 && node scripts/room-sync.mjs
"""
import hashlib
import json
import math
import os
import random
import sys
from contextlib import contextmanager

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs", "redesign", "room-r6", "stills")
sys.path.insert(0, HERE)

# ---------------------------------------------------------------- palette (64; indices 0..36 = art pass 5)
PAL5 = [
    ("VOID", "#0C0A0C"), ("INK", "#141517"), ("OAK_0", "#5C3721"), ("VIOLET", "#9466DA"),
    ("BROWN_1", "#312D2A"), ("BROWN_2", "#50302E"), ("TERRA_0", "#621D1A"), ("TERRA_1", "#8E432D"),
    ("TERRA_2", "#B45B40"), ("RIM", "#DA6339"), ("ORANGE", "#F26B2A"), ("GLOW", "#F39041"),
    ("AMBER", "#CE8446"), ("SUN", "#FEF576"), ("GOLD", "#D9A441"), ("GOLD_DK", "#6E5422"),
    ("OAK_1", "#7E4C27"), ("OAK_2", "#A56A32"), ("LEAF_0", "#212C26"), ("LEAF_1", "#344136"),
    ("LEAF_2", "#3E6B35"), ("LEAF_3", "#7FA650"), ("SLATE_0", "#3E4F51"), ("SLATE_1", "#56858A"),
    ("SLATE_2", "#9CC0C2"), ("OAK_DK", "#45291A"), ("PLUM_1", "#724F5B"), ("PLUM_2", "#AF4D61"),
    ("PLUM_3", "#D98AA0"), ("CRT_0", "#D2211A"), ("CRT_1", "#FC3827"), ("CREAM", "#F4E6C4"),
    ("PLASTER_0", "#1E151D"), ("PLASTER", "#36232F"), ("NAVY", "#1B2552"), ("ENERGY", "#3FD8E8"),
    ("ENERGY_HI", "#D4FFFB"),
]
NEW27 = [("OAK_VD", "#2E1A12"), ("OAK_3", "#C0864A"), ("PLASTER_1", "#2A1B26"), ("PLASTER_2", "#43303B"),
         ("PLASTER_3", "#553C49"), ("PLASTER_4", "#6B4C58"), ("INK_2", "#221E24"), ("PLUM_0", "#4A2E3A"),
         ("PLUM_4", "#F0B8C6"), ("TERRA_VD", "#3F1312"), ("SLATE_D", "#2A3638"), ("SLATE_3", "#C4DADB"),
         ("COOL_0", "#1E2632"), ("COOL_1", "#2B3646"), ("COOL_2", "#3D4A60"), ("PAPER", "#D9C9A6"),
         ("PAPER_DK", "#A8987A"), ("LEAF_4", "#B7CE74"), ("GOLD_MID", "#A47A30"), ("GOLD_HI", "#F2D27A"),
         ("RAIN_0", "#5D7FA6"), ("RAIN_1", "#8FA9C9"), ("RAIN_HI", "#C9DAEE"), ("GLASS_DK", "#1A2228"),
         ("LINEN_1", "#BFAE95"), ("LINEN_2", "#8C7C6C"), ("HAZE", "#4A3F4C")]


def load_palette():
    p = os.path.join(HERE, "palette.json")
    if os.path.exists(p):
        cols = [tuple(c[:2]) for c in json.load(open(p))["colors"]]
        if len(cols) == 64 and [c[0] for c in cols[:37]] == [c[0] for c in PAL5]:
            return cols
    return PAL5 + NEW27


PAL = load_palette()
N = {n: i for i, (n, _) in enumerate(PAL)}
N_INV = {i: n for n, i in N.items()}
RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for _, h in PAL] + [[0, 0, 0]] * (256 - len(PAL)), np.uint8)
T = 255
FLAT = [int(v) for v in RGB.flatten()]

# ---------------------------------------------------------------- materials (TEXTURE_SPEC section 4)
MAT = {"none": 0, "plaster": 1, "plaster_venetian": 2, "wood_floor": 3, "wood_furniture": 4, "wood_ceiling": 5,
       "fabric_cotton": 6, "fabric_velvet": 7, "rug_pile": 8, "paper": 9, "cork": 10, "metal_painted": 11,
       "metal_brushed": 12, "chrome": 13, "cast_iron": 14, "gold_metal": 15, "stone": 16, "glass_window": 17,
       "glass_crt": 18, "screen_emissive": 19, "plastic": 20, "leaf": 21, "soil": 22, "terracotta": 23,
       "ceramic": 24, "book_cloth": 25, "neon": 26, "bulb": 27, "flame": 28, "wet": 29, "sky": 30}

# ---------------------------------------------------------------- camera: one room, four faces
W, H = 800, 560
RS = 14.0                    # half side of the square room (ft): walls at X = +-14, Z = +-14
WX, CEIL = RS, 13.5
EYE = 6.5
F = 278.0                    # art px focal length: 90 degrees across the 556 px core
D0 = RS                      # camera distance from the view's wall
CX, CY = 400.0, 243.0        # vanishing point in the master (horizon high: the floor shows, the ceiling sits above)
CORE_BOX = (122, 104, 678, 456)
XCAM = 0.0
VIEW = "front"
VIEW_IDS = ("front", "right", "back", "left")
YAW = {"front": 0, "right": 90, "back": 180, "left": 270}
VIEWS = {v: dict(F=F, D0=D0, EYE=EYE, CX=CX, CY=CY, WX=WX, XCAM=0.0, core=CORE_BOX, yaw=YAW[v]) for v in VIEW_IDS}
CORE = CORE_BOX
TOD = "golden"
TIER = 3
FLAGS = {"beam": False}
NEAR = 0.6                   # near plane: never draw closer than this to the camera (ft)


def set_view(v):
    global VIEW, CORE
    VIEW = v
    CORE = VIEWS[v]["core"]


def to_local(X, Z, view=None):
    """World (X, Z) -> the view's local (lateral x, depth z from its wall). Camera at local z = D0."""
    v = view or VIEW
    if v == "front":
        return X, RS - Z
    if v == "right":
        return -Z, RS - X
    if v == "back":
        return -X, RS + Z
    return Z, RS + X


def to_world(x, z, view=None):
    """The view's local (x, z) -> world (X, Z)."""
    v = view or VIEW
    if v == "front":
        return x, RS - z
    if v == "right":
        return RS - z, -x
    if v == "back":
        return -x, z - RS
    return z - RS, x


def neighbour(v, d):
    i = VIEW_IDS.index(v)
    return VIEW_IDS[(i + d) % 4]


ZS = {"dz": 0.0}


def sc(z):
    return F / max(NEAR, D0 - z - ZS["dz"])


COMP = {"k": None}


@contextmanager
def zshift(dz):
    ZS["dz"] = dz
    yield
    ZS["dz"] = 0.0


XS = {"dx": 0.0}


@contextmanager
def xshift(dx):
    """Slide a group of a wall's furniture along the wall (lateral feet) without touching its drawing code."""
    XS["dx"] = dx
    yield
    XS["dx"] = 0.0


def pj(X, Y, z):
    s = sc(z)
    return (CX + (X + XS["dx"] - XCAM) * s, CY - (Y - EYE) * s)


def wp(X, Y, Z):
    """Project a world point in the current view."""
    lx, lz = to_local(X, Z)
    return pj(lx, Y, lz)


def pji(X, Y, z):
    x, y = pj(X, Y, z)
    return int(round(x)), int(round(y))


def in_front(lz, margin=NEAR):
    return D0 - lz > margin


def clip3(pts, zmax=None):
    """Clip a local 3D polygon [(x, y, z)] to the near plane (keep z <= D0 - NEAR)."""
    zmax = D0 - NEAR if zmax is None else zmax
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        ia, ib = a[2] <= zmax, b[2] <= zmax
        if ia:
            out.append(a)
        if ia != ib:
            t = (zmax - a[2]) / (b[2] - a[2])
            out.append(tuple(a[k] + (b[k] - a[k]) * t for k in range(3)))
    return out


# ---------------------------------------------------------------- live-export state
VAR = {}
AF = {}
STAGE = {"s0": 0, "s1": 1, "s2": 2}
SHELL_NAMES = {"ceiling", "wall-L", "wall-R", "wall-B", "floor", "window-view", "window-sky", "window-frame",
               "curtains", "shell", "margin", "beams"}


def vk(k, d="base"):
    return VAR.get(k, d)


def stg(k):
    """Stage 0..2 of a skill object (base = s1)."""
    return STAGE.get(VAR.get(k, "s1"), 1)


def grow(k):
    """Growth 0..3 of a growth piece (base = g2)."""
    v = VAR.get(k, "g2")
    return int(v[1]) if v.startswith("g") else 2


def af(ch):
    return AF.get(ch, 0)


# ---------------------------------------------------------------- scene buffers
# Per master pixel: img (palette index), oid (object), emit (emissive), mat (material ID), and the surface
# description the texture library reads: kind (0 none, 1 wall, 2 floor, 3 ceiling, 4 object front face,
# 5 object side face, 6 object top, 7 flat sprite), u and v (feet along the surface), dist (feet from the camera).
class G:
    img = None
    oid = None
    emit = None
    mat = None
    kind = None
    su = None
    sv = None
    dist = None
    shadow = None
    order = {}
    names = {}
    nxt = 10
    ghost = False
    lights = []
    tints = []
    glows = []


def new_scene():
    G.img = np.full((H, W), N["VOID"], np.uint8)
    G.oid = np.zeros((H, W), np.int16)
    G.emit = np.zeros((H, W), bool)
    G.mat = np.zeros((H, W), np.uint8)
    G.kind = np.zeros((H, W), np.uint8)
    G.su = np.zeros((H, W), np.float32)
    G.sv = np.zeros((H, W), np.float32)
    G.dist = np.full((H, W), 99.0, np.float32)
    G.shadow = np.zeros((H, W), np.float32)
    G.order = {0: 0}
    G.names = {0: "void"}
    G.nxt = 10
    G.lights = []
    G.tints = []
    G.glows = []
    G.objmat = {}
    G.win = None
    G.sunfloor = (0, 400)
    G.gmask = {}
    G.screens = {}
    G.cones = []


class S:
    im = None
    d = None
    em = None
    de = None
    face = None    # per-object surface: kind, u, v, dist (filled by face-aware primitives)


def _begin():
    S.im = Image.new("P", (W, H), T)
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)
    S.em = Image.new("L", (W, H), 0)
    S.de = ImageDraw.Draw(S.em)
    S.face = None


@contextmanager
def obj(name, oid=None, emit=False, mat=None):
    """Draw one object into a private layer, then composite it (later objects cover earlier ones).
    mat: the object's default material (name or {colour name: material} with a "default" key)."""
    if oid is None:
        oid = G.nxt
        G.nxt += 1
    G.names[oid] = name
    G.order[oid] = len(G.order) + 1
    if mat is not None:
        G.objmat[oid] = mat
    prev = (S.im, S.d, S.em, S.de, S.face)
    _begin()
    yield oid
    a = np.array(S.im)
    m = a != T
    if G.ghost and name not in SHELL_NAMES:
        G.gmask[name] = G.gmask.get(name, np.zeros((H, W), bool)) | m
        S.im, S.d, S.em, S.de, S.face = prev
        return
    G.img[m] = a[m]
    G.oid[m] = oid
    e = np.array(S.em) > 0
    G.emit[m] = e[m] | emit
    f = S.face
    if f is not None:
        fm = m & (f[0] > 0)
        G.kind[fm] = f[0][fm]
        G.su[fm] = f[1][fm]
        G.sv[fm] = f[2][fm]
        G.dist[fm] = f[3][fm]
        fl = m & (f[0] == 0)
    else:
        fl = m
    # flat sprite pixels: u, v in feet from the object's anchor scale (screen space / px-per-foot)
    if fl.any():
        ys, xs = np.nonzero(fl)
        k = 1.0 / 20.0
        G.kind[fl] = 7
        G.su[fl] = xs * k
        G.sv[fl] = ys * k
    S.im, S.d, S.em, S.de, S.face = prev


def face_record(poly, kind, plane):
    """Record surface coordinates for the pixels of a projected face polygon of the current object.
    plane = ("z", z) front face at local depth z, ("x", x) side face at lateral x, ("y", y) top/bottom at height y."""
    if S.face is None:
        S.face = (np.zeros((H, W), np.uint8), np.zeros((H, W), np.float32), np.zeros((H, W), np.float32),
                  np.full((H, W), 99.0, np.float32))
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, x1 = max(0, int(min(xs)) - 1), min(W, int(max(xs)) + 2)
    y0, y1 = max(0, int(min(ys)) - 1), min(H, int(max(ys)) + 2)
    if x1 <= x0 or y1 <= y0:
        return
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(m).polygon([(int(round(x - x0)), int(round(y - y0))) for x, y in poly], fill=1)
    M = np.array(m) > 0
    if not M.any():
        return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    rx = (xx + 0.5 - CX) / F
    ry = -(yy + 0.5 - CY) / F
    with np.errstate(divide="ignore", invalid="ignore"):
        if plane[0] == "z":
            t = np.full_like(rx, D0 - plane[1])
            u = XCAM + rx * t
            v = EYE + ry * t
        elif plane[0] == "x":
            t = (plane[1] - XCAM) / np.where(rx == 0, 1e-6, rx)
            u = D0 - t                 # depth along the side face
            v = EYE + ry * t
        else:
            t = (plane[1] - EYE) / np.where(ry == 0, 1e-6, ry)
            u = XCAM + rx * t
            v = D0 - t
    t = np.abs(t)
    k, fu, fv, fd = S.face
    sl = (slice(y0, y1), slice(x0, x1))
    k[sl][M] = kind
    fu[sl][M] = u[M]
    fv[sl][M] = v[M]
    fd[sl][M] = np.clip(t[M], 0, 98)


def ci(c):
    if c.endswith("!"):
        return N[c[:-1]], 255
    return N[c], 0



def R(x0, y0, x1, y1, c):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    if x1 < x0 or y1 < y0:
        return
    i, e = ci(c)
    S.d.rectangle([x0, y0, x1, y1], fill=i)
    S.de.rectangle([x0, y0, x1, y1], fill=e)


def P(x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < W and 0 <= y < H:
        i, e = ci(c)
        S.im.putpixel((x, y), i)
        S.em.putpixel((x, y), e)


def L(x0, y0, x1, y1, c):
    i, e = ci(c)
    p = [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))]
    S.d.line(p, fill=i)
    S.de.line(p, fill=e)


def PL(pts, c):
    i, e = ci(c)
    p = [(int(round(x)), int(round(y))) for x, y in pts]
    S.d.line(p, fill=i)
    S.de.line(p, fill=e)


def POLY(pts, c, ol=None):
    i, e = ci(c)
    p = [(int(round(x)), int(round(y))) for x, y in pts]
    S.d.polygon(p, fill=i)
    S.de.polygon(p, fill=e)
    if ol:
        PL(p + [p[0]], ol)


def ELL(x0, y0, x1, y1, c, ol=None):
    i, e = ci(c)
    b = [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))]
    if b[2] < b[0] or b[3] < b[1]:
        return
    S.d.ellipse(b, fill=i)
    S.de.ellipse(b, fill=e)
    if ol:
        io, eo = ci(ol)
        S.d.ellipse(b, outline=io)
        S.de.ellipse(b, outline=eo)


def circ(cx, cy, r, c):
    ELL(cx - r, cy - r, cx + r, cy + r, c)


def ring(cx, cy, r, c):
    i, e = ci(c)
    b = [int(round(cx - r)), int(round(cy - r)), int(round(cx + r)), int(round(cy + r))]
    S.d.ellipse(b, outline=i)
    S.de.ellipse(b, outline=e)


def BOX(x0, y0, x1, y1, f, hi=None, sh=None, ol="INK"):
    R(x0, y0, x1, y1, ol)
    R(x0 + 1, y0 + 1, x1 - 1, y1 - 1, f)
    if hi:
        L(x0 + 1, y0 + 1, x1 - 1, y0 + 1, hi)
    if sh:
        L(x0 + 1, y1 - 1, x1 - 1, y1 - 1, sh)


def sag(x0, y0, x1, y1, s, c, n=None):
    n = n or max(2, int(abs(x1 - x0) + abs(y1 - y0)))
    pts = [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n + s * 4 * (i / n) * (1 - i / n)) for i in range(n + 1)]
    PL(pts, c)
    return pts



GLOW_RGB = {"warm": (255, 176, 96), "red": (255, 64, 40), "green": (70, 255, 130), "violet": (176, 104, 255),
            "cyan": (70, 226, 246), "pink": (255, 112, 168), "ember": (255, 118, 44), "potion": (226, 112, 214),
            "lamp": (255, 186, 104), "sun": (255, 150, 64)}
CH = {"ch": None}   # anim channel that the next light()/tint() calls belong to (their strength follows its frames)


def light(cx, cy, rx, ry, amp):
    G.lights.append((cx, cy, rx, ry, amp))
    G.glows.append(dict(x=cx, y=cy, rx=rx * 1.2, ry=ry * 1.2, c="warm", a=0.20 * amp, ch=CH["ch"]))


def tint(cx, cy, rx, ry, kind, k=1.0):
    G.tints.append((cx, cy, rx, ry, kind, k))
    G.glows.append(dict(x=cx, y=cy, rx=rx * 1.6, ry=ry * 1.6, c=kind, a=0.20 * k, ch=CH["ch"]))


@contextmanager
def channel(ch):
    CH["ch"] = ch
    yield
    CH["ch"] = None


# ---------------------------------------------------------------- 3D helpers (local frame of the current view)
def box3d(X0, X1, Y0, Y1, z0, z1, front, side=None, top=None, ol="INK", bottom=None):
    """Axis-aligned box in the view's local frame. Draws the faces the camera sees and records their surfaces
    (front 4, side 5, top/bottom 6) for the texture library. Returns dict of face polygons."""
    side = side or front
    top = top or front
    z1 = min(z1, D0 - NEAR)
    if z1 <= z0:
        return {}
    a, b, c, d = pj(X0, Y1, z1), pj(X1, Y1, z1), pj(X1, Y0, z1), pj(X0, Y0, z1)
    faces = {}
    if Y1 < EYE:
        q = [pj(X0, Y1, z0), pj(X1, Y1, z0), b, a]
        POLY(q, top, ol)
        face_record(q, 6, ("y", Y1))
        faces["top"] = q
    if Y0 > EYE and bottom:
        q = [pj(X0, Y0, z0), pj(X1, Y0, z0), c, d]
        POLY(q, bottom, ol)
        face_record(q, 6, ("y", Y0))
        faces["bottom"] = q
    if X1 + XS["dx"] < XCAM:
        q = [pj(X1, Y1, z0), pj(X1, Y1, z1), pj(X1, Y0, z1), pj(X1, Y0, z0)]
        POLY(q, side, ol)
        face_record(q, 5, ("x", X1 + XS["dx"]))
        faces["side"] = q
    if X0 + XS["dx"] > XCAM:
        q = [pj(X0, Y1, z0), pj(X0, Y1, z1), pj(X0, Y0, z1), pj(X0, Y0, z0)]
        POLY(q, side, ol)
        face_record(q, 5, ("x", X0 + XS["dx"]))
        faces["side"] = q
    POLY([a, b, c, d], front, ol)
    face_record([a, b, c, d], 4, ("z", z1))
    faces["front"] = [a, b, c, d]
    return faces


def wbox(X0, X1, Y0, Y1, Z0, Z1, front, side=None, top=None, ol="INK", bottom=None):
    """A world-space axis-aligned box drawn in the current view (beams, corner pieces)."""
    xa, za = to_local(X0, Z0)
    xb, zb = to_local(X1, Z1)
    return box3d(min(xa, xb), max(xa, xb), Y0, Y1, min(za, zb), max(za, zb), front, side, top, ol, bottom)


def quad(pts, c, ol=None):
    POLY(pts, c, ol)


def wallq(side, z0, z1, Y0, Y1, inset=0.0):
    X = -WX + inset if side == "L" else WX - inset
    return [pj(X, Y1, z0), pj(X, Y1, z1), pj(X, Y0, z1), pj(X, Y0, z0)]


def wall_frame(side, z0, z1, Y0, Y1, fc, inner, ol="INK", m=0.18):
    quad(wallq(side, z0, z1, Y0, Y1, 0.02), fc, ol)
    quad(wallq(side, z0 + m, z1 - m, Y0 + m, Y1 - m, 0.03), inner)


def poly3(pts, c, ol=None):
    """A local 3D polygon [(x, y, z)], near-clipped, projected and filled."""
    q = clip3(pts)
    if len(q) < 3:
        return None
    pp = [pj(x, y, z) for x, y, z in q]
    POLY(pp, c, ol)
    return pp


def wpoly3(pts, c, ol=None):
    """A world 3D polygon [(X, Y, Z)] drawn in the current view."""
    loc = []
    for X, Y, Z in pts:
        x, z = to_local(X, Z)
        loc.append((x, Y, z))
    return poly3(loc, c, ol)


def wline3(a, b, c):
    """A world 3D segment, near-clipped."""
    (xa, za), (xb, zb) = to_local(a[0], a[2]), to_local(b[0], b[2])
    q = clip3([(xa, a[1], za), (xb, b[1], zb)])
    if len(q) < 2:
        return
    p0, p1 = pj(*q[0]), pj(*q[1])
    L(p0[0], p0[1], p1[0], p1[1], c)


def shadow_fp(*a, **k):
    """Contact shadows are the engine's now (LIGHTING_SPEC 4.4); kept as a no-op so the drawing code reads the same."""


def shadow_ell(*a, **k):
    pass


def lbox(X0, X1, Y0, Y1, z0, z1, front, side=None, top=None, ol="INK"):
    return box3d(X0, X1, Y0, Y1, z0, z1, front, side, top, ol)



# ---------------------------------------------------------------- tiny font (3x5)
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001010010",
    "8": "111101111101111", "9": "111101111001111", "F": "111100110100100", "O": "111101101101111",
    "R": "110101110101101", "G": "111100101101111", "E": "111100110100111", "D": "110101101101110",
    ":": "000010000010000", "A": "010101111101101", "T": "111010010010010", "-": "000000111000000",
    "I": "111010010010111", " ": "000000000000000", "W": "101101111111101", "U": "101101101101111",
    "K": "101101110101101", "N": "110101101101101", "S": "011100010001110", "C": "011100100100011",
    "V": "101101101101010", "L": "100100100100111", "M": "101111111101101", ".": "000000000000010",
    "H": "101101111101101", "Y": "101101010010010", "B": "110101110101110", "P": "110101110100100",
}


def text(x, y, s, c, gap=1):
    for ch in s:
        if ch == "|":  # 1 px roman numeral stroke
            for k in range(5):
                P(x, y + k, c)
            x += 2
            continue
        if ch == "*":  # middle dot
            P(x, y + 2, c)
            x += 2
            continue
        g = FONT.get(ch, FONT[" "])
        for i, b in enumerate(g):
            if b == "1":
                P(x + i % 3, y + i // 3, c)
        x += 3 + gap
    return x


def text_w(s, gap=1):
    w = 0
    for ch in s:
        w += 2 if ch in "|*" else 3 + gap
    return w - (gap if s and s[-1] not in "|*" else 1)



# ---------------------------------------------------------------- shared props
BOOKC = ["TERRA_1", "SLATE_1", "LEAF_2", "OAK_1", "GOLD_DK", "TERRA_0", "CREAM", "SLATE_0",
         "TERRA_2", "LEAF_1", "PLUM_1", "OAK_2", "PLUM_2", "NAVY"]
LIGHTER = {"TERRA_1": "TERRA_2", "SLATE_1": "SLATE_2", "LEAF_2": "LEAF_3", "OAK_1": "OAK_2",
           "GOLD_DK": "GOLD", "TERRA_0": "TERRA_1", "CREAM": "CREAM", "SLATE_0": "SLATE_1",
           "TERRA_2": "RIM", "LEAF_1": "LEAF_2", "PLUM_1": "PLUM_2", "OAK_2": "AMBER", "PLUM_2": "PLUM_3",
           "NAVY": "SLATE_0", "OAK_0": "OAK_1", "BROWN_1": "SLATE_0", "OAK_DK": "OAK_0"}


def books_row(x0, x1, yb, hmax, rng, n_fill=1.0):
    x = x0
    while x <= x1 - 1:
        if rng.random() > n_fill:
            x += 3
            continue
        if rng.random() < 0.1 and x1 - x >= 7:
            w = rng.randint(5, min(7, x1 - x))
            yy = yb
            for _ in range(rng.randint(2, 3)):
                col = rng.choice(BOOKC)
                R(x, yy - 1, x + w - 1, yy, col)
                L(x, yy - 1, x + w - 1, yy - 1, LIGHTER.get(col, col))
                yy -= 2
            x += w + 1
            continue
        w = rng.choice([2, 2, 3, 3])
        if x + w - 1 > x1:
            break
        h = rng.randint(max(4, hmax - 4), hmax)
        col = rng.choice(BOOKC)
        R(x, yb - h + 1, x + w - 1, yb, col)
        L(x, yb - h + 1, x + w - 1, yb - h + 1, LIGHTER.get(col, col))
        if rng.random() < 0.35:
            L(x, yb - h + 3, x + w - 1, yb - h + 3, "GOLD_DK" if col != "GOLD_DK" else "CREAM")
        x += w + (1 if rng.random() < 0.5 else 0)


def leaf(x, y, rng, dark=False, big=False):
    if dark:
        R(x, y, x + 1 + big, y + 1, "LEAF_0")
        return
    R(x - 1, y, x + 1 + big, y + 1, "LEAF_1")
    R(x, y, x + 1, y, "LEAF_2")
    if rng.random() < 0.3:
        P(x + 1, y, "LEAF_3")


def bush(cx, cy, rx, ry, rng, n=None, big=False):
    n = n or int((rx * ry) * 0.9) + 6
    for i in range(n):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, 1) ** 0.7
        x = cx + math.cos(a) * rx * rr
        y = cy + math.sin(a) * ry * rr
        leaf(int(x), int(y), rng, dark=(y > cy + ry * 0.2 and rng.random() < 0.6) or i < n // 4, big=big)


def big_leaf(x, y, ang, ln, wd, c="LEAF_2", edge="LEAF_0", vein="LEAF_1", hi=None):
    """Pointed leaf polygon from its stem point; flat fill, dark edge, vein."""
    ca, sa = math.cos(ang), math.sin(ang)
    tip = (x + ca * ln, y + sa * ln)
    m1 = (x + ca * ln * 0.45 - sa * wd, y + sa * ln * 0.45 + ca * wd)
    m2 = (x + ca * ln * 0.45 + sa * wd, y + sa * ln * 0.45 - ca * wd)
    POLY([(x, y), m1, tip, m2], c, edge)
    L(x, y, tip[0] - ca * 2, tip[1] - sa * 2, vein)
    if hi:
        P(m2[0] + ca, m2[1] + sa, hi)


def floor_plant(X, z, kind="snake", k=0, h=1.0, potc="TERRA_1"):
    """Floor plants that sway: snake plant blades, a fiddle-leaf fig, or a fern."""
    px, py = pj(X, 0, z)
    s_ = sc(z) / 14.0
    if kind == "snake":
        pot(px - 5 * s_, py - 8 * s_, px + 5 * s_, py, potc)
        for i in range(7):
            a = -math.pi / 2 + (i - 3) * 0.16 + 0.05 * swv(k + i)
            ln = (22 + 9 * abs(math.sin(i * 1.7))) * h * s_
            bx, by = px + (i - 3) * 1.2 * s_, py - 8 * s_
            tip = (bx + math.cos(a) * ln, by + math.sin(a) * ln)
            POLY([(bx - 1.5 * s_, by), (bx + 1.5 * s_, by), tip], "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0")
            L(bx, by - 2, tip[0], tip[1] + 2, "LEAF_3" if i % 3 == 0 else "LEAF_1")
    elif kind == "fiddle":
        pot(px - 6 * s_, py - 10 * s_, px + 6 * s_, py, potc)
        top = py - 46 * h * s_
        L(px, py - 10 * s_, px + swv(k), top, "OAK_0")
        for i in range(9):
            yy = py - (16 + i * 3.4) * h * s_
            side = 1 if i % 2 else -1
            big_leaf(px + swv(k + i) * (i / 9), yy, -math.pi / 2 + side * (0.9 - i * 0.06) + 0.06 * swv(k + i),
                     9 * s_ + 2, 4 * s_ + 1, "LEAF_2" if i % 3 else "LEAF_1", "LEAF_0", "LEAF_0", hi="LEAF_3")
    else:   # fern
        pot(px - 6 * s_, py - 8 * s_, px + 6 * s_, py, potc)
        for i in range(11):
            a = -math.pi / 2 + (i - 5) * 0.27 + 0.06 * swv(k + i)
            ln = (16 + 6 * math.cos(i * 1.3)) * h * s_
            bx, by = px, py - 8 * s_
            pts = [(bx + math.cos(a) * ln * t + math.sin(t * 3) * 0.6, by + math.sin(a) * ln * t + (ln * 0.25) * t * t)
                   for t in (0, 0.25, 0.5, 0.75, 1.0)]
            PL(pts, "LEAF_1")
            for (x_, y_) in pts[1:]:
                P(x_ - 1, y_, "LEAF_2")
                P(x_ + 1, y_ - 1, "LEAF_2" if i % 2 else "LEAF_3")
    shadow_ell(px, py, 9 * s_, 2)


def pot(x0, y0, x1, y1, c="TERRA_1"):
    BOX(x0, y0, x1, y1, c, hi=LIGHTER.get(c), sh="TERRA_0" if c.startswith("TERRA") else "INK")


def swv(k=0):
    """Gentle plant sway: -1..1 px by the 'sway' anim frame (frame 0 = the still), phase k per plant."""
    return (0, 1, 0, -1)[(af("sway") + k) % 4]


def vine(x, y, length, rng, drift=0.0, sw=0):
    x0 = x
    for i in range(length):
        y += 1
        if rng.random() < 0.3:
            x0 += 1 if rng.random() < 0.5 + drift else -1
        x = x0 + int(round(sw * (i / max(1, length)) ** 1.5 * 1.6))
        P(x, y, "LEAF_0")
        if i % 3 == 1:
            s = 1 if (i // 3) % 2 else -1
            P(x + s, y, "LEAF_2")
            P(x + s, y + 1, "LEAF_1")
            if i % 9 == 4 and TOD == "golden":
                P(x + s, y, "LEAF_3")   # sunset catching a leaf


def flame(x, y, big=False):
    P(x, y, "SUN!")
    P(x, y - 1, "GLOW!")
    if big:
        P(x, y + 1, "SUN!")
        P(x, y - 2, "ORANGE!")


def string_lights(pts, step=7, seed=0, cols=("GLOW", "SUN", "CRT_1", "PLUM_3", "ENERGY", "GLOW")):
    PL(pts, "INK")
    k = seed
    for i in range(seed % step, len(pts), step):
        x, y = pts[i]
        c = cols[k % len(cols)]
        P(x, y + 1, c + "!")
        P(x + 1, y + 1, c + "!")
        P(x, y + 2, c + "!")
        k += 1
        light(x, y + 2, 9, 7, 0.35 if TOD == "night" else 0.15)


def hanging_plant(X, z, ln, rng, k=0, top_y=None, drop=2.3, name="hang-plant"):
    with obj(name):
        top = pj(X, CEIL - 0.55 if top_y is None else top_y, z)
        bot = pj(X, (CEIL if top_y is None else top_y + 0.55) - drop, z)
        sw = swv(k)
        bx = bot[0] + (1 if sw > 0 else 0) * 0
        L(top[0], top[1], bx - 4, bot[1], "INK")
        L(top[0], top[1], bx + 4, bot[1], "INK")
        for i in range(5):
            vine(int(bx) - 4 + i * 2, int(bot[1]) + 4, rng.randint(ln // 2, ln), rng, sw=swv(k + i))
        bush(bx, bot[1] - 1, 6, 3, rng, n=22)
        pot(bx - 5, bot[1], bx + 5, bot[1] + 5, "TERRA_1")


# ---------------------------------------------------------------- the room shell (ray cast, world-consistent)
PLANK_W = 0.72          # plank width (ft); planks run along world Z (toward the window)
BEAMS_X = (-10.5, -3.5, 3.5, 10.5)     # long beams along Z
BEAMS_Z = (-7.0, 0.0, 7.0)             # cross beams along X
SKYLIGHT = (-3.0, 3.0, 2.6, 6.6)       # X0, X1, Z0, Z1 in the ceiling between the middle beams
WALL_NAME = {"front": "wall-front", "right": "wall-right", "back": "wall-back", "left": "wall-left"}


def hash01(*keys):
    """Deterministic 0..1 from any keys (never Python's hash())."""
    h = hashlib.blake2b(repr(keys).encode(), digest_size=8).digest()
    return int.from_bytes(h, "little") / 2.0 ** 64


def ray_grid():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rx = (xx + 0.5 - CX) / F
    ry = -(yy + 0.5 - CY) / F
    return rx, ry


def shell_hits():
    """Per master pixel: which room surface the ray hits first and where, in world feet.
    Returns kind (1 wall, 2 floor, 3 ceiling), wall id (0 ahead, 1 left, 2 right), world X, Y, Z, distance."""
    rx, ry = ray_grid()
    big = np.float32(1e9)
    with np.errstate(divide="ignore", invalid="ignore"):
        t_front = np.full_like(rx, D0)
        t_left = np.where(rx < 0, (-WX - XCAM) / rx, big)
        t_right = np.where(rx > 0, (WX - XCAM) / rx, big)
        t_floor = np.where(ry < 0, -EYE / ry, big)
        t_ceil = np.where(ry > 0, (CEIL - EYE) / ry, big)
    ts = np.stack([t_front, t_left, t_right, t_floor, t_ceil])
    which = np.argmin(ts, axis=0)
    t = np.min(ts, axis=0)
    lx = XCAM + rx * t
    Y = EYE + ry * t
    lz = D0 - t
    X, Z = to_world(lx, lz)
    kind = np.where(which <= 2, 1, np.where(which == 3, 2, 3)).astype(np.uint8)
    return kind, which, X, Y, Z, t


def wall_of(which):
    """Name of the wall a 'which' code points at, for the current view."""
    if which == 0:
        return VIEW
    return neighbour(VIEW, -1 if which == 1 else 1)


def shell():
    """Walls, floor and ceiling as one ray-cast plate: flat albedo plus world surface coordinates.
    Planks, plank seams and end joints come from world X and Z, so both views at a corner agree to the pixel."""
    kind, which, X, Y, Z, t = shell_hits()
    img = np.full((H, W), N["PLASTER"], np.uint8)
    mat = np.full((H, W), MAT["plaster"], np.uint8)
    su = np.zeros((H, W), np.float32)
    sv = np.zeros((H, W), np.float32)
    names = {}
    # walls: u along the wall (world), v = height
    wall = kind == 1
    for code in (0, 1, 2):
        wname = wall_of(code)
        m = wall & (which == code)
        if not m.any():
            continue
        # u runs left to right as seen facing that wall
        if wname == "front":
            u = X
        elif wname == "back":
            u = -X
        elif wname == "right":
            u = -Z
        else:
            u = Z
        su[m] = u[m]
        sv[m] = Y[m]
        names[wname] = m
    # the room's vertical corners: a 1 px darker seam where two walls meet
    edge = np.zeros((H, W), bool)
    edge[:, 1:] = (which[:, 1:] != which[:, :-1]) & wall[:, 1:] & wall[:, :-1]
    img[edge] = N["PLASTER_0"]
    # baseboard and crown on the walls
    base = wall & (Y < 0.45)
    img[base] = N["OAK_DK"]
    img[wall & (Y >= 0.40) & (Y < 0.45)] = N["OAK_0"]
    mat[base] = MAT["wood_furniture"]
    crown = wall & (Y > CEIL - 0.32)
    img[crown] = N["PLASTER_0"]
    # floor: planks along Z
    fl = kind == 2
    pi = np.floor(X / PLANK_W).astype(np.int32)
    su[fl] = X[fl]
    sv[fl] = Z[fl]
    mat[fl] = MAT["wood_floor"]
    tones = np.array([N["OAK_0"], N["OAK_0"], N["OAK_1"], N["OAK_0"], N["OAK_DK"], N["OAK_1"], N["OAK_0"], N["OAK_2"]], np.uint8)
    # per-plank segment: staggered end joints every 5..9 ft
    seg = np.zeros((H, W), np.int32)
    if fl.any():
        pis = np.unique(pi[fl])
        for p in pis:
            m = fl & (pi == p)
            off = hash01("plank-off", int(p)) * 6.0
            seglen = 5.0 + hash01("plank-len", int(p)) * 4.0
            seg[m] = np.floor((Z[m] + 40 + off) / seglen).astype(np.int32)
        board = pi * 97 + seg
        tone_idx = (np.vectorize(lambda b: int(hash01("tone", int(b)) * 8))(board[fl])).astype(np.int32)
        img[fl] = tones[tone_idx]
        # seams: where the board id changes from the pixel to the left or above
        bid = np.where(fl, board, -999999)
        sx = np.zeros((H, W), bool)
        sx[:, 1:] = (bid[:, 1:] != bid[:, :-1]) & fl[:, 1:] & fl[:, :-1]
        sy = np.zeros((H, W), bool)
        sy[1:, :] = (bid[1:, :] != bid[:-1, :]) & fl[1:, :] & fl[:-1, :]
        seam = sx | sy
        img[seam] = N["OAK_VD"] if "OAK_VD" in N else N["OAK_DK"]
        G.seam = seam
    else:
        G.seam = np.zeros((H, W), bool)
    # ceiling: dark planks between beams along X
    ce = kind == 3
    su[ce] = X[ce]
    sv[ce] = Z[ce]
    img[ce] = N["INK"]
    cpi = np.floor(X / 1.1).astype(np.int32)
    alt = (cpi % 2 == 0) & ce
    img[alt] = N["INK_2"] if "INK_2" in N else N["INK"]
    mat[ce] = MAT["wood_ceiling"]
    # skylight (glass + sky) in the ceiling
    x0, x1, z0, z1 = SKYLIGHT
    sk = ce & (X > x0) & (X < x1) & (Z > z0) & (Z < z1)
    skin = ce & (X > x0 + 0.35) & (X < x1 - 0.35) & (Z > z0 + 0.35) & (Z < z1 - 0.35)
    img[sk] = N["INK"]
    if TOD == "night":
        img[skin] = N["NAVY"]
    else:
        zz = (Z - z0) / (z1 - z0)
        img[skin & (zz < 0.33)] = N["PLUM_2"]
        img[skin & (zz >= 0.33) & (zz < 0.66)] = N["TERRA_2"]
        img[skin & (zz >= 0.66)] = N["RIM"]
    mat[skin] = MAT["sky"]
    mat[sk & ~skin] = MAT["wood_ceiling"]
    # composite as the shell objects
    for oid, nm, m in ((1, "wall-B", wall & (which == 0)), (2, "wall-L", wall & (which == 1)),
                       (3, "wall-R", wall & (which == 2)), (4, "floor", fl), (5, "ceiling", ce)):
        G.names[oid] = nm
        G.order[oid] = len(G.order) + 1
        G.img[m] = img[m]
        G.oid[m] = oid
        G.mat[m] = mat[m]
        G.kind[m] = kind[m]
        G.su[m] = su[m]
        G.sv[m] = sv[m]
        G.dist[m] = t[m]
    G.emit[skin] = True
    G.wallnames = names


def ceiling_beams():
    """Long beams along Z and cross beams along X, as world boxes; strings of lights along two of them."""
    with obj("beams", mat="wood_ceiling"):
        for X in BEAMS_X:
            wbox(X - 0.35, X + 0.35, CEIL - 0.6, CEIL, -RS, RS, "INK", side="INK_2", top="INK", bottom="OAK_DK", ol="VOID")
        for Z in BEAMS_Z:
            wbox(-RS, RS, CEIL - 0.65, CEIL, Z - 0.32, Z + 0.32, "INK", side="INK_2", top="INK", bottom="OAK_DK", ol="VOID")


def world_string_lights():
    """Two strings of bulbs swagged along the long beams nearest the middle, and one along the front cross beam."""
    for k, (X, seed) in enumerate(((-3.5, 1), (3.5, 3))):
        pts = []
        for i in range(0, 113):
            Z = -RS + i * 0.25
            Y = CEIL - 0.75 - 0.35 * abs(math.sin(i * 0.52))
            lx, lz = to_local(X, Z)
            if D0 - lz < 1.2:
                if pts:
                    break
                continue
            pts.append(pj(lx, Y, lz))
        if len(pts) > 1:
            with obj("string-%d" % seed, mat="bulb"):
                string_lights(pts, step=7, seed=seed)
    pts = []
    for i in range(0, 113):
        Xw = -RS + i * 0.25
        Y = CEIL - 0.85 - 0.6 * math.sin(math.pi * i / 112)
        lx, lz = to_local(Xw, 7.0)
        if D0 - lz < 1.2:
            continue
        pts.append(pj(lx, Y, lz))
    if len(pts) > 1:
        with obj("string-x", mat="bulb"):
            string_lights(pts, step=9, seed=2)


# hanging plants: world anchor (X, Z), cord drop (ft), vine length (px at 20 px/ft), sway phase
HANGERS = ((-9.0, 9.6, 2.6, 26, 0), (8.2, 10.4, 2.4, 22, 1), (-10.6, -8.0, 2.9, 24, 2), (10.0, -9.6, 2.6, 24, 3),
           (-11.0, 1.5, 3.0, 22, 4), (11.0, 2.5, 2.8, 22, 5), (1.2, 9.0, 2.2, 18, 6), (-1.5, -10.6, 2.4, 20, 7))


def world_hangers():
    rng = random.Random(5)
    for X, Z, drop, ln, k in HANGERS:
        lx, lz = to_local(X, Z)
        if D0 - lz < 2.0:
            continue
        hanging_plant(lx, lz, ln, random.Random(31 + k), k, top_y=CEIL - 0.6, drop=drop, name="hang-plant")


# corner pieces: world geometry drawn in both views that meet at the corner (3D leaves, so they match)
CORNERS = {"front-left": (-13.0, 13.0), "front-right": (13.0, 13.0), "back-right": (13.0, -13.0), "back-left": (-13.0, -13.0)}


def leaf3(cx, cy, cz, ang, ln, wd, c, edge="LEAF_0", hi=None, side=1.0):
    """A leaf in world space, in the vertical plane that faces the room centre (so both corner views see its face).
    (cx, cy, cz) stem point; ang tilts it from horizontal; side picks which way along the tangent it points."""
    hx, hz = -cx, -cz
    n = math.hypot(hx, hz) or 1
    tx, tz = -hz / n * side, hx / n * side
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for (dx, dy) in ((0, 0), (0.45 * ln, wd), (ln, 0), (0.45 * ln, -wd)):
        h = dx * ca - dy * sa
        v = dx * sa + dy * ca
        pts.append((cx + tx * h, cy + v, cz + tz * h))
    pp = wpoly3(pts, c, edge)
    if pp and hi:
        P(pp[1][0], pp[1][1], hi)


def corner_plant(name, X, Z, kind, k=0):
    """A tall corner plant built in world space: pot as a box, stems and leaves as 3D points."""
    lx, lz = to_local(X, Z)
    if D0 - lz < 2.0:
        return
    with obj(name, mat={"default": "leaf", "TERRA_1": "ceramic", "TERRA_0": "ceramic", "TERRA_2": "ceramic",
                        "SLATE_0": "ceramic", "SLATE_1": "ceramic", "OAK_0": "wood_furniture"}):
        r = 0.6
        if kind == "fiddle":
            wline3((X, 1.5, Z), (X, 5.8, Z), "OAK_0")
        if kind == "lamp":
            # tall brass floor lamp (the corner light): a small weighted base, a thin pole and a tapered drum shade
            # drawn in the plane facing the room centre, so both views that share the corner see the same shape
            n = math.hypot(X, Z)
            tx, tz = -Z / n, X / n
            wbox(X - 0.35, X + 0.35, 0, 0.25, Z - 0.35, Z + 0.35, "SLATE_0", side="INK", top="GOLD_DK")
            wline3((X, 0.25, Z), (X, 6.4, Z), "GOLD_DK")

            def ring(w, Y):
                return [(X - tx * w, Y, Z - tz * w), (X + tx * w, Y, Z + tz * w)]
            a0, a1 = ring(0.32, 7.3)
            b0, b1 = ring(0.55, 6.3)
            wpoly3([a0, a1, b1, b0], "AMBER", "INK")
            wline3(b0, b1, "SUN!")
            p = wp(X, 6.25, Z)
            light(p[0], p[1] + 10, 40, 50, 0.8)
            return
        wbox(X - r, X + r, 0, 1.5, Z - r, Z + r, "TERRA_1", side="TERRA_0", top="OAK_DK")
        rnd = random.Random(int(hash01(name) * 1e6))
        n = 16 if kind == "fiddle" else 22
        for i in range(n):
            h = 1.6 + (i / n) * (4.6 if kind == "fiddle" else 3.0)
            yaw = rnd.uniform(0, math.tau)
            off = 0.25 + 0.5 * rnd.random()
            cx, cz = X + math.cos(yaw) * off * 0.6, Z + math.sin(yaw) * off * 0.6
            if kind == "fiddle":
                wline3((X, 1.5 + (h - 1.5) * 0.3, Z), (cx, h, cz), "OAK_0")
                ang = math.radians(rnd.uniform(10, 70)) + 0.05 * swv(k + i)
                leaf3(cx, h, cz, ang, 1.0, 0.42, "LEAF_2" if i % 3 else "LEAF_1", hi="LEAF_3", side=1 if i % 2 else -1)
            else:
                ang = math.radians(rnd.uniform(55, 95)) + 0.05 * swv(k + i)
                ang = math.radians(rnd.uniform(62, 88)) + 0.04 * swv(k + i)
                leaf3(X + rnd.uniform(-0.4, 0.4), 1.5, Z + rnd.uniform(-0.4, 0.4), ang, 2.2 + rnd.random() * 1.6, 0.16,
                      "LEAF_2" if i % 2 else "LEAF_1", hi="LEAF_3", side=1 if i % 2 else -1)


def corner_pieces():
    """Front-left: fiddle-leaf fig. Front-right: brass floor lamp. Back corners: a snake plant and a fern."""
    for nm, kind in (("front-left", "fiddle"), ("front-right", "lamp"), ("back-right", "snake"), ("back-left", "snake")):
        X, Z = CORNERS[nm]
        corner_plant("corner-" + nm, X, Z, kind, k=len(nm))



# ================================================================ front wall: window, knight, library
WIN = (-1.8, 8.6, 2.8, 10.6)  # X0, X1, sill Y, top Y on the front wall
RELIC = {"fr": None}

def window():
    X0, X1, Ys, Yt = WIN
    x0, y0 = pji(X0, Yt, 0)
    x1, y1 = pji(X1, Ys, 0)
    G.win = (x0, y0, x1, y1)
    with obj("window-sky", emit=True, mat="sky"):
        sky(x0, y0, x1, y1)
    with obj("window-view", emit=True, mat="sky"):
        outside(x0, y0, x1, y1)
    with obj("window-frame", mat="wood_furniture"):
        R(x0 - 4, y0 - 4, x1 + 4, y0 - 1, "OAK_DK")
        L(x0 - 4, y0 - 4, x1 + 4, y0 - 4, "INK")
        R(x0 - 4, y0, x0 - 1, y1, "OAK_DK")
        R(x1 + 1, y0, x1 + 4, y1, "OAK_DK")
        L(x0 - 4, y0 - 4, x0 - 4, y1, "INK")
        L(x1 + 4, y0 - 4, x1 + 4, y1, "INK")
        L(x0 - 1, y0, x0 - 1, y1, "INK")
        L(x1 + 1, y0, x1 + 1, y1, "INK")
        # mullions: 3 panes wide, transom
        for k in (1, 2):
            xm = x0 + (x1 - x0) * k // 3
            R(xm - 1, y0, xm + 1, y1, "OAK_DK")
            L(xm - 1, y0, xm - 1, y1, "INK")
            L(xm + 1, y0, xm + 1, y1, "OAK_0")
        yt = y0 + 24
        R(x0, yt - 1, x1, yt + 1, "OAK_DK")
        L(x0, yt + 1, x1, yt + 1, "INK")
        L(x0, yt - 1, x1, yt - 1, "OAK_0")
        # sill (top face visible)
        R(x0 - 7, y1 + 1, x1 + 7, y1 + 4, "OAK_1")
        L(x0 - 7, y1 + 1, x1 + 7, y1 + 1, "OAK_2")
        L(x0 - 7, y1 + 4, x1 + 7, y1 + 4, "INK")
        R(x0 - 5, y1 + 5, x1 + 5, y1 + 6, "OAK_DK")
    # curtain rod + curtains gathered at both sides
    with obj("curtains", mat={"default": "fabric_cotton", "GOLD": "gold_metal", "GOLD_DK": "gold_metal", "INK": "metal_painted"}):
        L(x0 - 16, y0 - 8, x1 + 16, y0 - 8, "INK")
        L(x0 - 16, y0 - 9, x1 + 16, y0 - 9, "GOLD_DK")
        circ(x0 - 17, y0 - 9, 1, "GOLD")
        circ(x1 + 17, y0 - 9, 1, "GOLD")
        for side in (-1, 1):
            xe = x0 - 1 if side < 0 else x1 + 1
            for yy in range(y0 - 8, y1 + 22):
                t = (yy - (y0 - 8)) / (y1 + 22 - (y0 - 8))
                pinch = 1 - 0.45 * math.exp(-((t - 0.62) / 0.12) ** 2)  # tie-back
                w = int(round((8 + 6 * t) * pinch))
                if side < 0:
                    xa, xb = xe - w + 2, xe + 4
                else:
                    xa, xb = xe - 4, xe + w - 2
                L(xa, yy, xb, yy, "PLUM_1")
                for f in range(xa + 2, xb - 1, 3):
                    P(f, yy, "PLUM_2" if (f - xa) % 6 == 2 else "BROWN_2")
                P(xa, yy, "INK")
                P(xb, yy, "INK")
            # tie-back band
            ty = int(y0 - 8 + 0.62 * (y1 + 30 - y0))
            L(xe - 9 if side < 0 else xe - 4, ty, xe + 4 if side < 0 else xe + 9, ty, "GOLD")
    # candle row on the sill (growth piece)
    with obj("candles", mat={"default": "paper", "SUN": "flame", "GLOW": "flame", "ORANGE": "flame"}):
        for i, cx in enumerate(range(x0 + 6, x0 + 36, 6)):
            h = 4 + (i % 3)
            R(cx, y1 + 1 - h, cx + 1, y1, "CREAM")
            P(cx, y1 + 1 - h, "OAK_2")
            flame(cx, y1 - h - 1)
        light(x0 + 20, y1 - 6, 24, 12, 0.3)
    # relic niche above the window (ember)
    with obj("relic-niche", mat={"default": "plaster", "OAK_1": "wood_furniture", "INK": "wood_furniture"}):
        nx = (x0 + x1) // 2 + 14
        ny = y0 - 11
        POLY([(nx - 7, ny + 1), (nx - 7, ny - 7), (nx - 4, ny - 10), (nx + 4, ny - 10), (nx + 7, ny - 7), (nx + 7, ny + 1)], "PLASTER_0", "INK")
        R(nx - 8, ny + 1, nx + 8, ny + 2, "OAK_1")
        L(nx - 8, ny + 2, nx + 8, ny + 2, "INK")
        relic_slot("window.relic", nx, ny - 3)
        G.niche = (nx, ny - 3)


def relic_gem(x, y, frame=0, hot=False):
    if RELIC["fr"] is not None:
        frame = RELIC["fr"]
    cols = [("CRT_0", "ORANGE", "SUN"), ("TERRA_0", "RIM", "GLOW"), ("CRT_0", "GLOW", "SUN")][frame % 3]
    POLY([(x, y - 4), (x + 3, y - 1), (x, y + 3), (x - 3, y - 1)], cols[0] + "!", "INK")
    POLY([(x, y - 3), (x + 2, y - 1), (x, y + 1), (x - 1, y - 1)], cols[1] + "!")
    P(x, y - 2, cols[2] + "!")
    embers = [((-2, -6), (1, -9)), ((-3, -8), (2, -11), (0, -6)), ((-1, -10), (3, -7), (-3, -13))][frame % 3]
    for i, (dx, dy) in enumerate(embers):
        P(x + dx, y + dy, ("ORANGE!", "RIM!", "CRT_0!")[(i + frame) % 3])
    k = (1.0, 0.75, 1.2)[frame % 3]
    light(x, y, 14 * k, 12 * k, (0.6 if TOD == "night" else 0.35) * k)
    tint(x, y, (16 if not hot else 22) * k, (13 if not hot else 18) * k, "ember", k)


def relic_slot(rid, x, y, frame=0):
    """A relic mount's content: base = empty socket, active / hot = the ember gem, gold = a gold medallion."""
    v = vk(rid, "active")
    if v == "base":
        R(x - 1, y - 1, x + 1, y + 1, "INK")
        P(x, y - 1, "OAK_DK")
        return
    if v == "gold":
        circ(x, y - 1, 4, "INK")
        circ(x, y - 1, 3, "GOLD!")
        circ(x, y - 1, 1, "SUN!")
        P(x - 1, y - 3, "CREAM!")
        light(x, y, 14, 12, 0.4)
        return
    relic_gem(x, y, frame, hot=(v == "hot"))


# window animation: TM["t"] = seconds since the loop start; PARTS = which window pieces this render draws
TM = {"t": 0.0}
PARTS = {"sky", "sun", "clouds", "birds", "far", "tram"}
CLOUD_V = 2.0      # px per second (the engine drifts the cloud strip at this speed)
TRAM_PERIOD = 18.0  # s between streetcar passes
BIRD_PERIOD = 23.0


def clipR(x0, y0, x1, y1, c, cx0, cx1):
    R(max(x0, cx0), y0, min(x1, cx1), y1, c)


def cloud(cx, cy, w, c, lit, dark, cx0, cx1):
    """A puffy flat cloud: three stacked rows with a lit top edge and a darker base."""
    clipR(cx + 2, cy + 2, cx + w - 2, cy + 3, dark, cx0, cx1)
    clipR(cx, cy, cx + w, cy + 2, c, cx0, cx1)
    clipR(cx + w * 0.18, cy - 2, cx + w * 0.62, cy - 1, c, cx0, cx1)
    clipR(cx + w * 0.30, cy - 3, cx + w * 0.50, cy - 3, c, cx0, cx1)
    clipR(cx + w * 0.62, cy - 1, cx + w * 0.82, cy - 1, c, cx0, cx1)
    clipR(cx + w * 0.22, cy - 3, cx + w * 0.46, cy - 3, lit, cx0, cx1)
    clipR(cx + w * 0.14, cy - 1, cx + w * 0.22, cy - 1, lit, cx0, cx1)
    clipR(cx + w * 0.64, cy - 1, cx + w * 0.78, cy - 1, lit, cx0, cx1)


def cloud_list(x0, y0, x1, sy):
    if TOD == "golden":
        return [(0.02, y0 + 10, 40, "TERRA_1", "RIM", "TERRA_0"), (0.30, y0 + 19, 52, "TERRA_2", "GLOW", "TERRA_1"),
                (0.62, y0 + 8, 34, "TERRA_1", "RIM", "TERRA_0"), (0.78, y0 + 31, 40, "TERRA_2", "GLOW", "TERRA_1"),
                (0.12, sy - 2, 46, "RIM", "SUN", "TERRA_2"), (0.52, sy + 8, 30, "ORANGE", "SUN", "RIM")]
    if TOD == "dawn":
        return [(0.05, y0 + 12, 36, "PLUM_1", "PLUM_3", "PLASTER"), (0.66, y0 + 22, 44, "PLUM_2", "CREAM", "PLUM_1")]
    if TOD == "midday":
        return [(0.05, y0 + 10, 34, "SLATE_2", "CREAM", "SLATE_1"), (0.60, y0 + 20, 50, "SLATE_2", "CREAM", "SLATE_1"),
                (0.30, y0 + 34, 40, "SLATE_2", "CREAM", "SLATE_1")]
    return [(0.08, y0 + 30, 40, "SLATE_0", "PLUM_1", "NAVY"), (0.58, y0 + 14, 30, "NAVY", "SLATE_0", "INK")]


def sky(x0, y0, x1, y1):
    hz = y1 - 22  # horizon line behind rooftops
    ww = x1 - x0
    bands = {
        "golden": ["PLUM_2", "TERRA_2", "RIM", "ORANGE", "GLOW", "SUN"],
        "dawn": ["NAVY", "PLUM_1", "PLUM_2", "PLUM_3", "CREAM", "CREAM"],
        "midday": ["SLATE_1", "SLATE_1", "SLATE_2", "SLATE_2", "CREAM", "CREAM"],
        "night": ["INK", "NAVY", "NAVY", "NAVY", "SLATE_0", "PLUM_1"],
    }[TOD]
    sx = x0 + int(ww * 0.47)
    sy = hz - 18 if TOD == "golden" else hz - 2
    if "sky" in PARTS:
        n = len(bands)
        hb = (hz - y0) / n
        for i, c in enumerate(bands):
            ya = int(y0 + i * hb)
            yb = int(y0 + (i + 1) * hb)
            R(x0, ya, x1, yb, c)
            if i + 1 < n:  # 1-row checker transition (sky dither)
                for x in range(x0, x1 + 1):
                    if (x + yb) % 2 == 0:
                        P(x, yb, bands[i + 1])
        R(x0, hz, x1, y1, bands[-1])
        if TOD == "night":
            mx, my = x1 - 34, y0 + 16
            circ(mx, my, 7, "CREAM")
            circ(mx + 3, my - 2, 6, "NAVY")
            rng = random.Random(3)
            for _ in range(22):
                P(rng.randint(x0 + 2, x1 - 2), rng.randint(y0 + 2, hz - 24), "CREAM")
    if "sun" in PARTS:
        if TOD == "golden":
            circ(sx, sy, 15, "SUN")
            circ(sx, sy, 12, "CREAM")
            for k, yy in enumerate((sy + 5, sy + 9, sy + 12)):   # heat bands across the low sun
                L(sx - 14 + k, yy, sx + 14 - k, yy, "SUN")
        elif TOD == "dawn":
            circ(sx + 20, sy, 8, "CREAM")
    if "clouds" in PARTS:
        span = ww + 70
        for fx, cy, w, c, lit, dark in cloud_list(x0, y0, x1, sy):
            cx = x0 - 60 + ((fx * span + TM["t"] * CLOUD_V) % span)
            cloud(cx, cy, w, c, lit, dark, x0, x1)
    if "birds" in PARTS and TOD != "night":
        birds(x0, y0, x1, ((TM["t"] / BIRD_PERIOD) + BIRD_PHASE) % 1.0, int(TM["t"] * 4) % 2)


BIRD_PHASE, TRAM_PHASE = 0.45, 0.43


def birds(x0, y0, x1, u, flap, clip=True):
    """A small flock crossing the window (u in 0..1 across; drift: x = u * (ww + 60), y = 6 sin(7u))."""
    ww = x1 - x0
    bx = x0 - 30 + u * (ww + 60)
    by = y0 + 30 + 6 * math.sin(u * 7)
    if True:
        for k, (dx, dy) in enumerate(((0, 0), (-7, 3), (-12, -2), (-17, 4))):
            x, y = int(round(bx + dx)), int(round(by + dy))
            if not clip or (x0 + 1 <= x - 2 and x + 2 <= x1 - 1):
                c = "INK" if TOD == "golden" else "BROWN_1"
                if (flap + k) % 2:
                    P(x - 2, y, c); P(x - 1, y + 1, c); P(x, y, c); P(x + 1, y + 1, c); P(x + 2, y, c)
                else:
                    P(x - 2, y + 1, c); P(x - 1, y, c); P(x, y + 1, c); P(x + 1, y, c); P(x + 2, y + 1, c)


def mountains(x0, y0, x1, y1, hz):
    """Two ranges far behind the rooftops in the sunset colours: hazy far peaks, a nearer range with lit ridges."""
    night = TOD == "night"
    far = {"golden": ("PLUM_2", "PLUM_3", "TERRA_2"), "dawn": ("PLUM_1", "PLUM_2", "PLUM_3"),
           "midday": ("SLATE_1", "SLATE_2", "SLATE_2"), "night": ("NAVY", "SLATE_0", "SLATE_0")}[TOD]
    near = {"golden": ("PLUM_1", "RIM", "TERRA_2"), "dawn": ("PLASTER", "PLUM_2", "PLUM_1"),
            "midday": ("SLATE_0", "SLATE_1", "SLATE_1"), "night": ("INK", "NAVY", "NAVY")}[TOD]

    def profile(seed, amp, base, sharp):
        r = random.Random(seed)
        ph = [r.uniform(0, 6.28) for _ in range(4)]
        out = {}
        for xx in range(x0, x1 + 1):
            u = (xx - x0) / 40.0
            v = (0.55 * abs(math.sin(u * 1.1 + ph[0])) + 0.30 * abs(math.sin(u * 2.3 + ph[1])) ** sharp
                 + 0.15 * abs(math.sin(u * 5.1 + ph[2])))
            out[xx] = int(base - amp * v)
        return out

    for prof_args, cols in (((7, 30, hz - 2, 0.7), far), ((11, 20, hz + 3, 1.4), near)):
        pr = profile(*prof_args)
        col, ridge, face = cols
        for xx in range(x0, x1 + 1):
            yy = pr[xx]
            L(xx, yy, xx, prof_args[2] + 14, col)
        for xx in range(x0 + 1, x1):
            yy = pr[xx]
            if night:
                if xx % 7 == 0:
                    P(xx, yy, ridge)
                continue
            if pr[xx - 1] > yy or (pr[xx - 1] == yy and pr[xx + 1] > yy):
                P(xx, yy, ridge)                       # sunlit edge on the rising slopes
                if pr[xx - 1] - yy >= 1:
                    P(xx, yy + 1, face)
            # sunlit faces: a band below the ridge on slopes that face the sun (left of the light)
            if pr[xx - 1] > yy and (xx % 3):
                for k in range(2, 4):
                    P(xx, yy + k, face)


def outside(x0, y0, x1, y1):
    night = TOD == "night"
    hz = y1 - 22
    rng = random.Random(21)
    far = "SLATE_0" if night else ("SLATE_1" if TOD != "dawn" else "PLUM_1")
    roofl = {"golden": "RIM", "dawn": "PLUM_3", "midday": "SLATE_2", "night": "SLATE_1"}[TOD]
    if "far" in PARTS:
        mountains(x0, y0, x1, y1, hz)
        # far skyline (low, slate)
        x = x0
        while x < x1:
            w = rng.randint(6, 12)
            h = rng.randint(3, 7)
            POLY([(x, hz + 4), (x, hz - h + 3), (x + w // 2, hz - h), (x + w, hz - h + 3), (x + w, hz + 4)], far)
            if night and rng.random() < 0.6:
                P(x + w // 2, hz - h + 5, "GLOW")
            x += w + rng.randint(0, 2)

        def oak(cx, cy, rx, ry, seed):
            r2 = random.Random(seed)
            for _ in range(int(rx * ry / 3)):
                a = r2.uniform(0, math.tau)
                rr = r2.uniform(0, 1) ** 0.6
                xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
                ELL(max(x0, xx - 4), yy - 2, min(x1, xx + 4), yy + 2, "LEAF_0")
            if not night:
                for _ in range(int(rx * ry / 9)):
                    a = r2.uniform(math.pi * 1.0, math.pi * 1.8)
                    rr = r2.uniform(0.55, 1)
                    xx, yy = cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr
                    if x0 <= xx <= x1 - 2:
                        R(xx, yy, xx + 2, yy, "LEAF_1")
                        if r2.random() < 0.35:
                            P(xx + 2, yy, roofl if TOD == "golden" else "LEAF_2")
            for _ in range(6):
                mx = r2.randint(int(cx - rx * 0.8), int(cx + rx * 0.8))
                my = int(cy + ry * 0.4)
                if x0 <= mx <= x1:
                    L(mx, my, mx, my + r2.randint(3, 6), "SLATE_0" if not night else "INK")

        oak(x0 + 10, y0 + 40, 22, 30, 3)
        L(x0 + 10, y0 + 56, x0 + 12, y1, "INK")
        L(x0 + 11, y0 + 56, x0 + 13, y1, "LEAF_0")
        oak(x1 - 14, y0 + 30, 26, 26, 4)
        L(x1 - 18, y0 + 46, x1 - 14, y1, "INK")
        px = x1 - 40
        L(px, y0 + 14, px, y1, "INK")
        L(px - 6, y0 + 18, px + 6, y0 + 18, "INK")
        for dy, s_ in ((18, 6), (22, 8)):
            sag(x0, y0 + dy + 6, px - 6, y0 + dy, s_, "INK")
            sag(px + 6, y0 + dy, x1, y0 + dy + 3, 2, "INK")
        sag(x0, hz - 6, x1, hz - 8, 4, "INK")
        near = "NAVY" if night else ("SLATE_0" if TOD != "midday" else "SLATE_1")
        x = x0 - 2
        while x < x1:
            w = rng.randint(10, 15)
            h = rng.randint(10, 15)
            top = y1 - h
            xa, xb = max(x0, x), min(x1, x + w)
            POLY([(xa, y1), (xa, top + 4), (x + w // 2, top), (xb, top + 4), (xb, y1)], near, "INK")
            L(xa + 1, top + 4, x + w // 2, top + 1, roofl)
            L(x + w // 2, top + 1, xb - 1, top + 4, "SLATE_1" if not night else "SLATE_0")
            if night or rng.random() < 0.4:
                R(x + 3, top + 7, x + 4, top + 9, "GLOW" if night else "INK")
            if night and rng.random() < 0.5:
                R(x + w - 5, top + 7, x + w - 4, top + 9, "SUN")
            x += w + rng.randint(1, 3)
    if "tram" in PARTS:
        tram(x0, y1, hz, night)
    if "far" in PARTS:
        L(x0, y1, x1, y1, "INK")


def tram(x0, y1, hz, night, u=None, clip=True):
    """The red streetcar on the neutral ground (drives left to right every TRAM_PERIOD s;
    drift: x = u * (ww + 80))."""
    x1 = G.win[2]
    if u is None:
        u = ((TM["t"] / TRAM_PERIOD) + TRAM_PHASE) % 1.0
    sx0 = x0 - 40 + int(u * ((x1 - x0) + 80))
    sy = y1 - 15
    cl0, cl1 = (x0, x1) if clip else (-9999, 9999)

    def r(a, b, c, d, col):
        clipR(a, b, c, d, col, cl0, cl1)
    r(sx0, sy, sx0 + 34, sy + 9, "INK")
    r(sx0 + 1, sy + 1, sx0 + 33, sy + 8, "CRT_0")
    r(sx0 + 1, sy + 1, sx0 + 33, sy + 1, "CRT_1")
    r(sx0 + 1, sy + 8, sx0 + 33, sy + 8, "TERRA_0")
    for wx in range(sx0 + 3, sx0 + 32, 4):
        r(wx, sy + 2, wx + 2, sy + 4, "SUN" if night else "CREAM" if TOD != "golden" else "GLOW")
    r(sx0 + 1, sy + 6, sx0 + 33, sy + 6, "GOLD_DK")
    if not clip or (x0 <= sx0 + 16 and sx0 + 22 <= x1):
        L(sx0 + 16, sy, sx0 + 22, hz - 7, "INK")   # trolley pole
    r(sx0 + 3, sy + 10, sx0 + 7, sy + 10, "INK")
    r(sx0 + 27, sy + 10, sx0 + 31, sy + 10, "INK")
    if night:
        r(sx0 + 34, sy + 7, sx0 + 34, sy + 7, "SUN")


# ---------------------------------------------------------------- knight
KH = 134  # px tall: about 6 ft at the knight's depth in this room


def knight_parts():
    """Front-view part polygons (right half, mirrored), y from helm top 0 to feet 134, x from centre."""
    return [
        ("cape", None),
        ("upperarm", [(13, 31), (19, 31), (21, 47), (16, 50), (13, 45)]),
        ("forearm", [(15, 48), (20, 51), (11, 63), (5, 63), (6, 59)]),
        ("leg", [(3, 70), (11, 70), (11, 90), (10, 96), (10, 120), (12, 126), (13, 134), (2, 134), (3, 124), (3, 96), (3, 90)]),
        ("knee", [(2, 89), (11, 89), (12, 93), (10, 98), (3, 98), (2, 93)]),
        ("sabaton", [(2, 125), (11, 125), (14, 131), (14, 134), (1, 134)]),
        ("fauld", [(0, 54), (10, 54), (12, 64), (12, 72), (4, 74), (0, 72)]),
        ("breast", [(0, 21), (9, 21), (12, 25), (12, 38), (10, 48), (8, 53), (0, 55)]),
        ("gorget", [(0, 17), (6, 17), (7, 22), (0, 23)]),
        ("helm", [(0, 0), (4, 0), (6, 2), (7, 6), (7, 14), (5, 18), (0, 19)]),
        ("pauldron", [(6, 20), (13, 18), (19, 21), (22, 26), (21, 32), (16, 33), (10, 30), (7, 25)]),
        ("hand", [(0, 58), (7, 58), (8, 61), (7, 68), (0, 69)]),
    ]


def knight(tier, cx, yb, glitch=False):
    """Draw the knight into a local canvas, shade per part, then stamp (emissive: baked lighting)."""
    Wk, Hk = 72, 160
    ox, oy = Wk // 2, 22  # local origin: centre x, helm top y
    pid = Image.new("L", (Wk, Hk), 0)
    pd = ImageDraw.Draw(pid)
    parts = knight_parts()
    names = [p[0] for p in parts]
    gold_parts = {1: set(), 2: set(), 3: set(), 4: {"breast", "helm", "gorget", "pauldron"},
                  5: set(names) | {"sword"}}[tier]
    # cape behind
    cape = None
    if tier >= 3:
        bot = 78 if tier < 5 else 133
        wb = 22 if tier < 5 else 28
        cape = [(-17, 22), (17, 22), (wb, bot), (wb - 6, bot + 2), (0, bot - 2), (-wb + 6, bot + 2), (-wb, bot)]
        pd.polygon([(ox + x, oy + y) for x, y in cape], fill=1)
    for k, (nm, poly) in enumerate(parts):
        if poly is None:
            continue
        for sgn in (1, -1):
            pts = [(ox + sgn * x, oy + y) for x, y in poly]
            if nm == "hand" and sgn == -1:
                continue
            pd.polygon(pts, fill=k + 2)
    # left hand lower, right hand on top (stacked on the pommel)
    pd.polygon([(ox - 7, oy + 61), (ox + 1, oy + 61), (ox + 1, oy + 70), (ox - 6, oy + 70), (ox - 8, oy + 65)],
               fill=names.index("hand") + 2)
    pd.polygon([(ox - 1, oy + 57), (ox + 8, oy + 57), (ox + 8, oy + 66), (ox - 1, oy + 66)], fill=names.index("hand") + 2)
    # sword: pommel above hands, guard, blade down between legs
    SW = 40
    pd.ellipse([ox - 2, oy + 53, ox + 2, oy + 57], fill=SW)
    pd.rectangle([ox - 1, oy + 69, ox + 1, oy + 73], fill=SW)
    pd.polygon([(ox - 11, oy + 73), (ox + 11, oy + 73), (ox + 12, oy + 76), (ox - 12, oy + 76)], fill=SW + 1)
    pd.polygon([(ox - 3, oy + 76), (ox + 3, oy + 76), (ox + 2, oy + 128), (ox, oy + 133), (ox - 2, oy + 128)], fill=SW + 2)
    A = np.array(pid)
    sil = A > 0
    out = np.full((Hk, Wk), T, np.uint8)
    em = np.zeros((Hk, Wk), bool)

    iron = ("BROWN_1", "SLATE_0", "SLATE_1", "SLATE_2")
    gold = ("GOLD_DK", "GOLD", "SUN", "CREAM")
    if tier == 1:
        iron = ("BROWN_1", "SLATE_0", "SLATE_1", "CREAM")
    capec = ("TERRA_0", "CRT_0", "CRT_1")

    for y in range(Hk):
        row = A[y]
        for x in range(Wk):
            p = row[x]
            if p == 0:
                continue
            if p == 1:
                # cape: folds
                c = capec[1] if (x // 3) % 2 else capec[0]
                if x > ox + 14 and y < oy + 60:
                    c = capec[2]
                out[y, x] = N[c]
                continue
            if p >= SW:
                nm = "sword"
            else:
                nm = names[p - 2]
            ramp = gold if nm in gold_parts else iron
            if nm == "sword" and tier < 5:
                ramp = ("SLATE_0", "SLATE_1", "SLATE_2", "CREAM") if p == SW + 2 else iron
                if p == SW + 1 and tier >= 3:
                    ramp = gold
            # local span of this part on the row
            xs = np.where(row == p)[0]
            u = (x - xs.min()) / max(1, xs.max() - xs.min())
            c = ramp[1]
            if u < 0.28:
                c = ramp[0]
            elif u > 0.72:
                c = ramp[2]
            if y > 0 and A[y - 1, x] != p and nm not in ("leg", "sword"):
                c = ramp[2]  # top light from the downlight
            if x + 1 < Wk and A[y, x + 1] == 0:
                c = ramp[3]  # window rim on the right edge
            out[y, x] = N[c]
    # seams between different parts
    seam = None
    if tier == 1:
        seam = "INK"
    elif tier == 2:
        seam = "GOLD"
    else:
        seam = "GOLD_DK" if tier < 5 else "AMBER"
    for y in range(1, Hk - 1):
        for x in range(1, Wk - 1):
            p = A[y, x]
            if p <= 1:
                continue
            q = A[y - 1, x]
            r = A[y, x - 1]
            if (q > 1 and q != p and not (q >= SW and p >= SW)) or (r > 1 and r != p and not (r >= SW and p >= SW)):
                out[y, x] = N[seam]
                if tier == 2:
                    em[y, x] = True
    # gold trim on pauldrons + gauntlets (III), helm crest ridge
    pa, ha = names.index("pauldron") + 2, names.index("hand") + 2
    fa = names.index("forearm") + 2
    if tier >= 3:
        for y in range(Hk):
            for x in range(Wk):
                p = A[y, x]
                if p in (pa, ha) or (p == fa and tier >= 3):
                    nb = [A[y + dy, x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= y + dy < Hk and 0 <= x + dx < Wk]
                    if any(n != p for n in nb):
                        if p == fa and not any(n == 0 for n in nb):
                            continue
                        out[y, x] = N["SUN" if x > ox else "GOLD"]
    # visor slit
    vis = {1: ("VOID", "VOID"), 2: ("NAVY", "ENERGY"), 3: ("NAVY", "ENERGY"), 4: ("ENERGY", "ENERGY_HI"), 5: ("ENERGY", "ENERGY_HI")}[tier]
    for x in range(ox - 5, ox + 6):
        out[oy + 8, x] = N[vis[0]]
        out[oy + 9, x] = N["INK"] if tier == 1 else N[vis[0]]
    if tier >= 2:
        for x in range(ox - 2 if tier == 2 else ox - 4, ox + (3 if tier == 2 else 5)):
            out[oy + 8, x] = N[vis[1]]
            em[oy + 8, x] = True
    out[oy + 11:oy + 16, ox] = N["INK" if tier < 5 else "GOLD_DK"]  # helm centre seam / breath line
    # energy lines
    if tier >= 3:
        core = "ENERGY" if tier == 3 else "ENERGY_HI"
        segs = [((-5, 25), (-4, 49)), ((5, 25), (4, 49)), ((-7, 57), (-8, 70)), ((7, 57), (8, 70)),
                ((-6, 99), (-6, 121)), ((6, 99), (6, 121)), ((-7, 73), (-7, 87)), ((7, 73), (7, 87)),
                ((14, 24), (19, 27)), ((-14, 24), (-19, 27)), ((0, 80), (0, 124))]
        if tier >= 4:
            segs += [((-3, 3), (-3, 7)), ((3, 3), (3, 7)), ((-17, 36), (-18, 46)), ((17, 36), (18, 46))]
        im2 = Image.new("L", (Wk, Hk), 0)
        d2 = ImageDraw.Draw(im2)
        for (ax, ay), (bx, by) in segs:
            d2.line([ox + ax, oy + ay, ox + bx, oy + by], fill=1)
        M = (np.array(im2) > 0) & sil
        out[M] = N[core]
        em[M] = True
        if tier >= 4:  # halo pixels beside the lines
            Mh = np.zeros_like(M)
            Mh[:, 1:] |= M[:, :-1]
            Mh[:, :-1] |= M[:, 1:]
            Mh &= sil & ~M
            Mh &= np.isin(out, [N["SLATE_0"], N["BROWN_1"], N["GOLD_DK"], N["INK"]])
            out[Mh] = N["ENERGY"]
            em[Mh] = True
    # chest emblem (IV, V): tiny anvil
    if tier >= 4:
        for dx, dy in ((-3, 0), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (3, 0), (-1, 1), (0, 1), (1, 1), (0, 2), (-2, 3), (-1, 3), (0, 3), (1, 3), (2, 3)):
            out[oy + 33 + dy, ox + dx] = N["ENERGY_HI"]
            em[oy + 33 + dy, ox + dx] = True
    # outline
    ol = np.zeros_like(sil)
    ol[1:, :] |= sil[:-1, :]
    ol[:-1, :] |= sil[1:, :]
    ol[:, 1:] |= sil[:, :-1]
    ol[:, :-1] |= sil[:, 1:]
    ol &= ~sil
    out[ol] = N["INK"]
    # crest / halo (V), plume (V)
    if tier >= 5:
        hal = Image.new("L", (Wk, Hk), 0)
        ImageDraw.Draw(hal).ellipse([ox - 14, oy - 12, ox + 14, oy + 14], outline=1)
        Mh = (np.array(hal) > 0) & (out == T)
        out[Mh] = N["SUN"]
        em[Mh] = True
        for i, (dx, dy) in enumerate(((0, -1), (1, -2), (-1, -2), (0, -3), (1, -4), (2, -5), (0, -5), (3, -6), (1, -6))):
            out[oy + dy, ox + dx] = N["CRT_1" if i % 3 else "CRT_0"]
    # glitch (tier-up hologram flicker)
    if glitch:
        rng = random.Random(9)
        for _ in range(7):
            y = rng.randint(0, Hk - 1)
            sh = rng.choice((-3, -2, 2, 3))
            out[y] = np.roll(out[y], sh)
            em[y] |= out[y] != T
            row = out[y]
            row[(row != T) & (np.arange(Wk) % 3 == 0)] = N["ENERGY"]
    # stamp
    x0 = int(cx) - ox
    y0 = int(yb) - KH - oy
    m = out != T
    a = np.array(S.im)
    e = np.array(S.em)
    hs, ws = a[y0:y0 + Hk, x0:x0 + Wk].shape
    a[y0:y0 + hs, x0:x0 + ws][m[:hs, :ws]] = out[:hs, :ws][m[:hs, :ws]]
    e[y0:y0 + hs, x0:x0 + ws][em[:hs, :ws]] = 255  # only the energy lines and visor glow
    S.im = Image.fromarray(a, "P")
    S.im.putpalette(FLAT)
    S.d = ImageDraw.Draw(S.im)
    S.em = Image.fromarray(e, "L")
    S.de = ImageDraw.Draw(S.em)


KN_X, KN_Z = -4.8, 1.3


def knight_zone():
    cx, _ = pj(KN_X, 0, 0)
    # tapestry with an original anvil-and-hammer emblem
    with obj("tapestry"):
        tx0, ty0 = pji(KN_X - 1.9, 11.8, 0)
        tx1, ty1 = pji(KN_X + 1.9, 4.4, 0)
        L(tx0 - 3, ty0, tx1 + 3, ty0, "GOLD_DK")
        P(tx0 - 4, ty0, "GOLD")
        P(tx1 + 4, ty0, "GOLD")
        mid = (tx0 + tx1) // 2
        POLY([(tx0, ty0 + 1), (tx1, ty0 + 1), (tx1, ty1), (mid, ty1 + 9), (tx0, ty1)], "TERRA_0", "INK")
        POLY([(tx0 + 3, ty0 + 3), (tx1 - 3, ty0 + 3), (tx1 - 3, ty1 - 1), (mid, ty1 + 6), (tx0 + 3, ty1 - 1)], "PLUM_1")
        POLY([(tx0 + 4, ty0 + 4), (tx1 - 4, ty0 + 4), (tx1 - 4, ty1 - 2), (mid, ty1 + 4), (tx0 + 4, ty1 - 2)], "TERRA_0")
        for yy in range(ty0 + 4, ty1, 6):
            P(tx0 + 3, yy, "GOLD")
            P(tx1 - 3, yy, "GOLD")
        # emblem: anvil with a hammer striking, three sparks (original)
        ey = ty0 + 7
        R(mid - 8, ey + 9, mid + 7, ey + 10, "GOLD")          # anvil face
        POLY([(mid - 11, ey + 9), (mid - 8, ey + 9), (mid - 8, ey + 11)], "GOLD")  # horn
        R(mid - 4, ey + 11, mid + 3, ey + 13, "GOLD_DK")      # waist
        R(mid - 7, ey + 14, mid + 6, ey + 15, "GOLD")         # base
        L(mid + 1, ey + 7, mid + 8, ey, "OAK_2")              # hammer handle
        R(mid - 1, ey + 3, mid + 3, ey + 6, "GOLD")           # hammer head (tilted)
        P(mid - 1, ey + 3, "SUN")
        for dx, dy in ((-6, 5), (-9, 3), (-4, 2)):
            P(mid + dx, ey + dy, "SUN")
    # pedestal with runes
    with obj("pedestal"):
        f = box3d(KN_X - 1.8, KN_X + 1.8, 0, 1.0, KN_Z - 1.2, KN_Z + 1.0, "BROWN_1", side="INK", top="SLATE_0")
        (ax, ay), (bx, by), (cx2, cy2), (dx, dy) = f["front"]
        R(ax + 1, ay + 1, bx - 1, ay + 1, "SLATE_1")
        # plaque (tier name only)
        names = {1: "|*RAW", 2: "||*AWAKENED", 3: "|||*FORGED", 4: "|V*ASCENDANT", 5: "V*SOVEREIGN"}
        s = names[TIER].replace("V", "V")
        tw = text_w(s)
        px0 = int((ax + bx) / 2 - tw / 2) - 2
        BOX(px0, ay + 3, px0 + tw + 3, ay + 10, "GOLD_DK", hi="GOLD")
        text(px0 + 2, ay + 4, s, "SUN")
        # runes pulsing up the base: cyan marks + vertical lines on the corners
        for i, rx in enumerate(range(int(ax) + 3, int(bx) - 2, 5)):
            if px0 - 2 <= rx <= px0 + tw + 5:
                continue
            P(rx, ay + 5 + (i % 2), "ENERGY!")
            P(rx + 1, ay + 6 - (i % 2), "ENERGY!")
            P(rx, ay + 8, "SLATE_1")
        for x in (int(ax) + 1, int(bx) - 1):
            L(x, ay + 2, x, dy - 2, "ENERGY!")
        L(ax + 2, ay - 1, bx - 2, ay - 1, "ENERGY!")
        shadow_fp(KN_X - 1.8, KN_X + 1.8, KN_Z - 1.2, KN_Z + 1.0)
    # knight
    with obj("knight"):
        _, ky = pj(KN_X, 1.0, KN_Z)
        knight(TIER, cx, ky - 2)
    kx, ky = pj(KN_X, 5, KN_Z)
    light(kx, ky, 40, 80, 1.0)
    light(kx, pj(0, 0.5, KN_Z)[1], 46, 18, 0.8)
    tint(kx, pj(0, 1.0, KN_Z)[1] - 6, 34, 24, "cyan", 1.0)
    tint(kx, ky - 6, 30, 62, "cyan", 0.5 + 0.12 * TIER)
    if FLAGS["beam"]:
        G.beam = True


def library():
    rng = random.Random(31)
    # potion shelf on the wall (bubbling, glowing bottles)
    with obj("potions"):
        x0, y0 = pji(-13.8, 8.6, 0)
        x1, _ = pji(-12.2, 8.6, 0)
        for k, Yb in enumerate((8.6, 7.1)):
            _, yb = pji(0, Yb, 0)
            R(x0, yb, x1, yb + 2, "OAK_1")
            L(x0, yb + 2, x1, yb + 2, "INK")
            L(x0, yb, x1, yb, "OAK_2")
            cols = [("PLUM_2", "PLUM_3"), ("LEAF_2", "LEAF_3"), ("SLATE_1", "ENERGY"), ("CRT_0", "CRT_1"), ("GOLD", "SUN")]
            x = x0 + 2
            i = k * 2
            while x < x1 - 3:
                a, b = cols[i % len(cols)]
                h = 5 + (i % 3)
                R(x, yb - h, x + 3, yb - 1, "INK")
                R(x + 1, yb - h + 2, x + 2, yb - 1, a + "!")
                P(x + 1, yb - h + 3 + (i % 2), b + "!")
                R(x + 1, yb - h - 1, x + 2, yb - h, "OAK_2")  # cork
                if (i + af("potions")) % 2 == 0:
                    P(x + 2 - (i + af("potions")) % 2, yb - h - 2 - ((i + af("potions")) % 3), b + "!")  # bubble
                x += 5
                i += 1
        light((x0 + x1) / 2, (y0 + 0) + 8, 22, 22, 0.5)
        tint((x0 + x1) / 2, y0 + 6, 22, 20, "potion", 0.8)
    # bookcase (Reading): the tall dark case with a rolling ladder and plants spilling off the top
    BX0, BX1, BH = -12.0, -8.4, 10.4
    with obj("bookcase"):
        f = box3d(BX0, BX1, 0, BH, 0, 1.2, "OAK_DK", side="INK", top="OAK_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 3, ay + 4, bx - 3, dy - 5, "VOID")                 # deep dark back
        L(ax + 1, ay + 1, bx - 1, ay + 1, "OAK_0")
        R(ax + 1, ay + 2, ax + 2, dy - 2, "OAK_0")                # side posts catch a little light
        L(bx - 1, ay + 2, bx - 1, dy - 2, "INK")
        R(ax, ay - 3, bx, ay - 1, "OAK_0")                        # cornice
        L(ax - 1, ay - 3, bx + 1, ay - 3, "INK")
        L(ax, ay - 1, bx, ay - 1, "INK")
        # rail for the ladder across the front, just under the cornice
        L(ax - 2, ay + 5, bx + 2, ay + 5, "GOLD_DK")
        P(ax - 2, ay + 5, "GOLD")
        P(bx + 2, ay + 5, "GOLD")
        shelves = 8
        hgt = (dy - 5 - (ay + 4)) / shelves
        for k in range(shelves):
            yb = int(ay + 4 + (k + 1) * hgt) - 1
            R(ax + 3, yb, bx - 3, yb + 1, "OAK_0")
            L(ax + 3, yb + 1, bx - 3, yb + 1, "INK")
            if k < shelves - 1:
                books_row(ax + 4, bx - 4, yb - 1, int(hgt) - 3, rng,
                          n_fill=(0.3, 0.85, 1.0)[stg("library.bookshelf")] * (1 if k not in (2, 5) else 0.6))
                if stg("library.bookshelf") == 2 and k % 2 == 0:
                    R(bx - 6, yb - 6, bx - 5, yb - 1, "GOLD")   # gold bookends
                if k == 2:
                    G.shelf_plant = (bx - 9, yb)
                if k == 5:   # a globe-shaped bookend ornament
                    circ(bx - 8, yb - 3, 2, "SLATE_1")
                    P(bx - 9, yb - 4, "SLATE_2")
            else:
                R(ax + 3, yb - int(hgt) + 3, bx - 3, yb - 1, "OAK_DK")
                L((ax + bx) // 2, yb - int(hgt) + 3, (ax + bx) // 2, yb - 1, "INK")
                P((ax + bx) // 2 - 3, yb - int(hgt) // 2 + 1, "GOLD_DK")
                P((ax + bx) // 2 + 3, yb - int(hgt) // 2 + 1, "GOLD_DK")
        shadow_fp(BX0, BX1, 0, 1.2)
    with obj("bookcase-plants"):
        px, yb = G.shelf_plant   # a small trailing plant on a shelf
        pot(px - 2, yb - 4, px + 2, yb, "TERRA_1")
        for i in range(2):
            vine(px - 1 + i * 2, yb, 7 + i * 3, rng, sw=swv(i + 1))
        # plants spilling off the top: a pothos and a fern, vines trailing down the front
        (tx0, ty0), (tx1, _) = pj(BX0, BH, 0.6), pj(BX1, BH, 0.6)
        for k, (cx, w) in enumerate(((tx0 + 9, 6), (tx1 - 10, 7))):
            pot(cx - 4, ty0 - 7, cx + 4, ty0 - 1, "TERRA_1" if k == 0 else "SLATE_0")
            bush(cx, ty0 - 10, w, 4, rng, n=30)
            for i in range(5 if k == 0 else 4):
                vine(int(cx) - 5 + i * 3, int(ty0) - 2, rng.randint(14, 34), rng, drift=0.1 * (i - 2), sw=swv(k + i))
        for i in range(4):   # one long strand that reaches past the top shelves
            vine(int(tx0) + 18 + i * 4, int(ty0) - 1, rng.randint(10, 22), rng, sw=swv(i))
    with obj("ladder"):
        # rolling library ladder hooked on the rail, leaning out to the floor
        for X in (-11.6, -10.7):
            t, b = pj(X, BH - 0.85, 1.25), pj(X, 0, 3.0)
            L(t[0], t[1], b[0], b[1], "OAK_1")
            L(t[0] + 1, t[1], b[0] + 1, b[1], "OAK_0")
            R(b[0] - 1, b[1] - 1, b[0] + 2, b[1] + 1, "INK")   # wheel
            P(b[0], b[1] - 1, "SLATE_1")
            P(t[0], t[1] - 1, "GOLD")                          # hook on the rail
        for k in range(1, 11):
            u = k / 11
            Y = (BH - 0.85) * (1 - u)
            zz = 1.25 + (3.0 - 1.25) * u
            a_, b_ = pj(-11.6, Y, zz), pj(-10.7, Y, zz)
            L(a_[0] + 1, a_[1], b_[0], b_[1], "OAK_2" if k % 2 else "OAK_1")
        pass
    # trophy case (glass, soft steady light): relics inside
    with obj("trophy-case"):
        f = box3d(-8.2, -6.8, 0, 5.4, 0, 1.2, "OAK_DK", side="OAK_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 2, ay + 3, bx - 2, dy - 6, "SLATE_0")
        for k, yy in enumerate((ay + 18, ay + 36, ay + 54)):
            if yy < dy - 6:
                L(ax + 2, yy, bx - 2, yy, "SLATE_1")
        L(ax + 3, ay + 4, ax + 3, dy - 8, "SLATE_2")   # glass glint
        L(ax + 4, ay + 4, ax + 4, ay + 10, "CREAM")
        R(ax + 2, ay + 2, bx - 2, ay + 2, "CREAM!")    # soft top strip light
        # relics on shelves (small, one ember)
        cx = (ax + bx) // 2
        POLY([(cx - 3, ay + 17), (cx - 4, ay + 11), (cx + 4, ay + 11), (cx + 3, ay + 17)], "GOLD", "INK")
        R(cx - 1, ay + 31, cx + 2, ay + 35, "SLATE_2")
        P(cx, ay + 30, "CREAM")
        R(cx - 3, ay + 50, cx + 3, ay + 53, "OAK_2")
        P(cx - 1, ay + 49, "GOLD")
        shadow_fp(-8.2, -6.8, 0, 1.2)
        light(cx, ay + 20, 12, 22, 0.25)
    with obj("book-stack"):
        bx_, by_ = pj(-7.6, 0, 2.2)
        cols = ["SLATE_1", "TERRA_1", "GOLD_DK", "LEAF_2", "PLUM_1", "CREAM"]
        y = by_
        for i, c in enumerate(cols):
            w = 11 - (i % 3)
            o = (i % 2)
            R(bx_ - w // 2 + o, y - 2, bx_ + w // 2 + o, y, c)
            L(bx_ - w // 2 + o, y - 2, bx_ + w // 2 + o, y - 2, LIGHTER.get(c, c))
            P(bx_ + w // 2 + o, y - 1, "INK")
            y -= 3
        shadow_ell(bx_, by_, 8, 2)


def window_zone():
    rng = random.Random(61)
    with obj("floor-plant-window"):
        px, py = pj(-2.4, 0, 0.9)
        pot(px - 5, py - 9, px + 5, py, "SLATE_0")
        L(px, py - 9, px - 1, py - 40, "OAK_0")
        for i, (dy, a) in enumerate(((-14, -2.5), (-18, -0.6), (-23, -2.7), (-27, -0.4), (-31, -2.2), (-34, -0.9), (-38, -1.6))):
            big_leaf(px - 1, py + dy, a + 0.07 * swv(i), 9, 4, "LEAF_2" if i % 2 else "LEAF_1", "LEAF_0", "LEAF_0", hi="LEAF_3")
        shadow_ell(px, py, 8, 2)
    MX0, MX1 = 1.0, 5.8
    with obj("media-stand"):
        f = box3d(MX0, MX1, 0, 1.7, 0.0, 1.6, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        mid = (ax + bx) / 2
        R(ax + 2, ay + 3, mid - 1, dy - 3, "OAK_DK")
        R(mid + 1, ay + 3, bx - 2, dy - 3, "OAK_DK")
        R(ax + 4, ay + 6, mid - 4, ay + 9, "INK")    # console
        P(ax + 6, ay + 7, "LEAF_3!")
        for k in range(3):
            L(mid + 3, ay + 5 + k * 4, bx - 4, ay + 5 + k * 4, BOOKC[k * 3])
        shadow_fp(MX0, MX1, 0, 1.6)
    with obj("crt-big"):  # Today
        f = box3d(MX0 + 0.3, MX0 + 2.9, 1.7, 3.9, 0.15, 1.45, "BROWN_1", side="INK", top="SLATE_0")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 2, ay + 2, bx - 7, dy - 3, "INK")
        R(ax + 3, ay + 3, bx - 8, dy - 4, "CRT_0!")
        R(ax + 4, ay + 4, bx - 9, ay + 6, "CRT_1!")
        L(ax + 4, ay + 9, bx - 12, ay + 9, "TERRA_0!")
        circ((ax + bx - 11) / 2, ay + 11, 3, "ORANGE!")
        L(ax + 4, dy - 6, bx - 9, dy - 6, "TERRA_0!")
        for k in range(3):
            P(bx - 4, ay + 4 + k * 3, "SLATE_1")
        R(bx - 5, dy - 5, bx - 3, dy - 4, "CRT_1!")
        cx_, cy_ = (ax + bx) / 2, (ay + dy) / 2
        light(cx_, cy_ + 6, 30, 26, 0.8)
        with channel("crt"):
            tint(cx_, cy_ - 4, 30, 22, "red", (0.9, 0.7, 1.15)[af("crt")])
        G.screens["crt-big"] = (ax + 3, ay + 3, bx - 8, dy - 4)
    with obj("crt-small"):  # stats
        f = box3d(MX0 + 3.0, MX0 + 4.75, 1.7, 3.3, 0.3, 1.3, "SLATE_0", side="INK", top="SLATE_1")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        ax, ay, bx, dy = int(ax), int(ay), int(bx), int(dy)
        R(ax + 1, ay + 1, bx - 1, dy - 3, "INK")
        R(ax + 2, ay + 2, bx - 2, dy - 4, "TERRA_0!")
        L(ax + 3, ay + 3, bx - 3, ay + 3, "CRT_0!")
        G.screens["crt-small"] = (ax + 2, ay + 2, bx - 2, dy - 4)
        P(bx - 3, dy - 2, "CRT_1!")
        light((ax + bx) / 2, (ay + dy) / 2, 18, 16, 0.4)
        with channel("crt"):
            tint((ax + bx) / 2, (ay + dy) / 2 + 6, 18, 18, "red", (0.7, 0.55, 0.85)[af("crt")])
    # chess: a big 8x8 board on its own stand, pieces mid-game, a stool beside it
    TX, TZ = 9.6, 2.8
    with obj("chess-table"):
        cx_, ty = pj(TX, 2.6, TZ)
        _, fy = pj(TX, 0, TZ)
        # pedestal stand: turned post, wide foot
        R(cx_ - 2, ty + 6, cx_ + 2, fy - 4, "INK")
        R(cx_ - 1, ty + 6, cx_ + 1, fy - 4, "OAK_1")
        P(cx_ - 1, ty + 12, "OAK_2")
        R(cx_ - 3, ty + 14, cx_ + 3, ty + 16, "OAK_0")
        POLY([(cx_ - 11, fy), (cx_ - 5, fy - 4), (cx_ + 5, fy - 4), (cx_ + 11, fy)], "OAK_0", "INK")
        L(cx_ - 6, fy - 3, cx_ + 6, fy - 3, "OAK_1")
        # board: slightly tilted toward the room so all 64 squares read
        bw, bd = 46, 20
        x0b, y0b = cx_ - bw // 2, ty - bd + 4
        POLY([(x0b - 3, y0b + bd + 2), (x0b + bw + 3, y0b + bd + 2), (x0b + bw + 1, y0b - 2), (x0b - 1, y0b - 2)], "OAK_DK", "INK")
        R(x0b - 3, y0b + bd + 3, x0b + bw + 3, y0b + bd + 5, "OAK_0")       # board edge (front face)
        L(x0b - 3, y0b + bd + 5, x0b + bw + 3, y0b + bd + 5, "INK")
        for j in range(8):          # rows from the back (narrower) to the front
            ya = y0b + int(j * bd / 8)
            yb = y0b + int((j + 1) * bd / 8) - 1
            inset = (7 - j) * 0.25
            for i in range(8):
                xa = int(round(x0b + inset + i * (bw - 2 * inset) / 8))
                xb = int(round(x0b + inset + (i + 1) * (bw - 2 * inset) / 8)) - 1
                R(xa, ya, xb, max(ya, yb), "CREAM" if (i + j) % 2 == 0 else "OAK_1")

        def sq(i, j):
            inset = (7 - j) * 0.25
            xa = x0b + inset + (i + 0.5) * (bw - 2 * inset) / 8
            ya = y0b + (j + 0.75) * bd / 8
            return int(round(xa)), int(round(ya))
        # pieces: (file, rank-from-back, colour, kind) 0 pawn, 1 rook, 2 knight, 3 bishop, 4 queen, 5 king
        pcs = [(0, 0, "INK", 1), (4, 0, "INK", 5), (5, 0, "INK", 1), (2, 1, "INK", 3), (0, 1, "INK", 0), (1, 1, "INK", 0),
               (5, 1, "INK", 0), (6, 1, "INK", 0), (7, 2, "INK", 0), (3, 2, "INK", 0), (5, 2, "INK", 2), (4, 3, "INK", 0),
               (3, 4, "CREAM", 0), (4, 4, "CREAM", 4), (2, 5, "CREAM", 2), (0, 6, "CREAM", 0), (1, 6, "CREAM", 0),
               (5, 6, "CREAM", 0), (6, 6, "CREAM", 0), (7, 6, "CREAM", 0), (2, 6, "CREAM", 3), (0, 7, "CREAM", 1),
               (4, 7, "CREAM", 5), (7, 7, "CREAM", 1)]
        for fi, rk, col, kind in sorted(pcs, key=lambda p: p[1]):
            x, y = sq(fi, rk)
            dark = col == "INK"
            body = "BROWN_1" if dark else "CREAM"
            hi = "SLATE_0" if dark else "SUN"
            h = (3, 4, 5, 5, 6, 7)[kind]
            R(x - 1, y - 1, x + 1, y, "INK")                 # base
            P(x, y - 1, body)
            R(x, y - h, x, y - 2, body)
            P(x - 1, y - 2, "INK" if not dark else body)
            if kind == 0:
                P(x, y - h, hi)
            elif kind == 1:   # rook: notched top
                P(x - 1, y - h, body); P(x + 1, y - h, body)
            elif kind == 2:   # knight: head to one side
                P(x + (1 if dark else -1), y - h + 1, body); P(x, y - h, hi)
            elif kind == 3:
                P(x, y - h, hi); P(x, y - h - 1, "INK" if not dark else hi)
            elif kind == 4:
                P(x - 1, y - h, body); P(x + 1, y - h, body); P(x, y - h - 1, "GOLD")
            else:
                P(x, y - h - 1, "GOLD"); P(x - 1, y - h, "GOLD"); P(x + 1, y - h, "GOLD")
        if stg("library.chess") == 2:   # chess clock on the board's edge
            R(x0b + bw + 4, y0b + bd - 2, x0b + bw + 10, y0b + bd + 2, "INK")
            P(x0b + bw + 5, y0b + bd - 1, "CREAM")
            P(x0b + bw + 9, y0b + bd - 1, "CREAM")
            P(x0b + bw + 7, y0b + bd - 3, "CRT_1")
        shadow_ell(cx_, fy, 14, 3)
    with obj("chess-stool"):
        x, yf = pj(TX + 2.3, 0, TZ + 0.6)
        _, ys = pj(TX + 2.3, 1.6, TZ + 0.6)
        ELL(x - 7, ys - 3, x + 7, ys + 2, "OAK_1", "INK")
        L(x - 5, ys - 2, x + 5, ys - 2, "OAK_2")
        for dx in (-5, -1, 3, 6):
            L(x + dx * 0.9, ys + 2, x + dx * 1.2, yf, "OAK_0" if dx < 3 else "OAK_DK")
        L(x - 5, (ys + yf) // 2 + 2, x + 6, (ys + yf) // 2 + 2, "OAK_DK")
        shadow_ell(x, yf, 8, 2, k=1.0)
    # meditation: small rug, cushion and candle in front of the window, facing the sunset
    MX, MZ = 3.4, 4.2
    with obj("med-rug"):
        rx, ry = pj(MX, 0, MZ)
        s_ = sc(MZ)
        ELL(rx - 1.9 * s_, ry - 0.40 * s_, rx + 1.9 * s_, ry + 0.40 * s_, "PLUM_1", "INK")
        ELL(rx - 1.5 * s_, ry - 0.29 * s_, rx + 1.5 * s_, ry + 0.29 * s_, "PLUM_2")
        ELL(rx - 1.0 * s_, ry - 0.18 * s_, rx + 1.0 * s_, ry + 0.18 * s_, "PLUM_1")
        for k in range(-3, 4):
            P(rx + k * 0.5 * s_, ry + 0.40 * s_ + 1, "CREAM")
    with obj("med-cushion"):
        rx, ry = pj(MX, 0, MZ - 0.15)
        ELL(rx - 10, ry - 6, rx + 10, ry + 2, "TERRA_1", "INK")
        ELL(rx - 8, ry - 6, rx + 8, ry - 2, "TERRA_2")
        L(rx - 5, ry - 5, rx + 5, ry - 5, "RIM")
        P(rx, ry - 4, "TERRA_0")
        shadow_ell(rx, ry + 1, 11, 3, k=1.0)
    with obj("med-candle"):
        cx_, cy_ = pj(MX + 1.7, 0, MZ - 0.6)
        if stg("bed.cushion") > 0:   # s0: the cushion alone
            BOX(cx_ - 2, cy_ - 7, cx_ + 1, cy_, "CREAM", hi="CREAM", sh="AMBER")
            R(cx_ - 3, cy_ - 1, cx_ + 2, cy_, "GOLD_DK")
            with channel("candle"):
                fl = af("candle")
                P(cx_, cy_ - 8, "SUN!")
                P(cx_ - (fl == 1), cy_ - 9, "GLOW!")
                if fl != 2:
                    P(cx_, cy_ - 10, "ORANGE!")
                light(cx_, cy_ - 8, 18, 14, (0.55, 0.45, 0.65)[fl])


def rug():
    with obj("rug"):
        q = [pj(KN_X - 2.1, 0, 2.6), pj(KN_X + 2.1, 0, 2.6), pj(KN_X + 2.6, 0, 7.0), pj(KN_X - 2.6, 0, 7.0)]
        POLY(q, "TERRA_0", "INK")
        q2 = [pj(KN_X - 1.7, 0, 3.1), pj(KN_X + 1.7, 0, 3.1), pj(KN_X + 2.2, 0, 7.0), pj(KN_X - 2.2, 0, 7.0)]
        POLY(q2, "CRT_0")
        q3 = [pj(KN_X - 1.2, 0, 3.6), pj(KN_X + 1.2, 0, 3.6), pj(KN_X + 1.5, 0, 7.0), pj(KN_X - 1.5, 0, 7.0)]
        POLY(q3, "TERRA_0")
        for z in (4.4, 5.8):
            c = pj(KN_X, 0, z)
            s = sc(z)
            POLY([(c[0], c[1] - 0.25 * s * 0.5), (c[0] + 0.6 * s, c[1]), (c[0], c[1] + 0.25 * s * 0.5), (c[0] - 0.6 * s, c[1])], "GOLD")
        for z in [2.6 + 0.3 * k for k in range(0)]:
            pass


def chair_back(X, z, side=-1):
    """Small wooden chair seen from behind, turned slightly toward the window (side = lean of the back)."""
    s = sc(z)
    x, yf = pj(X, 0, z)
    _, yfb = pj(X, 0, z - 1.0)
    _, ys = pj(X, 1.55, z)
    _, ysb = pj(X, 1.55, z - 1.0)
    w = int(0.62 * s)
    # far legs, seat (top face), near legs
    for lx in (x - w + 2 + side, x + w - 2 + side):
        L(lx, ysb, lx, yfb, "OAK_DK")
    POLY([(x - w + side * 2, ysb), (x + w + side * 2, ysb), (x + w, ys), (x - w, ys)], "OAK_1", "INK")
    L(x - w + 1, ys - 1, x + w - 1, ys - 1, "OAK_2")
    for lx in (x - w + 1, x + w - 1):
        L(lx, ys + 1, lx, yf, "OAK_0")
        P(lx, yf, "INK")
    L(x - w + 1, ys + 1, x + w - 1, ys + 1, "INK")
    # back: two posts + top rail + 3 spindles
    _, yt = pj(X, 3.1, z)
    for px_ in (x - w + 1, x + w - 1):
        L(px_, ys, px_ + side, yt, "OAK_0")
    R(x - w + 1 + side, yt, x + w - 1 + side, yt + 3, "OAK_1")
    L(x - w + 1 + side, yt, x + w - 1 + side, yt, "OAK_2")
    L(x - w + side, yt - 1, x + w + side, yt - 1, "INK")
    for k in (-1, 0, 1):
        L(x + k * (w // 2) + side, yt + 4, x + k * (w // 2), ys - 1, "OAK_DK")
    shadow_ell(x + side, (yf + yfb) / 2, w + 2, 3, k=1.0)





# ---------------------------------------------------------------- scenes per view
SCENES = {}


def scene(view):
    def deco(fn):
        SCENES[view] = fn
        return fn
    return deco


def front_extras():
    """Right of the window: the FORGE neon, the pennant and a photo; two pendants hang over the bookcase and the chess."""
    X0 = 9.4
    with obj("forge-sign", mat={"default": "metal_painted", "PLUM_3": "neon", "CREAM": "neon"}):
        x0, y0 = pji(X0 + 0.4, 11.6, 0)
        BOX(x0 - 3, y0 - 3, x0 + text_w("FORGE") * 2 + 2, y0 + 12, "INK", hi="PLASTER_0")
        xx = x0
        for ch in "FORGE":
            g = FONT[ch]
            for i, b in enumerate(g):
                if b == "1":
                    R(xx + (i % 3) * 2, y0 + (i // 3) * 2, xx + (i % 3) * 2 + 1, y0 + (i // 3) * 2 + 1, "PLUM_3!")
                    P(xx + (i % 3) * 2, y0 + (i // 3) * 2, "CREAM!")
            xx += 8
        cx_ = (x0 + xx) / 2
        light(cx_, y0 + 5, 30, 16, 0.6)
        tint(cx_, y0 + 5, 36, 18, "pink", 1.0)
    with obj("pennant", mat={"default": "fabric_cotton", "CREAM": "paper"}):
        a = pj(X0 + 0.2, 9.6, 0)
        b = pj(X0 + 3.4, 9.05, 0)
        c = pj(X0 + 0.2, 8.5, 0)
        POLY([a, b, c], "LEAF_2", "INK")
        L(a[0] + 1, a[1] + 2, b[0] - 4, b[1], "SLATE_2")
        L(a[0] + 1, c[1] - 2, b[0] - 4, b[1], "SLATE_2")
        R(a[0] - 1, a[1], a[0], c[1], "CREAM")
        text(a[0] + 3, a[1] + 3, "TU", "CREAM")
    with obj("photo", mat={"default": "paper", "OAK_2": "wood_furniture", "AMBER": "wood_furniture", "INK": "wood_furniture"}):
        x0, y0 = pji(X0 + 0.6, 7.8, 0)
        x1, y1 = pji(X0 + 2.2, 6.4, 0)
        BOX(x0, y0, x1, y1, "OAK_2", hi="AMBER")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "SLATE_1")
        R(x0 + 2, y1 - 6, x1 - 2, y1 - 2, "LEAF_2")
        P(x0 + 6, y1 - 8, "CREAM")
        P(x0 + 11, y1 - 8, "TERRA_2")
        P(x0 + 6, y1 - 7, "PLUM_1")
        P(x0 + 11, y1 - 7, "PLUM_1")
    for k, (X, z, Yl) in enumerate(((-10.2, 2.4, 9.6), (9.6, 2.8, 8.8))):
        with obj("pendant", mat={"default": "metal_painted", "GOLD": "gold_metal", "GOLD_DK": "gold_metal", "SUN": "bulb", "CREAM": "bulb"}):
            top = pj(X, CEIL - 0.6, z)
            lx, ly = pj(X, Yl, z)
            L(top[0], max(top[1], 0), lx, ly - 4, "INK")
            POLY([(lx - 3, ly - 6), (lx + 3, ly - 6), (lx + 8, ly + 1), (lx - 8, ly + 1)], "GOLD_DK", "INK")
            L(lx - 7, ly, lx + 7, ly, "GOLD")
            R(lx - 2, ly + 2, lx + 2, ly + 3, "SUN!")
            R(lx - 1, ly + 2, lx, ly + 3, "CREAM!")
            light(lx, ly + 30, 46, 52, 0.6)


@scene("front")
def scene_front():
    window()
    library()
    rug()
    knight_zone()
    window_zone()
    front_extras()


# material per object name (TEXTURE_SPEC section 4); a dict maps colours inside the object to other materials
OBJMAT = {
    "window-frame": "wood_furniture", "tapestry": {"default": "fabric_velvet", "GOLD": "gold_metal", "GOLD_DK": "gold_metal", "SUN": "gold_metal", "OAK_2": "wood_furniture"},
    "pedestal": {"default": "stone", "ENERGY": "neon", "GOLD": "gold_metal", "GOLD_DK": "gold_metal", "SUN": "gold_metal"},
    "knight": {"default": "metal_brushed", "GOLD": "gold_metal", "GOLD_DK": "gold_metal", "SUN": "gold_metal", "CREAM": "gold_metal",
               "ENERGY": "neon", "ENERGY_HI": "neon", "TERRA_0": "fabric_velvet", "CRT_0": "fabric_velvet", "CRT_1": "fabric_velvet"},
    "potions": {"default": "ceramic", "OAK_1": "wood_furniture", "OAK_2": "wood_furniture", "INK": "glass_crt"},
    "bookcase": {"default": "book_cloth", "OAK_DK": "wood_furniture", "OAK_0": "wood_furniture", "OAK_1": "wood_furniture", "INK": "wood_furniture",
                 "VOID": "wood_furniture", "GOLD_DK": "gold_metal", "GOLD": "gold_metal"},
    "bookcase-plants": {"default": "leaf", "TERRA_1": "terracotta", "TERRA_0": "terracotta", "TERRA_2": "terracotta", "SLATE_0": "ceramic"},
    "ladder": "wood_furniture",
    "trophy-case": {"default": "wood_furniture", "SLATE_0": "glass_window", "SLATE_1": "glass_window", "SLATE_2": "glass_window", "CREAM": "bulb",
                    "GOLD": "gold_metal"},
    "book-stack": "book_cloth",
    "floor-plant-window": {"default": "leaf", "SLATE_0": "ceramic", "OAK_0": "wood_furniture"},
    "media-stand": {"default": "wood_furniture", "INK": "plastic", "LEAF_3": "bulb"},
    "crt-big": {"default": "plastic", "CRT_0": "screen_emissive", "CRT_1": "screen_emissive", "TERRA_0": "screen_emissive", "ORANGE": "screen_emissive", "INK": "glass_crt"},
    "crt-small": {"default": "plastic", "CRT_0": "screen_emissive", "CRT_1": "screen_emissive", "TERRA_0": "screen_emissive", "INK": "glass_crt"},
    "chess-table": {"default": "wood_furniture", "CREAM": "wood_furniture", "BROWN_1": "plastic", "INK": "plastic", "SUN": "plastic", "GOLD": "gold_metal"},
    "chess-stool": "wood_furniture", "med-rug": "rug_pile", "med-cushion": "fabric_velvet",
    "med-candle": {"default": "paper", "SUN": "flame", "GLOW": "flame", "ORANGE": "flame", "GOLD_DK": "gold_metal"},
    "rug": {"default": "rug_pile", "GOLD": "gold_metal"},
    "hang-plant": {"default": "leaf", "TERRA_1": "terracotta", "TERRA_0": "terracotta", "TERRA_2": "terracotta", "INK": "metal_painted"},
    "beams": "wood_ceiling",
}



SEG = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
       "7": "abc", "8": "abcdefg", "9": "abfgcd"}


def seg7(x, y, s_, h):
    """Red LED digits, 7 segments each (lit segments emissive, unlit dark red)."""
    w = max(4, h // 2 + 1)
    m = h // 2
    for ch in s_:
        if ch == ":":
            P(x + 1, y + m - 2, "CRT_1!")
            P(x + 1, y + m + 2, "CRT_1!")
            x += 4
            continue
        on = SEG.get(ch, "")
        segs = {"a": (x + 1, y, x + w - 1, y), "g": (x + 1, y + m, x + w - 1, y + m), "d": (x + 1, y + h, x + w - 1, y + h),
                "f": (x, y + 1, x, y + m - 1), "b": (x + w, y + 1, x + w, y + m - 1),
                "e": (x, y + m + 1, x, y + h - 1), "c": (x + w, y + m + 1, x + w, y + h - 1)}
        for k, (a, b, c, d) in segs.items():
            L(a, b, c, d, "CRT_1!" if k in on else "TERRA_0")
        x += w + 3



# ================================================================ left wall: kitchen, bed, entry (left view)
@scene("left")
def scene_left():
    rng = random.Random(141)
    with xshift(-1.8):
        with obj("bed-frame-art"):
            fx0, fy0 = pji(7.2, 7.2, 0)
            fx1, fy1 = pji(9.9, 5.0, 0)
            BOX(fx0, fy0, fx1, fy1, "OAK_1", hi="OAK_2")
            R(fx0 + 3, fy0 + 3, fx1 - 3, fy1 - 3, "SLATE_0")
            # original mountain + sun art
            POLY([(fx0 + 3, fy1 - 3), (fx0 + 14, fy0 + 14), (fx0 + 22, fy0 + 22), (fx0 + 32, fy0 + 9), (fx1 - 3, fy1 - 10), (fx1 - 3, fy1 - 3)], "PLUM_1")
            L(fx0 + 14, fy0 + 14, fx0 + 18, fy0 + 18, "PLUM_2")
            L(fx0 + 32, fy0 + 9, fx0 + 36, fy0 + 13, "PLUM_2")
            circ(fx1 - 12, fy0 + 9, 3, "GOLD")
    with xshift(-1.8):
        with obj("bed-shelf"):
            a_, b_ = pji(4.6, 5.85, 0), pji(7.0, 5.6, 0)
            lbox(4.6, 7.0, 5.6, 5.85, 0, 0.8, "OAK_1", side="OAK_0", top="OAK_2")
            px, py = pj(5.2, 5.85, 0.4)
            pot(px - 4, py - 5, px + 4, py, "TERRA_1")
            bush(px, py - 8, 6, 4, rng, n=24)
            for i in range(5):
                vine(int(px) - 4 + i * 2, int(py) + 1, rng.randint(12, 30), rng, drift=0.1, sw=swv(i))
            bx_, by_ = pj(6.6, 5.85, 0.45)    # little books
            for i, c in enumerate(("SLATE_1", "TERRA_1", "GOLD_DK")):
                R(bx_ - 6 + i * 3, by_ - 7 + i, bx_ - 4 + i * 3, by_ - 1, c)
    with xshift(-1.8):
        with obj("plasma-globe"):
            gx, gy = pj(6.3, 6.6, 0.4)
            R(gx - 4, gy + 5, gx + 4, gy + 8, "INK")
            L(gx - 3, gy + 5, gx + 3, gy + 5, "SLATE_0")
            circ(gx, gy, 7, "INK")
            circ(gx, gy, 6, "NAVY!")
            with channel("globe"):
                ro = 0.55 * af("globe")
                for a in (0.3, 1.7, 2.9, 4.4, 5.5):
                    L(gx, gy, gx + math.cos(a + ro) * 6, gy + math.sin(a + ro) * 6, "VIOLET!")
                P(gx + math.cos(1.7 + ro) * 6, gy + math.sin(1.7 + ro) * 6, "PLUM_3!")
                P(gx + math.cos(4.4 + ro) * 6, gy + math.sin(4.4 + ro) * 6, "PLUM_3!")
                circ(gx, gy, 1, "CREAM!")
                P(gx - 3, gy - 4, "CREAM")
                light(gx, gy, 30, 26, 0.6)
                tint(gx, gy, 32, 28, "violet", (1.0, 0.8, 1.2)[af("globe")])
    with xshift(-1.8):
        with obj("bed-rug"):
            q = [pj(2.0, 0, 0.15), pj(10.6, 0, 0.15), pj(10.6, 0, 4.4), pj(2.0, 0, 4.4)]
            POLY(q, "PLUM_1", "INK")
            q2 = [pj(2.4, 0, 0.4), pj(10.3, 0, 0.4), pj(10.3, 0, 4.1), pj(2.4, 0, 4.1)]
            PL(q2 + [q2[0]], "CREAM")
            q3 = [pj(2.8, 0, 0.7), pj(9.9, 0, 0.7), pj(9.9, 0, 3.8), pj(2.8, 0, 3.8)]
            PL(q3 + [q3[0]], "PLUM_2")
            for k in range(9):
                c = pj(3.4 + k * 0.78, 0, 4.0)
                ss = sc(4.0) * 0.18
                POLY([(c[0], c[1] - ss * 0.6), (c[0] + ss * 1.4, c[1]), (c[0], c[1] + ss * 0.6), (c[0] - ss * 1.4, c[1])], "TERRA_1")
            a_, b_ = pj(2.0, 0, 4.4), pj(10.6, 0, 4.4)
            for x in range(int(a_[0]) + 1, int(b_[0]), 3):
                P(x, a_[1] + 1, "CREAM")
    with xshift(-1.8):
        with obj("headboard"):
            lbox(10.6, 11.0, 0, 3.6, 0, 3.7, "OAK_1", side="OAK_0", top="OAK_2")
            for z in (0.6, 1.4, 2.2, 3.0):
                a_, b_ = pj(10.6, 3.3, z), pj(10.6, 1.4, z)
                L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
    with xshift(-1.8):
        with obj("bed"):
            X0, X1 = 4.0, 10.6
            lbox(X0, X1, 0, 0.9, 0.0, 3.7, "OAK_1", side="OAK_0", top="OAK_2")
            a_, b_ = pj(X0 + 0.3, 0.5, 3.71), pj(X1 - 0.3, 0.5, 3.71)
            L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
            # mattress
            lbox(X0 + 0.05, X1 - 0.05, 0.8, 1.7, 0.1, 3.6, "CREAM", side="SLATE_2", top="CREAM")
            # pillows at the head (right)
            for k, (zz, c) in enumerate(((0.35, "SLATE_2"), (1.9, "CREAM"))):
                a_, b_ = pj(X1 - 1.6, 2.6, zz + 1.5), pj(X1 - 0.2, 1.7, zz + 1.5)
                ELL(a_[0], a_[1], b_[0], b_[1] + 2, c, "INK")
                L(a_[0] + 3, a_[1] + 1, b_[0] - 3, a_[1] + 1, "CREAM")
            # lilac quilt over the top and draped down the front, folded back at the pillows
            qt = [pj(X0 + 0.05, 1.78, 0.1), pj(X1 - 1.8, 1.78, 0.1), pj(X1 - 1.8, 1.78, 3.62), pj(X0 + 0.05, 1.78, 3.62)]
            POLY(qt, "VIOLET", "INK")
            a_, b_ = pj(X0 + 0.05, 1.78, 3.62), pj(X1 - 1.8, 0.75, 3.75)
            R(a_[0], a_[1], b_[0], b_[1], "VIOLET")
            L(a_[0], a_[1] + 1, b_[0], a_[1] + 1, "PLUM_3")
            L(a_[0], b_[1] - 1, b_[0], b_[1] - 1, "PLUM_1")
            L(a_[0], b_[1], b_[0], b_[1], "INK")
            L(a_[0], a_[1], a_[0], b_[1], "INK")
            L(b_[0], a_[1], b_[0], b_[1], "INK")
            for k in range(1, 9):        # quilt squares: stitches on the drape and the top
                x = a_[0] + (b_[0] - a_[0]) * k / 9
                L(x, a_[1] + 2, x, b_[1] - 2, "PLUM_2" if k % 2 else "VIOLET")
                tq = pj(X0 + (X1 - 1.8 - X0) * k / 9, 1.78, 2.0)
                P(tq[0], tq[1], "PLUM_3")
            fb = [pj(X1 - 1.8, 1.82, 0.1), pj(X1 - 1.3, 1.82, 0.1), pj(X1 - 1.3, 1.82, 3.62), pj(X1 - 1.8, 1.82, 3.62)]
            POLY(fb, "CREAM", "INK")    # sheet folded back
            # folded slate throw across the foot
            ft = [pj(X0 + 0.3, 1.86, 0.2), pj(X0 + 1.5, 1.86, 0.2), pj(X0 + 1.5, 1.86, 3.66), pj(X0 + 0.3, 1.86, 3.66)]
            POLY(ft, "SLATE_1", "INK")
            a_, b_ = pj(X0 + 0.3, 1.86, 3.66), pj(X0 + 1.5, 1.0, 3.8)
            R(a_[0], a_[1], b_[0], b_[1], "SLATE_0")
            L(a_[0], a_[1], b_[0], a_[1], "SLATE_2")
            PL([(a_[0], a_[1]), (a_[0], b_[1]), (b_[0], b_[1]), (b_[0], a_[1])], "INK")
            shadow_fp(X0, X1, 0, 3.7)
    with xshift(-0.2):
        with obj("nightstand"):
            lbox(9.6, 10.9, 0, 2.0, 0.05, 1.4, "OAK_1", side="OAK_0", top="OAK_2")
            a_, b_ = pj(9.75, 1.3, 1.41), pj(10.75, 1.3, 1.41)
            L(a_[0], a_[1], b_[0], b_[1], "OAK_DK")
            m_ = pj(10.25, 1.6, 1.41)
            R(m_[0] - 1, m_[1], m_[0] + 1, m_[1], "GOLD")
            pass
    with xshift(-0.2):
        with obj("alarm-clock"):
            cx_, cy_ = pj(10.0, 2.0, 0.8)
            BOX(cx_ - 6, cy_ - 7, cx_ + 5, cy_, "CRT_0", hi="CRT_1", sh="TERRA_0")
            R(cx_ - 4, cy_ - 5, cx_ + 3, cy_ - 2, "INK")
            for dx in (-3, -1, 1, 2):
                P(cx_ + dx, cy_ - 4, "CRT_1!")
            P(cx_ - 1, cy_ - 3, "CRT_1!")
            P(cx_ - 6, cy_ - 8, "GOLD")
            P(cx_ + 5, cy_ - 8, "GOLD")
            light(cx_, cy_ - 4, 12, 10, 0.25)
    with xshift(-0.2):
        with obj("star-jar"):
            jx, jy = pj(10.55, 2.0, 0.5)
            BOX(jx - 3, jy - 8, jx + 3, jy, "SLATE_1", hi="SLATE_2")
            R(jx - 3, jy - 9, jx + 3, jy - 9, "OAK_2")
            for dx, dy, c in ((-1, -2, "GOLD"), (0, -5, "PLUM_3"), (1, -1, "SUN"), (0, -3, "CREAM"), (-1, -6, "GOLD")):
                P(jx + dx, jy + dy, c)
    with xshift(-2.2):
        with obj("corkboard-kitchen"):
            x0, y0 = pji(1.5, 8.9, 0)
            x1, y1 = pji(3.8, 6.8, 0)
            BOX(x0, y0, x1, y1, "OAK_1", hi="OAK_2")
            R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "OAK_2")
            notes = ((0.08, 0.12, "CREAM", 7, 6), (0.40, 0.10, "SLATE_2", 8, 7), (0.72, 0.15, "PLUM_3", 6, 8),
                     (0.12, 0.55, "GOLD", 9, 6), (0.45, 0.52, "CREAM", 6, 9), (0.70, 0.60, "TERRA_2", 8, 6),
                     (0.25, 0.30, "LEAF_3", 6, 5), (0.58, 0.32, "SLATE_2", 7, 6))
            for u, v, c, w_, h_ in notes[:(3, 6, 8)[stg("kitchen.door")]]:
                nx, ny = x0 + 3 + u * (x1 - x0 - 6), y0 + 3 + v * (y1 - y0 - 6)
                R(nx, ny, nx + w_, ny + h_, c)
                L(nx + 1, ny + 2, nx + w_ - 2, ny + 2, "SLATE_0" if c == "CREAM" else "INK")
                P(nx + w_ // 2, ny, "CRT_1")
    with xshift(-2.2):
        with obj("relic-mount-L"):
            lbox(-0.6, 0.6, 7.6, 7.85, 0, 0.7, "OAK_1", side="OAK_0", top="OAK_2")
            a_ = pj(0, 7.85, 0.35)
            L(a_[0] - 3, a_[1] + 2, a_[0] - 1, a_[1] + 7, "INK")
            L(a_[0] + 3, a_[1] + 2, a_[0] + 1, a_[1] + 7, "INK")
            x, y = pj(0, 8.5, 0.35)
            relic_slot("kitchen.relic", x, y)
        FX0, FX1 = 1.4, 3.8
    with xshift(-2.2):
        with obj("fridge"):
            f = lbox(FX0, FX1, 0, 6.3, 0, 2.5, "SLATE_1", side="SLATE_0", top="SLATE_2")
            (ax, ay), (bx, by), _, (dx, dy) = f["front"]
            L(ax + 1, ay + 1, bx - 1, ay + 1, "SLATE_2")
            L(ax + 1, ay + 1, ax + 1, dy - 1, "SLATE_2")
            yd = ay + (dy - ay) * 0.34
            L(ax + 1, yd, bx - 1, yd, "INK")
            R(ax + 1, dy - 5, bx - 1, dy - 1, "INK")
            R(bx - 6, ay + 6, bx - 5, yd - 5, "CREAM")
            R(bx - 6, yd + 4, bx - 5, yd + 26, "CREAM")
            for (u, v, c) in ((0.25, 0.5, "CRT_1"), (0.4, 0.58, "GOLD"), (0.3, 0.7, "LEAF_3"), (0.55, 0.45, "CREAM")):
                R(ax + (bx - ax) * u, ay + (dy - ay) * v, ax + (bx - ax) * u + 1, ay + (dy - ay) * v + 1, c)
            # a photo and a takeout menu on the door
            R(ax + 8, ay + (dy - ay) * 0.6, ax + 15, ay + (dy - ay) * 0.6 + 8, "CREAM")
            R(ax + 9, ay + (dy - ay) * 0.6 + 1, ax + 14, ay + (dy - ay) * 0.6 + 5, "SLATE_1")
            shadow_fp(FX0, FX1, 0, 2.5)
    with xshift(-2.2):
        with obj("switch-panel"):
            x0, y0 = pji(-4.3, 4.4, 0)
            x1, y1 = pji(-3.8, 3.4, 0)
            BOX(x0, y0, x1, y1, "CREAM", hi="CREAM", sh="SLATE_2")
            P((x0 + x1) // 2, y0 + 4, "SLATE_1")
            P((x0 + x1) // 2, y0 + 10, "SLATE_1")
    with xshift(-2.2):
        with obj("backsplash"):
            x0, y0 = pji(-3.4, 4.6, 0)
            x1, y1 = pji(1.25, 2.95, 0)
            R(x0, y0, x1, y1, "SLATE_2")
            for yy in range(y0, y1, 5):
                L(x0, yy, x1, yy, "SLATE_1")
                for xx in range(x0 + (yy // 5 % 2) * 4, x1, 8):
                    L(xx, yy, xx, min(y1, yy + 4), "SLATE_1")
            L(x0, y0, x1, y0, "OAK_1")
    with xshift(-2.2):
        with obj("kitchen-shelf"):
            lbox(-3.0, 0.6, 5.7, 5.95, 0, 0.9, "OAK_2", side="OAK_1", top="OAK_2")
            for i, (X, c) in enumerate(((-2.6, "SLATE_2"), (-2.0, "GOLD"), (-1.4, "CREAM"), (-0.8, "TERRA_2"))):
                x, y = pj(X, 5.95, 0.45)
                BOX(x - 3, y - 8, x + 3, y, c, hi="CREAM")
                R(x - 3, y - 9, x + 3, y - 9, "OAK_1")
            x, y = pj(0.1, 5.95, 0.45)
            pot(x - 4, y - 5, x + 4, y, "TERRA_1")
            bush(x, y - 8, 5, 3, rng, n=16)
            for i in range(3):
                vine(int(x) - 3 + i * 3, int(y) + 1, rng.randint(8, 16), rng, sw=swv(i + 2))
    with xshift(-2.2):
        with obj("cabinet-light", mat={"default": "metal_brushed", "SUN": "bulb", "CREAM": "bulb"}):
            # warm under-shelf light strip over the counter: the left view's own lamp
            a_, b_ = pj(-2.9, 5.62, 0.75), pj(0.5, 5.62, 0.75)
            L(a_[0], a_[1], b_[0], b_[1], "INK")
            L(a_[0] + 2, a_[1] + 1, b_[0] - 2, b_[1] + 1, "SUN!")
            P(a_[0] + 2, a_[1] + 1, "CREAM!")
            light((a_[0] + b_[0]) / 2, a_[1] + 22, 70, 40, 0.9)
    with xshift(-2.2):
        with obj("counter"):
            CX0, CX1 = -3.4, 1.25
            f = lbox(CX0, CX1, 0, 2.95, 0, 2.2, "OAK_1", side="OAK_0", top="OAK_2")
            (ax, ay), (bx, by), _, (dx, dy) = f["front"]
            for k in range(4):
                xa = ax + 3 + k * (bx - ax - 4) / 4
                xb = xa + (bx - ax - 4) / 4 - 3
                POLY([(xa, ay + 6), (xb, ay + 6), (xb, dy - 6), (xa, dy - 6)], "OAK_0", "OAK_DK")
                P(xb - 2 if k % 2 == 0 else xa + 2, ay + 10, "GOLD")
            R(ax + 1, dy - 4, bx - 1, dy - 1, "INK")
            R(ax - 1, ay - 2, bx + 1, ay, "AMBER")      # butcher-block lip
            L(ax - 1, ay - 2, bx + 1, ay - 2, "SUN")
            L(ax - 1, ay + 1, bx + 1, ay + 1, "INK")
            shadow_fp(CX0, CX1, 0, 2.2)
    with xshift(-2.2):
        with obj("kettle"):
            x, y = pj(0.6, 2.95, 1.0)
            ELL(x - 6, y - 10, x + 6, y, "SLATE_1", "INK")
            L(x - 3, y - 9, x + 2, y - 9, "SLATE_2")
            L(x + 6, y - 7, x + 9, y - 10, "INK")
            R(x - 2, y - 12, x + 2, y - 11, "INK")
            R(x - 7, y - 1, x + 7, y, "INK")             # base
            with channel("kettle"):
                on = af("kettle") % 2 == 0
                P(x + 5, y - 1, "CRT_1!" if on else "TERRA_0")
                for k in range(3):                         # steam curl
                    sx = x + 9 + ((af("kettle") + k) % 3) - 1
                    P(sx, y - 12 - k * 3, "CREAM" if k < 2 else "SLATE_2")
                light(x + 5, y - 1, 10, 8, 0.25)
    with xshift(-2.2):
        with obj("water-jug"):
            x, y = pj(-0.5, 2.95, 1.0)
            BOX(x - 4, y - 15, x + 4, y, "SLATE_2", hi="CREAM")
            lvl = (0, 3, 7, 11)[grow("kitchen.water")]
            if lvl:
                R(x - 3, y - lvl - 1, x + 3, y - 1, "SLATE_1")
                L(x - 3, y - lvl - 1, x + 3, y - lvl - 1, "SLATE_2")
            R(x - 2, y - 17, x + 2, y - 16, "SLATE_0")
    with xshift(-2.2):
        with obj("fruit-basket"):
            x, y = pj(-1.6, 2.95, 1.1)
            POLY([(x - 10, y - 6), (x + 10, y - 6), (x + 7, y), (x - 7, y)], "OAK_2", "INK")
            L(x - 9, y - 3, x + 9, y - 3, "OAK_1")
            fr = ((-6, "CRT_1"), (-2, "LEAF_3"), (2, "GLOW"), (6, "CRT_0"), (0, "SUN"))
            n = (2, 5, 5)[stg("kitchen.food")]
            for dx, c in fr[:n]:
                circ(x + dx, y - 8 if dx != 0 else y - 11, 3, c)
            if n == 5:
                P(x - 1, y - 14, "LEAF_2")
            if stg("kitchen.food") == 2:
                circ(x - 4, y - 13, 2, "PLUM_2")
                circ(x + 4, y - 13, 2, "LEAF_3")
    with xshift(-2.2):
        with obj("envelope"):
            x, y = pj(-2.7, 2.96, 1.3)
            POLY([(x - 7, y - 4), (x + 7, y - 4), (x + 6, y), (x - 8, y)], "CREAM", "INK")
            L(x - 7, y - 4, x, y - 1, "SLATE_2")
            L(x, y - 1, x + 7, y - 4, "SLATE_2")
            if vk("kitchen.doormat") == "alert":
                POLY([(x - 7, y - 4), (x + 7, y - 4), (x, y - 9)], "CREAM", "INK")
                R(x - 1, y - 5, x + 1, y - 4, "CRT_1")
            else:
                R(x - 1, y - 2, x, y - 2, "CRT_0")
    with xshift(-2.2):
        with obj("kitchen-stool"):
            x, yf = pj(-0.6, 0, 3.4)
            _, ys = pj(-0.6, 2.2, 3.4)
            ELL(x - 8, ys - 3, x + 8, ys + 2, "OAK_1", "INK")
            L(x - 6, ys - 2, x + 6, ys - 2, "OAK_2")
            for dx in (-6, -2, 2, 6):
                L(x + dx * 0.9, ys + 2, x + dx * 1.15, yf, "OAK_0")
            L(x - 6, (ys + yf) // 2 + 3, x + 6, (ys + yf) // 2 + 3, "OAK_DK")
            shadow_ell(x, yf, 9, 2, k=1.0)
    with xshift(-2.2):
        with obj("gut-plant"):
            px, py = pj(-2.8, 0, 3.9)
            pot(px - 9, py - 13, px + 9, py, "TERRA_1")
            L(px - 8, py - 10, px + 8, py - 10, "TERRA_0")
            gs = stg("kitchen.gut")
            for i in range(13):
                if gs == 0 and i % 2:
                    continue
                a = -math.pi / 2 + (i - 6) * 0.24 + 0.08 * math.sin(i * 2.3) + 0.05 * swv(i)
                ln = (22 + 12 * abs(math.cos(i * 1.3))) * (0.6, 1.0, 1.18)[gs]
                big_leaf(px + (i - 6) * 0.7, py - 12, a, ln, 7 + (i % 3),
                         "LEAF_1" if i % 3 == 0 else "LEAF_2", "LEAF_0", "LEAF_0", hi="LEAF_3")
            shadow_ell(px, py, 13, 3)
    with xshift(-2.2):
        with obj("wall-clock"):
            x, y = pj(-4.6, 8.3, 0)
            circ(x, y, 7, "INK")
            circ(x, y, 6, "CREAM")
            L(x, y, x, y - 4, "INK")
            L(x, y, x + 3, y + 1, "INK")
            P(x, y - 5, "CRT_0")
    with xshift(-2.6):
        with obj("door"):
            x0, y0 = pji(-8.4, 7.1, 0)
            x1, y1 = pji(-5.2, 0, 0)
            R(x0 - 3, y0 - 3, x1 + 3, y1, "OAK_DK")
            L(x0 - 3, y0 - 3, x1 + 3, y0 - 3, "INK")
            R(x0, y0, x1, y1, "OAK_1")
            for (ya, yb) in ((y0 + 6, y0 + (y1 - y0) * 0.45), (y0 + (y1 - y0) * 0.52, y1 - 8)):
                R(x0 + 6, ya, x1 - 6, yb, "OAK_0")
                L(x0 + 6, ya, x1 - 6, ya, "OAK_DK")
                L(x0 + 6, ya, x0 + 6, yb, "OAK_DK")
            circ(x1 - 7, y0 + (y1 - y0) * 0.5, 2, "GOLD")
            P(x1 - 8, y0 + (y1 - y0) * 0.5 - 1, "SUN")
            R((x0 + x1) // 2 - 1, y0 + 14, (x0 + x1) // 2 + 1, y0 + 15, "GOLD_DK")   # peephole
            L(x0, y1 - 1, x1, y1 - 1, "INK")
    with xshift(-2.6):
        with obj("coat-hooks"):
            x0, y0 = pji(-10.6, 6.2, 0)
            x1, _ = pji(-9.0, 6.2, 0)
            R(x0, y0, x1, y0 + 3, "OAK_1")
            L(x0, y0 + 3, x1, y0 + 3, "INK")
            for k, xx in enumerate(range(x0 + 4, x1 - 2, 10)):
                P(xx, y0 + 4, "GOLD")
                P(xx, y0 + 5, "GOLD")
            # a jacket and a tote on the hooks
            jx = x0 + 6
            POLY([(jx - 6, y0 + 6), (jx + 6, y0 + 6), (jx + 9, y0 + 38), (jx - 9, y0 + 38)], "SLATE_0", "INK")
            L(jx, y0 + 7, jx, y0 + 36, "INK")
            R(jx - 7, y0 + 24, jx - 4, y0 + 26, "SLATE_1")
            tx = x1 - 8
            R(tx - 6, y0 + 16, tx + 6, y0 + 30, "CREAM")
            L(tx - 6, y0 + 16, tx + 6, y0 + 16, "INK")
            L(tx - 4, y0 + 6, tx - 2, y0 + 16, "OAK_2")
            L(tx + 4, y0 + 6, tx + 2, y0 + 16, "OAK_2")
            PL([(tx - 6, y0 + 16), (tx - 6, y0 + 30), (tx + 6, y0 + 30), (tx + 6, y0 + 16)], "INK")
    with xshift(-2.6):
        with obj("doormat"):
            q = [pj(-8.6, 0, 0.3), pj(-5.0, 0, 0.3), pj(-5.0, 0, 2.2), pj(-8.6, 0, 2.2)]
            POLY(q, "OAK_0", "INK")
            q2 = [pj(-8.2, 0, 0.6), pj(-5.4, 0, 0.6), pj(-5.4, 0, 1.9), pj(-8.2, 0, 1.9)]
            PL(q2 + [q2[0]], "AMBER")
    with xshift(-2.6):
        with obj("shoes-entry"):
            for k, (X, z, c) in enumerate(((-9.4, 1.0, "SLATE_1"), (-9.0, 1.6, "CRT_0"))):
                x, y = pj(X, 0, z)
                POLY([(x - 7, y), (x + 6, y), (x + 6, y - 3), (x, y - 5), (x - 7, y - 4)], c, "INK")
                L(x - 7, y - 1, x + 6, y - 1, "CREAM")


# ================================================================ right wall: the two desks and the gym (right view)
@scene("right")
def scene_right():
    rng = random.Random(171)
    # --- the study desk (the first of the two desks), its corkboard and calendar on the wall above
    SX0, SX1 = -11.6, -7.8
    with obj("schedule-board"):  # Academics corkboard
        x0, y0 = pji(SX0 + 0.3, 7.6, 0)
        x1, y1 = pji(SX0 + 2.5, 5.2, 0)
        BOX(x0, y0, x1, y1, "OAK_1", hi="OAK_2")
        R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "OAK_2")
        ss = stg("study.academics")
        cw, ch = (x1 - x0 - 8) // 5, (y1 - y0 - 8) // 4
        for i in range(5):
            for j in range(4):
                c = "CREAM" if (i + j) % 3 else ("SLATE_2", "PLUM_3", "GOLD", "LEAF_3")[(i * 3 + j) % 4]
                if ss == 0 and i >= 2:
                    continue
                if ss == 2 and (i + j) % 3 == 0:
                    c = "GOLD"
                R(x0 + 4 + i * cw, y0 + 4 + j * ch, x0 + 4 + i * cw + cw - 3, y0 + 4 + j * ch + ch - 3, c)
                P(x0 + 4 + i * cw + cw // 2 - 1, y0 + 4 + j * ch, "CRT_1")
        if vk("study.academics") == "alert":
            R(x1 - 12, y1 - 13, x1 - 3, y1 - 4, "CRT_0")
            L(x1 - 10, y1 - 10, x1 - 5, y1 - 10, "CREAM")
            L(x1 - 10, y1 - 8, x1 - 6, y1 - 8, "CREAM")
    with obj("calendar"):  # the wall calendar (opens the calendar wall)
        x0, y0 = pji(SX0 + 2.8, 7.8, 0)
        x1, y1 = pji(SX0 + 4.0, 5.3, 0)
        BOX(x0, y0, x1, y1, "PAPER" if "PAPER" in N else "CREAM", hi="CREAM", sh="PAPER_DK" if "PAPER_DK" in N else "SLATE_2")
        R(x0 + 1, y0 + 1, x1 - 1, y0 + 7, "CRT_0")
        P(x0 + 5, y0 - 1, "INK")
        P(x1 - 5, y0 - 1, "INK")
        cs = stg("study.time")
        cw = (x1 - x0 - 4) // 5
        for i in range(5):
            for j in range(5):
                if cs == 0 and j > 1:
                    continue
                c = "SLATE_1" if (i + j) % 2 else "TERRA_2"
                R(x0 + 3 + i * cw, y0 + 10 + j * 7, x0 + 3 + i * cw + cw - 2, y0 + 10 + j * 7 + 4, c)
    with obj("desk"):
        f = box3d(SX0, SX1, 0, 2.55, 0, 2.2, "OAK_1", side="OAK_0", top="OAK_2")
        (ax, ay), (bx, by), _, (dx, dy) = f["front"]
        R(bx - 24, ay + 3, bx - 3, dy - 2, "OAK_0")
        for k in range(3):
            yy = ay + 3 + k * (dy - ay - 5) / 3
            L(bx - 24, yy, bx - 3, yy, "OAK_DK")
            R(bx - 15, yy + 4, bx - 12, yy + 4, "GOLD")
        L(ax + 2, ay + 4, bx - 26, ay + 4, "OAK_DK")
        R(ax + 2, ay + 5, ax + 5, dy - 1, "OAK_0")
    with obj("desk-lamp"):  # green banker's lamp, on: the right view's own warm lamp
        bx_, by_ = pj(SX0 + 0.7, 2.55, 0.8)
        R(bx_ - 4, by_ - 1, bx_ + 4, by_, "INK")
        L(bx_, by_ - 1, bx_ + 4, by_ - 13, "GOLD_DK")
        L(bx_ + 4, by_ - 13, bx_ + 10, by_ - 17, "GOLD_DK")
        POLY([(bx_ + 7, by_ - 22), (bx_ + 16, by_ - 16), (bx_ + 13, by_ - 12), (bx_ + 4, by_ - 17)], "LEAF_2", "INK")
        L(bx_ + 6, by_ - 20, bx_ + 13, by_ - 16, "LEAF_3")
        R(bx_ + 10, by_ - 13, bx_ + 12, by_ - 12, "SUN!")
        G.cones.append([(bx_ + 10, by_ - 13), (bx_ + 17, by_ - 12), (bx_ + 34, by_ + 1), (bx_ + 5, by_ + 1)])
        light(bx_ + 16, by_ - 2, 44, 26, 1.0)
    with obj("course-books"):
        x0, y0 = pji(SX0 + 1.6, 2.55, 0.5)
        R(x0, y0 - 12, x0 + 1, y0, "SLATE_0")
        books_row(x0 + 2, x0 + 22, y0, 11, random.Random(5))
        R(x0 + 23, y0 - 12, x0 + 24, y0, "SLATE_0")
    with obj("pen-mug"):
        x, y = pj(SX0 + 3.0, 2.55, 1.0)
        BOX(x - 3, y - 8, x + 3, y, "SLATE_1", hi="SLATE_2")
        for dx, c in ((-1, "CRT_1"), (0, "GOLD"), (1, "SLATE_2")):
            L(x + dx, y - 9, x + dx * 2, y - 13, c)
    with obj("journal"):
        x, y = pj(SX0 + 2.2, 2.56, 1.6)
        POLY([(x - 8, y - 2), (x + 5, y - 4), (x + 8, y), (x - 5, y + 1)], "TERRA_0", "INK")
        L(x - 5, y - 1, x + 5, y - 3, "GOLD")
    with obj("succulent"):
        x, y = pj(SX1 - 0.5, 2.55, 0.6)
        pot(x - 4, y - 5, x + 4, y, "CREAM")
        for dx, dy in ((-3, -7), (0, -9), (3, -7), (-1, -6), (1, -6)):
            P(x + dx, y + dy, "LEAF_3" if dy == -9 else "LEAF_2")
    with obj("desk-chair"):
        X, z = SX0 + 2.0, 3.3
        x, yf = pji(X, 0, z)
        _, sy = pji(X, 1.6, z)
        L(x, sy, x, yf - 3, "INK")
        for dx in (-9, 0, 9):
            L(x, yf - 3, x + dx, yf, "INK")
        R(x - 11, sy - 4, x + 11, sy, "TERRA_0")
        L(x - 11, sy - 4, x + 11, sy - 4, "TERRA_1")
        _, ty = pji(X, 3.4, z)
        BOX(x - 9, ty, x + 9, sy - 4, "TERRA_0", hi="TERRA_1")
        L(x, sy - 4, x, sy - 3, "INK")
    with obj("backpack"):
        x, y = pj(SX1 + 0.3, 0, 1.6)
        POLY([(x - 9, y), (x - 10, y - 18), (x - 6, y - 23), (x + 5, y - 23), (x + 8, y - 17), (x + 8, y)], "SLATE_0", "INK")
        R(x - 6, y - 12, x + 4, y - 4, "SLATE_1")
        L(x - 6, y - 12, x + 4, y - 12, "INK")
        L(x - 4, y - 22, x - 4, y - 14, "TERRA_1")
        P(x + 1, y - 8, "GOLD")
    with obj("plant-study"):
        floor_plant(SX0 - 0.2, 3.2, "snake", 1, h=1.1)
    with xshift(2.0):
        with obj("whiteboard"):
            x0, y0 = pji(-9.3, 8.9, 0)
            x1, y1 = pji(-3.9, 5.0, 0)
            BOX(x0, y0, x1, y1, "SLATE_1", hi="SLATE_2")
            R(x0 + 3, y0 + 3, x1 - 3, y1 - 3, "CREAM")
            R(x0 + 6, y1 - 2, x1 - 6, y1, "SLATE_0")        # marker tray
            for k, c in enumerate(("CRT_0", "LEAF_2", "NAVY")):
                R(x0 + 10 + k * 5, y1 - 3, x0 + 13 + k * 5, y1 - 3, c)
            gx0, gy1 = x0 + 10, y1 - 10
            L(gx0, y0 + 8, gx0, gy1, "INK")
            L(gx0, gy1, gx0 + 52, gy1, "INK")
            pts = [(gx0 + 4 + k * 8, gy1 - 4 - k * 5 - (3 if k % 2 else 0)) for k in range(7)]
            PL(pts, "LEAF_2")
            for x_, y_ in pts:
                P(x_, y_, "INK")
            for k in range(3):     # product columns
                L(x1 - 40, y0 + 10 + k * 7, x1 - 12, y0 + 10 + k * 7, ("CRT_0", "SLATE_0", "LEAF_2")[k])
                R(x1 - 44, y0 + 9 + k * 7, x1 - 42, y0 + 11 + k * 7, ("CRT_0", "SLATE_0", "LEAF_2")[k])
            st_ = ((0.62, 0.55, "GOLD"), (0.75, 0.62, "PLUM_3"), (0.70, 0.78, "LEAF_3"), (0.86, 0.72, "GOLD"),
                   (0.55, 0.75, "SLATE_2"), (0.88, 0.52, "PLUM_3"))
            for u, v, c in st_[:(1, 4, 6)[stg("computer.board")]]:
                nx, ny = x0 + u * (x1 - x0), y0 + v * (y1 - y0)
                R(nx, ny, nx + 6, ny + 6, c)
                L(nx + 1, ny + 2, nx + 4, ny + 2, "OAK_DK")
            P(x0 + 2, y0 + 2, "CRT_1")
    with xshift(2.0):
        with obj("pc-shelf"):
            lbox(-8.7, -4.9, 9.4, 9.65, 0, 0.9, "OAK_2", side="OAK_1", top="OAK_2")
            for X, w, h in ((-8.1, 0.9, 0.9), (-7.0, 0.8, 0.6), (-5.9, 0.7, 0.8)):
                lbox(X - w / 2, X + w / 2, 9.65, 9.65 + h, 0.1, 0.8, "AMBER", side="OAK_2", top="OAK_2")
                a_ = pj(X, 9.65 + h * 0.55, 0.8)
                R(a_[0] - 2, a_[1] - 1, a_[0] + 2, a_[1], "CREAM")
    with xshift(2.0):
        with obj("pc-desk"):
            f = lbox(-9.0, -4.4, 2.3, 2.65, 0, 2.6, "OAK_1", side="OAK_0", top="OAK_2")
            (ax, ay), (bx, by), _, (dx, dy) = lbox(-5.9, -4.5, 0, 2.3, 0.2, 2.5, "OAK_0", side="OAK_DK", top="OAK_1")["front"]
            for k in range(3):
                yy = ay + 2 + k * (dy - ay - 3) / 3
                L(ax + 1, yy, bx - 1, yy, "INK")
                R((ax + bx) / 2 - 2, yy + 3, (ax + bx) / 2 + 2, yy + 3, "GOLD")
            for X in (-8.8,):
                a_, b_ = pj(X, 2.3, 2.45), pj(X, 0, 2.45)
                R(a_[0] - 1, a_[1], a_[0] + 1, b_[1], "OAK_0")
                L(a_[0] - 1, a_[1], a_[0] - 1, b_[1], "INK")
            shadow_fp(-9.0, -4.4, 0, 2.6, k=1.0)
    with xshift(2.0):
        with obj("pc-tower"):
            f = lbox(-8.7, -7.6, 0, 1.8, 0.4, 1.6, "INK", side="BROWN_1", top="SLATE_0")
            (ax, ay), (bx, by), _, (dx, dy) = f["front"]
            for k in range(4):
                L(ax + 2, ay + 4 + k * 3, bx - 2, ay + 4 + k * 3, "BROWN_1")
            P(bx - 3, ay + 2, "LEAF_3!")
    with xshift(2.0):
        with obj("monitors"):  # AI Building
            with channel("terminal"):
                for k, (Xa, Xb) in enumerate(((-8.7, -6.75), (-6.6, -4.65))):
                    x0, y0 = pji(Xa, 5.0, 1.2)
                    x1, y1 = pji(Xb, 3.25, 1.2)
                    BOX(x0, y0, x1, y1, "INK")
                    R(x0 + 2, y0 + 2, x1 - 2, y1 - 3, "LEAF_0!")
                    sc_ = af("terminal") + k * 2
                    for j, yy in enumerate(range(y0 + 4, y1 - 4, 3)):
                        j2 = j + sc_
                        ln = (j2 * 7) % 13 + 4
                        c = "LEAF_3!" if j2 % 3 else ("ENERGY!" if k == 0 else "LEAF_2!")
                        L(x0 + 4 + 2 * (j2 % 2), yy, min(x1 - 4, x0 + 4 + ln), yy, c)
                    if (af("terminal") + k) % 2 == 0:
                        R(x0 + 4, y1 - 6, x0 + 6, y1 - 5, "LEAF_3!")   # cursor
                    st = ((x0 + x1) // 2, y1)
                    R(st[0] - 1, st[1], st[0] + 1, st[1] + 6, "INK")
                    R(st[0] - 6, st[1] + 6, st[0] + 6, st[1] + 7, "INK")
                    if k == 0:
                        G.focus_at = (x0 + 3, y0 - 1)
                mx, my = pj(-6.7, 4.1, 1.2)
                light(mx, my, 44, 34, 0.75)
                tint(mx, my - 4, 40, 34, "green", (1.0, 0.85, 1.15, 0.95)[af("terminal") % 4])
            kx, ky = pj(-6.7, 2.65, 1.9)
            R(kx - 12, ky - 2, kx + 8, ky, "SLATE_0")
            L(kx - 12, ky - 2, kx + 8, ky - 2, "SLATE_1")
            R(kx + 12, ky - 2, kx + 15, ky, "INK")
    with xshift(2.0):
        with obj("focus-note"):
            n = G.focus_at
            R(n[0] - 1, n[1] - 1, n[0] + 4, n[1] + 3, "GOLD")
            L(n[0], n[1] + 1, n[0] + 3, n[1] + 1, "OAK_DK")
    with xshift(2.0):
        with obj("headphones"):   # label printer
            hx, hy = pj(-5.0, 2.65, 2.0)
            BOX(hx - 6, hy - 6, hx + 5, hy, "CREAM", hi="CREAM", sh="SLATE_2")
            R(hx - 4, hy - 4, hx + 3, hy - 4, "INK")
            L(hx + 5, hy - 3, hx + 9, hy, "CREAM")
    with xshift(2.0):
        with obj("pc-chair"):  # black ergonomic mesh chair, seen from behind
            x, yf = pji(-6.7, 0, 3.7)
            _, sy = pji(-6.7, 1.8, 3.7)
            _, ty = pji(-6.7, 3.9, 3.9)
            R(x - 1, sy, x + 1, yf - 5, "SLATE_0")
            L(x - 1, sy, x - 1, yf - 5, "INK")
            for dx in (-12, -6, 0, 6, 12):
                L(x, yf - 5, x + dx, yf - (2 if abs(dx) < 8 else 0), "INK")
                R(x + dx - 1, yf - 1, x + dx + 1, yf, "SLATE_0")
            R(x - 13, sy - 3, x + 13, sy + 1, "INK")                                # seat edge
            L(x - 12, sy - 3, x + 12, sy - 3, "BROWN_1")
            back = [(x - 9, ty + 3), (x - 6, ty), (x + 6, ty), (x + 9, ty + 3), (x + 11, sy - 12), (x + 8, sy - 6), (x - 8, sy - 6), (x - 11, sy - 12)]
            POLY(back, "INK", "INK")
            for yy in range(ty + 2, sy - 7, 2):                                    # mesh weave
                L(x - 8, yy, x + 8, yy, "BROWN_1")
            for xx in range(x - 7, x + 8, 3):
                L(xx, ty + 2, xx, sy - 8, "BROWN_1")
            L(x - 9, ty + 3, x + 9, ty + 3, "SLATE_0")
            R(x - 1, sy - 6, x + 1, sy - 3, "INK")                                 # spine to the seat
            for sdx in (-1, 1):                                                    # armrests
                L(x + sdx * 14, sy - 10, x + sdx * 14, sy - 3, "SLATE_0")
                L(x + sdx * 16, sy - 10, x + sdx * 11, sy - 10, "INK")
            shadow_ell(x, yf, 15, 3, k=1.0)
    with xshift(2.0):
        with obj("ship-boxes"):
            lbox(-4.2, -3.0, 0, 1.3, 0.1, 1.5, "AMBER", side="OAK_2", top="OAK_2")
            lbox(-4.1, -3.2, 1.3, 2.1, 0.3, 1.3, "OAK_2", side="OAK_1", top="AMBER")
            a_ = pj(-3.6, 0.8, 1.5)
            R(a_[0] - 4, a_[1] - 2, a_[0] + 4, a_[1] + 2, "CREAM")
            L(a_[0] - 3, a_[1], a_[0] + 2, a_[1], "INK")
            shadow_fp(-4.2, -3.0, 0.1, 1.5, k=1.0)
    with obj("money-tree"):
        x, y = pj(1.1, 0, 1.4)
        pot(x - 7, y - 10, x + 7, y, "SLATE_1")
        for k in range(18):
            yy = y - 11 - k
            L(x - 1 + (k // 2) % 2, yy, x + (k // 2) % 2, yy, "OAK_1" if k % 2 else "OAK_0")
        lv = ((-5, -27), (6, -27), (0, -38), (-9, -33), (9, -33), (-12, -40), (11, -41))
        for i, (dx, dy) in enumerate(lv[:(2, 3, 5, 7)[grow("computer.money")]]):
            dx += swv(i) if abs(dx) > 7 else 0
            ELL(x + dx - 5, y + dy - 4, x + dx + 5, y + dy + 4, "LEAF_2", "INK")
            P(x + dx, y + dy - 2, "LEAF_3")
        if grow("computer.money") == 3:
            circ(x + 2, y - 46, 1, "GOLD")
        shadow_ell(x, y, 9, 2)
    with xshift(2.5):
        with obj("gym-mat"):
            q = [pj(-2.6, 0, 0.1), pj(7.0, 0, 0.1), pj(7.0, 0, 5.4), pj(-2.6, 0, 5.4)]
            POLY(q, "INK", "VOID")
            for X in (-0.2, 2.2, 4.6):
                PL([pj(X, 0, 0.1), pj(X, 0, 5.4)], "BROWN_1")
            for z in (1.9, 3.7):
                PL([pj(-2.6, 0, z), pj(7.0, 0, z)], "BROWN_1")
    with xshift(2.5):
        with obj("gym-timer"):
            x0, y0 = pji(-1.6, 9.9, 0)
            x1, y1 = pji(1.2, 9.0, 0)
            BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
            with channel("timer"):
                digits = ("0:45", "0:44", "0:43", "0:42")[af("timer")]
                seg7(x0 + 4, y0 + 3, digits, y1 - y0 - 6)
                dw = (x1 - x0 - 10) // 4
                mx = x0 + 4 + 2 * dw
                P(mx, y0 + 5, "CRT_0!" if af("timer") % 2 == 0 else "TERRA_0")
                P(mx, y1 - 5, "CRT_0!" if af("timer") % 2 == 0 else "TERRA_0")
                light((x0 + x1) / 2, (y0 + y1) / 2, 22, 14, 0.35)
                tint((x0 + x1) / 2, (y0 + y1) / 2, 24, 16, "red", (0.6, 0.45, 0.7, 0.5)[af("timer")])
    with xshift(2.5):
        with obj("race-photos"):
            for k, (X0, X1, Y0, Y1) in enumerate(((2.0, 3.6, 8.4, 7.0), (3.9, 5.2, 8.6, 7.5), (5.5, 6.6, 8.2, 6.9))):
                x0, y0 = pji(X0, Y0, 0)
                x1, y1 = pji(X1, Y1, 0)
                BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
                R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, ("SLATE_1", "TERRA_2", "SLATE_2")[k])
                R(x0 + 2, y1 - 6, x1 - 2, y1 - 2, ("LEAF_2", "OAK_1", "SLATE_0")[k])      # ground / track / water
                fx = (x0 + x1) // 2 + (k - 1) * 3                                          # a tiny runner figure
                P(fx, y1 - 11, "INK"); L(fx, y1 - 10, fx, y1 - 8, "INK")
                P(fx - 1, y1 - 7, "INK"); P(fx + 1, y1 - 7, "INK")
                if k == 1:
                    L(x0 + 2, y1 - 9, x1 - 2, y1 - 9, "CREAM")   # finish tape
    with xshift(2.5):
        with obj("medal-wall"):
            x0, y0 = pji(2.2, 6.5, 0)
            x1, _ = pji(6.2, 6.5, 0)
            R(x0, y0, x1, y0 + 2, "OAK_2")
            L(x0, y0 + 2, x1, y0 + 2, "INK")
            R(x0 - 2, y0 - 1, x0, y0 + 3, "GOLD_DK")
            R(x1, y0 - 1, x1 + 2, y0 + 3, "GOLD_DK")
            med = ("GOLD", "SLATE_2", "AMBER", "GOLD", "CREAM", "GOLD", "SLATE_2")
            n = (1, 3, 5, 7)[grow("gym.medals")]
            for k in range(n):
                mx = x0 + 6 + k * (x1 - x0 - 12) / 6
                L(mx - 2, y0 + 3, mx, y0 + 12, ("CRT_0", "NAVY", "LEAF_2")[k % 3])
                L(mx + 2, y0 + 3, mx, y0 + 12, ("SLATE_1", "CREAM", "GOLD")[k % 3])
                circ(mx, y0 + 15, 3, "INK")
                circ(mx, y0 + 15, 2, med[k])
                P(mx - 1, y0 + 14, "CREAM")
            # race bib pinned below
            bx0, by0 = pji(-0.2, 8.3, 0)
            bx1, by1 = pji(1.0, 7.4, 0)
            BOX(bx0, by0, bx1, by1, "CREAM", hi="CREAM", sh="SLATE_2")
            R(bx0 + 3, by0 + 4, bx1 - 3, by0 + 7, "CRT_0")
            P(bx0 + 1, by0 + 1, "INK"); P(bx1 - 1, by0 + 1, "INK")
    with xshift(2.5):
        with obj("symbol-poster"):     # no words: a laurel around a rising sun over three peaks
            x0, y0 = pji(7.0, 9.0, 0)
            x1, y1 = pji(9.0, 5.6, 0)
            BOX(x0, y0, x1, y1, "INK", hi="BROWN_1")
            R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "TERRA_0")
            cx_, cy_ = (x0 + x1) // 2, (y0 + y1) // 2
            circ(cx_, cy_ + 2, 9, "GOLD")
            circ(cx_, cy_ + 2, 7, "TERRA_0")
            circ(cx_, cy_ + 2, 4, "SUN")
            POLY([(cx_ - 12, cy_ + 13), (cx_ - 4, cy_ + 3), (cx_, cy_ + 8), (cx_ + 5, cy_ + 1), (cx_ + 12, cy_ + 13)], "INK")
            for k in range(5):
                P(cx_ - 13 + k, cy_ - 6 + k * 3, "LEAF_3")
                P(cx_ + 13 - k, cy_ - 6 + k * 3, "LEAF_3")
    with xshift(2.5):
        with obj("relic-bracket-R"):
            lbox(9.4, 10.3, 6.6, 6.85, 0, 0.7, "OAK_1", side="OAK_0", top="OAK_2")
            a_ = pj(9.85, 6.6, 0.05)
            L(a_[0], a_[1] + 6, a_[0] + 4, a_[1], "INK")
            x, y = pj(9.85, 7.3, 0.35)
            relic_slot("gym.relic", x, y, 1)
    with xshift(2.5):
        with obj("weight-rack"):  # Strength: a power rack, plates on the pegs, dumbbells below
            RX0, RX1 = -2.2, 1.2
            for X in (RX0, RX1):
                for z in (0.3, 2.3):
                    a_, b_ = pj(X, 0, z), pj(X, 7.0, z)
                    R(a_[0] - 1, b_[1], a_[0] + 1, a_[1], "SLATE_0" if z > 1 else "INK")
                    L(a_[0] - 1, b_[1], a_[0] - 1, a_[1], "INK")
                    for Y in np.arange(2.0, 6.6, 0.5):
                        p_ = pj(X, Y, z)
                        P(p_[0], p_[1], "SLATE_1")
            for Y in (7.0,):
                PL([pj(RX0, Y, 2.3), pj(RX1, Y, 2.3)], "SLATE_0")
                PL([pj(RX0, Y, 0.3), pj(RX1, Y, 0.3)], "INK")
            # barbell racked on the J-hooks
            a_, b_ = pj(RX0 - 0.9, 4.6, 2.3), pj(RX1 + 0.9, 4.6, 2.3)
            L(a_[0], a_[1], b_[0], b_[1], "SLATE_2")
            L(a_[0], a_[1] + 1, b_[0], b_[1] + 1, "SLATE_0")
            plates = (((5, "SLATE_0"),), ((9, "BROWN_1"), (7, "SLATE_0")), ((11, "INK"), (9, "CRT_0"), (6, "GOLD_DK")))[stg("gym.strength")]
            for t in (a_, b_):
                for k, (r_, c) in enumerate(plates):
                    ox = (k * 2 + 1) * (1 if t is b_ else -1)
                    R(t[0] + ox - 1, t[1] - r_, t[0] + ox + 1, t[1] + r_, "INK")
                    R(t[0] + ox, t[1] - r_ + 1, t[0] + ox, t[1] + r_ - 1, c)
            # plate storage pegs + dumbbell row on the floor
            for k, (r_, c) in enumerate(((9, "INK"), (7, "CRT_0"), (5, "SLATE_0"))):
                cx_, cy_ = pj(-0.5 + k * 0.9, 0.9, 0.6)
                circ(cx_, cy_ - r_ + 9, r_, "INK")
                circ(cx_, cy_ - r_ + 9, r_ - 1, c)
                circ(cx_, cy_ - r_ + 9, 1, "SLATE_1")
            shadow_fp(RX0, RX1, 0.3, 2.3)
    with xshift(2.5):
        with obj("kettlebells"):
            for k, (X, r_, c) in enumerate(((1.9, 5, "INK"), (2.6, 4, "CRT_0"), (3.2, 3, "LEAF_1"))):
                x, y = pj(X, 0, 1.4)
                circ(x, y - r_, r_, "INK")
                circ(x, y - r_, r_ - 1, c)
                ring(x, y - 2 * r_ - 2, 2, "INK")
                P(x - r_ + 2, y - r_ - 2, "SLATE_1")
                shadow_ell(x, y, r_ + 2, 1, k=1.0)
    with xshift(2.5):
        with obj("chalk"):
            x, y = pj(1.6, 0, 3.2)
            BOX(x - 5, y - 9, x + 5, y, "SLATE_2", hi="CREAM")
            R(x - 4, y - 10, x + 4, y - 9, "CREAM")
            P(x - 2, y - 11, "CREAM"); P(x + 1, y - 12, "CREAM")
            shadow_ell(x, y, 6, 2, k=1.0)
    with xshift(2.5):
        with obj("shoe-shelf"):     # Running: a sneaker shelf, three pairs
            f = lbox(3.5, 5.9, 0, 2.6, 0, 1.1, "OAK_1", side="OAK_0", top="OAK_2")
            (ax, ay), (bx, by), _, (dx, dy) = f["front"]
            for k, yb in enumerate((ay + (dy - ay) * 0.5, dy - 2)):
                L(ax + 1, yb, bx - 1, yb, "OAK_DK")
            for k, (u, row, c) in enumerate(((0.2, 0, "CRT_1"), (0.62, 0, "SLATE_2"), (0.35, 1, "LEAF_3"))):
                x = ax + (bx - ax) * u
                y = (ay + (dy - ay) * 0.5) if row == 0 else dy - 2
                for j in (0, 9):
                    POLY([(x + j - 4, y - 1), (x + j + 5, y - 1), (x + j + 5, y - 4), (x + j, y - 7), (x + j - 4, y - 6)], c, "INK")
                    L(x + j - 4, y - 2, x + j + 5, y - 2, "CREAM")
            shadow_fp(3.5, 5.9, 0, 1.1)
    with xshift(2.5):
        with obj("gym-bag"):
            x, y = pj(4.6, 0, 2.7)
            POLY([(x - 12, y), (x - 13, y - 9), (x - 10, y - 12), (x + 10, y - 12), (x + 13, y - 9), (x + 12, y)], "NAVY", "INK")
            L(x - 10, y - 11, x + 10, y - 11, "SLATE_0")
            PL([(x - 6, y - 12), (x - 3, y - 17), (x + 3, y - 17), (x + 6, y - 12)], "INK")
            R(x - 3, y - 7, x + 3, y - 5, "CRT_0")
            shadow_ell(x, y, 13, 2, k=1.0)
    with xshift(2.0):
        with obj("bike"):  # Triathlon: side profile against the wall, tarp half draped (awake: tarp off)
            R_ = 1.15
            zb = 0.9
            wf, wr = pj(8.9, R_, zb), pj(6.5, R_, zb)
            rr = R_ * sc(zb)
            for (cx_, cy_) in (wf, wr):
                circ(cx_, cy_, rr, "INK")
                circ(cx_, cy_, rr - 2, "BROWN_1")
                circ(cx_, cy_, rr - 3, "PLASTER")
                for k in range(6):
                    a = k * math.pi / 3
                    L(cx_, cy_, cx_ + math.cos(a) * (rr - 3), cy_ + math.sin(a) * (rr - 3), "SLATE_0")
                circ(cx_, cy_, 2, "SLATE_2")
            p_bb = pj(7.5, 1.2, zb)
            p_seat = pj(7.0, 3.1, zb)
            p_head = pj(8.5, 3.0, zb)
            for a, b in ((p_bb, p_seat), (p_seat, p_head), (p_head, wf), (p_bb, p_head), (p_bb, wr), (p_seat, wr)):
                L(a[0], a[1], b[0], b[1], "CRT_0")
                L(a[0], a[1] + 1, b[0], b[1] + 1, "TERRA_0")
            L(p_head[0], p_head[1] - 2, p_head[0] + 9, p_head[1] - 2, "INK")      # aero bars
            L(p_head[0], p_head[1] - 1, p_head[0] + 4, p_head[1] - 1, "INK")
            R(p_seat[0] - 5, p_seat[1] - 3, p_seat[0] + 4, p_seat[1] - 2, "INK")   # saddle
            circ(p_bb[0], p_bb[1], 3, "SLATE_0")
            awake = vk("gym.bike") == "awake"
            if not awake:
                # tarp over the saddle and the rear wheel only, so the frame and front wheel still read
                t = [(p_seat[0] - 9, p_seat[1] - 5), (p_seat[0] + 10, p_seat[1] - 4), (p_bb[0] + 6, p_bb[1] + 2),
                     (p_bb[0] + 2, wr[1] + rr - 1), (wr[0] - rr - 1, wr[1] + rr - 3), (wr[0] - rr - 3, wr[1] - 4)]
                POLY(t, "SLATE_1", "INK")
                for k in range(3):
                    L(t[0][0] + 4 + k * 7, t[0][1] + 2, t[0][0] + k * 9 - 4, wr[1] + rr - 4, "SLATE_0")
                L(t[0][0] + 1, t[0][1] + 1, t[1][0] - 2, t[1][1] + 1, "SLATE_2")
            m = (p_bb[0] - 2, p_bb[1] - 12) if not awake else (p_head[0] - 14, p_head[1] + 4)
            PL([(m[0] - 2, m[1]), (m[0] - 1, m[1] - 1), (m[0], m[1]), (m[0] + 1, m[1] - 1)], "CREAM")
            ring(m[0], m[1] + 4, 1, "CREAM")
            R(m[0] - 1, m[1] + 7, m[0] + 1, m[1] + 8, "CREAM")
            shadow_fp(5.3, 10.1, 0.5, 1.3, k=1.0)
    with xshift(2.5):
        with obj("foam-roller"):
            x, y = pj(-0.8, 0.35, 4.4)
            R(x - 13, y - 4, x + 13, y + 4, "SLATE_1")
            L(x - 13, y - 3, x + 13, y - 3, "SLATE_2")
            ELL(x + 10, y - 4, x + 16, y + 4, "SLATE_0", "INK")
            L(x - 13, y - 4, x + 13, y - 4, "INK")
            L(x - 13, y + 4, x + 13, y + 4, "INK")
            L(x - 14, y - 4, x - 14, y + 4, "INK")
            shadow_ell(x, y + 4, 15, 2, k=1.0)
    with xshift(2.5):
        with obj("bottle"):
            x, y = pj(6.3, 0, 2.6)
            BOX(x - 3, y - 11, x + 3, y, "ENERGY", hi="ENERGY_HI")
            R(x - 2, y - 13, x + 2, y - 12, "INK")
            shadow_ell(x, y, 4, 1, k=1.0)


# ================================================================ back wall (placeholder shell in phase 1; the calendar wall is phase 3)
@scene("back")
def scene_back():
    pass



# ================================================================ scene assembly
def world_scene():
    """Geometry every view draws the same way (ceiling beams, strings of lights, hanging plants, corner pieces)."""
    ceiling_beams()
    world_string_lights()
    world_hangers()
    corner_pieces()


def build(tod="golden", tier=3, beam=False, ghost=False, view="front", margins=True, textured=True):
    """Draw one view: albedo, material IDs and surface coordinates (no light). The margins (rays beyond 45
    degrees) take the neighbour views' flat albedo and surfaces, and the whole master is textured after that,
    so the margin's texture is drawn at this view's pixel grid (re-projecting texture grain breaks it)."""
    global TOD, TIER
    TOD, TIER = tod, tier
    set_view(view)
    FLAGS["beam"] = beam
    new_scene()
    G.ghost = ghost
    shell()
    G.shell_img = G.img.copy()       # the backdrop hotspots are judged against (TEXTURE_SPEC 5.13)
    fn = SCENES.get(view)
    if fn:
        fn()
    world_scene()
    despeckle(("corner-", "hang-plant"))
    assign_materials()
    if margins:
        own = snapshot_view(), {k: getattr(G, k) for k in ("names", "order", "objmat", "win", "screens", "cones", "glows", "lights")}
        vars_ = dict(VAR), dict(AF)
        VAR.clear()
        AF.clear()
        lf = neighbour_render(neighbour(view, -1), tod, tier)
        rt = neighbour_render(neighbour(view, 1), tod, tier)
        VAR.update(vars_[0])
        AF.update(vars_[1])
        set_view(view)
        for k, v in own[0].items():
            setattr(G, k, v)
        for k, v in own[1].items():
            setattr(G, k, v)
        G.margin = fill_margins(view, lf, rt)
    if textured:
        apply_textures(view, tier)
    return G.img.copy()


def despeckle(prefixes, passes=3):
    """Small foliage at distance breaks into single pixels and 2x2 checkerboards; fold each pixel with no
    4-neighbour of its colour (inside the same object) into the commonest colour around it."""
    oids = [o for o, n in G.names.items() if n.startswith(prefixes)]
    if not oids:
        return
    sel = np.isin(G.oid, oids)
    for _ in range(passes):
        img = G.img.astype(np.int16)
        own = np.where(sel, G.oid, -1)
        p = np.pad(img, 1, constant_values=-1)
        po = np.pad(own, 1, constant_values=-2)
        h, w = img.shape
        nb = [(p[dy:dy + h, dx:dx + w], po[dy:dy + h, dx:dx + w]) for dy, dx in ((0, 1), (2, 1), (1, 0), (1, 2))]
        same = np.zeros(img.shape, bool)
        for c, o in nb:
            same |= (c == img) & (o == own)
        bad = sel & ~same
        if not bad.any():
            break
        ys, xs = np.nonzero(bad)
        for y, x in zip(ys, xs):
            votes = {}
            for c, o in nb:
                if o[y, x] == own[y, x]:
                    votes[int(c[y, x])] = votes.get(int(c[y, x]), 0) + 1
            if votes:
                G.img[y, x] = max(votes.items(), key=lambda kv: kv[1])[0]


def snapshot_view():
    return {k: getattr(G, k).copy() for k in ("img", "mat", "kind", "su", "sv", "dist", "emit", "oid")}


def margin_mask():
    """Pixels whose ray is more than 45 degrees off this view's axis (the neighbour view owns them)."""
    rx, _ = ray_grid()
    return (rx > 1.0) | (rx < -1.0)


def fill_margins(view, left, right):
    """Replace the margin pixels with the neighbour views' pixels along the same rays (exact: one camera centre)."""
    rx, ry = ray_grid()
    out = {}
    for side, nb, sel in ((1, right, rx > 1.0), (-1, left, rx < -1.0)):
        if nb is None or not sel.any():
            continue
        f = np.abs(rx[sel])
        px = CX + F * (-side / f)          # the neighbour's lateral: right neighbour sees our forward on its left
        py = CY - F * (ry[sel] / f)
        xi = np.clip(np.floor(px).astype(int), 0, W - 1)
        yi = np.clip(np.floor(py).astype(int), 0, H - 1)
        for k in ("img", "mat", "kind", "su", "sv", "dist", "emit"):
            getattr(G, k)[sel] = nb[k][yi, xi]
    m = margin_mask()
    G.names[6] = "margin"
    G.order[6] = len(G.order) + 1
    G.oid[m] = 6
    return m


MARGIN_CACHE = {}


def neighbour_render(view, tod, tier):
    key = (view, tod, tier)
    if key not in MARGIN_CACHE:
        build(tod, tier, view=view, margins=False, textured=False)
        MARGIN_CACHE[key] = snapshot_view()
    return MARGIN_CACHE[key]


def assign_materials():
    """Material ID per pixel: the object's default (or per-colour map), then colour rules for unmapped pixels."""
    inv = {v: k for k, v in N.items()}
    specs = {}
    for oid, nm in G.names.items():
        if oid < 10:
            continue
        sp = G.objmat.get(oid) or OBJMAT.get(nm) or OBJMAT.get(nm.split("@")[0])
        if sp is not None:
            specs[oid] = sp
    covered = np.zeros((H, W), bool)
    for oid, spec in specs.items():
        m = G.oid == oid
        if not m.any():
            continue
        covered |= m
        if isinstance(spec, str):
            G.mat[m] = MAT[spec]
            continue
        G.mat[m] = MAT[spec.get("default", "none")]
        for cname, mname in spec.items():
            if cname == "default" or cname not in N:
                continue
            G.mat[m & (G.img == N[cname])] = MAT[mname]
    # every other object pixel (the shell's plaster or floor ID is still under it) takes its colour family
    rest = ~covered & (G.oid >= 10)
    if rest.any():
        fam = {"OAK": "wood_furniture", "LEAF": "leaf", "SLATE": "metal_painted", "GOLD": "gold_metal", "PLUM": "fabric_cotton",
               "TERRA": "fabric_cotton", "CRT": "screen_emissive", "ENERGY": "neon", "CREAM": "paper", "PAPER": "paper",
               "INK": "metal_painted", "BROWN": "metal_painted", "VIOLET": "fabric_cotton", "SUN": "bulb", "GLOW": "bulb",
               "AMBER": "wood_furniture", "RIM": "fabric_cotton", "ORANGE": "bulb", "NAVY": "fabric_cotton",
               "LINEN": "fabric_cotton", "COOL": "glass_crt", "GLASS": "glass_crt", "PLASTER": "plaster", "VOID": "metal_painted"}
        # colour family per palette index; outlines and wall-coloured bits (INK, VOID, PLASTER) are neutral and
        # take the object's main material, so an outline is part of the thing it outlines
        famid = np.zeros(256, np.uint8)
        neutral = np.zeros(256, bool)
        for i, nm in inv.items():
            key = nm.split("_")[0]
            famid[i] = MAT[fam.get(key, "plastic")]
            neutral[i] = key in ("INK", "VOID", "PLASTER")
        for oid in np.unique(G.oid[rest]):
            m = rest & (G.oid == oid)
            idx = G.img[m]
            out = famid[idx]
            nz = ~neutral[idx]
            if nz.any():
                vals, cnt = np.unique(out[nz], return_counts=True)
                out = np.where(nz, out, vals[np.argmax(cnt)])
            G.mat[m] = out
    # emissive pixels that are not screens or glass read as bulbs or flames
    em = G.emit & (G.oid >= 10) & ~np.isin(G.mat, [MAT["screen_emissive"], MAT["neon"], MAT["sky"], MAT["glass_window"]])
    G.mat[em] = MAT["bulb"]


def apply_textures(view, tier):
    """Hand the albedo to the texture library (art/room-r6/textures.py) when it is present."""
    try:
        import textures  # noqa: E402
    except ImportError:
        return
    surf = {"kind": G.kind, "u": G.su, "v": G.sv, "dist": G.dist}
    wpx = window_px(view)
    textures.apply(G.img, G.mat, surf, G.oid, G.names, attention(view), view, tier, seed=0,
                   opts={"window_px": wpx, "wear_paths": WEAR_PATHS})
    # hotspots read against their backdrop: a selective outline (TEXTURE_SPEC 5.13), never anti-aliased curves
    for nm in (() if G.ghost else hotspot_objects(view)):
        ids = [o for o, n in G.names.items() if n == nm and o >= 10]
        if ids:
            m = np.isin(G.oid, ids)
            if m.any():
                before = G.img.copy()
                textures.selout(G.img, m, backdrop=G.shell_img, light_px=wpx, hotspot=True, add=True)
                # the outline pixels added outside the object belong to it
                grown = (G.img != before) & ~m
                if grown.any():
                    vals, cnt = np.unique(G.mat[m], return_counts=True)
                    G.oid[grown] = ids[0]
                    G.mat[grown] = vals[np.argmax(cnt)]
                # anything still under 2 ramp steps from the wall behind it falls back to INK
                # (3 steps against the untextured wall: its texture moves it up to a step either way)
                _, fail = textures.hotspot_contrast(G.img, m | grown, G.shell_img, steps=4.0)
                G.img[fail] = N["INK"]
    fold_lone()
    cap_3x3()


PASS_THROUGH = {"screen_emissive", "neon", "bulb", "flame", "wet", "sky", "glass_window", "glass_crt", "cork", "soil"}
BACKDROP = {"plaster", "plaster_venetian", "wood_floor", "wood_ceiling"}


def fold_lone(passes=3):
    """The texture gate's noise rule (TEXTURE_SPEC 9), applied at the source. A pixel is lone when no neighbour
    inside its own region (same object, same material) has its colour. Lone object pixels take the commonest
    colour of their region's neighbours (speckle; a one-pixel detail in another material is its own region and
    stays). Lone specks of wall, floor or ceiling caught between parts of an object become that object.
    The emissive, glass, sky and speck materials are left alone."""
    skip = np.isin(G.mat, [MAT[m] for m in PASS_THROUGH])
    back = np.isin(G.mat, [MAT[m] for m in BACKDROP])
    h, w = G.img.shape
    for _ in range(passes):
        img = G.img.astype(np.int32)
        reg = G.oid.astype(np.int64) * 256 + G.mat
        p = np.pad(img, 1, constant_values=-1)
        pr = np.pad(reg, 1, constant_values=-1)
        same = np.zeros((h, w), bool)
        has = np.zeros((h, w), bool)
        for dy, dx in ((0, 1), (2, 1), (1, 0), (1, 2)):
            inreg = pr[dy:dy + h, dx:dx + w] == reg
            has |= inreg
            same |= inreg & (p[dy:dy + h, dx:dx + w] == img)
        obj_lone = has & ~same & ~skip & (G.oid >= 6)
        speck = ~has & back & (G.oid < 10)
        changed = 0
        ys, xs = np.nonzero(obj_lone | speck)
        for y, x in zip(ys.tolist(), xs.tolist()):
            votes = {}
            r0 = reg[y, x]
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w:
                    if obj_lone[y, x]:
                        if reg[yy, xx] == r0:
                            votes[(int(G.img[yy, xx]), 0, 0)] = votes.get((int(G.img[yy, xx]), 0, 0), 0) + 1
                    elif G.oid[yy, xx] >= 10:
                        k = (int(G.img[yy, xx]), int(G.oid[yy, xx]), int(G.mat[yy, xx]))
                        votes[k] = votes.get(k, 0) + 1
            if not votes:
                continue
            (c, o, m), n = max(votes.items(), key=lambda kv: kv[1])
            if obj_lone[y, x]:
                G.img[y, x] = c
                changed += 1
            elif n >= 2:
                G.img[y, x], G.oid[y, x], G.mat[y, x] = c, o, m
                changed += 1
        if not changed:
            break


MAT_INFO = None


def cap_3x3(passes=6):
    """TEXTURE_SPEC 9 max3x3: inside one object's material region, a 3x3 window may hold at most the class's
    number of colours. Where it holds more, the rarest colour in that window takes the window's commonest one."""
    global MAT_INFO
    if MAT_INFO is None:
        mj = json.load(open(os.path.join(HERE, "materials.json")))
        cl = mj["classes"]
        MAT_INFO = {m["id"]: (cl[m["class"]].get("max3x3") if cl[m["class"]].get("iso") is not None else None)
                    for m in mj["materials"]}
    h, w = G.img.shape
    emis = {MAT[m] for m in ("screen_emissive", "neon", "bulb", "flame")}
    for _ in range(passes):
        reg = G.oid.astype(np.int64) * 256 + G.mat
        changed = 0
        for r in np.unique(reg[G.oid >= 6]):
            mid = int(r % 256)
            lim = MAT_INFO.get(mid)
            if not lim or mid in emis:
                continue
            m = reg == r
            ys, xs = np.nonzero(m)
            y0, y1, x0, x1 = max(0, ys.min() - 1), min(h, ys.max() + 2), max(0, xs.min() - 1), min(w, xs.max() + 2)
            sub_img = np.where(m[y0:y1, x0:x1], G.img[y0:y1, x0:x1].astype(np.int32), -1)
            hh, ww = sub_img.shape
            p = np.pad(sub_img, 1, constant_values=-1)
            st = np.sort(np.stack([p[dy:dy + hh, dx:dx + ww] for dy in range(3) for dx in range(3)]), axis=0)
            distinct = ((st[1:] != st[:-1]) & (st[1:] >= 0)).sum(0) + (st[0] >= 0)
            over = (distinct > lim) & (sub_img >= 0)
            for cy, cx in zip(*np.nonzero(over)):
                win = sub_img[max(0, cy - 1):cy + 2, max(0, cx - 1):cx + 2]
                vals, cnt = np.unique(win[win >= 0], return_counts=True)
                if len(vals) <= lim:
                    continue
                rare = vals[np.argmin(cnt)]
                # each rare pixel takes a colour it already touches (no new colour enters any window)
                oy, ox = max(0, cy - 1), max(0, cx - 1)
                for ry, rx in zip(*np.nonzero(win == rare)):
                    gy, gx = oy + ry, ox + rx
                    nb = [sub_img[yy, xx] for yy, xx in ((gy - 1, gx), (gy + 1, gx), (gy, gx - 1), (gy, gx + 1))
                          if 0 <= yy < hh and 0 <= xx < ww and sub_img[yy, xx] >= 0 and sub_img[yy, xx] != rare]
                    if nb:
                        c = max(set(nb), key=nb.count)
                        sub_img[gy, gx] = c
                        G.img[y0 + gy, x0 + gx] = c
                        changed += 1
        if not changed:
            break


# walking lines across the floor (world X, Z in feet): door to bed, bed to desk, desk to window
WEAR_PATHS = [[(-12.0, -6.0), (-4.0, -2.0), (0.0, 0.0), (6.0, 2.0), (11.0, -4.0)], [(0.0, 0.0), (0.0, 7.0)]]


def window_px(view):
    """Where the window is in this view's master px (sets which side fold ridges and leaf tips face)."""
    lx, lz = to_local(0.5, RS, view)
    depth = D0 - lz
    if depth < -1.0:
        return (int(CX), H - 1)                      # behind the camera: light from the viewer's side
    if depth < 1.0:
        return (int(CX + (2 * F if lx > 0 else -2 * F)), int(CY - F * 0.3))   # beside the view
    p = pj(lx, 6.0, lz)
    return (int(p[0]), int(p[1]))


_HS = {}


def hotspot_objects(view):
    """Object names behind this view's hotspot items (from the export's item lists)."""
    if view not in _HS:
        names = set()
        try:
            for it in ITEMS[view]():
                if it["kind"] == "hotspot":
                    names.update(o.split("@")[0] for o in it["objs"])
        except NameError:
            pass
        _HS[view] = names
    return _HS[view]


def attention(view):
    """Detail hierarchy (TEXTURE_SPEC 5.12): 1.0 focal band, 0.7 mid ring, 0.4 frame edges, ceiling, bottom floor."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    x0, y0, x1, y1 = VIEWS[view]["core"]
    cx, cy = (x0 + x1) / 2, CY + 60
    d = np.sqrt(((xx - cx) / ((x1 - x0) * 0.42)) ** 2 + ((yy - cy) / ((y1 - y0) * 0.5)) ** 2)
    a = np.where(d < 0.75, 1.0, np.where(d < 1.15, 0.7, 0.4)).astype(np.float32)
    a[G.kind == 3] = 0.4
    a[yy > y1 - (y1 - y0) * 0.15] = np.minimum(a[yy > y1 - (y1 - y0) * 0.15], 0.4)
    return a


def preview_rgb(img=None):
    """Development preview only: albedo with a crude cool ambient and a warm window falloff (the real light is GL)."""
    a = RGB[G.img if img is None else img].astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    k = 0.55 + 0.6 * np.exp(-(((xx - 470) / 300) ** 2 + ((yy - 330) / 200) ** 2))
    if VIEW == "front":
        tint = np.array([1.0, 0.86, 0.72])
    else:
        tint = np.array([0.95, 0.88, 0.85])
    out = a * k[..., None] * tint
    out[G.emit] = a[G.emit]
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def still(view, tod="golden", scale=2, full=False):
    build(tod, 3, view=view)
    rgb = preview_rgb()
    x0, y0, x1, y1 = (0, 0, W, H) if full else VIEWS[view]["core"]
    a = rgb[y0:y1, x0:x1]
    return np.array(Image.fromarray(a).resize((a.shape[1] * scale, a.shape[0] * scale), Image.NEAREST))



# ================================================================ light data per view (LIGHTING_SPEC section 8)
STOPS = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]
FALL = [(1 - d * d) ** 2 for d in STOPS]
VSTOPS = [i / 8 for i in range(9)]


def fallback_spec(ox, oy):
    """The v3.3-style Canvas2D overlay (warm wash, glows, oval vignette) for the no-WebGL2 path, in world px."""
    gl = []
    win = G.win if VIEW == "front" else None
    if win is not None:
        wx, wy = (win[0] + win[2]) / 2, (win[1] + win[3]) / 2
        ww = win[2] - win[0]
        if TOD == "night":
            gl += [dict(x=wx, y=wy, rx=ww * 1.2, ry=ww * 0.8, c=(70, 96, 200), a=0.14)]
        else:
            gl += [dict(x=wx, y=wy + 40, rx=ww * 2.5, ry=ww * 1.6, c="sun", a=0.20),
                   dict(x=wx, y=wy + 10, rx=ww * 0.95, ry=ww * 0.75, c="sun", a=0.18)]
    elif TOD != "night" and VIEW in ("left", "right"):
        sx = 820 if VIEW == "left" else -20
        gl += [dict(x=sx, y=260, rx=640, ry=380, c="sun", a=0.30)]
    lamp = 1.45 if TOD == "night" else 1.0
    for g in G.glows:
        g2 = dict(g)
        g2["a"] = g["a"] * lamp
        gl.append(g2)
    out = []
    for g in gl:
        c = g["c"]
        out.append(dict(x=round(float(g["x"]) - ox, 1), y=round(float(g["y"]) - oy, 1), rx=round(float(g["rx"]), 1),
                        ry=round(float(g["ry"]), 1), rgb=list(GLOW_RGB[c] if isinstance(c, str) else c),
                        a=round(float(min(0.95, g["a"])), 3)))
        if g.get("ch"):
            out[-1]["ch"] = g["ch"]
    amb = ((255, 120, 50), 0.06) if TOD != "night" else ((40, 48, 110), 0.10)
    vc = (0.30, 0.17, 0.20) if TOD != "night" else (0.20, 0.17, 0.30)
    return {"ambient": {"rgb": list(amb[0]), "a": amb[1]}, "glows": out,
            "vignette": dict(x=400 - ox, y=300 - oy, rx=430, ry=300, inner=0.42, c=list(vc)),
            "stops": STOPS, "fall": [round(x, 4) for x in FALL], "vstops": VSTOPS}


def hexc(rgb):
    return "#%02X%02X%02X" % tuple(int(v) for v in rgb)


def lighting_block(view, ox, oy):
    """views.<view>.lighting: window, key, floor, ambient, curated practical lights, materials, noRim."""
    x0, y0, x1, y1 = VIEWS[view]["core"]
    floor_back = int(round(CY + EYE * F / D0)) - oy
    out = {"floor": {"backLine": floor_back, "bottom": y1 - oy, "squash": 1.0, "seam": "AMBER"},
           "ambient": {"day": "#2A3550", "golden": "#2A2E45", "night": "#1A2040"},
           "facing": 250, "yaw": YAW[view]}
    if view == "front":
        wx0, wy0, wx1, wy1 = G.win
        mull = [[int(wx0 + (wx1 - wx0) * k // 3) - ox, wy0 - oy, 1, wy1 - wy0] for k in (1, 2)]
        out["window"] = {"rect": [wx0 - ox, wy0 - oy, wx1 - wx0, wy1 - wy0], "facing": 250, "mullions": mull,
                         "blinds": None}
        # key centre on the floor in front of the window (backlit wall: the wall itself gets 25%)
        cxk = (wx0 + wx1) / 2 - ox
        out["key"] = {"center": [round(cxk), floor_back + 46], "radius": [round((wx1 - wx0) * 1.15), 70], "offscreen": None}
    elif view == "left":
        out["window"] = None
        out["key"] = {"center": [x1 - ox + 150, floor_back + 30], "radius": [520, 120], "offscreen": "right"}
    elif view == "right":
        out["window"] = None
        out["key"] = {"center": [x0 - ox - 150, floor_back + 30], "radius": [520, 120], "offscreen": "left"}
    else:
        out["window"] = None
        out["key"] = {"center": [(x0 + x1) / 2 - ox, floor_back + 120], "radius": [600, 260], "offscreen": "behind",
                      "bounce": True}
    lights = []
    tint_rgb = {"red": (255, 64, 40), "green": (70, 255, 130), "violet": (176, 104, 255), "cyan": (70, 226, 246),
                "pink": (255, 112, 168), "ember": (255, 118, 44), "potion": (226, 112, 214), "lamp": (255, 186, 104),
                "warm": (255, 176, 96), "sun": (255, 150, 64)}
    seen = set()
    for i, g in enumerate(G.glows):
        c = g["c"]
        rgb = tint_rgb.get(c, (255, 176, 96)) if isinstance(c, str) else tuple(c)
        key = (round(g["x"] / 6), round(g["y"] / 6), c if isinstance(c, str) else "rgb")
        if key in seen:
            continue
        seen.add(key)
        lt = {"id": f"{view}-{i}", "type": "point", "pos": [round(g["x"] - ox, 1), round(g["y"] - oy, 1)],
              "rgb": list(rgb), "intensity": round(min(2.0, g["a"] * 4.5), 3), "radius": round(max(g["rx"], g["ry"]) * 1.1, 1),
              "when": "always"}
        if g.get("ch"):
            lt["channel"] = g["ch"]
        lights.append(lt)
    # practical lamps that switch on at sunset are marked by the art (pendants, floor lamp, desk lamp, cabinet light)
    out["lights"] = lights
    out["materials"] = {"LEAF_1": {"translucency": 0.5}}
    out["noRim"] = ["*poster*", "*calendar*", "*pennant*", "*photo*", "*board*"]
    return out


# ================================================================ live export (layered art for the engine)
PROTO = os.path.join(ROOT, "docs", "redesign", "room-prototype")
SPR_DIR = "art-r6"
OX, OY = CORE_BOX[0], CORE_BOX[1]     # master = world + (OX, OY), every view
MIN_HIT = 11
SKI = lambda s: {"skill": s}  # noqa: E731
FTR = lambda s: {"feature": s}  # noqa: E731
STGK = ("s0", "s1", "s2")
RELK = ("base", "active", "hot", "gold")
BASEVAR = {"kitchen.relic": "base", "window.relic": "base", "gym.relic": "base"}
ZONE_VIEW = {"kitchen": "left", "bed": "left", "library": "front", "window": "front", "study": "right",
             "computer": "right", "gym": "right"}
STATIC_PARTS = {"sky", "sun", "far"}
TA = {"t1": "base", "t3": "base", "t5": "base"}
SA = {"s0": "base", "s1": "base", "s2": "base"}
E = []


def I(id_, zone, kind, objs, keys=("base",), alias=None, target=None, label=None, note="", screen=None, layer=None, view="front"):
    return dict(id=id_, zone=zone, kind=kind, objs=list(objs), keys=list(keys), alias=dict(alias or {}),
                target=target, label=label, note=note, screen=screen, layer=layer, view=view)


def world_items(view):
    """Per view: the margin plate, ceiling strings, hanging plants and corner pieces (world geometry)."""
    p = "shell." + view
    return [I(p + "-margin", "shell", "shell", ["margin"], layer=5, view=view, note="the neighbour views' pixels beyond 45 degrees"),
            I(p + "-strings", "shell", "decor", ["string-1", "string-3", "string-x"], ("base", "night"), view=view, layer=5,
              note="strings of bulbs along the beams"),
            I(p + "-hangers", "shell", "decor", ["hang-plant"], view=view, layer=5, note="hanging plants"),
            I(p + "-corners", "shell", "decor", ["corner-front-left", "corner-front-right", "corner-back-right", "corner-back-left"],
              view=view, note="the corner pieces this view shares with its neighbours")]


# albedo only: shell plates look the same at night (the light model darkens them), so night aliases base
NA = {"night": "base"}


def shell_items(view, front=False):
    if front:
        out = [I("shell.sky", "shell", "shell", ["window-sky"], ("base", "night"), layer=0),
               I("shell.outside", "shell", "shell", ["window-view"], ("base", "night"), layer=1),
               I("shell.window", "shell", "shell", ["window-frame", "curtains"], layer=2, alias=NA),
               I("shell.l2", "shell", "shell", ["wall-B"], layer=2, alias=NA), I("shell.l3", "shell", "shell", ["ceiling", "void", "beams"], ("base", "night"), layer=2),
               I("shell.l4", "shell", "shell", ["wall-L", "wall-R"], layer=2, alias=NA), I("shell.l5", "shell", "shell", ["floor"], layer=2, alias=NA)]
    else:
        p = "shell." + view
        out = [I(p + "-l2", "shell", "shell", ["wall-B"], layer=2, view=view, alias=NA),
               I(p + "-l3", "shell", "shell", ["ceiling", "void", "beams"], ("base", "night"), layer=2, view=view),
               I(p + "-l4", "shell", "shell", ["wall-L", "wall-R"], layer=2, view=view, alias=NA),
               I(p + "-l5", "shell", "shell", ["floor"], layer=2, view=view, alias=NA)]
    return out + world_items(view)


def items_front():
    it = shell_items("front", True)
    v = "front"
    it += [I("window.statue", "window", "hotspot", ["knight", "pedestal"], ("t1", "t2", "t3", "t4", "t5"), alias={"base": "t1"},
             target=FTR("overall"), label="FORGE", note="the knight on its rune pedestal; plaque shows the tier name"),
           I("window.tapestry", "window", "decor", ["tapestry"]),
           I("library.sign", "window", "decor", ["forge-sign"], alias={"t1": "base", "t5": "base"}, note="FORGE neon"),
           I("window.relic", "window", "hotspot", ["relic-niche"], RELK, target=FTR("relic-window"), label="RELIC"),
           I("window.candles", "window", "decor", ["candles"]),
           I("window.vinyl", "window", "decor", ["media-stand"]), I("window.plant", "window", "decor", ["floor-plant-window"]),
           I("window.today", "window", "hotspot", ["crt-big"], target=FTR("today"), label="TODAY", screen="crt-big"),
           I("window.stats", "window", "hotspot", ["crt-small"], target=FTR("stats"), label="STATS", screen="crt-small"),
           I("window.rug", "window", "decor", ["rug"], alias=TA),
           I("library.chess", "window", "hotspot", ["chess-table"], STGK, alias={"base": "s1"}, target=SKI("chess"), label="CHESS"),
           I("window.chess-chairs", "window", "decor", ["chess-stool"]),
           I("bed.runner", "window", "decor", ["med-rug"], alias={"t3": "base"}),
           I("bed.cushion", "window", "hotspot", ["med-cushion", "med-candle"], STGK, alias={"base": "s1"}, target=SKI("meditation"),
             label="MEDITATION"),
           I("study.pennant", "window", "decor", ["pennant"]), I("study.photo", "window", "decor", ["photo"]),
           I("library.pendant", "library", "decor", ["pendant@0"], ("base", "night"), alias=TA),
           I("study.pendant", "window", "decor", ["pendant@1"], ("base", "night"), alias=TA),
           I("library.bookshelf", "library", "hotspot", ["bookcase", "bookcase-plants", "ladder"], STGK, alias={"base": "s1"},
             target=SKI("reading"), label="READING"),
           I("library.potions", "library", "decor", ["potions"]),
           I("library.archive", "library", "hotspot", ["trophy-case"], target=FTR("archive"), label="ARCHIVE"),
           I("library.books-floor", "library", "decor", ["book-stack"])]
    for pid, z in (("window.skylight", "window"), ("window.downlight-fixture", "window"), ("window.sill-plant", "window"),
                   ("window.sill-books", "window"), ("window.sill-mug", "window"), ("window.radiator", "window"),
                   ("window.plantwall", "window"), ("window.amp", "window"), ("window.speaker", "window"),
                   ("window.powerstrip", "window"), ("window.cables-floor", "window"), ("window.stringlights", "window"),
                   ("window.cables-ceiling", "window"), ("library.stringlights", "library"), ("study.stringlights", "study"),
                   ("kitchen.pothos", "kitchen"), ("library.pothos", "library"), ("study.pothos", "study"),
                   ("library.bookcase", "library"), ("library.shelf-plant", "library"), ("library.globe", "library"),
                   ("library.snakeplant", "library"), ("library.clock", "library"), ("library.poster", "library"),
                   ("library.armchair", "library"), ("library.floorlamp", "library"), ("library.stool", "library"),
                   ("study.shelf", "study"), ("study.speaker", "study"), ("study.clock", "study"), ("study.bin", "study"),
                   ("kitchen.pendant", "kitchen"), ("kitchen.spices", "kitchen"), ("kitchen.board", "kitchen"),
                   ("bed.charger", "bed"), ("bed.slippers", "bed"), ("bed.hamper", "bed"), ("bed.stringlights", "bed"),
                   ("computer.router", "computer"), ("computer.speakers", "computer"), ("computer.can", "computer"),
                   ("computer.cables", "computer"), ("computer.mug", "computer"), ("gym.light", "gym"), ("gym.rope", "gym")):
        keys = ("base", "night") if pid in ("window.skylight", "kitchen.pendant", "gym.light", "bed.stringlights") else ("base",)
        alias = {"t1": "base", "t2": "base", "t3": "base", "t4": "base", "t5": "base"}
        it.append(I(pid, z, "decor", E, keys, alias=alias, note="placeholder: an earlier room's id with no piece in this room"))
    for cid in ("shell.crop.speaker", "shell.crop.boxes", "shell.crop.plant", "shell.crop.cables"):
        it.append(I(cid, "shell", "decor", E, layer=6))
    return it


def items_left():
    v = "left"
    it = shell_items(v)
    it += [I("bed.frame", "bed", "decor", ["bed", "headboard"], alias={"t1": "base", "t2": "base", "t5": "base"}, view=v),
           I("bed.bed", "bed", "hotspot", ["alarm-clock"], alias=SA, target=SKI("sleep"), label="SLEEP", view=v),
           I("bed.nightstand", "bed", "decor", ["nightstand"], view=v),
           I("bed.shelf", "bed", "decor", ["bed-shelf"], view=v),
           I("bed.globe", "bed", "hotspot", ["plasma-globe"], alias=SA, target=SKI("visualization"), label="VISUALIZATION", view=v),
           I("bed.sconce", "bed", "decor", ["star-jar"], ("base", "night"), view=v),
           I("bed.poster", "bed", "decor", ["bed-frame-art"], alias=TA, view=v),
           I("bed.rug", "bed", "decor", ["bed-rug"], view=v),
           I("kitchen.microwave", "kitchen", "decor", ["fridge"], view=v),
           I("kitchen.table", "kitchen", "decor", ["kitchen-shelf"], alias=TA, view=v),
           I("kitchen.switch", "kitchen", "decor", ["cabinet-light"], ("base", "night"), view=v, note="the under-shelf light strip"),
           I("kitchen.door", "kitchen", "hotspot", ["corkboard-kitchen"], STGK, alias={"base": "s1"}, target=SKI("college-integration"),
             label="COLLEGE INTEGRATION", view=v),
           I("kitchen.doormat", "kitchen", "hotspot", ["envelope"], ("base", "alert"), target=FTR("review"), label="REVIEW", view=v),
           I("kitchen.settings", "kitchen", "hotspot", ["switch-panel"], target=FTR("settings"), label="SETTINGS", view=v),
           I("kitchen.relic", "kitchen", "hotspot", ["relic-mount-L"], RELK, target=FTR("relic-left"), label="RELIC", view=v),
           I("kitchen.counter", "kitchen", "decor", ["counter", "backsplash"], alias=TA, view=v),
           I("kitchen.food", "kitchen", "hotspot", ["fruit-basket"], STGK, alias={"base": "s1"}, target=SKI("food"), label="FOOD", view=v),
           I("kitchen.water", "kitchen", "decor", ["water-jug"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, view=v),
           I("kitchen.kettle", "kitchen", "decor", ["kettle"], view=v),
           I("kitchen.gut", "kitchen", "hotspot", ["gut-plant"], STGK, alias={"base": "s1"}, target=SKI("gut-health"), label="GUT HEALTH", view=v),
           I("kitchen.stool", "kitchen", "decor", ["kitchen-stool"], view=v),
           I("kitchen.clock", "kitchen", "decor", ["wall-clock"], view=v),
           I("kitchen.hooks", "kitchen", "decor", ["coat-hooks"], view=v),
           I("kitchen.shoes", "kitchen", "decor", ["shoes-entry"], alias={"t1": "base", "t3": "base"}, view=v),
           I("kitchen.entry", "kitchen", "decor", ["door", "doormat"], view=v, note="the room's entry door and mat")]
    return it


def items_right():
    v = "right"
    it = shell_items(v)
    it += [I("study.academics", "study", "hotspot", ["schedule-board"], STGK + ("alert",), alias={"base": "s1"}, target=SKI("academics"),
             label="ACADEMICS", view=v),
           I("study.time", "study", "hotspot", ["calendar"], STGK, alias={"base": "s1"}, target=SKI("time-blocking"), label="TIME BLOCKING", view=v),
           I("study.desk", "study", "decor", ["desk"], alias=TA, view=v),
           I("study.lamp", "study", "decor", ["desk-lamp"], ("base", "night"), alias={"t1": "base", "t2": "base", "t5": "base"}, view=v),
           I("study.courses", "study", "hotspot", ["course-books"], target=FTR("courses"), label="COURSES", view=v),
           I("study.journal", "study", "hotspot", ["journal"], target=FTR("journal"), label="JOURNAL", view=v),
           I("study.mug", "study", "decor", ["pen-mug"], view=v), I("study.headphones", "study", "decor", ["succulent"], view=v),
           I("study.chair", "study", "decor", ["desk-chair"], alias=TA, view=v), I("study.backpack", "study", "decor", ["backpack"], view=v),
           I("study.plant", "study", "decor", ["plant-study"], view=v),
           I("computer.board", "computer", "hotspot", ["whiteboard"], STGK, alias={"base": "s1"}, target=SKI("dropshipping"),
             label="DROPSHIPPING", view=v),
           I("computer.shelf", "computer", "decor", ["pc-shelf"], view=v),
           I("computer.desk", "computer", "decor", ["pc-desk"], alias=TA, view=v),
           I("computer.led", "computer", "decor", ["pc-tower"], view=v),
           I("computer.ai", "computer", "hotspot", ["monitors"], alias=SA, target=SKI("ai-building"), label="AI BUILDING", view=v),
           I("computer.focus", "computer", "hotspot", ["focus-note"], target=FTR("focus"), label="FOCUS", view=v),
           I("computer.headset", "computer", "decor", ["headphones"], view=v),
           I("computer.money", "computer", "decor", ["money-tree"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, view=v),
           I("computer.chair", "computer", "decor", ["pc-chair"], alias=TA, view=v),
           I("computer.boxes", "computer", "decor", ["ship-boxes"], view=v),
           I("gym.mat", "gym", "decor", ["gym-mat"], view=v), I("gym.timer", "gym", "decor", ["gym-timer"], view=v),
           I("gym.trophies", "gym", "decor", ["race-photos"], alias=TA, view=v),
           I("gym.medals", "gym", "decor", ["medal-wall"], ("g0", "g1", "g2", "g3"), alias={"base": "g2"}, view=v),
           I("gym.tiles", "gym", "decor", ["symbol-poster"], alias=TA, view=v),
           I("gym.relic", "gym", "hotspot", ["relic-bracket-R"], RELK, target=FTR("relic-right"), label="RELIC", view=v),
           I("gym.strength", "gym", "hotspot", ["weight-rack"], STGK, alias={"base": "s1"}, target=SKI("strength"), label="STRENGTH", view=v),
           I("gym.kettlebell", "gym", "decor", ["kettlebells"], view=v), I("gym.chalk", "gym", "decor", ["chalk"], view=v),
           I("gym.running", "gym", "hotspot", ["shoe-shelf"], alias=SA, target=SKI("running"), label="RUNNING", view=v),
           I("gym.bag", "gym", "decor", ["gym-bag"], view=v),
           I("gym.bike", "gym", "hotspot", ["bike"], ("base", "awake"), alias=SA, target=SKI("triathlon"), label="TRIATHLON", view=v),
           I("gym.roller", "gym", "decor", ["foam-roller"], view=v), I("gym.bottle", "gym", "decor", ["bottle"], view=v)]
    # the right view's corner pieces carry the old gym.plant id
    for x in it:
        if x["id"] == "shell.right-corners":
            x["id"] = "gym.plant"
            x["zone"] = "gym"
    return it


def items_back():
    return shell_items("back")


ITEMS = {"front": items_front, "left": items_left, "right": items_right, "back": items_back}
ANIMS = {
    "front": [("window.crt-flicker", "window", "crt", 3, [0, 0, 1, 0, 2, 0, 0, 1], 8),
              ("library.potions-bubbles", "library", "potions", 3, [0, 1, 2], 3),
              ("window.candle", "window", "candle", 3, [0, 1, 0, 2, 1, 0], 6),
              ("window.plants-sway", "window", "sway", 4, [0, 1, 2, 3], 2)],
    "left": [("bed.globe-glow", "bed", "globe", 3, [0, 1, 2, 1], 4),
             ("kitchen.kettle-led", "kitchen", "kettle", 3, [0, 1, 2], 3),
             ("kitchen.plants-sway", "kitchen", "sway", 4, [0, 1, 2, 3], 2)],
    "right": [("computer.terminal", "computer", "terminal", 4, [0, 1, 2, 3], 3),
              ("gym.timer-led", "gym", "timer", 4, [0, 1, 2, 3], 2),
              ("gym.plants-sway", "gym", "sway", 4, [0, 1, 2, 3], 2)],
    "back": [("shell.back-sway", "shell", "sway", 4, [0, 1, 2, 3], 2)],
}
ZONE_ON = {"kitchen": ("left", "cabinet-light"), "bed": ("left", "plasma-globe"), "library": ("front", "bookcase"),
           "window": ("front", "crt-big"), "study": ("right", "desk-lamp"), "computer": ("right", "monitors"),
           "gym": ("right", "gym-timer")}


class LR:
    cache = {}


def render(tag, tod="golden", var=None, tier=3, beam=False, ghost=False, anim=None, view="front"):
    """Full albedo render of a view (+ margins). Returns a dict of buffers and metadata."""
    key = (view, tag, tod)
    if key in LR.cache:
        return LR.cache[key]
    VAR.clear()
    VAR.update(BASEVAR)
    VAR.update(var or {})
    AF.clear()
    AF.update(anim or {})
    PARTS.clear()
    PARTS.update(STATIC_PARTS)
    build(tod, tier, beam=beam, ghost=ghost, view=view)
    PARTS.update({"clouds", "birds", "tram"})
    names = {}
    for o in sorted(G.names):
        names.setdefault(G.names[o], []).append(o)
    r = {"img": G.img.copy(), "mat": G.mat.copy(), "oid": G.oid.copy(), "names": names, "gmask": dict(G.gmask),
         "screens": dict(G.screens), "win": G.win, "glows": list(G.glows), "emit": G.emit.copy()}
    if view == "front" or True:
        r["light"] = lighting_block(view, OX, OY)
        r["fallback"] = fallback_spec(OX, OY)
    VAR.clear()
    AF.clear()
    LR.cache[key] = r
    return r


def obj_mask(r, objs, strict=True):
    m = np.zeros((H, W), bool)
    for o in objs:
        nm, _, k = o.partition("@")
        ids = r["names"].get(nm, [])
        if nm == "void":
            ids = [0]
        elif k:
            ids = ids[int(k):int(k) + 1]
        if not ids and nm != "void":
            if strict and nm not in ("string-1", "string-3", "string-x", "hang-plant", "beams") and not nm.startswith("corner-"):
                raise SystemExit(f"unknown object {nm}")
            continue
        m |= np.isin(r["oid"], ids)
    return m


def bbox(a):
    ys, xs = np.nonzero(a != T)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def auto_layer(bottom):
    fb = CY + EYE * F / D0
    return 2 if bottom <= fb + 12 else 3 if bottom <= fb + 40 else 4 if bottom <= fb + 80 else 5


def save_png(a, path):
    px = np.zeros((a.shape[0], a.shape[1], 4), np.uint8)
    px[..., :3] = RGB[a]
    px[..., 3] = np.where(a == T, 0, 255)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(px, "RGBA").save(path)


def fold_array(a, passes=2):
    """Lone pixels of a finished sprite (the R3 dog) take the commonest colour around them."""
    a = a.copy()
    h, w = a.shape
    for _ in range(passes):
        ai = a.astype(np.int32)
        p = np.pad(ai, 1, constant_values=-1)
        same = np.zeros((h, w), bool)
        has = np.zeros((h, w), bool)
        for dy, dx in ((0, 1), (2, 1), (1, 0), (1, 2)):
            nb = p[dy:dy + h, dx:dx + w]
            has |= (nb >= 0) & (nb != T)
            same |= nb == ai
        lone = has & ~same & (a != T) & (a != N["INK"])
        for y, x in zip(*np.nonzero(lone)):
            nb = [int(a[yy, xx]) for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1))
                  if 0 <= yy < h and 0 <= xx < w and a[yy, xx] != T and a[yy, xx] != N["INK"]]
            if nb:
                a[y, x] = max(set(nb), key=nb.count)
    return a


def cap_array(a, mat, passes=20):
    """cap_3x3 on a finished sprite: per material region, a 3x3 window keeps at most the class's colours."""
    global MAT_INFO
    if MAT_INFO is None:
        cap_3x3(passes=0)
    h, w = a.shape
    for _ in range(passes):
        changed = 0
        for mid in np.unique(mat[a != T]):
            lim = MAT_INFO.get(int(mid))
            if not lim:
                continue
            sub_img = np.where((mat == mid) & (a != T), a.astype(np.int32), -1)
            p = np.pad(sub_img, 1, constant_values=-1)
            st = np.sort(np.stack([p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)]), axis=0)
            distinct = ((st[1:] != st[:-1]) & (st[1:] >= 0)).sum(0) + (st[0] >= 0)
            for cy, cx in zip(*np.nonzero((distinct > lim) & (sub_img >= 0))):
                ys, xs = slice(max(0, cy - 1), cy + 2), slice(max(0, cx - 1), cx + 2)
                win = sub_img[ys, xs]
                vals, cnt = np.unique(win[win >= 0], return_counts=True)
                if len(vals) <= lim:
                    continue
                rare = vals[np.argmin(cnt)]
                # each rare pixel takes a colour it already touches, so no new colour enters any window
                # (a fixed replacement colour can oscillate between two overlapping windows)
                for ry, rx in zip(*np.nonzero(win == rare)):
                    gy, gx = ys.start + ry, xs.start + rx
                    nb = [sub_img[yy, xx] for yy, xx in ((gy - 1, gx), (gy + 1, gx), (gy, gx - 1), (gy, gx + 1))
                          if 0 <= yy < h and 0 <= xx < w and sub_img[yy, xx] >= 0 and sub_img[yy, xx] != rare]
                    if nb:
                        c = max(set(nb), key=nb.count)
                        sub_img[gy, gx] = c
                        a[gy, gx] = c
                        changed += 1
        if not changed:
            break
    return a


def const_mats(arrays, name):
    """One material for every pixel of a sprite (the dog, the sky drift, the streetcar)."""
    return {k: np.full((H, W), MAT[name], np.uint8) for k in arrays}


def save_mat(m, a, path):
    """Material IDs as an 8-bit greyscale PNG (255 where the sprite is transparent)."""
    out = np.where(a == T, 255, m).astype(np.uint8)
    Image.fromarray(out, "L").save(path)


def r3_dog():
    p3 = json.load(open(os.path.join(ROOT, "art", "room-r3", "palette.json")))["colors"]
    rgb3 = {tuple(int(c[1][i:i + 2], 16) for i in (1, 3, 5)): k for k, c in enumerate(p3)}
    swapped = {3, 32, 33, 34, 35, 36}
    keep = [k for k in range(37) if k not in swapped]
    out = {}
    for v in ("base", "alert"):
        im = np.array(Image.open(os.path.join(PROTO, "art-r3", "centre", f"dog.{v}.png")).convert("RGBA"))
        a = np.full(im.shape[:2], T, np.uint8)
        for y in range(im.shape[0]):
            for x in range(im.shape[1]):
                if im[y, x, 3] == 255:
                    k = rgb3[tuple(int(c) for c in im[y, x, :3])]
                    if k in swapped:
                        c = np.array(im[y, x, :3], int)
                        k = min(keep, key=lambda j: int(((RGB[j].astype(int) - c) ** 2).sum()))
                    a[y, x] = k
        out[v] = a
    return out


def tag_state(it, key):
    if it["id"] == "window.statue":
        return key, {}, int(key[1])
    if key == "base":
        return "base", {}, 3
    return key, TAGVAR[(it["view"], key)], 3


TAGVAR = {}


def drift_sprites(tod):
    """Window drift sprites (cloud tile, bird frames, streetcar) for the front view, in master px."""
    global TOD
    out = {}
    set_view("front")
    TOD = tod
    X0, X1, Ys, Yt = WIN
    x0, y0 = pji(X0, Yt, 0)
    x1, y1 = pji(X1, Ys, 0)
    ww = x1 - x0
    hz = y1 - 22
    sy = hz - 18 if TOD == "golden" else hz - 2
    span = ww + 70

    def grab(fn):
        new_scene()
        G.win = (x0, y0, x1, y1)
        with obj("piece", emit=True):
            fn()
        a = G.img.copy()
        a[G.oid == 0] = T
        return a
    clip = [x0 - OX, y0 - OY, ww + 1, y1 - y0 + 1]
    out["clouds"] = (grab(lambda: [cloud(x0 - 60 + fx * span, cy, w, c, lit, dark, -9999, 9999)
                                   for fx, cy, w, c, lit, dark in cloud_list(x0, y0, x1, sy)]),
                     dict(mode="wrap", speed=CLOUD_V, span=span, clip=clip))
    if tod != "night":
        fr = [grab(lambda f=f: birds(x0, y0, x1, 0.0, f, clip=False)) for f in (0, 1)]
        out["birds"] = (fr, dict(mode="pass", period=BIRD_PERIOD, phase=BIRD_PHASE, span=ww + 60, ampY=6, freqY=7, clip=clip))
    out["tram"] = (grab(lambda: tram(x0, y1, hz, tod == "night", u=0.0, clip=False)),
                   dict(mode="pass", period=TRAM_PERIOD, phase=TRAM_PHASE, span=ww + 80, ampY=0, freqY=0, clip=clip))
    return out


def export_view(view, manifest):
    items = ITEMS[view]()
    for it in items:
        if it["kind"] != "shell" and it["id"] != "window.statue":
            for k in it["keys"]:
                if k not in ("base", "night"):
                    TAGVAR.setdefault((view, k), {})[it["id"]] = k
    base = render("base", view=view)
    night = render("night", "night", view=view)
    ghost = render("ghost", ghost=True, view=view)
    ghost_n = render("ghost-night", "night", ghost=True, view=view)
    used = set()
    built = []
    for it in items:
        arrays = {}
        mats = {}
        if it["kind"] == "shell" and it["objs"] != ["margin"]:
            src = (("base", ghost), ("night", ghost_n)) if "night" in it["keys"] else (("base", ghost),)
            for key, r in src:
                m = obj_mask(r, it["objs"], strict=False)
                arrays[key] = np.where(m, r["img"], T).astype(np.uint8)
                mats[key] = r["mat"]
        else:
            for o in it["objs"]:
                used.add(o.split("@")[0])
            for key in it["keys"]:
                if key == "night":
                    m = obj_mask(night, it["objs"], strict=False)
                    arrays["night"] = np.where(m, night["img"], T).astype(np.uint8)
                    mats["night"] = night["mat"]
                    continue
                tag, var, tier = tag_state(it, key)
                r = render(tag, var=var, tier=tier, view=view) if tag != "base" else base
                m = obj_mask(r, it["objs"], strict=it["kind"] != "shell" and bool(it["objs"]))
                arrays[key] = np.where(m, r["img"], T).astype(np.uint8)
                mats[key] = r["mat"]
        built.append((it, arrays, mats))
    names = set(n for n in base["names"] if n not in SHELL_NAMES and n != "void" and n != "piece")
    missing = sorted(n for n in names - used if n not in ("beams",) and not n.startswith(("string-", "corner-", "hang-plant")))
    if missing:
        raise SystemExit(f"{view}: objects not exported: {missing}")

    def write(it, arrays, mats, alias, layer=None, extra=None):
        if it["kind"] == "hotspot":
            # TEXTURE_SPEC 5.13 against the textured shell the room shows behind it: silhouette pixels under 2 ramp
            # steps from that backdrop fall back to INK
            try:
                import textures  # noqa: E402
                bd = ghost["img"]
                for k, a in arrays.items():
                    m = a != T
                    if m.any():
                        _, fail = textures.hotspot_contrast(np.where(m, a, bd), m, bd, steps=2.0)
                        if fail.any():
                            # ink runs, not single pixels: the silhouette pixels next to a failing one go too
                            sil = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
                            near = fail | np.roll(fail, 1, 0) | np.roll(fail, -1, 0) | np.roll(fail, 1, 1) | np.roll(fail, -1, 1)
                            a[fail | (near & sil)] = N["INK"]
            except ImportError:
                pass
        box = union([bbox(a) for a in arrays.values()])
        if box is None:
            box = (OX, OY, OX + 1, OY + 1)
        x0, y0, x1, y1 = box
        zone, name = it["id"].split(".", 1)
        variants = {}
        for v, a in arrays.items():
            rel = f"{SPR_DIR}/{view}/{zone}/{name}.{v}.png"
            save_png(a[y0:y1, x0:x1], os.path.join(PROTO, rel))
            if v in mats:
                save_mat(mats[v][y0:y1, x0:x1], a[y0:y1, x0:x1], os.path.join(PROTO, rel[:-4] + ".mat.png"))
            variants[v] = rel
        for v, src in alias.items():
            if src in variants:
                variants[v] = variants[src]
        lay = layer if layer is not None else (it.get("layer") if it.get("layer") is not None else auto_layer(y1))
        rec = {"id": it["id"], "zone": it["zone"], "kind": it["kind"], "layer": int(lay), "x": x0 - OX, "y": y0 - OY,
               "w": x1 - x0, "h": y1 - y0, "variants": variants, "view": view}
        if it["kind"] == "hotspot":
            rec["target"], rec["label"] = it["target"], it["label"]
            a = arrays[it["keys"][0] if it["keys"][0] in arrays else "base"]
            ys, xs = np.nonzero(a != T)
            if not len(xs):
                raise SystemExit(f"{it['id']}: empty hotspot sprite")
            i = int(np.argmax(xs + ys))
            lx = min(max(int(xs[i]) - 3, x0), x1 - 3)
            ly = min(max(int(ys[i]) - 3, y0), y1 - 3)
            rec["led"] = [lx - OX, ly - OY]
            pw, ph = max(0, MIN_HIT - (x1 - x0)), max(0, MIN_HIT - (y1 - y0))
            rec["hit"] = [x0 - OX - pw // 2, y0 - OY - ph // 2, x1 - x0 + pw, y1 - y0 + ph]
        if extra:
            rec.update(extra)
        if it.get("note"):
            rec["note"] = it["note"]
        # floor-standing pieces cast shadows; wall pieces do not
        if it["kind"] != "shell" and y1 < CY + EYE * F / D0 - 4:
            rec["castsShadow"] = False
        manifest.append(rec)
        return rec

    owner_layer = np.zeros((H, W), np.int8)
    for it, arrays, mats in built:
        if it["objs"] == ["margin"]:
            m = base["oid"] == 6
            arrays = {"base": cap_array(np.where(m, base["img"], T).astype(np.uint8), base["mat"]),
                      "night": cap_array(np.where(m, night["img"], T).astype(np.uint8), night["mat"])}
            mats = {"base": base["mat"], "night": night["mat"]}
        extra = None
        if it.get("screen"):
            sx0, sy0, sx1, sy1 = base["screens"][it["screen"]]
            extra = {"screen": [sx0 - OX, sy0 - OY, sx1 - sx0, sy1 - sy0]}
        rec = write(it, arrays, mats, it["alias"], extra=extra)
        if it["kind"] != "shell":
            a = arrays.get("base", arrays.get(it["keys"][0]))
            if a is not None:
                owner_layer[(a != T) & (owner_layer < rec["layer"])] = rec["layer"]

    def top_layer(m):
        v = owner_layer[m]
        return int(min(5, max(2, v.max() if len(v) else 2)))

    anims_spec = {}
    for aid, zone, ch, n, seq, fps in ANIMS[view]:
        rs = [base] + [render(f"anim-{ch}-{k}", anim={ch: k}, view=view) for k in range(1, n)]
        rn = [night] + [render(f"anim-{ch}-{k}", "night", anim={ch: k}, view=view) for k in range(1, n)]
        ak = {}
        for gi, g in enumerate(base["glows"]):
            if g.get("ch") == ch:
                ak[gi] = [round(float(r["glows"][gi]["a"]), 3) if gi < len(r["glows"]) else g["a"] for r in rs]
        m = np.zeros((H, W), bool)
        for group in (rs, rn):
            for r in group[1:]:
                m |= r["img"] != group[0]["img"]
        anims_spec[ch] = {"seq": seq, "fps": fps, "n": n, "ak": ak}
        if not m.any():
            continue
        if ch == "sway":
            movers = np.unique(base["oid"][m])
            d = m.copy()
            for _ in range(3):
                d = d | np.roll(d, 1, 0) | np.roll(d, -1, 0) | np.roll(d, 1, 1) | np.roll(d, -1, 1)
            # whole moving objects in every frame (a crop through an object leaves cut-edge speckle)
            m = d & np.isin(base["oid"], movers)
            for r in rs + rn:
                m |= np.isin(r["oid"], movers)
        arrays = {"base": np.where(m, rs[0]["img"], T).astype(np.uint8), "night": np.where(m, rn[0]["img"], T).astype(np.uint8)}
        mats = {"base": base["mat"], "night": night["mat"]}
        for k in range(1, n):
            arrays[f"f{k}"] = np.where(m, rs[k]["img"], T).astype(np.uint8)
            arrays[f"n{k}"] = np.where(m, rn[k]["img"], T).astype(np.uint8)
            mats[f"f{k}"] = rs[k]["mat"]
            mats[f"n{k}"] = rn[k]["mat"]
        rec = write(I(aid, zone, "decor", [], view=view), arrays, mats, {}, layer=top_layer(m) if ch != "sway" else 5)
        vv = rec["variants"]
        fk = ["base"] + [f"f{k}" for k in range(1, n)]
        nk = ["night"] + [f"n{k}" for k in range(1, n)]
        rec["anim"] = {"frames": [vv[fk[i]] for i in seq], "night": [vv[nk[i]] for i in seq], "fps": fps}
        for k in range(1, n):
            del vv[f"f{k}"], vv[f"n{k}"]
        rec["note"] = f"moving light ({ch}): anim frames over the base"
    if view == "front":
        dog = r3_dog()
        dx, dy = 560, 470
        arrays = {}
        for v, a in dog.items():
            full = np.full((H, W), T, np.uint8)
            h_, w_ = a.shape
            full[dy - h_:dy, dx - w_ // 2:dx - w_ // 2 + w_] = a
            arrays[v] = fold_array(full)
        # fur, and its ink (outline, eyes, nose) as the plastic of a toy's stitched features
        dmats = {k: np.where(a == N["INK"], MAT["plastic"], MAT["fabric_cotton"]).astype(np.uint8) for k, a in arrays.items()}
        write(I("centre.dog", "window", "decor", []), arrays, dmats, {}, layer=4)
        dsp = {t: drift_sprites(t) for t in ("golden", "night")}
        for nm, lay in (("clouds", 0), ("birds", 0), ("tram", 1)):
            g = dsp["golden"].get(nm)
            n_ = dsp["night"].get(nm)
            if nm == "birds":
                arrays = {"base": g[0][0], "f1": g[0][1], "night": np.full((H, W), T, np.uint8)}
                rec = write(I("window." + nm, "window", "decor", []), arrays, const_mats(arrays, "sky"), {}, layer=lay)
                vv = rec["variants"]
                rec["anim"] = {"frames": [vv["base"], vv["f1"]], "fps": 4}
                del vv["f1"]
            else:
                arrays = {"base": g[0], "night": n_[0]}
                rec = write(I("window." + nm, "window", "decor", []), arrays,
                            const_mats(arrays, "metal_painted" if nm == "tram" else "sky"), {}, layer=lay)
            rec["drift"] = dict(g[1])
            rec["material"] = "metal_painted" if nm == "tram" else "sky"
        beam = render("beam", var={}, beam=True)
        kn = obj_mask(beam, ["knight"])
        diff = (beam["img"] != base["img"]) & ~kn
        write(I("window.statue-downlight", "window", "overlay", []), {"base": np.where(diff, beam["img"], T).astype(np.uint8)}, {"base": beam["mat"]}, {},
              layer=top_layer(diff) if diff.any() else 3)
        set_view("front")
        kx = int(pj(KN_X, 0, 0)[0])
        cb = (kx - 70, 150, kx + 70, 420)
        arrays = {}
        cmats = {}
        for t in range(1, 6):
            a = np.full((H, W), T, np.uint8)
            r = render(f"t{t}", var={}, tier=t)
            a[cb[1]:cb[3], cb[0]:cb[2]] = r["img"][cb[1]:cb[3], cb[0]:cb[2]]
            arrays[f"t{t}"] = a
            cmats[f"t{t}"] = r["mat"]
        write(I("window.statue-closeup", "window", "overlay", []), arrays, cmats, {"base": "t1"}, layer=6)
    zone_light = {}
    for zid, (zv, nm) in ZONE_ON.items():
        if zv != view:
            continue
        m = obj_mask(base, [nm])
        ys, xs = np.nonzero(m)
        cx, cy = int(np.median(xs)), int(np.median(ys))
        zone_light[zid] = (cx - OX, cy - OY, 24)
        arrays = {}
        for key, r in (("base", base), ("night", night)):
            a = np.full((H, W), T, np.uint8)
            a[cy:cy + 2, cx:cx + 2] = r["img"][cy:cy + 2, cx:cx + 2]
            arrays[key] = a
        write(I(zid + ".on", zid, "overlay", [], view=view), arrays, {}, {}, layer=top_layer(arrays["base"] != T))
    lit = dict(base["light"])
    lit["lightsNight"] = night["light"]["lights"]
    return base, zone_light, {"lighting": lit, "light": {"day": base["fallback"], "night": night["fallback"]}}


def export_live():
    root = os.path.join(PROTO, SPR_DIR)
    if os.path.isdir(root):
        for dp, _, fs in os.walk(root):
            for f in fs:
                if f.endswith(".png"):
                    os.remove(os.path.join(dp, f))
    manifest = []
    TAGVAR.clear()
    res = {}
    for v in VIEW_IDS:
        res[v] = export_view(v, manifest)
        print(f"  view {v}: {sum(1 for r in manifest if r.get('view') == v)} items")
    ids = [r["id"] for r in manifest]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate ids: {sorted(dup)}")
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump({"part": "room-r6", "items": manifest}, f, indent=1)
    zone_light = {}
    for v in res:
        zone_light.update(res[v][1])
    with open(os.path.join(HERE, "zones.json"), "w") as f:
        json.dump(make_zones(manifest, res, zone_light), f, indent=1)
    write_live_palette()
    kinds = {}
    for r in manifest:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"live export: {len(manifest)} items {kinds}, {len(LR.cache)} renders")
    return manifest


def write_live_palette():
    """palette.json for the bundle: the texture stream's 64-colour palette and LUTs when present."""
    p = os.path.join(HERE, "palette.json")
    if os.path.exists(p):
        return
    base = json.load(open(os.path.join(ROOT, "art", "room-r5", "palette.json")))
    base["colors"] = [[n, h] for n, h in PAL]
    with open(p, "w") as f:
        json.dump(base, f, indent=1)


ZONE_NAMES = [("kitchen", "KITCHEN"), ("bed", "BED"), ("library", "LIBRARY"), ("window", "WINDOW"), ("study", "STUDY DESK"),
              ("computer", "COMPUTER"), ("gym", "GYM")]


def make_zones(items, res, zone_light):
    AX, AY = -OX, -OY
    skills = {}
    zones = []
    CW, CH_ = CORE_BOX[2] - CORE_BOX[0], CORE_BOX[3] - CORE_BOX[1]
    for n, (zid, name) in enumerate(ZONE_NAMES, 1):
        zv = ZONE_VIEW[zid]
        hs = [i for i in items if i["zone"] == zid and i["kind"] == "hotspot" and i.get("view") == zv]
        for i in hs:
            if "skill" in i["target"]:
                skills[i["target"]["skill"]] = zid
        boxes = [(i["hit"][0], i["hit"][1], i["hit"][0] + i["hit"][2], i["hit"][1] + i["hit"][3]) for i in hs]
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        # the zone frame holds every hotspot of the zone (up to the whole core width)
        w = min(CW, max(220, (x1 - x0) + 40, min(300, ((y1 - y0) + 30) * 16 / 9)))
        h = w * 9 / 16
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fx = min(max(cx - w / 2, AX), AX + W - w)
        fy = min(max(cy - h / 2, AY), AY + H - h)
        zones.append({"id": zid, "n": n, "name": name, "view": zv, "focus": [round(fx), round(fy), round(w), round(h)],
                      "stop": round(cx), "phoneStop": round(min(max(cx, 60), CW - 60)),
                      "hotspots": [i["id"] for i in hs], "territory": {"x0": round(x0), "x1": round(x1)},
                      "light": list(zone_light.get(zid, (round(cx), round(cy), 24)))})
    for v in VIEW_IDS:
        zs = sorted([z for z in zones if z["view"] == v], key=lambda z: z["stop"])
        for a, b in zip(zs, zs[1:]):
            if a["territory"]["x1"] > b["territory"]["x0"]:
                mid = round((a["stop"] + b["stop"]) / 2)
                a["territory"]["x1"] = min(a["territory"]["x1"], mid)
                b["territory"]["x0"] = max(b["territory"]["x0"], mid)
        if zs:
            zs[0]["territory"]["x0"] = min(zs[0]["territory"]["x0"], AX)
            zs[-1]["territory"]["x1"] = max(zs[-1]["territory"]["x1"], AX + W)
    statue = next(i for i in items if i["id"] == "window.statue")
    rug_ = next(i for i in items if i["id"] == "window.rug")
    set_view("front")
    wx0, wy0, wx1, wy1 = res["front"][0]["win"]
    bt = pj(KN_X, CEIL, KN_Z)
    views = {}
    for v in VIEW_IDS:
        views[v] = {"art": {"x": AX, "y": AY, "w": W, "h": H}, "core": {"w": CW, "h": CH_},
                    "horizon": int(CY) - OY, "vp": [int(CX) - OX, int(CY) - OY], "yaw": YAW[v], "f": F,
                    "lighting": res[v][2]["lighting"], "light": res[v][2]["light"]}
    fb = int(round(CY + EYE * F / D0)) - OY
    return {
        "_note": "Art pass 6 (v3.4) world coordinates (art px): master (800x560) = world + (122, 104) in every view. One square "
                 "room, camera at its centre; the four views front, right, back, left are 90 degree faces of that camera "
                 "(f = 278 art px across the 556x352 core). views.<v>: frame (art, core, horizon, vp, yaw, f), lighting "
                 "(LIGHTING_SPEC section 8) and light (the Canvas2D fallback overlay). Keys 1-7 run kitchen..gym. "
                 "Generated by art/room-r6/build.py.",
        "art": {"x": AX, "y": AY, "w": W, "h": H},
        "core": {"w": CW, "h": CH_},
        "horizon": int(CY) - OY,
        "vp": [int(CX) - OX, int(CY) - OY],
        "camera": {"defaultZoom": 1.0, "horizonPct": round((CY - OY) / CH_, 3), "phoneDefaultX": CW // 2, "turnMs": 700,
                   "f": F, "views": list(VIEW_IDS)},
        "views": views,
        "zones": zones,
        "shell": {"window": [wx0 - OX, wy0 - OY, wx1 - OX, wy1 - OY], "sill": [wx0 - 7 - OX, wy1 + 1 - OY, wx1 + 7 - OX, wy1 + 6 - OY],
                  "floorBackY": fb, "ceilingY": int(round(CY - (CEIL - EYE) * F / D0)) - OY,
                  "room": "square 28 x 28 ft, ceiling 13.5 ft, camera at the centre, eye 6.5 ft"},
        "centre": {"statue": [statue["x"], statue["y"], statue["w"], statue["h"]], "statueContactY": statue["y"] + statue["h"],
                   "rug": [rug_["x"], rug_["y"], rug_["w"], rug_["h"]], "downlight": [int(bt[0]) - OX, max(0, int(bt[1]) - OY)],
                   "dogSleep": [560 - OX, 470 - OY], "sunbeam": "the GPU light model's sun patch"},
        "relics": {"relic-left": "kitchen.relic", "relic-window": "window.relic", "relic-right": "gym.relic"},
        "layers": {"_note": "L0 sky (+ clouds, birds), L1 outside (+ streetcar), L2 shell plates and wall pieces, L3-L5 objects by "
                            "contact depth, L5 margin plate, plant sway; view-scoped."},
        "skills": dict({"_note": "Every skill maps to exactly one zone."}, **dict(sorted(skills.items()))),
    }



if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if "--preview" in sys.argv:
        for v in VIEW_IDS:
            Image.fromarray(still(v, full="--full" in sys.argv)).save(os.path.join(OUT, f"preview-{v}.png"))
            print("preview", v)
    else:
        export_live()

