# Character assets

These files are copied unchanged from the EarthOnline repository
(`EarthOnline/public/assets`), except `rifle-motion-v1.glb` and `.json`, which are built here.

| File | Source path | What it is |
| --- | --- | --- |
| `civilian-m-01-player.glb` | `characters/civilian-v1/` | Player tier: 22,974 triangles, 2048 px textures, 56 joints |
| `civilian-police-m-hero.glb` | `characters/civilian-v1/` | Hero tier, patrol officer |
| `civilian-m-03-hero.glb` | `characters/civilian-v1/` | Hero tier, olive field jacket |
| `civilian-f-02-hero.glb` | `characters/civilian-v1/` | Hero tier, mustard overshirt |
| `player-weapon-motion-v1.glb` | `weapons/motion/` | Rifle hold poses (`hold-rifle-low`, `hold-rifle-hip`, `hold-rifle-aim`) for the shared skeleton; the demo uses the finger grip of `hold-rifle-low` / `hold-rifle-aim` (the aiming poses are now authored here) |
| `earthonline-humanoid-motion-pack-v1.glb` | `motion/` | Locomotion clips for the shared skeleton; no longer loaded by the game (every gait is now authored in `rifle-motion-v1.glb`), kept as reference motion for the Blender passes |
| `rifle-motion-v1.glb`, `rifle-motion-v1.json` | built in this project by `blender/build_rifle_motion.py` | The two carried holds (`rifle-hold-low`, `rifle-hold-high`), `rifle-idle`, the tactical walk and the jog in eight directions (`rifle-walk-f` ... `-fr`, `rifle-jog-f` ... `-fr`) and `rifle-sprint`, three strides each, for the shared skeleton, each with a `Gun` node track (the gun's butt and turn in the chest joint's frame); and the gun handling: the swaps (`swap-rifle-shotgun`, `swap-shotgun-rifle`), the reloads (`reload-rifle-tac`, `-empty`, `reload-shotgun-start`, `-shell`, `-end`, `-end-pump`), `shotgun-pump` and the aiming poses (`rifle-aim-level`, `-up`, `-down`, `shotgun-aim-...`), the tactical crouch (`rifle-crouch-idle`, `rifle-crouch-walk-f` ... `-fr`, `rifle-crouch-down`, `rifle-crouch-up`), with more nodes under `Spine2` (`GunIn`, `PalmL`, `PalmR`, `ElbowL`, `ElbowR`). The JSON holds each clip's ground speed, direction, strides and foot contacts, the holds and where each gun is slung, and for the handling clips their events and per frame what each hand holds, how far its fingers are closed and where the gun's loose parts are. The game also reads the rest skeleton from it |

Licence, as recorded in EarthOnline's `characters/civilian-v1/provenance.json`:
bodies, faces, clothes, hair, eyes and skins are MakeHuman/MPFB system assets
released CC0-1.0; garment, hair-cap and brow textures were generated for that
project. The weapon motion pack is authored in that project with no third-party
content (`weapons/motion/player-weapon-motion-v1.provenance.json`).

The locomotion pack is third-party content: its `idle`, `walk`, `run` and `sprint`
clips are Adobe Mixamo motion capture retargeted onto the EarthOnline skeleton
(`motion/earthonline-humanoid-motion-pack-v1.provenance.json`). They are used under
the Mixamo terms of use as part of a game and are not offered for separate
redistribution, so do not publish this folder on its own. The game no longer plays them.
For that reason `earthonline-humanoid-motion-pack-v1.glb` is left out of the git repository
(`.gitignore`); nothing in the game or the build scripts reads it.

`rifle-motion-v1.glb` is authored in Blender by keyframes generated in
`blender/rifle_motion/` on a control rig over the shared skeleton. It is built from the
EarthOnline files above (the player body's skeleton and skin, the finger grip of
`player-weapon-motion-v1.glb`'s `hold-rifle-low`) plus the authored keys and holds; it contains
no motion capture. The demo's own `public/ar_rifle.glb` places the hands, and
`public/pump_shotgun.glb` is used to check the same holds with the shotgun.

The belt kit (magazine pouch and shell loops) is modelled by script in
`blender/rifle_motion/pouch.py` from boxes and cylinders; its shapes are written into
`rifle-motion-v1.json` (`pouch`) and the game builds the same meshes. No outside assets.

## The Tripo main character (pass T1a / T1b, 2026-11-11)

| File | Source | What |
| --- | --- | --- |
| `tripo-player-ue5.glb` | the game copy of `blender/bodies/tripo/tripo-player-ue5.glb` (pass F1, `blender/bodies/game_copy.py`: base colour 8192 -> 4096 JPEG, normal 4096 -> 2048 PNG, roughness/metal 4096 -> 2048 JPEG, re-encoded with Blender's own image scaling; mesh, skin and bones byte for byte; 12.7 -> 4.3 MB) | The main character the user supplied: a young man in a white T-shirt and shorts, barefoot, made by the user with Tripo (`blender/bodies/tripo/source/tripo_main_character.glb`, unchanged). User-supplied asset: do not redistribute it or send it anywhere |
| `tripo-player-ue5.frames.json` | `blender/bodies/tripo/tripo_frames.json` (copied) | Per bone `R[b]` (canonical-to-bone frames, `R = A * bindWorld`), canonical heads and locals, the refit twist shares, the bind (T-pose) and canonical reference poses |
| `tripo-player-ue5.metrics.json` | `blender/bodies/tripo/tripo_metrics.json` (copied) | Segment lengths, joint places, eyes (painted, found in the texture: surface points), palm, fingers, feet, front surface and girth profile |
| `rifle-motion-tripo-v1.glb`, `.json` | built by `blender/build_rifle_motion.py` with `BODY_NAME = 'tripo'` | The 80 clips of `rifle-motion-ue5-v1`, fitted to this body (its proportions, hands, feet, bind pose; `blender/rifle_motion/bodies/tripo-player-ue5.json`); its belt kit (`pouch`) is a webbing belt plus the magazine pouch and shell loops, modelled by script |

What was changed from Tripo's delivery (pass T1a, `blender/bodies/prepare_body.py`; details in
`blender/bodies/tripo/TRIPO_BODY.md`): scaled to 1.75 m (x 1.852556) and recentred so the pelvis
is over the origin; the root's rest set to identity; seven UE5 IK bones added (no weight); the
upper-arm and thigh twist weight groups relabelled (Tripo had them reversed), stray limb weights
past the elbows and knees removed, upper-arm weight on upper-back skin inboard of the shoulders
moved to the clavicles; mesh node renamed `body`; pass F1: the split between upper-arm and forearm
weights round each elbow set along the limb (the inner-elbow triangle; bones, bind, frames unchanged). Mesh, UVs and normals are Tripo's,
byte for byte; the textures are Tripo's in the master under `blender/bodies/tripo/` and downscaled in
this game copy (pass F1, above); Tripo's own `AIGC` label is kept in
`asset.extras`. Tripo's T-pose bind and bone axes are kept: the clips reach them through the frames
file. Nothing was downloaded; the clips contain no motion capture.

## What the game loads (pass R3, 2026-11-11)

The game now plays the UE5 Mannequin-style skeleton (`earthonline-ue5-v1`) only:

| Roster | Body | Clip pack | Frames | Game table |
| --- | --- | --- | --- | --- |
| player (first) | `tripo-player-ue5.glb` | `rifle-motion-tripo-v1` | `tripo-player-ue5.frames.json` | `tripo-player-ue5.game.json` |
| `N` 1 to 4 | `civilian-m-01-player-ue5.glb`, `civilian-police-m-hero-ue5.glb`, `civilian-m-03-hero-ue5.glb`, `civilian-f-02-hero-ue5.glb` | `rifle-motion-ue5-v1` | none (their rest is the canonical pose) | `earthonline-ue5.game.json` |

`player-weapon-motion-v1.glb` is still read for its finger grip (`hold-rifle-aim`, canonical locals;
the same grip both packs were built with). No longer loaded: the old bodies (`civilian-*.glb` without
`-ue5`), `rifle-motion-v1.glb` / `.json` and `earthonline-humanoid-motion-pack-v1.glb`; they stay on disk.

New files, generated here (no outside data):

| File | Made by | What |
| --- | --- | --- |
| `tripo-player-ue5.game.json` | `python3 blender/bodies/game_tables.py` from `blender/rifle_motion/bodies/tripo-player-ue5.json`, `tripo-player-ue5.metrics.json` and `.frames.json` | What the game's run-time layers need of the body: palm, ankle height, heel and sole points, the trigger finger's tip and pad, the aiming eye (weld point and the painted eye on the skin), the cheek weld (re-tuned in R3), the shoulder pocket, per gun the carried support slide, slide limit and elbow pole, the stance widening; `face: false` (no eye bones or morphs), `atlas: false` |
| `earthonline-ue5.game.json` | the same script, from `blender/rifle_motion/bodies/civilian-m-01-player-ue5.json` | The same keys for the four EarthOnline bodies, holding the values `src/` had hard-coded before R3, and R1's twist shares |

## Vehicle clips (pass A1, 2026-11-11)

| File | Made by | What |
| --- | --- | --- |
| `vehicle-motion-tripo-v1.glb`, `.json` | `python3 blender/tools/bl.py run blender/build_vehicle_motion.py` (default `BODY_NAME = 'tripo'`) | The Tripo player seated in the supercar: `car-drive` (8 s loop), `car-steer-l`, `car-steer-r` (wheel +90 / -90), `car-look-back`; same skeleton, bones and keyed channels as `rifle-motion-tripo-v1` (twist and IK bones keyed, 30 fps), clip space = the car's `vehicle_root` frame, root track, `events`, `door`, `contacts`, control conventions and the seated reference in the JSON. Fitted against the car's own geometry (`~/Desktop/Code/test/supercar/supercar.glb`, read only, imported as a prop) |
| `vehicle-motion-ue5-v1.glb`, `.json` | the same with `BODY_NAME = 'player'` (built on `civilian-m-01-player-ue5`) | The same four clips for the EarthOnline bodies |

Authored keys only (blender/vehicle_motion/), no motion capture, no outside assets. Not in these packs yet:
car-enter / car-exit, every helicopter clip (see `notes/A1_log_entry.md`). Rebuilt candidates with the vehicle
fit (`vehicleFit` in their JSON: the seat, wheel and pedal offsets the game must apply) and the nine helicopter
seated clips are in `blender/review/vehicles/candidate/`, not shipped: see the log.

Pass A2 (2026-11-11): `vehicle-motion-tripo-v1` is UNCHANGED (still the 13 seated clips). `car-enter`, `heli-enter` and
`heli-exit` are authored (`blender/vehicle_motion/clips_car.py`, `clips_heli.py`) and judged but fail their targets, so
they are not shipped; the candidate pack with all 16 clips is
`blender/review/vehicles/candidate/vehicle-motion-tripo-v1-a2.glb` / `.json` (its 13 seated clips bit-identical to this
folder's pack, `bitcheck-13-a2.txt`; three.js load check PASS, `load_check-a2.txt`). `car-exit` is not authored. See
`notes/A2_log_entry.md`.

Pass A2 follow-up (2026-11-12): `vehicle-motion-tripo-v1` now carries 17 clips: the 13 seated clips (bit-identical),
`car-enter` and `car-exit` rebuilt and passing the coordinator's gate (`blender/vehicle_motion/gate_a2.py`), and
`heli-enter` / `heli-exit` as the coordinator shipped them (copied unchanged with `blender/vehicle_motion/append_pack.py`).
Rebuild: `bl.py run` of build_vehicle_motion.py with CLIPS = the 13 seated clips + car-enter + car-exit, then
`append_pack.py <pack> <previous pack> heli-enter heli-exit`. See `notes/A2_log_entry.md`.

Pass A2 follow-up 2 (2026-11-12): `vehicle-motion-tripo-v1` carries 17 clips, all built by build_vehicle_motion.py
(CLIPS = the 13 seated clips + car-enter, car-exit, heli-enter, heli-exit; no copied clips): `heli-enter` (8.0 s, new path:
left foot on the skid, right leg into the footwell, left leg over the cyclic, door to 68 deg and pulled shut from the
seat, ends on `heli-collective-down`) and `heli-exit` (8.0 s, heli-enter's path backwards, starts on
`heli-collective-down`) pass the coordinator's gate; the other 15 are bit-identical to the previous ship.
`vehicle-motion-ue5-v1` (EarthOnline bodies, built on civilian-m-01-player-ue5, `BODY_NAME = 'player'`) is rebuilt with
its own `vehicleFit` (`blender/vehicle_motion/fit.py`: car seat 0.20 m forward / 0.03 m down, wheel 0.03 m out; heli
pedals 0.25 m aft, seat 0.08 m forward) and carries the 13 seated clips (car-drive, car-steer-l/-r, car-look-back,
heli-fly, heli-cyclic-f/b/l/r, heli-collective-up/down, heli-pedal-l/r), all passing the gate; no enter / exit clips
(retargeted, they do not pass for this body yet). See `notes/A2_log_entry.md`.

Pass A3 (2026-11-12): `rifle-motion-tripo-v1` and `rifle-motion-ue5-v1`: `swap-rifle-shotgun` and `swap-shotgun-rifle`
re-timed so the firing hand is at rest at the `slung` event (where the game's stow ends and its draw begins); the other
78 clips of each pack bit-identical (rebuilt with `ONLY` = the two swaps and `PATCH = True` into the shipped packs).
`vehicle-motion-tripo-v1`: `heli-exit` is its own move (10.7 s: door pushed open on its glass from the seat, the left
leg back over the cyclic, the left hand on the doorway's front post, down by the skid, round the open door, the door
pushed shut from in front of it, standing at the entry point); `heli-enter`'s feet go straight up and down off and onto
their places and its long steps are slower; both pass the gate; the other 15 clips bit-identical. See
`notes/A3_log_entry.md`.

Pass A3 follow-up (2026-11-12): `vehicle-motion-tripo-v1` (17 clips): driver posture (seated car clips' collar and
right knee pole per body, car-enter / car-exit fade to that pole), pilot posture (`vehicleFit` heli pilot_seat and
seat_pilot_point 0.145 m forward, no `scale`; the 9 seated helicopter clips and heli-enter / heli-exit re-solved), and
`car-exit`'s middle as its own move (left hand on the roof's edge over the doorway, right hand on the knee for the rise;
`clips_car.exit_middle`). All 17 pass the gate. `rifle-motion-ue5-v1` is back to its bytes before pass A3 (the slung
pause applies only to Tripo). `vehicle-motion-ue5-v1` (13 seated clips, no enter / exit) has the pilot posture with its
own fit (pilot seat 0.145 m forward) and now also `car-enter` and `car-exit` fitted to its body (`clips_car.UE5`;
15 clips). Not done: EarthOnline heli-enter / heli-exit, gun hand-off. See `notes/A3_log_entry.md`.
