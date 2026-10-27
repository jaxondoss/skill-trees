# Weather notes (engine/weather.js)

Live window weather for TEXTURE_SPEC 7.1, contract INTERFACES 7. Files:
`docs/redesign/room-prototype/engine/weather.js`, `docs/redesign/room-prototype/weather-harness.html`,
`tests/unit/weather.test.ts`.

## Licensing (owner decision needed)

The free Open-Meteo API is for **non-commercial use only**. A paid App Store release needs Open-Meteo's
commercial plan (or another provider) before launch. Swapping providers only touches `API_URL` and
`parseCurrent()` in weather.js.

## API

```
ROOM.weather = {
  state,            // {kind, code, precip, rawPrecip, cloud, wind, dir, slant, source, updatedAt, lastRainAt, error}
  init(),           // read flags, apply the cache, start polling (no network when any debug flag is set)
  draw(f),          // writes f.buf (and aux material 29 on bead/run glints); after items, before engine marks
  flash(now),       // 0..1.8 key-light multiplier (u_flash); 0 unless storm and motion allowed
  busy(now),        // true while rain/snow falls (wants ~24 fps) and from 150 ms before each flash
  hasAmbient(),     // true when anything weather-related animates
  ambientKey(now),  // changes whenever draw() would draw something different
  wet(now),         // sill wet: raining now or within 20 min after (wall clock)
  wind(),           // mph, for curtain sway (> 15) and leaf flutter (> 25)
  setDebug(o),      // {weather, precip, wind, dir, seed, drips, lightning, offline}; null clears a key; setDebug(null) clears all
  fetchNow(), stop(), pure, lut(name), lastMs
}
```
Pure helpers (`module.exports`, also `ROOM.weather.pure`): `stateForCode`, `isRainy`, `effectivePrecip`,
`dropDensity`, `windSlant`, `flashStart`, `flashSequences`, `flashAt`, `flashOnsets`, `patternLevel`,
`guardAllow`, `cacheUsable`, `pickSource`, `shouldFetch`, `isWet`, `parseCurrent`, `parseFlags`, `hash3`, `rnd`.

## What render.js must do (integrator)

1. Load `engine/weather.js` after `decode.js` (it needs `ROOM`, `ROOM.C`, `ROOM.art`), call `ROOM.weather.init()` once
   from main.js.
2. In `renderRest` (and `layerCanvas` for the window layers), after `drawItems(...)` and before the engine marks
   (`glow.post`, `fx.drawMotes`, `overlay.drawMarks`): `if (ROOM.weather) ROOM.weather.draw(f);`
   `f` needs `buf, aux, w, h, x0, y0, now`; it also reads `offs` (layers 1 and 2), `lutA, lutB, step` (CPU path:
   our colours go through the current light LUT; pass identity or omit for the GPU path).
3. Scheduler: OR `ROOM.weather.busy(now)` into `busy`, append `ROOM.weather.ambientKey(now)` to `ambientKey`,
   OR `ROOM.weather.hasAmbient()` into `hasAmbient`.
4. GPU: `opts.flash = ROOM.weather.flash(now)` per frame (same frames as the buffer flash).
5. Sill: switch the sill's material to 29 (`wet`) while `ROOM.weather.wet()` is true. Glass may stay 17 or become 29
   with flags bit3 set; both are treated as glass.
6. Curtain sway (7.2) and tree sway read `ROOM.weather.wind()`. Snow sill accumulation is art-side (not drawn here).
7. `ROOM.on('weather', ...)` fires on state changes; weather.js also calls `ROOM.invalidate()`.

## Assumptions

- `f.aux` byte 2 = material: 17 glass_window (outside scenery), 30 sky, 29 wet (glass when flags bit3, else sill).
  Only those pixels are written, except drips: 1 px forming under the sill lip and falling up to 6 px (any pixel),
  every 1 to 3 s per 24 px of lip. Turn off with `setDebug({drips: false})`.
- Palette: names through `ROOM.C` with fallbacks RAIN_0 57, RAIN_1 58, RAIN_HI 59, COOL_0 49, COOL_1 50, COOL_2 51,
  CREAM 31, HAZE 63, GLASS_DK 60, SLATE_2 24. Fog, overcast, storm and flash LUTs are built at runtime from
  `ROOM.art.palette.colors` (nearest colour within a cool/neutral subset, or a luminance ramp for the sky), so they
  follow whatever hex values the palette review settles on. The current art-v3.js still has 37 colours; indices
  37..63 need the r6 palette in render.js's RGBA table, or the rain pixels render transparent. The harness appends
  the TEXTURE_SPEC section 3 values to emulate that.
- Window facing for the wind sign: `views.<v>.lighting.window.facing` (compass degrees), default 0. Run lanes use
  `lighting.window.rect` when present, else the union of the glass seen in that view.
- `precipitation` from Open-Meteo `current` is used as mm/h as is (max of `precipitation` and `rain`). If it turns out
  to be a 15-minute sum, multiply by 4 in `parseCurrent`.
- A reload within 15 minutes of the cached reading reuses the cache instead of refetching.
- Night: `ROOM.state.night` picks darker rain colours and night LUTs.

## Behaviour summary

| State | Drawn |
|---|---|
| clear | nothing (early return, no mask scan, unless the sill is still wet) |
| partly | sparse procedural cloud deck on sky pixels (34%), slow drift |
| overcast | sky through a HAZE-ward ramp, 80% cloud deck |
| fog | sky and outside stepped toward HAZE in 3 levels (sky, mid, near), 2 dithered drifting bands |
| drizzle | cooler sky, 2 rain planes at half density, beads, no runs |
| rain | 3 planes, beads, 1 to 4 runs, drips |
| storm | darker deck, heavy rain, 4 runs, lightning |
| snow | 2 planes of 1 px flakes with sway |

Reduced motion: no streaks, runs, drips or lightning; beads freeze (generation 0), snow and clouds freeze, sky
stays at storm overcast.

Lightning: a sequence starts once per 16.5 s slot, jittered 0 to 8.5 s, so starts are 8 to 25 s apart; pattern
is full 2 frames, normal 1, half 1 (67 ms frames). A runtime guard also refuses any sequence within 8 s of the
last and any third onset within 1 s. Both are covered by the tests.

## Performance

Chromium headless, 556x352 buffer with the window composited in place, mean per `draw()` over 300 frames:
clear (wet sill) 1.2 ms, overcast 1.5, fog 1.6, drizzle 1.1, rain 8 mm/h 1.8, storm 1.8, snow 1.7 ms
(worst frames 3 to 5 ms, JIT and GC). About 1 ms of that is the full-frame aux scan for the mask; if the
integrator can pass the glass bbox, that scan can shrink to the window.

## Harness

`weather-harness.html` (open over file://): every state side by side, plus night and reduced-motion variants.
`?t=<ms>` freezes the clock, `?scale=2|3|4`, `?wind=0..60`, `?only=rain,storm`, `?noperf=1`. `window.H.perf(n)`
returns per-state timings.
