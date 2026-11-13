// The shooter: a skinned body on the UE5 Mannequin-style skeleton (earthonline-ue5-v1), posed every
// frame in layers.
//
// The layers below pose the OLD skeleton's joints (earthonline-humanoid-v1's names: Hips, Spine,
// ..., RightHandIndex3) in canonical frames: every rest rotation the identity, arms hanging straight
// down with the palms facing forward, the character facing +Z, so a bone's world rotation is just
// "where its rest axes point". Those joints are a proxy skeleton (rig.js) at the body's own
// canonical joint positions; once the arms are posed, rig.js turns the proxy's pose into the real
// UE5 bones (boneWorld = canonicalWorld * R[b]), spreading the spine and neck over their in-between
// bones and driving the twist and IK bones. Every body measurement the layers use comes from the
// body's table (public/characters/<body>.game.json) and its frames (rig.js).
//
//   1. locomotion   clips authored in Blender (blender/build_rifle_motion.py): the rifle idle,
//                   the walk and the jog in eight directions and the sprint, blended by how hard
//                   the body is going and which way, all kept in step
//   2. legs         the blended clips give ankle and knee positions, stretched along the way of
//                   travel when the ground goes faster or slower than they were made for (setting
//                   off, stopping, turning). Each foot is held still on the ground for as long as
//                   the clip has it there, and the legs are solved with two-bone IK. Standing
//                   still, the feet are planted in the world and take small steps when the body
//                   turns away.
//   3. upper body   carried: the clips' own spine (shaped round the gun, counter-turning the
//                   hips, breathing), with the head following the view and the high ready's
//                   difference on top. Aiming: the shouldered poses authored for each gun (level, 45
//                   up, 45 down), blended by where the gun points and twisted onto the target, kept
//                   steady while the legs move underneath. The
//                   clips also say where the gun is carried (gunPos / gunQuat, chest frame).
//   4. arms         two-bone IK to the palm positions the gun asks for (see weapon.js).
//
// Gun handling (the swap, the reloads, the pump) is played over all of this as an upper-body
// action authored in Blender: its trunk, neck, head and collarbones as a difference from
// rifle-hold-low, so it rides on whatever the legs and the clips' trunk are doing; its guns and
// hands in the chest joint's frame (see `act`).
import * as THREE from 'three/webgpu';
import { groundAt, edgeNear } from './ground.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Pose, BONE, GUN, ActionSample } from './motion.js';
import { Rig, UE5_OF } from './rig.js';
import { batchModel } from './batch.js';

/**
 * Bodies the demo can show (public/characters/SOURCE.md): the player is the Tripo body; N steps
 * through the four EarthOnline bodies. Each names its body, its clip pack, the frames of the body the
 * pack was built for (null: the body's rest is its canonical pose) and its table.
 */
export const ROSTER = [
  { file: 'tripo-player-ue5.glb', pack: 'rifle-motion-tripo-v1', frames: 'tripo-player-ue5.frames.json', table: 'tripo-player-ue5.game.json', label: 'white tee, shorts, barefoot', source: 'Tripo' },
  { file: 'civilian-m-01-player-ue5.glb', pack: 'rifle-motion-ue5-v1', frames: null, table: 'earthonline-ue5.game.json', label: 'tan overshirt, white tee, denim', source: 'EarthOnline' },
  { file: 'civilian-police-m-hero-ue5.glb', pack: 'rifle-motion-ue5-v1', frames: null, table: 'earthonline-ue5.game.json', label: 'patrol officer', source: 'EarthOnline' },
  { file: 'civilian-m-03-hero-ue5.glb', pack: 'rifle-motion-ue5-v1', frames: null, table: 'earthonline-ue5.game.json', label: 'olive field jacket', source: 'EarthOnline' },
  { file: 'civilian-f-02-hero-ue5.glb', pack: 'rifle-motion-ue5-v1', frames: null, table: 'earthonline-ue5.game.json', label: 'mustard overshirt, dark denim', source: 'EarthOnline' },
];

/** Ground speeds (m/s) forward at which the walk, jog and sprint clips are shown on their own. */
export const SPEED = { walk: 1.45, run: 3.6, sprint: 5.2 };

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const CHAIN = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
// Aiming: the share of the aim twist each joint has reached (and of any pitch past the authored
// poses' 45 degrees), and how much of the pelvis's own rocking still gets through to it.
const AIM_PITCH = [0.14, 0.32, 0.52, 0.78, 1];
const AIM_TWIST = [0.3, 0.6, 0.9, 0.96, 1];
const AIM_WOBBLE = [0.6, 0.35, 0.15, 0.08, 0];
// Carried: the share of the head's look each joint takes, and the share of its up-and-down look.
const LOOK_YAW = [0.04, 0.1, 0.2, 0.6, 1];
const LOOK_PITCH = [0, 0, 0.05, 0.5, 1];
// Backing away aimed, the trunk comes upright out of the aim hold's lean, a little past it low in
// the spine (rad each joint is turned back; the head stays where it was looking). The clips
// carried come upright by themselves.
const BACK_LEAN = [0.05, 0.08, 0.1, 0.05, 0];
// How much each step may differ from the usual, either way (share): its length, how far the
// shoulders turn and the trunk tips and nods with it, how far the hips sway and how hard the
// foot comes down. And how much further out or in a foot may be put down (m).
const VARY = { stride: 0.05, yaw: 0.25, roll: 0.25, nod: 0.3, sway: 0.2, hit: 0.3 };
const VARY_PLACE = 0.012;
// The clips step at their own length: the walk's, authored on bent knees, may stretch only this
// far when the ground goes faster than it was made for, the jog's and sprint's a little further
// (setting off, a turn while running).
const WALK_STRIDE = 1.15;
const RUN_STRIDE = 1.3;
// Running (Shift), the body turns to the way it goes; while it turns, the legs take the clips for
// the way they are going, but no further round than the diagonal (rad): a side shuffle's trailing
// foot closes right up to the leading one, which a body turning under it would tread on.
const TURN_DIR = Math.PI / 4;
// Feet held on the ground through each stance. A foot is caught when the clip has it on the
// ground (its contact curve, from the clip's notes, so that stretching the step cannot fool
// it) and within `low` of the ground where
// it really is, and
// let go when the clip lifts it, or when the body has carried on so far that the leg would
// have to stretch past `reach` of its length to stay. A body turning further than `turn`
// (rad) from a held foot swivels it on its ball, as a pivot does, rather than tearing it off
// the ground. Let go, the foot rejoins the clip's path in about `rejoin` seconds, starting
// from standing still, so there is no jolt.
const LOCK = { low: 0.04, reach: 1, turn: 0.7, rejoin: 0.2 };
const CATCH_TIME = 0.25; // s, a foot let go far from the clip's path is in the air this long
const TOE_CLEAR = 0.025; // m, the least the ball or heel of a swinging foot clears the ground by
// back of the heel from the ankle, foot frame (1 cm above the sole): set per body (table foot.heel)
export const HEEL = new THREE.Vector3(0, -0.07, -0.05);
const HEEL_BACK = HEEL;
const _tfN = new THREE.Vector3();
// Nearest the ankles may come side by side (m): the trailing foot of a side step closes up to the
// leading one and no further, and passing feet never brush.
const GAP = 0.15;
const GAP_SOFT = 0.04;
const PUSH_LEAD = 0.03; // s ahead the closing of the feet is looked
// A transition comes in over MOVE_IN[kind] s (from a run the gun has further to go: the sprint
// carries it pulled in), goes out over its last MOVE_OUT_LOOP s into a loop or MOVE_OUT into the
// idle, and one let go of fades in MOVE_LET_GO.
const MOVE_IN = { pivot: 0.15, start: 0.08, stop: 0.1, runTurn: 0.15 };
const MOVE_OUT_LOOP = 0.12;
const MOVE_OUT = 0.2;
const MOVE_LET_GO = 0.12;

// Where the middle of the palm is, measured from the wrist joint in the hand's rest frame
// (fingers run along -Y, the palm faces +Z).
// (set per body from its table: `palm`)
export const PALM_LOCAL = new THREE.Vector3(0, -0.075, 0.028);
// Share of the wrist's roll that the forearm bone takes. With the UE5 skeleton's twist bones the
// forearm is a hinge and the twist bones take their shares of the hand's roll (rig.js), as the clips
// have it; 0.6 was the old skeleton's, which had none.
const FOREARM_TWIST = 0;
// the ankle joint above the ground, standing flat (set per body: table foot.ankle; barefoot Tripo
// 0.088, the EarthOnline shoes 0.08)
export let ANKLE_HEIGHT = 0.08;
// The foot's length either side of the ball joint (m, along the sole): to the toe tip, and back to the
// heel. The stair and tread code looks this far (plus its margins) ahead and behind. Per body: the
// EarthOnline shoes 0.07 / 0.165, the barefoot Tripo foot 0.081 / 0.176.
let TOE = 0.07;
let HEEL_BACK_BALL = 0.165;
const SOLE_HALF = 0.045; // m, the ball's edges either side of the foot's middle (the review's sole points)
// A leg reaching past SOFT_REACH of its length straightens ever more slowly towards LEG_REACH
// (soft IK), so a knee eases out rather than snapping locked, and never quite gets straight:
// even the trailing leg pushing off keeps some bend. A foot in the air starts falling short
// sooner, from SWING_SOFT_REACH: a sprint's back-kicked foot can be wanted well out of reach,
// and a narrow soft band would hold it still there and then let it go all at once. The hips
// are lowered, and a held heel lifted, as far as it takes for a leg standing on the ground to
// reach its foot at BENT_REACH (about 24 degrees of bend).
const SOFT_REACH = 0.98;
const SWING_SOFT_REACH = 0.88;
const LEG_REACH = 0.99;
const BENT_REACH = 0.978;
const ROLL_MAX = 0.7; // rad, the furthest a held foot rolls up onto its ball to keep the knee bent
const LOW_MAX = 0.06; // m, the most the hips sink for it; past that a held foot is let go

// Standing, the feet go where rifle-idle stands them (motion.stance); shouldering the rifle,
// they go towards this wider, more staggered stance, in the character's own frame (it faces
// -Z, its right is +X), and the support-side hip comes further forward by AIM_HIP_YAW (rad).
const AIM_STANCE_OLD = { Left: { x: -0.11, z: -0.14, toe: 0.08 }, Right: { x: 0.14, z: 0.17, toe: -0.45 } };
// (moved out by the body's hips' extra width: table stanceOut)
const AIM_STANCE = { Left: { ...AIM_STANCE_OLD.Left }, Right: { ...AIM_STANCE_OLD.Right } };
const AIM_HIP_YAW = 0.07;
const STEP_TIME = 0.3; // s, one corrective step
const STEP_LIFT = 0.06; // m
const STEP_TRIGGER = 0.1; // m of error before a planted foot steps

const UP = new THREE.Vector3(0, 1, 0);
/** Where the elbows point, in the chest's frame (+X the shooter's left, +Z forward): down, a
 * little out and back. A gun may carry its firing elbow elsewhere (hands.rPole, shotgun.js). */
export // how far the eyes turn in the head (rad) before the rest is the head's: across, up and down; and
// how far what they look at must move from where they are fixed for them to jump to it
const EYE_YAW = 0.45;
const EYE_UP = 0.35;
const EYE_DOWN = 0.5;
const SACCADE_MIN = 0.05;
const EYE_LEAD = 0.15; // s ahead the eyes go to where a moving point will be
const HEAD_LAG = 0.09; // s, how far the head's look trails the view
const FIXATION = 0.18; // s, the shortest look between two jumps
const PURSUIT = 0.6; // rad/s, the fastest the eyes follow a moving point without jumping
export const ELBOW_POLE = { right: new THREE.Vector3(-0.45, -0.85, -0.25), left: new THREE.Vector3(0.28, -0.95, -0.1) };
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
// The index finger's tip and the middle of its end pad, in the end joint's frame (the finger runs
// along -Y, the pad faces +Z): what lies on the gun's side and what presses the trigger.
// (set per body: table index)
export const INDEX_TIP = new THREE.Vector3(0, -0.022, 0);
export const INDEX_PAD = new THREE.Vector3(0, -0.013, 0.006);
const _fRest = new THREE.Vector3();
const _fFire = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _root = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _target = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _home = new THREE.Vector3();
const _hipsPos = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qUpper = new THREE.Quaternion();
const _qLower = new THREE.Quaternion();
const _qEnd = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _qHips = new THREE.Quaternion();
const _qLean = new THREE.Quaternion();
const _qRes = new THREE.Quaternion();
const _qPelvis = new THREE.Quaternion();
const _qCarry = new THREE.Quaternion();
const _qAimCum = new THREE.Quaternion();
const _qAim = new THREE.Quaternion();
const _qHold = new THREE.Quaternion();
const _qRecoil = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qAuthCum = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _inv = new THREE.Matrix4();

// Where the butt of the rifle sits, in the chest joint's frame: across (x) and up (y) are fixed,
// how far forward is read off the body's surface, less `press` for the pad bedding in.
// (set per body: table pocket)
const POCKET = { x: -0.125, y: 0.19, press: 0.02 };

// ---- body surface: how far forward the clothes come, so the rifle can be kept out of them ----
const CELL = 0.025;
/**
 * A height field of the front of the body around one joint, read from the rest pose: for each
 * cell across (x) and up (y) from the joint, how far forward (z) the surface is. `allowed`
 * names the joints whose vertices count.
 */
function surfaceField(mesh, bone, allowed, x0, x1, y0, y1) {
  const position = mesh.geometry.attributes.position;
  const vertex = (i, out) => mesh.getVertexPosition(i, out); // (skinned: the body is in its canonical pose)
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const nx = Math.ceil((x1 - x0) / CELL);
  const ny = Math.ceil((y1 - y0) / CELL);
  let z = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = 0; i < position.count; i++) {
    let best = 0;
    let weight = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (w > weight) {
        weight = w;
        best = skinIndex.getComponent(i, k);
      }
    }
    if (!allowed.has(mesh.skeleton.bones[best].name)) continue;
    vertex(i, _a).applyMatrix4(mesh.matrixWorld).sub(origin);
    const ix = Math.floor((_a.x - x0) / CELL);
    const iy = Math.floor((_a.y - y0) / CELL);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
    if (_a.z > z[iy * nx + ix]) z[iy * nx + ix] = _a.z;
  }
  // spread each cell into its neighbours, so gaps between vertices leave no holes
  for (let pass = 0; pass < 1; pass++) {
    const out = new Float32Array(z);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        let m = z[iy * nx + ix];
        if (ix > 0) m = Math.max(m, z[iy * nx + ix - 1]);
        if (ix < nx - 1) m = Math.max(m, z[iy * nx + ix + 1]);
        if (iy > 0) m = Math.max(m, z[(iy - 1) * nx + ix]);
        if (iy < ny - 1) m = Math.max(m, z[(iy + 1) * nx + ix]);
        out[iy * nx + ix] = m;
      }
    }
    z = out;
  }
  return { bone, x0, y0, nx, ny, z };
}
const _qFoot = new THREE.Quaternion();
const _e = new THREE.Euler();
const _rollV = new THREE.Vector3();
const _rollBall = new THREE.Vector3();
const _rollAxis = new THREE.Vector3();
const _rollP = new THREE.Vector3();

const clamp01 = (x) => Math.min(1, Math.max(0, x));
/**
 * How far to raise something that is `short` below where it may go: all of it once it is well
 * short, nothing once it is well clear, and in between (within `soft`) a smooth curve, so
 * that raising it never starts or stops with a jolt.
 */
const easeUp = (short, soft) => (short <= -soft ? 0 : short >= soft ? short : (short + soft) ** 2 / (4 * soft));
const ease = (x) => x * x * (3 - 2 * x);
const mix = THREE.MathUtils.lerp;
/** Frame-rate independent approach of `value` to `target`. */
export const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));
/**
 * A value that eases towards its target without a sudden start or stop (critically damped).
 * `time` is roughly how long it takes to get there.
 */
export class Smooth {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  to(target, time, dt, maxSpeed = Infinity) {
    if (dt <= 0) return this.x;
    const omega = 2 / Math.max(1e-4, time);
    const k = omega * dt;
    const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const limit = maxSpeed * time;
    const change = Math.min(limit, Math.max(-limit, this.x - target));
    const goal = this.x - change;
    const temp = (this.v + omega * change) * dt;
    this.v = (this.v - omega * temp) * decay;
    let next = goal + (change + temp) * decay;
    if (target - this.x > 0 === next > target) {
      next = target; // never overshoot
      this.v = 0;
    }
    this.x = next;
    return next;
  }
}
/** Brings an angle into -PI..PI. */
export const wrapAngle = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * Two-bone IK. Finds the middle joint between `root` and `target` for bone lengths l1 and l2,
 * bending towards `pole`. `end` receives the reachable end point (the target, clamped).
 */
function solveTwoBone(root, target, l1, l2, pole, mid, end, keep = null) {
  _a.subVectors(target, root);
  const dist = _a.length();
  const reach = THREE.MathUtils.clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  if (dist > 1e-6) _a.divideScalar(dist);
  else _a.set(0, -1, 0);
  end.copy(root).addScaledVector(_a, reach);
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (keep) {
    // (a pole that lines up with the limb says nothing about which way the joint bends: there the
    // last frame's bend is kept, so the elbow does not flip round for a frame; pass R3, found as a
    // one-frame 146-degree roll of the left upper arm in the shotgun-to-rifle swap)
    const sure = THREE.MathUtils.smoothstep(_b.length() / Math.max(1e-6, pole.length()), 0.05, 0.25);
    if (keep.lengthSq() > 0.5 && sure < 1) {
      _b.normalize().multiplyScalar(sure).addScaledVector(keep.addScaledVector(_a, -keep.dot(_a)).normalize(), 1 - sure);
    }
  }
  if (_b.lengthSq() < 1e-8) _b.set(0, -1, 0).addScaledVector(_a, _a.y);
  _b.normalize();
  if (keep) keep.copy(_b);
  mid.copy(root).addScaledVector(_a, along).addScaledVector(_b, out);
}

/** Rotation that sends the rest X axis to `x` and the rest Y axis to `y` (unit, perpendicular). */
function quatFromXY(out, x, y) {
  _z.crossVectors(x, y);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, _z));
}

const newFoot = (side) => ({
  side,
  // held still on the ground through a stance (see LOCK)
  held: false,
  heldBall: new THREE.Vector3(), // where the ball of the foot is held, world
  heldYaw: 0, // the foot's heading while held, world
  wait: false, // let go before the clip lifted it: not to be caught again until it does
  catchT: 0, // s since it was let go
  catchH: 0, // how high it is picked up to catch up with the clip's path (m)
  roll: 0, // how far it has rolled up onto its ball beyond the clip (rad, about the foot's X)
  place: new Smooth(), // how much further out than usual this step puts it down (m)
  placeGoal: 0,
  rolled: new Smooth(),
  rollUp: 1, // which way round about X lifts the heel
  ball: new THREE.Vector3(), // where the clip has the ball of the foot, world
  ballPrev: new THREE.Vector3(),
  ballVel: new THREE.Vector3(),
  out: new THREE.Vector3(), // where the ball of the foot ended up
  offX: new Smooth(), // let go: the gap back to the clip's path, closing
  offZ: new Smooth(),
  offY: new Smooth(), // (and in height: a foot in the air does not drop or rise with a change of blend)
  offYaw: new Smooth(),
  swing: 0, // 1 = in the air, so free to be moved out of the other foot's way
  air: new Smooth(), // the same, eased without a sudden start: how far the toes are lifted clear
  push: 0, // how far it is being moved out of the way (m, outwards)
  share: 0.5, // its share of that between the two feet
  pushed: new Smooth(),
  correct: 0, // heading correction applied to the clip's foot (rad)
  jump: new THREE.Vector3(), // how far the clips' target moved this frame from a change of blend, not of phase
  pos: new THREE.Vector3(), // planted ankle, world
  yaw: 0, // planted heading, world
  from: new THREE.Vector3(),
  fromYaw: 0,
  stepping: false,
  u: 0,
  lift: 0,
  error: 0,
  w: 1, // 1 = planted, 0 = following the clip
  clipLift: 0, // how far off the ground the clip has this foot (m)
  contact: 1, // how much the clip has this foot on the ground, 0..1
  loopContact: 1, // the same, the loops alone (not a transition)
  clipYaw: 0, // the clips' heading for the foot, world (rad; 0 looks down -Z)
  clipYawRate: 0,
  // what the clip wants this frame, in world space
  ankle: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  // the ground under it (ground.js): height (eased while in the air, looking ahead along its swing, so
  // it rises over a step's edge before it gets there), and the surface's normal where it stands
  gnd: new Smooth(),
  landG: 0, // the ground where it will come down (m)
  landT: Infinity, // s until it comes down, looked ahead to
  landS: new Smooth(), // landG, eased
  liftG: 0, // the ground it left (m)
  airT: 0, // s in the air
  inAir: false,
  back: new Smooth(), // (m) held back behind a riser while still below the tread ahead
  wasDown: true,
  edge: new Smooth(), // the ground under its final place in the air, eased up (m)
  clear: new Smooth(), // (m) lifted further in the air for the ground just ahead of it
  // (m, world) moved fore or aft as it comes down so the whole sole lands on one tread, not on a
  // step's edge (ground.js: steps, kerb)
  treadX: new Smooth(),
  treadZ: new Smooth(),
  normal: new THREE.Vector3(0, 1, 0),
  raise: 0, // (m) the ball lifted so the sole bridges a hollow under it (_soleFit)
  tilt: new THREE.Quaternion(),
});

/**
 * The belt kit (a magazine pouch and shell loops) from the clip notes' shapes, in the Hips joint's
 * frame: modelled in blender/rifle_motion/pouch.py, built the same here so the reloads' hand goes to
 * something.
 */
function buildKit(shapes) {
  const kit = new THREE.Group();
  kit.name = 'kit';
  const mats = new Map(); // ((V4) one material per colour, so batch.js merges the parts: 10 draws a pass -> 4)
  for (const shape of shapes) {
    let geometry;
    if (shape.kind === 'box') geometry = new THREE.BoxGeometry(...shape.size);
    else if (shape.kind === 'band') {
      // an elliptic belt: size = inner half-width, inner half-depth, height, thickness; at = (0, y,
      // the ellipse's centre z) (blender/rifle_motion/pouch.py)
      const [a, b, h, t] = shape.size;
      const outline = new THREE.Shape().absellipse(0, 0, a + t, b + t, 0, Math.PI * 2, false, 0);
      outline.holes.push(new THREE.Path().absellipse(0, 0, a, b, 0, Math.PI * 2, true, 0));
      geometry = new THREE.ExtrudeGeometry(outline, { depth: h, bevelEnabled: false, curveSegments: 48 });
      // (extruded along +z: stood up so the band's height runs along y, centred)
      geometry.translate(0, 0, -h / 2).rotateX(Math.PI / 2);
    } else geometry = new THREE.CylinderGeometry(shape.size[0], shape.size[0], shape.size[1], 12);
    const key = shape.colour.join(',');
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(...shape.colour), roughness: 0.85 }));
    const material = mats.get(key);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = shape.name || '';
    mesh.position.fromArray(shape.at);
    if (shape.yaw) mesh.rotation.y = THREE.MathUtils.degToRad(shape.yaw);
    mesh.castShadow = true;
    kit.add(mesh);
  }
  batchModel(kit, { far: false });
  return kit;
}

export class Character {
  constructor(scene, motion) {
    this.motion = motion;
    this.root = new THREE.Group(); // stands on the ground, faces -Z
    this.root.name = 'character';
    this.model = new THREE.Group(); // EarthOnline bodies face +Z, so they are turned round
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    scene.add(this.root);

    this.eye = new THREE.Vector3(0, 1.6, 0); // right eye, world
    this.chestPos = new THREE.Vector3(0, 1.22, 0); // Spine2 joint, world
    this.chestQuat = new THREE.Quaternion();
    // where the clips carry the gun: its butt and turn in the chest joint's frame (see poseBody)
    this.gunPos = new THREE.Vector3();
    this.gunQuat = new THREE.Quaternion();
    this.firstPerson = false;
    this.bones = null;
    this.entry = null;

    // gait state
    this.phase = 0; // cycles; 0 = the left foot lands
    this.stride = 1; // how much longer than the clip's each step is
    this.plant = 1; // 1 = feet planted in the world, 0 = feet follow the clip
    this.feet = [newFoot('Left'), newFoot('Right')];

    this._loader = new GLTFLoader();
    this._bodies = new Map(); // file -> loaded body
    this._body = null;
    this._pose = new Pose();
    this._pose2 = new Pose(); // the same with last frame's blend
    this._time = 0;
    this._planted = false;
    this.stance = null; // (V6) { Left: {x, z, yaw}, Right } world: where the standing feet are stepped to instead
    this.stanceStepTime = null; // ((V10) s per step into that stance (null: STEP_TIME))
    this._backS = new Smooth();
    this._stride = new Smooth(1);
    this._effort = new Smooth(); // how hard the body is going: ground speed over its pace (m/s)
    this._ahead = new Smooth(1); // how far the way of travel is straight ahead, for the sprint
    // this step's share of the usual: length, swing of shoulders and pelvis, weight (see VARY)
    this._vary = Object.fromEntries(Object.keys(VARY).map((key) => [key, Object.assign(new Smooth(1), { goal: 1 })]));
    this._low = new Smooth(); // how far the hips are lowered so the stance legs stay bent (m)
    this._legLength = 0.78; // hip to ankle, set by the body in use
    this._crossed = false; // the legs are crossed over, left foot to the right of the right
    this._across = 0; // how far apart the feet were across the legs last frame (m)
    this._strafe = true; // facing the view rather than the way of travel
    this._toe = new THREE.Vector3(); // ball of the foot from the ankle, foot frame
    // how much of each direction's walk and jog clip is playing, eased
    this._dirW = motion.walks.map(() => new Smooth());
    // the blend this frame and last frame: idle, walk, jog and sprint shares, and each
    // direction's share of the walk and the jog
    // (and the transition's share: see _moveShare)
    const newBlend = () => ({
      idle: 1, walk: 0, jog: 0, sprint: 0, move: 0, fade: 0, crouch: 0, cm: 0, dir: motion.walks.map(() => 0), ready: false,
      copy(o) {
        Object.assign(this, { idle: o.idle, walk: o.walk, jog: o.jog, sprint: o.sprint, move: o.move, fade: o.fade, crouch: o.crouch, cm: o.cm, ready: true });
        this.dir.splice(0, this.dir.length, ...o.dir);
        return this;
      },
    });
    this._blendNow = newBlend();
    this._blendBefore = newBlend();
    this._legB = newFoot('Left'); // scratch: one leg as last frame's blend had it
    // The transition playing (player.js / moves.js: a Move), or the last one while it fades out
    // after being let go of, and its share of the pose.
    this._move = null;
    this._moveW = 0;
    this._fading = null; // (one let go of for another, fading out)
    this._fadeW = 0;
    // the foot that landed this frame in the loops ('Left', 'Right' or null): a stop or an
    // about-turn begins on it
    this.landed = null;
    this._forward = motion.walks.findIndex((clip) => Math.abs(clip.direction) < 1e-3);
    // secondary motion: what every footfall does to the upper body, the dip when the body
    // brakes or pushes off, and where an idle head wanders
    this.life = { yaw: 0, roll: 0, nod: 0, step: 0, footfall: false };
    this._stepPhase = 0;
    this._alive = null;
    this._settleX = 0;
    this._settleV = 0;
    this._lastSpeed = 0;
    this._rootQuat = new THREE.Quaternion();
    this._modelQuat = new THREE.Quaternion();
    // The handling clip playing (poseBody's s.action), sampled: `sample` in the chest's frame, and
    // what the game needs of it in the world (the palms and elbows) once the body is posed.
    this.act = {
      on: false,
      sample: new ActionSample(),
      palm: [new THREE.Vector3(), new THREE.Vector3()], // left, right
      hand: [new THREE.Quaternion(), new THREE.Quaternion()],
      elbow: [new THREE.Vector3(), new THREE.Vector3()],
    };
    this._aimPose = {}; // this frame's blend of the aiming poses: bone -> local rotation
    this.aimPocket = new THREE.Vector3(); // where they put the butt (chest frame, track terms)
    this._aimShare = 0;
    this.aimSupport = new THREE.Quaternion(); // and the support hand's turn on the gun
    // A hit reaction playing (poseBody's s.hit), sampled like a handling clip.
    this.hitAct = { on: false, sample: new ActionSample() };
    // The face: where the eyes look (yaw / pitch in the head's frame, rad), what they are fixed on,
    // the blinks, and counts for the review (review.js eyes columns).
    this.face = {
      yaw: new Smooth(), pitch: new Smooth(), fixYaw: 0, fixPitch: 0, dartYaw: 0, dartPitch: 0, nextDart: 0.5,
      blink: 0, blinkDepth: 1, blinkLength: 0.13, nextBlink: 2.5, sinceBlink: 0, brow: 0,
      saccades: 0, blinks: 0, worldYaw: 0, inPitch: 0, sinceSaccade: 0, lastYaw: 0, lastPitch: 0, leadYaw: 0, leadPitch: 0,
    };
    this._lookYaw = new Smooth();
    this._lookPitch = new Smooth();
    this._gaze = null; // poseBody's s.gaze, for poseArms (the eyes go on last, once the head is seated)
    this._faceDt = 0;
    // The crouch (player.js): how far crouched, 0..1, and going down into it or coming up from it
    // standing ({ clip, t, w }: the authored rifle-crouch-down / -up and its share of the pose)
    this.crouch = 0;
    this._crouchMove = null;
    // The ground under the body (ground.js): the root rides at the lower foot's ground plus a share
    // of the difference, eased, so the pelvis rises and falls smoothly over steps and slopes;
    // `grade` is the slope along the facing (+ uphill)
    this._bodyY = new Smooth();
    this._rootVel = new THREE.Vector3();
    this._phaseRate = 0;
    this._poseAhead = new Pose();
    this._legAhead = newFoot('Left');
    this.grade = 0;
    this._grade = new Smooth();
    this.locoGunPos = new THREE.Vector3(); // the carried gun as the gait clips hold it, before an action
    this.locoGunQuat = new THREE.Quaternion();
  }

  /**
   * Swaps in one of the ROSTER bodies, loading it the first time it is asked for. `motion` is the
   * clip pack the entry names (main.js loads one Motion per pack).
   */
  async use(entry, base, motion = this.motion) {
    let body = this._bodies.get(entry.file);
    if (!body) {
      const json = (name) => (name ? fetch(base + name).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`could not load ${name}`)))) : null);
      // (fetched, then parsed: the start-up marks tell the two apart; pass F2)
      performance.mark(`load:${entry.file}-fetch-start`);
      const bytes = fetch(base + entry.file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`could not load ${entry.file}`))));
      const [buffer, frames, table] = await Promise.all([bytes, json(entry.frames), json(entry.table)]);
      performance.mark(`load:${entry.file}-fetched`);
      const gltf = await this._loader.parseAsync(buffer, base);
      performance.mark(`load:${entry.file}-parsed`);
      const scene = gltf.scene;
      let mesh = null;
      scene.traverse((o) => {
        if (o.isSkinnedMesh) {
          mesh = o;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // its bounds are for the rest pose
          for (const key of ['map', 'normalMap', 'roughnessMap']) {
            if (o.material[key]) o.material[key].anisotropy = 8;
          }
        }
      });
      // the adapter: the proxy skeleton the layers pose (old names, canonical frames) and the real one
      const rig = new Rig(scene, frames, table);
      const bones = rig.proxy;
      for (const name of ['Hips', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', ...CHAIN]) {
        if (!bones[name]) throw new Error(`${entry.file} has no bone for "${name}" (${UE5_OF[name]})`);
      }
      const length = (from, to) => bones[to].position.length() || bones[from].position.distanceTo(bones[to].position);
      // The face layer by what the body has (pass F2), each part on its own: eye turning needs the eye
      // bones (and the table not saying otherwise: `face: false` turns them off), blinks (and the lids'
      // share of the aim squint and the shot blink) the two blink morphs, the brow and the mouth their
      // own morphs. (Before, all of it needed eye bones and morphs, so a body with blink morphs and
      // painted eyes, the Tripo player, never blinked.)
      const morphs = (mesh && mesh.morphTargetDictionary) || {};
      const hasMorphs = (...keys) => keys.every((k) => morphs[k] !== undefined);
      const faceParts = {
        eyes: table.face !== false && !!(bones.LeftEye && bones.RightEye),
        blink: hasMorphs('eyeBlinkLeft', 'eyeBlinkRight'),
        brow: hasMorphs('browDownLeft', 'browDownRight'),
        mouth: hasMorphs('mouthFrownLeft', 'mouthFrownRight'),
      };
      const face = faceParts.eyes || faceParts.blink || faceParts.brow || faceParts.mouth ? faceParts : null;
      body = {
        scene,
        bones,
        rig,
        table,
        mesh,
        face,
        // the aiming eye: the point welded behind the sight, in the head's (canonical) frame
        eyeLocal: new THREE.Vector3().fromArray(table.eye.sight),
        // the eyes (EarthOnline): their places in the head and rest turns (canonical: identity); their
        // bones sit at the eyeballs' centres, so they turn about them as they are
        eyePos: { LeftEye: bones.LeftEye ? bones.LeftEye.position.clone() : null, RightEye: bones.RightEye ? bones.RightEye.position.clone() : null },
        eyeRest: { LeftEye: bones.LeftEye ? new THREE.Quaternion() : null, RightEye: bones.RightEye ? new THREE.Quaternion() : null },
        headRest: new THREE.Quaternion(), // the head's canonical rest turn, model frame
        upperArm: length('LeftArm', 'LeftForeArm'),
        foreArm: length('LeftForeArm', 'LeftHand'),
        // (each arm its own: the Tripo body's right forearm is 3 mm longer than its left)
        arms: Object.fromEntries(['Left', 'Right'].map((side) => [side, { upper: length(side + 'Arm', side + 'ForeArm'), fore: length(side + 'ForeArm', side + 'Hand') }])),
        thigh: length('LeftUpLeg', 'LeftLeg'),
        legLength: length('LeftUpLeg', 'LeftLeg') + length('LeftLeg', 'LeftFoot'),
        shin: length('LeftLeg', 'LeftFoot'),
        fingers: Object.keys(bones).filter((name) => FINGERS.some((finger) => name.includes('Hand' + finger))),
        fields: [],
        pocket: new THREE.Vector3(table.pocket.x, table.pocket.y, 0.07),
      };
      // the body in its canonical pose (arms down, palms forward), for reading its surface
      performance.mark(`load:${entry.file}-surface-start`);
      rig.canonical();
      scene.updateMatrixWorld(true);
      if (mesh && mesh.geometry.attributes.skinIndex) {
        // which real bones count as chest and belly (the old joints' bones and their in-between ones)
        const chest = new Set(['spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'clavicle_l', 'clavicle_r']);
        const belly = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04']);
        body.fields.push(surfaceField(mesh, bones.Spine2, chest, -0.27, 0.27, -0.14, 0.32));
        body.fields.push(surfaceField(mesh, bones.Spine, belly, -0.25, 0.25, -0.3, 0.16));
        // The shoulder pocket: on the surface between chest and right shoulder, pressed in a little.
        const field = body.fields[0];
        const depth = field.z[Math.floor((table.pocket.y - field.y0) / CELL) * field.nx + Math.floor((table.pocket.x - field.x0) / CELL)];
        if (Number.isFinite(depth)) body.pocket.z = depth - table.pocket.press;
      }
      performance.mark(`load:${entry.file}-surface-end`);
      // the belt kit, on the pelvis's canonical frame (the old Hips joint's: the proxy's)
      body.kit = buildKit(motion.pouch);
      bones.Hips.add(body.kit);
      // (the pouch's magazine, in the Hips joint's frame: where a reload's hand goes for it)
      const mag = motion.pouch.findIndex((shape) => shape.name === 'pouch_mag');
      body.kitCentre = (body.kit.children[mag] || body.kit.children[0] || body.kit).position.clone();
      this._bodies.set(entry.file, body);
    }
    if (this._body) this.model.remove(this._body.scene);
    this._body = body;
    this.bones = body.bones;
    this.rig = body.rig;
    this.rig.reset();
    this._legLength = body.legLength;
    this.entry = entry;
    this.motion = motion;
    this._fit(body.table);
    this.model.add(body.scene);
    this.setFirstPerson(this.firstPerson);
    return entry;
  }

  /** The body's measurements into the layers' constants (character.js, weapon.js and review.js read them). */
  _fit(table) {
    PALM_LOCAL.fromArray(table.palm);
    ANKLE_HEIGHT = table.foot.ankle;
    HEEL.fromArray(table.foot.heel);
    INDEX_TIP.fromArray(table.index.tip);
    INDEX_PAD.fromArray(table.index.pad);
    POCKET.x = table.pocket.x;
    POCKET.y = table.pocket.y;
    POCKET.press = table.pocket.press;
    TOE = table.foot.ballSole[3][2];
    HEEL_BACK_BALL = this.motion.rest.LeftToeBase.z - table.foot.heel[2];
    const out = table.stanceOut || 0;
    AIM_STANCE.Left.x = AIM_STANCE_OLD.Left.x - out;
    AIM_STANCE.Right.x = AIM_STANCE_OLD.Right.x + out;
  }

  /** The body's table (public/characters/<body>.game.json). */
  get table() {
    return this._body ? this._body.table : null;
  }

  /** Shrinks the head away so a camera at the eye does not look at the inside of it. */
  setFirstPerson(on) {
    this.firstPerson = on;
    if (this.bones) this.bones.Head.scale.setScalar(on ? 0.001 : 1);
  }

  /**
   * How far `count` world-space `points` have to move along `dir` to be clear of the front
   * of the torso (clothes included) and of the thighs. `margin` is the gap to leave (m).
   */
  clearance(points, count, dir, margin) {
    const body = this._body;
    let need = 0;
    for (const field of body.fields) {
      const world = field.bone.matrixWorld;
      _inv.copy(world).invert();
      const along = Math.max(0.35, _d.setFromMatrixColumn(world, 2).normalize().dot(dir));
      for (let i = 0; i < count; i++) {
        _c.copy(points[i]).applyMatrix4(_inv);
        const ix = Math.round((_c.x - field.x0) / CELL - 0.5);
        const iy = Math.round((_c.y - field.y0) / CELL - 0.5);
        if (ix < 0 || iy < 0 || ix >= field.nx || iy >= field.ny) continue;
        const surface = field.z[iy * field.nx + ix];
        if (_c.z < surface - 0.2) continue; // behind the back
        const inside = surface + margin - _c.z;
        if (inside > 0) need = Math.max(need, inside / along);
      }
    }
    const reach = 0.09 + margin; // thigh radius
    for (const side of ['Left', 'Right']) {
      this.bones[side + 'UpLeg'].getWorldPosition(_a);
      this.bones[side + 'Leg'].getWorldPosition(_b).sub(_a);
      const lengthSq = _b.lengthSq();
      for (let i = 0; i < count; i++) {
        const t = THREE.MathUtils.clamp(_c.subVectors(points[i], _a).dot(_b) / lengthSq, 0, 1);
        _c.addScaledVector(_b, -t); // from the nearest point on the thigh bone to the point
        const gap = _c.length();
        if (gap >= reach || gap < 1e-5) continue;
        need = Math.max(need, (reach - gap) / Math.max(0.35, _c.dot(dir) / gap));
      }
    }
    return Math.min(need, 0.2);
  }

  /**
   * Step 1: pelvis, legs, spine and head. Afterwards `eye`, `chestPos` and `chestQuat` say
   * where the rifle can go.
   *
   * s: {
   *   speed      ground speed (m/s)
   *   heading    direction of travel relative to the facing direction (rad, + = left)
   *   moving     the player is asking to move
   *   yawRate    how fast the body is turning (rad/s)
   *   strafe     the body faces where the camera looks instead of the way it is going
   *   aim        0 = rifle carried, 1 = shouldered
   *   ready      0 = low carry, 1 = high ready
   *   sprint     0..1
   *   lookYaw, lookPitch   where the head turns while the rifle is carried (rad)
   *   pitch      where the shouldered rifle points, relative to level (rad, + = up)
   *   twist      and relative to the facing direction (rad, + = left)
   *   leanPitch, leanRoll   whole-body lean from acceleration (rad)
   *   recoil     rocks the upper body back (rad)
   *   recoilTwist   drives the firing shoulder back (rad)
   *   alive      the Alive instance: weight shifts, stance, gaze and the rest (alive.js)
   *   gun        which gun is in the hands ('rifle' | 'shotgun'): its aiming poses
   *   action     null, or { clip, t, gun }: a handling clip (Motion.actions) at t seconds, laid
   *              over the upper body; `gun` 0..1, how far the gun in the hands follows its Gun track
   *              rather than the gait clips' hold (eased in and out at the ends)
   * }
   */
  poseBody(dt, s) {
    const b = this.bones;
    const body = this._body;
    const motion = this.motion;
    const clips = motion.clips;
    const holds = motion.holds;
    const pose = this._pose;
    const time = (this._time += dt);
    this._dt = dt;
    this._toe.copy(motion.rest.LeftToeBase);
    const alive = s.alive;
    this._alive = alive;
    // (the root's own velocity over the ground, for looking ahead to where a foot comes down)
    if (dt > 0 && this._rootLast) this._rootVel.subVectors(this.root.position, this._rootLast).divideScalar(dt).setY(0);
    (this._rootLast = this._rootLast || new THREE.Vector3()).copy(this.root.position);
    this._placeOnGround(dt);
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this._rootQuat);
    this.model.getWorldQuaternion(this._modelQuat);

    // ---- 1. which clips, and how fast they have to play to match the ground ----
    // The gait is chosen by how hard the body is going, not by ground speed alone: a jogged
    // side step covers less ground than a jog forward but is still a jog, not a fast walk (a
    // walk and a jog blended put a foot down at different moments).
    // (eased: reversing, the speed passes through nothing in a few frames, and the legs' swing
    // must not shrink to standing and spring back out again with a foot in the air, nor a jog
    // drop into the walk clips' quite different step for an instant: while the player still
    // wants to go, it falls slowly. Quicker on the way up: setting off into a jog, the walk
    // clips must not be driven at twice their pace while the effort catches up.)
    const v = s.speed;
    const wanted = v / (s.pace || 1);
    // A transition (turning on the spot, setting off, stopping, the about-turn) takes its share of
    // the pose from the loops; while it plays, they go on straight ahead underneath, so that the one
    // it hands over to is ready.
    const W = this._moveShare(dt, s.move);
    const F = this._fadeW;
    const loops = Math.max(0, 1 - W - F);
    const move = this._move;
    let effort = this._effort.to(wanted, wanted > this._effort.x ? 0.06 : s.moving ? 0.4 : 0.15, dt);
    // (and once they are out of sight under one that hands over to a loop, they are that loop
    // alone: let go of part way, it hands over to the loop it was heading for, not to a walk and a
    // jog stepping out of time with each other)
    if (s.move && s.move.exit && loops < 0.02) effort = this._effort.x = s.move.exit.gait === 'walk' ? SPEED.walk : SPEED.run;
    let wWalk = 0;
    let wRun = 0;
    let wSprint = 0;
    if (effort <= SPEED.walk) wWalk = effort / SPEED.walk;
    else if (effort <= SPEED.run) {
      wRun = (effort - SPEED.walk) / (SPEED.run - SPEED.walk);
      wWalk = 1 - wRun;
    } else {
      wSprint = clamp01((effort - SPEED.run) / (SPEED.sprint - SPEED.run));
      wRun = 1 - wSprint;
    }
    // The walk and the jog: the two direction clips either side of the way of travel, each eased
    // in and out, so that a change of direction cross-fades rather than jumps. All of them start
    // the cycle as the left foot lands and hold the same number of strides, so they stay in step.
    // Running (Shift) the body faces the way it goes, and the way of travel only leaves straight
    // ahead while it turns; the sprint is forward only, so through a turn its share goes to the
    // jog clips for the way the legs are actually going.
    const walks = motion.walks;
    const jogs = motion.jogs;
    const dir = s.move ? 0 : s.strafe ? s.heading : THREE.MathUtils.clamp(s.heading, -TURN_DIR, TURN_DIR);
    let total = 0;
    for (let i = 0; i < walks.length; i++) {
      const want = Math.max(0, 1 - Math.abs(wrapAngle(dir - walks[i].direction)) / (Math.PI / 4));
      total += this._dirW[i].to(want, 0.12, dt);
    }
    if (total < 1e-3) {
      total = 0;
      for (let i = 0; i < walks.length; i++) total += this._dirW[i].x = Math.max(0, 1 - Math.abs(wrapAngle(dir - walks[i].direction)) / (Math.PI / 4));
    }
    const ahead = this._ahead.to(Math.max(0, Math.cos(dir)) ** 2, 0.12, dt);
    wRun += wSprint * (1 - ahead);
    wSprint *= ahead;
    const gait = wWalk + wRun + wSprint;
    // How much of the travel is backwards (the aimed trunk comes upright backing away). Eased:
    // reversing through a standstill turns the heading round at once.
    const back = this._backS.to(s.strafe ? Math.max(0, -Math.cos(s.heading)) : 0, 0.15, dt);
    const blend = this._blendNow;
    blend.idle = (1 - gait) * loops;
    blend.walk = wWalk * loops;
    blend.jog = wRun * loops;
    blend.sprint = wSprint * loops;
    blend.move = W;
    blend.fade = F;
    // the crouch: its idle and walks take that share of the idle's and the walks' (Shift stands the
    // body up: no crouched jog or sprint); going down or coming up standing, the authored clip
    // takes its share of everything
    const crouch = (blend.crouch = this.crouch = THREE.MathUtils.clamp(s.crouch || 0, 0, 1));
    this._crouchMove = s.crouchMove || null;
    blend.cm = this._crouchMove ? this._crouchMove.w : 0;
    for (let i = 0; i < walks.length; i++) blend.dir[i] = this._dirW[i].x / total;
    if (gait > 1e-4) {
      let natural = wSprint * clips.sprint.speed;
      let duration = wSprint * clips.sprint.duration / clips.sprint.cycles;
      for (let i = 0; i < walks.length; i++) {
        const w = blend.dir[i];
        const cw = motion.crouch.walks[i];
        natural += w * (wWalk * mix(walks[i].speed, cw.speed, crouch) + wRun * jogs[i].speed);
        duration += w * (wWalk * mix(walks[i].duration / walks[i].cycles, cw.duration / cw.cycles, crouch) + wRun * jogs[i].duration / jogs[i].cycles);
      }
      duration /= gait;
      // Half of the mismatch is made up by stepping faster, half by stepping further (setting
      // off, stopping, a turn while running).
      const k = v / Math.max(natural, 1e-3);
      // (the gait outlasts the ground speed for a moment through a reversal: k can be 0)
      const quick = Math.max(Math.sqrt(k), 0.5);
      // (eased: the clips' blend shifting from jog to walk as the body slows would otherwise
      // change the length of a step with a foot in mid-swing)
      // (and no two steps quite the same length: what is taken off the length is made up in
      // quickness, so the feet still keep pace with the ground)
      const run = (wRun + wSprint) / gait;
      // (on a slope, up or down, the steps shorten and come quicker)
      const hillStep = 1 - 0.3 * Math.min(0.6, Math.abs(this.grade));
      this.stride = this._stride.to(THREE.MathUtils.clamp(k / quick, 0.3, mix(WALK_STRIDE, RUN_STRIDE, run)) * hillStep, 0.1, dt) * this._vary.stride.x;
      const rate = THREE.MathUtils.clamp(k / this.stride, 0.7, 1.6);
      this.phase += (rate * dt) / duration;
      this._phaseRate = rate / duration; // cycles a second, for looking ahead to a footfall (_landing)
    }
    // A transition that hands over to a loop brings the loop's cycle to where it takes over, kept
    // there while the loops are not seen (so that one let go of part way hands over in step too;
    // while they still show, as one begins, they keep their own)
    if (s.move && s.move.exit && loops < 0.02) {
      const loop = (move.exit.gait === 'walk' ? walks : jogs)[this._forward];
      this.phase = move.exit.phase - (move.duration - move.t) / (loop.duration / loop.cycles);
    }
    this._strafe = s.strafe;

    // ---- secondary motion ----
    // What every footfall does to the upper body when it is not the clips' own (shouldered, and
    // the view): the shoulders turn against the hips, the trunk tips over the standing leg and
    // nods a touch after each footfall. `step` is how hard the feet are landing.
    const life = this.life;
    const turn = Math.PI * 2 * this.phase;
    const vary = this._vary;
    life.step = wWalk + 1.4 * wRun + 2.2 * wSprint;
    life.yaw = Math.cos(turn) * 0.036 * life.step * vary.yaw.x;
    life.roll = -Math.sin(turn) * 0.016 * life.step * vary.roll.x;
    life.nod = Math.cos(2 * turn - 0.6) * 0.011 * life.step * vary.nod.x;
    // braking and pushing off both sink the hips for a moment
    if (dt > 0) {
      this._settleV += (-160 * this._settleX - 16 * this._settleV) * dt - Math.abs(v - this._lastSpeed) * 0.12;
      this._settleX = THREE.MathUtils.clamp(this._settleX + this._settleV * dt, -0.04, 0.012);
      this._lastSpeed = v;
    }
    const stepPhase = (((this.phase * 2 - 0.06) % 1) + 1) % 1; // 0 as a foot lands
    life.footfall = gait > 0.3 && Math.abs(stepPhase - this._stepPhase) > 0.5;
    this._stepPhase = stepPhase;
    // No two steps alike: each footfall sets how long, how hard and how far out the next one
    // goes, and how much the shoulders and pelvis swing with it, by a little, at random; each
    // eases there over most of a step, so nothing jumps and there is no rhythm to the change.
    if (life.footfall) {
      for (const key in VARY) vary[key].goal = 1 + (Math.random() * 2 - 1) * VARY[key];
      for (const foot of this.feet) foot.placeGoal = (Math.random() * 2 - 1) * VARY_PLACE;
    }
    for (const key in VARY) vary[key].to(vary[key].goal, 0.3, dt);
    for (const foot of this.feet) foot.place.to(foot.placeGoal, 0.3, dt);
    // looking about of its own accord (see alive.js), on top of following the view
    // (a turn on the spot or the about-turn looks where it goes by itself)
    const own = move && move.ownsLook ? W : 0;
    // (the head comes round a little after the view, on the neck: the eyes get there first, _face)
    const lookYaw = this._lookYaw.to(s.lookYaw * (1 - own) + alive.scanYaw, HEAD_LAG, dt);
    const lookPitch = this._lookPitch.to(s.lookPitch * (1 - own) + alive.scanPitch, HEAD_LAG, dt);

    // ---- 2. blend the clips ----
    this._blend(blend, time, pose);

    // ---- 3. where the clips put the feet, warped to the real speed ----
    // The same legs are also read with last frame's blend: whatever the target moved by because
    // the blend changed (setting off from the idle, a new direction, walk into jog), rather than
    // because the cycle went on, a foot in the air does not jump with; it carries on and closes
    // on the new target from there (see _holdFeet).
    const before = this._blendBefore;
    const changed = before.ready && this._blendChanged(blend, before);
    if (changed) this._blend(before, time, this._pose2);
    let landed = null;
    for (const foot of this.feet) {
      const side = foot.side;
      this._clipLeg(foot, foot, pose, blend);
      foot.jump.set(0, 0, 0);
      if (changed) {
        const was = this._legB;
        this._clipLeg(was, foot, this._pose2, before);
        foot.jump.subVectors(foot.ankle, was.ankle).applyQuaternion(this._modelQuat);
      }
      this._footToWorld(foot);
      // (the gait clips' own say: blended with the idle at a slow walk, the step is shorter,
      // but a foot still has to leave the ground to take it)
      let contact = 0;
      let shared = 0;
      this._each(blend, (clip, w) => {
        if (clip === clips.idle || clip === motion.crouch.idle) return;
        contact += w * motion.contact(clip, this.phase + clip.strike, side);
        shared += w;
      });
      const loop = shared > 1e-4 ? contact / shared : 1;
      // (a stop or an about-turn begins on a footfall of the loops)
      if (foot.loopContact < 0.5 && loop >= 0.5 && gait > 0.3 && W + F < 0.01) landed = side;
      foot.loopContact = loop;
      const k = foot === this.feet[0] ? 0 : 1;
      foot.contact = W + F > 0 ? loop * loops + (W > 0 ? W * this._moveDown(move, k) : 0) + (F > 0 ? F * this._moveDown(this._fading, k) : 0) : loop;
    }
    this.landed = landed;
    before.copy(blend);
    this._holdFeet(dt);

    // ---- 4. planted feet ----
    // (also through a quick turn at low speed: the feet step round rather than skate round)
    // (not while a transition has the feet: it puts them down itself)
    const wantPlant = W + F < 0.5 && ((v < 0.2 && !s.moving) || (!move && v < 0.7 && Math.abs(s.yawRate) > 2.5));
    if (wantPlant && !this._planted) {
      // Stopping: a foot on the ground stays where it is; one still on its way is not stopped
      // dead in the air but carried on into its place in the stance, a last settling step.
      for (const foot of this.feet) {
        _a.set(0, 0, 1).applyQuaternion(foot.quat);
        foot.yaw = Math.atan2(-_a.x, -_a.z);
        foot.pos.copy(foot.ankle);
        foot.lift = 0;
        foot.stepping = !foot.held;
        foot.u = 0;
        foot.from.copy(foot.ankle);
        foot.fromYaw = foot.yaw;
        // a foot up on its ball puts its heel down behind the ball, which stays where it is
        if (foot.held) foot.pos.copy(this._toe).applyQuaternion(_qFoot.setFromAxisAngle(UP, foot.yaw + Math.PI)).negate().add(foot.heldBall).setY(foot.gnd.x + ANKLE_HEIGHT);
      }
    }
    this._planted = wantPlant;
    this.plant = damp(this.plant, wantPlant ? 1 : 0, wantPlant ? 12 : 9, dt);
    // Setting off, a planted foot is already being held where it stands (see _holdFeet) and
    // stays there until the clip lifts it: the first step is a step, not a slide.
    for (const foot of this.feet) foot.w = damp(foot.w, wantPlant ? 1 : 0, wantPlant ? 12 : 16, dt);
    const yaw = this.root.rotation.y;
    let busy = false;
    for (const foot of this.feet) {
      const home = this._home(foot.side, s.aim);
      this.root.localToWorld(_home.set(home.x, ANKLE_HEIGHT, home.z));
      // (V6) or where something else wants the feet (vehicles.js: an entry clip's first frame), world
      // (only for a step begun once it is set: one already under way keeps its own target, or it would jump)
      const want = this.stance && (!foot.stepping || foot.stanceStep) ? this.stance[foot.side] : null;
      if (want) _home.set(want.x, 0, want.z);
      _home.y = groundAt(_home.x, _home.z) + ANKLE_HEIGHT; // (where it would stand: on the ground there)
      const homeYaw = want ? want.yaw : yaw + home.toe;
      if (foot.stepping) {
        // ((V10) the steps into a stance something else asked for (vehicles.js: the entry clip's first frame) at its own pace)
        foot.u = Math.min(1, foot.u + dt / (foot.stanceStep && this.stance && this.stanceStepTime ? this.stanceStepTime : STEP_TIME));
        const e = ease(foot.u);
        foot.pos.lerpVectors(foot.from, _home, e);
        foot.yaw = foot.fromYaw + wrapAngle(homeYaw - foot.fromYaw) * e;
        foot.lift = Math.sin(Math.PI * foot.u) * STEP_LIFT;
        if (foot.u >= 1) foot.stepping = false;
        else busy = true;
      }
      if (this._resetFeet) {
        // moved by hand (snapToGround): the feet are put where the stance has them, there
        foot.pos.copy(_home);
        foot.yaw = homeYaw;
        foot.stepping = false;
        foot.held = false;
        foot.heldBall.copy(this._toe).applyQuaternion(_qFoot.setFromAxisAngle(UP, homeYaw + Math.PI)).add(_home);
        foot.offX.x = foot.offX.v = foot.offZ.x = foot.offZ.v = foot.offY.x = foot.offY.v = 0;
        foot.treadX.x = foot.treadX.v = foot.treadZ.x = foot.treadZ.v = 0;
      }
      foot.error = foot.pos.distanceTo(_home) + Math.abs(wrapAngle(homeYaw - foot.yaw)) * 0.12;
    }
    this._resetFeet = false;
    if (!busy && this.plant > 0.5) {
      // one foot at a time: the one that is furthest from where it should be
      const foot = this.feet[0].error > this.feet[1].error ? this.feet[0] : this.feet[1];
      // a change of stance is stepped into even though the feet are not far out of place
      if (foot.error > (this.stance ? 0.012 : alive.restep > 0 || s.crouchChanging ? 0.03 : STEP_TRIGGER)) {
        foot.stepping = true;
        foot.stanceStep = !!this.stance;
        foot.u = 0;
        foot.from.copy(foot.pos);
        foot.fromYaw = foot.yaw;
      }
    }

    // ---- 5. pelvis ----
    // (the clips' own, with each step's sway and weight a little different)
    pose.get(BONE.Hips, _qHips);
    _hipsPos.copy(pose.hips);
    _hipsPos.x *= this._vary.sway.x;
    _hipsPos.y += (this._vary.hit.x - 1) * 0.012 * gait; // some footfalls come down harder
    // standing, the weight goes onto one leg: the pelvis moves over it and the other hip drops
    const shift = alive.weight * (1 - gait) * (1 - W);
    _hipsPos.x -= shift * 0.03;
    _hipsPos.y += this._settleX - Math.abs(shift) * 0.008;
    _hipsPos.z -= s.recoilTwist * 0.12 * s.aim; // a shot shoves the body back
    _qHips.premultiply(_q.setFromAxisAngle(_z.set(0, 0, 1), shift * -0.045));
    _hipsPos.y -= Math.max(0, this.stride - 1) * 0.1 * gait;
    // (into a hill going up, the body held back going down: ground.js's slope along the facing)
    const hill = this.grade > 0 ? 0.3 * this.grade : 0.2 * this.grade;
    _qLean.setFromEuler(_e.set(s.leanPitch + hill * Math.min(1, gait + 0.3), 0, s.leanRoll, 'XYZ')); // about the feet
    _hipsPos.applyQuaternion(_qLean);
    _qRes.copy(_qLean).multiply(_qHips); // the pelvis, for the aimed trunk to ride out
    _qPelvis.setFromAxisAngle(UP, -AIM_HIP_YAW * this.plant * s.aim).premultiply(_qLean).multiply(_qHips);
    // The hips come down as far as it takes for a leg with its foot on the ground to reach it
    // with the knee still bent: a stance leg is never pulled straight. (A foot in the air bends
    // its knee instead; see _leg.)
    // Before that, a held foot the hip has moved away from rolls up onto its ball, heel
    // first: the push-off of a step, which shortens the leg without the foot moving.
    let low = 0;
    const reach = (body.thigh + body.shin) * BENT_REACH;
    for (const foot of this.feet) {
      this.model.localToWorld(_hip.copy(b[foot.side + 'UpLeg'].position).applyQuaternion(_qPelvis).add(_hipsPos));
      this._rollOff(foot, _hip, reach, dt);
      _target.copy(foot.pos).setY(foot.pos.y + foot.lift).lerp(foot.ankle, 1 - foot.w);
      const across = Math.hypot(_hip.x - _target.x, _hip.z - _target.z);
      const need = _hip.y - _target.y - Math.sqrt(Math.max(0, reach * reach - across * across));
      low = Math.max(low, need * (1 - foot.swing));
    }
    low = Math.min(low, LOW_MAX + Math.abs(this.feet[0].gnd.x - this.feet[1].gnd.x));
    _hipsPos.y -= this._low.to(low, low > this._low.x ? 0.06 : 0.16, dt);
    b.Hips.position.copy(_hipsPos);
    b.Hips.quaternion.copy(_qPelvis);

    // the handling clip, if one is playing
    const act = this.act;
    act.on = !!s.action;
    if (act.on) motion.sampleAction(s.action.clip, s.action.t, act.sample);
    const actPose = act.sample.pose;

    // the shouldered pose for where the gun points: the authored level pose and the one 45 degrees
    // up or down, blended; past them the trunk bends by the rest (AIM_PITCH)
    const aims = motion.aims[s.gun || 'rifle'];
    const toward = s.pitch >= 0 ? aims.up : aims.down;
    const share = THREE.MathUtils.clamp(s.pitch / toward.pitch, 0, 1);
    const pastPitch = s.pitch - share * toward.pitch;
    const aimPose = this._aimPose;
    for (const name of [...CHAIN, 'LeftShoulder', 'RightShoulder']) (aimPose[name] = aimPose[name] || new THREE.Quaternion()).slerpQuaternions(aims.level[name], toward[name], share);
    this.aimPocket.lerpVectors(aims.level.gun.pos, toward.gun.pos, share);
    this._aimShare = s.pitch >= 0 ? share : -share; // (-1 aimed 45 down .. 1 aimed 45 up: the cheek weld's per-pitch values)
    // (pass F2, per body: table cheek.lift, liftUp, liftDown: chest frame, m) the stock brought up in
    // the pocket to the face rather than only the face down to it, level and the more for each 45
    // degrees aimed up or down; the firing-side clavicle raised with it (the shoulder shrugged up
    // under the butt, cheek.liftDeg degrees at full lift, about its front-back axis)
    const cheekT = this.table && this.table.cheek;
    if (cheekT && (cheekT.lift || cheekT.liftUp || cheekT.liftDown)) {
      const more = s.pitch >= 0 ? cheekT.liftUp : cheekT.liftDown;
      _a.fromArray(cheekT.lift || [0, 0, 0]);
      if (more) _a.addScaledVector(_b.fromArray(more), share);
      this.aimPocket.add(_a);
      if (cheekT.liftDeg) aimPose.RightShoulder.premultiply(_q.setFromAxisAngle(Z_AXIS, -THREE.MathUtils.degToRad(cheekT.liftDeg)));
    }
    this.aimSupport.slerpQuaternions(aims.level.support, toward.support, share);

    // ---- 6. spine, neck and head ----
    // Both layers are built as rotations in the model's frame, blended there, and only then
    // turned into joint rotations, so the aiming upper body stays put whatever the hips do.
    const breath = Math.sin(time * 1.7);
    const breathe = breath * 0.011;
    const LIFE = [0.3, 0.6, 1, 0.5, 0.12]; // how much of the footfall each joint shows; the head rides it out
    // a shot rocks the trunk back and drives the firing shoulder away
    _qRecoil.setFromEuler(_e.set(-s.recoil * s.aim, -s.recoilTwist * s.aim, 0, 'YXZ'));
    _qAuthCum.copy(_qPelvis);
    _qAimCum.identity();
    _qParent.copy(_qPelvis);
    for (let i = 0; i < CHAIN.length; i++) {
      const name = CHAIN[i];
      // (the low hold looks down at the rifle; the head stays up instead, eyes on the horizon)
      if (i < 3) _qHold.copy(holds.low[name]).slerp(holds.hip[name], s.ready);
      else _qHold.copy(holds.hip[name]);
      // carried: the clips' own spine (authored around the gun), the high hold's difference on
      // top, the head turning to follow the view
      pose.get(BONE[name], _qA);
      if (i < 3) _qA.multiply(_q.copy(holds.low[name]).invert().multiply(_qHold));
      // a handling clip: its difference from the low hold, on top
      if (act.on) _qA.multiply(_q.copy(holds.low[name]).invert().multiply(actPose.get(BONE[name], _qRel)));
      _qAuthCum.multiply(_qA);
      // (and each step's own small differences: no two strides carry the trunk alike)
      const own = gait * LIFE[i];
      _qCarry
        .setFromEuler(_e.set(-lookPitch * LOOK_PITCH[i] + (vary.nod.x - 1) * 0.03 * own, lookYaw * LOOK_YAW[i] + (vary.yaw.x - 1) * 0.05 * own, (i === 3 ? alive.tilt : 0) + (vary.roll.x - 1) * 0.04 * own, 'YXZ'))
        .multiply(_qAuthCum);
      // aiming: the hold, pitched and twisted onto the target
      _qAimCum.multiply(aimPose[name]);
      _qAim.setFromEuler(
        _e.set(-pastPitch * AIM_PITCH[i] + (i < 3 ? breathe : 0) + life.nod * LIFE[i] * 0.4, s.twist * AIM_TWIST[i] + life.yaw * LIFE[i] * 0.4, life.roll * LIFE[i] * 0.4, 'YXZ'),
      );
      _qAim.multiply(_q.copy(IDENTITY).slerp(_qRes, AIM_WOBBLE[i])).multiply(_qAimCum);
      _qEnd.copy(_qCarry).slerp(_qAim, s.aim).premultiply(_qRecoil);
      // (the clips come upright backing away by themselves; the aim does not)
      if (back > 0) _qEnd.premultiply(_q.setFromAxisAngle(X_AXIS, -back * BACK_LEAN[i] * s.aim));
      b[name].quaternion.copy(_qParent).invert().multiply(_qEnd);
      _qParent.copy(_qEnd);
    }
    for (const name of ['LeftShoulder', 'RightShoulder']) {
      // carried: the clips' shoulders (they breathe in rifle-idle) and the high hold's difference;
      // aiming, the aim hold, rising and falling with the breath
      _qHold.copy(holds.low[name]).slerp(holds.hip[name], s.ready);
      _qA.copy(holds.low[name]).invert().multiply(_qHold).premultiply(pose.get(BONE[name], _q));
      if (act.on) _qA.multiply(_q.copy(holds.low[name]).invert().multiply(actPose.get(BONE[name], _qRel)));
      b[name].quaternion.copy(_qA).slerp(aimPose[name], s.aim);
      const side = name === 'LeftShoulder' ? 1 : -1;
      b[name].quaternion.multiply(_q.setFromAxisAngle(_z.set(0, 0, 1), side * ((breath + 1) * 0.012 * s.aim + alive.shrug * 0.085)));
    }
    // a hit reaction: its difference from the low hold on top of everything, carried or shouldered
    // (each joint's own turn, so a chest knocked back takes the neck and head with it)
    const hit = this.hitAct;
    hit.on = !!s.hit;
    // (crouched, braced low on bent legs, a blow moves the trunk and the gun less)
    const hitW = s.hit ? s.hit.w * (1 - 0.3 * this.crouch) : 0;
    if (hit.on) {
      motion.sampleAction(s.hit.clip, s.hit.t, hit.sample);
      for (const name of [...CHAIN, 'LeftShoulder', 'RightShoulder']) {
        hit.sample.pose.get(BONE[name], _qA);
        _q.copy(holds.low[name]).invert().multiply(_qA);
        b[name].quaternion.multiply(_qA.identity().slerp(_q, hitW));
      }
    }
    this.model.updateMatrixWorld(true);

    // The carried gun: where the blended clips hold it, and for the high ready the authored high
    // hold's difference on top, as the spine above takes it.
    const lowGun = holds.low.gun;
    const highGun = holds.hip.gun;
    this.gunPos.subVectors(highGun.pos, lowGun.pos).multiplyScalar(s.ready).add(pose.gun);
    _q.copy(lowGun.quat).invert().multiply(highGun.quat);
    this.gunQuat.copy(pose.get(GUN, _qA)).multiply(_qRel.identity().slerp(_q, s.ready));
    this.locoGunPos.copy(this.gunPos);
    this.locoGunQuat.copy(this.gunQuat);
    if (act.on && s.action.gun > 0) {
      this.gunPos.lerp(actPose.gun, s.action.gun);
      this.gunQuat.slerp(act.sample.gunQuat, s.action.gun);
    }
    if (hit.on) {
      // (and the gun knocked off its hold and brought back, as the clip has it)
      this.gunPos.addScaledVector(_a.subVectors(hit.sample.pose.gun, lowGun.pos), hitW);
      _q.copy(lowGun.quat).invert().premultiply(hit.sample.gunQuat);
      this.gunQuat.premultiply(_qA.identity().slerp(_q, hitW));
    }

    // The eye is read from the head joint, not the eye bone, so first person's shrunken head
    // does not move it.
    b.Head.getWorldQuaternion(_q);
    b.Head.getWorldPosition(this.eye).add(_a.copy(body.eyeLocal).applyQuaternion(_q));
    b.Spine2.getWorldPosition(this.chestPos);
    b.Spine2.getWorldQuaternion(this.chestQuat);
    if (act.on) {
      // the clip's palms and elbows, from the chest's frame into the world
      const nodes = act.sample.nodes;
      [nodes.PalmL, nodes.PalmR].forEach((node, k) => {
        act.palm[k].copy(node.pos).applyQuaternion(this.chestQuat).add(this.chestPos);
        act.hand[k].copy(this.chestQuat).multiply(node.quat);
      });
      // The reloads reach for the belt kit where it is standing, in the chest's frame. Crouched, the
      // pelvis tips and the trunk leans, so the kit sits elsewhere against the chest: the support
      // hand, near the kit, goes where it is now (by the kit's move against the chest since the
      // body last stood, faded out over 8 to 32 cm from it; the reloads only).
      const kitNow = _c.copy(body.kitCentre).applyMatrix4(b.Hips.matrixWorld).sub(this.chestPos).applyQuaternion(_q.copy(this.chestQuat).invert());
      if (this.crouch > 0 && this._kitStand && s.action.clip.name.startsWith('reload-')) {
        const near = 1 - THREE.MathUtils.smoothstep(nodes.PalmL.pos.distanceTo(this._kitStand), 0.08, 0.32);
        if (near > 0) act.palm[0].addScaledVector(_d.subVectors(kitNow, this._kitStand).applyQuaternion(this.chestQuat), near);
      }
      [nodes.ElbowL, nodes.ElbowR].forEach((node, k) => act.elbow[k].copy(node.pos).applyQuaternion(this.chestQuat).add(this.chestPos));
    }
    if (body.kitCentre && this.crouch < 0.01) {
      // (where the kit sits against the chest standing, kept for the crouch)
      (this._kitStand = this._kitStand || new THREE.Vector3()).copy(body.kitCentre).applyMatrix4(b.Hips.matrixWorld).sub(this.chestPos).applyQuaternion(_q.copy(this.chestQuat).invert());
    }

    // ---- 7. legs ----
    for (const foot of this.feet) {
      const p = foot.w;
      const home = this._home(foot.side, s.aim);
      _target.copy(foot.pos);
      _target.y += foot.lift;
      _target.lerpVectors(foot.ankle, _target, p);
      // planted knees point where the toes do, a little outwards
      _pole.set(home.x * 0.8, 0.15, -1).applyQuaternion(this._rootQuat);
      _pole.lerpVectors(foot.pole, _pole, p);
      _qFoot.setFromAxisAngle(UP, foot.yaw + Math.PI);
      if (home.pitch > 0 && p > 0) {
        // crouched, the rear foot stands up on its ball: turned about the ball, the ankle rises
        _b.copy(this._toe).applyQuaternion(_qFoot).add(_target); // the ball, with the foot flat
        _qFoot.multiply(_q.setFromAxisAngle(X_AXIS, home.pitch));
        _a.copy(this._toe).applyQuaternion(_qFoot);
        _c.subVectors(_b, _a);
        _target.lerp(_c, p);
      }
      _qFoot.copy(_qRel.copy(foot.quat).slerp(_qFoot, p)); // (not slerpQuaternions: it would overwrite _qFoot first)
      // On a slope the sole lies along the surface, planted or held, and comes round to it as a foot
      // lands: turned about the ball, which is raised so the sole is on the surface, not in it.
      const flat = p + (1 - p) * (1 - foot.air.x);
      if (foot.normal.y < 0.9999 && flat > 0) {
        _b.copy(this._toe).applyQuaternion(_qFoot).add(_target);
        _b.y += (ANKLE_HEIGHT + this._toe.y) * (1 / foot.normal.y - 1) * flat;
        // (standing, the stepper put the ankle on the ground under the ankle: on a slope the ball's
        // own ground is what the sole sits on)
        if (p > 0) _b.y = mix(_b.y, groundAt(_b.x, _b.z) + foot.raise + (ANKLE_HEIGHT + this._toe.y) / foot.normal.y + foot.lift, p);
        _qFoot.premultiply(_q.identity().slerp(foot.tilt.setFromUnitVectors(UP, foot.normal), flat));
        _target.subVectors(_b, _a.copy(this._toe).applyQuaternion(_qFoot));
      }
      this._leg(foot.side, _target, _pole, _qFoot, foot.swing * (1 - p));
      b[foot.side + 'ToeBase'].quaternion.copy(pose.get(BONE[foot.side + 'ToeBase'], _q)).slerp(IDENTITY, p);
      // rolled up onto the ball, the toes stay flat on the ground
      if (foot.roll) b[foot.side + 'ToeBase'].quaternion.premultiply(_q.setFromAxisAngle(X_AXIS, -foot.roll * (1 - p)));
      // (and crouched, the rear foot up on its ball keeps its toes flat too)
      if (home.pitch > 0) b[foot.side + 'ToeBase'].quaternion.premultiply(_q.setFromAxisAngle(X_AXIS, -home.pitch * p));
    }

    // the face goes on in poseArms, once the head is where the aim seats it
    this._gaze = s.gaze || null;
    this._faceDt = dt;
  }

  /**
   * Turns a held foot about the ball of the foot, heel rising, until its ankle is no more than
   * `reach` from `hip` (or it has rolled ROLL_MAX). The ball stays where it is held, and the
   * toes stay flat on the ground (see poseBody, step 8).
   */
  _rollOff(foot, hip, reach, dt) {
    _rollV.copy(this._toe).applyQuaternion(foot.quat); // ball from ankle
    _rollBall.copy(foot.ankle).add(_rollV);
    _rollV.negate(); // ankle from ball
    _rollAxis.set(1, 0, 0).applyQuaternion(foot.quat);
    let roll = 0;
    if (foot.held && foot.w < 0.5) {
      // which way round lifts the heel (kept for easing back once the foot is let go)
      foot.rollUp = _rollP.copy(_rollV).applyAxisAngle(_rollAxis, 0.1).y > _rollV.y ? 1 : -1;
      const up = foot.rollUp;
      const away = (angle) => _rollP.copy(_rollV).applyAxisAngle(_rollAxis, up * angle).add(_rollBall).distanceTo(hip) - reach;
      if (away(0) > 0) {
        let lo = 0;
        let hi = ROLL_MAX;
        if (away(hi) > 0) lo = hi;
        else {
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2;
            if (away(mid) > 0) lo = mid;
            else hi = mid;
          }
        }
        roll = lo;
      }
      // (followed closely rather than exactly: a hip pulling away fast must not flick the heel up)
      roll = foot.rolled.to(roll, 0.05, dt);
    } else roll = foot.rolled.to(0, 0.12, dt); // let go, it eases back to the clip's foot
    foot.roll = foot.rollUp * roll;
    if (!roll) return;
    foot.quat.premultiply(_q.setFromAxisAngle(_rollAxis, foot.roll));
    foot.ankle.copy(_rollV.applyAxisAngle(_rollAxis, foot.roll)).add(_rollBall);
  }

  /** Standing position of a foot in the character's frame: rifle-idle's stance, wider aimed. */
  _home(side, aim) {
    const a = this.motion.stance[side];
    const c = AIM_STANCE[side];
    // the stance drifts: feet a little wider or closer, the lead foot further out or back
    const alive = this._alive;
    const left = side === 'Left';
    this._homeOut.x = mix(a.x, c.x, aim) + (alive ? alive.width * (left ? -0.5 : 0.5) : 0);
    this._homeOut.z = mix(a.z, c.z, aim) - (alive ? alive.stagger * (left ? 1 : -0.5) : 0);
    this._homeOut.toe = mix(a.toe, c.toe, aim);
    // crouched: the crouch idle's stance (the rear foot back and up on its ball); aiming crouched
    // keeps it (the aim stance is a standing one)
    const k = this.crouch;
    this._homeOut.pitch = 0;
    if (k > 0) {
      const d = this.motion.crouch.stance[side];
      this._homeOut.x = mix(this._homeOut.x, d.x + (alive ? alive.width * (left ? -0.3 : 0.3) : 0), k);
      this._homeOut.z = mix(this._homeOut.z, d.z, k);
      this._homeOut.toe = mix(this._homeOut.toe, d.toe, k);
      this._homeOut.pitch = d.pitch * k;
    }
    return this._homeOut;
  }

  _homeOut = { x: 0, z: 0, toe: 0, pitch: 0 };

  /** Calls fn(clip, weight) for every clip `blend` has more than a negligible share of. */
  _each(blend, fn) {
    const { clips, walks, jogs, crouch } = this.motion;
    const least = 1e-6;
    const c = blend.crouch;
    const k = 1 - blend.cm; // (going down or coming up standing: the authored clip has the rest)
    if (blend.idle * (1 - c) * k > least) fn(clips.idle, blend.idle * (1 - c) * k);
    if (blend.idle * c * k > least) fn(crouch.idle, blend.idle * c * k);
    for (let i = 0; i < walks.length; i++) {
      const w = blend.dir[i] * k;
      if (blend.walk * w * (1 - c) > least) fn(walks[i], blend.walk * w * (1 - c));
      if (blend.walk * w * c > least) fn(crouch.walks[i], blend.walk * w * c);
      if (blend.jog * w > least) fn(jogs[i], blend.jog * w);
    }
    if (blend.sprint * k > least) fn(clips.sprint, blend.sprint * k);
  }

  /**
   * The transition's share of the pose this frame. It comes in quickly as one begins, goes out
   * over its last moments where it hands over to a loop or settles into the idle, and one let go
   * of part way fades out, playing on.
   */
  _moveShare(dt, move) {
    // (one let go of keeps playing as it fades, so that a foot in the air does not stop in it)
    if (this._fading) {
      this._fading.t = Math.min(this._fading.duration, this._fading.t + dt);
      this._fadeW = damp(this._fadeW, 0, 1 / MOVE_LET_GO, dt);
      if (this._fadeW < 1e-3) {
        this._fading = null;
        this._fadeW = 0;
      }
    }
    if (move && this._move && move !== this._move && this._moveW > 1e-3) {
      // one transition begun while another is still showing (a stop let go of to set off again):
      // the old one fades out while the new one comes in
      this._fading = this._move;
      this._fadeW = this._moveW;
    }
    if (move) {
      this._move = move;
      const ease = (x) => THREE.MathUtils.smoothstep(x, 0, 1);
      const into = MOVE_IN[move.kind];
      const out = move.exit ? MOVE_OUT_LOOP : MOVE_OUT;
      this._moveW = Math.min(ease(move.age / into), ease((move.duration - move.t) / out));
      // (the first frame of a transition already counts, so that a swinging foot's target does
      // not jump: see _blendChanged)
      this._moveW = Math.max(this._moveW, 1e-3);
      this._fadeW = Math.min(this._fadeW, 1 - this._moveW);
    } else if (this._move) {
      this._move.t = Math.min(this._move.duration, this._move.t + dt);
      this._moveW = damp(this._moveW, 0, 1 / MOVE_LET_GO, dt);
      if (this._moveW < 1e-3) {
        this._move = null;
        this._moveW = 0;
      }
    }
    return this._moveW;
  }

  /** How much a transition has foot k (0 left, 1 right) on the ground now, 0..1. */
  _moveDown(move, k) {
    let down = 0;
    for (const [clip, w] of move.clips) down += w * this.motion.downAt(clip, move.u * clip.duration, k);
    return down;
  }

  /**
   * Which forward loop the legs are in, 'walk' or 'jog', or null (another direction, the sprint,
   * between gaits, or a transition): the stops start from these.
   */
  forwardGait() {
    const b = this._blendNow;
    if (this._moveW + this._fadeW > 0.05 || b.dir[this._forward] < 0.9 || b.sprint > 0.05) return null;
    if (b.walk > 0.9) return 'walk';
    if (b.jog > 0.9) return 'jog';
    return null;
  }

  /** The clips blended with the weights in `blend` at this moment of the cycle, into `pose`. */
  _blend(blend, time, pose) {
    const motion = this.motion;
    const idle = motion.clips.idle;
    const crouchIdle = motion.crouch.idle;
    pose.clear();
    this._each(blend, (clip, w) => motion.accumulate(clip, clip === idle || clip === crouchIdle ? time / clip.duration : this.phase + clip.strike, w, pose));
    const cm = this._crouchMove;
    if (blend.cm > 0 && cm) motion.accumulateOnce(cm.clip, cm.t, blend.cm, pose);
    const move = this._move;
    // (last frame's blend may still give a transition that has just finished fading a share)
    if (blend.move > 0 && move) for (const [clip, w] of move.clips) motion.accumulateOnce(clip, move.u * clip.duration, blend.move * w, pose);
    const fading = this._fading;
    if (blend.fade > 0 && fading) for (const [clip, w] of fading.clips) motion.accumulateOnce(clip, fading.u * clip.duration, blend.fade * w, pose);
    pose.normalize();
  }

  _blendChanged(a, b) {
    if (a.idle !== b.idle || a.walk !== b.walk || a.jog !== b.jog || a.sprint !== b.sprint || a.move !== b.move || a.fade !== b.fade || a.crouch !== b.crouch || a.cm !== b.cm) return true;
    for (let i = 0; i < a.dir.length; i++) if (a.dir[i] !== b.dir[i]) return true;
    return false;
  }

  /**
   * Reads one leg out of a blended pose: ankle, knee direction and foot rotation, in the model's
   * frame, into `out`. The clips already step the right way; when the ground goes faster or
   * slower than they were made for, the step is stretched along the clips' way of travel, about
   * where the foot is on average. `foot` supplies the foot's own placement.
   */
  _clipLeg(out, foot, pose, blend) {
    const rest = this.motion.rest;
    const side = foot.side;
    const outward = side === 'Left' ? 1 : -1;
    pose.get(BONE.Hips, _qRel);
    _hip.copy(rest[side + 'UpLeg']).applyQuaternion(_qRel).add(pose.hips);
    _qRel.multiply(pose.get(BONE[side + 'UpLeg'], _q));
    _knee.copy(rest[side + 'Leg']).applyQuaternion(_qRel).add(_hip);
    _qRel.multiply(pose.get(BONE[side + 'Leg'], _q));
    out.ankle.copy(rest[side + 'Foot']).applyQuaternion(_qRel).add(_knee);
    _qRel.multiply(pose.get(BONE[side + 'Foot'], _q));
    out.pole.subVectors(_knee, _hip);
    out.pole.z += 0.05; // a straight leg still knows which way its knee goes
    out.quat.copy(_qRel);
    out.ankle.x += outward * foot.place.x;
    // A lengthened stride is a longer reach and push on the ground; a foot high in its swing (a
    // run's heel kicked up behind) is not carried further back with it, out of the leg's reach.
    const up = THREE.MathUtils.smoothstep(out.ankle.y - ANKLE_HEIGHT, 0.04, 0.2);
    // (a transition steps as it was authored: it is not stretched)
    const stretch = mix(this.stride > 1 ? mix(this.stride, 1, up) : this.stride, 1, blend.move + blend.fade);
    const way = _d.set(0, 0, 0);
    _c.set(0, 0, 0);
    let moving = 0;
    this._each(blend, (clip, w) => {
      if (!clip.speed) return;
      way.x += w * Math.sin(clip.direction);
      way.z += w * Math.cos(clip.direction);
      _c.addScaledVector(clip.footMean[side], w);
      moving += w;
    });
    const length = Math.hypot(way.x, way.z);
    // (the gait's share eases away towards nothing when the body stops: below a ten-thousandth
    // the shares are too small to divide by)
    if (moving > 1e-4 && length > 1e-3 * moving) {
      _c.divideScalar(moving);
      way.divideScalar(length);
      const along = (out.ankle.x - _c.x) * way.x + (out.ankle.z - _c.z) * way.z;
      out.ankle.addScaledVector(way, along * (stretch - 1));
    }
  }

  /**
   * The root onto the ground: at the lower foot's ground plus 0.3 of the difference to the other,
   * eased over 0.12 s (a foot in the air counts by the ground it is heading for); and the slope
   * under the body along its facing, eased, for the lean into a hill and the shorter steps.
   */
  _placeOnGround(dt) {
    const root = this.root.position;
    // The ground round the body, averaged over 0.6 m each way along the facing and across (a step's
    // riser becomes a slope over that width, so the body rises and falls without a jolt), lowered a
    // little on a slope so the lower foot reaches; the slope along the facing from the same samples.
    const yaw = this.root.rotation.y;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let sum = 0;
    let count = 0;
    for (const d of [-0.3, -0.15, 0, 0.15, 0.3]) {
      sum += groundAt(root.x + fx * d, root.z + fz * d) + groundAt(root.x - fz * d, root.z + fx * d);
      count += 2;
    }
    const front = groundAt(root.x + fx * 0.3, root.z + fz * 0.3);
    const back = groundAt(root.x - fx * 0.3, root.z - fz * 0.3);
    const side = (groundAt(root.x - fz * 0.3, root.z + fx * 0.3) - groundAt(root.x + fz * 0.3, root.z - fx * 0.3)) / 0.6;
    const grade = (front - back) / 0.6;
    const target = sum / count - 0.12 * Math.min(0.6, Math.hypot(grade, side));
    if (!this._grounded) {
      this._bodyY.x = target;
      this._bodyY.v = 0;
      const here = groundAt(root.x, root.z);
      for (const foot of this.feet) foot.gnd.x = here;
    } else this._bodyY.to(target, 0.1, dt);
    this._grounded = true;
    root.y = this._bodyY.x;
    this.grade = this._grade.to(grade, 0.25, dt);
  }

  /**
   * How far (m) a ball of the foot at (x, z), the foot pointing along (fx, fz) (world, need not be
   * unit), has to move along the foot for the whole sole (heel to toe tip) to stand on one level:
   * 0 on the flat or a slope, the nearest such place across a step's edge (searched to 15 cm).
   */
  _treadFix(x, z, fx, fz) {
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    // (the ball, the arch and the toe with 6 cm to spare before a riser all on one level; the heel may
    // hang over a lower one, as a foot going up stairs does, but not dig into a higher one)
    // (measured against the plane of the surface under the ball, so a slope reads as level)
    const level = (d) => {
      const g = groundAt(x + fx * d, z + fz * d, _tfN);
      const slope = -(_tfN.x * fx + _tfN.z * fz) / Math.max(0.3, _tfN.y);
      const off = (along) => groundAt(x + fx * (along + d), z + fz * (along + d)) - g - slope * along;
      let worst = 0;
      for (const along of [-0.08, 0.06, TOE + 0.06]) worst = Math.max(worst, Math.abs(off(along)));
      return Math.max(worst, off(-(HEEL_BACK_BALL + 0.025)));
    };
    if (!edgeNear(x, z, 0.4)) return 0; // (no step's edge near: the flat, a ramp)
    const here = level(0);
    if (here < 0.03) return 0; // (no edge under the sole)
    for (let k = 1; k <= 15; k++) {
      for (const d of [k * 0.01, -k * 0.01]) if (level(d) < 0.01) return d;
    }
    return 0;
  }

  /**
   * Where a foot in the air will come down: the loops' contact for it looked ahead at the gait's
   * pace (to 0.4 s), and the blended clips' ball of the foot there, carried on by the root's own
   * velocity. Returns { x, z (world), fx, fz (the foot's forward), t (s) } or null (not landing
   * within that, a transition playing, or standing).
   */
  _landing(foot) {
    const blend = this._blendNow;
    // (_blendNow is this frame's blend: filled every frame, its `ready` flag is only set on the copy)
    if (this.plant > 0.5) return null;
    const move = this._move;
    const inMove = blend.move > 0.01;
    // (a transition fading out under another, or with no pace to look ahead by: a little ahead of
    // where the foot is going)
    if (blend.fade > 0.01 || (inMove && !move) || (!inMove && this._phaseRate <= 0)) {
      _d.set(0, 0, 1).applyQuaternion(foot.quat).setY(0).normalize();
      const out = this._landOut;
      out.x = foot.ball.x + foot.ballVel.x * 0.06;
      out.z = foot.ball.z + foot.ballVel.z * 0.06;
      out.fx = _d.x;
      out.fz = _d.z;
      out.t = 0.1;
      return out;
    }
    const motion = this.motion;
    const side = foot.side;
    const k = foot === this.feet[0] ? 0 : 1;
    const rate = Math.max(0, this._phaseRate);
    const loopAt = (phase) => {
      let contact = 0;
      let shared = 0;
      this._each(blend, (clip, w) => {
        if (clip === motion.clips.idle || clip === motion.crouch.idle) return;
        contact += w * motion.contact(clip, phase + clip.strike, side);
        shared += w;
      });
      return shared > 1e-4 ? contact / shared : 1;
    };
    // (a transition playing: its own feet's down, looked ahead in its own time, with the loops'
    // under it by their share)
    const t0 = move ? move.t : 0;
    const contactAt = (t) => {
      let c = loopAt(this.phase + rate * t);
      if (inMove) {
        move.t = Math.min(move.duration, t0 + t);
        c = c * (1 - blend.move) + this._moveDown(move, k) * blend.move;
        move.t = t0;
      }
      return c;
    };
    let t = 0;
    for (; t <= 0.4; t += 1 / 60) if (contactAt(t) >= 0.5) break;
    if (t > 0.4) return null;
    const keep = this.phase;
    this.phase += rate * t;
    if (inMove) move.t = Math.min(move.duration, t0 + t);
    this._blend(blend, this._time, this._poseAhead);
    this.phase = keep;
    if (inMove) move.t = t0;
    const leg = this._legAhead;
    this._clipLeg(leg, foot, this._poseAhead, blend);
    leg.ankle.applyMatrix4(this.model.matrixWorld).addScaledVector(this._rootVel, t);
    leg.quat.premultiply(this._modelQuat);
    _c.copy(this._toe).applyQuaternion(leg.quat).add(leg.ankle);
    _d.set(0, 0, 1).applyQuaternion(leg.quat).setY(0).normalize();
    const out = this._landOut;
    out.x = _c.x;
    out.z = _c.z;
    out.fx = _d.x;
    out.fz = _d.z;
    out.t = t;
    return out;
  }

  _landOut = { x: 0, z: 0, fx: 0, fz: 1, t: 0 };

  /** How far a foot in the air still has to move along itself for its sole to stand on one tread. */
  _treadRest(foot) {
    _d.set(0, 0, 1).applyQuaternion(foot.quat).setY(0).normalize();
    return this._treadFix(foot.out.x, foot.out.z, _d.x, _d.z);
  }

  /** Puts the body back on the ground at once (after the player is moved by hand). */
  snapToGround() {
    this._grounded = false;
    this._resetFeet = true;
  }

  /**
   * (V6) Standing from a pose something else made (an exit clip's last frame): the feet planted where the proxy
   * pose has them now, on the ground under them, turned as they are, rather than put where the stance wants them
   * (snapToGround): from there the stance steps them home as it would any foot out of place.
   */
  plantFeetAsPosed() {
    this._grounded = false;
    this._resetFeet = false;
    this.model.updateMatrixWorld(true);
    for (const foot of this.feet) {
      const bone = this.bones[foot.side + 'Foot'];
      bone.getWorldPosition(foot.pos);
      bone.getWorldQuaternion(_q);
      _a.set(0, 0, 1).applyQuaternion(_q);
      foot.yaw = Math.atan2(-_a.x, -_a.z);
      foot.pos.y = groundAt(foot.pos.x, foot.pos.z) + ANKLE_HEIGHT;
      foot.stepping = false;
      foot.lift = 0;
      foot.u = 0;
      foot.held = true;
      foot.heldBall.copy(this._toe).applyQuaternion(_qFoot.setFromAxisAngle(UP, foot.yaw + Math.PI)).add(foot.pos);
      foot.offX.x = foot.offX.v = foot.offZ.x = foot.offZ.v = foot.offY.x = foot.offY.v = 0;
      foot.treadX.x = foot.treadX.v = foot.treadZ.x = foot.treadZ.v = 0;
      foot.w = 1;
    }
    this._planted = true;
    this.plant = 1;
  }

  /** (V6) How far the feet are from where they should stand (m, the worse of the two), and whether one is stepping. */
  stanceError() {
    return { error: Math.max(this.feet[0].error || 0, this.feet[1].error || 0), stepping: this.feet.some((f) => f.stepping) };
  }

  /**
   * The ground under a foot. Held, exactly under its ball and heel (the higher of the two); in the
   * air, the highest of under it and ahead of it along its swing, eased, so that a foot coming to a
   * step rises over its edge before it reaches it and goes down to a lower tread as it gets there.
   */
  _footGround(foot, ball, heel, dt) {
    const gBall = groundAt(ball.x, ball.z, foot.normal);
    const gHeel = groundAt(heel.x, heel.z);
    if (gHeel > gBall + 0.02) groundAt(heel.x, heel.z, foot.normal);
    const here = Math.max(gBall, gHeel);
    // (the sole fitted to the ground under its heel, toe and edges, not only to the surface under the
    // ball: a foot across the line where the flat meets a ramp bridges it; pass F2)
    const raise = this._soleFit(foot, ball, heel, gBall);
    if (foot.held || this.plant > 0.5) {
      // (held: the ground under the ball, which is what it stands on; the sole is turned to the
      // surface about it, so on a slope the heel is not lifted by the heel's own ground)
      foot.gnd.x = foot.held ? gBall + raise : here;
      foot.gnd.v = 0;
      foot.clear.x = foot.clear.v = 0;
      foot.inAir = false;
      return foot.gnd.x;
    }
    // In the air, the ground it is over goes from where it left to where it will land along the
    // swing (by the swing's progress: time in the air against time to the footfall looked ahead to),
    // not by the ground under it: going up it is at the higher tread by 40 % of the swing, before it
    // passes over the edge; going down it stays at the higher one until 35 % and then goes down.
    // (a new swing also begins where the clips lift a foot that was never caught)
    const lifting = foot.contact < 0.5 && foot.wasDown;
    foot.wasDown = foot.contact >= 0.5;
    if (!foot.inAir || lifting) {
      foot.inAir = true;
      foot.liftG = foot.gnd.x;
      foot.airT = 0;
      foot.landS.x = foot.liftG;
      foot.landS.v = 0;
      foot.edge.x = foot.liftG; // (the edge clamp starts from the ground it left: eased up from there)
      foot.edge.v = 0;
    }
    foot.airT += dt;
    // (no footfall looked ahead to, a transition's or a stop's slow foot: the ground under it)
    const known = Number.isFinite(foot.landG);
    const land = foot.landS.to(known ? foot.landG : here, known ? 0.06 : 0.1, dt);
    const progress = foot.airT / (foot.airT + Math.min(foot.landT, 0.4));
    const along = land > foot.liftG ? ease(Math.min(1, progress / 0.4)) : ease(Math.max(0, (progress - 0.35) / 0.65));
    // (and over the last of the swing onto the ground under it, which is what it is caught on)
    let line = foot.liftG + (land - foot.liftG) * along;
    line += (here - line) * ease(Math.max(0, (progress - 0.8) / 0.2));
    if (!known) line = land;
    // in the air: the ground under it, eased (over a riser it does not jump), and on top, clearance
    // for what is just ahead of it (a step's edge, the slope rising), which the landing does not use
    let ahead = here;
    const v = foot.ballVel;
    _d.set(0, 0, 1).applyQuaternion(foot.quat).applyQuaternion(this._modelQuat).setY(0).normalize(); // (forward)
    // (no further than where it will land, when that is known: a swing at full speed looked 0.12 s
    // ahead would see two treads past its footfall and lift the knee for them)
    const speed = Math.hypot(v.x, v.z);
    const reach = Number.isFinite(foot.landDist) ? Math.min(1, foot.landDist / Math.max(1e-3, speed * 0.12)) : 1;
    for (const t of [0.04, 0.08, 0.12]) {
      const k = t * reach;
      ahead = Math.max(ahead, groundAt(ball.x + v.x * k, ball.z + v.z * k), groundAt(heel.x + v.x * k, heel.z + v.z * k),
        groundAt(ball.x + _d.x * (TOE + 0.02) + v.x * k, ball.z + _d.z * (TOE + 0.02) + v.z * k));
    }
    // (it slows to land, so the look ahead shrinks to nothing as it comes down; one still moving
    // towards a step's edge is kept over it)
    // (and over anything the line misses just ahead of it, eased: a safety net)
    const want = Math.max(0, ahead - Math.max(line, here));
    foot.clear.to(want, 0.06, dt);
    // (never under the ground beneath it; eased over a few frames where that steps up at an edge)
    const target = Math.max(line, here);
    return foot.gnd.to(target, target > foot.gnd.x ? 0.03 : 0.05, dt);
  }

  /**
   * Turns `foot.normal` (the surface under the ball) so the sole, pivoting about the ball, stays out
   * of the ground under its heel, toe tip and both edges of the ball (the ground under the ball
   * (`gBall`) given; `ball` and `heel` world points of the foot). Where the ball sits in a hollow
   * (the foot of a ramp: heel on the flat, ball on the slope) no turn about the ball clears both, and
   * the sole lies on the chord with the ball raised: the rise is returned and kept in `foot.raise`.
   * Not near a step's edge (the tread fix and the heel's own ground handle those).
   * Pass F2: before it the sole took the slope's normal at the ball alone, and a foot that came down
   * with its ball just up the 20-degree ramp and its heel on the flat drove the heel 3 to 5 cm into
   * the flat (rampCrouch20, whenever the crouch walk's second step fell there).
   */
  _soleFit(foot, ball, heel, gBall) {
    foot.raise = 0;
    if (edgeNear(ball.x, ball.z, 0.4)) return 0;
    let ux = ball.x - heel.x;
    let uz = ball.z - heel.z;
    const back = Math.hypot(ux, uz);
    if (back < 0.05) return 0;
    ux /= back;
    uz /= back;
    const wx = -uz;
    const wz = ux;
    const n = foot.normal;
    const sx = -n.x / n.y;
    const sz = -n.z / n.y;
    const gHeel = groundAt(heel.x, heel.z);
    const gToe = groundAt(ball.x + ux * TOE, ball.z + uz * TOE);
    const gL = groundAt(ball.x + wx * SOLE_HALF, ball.z + wz * SOLE_HALF);
    const gR = groundAt(ball.x - wx * SOLE_HALF, ball.z - wz * SOLE_HALF);
    const flatOk = Math.abs(gHeel - gBall) < 1e-4 && Math.abs(gToe - gBall) < 1e-4 && Math.abs(gL - gBall) < 1e-4 && Math.abs(gR - gBall) < 1e-4;
    if (flatOk && n.y > 0.99999) return 0;
    // the slope of the sole's line through the ball along one axis: as the surface has it, kept
    // above the ground `gm` at `dm` behind and `gp` at `dp` ahead; or the chord where none is
    let rise = 0;
    const fit = (s, gm, dm, gp, dp) => {
      const hi = (gBall - gm) / dm;
      const lo = (gp - gBall) / dp;
      if (lo <= hi) return THREE.MathUtils.clamp(s, lo, hi);
      const c = (gp - gm) / (dm + dp);
      rise = Math.max(rise, gm + c * dm - gBall);
      return c;
    };
    const su = fit(sx * ux + sz * uz, gHeel, back, gToe, TOE);
    const sw = fit(sx * wx + sz * wz, gR, SOLE_HALF, gL, SOLE_HALF);
    n.set(-(su * ux + sw * wx), 1, -(su * uz + sw * wz)).normalize();
    foot.raise = rise;
    return rise;
  }

  /** The clips' leg, from the model's frame into the world. */
  _footToWorld(foot) {
    foot.ankle.applyMatrix4(this.model.matrixWorld);
    foot.clipLift = foot.ankle.y - (this.root.position.y + ANKLE_HEIGHT);
    // the ground under it, against the root's: the clip's foot goes up or down by the difference
    // (the held place where it is held, the clip's own where it is not)
    _rollBall.copy(this._toe).applyQuaternion(foot.quat).applyQuaternion(this._modelQuat).add(foot.ankle);
    if (!foot.held) {
      // (where it really is: the clip's place, plus what it is still closing and the tread fix)
      _rollBall.x += foot.offX.x + foot.treadX.x;
      _rollBall.z += foot.offZ.x + foot.treadZ.x;
    }
    const where = foot.held ? foot.heldBall : _rollBall;
    _rollP.copy(HEEL_BACK).applyQuaternion(foot.quat).applyQuaternion(this._modelQuat).add(_rollV.subVectors(where, _rollBall).add(foot.ankle));
    if (!foot.held) {
      _rollP.x += foot.offX.x + foot.treadX.x;
      _rollP.z += foot.offZ.x + foot.treadZ.x;
    }
    const g = this._footGround(foot, where, _rollP, this._dt);
    foot.ankle.y += g - this.root.position.y + foot.clear.x;
    foot.ankle.y = Math.max(foot.ankle.y, g + ANKLE_HEIGHT - 0.01);
    foot.pole.applyQuaternion(this._modelQuat);
    foot.quat.premultiply(this._modelQuat);
    foot.ball.copy(this._toe).applyQuaternion(foot.quat).add(foot.ankle);
  }

  /**
   * Keeps each foot still on the ground for as long as the clip has it there, so the body
   * walks over its feet rather than the feet skating under it, and moves a foot that is in
   * the air out of the way of the other one. Planted (standing), the hold simply follows the
   * planted foot, so that setting off starts from where the foot really is.
   */
  _holdFeet(dt) {
    const ballHeight = ANKLE_HEIGHT + this._toe.y;
    const ref = this.root.rotation.y; // heading of the legs, world
    const [left, right] = this.feet;
    const ax = Math.cos(ref); // the legs' right, world
    const az = -Math.sin(ref);
    for (const foot of this.feet) {
      // where the clips point the foot, world: a held foot keeps its own heading against it (a
      // loop's foot keeps one heading through a stance; a transition's turns with the body, the
      // root under it turning, while the foot stays put in the world)
      _a.set(0, 0, 1).applyQuaternion(foot.quat);
      const clipYaw = Math.atan2(-_a.x, -_a.z);
      foot.clipYawRate = dt > 0 ? wrapAngle(clipYaw - foot.clipYaw) / dt : 0;
      foot.clipYaw = clipYaw;
      if (dt > 0) foot.ballVel.subVectors(foot.ball, foot.ballPrev).divideScalar(dt);
      foot.ballPrev.copy(foot.ball);
      if (!foot.held) {
        // a foot in the air carries on where it was going and closes on the new target from there
        foot.offX.x -= foot.jump.x;
        foot.offZ.x -= foot.jump.z;
        foot.offY.x -= foot.jump.y;
      }
      if (this._planted) {
        foot.held = true;
        foot.heldYaw = foot.yaw;
        foot.heldBall.copy(this._toe).applyQuaternion(_qFoot.setFromAxisAngle(UP, foot.yaw + Math.PI)).add(foot.pos);
        foot.offX.x = foot.offX.v = foot.offZ.x = foot.offZ.v = foot.offY.x = foot.offY.v = foot.offYaw.x = foot.offYaw.v = 0;
        foot.catchH = 0;
      } else if (!foot.held) {
        foot.offX.to(0, LOCK.rejoin, dt);
        foot.offZ.to(0, LOCK.rejoin, dt);
        foot.offY.to(0, LOCK.rejoin, dt);
        foot.offYaw.to(0, LOCK.rejoin, dt);
      }
      foot.swing = damp(foot.swing, foot.held ? 0 : 1, 25, dt);
      if (foot.held) {
        foot.treadX.x = foot.treadX.v = foot.treadZ.x = foot.treadZ.v = 0;
        foot.back.x = foot.back.v = 0;
      } else {
        // where the clips will put it down (looked ahead to its footfall), moved along the foot until
        // the whole sole is on one tread; eased there over the rest of the swing
        const land = this._landing(foot);
        foot.landG = -Infinity;
        foot.landT = land ? land.t : Infinity;
        if (land && land.t === 0) {
          // (the clips have it down already: fitted from where it really is, less the fit so far)
          land.x = foot.out.x - foot.treadX.x - foot.offX.x;
          land.z = foot.out.z - foot.treadZ.x - foot.offZ.x;
        }
        foot.landDist = Infinity;
        if (land) {
          const d = this._treadFix(land.x + foot.offX.x, land.z + foot.offZ.x, land.fx, land.fz);
          foot.landDist = Math.hypot(land.x + foot.offX.x + land.fx * d - foot.out.x, land.z + foot.offZ.x + land.fz * d - foot.out.z);
          foot.landG = groundAt(land.x + foot.offX.x + land.fx * d, land.z + foot.offZ.x + land.fz * d);
          const time = THREE.MathUtils.clamp(land.t * 0.5, 0.03, 0.12);
          foot.treadX.to(land.fx * d, time, dt);
          foot.treadZ.to(land.fz * d, time, dt);
        }
      }
      if (foot.held) foot.out.copy(foot.heldBall);
      else {
        foot.out.set(foot.ball.x + foot.offX.x + foot.treadX.x, foot.ball.y, foot.ball.z + foot.offZ.x + foot.treadZ.x);
        // A foot in the air does not go through a riser: while its sole is still below the tread
        // ahead, it is held back behind the edge (it goes up, then on), let go again as it rises.
        _a.set(0, 0, 1).applyQuaternion(foot.quat).setY(0).normalize();
        const sole = foot.ball.y + foot.offY.x - (ANKLE_HEIGHT + this._toe.y) + 0.005;
        let back = 0;
        // (going up only: a step ahead higher than the ground under the ball)
        if (edgeNear(foot.out.x, foot.out.z, 0.35) && (foot.back.x > 0.005 || groundAt(foot.out.x + _a.x * (TOE + 0.04), foot.out.z + _a.z * (TOE + 0.04)) > groundAt(foot.out.x, foot.out.z) + 0.03)) {
          for (let k = 0; k <= 25; k++) {
            back = k * 0.01;
            const along = TOE + 0.04 - back;
            // (the toe clear of the tread ahead; the ball no lower than the tread it is over, give or
            // take a few centimetres: a foot just lifting off is not dragged back a step)
            if (groundAt(foot.out.x + _a.x * along, foot.out.z + _a.z * along) <= sole + 0.01 && groundAt(foot.out.x - _a.x * back, foot.out.z - _a.z * back) <= sole + 0.04) break;
          }
        }
        // (only ever back towards where it came from, and eased: quickly in, slowly out)
        foot.back.to(back, back > foot.back.x ? 0.02 : 0.06, dt);
        foot.out.x -= _a.x * foot.back.x;
        foot.out.z -= _a.z * foot.back.x;
      }
    }

    // A foot in the air is moved away from the other one when it would come too close beside
    // it: outwards normally, and further across when the legs have crossed over (a sharp
    // running turn), so that it passes cleanly rather than being pushed back through.
    _a.subVectors(right.out, left.out);
    const across = _a.x * ax + _a.z * az;
    const ahead = Math.abs(_a.x * az - _a.z * ax);
    // which side the feet pass on is settled while they are still well apart fore and aft;
    // only a running turn crosses the legs over, a side step never does
    if (this._strafe) this._crossed = false;
    else if (ahead > 0.4) this._crossed = across < 0;
    // Feet closing fast are moved apart a little ahead of time, so that easing out of the way
    // (below) still keeps them clear.
    const closing = dt <= 0 ? 0 : ((this._crossed ? -1 : 1) * (across - this._across)) / dt;
    this._across = across;
    const short = GAP + GAP_SOFT - (this._crossed ? -across : across) - Math.min(0, closing) * PUSH_LEAD;
    let push = short <= 0 ? 0 : short < 2 * GAP_SOFT ? (short * short) / (4 * GAP_SOFT) : short - GAP_SOFT;
    // (faded in over a long way fore and aft: a running foot passes the other one fast)
    push *= (this._crossed ? -1 : 1) * (1 - THREE.MathUtils.smoothstep(ahead, 0.12, 0.55));
    // (a transition's feet go round each other as it was authored)
    push *= 1 - this._moveW - this._fadeW;
    // Shared between the feet in the air, each easing into its share, and eased itself, so a
    // foot landing or leaving the ground, which changes how much is needed, does not make the
    // other one jump.
    const free = left.swing + right.swing;
    for (const foot of this.feet) {
      if (free > 1e-3) foot.share = damp(foot.share, foot.swing / free, 20, dt);
      const want = push * foot.share;
      const pushed = foot.pushed;
      if (foot.held) {
        pushed.x = want;
        pushed.v = 0;
      }
      // (out of the way quickly, back slowly)
      foot.push = pushed.to(want, Math.abs(want) > Math.abs(pushed.x) ? 0.03 : 0.08, dt);
      if (foot.held) continue;
      const out = foot === left ? -foot.push : foot.push;
      foot.out.x += ax * out;
      foot.out.z += az * out;
    }

    for (const foot of this.feet) {
      const ground = foot.gnd.x; // (ground.js: the ground under this foot)
      const lift = Math.min(foot.clipLift, foot.ball.y - (ground + ballHeight));
      if (foot.contact < 0.5) foot.wait = false;
      if (foot.held && !this._planted) {
        _b.copy(this._toe).applyQuaternion(foot.quat);
        const away = this.bones[foot.side + 'UpLeg'].getWorldPosition(_a).distanceTo(_b.subVectors(foot.heldBall, _b)) / this._legLength;
        const turn = wrapAngle(foot.heldYaw - foot.clipYaw);
        if (Math.abs(turn) > LOCK.turn) foot.heldYaw = foot.clipYaw + Math.sign(turn) * LOCK.turn;
        // (a walk blended with a run disagrees about when a foot is down: the clip lifting
        // the foot is as good as its contact curve saying so)
        if (foot.contact < 0.5 || lift > LOCK.low * 1.5 || away > LOCK.reach) {
          // stretched off a foot the clip still has down: not caught again before the next step
          foot.wait = foot.contact >= 0.5 && lift <= LOCK.low * 1.5;
          // let go, moving with the held foot (still) rather than with the clip's
          const out = foot === left ? -foot.push : foot.push;
          foot.held = false;
          foot.edge.x = foot.gnd.x;
          foot.edge.v = 0;
          foot.offX.x = foot.heldBall.x - foot.ball.x - ax * out;
          foot.offZ.x = foot.heldBall.z - foot.ball.z - az * out;
          foot.offX.v = -foot.ballVel.x;
          foot.offZ.v = -foot.ballVel.z;
          foot.offYaw.x = wrapAngle(foot.heldYaw - foot.clipYaw);
          foot.offYaw.v = -foot.clipYawRate;
          // a foot let go well away from where the clip has it is picked up and put down
          // there, a step of its own, rather than dragged along the ground to it
          const gap = Math.hypot(foot.offX.x, foot.offZ.x);
          foot.catchT = 0;
          foot.catchH = gap > 0.06 ? Math.min(STEP_LIFT, 0.4 * gap) : 0;
        }
      } else if (!foot.held && foot.contact > 0.5 && lift < LOCK.low && foot.ball.y - (groundAt(foot.out.x, foot.out.z) + ballHeight) < LOCK.low + 0.01 && !foot.wait && foot.catchH === 0 && Math.abs(this._treadRest(foot)) <= 0.02) {
        // (a sole that would come down across a step's edge is not caught until the tread fix has
        // moved it onto the tread, all but the last 2 cm, which is done here)
        foot.held = true;
        foot.heldBall.copy(foot.out).setY(groundAt(foot.out.x, foot.out.z) + ballHeight); // on the ground under the ball, not in it
        const rest = this._treadRest(foot);
        if (rest) {
          _d.set(0, 0, 1).applyQuaternion(foot.quat).setY(0).normalize();
          foot.heldBall.x += _d.x * rest;
          foot.heldBall.z += _d.z * rest;
          foot.heldBall.y = groundAt(foot.heldBall.x, foot.heldBall.z) + ballHeight;
        }
        foot.offY.x = foot.offY.v = 0;
        foot.heldYaw = foot.clipYaw + foot.offYaw.x;
      }
      foot.correct = foot.held ? wrapAngle(foot.heldYaw - foot.clipYaw) : foot.offYaw.x;
      // the clip's foot, turned to the held heading and moved so its ball is where it belongs
      foot.quat.premultiply(_q.setFromAxisAngle(UP, foot.correct));
      foot.pole.applyAxisAngle(UP, foot.correct);
      _b.copy(this._toe).applyQuaternion(foot.quat);
      foot.ankle.x = foot.out.x - _b.x;
      foot.ankle.z = foot.out.z - _b.z;
      if (!foot.held) foot.ankle.y += foot.offY.x;
      // a held foot rolling forward over its toes keeps them on the ground, not in it, and
      // In the air the toes clear the ground (and settle as the foot lands). The clip's own
      // clearance is small and easily lost: the tactical walk lowers the swing, and played
      // backwards the pointed toes of a push-off would scrape back through the floor. (Both
      // eased in and out with the foot leaving and landing: no sudden lift.)
      // The same goes for the heel, last off the ground backing away.
      const air = foot.air.to(foot.held ? 0 : 1, 0.06, dt);
      const heel = _c.copy(HEEL).applyQuaternion(foot.quat).y;
      // (in the air, the ground under where the ball, the toe tip and the heel now are, as well: a
      // step's edge under a foot that has just been moved is not gone through)
      let gBall = ground;
      let gHeel = ground;
      if (!foot.held) {
        _d.set(0, 0, 1).applyQuaternion(foot.quat).setY(0).normalize();
        gBall = Math.max(ground, groundAt(foot.out.x, foot.out.z), groundAt(foot.out.x + _d.x * (TOE + 0.01), foot.out.z + _d.z * (TOE + 0.01)));
        _d.copy(HEEL).applyQuaternion(foot.quat);
        gHeel = Math.max(ground, groundAt(foot.ankle.x + _d.x, foot.ankle.z + _d.z));
        // (risen to over a few frames, not in one: a toe coming over a step's edge lifts the foot
        // quickly but not with a jolt)
        const edge = Math.max(gBall, gHeel);
        if (edge > foot.edge.x) foot.edge.to(edge, 0.03, dt);
        else foot.edge.x = edge;
        gBall = Math.min(gBall, foot.edge.x);
        gHeel = Math.min(gHeel, foot.edge.x);
        gBall = Math.max(gBall, ground);
        gHeel = Math.max(gHeel, ground);
      }
      const short = Math.max(gBall + ballHeight - _b.y, gHeel + ANKLE_HEIGHT + HEEL.y - heel) + TOE_CLEAR * air - foot.ankle.y;
      foot.ankle.y += easeUp(short, mix(0.006, TOE_CLEAR, air));
      if (!foot.held && foot.catchH > 0) {
        foot.catchT += dt;
        const u = Math.min(1, foot.catchT / CATCH_TIME);
        foot.ankle.y = Math.max(foot.ankle.y, ground + ANKLE_HEIGHT + foot.catchH * Math.sin(Math.PI * u) ** 2);
        if (u >= 1) foot.catchH = 0;
      }    }
  }

  /**
   * Where both shoulder joints are (world) and how long an arm is, so the gun can be held
   * where the hands can actually reach it. Call after poseBody.
   */
  reach(out) {
    this.bones.LeftArm.getWorldPosition(out.left);
    this.bones.RightArm.getWorldPosition(out.right);
    out.arm = this._body.upperArm + this._body.foreArm;
    return out;
  }

  /** The shoulder pocket for the rifle's butt, in the chest joint's frame. */
  get pocket() {
    return this._body.pocket;
  }

  /**
   * Bends the neck so the aiming eye comes down behind the rear sight at `target` (world).
   * The head gives all of the turn back, so it keeps the aiming poses' nearly upright turn and is
   * carried across onto the stock rather than tipped onto it.
   */
  _seatEye(target, weight) {
    const b = this.bones;
    const body = this._body;
    // (pass F2, per body: table cheek.cant, degrees) the head canted over the stock, its top towards
    // the gun's side, about its own front-back axis, before the neck brings the eye down: the cheek
    // goes down the comb's side instead of the jaw resting on its top
    // and nodded forward over it (cheek.nod, degrees: the nose towards the charging handle), which lifts
    // the jaw's angle off the back of the comb and moves it back past the butt
    const cheekT = body.table.cheek || {};
    if (cheekT.cant) b.Head.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(cheekT.cant) * weight));
    // (the more for each 45 degrees aimed up or down: nodUp, nodDown)
    const nod = (cheekT.nod || 0) + (this._aimShare > 0 ? (cheekT.nodUp || 0) * this._aimShare : (cheekT.nodDown || 0) * -this._aimShare);
    if (nod) b.Head.quaternion.multiply(_q.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(nod) * weight));
    b.Head.updateMatrixWorld(true);
    for (let pass = 0; pass < 2; pass++) {
      b.Neck.getWorldPosition(_root);
      b.Head.getWorldQuaternion(_qEnd);
      b.Head.getWorldPosition(_a).add(_b.copy(body.eyeLocal).applyQuaternion(_qEnd));
      _u.subVectors(_a, _root).normalize();
      _f.subVectors(target, _root).normalize();
      const angle = _u.angleTo(_f);
      if (angle < 1e-4) break;
      _qRel.setFromUnitVectors(_u, _f);
      _qRel.copy(_q.copy(IDENTITY).slerp(_qRel, weight * Math.min(1, 0.7 / angle)));
      b.Neck.getWorldQuaternion(_qUpper);
      b.Neck.parent.getWorldQuaternion(_qParent);
      _qUpper.premultiply(_qRel); // the neck's new world rotation
      b.Neck.quaternion.copy(_qParent).invert().multiply(_qUpper);
      _qLower.copy(_qEnd); // the head keeps its turn: carried across on the neck, not tipped over
      b.Head.quaternion.copy(_qUpper).invert().multiply(_qLower);
      b.Neck.updateMatrixWorld(true);
    }
    b.Head.getWorldQuaternion(_q);
    b.Head.getWorldPosition(this.eye).add(_a.copy(body.eyeLocal).applyQuaternion(_q));
  }

  /**
   * Step 2: arms. `hands` gives, per hand, where the middle of the palm is, the hand's world
   * rotation and how tightly the fingers are closed (and, from a handling clip, where each elbow
   * is). `eyeTarget` is the point behind the rear sight where the aiming eye belongs, and `seat`
   * how far to bring it there: the aiming poses already have the eye about there (their cheek
   * weld), so this only corrects for what the run-time layers moved.
   */
  poseArms(hands, eyeTarget = null, seat = 0) {
    const b = this.bones;
    if (eyeTarget && seat > 0.001) this._seatEye(eyeTarget, seat);
    this.model.updateMatrixWorld(true);
    // elbows tucked: down, a little out and back, relative to the chest, unless the gun wants
    // them elsewhere
    // (a handling clip says where each elbow is: hands.rElbow / lElbow, world)
    if (hands.rElbow) _pole.subVectors(hands.rElbow, b.RightArm.getWorldPosition(_a));
    else _pole.copy(hands.rPole || ELBOW_POLE.right).applyQuaternion(this.chestQuat);
    this._arm('Right', hands.rPalm, hands.rQuat, hands.rCurl, _pole, hands.rIndex, hands.rOn > 0.001 ? hands : null);
    if (hands.lElbow) _pole.subVectors(hands.lElbow, b.LeftArm.getWorldPosition(_a));
    else _pole.copy(hands.lPole || ELBOW_POLE.left).applyQuaternion(this.chestQuat);
    this._arm('Left', hands.lPalm, hands.lQuat, hands.lCurl, _pole);
    this._face(this._faceDt, this._gaze);
    // the proxy's pose onto the body's own bones (rig.js)
    this.model.updateMatrixWorld(true);
    this.rig.apply();
  }

  /**
   * The eyes and the face. gaze: { point (world) the eyes want, work (the hands are busy at the gun:
   * a reload), fired (a shot this frame) } or null.
   *
   * The eyes hold still on what they look at (a fixation) and jump to a new one (a saccade, 30 to 40
   * ms) only once the point has moved more than a couple of degrees from it, so on a turn of the view
   * they get there first and the head, slower on the neck, follows them; at rest small darts now and
   * then. Blinks come at uneven spacing (some only half way), with a large gaze shift and on a shot;
   * a shot also sets the brow.
   */
  _face(dt, gaze) {
    const b = this.bones;
    const body = this._body;
    const f = this.face;
    // (each part as the body has it: body.face { eyes, blink, brow, mouth } or null, nothing at all)
    const parts = body.face;
    if (!parts || !body.headRest || dt <= 0) return;
    // the head's turn now, from its rest, in the world: the eyes' straight ahead
    // (headRest is in the model's frame: this is a frame turned with the head whose +Z is its forward)
    b.Head.getWorldQuaternion(_qEnd).multiply(_q.copy(body.headRest).invert());
    // What the eyes want, as a direction in the world (yaw about up, pitch): with nothing to look at,
    // straight ahead of the head. Fixations are kept in the world, so while the head turns under a
    // fixed gaze the eyes counter-turn in the head smoothly, as eyes do, instead of jumping.
    b.Head.getWorldPosition(_a);
    if (gaze && gaze.point) _b.subVectors(gaze.point, _a).normalize();
    else _b.set(0, 0, 1).applyQuaternion(_qEnd);
    let wantYaw = Math.atan2(_b.x, _b.z);
    let wantPitch = Math.asin(THREE.MathUtils.clamp(_b.y, -1, 1));
    // (where it is going: a jump lands where the point will be a moment from now, so on a turn of
    // the view the eyes arrive first and the head comes round after them)
    const rateYaw = wrapAngle(wantYaw - f.lastYaw) / dt;
    const ratePitch = (wantPitch - f.lastPitch) / dt;
    f.lastYaw = wantYaw;
    f.lastPitch = wantPitch;
    f.leadYaw = damp(f.leadYaw, THREE.MathUtils.clamp(rateYaw * EYE_LEAD, -0.3, 0.3), 20, dt);
    f.leadPitch = damp(f.leadPitch, THREE.MathUtils.clamp(ratePitch * EYE_LEAD, -0.2, 0.2), 20, dt);
    // small darts while the gaze rests (fewer at work: the eyes are on something)
    f.nextDart -= dt;
    if (f.nextDart <= 0) {
      const busy = gaze && (gaze.work || gaze.aim > 0.5);
      const k = busy ? 0.35 : 1;
      f.dartYaw = (Math.random() * 2 - 1) * 0.12 * k;
      f.dartPitch = (Math.random() * 2 - 1) * 0.06 * k;
      f.nextDart = 0.35 + Math.random() * (busy ? 0.8 : 1.6);
    }
    wantYaw += f.dartYaw;
    wantPitch += f.dartPitch;
    // between jumps the eyes pursue a point that moves slowly; a quick one gets ahead of them, and
    // they catch it up with a jump that lands a little ahead of it
    f.fixYaw += THREE.MathUtils.clamp(rateYaw, -PURSUIT, PURSUIT) * dt;
    f.fixPitch += THREE.MathUtils.clamp(ratePitch, -PURSUIT, PURSUIT) * dt;
    const shift = Math.hypot(wrapAngle(wantYaw - f.fixYaw), wantPitch - f.fixPitch);
    // (and not again until the one before has been looked at: about a fifth of a second)
    f.sinceSaccade += dt;
    if (shift > (gaze && gaze.work ? SACCADE_MIN * 2 : SACCADE_MIN) && f.sinceSaccade > FIXATION) {
      f.sinceSaccade = 0;
      f.fixYaw = wantYaw + f.leadYaw;
      f.fixPitch = wantPitch + f.leadPitch;
      f.saccades++;
      // a large shift of the gaze often comes with a blink
      if (shift > 0.35 && f.sinceBlink > 0.8 && Math.random() < 0.6) this._blink(f, 1);
    }
    // the eyes move there as a saccade does (30 to 40 ms), in the world
    f.yaw.x = f.fixYaw - wrapAngle(f.fixYaw - f.yaw.x);
    f.yaw.to(f.fixYaw, 0.035, dt);
    f.pitch.to(f.fixPitch, 0.035, dt);
    // ... and from there into the head's frame, as far as eyes turn
    _b.set(Math.sin(f.yaw.x) * Math.cos(f.pitch.x), Math.sin(f.pitch.x), Math.cos(f.yaw.x) * Math.cos(f.pitch.x)).applyQuaternion(_qUpper.copy(_qEnd).invert());
    const inYaw = THREE.MathUtils.clamp(Math.atan2(_b.x, _b.z), -EYE_YAW, EYE_YAW);
    const inPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_b.y, -1, 1)), -EYE_DOWN, EYE_UP);
    f.inPitch = inPitch;
    // the eyes, turned about the head's forward (rest frames: model +Z)
    _qRel.setFromEuler(_e.set(-inPitch, inYaw, 0, 'YXZ'));
    _qUpper.copy(body.headRest).invert().multiply(_qRel).multiply(body.headRest); // the same turn, in the head's frame
    for (const name of ['LeftEye', 'RightEye']) {
      if (!parts.eyes || !b[name] || !body.eyeRest[name]) continue;
      // (the UE5 bodies' eye bones sit at the eyeballs' centres: turned as they are, the ball stays
      // in its socket; the old skeleton's joint sat 2 cm above and 2.7 cm behind and had to be moved)
      b[name].quaternion.copy(_qUpper).multiply(body.eyeRest[name]);
    }
    _a.set(0, 0, 1).applyQuaternion(_qRel).applyQuaternion(_qEnd).applyQuaternion(this.model.getWorldQuaternion(_qA).invert());
    f.worldYaw = Math.atan2(_a.x, _a.z); // (relative to the body, for the review)

    // blinks: uneven spacing, a few only half way; on a shot, more often than not
    f.sinceBlink += dt;
    f.nextBlink -= dt;
    if (f.nextBlink <= 0) this._blink(f, Math.random() < 0.18 ? 0.55 : 1);
    if (gaze && gaze.fired) {
      if (f.sinceBlink > 0.25 && Math.random() < 0.55) this._blink(f, 1);
      f.brow = 1;
    }
    f.brow = Math.max(0, f.brow - dt / 0.35);
    let closed = 0;
    if (f.blink > 0) {
      const u = 1 - f.blink / f.blinkLength; // 0..1 through it: shut fast, open slower
      closed = f.blinkDepth * (u < 0.35 ? Math.sin((u / 0.35) * Math.PI * 0.5) : Math.cos(((u - 0.35) / 0.65) * Math.PI * 0.5));
      f.blink = Math.max(0, f.blink - dt);
    }
    const mesh = body.mesh;
    const dict = mesh && mesh.morphTargetDictionary;
    if (!dict) return;
    const set = (key, x) => dict[key] !== undefined && (mesh.morphTargetInfluences[dict[key]] = x);
    // looking down the lids follow the eyes a little (only where the eyes turn); set brow and a firmer
    // mouth on a shot; aiming, the off eye narrows
    const lid = parts.eyes ? Math.max(0, -f.inPitch) * 0.35 : 0;
    const aim = gaze && gaze.aim ? gaze.aim : 0;
    const brow = ease(f.brow);
    if (parts.blink) {
      set('eyeBlinkLeft', Math.min(1, closed + lid + aim * 0.22 + brow * 0.15));
      set('eyeBlinkRight', Math.min(1, closed + lid + brow * 0.1));
    }
    if (parts.brow) {
      set('browDownLeft', brow * 0.45 + aim * 0.12);
      set('browDownRight', brow * 0.45 + aim * 0.12);
    }
    if (parts.mouth) {
      set('mouthFrownLeft', brow * 0.18);
      set('mouthFrownRight', brow * 0.18);
    }
  }

  _blink(f, depth) {
    f.blink = f.blinkLength = 0.1 + Math.random() * 0.06;
    f.blinkDepth = depth;
    f.blinks++;
    f.sinceBlink = 0;
    // the next one: mostly 2 to 5 s apart, now and then sooner (a double blink) or much later
    const r = Math.random();
    f.nextBlink = r < 0.1 ? 0.3 + Math.random() * 0.3 : r < 0.85 ? 2 + Math.random() * 3 : 5 + Math.random() * 3;
  }

  /**
   * The trigger finger laid on the gun (pass 11): straight along the side of the receiver above the
   * trigger guard (its tip at f.rRest, world), or curled into the guard with its pad on the trigger
   * (f.rTrig), blended by `trigger`, all as much as the hand is on the firing grip (f.rOn). The
   * targets are the gun's, so the finger follows the gun however the hand is turned on it (the
   * shotgun's hand runs its fingers up the stock's wrist: "straight" in the hand's frame pointed
   * 45 degrees into the air). Solved as the finger bends: the middle and end joints curl together
   * as far as the reach needs, then the knuckle flexes towards the palm and swings about the palm's
   * normal to point the finger at the target.
   */
  _index(side, f, trigger) {
    const b = this.bones;
    const hand = b[side + 'Hand'];
    const i1 = b[side + 'HandIndex1'];
    const i2 = b[side + 'HandIndex2'];
    const i3 = b[side + 'HandIndex3'];
    if (!i1 || !i2 || !i3) return;
    hand.updateWorldMatrix(true, false);
    const solve = (point, end, out) => {
      _d.copy(point);
      hand.worldToLocal(_d).sub(i1.position); // the target from the knuckle, hand frame
      const want = _d.length();
      // reach: curl the middle and end joints (the end 0.75 of the middle) until the end point is
      // as far from the knuckle as the target
      const reach = (theta) => _c.copy(end).applyQuaternion(_q.setFromAxisAngle(X_AXIS, -0.75 * theta)).add(i3.position).applyQuaternion(_q.setFromAxisAngle(X_AXIS, -theta)).add(i2.position);
      let lo = 0.04;
      let hi = 1.7;
      if (reach(lo).length() <= want) hi = lo;
      else if (reach(hi).length() >= want) lo = hi;
      else {
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          if (reach(mid).length() > want) lo = mid;
          else hi = mid;
        }
      }
      const theta = (lo + hi) / 2;
      const v = reach(theta);
      _d.normalize();
      // flexion (about X: -Y towards +Z, the palm side) to get the palm-ward share, then a swing
      // about the palm's normal (Z) for the rest
      const r = Math.hypot(v.y, v.z);
      const gamma = Math.atan2(v.z, -v.y);
      const phi = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp((_d.z * v.length()) / r, -1, 1)) - gamma, -0.35, 1.6);
      const y2 = -r * Math.cos(gamma + phi);
      // (as far as 66 degrees: the shotgun's hand runs its fingers 37 degrees up the stock's wrist,
      // and its trigger hangs below and ahead of it)
      const psi = THREE.MathUtils.clamp(wrapAngle(Math.atan2(_d.y, _d.x) - Math.atan2(y2, v.x)), -1.15, 1.15);
      out.set(theta, phi, psi);
      return out;
    };
    const rest = solve(f.rRest, INDEX_TIP, _fRest);
    const fire = trigger > 0.001 ? solve(f.rTrig, INDEX_PAD, _fFire) : rest;
    // (fast off the mark and slowing into the trigger, so most of the way in by the shot)
    const u = 1 - (1 - trigger) ** 3;
    const theta = mix(rest.x, fire.x, u);
    const phi = mix(rest.y, fire.y, u);
    const psi = mix(rest.z, fire.z, u);
    const on = f.rOn;
    _qA.setFromAxisAngle(Z_AXIS, psi).multiply(_q.setFromAxisAngle(X_AXIS, -phi));
    i1.quaternion.slerp(_qA, on);
    i2.quaternion.slerp(_qA.setFromAxisAngle(X_AXIS, -theta), on);
    i3.quaternion.slerp(_qA.setFromAxisAngle(X_AXIS, -0.75 * theta), on);
  }

  _arm(side, palm, handQuat, curl, pole, trigger = 1, finger = null) {
    const b = this.bones;
    const body = this._body;
    const upper = b[side + 'Arm'];
    const fore = b[side + 'ForeArm'];
    const hand = b[side + 'Hand'];

    // The wrist follows from where the palm has to be.
    _target.copy(PALM_LOCAL).applyQuaternion(handQuat).negate().add(palm);
    upper.getWorldPosition(_root);
    this._bend = this._bend || { Left: new THREE.Vector3(), Right: new THREE.Vector3() };
    solveTwoBone(_root, _target, body.arms[side].upper, body.arms[side].fore, pole, _mid, _end, this._bend[side]);

    // Rest: the bone runs along -Y and the elbow hinges about X, so that bending the elbow
    // gives cross(upper, fore) = -X.
    _u.subVectors(_mid, _root).normalize();
    _f.subVectors(_end, _mid).normalize();
    _n.crossVectors(_u, _f);
    if (_n.lengthSq() < 1e-10) _n.crossVectors(pole, _a.subVectors(_end, _root));
    _n.normalize().negate();
    quatFromXY(_qUpper, _n, _y.copy(_u).negate());
    quatFromXY(_qLower, _n, _y.copy(_f).negate());

    // Let the forearm take part of the wrist's roll, so the skin at the wrist does not wring.
    _qRel.copy(_qLower).invert().multiply(handQuat);
    let twist = 2 * Math.atan2(_qRel.y, _qRel.w);
    if (twist > Math.PI) twist -= Math.PI * 2;
    if (twist < -Math.PI) twist += Math.PI * 2;
    _qLower.multiply(_q.setFromAxisAngle(UP, twist * FOREARM_TWIST));

    upper.parent.getWorldQuaternion(_qParent);
    upper.quaternion.copy(_qParent).invert().multiply(_qUpper);
    fore.quaternion.copy(_qUpper).invert().multiply(_qLower);
    hand.quaternion.copy(_qLower).invert().multiply(handQuat);

    // Fingers: open hand at 0, the authored rifle grip at 1.
    const grip = this.motion.holds.aim;
    for (const name of body.fingers) {
      if (!name.startsWith(side)) continue;
      // the trigger finger lies straight along the gun until it is time to fire
      const amount = name.includes('HandIndex') ? curl * (0.1 + 0.9 * trigger) : curl;
      b[name].quaternion.copy(IDENTITY).slerp(grip[name] || IDENTITY, amount);
    }
    // (on the firing grip, laid on the gun itself: along its side, or on the trigger)
    if (finger) this._index(side, finger, trigger);
  }

  /** `swing` is 1 for a foot in the air, which is let fall short of its target sooner. */
  _leg(side, ankleTarget, pole, footQuat, swing) {
    const b = this.bones;
    const body = this._body;
    const thigh = b[side + 'UpLeg'];
    const shin = b[side + 'Leg'];
    const ankle = b[side + 'Foot'];

    thigh.getWorldPosition(_root);
    const full = body.thigh + body.shin;
    const soft = full * mix(SOFT_REACH, SWING_SOFT_REACH, swing);
    _d.subVectors(ankleTarget, _root);
    const dist = _d.length();
    if (dist > soft) {
      const room = full * LEG_REACH - soft;
      _target.copy(_root).addScaledVector(_d, (soft + room * (1 - Math.exp(-(dist - soft) / room))) / dist);
      ankleTarget = _target;
    }
    solveTwoBone(_root, ankleTarget, body.thigh, body.shin, pole, _mid, _end);

    // Rest: the bone runs along -Y and the knee hinges about X, with cross(thigh, shin) = +X.
    _u.subVectors(_mid, _root).normalize();
    _f.subVectors(_end, _mid).normalize();
    _n.crossVectors(_u, _f);
    if (_n.lengthSq() < 1e-10) _n.crossVectors(pole, _a.subVectors(_end, _root));
    _n.normalize();
    quatFromXY(_qUpper, _n, _y.copy(_u).negate());
    quatFromXY(_qLower, _n, _y.copy(_f).negate());

    thigh.parent.getWorldQuaternion(_qParent);
    thigh.quaternion.copy(_qParent).invert().multiply(_qUpper);
    shin.quaternion.copy(_qUpper).invert().multiply(_qLower);
    ankle.quaternion.copy(_qLower).invert().multiply(footQuat);
  }
}
