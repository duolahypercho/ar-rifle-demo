// The pilot (pass V2): the character in the helicopter's right front seat, posed by run-time IK from the
// aircraft's own nodes. The placeholder for bodies whose vehicle pack has no helicopter clips (the
// EarthOnline bodies today), and the grip / pedal points the pack path pins to as well.
//
//   hips      on seat_pilot_point (with the body's vehicleFit), the trunk leaning a little forward to
//             the cyclic, swaying with the aircraft's accelerations, breathing
//   right     palm on the cyclic grip (the pack's contact point in the cyclic's frame), thumb up on the
//             top of the grip; it moves with the cyclic node, so with the stick
//   left      palm on the collective's grip at the lever's forward end, following the lever up and down
//   feet      balls of the feet on pedal_L / pedal_R, following the pedals fore and aft
//   head      looks into the turn (yaw rate) and a little down in the hover
//
// Points in each node's own glTF frame, from vehicle-motion-tripo-v1's heli-fly contacts (21:06 pack).
import * as THREE from 'three/webgpu';
import { Smooth } from '../character.js';
import { reachWithShoulder } from '../seated.js';

export const HELI_POINTS = {
  cyclic: new THREE.Vector3(0.0323, 0.5971, 0.0946), // palm middle, cyclic frame
  collective: new THREE.Vector3(-0.0255, 0.2334, -0.4551), // palm middle, collective frame
  pedal: new THREE.Vector3(0.0, 0.128, 0.0), // ball of the foot, pedal frame
};
// hips from seat_pilot_point (vehicle frame): the point is the cushion's back corner
const HIPS_OFFSET = new THREE.Vector3(0, 0.07, -0.13);

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const IDENT = new THREE.Quaternion();

/** Hand frame from thumb direction and palm normal (world), as seated.js builds it. */
export function handQuat(side, thumb, normal, out) {
  const X = _x.copy(thumb).normalize();
  if (side === 'Right') X.negate();
  const n = _z.copy(normal).normalize();
  // make X perpendicular to n
  X.addScaledVector(n, -X.dot(n)).normalize();
  const Yv = _y.crossVectors(n, X);
  return out.setFromRotationMatrix(_m.makeBasis(X, Yv, n));
}

export class HeliSeated {
  constructor() {
    this.time = 0;
    this.lean = new Smooth();
    this.nod = new Smooth();
    this.look = new Smooth();
    this.palm = { Left: new THREE.Vector3(), Right: new THREE.Vector3() };
    this.quat = { Left: new THREE.Quaternion(), Right: new THREE.Quaternion() };
    this.palmErr = { Left: 0, Right: 0 };
    this.lastV = null;
    this.acc = new THREE.Vector3();
  }

  /** The control targets (world) for this frame: palms, hand frames, balls of the feet. */
  targets(heli) {
    const n = heli.nodes;
    heli.root.updateMatrixWorld(true);
    const rq = heli.root.getWorldQuaternion(_q2);
    // right: on the cyclic grip, thumb up the grip, palm facing forward-left round it
    n.cyclic.localToWorld(this.palm.Right.copy(HELI_POINTS.cyclic));
    const cq = n.cyclic.getWorldQuaternion(new THREE.Quaternion());
    handQuat('Right', _a.set(0, 1, 0).applyQuaternion(cq), _b.set(-0.35, 0, -0.94).applyQuaternion(cq), this.quat.Right);
    // left: on the collective's grip, thumb forward along the lever, palm down and in
    n.collective.localToWorld(this.palm.Left.copy(HELI_POINTS.collective));
    const lq = n.collective.getWorldQuaternion(new THREE.Quaternion());
    handQuat('Left', _a.set(0, 0.25, -1).applyQuaternion(lq), _b.set(0.25, -0.97, 0).applyQuaternion(lq), this.quat.Left);
    this.feet = this.feet || { Left: new THREE.Vector3(), Right: new THREE.Vector3() };
    n.pedal_L.localToWorld(this.feet.Left.copy(HELI_POINTS.pedal));
    n.pedal_R.localToWorld(this.feet.Right.copy(HELI_POINTS.pedal));
    void rq;
    return this;
  }

  /** Placeholder pose: hips and trunk; then legs and arms to the controls. `weight` blends from standing. */
  pose(dt, character, heli, { weight = 1, handsOn = 1, root = null } = {}) {
    this.time += dt;
    const b = character.bones;
    const V = heli.root;
    V.updateMatrixWorld(true);
    const seat = heli.nodes.seat_pilot_point.position;
    if (!root) {
      character.root.position.copy(V.localToWorld(_v.set(seat.x, 0, seat.z)));
      character.root.quaternion.copy(V.getWorldQuaternion(_q));
    }
    character.root.updateMatrixWorld(true);
    const names = Object.keys(b);
    if (weight < 1) {
      this._keep = this._keep || {};
      for (const name of names) (this._keep[name] = this._keep[name] || new THREE.Quaternion()).copy(b[name].quaternion);
      this._keepHips = (this._keepHips || new THREE.Vector3()).copy(b.Hips.position);
    }
    // accelerations in the body frame (+x right, -z forward)
    const s = heli.state;
    if (this.lastV && dt > 0) this.acc.set((s.velocity.x - this.lastV.x) / dt, (s.velocity.y - this.lastV.y) / dt, (s.velocity.z - this.lastV.z) / dt);
    this.lastV = { ...s.velocity };
    const accB = _a.copy(this.acc).applyQuaternion(_q.copy(V.quaternion).invert());
    const lean = this.lean.to(THREE.MathUtils.clamp(accB.x / 9.81, -1, 1), 0.15, dt);
    const nod = this.nod.to(THREE.MathUtils.clamp(-accB.z / 9.81, -1, 1), 0.15, dt);
    const look = this.look.to(THREE.MathUtils.clamp(-(s.rates ? s.rates.yawRight : 0) * 0.3, -0.5, 0.5), 0.3, dt);
    const breath = Math.sin(this.time * 1.5) * 0.012;
    const hipsWorld = V.localToWorld(_a.copy(seat).add(HIPS_OFFSET));
    b.Hips.parent.updateWorldMatrix(true, false);
    const hipsLocal = b.Hips.parent.worldToLocal(_b.copy(hipsWorld));
    _q.setFromEuler(_e.set(-0.22 + nod * 0.03, 0, -lean * 0.03, 'XYZ'));
    if (weight < 1) {
      b.Hips.position.lerpVectors(this._keepHips, hipsLocal, weight);
      b.Hips.quaternion.copy(this._keep.Hips).slerp(_q, weight);
    } else {
      b.Hips.position.copy(hipsLocal);
      b.Hips.quaternion.copy(_q);
    }
    const chain = [
      ['Spine', 0.2 + breath, 0, 0.25],
      ['Spine1', 0.16 + breath, 0.1, 0.3],
      ['Spine2', 0.1 - breath, 0.2, 0.3],
      ['Neck', 0.05 - nod * 0.05, 0.3, -0.2],
      ['Head', 0.12 - nod * 0.04, 0.4, -0.6],
    ];
    for (const [name, pitch, yawShare, leanShare] of chain) {
      _q.setFromEuler(_e.set(pitch, look * yawShare, -lean * 0.06 * leanShare, 'YXZ'));
      if (weight < 1) b[name].quaternion.copy(this._keep[name]).slerp(_q, weight);
      else b[name].quaternion.copy(_q);
    }
    for (const name of ['LeftShoulder', 'RightShoulder']) {
      if (weight < 1) b[name].quaternion.copy(this._keep[name]).slerp(IDENT, weight);
      else b[name].quaternion.identity();
    }
    character.model.updateMatrixWorld(true);
    this.targets(heli);
    this.legs(character, heli, weight);
    void handsOn;
    return this;
  }

  /** Balls of the feet on the pedals (toes a little up), knees up and out. */
  legs(character, heli, weight = 1, footQ = null) {
    const b = character.bones;
    const wq = heli.root.getWorldQuaternion(_q2).clone();
    const modelQ = character.model.getWorldQuaternion(new THREE.Quaternion());
    // ((V4) the pedal point is the sole under the ball (the clips' 'ball' contact): the joint goes the body's ballSole
    // above it, as on the clip path (vehicles.js); the joint itself went there and the soles sat 1.7 cm low)
    const sole = character.table && character.table.foot && character.table.foot.ballSole;
    const toe = character.motion.rest.LeftToeBase.clone();
    if (sole) toe.add(_v.fromArray(sole[0]));
    for (const side of ['Left', 'Right']) {
      const fq = footQ && footQ[side] ? footQ[side] : _q.copy(modelQ).multiply(_q2.setFromEuler(_e.set(-0.55, side === 'Left' ? 0.08 : -0.08, 0, 'XYZ'))).clone();
      const ball = this.feet[side];
      const ankle = _b.copy(toe).applyQuaternion(fq).negate().add(ball);
      const pole = _v.set(side === 'Left' ? -0.3 : 0.3, 1, -0.5).applyQuaternion(wq);
      if (weight >= 1) character._leg(side, ankle.clone(), pole.clone(), fq, 0);
      else {
        const keepU = this._keep[side + 'UpLeg'].clone();
        const keepL = this._keep[side + 'Leg'].clone();
        const keepF = this._keep[side + 'Foot'].clone();
        character._leg(side, ankle.clone(), pole.clone(), fq, 0);
        b[side + 'UpLeg'].quaternion.slerpQuaternions(keepU, b[side + 'UpLeg'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
        b[side + 'Leg'].quaternion.slerpQuaternions(keepL, b[side + 'Leg'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
        b[side + 'Foot'].quaternion.slerpQuaternions(keepF, b[side + 'Foot'].quaternion.clone(), weight); // ((V6) was .copy(keep).slerp(.clone()): the clone was taken after the copy, so the legs stayed standing and jumped to the seat at weight 1)
      }
      character.model.updateMatrixWorld(true);
    }
  }

  /** Arms to the grips (after pose or the pack's trunk), the eye, the real bones; palm errors in cm. */
  arms(character, heli, palms = this.palm, quats = this.quat, curl = 1, handsOn = 1, empty = null) {
    const wq = heli.root.getWorldQuaternion(_q2).clone();
    for (const side of ['Left', 'Right']) {
      const pole = _v.set(side === 'Left' ? -0.9 : 0.9, -0.8, 0.3).applyQuaternion(wq);
      let P = palms[side];
      let Q = quats[side];
      if (handsOn < 1 && empty) {
        P = P.clone().lerp(side === 'Left' ? empty.lPalm : empty.rPalm, 1 - handsOn);
        Q = (side === 'Left' ? empty.lQuat : empty.rQuat).clone().slerp(Q, handsOn);
      }
      if (handsOn >= 1) reachWithShoulder(character, side, P, Q);
      character._arm(side, P, Q, curl * (0.35 + 0.65 * handsOn), pole.clone());
    }
    character.model.updateMatrixWorld(true);
    const b = character.bones;
    b.Head.getWorldQuaternion(_q);
    b.Head.getWorldPosition(character.eye).add(_a.copy(character._body.eyeLocal).applyQuaternion(_q));
    character.rig.apply();
    return this;
  }
}
