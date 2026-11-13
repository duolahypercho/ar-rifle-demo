// The driver (pass V1): the character posed in the car's seat by run-time IK from the car's own nodes,
// the placeholder until the authored clip pack (vehicle-motion-*-v1, vehicles.js) is there, and the
// layer that keeps the hands and feet on the controls when it is.
//
//   hips      on seat_driver_point, the pelvis rolled back into the seat, the trunk reclined against
//             the seat back, leaning with the car's lateral and longitudinal g, breathing
//   head      turned into the corner (from the steering and the yaw rate), counter-rolled to keep the
//             eyes level, nodding with braking
//   hands     on the rim of steering_wheel, palms against the tube, wrapped by the grip pose; they turn
//             with the wheel to about 110 degrees either side of 9 and 3. Past that, push-pull: the
//             hand that would go over the top or under the bottom lets go and moves back round the rim
//             (lifted 4 cm off it, 0.22 s) while the other turns the wheel; the hands never cross, one
//             is always on the rim, and at rest they go home to 9 and 3 one at a time
//   feet      right on the throttle pad or the brake pad (moved across in 0.18 s when the pedal changes),
//             toes up as the pedal is pressed; left on the footrest
//   paddles   a shift flicks the index and middle fingers of that side's hand off the rim and back
//
// Everything is placed in the vehicle's frame (glTF: +X right, +Y up, -Z forward) and turned into the
// world by the car's root, so the driver moves with the body's pitch and roll.
import * as THREE from 'three/webgpu';
import { damp, Smooth, PALM_LOCAL } from './character.js';
import { RimHands } from './car/hands.js';

const DEG = Math.PI / 180;
// the car's controls in vehicle_root's frame (measured off the model: interior mesh, footwell)
export const CAR_POINTS = {
  seat: new THREE.Vector3(-0.37, 0.3, 0.06), // seat_driver_point (the node's own place is read when the car is loaded)
  throttle: new THREE.Vector3(-0.27, 0.27, -1.05), // pad face centre
  brake: new THREE.Vector3(-0.4, 0.3, -1.04),
  rest: new THREE.Vector3(-0.505, 0.3, -1.06), // footrest
  rim: 0.152, // m from the wheel's centre to the rim tube's centre at 9 and 3
  rimPlane: -0.012, // the rim's plane along the column (wheel's local Y)
  tube: 0.017,
};
const HAND_HOME = { Left: 90 * DEG, Right: -90 * DEG }; // from 12 o'clock, + to the left (as the driver sees it)
// the hip joint from seat_driver_point (m, vehicle frame): measured in the game, the point is the seat's
// back corner; the hips sit 12 cm forward of it, or the arms do not reach the rim (shoulder to rim 0.69 m
// against an arm of 0.52 with the hips on the point)
export const HIPS_OFFSET = new THREE.Vector3(0, 0.035, -0.12);

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const IDENT = new THREE.Quaternion();

/** The driver's state between frames. */
export class Seated {
  constructor() {
    this.hands = {
      Left: { grip: HAND_HOME.Left, moving: null, palm: new THREE.Vector3(), quat: new THREE.Quaternion(), on: 1 },
      Right: { grip: HAND_HOME.Right, moving: null, palm: new THREE.Vector3(), quat: new THREE.Quaternion(), on: 1 },
    };
    this.rightFoot = { on: 'throttle', u: 1, from: 'throttle' };
    this.flick = { Left: 0, Right: 0 };
    this.look = new Smooth();
    this.lean = new Smooth();
    this.nod = new Smooth();
    this.time = 0;
    this.lastWheel = 0;
    this.wheelRate = 0;
    this.palmErr = { Left: 0, Right: 0 }; // cm, palm from the rim's tube surface (review)
  }

  /** A shift: flick that side's paddle (up = right). */
  paddle(up) {
    this.flick[up ? 'Right' : 'Left'] = 1;
  }

  /** The hand targets on the rim for this frame (world), with the push-pull logic (car/hands.js, V3). */
  _handsOnRim(dt, car) {
    const wheel = car.nodes.steering_wheel;
    const theta = car.dyn.steerWheel;
    if (dt > 0) this.wheelRate = damp(this.wheelRate, (theta - this.lastWheel) / dt, 20, dt);
    this.lastWheel = theta;
    wheel.updateWorldMatrix(true, false);
    const wq = wheel.getWorldQuaternion(_q2);
    // (V3: V2's regrip lifted the hand 4 cm off the rim for 0.22 s and let both ends of the range meet: the
    // right palm was up to 15 cm off and the hands off the rim 3.8 s of a 9 s lock to lock. Now push-pull as
    // taught: one hand always grips, the other slides on the rim; at speed the hands ride at 9 and 3)
    if (dt > 0 || !this.rimHands) {
      if (!this.rimHands) this.rimHands = new RimHands();
      this.rimHands.update(theta, dt, Math.abs(car.dyn.speed));
    }
    const RH = this.rimHands.hands;
    for (const side of ['Left', 'Right']) {
      const h = this.hands[side];
      const st = RH[side];
      const world = st.w;
      h.grip = st.w - theta;
      h.moving = null;
      h.sliding = !st.grip;
      h.off = !!st.off;
      h.lift = 0;
      h.world = world;
      // rim point and hand frame in the wheel's own frame (12 o'clock is local -Z, 3 is +X, Y towards
      // the driver), at the grip's angle relative to the wheel
      const phi = world - theta; // angle on the wheel
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      const lift = h.lift || 0;
      const G = this.grip; // (V2) the pack's grip: the palm's middle at radius R, y along the column
      if (G) _a.set(-s * G.R, G.y, -c * G.R);
      else _a.set(-s * CAR_POINTS.rim, CAR_POINTS.rimPlane, -c * CAR_POINTS.rim); // tube centre, local
      const tUp = _x.set(c, 0, -s); // towards 12 o'clock along the rim
      const rin = _b.set(s, 0, c); // towards the centre
      const col = _c.set(0, -1, 0); // away from the driver
      const n = _z.copy(col).multiplyScalar(0.42).addScaledVector(rin, 0.9).normalize(); // palm normal
      // palm on the tube's driver-outer side
      const palmLocal = G ? _v.copy(_a).addScaledVector(col, -lift) : _v.copy(_a).addScaledVector(n, -(CAR_POINTS.tube + 0.012)).addScaledVector(col, -lift);
      wheel.localToWorld(h.palm.copy(palmLocal));
      // basis: left hand thumb (+X) towards 12; right hand thumb (-X) towards 12
      const X = side === 'Left' ? tUp : tUp.negate();
      const Yv = _y.crossVectors(n, X);
      X.applyQuaternion(wq);
      Yv.applyQuaternion(wq);
      n.applyQuaternion(wq);
      h.quat.setFromRotationMatrix(_m.makeBasis(X, Yv, n));
      h.rim = h.rim || new THREE.Vector3();
      wheel.localToWorld(h.rim.copy(_a));
      h.normal = h.normal || new THREE.Vector3();
      h.normal.copy(n);
    }
  }

  /**
   * Poses `character` seated in `car` (the proxy skeleton, then the real bones). `weight` 0..1 blends
   * from whatever pose the proxy has (standing) to seated; `handsOn` 0..1 the hands from the
   * blended arms to the rim. Returns nothing; character.eye is set.
   */
  pose(dt, character, car, { weight = 1, handsOn = 1, root = null, alive = 0, trunk = true, points = null } = {}) {
    const P = points || CAR_POINTS;
    this.time += dt;
    const b = character.bones;
    const d = car.dyn;
    const V = car.root;
    V.updateMatrixWorld(true);
    const seat = car.nodes.seat_driver_point ? car.nodes.seat_driver_point.position : CAR_POINTS.seat;
    // the root: on the floor under the seat, turned with the car (pitch and roll included)
    if (!root) {
      character.root.position.copy(V.localToWorld(_v.set(seat.x, 0, seat.z)));
      character.root.quaternion.copy(V.getWorldQuaternion(_q));
    }
    character.root.updateMatrixWorld(true);
    // standing pose kept for the blend
    const names = Object.keys(b);
    if (weight < 1) {
      this._keep = this._keep || {};
      for (const name of names) (this._keep[name] = this._keep[name] || new THREE.Quaternion()).copy(b[name].quaternion);
      this._keepHips = (this._keepHips || new THREE.Vector3()).copy(b.Hips.position);
    }
    // g on the driver: the car's acceleration in its frame (+x right, -z forward)
    const latG = d.accBody.x / 9.81;
    const lonG = -d.accBody.z / 9.81; // + accelerating
    const lean = this.lean.to(THREE.MathUtils.clamp(latG, -1.6, 1.6), 0.12, dt);
    const nod = this.nod.to(THREE.MathUtils.clamp(lonG, -1.5, 1.2), 0.12, dt);
    // where the eyes go: into the corner, from the steering and the yaw rate
    const yawRate = d.omega.y;
    const lookWant = THREE.MathUtils.clamp(d.steerWheel * 0.12 + yawRate * 0.18, -0.6, 0.6);
    const look = this.look.to(lookWant + (this.lookBack || 0), 0.25, dt);
    const breath = Math.sin(this.time * 1.6) * 0.012 + alive;

    // ---- hips and trunk (model frame: +Z forward, +X the driver's left) ----
    // (V2: trunk false = the pack's clip has posed root, hips and trunk already)
    if (trunk) {
    const hipsWorld = V.localToWorld(_a.copy(seat).add(HIPS_OFFSET));
    b.Hips.parent.updateWorldMatrix(true, false);
    const hipsLocal = b.Hips.parent.worldToLocal(_b.copy(hipsWorld));
    // pelvis rolled back, swayed by the lateral g (the body slides a little in the seat)
    _q.setFromEuler(_e.set(-0.32 + nod * 0.03, 0, -lean * 0.035, 'XYZ'));
    if (weight < 1) {
      b.Hips.position.lerpVectors(this._keepHips, hipsLocal, weight);
      b.Hips.quaternion.copy(this._keep.Hips).slerp(_q, weight);
    } else {
      b.Hips.position.copy(hipsLocal);
      b.Hips.quaternion.copy(_q);
    }
    // the trunk up the seat back: the chain's locals (reclined, leaning with the g, breathing)
    const chain = [
      ['Spine', 0.17 + breath, -0.004, 0.25],
      ['Spine1', 0.13 + breath, 0.0, 0.3],
      ['Spine2', 0.08 - breath, 0.0, 0.3],
      ['Neck', 0.14 - nod * 0.06, 0.4, -0.2],
      ['Head', 0.16 - nod * 0.05, 0.6, -0.65],
    ];
    for (const [name, pitch, yawShare, leanShare] of chain) {
      _q.setFromEuler(_e.set(pitch, look * yawShare, -lean * 0.06 * leanShare, 'YXZ'));
      b[name].quaternion.copy(weight < 1 ? this._keep[name] : IDENT).slerp(_q, weight < 1 ? weight : 1);
      if (weight >= 1) b[name].quaternion.copy(_q);
    }
    for (const name of ['LeftShoulder', 'RightShoulder']) {
      if (weight < 1) b[name].quaternion.copy(this._keep[name]).slerp(IDENT, weight);
      else b[name].quaternion.identity();
    }
    }
    character.model.updateMatrixWorld(true);

    // ---- legs: right foot on its pedal, left on the footrest ----
    const rf = this.rightFoot;
    const want = d.input.brake > 0.05 && d.gear !== 0 ? 'brake' : d.gear === 0 && d.input.brake > 0.05 ? 'brake' : 'throttle';
    if (want !== rf.on) {
      rf.from = rf.on;
      rf.on = want;
      rf.u = 0;
    }
    rf.u = Math.min(1, rf.u + dt / 0.18);
    const press = rf.on === 'brake' ? Math.min(1, d.pressure * 1.3) : d.input.throttle;
    const wq = V.getWorldQuaternion(_q2);
    // ball of the foot from the ankle (canonical); ((V4) and down to the sole under it, the body's ballSole, as on the clip
    // path: the pad points are soles, and the joint on them left the soles 1.7 cm low)
    const toe = character.motion.rest.LeftToeBase.clone();
    const sole = character.table && character.table.foot && character.table.foot.ballSole;
    if (sole) toe.add(new THREE.Vector3().fromArray(sole[0]));
    const modelQ = character.model.getWorldQuaternion(new THREE.Quaternion());
    const legs = [
      ['Left', P.rest, 0.62],
      ['Right', null, 0.5 - press * 0.22],
    ];
    for (const [side, pad, pitch] of legs) {
      let p = pad;
      if (!p) {
        const from = P[rf.from];
        const to = P[rf.on];
        const u = rf.u * rf.u * (3 - 2 * rf.u);
        p = _c.lerpVectors(from, to, u);
        p.y += Math.sin(Math.PI * rf.u) * 0.05; // lifted across
        p.z -= press * 0.025 * (rf.on === 'brake' ? 0.6 : 1); // the pad travels
      }
      // the ball against the pad's face, toes up by `pitch`
      const footQ = _q.copy(modelQ).multiply(_q2.setFromEuler(_e.set(-pitch, side === 'Left' ? 0.12 : -0.06, 0, 'XYZ')));
      const ball = V.localToWorld(_a.copy(p).add(_v.set(0, -0.005, 0.03)));
      const ankle = _b.copy(toe).applyQuaternion(footQ).negate().add(ball);
      // knees up and a little out
      const pole = _v.set(side === 'Left' ? -0.35 : 0.25, 1, -0.4).applyQuaternion(wq);
      if (weight >= 1) character._leg(side, ankle, pole, footQ, 0);
      else {
        // (blending in: the legs from the stance towards the seat)
        const keepU = this._keep[side + 'UpLeg'].clone();
        const keepL = this._keep[side + 'Leg'].clone();
        const keepF = this._keep[side + 'Foot'].clone();
        character._leg(side, ankle, pole, footQ, 0);
        b[side + 'UpLeg'].quaternion.slerpQuaternions(keepU, b[side + 'UpLeg'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
        b[side + 'Leg'].quaternion.slerpQuaternions(keepL, b[side + 'Leg'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
        b[side + 'Foot'].quaternion.slerpQuaternions(keepF, b[side + 'Foot'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
      }
      character.model.updateMatrixWorld(true);
    }

    // ---- hands on the rim ----
    this._handsOnRim(dt, car);
    for (const side of ['Left', 'Right']) {
      this.flick[side] = Math.max(0, this.flick[side] - dt / 0.22);
    }
    character.model.updateMatrixWorld(true);
    const out = (this._out = this._out || { palm: {}, quat: {} });
    for (const side of ['Left', 'Right']) {
      const h = this.hands[side];
      out.palm[side] = h.palm;
      out.quat[side] = h.quat;
    }
    return out;
  }

  /** Finishes the arms (after pose(): the targets, or blended ones) and the real bones. */
  arms(character, car, targets, curl = 1) {
    const b = character.bones;
    const V = car.root;
    const wq = V.getWorldQuaternion(_q2);
    // (V3) a hand whose grip is past the arm's reach even with the clavicle: the chest turns and leans toward it
    // (up to 12 deg at Spine2), as a driver's shoulder follows the hand up the rim at 60 to 90 deg of wheel
    if (this.grip) reachWithChest(character, targets);
    for (const side of ['Left', 'Right']) {
      // (V3: up to 34 deg of clavicle, from 18: the push-pull's 2 o'clock grip with the right hand is past the
      // V2 limit by 4 cm; a driver's shoulder comes off the seat back for it)
      if (this.grip) reachWithShoulder(character, side, targets.palm[side], targets.quat[side], 0.6);
      const pole = _v.set(side === 'Left' ? -0.9 : 0.9, -0.8, 0.3).applyQuaternion(wq);
      character._arm(side, targets.palm[side], targets.quat[side], this.hands[side].sliding ? curl * 0.8 : curl, pole);
      // the paddle flick: index and middle straighten off the rim and come back
      const f = this.flick[side];
      if (f > 0) {
        const k = Math.sin(Math.PI * f);
        for (const finger of ['Index', 'Middle']) for (let i = 1; i <= 3; i++) {
          const bone = b[`${side}Hand${finger}${i}`];
          if (bone) bone.quaternion.slerp(IDENT, k * 0.8);
        }
      }
    }
    character.model.updateMatrixWorld(true);
    // the eye (first-person and the cockpit camera use it)
    b.Head.getWorldQuaternion(_q);
    b.Head.getWorldPosition(character.eye).add(_a.copy(character._body.eyeLocal).applyQuaternion(_q));
    character.rig.apply();
    // how far each palm ended up from the rim tube's surface (cm), for the review
    for (const side of ['Left', 'Right']) {
      const h = this.hands[side];
      const hand = b[side + 'Hand'];
      hand.getWorldQuaternion(_q);
      const palm = hand.getWorldPosition(_a).add(_b.copy(PALM_LOCAL).applyQuaternion(_q));
      const gap = this.grip ? palm.distanceTo(h.palm) : palm.distanceTo(h.rim) - (CAR_POINTS.tube + 0.012);
      this.palmErr[side] = h.off ? -1 : Math.abs(gap) * 100;
    }
  }
}

/**
 * (V2) When the wrist's target is past the arm's reach, the clavicle protracts toward it (up to 18 deg),
 * as a driver's shoulder comes off the seat back to reach round the rim.
 */
const _s1 = new THREE.Vector3();
const _s2 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const _sq2 = new THREE.Quaternion();
export function reachWithShoulder(character, side, palm, handQ, max = 0.32) {
  const b = character.bones;
  const sh = b[side + 'Shoulder'];
  const up = b[side + 'Arm'];
  if (!sh || !up) return 0;
  const arm = character._body.arms[side];
  const L = (arm.upper + arm.fore) * 0.985;
  character.model.updateMatrixWorld(true);
  const S = sh.getWorldPosition(_s1);
  const U = up.getWorldPosition(_s2);
  const W = _s3.copy(PALM_LOCAL).applyQuaternion(handQ).negate().add(palm);
  const d = U.distanceTo(W);
  if (d <= L) return 0;
  const a = U.clone().sub(S);
  const bvec = W.clone().sub(S);
  const axis = new THREE.Vector3().crossVectors(a, bvec);
  if (axis.lengthSq() < 1e-10) return 0;
  axis.normalize();
  const ang = Math.min(max, (d - L) / Math.max(0.05, a.length()), a.angleTo(bvec));
  _sq.setFromAxisAngle(axis, ang);
  sh.getWorldQuaternion(_sq2);
  _sq2.premultiply(_sq);
  sh.parent.getWorldQuaternion(_sq);
  sh.quaternion.copy(_sq.invert().multiply(_sq2));
  character.model.updateMatrixWorld(true);
  return ang;
}

/**
 * (V3) Turns Spine2 so the shoulder of the side that is short of its wrist target comes toward it, by the shortfall
 * the clavicle cannot make up (its 34 deg moves the shoulder about 6 cm), up to `max` rad. Only one side at a time:
 * the other hand's target is checked to stay in reach.
 */
export function reachWithChest(character, targets, max = 0.21) {
  const b = character.bones;
  const chest = b.Spine2;
  if (!chest) return 0;
  character.model.updateMatrixWorld(true);
  const short = {};
  for (const side of ['Left', 'Right']) {
    const arm = character._body.arms[side];
    const L = (arm.upper + arm.fore) * 0.985 + 0.06; // (+ what the clavicle gives)
    const U = b[side + 'Arm'].getWorldPosition(new THREE.Vector3());
    const W = new THREE.Vector3().copy(PALM_LOCAL).applyQuaternion(targets.quat[side]).negate().add(targets.palm[side]);
    short[side] = { d: U.distanceTo(W) - L, U, W };
  }
  const side = short.Left.d > short.Right.d ? 'Left' : 'Right';
  const s = short[side];
  if (s.d <= 0) return 0;
  const P = chest.getWorldPosition(new THREE.Vector3());
  const a = s.U.clone().sub(P);
  const t = s.W.clone().sub(P);
  const axis = new THREE.Vector3().crossVectors(a, t);
  if (axis.lengthSq() < 1e-10) return 0;
  axis.normalize();
  const ang = Math.min(max, s.d / Math.max(0.1, a.length()), a.angleTo(t));
  const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
  const wq = chest.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
  const pq = chest.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  chest.quaternion.copy(pq.multiply(wq));
  character.model.updateMatrixWorld(true);
  return ang;
}

/**
 * Empty hands (both guns on the back): palms by the thighs, swinging a little with the stride.
 * Fills a `hands` object as weapon.hands has it, for character.poseArms.
 */
export function emptyHands(character, out, phase = 0, swing = 0) {
  const b = character.bones;
  character.model.updateMatrixWorld(true);
  const mq = character.model.getWorldQuaternion(_q2);
  for (const side of ['Left', 'Right']) {
    const s = side === 'Left' ? 1 : -1;
    const sw = Math.sin(phase * Math.PI * 2) * swing * s;
    b[side + 'UpLeg'].getWorldPosition(_a);
    const palm = _a.add(_b.set(s * 0.1, -0.12, 0.05 + sw * 0.12).applyQuaternion(mq));
    (out[side === 'Left' ? 'lPalm' : 'rPalm'] = out[side === 'Left' ? 'lPalm' : 'rPalm'] || new THREE.Vector3()).copy(palm);
    // palms turned in to face the thighs, fingers down
    const q = (out[side === 'Left' ? 'lQuat' : 'rQuat'] = out[side === 'Left' ? 'lQuat' : 'rQuat'] || new THREE.Quaternion());
    q.copy(mq).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), -s * Math.PI / 2)).multiply(_q.setFromAxisAngle(X_AXIS, sw * 0.4));
  }
  out.lCurl = out.rCurl = 0.35;
  out.rIndex = 0;
  out.rOn = 0;
  out.lElbow = out.rElbow = null;
  out.lPole = out.lPole || new THREE.Vector3(0.3, -1, -0.4);
  out.rPole = out.rPole || new THREE.Vector3(-0.3, -1, -0.4);
  return out;
}
