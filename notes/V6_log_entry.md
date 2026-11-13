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
