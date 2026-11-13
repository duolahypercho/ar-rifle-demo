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

- 2026-11-12, pass A3 follow-up (coordinator: finish the driver posture, the pilot posture, the EarthOnline body, car-exit's
  middle, the gun hand-off). State on disk at 19:35 after a usage stop (nothing half-built in `public/`):
  - SHIPPED 13:44 `vehicle-motion-tripo-v1` (driver posture): Tripo's seated car reference with the shoulders carried
    forward and down (collar (-16, 28, 16, 28)) and the right knee's pole steered left off the tunnel (left knee at its
    rest pole; `clips_car.SEATED_BY_BODY_A3`, per-side knee weights `knees_w`). car-drive: upper arms in the seat's
    wings 4.53 / 4.31 -> 2.17 / 2.60 cm, clavicles 3.61 / 3.61 -> 2.65 / 3.21, right thigh / calf on the tunnel 2.05 -> 0
    (no hard pair left), elbows 79 -> 55 deg, wrists -42 / -36 -> -32 / -17. car-enter's right knee goes over to the
    reference's pole after its old poles have faded (6.25-6.45 s), car-exit's at the mirrored moment (enter-time
    6.26-6.38; `EX['exit_k']`). Gate: car-drive, car-steer-l/-r, car-look-back PASS (seated: no reference pairs
    tolerated); car-enter PASS (snap30 3.9 / 2.7 / 1.8 / 2.7 / 0.4, twist 24.5, join 0 / 0); car-exit PASS (2.0 / 1.8 /
    2.6 / 2.7 / 1.1, twist 29.1, join 0 / 0); car-exit's clavicle_l under 4.5 now. The seat widening (`scale`) was not
    used. 11 helicopter clips bit-identical to the previous ship.
  - Judge fix found on the way (build_vehicle_motion.setup): a re-used prop could still carry an earlier clip's keys
    (car door open) when the judge read its meshes, so door pairs were measured against an open door (car-enter frames
    23-41 "4.46 cm into door_L"). The props are now keyed at rest and the scene set to frame 0 before the judge reads
    them. Measures only; no clip changed by it. heli-enter / heli-exit re-gated after the fix: PASS.
  - SHIPPED 14:46 `rifle-motion-ue5-v1`: the EarthOnline swaps back to their previous timing (the slung pause is applied
    only to bodies with F3's forearm solve, `UNWIND`: Tripo); the whole pack is byte-identical to the pack before pass A3
    (twist step back to 73.8 / 61.3 deg, not 94.0 / 69.2). The Tripo rifle pack keeps the pause (11:15 ship).
  - SHIPPED 15:14 `vehicle-motion-tripo-v1` (pilot posture): pilot_seat and seat_pilot_point 0.145 m forward (vehicleFit,
    was 0.08: the backrest against the back while the hands stay on the controls), right shoulder dropped (collar
    (-2, -8, 4, -20)) and the right elbow's pole down (0, -1, 0.3). heli-fly: lower back on the backrest (spine_03
    3.7 cm into its padding, spine_05 touching in 65 of 240 frames), trunk lean pelvis->head 4.6 deg forward, right
    forearm to right thigh skin gap 1.9 -> 0.5 cm. Cyclic not lengthened (a longer stick only raises the grip; the fit
    has no `scale`). heli-enter: the left foot from over the cyclic straight onto its pedal (calf clear of the seat's
    front), left foot on the doorway's step at (0.77, -1.34), hips 1.5 cm higher at 6.5 s. heli-exit: the palm on the
    glass 4.5 cm inside its face (hold node cockpit_door_R_glass), fingers turned (0.38, -0.92, -0.05). Gate: all 9 seated
    PASS; heli-enter PASS (snap30 2.2 / 4.0 / 4.2 / 3.7 / 1.0, twist 30.3, join 0 / 0); heli-exit PASS (1.6 / 2.1 / 3.8 /
    3.8 / 0.3, twist 38.2, join 0 / 0). Feet near a surface: drift 0.26 / 0.08 cm (enter), 0.07 / 0.11 (exit); foot
    velocity change per frame 4.24 (enter left, f107, over the 4.0 target) / 3.68; exit 3.81 / 3.77. The 6 car clips
    bit-identical to the 13:44 ship. Load check PASS.
  - Not started yet: EarthOnline seated set and entry / exit, car-exit's middle (code `exit_middle`, off), gun hand-off.
  - Blender on 9877 (pid 45616) is the one this pass started at 12:45 and is still running.
  - SHIPPED 19:37 `vehicle-motion-ue5-v1` (EarthOnline seated set on the pilot posture): its own fit now has pilot_seat
    and seat_pilot_point 0.145 m forward (fit.py `UE5_SEAT_FWD`; wheel 0.03 m, seat / pedals as before), the shared
    helicopter seated pose (shoulder / elbow pole) as Tripo's. heli-fly on civilian-m-01: backGapCm 0.0-0.5, trunk lean
    pelvis->head 5.5 deg, right forearm close over the thigh (axes 12.9 cm apart). All 13 seated clips PASS the gate;
    the 4 car clips bit-identical to the previous ue5 ship (its car posture already had upper arms 2.7 / 1.9 cm and no
    tunnel pair); load check PASS on all four -ue5 bodies. Still no entry / exit clips in it.
  - EarthOnline entry / exit (not shipped, 20:10): car-enter / car-exit retargeted with `clips_car._adapt_body` (ue5 only:
    hips 3.5 cm lower while the plan stands and in the seated phase, at the plan's own height over the sill; footwell
    places and the way over the sill raised 2-3 cm for its longer feet). Best run: knees and head now pass; left foot /
    calf 3.4-4.8 cm into the footwell beside the brake on its last step (enter 7.0-7.2 s, exit 1.5-1.7 s), right foot
    3.2 cm into the sill and the footwell (5.4-5.8 s), the left foot 2.5 cm off its place, left wrist -86 / -81 at the
    sill (exit 3.9 s), the back 4.6-4.9 cm into the seat's wing while moving. Helicopter entry / exit for this body: the
    head 2.5-2.8 cm into the doorway's top on the seat's edge, thighs 6-7 cm into the cushion, wrists 70+ (not worked on
    further). `_adapt_body` changes nothing for Tripo.
  - SHIPPED 20:22 `vehicle-motion-tripo-v1` (car-exit middle as its own move, `clips_car.exit_middle`, now on through
    module `EX`): 1.0-4.1 s own hips / turn / spine keys; left hand off the wheel (0.2-0.65), on the door's inner face
    (0.65-1.0) as before, then up onto the roof's edge over the doorway (1.8-2.2 move, hold 2.2-3.4 at V (-0.62, 1.05,
    -0.10), node body_shell, contact 'push' frames 66-102), down past the shoulder to hanging (3.4-4.3); left foot over
    the sill straight down to the ground (2.3-3.0); right foot down onto the floor (1.5-1.9), out wide under the wheel
    and over the sill (3.25-4.0); the right hand hangs in front of the belly from the wheel's release (2.5) to 3.9, then
    moves onto the right knee for the rise (4.25-5.3), then to the door's handle and closes it as before (6.0-6.13).
    No hold under the door's corner (the corner hold took the right wrist to 93 / 135 deg in every variant tried) and no
    push off the seat (the bolster 36-49 cm from the hand). Gate PASS: snap30 1.5 / 1.6 / 2.6 / 2.2 / 0.6, twist step
    28.9, join 0 / 0, wrists L flex -57 (f66) dev +42 (f103), R -32 / -17; elbows >= 7 (R f126), knees >= 14; hard pairs
    max 1.93 (foot_r/body_shell f106), 1.91 (forearm_l/body_shell f115-116, the roof release), 1.42 (thigh_r/interior
    f102); soft spine_03/seat 4.50 (f75), clavicle_l 4.49 (f51); contacts max 1.46 (foot_r on the floor); balance 21.6
    cm at f107 (reported). events.unseated 4.3 -> 4.0. The other 16 clips bit-identical to the 15:14 ship; load check
    PASS. A first copy shipped at 20:19 had lost the right hand's handle hold (door closing without the hand); replaced
    at 20:22 by the build above, which has it (contact frames 180-184).
  - SHIPPED 20:51 `vehicle-motion-ue5-v1` + `car-enter` (EarthOnline body, 14 clips now: the 13 seated, bit-identical to
    the 19:37 ship, and car-enter). Its own values in `clips_car.UE5` (read only when the body is
    civilian-m-01-player-ue5, `_ue5()`): the last left step ends 5 cm further back (its foot is shorter: one via at
    (-0.41, 0.28, -0.80) in place of Tripo's two reaching -0.98), the right foot's toes up early on its way in (pitch 0
    -> 38 deg over 10-45 % of the step) and the left foot's on the sill step (-20 -> 10 over 0-70 %), the right ball on
    the pedal 1.5 cm before its plant (contact lead), the right knee's pole down and out under the rim from 5.0 s
    ((0.5, 0.2, -0.8)), the hips back to the plan's height from 6.6 s. Gate PASS (no reference pairs tolerated: the
    reference file was not in the run): snap30 3.9 / 3.6 / 1.9 / 3.0 / 0.4, twist 27.2 (f115), join 0 / 0; wrists R
    -50 / +39 (f115), L -42 / -44; elbows >= 26, knees >= 30; hard pairs max 1.95 (foot_l/interior f189-210), 1.65
    (thigh_r/wheel f170); soft max 4.45 (spine_05/seat f207); contacts max 1.20 (foot_l on the floor). Balance 17.8 cm
    at f75 (reported). Load check PASS on civilian-m-01-player / f-02-hero / m-03-hero / police-m-hero (-ue5). Seen:
    the jacket's mesh opens at the hip in deep hip flexion (f158), as in its seated clips. Tripo's 17 clips rebuilt
    bit-identical with these changes. car-exit for this body does not pass (feet 6.5 cm into the footwell at 1.6 s,
    upper arm and spine_05 6.2 cm into the door frame at 3.0 s, upper arm 5.2 cm into the seat's wing): not in the pack.
  - SHIPPED 21:19 `vehicle-motion-ue5-v1` + `car-exit` (15 clips: 13 seated and car-enter bit-identical to the 20:51
    ship, car-exit new). car-exit on this body is Tripo's (with exit_middle) plus its own values in `clips_car.UE5`:
    the first step off the floor backwards on its shorter foot's way, the right foot 2-5 cm higher over the sill with its
    toes up (0 -> 25 -> 20 -> 0 deg), the hips only 30 % of dy lower in the seated part (`xw`), the left hand from the
    door to the thigh in front of the seat's wing, and its own hips / turn / spine keys for the middle (`UE5['EX']`: the
    broader back under the roof's edge leaning out further, side bend -30 at 2.6 s, hips 1 cm lower at 3.0 s, right hand
    on the knee 7 cm higher). Gate PASS: snap30 1.3 / 1.6 / 2.6 / 2.7 / 0.6, twist 35.9 (f196), join 0 / 0; wrists L -56
    (f66) / +46 (f103), R -42 / -31; elbows >= 27, knees >= 29; hard pairs max 1.97 (foot_r/interior f104), 1.95
    (foot_l/interior f51), 1.92 (forearm_l/door f12); soft max 4.49 (spine_03 / spine_05 on the seat, f53); contacts
    max 1.35. Balance 22.2 cm at f107 (reported). Load check PASS on all four -ue5 bodies. Seen: the jacket's armpit
    stretches when the right arm reaches up for the handle (f182) and the jeans fold at the crotch in deep hip flexion
    (f98); both are the body's skinning. Tripo's 17 clips rebuilt bit-identical. Heli-enter / heli-exit for this body
    not attempted in this round.
  - EarthOnline heli-enter (not shipped, 21:31): fitting knobs added to clips_heli._adapt_body (ue5 only, all off unless
    set: `ue5_lift`, `ue5_vias`, `ue5_pitch_k`, `ue5_hvias`, `ue5_hang`, `ue5_up`, `ue5_kl`, `ue5_hold_end`). Best run
    (lift 0.04, dy 0.05, trunk pitch -8 at the seat's edge, hips +2 cm 4.2-5.1 s and 6.6-7.45 s, handle released at
    1.36 s, right hand hanging 10 cm further in at 1.9-3.85 s) leaves: head 1.1-1.9 cm into the doorway's top (f137-138,
    f206-208), thigh_l 2.1 cm into the cyclic (f192), calf_l 5.2 cm into the seat's front while moving (f204). The ue5
    seated reference itself has thigh_l 6.55 cm into the cushion (the 19:37 pilot posture), so lifting the hips to clear
    the thigh sends the head into the roof. heli-exit on this body: 77 hard items (forearm 6.2 cm into the door glass at
    0.8 s, right foot 5.8 cm into the footwell 1.8-4.2 s), twist step 68: not worked on.
  - Gun hand-off (item 5): not started beyond reading CABIN_GUNS and the `guns` contract. Not attempted: the car's cabin
    places are on the passenger seat (x +0.30..+0.45), 1.2 m from the driver's doorway, so the guns would have to come
    off the back and be laid there by a lean-in over the driver seat before sitting (two guns, about 2.4 s), with the gun
    meshes added to the judge and the track's end matching cabinGuns()'s frame exactly; not doable to a reviewed result
    in the time left.
  - Verified 21:33: both vehicle packs rebuild from the code on disk bit-identical to what is in public/characters
    (17 / 17 Tripo channels-sets, 15 / 15 ue5, both JSONs byte-identical); rifle packs untouched since 14:46.

### Round 2 (from 21:45): speed lines, gun hand-off, EarthOnline helicopter
  - New gate lines (21:50): `blender/vehicle_motion/speeds60.py` is the game's 60 Hz measure (tools/a3_speeds.js) on the
    exported pack: joint rotations slerped / translations lerped between the 30 fps keys, FK down the pack's skeleton
    (the root bone carries the notes root, so positions are in the vehicle frame). On the 21:19 packs it reads what the
    game read (heli-enter foot_l 7.79 @ 3.53, dv60 7.87 @ 3.58; hand_l 7.18; foot_r 7.16; head / pelvis 2.67). The build
    writes `speeds60(-partial).txt` for every entry / exit clip it exports; `gate_a2.py` fails a clip on any line over
    (speed hands / feet 4.5, head 2.0, pelvis 1.8; dv60 hands / feet 4.5) or with no line.
  - Judge fix (22:00): a body or vehicle vertex counted as inside when it was behind its nearest face even when the
    nearest point was on an edge or corner, where that face's normal says nothing (heli-enter f254: a pelvis vertex
    "5.24 cm" into the cushion with its plane distance 0.01 cm and an even crossing count on all three axes, i.e.
    outside; f61: a door vertex "4.98 cm" into a fingertip, plane distance 1.27, crossings even). Now in that case the
    surface is crossed along x, y, z and the vertex counts as inside only on odd counts for two of them
    (judge._inside). Face-interior cases are unchanged. Re-gating the 21:19 car clips gives the same results.
  - Time warp (pose.Clip.warp, warp_a3.py, warps_a3.json): a clip may play its authored channels at a varying rate;
    the build samples every channel at W(clip time), contacts / events / door / root follow. warp_a3.py computes it
    from speeds60 on the unwarped clip: where a part is over 0.9 x its limit (or its dv60 over 0.9 x 4.5, square root)
    the time runs that much slower, widened 0.08-0.2 s each side and smoothed. Same poses, so pairs stay meaningful,
    but sampled at new instants: between-frame poses that 30 fps never showed came out (and were fixed below).
  - SHIPPED 22:21 `vehicle-motion-tripo-v1`: heli-enter 8.0 -> 9.43 s (warp margin 0.9, dilate 0.2, sigma 0.08; slowest
    stretch x1.77 at the skid -> doorway step), heli-exit 10.7 -> 12.17 s (margin 0.9, dilate 0.08, sigma 0.04; x2.17
    in the walk round the door). heli-enter's own changes for the new instants (clips_heli.E2): left foot off the skid
    by (0.97, 0.76, -1.28) with 10 % straight-up / down, right hand off the handle at 1.40 s (was 1.45: wrist dev -51),
    right hand hanging 6 cm further in while the door swings (its arm was 2.4 cm into the door at 1.9 s), left hand on
    the post 0.6 cm further out, left ball on its pedal 1.5 cm before its plant, left hand onto the collective from
    2 cm higher. Gate (with the speed lines) PASS: heli-enter snap30 1.5 / 2.0 / 3.0 / 1.4 / 0.4, twist 29.4, join 0 / 0,
    speed60 hands 4.05 / 3.67, feet 4.14 / 3.76, head 1.65, pelvis 1.65, dv60 max 3.15; heli-exit snap30 1.6 / 2.1 /
    2.9 / 1.9 / 0.3, twist 38.2, join 0 / 0, speed60 hands 3.15 / 3.69, feet 4.16 / 4.20, head 1.23, pelvis 1.21, dv60
    max 3.19. The other 15 clips bit-identical, notes identical. Load check PASS. Not shipped with it: car-exit fails
    the new speed line (foot_l 4.62 at 5.47 s, a walk step round the door) - next.
