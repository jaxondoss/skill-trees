# FORGE Texture and Materials Spec

**Version:** 1.0 (art pass 6, companion to `LIGHTING_SPEC.md`)
**Scope:** the art build (`art/room-r5/build.py` becomes `art/room-r6/`), the merge gate (`art/room-v3/merge.py`), the bundle format (`art-v3.js`), and the engine reads in `engine/decode.js` and `engine/render.js`
**References:** `pixelized_theme_inspo.jpg` (sunset room), convenience store at night in the rain, SEGA bedroom at night
**Decisions locked with Jaxon:** textures baked into the art plus a material map for the shader, full reference style, palette expanded to 64 colors, live texture from room tier, real weather and micro animation

---

## 0. TL;DR

FORGE's art rules ("flat clusters, 1 px dark outlines, no grain") were the right call for v3's chunky look. Now they are the ceiling. The references get their richness from **materials**: wood with grain, plaster with mottle, fabric with folds, and glass with reflections and rain, each with 5 to 7 shades, selective outlines and a clear detail hierarchy.

This spec adds:

1. A deterministic, perspective-aware **texture library** in the build.
2. A **64-color palette** with real ramps per material.
3. A **material ID map** per sprite that drives the lighting shader.
4. A **texture gate** that replaces the grain check.
5. **Tier upgrades, live weather and micro animation** as texture layers.

**Golden rule:** textures paint **albedo only**. Light, shadow, rim, reflections and night belong to the lighting pipeline. That one rule keeps the two specs from fighting.

---

## 1. Diagnosis of v3.3 (measured from the live bundle)

Main view. "Variation" = share of horizontally or vertically adjacent opaque pixel pairs that differ in color.

| Surface | Sprite | Dominant color share | Variation | Distinct colors |
|---|---|---|---|---|
| Back wall | `shell.l2` | 92.3% `PLASTER` | 1.8% | 4 |
| Side walls | `shell.l4` | 94.8% `PLASTER` | 1.0% | 5 |
| Ceiling | `shell.l3` | 90.5% `INK` | 5.9% | 7 |
| Floor | `shell.l5` | 55.2% `OAK_0` | 13.2% | 10 |
| Objects (93 decor + hotspot sprites) | n/a | n/a | 25.6% (weighted) | ~7 each |

- **Shell vs objects.** The shell is ~84% of painted pixels (~364k vs ~68k) and carries a fraction of the detail. Small dense objects float on large flat fields.
- **Walls.** Exactly two plaster colors (`PLASTER_0`, `PLASTER`). There is no ramp to texture with.
- **Floor.** Planks are single flat tones; only the seams vary. There is no grain, no knots and no wear. The satin reflection is **baked into the albedo** (`floor_reflection()`), which will double up once the lighting spec's real reflection ships.
- **Light is baked into the art.** Build step 3 quantizes a light field into 5 levels and remaps every pixel, plus painted `.night` twins for every sprite. That is the opposite of what the GPU lighting needs.
- **The gate blocks texture.** `merge.py` `GRAIN_LIMITS = [(600, 0.15, 0.03), (150, 0.30, 0.08)]` fails sprites with more than 15% isolated pixels or 3% checkerboards, and `decheck()` scrubs checkerboards before export.
- **Outlines.** A 1 px `INK` outline on nearly every object flattens form and makes everything read at the same depth.

---

## 2. What the references do (the target)

| Trait | Sunset room | Store (rain) | SEGA bedroom | FORGE v3.3 |
|---|---|---|---|---|
| Shades per material | 5 to 6 | 5 to 7 | 5 to 6 | 2 to 3 |
| Large-surface texture | wall mottle, tile grid | ceiling tiles, wall gradient | wall speckle, wood grain | none |
| Per-unit variation (plank, tile) | yes | yes | yes | plank tone only |
| Outlines | colored / selective | almost none | selective, dark only on silhouette | 1 px `INK` everywhere |
| Anti-aliased curves | yes | yes | yes (CRT, pillow) | no |
| Glass | reflections | rain, streaks, reflections | window reflections | flat |
| Fabric | curtains | n/a | soft folds, 5 tones | flat blocks |
| Specular glints | cables, speaker | bottles, cans | controller, cartridge | rare |
| Particles | dust | rain | dust and bokeh | dust (downlight only) |
| Detail hierarchy | dense mid, quiet corners | dense shelves, quiet ceiling | dense console, quiet wall | dense objects, empty surfaces |

Ten rules distilled from the references:

1. **Every material reads as itself** at a glance, from texture alone, before color.
2. **Texture is made of clusters, not noise.** Marks are strokes of 2 px or more following the material's direction. Single isolated pixels are reserved for glints and specks.
3. **Large surfaces have three scales of detail.** Macro (per plank, tile or panel tone), meso (mottle, folds, grain bands) and micro (strokes, specks).
4. **Ramps carry form.** 5 to 7 shades per material, with the base tone covering most of the area.
5. **Outlines are selective.** Dark outlines only where a silhouette meets a similar value. Elsewhere use the darkest shade of the object's own ramp, or no outline.
6. **Curves are anti-aliased** with one or two intermediate tones on stair-steps.
7. **Perspective applies to texture.** Grain converges to the vanishing point and marks get shorter and sparser with depth.
8. **Detail follows attention.** It is densest at the focal band (the knight, window, desk) and quietest at the frame edges and ceiling.
9. **Wear tells history.** Scuffs at chair height, worn paths on the floor, chipped corners and faded paper.
10. **Glass and screens are layered.** Bezel, glass tint, reflection streak, content and weather on top.

---

## 3. Palette: 37 to 64 colors

The existing 37 entries keep their **indices and values** (every LUT, `C.NAME` lookup and data reference stays valid). Indices 37 to 63 are new. Hex values are starting points for a palette review in phase 1.

| Idx | Name | Hex | Ramp / use |
|---|---|---|---|
| 37 | `OAK_VD` | `#2E1A12` | wood: deepest seam, knot core |
| 38 | `OAK_3` | `#C0864A` | wood: grain highlight, worn edges |
| 39 | `PLASTER_1` | `#2A1B26` | plaster ramp step 2 |
| 40 | `PLASTER_2` | `#43303B` | plaster ramp step 4 |
| 41 | `PLASTER_3` | `#553C49` | plaster ramp step 5 (patches, sanded) |
| 42 | `PLASTER_4` | `#6B4C58` | plaster ramp step 6 (chips, top lip) |
| 43 | `INK_2` | `#221E24` | ceiling and dark wood mid |
| 44 | `PLUM_0` | `#4A2E3A` | fabric deep fold (curtains, quilt) |
| 45 | `PLUM_4` | `#F0B8C6` | fabric ridge highlight |
| 46 | `TERRA_VD` | `#3F1312` | rug pile shadow, red runner deep |
| 47 | `SLATE_D` | `#2A3638` | metal deep, cast iron |
| 48 | `SLATE_3` | `#C4DADB` | chrome highlight band |
| 49 | `COOL_0` | `#1E2632` | cool shadow anchor (glass, shade side) |
| 50 | `COOL_1` | `#2B3646` | cool mid (window glass at night, steel) |
| 51 | `COOL_2` | `#3D4A60` | cool light (reflections on glass) |
| 52 | `PAPER` | `#D9C9A6` | paper, posters, book pages |
| 53 | `PAPER_DK` | `#A8987A` | paper shade, fold, aged edge |
| 54 | `LEAF_4` | `#B7CE74` | leaf translucent highlight |
| 55 | `GOLD_MID` | `#A47A30` | gold ramp mid (knight tiers) |
| 56 | `GOLD_HI` | `#F2D27A` | gold glint |
| 57 | `RAIN_0` | `#5D7FA6` | rain streak far, drop shadow side |
| 58 | `RAIN_1` | `#8FA9C9` | rain streak near |
| 59 | `RAIN_HI` | `#C9DAEE` | drop glint, run head |
| 60 | `GLASS_DK` | `#1A2228` | CRT glass, dark glass |
| 61 | `LINEN_1` | `#BFAE95` | sheets, pillow mid |
| 62 | `LINEN_2` | `#8C7C6C` | sheets, pillow fold |
| 63 | `HAZE` | `#4A3F4C` | fog, distance haze outside the window |

Resulting material ramps (darkest to lightest):

| Material | Ramp |
|---|---|
| Oak | `OAK_VD > OAK_DK > OAK_0 > OAK_1 > OAK_2 > OAK_3 (> AMBER accent)` |
| Plaster | `PLASTER_0 > PLASTER_1 > PLASTER > PLASTER_2 > PLASTER_3 > PLASTER_4` |
| Dark wood / ceiling | `VOID > INK > INK_2 > OAK_DK > OAK_0` |
| Plum fabric | `PLUM_0 > PLUM_1 > PLUM_2 > PLUM_3 > PLUM_4` |
| Linen | `BROWN_2 > LINEN_2 > LINEN_1 > CREAM` |
| Red pile | `TERRA_VD > TERRA_0 > TERRA_1 > TERRA_2 > RIM` |
| Steel | `SLATE_D > SLATE_0 > SLATE_1 > SLATE_2 > SLATE_3` |
| Gold | `GOLD_DK > GOLD_MID > GOLD > GOLD_HI > SUN` |
| Leaf | `LEAF_0 > LEAF_1 > LEAF_2 > LEAF_3 > LEAF_4` |
| Paper | `PAPER_DK > PAPER > CREAM` |
| Glass / cool | `GLASS_DK > COOL_0 > COOL_1 > COOL_2 > SLATE_2` |
| Rain | `RAIN_0 > RAIN_1 > RAIN_HI` |

**LUT completeness.** Every LUT (`R1..R4`, `NIGHT`, `DIM`) and the engine tables (`DARKER` in fx.js, `BRIGHTER` in glow.js) must map all 64 entries. Rule for new colors: `DARKER` = one step down its ramp, `BRIGHTER` = one step up, `DIM` and `NIGHT` follow the nearest existing color of the same ramp. The merge gate checks this (section 9).

---

## 4. Material IDs

Each sprite exports a second channel: one byte per pixel naming its material (255 = transparent). The engine writes it into the aux buffer, and the lighting shader reads its response from a material table keyed by **material ID** (this supersedes the palette-index table in `LIGHTING_SPEC.md` section 3.3, which stays as the fallback for sprites without a map).

| ID | Material | Emissive | Rim | Gloss | Rough | Transl. | Glint |
|---|---|---|---|---|---|---|---|
| 1 | `plaster` | 0 | 0.4 | 0 | 1.0 | 0 | 0 |
| 2 | `plaster_venetian` (tier 5) | 0 | 0.5 | 0.15 | 0.6 | 0 | 0 |
| 3 | `wood_floor` | 0 | 0.5 | 0.35 | 0.5 | 0 | 0.05 |
| 4 | `wood_furniture` | 0 | 0.7 | 0.1 | 0.7 | 0 | 0.05 |
| 5 | `wood_ceiling` | 0 | 0.3 | 0 | 1.0 | 0 | 0 |
| 6 | `fabric_cotton` | 0 | 0.4 | 0 | 1.0 | 0.15 | 0 |
| 7 | `fabric_velvet` | 0 | 0.9 | 0 | 1.0 | 0 | 0 |
| 8 | `rug_pile` | 0 | 0.3 | 0 | 1.0 | 0 | 0 |
| 9 | `paper` | 0 | 0.3 | 0 | 1.0 | 0.2 | 0 |
| 10 | `cork` | 0 | 0.2 | 0 | 1.0 | 0 | 0 |
| 11 | `metal_painted` | 0 | 0.6 | 0.2 | 0.5 | 0 | 0.2 |
| 12 | `metal_brushed` | 0 | 0.8 | 0.3 | 0.4 | 0 | 0.4 |
| 13 | `chrome` | 0 | 1.0 | 0.6 | 0.1 | 0 | 1.0 |
| 14 | `cast_iron` | 0 | 0.6 | 0.1 | 0.8 | 0 | 0.3 |
| 15 | `gold_metal` | 0 | 1.0 | 0.4 | 0.3 | 0 | 0.8 |
| 16 | `stone` | 0 | 0.5 | 0 | 1.0 | 0 | 0 |
| 17 | `glass_window` | 0 | 0.2 | 0.8 | 0.1 | 1.0 | 0.6 |
| 18 | `glass_crt` | 0 | 0.4 | 0.7 | 0.2 | 0 | 0.6 |
| 19 | `screen_emissive` | 0.7 | 0 | 0 | 1.0 | 0 | 0 |
| 20 | `plastic` | 0 | 0.6 | 0.2 | 0.4 | 0 | 0.5 |
| 21 | `leaf` | 0 | 0.8 | 0.1 | 0.6 | 0.5 | 0.1 |
| 22 | `soil` | 0 | 0.1 | 0 | 1.0 | 0 | 0 |
| 23 | `terracotta` | 0 | 0.6 | 0 | 0.9 | 0 | 0 |
| 24 | `ceramic` | 0 | 0.7 | 0.4 | 0.3 | 0 | 0.6 |
| 25 | `book_cloth` | 0 | 0.5 | 0 | 0.9 | 0 | 0.05 |
| 26 | `neon` | 1.0 | 0 | 0 | 1.0 | 0 | 0 |
| 27 | `bulb` | 1.0 | 0 | 0 | 1.0 | 0 | 0 |
| 28 | `flame` | 1.0 | 0 | 0 | 1.0 | 0 | 0 |
| 29 | `wet` (sill, glass rain) | 0 | 0.3 | 0.9 | 0.05 | 0 | 1.0 |
| 30 | `sky` | 0.6 to 1.0 by keyframe | 0 | 0 | 1.0 | 0 | 0 |

New shader responses that the lighting spec should add (small):
- **Glint:** pixels whose material glint is above 0 and whose albedo is the top shade of their ramp flash to `GOLD_HI` or `SLATE_3` when the key light is strong. This is the single-pixel specular in the references (controller buttons, bottles, chrome).
- **Rough:** scales the vertical streak length of the floor reflection (`LIGHTING_SPEC.md` 5.1); low roughness gives a sharper, more mirror-like reflection.

---

## 5. The texture library

New module `art/room-r6/textures.py`, imported by the build. Every function:

- Works in **world feet** on a surface defined in the camera's 3D frame (`pj` projects to pixels), so marks follow perspective and converge to the vanishing point.
- Takes `(region, ramp, material_id, seed, density, **params)` and writes **color and material ID** into the shared buffers, only inside `region`.
- Is **deterministic**. The seed is `hash(item_id, variant, surface_name)`, so editing one object never reshuffles another.
- Scales mark length and count with depth: `scale = F / (D0 + z)` (camera constants already in build.py), and density multiplies by the attention mask (5.12).

Shared primitives (new, in `textures.py`):

| Primitive | Does |
|---|---|
| `stroke(p0, p1, color, w=1)` | perspective line segment, never shorter than 2 px after projection |
| `cluster(center, size, color, shape)` | 2 to 6 px organic blob (no lone pixels) |
| `value_noise(x, y, scale, seed)` | smooth 2D noise, quantized later; used for mottle and wear masks |
| `quantize(field, ramp_slice, weights)` | turns a 0..1 field into ramp shades with a target area split |
| `aa_curve(mask, ramp)` | adds 1 to 2 intermediate pixels on stair-steps of curves 8 px or longer |
| `selout(sprite, ramp)` | selective outline pass (5.11) |
| `wear(region, mask, step)` | shifts shades one step lighter or darker along a mask |

Default **area split** inside one material (enforced by the gate, section 9): base shade 60 to 75%, one step either side 18 to 30%, two steps 4 to 10%, accents (glints, specks) at most 2%.

### 5.1 Plaster walls (`plaster`)

- **Macro:** 2 to 4 very large patches per wall (40 to 120 px) one shade lighter (`PLASTER_2`) with stepped, irregular edges. These read as repainted or patched areas. They replace v3.3's "flat plaster patches."
- **Meso mottle:** `value_noise` at scale 18 to 30 px, quantized to `PLASTER_1 / PLASTER / PLASTER_2` with a 15 / 70 / 15 split. Minimum cluster 3 px.
- **Micro:**
  - **Hairline cracks:** 3 to 6 per wall, 6 to 24 px polylines in `PLASTER_0` with at most one branch. They start from a corner, the window frame or the ceiling line, and one of every two segments gets a 1 px `PLASTER_3` lip on the side facing the window.
  - **Specks:** single `PLASTER_0` or `PLASTER_3` pixels at no more than 1.5% of the area.
- **Wear:**
  - **Scuff band:** at chair and desk height (Y 2.4 to 3.4 ft) behind furniture, `PLASTER_1` streaks of 3 to 10 px.
  - **Tape marks:** at the corners of where posters hang, 2x2 `PLASTER_3`.
  - **Nail holes:** single `INK` pixels with one `PLASTER_3` pixel under them.
- **Baseboard:** oak ramp, 1 px `OAK_3` top lip, 1 px `OAK_VD` gap line at the wall, sparse horizontal grain.
- **Do not:** paint light falloff, corner darkening or the window wash. The lighting handles those.

### 5.2 Wood floor (`wood_floor`)

- **Planks:** keep `floor_planks()` layout (0.72 ft width, staggered end joints). Per-plank base tone is drawn from `OAK_0` 45%, `OAK_1` 25%, `OAK_DK` 20%, `OAK_2` 10%, with no two neighbors equal.
- **Grain:** 2 to 4 strokes per plank segment running along z (toward the vanishing point), 30 to 70% of the segment length. Stroke color is one shade darker than the plank (or one lighter on `OAK_DK` planks), with at least 2 px spacing between strokes. Near the camera (z of 1.5 ft or less) planks get a second, shorter stroke family.
- **Knots:** about 1 per 6 plank segments. A 2x3 to 3x4 ellipse in `OAK_DK` with an `OAK_VD` core; grain strokes within 3 px bend around it.
- **Seams:** `OAK_VD` 1 px. Every 3rd to 5th seam run gets an `OAK_3` worn-edge pixel run (2 to 5 px) on its far side.
- **Wear paths:** a value-noise mask along the walking lines (entry, knight carpet, desk chair, gym) at scale 30 px. Inside it, planks shift one shade lighter and lose half their grain strokes (scuffed finish).
- **Remove** the baked reflection (`floor_reflection()`) and the baked sun patch from albedo in the GPU path. Both move to the lighting spec (sections 4.5 and 5.1). The fallback path keeps a simplified baked version (section 10).

### 5.3 Ceiling (`wood_ceiling`)

- **Beams:** `INK / INK_2 / OAK_DK` with sparse long grain (1 stroke per 20 px of beam length). There is a 1 px `OAK_0` lip on the undersides facing the window, and occasional 2 px check cracks.
- **Planks between beams:** alternate `INK` and `INK_2` with `VOID` seams, plus 1 grain stroke per 30 px.
- **Density cap:** the ceiling stays the quietest surface (variation target 8 to 12%, section 9). This matches the references' calm tops.
- **Skylight:** glass treatment from 5.6 at reduced strength.

### 5.4 Wood furniture (`wood_furniture`)

Applies to the bookcase, desks, TV stand, drawers, chairs, bed frame and window frame.

- **Grain direction:** horizontal on tops and drawer fronts, vertical on posts and sides.
- **Grain strokes:** 1 per 4 to 6 px of surface height. Long, low contrast (one shade).
- **Bevels:** 1 px top-front edge highlight one shade up (`OAK_3` on light wood) and 1 px underside shadow one shade down. This micro-geometry stays in the art because it is shape, not light.
- **Wear:**
  - Chipped corners: 1 to 3 px of the next lighter shade on 1 in 3 outer corners.
  - Handle grime: a 2 px darker halo around handles.
- **Handles and hinges:** `metal_brushed` or `gold_metal` with one glint pixel.

### 5.5 Fabric (`fabric_cotton`, `fabric_velvet`, `rug_pile`)

- **Folds** follow the form. Each fold is a 2-shade-darker valley line (1 to 2 px) with a 1 px ridge highlight on the window-facing side. Folds taper at the ends and are anti-aliased on curves.
- **Curtains:** vertical folds every 4 to 7 px, deeper near the tie-back, hem line at the bottom, rod pocket at the top, `PLUM_0` to `PLUM_4`. Material `fabric_cotton` with translucency, so the lighting can glow them.
- **Quilt:** quilting grid of 1 px stitch dots every 3 px along seams in one-shade-darker color, puffed panels with soft center highlight.
- **Sheets and pillow (`LINEN`):** 3 to 5 soft folds, pillow with a center dent and corner points.
- **Tapestry behind the knight:** woven texture of alternating 1 px vertical threads in two adjacent shades (allowed pattern, section 9), with the anvil emblem embroidered (raised: 1 px highlight above, shadow below).
- **Rugs (`rug_pile`):**
  - **Pile:** short 1x2 vertical dashes alternating between two adjacent shades at 20% density.
  - **Fringe:** 1 px strands every 2 px at the short ends.
  - **Motifs:** keep the gold star motifs, now with a `GOLD_DK` stitch outline.
  - **Wear:** worn edges and a flattened traffic lane one shade lighter.
- **Velvet (tier 4 to 5 curtains):** broader folds with a strong rim response from the material table; no ridge highlight painted.

### 5.6 Glass (`glass_window`, `glass_crt`)

- **Window panes:** content (sky, outside) stays as is. Over it go 1 to 2 diagonal reflection streaks per pane (2 px wide, `COOL_2` or `CREAM` at 30% coverage with dithered ends; dither is allowed on glass, section 9), plus a 1 px `GLASS_DK` inner frame shadow along the top and left.
- **CRT glass:**
  - **Bevel:** a 1 px `GLASS_DK` ring and a 1 px `COOL_2` highlight arc along the top-left 25% of the curve.
  - **Corners:** rounded with `aa_curve`.
  - **Bulge:** the screen content is barrel-shifted by 1 px at the four corners.
- **Weather layer:** rain sits on top of glass (section 7).

### 5.7 Metal (`metal_painted`, `metal_brushed`, `chrome`, `cast_iron`, `gold_metal`)

- **Painted metal (fridge, lamp shades):**
  - A soft vertical gradient in 3 bands with dithered transitions (dither allowed).
  - 2 to 4 chips per object (2x2 of `SLATE_D`).
  - A bright 1 px glint on the top edge.
- **Brushed (gym rack, desk lamp arm):** 1 px horizontal strokes in two adjacent shades at 25% density, plus 1 to 2 glint pixels.
- **Chrome (barbell, faucet):**
  - Hard alternating bands (dark, light, dark) with no soft transition.
  - A `SLATE_3` highlight band 1 px wide.
  - A `GOLD_HI` or `CREAM` glint at the brightest point.
- **Cast iron (kettlebells, plates):** a `SLATE_D` and `SLATE_0` mottle with 2 to 3 px clusters, a single glint pixel and painted weight numbers.
- **Gold (knight trims, medals, plaque):**
  - Uses the 5-step gold ramp.
  - Engraved lines are 1 px `GOLD_DK` with a `GOLD_HI` pixel on the lit side.
  - Glints at the convex peaks.

### 5.8 Paper, cork, books

- **Paper (posters, calendar, flyers, notes):** `PAPER` base with an aged edge band in `PAPER_DK` (1 px).
  - **Curled corner:** 1 in 3 papers, a 2 to 3 px triangle with a shadow pixel.
  - **Pins and tape:** pins as 1 px with a glint; tape as 2x3 `CREAM` at 50% coverage.
  - **Posters:** keep their own art but add a 1 px light border and slight fading (top shade removed from their palette).
- **Cork (corkboard):** the one place speck noise is allowed. 3 shades of oak at 40 / 40 / 20 with 1 px specks (gate exemption), plus pin holes.
- **Books:**
  - **Spines:** varied heights (±2 px) and a 1 px gold or cream title band at 1/4 from the top on half of the spines.
  - **Tops:** page tops visible on books lower than eye level, in `PAPER` with a `PAPER_DK` line.
  - **Shelf order:** 1 in 8 books leans 1 px, with a gap where one was taken.
  - **Material:** `book_cloth`.

### 5.9 Plants, soil, pots

- **Leaves:** midrib 1 px one shade darker; each leaf uses 3 shades plus a `LEAF_4` tip on the window-facing side (translucency); leaf edges anti-aliased on broad leaves.
- **Vines (hanging plants):** 1 px stems with a leaf cluster every 3 to 5 px, alternating sides.
- **Pots:** terracotta ramp with a 1 px `RIM` lip highlight and a darker band under the lip. Soil is a 2-shade `soil` mottle with 1 to 2 `OAK_3` specks (pebbles).

### 5.10 Knight and pedestal (`stone`, `gold_metal`, metals by tier)

- **Pedestal:** chiseled stone texture of short angular 2 to 3 px strokes in two adjacent shades. Rune channels are 1 px darker with the lit-side lip.
- **Armor:** each tier swaps the material (iron, then iron with gold seams, then gold trim, then gold plate, then full gold), and textures follow the material rules above. Energy lines keep their emissive treatment.
- **Brushed direction:** follows the plate curvature (vertical on legs, horizontal on the breastplate).

### 5.11 Outlines and anti-aliasing (selout)

Replace the blanket 1 px `INK` outline with a selective pass (`selout`), run per sprite after texturing:

| Edge situation | Outline color |
|---|---|
| Silhouette against a background within 1 ramp step of the edge pixel | `INK` (keeps separation) |
| Silhouette against a clearly darker background | darkest shade of the object's own ramp |
| Silhouette against a clearly lighter background | none; the object's edge shade does the work |
| Edge facing the window (lit side) | none (the shader adds rim) |
| Internal construction lines (drawer gaps, panel seams) | one shade darker than the surface, never `INK` |

**Anti-aliasing (`aa_curve`).** Curves and diagonals 8 px or longer on objects (pillows, CRT corners, round rug, kettlebells, leaves larger than 6 px) get 1 to 2 intermediate shades placed on each stair-step's outside corner. Never on hotspot silhouettes (see 5.13).

### 5.12 Attention mask (detail hierarchy)

A per-view grayscale mask (0 to 1) authored once in build.py from the camera frame:

- **1.0:** the focal band. Main view: the knight, window, TV stand and chess. Left view: bed and kitchen counter. Right view: the dropshipping desk.
- **0.7:** the mid ring.
- **0.4:** frame edges, ceiling and the bottom 15% of the floor.

All texture densities (strokes, specks, folds, wear) are multiplied by the mask. Macro variation is not, so large surfaces never go fully flat.

### 5.13 Hotspot legibility

Going "full reference" removes most black outlines, which risks hiding which objects are clickable. Required:

- Every hotspot sprite keeps **at least 2 ramp steps** of value contrast between its silhouette pixels and the backdrop pixels touching it, measured in the build. If it fails, `selout` falls back to `INK` on that edge segment.
- No `aa_curve` on hotspot silhouettes (it softens the shape the eye uses to spot it).
- The engine's resting outline and hover glow (glow.js) stay. Texture never paints into the outline ring (decode.js `ring`).

---

## 6. Room tier upgrades

The room already has tiers 1 to 5 (`ROOM.state.roomTier`, variant keys `t1..t5` chosen by `variantOf`). Today only a few decor items use them. This spec makes **materials themselves** upgrade, so leveling up visibly renovates the room.

| Surface | T1 (start) | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|
| Walls | bare plaster, 6 cracks, patches, scuffs | patched, 3 cracks, fresh paint patches | fully painted, 1 crack, light mottle | lower wainscot panel (oak), crown molding | Venetian plaster (`plaster_venetian`, sheen), no cracks |
| Floor | worn planks, heavy wear paths, mismatched tones | cleaned, wear paths halved | refinished: tones evened, gloss 0.35 to 0.5 | border inlay plank along walls | polished, gloss 0.65, rich `OAK_2` share +10% |
| Ceiling | bare beams, check cracks | same, cracks filled | beams stained darker, even | brass cup fixtures at beam joints | coffered panels between beams |
| Curtains | thin cotton, frayed hem | hemmed | fuller folds | velvet (`fabric_velvet`) | velvet with gold tie-backs |
| Rugs | worn edges, flattened lane | cleaned | new pile, crisp motifs | larger rug, border pattern | woven gold thread motifs (`gold_metal` stitches) |
| Fixtures | bare bulb pendants | shades on pendants | brass pendants | brass plus glass | gold plus glass, glint |
| Furniture wear | chipped corners, mismatched | fewer chips | refinished | trim details | gold hardware |

Implementation:
- Shell sprites (`shell.l2..l5` and the left and right shells) get `t1..t5` variants. The existing `variantOf` tier fallback (highest `tN` at or below the tier) already handles it.
- To keep size sane, tiers are built as **delta sprites** where possible: a `t3` wall variant stores only the pixels that differ from `t2` (`{"base": "t2", "delta": rle}`) and the decoder composes them (new in decode.js, section 8).
- Material table changes per tier come from the material ID (e.g., T5 walls use ID 2), so the lighting responds automatically.
- **Renovation moment:** when `roomTier` rises during a session, play the existing Bayer dissolve (16 steps, 1.6 s) from the old shell variant to the new one, plus 20 to 30 dust-puff particles from the walls (micro animation sprites, section 7.3), and a short sound cue if sound is on. Reduced motion: instant swap.
- Tier never goes down within a session. If the data's tier drops, the change applies on next load with no animation.

---

## 7. Live texture layers

### 7.1 Real weather

**Source:** Open-Meteo forecast API, fixed to the room's city (dorm preset: New Orleans, lat 29.95, lon -90.07). The device location is never used. Later presets use a city setting.

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude=29.95&longitude=-90.07
    &current=weather_code,precipitation,rain,cloud_cover,wind_speed_10m,wind_direction_10m
    &wind_speed_unit=mph&timezone=America%2FChicago
```

- Fetch on load and every 15 minutes while the tab is visible. Cache the last response with its timestamp in `localStorage` (wrapped in try/catch), use the cache if it is under 3 hours old when offline, else fall back to `clear`.
- **Licensing flag:** the free API is for non-commercial use. A paid App Store release needs Open-Meteo's commercial plan or another provider. Decide before launch.

**State mapping** (WMO `weather_code`):

| Codes | State | Window texture |
|---|---|---|
| 0, 1 | `clear` | as designed |
| 2 | `partly` | cloud sprites x2, slower drift |
| 3 | `overcast` | cloud layer covers 80%, sky through `OVERCAST` LUT (desaturate, toward `HAZE`) |
| 45, 48 | `fog` | far layers (mountains, then rooftops, then trees) stepped toward `HAZE`, 2 dithered fog bands |
| 51 to 57 | `drizzle` | light rain, beads only on glass |
| 61 to 67, 80 to 82 | `rain` | rain intensity from `precipitation` |
| 71 to 77, 85, 86 | `snow` | slow 1 px `CREAM` flakes, sill accumulates (rare in New Orleans, but supported) |
| 95, 96, 99 | `storm` | heavy rain plus lightning |

**Rain layers** (all clipped to the glass material mask, `glass_window`):

1. **Falling streaks outside.**
   - **Depth planes:** 3, with streaks 1x3 px (far, `RAIN_0`), 1x4 (mid, `RAIN_1`) and 1x5 (near, `RAIN_1` with a `RAIN_HI` head).
   - **Count:** scales with precipitation in mm/h, from 20 drops per 100x100 px at 0.1 up to 160 at 8 or more (log scale).
   - **Speed:** 180, 240 and 320 px/s by plane.
   - **Slant:** set by `wind_speed_10m`. Wind in mph divided by 40, clamped between 0 and 0.5 horizontal px per vertical px, with direction from `wind_direction_10m` (left or right).
2. **Beads on glass.** Static 1 to 2 px drops (`RAIN_HI` top, `RAIN_0` bottom pixel), density by intensity, reseeded every 20 s with a 400 ms dissolve.
3. **Runs.** 1 to 4 drops at a time slide down the glass at 20 to 60 px/s, wobbling 1 px, leaving a 1 px `COOL_2` trail that fades in 3 steps over 2 s.
4. **Sill.** Material switches to `wet` while raining and for 20 minutes after. That makes it glossy in the shader, with one drip pixel falling every 1 to 3 s.

**Lightning (storm).**
- **Flash:** the sky LUT steps to near white for 2 frames, back to normal for 1 frame, half for 1 frame, then normal.
- **Interval:** random, 8 to 25 s apart.
- **Lighting sync:** each flash triggers `LIGHTING_SPEC.md` key-light flash uniform at 1.8x for the same frames.
- **Photosensitivity:** never more than 1 flash sequence per 8 s and never 3 flashes within 1 s (WCAG 2.3.1).
- **Reduced motion:** no lightning at all; the sky stays at storm overcast.

**Wind:** outside tree sway speed and amplitude scale with wind speed (existing `sway` channel). Above 25 mph, leaves get a third flutter frame.

**Debug flags:** `?weather=clear|partly|overcast|fog|drizzle|rain|storm|snow`, `?precip=0..20`, `?wind=0..60`.

### 7.2 Micro animation

All micro animation is frame-based, palette-locked, and uses the existing anim channel system (`views.<v>.light.anims` and anim sprite frames). Budgets:

- At most 12 fps for any texture animation (most at 4 to 8 fps).
- At most 3% of frame pixels change per tick across all micro animation, excluding rain.
- Animation frames are stored as **delta sprites** (only changed pixels).
- Reduced motion: every item below freezes on its first frame (rain freezes as static beads).

| Element | Frames | Rate | Detail |
|---|---|---|---|
| CRT scanlines | 2 | 8 fps | every other row one shade darker on screen pixels, alternating |
| CRT roll bar | 1 band | 6 s loop | a 2 px band one shade brighter rolls bottom to top |
| CRT and monitor flicker texture | 3 | 6 fps | 1 to 2% of screen pixels shift one shade |
| Terminal scroll | existing | existing | keep |
| Curtain sway | 3 | 4 fps | bottom 30% of folds shifts 1 px, only in `rain`/`storm` wind above 15 mph or when a fan is on |
| Indoor plant flutter | 3 | 4 fps | 1 to 3 leaves per plant shift 1 px, staggered per plant |
| Hanging plant sway | existing | existing | keep, add 1 frame of vine tip lag |
| Candle flame | existing 3 | existing | keep |
| String light twinkle | per bulb | 2 fps | each bulb alternates between its two tones on its own seeded rhythm |
| Steam (mug, kettle) | 4 | 6 fps | 2 to 4 px wisps of `CREAM` at 50% coverage, rising and dissolving |
| FORGE neon buzz | 2 | irregular | 1 letter drops one shade for 1 frame every 4 to 9 s (lighting spec owns its brightness) |
| Dust motes | particle | 30 fps motion, palette steps | sprites defined here (1 px and 2x1), behavior in `LIGHTING_SPEC.md` 5.2 |
| Renovation dust puff | particle | 1.2 s | tier upgrade (section 6) |

---

## 8. Pipeline, format and engine changes

### 8.1 Build

- New pass folder `art/room-r6/` with:
  - `build.py` (forked from r5)
  - `textures.py`
  - `materials.json` (the table in section 4)
  - `palette.json` (64 colors)
  - `attention/<view>.png` (the masks from 5.12)
- The build paints **albedo only** for the GPU path. Remove from the GPU export:
  - the light-field remap (r5 step 3)
  - `floor_reflection()`
  - `wall_sun_patch()`
  - the tint passes
  - the painted rim pass
- Each sprite exports `<name>.<variant>.png` (indexed) and `<name>.<variant>.mat.png` (8-bit material IDs).
- **Fallback export.** One extra baked-light shell set per view (shell layers only, golden hour and night) for the Canvas2D path. Objects reuse albedo there; the existing overlay `drawLight()` lights them.

### 8.2 Bundle

- `images[path] = { w, h, rle, mat?: rle, base?: path, delta?: rle }`.
  - `mat` uses the same `[count, value]` RLE.
  - A delta stores 255 for "same as base."
- Drop the painted `.night` twins for the GPU path; night is the lighting's job. Keep a `NIGHT` LUT for the fallback. This roughly offsets the size growth from texture.
- **Size budget:** `art-v3.js` at most 3.0 MB raw and 900 KB brotli. Textured surfaces compress worse under RLE, so if the budget breaks, move the shell layers to indexed PNG files decoded through an offscreen canvas with an exact RGB-to-index map.
- Bundle split per view (`art-main.js`, `art-left.js`, `art-right.js`), loading the current view first and the others on idle.

### 8.3 Engine

- `decode.js`:
  - decode `mat` lazily (only when the GPU path is on)
  - compose deltas onto their base and cache the result
  - fix the header comment (indices go to 63, not 31)
- `render.js`: when blitting a sprite, write its material ID into the aux buffer's third byte (the lighting spec's aux buffer becomes `RGB8`: depth, flags, material).
- `fx.js` and `glow.js`: extend `DARKER` and `BRIGHTER` to the 27 new colors (rule in section 3).
- Weather: new `engine/weather.js` (fetch, cache, state, debug flags) and drawing hooks in render.js for the window layers, clipped by the glass material mask.
- Existing dust on neglected skills (fx.js `drawDust`) is kept unchanged.

---

## 9. The texture gate (replaces the grain check)

Delete `GRAIN_LIMITS`, `grain_check()` and the `decheck()` calls. Add `art/room-r6/texture_check.py`, run by `merge.py`. It has two sides: **too noisy** and **too flat**.

**Definitions** (per sprite, per material region):
- `iso`: share of pixels whose 4 neighbors all differ from them.
- `chk`: share of 2x2 windows that are checkerboards.
- `var`: share of adjacent pixel pairs that differ.
- `split`: area share of base, one step and two-plus steps on the material's ramp.
- `max3x3`: most distinct colors in any 3x3 window.

**Noise limits:**

| Material class | `iso` max | `chk` max | `max3x3` max |
|---|---|---|---|
| plaster, wood, stone, fabric, rug, metal_painted | 2.5% | 1% | 4 |
| leaf, book_cloth, paper | 4% | 1% | 5 |
| glint materials (chrome, gold, ceramic, plastic) | 4% | 1% | 5 |
| dither-allowed: glass, sky, metal_painted gradients, fog bands | 6% | 20% | 4 |
| cork, soil (speck materials) | 25% | 5% | 4 |

**Richness floors** (shell sprites and objects of 600 px or more, main view, before the attention mask):

| Surface | `var` target | Must use at least |
|---|---|---|
| Walls | 6 to 12% | 4 ramp shades |
| Floor | 15 to 24% | 5 ramp shades |
| Ceiling | 8 to 12% | 4 shades |
| Objects 600 px or more | 25 to 40% | 4 shades of their main material |

**Other checks:**
- **Area split:** base shade between 55 and 78% per material region.
- **Hotspot contrast:** every hotspot passes the 2-step silhouette rule (5.13).
- **Palette and LUTs:** every pixel is in the 64-color palette; every LUT and engine table maps all 64.
- **Determinism:** building twice produces identical bytes.
- **Size:** the bundle stays within budget.

**Calibration first.** The richness targets above are provisional. Phase 0 runs `scripts/texture-metrics.py` on crops of the three references (downsampled to their native pixel grid) and on the v3.3 shells, and the targets get set from those numbers before any texturing starts.

---

## 10. Interaction with the lighting spec

Order of work: ship **lighting phases 1 to 3** first (GPU compositor, multiplicative light, key and rim). Textures then go in as albedo, which avoids repainting baked light twice.

Changes this spec makes to `LIGHTING_SPEC.md` (already applied in the companion file):
- Floor section: plank seams, not tile grout.
- Material table keyed by material ID, with palette index as fallback.
- Aux buffer goes to 3 bytes.
- Glint and roughness responses added.
- Lightning flash uniform added.

**Fallback (no WebGL2):** v3.3-style look. Baked-light shells, albedo objects, overlay glows and vignette, NIGHT LUT at night. Weather draws, but there is no wet gloss.

---

## 11. Build plan for Claude Code

Each phase commits a **swatch sheet** still (`docs/redesign/room-r6/stills/swatches@4x.png`: each material as a 64x64 swatch at 4 light levels), the three view stills at golden hour, night and rain, and the gate report.

0. **Calibrate.** Write `scripts/texture-metrics.py`, measure the references and v3.3, and set the gate targets. Fork r5 to r6 with no visual change, and confirm parity.
1. **Palette and tables.** Add the 27 colors, update every LUT and engine table, and review the palette on a ramp sheet.
2. **Library and gate.** Write `textures.py` primitives and `texture_check.py`, delete the grain check, and add the material ID export with decode support.
3. **Shell.** Walls, floor and ceiling textured (T1), albedo only, in all three views. The richness floors must pass.
4. **Hero objects.** Knight and pedestal, window and curtains, bed, rugs, bookcase, desks, CRT and monitors.
5. **Everything else.** Remaining decor and hotspots, `selout`, `aa_curve`, attention masks and the hotspot contrast rule.
6. **Tiers.** T2 to T5 shell and material variants, delta sprites and the renovation dissolve.
7. **Weather.** `weather.js`, rain layers, fog and overcast LUTs, lightning with safety limits, and debug flags.
8. **Micro animation.** Scanlines, roll bar, steam, flutter, twinkle and curtain sway, within budgets and with reduced motion.
9. **Size and load.** Per-view bundle split, size budget, decode timing (current view decoded in 150 ms or less on an M1 Air), fallback check.

---

## 12. Acceptance criteria

- [ ] Placed side by side with the references at the same scale, every material in the room is identifiable from texture alone (blind test: someone names 8 of 10 materials from cropped swatches).
- [ ] Walls, floor and ceiling meet their richness floors; no sprite exceeds its noise limits.
- [ ] No lone pixels outside glint, speck and dither-allowed materials.
- [ ] Wood grain converges to the vanishing point in all three views.
- [ ] Every hotspot passes the silhouette contrast rule and is still identifiable with hover off.
- [ ] Raising the tier from 1 to 5 visibly renovates walls, floor, ceiling, curtains and rugs, with the dissolve.
- [ ] `?weather=rain` shows falling streaks in 3 depths, beads, runs and a wet sill; `?weather=storm` flashes within the photosensitivity limits; `?weather=fog` fades the distance.
- [ ] Reduced motion freezes all micro animation and removes lightning.
- [ ] Rebuilding produces byte-identical sprites; editing one object changes no other sprite.
- [ ] Bundle at most 900 KB brotli; first view decoded in 150 ms or less on an M1 Air.

---

## 13. Open items

- Final hex values for the 27 new colors (palette review in phase 1).
- Whether the progress-driven wear you skipped (dust and polish beyond today's neglect dust) comes back later; the existing neglect dust stays as is.
- Open-Meteo licensing for a paid App Store release.
- Room presets (beach house, penthouse, Tokyo, cabin) reuse the library; each needs its own material list (tile, concrete, tatami, log) added to `textures.py` when that preset starts.
