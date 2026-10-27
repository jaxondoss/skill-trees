# GPU lighting compositor: integration notes

Files: `room-prototype/engine/light.js` (ROOM.light, pure, also CommonJS), `room-prototype/engine/gl.js`
(ROOM.gl, WebGL2), `room-prototype/gl-harness.html` (standalone test page), `tests/unit/light.test.ts`.
Implements LIGHTING_SPEC v1.1 phases 1 to 8 (phase 9, the phone pass, is out of scope).

## Loading

After core.js, decode.js and before render.js uses them (order among the engine files after core.js does not
matter, nothing runs at load except reading `?` flags):

```html
<script src="engine/light.js"></script>
<script src="engine/gl.js"></script>
```

Once, at startup (render.js init is a good place):

```js
if (ROOM.gl && ROOM.gl.supported()) {
  ROOM.gl.init();                                   // tier from ?gltier=/?tier=<name>, else 'high' with auto-tiering
  ROOM.gl.setPalette(ROOM.art.palette.colors);      // [[name, '#hex'], ...] (64 entries once the palette grows)
  ROOM.gl.setMaterials(materialsJson);              // optional: TEXTURE_SPEC 4 rows; defaults are built in
}
```

`setView` is optional: `frame()` follows `ROOM.state.view` and loads `zones.views.<v>.lighting` (or bootstraps one
from the v3.3 glow list when the bundle has none). Call `ROOM.gl.setView(v, lightingBlock)` to push a block
explicitly. `'front'` and `'main'` are treated as the same view.

## API

```
ROOM.light.sunPosition(date, lat = 29.95, lon = -90.07) -> {elevation, azimuth}       degrees
ROOM.light.state(now, {p, flags, lat, lon, facing, rising}) -> state (see JSDoc)       pure
ROOM.light.current() -> state for the device clock + ROOM.data.todayP + query flags   cached 1 s
ROOM.light.flags                     parsed ?t=HH:MM ?el= ?az= ?p= ?light= ?tier=<name>|?gltier= ?retro=1 ?motion=0
ROOM.light.keyframeWeights(el, rising), blendKeyframes(w), completionW(p), windowDirect(az, el, facing)
ROOM.light.gradeLut(params, n)       generated n^3 RGBA8 grade cube
ROOM.light.depthOf(yBase, top, bottom) / yBaseOf(depth, top, bottom) / depthRange(lighting, viewConf)
ROOM.light.lightingFromV33(viewConf, viewId, items) -> views.<v>.lighting block      the converter
ROOM.light.lightingFor(viewConf, viewId, items)   curated block if present, else converted

ROOM.gl.supported() -> bool
ROOM.gl.init({tier, auto}) -> bool
ROOM.gl.tier / setTier('ultra'|'high'|'medium'|'low'|'off')   (manual set disables auto-tiering)
ROOM.gl.setPalette(colors) / setMaterials(table) / setView(viewId, lighting)
ROOM.gl.frame(f, opts) -> HTMLCanvasElement | null
ROOM.gl.lost (bool), ROOM.gl.canvas
extras: ROOM.gl.gains {exposure, ambient, key, practical, emissive, rim, shadow, patch, refl, seam, shafts, dust,
        bloom, grain, vignette, glint, transmission, saturation} (1 = as designed; for the drawer sliders),
        ROOM.gl.debug ('final'|'albedo'|'light'|'depth'|'flags'|'shadow'|'refl'|'bloom'), ROOM.gl.retro (bool),
        ROOM.gl.busy(now), ROOM.gl.ambientKey(now), ROOM.gl.hasAmbient(), ROOM.gl.stats(), ROOM.gl.invalidateCaches(),
        ROOM.gl.setStateSource(fn), ROOM.gl.lightingFromV33(...)
```

## What render.js passes

`f` (the existing frame object in renderRest):

| field | content |
|---|---|
| `buf` | Uint8Array w*h palette indices, after the LUT (keep DIM in it; drop R1..R4 and NIGHT on the GPU path) and after engine marks |
| `aux` | Uint8Array w*h*3: depth, flags, material ID (INTERFACES 5) |
| `w, h, x0, y0` | as now (fbW, fbH, world px of buffer 0,0) |
| `z` | device px per world px (integer at rest) |
| `now` | ROOM.now() ms (animation clock for flicker, grain, dust) |
| `sceneVersion` | recommended: render.js `sceneVersion` (+ dog position). The shadow/patch mask is rebuilt only when this, the view, the framing or the 0.5 degree sun bucket changes. Without it a sparse depth hash is used. |

Aux depth MUST be written with `ROOM.light.depthOf(yBase, top, bottom)` where `[top, bottom] =
ROOM.light.depthRange(lighting, viewConf)` (default the view's art rect y .. y+h). Floor pixels use their own y.
Back wall, window and sky 0, ceiling 255. The CPU shadow pass inverts it with `yBaseOf`; objects whose contact line
is above `floor.backLine - 2` are treated as wall-mounted (no cast shadow).

Flags (byte 1): bit0 emissive (set from palette defaults: window sun, bulbs, neon, screens, knight energy; and
`item.material`), bit1 floor (rugs and mats count as floor so they take the sun patch and shadows), bit2 plank
seam, bit3 window glass / sky, bit4 engine mark (LEDs, outlines, motes, glyphs), bit5 leaf, bit6 hovered/focused
hotspot pixels, bit7 no rim (`noRim` item patterns, posters, calendars, pennants). Byte 2 material ID 1..30 (0 =
use the palette-index fallback). On the palette fallback only flag-bit0 pixels glow, at the table strength (so the
knight's red cape, which uses CRT colours, does not).

`opts`:

```js
{
  dim: dimOn,                                  // bool
  focus: zone ? {x, y, w, h} : null,           // zone.focus rect; eased in/out over 300 ms inside gl.js
  hover: hoverRect,                            // {x,y,w,h} of the hovered hotspot (adds a small warm light; rim x2 via bit6)
  statueBurst: 0..1 or {x, y, k},              // envelope of the 600 ms gold-pulse burst (number uses lighting.statue [x,y])
  flash: ROOM.weather ? ROOM.weather.flash(now) : 0,   // 0..1.8; key x1.8 at 1.8
  pools: ROOM.glow.pools(),                    // optional: zone lamp pools [{x,y,r,a}] become real lights
  spot: {x, y, w, h, k},                       // optional: 400 ms spotlight pulse on the clicked object
  regions: [{rect: [x,y,w,h], gain: 0.7}, {rect, gain: 1, bounce: 0.15}],  // optional: neglect / completed-today
}
```

Drawing it (replaces the putImageData + drawLight pair at rest):

```js
var glc = ROOM.gl && ROOM.gl.frame(f, opts);
if (glc) ctx.drawImage(glc, x0 * z - org.ox, y0 * z - org.oy);
else { /* existing: expand RGBA, putImageData, drawImage(fbCanvas...), drawLight(...) */ }
```

Scheduler: add `ROOM.gl.ambientKey(now)` to render.js `ambientKey()` and `ROOM.gl.busy(now)` to the busy checks
(focus easing). ambientKey changes at most at 15 fps for light channels, 12 fps for grain, 30 fps for dust; it is
empty under reduced motion. The dolly and the turn keep using Canvas2D layer canvases (no change needed).

## Lighting block (spec section 8) plus these fields

- `window.base` (floor line y under the window, default floor.backLine), `window.throw` ([dx, dy], screen
  direction the patch and shafts travel; set for side windows), `window.lateral` (1: the sun azimuth shifts the
  patch sideways; main view).
- `key.wall` (backlit wall factor, 0.25 main, 0.6 side), `key.scale` (0 = no direct key: back view),
  `key.bounce` (uniform window bounce fill, back view 0.32), `key.floor` (point shadows fan out from; default a
  point behind the window wall), `key.rimSpread` (rim reach in key radii, default 2.2), `key.shadowLength`.
- lights: `type` point|area|line|cone, `rgb`, `intensity`, `radius`, `squash` (vertical/horizontal), `pos`,
  `rect`, `points`, `dir`/`angle` (cone, degrees, 90 = down), `channel` + `flicker` (gain per anim frame),
  `when` always|sunset|lamps|desk|dawn|night|day, `dayLevel` (min level by day), `drive: 'completion'` (neon),
  `static: true` (baked), `depth` (0..1 or byte, for the "behind the light" test).
- `anims` (copied from the v3.3 light block), `statue: [x, y]`, `depthRange`, `vignette` (v3.3 shape, weaker `c`).
- `materials` by palette name (`{LEAF_1: {translucency: 0.5}}`), `noRim` is for the aux writer.

The converter output is a starting point: 49 baked + 11 dynamic lights on main, 15 + 4 on the sides (main string
lights become 3 line strands). It adds the owner's lamps (left: `kitchen-undercab` line over kitchen.counter,
right: `desk-lamp` cone at study.lamp-r) and the back view's 4 ceiling pendants + bounce, no key.

## Owner decisions applied

- Completion: key 0.6 to 1.3, saturation 0.78 to 1.12, warmth -4 to +10 degrees, neon 0.35 to 1 (dying flicker
  below 25%, state changes every 620 ms at most), statue rim 0.7 to 1.4, shafts 0.7 to 1.15, bloom 0.85 to 1.15.
- Night: moon key 0.5 through the window (spec 0.25, raised so the spill reads), moon patch and faint moon shafts,
  all practicals on. Sun follows the real clock for New Orleans, window facing 250.
- Retro snap implemented, off by default (`?retro=1`, `ROOM.gl.retro`).

## Deviations from the spec, and why

- Ambient intensities are relative to the painted albedo (the art is already dark): 0.5 to 0.75 instead of
  0.10 to 0.18, keeping the spec colours and order. Exposure per keyframe 1.0 to 1.3.
- Tonemap is a filmic shoulder that is identity below 0.62 (so light = 1 reproduces the palette exactly) rather
  than ACES, which would shift every palette colour.
- Area lights use distance to the rect (one light, not 3 points). Line lights are split into segments.
- Grain is applied in P6 but per world pixel (anchored to world coords), as the spec intends.
- `?tier=` with a number stays the room tier (core.js); GPU tiers parse only names (or `?gltier=`).
- Auto-tiering: the timer query when present; otherwise the first 60 frames are timed with a 1 px readPixels sync
  (CPU+GPU frame time). Drops one tier when p95 > 6 ms, never raises.
- Static lightmap covers the view's art rect (800x480) in two layers (always, night-only scaled by lamps), so
  zone zooms reuse it.
- Without painted night twins the window sky is the day art darkened and tinted by the keyframe. A real night sky
  needs the sky shell's night variant (or a sky material LUT); recommend keeping `shell.sky` night art on the GPU path.
- Not done: the 3:1 hotspot contrast check and the six-LED legibility check are not automated (LEDs are drawn as
  marks in the harness and are protected by the bit4 bypass and the 0.3 bloom clamp); walls get no cast shadows
  (spec v1 says the same).

## Verification (headless Chromium + SwiftShader)

Main view, golden hour (el 10), 100%: 46% of pixels below L* 15, 2.8% above L* 85 (spec: at least 12% and 2%).
At 0%: 49% / 1.9%. Context loss: frame() returns null while lost, renders again after restore.
Reduced motion: ambientKey is empty, channels steady, no dust, static grain seed.

## Performance (SwiftShader software GPU, NOT representative of real hardware)

Main view, 557 x 236 world px, z = 4 (2228 x 944 device), 60 frames per tier, sync-readpixels method
(no timer query in SwiftShader):

| Tier | p50 ms | p95 ms | rAF median ms |
|---|---|---|---|
| Ultra | 229 | 278 | 250 |
| High | 230 | 281 | 267 |
| Medium | 143 | 184 | 167 |
| Low | 111 | 155 | 133 |

The device-res passes (bloom chain, P6) dominate on SwiftShader. CPU shadow/patch mask rebuild: 35 to 60 ms in
headless Chromium for the main view (only on cache misses). Measure High on real hardware with the harness
"Measure tiers" button.
