# `earthonline-ue5-v1`: the UE5 Mannequin-style skeleton (pass R1, 2026-11-11)

The user: "let's re rig the whole thing into UE5 we will use mannequin for future purpose".

This skeleton follows the UE5 Mannequin's (Manny / Quinn) naming, hierarchy, chains, twist and IK
bones. It is built by us. Epic's files are not used and nothing was downloaded. Joint POSITIONS come
from our bodies (MakeHuman/MPFB CC0, canonical-conformed), not from Manny. Unreal's IK Retargeter
handles the difference in proportions.

| What | Where |
| --- | --- |
| Module (numpy on the glTF data, runs in Blender or plain Python) | `blender/ue5_rig/ue5.py` |
| Proof helpers (equivalence, ROM, eyes, A-pose, renders) | `blender/ue5_rig/proof.py` |
| Build script | `python3 blender/tools/bl.py run blender/ue5_rig/build_ue5_rig.py` (about 7 s, all four bodies) |
| Re-rigged bodies (old ones untouched) | `public/characters/<body>-ue5.glb` for `civilian-m-01-player`, `civilian-police-m-hero`, `civilian-f-02-hero`, `civilian-m-03-hero` |
| Mapping for R2 / R3 (JSON) | `blender/ue5_rig/ue5_mapping.json` |
| Blender rig (armature built from this spec + the player skinned to it, shape keys and material) | `blender/ue5_rig/ue5_rig.blend`, scene `ue5_rig` |
| Numbers and contact sheets | `blender/review/rig/report.txt`, `blender/review/rig/*.png` (panels in `panels/`) |

## Bones (90) and hierarchy

```
root                                        (rest: origin, identity)
  pelvis                                    (old Hips)
    spine_01 > spine_02 > spine_03 > spine_04 > spine_05
      spine_05 > neck_01 > neck_02 > head
        head > jaw, eye_l, eye_r            (extras: not on Manny)
      spine_05 > clavicle_l > upperarm_l > lowerarm_l > hand_l
        upperarm_l > upperarm_twist_01_l, upperarm_twist_02_l
        lowerarm_l > lowerarm_twist_01_l, lowerarm_twist_02_l
        hand_l > thumb_01_l > thumb_02_l > thumb_03_l
        hand_l > index_metacarpal_l > index_01_l > index_02_l > index_03_l
        hand_l > middle_metacarpal_l > middle_01_l > ... ; ring_... ; pinky_...
      spine_05 > clavicle_r > ...           (mirror, _r)
    thigh_l > calf_l > foot_l > ball_l
      thigh_l > thigh_twist_01_l, thigh_twist_02_l
      calf_l > calf_twist_01_l, calf_twist_02_l
    thigh_r > ...                           (mirror)
  ik_foot_root > ik_foot_l, ik_foot_r
  ik_hand_root > ik_hand_gun > ik_hand_l, ik_hand_r
```

Counts: root 1, trunk and head 12 (pelvis, 5 spine, 2 neck, head, jaw, 2 eyes), 23 per arm (clavicle,
upper arm, lower arm, hand, 3 thumb, 4 metacarpals, 12 finger bones), 4 per leg, 16 twist bones, 7 IK.
That is 90. The skin's joint list is in this hierarchy order (parents first; see the JSON's `bones`).
The 82 bones other than `root` and the IK bones deform. In the GLB every bone is a skin joint, and
`root` and the IK bones carry no weight.

Left out on purpose: the Mannequin's corrective / helper bones (the ones Unreal's post-process rig
drives) and anything facial beyond the jaw and eyes.

## Where the joints are (glTF metres; the four bodies share these joint positions)

| Bone | Head | Rule |
| --- | --- | --- |
| root | (0, 0, 0) | the ground under the pelvis (the pelvis is at x = z = 0) |
| pelvis | (0, 0.92, 0) | old Hips |
| spine_01 / 03 / 05 | y 1.06 / 1.14 / 1.22 | old Spine / Spine1 / Spine2 (clavicles attach to spine_05) |
| spine_02 / 04 | y 1.10 / 1.18 | half way between |
| neck_01, neck_02, head | y 1.42, 1.465, 1.51 | old Neck, half way, old Head (head bone 0.2 m up) |
| jaw | (0, 1.605, 0.005) | old Jaw; tail towards the middle of what it carries (the chin) |
| eye_l / eye_r | player (±0.027 / -0.032, 1.6147, 0.1089) | centre of a sphere fitted to the 256 / 257 vertices skinned wholly to the old eye joint (r 1.60 cm, the back half alone agrees within 0.2 mm). The old joints sat 2.0 cm above, 2.7 cm behind and 0.5 cm outside it (pass 8's 3.3 cm was to the vertex centroid, which the cornea pulls 0.6 cm forward). Per body: police (0.0268 / -0.0317, 1.6047, 0.1078), f-02 (0.0313 / -0.0321, 1.6098, 0.0969), m-03 as the player. The balls are not symmetric in the source meshes. |
| clavicle | (±0.045, 1.365, 0) | old Shoulder, to upperarm |
| upperarm, lowerarm, hand | x ±0.185, y 1.365 / 1.095 / 0.845 | old Arm / ForeArm / Hand; the hand points at the middle knuckle |
| fingers 01..03, thumb 01..03 | old finger joints 1..3 | the thumb's 01 is its metacarpal (as on Manny) |
| *_metacarpal | wrist + 0.25 x (knuckle - wrist) | the bone runs to its finger's 01 (the knuckle) |
| thigh, calf, foot, ball | old UpLeg / Leg / Foot / ToeBase | ball tail 7 cm forward (toe tip) |
| upperarm_twist_01 / 02 | 10 % / 50 % down the upper arm | 01 near the shoulder, 02 mid-arm |
| lowerarm_twist_02 / 01 | 55 % / 90 % down the forearm | 01 near the wrist, 02 mid-forearm |
| thigh_twist_01 / 02 | 10 % / 50 % down the thigh | 01 near the hip |
| calf_twist_02 / 01 | 55 % / 90 % down the shin | 01 near the ankle |
| ik_foot_l/r, ik_hand_gun, ik_hand_l/r | at foot_l/r, hand_r, hand_l/r with their frames | ik_hand_gun sits on the right hand, as on the Mannequin; ik_hand_r is ik_hand_gun's twin |
| ik_foot_root, ik_hand_root | origin, identity | |

## Rest pose: I-pose bind (arms down, palms forward), A-pose as a retarget pose

The bodies bind exactly as before: arms straight down, palms forward, legs straight. The mesh bytes
are unchanged. The UE5 Mannequin binds in an A-pose. We tested binding these bodies in one: the
same skeleton and weights, re-posed into an A-pose (arms 45 degrees below horizontal, elbows bent
15, palms turned down and in with 40 degrees on the upper arm and 50 on the forearm, legs 4 degrees
apart), with that pose applied as the bind. Edge strain was measured against the modelled mesh over
the shoulder region (clavicle, upper arm, upper-arm twist, spine_04/05 weights; each side):

| pose | I-bind mean / p99 / max | A-bind mean / p99 / max |
| --- | --- | --- |
| arms down (the old rest) | 0 / 0 / 0 | 0.050 / 0.34 / 1.1 |
| aim level (clip) | 0.216 / 1.71 / 5.2 (left) | 0.235 / 1.84 / 5.5 |
| idle carry (clip) | 0.088 / 0.56 / 2.2 | 0.098 / 0.60 / 2.4 |
| arms forward 90 | 0.149 / 1.81 / 4.6 | 0.187 / 1.79 / 5.6 |
| arms out to the side 90 (T) | 0.129 / 1.05 / 3.1 | 0.116 / 1.04 / 3.2 |
| swap (clip), right | 0.252 / 2.60 / 5.8 | 0.292 / 2.66 / 5.8 |

The close-ups (`apose_rest_aim.png`, `apose_idle_forward_side.png`) show the same thing. Bound in the
A-pose, the body gets creases at the back and front of the armpit at rest. When aiming and with the
arms forward, the folds at the front shoulder and armpit are deeper. The A-bind wins only a
few numbers, and by a hair: mean strain with the arms out to the side, two p99s, and the right
shoulder's max in the swap. It is worse in the mean and the max nearly everywhere else. The reason: these meshes were modelled arms
down, so an A-pose bind bakes one linear-blend deformation into the bind and adds another on top.
**Decision: keep the I-pose bind.** The A-pose is in the JSON as the named retarget pose
`retargetPoses.ue5_apose`: local rotations on this skeleton for the bones it changes. Set it as the
retarget pose of this skeleton in Unreal's IK Retargeter so it matches Manny's reference pose. An
A-pose bind would also have to re-express the 16 morph targets. They move arm and shoulder vertices
by up to 6 mm.

## Bone axes and rest rotations

- Every bone runs along its local **+Y** (head to tail).
- **Z** points to the side the child swings into when the joint flexes, and **X = Y x Z**. So flexion
  is a **positive rotation about local X** for the spine, neck and head (bend forward), elbow, knee,
  wrist (palm-ward), fingers and thumb (curl), ankle and ball (toes up), and jaw (open). For the
  eyes, +X looks up.
- Left and right are mirrored in Blender's convention: X has the same world direction on both sides,
  and Y and Z are reflected. A mirrored motion therefore has equal X rotations and opposite Y and Z
  rotations.
- Twist bones copy their parent's frame exactly, so their local rest rotation is identity and their
  pose is a pure rotation about Y. Hand, finger and thumb frames are close to but not exactly the
  forearm's, because they point at their child.

Rest world rotations (glTF; columns X, Y, Z; quaternion x, y, z, w; left side, the right side mirrored).
All values are in `ue5_mapping.json` (`restWorldRotation`, `restLocalRotation`, `restLocalTranslation`).

| Bone | X | Y | Z | quaternion |
| --- | --- | --- | --- | --- |
| root, pelvis, spine_01..05, neck_01/02, head, ik roots | +X | +Y | +Z | identity |
| clavicle_l | +Z | +X | +Y | (-0.5, -0.5, -0.5, 0.5) |
| clavicle_r | -Z | -X | +Y | (-0.5, 0.5, 0.5, 0.5) |
| upperarm, lowerarm and their twists (both sides) | -X | -Y | +Z | (0, 0, 1, 0): 180 about Z |
| hand_l | ~-X | to the middle knuckle (0.07, -0.98, 0.17) | ~+Z | (0, -0.08, -1, 0.037) |
| fingers (both sides) | ~-X | along the finger | palm side (~+Z) | near (0, 0, ±1, 0) |
| thumb_l | (-0.64, -0.42, -0.64) | along the thumb | across the palm (-0.73, 0.09, 0.68) | (0.38, -0.13, -0.90, 0.18) |
| thigh, calf and their twists | +X | -Y | -Z | (1, 0, 0, 0): 180 about X |
| foot | -X | to the ball (0, -0.43, 0.90) | (0, 0.90, 0.43) | (0, 0.53, 0.85, 0) |
| ball, eye | -X | +Z | +Y | (0, 0.707, 0.707, 0) |
| jaw | ~+X | to the chin (-0.02, -0.66, 0.76) | (0.02, -0.76, -0.65) | (0.91, -0.01, 0.01, 0.415) |

How the GLB carries this: each joint node has `rotation` = R_parent^T R (its local rest rotation) and
`translation` = R_parent^T (head - head_parent). The skin's `inverseBindMatrices` = inverse([R | head]).
POSITION, NORMAL, UVs, colours, morph targets, material and images are the source bytes. Only the
joint nodes, the skin, JOINTS_0 and WEIGHTS_0 change. `asset.extras.contract` is `earthonline-ue5-v1`,
and `extras.eyes` lists the fitted eye centres. Checked: the node chain reproduces R and head to 6e-8.
Blender's glTF importer reads these bone frames back to 3e-6. three.js (the game's GLTFLoader) loads
all four bodies (90 bones, 16 morphs), and its rest skinning matches the old bodies to 0.0001 mm.

**Rest rotations are no longer identity.** The old contract (`earthonline-humanoid-v1`: every rest
rotation identity, so a joint's local rotation was "the" rotation and a world rotation was the
product of locals) does not hold. See "Traps" below.

## Old pose to new pose (the mapping)

Old rests are identity. So for an old joint `j` with world rotation `Wold[j]` (the product of the clip's
local rotations down the chain), the new bone `b` that copies it gets:

```
W[b]      = Wold[j] * R[b]                 (world rotation: the old turn applied to the new rest frame)
local[b]  = W[parent]^-1 * W[b]            (what a clip / three.js bone.quaternion holds; includes the rest)
blender   = restLocal[b]^-1 * local[b]     (a Blender pose bone's rotation_quaternion: the delta in the bone frame)
```

| New bone(s) | From | Rule |
| --- | --- | --- |
| root | Root | copy |
| pelvis | Hips | copy; translation = the old Hips translation, unchanged because root rests at the origin with identity |
| spine_01, spine_03, spine_05 | Spine, Spine1, Spine2 | copy |
| spine_02, spine_04 | (none) | follow: local = restLocal (identity) in the exact mapping |
| neck_01 | Neck | copy |
| neck_02 | (none) | follow |
| head, jaw, eye_l, eye_r | Head, Jaw, LeftEye, RightEye | copy (the eyes now turn about the ball centre) |
| clavicle, upperarm, lowerarm, hand | Shoulder, Arm, ForeArm, Hand | copy |
| *_metacarpal | (none) | follow (palm rigid, as before) |
| thumb_01..03, index/middle/ring/pinky_01..03 | Thumb1..3, Index1..3, ... | copy |
| thigh, calf, foot, ball | UpLeg, Leg, Foot, ToeBase | copy |
| lowerarm_twist_02 / 01 | hand's twist about the forearm | local = twistY(0.47 a) / twistY(0.88 a), a = twist (swing-twist about Y) of `local[hand] * restLocal[hand]^-1` |
| calf_twist_02 / 01 | foot's twist about the shin | twistY(0.24 a) / twistY(0.44 a), a from the foot as above |
| upperarm_twist_01 / 02 | upper arm's own twist | twistY(-0.50 a) / twistY(-0.25 a), a = twist about Y of `restLocal[upperarm]^-1 * local[upperarm]` (counter-rotation: the shoulder end keeps half the twist) |
| thigh_twist_01 / 02 | thigh's own twist | twistY(-0.30 a) / twistY(-0.15 a) |
| ik_foot_l/r | foot_l/r | world transform = the foot's (rotation and translation keyed) |
| ik_hand_gun, ik_hand_r | hand_r | world transform = the right hand's |
| ik_hand_l | hand_l | world transform = the left hand's (in ik_hand_gun's frame) |

With the twist bones held at rest ("exact mapping"), the new body deforms identically to the old one.
The twist rules are what the game's run-time layer (or Unreal's post-process) should do each frame.
In the old clips the forearm carries no twist (the IK chain is a hinge: its twist is 0 in every
clip). Pronation lives in the Hand joint (right hand -72 to -77 degrees in the carry and aim, +155 in
the swap). That is why the forearm twist is measured from the hand. In new clips (R2), spread the
spine bend over spine_01..05 and keep most of a neck turn on neck_01 (70/30 tested). See the ROM
numbers.

## Weights (redistributed, not re-painted)

Each vertex keeps its total. Each old influence is split onto the new bones that took over its joint:

- Spine onto spine_01 / spine_02, and Spine1 onto spine_03 / spine_04, by height, linear between the
  two bones' heads. Spine2 goes onto spine_05. Neck goes onto neck_01 / neck_02 the same way. (The
  heads were chosen over segment middles: with an evenly spread bend the worst spine edge is lower,
  and the throat fold stays at the old level with a 70/30 neck turn.)
- Arm: along the upper arm, piecewise linear between upperarm_twist_01 (10 %), upperarm_twist_02
  (50 %) and upperarm (100 %). Thigh the same with thigh_twist_01 / 02 / thigh.
- ForeArm: lowerarm up to 15 % (the elbow keeps its old skin), then lowerarm_twist_02 at 55 % and
  lowerarm_twist_01 at 90 % and beyond. With the shares above, the twist ramps evenly from 0 at 15 %
  to the hand's full twist at the wrist. Leg: calf / calf_twist_02 / calf_twist_01 at the same places.
- Hand: palm vertices near the knuckles give up to 40 % of their hand weight to the two nearest
  metacarpals (smoothstep from 40 % to 95 % of the way from wrist to knuckles). This fades out beyond
  the index and pinky knuckles.
- Eyes: 100 % to eye_l / eye_r. Jaw to jaw, Head to head, fingers 1:1, Foot to foot, ToeBase to ball.
- At most 4 influences (the source had 4). Past 4, the smallest piece split from an old joint is
  folded back into its biggest sibling, so nothing is ever dropped: 971 vertices on the player, 0
  dropped. Then the vertex is renormalised.
- The GLB has ONE skinned mesh with one primitive. Body, clothes, hair, brows, eyes, teeth and lashes
  (107 connected pieces) are all in it, and all were redistributed by the same rules.

## Proof (player; `blender/review/rig/report.txt`)

- **Equivalence**, 8 clip poses (idle carry, aim level, aim up, reload mid-way, crouch, sprint
  mid-stride, swap, walk). Exact mapping, every vertex of every piece: max 0.0001 mm. With the twist
  bones on: vertices with no twist weight move at most 0.47 to 1.4 mm (p99 0.09 to 0.29). Vertices on
  twist bones move by design: max 32 to 81 mm, p99 25 to 65, mean 4.5 to 8. The most is on the right
  forearm near the wrist (lowerarm_twist_01_r), where the old wrist was wrung.
- **Wrist collapse** (forearm and hand skin within 6 cm of the wrist, distance from the forearm axis
  against rest; 1 = kept). Forearm twisted ±90: old min 0.71 / mean 0.84, new 0.95 / 0.99. In clips,
  right hand mean old to new: carry 0.87 to 0.96, aim 0.88 to 0.98, crouch 0.88 to 0.97, swap 0.66
  to 0.95 (min 0.21 to 0.70).
- **Range of motion** (`rom_arm_twist.png`, `rom_arm_bend.png`, `rom_trunk_legs.png`,
  `rom_clip_forearms.png`). Arm raised forward / to the side 90, elbow 145, wrist ±60/70, knee deep
  and spine bend+twist: identical to the old (0.0 mm; no twist involved). Upper arm twist ±70: arm
  edge strain p95 0.28 to 0.19 and 0.33 to 0.23. Spine bend+twist spread over 5 bones: max edge
  strain 1.10 to 0.93. Neck 70 with neck_01/neck_02 at 70/30: p99 0.302 to 0.297.
- **Clip poses, edge strain against the modelled mesh** (shoulder, forearm, hip, each side; 8 poses
  plus the 180 pivots). With the twist bones driven, the mean is lower or equal everywhere: right
  shoulder carried 0.070 to 0.060, swap 0.356 to 0.331; right forearm 0.12 to 0.11 in every pose, swap
  0.153 to 0.120; hips 0.14 to 0.11-0.13, pivots 0.31-0.41 to 0.25-0.35. p99 rises in three places by a
  hair: crouch left hip 3.88 to 4.01, sprint left shoulder 0.46 to 0.48, pivot left shoulder 0.52 to
  0.54.
- **Eyes**: eye bones turned ±25 degrees in yaw and pitch. The ball centre moves 0.000 mm (old joint:
  14.6 mm). The vertex centroid moves 2.5 mm because the cornea sits in front of the ball. Seen in
  `eyes.png`: the old ball slides out of the lids onto the temple, the new one stays in.
- **Blender**: an armature built from this spec, with the player bound by an Armature modifier and
  posed by `restLocal^-1 * local`, deforms to the numpy / three.js skinning within 0.0007 mm (aim
  level, twist on).

## Extras beyond the Mannequin

- `jaw`, `eye_l`, `eye_r` under `head`: the game's face (eyes, blinks, mouth) uses them. The eyes are
  centred on the balls.
- The 16 morph targets (`jawOpen`, visemes, blinks, brows...) are kept, with their names in
  `mesh.extras.targetNames`.

## Uncertain, or not checkable without Unreal

- The bone list is the UE5 Mannequin's core as we understand it. Not verified against an actual
  Manny asset (none here, and Epic's files may not be used). Possible differences: twist bone
  numbering and placement (we put _01 near the shoulder / hip and _01 near the wrist / ankle), and
  exactly where Manny's metacarpals start.
- Axes: Manny's bones run along X in Unreal (with mirrored signs on the right side, as far as we
  know). Ours run along Y in Blender and glTF. What Unreal sees depends on the FBX export's
  primary / secondary bone axis settings (R4). The IK Retargeter works on chains and the retarget
  pose, so it should not care. Anything in Unreal that assumes Manny's exact axes would: Control Rig
  twist / corrective solvers, AnimBP "twist correction" nodes, and copy-pose by name.
- Reference pose: Manny binds in an A-pose and ours binds in I. Use `ue5_apose` as the retarget pose.
  It was built to match a description, not Manny's exact angles.
- Unreal's post-process rig drives Manny's twist bones with its own shares. Ours (forearm 0.47 /
  0.88 of the hand twist, upper arm -0.50 / -0.25, thigh -0.30 / -0.15, calf 0.24 / 0.44) fit the
  weights here. If Unreal drives them differently, the forearm skin twists differently: check in UE.
- Units and facing: metres, Y up, facing +Z here. The FBX for Unreal (R4) must convert to cm and
  Z up. Manny faces +Y in its asset as far as we know.
- Root motion: root rests at the origin with an identity rest. The clips do not key it (the pelvis
  carries the Hips translation). Unreal root motion would need the transitions' `root` track
  moved onto `root` (R2 / R4).

## Traps (for R2: the clip pipeline; R3: the game)

- **Rest rotations are not identity.** `rifle_motion/skel.py` raises on that on purpose. Every
  "local = parentWorld^-1 * world" still holds, but a world rotation that was "the joint's turn" is
  now `turn * R[b]`. The clip pipeline's bake (`bake.read_pose`) and FK, `motion.js` sampling, and
  any `character.js` code that sets a bone from a world rotation, aims a bone along a world
  direction, reads a bone's axis (e.g. the foot's forward was (0,0,1) turned by its world quat; on
  the new foot that direction is (0, 0.90, 0.43) in its local frame, and the ball's is local +Y), or slerps from identity must be ported. "Straight" for a bone
  is now `restLocal`, not identity (the trigger finger's straight pose was identity: pass 11).
- **Blender pose bones**: with the old skeleton imported, a pose bone's quaternion WAS the glTF local
  rotation (ANIMATION_NOTES, "Blender"). Now it is `restLocal^-1 * local`. The importer reads our bone
  frames exactly, so bones point along their limbs and IK can work on them directly. The old ORG
  rest-frame trick may not be needed; the chains are still dead straight at rest, so pre-bend.
- **Names**: every joint name changes (`Hips` -> `pelvis`, `LeftHandIndex1` -> `index_01_l`, ...).
  The clip GLB's extra nodes (`Gun`, `GunIn`, `PalmL/R`, `ElbowL/R`) hang under `Spine2`. Their parent
  becomes `spine_05`, which has the same place and an identity rest, so their values carry over.
- **Twist bones are not in any clip.** Either key them in the bake (R2: from the rules above) or
  drive them at run time from the hand / foot / upper arm each frame (R3). Unkeyed, they stay at rest:
  the body then deforms exactly like the old one, wrist pinch included.
- **Eyes**: the new eye bones sit at the ball centre. The game's `eyeBall` correction (moving the
  joint so the ball stays put) must be REMOVED, or the eyes will be moved twice.
- **Spine and neck spreading**: the exact mapping puts all of the old Spine's bend on spine_01 with
  spine_02 at rest (same for Spine1 / spine_03, Neck / neck_01). This is exact but not how a UE clip
  bends. R2 can spread the bend. Keep a neck turn mostly on neck_01: an even split put a sharper fold
  at the throat when the weights were split at segment middles.
- **Thumb**: thumb frames are aimed across the palm (Z towards the palm, medial). Curl is +X, but the
  thumb's X is not the fingers' X.
- **Hips height**: pelvis translation values are unchanged (root at the origin, identity).
- **Bone order**: the skin's joint order is not the old one. Index bones by name, never by position.
- **The glTF importer makes an `Icosphere` bone-shape MESH object** and links it into a scene of its
  choosing (here the clip pipeline's `Scene`), even when another scene is active. "The first new mesh"
  is then that Icosphere, not the body. The build picks the mesh that is not a bone shape, checks it
  is in its own scene, and removes the shape afterwards.

## Clips on this skeleton (pass R2, 2026-11-11): `rifle-motion-ue5-v1`

| What | Where |
| --- | --- |
| Clip pack (same 80 clip names, frame counts, timing, events and JSON fields as `rifle-motion-v1`) | `public/characters/rifle-motion-ue5-v1.glb` / `.json` |
| Builder (now reads only the `-ue5` body; `BODY` / `FRAMES` at the top choose the body) | `python3 blender/tools/bl.py run blender/build_rifle_motion.py` (saves `blender/rifle_motion_ue5.blend`) |
| One-time data converted from old files (finger grip, the old eye-joint points the aims weld to) | `blender/rifle_motion/ue5_data.json` |
| Review (numbers, contact sheets, twist per clip) | `blender/review/ue5/clips.txt`, `*.png`, `twist.txt` |
| Proof | `python3 blender/ue5_rig/pack_equivalence.py` -> `blender/review/ue5/equivalence.txt`; `python3 blender/ue5_rig/compare_clips.py` (clips.txt old vs new) |

**How the pipeline works now.** Authoring stays in CANONICAL frames: for every bone, canonical world
`C[b] = W[b] * R[b]^-1`, so every canonical rest is the identity and the canonical local rotation of a
bone that took over an old joint IS the old joint's local rotation. `gait.py`, `handling.py`,
`transitions.py`, `crouch.py`, `reactions.py`, `carry.py` and `review.py` therefore kept their math and
only changed names (UE5 names everywhere, e.g. `spine_05` is the chest, `clavicle_l` the collar keys).
Only the lowest layer converts:
- `skel.Skeleton(body, frames=None)` reads joint positions, hierarchy and rest transforms from the body
  GLB, and `R[b]` from a frames JSON in this file's schema (`canonicalToBone`, else `restWorldRotation`;
  default: `<body>.frames.json` beside the GLB, else the rest world rotations, which is right for our
  I-pose bodies). Canonical FK uses `rest[b] = head[b] - head[parent]`.
- `rig.py`: rig bones carry canonical frames (rest matrix QC); every driven skeleton bone copies an
  `SK-<bone>` child of its canonical rig bone that carries the skeleton bone's own rest frame.
- `bake.read_pose`: canonical = real world turn less `R[b]`.
- `bake.export` writes the GLB itself (no Blender exporter): `local[b] = R[p]^-1 * Lc[b] * R[b]`.

**What a clip holds.** Rotation of all 90 bones (real glTF locals, rest included), translation of
`root`, `pelvis`, `ik_foot_l/r`, `ik_hand_gun`, `ik_hand_l/r`, and the `Gun` track plus the clip's extra
nodes (`GunIn`, `PalmL/R`, `ElbowL/R`) under `spine_05`. Exact mapping: `spine_02`, `spine_04`, `neck_02`,
the metacarpals, the eyes and the jaw at rest. Slerp between keys commutes with the constant frames,
so the clips also agree between keys (checked at 60 fps).
- **Twist bones** keyed with R1's shares (above), the source twist unwrapped frame to frame. The old
  swaps turn the right hand a whole turn about the forearm (`swap-rifle-shotgun`: -77 degrees to
  -390); no continuous share can follow that and end where the next clip begins, so each twist bone
  gives back its share of that turn the short way over 6 frames where the hand turns fastest
  (`bake.twist_series`, `UNWIND`). There the pack's twist differs from R1's per-pose rule by up to
  169 degrees on `lowerarm_twist_02_r` for those frames; everywhere else it is R1's rule exactly.
- **IK bones**: `ik_foot_l/r` = the feet's world transforms in the root's space; `ik_hand_gun` =
  `hand_r`; `ik_hand_l` = `hand_l` in `ik_hand_gun`'s frame; `ik_hand_r` = identity (the twin);
  `ik_foot_root`, `ik_hand_root` at rest.
- **Root travel**: transitions (notes carry `root`: per frame `[x, z, yaw]`) key the same values on
  `root`: translation (x, 0, z), rotation yaw about +Y. Others key root at rest. The JSON keeps `root`
  and says so in `rootMotion`. Do not apply both.
- `PalmL/R` rotation is the hand's CANONICAL turn in `spine_05`'s frame (the old Hand's): the real
  hand world rotation is it times `R[hand]`. `Gun`, `GunIn`, `Elbow*` are unchanged values.
- The belt pouch (`pouch`, `pouchParent: pelvis`) has the same numbers: pelvis = old Hips frame.

### Traps for R3 (the game) and R4 (FBX)
- R3: read clips by UE5 name; every bone has a non-identity rest, so "straight" is `restLocal`, and
  anything that set a bone from a world rotation must multiply by `R[b]` (`ue5_mapping.json`
  `restWorldRotation`). PalmL/R rotations are canonical (above). The root bone now carries the
  transitions' travel: either zero it and move the character by notes `root` (as now), or the reverse.
- R3: the game's run-time arm IK changes hands and forearms after the clip; the clip's twist keys are
  then stale. Re-drive the twist bones after the arm IK each frame with the same rules
  (`blender/rifle_motion/skel.py` TWIST, swing-twist about +Y, unwrapped against the last frame).
- R3: eyes sit at the ball centres; remove the `eyeBall` correction. The aims weld the old eye-joint
  point (`ue5_data.json` sightEye) to the sight, not the new eye bone.
- R4: the GLB clips have no skin and the IK / twist bones keyed; FBX needs cm, Z up and the bone-axis
  settings; root motion is on `root` for the transitions only.
- The review's gun-against-body test counts many more forearm / pistol-grip triangle pairs: with the
  twist the right wrist keeps its full girth (it used to collapse) and now meets the grip. With
  `REVIEW_TWIST = False` the review reproduces the old numbers. The hand placement on the grip was
  tuned against the collapsed wrist; re-tune later.

## Per-body tables and other bodies (pass T1b, 2026-11-11)

Every measurement of the body the clips are fitted to now lives in one JSON per body,
`blender/rifle_motion/bodies/<name>.json`, read through `rifle_motion/body.py` (`body.T`). The build
selects it together with the GLB and the frames file (`build_rifle_motion.py` `BODIES`; run with
`BODY_NAME = 'tripo'` or the default `'player'`), BEFORE it reloads the other modules, which read
the table at import time. Keys (G = glTF axes, metres; chest = spine_05's canonical frame, hand =
the old Hand frame, pelvis = pelvis canonical frame, gun = the gun's own frame):

| Key | Used by | What |
| --- | --- | --- |
| `palm` | carry, bake, review, handling | middle of the palm from the wrist (hand frame) |
| `legs` | gait, transitions, crouch, handling | thigh, shin, `ankleY` and `hipDrop` (stand height = ankleY + leg span + hipDrop), `ankle` / `heel` / `ball` (from the ankle's ground point: the roll pivots), `hip` (hip joints from the pelvis), `reach` (share of the leg a planted leg may stretch), `reachSwing` (m, a swinging leg), `widthAdd` (added to every gait's foot spacing), `soleY` (the ground under the canonical pose's soles) |
| `rig` | rig | `toeTip`, `heelPivot` (B, from the ankle's ground point), `prebend`, `ballPivotDrop` (the ball pivot this far under the ball joint: the sole) |
| `review` | review | `heel` (back of the heel from the ankle, foot frame), `heelY` / `ballY` (their heights standing flat: the slide test's "down") |
| `stance`, `crouch` | build, crouch | the standing feet; the crouched feet and the crouch's hip drop |
| `holds`, `guns`, `stow` | carry | the three holds (chest frame), per gun the palms, hand turns, elbow poles, `carrySlide`, `shift`; the slung places |
| `magPalm` | handling | the palm on the magazine |
| `aim` | handling.AimPose | `pocket`, `grip`, `support`, `pole`, `eyeBack`, `eyeDown`, `cant`, `lift`; new (default off): `toFace` (iterations bringing the gun to the face until the eye is at its place), `lean` (degrees more forward lean), `downSlide` (support palm back along the fore-end aimed 45 down) |
| `sightEye` | skel.sight_eye | the point welded behind the sight (head frame) |
| `grip` | skel.grip | finger grip (canonical locals); null = `ue5_data.json` |
| `unwind`, `unwindRolls` | handling | re-authored swaps / reload-from-empty: the hand that wound its forearm a whole turn rolls a whole turn back on its own axis during that move (default off: R2's clips) |
| `swapShift`, `guns.<gun>.drawShift` | handling.Swap | the incoming gun's way up nearer the chest (chest frame); the draw hold on the slung fore-end moved along it |
| `bonesNote` | build | the JSON `bones` text for a body that is not the 90-bone I-pose one |
| `pouch` | pouch, handling | `shapes` (kind, at, size, colour, name, optional yaw in degrees about the pelvis's y; kind `band` = an elliptic belt: at = (0, y, centre z), size = (inner half-width, inner half-depth, height, thickness)), `draw` (palm targets per gun), `drawYaw` (the drawing hand turned with the kit) |

`civilian-m-01-player-ue5.json` holds exactly the values the pipeline had hard-coded up to R2. Proof:
five clips (rifle-idle, rifle-walk-f, rifle-aim-level, reload-rifle-tac, rifle-crouch-walk-f) rebuilt
from it are bit-identical to `rifle-motion-ue5-v1` (every channel, every key; notes identical),
before and after the other-body changes below.

### What the "other body" path needed (debugged on Tripo)

- `skel.Skeleton` read `canonicalToBone` / `restWorldRotation` only: a prepared body's frames file
  calls it `R`. It now also builds the CANONICAL joints (`head[b] = head[p] + R[p] * restT[b]`; the bind
  heads stay in `bind_head`), `canon_local[b] = R[p]^-1 * R[b]` (what "no twist" / "straight" is),
  and the twist shares from the frames file's `twistBones`. `posed_bind` says whether the bind differs
  from the canonical pose; when it does not, every value is exactly as before.
- `rig.py` built the rig from the BIND heads (a T-pose here) and gave each `SK-` bone the bind frame.
  It now builds on the canonical joints, and an `SK-` bone's frame is the bind frame turned by
  `A[b] = R[b] * bindWorld[b]^-1`, so copying it puts the bone at `R[b]` (`rig._Canon`).
- Twist bones: measured against `canon_local`, keyed as `canon_local * twistY(share * a)` (the
  forearm twist bones are pre-turned 0.83 to 0.88 of 77 degrees in the canonical pose; measuring
  from the rest would twist the wrist by that much), and their Blender pose is
  `restLocal^-1 * canonLocal * twistY`; `bake.clear_twist` puts them at the canonical pose, not rest.
- The belt kit is placed in the pelvis's canonical frame (the pelvis bone's frame is turned 88 deg).
- `gait.REACH_SWING` was an absolute 0.755 m (the old leg's 97 %): on a longer leg it lowered the
  walk's hips by 5 cm. Now per body.
- The aim weld could not reach: on Tripo the eye's place behind the sight was 7 to 10 cm out of the
  neck's reach once the pocket was right. `aim.toFace` brings the gun to the face instead.

### Adding a body: from a raw UE5-named GLB to a built pack

1. Prepare the body (T1a): `blender -b --factory-startup --python blender/bodies/prepare_body.py --
   --src <raw.glb> --out blender/bodies/<name> --name <name>-ue5` (scale, recentre, IK bones,
   weight repairs incl. F1's elbow repair, `R[b]`, metrics). Check `deform_proof.py`'s sheets and
   `joint_review.py`'s elbow / knee / wrist sheets (pass F1: textured, linear blending as the game).
2. Copy `blender/rifle_motion/bodies/civilian-m-01-player-ue5.json` to `<name>-ue5.json` and set the
   body's numbers from its metrics: palm; legs (thigh, shin, ankleY = ankle above the sole, hipDrop =
   pelvis - hip joint height, hip joints, heel / ball pivots from the feet metrics, soleY = canonical
   sole y, widthAdd = hip-width difference, reachSwing = 0.968 x leg); review heel and heights; rig
   heelPivot / toeTip / ballPivotDrop; stance and crouch stance moved out by the hip-width difference;
   sightEye = the eye surface point (head frame) + (0, 0.020, -0.043) (the old weld point's offset from
   its eye); holds / stow / pocket shifted by the torso's front and back against the old body (chest
   frame); the pouch from the girth profile (`blender/rifle_motion/bodies/tripo-player-ue5.json` shows a
   belt fitted by an ellipse).
3. Add an entry to `BODIES` in `build_rifle_motion.py` (GLB, frames JSON, table, VERSION, review dir,
   blend file).
4. Fit with partial builds: `ONLY = [...]`, `PATCH = 'export'`, `OUT_GLB = <scratch>`: clips judged,
   sheets and close-ups (`CLOSEUPS`, `rifle_motion/closeups.py`) in the review dir, the clips written
   to a pack of their own. After any build, `bpy.app.driver_namespace['rifle_motion']` holds the rifle
   scene, author, mesh test and `make`, so a script can try values on one clip without rebuilding.
   Look for: `gripCm`, elbows never 0 (an arm at full stretch), `clearBy` / `slungBy` (the parts that
   meet first), the aim's `weld` (printed; under 0.1 cm with `toFace`), crouch `headY`.
5. Full build: `BODY_NAME = '<key>'`, then put the body's GAME COPY, the frames and the metrics beside
   the pack in `public/characters/` (pass F1: the game copy is `blender/bodies/game_copy.py --src <master>
   --out public/characters/<name>.glb`, textures at most 4096 base colour / 2048 the others; the master
   with full-resolution textures stays under `blender/bodies/<name>/`, and the Unreal export reads the
   master: `BODY_SOURCE` in `blender/export_unreal/config.py`) and run `python3 blender/bodies/pack_check.py <body.glb> <pack.glb> <out.txt>`
   (the game's way of playing it: wrist radius kept, twist steps, soles).
