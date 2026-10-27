# FORGE v3.4 (art pass 6): interfaces between the parallel work streams

Owner of `engine/render.js`, `engine/decode.js`, the art build (`art/room-r6/build.py`) and the bundle: the
integrator. Other streams write only their own files (listed per stream) and never commit.

## 1. Room geometry (integrator)
- One square room, 28 x 28 ft, ceiling 13.5 ft. World axes: X right, Y up, Z forward (away from the camera when
  facing the window). The camera stands at the room centre (0, EYE, 0), EYE = 6.5 ft.
- Four views, each a 90 degree horizontal face of the same camera (a cube-map strip): `front` (yaw 0, the window
  and knight), `right` (yaw 90, desks and gym), `back` (yaw 180, the calendar wall), `left` (yaw 270, bed and
  kitchen). Walls are 14 ft from the camera, so each view shows one wall corner to corner; corners are shared.
- Per view master image: 800 x 560 art px; the default framing ("core") is 556 x 352 inside it; focal length
  f = 278 art px (90 degrees across the core). Pure yaw between views is exact (same camera centre), so a pan is
  drawn by re-projecting columns (vertical lines stay vertical).
- World px for the engine = master px - (core x0, core y0), as in v3.3. `zones.json` `views.<v>` holds `art`,
  `core`, `horizon`, `vp` (vanishing point), `yaw`, `f`, and `lighting` (section 4).

## 2. Palette (texture stream defines values; indices fixed)
64 colours: indices 0..36 unchanged from v3.3, 37..63 as named in TEXTURE_SPEC section 3. 255 = transparent.
Single source of truth: `art/room-r6/palette.json` (`colors: [[name, hex], ...]`, `luts`, `categories`).

## 3. Sprites and bundle
- `images[path] = { w, h, rle, mat?: rle, base?: path, delta?: rle }` (RLE pairs `[count, value]`, base64).
  `mat` = material ID per pixel (1..30, 0 = none, 255 = transparent). `delta` = pixels that differ from `base`
  (255 = same as base).
- Items as in v3.3 plus `view` in {front, right, back, left}. `item.material` optional override.
- No painted `.night` twins for the GPU path.

## 4. Lighting data (`views.<v>.lighting`, LIGHTING_SPEC section 8 schema)
`window {rect, facing, mullions, blinds}`, `key {center, radius, offscreen}`, `floor {backLine, bottom, squash,
seam}`, `ambient {day, golden, night}`, `lights [...]` (types point, area, line, cone; `channel`, `when`,
`drive`), `materials`, `noRim`. Coordinates in world px of that view. Plus `vignette`.

## 5. Per-frame buffers (render.js writes, gl.js and weather.js read)
Frame object `f` (already exists in render.js) gains:
- `f.buf` Uint8Array w*h: palette index (as now).
- `f.aux` Uint8Array w*h*3: byte 0 depth (0 back wall/window/sky, 1..254 objects by contact line, floor = its own
  y scaled, 255 ceiling), byte 1 flags (bit0 emissive, bit1 floor, bit2 floor seam, bit3 window glass/sky,
  bit4 engine mark, bit5 leaf/translucent, bit6 hovered/focused hotspot, bit7 no rim), byte 2 material ID.
- `f.w, f.h, f.x0, f.y0` (world px of buffer pixel 0,0), `f.now` (ms), `f.z` (device px per world px),
  `f.org {ox, oy}` (device origin), view id in `ROOM.state.view`.

## 6. GPU compositor (`engine/gl.js`, `engine/light.js`)
```
ROOM.light  = { sunPosition(date, lat, lon), state(now) -> {elevation, azimuth, keyframe weights, w, night,
                keyColor, keyIntensity, shadowStrength, shafts, bloom, exposure, grade}, flags (query overrides) }
ROOM.gl     = { supported(), init(), tier, setTier(name), setPalette(rgb256), setMaterials(table),
                setView(viewId, lighting), frame(f, opts) -> HTMLCanvasElement | null, lost }
```
`frame()` renders the lit image of the buffer at device size (`f.w * f.z` by `f.h * f.z`, top-left at world
`f.x0, f.y0`) into its own WebGL2 canvas and returns it; render.js draws that canvas onto the visible 2D canvas.
Returns null when the tier is Off or WebGL2 is missing (render.js then uses the v3.3 Canvas2D `drawLight`).
`opts`: `{dim, focus: {x,y,w,h} | null, hover, statueBurst, flash}`.

## 7. Weather (`engine/weather.js`)
```
ROOM.weather = { state, init(), draw(f), flash(now) -> 0..1.8, busy(now), ambientKey(now), wet(now) }
```
`draw(f)` writes rain, beads, runs, snow and fog into `f.buf` using palette indices only, clipped to pixels whose
material (`f.aux[i*3+2]`) is 17 (glass_window) or 30 (sky), after items are blitted and before engine marks.

## 8. Texture library (`art/room-r6/textures.py`)
The build draws flat albedo and fills, per master pixel: `img` (uint8 index), `mat` (uint8 material ID), `oid`
(int16 object id), `surf` (dict of float32 arrays: `kind` uint8 [0 none, 1 wall, 2 floor, 3 ceiling, 4 object
front face, 5 object side face, 6 object top, 7 flat sprite], `u`, `v` in feet along the surface (u horizontal,
v vertical or depth), `dist` in feet from the camera), plus `attention` float32 0..1.
`textures.apply(img, mat, surf, oid, names, attention, view, tier, seed)` paints albedo only (indices from the
64 palette), deterministically, and returns nothing. Per-object seeds come from `hash(name, view, surface)`.
