- 2026-11-13, pass V10: brisk entry and getting out while moving (VEHICLE_NOTES.md "Third request"), then the parachute
  (its "Parachute" subsection, added mid-pass). Game side only (src/, tools/, index.html, README); no Blender, no
  assets, no packages; `src/audio.js` and the voice lines untouched. Built against the packs as they were (the old slow
  entry and exit clips); A4 shipped the Tripo pack's fast car-enter, car-exit and heli-exit at 13:48, which the game took
  up by name, and the main measures were run again with them ("Clips at the end"). Every new move (bail, roll, jump,
  fall, landings, the parachute's) plays a stand-in built in the game from the packs' own poses until A4 ships it. Measured step-driven at 60 Hz
  (`demo.timeScale = 0`, `demo.step(1/60)`), pictures from `demo.render()` copied in the same task, viewport 1512 x 900
  (canvas 2268 x 1350) unless said. Load average 4.1 to 4.4 (`uptime`). The browser pane was shown for the first hour
  and hidden after (the app showed another panel; this session was not in any window, so it could not be shown again):
  the frame-time figures are step-driven for that reason (item 5).

  New: `src/exits.js` (the out-of-vehicle paths, the stand-ins, the follow camera), `src/para.js` (packs, crates, the
  canopy, its lines, risers and toggles, the ram-air flight), `src/exitreview.js` (the review calls), `tools/v10_real.js`
  (frame time of the paths). Changed: `src/vehicles.js`, `src/main.js`, `src/review.js` (one import, one spread),
  `index.html`, `src/style.css`, `README.md`.

  1. GETTING IN, BRISKLY (done; old clips, A4's shorter ones by name when shipped).
     - Before (`vehicles.js` V6-V9): T only within 2.6 m of the entry point; the walk always a tactical walk; at the door
       the player had to come to a stop (and its stop clip and a turn on the spot) and then a settle of 0.5 to 1.4 s with
       the stance stepping the feet to the clip's first frame.
     - Now: T within 5 m (`REACH`); a jog when the way to the door is longer than 2 m (`JOG_FROM`), the walk for the last
       1.2 m; if the straight way crosses the vehicle's footprint (car x +-1.05, z +-2.45; helicopter x +-1.3, z -4.6..4.0,
       0.35 m wider) the walk goes to the nearer end corner on the door's side first (`_detour`). The settle starts as soon
       as he is within 0.6 m at under 1.2 m/s (no stop first), runs a cubic from where he is at the speed he has to the
       clip's first frame (0.3 to 0.4 s, `SETTLE_MAX`), and the feet get what is left of the 0.4 s to finish their steps;
       the legs are told the cubic's own speed (main.js), and the empty hands' swing is eased with the pace (it dropped in
       one frame: right hand 4.46 m/s of change in the first try). The entry clip's contacts held from its first frame
       now come in with its join (0.3 s) instead of at once: the brisk settle leaves the feet 10 to 28 cm from the clip's
       first-frame places (`stats.walkEnd.feetCm`: car 20 to 28, helicopter 10 to 14), which the pins took in one frame.
       Controls from `events.handsOn`: a vehicle key held from there takes the seated pose at once (the clip's last pose
       eased into it) and the door, if open, shuts by itself in 0.55 s (`closers`).
     - Numbers (Tripo, `demo.entryReview`, step-driven): from 4.5 m behind the car's door, T to car-enter's first frame
       2.07 s; from 1.5 m 1.45 s; helicopter from 4.5 m 2.07 s. With the old clips handsOn is at 7.6 s of 8.0 (car) and
       9.13 of 9.43 (helicopter): seated 0.38 / 0.29 s sooner with a key held (`early` t 7.63 / 9.15). The door was
       already shut at handsOn in the old clips (A4's shorter clips shut it after handsOn: not testable yet).
     - `demo.chainReview('car')` (Tripo; from 3.2 m as before): joins at most 1.53 m/s (foot>walking 0.99, walking>entering
       1.25, entering>seated 0.06, seated>leaving 0.07, leaving>drawing 1.34, drawing>foot 1.53); V9 1.44. Nothing over 4
       but car-enter's own right hand at 3.85 s (4.01, as V9). In the walk: head 1.17, pelvis 1.21, root 1.13 (the settle's
       start), root jump 1.88 cm. Planted feet: slide at most 1.8 cm a frame, drift 7.1 / 6.1 cm (V9: 0.8 to 8.4 over runs).
       `chainReview('heli')`: joins at most 1.54 (leaving>drawing hand R), nothing over 4 anywhere (V9: 3.19 worst); slide
       0.92 cm a frame, drift 2.8 / 9.0 cm; root jump 2.12 cm in the walk.
     - EarthOnline civilian-m-01 (`showBody(1)`): `chainReview('car')` joins at most 1.78 (drawing>foot hand L), nothing
       over 4; `chainReview('heli')` joins at most 1.73, nothing over 4 (worst inside: foot L 3.71 in heli-enter).
     - `demo.enterExit` (contacts, worst over the clip, cm): Tripo car enter foot L 0.58 / exit 0.44, helicopter 0.10 / 0;
       EarthOnline car 0.87 / 0, helicopter 0 / 0.02 (as V9).

  2. OUT OF THE CAR AT ANY SPEED (done; car-bail and bail-roll are stand-ins until A4 ships them).
     - `vehicles.toggle()` seated in the car: over 8 m/s (`BAIL_SPEED`) -> 'bailing'; over 0.25 m/s (`STOP_SPEED`) ->
       `stopping` (main.js holds full brake, the wheel stays his; `vehicles.tick` starts car-exit once at 0.25 m/s); else
       car-exit. ('moving' and the 1.5 m/s refusal are gone.)
     - Bailing: car-bail plays through the entry/exit clip path in the car's frame (join 0.15 s); at its `events.release`
       (`exits.js release()`) the body leaves the car's frame for a frame F frozen at the car's pose (levelled; its pitch
       and bank let go over 0.3 s) and carried at the car's velocity at the body's place (`car.velocityAt`) plus a 2 m/s
       push away from the car's side; the rest of car-bail plays in F, then bail-roll from car-bail's last pose, anchored
       where the body is, turned so its own travel runs along F's velocity (the body's turn eased in by bail-roll's
       `events.ground`). From `events.ground` F's speed is bled off linearly to nothing by 85 % of the way to `events.free`
       (the slide): the roll's travel is the clip's own plus v^2-shaped by the speed. The root is on the real ground;
       the player's obstacle boxes stop the slide. At `events.free` with a movement key held, or at the clip's end, the
       hand-over to on foot (`'drawing'`: the guns on the back and drawn).
     - The car after: inputs held at none (`vehicles.tick`, `car.abandoned`), its engine braking it in gear while the box
       shifts down; at 4 m/s the engine stops (an idle governor would otherwise hold it crawling in first) and, since the
       model has no rolling resistance (V1), its brakes drag at 2 % (0.4 m/s^2) until it rests; its door shuts by itself
       0.25 s after release.
     - The join from the seated pose into an exit clip was blended in world space: at 80 km/h it held the body where the
       car had been (root 37 m/s in a frame). The join now keeps the root in the vehicle's frame (also for every entry).
     - Numbers (Tripo, `demo.bailReview(kmh)`, stand-in clips):
       | T at | path | release | ground | stands (hand-over) | slide (carried / distance) | door to standing | body, worst velocity change in a frame | camera |
       |---|---|---|---|---|---|---|---|---|
       | 20 km/h | brake, car-exit | stopped 0.50 s after T, car-exit 7.83 s (old clip) | - | 8.33 s | - | - | foot R 8.02 at car-exit's start (before the pin fix below) | - |
       | 40 km/h | bail | 0.42 s | 0.90 s | 2.40 s | 10.9 m/s, 5.4 m | 12.7 m | 1.85 m/s (car-bail -> bail-roll) | 1.18 m/s |
       | 80 km/h | bail | 0.42 s | 0.90 s | 2.40 s | 21.8 m/s, 10.7 m | 23.1 m | 1.85 | 0.82 |
       | 150 km/h | bail | 0.42 s | 0.90 s | 2.40 s | 41.2 m/s, 20.1 m | 41.4 m | 2.09 (feet at release) | 0.81 |
       The car rolled to rest 15 s / 120 m (40 km/h), 28 s / 335 m (80) and 55 s / 1.15 km (150, off the end of the 900 m
       straight onto the ground beyond) after the bail. After each: walked 1.15 m in 1 s, 7 rounds fired, back into the
       car by T and the walk (10.1 s with the old car-enter) and out again.
     - The stop's 8 m/s at the right foot: car-exit's pedal contact took the foot off the brake in one frame. Every
       contact a clip holds from its first frame now comes in with the clip's join (`_pinContacts`, `ju`), which also
       carries the 10 to 28 cm the brisk settle leaves the feet off (item 1). With A4's car-exit (item 6): see there.
     - Films (scratchpad `a3check/`): `v10_bail_20.jpg` (the brake lights, stopped at 0.5 s, the exit), `v10_bail_40.jpg`,
       `v10_bail_80.jpg`, `v10_bail_150.jpg` and `_witness` of each (a camera riding beside the body on the door's side).
       Seen: the door shoved up, the body out of the doorway in a crouch, down onto the road beside the car, a squat
       sliding along, up to standing as the car runs on, the draw. The stand-in has no roll (a squat that slides): the
       roll is A4's clip's to give.

  3. THE HELICOPTER ON THE GROUND, ENGINE RUNNING (done).
     - `toggle()` in the helicopter: skids on the ground and under 3 m/s -> heli-exit at once whatever the engine does;
       otherwise heli-jump (item 4). main.js: T sets the lever (collective) to 0; the shutdown wait is gone
       (`heli.exitWhenStopped`, the 'rotor' / 'flying' refusals and the HUD's "out when the rotor stops"); I and the
       shutdown are as they were. A helicopter on its side or back is not got into (`nearest`); main.js's `wreckWatch`
       puts such a wreck back on the helipad (cold, repaired) once it has lain still 5 s with the player 25 m away, and on
       a WASTED at once. Each time he sits, the assist's references are reset and the lever set to where the collective is
       (the helicopter may have flown on, empty).
     - `demo.heliGroundExit()` (Tripo): quick start, rotor 100 %, T: heli-exit (old 12.17 s clip) with the engine at
       flight, collective 0, the helicopter unmoved (0 m/s) and the rotor at 99.99 % after; walked, fired, back in by T
       with the engine running (`heliRunningOnReentry` true) and out again. Film `v10_heli_ground_exit*.jpg`.

  4. OUT OF THE HELICOPTER IN THE AIR, THE FALLS, WASTED (done; heli-jump, fall, land-roll, land-hard are stand-ins).
     - heli-jump plays in the helicopter's frame (join 0.15 s) to its `events.release`; then the body is ballistic: its
       hips leave at their own world velocity (the helicopter's, its turn's and the jump's, from the last two frames) and
       fly with gravity and air drag (`a = -g - (g/55^2)|v|v`, terminal 55 m/s), the pose hung off them; the rest of
       heli-jump plays on (its turn carried on), then the fall loop (0.2 s cross-fade). In a long fall the body goes
       belly-down as the speed builds (up to 72 deg, by speed 12 to 28 m/s and height 18 to 45 m) and comes upright for
       the ground. On contact (a foot at the ground or the hips under 0.45 m) by the vertical speed: land-roll (<= 9 m/s),
       land-hard (<= 14), WASTED (more); the landing clip starts at its `events.ground` where the body is, the hips held
       where they were for the frame (a root offset dying over 0.12 s: the impact) and the horizontal speed bled off as in
       a bail. WASTED: the stand-in lays the body face down; main.js fades the page to dark over 1.2 s with the word
       (`#wasted`, DOM, no material), 3 s after the impact `_respawn` stands him at the helipad's edge by its crate,
       facing the pad, on foot with both guns (the gun in the hands, nothing of the exit's hand-overs carried over), and the
       picture comes back over 0.6 s.
     - The empty helicopter: `heliControls(dt, false)` (cyclic and pedals centred, collective min(collective, lever) with
       the lever set to 0, the assist not consulted, the engine left as it was) and its own physics. From 3 m and 8 m it
       came down on its skids undamaged (and could be got into, running); from 60 m and 300 m it crashed (60 m: on its back,
       rotor struck); `wreckWatch` / the respawn put it back on the helipad.
     - Numbers (Tripo, `demo.jumpReview(h)`, hovering h m (radar) over the apron by the helipad, a private assist holding
       it until T; impact speeds measured at the contact frame):
       | hover | release | fall | impact vertical / horizontal | landing | stands | body, worst velocity change (outside the impact's 3 frames) | camera, worst change |
       |---|---|---|---|---|---|---|---|
       | 3 m | 0.68 s | 0.23 s | 7.73 / 2.33 m/s | land-roll | 2.22 s | hands 3.0 | 17.9 (the helicopter coming down on it: before the far-side camera) |
       | 8 m | 0.68 s | 0.73 s | 12.38 / 2.31 | land-hard | 3.93 s | foot L 2.75 (in the draw) | 2.58 |
       | 60 m | 0.68 s | 3.07 s | 31.2 / 2.0 | WASTED, on foot at 6.77 s | - | - | 31.2 (the helicopter falling past) |
       | 300 m, pack on, not opened | 0.68 s | 8.58 s | 50.9 / 0.8 | WASTED | - | - | 8.3 |
       After each: on foot, walked 1.15 m in 1 s, 7 rounds, back into the helicopter by T (running after 3 m and 8 m;
       after 60 m the one put back on the helipad) and out again. EarthOnline (8 m): impact 12.37 m/s, land-hard, the same
       checks pass.
     - Fixes found on the way: the release velocity first came from the flight model's body rates turned the wrong way
       (6.3 m/s of carried speed from a hover at 0.8 m/s): now the hips' own velocity; the body dropped the helicopter's
       hover attitude in one frame at release (feet 5.9 m/s of change): let go over 0.3 s; the follow camera stood behind
       the jumper, which is where the helicopter is, and was pushed through its roof as it came down (14 to 18 m/s of camera
       change): from 6 m/s of horizontal speed down it now looks at the jumper from the far side, the helicopter beyond.
     - Films: `v10_jump_3.jpg`, `v10_jump_8.jpg`, `v10_jump_60.jpg` (the word over the dark), `_witness` of each,
       `v10_eo_jump_8.jpg`. Seen: the door, the step out, the spread fall, the impact into a squat (3 m) or a deep crouch
       (8 m), up, the draw; at 60 m face down on the concrete, the fade, WASTED, standing by the crate.

  PARACHUTE (done; all its clips stand-ins). `src/para.js`; main.js builds a crate with a pack at the helipad's edge (on
  the yard side, 13.6 m from its centre) and one by the hangar's doors (-35.5, -83.2).
     - Pickup: walking within 0.95 m of a crate's pack, on foot (or in the draw), puts it on (no key); the crate's pack is
       back 30 s later; the soft marker is a column of light (additive, brightest at the ground, pulsing). Worn: placed
       every frame from the chest (`Spine2`) 17 cm behind it and 8 cm down (its place in the chest's frame taken from the
       body standing when it goes on, again for another body); the slung gun's stow place is moved 13 cm out
       (`para.packShift`, in the stow, the swap and the draw by how far the gun is on the back). Not shown while getting
       in, seated, getting out or bailing. HUD: "Parachute" with a small canopy icon in the top-right panel while worn.
     - In a fall with a pack: "Space open parachute" (HUD line, yellow) from 30 m up; Space: para-deploy (the stand-in:
       fall pose to hanging over 1.2 s, `pull` 0.1, `open` 0.55): the canopy streams out from the shoulders to 5.45 m above
       them and inflates (span, thickness, chord) from `open`, the speed falling to the canopy's with a 0.6 s time constant.
       Under the canopy (HUD: "A / D steer · S flare · W faster"): airspeed 10 m/s (11.8 with W), sink 5 (5.8), a toggle turns
       up to 60 deg/s with the bank it needs (to about 34 deg) and 2.5 m/s more sink, S pulls both (flare: 4 m/s and 1.2 m/s
       sink, about 1.5 s of it, then a mush at 5.6 m/s), the wind adds. Stand-in hang: the arms up, the hands IK'd to the
       toggles (over the shoulders, pulled down to the hips); with A4's clips the steer and flare poses are added over
       para-hang by the toggles and the toggles drawn at the palms. Down at <= 6 m/s: para-land (run-out); faster: the impact
       rules. The canopy then settles on the ground 4.5 m ahead, flattened, and sinks away by 4.3 s; the pack is used up
       (only if opened: a jump that never opens keeps it, until WASTED).
     - The canopy: 9 cells, 7.6 m span curved on a 6.2 m radius, 2.7 m chord, an airfoil section with the top skin dipping
       at the ribs, orange and off-white cells, dark mouths; 26 lines (A and C rows of the 10 ribs to the riser tops, the
       outer three trailing-edge points each side to the toggles), two webbing risers, two yellow toggles. Every mesh is in
       the scene from the start, hidden, so the warm-up draws it (no light in any).
     - `demo.paraReview(300)` (grass west of the helipad, heading west into a 3 m/s wind): pickup 2.3 s of walking; jump;
       opened at 150 m at 43.4 m/s; canopy straight: sink 5.29 m/s, over the ground 7.24 m/s (into the wind); turning:
       59.9 deg/s, bank 34.3 deg, sink 6.79; flare from 5 m: sink 2.27, 4.2 m/s over the ground; touchdown 3.15 m/s down,
       2.27 along: para-land; 96 m of drift; the hands' worst change 3.94 m/s at the opening, nothing over 4 outside the
       landing. `paraReview(60, { open: 45, at: 'tarmac' })`: opened at 45 m at 17.1 m/s, a 1.3 s left turn, flare at 5 m,
       touchdown 1.29 m/s on tarmac. Not opened from 300 m: WASTED at 50.9 m/s, the pack lost. After each landing: walked,
       fired, back into the helicopter (the wreck had been put back on the helipad).
     - Films: `v10_para_300_grass.jpg` (jump, free fall belly-down with the pack, the pull, opening, canopy, a banked
       turn, low, the flare, touchdown, the canopy settling, standing), `v10_para_60_tarmac.jpg`, `_witness` of each.
       First films were taken with the pane's tall 268 x 538 view (the tiles cropped its middle): the canopy filled them;
       the 1512 x 900 films are the ones to look at.

  5. CAMERAS, GUNS, WARM-UP, FRAME TIME (done).
     - Cameras: `BodyCam` (exits.js) starts on the first frame out from where the vehicle's chase camera is (a frame late
       at first: the camera stood still one frame, 21.9 m/s of change), springs (k up to 30) toward behind the way he goes
       (or the far side from a hovering helicopter), 4.6 to 8.6 m back and 1.7 to 4.2 m up, looking a little down; under the
       canopy 11 m back and 2.5 m up looking 3.5 m over the hips (both in the picture); WASTED pulls back and up; kept out of
       the car's and the helicopter's boxes; the last 0.6 s before `free` it eases to the on-foot camera's place. At every
       hand-over to on foot main.js eases from the last camera pose over 0.4 to 1.1 s (by distance) instead of cutting
       (also after car-exit and heli-exit: the helicopter's chase camera is 15 m back). Worst camera change in a frame:
       bails 0.81 to 1.18 m/s, jumps 2.58 (8 m), stop-exit with A4's car-exit 6.27 (the ease from the chase camera).
     - Guns: hidden in every out-of-vehicle mode (`stepOut`), shown on the back and drawn from the hand-over; checked in
       every film. No light added, removed or under a hidden ancestor.
     - Warm-up: the parachute's materials (nylon, webbing, handle, wood, toggles, the vertex-coloured double-sided
       canopy, the lines, the additive marker) are drawn in `PERF.warm`'s frame (the hidden ones revealed by it); the clips
       are data. Every path traced below built 0 render pipelines and 0 shader programs (`tools/v9_cost.js` hooks).
     - Frame time: the pane was hidden from about 13:40 (the page got no animation frames: 0 a second), so the game's own
       loop could not be run; step-driven instead (`tools/v10_real.js traced`: one frame = step + render + GPU done; the
       hidden page reads 0.5 to 2 ms slower than shown, V9), 2268 x 1350, fresh page loads, load 4.1 to 4.4:
       | path (from T, frames) | median / p95 / worst ms | over 22 ms | split step / render / GPU | pipelines built |
       |---|---|---|---|---|
       | car at 80 km/h, no T (baseline, 360) | 12.7 / 16.3 / 24.6 | 1 | 2.7 / 4.7 / 5.5 | 0 |
       | bail at 80 km/h (360) | 10.5 / 12.7 / 21.0 | 0 | 1.5 / 3.9 / 5.3 | 0 |
       | jump from 60 m, WASTED, respawn (540) | 9.5 / 12.8 / 29.1 | 1 (the respawn frame: the wreck put back, 20.7 ms of step) | 0.7 / 3.5 / 5.1 | 0 |
       | parachute from 300 m (2040) | 5.6 / 9.1 / 21.9 | 0 | 0.6 / 1.9 / 2.9 | 0 |
       | helicopter exit, engine running (960) | 9.5 / 11.7 / 16.2 | 0 | 0.7 / 4.4 / 4.3 | 0 |
       A first try of the bail on a page already used for other runs had 13 frames of 23 to 72 ms (and a later one 130 ms
       frames in plain on-foot frames: the hidden page's stalls V9 described), none with a pipeline built.

  6. STATE LEFT BEHIND, AND GETTING BACK IN (done). Every review call ends with `afterCheck`: on foot, walk 1 s, fire, the
     vehicle at rest (waited for), T from 4 m, seated, T, on foot. Passed after: stop-exit 20 km/h, bails at 40, 80 and
     150 km/h, heli ground exit (back into it running), jumps from 3 m, 8 m, 60 m (WASTED), parachute 300 m grass and 60 m
     tarmac (Tripo), jump 8 m (EarthOnline). `arrived()` clears the last exit (`exits.reset`, `stopping`, the door closer,
     `car.abandoned`); the respawn clears the clip, joins, the draw, the swap, the hits, the camera ease and the inertia.
     `release()` takes the seat's vehicleFit off and shows the helicopter's harness again. The early hand-over at
     `events.free` (tested before A4 shipped by giving the old car-exit a `free` at 4.6 s in the page): handed over at
     4.62 s of 7.83 with W held, the door (open) shut by itself in 0.53 s, 1.88 m walked in the next 1.5 s.

  CLIPS AT THE END. A4 shipped `vehicle-motion-tripo-v1` at 13:48 (its log: car-enter 3.50 s, car-exit 2.93 s with
  `free` 2.46, heli-exit 3.57 s with `free` 3.36; heli-enter still the old 9.43 s); the game took them up by name on the
  next page load, nothing changed in the code for it. The EarthOnline pack (`-ue5-v1`, 2026-11-12 23:05) still has the old
  four. Real at the end: Tripo car-enter, car-exit, heli-exit (new), heli-enter (old); EarthOnline all four old. Stand-ins
  (both bodies): car-bail, bail-roll, heli-jump, fall, land-roll, land-hard, para-deploy, para-hang, para-land,
  para-steer-l/-r and para-flare (the stand-in hang steers by IK). para-pickup has no stand-in: the pack goes on at once
  (see "Not done").
  Re-measured with A4's Tripo clips (fresh loads):
     - T from 4.5 m behind the car's door to seated: 5.60 s (was 10.10 with the old car-enter; with a key held from
       handsOn 5.52). From the stop of a 20 km/h car: car-exit at 0.50 s after T, standing (the hand-over) 3.43 s, the gun
       drawn 4.77 s (was 8.33 / 9.67); the stop's right-foot jolt gone (worst inside the stop path 4.32 m/s, car-exit's own
       left hand at 0.88 s). Helicopter on the ground, engine running: T to standing 3.57 s, drawn 4.90 s (was 12.15 /
       13.48); the rotor at 99.7 % after, collective 0, unmoved.
     - `chainReview('car')`: T to seated 5.9 s from 3.2 m (frames 10 to 363; was 10.4 s), exit 2.93 s. Joins at most 1.9
       m/s except leaving>drawing 3.96 (right foot at car-exit's end); inside A4's clips 4.0 to 4.32 (its gate's line is
       4.5, the chain's 4). The feet glide at the entry's start: right foot 5.24 cm a frame, 22.9 cm over the join (the
       settle leaves them 23 to 26 cm off car-enter's first frame, which now moves at once).
     - `chainReview('heli')`: exit 3.57 s; joins at most 1.59; inside heli-exit feet 4.1 to 4.33 (A4's own); slide 1.09 cm a
       frame, drift 9.9 cm. A first run with the walk's turn to the door at twice V9's rate read 14 cm a frame of "slide"
       (55 frames) in the walk: the turn rate is back at V9's (`dt * 5`).

  NOT DONE OR NOT VERIFIED
     - The game's own loop at 1512 x 900 with the pane shown (hidden from about 13:40; only step-driven figures above). A
       60 Hz display, a cold browser cache on the live site.
     - The roll itself: every bail and landing is a stand-in squat that slides (no shoulder roll), the fall a held spread
       pose with a slow flail, the WASTED body laid flat, the canopy hang by IK. They switch to A4's clips by name; nothing
       of A4's athletic clips could be checked in the game (their `events.ground` / `free` / `release`, root conventions:
       the code anchors each clip's root track at the body wherever it is, whatever its values).
     - para-pickup is not played even when shipped (the pack goes on at once); wiring it is a few lines in
       `para.update` (a ground-frame clip with the guns away, then the draw).
     - A4's shorter heli-enter (not shipped): `handsOn` controls and the door closing by itself after an early seat were
       tested only with the old clips, whose doors are shut by handsOn.
     - The entry's foot glide with A4's car-enter (above); the right foot's 3.96 m/s at car-exit's hand-over.
     - Sound of the new paths not listened to (the doors' shut sounds are played when they swing shut by themselves; no
       new sounds: no body-on-tarmac, wind, canopy flap).
     - The camera eased away from a jump camera collides with nothing but the two vehicles' boxes (buildings, trees: no).
     - A sliding body is stopped by the player's obstacle boxes only (buildings, the yard's walls); the car's barriers and
       tyre walls do not stop it; the body falls onto terrain only (a roof under a fall is not ground).
     - `demo.review()` on foot: every situation within its run-to-run spread (two runs of this code: idle 0.6 to 0.7,
       walk 1.8 to 1.9, jog 1.9 to 2.0, swap 2.5, reload 1.1, crouchIdle 0.0 to 0.1, rampUp20 3.0 to 3.2, stairsUp 3.0 to
       3.3 (V9: 2.4 to 3.3), grip 0 / 0 everywhere); frozen % moves by a few points between runs of the same code
       (burst 7 then 1, aimOnOff 3 then 0). No on-foot code path changed. `node --test test/dynamics.test.js
       test/hands.test.js`: 12 pass. `vite build` clean.
