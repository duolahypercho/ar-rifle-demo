# Final review (2026-11-11)

## Where it stands after the fix passes F1, F2, F3 (Tripo player)

Measured by the main session in the game after each pass; details per pass in `ANIMATION_NOTES.md`.

- Fixed: the inner-elbow triangle (skin weights; smooth at 94 to 95 degrees in the rifle reload).
- Fixed: the heel in the 20-degree ramp (0.1 cm in every order).
- Fixed: the eye on the sights (rifle within 0.1 cm at level, 45 up, 45 down; shotgun within 0.7).
- Fixed: the swaps. Rifle to shotgun: muzzle snap 2.5 (`swap`, three runs), 2.4 walking, 2.7 jogging,
  2.5 crouched (was 4.4 to 4.9); shotgun to rifle 2.8 / 2.7 / 3.0 / 2.8. Wrists within 39 degrees
  (was +58 / +59). Both palms 0 cm off the gun. The right forearm no longer passes through the stock
  over the shoulder (Blender: 124 triangle pairs to 0). Done by rolling the release from the body
  table, retiming the left hand's regrip, and a time-warp that gives the port-to-over-the-shoulder
  part 0.126 s more, taken from the settle; the clip is still 41 frames.
- Fixed: the game's body file is 4.3 MB (was 12.7); code ready about 0.5 s after the page opens.
- Not possible on this model: blinks and eye movement. The face has 5 to 9 vertices round each eye and
  no eyelid geometry; a trial blink dragged the brow and fringe down and was not shipped.
- Still open: face skin up to 1.6 cm inside the rifle's stock while firing (allowance 0.8);
  `rampSequence20` snap 4.0 to 4.8 at a foot when turning crouched on the slope; forearm twist steps
  of 37 to 38 degrees a frame in the swap clips (target 30); shotgun-to-rifle `snap30` 4.4 in
  Blender's review (2.8 in the game); a planted foot read 5.2 cm above the ground in two of thirteen
  `swap` runs and did not repeat; shotgun `startStopWalk` 4.2 once.

## Pass F2: game-code fixes (Tripo player)

Numbers: `ANIMATION_NOTES.md`, "Quality bar", the F2 table (taken on F1's new body GLB of 18:43).

- Fixed: the heel in the 20-degree ramp. A foot that came down with its ball on the slope and its heel
  on the flat had its sole turned to the slope alone, driving the heel 3 to 5 cm into the flat. The sole
  now fits the ground under heel, toe and edges: 0.1 cm in rampCrouch20 after any other row (six runs,
  six orders), 0.2 to 0.9 in a played sequence (walk across, stop, crouch, walk down and back up).
- Fixed: the rifle's eye on the sights. Eye against the sight line now within 0.1 cm at level, 45 up and
  45 down (R3: 2.2 / 1.4 / 3.4 cm above); shotgun within 1.0 (level 0.6 low, 0.8 left). Done by nodding
  the head forward over the stock and bringing the stock across to the eye, per-body values.
- Not met: the face skin allowance of 0.8 cm inside the gun. Rifle level 0.8 to 1.0, 45 down 1.1, and
  1.6 while firing (recoil); shotgun 45 down 0.9. It is the jaw's angle on the back of the stock, as at
  R3 (1.2 to 1.5 there, by the same measure).
- Blinks now run on any body with the two blink morphs, without eye bones. The current Tripo GLB has
  no morphs yet, so the Tripo player still does not blink.
- Hit reactions on the Tripo body are as before the re-rig (rifle 2.6 / 2.0 / 2.6 / 2.4; shotgun 3.5 /
  1.0 / 3.5 / 3.2). R3's comparison mixed the shotgun's numbers with the old rifle's.
- Load: the code gets the page ready in 1.1 to 1.5 s and the first frame takes 0.57 s. The 7 to 31 s
  seen before was the hidden preview pane not drawing frames.
- Still over target: the swap's muzzle 4.4 to 4.8 (F1's clips); shotgun startStopWalk 4.2 once (a
  foot); `rampSequence20` 4.0 to 4.8 at a foot while turning crouched on the slope (a new row; not
  traced).

## Pass R3: the UE5 skeleton and the Tripo player

The game now runs on the UE5 Mannequin-style skeleton (`earthonline-ue5-v1`). The player is the
user's Tripo character (barefoot, T-shirt and shorts) on its own clip pack; `N` steps through the four
EarthOnline bodies on theirs. Every feature below works on both: 8-way walk and jog, sprint, starts,
stops, pivots and the about-turn, aim, fire, both reloads, the swap, crouch, ramps, stairs and the
kerb, hit reactions, both guns, the review tool. Numbers per row: `ANIMATION_NOTES.md`, "Quality bar",
the R3 table.

Against the pass-11 numbers below, on the Tripo player:

- Same or better: grip 0 everywhere but the swap's 0.2; trigger finger 0.6 to 0.9 on the shot and 0.7
  to 1.3 off it; slide 0 to 0.04; stops 72 to 75 cm / 0.43 s (jog) and 29 to 31 / 0.38 (walk); walk and
  aimed directions; crouch 36 to 41 cm lower; ramps, stairs and kerb within target except below.
- Worse than before or over target: swap-rifle-shotgun snap 4.4 to 4.9 at the muzzle (target 4.0;
  the EarthOnline bodies 3.7); swap firing wrist deviation +59; hits 3.3 to 3.5 (target 4.0, before
  2.3 to 3.5); burstUp 3.1 rifle (as before); rampUp20 / rampDown20 3.1 to 3.3 (target 3.0); stairsUp
  4.9 in one of six runs; the crouched ramp row after the other ramp rows (heel 3.4 to 5 cm in the
  slope); aimHold frozen 12 in one of four runs.
- New measure, cheek weld: the eye 2.0 to 2.2 cm above the sight line level, 1.3 to 1.4 aimed 45 up,
  3.4 to 3.8 aimed 45 down (the cheek on the comb; lower and the face goes into the stock).
- The Tripo body has no face rig: no eye movement, blinks or expressions (painted eyes).
- Seen, not fixed: a flat, bright crease on the inside of Tripo's elbow when it bends past about 90
  degrees (reloads, the swap). It is in the body's skinning (the clip played straight onto the body
  shows it too), not in the port.

The rest of this file is the review before R3 (the EarthOnline player on the old skeleton).


Eleven passes. Numbers are from `demo.review()` (every situation once per gun; the noisy rows six
times per gun), and the pictures were checked in close-ups and film strips in the game. Details per
pass are in `ANIMATION_NOTES.md`.

## What the character does now

- **Movement.** Walk and jog in eight directions facing the view, with a clip authored in Blender
  for each direction. Real side steps (feet never cross), backing up and diagonals. Sprint on its own
  clip. Authored transitions for setting off, stopping from any point of the stride, turning on the
  spot (45 to 180 degrees) and the running about-turn. Feet are held on the ground while they are
  down; no step is exactly like the last.
- **Gun handling.** Low ready, high ready after firing, shouldered aim blended by pitch (level, 45 up,
  45 down) with the cheek on the stock. Reloads (rifle magazine, tactical and from empty; shotgun
  shell by shell, stopped by the trigger) and the swap over the shoulder are authored clips, layered
  over whatever the legs are doing. Both palms stay on the gun (0 cm off in every row except the
  shotgun swap, 0.3 cm). The trigger finger lies along the receiver until it fires, goes into the
  guard for the shot and comes out again; it is off the trigger during reloads, pumps and swaps.
- **Crouch.** Authored crouch idle, crouch walk in eight directions, going down and coming up; aim,
  fire, reload, swap and hits work crouched. Head 35 to 37 cm lower.
- **Terrain.** Ramps of 10 and 20 degrees, stairs and a kerb, handled at run time: leaning into the
  hill, shorter steps, soles turned to the surface, feet put down on one tread.
- **Face.** Eyes fixate and jump (saccades), lead the head on turns, blink at uneven intervals, look
  at the magazine or pump during reloads; the brow sets on a shot.
- **Reactions.** Light flinches from four sides and heavy staggers front and back, with a shove the
  feet step after.
- **Picture.** Sun and sky lighting, shadows, ambient occlusion, temporal anti-aliasing, motion blur,
  bloom and a grade (`G` turns them off to compare).

## Main measures

| Row | Measure | Target | Rifle | Shotgun |
| --- | --- | --- | --- | --- |
| idle | frozenPct / snap / gripCm | 8 / 3.0 / 1.0 | 0 / 0.6 / 0 | 0 / 0.7 / 0 |
| walk, 8 directions | slide / snap | 0.10 / 3.0 | 0 to 0.02 / 1.3 to 2.1 | 0 to 0.02 / 1.3 to 2.1 |
| jog, 8 directions | slide / snap | 0.25 / 3.0 | 0 to 0.06 / 1.8 to 3.0 | 0 to 0.06 / 1.8 to 3.0 |
| sprint | slide / snap without feet | 0.35 / 3.0 | 0 / 0.9 | 0 / 2.4 |
| startStop (jog) | snap / stop distance, time | 3.0 / 110 cm, 0.6 s | 1.8 to 2.4 / 76 to 101, 0.48 | 1.8 to 2.1 / 79 to 98, 0.48 |
| startStopWalk | snap / stop | 3.0 / 40 cm, 0.45 s | 2.8 / 32, 0.37 | 1.8 and 3.7 / 33, 0.37 |
| turns on the spot | snap / slide | 3.0 / 0.10 | 1.3 to 2.1 / 0 | 1.3 to 2.2 / 0 |
| turnAbout (from a sprint) | snap upper body / slide | 3.0 / 0.40 | 2.1 to 2.3 / 0 | 2.6 to 2.8 / 0 |
| aimHold | frozenPct / gripCm | 10 / 1.0 | 0 to 8 / 0 | 1 to 6 / 0 |
| burst | snap / trigger finger on the shot | 3.0 / 1.5 cm | 0.6 to 0.7 / 0.6 | 1.6 / 0.6 |
| trigger finger at rest | tip from the receiver's side | 2.0 cm | 0.8 to 0.9 | 0.9 to 1.2 |
| reload | snap / gripCm | 3.0 / 2.5 | 1.0 / 0 | 1.7 / 0 |
| swap | snap / gripCm | 4.0 / 1.0 | 3.7 / 0 | 2.3 / 0.3 |
| crouch walk | snap / slide / head lower | 3.0 / 0.03 / 35 to 45 cm | 1.0 to 1.5 / 0 to 0.01 / 37 | 1.1 to 1.4 / 0 to 0.01 / 37 |
| ramps 20 degrees | snap / sink / sole | 3.0 / 1 cm / 6 deg | 3.2 / 0 / 4 | 3.2 / 0 / 4 |
| stairsUp | snap / sink | 3.5 / 1 cm | 2.5 to 3.3 / 0.5 to 1.0 | 2.2 to 3.3 / 0.1 to 1.2 |
| hits (light, aimed, walking, heavy) | snap / gripCm | 4.0 / 1.0 | 2.7, 1.3, 2.6, 2.3 / 0 | 3.5, 1.8, 3.5, 2.9 / 0 |
| eyes at rest | saccades a second / blinks apart | about 0.6 to 0.9 / 2 to 5 s | 0.5 / mean 3.5 | 0.7 / mean 3.5 |

## Still below target

- `rampUp20`: snap 3.2 with both guns (target 3.0), a foot on the slope.
- `stairsStart` (setting off at the foot of the stairs), rifle: snap 3.9 in one of six runs (target
  3.5); knees 6 and 9 cm apart in two of six runs (target 11).
- `stairsUp`, shotgun: sink 1.2 cm in one of six runs (target 1).
- `jogR`: snap 3.0 with both guns, at the limit.
- `burstUp`, shotgun: snap 3.1 at the support hand (target 3.0).
- `startStopWalk`, shotgun: snap 3.7 in one of two runs (1.8 in the other).
- `turnAbout`: 3.3 to 3.7 for the whole row, which includes the sprint's feet before the turn
  (exempt); the inside foot landing in the turn is 3.2 to 3.4.
- Wrists: carried firing-wrist deviation -30 to -37 (rifle) and -28 to -39 (shotgun) against 30; in
  the swap the rifle's firing wrist reaches -45 / -46 and the shotgun's support wrist 50 / -44.
- The shotgun's trigger finger swings about 60 degrees at the knuckle to reach the trigger (the hand
  runs its fingers up the stock's wrist): it reads as a finger in the guard, but a knuckle does not
  bend that far sideways.
- Rifle aimed 45 degrees down: the gun is pushed 5.6 cm along itself by the clearance check, and the
  face still touches the receiver in Blender's test.
- Broken, found in this review: walking up the 20-degree ramp crouched straight after the
  across-the-ramp row leaves the left heel 1.4 to 3.6 cm into the slope with its sole 8 to 20 degrees
  off (alone it is 0.1 cm and 4 degrees). One run also showed a planted foot 5.2 cm above the ground
  in `turnCarried` (shotgun); repeated runs read 0.2 to 1.0.

## What code and authoring cannot reach

- **Captured motion.** Everything here is authored by hand or by rules. Weight, timing and the small
  irregularities of a real body come from performers; authored cycles stay a little clean and even.
- **Cloth simulation.** The clothes are skinned to the skeleton: they do not hang, fold, swing or
  catch on the gun. Collisions with the clothes are tested against a height field and Blender's
  posed mesh, not simulated.
- **A better rig and character model.** The body has no twist bones, corrective shapes or muscle
  deformation, so elbows, shoulders and wrists pinch at extreme poses; its eye joints are not at the
  eyeball centres; the fingers are three hinged joints with no proper knuckle limits. A rig made for
  shooting (twist joints, a proper hand) and a body modelled for it would remove much of what is
  left in the wrists and the shotgun grip.
- **Recorded sound.** All sound is synthesised in the browser and has not been listened to. Shots,
  footsteps on different surfaces, cloth and gear need recordings.
