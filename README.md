# AR rifle range

A Three.js third-person shooter demo that renders with `WebGPURenderer`. The player (the Tripo
main character; `N` steps through four EarthOnline bodies) moves around a yard at a tactical walk, a run or a sprint with a rifle and a pump
shotgun: one in the hands, the other slung across the back. Both can be aimed, fired and
reloaded on the move.

## Run

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints. The page falls back to WebGL 2 where WebGPU is not
available; the badge at the top left says which one is running.

## Play online

A build is hosted on GitHub Pages: https://duolahypercho.github.io/ar-rifle-demo/ models load on the first visit). It is published by hand, from the last commit:

```bash
sh tools/deploy_pages.sh
```

Pushing to `main` does not change the site; only that script does.

## Controls

Click the view once to capture the mouse; `Esc` frees it again. Where the browser refuses to
capture it, drag on the view to look around instead.

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Move in eight directions, facing where the camera looks |
| `Shift` | Run, turning to face the way you go; keep holding to build into a sprint |
| `X` | Switch the everyday pace between the tactical walk and a jog |
| Mouse | Look |
| Left button, `Space` or `F` | Fire (hold for automatic) |
| Right button (hold) or `Q` (toggle) | Aim down the sights |
| `R` | Reload |
| `E`, or `1` and `2` | Swap weapon: rifle, shotgun |
| `C` | Crouch, or stand up (`Shift` also stands up to run; the jog is dropped while crouched) |
| `V` | Camera: third person, first person |
| `N` | Next character: the Tripo player, then the four EarthOnline bodies, then the player again |
| `G` | Picture: full (lighting, shadows, AO, anti-aliasing, motion blur, bloom, grade) or plain (the same scene with no post-processing), to compare |
| `B` | Spoken calls ("Reloading!") on or off; breathing and grunts stay on |
| `H` | Debug: be struck, each press from the next way round (front, right, back, left); every fifth press a heavy blow from the front or back |
| `T` or `Enter` | Get in / out of the car (at its driver's door) or the helicopter (at the pilot's door): see "Vehicles" and "Helicopter" |
| `9` | (V7) Time of day: midday, late afternoon, dusk, night (also in the vehicles) |
| `8` | (V7) Wind: calm, 3, 6, 10 m/s with gusts (also in the vehicles) |
| `0` | (V7) Both vehicles back to new (dents, scrapes, glass, lamps, mirrors, steering, the helicopter's skids) |

At the tactical walk and the jog the character always faces the view and steps forward, back,
sideways or on a diagonal: sideways is 60 percent of the forward pace, backing up 75 percent,
the diagonals in between. Standing with the gun carried, the head looks about on its own and
the body only turns after the view once it is more than about 50 degrees away; shouldered, the
trunk takes the view about 23 degrees round before the legs turn. Standing, the body turns by
stepping round on the spot; setting off forward and stopping from a forward walk or jog are
stepped too, and running, asking to go back the other way plants a foot and turns about.

Crouched (`C`) the character drops into a tactical crouch (head about 37 cm lower), walks at
1.0 m/s forward in short quick steps in all eight directions, aims, fires, reloads, swaps and
takes hits from it; the camera comes down with the head and the footsteps are quieter. Standing
still, going down and coming up play authored clips; on the move the crouch blends in and out.

Behind the start (about 25 to 45 m down +Z) the yard has a 10-degree and a 20-degree ramp, each
up to a flat top and down the other side, a flight of four steps (17 cm rise, 30 cm tread) up to
a platform and down again, and a 12 cm kerb. The body walks over them: see "Ground".

Firing brings the rifle up to the shoulder on its own; it stays at the ready for a couple of
seconds afterwards and then goes back down. Firing an empty gun starts a reload. Sprinting
is not possible while aiming or reloading.

- **Rifle:** 30 rounds, automatic. The reload swaps the magazine; from empty it ends with a
  pull of the charging handle.
- **Shotgun:** 6 shells, 8 pellets a shot, pumped after every shot. It is reloaded one shell
  at a time; pulling the trigger stops the reload after the shell in hand, and a reload from
  empty ends with a pump.

## How it works

The character is posed every frame in layers (`src/character.js`).

**Skeleton (pass R3).** Every body is on the UE5 Mannequin-style skeleton `earthonline-ue5-v1`
(`blender/ue5_rig/UE5_SKELETON.md`). Each roster entry (`ROSTER` in `src/character.js`) names its
body, its clip pack (`rifle-motion-tripo-v1` for the Tripo player, `rifle-motion-ue5-v1` for the
EarthOnline bodies; `src/main.js` loads one `Motion` per pack), the frames file of the body the pack
was built for, and its game table (`public/characters/<body>.game.json`: palm, feet, trigger finger,
aiming eye, cheek weld, pocket, per-gun support hand; made by `blender/bodies/game_tables.py`). The
layers below keep the old 56-joint skeleton's math: they pose a proxy skeleton under the old names
in canonical frames (identity rests) at the body's own canonical joints, and `src/rig.js` turns that
into the real bones each frame (`boneWorld = canonicalWorld * R[b]`): spine_02 / spine_04 take half
of the old Spine / Spine1 turn, neck_02 and the metacarpals stay at their canonical locals, the twist
bones are driven from the final pose with the body's own shares (unwrapped, held where the swing
nears a half turn), the IK bones follow the final feet and hands, and the root bone stays at rest
(the transitions move the character by their notes' `root`). `src/motion.js` converts the packs'
real local rotations to the old joints' canonical locals as it bakes them. The face layer goes by what
the body has (pass F2): eye turning needs the eye bones, blinks (and the lids' share of the aim squint
and the shot blink) the `eyeBlinkLeft` / `eyeBlinkRight` morphs, the brow and the mouth their own
morphs. The Tripo body has none of them yet (no eye bones, painted eyes): nothing of the face runs on it
until its GLB carries the two blink morphs.

1. **Locomotion.** All of it comes from clips authored in Blender for this project
   (`public/characters/rifle-motion-tripo-v1.glb` / `rifle-motion-ue5-v1.glb`, see "Animation clips" below): `rifle-idle`, an
   eight-second ready stance that breathes, shifts its weight and lets the gun settle in the
   hands; the tactical walk and the jog in eight directions, `rifle-walk-f`, `-fl`, `-l`, `-bl`,
   `-b`, `-br`, `-r`, `-fr` and `rifle-jog-f` ... `-fr`; and `rifle-sprint`. Each is at the speed
   the game goes that way and three strides long with no two strides alike. At the walk and the
   jog the two clips either side of the way of travel are blended, each eased in and out so that
   a change of direction cross-fades; all of them start as the left foot lands and hold the same
   number of strides, so they stay in step, and the walk, the jog and the sprint are blended by
   how hard the body is going. Running (Shift) the body faces the way it goes; while it turns,
   the sprint's share goes to the jog clips for the way the legs are going. Every clip also says
   where the gun is (its `Gun` track). `src/motion.js` reads each clip's ground speed, direction,
   strides and foot contacts from the pack's JSON.
   **Transitions** are one-shot clips that move the body over the ground themselves (root
   motion): turning on the spot (`rifle-pivot-l45`, `-l90`, `-l135`, `-l180` and `-r...`), setting
   off forward (`rifle-walk-start`, `rifle-jog-start`), stopping from the forward walk or jog
   (`rifle-walk-stop-0` ... `-7`, `rifle-jog-stop-0` ... `-7`, one beginning at each eighth of the
   loop's cycle, with the feet where the loop has them there) and the
   running about-turn (`rifle-run-turn-l` / `-r`). While one plays, `src/player.js` moves and
   turns the character exactly as its root track says (`src/moves.js`), so the feet it puts down
   stay where they were put down, and `src/character.js` gives it the pose, eased in over a few
   hundredths of a second and out where it hands over. Standing, a turn on the spot is begun when
   the view has gone far enough round, sized to where the view is going (the two clips either side
   of the angle blended, or the nearer one stretched), and chained while the view keeps going; the
   clip's head and chest lead it, carried, and shouldered the aim stays on the target while the
   legs step round under it. Setting off forward plays the start clip at once; letting go of the
   key at a forward walk or jog plays a stop at once, wherever the stride is: the stop that begins
   just before the legs' phase, begun the rest of the way in (the body brakes from that frame, to
   standing in 0.45 s from the walk and 0.58 s from the jog, and the feet then step into the
   stance); running, asking to go more than about 130
   degrees round waits for the outside foot's footfall and plays the about-turn. A start and the
   about-turn end on a footfall of the loop they hand over to, at its speed, with the loop's cycle
   brought there; a stop and a turn on the spot end in the ready stance.
2. **Legs.** The blended clips give ankle and knee positions (sampled on a smooth curve
   between the 30 fps keys). The gait is picked by how hard the body is going (ground speed
   over the pace for that direction), so a jogged side step is still a jog. The clips already
   step the right way; when the ground goes faster or slower than they were made for (setting
   off, stopping, a turn while running) their steps are stretched along the way of travel. A
   foot in the air is moved aside if it would still come within 15 cm of the other one, so the
   feet never pass through each other. When the blend changes (setting off from the idle, a new
   direction, a walk becoming a jog) a foot in the air does not jump with the clips' target: it
   carries on and closes on the new one.
   Each foot is held still on the ground for as long as the clip has it planted (a contact
   curve measured from the capture when it loads), so the body walks over its feet instead
   of the feet skating; let go, a foot rejoins the clip's path from standing still, so there
   is no jolt, and one let go well away from it is picked up and put down there. A body
   turning hard swivels a held foot on its ball. A leg on the ground is never pulled straight:
   the heel rolls up onto the ball as the hip moves away (the push-off of each step) and the
   hips come down as far as it takes for the knee to stay bent; a foot in the air bends its
   knee instead (soft two-bone IK). Swinging, the toes and heel clear the ground. Standing
   still, the feet are planted in the world; a small run-time step puts a foot back where the
   stance wants it when that has drifted (a change of stance, the wider stance shouldered, what a
   transition let go of part way left over) and turns the feet after the body in first person,
   where the view turns the body directly; coming to a stop other than by a stop clip, a foot still
   in the air carries on into its place in the stance. A held foot keeps its own heading in the
   world against the clips' (so a transition, whose feet turn against the turning body, is not
   turned twice).
   No two steps are alike: each footfall changes, a little and at random, how long the next
   step is (made up in quickness, so the feet keep pace with the ground), where the foot goes
   down, and how much the shoulders, trunk and hips swing with it.
3. **Upper body.** Carried, it is the clips' own: shaped round the gun (bladed a little, the
   support shoulder drawn forward), leaning in going forward (from the ankles at a run) and
   upright backing away, the shoulders turning against the hips, the head kept level, the arms
   working the gun against the stride at a run; the authored high ready's difference
   (`rifle-hold-high` against `rifle-hold-low`) is added for the high ready, and the head turns
   with the view. Shouldered, the gun's own authored aiming poses (`rifle-aim-level`, `-up`,
   `-down`; `shotgun-aim-...`: the gun level and 45 degrees up and down, the trunk taking 40 % of
   the pitch, the butt in the shoulder pocket, the head down on the stock with the eye behind the
   sight) are blended by where the gun points and twisted onto the target; past 45 degrees the
   trunk bends the rest of the way, and the neck makes a last small correction to put the eye
   behind the rear sight.
   Gun handling (the swap, the reloads, the shotgun's pump) is played over all of this as an
   upper-body action authored in Blender: its trunk, neck, head and collarbones as a difference
   from `rifle-hold-low`, so it rides on whatever the legs are doing (standing, walking, jogging);
   its guns and hands in the chest joint's frame.
4. **Arms.** Two-bone IK puts the palms on the gun's `grip_main` and `grip_support` points (on
   the shotgun, its pump), or, during a handling clip, where the clip has them (a hand that holds
   a gun stays on that gun as it really is) with the elbows where the clip has them. The rifle's firing
   hand sits on the pistol grip turned about its palm so that its wrist stays straight, carried
   with the elbow down at the ribs and shouldered alike; the shotgun's turns from its carried grip
   to its shouldered one as the gun comes up. Carried, the rifle's support hand holds the
   handguard 6 cm behind `grip_support`, so that arm bends at the elbow.
5. **Secondary motion.** Nothing is held perfectly still. The gait clips carry their own
   weight (the hips drop on each footfall, or at a run sink through each stance and rise in the
   flight, shift over the standing leg and drop on the swinging side, the shoulders turn against
   them, the gun rides the chest a few hundredths of a second behind) and the idle its own
   breathing, weight shift and drifting gun; on top, braking and pushing off sink the hips,
   shouldered every footfall turns the shoulders against the hips, tips the trunk and nods it,
   and standing, the weight drifts between the feet and the head glances about. The gun follows its hold on springs, so it trails a
   turn, hangs back when the body starts or stops, and overshoots and settles when it is
   snapped up to the shoulder. A shot rocks the trunk, drives the firing shoulder back and
   jolts the camera.

Standing, the feet are planted where `rifle-idle` puts them (wider and more staggered with
the rifle shouldered) and step to keep up when the body turns.

`src/player.js` is the controller: at the walk and the jog, aimed or not, the character faces
where the camera looks and moves in eight directions (60 % of the forward pace straight
sideways, 75 % straight back); running and sprinting, it turns to face the way it is going. It
starts and times the transitions (above), places the camera and leans the body into
acceleration (not during a transition, which leans as it was authored).

`src/weapon.js` decides where the rifle is and runs firing, recoil and the reload on the
rifle's own nodes: `magazine`, `charging_handle`, `trigger`, `muzzle_point` and `eject_point`.
The reload is a clip (`reload-rifle-tac`, `reload-rifle-empty`) whose notes say, frame by frame,
where the magazine is (in the well and how far out, in the hand, gone) and how far the charging
handle is pulled, and when things happen (`magOut`, `magFree`, `magIn`, `boltBack`,
`boltForward`), which the rifle turns into the real parts moving, a dropped magazine and sound.
Carried, the gun is exactly where the clips hold it: the character blends the clips' `Gun`
tracks with the rest of the pose (the low ready, pulled in tight at the sprint, or the high
ready for a couple of seconds after firing or a reload) and hands that over in the chest joint's
frame; the small ways of carrying it differently at rest (`src/alive.js`) are offsets on top. In
first person it is kept in sight, and shouldered its butt is in the shoulder pocket, read from
the body mesh when it loads. Rounds go to the point under the crosshair.

The carried holds were checked against the posed, skinned body in Blender, so carried as the
clips have it the gun needs no help. As a safety net, each frame the corners of the stock,
receiver, grip, magazine, handguard and barrel are tested against a height field of the front
of the torso (clothes included) and against the thighs, and the gun is held further off the
body by whatever its fidgets, its inertia or the body's run-time layers have added to what the
clips' own hold needs (shouldered, by all of it).

`src/shotgun.js` is the pump shotgun, built on the same class and carried on the same `Gun`
track: its deeper stock is held 2 cm further off the chest, the firing hand sits further round
the wrist of the stock with its elbow out to the side, and carried, the support hand holds the
back of the pump (shouldered, 10 cm behind its front). Its reload is three clips chained
(`reload-shotgun-start`, `-shell` once a shell, `-end` or, from empty, `-end-pump`), which say
how far the pump is drawn and where the loose shell is; the pump after a shot is `shotgun-pump`.
The gun that is not in use hangs across the back (where the clips' notes put it, `stow`), and
`swap-rifle-shotgun` / `swap-shotgun-rifle` (`src/main.js`) put one up over the right shoulder
onto the back as the support hand draws the other off it; the hands change guns at the clip's
`handOver` moment, which is also when the HUD changes.

`src/fx.js` has the muzzle flash, tracers, cases, dropped magazines, bullet marks and the
steel plates; `src/range.js` builds the yard; `src/main.js` wires up the renderer, input and
HUD.

## The picture

`src/look.js` (pass 10) draws the frame; `src/surfaces.js` makes the yard's materials. Everything
is made in code: no textures, HDRIs, LUTs or models are loaded for it.

- **Light.** A late-afternoon sun 29 degrees up, behind and to the right of the start's view
  (warm, intensity 8), and a procedural sky (`SkyMesh`, with its drifting clouds) that also lights
  the scene: the same sky, without its sun disc, over a ground of warm bounce light, is rendered
  into a PMREM environment, so shade is lit blue from above and warm from below, and metal reflects
  the sky. The sky's own scale is brought down (`SKY.gain` 0.3) to a clear afternoon's balance,
  about 1 : 3.5 shade to sun on the ground. The far yard fades into the sky behind it (fog colour
  sampled from the environment in the view direction, 55 to 300 m).
- **Shadows.** One 4096 shadow map covering 22 x 22 m (5.4 mm texels), centred 4 m ahead of the
  player along the view and snapped to its own texel grid so it never shimmers as the player
  moves; PCF on a rotated disc of 2.2 texels (soft edges; TRAA removes the disc's noise); bias
  -0.00025, normal bias 0.012 (no acne on the body, feet not lifted off their shadows).
- **Materials.** The bodies are one PBR atlas; skin, cloth, hair and shoes are told apart by the
  roughness / specular each region carries in its ORM texture (skin 0.55 / 0.44, cloth 0.73 to
  0.86 / 0.56). Cloth is made rougher (0.93) with 40 percent of the specular and a soft sheen;
  skin gets a warm, reddened wrap of light just past the sun's terminator. The guns keep their
  textures (metal now reflects the sky). The ground, barriers, ramps and stairs are cast concrete
  (blotches, stains, grain and pores from noise in world space, a bump on the grain fading with
  distance); the crates are boards, the containers corrugated painted steel with streaks and rust,
  the berm earth, the rails brushed steel, the lines worn road paint.
- **Post-processing** (`THREE.RenderPipeline`, full quality only): a pre-pass of depth, normals and
  per-pixel velocity (skinned meshes included); GTAO at half resolution, temporally rotated and
  denoised, darkening only the sky and bounce light (not the sun); the HDR scene pass; TRAA
  (jittered camera, history reprojected by velocity); motion blur along each pixel's own velocity
  (0.45 of a frame's motion, 10 samples, capped at 10 px at 720p, nothing under 0.75 px/frame);
  bloom above 3.0 (only the muzzle flash, tracers and sparks, which are drawn at 5 to 9 times
  white, and the sun's glints); AgX tone mapping at exposure 0.85; then a grade in display space
  (cool shadows, warm highlights, contrast 0.25, saturation 1.12) and a light vignette.
- **Plain** (`G`) draws the same scene, lights and materials straight to the screen with MSAA 4x
  and AgX: no AO, TRAA, motion blur, bloom or grade.

Frame cost, timed as `demo.render()` plus waiting for the GPU (median of 30 frames, this machine):
1280 x 720 full 6.2 to 7.1 ms, plain 5.0 to 7.2 ms (the scene before this pass: 4.1 to 5.5 ms);
2560 x 1440 full 8 to 13 ms, plain 5 to 9 ms (before: 4.5 ms).

## Animation clips (Blender)

The clips are built in Blender 5.1 by `blender/build_rifle_motion.py`
(with `blender/rifle_motion/`), which rebuilds everything from scratch:

    python3 blender/tools/bl.py run blender/build_rifle_motion.py

Since pass R2 (2026-11-11) the build runs on the UE5 Mannequin-style skeleton
(`blender/ue5_rig/UE5_SKELETON.md`): it reads only `public/characters/civilian-m-01-player-ue5.glb`
(the `BODY` / `FRAMES` settings at its top choose the body), writes
`public/characters/rifle-motion-ue5-v1.glb` / `.json` (same clips, names and notes as
`rifle-motion-v1`, on 90 bones with UE5 names, twist and IK bones keyed, the transitions' travel on
`root`), reviews into `blender/review/ue5/` and saves `blender/rifle_motion_ue5.blend` (about 17
minutes). The clips are authored in canonical frames (the old skeleton's identity-rest frames) and
converted to the bones' real frames only where bones are read and written (`skel.py`, `rig.py`,
`bake.py`). Proof against the old pack: `python3 blender/ue5_rig/pack_equivalence.py`
(`blender/review/ue5/equivalence.txt`) and `python3 blender/ue5_rig/compare_clips.py`. The old
pack `rifle-motion-v1` (which the game still plays until R3) and its review in `blender/review/`
are kept as they were; the old builder is in the pre-UE5 archive. Below, old joint names are used
where the text describes the pre-R2 build; the bones are now `pelvis` (Hips), `spine_05` (Spine2,
the chest), `clavicle_*` (Shoulder) and so on.

Since pass T1b (2026-11-11) the build is per body. Every body measurement the clips are fitted to
(palm, legs and feet, stance, holds, slung places, the aim's pocket and eye, the belt kit) is in
`blender/rifle_motion/bodies/<body>.json`, chosen with the GLB and its frames file by `BODY_NAME`
(`build_rifle_motion.py` `BODIES`). The default (`player`) builds `rifle-motion-ue5-v1` for the old
roster bodies exactly as before; the Tripo main character:

    python3 blender/tools/bl.py code "BODY_NAME = 'tripo'; __file__ = '$PWD/blender/build_rifle_motion.py'; exec(open(__file__).read())"

(bl.py gives up after 15 minutes while Blender carries on: wait for the output files)

writes `public/characters/rifle-motion-tripo-v1.glb` / `.json`, reviews into `blender/review/tripo/`
(numbers, contact sheets, close-ups of the hands, cheek weld, pouch and back) and saves
`blender/rifle_motion_tripo.blend` (about 10 minutes). The body, its frames and its metrics are
copied beside the pack (`tripo-player-ue5.glb`, `.frames.json`, `.metrics.json`). Partial builds for
fitting: `ONLY = [...]`, `PATCH = 'export'`, `OUT_GLB = <scratch path>`. Checking a pack on a body the
way the game plays it: `python3 blender/bodies/pack_check.py <body.glb> <pack.glb> <out.txt>`. Adding
a body: `blender/ue5_rig/UE5_SKELETON.md`, "Per-body tables and other bodies".

- **Scene** (`rig.py`): the player body and its 56-joint skeleton, a gun (the rifle, or the
  shotgun for checking), and a control rig: pelvis and chest controls (`FK-Hips`,
  `FK-Spine2`), FK spine, neck and head, leg IK with foot controls and a heel roll
  (`foot_ctrl`, `heel_pivot`, `ball_pivot`, knee poles), and arm IK onto targets riding on the
  `gun` bone, so both palms stay on `grip_main` and `grip_support` wherever the gun goes. The
  skeleton copies the rig, so the skinned body follows it live.
- **The carry** (`carry.py`): three holds, all with the butt at the shoulder. Low ready:
  the muzzle about 33 degrees down and 25 across, both elbows bent and down, the gun close to
  the chest. High ready: nearly level (about 14 degrees down). Sprint: the low ready pulled in
  tight, the muzzle lower and further across, on a squarer trunk. Each is a place for the butt and
  a turn of the gun in the chest joint's frame, found by search on this rig so that the
  support hand reaches `grip_support` with its elbow bent, the firing wrist stays in its
  natural range, and the gun clears the posed, skinned body by at least a centimetre; the
  trunk is shaped round it (bladed about 20 degrees, the support collarbone drawn forward).
  The rifle's support palm holds the handguard 6 cm behind `grip_support`.
- **Gun handling** (`handling.py`): upper-body actions, each starting and ending on
  `rifle-hold-low`, keyed in the chest joint's frame. A hand either holds something (a grip on a
  gun, the magazine, a charging handle, the loading port) and goes where it goes, or travels
  between two holds through way points on a minimum-jerk ease, a little past its mark and back;
  a gun is either posed by the hand that carries it or hangs on its sling. Keys are joined by
  cubic curves (Catmull-Rom tangents, `stop` keys passed at rest), each gun's path is smoothed
  over a few frames, and wherever a hand is on its own the arm is solved as the rig will solve
  it and a wrist bent past its range (flexion 38, deviation 22 / 28 degrees, eased from 65 % of
  that) is turned back about the palm, taking a gun it carries with it.
  - `swap-rifle-shotgun`, `swap-shotgun-rifle` (1.35 s): the gun dips, the firing hand raises
    it upright at the right side and takes it up over the right shoulder, the barrel along its
    forearm, onto the back; meanwhile the support hand goes round the left side behind the hip,
    takes the slung gun's fore-end and pulls it off the back, swings it up at the left side like
    a pendulum (so its butt passes outside the hip) to upright before the chest, where the firing
    hand takes its grip (`handOver`), and both bring it down into the low ready, the support hand
    rolling round under the fore-end into its place.
  - `reload-rifle-tac` (2.3 s), `reload-rifle-empty` (2.95 s): the gun comes in to the chest and
    rolls the well towards the support hand, the eyes on it; the old magazine is pulled and
    dropped, a fresh one taken from the belt and seated with a punch; from empty the hand then
    pulls the charging handle and lets it go.
  - `reload-shotgun-start` (0.4 s), `-shell` (0.6 s), `-end` (0.42 s), `-end-pump` (0.98 s):
    the gun rolled port to the support hand; a shell from the belt on an arc to the port and
    thumbed in; all three meet in the same pose, so the trigger can stop the reload after any
    shell. `shotgun-pump` (0.6 s): the stroke after a shot.
  - `rifle-aim-level`, `-up`, `-down`, `shotgun-aim-...` (one frame each): the shouldered
    poses, with the cheek weld solved (the aiming eye brought to its place behind the sight).
  Handling clips carry more nodes under `Spine2` (`GunIn` for the gun coming off the back,
  `PalmL` / `PalmR`, `ElbowL` / `ElbowR`), and their notes say per frame which gun each hand holds,
  how far its fingers are closed, and where the loose parts are; and when things happen.
- **Clips** (`gait.py`, `keys.py`): keyed onto the controls. `rifle-hold-low` and
  `rifle-hold-high` are the two holds as one still frame each (pelvis square), which the game
  builds its running upper body and its high ready from. In the walk, a foot on the ground is
  carried back at exactly the walking speed, so it cannot skate; a swinging foot goes over the
  ground on a minimum-jerk curve; the heel and ball pivots give heel strike and toe-off going
  forward, ball first and heel last going back, flatter steps sideways; the hips ride about
  1.5 cm under the idle's height and come down further only where a standing leg would pass
  the game's limit for a bent knee. Each walk clip is three strides (six steps), each step
  landing a little early or late, a little further or nearer, a little in or out, and swinging
  the pelvis, shoulders and weight a little more or less. Per direction: forward 1.45 m/s, 0.50
  m steps at 2.9 a second; diagonals 1.05 (forward) and 0.96 m/s (back) at 3.9 and 3.5 steps a
  second; sideways 0.87 m/s at 5 steps a second, the feet opening from about hip width to about
  half a metre and closing again, never crossing; straight back 1.09 m/s, 0.40 m steps.
  The jog's diagonals run their feet on lines 30 cm apart across the way of travel (25 cm
  backwards), not across the body, with the feet, knees and pelvis turned a little further into
  the diagonal, so the legs swing past each other side by side rather than each foot crossing the
  body's middle.
  The jog and the sprint are runs: each foot is on the ground for about a third of its cycle,
  so there is a flight between steps; a swinging foot is kicked up behind and carried forward
  over the ground at a nearly even speed (it starts and lands at rest), and is lifted rather
  than the body lowered where the leg could not reach it; the hips are lowest mid-stance and
  highest in the flight; the trunk leans forward from the ankles and the arms rock the gun with
  each step. Forward 3.6 m/s at 3.0 steps a second (1.2 m steps); sideways 2.16 m/s, a quick
  athletic shuffle: the trailing foot lands soon after the leading one and then both are in the
  air together, so the feet open from about 20 cm to under 60 cm apart at 6 steps a second,
  hips low and square, knees bent over the feet; straight back 2.7 m/s, a quick backpedal at 3.9
  steps a second; the diagonals between. Sprint: 5.2 m/s at 3.5 steps a second, leaning 15
  degrees, on the sprint carry.
- **Transitions** (`transitions.py`): planned in the world as footfalls (where and when each
  foot is put down, how it rolls or swivels on its ball while down, how it travels in the air,
  straight or round the other foot), a path for the root (the point on the ground the game moves,
  and its heading) and the body over them (hips height and turn, lean, bank, where chest and head
  look); the hips are drawn towards whichever feet are down, ahead of a foot lifting, and lowered
  where a standing leg could not reach. Then every frame is expressed in the root's frame and the
  root goes into the notes (`root`, per frame `[x, z, yaw]` from the start; `down`, which feet are
  on the ground; `entry` / `exit`, the loop's gait, foot, phase and speed where it joins one).
  - Turning on the spot, 45, 90, 135 and 180 degrees each way (0.62, 0.8, 0.98, 1.1 s): the head
    and chest turn first, the foot on the side of the turn opens towards the new way (on 135 and
    180 part way, then the rest after), the weight goes onto it, the other foot swings round
    outside it to its place in the stance; the hips sink a little through it. The root turns with
    the pelvis and drifts towards the inside foot (half as far as pivoting on it would take it).
  - Setting off (walk 0.8 s, two steps; jog 0.92 s, three): the weight onto the front foot and the
    trunk tipped forward at once, the back foot driving off into a short first step, the steps
    lengthening into the loop's; the body is moving from the first frame.
  - Stopping (0.87 to 1.03 s), eight for each of the walk and the jog, each beginning at an eighth
    of the loop's cycle with the feet where the loop has them there (one in the air carrying its
    swing on): the body brakes from the first frame, to standing in 0.45 s (walk) or 0.55 s (jog).
    The foot down under or ahead of the body brakes, or else the next to land, put down a little
    ahead of the slowing body; the other comes through (at a jog a braking step first), and each
    foot then steps into the ready stance while the hips, sat back and down, rise and the trunk,
    leant back, settles.
  - The running about-turn (0.88 s), from the jog as the outside foot lands: it lands ahead,
    turned in, and brakes while the body sits back and banks into the turn and it swivels on its
    ball; the inside foot comes round and down beside it for the drive; the body leans into the
    new way and pushes off; two running steps, ending on the inside foot's footfall going the
    other way at 3 m/s (the outside foot already off the ground, as the loop has it, before the
    game starts fading into the loop). Its notes give the outside foot's plant (`plant`).
- **Bake and export** (`bake.py`): what the skeleton does (IK and all) is read back at every
  frame as plain local rotations and the Hips position, and the gun's butt and turn in the
  chest joint's frame; keyed on a clean copy of the skeleton with one more node, `Gun` (a child
  of `Spine2`), exported with Blender's glTF exporter, trimmed to those channels and checked
  sample by sample. The notes (ground speed, direction, strides, when each foot is down, the
  holds, where each gun is slung) go to `rifle-motion-v1.json`. The build then plays the exported file back by forward
  kinematics against Blender's skeleton (the round trip: 0.1 mm).
- **Review** (`review.py`): before export every clip is measured (planted-foot slide against
  the ground speed, straightest knee, closest and widest ankles, palms off the grips, the
  loop's seam, toe clearance, hip height against the idle, each elbow's bend and how far out
  it is, each wrist's flexion and deviation) and the gun is tested against the posed, skinned
  body (BVH): no overlap, and how far the body can be blown up before it touches. The same is
  done with the shotgun in the hands for the holds, the idle and three walks, and for each of
  `alive.js`'s ways of carrying it at rest. Numbers go to `blender/review/clips.txt`, contact
  sheets (front, side, top; ten frames) to `blender/review/<clip>.png` and
  `blender/review/shotgun-<clip>.png`; a handling clip's sheet has twelve frames seen from the
  front, the side, the back and above, and close on the hands.

To rebuild, with this project's Blender open (`blender/tools/launch.sh`):

```bash
python3 blender/tools/bl.py run blender/build_rifle_motion.py
```

or headless: `blender --background --python blender/build_rifle_motion.py`. It writes
`public/characters/rifle-motion-v1.glb` and `.json` and saves `blender/rifle_motion.blend`.

Hit reactions (`blender/rifle_motion/reactions.py`): `hit-light-f / -b / -l / -r` (0.4 s: the
struck part recoils first, the trunk and then the head follow, the gun is knocked off line and
brought back onto the low ready a touch past and settled) and `hit-heavy-f / -b` (0.9 s, about
twice as far, with a dip of the weight). They are made like the handling clips and played as their
difference from `rifle-hold-low` on top of everything else (carried, shouldered, reloading,
walking). The belt kit (`blender/rifle_motion/pouch.py`: a magazine pouch on the left front hip,
shell loops behind it) is modelled from boxes and cylinders in the Hips joint's frame; the reloads
draw the fresh magazine and the shells from it, and the game builds the same shapes on its Hips bone
from the clip notes (`pouch`).

- **The crouch** (`crouch.py`, pass 9): `rifle-crouch-idle` (9 s: the weight rocking between
  the feet and fore and aft, two small re-settles, four breaths, the head scanning further than
  standing; feet staggered with the rear foot stepped 12 cm back and up on its ball, knees bent
  about 110 degrees, pelvis tipped 12 degrees and trunk leaning 24, head level, the gun's muzzle
  carried 14 degrees up against the lean so it points past the front knee), the crouched walk in
  eight directions `rifle-crouch-walk-f` ... `-fr` (`Author.cycle` with the crouch's spec: hips 33
  cm under the walk's, 1.0 m/s forward in 0.38 m steps, the hips' footfall drop and bob at 45 %,
  flatter landings), and `rifle-crouch-down` / `-up` (0.43 s each, standing to crouched and back:
  going down the hips lead and settle 1.5 cm past the crouch, the trunk and the rear foot follow;
  coming up a centimetre's dip, a push, the trunk upright after the hips, a touch past standing;
  each begins on `rifle-idle`'s first frame and ends on `rifle-crouch-idle`'s, or the other way).
  Head height (Blender): standing 1.48 m, crouch idle 1.09 to 1.13, crouch walk 1.11 to 1.14.

## Ground

`src/ground.js` holds the yard's one height function, `groundAt(x, z, normal)`, and builds the
ramps, the stairs and the kerb (meshes the bullets hit, railed sides the player cannot walk off).
Everything that stood on y = 0 asks it: the player and the body, each foot, the spent cases and
magazines (`fx.js`) and the review.

- **The body** rides at the ground averaged over 0.6 m round it along the facing and across (a
  riser becomes a slope over that width), lowered by 12 cm per unit of slope so the lower foot
  reaches, eased over 0.1 s: the pelvis rises and falls smoothly over steps and slopes.
- **The slope along the facing** (from the same samples) leans the body into a hill going up
  (0.3 rad per unit of grade) and holds it back going down (0.2), and shortens the steps (by up to
  18 %, made up in cadence).
- **Each foot**: held, it stands on the ground under its ball, its sole
  turned to the surface's normal about the ball; in the air it follows the ground under it eased,
  is lifted over what is just ahead of it (a step's edge, the slope rising), and heads for the
  ground where the clips will put it down. That place is looked ahead to (the loops' contact at the
  gait's pace, the blended clips' foot there, carried on by the body's velocity), and moved along
  the foot until the whole sole is on one tread; a foot is not caught on the ground until it is.
  The hips may drop further than on the flat by the difference between the feet's ground.
- Crouched on a ramp the same holds; the crouch stance's rear foot is on its ball.

## Struck

`demo.hit(way, strength)` (and `Player.hit`; `H` in the game) plays a reaction: `way` is where the
blow comes from (`'f'`, `'b'`, `'l'`, `'r'`), `strength` 0..1. Under 0.6 it is a light flinch,
scaled by the strength; from 0.6 a heavy stagger (front or back; from the side, the light one at
full strength), and the body is shoved away from the blow so the feet step after it. The view is
jolted a little the way the body goes, and with it a shouldered gun, which comes back on line as the
view settles; a body blow sounds (`Sound.hit`).

## The face

`Character._face` (after the arms, once the aim has seated the head) moves the `LeftEye` and
`RightEye` joints and the face's morph targets, each part only where the body has it (`body.face`:
`eyes`, `blink`, `brow`, `mouth`; pass F2). The eyes look at what is in the middle of the view
(where the head is about to turn), at the target when aiming and at the magazine or the pump during a
reload. They hold still on a point and jump to a new one (a saccade, about 35 ms, no sooner than 0.18
s after the last) once it has moved more than about 3 degrees, landing where a moving point will be
0.15 s on; between jumps they follow a slow point and counter-turn as the head turns under them; at
rest they dart now and then. The head's look trails the view by about 0.09 s, so on a turn the eyes
get there first. Blinks come 2 to 5 s apart with now and then a quick double or a long gap, about
one in six only half way, often with a large shift of the gaze and on a shot; a shot also sets the
brow and the mouth; aiming, the off eye narrows; looking down the lids follow the eyes.

## Never standing still

`src/alive.js` decides, at random moments, the small things a person holding a gun does
without thinking: the weight goes onto one leg and then the other, the feet step into a
different stance, the gun is carried a little differently (lower, higher, canted over: small
offsets on the clips' own hold, which already breathes and drifts) with the support hand
sliding along it, the shoulders roll, the neck stretches, and the head and shoulders turn to
look about. Held on aim, the muzzle wanders with breathing
and tiring arms until the hold is re-seated.

The trigger finger is laid on the gun itself (`Character._index`, targets in each gun's frame:
`weapon.finger`): off the trigger it lies straight along the side of the lower receiver above the
trigger guard, pointing forward; to fire it goes into the guard with its end pad on the trigger's
front face (about two frames; the shot waits until it is three quarters of the way in) and comes
back out after. It stays off the trigger while the gun is reloaded, pumped or swapped. Shouldered,
the firing hand sits far enough forward on the grip (on the shotgun, on the stock's wrist) for the
finger to reach.

## Sound

`src/audio.js` synthesises everything in the browser from filtered noise and a few tones:
shots, the pump, magazine and bolt, shells going in, and a footfall each time a foot lands.
There are no audio files. Browsers only allow sound after a click or a key press.

## Judging the motion

`src/review.js` plays each situation through the real update loop and measures it, so the
animation can be judged without watching it:

```js
demo.review(); // one row per situation: idle, aimHold, walk, jog, sprint, strafes, startStop, ...
demo.trace('idle', 30); // spacing chart: one dot per frame for muzzle, hands, head, hips, feet
demo.trace(); // remove the chart
demo.loadTimes(); // start-up stages: each `load:*` performance mark and the ms since the one before
```

Each row gives how statue-like the pose is (`frozenPct`), how far the muzzle, head and hips
travel, the worst single-frame jolt (`snap`, and `snapUpper` leaving the feet out), how fast a planted foot skates (`slide`: the
heel, or the ball while only the ball is on the ground, judged from the ground's height), how
many times the stance, carry or gaze changed of its own accord, and how far each palm is
from where it is meant to be on the gun (`gripCm`) and how far each wrist bends (`wristDeg`:
flexion and deviation, as Blender's review measures it). For the legs it also gives how fast a
planted foot swivels (`footTurn`), the straightest and the most sudden knee (`kneeMin`,
`kneePop`), how far the pelvis turns and rolls (`hipsDeg`), the shoulders against the hips
(`counterDeg`, `twistDeg`), the closest the ankles and the knees come to each other
(`gapCm`), the trigger finger on each shot and off the trigger (`fingerCm`), how much one step differs from the last (`varyMm`), how far the chest leans
forward (`leanDeg`) and how far a foot rolls up onto its ball (`rollDeg`). Besides the original
situations there is one per direction for the walk, the jog and the aimed walk (`walkF`,
`walkFL`, ... `jogBR`, `aimR`), two that sweep round all eight directions and straight
across (`sweepWalk`, `sweepJog`), two that change pace on the move (`walkJog`, `jogSprint`), the
transitions (`startStop` at the jog and `startStopWalk`, setting off and stopping again and again;
`turnAbout`, running back and forth; `turnCarried` and `turnAimed`, standing while the view swings a
quarter turn, a small way back and on again; `turn180`, a half turn), and
the handling: `reload` (the shotgun three shells down), `reloadEmpty`, `reloadWalk`, `reloadJog`,
`reloadBreak` (the trigger pulled during the shotgun's reload), `swap`, `swapWalk`, `swapJog`,
`aimUp`, `aimDown` and `burstUp`. Through a swap `muzzle` follows the gun that was in the hands
at the start and `slung` the other one, whichever is in use.

Pass R3 adds `cheekCm`: shouldered and steady, the aiming eye (the Tripo body's painted eye on the
skin; the eye bone, i.e. the ball's centre, on the EarthOnline bodies) against the sight line, mean
height above it (range) and across it, and the deepest head or neck skin goes into the stock's box
(coarse: the box includes air around a skeletal stock). Pass F2 adds to it `skin`, the deepest head or
neck skin inside any part of the gun's own mesh (closest triangle, inside when behind its face; every
16th frame) and that part, and `cant`, the head's mean cant over the stock (its up against the gun's,
about the bore; + = top towards the gun). The eye columns (`eyeMoves`, `eyeLeadMs`, `eyeOutMm`) read
`-` for a body without eye bones (the Tripo player), `blinkS` for a body without blink morphs; `eyeOutMm` is now the real
eye bone's origin against its rest place in the real head. The sole points and the trigger finger's
tip and pad come from the body's game table. Note: a `swap*` row leaves the other gun in the hands,
so the rows after it in one `demo.review()` run measure that gun.

The crouch and the ground (pass 9) add situations `crouchIdle`, `crouchWalk` and `crouchWalkF` ...
`crouchWalkFR`, `crouchToggle` (down and up standing, then walking), `crouchAim`, `crouchAimWalk`,
`crouchReload`, `crouchSwap`, `crouchHit`, `rampUp10` / `rampDown10` / `rampAcross10` and the same
for the 20-degree ramp, `rampStand20` (standing across the slope), `rampCrouch20`, `rampSequence20`
(pass F2: in one go, walk across the slope, stop, crouch, turn and walk down onto the flat, turn about
and walk back up crouched; `soleAt` says where the worst sole angle was), `stairsUp`,
`stairsStart` (setting off at the foot of the stairs), `stairsDown` and `kerb` (each put in its
place first, walking from the start of the measured part), and columns `sinkCm` (deepest any sole
point went under the ground beneath it), `floatCm` (highest a planted foot's lowest sole point sat
above it; `floatAt`, `sinkAt` say when and where), `soleDeg` (a flat planted sole against the
surface), `vPop` (worst one-frame change of vertical speed of hips / head, world) and `headUpCm`
(the head over the ground).

The gun is only ever held where the arms can reach it: after everything else has had its
say, `Weapon._keepInReach` swings a carried gun about its butt towards the support shoulder,
and lets the support hand come back along the handguard or pump, until that hand reaches.

## Limits

- The walk and the jog have a clip for each of eight directions, the sprint only forward. A
  running (Shift) turn of less than about 130 degrees plays the forward and diagonal jog clips
  while the body swings round; only the about-turn is authored, from the jog's pace. From a
  faster run its first steps are played faster (up to 1.6 times, easing back to the clip's own
  pace), and where the run put the outside foot down nearer than the clip plants it, the body is
  brought up that much short as it brakes, so the inside foot still comes round it clear. Its
  inside foot lands with a jolt of about 3.3 m/s (it swings in the turning body's frame, so it
  is still moving over the ground as it comes down).
- Only setting off forward and stopping from going forward, carried, are authored; setting off or
  stopping sideways, backwards, on a diagonal, shouldered or in first person still eases the
  speed in and out under the loops.
- The transitions are authored from the ready stance; where the feet stood elsewhere (a stance
  drifted by `alive.js`, the wider stance shouldered) the feet are held where they are and rejoin
  the clip as they lift, and a foot let go far from it takes a quick catching step.
- The jogged side shuffle steps six times a second, so its feet change speed fast where they
  land and leave (about 2.5 to 3 m/s in one frame).
- The sprint carries the gun at the low ready pulled in tight, not at a high port: with the
  hands held on the gun as at the low ready the port's wrists would bend 40 to 50 degrees.
- At the low ready the rifle's support hand holds the handguard 6 cm behind `grip_support`, so
  its elbow bends about 70 degrees, but it still points forward and down rather than tucking to
  the ribs. On the shotgun the firing elbow is held out about 10 cm, so that the forearm passes
  outside the deep stock.
- The run-time clothes check covers the torso and thighs, not the arms, and tests the corners
  of each gun part rather than its exact shape; carried, it only answers for what moved the gun
  off the clips' hold, which was checked on the exact posed body in Blender.
- The slung gun rides the chest joint at a fixed place, checked against the posed body standing,
  walking and jogging (1.5 to 2 cm off the back); it does not swing on its sling, and leaning back
  far to aim up it touches the hips.
- The handling clips are authored standing; walking or jogging, the legs keep their gait and the
  clip's trunk is laid over it. As the firing hand lets go of the gun behind its shoulder in a
  swap its wrist folds past its range for two frames, and the forearm runs against the stock
  going over the shoulder. Shouldered, the cheek rests into the stock (the eye is where the sights
  need it), and aiming 45 degrees up the support arm is straight. There is no pouch on the belt:
  the fresh magazine comes out of the hip. No aiming during a reload or a swap.
- No jumping, prone or cover. Crouched there are no turns on the spot, starts or stops as clips:
  the body turns after the view with the run-time stepper and the walk eases in and out. Aiming
  crouched is the standing aim's upper body over the crouched legs (no crouch-specific aim pose),
  so the trunk is upright over the crouch rather than leaning in. The reload's hand paths are the
  standing ones, steered at run time towards where the pouch has moved against the chest: crouched,
  the left palm still gets only within 5.9 cm of the pouch magazine's middle at the draw (3.5
  standing). The authored down / up clips
  move the rear foot, but standing the game's planted feet take the stance from the stepper (the
  rear foot steps back with the stepper's step, not the clip's). The player's collision is a
  circle in plan with no height, so crouching does not change it.
- Slopes and steps are handled at run time over the authored clips (the lean, the shorter steps,
  the foot placement); nothing is authored for them in Blender. On stairs (and over the metre
  before them) the pace drops to 0.85 m/s walking (1.9 running) so each step is about one tread;
  the swinging foot's height follows a line from the tread it left to the one it will land on,
  it is held back behind a riser until it is above the tread ahead, and it is put down only once
  the whole sole is on one tread (the heel may hang over a lower tread). The knee still comes up
  10 to 15 cm more than a careful stair-climber's would. The step's edge tests are along the
  stairs' run (z) only; the ramps and stairs are laid out along z.
- The shotgun's shouldered firing hand runs its fingers up the stock's wrist (for a straight
  wrist with the elbow low), so its trigger finger swings about 60 degrees at the knuckle to reach
  the trigger: from outside it reads as a finger in the guard, but a real knuckle does not go that
  far sideways. A re-authored grip (fingers round the wrist, elbow higher) is the fix.
- The sound is synthesised and has not been listened to. Spare ammunition is unlimited.
- The picture: one shadow map round the player (22 x 22 m), so boxes further away cast no shadow
  (cascades are not used); no screen-space contact shadows (the GTAO and the 5 mm shadow texels do
  that work); motion blur gathers along each pixel's own velocity, so a fast arm smears over
  itself but its outline does not spread over the background (in first person the smear is
  capped at 3 px, so the near gun stays sharp when it kicks); the muzzle flash's point light stands
  40 cm out from the muzzle so the barrel's own steel is not burnt white; the skin wrap light is not shadowed (it can glow
  faintly in a cast shadow near the terminator); no depth of field. TRAA and motion blur need the
  previous frame: `demo.render()` after `demo.advance()` draws without blur, and a kept frame
  wants two or three single steps rendered before it.

## Assets

- `public/ar_rifle.glb` is a copy of `../ar_rifle/ar_rifle.glb`.
- `public/pump_shotgun.glb` is a copy of `../pump_shotgun/pump_shotgun.glb`.
- `public/characters/` holds the Tripo player body (supplied by the repository's owner, generated with Tripo), the
  EarthOnline bodies and motion packs copied from that repository, their UE5 re-rigs, and the clip
  packs built here in Blender (`rifle-motion-tripo-v1`, `rifle-motion-ue5-v1`; the old
  `rifle-motion-v1` and bodies stay on disk but are not loaded; see "Animation clips"). `public/characters/SOURCE.md` lists where each file came from and its licence.
  The motion pack's clips are Mixamo motion capture and are not for separate redistribution;
  the game no longer plays them, and the file is left out of the git repository.

## Debugging

The page exposes `window.demo`:

```js
demo.input.forward = true; demo.advance(2); // jog for two seconds of simulation at once
demo.view = { az: 1.57, el: 0.1, dist: 3, y: 1 }; // watch the character from outside (null to go back)
demo.showBody(1); // switch to another roster character (0 is the Tripo player)
demo.character.rig.bones.hand_r; // the real UE5 bones; demo.character.bones are the proxy's old names
demo.timeScale = 0.25; // slow motion
demo.player.toggleCrouch(); // crouch
demo.review('crouchWalk', 'rampUp20', 'stairsUp', 'kerb'); // see "Judging the motion"
demo.quality = 'plain'; // or 'full' (the G key)
demo.look.show('ao'); // or 'velocity', 'normal', 'hdr' (linear / 4); null for the picture
demo.look.grade.contrast.value = 0.3; // live grade: contrast, saturation, vignette, warm, cool
demo.look.blur.shutter.value = 0.3; // motion blur: shutter, maxPx, minPx
demo.renderer.toneMappingExposure = 0.9;
```

`demo.render()` draws through the same chain as the game (it moves the renderer's frame counter
on, so the shadow map, skinning's previous bones, TRAA history and motion vectors update outside
the animation loop). For a frame to keep: step once and render, two or three times, then render
the frame you keep (one step after the last).


## Vehicles (pass V1)

- **Getting in and out:** walk up to the yellow car parked east of the yard and press **T** (or Enter) near its
  driver's door. The gun goes onto the back, the character walks to the door, the door opens, the driver gets in
  and the door shuts. **T** again (stopped) gets out and draws the gun.
- **Driving:** W throttle, S brake (held at a standstill: reverse), A / D steer, Space handbrake, E / Q shift up
  / down, M auto / manual gearbox, L headlights, P paint colour (the spec's presets), V chase / cockpit camera,
  mouse looks round in both; (V5) I engine start / stop (it starts by itself once seated), Z / C left / right
  indicator. The HUD shows speed, rpm, gear and a g-meter.
- **World:** the yard sits on a concrete apron; a 2.55 km track loop east of it (900 m main straight, two
  hairpins, a 150 m sweeper, a chicane, kerbs, braking boards, lamp posts, barriers), a 65 m skidpad to the west,
  a marked helipad on the apron with the helicopter on it, cones, buildings with windows, doors and roof plant,
  red and white painted concrete barriers (pass V2).
- **Physics:** `src/car/dynamics.js` (pure, no Three.js). Headless checks: `node --test test/dynamics.test.js`;
  in the game `demo.vehicleReview()` drives the same scenarios through the game loop (`src/car/scenarios.js`).
- **Files:** `src/car/` (dynamics, scenarios, car, sound), `src/vehicles.js` (framework, cameras, clip pack),
  `src/seated.js` (the driver's IK), `src/world.js`, `src/track.js`; model `public/vehicles/supercar.glb` made by
  `blender/vehicles/shrink_textures.py` from `../supercar/supercar.glb`.

## Helicopter (pass V2)

- **Getting in and out:** the white utility helicopter is parked cold on the helipad (west side of the apron,
  about x -78, z 112). Walk to its pilot's door (right front) and press **T** (or Enter), the same key as the car.
  The gun goes onto the back, the character walks to `entry_cockpit_R`, the door opens on its hinge, the pilot
  sits and the door shuts. **T** again on the ground (under 1 m/s) gets out.
- **Flying** (keys while seated; also on screen):

| Key | Action |
| --- | --- |
| `W` / `S` (or arrows) | Cyclic forward / aft |
| `A` / `D` (or arrows) | Cyclic left / right |
| `Q` / `E` | Pedals left / right |
| `R` / `F` (or PageUp / PageDown) | Collective up / down (a rate: the lever stays where it is put) |
| `I` | Engine start (the real start: starter, igniter, light-off, idle, flight rpm in about 36 s); with the engine running on the ground: the shutdown (V5: idle, a 10 s cool-down labelled as a game's shortening of the real 2 minutes, fuel off, the rotor running down, the rotor brake below 40 %) |
| `U` | Quick start (a labelled game option: about 9 s, not physical) |
| `O` | Engine cut (fuel off: the rotor autorotates through the freewheel) |
| `J` | Flight assist on / off (on by default; off = the raw controls straight into the flight model) |
| `Y` | Force trim (V5): with the assist off, the stick and pedals' hands-off point becomes where they are now; with it on, the attitude it holds hands-off becomes the attitude now (the hover's left skid low) |
| `H` | Hover hold (with the assist: holds the ground position and the height while the stick is centred) |
| `K` | The mouse flies the cyclic (toggle; otherwise the mouse looks round) |
| `L` | Landing light |
| `V` | Chase / cockpit camera |
| `T` | Get out (on the ground); with the rotor turning it starts the shutdown and the pilot gets out once the blades have stopped (V5) |

- **HUD:** airspeed (IAS), radar height, vertical speed, rotor rpm %, torque %, Ng %, engine state, a small
  attitude indicator, the flight model's warning flags (low rotor, overtorque, vortex ring, retreating-blade
  stall, overspeed, rotor strike, ...) and what the assist is doing.
- **Model:** `src/heli/flight.js` (pure, Node-tested) with `src/heli/assist.js`; scene side `src/heli/heli.js`,
  pilot IK `src/heli/seat.js`, sound `src/heli/sound.js`. Headless checks: `node --test tools/heli/flight.test.js`
  and `node tools/heli/run.js` (writes `tools/heli/report.txt`); in the game `demo.heliReview()` flies the same
  scenarios through the game loop with the same scripted pilot.
- **Asset:** `public/vehicles/utility_helicopter.glb` (15.2 MB) = LOD0 geometry (124.6 k triangles: the cockpit is
  seen from the seat) with textures scaled by `blender/vehicles/shrink_textures.py`:
  `python3 blender/vehicles/shrink_textures.py ../utility_helicopter/utility_helicopter.glb public/vehicles/utility_helicopter.glb ext_normal=2048 int_basecolor=2048 int_normal=2048 displays_emissive=2048 rotor_blur=1024 default=1024`.

## Vehicles, pass V3

- **Shadows:** the sun's shadow is four cascades along the view (`src/look.js`, three's `CSMShadowNode`), so
  buildings, barriers, lamp posts, the vehicles and the far ground keep their shadows when driving, flying and
  from 200 m up. Splits `near x [1, 5, 25]` then 1100 m; `look.setShadow(near)`: 9 m on foot, 14 / 8 m in the
  car (chase / cockpit), 20 / 12 m in the helicopter. Maps 4096, 2048, 2048, 2048; each cascade sized once for a
  68-degree view and snapped to its own texels (no swimming), neighbours cross-fade. `demo.look.cascades` lists
  widths and texel sizes.
- **Helicopter cockpit view:** 6 cm above and 10 cm behind the pilot's eye (at the eye when looking down), pitched 27 degrees down with an 88-degree vertical field
  (`HeliCameras.pitch0`, `fovCockpit`, `eyeOffset`): horizon a fifth down, the panel in the middle, the knees at the
  bottom; looking aside with the mouse eases the look-down off. The rotor disc is a faint blur from under it. Two
  model fixes: the blur discs sat 3.02 m below their pivots (an orange ring at skid height round the aircraft) and
  the red anti-collision light was a point light that lit the cabin pink through the floor (now a spot aimed down).
- **Steering hands:** `src/car/hands.js` (pure; `node --test test/hands.test.js`): push-pull as taught. At speed
  the hands ride at 9 and 3 up to 90 degrees of wheel; past that, or at low speed for big turns, each hand keeps to
  its half of the rim, one grips and turns while the other slides back on the rim; steady near the centre they
  slide home. The steer poses (`car-steer-l/-r`) are blended by where the hands are, not by the wheel; a grip past
  the arm's reach brings the clavicle (up to 34 deg) and then the chest (up to 12 deg) toward it.
- **Guns in the cabin:** with the door shut the guns lie across the car's passenger seat and footwell, or stand in
  the helicopter's left front footwell leaning on the seat (`CABIN_GUNS` in `src/main.js`); they go back onto the
  back as the door opens.
- **Tyre smoke** from the slip power (|F| x slip speed: from 6 kW, full at 70 kW), lit as the sun lights it,
  drifting with a breeze and thinning as it spreads. Skid marks as before.
- **Sound:** Doppler for both vehicles relative to the camera; the car's upper orders fall away at part load; the
  rotor's blade-pass pulse is a band-limited periodic wave (the old saw + shaper made a spike every blade pass);
  inside the helicopter is now quieter than beside it.
- **Getting in and out, measured:** `demo.enterExit('car' | 'heli').then(r => ...)` films and measures both ways
  (clip or placeholder path, contact errors, crossings, root steps). The pack's car-enter, heli-enter and heli-exit
  (shipped 23:14) run on it; car-exit is not shipped (placeholder). Entry and exit clips ease in from the pose before
  them and out into the seated loop over 0.3 s; contacts are pinned with the clip's own elbow / knee bend and
  fingers, eased over 4 frames at their ends, 'ball' contacts take the sole; with the left hand on the helicopter's
  collective the collective pose clips are added for the lever's real angle.
- **Measuring tools (in the page):** `demo.bodyClearance()` also gives `crossCm` (a part's surface cutting a limb,
  not fooled by open shells); `await import('/tools/v3_sound.js')` renders both vehicles' sound offline and measures
  it (`runAll()`); `/tools/v3_cost.js` times physics, step, render and GPU per frame (`run('car' | 'heli')`);
  `/tools/v3_shots.js` makes the V3 picture sets. Sheets and spectrograms are posted to
  `node tools/sheet_receiver.mjs <dir>` (port 5199).

## Vehicles, pass V4

- **Frame time.** The cost was the renderer's work per object per pass (six scene passes: four shadow cascades,
  the depth / normal / velocity pre-pass, the lit pass), not pixels or triangles. 1320 draw calls a frame on foot
  became 194, 1289 driving became 171, 1630 flying became 224. What does it (`src/batch.js`, all switchable for
  comparisons: `?v3` turns every V4 change off, `?perf=-batch,-far,-matrix,-scale,-sleep` single ones, `src/perf.js`):
  - static world meshes merged per material (the yard's boxes, ramps, rails, the buildings with their doors, plant,
    boards, kerbs, lines); the originals leave the scene and stay in `fx.colliders` for the bullets;
  - the car and the helicopter: every moving node (doors, wheels, steering, seat, pedals, controls) is a bone of one
    rigid skeleton, so each material is one skinned draw for the whole vehicle (car 106 -> 23 draws); the rotors and
    the pilot's seat stay as they were (blades fade and change layer one by one; the harness is cut from the seat);
  - shadows from depth-only proxies: per vehicle one skinned proxy (cascades 1 and 2), one rest-pose proxy (cascades
    3 and 4), the world in 80 m patches (near) and 400 m patches (far), each rotor's blades one proxy; the body and
    loose small things cast in the first cascade only (the body is always inside it);
  - the scene's matrices updated once a frame instead of in every pass;
  - the parked vehicle nobody is in sleeps when it has settled (no physics, no re-placing of its nodes);
  - tyre smoke, dust and rotor wash drawn as one instanced sprite each (`src/cloud.js`; they were a draw per puff);
  - render scale: at most 1.5 device pixels per CSS pixel (1536 x 1152 in the 1024 x 768 pane on a 2x screen;
    the GPU's share of a frame 6.2 -> 3.7 ms). Lost: some sharpness on fine edges and thin far lines (pictures in
    the V4 log).
  Measure: `const C = await import('/tools/v4_cost.js'); C.run('foot' | 'car' | 'cockpit' | 'heli', 90, { rounds: 3 })`
  (one frame = step + render + the GPU done; `passes: true` adds CPU, draws and triangles per pass; load the page
  with `?gputime` for GPU timestamps, which this machine's GPU reports unreliably). Pictures: `/tools/v4_shots.js`.
- **Guns while getting in:** they leave the back for the cabin when the body turns its back to the car's cabin
  (about frame 72 of car-enter), or, in the helicopter, once the pilot has turned to sit; back on the back when the
  hips are clear of the doorway on the way out. `demo.gunsAtDoor = true` restores V3's rule (on the back until the
  door shuts) for comparing.
- **Rotor wash rebuilt:** the wake's induced velocity becomes a wall jet of lit dust running out from under the
  disc, thick over dirt, a thin haze on paving, growing with thrust and gone once the hub is a rotor diameter up
  (`Heli._wash`). `/tools/v4_wash.js` films hovers at 2, 5, 10 m and a lift-off.
- **Small:** the seated soles sit on the pedals (the joint went there: 1.7 cm low); tyre smoke reaching into the
  shut cabin fades in the cockpit view (it was drawn over the dashboard); `/tools/v4_misc.js` films the cascade
  borders in motion, the smoke from the cockpit and the helicopter's cockpit view at four stick positions.

## Vehicles, pass V5

- **Live instruments** (`src/instruments.js`). The car's cluster and centre screen and the helicopter's displays are
  canvas textures drawn into the display materials' emissive maps, in the artwork's layout and colours. Car: speed
  ring and digits (km/h), rev ring 0 to 9000 with the red sector from 8500 and digits, shift lights (6500 to 8250 rpm,
  all flashing at the limiter), gear and A / M, TC and ABS lamps while they act, the headlamp tell-tale, the parking
  brake lamp, indicator arrows, fuel and coolant as steady values (not modelled); the centre screen a g-meter with the
  last 3 s of trace and the four tyres' slip against their peak. The lamp check (needles to the end and back, every
  lamp on) at ignition; dark with the ignition off. 15 redraws a second (the centre screen 7.5), 0.9 ms each.
  Helicopter (drawn at 1024 x 512, 10 a second, 1.2 ms each): the PFD (attitude with the pitch ladder and bank
  pointer, IAS tape in knots with the never-exceed mark, altitude tape in feet with the ground and the radar
  altitude, vertical speed in feet per minute, heading strip, the assist's modes as annunciators), the engine page
  (TQ, TOT, N1 = Ng, one dial with the NR and N2 needles, fuel and fuel flow), the caution panel lit from the flight
  model's flags (ROTOR LOW, ENG OUT, OVERTORQ, VRS, DOOR, GEN, AP OFF, LDG LT; two of the artwork's legends, INV and
  CARGO, became VRS and OVERTORQ), and the standby airspeed, attitude and altimeter. Derived, not states of the
  model: TOT (450 C at idle rising with the gas generator's power to 810 C), N2 (the rotor's speed while the engine
  drives it, falling with Ng when it does not), fuel flow (0.36 kg/kWh); fuel is a steady 386 kg (no burn modelled).
  The radios, map, GPS, clock and overhead panel keep the artwork. From the default cockpit views the car's speed
  and rev digits are readable; the helicopter's PFD is about 130 px wide on screen, its attitude and tapes read as
  shapes, its digits do not (look down with the mouse to bring the panel closer).
- **Engine start and stop.** Car (`dynamics.js` `startEngine()` / `stopEngine()`, `car.js` `startSequence()`): parked
  with the engine off; once seated the ignition comes on by itself (the lamp check, 0.9 s), the starter cranks it at
  about 270 rpm for 0.7 s, it fires, flares to about 1550 rpm and settles at idle (1070 rpm) 1.3 s later; I stops or
  starts it (stop below 5 km/h); getting out switches it off. Engine off, both clutches are open. Helicopter: I with
  the engine running on the ground, or T, starts the shutdown (`Heli.shutdown()`): ground idle with the collective
  down, the 10 s cool-down (labelled), fuel off, the rotor coasting to 40 % (about 30 s) and the rotor brake to a stop
  (about 7 s), the battery off; with T the pilot gets out once the blades have stopped (about 47 s after the key).
- **Warnings and cabin sounds.** Helicopter (inside, with the lamps at the same frame): the low-rotor horn (600 Hz)
  below 95 % Nr when airborne or with the collective up (not at ground idle, not in a shutdown), the engine-out warble
  (600 / 1000 Hz) once the engine has run and Ng falls under 55 % or it stops with the rotor turning, the overtorque
  chime over 100 % torque. Car: the starter, the first firing, the limiter's stutter (the engine drops to 6 % at each
  cut with a small pop), the indicator relay's tick and tock, crunches by the impact's speed change, the scrape; the
  door thunks of both vehicles got a second, panel mode. No brake squeal (a squeal from carbon-ceramic brakes at a
  crawl could not be made convincing from noise and a tone, so it was left out). `/tools/v5_sound.js` renders and
  measures them offline as `/tools/v3_sound.js` does.
- **Collisions** (`dynamics.js` `_collide`, `_contact`): the car's footprint against the world's boxes and the
  helicopter's hull (`Heli.contactBody()`): the contact point is the car's corner inside the box or the box's corner
  inside the car (the middle of two when square on), at bumper height; a normal impulse with restitution 0.15 (none
  under 0.5 m/s of approach), friction 0.45 along the face, both through the full mass and inertia at the point (an
  off-centre hit turns the car; a hit on the helicopter pushes and turns it on its skids); the kinetic energy is
  checked at every impulse and never rose in the tests. The impulse makes sparks, a crunch and a camera shake by its
  speed change, and the driver's torso and head are thrown against the belt (`car.js` `BodyThrow`: two damped springs
  on the car's acceleration, the same signal that leans him; stops at 15 / 35 deg forward). No damage model: the car
  is not deformed and drives on. The impulse is instantaneous (a rigid barrier against a rigid car), so the speed
  change happens in one 1/1200 s step; no crumple zone is modelled. `node tools/v5_crash.mjs` runs the barrier tests.
- **Keyboard feel** (`src/keys.js`, pure): steering ramps toward the key's side at a rate that falls with speed (full in
  0.18 s standing, 0.5 s at 200 km/h) and comes back 1.6 x as fast, counter-steer at the return rate; throttle 0.12 s
  on, 0.08 off; brake 0.10 on, 0.06 off. The helicopter's cyclic and pedals return to the trim point (Y), not to zero.
  `node tools/v5_keys.mjs` drives and flies with scripted key presses (80 to 200 ms taps and holds): a lap, a slalom,
  a take-off to a 10 m hover, a circuit with a landing on the H, the hover with the assist off, and what one tap does.
- **Getting out of the car** runs the pack's `car-exit` clip (shipped 00:51): door by its track, contacts pinned, the
  guns back on the back, the hand-over to on-foot control where the clip's last frame stands.
- **Tools:** `/tools/v5_shots.js` (instrument crops, the helicopter's warnings, the car into a barrier in the game),
  `/tools/v5_sound.js`, `tools/v5_crash.mjs`, `tools/v5_keys.mjs`.

## Vehicles, pass V6

- **Hand-overs.** Getting in and out is one chain: on foot with a gun, the gun onto the back (the swap clip's outgoing
  half), the walk to the door, the entry clip, the seated loop, the exit clip, the draw (the same half backwards, from
  its end), on foot. Every join is now continuous in place and in speed:
  - the walk ends exactly on the entry clip's first frame: it walks to the clip's notes root, lets the game's own turn
    on the spot face it round, then settles the last 0.6 m and 0.8 rad with the feet planted while the stance steps each
    foot to where the clip's first frame has it (`character.stance`); the clip starts from the pose the last frame
    ended with;
  - the exit hands over where the clip's (or the placeholder's) last frame stands and faces, with the feet planted
    where that frame has them (`character.plantFeetAsPosed()`);
  - `src/inertia.js` (`PoseInertia`): when what poses the body changes (vehicle -> on foot, the stow or the draw
    ending), the old pose carried on is added to the new one as an offset that dies away over 0.35 s (inertialization:
    joint rotations, the Hips and the root; planted feet held where the new pose has them). `demo.inertia` shows it.
  - the EarthOnline bodies sit on their pack's fitted seated clips and get in and out on the placeholder; its legs now
    blend from standing into the seat (they jumped at the end), and its ends are eased into and out of the seated loop.
- **`demo.chainReview('car' | 'heli', { film })`** (`src/chain.js`) plays the chain at 60 Hz and reports per part (both
  hands and feet, head, pelvis, root) the largest one-frame change of velocity and the join it falls in, per join the
  same, the root's jump, and the planted feet's slide on the ground outside the vehicle; with `film` it posts 25 frames
  round each join from a fixed three-quarter view to `tools/sheet_receiver.mjs`. Run as
  `demo.chainReview('car').then(r => window.__cr = r)`; reload between the car and the helicopter.
- **`skidpad200`** in `demo.vehicleReview()` runs round a centre 500 m west of the skidpad, on a tarmac ring laid for
  the run (the 230 m circle round the skidpad ran into the yard's wall and over dirt): 1.284 g at 207 km/h, as in Node.

## Vehicles, pass V7

- **Keys (new):** `Shift` held in a cockpit view: lean in to the instruments (the helicopter: the head 14 cm toward the
  panel, the view on the PFD at a 34-degree field; the car: toward the cluster at 30 degrees), eased 0.35 s in and out;
  the mouse still turns the head while leaning. `9` time of day, `8` wind, `0` repair (all modes).
- **Mirrors** (`src/mirrors.js`): the rear-view mirror and both door mirrors show the scene behind. Each is rendered from
  the viewer's eye reflected in the mirror's plane, through an off-axis frustum whose window is the glass itself (near
  plane = the glass, so the roof and windscreen in front of it are cut away); the glass samples that picture at its own
  points' projection, so it is the right way round. The door mirrors are convex (window widened 1.55 x). The driver sets
  them on getting in: each housing turns about its root with the glass (its vertices in the car's batch rewritten, no
  extra draw), the rear-view one to look straight back through the rear window (its frame shows), the door ones straight
  back and a little out (the flank at the inner edge). One mirror is drawn per frame in turn (each every third frame),
  only within 9 m of the camera, facing it and in view; 256 x 64 and 160 x 128 textures; the shadow maps are reused
  from the main camera's cascades. `?perf=-mirrors` or `demo.perf.mirrors = false` turns them off.
- **Damage** (`src/damage.js`), from every contact impulse: dents (the body's vertices near the contact pushed along the
  impulse, depth 0.2 (1 - exp(-dv / 18)) m over 0.25 + 0.012 dv m, accumulated, each vertex held 3 cm off the cabin's box
  and the wheels' envelopes, normals re-made so the shading shows them), scraped paint where a panel slid on a wall,
  the windscreen cracked from 12 m/s of speed change, a headlamp or tail lamp broken on that side (dark, no beam), a
  door mirror folded or knocked off, a bent steering arm (the wheel toes up to 3 degrees: the car pulls) and a flat-spotted
  tyre (a thump once a turn) after hard hits at a wheel. The helicopter: a touchdown over 3.0 m/s bends the cross tubes
  (the skid contact points and tubes move up: it sits lower, on one side if it landed banked), tail strikes are flagged
  (over 15 kN the tail rotor is struck). Draw calls are unchanged (the batches' own vertices and material inputs).
  `0` or `demo.repair()` restores both; `demo.car.damage.measure()` and `.log` report it.
- **The world** (`src/terrain.js`): the ground rolls off the paving (0 to about 2.4 m, gone within 10 m of any paving
  or anything the car can hit, so the yard, the track, the skidpad and every building stand as before), through
  `groundAt` (the car's tyres, the helicopter's skids, the feet); grass tufts and scrub within 60 m of the camera bend
  in the wind, flatten under the rotor wash and part round the car; about 200 trees and 130 bushes along the track and
  round the airfield (instanced, swaying, casting shadows in every cascade); hills on the horizon; 46 clouds of soft
  puffs at 700 to 1300 m drifting with the wind; edge lights along the track, round the helipad and the apron (lit at
  dusk and night), marker boards, tyre walls at the north hairpin (visual: the car's wall is the barrier behind them),
  a wind sock at the helipad that swings downwind and fills by 7.7 m/s. Wind: a steady wind with gusts (`demo.weather`)
  into the flight model's `wind`, the tyre smoke, the rotor dust, the grass, the trees and the sock. Time of day
  (`demo.setTime('midday' | 'afternoon' | 'dusk' | 'night')`): the sun, the sky, the environment light (re-baked), the
  haze, the exposure, the sprites' light, the lamps and the screens' brightness change together; the headlamps come on
  at dusk and night. `?perf=-terrain,-flora,-sky,-furniture` switch the parts off.
- **Measures:** `demo.vehicleReview()`'s `hipsOffSeatCm` is now the hips against the pack's seated reference
  (car-drive frame 0, built for the fitted seat), not the placeholder's seat point.
- **Clip contract:** `vehicleFit` entries may carry `scale` (applied to the node about its origin) and a clip's notes a
  `guns` hand-off track (on the back before `from`, on the track to `to`, at the cabin places after; the reverse on the
  way out); packs without them work as before.
- **Tools:** `/tools/v7_cost.js` (`ab(case, flags)`: alternating blocks with the features on and off in one page),
  `/tools/v7_shots.js` (sheets, crops, mirror textures, `crashDamage`), `node tools/v7_slalom.mjs` (the keyboard slalom
  with four steering modes).

## Vehicles, pass V8

- **Flora** (`src/flora.js`, on by default again; `?perf=-flora` or `demo.perf.flora = false` turns it off). Grass:
  clumps of 20 thin opaque blades (5 vertices each, curved, leaning, green, yellow-green or straw, a dark root), on a
  0.36 m world grid in 8 m chunks made once and kept; full density to 7 m from the camera, then falling as (7 / d)^1.5 to
  nothing at 46 m, each clump shrinking into the ground before it is dropped and the far ones spreading wider (no pop);
  only the chunks in the view's sector are drawn; none above 60 m over the ground. The grass is drawn in the lit pass
  only (its own layer, 7): not in the depth / normal / velocity pre-pass, the shadow cascades or the mirrors. Each blade
  bends over by an angle from the wind (gusts and a flutter running downwind), the rotor wash (laid flat under the disc,
  out to about 2 rotor diameters) and the car (its footprint pushes the blades aside and forward), keeping its length;
  the tips catch the sun's colour (light through the blade). The ground under it is greener and darker where it grows
  thick (the same patches). Over grass the rotor wash lifts less dust than over bare dirt. Trees: three shapes (a round
  broadleaf, a tall oval one, a fir) with trunks, boughs and crowns of leaf sprays (a dark core and small double-sided
  leaves) or drooping branch whorls; within 110 m the full version, past it a version of 6 to 8 blobs; one draw for each
  version (the shapes merged, each instance picking its own), the bushes inside the far version; nothing behind the
  camera past 20 m; the shadows from one depth-only proxy (the far versions of every tree within 170 m) in the two near
  cascades; 469 trees (40 copses added) and 261 bushes. All sway and lean from the wash.
- **Cost** (`/tools/v8_cost.js`: `inter(case, variants)` draws one frame of each variant per round in a shuffled order,
  `table(case)` the scenery off / on / A-A / flora off and, in the cockpit, the mirrors off): the scenery (flora,
  terrain, sky, furniture) adds 1.0 to 1.8 ms a frame (median) on foot at the yard's edge, in the chase view, the
  cockpit and the helicopter at 100 m; the mirrors 0.4 ms in the cockpit (one mirror every second frame now, each at
  most every fourth). Cases: V4's plus `edge` (on foot at the yard's south edge looking south over the grass).
- **Tyre walls** (north hairpin): two rows now, and they stop the car: each stack group is a deformable barrier in the
  car's physics (a progressive spring and a damper that comes in over the first 25 cm, per 2 m of the car's width
  against it): 30 km/h square on stops in 0.45 m, 60 km/h in 0.78 m (11 g mean), 90 km/h in 1.09 m, with 0.5 to 1.8 m/s
  of rebound (the concrete behind: 3.7 m/s). `?perf=-furniture` removes them and their barrier.
- **Damage:** dents deeper (0.35 (1 - exp(-dv / 14)) m: 16 cm for the 30 km/h head-on hit); a hit at a corner of the
  collision box (where the body is rounded off) is centred on the nearest panel; a door mirror folds whenever the
  flank is flat on a wall on its side.
- **Helicopter:** the lean-in (Shift) drops the head 20 cm as it leans 20 cm toward the panel at a 30-degree field: the
  whole PFD (annunciators, both tapes, the heading scale) is in view below the glare shield. The landing light is 320
  (was 900). At dusk and night the dust and smoke are dimmer (they were brighter than the ground).
- **Measures:** `demo.vehicleReview()` has a `lapReal` row: one lap on the world as played (rolling ground, furniture,
  tyre walls on), a pure-pursuit driver at up to 160 km/h; reports the lap time, the furthest wheel from the centre line,
  frames with a wheel off the tarmac or kerb, the springs' travel, the peak tyre load and vertical acceleration.
- **Hand-overs:** the stow's end into the walk to the vehicle blends the arms over 1.3 s (`src/inertia.js`).
- **Tools:** `/tools/v8_cost.js`, `/tools/v8_shots.js` (sheets, crops, `carAt`, `heliAt`, `crashFilm`).
