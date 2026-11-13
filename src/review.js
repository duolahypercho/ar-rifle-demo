// A way to judge the animation without watching it: play each situation through the real
// update loop, measure how the body moves, and draw where its parts went.
//
//   demo.review()            a table of measurements, one row per situation
//   demo.trace('idle', 20)   a spacing chart: one dot per frame for the muzzle, hands, head,
//                            hips and feet, seen from the side and from above. Even spacing
//                            is constant speed, bunched dots are slow, gaps are fast, a kink
//                            is a snap, and a single blob means that part never moved.
//
// What the numbers mean (all relative to the character's own position and facing):
//   frozenPct   share of the time that the muzzle, head and both hands all moved slower than
//               5 mm/s: how statue-like it is
//   muzzleCm    how far the muzzle wandered: across, up and down, fore and aft
//   headCm      the same for the head
//   snap        the largest change of velocity in one frame among hands, head, feet and
//               muzzle (m/s): a pop shows as a spike here; snapUpper, the same leaving out the
//               feet
//   slide       how fast a planted foot skates over the ground, on average (m/s): the heel
//               while it is down, the ball while only the ball is (judged from the ground's
//               known height, not from the lowest the foot happened to go)
//   bounceCm    how far the hips rise and fall: weight
//   changes     how many times the stance, carry or gaze changed of its own accord
//   gripCm      the furthest either palm was from where it is meant to be on the gun (left /
//               right): more than a centimetre or two means a hand is holding thin air
//   fingerCm    the trigger finger, worst frame, with the firing hand on its grip: `fire`, on each
//               shot, the middle of its end pad from the trigger blade (cm; '-' no shot); `rest`,
//               off the trigger, its tip from the receiver's side above the guard (cm), and the
//               most it pointed away from along the barrel (deg)
//   turnDeg     how far the gun had to be swung towards the support shoulder, at most, for
//               that hand to reach it
//   pushCm      how far the gun had to be held off the body, at most, to clear the clothes
//               (carried, the clip's own hold should need none)
// and for the legs and the body they carry:
//   footTurn    how fast a planted foot swivels on the ground, on average (deg/s): a foot
//               turning with the body instead of staying put
//   kneeMin     the straightest either knee got (degrees of bend): near 0 is a locked knee
//   kneePop     the largest change in a knee's bending speed in one frame (deg/s): a knee
//               that snaps rather than bends
//   hipsDeg     how far the pelvis turned and rolled (yaw / roll, degrees)
//   counterDeg  how far the chest turned against the pelvis: shoulders swinging against hips
//   leanDeg     how far the chest leans forward on average (degrees; negative = back)
//   rollDeg     the furthest a foot on the ground rolls up onto its ball, heel raised (degrees):
//               the heel-to-toe roll of a step
//   twistDeg    the most the pelvis was turned away from the chest (degrees): hips twisted
//               under a side step show here
//   gapCm       the closest the two ankles and the two knees came (ankles / knees, joint
//               centres): under about 11 the feet or knees would be passing through each other
//   stopCm      letting go of the move keys while going: the furthest the body then travelled
//               (cm) and the longest it took (s) until it was under 5 cm/s, over the stops in
//               the run ('-' when there were none)
// and for the face:
//   eyeMoves    saccades a second (the eyes jumping to a new point; small darts at rest)
//   eyeLeadMs   how far the eyes turn ahead of the head (ms; + = eyes first), from the delay that
//               best lines up their turning speeds; '-' when the head did not turn
//   blinkS      seconds between blinks: shortest / mean / longest
//   eyeOutMm    the furthest either eyeball's centre moved from its place in the head (mm): an
//               eye turned about anything but its own centre leaves its socket
//   varyMm      how different each step is from the same foot's step before it (mm, the paths
//               of head and hips compared): 0 is a cycle that repeats exactly
// and for the arms:
//   wristDeg    each wrist's worst bend, left / right: flexion (+ towards the palm) and deviation
//               (+ towards the thumb, - towards the little finger), as blender/rifle_motion/
//               review.py measures it. A wrist goes about 30 degrees either side and 45 into
//               flexion
// and for the ground (ground.js: ramps, steps, the kerb) and the crouch (pass 9):
//   sinkCm      the deepest any point of either sole (heel, ball, toe tip, each edge) went into the
//               ground (cm): to the nearest surface, the tread above or a riser's face beside it;
//               sinkVCm the same measured straight down only (a toe touching a riser by 1 cm reads
//               as deep as the step is high there)
//   floatCm     the highest a planted foot's lowest sole point sat above the ground beneath it (cm;
//               planted = standing, or held mid-stance where the clips have it down and are not
//               yet lifting it: a toe-off is the clip's own lift); floatAt says when and where
//   soleDeg     the worst angle between a flat planted sole (heel and ball both down) and the
//               surface under it (degrees)
//   vPop        the worst one-frame change of vertical speed of the hips and of the head, in the
//               world (m/s, hips / head): a pelvis that pops up a step shows here
//   headUpCm    the head joint's mean height over the ground under the body (cm): standing about
//               148, crouched about 111
import * as THREE from 'three/webgpu';
import { PALM_LOCAL, ANKLE_HEIGHT, HEEL, INDEX_TIP, INDEX_PAD } from './character.js';
import { groundAt, depthAt, PLACES } from './ground.js';
import { SCENARIOS as CAR_SCENARIOS, preset } from './car/scenarios.js';
import { SKIDPAD, HELIPAD, LINE, surfaceKind, nearTrack, TRACK_WIDTH } from './track.js';
import { HIPS_OFFSET } from './seated.js';
import { WORLD_GROUND } from './car/car.js';

// `muzzle` is the gun in the hands when the measuring starts and `slung` the other one's muzzle:
// through a swap each is followed all the way (on to the back, off it), not whichever is in use.
const PARTS = ['muzzle', 'slung', 'LeftHand', 'RightHand', 'Head', 'Hips', 'LeftFoot', 'RightFoot'];
const COLOURS = { muzzle: '#ff5a4d', slung: '#ff9e4d', LeftHand: '#4db2ff', RightHand: '#3ad67a', Head: '#ffd24d', Hips: '#c08cff', LeftFoot: '#9aa4ad', RightFoot: '#e0e4e8' };
const FPS = 60;
const DEG = 180 / Math.PI;
// how far off the ground (m) the heel or the ball may be and still be down
const DOWN = 0.008;

/**
 * How fast the view swings at t (rad/s): each move is [start, angle, seconds], eased in and out as
 * a hand moving the mouse would (a view that starts turning at full speed in one frame would
 * jolt a shouldered muzzle by itself).
 */
const swing = (t, moves) => {
  for (const [at, angle, time] of moves) {
    const u = (t - at) / time;
    if (u >= 0 && u < 1) return (angle / time) * (1 - Math.cos(2 * Math.PI * u));
  }
  return 0;
};

// Each situation: how long to settle first, how long to measure, and what the player does.
const SITUATIONS = {
  idle: { settle: 2, run: 30, act: () => ({}) },
  aimHold: { settle: 1.5, run: 20, act: () => ({ aimToggle: true }) },
  walk: { settle: 2, run: 6, act: () => ({ forward: true }) },
  jog: { settle: 2, run: 5, act: () => ({ forward: true, jog: true }) },
  sprint: { settle: 2.5, run: 4, act: () => ({ forward: true, sprint: true }) },
  strafeLeft: { settle: 2, run: 5, act: () => ({ aimToggle: true, left: true }) },
  strafeRight: { settle: 2, run: 5, act: () => ({ aimToggle: true, right: true }) },
  backUp: { settle: 2, run: 5, act: () => ({ aimToggle: true, back: true }) },
  startStop: { settle: 1, run: 5, act: (t) => ({ forward: t % 2.5 < 1.3, jog: true }) },
  startStopWalk: { settle: 1, run: 5, act: (t) => ({ forward: t % 2.5 < 1.3 }) },
  // standing, the view swung round (rad/s while it swings): the body pivots after it, carried and
  // shouldered; a quarter turn, a small one back (carried, the head and trunk alone take that), a
  // larger one on; and a half turn
  turnCarried: { settle: 1.5, run: 7, act: (t) => ({ turn: swing(t, [[0.3, 1.57, 0.5], [2.6, -0.75, 0.4], [4.6, 1.2, 0.5]]) }) },
  turnAimed: { settle: 1.5, run: 7, act: (t) => ({ aimToggle: true, turn: swing(t, [[0.3, 1.57, 0.5], [2.6, -0.75, 0.4], [4.6, 1.2, 0.5]]) }) },
  turn180: { settle: 1.5, run: 3.5, act: (t) => ({ turn: swing(t, [[0.3, Math.PI, 0.6]]) }) },
  // changing pace on the move: walk into jog and back, and jog into sprint and back
  walkJog: { settle: 1.5, run: 6, act: (t) => ({ forward: true, jog: t % 3 >= 1.5 }) },
  jogSprint: { settle: 1.5, run: 8, act: (t) => ({ forward: true, jog: true, sprint: t % 4 >= 2 }) },
  // running (Shift), the body turns to face the way it goes: a reversal is an about-turn
  turnAbout: { settle: 1, run: 5, act: (t) => ({ sprint: true, forward: t % 2.5 < 1.25, back: t % 2.5 >= 1.25 }) },
  aimOnOff: { settle: 1, run: 6, act: (t) => ({ aimToggle: t % 3 > 0.5 && t % 3 < 2 }) },
  lookAbout: { settle: 1.5, run: 5, act: (t) => ({ aimToggle: true, turn: Math.sin(t * 1.6) * 2.4 }) },
  // (a full gun, and no firing while it settles, or a run after others fires it empty and measures a
  // reload: pass 11)
  burst: { settle: 1.5, run: 4, act: (t) => ({ aimToggle: true, fireKey: t >= 0 && t % 2 < 0.7 }), prep: (demo) => (demo.weapon.ammo = demo.weapon.capacity) },
  // (the shotgun reloads only what it has fired: three shells out first)
  reload: { settle: 1.5, run: 4, act: (t) => ({ reload: t >= 0 && t < 0.03 }), prep: (demo) => (demo.shotgun.ammo = Math.min(demo.shotgun.ammo, 3)) },
  swap: { settle: 1.5, run: 3, act: (t) => ({ swap: t >= 0 && t < 0.03 ? 'other' : null }) },
  // the handling clips on the move and from empty, and aiming high and low
  reloadEmpty: { settle: 1.5, run: 6, act: (t) => ({ reload: t >= 0 && t < 0.03 }), prep: (demo) => (demo.weapon.ammo = 0) },
  reloadWalk: { settle: 1.5, run: 4, act: (t) => ({ forward: true, reload: t >= 0 && t < 0.03 }), prep: (demo) => (demo.shotgun.ammo = Math.min(demo.shotgun.ammo, 3)) },
  reloadJog: { settle: 1.5, run: 4, act: (t) => ({ forward: true, jog: true, reload: t >= 0 && t < 0.03 }), prep: (demo) => (demo.shotgun.ammo = Math.min(demo.shotgun.ammo, 3)) },
  // the trigger pulled during the shotgun's reload: it stops after the shell in hand
  reloadBreak: { settle: 1.5, run: 3, act: (t) => ({ reload: t >= 0 && t < 0.03, fireKey: t > 1.0 && t < 1.1 }), prep: (demo) => (demo.shotgun.ammo = 2) },
  swapWalk: { settle: 1.5, run: 3, act: (t) => ({ forward: true, swap: t >= 0 && t < 0.03 ? 'other' : null }) },
  swapJog: { settle: 1.5, run: 3, act: (t) => ({ forward: true, jog: true, swap: t >= 0 && t < 0.03 ? 'other' : null }) },
  aimUp: { settle: 1.5, run: 4, pitch: 0.75, act: () => ({ aimToggle: true }) },
  aimDown: { settle: 1.5, run: 4, pitch: -0.75, act: () => ({ aimToggle: true }) },
  burstUp: { settle: 1.5, run: 4, pitch: 0.75, act: (t) => ({ aimToggle: true, fireKey: t >= 0 && t % 2 < 0.7 }), prep: (demo) => (demo.weapon.ammo = demo.weapon.capacity) },
  // struck (demo.hit): light blows from the front, left, back and right, carried, aimed and walking;
  // heavy ones from the front and the back
  hitLight: { settle: 1.5, run: 3.2, act: (t) => ({ hit: blows(t, [[0, 'f'], [0.7, 'l'], [1.4, 'b'], [2.1, 'r']], 0.45) }) },
  hitAimed: { settle: 1.5, run: 3.2, act: (t) => ({ aimToggle: true, hit: blows(t, [[0, 'f'], [0.7, 'l'], [1.4, 'b'], [2.1, 'r']], 0.45) }) },
  hitWalk: { settle: 1.5, run: 3.2, act: (t) => ({ forward: true, hit: blows(t, [[0, 'f'], [0.7, 'l'], [1.4, 'b'], [2.1, 'r']], 0.45) }) },
  hitHeavy: { settle: 1.5, run: 3.5, act: (t) => ({ hit: blows(t, [[0, 'f'], [1.7, 'b']], 0.9) }) },
  // the eyes at rest for a long while (blink spacing, darts), and following quick turns of the view
  eyesRest: { settle: 1, run: 40, act: () => ({}) },
  // the look jumped a long way at once, one way and then the other: the eyes turn as far as they go
  eyesFlick: { settle: 1.5, run: 4, act: (t) => ({ flick: t >= 0.3 && t < 0.3 + 1 / FPS ? 1.0 : t >= 2.0 && t < 2.0 + 1 / FPS ? -1.4 : 0 }) },
  eyesTurn: { settle: 1.5, run: 6, act: (t) => ({ turn: swing(t, [[0.3, 1.0, 0.5], [1.8, -1.6, 0.6], [3.4, 0.8, 0.4], [4.6, -0.4, 0.3]]) }) },
};

// The crouch (C) and the ground (ground.js). `crouch` crouches before settling; `place` puts the
// player there, facing `yaw` (0 looks down -Z, pi down +Z) before settling; the walks over the
// ground set off as the measuring starts (the start, the climb or descent and what follows).
const UP_Z = Math.PI; // facing +Z: up the ramps and stairs as they are laid out
const crouched = (act) => (t) => ({ ...act(t), crouch: true });
Object.assign(SITUATIONS, {
  crouchIdle: { settle: 2, run: 20, act: crouched(() => ({})) },
  crouchWalk: { settle: 2, run: 6, act: crouched(() => ({ forward: true })) },
  // down and up standing, then the same walking (the walk blends, standing plays the clips)
  crouchToggle: { settle: 1, run: 9, act: (t) => ({ crouch: t % 2 < 1, forward: t >= 4.5 }) },
  crouchAim: { settle: 2, run: 10, act: crouched(() => ({ aimToggle: true })) },
  crouchAimWalk: { settle: 2, run: 4, act: crouched((t) => ({ aimToggle: true, forward: t < 2, left: t >= 2 })) },
  crouchReload: { settle: 2, run: 4, act: crouched((t) => ({ reload: t >= 0 && t < 0.03 })), prep: (demo) => (demo.shotgun.ammo = Math.min(demo.shotgun.ammo, 3)) },
  crouchSwap: { settle: 2, run: 3, act: crouched((t) => ({ swap: t >= 0 && t < 0.03 ? 'other' : null })) },
  crouchHit: { settle: 2, run: 3.2, act: crouched((t) => ({ hit: blows(t, [[0, 'f'], [0.7, 'l'], [1.4, 'b'], [2.1, 'r']], 0.45) })) },
  // up, down and across each ramp (across: facing across the slope, walking over it and backing up,
  // one foot uphill of the other); standing across the steep one; up and down the stairs; the kerb
  rampUp10: { settle: 1, run: 7, place: { x: PLACES.ramp10.x, z: PLACES.ramp10.up, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  rampDown10: { settle: 1, run: 7, place: { x: PLACES.ramp10.x, z: PLACES.ramp10.top, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  rampAcross10: { settle: 1.5, run: 4, place: { x: PLACES.ramp10.x + 1.3, z: PLACES.ramp10.across, yaw: Math.PI / 2 }, act: (t) => ({ forward: t >= 0 && t < 1.8, back: t >= 2.2 }) },
  rampUp20: { settle: 1, run: 6, place: { x: PLACES.ramp20.x, z: PLACES.ramp20.up, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  rampDown20: { settle: 1, run: 6, place: { x: PLACES.ramp20.x, z: PLACES.ramp20.top, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  rampAcross20: { settle: 1.5, run: 4, place: { x: PLACES.ramp20.x + 1.3, z: PLACES.ramp20.across, yaw: Math.PI / 2 }, act: (t) => ({ forward: t >= 0 && t < 1.8, back: t >= 2.2 }) },
  rampStand20: { settle: 2, run: 6, place: { x: PLACES.ramp20.x, z: PLACES.ramp20.across, yaw: -Math.PI / 2 }, act: () => ({}) },
  rampCrouch20: { settle: 2, run: 5, place: { x: PLACES.ramp20.x, z: PLACES.ramp20.up, yaw: UP_Z }, act: crouched((t) => ({ forward: t > 1 })) },
  // (pass F2) played by hand in one go: walk across the 20-degree slope, stop, crouch, turn and walk
  // down off it onto the flat, turn about and walk up it crouched (both creases, the flat meeting the
  // slope at the foot and the slope meeting the top, under a crouched foot after walking across)
  rampSequence20: {
    settle: 1.5, run: 16, place: { x: PLACES.ramp20.x + 1.0, z: PLACES.ramp20.across, yaw: Math.PI / 2 },
    act: (t) => ({ forward: (t >= 0 && t < 1.2) || (t >= 4 && t < 8.6) || t >= 9.8, crouch: t >= 2.2, turn: swing(t, [[3.0, -Math.PI / 2, 0.7], [8.8, Math.PI, 0.9]]) }),
  },
  stairsUp: { settle: 1, run: 3.8, place: { x: PLACES.stairs.x, z: PLACES.stairs.up, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  // (setting off right at the foot of the stairs: the start's steps are the clip's, not looked ahead to)
  stairsStart: { settle: 1, run: 3, place: { x: PLACES.stairs.x, z: PLACES.stairs.near, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  stairsDown: { settle: 1, run: 3, place: { x: PLACES.stairs.x, z: PLACES.stairs.top, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
  kerb: { settle: 1, run: 4.5, place: { x: PLACES.kerb.x, z: PLACES.kerb.z, yaw: UP_Z }, act: (t) => ({ forward: t >= 0 }) },
});
for (const [dir, keys] of Object.entries({ F: { forward: true }, FL: { forward: true, left: true }, L: { left: true }, BL: { back: true, left: true }, B: { back: true }, BR: { back: true, right: true }, R: { right: true }, FR: { forward: true, right: true } })) {
  SITUATIONS['crouchWalk' + dir] = { settle: 2, run: 3, act: crouched(() => ({ ...keys })) };
}

/** A blow at each [time, way] of the list, for one frame. */
function blows(t, list, strength) {
  for (const [at, way] of list) if (t >= at && t < at + 1 / FPS - 1e-6) return [way, strength];
  return null;
}

// The eight directions, relative to where the camera looks.
const DIRECTIONS = {
  F: { forward: true },
  FL: { forward: true, left: true },
  L: { left: true },
  BL: { back: true, left: true },
  B: { back: true },
  BR: { back: true, right: true },
  R: { right: true },
  FR: { forward: true, right: true },
};
// Each one walked with the gun carried (walkF, walkFL, ...), jogged (jogF, ...) and walked
// looking down the sights (aimF, ...).
for (const [dir, keys] of Object.entries(DIRECTIONS)) {
  SITUATIONS['walk' + dir] = { settle: 1.5, run: 3, act: () => ({ ...keys }) };
  SITUATIONS['jog' + dir] = { settle: 1.5, run: 3, act: () => ({ ...keys, jog: true }) };
  SITUATIONS['aim' + dir] = { settle: 1.5, run: 3, act: () => ({ ...keys, aimToggle: true }) };
}
// Changing direction mid-stride: round all eight, then straight across from left to right and
// from forward to back, at a walk and at a jog.
const SWEEP = ['F', 'FL', 'L', 'BL', 'B', 'BR', 'R', 'FR', 'F', 'L', 'R', 'L', 'F', 'B', 'F'];
const sweep = (jog) => (t) => ({ ...DIRECTIONS[SWEEP[Math.floor(t / 0.6) % SWEEP.length]], jog });
SITUATIONS.sweepWalk = { settle: 1, run: SWEEP.length * 0.6, act: sweep(false) };
SITUATIONS.sweepJog = { settle: 1, run: SWEEP.length * 0.6, act: sweep(true) };

/** The aiming eye in the world (see the review's cheekCm). */
function eyePoint(character, out) {
  const body = character._body;
  const surface = body.table.eye.surface;
  if (surface) return out.fromArray(surface).applyMatrix4(character.bones.Head.matrixWorld);
  const eye = character.rig.bones.eye_r;
  if (eye) return out.setFromMatrixPosition(eye.matrixWorld);
  return out.copy(body.eyeLocal).applyMatrix4(character.bones.Head.matrixWorld);
}

/** The vertices of the head and neck skin (more than half on head / neck bones), once per body. */
function faceVertices(character) {
  const body = character._body;
  if (body.faceSkin !== undefined) return body.faceSkin;
  const mesh = body.mesh;
  const names = new Set(['head', 'neck_01', 'neck_02', 'jaw']);
  const k = new Set(mesh.skeleton.bones.map((b, i) => (names.has(b.name) ? i : -1)).filter((i) => i >= 0));
  const { skinIndex, skinWeight } = mesh.geometry.attributes;
  const list = [];
  for (let i = 0; i < skinIndex.count; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) if (k.has(skinIndex.getComponent(i, j))) w += skinWeight.getComponent(i, j);
    if (w > 0.5) list.push(i);
  }
  body.faceSkin = list;
  return list;
}

// (pass F2) the gun's own surfaces, in its pivot's frame, bucketed in a grid: how deep a point is
// inside any part (the closest triangle within 5 cm, inside when the point is behind its face)
const GUN_CELL = 0.025;
function gunSurface(weapon) {
  if (weapon._surface) return weapon._surface;
  weapon.pivot.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(weapon.pivot.matrixWorld).invert();
  const tris = [];
  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const m = new THREE.Matrix4();
  weapon.pivot.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    if (o.userData.batch || o.userData.shadowProxy) return; // ((V4) batch.js's copies: the originals are measured)
    // (the part's name: the node the mesh is under, e.g. stock for stock_1)
    let part = o;
    while (part.parent && part.parent !== weapon.pivot && !Object.values(weapon.nodes).includes(part)) part = part.parent;
    const name = part.name || o.name || 'part';
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const t = new THREE.Triangle();
      const pts = [t.a, t.b, t.c];
      for (let j = 0; j < 3; j++) pts[j].fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(m);
      if (t.getArea() < 1e-10) continue;
      const k = tris.length;
      tris.push({ t, n: t.getNormal(new THREE.Vector3()), part: name });
      const lo = [0, 1, 2].map((a) => Math.floor(Math.min(t.a.getComponent(a), t.b.getComponent(a), t.c.getComponent(a)) / GUN_CELL));
      const hi = [0, 1, 2].map((a) => Math.floor(Math.max(t.a.getComponent(a), t.b.getComponent(a), t.c.getComponent(a)) / GUN_CELL));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const c = key(x, y, z);
        if (!cells.has(c)) cells.set(c, []);
        cells.get(c).push(k);
      }
    }
  });
  weapon._surface = { tris, cells, key };
  return weapon._surface;
}
const _gq = new THREE.Vector3();
const _gc = new THREE.Vector3();
/** How deep (m) the point `p` (gun pivot frame) is inside the gun, and the part: { depth, part }. */
function gunDepth(surface, p, out) {
  const { tris, cells, key } = surface;
  const cx = Math.floor(p.x / GUN_CELL);
  const cy = Math.floor(p.y / GUN_CELL);
  const cz = Math.floor(p.z / GUN_CELL);
  let best = Infinity;
  let bestK = -1;
  const seen = new Set();
  for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) for (let z = cz - 2; z <= cz + 2; z++) {
    const list = cells.get(key(x, y, z));
    if (!list) continue;
    for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      tris[k].t.closestPointToPoint(p, _gq);
      const d = _gq.distanceToSquared(p);
      if (d < best) {
        best = d;
        bestK = k;
        _gc.copy(_gq);
      }
    }
  }
  out.depth = 0;
  out.part = null;
  if (bestK < 0) return out;
  if (_gq.subVectors(p, _gc).dot(tris[bestK].n) < 0) {
    out.depth = Math.sqrt(best);
    out.part = tris[bestK].part;
  }
  return out;
}
const _gp = new THREE.Vector3();
const _gd = { depth: 0, part: null };
const _gInv = new THREE.Matrix4();
/** The deepest of the head and neck skin inside any part of the gun: { depth (m), part }. */
function skinInGun(character, list, weapon) {
  const surface = gunSurface(weapon);
  const mesh = character._body.mesh;
  mesh.updateMatrixWorld(true);
  weapon.pivot.updateWorldMatrix(true, false);
  _gInv.copy(weapon.pivot.matrixWorld).invert();
  const res = { depth: 0, part: null };
  for (const i of list) {
    mesh.getVertexPosition(i, _gp).applyMatrix4(mesh.matrixWorld).applyMatrix4(_gInv);
    gunDepth(surface, _gp, _gd);
    if (_gd.depth > res.depth) {
      res.depth = _gd.depth;
      res.part = _gd.part;
    }
  }
  return res;
}

const _sv = new THREE.Vector3();
const _sInv = new THREE.Matrix4();
/** How far (m) the deepest of the head and neck skin is inside the stock's box (0: none in it). */
function stockDepth(character, list, weapon) {
  const stock = weapon.nodes.stock;
  if (!stock) return 0;
  if (!weapon._stockBox) {
    // the stock's box in its own frame (the gun at rest: pieces relative to the stock node)
    stock.updateWorldMatrix(true, true);
    _sInv.copy(stock.matrixWorld).invert();
    const box = new THREE.Box3();
    stock.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(_sInv, o.matrixWorld)));
    });
    weapon._stockBox = box;
  }
  const box = weapon._stockBox;
  const mesh = character._body.mesh;
  mesh.updateMatrixWorld(true);
  _sInv.copy(stock.matrixWorld).invert();
  let deepest = 0;
  for (const i of list) {
    mesh.getVertexPosition(i, _sv).applyMatrix4(mesh.matrixWorld).applyMatrix4(_sInv);
    if (!box.containsPoint(_sv)) continue;
    const d = Math.min(_sv.x - box.min.x, box.max.x - _sv.x, _sv.y - box.min.y, box.max.y - _sv.y, _sv.z - box.min.z, box.max.z - _sv.z);
    deepest = Math.max(deepest, d);
  }
  return deepest;
}

// (for close inspection from the console)
export { gunSurface, gunDepth, faceVertices, eyePoint, skinInGun };

import * as SC from '../tools/heli/scenarios.js';
import * as PILOT from '../tools/heli/pilot.js';
import { Helicopter } from './heli/flight.js';
import { makeChain } from './chain.js';

export function makeReview(demo) {
  const v = new THREE.Vector3();
  const inverse = new THREE.Matrix4();

  /** Plays one situation and returns the track of every part, in the character's frame. */
  function record(name, seconds) {
    const spec = SITUATIONS[name];
    if (!spec) throw new Error(`no situation called "${name}"; try one of ${Object.keys(SITUATIONS).join(', ')}`);
    const { player, input, character } = demo;
    const still = { forward: false, back: false, left: false, right: false, sprint: false, jog: false, aimToggle: false, fireKey: false };
    Object.assign(input, still);
    const place = spec.place || { x: 24, z: 30, yaw: 0 };
    player.pos.set(place.x, 0, place.z);
    player.vel.set(0, 0, 0);
    player.move = player._pending = null;
    player.camYaw = player.yaw = place.yaw;
    player._yaw.x = place.yaw;
    player._yaw.v = 0;
    player.crouched = !!spec.act(-1).crouch;
    player.crouch = player._crouchU = player.crouched ? 1 : 0;
    player.crouchMove = null;
    character.root.position.copy(player.pos);
    character.snapToGround();
    player.camPitch = spec.pitch ?? -0.03;
    demo.view = null;
    demo.advance(3); // let whatever came before finish
    const apply = (t) => {
      const want = spec.act(t);
      Object.assign(input, still, want);
      if (want.reload) input.reload = true;
      if (want.swap) input.swap = want.swap;
      if (want.hit && t >= 0) demo.hit(...want.hit);
      if (want.turn) player.camYaw += want.turn / FPS;
      if (want.flick) player.camYaw += want.flick;
      if (want.crouch !== undefined) player.crouched = want.crouch;
      else player.crouched = false;
      delete input.crouch;
      delete input.turn;
      delete input.flick;
    };
    // settling runs at a negative time, so one-off actions (reload, swap) wait for the measured part
    for (let i = 0; i < spec.settle * FPS; i++) {
      apply(-1);
      demo.step(1 / FPS);
    }
    const frames = Math.round((seconds || spec.run) * FPS);
    const tracks = Object.fromEntries(PARTS.map((part) => [part, []]));
    const world = { LeftFoot: [], RightFoot: [], LeftToeBase: [], RightToeBase: [], LeftHeel: [], RightHeel: [] };
    // per frame: knee bends, planted-foot headings, pelvis and chest angles, footfalls
    // the eyes: where they look (relative to the body) and where the head faces, per frame, and the
    // counts of saccades and blinks at the start and end
    const eyes = { eye: [], head: [], blinks: [], saccades: character.face.saccades, out: 0 };
    let blinksSeen = character.face.blinks;
    const legs = { knee: [[], []], footYaw: [[], []], footPitch: [[], []], hipsYaw: [], hipsRoll: [], chestYaw: [], chestLean: [], footfall: [], ankleGap: [], kneeGap: [] };
    const toModel = new THREE.Quaternion();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const angles = (bone, out) => {
      // yaw and roll of a bone relative to the character, its rest frame facing +Z with Y up
      bone.getWorldQuaternion(quat).premultiply(toModel);
      a.set(0, 0, 1).applyQuaternion(quat);
      b.set(0, 1, 0).applyQuaternion(quat);
      out.push(Math.atan2(a.x, a.z), Math.atan2(b.x, b.y));
      return out;
    };
    const before = demo.alive.changes;
    const held = demo.weapon;
    const other = held === demo.rifle ? demo.shotgun : demo.rifle;
    const grip = [0, 0];
    const wrist = [[0, 0], [0, 0]]; // per hand: worst flexion, worst deviation (degrees)
    let turn = 0;
    let push = 0;
    const palm = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    // each stop (the move keys let go of while going): how far the body went and for how long
    // until it was under 5 cm/s
    const stops = [];
    let stopping = null;
    // the ground: soles against the surface under them, vertical pops, head height
    const soles = { sink: 0, float: 0, sole: 0, headUp: 0 };
    const vert = { hips: [], head: [] };
    const sp = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const nrmHeel = new THREE.Vector3();
    const nrmToe = new THREE.Vector3();
    const tq = new THREE.Quaternion();
    // sole points: in the foot's frame from the ankle (heel back and its edges) and in the toe's
    // frame from the ball joint (ball, its edges, the toe tip)
    // (per body: its table's foot; the Tripo player is barefoot, its sole is the skin)
    const foot = character.table.foot;
    const HEEL_SOLE = foot.heelSole.map((p) => new THREE.Vector3(...p));
    const BALL_SOLE = foot.ballSole.map((p) => new THREE.Vector3(...p));
    const ARCH = new THREE.Vector3(...foot.arch);
    // the trigger finger (pass 11): on each shot, its end pad against the trigger blade; off the
    // trigger with the hand on the grip, its tip against the receiver's side above the guard, and how
    // far it points from along the barrel
    const finger = { fire: -1, rest: -1, deg: 0 };
    // the cheek weld (pass R3), shouldered and steady (aim > 0.95, the gun not in a handling clip): the
    // aiming eye (on the skin where the body's table knows it, else the eye bone: the ball's centre)
    // against the sight line (the rear sight along the bore, gun frame): mean height above it and
    // across it (cm, + = the shooter's right), and the deepest any skin of the head and neck went into
    // the stock's box (cm, sampled every 4th frame)
    const cheek = { n: 0, up: 0, side: 0, upMin: Infinity, upMax: -Infinity, inStock: 0, skin: 0, part: null, cant: 0, cantSum: 0 };
    const headSkin = faceVertices(character);
    let ammoWas = demo.weapon.ammo;
    let gunWas = demo.weapon;
    for (let i = 0; i < frames; i++) {
      if (i === 0 && spec.prep) spec.prep(demo);
      if (i === 0) ammoWas = demo.weapon.ammo; // (a situation's prep takes shells out: not a shot)
      const going = input.forward || input.back || input.left || input.right;
      apply(i / FPS);
      const still = !(input.forward || input.back || input.left || input.right);
      if (going && still && player.speed > 0.5) stopping = { from: player.pos.clone(), t: 0 };
      else if (!still) stopping = null;
      demo.step(1 / FPS);
      if (stopping) {
        stopping.t += 1 / FPS;
        if (player.speed < 0.05) {
          stops.push([player.pos.distanceTo(stopping.from), stopping.t]);
          stopping = null;
        }
      }
      character.model.updateMatrixWorld(true);
      inverse.copy(character.root.matrixWorld).invert();
      {
        const w = demo.weapon;
        const hh = demo.hands;
        const end = character.bones.RightHandIndex3;
        if (w === gunWas && w.finger && end && hh && hh.rOn > 0.9 && hh.rGun === w) {
          if (w.ammo < ammoWas) {
            const pad = w.pivot.worldToLocal(INDEX_PAD.clone().applyMatrix4(end.matrixWorld));
            finger.fire = Math.max(finger.fire, w.finger.triggerBox.distanceToPoint(pad));
          } else if (w.index < 0.05) {
            const tip = w.pivot.worldToLocal(INDEX_TIP.clone().applyMatrix4(end.matrixWorld));
            const s = w.finger.side;
            const out = (x, [lo, hi]) => Math.max(lo - x, 0, x - hi);
            finger.rest = Math.max(finger.rest, Math.hypot(tip.x - s.x, out(tip.y, s.y), out(tip.z, s.z)));
            const knuckle = w.pivot.worldToLocal(character.bones.RightHandIndex1.getWorldPosition(c));
            finger.deg = Math.max(finger.deg, tip.sub(knuckle).normalize().angleTo(v.set(0, 0, -1)) * DEG);
          }
        }
        ammoWas = w.ammo;
        if (demo.player.aim > 0.95 && !w.action && w.state === 'ready') {
          const eye = eyePoint(character, c);
          const local = w.pivot.worldToLocal(eye).sub(w.sightLocal);
          cheek.n++;
          cheek.up += local.y;
          cheek.side += local.x;
          cheek.upMin = Math.min(cheek.upMin, local.y);
          cheek.upMax = Math.max(cheek.upMax, local.y);
          // (the head's cant over the stock: its up against the gun's, about the bore; + = the top of
          // the head to the shooter's right, over the stock)
          character.bones.Head.getWorldQuaternion(quat);
          w.pivot.getWorldQuaternion(tq);
          b.set(0, 1, 0).applyQuaternion(quat).applyQuaternion(tq.invert());
          cheek.cant = Math.max(cheek.cant, Math.abs(Math.atan2(b.x, b.y) * DEG));
          cheek.cantSum += Math.atan2(b.x, b.y) * DEG;
          if (i % 4 === 0 && headSkin) cheek.inStock = Math.max(cheek.inStock, stockDepth(character, headSkin, w));
          if (i % 16 === 0 && headSkin) {
            const g = skinInGun(character, headSkin, w);
            if (g.depth > cheek.skin) {
              cheek.skin = g.depth;
              cheek.part = g.part;
            }
          }
        }
        gunWas = w;
      }
      // are the hands where the gun wants them?
      ['Left', 'Right'].forEach((side, k) => {
        const hand = character.bones[side + 'Hand'];
        hand.getWorldPosition(palm).add(v.copy(PALM_LOCAL).applyQuaternion(hand.getWorldQuaternion(quat)));
        grip[k] = Math.max(grip[k], palm.distanceTo(k ? demo.hands.rPalm : demo.hands.lPalm));
        // the forearm in the hand's frame (the left thumb is on the hand's +X, the right one's on -X)
        character.bones[side + 'ForeArm'].getWorldPosition(c);
        hand.getWorldPosition(b);
        a.subVectors(b, c).normalize().applyQuaternion(quat.invert());
        const flex = Math.atan2(-a.z, -a.y) * DEG;
        const dev = -Math.atan2(a.x, -a.y) * DEG * (k ? -1 : 1);
        if (Math.abs(flex) > Math.abs(wrist[k][0])) wrist[k][0] = flex;
        if (Math.abs(dev) > Math.abs(wrist[k][1])) wrist[k][1] = dev;
      });
      // the soles against the ground under each point
      ['Left', 'Right'].forEach((side, k) => {
        const footBone = character.bones[side + 'Foot'];
        const toeBone = character.bones[side + 'ToeBase'];
        footBone.getWorldPosition(a);
        footBone.getWorldQuaternion(quat);
        toeBone.getWorldPosition(b);
        toeBone.getWorldQuaternion(tq);
        let lowest = Infinity;
        let heelUp = Infinity;
        let ballUp = Infinity;
        // (how deep: to the nearest surface, the tread above or a riser's face beside it)
        const sinkAt = (above, what) => {
          const deep = above < 0 ? depthAt(sp.x, sp.y, sp.z) : 0;
          soles.sinkV = Math.max(soles.sinkV || 0, -above);
          if (deep > soles.sink) {
            soles.sink = deep;
            soles.sinkAt = `${(i / FPS).toFixed(2)} s ${side} ${what} at z ${sp.z.toFixed(2)} (${character.feet[k].held ? 'held' : 'in the air'})`;
          }
        };
        for (const p of HEEL_SOLE) {
          sp.copy(p).applyQuaternion(quat).add(a);
          const above = sp.y - groundAt(sp.x, sp.z);
          sinkAt(above, 'heel');
          lowest = Math.min(lowest, above);
          heelUp = Math.min(heelUp, above);
        }
        for (const p of BALL_SOLE) {
          sp.copy(p).applyQuaternion(tq).add(b);
          const above = sp.y - groundAt(sp.x, sp.z);
          sinkAt(above, p.z > 0 ? 'toe' : 'ball');
          lowest = Math.min(lowest, above);
          ballUp = Math.min(ballUp, above);
        }
        const foot = character.feet[k];
        // (planted: held, mid-stance by the clips, which have it down, not lifting it off: a toe-off's
        // rising heel and ball are the clip's own lift, not floating)
        const planted = i > 0 && !foot.stepping && foot.swing < 0.05 && ((foot.held && foot.contact > 0.95 && foot.clipLift < 0.015) || character.plant > 0.9);
        if (planted) {
          if (lowest > soles.float) {
            soles.float = lowest;
            soles.floatAt = `${(i / FPS).toFixed(2)} s ${side} (heel ${(heelUp * 100).toFixed(1)}, ball ${(ballUp * 100).toFixed(1)}, contact ${foot.contact.toFixed(2)})`;
          }
          if (heelUp < 0.01 && ballUp < 0.01) {
            // a flat sole: its up (the foot's +Y) against the surface's normal under the arch
            sp.copy(ARCH).applyQuaternion(quat).add(a);
            groundAt(sp.x, sp.z, nrm);
            // (across a crease, the flat meeting a ramp, the sole bridges it: against the chord from
            // the ground under the heel to the ground under the toe tip; pass F2)
            sp.copy(HEEL_SOLE[0]).applyQuaternion(quat).add(a);
            const hx = sp.x;
            const hz = sp.z;
            const hy = groundAt(hx, hz, nrmHeel);
            sp.copy(BALL_SOLE[3]).applyQuaternion(tq).add(b);
            const ty = groundAt(sp.x, sp.z, nrmToe);
            if (nrmHeel.distanceTo(nrmToe) > 1e-4) {
              c.set(sp.x - hx, ty - hy, sp.z - hz).normalize();
              nrm.set(0, 1, 0).addScaledVector(c, -c.y).normalize();
            }
            const deg = c.set(0, 1, 0).applyQuaternion(quat).angleTo(nrm) * DEG;
            if (deg > soles.sole) {
              soles.sole = deg;
              soles.soleAt = `${(i / FPS).toFixed(2)} s ${side} toe at z ${sp.z.toFixed(2)}`;
            }
          }
        }
      });
      character.bones.Hips.getWorldPosition(a);
      vert.hips.push(a.y);
      character.bones.Head.getWorldPosition(a);
      vert.head.push(a.y);
      soles.headUp += a.y - groundAt(character.root.position.x, character.root.position.z);
      turn = Math.max(turn, demo.weapon.reachTurn);
      push = Math.max(push, demo.weapon.push);
      toModel.copy(character.model.getWorldQuaternion(quat)).invert();
      const bones = character.bones;
      legs.ankleGap.push(bones.LeftFoot.getWorldPosition(a).distanceTo(bones.RightFoot.getWorldPosition(b)));
      legs.kneeGap.push(bones.LeftLeg.getWorldPosition(a).distanceTo(bones.RightLeg.getWorldPosition(b)));
      ['Left', 'Right'].forEach((side, k) => {
        character.bones[side + 'UpLeg'].getWorldPosition(a);
        character.bones[side + 'Leg'].getWorldPosition(b);
        character.bones[side + 'Foot'].getWorldPosition(c);
        legs.knee[k].push(b.clone().sub(a).angleTo(c.sub(b)) * DEG);
        character.bones[side + 'Foot'].getWorldQuaternion(quat);
        a.set(0, 0, 1).applyQuaternion(quat);
        legs.footYaw[k].push(Math.atan2(a.x, a.z) * DEG);
        legs.footPitch[k].push(Math.asin(THREE.MathUtils.clamp(-a.y, -1, 1)) * DEG); // + = heel up
        world[side + 'ToeBase'].push(character.bones[side + 'ToeBase'].getWorldPosition(new THREE.Vector3()));
        world[side + 'Heel'].push(HEEL.clone().applyQuaternion(quat).add(character.bones[side + 'Foot'].getWorldPosition(new THREE.Vector3())));
      });
      const [hipsYaw, hipsRoll] = angles(character.bones.Hips, []);
      legs.hipsYaw.push(hipsYaw * DEG);
      legs.hipsRoll.push(hipsRoll * DEG);
      legs.chestYaw.push(angles(character.bones.Spine2, [])[0] * DEG);
      eyes.eye.push(character.face.worldYaw * DEG);
      eyes.head.push(angles(character.bones.Head, [])[0] * DEG);
      if (character.face.blinks !== blinksSeen) eyes.blinks.push(i / FPS);
      // each eyeball's centre (the real eye bone's origin: the UE5 bodies' eye bones sit at the balls'
      // centres) against where it sits at rest in the real head, through the real bones' world
      // matrices after the rig adapter posed them, so a turn about the wrong point or in the wrong
      // frame shows
      const body = character._body;
      const rig = character.rig;
      for (const side of ['eye_l', 'eye_r']) {
        const eye = body.face && body.face.eyes && rig.bones[side];
        if (!eye) continue;
        rig.bones.head.updateMatrixWorld(true);
        a.setFromMatrixPosition(eye.matrixWorld);
        b.copy(rig.frames.restT[side]).applyMatrix4(rig.bones.head.matrixWorld);
        eyes.out = Math.max(eyes.out, a.distanceTo(b));
      }
      blinksSeen = character.face.blinks;
      // the chest's forward lean: its up axis tipped towards the character's front (+Z)
      character.bones.Spine2.getWorldQuaternion(quat).premultiply(toModel);
      b.set(0, 1, 0).applyQuaternion(quat);
      legs.chestLean.push(Math.atan2(b.z, b.y) * DEG);
      legs.footfall.push(character.life.footfall);
      for (const part of PARTS) {
        const node = part === 'muzzle' ? held.nodes.muzzle_point : part === 'slung' ? other.nodes.muzzle_point : character.bones[part];
        node.getWorldPosition(v);
        if (world[part]) world[part].push(v.clone());
        tracks[part].push(v.clone().applyMatrix4(inverse));
      }
    }
    Object.assign(input, still);
    player.crouched = false;
    soles.headUp /= frames;
    // how high the back of the heel and the ball joint are standing flat on the ground
    const ground = { y: player.pos.y, heel: player.pos.y + ANKLE_HEIGHT + HEEL.y, ball: player.pos.y + ANKLE_HEIGHT + character.bones.LeftToeBase.position.y };
    eyes.saccades = character.face.saccades - eyes.saccades;
    // (pass F2: the eye columns where the eyes turn, blinkS wherever blinks run)
    eyes.face = !!(character._body.face && character._body.face.eyes);
    eyes.blinkOn = !!(character._body.face && character._body.face.blink);
    return { name, tracks, world, ground, legs, eyes, changes: demo.alive.changes - before, grip, wrist, turn, push, stops, soles, vert, finger, cheek };
  }

  /** Change of an angle in degrees, taking the wrap at 180 into account. */
  const turned = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
  const range = (list) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of list) {
      lo = Math.min(lo, turned(list[0], x));
      hi = Math.max(hi, turned(list[0], x));
    }
    return +(hi - lo).toFixed(1);
  };

  /**
   * How much each step differs from the same foot's previous step: the head and hips paths
   * between footfalls, resampled to the same number of points and compared (mm, RMS).
   */
  function variation(tracks, footfall) {
    const steps = [];
    let start = -1;
    for (let i = 0; i < footfall.length; i++) {
      if (!footfall[i]) continue;
      if (start >= 0 && i - start > 4) {
        const path = [];
        for (let k = 0; k < 12; k++) {
          const at = start + Math.round(((i - start) * k) / 11);
          // relative to where the step began, so drift over the run does not count
          for (const part of ['Head', 'Hips']) path.push(tracks[part][at].clone().sub(tracks[part][start]));
        }
        steps.push(path);
      }
      start = i;
    }
    let sum = 0;
    let count = 0;
    for (let s = 2; s < steps.length; s++) {
      for (let k = 0; k < steps[s].length; k++) {
        sum += steps[s][k].distanceToSquared(steps[s - 2][k]);
        count++;
      }
    }
    return count ? +(Math.sqrt(sum / count) * 1000).toFixed(1) : null;
  }

  /**
   * How far ahead of the head the eyes turn (ms, + = eyes first): the delay that best lines up the
   * head's turning speed with the eyes', where either turns more than 20 deg/s; null if neither did.
   */
  function eyeLead({ eye, head }) {
    const rate = (list) => list.map((x, i) => (i ? turned(list[i - 1], x) * FPS : 0));
    const e = rate(eye);
    const h = rate(head);
    if (!h.some((x) => Math.abs(x) > 20)) return null;
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -6; lag <= 20; lag++) {
      let score = 0;
      for (let i = Math.max(0, -lag); i < e.length - Math.max(0, lag); i++) score += e[i] * h[i + lag];
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    return Math.round((best * 1000) / FPS);
  }

  function measure({ name, tracks, world, ground, legs, eyes, changes, grip, wrist, turn, push, stops, soles, vert, finger, cheek }) {
    const n = tracks.muzzle.length;
    const speed = (part, i) => tracks[part][i].distanceTo(tracks[part][i - 1]) * FPS;
    let frozen = 0;
    let snap = 0;
    let snapPart = '';
    let snapUpper = 0; // the same without the feet (sprint feet are allowed more)
    const last = {};
    for (let i = 1; i < n; i++) {
      if (['muzzle', 'Head', 'LeftHand', 'RightHand'].every((part) => speed(part, i) < 0.005)) frozen++;
      for (const part of PARTS) {
        if (part === 'Hips') continue;
        const vel = v.subVectors(tracks[part][i], tracks[part][i - 1]).multiplyScalar(FPS).clone();
        if (last[part] && i > 2) {
          const jump = vel.distanceTo(last[part]);
          if (jump > snap) {
            snap = jump;
            snapPart = part;
          }
          if (!part.endsWith('Foot')) snapUpper = Math.max(snapUpper, jump);
        }
        last[part] = vel;
      }
    }
    const extent = (part) => {
      const box = new THREE.Box3().setFromPoints(tracks[part]);
      return box.getSize(new THREE.Vector3()).toArray().map((x) => +(x * 100).toFixed(1));
    };
    let slide = 0;
    let swivel = 0;
    let planted = 0;
    let roll = 0;
    ['Left', 'Right'].forEach((side, k) => {
      // A foot is on the ground while its heel or its ball is (within DOWN of standing flat),
      // and what must not move is the part that is down, the lower of the two: a heel coming
      // down or a foot rolling off its ball turns about that point, and the rest of it moves.
      const heel = world[side + 'Heel'];
      const ball = world[side + 'ToeBase'];
      // (the ground under the point: ramps, steps and kerb, ground.js)
      const down = (i) => {
        const h = heel[i].y - (ground.heel - ground.y + groundAt(heel[i].x, heel[i].z));
        const b = ball[i].y - (ground.ball - ground.y + groundAt(ball[i].x, ball[i].z));
        return Math.min(h, b) > DOWN ? null : h < b ? heel : ball;
      };
      for (let i = 1; i < n; i++) {
        const part = down(i);
        if (!part || down(i - 1) !== part) continue;
        const a = part[i - 1];
        const b = part[i];
        slide += Math.hypot(b.x - a.x, b.z - a.z) * FPS;
        swivel += Math.abs(turned(legs.footYaw[k][i - 1], legs.footYaw[k][i])) * FPS;
        planted++;
        if (part === ball) roll = Math.max(roll, legs.footPitch[k][i]);
      }
    });
    let kneeMin = Infinity;
    let kneePop = 0;
    for (const knee of legs.knee) {
      for (let i = 0; i < n; i++) kneeMin = Math.min(kneeMin, knee[i]);
      for (let i = 3; i < n; i++) kneePop = Math.max(kneePop, Math.abs(knee[i] - 2 * knee[i - 1] + knee[i - 2]) * FPS);
    }
    return {
      situation: name,
      frozenPct: +((frozen / (n - 1)) * 100).toFixed(0),
      muzzleCm: extent('muzzle').join(' / '),
      headCm: extent('Head').join(' / '),
      bounceCm: extent('Hips')[1],
      snap: `${snap.toFixed(1)} ${snapPart}`,
      snapUpper: +snapUpper.toFixed(1),
      slide: planted ? +(slide / planted).toFixed(2) : 0,
      footTurn: planted ? +(swivel / planted).toFixed(1) : 0,
      kneeMin: +kneeMin.toFixed(0),
      kneePop: +kneePop.toFixed(0),
      hipsDeg: `${range(legs.hipsYaw)} / ${range(legs.hipsRoll)}`,
      counterDeg: range(legs.chestYaw.map((x, i) => turned(legs.hipsYaw[i], x))),
      leanDeg: +(legs.chestLean.reduce((sum, x) => sum + x, 0) / n).toFixed(1),
      rollDeg: +roll.toFixed(0),
      twistDeg: +Math.max(...legs.chestYaw.map((x, i) => Math.abs(turned(x, legs.hipsYaw[i])))).toFixed(0),
      gapCm: `${(Math.min(...legs.ankleGap) * 100).toFixed(0)} / ${(Math.min(...legs.kneeGap) * 100).toFixed(0)}`,
      varyMm: variation(tracks, legs.footfall),
      changes,
      gripCm: grip.map((x) => +(x * 100).toFixed(1)).join(' / '),
      cheekCm: cheek && cheek.n ? `up ${((cheek.up / cheek.n) * 100).toFixed(1)} (${(cheek.upMin * 100).toFixed(1)}..${(cheek.upMax * 100).toFixed(1)}) side ${((cheek.side / cheek.n) * 100).toFixed(1)} stock ${(cheek.inStock * 100).toFixed(1)} skin ${(cheek.skin * 100).toFixed(1)}${cheek.part ? ' ' + cheek.part : ''} cant ${(cheek.cantSum / cheek.n).toFixed(0)}` : '-',
      fingerCm: `fire ${finger.fire < 0 ? '-' : (finger.fire * 100).toFixed(1)} / rest ${finger.rest < 0 ? '-' : (finger.rest * 100).toFixed(1)} ${finger.rest < 0 ? '' : finger.deg.toFixed(0) + 'deg'}`.trim(),
      wristDeg: wrist.map(([flex, dev]) => `flex ${flex.toFixed(0)} dev ${dev.toFixed(0)}`).join(' / '),
      turnDeg: +THREE.MathUtils.radToDeg(turn).toFixed(0),
      pushCm: +(push * 100).toFixed(1),
      // (a body with no eyes to turn, the Tripo player's painted ones: '-')
      eyeMoves: eyes.face ? +(eyes.saccades / ((n - 1) / FPS)).toFixed(1) : '-',
      eyeLeadMs: eyes.face ? eyeLead(eyes) : '-',
      eyeOutMm: eyes.face ? +(eyes.out * 1000).toFixed(1) : '-',
      blinkS: !eyes.blinkOn ? '-' : eyes.blinks.length > 1 ? (() => {
        const gaps = eyes.blinks.slice(1).map((x, i) => x - eyes.blinks[i]);
        return `${Math.min(...gaps).toFixed(1)} / ${(gaps.reduce((a, x) => a + x, 0) / gaps.length).toFixed(1)} / ${Math.max(...gaps).toFixed(1)}`;
      })() : `${eyes.blinks.length} blink(s)`,
      sinkCm: +(soles.sink * 100).toFixed(1),
      floatCm: +(soles.float * 100).toFixed(1),
      floatAt: soles.floatAt || '-',
      sinkAt: soles.sinkAt || '-',
      sinkVCm: +((soles.sinkV || 0) * 100).toFixed(1),
      soleDeg: +soles.sole.toFixed(1),
      soleAt: soles.soleAt || '-',
      vPop: ['hips', 'head'].map((part) => {
        const y = vert[part];
        let worst = 0;
        for (let i = 3; i < y.length; i++) worst = Math.max(worst, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]) * FPS * FPS / FPS);
        return worst.toFixed(2);
      }).join(' / '),
      headUpCm: +(soles.headUp * 100).toFixed(0),
      stopCm: stops.length ? `${(Math.max(...stops.map(([d]) => d)) * 100).toFixed(0)} / ${Math.max(...stops.map(([, t]) => t)).toFixed(2)}` : '-',
    };
  }

  /** Measures every situation (or just the ones named). */
  function review(...names) {
    const list = names.length ? names : Object.keys(SITUATIONS);
    return list.map((name) => measure(record(name)));
  }

  /** Draws the spacing chart for one situation over the page. Call with no name to remove it. */
  function trace(name, seconds) {
    let canvas = document.getElementById('trace');
    if (!name) {
      if (canvas) canvas.remove();
      return null;
    }
    const data = record(name, seconds);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'trace';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9998;background:#15181c';
      document.body.appendChild(canvas);
    }
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext('2d');
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, 1280, 720);
    g.font = '15px sans-serif';
    // two panels: side (forward to the left, up is up) and top (forward up, right is right)
    const scale = 330; // pixels per metre
    const panels = [
      { title: 'side: forward <-, up ^', x: 330, y: 660, px: (p) => p.z * scale, py: (p) => -p.y * scale },
      { title: 'top: forward ^, right ->', x: 960, y: 420, px: (p) => p.x * scale, py: (p) => p.z * scale },
    ];
    for (const panel of panels) {
      g.fillStyle = '#8b949e';
      g.fillText(panel.title, panel.x - 250, 28);
      g.strokeStyle = '#2b3138';
      g.beginPath();
      for (let m = -1; m <= 1.001; m += 0.25) {
        g.moveTo(panel.x + m * scale, 40);
        g.lineTo(panel.x + m * scale, 700);
      }
      g.stroke();
      for (const part of PARTS) {
        g.fillStyle = COLOURS[part];
        for (const p of data.tracks[part]) g.fillRect(panel.x + panel.px(p) - 1, panel.y + panel.py(p) - 1, 2.2, 2.2);
      }
    }
    PARTS.forEach((part, i) => {
      g.fillStyle = COLOURS[part];
      g.fillRect(560, 60 + i * 22, 12, 12);
      g.fillText(part, 580, 71 + i * 22);
    });
    g.fillStyle = '#e6edf3';
    g.fillText(`${name}: ${data.tracks.muzzle.length} frames at ${FPS} a second; grid lines 25 cm apart`, 20, 708);
    return measure(data);
  }

  // ---- (pass V1) vehicles: the car's test drives through the game's own frame loop ----
  /** Gets the player into the car at once (no walk), seated, for the drives. */
  function seatInCar() {
    const v = demo.vehicles;
    v.kind = 'car';
    if (v.mode !== 'seated') {
      v.mode = 'seated';
      v.t = 0;
      v.gunsHidden = true;
      demo.car.doorL = 0;
      v.applyFit('car', v._packFits('car'));
      v._carPoints = null;
    }
  }
  /**
   * demo.vehicleReview('launch', 'brake100', ...): each car scenario (src/car/scenarios.js) driven by
   * its controller through demo.step, so the driver, cameras, sound and visuals run with it; plus the
   * driver's measures: palms against the rim (cm, worst over the run, hands moving round the rim left
   * out) and how far the body went into the car (hips against the seat point).
   */
  function vehicleReview(...names) {
    const list = names.length ? names : ['launch', 'topSpeed', 'brake100', 'skidpadLimit', 'skidpad200', 'rollPitch', 'slalom', 'liftOff', 'powerOver', 'standstill', 'wheelSpeed', 'kerbGame', 'lockToLock', 'lapReal'];
    const rows = [];
    const car = demo.car;
    const d = car.dyn;
    for (const name of list) {
      if (name === 'lapReal') {
        rows.push(lapReal());
        continue;
      }
      const sc = name === 'kerbGame' ? KERB_GAME : name === 'lockToLock' ? LOCK_TO_LOCK : CAR_SCENARIOS[name];
      if (!sc) throw new Error(`no car scenario "${name}"`);
      // ((V6) skidpad200's 230 m circle round the skidpad's centre ran through the yard: since V5's real collisions it
      // ended in the yard's back wall, and the rest of it is on dirt. It is run round a centre 500 m further west, clear
      // of everything, on a 90 m wide ring of tarmac laid for the run (WORLD_GROUND.surface, put back after), as the
      // Node test runs it on flat tarmac)
      const ring = name === 'skidpad200' ? { x: SKIDPAD.x - 500, z: SKIDPAD.z, r: sc.radius, w: 45 } : null;
      const place = sc.place || (ring ? { x: ring.x + ring.r, z: ring.z, yaw: 0 } : name.startsWith('skidpad') || name === 'liftOff' || name === 'powerOver' || name === 'rollPitch' ? { x: SKIDPAD.x + (sc.radius || 63), z: SKIDPAD.z, yaw: 0 } : { x: 120, z: 60, yaw: 0 });
      const surfaceWas = WORLD_GROUND.surface;
      // ((V7) the scenarios run on the flat ground they were made for: topSpeed and kerbGame run on past the paving, and
      // the skidpad200 ring is laid flat; the rolling ground (terrain.js) is off for the run, as on the Node tests' ground)
      const terrainWas = demo.perf.terrain;
      demo.perf.terrain = false;
      if (ring) {
        const tarmac = surfaceWas.call(WORLD_GROUND, 0, 0);
        WORLD_GROUND.surface = (x, z) => (Math.abs(Math.hypot(x - ring.x, z - ring.z) - ring.r) < ring.w ? tarmac : surfaceWas.call(WORLD_GROUND, x, z));
      }
      seatInCar();
      if (demo.repair) demo.repair(); // ((V7) each scenario from new: a dent's toe or flat spot would change the next)
      d.reset(place.x, place.z, place.yaw);
      d.shiftLog.length = 0;
      d._presetSpeed = 0;
      for (let i = 0; i < 30; i++) d.update(1 / 60);
      if (sc.setup) sc.setup.call(sc, d);
      if (d._presetSpeed) preset(d, d._presetSpeed);
      demo.world.resetCones();
      car.clearMarks();
      const s = {};
      let palm = 0;
      let seat = 0;
      // ((V7) against the fitted seat: where the pack's seated reference (car-drive frame 0, built for the seat slid
      // by vehicleFit) puts the hips in the car's frame; V2 to V6 measured against the placeholder's seat point +
      // HIPS_OFFSET, a constant 8.1 cm off the clip's pose)
      const seatRef = seatHipsRef();
      const settle = 1.5;
      const frames = Math.round((sc.seconds + settle) * 60);
      let t = -settle;
      demo.carInput = (dyn) => sc.control.call(sc, dyn, t, s);
      try {
        for (let i = 0; i < frames; i++) {
          t = i / 60 - settle;
          demo.step(1 / 60);
          sc.measure.call(sc, d, t, s);
          const p = demo.vehicles.stats.palm;
          for (const side of ['Left', 'Right']) if (p[side] >= 0) palm = Math.max(palm, p[side]);
          const hips = demo.character.bones.Hips.getWorldPosition(new THREE.Vector3());
          const want = car.root.localToWorld(seatRef.clone());
          seat = Math.max(seat, hips.distanceTo(want));
        }
      } finally {
        demo.carInput = null;
        WORLD_GROUND.surface = surfaceWas;
        demo.perf.terrain = terrainWas;
      }
      const row = { name, ...sc.result.call(sc, s, d), palmCm: palm, hipsOffSeatCm: seat * 100 };
      for (const k of Object.keys(row)) if (typeof row[k] === 'number') row[k] = +row[k].toFixed(k.endsWith('S') || k.endsWith('G') || k.endsWith('Deg') ? 3 : 2);
      rows.push(row);
    }
    return rows;
  }
  /**
   * (V8) One lap on the world as it is played (the rolling ground, the furniture and the tyre walls on, unlike the
   * physics rows): a pure-pursuit driver on the centre line, 10 to 30 m ahead with speed, at up to 160 km/h and slowing for the bends
   * (each bend within 150 m taken at 0.85 g, braked for at 7 m/s^2; throttle at most 0.6, eased). Reports the lap's time, the furthest any
   * wheel's patch got from the centre line (m) and whether every patch stayed on the tarmac or kerb (frames with a
   * patch on anything else), what the suspension saw (spring travel range per axle, m from static; peak tyre load,
   * kN; frames with a wheel off the ground) and the body's peak vertical acceleration (g).
   */
  function lapReal({ kmh = 160, maxS = 150 } = {}) {
    const car = demo.car;
    const d = car.dyn;
    seatInCar();
    if (demo.repair) demo.repair();
    const p0 = LINE[0];
    const p1 = LINE[3];
    d.reset(p0.x, p0.z, Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z)));
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    let idx = 0;
    const s = { offLine: 0, offTarmac: 0, airborne: 0, travelF: [0, 0], travelR: [0, 0], fz: 0, vAcc: 0, frames: 0, laps: 0, t: 0, dist: 0 };
    let lastVy = d.vel.y;
    let passed = 0;
    demo.carInput = (dyn) => {
      const p = dyn.pos;
      let best = Infinity;
      for (let k = idx; k < idx + 40; k++) {
        const q = LINE[k % LINE.length];
        const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (dd < best) {
          best = dd;
          idx = k;
        }
      }
      // the speed it may carry: each bend ahead (to 150 m) taken at 1.0 g, braked for at 9 m/s^2 over the distance to it
      let want = kmh / 3.6;
      for (let j = 0; j < 75; j++) {
        const k = Math.abs(LINE[(idx + j) % LINE.length].k || 0);
        if (k < 1e-4) continue;
        want = Math.min(want, Math.sqrt((0.85 * 9.81) / k + 2 * 7 * 2 * j));
      }
      const v = Math.hypot(dyn.vel.x, dyn.vel.z);
      // (look-ahead with speed: 10 m slow, 30 m fast; a fixed 28 m cut the 20.8 m hairpin onto the dirt)
      const tgt = LINE[(idx + Math.round(Math.min(30, Math.max(10, v)) / 2)) % LINE.length];
      const hx = v > 1 ? dyn.vel.x / v : -Math.sin(dyn.yaw ?? 0);
      const hz = v > 1 ? dyn.vel.z / v : -Math.cos(dyn.yaw ?? 0);
      const dx = tgt.x - p.x;
      const dz = tgt.z - p.z;
      const ang = Math.atan2(hx * dz - hz * dx, hx * dx + hz * dz);
      Object.assign(dyn.input, { throttle: v < want ? Math.min(0.6, (want - v) * 0.15) : 0, brake: v > want + 1 ? Math.min(1, (v - want) * 0.25) : 0, handbrake: 0, steer: 0, steerAngle: -ang * 0.45 });
    };
    try {
      const frames = maxS * 60;
      for (let i = 0; i < frames; i++) {
        demo.step(1 / 60);
        s.frames++;
        if (idx >= LINE.length * (passed + 1)) passed++;
        if (idx >= LINE.length) {
          s.laps = 1;
          s.t = i / 60;
          break;
        }
        const ay = (d.vel.y - lastVy) * 60;
        lastVy = d.vel.y;
        if (i > 30) s.vAcc = Math.max(s.vAcc, Math.abs(ay) / 9.81);
        let off = false;
        let air = false;
        for (const w of d.wheels) {
          const n = nearTrack(w.patch.x, w.patch.z, 30);
          if (n) s.offLine = Math.max(s.offLine, n.dist);
          const k = surfaceKind(w.patch.x, w.patch.z);
          if (k !== 'tarmac' && k !== 'kerb') off = true;
          if (!w.contact) air = true;
          const dt = w.x - w.xStatic;
          const t = w.front ? s.travelF : s.travelR;
          t[0] = Math.min(t[0], dt);
          t[1] = Math.max(t[1], dt);
          s.fz = Math.max(s.fz, w.fz);
        }
        if (off) s.offTarmac++;
        if (air) s.airborne++;
      }
    } finally {
      demo.carInput = null;
    }
    const r3 = (x) => +x.toFixed(3);
    return {
      name: 'lapReal',
      terrain: demo.perf.terrain,
      lapS: s.laps ? +s.t.toFixed(2) : null,
      wheelFromCentreMaxM: +s.offLine.toFixed(2),
      halfWidthM: TRACK_WIDTH / 2,
      framesOffTarmac: s.offTarmac,
      framesWheelInAir: s.airborne,
      springTravelFrontM: s.travelF.map(r3),
      springTravelRearM: s.travelR.map(r3),
      peakTyreLoadKn: +(s.fz / 1000).toFixed(2),
      peakVertAccG: +s.vAcc.toFixed(2),
      frames: s.frames,
    };
  }

  /**
   * (V7) Where the hips belong in the seat, in the car's frame: the pack's seated reference (car-drive frame 0, the
   * clip's root and pose, authored with the seat fitted) when the pack fits the car, else the placeholder's seat point
   * + HIPS_OFFSET. The body is posed on the reference for the reading and put back.
   */
  function seatHipsRef() {
    const v = demo.vehicles;
    const ch = demo.character;
    const car = demo.car;
    const clip = v.pack && v.pack.clips['car-drive'];
    if (!(v.usePackSeated && v._packFits('car') && clip)) return car.nodes.seat_driver_point.position.clone().add(HIPS_OFFSET);
    const saved = Object.values(ch.bones).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
    const rp = ch.root.position.clone();
    const rq = ch.root.quaternion.clone();
    try {
      const r = v.pack.root(clip, 0, {});
      const V = car.root;
      V.updateMatrixWorld(true);
      ch.root.position.copy(V.localToWorld(new THREE.Vector3(r.x, 0, r.z)));
      ch.root.quaternion.copy(V.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw - Math.PI));
      ch.root.updateMatrixWorld(true);
      v.pack.apply(ch.bones, clip, 0, 1);
      ch.model.updateMatrixWorld(true);
      return V.worldToLocal(ch.bones.Hips.getWorldPosition(new THREE.Vector3()));
    } finally {
      for (const [b, q, p] of saved) {
        b.quaternion.copy(q);
        b.position.copy(p);
      }
      ch.root.position.copy(rp);
      ch.root.quaternion.copy(rq);
      ch.root.updateMatrixWorld(true);
      ch.model.updateMatrixWorld(true);
    }
  }
  // the kerb strike on the game's own track: the left wheels over the first corner's inside kerb
  const KERB_GAME = {
    seconds: 3,
    place: null,
    setup(dyn) {
      dyn._presetSpeed = 60 / 3.6;
    },
    control(dyn, t, s) {
      Object.assign(dyn.input, { throttle: 0.3, brake: 0, handbrake: 0, steerAngle: 0, steer: 0 });
    },
    measure(dyn, t, s) {
      const a = dyn.attitude();
      s.roll = Math.max(s.roll || 0, Math.abs(a.roll * 57.2958));
      s.fz = Math.max(s.fz || 0, ...dyn.wheels.map((w) => w.fz));
      s.travel = Math.min(s.travel || 0, ...dyn.wheels.map((w) => w.x - w.xStatic));
      s.air = (s.air || 0) + (dyn.wheels.some((w) => !w.contact) ? 1 / 60 : 0);
      s.yaw = Math.max(s.yaw || 0, Math.abs(dyn.omega.y * 57.2958));
      s.kerb = s.kerb || dyn.wheels.some((w) => w.surface.name === 'kerb');
    },
    result(s) {
      return { onKerb: !!s.kerb, rollDeg: s.roll, peakLoadN: s.fz, bumpCm: -s.travel * 100, airS: s.air, yawDegS: s.yaw };
    },
  };
  // standing, the wheel turned lock to lock slowly: the palms on the rim all the way (the push-pull)
  const LOCK_TO_LOCK = {
    seconds: 9,
    place: { x: 40, z: -60, yaw: 0 },
    control(dyn, t, s) {
      const u = Math.max(0, t);
      const lock = 28 / 57.2958;
      const a = u < 3 ? lock * (u / 3) : u < 6 ? lock * (1 - 2 * ((u - 3) / 3)) : -lock * (1 - (u - 6) / 3);
      Object.assign(dyn.input, { throttle: 0, brake: 0, handbrake: 0, steerAngle: a });
    },
    measure(dyn, t, s) {
      s.max = Math.max(s.max || 0, Math.abs(dyn.steerWheel) * 57.2958);
      const p = demo.vehicles.stats.palm;
      s.moves = (s.moves || 0) + (p.Left < 0 || p.Right < 0 ? 1 / 60 : 0);
    },
    result(s) {
      return { wheelMaxDeg: s.max, handsOffRimS: s.moves };
    },
  };
  KERB_GAME.place = (() => {
    // the first corner (north hairpin) entry: on the inside kerb's line
    return { x: 128.0, z: -786, yaw: 0 };
  })();

  // ---- (pass V2) the helicopter: tools/heli's scenarios flown through the game's frame loop ----
  /** Gets the player into the helicopter at once, seated (the body's vehicleFit applied). */
  function seatInHeli() {
    const v = demo.vehicles;
    v.kind = 'heli';
    if (v.mode !== 'seated') {
      v.mode = 'seated';
      v.t = 0;
      v.gunsHidden = true;
      demo.heli.door = 0;
      v.applyFit('heli', v._packFits('heli'));
      demo.heli.harnessHidden(true);
    }
  }
  /**
   * demo.heliReview('engineStart', 'hover', ...): the scenarios of tools/heli/scenarios.js with the game's
   * own helicopter (re-placed over the helipad) and the scripted pilot of tools/heli/pilot.js, every frame
   * through demo.step (assist, posing, cameras, sound and visuals run with it). Rows as report.txt's.
   * Extra names: 'cruise' (trimmed level flight at 220 km/h), 'landingsGame' (gentle and firm),
   * 'reach' (palms against the grips and soles against the pedals across the control range).
   */
  function heliReview(...names) {
    const list = names.length ? names : ['engineStart', 'hover', 'verticalClimb', 'cruise', 'levelTurn', 'autorotation', 'landingsGame', 'reach'];
    const heli = demo.heli;
    const fm = heli.fm;
    const OX = HELIPAD.x;
    const OZ = HELIPAD.z;
    const baseReset = Helicopter.prototype.reset;
    const rows = [];
    seatInHeli();
    const assistWas = heli.assist.enabled;
    if (demo.repair) demo.repair(); // ((V7) from new)
    // ((V7) in still air, as tools/heli runs them: the weather's wind back after)
    const windWas = demo.weather ? demo.weather.speed : 0;
    if (demo.weather) {
      demo.weather.speed = 0;
      demo.weather.step(0);
    }
    heli.assist.enabled = false;
    SC.hooks.make = () => {
      heli.damaged = false;
      // (as Node's fresh Helicopter: the controls back to their defaults before the scenario's reset)
      Object.assign(fm.controls, { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0, throttle: 0, rotorBrake: 0 });
      fm.reset = (o = {}) => baseReset.call(fm, { ...o, position: o.position ? [o.position[0] + OX, o.position[1], o.position[2] + OZ] : [OX, 0, OZ] });
      return fm;
    };
    PILOT.hooks.fly = (h, pilot, seconds, each) => {
      demo.heliInput = (hh, dt) => {
        if (pilot) pilot.update(dt);
      };
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        demo.step(1 / 60);
        if (each && each(h.state, i / 60) === false) break;
      }
      return h.state;
    };
    try {
      for (const name of list) {
        if (name === 'cruise') {
          const a = SC.trimLevel(220 / 3.6);
          rows.push({ group: 'cruise', item: '220 km/h level: power', value: a.pw, unit: '%', ref: `pitch ${a.pitch.toFixed(1)}, collective ${a.col.toFixed(3)}` });
          rows.push({ group: 'cruise', item: '220 km/h level: pitch', value: a.pitch, unit: 'deg' });
        } else if (name === 'landingsGame') {
          for (const [label, sink] of [['gentle', 0.4], ['firm', 2.5]]) {
            const r = SC.landing({ sink, label });
            rows.push({ group: 'landing', item: `${label}: touchdown sink`, value: -r.vsTd, unit: 'm/s' });
            rows.push({ group: 'landing', item: `${label}: max bank`, value: r.maxBank, unit: 'deg', ref: `contact lost ${r.lost}, touch-downs ${r.touches}, peak skid load ${r.maxN.toFixed(2)} W` });
          }
        } else if (name === 'reach') {
          rows.push(...heliReach());
        } else {
          const fn = SC.ALL[name];
          if (!fn) throw new Error(`no helicopter scenario "${name}"`);
          rows.push(...fn());
        }
      }
    } finally {
      delete fm.reset;
      SC.hooks.make = (opts) => new Helicopter(opts);
      PILOT.hooks.fly = null;
      demo.heliInput = null;
      heli.assist.enabled = assistWas;
      heli.assist.reset(heli.state);
      if (demo.weather) demo.weather.speed = windWas;
    }
    return rows.map((r) => ({ group: r.group, item: r.item, value: typeof r.value === 'number' ? +r.value.toFixed(3) : r.value, unit: r.unit, pass: r.pass, ref: r.ref }));
  }
  /** Palms against the cyclic and collective grips, soles against the pedals (cm), at the control limits. */
  function heliReach() {
    const heli = demo.heli;
    const fm = heli.fm;
    const windWas = demo.weather ? demo.weather.speed : 0; // ((V7) still air)
    if (demo.weather) {
      demo.weather.speed = 0;
      demo.weather.step(0);
    }
    seatInHeli();
    baseResetPlace(heli);
    const rows = [];
    const set = [
      ['centre', {}], ['cyclic full fwd', { cyclicPitch: 1 }], ['cyclic full aft', { cyclicPitch: -1 }], ['cyclic full left', { cyclicRoll: -1 }], ['cyclic full right', { cyclicRoll: 1 }],
      ['collective down', { collective: 0 }], ['collective up', { collective: 1 }], ['pedal full left', { pedal: -1 }], ['pedal full right', { pedal: 1 }],
      ['fwd-right + up + right pedal', { cyclicPitch: 1, cyclicRoll: 1, collective: 1, pedal: 1 }], ['aft-left + down + left pedal', { cyclicPitch: -1, cyclicRoll: -1, collective: 0, pedal: -1 }],
    ];
    const ball = new THREE.Vector3();
    for (const [label, c] of set) {
      demo.heliInput = () => fm.setControls({ cyclicPitch: 0, cyclicRoll: 0, pedal: 0, collective: 0.3, ...c });
      for (let i = 0; i < 20; i++) demo.step(1 / 60);
      const pl = demo.vehicles.pilot;
      const sole = {};
      for (const side of ['Left', 'Right']) {
        // ((V4) the sole under the ball, as vehicles.js measures the clip path: the joint plus the body's ballSole)
        const toe = demo.character.bones[side + 'ToeBase'];
        toe.getWorldPosition(ball);
        const bs = demo.character.table && demo.character.table.foot && demo.character.table.foot.ballSole;
        if (bs) ball.add(new THREE.Vector3().fromArray(bs[0]).applyQuaternion(toe.getWorldQuaternion(new THREE.Quaternion())));
        sole[side] = ball.distanceTo(pl.feet[side]) * 100;
      }
      const p = demo.vehicles.stats.palm;
      rows.push({ group: 'reach', item: label, value: Math.max(p.Left, p.Right), unit: 'cm palm (worst)', ref: `palm L ${p.Left.toFixed(2)} R ${p.Right.toFixed(2)}; sole L ${sole.Left.toFixed(1)} R ${sole.Right.toFixed(1)} cm; path ${demo.vehicles.stats.paths.heliSeated}` });
    }
    demo.heliInput = null;
    if (demo.weather) demo.weather.speed = windWas;
    return rows;
  }
  function baseResetPlace(heli) {
    heli.place(HELIPAD.x, HELIPAD.z, 0, 'idle');
  }

  /**
   * (V2) Contact sheets: sheet.open(cols, rows) puts a canvas over the page; sheet.tile(label, place) steps
   * once, lets `place` set the camera, draws and copies the frame in the same task; sheet.close().
   * sheet.post(url) sends the sheet as a JPEG to a local receiver (for reviewing with the pane hidden).
   */
  const sheet = {
    ov: null,
    open(cols = 3, rows = 2, w = 340, h = 250) {
      this.close();
      const c = document.createElement('canvas');
      c.width = cols * w;
      c.height = rows * h;
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;max-width:1024px;max-height:768px';
      document.body.appendChild(c);
      Object.assign(this, { ov: c, w, h, cols, n: 0 });
      return c;
    },
    close() {
      if (this.ov) this.ov.remove();
      this.ov = null;
    },
    cam(pos, at, fov = 50) {
      const c = demo.camera;
      c.position.set(...pos);
      c.lookAt(...at);
      c.fov = fov;
      c.updateProjectionMatrix();
    },
    tile(label, place) {
      if (place) place();
      demo.render();
      const src = demo.renderer.domElement;
      const g = this.ov.getContext('2d');
      const i = this.n++;
      const x = (i % this.cols) * this.w;
      const y = Math.floor(i / this.cols) * this.h;
      const tar = this.w / this.h;
      let sw = src.width;
      let sh = src.height;
      let sx = 0;
      let sy = 0;
      if (sw / sh > tar) {
        sw = sh * tar;
        sx = (src.width - sw) / 2;
      } else {
        sh = sw / tar;
        sy = (src.height - sh) / 2;
      }
      g.drawImage(src, sx, sy, sw, sh, x, y, this.w, this.h);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(x, y, this.w, 16);
      g.fillStyle = '#fff';
      g.font = '11px sans-serif';
      g.fillText(label, x + 4, y + 12);
    },
    async post(name, url = 'http://127.0.0.1:5199/') {
      const b = await new Promise((r) => this.ov.toBlob(r, 'image/jpeg', 0.85));
      await fetch(url + '?n=' + name, { method: 'POST', body: b });
      return name;
    },
  };

  /**
   * (V2) The seated body against the vehicle's parts: every 2nd skin vertex of the body tested against each
   * part's triangles (gunSurface / gunDepth: a spatial hash, depth behind the nearest triangle's face, near
   * surfaces only, within 2 cells). Returns per part the deepest skin (cm), the vertices deeper than 1 cm, and
   * the bone region of the deepest one. Parts: car seat, wheel, door, body shell (sill), interior; helicopter
   * seat, cyclic, collective, door, fuselage, interior.
   * (V3) crossCm / crossN / crossBone: a surface of the part cutting the limb, from the line between the limb's
   * axis (its main bone to that bone's child) and each skin vertex: how far the skin is past the crossing. This
   * one is not fooled by open shells (V2's car calf 15.6 cm and pilot calf 15 cm were the cabin inside the
   * body shell's and fuselage's outer skin, with nothing between the leg and the footwell).
   */
  function bodyClearance(kind = demo.vehicles.kind, { step = 2 } = {}) {
    const veh = kind === 'heli' ? demo.heli : demo.car;
    const parts = kind === 'heli' ? ['pilot_seat', 'cyclic', 'collective', 'cockpit_door_R', 'fuselage', 'interior', 'instrument_panel'] : ['seat_driver', 'steering_wheel', 'door_L', 'body_shell', 'interior'];
    const mesh = demo.character._body.mesh;
    mesh.updateMatrixWorld(true);
    veh.root.updateMatrixWorld(true);
    const bones = mesh.skeleton.bones;
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const out = {};
    const p = new THREE.Vector3();
    const pw = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const d = { depth: 0, part: null };
    // (V3) the limb's own axis under each skin vertex: the segment from its main bone to that bone's first
    // child, in world space
    const axes = bones.map((b) => {
      const a = b.getWorldPosition(new THREE.Vector3());
      const c = b.children.find((x) => x.isBone);
      return [a, c ? c.getWorldPosition(new THREE.Vector3()) : a.clone()];
    });
    const seg = new THREE.Line3();
    const q = new THREE.Vector3();
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    const lo = new THREE.Vector3();
    const hi = new THREE.Vector3();
    veh._surfaces = veh._surfaces || {};
    for (const name of parts) {
      const node = veh.nodes[name];
      if (!node) continue;
      const surf = veh._surfaces[name] || (veh._surfaces[name] = gunSurface({ pivot: node, nodes: {} }));
      inv.copy(node.matrixWorld).invert();
      let deepest = 0;
      let at = null;
      let over1 = 0;
      let cross = 0;
      let crossAt = null;
      let crossN = 0;
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += step) {
        mesh.getVertexPosition(i, pw).applyMatrix4(mesh.matrixWorld);
        p.copy(pw).applyMatrix4(inv);
        let w = 0;
        let b = 0;
        for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > w) {
          w = skinWeight.getComponent(i, k);
          b = skinIndex.getComponent(i, k);
        }
        // (V2's measure: behind the nearest face within 5 cm; an open shell, a cabin inside a body shell,
        // reads as deep)
        gunDepth(surf, p, d);
        if (d.depth > 0.01) over1++;
        if (d.depth > deepest) {
          deepest = d.depth;
          at = bones[b] ? bones[b].name : '?';
        }
        // (V3) does a surface of the part cut the limb: the part's triangles crossing the line from the limb's
        // axis out to this skin vertex; how far past the crossing the skin is
        const [A, B] = axes[b];
        seg.set(A, B).closestPointToPoint(pw, true, q);
        q.applyMatrix4(inv);
        const len = q.distanceTo(p);
        if (len < 1e-4 || len > 0.25) continue;
        ray.origin.copy(q);
        ray.direction.subVectors(p, q).divideScalar(len);
        lo.copy(q).min(p);
        hi.copy(q).max(p);
        const C = 0.025;
        const seen = new Set();
        let best = 0;
        for (let x = Math.floor(lo.x / C); x <= Math.floor(hi.x / C); x++) for (let y = Math.floor(lo.y / C); y <= Math.floor(hi.y / C); y++) for (let z = Math.floor(lo.z / C); z <= Math.floor(hi.z / C); z++) {
          const list = surf.cells.get(surf.key(x, y, z));
          if (!list) continue;
          for (const k of list) {
            if (seen.has(k)) continue;
            seen.add(k);
            const t = surf.tris[k].t;
            if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit)) continue;
            const along = hit.distanceTo(q);
            if (along < len) best = Math.max(best, len - along);
          }
        }
        if (best > 0.005) crossN++;
        if (best > cross) {
          cross = best;
          crossAt = bones[b] ? bones[b].name : '?';
        }
      }
      out[name] = { deepestCm: +(deepest * 100).toFixed(1), over1cm: over1, bone: at, crossCm: +(cross * 100).toFixed(1), crossN, crossBone: crossAt };
    }
    return out;
  }

  /**
   * (V3) Getting in and out, filmed and measured: demo.enterExit('car' | 'heli') walks the player up from 2 m off
   * the entry point, presses T, steps until seated (+1 s), presses T again and steps until on foot. Every frame:
   * the path (clip or placeholder), each pinned contact's error (cm, vehicles.stats.contact), the root's step;
   * every `every` frames bodyClearance (crossCm per part). With `film`, a 4 x 3 sheet of the stages from outside
   * (posted as enter_<kind>.jpg / exit_<kind>.jpg). Returns per phase the worst numbers. Takes a while: run it as
   * demo.enterExit('car').then(r => window.__ee = r).
   */
  async function enterExit(kind = 'car', { film = true, every = 15, tag = '' } = {}) {
    const v = demo.vehicles;
    const veh = kind === 'heli' ? demo.heli : demo.car;
    const p = demo.player;
    const e = v.entryPoint(new THREE.Vector3(), kind);
    const out = (veh.root.localToWorld(new THREE.Vector3(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6)));
    p.pos.set(out.x, 0, out.z);
    p.vel.set(0, 0, 0);
    demo.character.root.position.copy(p.pos);
    demo.character.snapToGround();
    for (let i = 0; i < 20; i++) demo.step(1 / 60);
    if (v.toggle() !== 'in') throw new Error('not near enough to get in');
    const res = {};
    const R = veh.root;
    const camAt = (x, y, z) => R.localToWorld(new THREE.Vector3(x, y, z)).toArray();
    const side = kind === 'heli' ? 1 : -1;
    const view = () => sheet.cam(camAt(side * 3.4, 1.9, kind === 'heli' ? -0.4 : 1.2), camAt(side * 0.6, kind === 'heli' ? 1.4 : 0.7, kind === 'heli' ? -1.3 : -0.3), 45);
    for (const phase of ['enter', 'exit']) {
      const r = (res[phase] = { path: null, seconds: 0, contactWorst: {}, cross: {}, rootStepCm: 0, tiles: 0 });
      if (phase === 'exit') {
        if (v.toggle() !== 'out') throw new Error('could not get out');
      }
      const clipName = phase === 'enter' ? (kind === 'heli' ? 'heli-enter' : 'car-enter') : kind === 'heli' ? 'heli-exit' : 'car-exit';
      const busy = phase === 'enter' ? () => v.mode !== 'seated' : () => v.mode === 'leaving';
      // (the walk to the door first)
      for (let i = 0; i < 600 && phase === 'enter' && v.mode !== 'entering'; i++) demo.step(1 / 60);
      v.stats.clipWorst = {};
      const dur = v.clip ? v.clip.duration : phase === 'enter' ? 3.6 : 3.4;
      const marks = [0.02, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 0.97];
      if (film) sheet.open(3, 3, 400, 300);
      let last = demo.character.root.position.clone();
      let n = 0;
      for (let i = 0; i < 1200 && busy(); i++) {
        demo.step(1 / 60);
        n++;
        r.path = v.stats.paths[clipName];
        const pos = demo.character.root.position;
        r.rootStepCm = Math.max(r.rootStepCm, pos.distanceTo(last) * 100);
        last.copy(pos);
        if (n % every === 0) {
          const c = bodyClearance(kind, { step: 3 });
          for (const [part, x] of Object.entries(c)) if (x.crossCm > (r.cross[part] ? r.cross[part][0] : -1)) r.cross[part] = [x.crossCm, x.crossBone, +(v.t || 0).toFixed(2)];
        }
        if (film && r.tiles < marks.length && v.t >= marks[r.tiles] * dur) {
          for (let k = 0; k < 2; k++) demo.render();
          const ct = v.stats.contact ? Object.entries(v.stats.contact).map(([k2, x]) => `${k2} ${x}`).join(' ') : '';
          sheet.tile(`${phase} ${v.t.toFixed(2)} s door ${v.door.toFixed(2)} ${r.path} ${ct}`, view);
          r.tiles++;
        }
      }
      r.seconds = +(n / 60).toFixed(2);
      r.contactWorst = Object.fromEntries(Object.entries(v.stats.clipWorst[clipName] || {}).map(([k2, x]) => [k2, +x.toFixed(2)]));
      if (film) await sheet.post(`${tag}${phase}_${kind}`);
      if (phase === 'enter') for (let i = 0; i < 60; i++) demo.step(1 / 60);
    }
    for (let i = 0; i < 120 && v.mode !== 'foot'; i++) demo.step(1 / 60);
    return res;
  }

  return { review, trace, record, measure, SITUATIONS, vehicleReview, seatInCar, heliReview, heliReach, seatInHeli, sheet, bodyClearance, enterExit, ...makeChain(demo, sheet) };
}
