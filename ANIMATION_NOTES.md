# Animation quality notes

Working notes for the passes that are raising the character animation towards AAA quality.
Each pass reads this first and appends to the log at the end.

## What the user has said

- "Animations don't feel like AAA." All four areas were named: walk and run; strafe, turn,
  start and stop; aim and fire; reload and swap.
- What is wrong: stiff or robotic; floaty, no weight; jerky or snapping.
- "No human will stay in one position for ever, especially while holding a weapon."
- The walk should feel like a special-forces tactical walk.
- The gun must not pass through the character or the clothes, and the hands must be on it.
  (The user sent a screenshot of the support hand 13 cm off the handguard.)
- Keep it procedural: no new motion capture, no downloads. The only clips are EarthOnline's
  unarmed, in-place, forward-only idle, walk, run and sprint.
- "Make sure you can judge it." Nothing counts as fixed until it has been measured or looked
  at frame by frame.
- "It's not even 8 way path too..." Carried, W/A/S/D turned the body to the way it went, so
  there was no strafing or backing up unless aiming; aimed, side steps were the forward walk
  turned under a chest with the hips twisted about 54 degrees, and left was a reversed walk.
  Wanted: true 8-way movement facing the view at the walk and the jog, aimed or not, with
  real side steps (hips near square, lead foot out, trail foot closing, no crossing).
- "While you are working on it use blender mcp to build the animations instead." From here
  on, animations are built as clips in Blender (authored and edited there, exported as glTF)
  and played by the game, instead of being synthesised at run time. Run-time layers stay for
  what has to react to the moment: hands on the gun, feet on the ground, aiming, inertia,
  fidgets.
- "let's re rig the whole thing into UE5 we will use mannequin for future purpose" (2026-11-11).
  The bodies move to a UE5 Mannequin-style skeleton (`earthonline-ue5-v1`), built by us (no Epic
  files, no downloads), in passes: R1 skeleton and bodies, R2 the Blender clip pipeline and every
  clip, R3 the game code, R4 FBX for Unreal. Spec: `blender/ue5_rig/UE5_SKELETON.md`.

## Blender

- This project has its OWN Blender, with the Blender MCP addon's socket on **port 9877**.
  Talk to it with `python3 blender/tools/bl.py code "..."` or `bl.py run script.py`; start it
  with `blender/tools/launch.sh` and `bl.py wait` if it is not answering.
- **Never use port 9876.** That is another Blender with another session's unsaved work in it.
- Blender is 5.1.2. Sources and generator scripts live in `blender/`; exported clips go to
  `public/characters/`. Everything must be rebuildable from the scripts:
  `python3 blender/tools/bl.py run blender/build_rifle_motion.py` rebuilds the scene, rig,
  clips, review and export (README, "Animation clips"). `bl.py run` defines `__file__`.
- Traps: Blender's IK cannot bend a dead-straight rest chain (the skeleton's legs and arms
  are), so the rig's knees and elbows are pre-bent 5 mm and ORG bones aim the skeleton at the
  rig's joints. The glTF importer gives every skeleton bone the same quarter-turn rest frame,
  so a pose bone's quaternion is the glTF local rotation. The body's `Root` node is a joint:
  the Hips translation is relative to it. Never call `wm.read_factory_settings` or
  `read_homefile` through the addon socket (it loses the context or the server); the build
  clears data blocks instead.
- Motion already owned (no downloads): `public/characters/earthonline-humanoid-motion-pack-v1.glb`
  (captured idle, walk, run, sprint, crouch-idle, combat-idle, aim, reload, hit-react, jump and
  more) and `public/characters/player-weapon-motion-v1.glb` (authored rifle and shotgun holds
  and reloads). EarthOnline's generator for the latter,
  `~/Desktop/Code/EarthOnline/scripts/assets/build-player-weapons-motion.py`,
  shows clips being keyed in Blender 5.1.2 for this skeleton and exported so the game can
  read them (read-only reference).

## How to judge

The preview pane is hidden, so nothing can be watched in real time. Use the review tool
(`src/review.js`), which plays each situation through the real update loop:

- `demo.review()` or `demo.review('walk', 'jog')`: one row of measurements per situation.
- `demo.trace('idle', 30)`: spacing chart of joint paths (one dot per frame). `demo.trace()`
  removes it.
- Film strips: freeze with `demo.timeScale = 0`, step with `demo.advance(seconds)`, look from
  outside with `demo.view = { az, el, dist, y, fov }`, draw with `demo.render()`, and tile
  frames onto a canvas to screenshot.

Add measurements when a defect is not yet measured. A defect the tool cannot see is the
tool's defect too.

## Quality bar

Measured (from `demo.review()`), for both guns. "Last known" is pass 11 (2026-11-11): every
situation once per gun, the noisy rows (startStop, turnAbout, stairsUp, stairsStart, aimHold,
burst) five more times per gun; rifle / shotgun.

| Measure | Target | Last known |
| --- | --- | --- |
| `gripCm` in every carried, moving and aiming situation | at most 1.0 | 0 / 0 (shotgun burstUp support 0.4 to 0.5) |
| `gripCm` during reload | at most 2.5 | 0 / 0 |
| `gripCm` during swap | at most 1.0 | 0 / 0.2 to 0.3 |
| `fingerCm` (pass 11): on each shot the end pad from the trigger / off the trigger the tip from the receiver's side, and how far it points off the barrel | at most 1.5 / 2.0 | fire 0.6 / 0.6; rest 0.8 to 0.9 at 24 to 25 deg / 0.9 to 1.2 at 9 to 14 deg; swap 1.2 / 1.2 (was, solver off: rifle fire 4.4, shotgun about 9 with the finger 46 deg up) |
| `gripCm` / `snap` through a hit reaction (`hitLight`, `hitAimed`, `hitWalk`, `hitHeavy`) | at most 1.0 / 4.0 | 0 / rifle 2.7, 1.3, 2.6, 2.3; shotgun 3.5, 1.8, 3.5, 2.9 |
| eyes (`eyeMoves`, `blinkS`) | alive, not twitchy | 0.5 / 0.7 saccades/s at rest, 1.4 to 2.2 on turns, 4.6 to 4.8 lookAbout; blinks 0.4 to 7.6 s apart, mean 3.5; eyeOutMm 0 |
| `slide` walking and strafing | at most 0.10 m/s | 0 to 0.02 |
| `slide` jogging | at most 0.25 | 0 to 0.06 (jogB) |
| `slide` sprinting | at most 0.35 | 0 |
| `slide` starting and stopping | at most 0.25 | 0 to 0.01 |
| `slide` in an about-turn | at most 0.40 | 0 |
| `stopCm` from the walk (`startStopWalk`): distance / time to under 5 cm/s after letting go | at most 40 cm / 0.45 s | 32 / 0.37; 33 / 0.37 |
| `stopCm` from the jog (`startStop`) | at most 110 cm / 0.6 s | 76 to 101 / 0.43 to 0.48; 79 to 98 / 0.45 to 0.48 |
| `slide` turning on the spot | at most 0.10 | 0 |
| `snap` anywhere but sprint feet and the swap | at most 3.0 m/s | walk directions 1.1 to 2.1 (both); jog directions 1.8 to 2.6, jogR 3.0 / 3.0; walkJog 2.2 / 2.4; startStop 1.8 to 2.4 / 1.8 to 2.1; startStopWalk 2.8 / 1.8 and 3.7 (a foot, one of two runs); turns on the spot 1.3 to 2.2; turnAbout row 3.3 to 3.7 / 3.3 to 3.7 (the sprint's feet before it, exempt; snapUpper 2.1 to 2.3 / 2.6 to 2.8); sprint and jogSprint without the feet 0.9 / 2.4 to 2.6; burstUp 1.2 to 1.9 / 3.1 (support hand) |
| `snap` during the swap (both muzzles followed through it) | at most 4.0 | 3.6 to 3.9 (muzzle) / 2.3 to 2.4 |
| `snap` during reloads | at most 3.0 | 1.0 to 1.8 / 1.6 to 1.8 (walking and jogging included) |
| `frozenPct` idle | at most 8 | 0 / 0 |
| `frozenPct` aim hold | at most 10 | 0 to 8 / 1 to 6 over 6 runs; aimed 45 down 10 / 8 |

Pass R3 (2026-11-11), the Tripo player on `rifle-motion-tripo-v1` through the rig adapter; every
situation once per gun in one sequential run (a `swap*` row hands the other gun to the rows after it,
so "rifle / shotgun" is the gun the run started with), plus repeats where noted. Targets as above.

| Measure | Tripo player now (rifle-start run / shotgun-start run) |
| --- | --- |
| `gripCm` | 0 / 0 in every row except swaps 0.2 (left) |
| `fingerCm` | fire 0.6 to 0.9; rest 0.7 to 1.3 at 13 to 24 deg; swap rest 1.2 |
| `snap` idle / walk / jog / aimHold / burst | 0.7 / 1.9 / 2.1 / 0.9 / 0.6 (shotgun 1.6) |
| `snap` walk, jog, aimed directions | walk 1.3 to 2.1, jog 1.8 to 2.9 (jogR 2.9), aimed 1.1 to 1.8 |
| `snap` sweeps | sweepWalk 1.9 to 2.0, sweepJog 2.6 to 3.1 |
| `snap` startStop / startStopWalk | 2.0 to 2.1 / 1.8 to 2.0; `stopCm` 72 to 75 / 0.42 to 0.43, 29 to 31 / 0.37 to 0.38 |
| `snap` turns on the spot / turnAbout (snapUpper) | 1.2 to 2.1 / 3.5 to 3.9 (2.1 / 2.8) |
| `snap` sprint, jogSprint without feet | 1.2 to 1.7 |
| `snap` reloads | 1.1 to 2.1 |
| `snap` swaps (muzzle) | swap-rifle-shotgun 4.4 to 4.9 (swap, swapJog, swapWalk), swap-shotgun-rifle 2.7 to 3.0; crouchSwap 2.8 to 4.5 |
| `snap` hits light / aimed / walking / heavy | 3.4 to 3.5 / 0.9 / 3.3 to 3.4 / 2.8 to 3.2 |
| `snap` burstUp | 3.1 (support hand) / 1.8 |
| `frozenPct` idle / aimHold | 0 / 1 (12 in one of four runs) |
| `slide` | 0 to 0.04 everywhere (jogB 0.04) |
| `kneeMin`, `gapCm` | kneeMin 16 to 50; gaps ankles 14+ / knees 13+ |
| crouch | head 109 to 115 against standing 150 to 152 (36 to 41 cm lower); crouch rows snap 0.3 to 2.1 |
| ramps, stairs, kerb | rampUp20 3.0 to 3.2, rampDown20 2.0 to 3.3; stairsUp 2.5 to 3.3 (4.9 in one of six runs), sink 0.1 to 1.0; stairsStart 2.6 to 3.0; kerb 1.8 to 1.9; soles 2.5 to 3.6 deg |
| `wristDeg` (left / right: flexion, deviation) | carried firing 26 to 30 / -35 to -37; aimed level -18 to -20 / -22, firing -7 / -8; reloads support -42 / -20, -34 / -25; swap rifle-first firing -35 / +59, support +58 / -48 |
| `cheekCm` (new; eye above the sight line, cm) | level 2.0 to 2.2, 45 up 1.3 to 1.4, 45 down 3.4 to 3.8 (clips' weld: 2.8 / 1.1 / 4.7); face skin in the stock box 0.4 to 2.2 cm (coarse) |
| eyes | `-` (no eye bones or morphs) |

Pass F2 (2026-11-11), the Tripo player after F1's new body GLB (`tripo-player-ue5.glb` 4,267,504 bytes,
18:43; pack `rifle-motion-tripo-v1` unchanged, 16:38): every situation once per gun (run A rifle-first,
run B shotgun-first; the gun each row measured in brackets), plus repeats where noted.

| Measure | F2 (R = rifle, S = shotgun) | R3 |
| --- | --- | --- |
| `gripCm` | 0 / 0 everywhere; swaps with the shotgun outgoing 0.2 (left) | same |
| `fingerCm` | fire R 0.6, S 0.9; rest R 0.7 to 0.9 at 21 to 25 deg, S 1.1 to 1.3 at 13 to 18 deg; swap rest 1.2 | same |
| `cheekCm` eye above / across the sight line (cm), steady aim | R level -0.1 / 0.0, 45 up 0.0 / -0.1, 45 down 0.0 / 0.0; S level -0.6 / -0.8, 45 up -0.3 / -0.2, 45 down 0.0 / 0.1 | R 2.0 to 2.2, 1.3 to 1.4, 3.4 to 3.8 (height only) |
| `cheekCm` skin (deepest head / neck skin inside the gun's mesh, cm) | R level 0.8 to 1.0 (burst 1.6), 45 up 0.0, 45 down 1.1; S 0.2 to 0.4 (butt pad), 45 up 0.0, 45 down 0.9 | R 1.3, 0.0, 1.2 (same measure, R3 values) |
| head cant over the stock | 12 to 13 level, 16 to 17 up, 12 down | 12 / 14 / 12 |
| `snap` idle / walk / jog / aimHold / burst | R 0.6 / 1.8 / 1.9 / 0.9 / 0.9; S 0.7 / 1.8 / 1.9 / 0.7 / 1.6 | 0.7 / 1.9 / 2.1 / 0.9 / 0.6 (S 1.6) |
| `snap` hits light / aimed / walking / heavy | R 2.6 / 2.0 / 2.6 / 2.4; S 3.5 / 1.0 / 3.5 / 3.2 | 3.4 to 3.5 / 0.9 / 3.3 to 3.4 / 2.8 to 3.2 (those were the shotgun) |
| `snap` burstUp | R 1.6 to 1.8, S 3.1 (support hand) | 1.8 / 3.1 |
| `snap` swaps (muzzle) | swap R->S 4.5, swapJog R->S 4.8, swapWalk R->S 4.4; S->R 2.7 to 3.0; crouchSwap R->S 4.5, S->R 2.8 | 4.4 to 4.9; 2.7 to 3.0 (F1's clips) |
| `snap` sprint / jogSprint (feet, exempt) / turnAbout | 3.9 to 4.0 / 3.7 to 3.8 / 3.5 (snapUpper 2.8) | as R3 |
| `snap` startStopWalk | R 1.8, S 4.2 (a foot, one run) | 1.8 to 2.0 |
| `stopCm` jog / walk | 96 to 105 / 0.43 to 0.48; 28 to 35 / 0.37 | 72 to 75; 29 to 31 |
| `frozenPct` idle / aimHold / burst | 0 / 1 to 3 / 8 (R) | 0 / 1 (12 once) |
| ramps, stairs, kerb | rampCrouch20 sink 0.1, sole 3.2 (both); rampUp20 3.1 to 3.2; stairsUp 2.6 to 2.7, sink 0.5; stairsStart 2.8 to 3.2; kerb 1.8 to 1.9; soles 2.0 to 4.7 deg | rampCrouch20 after other rows 3.4 to 5 cm |
| `rampSequence20` (new) | sink 0.5 to 0.7, sole 3.8 to 3.9, snap 4.0 to 4.8 (a foot, crouched turning on the slope) | - |
| crouch | head 109 to 115; crouch rows snap 0.0 to 2.1 | same |
| eyes | `-`; blinkS `-` (no blink morphs in the 18:43 GLB) | `-` |

EarthOnline sample (civilian-m-01-player-ue5 on `rifle-motion-ue5-v1`, rifle): idle 0.6, walk 1.8, jog
1.8, aimHold 0.6 / frozen 1, burst 0.7 / finger fire 0.6, reload 1.0, swap 3.7 (muzzle), crouchIdle 0,
hitLight 3.5; grip 0 / 0 everywhere; wrists as pass 11 (swap firing -45 / -46); eyes: eyeMoves 0.6 at
rest, 2.5 on turns, blinks 0.4 / 3.2 / 7.3 s, eyeLead 17 to 167 ms, eyeOutMm 0. The other three
bodies (aimHold, reload, shotgun): grip 0, finger rest 0.9, frozen 0 to 1, reload 1.7.

Crouch and ground (pass 9; rifle / shotgun; situations in `review.js`, ground in `src/ground.js`):

| Measure | Target | Last known |
| --- | --- | --- |
| crouch depth (`headUpCm` against standing 146 to 148) | head 35 to 45 cm lower | crouchIdle and every crouch walk 111 (35 to 37 cm lower) |
| `snap` crouch rows | at most 3.0 (swap 4.0) | walk directions 1.0 to 1.4 (both); crouchToggle 1.8 / 1.9; crouchAim 0.2 / 0.2; crouchAimWalk 1.2 / 1.8; crouchReload 1.0 / 2.3; crouchSwap 3.7 / 2.3; crouchHit 2.2 / 2.7 |
| `slide` crouch rows | at most 0.03 | 0 to 0.01 |
| `vPop` (hips / head, m/s per frame) | smooth (flat walk is 0.28 to 0.32) | crouch walks 0.12 to 0.19 / 0.15 to 0.22; crouchToggle 0.41 to 0.45 / 0.43 to 0.49; crouch idle 0.02 |
| `frozenPct` crouchIdle / crouchAim | under 10 | 0 / 0 (both) |
| `gripCm` every crouch row | 0 | 0 / 0 (crouchSwap shotgun 0.2) |
| `pushCm` crouch rows | small | 0 to 1.5 / 0 |
| `sinkCm` / `floatCm` ramps and kerb | at most 1 / 1 | sink 0 to 0.1, float 0.1 to 1.0 (rampUp20 1.0); EXCEPT rampCrouch20 run straight after rampAcross20: sink 1.4 to 3.6 (left heel held at z 27.9, about 2.2 s) |
| `soleDeg` | at most 6 | 0 to 4.3; EXCEPT rampCrouch20 after rampAcross20: 5 to 20 (alone or after other rows: 3.6 to 4.3) |
| `snap` ramps / kerb | at most 3.0 | ramps 1.8 to 3.2 (rampUp20 3.2 / 3.2, a foot); kerb 1.9 / 1.8 |
| `snap` / `sinkCm` stairs | at most 3.5 / 1 | stairsUp 2.5 to 3.3 / 2.2 to 3.3, sink 0.5 to 1.0 / 0.1 to 1.2; stairsStart 2.4 to 3.9 / 2.6 to 3.4, sink 0.1 to 0.7, knee gap 6 to 21 (2 of 6 runs under 11) / 17 to 22; stairsDown 2.5 / 2.2, sink 0.1 |
| `slide` ramps, stairs, kerb | at most 0.03 | 0 to 0.02 |
| `leanDeg` uphill / flat / downhill | into the hill, back going down | rampUp20 9.6 to 9.7, walk 5.3, rampDown20 2.5 |

Per direction (`walkF` ... `walkFR`, `jogF` ... `jogFR`, `aimF` ... `aimFR`, `sweepWalk`,
`sweepJog`), both guns:

| Measure | Target | Last known |
| --- | --- | --- |
| `slide` at the walk and aimed, every direction | at most 0.10 | 0 to 0.02 |
| `slide` at the jog, every direction | at most 0.25 | 0 to 0.06 |
| `slide` sweeping round all eight | walk 0.10, jog 0.25 | 0.01 / 0.02 |
| `snap` steady directions | at most 3.0 | walk 1.3 to 2.1, aimed 1.1 to 1.8; jog 1.8 to 2.6, jogR 3.0 / 3.0 |
| `snap` sweeping round all eight | at most 3.0 | walk 1.9 to 2.0; jog 2.8 to 2.9 |
| `kneeMin` everywhere | at least 12 | 16 (rampUp10, rampUp20) to 51; walk 23 to 30; jog 20 to 22, side shuffle 46 to 51 |
| `varyMm` steady walking and jogging | above about 3 | walk 3.4 to 6.4, jog 3.8 to 7.8 (jogB 17 to 18), side shuffle 2.6 to 5 |
| `leanDeg` backing up against going forward | upright or back | carried walk 0.7 against 5.3, jog 4.3 to 4.5 against 9.4 to 9.5, sprint 15.4 to 15.6; aimed -2.1 against 3.9 |
| `gapCm` ankles / knees | at least 11 (no overlap) | steady directions 17 to 33 / 19 to 31; sweepWalk 14 / 15; sweepJog 14 to 16 / 12; turns on the spot 23 to 29 / 19 to 24; turnAbout 12 to 18 / 22 to 23 |
| `twistDeg` added by direction (over `aimF`'s 35, the stance's own) | at most 25 | 0 to 3 (aimed directions 28 to 38) |
| `gripCm` | at most 1.0 | 0 / 0 |
| `pushCm` carried at the walk and standing (the clips' hold needs no help) | near 0 | rifle walk 0 to 2.3, idle 0.4 (other bodies 1.6 to 4.4), jog 0.2 to 3.4, sprint 0; shotgun 0 to 0.1 |
| `wristDeg` firing / support wrist, flexion / deviation | within 45 / 30 | carried firing rifle 20 to 30 / -30 to -37, shotgun -17 to -27 / -28 to -39; aimed level firing -11 / -19 (rifle), -13 / -17 (shotgun), support -25 / -23, -28 / -23; burst support -45 / -25, -33 / -25 (shotgun firing -35 / -27); reloads support -45 / -23, -33 / -25; swap rifle firing -45 / -46, shotgun support 50 / -44, firing -33 / -43 |

Seen frame by frame (film strips and traces), nothing below should be visible:

- knees popping, locking straight or bending sideways; feet sinking, floating or turning
  with the body while planted; steps with no heel-to-toe roll
- hips and shoulders moving as one block; no counter-rotation; no weight coming down on a
  footfall; a body that starts or stops without leaning or settling
- wrists bent past what a wrist does; elbows flaring or flipping; fingers not wrapping the
  gun; a hand off the gun
- the gun passing through the chest, clothes, arms or legs
- hands or gun travelling in straight lines at constant speed; actions with no anticipation,
  overshoot or settle
- any pose held without change; fidgets that repeat on an obvious rhythm
- anything that pops, twitches or changes direction in a single frame

## Log

- Before the passes (2026-11-10): baseline as in the table above. Known weak spots: sprint
  and jog foot slide, about-turn skating, the swap (hands and snap), start/stop foot snap.
- Locomotion and 8-way pass (2026-11-10). Changed `player.js` (face the view at the walk and
  jog, aimed or not; only Shift runs face the way of travel; pace 75 % sideways and 75 %
  backing up, on an ellipse between; standing with the gun carried the body turns after the
  view only past about 50 degrees), `character.js` (step laid along the travel while feet,
  knees and pelvis stay near square: at most 24 / 14 degrees on a diagonal, square going
  straight sideways or back; quick short side steps on a wider base with a low swing; feet
  held on the ground through each stance from a contact curve and let go from standing
  still; a foot in the air pushed aside rather than passing through the other; soft leg IK;
  the forward/backward clip switch carries the feet across), `motion.js` (contact curves and
  mean foot offset measured per clip; Catmull-Rom sampling between the 30 fps captured
  frames) and `review.js` (measures `footTurn`, `kneeMin`, `kneePop`, `hipsDeg`,
  `counterDeg`, `twistDeg`, `gapCm`, `varyMm`; 24 direction situations and two direction
  sweeps; `turnAbout` now holds Shift, since a carried jog no longer turns round). Before ->
  after, rifle (ranges are over repeated runs):
  - walk slide 0.07, snap 1.7 -> 0.04, 1.3
  - jog slide 0.35, snap 1.8 -> 0.11, 1.6
  - sprint slide 0.68, snap 3.2 -> 0.22 to 0.25, 2.9 to 4.5 (sprint feet are exempt)
  - strafeLeft / strafeRight (aimed) slide 0.06, twist 36 -> 0.03 to 0.05, twist 25
  - backUp slide 0.06 -> 0.07
  - startStop slide 0.20 to 0.27, snap 3.6 to 4.8 -> 0.06 to 0.22, 2.1 to 3.7
  - turnAbout slide 0.85, snap 2.6 (then a jog reversal; now a Shift run reversal) -> 0.24
    to 0.30, 4.2 to 5
  - carried walk directions: before, all of them turned the body to the travel; after, the
    body faces the view, slide 0.03 to 0.06, snap 1.1 to 2.6
  - aimed diagonals twist 53 (FL, BR) -> 39 to 40, of which 26 is the rifle stance itself
  - sweepWalk slide 0.23, snap 4.9, knees down to 8 cm -> 0.06 to 0.08, 3.2 to 4.6, knees 7 to 15
  - sweepJog slide 1.17, snap 2.4 -> 0.12 to 0.14, 4.9 to 7.4
  Still open: the jogged side step jolts about 5 m/s where each foot lands and leaves (a
  2.7 m/s shuffle at 4 steps a second); the direction sweeps still jolt and the knees can
  brush (`gapCm` knee 3 to 7) while the step swings round; the about-turn jolts 4 to 5 m/s
  (was 2.6); knees reach full stretch for an instant in the jog, side steps and turns
  (`kneeMin` 5); every stride is still the same (`varyMm` 0.6 to 8); backing up keeps the
  carry's slight forward lean; the shotgun's carried support hand drifts up to 1.8 cm off at
  random, as it did before this pass.
- Follow-up locomotion pass (2026-11-10). Causes found, frame by frame (commanded foot target
  against what IK delivered): the IK delivered what it was told; the targets themselves jolted.
  - Jogged side step: the forward clip laid sideways carries the trailing foot across the
    leading one, and the push-aside stopped it dead 15 cm short in mid-air at 5 to 6 m/s
    closing speed (the whole jolt in one frame). Now the feet are set apart by as much as the
    step is long (`motion.js` measures each clip's fore-aft `spread` and `width`), so the
    trailing foot closes up at the end of its own swing. Side pace 75 % -> 60 % (each cycle
    the feet open as wide as the ground covered), the walk's side cadence 2 -> 2.5 times the
    clip's, the gait chosen by effort (speed over pace) so a jogged side step is the run clip,
    not a walk/run blend whose feet go down at different moments.
  - Direction changes: (a) at a back-diagonal flip the clip advanced a frame the old way
    before the flip (the direction is now settled first) and a foot in the air lost a frame
    of motion (now carried on at its speed); (b) left-right and forward-back reversals swung
    the step round through every direction with a foot in the air (now laid the other way at
    once; playing direction eased through zero when there is no flip); (c) the gait weights
    followed the speed through zero in a reversal and the swing collapsed and sprang back
    (effort eased); (d) the side-step shape, stride length and push-aside jumped with the
    heading (eased; the push looks 0.03 s ahead and eases out quickly instead of snapping).
  - About-turn: a sprint's back-kicked foot was stretched out of reach by stride warping and
    pinned by a narrow soft-IK band, then let go all at once (stride warping now fades out
    for a foot high in its swing; a swinging foot falls short from 88 % of the leg); a run's
    passing feet were pushed apart in 3 frames (faded over 55 cm fore and aft).
  - Straight knees: legs on the ground now never pass 97.8 % of their length: the heel rolls
    up onto the ball (pivoting on the held ball, toes flat) and the hips sink (at most 6 cm);
    a foot in the air bends its knee instead (soft IK to 99 %).
  - Also fixed: feet stuck far behind at slow aimed side steps (the idle share of the blend
    counted as ground contact; contact is now the gait clips' own), a foot let go by reach
    being caught again every frame (it waits for the next step and is picked up, not
    dragged), toes and heels scraping through the floor (backed-up swing; toe/heel clearance
    eased in and out), a NaN at a standstill reversal.
  - Variation: each footfall picks, at random, the next step's length (+-5 %, made up in
    cadence), foot placement (+-1.2 cm), shoulder turn, trunk tip and nod, hip sway and
    footfall weight (+-20 to 30 %), each eased over 0.3 s.
  - Backing up: the trunk turns back out of the carry's lean (carried 7.7 -> 2.1 degrees of
    chest lean, aimed 13.5 -> 7.9) and the hips sit back 3 cm. Stopping: a foot still in the
    air carries on into its stance place (a settling step) instead of freezing.
  - Shotgun: the pump hold now includes the carry's slide along the gun, which the reach was
    judged with, and the slide search tests the end of its travel; the palm stays on.
  - Measures, changed in the open: `slide` judged "on the ground" from the minimum the ankle
    happened to reach in the run plus 6 mm; a dip to the ankle clamp left a handful of frames
    counted (sweepJog: 13 of 1080) and missed real scraping (backing up: toes 2.7 cm into the
    floor at 3 m/s, invisible to it). It now uses the ground's height and the part of the
    foot that is down (back of the heel or ball, the lower, within 8 mm), so a heel rolling
    off its ball is not counted as the heel sliding. New `leanDeg` (chest lean) and `rollDeg`
    (heel-to-toe roll). Old `slide` numbers on the new code, for comparison: walk 0.04 to
    0.09, jog 0.11, sprint 0.29 to 0.30, start/stop 0.08 to 0.10, about-turn 0.16 to 0.17,
    jog sideways 0.15 to 0.18, jogB 0.24 to 0.27.
  Before -> after (rifle; shotgun in brackets where different; ranges over 3 runs):
  - jogL / jogR snap 4.9 / 5.0 to 5.1, kneeMin 5 -> 1.6 to 2.1 / 2.2 to 2.3, kneeMin 23 to 37
  - sweepWalk snap 3.6 to 4.6 (3.2 to 3.7), gaps 7 / 12 -> 1.7 to 2.4 (1.8 to 1.9), gaps 10 / 12
  - sweepJog snap 6.1 to 6.6 (4.6 to 4.9), gaps 11 / 7 (12 / 4) -> 2.8 to 2.9 (3.0 to 3.8),
    gaps 17 / 17 (12 / 10)
  - turnAbout snap 4.2 to 5.5 (3.8 to 4.7), footTurn 120 to 151, twist 56 to 60, knees 8 ->
    3.1 to 3.4 (3.8 to 4.2), footTurn 119 to 128, twist 52 to 58, knees 9 (8 to 9)
  - startStop snap 2.7 to 4.4 -> 2.6 to 3.1 (2.9 to 3.4)
  - kneeMin 5 (jog 7, side steps, turns, sweeps) -> at least 16 everywhere
  - varyMm walk 2.4 to 2.9, side steps 0.6 to 0.9, jog 6 -> 4.7 to 5.1, 2.4 to 6, 6.5 to 9.2
  - gripCm shotgun carried 0 to 1.8, aim on/off 1.5, reload 3.1 -> 0 to 0.7, 0.7, 2.1
  Still open: the about-turn and the jogged sweep still jolt 3 to 4 m/s where a foot is caught
  still moving (the clip's foot is not at rest when it lands while the speed is changing
  fast); the about-turn's knees pass 7 to 10 cm apart; `frozenPct` at rest is random and its
  upper tail passes the bar (idle 4 to 11, aim hold 3 to 12 over many runs, as the shotgun's
  was before); the rifle's support palm now and then shows 0.1 to 0.8 cm in carried rows (was
  0); there is no deliberate weight shift before the first step, and no extra pelvis drop
  beyond the clip's (`hipsDeg` roll 4.5 at the walk); the jogged side step is wide (feet up
  to about 0.9 m apart in its flight).
- Blender clips pass (2026-11-10). Standing and walking now come from clips built in Blender:
  `public/characters/rifle-motion-v1.glb` (+ `.json`), made by `blender/build_rifle_motion.py`
  and `blender/rifle_motion/` (control rig with leg IK, foot controls and heel roll, arm IK onto
  targets on the rifle bone, pelvis and chest controls; keys baked to plain local rotations on
  the 56 joints at 30 fps; glTF export trimmed to rotations and the Hips translation and checked
  sample by sample). Clips: `rifle-idle` (8 s: two breaths, a weight shift onto each leg, the
  head looking about) and `rifle-walk-f/-fl/-l/-bl/-b/-br/-r/-fr`, each its own cycle at the
  game's speed for that way: forward 1.45 m/s in 0.8 s cycles, forward diagonals 1.05 m/s
  0.7 s, sideways 0.87 m/s 0.57 s, back diagonals 0.96 m/s 0.73 s, back 1.09 m/s 0.83 s. A
  foot on the ground is carried back at exactly the ground speed, a swinging foot follows a
  minimum-jerk path, heel strike and toe-off forward, ball first and heel last back, flat side
  steps that never cross, the hips lowered wherever a stance leg would straighten; the pelvis
  drops on each footfall, shifts and rolls over the standing leg and turns with the stride, the
  chest counter-turns, the head stays level, the rifle trails the chest by a few hundredths of
  a second. The captured walk is not used: forward only, unarmed and upright, it would have to
  be rebuilt for every direction anyway. Round trip: the exported file played by plain FK
  against Blender's skeleton, worst joint 0.1 mm; loaded by the game (`motion.js`), 0.06 mm.
  Blender-side numbers (`blender/review/clips.txt`; slide mean / worst frame, m/s):
  - idle: slide 0, kneeMin 20, ankles / knees 32 / 28 cm, palms 0.2 / 0 cm, seam 0.87 / 0.88
  - walk F: slide 0.015 / 0.22, kneeMin 29, 21 / 24 cm, palms 0.2 / 0, seam 0.26 / 0.14, toe clearance 3.0 / heel 1.0 cm
  - FL / FR: 0.012 / 0.23, kneeMin 28, 19 / 16 cm, palms 0.2-0.3 / 0
  - L / R: 0.021 / 0.30, kneeMin 28, 19 / 23 cm, palms 0.2-0.6 / 0
  - BL / BR: 0.001 / 0.01, kneeMin 28, 20 / 17 cm, palms 0.2-0.3 / 0
  - B: 0.007 / 0.18, kneeMin 27, 18 / 23 cm, palms 0.4 / 0
  - rifle against the posed, skinned body (BVH, butt pad and hands left out): 0 overlapping
    triangles in every clip, with the rifle stood 5 to 6 cm further off the chest than the
    game's low-ready rule; at the rule's own place it goes 1500 to 1700 triangle pairs into the
    chest and right upper arm (the game's height-field clearance pushes it out at run time).
  Game (`character.js`): at the walk the two direction clips either side of the way of travel
  are blended (eased per clip, all in step at the left foot's landing) instead of laying the
  forward clip along the travel; standing comes from `rifle-idle` (feet where it stands them,
  wider when shouldered); the carried upper body standing and walking is the clips' own spine.
  Removed as doubled or dead: the walk's GLIDE (drop, bob and sway cut, narrow feet, low lift),
  the walk's side and back quickening, the runtime footfall twist/tip/nod and hips drop on the
  carried walk, the stance hip drop and set-back, the mocap idle and walk. Kept: foot holding
  and soft leg IK, hands solved on the gun, aim layer, inertia, fidgets, the run and sprint as
  they were. Also fixed: two aliasing `slerpQuaternions(a, this, t)` calls (one pre-existing:
  planted feet never took their stance heading); any change of blend (idle to walk, a new
  direction, walk to jog) no longer jumps a swinging foot's target (it is carried on and
  closes); the gait effort rises faster (0.06 s) so setting off does not overdrive the walk,
  and falls slowly while still moving (0.4 s) so a jog reversal does not drop into the walk;
  the upper body's walk/run share is eased (0.2 s).
  Before -> after, rifle (shotgun in brackets where different):
  - walk directions: slide 0 to 0.06 -> 0 to 0.03; snap 1.0 to 1.4 -> 1.2 to 1.6; footTurn 7 to
    51 deg/s -> 0.1 to 0.7; kneeMin 40 to 47 -> 18 to 32 (knees no longer held deep throughout);
    gaps 12 / 19 to 31 / 35 -> 16 / 15 to 25 / 22; leanDeg F 7.6, B 2.2 -> F 12.2, B 6.4
  - aimed directions: slide 0.02 to 0.09 -> 0 to 0.02; snap 0.8 to 1.2 -> 0.9 to 1.2
  - sweepWalk: snap 2.5 (1.4), gaps 10 / 12 (11 / 18) -> 1.4 to 2.7 (1.8 to 1.9), 13 / 11 to 15 / 13
  - startStop: snap 2.6 (2.5) -> 2.0 to 2.8 (2.0 to 2.5), worst of many runs 3.4
  - turnAbout: snap 3.6 (3.5), knee gap 10 (12) -> 2.9 to 3.5, knee gap 6 to 10
  - sweepJog: snap 2.9 (3.5), gaps 18 / 18 (11 / 16) -> 2.6 to 4.2 (2.6 to 3.9), gaps 11 / 8 to 19 / 19
  - idle: frozenPct 5 -> 0 to 5; aimHold 5 to 8 -> 2 to 5; gripCm and the reload / swap rows unchanged
  - jog and sprint rows: unchanged within run-to-run spread
  Still open: in the Blender sheets the low-ready carry, stood 5 cm off the chest, puts both
  arms well forward (elbows not tucked) — the game re-solves the arms on its own carry, but the
  carry itself is the thing to fix; the walk's trunk is quiet (4 deg of counter-turn, about 1 cm
  of footfall drop) and every cycle is the same apart from the runtime variation (varyMm 2 to
  5); side steps look straight-legged from the front in the wide phase; the forward walk rides
  6 cm lower than the idle (its 0.58 m steps need it); the jogged sweep and the about-turn are
  a little noisier than before (knees down to 6 cm in the about-turn); the jog set is not built.
- Carry and walk quality pass (2026-11-10). The user's four findings from the Blender sheets
  were all real: the low ready held the rifle out at arm's length (the game's rule put the butt
  14 cm in front of the shoulder and Blender stood it 5 to 6 cm further off to clear the chest,
  so both arms were nearly straight); the forward walk crouched (hips 0.841 to 0.865 against the
  idle's 0.90, 0.58 m steps on 30 degrees of knee); the side step opened to about 0.68 m (by its
  parameters: 0.44 m apart plus a 0.49 m stride) on straight legs; the trunk was nearly rigid
  and every cycle the same.
  - The carry is authored, not a rule. `blender/rifle_motion/carry.py` has two holds, each the
    butt's place and the gun's turn in the chest joint's frame: low ready (butt in the pocket,
    muzzle 33 degrees down and 25 across, firing elbow down at the ribs, the gun close to the
    chest) and high ready (14 degrees down). They were found by grid search on the rig against
    the BVH test and the arm and wrist angles, with the trunk shaped round them (bladed 20 to 24
    degrees, support collarbone drawn 22 degrees forward). Every clip exports a `Gun` node
    (child of Spine2, translation = butt, rotation = turn) beside the 56 joint tracks, and two
    one-frame clips `rifle-hold-low` / `-high` replace EarthOnline's hold-rifle-low/-hip in the
    game (running upper body and the high ready's difference). The game (`motion.js`) blends the
    Gun track like a joint, fills the captured run and sprint with the low hold's gun, and
    `Weapon.place` puts the gun exactly there; sprint and first person keep their rules.
  - Wrists: the game's firing-hand grip turn, measured on the rig, bent the wrist about 70
    degrees towards the little finger at the low ready (and at aim). Carried, the hand is now
    turned 35 degrees about its palm (`HAND.gripCarry`), blended back to the aiming grip as the
    gun comes up: wrist 20 degrees flexion, 32 deviation. Aim is unchanged (still about 70: next
    pass).
  - Shotgun, on the same track: its grip on the wrist of a deep straight stock put the forearm
    through the stock (2,300 triangle pairs) and the upper arm against the toe. Carried, its
    palm sits 4 cm round the stock's wrist (2 cm aimed), its firing elbow points out to the side
    (pole -1, -0.3, -0.2 instead of -0.45, -0.85, -0.25), the support hand holds the back of the
    pump (12 cm behind grip_support), and the butt sits 1.5 cm in, 1 cm lower and 2 cm further
    off the chest (`shotgun.js` CARRY_*; `carry.GUNS`). The reach slide is now counted from
    grip_support including the carried slide, so the hand never leaves the pump.
  - Clearance: run-time push and reach are a safety net. Carried, `Weapon.place` only pushes for
    what moved the gun from the clips' hold (fidgets, inertia, run-time body layers), since the
    height-field test (box corners against a dilated rest-pose field) wants 1 to 2 cm even where
    the BVH shows 1.5 to 2 cm of air. `alive.js`'s carry variants are smaller (at most 0.1 rad)
    and each is checked in Blender on the posed body (1.0 to 2.0 cm clear, both guns).
  - Walk (`gait.py`): hips designed at the idle's height less 0.8 cm, lowered further only where
    a standing leg passes the game's BENT_REACH (so the game never lowers them again); forward
    steps 0.50 m at 2.9 a second, side steps 5 a second opening from hip width to about half a
    metre, diagonals between (3.9 and 3.5 a second), back 0.40 m. Each clip is three strides
    (`cycles` in the JSON; `motion.js` plays a clip's phase over that many), each step jittered
    (timing 4 %, reach 5 %, placement 8 mm, pelvis swing 20 %, footfall weight 25 %, shoulder
    counter-turn 20 %), each foot's stances listed in the JSON. The pelvis turns 6 degrees with
    the stride, drops 4 on the swinging side and shifts 2 cm over the standing leg; the shoulders
    turn 2.5 degrees the other way in the world; the weight comes down 1.2 cm on each footfall
    with a small nod; the trunk leans 5 degrees going forward and 0.5 backing up.
  - Idle: re-authored round the new trunk; three breaths in 8 s; the gun dips with each breath
    out, drifts across and back and sinks a touch when the weight is on the back leg.
  - Review: `review.py` adds hip height against the idle, widest ankles (apart / across), elbow
    bend and how far out each elbow is, wrist flexion and deviation, and the gun's clearance (the
    body blown up by 0.5 to 3 cm until it touches; butt pad face and the hands excluded, and at
    more than 0 cm each forearm against what its hand holds). `review.js` gains `pushCm`.
  Blender numbers, before -> after (rifle; shotgun in brackets):
  - idle: hips 0.898..0.901 -> 0.893..0.896; rifle 0 hits only with 5 cm stand-off (1,571 pairs
    at the rule's place) -> 0 hits, 1.5 cm clear at the authored hold (1.5); elbows (bend, left /
    right) 45..53 / 108..112 (43..51 / 96..98); wrists at worst flex 21, dev -32 (-21, -32)
  - holds: low 2.0 cm clear, elbows 52 / 111, elbows out 5 / 7 cm; high 2.0 cm, 46 / 103
    (low 1.5, 49 / 97, out 6 / 9; high 3.0)
  - walk F: hips 0.841..0.865 -> 0.862..0.882 (mean 1.9 cm under the idle); steps 0.58 -> 0.50
    m; slide 0.015 / 0.22 -> 0.010 / 0.18 m/s; kneeMin 29 -> 25; gun 0 hits only at 5 cm
    stand-off -> 2.0 cm clear (1.5)
  - L / R: widest ankles about 0.68 -> 0.53 m, closest 19 -> 17 cm; hips 0.846..0.890 ->
    0.868..0.890 (1.3 to 1.5 under the idle); slide 0.021 / 0.30 -> 0.045 / 0.41 (0.039 / 0.29),
    the ball-first landing of 5 steps a second counted while it rolls; kneeMin 28 -> 27 to 29
  - FL / FR / BL / BR: hips 1.2 to 1.4 cm under the idle; widest 53 / 50 cm; slide 0.001 to
    0.012 -> 0.013 to 0.023 mean; kneeMin 28; clear 1.5 cm
  - B: hips 0.850..0.886 -> 0.862..0.890; slide 0.007 / 0.18 -> 0.010 / 0.27; clear 1.5 cm
  - every clip: palms 0.2 to 0.5 / 0 cm off -> 0 / 0; round trip 0.09 mm
  Game, before -> after (rifle; shotgun in brackets where different):
  - carried walk directions: pushCm 3.9 to 8.1 (0 to 2.2) -> 0.1 to 0.4 (0 to 1.8); turnDeg 0 to 8
    -> 0; leanDeg F 12.3, B 6.4 -> 5.4, 0.7; counterDeg 9 to 15 -> 3 to 21; hipsDeg F 8 / 5.8 ->
    13.5 / 8.6; varyMm 2.8 to 4.3 -> 3.6 to 8.3; slide 0 to 0.03 -> 0 to 0.03; snap 1.2 to 1.5 ->
    1.3 to 2.2; kneeMin 19 to 29 -> 23 to 29; gaps 17+ / 15+ -> 17+ / 19+
  - idle: pushCm 6.9 (1.3) -> 0.2 to 2.8 (0 to 0.4); turnDeg 8 (7) -> 0; muzzle wander 33 / 22 / 20 cm (the
    big carry fidgets) -> 22 / 7 / 7; frozenPct 0 (1) -> 0 (0)
  - jog rows: pushCm 5 to 17 -> 0 to 4.8; turnDeg 9 to 19 -> 0
  - reload gripCm 1.4 (2.2) -> 0 (0); swap 9 (18.9) -> 0 (0)
  - sweepWalk snap 1.4 to 2.7 -> 1.9 to 2.0, gaps 13 / 11 -> 14 / 15; sweepJog snap 2.6 to 4.2 ->
    2.8 to 4.4, knee gap 8 to 19 -> 9 to 17 (as before: the jog side of it, unchanged clips)
  - startStop snap 2.0 to 2.8 (worst of many 3.4) -> 2.0 to 2.7, but 3.5 and 3.7 in 2 of 15
    runs (a foot, as the jog stops); not traced
  - aimed rows, about-turn, sprint, burst: within their earlier spread
  Still open: the rifle's grip_support is 59 cm along the gun, so the support elbow bends only
  about 50 degrees at the low ready and points forward and down rather than tucking to the
  ribs; the aiming firing wrist is still bent about 70 degrees (the aim grip turn, unchanged);
  the shotgun's firing elbow is out about 10 cm; from the front the widest side step still reads
  as a narrow inverted V (the knees bend forward, not outward); the Blender slide measure counts
  the quick side steps' rolling landings (0.04 mean); the jogged sweep and the about-turn still
  pass 3 m/s and bring the knees within 9 cm; the jog set (`rifle-jog-*`) is not built.
- Review tool fix (2026-11-10, main session). `reload` and `swap` used to be triggered during
  the settling time before the measured window (and the swap twice), so those rows read
  better than they were. They now fire at the start of the measured window. True numbers
  after the carry pass: reload `gripCm` 0 / 0, `snap` 1.1 (rifle) and 2.8 (shotgun); swap
  `gripCm` 0 / 0 but `snap` 13 to 14 m/s at the muzzle with both guns: the gun pops during
  the swap. The shotgun's reload row only measures a reload if shells have been fired first.
- Jog, sprint and aim-grip pass (2026-11-10). Every gait is now an authored clip; the captured
  run and sprint are no longer played.
  - Blender (`gait.py`): the walk's generator became `Author.cycle(spec)`, which also makes runs:
    a spec with `kick` has each foot on the ground for about a third of its cycle (a flight
    between steps), a swing that kicks the heel up behind and carries the foot forward over the
    ground at a nearly even speed (`glide`: min-jerk's peak speed had left the foot standing over
    the ground at either end, so in the body's frame it swung 0.2 m past where it lands and
    leaves), a swing foot that is lifted rather than the hips lowered where the leg could not
    reach it (the hips were driven down to 0.62 m by the swinging leg otherwise), hips lowest
    mid-stance and highest in the flight, a forward pelvis tilt, a counter-turning chest and the
    gun rocked by the arms with each step (`pump`, offsets on the hold). Per-foot stance shares
    and an uneven rhythm (`split`, `trail`) make the side shuffle: the trailing foot lands a
    quarter of a cycle after the leading one and both are then in the air, so the feet open by
    less than the ground covered. The knee poles moved from 0.6 m to 1.2 m ahead (a foot kicked up
    behind bent its knee out to the side); the walks are unchanged by it within 0.5 cm of knee gap.
    Clips: `rifle-jog-f/-fl/-l/-bl/-b/-br/-r/-fr` and `rifle-sprint`, three strides each. The
    forward jog is authored, not the capture (the capture is forward only, unarmed and upright).
  - The carry (`carry.py`): a third hold, `sprint`, the low ready pulled in tight (butt 4 cm
    further across and 2 cm closer, 50 degrees across, 35 down, on a squarer trunk). A high port
    was searched first (648 places): with the hands held on the gun as the other holds hold
    them, the best kept the wrists at 40 to 50 degrees and still touched the body. The rifle's
    support palm now holds the handguard 6 cm behind `grip_support` (its back end is 13 cm
    behind, the magazine well 10): the support elbow bends 68 to 76 degrees at the low ready
    (was 45 to 53), wrist within 12 degrees, clearance unchanged, gripCm 0.
  - Game (`character.js`, `motion.js`): the jog is blended by direction like the walk (one set
    of direction weights for both, so walk and jog stay in step), the sprint from its clip;
    running (Shift) the body turns to its travel, the sprint's share passes to the jog clips while
    the way of travel is off straight ahead, and the legs use clips no further round than the
    diagonals (a side shuffle's closing foot was trodden on by a turning body: ankle gap 6 cm).
    Removed as dead: laying the forward run along the travel (legYaw, face, backward play, flips,
    side widening, low side swing, knees out, pelvis squaring, back-hips, run quickening), the
    captured run and sprint and their measuring, `_withGun`, `_centre`, the run's upper body
    (CARRY_MASK, UPRIGHT, CARRY_LEAN, the steady hold), the run's footfall hip drop, the
    sprint carry rule and its stride swing (`weapon.js`, `main.js`). The rest skeleton is read
    from `rifle-motion-v1.glb`. Kept: foot holding, soft leg IK, stride warping (to 1.3 at a run),
    push-aside, inertia, fidgets, aim layers.
  - Aim grip: measured in the game (new `wristDeg` column, the same formula as `review.py`). The
    rifle's firing hand is turned 35 degrees about its palm shouldered too (the carried grip):
    wrist -34 / -59 -> -19 / -13. The shotgun's shouldered hand runs its fingers up along the
    rising forearm: -110 / -103 -> -24 / -14. Support wrist shouldered -30 / -26 (unchanged).
  - Fixed: a NaN that took the whole body after a long stop following a run: the gait's share
    eases towards nothing and blended weights went denormal, then were divided by (`_each` skips
    shares under 1e-6; the stretch needs 1e-4 of gait).
  - Review: `wristDeg`, `snapUpper` (snap without the feet), situations `walkJog` and `jogSprint`.
  Blender numbers (`blender/review/clips.txt`; slide mean / worst frame m/s, counted at the
  30 fps frames either side of landing, which the game's held feet do not show):
  - jog F: 3.6 m/s, 3.0 steps/s of 1.2 m; hips 0.832..0.857 (5 cm under the idle); kneeMin 22.5;
    ankles / knees 25 / 26 cm; widest feet 94 cm fore-aft; slide 0.10 / 1.04; seam 0.86 / 0.83;
    elbows support 57..82, firing 108..113; wrists support -12 / +8, firing +25 / -33; gun 1.5 cm clear
  - jog FL / FR: 2.62 m/s; kneeMin 24; gaps 21-22 / 12-13; hips 0.83..0.88; slide 0.07-0.08 / 0.6
  - jog L / R (shuffle): 2.16 m/s, 6 steps/s; feet 25 to 61-64 cm apart; kneeMin 40 to 43 (never
    straight), hips 0.809..0.824 (8 cm under the idle: athletic); gaps 25 / 33; slide 0.13-0.14 / 0.7-0.9
  - jog BL / BR: 2.39 m/s; kneeMin 17 to 20; gaps 20-21 / 15; slide 0.05-0.06 / 0.5-0.6
  - jog B: 2.7 m/s backpedal, 3.9 steps/s; kneeMin 13.6; gaps 20 / 24; slide 0.08 / 0.82
  - sprint: 5.2 m/s, 3.5 steps/s of 1.5 m, leaning 15; hips 0.79..0.84; kneeMin 21; gaps 30 / 25;
    support elbow 36..79, firing 105..116; wrists support -12 / +14, firing +27 / -31; gun 0.5 cm clear
  - every jog: gripCm 0 / 0, gun 0 hits and 1.5 cm clear; round trip 0.09 mm
  Game before -> after, rifle (shotgun in brackets; ranges over 2 to 3 runs):
  - jogF snap 1.9 (1.6) -> 1.8 to 2.0 (1.8); jogL 1.7 (1.7) -> 2.5 to 2.6 (2.4 to 2.6), kneeMin 37 ->
    45 to 49; jogR 2.2 (2.2) -> 2.8 to 3.1 (2.8 to 2.9); jogB 2.5 (2.5) -> 2.4 to 2.5 (2.5), slide
    0.03 -> 0.05 to 0.06; diagonals 1.4 to 2.1 (1.5) -> 1.9 to 2.2 (1.9 to 2.2), knee gaps 23 to 32
    -> 13 to 15; jog 2.0 -> 1.8 to 2.1; pushCm jog 0 to 1.3 -> 0 to 3.5 (0)
  - sprint snap 2.8 (2.9), pushCm 9.1 (4.3) -> feet 3.8 to 4.1 (4.0), without them 0.8 to 0.9 (2.7),
    pushCm 0 (0); lean 20.9 -> 15.5
  - sweepJog 2.8, gaps 15 / 13 (4.0, 12 / 18) -> 2.7 to 3.2, gaps 13 to 15 / 12 to 14 (2.6, 16 to 17 / 11 to 12)
  - turnAbout 3.7, gaps 22 / 10, push 9.1 (3.1, 29 / 9) -> 3.5 to 4.3, gaps 10 to 12 / 8 to 17,
    push 0 to 2.1 (3.6 to 4.5, 10 / 10 to 12)
  - startStop 2.2 (2.3) -> 2.3 to 2.7 (1.8 to 3.1); new walkJog 2.2 to 2.4 (2.3 to 2.6), jogSprint
    feet 3.3 to 3.8, without them 0.9 (2.3 to 2.6)
  - walk, aimed, idle, reload rows: within their earlier spread; idle frozenPct 0, aimHold 2 to 8
  Still open, looked at in the sheets: the jog's diagonals pass the feet close (knees 13 to 15 cm)
  and from the front they read as crossing; the back diagonals and the backpedal land with a
  nearly straight front knee (13 to 20 degrees); the side shuffle is quick (6 steps a second) and
  its feet still jolt 2.5 to 3.1 m/s where they land and leave (jogR is the worse side, the
  shuffle is mirrored but its trailing foot's timing is not); the jog sits 5 cm under the idle and
  the shuffle 8 (meant: athletic) but the hips bob only 2.5 cm; the sprint is the low ready pulled
  in, not a port, and its gun clears the body by 0.5 cm only; the running about-turn is worse
  than before at the feet (the legs no longer turn with the travel; they take the forward and
  diagonal clips while the body swings round). Not done: turn-in-place clips (the standing
  stepper is unchanged), start and stop clips.
- Gun handling pass (2026-11-10): the weapon swap, the reloads, the shotgun's pump and the aiming
  poses are authored in Blender (`blender/rifle_motion/handling.py`) and played by the game as
  upper-body actions; the run-time swap trick, the reload timelines and hand paths, and the
  borrowed `hold-rifle-aim` pose bent at run time are gone.
  - Pipeline: the rig now carries both guns (`gun` in the hands, `gun2` slung or coming off the
    back), hand targets and elbow poles keyed every frame (not riding the gun bone), and the loose
    parts as object animations (rifle magazine and charging handle, shotgun pump, a shell). Every
    clip keys every control, so nothing leaks from the clip before. Handling clips export extra
    nodes under Spine2 (`GunIn`, `PalmL`/`PalmR` with the hand's turn, `ElbowL`/`ElbowR`), and the
    notes say per frame which gun each hand holds, the finger curl and where the loose parts are,
    plus named events (s). Gun tracks are exported less the gun's carry shift (shotgun.js adds it).
    Authoring: keys joined by cubic curves; a hand either holds something or moves between holds
    through way points on a minimum-jerk ease with a small overshoot; guns posed by the hand that
    carries them; each gun's path smoothed over 2 frames (twice: before and after the wrists); a
    wrist limiter solves the arm as the rig will and turns a lone hand (and a gun it carries) back
    into range (soft limits 38 flexion, 22 / 28 deviation). Review: handling clips BVH-tested in
    every frame with both guns and against each other; per-clip `snap30` (worst one-frame change
    of velocity at 30 fps: left hand / right hand / muzzle; about twice the game's 60 fps figure);
    sheets with front, side, back, top and a close view on the hands.
  - Slung gun: `carry.STOW` per gun (butt behind the right shoulder blade, muzzle to the left hip,
    on its side). The game's old place stood 3 cm or more off the back everywhere; now 1.5 cm in
    the idle, hold, walk and jog (2.0 in some walks), exported in the JSON (`gun.stow`).
  - Swap (`swap-rifle-shotgun`, `swap-shotgun-rifle`, 1.35 s; Blender): gripCm 0 / 0 (0.3 / 0
    shotgun-first), elbows 21..112 / 86..147, wrists support +26 / -31 (+51 / -45 drawing the
    rifle), firing +68 / -76 for 2 frames just after it lets go behind the shoulder (the arm folded
    to 145 degrees, where Blender's IK and the limiter's estimate disagree), otherwise within 36;
    snap30 hands 1.7 to 2.6, muzzle 4.2 to 6.2; the guns never touch each other; the body BVH
    shows the firing forearm against the stock it holds while the gun goes over the shoulder
    (about 500 triangle pairs over the clip, shallow) and, drawing the rifle, its stock brushing
    the belly and the right forearm as it comes upright (slungClear 0).
  - Rifle reloads (`reload-rifle-tac` 2.3 s, `-empty` 2.95 s): gripCm 0, support wrist -45 / -25,
    firing -24 / -31, elbows 61..114 / 70..111, snap30 1.3 / 0.3 / 0.5; the fresh magazine starts
    inside the left hip (there is no pouch mesh: 190 triangle pairs over the few frames at the
    belt) and the stock touches the chest lightly as the gun comes in (40 pairs).
  - Shotgun (`reload-shotgun-start` 0.4, `-shell` 0.6, `-end` 0.42, `-end-pump` 0.98,
    `shotgun-pump` 0.6 s): gripCm 0, wrists within -33 / -30, elbows 30..105, gun 0 to 1.5 cm clear
    (the butt pad touches the chest for a frame as the gun comes in), snap30 at most 1.2.
  - Aiming (`rifle-aim-level/-up/-down`, `shotgun-aim-...`): trunk takes 40 % of the pitch, chest
    10 degrees further bladed, butt at the pocket 2.3 cm further out than the body measure, cheek
    weld solved to 0.2 to 3 cm (the eye; 3 cm aiming up); wrists support -23 / -21 level (was -29 /
    -26), firing -11 / -19; aiming 45 up the support arm is straight and 1.2 (rifle) / 2.2 cm
    (shotgun) short of the handguard in Blender (the game's reach slide takes it back along it).
    The head goes into the stock (the cheek weld: 100 to 500 triangle pairs, the eye at its place
    behind the sight, as the game already put it); 45 up, the slung gun touches the hips.
  - Game: `motion.js` loads handling clips (Catmull-Rom sampled, extra nodes) and the aim poses;
    `character.js` lays a clip's trunk over the gait clips as its difference from the low hold,
    eases the gun from the gait hold to the clip's Gun track and back, blends the aim poses by
    pitch (bends only past 45), and takes the clip's elbows; `weapon.js` / `shotgun.js` play the
    reloads (magazine, handle, pump and shell from the notes, events for sound, drops and ammo,
    hands from the clip, a hand on the gun kept on the real gun, eased in and out), fade the
    fidget, push, inertia and reach swing out under a clip, shoulder the butt where the aim poses
    put it and turn the support hand as they do (shotgun: 10 cm back on the pump); `main.js` plays
    the swap (handover at the clip's `handOver`: HUD and gun change there; sling sounds at `draw`
    and `slung`). No aiming while reloading or swapping. Removed: the swap's `held`/crossing hands,
    STOW_*, the reload timelines and anchors, `overshoot`, `cant`, `look` and the reload head turn,
    `pouchWorld`, the debug `freeze`.
  - Review: both muzzles followed through a swap (`muzzle`, `slung`); new situations reloadEmpty,
    reloadWalk, reloadJog, reloadBreak, swapWalk, swapJog, aimUp, aimDown, burstUp; `reload` takes
    the shotgun three shells down first.
  Game before -> after (rifle; shotgun in brackets):
  - swap: snap 13.9 (13.0), wrists support 85 / 88 (84 / 88), firing 175 / -135 (59 / -68) ->
    snap 3.8 (2.5), walking 3.8 (2.7), jogging 4.0 (2.4); gripCm 0 (0.2); wrists support 26 / -31
    (50 / -44), firing 77 / -77 (-41 / -46)
  - reload: snap 1.1 (2.9), support wrist -68 / -56 (-92 / -101) -> 1.1 (1.7), -45 / -26 (-33 / -30);
    from empty 1.4 (1.7), walking 1.9 (1.9), jogging 1.8 (1.9); gripCm 0; the trigger stops the
    shotgun's reload after the shell in hand (2 + 2 shells)
  - aimHold: support -29 / -26, firing -18 / -12 (shotgun -31 / -26, -24 / -14) -> -24 / -22,
    -10 / -18 (-27 / -22, -15 / -16); frozen 5 -> 0 to 4; push 1.7 -> 2.3 (0)
  - aimOnOff snap 1.4 (1.5) -> 1.1 (1.4); lookAbout 0.9 (0.9) -> 0.9 (0.8)
  - burst: support 44 / -61 (-47 / -26), snap 1.8 (1.1) -> -45 / -26 (-42 / -22), 1.9 (1.6)
  - new: aimUp snap 0.3 (0.6), aimDown 0.2 to 0.6 (0.4 to 0.9) with push 5.4 to 5.5 cm on the
    rifle (the height field wants the gun further out than Blender's BVH), burstUp 1.2 (3.1)
  - unchanged within their spread: idle, walk, jog, sprint, strafeLeft, startStop, walkJog,
    turnAbout, sweepWalk, sweepJog, jogR, aimF (both guns sampled)
  Still open: the firing wrist folds past range for two frames as it lets go behind the shoulder;
  the forearm runs against the stock going over the shoulder and the drawn rifle's stock brushes
  the body coming upright; the head intersects the stock at the cheek weld; aiming 45 up the
  support arm is fully straight; the rifle aimed down is pushed 5.5 cm along the barrel by the
  run-time clearance; the fresh magazine comes out of the hip (no pouch); the slung gun does not
  swing on its sling. Not done: separate left / right aim poses (the twist stays a run-time
  turn), a reload or swap while aiming (the gun comes down for them).
- Locomotion transitions pass (2026-11-10): turning on the spot, setting off, stopping and the
  running about-turn are authored in Blender as one-shot clips that move the body over the ground
  (root motion), and the jog's diagonals are re-authored.
  - Blender (`blender/rifle_motion/transitions.py`, new): a planner in the world. Footfalls (land,
    lift, ground point, heading, strike / push roll, a swivel on the ball while down), each swing
    straight, round a centre in the sense of the turn (`arc`, `wide`), or straight in the body's own
    frame so the foot goes round with its hip (`body`), walking (min-jerk) or running (glide, with
    its own `ramp`; the swing that crosses a handover takes the loop's 0.25); a root path (point on
    the ground and heading) and the body over them (hips height, pelvis turn, lean, bank, where the
    chest and head look). Planted feet are fixed in the world; the hips are drawn towards the feet
    that are down (Gaussian-smoothed, so the weight goes across before a foot lifts) and lowered
    where a standing leg could not reach (`gait._hips_height`; it, `periodic_smooth` and `_gun` gained
    a non-looping mode). Every frame is then expressed in the root's frame; the notes carry `root`
    ([x, z, yaw] per frame from the start), `down` (feet on the ground), `kind`, `angle`, `entry` /
    `exit` (the loop's gait, foot, phase and speed). A clip begun on a jog footfall has the other foot
    already in the air where the game's jog has it (behind and kicked up: measured, `KICKED`).
    `review.py` judges slide in the world for a clip with a root and moves the floor (now a 7 m
    checker) under the sheets, so planted feet can be seen to stay put; non-looping sheets run first
    frame to last.
  - Clips: `rifle-pivot-l45 / -l90 / -l135 / -l180` and `-r...` (0.62, 0.8, 1.04, 1.2 s): head first,
    then chest (capped 0.7 / 0.45 rad ahead of the pelvis), the inside foot opens towards the new way
    (on 135 / 180 three quarters of the way, then the rest), the weight goes onto it, the outside foot
    swings round outside it; hips sink 2.5 cm; the root drifts half way to pivoting on the inside
    foot. `rifle-walk-start` (0.8 s, two steps) and `rifle-jog-start` (0.92 s, three): weight onto the
    front foot and the trunk tipped forward from the first frame (drive lean +6 / +9 degrees), back
    foot drives into a short step, ends on a loop footfall at the loop's speed. `rifle-walk-stop-l / -r`
    (1.0 s, three footfalls) and `rifle-jog-stop-l / -r` (1.12 s, four), from the loop's speed as the
    named foot lands: it lands further ahead, the hips sit back and down (1.5 / 4.5 cm), the trunk
    leans back (5 / 10 degrees) and the feet come down into the ready stance. `rifle-run-turn-l / -r`
    (0.88 s): the outside foot lands ahead turned in and swivels on its ball through 120 degrees
    while the body brakes from 3.6 m/s to a stop in 0.26 s, sits back 4 cm and banks into the turn;
    the inside foot comes round with its hip (out to its own side) and is put down for the drive;
    lean into the new way, two running steps, ends on the inside foot's footfall at 3 m/s.
  - Jog diagonals (`gait.py`, new spec fields `cross`, `heading`, `into`): the feet run on lines
    30 cm apart across the way of travel (25 cm backwards; was 27 cm across the body, which put each
    foot across the body's middle), feet and knees turned 22 (18) degrees into the diagonal, pelvis
    16 (12); back diagonals land a little further behind (land 0.53) so the leg is not stretched.
  - Game: `src/moves.js` (new): a Move plays one transition (or, on the spot, two clips of the same
    step pattern blended so their turns add up to the angle wanted; between patterns the nearer one,
    its turn scaled) and gives the root each frame; a faster entry than authored carries the extra
    speed on and lets it die away over 0.12 s. `player.js`: `_transitions` begins and ends them —
    standing, a turn on the spot when the view is far enough round (shouldered past 0.4 rad, at once;
    carried once the body follows the view, after the view slows unless it is 2.4 rad away), sized
    0.15 s of view turning ahead (at most 0.8 rad), chained while the view keeps going; a start when
    W is pressed from standing (not in a reversal through a standstill), bending up to 0.95 rad
    towards the view on top; a stop on the next loop footfall after letting go of a forward walk or
    jog (the body keeps its pace until then; given up after 0.45 s); the about-turn when running and
    asked more than 2.3 rad round from 2.6 m/s, on the outside foot's footfall (a straight reversal
    turns towards whichever foot lands first); a transition the player no longer wants is let go of
    and its velocity carried on. While one plays, the root moves the body (`move.root`), the yaw rate
    is the clip's and the acceleration lean is off. `motion.js` loads transitions (`pivots`, `starts`,
    `stops`, `runTurns`), samples them clamped at the ends with the end keys extrapolated
    (`_once`: a clip that begins at speed keeps it), `accumulateOnce`, `rootAt`, `downAt`.
    `character.js`: the transition's share eases in (0.08 to 0.15 s by kind) and out (0.12 s into a
    loop, 0.2 s into the idle); one let go of keeps playing as it fades; one begun while another
    fades blends with it; the loops underneath go straight ahead and, once hidden, are pinned to the
    exit loop and its phase, so a handover or a let-go is in step; contact is the blend of the
    loops' and the clip's `down`; no stride stretching, no push-aside and no planting while one plays;
    the view's look is left out under a clip that looks by itself (pivots, about-turn); `landed`
    reports loop footfalls for the controller, `forwardGait()` which forward loop the legs are in.
    Fixed in the foot hold: a held foot kept its heading relative to the root (`ref`), so a clip whose
    feet turn against a turning root (every transition) would have turned twice; it now keeps a world
    heading against the clips' own (identical for the loops). A foot in the air now also carries its height through a change of blend (`offY`), as it
    did its place.
  - Kept: the run-time stepper, for what the clips do not cover: putting a foot back where the
    stance wants it after `alive.js` changes the stance or the gun is shouldered (wider stance), what
    a transition let go of part way leaves over, and turning in first person (the view turns the
    body directly there). Removed: nothing else of the stepper; the standing body no longer swivels
    after the view in third person.
  - Review (`src/review.js`): `startStopWalk`, `turnCarried`, `turnAimed`, `turn180` (the view swung
    on an eased curve, as a hand would; an instant swing jolts a shouldered muzzle by itself);
    `record` clears a playing transition.
  Blender numbers (slide mean / worst m/s in the world, knee, ankle / knee gaps cm):
  - pivots 45 / 90: slide 0.001-0.002 / 0.015-0.040, knee 24, gaps 25-30 / 28; 135: 0.012 / 0.22,
    gaps 24-25 / 19-21; 180: 0.008-0.009 / 0.12, gaps 22-24 / 15-19; gun 0.5-1.0 cm clear, 0 hits
  - walk start: 0.003 / 0.049, gaps 21 / 24; jog start: 0.045 / 0.68 (its run swings counted at the
    frames either side of landing), gaps 22 / 25; walk stops: 0.003 / 0.06-0.08, gaps 20-21 / 24-27;
    jog stops: 0.009-0.015 / 0.20-0.28, kneeMin 11-12 (the brake leg reaching ahead), gaps 21-22 / 25
  - about-turns: 0.12 / 1.8 (the swivel's heel and the run swings), kneeMin 23, gaps 22-23 / 18
  - jog diagonals: FL / FR gaps 21-22 / 12-13 -> 32-34 / 26-27; BL / BR 20-21 / 15 -> 26 / 22-23,
    kneeMin 17-20 -> 21; slide unchanged (0.05-0.08 mean)
  - every clip: gripCm 0 / 0; round trip 0.097 mm
  Game rows, before -> after (rifle; shotgun in brackets; ranges over 3 runs, startStop 5):
  - turnAbout: snap 3.3 to 4.9 (3.4 to 4.2), snapUpper 1.1 to 1.4 (2.0 to 2.5), gaps 10-12 / 12-18
    (10-11 / 6-14), footTurn 67-113 -> snap 3.8 to 4.0 (3.8), snapUpper 1.4 to 1.5 (2.1 to 2.3), slide
    0 (0), gaps 3-5 / 19-23 (4-5 / 22-23), footTurn 160-220 (the swivel). Worse at the ankles.
  - startStop: 2.7 to 3.1 (1.8 to 3.1) -> 2.1 to 2.2 in 5 of 5 (2.1 to 2.2 in 5 of 5), slide 0, gaps
    19-21 / 23; startStopWalk (new) 1.8 to 1.9 -> 1.8 to 1.9 (1.7 to 1.9) with the clips
  - turnCarried (new; stepper) 0.6 to 0.7, gaps 21-29 / 8-14 -> 1.3 (1.3), gaps 22-30 / 21-25;
    turn180 (stepper) 0.8 to 1.3, gaps 4-12 / 2-11 -> 2.1 (2.1 to 2.3), gaps 21-24 / 19; turnAimed
    1.3 to 2.1 -> 1.2 to 1.8 (1.3 to 1.7), gaps 26-33 / 23-26; lookAbout 0.8 to 0.9 -> 1.3 to 1.4
    (1.9), slide 0 -> 0.01, gaps 25 / 24-25 (the legs now step round under it)
  - jog diagonals: FL / FR 1.9 to 2.2, gaps 25-26 / 13-15 -> 1.8 to 2.1, gaps 33-34 / 25-26; BL / BR
    2.1 to 2.3 -> 2.2 to 2.4, gaps 25 / 14-15 -> 28-29 / 20-21, kneeMin 18 -> 21 (both guns alike)
  - sweepJog 2.8 to 3.4 (2.5 to 2.8), gaps 15-16 / 11-12 -> 2.5 to 3.1 (2.5 to 2.9), gaps 14-17 /
    11-13 (14-16 / 12-14); sweepWalk 1.9 to 2.0 (1.9 to 2.3) -> 2.0 (2.0 to 2.1), gaps 13-14 / 14-15
  - unchanged within spread: walk, jog, sprint (feet 3.8 to 4.2), walkF/L/BR, jogF/L/B, aimF/R,
    strafeLeft, walkJog, idle, aimHold, reload, swap (rifle 3.8, shotgun 2.5), burst
  Looked at: the turns on the spot (film strips carried 180 and shouldered 90: head and chest go
  first, the feet step round, the gun stays on target shouldered), starts and stops at the walk and
  the jog (weight forward and drive at once; the stop sits back and settles; the lean-back is
  slight), the about-turn from a sprint (sprint, plant and crouch, turn, run back, one action), the
  jog diagonals from the front (legs side by side; at the moment of passing the feet still line up
  one behind the other seen from the front). Still open: the about-turn's ankles pass 3 to 5 cm
  apart at about 0.2 s in the game (19 to 23 in Blender): the jog plants the outside foot 5 to 10
  cm nearer than the clip's plant and the inside foot comes round by the clip's path, so they meet;
  next, plant the clip's outside foot where the game's jog does (measure it as `KICKED` was) or
  hold the inside foot's swing relative to the held foot. Its feet also jolt 3.8 to 4 m/s as it
  hands back to the jog. The stop waits for the next footfall (up to 0.35 s) at full pace. Starts
  and stops are forward and carried only. Blender's jog stops straighten the brake knee to 11
  degrees for a frame. The aimed body ends a turn in the ready stance, not the wider aim stance (5
  cm short, under the stepper's trigger).
- About-turn and stops pass (2026-11-11): the two things the transitions pass left.
  - Stops (`transitions.py` `stop`, `loop_feet`; build `STOPS`): the four stop clips that began on a
    footfall are replaced by `rifle-walk-stop-0 ... -7` and `rifle-jog-stop-0 ... -7`, one at each
    eighth of the loop's cycle. `loop_feet` samples the forward loop's own frames there (each
    foot's place, velocity, heading, pitch, down or not, time to its next lift or landing); a foot
    caught in the air keeps its swing (new stance field `vel`: the swing leaves at the loop's
    velocity and bends smoothly into its footfall). The root brakes on a min-jerk from the first
    frame (walk 0.45 s, 0.33 m; jog 0.55 s, 0.99 m). The brake foot is one down and not behind the
    body (running: only one just landed), else the next to land (put down near where the loop
    would, moving towards a little ahead of the slowing body the longer it has to go); then the
    feet alternate (0.3 / 0.27 s apart), braking steps while the body has more than 18 cm to go,
    then into the ready stance; walking a foot leaves after the other is down, running just before
    (running swings, kicked up as the loop's). The game (`player.js`) begins the stop on the frame
    the key is let go: the clip just behind the legs' phase, begun the rest of the way in (`Move`
    `start`; its root is taken from there, and `character.js` eases it in by the move's age).
  - Entry speed (`moves.js`): a faster entry than the clip's is now taken up by playing its first
    steps faster (rate up to 1.6, easing back over 0.12 s), not by adding travel; a slower one still
    carries its shortfall on. The added travel was most of the about-turn's crossing from a sprint
    (1.4 m/s over, 16 cm further past the planted foot).
  - About-turn: in the game the outside foot is put down where the run had it, 30 to 32 cm ahead
    from a sprint but 16 to 25 cm from the jog that follows another about-turn (the clip plants it
    at 30); that shortfall (now measured as the move begins: the clip's `plant` note against the
    ankle) is taken off the root as it brakes (`short`, min-jerk over 0.26 s), so the body stops
    over the foot as authored and the inside foot comes round it clear. In Blender the plant moved
    in to 6.5 cm from the middle (was 10) and the inside foot's swing out (landing 44 cm across,
    was 40; out 16 cm, was 12); the outside foot now lifts at 0.74 s (was 0.84), a flight before the
    end as the loop has it and before the game fades into the loop: let go between the clip's place
    and the loop's while the two were blended, it jolted 3.6 to 4.3 m/s.
  - Review: `stopCm` (furthest / longest after letting go of the move keys while going, until under
    5 cm/s) in every row, '-' where nothing stopped.
  Blender (slide mean / worst m/s in the world, kneeMin, gaps ankle / knee cm): walk stops 0.006 to
  0.041 / 0.19 to 1.08, knee 24, gaps 19 to 28 / 23 to 28; jog stops 0.021 to 0.111 / 0.70 to 2.9
  (the worst are swings near the ground counted as down), kneeMin 11 to 24, gaps 19 to 24 / 25 to 28;
  about-turns 0.139 / 2.05, knee 24, gaps 28 / 20 (were 22 to 23 / 18); round trip 0.097 mm.
  Game, before -> after (released at many phases with `forward` and `jog` from a steady pace,
  stepping until under 0.05 m/s; rifle, shotgun the same within spread):
  - from the walk: 64 to 103 cm, 0.72 to 0.98 s -> 21 to 32 cm, 0.30 to 0.37 s (review `stopCm`
    rifle 23 to 38 / 0.32 to 0.40, shotgun 26 to 32 / 0.35 to 0.37)
  - from the jog: 148 to 232 cm, 0.70 to 0.93 s -> 71 to 97 cm, 0.42 to 0.48 s (review rifle 77 to
    97 / 0.43 to 0.47, shotgun 74 to 97 / 0.43 to 0.48; a stop begun from 4.8 m/s went 114 cm before
    faster entries were time-warped)
  - starts unchanged: 2.2 cm in the first 0.1 s, 1.39 m/s at 0.5 s
  - startStop snap 2.1 -> 1.8 to 2.0 (shotgun 1.8 to 1.9), slide 0 to 0.01, gaps 21 to 23 / 21 to 23;
    startStopWalk 1.7 -> 1.8 to 2.5 (2.5 to 2.9 shotgun, a foot landing from a caught swing), slide 0
  - turnAbout, three runs: rifle snap 3.8 -> 3.3 to 3.6, gaps 3-5 / 19-23 -> 14 to 16 / 23,
    snapUpper 1.4 -> 2.0 to 2.2, slide 0; shotgun snap 3.8 -> 3.3 to 3.7, gaps 15 to 17 / 23,
    snapUpper 2.1 -> 2.8. The row's snap is now the sprint's feet before the turn (5.2 m/s, exempt);
    inside the turn and 0.3 s after it the worst is 3.2 to 3.4 at about 0.31 s, the inside foot
    landing. About-turn from a full sprint alone: gap 22 to 27; 135-degree running turns (back and
    left or right from a sprint): gaps 15 to 21, snap 3.4.
  - unchanged within spread: walk 1.9, jog 1.9, turnCarried 1.3, turnAimed 1.2, turn180 2.1 to 2.2,
    sweepJog 2.9, sweepWalk 1.9, reload 1.1, swap rifle 3.8, shotgun 2.5; gripCm 0 (swap shotgun
    0.2)
  Looked at: a jog stop from the side (strides, the brake foot planted ahead with the hips sitting
  down over it, a settling step, upright at 0.9 s) and the about-turn from a sprint (plant and sit,
  the gun swings round with the turn, the feet apart in every frame, running back). Still open: the
  about-turn misses snap 3.0 inside the turn (3.2 to 3.4): its inside foot's swing is straight in
  the turning body's frame, so it still moves over the ground as it lands; next, blend that swing
  to a world-fixed path over its last part in `_air`. Its snapUpper rose (time warp from a sprint:
  rifle 2.2, shotgun 2.8, still under 3.0). `turnAbout`'s row includes sprint feet before the turn,
  so it cannot show 3.0 by itself. Stops still forward and carried only; the stop's lean back is
  slight; Blender's jog stops count low swings as slide (the game measures 0 to 0.01).
- Upper-body detail pass (2026-11-11): gun-handling defects, eyes and face, hit reactions.
  - Swap (`handling.py` Swap): the firing wrist's 77 / -77 was the elbow swinging through its pole as the
    hand let go behind the shoulder (pole 14 degrees off the shoulder-to-wrist line, the arm folded to
    145): the pole now goes forward, then down (keys at 0.69 and 0.78 of the old timing), and a free
    hand's wrist limiter starts from last frame's turn and relaxes towards a straight wrist. The rifle
    going over the shoulder is yawed 0.3 further out (`OVER`): forearm-through-stock 501 -> 435 triangle
    pairs. Searched: rolling it either way put the magazine or receiver into the head (594 to 631);
    yawing further gives 399 but muzzle snap30 6.5. Not solved: holding the pistol grip with the gun
    along the forearm puts the stock along the forearm.
  - Aim poses (`AimPose`): the weld's eye is 4 cm further back and 1.5 cm higher than weapon.js's
    (`EYE_BACK`; main.js `CHEEK`, third person only) and the head is canted 30 degrees onto the stock
    about the barrel (`CANT`); aimed 45 up the support palm takes hold 2.5 cm (shotgun 3.5) further back
    (`UP_SLIDE`). Head hits, before -> after: rifle level 339 -> 30, up 472 -> 0, down 671 -> 307 (still
    in: the trunk leaning over brings the face down onto the receiver); shotgun 100 / 59 / 195 -> 0 / 0
    / 22. Blender gripCm 45 up 1.17 / 2.19 -> 0 / 0 (support elbow no longer straight: 23 / 21 deg).
    No sideways poses authored (the run-time twist is unchanged; not looked at in close-ups).
  - Belt kit (`blender/rifle_motion/pouch.py`, new): magazine pouch with a magazine's top showing,
    left front hip; four shells in loops behind it; boxes and cylinders in the Hips joint's frame,
    built on the skeleton in Blender (rig.py) and by the game from the notes (`pouch`; character.js
    `buildKit`). The reloads draw from `DRAW` per gun. Rifle reload magazine-in-hip 329 pairs -> 0.
  - Hit reactions (`blender/rifle_motion/reactions.py`, new): `hit-light-f/b/l/r` 0.4 s, `hit-heavy-f/b`
    0.9 s, upper-body differences from the low hold like the handling clips. Blender: gripCm 0, gun 0
    hits and 1.0 to 1.5 cm clear, snap30 hands 0.7 to 1.4, muzzle 1.3 to 2.5. Game: `Player.hit(way,
    strength)` (heavy shoves the body 1.3 m/s away so the stepper steps after it, view jolt),
    `demo.hit`, `H` key, `Sound.hit`, character.js hit layer (joint and gun differences, scaled by
    strength). The stagger's step is the game's shove, not authored.
  - Eyes and face (character.js `_face`, run time only; nothing keyed in Blender): fixations in the
    world, saccades (min 3 deg, 35 ms, 0.18 s refractory) landing 0.15 s ahead of a moving point,
    pursuit up to 0.6 rad/s, darts at rest, eye turn limited 0.45 / 0.35 / 0.5 rad and turned about the
    eyeball's centre (the joint is at its front: turned about it the ball left the socket); the head's
    look trails the view 0.09 s (`HEAD_LAG`); blinks 2 to 5 s with doubles and long gaps, 18 % half,
    on large gaze shifts and on shots; brow, mouth and lids. Review columns `eyeMoves`, `eyeLeadMs`,
    `blinkS`; situations `hitLight`, `hitAimed`, `hitWalk`, `hitHeavy`, `eyesRest`, `eyesTurn`.
  Game rows before -> after (rifle; shotgun in brackets):
  - swap: snap 3.8 (2.5) -> 3.7 (2.3); firing wrist 77 / -77 -> -45 / -47 (-41 / -46 -> -33 / -43);
    gripCm 0 (0.3) unchanged
  - reload 1.1 (1.7) -> 1.0 (1.7); aimHold frozen 2 (0) -> 5 (2); aimUp 0.2 (0.3), aimDown 0.2 (0.1)
    unchanged, aimDown push 5.6 -> 5.5; burst 1.8 (1.6) -> 1.7 (1.6); lookAbout 1.5 (1.8) -> 1.4 (1.9);
    idle 0.7 (0.9) -> 0.6 (0.9); gripCm 0 everywhere
  - new: hitLight 2.6 (3.5), hitAimed 1.8 (1.0), hitWalk 2.6 (3.5), hitHeavy 2.3 (2.9), gripCm 0, wrists
    within 36; eyes idle 0.6 to 0.8/s, blinks 0.4..7.5 s apart (mean 3.2 to 4.0), eyesTurn 2.5/s,
    turnCarried 2/s, lookAbout 4.8/s, reload 1.5 to 2.8/s; eyeLeadMs 17 to 67 on turns (the measure is
    a velocity correlation and reads 0 to 333 elsewhere: not trustworthy yet)
  - locomotion unchanged within spread: walk 1.8 (1.9), walkL 2.1 (2.1), jog 1.9 (1.8), startStop 1.8
    (1.8) stop 95 / 0.48 (95 / 0.48, was 79), turnAbout 3.6, turnCarried 1.3 (1.3); slide 0 to 0.01
  Still open: the swap's firing wrist deviation reads -47 in the game (Blender -34; the game's elbow from
  the clip's ElbowR node and its own arm solve differ); the forearm along the stock in the swap; rifle
  aimed 45 down still puts the face into the receiver and stock (307 pairs); no left / right aim poses;
  the stagger's step is a run-time shove; eye looks are not keyed in Blender clips (the run-time gaze
  goes to the magazine or pump during reloads); `eyeLeadMs` needs a better measure (the time the eyes
  reach 90 % of a turn against the head's).
  Follow-up the same day (coordinator's close-ups):
  - Eyes left their sockets when they turned far (a flick of the view: the ball slid about 3 cm, iris
    on the temple, red socket showing). Cause, from the skin: the eye joints are not at the eyeballs'
    centres. 256 / 257 vertices are skinned wholly to each eye joint (no lid or socket vertex carries
    eye weight); their centroid is 2.1 cm below and 3.3 cm in front of the joint (ball radius 1.5 cm),
    so a turn about the joint swung the ball through an arc of 3.9 cm radius. The earlier "fix" moved
    the joint as if the ball were 1.2 cm behind it, the wrong way. Now `eyeBall` reads each ball's
    centre from the skin (bind pose, joint frame) and the joint is moved so that centre stays put.
    New review column `eyeOutMm` (the balls' centres against their rest place in the head, through
    the joints' world matrices) and situation `eyesFlick` (the view jumped +1.0 then -1.4 rad).
    eyeOutMm before: about 17 mm at the 26-degree turn (computed; seen as about 3 cm); after 0 in
    eyesFlick, eyesTurn, lookAbout, turnCarried, reload, aimHold, both guns. Looking down the lids now
    follow the eyes by 0.35 of the pitch (was 0.5, which with a blink's tail read as shut).
  - The aimed head lay over on the stock. Measured in the game as the line between the eyes against
    level, seen along the barrel: about 45 degrees on the poses of the first fix (CANT 12 on top of the
    old weld, whose neck turn and half-returned head roll did most of the tipping). Now the head keeps
    a nearly upright turn (CANT 12, chin 6 degrees down, the neck taking 85 % of what the trunk leaves
    of the pitch) and the neck alone carries it across to the gun (the weld no longer lets the head
    roll); the gun comes up and in to the face (`LIFT` 1.2 cm up and in), the firing collarbone is
    raised 6 degrees (`RAISE`), the eye sits 6 cm behind and 4.5 cm above the sight's point (and 1.2 /
    1 cm more aiming 45 down: `EYE_BACK`, `EYE_DOWN`; main.js `CHEEK`, `CHEEK_DOWN`), and the game's
    `_seatEye` gives the head's whole turn back. Game cant: rifle 11.9 level / 10.6 up / 11.7 down,
    shotgun 11.7 / 10.5 / 12.1. Blender head pairs (rifle level / up / down): 213 / 91 / 262, of which
    skull, eye or nose 0 / 0 / 3, the rest cheek, jaw and underside of the jaw against the stock's comb
    and the receiver; shotgun 34 / 0 / 107 (stock and butt pad, cheek and jaw). gripCm 0 at every pitch,
    wrists within 37 / 36. Front and behind looked at in the game (rifle): head nearly upright, cheek
    beside the stock, the gun brought up to the face. The weld no longer reaches the sight exactly
    (Blender 1.4 cm level, up to 5 to 7 cm aimed 45 up): the neck alone cannot carry the eye there
    with the head kept upright.
  - The aim poses were re-exported into the GLB in place: `build_rifle_motion.py` with ONLY and PATCH
    (same channels and frame counts; 4392 bytes changed, every other clip untouched). The full build
    gives the same.
  Traps: Blender's review prints the designed pose; the exported one is what the game plays, and
  a browser tab that has not been navigated since the GLB changed may still hold the old file (the
  first cant measurements here, 29 to 49 degrees, were of a stale page). Measure the cant from the eye
  line, not a joint's axis. Never turn a joint whose skin is not centred on it without moving it round
  the skin's centre (eyes here; check the jaw before using it).
- Crouch, slopes and steps pass (2026-11-11, pass 9).
  - Blender (`blender/rifle_motion/crouch.py`, new; built into the GLB by the full build, round trip
    0.097 mm, every earlier clip's review line unchanged): `rifle-crouch-idle` (9 s: weight rocking
    across and fore-aft, two re-settles, four breaths, the head scanning; rear foot stepped 12 cm back
    and up on its ball, knees about 110 degrees, pelvis tipped 12 and trunk leaning 24, head level, the
    muzzle carried 14 degrees up against the lean so it points past the front knee),
    `rifle-crouch-walk-f` ... `-fr` (`gait.Author.cycle` with new spec fields `drop` 0.33 m, `tilt`,
    `bounce` 0.45, `gun` offsets; 1.0 m/s forward in 0.38 m steps, sideways and back on the game's
    pace ellipse, 45 to 75 frames for three strides), `rifle-crouch-down` / `-up` (0.43 s: hips lead
    and settle 1.5 cm past; up: a 1 cm dip, the push, the trunk after the hips, a touch past standing;
    each starts and ends on rifle-idle's and the crouch idle's frame 0). `gait._gun` takes `lag` (the
    down/up use 0.25 of it: the full lag lifted the gun 5 cm towards the shoulder as the chest dropped
    and bent the firing wrist to -45; now -31, as standing). Blender: crouch idle head 1.09..1.13 (idle
    1.48), hips 0.53..0.57; walks head 1.11..1.14, hips 0.553..0.562 (bounce 0.9 cm), kneeMin 105 to 108,
    gaps 21 / 31, slide means 0.003 to 0.017, gripCm 0, gun 0 hits and 1.5 cm clear in all 11 clips;
    down/up firing wrist dev -31 / -30, gun 0 hits. New build features: `review.py` prints `headY`;
    `build_rifle_motion.py` has `PATCH = 'append'` (adds new clips to the GLB and JSON without a full
    build; replaced clips leave dead bytes until the next full build).
  - Game: `motion.js` loads `crouch` (idle, walks in the walks' order, down, up, stance with the rear
    foot's pitch). `character.js`: `s.crouch` 0..1 splits the idle's and the walks' shares between the
    standing and crouch clips; `s.crouchMove` lays the down/up clip over everything with its share; the
    stance (`_home`) goes to the crouch's, a planted rear foot stands up on its ball (and its toes stay
    flat); a hit is played at 0.7 crouched. `player.js`: `C` toggles (`toggleCrouch`), Shift or the
    jog stands it up / drops the jog, 1.0 m/s crouched (0.85 sighted), standing still the clip plays
    (the crouch weight eased with it), moving the crouch eases over 0.35 s on a smootherstep (linear
    first: hips vPop 0.96), no pivots/starts/stops while crouched (stepper and blends), camera pivot
    37 cm lower. `main.js`: `C` crouch, `V` camera, quieter steps; HUD and README.
  - Reload crouched: the hand paths are the standing ones and the pouch rides the tipped pelvis; the
    left palm is steered by the pouch magazine's move against the chest since the body last stood
    (reloads only, faded over 8 to 32 cm). Closest the palm gets to the pouch magazine at the draw:
    standing 3.5 cm, crouched 5.9 (at fixed times before the fix 5.0 against 7.4). Looked at from the
    front-left: the hand goes down to the pouch on the hip, folded over the thigh, takes the magazine.
  - Ground (`src/ground.js`, new): `groundAt(x, z, normal)`, ramps 10 and 20 degrees (8 / 6 m up, 3 m
    top, down again, 3.5 m wide, at x -14.5..-11 and -8..-4.5, z 26..45), four steps 17 / 30 cm to a
    0.68 m platform and down (x 0..3, z 30..34.8), a 12 cm kerb (x 6..10, z 30..33), railed sides added
    to the obstacles, nosings painted; shells and magazines rest on it (`fx.js`). `character.js`: the
    root at the ground averaged over 0.6 m along the facing and across, lowered 12 cm per unit grade,
    eased 0.1 s; grade leans the body (0.3 up, 0.2 back down) and shortens steps (up to 18 %); each
    foot's ground (held: exact under ball/heel; swinging: eased, plus look-ahead clearance, heading for
    the landing tread's height), sole turned to the normal about the ball; the landing place is looked
    ahead to (`_landing`: loops' contact at the gait's pace, blended clips' foot there) and moved along
    the foot onto one tread (`_treadFix`); a foot is not caught until it is (2 cm left done at the
    catch); swinging feet clamped over the final place's ground, eased over 0.03 s; hips may drop by
    the feet's height difference beyond LOW_MAX; `snapToGround()` resets body and feet after a move by
    hand (the old feet stayed held where the last situation left them).
  - Review: 30 situations (crouch set, ramps both ways and across, rampStand20, rampCrouch20,
    stairsUp, stairsStart, stairsDown, kerb; place-based ones set off as the measuring starts), columns
    `sinkCm`, `floatCm` (+`floatAt`), `sinkAt`, `soleDeg`, `vPop`, `headUpCm`; `slide` uses the
    ground under each point.
  Before -> after (rifle / shotgun): walk 1.8 -> 1.9 / 1.8; walkL 2.1 -> 2.1 / 2.1; jog 1.8 -> 1.8 /
  1.9; startStop 1.8 -> 1.8 to 2.4 / 1.8 to 2.7 (stop 93 to 102 cm, 0.47 to 0.48 s / 93 to 106,
  0.45 to 0.48); turnCarried 1.3 -> 1.3 / 1.3; turnAbout 3.6 -> 3.5 / 3.2; idle 0.6 frozen 0 -> same;
  aimHold 0.6 frozen 3 -> 0.6 frozen 0 to 2 / 0.6, 4; reload 1.0 / 1.7 -> same; swap 3.7 / 2.3 -> same;
  burst 1.0 / 1.6 -> same; hitLight 2.8 / 3.5 -> 2.6 to 2.8 / 3.4 to 3.5; gripCm 0 everywhere
  (shotgun swap 0.3 as before); eyeOutMm 0. New rows: see the quality bar.
  Looked at (film strips in the game): crouch idle side (low, rear heel up, head looking about, gun
  steady), crouch walk side (short steps, level pelvis, knees never straight), shotgun crouch side step
  from the front (knees out, feet apart, hands on), going down from standing (hips first, trunk after),
  crouched aim side and front (eye behind the sight, head upright, gun level over the knees, both palms
  on), crouched reload at the pouch, 20-degree ramp up (leaning in, knees lifting, soles on the slope)
  and down (upright, short steps), stairs up from the side and from above (feet on treads, knees lift;
  a low side view had the platform hiding the lower legs and looked like kneeling: it is not), first
  person crouched (eye 1.20 against 1.61), fire / reload in first person crouched. Not looked at:
  stairs down in a strip, the kerb, crouch on the ramp, crouch hit and swap close up, the 10-degree ramp.
  Still open: stairs up jolt 4.5 to 5.3 m/s (a toe brought over the nosing late; the edge clamp is
  eased over 0.03 s, which lets it graze by up to 1.2 cm) and setting off at the foot of the stairs
  (stairsStart: the start clip's steps are only roughly looked ahead to) puts a toe 6 to 9 cm into the
  first riser and the knees 8 cm apart; rampDown10 floats a planted foot 3.1 cm (mid-stance, heel 4.4,
  ball 3.1 above: the body's ground on a gentle downhill sits a little high for the rear foot) and
  rampAcross20 2.0; ramp/stair adaptations are run time, nothing authored in Blender for hills; crouched
  aim is the standing aim's upper body (no crouch lean); no crouched turns on the spot, starts or stops;
  the down/up clips' rear-foot step is not used standing (the stepper steps it); the crouched reload
  palm is still 2.4 cm further from the pouch than standing; collision has no height.
  Traps: Vite reloads the page a few seconds after a source edit even after you navigated: wait for it
  or a long script is cut off. Drawing the WebGPU canvas onto a 2D canvas works only right after
  `demo.render()` followed by `device.queue.onSubmittedWorkDone()` and a second render. Situations
  that settle while walking start mid-feature: place-based ones must set off at t >= 0. `review`
  teleports must call `character.snapToGround()` or held feet stay behind. The foot's forward in the
  world is `(0,0,1)` turned by its world quat (not its negative). A full build's `clips.txt` can differ
  from an old copy only because an earlier pass patched clips after its last full build. Disk was 99 %
  full at the start of this pass (under 1 GB free); the full build needs about 70 MB for the .blend.
  Follow-up the same day (coordinator's re-measure: stairsUp 4.4 / 4.5, sink 1.4; stairsStart 4.8,
  sink 9.1, a knee two treads high; rampDown10 float 3.1, rampAcross20 2.0, rampStand20 sink 1.5;
  one startStop at 2.8 / 107 cm). All game side; no Blender change.
  - Found: `_landing` (the footfall look-ahead) never ran: it checked `_blendNow.ready`, a flag only
    the copy sets, so it always returned null and the tread fit worked from a guess. Fixed, and it now
    also looks ahead through a transition (the move's own `down`, its time stepped ahead).
  - The 4.4 to 4.8 jolts were feet, frame by frame: (a) at lift-off, the foot's ground jumped to the
    landing tread (eased 0.05 s) and the edge clamp started from a stale value: up 10 cm in a frame;
    (b) a velocity look-ahead of 0.12 s at a start's 7 m/s swing saw the platform two treads past the
    footfall (the "two treads high" knee: clearance 27 cm); (c) going down, a foot never caught (the
    tread fit tested a predicted point while the catch tested the real one) floated over the step and
    dropped 34 cm when caught. Now a swinging foot's ground runs on a line from the tread it left to
    the one it lands on, by the swing's progress (time in the air against time to the footfall; up:
    there by 40 %, down: from 35 %), onto the ground under it over the last 20 %, never under it,
    eased both ways; the look-ahead stops at the landing point; the edge clamp restarts from the
    ground it left; the swing is restarted when the clips lift a foot that was never caught; a foot
    landing now is fitted from where it really is; it is caught only on the real ground under its
    ball; going up, a swinging foot is held back behind a riser until its sole is above the tread
    ahead (eased in 0.02 s, out 0.06). The tread fit keeps the toe 6 cm off the next riser and lets the
    heel hang over a lower tread (not into a higher one), measured against the surface's plane, and
    only near a step's edge (`ground.edgeNear`). On stairs and the metre before them the pace drops to
    0.85 m/s (running 1.9): the walk blended down keeps its cadence and takes 0.29 m steps, one tread.
    The body already rode a ramp through the nosings (ground averaged over 0.6 m); unchanged.
  - Floats: a held foot stood on the higher of the ground under its ball and heel, so on a downhill
    the heel's (uphill) ground lifted it 3 cm. Held feet now stand on the ground under the ball; a
    planted foot's ball goes on its own ground (the stepper had used the ankle's).
  - Review: `sinkCm` is now the depth to the nearest surface (tread above or riser face beside); the
    old straight-down depth is `sinkVCm` (a toe touching a riser by 1 cm read as 5 to 9 cm).
  Before -> after (rifle / shotgun; several runs): stairsUp 4.5 to 5.3, sink 1.2 -> 2.1 to 3.4, sink
  0.1 to 0.5 (vertical 0.1 to 1.5), knee gaps 20 to 23; stairsStart 4.5 to 4.8, sink 6 to 9 -> 2.5 to
  3.4, sink 0.1 to 0.8, knee gap 19 to 23 (one run 12); stairsDown 3.0 -> 2.3 to 2.6, sink 0.1; kerb
  2.4 -> 1.8 to 1.9; rampDown10 float 3.1 -> 0.2; rampAcross20 2.0 -> 0.4 to 0.5; rampStand20 sink 1.5
  -> 0, float 1.0. Highest ankle over the higher of the tread under it and the next: 25 to 29 cm
  (walk on the flat 10). startStop on the flat, 11 runs rifle: 1.8 to 2.1 in 10, one 3.3 at the
  muzzle (upper body, snapUpper 3.3); stops 77 to 100 cm, 0.43 to 0.48 s; 5 runs shotgun: 1.8 to
  2.0, 82 to 97 cm, 0.45 to 0.48 s. On flat ground every new ground step is inert (heights 0,
  normals up, no edge near, tread fit and hold-back skipped). Unchanged within spread: walk 1.9 /
  1.9, walkL 2.1 / 2.0, jog 1.8 / 1.8, turnAbout 3.4 / 3.3, crouchWalk 1.5 / 1.5, crouchToggle 2.0 /
  2.0, rampUp20 3.1 / 3.1 (at the bar, as before), rampDown20 2.0 / 2.0.
  Looked at (side, foot height): setting off at the foot of the stairs (right foot onto the first
  tread with the toe short of the riser, the knee lifting over each nosing, one foot to each tread)
  and from a run-up (steps shorten over the last metre, the foot rises to the first tread and is put
  on it, knee bent). Still: the knee lifts 10 to 15 cm more than a careful climber's (the clip's own
  swing lift on top of the line); setting off at the foot the trailing foot is left long on the
  lower tread; the 3.3 muzzle jolt in one rifle startStop is not traced.
- Rendering pass (2026-11-11, pass 10). The motion is now seen in a lit, graded picture. New
  `src/look.js` (sky, sun, shadow box, environment, haze, body and gun materials, the post chain,
  the `G` quality toggle) and `src/surfaces.js` (procedural yard materials, TSL noise in world
  space; nothing loaded). `main.js` hands the frame to `look.render()`; `range.js` / `ground.js`
  use the new materials; `fx.js` draws flash, tracers and sparks at 9 / 7 / 5 times white so the
  bloom finds them; `index.html` HUD (`G`, a "Picture" row); README "The picture".
  - Settings: sun 29 degrees up, azimuth 68 from +Z to +X, colour (1, 0.8, 0.6) x 8; `SkyMesh`
    (turbidity 3.4, rayleigh 1.35, clouds 0.32) scaled by 0.3, the same sky without its disc over
    a bounce-light ground baked into a PMREM (`environmentIntensity` 1); haze from that map,
    55 to 300 m. Shadow map 4096 over 22 x 22 m, 4 m ahead of the player along the view, snapped
    to its texel grid; PCF radius 2.2, bias -0.00025, normal bias 0.012. GTAO radius 0.6,
    scale 1.6, 12 samples, half resolution, temporal, denoised (half res) and fed to
    `builtinAOContext` (indirect light only). TRAA. Motion blur 0.45 of a frame, 10 samples, cap
    10 px at 720p, floor 0.75 px. Bloom threshold 3.0, strength 0.5, radius 0.3. AgX, exposure
    0.85; grade contrast 0.25, saturation 1.12, warm highlights / cool shadows, vignette 0.28.
    Body atlas: skin (ORM roughness 0.55, spec 0.44) gets a reddened wrap past the terminator,
    cloth (0.73 to 0.86) roughness 0.93, 40 % specular, sheen.
  - Frame cost (render + `onSubmittedWorkDone`, median of 30, standing / walking): 1280 x 720
    before 4.1 to 5.5 ms; after full 6.2 to 7.1, plain 5.0 to 7.2. 2560 x 1440 before 4.5; after
    full 8 to 13, plain 5 to 9 (noisy: the wait is mostly latency). The chain stays within about
    1.5x at 720p and 2x at 1440p. The one expensive thing found was a Worley pore pattern in the
    concrete (plain 45 ms at 1440p); replaced by value noise.
  - Review before -> after (3 runs each, same order): walk 1.9 / 1.9 / 1.9 -> 1.9 / 1.8 / 1.9;
    jog 1.8 to 1.9 -> 1.7 to 1.8; crouchWalk 1.4 to 1.5 -> same; reload 1.0 / 1.7 / 1.0 -> same;
    swap 3.7 / 2.3 / 3.7 -> same (grip 0, shotgun 0.2 to 0.3); stairsUp 2.3 to 2.5 -> 2.6 / 3.7 /
    3.9, and 10 more runs after 2.6 to 4.8 (sink 0.1 to 1.1): the known stairs spread (pass 9:
    2.1 to 3.4, coordinator 4.4 to 4.5). Nothing in the step path changed (it only counts steps for
    the motion blur); the review never renders.
  - Looked at (before / after pairs in `screenshots/render_before_*` / `render_after_*`, shotgun
    in the hands): standing front three-quarter and from the play camera, walking from the side,
    reload mid-way, a shot from the side (flash and bloom), the stairs and the ramps from outside,
    feet close (planted on their shadows, AO under the soles), hands on the gun (AO between arm and
    chest, cloth reads matte), a jogging camera turn (a light smear, not mush), first person idle
    and firing. Also the AO, velocity and normal buffers (skinned velocity is there). Not looked
    at: the rifle in the hands after the last tuning, crouch, hit reactions, other roster bodies
    (their atlases are assumed to use the same ORM values), the kerb, a live animation loop at
    speed (the pane is hidden).
  - Still open: no cascades (no shadows past about 11 m from the player); no screen-space contact
    shadows; gather-only motion blur (an outline does not spread); the flash's point light whitens
    a sunlit steel barrel for a frame; the skin wrap light is not shadowed; no depth of field; at
    a 2 device-pixel-ratio the whole chain runs at 2560 x 1440 (a render scale would halve it).
  - Traps: `PostProcessing` is now `RenderPipeline`; `directionToColor` / `colorToDirection` are
    `packNormalToRGB` / `unpackRGBToNormal`. The renderer's frame counter (`nodeFrame.frameId`)
    only moves in its own animation loop, and the shadow map, TRAA, GTAO's rotation, the velocity
    node and skinning's previous bones all key on it: `demo.render()` moves it on
    (`renderer._nodes.nodeFrame.update()`), else in the hidden pane the shadow never updated and
    velocity stayed zero (by the source, earlier passes' hidden-pane film strips probably showed a stale
    shadow map; not checked). Do not call
    `skeleton.update()` before a full-quality render (it makes previous bones = current: no
    skinned velocity). Velocity must be in exactly one pass's MRT (the per-object previous matrix
    is shared). `pass()` takes the renderer's MSAA unless `{ samples: 0 }` (TRAA wants none).
    The `SkyMesh` shader's scale is much brighter than a physically scaled sun: scale it (gain) or
    the fill swamps the sun and everything goes blue-white. Shader cost scales with pixels: test at
    2560 x 1440. Measure after a warm-up: the first seconds after a load or a pipeline rebuild
    are compiling and read 30 to 130 ms. Screenshots were written by a small local receiver
    (scratchpad `recv.py`, port 5199) that the page POSTs canvas JPEGs to.
- Final review pass (2026-11-11, pass 11). Game side only; no Blender build.
  - Trigger finger (the coordinator's close-ups: on the shotgun the index stood 45 to 60 degrees up
    into the air, also while firing). Cause: "straight" was the hand's own frame (`_arm` slerped the
    index joints from identity), and the shotgun's shouldered hand runs its fingers 45 degrees up the
    stock's wrist (`HAND.grip`, chosen for a straight wrist), so straight pointed 46 degrees above the
    barrel; on the trigger the old curl folded it over the top of the receiver, 9 cm from the trigger
    (the knuckle was 11.6 cm from it, the finger is 8.7 cm long). The rifle's hand runs its fingers
    forward, so its straight finger lay roughly along the gun, but its knuckle was 9.3 cm from the
    trigger and the pad never reached it (4.4 cm off on a shot). Now (`character.js` `_index`): the
    finger is laid on the gun itself, with targets in the gun's frame (`weapon.finger`: `rest`, where
    the tip lies along the lower receiver's side above the guard; `trigger`, where the end pad presses
    the trigger blade's front). The middle and end joints curl together as far as the reach needs, the
    knuckle flexes towards the palm and swings about the palm's normal to point at the target; rest
    and trigger are blended by the trigger share on a fast-in, slow-into-the-trigger curve, and the
    whole by `rOn` (the palm within 2 to 5 cm of its firing grip, so a hand that lets go in the swap
    takes the clip's fingers). The shouldered firing palm moved forward on the grip so the trigger is
    in reach: rifle 1.2 cm forward and 1 cm up (`grip.palm`), shotgun 3.5 cm forward and 1.9 cm down
    the stock's wrist with the fingers 37 degrees up instead of 45 (`AIM_PALM`, `HAND.grip`); the
    carried grips are unchanged (the reload and swap clips start and end there). Trigger discipline:
    the finger goes in at 45/s and the shot waits until it is 75 % in (`TRIGGER_ON`; the second frame,
    17 ms), comes off at 14/s, and is off while the gun is not ready (reload, the shotgun's pump, which
    begins on the shot frame). The swap lays the finger along whichever gun the firing hand has by its
    grip (`main.js`, `fingerTargets`). Review: new column `fingerCm` (`fire`: on each shot the end pad
    from the trigger's box; `rest`: off the trigger, with the hand on the grip, the tip from the
    receiver's side patch, and the most it points off the barrel). Before (solver off) -> after:
    rifle fire 4.4 -> 0.6, rest 0.0 to 0.4 at 23 to 24 deg -> 0.8 to 0.9 at 24 to 25 deg; shotgun
    aimed index 46 deg up, fire about 9 cm (by hand, the old curl) -> fire 0.6, rest 0.9 to 1.2 at 9 to
    14 deg. Wrists unchanged within 2 degrees (shotgun aimed firing -12 / -16 -> -13 / -17). Looked at
    (close-ups on the firing hand, from the right and front-right, ready, aimed, the shot frame,
    mid-reload, both guns): the index lies straight along the receiver above the guard pointing
    forward at ready, aimed and through the reloads; on the shot frame it is down in the guard on the
    trigger (rifle: nearly straight, angled in; shotgun: bent down out of the hand into the guard);
    the other fingers wrap the grip / wrist, the thumb on the far side. The shotgun's index swings up
    to about 60 degrees at its knuckle to reach the trigger from a hand whose fingers run up the
    wrist: from outside it reads as a finger in the guard, but it is past what a knuckle does (a
    re-authored shotgun grip, fingers round the wrist and the elbow higher, would fix it; the wrist
    search said -50 / -16 with the elbow at shoulder height).
  - Review tool: `burst` and `burstUp` start with a full gun and do not fire while settling (act(-1)
    held the trigger: a rifle emptied by an earlier row was mid-reload through the whole measured
    part, and the shotgun's `burst` in a full run measured a reload: no shot at all). The finger
    measure ignores a situation's prep (the shotgun reload's three shells out read as a shot) and
    counts only frames where the firing hand is on the current gun's grip (`rGun`).
  - Rendering: the muzzle flash's point light stands 40 cm out from the muzzle at intensity 5 (was
    15 cm, 7: inverse-square, the barrel's steel got about 40 times the sun for a frame); first person
    the motion blur is capped at 3 px (10 in third person), so the kicking near gun stays sharp.
    Looked at: a shotgun shot from the side (barrel not whitened), rifle first person firing (sharp).
  - Near-misses, traced: `aimHold` frozenPct is chance (0 to 8 rifle, 1 to 6 shotgun over 6 runs
    each; pass 4 recorded 3 to 12): the review never renders, and the rendering pass only added a
    step counter in the step path. `rampUp20` 3.2 / 3.2 (a foot on the slope; not traced). `turnAbout`
    3.3 to 3.7 both: the sprint's feet before the turn, snapUpper 2.1 to 2.8 (as pass 7). `startStop`
    muzzle 3.3 (pass 9): not reproduced in 12 runs (1.8 to 2.4). Swap firing wrist -46 / -47: the
    game's arm solve against the clip's ElbowR, as pass 8 found; not changed.
  - Found broken, not fixed: `rampCrouch20` run straight after `rampAcross20` holds the left heel at
    z 27.9 about 2.2 s in with its sole 8 to 20 degrees off the slope and up to 3.6 cm in it (run
    alone, after `rampStand20` or after `idle`: sole 3.6 to 4.3, sink 0.1); something from walking
    across the slope survives the review's reset. One full shotgun run read `turnCarried` floatCm 5.2
    and `startStopWalk` snap 3.7 (a foot); repeated, 0.2 to 1.0 and 1.8.
  - Also looked at: the other three roster bodies (review rows idle, walk, aimHold, reload with both
    guns: grip 0, finger rest 0.8 to 1.2, frozen 0 to 7; one aimed frame each: hands on, gun at the
    shoulder clear of the body), crouched aim and reload (shotgun), a heavy hit from the front, first
    person aimed and firing, the `G` toggle both ways.
  Traps: a review row's `act(-1)` is held through the settle (a repeating `t % 2` pattern is on at
  t = -1); `demo.view` looks at the body's centre, so a close-up of the hand needs the camera placed
  by hand after each step (aimed at `RightHandIndex1`, offset in the look frame by `camYaw`).
- UE5 re-rig, pass R1: skeleton and bodies (2026-11-11). The user: "let's re rig the whole thing into
  UE5 we will use mannequin for future purpose". Spec, mapping and traps: `blender/ue5_rig/UE5_SKELETON.md`;
  scripts `blender/ue5_rig/` (`ue5.py`, `proof.py`, `build_ue5_rig.py`: `bl.py run`, about 7 s, every body);
  mapping `blender/ue5_rig/ue5_mapping.json`; rig `blender/ue5_rig/ue5_rig.blend`; numbers and sheets
  `blender/review/rig/`. Game code, the clip pack and the old bodies are untouched (R2 / R3 port them).
  - Skeleton `earthonline-ue5-v1`, 90 bones: root, pelvis, spine_01..05, neck_01/02, head, clavicle /
    upperarm / lowerarm / hand, thumb_01..03, four metacarpals and fingers 01..03, thigh / calf / foot /
    ball, two twist bones on each upper arm, forearm, thigh and calf, ik_foot_root / ik_foot_l/r,
    ik_hand_root / ik_hand_gun / ik_hand_l/r; extras jaw, eye_l, eye_r. Left out: Manny's corrective
    helpers. Every old joint has a new bone at exactly its place; spine_02 / 04 and neck_02 half way;
    metacarpals from a quarter of the way out of the wrist to the knuckles; the eye bones at the
    eyeball centres (sphere fit to the 256 / 257 eye vertices, r 1.6 cm; the old joints were 2.0 cm
    above, 2.7 behind). Bones along +Y, Z to the side the joint flexes towards, flexion +X everywhere,
    mirrored rolls; rest rotations are NOT identity any more (upper arm (0,0,1,0), thigh (1,0,0,0), ...).
  - Bind stays the I-pose (arms down); the mesh bytes are the source's. An A-pose bind was tested
    (same skeleton and weights bound in a Mannequin-like A-pose): creases at the back and front of the
    armpit at rest, deeper shoulder / armpit folds aimed and arms forward; shoulder edge strain worse
    in mean and max nearly everywhere (aim level mean 0.216 -> 0.235, max 5.2 -> 5.5; arms forward max
    4.6 -> 5.6; arms down 0 -> 0.05). Kept I; the A-pose is a named retarget pose in the JSON (`ue5_apose`).
  - Weights split from the old ones, never re-painted: by height across the spine and neck pieces,
    along the limb onto the twist bones (forearm twist ramps evenly from 15 % to the wrist, the elbow
    keeps its skin), up to 40 % of the distal palm onto the metacarpals, 4 influences (pieces folded
    back into a sibling, nothing dropped). One skinned mesh holds body, clothes, hair, brows, eyes and
    teeth (107 pieces): all of it done.
  - Proof (player; all four bodies written and checked at rest): with the old pose mapped exactly
    (twist bones at rest) the new body equals the old to 0.0001 mm in 8 clip poses (idle, aim level,
    aim up, reload, crouch, sprint, swap, walk). With the twist bones driven (forearm 0.47 / 0.88 of the
    hand's twist, upper arm -0.5 / -0.25 of its own, thigh -0.3 / -0.15, calf 0.24 / 0.44 of the
    foot's): vertices without twist weight within 1.4 mm; twist-weighted ones move on purpose up to
    81 mm (the right forearm, where the old wrist was wrung: the clips put all pronation in the Hand
    joint, -72 to -77 degrees carried / aimed, +155 in the swap). Wrist kept (radius against rest)
    forearm twisted 90: min 0.71 -> 0.95, mean 0.84 -> 0.99; in the clips, right mean 0.87 -> 0.96
    carried, 0.66 -> 0.95 swap. Edge strain in clip poses (shoulders, forearms, hips): mean lower or equal
    everywhere (pivot hips 0.31-0.41 -> 0.25-0.35, swap right shoulder 0.356 -> 0.331); p99 up a hair in
    three places (crouch left hip 3.88 -> 4.01). Eyes turned 25 degrees: ball centre 0.000 mm (old joint 14.6 mm).
    Blender's own deform with an armature built from the spec matches to 0.0007 mm; the glTF importer
    reads the bone frames to 3e-6; three.js loads all four (90 bones, 16 morphs), rest = old 0.0001 mm.
  - Looked at (`blender/review/rig/`): forearm twist ±90 (old wrist a thin stalk, new full, elbow
    unchanged), the right forearm in carry / aim / reload / swap (old cuff pinched, new full; the swap's
    new sleeve shows twist folds along the forearm), upper arm forward / side / twist ±70, elbow 145,
    wrist ±60/70, knee deep, spine bend and twist (exact = old; spread over 5 bones max strain 1.10 ->
    0.93), neck turn 70 (70/30 on neck_01/02: p99 0.302 -> 0.297; an even 50/50 split with
    segment-middle weights had a sharper fold at the throat, so the neck weights are split at the
    bones' heads), eyes ±25 (old ball slides out onto the temple, new stays), the A-pose close-ups.
  - Not done here (R2 / R3 / R4): clips on the new skeleton, the twist bones' run-time drive, the game's
    port (rest rotations, names, eyeBall correction removed), FBX and the Unreal check.
  Traps: Blender's glTF importer also makes an `Icosphere` bone-shape MESH object and links it into
  the clip pipeline's `Scene` even when another scene is active; "the first new mesh after the
  import" picked that Icosphere (it sorts before `OriginalCivilian...`), so the first R1 builds renamed
  and parented two of those importer Icospheres (both made by R1's own imports; then removed, the
  pipeline's `Scene` back to its 48 objects; `rifle_motion.blend` was never saved). Pick the body as
  the mesh that is not one of the imported armature's bone shapes, and check it is in your scene. With
  this skeleton a Blender pose bone's quaternion is `restLocal^-1 * local`, not the glTF local rotation.

- UE5 re-rig, pass R2: the clip pipeline and every clip on the new skeleton (2026-11-11).
  `blender/build_rifle_motion.py` now reads only `civilian-m-01-player-ue5.glb` (`BODY` / `FRAMES` at
  its top choose the body) and writes `public/characters/rifle-motion-ue5-v1.glb` / `.json` (80 clips,
  same names, frame counts, timing, events and notes; 6.7 MB against 3.9), reviews into
  `blender/review/ue5/`, saves `blender/rifle_motion_ue5.blend`. Full build 8.5 minutes. The old pack,
  old bodies, `blender/rifle_motion.blend` and `blender/review/clips.txt` are untouched; the game still
  plays the old pack until R3. Details: `blender/ue5_rig/UE5_SKELETON.md`, "Clips on this skeleton".
  - Approach: the authoring math stays in canonical frames (each bone's frame turned back to the
    world axes: `C[b] = W[b] * R[b]^-1`; canonical locals = the old skeleton's locals). Only `skel.py`
    (R[b] from the body, canonical FK), `rig.py` (canonical rig bones, an `SK-` child per skeleton bone
    with its real frame), `bake.read_pose` and the GLB writer (`bake.export`, now writing the file
    directly: `local = R[p]^-1 * Lc * R[b]`) convert. Names are UE5 names everywhere. The finger grip
    and the old eye-joint points the aims weld to were converted once into `rifle_motion/ue5_data.json`.
  - Exact mapping kept for the spine (spine_02/04 at rest) and neck (neck_02 at rest): spreading was
    not tried in this pass (later improvement; R1's ROM numbers favour it). Twist bones keyed with R1's
    shares, unwrapped frame to frame; IK bones keyed; transitions' travel on `root` (and still in the
    notes' `root`, see `rootMotion`).
  - Proof (`blender/ue5_rig/pack_equivalence.py` -> `blender/review/ue5/equivalence.txt`, old body + old
    pack against new body + new pack, every clip at 60 fps): joints 0.0034 mm, hand / foot / head /
    pelvis orientation 0.0002 deg, Gun and extra tracks 1.7e-6, skin with no twist weight 0.0035 mm,
    new body with twist bones at rest 0.0035 mm. Skin under 1 % twist weight: 0.43 to 0.85 mm in most
    clips, 1.4 / 1.8 mm in the swaps (1 % of a wrist that now turns 140 degrees: the 0.5 mm aim cannot
    hold at a 1 % cut). Twist-weighted skin: mean 4 to 7 mm, max 32 to 88 mm (right forearm).
  - Found: the old swaps turn the right hand a whole turn about the forearm (swap-rifle-shotgun -77 to
    -390 degrees), and reload-rifle-empty the left hand a whole turn (+322). No continuous twist share
    can follow that and end where the next clip starts, so the twist bones give that turn back the
    short way over 6 frames where the hand turns fastest (`bake.twist_series`). Largest twist step per
    frame: 74 deg (swap-rifle-shotgun, lowerarm_twist_01_r, where the old hand itself turns 73 deg in
    a frame), 27 (reload-rifle-empty), under 18 in every other clip, under 7.2 outside the handling clips.
  - Wrist kept (R1's measure, right): carry 0.87 -> 0.97 mean, aim level 0.88 -> 0.98, reloads 0.93 ->
    0.99, swaps 0.85 -> 0.96.
  - Review (`compare_clips.py`): with the twist bones at rest (`REVIEW_TWIST = False`) the review
    reproduces the old numbers: every gunHits, gunClearCm, slungClearCm, gripCm, snap30, wrist, elbow,
    knee and headY value of the 80 exported clips is identical (a second full run, review only); with them keyed, only gun-against-body numbers change: the
    right wrist keeps its girth and now meets the pistol grip (68 triangle pairs held low, up to 3337 in
    a reload), so gunClearCm drops to 0 in most rifle clips. The grip / hand placement was tuned against
    the collapsed wrist: re-tune with the twist on (next pass). Foot slide differs in the third decimal in
    27 clips, and 0.230 -> 0.075 m/s max in two pivots: a tie in the review's heel-or-ball choice
    (heel and ball 1e-7 m apart against their thresholds) breaks the other way. Not a pose difference.
    rifle-crouch-idle seam 0.83 -> 0.82: the seam measure now leaves the eye bones out (they moved to
    the ball centres). Looked at (`blender/review/ue5/`): rifle-idle, rifle-walk-f, rifle-aim-level,
    reload-rifle-tac, swap-rifle-shotgun, rifle-crouch-walk-f, hit-heavy-f: the same motion as the old
    sheets, nothing broken; `forearm-swap-rifle-shotgun.png` (top twist keyed, bottom at rest): with the
    hand back over the shoulder the keyed sleeve shows twist folds along the forearm where the old one
    was smooth but wrung at the cuff; elsewhere the two rows look nearly alike under the jacket sleeve.
  Traps: three.js and Vite: `import('/@id/three/...')` in the console fails with 504 after Vite
  re-optimises; import `/node_modules/.vite/deps/three.js?v=<hash>` as the page does. bl.py returns
  only when the build ends: wait for the output files. The glTF importer's Icosphere bone shape is
  still there; the rig and review ignore it.

- 2026-11-11, pass T1a (merged here from `blender/bodies/tripo/TRIPO_BODY.md`): Tripo main character
  prepared as the player body. blender/bodies/tripo/tripo-player-ue5.glb: 1.75 m, Tripo's T-pose bind
  and bone axes kept, + 7 IK bones (87 bones), no morphs / eye / jaw bones. A per-body frame file
  (tripo_frames.json) gives R[b] = A[b] * bindWorld[b] so boneWorld = canonicalWorld * R[b]. A[b] comes
  from geometry against R1's measured anatomy; the method reproduces R1's own frames within 0.0
  degrees (limbs, trunk, feet) and 4.8 degrees (fingers; R1's palm Z came from world +Z). Weights:
  upper-arm and thigh twist groups relabelled (Tripo has them reversed); strays past the elbow / knee
  removed; twist shares refit. Deformation in the clip poses: good to acceptable everywhere.
  Follow-up the same day: the clavicles keep their modelled posture (the shoulder joint no longer
  moves 2.9 cm forward in the canonical pose). The torn-looking fold under the shoulder blades in
  arms-down poses is gone. Its cause was a few percent of upper-arm weight on upper-back skin inboard
  of the shoulder joint, which the lever swings up over its neighbours when the arm comes down. That
  weight now goes to the clavicle; folded upper-back edges are about halved. An A-pose re-bind
  (Blender Preserve Volume + Corrective Smooth) and a canonical re-bind were tried and measured worse;
  the A-pose body is kept in alt/. A soft fold under the shoulder blades remains. Metrics (eyes from
  the texture, palm, fingers, feet, front surface) are in tripo_metrics.json. Re-run:
  blender/bodies/prepare_body.py (any UE5-named GLB), deform_proof.py.

- 2026-11-11, pass T1b: the clip pack built for the Tripo body. The user: "put this into the main
  character". `public/characters/rifle-motion-tripo-v1.glb` / `.json` (80 clips, same names, events
  and JSON fields as `rifle-motion-ue5-v1`; 6.5 MB; `body: tripo-player-ue5.glb`), the body, frames
  and metrics copied beside it (`tripo-player-ue5.glb`, `.frames.json`, `.metrics.json`); scene saved
  as `blender/rifle_motion_tripo.blend`; review in `blender/review/tripo/` (clips.txt, twist.txt,
  pack_check.txt, 80 sheets + close-ups). Build: `BODY_NAME = 'tripo'` (README, "Animation clips");
  about 13 minutes with the close-ups. Details: `blender/ue5_rig/UE5_SKELETON.md`, "Per-body tables
  and other bodies".
  - Per-body table: every body measurement the pipeline had hard-coded is in
    `blender/rifle_motion/bodies/<body>.json` (`rifle_motion/body.py`), selected with BODY / FRAMES.
    The old player's table holds today's values: 7 clips rebuilt from it (rifle-idle, -walk-f,
    -aim-level, reload-rifle-tac, rifle-crouch-walk-f, swap-rifle-shotgun, rifle-pivot-l90) are
    bit-identical to R2's pack, every channel and key, notes identical, after all of T1b's code changes.
  - The other-body path needed: frames key `R`; the rig built on the CANONICAL joints (it used the
    T-pose bind heads), SK- frames turned by A[b]; twist measured from and keyed on the canonical
    local (Tripo's forearm twist bones are pre-turned ~67 degrees there) with the body's own shares;
    clear_twist to the canonical local; the kit in the pelvis's canonical frame (the bone frame is
    turned 88 degrees); `REACH_SWING` per body (an absolute 0.755 m lowered the walk's hips 5 cm on the
    longer leg); the aim's cheek weld could not reach the eye's place (7 to 10 cm short) once the
    pocket was right: new `aim.toFace` brings the gun to the face (weld now 0.03 to 0.08 cm).
  - Fitted (Tripo table vs the old body): legs 0.4149 / 0.4016 (0.38 / 0.40), ankle 0.088 (0.08) above
    the sole, pelvis 3.57 cm (6) over the hip joints, hips 0.186 apart (gait widths +1.76 cm, stance
    0.9 cm further out each side), heel pivot 6.2 cm back, the ball pivot on the sole under the ball
    joint (bare foot), crouch drop 0.325 (0.33). Upper body: the torso is 3 to 5 cm further back than
    the old jacketed body relative to the chest joint and the shoulders 4.3 cm: holds 2.5 to 3.5 cm
    closer (low ready also 1 cm further right), slung guns 3 / 4 cm further back, support hand 1.5 cm
    further forward on the rifle (carrySlide 0.045) and 4 cm further back on the shotgun pump (0.16),
    the swap's incoming gun 4 cm nearer the chest (`swapShift`). Aim: pocket (-0.15, 0.17, 0.07) and
    the eye 13 cm behind / 5 cm above eyeLocal (was 6 / 4.5), trunk 6 degrees further forward,
    support palm 5 cm back aimed 45 down (the arm locked straight before). sightEye = the painted eye
    point (head frame) + R2's weld-point offset.
  - Belt kit: an elliptic webbing belt over the T-shirt hem (fitted from the girth profile + 6 mm),
    the pouch 74 degrees and the shell loops 108 degrees round it from the front, turned to its
    surface (new shape kind `band`, optional `yaw`); the drawing hand turns with it.
  - Whole-turn twist (item 6): the swaps' firing hand and reload-rifle-empty's support hand are now
    rolled a whole turn about their own long axis during the move that wound the forearm (applied
    after the path smoothing, which averaged it away at first). The right forearm twist stays within
    -216..-25 degrees (was -463..-27), reload-empty's left -58..+124 (was -40..+322); no unwinding.
    Largest frame step 42 / 48 degrees in the swaps (was 74 / 61), 26 in reload-empty (27). Only with
    `unwind` in the body's table: the old roster pack is unchanged.
  - Review against R2's pack (both with twist keyed): clips with gun-against-body hits 76 -> 9, triangle
    pairs 65,188 -> 1,635, clips at 1 cm clearance or more 2 -> 70; slung pairs 1,947 -> 1,015. gripCm 0
    everywhere except swap-shotgun-rifle left 2.64 cm (R2 0.30) over frames 30 to 33 with the arm
    straight. Misses: aims (rifle / shotgun level, up, down: 113 to 336 pairs, the cheek on the comb and
    the stock in the upper chest; R2 82 to 599), reloads 57 / 91 (the support forearm on the magazine;
    R2 3,392 / 4,378), swap-rifle-shotgun 195 (forearm in the stock over the shoulder; R2 1,489),
    rifle-run-turn-r 0.5 cm clearance. Slide and knees as R2 (sprint mean 0.485 m/s in this review's
    measure, R2 0.392; the game's own measure is the target). Crouch: head 37 to 40 cm lower than
    standing (R2's measure on the old body 36 to 39); rifle-jog-stop-5 is 27 frames (R2 32).
  - Wrist (pack_check.txt, R1's measure on the Tripo skin): right wrist radius kept mean 0.97 to 1.00
    in every clip, min 0.91 to 0.96 except the swaps (0.42 / 0.65 at the over-the-shoulder frames).
  - three.js (preview console, GLTFLoader): 80 clips on 87 bones, every track binds, joints match
    Blender's to 0.089 mm (rifle-walk-f frame 0), posed soles at -0.6 mm.
  - Not done: the old roster pack with the grip re-tuned against the full-girth wrist (item 7); the
    swaps' right wrist deviation reaches +58 degrees mid-move with the roll (R2 -35); the eye sits about
    1 to 1.5 cm above the sight line in the level aims (to the eye); the shotgun's trigger finger points
    up off the receiver.
  Traps: Gaussian path smoothing averages a fast whole-turn roll away: give such rolls after the
  smoothing. Each `bl.py` call runs in a fresh namespace (settings such as ONLY / BODY_NAME
  must be sent with the script every time); `bpy.app.driver_namespace['rifle_motion']` does persist
  (the last build's rifle scene, for fitting scripts). The review's `clearBy` / `slungBy` name the parts that
  limit clearance. A partial build with `PATCH = 'export'` writes a pack of its own (never the real one).

- UE5 re-rig, pass R3: the game on the new skeleton (2026-11-11). The user: "let's re rig the whole
  thing into UE5 we will use mannequin for future purpose" and "put this into the main character".
  The game now loads only `earthonline-ue5-v1` bodies: the Tripo player first (`tripo-player-ue5.glb`
  on `rifle-motion-tripo-v1`), `N` through the four EarthOnline `-ue5` bodies (`rifle-motion-ue5-v1`).
  Pre-R3 sources: `~/Desktop/Code/test/backups/ar_rifle_demo-pre-ue5-2026-11-11.tar.gz`.
  - Design: a rig adapter (`src/rig.js`). The run-time layers keep the old math by posing a PROXY
    skeleton (plain bones under the old 56 names, identity rests, the body's canonical joint places
    from its frames file or rest pose); `Rig.apply()` after `poseArms` writes the real bones,
    `boneWorld = proxyWorld[old joint] * R[b]`. `src/motion.js` bakes each pack's real local rotations
    into the old joints' canonical locals (`C = W * R^-1`, local = `C[old parent]^-1 * C[bone]`); the
    Gun / GunIn / Palm / Elbow tracks are already canonical chest-frame values (checked: rifle-hold-low
    Gun = the table's low hold (-0.15, 0.17, 0.115)). Played raw onto the body (every track of
    reload-rifle-empty at 1.0 s) and through the game the left arm looks the same.
  - Spine: spine_01 / spine_02 share the old Spine turn 50/50 and spine_03 / spine_04 the old Spine1's
    (as the weights are split); spine_02, spine_04 and spine_05 keep the proxy's world turn exactly and
    spine_03 / spine_05 are pinned to the proxy's joints (bone translation at most 1.7 to 3.3 mm). Neck
    NOT spread: the cheek weld (`_seatEye`) turns the old Neck far and counter-turns the Head, and 30 %
    on neck_02 put the head joint 19 mm off where the game solved it (aimed walk); neck_02 and the
    metacarpals stay at their canonical locals (the clips' exact mapping).
  - Twist: the forearm is a hinge (`FOREARM_TWIST` 0.6 -> 0; the old skeleton had no twist bones) and
    the twist bones are re-driven every frame from the final pose (after arm and leg IK) by skel.py's
    rule with the body's shares (Tripo's frames `twistBones`, R1's for the EarthOnline bodies),
    unwrapped frame to frame, and held while the measured swing nears a half turn (an upper arm over
    the shoulder in the swap gave the swing-twist split nothing to measure: 150-degree jumps). Hand
    twist range through the swaps -245..-31 (right), reload-empty left -56..+142, as the clips. Found
    and fixed: a one-frame 146-degree flip of the left elbow at the shotgun-to-rifle swap's handover
    (the clip's ElbowL pole lined up with the arm); the arm IK now keeps last frame's bend direction
    where the pole stops saying (`solveTwoBone` `keep`). Largest twist-bone step after it 29 deg/frame.
  - IK bones re-driven to follow the final feet and hands (ik_foot_l/r = foot, ik_hand_gun = hand_r,
    ik_hand_l = hand_l in its frame, ik_hand_r identity); root held at rest (travel by notes `root`).
  - Per-body data (`public/characters/<body>.game.json`, `blender/bodies/game_tables.py`): palm, ankle
    height, heel and sole points, foot length either side of the ball (the stair code's look-ahead was
    tuned to the 7 cm shoe toe; Tripo 8.1: stairsUp toe-in-riser 1.5 to 2.0 -> 1.0 cm), trigger tip /
    pad, aiming eye, cheek weld, pocket, per gun the carried support slide, slide limit and support
    elbow pole, the aim stance's extra width; `face`, `atlas` flags. Per-arm lengths (Tripo's right
    forearm is 3 mm longer: right grip 0.3 cm -> 0). Surface height fields read from the body skinned
    into its canonical pose (Tripo binds in a T-pose). The belt kit builds the new `band` and `yaw`.
  - Face: eye bones at the ball centres, `eyeBall` correction removed; the Tripo body (no eye / jaw
    bones, no morphs) has the face layer off and `-` in the eye columns. look.js's atlas dressing only
    for the EarthOnline bodies.
  - Cheek weld re-tuned for Tripo (table `cheek`, new `cheek.up` read by main.js): eye above the sight
    line level 2.8 -> 2.0 to 2.2 cm, 45 down 4.7 -> 3.4 to 3.8, 45 up 1.1 -> 1.3 to 1.4 (lifts the jaw
    off the comb). The neck's reach limits the rest: lowering the target 2 cm more moved the eye 1.2 cm
    and drove the face 2 cm into the stock's box. EarthOnline (eye bone = ball centre): -0.3 to 1.4.
  - Numbers: "Quality bar", the R3 table. Looked at (close-ups in the game, hidden pane, overlay +
    zoom): rifle carried, aimed and on the shot frame (both hands on, index along the receiver, in the
    guard on the shot, other fingers round the grip); wrists and forearms aimed, in the reloads and
    mid-swap (full girth, no candy-wrap); the left hand at the belt pouch, the shotgun reload at the
    loops; cheek weld level / 45 up / 45 down from both sides; crouch idle; bare feet on the 20-degree
    ramp (walking up, standing across) and the stairs; the upper back aiming from behind; an eye flick
    on civilian-m-01 (balls stay in the sockets, eyes lead the head).
  - Found, not fixed: (1) Tripo's inner elbow shows a flat, bright, sharp-edged triangle when the elbow
    is bent past about 90 degrees (reload support arm, swap firing arm); the raw clip on the body shows
    the same, normal map on or off, twist bones on or off: a skinning / weight limit of the body at
    the elbow (T1a rated elbows "acceptable"). (2) swap-rifle-shotgun's muzzle snap 4.4 to 4.9 (target
    4.0; EarthOnline 3.7): T1b's re-authored swap. (3) Swap firing wrist deviation +59 (T1b's roll).
    (4) rampCrouch20 run after the other ramp rows: heel held 3.4 to 5 cm into the slope, sole 20 deg
    (alone: 0.1 / 3.1), the pass-11 bug, now also after rampStand20. (5) Hits snap 3.3 to 3.5 (pass 11
    2.3 to 3.5; target 4). (6) A planted foot read 3 cm above the ground for a frame in two rows (swap,
    reloadEmpty, at the review's start). (7) The Tripo page takes 10 to 30 s to load in the hidden pane
    (the body GLB, 12.7 MB).
  Traps: the hidden pane's screenshots can be stale; `computer zoom` of the overlay region returns the
  current page (zoom twice if the first looks old). Keep overlays within the 1024 x 768 viewport. A
  review row that swaps hands the other gun to the next rows.
- UE5 re-rig, pass R4: FBX for Unreal Engine 5 (2026-11-11). Everything in `unreal/` (README there:
  import steps, settings, Manny retargeting, checklist); scripts `blender/export_unreal/`; one command
  `python3 blender/export_unreal/make.py` (headless private Blender, hashes inputs per output and per
  clip into unreal/manifest.json, re-exports only what changed; `--force`, `--no-proof`).
  - Delivered: 5 bodies (`bodies/*.fbx`, textures embedded (base colour, normal) and as files in
    `bodies/textures/`, 16 morphs on the EarthOnline bodies), 80 + 80 clips (`animations/tripo|earthonline/`,
    one per file, skeleton only, 30 fps, every GLB key a frame, notes.json beside), A-pose retarget
    poses (`retarget/`), the rifle and shotgun as static meshes (`weapons/`, cm, origin at the butt in
    the Gun bone's frame, parts separate, SOCKET_ nulls), contact sheets and numbers in `unreal/review/`.
  - Settings: Blender scene in cm (unit scale 0.01), apply_unit_scale, FBX_SCALE_NONE, global 1 ->
    UnitScaleFactor 1 (cm); axis_forward Y / axis_up Z (Blender's own: no conversion matrix; the file is
    Z up, front -Y, as Unreal imports into); bone axes Y / X (FBX joint frames = glTF joint frames);
    armature object Null named `Armature`; no leaf bones; deform-only off; every bone every frame,
    simplify 0. The skeleton is built from the GLB data, not the glTF importer's armature (which also
    leaves an Icosphere); only the mesh comes from the importer.
  - Gun and GunIn are bones (leaf bones under spine_05) in every skeleton: Gun rest = rifle-hold-low,
    GunIn rest = the rifle's slung place. The packs author them in spine_05's CANONICAL frame: on Tripo
    (spine_05 turned 85 degrees about Y) the bone local is R[spine_05]^-1 * track. PalmL/R, ElbowL/R
    dropped. root, ik_foot_root, ik_hand_root take world-aligned frames (identity in Unreal) so root
    motion is a ground-plane translation + yaw about Z; every other bone keeps its glTF frame.
  - Proof (fresh Blender re-import vs numpy FK of the GLB, every bone, every frame, 14 clips per pack):
    Tripo worst 0.0084 mm / 0.0019 deg; EarthOnline 0.0018 mm / 0.0019 deg except the two swaps
    (0.053 mm / 0.074 deg, Euler near the whole-turn roll); Gun 0.0009 mm; root vs notes `root`
    0.0003 mm; root travel read from the FBX's own curves (28 clips per pack) 0.00001 cm. All 167 FBX:
    UnitScaleFactor 1, Z up, one root bone `root`, no Armature bone, bones and parents = GLB + Gun,
    GunIn, frame counts = GLB keys at 30 fps. Height in file units: Tripo 175.000, EarthOnline
    175.53 to 175.67 (shoe soles below 0 as in the GLBs). Bodies: rest 0.0013 mm, morphs 0.0004 mm;
    skin (body FBX posed by the animation FBX vs GLB skinning) 0.0053 mm Tripo, 0.0030 mm EarthOnline.
  - Spot check by the main session (own script, private Blender): `tripo-player-ue5.fbx` 89 bones, one
    root, 1.750 m, faces -Y, not mirrored; `rifle-jog-start.fbx` 29 frames at 30 fps, root travel
    2.1603 m forward (notes 2.16035). `civilian-f-02-hero-ue5.fbx` 92 bones, one root, 16 morphs;
    `rifle-pivot-l180.fbx` 37 frames, root travel (0.108, 0.092) as in the notes.
  - Not checked (no Unreal here): the import itself, facing (+Y expected, like SKM_Manny), root motion
    in a character, materials (ORM by hand, normal green flip), IK Retargeter against a real Manny.
  Traps: Blender's glTF importer scales by the scene unit scale (import at 1.0, export at 0.01).
  axis_forward '-Y' with up 'Z' is NOT Blender's system (writes a 180-degree yaw on the root null); 'Y'
  is. On the shared EarthOnline skeleton the FBX carries m-01's jaw / eye translations: set
  translation retargeting to Skeleton except root, pelvis, IK and gun bones. Animation FBX bake on a
  very loaded machine (load average 110 to 160) ran 5 to 11 minutes per 80 clips.
  If the game port rebuilds any clip, re-run `python3 blender/export_unreal/make.py`.

- Pass F2: game-code fixes after R3 (2026-11-11). The user, shown the remaining defects: "Yes, fix them".
  F1 worked on the body and the clips in Blender at the same time; F1's new body GLB landed at 18:43
  (12,731,044 -> 4,267,504 bytes); the pack did not change. Task-1 and the first cheek numbers were taken on
  the old GLB; the final review, the cheek tune's last values, the load times and the EarthOnline check
  on the new one.
  - Heel in the 20-degree ramp (rampCrouch20 after other ramp rows). Cause: nothing carried over but
    where the feet start. The crouch walk's second left footfall comes down with its ball 0 to 12 cm up
    the slope and its heel on the flat (where it lands depends on the stance and phase it set off from,
    which the rows before move by up to 15 cm). `_footGround` read the surface's normal under the ball
    only and step 7 turned the sole to it about the ball: the sole lay along the slope's plane, which
    below the ramp's foot is under the flat, so the heel went 3 to 5 cm into it (and walking down
    crouched, a ball just over the top's edge did the same the other way). Fix (`character.js`
    `_soleFit`, called from `_footGround`): the sole's slope through the ball is kept above the ground
    under the heel, the toe tip and both ball edges; where no turn about the ball clears both (the ball
    in the hollow), it lies on the chord and the ball is raised (`foot.raise`, also used by a planted
    foot). Not near a step's edge (the tread fix handles those). Review: `soleDeg` on a crease is taken
    against the chord heel-ground to toe-ground; new `soleAt`; new row `rampSequence20` (walk across,
    stop, crouch, turn, walk down onto the flat, turn about, walk up crouched). Before / after, six runs
    each order: rampCrouch20 alone 0.1 / 0.1 cm; after rampAcross20 1.0 to 3.4 -> 0.1; after
    rampStand20 1.7 to 2.1 -> 0.1; after idle 1.1 to 5.5 -> 0.1; after rampAcross20 + rampStand20,
    rampUp20, rampDown20 -> 0.1 (sole 2.7 to 3.9 deg in all); rampSequence20 2.3 to 5.0 (old code, six
    runs) -> 0.2 to 0.9 (new, twelve runs; the rest of it is a landing's sole still easing flat on the
    slope, mid-slope, as in rampUp20). Crouched walking down the slope (one-off row): 3.1 -> 0.3 to 1.3.
  - Cheek weld on the Tripo body. The review's stock box was coarse; new measure `skin` (the gun's own
    mesh). The face was already 1.2 to 1.5 cm inside the stock at R3's values: the jaw's angle (head
    frame 5 to 6 cm right, 0 to 3 cm below the head joint) on the back of the comb, 1 to 3 cm in front
    of the butt. Tried: more head cant (+6 deg: eye 0.3 higher, skin unchanged; -6: no change), the eye
    target lower (eye 0.8 at level but skin 1.6), the head forward or back along the comb (forward 3 cm:
    -0.1 cm skin aimed down), the stock lifted in the pocket (2 cm: eye 0.9 lower, skin unchanged),
    the clavicle shrug with it. What works: the head nodded forward over the stock (nose towards the
    charging handle; `cheek.nod` 16 deg, `nodDown` 8 more aimed 45 down), which lifts the jaw's angle and
    moves it back off the comb, plus the stock brought across in the pocket to the eye (`lift`,
    `liftUp`, `liftDown`: chest frame) and the weld target re-fitted per pitch (`back`, `up`, `down`),
    solved numerically for the eye on the sight line. New table fields read by `character.js`
    (`_seatEye`: `cant`, `nod`, `nodUp`, `nodDown`; poseBody: `lift`, `liftUp`, `liftDown`, `liftDeg`)
    and main.js now reads the cheek values each frame. Allowance: 0.8 cm of skin inside the gun. Result
    (rifle / shotgun): eye vs sight line level -0.1 / -0.6 up and 0.0 / -0.8 across, 45 up 0.0 / -0.3,
    45 down 0.0 / 0.0; skin level 0.8 to 1.0 / 0.2 to 0.4, 45 up 0 / 0, 45 down 1.1 / 0.9, rifle burst
    1.6 (recoil drives the stock back into the jaw). Over the allowance: rifle level by up to 0.2, 45
    down by 0.3, burst by 0.8; shotgun 45 down by 0.1. Cant 12 to 17 (clips' own; nothing added). A
    forward part in liftUp (1.5 cm) made the shotgun's support hand jolt 4.0 in burstUp: left at 0.
    Looked at (right side and front, gun frame and world up, level / 45 up / 45 down): cheek on the
    stock, the head over it, neck continuous from the shirt collar to the jaw in every view; at 45 up the
    head nods onto the comb. EarthOnline (no new fields, same code path): civilian-m-01 cheek level 1.4
    up / -1.3 across, 45 up -1.8 / -3.4, 45 down 1.6 / -2.6 (R3: -0.3 to 1.4 height only); looked at
    all three pitches, unchanged.
  - Face by capability (`character.js` use / `_face`): `body.face` is { eyes, blink, brow, mouth } or
    null; eye turning needs the eye bones, blinks the two blink morphs, brow and mouth their morphs. The
    lid's look-down share only where the eyes turn. Review: eye columns by `face.eyes`, `blinkS` by
    `face.blink`. Tested on civilian-m-01 with its eye bones masked by a temporary flag (removed): blinks
    0.4 / 2.8 / 5.0 s, aim squint on the left lid 0.22, eye bones at rest, eyeMoves `-`. Unmasked: eyes
    0.7 to 0.8 saccades/s at rest, 2.0 to 2.5 on turns, eyeOutMm 0, blinks 0.4 / 3.0 / 5.9. The 18:43
    Tripo GLB has no morph targets: blinks do not run on it yet.
  - Hit reactions: not the port. R3's 3.4 / 3.3 / 2.8 to 3.2 were measured on the SHOTGUN (in a
    rifle-first run the swap rows before the hits hand over the shotgun) and compared with pass 11's
    rifle. Now rifle 2.6 / 2.6 / 2.4 (pass 11 rifle 2.7 / 2.6 / 2.3), shotgun 3.5 / 3.5 / 3.2 (pass 11
    shotgun 3.5 / 3.5 / 2.9). Nothing changed.
  - Not reached: the foot 3 cm above the ground for a frame early in `swap` / `reloadEmpty` (both rows
    read float 0 in both runs here); stairsUp 4.9 once (2.6 / 2.7 here, not repeated six times);
    aimHold frozen 12 once (1 / 3 here, not repeated).
  - Load time (`performance.mark('load:*')`, `demo.loadTimes()`): new GLB, warm HTTP cache, hidden pane:
    renderer 5 to 12 ms, PMREM 71 to 76, pack fetch 38 to 55 + parse 79 to 352 + bake 29 to 63, guns
    (two GLBs of 23 and 27 MB, in parallel with the pack) done 477 ms after the pack, body fetch 20 to 28
    + parse 190 to 277 (texture decode), canonical skinning + surface fields 23 to 49, everything ready
    at 1.1 to 1.5 s. First frame 0.57 s (pipelines and texture upload inside it), second 16 ms. In the
    HIDDEN pane the first frame waits for an animation frame that does not come until the pane is drawn
    (a screenshot): 44 and 87 s in two loads. That, not the code, is the 7 to 31 s. Tried
    `renderer.compileAsync` before the first frame: 1.3 s + first frame 0.2 s, slower in all: removed.
    Nothing on the code side costs over half a second and is cheap to fix; the guns' textures (asset
    side, not under `public/characters/`) are the next largest.
  - Files: `src/character.js`, `src/review.js`, `src/main.js`, `src/motion.js`, `src/look.js`,
    `public/characters/tripo-player-ue5.game.json`, `blender/bodies/game_tables.py` (the Tripo cheek
    block only), README.md, REVIEW.md.
  Traps: in the hidden pane `demo.nextFrame()` never resolves until the pane is drawn (take a screenshot
  first); `computer zoom` shows the overlay a call late (zoom twice). The review's skin measure costs
  about 70 ms a sample: aim rows sample every 16th frame.

- 2026-11-11, pass F3: the two swap clips on the Tripo player (`swap-rifle-shotgun`, `swap-shotgun-rifle`;
  the user, shown the defects: "Yes, fix them"). Shipped a partial fix: better than the old clips on every
  listed measure that moved, the same on the rest. NOT met: the rifle-to-shotgun muzzle jolt (game 4.4 to 4.8,
  target 4.0; Blender snap30 7.0, target 3.5), the shotgun-to-rifle Blender snap30 4.4, forearm twist steps
  42 / 38 deg per frame (target 30), `lowerarm_r/stock` 124 pairs (target 0).
  - Fixed: (1) the firing wrist's +59 / +46 deg sideways bend: the free hand's whole-turn roll (T1b's `unwind`,
    given after the wrist pass) is gone; the free move back over the shoulder now eases the hand's turn
    RELATIVE TO ITS FOREARM (twist about the forearm and wrist bend on their own, the twist on its nearest
    branch: `handling.Clip._hand_path`, a move step with 'forearm'; `Swap._forearm`, `Swap._parts`), so it
    needs no roll (`swapRoll` 0). Game wrist (firing, R->S) flex -35 dev +35 (was +58 / +59); Blender right
    wrist dev +35 / -33 (was +59 / +46). (2) The support hand in swap-shotgun-rifle: 2.64 cm off the rifle
    with the elbow dead straight over frames 30 to 33. Cause: it slid to its place on the handguard while the
    rifle was still upright before the chest, the farthest point. Fix: the regrip runs later (`regrip` 0.72 to
    1.10 in T units, was 0.56 to 0.96), as the gun comes down. gripCm 2.64 -> 0.00, left elbow min 0 -> 17 deg,
    left wrist flex +61 -> -27, dev -51 -> -32; incoming rifle through the body 509 -> 192 triangle pairs.
    (3) The free move's first way point further out from the shoulder (`via` (-0.48, 0.46, -0.06), was
    (-0.30, 0.36, -0.04)): right elbow bend max 161 / 162 -> 155 / 156 deg (the arm no longer folds shut).
    All per body in `rifle_motion/bodies/tripo-player-ue5.json` `swapSolve`; the old roster bodies take none
    of it (no `unwind`).
  - Cause of what is left (measured with a fast fitting harness: the swap re-made without baking, the arm
    solved two-bone towards its pole, twist referenced to the elbow's hinge; matches the baked review to
    within 1 deg / 0.1 m/s). From the dip to the let-go the outgoing gun turns only 69 to 83 deg net (chest
    frame), but its path through the port and over the shoulder is 374 to 382 deg of turning in 0.6 s: that
    spin, not a bad key, is the muzzle jolt (the snap measure counts the muzzle's circular motion). The
    shortest way round (F1's (c): 213 to 248 deg, muzzle 2.6 to 3.7) is in the other homotopy class of the
    turn: it necessarily winds the forearm a whole turn the other way (+256 instead of -104 deg). Any way that
    keeps the forearm within a turn has to turn the gun at least 360 - net = about 290 deg. So the muzzle
    target and "no whole-turn winding" can both be met only with less spin than the current choreography's
    (a muzzle-down route with the butt leading over the shoulder), more time, or the elbow taking up a turn.
  - Tried, not shipped (code kept, off: `swapSolve.solve`): the whole dip-to-let-go given forearm-relative
    (the user's idea: the gun's roll about its barrel and the let-go chosen for the wrist and forearm; the
    let-go 16 cm up the sling, rolled 0 (rifle) / -45 deg (shotgun), from a scan of lift x offset x roll with
    the best elbow swivel; the turn resampled at 1/3 and 2/3 and joined as keys). Twist then -130..-23 (no
    winding, steps 12.5 to 12.8), wrists within 35, grip 0, muzzle 5.1 / 4.0, BUT the stock lies along the
    forearm and upper arm with a straight wrist (lowerarm_r/stock 1,401, butt_pad 1,462, upperarm 887 pairs in
    swap-shotgun-rifle) and the rifle's receiver passes through the head (358 pairs): rejected. Also tried: a
    time warp on muzzle travel (worse, 6 to 9), the long-way single-axis turn (wrist pass fights it, 23 to 34),
    the gun running on through the let-go into the sling (no change), release roll +-60, collarbone reach.
  - Numbers (before -> after). Game, Tripo player, rifle-first: swap R->S 4.4 / 4.5 x6 (was 4.4 to 4.9),
    S->R 2.8 x6 (2.7 to 3.0); swapWalk 4.4 / 2.7; swapJog 4.8 / 3.0; crouchSwap 4.5 / 2.8; gripCm 0 / 0
    everywhere; wrists R->S support flex 17 dev -32, firing flex -35 dev 35; S->R support -27 / -32, firing
    -32 / -27 to -31. Regression: reload 1.1, reloadEmpty 1.1, idle 0.7, aimHold 0.9 (frozen 4). Blender
    (twist keyed): see the F3 report table; clips.txt not rewritten (partial build: clips-partial.txt).
  - Proof: the 78 other clips' every channel (inputs, outputs, accessor min / max) hash-identical, every
    non-animation part of the GLB identical, JSON notes identical for all 80 clips (the swaps' events and
    tracks unchanged), top-level JSON identical (`scratchpad/f3/cmp.py`).
  - Fitting hooks added to build_rifle_motion.py (globals-gated, off by default): DIAG, NO_SHEETS,
    HITS_PER_FRAME (per-frame gun-in-body pairs).
  Traps: Quaternion swing-twist split: keep the swing's w >= 0 (else its angle reads > 180 and the twist's
  branch flips a whole turn). A forearm-locked gun turns with the elbow: near a tight fold (bend > 150) the
  elbow swings fast and the gun with it. A straight wrist on the shotgun's straight stock puts the comb on
  the forearm.
  - Checked by the main session after F3 (2026-11-11): game `swap` six runs: rifle-to-shotgun snap 4.5
    (muzzle), wrists flex 17 dev -32 / flex -36 dev 35, grip 0 / 0; shotgun-to-rifle 2.8, grip 0 / 0.
    The 4.5 is not a hitch: traced at 60 fps the muzzle goes 4.0 to 11.7 m/s over six frames, velocity
    change per frame 0.98, 1.51, 2.7, 2.81, 3.78, 4.52, 3.07, 2.29 (a smooth hump). Acceleration goes
    with 1/T^2, so a time-warp that gives the port-to-over-the-shoulder segment 15 to 25 % more time
    (taken from the slow tail) is the fix being tried next; the earlier "do not slow it down" rule was
    too strict for a peak of this shape.

  - F3b (same day, the coordinator lifted the retiming ban): swap-rifle-shotgun time-warped. Every key time
    of the clip goes through `handling.warp_time` (body table `swapSolve.timeWarp.rifle`: a = 0.30, b = 0.66,
    k = 0.7, c = 1.08, e = 1.35 s): the port-to-over-the-shoulder stretch runs up to 1.7 times slower
    (sin-squared window, C2 at its ends, 0.126 s added) and the same time comes back from the settle after
    the hand-over; 41 frames kept. Events from the warped keys: slung 0.837 -> 0.963, handOver 0.953 ->
    1.079 s (letGo, raise, draw, end unchanged); per-frame `track` rebuilt. Game (six runs): swap R->S 2.5
    (was 4.4 to 4.9), swapWalk 2.4, swapJog 2.8, crouchSwap 2.5; S->R unchanged 2.7 to 3.0; gripCm 0 / 0;
    R->S wrists support flex 20 dev -30, firing flex -38 to -39 dev -31 to -35. Blender: snap30 7.0 -> 3.5,
    twist01_r step 42.2 -> 36.7 (range -202..-26), lowerarm_r/stock 124 -> 0 (gun clear of the body by
    1.5 cm), slung pairs 111 -> 93 (thigh_l/butt_pad 16 -> 33, lowerarm_r/butt_pad 35 -> 0), right wrist
    flex -35 -> -39. Strengths tried (fast harness, then real builds): k 0.3 -> 4.9, 0.5 -> 3.9 to 5.0
    (window placement), 0.7 -> 3.5, 0.9 -> 3.0 (more slung pairs, 222); the tail window from 0.85 s raised
    the incoming shotgun's hits (201 to 222 pairs), from 1.08 s it lowered them. swap-shotgun-rifle: the
    same warp at k 0.4 brought snap30 4.4 -> 3.0 but put the forearm through the stock (275 pairs) and the
    support arm straight again (grip 0.51): not applied. Unreal: make.py re-exported the one clip (proof
    0.0055 mm / 0.0007 deg, skin 0.0050 to 0.0052 mm).
  - Checked by the main session after F3b (2026-11-11): game `swap` rifle-to-shotgun 2.5 / 2.5 / 2.5,
    shotgun-to-rifle 2.8 / 2.8 / 2.8; swapWalk 2.4 / 2.7; swapJog 2.7 / 3.0; crouchSwap 2.5 / 2.8; grip
    0 / 0 in all; wrists within 39 degrees; reload 1.1, idle 0.6, aimHold 0.9. Film strip (front-right,
    0.47 to 0.82 s): the rifle stays clear of the head and the forearm clear of the stock. `floatCm`
    read 5.2 in two of thirteen `swap` runs (runs 5 and 6 of the first batch) and 0 to 0.2 in the rest.
  Lesson: before forbidding a retime, trace the part's speed per frame. A one-frame spike is a hitch
  to fix in the keys; a smooth hump is a move that is too fast, and time (1/T^2) is the fix.
