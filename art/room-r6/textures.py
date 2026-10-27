"""FORGE art pass 6: the texture library (TEXTURE_SPEC section 5, INTERFACES section 8).

Textures paint ALBEDO ONLY: no light falloff, no shadow, no rim, no reflection, no night. The lighting pipeline
(LIGHTING_SPEC) owns all of those. What is painted here is material: grain, mottle, folds, seams, wear, the small
bevels that are shape (not light), glints that mark the top of a ramp for the shader's glint response.

How the build uses it
  The build draws flat albedo and fills these master-size buffers (INTERFACES 8):
    img   uint8 (H, W)  palette index (64 colours, 255 = transparent / nothing)
    mat   uint8 (H, W)  material ID (materials.json, 0 = none)
    oid   int16 (H, W)  object id, names[oid] = object name
    surf  dict of arrays (H, W): kind uint8 (0 none, 1 wall, 2 floor, 3 ceiling, 4 object front face,
          5 object side face, 6 object top, 7 flat sprite), u, v (feet along the surface), dist (feet from camera)
    attention float32 (H, W) 0..1 (attention_mask() builds one)
  then calls apply(img, mat, surf, oid, names, attention, view, tier, seed). apply() repaints every textured
  material in place (img, and mat where a tier changes the material) and returns nothing.

Perspective. Every mark is defined in surface feet (u, v) and a pixel is part of a mark when the mark crosses
the pixel's footprint (how many feet of u and v one pixel covers, from the screen derivatives of u and v).
So a plank seam is exactly one pixel wide at every depth, grain along v converges to the vanishing point on
its own, and marks get shorter (and, by plank-width gating, sparser) with depth.

Shell surfaces (kind 1 wall, 2 floor, 3 ceiling) are WORLD consistent: every seed and mark position comes from
(seed, surface name, u, v) only, never from the view or the screen, so the same wall seen from two adjacent
views (the room is one continuous cube map) gets the same marks. Floor and ceiling: u = world X, v = world Z
(planks run along Z). Walls: u = horizontal world coordinate along that wall (-14..14), v = height Y (0..13.5).
Objects (kinds 4..7) use per-object seeds hash(seed, name, view, material) and may use screen-space detail.

Determinism: seeds come from hashlib (seed_of), noise from an integer hash; Python's hash() is never used.
Pure numpy (no scipy). Style follows art/room-r5/build.py: plain functions, comments explain intent.
"""
import hashlib
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PALETTE = json.load(open(os.path.join(HERE, "palette.json")))
MATERIALS = json.load(open(os.path.join(HERE, "materials.json")))

NAMES = [n for n, _ in PALETTE["colors"]]
N = {n: i for i, n in enumerate(NAMES)}
RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for _, h in PALETTE["colors"]], np.uint8)
T = 255                                   # transparent
RAMPS = {k: [N[c] for c in v] for k, v in PALETTE["ramps"].items()}
RAMP_OF = np.array([PALETTE["ramp_of"][n] or "" for n in NAMES] + [""] * (256 - len(NAMES)), object)
DARKER = np.arange(256, dtype=np.uint8)
BRIGHTER = np.arange(256, dtype=np.uint8)
for _n in NAMES:
    DARKER[N[_n]] = N[PALETTE["darker"][_n]]
    BRIGHTER[N[_n]] = N[PALETTE["brighter"][_n]]
MAT_ID = {m["name"]: m["id"] for m in MATERIALS["materials"]}
MAT_NAME = {m["id"]: m["name"] for m in MATERIALS["materials"]}
MAT_RAMP = {m["id"]: m["ramp"] for m in MATERIALS["materials"]}

# camera and room (INTERFACES 1); override per call with opts
F_PX = 278.0          # focal length in art px (90 degrees across the 556 px core)
HALF = 14.0           # room half size in feet (28 x 28)
CEIL = 13.5           # ceiling height
EYE = 7.0
BASE_H = 0.42         # baseboard height (ft)
WAINS_H = 3.0         # T4+ wainscot top (ft)
CROWN_H = 0.4         # T4+ crown molding depth (ft)
PLANK_W = 0.72        # floor plank width (ft), r5 floor_planks()
WORLD_OBJECTS = ("beams",)   # objects that are part of the room structure (world-consistent texture)
CEIL_PLANK_W = 0.9    # ceiling plank width between beams


def _lab_l(rgb):
    c = rgb.astype(np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    return np.where(y > 0.008856, 116 * np.cbrt(y) - 16, 903.3 * y)


LSTAR = np.full(256, np.nan)
LSTAR[:len(NAMES)] = _lab_l(RGB)


def _ramp_step_l():
    """Typical lightness step of each colour's ramp (mean adjacent L* gap); used for 'ramp steps' contrast."""
    out = np.full(256, np.nan)
    gaps = []
    for k in PALETTE["texture_ramps"]:
        r = RAMPS[k]
        g = np.abs(np.diff(LSTAR[r]))
        gaps += list(g)
        for i in r:
            if np.isnan(out[i]):
                out[i] = g.mean()
    med = float(np.median(gaps))
    out[np.isnan(out)] = med
    return out, med


RAMP_STEP_L, STEP_L = _ramp_step_l()


# ---------------------------------------------------------------- determinism: seeds and integer hashing
def seed_of(*parts):
    """Stable 63-bit seed from any parts (sha256 of their text). Never Python's hash()."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:8], "little") & 0x7FFFFFFFFFFFFFFF


def rng(*parts):
    return np.random.Generator(np.random.PCG64(seed_of(*parts)))


_K1 = np.uint64(0xBF58476D1CE4E5B9)
_K2 = np.uint64(0x94D049BB133111EB)
_GOLD = np.uint64(0x9E3779B97F4A7C15)


def _mix(x):
    x = (x ^ (x >> np.uint64(30))) * _K1
    x = (x ^ (x >> np.uint64(27))) * _K2
    return x ^ (x >> np.uint64(31))


def hash_u(seed, *keys):
    """Uniform [0, 1) per element from integer keys (broadcast), splitmix64 based."""
    with np.errstate(over="ignore"):
        arrs = np.broadcast_arrays(*[np.asarray(k) for k in keys]) if keys else [np.zeros(())]
        x = np.full(arrs[0].shape, np.uint64(seed & 0xFFFFFFFFFFFFFFFF), np.uint64)
        for a in arrs:
            x = _mix(x ^ (np.asarray(a).astype(np.int64).astype(np.uint64) + _GOLD))
        return (x >> np.uint64(11)).astype(np.float64) / float(1 << 53)


def value_noise(u, v, scale, seed, octaves=2):
    """Smooth 2D value noise on surface coordinates (feet), 0..1, fractal (octaves halve the scale)."""
    tot = np.zeros(np.shape(u))
    norm = 0.0
    amp = 1.0
    sc = float(scale)
    for o in range(octaves):
        x = np.asarray(u) / sc
        y = np.asarray(v) / sc
        xi = np.floor(x)
        yi = np.floor(y)
        fx = x - xi
        fy = y - yi
        sx = fx * fx * (3 - 2 * fx)
        sy = fy * fy * (3 - 2 * fy)
        s = seed + 7919 * o
        a = hash_u(s, xi, yi)
        b = hash_u(s, xi + 1, yi)
        c = hash_u(s, xi, yi + 1)
        d = hash_u(s, xi + 1, yi + 1)
        tot += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy)
        norm += amp
        amp *= 0.5
        sc *= 0.5
    return tot / norm


_NQ = {}


def noise_q(q, octaves=2):
    """Fixed quantile of value_noise's distribution (world-consistent thresholds: never per region)."""
    if octaves not in _NQ:
        g = np.mgrid[0:400, 0:400].astype(np.float64) * 0.173
        _NQ[octaves] = np.sort(value_noise(g[1], g[0], 1.0, 4242, octaves).ravel())
    s = _NQ[octaves]
    return float(s[min(len(s) - 1, int(q * len(s)))])


# ---------------------------------------------------------------- shade shifts along ramps
_LUTS = {}


def shift_lut(ramp, k):
    """256-entry LUT: each colour k steps along `ramp` (a ramp name), or along its own ramp when it is not
    in that ramp (book colours on a 'book_cloth' object, poster art). Clamped at the ramp ends."""
    key = (ramp, k)
    if key in _LUTS:
        return _LUTS[key]
    lut = np.arange(256, dtype=np.uint8)
    for i in range(len(NAMES)):
        r = RAMPS.get(ramp) if ramp else None
        if not r or i not in r:
            rn = RAMP_OF[i]
            r = RAMPS.get(rn)
        if not r or i not in r:
            j = i
            for _ in range(abs(k)):
                j = int(DARKER[j] if k < 0 else BRIGHTER[j])
            lut[i] = j
            continue
        p = r.index(i)
        lut[i] = r[max(0, min(len(r) - 1, p + k))]
    _LUTS[key] = lut
    return lut


def shift(c, off, ramp=None):
    """Colours c moved by integer offsets off (array) along the ramp."""
    out = c.copy()
    off = np.asarray(off)
    for k in np.unique(off):
        if k == 0:
            continue
        sel = off == k
        out[sel] = shift_lut(ramp, int(k))[c[sel]]
    return out


def ramp_top(c, ramp=None):
    """Top shade of each colour's ramp (glint pixels: the shader flashes the top of a ramp)."""
    return shift_lut(ramp, 9)[c]


# ---------------------------------------------------------------- small array helpers
def nbr(a, dy, dx, fill):
    """a shifted so out[y, x] = a[y + dy, x + dx] (fill outside)."""
    H, W = a.shape
    out = np.full_like(a, fill)
    ys0, ys1 = max(0, -dy), min(H, H - dy)
    xs0, xs1 = max(0, -dx), min(W, W - dx)
    out[ys0:ys1, xs0:xs1] = a[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
    return out


def edges(m):
    """(up, down, left, right): pixels of m whose neighbour in that direction is outside m."""
    return (m & ~nbr(m, -1, 0, False), m & ~nbr(m, 1, 0, False),
            m & ~nbr(m, 0, -1, False), m & ~nbr(m, 0, 1, False))


def dilate(m, r=1):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy or dx:
                out |= nbr(m, dy, dx, False)
    return out


def components(m):
    """4-connected components of a boolean mask (run-based union-find). Returns (labels, count); 0 = none."""
    H, W = m.shape
    lab = np.zeros((H, W), np.int32)
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    prev = []
    for y in range(H):
        row = m[y]
        if not row.any():
            prev = []
            continue
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        starts = np.nonzero(d == 1)[0]
        ends = np.nonzero(d == -1)[0]
        cur = []
        j = 0
        for s, e in zip(starts, ends):
            l = len(parent)
            parent.append(l)
            while j < len(prev) and prev[j][1] <= s:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < e:
                a, b = find(prev[k][2]), find(l)
                if a != b:
                    parent[max(a, b)] = min(a, b)
                k += 1
            lab[y, s:e] = l
            cur.append((s, e, l))
        prev = cur
    roots = np.array([find(i) for i in range(len(parent))], np.int32)
    uniq, inv = np.unique(roots, return_inverse=True)
    lab = inv.astype(np.int32)[lab]
    if uniq[0] != 0:
        lab += 1
    return lab, int(lab.max())


def line4(x0, y0, x1, y1):
    """Pixels of a 4-connected line (a diagonal step adds a corner pixel, so no pixel is left with only
    diagonal neighbours: texture is clusters, not lone pixels)."""
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    pts = [(x0, y0)]
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x1 > x0 else -1), (1 if y1 > y0 else -1)
    err = dx - dy
    x, y = x0, y0
    while (x, y) != (x1, y1):
        e2 = 2 * err
        if e2 > -dy and e2 < dx:
            # diagonal: take the x step first, then y (adds the corner pixel)
            err -= dy
            x += sx
            pts.append((x, y))
            err += dx
            y += sy
        elif e2 > -dy:
            err -= dy
            x += sx
        else:
            err += dx
            y += sy
        pts.append((x, y))
    return pts


def despeckle(c, m, protect=None, passes=2):
    """Replace isolated pixels (all 4 neighbours a different colour) inside m with their most common
    neighbour colour. Used on objects only (shell textures are built cluster-safe in u, v)."""
    for _ in range(passes):
        nb = [nbr(c, dy, dx, 255) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))]
        same = np.zeros_like(m)
        for a in nb:
            same |= a == c
        iso = m & ~same
        if protect is not None:
            iso &= ~protect
        if not iso.any():
            return c
        ys, xs = np.nonzero(iso)
        for y, x in zip(ys, xs):
            vals = [int(a[y, x]) for a in nb if a[y, x] != 255 and m[min(max(y, 0), m.shape[0] - 1), x]]
            vals = [v for v in vals if v != 255]
            if vals:
                c[y, x] = max(set(vals), key=lambda q: (vals.count(q), -q))
    return c


# ---------------------------------------------------------------- context and regions
class Ctx:
    """Everything one apply() call needs: buffers, footprints and options."""

    def __init__(self, img, mat, surf, oid, names, attention, view, tier, seed, opts):
        self.img, self.mat, self.oid, self.names = img, mat, oid, names or {}
        self.H, self.W = img.shape
        self.view = view
        self.tier = int(max(1, min(5, tier)))
        self.seed = int(seed)
        self.opts = opts or {}
        self.half = float(self.opts.get("room_half", HALF))
        self.ceil = float(self.opts.get("ceil", CEIL))
        self.f_px = float(self.opts.get("f_px", F_PX))
        self.kind = np.asarray(surf["kind"]).astype(np.uint8)
        self.u = np.asarray(surf["u"], np.float64)
        self.v = np.asarray(surf["v"], np.float64)
        d = surf.get("dist")
        self.dist = np.asarray(d, np.float64) if d is not None else np.full(img.shape, 14.0)
        self.att = (np.ones(img.shape, np.float64) if attention is None
                    else np.clip(np.asarray(attention, np.float64), 0, 1))
        key = oid.astype(np.int64) * 16 + self.kind
        fb = np.maximum(self.dist, 0.5) / self.f_px          # feet per px of a face-on surface
        self.ux, self.uy = _derivs(self.u, key, fb)
        self.vx, self.vy = _derivs(self.v, key, fb)

    def window_sign(self, cx):
        """+1 when the window (opts['window_px'] = (x, y) in master px for this view) is to the right of cx."""
        w = self.opts.get("window_px")
        if not w:
            return 1
        return 1 if w[0] >= cx else -1


def _derivs(a, key, fb):
    """Screen derivatives of a surface coordinate, using only neighbours on the same surface (oid + kind).
    Pixels with no same-surface neighbour fall back to the face-on footprint dist / f."""
    out = []
    for axis in (1, 0):
        d = np.full(a.shape, np.nan)
        if axis == 1:
            f = a[:, 1:] - a[:, :-1]
            ok = key[:, 1:] == key[:, :-1]
            fw = np.where(ok, f, np.nan)
            d[:, :-1] = fw
            bw = np.full(a.shape, np.nan)
            bw[:, 1:] = fw
        else:
            f = a[1:, :] - a[:-1, :]
            ok = key[1:, :] == key[:-1, :]
            fw = np.where(ok, f, np.nan)
            d[:-1, :] = fw
            bw = np.full(a.shape, np.nan)
            bw[1:, :] = fw
        d = np.where(np.isnan(d), bw, d)
        # a jump far larger than the face-on footprint is a fold between faces, not a gradient
        d = np.where(np.abs(d) > 40 * fb, np.nan, d)
        out.append(d)
    dx, dy = out
    both = np.isnan(dx) & np.isnan(dy)
    dx = np.where(both, fb, np.nan_to_num(dx))
    dy = np.nan_to_num(dy)
    return dx, dy


class Region:
    """One (object, material) region as dense arrays over its bounding box. Handlers edit .c (colours),
    .mat_out (material IDs) and commit() writes back only the region's own pixels."""

    def __init__(self, ctx, m_full, oid, matid):
        ys, xs = np.nonzero(m_full)
        self.y0, self.y1, self.x0, self.x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sl = (slice(self.y0, self.y1), slice(self.x0, self.x1))
        self.sl = sl
        self.ctx = ctx
        self.m = m_full[sl]
        self.base = ctx.img[sl].copy()
        self.c = self.base.copy()
        self.mat_out = ctx.mat[sl].copy()
        for k in ("u", "v", "kind", "dist", "att", "ux", "uy", "vx", "vy"):
            setattr(self, k, getattr(ctx, k)[sl])
        self.fu = np.maximum(np.abs(self.ux) + np.abs(self.uy), 1e-4)
        self.fv = np.maximum(np.abs(self.vx) + np.abs(self.vy), 1e-4)
        self.yy, self.xx = np.mgrid[self.y0:self.y1, self.x0:self.x1]
        self.oid = int(oid)
        self.matid = int(matid)
        self.name = str(ctx.names.get(int(oid), "obj%d" % oid))
        kinds = self.kind[self.m]
        self.kmode = int(np.bincount(kinds, minlength=8).argmax()) if kinds.size else 0
        # shell: the room's surfaces, plus world structure drawn as objects in every view (the ceiling beams):
        # world seeds and u, v marks only, so adjacent views match
        world = set(ctx.opts.get("world_objects", WORLD_OBJECTS))
        self.shell = self.kmode in (1, 2, 3) or self.name in world or matid == 5
        # shell: world seed (no view); objects: per object, view and material (TEXTURE_SPEC 5)
        if self.shell:
            self.seed = seed_of(ctx.seed, self.name, MAT_NAME.get(matid, matid))
        else:
            self.seed = seed_of(ctx.seed, self.name, ctx.view, MAT_NAME.get(matid, matid))
        vals = self.base[self.m]
        self.dom = int(np.bincount(vals, minlength=256).argmax()) if vals.size else 0

    def commit(self):
        img = self.ctx.img[self.sl]
        mat = self.ctx.mat[self.sl]
        img[self.m] = self.c[self.m]
        mat[self.m] = self.mat_out[self.m]

    # perspective mark primitives (u, v in feet; one pixel = its footprint)
    def seg(self, p0, p1, w=1.0, off=0.0, sel=None):
        """Pixels on the surface segment p0 -> p1 (u, v feet), w pixels wide, offset `off` pixels to the
        segment's left normal. Never shorter than ~2 px: the ends extend by one footprint."""
        (u0, v0), (u1, v1) = p0, p1
        du, dv = u1 - u0, v1 - v0
        ln = math.hypot(du, dv) or 1e-6
        tu, tv = du / ln, dv / ln
        nu, nv = -tv, tu
        s = (self.u - u0) * nu + (self.v - v0) * nv
        t = (self.u - u0) * tu + (self.v - v0) * tv
        fs = np.abs(nu * self.ux + nv * self.vx) + np.abs(nu * self.uy + nv * self.vy)
        ft = np.abs(tu * self.ux + tv * self.vx) + np.abs(tu * self.uy + tv * self.vy)
        fs = np.maximum(fs, 1e-4)
        ft = np.maximum(ft, 1e-4)
        ext = np.maximum(ft * 0.5, (2 * ft - ln) * 0.5)
        hit = (np.abs(s - off * fs) < w * fs * 0.5) & (t >= -ext) & (t <= ln + ext) & self.m
        if sel is not None:
            hit &= sel
        return hit

    def dot(self, pu, pv, size=0.0):
        """Pixel(s) covering the surface point (pu, pv); size in feet grows it (at least one pixel)."""
        return (np.abs(self.u - pu) < np.maximum(self.fu * 0.5, size * 0.5)) & \
               (np.abs(self.v - pv) < np.maximum(self.fv * 0.5, size * 0.5)) & self.m

    def att_mean(self, hit):
        return float(self.att[hit].mean()) if hit.any() else 0.0


def surface_seed(seed, name):
    """Public: the world seed a shell surface uses (same in every view)."""
    return seed_of(seed, name)


# ---------------------------------------------------------------- 5.1 plaster walls
def tex_plaster(ctx, R):
    s = R.seed
    tier = ctx.tier
    U, V = R.u, R.v
    m = R.m
    wall = m & (R.kind == 1)
    half, ceil = ctx.half, ctx.ceil
    board = wall & (V < BASE_H)
    wains = wall & (V < WAINS_H) & ~board if tier >= 4 else np.zeros_like(m)
    crown = wall & (V > ceil - CROWN_H) if tier >= 4 else np.zeros_like(m)
    field = m & ~board & ~wains & ~crown
    off = np.zeros(m.shape, np.int8)
    marks = {}                                     # absolute colour -> mask (painted last, in order)

    # meso mottle (TEXTURE_SPEC 5.1: scale 18..30 px = ~1.2 ft at a wall face-on; 15 / 70 / 15 split)
    if tier >= 5:
        # Venetian plaster: long trowel clouds, 4 shades, smooth (sheen comes from the material's gloss)
        n = value_noise(U * 0.55, V * 1.4, 1.6, s + 1, 3)
        off[n < noise_q(0.08, 3)] = -1
        off[n > noise_q(0.68, 3)] = 1
        off[n > noise_q(0.93, 3)] = 2
    else:
        n = value_noise(U, V, 1.25, s + 1, 3)
        lo, hi = (0.15, 0.85) if tier <= 2 else (0.12, 0.85)
        off[n < noise_q(lo, 3)] = -1
        off[n > noise_q(hi, 3)] = 1
        if tier >= 3:
            # fully painted: no patches, so the lightest mottle peaks are sanded spots one more step up
            off[n > noise_q(0.97, 3)] = 2

    # macro patches: repainted / patched areas one shade lighter, stepped irregular edges (T1 old patches,
    # T2 fresh paint patches, T3+ fully painted). Positions are world positions on this wall.
    r = rng(s, "patch")
    npatch = {1: r.integers(2, 5), 2: r.integers(3, 5)}.get(tier, 0)
    patch = np.zeros(m.shape, bool)
    Uq = np.floor(U / 0.18) * 0.18
    Vq = np.floor(V / 0.18) * 0.18
    for i in range(int(npatch)):
        cu, cv = r.uniform(-half + 2, half - 2), r.uniform(2.5, ceil - 2.5)
        ru, rv = r.uniform(1.0, 3.0), r.uniform(0.8, 2.2)
        d = ((Uq - cu) / ru) ** 2 + ((Vq - cv) / rv) ** 2 + 0.7 * (value_noise(Uq, Vq, 0.9, s + 50 + i) - 0.5)
        patch |= d < 1.0
    # micro stipple: small 3..10 px clusters one shade either side on the base mottle (the references' wall
    # speckle, as clusters, not lone pixels); a micro detail, so its density follows the attention mask
    fine = value_noise(U, V, 0.3, s + 2, 2)
    k = 0.06 + 0.06 * R.att
    lo_t = np.interp(k, [0.0, 0.2], [noise_q(0.0), noise_q(0.2)])
    hi_t = np.interp(1 - k, [0.8, 1.0], [noise_q(0.8), noise_q(0.999)])
    calm0 = off == 0
    off[calm0 & (fine > hi_t)] = 1
    off[calm0 & (fine < lo_t)] = -1
    off[patch & field] += 1
    off = np.clip(off, -1, 2)
    calm = field & (off == 0) & ~dilate(patch, 2) | (field & (off == 0) & patch & ~dilate(~patch, 2))

    # micro: hairline cracks (T1 6, T2 3, T3 1, T4 1, T5 none), from the ceiling line, the corners or free
    ncrack = [6, 3, 1, 1, 0][tier - 1]
    r = rng(s, "crack")
    crack = np.zeros(m.shape, bool)
    lip = np.zeros(m.shape, bool)
    lip_side = ctx.opts.get("crack_lip", {}).get(R.name, 1)   # +1: lip on the +u side (window side)
    for i in range(ncrack):
        start = r.choice(["ceil", "left", "right", "free"], p=[0.4, 0.2, 0.2, 0.2])
        if start == "ceil":
            p = (r.uniform(-half + 1, half - 1), ceil - 0.02)
            ang = -math.pi / 2 + r.uniform(-0.6, 0.6)
        elif start == "left":
            p = (-half + 0.02, r.uniform(4.0, ceil - 1.5))
            ang = r.uniform(-0.7, 0.3)
        elif start == "right":
            p = (half - 0.02, r.uniform(4.0, ceil - 1.5))
            ang = math.pi + r.uniform(-0.3, 0.7)
        else:
            p = (r.uniform(-half + 2, half - 2), r.uniform(5.0, ceil - 1.0))
            ang = r.uniform(0, 2 * math.pi)
        pts = [p]
        for _ in range(int(r.integers(2, 4))):
            ln = r.uniform(0.3, 0.75)
            ang += r.uniform(-0.7, 0.7)
            q = pts[-1]
            pts.append((q[0] + ln * math.cos(ang), q[1] + ln * math.sin(ang)))
        segs = list(zip(pts[:-1], pts[1:]))
        if r.random() < 0.5 and len(pts) > 2:
            b = pts[1]
            a2 = ang + r.choice([-1, 1]) * r.uniform(0.8, 1.3)
            ln = r.uniform(0.25, 0.5)
            segs.append((b, (b[0] + ln * math.cos(a2), b[1] + ln * math.sin(a2))))
        keep_h = r.random()
        one = np.zeros(m.shape, bool)
        one_lip = np.zeros(m.shape, bool)
        for j, (a, b) in enumerate(segs):
            one |= R.seg(a, b, sel=field)
            if j % 2 == 0:
                # lip: the next pixel over on the window side (left normal points to +u for a downward seg)
                du = b[0] - a[0]
                dvv = b[1] - a[1]
                side = lip_side if (-dvv) >= 0 else -lip_side
                if abs(dvv) < 1e-9 and abs(du) > 0:
                    side = 1
                one_lip |= R.seg(a, b, off=side, sel=field)
        if one.any() and keep_h < 0.25 + 0.85 * R.att_mean(one):
            crack |= one
            lip |= one_lip
    lip &= ~crack

    # specks: single PLASTER_0 / PLASTER_3 pixels, under 1.5% of the area, on calm (base) plaster only
    cell = 0.32
    ci = np.floor(U / cell)
    cj = np.floor(V / cell)
    h = hash_u(s + 3, ci, cj)
    pu = (ci + 0.15 + 0.7 * hash_u(s + 4, ci, cj)) * cell
    pv = (cj + 0.15 + 0.7 * hash_u(s + 5, ci, cj)) * cell
    sp = (h < 0.16 * R.att) & (np.abs(U - pu) < R.fu * 0.5) & (np.abs(V - pv) < R.fv * 0.5) & calm & ~crack & ~lip
    sp &= ~nbr(crack, 0, 1, False) & ~nbr(crack, 0, -1, False)
    dark_sp = sp & (hash_u(s + 6, ci, cj) < 0.6)

    # wear: scuff band at chair / desk height (2.4..3.4 ft), short horizontal PLASTER_1 streaks
    nsc = [12, 6, 2, 0, 0][tier - 1]
    r = rng(s, "scuff")
    scuff = np.zeros(m.shape, bool)
    for i in range(nsc):
        a = (r.uniform(-half + 0.5, half - 0.5), r.uniform(2.4, 3.4))
        ln = r.uniform(0.18, 0.5)
        hk = r.random()
        one = R.seg(a, (a[0] + ln, a[1] + r.uniform(-0.03, 0.03)), sel=field & (off <= 0))
        if one.any() and hk < 0.3 + 0.8 * R.att_mean(one):
            scuff |= one
    # tape marks where posters used to hang (T1..T2) and nail holes (INK with a PLASTER_3 pixel under)
    tape = np.zeros(m.shape, bool)
    nail = np.zeros(m.shape, bool)
    nail_lip = np.zeros(m.shape, bool)
    r = rng(s, "tape")
    for i in range([2, 1, 0, 0, 0][tier - 1]):
        cu, cv = r.uniform(-half + 2, half - 2), r.uniform(5.0, 9.0)
        w, hh = r.uniform(1.2, 2.6), r.uniform(1.6, 2.8)
        for du, dv in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            tape |= R.dot(cu + du * w / 2, cv + dv * hh / 2, 0.11) & field
    for i in range([4, 2, 1, 0, 0][tier - 1]):
        pu_, pv_ = r.uniform(-half + 1, half - 1), r.uniform(4.0, 10.0)
        d = R.dot(pu_, pv_) & field
        nail |= d
        nail_lip |= nbr(d, -1, 0, False) & field & ~d

    R.c = np.where(field, shift(R.base, off, "plaster"), R.c)
    for col, mk in (("PLASTER_1", scuff), ("PLASTER_3", tape), ("PLASTER_0", crack), ("PLASTER_3", lip),
                    ("PLASTER_0", dark_sp), ("PLASTER_3", sp & ~dark_sp), ("INK", nail), ("PLASTER_3", nail_lip)):
        R.c[mk] = N[col]
    if tier >= 5:
        R.mat_out[field] = MAT_ID["plaster_venetian"]
    # wood parts of the wall (baseboard always; wainscot and crown from T4)
    _baseboard(ctx, R, board)
    if wains.any():
        _wainscot(ctx, R, wains)
    if crown.any():
        _crown(ctx, R, crown)


def _rows_below(R, edge, sel):
    """Pixel row index (0 = first pixel) counted downward from the surface line v = edge."""
    return np.where(sel, np.floor((edge - R.v) / R.fv), -1).astype(np.int64)


def _baseboard(ctx, R, sel, top=BASE_H):
    """Baseboard: oak, 1 px OAK_VD gap line at the wall, 1 px OAK_3 top lip, sparse horizontal grain."""
    if not sel.any():
        return
    k = _rows_below(R, top, sel)
    c = np.full(R.c.shape, N["OAK_0"], np.uint8)
    lane = np.floor(R.v / 0.1)
    cell = np.floor(R.u / 1.4)
    h = hash_u(R.seed + 11, lane, cell)
    a = hash_u(R.seed + 12, lane, cell) * 0.7
    lu = R.u / 1.4 - cell
    grain = (h < 0.35 * (0.4 + R.att)) & (lu > a) & (lu < a + 0.55) & \
            (np.abs(R.v - (lane + 0.5) * 0.1) < R.fv * 0.5) & (k >= 3)
    c[grain] = N["OAK_DK"]
    c[k == 0] = N["OAK_VD"]
    c[k == 1] = N["OAK_3"]
    R.c[sel] = c[sel]
    R.mat_out[sel] = MAT_ID["wood_furniture"]


def _wainscot(ctx, R, sel):
    """T4+ lower wall: oak panelling (rails, stiles, inset panels with vertical grain), wood_furniture."""
    U, V = R.u, R.v
    c = np.full(R.c.shape, N["OAK_1"], np.uint8)
    pitch = 2.4
    j = np.floor((U + 0.11) / pitch)
    lu = (U + 0.11) - j * pitch                         # 0..pitch, stile at 0..0.22
    stile = lu < 0.22
    rail = (V > WAINS_H - 0.42) | (V < BASE_H + 0.22)
    panel = ~stile & ~rail
    # panel: OAK_0 with sparse vertical grain, a 1 px OAK_DK construction line around it
    c[panel] = N["OAK_0"]
    gl = np.floor(U / 0.16)
    gh = hash_u(R.seed + 21, gl, j)
    vg = panel & (gh < 0.28 * (0.4 + R.att)) & (np.abs(U - (gl + 0.5) * 0.16) < R.fu * 0.5) & \
        (np.abs(V - (0.9 + 1.2 * hash_u(R.seed + 22, gl, j))) < 0.45 + 0.2 * hash_u(R.seed + 23, gl))
    c[vg] = N["OAK_DK"]
    inner = panel & (~nbr(panel, -1, 0, True) | ~nbr(panel, 1, 0, True) |
                     ~nbr(panel, 0, -1, True) | ~nbr(panel, 0, 1, True))
    c[inner] = N["OAK_DK"]
    # cap rail: gap line at the wall, then the lip
    k = _rows_below(R, WAINS_H, sel)
    c[k == 0] = N["OAK_VD"]
    c[k == 1] = N["OAK_3"]
    R.c[sel] = c[sel]
    R.mat_out[sel] = MAT_ID["wood_furniture"]


def _crown(ctx, R, sel):
    """T4+ crown molding under the ceiling line: three oak steps."""
    k = _rows_below(R, ctx.ceil, sel)
    c = np.full(R.c.shape, N["OAK_1"], np.uint8)
    c[k == 0] = N["OAK_DK"]
    c[k == 1] = N["OAK_2"]
    depth = np.floor(CROWN_H / R.fv)
    c[(k == np.maximum(depth - 1, 3))] = N["OAK_0"]
    R.c[sel] = c[sel]
    R.mat_out[sel] = MAT_ID["wood_furniture"]


# ---------------------------------------------------------------- 5.2 wood floor
FLOOR_TONES = {   # per-plank base tone weights by room tier (TEXTURE_SPEC 5.2 and section 6)
    1: [("OAK_0", 45), ("OAK_1", 25), ("OAK_DK", 20), ("OAK_2", 10)],
    2: [("OAK_0", 45), ("OAK_1", 25), ("OAK_DK", 20), ("OAK_2", 10)],
    3: [("OAK_0", 55), ("OAK_1", 30), ("OAK_2", 10), ("OAK_DK", 5)],
    4: [("OAK_0", 55), ("OAK_1", 30), ("OAK_2", 10), ("OAK_DK", 5)],
    5: [("OAK_0", 45), ("OAK_1", 30), ("OAK_2", 20), ("OAK_DK", 5)],
}
# default walking lines (world X, Z feet): camera spot to the window wall, the four desks / doors, a loop
WEAR_PATHS = [[(0.0, -9.0), (0.0, 0.0), (0.0, 9.5)], [(-9.5, 0.0), (0.0, 0.0), (9.5, 0.0)],
              [(0.0, 3.0), (6.0, 7.5)], [(0.0, -3.0), (-6.0, -7.0)]]


def _plank_raw(s, p, sidx, tier):
    w = FLOOR_TONES[tier]
    tot = sum(x for _, x in w)
    h = hash_u(s + 31, p, sidx) * tot
    out = np.full(np.shape(h), N[w[-1][0]], np.int64)
    acc = 0
    for name, x in reversed(w[:-1]):
        pass
    acc = 0
    res = np.zeros(np.shape(h), np.int64)
    done = np.zeros(np.shape(h), bool)
    for name, x in w:
        acc += x
        sel = ~done & (h < acc)
        res[sel] = N[name]
        done |= sel
    res[~done] = out[~done]
    return res


def _plank_geom(s, U, V):
    p = np.floor(U / PLANK_W)
    Lp = 4.0 + 4.0 * hash_u(s + 1, p)
    offp = hash_u(s + 2, p) * Lp
    w = (V + offp) / Lp
    sidx = np.floor(w)
    return p, Lp, w - sidx, sidx


def _wear_mask(ctx, R, s):
    paths = ctx.opts.get("wear_paths", WEAR_PATHS)
    if ctx.tier >= 3 or not paths:
        return np.zeros(R.m.shape, bool)
    width = 1.0 if ctx.tier == 1 else 0.5
    d = np.full(R.m.shape, 1e9)
    for path in paths:
        for (u0, v0), (u1, v1) in zip(path[:-1], path[1:]):
            du, dv = u1 - u0, v1 - v0
            L2 = du * du + dv * dv or 1e-9
            t = np.clip(((R.u - u0) * du + (R.v - v0) * dv) / L2, 0, 1)
            d = np.minimum(d, np.hypot(R.u - (u0 + t * du), R.v - (v0 + t * dv)))
    n = value_noise(R.u, R.v, 1.5, s + 40)
    return R.m & (d < width * (0.6 + 0.8 * n))


def tex_floor(ctx, R):
    s = R.seed
    tier = ctx.tier
    U, V = R.u, R.v
    m = R.m
    p, Lp, lv, sidx = _plank_geom(s, U, V)
    lu = U / PLANK_W - p
    # per-segment tone; no two neighbours equal (left / right plank at this depth, previous / next segment)
    t0 = _plank_raw(s, p, sidx, tier)
    nb = []
    for dp in (-1, 1):
        pn = p + dp
        Ln = 4.0 + 4.0 * hash_u(s + 1, pn)
        on = hash_u(s + 2, pn) * Ln
        nb.append(_plank_raw(s, pn, np.floor((V + on) / Ln), tier))
    nb.append(_plank_raw(s, p, sidx - 1, tier))
    nb.append(_plank_raw(s, p, sidx + 1, tier))
    order = [N[n] for n, _ in sorted(FLOOR_TONES[tier], key=lambda t: -t[1])]
    tone = t0.copy()
    clash = np.zeros(m.shape, bool)
    for a in nb:
        clash |= a == t0
    if clash.any():
        start = (hash_u(s + 33, p, sidx) * len(order)).astype(int)
        fixed = np.full(m.shape, -1, np.int64)
        for k in range(len(order)):
            cand = np.array(order)[(start + k) % len(order)]
            ok = (fixed < 0) & clash
            for a in nb:
                ok &= cand != a
            fixed[ok] = cand[ok]
        tone = np.where(clash & (fixed >= 0), fixed, t0)
    wear = _wear_mask(ctx, R, s)
    tone_w = np.where(wear, shift(tone.astype(np.uint8), 1, "oak"), tone).astype(np.uint8)

    fu, fv = R.fu, R.fv
    pw_px = PLANK_W / fu                                    # plank width in pixels here
    # far planks: under 3 px wide a seam on every plank turns into a checkerboard, so far away only every
    # other long seam is drawn, and none under 1.6 px (the planks read as one surface at that distance)
    pidx = p.astype(np.int64)
    show_l = (pw_px >= 3.0) | ((pw_px >= 1.6) & (pidx % 2 == 0))
    seam_l = (np.minimum(lu, 1 - lu) * PLANK_W < fu * 0.5) & show_l
    seam_e = (np.minimum(lv, 1 - lv) * Lp < fv * 0.5) & (pw_px >= 1.6)
    seam = (seam_l | seam_e) & m

    # grain strokes along v (toward the vanishing point): 2..4 per segment, slots >= 2 px apart
    slots = np.array([0.22, 0.40, 0.60, 0.78, 0.31, 0.69])
    nstr = 2 + np.floor(hash_u(s + 34, p, sidx) * 3)
    gdark = np.zeros(m.shape, bool)
    # knot (about 1 per 6 segments): OAK_DK ellipse, OAK_VD core; strokes nearby bend around it
    kh = hash_u(s + 35, p, sidx)
    ku = 0.3 + 0.4 * hash_u(s + 36, p, sidx)
    kv = 0.25 + 0.5 * hash_u(s + 37, p, sidx)
    ru, rv = 0.06, 0.10
    knot_on = (kh < (1 / 6) * (0.5 + 0.5 * R.att)) & (ru / fu >= 1.0)
    ke = ((lu - ku) * PLANK_W / ru) ** 2 + ((lv - kv) * Lp / rv) ** 2
    knot = knot_on & (ke < 1.0) & m & ~seam
    core = knot & (ke < 0.3)
    for j, sp in enumerate(slots):
        # which slots exist at this plank width (sparser with depth, >= 2 px between strokes)
        if j in (1, 2):
            avail = pw_px >= 9
        elif j >= 4:
            avail = pw_px >= 34                       # wide near planks: extra long strokes between slots
        else:
            avail = pw_px >= 5.5
        use = avail & (hash_u(s + 40 + j, p, sidx) < (nstr + 1) / 4.0)
        use &= hash_u(s + 50 + j, p, sidx) < (0.35 + 0.65 * R.att) * np.where(wear, 0.5, 1.0)
        ln = 0.3 + 0.4 * hash_u(s + 60 + j, p, sidx)
        a0 = hash_u(s + 70 + j, p, sidx) * (1 - ln)
        # bend around a knot: within ~3 px laterally, push the stroke out by the knot's half width
        dist_k = (sp - ku) * PLANK_W
        near = knot_on & (np.abs(dist_k) < ru + 3 * fu)
        bend = np.where(near, np.sign(dist_k + 1e-9) * (ru + fu) * np.exp(-((lv - kv) * Lp / (rv * 2.5)) ** 2), 0.0)
        pos = sp * PLANK_W + bend
        on = use & (np.abs(lu * PLANK_W - pos) < fu * 0.5) & (lv >= a0) & (lv <= a0 + ln)
        gdark |= on
    # near the camera planks get a second, shorter stroke family
    for j, sp in enumerate((0.5,)):
        use = (pw_px >= 30) & (hash_u(s + 80 + j, p, sidx) < 0.85 * R.att) & ~wear
        ln = 0.10 + 0.08 * hash_u(s + 82 + j, p, sidx)
        a0 = hash_u(s + 84 + j, p, sidx) * (1 - ln)
        gdark |= use & (np.abs(lu - sp) * PLANK_W < fu * 0.5) & (lv >= a0) & (lv <= a0 + ln)
    gdark &= m & ~seam & ~knot

    # worn edges: an OAK_3 run of 2..5 px on the far side of 1 in 4 seams (the seam glow reads these)
    worn = np.zeros(m.shape, bool)
    if tier <= 4:
        we = (hash_u(s + 90, p, sidx) < 0.25) & (pw_px >= 10)
        run = (2 + np.floor(hash_u(s + 91, p, sidx) * 4)) * fu / PLANK_W
        a0 = 0.2 + 0.4 * hash_u(s + 92, p, sidx)
        past = (lv * Lp >= fv * 0.5) & (lv * Lp < fv * 1.5)              # first pixel past the end joint
        worn |= we & past & (lu > a0) & (lu < a0 + run)
        wl = (hash_u(s + 93, p, sidx) < 0.25) & (pw_px >= 10)
        runv = (2 + np.floor(hash_u(s + 94, p, sidx) * 4)) * fv / Lp
        b0 = 0.2 + 0.5 * hash_u(s + 95, p, sidx)
        side = (lu * PLANK_W >= fu * 0.5) & (lu * PLANK_W < fu * 1.5)
        worn |= wl & side & (lv > b0) & (lv < b0 + runv)
        worn &= m & ~seam & ~gdark & ~knot

    c = tone_w.copy()
    on_dk = tone_w == N["OAK_DK"]
    g = np.where(on_dk, shift(tone_w, 1, "oak"), shift(tone_w, -1, "oak"))
    c[gdark] = g[gdark]
    c[knot] = N["OAK_DK"]
    c[core] = N["OAK_VD"]
    c[knot & on_dk & ~core] = N["OAK_0"]                  # a knot on a dark plank reads lighter
    c[worn] = N["OAK_3"]
    c[seam] = N["OAK_VD"]

    # T4+: border inlay along the walls (dark band with a light inlay stripe)
    if tier >= 4:
        half = ctx.half
        du, dv = half - np.abs(U), half - np.abs(V)
        dw = np.minimum(du, dv)
        fa = np.where(du < dv, fu, fv)
        band = m & (dw < PLANK_W)
        c[band] = N["OAK_DK"]
        c[band & (np.abs(dw - PLANK_W * 0.5) < fa * 0.5)] = N["OAK_2"]
        c[band & (np.abs(dw - PLANK_W) < fa * 0.5 + 1e-9)] = N["OAK_VD"]
        c[m & (np.abs(dw - PLANK_W) < fa * 0.5)] = N["OAK_VD"]
    R.c[m] = c[m]


# ---------------------------------------------------------------- 5.3 ceiling
def tex_ceiling(ctx, R):
    s = R.seed
    tier = ctx.tier
    U, V = R.u, R.v
    m = R.m
    flat = m & (R.kind == 3)
    beam = m & ~flat
    c = R.c.copy()
    fu, fv = R.fu, R.fv
    if flat.any():
        if tier >= 5:
            # coffered panels between the beams: OAK_DK frame, VOID reveal line, INK_2 recessed panel
            P = 3.5
            lu = (U / P) - np.floor(U / P)
            lv = (V / P) - np.floor(V / P)
            du = np.minimum(lu, 1 - lu) * P
            dv = np.minimum(lv, 1 - lv) * P
            frame = (du < 0.32) | (dv < 0.32)
            reveal = ~frame & ((np.abs(du - 0.32) < fu) | (np.abs(dv - 0.32) < fv))
            c[flat] = N["INK_2"]
            c[flat & frame] = N["OAK_DK"]
            c[flat & reveal] = N["VOID"]
            # the frame's outer arris (where it meets the beam line) keeps a 1 px OAK_0 lip
            lipm = flat & frame & ((np.abs(du) < fu * 0.5) | (np.abs(dv) < fv * 0.5))
            c[lipm] = N["OAK_0"]
        else:
            p = np.floor(U / CEIL_PLANK_W)
            lu = U / CEIL_PLANK_W - p
            dark = (p % 2) == 0
            if tier >= 3:
                tone = np.where(dark, N["INK"], N["INK_2"])      # stained, even
            else:
                tone = np.where(hash_u(s + 1, p) < 0.5, N["INK"], N["INK_2"])
                tone = np.where(dark, N["INK"], tone)
            seam = np.minimum(lu, 1 - lu) * CEIL_PLANK_W < fu * 0.5
            # one grain stroke per ~30 px: cells of 1.6 ft along the plank
            cell = np.floor(V / 1.6)
            h = hash_u(s + 2, p, cell)
            gp = 0.3 + 0.4 * hash_u(s + 3, p, cell)
            ln = 0.5 + 0.4 * hash_u(s + 4, p, cell)
            a0 = hash_u(s + 5, p, cell) * (1 - ln)
            lc = V / 1.6 - cell
            grain = (h < 0.55 * R.att) & (np.abs(lu - gp) * CEIL_PLANK_W < fu * 0.5) & (lc > a0) & \
                (lc < a0 + ln) & (CEIL_PLANK_W / fu >= 5)
            cc = tone.astype(np.uint8)
            cc = np.where(grain, np.where(tone == N["INK"], N["INK_2"], N["INK"]), cc)
            cc = np.where(seam, N["VOID"], cc)
            c[flat] = cc[flat]
    if beam.any():
        base = R.base
        cc = base.copy()
        # grain runs along the beam: per face (kind), along whichever surface axis the face is longer in
        lab, nb = components(beam)
        swap = np.zeros(m.shape, bool)
        for ci in range(1, nb + 1):
            cm = lab == ci
            if np.ptp(V[cm]) > np.ptp(U[cm]):
                swap |= cm
        A = np.where(swap, V, U)
        B = np.where(swap, U, V)
        fA = np.where(swap, fv, fu)
        fB = np.where(swap, fu, fv)
        U, V, fu, fv = A, B, fA, fB
        lane = np.floor(V / 0.14)
        cell = np.floor(U / 1.2)
        h = hash_u(s + 11, lane, cell)
        ln = 0.45 + 0.4 * hash_u(s + 12, lane, cell)
        a0 = hash_u(s + 13, lane, cell) * (1 - ln)
        lc = U / 1.2 - cell
        grain = (h < 0.3 * R.att) & (np.abs(V - (lane + 0.5) * 0.14) < fv * 0.5) & (lc > a0) & (lc < a0 + ln)
        # raw beams show lighter grain; stained beams (T3+) are even, their grain one shade darker
        if tier >= 3:
            g = shift(base, -1, "dark_wood")
        else:
            g = np.where(base == N["INK"], shift(base, 1, "dark_wood"), shift(base, -1, "dark_wood"))
        cc = np.where(grain, g, cc)
        if tier == 1:
            # check cracks: short 2 px VOID splits along the beam
            ch = hash_u(s + 14, lane, np.floor(U / 1.7))
            cpos = (np.floor(U / 1.7) + 0.2 + 0.6 * hash_u(s + 15, lane, np.floor(U / 1.7))) * 1.7
            crack = (ch < 0.25 * R.att) & (np.abs(V - (lane + 0.5) * 0.14) < fv * 0.5) & \
                (np.abs(U - cpos) < np.maximum(fu, 0.06))
            cc = np.where(crack, N["VOID"], cc)
        # 1 px OAK_0 lip on the beam's lower arris (where the beam meets what is under it)
        up, down, left, right = edges(beam)
        lip = down & ~nbr(R.m, 1, 0, False)
        cc = np.where(lip, N["OAK_0"], cc)
        c[beam] = cc[beam]
    R.c[m] = c[m]


# ---------------------------------------------------------------- 5.4 wood furniture
def tex_furniture(ctx, R):
    s = R.seed
    tier = ctx.tier
    m = R.m
    if R.shell:
        # wood on a shell surface (a drawn baseboard / rail): baseboard treatment in world u, v
        top = float(R.v[m].max()) if R.kmode == 1 else BASE_H
        _baseboard(ctx, R, m & (R.kind == 1), top=min(top, BASE_H) if top <= BASE_H + 0.05 else top)
        return
    off = np.zeros(m.shape, np.int8)
    r = rng(s, "furn")
    for kv in np.unique(R.kind[m]):
        km = m & (R.kind == kv)
        lab, n = components(km)
        for ci in range(1, n + 1):
            cm = lab == ci
            ys, xs = np.nonzero(cm)
            h, w = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
            if cm.sum() < 6:
                continue
            vertical = kv == 5 or (kv in (4, 7) and h > 2.2 * w)
            # grain: long low-contrast strokes, one per 4..6 px of surface height
            if vertical:
                along, across = R.v, R.u
                fa = np.median(R.fu[cm])
            else:
                along, across = R.u, R.v
                fa = np.median(R.fv[cm])
            amin, amax = along[cm].min(), along[cm].max()
            cmin, cmax = across[cm].min(), across[cm].max()
            # boards: a big face is glued up from boards 6..10 px wide across the grain; 1 in 4 is a shade
            # darker (per-unit variation, like the floor's planks)
            if cm.sum() >= 400:
                bpos = cmin
                since = 2
                while bpos < cmax:
                    bw = fa * r.uniform(6, 10.01)
                    if r.random() < 0.25 or since >= 3:
                        off[cm & (across >= bpos) & (across < bpos + bw)] = -1
                        since = 0
                    else:
                        since += 1
                    bpos += bw
            pos = cmin + fa * (1.5 + r.uniform(0, 2))
            while pos < cmax - fa:
                ln = r.uniform(0.4, 0.9) * (amax - amin)
                a0 = amin + r.uniform(0, 1) * (amax - amin - ln)
                if r.random() < 0.3 + 0.7 * float(R.att[cm].mean()):
                    st = cm & (np.abs(across - pos) < fa * 0.5) & (along >= a0) & (along <= a0 + ln)
                    off[st] -= 1
                pos += fa * r.uniform(4, 6.01)
            # knots: about one per 700 px of face, a 3x2 cluster two shades down (OAK_DK on OAK_1)
            if cm.sum() >= 300:
                inner = cm & ~dilate(~cm, 2)
                iy, ix = np.nonzero(inner)
                for _ in range(int(cm.sum() // 700) + (1 if r.random() < 0.5 else 0)):
                    if not len(iy):
                        break
                    k = int(r.integers(0, len(iy)))
                    ky, kx = iy[k], ix[k]
                    for dy, dx in ((0, -1), (0, 0), (0, 1), (1, -1), (1, 0), (1, 1)) if not vertical else \
                            ((-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)):
                        yy, xx = ky + dy, kx + dx
                        if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and inner[yy, xx]:
                            off[yy, xx] = -2
            up, down, left, right = edges(cm)
            if kv in (4, 7) and h >= 4:
                off[up] = 1              # top-front bevel catches one shade up (shape, not light)
                off[down & ~up] = -1     # underside step one shade down
            elif kv == 6 and h >= 2:
                off[down] = 1            # front edge of a top
            # T4 trim: an inset construction line on big fronts
            if tier >= 4 and kv in (4, 7) and h >= 12 and w >= 12:
                inner = cm & ~dilate(~cm, 2)
                ring = inner & ~(inner & ~dilate(~inner, 1))
                off[ring & (off == 0)] = -1
            # chipped corners (T1 1 in 2, T2 1 in 3, T3+ refinished)
            pchip = [0.5, 0.33, 0, 0, 0][tier - 1]
            if pchip and h >= 4 and w >= 4:
                for (cy, cx, dy, dx) in ((ys.min(), xs.min(), 1, 1), (ys.min(), xs.max(), 1, -1),
                                         (ys.max(), xs.min(), -1, 1), (ys.max(), xs.max(), -1, -1)):
                    if r.random() >= pchip:
                        continue
                    k = int(r.integers(1, 4))
                    for (yy, xx) in [(cy, cx), (cy, cx + dx), (cy + dy, cx)][:k]:
                        ly, lx = yy - R.y0, xx - R.x0
                        if 0 <= ly < m.shape[0] and 0 <= lx < m.shape[1] and cm[ly, lx]:
                            off[ly, lx] = 1
    # handle grime: a 2 px darker halo around metal handles of the same object
    full = (ctx.oid[R.sl] == R.oid) & np.isin(ctx.mat[R.sl], [11, 12, 13, 15])
    if full.any():
        halo = dilate(full, 2) & m
        off[halo] = -1
    R.c[m] = shift(R.base, off, "oak")[m]
    R.c = despeckle(R.c, m)


# ---------------------------------------------------------------- 5.5 fabric and rugs
def _fabric_style(ctx, R):
    st = ctx.opts.get("fabric_style", {}).get(R.name)
    if st:
        return st
    n = R.name.lower()
    for keys, style in ((("curtain", "drape"), "curtain"), (("quilt", "blanket", "duvet", "comforter"), "quilt"),
                        (("pillow", "cushion"), "pillow"), (("tapestry", "banner", "flag", "pennant"), "tapestry"),
                        (("sheet", "linen", "bedding"), "sheet")):
        if any(k in n for k in keys):
            return style
    if RAMP_OF[R.dom] == "linen":
        return "sheet"
    return "drape"


def tex_fabric(ctx, R):
    s = R.seed
    tier = ctx.tier
    m = R.m
    style = _fabric_style(ctx, R)
    off = np.zeros(m.shape, np.int8)
    r = rng(s, style)
    lab, n = components(m)
    velvet = R.matid == MAT_ID["fabric_velvet"] or (style == "curtain" and tier >= 4)
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 8:
            continue
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        h, w = y1 - y0 + 1, x1 - x0 + 1
        Y = R.yy - R.y0
        X = R.xx - R.x0
        cx = (x0 + x1) / 2 + R.x0
        side = ctx.window_sign(cx)
        if style in ("curtain", "drape"):
            # vertical folds every 4..7 px (fuller at T3, broad on velvet); valley 2 shades down, ridge
            # 1 px one shade up on the window side; folds taper at their ends
            lo, hi = ((7, 10) if velvet else (4, 6) if tier >= 3 else (5, 7))
            x = x0 + r.uniform(1, lo)
            while x < x1 - 1:
                xi = int(round(x))
                ln = r.uniform(0.65, 1.0) * h
                top = y0 if r.random() < 0.7 else y0 + int(r.uniform(0, h - ln + 1))
                bot = int(min(y1, top + ln))
                for yy in range(int(top), bot + 1):
                    t = (yy - top) / max(1, bot - top)
                    deep = 0.15 < t < 0.85
                    # valley: 1 px two shades down plus 1 px one down on the shadow side; tapered ends 1 px
                    cells = [(0, -2 if deep else -1)]
                    if deep:
                        cells.append((-side, -1))
                    if velvet and deep:
                        cells.append((side * 0, -2))
                    for dx, val in cells:
                        xx = xi + dx
                        if 0 <= xx < m.shape[1] and cm[yy, xx]:
                            off[yy, xx] = val
                    if velvet and deep:
                        for dx in (-2 * side, side):
                            xx = xi + dx
                            if 0 <= xx < m.shape[1] and cm[yy, xx] and off[yy, xx] == 0:
                                off[yy, xx] = -1
                    elif not velvet and 0.25 < t < 0.8:
                        xx = xi + side
                        if 0 <= xx < m.shape[1] and cm[yy, xx] and off[yy, xx] == 0:
                            off[yy, xx] = 1
                x += r.uniform(lo, hi + 0.99)
            if style == "curtain":
                up, down, left, right = edges(cm)
                ry = Y - y0
                # rod pocket at the top, hem line 2 px above the bottom
                off[cm & (ry <= 1) & (off == 0)] = 1
                off[cm & (ry == 2)] = -1
                hem = cm & nbr(down, 2, 0, False)
                off[hem] = -1
                if tier == 1:
                    fray = down & (hash_u(s + 7, R.xx // 2) < 0.45)
                    off[fray] = -2
        elif style == "quilt":
            # puffed panels with a soft centre highlight; stitch dashes (2 on, 1 off) along the seams
            P = 0.7
            lu = R.u / P - np.floor(R.u / P)
            lv = R.v / P - np.floor(R.v / P)
            su = np.minimum(lu, 1 - lu) * P < R.fu * 0.5
            sv = np.minimum(lv, 1 - lv) * P < R.fv * 0.5
            dash_u = su & ((R.yy % 3) != 2)
            dash_v = sv & ((R.xx % 3) != 2)
            puff = ((lu - 0.5) ** 2 + (lv - 0.5) ** 2) < 0.045
            off[cm & puff & (R.att > 0.2)] = 1
            off[cm & (dash_u | dash_v)] = -1
        elif style == "pillow":
            # centre dent and a highlight lip above it, soft corner folds
            ey, ex = (y0 + y1) / 2, (x0 + x1) / 2
            dent = ((Y - ey) / max(1.5, h * 0.13)) ** 2 + ((X - ex) / max(2.0, w * 0.18)) ** 2 < 1
            off[cm & dent] = -1
            above = cm & ~dent & nbr(dent, 1, 0, False)
            off[above] = 1
            for (cy, cx_, dy, dx) in ((y0, x0, 1, 1), (y0, x1, 1, -1), (y1, x0, -1, 1), (y1, x1, -1, -1)):
                k = max(2, int(min(w, h) * 0.25))
                for (px, py) in line4(cx_, cy, cx_ + dx * k, cy + dy * k // 2):
                    if 0 <= py < m.shape[0] and 0 <= px < m.shape[1] and cm[py, px]:
                        off[py, px] = -1
        elif style == "tapestry":
            # embroidery (non-base pixels) raised: 1 px highlight above, shadow below; woven threads
            emb = cm & (R.base != R.dom)
            plain = cm & ~emb
            off[plain & nbr(emb, 1, 0, False)] = 1
            off[plain & nbr(emb, -1, 0, False)] = -1
            thread = plain & ((R.xx % 3) == 1) & (off == 0)
            off[thread] = -1
        else:  # sheet / linen: 3..5 soft diagonal folds, valley one down, ridge one up on the window side
            for _ in range(int(r.integers(3, 6))):
                if w < 6 or h < 4:
                    break
                sx_, sy_ = x0 + r.uniform(0, w), y0 + r.uniform(0, h * 0.5)
                ang = r.uniform(0.5, 1.1) * (1 if r.random() < 0.5 else -1)
                ln = r.uniform(0.45, 0.85) * math.hypot(w, h) * 0.75
                ex_, ey_ = sx_ + ln * math.cos(ang) * (1 if ang > 0 else -1), sy_ + ln * abs(math.sin(ang))
                for (px, py) in line4(sx_, sy_, ex_, ey_):
                    if 0 <= py < m.shape[0] and 0 <= px < m.shape[1] and cm[py, px]:
                        off[py, px] = -1
                        q = px + side
                        if 0 <= q < m.shape[1] and cm[py, q] and off[py, q] == 0:
                            off[py, q] = 1
    keep = R.base != R.dom if style == "tapestry" else np.zeros(m.shape, bool)
    out = shift(R.base, off, None)
    R.c[m & ~keep] = out[m & ~keep]
    R.c = despeckle(R.c, m)
    if style == "curtain" and tier >= 4:
        R.mat_out[m] = MAT_ID["fabric_velvet"]


def tex_rug(ctx, R):
    s = R.seed
    tier = ctx.tier
    m = R.m
    off = np.zeros(m.shape, np.int8)
    goldset = set(RAMPS["gold"])
    motif = m & np.isin(R.base, list(goldset))
    base_px = m & ~motif
    lab, n = components(m)
    fringe_light = np.zeros(m.shape, bool)
    fringe_dark = np.zeros(m.shape, bool)
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 12:
            continue
        uu, vv = R.u[cm], R.v[cm]
        long_v = (vv.max() - vv.min()) >= (uu.max() - uu.min())
        along = R.v if long_v else R.u
        acr = R.u if long_v else R.v
        amin, amax = along[cm].min(), along[cm].max()
        cmn, cmx = acr[cm].min(), acr[cm].max()
        fa = R.fv if long_v else R.fu
        # fringe: 1 px strands every 2 px at the short ends
        endz = cm & ((along - amin < np.maximum(0.16, 2 * fa)) | (amax - along < np.maximum(0.16, 2 * fa)))
        par = (R.xx % 2 == 0) if long_v else (R.yy % 2 == 0)
        fringe_light |= endz & par
        fringe_dark |= endz & ~par
        body = cm & ~endz
        # wear (T1): worn edges and a flattened traffic lane, one shade lighter
        if tier == 1:
            up, down, left, right = edges(body)
            off[(up | down | left | right) & base_px] = 1
            mid = (cmn + cmx) / 2
            lane = body & (np.abs(acr - mid) < 0.09 * (cmx - cmn)) & base_px
            off[lane] = 1
        # T4+: border pattern (dark band with a GOLD_DK line inside)
        if tier >= 4:
            inner2 = body & ~dilate(~body, 2)
            inner4 = body & ~dilate(~body, 4)
            band = body & ~inner2 & base_px
            off[band] = -1
            line = inner4 ^ (body & ~dilate(~body, 3))
            off[line & base_px] = 0
            R.c[line & base_px] = N["GOLD_DK"]
    # pile: short 1x2 vertical dashes one shade down in 2x3 cells (about 20% of the pile)
    cx = R.xx // 2
    cy = R.yy // 3
    dens = 0.55 * (0.5 + 0.5 * R.att) * (1.15 if tier >= 3 else 1.0)
    lane_flat = off == 1
    clear = ~dilate(motif, 1) & ~fringe_light & ~fringe_dark
    dash = (R.xx % 2 == 0) & ((R.yy % 3) < 2) & (hash_u(s + 3, cx, cy) < dens) & base_px & ~lane_flat & clear
    # pile tufts in two adjacent shades (mostly the shade down, some up) and a few deep pile shadows
    kind_h = hash_u(s + 4, cx, cy)
    tuft = np.where(kind_h < 0.55, -1, np.where(kind_h < 0.85, 1, -2)).astype(np.int8)
    off[dash & (off == 0)] = tuft[dash & (off == 0)]
    border = R.c == N["GOLD_DK"]
    out = shift(R.base, off, None)
    out[border] = N["GOLD_DK"]
    # motifs get a GOLD_DK stitch outline
    stitch = base_px & (nbr(motif, -1, 0, False) | nbr(motif, 1, 0, False) | nbr(motif, 0, -1, False) |
                        nbr(motif, 0, 1, False))
    out[stitch] = N["GOLD_DK"]
    out[fringe_light & m] = N["PAPER"]
    out[fringe_dark & m] = shift(R.base, -2, None)[fringe_dark & m]
    R.c[m] = out[m]
    if tier >= 5:
        R.mat_out[motif] = MAT_ID["gold_metal"]


# ---------------------------------------------------------------- 5.6 glass
def tex_glass_window(ctx, R):
    s = R.seed
    m = R.m
    r = rng(s, "glass")
    lab, n = components(m)
    skylight = R.kmode == 3
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 20:
            continue
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        w, h = x1 - x0 + 1, y1 - y0 + 1
        X, Y = R.xx - R.x0, R.yy - R.y0
        up, down, left, right = edges(cm)
        # 1 px GLASS_DK inner frame line along the top and left of each pane
        R.c[up | left] = N["GLASS_DK"]
        nst = 1 if (skylight or w < 14) else int(r.integers(1, 3))
        for k in range(nst):
            # diagonal reflection streak "/", 2 px wide, solid core, checker-dithered ends (dither allowed)
            c0 = x0 + y0 + r.uniform(0.3, 0.7) * (w + h) + k * 6
            span = r.uniform(0.35, 0.6) * min(w, h) * 1.4
            mid = r.uniform(-0.2, 0.2) * min(w, h)
            d = X + Y
            band = cm & (d >= c0) & (d < c0 + (2 if k == 0 else 1)) & ~(up | left)
            t = (X - Y) - (x0 - y0 + (w - h) / 2) - mid
            core = band & (np.abs(t) < span / 2)
            ends = band & (np.abs(t) >= span / 2) & (np.abs(t) < span / 2 + 4) & ((X % 2) == 0)
            col = N["COOL_2"] if (k == 0 or skylight) else N["CREAM"]
            R.c[core | ends] = col


def tex_glass_crt(ctx, R):
    m = R.m
    lab, n = components(m)
    src = R.base.copy()
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 20:
            continue
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        h, w = y1 - y0 + 1, x1 - x0 + 1
        Y, X = R.yy - R.y0, R.xx - R.x0
        # bulge: content at the four corners is pushed 1 px outward (barrel)
        cz = max(2, int(min(w, h) * 0.22))
        for (cy, cx, sy, sx) in ((y0, x0, 1, 1), (y0, x1, 1, -1), (y1, x0, -1, 1), (y1, x1, -1, -1)):
            zone = cm & (np.abs(Y - cy) < cz) & (np.abs(X - cx) < cz)
            moved = nbr(src, sy, sx, 255)
            okm = zone & nbr(cm, sy, sx, False)
            R.c[okm] = moved[okm]
        up, down, left, right = edges(cm)
        ring = up | down | left | right
        inner = cm & ~ring
        u2, d2, l2, r2 = edges(inner)
        ring2 = u2 | d2 | l2 | r2
        # rounded corners: the corner pixel and its two neighbours join the dark bevel
        for (cy, cx, sy, sx) in ((y0, x0, 1, 1), (y0, x1, 1, -1), (y1, x0, -1, 1), (y1, x1, -1, -1)):
            for (yy, xx) in ((cy + sy, cx + sx),):
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and cm[yy, xx]:
                    ring[yy, xx] = True
        R.c[ring] = N["GLASS_DK"]
        # highlight arc on the top-left 25% of the curve
        ang = np.arctan2((Y - (y0 + y1) / 2) / h, (X - (x0 + x1) / 2) / w)
        arc = ring2 & (ang < -math.pi / 2 + 0.25 * math.pi) & (ang > -math.pi + 0.05 * math.pi) & ~ring
        arc |= ring2 & (ang < -math.pi / 2) & (ang > -0.82 * math.pi) & ~ring
        R.c[arc] = N["COOL_2"]


# ---------------------------------------------------------------- 5.7 metals
def tex_metal(ctx, R):
    s = R.seed
    tier = ctx.tier
    m = R.m
    name = MAT_NAME[R.matid]
    r = rng(s, name)
    ramp = MAT_RAMP.get(R.matid)
    if ramp == "steel" and RAMP_OF[R.dom] not in ("steel", "glass"):
        ramp = None                                      # painted in another colour: its own ramp
    if name == "gold_metal":
        ramp = "gold" if RAMP_OF[R.dom] == "gold" else None
    off = np.zeros(m.shape, np.int8)
    abs_px = {}
    lab, n = components(m)
    Y, X = R.yy - R.y0, R.xx - R.x0
    for ci in range(1, n + 1):
        cm = lab == ci
        npx = int(cm.sum())
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        h, w = y1 - y0 + 1, x1 - x0 + 1
        up, down, left, right = edges(cm)
        if name == "metal_painted":
            if h >= 6:
                t = (Y - y0) / h
                chk = ((R.xx + R.yy) % 2) == 0
                b1, b2 = int(round(h / 3)), int(round(2 * h / 3))
                off[cm & (Y - y0 < b1)] = 1
                off[cm & (Y - y0 >= b2)] = -1
                off[cm & (Y - y0 == b1) & chk] = 1
                off[cm & (Y - y0 == b2 - 1) & chk] = -1
            nch = [4, 3, 2, 1, 0][tier - 1] if npx >= 60 else 0
            for _ in range(nch):
                yy, xx = int(r.integers(y0 + 2, max(y0 + 3, y1 - 2))), int(r.integers(x0 + 2, max(x0 + 3, x1 - 2)))
                blk = cm & (Y >= yy) & (Y <= yy + 1) & (X >= xx) & (X <= xx + 1)
                if blk.sum() == 4:
                    abs_px.setdefault("SLATE_D", np.zeros(m.shape, bool))
                    abs_px["SLATE_D"] |= blk
            g = up & (X == x0 + max(1, w // 4))
            off[g] = 9
        elif name == "metal_brushed":
            vert = h > 1.8 * w
            lane = R.xx if vert else R.yy
            pos = R.yy if vert else R.xx
            cell = pos // 6
            hh = hash_u(s + 1, lane, cell)
            st = (hash_u(s + 2, lane, cell) * 3).astype(int)
            ln = 3 + (hash_u(s + 3, lane, cell) * 4).astype(int)
            lp = pos - cell * 6
            on = cm & (hh < 0.3 * (0.5 + 0.5 * R.att)) & (lp >= st) & (lp < st + ln) & ((lane % 2) == 0)
            # two adjacent shades: base and one up, every other lane (a lane never touches the next stroke)
            off[on] = 1
            for k in range(1 if npx < 40 else 2):
                ey = y0 + (k * h) // 3
                g = cm & (Y == ey) & up
                if g.any():
                    gy, gx = np.nonzero(g)
                    off[gy[0], gx[0]] = 9
        elif name == "chrome":
            vert = h >= w
            t = ((X - x0 + 0.5) / w) if vert else ((Y - y0 + 0.5) / h)
            off[cm & (t < 0.28)] = -1
            off[cm & (t >= 0.28) & (t < 0.68)] = 1
            off[cm & (t >= 0.68)] = -1
            hl = (X == x0 + int(0.42 * w)) if vert else (Y == y0 + int(0.42 * h))
            off[cm & hl] = 9
            gl = cm & hl & ((Y == y0 + 1) if vert else (X == x0 + 1))
            abs_px.setdefault("CREAM", np.zeros(m.shape, bool))
            abs_px["CREAM"] |= gl
        elif name == "cast_iron":
            nz = value_noise(R.xx.astype(float), R.yy.astype(float), 2.6, s + 5, 1)
            off[cm & (nz < noise_q(0.5, 1))] = -1
            gy, gx = np.nonzero(up & cm)
            if len(gy):
                k = int(np.argmin(gx + gy))
                off[gy[k], gx[k]] = 2
        elif name == "gold_metal":
            off[(up | left) & cm] = 1
            off[(down | right) & cm & ~(up | left)] = -1
            if npx >= 6:
                gy, gx = np.nonzero(cm)
                k = int(np.argmin(gx + gy * 1.5))
                abs_px.setdefault("GOLD_HI", np.zeros(m.shape, bool))
                abs_px["GOLD_HI"][gy[k], gx[k]] = True
    top = off == 9
    off[top] = 0
    out = shift(R.base, off, ramp)
    out[top] = ramp_top(R.base, ramp)[top]
    for col, mk in abs_px.items():
        out[mk] = N[col]
    R.c[m] = out[m]
    if name in ("cast_iron",):
        R.c = despeckle(R.c, m, protect=top)


# ---------------------------------------------------------------- 5.8 paper, cork, books
def tex_paper(ctx, R):
    s = R.seed
    m = R.m
    r = rng(s, "paper")
    lab, n = components(m)
    plainset = set(RAMPS["paper"]) | set(RAMPS["linen"][1:])
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 9:
            continue
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        w, h = x1 - x0 + 1, y1 - y0 + 1
        Y, X = R.yy - R.y0, R.xx - R.x0
        dom = int(np.bincount(R.base[cm], minlength=256).argmax())
        up, down, left, right = edges(cm)
        ring = up | down | left | right
        if dom in plainset:
            # plain paper: aged edge band, a curled corner on 1 in 3, tape or a pin
            R.c[ring & (R.base == dom)] = N["PAPER_DK"]
            if r.random() < 1 / 3 and w >= 6 and h >= 6:
                for (yy, xx, col) in ((y1, x1, "PAPER_DK"), (y1 - 1, x1, "CREAM"), (y1, x1 - 1, "CREAM"),
                                      (y1 - 1, x1 - 1, "PAPER_DK")):
                    if cm[yy, xx]:
                        R.c[yy, xx] = N[col]
            if r.random() < 0.5 and w >= 8 and h >= 6:
                for xx in (x0, x1 - 1):
                    for yy in (y0, y0 + 2):
                        for dx in (0, 1):
                            if cm[yy, xx + dx]:
                                R.c[yy, xx + dx] = N["CREAM"]
            elif w >= 4 and h >= 3:
                xx = (x0 + x1) // 2
                if cm[y0 + 1, xx]:
                    R.c[y0 + 1, xx] = N["GOLD_HI"]
        else:
            # poster: keep its art, add a 1 px light border and fade (the top shade of each ramp drops one)
            topc = ramp_top(R.base)
            fade = cm & (R.base == topc) & ~ring
            R.c[fade] = shift(R.base, -1)[fade]
            R.c[ring] = N["CREAM"]


def tex_cork(ctx, R):
    """Cork board: 3 oak shades 40 / 40 / 20 in 2x1 flecks (the one speck material), plus pin holes."""
    s = R.seed
    m = R.m
    cell = R.xx // 2
    h = hash_u(s + 1, cell, R.yy)
    off = np.where(h < 0.4, 0, np.where(h < 0.8, 1, -1)).astype(np.int8)
    out = shift(R.base, off, "oak")
    holes = m & (hash_u(s + 2, R.xx, R.yy) < 0.008)
    out[holes] = N["INK"]
    R.c[m] = out[m]


def tex_books(ctx, R):
    s = R.seed
    m = R.m
    tops = m & (R.kind == 6)
    if tops.any():
        up, down, left, right = edges(tops)
        R.c[tops] = N["PAPER"]
        R.c[down] = N["PAPER_DK"]
    spines = m & ~tops
    # spines are runs of one colour: label per colour
    for col in np.unique(R.base[spines]):
        lab, n = components(spines & (R.base == col))
        for ci in range(1, n + 1):
            cm = lab == ci
            ys, xs = np.nonzero(cm)
            h, w = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
            if h < 6 or w < 2:
                continue
            key = int(ys.min() * 1000 + xs.min())
            if hash_u(s + 1, key) < 0.5:
                yy = ys.min() + h // 4
                band = cm & ((R.yy - R.y0) == yy)
                band &= ~edges(cm)[2] & ~edges(cm)[3] if w >= 3 else band
                R.c[band] = N["GOLD"] if hash_u(s + 2, key) < 0.6 else N["CREAM"]


# ---------------------------------------------------------------- 5.9 plants, soil, pots
def tex_leaf(ctx, R):
    m = R.m
    out = R.base.copy()
    for col in np.unique(R.base[m]):
        if RAMP_OF[col] != "leaf":
            continue
        lab, n = components(m & (R.base == col))
        for ci in range(1, n + 1):
            cm = lab == ci
            npx = int(cm.sum())
            if npx < 6:
                continue
            ys, xs = np.nonzero(cm)
            cy, cx = ys.mean(), xs.mean()
            # tip toward the window (translucent highlight); default the top of the leaf
            side = ctx.window_sign(cx + R.x0)
            score = -ys + 0.6 * side * xs
            k = int(np.argmax(score))
            ty, tx = ys[k], xs[k]
            out[ty, tx] = N["LEAF_4"] if col != N["LEAF_4"] else col
            # neighbour so the tip is a 2 px cluster
            for dy, dx in ((1, 0), (0, -side)):
                yy, xx = ty + dy, tx + dx
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and cm[yy, xx]:
                    out[yy, xx] = shift_lut("leaf", 1)[col] if col != N["LEAF_3"] else N["LEAF_4"]
                    break
            # midrib one shade darker along the leaf's long axis (leaves of 12 px or more)
            if npx >= 12:
                cov = np.cov(np.vstack([xs, ys]).astype(float))
                ev, evec = np.linalg.eigh(cov)
                if ev[1] > 2.0 * max(ev[0], 0.3):
                    dxv, dyv = evec[:, 1]
                    d = np.abs((xs - cx) * dyv - (ys - cy) * dxv)
                    up, down, left, right = edges(cm)
                    inner = ~(up | down | left | right)[ys, xs]
                    rib = (d < 0.5) & inner
                    out[ys[rib], xs[rib]] = shift_lut("leaf", -1)[col]
    R.c[m] = out[m]


def tex_soil(ctx, R):
    s = R.seed
    m = R.m
    nz = value_noise(R.xx.astype(float), R.yy.astype(float), 1.6, s + 1, 1)
    off = np.where(nz < noise_q(0.5, 1), -1, 0).astype(np.int8)
    out = shift(R.base, off, None)
    peb = m & (hash_u(s + 2, R.xx, R.yy) < 0.025)
    out[peb] = N["OAK_3"]
    R.c[m] = out[m]


def tex_terracotta(ctx, R):
    m = R.m
    lab, n = components(m)
    out = R.base.copy()
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 8:
            continue
        top = np.where(cm.any(0), np.argmax(cm, 0), -1)
        row = (R.yy - R.y0) - top[None, :]
        out[cm & (row == 0)] = N["RIM"]
        band = cm & (row == 2)
        out[band] = shift(R.base, -1, "terra")[band]
    R.c[m] = out[m]


# ---------------------------------------------------------------- 5.10 stone, plastic, ceramic
def tex_stone(ctx, R):
    """Chiselled stone: short angular 2..3 px strokes in the next shade down (some up)."""
    s = R.seed
    m = R.m
    r = rng(s, "stone")
    off = np.zeros(m.shape, np.int8)
    npx = int(m.sum())
    nst = int(npx / 22 * (0.4 + 0.6 * float(R.att[m].mean())))
    ys, xs = np.nonzero(m)
    shapes = [((0, 0), (0, 1), (0, 2)), ((0, 0), (0, 1), (0, 2), (1, 2)), ((0, 0), (1, 0), (2, 0)),
              ((0, 0), (0, 1), (1, 1), (1, 2)), ((0, 0), (1, 0), (1, 1), (2, 1)), ((0, 0), (0, 1), (1, 1))]
    for _ in range(nst):
        k = int(r.integers(0, len(ys)))
        sh = shapes[int(r.integers(0, len(shapes)))]
        q = r.random()
        v = -1 if q < 0.62 else 1 if q < 0.92 else 2
        pts = [(ys[k] + dy, xs[k] + dx) for dy, dx in sh]
        if all(0 <= y < m.shape[0] and 0 <= x < m.shape[1] and m[y, x] for y, x in pts):
            # keep strokes apart (1 px gap) so they stay strokes, not noise
            yy0, yy1 = min(p[0] for p in pts) - 1, max(p[0] for p in pts) + 2
            xx0, xx1 = min(p[1] for p in pts) - 1, max(p[1] for p in pts) + 2
            if (off[max(0, yy0):yy1, max(0, xx0):xx1] != 0).any():
                continue
            for y, x in pts:
                off[y, x] = v
    out = shift(R.base, off, None)
    R.c[m] = out[m]


def tex_plastic(ctx, R):
    m = R.m
    lab, n = components(m)
    off = np.zeros(m.shape, np.int8)
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 6:
            continue
        up, down, left, right = edges(cm)
        off[up] = 1
        gy, gx = np.nonzero(up)
        k = int(np.argmin(gx + gy))
        off[gy[k], gx[k]] = 9
    top = off == 9
    off[top] = 0
    out = shift(R.base, off, None)
    out[top] = ramp_top(R.base)[top]
    R.c[m] = out[m]


def tex_ceramic(ctx, R):
    m = R.m
    lab, n = components(m)
    off = np.zeros(m.shape, np.int8)
    for ci in range(1, n + 1):
        cm = lab == ci
        if cm.sum() < 8:
            continue
        ys, xs = np.nonzero(cm)
        x0, x1 = xs.min(), xs.max()
        w = x1 - x0 + 1
        X = R.xx - R.x0
        bx = x0 + int(round(0.28 * w))
        band = cm & ((X == bx) | ((X == bx + 1) & (w >= 6)))
        off[band] = 1
        # a glaze already at the top of its ramp (a cream mug): the band shows as two 1 px edges one down
        at_top = cm & (R.base == ramp_top(R.base))
        edge_l = cm & (X == bx - 1) & at_top
        edge_r = cm & (X == bx + (2 if w >= 6 else 1)) & at_top
        off[edge_l | edge_r] = -1
        up, down, left, right = edges(cm)
        off[right & ~band] = -1
        g = band & up
        gy, gx = np.nonzero(g)
        if len(gy):
            off[gy[0], gx[0]] = 9
    top = off == 9
    off[top] = 0
    out = shift(R.base, off, None)
    out[top] = ramp_top(R.base)[top]
    R.c[m] = out[m]


def tex_none(ctx, R):
    """Screens, neon, bulbs, flames, sky and wet surfaces keep their content (light and weather own them)."""
    return


HANDLERS = {
    "plaster": tex_plaster, "plaster_venetian": tex_plaster, "wood_floor": tex_floor,
    "wood_furniture": tex_furniture, "wood_ceiling": tex_ceiling, "fabric_cotton": tex_fabric,
    "fabric_velvet": tex_fabric, "rug_pile": tex_rug, "paper": tex_paper, "cork": tex_cork,
    "metal_painted": tex_metal, "metal_brushed": tex_metal, "chrome": tex_metal, "cast_iron": tex_metal,
    "gold_metal": tex_metal, "stone": tex_stone, "glass_window": tex_glass_window, "glass_crt": tex_glass_crt,
    "screen_emissive": tex_none, "plastic": tex_plastic, "leaf": tex_leaf, "soil": tex_soil,
    "terracotta": tex_terracotta, "ceramic": tex_ceramic, "book_cloth": tex_books, "neon": tex_none,
    "bulb": tex_none, "flame": tex_none, "wet": tex_none, "sky": tex_none,
}


# ---------------------------------------------------------------- tier pre-pass: T5 gold hardware
def _gold_hardware(img, mat, oid):
    """T5: metal handles and hinges on wooden furniture become gold (gold_metal), by value rank."""
    wood_oids = np.unique(oid[mat == MAT_ID["wood_furniture"]])
    sel = np.isin(oid, wood_oids) & np.isin(mat, [MAT_ID["metal_brushed"], MAT_ID["metal_painted"]]) & (img != T)
    if not sel.any():
        return
    gold = RAMPS["gold"]
    lv = LSTAR[img[sel]]
    # map L* 15..85 onto the gold ramp, never the top (SUN) so a glint stays a glint
    idx = np.clip(((lv - 15) / 70 * (len(gold) - 1)).round().astype(int), 0, len(gold) - 2)
    img[sel] = np.array(gold, np.uint8)[idx]
    mat[sel] = MAT_ID["gold_metal"]


# ---------------------------------------------------------------- the entry point
def apply(img, mat, surf, oid, names, attention, view, tier, seed=0, opts=None):
    """Paint albedo texture for every pixel by its material, in place (TEXTURE_SPEC 5, INTERFACES 8).

    img   uint8 (H, W) palette indices (255 = transparent); repainted in place
    mat   uint8 (H, W) material IDs; changed in place only where a tier changes the material
          (T5 walls -> plaster_venetian, baseboard / wainscot / crown -> wood_furniture, T4+ curtains ->
          fabric_velvet, T5 rug gold thread and furniture hardware -> gold_metal)
    surf  {"kind", "u", "v", "dist"} arrays (H, W); see the module docstring for u, v per kind
    oid   int16 (H, W) object ids; names {oid: name} (shell names must be the same in every view)
    attention float (H, W) 0..1 or None (= 1 everywhere); multiplies micro detail density only
    view  view id ("front", "right", "back", "left"); used for object seeds only, never for shell surfaces
    tier  room tier 1..5 (TEXTURE_SPEC section 6)
    seed  global seed (int)
    opts  optional dict: room_half (14), ceil (13.5), f_px (278), window_px (x, y) of the window in this view's
          master px (window-facing sides of folds, leaf tips), wear_paths [[(X, Z), ...], ...] for the floor,
          fabric_style {name: curtain|quilt|pillow|tapestry|sheet|drape}, crack_lip {wall name: +1|-1}
    Returns None.
    """
    ctx = Ctx(img, mat, surf, oid, names, attention, view, tier, seed, opts)
    if ctx.tier >= 5:
        _gold_hardware(img, mat, oid)
    valid = (img != T) & (mat > 0) & (mat <= 30)
    key = oid.astype(np.int64) * 256 + mat.astype(np.int64)
    keys = np.unique(key[valid])
    regions = []
    for k in keys:
        o, mi = int(k // 256), int(k % 256)
        mf = valid & (key == k)
        regions.append(Region(ctx, mf, o, mi))
    # every region reads the build's flat albedo (not a neighbour's texture), then all commit
    for R in regions:
        name = MAT_NAME[R.matid]
        fn = HANDLERS[name]
        if not R.shell and name in SHELL_ONLY:
            # a shell material on object pixels (an object drawn in PLASTER or floor colours): those pixels
            # belong to the object, not to a wall or floor, so they get the object treatment
            fn = SHELL_ONLY[name]
        fn(ctx, R)
        if not R.shell:
            cleanup(R)
    for R in regions:
        R.commit()


def _keep_flat(ctx, R):
    return


SHELL_ONLY = {"plaster": _keep_flat, "plaster_venetian": _keep_flat, "wood_floor": tex_furniture}
CLASS_OF = {m["id"]: m["class"] for m in MATERIALS["materials"]}


def cleanup(R):
    """Clusters, not noise (TEXTURE_SPEC 5, rule 2), on object regions after texturing: resolve 2x2
    checkerboards and isolated pixels that are shade noise (same ramp as their neighbours). Different-hue
    single pixels (an LED colour, a pin) and glints (top of the ramp on glint materials) are kept."""
    cls = CLASS_OF.get(R.matid)
    if cls not in ("solid", "detail", "glint"):
        return
    m = R.m
    c = R.c
    for _ in range(3):
        A, B, C_, D = c[:-1, :-1], c[:-1, 1:], c[1:, :-1], c[1:, 1:]
        mm = m[:-1, :-1] & m[:-1, 1:] & m[1:, :-1] & m[1:, 1:]
        w = mm & (A == D) & (B == C_) & (A != B)
        if not w.any():
            break
        ys, xs = np.nonzero(w)
        c[ys + 1, xs + 1] = c[ys, xs + 1]
    glint = (c == ramp_top(c)) if cls == "glint" else np.zeros(m.shape, bool)
    nb = [nbr(c, dy, dx, 255) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    nm = [nbr(m, dy, dx, False) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    same = np.zeros(m.shape, bool)
    has = np.zeros(m.shape, bool)
    for a, k in zip(nb, nm):
        same |= k & (a == c)
        has |= k
    iso = m & has & ~same & ~glint
    ys, xs = np.nonzero(iso)
    for y, x in zip(ys, xs):
        vals = [int(a[y, x]) for a, k in zip(nb, nm) if k[y, x]]
        best = max(set(vals), key=lambda q: (vals.count(q), -q))
        if RAMP_OF[best] == RAMP_OF[c[y, x]] or vals.count(best) >= 3:
            c[y, x] = best
    R.c = c


# ---------------------------------------------------------------- helpers the build can call directly
def paint(img, mat, mask, material, u, v, dist=None, kind=7, name="obj", tier=3, seed=0, view="front",
          attention=None, opts=None):
    """Texture one masked area as `material` (a name or id) without building full-frame surf arrays.
    u, v (and dist) are arrays of img's shape (only the masked pixels are read)."""
    mid = material if isinstance(material, int) else MAT_ID[material]
    H, W = img.shape
    mm = np.zeros((H, W), np.uint8)
    mm[mask] = mid
    oid = np.zeros((H, W), np.int16)
    oid[mask] = 1
    surf = {"kind": np.where(mask, kind, 0).astype(np.uint8), "u": np.where(mask, u, 0.0),
            "v": np.where(mask, v, 0.0), "dist": np.where(mask, 14.0 if dist is None else dist, 14.0)}
    sub = img.copy()
    sub[~mask] = T
    apply(sub, mm, surf, oid, {1: name}, attention, view, tier, seed, opts)
    img[mask] = sub[mask]
    if mat is not None:
        mat[mask] = mm[mask]


def plaster(img, mat, mask, u, v, dist=None, name="wall", tier=1, seed=0, **kw):
    """A plaster wall area (kind 1, u along the wall, v = height in feet)."""
    paint(img, mat, mask, "plaster", u, v, dist, kind=1, name=name, tier=tier, seed=seed, **kw)


def wood_planks(img, mat, mask, X, Z, dist=None, name="floor", tier=1, seed=0, **kw):
    """A plank floor area (kind 2, u = world X, v = world Z: planks run along Z)."""
    paint(img, mat, mask, "wood_floor", X, Z, dist, kind=2, name=name, tier=tier, seed=seed, **kw)


def ceiling(img, mat, mask, X, Z, dist=None, name="ceiling", tier=1, seed=0, **kw):
    paint(img, mat, mask, "wood_ceiling", X, Z, dist, kind=3, name=name, tier=tier, seed=seed, **kw)


# ---------------------------------------------------------------- 5.11 selective outline and anti-aliasing
def value_steps(a, b):
    """Value contrast between palette colours a and b, in ramp steps of b (the backdrop's ramp)."""
    return np.abs(LSTAR[a] - LSTAR[b]) / RAMP_STEP_L[b]


def selout(img, mask, backdrop=None, light_px=None, hotspot=False, ramp=None, add=False):
    """Selective outline pass on one object (TEXTURE_SPEC 5.11), in place on img.

    mask: the object's pixels. backdrop: colours behind the object (same shape; defaults to img itself,
    i.e. what is drawn around the object). light_px: (x, y) of the window in this view; silhouette edges facing
    it get no outline (the shader adds rim). The object's existing INK silhouette pixels are recoloured:
      backdrop within 1 ramp step of the edge pixel   -> INK (keeps separation)
      backdrop clearly darker                         -> darkest shade of the object's own ramp
      backdrop clearly lighter, or facing the window  -> no outline (the edge pixel's own colour)
    Internal INK lines (drawer gaps, panel seams) become one shade darker than the surface around them.
    add=True: the object has no drawn outline; its outermost ring is judged by the same rules and only gets
    an outline where the rules ask for INK or the ramp's darkest shade.
    hotspot=True: afterwards every silhouette pixel must keep 2 ramp steps of contrast to the backdrop;
    where it does not, the edge falls back to INK (TEXTURE_SPEC 5.13)."""
    bd = img if backdrop is None else backdrop
    H, W = img.shape
    ink = N["INK"]
    out_nb = []
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        out_nb.append((dy, dx, mask & ~nbr(mask, dy, dx, False)))
    sil = np.zeros_like(mask)
    for _, _, e in out_nb:
        sil |= e
    edge_px = sil & ((img == ink) if not add else np.ones_like(mask))
    inner = mask & ~sil & (img != ink)
    # the object's own colour next to each edge pixel (first inner 4-neighbour)
    own = np.full(img.shape, 255, np.uint8)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cand = nbr(np.where(inner | (mask & (img != ink)), img, 255).astype(np.uint8), dy, dx, 255)
        sel = (own == 255) & (cand != 255)
        own[sel] = cand[sel]
    own = np.where(own == 255, img, own)
    # backdrop colour beyond the edge (first outside neighbour)
    back = np.full(img.shape, 255, np.uint8)
    face_light = np.zeros_like(mask)
    for dy, dx, e in out_nb:
        b = nbr(bd, dy, dx, 255)
        sel = e & (back == 255) & (b != 255)
        back[sel] = b[sel]
        if light_px is not None:
            ys, xs = np.nonzero(e)
            fl = (dx * (light_px[0] - xs) + dy * (light_px[1] - ys)) > 0
            face_light[ys[fl], xs[fl]] = True
    res = img.copy()
    ys, xs = np.nonzero(edge_px)
    for y, x in zip(ys, xs):
        o, b = int(own[y, x]), int(back[y, x])
        if b == 255:
            res[y, x] = o if not add else img[y, x]
            continue
        dl = LSTAR[b] - LSTAR[o]
        step = RAMP_STEP_L[o]
        if face_light[y, x] and abs(dl) > step:
            res[y, x] = o
        elif abs(dl) <= step:
            res[y, x] = ink
        elif dl < 0:
            r = RAMPS.get(ramp) if ramp else RAMPS.get(RAMP_OF[o])
            res[y, x] = r[0] if r else int(DARKER[o])
        else:
            res[y, x] = o if not add else img[y, x]
    # internal INK lines: one shade darker than the surface around them
    internal = mask & ~sil & (img == ink)
    if internal.any():
        ys, xs = np.nonzero(internal)
        for y, x in zip(ys, xs):
            vals = [int(img[y + dy, x + dx]) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))
                    if 0 <= y + dy < H and 0 <= x + dx < W and mask[y + dy, x + dx] and img[y + dy, x + dx] != ink]
            if vals:
                res[y, x] = shift_lut(ramp, -1)[max(set(vals), key=vals.count)]
    if hotspot:
        bad = hotspot_contrast(res, mask, bd)[1]
        res[bad] = ink
    img[mask] = res[mask]


def aa_curve(img, mask, backdrop=None, ramp=None, min_len=8, hotspot=False):
    """Anti-alias curves and diagonals of 8 px or longer (TEXTURE_SPEC 5.11): each stair-step's outside
    (convex) corner pixel takes the ramp shade nearest the 50% mix of it and the backdrop. Straight box
    corners are left alone (a corner counts only when 3+ step corners sit within a 7x7 window, i.e. it is
    part of a stair curve). Never on hotspot silhouettes (5.13)."""
    if hotspot:
        return
    bd = img if backdrop is None else backdrop
    up = mask & ~nbr(mask, -1, 0, False)
    dn = mask & ~nbr(mask, 1, 0, False)
    lf = mask & ~nbr(mask, 0, -1, False)
    rt = mask & ~nbr(mask, 0, 1, False)
    corner = ((up | dn) & (lf | rt)) & ~((up & dn) | (lf & rt))
    cnt = np.zeros(mask.shape, np.int32)
    r = max(3, min_len // 2 - 1)
    ci = corner.astype(np.int32)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            cnt += nbr(ci, dy, dx, 0)
    curve = corner & (cnt >= 3)
    ys, xs = np.nonzero(curve)
    for y, x in zip(ys, xs):
        o = int(img[y, x])
        bs = []
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < mask.shape[0] and 0 <= xx < mask.shape[1] and not mask[yy, xx] and bd[yy, xx] != T:
                bs.append(int(bd[yy, xx]))
        if not bs or o >= len(NAMES):
            continue
        b = bs[0]
        target = (LSTAR[o] + LSTAR[b]) / 2
        rr = RAMPS.get(ramp) if ramp else RAMPS.get(RAMP_OF[o])
        if not rr:
            continue
        best = min(rr, key=lambda i: abs(LSTAR[i] - target))
        if best != o and abs(LSTAR[best] - LSTAR[o]) < abs(LSTAR[b] - LSTAR[o]):
            img[y, x] = best


# ---------------------------------------------------------------- 5.12 attention, 5.13 hotspot legibility
def attention_mask(h, w, focal, kind=None, ring=48, edge=0.10, floor_bottom=0.15):
    """Per-view attention mask (TEXTURE_SPEC 5.12): 1.0 inside the focal boxes [(x0, y0, x1, y1), ...],
    0.7 within `ring` px of them, 0.4 elsewhere, at the frame edges (outer `edge` share), on the ceiling
    (kind == 3) and on the bottom 15% of the floor (kind == 2). Smoothed by a small box blur so densities
    change gradually. For the shell, keep the frame edges at 0.4 in every view: the corner columns are shared
    by two views and must get the same detail."""
    a = np.full((h, w), 0.4, np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    for (x0, y0, x1, y1) in focal:
        dx = np.maximum(np.maximum(x0 - xx, xx - x1), 0)
        dy = np.maximum(np.maximum(y0 - yy, yy - y1), 0)
        d = np.hypot(dx, dy)
        a = np.maximum(a, np.where(d == 0, 1.0, np.where(d < ring, 0.7, 0.4)).astype(np.float32))
    ex, ey = int(w * edge), int(h * edge)
    fr = (xx < ex) | (xx >= w - ex) | (yy < ey) | (yy >= h - ey)
    a[fr] = 0.4
    if kind is not None:
        a[kind == 3] = 0.4
        fl = kind == 2
        if fl.any():
            rows = np.nonzero(fl.any(1))[0]
            cut = rows.max() - int((rows.max() - rows.min() + 1) * floor_bottom)
            a[fl & (yy > cut)] = 0.4
    k = 7
    p = np.pad(a, k, mode="edge")
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    s = (c[2 * k + 1:, 2 * k + 1:] - c[:-2 * k - 1, 2 * k + 1:] - c[2 * k + 1:, :-2 * k - 1] + c[:-2 * k - 1, :-2 * k - 1])
    return (s[:h, :w] / (2 * k + 1) ** 2).astype(np.float32)


def hotspot_contrast(img, mask, backdrop=None, steps=2.0):
    """Hotspot legibility (TEXTURE_SPEC 5.13): silhouette pixels vs the backdrop pixels touching them.
    Contrast is measured in ramp steps of the backdrop colour (|L*a - L*b| / the backdrop ramp's mean
    step). Returns (share of silhouette pixels that pass, bool mask of failing silhouette pixels)."""
    bd = img if backdrop is None else backdrop
    fail = np.zeros(mask.shape, bool)
    sil = np.zeros(mask.shape, bool)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        e = mask & ~nbr(mask, dy, dx, False)
        b = nbr(bd, dy, dx, 255)
        ok = e & (b != T) & (img != T)
        sil |= ok
        if ok.any():
            ys, xs = np.nonzero(ok)
            st = value_steps(img[ys, xs], b[ys, xs])
            bad = st < steps
            fail[ys[bad], xs[bad]] = True
    n = int(sil.sum())
    return (1.0 - fail.sum() / n) if n else 1.0, fail
