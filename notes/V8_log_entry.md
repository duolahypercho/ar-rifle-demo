- 2026-11-12, pass V8: the scenery made affordable and rebuilt (flora on by default again), and what V7 left unchecked.
  Originals copied to the scratchpad's `v8_orig/` (src, tools, test, README.md) before editing. Machine shared all
  through: load average 33 to 254 (other renders, two Blender processes, another Chrome renderer at 130 % CPU), the GPU's
  own "Device Utilization" 53 to 94 % with our page idle (`ioreg`). Every figure below is from one sitting, with its
  load. Packs measured against: `vehicle-motion-tripo-v1` 11:45:50 and then 12:05:22 (17 clips; a new 10.7 s
  `heli-exit`), `vehicle-motion-ue5-v1` 01:18:22 (13 clips, no entry or exit clips), rifle packs 11:15:18. No pack
  carried `vehicleFit.scale` or a `guns` track by the end (last checked 13:14).

  1. Frame time. Method (`tools/v8_cost.js`): one frame = `demo.step(1/60)` + `demo.render()` + `await
     device.queue.onSubmittedWorkDone()`, the game's loop held. V7's alternating blocks of 30 frames could not resolve
     a 2 ms budget here: two identical "off" blocks differed by up to 13 ms, and V7's own flora "on - off" read +9.5 and
     +34.1 ms in sittings 20 minutes apart. `inter()` instead draws one frame of each variant per round in a shuffled
     order (one unmeasured frame after each switch), 60 to 90 rounds, with an A/A pair (two copies of "off") as the
     noise floor; it reports each variant's median, p95, step, render-call CPU and GPU wait, and the median of the
     per-round differences against "off" with its quartiles. Cases: V4's car (main straight, 200 km/h, chase), cockpit,
     helicopter (100 m, 150 km/h) and `edge` (on foot at the yard's south edge looking south over the grass to the tree
     belt; V4's `foot` view looks over the paved yard, where there is no grass). "off" = flora, terrain, sky and
     furniture all off; "on" = all on (the mirrors on in both). Canvas 1536 x 1152.

     | case (12:44 to 12:47) | load | GPU util | off / off (A/A) median | on median | on - off | paired diff [quartiles] | render CPU off -> on | GPU wait off -> on |
     |---|---|---|---|---|---|---|---|---|
     | on foot, yard edge | 192 | 92 % | 10.0 / 9.8 | 11.6 | +1.6 to +1.8 | +1.9 [0.3, 2.6] | 5.9 -> 7.0 | 2.8 -> 3.0 |
     | car chase 200 km/h | 200 | 85 % | 18.5 / 18.6 | 19.6 | +1.0 to +1.1 | +1.5 [0.3, 8.5] | 9.7 -> 10.4 | 5.2 -> 5.4 |
     | car cockpit | 118 | 53 % | 9.9 / 10.1 | 11.7 | +1.6 to +1.8 | +1.8 [0.9, 2.5] | 5.4 -> 6.6 | 3.0 -> 3.4 |
     | helicopter 100 m (reloaded) | 96 | 53 % | 13.5 / 13.3 | 14.9 | +1.4 to +1.6 | +1.3 [0.0, 2.9] | 8.3 -> 8.9 | 4.0 -> 4.8 |
     | cockpit, mirrors only (on vs mirrors off) | 118 | 53 % | 11.3 (mirrors off) | 11.7 | +0.4 | +0.5 | 6.4 -> 6.6 | 3.3 -> 3.4 |

     Budget (scenery at most 2.0 ms, mirrors at most 1.3 ms in the cockpit): met in all four cases at the median; the
     on-foot paired difference (+1.9) is at its edge. A second on-foot run three minutes later (load 118, GPU 92 %): off
     10.8 / 10.7, on 12.6, paired +2.5 [0.1, 13.7] (a noisier minute). Flora is ON by default (`src/perf.js`).
     The same table on V7's code (`tools/v7.html`, the originals served from `tools/v7src/`, `?perf=%2Bflora`), on foot at
     the edge, 12:47 (load 94, GPU 87 %): off 7.3 / 7.0, on 8.3 (+1.0 to +1.3, paired +0.9), flora alone +0.5; V7's
     "off" two minutes later read 6.0 ms of render CPU and p10 8.4 ms, the same as V8's "off" (5.5 to 5.8, p10 8.1 to 8.4):
     the off state did not get dearer.
     The mirrors before the change (V7 rate, same table, 12:45, load 182, GPU 69 %): on 14.9 against 12.6 with mirrors off
     (+2.3; render CPU +1.7): over the 1.3 ms allowed. Now at most one mirror every second frame (was every frame), each at
     most every fourth (was third): each of three wanted mirrors is redrawn 10 times a second (was 20).

     What made it dear. Not reproduced: with V7's code, interleaved, the flora cost on foot +0.5 to +0.9 ms (edge, 944
     tufts), +0.4 ms in the grass (2462 tufts), about 0 in the car chase (1216 tufts); 45 ms was not seen in any view. The
     A/A pairs show why blocks misled: under this load identical blocks differ by 4 to 13 ms and the GPU wait of a block
     follows the other processes' work, so a block of "on" frames that falls on a busy stretch reads tens of ms. One
     amplification run (three extra copies of V7's grass, 11:39, load 45): +12 ms with the copies in both the pre-pass and
     the lit pass, about 0 with them in the lit pass only: the grass's cost was in the depth / normal / velocity pre-pass
     (its MRT: normals and velocity, the wind's position node evaluated for this frame and the last), not in the lit pass
     (opaque geometry on this tile-based GPU: hidden-surface removal keeps overdraw cheap). Draw calls: V8's scenery adds
     21 draws on foot (flora 11 before the bushes were merged, 9 after; terrain 4; sky 1; furniture 5), about 60 us of
     render CPU each under this load: the render-call CPU (+0.6 to +1.2 ms) is most of the cost now.
     What each change bought (all measured interleaved, edge case unless said): the grass out of the pre-pass, the
     cascades and the mirrors (layer 7): copies in the pre-pass +4 ms each (above); the trees as one draw per version
     (three shapes merged, each instance picking its own; the bushes inside the far version): 22 -> 10 -> 8 draws a frame
     for trees and bushes, render CPU on - off +1.5 -> +0.9 ms; the per-frame re-sort removed from the switch path
     (`apply()` re-sorted the trees on every switch: a measuring artefact of 0.3 ms); nothing behind the camera past 20 m
     (trees) or outside the view's sector (grass chunks): on foot 13 near + 101 far trees and 57 bushes drawn of 469 / 261;
     grass 2269 clumps drawn at the edge (V7: 944 tufts of 14 blades; now 20 blades each).

  2. The flora rebuilt (`src/flora.js`, new; `src/terrain.js` builds it). Grass: clumps of 20 blades (5 vertices, 3
     triangles each: curved, leaning outward, 1.1 to 2.0 cm wide, 0.22 to 0.54 m tall; a dark root, green, yellow-green
     or straw tips, one in four dry), each clump turned, sized 0.7 to 1.3 and tinted by its hash and by slow patches
     (`bareAt`, which also thins the cover and tints the ground under it greener and darker); a 0.36 m world grid in 8 m
     chunks, each chunk's clumps made once, cached and sorted by rank; kept while the rank is under the density at the
     chunk (1 to 7 m, then (7 / d)^1.5, 0 by 46 m); in the shader each clump shrinks into the ground over 0.1 of rank
     before its distance drops it and the remaining far clumps spread up to 3.2 x wider (no pop, the cover stays even);
     the chunks outside the view's half angle + 14 deg and beyond 6 m are not filled (refilled after 1 m of movement, 5 deg
     of turn or a zoom; about 0.2 ms); none above 60 m over the ground. Lit pass only. Bending: the blade turned about its
     root by an angle growing toward the tip (theta = min(1.4, 1.2 |push|) rad), keeping its length; push = wind (0.05
     m/s per m/s, with a flutter running downwind) + wash (1.9 k / (1 + (r / 9)^2) outward, shaking at 17 rad/s) + car
     (inside its footprint, a 4.6 m segment, out from its centre line and forward, by its speed); the tips take the
     sun's colour x 0.4 (dusk: orange-brown grass instead of black). Trees: round broadleaf (3066 triangles: trunk in two
     bent pieces, 6 boughs with twigs, 31 to 40 leaf sprays each a dark core and 14 double-sided leaves), tall broadleaf
     (2568), fir (407: trunk, eight whorls of 6 to 13 drooping needle strips over a dark inner cone); far versions of 150,
     150 and 58 triangles; 469 trees (199 as before plus 270 in 40 copses) and 261 bushes; sway: lean with the gusts (0.07 m/s
     per m/s at the top, height^2), a per-instance flutter, the leaves rustling by their own position, a lean away from the
     rotor wash. Shadows from one depth-only proxy (far versions of the trees within 170 m, bushes within 60 m) in the two
     near cascades.
     Pictures (scratchpad `v8/`): `v8_flora_foot_air.jpg` (midday and dusk, on foot at the yard's edge and from 100 m up),
     `v8_flora_car.jpg` (midday and dusk, chase at 120 km/h and cockpit), `trees_c.jpg` (round broadleaf, fir, a copse
     from 60 m, 100 m up), `trees_b.jpg` (the tall broadleaf, the field at midday and dusk), `flora_d.jpg` (the field,
     6 m up, 100 m up). Before: V7's `tod_foot_air.jpg`, `v7_damage_150_90.jpg`.

  3. Item 2 of the brief.
     a. `demo.enterExit('car')` (Tripo, pack 11:45): enter 8.02 s, contacts foot_l 0.58 others 0, root step 1.36 cm,
        crossings seat 12.6 (head, at 7 s) / wheel 4.5 / door 2.8 / shell 2.2 / interior 7.1; exit 7.82 s, contacts foot_l
        0.58 hand_r 0.87, root step 1.80, crossings 13.1 / 4.2 / 2.2 / 2.6 / 7.0: identical to V6 (`v8_enter_car.jpg`,
        `v8_exit_car.jpg`). `demo.enterExit('heli')`: enter 8.02 s, contacts foot_l 2.6 foot_r 3.15 (V6 2.23 / 3.01), root
        step 2.38 cm, crossings pilot_seat 7.4, interior 5.0, cockpit_door_R 4.0, cyclic 2.3, collective 2.2, fuselage 2.4;
        exit (the new 10.7 s clip) contacts 0 / 0 / 0 / 0, root step 2.10 cm, crossings pilot_seat 6.1, cyclic 3.1,
        cockpit_door_R 4.0, collective 1.0 (`v8_enter_heli.jpg`, `v8_exit_heli.jpg`: in the new exit the guns jump from
        the cabin places to the back between 4.1 and 6.7 s: the clip has no `guns` track yet).
        `demo.chainReview` (joins: the largest one-frame velocity change of hands, feet, head, pelvis within 12 frames of
        each join; root jump at the joins), against the 12:05:22 pack unless said:
        | body, vehicle | worst join (m/s) | where | root jump at joins (cm) | worst anywhere |
        |---|---|---|---|---|
        | Tripo, car, before the change below (four runs) | 1.86, 2.09, 2.30 | stowing > walking, right hand | 0.18 | hand_r 4.09 in stowing |
        | Tripo, car, final (two runs) | 1.90, 1.85 | stowing > walking, right hand | 0.18 | hand_r 4.09 to 4.10 in stowing / drawing; root 0.28 cm in leaving |
        | EarthOnline (body 1), car (placeholder entry and exit), final | 1.82 | drawing > foot | 0.18 | hand_r 3.42 in stowing |
        | Tripo, helicopter, final | 1.98 (five runs 1.96 to 2.12) | leaving > drawing, right hand | 0.18 | feet 6.2 in entering (heli-enter's step up); root 0.27 cm |
        | EarthOnline, helicopter (placeholder), final | 1.76 | drawing > foot | 0.18 | hand_r 3.42 in drawing; root 0.24 cm |
        Fixed: the stow's end into the walk to the door (right hand) was 1.86 to 2.30 m/s in a frame across four runs
        (`src/inertia.js`: that hand-over's inertial blend on the arms now 1.3 s instead of 0.35; 0.6 s read 2.00, 0.9 s
        1.99; the whole body at 0.9 s carried the root's offset into the walk's first turn: a 1.22 cm root jump on the
        way to the helicopter, so the body keeps 0.35 s). Not fixed: leaving > drawing after the new `heli-exit` reads
        1.96 to 2.12 m/s over five runs (right hand; a 0.6 s arm blend there read 2.12 and was taken out): at the limit,
        from where the clip ends the hand against the draw's start (clip pass). An earlier EarthOnline helicopter run
        showed a 2.9 cm root jump in the walk: the body had not finished loading (the run mixed packs); the clean run
        above has 0.24. Root jumps at joins 0.18 cm or less everywhere.
     b. Time of day, chase and cockpit of both at the four times: `tod_car.jpg`, `tod_car2.jpg` (night and dusk beams on
        the grass and a tree, from behind and the side), `tod_heli.jpg`, `heli_blob.jpg`, `tod_foot.jpg`,
        `night_vehicles.jpg`. Seen: headlamps light the road, the verge grass and a tree's trunk and crown at night and
        dusk; the cluster and centre screen readable and dim at night, the hands and wheel visible (cabin not black); the
        helicopter's displays readable at night, cabin grey not black; the character lit and visible on foot at dusk and
        night, the helicopter on its pad and the car (lamps on) visible from eye height at night. Fixed: the landing
        light's spot 15 m below was a blown-out disc in the cockpit at night (900 -> 320; `heli_blob.jpg` shows it is the
        lit ground, not the lens: with the lens dark the disc stayed); the rotor dust and tyre smoke were white blobs over
        a dark field at dusk and night (sprite light 0.42 -> 0.2 at dusk, 0.07 -> 0.025 at night); the hills were lighter
        than the night sky (night haze 0.02 -> 0.006). Not changed: at 15 m the helicopter's chase camera looks almost
        straight down (its own framing).
     c. Wash and car on the grass: `wash_grass4.jpg` (hover 6 m (wash k 0.46) and 3.5 m (k 0.75), side and from 14 m up,
        each beside the same frame with the grass's wash set to 0: the blades laid out radially under the disc),
        `car_grass.jpg` (the car through the grass at 60 to 63 km/h, frame by frame from the side and from above-behind,
        each beside the same frame with the car's push set to 0: the blades along the sills and ahead of the wheels
        pressed aside; with the push 0 they stand through the sills). The wash over grass now lifts 0.3 to 1 x the dust
        it lifts over bare dirt (by the cover).
     d. Damage, filmed from the hit side with the car lifted to open ground after the crash (`tools/v8_shots.js`
        crashFilm; `v8_damage_30_90.jpg`, `v8_damage_80_30.jpg`, `v8_damage_60_12.jpg`, `v8_damage_130_15.jpg`):
        30 km/h head-on dv 8.84 m/s, dent asked 16.4 cm (was 7.8), 14.9 cm worst vertex, the nose visibly pushed in, the
        right headlamp out; 80 km/h at 30 deg: the corner hit (dv 6.42) now dents (centred 0.35 m in from the collision
        box's corner, 2455 vertices, 12.9 cm asked), the flank (dv 6.0, 12.2 cm) scraped to primer, the right mirror
        folded; 60 km/h at 12 deg (a scrape, no dent): the right mirror folded; 130 km/h at 15 deg: flank dv 7.79, door
        dented 14.9 cm and scraped, the right mirror knocked off. Why the 80 km/h corner dented nothing: the contact is the
        footprint rectangle's corner (1.12, 0.45, -2.2 in the car's frame), where the body is rounded off: no panel vertex
        within the dent's radius (0.33 m; the nearest 0.35 m away), so 0 vertices moved. Fix: a dent with no vertex within
        half its radius is centred on the nearest panel vertex. Mirrors never folded in V7's runs because the flank
        contact is reported at the middle of the flank (0.6 m from the mirror) and the rule asked for 0.55 m: a flank flat
        on the wall (within 18 deg) on the mirror's side now folds it (or knocks it off over 7 m/s). (`measure().worstCm`
        includes a folded mirror's housing: 31.2 cm.)
        The helicopter: a 6.2 to 6.3 m/s touchdown rolled right: cross tubes bent L 19.4 / R 25 cm, the body sits 22 cm
        lower (y -0.053 -> -0.271 m) and rolled 1.66 deg (`heli_skid_before.jpg`, `heli_skid_after.jpg`); a flare to 36
        deg nose up at 3 m: tail strike 44.1 kN, flagged, tail rotor struck (over 15 kN; `heli_tailstrike.jpg`).
        Tyre walls: two rows, and a deformable barrier per stack group in the car's physics (`dynamics.js` `_soft`: no
        push-out; F = share (k d (1 + d / 0.5) + c min(1, d / 0.25) v), k 35 kN/m, c 45 kN s/m, friction 0.7, share = the
        car's width against that group / 2 m). Square on at the hairpin's wall: 30 km/h stopped in 0.15 s over 0.45 m,
        rebound 0.54 m/s; 60 km/h 0.15 s, 0.78 m, mean 10.8 g, rebound 1.08 m/s, no dent; 90 km/h 0.12 s, 1.09 m of the
        1.64 m, mean 18.8 g, rebound 1.83 m/s, the left headlamp out. The concrete behind alone at 60 km/h: stopped in one
        frame, rebound 3.74 m/s, a 26.7 cm dent. (A first version had all thirty groups 4.1 m long on the hairpin's inside,
        where they are 1.5 m apart: three to five engaged at once, 14 to 37 g; sized to their spacing and shared by width.)
     e. The PFD at the game's render scale (1536 x 1152 canvas, 1:1 crops): from the default eye (`h_pfd_default_1x_v8.jpg`,
        x3 nearest `h_pfd_default_x3_v8.jpg`) the PFD is about 140 px wide, figures 4 to 5 px: not readable, and the top
        of the screen (annunciators, tape tops) is under the glare shield. Leaning as V7 left it (`pfd_lean_try.jpg`), the
        glare shield's lip hid the top 15 % of the PFD in every pitch / forward pair tried. Now the head also drops 0.2 m
        (pitch -0.5 rad, 0.2 m forward, 30 deg field; `pfd_lean_try3.jpg` shows four settings): `h_pfd_lean_1x_v8.jpg`,
        1:1, the PFD 760 px wide: ATT / HDG / HOVER / SAS, IAS tape figures (60, 40, 20) about 14 px, the ladder (10, 20),
        ALT 200, the boxed 0, RA 0, HDG 000 and the heading scale (33, N, 03), the soft keys: all readable.
     f. `demo.vehicleReview()` has a `lapReal` row (the physics rows keep the ground off): one lap on the world as played
        (terrain, furniture and tyre walls on), pure pursuit 10 to 30 m ahead with speed, up to 160 km/h, bends at 0.85
        g, braking at 7 m/s^2: lap 90.08 s, the furthest wheel 5.03 m from the centre line (half width 6.5), 0 frames with
        a wheel off the tarmac or kerb, 0 frames with a wheel in the air, spring travel front -0.050 / +0.039 m and rear
        -0.040 / +0.036 m from static, peak tyre load 8.28 kN, peak vertical acceleration 0.06 g. (The track and 18 m round
        it are flat by construction: the suspension sees the kerbs and the road's own texture only.) Two first drivers
        left the track (1.0 g and full throttle out of the first hairpin: a spin; a fixed 28 m look-ahead in the 20.8 m
        hairpin: onto the dirt); the row's numbers are the driver's as much as the car's.

  4. Item 3 (the clip pass): packs seen during the run: `vehicle-motion-tripo-v1` 11:45:50 (17 clips, new `heli-exit`
     10.7 s, the car-exit unchanged by the enterExit numbers), 12:05:22 (17 clips; no `scale`, no `guns`);
     `vehicle-motion-ue5-v1` 01:18:22 (13 clips: no EarthOnline entry or exit clips, placeholders used); rifle packs
     11:15:18. `scale` and `guns` therefore still untested against real data; nothing to film for them. Chains and
     enterExit above ran against 11:45:50 (car enterExit, the first car chain) and 12:05:22 (the final chains and every run after 12:10).

  Regression (end, 13:00 to 13:14, load 118 to 217): `node --test test/dynamics.test.js` 8 pass, `test/hands.test.js` 4 pass,
  `tools/heli/flight.test.js` 19 pass, `node tools/heli/run.js` 65 PASS 0 MISS 46 reported only, `tools/heli/report.txt` identical but for the run times. `demo.review(...)` (13:00, load about 130):
  idle 0.6, walk 1.8, jog 1.9, aimHold 0.9 (frozen 6), burst 0.9, reload 1.2, swap 2.5, crouchIdle 0.6 (a second run
  0.1), rampUp20 3.0 (sink 0.1), stairsUp 2.8 (sink 0.5; a second run 3.1 / 0.5), grip 0 / 0 everywhere. Against the
  main session's V7 check: stairsUp 2.1 / 0.1 -> 2.8 to 3.1 / 0.5; V7's own code served beside it (`tools/v7.html`) gave
  stairsUp 3.0 / 0.6 and crouchIdle 0.1 in the same minutes: not from this pass (the rifle pack of 11:15 or the shared
  body; not chased). `demo.vehicleReview()`: 0-100 2.98, 0-200 8.53, upshift 0.10, top 348.78, 100-0 30.21 m 1.268 g
  1.368 deg, skidpad 1.165 at 102.28, skidpad200 1.284 at 207.07, roll 2.673, dive 0.826, slalom 0.792, liftOff 13.14 %,
  powerOver 2.679 / 6.789, standstill 0, wheel 2.13 %, kerb 3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock 420 deg hands
  off 0: identical to V7. Palms skidpadLimit 1.52, skidpad200 2.46, rollPitch 1.25, slalom 1.07, liftOff 1.53, powerOver
  1.24, lockToLock 0.6 (V6's figures exactly; V7 1.3, 3.71, 1.27, 1.09, 1.12, 1.44, 0.38: the pack of 12:05), hips 0.94.
  `demo.heliReview()` (68 rows, no failures): start 35.82 s (quick 8.67), hover 70.75 % / 81.83 % (2500 kg), climb 9.36 m/s,
  cruise 69.99 % pitch -2.258, turns 1.178 / 1.454 g, autorotation 10.305 m/s at 102.1 % Nr, flare 1.226, gentle 0.317, firm
  2.819, reach 0 at all 11: identical to V7. `demo.heliReach()`: palms 0.00 and soles 0.0 cm at all 11.
  `demo.vehicleReview('lapReal')`: as in 3f.

  Physics changed on purpose: the tyre walls are obstacles now (soft; only at the north hairpin's run-off, 21.4 m off the
  centre line; no review scenario reaches them); the dent depth law; the mirror fold rule; the landing light's
  intensity; the lean's eye. `src/audio.js` and the voice lines in `src/main.js` untouched.
  Files. New: src/flora.js, tools/v8_cost.js, tools/v8_shots.js, notes/V8_log_entry.md. Changed: src/terrain.js (flora
  out to flora.js, copses, the ground's tint, tyre walls as soft obstacles in two rows, `show`), src/look.js (the
  pre-pass without the grass layer; dusk / night sprite light; night haze), src/perf.js (flora on; '+' in the address),
  src/main.js (the camera sees the grass layer: one line), src/mirrors.js (the grass layer out; the rate), src/damage.js
  (corner dents, depth law, mirror fold on the flank), src/car/dynamics.js (`_soft`), src/heli/heli.js (dust over grass,
  landing light, the lean's head drop), src/review.js (`lapReal`), src/inertia.js (per-hand-over arm blend time), README.md ("Vehicles, pass V8"). Temporary
  (removed at the end): tools/v7src/, tools/v7.html (V7's code served for the side-by-side measures).
  Not verified: sound; enterExit after the inertia change (it changes only the walk's start after the stow); the scenery's cost on a quiet machine (every figure is under another process's GPU load: the
  budget is met at the median in these sittings, not proven elsewhere); the grass from the cockpit at speed in motion
  (stills only); a hand-flown landing on grass; the tyre walls hit at an angle; the EarthOnline walk-to root jump; the
  `scale` and `guns` contract (no data).
