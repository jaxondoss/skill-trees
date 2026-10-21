# FORGE room R3: panel review (40 questions)

Sources: `stills/full-room@2x.png`, `stills/window-zone@2x.png`, the Revision 3 spec, `room-prototype/ui/panel.js`.
**C** = creative panel, **F** = functional panel, **→** = what we take forward (feeds `PLAN.md`).

Panel corrections to keep in mind:
- The spec has **5 tiers (I-V)**, not X.
- The pet is a **dog**. The still's brown blob reads as a capybara or a loaf.
- The engine already draws the LEDs (3x3, after the LUT). The stills just don't show them.

## Glance and status

**1. Three "today" signals at a glance?**
- C: The brightest things are the sun, the red CRT and the floor patch, and none of them carries data. The statue and "72" are dim.
- F: The sun (today %), "72" and the veins. The window works. "72" is a tiny low-contrast box and the veins are too thin.
- → Light leaders = statue gold, sun (today %), and a bright, readable score/streak screen. The idle CRT is not saturated red.

**2. Done vs not-yet without text, under the orange grade?**
- C: There is no signal in the still. Use brightness, not hue: a cream-white core for done.
- F: The LEDs, drawn after the LUT. Shape steps: hollow ring for pending, half for Floor, solid with a white centre and dark keyline for done.
- → The LED contract stays. Add the white core and dark keyline, keep the LEDs out of the tint, and show them in the stills.

**3. Do the veins read as progress at phone size?**
- C: They read as decoration or lightning. Add a gold waterline rising from the feet. The blue rim outshines the gold.
- F: Decoration. A 1px vein is under 0.5 CSS px. Use 2px veins in full view and a rising fill line at the pedestal.
- → Finer kintsugi in the close-up, bolder branches in full view, and a pedestal fill gauge. Tone the rim down so the gold is always brighter.

**4. 15 skills: object identity vs prop blur?**
- C and F: They blur, because everything sits at the same value and saturation.
- → Every skill object gets a 1px lighter outline at rest plus its LED. Props drop one value step and are desaturated.

**5. Neglect without guilt?**
- C: A grey dust overlay with the LED off. Droop only on plants. Never darken the room, no cobwebs.
- F: One cue per object (dust cap, droop, cold lamp), low saturation, building at day 3/7/14, cleared by one log.
- → The engine's dust stays. Escalate at 3/7/14 days, one cue per object, no red.

**6. One obvious "start here" and an eye path?**
- C: There isn't one. The window dead-ends at the red CRT. Point the sun patch at today's top-priority object, which gets the only pulsing LED.
- F: The Today CRT is the start, but the statue is off the path. Point the patch at the pedestal and give the CRT a blinking cursor until the first log.
- → Eye path: window → statue → Today CRT (blinking cursor until the first log). The top-priority object gets the one pulsing LED.

## Interaction

**7. What is clickable, without hover?**
- C: A persistent LED plus a faint outline. First tap shows the plaque, second tap opens.
- F: An LED pip on every hotspot, an inspect mode, a one-time outline sweep, and hit areas of at least 44px.
- → LED on every hotspot, a resting outline, a first-visit sweep, and 44px minimum hit boxes on phone.

**8. Taps to log?**
- C and F: Two (Today CRT → row) from the full room. Long-press the Today CRT to log the next goal, with UNDO.
- F: No logging straight from a skill object at full view (mis-tap risk).
- → Two taps. Long-press quick-log with UNDO comes later.

**9. CRT as quick-log, and what is 72?**
- C and F: Yes, the big CRT is Today. A bare "72" means nothing. Label it ("72 OVR") or alternate it with the streak and a flame.
- → The small CRT alternates "72 OVR" and "12d" with a flame, and tapping it opens stats.

**10. "III · FORGED" plaque?**
- C and F: It reads as a name. Add pips (5) and an in-tier progress bar. The pedestal material steps up by tier.
- → Five pips plus an in-tier bar on the plaque. The pedestal stays t1..t5.

**11. Streak at day 1, day 30, the morning after a break?**
- C and F: Not visible in the still. Day 1 is one tally and an ember. Day 30 is a full calendar page and a bright flame. After a break: crack/glitch once, then a calm "0 · BEST 18", never lingering red.
- → Streak on the small CRT and calendar tallies. Play the break moment once.

**12. Does the window carry information?**
- C: It's mood now. Tie the sun height to today's %, and lit house windows count goals done.
- F: Position = real clock (time left), brightness = completion.
- → Sun position follows the clock and brightness/LUT follows completion. Lit houses come later.

## Reward and growth

**13. Reward moment?**
- C: A gold pour (about 1.2s), a tink, the LED on, under 2s, skippable.
- F: Mote → LED → vein pulse → tink, under 900ms, never blocking. At 100% the sun goes full gold with one room pulse (1.5s).
- → Under 1s per goal, non-blocking. A 1.5s day-complete pulse, skippable.

**14. Small vs big wins?**
- C and F: A session is a sparkle or mote plus a tink. A stage-up visibly changes the object. A tier-up or 100-day streak gets a camera glide plus a permanent prop.
- → Big wins leave a permanent mark in the room.

**15. Growth over six months without clutter?**
- C and F: Fixed growth slots with set capacity (case, shelf, medals, plants). F: when a slot is full, items merge into a prestige item.
- → The g0..g3 growth variants already exist. Add slot caps and merge-on-overflow later.

**16. Would a stranger see a dashboard?**
- C and F: No, a cozy room, and that's fine. Onboarding covers day 1.
- → No change.

**17. Tone: cozy, focused or melancholy?**
- C and F: Cozy-melancholy, a sleepy end-of-day feel. Tie mood to momentum and time: cooler mornings, warmer lamps on a streak, dimmer but never gloomy in a slump.
- → The LUT ladder already does this. Add a morning grade later.

## Accessibility and legibility

**18. Colour-blind cues?**
- C and F: These depend on hue alone: the red CRT, the green pennant, the red-green calendar ramp, amber/green LEDs, red chart lines.
- → LED shapes. Calendar cells use dot / check / X plus a light-to-dark ramp. Charts get arrows. Category colours carry no status.

**19. 375px?**
- C and F: The left wall, right-wall charts, calendar, spines and veins all smudge. Don't recompose. Default the pan to statue + window + CRTs, use zone snap, and at least 2 CSS px per art pixel.
- → Phone stops stay. Re-centre the default phone stop on the new centre.

**20. Which glyphs carry data?**
- C and F: The small CRT, the calendar and the plaque (at least 5px digits at 1x, legible at zone zoom). Sticky notes, charts and books are texture.
- C: The "11" looks like data, so cut it.
- → Cut "11". The data glyphs get 5px digits.

**21. Edges and corners?**
- C and F: The door/flyers, kitchen and gym (bike, rack, shoes) are cropped and underlit, 4 to 6 skills in all. Pull them inward and give each corner a lamp pool.
- → Roomier left sliver, gym pulled inward, and a lamp pool on each edge skill.

**22. Zones keep the sense of place?**
- C and F: Yes, the window crop holds. Keep 15 to 20% of the neighbouring zones visible, use the 450ms dolly, and pan sideways between neighbours.
- → No change, beyond re-deriving the focus boxes for the new geometry.

**23. Style consistency?**
- C and F: The sky has too many fine bands, the string lights are single-pixel twinkles, the statue rim is neon-like, and the veins read as line-art.
- → Sky in about 5 flat bands, 2x2 bulbs, a 1px flat rim (not neon), chunkier vein branches.

**24. First-time learning?**
- C: A 5-step walkthrough, then nameplates for the first 3 visits.
- F: A 7-step skippable tour, "?" sparkles on never-opened objects, and a "?" legend.
- → The existing help/tour. Add "?" sparkles later.

**25. Day-one room?**
- C and F: Promise, not bare. Plain obsidian with one gold seed at the chest, tidy stage-1 objects, outlined empty slots, day 1 circled on the calendar.
- → The t1 variants already do this. Add a seed point to statue t1.

**26. Nudging after missed days?**
- C and F: Only the dog moves to the neglected object, plus a slow LED blink. After 3+ days, a one-time "welcome back" on the Today CRT. No flicker, no sound, no loops.
- → Same.

**27. Pet as barometer?**
- C and F: Yes, but softly: asleep in the sun (on track), beside the neglected object (hint), zoomies on a tier-up. Never sad.
- F: Make the art an unmistakable dog.
- → A readable dog sprite now, with sleep and neglect poses. Zoomies come later.

**28. Weekly and monthly trends in the room?**
- C and F: The calendar is the monthly view. The right-wall chart becomes a 7-bar weekly / 14-day sparkline. Both readable at zone zoom, and tapping opens the panels.
- → Later (data-driven sprites).

**29. Ranking when several skills need attention?**
- F: "Never miss twice" first, then the Focus Rack pins, then the lowest score due today. The dog marks #1, the cap is 3, and the Today list uses the same order.
- → Adopt the F order.

**30. On track vs done vs behind from across the room?**
- C and F: Done = the brightest LED (about 2x) plus a lit object. On track = half or steady. Behind = the only state that moves (slow blink).
- → Matches the LED contract. Increase the "done" brightness.

**31. Real-world layer?**
- C and F: Use the real date, a real day/night cycle, and seasons and holidays. Skip live weather.
- → Same as the spec.

**32. Accessibility on an art canvas?**
- C and F: A DOM button per hotspot in zone order, aria-label "Strength, 52, done today", focus ring = canvas outline. Reduced motion: cuts, frozen ambience, instant fills. F: an "L" key for the status list.
- → The DOM buttons exist. Check the labels include the today state.

**33. Performance?**
- C and F: About 3 to 4 ms/frame at 30fps, ambience at 8 to 12fps, paused when hidden. Only the LEDs, gold, mote, sun and dog carry information.
- → Same.

**34. Customising the room?**
- C and F: No free placement. Allow skins and growth-piece choices, pet name, posters.
- → Fixed mapping.

**35. All-15 overview?**
- C: A brass "ledger" strip.
- F: The corner strip expands into 15 mini bottles (fill, LED, score); tapping one steps into its zone. "L" key.
- → The strip expands (F). Later.

**36. Statue vs skills?**
- C and F: Overall score (equal category weights). Map the 5 categories to body regions (arms, legs, torso, head) and highlight them in the statue panel.
- → Later.

**37. Sound?**
- C and F: Tink (pitch rising through the day), pour, three tinks on a level-up, one soft crack on a break. Off by default, offered once after the first log.
- → Same.

**38. Journal and milestones?**
- C and F: The desk notebook is the journal, the corkboard holds milestones and focus notes, and the bookshelf holds monthly-review volumes. Relics link to date and note.
- → Later.

**39. Meaningless props?**
- C: Cut the radiator (it competes with the CRTs) and put the relic niche there.
- F: Keep them for density, make Easter eggs (tram at your usual log time, plants grow with days logged), and cut anything next to a skill object that pulls attention.
- → Keep the density (owner preference). Tone the radiator down and cut the "11" and the poster that competes with the door.

**40. One daily hook?**
- C and F: A daily quest scroll on the Today CRT: one small personal quest. C: every 7th quest drops a cosmetic. F: a weekly mystery chest with the review.
- → Later: quest on the Today CRT, chest with the weekly review.
