// Motion data, baked into flat arrays so that poses can be blended by hand.
//
//   rifle-motion-<body>.glb (+ .json)  authored in Blender (blender/build_rifle_motion.py), one pack
//                                   per body family (pass R3: rifle-motion-tripo-v1 for the Tripo
//                                   player, rifle-motion-ue5-v1 for the EarthOnline -ue5 bodies): the two
//                                   carried holds, rifle-hold-low and -high, rifle-idle, the
//                                   tactical walk and the jog in eight directions (rifle-walk-f,
//                                   -fl, -l, -bl, -b, -br, -r, -fr; rifle-jog-f ... -fr) and
//                                   rifle-sprint; each with a Gun track: where the gun is held, in
//                                   the chest joint's frame. Its skeleton gives the joints' rest
//                                   offsets.
//                                   And the gun handling, upper-body actions over rifle-hold-low:
//                                   the swaps (swap-rifle-shotgun, swap-shotgun-rifle), the
//                                   reloads and the shotgun's pump (Motion.actions; see Action).
//                                   And the locomotion transitions, one-shot clips that move the
//                                   body over the ground (Motion.pivots, starts, stops, runTurns; see
//                                   _transition): turning on the spot, setting off, stopping and the
//                                   running about-turn.
//   player-weapon-motion-v1.glb     the finger grip (of its aiming hold)
//
// The packs are keyed for the UE5 Mannequin-style skeleton (earthonline-ue5-v1), whose rests are
// not the identity, as real glTF local rotations. They are baked here into CANONICAL local rotations
// of the old joints the game poses (rig.js: canonical world = boneWorld * R[b]^-1; the old joint's
// local = canonicalWorld[old parent]^-1 * canonicalWorld[bone]), so everything above this file keeps
// the old identity-rest math. The root bone's track (the transitions' travel) is not played: the
// character is moved by the notes' `root`. The gun is blended like a joint: its rotation is one more
// entry after the bones', its position (the butt, chest frame) is kept beside the hips'. The Gun
// track and the extra nodes are already in the chest's canonical frame (spine_05's, identity rest).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Frames, UE5_OF, OLD_JOINTS } from './rig.js';

const POSE_PACK = 'player-weapon-motion-v1.glb';
// carried holds (authored with this project's gun track), and EarthOnline's aiming hold, read for
// its finger grip only
const HOLD_CLIPS = { low: 'rifle-hold-low', hip: 'rifle-hold-high' };
const AIM_CLIP = 'hold-rifle-aim';
const DIRECTIONS = ['f', 'fl', 'l', 'bl', 'b', 'br', 'r', 'fr'];
const FPS = 30;

/** Bones the locomotion clips drive. Arms are left out: they are always solved to the rifle. */
export const LOCO_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
export const BONE = Object.fromEntries(LOCO_BONES.map((name, i) => [name, i]));
const NB = LOCO_BONES.length;
/** The gun's rotation is kept after the bones' (Pose.get(GUN)); see Pose.gun for its position. */
export const GUN = NB;
const NQ = NB + 1;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _frame = [0, 0, 0, 0];
const _w = [0, 0, 0, 0];

/**
 * A blended pose: one local rotation per LOCO_BONES entry, then the gun's rotation in the chest
 * joint's frame; the hips position, and the gun's (its butt, chest frame).
 */
export class Pose {
  constructor() {
    this.q = new Float32Array(NQ * 4);
    this.hips = new THREE.Vector3();
    this.gun = new THREE.Vector3();
  }

  clear() {
    this.q.fill(0);
    this.hips.set(0, 0, 0);
    this.gun.set(0, 0, 0);
    return this;
  }

  copy(other) {
    this.q.set(other.q);
    this.hips.copy(other.hips);
    this.gun.copy(other.gun);
    return this;
  }

  /** Adds another pose's sums (each rotation kept on this one's side of the sphere). */
  add(other) {
    const q = this.q;
    const o = other.q;
    for (let i = 0; i < q.length; i += 4) {
      const sign = q[i] * o[i] + q[i + 1] * o[i + 1] + q[i + 2] * o[i + 2] + q[i + 3] * o[i + 3] < 0 ? -1 : 1;
      q[i] += o[i] * sign;
      q[i + 1] += o[i + 1] * sign;
      q[i + 2] += o[i + 2] * sign;
      q[i + 3] += o[i + 3] * sign;
    }
    this.hips.add(other.hips);
    this.gun.add(other.gun);
    return this;
  }

  /** Call once every clip has been added; `weight` is what the clips' weights added up to. */
  normalize(weight = 1) {
    this.hips.divideScalar(weight);
    this.gun.divideScalar(weight);
    const q = this.q;
    for (let i = 0; i < q.length; i += 4) {
      const l = Math.hypot(q[i], q[i + 1], q[i + 2], q[i + 3]);
      if (l > 1e-8) {
        q[i] /= l;
        q[i + 1] /= l;
        q[i + 2] /= l;
        q[i + 3] /= l;
      } else {
        q[i] = q[i + 1] = q[i + 2] = 0;
        q[i + 3] = 1;
      }
    }
    return this;
  }

  get(index, out) {
    const q = this.q;
    const i = index * 4;
    return out.set(q[i], q[i + 1], q[i + 2], q[i + 3]);
  }
}

// The extra nodes a handling clip carries under Spine2 (blender/rifle_motion/bake.py), and
// whether each has a rotation.
const EXTRA = { GunIn: true, PalmL: true, PalmR: true, ElbowL: false, ElbowR: false };

/** Catmull-Rom weights for t in 0..1 between the second and third of four keys. */
function catmull(t, w) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = (-t + 2 * t2 - t3) / 2;
  w[1] = (2 - 5 * t2 + 3 * t3) / 2;
  w[2] = (t + 4 * t2 - 3 * t3) / 2;
  w[3] = (t3 - t2) / 2;
  return w;
}
const _cw = [0, 0, 0, 0];
const _ck = [0, 0, 0, 0];

/**
 * One moment of a handling clip, everything in the chest joint's frame: `pose` (the trunk's local
 * rotations, and the Gun track's butt and turn), the extra nodes (GunIn, PalmL, PalmR: position
 * and rotation; ElbowL, ElbowR: position), and per hand what it holds (0 nothing, 1 the Gun
 * track's gun, 2 GunIn's) and how far its fingers are closed.
 */
export class ActionSample {
  constructor() {
    this.pose = new Pose();
    this.gunQuat = new THREE.Quaternion();
    this.nodes = {};
    for (const [name, turned] of Object.entries(EXTRA)) {
      this.nodes[name] = { pos: new THREE.Vector3(), quat: turned ? new THREE.Quaternion() : null };
    }
    this.hold = [0, 0];
    this.curl = [1, 1];
  }
}

export class Motion {
  constructor() {
    this.actions = {}; // handling clips by name (see sampleAction)
    // shouldered poses: aims[gun][level | up | down] = { pitch (rad), bone -> local rotation, gun
    // { pos, quat } (chest frame, track terms), support: the support hand's turn on the gun }
    this.aims = {};
    this.clips = {}; // idle (rifle-idle), sprint (rifle-sprint)
    // the walk and the jog in eight directions, each by `direction` from forward round to the left
    this.walks = [];
    this.jogs = [];
    // low and hip (the high ready), authored: bone name -> local rotation, and `gun` { pos, quat }
    // in the chest joint's frame; aim, EarthOnline's: bone name -> local rotation (the finger grip)
    this.holds = {};
    this.rest = {}; // bone name -> offset from its parent
    this.stance = {}; // Left / Right: where rifle-idle stands each foot { x, z, toe }, character frame
    // transitions (see _transition): turns on the spot sorted by angle (rad, + = left); starts by
    // gait; stops by gait, in the order of the loop's phase they begin at (each eighth of a cycle);
    // running about-turns by sense (+1 left)
    this.pivots = [];
    this.starts = {};
    this.stops = { walk: [], jog: [] };
    this.runTurns = {};
    // the tactical crouch (blender/rifle_motion/crouch.py): idle, the walk in eight directions (in the
    // walks' order), going down and coming up (one-shots, sampled as transitions are), and where
    // the crouch idle stands each foot { x, z, toe, pitch: heel up about the ball, rad }
    this.crouch = { idle: null, walks: [], down: null, up: null, stance: {} };
  }

  /**
   * pack: the clip pack's name (`<pack>.glb` / `.json` in base); frames: the frames JSON of the body
   * the pack was built for (null: its nodes' rest world rotations are the canonical frames).
   */
  async load(base, pack, frames = null) {
    const RIFLE_PACK = pack;
    this.pack = pack;
    const loader = new GLTFLoader();
    // (fetched, then parsed, so the start-up marks can tell the two apart; pass F2)
    performance.mark(`load:${pack}-fetch-start`);
    const bytes = (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`could not load ${url}`))));
    const [rifleBytes, notes, posesBytes] = await Promise.all([bytes(base + RIFLE_PACK + '.glb'), fetch(base + RIFLE_PACK + '.json').then((r) => r.json()), bytes(base + POSE_PACK)]);
    performance.mark(`load:${pack}-fetched`);
    const [rifle, poses] = await Promise.all([loader.parseAsync(rifleBytes, base), loader.parseAsync(posesBytes, base)]);
    performance.mark(`load:${pack}-parsed`);
    this.notes = notes;
    this.gltf = rifle; // (the pack as loaded: its clips can be played straight onto a body to compare)
    this.frames = new Frames(rifle.scene, frames);
    const fr = this.frames;
    // the old joints' canonical offsets from their old parents
    for (const j of OLD_JOINTS) if (fr.has(j.bone) && j.parent) this.rest[j.name] = fr.offset(j.name);
    for (const name of LOCO_BONES) {
      if (!this.rest[name] && name !== 'Hips') throw new Error(`${RIFLE_PACK}.glb has no bone for "${name}"`);
    }
    // the real bones whose rotations a clip must be read for: every ancestor of a LOCO bone's bone
    const need = new Set();
    for (const name of LOCO_BONES) for (let b = UE5_OF[name]; b; b = fr.parent[b]) need.add(b);
    this._need = fr.order.filter((b) => need.has(b));
    this._oldParent = Object.fromEntries(OLD_JOINTS.map((j) => [j.name, j.parent ? UE5_OF[j.parent] : null]));
    this._find = (gltf, pack, name) => {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) throw new Error(`${pack} has no clip called "${name}"`);
      return clip;
    };
    const find = this._find;
    for (const [key, name] of Object.entries(HOLD_CLIPS)) {
      const clip = this._bake(find(rifle, RIFLE_PACK, name));
      if (!clip.hasGun) throw new Error(`${this.pack} clip "${name}" has no Gun track`);
      const hold = {};
      LOCO_BONES.forEach((bone, i) => (hold[bone] = new THREE.Quaternion().fromArray(clip.quats, i * 4)));
      hold.gun = { pos: new THREE.Vector3().fromArray(clip.gun, 0), quat: new THREE.Quaternion().fromArray(clip.quats, GUN * 4) };
      this.holds[key] = hold;
    }
    this.holds.aim = {};
    for (const track of find(poses, POSE_PACK, AIM_CLIP).tracks) {
      const [bone, property] = track.name.split('.');
      if (property === 'quaternion') this.holds.aim[bone] = new THREE.Quaternion().fromArray(track.values, 0);
    }
    // The clips say for themselves how fast the ground goes under them, which way, and when each
    // foot is down (rifle-motion-v1.json).
    const authored = (name) => this._authored(this._bake(find(rifle, RIFLE_PACK, name)), notes.clips[name]);
    this.clips.idle = authored('rifle-idle');
    this.clips.sprint = authored('rifle-sprint');
    this.walks = DIRECTIONS.map((d) => authored('rifle-walk-' + d)).sort((a, b) => a.direction - b.direction);
    this.jogs = DIRECTIONS.map((d) => authored('rifle-jog-' + d)).sort((a, b) => a.direction - b.direction);
    this.crouch.idle = authored('rifle-crouch-idle');
    this.crouch.walks = this.walks.map((walk) => authored('rifle-crouch-walk-' + DIRECTIONS.find((d) => notes.clips['rifle-walk-' + d].direction === notes.clips[walk.name].direction)));
    for (const key of ['down', 'up']) {
      const name = 'rifle-crouch-' + key;
      const base = this._bake(find(rifle, RIFLE_PACK, name), notes.clips[name].frames);
      this.crouch[key] = { ...base, duration: (notes.clips[name].frames - 1) / FPS };
    }
    for (const side of ['Left', 'Right']) {
      const foot = notes.clips['rifle-crouch-idle'].stance[side];
      this.crouch.stance[side] = { x: -foot.x, z: -foot.z, toe: foot.yaw, pitch: -(foot.pitch || 0) };
    }
    // the transitions: every clip whose notes carry a root track
    for (const [name, note] of Object.entries(notes.clips)) {
      if (!note.root) continue;
      const clip = this._transition(find(rifle, RIFLE_PACK, name), note);
      if (note.kind === 'pivot') this.pivots.push(clip);
      else if (note.kind === 'start') this.starts[note.gait] = clip;
      else if (note.kind === 'stop') this.stops[note.gait].push(clip);
      else if (note.kind === 'runTurn') this.runTurns[Math.sign(note.angle)] = clip;
    }
    this.pivots.sort((a, b) => a.angle - b.angle);
    for (const list of Object.values(this.stops)) list.sort((a, b) => a.entry.phase - b.entry.phase);
    if (!this.pivots.length || !this.starts.walk || !this.starts.jog || !this.stops.walk.length || !this.stops.jog.length || !this.runTurns[1] || !this.runTurns[-1]) throw new Error(`${RIFLE_PACK} is missing its transition clips`);
    // the handling clips: every clip whose notes say per frame what the hands hold
    // and the shouldered poses, by gun and pitch (rifle-aim-level, -up, -down; shotgun-aim-...)
    for (const [name, note] of Object.entries(notes.clips)) {
      if (!note.track) continue;
      const clip = this._action(find(rifle, RIFLE_PACK, name), note);
      if (note.aim === undefined) this.actions[name] = clip;
      else {
        const [gun, , key] = name.split('-');
        (this.aims[gun] = this.aims[gun] || {})[key] = this._aimPose(clip, note.aim);
      }
    }
    for (const gun of ['rifle', 'shotgun']) {
      for (const key of ['level', 'up', 'down']) {
        if (!this.aims[gun] || !this.aims[gun][key]) throw new Error(`${RIFLE_PACK} has no clip "${gun}-aim-${key}"`);
      }
    }
    // the belt kit the reloads draw from: shapes in the Hips joint's frame (blender/rifle_motion/pouch.py)
    this.pouch = notes.pouch || [];
    this.stow = {};
    for (const [gun, s] of Object.entries(notes.gun.stow)) {
      this.stow[gun] = { pos: new THREE.Vector3().fromArray(s.at), quat: new THREE.Quaternion().fromArray(s.quat) };
    }
    // Standing, the feet go where rifle-idle puts them (the character's frame faces -Z, right +X;
    // the clips' faces +Z, left +X).
    for (const side of ['Left', 'Right']) {
      const foot = notes.clips['rifle-idle'].stance[side];
      this.stance[side] = { x: -foot.x, z: -foot.z, toe: foot.yaw };
    }
    performance.mark(`load:${pack}-baked`);
    return this;
  }

  /**
   * Resamples a looping clip at 30 frames a second. Frame `frames` would repeat frame 0. The
   * gun's track (if the clip has one) goes in as one more rotation and its own positions.
   */
  _bake(clip, count) {
    const frames = count || Math.max(1, Math.round(clip.duration * FPS));
    const quats = new Float32Array(frames * NQ * 4);
    const hips = new Float32Array(frames * 3);
    const gun = new Float32Array(frames * 3);
    let hasGun = false;
    for (let i = 3; i < quats.length; i += 4) quats[i] = 1;
    const fr = this.frames;
    const need = this._need;
    // the real local rotations of the bones the old joints hang from, frame by frame (rest where a
    // clip has no track; the root bone always at rest: its travel is the notes' `root`)
    const local = {};
    for (const b of need) {
      const a = (local[b] = new Float32Array(frames * 4));
      const r = fr.restQ[b];
      for (let f = 0; f < frames; f++) r.toArray(a, f * 4);
    }
    const restHips = fr.restT.pelvis;
    for (let f = 0; f < frames; f++) restHips.toArray(hips, f * 3);
    for (const track of clip.tracks) {
      const [bone, property] = track.name.split('.');
      const isGun = bone === 'Gun';
      if (!isGun && !(property === 'quaternion' && local[bone] && bone !== 'root') && !(bone === 'pelvis' && property === 'position')) continue;
      const sample = track.createInterpolant();
      for (let f = 0; f < frames; f++) {
        const value = sample.evaluate(f / FPS);
        if (property === 'quaternion') {
          if (isGun) {
            const o = (f * NQ + GUN) * 4;
            quats[o] = value[0];
            quats[o + 1] = value[1];
            quats[o + 2] = value[2];
            quats[o + 3] = value[3];
          } else local[bone].set([value[0], value[1], value[2], value[3]], f * 4);
        } else if (property === 'position') {
          const to = isGun ? gun : hips;
          to[f * 3] = value[0];
          to[f * 3 + 1] = value[1];
          to[f * 3 + 2] = value[2];
        }
      }
      if (isGun) hasGun = true;
    }
    // canonical worlds, then each old joint's canonical local
    const Q = this._Q || (this._Q = Object.fromEntries(need.map((b) => [b, new THREE.Quaternion()])));
    const C = this._C || (this._C = Object.fromEntries(need.map((b) => [b, new THREE.Quaternion()])));
    const Rinv = this._Rinv || (this._Rinv = Object.fromEntries(need.map((b) => [b, fr.R[b].clone().invert()])));
    for (let f = 0; f < frames; f++) {
      for (const b of need) {
        const p = fr.parent[b];
        _q.fromArray(local[b], f * 4);
        if (p) Q[b].copy(Q[p]).multiply(_q);
        else Q[b].copy(_q);
        C[b].copy(Q[b]).multiply(Rinv[b]);
      }
      for (let i = 0; i < NB; i++) {
        const name = LOCO_BONES[i];
        const parent = this._oldParent[name];
        _q2.copy(C[parent]).invert().multiply(C[UE5_OF[name]]);
        _q2.toArray(quats, (f * NQ + i) * 4);
      }
    }
    return { name: clip.name, frames, duration: frames / FPS, cycles: 1, quats, hips, gun, hasGun, speed: 0, strike: 0 };
  }

  /**
   * A handling clip: played once, start to end. Its frames (30 a second, the last one included)
   * hold the trunk and the Gun track as a Pose, the extra nodes, and from the notes, per frame,
   * what each hand holds and how far its fingers are closed; `events` are named moments (s).
   */
  _action(clip, note) {
    const frames = note.frames;
    const base = this._bake(clip, frames);
    const extra = {};
    for (const name of Object.keys(EXTRA)) extra[name] = { pos: new Float32Array(frames * 3), quat: new Float32Array(frames * 4) };
    for (const track of clip.tracks) {
      const [node, property] = track.name.split('.');
      if (!extra[node]) continue;
      const sample = track.createInterpolant();
      const to = property === 'quaternion' ? extra[node].quat : extra[node].pos;
      const width = property === 'quaternion' ? 4 : 3;
      for (let f = 0; f < frames; f++) to.set(sample.evaluate(f / FPS).slice(0, width), f * width);
    }
    return { ...base, name: clip.name, frames, duration: (frames - 1) / FPS, extra, hold: note.track.hold, curl: note.track.curl, track: note.track, events: note.events || {} };
  }

  /**
   * A transition: played once, start to end, moving the body over the ground. Its notes give, per
   * frame, the root ([x, z, yaw] from where it started: +x left, +z forward in the clip's frame,
   * + yaw to the left) and which feet are down; `entry` / `exit` the loop it comes from or goes
   * into (its gait, the foot that lands there, the loop's phase there and the speed); `plant` the
   * about-turn's outside foot's ground point as it lands ([x, z]).
   */
  _transition(clip, note) {
    const frames = note.frames;
    const base = this._bake(clip, frames);
    return {
      ...base, name: clip.name, frames, duration: (frames - 1) / FPS, kind: note.kind, angle: note.angle || 0,
      root: Float32Array.from(note.root.flat()), down: note.down, entry: note.entry || null, exit: note.exit || null, plant: note.plant || null,
    };
  }

  /**
   * The keys around `t` s of a one-shot clip and their Catmull-Rom weights. Past either end the
   * missing key is carried on in a straight line from the last two (as weights on those), so a
   * transition that begins or ends at speed keeps that speed there rather than easing out of it.
   */
  _once(clip, t) {
    const n = clip.frames;
    const x = THREE.MathUtils.clamp(t * FPS, 0, n - 1);
    const f1 = Math.max(0, Math.min(Math.floor(x), n - 2));
    catmull(x - f1, _cw);
    for (let j = 0; j < 4; j++) _ck[j] = THREE.MathUtils.clamp(f1 - 1 + j, 0, n - 1);
    if (f1 === 0) {
      _cw[1] += 2 * _cw[0];
      _cw[2] -= _cw[0];
      _cw[0] = 0;
    }
    if (f1 + 2 > n - 1) {
      _cw[2] += 2 * _cw[3];
      _cw[1] -= _cw[3];
      _cw[3] = 0;
    }
    return x;
  }

  /** Adds `weight` of a transition's pose at `t` s to `pose` (as accumulate does a loop's). */
  accumulateOnce(clip, t, weight, pose) {
    if (weight <= 0) return;
    this._once(clip, t);
    const src = clip.quats;
    const acc = pose.q;
    const b0 = _ck[1] * NQ * 4;
    for (let i = 0; i < NQ * 4; i += 4) {
      let qx = 0;
      let qy = 0;
      let qz = 0;
      let qw = 0;
      for (let k = 0; k < 4; k++) {
        const o = _ck[k] * NQ * 4 + i;
        const b = b0 + i;
        const w = src[o] * src[b] + src[o + 1] * src[b + 1] + src[o + 2] * src[b + 2] + src[o + 3] * src[b + 3] < 0 ? -_cw[k] : _cw[k];
        qx += src[o] * w;
        qy += src[o + 1] * w;
        qz += src[o + 2] * w;
        qw += src[o + 3] * w;
      }
      const s = acc[i] * qx + acc[i + 1] * qy + acc[i + 2] * qz + acc[i + 3] * qw < 0 ? -weight : weight;
      acc[i] += qx * s;
      acc[i + 1] += qy * s;
      acc[i + 2] += qz * s;
      acc[i + 3] += qw * s;
    }
    for (let k = 0; k < 4; k++) {
      const o = _ck[k] * 3;
      const w = _cw[k] * weight;
      pose.hips.x += clip.hips[o] * w;
      pose.hips.y += clip.hips[o + 1] * w;
      pose.hips.z += clip.hips[o + 2] * w;
      pose.gun.x += clip.gun[o] * w;
      pose.gun.y += clip.gun[o + 1] * w;
      pose.gun.z += clip.gun[o + 2] * w;
    }
  }

  /** A transition's root at `t` s: out.x, out.z (m, the clip's frame) and out.yaw (rad), on a smooth curve. */
  rootAt(clip, t, out) {
    this._once(clip, t);
    out.x = out.z = out.yaw = 0;
    for (let k = 0; k < 4; k++) {
      const o = _ck[k] * 3;
      out.x += clip.root[o] * _cw[k];
      out.z += clip.root[o + 1] * _cw[k];
      out.yaw += clip.root[o + 2] * _cw[k];
    }
    return out;
  }

  /** How much a transition has `side`'s foot (0 left, 1 right) on the ground at `t` s, 0..1. */
  downAt(clip, t, side) {
    const x = THREE.MathUtils.clamp(t * FPS, 0, clip.frames - 1);
    const f = Math.min(Math.floor(x), clip.frames - 2);
    return clip.down[f][side] + (clip.down[f + 1][side] - clip.down[f][side]) * (x - f);
  }

  /** One aiming pose out of its one-frame clip. */
  _aimPose(clip, pitch) {
    const sample = this.sampleAction(clip, 0, new ActionSample());
    const pose = { pitch: THREE.MathUtils.degToRad(pitch), gun: { pos: sample.pose.gun.clone(), quat: sample.gunQuat.clone() } };
    LOCO_BONES.forEach((bone, i) => (pose[bone] = sample.pose.get(i, new THREE.Quaternion())));
    pose.support = sample.gunQuat.clone().invert().multiply(sample.nodes.PalmL.quat);
    return pose;
  }

  /** Samples a handling clip at t seconds (clamped to the clip) into an ActionSample. */
  sampleAction(clip, t, out) {
    const n = clip.frames;
    const x = THREE.MathUtils.clamp(t * FPS, 0, n - 1);
    const f1 = Math.max(0, Math.min(Math.floor(x), n - 2));
    const u = x - f1;
    const w = catmull(u, _cw);
    const k = _ck;
    for (let j = 0; j < 4; j++) k[j] = THREE.MathUtils.clamp(f1 - 1 + j, 0, n - 1);
    const pose = out.pose.clear();
    // (the keys around this moment, as accumulate() joins a looping clip's)
    const quats = clip.quats;
    for (let i = 0; i < NQ * 4; i += 4) {
      const b = k[1] * NQ * 4 + i;
      for (let j = 0; j < 4; j++) {
        const o = k[j] * NQ * 4 + i;
        const sign = quats[o] * quats[b] + quats[o + 1] * quats[b + 1] + quats[o + 2] * quats[b + 2] + quats[o + 3] * quats[b + 3] < 0 ? -w[j] : w[j];
        pose.q[i] += quats[o] * sign;
        pose.q[i + 1] += quats[o + 1] * sign;
        pose.q[i + 2] += quats[o + 2] * sign;
        pose.q[i + 3] += quats[o + 3] * sign;
      }
    }
    for (let j = 0; j < 4; j++) {
      pose.hips.x += clip.hips[k[j] * 3] * w[j];
      pose.hips.y += clip.hips[k[j] * 3 + 1] * w[j];
      pose.hips.z += clip.hips[k[j] * 3 + 2] * w[j];
      pose.gun.x += clip.gun[k[j] * 3] * w[j];
      pose.gun.y += clip.gun[k[j] * 3 + 1] * w[j];
      pose.gun.z += clip.gun[k[j] * 3 + 2] * w[j];
    }
    pose.normalize();
    pose.get(GUN, out.gunQuat);
    for (const [name, node] of Object.entries(out.nodes)) {
      const src = clip.extra[name];
      node.pos.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        node.pos.x += src.pos[k[j] * 3] * w[j];
        node.pos.y += src.pos[k[j] * 3 + 1] * w[j];
        node.pos.z += src.pos[k[j] * 3 + 2] * w[j];
      }
      if (!node.quat) continue;
      let qx = 0;
      let qy = 0;
      let qz = 0;
      let qw = 0;
      const b = k[1] * 4;
      for (let j = 0; j < 4; j++) {
        const o = k[j] * 4;
        const q = src.quat;
        const sign = q[o] * q[b] + q[o + 1] * q[b + 1] + q[o + 2] * q[b + 2] + q[o + 3] * q[b + 3] < 0 ? -w[j] : w[j];
        qx += q[o] * sign;
        qy += q[o + 1] * sign;
        qz += q[o + 2] * sign;
        qw += q[o + 3] * sign;
      }
      node.quat.set(qx, qy, qz, qw).normalize();
    }
    // what a hand holds changes on a frame; the fingers close and open smoothly
    const near = Math.round(x);
    out.hold[0] = clip.hold[near][0];
    out.hold[1] = clip.hold[near][1];
    const c0 = clip.curl[Math.floor(x)];
    const c1 = clip.curl[Math.min(n - 1, Math.floor(x) + 1)];
    out.curl[0] = c0[0] + (c1[0] - c0[0]) * (x - Math.floor(x));
    out.curl[1] = c0[1] + (c1[1] - c0[1]) * (x - Math.floor(x));
    out.frame = x;
    return out;
  }

  /**
   * An authored clip's own notes: ground speed, direction of travel (rad, + = left, in the
   * character's frame), how many gait cycles it holds (each walk clip is several strides, no two
   * alike), when each foot is down, and where each foot is on average (footMean, the clip's
   * frame), about which a step is stretched when the ground goes faster or slower.
   */
  _authored(clip, note) {
    if (!clip.hasGun) throw new Error(`${this.pack} clip "${clip.name}" has no Gun track`);
    clip.speed = note.speed;
    clip.direction = note.direction;
    clip.cycles = note.cycles || 1;
    clip.strike = note.leftStrike || 0;
    clip.contact = {};
    for (const side of ['Left', 'Right']) {
      const contact = new Float32Array(clip.frames);
      for (const [start, end] of note.contact[side]) {
        for (let f = 0; f < clip.frames; f++) {
          const p = f / clip.frames;
          if (end > start ? p >= start && p < end : p >= start || p < end) contact[f] = 1;
        }
      }
      clip.contact[side] = contact;
    }
    clip.footMean = {};
    for (const side of ['Left', 'Right']) {
      const mean = new THREE.Vector3();
      for (let f = 0; f < clip.frames; f++) mean.add(this._ankle(clip, side, f, new THREE.Vector3()));
      clip.footMean[side] = mean.divideScalar(clip.frames);
    }
    return clip;
  }

  /** Where a clip has the ankle at frame f, clip frame. */
  _ankle(clip, side, f, out) {
    const at = (name) => _q2.fromArray(clip.quats, (f * NQ + BONE[name]) * 4);
    out.fromArray(clip.hips, f * 3);
    _q.copy(at('Hips'));
    out.add(_v.copy(this.rest[side + 'UpLeg']).applyQuaternion(_q));
    _q.multiply(at(side + 'UpLeg'));
    out.add(_v.copy(this.rest[side + 'Leg']).applyQuaternion(_q));
    _q.multiply(at(side + 'Leg'));
    out.add(_v.copy(this.rest[side + 'Foot']).applyQuaternion(_q));
    return out;
  }

  /** How much a gait clip has `side`'s foot on the ground at `phase` (cycles, wraps), 0..1. */
  contact(clip, phase, side) {
    const n = clip.frames;
    const at = phase / clip.cycles;
    const x = (at - Math.floor(at)) * n;
    const f0 = Math.floor(x) % n;
    const c = clip.contact[side];
    return c[f0] + (c[(f0 + 1) % n] - c[f0]) * (x - Math.floor(x));
  }

  /**
   * Adds `weight` of a clip's pose to `pose`. `phase` is in cycles and wraps (a clip of several
   * cycles takes that many to play through). Frames are joined with a Catmull-Rom curve rather
   * than straight lines: the clips are only 30 frames a second, and played faster than that
   * straight lines would change every joint's speed abruptly at each frame.
   */
  accumulate(clip, phase, weight, pose) {
    if (weight <= 0) return;
    const n = clip.frames;
    const at = phase / clip.cycles;
    const x = (at - Math.floor(at)) * n;
    let f1 = Math.floor(x);
    const t = x - f1;
    if (f1 >= n) f1 = 0;
    const f0 = (f1 + n - 1) % n;
    const f2 = (f1 + 1) % n;
    const f3 = (f1 + 2) % n;
    const t2 = t * t;
    const t3 = t2 * t;
    const w0 = (-t + 2 * t2 - t3) / 2;
    const w1 = (2 - 5 * t2 + 3 * t3) / 2;
    const w2 = (t + 4 * t2 - 3 * t3) / 2;
    const w3 = (t3 - t2) / 2;
    const src = clip.quats;
    const frame = _frame;
    frame[0] = f0 * NQ * 4;
    frame[1] = f1 * NQ * 4;
    frame[2] = f2 * NQ * 4;
    frame[3] = f3 * NQ * 4;
    const w = _w;
    w[0] = w0;
    w[1] = w1;
    w[2] = w2;
    w[3] = w3;
    const acc = pose.q;
    for (let i = 0; i < NQ * 4; i += 4) {
      // the four keys, each on the same side of the sphere as the one at f1
      const b = frame[1] + i;
      let qx = 0;
      let qy = 0;
      let qz = 0;
      let qw = 0;
      for (let k = 0; k < 4; k++) {
        const o = frame[k] + i;
        const sign = src[o] * src[b] + src[o + 1] * src[b + 1] + src[o + 2] * src[b + 2] + src[o + 3] * src[b + 3] < 0 ? -w[k] : w[k];
        qx += src[o] * sign;
        qy += src[o + 1] * sign;
        qz += src[o + 2] * sign;
        qw += src[o + 3] * sign;
      }
      // stay on the accumulator's side of the sphere so opposite signs do not cancel
      const s = acc[i] * qx + acc[i + 1] * qy + acc[i + 2] * qz + acc[i + 3] * qw < 0 ? -weight : weight;
      acc[i] += qx * s;
      acc[i + 1] += qy * s;
      acc[i + 2] += qz * s;
      acc[i + 3] += qw * s;
    }
    const h = clip.hips;
    const g = clip.gun;
    for (let k = 0; k < 4; k++) {
      const o = (frame[k] / (NQ * 4)) * 3;
      pose.hips.x += h[o] * w[k] * weight;
      pose.hips.y += h[o + 1] * w[k] * weight;
      pose.hips.z += h[o + 2] * w[k] * weight;
      pose.gun.x += g[o] * w[k] * weight;
      pose.gun.y += g[o + 1] * w[k] * weight;
      pose.gun.z += g[o + 2] * w[k] * weight;
    }
  }
}
