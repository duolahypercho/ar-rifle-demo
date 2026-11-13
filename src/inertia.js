// (V6) Inertial blending of the whole pose across a hand-over (Bollo, "Inertialization", GDC 2018).
//
// Every frame the final pose (each proxy joint's local rotation, the Hips' position, the character root's world
// position and turn) is kept, with the one before it. When the thing posing the body changes (the stow clip ending,
// an exit clip handing over to on-foot control, the draw ending), the new system poses the body as it likes and the
// difference to where the old one would have carried it on is added back as an offset that dies away over T with a
// quintic: the offset's value and rate at the hand-over are the old pose's continued, its rate and acceleration
// reach 0 at T. So nothing jumps, in place or in speed, and nothing is blended on IK targets.
// Offsets are rotation vectors in each joint's parent frame (small-angle composition is good to well under a degree
// at these sizes). The new pose's own rate is read on its second frame, so the offset's start rate is the old pose's
// rate less the new pose's.
// A foot planted on the ground in both the old and the new pose (within 3 cm) is held where the new pose has it while
// the offset dies away: the legs are re-solved to it (a contact, not a blend target).
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';
import { ANKLE_HEIGHT } from './character.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** The rotation vector of q (axis * angle, shortest way). */
function rotvec(q, out) {
  let { x, y, z, w } = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return out.set(2 * x, 2 * y, 2 * z);
  const angle = 2 * Math.atan2(s, w);
  return out.set(x, y, z).multiplyScalar(angle / s);
}

function fromRotvec(v, out) {
  const angle = v.length();
  if (angle < 1e-9) return out.set(v.x * 0.5, v.y * 0.5, v.z * 0.5, 1).normalize();
  return out.setFromAxisAngle(_c.copy(v).divideScalar(angle), angle);
}

/** Quintic decay of x0 (rate v0) to 0 at T, at time t: value into `out` (vector-wise). */
function decay(x0, v0, T, t, out) {
  if (t >= T) return out.set(0, 0, 0);
  const T2 = T * T;
  const k = (x, v) => {
    const a0 = (-8 * v * T - 20 * x) / T2;
    const A = -(a0 * T2 + 6 * v * T + 12 * x) / (2 * T2 * T2 * T);
    const B = (3 * a0 * T2 + 16 * v * T + 30 * x) / (2 * T2 * T2);
    const C = -(3 * a0 * T2 + 12 * v * T + 20 * x) / (2 * T2 * T);
    return (((A * t + B) * t + C) * t + a0 / 2) * t * t + v * t + x;
  };
  return out.set(k(x0.x, v0.x), k(x0.y, v0.y), k(x0.z, v0.z));
}

const ARM = /^(Left|Right)(Arm|ForeArm|Hand)/;

export class PoseInertia {
  constructor(character) {
    this.ch = character;
    this.T = 0.35; // s
    // ((V8) per hand-over: the stow's end into the walk to the door hands over a right hand that was still swinging
    // down from the back (the chain measured 1.86 to 2.3 m/s of change in a frame at 0.35 s, 2.0 at 0.6 s); 1.3 s there for the arms (0.9: 1.99) (on the whole body it carried the
    // root's offset into the walk's first turn: a 1.2 cm root jump on the way to the helicopter)
    this.Tfor = { 'foot:stowing>foot:walking': 1.3 }; // (inside > foot:drawing at 0.6 s read 2.12 m/s against 1.96 to 2.00 at 0.35: left as it was)
    this.Tnow = this.T;
    this.tag = null; // what posed the last frame kept
    this.on = false;
    this.stats = { starts: 0, last: null };
    this._init();
  }

  _init() {
    const ch = this.ch;
    this.names = Object.keys(ch.bones);
    const mk = () => ({ q: Object.fromEntries(this.names.map((n) => [n, new THREE.Quaternion()])), hips: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
    this.prev = mk();
    this.prev2 = mk();
    this.tgt = mk(); // the new pose's first frame (for its rate)
    this.x0 = Object.fromEntries([...this.names, '#hips', '#pos', '#quat'].map((n) => [n, new THREE.Vector3()]));
    this.v0 = Object.fromEntries([...this.names, '#hips', '#pos', '#quat'].map((n) => [n, new THREE.Vector3()]));
    this.frames = 0;
    this._bodyRef = ch._body;
  }

  /** Keeps this frame's final pose (call last, after everything has posed the body). */
  record(tag) {
    const ch = this.ch;
    if (ch._body !== this._bodyRef) {
      // (another body: other joints; start over)
      this._init();
      this.on = false;
    }
    const t = this.prev2;
    this.prev2 = this.prev;
    this.prev = t;
    for (const n of this.names) t.q[n].copy(ch.bones[n].quaternion);
    t.hips.copy(ch.bones.Hips.position);
    t.pos.copy(ch.root.position);
    t.quat.copy(ch.root.quaternion);
    this.keepFeet();
    this.tag = tag;
    this.frames++;
  }

  /** A hand-over this frame if `tag` is not what posed the last one (and both are known). */
  check(tag) {
    if (this.tag && tag !== this.tag && this.frames >= 2) this.start(`${this.tag}>${tag}`);
  }

  start(label = '') {
    this.on = true;
    this.t = 0;
    this.n = 0; // frames of the blend so far
    this.pin = null; // the feet held through it
    this.stats.starts++;
    this.stats.last = label;
    this.label = label;
    this.Tnow = this.Tfor[label] || this.T;
  }

  /**
   * Adds the offset to what the new system has posed: `part` 'body' (all but the arms and fingers), 'arms', or
   * 'all'. The clock moves on with the first call of a frame ('body' or 'all').
   */
  apply(dt, part = 'all') {
    if (!this.on) return false;
    const ch = this.ch;
    const b = ch.bones;
    const P = this.prev;
    const P2 = this.prev2;
    const inv = dt > 0 ? 1 / dt : 0;
    if (part !== 'arms') {
      this.t += dt;
      this.n++;
    }
    const sel = (n) => (part === 'all' ? true : part === 'arms' ? ARM.test(n) : !ARM.test(n));
    if (this.n === 1) {
      // the offsets: the old pose carried on one frame at its own rate, less the new pose
      for (const n of this.names) {
        if (!sel(n)) continue;
        // old rate (parent frame): P * P2^-1
        rotvec(_q.copy(P.q[n]).multiply(_q2.copy(P2.q[n]).invert()), this.v0[n]).multiplyScalar(inv);
        // old pose carried on: exp(v dt) P; offset = that * new^-1
        fromRotvec(_v.copy(this.v0[n]).multiplyScalar(dt), _q).multiply(P.q[n]);
        rotvec(_q.multiply(_q2.copy(b[n].quaternion).invert()), this.x0[n]);
        this.tgt.q[n].copy(b[n].quaternion);
      }
      if (part !== 'arms') {
        for (const [key, cur, p, p2] of [['#hips', b.Hips.position, P.hips, P2.hips], ['#pos', ch.root.position, P.pos, P2.pos]]) {
          this.v0[key].subVectors(p, p2).multiplyScalar(inv);
          this.x0[key].copy(p).addScaledVector(this.v0[key], dt).sub(cur);
          (key === '#hips' ? this.tgt.hips : this.tgt.pos).copy(cur);
        }
        rotvec(_q.copy(P.quat).multiply(_q2.copy(P2.quat).invert()), this.v0['#quat']).multiplyScalar(inv);
        fromRotvec(_v.copy(this.v0['#quat']).multiplyScalar(dt), _q).multiply(P.quat);
        rotvec(_q.multiply(_q2.copy(ch.root.quaternion).invert()), this.x0['#quat']);
        this.tgt.quat.copy(ch.root.quaternion);
      }
    } else if (this.n === 2) {
      // the new pose's own rate, from its first two frames: taken off the offset's start rate
      for (const n of this.names) {
        if (!sel(n)) continue;
        rotvec(_q.copy(b[n].quaternion).multiply(_q2.copy(this.tgt.q[n]).invert()), _w).multiplyScalar(inv);
        this.v0[n].sub(_w);
      }
      if (part !== 'arms') {
        this.v0['#hips'].sub(_w.subVectors(b.Hips.position, this.tgt.hips).multiplyScalar(inv));
        this.v0['#pos'].sub(_w.subVectors(ch.root.position, this.tgt.pos).multiplyScalar(inv));
        rotvec(_q.copy(ch.root.quaternion).multiply(_q2.copy(this.tgt.quat).invert()), _w).multiplyScalar(inv);
        this.v0['#quat'].sub(_w);
      }
    }
    // (the offset is defined one frame on from the old pose's last: x0 on the blend's first frame)
    const t = this.t - dt;
    // ((V8) a hand-over's own T applies to the arms; the body, the hips and the root keep 0.35 s)
    const T = part === 'arms' ? this.Tnow || this.T : this.T;
    // planted feet before the offset (where the new pose has them)
    const keep = part !== 'arms' ? this._planted() : null;
    for (const n of this.names) {
      if (!sel(n)) continue;
      decay(this.x0[n], this.v0[n], T, t, _v);
      b[n].quaternion.premultiply(fromRotvec(_v, _q));
    }
    if (part !== 'arms') {
      b.Hips.position.add(decay(this.x0['#hips'], this.v0['#hips'], T, t, _v));
      ch.root.position.add(decay(this.x0['#pos'], this.v0['#pos'], T, t, _v));
      ch.root.quaternion.premultiply(fromRotvec(decay(this.x0['#quat'], this.v0['#quat'], T, t, _v), _q));
    }
    ch.root.updateMatrixWorld(true);
    if (keep) this._repin(keep);
    if (part === 'body' || part === 'all') {
      b.Spine2.getWorldPosition(ch.chestPos);
      b.Spine2.getWorldQuaternion(ch.chestQuat);
      b.Head.getWorldQuaternion(_q);
      b.Head.getWorldPosition(ch.eye).add(_a.copy(ch._body.eyeLocal).applyQuaternion(_q));
    }
    if ((part === 'arms' || part === 'all') && t >= T) this.on = false;
    return true;
  }

  /**
   * Feet on the ground in the new pose: on the blend's first frame those also within 2 cm of where the old pose's
   * last frame had them are chosen; after that, those of them the new pose still has down. Their ankles and turns.
   */
  _planted() {
    const ch = this.ch;
    const b = ch.bones;
    const out = [];
    const first = !this.pin;
    if (first) this.pin = {};
    for (const side of ['Left', 'Right']) {
      const foot = b[side + 'Foot'];
      const now = foot.getWorldPosition(new THREE.Vector3());
      if (now.y - groundAt(now.x, now.z) > ANKLE_HEIGHT + 0.03) continue;
      if (first) this.pin[side] = !!(this._oldAnkle && this._oldAnkle[side].distanceTo(now) <= 0.02);
      if (!this.pin[side]) continue;
      out.push({ side, ankle: now, quat: foot.getWorldQuaternion(new THREE.Quaternion()) });
    }
    return out;
  }

  /** Where the feet were at the end of the last frame (call with the final pose, before record). */
  keepFeet() {
    const b = this.ch.bones;
    this._oldAnkle = this._oldAnkle || { Left: new THREE.Vector3(), Right: new THREE.Vector3() };
    for (const side of ['Left', 'Right']) b[side + 'Foot'].getWorldPosition(this._oldAnkle[side]);
  }

  _repin(list) {
    const ch = this.ch;
    const b = ch.bones;
    for (const { side, ankle } of list) {
      // (the foot keeps the blended turn; only its ankle is held)
      const quat = b[side + 'Foot'].getWorldQuaternion(new THREE.Quaternion());
      const hip = b[side + 'UpLeg'].getWorldPosition(_a);
      const knee = b[side + 'Leg'].getWorldPosition(_b);
      const axis = _v.subVectors(ankle, hip).normalize();
      const pole = knee.sub(hip);
      pole.addScaledVector(axis, -pole.dot(axis)).normalize();
      ch._leg(side, ankle, pole.clone(), quat, 0);
    }
    ch.model.updateMatrixWorld(true);
  }
}
