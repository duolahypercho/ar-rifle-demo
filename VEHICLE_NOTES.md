# Vehicle notes (handoff for every vehicle pass)

Read this first, then `ANIMATION_NOTES.md` sections "What the user has said", "Blender" and "How to
judge" (the same rules apply here), then the two asset spec files named below.

## What the user asked (2026-11-11, verbatim)

"perfect now can you add both helicopter and the supercar 3d models in there. make sure to add the
driving animations for both and the mecs" and "/loop until it feels hyper realistic".

Standing rules from earlier in this project still hold: keep it procedural (no motion capture, no
downloads, no outside assets, no new packages); characters never stand or sit frozen; hands must be on
what they hold; judge everything yourself with measures and close-ups, at the extremes and not only at
rest.

## The assets (built earlier by us; read-only where they are)

- Supercar: `~/Desktop/Code/test/supercar/` (`supercar.glb` 31 MB, `_lod1`, `_lod2`,
  `supercar_collision.glb`, `supercar_specs.json`, `renders/`). Two-seat mid-engine concept, 4.80 m
  long, 2.03 m wide, 1.14 m high, wheelbase 2.70, tracks 1.72 / 1.70, tyres 0.69 / 0.72 m, clearance
  0.12. Concept targets: 6.5 L NA V12, 750 hp, 720 Nm, AWD, 7-speed dual clutch, 1650 kg, 0 to 100
  km/h 2.9 s, 350 km/h. glTF axes: forward -Z, up +Y, right +X; the driver sits on the left (-X).
  Nodes: `vehicle_root > suspension_XX > [steering_FL/FR] > wheel_XX > tire/rim/brake_disc`,
  `caliper_XX`, `door_L`, `door_R` (canted hinge, local X, negative opens, 55 degrees), `steering_wheel`
  (local Z along the column, positive = left, +-420 degrees in the demo clip), `seat_driver_point`
  (-0.37, 0.30, 0.06), `entry_driver_point` (-1.55, 0, -0.25), `camera_cockpit`, `camera_chase_target`,
  `exhaust_L/R`, light meshes (`headlight_*`, `brake_light_*`, `rear_light_*`, `indicator_*`), pedals
  inside `interior`. Clips in the file: `doors_open`, `doors_close`, `steering_demo`.
- Helicopter: `~/Desktop/Code/test/utility_helicopter/` (`utility_helicopter.glb` 44 MB
  with 4K textures, `_lod1` 16 MB with 2K, `_lod2`, `_collision.glb`, `_specs.json`, `renders/`).
  Civilian utility, 1 pilot + 5, fuselage 10.5 m, main rotor 11.0 m (4 blades, pivot
  `main_rotor_pivot` at y 3.02, spins counter-clockwise seen from above, local +Y), tail rotor 1.57 m
  (`tail_rotor_pivot`, local +X), blur discs `main_rotor_blur` / `tail_rotor_blur` (hidden by
  default), twin skids 2.2 m apart, max take-off 2500 kg, cruise 220 km/h. glTF forward -Z. The pilot
  sits front right (+X): `seat_pilot_point` (0.42, 1.175, -1.19), `pilot_seat`, `cyclic` (0.42, 0.732,
  -1.635), `collective` (0.125, 0.79, -0.985), `pedal_L/R`, `cockpit_door_L/R` (hinge local +Y, R
  opens +68 degrees), `cabin_door_L/R` (pop out 0.075 m then slide aft 1.19 m), `entry_cockpit_R`
  (1.8, 0, -1.55), `camera_cockpit`, `camera_chase_target`, `landing_light_point`, nav and landing
  light materials, cockpit displays. Clips: `main_rotor_spin`, `tail_rotor_spin`, `cockpit_doors_open`,
  `cabin_doors_open`. Cabin floor 0.72 m above the ground.
- Never edit those two folders, never use their Blender sessions (ports 9876 and 9878). Copy what the
  game needs into `ar_rifle_demo/public/vehicles/`. If a model needs a change, patch a copy with a
  private headless Blender script under `ar_rifle_demo/blender/vehicles/` and say what changed.

## The game today

`ar_rifle_demo`: Three.js 0.187 WebGPU, Vite. Player = the Tripo body on the UE5-style skeleton
(`public/characters/tripo-player-ue5.glb`, pack `rifle-motion-tripo-v1`), four EarthOnline bodies
behind `N` on `rifle-motion-ue5-v1`. `src/rig.js` lets `src/character.js` keep its math in canonical
frames. World: a yard with ramps, stairs, a kerb (`src/ground.js`, `src/range.js`, `src/surfaces.js`),
lighting and post chain in `src/look.js`, sound synthesised in `src/audio.js` (the voice part and the
voice lines in `src/main.js` were added by someone else: keep them working as they are). Review
harness `src/review.js` (`demo.review(...)`). Keys in use: W A S D, Shift, X, mouse, Space, F, Q, R,
E, 1, 2, C, V, N, H, G, B.

## Design decisions (already made; change only with a stated reason)

- One vehicle framework (`src/vehicles.js`) that the car and the helicopter both plug into: nearest
  vehicle within reach, one key to get in and out (pick a free key and put it in the README), the
  player object switches between on foot, entering, seated, leaving; cameras (chase with a spring,
  cockpit); HUD per vehicle; sound per vehicle.
- The world must grow for this: the yard stays, with open tarmac round it, a road or track loop long
  enough to reach top gear, a helipad, and things to judge speed and height against (markings, cones,
  barriers, a few buildings). All procedural.
- Car physics is a real rigid body: 6 degrees of freedom, four suspension rays with spring, damper and
  anti-roll bars, a tyre model with slip ratio, slip angle, combined slip and load sensitivity, an
  engine torque curve with rev limiter, a 7-speed dual-clutch gearbox with shift time, AWD torque
  split, brakes with bias and ABS, aerodynamic drag and downforce, speed-sensitive steering. Fixed
  time step, sub-stepped, stable at rest. No arcade shortcuts that show (no snapping, no magic grip).
- Helicopter flight is a real model too: rotor speed with engine governor and spool-up, thrust from
  collective and rotor speed, induced velocity, ground effect, translational lift, cyclic tilting the
  rotor disc with flapping lag, torque reaction and a tail rotor with pedals, fin and stabiliser,
  fuselage drag, skid contact with friction, autorotation when the engine is cut. A stability assist
  may help the keyboard pilot but must be switchable and must not hide the physics.
- The flight model lives in a pure module with no Three.js imports (`src/heli/flight.js`) so it can be
  tested in Node; the car model likewise (`src/car/dynamics.js`).
- Character clips for vehicles are authored in the Blender pipeline, like the rifle pack, one pack per
  body family: `public/characters/vehicle-motion-tripo-v1.glb/.json` and
  `vehicle-motion-ue5-v1.glb/.json`. Contract:
  - 30 fps, same bones as the rifle packs (twist and IK bones keyed), whole body (no gun in the hands).
  - Clip space is the vehicle root's own glTF frame (`vehicle_root` / `helicopter_root`; forward -Z).
    The character's `root` bone carries where the character stands or sits in that frame on the
    vehicle's ground plane (notes `root`: per frame `[x, z, yaw]`); height comes from the pelvis.
  - Car: `car-enter` (from standing at `entry_driver_point`, facing as that helper faces, to seated
    with the door shut and hands on the wheel), `car-exit`, `car-drive` (seated loop, 6 to 10 s, alive:
    breathing, small shifts, head), `car-steer-l`, `car-steer-r` (seated poses with the wheel at +90
    and -90 degrees), `car-look-back` (reversing). Helicopter: `heli-enter` (from `entry_cockpit_R`:
    open the pilot's door, step up, sit, shut the door, hands and feet to the controls), `heli-exit`,
    `heli-fly` (seated loop), and one-pose clips for control extremes: `heli-cyclic-f/b/l/r`,
    `heli-collective-up/down`, `heli-pedal-l/r`.
  - Notes per clip: `vehicle`, `events` (seconds: `doorOpenStart`, `doorOpenEnd`, `seated`,
    `doorCloseStart`, `doorCloseEnd`, `handsOn`), `door` (per frame, 0 shut to 1 open: the game drives
    the real door node from it), `contacts` (list of `{part: hand_l|hand_r|foot_l|foot_r, from, to,
    node, at: [x, y, z], kind}`: from frame `from` to `to` that part is on the vehicle node `node` at
    the point `at` in that node's local frame, so the game pins it with IK while the node moves).
- Vehicle fit (added after the first clip sheets): both cabins are set for a taller person than the
  1.75 m bodies, so the first seated poses perched on the front of the seat. Each clip pack therefore
  carries `vehicleFit` in its top-level JSON (`{vehicle: {node: {translate: [x, y, z]}}}` in the
  node's parent frame): the seat slid forward on its rails, the steering column telescoped toward the
  driver, the helicopter's pedals adjusted aft. The game must apply the active body's `vehicleFit` to
  the real vehicle nodes when that body sits in it (and when it gets in and out), so hands, feet and
  back meet the parts where the clips expect them.
- Weapons: before getting in, the held gun goes on the back with the outgoing half of the swap clip;
  once the door is shut both guns are put out of sight (stowed in the cabin); the reverse on getting
  out. This is a first version; a visible place for the guns in the cabin is a later pass.

## How to judge (vehicles)

- Numbers against the real thing, not against a feeling. Car: 0 to 100 km/h about 2.9 s, 0 to 200
  about 8.5 to 9.5 s, top speed about 350 km/h, 100 to 0 km/h in 30 to 34 m, steady cornering 1.1 to
  1.3 g at 100 km/h and more with downforce at 200, body roll 1.5 to 3 degrees per g, dive under full
  braking 1 to 2 degrees, redline 8500 rpm, upshift 0.08 to 0.15 s, no jitter standing still (chassis
  speed under 1 mm/s after it settles), the four contact patches on the ground, wheel spin matching
  road speed when not slipping. Helicopter: main rotor about 380 to 395 rpm at flight speed, spool-up
  from cold 20 to 40 s (a quick-start option is fine if it is labelled), hover at 60 to 75 % of
  available power at 2200 kg, climb up to about 8 to 10 m/s, cruise 220 km/h, never-exceed about 260,
  pedal needed with collective changes, ground effect within one rotor diameter, descent in
  autorotation 8 to 12 m/s with rotor speed held, touchdown without bounce when flown gently, tips on
  the skids only when it should.
- Pictures at the extremes: full lock, full braking, a kerb strike, a slide, a hard landing, a steep
  bank; the driver's hands on the wheel at full lock; the pilot's hands and feet on the controls at
  their limits; every frame of getting in and out (hand on the handle, the door, the sill, the seat),
  nothing passing through anything.
- Say plainly what you did not look at and what you could not measure. Sound cannot be listened to
  here: describe what was synthesised and how it follows rpm and load.

## Log
- 2026-11-11, pass V1: the supercar in the game, the driving world and the vehicle framework.
  - Works end to end: walk to the car, T, the gun goes onto the back (swap clip's outgoing half to `slung`),
    walk to entry_driver_point, door_L opens on its node, placeholder entry (body across into the seat,
    blended standing -> seated IK), hands to the rim, door shuts, guns hidden; drive; T at under 1.5 m/s:
    the reverse, the swap half backwards, the gun in the hands, firing again (12 shots in the check run).
  - Physics (`src/car/dynamics.js`, pure; `node --test test/dynamics.test.js`, 8 pass): 6-DOF rigid body at
    1200 Hz; unsprung wheel masses on springs/dampers/bump and rebound stops, ARBs, anti-dive/squat; tyre
    vertical spring enveloped over the contact length; transient (relaxation-length) slip, Magic-Formula shape
    on normalised combined slip, load sensitivity, surface grip; V12 curve, limiter, idle governor; Coulomb
    clutch with lock state and exact engine-inertia coupling, launch control; 7-speed DCT, torque fill, auto or
    manual; 30/70 torque-split centre + viscous coupling, rear clutch LSD; TC; brakes with bias, line-pressure
    lag, model-based ABS on wheel-speed slip, static friction, handbrake, auto-hold; drag and downforce;
    15:1 rack, Ackermann 60 %, speed-limited keyboard steering; OBB collisions with the world.
  - Numbers (game = Node, same scenarios, `demo.vehicleReview()`): 0-100 2.98 s (2.9), 0-200 8.53 s (8.5-9.5),
    top 349 km/h (350), 100-0 30.2 m, peak 1.36 g, mean 1.27 g (30-34 m), max steady lateral 1.165 g at 102 km/h
    (1.1-1.3), 1.28 g at ~200 km/h, roll 2.67 deg/g (1.5-3), dive 1.37 deg at 1.27 g / 0.83 deg per g, upshift
    0.10 s, redline 8250 shift / 8500 limiter, standstill 0 mm/s, driven-wheel speed vs road 2.1 % (driving slip
    under drag), kerb (game, hairpin inside kerb at 60 km/h) bump 3.9 cm, peak load 15.5 kN, 0.17 s with a wheel
    off the ground, roll 0.9 deg; slalom 18 m at 80: 0.80 g, 23.8 deg/s; lift-off at the limit: yaw rate +13 %
    (tucks, no spin); power oversteer (TC off, 2nd, R 30 m): none, rear slip 2.7 deg vs front 6.8 (AWD
    understeer). skidpad200 ends in a spin past the limit (the controller pushes speed until it lets go).
  - Misses: right palm 6.5 to 7.7 cm off the rim static at 0/90/420 deg (left 0.0); 7 to 14 cm during the drives;
    `handsOffRimS` 4.7 s of 9 s lock to lock (the push-pull keeps a hand moving most of the time); the torso
    stands about 10 cm off the seat back; the pack's car-drive trunk not used (built for the seat point,
    leaves the shoulders 0.69 m from the rim); car-enter / car-exit not in the pack yet (placeholder used;
    pack path written, untested); the placeholder entry blends standing to seated with no sill check.
  - Seen: chase at 50 / 150 / 300 km/h (spring lag and FOV 56 -> 64), cockpit at 209 km/h (after moving the
    camera to the driver's eye: camera_cockpit sat inside the driver's torso), full braking side view (-1.0 deg),
    driver close-up through a cut body (left hand on the rim at 9, right short), wheel at 0 / 90 / +-420 from
    behind-left (hands near the rim, the seat hides most), front wheel at lock (poorly framed).
  - Not looked at: every frame of getting in / out, the door and hands on the handle, the car at the limit on the
    skidpad, over the kerb and in a slide from outside, wheels and arches at full bump, tyre smoke and skid
    marks in a picture, dust, headlights, night. Sound not heard.
  - Model: `public/vehicles/supercar.glb` 11.8 MB = LOD0 geometry with textures shrunk by
    `blender/vehicles/shrink_textures.py` (no Blender: GLB repack + sips): body 4096 -> 1024, interior 4096 -> 2048,
    trim and wheel 2048 -> 1024 (about 470 MB -> 80 MB of GPU textures with mips; 32.9 -> 11.8 MB file).
    Geometry, nodes, animations byte-identical.
  - Character regression (Tripo, rifle): idle 0.6, walk 1.8, jog 2.0, aimHold 0.9 frozen 5, burst 0.9 fire 0.6,
    reload 1.1, swap 2.5, crouchIdle 0.0 head 113, rampUp20 3.0 sink 0.1, stairsUp 2.2 sink 0.1; grip 0 / 0.
    Fog changed from 55-300 m to 70-1900 m and the far plane 300 -> 3000 m for the world.

- Main session's check of V1 (2026-11-11): `node --test test/dynamics.test.js` 8 of 8 pass. In the game
  `demo.vehicleReview('launch', 'brake100')`: 0 to 100 km/h 2.98 s, 0 to 200 8.53 s, upshift 0.10 s,
  100 to 0 in 30.21 m at 1.27 g mean with 1.37 degrees of dive; right palm 6.7 to 8.5 cm off the rim.
  Looked at (overlay tiles): the car parked from three sides, the driver through the window, the front
  wheel at full lock, the chase view at 80 and 183 km/h, full braking from the side with the brake
  lights and headlights on, a handbrake slide on the dirt (dust plume shows), the car from the front
  with the lights on, the cockpit view at 238 km/h.
  To fix in the next game pass (V2):
  1. The driver: use the clip pack with its `vehicleFit` (the placeholder leaves the right palm 7 cm
     off and the back off the seat); in the cockpit view the hands drop out of sight at 33 degrees of
     wheel.
  2. The cockpit camera: the roof lining fills the upper half of the picture and the road is a narrow
     band; reframe (eye point, pitch, vertical field of view) so the view is what a driver sees.
  3. The world's buildings are plain white boxes; the barrier beside the track reads as a white wall.
     Give them materials, windows, doors, scale cues.
  4. Bloom on the paint: the afternoon sun makes large white blobs on the body and the wheel arches.
  5. Wheels look frozen in stills at 183 km/h: add rim blur (or a blurred wheel state) with speed.
  6. Nobody has looked at: a kerb strike from outside, tyre smoke and skid marks on tarmac, every
     stage of getting in and out, the driver-against-car interpenetration measure (not built), the
     chase view from 200 m up, shadows past the 34 m box.
### H1 (2026-11-11): helicopter flight model, pure module, tested headless in Node

Built `src/heli/flight.js` (physics, no imports) and `src/heli/assist.js` (switchable keyboard assist),
with `tools/heli/` (scripted test pilot, 11 scenarios, `node --test` file, `report.txt`). Not wired
into the game; no browser, no Blender, no packages. Nothing outside `src/heli/`, `tools/heli/` and
this file was touched.

Run: `node tools/heli/run.js` (writes `tools/heli/report.txt`, about 10 s) and
`node --test tools/heli/flight.test.js` (18 pass, 1 todo = the known yaw miss). Note: in Node 24
`node --test tools/heli/` with a directory argument fails to resolve; give the file.

**Result: 62 PASS, 2 MISS, 45 reported-only rows.** Misses: full-pedal yaw rate in the hover is
204 deg/s right and 152 deg/s left against my assumed 60 to 120 deg/s (no checked real figure).

Model (constants and their sources are in `HELI` in flight.js):
- Frames: glTF body frame of `helicopter_root` (forward -Z, up +Y, right +X); state.position is the
  root, state.quaternion is {x,y,z,w} body to world, so the GLB root takes them directly. SI units.
- 480 Hz fixed sub-steps (8 per 60 Hz frame), semi-implicit Euler, quaternion attitude, gyroscopic
  term. 0.053 ms per 60 Hz frame in Node. 240/480/960 Hz agree within 1 mm over 20 s.
- Physical: rotor-speed torque balance (rotor inertia 1400 kg m^2, engine through a freewheel, aero
  torque, tail-rotor and accessory drive, reaction on the airframe = main-shaft torque); blade-element
  thrust (4 blades, chord 0.28, solidity 0.065, twist -10 deg, a 5.7, Cd0 0.008) with uniform inflow;
  Glauert momentum induced velocity with a 0.08 s dynamic-inflow lag; power = T x (kappa vi + climb
  inflow) + profile (1 + 4.65 mu^2, part as an H-force); translational lift, the power bucket and
  autorotation fall out of this. Cheeseman-Bennett ground effect at the hub, fading with speed.
  Tip-path plane: first-order flapping lag 16/(gamma Omega) = 0.07 s (Lock number 5.5) driven by
  cyclic (+-12 deg long., +-7 lat.), flapback, rate lag and gyroscopic cross terms (CCW rotor); hub
  moment from 5 % hinge offset plus thrust tilt about the CG; mast tilted 4 deg forward. Coning from
  thrust vs centrifugal stiffness (2.3 deg in the hover). Tail rotor (4 blades, 1.57 m, 2551 rpm,
  pitch +20/-8 deg) uses the same blade-element/momentum code, so its yaw damping, pedal-with-collective
  and any loss of effectiveness come out of the inflow. Fin 1.1 m^2 (+3 deg toe), stabiliser
  0.95 m^2 (+1 deg), cabin and tail boom drag elements in their local airflow including the rotor wake
  (skewed-cylinder test, gives hover download 3 % and stabiliser wake hits in transition), forward
  flat-plate area 1.45 m^2 incl. hub.
- Approximated, empirical: vortex ring = Leishman's measured axial induced-velocity curve plus a ring
  state (builds in 1 s when descent is 0.2 to 2.0 vh at edgewise speed < vh, decays in 2 s) that
  re-ingests inflow through the disc in proportion to blade pitch over the hover value. The pump gain
  (2.0) was set so that adding power in a developed ring deepens it, as the task asks; with 1.3 power
  only barely helped (12.8 -> 11.9 m/s). Lateral tilt toward the advancing side = (4/3) mu beta0
  (coning) + tan(chi/2) lambda_i (transverse flow, Coleman Kx). Retreating-blade stall = soft cap on
  CT/sigma at 0.125 - 0.12 mu with extra drag and a pitch-up/roll-left tilt. Compressibility =
  profile drag rise above advancing tip Mach 0.86. Engine = gas-generator speed lag (0.4 s, 15 %/s
  accel limit) on a power map (560 kW thermodynamic at Ng 100 %, rated 520 kW = 100 % torque,
  MCP 468 kW), PI N2 governor with collective anticipation and a rate-limited reference on spool-up.
- Mass 2200 kg (max 2500), CG 1.77 m under the hub, 2 cm aft; inertia pitch 6000, yaw 5200,
  roll 1800 kg m^2 (estimates for the class, no products of inertia).
- Ground: 12 skid points (5 shoes + toe per skid at x +-1.1) + 14 hull points; 40 kN/m and
  3000/4000 N s/m per point (5.4 cm static deflection, ~0.7 critical); friction by an anchored
  spring (stiction, no creep) with an ellipse: 0.40 along the skid, 0.65 across, scaled by the
  `friction` the ground callback returns.
- Not modelled: lead-lag, ground resonance, main-rotor wake on the tail rotor, fuel burn, blade
  strike damage (flagged only), products of inertia, mast bumping.

Numbers (2200 kg, ISA sea level): start to 99 % Nr 35.8 s (quick start 8.7 s, labelled, uses a
non-physical spin-up torque); flight idle 390 rpm, Ng 70 %; droop 2.1 % on a 0.2 collective pull in
0.4 s; hover OGE 70.8 % of 520 kW (collective 0.473, pedal -0.38, bank -3.0 left skid low, pitch
+3.5); IGE at 1 m skid height 9.4 % less power; vertical climb at 100 % torque 9.4 m/s, forward
11.8 m/s; bucket 110 km/h at 40 %; cruise 220 km/h at 70 %, pitch -2.3; Vmax 247 km/h at MCP,
256 km/h at 100 %; 260 km/h IAS reached in a 5 m/s dive with tip Mach 0.873; stall flag at 2.0 g in
a pull at 260; turns 1.18 g at 30 deg, 1.45 g at 45 deg; autorotation 10.3 m/s at 120 km/h, Nr 96.8
to 103.8 % (collective fully down 105.6 %), entry droop to 88 % with 1 s pilot delay, flare to a
1.23 m/s touchdown at 43 km/h; VRS: a requested 6 m/s vertical descent runs away to 15.8 m/s,
hover collective in the ring 12.8 m/s, 100 % torque 14.7 m/s, forward to 72 km/h recovers in 6.2 s;
landings: gentle 0.32 m/s no bounce, firm 2.82 m/s 3.7 deg max bank (one short contact loss),
6 deg slope sits at -6.15 deg, run-on at 40 km/h stops upright, side drift rolls it over at 3 m/s on
soft ground and never on hard ground (slides); 60 s on the ground under 0.04 mm/s.

For the integrator: see the header of flight.js (frames, units, step, controls) and the assist
header. `heli.reset({position, heading, running: 'cold'|'idle'|'flight', inAir})`, then per frame
`heli.setControls(assist.update(heli.state, keys, dt)); const s = heli.step(dt);`. Placing the root
on the ground at y = ground drops it 5 cm onto its springs in the first second (reset without a
position puts it at the static deflection). The assist's centred-stick pitch reference is
`assist.pitchTrim` (+3 deg, slows toward the hover hands-off).

Not verified: real-aircraft reference figures are approximate numbers from memory, not looked up;
nothing seen in a browser or with the asset; feel with a keyboard untested (only scripted pilots);
yaw-rate reference unknown; wind and gusts exist as `opts.wind` but no scenario flies them; LTE was
not provoked; altitude performance above 1500 m not checked; the hover with the assist off diverges
(bank 50 deg in 20 s), as real helicopters do, but whether a person can fly it with care was not tried.

- Main session's check of H1 (2026-11-11): `node --test tools/heli/flight.test.js` and
  `node tools/heli/run.js` re-run here; results as the entry above says. Not yet seen in the game.
  For the game pass: full pedal in the hover turns 204 / 152 degrees a second (the pass's own target
  was 60 to 120; real light helicopters are roughly 90 to 120): bring it into that range without
  losing the pedal margin at full power, and say what margin is left.

- Clips, second round (A1 follow-up, 2026-11-11; full entry in `notes/A1_log_entry.md`): the seated
  clips were rebuilt with `vehicleFit` (car: seat (0, -0.03, -0.20), steering wheel 0.06 m out along
  its column; helicopter: pedals 0.25 m aft, pilot seat 0.08 m forward). The agent did not ship them
  because a few targets were missed; the main session looked at the sheets and shipped the Tripo pack
  (13 clips: 4 car, 9 helicopter) to `public/characters/vehicle-motion-tripo-v1.*` at 21:06. The
  EarthOnline pack in `public/` is still the first one (old posture, no `vehicleFit`) until that body
  has its own fit.
  Accepted misses in the shipped Tripo pack: shoulder blades 4 to 5 cm into the bucket seat's side
  bolsters; right knee resting on the centre tunnel; knee 2.4 cm from the rim; pilot's back 5 cm off
  the backrest with a 22-degree forward lean (the cyclic grip is 18 cm above the cushion); the seat's
  modelled harness straps pass through the pilot (hide or refit them when the seat is occupied).
  Not done: `car-enter` (a 9 s draft exists and fails: 150 of 271 frames through the seat, sill, wheel
  or door; hands 5 to 13 cm off their holds), `car-exit`, `heli-enter`, `heli-exit`, the EarthOnline fit.
  Finding for any retry: the open car door hangs over the doorway at head height (x -1.26 to -0.83,
  z -0.95 to +0.10, y 1.0 to 2.0), so the approach must stay behind its rear edge.
- 2026-11-11, pass V2: the helicopter in the game, the vehicle clip packs wired in, the car's faults.
  - Works end to end (driven through demo.step, both vehicles): walk to the helicopter on the helipad, T, gun
    on the back, walk to entry_cockpit_R, cockpit_door_R opens, placeholder entry, door shuts, seated pose from
    the Tripo pack (heli-fly + 8 pose clips added by the controls, IK to the pack's contacts on the live
    cyclic / collective / pedal nodes); start (I real 35.8 s, U quick 8.7 s), lift-off, hover, cruise at
    220 km/h, steep bank, autorotation to touchdown, landing, T out. The car the same way (pack seated path).
    Game loads with no errors; page left reloaded in normal play.
  - Flight model change (src/heli/flight.js): full-pedal hover yaw 204 / 152 -> 122.6 / 91.5 deg/s by
    (a) an empirical yaw damping 1850 N m s/rad (hover Nr -0.33 -> -0.69 /s; the element model leaves out the
    rotor wakes on fin and boom, which H1 listed as not modelled) faded out between 10 and 30 m/s edgewise, and
    (b) right-pedal travel of the tail rotor 14 -> 7.5 deg per unit (full right -8 -> -1.5 deg; left travel kept).
    Left-pedal margin at 100 % torque in the vertical climb: 27.76 % of travel at 2200 kg (H1: 27.8), 30.0 %
    at 2500 kg. Cost: the steady autorotation needs pedal +0.92, so 8 % of right travel is left there.
    Also: obstacleAt hook (hull and skid points pushed out of buildings / barriers, rotor disc at 8 azimuths x
    2 radii and the tail-rotor disc tested -> flags.rotorStrike, state.strikeAt, flags.obstacleContact).
    Assist: heading hold also on the ground once collective > 0.25 (it turned 32 deg on lift-off without);
    torque limiter rewritten as a walking cap (H1's per-frame cut chattered 0.3 <-> 1.0 against a held lever).
    `node --test tools/heli/flight.test.js` 19 pass 0 todo; `node tools/heli/run.js` 65 PASS 0 MISS 46 rows
    (new row: left-pedal margin).
  - Game numbers against Node (demo.heliReview: tools/heli scenarios through demo.step, game's own aircraft
    over the helipad, the same TestPilot): engineStart, hover OGE/IGE (2200 and 2500 kg), verticalClimb,
    cruise 220 (70.0 % power, pitch -2.26), levelTurn (1.178 / 1.454 g), autorotation, gentle / firm
    landings: identical to Node to the printed digit after resetting the controls between scenarios, except
    autorotation flare touchdown 1.226 vs 1.239 m/s and final bank 0.001 vs 0.003 deg (it lands on the game's
    ground, about 2 km north of the pad: dirt friction 0.75, not Node's flat concrete). Before that reset
    cruise read 73.3 % and the 30-deg turn torque 53.4 vs 49.9 (controls carried over from the scenario before).
  - Pilot at the control limits (demo.heliReach, 11 positions incl. combined corners): Tripo (pack path) palms
    0.94 cm both hands at every position (a constant offset, not explained), soles 0.0 cm; EarthOnline
    (placeholder IK) palms 0.0, left 2.9 to 3.2 cm at collective down; soles 0.0.
  - Body against the cabins (demo.bodyClearance, skin vertices vs part triangles, depth behind the nearest
    face within 5 cm of it; open meshes can give false depth): car seated, wheel 0 / 420 deg: seat 4.5 cm
    (clavicles, as the clip agent said), wheel 1.0 / 1.2 (fingers), door 0, body_shell 15.6 / 15.4 at the left
    calf (into the footwell side or a false reading: not looked at), interior 4.8 (left foot). Helicopter, centre
    / all limits: seat 6.8 / 6.4 (right thigh), cyclic 0.8 / 1.7, collective 2.3 (left fingers), door 0,
    fuselage 14.5 / 15.5 (right calf), instrument_panel 22 / 0 (left thumb at centre: not looked at).
  - Car driver (B1), Tripo pack with vehicleFit applied to seat_driver, seat_driver_point, steering_wheel:
    car-drive + car-steer-l/-r added by wheel/90 + car-look-back when reversing; hands by the push-pull riding
    the rim to +-90 then regripping (targets lowered to 10 / 2 o'clock), clavicle protraction up to 18 deg when a
    grip is past reach. Static palms (wheel 0, +-45, +-90, +-135, +-180, 270, +-420): left 0.0 everywhere,
    right 0.0 to 4.0 (V1 placeholder: right 6.5 to 7.7). Drives: launch / brake / standstill / topSpeed 0.08,
    powerOver 1.8, skidpad200 2.2, rollPitch 2.6, skidpadLimit 3.2, liftOff 3.9, slalom 5.6, lockToLock worst
    15.3 (transient during a regrip), handsOffRimS 3.8 of 9 s (V1 4.7). hipsOffSeatCm 8.1 is now meaningless
    (measures against the placeholder's offset). EarthOnline bodies fall back to V1's IK (pack has no fit).
  - Car numbers (demo.vehicleReview, all 13): 0-100 2.98, 0-200 8.53, top 348.8, 100-0 30.21 m / 1.268 g mean /
    1.368 deg dive, skidpad 1.165 g at 102, skidpad200 1.392, roll 2.673 deg/g, dive 0.826 deg/g, upshift 0.10,
    standstill 0, wheel speed 2.13 %, slalom 0.792 g 21.8 deg/s, liftOff +13.1 % no spin, powerOver rear 2.68 /
    front 6.79 deg, kerbGame bump 3.69 cm peak 14.65 kN air 0.167 s roll 0.88 (V1: 3.9 cm, 15.5 kN). Node
    `node --test test/dynamics.test.js` 8 pass.
  - Character (Tripo, rifle): idle 0.6, walk 1.8, jog 2.0, aimHold 0.9 frozen 6, burst 0.9 fire 0.6, reload 1.1,
    swap 2.5, crouchIdle 0.0 head 113, rampUp20 2.9 sink 0.1, stairsUp 2.6 sink 1.2; grip 0 / 0 everywhere.
    Misses against V1: aimHold frozen 6 (5), stairsUp sink 1.2 (0.1; earlier passes 0.1 to 1.2).
  - Seen (contact sheets, overlay copies): helicopter parked from 4 sides and top; start at Nr 0 / 20 / 40 / 60 /
    80 / 99 (blades fade from 40 %, disc in); lift-off with the wash; hover 3 m from the front (bank -3.6, left
    skid low); hover from above; cockpit and chase in the hover; cruise 211 to 214 km/h chase and cockpit; fast
    pass from the ground at 210 km/h; 51-deg bank from outside and chase; 200 m above; autorotation descent,
    flare at 25 m, level at 4.9 m, touchdown 1.27 m/s at 43 km/h (dust), stopped; hard landing 4.3 m/s (skid load
    6.0 W, no strike, bank 3.9); rotor strike on the hangar's east wall (it leans on the wall, rotor stopped,
    1.5 s later Nr 7 %); pilot from outside; cockpit view after moving the lens 10 cm ahead of the eye (before:
    the pilot's own shoulders and the inside of the hidden head showed as dark and skin-coloured shards); every
    stage of the placeholder entry and exit of both vehicles; driver at full lock both ways; car cockpit
    standing and at 160 km/h; wheel blur at 160; buildings and barrier at 176; paint in the sun; car chase from
    200 m; down the straight past the shadow box; handbrake slide (marks dark, smoke faint); kerb strike at
    60 km/h from outside.
  - Not looked at / not fixed: the placeholder entries pass through the car's sill and door frame and the
    helicopter's floor (feet below the cabin floor at 1.7 to 1.8 s); no hand on a handle (no clip yet). Shadows
    still stop at the sun's box (lamp posts past it unshadowed). The 51-deg bank strip read 0.90 g (a transient
    of my strip's pilot, not a trim). Cabin doors, rear seats, night, wind, sound (not heard: described in
    src/heli/sound.js). GPU texture memory not measured in the browser (estimate below).
  - Clip packs used: vehicle-motion-tripo-v1 21:06:52 (car-drive, car-steer-l, car-steer-r, car-look-back,
    heli-fly, heli-cyclic-f/b/l/r, heli-collective-up/down, heli-pedal-l/r; vehicleFit car + heli);
    vehicle-motion-ue5-v1 20:44:18 (car-drive, car-steer-l/-r, car-look-back; no vehicleFit -> placeholder).
    Real clips: car seated (Tripo), helicopter seated (Tripo). Placeholder only: car-enter, car-exit,
    heli-enter, heli-exit (not in either pack), every EarthOnline seated pose. The pack path for enter / exit
    (root, door track, contacts pinned with IK, vehicleFit) is written and has never run with a real clip.
  - Asset: public/vehicles/utility_helicopter.glb 15.2 MB (LOD0, 124.6 k tris; textures ext_normal, int_basecolor,
    int_normal 2048, displays 2048x1024, rotor_blur 1024x512, the rest 1024; est. 108 MB GPU with mips vs about
    700 MB at the source sizes); in the page it finished loading 39 ms after the car (parallel). Harness straps:
    the 116 fabric triangles of pilot_seat above 25 % height and ahead of 30 % depth are hidden while the seat is
    taken (669 kept), not checked in a picture.
  - Bloom (look.js) 0.5 / 0.3 / threshold 3.0 -> 0.42 / 0.16 / 7.0, soft knee 3.0: no blobs in the sun sheet.
    Cockpit camera (car): -4 deg / 68-74 fov -> -8 deg / 54-59 fov. Buildings: windows, frames, sills, plinth,
    doors, hangar leaves, garage doors, roof plant; barrier darker with a red and white top band and joints.

- Main session's check of V2 (2026-11-11): looked at V2's own sheets and took new ones. Helicopter in
  a hover at 8 m (rotor 395 rpm): chase view with the blur disc, shadow and dust ring; pilot seated
  through the door glass with hands down on the controls; cockpit view shows the windscreen, centre
  post and the glare shield. Car after a clean `seatInCar()`: driver back in the seat, both hands on
  the rim at 9 and 3 from outside and in the cockpit view; at 92 degrees of wheel the left hand is on
  the rim top-left. `demo.bodyClearance()` (car): body shell 15.6 cm (left calf, 93 vertices), seat 4.7
  (clavicle), interior 4.8 (left foot), wheel 1.0, door 0.
  Open after V2 (for the next passes):
  1. Getting in and out is still the placeholder for both vehicles (no clips yet); it passes through
     the sill, the door frame and the helicopter's floor.
  2. Shadows stop at the sun's shadow box: buildings and the far ground have none when driving, flying
     or looking from height.
  3. Helicopter cockpit view: the glare shield is a dark slab over the bottom third and the hands on
     the controls are out of view; V2's sheets at 214 km/h and in the hover show large dark and pink
     shards across the windscreen (blades or the pilot's own body near the lens): check every attitude.
  4. Car regrip: right palm up to 15 cm off for a moment, hands off the rim 3.8 s of a 9 s lock-to-lock.
  5. Clearance readings nobody has looked at: car left calf 15.6 cm into the body shell (wheel-arch
     side of the footwell), helicopter right calf 14.5 to 15.5 cm into the fuselage, left thumb 22 cm
     into the instrument panel with the controls centred.
  6. The constant 0.94 cm palm offset on the helicopter's pack path.
  7. Tyre smoke on tarmac is faint.
  8. The guns vanish when the door shuts; they need a visible place in each cabin.
  9. Sound has never been judged: render it offline and look at spectra.
  10. The EarthOnline bodies have no fitted vehicle clips (placeholder IK only).
- 2026-11-11, pass A2: getting into and out of the supercar and the helicopter (Tripo body). NOTHING SHIPPED:
  no clip passed its targets. `public/characters/vehicle-motion-tripo-v1.*` is unchanged (13 seated clips).
  - Authored and judged, not shipped: `car-enter` (8.0 s, 241 frames), `heli-enter` (7.4 s, 223 frames), `heli-exit`
    (6.0 s, 181 frames; the two helicopter clips by a forked agent, private headless Blenders). Not authored: `car-exit`;
    the EarthOnline fit. Candidate pack with all 16 clips: `blender/review/vehicles/candidate/vehicle-motion-tripo-v1-a2.glb`
    / `.json`; its 13 seated clips are bit-identical to the shipped pack (every channel, notes identical:
    `candidate/bitcheck-13-a2.txt`); three.js GLTFLoader load check on the Tripo body PASS (`candidate/load_check-a2.txt`);
    round trip 0.097 mm. Rifle packs: `rifle-idle` and `swap-rifle-shotgun` rebuilt in private headless Blenders for both
    bodies, every channel bit-identical (96/104 Tripo, 99/107 EarthOnline), notes identical.
  - New machinery (A1's files copied first to the scratchpad `a2_orig/`):
    - `vehicle_motion/judge_a2.py`: per-pair depths split soft (seat) / hard, head clearance per part, wrists per frame
      (frames past +-60 / +-45), forearm twist step, least elbow and knee bend, centre of mass (Dempster shares) against the
      support (planted feet, hand holds, the seat under the hips), planted-foot slide in the node frame, the pose error
      against the seated reference at the joining frame. `judge.VehicleTest` now returns `depthCm` (body-vehicle pairs:
      deepest vertex of either side behind the other's nearest face), `contactDepthCm`, signed head clearance by part.
      `build_vehicle_motion.py` writes `<clip>-frames.txt` (per frame: pairs with depths, head by part, contacts, elbows,
      wrists, knees) for enter / exit clips, 20-frame sheets for them, and keys the knee poles with a per-side blend weight.
    - `vehicle_motion/pose.py`: `@body` / `@shoulder_l` / `@shoulder_r` pseudo-nodes (free hands hang under the shoulder and
      go with the trunk), the roll solver's roll carried across moves (`carry_rolls`, no jump at the joins), one roll per
      hold when `fixed_roll` (the palm stays on its contact point: contacts went from 1.8 cm to 0.0), free hands and moves
      turned with the forearm (`natural_moves`), a balance planner that shifts the hips over the support before a foot lifts
      (`plan_balance`, `supports`, `com_estimate`), knee poles that blend back to the rig's rest.
  - car-enter, as authored (butt first): 0-0.6 s stand, right foot half step in; 1.05 right hand on the door's grab; 1.1-1.4
    lifts the door to 16 %, lets go, the strut takes it open by 2.2 while the hand drops away; 1.9-3.35 two steps and a turn
    to stand OUTBOARD of the open door (pelvis x -1.36, the door's outer face is x -1.26) facing out; 3.35-4.7 sits back like
    onto a chair, feet planted, trunk leaning out (head stays outboard of the roof edge and behind the door's lower edge),
    right hand under the open door's lowest corner (4.0-4.3), left hand on the sill top behind the hip (4.8-5.05); 4.7 hips on
    the seat's edge; 5.0-5.7 right leg over the sill and forward under the column to the accelerator; 5.35-6.15 left leg in;
    the trunk tilted out of the doorway; 6.1-7.3 head swings in under the roof (tilt from left to back); 6.35-6.85 left hand
    pulls the door from open to 45 %, lets go, it shuts at 7.2; right hand to 3 o'clock at 6.8, left to 9 at 7.6; from 7.7
    exactly car-drive frame 0 (join 0.000 mm / 0.000 deg).
    - Numbers (targets in brackets): snap30 hand_l 4.1, hand_r 2.6, foot_l 3.7, foot_r 2.2, head 0.3 (<= 3.5: hand_l, foot_l
      FAIL); wrists worst L flex -109 dev -171, R flex +61 dev -40, past the limits on frames 31-32, 134-135, 142-147, 155-156,
      203-209 (FAIL); twist step 75 deg at 135 (<= 30 FAIL); elbow min 0.2 at 49 (FAIL); knee min 12.3 (pass); contacts <=
      1.41 cm (hand_l on the door, FAIL by 0.41; all others <= 0.06); planted-foot slide 1.19 mm/frame; balance outside the
      support by up to 24.8 cm, over 3 cm on frames 17, 43, 59-65, 75-86 (walking steps), 137-143 (the hips going back onto
      the seat) (FAIL); hard pairs 112 frames with any pair; worst hard depths: thigh_r/body_shell 4.2 (f153, right leg
      lifting over the sill), thigh_l/body_shell 4.1 (f165), calf_r/interior 3.5 (f180, shin against tunnel / column),
      fingers_l/door 3.5 (f211, letting go of the closing door), fingers_r/door 3.2 (f46, letting go of the grab),
      foot_l/interior 3.1 (f182), thigh_r/interior 3.1, fingers_l/body_shell 3.1 (f143), thigh_r/steering_wheel 2.7 (f163,
      knee under the rim), and 25 more between 1.0 and 2.7 (list: `candidate/car-enter-frames.txt`); soft (seat) worst
      upperarm_l 4.4 at 150-155 moving, lowerarm_l 3.3, clavicle_l 4.35 / spine_05 4.0 / spine_03 3.9 at 192-219 moving.
      At rest the seated reference itself (car-drive frame 0, inherited, unchanged) has: upperarm_r 4.53, upperarm_l 4.31,
      clavicles and spine_03 3.61, head 2.57, neck 2.30, thigh_r 1.62, thigh_l 1.22 into the seat; thigh_r / calf_r against
      the centre tunnel 2.05 and the left foot against the footwell side 1.48 (hard).
  - heli-enter / heli-exit (fork): both end / start exactly on heli-fly frame 0 (join 0.158 mm / 0.112 deg). heli-enter:
    snap30 hand_l 4.9, hand_r 3.9, foot_r 4.1; wrist L dev -75 at f99; twist 47.5; elbow 0.2, knee 0.2 (FAIL); balance up to
    22 cm (walk); contacts up to 2.39 cm (hand on the door glass while pulling); hard worst fingers_r/door glass 4.7,
    hand_r/door handle 3.8, thigh_l/cyclic 3.4, thigh_r/door 3.1, arm/fuselage 3.0; seat thigh_l 5.4. heli-exit: snap30
    foot_l 8.1, foot_r 5.7, hand_r 4.8; wrist R flex -116 dev -99 at f72; twist 97.5; elbow 0.2, knee 0.2; balance up to
    14.5 cm; contacts up to 2.1 cm; hard worst thigh_l/fuselage 5.0, upperarm_r/interior 4.3, fingers/door glass 4.0; seat
    thigh_l 8.8 (rising out of the seat).
  - Seen (sheets `review/vehicles/tripo/car-enter.png`, `heli-enter.png`, `heli-exit.png`, 5 views x 20 frames; close-ups
    `close-car-enter-{handle-32,75,141,158,172,180,198,end-240}.png`, `close-heli-*`): car-enter reads as grab, lift, step
    round outboard of the door, sit back with the trunk leaning out, legs in one after the other, door pulled down, hands to
    the wheel. Wrong in the pictures: legs spread wide while seated sideways (right leg in the footwell, left still out);
    the left hand on the sill reads as resting rather than taking weight; at 198 two of three close-up views are blocked by
    the closing door; the 'lowest' close-up of the older build picked the seated end (replaced by frame 141).
  - Findings for the next pass: (1) the open door leaves no standing room beside the seat: standing outboard of it
    (x <= -1.36) and sitting back works; (2) the steering column shroud is at y 0.55-0.65, z -0.6..-0.8, x -0.42..-0.32 and
    the footwell narrows to x > -0.5 for z < -0.9: the right knee must pass under the rim and column at y <= 0.47; (3) a
    flat palm on a low sill with a vertical forearm is ~90 deg of wrist extension: only edge grips stay inside +-60;
    (4) the remaining failures are mostly the hand holds' turns over long holds while the body moves, and the legs
    crossing the 16 cm sill.

- Main session's decision after A2 (2026-11-11, 23:1x): looked at `blender/review/vehicles/tripo/
  car-enter.png`. The clip reads as a real entry (handle, door up, step round the door, sit back
  leaning out, legs in one after the other, door pulled down, hands to the wheel) and is far better
  than the placeholder, so the 16-clip candidate was shipped to `public/characters/
  vehicle-motion-tripo-v1.*` (13 seated clips unchanged + `car-enter`, `heli-enter`, `heli-exit`) so
  the game's clip path can run. Known faults in those three clips: wrists flip on a few frames
  (car-enter f31-32, 134-135, 142-147, 155-156, 203-209), a 75-degree twist step at f135, a straight
  elbow at f49, the head 2.3 cm into the roof at f205-208, thighs 4 cm into the sill at f153 / f165;
  heli-exit feet snap 8.1 and 5.7. `car-exit` does not exist yet: the game must keep its placeholder
  for getting out of the car. The clip pass is resumed to fix those frames and author `car-exit`.
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

- Main session's check of V3 (2026-11-11, about 23:50): looked at V3's sheets (`carenter_side.jpg`,
  `helienter_side.jpg`, `final_cockpit.jpg` in the scratchpad's `sheets/`): the car entry and the
  helicopter entry play in the game on the clip path and read as real moves (handle, door, step or
  sit, legs in, door shut, hands on); the helicopter cockpit view shows the lit panel, the posts, the
  knees and feet on the pedals, the hand on the cyclic when looking down, no shards in twelve
  attitudes; the guns stand in the left footwell. Re-measured in the game: `vehicleReview('lockToLock')`
  palm 0.6 cm (V2: 15.3), launch palm 0, 0 to 100 km/h 2.98 s; the pack lists 16 clips.
  New finding: frame time. Driving at part throttle, step + render + GPU done, 90 frames at the pane's
  2048 x 1536: median 43.5 ms, p95 51.5 ms (23 frames a second), 895 draw calls, 906,664 triangles
  (V3's own figure was 30.3 ms; the clip pass was using the machine during mine). A game that runs at
  23 to 33 frames a second cannot feel real: this is the next pass's first job.
  Open after V3:
  1. Frame time (above). Render submission dominates: 1037 meshes, 420 shadow casters, 4 cascades.
  2. `car-exit` clip missing (placeholder); clip faults listed by V3 (jumps at f134 / f161 / f171 of
     car-enter, crossings in all three clips, helicopter door opens only to 41 degrees, collective
     should rest at 4 degrees on the ground). The clip pass is working on these.
  3. Guns on the back pass 5 to 7 cm into the sill and seat during car-enter (f153) and the shotgun
     5.6 cm into the door (f93).
  4. Is there real rotor wash? V3 found that what V2 and the main session took for a dust ring was the
     rotor's blur disc lying at skid height. Check that dust now shows under a hovering helicopter.
  5. Seated soles 1.7 cm low on the non-clip path; the cyclic hand just out of frame with the stick
     centred; cascade borders in motion not looked at; tyre smoke from the cockpit not looked at.
  6. EarthOnline bodies in vehicles: placeholder IK only.
- 2026-11-12, pass V4: frame time, the guns while getting in, rotor wash, the small leftovers.
  Method throughout (`tools/v4_cost.js`): one frame = `demo.step(1/60)` + `demo.render()` + `await
  device.queue.onSubmittedWorkDone()`, the game's own animation loop held while measuring (with it running, as in the
  main session's check, it draws an extra frame whenever the browser asks while the measured one waits), blocks of 90
  frames, three blocks pooled (270 frames), a quarter second between blocks. Cases (`setupCase`): on foot in the yard
  (third person, looking north over the range), the lap's main straight at 200 km/h in the chase view (pure pursuit on
  the centre line), the same in the cockpit view, the helicopter at 100 m and 150 km/h (chase). Before = the same code
  with `?v3` (every V4 change off: no batching, no proxies, no layer split, matrices in every pass, full pixel ratio, no
  sleeping); same sitting, page reloaded between the car and the helicopter. The machine was shared all the time
  (load average 36 to 42 on 18 cores, another agent's Blender and Node jobs, frames of 100 to 1200 ms in both
  modes): medians move by up to 2x between blocks; p95 is mostly other processes.
  1. Frame time, before -> after (ms, median / p95; draw calls; triangles):

     | case | V3 set A | V3 set B | V4 set A | V4 set B (3 runs) | draws | triangles |
     |---|---|---|---|---|---|---|
     | on foot | 33.8 / 64.1 | 46.0 / 161.8 | 20.2 / 48.8 | 15.8 / 46.4; 17.0 / 58.1; 9.2 / 17.1 | 1320 -> 194 | 756,755 -> 656,675 |
     | car chase 200 km/h | 32.7 / 65.0 | 35.2 / 47.6 | 19.2 / 48.3 | 17.3 / 36.1; 12.7 / 18.4; 19.6 / 57.7 | 1289 -> 171 | 1,039,036 -> 920,446 |
     | car cockpit | 23.4 / 30.1 | 28.9 / 39.8 | 10.7 / 44.5 | 13.1 / 78.1; 10.1 / 15.9; 12.6 / 43.1 | 1094 -> 132 | 915,784 -> 884,928 |
     | helicopter 100 m 150 km/h | 45.2 / 65.5 | 43.1 / 111.4 | 13.8 / 21.7; 14.6 / 19.3 | 24.3 / 81.7; 15.1 / 81.4 | 1630 -> 224 | 1,286,690 -> 1,130,536 |

     (Set A about 23:58 to 00:05, set B 00:45 to 00:55. Canvas 2048 x 1536 before, 1536 x 1152 after.) Target (median
     <= 16.7, p95 < 22): met in quiet blocks in all four cases (foot 9.2 / 17.1, car 12.7 / 18.4, cockpit 10.1 / 15.9,
     helicopter 13.8 / 21.7 and 14.6 / 19.3); medians over 16.7 in the loaded blocks for the car chase (17.3, 19.6) and
     on foot (17.0, 19.1, 21.0) and p95 over 22 in most loaded blocks. Not met reliably on this machine as it was;
     V4 is 2.0 to 3.1 x faster than V3 in every same-sitting pair.
     Split (median ms: step / render call CPU / GPU after submit), set B: car V3 2.1 / 25.2 / 6.9 -> V4 2.0 / 8.2 /
     5.8 (quiet 1.9 / 7.1 / 3.3); cockpit 2.1 / 20.0 / 5.8 -> 1.9 / 6.7 / 3.8; foot 2.3 / 30.8 / 8.3 -> 1.0 / 9.0 / 6.5;
     helicopter 2.0 / 29.7 / 9.8 -> 1.1 / 8.6 / 5.2.
     Per pass (CPU ms exclusive / draw calls, `passes: true`; V3 set A, V4 final code):
     | pass | foot V3 | foot V4 | car V3 | car V4 | cockpit V3 | cockpit V4 | heli V3 | heli V4 |
     |---|---|---|---|---|---|---|---|---|
     | cascade 1 | 1.3 / 58 | 0.3 / 15 | 5.2 / 131 | 0.5 / 14 | 4.4 / 131 | 0.5 / 14 | 6.6 / 131 | 0.7 / 19 |
     | cascade 2 | 3.4 / 189 | 0.3 / 28 | 3.6 / 142 | 0.3 / 13 | 2.7 / 132 | 0.3 / 13 | 5.5 / 228 | 0.7 / 33 |
     | cascade 3 | 2.7 / 320 | 0.1 / 8 | 2.2 / 189 | 0.2 / 7 | 2.0 / 169 | 0.2 / 5 | 3.0 / 428 | 0.4 / 13 |
     | cascade 4 | 3.7 / 420 | 0.1 / 14 | 3.8 / 420 | 0.2 / 14 | 3.2 / 420 | 0.2 / 14 | 3.1 / 428 | 0.2 / 14 |
     | pre-pass | 4.9 / 158 | 1.8 / 56 | 6.4 / 189 | 2.5 / 51 | 4.7 / 106 | 2.7 / 34 | 6.7 / 195 | 2.2 / 63 |
     | lit pass | 4.1 / 159 | 1.9 / 57 | 6.3 / 208 | 1.9 / 58 | 3.8 / 117 | 1.8 / 39 | 4.6 / 214 | 1.7 / 70 |
     The post chain (GTAO, denoise, TRAA, motion blur, bloom 12 small passes, output): 0.0 to 0.3 ms CPU each, 17 draws,
     unchanged. GPU per pass could not be measured: with `?gputime` (three's timestamp queries) this GPU reports about
     7.9 ms for every small quad pass, more than the whole frame's wall time (three 0.187 also shares one
     timestampWrites object between pass descriptors: `v4_cost.js` copies it per pass; the readings stayed absurd).
     By ablation instead: the GPU's tail after the last submit is 6.1 ms at 2048 x 1536, 4.3 at 1024 x 768, about the
     same with the sun's shadows off (-0.5) or the whole post chain off (plain); removing 290 k shadow triangles (the
     vehicles' far proxies) changed nothing measurable. Pipelined (no wait per frame) the frame was 11.8 to 12.7 ms with
     10 ms of CPU: CPU-bound.
     What took the time: three's per-object work in every pass (node uniform updates 1.5 ms, bindings 2 ms, the
     object / geometry / pipeline lookups and the draw itself, about 13 to 25 us per draw call when quiet, 50 when
     loaded), times 1100 to 1800 draws a frame, 420 of them shadow casters drawn again in each cascade (cascade 4 drew
     every caster in the world, 420).
     What each change bought (draws a frame, car chase unless said):
     - World static meshes merged per material (`batchWorld`, the yard's boxes, ramps, rails, stripes, buildings with
       doors, plant, boards, kerbs and lines; 260 meshes -> 19 merged + singletons); originals out of the scene, still in
       `fx.colliders` (a bullet mark on one goes on the scene); on foot 1320 -> 407 with the shadow proxies below.
     - Shadow proxies (depth-only meshes on their own layers, `batch.js`): the world in 80 m patches for the first two
       cascades and 400 m patches for the last two; each vehicle one skinned proxy (first two) and one rest-pose proxy
       (last two); each rotor's blades one proxy; layer 0 (the body, loose cases and magazines) in the first cascade
       only. Cascade 4: 420 -> 14 draws, cascade 3: 189 -> 7.
     - Vehicles as one rigid skeleton: every moving node (doors, suspension, steering, wheels, steering wheel, seat;
       the helicopter's doors, cyclic, collective, pedals) is a bone; each material is one skinned draw for the whole
       vehicle (car 106 -> 23, helicopter 86 -> 30 of which 16 are the rotors and the pilot's seat, kept as they were).
       The skinned meshes hang from the scene, not the vehicle: under the moving vehicle the velocity pass compared the
       previous frame's bones with this frame's bind matrix and the whole car smeared at speed (seen in the first after
       sheet, fixed). Culling on the rest sphere + 1 m, moved with the vehicle each frame.
     - Guns (merged except magazine, charging handle, trigger, pump; 24 -> 14 a pass), the belt kit (one material per
       colour; 10 -> 4), the target frames (legs, feet, bars into the world; chains one per target).
     - Scene matrices updated once a frame, not in each of the pre-pass, lit pass and post passes.
     - The parked vehicle nobody is in sleeps once settled: no flight model (1.2 ms a frame for the cold helicopter on
       the pad: 8 sub-steps, 26 ground contacts), no car physics, no re-placing of their nodes.
     - Tyre smoke, dust and rotor wash: one instanced sprite each (`src/cloud.js`) instead of one draw per puff (a
       handbrake slide put about 100 sprite draws in a frame).
     - Render scale: at most 1.5 device pixels per CSS pixel: 2048 x 1536 -> 1536 x 1152 (1.78 x fewer pixels), GPU
       tail 6.2 -> 3.7 ms in the same page, alternating.
     Not done, with reasons: the vehicles' `_lod1` / `_lod2` (draw calls were the cost, not triangles: 290 k fewer
     shadow triangles measured no change); far cascades every second frame (cascades 3 and 4 now cost 0.1 to 0.2 ms CPU
     each); taking zero-intensity lights out of the light list (the car's beams, the landing light, the beacon flash:
     each change of the light set recompiles every lit shader, which V3 measured at 1 to 17 s).
     Nothing renders twice: the merged originals are hidden (vehicles, guns: `visible = false`, or off the view's
     layer when they carry child nodes; bodyClearance still reads them) or out of the scene (world); 380 hidden smoke and
     dust sprites are gone from the scene (two instanced sprites).
  2. What was lost (pictures in the scratchpad's `sheets/`: `v4_cmp_cases.jpg` foot, chase, cockpit with crops,
     `v4_cmp_heli.jpg`, `v4_cmp_parts_car.jpg` doors open and wheels steered from four sides, `v4_cmp_parts_heli.jpg`,
     `v4_zoom_car_edge.jpg`): the render scale. The crops (the same quarter of the picture, at screen size) are softer
     after; high-contrast edges show more stair steps at 2x zoom (the car's rear crease, the engine cover's slats); from
     100 m up, thin far road paint and the skidpad's dashes break up (`v4_cmp_parts_heli.jpg` view 4). Everything else
     matches tile for tile: the car with both doors open and the wheels steered, its shadow with the doors, the
     helicopter with its doors open, the rotor shadow, buildings' shadows. Revert with `?perf=-scale`.
  3. Leftovers.
     a. `car-exit`: not shipped. The pack was re-shipped at 00:38:26 (`public/characters/vehicle-motion-tripo-v1.*`,
        2.08 -> 2.26 MB, still 16 clips, no car-exit): getting out of the car is still the placeholder. Of the three
        enter / exit clips only car-enter changed in the game's measures (heli-enter and heli-exit gave the same numbers
        to 0.02 cm). New car-enter on the clip path (`v4pack_enter_car.jpg`, `v4pack_exit_car.jpg`): contacts foot_l
        0.58, foot_r 0.06, hands 0 cm, root step 2.11 cm; crossings seat 12.6 (head, 7.0 s), wheel 4.5 (right forearm,
        5.75 s), door 2.8 (fingers, 1.5 s), body shell 2.2 (thumb, 5.0 s), interior 7.1 (ball_r, 5.75 s); against the
        23:14 clip below: door 5.6 -> 2.8, body shell 3.3 -> 2.2, wheel 5.5 -> 4.5, seat 11.2 -> 12.6 (the head now, the
        clavicle before). With it the guns still go to the cabin at f71 and stay at 0 cm against every part
        (`v4pack_entryguns_car_L.jpg`). The numbers below are the 23:14 pack's, measured before the re-ship.
        `demo.enterExit` re-run on the final code: car-enter (clip) contacts foot_l 0.43, foot_r 0.01, hands 0 cm, root step
        1.59 cm, crossings seat 11.2 (clavicle_l, 7.0 s), wheel 5.5, door 5.6, body shell 3.3, interior 7.0 (ball_r);
        car exit (placeholder) seat 24.2, interior 24.0, body shell 12.8, door 10.5; heli-enter feet 0.28 / 1.13, hands 0,
        seat 7.6, door 8.4 (thigh_r at 2.75 s), cyclic 2.9, collective 2.5; heli-exit feet 0 / 0.01, hands 0, seat 21.9,
        cyclic 9.1, fuselage 7.8, interior 7.5 (sampled every 15 frames; V3 sampled every 10 or 12, so single maxima
        differ). Sheets `v4_enter_car.jpg`, `v4_exit_car.jpg`, `v4_enter_heli.jpg`, `v4_exit_heli.jpg`.
     b. Guns while getting in (`gunsInCabin` in main.js): car: to the cabin at the frame the body's back turns to the
        cabin (back axis within 45 degrees of inboard: f71, t 2.37 s), before the shotgun reaches the door (f93) and the
        sill (f153); helicopter: once the pilot has turned to sit, his back to the seat's, inside the doorway (f169;
        switching when the hips pass the doorway, f91, showed the guns vanish off the back in full view of the entry
        side); out: back on the back when the hips are 0.4 m outside the doorway. Gun vertices against the car's parts
        through car-enter (every 3rd vertex, every 3rd frame, V2's depth): V3's rule door_L 6.7 cm (f140, shotgun),
        seat_driver 5.2 (f182), interior 10.5 (f150, rifle), body_shell 7.0 (f155); V4: 0 for every part. Pictures:
        `v4_entryguns_car_L.jpg` (driver's side: the guns are behind the turning body when they go),
        `v4_entryguns_car_R.jpg` (passenger side: they appear on the passenger seat through the glass at f72 while the
        driver is still outside: the cost of no hand-off clip), `v4b_entryguns_heli_R.jpg`. The helicopter's gun depth
        through heli-enter was not measured.
     c. Rotor wash: what was there (V2's `_wash`) emitted 139 sprites at 2 m over dirt and nothing showed
        (`v4_wash_hovers.jpg`): dirt-coloured, unlit, at most half opaque, thrown at 4 m/s. Rebuilt in `Heli._wash`: the
        induced velocity (9.9 m/s in the 2200 kg hover) as a wall jet under the disc's edge falling off as 1/r, dust
        lifted there, lit as the sun and sky light it, rolling up and hanging where the jet has slowed, the wake's foot
        trailing the motion; 260 puffs/s over dirt and 90 over paving at full strength; strength = thrust / weight x the
        fade of the hub's height from a quarter to one rotor diameter (as before). Hover (`v4b_wash_hovers.jpg`): dirt 2.2 m
        strength 0.91, 479 puffs, mean 11.9 m from the hub's foot, farthest 20.3, outward 4.1 m/s mean (all live puffs);
        5.1 m 0.33, 205 puffs; 10 m none. Helipad edge: 2.2 m 192 puffs (thin grey haze), 5.1 m 71, 10 m none. Lift-off
        from dirt (`v4b_wash_liftoff.jpg`): T/W 0.35 -> 44 puffs, 0.87 -> 311 and a visible cloud, 1.21 at the skids
        leaving -> a full brown-out round the aircraft, at 10.7 m strength 0 and the cloud drifting. No grass reacts:
        there is no grass geometry (the ground is a shaded plane).
     d. Small ones.
        - Seated soles: the pedal points are the soles under the balls (the pack's 'ball' contacts); the seated layers
          (heli `seat.js` legs, car `seated.js` legs) now put the joint the body's ballSole (1.66 cm) above them, as the
          clip path does. heliReach now measures the sole (joint + ballSole), not the joint: 0.0 cm at all 11 positions.
        - Cyclic hand: with the stick centred it stays hidden under the knees at the frame's bottom edge (`v4_cyclic_view_047.jpg`); -0.53 rad
          tried, not enough (`v4_cyclic_view_053.jpg`); it shows from about -0.62 (their "mouse a little down" tiles), which puts
          the horizon at the top tenth. Kept -0.47.
        - Cascade borders in motion: 12-frame strips (`v4_borders_car.jpg`: lamp-post shadows crossing 70 and 14 m at
          200 km/h; `v4_borders_heli.jpg`: the hangar's shadow from 100 m at 150 km/h): no popping or swimming seen.
        - Tyre smoke from the cockpit (`v4_smoke_cockpit_before.jpg`, `v4_smoke_cockpit_after.jpg`): it was drawn over the dashboard and the wheel when the
          car slid through its own cloud (flat sprites with their centres inside the cabin); now a puff reaching into
          the shut cabin fades in the cockpit view; the cloud shows through the windscreen and the side window.
  4. Regression (final code): `demo.review(...)`: idle 0.6, walk 1.8, jog 2.1, aimHold 0.9 frozen 5, burst 0.9 fire 0.6,
     reload 1.1, swap 2.5, crouchIdle 0.1 head 113, rampUp20 3.1 sink 0.1, stairsUp 2.6 sink 0.5; grip 0 / 0 everywhere.
     `demo.vehicleReview()` (13): 0-100 2.98, 0-200 8.53, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at
     102.28, skidpad200 1.392, roll 2.673, dive 0.826, upshift 0.10, standstill 0, wheel 2.13 %, slalom 0.792 g, liftOff
     +13.14 %, powerOver 2.679 / 6.789, kerb 3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock palm 0.6 hands off 0 s;
     palms launch / topSpeed / brake / standstill / wheelSpeed / kerb 0, skidpadLimit 1.54, skidpad200 1.3, rollPitch
     1.33, slalom 1.1, liftOff 1.56, powerOver 1.27 (identical to V3). `demo.heliReview()`: start 35.8 s (quick 8.7),
     hover 70.75 % / 81.83 % (2500), climb 9.36 m/s, cruise 69.99 % pitch -2.258, turns 1.178 / 1.454 g, autorotation
     10.305 m/s at 102.1 % Nr, flare 1.226 m/s, gentle 0.317, firm 2.819 (identical to V3). `demo.heliReach()` palms
     0.00, soles 0.0 cm. `node --test test/dynamics.test.js` 8 pass, `test/hands.test.js` 4 pass,
     `tools/heli/flight.test.js` 19 pass, `node tools/heli/run.js` 65 PASS 0 MISS 46 rows.
     src/audio.js and the voice lines in src/main.js untouched.
  5. Files. New: `src/batch.js`, `src/cloud.js`, `src/perf.js`, `tools/v4_cost.js`, `tools/v4_shots.js`,
     `tools/v4_wash.js`, `tools/v4_misc.js`, `notes/V4_log_entry.md`. Changed: `src/main.js` (render scale, `?gputime`,
     batching calls, the shadow camera's layers, `gunsInCabin`, vehicle sleep and cockpit flags), `src/look.js`
     (matrices once, cascade layers, skinned spheres), `src/world.js`, `src/range.js`, `src/ground.js` (static tags, one
     board material per number), `src/fx.js` (one steel for the targets, static frames, chains merged, marks on merged
     meshes), `src/character.js` (kit materials per colour, kit merged), `src/car/car.js` (batching, sleep, smoke cloud,
     cockpit smoke fade), `src/heli/heli.js` (batching, blade shadow proxies, sleep, dust cloud, wash rebuilt),
     `src/heli/seat.js`, `src/seated.js` (soles), `src/review.js` (gunSurface skips batch copies, heliReach sole),
     `README.md` (section "Vehicles, pass V4"), `tools/heli/report.txt` (regenerated). Originals copied to the
     scratchpad's `v4_orig/` before editing. No Blender, no assets, no packages; `public/vehicles/` unchanged.
  6. Not verified: the target on a quiet machine (none was available: every block shared the CPU with other jobs);
     GPU time per pass (timestamps unusable here); the frame time of getting in and out, of a hover over dirt with the
     full dust cloud, and of a slide with smoke (no case measured them); the EarthOnline bodies (placeholder IK, as
     before); the helicopter's guns against its cabin during heli-enter; the WGSL error 'unresolved value null' in a
     MeshStandardNodeMaterial pipeline at load (`render.nodeUniform * null`) is V3's (the original src/ swapped back in
     for one load: the same error, 8 messages) and was not traced; sound not touched.

- Main session's check of V4 (2026-11-12, 00:45): frame time in the car at part throttle, same method
  as before, three blocks of 90 frames with the machine's load average at 33 (the clip pass's
  Blender): median 23.0 / 24.3 / 22.6 ms, p95 48 / 48 / 42 ms, 183 draw calls, 930,938 triangles,
  canvas 1536 x 1152 (before V4, also under load: 43.5 ms, 895 draws). So about 1.9 times faster in my
  sitting; the 16.7 ms target is not shown on this loaded machine and must be re-measured when it is
  quiet. Looked at `v4_cmp_cases.jpg` (on foot, chase, cockpit before and after: same picture, the
  after slightly softer, edges stair-step in the 2x crop) and `v4b_wash_hovers.jpg` (a real dust cloud
  under a hover at 2.2 m over dirt, thinner at 5.1 m, none at 10 m; thin haze over the paving).
  No console errors on a fresh load in my session.
  Open after V4: `car-exit` clip (placeholder still); the clip faults; frame time on a quiet machine;
  the cockpit instruments are static pictures (car cluster and helicopter displays do not show speed,
  rpm, attitude); the car's engine never stops or starts; no warnings in the helicopter; hitting a
  barrier is a box push-out; EarthOnline bodies in vehicles.

- Clips, A2 follow-up (2026-11-12, 00:38 and 00:51; full entry appended to `notes/A2_log_entry.md`):
  `car-enter` (8.0 s) and `car-exit` (7.8 s) meet the relaxed gate and are shipped; the Tripo pack has
  17 clips. Gate: wrists inside +-70 / +-50 on every frame, twist step <= 40, no elbow or knee under 5
  degrees, snap30 <= 4.5 (head 2.0), hard pairs <= 2.0 cm, contacts <= 1.5 cm, soft pairs <= 4.5 cm,
  exact joins. Numbers: car-enter snap 3.9 / 2.7 / 1.8 / 2.7, wrists within 48 / 43, contacts 0.87 cm,
  worst hard pair 2.05 cm (thigh on the centre tunnel, also in the seated pose); car-exit snap 2.0 /
  1.8 / 2.6 / 2.7, wrists within 53 / 41, contacts 0.89 cm. The middle of `car-exit` (1.0 to 4.1 s) is
  the enter's poses run backwards; its start and end are its own. The main session looked at both
  sheets: each reads as a real move. Known doubts: legs spread while sitting sideways; the left
  forearm strongly turned on the sill hold; balance up to 18 to 20 cm outside the support as the hips
  cross the seat edge. `heli-enter` and `heli-exit` are still the first versions; the clip pass is
  resumed for them and for the EarthOnline pack.
- 2026-11-12, pass V5: live instruments, engine start and stop, warnings and cabin sounds, impulse collisions, keyboard
  feel, frame time, car-exit on the clip path. Originals copied to the scratchpad's `v5_orig/` before editing.
  Works: all seven items run in the game. Not met: the helicopter's PFD digits are not readable at the game's render
  scale from the default cockpit view; the hover with the assist off was not held by the scripted person (28.9 m
  drift in 20 s); the slalom at 50 and 60 km/h touched one cone each (45 km/h clean); the right hand jumps 49.6 cm in
  one frame at the hand-over out of car-exit (also with the V4 code and the new pack).
  1. Live instruments (`src/instruments.js`; canvas textures replacing the display materials' emissive maps; screen
     rectangles from the GLB's UVs for the car (cluster u 0..1 v 0..0.44, centre screen u 0..0.4 v 0.5..1) and from
     `utility_helicopter/source/hb/interior.py` DISP for the helicopter).
     Car: speed ring + digits, rev ring 0-9000 red from 8500 + digits, 7 shift lights 6500-8250 rpm (all flash at the
     limiter), gear + A/M, TC and ABS lamps (lit when tc < 0.97 or any wheel's abs < 0.97), headlamp tell-tale, (P)
     lamp, indicator arrows, fuel and coolant steady; centre screen: g-meter with 3 s trace, four tyres' combined slip
     against the peak. Lamp check 1.2 s at ignition; dark with the ignition off. 15 redraws/s (centre 7.5), 0.87 to
     0.94 ms per redraw. Readouts moved above the rim after the first sheet (the rim hid the lamps and gear: digits,
     gear and lamps now in the cluster's top 65 %).
     Launch (game, cockpit, `v5_car_launch.jpg`, `v5_car_dash2.jpg`), dash / HUD / model at five moments plus braking:
     t 0.52 s 10 / 10 / 10.0 km/h, 6400 / 6400 / 6400 rpm, gear 1; 1.2 s 34 / 34 / 34.4, 6400; 2.02 s 63 / 63 / 63.5,
     6400; 3.02 s 97 / 97 / 96.6 km/h, 7740 / 7750 / 7736 rpm; 4.52 s 132 / 132 / 131.9, 7390 / 7400 / 7393, gear 2;
     braking 5.02 s 109 / 109 / 109.0, ABS lamp on (worst wheel abs 0.59). (The HUD rounds rpm to 50, the dash to 10.)
     Seen at native pixels: speed digits and the rev digits readable over the rim; the centre screen's g figure and the
     slip bars readable; the lamp row half hidden by the rim top.
     Helicopter (1024 x 512 canvas, 10 redraws/s, slow screens every other one, the caution panel the same frame a lamp
     changes; 1.2 ms per redraw; 5.9 ms at 2048 x 1024 15/s before halving): PFD (attitude, ladder, bank pointer, IAS
     tape in kt with Vne mark, '--' under 20 kt, altitude tape in ft with the ground shaded at the radar height and
     'RA' under 2500 ft, VSI fpm, heading strip, assist annunciators), engine page (TQ, TOT derived, N1 = Ng, one dial
     NR + N2 (N2 derived), the artwork's oil / transmission / hydraulic bars falling with Ng / Nr, fuel 386 kg steady,
     flow 0.36 kg/kWh x power), caution panel (lit = full-colour face: the artwork's 30 % fill could not be told from
     unlit from the seat), standby ASI / attitude / altimeter. Take-off (game), HUD / model / PFD at five moments: t 1.0
     IAS 0 km/h / 0 kt / '--', alt 0.0 m / 0 ft / 0 ft, VS +0.0 / 0.02 / 0 fpm, Nr 100 / 99.8 / 100, TQ 26 / 26.4 / 26, Ng
     73 / 73.2 / 73.2; t 3.52 IAS 5 km/h / 2.7 kt / '--', alt 0.4 m / 1 ft / 1 ft, VS +1.2 / 1.15 m/s / 230 fpm, TQ 81 /
     81.2 / 81, Ng 94 / 94 / 94.0, hdg 9.5 / 10; t 6.02 IAS 20 / 11 kt / '--', alt 9.5 m / 31 ft / 31, VS +5.2 / 1020
     fpm, TQ 93 / 93 / 93; t 10.0 IAS 32 / 17.4 kt / '--', alt 36 m / 119 ft / 119, VS +7.3 / 1440 fpm, pitch -4.8 /
     -4.8; t 14.0 IAS 47 km/h / 25.1 kt / 25, alt 66 m / 215 ft / 215, VS +7.5 / 1470 fpm, TQ 97 / 96.5 / 97. Every
     reading matches its source (km/h and m on the HUD, kt and ft on the PFD, as the artwork is labelled).
     Seen (`v5_heli_panel.jpg`, native crops): the PFD in front of the pilot is about 130 x 95 px on the 1536 x 1152
     canvas; its horizon, ladder and tapes move and read as shapes, its digits (4 to 5 px) do not; looking down 0.3 rad
     brings it closer, still not readable. The standby dials and engine arcs read as shapes. Not fixed (layout of the
     cockpit and the 88-degree field).
  2. Engine start and stop. Car (`dynamics.js` ignition 'off' / 'cranking' / 'running', `startEngine()`,
     `stopEngine()`, starter 160 Nm falling to 0 at 320 rpm, crank 0.7 s, flare +500 rpm on the idle governor decaying
     over 0.9 s; both clutches open when not running; `reset()` leaves it running so every test and scenario is as
     before). Auto-start once seated (my call), I to stop / start. Game: ignition 0 s, starter at 0.9 s (after the lamp
     check), 270 rpm cranking, fires at 1.6 s, 1554 rpm at 1.9 s, 1070 rpm idle from 2.8 s. Getting out: off.
     Helicopter: I (engine running, on the ground) or T: `Heli.shutdown()`: ground idle, collective down, 10 s
     cool-down (labelled on the HUD 'game: 10 s; real about 2 min'), fuel off, run-down to 40 % in 29.6 s, rotor brake
     to 0.3 % in 7.2 s, battery off. With T the pilot stays in until the rotor has stopped (my call): out 46.7 s after
     the key. Lamps on the way: ROTOR LOW from 90 % Nr, ENG OUT and GEN at fuel off; no tones (inhibited in a
     commanded shutdown).
  3. Warnings and sounds (offline, 48 kHz, the game's compressor and 0.55 master, `/tools/v5_sound.js`, spectrograms
     `sound_v5_*.png`). Helicopter in the hover inside (rotor 26 Hz at -20 dB): horn 600 Hz at -28 dB, engine-out warble
     600 / 1000 Hz (-30 / -48 dB at the sampled instant), overtorque chime 990 / 1320 Hz (-32 / -53 dB); peaks -8.7 to
     -9.4 dBFS; in the game: overtorque lamp + chime at 102 % (first frame), horn + ROTOR LOW at 93.8 % Nr 0.09 s after
     the cut, ENG OUT + warble 0.03 s after the cut (Ng 85.6 %, torque 0). Car: start (starter 149 Hz -40.7 dB with its
     2nd at 298 Hz while cranking; first firing at 0.98 s; firing order 120 Hz at the flare, 107 Hz at idle), limiter
     (firing 845 Hz -29.5 dB; level drops to 6 % at each cut plus a pop), indicator ticks (peak -29.5 dBFS), crunch
     at speed changes 1.5 / 6 / 22 m/s: peak -14.0 / -10.6 / -8.4 dBFS, loudest 100 ms -26.3 / -20.9 / -17.3 dB
     (body mode 95 to 99 Hz strongest), scrape (2.5 kHz band, -42.5 dB at 90 kW over the 4000 rpm engine), car door
     peak -10.1 dBFS (105 Hz + 205 Hz panel mode), helicopter door -14.2 dBFS. No sample at full scale in any case.
     No brake squeal (not convincing from noise and a tone; left out).
  4. Collisions (`dynamics.js` `_collide` / `_contact`, `COLLIDE = { e: 0.15, mu: 0.45, height: 0.45 }`; the
     helicopter's hull as a moving body, `Heli.contactBody()`). `node tools/v5_crash.mjs`, an 80 m x 0.6 m x 0.85 m
     barrier, no throttle or brakes; before -> 0.5 s after (km/h), impulse, peak g (60 Hz frame), yaw rate, heading
     change: head-on 30: 29.6 -> 1.8, 16.1 kN s, 56.5 g, 0; 80: 79.8 -> 2.4, 43.3 kN s, 155.7 g; 150: 149.9 -> 12.2,
     81.4 kN s, 292.4 g; 30 deg 30: 30 -> 16.6, 14.6 g, 62 deg/s, 25.1 deg; 80: 80 -> 53.1, 39.0 g, 165 deg/s, 27.2 deg;
     150: 150 -> 97.6, 73.5 g, 309 deg/s, 24.9 deg; 10 deg 30: 30 -> 24.2, 2.7 g, 25 deg/s, 9.4 deg; 80: 80 -> 72.4,
     10.9 g, 66 deg/s, 8.9 deg; 150: 150 -> 134.3, 37.1 g, 122 deg/s, 8.0 deg; offset (wall's end 0.3 m right of the
     centre line) 80: 79.8 -> 10.2, 31 deg/s, -5.8 deg. Speed change = impulse / mass (80 head-on: 43.3 kN s / 1700 kg
     = 91.7 km/h = 79.8 + 11.9 rebound, e 0.15). Nothing went through in any case, no NaN, kinetic energy never rose
     (largest rise 0 J over every impulse). The peak g is a 60 Hz frame's mean: the impulse is one 1/1200 s step
     (rigid car, rigid barrier, no crumple zone). In the game (80 km/h head-on, `v5_crash_80_90.jpg`): rebound 11.5
     km/h, sparks 24 live, camera shake 0.92, torso to the belt stop 14.9 deg and head 34.4 deg forward in the hit
     frame, back through the seat (head -20 deg at +5 frames) and settled by +12. Car into the parked helicopter's side
     at 30 km/h: the helicopter pushed to 9.4 km/h and turned at 48 deg/s, slid 1.85 m and stopped upright, car 29.6 ->
     15.7 km/h then stopped against it, energy never rose. Found on the way: the parked helicopter slept through the
     impulse (its state not refreshed), the car passed through it: a knock now wakes it for 3 s. No damage model
     (README says so). Pictures: the driver's tiles were filmed through the passenger glass; dust from the dirt in
     front of the barrier fills the +40 frames tile.
  5. Keyboard (`src/keys.js`; `node tools/v5_keys.mjs`, a scripted person: looks every 50 ms (car) or every 0.25 s
     (helicopter: holds a key for the share of the look it wants, min 80 ms), keys only, through the same keys.js,
     dynamics, flight model and assist; flat ground, the track's surfaces). Car tap (80 / 120 / 200 ms): 0 km/h 70 /
     110 / 160 deg of wheel; 50 km/h 50 / 84 / 126; 100 km/h 31.5 / 51 / 78 (2.1 / 3.4 / 5.2 deg road); 200 km/h 12.6
     / 20 / 31; back to centre 0.05 to 0.32 s; throttle 69 % after an 80 ms tap. Lap: 81.27 s for 2549 m from rest,
     0 s with a tyre off the tarmac, 3.78 m from the centre line at most (half width 6.5), 1.13 g, 511 steering presses
     (median 0.1 s, 501 under 200 ms). Slalom (7 cones 18 m apart, the line 1.5 m either side): 45 km/h clean (0.17 m
     clearance), 50 km/h one cone, 60 km/h one cone touched (0.11 m). Helicopter taps in a 10 m hover, assist on (100 /
     200 ms): bank 3.2 / 5.0 deg, pitch -0.8 / -3.0 deg, heading 0.7 / 2.8 deg, collective 0.03 / 0.06 (vertical speed
     +1.45 / +2.47 m/s peak); assist off: bank 13 / 8.5 deg, pitch 2.4 / 10.8, heading 6 / 5.8 (with the aircraft's own
     divergence in the 2 s). Take-off to a 10 m hover held 20 s with the assist: height 9.48 to 10.63 m, drift 0.93 m,
     bank 4.4 deg, heading 3.4 deg; with Y (force trim, new: the assist's hands-off attitude becomes the hover's,
     `assist.rollTrim` added, 0 by default) 9.52 to 10.67 m, 0.84 m, cyclic presses 162 -> 80. Assist off (the trim
     from the assist's last output): height 9.47 to 10.59 m held, drift 28.9 m, bank 28 deg: not held. Circuit
     (climb north to 60 m, a 300 x 500 m box at 30 to 40 km/h of ground speed (the person's own limit), approach, 2 m
     hover, let-down): landed 1.72 m from the H at 0.21 m/s, 133 s. Changes: the car's keys were raw 0/1 into the
     dynamics' rate limit; now shaped as the README says. The helicopter's stick returned to 0; it returns to the trim.
  6. Frame time (`tools/v4_cost.js`, 3 x 90 frames). Start, original code (served from a temporary copy of
     `v5_orig/src`, removed after), load average 27.9 to 35: foot 9.5 / 20.8, car 10.6 / 19.7, cockpit 9.2 / 18.5
     (first run 11.2 / 19.8), helicopter 9.0 / 11.0 (median / p95 ms). End, same sitting, load average 65 to 81: V5 foot
     11.7 / 34.0, car 14.5 / 44.7, cockpit 12.9 / 38.2, helicopter 13.5 / 27.7; original foot 10.5 / 43.7, car 13.7 /
     71.3, cockpit 11.8 / 48.9, helicopter 18.9 / 51.4. The load swamps 1 ms; measured by parts instead: the car dash
     0.87 to 0.94 ms per redraw at 15 / s = 0.23 ms a frame, the helicopter panel 1.2 ms per redraw at 10 / s = 0.2 ms
     a frame (CPU drawing; the upload is in the render call); A / B in one page, car case, 20 alternating blocks of 30
     frames with the dash and the helicopter body on / off: frame median 16.1 / 16.3 ms, step mean 3.06 / 2.97 ms.
     Draw calls unchanged (foot 195 vs 194, car 171, cockpit 132, helicopter 225 vs 224).
  7. car-exit (pack shipped 00:51:52, 17 clips): runs on the clip path (`stats.paths['car-exit'] = 'clip'`), door by
     its track, guns back on the back. `demo.enterExit('car')` (`v5_enter_car.jpg`, `v5_exit_car.jpg`): exit 7.82 s,
     contacts worst foot_l 0.58, foot_r 0, hand_l 0, hand_r 0.87 cm; root step 1.80 cm; crossings seat 13.1 (head, 1.75
     s), interior 7.0 (ball_r, 0.25 s), steering wheel 4.2 (thigh_twist_01_r, 3.25 s), body shell 2.6 (calf_twist_01_l,
     3.0 s), door 2.2 (ring_03_r, 4.25 s). Enter (the 00:51 car-enter): contacts foot_l 0.58, foot_r 0.01, hands 0;
     root step 1.77 cm; seat 12.6 (head, 7.0 s), interior 7.1 (ball_r), wheel 4.5 (lowerarm_twist_01_r), door 2.8
     (middle_03_r), body shell 2.2 (thumb_03_l): identical to V4's figures for the 00:38 clip. Hand-over: the player is
     now placed where the clip's last frame stands and faces (V4 put him at the entry point, a jump); root step 0,
     head 2.1, hips 1.6, left foot 6.7 cm, right hand 49.6 cm in one frame (the draw's first frame; the same with the V4
     code and this pack; an eased blend made it 73 cm and was taken out). Seen: door up, legs out, stand, step clear,
     door pulled down, guns on the back, standing; nothing wrong seen at the 9 sampled frames; full speed not watched.
  Regression: `demo.review(...)`: idle 0.7, walk 1.9, jog 1.9, aimHold 0.9 frozen 8, burst 0.9 fire 0.6, reload 1.1,
  swap 2.5, crouchIdle 0.1 head 113, rampUp20 3.1 sink 0.1, stairsUp 3.0 sink 0.8; grip 0 / 0 everywhere (V4: aimHold
  frozen 5, stairsUp 2.6 sink 0.5; earlier passes 0 to 7 and 2.2 to 3.4). `demo.vehicleReview()`: identical to V4
  (0-100 2.98, 0-200 8.53, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at 102.28, roll 2.673, dive
  0.826, upshift 0.10, standstill 0, wheel 2.13 %, slalom 0.792 g, liftOff +13.14 %, powerOver 2.679 / 6.789, kerb
  3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock palm 0.6, hands off 0) except skidpad200 1.392 -> 1.236 g (atKmh
  -4.09): the run ends with the car leaving the pad and hitting the yard's back wall (impulse 81.9 kN s at x -33.5, z
  -24.5); V4's 1.392 included that hit through the old push-out (not re-run with V4's code); with the walls taken out the run gives 1.004 g at 175 km/h.
  Palms: skidpadLimit 1.52, skidpad200 1.19, rollPitch 1.25, slalom 1.07, liftOff 1.53, powerOver 1.24 (V4 1.54, 1.3,
  1.33, 1.1, 1.56, 1.27: the trunk now also moves with the thrown body). `demo.heliReview()` identical to V4 (start
  35.8 s, quick 8.7, hover 70.75 / 81.83 %, climb 9.36, cruise 69.99 % -2.258, turns 1.178 / 1.454, autorotation 10.305
  m/s 102.1 %, flare 1.226, gentle 0.317, firm 2.819). `demo.heliReach()` on a fresh page: palms 0.00, soles 0.0 at all
  11; run straight after heliReview in the same page: soles up to 4.0 cm (pedal full right) (not traced). Node:
  dynamics 8 pass, hands 4 pass, flight 19 pass, `run.js` 65 PASS 0 MISS 46 rows (report identical but for the dates).
  Physics changed on purpose: the car's contact (only when touching a box), the ignition (only after `stopEngine()`),
  `assist.rollTrim` (0 unless set). src/audio.js and the voice lines in src/main.js untouched.
  Files. New: `src/instruments.js`, `src/keys.js`, `tools/v5_crash.mjs`, `tools/v5_keys.mjs`, `tools/v5_shots.js`,
  `tools/v5_sound.js`, `notes/V5_log_entry.md`. Changed: `src/car/dynamics.js` (ignition, `_collide`, `_contact`,
  `_energy`, `COLLIDE`, `impacts`), `src/car/car.js` (place parks it off, ignition sequence, `_hits`, sparks, shake,
  `BodyThrow`), `src/car/sound.js` (starter, fire, limiter, crunch, scrape, tick, door), `src/heli/heli.js`
  (`shutdown`, `contactBody`, wake on a knock), `src/heli/sound.js` (horn, warble, chime, door), `src/heli/assist.js`
  (`rollTrim`), `src/vehicles.js` (body throw, camera shake, 'rotor' on T, exit hand-over at the clip's end),
  `src/main.js` (instruments, keys, warnings, shutdown and trim keys, indicators, car events, the helicopter as a
  body), `README.md` (controls, "Vehicles, pass V5"), `tools/heli/report.txt` (regenerated). No Blender, no assets, no
  packages; `public/` unchanged.
  Not verified: the sounds by ear; the instruments at night or in other light; the car's lamps under the rim from a
  taller eye; a crash filmed from the cockpit; the helicopter hitting the car from the air (only the car into the
  parked helicopter); the circuit flown in the game (Node only); full-speed playback of car-exit; frame time on a quiet
  machine (load 65 to 81 at the end).

- Main session's check of V5 (2026-11-12, about 01:55): looked at `v5_car_dash2.jpg` (the cluster
  shows speed, revs, gear and shift lights live; the centre screen a g-meter and tyre slip bars; the
  rim hides part of the lamp row), `v5_heli_panel.jpg` (attitude, tapes and the engine page live; digits
  too small to read from the default eye point) and `v5_exit_car.jpg` (the car exit plays in the game:
  door up, legs out, stand, door shut, guns on the back). Frame time could not be judged: the load
  average was 118 during my run (22 to 58 ms medians); V5's own start-of-run figures under a load of 28
  to 35 were 9.0 to 10.6 ms median in all four cases.
  Open after V5:
  1. The right hand jumps 49.6 cm in one frame when `car-exit` hands over to on-foot control (the gun
     draw starts from a different pose); check the same hand-over for the helicopter and the hand-overs
     into the entry clips.
  2. `demo.heliReach()` reads soles up to 4.0 cm off when run after `demo.heliReview()` on the same
     page (0.0 on a fresh page): state carried over.
  3. `skidpad200` now ends with the car hitting the yard's back wall, which spoils its reading.
  4. `heli-enter` / `heli-exit` clip faults and the EarthOnline pack (clip pass running).
  5. Frame time on a quiet machine.
  Accepted as they are: the helicopter cannot be hovered hands-off-assist by the scripted key presser
  (it drifts 29 m in 20 s; real helicopters need constant correction); the keyboard slalom is clean at
  45 km/h and clips a cone at 50; the PFD digits are 4 to 5 pixels high from the default eye point.

- Clips, A2 follow-up 2 (2026-11-12, 01:18 to 01:54; full entry appended to `notes/A2_log_entry.md`):
  `heli-enter` (8.0 s, with the door opened fully on its handle, a foot on the skid, the left leg
  lifted over the cyclic, the door pulled shut by its frame, ending on the collective at 4 degrees) and
  `heli-exit` (8.0 s; it is the enter's checked path run backwards, with one timing change) pass the
  gate and are shipped: snap 4.0 to 4.5 worst, wrists within 66 / 50, hard pairs 1.98 cm, soft 4.46 cm,
  contacts 1.2 cm, joins exact. The Tripo pack has 17 clips, all four enter and exit clips to the gate.
  The EarthOnline pack `vehicle-motion-ue5-v1` now has the 13 seated clips with its own `vehicleFit`
  (car seat 0.20 m forward and 0.03 m down, wheel 0.03 m out; helicopter as Tripo); its enter and exit
  clips fail (knees, head 2.5 cm into the roof and door frame, thigh 9.7 cm into the seat: the plans'
  heights suit Tripo's 0.82 m legs, not 0.78 m) and are not shipped, so the EarthOnline bodies still
  get in and out on the placeholder. The main session looked at `heli-enter.png`: it reads as the
  moves listed.
- 2026-11-12, pass V6: the hand-overs between on-foot play and the vehicle clips; three small faults. Originals copied to
  the scratchpad's `v6_orig/` (src, tools, test, README.md) before editing. Packs measured against (final, per the
  coordinator): `vehicle-motion-tripo-v1` 01:54 (17 clips, the 8.0 s `heli-enter` / `heli-exit`), `vehicle-motion-ue5-v1`
  01:18 (13 seated clips with its own `vehicleFit`, no enter / exit: the EarthOnline bodies get in and out on the
  placeholder and sit on the pack's loop).
  1. `demo.chainReview('car' | 'heli', { film })` (`src/chain.js`): from 3.2 m off the entry point with a gun, T, the
     whole chain through `demo.step(1/60)` until on foot again + 1 s. Every frame the world positions of hand_l/r,
     foot_l/r, head, pelvis (the body's skin bones), the root, the door. Per part the largest one-frame change of
     velocity (m/s, the second difference x 60) and where (the join within 12 frames, else the stage); per join the
     same; the root's jump (cm, the change of its one-frame step); planted feet on the ground outside the vehicle's
     footprint (heel or ball within 1.5 cm of how they stand at the start): slide per frame and drift over a plant.
     With `film`, 25 consecutive frames round each join from a fixed three-quarter view (two renders a frame, the camera
     set before each), posted as `chain_<kind>_<n>_<from>-<to>.jpg`.
  Chain table, velocity change (m/s) per join, worst part, before (V5 code, first run of this pass) -> after:
  Tripo car: foot>stowing handL 1.33 -> 1.47; stowing>walking handL 5.6 / handR 3.5 -> 0.99 / 1.85; walking>entering
  footR 15.38 / footL 9.76 (feet 25 / 16 cm in one frame) -> 0.63 / 0; entering>seated 0.21 -> 0.21; seated>leaving
  0.74 -> 0.74; leaving>drawing handR 28.97 (48 cm in one frame), footR 9.51, footL 8.96, handL 6.63 -> handR 1.33, footR
  1.26; drawing>foot handL 4.04 -> 1.20. Root jump worst 0.28 cm (inside car-exit) before and after; at joins <= 0.18.
  Planted-foot slide: before 25.5 cm / frame at walking>entering; after 1.56 / 1.58 cm per frame, drift 2.48 cm (the
  game's own turn on the spot, in the walk). Walk end: root 0 cm, yaw 0 deg, feet 0 cm from car-enter's frame 0.
  Tripo helicopter (V6 code before the fixes below: leaving>drawing 202 m/s, the whole body spun 180 deg): after: all
  joins <= 1.85 m/s (stowing>walking handR 1.85, leaving>drawing footR 1.85 / handR 1.55, walking>entering footL 1.26),
  seated>leaving head 5.31 -> 0.01, root jump at joins <= 0.18 cm, walk end 0 / 0 / 0.
  EarthOnline (civilian-f-02-hero, placeholder in and out, pack seated): car all joins <= 1.68 m/s, nothing over 4 m/s
  anywhere in the chain (before: feet 52 m/s inside the placeholder, see 4), root jump 0.24 cm; helicopter all joins
  <= 2.96 m/s (entering>seated, a root drop of 4.73 cm: fixed after that run, not re-run), leaving>drawing 52 -> 0.33.
  Not met: over 4 m/s, not at a join: handR 4.59 at `slung` inside the stow and the draw (both vehicles; the rifle
  pack's `swap-<gun>-<other>` PalmR stops from about 5 m/s in one frame where the gun reaches the back: the clip must
  ease the hand into the mount over 3 to 4 frames); handR 4.01 inside `car-enter` (f about 231 of the chain = clip
  t 3.85 s); inside the 8.0 s `heli-enter` / `heli-exit` footL 4.97 / 6.24 / 4.07 m/s at clip t 2.4 and 3.6 s (enter;
  the exit's mirror at 1.3 and 2.4 s), and planted feet drifting up to 64 cm (footR, heli-enter 0.75 to 1.1 s) and 16 cm
  (footL, heli-exit) while within 1.5 cm of the ground: the clips' feet slide or the ground contacts are not pinned
  there (heli-enter contacts foot_l 18-66, foot_r 27-48 on the ground; the drift is at 22 to 33 and 48 to 57). The
  EarthOnline placeholder slides its planted feet up to 75 cm (the body carried into the seat over standing feet; not
  polished, by the brief).
  2. Causes and changes.
  - walking>entering: the walk stopped within 0.3 m / 0.3 rad of the entry point, and the clip's first frame pinned the
    feet to its ground contacts in one frame. Now (`vehicles.js` `_entryStart`, `walkTo`) the walk's target is the entry
    clip's frame 0 (its notes root, and its feet read by putting frame 0 on the proxy with its contacts pinned); stopped
    within 0.6 m and turned by the game's own turn on the spot to within 0.8 rad, a settle eases the root the rest of
    the way and round (0.5 to 1.4 s) with the feet planted, and the stance (`character.stance`, new) steps each foot to
    where frame 0 has it (trigger 1.2 cm instead of 10 cm). Arrives when the root is there and the feet within 1.5 cm,
    not stepping. Transitions under the settle are ended (one moved the root itself: 11 cm in one frame at the
    helicopter). A step already under way keeps its own target when the stance is set (it jumped 5.5 cm). The
    clip's join is taken on the clip's first frame (V3 to V5 took it a frame early, before that frame's on-foot pose).
  - leaving>drawing: (a) the draw began at the swap clip's `slung`, where the right hand is on the gun on the back: 48 cm
    in one frame from where car-exit leaves it; it now plays the stow's outgoing half backwards from its end, as the stow
    played it forwards (`main.js`). (b) `snapToGround` put the feet where the stance wants them: `plantFeetAsPosed()`
    (character.js, new) plants them where the last frame has them. (c) The pose itself: `src/inertia.js` (new,
    `PoseInertia`): every frame's final proxy pose (each joint's local rotation, the Hips' position, the root's position
    and turn) is kept with the one before; when what poses the body changes (tags: 'inside', 'foot:<mode>') the new
    pose gets the difference to the old one carried on as an offset decaying with a quintic over 0.35 s (Bollo's
    inertialization; start rate = the old pose's rate less the new pose's, read on the second frame), body after
    poseBody, arms after poseArms, then rig.apply. Feet planted in both (within 2 cm) are re-solved to the new pose's
    ankle (a contact, not a blend target). (d) V5's 0.3 s blend made it worse because it eased the on-foot pose after
    the arms' IK had already run from the blended bones; the offset here is added after each layer's IK. (e) The root
    was set to identity at the hand-over frame (`_finish`), which became the last kept pose: 180 deg off in the
    helicopter; it is now turned as the player faces, keeps its height, and main.js sets the whole root rotation
    (rotation.set(0, yaw, 0)), not only y (a tilted helicopter's frame stayed in x and z).
  - stowing>walking and drawing>foot: the swap clip's difference layer stopped in one frame; carried by PoseInertia.
  - seated>leaving (helicopter): the 8.0 s heli-exit starts, and heli-enter ends, on heli-collective-down frame 0;
    `_heliControlPoses` added the whole collective-down pose again on top (head 5.31 m/s). Clips whose notes say
    `events.seatedPose: 'heli-collective-down'` get only the difference from 4 deg.
  - EarthOnline placeholder: the legs never blended (`seated.js`, `heli/seat.js`: `q.copy(keep).slerp(q.clone(), w)`
    takes the clone after the copy: slerp(keep, keep)); they stood until weight 1 and jumped 87 cm in one frame into
    the seat (and out). Now slerpQuaternions(keep, ik, w). The placeholder's exit hands over where it stands and faces
    (V5 turned the player +X, away from the helicopter's door, 180 deg); the placeholder's end into the pack's seated
    loop and the seated loop into the placeholder's leaving are eased as the clip path's are (`_captureJoin('toSeated')`
    before that frame moves the root: the seated loop's root is on the helicopter's plane, 4.7 cm below the ground the
    standing pose was on).
  3. Films (`/private/tmp/claude-501/-Users-USER-Desktop-Code-test/cd37263d-8391-4dc9-a6b6-a5a3576f1a65/scratchpad/
     v6_films/v6_chain_car_1..7_*.jpg`, Tripo car, after the fixes): looked at 3 (walking>entering) and 6
     (leaving>drawing): the body stands, the clip starts and ends with no visible change between frames, the right arm
     goes back to the gun over the draw's frames. The camera is 6.5 m off: the hands are a few pixels; the numbers are
     the measure, the films only show nothing gross. The helicopter and EarthOnline chains were not filmed.
  4. Small faults. (a) heliReach after heliReview: on this pack and code, soles 0.0 at all 11 rows after a full
     heliReview in the same page (and after heliReview('hover'), and with the seated loop's clock at 0..7 s); V5's
     4.0 cm did not reproduce, cause not found, nothing changed for it. (b) skidpad200 runs round a centre 500 m west of
     the skidpad on a 90 m tarmac ring laid for the run (WORLD_GROUND.surface, restored after): 1.284 g at 207.07 km/h,
     no impact, the same as Node on flat tarmac (1.284 at 207.07). The old run's 1.004 g without walls was on dirt.
     No other scenario changed. (c) frame cost: see below.
  Regression (end): `demo.review(...)` idle 0.6, walk 1.9, jog 1.8, aimHold 0.9 frozen 8, burst 0.9, reload 1.1, swap 2.5,
  crouchIdle 0.1, rampUp20 3.0 sink 0.1, stairsUp 2.8 sink 0.5, grip 0 / 0 everywhere (V5 0.7, 1.9, 1.9, 0.9 / 8, 0.9,
  1.1, 2.5, 0.1, 3.1 / 0.1, 3.0 / 0.8). `demo.vehicleReview()` identical to V5 in every row and palm (0-100 2.98, 0-200
  8.53, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at 102.28, roll 2.673, dive 0.826, upshift 0.10,
  standstill 0, wheel 2.13 %, slalom 0.792, liftOff 13.14 %, powerOver 2.679 / 6.789, kerb 3.69 cm 14.65 kN 0.167 s 0.879
  deg, lockToLock 420 deg hands off 0) except skidpad200 1.236 -> 1.284 g at 207.07 km/h, palm 1.19 -> 2.46 cm (a
  different run: 1.28 g at 207 km/h instead of a slide into the wall); hipsOffSeat 8.1 cm in every scenario (not
  reported before). `demo.heliReview()` identical to V5 (start 35.8 s, quick 8.67, hover 70.75 / 81.83 %, climb 9.36,
  cruise 69.99 % -2.258, turns 1.178 / 1.454, autorotation 10.305 m/s 102.1 %, flare 1.226, gentle 0.317, firm 2.819,
  reach 0 at all 11). `demo.heliReach()` after it: palms 0.00, soles 0.0 at all 11. `demo.enterExit('car')`: enter 8.02
  s, contacts foot_l 0.58 others 0, root step 1.36 cm (V5 1.77), crossings seat 12.6 / wheel 4.5 / door 2.8 / shell 2.2 /
  interior 7.1; exit 7.82 s, contacts foot_l 0.58 hand_r 0.87, root step 1.80, crossings 13.1 / 4.2 / 2.2 / 2.6 / 7.0
  (all as V5). `demo.enterExit('heli')` (new 8.0 s clips, no V5 figure): enter contacts foot_l 2.23 foot_r 3.01 hands 0,
  root step 2.38 cm, crossings pilot_seat 7.4, interior 5.0, cockpit_door_R 4.0, cyclic 2.3, collective 2.2, fuselage
  2.3; exit contacts foot_l 0.06 others 0, root step 2.38, crossings 7.4 / 5.0 / 4.0 / 2.3 / 2.7 / 2.3. Node: dynamics 8
  pass, hands 4 pass, flight 19 pass, run.js 65 PASS 0 MISS 46 rows (report identical but for the run times).
  Frame cost (`tools/v4_cost.js`, 90 frames, passes off; median / p95 ms, step ms): start (load 50.6 to 63.7) foot
  56.1 / 148.1 (1.2), car 38.4 / 92.0 (3.0), cockpit 17.7 / 93.9 (2.9), heli 47.1 / 100.0 (3.8); end (load 43 to 57)
  foot 33.9 / 102.9 (1.3), car 16.8 / 48.4 (2.6), cockpit 20.8 / 82.0 (3.5), heli 44.5 / 100.5 (4.1). Draw calls equal
  (195, 173, 133, 269). The load swamps any difference; the added work per frame is a copy of 53 quaternions and two
  vectors, plus the offsets and one more rig.apply() for 0.35 s after a hand-over.
  Files. New: src/chain.js, src/inertia.js, notes/V6_log_entry.md. Changed: src/vehicles.js, src/main.js,
  src/character.js (stance, plantFeetAsPosed, stanceError), src/seated.js and src/heli/seat.js (leg blend), src/review.js
  (chainReview wiring, skidpad200 ring), README.md, tools/heli/report.txt (regenerated, identical but for run times).

- Main session's final check and stop (2026-11-12, about 03:00). `demo.chainReview('car')`: every join
  at or under 1.68 m/s of velocity change in a frame (leaving>drawing right hand 1.23; it was 28.97),
  root jump 0.18 cm; worst inside a stage: right hand 4.61 in the stow (the swap clip), left hand 3.51
  in `car-enter`. `demo.chainReview('heli')`: joins at or under 1.87 m/s, root 0.18 cm; worst inside a
  stage: left foot 6.24 in `heli-enter`, right hand 4.6 in the draw; feet drift near the ground inside
  the helicopter clips (left 16 cm, right 64 cm). Looked at `v6_enter_heli.jpg` (the new helicopter
  entry plays in the game). Frame time could not be judged: another session's Blender render kept the
  load average at 38 to 50 (my blocks read 18 to 55 ms). `hipsOffSeatCm` reads 8.1 cm while the
  pictures show the driver in the seat (the measure uses the unfitted seat point).
  The loop was stopped here: the remaining items are listed in `VEHICLE_REVIEW.md`, and the next
  judgment has to come from the user driving and flying it. The project's Blender on port 9877
  (started by the clip passes) was left running.

## Second request (2026-11-12, after the review)

The user read `VEHICLE_REVIEW.md` and answered: "Fix the open list". So every item under "Below
target or not verified" is to be fixed, and the items under "What this cannot reach, or has not
tried" that can be built here (damage, mirrors, the world) are to be built. Sound by ear, real hands
on the keyboard and captured motion stay out of reach.

Contract extensions decided for this round (both sides must follow them):
- `vehicleFit[vehicle][node]` may carry `scale: [x, y, z]` beside `translate`, in the node's own
  frame, applied about the node's origin (for example a wider driver's seat, a longer cyclic stick).
- A clip's notes may carry `guns`: `{from, to, rifle: [[x, y, z, qx, qy, qz, qw] per frame], shotgun:
  [...]}` in the vehicle root's frame, for the frames in which the guns have left the character's back
  (the hand-off into or out of the cabin). Outside `from..to` the guns follow the back mount (before)
  or lie at the game's cabin places (after). The cabin places are `CABIN_GUNS` in `src/main.js`.
- Split of work: the clip pass owns `blender/` (except `blender/vehicles/`) and the packs in
  `public/characters/`; the game pass owns `src/`, `tools/`, `test/`, `public/vehicles/`, `README.md`,
  `blender/vehicles/` and the browser. Each writes its log entry under `notes/`.
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

- Main session's check of V7 (2026-11-12, about 11:40; load average 33 to 42 from other renders):
  `demo.review` on the new ground: idle 0.7, walk 1.8, jog 2.1, aimHold 1.0 (frozen 8), burst 0.9 (fire
  0.6), reload 1.1, swap 2.5, crouchIdle 0.0, rampUp20 3.2 (sink 0.1), stairsUp 2.1 (sink 0.1), grip 0 /
  0: as before. `demo.chainReview('car')` (rifle pack re-shipped 11:15 with the eased swap): joins at or
  under 1.85 m/s, root 0.18 cm; right hand in the stow 4.09 (was 4.61; the clip pass's target is 3.0).
  FRAME TIME, on foot, same sitting, 60 frames each: all features 68.7 and 65.3 ms a frame (GPU wait
  53.9 and 47.0 ms); `demo.perf.flora = false` 23.8 ms (GPU wait 6.4 ms). The grass and trees cost
  about 45 ms of GPU a frame. The main session therefore switched flora off by default in `src/perf.js`
  (`?perf=+flora` turns it on) until it is cheap.
  Not verified by anyone after V7: `enterExit` for both vehicles, the helicopter and EarthOnline chains,
  time of day from the chase and cockpit views, displays and lights at night, grass reacting to wash
  and car, the mirror fold, the skid bend and tail strike, dents seen clearly, the enlarged PFD, the
  helicopter frame-time case; the first corner contact at 80 km/h dented nothing (cause unknown);
  tyre walls are visual only.
- 2026-11-12, pass A3 (clip side of "Fix the open list": VEHICLE_REVIEW.md "Below target or not verified", VEHICLE_NOTES.md
  "Second request"). Items in the coordinator's order; 1 and 2 shipped, 3 tried and not shipped, 4 to 6 not started.

  1. Swap clip's hand at `slung` (SHIPPED 11:15, `public/characters/rifle-motion-tripo-v1.glb/.json` 6,466,760 / 142,783,
     `rifle-motion-ue5-v1.glb/.json` 6,670,732 / 142,256).
     - Cause: `slung` (T(0.76)) lies in the middle of the firing hand's free move from the let-go to the new gun's grip
       (T(0.66)-T(0.86)); the game's stow ends there and its draw starts there, so the hand stopped from (or started at)
       3.4 to 3.9 m/s (PalmR) in one frame.
     - Change (`blender/rifle_motion/handling.py`): the free move re-timed AFTER all the path smoothing (`Clip.pause`,
       `pause_pace`, shape `p175`: slope (1 - s)^1.75 (1 + 6.5625 s), 1 at the move's ends, 0 at `slung`, peak 1.60), so the
       hand comes to rest at `slung` and leaves it again; the firing elbow's pole keys follow the same pace (`paused`).
       Clip length (41 frames), events, notes and every other key unchanged. Shapes tried: quadratic (peak 1.33; the
       last frame before the pause still at 93 % speed), quartic (peak 2.0; PalmR peak 3.4), cubic (peak 1.69; PalmR
       stop 0.9 to 1.0, peak 2.9 to 3.2).
     - Numbers (60 Hz, keys linear / slerp as the game samples, `blender/vehicle_motion/slung_a3.py` + `dv60_a3.py`;
       "stop" = the speed at `slung`, i.e. the change when the stow stops or the draw starts there):
       Tripo R->S PalmR stop 3.85 -> 1.15, in-clip max 2.50 -> 3.06; hand_r stop -> 0.81, max 2.23. Tripo S->R PalmR stop
       3.44 -> 1.27, max 2.72; hand_r max 2.14. EarthOnline R->S PalmR stop 3.36 -> 1.15, max 2.29 -> 2.80; hand_r max
       2.83. EarthOnline S->R PalmR stop 3.47 -> 1.24, max 2.79; hand_r max 3.00. Left hand, head, hips, feet under 3.0
       everywhere (PalmL stop 2.2 to 2.6, as before). NOT met: the elbow (lowerarm_r / ElbowR) changes by 4.9 to 9.4 m/s
       in a frame inside the swaps (shipped: 4.0 to 7.9; the elbow swings fast near the fold behind the head, F3's known
       trap), and Tripo R->S PalmR 3.06 (target 3.0).
     - F3 kept (Tripo, review numbers): R->S muzzle snap30 3.5, wrists flex +19 dev -30 / flex -39 dev -33, grip 0.00 /
       0.01, lowerarm_r/stock 0, twist01_r step 36.7 (unchanged); S->R snap30 4.4, wrists -27 / -32, -33 / -33, grip 0,
       twist step 37.8 (unchanged). EarthOnline: wrists firing R->S flex -46 dev -42 (was -45 / -34), S->R -34 / -41 (was
       -34 / -35); twist01_r step 73.8 -> 94.0 (R->S) and 61.3 -> 69.2 (S->R) (this body never had F3's forearm solve).
     - Proof: the other 78 clips of each pack bit-identical in every channel, notes identical
       (`blender/review/rifle_a3_stage/bitcheck-tripo.txt`, `bitcheck-ue5.txt`); the two swaps' notes identical (events,
       tracks). Built with PATCH = True into copies of the shipped packs (`blender/review/rifle_a3_stage/`), sheets there.
  2. Helicopter clips (SHIPPED 11:45 and again 12:05, `public/characters/vehicle-motion-tripo-v1.glb/.json` 2,693,252 /
     206,926; the other 15 clips bit-identical, `blender/review/vehicles/candidate/stage/bitcheck.txt`; load check PASS).
     - heli-exit (10.7 s, 322 frames, `clips_heli.exit3`; times after 5.55 s are the walk's, stretched 1.3x): its own move. Hands off the controls (0.3); right hand onto the door's glass
       under the window and pushes it open to 28 % (0.6-1.3), it swings to 68 deg (2.0); right foot off its pedal to the
       doorway's step (1.3-1.85); the hips slide right and turn out; the left leg lifted back over the cyclic's grip, knee
       out (1.65-3.0); facing out, left hand on the doorway's front post (3.0-3.4); leaning out, left foot down onto the
       skid (3.6-4.15), right foot past the skid to the ground (4.17-4.75), left foot to the ground (5.0-5.55); a walk round
       the open door's rear edge to in front of it (5.6-7.7, steps 0.39 to 0.66 s); right hand on the door's outer face
       pushes it shut from in front (two placings: 7.69-8.34, 8.50-8.99; door shut at 9.13); two steps back to the entry
       point, facing the helicopter (10.0). Starts on heli-collective-down (collective 4 deg), join_ref.
       GATE PASS: snap30 hand_l 1.6 / hand_r 1.8 / foot_l 3.8 / foot_r 3.8 / head 0.3; twist step 29.9; join 0.000 mm /
       0.000 deg; worst hard 1.91 (f17 index_03_r/door glass), soft 3.17 (f0, the reference), contact 1.15 (foot_l on
       pedal_L), wrists flex 63 / dev 49, elbow min 14, knee min 23, head clearance min 0.3 cm; balance 40.0 cm (f181,
       reported, not planned while stepping down held by the left hand and during the walk: `balance_skip`).
     - heli-enter: feet now go straight up off their places and straight down onto the next (`pose.step_clear` 0.15) and
       the steps to the skid (2.05-2.55, lift 0.14, no corner), into the footwell (2.56-3.45) and the first walking
       step were lengthened; contacts on every plant (ground, skid, doorway step, floor, pedals) were already written.
       GATE PASS: snap30 hand_l 2.2 / hand_r 4.0 / foot_l 4.4 / foot_r 3.7 / head 1.0; twist step 30.3; join 0.000 / 0.000;
       worst hard 1.96, soft 3.8, contact 1.2, wrists 66 / 50, elbow 13, knee 9, head clearance 0.2 cm; balance: both feet
       off for 0.15 s at 3.3-3.45 (left foot off the skid before the right lands in the footwell; hands not on a hold).
     - Feet near a surface (`blender/vehicle_motion/drift_a3.py`: sole's ball and heel height over whatever is under them,
       vehicle meshes or the ground; drift = horizontal travel while within 1.5 cm): heli-enter max 0.0 (left) / 0.08 cm
       (right); heli-exit 0.07 / 0.11 cm (was 64 cm / 16 cm in the game's measure of the old clips).
     - Feet's velocity change per frame (Blender, V, one 30 fps frame: at 60 Hz with linear keys the change falls in one
       frame): heli-enter foot_l 4.36 (f106, the step from the skid up onto the doorway: NOT met, target 4.0), foot_r 3.68;
       heli-exit 3.81 / 3.77. My own 60 Hz FK of the GLB with the root track (`dv60_a3.py --root`) does not reproduce the
       game's frame (its root composition reads 8 to 14 m/s on the walking feet): not used.
  3. car-exit's middle as its own move (NOT shipped; code in `clips_car.exit_middle`, off: `EX['on']`; with it off car-exit
     builds as shipped). Head and shoulders lead (chest twisted 10 to 20 deg and bent 12 to 26 deg to the left over hips
     kept facing forward until the right foot leaves), the left foot over the sill straight to the ground first (2.3-3.0),
     the left hand on the sill (2.88-3.5), the right foot off the pedal to the floor (1.5-1.9), the right knee steered
     left off the tunnel, the right leg out over the sill (3.25-4.0). Last run (gate output and frames in
     `blender/review/vehicles/candidate/a3/`): left forearm 3.75 cm into the sill after the hand leaves it (3.7-3.9 s),
     right thigh / calf 3.34 cm into the tunnel (1.4-1.5 s; the reference has 2.05), left fingers 3.34 cm into the sill,
     right arm 2.9 cm into the door at its corner hold (4.4 s), left thigh 2.8 cm on the sill; left arm 4.6 cm and
     spine_03 4.8 cm into the seat's wing (soft); left wrist 159 / 140 as the hand turns onto the sill (2.7 s); right wrist
     85 / 68 at the door's corner. Head, twist step (30.5), joins (0) and snaps (2.6 at most) pass.
  4. Postures: driver tried, NOT shipped (nothing kept but the code support below). Measured on car-seated (Tripo):
     shoulders carried forward and down (collar (-16, 28, 16, 28) instead of (-22, 0, 22, 0)): upper arms into the
     bucket's wings 4.53 / 4.31 -> 2.17 / 2.60 cm, clavicles 3.61 / 3.61 -> 2.65 / 3.21, elbows 79 -> 55 deg, wrists
     -42 / -36 -> -32 / -17; the right knee's pole steered left (left knee left at its rest pole, per-side weights):
     thigh_r / calf_r on the tunnel 2.05 -> 0 cm. The seat widened by the new `scale` (x 1.08 about its origin) made the
     upper arms deeper (2.17 -> 3.02), not shallower: not used. Not finished: car-enter / car-exit end and start on the
     old knee (their own knee poles fade to the rest pole), car-exit's clavicle_l 4.64 cm into the wing while moving
     (target 4.5), and the seated set and both joins were not rebuilt; the pilot, the sill-sitting knees and the balance
     holds not started. Code kept: vehicles.py applies a fit's `scale` (node frame, about its origin) when one is given,
     build_vehicle_motion.py writes it into `vehicleFit`; no fit uses it, so nothing built changes.
  5-6. Not started (EarthOnline entry / exit, gun hand-off).

  Final check: the Tripo vehicle pack rebuilt from scratch with the final code (fresh scene): all 17 clips bit-identical
  to the shipped pack, notes identical (`blender/review/vehicles/candidate/stage_final/bitcheck.txt`).
  Code: handling.py (`pause_pace`, `PAUSE_G`, `PAUSE_SHAPE`, `Clip.pause` re-timing after smoothing, `Swap` sets it and
  re-times the firing elbow's pole); pose.py `step_clear`; clips_heli.py `exit3`, `EDGE`, `E3`, enter2 steps and
  `step_clear`, `make('heli-exit')` 10.7 s; clips_car.py `exit_middle`, `EX` (off); build_vehicle_motion.py heli-exit
  close-ups. Tools: `blender/vehicle_motion/dv60_a3.py`, `slung_a3.py`, `drift_a3.py`, `fsnap_a3.py`.
  The project's Blender on 9877 was started by this pass (launch.sh) three times; the first two exited on their own
  (about 12:10 and 12:43) while other users' renders loaded the machine. The third is left running.

- Main session after A3 (2026-11-12, about 13:00): looked at `blender/review/vehicles/tripo/heli-exit.png`
  (hands off the controls, door pushed open, leg back over the cyclic, down by the post and the skid,
  round the door, door pushed shut, two steps back: its own move). Shipped by A3: the eased swap in
  both rifle packs (11:15) and the Tripo vehicle pack with the new `heli-exit` (10.7 s) and the fixed
  `heli-enter` (12:05). Not done and sent back to the clip pass: the driver posture it found (shoulders
  forward and down, knee off the tunnel), the pilot's posture, the EarthOnline entry and exit clips
  (and this body's forearm twist step in the swap, which the easing made worse: 94 degrees a frame),
  `car-exit`'s middle as its own move, the gun hand-off.
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

- Main session's check of V8 (2026-11-12, about 14:20; load average 173): frames alternated one by
  one with flora, terrain, sky and furniture on and off, 70 rounds, on foot in the yard: on 30.0 ms
  (GPU wait 16.7), off 24.9 ms (GPU wait 10.2), difference 5.1 ms (V8's own interleaved figure was 1.3
  to 1.9 ms at loads of 96 to 200; the main session's earlier block figure for V7's flora, 45 ms, was
  not reproduced by V8's interleaved runs and may have been inflated by the other renders on the GPU).
  The absolute numbers mean nothing at this load; the scenery is on by default again. Looked at
  `v8_flora_foot_air.jpg` (a field of clumped blades at the yard's edge, firs and broadleaf trees,
  hills; from 100 m the far firs are plain cones on flat-coloured ground) and `night_vehicles.jpg` (the
  helicopter on its lit pad, the car's headlight beams on the tarmac). The two errors in the console
  buffer (`abs is not defined` in flora.js, `Identifier 'along' has already been declared`) carry an
  older module stamp than the loaded files: stale, from V8's development.

- Frame time on a quiet machine, main session (2026-11-12, 19:40; load average 7.6 to 8.1, the
  resumed clip pass just starting; canvas 1536 x 1152; everything on: scenery, mirrors, four cascades,
  the post chain; one frame = `demo.step(1/60)` + `demo.render()` + GPU done; blocks of 90 frames):
  on foot in the yard 6.8 and 8.3 ms median (p95 8.6 and 10.3); the car in the chase view at part
  throttle 15.7 and 13.5 ms (p95 39.9 and 34.6); the car's cockpit 8.8 ms (p95 17.6); the helicopter
  hovering at 97 m, chase view 14.7 and 18.5 ms (p95 21.5 and 31.5), cockpit 18.5 ms (p95 51.0).
  Against the 16.7 ms target: met on foot, in the car's chase view and cockpit at the median; the
  helicopter is at or just over it; the p95 in the vehicles is above 22 ms (spikes not yet traced).
- The clip pass was stopped by a usage limit at some point after 15:14 and resumed at 19:34 at the
  user's word ("Try again"). Before the stop it had shipped `rifle-motion-ue5-v1` at 14:46 and
  `vehicle-motion-tripo-v1` at 15:14 without logging either; its log entry is being brought up to date.

- A3 follow-up, the clip pass after its resume (2026-11-12, 19:34 to 21:35; every ship is in
  `notes/A3_log_entry.md`, one entry each, with numbers). Shipped, in order:
  - 13:44 `vehicle-motion-tripo-v1`: driver posture (shoulders forward and down, right knee off the
    tunnel; upper arms in the seat's wings 4.5 -> 2.2 to 2.6 cm, no hard pair left).
  - 14:46 `rifle-motion-ue5-v1`: the EarthOnline swap back to its timing before A3 (the pack is
    byte-identical to the one before A3; forearm twist step 73.8 / 61.3 degrees, not 94).
  - 15:14 `vehicle-motion-tripo-v1`: pilot posture (`pilot_seat` and `seat_pilot_point` 0.145 m
    forward by vehicleFit, no `scale`; nine seated clips, heli-enter and heli-exit re-solved).
  - 19:37 `vehicle-motion-ue5-v1`: the EarthOnline seated set (13 clips) on the same postures.
  - 20:22 `vehicle-motion-tripo-v1`: car-exit's middle as its own move (`clips_car.exit_middle`:
    left hand up onto the roof's edge over the doorway 2.2 to 3.4 s, left foot straight down over the
    sill, right hand on the knee for the rise; no hold under the door's corner, no push off the seat).
  - 20:51 and 21:19 `vehicle-motion-ue5-v1`: car-enter and car-exit for the EarthOnline body (its own
    values in `clips_car.UE5`, read only for that body; 15 clips in the pack now).
  Not shipped: EarthOnline heli-enter / heli-exit (head 1.1 to 1.9 cm into the doorway's top, thigh
  2.1 cm into the cyclic, calf 5.2 cm into the seat's front; its seated reference has the thigh 6.55 cm
  in the cushion, and raising the hips puts the head in the roof); the gun hand-off (not started).
  `vehicleFit.scale` and the `guns` track still have no data.

- Main session's check of the A3 follow-up in the game (2026-11-12, 21:25 to 22:15; pictures in the
  scratchpad's `a3check/`):
  - Car, Tripo: `chainReview('car')` joins at most 2.22 m/s (stowing>walking, right hand), root 0.23
    cm; inside clips the right hand 4.08 (stow), 4.01 (car-enter 3.85 s), 4.09 (draw). `enterExit`:
    both clips, contacts at most 0.58 cm. The exit film reads as its own move.
  - Car, EarthOnline civilian-m-01: both clips play as clips (no placeholder), contacts at most 0.87
    cm; films read in order.
  - Seated, cut-away pictures (`tools/a3_seated_shots.js`, new: the near plane cuts the door, the
    other seat or the roof away): the pilot sits upright with his back on the backrest, feet on the
    pedals, hands on cyclic and collective; the driver (both bodies) reclined in the seat, arms to the
    wheel, feet on the pedals. `bodyClearance` seated: pilot thigh 5.6 cm into the cushion; Tripo
    driver `seat_driver` 10 cm at clavicle_l by the game's crossing measure (the clip judge's depth
    reads 2.7 to 3.2 cm there; the two measures differ, the pictures show the shoulder on the wing).
  - Helicopter, Tripo: `chainReview('heli')` joins at most 1.97 m/s. FOUND: inside heli-enter and
    heli-exit the limbs move far too fast. Measured at 60 Hz in the vehicle's frame
    (`tools/a3_speeds.js`, new): heli-enter foot_l 7.8 m/s (3.48 to 3.60 s: 0.85 m from the skid to
    the cabin floor in 0.15 s, then 6.0 to 0.9 m/s in one frame), foot_r 7.2 (2.90 to 3.08), hand_l
    7.2 (1.95 to 2.03), hand_r 5.6 (0.87 to 0.93), head and pelvis 2.7 (0.68 to 0.80); heli-exit
    foot_l up to 8.8, foot_r up to 7.4. The car clips for comparison: hands 4.4 to 5.1, feet 4.6, head
    1.2, pelvis 1.35. The gate limited only the change of velocity per 30 fps frame, never speed, and
    the films' tiles are 0.5 to 1 s apart, so neither showed it. Also at 60 Hz the left ankle is 6.5
    cm off the line between heli-enter's frames 107 and 108 (joint rotations interpolated between two
    very different leg solutions): 7.9 m/s of velocity change where the 30 fps measure reads 4.2.
  - The gun still appears on the back in one frame after getting out (no hand-off yet).
  - NEW GATE LINES for entry and exit clips (sampled at 60 Hz with joint rotations interpolated between
    the 30 fps keys, vehicle frame): peak speed of hands and feet at most 4.5 m/s, head 2.0, pelvis
    1.8; velocity change between two 60 Hz samples at most 4.5 m/s for hands and feet.
  - The clip pass was resumed at 22:15 with three jobs in this order: (1) real step and reach times in
    heli-enter / heli-exit to the new lines, (2) the gun hand-off with the `guns` track (it may edit
    only the guns code in src/main.js and src/vehicles.js, and may drive the game page for this job),
    (3) EarthOnline heli-enter / heli-exit.

- A3 round 2, the clip pass (2026-11-12, 21:45 to 23:10; entries in `notes/A3_log_entry.md`):
  shipped 22:21 Tripo heli-enter (9.43 s) and heli-exit (12.17 s), 22:29 Tripo car-exit and
  EarthOnline car-enter / car-exit, 23:05 EarthOnline heli-enter (9.53 s) and heli-exit (12.23 s).
  Both packs now hold all 17 clips. New in the pipeline: `blender/vehicle_motion/speeds60.py` (the
  60 Hz speed and velocity-change measure on the exported pack, the same as `tools/a3_speeds.js`),
  the gate's speed lines (hands and feet 4.5 m/s, head 2.0, pelvis 1.8; velocity change 4.5), a
  speed-limited time warp (`pose.Clip.warp`, `warp_a3.py`, `warps_a3.json`: poses unchanged, time
  slowed only where a part is near its limit), and a judge fix (`judge._inside`: a vertex nearest an
  edge counts as inside only on an odd crossing count on two of three axes; it removed one-frame
  depth spikes). EarthOnline's helicopter fit lowers `pilot_seat` 0.06 m (thigh in the cushion 6.55
  -> under 1 cm; heli-fly's back gap 0 to 1.7 cm). Not attempted: the gun hand-off (see below).
- Main session's check of round 2 in the game (2026-11-12, 23:15 to 23:45):
  - Tripo, `tools/a3_speeds.js`: heli-enter hands 4.05 / 3.67, feet 4.14 / 3.76, head and pelvis
    1.65 m/s, velocity change at most 3.15; heli-exit feet 4.16 / 4.20, hands 3.15 / 3.69, head 1.23,
    pelvis 1.21, change at most 3.19 (was feet 7.8 and 8.8). Same as the pass's offline numbers.
  - EarthOnline civilian-m-01: heli-enter hands 3.95 / 3.64, feet 4.26 / 3.60, head and pelvis 1.65,
    change at most 3.71; heli-exit feet 4.16 / 4.19, hands 3.29 / 2.99, change at most 2.93.
  - `chainReview('heli')`, Tripo: joins at most 2.0 m/s; inside the clips at most 3.19 (was 7.87);
    only the rifle pack's stow and draw hand remain at 4.09.
  - Films (`a3check/r2_tripo_*_heli.jpg`, `r2_eo_*_heli.jpg`): door, skid, doorway, seat, legs in, door
    shut; the exits the reverse, then the walk round the door to close it. Both bodies read in order.
  - Contacts: the clip holds them; the 2.1 to 3.1 cm readings are the first 0.12 s only, where the
    walk's end blends into the clip's first frame (the feet glide 2 to 3 cm into place).
  - Seen: the gun on the back passes into the seat's back while he sits down (5.9 to 7.2 s), and on
    the way out a gun stands in the cabin and then appears on his back. The hand-off is the open item.
  - Gun hand-off, why not built (from the pass): both guns hang at one spot on the back, so two reaches
    of about 1.2 s; in the helicopter the right hand is free only 1.9 to 3.85 s of the entry while the
    left hand holds the post; the places by the pilot's knee are where the legs pass the doorway; the
    cabin places are 1.2 to 1.4 m from the doorways. A version that reads right needs either about 2.4
    s more at the doorway or different places (or carrying one gun in and laying it across once
    seated). Left to the user.

- Guns put away in vehicles (main session, 2026-11-13 about 00:20; the user's choice when asked how the guns
  should get into the vehicle). `src/main.js` only: `gunsAway()` (default; `demo.gunsCabin = true`
  for the old way). Pressing T: no stow clip; both guns hidden at once and `handsFree` set, the walk
  starts the next frame, the arms drop through the hand-over blend (`foot:foot>foot:walking`, 0.35 s).
  In every vehicle mode `placeVehicleGuns` hides both (`demo.gunsAt = 'away'`). After the exit clip the
  `drawing` step is unchanged: the guns show on the back and the draw brings the gun to the hands (a
  gun never shown in hands that are not on it; popping it into the hands would have had the hands
  reach it over 0.35 s). Checked in the game: `chainReview('car')` joins at most 1.43 m/s (foot >
  walking: hands 1.43 / 0.84), leaving > drawing 1.42; `chainReview('heli')` joins at most 1.81; the
  only jolt over 4 m/s left in either chain is the draw's right hand (4.09, the swap clip) and in the
  car Tripo car-enter's right hand at 3.85 s (4.01). Films `a3check/gtachain_car_*`, `gta_*_heli.jpg`:
  no gun anywhere from the press of T to the end of the exit; the walk to the door starts 1.3 s
  sooner. The `guns` track contract and `CABIN_GUNS` stay in the code behind the flag.

- The remaining open items (2026-11-13; the user: "go ahead do it"). Two passes started together:
  V9 (game, owns the browser page and src/): the draw's right-hand jolt (4.09 m/s), the feet gliding
  2 to 3 cm in the first 0.1 s of each entry, the far trees (cones from 100 m), then frame time and
  the slow frames (helicopter median at or over 16.7 ms, vehicle p95 35 to 51 ms; target p95 22 ms),
  measured last. U1 (Unreal export, headless Blender only): the 17 + 17 vehicle clips and both
  vehicles as FBX with the door / event / contact data, and make.py fixed so no FBX embeds an
  absolute path. Sound by ear and hands-on feel still need a person.

- Freeze on getting into the car (the user, 2026-11-13: "when I try to get into the car the entire game
  just freezes"). Cause, found by the main session on the live site with the node-builder and pipeline
  caches instrumented: the guns-away change hid the guns, and the muzzle-flash PointLight was a child of the
  gun's muzzle node, so the scene's light list changed; three.js then rebuilds every material (CPU node
  building 0.6 to 1.0 s per change on this M5 Pro, plus the GPU's pipeline compiles, far longer on a
  cold browser cache). It happened on pressing T (1037 ms), at the walk's end and the next frame (745 and
  737 ms: the guns showed for the one frame where arrived() had set 'entering'), and again when the
  guns came back after the exit. Fix (commit c1858f9, deployed): the flash light lives in the scene and
  follows the muzzle (`fx._followFlash`), and the hide line covers 'entering'. After the fix a whole get-in
  / get-out on a fresh load had no node rebuild at all; one 330 ms frame remains on the walk (no node
  builds: the mirrors' first render compiling pipelines for their render target), left to V9's
  precompile work. Lesson: never change a light's presence (or an ancestor's visibility) at run time.

- Driver's right hand backwards (the user, 2026-11-13: "can you fix the hand that are driving car? seems
  like backwards"). Measured in the game against the wheel's frame: the left hand pointed forward from
  the wrist with its palm to the rim; the right hand pointed back at the driver (fingers +Y), its wrist
  past the rim. The solved hands matched their targets exactly: the targets were wrong. seated.js
  `_handsOnRim` built each hand's X from `tUp`, the rim's counter-clockwise tangent (12 o'clock at 9,
  6 o'clock at 3), and negated it for the right hand, which rotated that hand 180 degrees about its palm
  normal. Fix (commit 142e921, deployed): X = tUp for both hands (the canonical hand frames are mirror
  images and PALM_LOCAL has no X, so this is the exact mirror). After: fingers (-0.26, -0.96, -0.07) and
  (0.26, -0.96, -0.07), palms 0.0 cm off their targets, lockToLock palms 0.0 cm, never off the rim; test/
  hands.test.js passes; pictures `a3check/hands_wheel_fixed.jpg`, `hands_close_fixed.jpg`. Every review
  since V2 measured where the palms were, never which way the hands faced. Seen: the fingers hook rather
  than wrap the tube tightly (both hands alike).

- Main session's check of V9 (2026-11-13, about 11:30; load 3.7; pane shown, the game's own loop at
  120 Hz, viewport 1512 x 900 at DPR 2 = canvas 2268 x 1350, fresh page loads): turning on foot right
  after load (360 deg/s for 1 s, a 150 ms flick, then another turn) median 8.3 ms, worst 10.4, no frame
  over 22; getting into the car and out again by key T in real time, 2874 frames, median 8.3, worst
  10.4, none over 22; the helicopter in and out, 3510 frames, median 8.3, p99 10.4, worst 18.6, none
  over 22. Looked at `v9_trees_ab4_midday.jpg`: the far firs read as tiered firs, the ground's broad
  bands are broken into mottle. Node tests 8 / 4 pass; the build is clean. Not checked by me: the
  live site on a cold browser cache (next), a 60 Hz display, adaptive scale under real GPU load.

- Live site after V9 (2026-11-13, about 12:00; viewport 1512 x 900, the game's own loop): the first visit
  after the deploy loaded in about 45 s (assets 14 s, then 31 s of pipeline compiles under the loading
  screen, `load:warm-start` 14.1 to `load:warm-end` 45.1); a second visit was ready in 8.3 s (warm-up
  1.7 s). Turning right after load: 120 fps, worst frame 10.4 ms, none over 22. Car in and out by key T:
  2887 frames, median 8.3, worst 25.5 (two single frames of 23 and 26 ms). The loading screen now says
  "Preparing shaders… (slow only on the first visit)" during the warm-up (commit ae041ad). Seen once:
  a page loaded while GitHub Pages was switching deployments got a 503 for supercar.glb and showed
  "Could not start the demo"; a reload a minute later worked (the loader does not retry).
