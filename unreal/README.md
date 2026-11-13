# FBX for Unreal Engine 5 (pass R4, 2026-11-11)

The characters on the `earthonline-ue5-v1` skeleton (UE5 Mannequin bone names and hierarchy, built by
us: no Epic files) and their 80 clips per skeleton, as FBX for UE 5.x. Nothing here was opened in
Unreal (there is no Unreal on this machine). What was proven without it is under "Verified here";
what only Unreal can show is the checklist at the end.

## Files

| Path | What |
| --- | --- |
| `bodies/<body>.fbx` | skinned mesh + full skeleton, textures embedded. `tripo-player-ue5` (89 bones: 87 + `Gun`, `GunIn`; no morphs), `civilian-m-01-player-ue5`, `civilian-police-m-hero-ue5`, `civilian-f-02-hero-ue5`, `civilian-m-03-hero-ue5` (92 bones: 90 + `Gun`, `GunIn`; 16 morph targets) |
| `bodies/textures/<body>/` | the same textures as files (the GLB's original bytes), for building materials by hand. Tripo: full resolution from the master body (`blender/bodies/tripo/tripo-player-ue5.glb`: base colour 8192, normal and roughness/metal 4096), not the game's lighter copy |
| `animations/tripo/<clip>.fbx` | 80 clips for the Tripo skeleton, one per file, skeleton only, 30 fps |
| `animations/earthonline/<clip>.fbx` | 80 clips for the EarthOnline skeleton (all four EarthOnline bodies) |
| `animations/<skeleton>/notes.json` | the clip notes (copy of `public/characters/rifle-motion-*-v1.json`): events (`handOver`, `magOut`, `pumpBack`...), per-frame hold codes, foot contacts, `root` track |
| `retarget/tripo_apose.fbx`, `retarget/earthonline_apose.fbx` | the retarget pose (UE5-like A-pose) as a 2-frame animation (frames 0 and 1 identical); `.json` beside each = the same pose as local rotations |
| `weapons/ar_rifle.fbx`, `weapons/pump_shotgun.fbx` | the two guns, static meshes in cm, origin at the butt, in the `Gun` bone's frame; parts kept as separate meshes; point nodes as `SOCKET_` sockets |
| `weapons/textures/<gun>/` | the guns' textures as files |
| `review/sheet_<body>.png` | contact sheets rendered from the re-imported FBX (body + animation + weapon FBX) |
| `review/proof_summary.txt` | every number below, per clip and per body |
| `review/fbx_check.json`, `review/proof/*.json`, `review/build/*.json` | raw results |
| `manifest.json` | input hashes per output (what `make.py` uses to skip unchanged files) |

## Rebuild

```
python3 blender/export_unreal/make.py              # only what changed, then header check + proof
python3 blender/export_unreal/make.py --force      # everything
python3 blender/export_unreal/make.py --no-proof   # skip the Blender round trip (header check still runs)
```

Bodies are read from `public/characters/<body>.glb`, except where `BODY_SOURCE` in
`blender/export_unreal/config.py` names a master (pass F1: `tripo-player-ue5` -> `blender/bodies/tripo/tripo-player-ue5.glb`,
because the game's copy carries reduced textures; skeleton, mesh and weights are the same in both).

It runs a private headless Blender (`/Applications/Blender.app/Contents/MacOS/Blender -b
--factory-startup`), never a socket session, up to 4 at a time (`R4_JOBS`). Each output is hashed
from its inputs (body GLB, frames file, per clip only that clip's channel bytes, the export scripts),
so a clip-pack rebuild that changes three clips re-exports three FBX. Clips that leave the pack are
deleted here. `--adopt` records the existing outputs as current without building. Timing measured
here: one clip 0.4 to 0.7 s at normal load (80 clips 5 to 11 minutes per process under a load average
of 110 to 160 from other work on this machine); a body 1 to 6 s; a run with nothing changed 61 s
(the header check of all 167 FBX; `--no-proof`). Scripts: `blender/export_unreal/` (`build_unreal.py` export, `proof_unreal.py` round
trip and sheets, `check_fbx.py` + `fbxread.py` header reader without Blender, `gltfio.py` /
`skeleton.py` the numpy GLB side, `report.py` the summary).

## How the FBX are written (and why)

Blender scene in **centimetres** (unit scale 0.01, every number x100: the data are cm in Blender
already), Blender's own axes (Z up, the character facing -Y). Blender FBX exporter:

| Setting | Value | Why |
| --- | --- | --- |
| `apply_unit_scale` | True | with unit scale 0.01 the exporter's factor is 100 x 0.01 = 1 |
| `apply_scale_options` | `FBX_SCALE_NONE` | no scale on any node; `UnitScaleFactor` = 1.0 (cm), so Unreal reads cm as cm: no 0.01 / 100x skeleton, root motion in cm |
| `global_scale` | 1.0 | |
| `axis_forward`, `axis_up` | `Y`, `Z` | Blender's own system: the exporter adds no conversion matrix (the `Armature` null and the mesh have identity transforms). The file says Z up, front -Y, right-handed (3ds Max's system), which is what Unreal's importer converts into, so Unreal's "Convert Scene" is an identity there and only flips Y into its left-handed space |
| `primary_bone_axis`, `secondary_bone_axis` | `Y`, `X` | FBX joint frames = Blender bone frames = the glTF joint frames (bones along +Y), no re-orientation |
| `armature_nodetype` | `NULL` | the armature object is a Null called **`Armature`**: Unreal skips a root node of that name, so `root` is the skeleton's only root bone |
| `add_leaf_bones` | False | no `_end` bones |
| `use_armature_deform_only` | False | keeps `root` and the 7 IK bones (they carry no weight) and `Gun` / `GunIn` |
| `bake_anim_*` | all bones, every frame (`step` 1, `simplify` 0), start/end keyed, no NLA, no "all actions" | one take per file, named after the clip; a key on every frame of the GLB, nothing thinned |
| `mesh_smooth_type` | `FACE` | smoothing groups written (Unreal warns without them); the GLB's normals are exported as they are |
| `use_mesh_modifiers` | False | keeps the shape keys (morph targets) |
| `path_mode`, `embed_textures` | `COPY`, True | base colour and normal map inside the FBX (the exporter embeds only textures wired straight into a socket; the packed roughness / metal map is not); every texture is also a file in `bodies/textures/` |

The skeleton is built from the GLB data, not from Blender's glTF importer (which re-orients bones for
display and adds an `Icosphere` bone-shape mesh): every bone's rest = the GLB joint's world matrix,
turned into Blender axes. Only the mesh comes from the importer (vertex order, UVs, normals, shape keys,
material), detached from the importer's armature; the importer's armature and Icosphere are deleted
before export (checked: the re-imported body has exactly one armature and one mesh).

**Three bones get world-aligned frames instead of the glTF frame:** `root`, `ik_foot_root`,
`ik_hand_root` (identity in glTF, which in Blender / Unreal axes would be a 90-degree turn about X).
In Unreal they rest with identity rotation, as on Manny. This matters for `root`: Unreal's root-motion
extraction turns the travel by the inverse of the root's first-frame rotation, so a root at 90 degrees
about X would turn forward travel into vertical travel. Root motion in the transitions is then a
translation in the ground plane plus a yaw about Z. Every other bone keeps its glTF joint frame exactly
(EarthOnline: along +Y, flexion about +X, R1's frames; Tripo: Tripo's own frames).

**Clips onto the skeleton.** The clip GLBs have no skin; each clip is bound to the body's skeleton by
bone name: a bone's pose = restLocal^-1 * clipLocal (the clip's locals include the rest, which on
Tripo is Tripo's T-pose bind and bone axes). Unkeyed channels (translation of most bones) take the
body's rest. The EarthOnline clips are baked on `civilian-m-01-player-ue5`'s skeleton; the four
EarthOnline bodies share every joint except `jaw`, `eye_l`, `eye_r` (up to 6.4 cm apart on f-02):
see "Translation retargeting" below.

**Frames.** Every key of the GLB becomes a frame: cycles keep their closing frame (frame N = frame 0,
e.g. `rifle-walk-f` 63 frames = 62 intervals = 2.067 s), so Unreal's loop is seamless; the one-pose
clips (`rifle-aim-*`, `shotgun-aim-*`, `rifle-hold-low/high`) have 2 identical frames.

### `Gun`, `GunIn` and the dropped helpers

The clips animate six helper nodes under `spine_05`. **`Gun` and `GunIn` are bones in every exported
skeleton** (leaf bones under `spine_05`; the body FBX and every animation FBX have the same bone set).

- `Gun` = the held gun: its origin is the gun's butt (the middle of the butt pad, where the game
  pivots the gun), its axes are the gun's glTF axes (barrel along -Z, top +Y). Rest = the low ready
  hold (`rifle-hold-low` frame 0). Attach the weapon you hold to it with zero offset.
- `GunIn` = the incoming gun during a swap. Rest = the rifle's slung place on the back (where
  `swap-shotgun-rifle` draws it from), so outside the swaps a second gun attached to `GunIn` hangs slung.
  In the swaps it carries the incoming gun from the back to the hands. Clips without a `GunIn` track
  hold it at rest.
- The clip packs author both in `spine_05`'s CANONICAL frame (the old Spine2 joint's). On the
  EarthOnline skeleton that is the bone's own frame. On Tripo it is not (Tripo's `spine_05` is turned
  85 degrees about Y in its bind), so the exported local is `R[spine_05]^-1 * track`: the bone lands at
  exactly the world place the game gives the gun (checked per frame, table below: `Gun` within
  0.001 mm / 0.0001 deg of the GLB on both skeletons).
- `PalmL/R` and `ElbowL/R` are authoring helpers (palm targets and elbow poles for the game's arm IK):
  **dropped**. `ik_hand_gun`, `ik_hand_l/r`, `ik_foot_l/r` are kept and keyed as in the clips.
- Swap timing: the notes' `events.handOver` (e.g. `swap-rifle-shotgun` 0.953 s) is when the hands
  change guns; `track.hold` gives per frame what each hand holds (0 nothing, 1 the `Gun` gun, 2 the
  `GunIn` gun). FBX cannot carry anim notifies: add a notify at `handOver` in Unreal, and at the end of
  the swap move the guns (the one on `GunIn` goes to `Gun`, the one on `Gun` - now slung - to `GunIn`).

## Import into UE 5.x

### 1. Skeletal meshes

Content Browser > Import > `bodies/tripo-player-ue5.fbx`. FBX Import Options:

- Mesh: **Skeletal Mesh** on. **Skeleton: none** (creates `tripo-player-ue5_Skeleton`). Import Mesh on.
  **Import Morph Targets** on (EarthOnline bodies; Tripo has none). Use T0 As Reference Pose **off**.
  Import Content Type: Geometry and Skinning Weights. Preserve Smoothing Groups on.
- Normal Import Method: **Import Normals** (tangents computed by Unreal). Thresholds default.
- Transform: Import Translation 0, Rotation 0, **Import Uniform Scale 1.0**.
- Miscellaneous: **Convert Scene on**, **Force Front X Axis off**, **Convert Scene Unit off** (the file
  is already cm; either setting gives the same size for a cm file, but off is the one to keep).
- Animation: Import Animations **off** (the body file has no take).
- Material: Create New Materials, Import Textures on. Vertex colours: Ignore (COLOR_0 is white on every
  body).

EarthOnline: import `civilian-m-01-player-ue5.fbx` first with Skeleton none, then the police, f-02 and
m-03 bodies with **Skeleton = `civilian-m-01-player-ue5_Skeleton`** (same 92 bones and hierarchy).
Unreal may report that the reference pose differs (jaw and eyes): accept; each mesh keeps its own.

Expected in the Skeletal Mesh editor: 175 cm tall (Tripo 175.0, EarthOnline see the table), feet on
Z = 0, the character facing **+Y** (as `SKM_Manny`'s asset does), one root bone `root` at the origin
with no rotation, no `Armature` bone, 89 / 92 bones.

### 2. Materials (build by hand; the FBX importer only maps base colour and normal)

| Body | Base colour | Normal | Packed map | Blend |
| --- | --- | --- | --- | --- |
| Tripo | `human_figure_3d_model_basecolor.jpg` | `..._normal.png` | `..._rm.jpg`: glTF metallicRoughness (G roughness, B metallic) | Opaque, one-sided |
| EarthOnline | `basecolor-2048.png` (alpha = opacity mask) | `normal-2048.png` | `orm-2048.png` (R occlusion, G roughness, B metallic; also the glTF specular texture) | **Masked, cutoff 0.5, two-sided** (hair, brows, lashes) |

Normal maps are glTF (OpenGL, +Y up): tick **Flip Green Channel** on the normal textures in Unreal.
Packed maps: set the texture to Linear (sRGB off), Compression "Masks".

### 3. Animations

Import > select all 80 files in `animations/tripo/` (or `animations/earthonline/`):

- Skeleton: **`tripo-player-ue5_Skeleton`** (EarthOnline: `civilian-m-01-player-ue5_Skeleton`). Import
  Mesh off (the files have no mesh). Import Animations on.
- Animation Length: **Exported Time** (frames 0..N-1 as written). **Use Default Sample Rate off** (or
  Custom Sample Rate 30): the files are 30 fps.
- Convert Scene on, Force Front X Axis off, Import Uniform Scale 1.0 (same as the mesh).
- Remove Redundant Keys may stay on (it only drops keys that change nothing).
- Every bone in the files is in the skeleton (same names and parents), so Unreal should report no
  missing or extra bones.

Each sequence is named after its file (one take per file, named after the clip).

**Root motion.** The 28 transition clips (starts, stops, pivots, run-turns: the clips whose notes have
`root`) carry their travel on `root`: translation in the ground plane and yaw about Z. Every other clip
holds `root` at rest (in place). For the transitions: AnimSequence > **Enable Root Motion** on, Root
Motion Root Lock **Ref Pose**, Force Root Lock off; in the Animation Blueprint, Root Motion Mode "Root
Motion from Everything" (or play them as montages). Do not also move the character from the notes'
`root` track: it is the same travel.

**Translation retargeting (EarthOnline skeleton).** The clips key translation only on `root`, `pelvis`,
the IK bones, `Gun`, `GunIn`; the FBX still writes every bone's translation (m-01's). On the shared
EarthOnline skeleton set: Skeleton editor > right-click `root` > **Recursively Set Translation
Retargeting Skeleton**, then set `root`, `pelvis`, `ik_foot_root`, `ik_foot_l/r`, `ik_hand_root`,
`ik_hand_gun`, `ik_hand_l/r`, `Gun`, `GunIn` back to **Animation**. Otherwise the police / f-02 / m-03
jaw and eyes take m-01's places (f-02's jaw 6.4 cm off). On Tripo (one body) it does not matter.

**Twist bones** are keyed in every clip (R1 / T1b shares), so the forearm keeps its girth with no
post-process rig. If you add a post-process AnimBP or Control Rig that drives twist bones the Manny way,
it will fight these keys.

### 4. A gun on the hand

Import `weapons/ar_rifle.fbx` as a **Static Mesh**: Combine Meshes **on** (one mesh) or off (one mesh
per part: barrel, magazine, charging_handle, trigger...; all parts share the same origin, so they can be
moved by code relative to it), Convert Scene on, Force Front X off, Uniform Scale 1.0, Auto Generate
Collision as you like. The four `SOCKET_` nulls (muzzle_point, eject_point, grip_main, grip_support)
import as static-mesh sockets.

Then, in the character Blueprint: add a Static Mesh Component, **Parent Socket = `Gun`** (a bone name is a
valid socket name; or add a socket on the `Gun` bone in the Skeleton editor), relative location /
rotation / scale **0 / 0 / 1**. The mesh is in the `Gun` bone's frame on purpose, so in the static mesh
editor it lies with the barrel along -Z: that is right. For the shotgun the same on `Gun`; during a swap
put the incoming gun on `GunIn` (see the swap timing above). The game also nudges the shotgun's carried
hold by `CARRY_SHIFT` (1.5 cm right, 1 cm down, 2 cm forward in the chest frame, `src/shotgun.js`): that
offset is not in the clips; add it as the socket's relative location for the shotgun if you want the
game's exact carry.

### 5. Retargeting to and from Manny (IK Rig + IK Retargeter)

Our bone **names** and hierarchy match the Mannequin; our bone **axes** do not (Manny's bones run along
X; ours along Y with R1's rolls, Tripo's along Y with Tripo's rolls; the rests are I-pose / T-pose, not
Manny's A-pose). So:

- **Sharing Epic's `SK_Mannequin` skeleton asset, "compatible skeletons", or copy-pose-by-name is not
  expected to work**: local rotations mean different things on the two rigs. Always go through the IK
  Retargeter.
- IK Rig for our skeleton: create an IK Rig on the skeletal mesh. In UE 5.3+ "Auto Create Retarget
  Chains" / "Auto Create IK" recognise Mannequin bone names and should build the usual chains (spine
  `spine_01`..`spine_05`, neck `neck_01`..`head`, clavicle, arm `upperarm`..`hand`, the fingers, leg
  `thigh`..`ball`, root `root`, retarget root `pelvis`). Twist bones and IK bones are not in chains (as
  on Manny). Otherwise make those chains by hand with those bone names. Retarget Root: `pelvis`.
- IK Retargeter (source Manny's IK Rig, target ours, or the reverse): the retarget pose of our side
  must match Manny's A-pose. Import `retarget/<skeleton>_apose.fbx` as an animation on our skeleton,
  then in the retargeter: Edit Retarget Pose > Create > **Import from Animation Sequence** (UE 5.2+),
  frame 0. Where that menu is missing, use "Auto Align" (5.3+) or pose the arms by hand to the numbers
  in `<skeleton>_apose.json`. The A-pose is R1's description (arms 45 degrees below horizontal, elbows
  15, palms down and in, legs 4 degrees apart), not Manny's measured angles: compare the two side by
  side and nudge.
- Retargeted onto our skeleton, Manny clips leave our twist bones at the reference pose (Manny's ABP
  drives its own); add a twist-drive (Control Rig or the AnimBP "Twist Corrective" approach) if you play
  Manny clips on our bodies. Our clips retargeted onto Manny carry the twist in the hand only.
- Root motion through the retargeter: enable "Root" chain translation (Retarget Root settings) so the
  transitions' `root` travel survives, and scale by the height ratio as needed.

Optional Manny-axis variant (not built): the exporter's `primary_bone_axis` / `secondary_bone_axis`
apply one constant turn to every bone, so `X` / `-Y` would make our bones run along X like Manny's; but
which axis is flexion and how the right side's signs mirror are per bone on Manny, and without Epic's
files we cannot match them; the IK Retargeter does not need it. The safe way, if ever wanted: export a
Manny-axis skeleton with per-bone frames measured from a Manny the user exports from their own Unreal
(not shipped here), and bake clips through that.

## Verified here (no Unreal) and how

All numbers per clip / body are in `review/proof_summary.txt`; summary:

Method: the GLB side is evaluated in plain numpy (`gltfio.py`: accessors, linear / slerp sampling,
forward kinematics, linear-blend skinning with the GLB's inverse bind matrices) - no Blender. The FBX
side is the FBX re-imported by Blender's own FBX importer into a fresh headless Blender (default bone
orientation, primary Y / secondary X, no animation offset), and separately read byte by byte by
`fbxread.py` (what Unreal's importer starts from).

FBX as written (all 167 files):

| What | Result |
| --- | --- |
| FBX version, units | 7400 (binary), `UnitScaleFactor` 1.0 (cm) in every file |
| Axes | Up Z+, front -Y (sign -1), coord X+: 3ds Max's / Unreal's import system |
| Root | exactly one LimbNode root, named `root`, parent the Null `Armature`; no LimbNode named `Armature`; the only other models: the Null `Armature` and the mesh (bodies) |
| Bones | names and parents = the GLB's joints + `Gun`, `GunIn` under `spine_05`: Tripo 89, EarthOnline 92; every animation and retarget FBX the same set |
| Height (file units, mesh vertices, Z up) | Tripo 175.000 (soles at 0.000); m-01 175.666, police 175.529, f-02 175.581, m-03 175.651 (top of head at 175.0, the EarthOnline shoe soles 0.53 to 0.67 cm below the root, as in the GLBs) |
| Morph targets | 16 BlendShape channels on each EarthOnline body (jawOpen, mouthSmileLeft/Right, mouthFrownLeft/Right, browInnerUp, browDownLeft/Right, eyeBlinkLeft/Right, eyeWideLeft/Right, cheekPuff, viseme_aa, viseme_PP, viseme_O); Tripo none |
| Frames | every animation FBX: 30 fps (TimeMode 6, CustomFrameRate 30), frame count from the take span = the GLB clip's key count (80 / 80 per pack); one take per file named after the clip |
| Root travel, read from the FBX's own `root` curves | 28 transitions per pack vs the notes' `root` track (x, z): worst 0.00001 cm |

Round trip (Blender re-import vs GLB), every bone incl. `Gun` / `GunIn`, every frame; 14 clips per pack:

| Pack | Worst joint position | Worst bone angle | `Gun` | Root vs notes (transitions) |
| --- | --- | --- | --- | --- |
| tripo | 0.0084 mm (rifle-sprint, ball_r) | 0.0019 deg | 0.0009 mm / 0.0001 deg | 0.0003 mm / 0.00003 deg |
| earthonline | 0.0533 mm (swap-shotgun-rifle, lowerarm_r) | 0.0742 deg (swaps, GunIn) | 0.0009 mm / 0.0177 deg (swaps) | 0.0002 mm / 0.00003 deg |

Frame range 0..N-1 = GLB keys and 30 fps in the re-imported scene for all 28 sampled clips. The two
EarthOnline swaps are the only clips above 0.002 deg: float32 Euler curves where the whole-turn forearm
roll passes near a gimbal; 0.07 degrees.

Bodies re-imported: one armature + one mesh each (no Icosphere, no importer leftovers), bone names
and parents = GLB + 2, rest joints within 0.0013 mm / 0.003 deg, rest vertices within 0.0011 mm,
morph targets at weight 1 within 0.0004 mm of the GLB's. Skin: the body FBX posed by the animation
FBX (Unreal's rule: rotations from the animation; translations from the animation for root, pelvis,
IK and gun bones, from the body's rest for the rest), against the GLB body skinned in numpy by the GLB
clip, frames 0 / 1 of `rifle-aim-level` and 0 / 20 / 40 of `swap-rifle-shotgun`: worst vertex 0.0053 mm
(Tripo), 0.0030 mm (EarthOnline, all four bodies).

Contact sheets `review/sheet_<body>.png` (re-imported body + animation + weapon FBX, the rifle on
`Gun` and the shotgun on `GunIn` with zero offset, Workbench with textures). Top: `rifle-walk-f` at 6
frames, the A-pose retarget pose; bottom: `rifle-aim-level` front / 40 / 90 / back, a close-up of the
hands on the rifle, `swap-rifle-shotgun` mid-swap, the A-pose from the side. Looked at: textures on
every body (Tripo skin, T-shirt, hair; EarthOnline jackets, jeans, shoes, hair), the rifle in both
hands at the low ready through the walk, shouldered with the cheek on the stock when aimed, firing hand
on the pistol grip and support hand under the handguard, the shotgun slung on the back on `GunIn`, the
swap with one gun coming over the shoulder, arms 45 degrees down in the A-pose. Nothing inside out,
no scale or axis error, no gun detached from the hands.

## Check in Unreal (we could not)

1. Import a body: no "multiple roots" / "Armature bone" warning; 89 (Tripo) / 92 bones; root `root`
   with no rotation at the origin; height 175 cm; character faces +Y like `SKM_Manny`; Force Front X
   Axis off. Morph targets listed (EarthOnline, 16).
2. Import scale: the mesh is 175 cm with Import Uniform Scale 1 (not 1.75 or 17,500), and with both
   Convert Scene Unit on and off.
3. Materials: base colour and normal arrive; build the packed (ORM / RM) channels by hand; flip the
   normal maps' green channel and compare shading with the GLB in the game; EarthOnline Masked 0.5,
   two-sided (hair cards).
4. Import the 80 clips per skeleton onto the right skeleton: no missing-bone warnings, sequence
   length = frames / 30 (e.g. `rifle-walk-f` 2.067 s, 62 intervals), loops play without a hitch at the
   seam (cycles keep their closing frame).
5. Root motion: enable it on a transition (`rifle-jog-start`: 2.16 m forward over 29 frames;
   `rifle-pivot-l180`: yaw 180 degrees, 0.14 m) and check the capsule moves forward on the ground, not
   up, and turns the right way; in-place clips stay in place.
6. Translation retargeting on the EarthOnline skeleton set as above, then play a clip on f-02: jaw and
   eyes stay in her face (with "Animation" mode they move to m-01's places, up to 6.4 cm).
7. The rifle static mesh on socket `Gun` with zero offset: in the hands in `rifle-idle` / walk, on the
   shoulder in `rifle-aim-level` (compare with `review/sheet_*.png`). Not mirrored (ejection port on the
   right). The shotgun on `GunIn` slung on the back; `swap-rifle-shotgun` brings it over the shoulder.
8. Twist bones: forearm keeps its girth in the reloads and swaps; nothing else in your AnimBP drives
   the twist bones.
9. IK Rig / Retargeter: chains found by name; the retarget pose imported from `retarget/*_apose.fbx`
   frame 0 lines up with Manny's A-pose (adjust shoulders / wrists by eye; ours is described, not
   measured from Manny); a Manny clip on our body and one of ours on Manny look right (wrists, thumbs,
   feet, spine bend direction); root motion survives the retarget.
10. Twist and corrective: Manny's post-process rig is not ours; expect no corrective shapes and our
    keyed twist only.
11. Names of the twist bones and metacarpals and where they sit match Manny well enough for any
    Mannequin tooling you use (not checked against a real Manny: none here).
12. Unreal version differences: menu names above (Import from Animation Sequence, Auto Create
    Retarget Chains, Auto Align) are from UE 5.2 to 5.4 as we know them.
