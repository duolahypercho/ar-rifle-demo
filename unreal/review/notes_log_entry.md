To be merged into `ANIMATION_NOTES.md` (Log) once the game port (R3) has finished editing that file.

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
