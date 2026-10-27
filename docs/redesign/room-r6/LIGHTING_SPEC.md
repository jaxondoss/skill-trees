# FORGE Lighting and Shader Spec

**Version:** 1.1 (for FORGE v3.4+; v1.1 aligns with `TEXTURE_SPEC.md` and the live v3.3 art)
**Scope:** the room renderer (`engine/render.js`, `engine/glow.js`, `engine/fx.js`) and the art bundle's per-view light data
**Reference:** `pixelized_theme_inspo.jpg` (golden-hour room, backlit by a window) and the live v3.3 stills (`stills/main@3x.png`; the earlier `forge_room_v2.webp` screenshot is the old room-v2 build)
**Decisions locked with Jaxon:** hybrid WebGL2 post pass, all four effect groups, real clock plus completion % drive the light, desktop-first performance budget

---

## 0. TL;DR

FORGE currently decorates the room with light. The reference lights it. The change is a move from **additive glows on top of the art** to a **light model**: one dominant key light from the window, a cool dark ambient, practical lights that actually illuminate surfaces, rim light on every edge facing the window, cast shadows, a glossy floor that reflects the window and screens, bloom, and a warm/cool color grade.

The palette art and the indexed renderer stay. A new WebGL2 compositor replaces `drawLight()` and runs the lighting at **world pixel resolution** (so light stays pixel-crisp) with bloom and grain at device resolution.

---

## 1. Diagnosis of v3.3 (why it looks flat)

| # | Problem | Where | Effect on screen |
|---|---|---|---|
| 1 | No key light. Light is spread over ~84 radial glows per view with similar alpha (0.03 to 0.2) | `views.<v>.light.day.glows` | Room has no direction; nothing is clearly lit from anywhere |
| 2 | All overlay light is `screen` blend | `drawLight()` | Screen can only brighten. It lifts blacks into a warm haze; no surface gets darker than the art |
| 3 | The window wall is *brighter* than the rest (3 large glows centered on the window at a = 0.18 to 0.2) | main glows 1 to 3 | Opposite of the reference, where the wall around a backlit window is the darkest plane in the room |
| 4 | No rim light | none | Objects read as flat brown cutouts |
| 5 | Shadows share the highlight hue (warm brown/red) | palette + LUT ramps | Whole frame is one hue family; no depth from temperature |
| 6 | Floor planks are flat single tones; the satin reflection and sun patch are baked into the albedo (`floor_reflection()`, `wall_sun_patch()`) | art | The floor cannot respond to time of day; seams never catch light |
| 7 | No contact or cast shadows | none | Furniture floats |
| 8 | ~25 string-light glows per view at a = 0.03 | glow list | Invisible, but each one fills a gradient rect at device resolution on every redraw |
| 9 | Lighting computed at device resolution | `drawLight()` | Smooth gradients over pixel art (style clash) and the most expensive possible place to do it |

What to keep: the palette, the indexed framebuffer, the LUT dissolve for DIM and dust, all engine marks (LEDs, outlines, motes, screens), the anim channels (`crt`, `terminal`, `candle`, `globe`, `sway`, `dust`, `timer`, `kettle`, `potions`), and draw-on-change scheduling.

---

## 2. Target look (from the reference)

1. **One boss light.** The window is the brightest thing on screen and the source of the key light. Everything else is fill.
2. **Backlit composition.** Surfaces facing the camera are in shadow; tops and window-facing edges catch a 1 px warm rim.
3. **Value range.** Deep near-black corners and ceiling, near-white sun disc. At golden hour on the main view: at least 12% of pixels below L* 15 and at least 2% above L* 85.
4. **Temperature split.** Shadows cool slate/teal, highlights orange/gold. Practicals (CRT red, terminal green, neon pink) stay saturated and local.
5. **The floor participates.** Seams glow amber near the light; screens and the sun reflect in the planks as vertical streaks.
6. **Screens are light sources.** A CRT throws red light onto the stand under it and onto the floor in front.
7. **Atmosphere.** Faint light shafts from the window with drifting dust; soft bloom on the window and screens.

Target color anchors (sRGB, linear values for the shader in parentheses):

| Role | Hex | Notes |
|---|---|---|
| Sun disc | `#FFE58C` | brightest pixel family |
| Golden key | `#FF8A3D` | key light color at golden hour |
| Sky band | `#F2662A` | window sky, upper |
| Shadow tint | `#1E2632` | grade target for darks |
| Deep shadow / ceiling | `#0F1218` | |
| Night key (moon/sky) | `#4A5A9A` | low intensity |
| CRT spill | `#FF4028` | from existing glow data |
| Terminal spill | `#46FF82` | from existing glow data |
| Neon (FORGE sign) | `#FF70A8` | from existing glow data |

---

## 3. Architecture

### 3.1 Frame pipeline

```
CPU (existing, extended)                      GPU (new, WebGL2)
-----------------------------------           ---------------------------------------------------
indexed framebuffer (R8, world res)  ──┐
aux buffer (RG8, world res)  ──────────┼──►  P1  Light pass      (world res, RGBA16F)
shadow mask (R8, world res, cached) ──┤      P2  Floor pass      (world res, RGBA16F)
static lightmap (RGBA16F, baked) ─────┘      P3  Shafts          (half world res)
palette LUT tex (256x1 RGBA8)                 P4  Bloom           (device res, 5-level dual filter)
material LUT tex (256x1 RGBA8)                P5  Composite + tonemap + grade (3D LUT) + dither
                                              P6  Upscale nearest to device, add bloom + grain
                                              ──► canvas
```

- World resolution is the existing visible window plus 1 px (`fbW x fbH`, core 556 x 235 per view). The light passes run at this size. That is under 150k pixels, so the full stack is cheap even on integrated GPUs.
- The existing `putImageData` path stays as the **fallback** when WebGL2 is unavailable or the tier is `Off` (see section 9). `drawLight()` keeps working there unchanged.
- Engine marks (LEDs, outlines, motes, screens, nameplates) keep being written into the indexed buffer after the LUT, exactly as now. They are flagged in the aux buffer so the grade does not crush them (see 3.2).

### 3.2 New CPU outputs

**Aux buffer** (`Uint8Array`, 3 bytes per world pixel: depth, flags, material ID), written during the same blit loop that writes the index buffer:

| Channel | Bits | Meaning |
|---|---|---|
| R | 0..255 | **depth**: drawable contact line `y_base / worldH` scaled to 1..254. Back wall and window = 0. Sky inside the window = 0. Floor pixels = their own `y`. Ceiling = 255 |
| G bit 0 | flag | emissive (window sky, screens, neon, LEDs, bulbs, candle flame) |
| G bit 1 | flag | floor surface |
| G bit 2 | flag | floor seam (plank gap) |
| G bit 3 | flag | window glass / sky (key light source mask) |
| G bit 4 | flag | engine mark (LED, outline, mote, screen glyph): bypass grade darkening |
| G bit 5 | flag | leaf / translucent |
| G bit 6 | flag | hovered or focused hotspot |
| G bit 7 | flag | receives no rim (UI-like art, posters, flat wall decals) |

Emissive comes from two sources: a per-palette-index default in the material table (3.3), overridden per item by `item.material` in the art bundle (so a `SUN`-colored mug is not emissive but the window sun is).

**Shadow mask** (R8): cast shadows plus contact shadows, recomputed only when the view, sun state, item variants, or dog position change. Not per frame.

**Static lightmap** (RGBA16F): all non-animated practical lights for a view, baked once per view and per day/night state at load. Dynamic lights (anim channels, completion-driven, hover) are evaluated live.

### 3.3 Material table

**Primary:** a 32x2 RGBA8 texture indexed by **material ID** (aux byte 3), exported per sprite by the art build. The full ID table, with gloss, roughness and glint, lives in `TEXTURE_SPEC.md` section 4. **Fallback** for sprites without a material map: the palette-index table below (256x1 RGBA8), overridable per item:

| Channel | Meaning |
|---|---|
| R | emissive strength (0..1, scaled x4 in shader) |
| G | rim response (0..1) |
| B | gloss (only floor uses it; 0..1) |
| A | translucency (leaves, curtains, lampshades) |

Starting values for the current 37-color palette:

| Colors | Emissive | Rim | Gloss | Transl. |
|---|---|---|---|---|
| `SUN`, `CREAM` (only via window/item override) | 1.0 | 0 | 0 | 0 |
| `GLOW`, `AMBER` | 0 (override to 0.8 for bulbs, neon) | 0.6 | 0 | 0 |
| `CRT_0`, `CRT_1` | 0.7 | 0 | 0 | 0 |
| `ENERGY`, `ENERGY_HI` (knight) | 0.5 | 0.3 | 0 | 0 |
| `GOLD`, `GOLD_DK` (statue) | 0 | 1.0 | 0 | 0 |
| `LEAF_0..3` | 0 | 0.8 | 0 | 0.5 |
| `OAK_*`, `BROWN_*`, `TERRA_*` | 0 | 0.7 | 0 | 0 |
| `SLATE_*`, `PLASTER*`, `NAVY` | 0 | 0.5 | 0 | 0 |
| Floor plank colors (via floor flag) | 0 | 0 | 0.35 | 0 |
| `VOID`, `INK` | 0 | 0.2 | 0 | 0 |

---

## 4. The light model

### 4.1 Core equation (P1, per world pixel, linear space)

```glsl
vec3 albedo   = srgbToLinear(paletteLUT[index]);
vec3 ambient  = u_ambientColor * u_ambientIntensity;           // cool, low
vec3 key      = u_keyColor * keyFalloff(p) * (1.0 - shadow(p)); // window key light
vec3 practical= texture(u_staticLightmap, uv).rgb + dynamicLights(p);
vec3 rim      = u_keyColor * rimMask(p) * mat.rim * u_rimGain;
vec3 emissive = albedo * mat.emissive * 4.0;

vec3 lit = albedo * (ambient + key + practical) + rim + emissive;
```

The key change from v3.3 is the **multiply**. Light now scales the art instead of being screened on top, so unlit areas fall to `albedo * ambient`, which is dark and cool. That is what creates the reference's depth.

Engine marks (`G bit 4`) skip the multiply: `lit = albedo` plus a small emissive term so LEDs and outlines stay readable at any time of day.

### 4.2 Key light (the window)

Each view defines where the key light comes from:

- **Main view:** the window rect. `keyFalloff` is a soft elliptical falloff centered on the floor in front of the window, not on the window itself. The back wall around the window gets **less** light than the floor in front of it (backlit wall). Concretely: wall pixels (depth near 0) take `key * 0.25`; floor and object tops take full key.
- **Left view:** key comes from off-screen right (current glow at x = 698). Light rakes across the floor toward the bed.
- **Right view:** key comes from off-screen left (current glow at x = -142).

```glsl
float keyFalloff(vec2 p) {
  vec2 d = (p - u_keyCenter) / u_keyRadius;      // ellipse in world px
  float f = 1.0 - smoothstep(0.0, 1.0, length(d));
  float wallFactor = mix(0.25, 1.0, step(0.02, depth(p)));
  return f * f * wallFactor * u_keyIntensity;
}
```

### 4.3 Rim light

A 1 world-pixel rim on every edge that faces the key light, detected from the depth buffer. No art changes needed.

```glsl
float rimMask(vec2 p) {
  vec2 toLight = normalize(u_keyCenter - p);      // screen-space direction to the window
  float dHere  = depth(p);
  float dNext  = depth(p + round(toLight));       // one pixel toward the light
  float edge   = step(dNext + 0.02, dHere);       // neighbor is further back (or sky) = lit edge
  return edge * keyFalloff(p) * (1.0 - shadow(p)) * (1.0 - flag(p, NO_RIM));
}
```

- Rim color = key color pushed toward the sun anchor (`#FFE58C`) at golden hour.
- Leaves with translucency also get a 0.3x transmission glow on their non-rim pixels when between camera and window (the green-gold leaves in the reference).
- The statue (`GOLD`, rim 1.0) gets the strongest rim in the room. It is the centerpiece and should be the second brightest thing after the window.

### 4.4 Cast and contact shadows (CPU, cached)

For every floor-standing drawable (has a contact line, not wall-mounted):

1. **Contact shadow:** a flattened ellipse under the footprint, width = sprite bounds width + 4, height = 3 px, value 0.65, 2 px Bayer-dithered edge.
2. **Cast shadow:** project each opaque sprite pixel onto the floor plane away from the key light.

```
h        = y_base - y                     // pixel height above its contact line
len      = clamp(1 / tan(sunElevation), 0.3, 2.5) * u_shadowLength
dir      = normalize(p_base - keyCenterOnFloor)
shadowXY = (x, y_base) + dir * h * len * (1, 0.35)   // 0.35 = floor foreshortening
```

- Write into the shadow mask with max-blend, then a 1 px box blur and Bayer threshold so edges stay pixel-art.
- Shadow strength 0.75 at golden hour, 0.45 midday (soft sky light), 0.3 at night (only practicals cast; use the nearest strong practical as origin, or skip).
- Only applies where the floor flag is set. Walls get no cast shadows in v1.

### 4.5 Sun patch on the floor

At golden hour the window throws a bright parallelogram onto the floor (in front of the TV stand on the main view), including the mullion and blind shadows. Project the window rect onto the floor the same way as cast shadows (inverse: lit instead of dark), intensity `1.6 * keyIntensity`, clipped by the shadow mask so objects block it. This replaces the baked `wall_sun_patch()` and `floor_reflection()` in the albedo (removed from the GPU export, kept only in the fallback shells; see `TEXTURE_SPEC.md` 8.1).

### 4.6 Practical lights (replaces the 84-glow list)

Curate to **at most 16 dynamic + any number of baked static lights per view**. Each light illuminates surfaces through the multiply instead of being screened on top.

```glsl
vec3 pointLight(vec2 p, Light L) {
  vec2 d = p - L.pos;
  float r2 = dot(d / L.radius, d / L.radius);
  float att = clamp(1.0 - r2, 0.0, 1.0);
  att *= att;
  float facing = mix(1.0, 0.6, step(depth(p) + 0.05, L.depth)); // objects behind the light get less
  return L.color * L.intensity * att * facing * channelValue(L.channel);
}
```

- **String lights** become one `line` light (polyline + bulb count). Bake its contribution into the static lightmap; draw the bulbs as emissive pixels so they bloom. This removes ~25 gradient fills per view.
- **Screens** (CRT, terminal, monitors): a rectangular area light approximated by 3 point lights along the screen width, in the screen's color. Flicker comes from the existing anim channels.
- **Neon FORGE sign:** line light, pink, completion-driven (see 6.3).
- **Desk lamp, floor lamp, candle:** cone (lamp) or point (candle) lights, warm. Lamps switch on at sunset or when their zone is active.
- **Statue downlight:** a proper spot light (cone from the ceiling, 30 degrees) with the existing dust motes inside it. Replaces the `downlight` overlay sprite when WebGL2 is on.

### 4.7 Ambient

Cool and low. Day: `#2A3550` at 0.18. Golden hour: `#2A2E45` at 0.12. Night: `#1A2040` at 0.10. The ceiling band gets an extra `0.6x` so it reads near-black like the reference.

---

## 5. Effects

### 5.1 Glossy floor (P2)

Runs on floor-flagged pixels only.

**Reflection:** screen-space planar reflection about the floor's back line `y_b` (the wall/floor seam; main view about y 214, verify per view).

```glsl
float t      = (p.y - y_b) / (u_floorBottom - y_b);   // 0 at the seam, 1 at the bottom
vec2  src    = vec2(p.x, y_b - (p.y - y_b) * u_squash); // mirrored source
vec3  refl   = streakSample(u_litHDR, src, mix(2.0, 12.0, t)); // vertical blur grows with distance
float fres   = mix(0.55, 0.12, t);                       // strong near the seam, weak near camera
vec3  floorC = lit + refl * fres * u_gloss * reflBrightOnly(refl);
```

- `reflBrightOnly` keeps only the bright part of the source (smoothstep on luminance 0.35 to 0.9). Dark furniture should not mirror; the window, sun patch, screens, neon and LEDs should. This is the streaky pool under the TV in the reference.
- `streakSample` = 6 to 12 taps vertical, plus a per-plank horizontal jitter of up to 1 px (hash of plank coordinates) so each plank catches the reflection slightly differently.
- Seam pixels get no reflection, which breaks the streaks plank by plank like the tiles in the reference. Streak length scales with the material's roughness (`TEXTURE_SPEC.md` section 4).

**Seam glow:** plank seam pixels near the light take `seamColor * keyFalloff * 1.4 + practical * 0.8`, amber (`AMBER`), on the seam's far edge only (the worn-edge pixels the texture spec paints). Far from any light they fall back to the art. This gives the reference's glowing floor grid on wood.

### 5.2 Light shafts and dust (P3)

- Half world resolution. Radial blur of the window mask (flag bit 3, times key color) toward the key center, 24 samples, decay 0.94, occluded by depth (pixels with depth greater than the window's block the shaft).
- Intensity: 0.35 golden hour, 0.15 midday, 0 at night (optional faint moon shaft 0.08).
- Dust: 30 to 50 single-pixel motes inside the shaft volume, drifting 2 to 6 px per second with slow sine sway, brightness = shaft intensity at their position. Reuse the existing `dust` anim channel for timing. Off under reduced motion.

### 5.3 Bloom and emissive spill (P4)

- Source: the lit HDR buffer, thresholded at luminance 0.8 with a soft knee 0.2, plus all emissive-flagged pixels at full value.
- Dual-filter (Kawase) blur: 5 downsample levels starting at device res / 2, then upsample and add.
- Strength: 0.25 day, 0.4 golden hour, 0.6 night. Tint toward the source (bloom keeps color; the CRT blooms red, the terminal green).
- Spill onto surfaces is handled by the practical lights in 4.6, not by bloom. Bloom is only the soft halo the eye sees around bright things.
- Bloom must never cover hotspot LEDs enough to hide their state. Clamp bloom contribution over engine-mark pixels to 0.3.

### 5.4 Grade, dither, grain (P5, P6)

1. **Tonemap:** filmic curve (Hable or ACES fitted), exposure from the time-of-day keyframe.
2. **Color grade:** 32-cube 3D LUT, generated at build time from parameters (no hand-painted LUTs). Two keyframe LUTs are blended per frame by the time-of-day weight. Parameters per keyframe: shadow tint, highlight tint, split balance, saturation, contrast, black lift.
3. **Ordered dither:** 4x4 Bayer anchored to world pixels (same matrix the engine already uses), quantizing each channel to 6 bits. This kills gradient banding and keeps the light looking pixel-made.
4. **Palette snap (optional, setting `retro`):** snap to an extended 64-color palette (current 37 plus 27 generated light/shadow steps) through the dither. Default off.
5. **Grain:** luminance noise, 2% day, 3.5% night, per world pixel (not device pixel), re-seeded at 12 fps. Off under reduced motion (static seed).
6. **Vignette:** keep the oval multiply vignette but weaker (`c` from `[0.3, 0.17, 0.2]` to `[0.55, 0.5, 0.58]`), since the light model now creates the falloff naturally.

---

## 6. What drives the light

### 6.1 Sun position from the real clock

Compute solar elevation and azimuth for New Orleans (lat 29.95, lon -90.07) from the device clock. Keyframes are keyed by **sun elevation**, not clock hour, so golden hour moves with the seasons automatically.

```js
// Low-precision solar position (good to ~0.5 degree). date: Date, returns degrees.
function sunPosition(date, lat = 29.95, lon = -90.07) {
  const rad = Math.PI / 180;
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * rad) - ra;
  const la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}
```

| Keyframe | Sun elevation | Key color | Key intensity | Shadow len | Shafts | Bloom | Practicals |
|---|---|---|---|---|---|---|---|
| Night | below -6 | moon `#4A5A9A` | 0.25 | short, soft | 0 to 0.08 | 0.6 | all on |
| Blue hour | -6 to -1 | `#6A6FB0` | 0.4 | soft | 0.05 | 0.5 | lamps on |
| Sunset | -1 to 6 | `#FF5A2A` | 1.1 | long | 0.3 | 0.45 | lamps on |
| Golden hour | 6 to 18 | `#FF8A3D` | 1.25 | long | 0.35 | 0.4 | screens only |
| Day | above 18 | `#FFE2B8` | 0.9 | short | 0.15 | 0.25 | screens only |
| Dawn | rising, -6 to 6 | `#FF9F7A` | 0.7 | long, soft | 0.2 | 0.3 | desk lamp |

Blend between neighboring keyframes over 1 degree of elevation (so transitions take a few real minutes, never a pop).

**Window facing:** each room preset defines `window.facing` (azimuth the window looks toward). The dorm defaults to `250` (west-southwest) so evening sun comes straight in. When the sun azimuth is more than 70 degrees off the facing, the key light becomes diffuse sky light: no hard cast shadows, no sun patch, softer rim, cooler color. Mornings look calm and soft; evenings get the hard golden beams.

### 6.2 Completion % (today's progress)

The existing R1 to R4 ramps move into the shader as one parameter, `w`:

```js
const w = smoothstep(0.0, 0.85, todayP / 100); // 85% = streak-safe line, matches the 85% streak rule
```

| Uniform | At w = 0 | At w = 1 |
|---|---|---|
| key intensity multiplier | 0.8 | 1.15 |
| highlight warmth (hue shift toward gold) | 0 | +8 degrees |
| saturation | 0.85 | 1.1 |
| FORGE neon intensity | 0.35, irregular flicker below 25% | 1.0, steady |
| statue rim gain | 0.7 | 1.4 |
| shaft intensity multiplier | 0.8 | 1.1 |

So the clock decides *what time it is* in the room, and your progress decides *how alive the room feels*. A day at 0% at golden hour is still golden, just dimmer and flatter; hitting 85% makes the room glow and the sign burn steady.

The R1 to R4 LUTs are retired from the albedo pass once phase 6 ships (they double-grade otherwise). `NIGHT` and `DIM` LUTs stay for the fallback path; `DIM` also stays in the GPU path (see 7.1).

### 6.3 Debug overrides

Extend the existing query flags: `?t=HH:MM` (fake clock), `?el=12` (force sun elevation), `?p=0..100`, `?light=albedo|light|depth|flags|shadow|refl|bloom|final`, `?tier=low|medium|high|ultra|off`. Add a light panel to the demo drawer with sliders for elevation, `w`, and each effect's gain.

---

## 7. Gameplay lighting (must not regress)

### 7.1 Zone focus

Keep the DIM LUT dissolve as is, and add in the shader: outside the focus ellipse, multiply by 0.45 and desaturate 30%, 6 px soft edge, eased over 300 ms. The clicked object gets a 400 ms spotlight pulse (a cone light at 1.5x, decaying). The zone's "it's on" lamp pool becomes a real practical light at the zone's `light` point.

### 7.2 Hotspots and LEDs

- LEDs, outlines, motes, screen glyphs: flagged as engine marks, never darkened below their palette value, bloom clamped (5.3). LED states must stay distinguishable at night and at golden hour: test all six states (off, pending, half, full, blink, pulse) in every keyframe.
- Hovered or focused hotspot (`G bit 6`): rim gain x2 and a small warm point light on it.
- Today's top-priority object: keeps its breathing outline, plus a subtle 0.2 warm point light breathing in sync.

### 7.3 State lighting (narrative)

- **Neglected skills:** their objects receive 0.7x key and practical light (they literally sit in the dark) on top of the existing dust. Recovers instantly when the skill is logged.
- **Completed today:** the object gets a faint 0.15 warm bounce light for the rest of the day.
- **Relic embers:** keep the flicker; ember color becomes a real point light so it warms the wall behind the mount.
- **Statue gold pulse:** the palette-cycle stays; add a 600 ms point light burst at 1.5x when the pulse fires.

---

## 8. Art bundle schema changes

Replace `views.<v>.light` with `views.<v>.lighting`. The build script converts the current glow list as a starting point (glows with a channel become dynamic lights; the rest get merged and baked), then a human pass curates it.

```json
"lighting": {
  "window": {
    "rect": [292, 60, 82, 100],
    "facing": 250,
    "mullions": [[333, 60, 1, 100]],
    "blinds": { "rows": 6, "open": 0.6 }
  },
  "key": { "center": [332, 196], "radius": [190, 60], "offscreen": null },
  "floor": { "backLine": 214, "bottom": 235, "squash": 1.0, "seam": "AMBER" },
  "ambient": { "day": "#2A3550", "golden": "#2A2E45", "night": "#1A2040" },
  "lights": [
    { "id": "crt-main", "type": "area", "rect": [306, 136, 30, 18], "rgb": [255, 64, 40], "intensity": 1.2, "radius": 48, "channel": "crt", "when": "always" },
    { "id": "terminal", "type": "area", "rect": [504, 116, 30, 20], "rgb": [70, 255, 130], "intensity": 1.0, "radius": 52, "channel": "terminal", "when": "always" },
    { "id": "neon-forge", "type": "line", "points": [[440, 34], [478, 34]], "rgb": [255, 112, 168], "intensity": 1.0, "radius": 50, "drive": "completion" },
    { "id": "string-lights", "type": "line", "points": [[179, 7], [193, 20]], "bulbs": 24, "rgb": [255, 176, 96], "intensity": 0.4, "radius": 10, "static": true },
    { "id": "desk-lamp", "type": "cone", "pos": [420, 140], "dir": 90, "angle": 50, "rgb": [255, 190, 112], "intensity": 0.9, "radius": 60, "when": "sunset" },
    { "id": "candle", "type": "point", "pos": [358, 184], "rgb": [255, 176, 96], "intensity": 0.5, "radius": 22, "channel": "candle", "when": "always" }
  ],
  "materials": { "LEAF_1": { "translucency": 0.5 } },
  "noRim": ["poster-*", "calendar-*", "pennant-*"]
}
```

Coordinates above are placeholders derived from the v3.3 glow data and must be verified against each view's art. Per item: optional `material` (`"window"`, `"screen"`, `"emissive"`, `"glossy"`), optional `castsShadow: false` for wall-mounted art.

**Room presets** (dorm, beach house, Miami penthouse, Tokyo apartment, mountain cabin): each preset is just a different `lighting` block plus its own `window.facing`. The shader code is shared. Write the dorm block first and keep everything preset-specific in data, never in code.

---

## 9. Performance (desktop first)

**Target:** 60 fps at 2560 x 1440 on an M1 MacBook Air or Intel Iris Xe laptop at the **High** tier. GPU frame budget 4 ms, CPU light work (aux buffer write) under 1 ms per redraw.

| Tier | Light pass | Floor refl. | Shafts | Bloom | Grain | Auto-picked when |
|---|---|---|---|---|---|---|
| Ultra | world res, 16 dynamic lights | 12 taps | 32 samples | 6 levels, device res / 2 | yes | discrete GPU, manual |
| High | world res, 16 lights | 8 taps | 24 samples | 5 levels, device res / 2 | yes | default desktop |
| Medium | world res, 8 lights | 6 taps | 16 samples, quarter res | 4 levels, device res / 4 | yes | integrated GPU slow, tablets |
| Low | world res, 4 lights, no rim on leaves | 4 taps | off | 3 levels, device res / 4 | no | phones |
| Off | v3.3 Canvas2D `drawLight()` | n/a | n/a | n/a | n/a | no WebGL2 |

Rules:
- Keep draw-on-change. The GPU passes run only when the engine would redraw anyway. Animated light channels tick at most 15 fps; grain at 12 fps; shafts and dust at 30 fps.
- Shadow mask and static lightmap are cached; rebuild only on view, sun keyframe bucket (every 0.5 degree of elevation), variant, or dog changes.
- Auto-tiering: measure the first 60 frames with `EXT_disjoint_timer_query_webgl2` when available, else rAF deltas; drop one tier if p95 GPU time exceeds 6 ms, never raise automatically.
- Context loss: rebuild all GPU resources on `webglcontextrestored`; show the Canvas2D fallback meanwhile.

**Honest flag:** you chose desktop first, but FORGE is headed for the App Store. The Low tier is not optional; it must ship and be tested on a real iPhone before that release, or the room will run hot and drain battery. Plan a phone pass after phase 7.

---

## 10. Accessibility and comfort

- `prefers-reduced-motion` (and `?motion=0`): no flicker on any light, no grain animation, no shaft drift, no dust motes, light transitions become instant swaps. Existing behavior for LEDs and motes is unchanged.
- No light may strobe faster than 3 Hz. Neon "dying" flicker below 25% completion stays under 2 Hz and irregular.
- Hotspot discoverability: every hotspot must keep at least 3:1 luminance contrast between its outline and the surrounding lit pixels in every keyframe (automated check in the test harness).
- The DOM HUD and panels are untouched by the shader.

---

## 11. Build plan for Claude Code

Each phase ends with stills of all three views at golden hour and night, committed to `stills/`, plus a perf readout.

1. **GPU compositor at parity.** WebGL2 context, upload index buffer and palette, reproduce v3.3's look exactly (port `drawLight` to a shader). Canvas2D fallback and tier switch. *Done when* side-by-side diff with v3.3 is under 2% per channel.
2. **Multiplicative light.** Aux buffer (depth + flags), material table, ambient, curated practicals, static lightmap bake, string lights as a line light. Remove the 3 big window-centered glows. *Done when* the room has real darks and screens light their stands.
3. **Key light, rim, shadows.** Key falloff with backlit wall, rim from depth, contact shadows, cast shadows, sun patch replacing the baked reflection and sun patch.
4. **Glossy floor.** Reflection, streaks, seam glow.
5. **Bloom, shafts, dust.**
6. **Drivers.** Solar position, keyframes, window facing, completion `w`, retire R1 to R4 albedo LUTs, debug flags and drawer sliders.
7. **Grade and finish.** Generated 3D LUTs, dither, grain, retro palette snap option, vignette retune, tiers and auto-tiering.
8. **Gameplay pass.** Zone focus in shader, hotspot and LED legibility checks in every keyframe, neglect and completion lighting, statue burst.
9. **Phone pass (before App Store).** Low tier on a real iPhone, thermals over 10 minutes.

---

## 12. Acceptance criteria

- [ ] Main view, golden hour, 100% completion: the window is the brightest region; at least 12% of pixels below L* 15 and 2% above L* 85.
- [ ] Every object facing the window shows a 1 px warm rim; flat wall art does not.
- [ ] Furniture has contact shadows; floor objects cast shadows away from the window whose length changes with sun elevation.
- [ ] The CRT visibly lights the stand under it red; the terminal lights the desk green.
- [ ] The floor reflects the window, screens and neon as vertical streaks broken by glowing plank seams.
- [ ] Shadows read cool, highlights warm, in a side-by-side with the reference.
- [ ] Faking the clock through a full day (`?t=`) produces smooth transitions with no pops.
- [ ] 0% vs 100% completion at the same time of day is clearly different but both look intentional.
- [ ] All six LED states are distinguishable in every keyframe; hotspots meet 3:1 contrast.
- [ ] High tier holds 60 fps at 1440p on an M1 Air; Off tier still renders correctly without WebGL2.
- [ ] Reduced motion removes all flicker, grain motion, shafts drift and dust.

---

## 12b. Additions from the texture spec

- **Glint:** material glint above 0 plus top-of-ramp albedo flashes to `GOLD_HI` or `SLATE_3` under strong key light (single-pixel speculars).
- **Lightning:** uniform `u_flash` (0 to 1.8) multiplies the key light for storm flashes driven by `engine/weather.js`; same photosensitivity limits as `TEXTURE_SPEC.md` 7.1.
- **Wet:** material `wet` (sill, glass while raining) gets gloss 0.9 and glint 1.0.
- **Night twins:** the GPU path no longer uses painted `.night` sprites; night is entirely this spec's keyframes.

## 13. Open items

- Exact window rect, floor back line and key center per view must be measured from the art (placeholders in section 8).
- Whether the left and right views need their own visible light source (a lamp or a second window) so they are not only lit from off-screen.
- Whether `retro` palette snap becomes the default once seen in motion.
- Night: confirm moonlight through the window vs. a pure practicals-only look.
