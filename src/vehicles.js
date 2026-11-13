// Vehicles (pass V1): one framework the car (and, in a later pass, the helicopter) plugs into.
//
//   T (or Enter) near a vehicle's entry point gets in; T in it gets out. The player goes through
//     foot -> stowing -> walking -> entering -> seated -> leaving -> drawing -> foot
//   stowing   the gun in the hands goes onto the back with the outgoing half of the swap clip
//             (swap-<gun>-<other> up to its `slung` event; main.js plays it: vehicles.stow)
//   walking   the character walks to the entry point (entry_driver_point) and turns as it faces
//   entering  the authored `car-enter` clip if the pack is there (vehicle-motion-<body>-v1, below),
//             else the placeholder: the door opens on its own node, the body steps across and down
//             into the seat, blended from standing to the seated IK pose (seated.js), hands to the
//             rim, the door shuts; the guns are put out of sight (stowed in the cabin) once it is shut
//   seated    the seated pose every frame: car-drive with car-steer-l / -r blended by the wheel and
//             car-look-back when reversing from the pack, or the IK pose; hands and feet pinned to
//             the controls either way (the pack's contacts, else seated.js's points)
//   leaving   the reverse (car-exit, or the placeholder backwards); drawing: the swap's outgoing half
//             backwards, the gun off the back into the hands
//
// Cameras while in a vehicle: chase (a spring that reads speed and yaw rate) and cockpit (at
// camera_cockpit, the head moving under g), free look with the mouse in both; V cycles.
//
// The clip pack contract (VEHICLE_NOTES.md): 30 fps, the rifle packs' bones, clip space = vehicle_root's
// glTF frame, notes per clip: root [x, z, yaw] per frame (root world in the vehicle = T(x,0,z) Ry(yaw), the
// character facing (sin yaw, 0, cos yaw)), events {doorOpenStart, doorOpenEnd, seated, doorCloseStart,
// doorCloseEnd, handsOn}, door per frame 0..1, contacts [{part, from, to, node, at, kind}].
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Frames, OLD_JOINTS, UE5_OF } from './rig.js';
import { Seated, emptyHands, CAR_POINTS } from './seated.js';
import { Smooth, damp, wrapAngle, PALM_LOCAL } from './character.js';
import { HeliSeated } from './heli/seat.js';
import { HeliCameras } from './heli/heli.js';
import { groundAt } from './ground.js';
import { Exits, BAIL_SPEED, STOP_SPEED } from './exits.js';

const REACH = 5; // m from the entry point that T gets in ((V10) 2.6 before: the jog to the door starts from farther)
// (V10) the footprints the walk to the door goes round (vehicle frame, m): x and z ranges, and which side the door is on
const FOOT = { car: { x: [-1.05, 1.05], z: [-2.45, 2.45], side: -1 }, heli: { x: [-1.3, 1.3], z: [-4.6, 4.0], side: 1 } };
const SOLE = new THREE.Vector3();
const PIN_EASE = 4; // frames, (V3) a contact's pin eases in and out over this many
const JOIN = 0.3; // s, (V3) the blend from the pose before an entry or exit clip into its first frames
const JOIN_BAIL = 0.15; // s, (V10) the seated pose into car-bail / heli-jump (clips of 0.6 to 1 s)
const JOG_FROM = 2; // m, (V10) farther from the door than this the walk to it is a jog
const SETTLE_MAX = 0.4; // s, (V10) the settle at the door at most (V6-V9: 0.5 to 1.4 s, and a stop first)
const DOOR_CLOSE = 0.55; // s, (V10) a door left open swings shut by itself in this
const PACK_FPS = 30;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const ease = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const _v3 = new THREE.Vector3();
const LIFT_FADE = 15; // frames (30 fps), (V9) the clip onto the real ground and off it

/**
 * (V9) An entry or exit clip's ground phase: the span of its feet's ground contacts (kind 'ground', on no node), at the
 * clip's start (an entry: { start: true, to }) or its end (an exit: { start: false, from }); null if it has none.
 */
function groundSpan(clip) {
  const g = ((clip.note && clip.note.contacts) || []).filter((c) => c.part.startsWith('foot') && !c.node && c.kind === 'ground');
  if (!g.length) return null;
  const from = Math.min(...g.map((c) => c.from));
  const to = Math.max(...g.map((c) => c.to));
  if (from <= 0) return { start: true, to };
  if (to >= clip.frames - 1) return { start: false, from };
  return null;
}

/**
 * The vehicle clip pack, baked to the proxy skeleton's old joints (all of them, arms and fingers too):
 * per clip per frame each joint's canonical local rotation and the Hips position, plus its notes.
 */
export class VehiclePack {
  static async load(base, name, framesJson) {
    const [glbRes, jsonRes] = await Promise.all([fetch(base + name + '.glb'), fetch(base + name + '.json')]);
    if (!glbRes.ok || !jsonRes.ok) return null;
    const ct = jsonRes.headers.get('content-type') || '';
    if (!ct.includes('json')) return null; // (the dev server answers a missing file with the page)
    const [bytes, notes] = await Promise.all([glbRes.arrayBuffer(), jsonRes.json()]);
    const gltf = await new GLTFLoader().parseAsync(bytes, base);
    const pack = new VehiclePack();
    pack.name = name;
    pack.notes = notes;
    pack.frames = new Frames(gltf.scene, framesJson);
    pack.clips = {};
    for (const clip of gltf.animations) {
      const note = notes.clips && notes.clips[clip.name];
      if (!note) continue;
      pack.clips[clip.name] = pack._bake(clip, note);
    }
    return pack;
  }

  _bake(clip, note) {
    const fr = this.frames;
    const joints = OLD_JOINTS.filter((j) => fr.has(j.bone) && j.parent);
    const frames = note.frames || Math.max(1, Math.round(clip.duration * PACK_FPS) + 1);
    const need = fr.order.filter((b) => !b.startsWith('ik_'));
    const local = {};
    for (const b of need) {
      local[b] = new Float32Array(frames * 4);
      for (let f = 0; f < frames; f++) fr.restQ[b].toArray(local[b], f * 4);
    }
    const hips = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) fr.restT.pelvis.toArray(hips, f * 3);
    for (const track of clip.tracks) {
      const [bone, prop] = track.name.split('.');
      if (prop === 'quaternion' && local[bone] && bone !== 'root') {
        const s = track.createInterpolant();
        for (let f = 0; f < frames; f++) local[bone].set(s.evaluate(f / PACK_FPS).slice(0, 4), f * 4);
      } else if (bone === 'pelvis' && prop === 'position') {
        const s = track.createInterpolant();
        for (let f = 0; f < frames; f++) hips.set(s.evaluate(f / PACK_FPS).slice(0, 3), f * 3);
      }
    }
    const Q = {};
    const C = {};
    const quats = {};
    for (const j of joints) quats[j.name] = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      for (const b of need) {
        const p = fr.parent[b];
        _q.fromArray(local[b], f * 4);
        Q[b] = (Q[b] || new THREE.Quaternion()).copy(p ? Q[p] : new THREE.Quaternion()).multiply(_q);
        C[b] = (C[b] || new THREE.Quaternion()).copy(Q[b]).multiply(_q2.copy(fr.R[b]).invert());
      }
      for (const j of joints) {
        _q.copy(C[UE5_OF[j.parent]]).invert().multiply(C[j.bone]);
        _q.toArray(quats[j.name], f * 4);
      }
    }
    return { name: clip.name, frames, duration: (frames - 1) / PACK_FPS, quats, hips, note };
  }

  /** Writes a clip's pose at `t` s onto the proxy bones (weight blends from what they have). */
  apply(bones, clip, t, weight = 1) {
    const x = THREE.MathUtils.clamp(t * PACK_FPS, 0, clip.frames - 1);
    const f0 = Math.floor(x);
    const f1 = Math.min(clip.frames - 1, f0 + 1);
    const u = x - f0;
    for (const [name, arr] of Object.entries(clip.quats)) {
      const bone = bones[name];
      if (!bone) continue;
      _q.fromArray(arr, f0 * 4).slerp(_q2.fromArray(arr, f1 * 4), u);
      if (weight >= 1) bone.quaternion.copy(_q);
      else bone.quaternion.slerp(_q, weight);
    }
    _v.fromArray(clip.hips, f0 * 3).lerp(_v2.fromArray(clip.hips, f1 * 3), u);
    if (weight >= 1) bones.Hips.position.copy(_v);
    else bones.Hips.position.lerp(_v, weight);
  }

  /**
   * (V2) A one-pose clip added over what the bones have (the pack's seatedReference rule): per joint
   * delta = pose * reference^-1 (reference = the loop's frame 0), applied as slerp(1, delta, w) * current;
   * the hips' translation by the difference.
   */
  applyAdditive(bones, pose, ref, weight) {
    if (!pose || !ref || weight <= 1e-4) return;
    const w = Math.min(1, weight);
    for (const [name, arr] of Object.entries(pose.quats)) {
      const bone = bones[name];
      const r = ref.quats[name];
      if (!bone || !r) continue;
      _q.fromArray(arr, 0).multiply(_q2.fromArray(r, 0).invert());
      _q2.identity().slerp(_q, w);
      bone.quaternion.premultiply(_q2);
    }
    _v.fromArray(pose.hips, 0).sub(_v2.fromArray(ref.hips, 0)).multiplyScalar(w);
    bones.Hips.position.add(_v);
  }

  /** The pack's vehicleFit for a vehicle ('car' | 'heli'): { node: Vector3 } (empty if none). */
  fit(kind) {
    const f = this.notes.vehicleFit && this.notes.vehicleFit[kind];
    const out = {};
    if (f) for (const [node, v] of Object.entries(f)) if (v && v.translate) out[node] = new THREE.Vector3().fromArray(v.translate);
    return out;
  }

  /**
   * (V7) The vehicleFit's `scale` entries (the second request's contract: `scale: [x, y, z]` beside `translate`, in the
   * node's own frame, about its origin): { node: Vector3 } (empty if none, as in every pack before it).
   */
  fitScale(kind) {
    const f = this.notes.vehicleFit && this.notes.vehicleFit[kind];
    const out = {};
    if (f) for (const [node, v] of Object.entries(f)) if (v && Array.isArray(v.scale) && v.scale.length === 3) out[node] = new THREE.Vector3().fromArray(v.scale);
    return out;
  }

  /** The contact of `part` in a clip (first one), or null. */
  contact(clip, part) {
    return (clip.note.contacts || []).find((c) => c.part === part) || null;
  }

  /** notes `root` at t: { x, z, yaw } in the vehicle's frame. */
  root(clip, t, out = {}) {
    const r = clip.note.root;
    if (!r) return null;
    const x = THREE.MathUtils.clamp(t * PACK_FPS, 0, r.length - 1);
    const f0 = Math.floor(x);
    const f1 = Math.min(r.length - 1, f0 + 1);
    const u = x - f0;
    out.x = r[f0][0] + (r[f1][0] - r[f0][0]) * u;
    out.z = r[f0][1] + (r[f1][1] - r[f0][1]) * u;
    out.yaw = r[f0][2] + wrapAngle(r[f1][2] - r[f0][2]) * u;
    return out;
  }

  /** The clip's door track at t (0 shut .. 1 open), or null. */
  door(clip, t) {
    const d = clip.note.door;
    if (!d || !d.length) return null;
    const x = THREE.MathUtils.clamp(t * PACK_FPS, 0, d.length - 1);
    const f0 = Math.floor(x);
    const f1 = Math.min(d.length - 1, f0 + 1);
    return d[f0] + (d[f1] - d[f0]) * (x - f0);
  }

  /** Contacts live at frame f: [{part, node, at}] */
  contacts(clip, t) {
    const f = t * PACK_FPS;
    return (clip.note.contacts || []).filter((c) => f >= c.from && f <= c.to);
  }
}

/** Chase and cockpit cameras, with free look. */
export class CarCameras {
  constructor() {
    this.mode = 0; // 0 chase, 1 cockpit
    this.names = ['Chase', 'Cockpit'];
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = new Smooth();
    this.head = new THREE.Vector3();
    this.headV = new THREE.Vector3();
    this.fov = 55;
    this.shake = 0;
    this.started = false;
    this._t = 0;
    // (V7) Shift held in the cockpit: the head leans toward the cluster and the view narrows to 30 deg (eased 0.35 s)
    this.leanHeld = false;
    this.lean = 0;
  }

  cycle() {
    this.mode = (this.mode + 1) % this.names.length;
    this.lookYaw = this.lookPitch = 0;
    return this.names[this.mode];
  }

  /** Mouse free look (pixels); it eases back to straight ahead when the mouse rests. */
  look(dx, dy, dt) {
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.003, -2.6, 2.6);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.003, -0.6, 0.5);
    if (dx === 0 && dy === 0) {
      this._idle = (this._idle || 0) + dt;
      if (this._idle > 1.5) {
        this.lookYaw = damp(this.lookYaw, 0, 2, dt);
        this.lookPitch = damp(this.lookPitch, 0, 2, dt);
      }
    } else this._idle = 0;
  }

  place(dt, camera, car, from = null) {
    const d = car.dyn;
    this._t += dt;
    const root = car.root;
    const speed = Math.hypot(d.vel.x, d.vel.z);
    const kmh = speed * 3.6;
    // car yaw from its forward on the ground
    const f = _v.set(0, 0, -1).applyQuaternion(root.quaternion);
    const carYaw = Math.atan2(-f.x, -f.z);
    let fov;
    if (this.mode === 0) {
      // chase: the camera's heading follows the car's with a lag that grows with the yaw rate, so a
      // corner shows the car turning in; it falls back further with speed, and rides a spring
      if (!this.started) {
        this.yaw.x = carYaw;
        this.yaw.v = 0;
      }
      this.yaw.x = carYaw - wrapAngle(carYaw - this.yaw.x);
      const yaw = this.yaw.to(carYaw, 0.28 + Math.min(0.25, Math.abs(d.omega.y) * 0.25), dt) + this.lookYaw;
      const back = 5.6 + Math.min(1.6, speed * 0.016);
      const up = 1.75 + Math.min(0.4, speed * 0.004) + this.lookPitch * -2;
      const target = root.localToWorld(_v2.set(0, 0.62, 0)); // camera_chase_target
      const want = _v.set(Math.sin(yaw) * back, up, Math.cos(yaw) * back).add(target);
      if (!this.started) {
        this.pos.copy(from || want);
        this.vel.set(0, 0, 0);
        this.started = true;
      }
      // spring on position (stiff along, softer up and down: the car's heave is not all passed on)
      const k = 70;
      const c = 2 * Math.sqrt(k) * 0.95;
      this.vel.x += ((want.x - this.pos.x) * k - (this.vel.x - d.vel.x) * c) * dt;
      this.vel.z += ((want.z - this.pos.z) * k - (this.vel.z - d.vel.z) * c) * dt;
      this.vel.y += ((want.y - this.pos.y) * 30 - this.vel.y * 2 * Math.sqrt(30) * 0.9) * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (dt <= 0) this.pos.copy(want);
      camera.position.copy(this.pos);
      const ground = car.groundAt ? car.groundAt(this.pos.x, this.pos.z) : 0;
      camera.position.y = Math.max(camera.position.y, ground + 0.4);
      camera.lookAt(target.x, target.y + 0.35, target.z);
      if (this.lookPitch) camera.rotateX(this.lookPitch * 0.5);
      fov = 55 + Math.min(9, kmh * 0.03);
    } else {
      // cockpit: at camera_cockpit, the head moving under g on a spring (lags the car's accelerations)
      const node = car.nodes.camera_cockpit;
      const a = d.accBody;
      const want = _v.set(-a.x * 0.006, -a.y * 0.002, -a.z * 0.006);
      const k = 120;
      this.headV.addScaledVector(_v2.subVectors(want, this.head).multiplyScalar(k).addScaledVector(this.headV, -2 * Math.sqrt(k) * 0.7), dt);
      this.head.addScaledVector(this.headV, dt);
      if (dt <= 0) this.head.copy(want);
      this.head.clampLength(0, 0.05);
      node.updateWorldMatrix(true, false);
      // (at the driver's eye when there is one: camera_cockpit is where the model's own seat puts the
      // eye; the driver sits 12 cm further forward, seated.js HIPS_OFFSET)
      if (this.eye) camera.position.copy(this.eye).add(_v.copy(this.head).applyQuaternion(root.quaternion)).add(_v2.set(0, 0.02, -0.03).applyQuaternion(root.quaternion));
      else camera.position.copy(root.localToWorld(_v.copy(node.position).add(this.head)));
      camera.quaternion.copy(root.getWorldQuaternion(_q));
      // (head tilts a little into the corner, and looks)
      // (V2) reframed: the eye at the seated head (the pack's pose when it fits), pitched 8 deg down, a 54 deg
      // vertical field (was 68 to 74 deg at -4 deg: the roof lining filled the top half and the road was a
      // band): the road from 4 m ahead to the horizon fills the lower half, the screen top cuts the header rail
      this.lean = THREE.MathUtils.clamp(this.lean + (this.leanHeld ? 1 : -1) * (dt / 0.35), 0, 1);
      const ln = this.lean * this.lean * (3 - 2 * this.lean);
      camera.quaternion.multiply(_q2.setFromEuler(_e.set(THREE.MathUtils.lerp(this.lookPitch - 0.14, -0.42, ln), this.lookYaw * (1 - ln), a.x * 0.003, 'YXZ')));
      if (ln > 0) camera.position.add(_v.set(0, 0, -0.1 * ln).applyQuaternion(camera.quaternion));
      fov = THREE.MathUtils.lerp(54 + Math.min(5, kmh * 0.015), 30, ln);
      if (ln > 0) this.fov = fov;
      this.started = true;
    }
    // shake with speed (subtle): road texture, more on kerbs
    const bump = car.dyn.wheels.reduce((s, w) => s + Math.abs(w.xv), 0);
    const amp = Math.min(0.004, kmh * 0.000008 + bump * 0.0015) * (this.mode === 0 ? 1 : 0.6);
    camera.position.x += Math.sin(this._t * 37.1) * amp;
    camera.position.y += Math.sin(this._t * 41.7 + 1) * amp;
    // (V5) a hit shakes the view by its speed change (car.shake 0..1, decaying in about 0.2 s): up to 6 cm and 1.5 deg
    if (car.shake > 0) {
      const k = car.shake;
      camera.position.x += Math.sin(this._t * 53.3) * 0.06 * k;
      camera.position.y += Math.sin(this._t * 61.1 + 2) * 0.05 * k;
      camera.rotateZ(Math.sin(this._t * 47.7) * 0.026 * k);
      camera.rotateX(Math.sin(this._t * 39.3 + 1) * 0.02 * k);
    }
    this.fov = damp(this.fov, fov, 4, dt || 1);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

// Per vehicle kind: helper nodes, clip names, how it is entered (V2: the helicopter joins the car)
const KIND = {
  car: { entry: 'entry_driver_point', entryAt: [-1.55, 0, -0.25], seat: 'seat_driver_point', enter: 'car-enter', exit: 'car-exit', loop: 'car-drive', out: 'car-bail', fitNodes: ['seat_driver', 'seat_driver_point', 'steering_wheel'], label: 'car' },
  heli: { entry: 'entry_cockpit_R', entryAt: [1.8, 0, -1.55], seat: 'seat_pilot_point', enter: 'heli-enter', exit: 'heli-exit', loop: 'heli-fly', out: 'heli-jump', fitNodes: ['pilot_seat', 'seat_pilot_point', 'pedal_L', 'pedal_R'], label: 'helicopter' },
};

export class Vehicles {
  constructor({ car, heli = null, character, player, sound, carSound }) {
    this.car = car;
    this.heli = heli;
    this.character = character;
    this.player = player;
    this.sound = sound;
    this.carSound = carSound;
    this.mode = 'foot';
    this.kind = 'car'; // the vehicle being got into, sat in, got out of
    this.t = 0;
    this.seated = new Seated();
    this.pilot = new HeliSeated();
    this.carCams = new CarCameras();
    this.carCams.eye = character.eye;
    this.heliCams = new HeliCameras();
    this.heliCams.eye = character.eye;
    this.packs = {};
    this.pack = null;
    this.stow = null;
    this.gunsHidden = false;
    this._entry = new THREE.Vector3();
    this.usingPack = false;
    this.usePackSeated = true; // (V2) the pack's seated loop + pose clips when the pack fits the cabins
    this.stats = { palm: { Left: 0, Right: 0 }, paths: {} };
    this._fitRest = {};
    // (V10) getting out at any speed, the falls and the parachute (exits.js); doors that close by themselves; the brake
    // to a stop before car-exit; main.js says whether movement keys or the vehicle's own keys are held
    this.exits = new Exits(this);
    this.closers = {};
    this.stopping = false;
    this.moveHeld = null;
    this.controlHeld = null;
    this.settleSpeed = null;
  }

  /** The vehicle object being used (car or heli). */
  get v() {
    return this.kind === 'heli' ? this.heli : this.car;
  }

  get cameras() {
    return this.kind === 'heli' ? this.heliCams : this.carCams;
  }

  /** Door of the vehicle in use, 0 shut .. 1 open. */
  get door() {
    return this.kind === 'heli' ? this.heli.door : this.car.doorL;
  }

  set door(x) {
    if (this.kind === 'heli') this.heli.door = x;
    else this.car.doorL = x;
  }

  async loadPack(entry, base, framesJson) {
    const name = entry.pack.replace('rifle-motion', 'vehicle-motion');
    if (!(name in this.packs) || this._reload) {
      this.packs[name] = null;
      try {
        this.packs[name] = await VehiclePack.load(base + '', name, framesJson);
      } catch (err) {
        console.warn(`vehicle pack ${name} not used:`, err.message);
        this.packs[name] = null;
      }
    }
    this.pack = this.packs[name];
    return this.pack;
  }

  /** Does the pack fit this vehicle's cabin (its clips were built with vehicleFit for it)? */
  _packFits(kind = this.kind) {
    const p = this.pack;
    return !!(p && p.notes.vehicleFit && p.notes.vehicleFit[kind] && p.clips[KIND[kind].loop]);
  }

  /** Applies (or takes off) the active body's vehicleFit on the vehicle's real nodes. */
  applyFit(kind, on) {
    const veh = kind === 'heli' ? this.heli : this.car;
    if (!veh || !veh.ready) return;
    const fit = on && this.pack ? this.pack.fit(kind) : {};
    const scale = on && this.pack && this.pack.fitScale ? this.pack.fitScale(kind) : {};
    this.fitOn = this.fitOn || {};
    this.fitOn[kind] = on && (Object.keys(fit).length || Object.keys(scale).length) ? fit : null;
    // ((V7) every node a fit has ever named on this vehicle is put back to rest first, then this fit's translate and
    // scale go on: a pack's fit may name nodes beyond the usual ones, and scale)
    this._fitNamed = this._fitNamed || { car: new Set(KIND.car.fitNodes), heli: new Set(KIND.heli.fitNodes) };
    const named = this._fitNamed[kind];
    for (const name of [...Object.keys(fit), ...Object.keys(scale)]) named.add(name);
    const synced = kind === 'heli' ? ['pedal_L', 'pedal_R', 'pilot_seat', 'seat_pilot_point'] : [];
    for (const name of named) {
      const node = veh.nodes[name];
      if (!node) continue;
      const key = kind + '.' + name;
      if (!this._fitRest[key]) this._fitRest[key] = node.position.clone();
      const skey = kind + '.scale.' + name;
      if (!this._fitRest[skey]) this._fitRest[skey] = node.scale.clone();
      node.scale.copy(this._fitRest[skey]);
      if (scale[name]) node.scale.multiply(scale[name]);
      if (synced.includes(name)) continue; // (heli.sync places these from veh.fit every frame)
      node.position.copy(this._fitRest[key]);
      if (fit[name]) node.position.add(fit[name]);
    }
    if (kind === 'heli') {
      veh.fit = fit;
      veh.sync();
      return;
    }
    veh.root.updateMatrixWorld(true);
  }

  entryPoint(out, kind = this.kind) {
    const veh = kind === 'heli' ? this.heli : this.car;
    const k = KIND[kind];
    const n = veh.nodes[k.entry];
    return n ? n.getWorldPosition(out) : veh.root.localToWorld(out.fromArray(k.entryAt));
  }

  get inside() {
    return this.mode === 'entering' || this.mode === 'seated' || this.mode === 'leaving' || this.mode === 'bailing' || this.mode === 'jumping';
  }

  /** (V10) Out of the vehicle in world space: flying out of it, falling, under a canopy, landing, or WASTED. */
  get out() {
    return this.mode === 'air' || this.mode === 'land' || this.mode === 'wasted';
  }

  /** (V10) A door that is not shut swings shut by itself after `delay` s (DOOR_CLOSE s), unless a clip drives it. */
  closeDoor(kind, delay = 0) {
    const veh = kind === 'heli' ? this.heli : this.car;
    const now = kind === 'heli' ? veh.door : veh.doorL;
    if (now <= 0.001) return;
    this.closers[kind] = { from: now, t: -delay };
  }

  /** (V10) Every frame, whatever the mode: the doors closing by themselves; the empty car after a bail. */
  tick(dt) {
    for (const kind of ['car', 'heli']) {
      const C = this.closers[kind];
      if (!C) continue;
      // (a clip that drives this door again takes it back)
      if (this.kind === kind && (this.mode === 'entering' || this.mode === 'leaving' || this.mode === 'bailing' || this.mode === 'jumping')) {
        this.closers[kind] = null;
        continue;
      }
      C.t += dt;
      const x = C.from * (1 - ease(C.t / DOOR_CLOSE));
      if (kind === 'heli') this.heli.door = Math.max(0, x);
      else this.car.doorL = Math.max(0, x);
      if (C.t >= DOOR_CLOSE) this.closers[kind] = null;
    }
    // the driverless car: no throttle, no brake, no steer: it runs on, slowed by the engine in gear (the box shifts down
    // as it slows); at 4 m/s, where the idle governor would hold it crawling in first, the engine stops and it rolls out
    const car = this.car;
    if (car && car.ready && car.abandoned && !(this.inside && this.kind === 'car')) {
      // ((the model has no rolling resistance (V1): engine off, a car would roll on for minutes at walking pace; once
      // the engine has stopped the brakes drag at 2 % (0.4 m/s^2), standing in for the tyres' and the box's drag)
      Object.assign(car.dyn.input, { throttle: 0, brake: car.ignitionOn ? 0 : 0.02, steer: 0, handbrake: 0 });
      if (Math.abs(car.dyn.speed) < 4 && car.ignitionOn) {
        car.switchOff();
        car.userOff = false;
      }
      if (Math.abs(car.dyn.speed) < 0.05 && !car.ignitionOn) car.abandoned = false;
    }
    // the brake to a stop before car-exit: main.js holds the brake while `stopping`
    if (this.stopping && this.mode === 'seated' && this.kind === 'car' && Math.abs(this.car.dyn.speed) <= STOP_SPEED) {
      this.stopping = false;
      this.toggle();
    }
  }

  /** The vehicle kind near enough to get into (null if none). */
  nearest() {
    let best = null;
    let bestD = REACH;
    for (const kind of ['car', 'heli']) {
      const veh = kind === 'heli' ? this.heli : this.car;
      if (!veh || !veh.ready) continue;
      // ((V10) a helicopter on its side or its back is a wreck: not got into (main.js puts it back on the helipad)
      const upright = kind !== 'heli' || _v.set(0, 1, 0).applyQuaternion(veh.root.quaternion).y > 0.7;
      const still = upright && (kind === 'heli' ? veh.speed < 0.5 && veh.state.contact.onGround : Math.abs(veh.dyn.speed) < 1);
      if (!still) continue;
      this.entryPoint(this._entry, kind);
      const d = Math.hypot(this._entry.x - this.player.pos.x, this._entry.z - this.player.pos.z);
      if (d < bestD) {
        bestD = d;
        best = kind;
      }
    }
    return best;
  }

  near() {
    return !!this.nearest();
  }

  toggle() {
    if (this.mode === 'foot') {
      const kind = this.nearest();
      if (!kind) return null;
      this.kind = kind;
      this.mode = 'stowing';
      this.t = 0;
      this._start = this._settle = null;
      this._jog = undefined;
      this._via = undefined;
      return 'in';
    }
    if (this.mode === 'seated') {
      // (V10) out at any speed (V1-V9 refused: 'moving' over 1.5 m/s, 'flying', and 'rotor', which waited
      // for a shutdown of 35 s and more): the car brakes to a stop and then car-exit up to BAIL_SPEED, over it the
      // driver bails; the helicopter on its skids: heli-exit at once, the engine left running; off the ground: heli-jump
      if (this.kind === 'car') {
        const d = this.car.dyn;
        const speed = Math.hypot(d.vel.x, d.vel.z);
        if (speed > BAIL_SPEED) return this._out('car-bail');
        if (Math.abs(d.speed) > STOP_SPEED || speed > 0.6) {
          this.stopping = true;
          return 'stopping';
        }
      } else if (!this.heli.state.contact.onGround || this.heli.speed > 3) return this._out('heli-jump');
      this.stopping = false;
      this._captureJoin();
      this.mode = 'leaving';
      this.t = 0;
      this._startClip(KIND[this.kind].exit);
      return 'out';
    }
    return null;
  }

  /** (V10) car-bail or heli-jump: in the vehicle's frame from the seated pose, until its events.release. */
  _out(name) {
    this.stopping = false;
    this._captureJoin('toClip', JOIN_BAIL);
    this.mode = this.kind === 'car' ? 'bailing' : 'jumping';
    this.t = 0;
    this.clip = this.exits.clip(name, this.kind);
    this.usingPack = !!this.clip;
    this._release = this.exits.ev(this.clip, 'release', this.clip.duration * 0.75);
    this.exits.track(1 / 60);
    return this.kind === 'car' ? 'bail' : 'jump';
  }

  _clip(name) {
    return this.pack && this.pack.clips[name] ? this.pack.clips[name] : null;
  }

  _startClip(name) {
    // (entry and exit clips only count when the pack's cabin fit matches: they were built on it)
    this.clip = this._packFits() ? this._clip(name) : null;
    this.usingPack = !!this.clip;
    this.stats.paths[name] = this.usingPack ? 'clip' : 'placeholder';
  }

  /**
   * (V6) Where the walk must end: the entry clip's first frame (its notes root, world: x, z, yaw as player.yaw) and
   * where that frame has the feet (world x, z and heading), or for the placeholder the entry point facing the
   * helper's way and the stance's own feet. The clip's frame 0 is put on the proxy bones for a moment, its foot
   * contacts pinned as the clip path pins them, read, and the pose put back.
   */
  _entryStart() {
    const ch = this.character;
    const V = this.v.root;
    V.updateMatrixWorld(true);
    const k = KIND[this.kind];
    const clip = this._packFits() ? this._clip(k.enter) : null;
    if (!clip) {
      this.entryPoint(_v);
      const f = this.kind === 'heli' ? _v2.set(-1, 0, 0).applyQuaternion(V.quaternion) : _v2.set(0, 0, -1).applyQuaternion(V.quaternion);
      return { x: _v.x, z: _v.z, yaw: Math.atan2(-f.x, -f.z), feet: null };
    }
    const keep = {};
    for (const [n, b] of Object.entries(ch.bones)) keep[n] = b.quaternion.clone();
    const hips = ch.bones.Hips.position.clone();
    const pos = ch.root.position.clone();
    const quat = ch.root.quaternion.clone();
    const r = this.pack.root(clip, 0, {});
    ch.root.position.copy(V.localToWorld(_v.set(r.x, 0, r.z)));
    this._lift(ch.root.position, clip, 0);
    ch.root.quaternion.copy(V.getWorldQuaternion(_q)).multiply(_q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw - Math.PI));
    ch.root.updateMatrixWorld(true);
    this.pack.apply(ch.bones, clip, 0, 1);
    ch.model.updateMatrixWorld(true);
    const contactWas = this.stats.contact;
    const worstWas = this.stats.clipWorst;
    this._pinContacts(clip, 0);
    this.stats.contact = contactWas;
    this.stats.clipWorst = worstWas;
    const out = { x: ch.root.position.x, z: ch.root.position.z, yaw: _e.setFromQuaternion(ch.root.quaternion, 'YXZ').y, feet: {} };
    for (const side of ['Left', 'Right']) {
      const foot = ch.bones[side + 'Foot'];
      foot.getWorldPosition(_v);
      foot.getWorldQuaternion(_q);
      _v2.set(0, 0, 1).applyQuaternion(_q);
      out.feet[side] = { x: _v.x, z: _v.z, yaw: Math.atan2(-_v2.x, -_v2.z) };
    }
    for (const [n, b] of Object.entries(ch.bones)) b.quaternion.copy(keep[n]);
    ch.bones.Hips.position.copy(hips);
    ch.root.position.copy(pos);
    ch.root.quaternion.copy(quat);
    ch.root.updateMatrixWorld(true);
    return out;
  }

  /**
   * (V10) A corner to walk round first when the straight line from the player to the walk's end crosses the vehicle's
   * footprint (FOOT, 0.35 m wider): the end of the door's side nearer the player, 0.6 m out; null if the way is clear.
   */
  _detour(S) {
    const V = this.v.root;
    V.updateMatrixWorld(true);
    const F = FOOT[this.kind];
    const m = 0.35;
    const a = V.worldToLocal(_v.set(this.player.pos.x, V.position.y, this.player.pos.z)).clone();
    const b = V.worldToLocal(_v.set(S.x, V.position.y, S.z)).clone();
    const x0 = F.x[0] - m;
    const x1 = F.x[1] + m;
    const z0 = F.z[0] - m;
    const z1 = F.z[1] + m;
    // (the segment against the box: slabs)
    let t0 = 0;
    let t1 = 1;
    for (const [p, d, lo, hi] of [[a.x, b.x - a.x, x0, x1], [a.z, b.z - a.z, z0, z1]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) return null;
        continue;
      }
      let u0 = (lo - p) / d;
      let u1 = (hi - p) / d;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      if (t0 > t1) return null;
    }
    const x = F.side < 0 ? x0 - 0.25 : x1 + 0.25;
    const z = Math.abs(a.z - (z0 - 0.6)) + Math.abs(b.z - (z0 - 0.6)) < Math.abs(a.z - (z1 + 0.6)) + Math.abs(b.z - (z1 + 0.6)) ? z0 - 0.6 : z1 + 0.6;
    const w = V.localToWorld(_v.set(x, 0, z));
    return { x: w.x, z: w.z };
  }

  /**
   * The walk to the door. (V6) It walks to the entry clip's first frame (V5: to within 0.3 m and 0.3 rad of the entry
   * point, and the clip's start then pulled the feet up to 25 cm in one frame). Stopped within 0.6 m, it settles: the
   * root eases the rest of the way and round to the clip's facing while the feet stay planted and step, one at a
   * time, to where the clip's first frame has them (character.stance). Done when root and feet are there.
   */
  walkTo(input, dt) {
    const p = this.player;
    const S = this._start || (this._start = this._entryStart());
    if (this._via === undefined) this._via = this._detour(S);
    // ((V10) round the vehicle's end first when the straight way to the door crosses it)
    let tx = S.x;
    let tz = S.z;
    if (this._via) {
      if (Math.hypot(this._via.x - p.pos.x, this._via.z - p.pos.z) < 0.8) this._via = null;
      else {
        tx = this._via.x;
        tz = this._via.z;
      }
    }
    const dx = tx - p.pos.x;
    const dz = tz - p.pos.z;
    const dist = Math.hypot(dx, dz) + (this._via ? Math.hypot(S.x - tx, S.z - tz) : 0);
    input.back = input.left = input.right = input.sprint = false;
    input.forward = false;
    this.t += dt;
    const st = this._settle;
    if (!st) {
      // ((V10) the brisk approach: a jog when farther than JOG_FROM, the walk nearer)
      if (this._jog === undefined) this._jog = dist > JOG_FROM;
      if (dist < 1.2) this._jog = false;
      input.jog = this._jog;
      const face = dist > 0.35 ? Math.atan2(-dx, -dz) : S.yaw;
      p.camYaw += wrapAngle(face - p.camYaw) * Math.min(1, dt * 5);
      input.forward = dist > 0.45;
      // ((V10) the settle starts as soon as he is within 0.6 m and has slowed (V6-V9 waited for a stop, the stop clip
      // and a turn on the spot); it takes the rest of the way and the turn in at most SETTLE_MAX, from his own speed)
      if ((!this._via && dist <= 0.6 && p.speed < 1.2) || this.t > 8) {
        const turn = Math.abs(wrapAngle(S.yaw - p.yaw));
        this._settle = { u: 0, x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z, yaw: p.yaw, time: THREE.MathUtils.clamp(Math.max(dist / 1.6, turn / 5, 0.3), 0.2, SETTLE_MAX) };
        this.character.stance = S.feet;
        if (p.move && p._endMove) p._endMove();
        p.move = p._pending = null;
        input.jog = false;
      }
      return false;
    }
    // (no transition clip under the settle: one moves the root itself, and the settle's place jumped back in when it
    // ended, 11 cm in one frame at the helicopter)
    if (p.move || p._pending) {
      if (p.move && p._endMove) p._endMove();
      p.move = p._pending = null;
    }
    st.u = Math.min(1, st.u + dt / st.time);
    const e = ease(st.u);
    // ((V10) a cubic from where he was, at the speed he had, to the clip's first frame at rest: no stop before it)
    const u = st.u;
    const h10 = u * (1 - u) * (1 - u) * st.time;
    p.pos.x = THREE.MathUtils.lerp(st.x, S.x, u * u * (3 - 2 * u)) + h10 * st.vx;
    p.pos.z = THREE.MathUtils.lerp(st.z, S.z, u * u * (3 - 2 * u)) + h10 * st.vz;
    p.vel.set(0, 0, 0);
    // (the speed the cubic has now, for the legs (main.js))
    const du = 1e-3;
    const u2 = Math.min(1, u + du);
    const hx = (q) => THREE.MathUtils.lerp(st.x, S.x, q * q * (3 - 2 * q)) + q * (1 - q) * (1 - q) * st.time * st.vx;
    const hz = (q) => THREE.MathUtils.lerp(st.z, S.z, q * q * (3 - 2 * q)) + q * (1 - q) * (1 - q) * st.time * st.vz;
    this.settleSpeed = u2 > u ? Math.hypot(hx(u2) - hx(u), hz(u2) - hz(u)) / ((u2 - u) * st.time) : 0;
    p.yaw = p.camYaw = wrapAngle(st.yaw + wrapAngle(S.yaw - st.yaw) * e);
    p._yaw.x = p.yaw;
    p._yaw.v = 0;
    const se = this.character.stanceError();
    const feet = !S.feet || (!se.stepping && se.error < 0.015);
    this.stats.walkEnd = { rootCm: +(Math.hypot(S.x - p.pos.x, S.z - p.pos.z) * 100).toFixed(2), yawDeg: +((wrapAngle(S.yaw - p.yaw) * 180) / Math.PI).toFixed(2), feetCm: +(se.error * 100).toFixed(2), t: +this.t.toFixed(2), settleS: +st.time.toFixed(2), waitS: +(st.wait || 0).toFixed(2) };
    // ((V10) the feet get what is left of SETTLE_MAX to finish their steps; the clip's join carries what is left of them)
    if (st.u >= 1 && !feet) st.wait = (st.wait || 0) + dt;
    return (st.u >= 1 && (feet || st.wait >= SETTLE_MAX - st.time)) || this.t > 9;
  }

  _placeholderDoor(t, entering) {
    if (entering) return t < 0.1 ? 0 : t < 0.9 ? ease((t - 0.1) / 0.8) : t < 2.7 ? 1 : 1 - ease((t - 2.7) / 0.8);
    return t < 0.8 ? ease(t / 0.8) : t < 2.5 ? 1 : 1 - ease((t - 2.5) / 0.8);
  }

  /** Poses the character for the vehicle modes; true when this frame was handled here. */
  poseInside(dt, standing) {
    if (!this.inside) return false;
    const ch = this.character;
    const veh = this.v;
    const k = KIND[this.kind];
    this.t += dt;
    const entering = this.mode === 'entering';
    const leaving = this.mode === 'leaving';
    const V = veh.root;
    if (this._joinPending) {
      this._captureJoin(this._joinPending);
      this._joinPending = null;
    }
    let weight = 1;
    let handsOn = 1;
    let door = 0;
    let rootDone = false;
    const outClip = this.mode === 'bailing' || this.mode === 'jumping';
    if (this.usingPack && this.clip && (entering || leaving || outClip)) {
      // ---- the authored clip ----
      const clip = this.clip;
      const t = Math.min(this.t, clip.duration);
      const r = this.pack.root(clip, t, this._root || (this._root = {}));
      if (r) {
        ch.root.position.copy(V.localToWorld(_v.set(r.x, 0, r.z)));
        this._lift(ch.root.position, clip, t);
        ch.root.quaternion.copy(V.getWorldQuaternion(_q)).multiply(_q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw - Math.PI));
      }
      ch.root.updateMatrixWorld(true);
      this.pack.apply(ch.bones, clip, t, 1);
      // (V3) the join: the pose the character had when the clip started (standing at the door, or the seated
      // loop at whatever frame it was on) eases into the clip's over JOIN s, root included
      if (this._join && this._join.tag === 'toClip') this._joinBlend(dt);
      // (V3) hands on the helicopter's controls inside a clip: the controls' pose clips added as the seated layer adds
      // them (heli-enter's last and heli-exit's first frames put the left hand on a collective at 13 deg, mid travel;
      // on the ground it is down at 4 deg, 7.9 cm away, past the arm's reach without the lean collective-down adds)
      if (this.kind === 'heli' && !outClip) this._heliControlPoses(clip, t);
      const d2 = this.pack.door(clip, t);
      door = d2 === null ? this._placeholderDoor(this.t, entering) : d2;
      ch.model.updateMatrixWorld(true);
      this._pinContacts(clip, t);
      b_eye(ch);
      this.stats.palm = { Left: -1, Right: -1 };
      if (outClip) {
        // ((V10) car-bail / heli-jump: at events.release the body leaves the vehicle's frame for the world (exits.js))
        this.door = door;
        if (this.t >= this._release) this.exits.release();
        else this.exits.track(dt);
        return true;
      }
      const ev = clip.note.events || {};
      // ((V10) controls live from events.handsOn: the vehicle's keys there take the seated pose at once, the door shuts
      // by itself; (V10) and out of an exit clip from events.free when a movement key is held)
      const early = entering && typeof ev.handsOn === 'number' && this.t >= ev.handsOn && this.controlHeld && this.controlHeld();
      const free = leaving && typeof ev.free === 'number' && this.t >= ev.free && this.moveHeld && this.moveHeld();
      if (this.t >= clip.duration || early || free) {
        if (early || free) this.stats.early = { mode: this.mode, clip: clip.name, t: +this.t.toFixed(2), of: +clip.duration.toFixed(2), door: +door.toFixed(3) };
        if (entering) this._captureJoin('toSeated'); // (the clip's last pose, eased into the seated loop's first frames)
        const kind = this.kind;
        this._finish();
        this._loopT = 0; // (the seated loop starts at its frame 0, where car-enter / heli-enter end)
        if ((early || free) && door > 0.001) {
          this.door = door;
          this.closers[kind] = { from: door, t: 0 };
        }
        return true;
      }
      this.door = door;
      return true;
    }
    if (entering || leaving) {
      // ---- the placeholder: from the entry point across into the seat, blended standing -> seated IK ----
      const t = this.t;
      // ((V6) its last frame into the seated loop: the pose and root the last frame ended with, before this one moves them)
      if (entering && t >= 3.6) this._captureJoin('toSeated');
      door = this._placeholderDoor(t, entering);
      const u = entering ? ease((t - 0.9) / 1.4) : 1 - ease((t - 0.9) / 1.4);
      handsOn = entering ? ease((t - 2.2) / 0.5) : 1 - ease((t - 0.6) / 0.3);
      weight = u;
      const entryN = veh.nodes[k.entry];
      const entry = entryN ? entryN.position : _v.fromArray(k.entryAt);
      const seat = veh.nodes[k.seat].position;
      const across = ease(u * 1.15);
      _v2.set(THREE.MathUtils.lerp(entry.x, seat.x, across), 0, THREE.MathUtils.lerp(entry.z, seat.z, across));
      ch.root.position.copy(V.localToWorld(_v2));
      ch.root.quaternion.copy(V.getWorldQuaternion(_q));
      if (this.kind === 'heli' && across < 0.5) {
        // (still turned to the door at first: from facing the door (-X) to the seat's way)
        ch.root.quaternion.multiply(_q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (Math.PI / 2) * (1 - across * 2)));
      }
      ch.root.updateMatrixWorld(true);
      rootDone = true;
      // ((V6) the placeholder's end into the seated loop is eased as an entry clip's is: with a fitted pack (the
      // EarthOnline bodies since the 01:18 pack) the seated loop is the pack's, not the placeholder's IK pose)
      if (entering && t >= 3.6) {
        standing();
        this._finish();
      } else {
        standing();
        if (leaving && t >= 3.4) this._finish();
      }
    }
    if (!(this.mode === 'seated' && this.closers[this.kind])) this.door = this.mode === 'seated' ? 0 : door;
    if (this.kind === 'heli') this._poseHeli(dt, weight, handsOn, rootDone);
    else this._poseCar(dt, weight, handsOn, rootDone);
    if ((entering || leaving) && this.mode !== 'drawing' && this._join && this._join.on && this._join.tag === 'toClip') {
      // ((V6) and the seated loop into the placeholder's leaving pose, likewise)
      this._joinBlend(dt);
      ch.model.updateMatrixWorld(true);
      ch.rig.apply();
      b_eye(ch);
    }

    if (this.mode === 'seated' && this._join && this._join.on && this._join.tag === 'toSeated') {
      // (V3) the cut from an entry clip into the seated pose, eased over JOIN s (it jumped the right palm 15 cm and
      // the left foot 6 cm in one frame: the clip's last grips and pedal points are not the seated layer's)
      this._joinBlend(dt);
      ch.model.updateMatrixWorld(true);
      ch.rig.apply();
      b_eye(ch);
    }
    return true;
  }

  _poseCar(dt, weight, handsOn, rootDone) {
    const ch = this.character;
    const car = this.car;
    const st = this.seated;
    if (weight <= 0.001) {
      ch.poseArms(emptyHands(ch, this._empty || (this._empty = {})));
      return;
    }
    const pack = this.mode === 'seated' && this.usePackSeated && this._packFits('car');
    if (this.mode === 'seated') this.stats.paths.carSeated = pack ? 'clip' : 'placeholder';
    let targets;
    if (pack) {
      // ---- (V2) the pack: car-drive + car-steer-l/-r (and car-look-back) added by the wheel; IK to the rim ----
      const pts = this._carPoints || (this._carPoints = this._carPointsFromPack());
      st.grip = pts.grip;
      this._packLoop(dt, 'car-drive', car);
      // (V3) the steer poses by where the hands are on the rim, not by the wheel's angle: car-steer-r is the body
      // with the left hand at 12 and the right at 6 (wheel -90 from 9 and 3), car-steer-l the mirror. With
      // push-pull the hands are seldom opposite: by the wheel the body leaned for a hand that had slid elsewhere
      // (the right palm 12 cm short at the top of the rim at -200 degrees of wheel)
      let w = THREE.MathUtils.clamp(car.dyn.steerWheel / (Math.PI / 2), -1, 1);
      const RH = st.rimHands && st.rimHands.hands;
      if (RH) w = -THREE.MathUtils.clamp((Math.PI / 2 - RH.Left.w + (-Math.PI / 2 - RH.Right.w)) / 2 / (Math.PI / 2), -1, 1);
      const P = this.pack;
      const ref = P.clips['car-drive'];
      P.applyAdditive(ch.bones, P.clips[w > 0 ? 'car-steer-l' : 'car-steer-r'], ref, Math.abs(w));
      this._lookBack = damp(this._lookBack || 0, car.dyn.gear === 0 && Math.abs(car.dyn.speed) > 0.2 ? 0.7 : 0, 3, dt || 1);
      P.applyAdditive(ch.bones, P.clips['car-look-back'], ref, this._lookBack);
      ch.model.updateMatrixWorld(true);
      targets = st.pose(dt, ch, car, { weight: 1, handsOn: 1, root: true, trunk: false, points: pts });
    } else {
      st.grip = null;
      targets = st.pose(dt, ch, car, { weight, handsOn, root: rootDone ? true : null });
    }
    // (V5) the torso and head thrown against the belt by the car's acceleration (car.thrown, the same signal that
    // leans him), before the hands go back onto the rim
    if (this.mode === 'seated') this._throwBody(ch, car.thrown);
    if (handsOn < 1) {
      const empty = emptyHands(ch, this._empty || (this._empty = {}));
      const L = targets.palm.Left.clone().lerp(empty.lPalm, 1 - handsOn);
      const R = targets.palm.Right.clone().lerp(empty.rPalm, 1 - handsOn);
      const LQ = empty.lQuat.clone().slerp(targets.quat.Left, handsOn);
      const RQ = empty.rQuat.clone().slerp(targets.quat.Right, handsOn);
      st.arms(ch, car, { palm: { Left: L, Right: R }, quat: { Left: LQ, Right: RQ } }, 0.35 + 0.65 * handsOn);
    } else st.arms(ch, car, targets, 1);
    this.stats.palm = { ...st.palmErr };
  }

  /**
   * (V5) The thrown body: the torso's pitch (+ forward) and roll spread over Spine, Spine1, Spine2; the head's own
   * angle less the torso's over Neck and Head (the head lags the chest), as local turns on the posed bones.
   */
  _throwBody(ch, th) {
    if (!th) return;
    const T = th.torso;
    const H = th.head;
    const b = ch.bones;
    for (const [name, share] of [['Spine', 0.3], ['Spine1', 0.35], ['Spine2', 0.35]]) if (b[name]) b[name].quaternion.multiply(_q.setFromEuler(_e.set(T.p * share, 0, -T.r * share, 'XYZ')));
    for (const [name, share] of [['Neck', 0.45], ['Head', 0.55]]) if (b[name]) b[name].quaternion.multiply(_q.setFromEuler(_e.set((H.p - T.p) * share, 0, -(H.r - T.r) * share, 'XYZ')));
    ch.model.updateMatrixWorld(true);
    b_eye(ch);
  }

  /** The car's control points in vehicle_root's frame from the pack's car-drive contacts. */
  _carPointsFromPack() {
    const P = this.pack;
    const drive = P.clips['car-drive'];
    const at = (part) => {
      const c = P.contact(drive, part);
      if (!c) return null;
      const node = c.node ? this.car.nodes[c.node] : null;
      const p = new THREE.Vector3().fromArray(c.at);
      if (node && node !== this.car.model) p.applyMatrix4(node.matrix); // (interior: identity)
      return p;
    };
    const hand = P.contact(drive, 'hand_l');
    const throttle = at('foot_r') || CAR_POINTS.throttle;
    const rest = at('foot_l') || CAR_POINTS.rest;
    // (the brake pad: as far left of the throttle as seated.js has it, at the throttle's depth)
    const brake = throttle.clone().add(new THREE.Vector3(CAR_POINTS.brake.x - CAR_POINTS.throttle.x, CAR_POINTS.brake.y - CAR_POINTS.throttle.y, CAR_POINTS.brake.z - CAR_POINTS.throttle.z));
    // the pack's contacts are the ball of the foot; seated.js's points are pad faces 3 cm behind it
    for (const p of [throttle, rest, brake]) p.add(new THREE.Vector3(0, 0.005, -0.03));
    return { ...CAR_POINTS, throttle, rest, brake, grip: hand ? { R: Math.hypot(hand.at[0], hand.at[2]), y: hand.at[1] } : null };
  }

  /** Root, trunk and limbs from the pack's seated loop at its own time (the clip's notes root). */
  _packLoop(dt, name, veh) {
    const ch = this.character;
    const P = this.pack;
    const loop = P.clips[name];
    this._loopT = ((this._loopT || 0) + dt) % Math.max(0.1, loop.duration);
    const r = P.root(loop, this._loopT, this._root || (this._root = {}));
    const V = veh.root;
    if (r) {
      ch.root.position.copy(V.localToWorld(_v.set(r.x, 0, r.z)));
      ch.root.quaternion.copy(V.getWorldQuaternion(_q)).multiply(_q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw - Math.PI));
    }
    ch.root.updateMatrixWorld(true);
    P.apply(ch.bones, loop, this._loopT, 1);
    return loop;
  }

  _poseHeli(dt, weight, handsOn, rootDone) {
    const ch = this.character;
    const heli = this.heli;
    const pl = this.pilot;
    const pack = this.mode === 'seated' && this.usePackSeated && this._packFits('heli');
    if (this.mode === 'seated') this.stats.paths.heliSeated = pack ? 'clip' : 'placeholder';
    if (weight <= 0.001) {
      ch.poseArms(emptyHands(ch, this._empty || (this._empty = {})));
      return;
    }
    if (pack) {
      // ---- (V2) heli-fly + the control pose clips added by the controls; IK to the grips and pedals ----
      const P = this.pack;
      const loop = this._packLoop(dt, 'heli-fly', heli);
      const c = heli.state.controls;
      const fwd = c.cyclicPitch >= 0 ? c.cyclicPitch : 0;
      const aft = c.cyclicPitch < 0 ? -c.cyclicPitch : 0;
      const coll = 4 + 16 * c.collective; // deg
      const add = [
        ['heli-cyclic-f', fwd], ['heli-cyclic-b', aft],
        ['heli-cyclic-r', Math.max(0, c.cyclicRoll)], ['heli-cyclic-l', Math.max(0, -c.cyclicRoll)],
        ['heli-collective-up', Math.max(0, (coll - 13) / 7)], ['heli-collective-down', Math.max(0, (13 - coll) / 9)],
        ['heli-pedal-r', Math.max(0, c.pedal)], ['heli-pedal-l', Math.max(0, -c.pedal)],
      ];
      for (const [name, w] of add) P.applyAdditive(ch.bones, P.clips[name], loop, w);
      ch.model.updateMatrixWorld(true);
      // the targets: the pack's contacts on the live nodes, the hands as the clip turns them
      pl.targets(heli);
      for (const [part, side, node] of [['hand_r', 'Right', 'cyclic'], ['hand_l', 'Left', 'collective']]) {
        const ct = P.contact(loop, part);
        if (ct) heli.nodes[node].localToWorld(pl.palm[side].fromArray(ct.at));
        ch.bones[side + 'Hand'].getWorldQuaternion(pl.quat[side]);
      }
      const footQ = {};
      for (const [part, side, node] of [['foot_l', 'Left', 'pedal_L'], ['foot_r', 'Right', 'pedal_R']]) {
        const ct = P.contact(loop, part);
        if (ct) heli.nodes[node].localToWorld(pl.feet[side].fromArray(ct.at));
        footQ[side] = ch.bones[side + 'Foot'].getWorldQuaternion(new THREE.Quaternion());
      }
      pl.legs(ch, heli, 1, footQ);
      pl.arms(ch, heli, pl.palm, pl.quat, 1, 1);
    } else {
      pl.pose(dt, ch, heli, { weight, handsOn, root: rootDone ? true : null });
      const empty = handsOn < 1 ? emptyHands(ch, this._empty || (this._empty = {})) : null;
      pl.arms(ch, heli, pl.palm, pl.quat, 1, handsOn, empty);
    }
    // palms against the grips (cm)
    for (const side of ['Left', 'Right']) {
      const hand = ch.bones[side + 'Hand'];
      hand.getWorldQuaternion(_q);
      // (V3: was a copy of the EarthOnline bodies' palm point, (0, -0.075, 0.028); the Tripo body's is (0, -0.079,
      // 0.0365): the 0.94 cm "offset" at every control position was this measure, not the hands)
      const palm = hand.getWorldPosition(_v).add(_v2.copy(PALM_LOCAL).applyQuaternion(_q));
      pl.palmErr[side] = handsOn < 1 ? -1 : palm.distanceTo(pl.palm[side]) * 100;
    }
    this.stats.palm = { ...pl.palmErr };
  }

  _heliControlPoses(clip, t) {
    const P = this.pack;
    const loop = P.clips['heli-fly'];
    if (!loop) return;
    const f = t * PACK_FPS;
    const on = (clip.note.contacts || []).find((c) => c.part === 'hand_l' && c.node === 'collective' && f >= c.from - PIN_EASE && f <= c.to + PIN_EASE);
    if (!on) return;
    const last = clip.frames - 1;
    const w = ease(Math.min(on.from <= 0 ? 1 : (f - on.from + PIN_EASE) / (2 * PIN_EASE), on.to >= last ? 1 : (on.to - f + PIN_EASE) / (2 * PIN_EASE)));
    const c = this.heli.state.controls;
    const coll = 4 + 16 * c.collective;
    // ((V6) the 8.0 s heli-enter / heli-exit end and start on heli-collective-down's frame 0 (notes events.seatedPose):
    // their hand is already on a collective at 4 deg, so only the difference from there is added; V3-V5's clips were
    // on heli-fly frame 0, at 13 deg. Adding the whole collective-down again doubled it: the head 5.3 m/s at the
    // seated -> heli-exit join.)
    const own = clip.note.events && clip.note.events.seatedPose === 'heli-collective-down' ? 1 : 0;
    P.applyAdditive(this.character.bones, P.clips['heli-collective-up'], loop, Math.max(0, (coll - 13) / 7) * w);
    P.applyAdditive(this.character.bones, P.clips['heli-collective-down'], loop, Math.max(0, Math.max(0, (13 - coll) / 9) - own) * w);
  }

  /** (V3) Keeps the proxy pose and root as they are now, for the join into an entry or exit clip. */
  _captureJoin(tag = 'toClip', T = JOIN) {
    const ch = this.character;
    const J = (this._join = this._join || { q: {}, hips: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
    for (const [name, bone] of Object.entries(ch.bones)) (J.q[name] = J.q[name] || new THREE.Quaternion()).copy(bone.quaternion);
    J.hips.copy(ch.bones.Hips.position);
    // ((V10) the root kept in the vehicle's frame: a join while it moves (a bail at speed) held the body where the car
    // had been, 37 m/s of root speed in one frame at 80 km/h)
    const V = this.v.root;
    V.updateMatrixWorld(true);
    J.pos.copy(ch.root.position);
    V.worldToLocal(J.pos);
    J.quat.copy(V.getWorldQuaternion(_q2)).invert().multiply(ch.root.quaternion);
    J.t = 0;
    J.on = true;
    J.tag = tag;
    J.T = T;
  }

  _joinBlend(dt) {
    const J = this._join;
    if (!J || !J.on) return;
    J.t += dt;
    const u = ease(J.t / (J.T || JOIN));
    if (u >= 1) {
      J.on = false;
      return;
    }
    const ch = this.character;
    for (const [name, bone] of Object.entries(ch.bones)) if (J.q[name]) bone.quaternion.copy(_q.copy(J.q[name]).slerp(bone.quaternion, u));
    ch.bones.Hips.position.lerpVectors(J.hips, _v.copy(ch.bones.Hips.position), u);
    const V = this.v.root;
    const jp = V.localToWorld(_v2.copy(J.pos));
    const jq = V.getWorldQuaternion(_q2).multiply(J.quat);
    ch.root.position.lerpVectors(jp, _v.copy(ch.root.position), u);
    ch.root.quaternion.copy(_q.copy(jq).slerp(ch.root.quaternion, u));
    ch.root.updateMatrixWorld(true);
  }

  /**
   * (V9) How far onto the real ground the clip stands at t (0..1): 1 through its ground phase, eased to 0 over
   * LIFT_FADE frames once both feet are on the vehicle (an entry) or from 0 before the first foot reaches the ground
   * (an exit). The clips' ground is the vehicle's ground plane (its root's y = 0); the helicopter at rest sits 5.5 cm
   * lower than the ground under it (its skids settle), so its clips pinned the feet 5.5 cm into the ground and, at
   * the start of heli-enter, sank the feet there from where the walk had planted them (2 to 3 cm off their contacts
   * for 0.15 s); the car sits on the plane (no change).
   */
  _groundW(clip, t) {
    if (clip._groundSpan === undefined) clip._groundSpan = groundSpan(clip);
    const g = clip._groundSpan;
    if (!g) return 0;
    const f = t * PACK_FPS;
    if (g.start) return f <= g.to ? 1 : 1 - ease((f - g.to) / LIFT_FADE);
    return f >= g.from ? 1 : ease(1 - (g.from - f) / LIFT_FADE);
  }

  /** (V9) A point on the vehicle's ground plane (world) raised or lowered onto the real ground by the clip's weight. */
  _lift(p, clip, t) {
    const w = this._groundW(clip, t);
    if (w > 0) p.y += w * (groundAt(p.x, p.z) - p.y);
    return p;
  }

  /** (V9) A contact's world point: a ground contact (on no node) follows the clip onto the real ground. */
  _groundAt(at, c, node, clip, t) {
    if (c.node || c.kind !== 'ground') return at;
    const w = this._groundW(clip, t);
    if (w <= 0) return at;
    const plane = node.localToWorld(_v3.set(c.at[0], 0, c.at[2])).y;
    at.y += w * (groundAt(at.x, at.z) - plane);
    return at;
  }

  _pinContacts(clip, t) {
    const ch = this.character;
    const veh = this.v;
    // (V3) per contact: the pin eases in and out over PIN_EASE frames at its ends (V2 switched it on and off in one
    // frame: the foot leaving its ground contact at car-enter f160 jumped 8 cm); the limb bends the way the clip
    // bends it (pole from the clip's own elbow / knee, V2 used a fixed one); the clip's fingers are kept (V2's
    // _arm curled them round a rifle grip on the door handle and the glass)
    const f = t * PACK_FPS;
    const last = clip.frames - 1;
    // ((V10) a contact held from the clip's first frame comes in with the join (0.3 s; 0.15 into a bail), not at once:
    // V9's slow settle put the feet on the clip's first-frame places, the brisk one (0.4 s at most) leaves them up to 20 cm
    // off, and the right foot on the brake after a stop is 13 cm from car-exit's pedal contact: both were a jump in a frame)
    const J = this._join;
    const ju = J && J.on && J.tag === 'toClip' ? ease(J.t / (J.T || JOIN)) : 1;
    for (const c of this.pack.contacts(clip, t)) {
      const node = c.node ? veh.nodes[c.node] : veh.root;
      if (!node) continue;
      const at = this._groundAt(node.localToWorld(_v.fromArray(c.at)).clone(), c, node, clip, t);
      const side = c.part.endsWith('_l') ? 'Left' : 'Right';
      const easeIn = c.from <= 0 ? 1 : (f - c.from + 1) / PIN_EASE;
      const easeOut = c.to >= last ? 1 : (c.to - f + 1) / PIN_EASE;
      const w = ease(Math.min(easeIn, easeOut)) * (c.from <= 0 ? ju : 1);
      const hand = c.part.startsWith('hand');
      const chain = hand ? [side + 'Arm', side + 'ForeArm', side + 'Hand'] : [side + 'UpLeg', side + 'Leg', side + 'Foot'];
      const keep = chain.map((n) => ch.bones[n].quaternion.clone());
      const fingers = hand ? Object.keys(ch.bones).filter((n) => n.startsWith(side + 'Hand') && n !== side + 'Hand').map((n) => [n, ch.bones[n].quaternion.clone()]) : [];
      // the clip's own bend: from the line root -> end out to the middle joint
      const A = ch.bones[chain[0]].getWorldPosition(new THREE.Vector3());
      const M = ch.bones[chain[1]].getWorldPosition(new THREE.Vector3());
      const E = ch.bones[chain[2]].getWorldPosition(new THREE.Vector3());
      const axis = E.clone().sub(A).normalize();
      const pole = M.clone().sub(A);
      pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 1e-6) pole.copy(hand ? _v2.set(side === 'Left' ? -1 : 1, -1, 0.3) : _v2.set(0, 1, -0.4)).applyQuaternion(veh.root.quaternion);
      pole.normalize();
      ch.bones[chain[2]].getWorldQuaternion(_q);
      if (hand) ch._arm(side, at, _q.clone(), 1, pole);
      else {
        // the contact is the ball of the foot (or the heel): the ankle from it
        // (V3: the clips' 'ball' contacts are the sole under the ball, 1.7 cm under the ball joint (the body's
        // table ballSole); V2 put the joint on it, the foot 1.7 cm into the ground, the skid or the pedal)
        const toe = _v2.copy(ch.motion.rest.LeftToeBase).add(SOLE.fromArray(ch.table.foot.ballSole[0]));
        const ankle = c.point === 'heel' ? at.clone().add(new THREE.Vector3(0, 0.07, 0)) : at.clone().sub(toe.applyQuaternion(_q));
        ch._leg(side, ankle, pole, _q.clone(), 0);
      }
      for (const [n, q] of fingers) ch.bones[n].quaternion.copy(q);
      if (w < 1) chain.forEach((n, i) => ch.bones[n].quaternion.copy(keep[i].clone().slerp(ch.bones[n].quaternion, w)));
      ch.model.updateMatrixWorld(true);
    }
    // (V3) how far each pinned part ended from its contact (cm): palms (the body's palm point) and the balls of
    // the feet (or heels); per clip the worst, for the review
    const err = (this.stats.contact = {});
    const worst = (this.stats.clipWorst = this.stats.clipWorst || {});
    const w = (worst[clip.name] = worst[clip.name] || {});
    for (const c of this.pack.contacts(clip, t)) {
      const node = c.node ? veh.nodes[c.node] : veh.root;
      if (!node) continue;
      // (only while the pin is at full weight: in its ease frames the limb is meant to be between)
      if ((c.from > 0 && f - c.from + 1 < PIN_EASE) || (c.to < last && c.to - f + 1 < PIN_EASE)) continue;
      if (c.from <= 0 && ju < 1) continue; // ((V10) nor while it comes in with the join)
      const at = this._groundAt(node.localToWorld(_v.fromArray(c.at)), c, node, clip, t);
      const side = c.part.endsWith('_l') ? 'Left' : 'Right';
      let p;
      if (c.part.startsWith('hand')) {
        const hand = ch.bones[side + 'Hand'];
        hand.getWorldQuaternion(_q);
        p = hand.getWorldPosition(_v2).add(new THREE.Vector3().copy(PALM_LOCAL).applyQuaternion(_q));
      } else if (c.point === 'heel') p = ch.bones[side + 'Foot'].getWorldPosition(_v2).sub(new THREE.Vector3(0, 0.07, 0));
      else p = ch.bones[side + 'ToeBase'].getWorldPosition(_v2).add(SOLE.fromArray(ch.table.foot.ballSole[0]).applyQuaternion(ch.bones[side + 'ToeBase'].getWorldQuaternion(_q)));
      const cm = p.distanceTo(at) * 100;
      err[c.part] = +cm.toFixed(2);
      w[c.part] = Math.max(w[c.part] || 0, cm);
    }
    ch.rig.apply();
  }

  _finish() {
    if (this.mode === 'entering') {
      this.mode = 'seated';
      this.t = 0;
      this.door = 0;
      this.gunsHidden = true;
      if (this.kind === 'heli') this.heli.harnessHidden(true);
    } else if (this.mode === 'leaving') {
      const p = this.player;
      this.entryPoint(this._entry);
      // (V5) an exit clip hands over where its last frame stands and faces (its notes root), not at the entry point:
      // the clip ends standing clear of the door, and the placeholder's jump to the entry point would show
      const fromClip = this.usingPack && this.clip;
      // ((V6) the placeholder likewise: it ends standing at the entry point, and facing the door (the helicopter's
      // -X); V5 turned the player to face away from the helicopter (+X) at the hand-over, 180 deg in one frame)
      this._entry.copy(this.character.root.position);
      p.pos.set(this._entry.x, this.character.root.position.y, this._entry.z);
      p.vel.set(0, 0, 0);
      const f = _v.set(0, 0, -1).applyQuaternion(this.character.root.quaternion);
      this.stats.exitHandover = { path: fromClip ? 'clip' : 'placeholder', x: +this._entry.x.toFixed(3), z: +this._entry.z.toFixed(3), yaw: +Math.atan2(-f.x, -f.z).toFixed(3) };
      p.yaw = p.camYaw = Math.atan2(-f.x, -f.z);
      p._yaw.x = p.yaw;
      p._yaw.v = 0;
      p.move = p._pending = null;
      // (V6) the feet stay where the last frame has them (V5's snapToGround put them where the stance wants them: 9 m/s
      // in one frame); the pose itself is carried into the on-foot one by main.js's PoseInertia
      this.character.plantFeetAsPosed();
      // ((V6) the root turned as the player now faces, not to identity: main.js keeps this frame's pose as the last
      // one before the hand-over, and V5's identity made it 180 deg off for the helicopter's exit)
      this.character.root.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      this.character.root.position.copy(p.pos);
      this.door = 0;
      if (this.kind === 'heli') this.heli.harnessHidden(false);
      this.applyFit(this.kind, false);
      this.mode = 'drawing';
      this.t = 0;
    }
  }

  stowed() {
    if (this.mode === 'stowing') {
      this.mode = 'walking';
      this.t = 0;
    } else if (this.mode === 'drawing') {
      this.mode = 'foot';
      this.t = 0;
    }
  }

  arrived() {
    // (V6) the join is taken on the clip's first frame, from the pose the last frame ended with (V3-V5 took it here,
    // before this frame's on-foot pose: a frame old)
    this._joinPending = 'toClip';
    this._start = this._settle = null;
    this._jog = undefined;
    this._via = undefined;
    this.settleSpeed = null;
    this.character.stance = null;
    this.mode = 'entering';
    this.t = 0;
    // ((V10) nothing of the last exit carried into this entry)
    this.exits.reset();
    this.stopping = false;
    this.closers[this.kind] = null;
    if (this.kind === 'car') this.car.abandoned = false;
    this.stats.early = null;
    this.applyFit(this.kind, this._packFits());
    this._carPoints = null;
    this._startClip(KIND[this.kind].enter);
    this.cameras.started = false;
  }
}

function b_eye(ch) {
  const b = ch.bones;
  b.Head.getWorldQuaternion(_q);
  b.Head.getWorldPosition(ch.eye).add(_v.copy(ch._body.eyeLocal).applyQuaternion(_q));
}
export { KIND };
