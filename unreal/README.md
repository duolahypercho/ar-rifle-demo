# FBX for Unreal Engine 5 (pass R4, 2026-11-11; vehicles, pass U1, 2026-11-13)

The characters on the `earthonline-ue5-v1` skeleton (UE5 Mannequin bone names and hierarchy, built by
us: no Epic files) and their 80 clips per skeleton, as FBX for UE 5.x; since pass U1 also the 17 + 17
vehicle clips, the supercar and the helicopter, and the per-clip vehicle data (door, controls, events,
hand and foot contacts, vehicle fit). Nothing here was opened in Unreal (there is no Unreal on this
machine). What was proven without it is under "Verified here"; what only Unreal can show is the
checklist at the end.

**New in pass U1** (details in "Vehicles (pass U1)" below):

- `animations/tripo-vehicle/`, `animations/earthonline-vehicle/`: the vehicle clips (car-drive, car-steer-l/-r,
  car-look-back, car-enter, car-exit, heli-fly, heli-cyclic-f/-b/-l/-r, heli-collective-up/-down,
  heli-pedal-l/-r, heli-enter, heli-exit) on the two existing skeletons; the root bone carries the
  character's place in the vehicle's frame.
- `vehicles/supercar.fbx`, `vehicles/utility_helicopter.fbx`: the game's two vehicles as skeletal meshes,
  one bone per GLB node (doors, steering wheel, seats, cyclic, collective, pedals, wheels, rotors, the
  seat / entry / camera points), every part rigidly bound to its own bone, pivots kept.
- `vehicles/animations/`: the vehicle's own clips, and for every vehicle clip of each pack the vehicle
  side (door opening, the controls the clip holds, the pack's vehicle fit), to play on the vehicle at the
  same time as the character clip.
- `animations/<pack>-vehicle/data/`: CurveTable and DataTable CSV (door and controls per frame, root,
  events, contacts, fit) and one JSON with all of it.
- No FBX holds an absolute path any more (textures: `<fbx name>.fbm/<file>`), and nothing in
  `blender/export_unreal/` depends on where the project lives.

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
| `animations/tripo-vehicle/<clip>.fbx` | (U1) the 17 vehicle clips for the Tripo skeleton (`vehicle-motion-tripo-v1`), skeleton only, 30 fps |
| `animations/earthonline-vehicle/<clip>.fbx` | (U1) the 17 vehicle clips for the EarthOnline skeleton (`vehicle-motion-ue5-v1`) |
| `animations/<pack>-vehicle/notes.json` | (U1) copy of the pack's JSON (`public/characters/vehicle-motion-*-v1.json`) |
| `animations/<pack>-vehicle/data/` | (U1) `curves_<clip>.csv` (CurveTable), `events.csv`, `contacts.csv`, `fit.csv`, `clips.csv` (DataTable), `vehicle_data.json` |
| `vehicles/supercar.fbx`, `vehicles/utility_helicopter.fbx` | (U1) the vehicles (from `public/vehicles/*.glb`) as skeletal meshes, cm, base colour and normal textures embedded |
| `vehicles/textures/<vehicle>/` | (U1) the vehicles' textures as files (the GLB's bytes) and `materials.json` (every glTF material's parameters) |
| `vehicles/animations/own/<vehicle>_<clip>.fbx` | (U1) the vehicle GLB's own clips (`doors_open`, `doors_close`, `steering_demo`; `cockpit_doors_open`, `cabin_doors_open`, `main_rotor_spin`, `tail_rotor_spin`) |
| `vehicles/animations/<pack>-vehicle/<vehicle>_<clip>.fbx` | (U1) the vehicle side of each vehicle clip of that pack (door, controls, vehicle fit), same frames; `<vehicle>_fit.fbx` = the fit alone |
| `review/sheet_<body>.png` | contact sheets rendered from the re-imported FBX (body + animation + weapon FBX) |
| `review/sheet_vehicles_<pack>.png` | (U1) re-imported body + vehicle clip FBX on the re-imported vehicle + vehicle-side FBX, no offset |
| `review/proof_summary.txt` | every number below, per clip and per body |
| `review/fbx_check.json`, `review/proof/*.json`, `review/build/*.json`, `review/vehicle_data_check.json` | raw results |
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
`skeleton.py` the numpy GLB side, `report.py` the summary; pass U1: `vehicle.py` the vehicles in numpy,
`vehicle_data.py` the CSV / JSON data, rewritten on every run). Pass U1 timing (load average 3): `make.py
--force`, all 250 FBX plus checks and proof, 67 s with `R4_JOBS=6`. Since U1 a run checks every vehicle
clip (every bone, every frame), both vehicles, the 45 vehicle-side clips and the alignment of every pair,
and renders `review/sheet_vehicles_<pack>.png`.

Paths (pass U1): every path in `config.py` is taken from the script's own place (the project is two folders
up); scratch goes under the system temp folder (`R4_SCRATCH` overrides it, `R4_OUT` writes a trial build
elsewhere, `R4_BLENDER` names another Blender). Blender's FBX exporter writes each texture's `FileName`,
`Filename` and `Path` as an absolute path whatever `path_mode` is (it joins the output folder to the
relative name); `bl_common.relative_media_paths()` makes it write the relative name there too, so every
FBX names its embedded textures `<fbx name>.fbm/<image file>` (the FBX SDK's own folder for extracted
media). `check_fbx.py` counts absolute media paths and files containing this machine's home folder
(read at run time; only the counts are stored): 0 and 0 in all 250 FBX. The SceneInfo's `DocumentUrl`
stays the exporter's fixed placeholder `/foobar.fbx` (the same in every Blender FBX).

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
| `path_mode`, `embed_textures` | `COPY`, True | base colour and normal map inside the FBX (the exporter embeds only textures wired straight into a socket; the packed roughness / metal map is not); every texture is also a file in `bodies/textures/`. File names written relative (`<fbx>.fbm/<file>`, pass U1), never absolute |

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

## Vehicles (pass U1)

Sources: `public/characters/vehicle-motion-tripo-v1.glb/.json` and `vehicle-motion-ue5-v1.glb/.json` (17 clips
each), `public/vehicles/supercar.glb` and `utility_helicopter.glb` (the game's copies; their node names and
transforms equal the originals the clips were fitted on). The clip contract is in `VEHICLE_NOTES.md`
("Design decisions"): clip space = the vehicle root's glTF frame, the root bone = where the character
stands or sits in it, `door` per frame, `events`, `contacts`, `vehicleFit`.

### What the files hold

**Vehicle clips** (`animations/<tripo|earthonline>-vehicle/`) are written exactly like the rifle clips (same
settings, the same skeletons and bone set, `Gun` / `GunIn` included): import them onto the same skeleton
assets. Every GLB key is a frame; the loops (`car-drive`, `heli-fly`, 8 s) keep their closing frame (241
frames); the one-pose clips (`car-steer-l/-r`, `car-look-back`, `heli-cyclic-*`, `heli-collective-*`,
`heli-pedal-*`: one key in the GLB) are 2 identical frames, as the rifle packs' one-pose clips. `Gun` keys
the rifle's slung place (no gun in the hands; the game hides both guns in a vehicle); `GunIn` stays at rest.

**The root bone is the character's place in the vehicle**, converted like every other bone: notes `root`
`[x, z, yaw]` (metres, vehicle glTF frame) = FBX `root` translation (100 x, -100 z, 0) cm and a turn of yaw
about Z; in Unreal (the import mirrors Y) the root bone sits at **(100 x, 100 z, 0) cm with FRotator Yaw =
-yaw in degrees**, in the vehicle's component space. Seated: car (-37, -14, 0) cm, heli (42, -133.5, 0) cm,
Yaw -180 (facing the vehicle's forward). Height comes from the pelvis. `clips.csv` gives the first and last
root of every clip; `curves_<clip>.csv` gives it per frame (`root_x_cm`, `root_y_cm`, `root_yaw_deg`, the yaw
continuous, not wrapped).

**Vehicles** (`vehicles/<vehicle>.fbx`) are skeletal meshes: one bone per GLB node (supercar 65, helicopter
68: every part, pivot, seat / entry / camera / light / audio point), root bone `vehicle_root` /
`helicopter_root` at the origin with no rotation, every part a separate mesh (`<vehicle>_<node>`, 46 / 50)
bound with weight 1 to its own node's bone. Unreal merges the parts into one skeletal mesh (one section per
material); the parts move with their bones, so the doors, steering wheel, seats, cyclic, collective, pedals,
wheels and rotors keep their pivots. Every vehicle bone takes a **world-aligned frame**: a node with no
rotation in the GLB rests with identity rotation in Unreal, and one rule converts any point or direction
given in a vehicle node's glTF frame (or the vehicle root's, the clips' space) into that bone's Unreal
space: **(x, y, z) m -> (100 x, 100 z, 100 y) cm**. The vehicle faces **-Y** in Unreal (glTF -Z -> FBX +Y ->
Unreal -Y), its right is +X, the ground at Z = 0; the bodies face +Y at rest. Sockets: any bone name works
as a socket (`seat_driver_point`, `entry_driver_point`, `seat_pilot_point`, `entry_cockpit_R`,
`camera_cockpit`, `exhaust_L`, ...). The vehicle's reference pose is the game model as it is (no fit).

The rotor blur discs (`main_rotor_blur`, `tail_rotor_blur`) are hidden in the GLB (KHR_node_visibility) but
are in the skeletal mesh: hide them (`HideBoneByName`, or bone scale 0). In the GLB itself both discs sit at
the vehicle origin (their node offsets cancel the rotor pivots' places; the tail disc reaches 78 cm below the
ground), as in the game file; they are exported as they are.

**Vehicle-side clips** (`vehicles/animations/<pack>-vehicle/<vehicle>_<clip>.fbx`): for each clip of a pack,
the vehicle's skeleton over the same frames with the door opened per the notes' `door`, the controls the
clip was authored against (from the clip pass's source, `blender/vehicle_motion/clips_car.py`,
`clips_heli.py`, `vehicles.py`: car-drive's wheel moving up to 3.8 degrees, heli-fly's cyclic and pedals
moving and the collective held at 13 degrees, the one-pose clips' extremes: wheel +-90, cyclic forward 9 /
back 6 / sides 6, collective 4 / 20, pedals 4.5 cm; the entries and exits hold the wheel at 0 and the
collective down at 4) and the pack's vehicle fit on its nodes. `<vehicle>_fit.fbx` = the fit alone (door
shut, controls at rest). `vehicles/animations/own/` = the GLB's own clips (`doors_open`, `doors_close`,
`steering_demo`, `cockpit_doors_open`, `cabin_doors_open`, `main_rotor_spin`, `tail_rotor_spin`), resampled
at 30 fps. Every bone keyed every frame.

**Vehicle fit** (`vehicleFit` in each pack; the clips were authored with it applied): applied in the
vehicle-side clips, and here exactly (translation added to the bone's rest, in its parent's space = the
vehicle root's, Unreal cm; also `fit.csv`):

| Vehicle bone | Tripo pack | EarthOnline pack | What |
| --- | --- | --- | --- |
| `seat_driver`, `seat_driver_point` | (0, -20, -3) | (0, -20, -3) | seat 20 cm forward, 3 cm down |
| `steering_wheel` | (0, 5.563, 2.248) | (0, 2.782, 1.124) | wheel telescoped 6 / 3 cm along its column towards the driver |
| `pedal_L`, `pedal_R` | (0, 25, 0) | (0, 25, 0) | pedals 25 cm aft |
| `pilot_seat`, `seat_pilot_point` | (0, -14.5, 0) | (0, -14.5, -6) | seat 14.5 cm forward; EarthOnline also 6 cm down |

(glTF values, metres in the vehicle root's frame: `fit.csv` columns `Gltf*`. Forward is -Y, so "forward"
offsets are negative Y and "aft" positive.)

**The controls in Unreal terms** (bone space, added on top of the bone's rest; from the glTF definitions by
the rule above: a turn by t about a glTF local axis a becomes a turn by -t about the converted axis;
`FQuat(axis, angle)` is the usual right-hand turn in Unreal's coordinates; FRotator Roll / Pitch turn the
other way round X / Y, Yaw the same way round Z):

| Control (curve row) | Bone | glTF (the packs' `controls`) | Unreal bone space |
| --- | --- | --- | --- |
| car `door` (0..1) | `door_L` | rest * Rx(-55 deg * door) | rest * FQuat(X, +55 deg * door) (Roll -55 * door) |
| `wheel_deg` (+ = left) | `steering_wheel` | rest * Ry(wheel) | rest * FQuat(Z, -wheel) (Yaw -wheel) |
| heli `door` (0..1) | `cockpit_door_R` | rest * Ry(+68 deg * door) | rest * FQuat(Z, -68 deg * door) (Yaw -68 * door) |
| `cyclic_fwd_deg`, `cyclic_right_deg` | `cyclic` (pivot at the floor) | rest * Rx(-fwd) * Rz(-right) | rest * FQuat(X, +fwd) * FQuat(Y, +right) |
| `collective_deg` (+ raises) | `collective` | rest * Rx(+coll) | rest * FQuat(X, -coll) (Roll +coll) |
| `pedal_m` (+ = left pedal forward) | `pedal_L` / `pedal_R` | (0, 0, -push) in the root frame, push = +pedal / -pedal | (0, -100 push, 0) cm in component space |

These are what the vehicle-side clips already contain; use them only to drive the parts yourself (the
game's own control ranges, physics). The signs were checked against the clips: with them the hands stay on
the wheel rim through car-drive's wheel motion within 0.002 cm (2.2 cm with the wheel's sign flipped) and
the feet on the pedals through heli-fly within 0.001 cm (0.8 cm flipped).

### Import into UE 5.x (vehicles)

1. **Vehicle mesh.** Import `vehicles/supercar.fbx` (and `utility_helicopter.fbx`): Skeletal Mesh on,
   **Skeleton none** (creates `supercar_Skeleton`), Import Mesh on, Use T0 As Reference Pose off, Import
   Morph Targets off, Normal Import Method Import Normals, Convert Scene on, **Force Front X Axis off**,
   Convert Scene Unit off, Import Uniform Scale 1.0, Import Animations off, Create New Materials, Import
   Textures on. Expected: supercar 65 bones, root `vehicle_root` at the origin with no rotation, bounds X
   -113..113, Y -240..240, Z 0..114 cm (4.80 m long along Y, nose at -Y); helicopter 68 bones, root
   `helicopter_root`, X -550..550 (the main rotor), Y -550..751 (nose and rotor tip at -Y, the fin at
   +751), Z -78 (the tail blur disc, above)..320. (In the FBX file, before the import mirrors Y, the
   helicopter's Y runs -751..550.)
2. **Materials** by hand from `vehicles/textures/<vehicle>/materials.json` (every glTF material: factors,
   texture files, alpha mode, clearcoat, emissive strength, which parts use it). The FBX brings base colour
   textures, normal maps, diffuse colours, emissive colours and opacity; ORM maps (R occlusion, G roughness,
   B metallic), clearcoat and emissive strength are to be wired by hand. Normal maps: Flip Green Channel.
   Glass (`glass`, `glass_tinted`) translucent, `interior_stitching` masked, the rest opaque.
3. **Vehicle animations.** Import `vehicles/animations/own/<vehicle>_*.fbx` and
   `vehicles/animations/<pack>-vehicle/<vehicle>_*.fbx` with **Skeleton = `<vehicle>_Skeleton`**, Import
   Mesh off, Animation Length Exported Time, Use Default Sample Rate off (30 fps), Convert Scene on, Force
   Front X off. Name clash: the same clip exists per pack (`tripo-vehicle` and `earthonline-vehicle`):
   import each pack's folder into its own content folder.
4. **Character vehicle clips.** `animations/tripo-vehicle/*.fbx` onto `tripo-player-ue5_Skeleton`,
   `animations/earthonline-vehicle/*.fbx` onto `civilian-m-01-player-ue5_Skeleton`, the options of
   "3. Animations" above, but **Enable Root Motion off** (the root bone places the character in the vehicle;
   see below).
5. **Data.** `animations/<pack>-vehicle/data/curves_<clip>.csv`: Import as **CurveTable**, interpolation
   Linear (first row = key times in seconds, one row per curve). `events.csv`, `contacts.csv`, `fit.csv`,
   `clips.csv`: Import as **DataTable** with a row struct whose members are named as the columns after the
   first (`Name` is the row name): events `Clip` (Name), `Event` (Name), `Seconds` (float), `Frame` (int);
   contacts `Clip`, `Part`, `CharacterBone`, `VehicleBone`, `Kind`, `Point` (Name), `FromFrame`, `ToFrame`
   (int), the rest float; fit `Vehicle`, `Bone`, `ParentBone` (Name), `Why` (String), the rest float; clips
   `Vehicle`, `SeatedPose` (Name), `CharacterFbx`, `VehicleAnimFbx` (String), `Frames`, `Events`, `Contacts`
   (int), `Loop`, `OnePose` (bool), the rest float. Events become notifies by hand (FBX carries none):
   `doorOpenStart`, `doorOpenEnd`, `seated`, `doorCloseStart`, `doorCloseEnd`, `handsOn` (entries),
   `handsOff`, `unseated` (exits). `vehicle_data.json` holds all of it with the glTF values beside the
   Unreal ones.

### Placing the vehicle and the character so they line up

The rule: **the character's skeletal mesh component and the vehicle's skeletal mesh component have the same
world transform**, and the character clip and the vehicle-side clip of the same name and pack play from the
same time. The character's root bone then puts the body where the clip has it in the vehicle (checked here
with both FBX re-imported at the same place: below).

- Seated, and through an entry or an exit: attach the character's mesh component to the vehicle's mesh
  component (no socket, or socket `vehicle_root` / `helicopter_root`) with relative location 0, rotation 0,
  scale 1, Enable Root Motion off on the vehicle clips. Play `car-enter` on the character and
  `supercar_car-enter` on the vehicle together (montages started in the same frame, same play rate).
- A vehicle Pawn whose forward is +X: give the vehicle's mesh component relative Yaw **+90** (its -Y forward
  onto +X); the attached character mesh inherits it. A default Character's mesh offset (Yaw -90, Z -88) is
  for walking: while attached, the vehicle's transform is the one that counts.
- Walking up to get in: bring the character so that its mesh component stands at the vehicle mesh's
  transform times the clip's first root (`clips.csv` `RootStart*`): car-enter (-155, -25) cm, Yaw -180 (=
  `entry_driver_point`, facing the car's forward); heli-enter (180, -155) cm, Yaw +90 (= `entry_cockpit_R`,
  facing the helicopter); then attach and play. After an exit, detach and put the character where the clip's
  last root is (`RootEnd*`): car-exit (-155, -25), Yaw -180; heli-exit (178, -155), Yaw -268 (= +92).
- Root motion instead (an unattached Character, Enable Root Motion on, Root Lock Ref Pose): Unreal extracts
  the root's travel from the first frame on, so the mesh component must start exactly at vehicle x first root
  (as above) and the vehicle must not move during the clip. Not checked in Unreal.
- Hands and feet when the vehicle moves its parts differently from the clip (another wheel angle, the game's
  own collective): pin them with IK to the contacts. `contacts.csv` gives per contact span the vehicle bone,
  the character bone (`hand_l`, `hand_r`, `foot_l`, `foot_r`), the frames / seconds, the contact point (the
  palm's middle, or the ball / heel of the foot) in the vehicle bone's space, and the character bone's
  transform in the vehicle bone's space (cm and FQuat, the mean over the span): effector = vehicle bone's
  socket transform x that relative transform. `SpreadCm` / `SpreadDeg` = how far the bone moves against the
  part within the span in the clip itself: seated loops 0.003 cm, heli-fly's hands 0.5 cm / 2.8 degrees (the
  grip's life), entries and exits up to 1.5 cm / 5.3 degrees (feet rolling heel to ball).

### Retargeting the vehicle clips

As for the rifle clips (section 5): our bone axes differ from Epic's, so to play these clips on Manny or on
any other skeleton go through the **IK Retargeter**, never "compatible skeletons" or copy-pose-by-name. Keep
the `root` bone's translation unscaled (it is a place in the vehicle, not a travel to scale by height), and
expect another body's hands and feet to miss the controls: pin them with the contacts and set that body's own
seat / wheel / pedal fit. The vehicles themselves are not retargeted.

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

### Pass U1 (vehicles), verified the same way

All numbers per clip and per file are in `review/proof_summary.txt` (sections "Pass U1"); summary:

| What | Result |
| --- | --- |
| 34 vehicle clips as written | 30 fps, unit 1 (cm), Z up, one root bone `root`, bones and parents = the skeleton (89 / 92), one take named after the clip, frames = max(2, GLB keys): 241, 236, 284 / 287, 366 / 368, one-pose 2 |
| Root, from the FBX's own `root` curves, every frame | vs notes `root`: worst 0.00003 cm (both packs) |
| Every bone, every frame, forward kinematics straight from the FBX curves (`fbxread.anim_globals`, no Blender) vs the GLB pack | Tripo worst 0.011 mm / 0.0012 deg; EarthOnline seated and one-pose 0.005 mm / 0.0005 deg, entries and exits 0.99 mm (`ring_03_l`, heli-enter) / 0.089 deg (`upperarm_l`): float Euler curves where a bone's rotation passes near a gimbal, as R4's EarthOnline swaps (0.07 deg) |
| The same clips re-imported in Blender, every bone, every frame | frame range 0..N-1, 30 fps, one armature, no other object; Tripo worst 0.15 mm (`ik_hand_l`, car-enter) / 0.0067 deg; EarthOnline 0.99 mm / 0.089 deg (the curves' own). Root vs notes 0.0012 mm, except car-enter 0.139 mm / 0.0067 deg in both packs: Blender's importer takes the take's first pose as the root's rest (turned 180 degrees, a bone along -Y, where Blender's bone-roll maths is unstable); the file's curves are exact there (0.00002 cm) |
| Vehicles as written | supercar 65 bones / 46 parts, helicopter 68 / 50 = the GLB's nodes and meshes, parents = the GLB's, one root bone, unit 1, Z up; every pivot from the file's own Lcl chain vs the GLB node: 0.0003 mm / 0.0001 deg |
| Vehicles re-imported | one armature + 46 / 50 meshes, each bound only to its own bone with weight 1; rest vertices vs the GLB (numpy) 0.0014 mm (all 76,813 / 95,267); bone rests 0.0005 mm, 0.021 deg on the helicopter's cockpit-door glass / handle bones (Blender's importer; the file's own values 0.0001 deg) |
| Normals | after baking every part into the vehicle's space vs the GLB's normals turned with it: within 0.025 except 3 of 10,860 corners on `engine_cover` (0.41: degenerate faces); helicopter within 0.013 |
| 45 vehicle-side clips | frames as wanted, bones = the vehicle; FK from the curves vs the vehicle formula (door per frame, controls, fit): 0.004 mm / 0.0002 deg; re-imported 0.003 mm / 0.022 deg (the same door bones) |
| Alignment: character clip FBX and vehicle-side FBX re-imported at the same place, each contact's character bone in its vehicle bone's frame, every frame of every contact span (34 clips) | vs the GLB pack + vehicle formula: seated and one-pose 0.005 mm; entries / exits 0.39 mm / 0.021 deg (helicopter door handle: the importer's door bones above), car-enter 0.15 mm (the root import above) |
| Control conventions | contact spread with the controls as written vs flipped: wheel hands 0.002 vs 2.2 cm, pedal feet 0.0006 vs 0.80 cm, cyclic hand 0.29 vs 2.19 cm |
| Paths | 250 FBX: 0 absolute texture / video paths, 0 files with this machine's home folder |
| Old vs new (rebuild with `--force`) | the 169 earlier FBX diffed node by node (object IDs and creation time aside): 160 equivalent in every property, array and connection (kept at their committed bytes so git does not carry 130 MB of unchanged files); 7 (the 5 bodies, the 2 guns) differ only in the texture `FileName` / `Filename` / `Path` (absolute -> relative; meshes, skins, morphs, embedded images identical); 2 (Tripo `swap-rifle-shotgun`, `swap-shotgun-rifle`) were stale: built before pass A3 re-timed the swaps, up to 180 mm / 47 deg off the current pack, now 0.0055 mm |

Contact sheets `review/sheet_vehicles_<pack>.png` (body FBX posed by the vehicle clip FBX the Unreal way,
vehicle FBX posed by the vehicle-side FBX, both at the origin): looked at: car-enter with the door up and the
character at the sill, then sitting in; both hands on the rim in car-drive and at +90 with the wheel turned
in car-steer-l; car-exit rising and standing by the door; heli-enter with the cockpit door open and the
climb onto the skid; the pilot seated with the right hand on the cyclic between the knees, the left on the
collective, the feet on the pedals (heli-fly, cyclic-f, pedal-l, collective-up); the EarthOnline pilot sits
lower (his seat 6 cm down). Only the 14 frames per pack in the sheets were looked at.

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

Pass U1 (vehicles), also not checked in Unreal:

13. Vehicle import: one skeletal mesh per vehicle with every part (65 / 68 bones, no "multiple roots"
    warning, root `vehicle_root` / `helicopter_root` with no rotation), 4.80 m supercar with its nose at
    -Y, wheels on Z = 0; parts move with their bones (rotate `door_L` in the Skeleton editor: the door and
    its glass and mirror swing on the hinge). Unreal may warn about bones with no weights (the points and
    pivots): expected.
14. Materials from `materials.json`; the textures embedded in the FBX land in the right slots (base
    colour, normal); emissive lights and displays; glass translucent.
15. Vehicle clips on the character skeletons: no missing-bone warnings; car-drive 8.0 s (241 frames),
    heli-exit 12.17 s (366, Tripo) / 12.23 s (368, EarthOnline); the one-pose clips 2 frames.
16. Placement: character mesh attached to the vehicle mesh with zero offset, Enable Root Motion off,
    `car-drive` + `supercar_car-drive`: the driver sits in the left seat facing forward with the hands on the
    rim; `car-steer-l` + `supercar_car-steer-l`: wheel at +90 (turned left) with the hands on it; `heli-fly`:
    the pilot in the right front seat, right hand on the cyclic, left on the collective, feet on the pedals
    (compare with `review/sheet_vehicles_*.png`). If the body is mirrored or 180 degrees off, the Y mirror or
    the root's yaw sign was taken differently by this Unreal version: report it.
17. `car-enter` + `supercar_car-enter` from the same start time: the door opens as the hand pulls it
    (events `doorOpenStart` 1.1 s .. `doorOpenEnd` 2.2 s), he sits at 4.7 s, the door shuts by 7.35 s;
    `heli-enter`: the cockpit door opens to 68 degrees and shuts from the seat. Root motion (if used): the
    capsule ends at the seat, not beside the car.
18. The control rules (table above) by hand on the vehicle bones give the same poses as the vehicle-side
    clips (e.g. `steering_wheel` rest * FQuat(Z, -90 deg) = car-steer-l's wheel, turned 90 degrees left).
19. CurveTable / DataTable import of the CSV (the row structs as described); notifies from `events.csv`.
