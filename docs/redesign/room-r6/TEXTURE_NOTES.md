# Texture stream notes (art pass 6)

Files: `art/room-r6/textures.py`, `texture_check.py`, `materials.json`, `palette.json`, `palette_sheet.py`,
`test_textures.py`, `scripts/texture-metrics.py`, and the grain-check switch in `art/room-v3/merge.py`.
Sheets: `docs/redesign/room-r6/stills/palette-ramps@4x.png`, `docs/redesign/room-r6/stills/swatches@4x.png`.

## References

Only `refs/pixelized_theme_inspo.jpg` (the sunset room) was available. The owner also described a convenience
store at night in the rain and a SEGA bedroom at night; I did not have those images, so every calibration number
below comes from the sunset room and the v3.3 shells only.

The sunset room is not true pixel art. It is a smooth illustration with a pixel-style filter, saved as a JPEG.
`texture-metrics.py --pixel auto` looks at where strong colour edges fall. The best grid it found scored 0.10,
where 1.0 would be a perfect grid, at period 2, 4 and 8, with nothing dominant. So there is no native grid. I
measured it at 4 px and at 8 px. The 8 px grid (141 x 250) is close to FORGE's object density.

## Calibration (phase 0)

`python3 scripts/texture-metrics.py <image> --pixel 8 --colors 16 --crop ...` (crops are in source pixels).

| Source | var | iso | chk | max3x3 p99 | base share |
|---|---|---|---|---|---|
| ref quiet wall (top band, 8 px, 16 colours) | 33.5% | 4.9% | 0.5% | 5 | 29% |
| ref low wall behind plant | 52.7% | 18.2% | 1.0% | 6 | 18% |
| ref tile floor | 36.1% | 8.1% | 0.5% | 5 | 53% |
| ref CRT TV | 33.7% | 6.7% | 0.3% | 6 | 29% |
| ref stereo stack | 46.8% | 10.5% | 0.9% | 6 | 17% |
| ref plant | 53.3% | 21.4% | 1.3% | 7 | 22% |
| ref speaker | 36.4% | 8.4% | 0.5% | 6 | 22% |
| ref sky | 25.8% | 6.8% | 0.7% | 6 | 35% |
| v3.3 back wall `l2` | 1.8% | 0.0% | 0.0% | 2 | 92% |
| v3.3 ceiling `l3` | 5.9% | 0.4% | 0.9% | 3 | 90% |
| v3.3 side walls `l4` | 1.0% | 0.0% | 0.0% | 2 | 95% |
| v3.3 floor `l5` | 13.2% | 1.3% | 1.4% | 3 | 55% |
| v3.3 window | 34.0% | 0.2% | 0.8% | 3 | 32% |

At 4 px and 48 colours the reference reads 30 to 55% var and 5 to 20% iso. Those numbers are inflated by JPEG
noise and quantized gradients.

How I read these numbers. The reference is a lit image with gradients and line art, so its variation is an upper
bound. FORGE textures are albedo only, and the GPU light adds its own variation on top. The v3.3 shells are the
floor we must rise above. The reference's chk (at most 1.3%) and its p99 colours per 3x3 window (5 to 7) support
the spec's noise limits. The spec's 2.5% iso limit for solids is much stricter than the reference. I kept it on
purpose: that is the pixel-art discipline, clusters and not noise.

## Gate thresholds (texture_check.py)

Noise limits per material class, from `materials.json` `classes` (spec section 9, unchanged):

| class | iso max | chk max | max3x3 |
|---|---|---|---|
| solid (plaster, wood, stone, fabric, rug, cast iron, terracotta) | 2.5% | 1% | 4 |
| detail (leaf, book_cloth, paper) | 4% | 1% | 5 |
| glint (chrome, gold, ceramic, plastic, brushed metal) | 4% | 1% | 5 |
| dither (glass, sky, wet, painted metal) | 6% | 20% | 4 |
| speck (cork, soil) | 25% | 5% | 4 |

- max3x3 is gated as a share: at most 0.3% of 3x3 windows may exceed the class limit. A strict maximum would
  fail a 100k px floor on a single seam crossing. The report still prints the raw maximum.
- Material regions under 40 px are not measured (LEDs, bulbs, glints).
- Shell materials (plaster, wood_floor, wood_ceiling) are judged on interior pixels only. A wall or floor seen
  through a sprite's cut (animation frames, margins) has lone pixels at the cut that are not texture noise.

Richness floors. These apply in the front view, to whole shell surfaces (20,000 px or more) and to solid-class
objects of 600 px or more:

| surface | var | shades | basis |
|---|---|---|---|
| walls | 6 to 14% | 4 of the plaster ramp | v3.3 1.0 to 1.8%; spec 6 to 12%; widened to 14% so T5 Venetian fits |
| floor | 15 to 30% | 5 of the oak ramp | v3.3 13.2%; spec 15 to 24%; reference tile floor 36% (lit) |
| ceiling | 8 to 16% | 4 | v3.3 5.9%; spec 8 to 12%; still the quietest surface |
| objects (solid class) | 8 to 45% | 4 colours with 1%+ | see below |

- Objects: the spec suggested 25 to 40%. That figure includes outlines and drawn detail (the v3.3 objects
  averaged 25.6%). The gate measures each material region on its own, and a plain textured face reaches 10 to
  13% from texture alone. So the object floor is 8%. It stops flat objects without punishing simple ones.
- Paper, books, glint metals, glass and screens are not held to object richness. They carry drawn art or content.
- Area split: the base shade must be 55 to 78% of the area. This is gated on whole shell surfaces with
  `split: true` (plaster). Objects only report it: one object region spans faces drawn in different tones, so
  its mode is not the base of a single texture field. The floor is exempt because per-plank tones are the
  design (45 / 25 / 20 / 10 at T1).
- Hotspots: each silhouette pixel needs at least 2 ramp steps of contrast against the shell behind it, or it
  must be INK (selout's fallback). Contrast is |dL*| divided by the mean L* step of the backdrop's ramp. At most
  10% of a hotspot's silhouette may fail.
- Palette: 64 colours; indices 0..36 identical to r5; every LUT (R1..R4, NIGHT, DIM) and the darker / brighter
  tables map all 64.
- Determinism: pass `images2` (a second build) to `gate()`.
- Size: `bundle_path`, 3.0 MB raw and 900 KB brotli. The brotli module is not installed here, so the gate
  reports a zlib-9 size and does not enforce the brotli limit.

## Palette (owner review: palette-ramps@4x.png)

Indices 0..36 are unchanged. Of the 27 new colours I tuned six away from the spec values, so each ramp steps
evenly in L*:

| colour | spec | proposed | why |
|---|---|---|---|
| OAK_3 | #C0864A | #BC864B | L* 59, one full step above OAK_2 and just under AMBER |
| PLASTER_4 | #6B4C58 | #664955 | the plaster ramp now steps L* 8, 12, 16, 22, 28, 34 |
| COOL_1 | #2B3646 | #2E3B4F | the glass ramp was crowded at the dark end |
| COOL_2 | #3D4A60 | #4A5B76 | L* 38, so reflections read; it sat 44 L* under SLATE_2 |
| GLASS_DK | #1A2228 | #151B21 | one step under COOL_0 (they were 2 L* apart) |
| LINEN_2 | #8C7C6C | #7F6E5E | BROWN_2 > LINEN_2 > LINEN_1 > CREAM now steps about 22 L* each |

COOL_0 (#1E2632 to #1F2836) and LINEN_1 (#BFAE95 to #BCAA90) moved by only a few units.

Ramps follow spec section 3, plus five small accent ramps (stone, fire, crt, energy, violet), so every colour has
a ramp to step along. Stone is INK > BROWN_1 > HAZE > PLUM_1 (HAZE doubles as light stone).

How the tables were filled:
- LUTs for the new colours: each one follows the nearest existing colour of its own ramp, unless that colour is
  more than 25 L* away. In that case it follows the nearest existing colour overall.
- If the colour it follows is not mapped in that LUT, the new colour maps to itself. So R4 stays a pure
  identity.
- DIM and NIGHT never brighten a colour.
- darker / brighter for the existing 37 keep the engine's current fx.js and glow.js entries. Where those entries
  named colours that no longer exist (BROWN_0, INK_COOL, ROSE_*), they now point at real steps:
  - INK brighter becomes INK_2
  - TERRA_0 darker becomes TERRA_VD
  - SLATE_0 darker becomes SLATE_D
  - LEAF_0 darker becomes INK
  - PLUM_1 brighter becomes PLUM_2
  - CREAM darker becomes PAPER
  - first entries for the OAK colours, LEAF_3, SLATE_2 and PLUM_3
- New colours step one place down or up their ramp.

## textures.py summary

- Entry point: `apply(img, mat, surf, oid, names, attention, view, tier, seed=0, opts=None)`.
- Shell surfaces (kinds 1 to 3) and world structure (the object named `beams`, any `wood_ceiling`) are world
  consistent. Seeds come from (seed, name), and marks are tested per pixel in u, v using the pixel's footprint.
- Test result: 95.6% of 20,162 shared corner samples are identical between the front and right views. The rest
  are 1 px line placements where the two projections round differently.

## Open questions

1. Palette review: approve or adjust the six tuned hex values above.
2. Should existing-colour DARKER / BRIGHTER entries step to the new in-between colours (PLASTER to PLASTER_1
   rather than PLASTER_0)? I kept today's engine behaviour, so neglect dust looks the same.
3. Object richness floor (8%) versus the spec's provisional 25 to 40%: revisit after phase 5, when objects carry
   their selout and construction lines.
4. Tier items that are objects, not textures, are left to the build: T4 brass cup fixtures at the beam joints,
   T5 gold curtain tie-backs, T4 larger rug, pendant shades by tier.
5. The wear paths for the floor default to cross lines through the room centre. The build should pass the real
   walking lines as `opts["wear_paths"]`.

## Integration (art pass 6 build, after the texture stream)

What the build does around `textures.apply` (art/room-r6/build.py):

- **Order:** draw, assign materials, fill the margins with the neighbour views' *flat* albedo and surfaces, then
  texture the whole master. Re-projecting an already textured neighbour turned 1 px grain into checkerboards.
- **Materials:** objects with no table entry take their colour family, and their neutral colours (INK, VOID,
  PLASTER) take the object's main material, so an outline belongs to what it outlines. Before this fix, such
  objects kept the wall or floor ID underneath them.
- **Beams** are a shell name now, so they are in the ceiling plate (`l3`) with world-consistent texture.
- **Hotspots:** `selout(..., hotspot=True, add=True)` against the untextured shell. The export then applies the
  gate's own check against the textured shell behind it, and failing silhouette pixels (plus their silhouette
  neighbours, so the ink forms runs) become INK.
- **Source cleanup, the gate's rules applied where the art is made:**
  - `fold_lone`: a pixel with no same-colour neighbour inside its own region (same object, same material) takes
    the region's commonest neighbouring colour. A one-pixel detail in another material is its own region and
    stays. Specks of wall caught between parts of an object join the object.
  - `cap_3x3`: inside one region, a 3x3 window keeps at most the class's number of colours.
  - Neither touches the five shell surfaces or the emissive, glass, sky and speck materials (fold only).
- **Sprites:** sway frames carry their own frame's materials and whole moving objects (a crop through an
  object left cut-edge speckle). The dog, the sky drift, the streetcar, the close-up and the downlight have
  material maps.

Gate changes made during integration (texture_check.py):

- A wall, floor or ceiling material inside an object sprite (the backdrop seen through a sway frame or a
  close-up) gets the noise limits only. The whole surface is gated in its shell sprite.
- Margin plates get the noise limits only. They re-project the neighbour views' walls, which are gated there.
- Share-based noise limits apply to regions of 100 px or more (`MIN_NOISE`). In a 40 px region, two pixels
  move the share by 5%. The v3.3 grain check used 150 px.
- Drawn patterns (`PATTERN_SPRITES`, the chess table) skip the noise limits, and the build's cleanup leaves
  them alone (`KEEP_PATTERN`). A chess board is a checkerboard by design, and cleaning it scrambles the board.
- Wall, floor or ceiling inside an object sprite (the backdrop seen between swaying leaves) is skipped: sway
  frames copy those pixels from the shell plate, which is gated as a whole.
