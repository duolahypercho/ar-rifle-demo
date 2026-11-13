- 2026-11-12, pass V7: frame budget, mirrors, readable helicopter displays, measures, the clip contract, damage, the world,
  the keyboard slalom. Originals copied to the scratchpad's `v7_orig/` (src, tools, test, README.md) before editing.
  Packs measured against: `vehicle-motion-tripo-v1` 01:54:39 (17 clips) and `vehicle-motion-ue5-v1` 01:18:22 (13 clips),
  unchanged during the run (the clip pass had not re-shipped by the end: no `scale`, no `guns`, no new exit clips).
  The machine's load average was 80 to 141 all through (other renders): every frame figure below is from one sitting.

  Works: mirrors (all three, the right way round, aimed by the driver), the lean-in key and larger PFD figures, the
  fitted-seat hips measure, `vehicleFit.scale` and the `guns` track (code paths; no pack carries them yet), damage (dents,
  scrapes, cracked glass, broken lamps, folded / knocked-off mirrors, toe and flat spot, the helicopter's bent skids and
  tail strike), the rolling ground with grass, trees, bushes, hills, clouds, edge lights, boards, tyre walls and the wind
  sock, four times of day, the wind into the flight model, the smoke and dust. Not met: the 2.5 ms frame budget (see 1);
  the keyboard slalom at 60 km/h (the car's limit, not the shaping: see 6); EarthOnline entry and exit clips (not shipped);
  several pictures and regression runs listed under "Not verified".

  1. Frame time (`tools/v4_cost.js` at the start, `tools/v7_cost.js` A / B at the end; one frame = step + render + GPU
     done; median / p95 ms; canvas 1536 x 1152).
     Start (10:27, original code, load 80 to 112): foot 31.5 / 63.1, car 37.9 / 72.5, cockpit 41.3 / 80.3; helicopter
     (reloaded) 43.9 / 97.0; draws 195, 171, 132, 225.
     End, alternating blocks of 30 frames, features on / off through `demo.perf` in one page (11:12 to 11:14, load 90 to
     121), on - off median (ms), with the step / render-call CPU / GPU-wait parts:
     | case, switches off in the "off" blocks | on | off | diff | step | render CPU | GPU wait |
     |---|---|---|---|---|---|---|
     | foot, all six | 50.6 / 114.7 | 16.5 / 97.1 | +34.1 | +0.1 | +1.1 | +32.5 |
     | car chase 200 km/h, all six | 59.7 / 109.7 | 50.8 / 90.6 | +8.9 | +0.3 | +1.3 | +5.6 |
     | cockpit, all six | 62.9 / 106.8 | 60.1 / 92.2 | +2.8 | -0.1 | +2.3 | +0.9 |
     | cockpit, mirrors | 18.2 / 65.9 | 16.9 / 120.4 | +1.3 | -0.1 | +1.3 | +0.3 |
     | car, terrain | 21.7 / 96.5 | 19.5 / 64.9 | +2.2 | +0.1 | +0.5 | +1.6 |
     | car, flora | 54.8 / 110.3 | 46.5 / 91.3 | +8.3 | 0 | +0.4 | +8.9 |
     (These are after the first cut below and before the second, smaller one (grass 6000 -> 4000, 20-face crowns); the
     helicopter case was not measured at the end. The same "foot, all six" pair read +9.5 and +34.1 ms in two sittings
     20 minutes apart: the GPU wait is the other renders' as much as ours.) The GPU-wait share of the difference dominates and moves by 3x between
     blocks with the other renders on the GPU; the CPU (render call) differences are the stable part: mirrors +1.3 ms
     (cockpit, one mirror render per 3 frames per visible mirror, about 60 draws each), terrain +0.5, flora +0.4.
     Cut on the way (first measures +9.5 ms foot, +14.1 car, mostly GPU): the ground's grid from 8 to 12.5 m cells (the
     physics reads the same nodes), grass 16000 -> 4000 tufts within 34 m, clouds 420 -> 160 puffs, tree crowns to 20-face
     blobs casting in the near cascades only, the mirrors' camera without the world's detail layer (grass, trees, hills,
     clouds), each mirror at most every third frame and only within 4.5 m of the glass.
  2. Mirrors (`src/mirrors.js`). For each mirror the camera's eye is reflected in the glass's plane; a camera there looks
     along the glass's normal through an off-axis frustum whose window is the glass (near plane = the glass, so the roof
     and windscreen in front of the rear-view mirror are cut away); the glass samples the picture at its own points'
     projection through that camera (stored in the glass's frame, so it holds while the car moves between renders): the
     image is the right way round by construction (checked with a red box behind-right and a green one behind-left: the
     rear-view mirror shows green on its left, red on its right; each door mirror its own side's box, `m5.jpg`, `m7.jpg`).
     Door mirrors convex (window x 1.55). Aim: set when the driver is seated (from his eye: rear-view straight back and
     0.7 deg up, through the 0.38 x 0.18 m rear window, whose frame shows at both ends; door mirrors 4.6 deg out, 1.7 deg
     down: the flank at the inner edge); the housings turn with the glass (their 52 / 106 / 106 vertices in the car's
     batches rewritten; the model's flat grey glass folded behind ours). Textures 256 x 64 and 160 x 128, HalfFloat; one
     render a frame at most, each mirror at most every third frame, only within 4.5 m of the camera, facing it and in its
     view; the shadow cascades are not redrawn for it; the mirrors' camera leaves out grass, trees, hills and clouds.
     Pictures (scratchpad `v7/`): `v7_mirrors_world.jpg` (the helicopter 30 m behind in the rear-view mirror and the left
     door mirror with the car's flank; the right mirror; beside the car), `v7_mirror_reverse.jpg` and
     `v7_mirror_reverse_crops.jpg` (reversing toward the building west of the apron: its brick wall fills 55 % of the rear
     window at 14 m and 85 % at 1.6 m), `m6.jpg` (the test boxes from the cockpit, looking left and right).
  3. Damage (`src/damage.js`; the car's batches' own vertices and material inputs: draw calls with a damaged car 184, 186,
     183 after the 30, 80, 150 km/h hits, 184 repaired, in the same view). Crashes into the main straight's barrier from
     new (`/tools/v7_shots.js` crashDamage, coasting in, braking after): 30 km/h head-on: speed change 8.84 m/s, dent 7.8
     cm deep at the nose (worst vertex 7.1 cm, 866 vertices over 1 cm), the right headlamp broken; 80 km/h at 30 deg: the
     corner 6.42 m/s then the flank 6.0 m/s, dents 5.3 cm worst (466 vertices over 1 cm), paint scraped along the right
     flank (731 vertices), the right headlamp; 150 km/h head-on: 47.6 m/s, dent 18.6 cm asked, held to 18.2 cm (the
     limits: 3 cm off the cabin's box and the wheels), 4957 vertices over 1 cm, windscreen cracked fully, the left
     headlamp. Pictures `v7_damage_new.jpg`, `v7_damage_30_90.jpg`, `v7_damage_80_30.jpg`, `v7_damage_150_90.jpg` (the
     150: the crack star and the pushed-in nose seen; the 80: the car against the barrier, the right side hidden by it).
     Steering: an 11 m/s hit at the left front wheel (`impact` called directly): toe 1.15 deg, flat spot 4.4 mm; then
     hands off at 80 km/h for 3 s on flat ground: heading +11.2 deg and 6.6 m to the left (new car: 0.0 and 0.0). The
     door mirrors were not folded or knocked off by any of these hits (no side hit within 0.55 m of a mirror): the code
     path is not shown in a picture. The helicopter's skid bend and tail strike were not exercised (no hard landing run).
  4. The world (`src/terrain.js`, `src/look.js` setTime, `src/ground.js`). Ground: 12.5 m grid over +-1600 m, heights 0
     within 18 m of paving or obstacles, rising to the swells (0.1 to 2.4 m) by 70 m; physics and mesh read the same
     nodes. Grass 4000 tufts within 34 m, 14 blades each; 198 trees and 128 bushes; 30 cloud clusters (160 puffs) unfogged
     at 700 to 1300 m; hills 1.9 to 3.2 km; edge lights (track every 40 m both sides, 16 round the helipad, apron edges);
     marker boards; 480 tyres at the north hairpin's run-off wall (visual only: the car hits the wall behind them); the
     wind sock. Times of day `tod_foot_air.jpg` (on foot, 200 m up, 2 m over the dirt, at the four times; chase and cockpit
     at each time not filmed). Wind into the flight model: hover at 10 m with the assist's hover and height hold, means
     over the last 8 of 20 s:
     | wind | pedal | cyclic roll | bank deg | drift max m |
     |---|---|---|---|---|
     | still air | -0.362 | -0.009 | -2.98 | 2.00 |
     | 10 m/s from the right (east), steady | -0.548 | +0.083 | -1.16 | 0.89 |
     | the same with gusts | -0.540 | +0.062 | -1.14 | 1.04 |
     | 10 m/s from the left (west), steady | -0.102 | -0.099 | -4.06 | 3.52 |
     (bank into the wind by 1.8 deg (from the right) and 1.1 deg (from the left), the pedal moved by -0.19 / +0.26 against
     the weathervaning.)
  5. Helicopter displays: Shift held leans in (eye 14 cm toward the panel, field 88 -> 34 deg, view on the PFD, 0.35 s
     each way; the mouse still turns the head). PFD at the game's render scale (crops 1:1 of the 1536 x 1152 canvas):
     default eye `h_pfd_default_1x.jpg` (the PFD 230 px wide, figures 4 to 5 px: not readable), leaning
     `h_pfd_lean_1x.jpg` (the PFD 520 px wide: tape figures, the boxed altitude, the ladder, HDG, RA readable at 8 to 14
     px). Enlarged after that crop (not re-cropped): tape figures 15 -> 19, the boxed IAS / ALT 22 -> 26, ladder 13 -> 16,
     RA 13 -> 18, VS 13 -> 18, heading figures 14 -> 18, HDG 15 -> 19, labels 11 -> 14, annunciators 14 -> 17 (texture px of
     the 2048-wide artwork scale). The car's cockpit got the same key (30 deg toward the cluster).
  6. Keyboard slalom (`node tools/v7_slalom.mjs`, V5's scripted person, cones hit / clearance m):
     | km/h | keys (keys.js) | keys, ramps x 3 | keys, no ramp | analog wheel (no keys) |
     |---|---|---|---|---|
     | 45 | 0 / 0.17 | 0 / 0.20 | 0 / 0.26 | 0 / 0.21 |
     | 50 | 1 / -0.70 | 0 / 0.17 | 0 / 0.31 | 0 / 0.20 |
     | 55 | 0 / 0.25 | 0 / 0.19 | 0 / 0.20 | 0 / 0.18 |
     | 60 | 1 / 0.11 | 1 / -0.86 | 1 / 0.05 | 1 / 0.12 |
     | 65 | 3 | 2 | 3 | 5 |
     At 60 km/h a perfect wheel touches a cone too (1.14 g peak, the car's grip 1.165 g: the 1.5 m line at 18 m needs
     about 1.0 to 1.3 g): the limit at 60 is the car and the line, not the shaping. The shaping is what clips at 50 (faster
     or no ramps run it clean). Nothing changed (the brief: raise it only if it is the shaping).
  7. Measures. `hipsOffSeatCm` now against the pack's seated reference (car-drive frame 0, posed on the fitted seat and
     read in the car's frame): 0.89 to 0.94 cm in every scenario (was a constant 8.1 against the placeholder's point).
     `demo.heliReach()`, 11 runs in one page: twice after three crosswind hovers, then after a full `heliReview()`, after
     `heliReview('hover')` four times, `('landingsGame')` twice, `('autorotation')`, `('reach')`: soles 0.0 cm and palms
     0.00 cm in every run. V5's 4.0 cm did not reproduce in V6 or here; closed without a cause found (the code that put it
     there may have been V5's own state, changed since: the seated soles, the hand-overs).
  8. Clip contract: `VehiclePack.fitScale(kind)` and `applyFit` apply `scale` (node about its origin, through the
     batch's bones) beside `translate`, resetting every node a fit has named; `main.js` gunTrack / trackGuns place the
     guns from a clip's `guns` (on the back before `from`, the track to `to`, the cabin after; the reverse leaving; arrays
     per clip frame or per from..to). No pack carries either yet: both paths are untested against real data.
     `demo.chainReview` was not run at the end (time).
  Regression (end): `node --test test/dynamics.test.js` 8 pass, `test/hands.test.js` 4 pass, `tools/heli/flight.test.js`
  19 pass, `node tools/heli/run.js` 65 PASS 0 MISS 46 reported (report identical but for run times; the Node models'
  toe / flat / wind are 0). `demo.vehicleReview()` (with the rolling ground off for the runs, see below): 0-100 2.98,
  0-200 8.53, upshift 0.10, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at 102.28, skidpad200 1.284 at
  207.07, roll 2.673, dive 0.826, slalom 0.792, liftOff 13.14 %, powerOver 2.679 / 6.789, standstill 0, wheel 2.13 %, kerb
  3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock 420 deg hands off 0: identical to V6. Palms: skidpadLimit 1.3,
  skidpad200 3.71, rollPitch 1.27, slalom 1.09, liftOff 1.12, powerOver 1.44, lockToLock 0.38 (V6 1.52, 2.46, 1.25, 1.07,
  1.53, 1.24, 0.6). With the rolling ground on, topSpeed (it runs on past the straight's end onto the dirt) read 281 km/h
  and kerbGame 7.16 cm / 0.4 s: the review now switches the ground off for its runs (on purpose; noted in review.js).
  `demo.heliReview()` (still air): start 35.82 s (quick 8.67), hover 70.75 % / 81.83 % (2500 kg), climb 9.36 m/s, cruise
  69.99 % pitch -2.258, turns 1.178 / 1.454 g, autorotation 10.305 m/s at 102.1 % Nr, flare 1.226, gentle 0.317, firm
  2.819, reach 0 at all 11: identical to V6. Not run at the end: `demo.review(...)` (character), `demo.enterExit`, `demo.chainReview`.
  Physics changed on purpose: `dynamics.js` wheels carry `toe` and `flat` (0 unless damaged: every test identical);
  the helicopter's `wind` is the weather's (3 m/s with gusts by default; the reviews run in still air); the ground off the
  paving rolls (every paved surface and everything within 18 m of it is flat as before).
  Files. New: src/mirrors.js, src/damage.js, src/terrain.js, tools/v7_cost.js, tools/v7_shots.js, tools/v7_slalom.mjs,
  notes/V7_log_entry.md. Changed: src/main.js, src/look.js, src/perf.js, src/ground.js, src/world.js, src/vehicles.js,
  src/review.js, src/instruments.js, src/car/car.js, src/car/dynamics.js, src/heli/heli.js, README.md (controls, "Vehicles,
  pass V7"), tools/heli/report.txt (regenerated). src/audio.js and the voice lines in main.js untouched. No Blender, no
  assets, no packages; public/ unchanged.
