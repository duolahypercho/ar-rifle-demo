// The utility helicopter in the scene (pass V2): the model (public/vehicles/utility_helicopter.glb, the
// asset with its textures scaled down by blender/vehicles/shrink_textures.py) driven every frame from the
// flight model (flight.js, pure) through the keyboard assist (assist.js, switchable):
//
//   body      helicopter_root placed by the rigid body (state.position / state.quaternion)
//   rotors    main_rotor_pivot turned to the model's azimuth and tilted by its tip-path plane (a1 forward,
//             b1 right); each main blade coned by the model's coning (relative to the modelled static
//             droop); tail_rotor_pivot to the tail azimuth. Blades cross-fade to the blur discs with
//             rotor speed; the blades keep casting their shadow at the real azimuth.
//   controls  cyclic (Rx(-fwd) Rz(-right) about its floor pivot: +9 / -6 deg fore and aft, +-6 side),
//             collective (Rx 4 .. 20 deg), pedals (+-0.045 m along the parent's -Z), the conventions of
//             the vehicle clip packs' `controls`, plus the active body's `vehicleFit` (vehicles.js)
//   door      cockpit_door_R on its hinge (Ry +68 deg x door)
//   lights    nav lights (the model's emissive material) with the power, anti-collision beacons (red,
//             fin top and belly, 1 Hz double flash) and white strobes, the landing light as a spot light
//             at landing_light_point, cockpit displays lit with the power
//   wash      dust ring under the disc: emission from thrust over weight and hub height over the rotor
//             diameter (none above one diameter, within ground effect only), colour from the surface
//   strike    a rotor strike (ground, building, barrier: flight.js obstacleAt) cuts the engine, stops
//             the rotor in about 2 s, bends the blades and throws sparks; it stays until reset()
//
// Buildings and barriers are the car's obstacle boxes (track.js CAR_OBSTACLES), with their tops.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Helicopter, HELI } from './flight.js';
import { FlightAssist } from './assist.js';
import { groundAt } from '../ground.js';
import { WEATHER } from '../terrain.js';
import { LIGHT } from '../look.js';
import { surfaceKind, CAR_OBSTACLES } from '../track.js';
import { batchModel, shadowProxy } from '../batch.js';
import { SpriteCloud } from '../cloud.js';
import { PERF } from '../perf.js';
import { bareAt } from '../flora.js';

const D2R = Math.PI / 180;
const HIDDEN = 31;
export const SHADOW_LAYER = 3; // main.js enables it on the sun's shadow camera (batch.js uses the same)
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Obstacle boxes near a point, refreshed per frame; obstacleAt for the flight model. */
class Obstacles {
  constructor(list) {
    this.list = list;
    this.near = [];
  }
  refresh(x, z, r = 40) {
    this.near.length = 0;
    for (const b of this.list) {
      const reach = Math.hypot(b.hx, b.hz) + r;
      if (Math.abs(b.x - x) < reach && Math.abs(b.z - z) < reach) this.near.push(b);
    }
  }
  /** The point (x, y, z) inside a box: { depth, normal } of the nearest face, else null. */
  at(x, y, z) {
    let best = null;
    for (const b of this.near) {
      if (y > b.top || y < -0.5) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      // box frame as dynamics.js uses it: local x along (c, s), local z along (-s, c)
      const lx = dx * b.c + dz * b.s;
      const lz = -dx * b.s + dz * b.c;
      const ex = b.hx - Math.abs(lx);
      const ez = b.hz - Math.abs(lz);
      if (ex <= 0 || ez <= 0) continue;
      const ey = b.top - y;
      let depth;
      let n;
      if (ey < ex && ey < ez) {
        depth = ey;
        n = [0, 1, 0];
      } else if (ex < ez) {
        depth = ex;
        const sx = Math.sign(lx) || 1;
        n = [sx * b.c, 0, sx * b.s];
      } else {
        depth = ez;
        const sz = Math.sign(lz) || 1;
        n = [-sz * b.s, 0, sz * b.c];
      }
      if (!best || depth > best.depth) best = { depth, normal: n };
    }
    return best;
  }
}

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Heli {
  static COOL = 10; // (V5) s at ground idle before the fuel goes off in a shutdown (real: about 2 minutes)

  constructor(scene) {
    this.scene = scene;
    this.kind = 'heli';
    this.root = new THREE.Group();
    this.root.name = 'helicopter';
    scene.add(this.root);
    this.nodes = {};
    this.ready = false;
    this.obstacles = new Obstacles(CAR_OBSTACLES);
    this.fm = new Helicopter({
      groundAt: (x, z) => {
        const n = _v2;
        const h = groundAt(x, z, n);
        const kind = surfaceKind(x, z);
        return { height: h, normal: [n.x, n.y, n.z], friction: kind === 'dirt' ? 0.75 : 1 };
      },
      obstacleAt: (x, y, z) => this.obstacles.at(x, y, z),
    });
    this.assist = new FlightAssist();
    this.door = 0; // cockpit_door_R 0 shut .. 1 open
    this.discFaint = false;
    this.doorL = 0;
    this.landingLight = false;
    this.power = false; // battery: nav lights, displays (on with the start, or the first time it is used)
    this.fit = {}; // node -> Vector3 (vehicleFit for the body in the seat; vehicles.js sets it)
    this.damaged = false;
    this.strikeAt = null;
    this._t = 0;
    this._dust = [];
    this._sparks = [];
    this.controlsShown = { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 };
  }

  async load(url, specsUrl) {
    const [gltf, specs] = await Promise.all([new GLTFLoader().loadAsync(url), fetch(specsUrl).then((r) => r.json())]);
    this.specs = specs;
    const model = gltf.scene.getObjectByName('helicopter_root') || gltf.scene;
    this.model = model;
    this.root.add(model);
    model.traverse((o) => {
      if (o.name) this.nodes[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material && o.material.transparent) o.castShadow = false;
      }
    });
    const n = this.nodes;
    this.rest = {};
    for (const name of ['main_rotor_pivot', 'tail_rotor_pivot', 'cyclic', 'collective', 'pedal_L', 'pedal_R', 'cockpit_door_R', 'cockpit_door_L', 'pilot_seat', 'seat_pilot_point', 'main_blade_01', 'main_blade_02', 'main_blade_03', 'main_blade_04']) {
      if (n[name]) this.rest[name] = { pos: n[name].position.clone(), quat: n[name].quaternion.clone() };
    }
    this.mats = {};
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.mats[m.name] = m;
    });
    // blades: their own (fadeable) materials for the main and the tail rotor; the blur discs shown
    const own = (names, keep) => {
      const list = [];
      for (const name of names) {
        const node = n[name];
        if (!node) continue;
        node.traverse((o) => {
          if (!o.isMesh) return;
          if (!keep) {
            o.material = o.material.clone();
          }
          list.push(o);
        });
      }
      return list;
    };
    this.mainBlades = own(['main_blade_01', 'main_blade_02', 'main_blade_03', 'main_blade_04']);
    this.tailBlades = own(['tail_blade_01', 'tail_blade_02', 'tail_blade_03', 'tail_blade_04']);
    for (const list of [this.mainBlades, this.tailBlades]) {
      const m = list[0].material.clone();
      for (const o of list) o.material = m;
      list.mat = m;
    }
    this.blur = {};
    for (const name of ['main_rotor_blur', 'tail_rotor_blur']) {
      const node = n[name];
      if (!node) continue;
      node.visible = true;
      // (V3) the blur discs sit on their pivots: the asset carries them under the pivot with the pivot's own
      // offset again (main: y -3.02, so the disc lay at skid height round the aircraft, the orange ring seen
      // through the windscreen and round it from outside; tail: 7 m aft and 1.9 m up of its hub)
      node.position.set(0, 0, 0);
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.depthWrite = false;
        o.castShadow = false;
        o.renderOrder = 2;
        o.userData.base = o.material.opacity;
        this.blur[name] = o;
      });
    }
    // blade span directions in the pivot's frame (for coning about the root)
    const box = new THREE.Box3();
    n.main_rotor_pivot.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(n.main_rotor_pivot.matrixWorld).invert();
    this.bladeAxes = {};
    for (const name of ['main_blade_01', 'main_blade_02', 'main_blade_03', 'main_blade_04']) {
      if (!n[name]) continue;
      box.setFromObject(n[name]);
      const c = box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
      c.y = 0;
      c.normalize();
      // axis in the blade's parent frame (the pivot): up x span; a positive turn about it lowers the tip
      this.bladeAxes[name] = new THREE.Vector3().crossVectors(Y, c).normalize();
    }
    // displays and nav lights: own copies so the power can drive them
    for (const name of ['display_emissive', 'light_nav_emissive', 'light_landing_emissive']) {
      const m = this.mats[name];
      if (m) m.userData.base = m.emissiveIntensity;
    }
    // anti-collision beacons (red, fin top and belly) and white strobes (tail and the skid tips' line)
    const beaconMat = new THREE.MeshBasicNodeMaterial({ color: 0x330000 });
    const strobeMat = new THREE.MeshBasicNodeMaterial({ color: 0x222222 });
    this.beaconMat = beaconMat;
    this.strobeMat = strobeMat;
    const dot = new THREE.SphereGeometry(0.045, 12, 8);
    this.beacons = [];
    for (const p of [[0, 3.02, 7.18], [0, 0.5, 0.2]]) {
      const m = new THREE.Mesh(dot, beaconMat);
      m.position.fromArray(p);
      model.add(m);
      this.beacons.push(m);
    }
    for (const p of [[0, 1.62, 7.72], [1.18, 1.86, 5.6], [-1.18, 1.86, 5.6]]) {
      const m = new THREE.Mesh(dot, strobeMat);
      m.position.fromArray(p);
      model.add(m);
    }
    // (V3: was a point light under the belly; with no shadow it lit the cabin through the floor, and every red
    // flash turned the windscreen pillars and the panel pink in the cockpit view. A spot aimed down from the belly
    // lights the ground round the skids only)
    this.beaconLight = new THREE.SpotLight(0xff2010, 0, 12, THREE.MathUtils.degToRad(70), 0.6, 2);
    this.beaconLight.position.set(0, 0.25, 0.2);
    this.beaconLight.target.position.set(0, -1, 0.2);
    model.add(this.beaconLight, this.beaconLight.target);
    // the landing light
    const llp = n.landing_light_point;
    this.landing = new THREE.SpotLight(0xfff4e6, 0, 160, 16 * D2R, 0.5, 1.5);
    if (llp) {
      llp.add(this.landing);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -10);
      llp.add(target);
      this.landing.target = target;
    }
    // the pilot's seat harness: the webbing triangles of the fabric primitive in front of the backrest,
    // hidden while the seat is taken (the inserts stay)
    this._harness = this._findHarness();
    // dust and sparks
    const tex = softDot();
    // ((V4) one draw for all of them, cloud.js; 140 -> 480 for the rebuilt wash)
    this.dustCloud = new SpriteCloud(this.scene, 480, tex);
    for (let i = 0; i < 480; i++) this._dust.push(this.dustCloud.add({ life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, size: 1, alpha: 0.3 }));
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xffa040 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.userData = { life: 0, vel: new THREE.Vector3() };
      this.scene.add(s);
      this._sparks.push(s);
    }
    this._dustNext = 0;
    // (V4) merged per material under each moving node, shadows from one proxy per node (batch.js); the rotors
    // (blades faded, coned and switched between layers one by one) and the pilot's seat (its harness is cut out
    // of the mesh while the seat is taken) stay as they are
    const keep = new Set(['main_rotor_pivot', 'tail_rotor_pivot', 'pilot_seat']);
    this.batch = batchModel(model, { anchors: ['cyclic', 'collective', 'pedal_L', 'pedal_R', 'cockpit_door_L', 'cockpit_door_R', 'cabin_door_L', 'cabin_door_R'], keep: (o) => keep.has(o.name), farSkip: (o) => /blade/.test(o.name), skin: true });
    // (the blades of each rotor: one shadow, coned as at rest, turning with its hub; the blades themselves still fade,
    // cone and change layers one by one for the view)
    this.bladeShadows = PERF.batch ? [shadowProxy(n.main_rotor_pivot, this.mainBlades), shadowProxy(n.tail_rotor_pivot, this.tailBlades)] : null;
    this.ready = true;
    return this;
  }

  /** The harness straps: triangles of pilot_seat's fabric mesh standing proud of the backrest. */
  _findHarness() {
    const seat = this.nodes.pilot_seat;
    if (!seat) return null;
    const found = [];
    seat.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.name !== 'fabric_upholstery') return;
      const geo = o.geometry;
      if (!geo.index) return;
      const pos = geo.attributes.position;
      const idx = geo.index.array;
      // in the seat mesh's frame: the backrest stands aft; straps are thin bands in front of it, above
      // the cushion, and over the shoulders
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const keep = [];
      const drop = [];
      const a = new THREE.Vector3();
      for (let i = 0; i < idx.length; i += 3) {
        a.set(0, 0, 0);
        for (let j = 0; j < 3; j++) a.add(_v.fromBufferAttribute(pos, idx[i + j]));
        a.multiplyScalar(1 / 3);
        const up = (a.y - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
        const fwd = (bb.max.z - a.z) / Math.max(1e-6, bb.max.z - bb.min.z); // 0 at the back, 1 at the front
        (up > 0.25 && fwd > 0.3 ? drop : keep).push(idx[i], idx[i + 1], idx[i + 2]);
      }
      found.push({ mesh: o, full: geo.index, keep: new THREE.BufferAttribute(new Uint32Array(keep), 1), dropped: drop.length / 3, kept: keep.length / 3 });
    });
    return found.length ? found : null;
  }

  /** Hide (true) or show the harness webbing. */
  harnessHidden(on) {
    if (!this._harness) return;
    for (const h of this._harness) h.mesh.geometry.setIndex(on ? h.keep : h.full);
    this._harnessOff = on;
  }

  /** Parks it at (x, z) facing `heading` (rad, 0 = nose to -Z), cold. */
  place(x, z, heading = 0, running = 'cold') {
    const g = groundAt(x, z);
    this.obstacles.refresh(x, z);
    this.fm.reset({ position: [x, g, z], heading, running, controls: { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 } });
    for (let i = 0; i < 120; i++) this.fm.step(1 / 60);
    this.damaged = false;
    this.strikeAt = null;
    this.shut = null;
    this.assist.reset(this.fm.state);
    for (const name of Object.keys(this.bladeAxes || {})) this.nodes[name].quaternion.copy(this.rest[name].quat);
    this.sync();
  }

  get state() {
    return this.fm.state;
  }

  get speed() {
    return this.fm.state.groundSpeed || 0;
  }

  /** Steps the flight model (controls already set) and moves everything to match. */
  update(dt, camera) {
    if (!this.ready) return;
    const s = this.fm.state;
    // (V4) parked, cold, unpowered and settled, with nobody at the controls: no flight model (8 sub-steps with 26
    // ground contacts, about 1.2 ms a frame) and no re-placing of its nodes until something changes
    // ((V5) a knock from the car (contactBody) wakes it for 3 s, and the impulse is in fm.v, not yet in the state)
    if (this.bumped > 0) this.bumped -= dt;
    if (PERF.sleep && dt > 0 && !this.flown && !(this.bumped > 0) && this._resting()) {
      this._t += dt;
      const key = `${this.door},${this.doorL},${this.landingLight},${this.power}`;
      if (key !== this._sleepKey) {
        this._sleepKey = key;
        this.sync();
      }
      this.washStrength = 0;
      this._particles(dt);
      this.dustCloud.update();
      return;
    }
    this._sleepKey = null;
    if (dt > 0) {
      this.obstacles.refresh(s.position.x, s.position.z);
      if (this.damaged) {
        // the rotor stops in about two seconds against the struck object and the bent blades
        this.fm.Omega = Math.max(0, this.fm.Omega - 22 * dt);
      }
      this._shutStep(dt);
      this.fm.step(dt);
      if (!this.damaged && this.fm.state.flags.rotorStrike) this._strike(this.fm.state.strikeAt);
      if (this.damage) this.damage.update(dt); // (V7) bent skids after a hard landing, tail strikes
    }
    this._t += dt;
    this.sync();
    if (dt > 0) {
      this._wash(dt);
      this._particles(dt);
    }
    this.dustCloud.update();
  }

  /**
   * (V5) The normal shutdown, on the ground: throttle to ground idle (collective down: main.js), the cool-down at
   * idle (COOL s: a game's shortening of the real 2 minutes, labelled on the HUD), fuel off, the rotor running down
   * freely to 40 % and then the rotor brake to a stop; the battery goes off when it has stopped.
   */
  shutdown() {
    const s = this.fm.state;
    if (!s.contact.onGround || !s.engine.lit || this.shut) return false;
    this.fm.autoThrottle = false;
    this.fm.starter = false;
    this.fm.controls.throttle = 0.5;
    this.shut = { phase: 'cool-down', t: 0 };
    return true;
  }

  _shutStep(dt) {
    const S = this.shut;
    if (!S) return;
    S.t += dt;
    const nr = this.fm.state.rotor.percent;
    if (S.phase === 'cool-down' && S.t >= Heli.COOL) {
      this.fm.cutEngine();
      S.phase = 'run-down';
    } else if (S.phase === 'run-down' && nr < 40) {
      this.fm.controls.rotorBrake = 1;
      S.phase = 'rotor brake';
    } else if (S.phase === 'rotor brake' && nr < 0.3) {
      S.phase = 'stopped';
      this.power = false;
      this.shut = null;
      this.events = this.events || [];
      this.events.push('stopped');
    }
  }

  /** (V5) What the shutdown is doing, for the HUD ('' when none). */
  get shutLabel() {
    const S = this.shut;
    if (!S) return '';
    if (S.phase === 'cool-down') return `shutdown: cool-down at idle ${Math.ceil(Heli.COOL - S.t)} s (game: ${Heli.COOL} s; real about 2 min)`;
    return `shutdown: ${S.phase} (rotor ${Math.round(this.fm.state.rotor.percent)} %)`;
  }

  _strike(at) {
    this.damaged = true;
    this.fm.cutEngine();
    this.strikeAt = at ? new THREE.Vector3(at.x, at.y, at.z) : this.root.localToWorld(new THREE.Vector3(0, 3, -5.5));
    this.bend = [0.3, -0.12, 0.22, -0.2].map((b, i) => ({ droop: 0.08 + Math.abs(b) * 0.4, lag: b }));
    for (const s of this._sparks) {
      const u = s.userData;
      u.life = 0.4 + Math.random() * 0.6;
      s.position.copy(this.strikeAt);
      u.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 8);
      s.visible = true;
      s.scale.setScalar(0.12 + Math.random() * 0.1);
      s.material.opacity = 1;
    }
    this.events = this.events || [];
    this.events.push('strike');
  }

  /** Model to flight state: body, rotors, blur, coning, controls, door, lights. */
  sync() {
    const s = this.fm.state;
    const n = this.nodes;
    this.root.position.set(s.position.x, s.position.y, s.position.z);
    this.root.quaternion.set(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
    const r = s.rotor;
    // main rotor: rest * tilt(a1 fwd, b1 right) * spin
    const mp = n.main_rotor_pivot;
    _q.setFromAxisAngle(X, -r.discTiltForward).multiply(_q2.setFromAxisAngle(Z, -r.discTiltRight));
    mp.quaternion.copy(this.rest.main_rotor_pivot.quat).multiply(_q).multiply(_q2.setFromAxisAngle(Y, r.azimuth));
    // coning, relative to the modelled static droop (the model's coning at rest, -0.036 rad)
    const cone = r.coning + 0.036;
    let i = 0;
    for (const [name, axis] of Object.entries(this.bladeAxes)) {
      const b = n[name];
      const bend = this.damaged && this.bend ? this.bend[i] : null;
      _q.setFromAxisAngle(axis, bend ? bend.droop : -cone);
      if (bend) _q.premultiply(_q2.setFromAxisAngle(Y, bend.lag));
      b.quaternion.copy(_q).multiply(this.rest[name].quat);
      i++;
    }
    const tp = n.tail_rotor_pivot;
    tp.quaternion.copy(this.rest.tail_rotor_pivot.quat).multiply(_q.setFromAxisAngle(X, r.tailAzimuth));
    // blades to blur with rotor speed (blades fade 25 .. 75 % Nr to a faint 12 %; the disc fades in)
    const nr = r.percent / 100;
    const blur = THREE.MathUtils.smoothstep(nr, 0.18, 0.7) * (this.damaged ? 0.6 : 1);
    const bladeA = 1 - 0.8 * blur;
    // past 60 % of the blur the blades leave the camera's layer (the disc shows them) but stay on the sun's
    // shadow layer (SHADOW_LAYER), so their shadow sweeps the ground at the real azimuth; drawn faded and
    // moving 40 deg a frame, TRAA and the motion blur smeared them into dark shards in the cockpit view
    const hide = blur > 0.6;
    for (const list of [this.mainBlades, this.tailBlades]) {
      // ((V4) on SHADOW_LAYER too when seen, so the far cascades, which draw that layer only, keep their shadow)
      for (const o of list) {
        if (this.bladeShadows) o.layers.set(hide ? HIDDEN : 0); // ((V4) the shadow is the rotor's proxy, batch.js)
        else {
          o.layers.set(SHADOW_LAYER);
          if (!hide) o.layers.enable(0);
        }
      }
      const m = list.mat;
      const tr = bladeA < 0.999;
      if (m.transparent !== tr) {
        m.transparent = tr;
        m.needsUpdate = true;
      }
      m.opacity = bladeA;
      m.depthWrite = !tr;
    }
    for (const o of Object.values(this.blur)) {
      o.visible = blur > 0.01;
      // (V3) seen from the cockpit, under the disc, the main rotor is a faint shimmer, not a tinted sheet
      const faint = this.discFaint && o === this.blur.main_rotor_blur ? 0.18 : 1;
      o.material.opacity = Math.min(1, (o.userData.base || 1) * blur * 1.8) * faint;
    }
    // controls
    const c = s.controls;
    const cp = c.cyclicPitch;
    const fwd = (cp >= 0 ? cp * 9 : cp * 6) * D2R;
    const right = c.cyclicRoll * 6 * D2R;
    n.cyclic.quaternion.copy(this.rest.cyclic.quat).multiply(_q.setFromAxisAngle(X, -fwd)).multiply(_q2.setFromAxisAngle(Z, -right));
    n.collective.quaternion.copy(this.rest.collective.quat).multiply(_q.setFromAxisAngle(X, (4 + 16 * c.collective) * D2R));
    const fitOf = (name) => this.fit[name] || _v.set(0, 0, 0);
    for (const [name, sgn] of [['pedal_L', 1], ['pedal_R', -1]]) {
      n[name].position.copy(this.rest[name].pos).add(fitOf(name));
      n[name].position.z += sgn * 0.045 * c.pedal;
    }
    for (const name of ['pilot_seat', 'seat_pilot_point']) if (n[name]) n[name].position.copy(this.rest[name].pos).add(fitOf(name));
    n.cockpit_door_R.quaternion.copy(this.rest.cockpit_door_R.quat).multiply(_q.setFromAxisAngle(Y, 68 * D2R * this.door));
    if (n.cockpit_door_L) n.cockpit_door_L.quaternion.copy(this.rest.cockpit_door_L.quat).multiply(_q.setFromAxisAngle(Y, -68 * D2R * this.doorL));
    // lights
    const eng = s.engine;
    const powered = this.power || eng.lit || eng.starter;
    const M = this.mats;
    if (M.display_emissive) M.display_emissive.emissiveIntensity = (M.display_emissive.userData.base || 2) * (powered ? 1 : 0) * LIGHT.display; // ((V7) dimmed at night)
    if (M.light_nav_emissive) M.light_nav_emissive.emissiveIntensity = (M.light_nav_emissive.userData.base || 4) * (powered ? 1 : 0.02);
    if (M.light_landing_emissive) M.light_landing_emissive.emissiveIntensity = (M.light_landing_emissive.userData.base || 6) * (this.landingLight && powered ? 1.5 : 0.02);
    this.landing.intensity = this.landingLight && powered ? 320 : 0; // ((V8) was 900: its spot on the ground 15 m below was about the midday sun's light, a blown-out disc at the night exposure)
    // anti-collision: a red double flash once a second; white strobes once every 1.3 s
    const t = this._t;
    const ph = t % 1;
    const flash = powered && (ph < 0.06 || (ph > 0.16 && ph < 0.22)) ? 1 : 0;
    this.beaconMat.color.setRGB(flash ? 6 : 0.05, flash ? 0.25 : 0, flash ? 0.15 : 0);
    this.beaconLight.intensity = flash * 10;
    const ps = (t + 0.5) % 1.3;
    const strobe = powered && ps < 0.05 ? 1 : 0;
    this.strobeMat.color.setRGB(strobe ? 9 : 0.04, strobe ? 9 : 0.04, strobe ? 9 : 0.04);
    this.root.updateMatrixWorld(true);
  }

  /** The rotor wash: dust thrown out in a ring under the disc while in ground effect. */
  _wash(dt) {
    const s = this.fm.state;
    const r = s.rotor;
    const hub = this.root.localToWorld(_v.set(0, 3.02, 0));
    const g = groundAt(hub.x, hub.z);
    const h = hub.y - g;
    const D = 11;
    const tw = Math.max(0, r.thrust) / (s.mass * 9.81);
    const height = 1 - THREE.MathUtils.smoothstep(h, 0.25 * D, 1.0 * D);
    const strength = THREE.MathUtils.clamp(tw * 1.1, 0, 1.3) * height * (r.percent > 30 ? 1 : 0);
    this.washStrength = strength;
    const kind = surfaceKind(hub.x, hub.z);
    const dirt = kind === 'dirt';
    // (V4) rebuilt after looking at it: 139 sprites at 2 m over dirt left nothing visible (dust the colour of the
    // dirt, unlit, half transparent at most, thrown at 4 m/s). Now the wake's own speed decides it: the induced
    // velocity (about 9.6 m/s in this hover) turns into a wall jet along the ground, fastest under the disc's edge
    // and slowing as it spreads (about 1 / r); the dust is lifted where it runs out from under the disc, lit by the
    // sun and the sky (a bright cloud against the dirt), rolls up at the jet's edge and drifts; paved ground gives
    // a thin grey haze. Strength as before: thrust over weight, fading out as the hub rises from a quarter of the
    // rotor's diameter to one diameter above the ground (the wake no longer reaches it as a jet).
    const vi = Math.max(r.inducedVelocity || 0, 0);
    const R = D / 2;
    // ((V8) over grass the wash lays the blades flat (flora.js) and lifts far less dust than over bare dirt: the
    // rate and the cloud's density by the grass cover, the same patches as the blades')
    const cover = dirt && PERF.flora ? 1 - 0.85 * bareAt(hub.x, hub.z) : 0;
    const rate = strength * (dirt ? 260 * (1 - 0.7 * cover) : 90);
    this._washEmit = (this._washEmit || 0) + rate * dt;
    // (the wake lands downwind of the hub as the aircraft moves: its foot trails the motion)
    const lag = Math.min(1, h / 8) * 0.6;
    const fx = hub.x - s.velocity.x * lag;
    const fz = hub.z - s.velocity.z * lag;
    while (this._washEmit >= 1) {
      this._washEmit -= 1;
      const p = this._dust[this._dustNext++ % this._dust.length];
      const u = p.userData;
      const a = Math.random() * Math.PI * 2;
      const rad = R * (0.6 + Math.random() * 0.7) + h * 0.15;
      u.life = u.max = 1.8 + Math.random() * 1.8;
      p.position.set(fx + Math.cos(a) * rad, g + 0.15 + Math.random() * 0.25, fz + Math.sin(a) * rad);
      // wall jet: about the induced velocity at the disc's edge, falling as 1 / r beyond it
      const out = vi * (0.9 + Math.random() * 0.5) * Math.min(1.2, R / Math.max(rad, 1)) * (0.55 + 0.45 * Math.min(1, strength));
      u.vel.set(Math.cos(a) * out + s.velocity.x * 0.2, 0.3 + Math.random() * 0.9, Math.sin(a) * out + s.velocity.z * 0.2);
      u.cx = fx;
      u.cz = fz;
      u.grow = 3.2;
      u.size = (dirt ? 1.1 : 0.9) + strength * 0.9;
      u.alpha = (dirt ? 0.55 * (1 - 0.5 * cover) : 0.2) * Math.min(1, strength * 1.2);
      u.ground = g;
      u.wash = true;
      // (unlit sprites: the colour is what the sun and the sky give the cloud, as the car's dust and smoke, V3)
      const L = LIGHT.sprite; // ((V7) the time of day's light)
      if (dirt) p.material.color.setRGB(1.5 * L, 1.2 * L, 0.86 * L);
      else p.material.color.setRGB(1.35 * L, 1.3 * L, 1.22 * L);
      p.visible = true;
    }
  }

  _particles(dt) {
    for (const p of this._dust) {
      const u = p.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) {
        p.visible = false;
        continue;
      }
      const age = 1 - u.life / u.max;
      p.position.addScaledVector(u.vel, dt);
      // ((V4) the jet slows as it spreads; where it has slowed the dust rolls up and hangs, drifting)
      // ((V7) toward the wind, not to rest: the dust drifts downwind as it slows)
      const kd = 1 - Math.exp(-0.9 * dt);
      u.vel.x += (WEATHER.now.x - u.vel.x) * kd;
      u.vel.z += (WEATHER.now.z - u.vel.z) * kd;
      const flat = Math.hypot(u.vel.x - WEATHER.now.x, u.vel.z - WEATHER.now.z);
      u.vel.y += ((flat < 3 ? 0.6 : 0.15) - u.vel.y) * (1 - Math.exp(-1.5 * dt));
      const size = u.size * (1 + age * u.grow);
      p.scale.set(size, size, size);
      if (u.ground !== undefined) p.position.y = Math.max(p.position.y, u.ground + size * 0.3);
      p.material.opacity = u.alpha * Math.min(1, age * 6) * (1 - age) * (1 - age * 0.3);
    }
    for (const p of this._sparks) {
      const u = p.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) {
        p.visible = false;
        continue;
      }
      u.vel.y -= 9.81 * dt;
      p.position.addScaledVector(u.vel, dt);
      p.material.opacity = Math.min(1, u.life * 3);
    }
  }

  /** Cold, dark and still on the ground. */
  _resting() {
    const s = this.fm.state;
    const e = s.engine;
    if (this.power || this.damaged || e.lit || e.starter || e.ng > 0.5 || s.rotor.percent > 0.05) return false;
    const c = s.controls;
    if (c.collective > 0.001 || Math.abs(c.cyclicPitch) > 0.001 || Math.abs(c.cyclicRoll) > 0.001 || Math.abs(c.pedal) > 0.001) return false;
    const v = s.velocity;
    const w = s.angularVelocity;
    return Math.hypot(v.x, v.y, v.z) < 0.001 && Math.hypot(w.x, w.y, w.z) < 0.001;
  }

  /**
   * (V5) The hull as a moving box for the car's contacts (dynamics.js _collide, ground.bodies): the cabin with the
   * skids, x +-1.2, z -3.0 .. +1.6 (the nose to the skids' heels), 0 .. 2.8 m up, turning with the heading; the
   * tail boom passes over the car's roof and is left out. Impulses go into the flight model's rigid body (velocity
   * and body rates through its inertia); the skids' friction then holds or lets it slide.
   */
  contactBody() {
    if (!this.ready) return null;
    const fm = this.fm;
    const B = (this._body = this._body || {
      hx: 1.2, hz: 2.3, bottom: 0, top: 2.8, cg: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, omega: { x: 0, y: 0, z: 0 },
      invI: (out, a) => {
        // world a -> body, / I, -> world
        const m = this._qm();
        const bx = m[0] * a.x + m[3] * a.y + m[6] * a.z;
        const by = m[1] * a.x + m[4] * a.y + m[7] * a.z;
        const bz = m[2] * a.x + m[5] * a.y + m[8] * a.z;
        const I = this.fm.I;
        const ux = bx / I[0];
        const uy = by / I[1];
        const uz = bz / I[2];
        out.x = m[0] * ux + m[1] * uy + m[2] * uz;
        out.y = m[3] * ux + m[4] * uy + m[5] * uz;
        out.z = m[6] * ux + m[7] * uy + m[8] * uz;
        return out;
      },
      apply: (J, p) => {
        const f = this.fm;
        f.v[0] += J.x / f.mass;
        f.v[1] += J.y / f.mass;
        f.v[2] += J.z / f.mass;
        const rx = p.x - f.x[0];
        const ry = p.y - f.x[1];
        const rz = p.z - f.x[2];
        const tx = ry * J.z - rz * J.y;
        const ty = rz * J.x - rx * J.z;
        const tz = rx * J.y - ry * J.x;
        const m = this._qm();
        f.w[0] += (m[0] * tx + m[3] * ty + m[6] * tz) / f.I[0];
        f.w[1] += (m[1] * tx + m[4] * ty + m[7] * tz) / f.I[1];
        f.w[2] += (m[2] * tx + m[5] * ty + m[8] * tz) / f.I[2];
        this.bumped = 3;
        this._syncBody();
      },
      push: (dx, dz) => {
        this.fm.x[0] += dx;
        this.fm.x[2] += dz;
      },
      energy: () => {
        const f = this.fm;
        return 0.5 * f.mass * (f.v[0] ** 2 + f.v[1] ** 2 + f.v[2] ** 2) + 0.5 * (f.I[0] * f.w[0] ** 2 + f.I[1] * f.w[1] ** 2 + f.I[2] * f.w[2] ** 2);
      },
    });
    B.mass = fm.mass;
    const s = fm.state.position;
    const m = this._qm();
    // the hull's right (+X) on the ground: the box's local x axis; its local z is then the aft direction
    const rl = Math.hypot(m[0], m[6]) || 1;
    B.c = m[0] / rl;
    B.s = m[6] / rl;
    B.x = s.x + -B.s * -0.7;
    B.z = s.z + B.c * -0.7;
    B.bottom = s.y;
    B.top = s.y + 2.8;
    this._syncBody();
    return B;
  }

  _syncBody() {
    const f = this.fm;
    const B = this._body;
    B.cg.x = f.x[0];
    B.cg.y = f.x[1];
    B.cg.z = f.x[2];
    B.vel.x = f.v[0];
    B.vel.y = f.v[1];
    B.vel.z = f.v[2];
    const m = this._qm();
    B.omega.x = m[0] * f.w[0] + m[1] * f.w[1] + m[2] * f.w[2];
    B.omega.y = m[3] * f.w[0] + m[4] * f.w[1] + m[5] * f.w[2];
    B.omega.z = m[6] * f.w[0] + m[7] * f.w[1] + m[8] * f.w[2];
  }

  /** The flight model's attitude as a row-major body -> world matrix. */
  _qm() {
    const [w, x, y, z] = this.fm.q;
    const m = (this._m9 = this._m9 || new Array(9));
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
    m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
    m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
    return m;
  }

  /** A node's world position. */
  pointOf(name, out) {
    return this.nodes[name].getWorldPosition(out);
  }
}

/** Chase (a spring that follows the heading and looks where it is going) and cockpit cameras. */
export class HeliCameras {
  constructor() {
    this.mode = 0;
    this.names = ['Chase', 'Cockpit'];
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.head = new THREE.Vector3();
    this.headV = new THREE.Vector3();
    this.fov = 55;
    this.started = false;
    this._t = 0;
    this.eye = null;
    this.eyeForward = 0.1;
    // (V3) the cockpit view's framing: pitch below the nose (rad), vertical field of view (deg) and how far the
    // lens sits behind / above the eye in the aircraft's frame (m); `inside` is read by Heli.sync to fade the
    // rotor disc to a faint blur when seen from under it
    // (V2 was -0.09 rad, 66 deg, at the eye: the glare shield filled the bottom third, the instruments and the
    // hands were below the frame; now the horizon sits a fifth down, the panel is read in the middle and the knees
    // and the cyclic hand are at the bottom, as a pilot's own field takes them in)
    this.pitch0 = -0.47; // ((V4) -0.53 tried: the centred stick's hand stays under the knees and the frame's edge; it
    // shows from about -0.62, which puts the horizon at the top tenth: kept)
    this.fovCockpit = 88;
    this.eyeOffset = new THREE.Vector3(0, 0.06, 0.1);
    // (V7) leaning in to read the panel, as a pilot does: Shift held eases the head 14 cm toward the displays and the
    // field of view down to 34 deg (a pilot's eye resolves the PFD's figures from his seat; the game's 88-degree view
    // put them at 4 to 5 px), the view on the PFD; it eases back on release (0.35 s each way)
    this.leanHeld = false;
    this.lean = 0;
    this.leanFov = 30; // ((V8) 34 -> 30, pitch -0.62 -> -0.5, forward 0.14 -> 0.2 m, and the head drops 0.2 m: the whole PFD in view)
    this.leanPitch = -0.5;
    this.leanYaw = -0.05;
    this.leanForward = 0.2;
    this.leanDown = 0.2; // (V8) m the head drops as it leans (the PFD under the glare shield)
  }

  cycle() {
    this.mode = (this.mode + 1) % this.names.length;
    this.lookYaw = this.lookPitch = 0;
    return this.names[this.mode];
  }

  look(dx, dy, dt) {
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.003, -2.8, 2.8);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.003, -1.0, 0.7);
    if (dx === 0 && dy === 0) {
      this._idle = (this._idle || 0) + dt;
      if (this._idle > 2) {
        this.lookYaw += (0 - this.lookYaw) * Math.min(1, dt * 2);
        this.lookPitch += (0 - this.lookPitch) * Math.min(1, dt * 2);
      }
    } else this._idle = 0;
  }

  place(dt, camera, heli) {
    const s = heli.state;
    heli.discFaint = this.mode === 1; // (V3) the disc from under it: a faint blur
    this._t += dt;
    const root = heli.root;
    const vel = _v2.set(s.velocity.x, s.velocity.y, s.velocity.z);
    const speed = Math.hypot(vel.x, vel.z);
    let fov;
    if (this.mode === 0) {
      // heading from the nose; with speed the camera swings toward the flight path (looks where it goes)
      const f = _v.set(0, 0, -1).applyQuaternion(root.quaternion);
      const noseYaw = Math.atan2(-f.x, -f.z);
      const pathYaw = Math.atan2(-vel.x, -vel.z);
      const w = THREE.MathUtils.smoothstep(speed, 4, 20);
      let want = noseYaw + wrapPi(pathYaw - noseYaw) * w * 0.7;
      if (!this.started) this.yaw = want;
      this.yaw += wrapPi(want - this.yaw) * Math.min(1, dt * 2.2);
      const yaw = this.yaw + this.lookYaw;
      const back = 15 + Math.min(6, speed * 0.08);
      const up = 4.2 + this.lookPitch * -8 - THREE.MathUtils.clamp(s.verticalSpeed * 0.15, -2, 2);
      const target = root.localToWorld(_v.set(0, 1.75, 0.6)); // camera_chase_target
      const wantPos = new THREE.Vector3(Math.sin(yaw) * back, up, Math.cos(yaw) * back).add(target);
      if (!this.started || dt <= 0) {
        this.pos.copy(wantPos);
        this.vel.copy(vel);
        this.started = true;
      }
      const k = 18;
      const c = 2 * Math.sqrt(k) * 0.9;
      this.vel.x += ((wantPos.x - this.pos.x) * k - (this.vel.x - vel.x) * c) * dt;
      this.vel.y += ((wantPos.y - this.pos.y) * k - (this.vel.y - vel.y) * c) * dt;
      this.vel.z += ((wantPos.z - this.pos.z) * k - (this.vel.z - vel.z) * c) * dt;
      this.pos.addScaledVector(this.vel, dt);
      camera.position.copy(this.pos);
      const g = groundAt(this.pos.x, this.pos.z);
      camera.position.y = Math.max(camera.position.y, g + 0.6);
      // look a little ahead of the aircraft along its path
      const ahead = target.clone().addScaledVector(vel, 0.35);
      camera.lookAt(ahead.x, ahead.y + 0.6, ahead.z);
      fov = 55 + Math.min(8, speed * 0.1);
    } else {
      // cockpit: the pilot's eye (character.eye when seated), the head moving under the accelerations
      const a = s.velocityBody;
      const acc = this._lastV ? _v.set((s.velocity.x - this._lastV.x) / Math.max(dt, 1e-3), (s.velocity.y - this._lastV.y) / Math.max(dt, 1e-3), (s.velocity.z - this._lastV.z) / Math.max(dt, 1e-3)) : _v.set(0, 0, 0);
      this._lastV = { ...s.velocity };
      const accB = acc.applyQuaternion(_q.copy(root.quaternion).invert());
      const want = new THREE.Vector3(-accB.x * 0.004, -accB.y * 0.003, -accB.z * 0.004).clampLength(0, 0.04);
      const k = 90;
      this.headV.addScaledVector(_v.subVectors(want, this.head).multiplyScalar(k).addScaledVector(this.headV, -2 * Math.sqrt(k) * 0.7), dt);
      this.head.addScaledVector(this.headV, dt);
      if (dt <= 0) this.head.copy(want);
      // a small rotor vibration (4/rev at 26 Hz is too fast to see: a faint 1/rev wobble)
      const vib = (s.rotor.percent / 100) * 0.0006;
      const shake = new THREE.Vector3(Math.sin(this._t * 41) * vib, Math.sin(this._t * 26 * Math.PI * 2 * 0.25) * vib, 0);
      // (the lens 10 cm behind the leaning pilot's eye brings the cyclic hand into the bottom of the view; looking
      // down with the mouse it comes forward to the eye again, or the lens would be behind the pilot's own head)
      const back = THREE.MathUtils.clamp(1 - (-this.lookPitch - 0.05) / 0.3, 0, 1);
      _v2.copy(this.eyeOffset);
      _v2.z *= back;
      if (this.eye) camera.position.copy(this.eye).add(_v.copy(this.head).add(shake).add(_v2).applyQuaternion(root.quaternion));
      else camera.position.copy(root.localToWorld(_v.set(0.42, 1.93, -1.06).add(this.head)));
      camera.quaternion.copy(root.getWorldQuaternion(_q));
      // (V3) looking aside with the mouse the default look-down eases off (the pilot looks out of the door, not
      // down at his own shoulder), and the eye moves with the head's turn a few cm toward that side
      const aside = Math.min(1, Math.abs(this.lookYaw) / 1.2);
      camera.position.add(_v.set(-Math.sin(this.lookYaw) * 0.05, 0, -Math.abs(Math.sin(this.lookYaw)) * 0.03).applyQuaternion(root.quaternion));
      // (V7) the lean: eased toward the held key (smoothstep of a 0.35 s ramp)
      this.lean = THREE.MathUtils.clamp(this.lean + (this.leanHeld ? 1 : -1) * (dt / 0.35), 0, 1);
      const ln = this.lean * this.lean * (3 - 2 * this.lean);
      const pitchNow = THREE.MathUtils.lerp(this.lookPitch + this.pitch0 * (1 - 0.75 * aside), this.leanPitch, ln);
      const yawNow = THREE.MathUtils.lerp(this.lookYaw, this.leanYaw + this.lookYaw * 0.6, ln); // (the mouse still turns the head: the engine page, the standby dials)
      camera.quaternion.multiply(_q2.setFromEuler(new THREE.Euler(pitchNow, yawNow, 0, 'YXZ')));
      if (ln > 0) camera.position.add(_v.set(0, 0, -this.leanForward * ln).applyQuaternion(camera.quaternion));
      // ((V8) and the head drops: from above, the glare shield's lip hid the top of the PFD's tapes in every lean tried
      // (V7's -0.62 rad / 14 cm: the top 15 % of the screen); lowered, the eye looks in under the lip)
      if (ln > 0) camera.position.add(_v.set(0, -this.leanDown * ln, 0).applyQuaternion(root.quaternion));
      // (the seated pilot leans 22 deg forward and to the collective: from the eye itself the near
      // planes cut his own shoulders and the inside of the hidden head; the lens sits eyeForward ahead)
      camera.position.add(_v.set(0, 0, -this.eyeForward).applyQuaternion(camera.quaternion));
      fov = THREE.MathUtils.lerp(this.fovCockpit, this.leanFov, ln);
      this.started = true;
      void a;
      if (dt <= 0 || ln > 0) this.fov = fov; // (the lean sets the field itself: its own easing)
    }
    this.fov += (fov - this.fov) * Math.min(1, (dt || 1) * 4);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export { HELI };
