- 2026-11-11, pass A1: the character's vehicle clips in the Blender pipeline. The user: "make sure to add the
  driving animations for both and the mecs", "until it feels hyper realistic".
  - SHIPPED (each once, after it passed): `public/characters/vehicle-motion-tripo-v1.glb` / `.json` (471,032 /
    27,940 bytes) and `vehicle-motion-ue5-v1.glb` / `.json` (479,932 / 26,914; built on civilian-m-01-player-ue5),
    four clips each: `car-drive` (8.0 s loop, 240 frames), `car-steer-l` (wheel +90), `car-steer-r` (-90),
    `car-look-back` (one-frame poses). NOT shipped: `car-enter`, `car-exit`, `heli-enter`, `heli-exit` (not
    authored: out of time); the helicopter's seated clips (`heli-fly`, `heli-cyclic-f/b/l/r`,
    `heli-collective-up/down`, `heli-pedal-l/r`: authored and judged, they fail the body-against-vehicle test,
    below).
  - Code: `blender/build_vehicle_motion.py` and `blender/vehicle_motion/` (`vehicles.py` node frames read from the
    vehicle GLBs and the controls as functions, the vehicle imported as a prop and keyed with the root's inverse;
    `pose.py` clips authored in the vehicle's frame, the root carried per frame, a hand on a handle rolls round it
    and turns about its palm normal (within 35 deg) for the straightest wrist; `clips_car.py`, `clips_heli.py`;
    `judge.py` body-vs-vehicle BVH per frame, head clearance, contact distances, snap, sheets with a section view;
    `pack_load_check.mjs` three.js GLTFLoader in Node). Reuses rifle_motion's skeleton, rig (guns and belt kit
    hidden), keys, bake, twist / IK keying, export and review unchanged: no shared file edited (nothing copied to
    a1_orig). Scenes `blender/vehicle_motion_tripo.blend`, `vehicle_motion_ue5.blend`; review in
    `blender/review/vehicles/{tripo,ue5}/` (clips.txt, twist.txt, export.txt, load_check.txt, sheets, close-ups;
    tripo/clips-heli-not-shipped.txt holds the helicopter numbers).
  - Contract details decided (all in the pack JSON's top level): `clipSpace` (root [x, z, yaw], yaw = pi faces the
    vehicle's forward; root bone keyed with the same track), `seatedReference` (car-drive frame 0 is the reference
    and the loop's life is exactly 0 there; pose clips are whole-body poses on it, blended additively, weight =
    control / extreme, one extreme at a time by sign), `controls` (door_L = rest * Rx(-55 deg * door), checked
    against the GLB's doors_open keys; steering_wheel = rest * Ry(deg): the spec's "local Z" is Blender's, glTF
    local +Y, + = left; heli cyclic Rx(-fwd) Rz(-right) about its floor pivot, collective Rx(+up), pedals along
    the parent's -Z), `contacts` (palm middle for hands, the sole under the ball for feet, node frame; `interior`
    for the car's pedals and floor, which have no nodes), `gun` (Gun keyed at the rifle's sling place).
  - Fit against the car (numbers from the GLB): cushion top 0.27..0.29, backrest 17 deg, headliner 1.06..1.09,
    floor 0.165, accelerator face z -1.045 (x -0.30..-0.25), brake x -0.56..-0.47, wheel centre (-0.37, 0.665,
    -0.50), rim radius 0.172. The car is small for a 1.75 m body: with the back on the backrest the rim is 20 cm out
    of reach and the head 6 cm through the headliner. Chosen: hips 25 cm forward of the backrest on the cushion's
    front half, pelvis tipped back 36 deg, chest 32 deg, collarbones forward, chin 14 deg down; the upper back is
    OFF the backrest (a gap of about 10 to 15 cm in the section view). EarthOnline body: hips 1 cm lower, 2 deg
    more recline, chin 18, left foot behind the brake turned out (its shoe met the footwell's side).
  - Numbers, Tripo / EarthOnline (targets: snap30 <= 3.5, wrists within 45 dev / 60 flex, elbow >= 10, no knee
    locked, 0 body-vehicle pairs, hand contact <= 1.0 cm, loop seam <= 1):
    car-drive: snap30 all parts <= 0.01 / 0.01 m/s; seam 0.13 / 0.01 (step / accel ratio), EO 0.12 / 0.01; elbows
    45..63 / 46..60, EO 60..73 / 59..69; wrists L flex -29 dev -24, R -27 / -20 (EO -31 / -26, -28 / -22); knee min
    57.8 (EO 57.2); slide 0 (feet planted); vehicle pairs 0 / 0 over all 240 frames; seat pairs (thighs and pelvis
    into the seat cushion, the only contact allowed) 38,490 + 40,270 + 11,017 over 240 frames, depth not
    measured; head clearance 0.6 cm (frame 141, headliner) / 0.9; hands on the rim 0.0 cm, feet on the pedal /
    floor 0.01 / 0.0 cm; twist worst step 0.25 / 0.28 deg per frame.
    car-steer-l: elbows 34 / 42 (EO 50 / 56); wrists L -28 / +10, R +25 / -9 (EO -32 / +18, +27 / -13); pairs 0;
    head 0.3 cm (EO 1.1); hands 0.0. car-steer-r: elbows 40 / 36 (EO 56 / 50); wrists L +25 / -8, R -29 / +11;
    pairs 0; head 0.9 cm (EO 2.0). car-look-back: elbows 42 / 49 (EO 63 / 64); wrists L +15 / -36, R +22 / +5
    (EO left dev -42); pairs 0; head 1.7 cm (EO 1.1); left hand on the rim at 11 o'clock 0.01 cm; the right
    hand rests on the right thigh (the arm over the passenger backrest was tried: upper arm 89 to 108 pairs into
    the driver's own seat, wrist flex 47 to 66).
  - Round trip (the written GLB posed by plain FK against Blender's skeleton, every joint, every frame, root
    applied): 0.093 mm Tripo, 0.087 mm EarthOnline. Load check without the browser (three.js 0.187 GLTFLoader in
    Node, `node blender/vehicle_motion/pack_load_check.mjs`): Tripo pack on tripo-player-ue5.glb (87 joints) and the
    EarthOnline pack on all four -ue5 bodies (90 joints): 4 clips, every track names a body bone or Gun, every
    joint keyed, 30 fps keys, per-frame door / root lengths and contacts and the top-level fields present: PASS.
  - Rifle packs unchanged: rifle-idle and swap-rifle-shotgun rebuilt in a private headless Blender for both bodies
    (`PATCH = 'export'`, scratch output): every channel bit-identical to the shipped rifle-motion-tripo-v1 (96 + 104
    channels) and rifle-motion-ue5-v1 (99 + 107), notes identical.
  - Seen in the sheets (front, side, above with the seat and wheel only; a section through the car from the
    driver's side; a three-quarter view with the whole car) and close-ups: the driver reclined low, hands at 9 and
    3, head under the headliner in the section, glances to the left and right mirrors at 2 s and 5 s and to the
    rear-view mirror at 6.9 s, fingers easing off the rim and closing at 3.5 to 4.3 s (right) and 5.9 to 6.6 s
    (left). WRONG: (1) at +-90 the top hand lies on top of the rim with the fingers straight forward over it, not
    wrapped round it (the rifle grip's curl does not close round a rim seen from above); the lower hand wraps.
    (2) The upper back does not touch the backrest in any car clip (the car's proportions, above). (3) The
    look-back's right hand on the thigh is not a vehicle contact and is not listed in `contacts`.
  - Helicopter (authored, judged, not shipped): pilot on the cushion's front half leaning forward 16 deg and left
    12 deg, collective held raised 13 deg in flight (its grip at the bottom stop is 0.16 m below the cushion: out of
    reach sitting up), feet on the pedals toes up 38 deg, the hands rolled on the cyclic and collective for the
    wrists (cyclic wrist flex 0..2 dev 0..3; collective -4..-11 / 5..28), contacts 0.0 to 0.33 cm. FAIL: the cyclic's
    upper stick sits between the knees and passes into the inner thighs: heli-fly 5,477 (right) + 7,548 (left)
    triangle pairs over 240 frames, heli-cyclic-b / -l / -r 110 to 160 per pose, collective / pedal poses 2 to 24,
    heli-cyclic-f 0. Opening the knees by turning the feet out on the pedals, wider feet and smaller cyclic extremes
    (side 8 -> 6, back 9 -> 6 deg; kept) did not clear it; moving the hips back 8 cm cleared the stick but locked the
    knees (0.2 to 21 deg): the pedals are 0.9 m ahead of the seat's front. A fix needs knee poles per clip (the rig's
    knee pole rides on the foot) or a patched cockpit copy (game agent's `blender/vehicles/`).
  - Not done / not verified: the four enter / exit clips (door, handle, sill, skid, step-up, head duck: none
    authored); helicopter clips (above); seat-cushion depth of the allowed seat pairs; the game playing the packs
    (no browser); the sound of nothing (no sound here).
  Traps: the car's steering wheel spins about glTF local +Y (the spec's "local Z" is Blender's). A shoe's ball
  pivot sits 2.5 cm above its sole (EarthOnline `legs.ball`); plant feet by the sole point (pose.ground_for_ball)
  or they sink 2.5 cm. bl.py runs exec in one namespace: a lambda in the run text could not see module globals
  (use def). `bpy.app.driver_namespace['vehicle_motion']` keeps the scene between runs (REUSE = True); the fit
  hooks `car_fit`, `steer_fit`, `heli_fit` there persist too (clear them before a real build).
  - A1 follow-up (same day; the coordinator: "vehicle fit adjustments per body family"). NOTHING NEW SHIPPED:
    no stage passed all its targets, so `public/characters/vehicle-motion-*-v1` are still the first A1 packs
    (car seated clips only, old posture). The rebuilt candidates (13 clips: the four car seated clips and the
    nine helicopter seated clips, with `vehicleFit` in the JSON) are in `blender/review/vehicles/candidate/`.
  - New: `vehicle_motion/fit.py` (per body family, applied by `vehicles.FIT`, written to the notes as
    `vehicleFit` + `vehicleFitNote`): car `seat_driver` and `seat_driver_point` (0, -0.03, -0.20),
    `steering_wheel` 0.06 m along its column (0, 0.02248, 0.05563); helicopter `pedal_L` / `pedal_R`
    (0, 0, +0.25) aft, `pilot_seat` and `seat_pilot_point` (0, 0, -0.08). The seated roots follow the moved seat
    points. Knee poles keyed per clip in this layer (`build_vehicle_motion.key_knees`, `Clip.knees`; the shared
    rig's poles ride on the foot and keys.py never keys them). A wrapped hand for rims and sticks
    (`pose.wheel_grip`: every finger closed; the rifle grip keeps the trigger finger straight). The hand's roll
    solver also works on free holds and takes a roll limit. New measures: seat sink by face (cushion top /
    backrest face / side bolster or harness strap), the back's gap to the seat, knees / shins from the rim
    (car) or thighs / shins from the cyclic (helicopter). Contacts built from the plans (`auto_contacts`).
  - Stage 1, car seated (Tripo, candidate): back on the backrest (gap 0.0 cm), cushion sink 1.7 to 2.0 cm, head
    2.9 to 4.1 cm under the headliner, hands on the rim 0.0 cm, feet 0.01 cm, elbows car-drive 75..87 /
    75..85 deg bend (inside 93..105; target 100..130), steer 64..73, look-back 51 / 72; wrists drive L -49 / -43,
    R -46 / -38, steer L -48 / +36, R +35 / -27, look-back L +8 / -16 (fixed: the hand rolls on the rim), R +26 / +6;
    seam 0.14 / 0.01; twist steps <= 0.32 deg. NOT met: (1) the shoulder blades sink 4.1 to 4.9 cm into the
    bucket's upper wings (the seat's shoulder width is narrower than this body's; protracting the collarbones
    28 deg did not change it); (2) the right knee lies against the centre tunnel's side: 10 triangle pairs in the
    poses, 2,583 over car-drive's 240 frames (knee poles tried both ways: the knee then met the steering column
    or went deeper); (3) the rim clearance of the knees 2.4 cm in car-drive (3.0 to 3.4 in the poses); (4) the left
    foot rests on the floor just behind / under the brake pedal's lower edge (the footwell beside it is closed by
    the wheel arch). Trunk at the backrest's own 17 deg puts the head 4 to 6 cm through the headliner even with
    the seat 0.03 m down: the hips sit 6 cm forward of the backrest's foot, pelvis tipped back 42 deg, upper back
    on the backrest. Steering hands at +-90: the fingers now close round the rim (close-ups); the palm sits 3.6 cm
    behind the rim's centre line so the rim lies under the fingers' roots.
  - Stage 2: `car-enter` authored (butt first, 9.0 s, door track and contacts from the plans) and judged, NOT
    passing: 150 of 271 frames with pairs (seat 51,645: head, neck and upper arms through the backrest's wings
    while the body turns in; interior 11,483; body shell 5,460; wheel 4,694; door 1,543), hands 5 / 13 cm off the
    sill and 8 cm off the door's inner edge, wrists not solved (+-178). The open door hangs over the doorway at
    head height (x -1.26..-0.83, z -0.95..+0.10 for y 1.0..2.0): the approach was moved behind its rear edge.
    `car-exit` not authored.
  - Stage 3, helicopter seated (Tripo, candidate): 0 body-against-aircraft pairs in all nine clips (heli-fly 0
    over 240 frames); hands on the cyclic and collective 0.0 to 0.32 cm, feet on the pedals 0.01 cm; knees 74.9 to
    85.2 deg bend (inside 95 to 105); cyclic clear of the thighs 0.2 to 3.3 cm (knee poles out); cushion sink 1.9
    to 2.3 cm; wrists within 23 deg; elbows 14..48. NOT met: the back is 4.6 to 5.4 cm off the backrest: sitting
    back the hands do not reach (right elbow 0, the collective 8.8 cm away: the cyclic's grip stands 18 cm over
    the cushion and the collective's grip below it), so the pilot leans forward 22 deg; the right forearm is
    over, not on, the thigh; the harness straps modelled on the seat are 7.2 to 8.0 cm inside the body (thin
    strap faces, not the cushion).
  - Stage 4 (heli-enter / heli-exit) not started. Stage 5 (EarthOnline fit): built only with the Tripo fit
    values: car clips 17,196 neck / seat pairs (drive), cushion 3.6 to 4.1 cm; helicopter 0 pairs except
    cyclic-l / -r (36 / 14) and collective-down (13, thumb on the seat): own fit values not done.
  - Rifle packs still bit-identical (rifle-idle 96 / 99 channels, swap-rifle-shotgun 104 / 107, notes identical),
    rebuilt after all follow-up changes. Load check (Node, three.js GLTFLoader) of both candidates on their bodies
    (Tripo; the four EarthOnline bodies): PASS, 13 clips. Round trip 0.097 mm (Tripo).
