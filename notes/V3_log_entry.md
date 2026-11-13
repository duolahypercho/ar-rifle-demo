- 2026-11-11, pass V3: shadows past the box, the helicopter's cockpit view, push-pull steering, the clearance
  readings, the 0.94 cm palm offset, tyre smoke, guns in the cabins, the sound measured offline, frame cost, and the first enter / exit clips.
  10. Enter / exit clips. The Tripo pack was re-shipped at 23:14 with car-enter (241 frames), heli-enter (223) and
     heli-exit (181); car-exit is not in it, so getting out of the car is still the placeholder. All three run end to
     end on the pack path: root track in the vehicle's frame, the door track on the real door (car door_L to 1.0; the
     helicopter's door only to 0.60 = 41 deg, as the clip's track has it), contacts pinned on the live nodes,
     vehicleFit applied from arrival, the guns on the back until the door shuts (then in the cabin) and back on the
     back as it opens. Game-side faults found and fixed on the way: (a) pins switched on and off in one frame -> eased
     over 4 frames at each end; (b) the arm and leg IK bent with a fixed pole -> the clip's own elbow / knee; (c)
     `_arm` replaced the clip's fingers with the rifle grip's curl (on the handle, the glass) -> the clip's fingers
     kept; (d) 'ball' contacts are the sole under the ball (body table ballSole, 1.66 cm under the joint) and V2 put
     the joint on them, the foot 1.7 cm into the ground, skid and pedals -> the sole on them (clip path only; the
     seated layers still use the joint, so the seated soles sit 1.7 cm low: next pass); (e) the cut from the clip
     into the seated loop jumped the right palm 14.9 cm and the left foot 6.3 cm in one frame -> a 0.3 s ease from
     the clip's last pose, the loop started at its frame 0 (largest step in the 25 frames after the cut: 1.4 cm);
     the same ease from the standing pose into the clip's first frames and from the seated pose into an exit clip;
     (f) heli-enter's last 16 and heli-exit's first 10 frames hold the collective's grip at 13 deg (mid travel; the
     clip's palm is 0.1 cm from the contact only with the lever at 13 deg) but on the ground the lever is down at 4
     deg, 7.9 cm away and out of reach (pinned error 7.5 cm) -> the collective-up / -down pose clips are added while
     the left hand holds the collective, as the seated layer adds them.
     Palms and soles against their holds at full pin weight (worst over the clip, cm): car-enter feet 1.4 / 1.53,
     hands 1.1 (right) / 0.82 (left) (before the fixes: 0.39 / 0.93 / 0 / 0, measured with the joint and the fixed
     poles); heli-enter feet 0.28 / 0.99, hands 0 / 0 (before: left hand 7.51 on the collective, right 2.5);
     heli-exit feet 0 / 0.01, hands 0 / 0 (before: left 7.66). Largest root step: car-enter 1.6 cm, heli-enter 2.3,
     heli-exit 4.5. Per-frame motion of head / hands / feet / hips is the clip's own: identical with the pins off
     (car-enter worst 9.0 cm/frame left hand at f134, 6.2 right hand f113, 8.6 left foot f171, 8.3 right foot f161,
     2.4 head f137).
     bodyClearance crossCm through the clips (every 10 / 12 frames; the same frames with the pins off give the same
     numbers to 0.2 cm, so these are the clips'): car-enter seat 11.2 (clavicle_l, 7.0 s = f210), interior 7.5
     (ball_r, 5.8 s, the toes into the pedal as in the seated loop), wheel 5.5 (right forearm through the rim, 6.0 s
     = f180), door 5.5 (left upper arm as the door shuts, 7.17 s = f215), body shell 3.3 (left calf on the sill, 5.0
     s = f150). heli-enter seat 8.4 (left calf, 4.4 s), door 3.5 (fingers), fuselage 2.7 (thumb), collective 2.5,
     cyclic 1.5 (fingers round the grips). heli-exit seat 21.9 / 22.1 (right calf through the seat, 3.0 s = f90),
     cyclic 12.6 (left thigh through the stick, 2.0 s = f60, the stick centred), fuselage 7.8 and interior 7.5 (right
     upper arm through the door frame, f90), door 3.9. The guns on the back (game-side placing, the clip keys the
     rifle's stow) go 5 to 7 cm into the sill and seat area at car-enter f153 and the shotgun 5.6 cm into the door
     at f93 (V2's depth measure). For the clip pass: heli-exit f60 and f90 legs; car-enter f150 to f215 as above;
     the helicopter door opens only to 41 deg; heli-enter / heli-exit should hold the collective down (4 deg) on the
     ground. Not checked here against the coordinator's list: the wrist flips (f31-32, 134-135, 142-147, 155-156,
     203-209) show as the left hand's 9 cm frame at f134; the forearm twist step, the straight elbow at f49 and the
     head in the roof at f205-208 were not isolated.
     Filmed (12 tiles each, outside; contact errors on every tile): car-enter (approach, hand on the handle f35,
     door swinging, open, turn, grip door and lower f120, hand on the interior f146, legs over the sill f156, legs
     in, feet to the pedals, door closing f203, hands on the rim f237); heli-enter (approach, hand on the handle f45,
     door swinging, step to the skid, foot on the skid f81, hand on the frame f90, in, turn, seated f150, door closing
     f168 hand on the glass, feet on the pedals, hands on the controls f221); heli-exit (hands on the controls,
     hands off, push the door, open, unseated, foot on the floor edge, hand on the frame, foot on the skid, ground,
     hand on the handle as the door shuts, shut, standing). Seen: every contact stage reads as the clip names it;
     no pop at either join.
     `demo.enterExit('car' | 'heli')` (new) does the walk-up, in, out, 9 tiles per phase, contacts and clearance.
     Placeholder baselines for the car's exit (still the placeholder): seat 24.2, interior 24.0, body shell 19.5,
     door 8.6 (head through the roof frame and thighs through the seat: the placeholder was not polished).
  1. Shadows. Cause: one 4096 map in a box round the focus (22 m on foot, 68 m car, 60 / 80 m helicopter).
     Now `CSMShadowNode`, 4 cascades, splits near x [1, 5, 25] then 1100 m, near 9 (foot) / 14, 8 (car chase,
     cockpit) / 20, 12 (helicopter); maps 4096 / 2048 / 2048 / 2048; sized once for a 68 deg view (only re-sized
     when `near` changes), centre snapped to each cascade's texels, fade between cascades, biases scaled per
     cascade's texel. First cascade: foot 20.2 m wide, 0.49 cm texels (V2 0.54); car chase 31.5 m, 0.77 cm (V2
     68 m, 1.66 cm); helicopter cockpit 27 m, 0.66 cm. Pictures (contact sheets, kept outside the project): car chase at 278 km/h before
     (lamp posts past the box unshadowed) and after (lamp-post shadows down the straight); helicopter at 194 m
     before (no building shadows) and after (every building and the barrier shadowed); on foot (character shadow
     as sharp as before). A 5-cascade version cost 25 ms CPU / 48 ms GPU a frame and was cut to 4. Swimming: 300
     frames driving at 160 to 250 km/h, every cascade's centre on its own texel grid (largest fraction of a texel 0)
     and its width constant (one value each), so the maps do not slide under the scene; cascade borders cross-fade.
     Popping at the borders not looked at in motion.
  2. Helicopter cockpit view. Causes: (a) the lens was 16 cm behind the glare shield's rear edge (the pack's pilot
     leans 22 deg forward) pitched 5 deg down with a 66 deg field, so the shield filled the bottom and the
     instruments and hands were below the frame; (b) the pink: the red anti-collision light was a PointLight under
     the belly with no shadow, every flash lit the pillars and panel pink through the floor; (c) the main rotor blur
     disc sat 3.02 m below its pivot (asset node offset applied twice): an orange ring at skid height, seen through
     the windscreen and round the aircraft from outside (V2 called it the dust ring); the tail disc was 7 m off;
     (d) V2's sheets drew one frame per tile, so TRAA mixed in the previous tile's picture. Changes: lens 6 cm above and 10 cm behind the eye
     (back to the eye as the mouse looks down, or it would be behind the pilot's own head), pitch -0.47 rad, 88 deg
     vertical field, the look-down eased off by 75 % when looking aside, the eye 5 cm toward the look; disc on its
     pivot, 18 % opacity from the cockpit; beacon a downward SpotLight; sheets now render 8 frames before a tile.
     Seen (12 tiles: hover, cruise 214 km/h, 45 deg bank each way, nose down accelerating, autorotation flare,
     mouse left, mouse right, mouse a little down, mouse down, mouse up, cyclic full aft-left with collective up):
     no shards and no head; the horizon about a fifth down, the panel readable, the knees at the bottom, the
     cyclic hand at the bottom with the stick forward (nose down) and with the mouse a little down; the guns on the
     left seat when looking left. Looking fully down shows the pilot's own chest and both hands on the controls.
     Miss: with the stick centred the cyclic hand is just under the frame's bottom edge.
  3. Car steering hands. Cause: V2 lifted the regripping hand 4 cm for 0.22 s and let both ends of the hands'
     ranges meet. New `src/car/hands.js` (pure, `test/hands.test.js` 4 pass): at speed (> 4 m/s) the hands ride at 9
     and 3 to +-90 deg; past that, or at low speed, push-pull: left hand on 20..160 deg, right on -160..-65 deg, one
     grips while the other slides on the rim at 3 x the wheel's rate (420 deg/s at least); they hand over at the
     stroke ends; steady near centre they slide home one at a time; a held corner with a hand past its stroke slides
     it back in; past 90 deg at speed the hand at 12 slides down its side while the one at 6 rides on (both are at
     their ends there). Steer poses blended by where the hands are, not the wheel; clavicle reach 18 -> 34 deg; a
     grip still out of reach turns Spine2 toward it (up to 12 deg, `reachWithChest`). Worst palm over each drive,
     V2 -> V3 (cm, final full run): lockToLock 15.3 -> 0.6 with the hands off the rim 3.8 -> 0 s of 9; slalom
     5.6 -> 1.1, skidpadLimit 3.2 -> 1.54, liftOff 3.9 -> 1.56, rollPitch 2.6 -> 1.33, powerOver 1.8 -> 1.27,
     skidpad200 2.2 -> 1.3, launch / topSpeed / brake100 / standstill / wheelSpeed / kerbGame 0.08 -> 0 (an earlier
     run of the same code: skidpadLimit 1.39, liftOff 1.45; two drives are 0.04 / 0.06 cm over 1.5). Seen: cockpit and cut-away side views at +85 and -85 deg at 90 km/h (both hands on the
     rim, the chest turned a little toward the high hand) and standing at 250 deg mid push-pull. Not measured: hands
     against the spokes by measure (bodyClearance steering_wheel: fingers 2.3 cm crossing, 1.0 cm V2 measure, at
     the wheel centred).
  4. Clearance. `demo.bodyClearance()` keeps V2's reading (deepestCm) and adds crossCm: a part's surface crossing the
     line from the limb's axis (main bone to its child) to each skin vertex. Car seated: body_shell 15.7 -> cross
     0.3 cm (foot_l); helicopter: fuselage 13.1 -> 0, instrument_panel 21.8 -> 0. Cut-away pictures: the car's left
     shin is inboard of the footwell's kick panel with the shell hidden; the pilot's right calf is in the cabin,
     inboard of the door, with fuselage and door hidden. All three were the open-shell effect, not the limbs. The
     thumb picture was badly framed (the reading is from the measure only). New readings from crossCm, not looked
     at in pictures: car seat 8.2 cm (spine_05, 625 vertices: the upper back into the seat back's foam), car
     interior 7.5 cm (ball_r: toes into the pedal or floor), helicopter seat 6.1 cm (thigh_twist_01_l), cyclic and
     collective 2.3 cm (fingertips round the grips). For the clip pass if confirmed: car-drive upper back 5 to 8 cm
     forward of the seat back (A1 accepted 4 to 5 cm at the bolsters).
  5. The 0.94 cm palm offset: vehicles.js measured the palm with EarthOnline's palm point (0, -0.075, 0.028); the
     Tripo body's is (0, -0.079, 0.0365); the hands were on the grips. Now the body's PALM_LOCAL: heliReach 0.00 cm
     at all 11 positions (V2 0.94).
  6. Tyre smoke: emission from slip power |F| x slip speed per tyre (none under 6 kW, full at 70 kW; rate 10 to
     60 puffs/s; pool 90 -> 240), colour as the sun and sky light it (linear 2.05, 1.72, 1.42 against V2's unlit
     0.85 grey), drag to a 1.4 m/s breeze, buoyancy, swirl, opacity falling with the spread, never cut by the
     ground. Handbrake slide from 80 km/h: 82 kW at 1 s, peak 131 kW; launch 34.6 kW. Seen: the slide from the chase
     and the side, the cloud drifting 1 s later with the marks.
  7. Guns in the cabin: with the door shut both guns lie across the car's passenger cushion into its footwell, on
     their sides; in the helicopter they stand in the left front seat's footwell, butts on the floor, leaning on
     the cushion's front edge (on the seat itself they stood off its front or went 7 to 11 cm into the backrest);
     back on the back as the door opens. Gun vertices against the cabin parts (V2's depth measure, every 3rd vertex):
     car passenger seat 4.3 -> 0 cm after raising them 4 cm, interior 6.5 -> 0, body shell 5.1 -> 0, driver's seat
     0; helicopter left seat 10.6 -> 0, fuselage 13 -> 0 (the butt was in the floor), interior, door, panel,
     collective, pedals 0. Found on the way: nothing moved the gun pivots in vehicle modes (`place()` sets the hold
     only), so the guns hung where the last on-foot frame left them while the body went into the seat; now set every
     frame. Seen: getting in and out of the car (6 tiles: guns on the back with the door open, in the cabin shut);
     the car's passenger seat with the door and shell hidden and from above; the helicopter's footwell with the
     door and fuselage hidden; the cockpit view looking left. The swap is hidden by the shut door on the driver's or
     pilot's side; from the other side the guns appear through the glass.
  8. Sound (offline, 48 kHz, the game's compressor + 0.55 master; `tools/v3_sound.js`). Car: firing frequency
     rpm/10 is the strongest peak (idle 1000 rpm: 100 Hz -37.5 dB, half order 50 Hz -38.8, 2nd 200 Hz); every
     order follows rpm within the analysis window in sweeps 1000 -> 8500; peak -11.6 dBFS full load, no sample at
     full scale; clicks: none outside the shift crack (largest step / local median 1.3 in the upshift outside the
     cut, 5.3 at the very start of the sweep as the sound fades in); the lift-off pops broadband for 0.6 s.
     Wrong and fixed: part load (0.3) was 6 dB under full with the same spectrum -> the upper orders tilt down with
     load (2nd -6 dB under the firing order at part load, -4 at full), part-load peak level -17.4 -> -19.3 dBFS; no
     Doppler (a 200 km/h pass held 640 Hz) -> main.js passes a Doppler factor from the camera: 759 Hz approaching,
     554 receding. Helicopter: blade pass 4 x rotor rps = 26.0 Hz at 390 rpm, measured 26 Hz; flight idle 296 rpm
     -> 19.8, measured 19.2 to 20.5; tail 4 x 2551 / 60 = 170 Hz with its odd harmonics (850, 1190, 1530 ...: the
     square wave), measured 169.9; turbine 3500 Hz at Ng 92 %; start 40 s: -57 dB cranking to -28 dB at flight rpm,
     light-off whoomph at 8 s. Wrong and fixed: the rotor pulse (sawtooth through a wave shaper) made a spike at
     every blade pass, 0.034 per sample (16 x the local level) inside in cruise -> a band-limited periodic pulse
     wave: 0.014, ratio 2.9; its spectrum now falls from the fundamental (26 > 52 > 78 Hz, -15 / -17 / -20 dB in
     cruise) where the old one was flat to 182 Hz; inside measured 0.8 dB louder than outside in the hover -> 1.0
     dB quieter (rotor thump x 1.2 -> 0.8 inside); no Doppler on a 220 km/h pass -> 31.3 Hz approaching, 22.3
     receding. Blade slap in a 3 m/s descent at 90 km/h: broadband 500 to 1500 Hz added, +2 dB. Peaks: worst -4.0
     dBFS (cruise inside), never full scale. Spectrograms looked at: car sweeps, upshift, lift-off, pass; helicopter
     hover in / out, slap, pass. The gearbox tone is 68 x rotor rps (442 Hz), the header said 17 x: header fixed.
  9. Frame cost at 2048 x 1536 (the pane at device pixel ratio 2), 600 frames each, median / 95 % / worst (ms):
     car from 180 km/h, throttle 0.7: physics 0.3 / 1.6 / 15.7, rest of the step 1.3 / 3.2 / 24.7, render call (CPU) 22.7 /
     32.9 / 94.9, GPU after submit 5.3 / 11.9, frame 30.3 / 45.1. Helicopter at 180 km/h: physics 0.2 / 0.6 / 10.2,
     step 1.0 / 2.5, render CPU 16.3 / 34.0, GPU 6.3 / 10.6, frame 24.5 / 44.8. The render call's CPU time
     dominates (1037 meshes, 420 shadow casters, 273 k caster triangles); shadows off: car frame 19.0 (render CPU
     11.2), helicopter 12.9 (7.0); plain picture: car 26.3, helicopter 18.2. A V2-style single map measured 25.7 ms
     frame (render CPU 15.7) on the car run, on a busier machine. Worst frames of 1 to 17 s are shader compiles
     after switching shadows or quality.
  Regression: `demo.review(...)` (first run, in the asked order): idle 0.6, walk 1.8, jog 2.1, aimHold 0.9 frozen 7,
  burst 0.9 fire 0.9, reload 1.1, swap 2.5, crouchIdle 0.1 head 113, rampUp20 3.1 sink 0.1, stairsUp 3.4 sink 0.5;
  grip 0 / 0 everywhere. Two more runs: aimHold frozen 2 and 0, stairsUp 2.7 / 2.2 sink 0.1 / 0.3, jog 2.1 / 1.9,
  burst snap 1.6 (run after others). `demo.vehicleReview()` (final run) car numbers identical to V2 (0-100 2.98, 0-200 8.53, top
  348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at 102.28, skidpad200 1.392, roll 2.673, dive 0.826,
  upshift 0.10, standstill 0, wheel 2.13 %, slalom 0.792 g, liftOff +13.14 %, powerOver 2.679 / 6.789, kerb 3.69 cm
  14.65 kN 0.167 s 0.879 deg). `demo.heliReview()` identical to V2 (cruise 69.99 % pitch -2.258, turns 1.178 / 1.454,
  autorotation 10.305 m/s, flare 1.226 m/s, gentle 0.317, firm 2.819); `demo.heliReach()` 0.00 cm everywhere.
  `node --test test/dynamics.test.js` 8 pass; `node --test tools/heli/flight.test.js` 19 pass; `node tools/heli/run.js`
  65 PASS 0 MISS 46 rows; `node --test test/hands.test.js` 4 pass.
  Files: src/look.js, src/main.js, src/vehicles.js, src/seated.js, src/review.js, src/car/car.js, src/car/sound.js,
  src/heli/heli.js, src/heli/sound.js; new src/car/hands.js, test/hands.test.js, tools/v3_shots.js,
  tools/v3_sound.js, tools/v3_cost.js, tools/sheet_receiver.mjs; README.md (section "Vehicles, pass V3");
  tools/heli/report.txt regenerated. src/audio.js and the voice lines untouched.
  Not verified: car-exit (not shipped); popping at the cascade borders in motion; the smoke from the cockpit view;
  the EarthOnline bodies in the vehicles (placeholder IK only, item 10 of V2 still open); the clip faults on the
  coordinator's list one by one; the sound by ear; GPU timings are from queue completion, not GPU timestamps.
