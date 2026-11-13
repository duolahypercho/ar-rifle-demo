# Tripo main character as the player body (pass T1a, 2026-11-11)

The user: "put this into the main character". Source: `source/tripo_main_character.glb` (Tripo, unchanged).
A young man in a white T-shirt and shorts, barefoot. One skinned mesh: 11,990 vertices, 19,670
triangles, one material (base colour JPEG, normal PNG, roughness/metal JPEG). 80 UE5-named bones. T-pose bind.

## Files

| File | What |
| --- | --- |
| `tripo-player-ue5.glb` (12.7 MB) | the MASTER body: 1.75 m, soles on y = 0, pelvis on x = z = 0, faces +Z, left +X; 80 bones in Tripo's bind pose and bone axes + 7 IK bones (87); weights fixed (below, incl. the F1 elbow repair); no animations; textures byte-identical, full resolution (base colour 8192 JPEG, normal 4096 PNG, roughness/metal 4096 JPEG). The Unreal export reads this file. The game's copy (`public/characters/tripo-player-ue5.glb`, 4.3 MB) is made from it by `../game_copy.py` (base colour 4096, normal and roughness/metal 2048; everything else byte for byte) |
| `alt/tripo-player-ue5-v2-pre-F1.glb` | the body before pass F1 (T1a's weights; same bones, bind, mesh) |
| `review/elbow/` | pass F1: `sheet_elbow_l/r.png`, `sheet_knee_l/r.png`, `sheet_wrist_l/r.png` (before / after side by side, two views each), `crease_numbers.txt`, `joint_report.json` (`../joint_review.py`) |
| `review/textures/face_compare_8192_4096_2048.png` | pass F1: the face at 60 cm with the base colour at 8192 / 4096 / 2048 (front and three-quarter) |
| `review/blink/` | pass F1: the blink morph trial (rejected, not shipped): `blink_rejected_sheet.png`, `blink_rejected_sheet_r34.png`, `blink_trial.py` |
| `tripo_frames.json` | per bone: parent, rest local rotation / translation, bind world rotation, `A`, `R`, `O_fromR1`, canonical head, canonical local rotation, rule (copy / follow / twist / ik), old joint; twist shares; `referencePoses.bind_tpose` and `.canonical`; `canonicalAnatomy` (the target frames) |
| `tripo_metrics.json` | measurements (below) |
| `tripo_weights_audit.json` | per bone vertex count / total weight before and after, limb weight centroids, strays, fixes, shares |
| `tripo_source_clips.glb` (2.3 MB) | Tripo's skeleton (as delivered, source units) + its 15 clips (shoot, walk, fall, sit, swim, press-up, box_01, look_around, jump_down, jump, idle, wait, run, volleyball, basketball_shot), no mesh |
| `review/` | contact sheets `fixed_*.png` (below), `deform_report_fixed.json` (every number per pose, variants `fixed` / `norepair` / `raw`), `panels/`; `review/v1/` = the first version's sheets (torn back crease); `review/candidates/` = the crease candidates' sheets and reports |
| `alt/tripo-player-ue5-v1.glb` + `alt/tripo_frames-v1.json` | the first version (clavicle A 12 deg, no shoulder repair) |
| `alt/tripo-player-ue5-aposebind.glb` + `alt/tripo_frames-aposebind.json` | candidate (b): A-pose re-bind, kept for Unreal / comparison, not used |
| `../ue5body.py` | library: read any UE5-named body, derive A / R, map old poses, skin |
| `../prepare_body.py` | builds everything above |
| `../deform_proof.py` | poses, measures (incl. the crease), renders |
| `../crease.py` | crease measure: dihedral angles of the upper back / front against the modelled mesh |
| `../joint_review.py` | pass F1: elbow / knee / wrist review under linear blend skinning (ROM flexions and the worst frames of the reloads and swaps from `rifle-motion-tripo-v1`): crease, flipped, collapsed and spike triangles; textured renders with the GLB's normals skinned as three.js does |
| `../game_copy.py` | pass F1: the game's copy of a body with lighter textures (Blender's own image scaling) |
| `../rebind.py` | re-binds a body in the A-pose or the canonical pose (Armature modifier with Preserve Volume + Corrective Smooth, offline) |

## Re-run (any future UE5-named GLB)

```
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup --python-exit-code 1 --python blender/bodies/prepare_body.py -- \
   --src blender/bodies/tripo/source/tripo_main_character.glb --out blender/bodies/tripo --name tripo-player-ue5 --clips
$B -b --factory-startup --python-exit-code 1 --python blender/bodies/deform_proof.py -- \
   --src blender/bodies/tripo/source/tripo_main_character.glb --out blender/bodies/tripo/review
```
`prepare_body.py` arguments: `--src` delivered GLB (one skinned mesh, one primitive, UE5 names, any bind
pose / bone axes); `--out` folder; `--name` body name; `--prefix` JSON prefix (default first word of the
name); `--height` (1.75); `--reference` canonical reference body (default `public/characters/civilian-m-01-player-ue5.glb`);
`--no-fix` (weights as delivered); `--clips` (write the source clips); `--tmp` scratch folder for the
texture decode. Under plain `python3` it works too but skips the eye search (needs bpy to decode the JPEG).
Each run takes about 15 s. `deform_proof.py`: `--variants fixed,raw,smooth`, `--render fixed`, `--no-render`, `--size`.
Build checks printed on every run: node chain = bind 6e-8, rest skinning 0.0002 mm, weights sum 1.

## What was changed and why

- **Scale** 1.852556 (source 0.94464 tall), baked into vertices, joint translations and inverse bind
  matrices; every node scale is 1 (Tripo's were 0.99999994). Recentred by (-3.6 mm, 0, -17.8 mm) so the
  pelvis is at x = z = 0 (the R1 convention: root is the ground under the pelvis).
- **root**: rest set to identity at the origin (Tripo's had a quarter-turn and an offset; it carries no weight).
- **IK bones** as R1: `ik_foot_root` > `ik_foot_l/r`; `ik_hand_root` > `ik_hand_gun` > `ik_hand_l/r`, at
  their targets' bind places with their bind frames; roots identity at the origin.
- **Facing**: checked from the hips and the toes: faces +Z, left at +X. No change needed.
- Mesh node is `body`; the `Armature` wrapper node (identity) is dropped. `asset.extras`: Tripo's AIGC
  label kept, plus `contract`, `bindPose`, `eyes`.
- No animations inside. Textures, UVs, normals unchanged (normals need no change under uniform scale).

## Canonical frames: R[b] = A[b] * Wbind[b]

`A[b] = C[b] * G[b]^T`. `G[b]` is an anatomical frame measured on the bind from the joints, never from the
bone's own axes: Y = bone head to its child joint; Z = the side the child swings into on flexion. Elbow /
knee: from the limb's plane when bent more than 5 degrees, else body forward / backward (Tripo's elbows are
bent 1.3, knees 2.1, so the body axis was used). Hand: Z = palm normal from the knuckle row (index_01 -
pinky_01) crossed with the wrist-to-middle-knuckle line. Fingers: curl side from the finger's own joints
if bent, else the palm normal. Thumb: R1's hint carried into the bind by the hand's turn. Body axes:
left = thigh_l - thigh_r, up = +Y, forward = left x up, checked against the toes.

`C[b]` = the same construction measured on R1's player (`canonicalAnatomy` in the frames file).
Deliberate exceptions:
- trunk (pelvis to head) and **clavicles**: A = the facing correction only (identity here). Tripo's
  spine curve and head carriage are kept, not straightened onto R1's vertical column. The clavicle
  points 12 degrees backwards in Tripo; turning it onto R1's sideways clavicle pushed the shoulder joint
  2.86 cm forward in v1. Fixed in the follow-up: clavicle A = 0.0, the shoulder joint stays at its bind
  place in the canonical pose (upperarm_l (0.1856, 1.3855, -0.0571) in both).
- feet and balls: a sole frame (ankle-to-ball heading on the ground, up). The foot keeps its own
  pitch, so the sole stays flat (A = 0.0 deg here).
- metacarpals: A = A[hand] (the palm stays rigid).
- twist bones: A = A[parent], and the forearm / shin twist bones also take their share of the hand's /
  foot's twist. Tripo's T-pose forearm is pronated: the canonical pose supinates the hand by -76.8 (left)
  and +76.0 (right) degrees, spread along the forearm. Shin: 0.1 degrees.

Results on Tripo: upper arm 90.0 deg (the arm comes down), forearm 88.7, hand 116 (down plus palm
forward), fingers 109 to 113, thigh 3.6 / calf 5.5 (legs brought straight and together), feet 0.

**Validation on R1's player** (`public/characters/civilian-m-01-player-ue5.glb`, read only):
- With R1's published frames as the targets: arms, legs, clavicles, spine and feet come out at about
  0.0 degrees. Hand 3.99, metacarpals 3.99, thumb 3.86 to 3.91, fingers 4.50 to **4.77 (worst: ring and
  pinky 02/03)**, median 3.45 over all mapped bones. The cause: R1 took its hand and finger Z from world
  +Z, while R1's real palm (the knuckle row) is 4 degrees off that.
- Hence the choice: the targets are R1's palm as measured, not R1's bone Z. Then A = identity to 0.00
  degrees on R1 for every bone, but only because the targets were measured on R1. The real check is the
  first bullet: the method reproduces R1's frames within 4.8 degrees at the hands and 0 elsewhere.

How the pipeline uses it: boneWorld = canonicalWorld[old joint] * R[b]. Old joints map as in R1: Spine /
Spine1 / Spine2 onto spine_01 / 03 / 05; spine_02 / 04, neck_02 and the metacarpals follow their parent at
their canonical local; twist bones: local = canonicalLocal * twistY(share * a). Tripo bones run along +Y
too. Equivalent: `O_fromR1[b]` = R1rest[b]^-1 * R[b], so a pose made for R1's skeleton converts as
local[b] = O[parent]^-1 * R1local[b] * O[b] (O includes the forearm pre-turn).

## Weights audit (`tripo_weights_audit.json`)

As delivered: max 4 influences (634 / 3183 / 3095 / 5078 vertices with 1 / 2 / 3 / 4), sums 1, **root 0**.
Every bone carries weight. Hands: hand_l 44 vertices (7.3 total weight); the palm sits on the
metacarpals (67 vertices > 0.5). Fingers each have their own weights; webbing vertices are shared
(index 54 of 87 vertices share with another finger, middle 84 of 95). Balls: toe skin 0.67 / 0.71 mean on
ball_l / ball_r (min 0.39 / 0.34; the rest on the foot). Twist bones carry weight: upper arm 106 to 180,
forearm 20 to 53, thigh 260 to 315, calf 50 to 188 total weight each.

Fixes (only what was clearly wrong):
1. **Upper-arm and thigh twist weights relabelled.** As delivered they run bone (shoulder / hip end,
   t-centroid 0.20 / 0.14) -> twist_01 (middle, 0.43 / 0.46) -> twist_02 (elbow / knee end, 0.90 / 0.93).
   That is the reverse of UE5 / R1, where twist_01 at the shoulder counter-turns. As delivered, the shoulder
   end takes the full upper-arm twist. Relabelled upperarm -> twist_01, twist_01 -> twist_02, twist_02 ->
   upperarm (the weight shapes are unchanged); same for the thigh. Effect, right shoulder radius kept (min):
   swap 0.14 -> 0.47, upper arm twist +-70 0.55 -> 0.64; shoulder strain p99 in the swap 1.02 -> 0.93.
2. **Strays removed** (limb-chain weights on skin past the far joint, t > 1.3) and renormalised. The upper
   arm's elbow end on mid-forearm skin (13 + 21 influences, up to 0.49 / 0.69). Forearm on the palm (5 + 5,
   up to 0.08 / 0.53). The thigh on the shin (92 + 117, mostly 0.02, up to 0.89 / 0.71). Hip strain mean
   in clip poses 0.13 -> 0.11.
3. **Twist shares refit** to this body's weights: least squares so the effective twist along each limb
   follows R1's ramp. upperarm_twist_01 -0.501 (R1 -0.50), upperarm_twist_02 -0.100 (-0.25),
   lowerarm_twist_02 0.834 (0.47), lowerarm_twist_01 0.879 (0.88), thigh_twist_01 -0.304 (-0.30),
   thigh_twist_02 -0.026 (-0.15), calf_twist_02 0.411 (0.24), calf_twist_01 0.393 (0.44). They are in
   `tripo_frames.json` `twistBones`. Tripo's twist bone heads sit at 33 % / 67 % (R1: 10/50, 55/90). Pure
   twist about the limb does not care.
4. **Shoulder repair** (follow-up; the back crease, see below). Upper-arm-chain weight on torso skin
   inboard of the shoulder joint is capped by a smoothstep on the outward distance from the joint
   (none kept 10 cm inboard, all kept from 1 cm inboard outwards), and the remainder goes to the clavicle
   of that side: 353 / 375 vertices, 12.2 / 13.1 total weight moved, at most 0.11 per vertex.
   `prepare_body.py` does this by default (`--no-shoulder-repair` to skip).
5. **Elbow repair** (pass F1, `joint_repair`; `--no-joint-repair` to skip). The inner-elbow 'flat, bright,
   sharp-edged triangle' seen in the game past about 60 to 90 degrees of flexion. Cause: Tripo's split
   between the upper-arm chain and the forearm chain round the elbow is ragged: on the inner forearm,
   3 to 7 cm past the joint, vertices with 0.9 upper-arm weight sit next to vertices with 0.1. Bent, the
   first stay with the upper arm and the second go with the forearm, so single long triangles stand
   out of the skin (edges stretched 2.3 to 3.1 x, flipped against the skinned normals). Fix: within 8 cm
   above to 11 cm below the elbow (8 cm off the axis, where the two chains carry over half the weight)
   the upper share of the two chains is set by the position along the limb only, 1 - smoothstep over
   +-5 cm round the joint (bind pose), faded in over 2.5 cm at the zone's ends; each chain keeps its own
   split between the bone and its twist bones; other bones' weights untouched. 348 vertices change.
   The twist shares are fitted BEFORE it (unchanged: frames, metrics and clips stay valid). Rest (bind)
   displacement 0.00008 mm; in the canonical arms-down pose up to 14.5 mm (one of the ragged inner
   forearm vertices, 7 cm past the elbow, that the old weights left behind; mean 0.9 mm over 316 moved).
   The knee was checked the same way (90 / 115 degrees): it has no such ragged split; the same ramp
   pushed a blade of skin out of the front of the knee, and at the back only it added spikes at the
   zone's edge, so the knee is NOT changed (the code is there, `JOINTS['knee']`, off by default).
   The wrist at +-42 degrees flexion shows no fold or spike: not changed.
6. Tried and NOT kept: Laplacian smoothing of clavicle / upperarm / spine_04/05 weights over the shoulder
   (variant `smooth`). It was worse everywhere: right shoulder p99 0.67 -> 0.88 at canonical, 0.79 -> 0.98
   aiming.

## Deformation verdict (`review/`; numbers from `deform_report.json`, variant `fixed`)

Strain = |edge length / bind length - 1| over the region's edges. The bind here is the T-pose, so
arms-down poses are already strained at rest. Radius kept = posed / bind distance from the axis or
joint (1 = kept). Clip poses come from `rifle-motion-v1.glb`; the hands are not on a gun (proportions
differ).

| Area | Verdict | Numbers and what I saw | Sheets |
| --- | --- | --- | --- |
| Whole body in clip poses | good | poses read correctly (carry, aim, crouch, sprint, walk, reload, swap); canonical = arms down, palms forward | `fixed_full_1.png`, `fixed_full_2.png` |
| Shoulders, front | acceptable | right shoulder strain mean / p99 (now): canonical 0.10 / 0.64, carry 0.12 / 0.64, aim 0.16 / 0.73, swap 0.19 / 0.88 (v1: 0.12/0.67, 0.14/0.68, 0.17/0.79, 0.21/0.93). Front-armpit fold like R1's; T-shirt sleeve holds its shape | `fixed_shoulders_front.png` |
| Shoulders, back | acceptable (was bad) | v1 had a torn-looking horizontal fold under each shoulder blade in every arms-down pose (`v1/fixed_shoulders_back.png`). Now a soft fold remains at the lower shoulder blade in canonical / sprint / crouch, and small soft wrinkles at the back of the armpit (lat). No dark gaps. Folded edges (> 45 deg vs the modelled mesh) back l / r: canonical 26/52 -> 14/28, carry 21/36 -> 12/24, walk 19/38 -> 10/26, aim level 12/40 -> 11/30, swap 6/52 -> 0/29 | `fixed_shoulders_back.png`, `fixed_shoulders_back_close_r.png` |
| Armpits | acceptable | aim up slices the sleeve hem at the armpit (long slit); others fold but hold | `fixed_armpits.png` |
| Elbows | good (pass F1) | before F1: 1 to 4 spike triangles per elbow from 90 degrees of flexion, edges stretched up to 3.1 x (the inner-elbow triangle). After: 0 spikes at 60 / 90 / 120 / 140 degrees and in the worst frames of the reloads and swaps, max edge stretch 1.5 to 1.8 x. LBS still folds the inside of the bend (flipped triangles inside the fold: 5 to 27, hidden in it) | `review/elbow/sheet_elbow_l.png`, `sheet_elbow_r.png`, `crease_numbers.txt` |
| Wrists | good | wrist radius min / mean: carry 0.96 / 1.00, aim 0.99 / 1.01, swap 0.63 / 0.92, twist +90 1.00 / 1.00, twist -90 0.66 / 0.92 (R1 swap 0.70 / 0.95) | `fixed_wrists.png` |
| Hands, fingers | acceptable | grip shapes read well. Trigger finger curled alone: middle finger skin moves up to 30 mm (mean 4.9; the webbing), ring / pinky / thumb 0. Hand strain p99 1.7, max 8.4 at a few webbing edges in the grip | `fixed_hands_right.png`, `fixed_hands_left.png` (fist) |
| Hips | good | mean 0.10 to 0.11 standing clips, 0.22 crouch, 0.25 knee deep | `fixed_hips.png` |
| Knees | acceptable | knee deep mean 0.25, p99 0.94, max 2.4 (the back-of-knee pinch, as usual for linear blend skinning). F1: at 90 / 115 a soft stepped seam at the back of the knee, 1 to 2 spike triangles (max stretch 2.5 to 3.3); not the elbow's fault, not changed | `fixed_knees.png`, `review/elbow/sheet_knee_l.png` |
| Feet | good | strain p99 under 0.06 except crouch 0.53 | `fixed_feet.png` |
| Range of motion | see sheet | arms forward / side, elbow, twists, knee, spine bend+twist, fist, trigger | `fixed_rom.png` |

### The back crease (follow-up, 2026-11-11)

Cause, measured on the worst-folding edges (`crease.py`, canonical pose). Upper-back skin near the spine
and over the shoulder blade carries a few percent of upper-arm weight: for example `upperarm_twist_01_r`
0.07 to 0.09 on vertices weighted clavicle 0.3 to 0.5, spine_05 0.3 to 0.5 and spine_04 0.15. Their
neighbours across the fold have none. Skin inboard of the shoulder joint swings UP when the arm comes
down from the T-pose bind (the lever on the far side of the pivot), 1 to 2 cm here. That shoves those
vertices up over their unweighted neighbours, and the triangles flip (dihedral change up to 175 deg).
A second, softer source: the back of the shoulder joint itself (about 0.5 arm / 0.5 clavicle, 90 deg
apart) folds as any linear blend does.

Candidates (all with the clavicle fix; numbers = folded edges > 45 deg back-l / back-r / front, in
`review/candidates/deform_report_*.json`; sheets `review/candidates/<name>_shoulders_back*.png`,
`_shoulders_front.png`, `_armpits.png`):

| Candidate | canonical | carry | walk | aim level | aim up | swap | own bind | what I saw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-bind, clavicle fix only (`tbind`) | 26/52/59 | 21/36/70 | 19/38/72 | 12/40/81 | 32/43/97 | 6/52/59 | 0/0/0 | the torn fold is still there: the clavicle fix alone does not change it |
| (a) T-bind + shoulder repair (`repair`) **chosen** | 14/28/57 | 12/24/66 | 10/26/70 | 11/30/79 | 17/34/94 | 0/29/56 | 0/0/0 | the torn fold is gone in every pose; a soft fold under the shoulder blade and small lat wrinkles remain; sleeve and armpit unchanged |
| (b) A-pose re-bind, Preserve Volume, no smoothing (`apose_nocs`) | 32/46/70 | 21/37/81 | 21/42/87 | 27/41/86 | 36/44/85 | 1/49/64 | 4/15/42 | baked from repaired weights; looks like (a) in the sheets, a little softer at the back of the armpit, but more folded edges, and folds already baked into the bind |
| (b) A-pose re-bind + Corrective Smooth (`apose_cs`) | 26/34/69 | 19/34/101 | 19/35/104 | 24/39/108 | 35/41/102 | 8/50/80 | 4/10/57 | as (a) to the eye; shoulder radius kept better (carry min 0.94 vs 0.80, aim 0.85 vs 0.70) but more folded edges at the back and front |
| (c) canonical re-bind + Corrective Smooth (`canon_cs`) | 45/50/97 | 41/43/124 | 40/44/171 | 43/50/150 | 42/53/140 | 22/46/122 | 45/50/97 | worst: the 90 deg bake itself folds; not needed (a and b left no hard fold) |

Choice: (a). In carry / walk / aim level it has the fewest folded edges, both sides, back and front. It
looks as good as the A-pose re-bind in the sheets. It keeps the delivered T-pose bind, so Tripo's own
clips, the bind mesh and the frames stay simple. The sleeve and the armpit are unchanged against v1.
The A-pose re-bind's only win is shoulder volume (radius kept); it stays in `alt/` for Unreal, whose
Mannequin binds in an A-pose.

Still visible: a soft horizontal fold under the shoulder blades with the arms down, and soft lat wrinkles
behind the armpit (carry, reload, swap). Softer still would need a corrective (shape key / pose-space
fix), which this pass did not do.

In the canonical pose the soles go 4.5 mm below y = 0 (the legs are straightened by 2 to 5 degrees).

## Metrics (`tripo_metrics.json`, canonical pose, metres)

- `scale`: source height, factor, recentring, canonical sole y.
- `segments`: clavicle 0.139, upper arm 0.279, forearm 0.239 / 0.243 (l / r), thigh 0.415, calf 0.402,
  ankle to ball 0.135. Spine pieces pelvis -> spine_01 ... -> head, spine_01 -> neck_01 0.436, neck_01 ->
  head 0.100.
- `widths`: shoulder joints 0.371 (v1: 0.378, clavicle turned), hip joints 0.186, clavicle roots 0.100. `heights`: pelvis 0.936,
  spine_05 1.243, neck_01 1.443, head joint 1.543, shoulder 1.393, top of head 1.750. `joints`: every
  canonical joint.
- `head`: mesh skinned > 0.9 to head (hair included): 0.183 high, 0.213 wide, 0.269 deep.
- `eyes`: the painted eyes are found in the base-colour texture, sampled through the UVs onto the skin
  (eye whites = bright unsaturated texels; iris = dark texels within 1.8 cm). Centre (-0.001, 1.617,
  0.066), left (0.034, 1.617, 0.066), right (-0.036, 1.616, 0.065), 7.0 cm apart. That is 7.4 cm above and
  8.7 cm in front of the head joint. These points are ON the skin, not ball centres: there are no eyeballs.
- `hands.l/r`: palm normal (the canonical target, ~+Z); the wrist to middle knuckle axis (-0.07, -0.98,
  0.17 on the right) and its length 0.105. `palmCentre_inHand_oldStyle` is comparable with the old
  `PALM_LOCAL (0, -0.075, 0.028)`: 80 % of the way to the knuckle on the palm surface, = (+-0.004, -0.079,
  0.036). `palmCentre_inHand_surfaceCentroid` is the centroid of the palm-side skin. Length (wrist to
  middle tip) 0.209, width across the knuckles 0.087 to 0.095, grip span thumb tip to index tip 0.083 to
  0.091, palm centre to middle tip 0.133. Per finger: segment lengths (knuckle -> 02 -> 03 -> tip) and
  the knuckle / tip in the hand frame. "In the hand frame" = world axes at the wrist in the canonical
  pose, i.e. the old Hand joint frame (fingers -Y, palm +Z).
- `feet.l/r` in the foot frame (world axes at the ankle): ankle 0.088 above the sole; heel (0.00, -0.05,
  -0.069); ball joint (0, -0.071, 0.114) and its sole point; toe tip (-0.008, -0.066, 0.195); heel to toe
  0.263; width 0.11. Barefoot.
- `frontSurface`: a 2 cm grid (x -0.22..0.22, y 0.60..1.52) with the max z of the body skin (arms
  excluded) for the gun's clothes check. `torsoProfile`: slices every 2 cm with front / back / depth /
  width / convex-hull girth (below the crotch the hull wraps both legs). Chest depth at spine_05 0.247.

## What this body cannot do / differs from the old player

- No face rig: no morph targets (no blinks, visemes, brows), no `jaw`, `eye_l`, `eye_r`. The eyes are
  painted on. The game's eye saccades / blinks / mouth must be off for this body.
- Pass F1 tried a blink morph (upper-lid vertices down to the lower lid line, the lower a little up) and
  did NOT ship it: the face has 5 to 9 vertices within 1.5 cm of each eye and none between the eye and
  the brow, so the nearest vertices above the eye ARE the brow: closing the eye pulls the brow (and the
  fringe's strands in front of the right eye) down about 1.5 cm, and at 0.5 the painted iris is
  squashed into an oval. A blink needs eyelid geometry (re-modelled lids, or a separate eye-lid mesh).
  Pictures: `review/blink/`.
- Barefoot: no shoes. The sole is skin and the toes are visible; foot plant heights differ (ankle 8.8 cm).
- T-shirt and shorts: no belt for the magazine pouch, no jacket. The surface height field is the shirt.
- T-pose bind: arms-down poses are a big linear-blend move from the bind. Hence the back crease.

## Traps for the next passes

1. Bone axes are Tripo's, not R1's (e.g. upperarm_l's Z is world up, hand_r and hand_l rolls differ).
   Never assume R1's local axes; go through R / O.
2. The canonical pose is NOT the bind. Canonical locals are in `referencePoses.canonical`. "Straight" for
   a bone is its canonical local, not its rest and not identity.
3. Twist bones: Tripo's twist_01 / twist_02 were relabelled in the weights. In the GLB the twist bone
   NODES still sit where Tripo put them (33 % / 67 %), so upperarm_twist_01 sits mid-arm but now carries
   the shoulder-end skin. Harmless for twist; do not use their heads as anatomical landmarks. Use the
   refit shares, not R1's.
4. The forearm twist bones are pre-turned in the canonical pose (about 0.83 to 0.88 of 77 degrees).
   Measure twist from the canonical local, as the frames file says.
5. Pelvis translation: the clip's Hips values were authored for a 0.92 m pelvis; this one is 0.936.
6. The eyes metric is a surface point, not a ball centre. The sights / cheek weld must use it as a
   surface point.
8. Shoulder repair: torso skin inboard of the shoulder joints no longer carries upper-arm weight; it
   follows the clavicle. So the clip's shoulder (clavicle) rotation now moves more of the upper back than
   it did on the delivered weights. Keep clavicle turns modest in new clips, and look at the back after any
   big shrug.
9. If the A-pose body in `alt/` is ever used (Unreal), its frames file is its own (re-derived from the
   A-pose bind). Tripo's 15 clips are authored against the T-pose bind and would need converting through
   the frames.
7. The hands' metacarpals carry the palm (the hand bone has almost no weight). Anything that reads
   "skin on hand_x" must include the metacarpals.

## Open decisions

1. Clavicle: done (posture kept, A = 0).
2. Back shoulders: the soft fold that remains could go with a corrective shape (pose-driven) or a small
   clavicle share in the mapping (drop the clavicle a few degrees with the arm down). Neither was tried.
3. The face: the game expects morphs and eye bones. Disable eye / blink / mouth layers for this body. (F1:
   a blink morph on this mesh was tried and rejected, see above.)
4. Whether the game wants Tripo's 15 clips at all (kept in `tripo_source_clips.glb`).

## Log entry for ANIMATION_NOTES.md

```
2026-11-11, pass T1a: Tripo main character prepared as the player body. blender/bodies/tripo/
tripo-player-ue5.glb: 1.75 m, Tripo's T-pose bind and bone axes kept, + 7 IK bones (87 bones), no morphs /
eye / jaw bones. A per-body frame file (tripo_frames.json) gives R[b] = A[b] * bindWorld[b] so
boneWorld = canonicalWorld * R[b]. A[b] comes from geometry against R1's measured anatomy; the method
reproduces R1's own frames within 0.0 degrees (limbs, trunk, feet) and 4.8 degrees (fingers; R1's palm Z
came from world +Z). Weights: upper-arm and thigh twist groups relabelled (Tripo has them reversed);
strays past the elbow / knee removed; twist shares refit. Deformation in the clip poses: good to
acceptable everywhere. Follow-up the same day: the clavicles keep their modelled posture (the shoulder
joint no longer moves 2.9 cm forward in the canonical pose). The torn-looking fold under the shoulder
blades in arms-down poses is gone. Its cause was a few percent of upper-arm weight on upper-back skin
inboard of the shoulder joint, which the lever swings up over its neighbours when the arm comes down.
That weight now goes to the clavicle; folded upper-back edges are about halved. An A-pose re-bind (Blender
Preserve Volume + Corrective Smooth) and a canonical re-bind were tried and measured worse; the A-pose
body is kept in alt/. A soft fold under the shoulder blades remains. Metrics (eyes from the texture, palm, fingers, feet, front surface) are in tripo_metrics.json.
Re-run: blender/bodies/prepare_body.py (any UE5-named GLB), deform_proof.py.
```
