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
- 2026-11-12, pass A2 follow-up (coordinator's ship gate: wrists +-70 flex / +-50 dev on every frame, forearm twist step
  <= 40, elbow and knee >= 5 deg, snap30 <= 4.5 hands / feet and <= 2.0 head, hard pairs <= 2.0 cm and the head never in
  the roof or the door frame, contacts <= 1.5 cm, soft (seat) <= 4.5 cm moving, join <= 1 mm / 0.5 deg; balance reported).
  The coordinator had shipped the 16-clip A2 candidate before this follow-up.
  - SHIPPED to `public/characters/vehicle-motion-tripo-v1.glb/.json`: at 00:38 the pack with the new `car-enter`, and at
    00:51 the pack with `car-enter` and `car-exit` (2,634,356 / 203,187 bytes). Each ship: 13 seated clips bit-identical
    to the shipped ones, notes identical; `heli-enter` / `heli-exit` copied unchanged from the coordinator's ship
    (`vehicle_motion/append_pack.py`; bit-identical, notes identical); top-level notes identical; three.js load check
    PASS; round trip 0.097 mm. Proof: `review/vehicles/candidate/stage/bitcheck.txt`, `load_check.txt`.
  - NOT shipped (unchanged, still the coordinator's ship): `heli-enter`, `heli-exit`; EarthOnline fit not started.
  - Gate checker: `blender/vehicle_motion/gate_a2.py` (reads `review/vehicles/tripo/<clip>-frames.txt` and the clip's
    line in clips(-partial).txt). It counts a pair the seated reference itself has (car-drive frame 0, unchanged) as the
    reference's own while its depth is within 0.1 cm of the reference's: the depth measure reads 4.53 to 4.62 cm for
    upperarm_r/seat on the same pose. Gate outputs: `review/vehicles/candidate/a2b/gate-car-*.txt`.
  - car-enter (8.0 s): GATE PASS. snap30 hand_l 3.9 / hand_r 2.7 / foot_l 1.8 / foot_r 2.7 / head 0.4; wrists worst L flex
    -42 dev -43, R flex +48 dev -36; hand-forearm twist step 24.3 deg; twist bones worst step 29.4 (upperarm_twist_01_r);
    elbow min 27.3; knee min 22.6; contacts <= 0.87 cm (foot_l on its rest, arriving); head: body_shell 0.6 cm clear at
    f202, interior 1.6, door 4.8; hard worst 2.05 (thigh_r / calf_r against the centre tunnel, the reference's own), then
    foot_l/interior 1.92, hand_r/door 1.91 (letting go of the grab), thigh_r/steering wheel 1.82 (knee under the rim),
    foot_r/interior 1.80, calf_l/body_shell 1.59, foot_l/body_shell 1.48 (the reference's), fingers on the door / sill /
    rim 1.43 to 1.91; soft worst 4.62 upperarm_r (the reference's 4.53), 4.49 upperarm_l / clavicle_l, 4.26 spine_05;
    join 0.000 mm / 0.000 deg; balance out of the support up to 18.3 cm (f144, the hips going back onto the seat) and
    over 3 cm on f17; planted-foot slide 7.1 mm/frame at f218 (the left foot settling on its rest).
    Changes from the first A2 version: the right knee passes in front of the rim's bottom with the foot leading low
    (knee pole forward-right, then rest); the left foot rests on the sill's outer edge while the right leg goes in
    (the left thigh no longer on the sill); the pelvis roll stays right-side-up while the right leg crosses; the left
    hand on the sill palm down on its sloping outer part, fingers over the edge, the trunk leaning over it; the right
    elbow out to the side for the grab (no twist past 180); the door pull lets go at 56 % and the hand goes in under it;
    the head swings in lower (more recline before it passes the roof's edge); the left foot's last step lifts the toes
    early (no scrape on the footwell side).
  - car-exit (7.8 s): GATE PASS. Its own move: pushes the door up from inside with the left palm on the inner panel
    (0.65-1.0, 35 %, the strut opens it by 1.6); 1.0-4.1 goes out through the doorway on car-enter's checked poses run
    backwards (head out under the roof, left leg out first onto the sill's edge and the ground, then the right leg from
    under the rim; the left hand on the sill 3.32-3.62); right hand under the open door's lowest corner (4.15-4.6) as it
    stands up (4.1-5.2); steps out and forward beside the door's front (4.8-5.92), right hand to the grab (6.0), pulls it
    down to 76 % and lets go, it shuts (6.65); steps back to the entry point (6.5-7.28), standing still to 7.8.
    snap30 hand_l 2.0 / hand_r 1.8 / foot_l 2.6 / foot_r 2.7 / head 1.1; wrists L flex -53 dev +41, R -42 / -36;
    hand-forearm twist step 30.2; twist bones worst 31.6 (lowerarm_twist_02_r); elbow min 27.4; knee min 14.0; contacts
    <= 0.89 cm; head: body_shell 0.6 cm clear, interior 1.6, door 5.7; hard worst 2.05 (tunnel, the reference's), then
    upperarm_l / lowerarm_l on the shut door 1.96 (f11, reaching to the panel), foot_l/interior 1.92, fingers_r/door 1.78,
    thigh_r/steering wheel 1.77, fingers_l/sill 1.75, calf_l/body_shell 1.59; soft worst 4.62 upperarm_r (the reference's),
    fingers_r/seat 2.51; join 0.000 / 0.000; balance up to 20.4 cm out (f111-115, the hips rising off the seat's edge);
    planted-foot slide 7.8 mm/frame at f87.
  - Pipeline additions: `pose.py` free-hand moves follow the forearm with the turn about it limited to 12 deg a frame and
    from where a free hand really was; a move may be marked 'plain'; the balance planner leaves a seated body alone
    (`seated_from` / `seated_before`); a foot's contact may start / end within a set distance of its place
    (`contact_lead` / `contact_trail`); a step may carry its own pitch curve. `clips_car.py`: `_reverse_plan`, `exit_`.
    `append_pack.py` copies clips between packs unchanged.
  - Not done: heli-enter / heli-exit to the gate (a 20-minute try on heli-enter did not converge: the left knee straight
    on the skid as the body rises, the left elbow straight reaching the post, the hand into the door handle when letting
    go, the thigh against the cyclic 3.4 cm; reverted); the EarthOnline fit. Rebuilding heli-enter / heli-exit now with
    the changed pose.py gives different data from the shipped ones; the pack keeps the shipped bytes.
  - Seen: car-enter.png / car-exit.png (5 views x 20 frames) and close-ups. Wrong or doubtful: car-enter's sideways sit
    still spreads the legs (right leg in the footwell, left foot up on the sill); the left forearm's twist bones run +35
    to +240 deg over the sill hold (no frame-to-frame jump, but a strongly turned forearm); car-exit's middle is car-enter
    backwards; in car-exit's door-pull close-up two of three views are blocked by the door.
  - Rifle packs after the follow-up: rifle-idle and swap-rifle-shotgun rebuilt in private headless Blenders for both
    bodies, every channel bit-identical (96 / 104 Tripo, 99 / 107 EarthOnline), notes identical.
- 2026-11-12, pass A2 follow-up 2 (heli-enter / heli-exit to the same gate; the door to its full 68 deg; the collective at
  its bottom stop (4 deg) at the end of the enter and the start of the exit; the leg over the cyclic planned; then the
  EarthOnline body).
  - SHIPPED `public/characters/vehicle-motion-tripo-v1.glb/.json`: 01:44 with the new `heli-enter` (2,563,080 / 204,182),
    01:54 with the new `heli-exit` (2,571,100 / 205,543; all 17 clips built, none copied). Each ship: the other 16 clips
    bit-identical to the previous ship, notes identical (`review/vehicles/candidate/stage/bitcheck.txt`); three.js load
    check PASS on tripo-player-ue5.glb (`stage/load_check.txt`); round trip 0.097 mm. A rebuild with the final code
    (`candidate/stage_final/bitcheck.txt`): all 17 bit-identical to the shipped pack.
  - SHIPPED `public/characters/vehicle-motion-ue5-v1.glb/.json` at 01:18 (1,065,524 / 66,134): the 13 seated clips on
    civilian-m-01-player-ue5 with its own vehicleFit (fit.py: wheel telescoped 0.03 m instead of Tripo's 0.06 (elbows on
    the rim 79-90 deg against 89-99 at 0.06; Tripo 75-87); seat / pedal settings at the same limits, legs 0.78 m). Load
    check PASS on all four -ue5 bodies (`review/vehicles/ue5/load_check.txt`); round trip 0.094 mm. Replaces A1's 4-clip
    pack (kept at scratchpad shipped_ue5_a1). No enter / exit clips in it.
  - heli-enter (8.0 s, `clips_heli.enter2`): new path. 0-0.85 two steps back out of the door's swing; 1.03-1.45 right hand
    on the outside handle (contact node cockpit_door_R_handle), pulls the door to 35 %, it swings to 100 % (68 deg) by
    2.3; 2.2-3.05 left hand on the rear post; 2.2-2.55 left foot onto the skid; 2.55-3.25 the right leg swung in over the
    sill into the right footwell (the cyclic's right); 3.3-3.65 left foot up onto the doorway's step; 3.6-3.8 left hand on
    the cushion; hips onto the seat's right edge (4.6); 5.3-6.1 the left leg lifted over the cyclic's grip (via 1.62 m
    high, knee out to the left) to the floor left of it; 6.4-6.75 right hand on the open door's inner frame (rear lower
    window corner), leaning out (yaw 205, roll 15), pulls it to 25 %, it shuts by 7.15; 6.9-7.55 left hand to the
    collective at 4 deg, right to the cyclic by 7.7; heli-collective-down from 7.5 (join_ref). GATE PASS: snap30 hand_l
    2.2 / hand_r 4.0 / foot_l 4.5 / foot_r 2.6 / head 1.0; twist step 30.3 (60, L); join 0.000 mm / 0.000 deg to
    heli-collective-down frame 0; worst: hard 1.98 cm (75 middle_02_l/interior), soft 4.46 cm (109 thigh_l/seat), contact
    1.2 cm (44 hand_r on the handle), wrists flex 66 (114 L) dev 50 (44 R), elbow min 13 (24 R), knee min 14 (100), head
    clearance min 0.2 cm (139 fuselage); balance 39.1 cm (100; reported). Balance planning is off over the walk and the
    climb (`balance_skip` (0-2.2), (2.5-4.7)): the planner's 40-47 cm hip shifts pulled the feet off the skid and the hand
    off the post.
  - heli-exit (8.0 s, `clips_heli.exit2`): heli-enter's checked path run backwards (every channel, plan, door and balance
    offset at 8.0 - t; the right hand's move onto the door starts 0.1 s earlier to keep the forearm's twist step under
    40). Starts on heli-collective-down (collective 4 deg); door pushed open 0.85-1.6 to 68 deg; left leg back over the
    cyclic 1.9-2.7; down onto the skid and out; door pushed shut on its outside handle 6.55-6.97. GATE PASS: snap30 hand_l
    2.1 / hand_r 4.3 / foot_l 4.5 / foot_r 2.6 / head 1.0; twist step 28.0 (180, L); join 0.000 mm / 0.000 deg; worst
    hard 1.98, soft 4.46, contact 0.24, flex 66, dev 50, elbow 14, knee 14, head clearance 0.2 cm; balance 38.9 (140).
  - Code: pose.py `smooth_runs` (opt-in: a hold's roll smoothed only within its own run of frames; needed for the 0 mm
    join), `balance_skip`; clips_heli.py enter2 / exit2 / _rev_steps / _adapt_body / _node_q; clips_car.py `_seated_s()`
    (enter / exit take the body's own SEATED_BY_BODY; Tripo unchanged, bit-identical); fit.py the EarthOnline entry;
    build_vehicle_motion.py heli close-ups, `A2_ALL` (judge-only: A2 measures on every clip). Gate: gate_a2.py
    (GATE_DIR, SEATED), worst_a2.py.
  - Rifle packs after the changes: rifle-idle and swap-rifle-shotgun rebuilt in private headless Blenders, bit-identical
    (96 / 104 Tripo, 99 / 107 EarthOnline), notes identical (`candidate/stage_final/rifle_bitcheck.txt`).
  - NOT shipped: EarthOnline car-enter / car-exit / heli-enter / heli-exit (frames in
    `review/vehicles/candidate/ue5_enter_exit/`). car-enter: knees straight 17-19, 71; feet 3.8 cm into the footwell (215)
    and the sill; head 2.6 cm into the roof 195-211; contact 2.7 cm. car-exit: the same mirrored plus wrist L -86 / -81
    (117) and soft 4.8. heli-enter / -exit: with the hips 3.5 cm lower while standing (`_adapt_body`) the knees pass; the
    head stays 2.5-2.8 cm into the doorway's top / cabin roof on the seat's edge (4.2-5.0 s) and lowering the hips there
    puts the pelvis 5-9 cm into the seat cushion. The plan's absolute heights fit Tripo's proportions, not this body's.
