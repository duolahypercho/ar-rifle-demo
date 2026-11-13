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
