// (V10) Getting out while the vehicle moves, and the parachute (VEHICLE_NOTES.md, "Third request").
//
//   car over BAIL_SPEED      bailing (car-bail in the car's frame) -> at events.release: 'air' in world space, carried
//                            at the car's velocity -> bail-roll, its travel the clip's own plus a slide that bleeds the
//                            carried speed off ('land' from its events.ground) -> events.free: standing, the draw
//   helicopter off the ground jumping (heli-jump in its frame) -> at events.release: 'air', ballistic with air drag
//                            (terminal 55 m/s), the fall loop -> on the ground by the vertical speed: land-roll (<= 9
//                            m/s), land-hard (<= 14), else 'wasted' (the fade, WASTED, 3 s, on foot at the helipad)
//   with a parachute pack    in the fall from 30 m up Space pulls: para-deploy, then para-hang under a ram-air canopy
//                            (para.js flies it); down at 6 m/s or less: para-land, faster: the impact rules
//
// World-space posing has two placements: 'framed' (the clip's root track in a frame A that rides a moving frame F:
// the vehicle's frame frozen at release and carried at its velocity, or the landing spot sliding to a stop; the root on
// the real ground) and 'ballistic' (the hips are where the falling body is; the pose hangs off them).
// Clips are looked up by name in the body's vehicle pack; until the clip pass ships one, a stand-in built here from the
// pack's own poses plays instead (same shape: quats per joint, hips, notes root / events / door), and the real clip
// takes over by itself once the pack has it (stats.paths says which played).
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';
import { wrapAngle, PALM_LOCAL, ANKLE_HEIGHT } from './character.js';

export const BAIL_SPEED = 8; // m/s: at or under it the driver brakes to a stop and gets out; over it he bails
export const STOP_SPEED = 0.25; // m/s: stopped enough for car-exit
export const LAND_ROLL = 9; // m/s vertical at impact: land-roll up to here
export const LAND_HARD = 14; // land-hard up to here; more is WASTED
export const PARA_LAND = 6; // m/s descent under a canopy: a landing at or under it
export const PARA_MIN = 30; // m above the ground: "Space: open parachute" from here up
const G = 9.81;
const TERMINAL = 55;
const DRAG = G / (TERMINAL * TERMINAL); // per m: a = -DRAG |v| v
const FPS = 30;
const XF = 0.12; // s, the pose's cross-fade at a change of clip in the air or on landing
const WASTED_S = 3; // s from the impact to standing at the helipad
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ease = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const clamp = THREE.MathUtils.clamp;

// ---------------------------------------------------------------------------------------------- stand-ins
/** A clip frame as a pose: { q: {joint: [x, y, z, w]}, hips: [x, y, z] }. */
function snap(clip, f) {
  f = clamp(Math.round(f), 0, clip.frames - 1);
  const q = {};
  for (const [n, arr] of Object.entries(clip.quats)) q[n] = Array.from(arr.subarray(f * 4, f * 4 + 4));
  return { q, hips: Array.from(clip.hips.subarray(f * 3, f * 3 + 3)) };
}

function mixPose(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const q = {};
  for (const n of Object.keys(a.q)) {
    _q.fromArray(a.q[n]).slerp(_q2.fromArray(b.q[n] || a.q[n]), u);
    q[n] = _q.toArray();
  }
  return { q, hips: a.hips.map((x, i) => x + (b.hips[i] - x) * u) };
}

/** The pose `base` with world-axis turns applied (`mods(turn)`; the body at the origin facing -Z, right +X, up +Y). */
function turned(ch, base, mods) {
  const keep = {};
  for (const [n, b] of Object.entries(ch.bones)) keep[n] = b.quaternion.clone();
  const hips = ch.bones.Hips.position.clone();
  const pos = ch.root.position.clone();
  const quat = ch.root.quaternion.clone();
  ch.root.position.set(0, 0, 0);
  ch.root.quaternion.identity();
  for (const [n, q] of Object.entries(base.q)) if (ch.bones[n]) ch.bones[n].quaternion.fromArray(q);
  ch.bones.Hips.position.fromArray(base.hips);
  ch.root.updateMatrixWorld(true);
  const turn = (name, axis, angle) => {
    const b = ch.bones[name];
    if (!b || !angle) return;
    b.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(axis, angle);
    b.quaternion.premultiply(_q2.copy(_pq).invert().multiply(_q).multiply(_pq));
    b.updateMatrixWorld(true);
  };
  mods(turn, ch);
  const out = { q: {}, hips: [...base.hips] };
  for (const n of Object.keys(base.q)) out.q[n] = ch.bones[n] ? ch.bones[n].quaternion.toArray() : base.q[n];
  for (const [n, b] of Object.entries(ch.bones)) b.quaternion.copy(keep[n]);
  ch.bones.Hips.position.copy(hips);
  ch.root.position.copy(pos);
  ch.root.quaternion.copy(quat);
  ch.root.updateMatrixWorld(true);
  return out;
}

/** A clip in the baked pack's shape from fn(t) -> { pose, root: [x, z, yaw], door }. */
function makeClip(name, seconds, fn, events, loop = false) {
  const frames = Math.round(seconds * FPS) + 1;
  let quats = null;
  const hips = new Float32Array(frames * 3);
  const root = [];
  const door = [];
  for (let f = 0; f < frames; f++) {
    const r = fn(f / FPS, f);
    if (!quats) quats = Object.fromEntries(Object.keys(r.pose.q).map((n) => [n, new Float32Array(frames * 4)]));
    for (const n of Object.keys(quats)) quats[n].set(r.pose.q[n], f * 4);
    hips.set(r.pose.hips, f * 3);
    root.push(r.root || [0, 0, Math.PI]);
    door.push(r.door || 0);
  }
  return { name, frames, duration: (frames - 1) / FPS, quats, hips, note: { root, door, events, contacts: [], standIn: true, loop } };
}

/**
 * The stand-ins for one pack (cached on it): built from car-drive and heli-fly frame 0 (the seated driver and pilot),
 * car-enter frame 0 (standing at the door, arms down) and the deepest squat of car-exit with both hands low, with
 * world-axis turns for the spread limbs of the fall and the raised arms under a canopy.
 */
function standIns(v) {
  const P = v.pack;
  if (!P) return null;
  if (P._standIns && P._standInsBody === v.character._body) return P._standIns;
  const ch = v.character;
  const C = P.clips;
  // (each pose turned so the body faces its root's forward (-Z at the origin), judged from the line between the hips:
  // a clip's frame may have the body turned on its root, car-exit's squat by up to half a turn)
  const facing = (c) => {
    const l = c.bones.LeftUpLeg.getWorldPosition(new THREE.Vector3());
    const r = c.bones.RightUpLeg.getWorldPosition(new THREE.Vector3());
    const right = r.sub(l).setY(0).normalize();
    const f = new THREE.Vector3().crossVectors(Y, right);
    return Math.atan2(-f.x, -f.z);
  };
  const norm = (pose) => turned(ch, pose, (turn, c) => turn('Hips', Y, -facing(c)));
  const seatedCar = snap(C['car-drive'], 0);
  const seatedHeli = snap(C['heli-fly'], 0);
  const stand = norm(snap(C['car-enter'], 0));
  // the squat: the car-exit frame with the hips lowest while both hands are under 1 m (FK at the origin)
  const ex = C['car-exit'];
  let best = null;
  {
    const keepQ = {};
    for (const [n, b] of Object.entries(ch.bones)) keepQ[n] = b.quaternion.clone();
    const hipsWas = ch.bones.Hips.position.clone();
    const pos = ch.root.position.clone();
    const quat = ch.root.quaternion.clone();
    ch.root.position.set(0, 0, 0);
    ch.root.quaternion.identity();
    for (let f = Math.round(ex.frames * 0.3); f < ex.frames; f += 2) {
      P.apply(ch.bones, ex, f / FPS, 1);
      ch.root.updateMatrixWorld(true);
      const hy = ch.bones.Hips.getWorldPosition(_v).y;
      const hl = ch.bones.LeftHand.getWorldPosition(_v2).y;
      const hr = ch.bones.RightHand.getWorldPosition(_v3).y;
      // (low hips, both hands down by the knees: a hand up on the roof's edge is no landing)
      const score = hy + 3 * Math.max(0, Math.max(hl, hr) - (hy + 0.12));
      if (!best || score < best.score) best = { f, score, hy };
    }
    for (const [n, b] of Object.entries(ch.bones)) b.quaternion.copy(keepQ[n]);
    ch.bones.Hips.position.copy(hipsWas);
    ch.root.position.copy(pos);
    ch.root.quaternion.copy(quat);
    ch.root.updateMatrixWorld(true);
  }
  const squat = norm(snap(ex, best.f));
  const deep = { q: squat.q, hips: [squat.hips[0], squat.hips[1] - 0.06, squat.hips[2]] };
  const D = Math.PI / 180;
  // the fall: arms out and up, elbows bent, legs apart, knees bent, back a little arched; a slow flail on top
  const fallAt = (t) => {
    const w = (t / 1.0) * Math.PI * 2;
    return turned(ch, stand, (turn) => {
      turn('Spine', X, 6 * D + 2 * D * Math.sin(w));
      turn('LeftArm', Z, -(68 + 14 * Math.sin(w)) * D);
      turn('RightArm', Z, (68 + 14 * Math.sin(w + 1.3)) * D);
      turn('LeftArm', X, (12 * Math.sin(w + 0.6)) * D);
      turn('RightArm', X, (12 * Math.sin(w + 2.1)) * D);
      turn('LeftForeArm', Z, -(35 + 10 * Math.sin(w + 0.8)) * D);
      turn('RightForeArm', Z, (35 + 10 * Math.sin(w + 2.0)) * D);
      turn('LeftUpLeg', Z, -12 * D);
      turn('RightUpLeg', Z, 12 * D);
      turn('LeftUpLeg', X, (14 + 10 * Math.sin(w)) * D);
      turn('RightUpLeg', X, (14 - 10 * Math.sin(w)) * D);
      turn('LeftLeg', X, -(30 + 10 * Math.sin(w + 0.5)) * D);
      turn('RightLeg', X, -(30 - 10 * Math.sin(w + 0.5)) * D);
    });
  };
  const fall0 = fallAt(0);
  // hanging under the canopy: arms up to the toggles over the shoulders (IK puts the hands on them), legs a little
  // forward and bent; a small sway
  const hangAt = (t) => {
    const w = (t / 2.0) * Math.PI * 2;
    return turned(ch, stand, (turn) => {
      turn('Spine', Z, 2 * D * Math.sin(w));
      turn('LeftArm', Z, -150 * D);
      turn('RightArm', Z, 150 * D);
      turn('LeftForeArm', Z, -15 * D);
      turn('RightForeArm', Z, 15 * D);
      turn('LeftUpLeg', X, (18 + 4 * Math.sin(w)) * D);
      turn('RightUpLeg', X, (14 - 4 * Math.sin(w)) * D);
      turn('LeftLeg', X, -22 * D);
      turn('RightLeg', X, -26 * D);
    });
  };
  const hang0 = hangAt(0);
  const out = {};
  // ---- car-bail: the seat to just outside the left door, turning to face out, the door shoved open ----
  {
    const r0 = C['car-drive'].note.root[0];
    out['car-bail'] = makeClip('car-bail', 0.6, (t) => {
      const u = ease((t - 0.05) / 0.5);
      const pose = mixPose(seatedCar, squat, ease((t - 0.08) / 0.4));
      const hop = 0.35 * Math.sin(Math.PI * clamp(t / 0.6, 0, 1));
      return { pose: { q: pose.q, hips: [pose.hips[0], pose.hips[1] + hop, pose.hips[2]] }, root: [r0[0] + (-1.45 - r0[0]) * u, r0[1] + 0.15 * u, r0[2] + (Math.PI / 3) * u], door: ease(t / 0.2) };
    }, { release: 0.42 });
  }
  const bailEnd = snap(out['car-bail'], out['car-bail'].frames - 1);
  // ---- bail-roll: from the bail's last pose, down into the squat at 0.3 s, up to standing ----
  out['bail-roll'] = makeClip('bail-roll', 1.8, (t) => {
    let pose = mixPose(bailEnd, squat, ease(t / 0.3));
    if (t > 0.9) pose = mixPose(squat, stand, ease((t - 0.9) / 0.55));
    return { pose, root: [0, -2.4 * ease(t / 1.5), Math.PI] };
  }, { ground: 0.3, free: 1.45 });
  // ---- heli-jump: the pilot's seat to just outside the right door, turning to face out ----
  {
    const r0 = C['heli-fly'].note.root[0];
    const floor = 0.72;
    out['heli-jump'] = makeClip('heli-jump', 1.0, (t) => {
      const u = ease((t - 0.1) / 0.7);
      const up = ease((t - 0.05) / 0.35);
      const crouched = { q: mixPose(squat, stand, 0.45).q, hips: mixPose(squat, stand, 0.45).hips.map((x, i) => (i === 1 ? x + floor : x)) };
      let pose = mixPose(seatedHeli, crouched, up);
      pose = mixPose(pose, { q: fall0.q, hips: [fall0.hips[0], fall0.hips[1] + floor, fall0.hips[2]] }, ease((t - 0.55) / 0.45));
      return { pose, root: [r0[0] + (1.75 - r0[0]) * u, r0[1] - 0.05 * u, r0[2] - (Math.PI / 2) * u], door: ease(t / 0.3) };
    }, { release: 0.7 });
  }
  // ---- the fall: a 1 s loop (frame 0 = its last) ----
  out.fall = makeClip('fall', 1.0, (t) => ({ pose: fallAt(t) }), {}, true);
  // ---- landings ----
  out['land-roll'] = makeClip('land-roll', 1.3, (t) => {
    let pose = mixPose(fall0, squat, ease(t / 0.28));
    if (t > 0.45) pose = mixPose(squat, stand, ease((t - 0.45) / 0.5));
    return { pose, root: [0, -0.7 * ease(t / 0.8), Math.PI] };
  }, { ground: 0, free: 0.95 });
  out['land-hard'] = makeClip('land-hard', 2.5, (t) => {
    let pose = mixPose(fall0, deep, ease(t / 0.32));
    if (t > 1.3) pose = mixPose(deep, stand, ease((t - 1.3) / 0.8));
    return { pose, root: [0, -0.3 * ease(t / 0.4), Math.PI] };
  }, { ground: 0, free: 2.05, down: 0.4 });
  // ---- the parachute ----
  out['para-deploy'] = makeClip('para-deploy', 1.2, (t) => ({ pose: mixPose(fall0, hang0, ease((t - 0.15) / 0.85)) }), { pull: 0.1, open: 0.55 });
  out['para-hang'] = makeClip('para-hang', 2.0, (t) => ({ pose: hangAt(t) }), {}, true);
  out['para-land'] = makeClip('para-land', 1.5, (t) => {
    let pose = mixPose(hang0, mixPose(stand, squat, 0.55), ease(t / 0.25));
    if (t > 0.35) pose = mixPose(mixPose(stand, squat, 0.55), stand, ease((t - 0.35) / 0.55));
    return { pose, root: [0, -1.4 * (1 - Math.pow(1 - clamp(t / 1.0, 0, 1), 2)), Math.PI] };
  }, { ground: 0.08, free: 0.95 });
  P._standIns = out;
  P._standInsBody = ch._body;
  P._standInsSquatFrame = best.f;
  return out;
}

// ---------------------------------------------------------------------------------------------- the follow camera
/**
 * (V10) The chase camera on the body through a bail, a fall, a canopy and a landing: it starts where the vehicle's chase
 * camera was (no cut), rides a spring toward a place behind the body's travel (behind the heading under a canopy) and a
 * little above it, looking a little down; as he stands it eases to where the on-foot camera will be.
 */
export class BodyCam {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.2;
    this.t = 0;
    this.fov = 55;
  }

  start(camera, look, vel) {
    this.pos.copy(camera.position);
    this.vel.copy(vel);
    this.look.copy(look);
    _v.subVectors(look, camera.position);
    this.yaw = Math.atan2(-_v.x, -_v.z);
    this.fov = camera.fov;
    this.t = 0;
    this._lastBodyVel = null;
  }

  /** o: { target (world), vel, yaw (the way to look along), back, up, stand 0..1 (the on-foot camera's place) } */
  place(dt, camera, o) {
    this.t += dt;
    this.yaw += wrapAngle(o.yaw - this.yaw) * (1 - Math.exp(-(o.yawRate || 2.5) * dt));
    // where the on-foot camera would be for this yaw (player.placeCamera: pivot 1.5 m up, 3.3 m back, 0.6 m right)
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const want = _v.set(sy * o.back, o.up, cy * o.back).add(o.target);
    if (o.stand > 0) {
      const pitch = -0.1;
      _q.setFromEuler(_e.set(pitch, this.yaw, 0, 'YXZ'));
      const foot = _v2.set(0.6, 0.05, 3.3).applyQuaternion(_q).add(_v3.copy(o.ground).setY(o.ground.y + 1.5));
      want.lerp(foot, o.stand);
    }
    const k = Math.min(30, 6 + this.t * 40);
    const c = 2 * Math.sqrt(k) * 0.95;
    // ((V10, integration) the spring's pull capped at 60 m/s^2 beyond the body's own (a change of side or a far start
    // swung it at up to 6 m/s in a frame)
    _v2.set(((want.x - this.pos.x) * k - (this.vel.x - o.vel.x) * c) * dt, ((want.y - this.pos.y) * k - (this.vel.y - o.vel.y) * c) * dt, ((want.z - this.pos.z) * k - (this.vel.z - o.vel.z) * c) * dt);
    // (and the body's own change of speed passed on at most 120 m/s^2: a landing stopped the body's 12 to 31 m/s in a
    // frame, and the camera with it)
    if (this._lastBodyVel) _v3.subVectors(o.vel, this._lastBodyVel).clampLength(0, 120 * dt);
    else _v3.set(0, 0, 0);
    _v2.sub(_v3).clampLength(0, 60 * dt).add(_v3);
    this._lastBodyVel = (this._lastBodyVel || new THREE.Vector3()).copy(this._lastBodyVel ? this._lastBodyVel.add(_v3) : o.vel);
    this.vel.add(_v2);
    this.pos.addScaledVector(this.vel, dt);
    if (dt <= 0) this.pos.copy(want);
    // (never inside a vehicle's body: out through the nearest face of its box)
    for (const B of o.blockers || []) {
      const l = B.root.worldToLocal(_v2.copy(this.pos));
      const d = [l.x - B.min[0], B.max[0] - l.x, l.y - B.min[1], B.max[1] - l.y, l.z - B.min[2], B.max[2] - l.z];
      if (Math.min(...d) <= 0) continue;
      const k = d.indexOf(Math.min(...d));
      const axis = k >> 1;
      const to = k % 2 === 0 ? B.min[axis] - 0.15 : B.max[axis] + 0.15;
      if (axis === 0) l.x = to;
      else if (axis === 1) l.y = to;
      else l.z = to;
      this.pos.copy(B.root.localToWorld(l));
    }
    camera.position.copy(this.pos);
    const g = groundAt(camera.position.x, camera.position.z);
    if (camera.position.y < g + 0.4) camera.position.y = this.pos.y = g + 0.4;
    // the look point: carried with the body, eased onto it
    this.look.addScaledVector(o.vel, dt);
    this.look.lerp(o.lookAt || o.target, 1 - Math.exp(-7 * dt));
    if (dt <= 0) this.look.copy(o.lookAt || o.target);
    if (o.stand > 0) {
      // (standing: the look along the on-foot view's own direction, so the hand-over keeps the picture)
      _q.setFromEuler(_e.set(-0.1, this.yaw, 0, 'YXZ'));
      const along = _v.set(0, 0, -20).applyQuaternion(_q).add(camera.position);
      camera.lookAt(_v2.copy(this.look).lerp(along, o.stand));
    } else camera.lookAt(this.look);
    _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.pitch = Math.asin(clamp(_v.y, -1, 1));
    this.fov += ((o.fov || 55) - this.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

// ---------------------------------------------------------------------------------------------- the exits
export class Exits {
  constructor(v) {
    this.v = v; // the Vehicles
    this.s = null; // the tumble in progress
    this.cam = new BodyCam();
    this.para = null; // para.js's Parachute (main.js sets it)
    this.keys = { space: false, left: false, right: false, flare: false, fast: false };
    this.stats = { last: null };
    this.wastedT = -1; // s since a fatal impact (main.js fades the picture), -1 when not
    this.onRespawn = null;
    this.respawnAt = null; // () -> { x, z, yaw }
  }

  /** A clip by name: the pack's (vehicle-frame ones only when the pack fits that cabin) else the stand-in. */
  clip(name, kind = null) {
    const v = this.v;
    const P = v.pack;
    const real = P && P.clips[name] && (!kind || v._packFits(kind)) && !this.forceStandIn ? P.clips[name] : null;
    const c = real || (standIns(v) || {})[name] || null;
    v.stats.paths[name] = real ? 'clip' : c ? 'stand-in' : 'none';
    return c;
  }

  ev(clip, name, fallback) {
    const e = clip.note && clip.note.events;
    const x = e && typeof e[name] === 'number' ? e[name] : null;
    return x === null ? fallback : x;
  }

  /** Vehicle-frame clip (car-bail / heli-jump) has passed events.release: into world space. */
  release() {
    const v = this.v;
    const ch = v.character;
    const veh = v.v;
    const kind = v.kind;
    const clip = v.clip;
    // the vehicle's frame at release, levelled: position and heading
    veh.root.updateMatrixWorld(true);
    const fwd = _v.set(0, 0, -1).applyQuaternion(veh.root.quaternion);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const rootW = ch.root.getWorldPosition(new THREE.Vector3());
    // the carried velocity: the vehicle's at the body's place (its own motion and turn)
    let carried;
    const hips = ch.bones.Hips.getWorldPosition(new THREE.Vector3());
    if (kind === 'car') carried = veh.velocityAt(rootW).setY(0);
    else {
      const s = veh.state;
      carried = new THREE.Vector3(s.velocity.x, s.velocity.y, s.velocity.z);
    }
    // the body's own velocity out of the door (the clip's hips, from the last frame in the vehicle's frame)
    const own = new THREE.Vector3();
    if (this._prevHipsLocal) {
      const now = veh.root.worldToLocal(hips.clone());
      own.subVectors(now, this._prevHipsLocal).multiplyScalar(1 / Math.max(1e-3, this._prevDt || 1 / 60)).applyQuaternion(_q.setFromAxisAngle(Y, yaw));
      own.clampLength(0, 6);
    }
    const s = (this.s = {
      kind,
      t: v.t, // the vehicle-frame clip carries on in F from where it is
      clip,
      seq: kind === 'car' ? 'bail' : 'jump',
      F: { pos: new THREE.Vector3(veh.root.position.x, 0, veh.root.position.z), yaw, vel: carried.clone().setY(0) },
      A: null, // set per clip
      ballistic: kind === 'heli',
      c: hips.clone(),
      // (the falling body leaves with its hips' own world velocity: the helicopter's, its turn's and the jump's)
      vel: kind === 'heli' && this._prevHipsW ? hips.clone().sub(this._prevHipsW).multiplyScalar(1 / Math.max(1e-3, this._prevDt || 1 / 60)) : carried.clone().add(own),
      heldYaw: _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y,
      fade: null,
      rootOff: null,
      phase: 'air',
      time: 0,
      ground: null,
      slide: null,
      chute: null,
      maxVy: 0,
      dist: 0,
      startPos: rootW.clone(),
      releaseSpeed: carried.length(),
      log: [],
    });
    // (out of the car: the shove off the sill carries him on away from its side at 2 m/s (the slide takes it off with the
    // rest), so the car, which slows less than a tumbling body, passes him clear of its flank)
    if (kind === 'car') s.F.vel.add(new THREE.Vector3(-1, 0, 0).applyQuaternion(veh.root.quaternion).setY(0).normalize().multiplyScalar(2));
    s.A = { pos: s.F.pos.clone(), yaw: s.F.yaw, rel: true };
    // (the vehicle's own pitch and bank, which the body had in its frame, let go of over 0.3 s, not in one frame)
    s.tilt = new THREE.Quaternion().setFromAxisAngle(Y, s.heldYaw).invert().multiply(ch.root.quaternion);
    s.clipYaw0 = v.pack.root(clip, v.t, {}).yaw; // (the jump's own turn carried on in the fall)
    s.hipsH0 = hips.y - groundAt(hips.x, hips.z);
    // (the car's plane sits a few cm off the ground at speed (the springs, downforce): eased onto the real ground)
    if (kind === 'car') s.rootOff = { d: new THREE.Vector3(0, rootW.y - groundAt(rootW.x, rootW.z), 0), t: 0, T: 0.3 };
    this.stats.last = { kind, releaseKmh: +(carried.length() * 3.6).toFixed(1), at: rootW.toArray().map((x) => +x.toFixed(2)), height: +s.hipsH0.toFixed(2), path: v.stats.paths[clip.name] };
    v.mode = 'air';
    v.clip = null;
    v.usingPack = false;
    if (v._join) v._join.on = false;
    // the seat's fit off (he is out), the helicopter's harness back, the door to close by itself
    v.applyFit(kind, false);
    if (kind === 'heli') v.heli.harnessHidden(false);
    v.closeDoor(kind, 0.25);
    if (kind === 'car') veh.abandoned = true;
    else this.leverDown = true; // (main.js: the collective down now he is out)
    if (this.para) this.para.jumped = true;
    // (the follow camera from where the vehicle's chase camera is this frame (it is placed after this), looking where it
    // looks: taken up on the first frame out)
    this._camFrom = { look: kind === 'car' ? veh.root.localToWorld(new THREE.Vector3(0, 0.97, 0)) : veh.root.localToWorld(new THREE.Vector3(0, 2.35, 0.6)), vel: carried.clone(), rel: veh.root.worldToLocal(new THREE.Vector3()) };
    this._camVeh = veh;
  }

  /** Kept every frame of a vehicle-frame clip: the hips in the vehicle's frame (the body's own velocity at release). */
  track(dt) {
    const v = this.v;
    const h = v.character.bones.Hips.getWorldPosition(_v);
    this._prevHipsW = h.clone();
    this._prevHipsLocal = v.v.root.worldToLocal(h.clone());
    this._prevDt = dt;
  }

  get busy() {
    return !!this.s;
  }

  /** The keys while falling or under a canopy (main.js). */
  key(code, down) {
    const k = this.keys;
    if (code === 'Space') {
      if (down && !k.space) this._pull();
      k.space = down;
    } else if (code === 'KeyA' || code === 'ArrowLeft') k.left = down;
    else if (code === 'KeyD' || code === 'ArrowRight') k.right = down;
    else if (code === 'KeyS' || code === 'ArrowDown') k.flare = down;
    else if (code === 'KeyW' || code === 'ArrowUp') k.fast = down;
    else return false;
    return true;
  }

  /** Height of the body (hips) over the ground now. */
  get height() {
    const s = this.s;
    if (!s) return 0;
    const h = this.v.character.bones.Hips.getWorldPosition(_v);
    return h.y - groundAt(h.x, h.z);
  }

  /** Can Space open the parachute now? */
  get canPull() {
    const s = this.s;
    return !!(s && this.para && this.para.worn && s.ballistic && !s.chute && s.phase === 'air' && this.height - 1 >= PARA_MIN);
  }

  _pull() {
    if (!this.canPull) return false;
    const s = this.s;
    const clip = this.clip('para-deploy');
    if (s.yawNow !== undefined) s.heldYaw = s.yawNow;
    s.seq = 'chute';
    s.chute = { state: 'deploy', t: 0, pullT: this.ev(clip, 'pull', 0.1), openT: this.ev(clip, 'open', 0.55), clip, height: this.height };
    this._switchClip(clip, 0);
    this.para.deploy(s);
    return true;
  }

  // ------------------------------------------------------------------ per frame
  /** Poses the body for 'air', 'land' and 'wasted' (world space). */
  pose(dt) {
    const s = this.s;
    if (!s) return;
    const v = this.v;
    const ch = v.character;
    s.time += dt;
    // ---- what plays ----
    if (s.phase === 'air') {
      if (s.seq === 'bail' && s.clip.name === 'car-bail' && s.t >= s.clip.duration) {
        // car-bail done: bail-roll from its last pose, anchored where the body is, its travel turned to the way it goes
        const roll = this.clip('bail-roll');
        const travel = _v.copy(s.F.vel);
        this._anchorAtBody(roll, 0, travel.lengthSq() > 4 ? Math.atan2(-travel.x, -travel.z) : null);
        s.clip = roll;
        s.t = 0;
        s.seq = 'roll';
      } else if (s.seq === 'jump' && s.t >= s.clip.duration && !s.chute) {
        if (s.yawNow !== undefined) s.heldYaw = s.yawNow;
        this._switchClip(this.clip('fall'), 0);
        s.seq = 'fall';
      }
      if (s.seq === 'roll' && s.t >= this.ev(s.clip, 'ground', 0.3)) this._ground(null);
      // ((V10, integration) the landing clip begins in the air, so its ground frame meets the ground: land-roll /
      // land-hard start on fall frame 0 with the soles 0.14 m over their ground and put the feet down by events.ground
      // (0.13 to 0.14 s); para-land starts on para-hang frame 0 and flares to its events.ground (0.25 s))
      if (s.ballistic && !s.preLand && !(s.chute && s.chute.state === 'deploy') && s.seq !== 'jump') this._preLand();
    }
    if (s.chute) this._chute(dt);
    // ---- advance the clip ----
    s.t += dt;
    let t = s.t;
    const loop = s.clip.note && s.clip.note.loop;
    if (loop) t %= s.clip.duration;
    if (s.phase === 'wasted' && s.holdAt !== undefined) t = Math.min(t, s.holdAt);
    t = Math.min(t, s.clip.duration);
    v.pack.apply(ch.bones, s.clip, t, 1);
    if (s.chute && s.chute.state === 'canopy' && !s.clip.note.standIn && s.clip.name === 'para-hang') this._steerPoses();
    // ---- the pose's cross-fade ----
    if (s.fade) {
      s.fade.t += dt;
      const u = ease(s.fade.t / s.fade.T);
      for (const [n, b] of Object.entries(ch.bones)) if (s.fade.q[n]) b.quaternion.copy(_q.copy(s.fade.q[n]).slerp(b.quaternion, u));
      ch.bones.Hips.position.lerpVectors(s.fade.hips, _v.copy(ch.bones.Hips.position), u);
      if (u >= 1) s.fade = null;
    }
    // ---- place it ----
    if (s.ballistic) this._ballistic(dt);
    else this._framed(dt, t);
    if (s.phase === 'wasted' && s.lying) this._lieFlat();
    ch.root.updateMatrixWorld(true);
    ch.model.updateMatrixWorld(true);
    // ((V10, integration) a ground clip's contacts (feet planted, a hand pushing off) on the real ground under them, in the
    // clip's frame where it is now (sliding with it); a vehicle's frozen frame has none left after release)
    if (!s.ballistic && !s.lying && !s.clip.note.standIn && !s.A.rel) {
      const fr = (this._frameObj = this._frameObj || new THREE.Object3D());
      fr.position.set(s.A.pos.x + s.F.pos.x - s.A.f0.x, ch.root.position.y, s.A.pos.z + s.F.pos.z - s.A.f0.z);
      fr.quaternion.setFromAxisAngle(Y, s.A.yaw);
      fr.updateMatrixWorld(true);
      v._pinContacts(s.clip, t, fr, s.kind === 'pickup' ? (c, side) => this._pickupHeld(s, c, side) : null, s.fade ? ease(s.fade.t / s.fade.T) : 1);
    }
    if (s.chute && s.clip.note.standIn && (s.chute.state === 'canopy' || s.chute.state === 'deploy')) this._handsOnToggles();
    ch.rig.apply();
    const b = ch.bones;
    b.Head.getWorldQuaternion(_q);
    b.Head.getWorldPosition(ch.eye).add(_v.copy(ch._body.eyeLocal).applyQuaternion(_q));
    if (this.para) this.para.pose(dt, ch, s);
    // ---- what comes next ----
    if (s.phase === 'air' && s.ballistic) {
      this._contact();
      if (s.phase !== 'air') {
        // ((V10, integration) a landing that begins this frame re-placed the body: drawn as it is now (the skin was
        // posed before it, the root after: a frame's 23 m/s at the hands))
        ch.root.updateMatrixWorld(true);
        ch.model.updateMatrixWorld(true);
        ch.rig.apply();
        b.Head.getWorldQuaternion(_q);
        b.Head.getWorldPosition(ch.eye).add(_v.copy(ch._body.eyeLocal).applyQuaternion(_q));
      }
    }
    if (s.phase === 'land' && s.freeT !== undefined && (s.t >= s.clip.duration || (s.t >= s.freeT && ((v.moveHeld && v.moveHeld()) || s.kind === 'pickup')))) this._handOver();
    if (s && s.kind === 'pickup' && this.s === s) this._carryPack(s);
    if (s.phase === 'wasted') {
      this.wastedT = s.time - s.wastedAt;
      if (this.wastedT >= WASTED_S) this._respawn();
    }
  }

  /** Root velocity of the body (world): what the cameras and chain see. */
  get vel() {
    const s = this.s;
    if (!s) return _v.set(0, 0, 0);
    return s.ballistic ? s.vel : s.F.vel;
  }

  /** Places the follow camera for the frame (main.js, after pose). */
  placeCamera(dt, camera) {
    if (this._camFrom) {
      // (the look point carried on with the vehicle from release to now: one frame)
      const F = this._camFrom;
      F.look.addScaledVector(F.vel, dt);
      // (at the speed the vehicle's camera was moving (main.js keeps it): the chase camera can still be swinging)
      this.cam.start(camera, F.look, this.camVel || F.vel);
      this._camFrom = null;
    }
    this.cam.place(dt, camera, this.camWant());
  }

  /** The camera's wishes for the frame. */
  camWant() {
    const s = this.s;
    const ch = this.v.character;
    const hips = ch.bones.Hips.getWorldPosition(new THREE.Vector3());
    const vel = this.vel.clone();
    const h = Math.hypot(vel.x, vel.z);
    let yaw = h > 2.5 ? Math.atan2(-vel.x, -vel.z) : _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y;
    let back = 4.6 + Math.min(4, h * 0.08);
    let up = 1.7 + Math.min(2.5, Math.max(0, -vel.y) * 0.05);
    let target = hips.clone().add(_v.set(0, 0.25, 0));
    let lookAt = null;
    let fov = 55;
    let stand = 0;
    if (s.kind === 'heli' && !s.chute && h < 6) {
      // (out of a hovering helicopter he leaves facing away from it, so behind him is the helicopter (which comes down
      // there, empty): from the far side instead, looking at him with the helicopter beyond)
      const hp = this.v.heli.root.position;
      const dx = hp.x - hips.x;
      const dz = hp.z - hips.z;
      if (Math.hypot(dx, dz) < 25) yaw = Math.atan2(-dx, -dz);
    }
    if (s.chute && (s.chute.state === 'canopy' || s.chute.state === 'deploy')) {
      yaw = s.chute.state === 'canopy' ? s.chute.yaw : yaw;
      // (behind and a little above: the body low in the picture, the canopy in its top part)
      back = 11;
      up = 2.5;
      lookAt = hips.clone().add(_v.set(0, 3.5, 0));
      fov = 60;
    }
    if (s.phase === 'land') {
      const left = s.freeT - s.t;
      stand = ease(1 - left / 0.6);
    }
    if (s.phase === 'wasted') {
      back = 5 + Math.min(3, (s.time - s.wastedAt) * 1.2);
      up = 2.6 + Math.min(2, (s.time - s.wastedAt) * 0.8);
      lookAt = hips.clone();
      vel.set(0, 0, 0);
    }
    const blockers = (this._blockers = this._blockers || [
      { root: this.v.car.root, min: [-1.15, -0.3, -2.6], max: [1.15, 1.4, 2.6] },
      { root: this.v.heli.root, min: [-1.5, -0.3, -5.0], max: [1.5, 3.4, 2.2], heli: true },
    ]);

    return { target, lookAt, vel, yaw, back, up, fov, stand, ground: ch.root.position, yawRate: s.chute ? 1.5 : 3, blockers };
  }

  // ------------------------------------------------------------------ placement
  /** The clip's root track through A (riding F) onto the real ground; the slide; obstacles. */
  _framed(dt, t) {
    const s = this.s;
    const v = this.v;
    const ch = v.character;
    const p = v.player;
    // F moves at its velocity (decaying through a slide)
    if (s.slide) {
      s.slide.t += dt;
      const k = Math.max(0, 1 - s.slide.t / s.slide.T);
      s.F.vel.copy(s.slide.v0).multiplyScalar(k);
    }
    s.F.pos.addScaledVector(s.F.vel, dt);
    const r = v.pack.root(s.clip, t, this._r || (this._r = {}));
    const A = s.A;
    let x;
    let z;
    let yaw;
    if (A.rel) {
      // (A in F's frame: the vehicle frame frozen at release, moving with F)
      const ay = s.F.yaw;
      x = s.F.pos.x + Math.cos(ay) * r.x + Math.sin(ay) * r.z;
      z = s.F.pos.z - Math.sin(ay) * r.x + Math.cos(ay) * r.z;
      yaw = ay + r.yaw - Math.PI;
    } else {
      // (A world, offset by how far F has slid since the anchor)
      const dx = s.F.pos.x - A.f0.x;
      const dz = s.F.pos.z - A.f0.z;
      x = A.pos.x + Math.cos(A.yaw) * r.x + Math.sin(A.yaw) * r.z + dx;
      z = A.pos.z - Math.sin(A.yaw) * r.x + Math.cos(A.yaw) * r.z + dz;
      yaw = A.yaw + r.yaw - Math.PI;
      if (A.yawOff) yaw += A.yawOff * (1 - ease((s.t - A.t0) / Math.max(0.05, A.yawT)));
    }
    // obstacles stop the slide (the player's own boxes: walls, buildings)
    p.pos.set(x, 0, z);
    p._collide();
    if (Math.abs(p.pos.x - x) > 1e-4 || Math.abs(p.pos.z - z) > 1e-4) {
      s.F.pos.x += p.pos.x - x;
      s.F.pos.z += p.pos.z - z;
      s.F.vel.set(0, 0, 0);
      if (s.slide) s.slide.v0.set(0, 0, 0);
      x = p.pos.x;
      z = p.pos.z;
    }
    ch.root.position.set(x, groundAt(x, z), z);
    ch.root.quaternion.setFromAxisAngle(Y, yaw);
    if (s.tilt) this._tilt();
    if (s.rootOff) {
      s.rootOff.t += dt;
      const k = 1 - ease(s.rootOff.t / s.rootOff.T);
      ch.root.position.addScaledVector(s.rootOff.d, k);
      if (k <= 0) s.rootOff = null;
    }
    ch.root.updateMatrixWorld(true);
    s.dist = Math.hypot(x - s.startPos.x, z - s.startPos.z);
  }

  /** The vehicle's tilt kept from release, dying away over 0.3 s (applied after the root's yaw). */
  _tilt() {
    const s = this.s;
    if (!s.tilt) return;
    const k = 1 - ease(s.time / 0.3);
    if (k <= 0) {
      s.tilt = null;
      return;
    }
    this.v.character.root.quaternion.multiply(_q2.identity().slerp(s.tilt, k));
  }

  /** The falling body: its hips where the flight puts them, the pose hung off them. */
  _ballistic(dt) {
    const s = this.s;
    const ch = this.v.character;
    if (!s.chute || s.chute.state === 'deploy' && s.chute.t < s.chute.openT) {
      // free fall with air drag
      const sp = s.vel.length();
      s.vel.y -= G * dt;
      s.vel.addScaledVector(s.vel, -DRAG * sp * dt);
    }
    s.c.addScaledVector(s.vel, dt);
    s.maxVy = Math.max(s.maxVy, -s.vel.y);
    let yaw = s.chute && s.chute.state === 'canopy' ? s.chute.yaw : s.heldYaw;
    if (s.seq === 'jump' && s.clipYaw0 !== undefined && !(s.chute && s.chute.state === 'canopy')) {
      // (the rest of heli-jump turns the body on as it did in the doorway)
      const r = this.v.pack.root(s.clip, Math.min(s.t, s.clip.duration), {});
      yaw = s.heldYaw + wrapAngle(r.yaw - s.clipYaw0);
      s.yawNow = yaw;
    }
    ch.root.quaternion.setFromAxisAngle(Y, yaw);
    this._tilt();
    if (s.chute && s.chute.bank) ch.root.quaternion.multiply(_q.setFromAxisAngle(Z, s.chute.bank * 0.6));
    // (a long free fall: belly to the ground as the speed builds (a skydiver's arch), feet first again for the ground or
    // the canopy's opening (the jerk upright))
    const hNow = s.c.y - groundAt(s.c.x, s.c.z);
    const freefall = !s.chute || s.chute.t < s.chute.openT;
    const flatWant = freefall ? THREE.MathUtils.smoothstep(-s.vel.y, 12, 28) * THREE.MathUtils.smoothstep(hNow, 18, 45) : 0;
    s.flat = (s.flat || 0) + (flatWant - (s.flat || 0)) * (1 - Math.exp(-dt / (flatWant > (s.flat || 0) ? 0.9 : 0.35)));
    if (s.flat > 1e-3) ch.root.quaternion.multiply(_q.setFromAxisAngle(X, -1.25 * s.flat));
    ch.root.position.set(0, 0, 0);
    ch.root.updateMatrixWorld(true);
    const h = ch.bones.Hips.getWorldPosition(_v);
    ch.root.position.subVectors(s.c, h);
    ch.root.updateMatrixWorld(true);
    s.dist = Math.hypot(s.c.x - s.startPos.x, s.c.z - s.startPos.z);
  }

  /** Feet (or hips) on the ground: by the vertical speed, the landing, or WASTED. */
  _contact() {
    const s = this.s;
    const ch = this.v.character;
    const fl = ch.bones.LeftFoot.getWorldPosition(_v);
    const gl = groundAt(fl.x, fl.z);
    const ylo = fl.y - gl;
    const fr = ch.bones.RightFoot.getWorldPosition(_v2);
    const yr = fr.y - groundAt(fr.x, fr.z);
    const hips = ch.bones.Hips.getWorldPosition(_v3);
    const yh = hips.y - groundAt(hips.x, hips.z);
    if (Math.min(ylo, yr) - ANKLE_HEIGHT > 0.01 && yh > 0.45) return;
    if (s.vel.y > 0) return;
    const vy = -s.vel.y;
    const canopy = s.chute && s.chute.state === 'canopy';
    const kind = canopy && vy <= PARA_LAND ? 'para' : vy <= LAND_ROLL ? 'roll' : vy <= LAND_HARD ? 'hard' : 'wasted';
    this.stats.last = { ...(this.stats.last || {}), impactVy: +vy.toFixed(2), impactH: +Math.hypot(s.vel.x, s.vel.z).toFixed(2), landing: kind, chute: s.chute ? s.chute.state : null, fallS: +s.time.toFixed(2) };
    if (s.chute && this.para) this.para.landed(s, kind);
    this._ground(kind);
  }

  /** The landing coming: its clip, from the time to the ground (soles) at the vertical speed now (gravity, or the canopy). */
  _predict() {
    const s = this.s;
    const ch = this.v.character;
    let hs = Infinity;
    for (const n of ['LeftFoot', 'RightFoot']) {
      const f = ch.bones[n].getWorldPosition(_v);
      hs = Math.min(hs, f.y - groundAt(f.x, f.z) - ANKLE_HEIGHT);
    }
    const vy = Math.max(0.05, -s.vel.y);
    const canopy = s.chute && s.chute.state === 'canopy';
    const tc = canopy ? hs / vy : (-vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, hs))) / G;
    const vi = canopy ? vy : vy + G * tc;
    const kind = canopy && vi <= PARA_LAND ? 'para' : vi <= LAND_ROLL ? 'roll' : vi <= LAND_HARD ? 'hard' : 'wasted';
    return { tc, vi, kind };
  }

  _landName(kind) {
    return kind === 'para' ? 'para-land' : kind === 'roll' ? 'land-roll' : 'land-hard';
  }

  _preLand() {
    const s = this.s;
    const p = this._predict();
    const clip = this.clip(this._landName(p.kind));
    if (!clip || clip.note.standIn) return;
    const tg = this.ev(clip, 'ground', 0);
    if (p.tc > tg) return;
    this._switchClip(clip, Math.max(0, tg - p.tc));
    if (p.kind === 'para' || s.chute) s.fade.T = 0.2;
    s.preLand = { kind: p.kind, clip, at: +p.tc.toFixed(3) };
  }

  /** The frame of a landing clip where the pelvis is lowest between its ground and free events (WASTED holds it). */
  _lowest(clip) {
    const g = Math.round(this.ev(clip, 'ground', 0) * FPS);
    const e = Math.round(this.ev(clip, 'free', clip.duration) * FPS);
    let best = g;
    for (let f = g; f <= Math.min(e, clip.frames - 1); f++) if (clip.hips[f * 3 + 1] < clip.hips[best * 3 + 1]) best = f;
    return best / FPS;
  }

  /** On the ground: the landing clip from its events.ground, anchored here, the slide of the carried speed. */
  _ground(kind) {
    const s = this.s;
    const v = this.v;
    const ch = v.character;
    if (kind) {
      // (from a fall: the landing clip by the impact; a bail's roll is already playing)
      const name = this._landName(kind);
      const clip = this.clip(name);
      // (the clip already playing from before the ground goes on from where it is)
      const same = s.preLand && s.clip === clip;
      const tg = same ? Math.min(s.t, clip.duration) : this.ev(clip, 'ground', 0);
      const hv = new THREE.Vector3(s.vel.x, 0, s.vel.z);
      const facing = s.chute && s.chute.state === 'canopy' ? s.chute.yaw : s.heldYaw;
      const travelYaw = hv.lengthSq() > 4 ? Math.atan2(-hv.x, -hv.z) : null;
      // the landing faces the way it goes when it goes somewhere fast (a roll along the travel)
      const yaw = travelYaw !== null && hv.length() > 4 ? travelYaw : facing;
      const hipsBefore = ch.bones.Hips.getWorldPosition(new THREE.Vector3());
      const xf = s.chute ? 0.25 : XF; // ((from under a canopy the arms come down from the toggles: slower)
      // (a frame at 30 m/s is 50 cm: a foot found under the ground lifts the hips it hands over by as much)
      const low = Math.min(...['LeftFoot', 'RightFoot'].map((n) => {
        const f = ch.bones[n].getWorldPosition(_v);
        return f.y - groundAt(f.x, f.z) - ANKLE_HEIGHT;
      }));
      if (low < 0) hipsBefore.y -= low;
      if (!same) this._captureFade(xf);
      s.ballistic = false;
      s.rootOff = null;
      s.clip = clip;
      s.t = tg;
      // anchor: the clip's root at tg where the hips are now, facing `yaw`
      const r = v.pack.root(clip, tg, {});
      const ay = yaw - (r.yaw - Math.PI);
      // F carries the speed at impact less the clip's own root speed there, so the body's speed does not jump
      const r1 = v.pack.root(clip, Math.min(clip.duration, tg + 0.05), {});
      const ownX = (r1.x - r.x) / 0.05;
      const ownZ = (r1.z - r.z) / 0.05;
      const own = new THREE.Vector3(Math.cos(ay) * ownX + Math.sin(ay) * ownZ, 0, -Math.sin(ay) * ownX + Math.cos(ay) * ownZ);
      s.F = { pos: new THREE.Vector3(s.c.x, 0, s.c.z), yaw: 0, vel: hv.clone().sub(own) };
      s.A = { pos: new THREE.Vector3(s.c.x - (Math.cos(ay) * r.x + Math.sin(ay) * r.z), 0, s.c.z - (-Math.sin(ay) * r.x + Math.cos(ay) * r.z)), yaw: ay, f0: s.F.pos.clone(), t0: tg, yawOff: wrapAngle(facing - yaw), yawT: 0.25 };
      // the hips kept where they were for the frame (the root offset dies away over the cross-fade: the impact)
      v.pack.apply(ch.bones, clip, tg, 1);
      if (!same) this._applyFadeAt0();
      else if (s.fade) this._applyFadeNow();
      this._framed(0, tg);
      ch.root.updateMatrixWorld(true);
      const after = ch.bones.Hips.getWorldPosition(new THREE.Vector3());
      s.rootOff = { d: hipsBefore.sub(after), t: 0, T: xf };
      // ((V10, integration) and on this frame too: it was placed without it, the hips popping up 15 cm for a frame)
      ch.root.position.add(s.rootOff.d);
      ch.root.updateMatrixWorld(true);
      if (kind === 'wasted') {
        s.phase = 'wasted';
        v.mode = 'wasted';
        s.wastedAt = s.time;
        s.holdAt = this.ev(clip, 'down', clip.note.standIn ? 0.4 : this._lowest(clip));
        s.lying = !!clip.note.standIn;
        s.F.vel.multiplyScalar(0.3);
        s.slide = { v0: s.F.vel.clone(), t: 0, T: 0.4 };
        this.wastedT = 0;
        if (this.para) this.para.drop();
        return;
      }
    }
    s.phase = 'land';
    v.mode = 'land';
    s.freeT = this.ev(s.clip, 'free', s.clip.duration);
    s.groundT = s.t;
    // the slide: F's speed (what the body carries on top of the clip's own travel: the vehicle's, or the impact's)
    // bled off to nothing by 85 % of the way to events.free
    const v0 = s.F.vel.clone().setY(0);
    s.slide = { v0, t: 0, T: Math.max(0.25, (s.freeT - s.t) * 0.85) };
    const last = this.stats.last || {};
    this.stats.last = { ...last, landing: last.landing || 'bail-roll', slideMs: +v0.length().toFixed(2), slideM: +((v0.length() * s.slide.T) / 2).toFixed(2), landClip: s.clip.name, landPath: v.stats.paths[s.clip.name] };
  }

  /** A new clip in the air (from its time t0), cross-faded from the pose now. */
  _switchClip(clip, t0) {
    const s = this.s;
    this._captureFade(clip.name === 'fall' ? 0.2 : XF);
    s.clip = clip;
    s.t = t0;
  }

  _captureFade(T) {
    const s = this.s;
    const ch = this.v.character;
    const F = (s.fade = s.fade && s.fade._reuse ? s.fade : { q: {}, hips: new THREE.Vector3(), _reuse: true });
    for (const [n, b] of Object.entries(ch.bones)) (F.q[n] = F.q[n] || new THREE.Quaternion()).copy(b.quaternion);
    F.hips.copy(ch.bones.Hips.position);
    F.t = 0;
    F.T = T;
  }

  /** The cross-fade as it stands this frame (without moving its clock). */
  _applyFadeNow() {
    const s = this.s;
    const ch = this.v.character;
    const u = ease(s.fade.t / s.fade.T);
    for (const [n, b] of Object.entries(ch.bones)) if (s.fade.q[n]) b.quaternion.copy(_q.copy(s.fade.q[n]).slerp(b.quaternion, u));
    ch.bones.Hips.position.lerpVectors(s.fade.hips, _v.copy(ch.bones.Hips.position), u);
  }

  _applyFadeAt0() {
    const s = this.s;
    const ch = this.v.character;
    if (!s.fade) return;
    for (const [n, b] of Object.entries(ch.bones)) if (s.fade.q[n]) b.quaternion.copy(s.fade.q[n]);
    ch.bones.Hips.position.copy(s.fade.hips);
  }

  /** A (world) such that the clip's root at t0 is where the body's root is now; facing `toward` (the clip's travel). */
  _anchorAtBody(clip, t0, toward = null) {
    const s = this.s;
    const ch = this.v.character;
    const P = this.v.pack;
    const r = P.root(clip, t0, {});
    const pos = ch.root.getWorldPosition(new THREE.Vector3());
    const bodyYaw = _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y;
    // the clip's travel direction (its root from t0 over its first second) as a yaw in its own frame
    let ay = bodyYaw - (r.yaw - Math.PI);
    let yawOff = 0;
    if (toward !== null) {
      const r1 = P.root(clip, Math.min(clip.duration, t0 + 1.0), {});
      const dx = r1.x - r.x;
      const dz = r1.z - r.z;
      if (Math.hypot(dx, dz) > 0.2) {
        // the travel's yaw in the clip frame, then turned so it points along `toward`
        const clipTravel = Math.atan2(-dx, -dz);
        const want = toward - clipTravel;
        yawOff = wrapAngle(ay - want);
        ay = want;
      }
    }
    const ca = Math.cos(ay);
    const sa = Math.sin(ay);
    s.A = { pos: new THREE.Vector3(pos.x - (ca * r.x + sa * r.z), 0, pos.z - (-sa * r.x + ca * r.z)), yaw: ay, f0: s.F.pos.clone(), t0, yawOff, yawT: this.ev(clip, 'ground', 0.3) };
  }

  /** WASTED with no clip of the fall: the body laid face down where it hit. */
  _lieFlat() {
    const s = this.s;
    const ch = this.v.character;
    const k = ease((s.time - s.wastedAt) / 0.35);
    const yaw = _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y;
    ch.root.quaternion.setFromAxisAngle(Y, yaw).multiply(_q.setFromAxisAngle(X, -1.45 * k));
    ch.root.updateMatrixWorld(true);
    const h = ch.bones.Hips.getWorldPosition(_v);
    const g = groundAt(h.x, h.z);
    // the trunk on the ground: the hips 16 cm over it
    ch.root.position.y += (g + 0.16 - h.y) * k;
  }

  // ------------------------------------------------------------------ the parachute
  _chute(dt) {
    const s = this.s;
    const c = s.chute;
    const para = this.para;
    c.t += dt;
    if (c.state === 'deploy') {
      if (c.t >= c.openT) {
        // the canopy bites: the speed falls to the canopy's over the inflation (a jerk upright)
        const k = 1 - Math.exp(-dt / 0.6);
        const want = para.flyVel(c, _v, s.vel);
        s.vel.lerp(want, k);
      }
      if (c.t >= c.clip.duration) {
        c.state = 'canopy';
        this._switchClip(this.clip('para-hang'), 0);
      }
    } else if (c.state === 'canopy') {
      para.fly(dt, c, s.vel, this.keys);
    }
  }

  /** Real para clips: steer and flare added over para-hang by the toggles. */
  _steerPoses() {
    const s = this.s;
    const c = s.chute;
    const P = this.v.pack;
    const hang = P.clips['para-hang'];
    if (!hang) return;
    const ch = this.v.character;
    // ((V10, integration) the arms move with the toggles (on springs in para.js: the hands start and stop smoothly)
    const L = c.toggleL;
    const R = c.toggleR;
    const flare = Math.min(L, R);
    P.applyAdditive(ch.bones, P.clips['para-flare'], hang, flare);
    P.applyAdditive(ch.bones, P.clips['para-steer-l'], hang, Math.max(0, L - flare));
    P.applyAdditive(ch.bones, P.clips['para-steer-r'], hang, Math.max(0, R - flare));
  }

  /** Stand-in hang: the hands on the toggles (IK), which the toggles' lines pull down for steering and the flare. */
  _handsOnToggles() {
    const s = this.s;
    const c = s.chute;
    const ch = this.v.character;
    const k = c.state === 'deploy' ? ease((c.t - c.pullT) / Math.max(0.1, c.clip.duration - c.pullT)) : 1;
    if (k <= 0) return;
    const b = ch.bones;
    const rq = ch.root.getWorldQuaternion(_q2);
    for (const side of ['Left', 'Right']) {
      const sgn = side === 'Left' ? -1 : 1;
      const pull = side === 'Left' ? c.toggleL || 0 : c.toggleR || 0;
      const sh = b[side + 'Arm'].getWorldPosition(new THREE.Vector3());
      // up: over the shoulder and a little out and forward; pulled: down by the hip
      const up = _v.set(sgn * 0.12, 0.52, -0.1).applyQuaternion(rq).add(sh);
      const hip = b[side + 'UpLeg'].getWorldPosition(new THREE.Vector3()).add(_v2.set(sgn * 0.14, 0.05, -0.12).applyQuaternion(rq));
      const palm = up.lerp(hip, ease(pull));
      const hand = b[side + 'Hand'];
      const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
      const pole = _v3.set(sgn * 0.8, -0.4, 0.3).applyQuaternion(rq).normalize();
      const keep = [b[side + 'Arm'].quaternion.clone(), b[side + 'ForeArm'].quaternion.clone(), hand.quaternion.clone()];
      ch._arm(side, palm, handQ, 0.85, pole.clone());
      if (k < 1) {
        b[side + 'Arm'].quaternion.copy(keep[0].slerp(b[side + 'Arm'].quaternion, k));
        b[side + 'ForeArm'].quaternion.copy(keep[1].slerp(b[side + 'ForeArm'].quaternion, k));
        hand.quaternion.copy(keep[2].slerp(hand.quaternion, k));
      }
      ch.model.updateMatrixWorld(true);
    }
  }

  // ------------------------------------------------------------------ the end of it
  /** Standing: on-foot control from here (the guns come back with the draw). */
  _handOver() {
    const s = this.s;
    const v = this.v;
    const ch = v.character;
    const p = v.player;
    const pos = ch.root.position;
    p.pos.set(pos.x, groundAt(pos.x, pos.z), pos.z);
    p.vel.set(0, 0, 0);
    const f = _v.set(0, 0, -1).applyQuaternion(ch.root.quaternion);
    p.yaw = Math.atan2(-f.x, -f.z);
    p._yaw.x = p.yaw;
    p._yaw.v = 0;
    // the on-foot camera takes the follow camera's heading and pitch (BodyCam eased toward its place)
    p.camYaw = this.cam.yaw;
    p.camPitch = clamp(this.cam.pitch, -0.6, 0.4);
    p._pivot.set(pos.x, p.pos.y + 1.5, pos.z);
    p.move = p._pending = null;
    ch.plantFeetAsPosed();
    ch.root.quaternion.setFromAxisAngle(Y, p.yaw);
    ch.root.position.copy(p.pos);
    this.stats.last = { ...(this.stats.last || {}), handOverS: +s.time.toFixed(2), travelM: +s.dist.toFixed(2), early: s.t < s.clip.duration };
    this.s = null;
    v.mode = 'drawing';
    v.t = 0;
  }

  _respawn() {
    const v = this.v;
    const ch = v.character;
    const p = v.player;
    const at = this.respawnAt ? this.respawnAt() : { x: 0, z: 0, yaw: 0 };
    this.stats.last = { ...(this.stats.last || {}), wasted: true, respawn: [+at.x.toFixed(2), +at.z.toFixed(2)] };
    this.s = null;
    this.wastedT = -1;
    p.pos.set(at.x, groundAt(at.x, at.z), at.z);
    p.vel.set(0, 0, 0);
    p.yaw = p.camYaw = at.yaw;
    p._yaw.x = p.yaw;
    p._yaw.v = 0;
    p.camPitch = -0.1;
    p._pivot.set(at.x, p.pos.y + 1.5, at.z);
    p.move = p._pending = null;
    p.crouched = false;
    ch.root.position.copy(p.pos);
    ch.root.quaternion.setFromAxisAngle(Y, p.yaw);
    ch.root.updateMatrixWorld(true);
    ch.stance = null;
    ch.snapToGround();
    v.clip = null;
    v.usingPack = false;
    v._join = null;
    v.stopping = false;
    v.gunsHidden = false;
    v.mode = 'foot';
    v.t = 0;
    if (this.onRespawn) this.onRespawn();
  }

  // ------------------------------------------------------------------ (V10, integration) the parachute's pickup
  /**
   * Walking into a crate's pack: para-pickup where the clip has it (standing 0.45 m from the pack, facing the crate's
   * side nearest him), eased from the walk (0.3 s, the root and the turn too); the guns away until the draw after
   * events.free. False if the pack has no para-pickup (the pack then goes on at once).
   */
  startPickup(c) {
    const v = this.v;
    const ch = v.character;
    const p = v.player;
    const clip = this.clip('para-pickup');
    if (!clip || clip.note.standIn || v.mode !== 'foot') return false;
    // (turned to face the pack, the hands to it where it lies)
    const now = ch.root.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(now.x - c.x, 0, now.z - c.z).normalize();
    // (0.45 m from the pack as the clip has it: the root eased there over 0.3 s (he triggers it 0.6 m from the pack's
    // middle, so at most 15 cm), the feet held where they stand)
    const spot = new THREE.Vector3(c.x, 0, c.z).addScaledVector(n, 0.45);
    const facing = Math.atan2(n.x, n.z); // (looking along -n, at the pack)
    const r = v.pack.root(clip, 0, {});
    const ay = facing - (r.yaw - Math.PI);
    const bodyYaw = _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y;
    const s = (this.s = {
      kind: 'pickup',
      clip,
      t: 0,
      seq: 'pickup',
      phase: 'land',
      ballistic: false,
      F: { pos: spot.clone(), yaw: 0, vel: new THREE.Vector3() },
      A: { pos: new THREE.Vector3(spot.x - (Math.cos(ay) * r.x + Math.sin(ay) * r.z), 0, spot.z - (-Math.sin(ay) * r.x + Math.cos(ay) * r.z)), yaw: ay, f0: spot.clone(), t0: 0, yawOff: wrapAngle(bodyYaw - facing), yawT: 0.3 },
      rootOff: { d: new THREE.Vector3(now.x - spot.x, 0, now.z - spot.z), t: 0, T: 0.3 },
      feet: v.keepFeet(),
      fade: null,
      time: 0,
      freeT: this.ev(clip, 'free', clip.duration),
      grabT: this.ev(clip, 'grab', clip.duration * 0.3),
      onBackT: this.ev(clip, 'onBack', clip.duration * 0.7),
      crate: c,
      startPos: now.clone(),
      dist: 0,
      log: [],
    });
    this._captureFade(0.3);
    if (this.para) this.para.fitFor(ch);
    v.mode = 'pickup';
    v.t = 0;
    this.stats.last = { kind: 'pickup', path: v.stats.paths['para-pickup'], fromCm: +(now.distanceTo(new THREE.Vector3(spot.x, now.y, spot.z)) * 100).toFixed(1) };
    return true;
  }

  /** para-pickup's contacts: the feet kept where they stood when it began; the hands on the pack's top where it lies. */
  _pickupHeld(s, c, side) {
    if (c.part.startsWith('foot')) return s.feet[side] && c.from <= 0 ? s.feet[side] : null;
    if (c.kind !== 'push' || !s.crate) return null;
    // (the pack's top, either side of its middle across his facing)
    const pk = s.crate.pack;
    const top = pk.position.clone();
    top.y += 0.075;
    const yaw = s.A.yaw;
    const lat = c.at[0];
    top.x += Math.cos(yaw) * lat;
    top.z += -Math.sin(yaw) * lat;
    return { ball: top };
  }

  /** The pack between grab and onBack goes with the right palm; at onBack it is on the back. */
  _carryPack(s) {
    const para = this.para;
    if (!para) return;
    const ch = this.v.character;
    if (!s.grabbed && s.t >= s.grabT) {
      s.grabbed = true;
      para.carryStart(s.crate, ch);
    }
    if (s.grabbed && !s.onBack) {
      if (s.t >= s.onBackT) {
        s.onBack = true;
        para.carryUpdate(ch);
        para.putOn(ch);
      } else para.carryUpdate(ch);
    }
  }

  /** Called when a vehicle is got into again: nothing of the last exit left over. */
  reset() {
    this.s = null;
    this.wastedT = -1;
    this.keys.space = this.keys.left = this.keys.right = this.keys.flare = this.keys.fast = false;
  }
}
