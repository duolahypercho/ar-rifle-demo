- 2026-11-13, pass A4 (clips for VEHICLE_NOTES.md "Third request": brisk entry and exit at the user's target pace, getting out while moving;
  later the "Parachute" subsection's clips). Both vehicle packs. Builds run in private headless Blenders
  (`blender/vehicle_motion/a4_run.py`, about 40 s per clip with the judge); the project's GUI Blender on 9877 was not
  started by this pass.
  - How the fast clips are made (`blender/vehicle_motion/warp_a4.py`, `warps_a4.json`): the same authored moves, played
    through a speed-limited time warp: per 60 Hz instant of the authored move, the slowness each limit asks for (hands
    4.5 m/s, feet 6 m/s (the brief's "brisk step" allowance; car-exit's hands 6 too), head 2.0, pelvis 1.8, the
    velocity change between 60 Hz samples 4.5, head / pelvis turn 500 / 420 deg/s, the hand's twist on its forearm
    40 deg a frame, the door 220 deg/s opening / 320 closing; never faster than x6), widened 0.02 s, smoothed 0.04 s;
    then a fix pass on the warped export (the gate's snap30 on the palms and the head included) and, where a frame
    landed on a thin slice of the move with something 2.0+ cm in, a small shift of that frame's instant (`nudge`).
    Holds and slow stretches shrink most; moves that were already quick stay near their speed. Not uniform: a uniform
    x2.3 would put the feet at 9 to 10 m/s.
  - Fixes on the way: `pose.natural_moves` capped the hand's turn about the forearm at 12 deg per FRAME; in a warped
    clip the frames lie further apart in authored time, the hand lagged and snapped onto the hold's turn (twist steps
    82-103 deg). Now 12 deg per authored frame (unwarped clips bit-identical). A composed warp could stop short of the
    authored end (the clip then ran its last 0.05 s at rate 1, 3.53 s): the last key is now pinned to the end.
  - Content changes (authored): car-exit ends standing where the body stepped round (no steps back to the entry point)
    and the door closes by itself from `free` (no hand on it: with the hand push the clip could not get under 3.0 s at
    the limits, 3.06 to 3.17 s in three arrangements); heli-exit has no walk round the door: two steps out of its swing
    (facing away, yaw 95 deg) and the door closes by itself; car-enter: the door waits on its strut 0.15 s after the hand
    lets go (the curled fingers were in the grab's recess as it rose, 2.5 cm), the left foot's last step 3 cm higher and
    3 cm nearer the middle (2.2 cm into the footwell), the hips 1 cm further forward as the right leg comes in under the
    rim (thigh_r 2.2 cm into its bottom); heli-exit (Tripo) the palm on the door's glass 2.7 cm lower (wrist dev 51).
  - SHIPPED 13:48 `vehicle-motion-tripo-v1` (17 clips): car-enter, car-exit, heli-exit fast; heli-enter still the old
    9.43 s clip (appended unchanged from the previous pack; the fast one is not through the gate yet); the 13 seated
    clips bit-identical to the previous ship (channels and notes). Load check (three.js GLTFLoader) PASS.
    - car-enter 3.50 s (106 frames; was 8.0): doorOpenStart 0.37, doorOpenEnd 0.86, seated 1.88, doorCloseStart 2.89,
      doorCloseEnd 3.32, handsOn 3.40. GATE PASS: speed60 hands 4.17 / 4.41, feet 5.55 / 5.89 (over 4.5: brisk steps),
      head 1.90, pelvis 1.69, dv60 max 4.15; snap30 4.2 / 3.8 / 4.5 / 3.5 / 1.8; twist step 36.8; join 0 mm / 0 deg; hard
      max 1.97, soft max 4.23, head clearance 0.6 cm, wrists L -32 / -49, R +66 / -26, elbow min 27, knee min 24.
    - car-exit 2.93 s (89 frames; was 7.83): handsOff 0.04, doorOpenStart 0.24, doorOpenEnd 0.63, unseated 1.80, free
      2.46, doorCloseStart 2.46, doorCloseEnd 2.86; ends standing at (-1.60, -0.30) facing 155 deg (root yaw 2.705).
      GATE PASS: speed60 hands 5.31 (left, off the wheel to the door) / 3.76, feet 5.74 / 5.55, head 1.87, pelvis 1.71,
      dv60 max 4.32; snap30 4.1 / 3.2 / 3.9 / 3.6 / 1.8; twist 39.5; join 0 / 0; hard 1.81, soft 4.41, head clearance
      0.3, wrists L -62 / +50, elbow min 6.6, knee min 10.3.
    - heli-exit 3.57 s (108 frames; was 12.17): handsOff 0.05, doorOpenStart 0.40, doorOpenEnd 0.91, unseated 1.67, free
      3.36, doorCloseStart 3.15, doorCloseEnd 3.55; ends standing at (2.05, -1.27) facing away (yaw 95 deg, root 1.658).
      GATE PASS: speed60 hands 4.30 / 3.84, feet 5.87 / 5.77, head 1.90, pelvis 1.69, dv60 max 4.33; snap30 3.8 / 3.5 /
      4.4 / 4.0 / 1.5; twist 38.1; join 0 / 0; hard 1.99, soft 3.71, head clearance 0.3, wrists R -54 / +50.
    - Seen (sheets, 20 frames x 5 views each): car-enter: hand to the grab, the door up, the turn with the back to the
      seat, down onto the sill, legs in under the rim, the door pulled down, hands to 9 and 3 - the old move, quicker.
      car-exit: the left hand pushes the door up, the head and shoulder lead out, legs out over the sill, up out of the
      doorway, the steps round to face the front, the door coming down by itself beside the standing body. heli-exit:
      hands off, the door pushed open on its glass, the left leg back over the cyclic, down by the skid, two steps out,
      the door swinging shut behind. Nothing passing through anything at the sampled frames.
  - SHIPPED 13:53 `vehicle-motion-tripo-v1` (17 clips): all four entry / exit clips fast now. heli-enter 4.43 s (134
    frames; was 9.43): doorOpenStart 0.80, doorOpenEnd 1.57, seated 2.93, doorCloseStart 3.75, doorCloseEnd 4.21,
    handsOn 4.37 (warp designed at margin 0.92: at 0.95 the gate's lines were met only by luck of where the frames fell;
    Tripo's hips 1.5 cm higher at 3.4-3.95 authored: the left calf was 4.7 cm into the seat's front as the left foot
    came off the skid onto the doorway's step, `E2['a4_up']`). GATE PASS: speed60 hands 4.40 / 4.30, feet 5.91 / 5.71,
    head 1.85, pelvis 1.69, dv60 max 4.39; snap30 3.4 / 4.2 / 4.1 / 3.9 / 1.9; twist 35.7; join 0 / 0; hard max 2.0,
    soft 4.48, head clearance 0.3 cm, wrists L -68 / +46, R -38 / -40, elbow min 13, knee min 9.8. car-enter, car-exit,
    heli-exit and the 13 seated clips bit-identical to the 13:48 ship. Load check PASS. Seen: the walk to the door, the
    door pulled open, the left hand on the post and the foot on the skid, up into the doorway, the sit, the left leg
    over the cyclic, the door pulled shut, hands to the controls - the old move, quicker.
  - 14:16, the athletic clips (in progress, nothing shipped yet): new machinery `blender/vehicle_motion/clips_a4.py` (AClip:
    hands and feet as keyed targets on the body (the pelvis's / chest's whole frame, turning with a rolling body), on the
    ground, or on the vehicle; free hands turn with the forearm; wrists clamped against the gate's lines with a
    measured-bias loop `wrist_a4.py`), `judge_a4.py` (the body against the ground plane, per part; joins relative to the
    pelvis; wrists / twist / elbows / knees), `ground_a4.py` (per authored frame, the pelvis raised or lowered so the
    trunk's lowest point lies 1 cm into the ground where the body is on it: sitting, rolling; `ground_a4.json`),
    `gate_a4.py` (the athletic gate), feet with a whole turn (pose.py, keys.py's foot control) and the pseudo-frames
    '@pelvis' / '@chest'. fall (1.0 s loop) GATE PASS; land-hard (2.5 s) GATE PASS; land-roll (1.70 s after a slower-only
    speed warp from 1.6) GATE PASS. Remaining: bail-roll, car-bail, heli-jump.
  - SHIPPED 14:45 `vehicle-motion-tripo-v1` (23 clips): the 17 before, bit-identical to the 13:53 ship (channels and notes),
    and the six athletic clips. Load check PASS (23 clips). Athletic gate (`gate_a4.py`; speeds60 lines with the
    athletic limits and the impact exemption after events.ground):
    - car-bail 0.83 s (authored 0.70, slower-only warp): handsOff 0.04, doorOpenStart 0.14, doorOpenEnd 0.36, unseated
      0.36, release 0.70; speeds hands 7.10 / 3.73, feet 6.21 / 7.09, head 3.50, pelvis 3.87, dv60 max 5.98; wrists L -32 /
      -30, R -33 / -21; twist 16.8; elbow min 41, knee min 51; join to car-drive frame 0 exact (0 mm / 0 deg). NOT met
      (my own line, not in the brief's athletic list): hard pairs max 3.4 cm (the left foot against the footwell's side as
      it leaves the floor, 8 frames; the right thigh on the rim 2.2 at one frame). The back of the left hand shoves the
      door (no forearm turn: the palm shove twisted the forearm 94 deg a frame); the left foot leaves by car-exit's way
      (back along the floor from under the dash, up and over the sill).
    - bail-roll 2.07 s (authored 1.9): ground 0.39, free 1.96; travel 2.38 m; root0 yaw 250 deg = car-bail's last. Speeds
      hands 5.05 / 4.00, feet 5.54 / 5.66, head 4.82, pelvis 3.42; ground: max 1.9 cm in (rolling); join to car-bail's last
      frame 2.5 mm / 1.8 deg (fingers); wrists within 3 deg; twist 19.2. The right shoulder takes the ground (no hand
      plant: the hand's turn onto and off the ground twisted 88 deg a frame).
    - heli-jump 1.23 s (authored 1.0): handsOff 0.03, doorOpenStart 0.22, doorOpenEnd 0.66, unseated 0.73, release 1.03;
      speeds hands 3.18 / 4.63, feet 5.20 / 6.61, head 2.75, pelvis 3.54, dv60 3.32; join to heli-fly frame 0 exact (the
      grips taken from heli-fly's own rolled hands); wrists L -17 / +20, R +31 / +31; twist 35.7. NOT met (my line): the
      right fingers 3.2 cm into the door's glass for 2-3 frames as it shoves it open.
    - fall 1.0 s loop: speeds under 1 m/s; wrists straight; joins to heli-jump's / car-bail's last frames (reported, a 0.2 s
      blend): 307 / 336 mm at a hand (their ends hold one arm low under the open door), 43 / 48 deg at the fingers' world turn.
    - land-roll 1.70 s (authored 1.6): ground 0.14, free 1.66; travel 1.40 m; speeds hands 5.97 / 5.57, feet 7.06 / 7.60,
      head 4.91, pelvis 3.44; ground max 2.6 cm in (the back of the head at the inversion); contacts 0.01; wrists L -60 /
      -43, R -60 / -44; twist 38.3; join to fall frame 0: 5.1 mm / 1.0 deg (calf_r).
    - land-hard 2.5 s: ground 0.13, free 2.35; speeds hands 5.47 / 3.96, feet 4.71 / 6.19, head 4.98, pelvis 3.54; ground max
      1.6 cm (the right fingertips); contacts 0.01 (feet, the right hand behind); wrists R -55 / -10; join to fall frame 0
      exact.
    - Seen (sheets, 10 frames x 5 views): car-bail: the door shoved up, the turn, the legs out under it, the launch out of
      the doorway, arms out; bail-roll: the turn in the air, the tuck, over the right shoulder and the back, a crouch, a long
      step, standing; heli-jump: hands off, the door shoved, the left leg over the cyclic, out of the doorway, arms out;
      fall: arms windmilling slowly, legs treading; land-roll: the squat, hands to the ground, the head tucked (the back of
      the head and shoulders on the ground), over onto the back, the crouch, standing; land-hard: the deep squat, down onto
      the right hip with the right hand behind and the left on its knee, head down, up through a crouch. The notes' new
      `athleticClips` text (how the frames, roots and heights hand over) is in build_vehicle_motion.notes_top for the next
      build; this ship's JSON does not have it yet.
  - SHIPPED 15:13 `vehicle-motion-ue5-v1` (23 clips; the EarthOnline bodies, built on civilian-m-01-player-ue5): the 13
    seated clips bit-identical to the previous ship; the four fast entry / exit clips (their own warps, keys 'ue5:<clip>');
    the six athletic clips (their own ground fits and slower-only warps). Its JSON carries the new `athleticClips` note.
    Load check PASS on civilian-m-01-player / f-02-hero / m-03-hero / police-m-hero (-ue5).
    - car-enter 3.43 s: seated 1.82, handsOn 3.34, door shut 3.24. GATE PASS: speed60 hands 4.39 / 4.34, feet 5.57 / 5.72,
      head 1.91, pelvis 1.72, dv60 max 4.39; twist 36.3; join 0 / 0; hard 1.8, soft 4.2, head clearance 0.5 cm.
    - car-exit 3.00 s: unseated 1.88, free 2.53, door shut by itself 2.53-2.93. GATE PASS: hands 4.86 / 3.64, feet 5.76 /
      5.52, head 1.83, pelvis 1.73, dv60 3.98; twist 36.5; hard 1.96, soft 4.42; wrists L -60 / +47. Changes for this body:
      the left hand off the roof's edge 0.15 s sooner (`UE5['EX']['r2']` 3.25: wrist 56 deg off), the left foot's step off
      the floor straight up first (`a4_clear_at`), the left hand's way to the thigh 4 cm further forward; one frame's
      instant shifted (nudge).
    - heli-enter 4.50 s: seated 3.05, doorCloseEnd 4.33, handsOn 4.50 (the hands land on the grips on the last frame: the
      settled 0.3 s after authored 7.67 is played in that frame; the gate's lines hold there). GATE PASS: hands 4.37 /
      4.19, feet 5.79 / 5.42, head 1.90, pelvis 1.73, dv60 4.38; twist 35.9; hard 1.91, soft 3.82.
    - heli-exit 3.57 s: unseated 1.62, free 3.34, door shut by itself 3.13-3.53. GATE PASS: hands 4.39 / 4.00, feet 5.83 /
      5.92, head 1.88, pelvis 1.69, dv60 4.38; twist 38.3; hard 1.74, soft 3.83.
    - car-bail 0.80 s (release 0.68), bail-roll 2.03 s (ground 0.38, free 1.93, join to car-bail's last 1.6 mm / 1.2 deg,
      ground max 2.9 cm), heli-jump 1.23 s (release 1.03), fall 1.0 s, land-roll 1.77 s (ground max 2.0 cm), land-hard 2.5 s:
      athletic gate PASS on all six (speeds: car-bail hands 7.52, feet 7.41; land-roll hands 6.62; the rest lower; dv60 max
      4.73; contacts 0.01; wrists within 60 / 47). NOT met (my vehicle-pair line): car-bail's left foot 3.5 cm into the
      footwell's floor as it slides back from under the dash (7 frames; its own way out, low along the floor as its
      car-exit, replaced 6.0 cm with Tripo's way), heli-jump's left thigh 2.3 cm on the cyclic's grip.
    - Seen: car-exit, heli-enter, bail-roll for this body (the jacket, the jeans) read as Tripo's do; nothing new through
      the vehicles at the sampled frames beyond the pairs above.
  - The word the coordinator asked to remove (the third-party game's name) is gone from warp_a4.py and this log.
  - SHIPPED 15:25 `vehicle-motion-tripo-v1` (30 clips): the 23 before bit-identical to the 14:45 ship; the seven parachute
    clips (clips_a4: `HANG`, hang_pose, para_deploy, para_land, para_pickup). Load check PASS. Athletic gate PASS on all
    seven:
    - para-hang 2.0 s loop: hands at the toggles above the head along the risers, legs hanging, a slow sway, the head
      looking about; speeds under 0.25 m/s; wrists within 2 deg.
    - para-steer-l / para-steer-r / para-flare: one-pose clips, para-hang frame 0 except the pulled arm(s) (the join to
      para-hang frame 0 with that arm left out: 0.0 mm / 0.0 deg): left / right / both hands down at the hips.
    - para-deploy 1.2 s: pull 0.34, open 0.55; join to fall frame 0 exact, to para-hang frame 0 1.4 mm / 1.1 deg; speeds
      hands 2.78 / 3.56, head 4.51 (the jerk), feet 3.4; twist 21.8. The right elbow back to the handle at the hip, out
      on the pull (a forward elbow pole had twisted the forearm 83 deg a frame).
    - para-land 1.5 s: ground 0.25, free 1.35, 2.0 m; speeds hands 6.75 (the flare), feet 7.49, head 4.96; contacts 0.01;
      ground max 0.1 cm.
    - para-pickup 1.30 s (authored 1.2, slower-only warp for the forearm's turn in the swing): grab 0.34, onBack 0.94,
      free 1.25; speeds hands 4.52 / 5.70; contacts on the pack 0.01; twist 38.3.
    - Seen: the deploy (the right hand to the hip, the pull out to the side, the jerk upright, the hands up to the toggles),
      the hang (arms up along the risers; at the first try the hands at ear height read as flexing: raised 12 cm and the
      elbows' poles down), steer and flare (one / both hands at the hips), the landing (the flare, feet first, three
      running steps, standing), the pickup (bending to the crate, both hands on the pack, the right hand swings it over
      the right shoulder, both hands at the straps, down). The crate and the pack are not modelled in the judge (the hands'
      contact points stand for them).
    - Not measured: para-pickup's start / end against the game's on-foot idle (its standing pose is the athletic clips'
      standing end, pelvis 0.895 m, hands by the thighs); the arms against a 12 cm pack on the back (no pack mesh in the
      judge; the hands stay in front of or above the shoulders). The notes' `parachuteClips` text is in notes_top for the
      next build (not in this ship's JSON).
  - SHIPPED 15:28 `vehicle-motion-ue5-v1` (30 clips): the 23 before bit-identical to the 15:13 ship; the seven parachute
    clips for the EarthOnline body (the running steps' and the bend's hip heights lowered with its shorter legs:
    `FIT['dy']`; a straight knee at 0.2 deg otherwise). Athletic gate PASS on all seven: para-deploy 1.2 s (pull 0.34, open
    0.55; joins to fall frame 0 exact, para-hang frame 0 1.1 mm), para-land 1.5 s (ground 0.25, free 1.35; hands 7.04 in
    the flare, feet 7.50; ground max 1.8 cm), para-pickup 1.47 s (slower-only warp and a fix pass for the forearm's turn:
    grab 0.34, onBack 1.05, free 1.41; twist 36.1), para-hang, -steer-l, -steer-r, -flare. Load check PASS on the four
    -ue5 bodies. This JSON has the `parachuteClips` and `athleticClips` notes.
  - 15:29 `vehicle-motion-tripo-v1.json` replaced by a rebuild of the whole pack from the code on disk: all 30 clips
    bit-identical to the 15:25 ship (channels and notes), the GLB byte-identical; the JSON now also has the
    `parachuteClips` note. Load check PASS. public/characters/SOURCE.md: a pass A4 paragraph.
  - Files (all under blender/ and the two packs): blender/build_vehicle_motion.py (athletic / ground clips, the ground
    plane in the sheets, close-ups by clip frame, the two new notes, speeds60 for the new clips with the impact
    exemption); blender/vehicle_motion/pose.py (warps_a4.json, the per-authored-frame twist cap, per-step clear,
    whole-turn feet, '@pelvis' / '@chest', `tail`), clips_car.py (A4 tails, enter_a4 / A4E, UE5 car-exit values),
    clips_heli.py (A4 tail for heli-exit, `a4_up`), speeds60.py (per-clip limits, one-pose clips, exemptions),
    blender/rifle_motion/keys.py (a foot control with a whole turn; the rifle packs were not rebuilt); new:
    a4_run.py, warp_a4.py, warps_a4.json, clips_a4.py, judge_a4.py, gate_a4.py, ground_a4.py, ground_a4.json,
    wrist_a4.py, wrist_a4.json. warps_a3.json is no longer read (kept).
  - Open: car-bail (left foot 3.4 / 3.5 cm into the footwell's floor as it leaves, 7-8 frames) and heli-jump (Tripo: the
    right fingers 3.2 cm into the door's glass as they shove it; EarthOnline: the left thigh 2.3 cm on the cyclic's grip)
    fail the vehicle-pair line I added to my gate (it is not in the brief's athletic list); fall's joins to car-bail's /
    heli-jump's last frames are a 0.2 s blend of about 0.3 m at one hand (their ends keep one arm low under the open door);
    the gun hand-off and the pack's mesh are not in the judge; the clips have not been seen in the game.
