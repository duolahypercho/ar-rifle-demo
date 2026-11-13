- 2026-11-13, pass U1: the vehicle clips, both vehicles and their per-clip data as FBX / CSV for Unreal, and no
  absolute path in any FBX (the user: "go ahead do it", VEHICLE_NOTES.md "The remaining open items"). Private
  headless Blender 5.1.2 only (`-b --factory-startup`, up to 6 at a time), no socket session, nothing downloaded,
  nothing sent anywhere; `src/`, `tools/`, `public/`, `blender/rifle_motion/` and the page untouched. Not committed.

  1. Read: `unreal/README.md`, `blender/export_unreal/*`, ANIMATION_NOTES.md R4, VEHICLE_NOTES.md design decisions,
     `public/characters/SOURCE.md`, the two vehicle packs' JSON, `blender/vehicle_motion/vehicles.py`, `fit.py`,
     `clips_car.py`, `clips_heli.py` (the control values per clip). The game's vehicle copies have the same node names
     and transforms as the originals the clips were fitted on (worst TRS difference 0: `supercar.glb` vs the original;
     `utility_helicopter.glb` vs the original LOD0 and the LOD1 the clip pass used). The packs' root bone equals the
     notes' `root` (float32); the one-pose clips have ONE key in these packs (the rifle packs have two).
  2. Paths. Blender's FBX exporter writes every texture's `FileName` / `Filename` / `Path` as an absolute path whatever
     `path_mode` is (`export_fbx_bin._gen_vid_path`: abspath of the output folder + the relative name). Fix:
     `bl_common.relative_media_paths()` wraps it so the relative name (`<fbx name>.fbm/<image>`) is written there too;
     called by every `export_fbx`. `config.py`: every path from the script's own place, scratch under
     `tempfile.gettempdir()` (`R4_SCRATCH`), new `R4_OUT` (trial builds elsewhere) and `R4_BLENDER`; `config.rel()` for
     logs. `check_fbx.check_paths()` counts absolute media paths and files holding the home folder (read at run time,
     only counts stored). Result: 250 FBX, 0 and 0; `grep -a -r -l "$(id -un)" unreal/` matches nothing (also nothing
     under `blender/export_unreal/` or in this note; the `__pycache__` there, git-ignored, was cleared: Python's .pyc
     files hold their source path). The SceneInfo `DocumentUrl` stays Blender's fixed `/foobar.fbx`.
  3. Built (`python3 blender/export_unreal/make.py --force`, 67 s, load average 3), all under `unreal/`:
     - `animations/tripo-vehicle/`, `animations/earthonline-vehicle/`: 17 + 17 clip FBX on the existing skeletons
       (`do_anims` with `Skeleton(key, pack=...)`: Gun / GunIn rests still from the rifle pack, so the bone set and rests
       are the bodies'), every GLB key a frame, one-pose clips 2 identical frames, loops 241 frames; the root bone =
       the place in the vehicle root's frame, converted as every bone (FBX (100 x, -100 z, 0) cm, yaw about Z; Unreal
       (100 x, 100 z, 0), Yaw -yaw). notes.json beside.
     - `vehicles/supercar.fbx` (10.6 MB), `vehicles/utility_helicopter.fbx` (16.5 MB): skeletal meshes, one bone per GLB
       node (65 / 68), world-aligned bone frames (`vehicle.py`; rule: a point in any vehicle node's glTF frame (x, y, z)
       m -> that bone's Unreal space (100 x, 100 z, 100 y) cm), every part a mesh rigidly bound to its own bone (46 /
       50), vertices baked from the GLB's rest (not the importer's objects: the glTF importer leaves them posed by the
       GLB's own clips at the scene frame, a door 2 to 3 mm open). Textures as files + `materials.json` per vehicle.
     - `vehicles/animations/own/` (7: the GLBs' own clips at 30 fps) and `vehicles/animations/<pack>-vehicle/` (19 per
       pack: the vehicle side of each clip, door per frame from the notes, the controls the clip was authored with,
       the pack's vehicleFit; `<vehicle>_fit.fbx` the fit alone).
     - `animations/<pack>-vehicle/data/`: `curves_<clip>.csv` (CurveTable: door, controls, root x / y / yaw in Unreal),
       `events.csv`, `contacts.csv` (vehicle bone, character bone, span, point in the bone's Unreal space, the character
       bone's mean transform in the vehicle bone's space, spread), `fit.csv`, `clips.csv`, `vehicle_data.json`
       (`vehicle_data.py`, plain python, every make run).
     - The controls not in the notes (car-drive's wheel, heli-fly's cyclic / pedals, the collective per clip) come from
       the clip source (config.CLIP_CONTROLS, copied from clips_car.py / clips_heli.py / vehicles.py). Checked by the
       contacts: with them the hands stay on the rim through car-drive within 0.002 cm (2.2 cm with the sign flipped,
       1.1 cm with the wheel held at 0), the feet on the pedals through heli-fly 0.0006 cm (0.80 flipped), the cyclic
       hand 0.29 cm (2.19 flipped, 1.17 held) (the rest is the hand's own life: hands on the collective 0.55 cm / 2.8
       deg in heli-fly).
  4. Check (numbers per clip / file in `unreal/review/proof_summary.txt`, sections "Pass U1"):
     - Vehicle clips as written (plain reader): 34 / 34 frames = max(2, GLB keys), 30 fps, unit 1, Z up, one root bone,
       bones and parents = skeleton; root from the FBX's own curves vs notes every frame 0.00003 cm; every bone every
       frame by FK straight from the FBX curves (new `fbxread.anim_globals`): Tripo 0.011 mm / 0.0012 deg; EarthOnline
       seated / one-pose 0.005 mm / 0.0005 deg, entries / exits 0.99 mm (ring_03_l, heli-enter) / 0.089 deg (Euler
       float curves near a gimbal, as R4's EarthOnline swaps).
     - Re-imported in Blender, every bone every frame vs the GLB (numpy FK): Tripo 0.15 mm (ik_hand_l, car-enter) /
       0.0067 deg, EarthOnline 0.99 mm / 0.089 deg; frame range 0..N-1 and 30 fps everywhere; root vs notes 0.0012 mm
       except car-enter 0.139 mm / 0.0067 deg (Blender's importer: the take's first pose becomes the root's rest, a bone
       along -Y; the file's curves are exact there).
     - Vehicles: pivots from the file 0.0003 mm / 0.0001 deg; re-imported 1 armature + 46 / 50 parts each bound to its
       own bone only (weight 1), rest vertices 0.0014 mm vs the GLB, bone rests 0.0005 mm / 0.021 deg (helicopter
       cockpit-door glass / handle bones in Blender's importer only); normals within 0.025 except 3 corners of
       engine_cover (0.41, degenerate faces).
     - Vehicle-side clips (45): from the curves 0.004 mm / 0.0002 deg vs the formula; re-imported 0.003 mm / 0.022 deg.
     - Alignment (character clip FBX + vehicle-side FBX re-imported at the same place, every frame of every contact
       span, 34 clips): seated / one-pose 0.005 mm; entries / exits 0.39 mm / 0.021 deg (the door bones above), car-enter
       0.15 mm (the root import above).
     - Sheets `unreal/review/sheet_vehicles_<pack>.png` looked at (14 frames per pack): door up and sitting in, hands on
       the rim at drive and at +90, getting out; heli door open, climb, pilot with hands on cyclic and collective and
       feet on the pedals; EarthOnline pilot lower. Two camera / display fixes were needed first (interior cameras
       outside the body; Workbench showed paint-only materials' normal maps as colour): review scene only.
     - Unreal-side rules (control table, root yaw) checked numerically against the mirror model (Y mirrored on import,
       as R4's README states): 0 error, FRotator signs included. Not checked in Unreal.
  5. Old vs new: the 169 committed FBX diffed node by node against the forced rebuild, object IDs and creation time
     aside: 160 equivalent in every property, array and connection, then put back to their committed bytes (git would
     otherwise carry about 130 MB of unchanged files; `make.py --proof` re-run on them: summary identical); 7 (5 bodies,
     2 guns) differ only in the media path strings; 2 (Tripo `swap-rifle-shotgun`, `swap-shotgun-rifle`) were stale:
     built 2026-11-11, before pass A3 re-timed the Tripo swaps (pack 2026-11-12 11:15), up to 180 mm / 47 deg off the
     current pack; rebuilt: 0.0055 mm. Also `animations/tripo|earthonline/notes.json` now copies the current packs.
  6. Sizes: `unreal/` 272.0 -> 390.8 MB (+118.8 MB; 245 -> 431 files): vehicle clips 18.7 + 19.4 MB, vehicles 75.6 MB
     (the 2 FBX 27.1, textures 18.4, 45 vehicle-side clips 30.2), sheets 4.7 MB. Largest file still
     `weapons/pump_shotgun.fbx` 18.4 MB; the largest new one `vehicles/utility_helicopter.fbx` 16.5 MB.
  7. Files changed: `blender/export_unreal/config.py`, `bl_common.py`, `build_unreal.py`, `skeleton.py`,
     `check_fbx.py`, `fbxread.py`, `make.py`, `proof_unreal.py`, `report.py`; new `vehicle.py`, `vehicle_data.py`;
     `unreal/README.md` (U1 sections: files, rebuild / paths, vehicles: frames, root, controls, fit, import steps,
     placement, retargeting, verified, checklist 13-19); `unreal/` outputs (new folders above; 9 FBX and the two
     notes.json changed; manifest and review files); this note.
  8. Not verified (no Unreal on this machine): the imports themselves, the vehicle facing (-Y) and the character
     sitting in it in Unreal, root motion for the entries / exits, materials, the CurveTable / DataTable CSV import,
     the IK Retargeter with the vehicle clips. Found and left as it is (game asset, `public/` not mine): both rotor blur
     discs in `utility_helicopter.glb` sit at the vehicle origin (their node offsets cancel the rotor pivots), the tail
     disc 78 cm below the ground; hidden in the GLB, exported as they are, README says to hide them.
