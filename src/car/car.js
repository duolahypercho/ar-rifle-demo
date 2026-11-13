// The supercar in the scene (pass V1): the model (public/vehicles/supercar.glb, the asset with its
// textures scaled down: blender/vehicles/shrink_textures.py), driven every frame from the dynamics
// (dynamics.js): the body placed by the rigid body (so pitch and roll are the suspension's, not a
// cosmetic tilt), each suspension node at its spring's travel, wheels spun by their own speed and
// steered at their own (Ackermann) angle, the steering wheel at the rack's ratio, the doors on their
// canted hinges; lights, tyre smoke, skid marks and dust from what the tyres are doing.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CarDynamics, SPEC, SURFACES } from './dynamics.js';
import { groundAt } from '../ground.js';
import { surfaceKind, CAR_OBSTACLES } from '../track.js';
import { batchModel } from '../batch.js';
import { PERF } from '../perf.js';
import { SpriteCloud } from '../cloud.js';
import { WEATHER } from '../terrain.js';
import { LIGHT } from '../look.js';

const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const DOOR_OPEN = THREE.MathUtils.degToRad(55);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** The world as the dynamics sees it: groundAt (ramps, kerbs) and the surface under each tyre. */
export const WORLD_GROUND = {
  height(x, z, n) {
    const y = groundAt(x, z, n ? _n : undefined);
    if (n) {
      n.x = _n.x;
      n.y = _n.y;
      n.z = _n.z;
    }
    return y;
  },
  surface(x, z) {
    const kind = surfaceKind(x, z);
    return kind === 'kerb' ? SURFACES.kerb : kind === 'dirt' ? SURFACES.dirt : SURFACES.tarmac;
  },
  obstacles: CAR_OBSTACLES,
};

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

export class Car {
  constructor(scene) {
    this.scene = scene;
    this.dyn = new CarDynamics(SPEC, WORLD_GROUND);
    this.root = new THREE.Group(); // vehicle_root's place in the world
    this.root.name = 'car';
    scene.add(this.root);
    this.nodes = {};
    this.ready = false;
    this.doorL = 0; // 0 shut .. 1 open (55 degrees)
    this.doorR = 0;
    this.headlights = false;
    this.paint = 'yellow';
    this.indicator = 0; // -1 left, 1 right, 0 off
    this._t = 0;
    this._smoke = [];
    this._skidLast = WHEELS.map(() => null);
    this._lightLevel = { brake: 0, reverse: 0 };
    this._sparks = [];
    this.events = []; // (V5) { kind: 'crunch', dv } for the sound; main.js empties it
    this.shake = 0; // (V5) camera shake from hits, 0..1
    this.scrapeKw = 0;
    this.thrown = new BodyThrow();
    this.ignitionOn = false; // (V5) the dash lit; the engine is started by startSequence()
    this._startT = -1;
    this.indicatorFrom = 0; // (V5) the wheel's angle when the indicator was set (it cancels as the wheel comes back)
  }

  /**
   * (V5) Ignition on: the dash's lamp check (main.js: dash.lampCheck) for 0.9 s, then the starter (dyn.startEngine):
   * it cranks 0.7 s, fires, flares to about 1500 rpm and settles to idle. Done once seated (main.js), or with I.
   */
  startSequence() {
    if (this.dyn.ignition !== 'off') return false;
    this.ignitionOn = true;
    this._startT = 0;
    this.events.push({ kind: 'ignition' });
    return true;
  }

  /** (V5) Ignition off: the engine stops, the dash goes dark. */
  switchOff() {
    this._startT = -1;
    this.ignitionOn = false;
    this.indicator = 0;
    if (this.dyn.stopEngine()) this.events.push({ kind: 'stop' });
  }

  async load(url, specsUrl) {
    const [gltf, specs] = await Promise.all([new GLTFLoader().loadAsync(url), fetch(specsUrl).then((r) => r.json())]);
    this.specs = specs;
    const model = gltf.scene.getObjectByName('vehicle_root') || gltf.scene;
    this.model = model;
    this.root.add(model);
    model.traverse((o) => {
      if (o.name) this.nodes[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // (the glass blends: it does not cast)
        if (o.material && o.material.transparent) o.castShadow = false;
      }
    });
    const n = this.nodes;
    // rest values to drive from
    this.rest = {};
    for (const name of ['door_L', 'door_R', 'steering_wheel', ...WHEELS.map((w) => 'suspension_' + w)]) {
      this.rest[name] = { pos: n[name].position.clone(), quat: n[name].quaternion.clone() };
    }
    // materials by name (shared by their meshes)
    this.mats = {};
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.mats[m.name] = m;
    });
    // lights: each light material its own copy per group so brake, tail and reverse work apart
    const own = (meshNames, base) => {
      const m = this.mats[base].clone();
      for (const name of meshNames) if (n[name]) n[name].material = m;
      return m;
    };
    this.lightMats = {
      head: own(['headlight_L', 'headlight_R'], 'light_headlight'),
      brake: own(['brake_light_C', 'brake_light_L', 'brake_light_R'], 'light_brake'),
      tail: own(['rear_light_L', 'rear_light_R'], 'light_tail'),
      indL: own(['indicator_FL', 'indicator_RL'], 'light_indicator'),
      indR: own(['indicator_FR', 'indicator_RR'], 'light_indicator'),
    };
    for (const m of Object.values(this.lightMats)) m.userData.base = m.emissiveIntensity;
    // reverse lamps: two small white lenses under the tail lights (the model has none)
    this.reverseMat = new THREE.MeshStandardNodeMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
    const box = new THREE.Box3();
    this.reverseLamps = [];
    for (const side of ['L', 'R']) {
      const tail = n['rear_light_' + side];
      if (!tail) continue;
      box.setFromObject(tail);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.01), this.reverseMat);
      model.worldToLocal(_v.set((box.min.x + box.max.x) / 2, box.min.y - 0.05, box.max.z + 0.005));
      lamp.position.copy(_v);
      model.add(lamp);
      this.reverseLamps.push(lamp);
    }
    // headlamp beams (no shadows: cheap)
    this.beams = [];
    for (const side of ['L', 'R']) {
      const head = n['headlight_' + side];
      if (!head) continue;
      box.setFromObject(head);
      const spot = new THREE.SpotLight(0xfff2e0, 0, 90, THREE.MathUtils.degToRad(24), 0.45, 1.6);
      model.worldToLocal(_v.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z));
      spot.position.copy(_v);
      spot.target.position.copy(_v).add(_v2.set(0, -0.6, -12));
      model.add(spot, spot.target);
      this.beams.push(spot);
    }
    this.setPaint(this.paint);
    // (V2) the wheels' blurred state: a disc over each wheel's outer face, painted as the spokes look
    // when they turn too fast to see (concentric streaks of the rim's metal over the dark barrel), its
    // opacity rising with the wheel's own spin (15 to 70 rad/s: 20 to 90 km/h)
    this.wheelBlur = this._wheelBlur();
    // tyre smoke and dust: a pool of sprites
    const tex = softDot();
    // ((V4) one draw for all of them, cloud.js: a slide put a hundred sprites, a hundred draws, in the frame)
    this.smokeCloud = new SpriteCloud(this.scene, 240, tex);
    for (let i = 0; i < 240; i++) this._smoke.push(this.smokeCloud.add({ life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 }));
    this._smokeNext = 0;
    // (V5) sparks from scrapes and hits: one draw (cloud.js), bright enough to bloom
    this.sparkCloud = new SpriteCloud(this.scene, 120, tex, { renderOrder: 2 });
    for (let i = 0; i < 120; i++) this._sparks.push(this.sparkCloud.add({ life: 0, max: 1, vel: new THREE.Vector3() }));
    this._sparkNext = 0;
    // skid marks: one ring buffer of quads, darkened where the tyres slid
    const SEG = 3000;
    this._skid = { max: SEG, n: 0, pos: new Float32Array(SEG * 4 * 3), alpha: new Float32Array(SEG * 4), idx: [] };
    for (let i = 0; i < SEG; i++) this._skid.idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
    const geo = new THREE.BufferGeometry();
    // ((V9) static usage: uploaded when a mark is laid (needsUpdate); as dynamic buffers three's WebGPU renderer uploaded
    // all 192 kB every frame)
    geo.setAttribute('position', new THREE.BufferAttribute(this._skid.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this._skid.alpha, 1));
    geo.setIndex(this._skid.idx);
    const { attribute, vec3: tv3, float } = await import('three/tsl');
    const skidMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    skidMat.colorNode = tv3(0.03, 0.03, 0.035);
    skidMat.opacityNode = attribute('alpha', 'float').mul(float(0.75));
    this.skidMesh = new THREE.Mesh(geo, skidMat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
    this.scene.add(this.skidMesh);
    // (V4) the parts that move together merged per material, their shadows one proxy per moving node (batch.js):
    // 106 meshes in 6 passes were about 600 of the frame's draw calls
    this.batch = batchModel(model, { anchors: ['door_L', 'door_R', 'seat_driver', 'steering_wheel', ...WHEELS.flatMap((w) => ['suspension_' + w, 'steering_' + w, 'wheel_' + w])], skin: true });
    this.ready = true;
    this.sync();
    return this;
  }

  _wheelBlur() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const r = Math.hypot(x - 127.5, y - 127.5) / 127.5;
      const i = (y * 256 + x) * 4;
      let v = 0;
      let a = 0;
      if (r < 1) {
        // spokes smeared into a disc: bright alloy between r 0.25 and 0.92, a dark hub, fine rings
        const spokes = r > 0.22 && r < 0.93 ? 0.55 + 0.12 * Math.sin(r * 90) * Math.sin(r * 23) : 0.18;
        const lip = r > 0.93 ? 0.7 : 0;
        v = Math.max(spokes, lip);
        a = r < 0.22 ? 0.95 : r > 0.93 ? 0.9 : 0.62 + 0.1 * Math.sin(r * 60);
      }
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const out = [];
    const box = new THREE.Box3();
    for (const id of WHEELS) {
      const wheel = this.nodes['wheel_' + id];
      const tire = this.nodes['tire_' + id];
      if (!wheel || !tire) continue;
      if (tire.geometry) {
        tire.geometry.computeBoundingBox();
        box.copy(tire.geometry.boundingBox);
      } else box.set(new THREE.Vector3(-0.13, -0.345, -0.345), new THREE.Vector3(0.13, id.startsWith('F') ? 0.345 : 0.36, 0.345));
      const R = box.max.y * 0.74; // the rim's lip (tyre 0.345 / 0.36 m)
      const side = id.endsWith('L') ? -1 : 1;
      const mat = new THREE.MeshStandardNodeMaterial({ map: tex, transparent: true, depthWrite: false, metalness: 0.75, roughness: 0.38, color: 0xb8bcc2, opacity: 0 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), mat);
      disc.rotation.y = side * Math.PI / 2;
      disc.position.x = side * (box.max.x * 0.72);
      disc.renderOrder = 1;
      disc.castShadow = false;
      wheel.add(disc);
      out.push({ disc, mat, i: WHEELS.indexOf(id) });
    }
    return out;
  }

  /** Paint from the spec's presets (yellow, red, blue, white, black, silver, green). */
  setPaint(name) {
    const preset = this.specs && this.specs.paint_presets[name];
    if (!preset || !this.mats.body_paint) return;
    this.paint = name;
    const [r, g, b] = preset.base_color_linear;
    this.mats.body_paint.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  }

  nextPaint() {
    const names = Object.keys(this.specs.paint_presets);
    this.setPaint(names[(names.indexOf(this.paint) + 1) % names.length]);
    return this.paint;
  }

  /** Puts the car at rest at (x, z) facing `yaw`. */
  place(x, z, yaw) {
    this.dyn.reset(x, z, yaw);
    // (V5) parked with the engine off
    this.dyn.stopEngine();
    this.dyn.engine.omega = 0;
    // let it settle onto its springs
    for (let i = 0; i < 60; i++) this.dyn.update(1 / 60);
    this.clearMarks();
    this.sync();
  }

  /** A world point in the car's frame (vehicle_root). */
  toLocal(p, out) {
    return this.root.worldToLocal(out.copy(p));
  }

  /** Velocity of the body at a world point. */
  velocityAt(p) {
    const d = this.dyn;
    _v2.set(p.x - d.pos.x, p.y - d.pos.y, p.z - d.pos.z);
    return new THREE.Vector3(d.omega.x, d.omega.y, d.omega.z).cross(_v2).add(_v.set(d.vel.x, d.vel.y, d.vel.z));
  }

  /** A node's world position (seat, entry, cameras). */
  pointOf(name, out) {
    return this.nodes[name].getWorldPosition(out);
  }

  /** Steps the physics and moves everything to match. `dt` 0 (frozen) just redraws. */
  update(dt, camera) {
    if (!this.ready) return;
    // (V4) a parked car nobody is driving sleeps once it has settled: no physics (20 sub-steps a frame, 0.5 to 2 ms)
    // and no re-placing of its 150 nodes until it is driven or a door, a light or the paint changes
    const asleep = PERF.sleep && dt > 0 && !this.driven && this._resting();
    if (asleep) {
      this._t += dt;
      const key = `${this.doorL},${this.doorR},${this.headlights},${this.indicator},${this.paint}`;
      if (key !== this._sleepKey) {
        this._sleepKey = key;
        this.sync();
      }
      this._particles(dt, camera);
      this.smokeCloud.update();
      return;
    }
    this._sleepKey = null;
    if (this._startT >= 0 && dt > 0) {
      this._startT += dt;
      if (this._startT >= 0.9) {
        this._startT = -1;
        if (this.dyn.startEngine()) this.events.push({ kind: 'crank' });
      }
    }
    const was = this.dyn.ignition;
    if (dt > 0) this.dyn.update(dt);
    if (was === 'cranking' && this.dyn.ignition === 'running') this.events.push({ kind: 'fire' });
    this._t += dt;
    this.sync();
    if (dt > 0) {
      this._tyres(dt);
      this._hits(dt);
    }
    this._particles(dt, camera);
    this.smokeCloud.update();
    this.sparkCloud.update();
  }

  /**
   * (V5) What the contacts did this frame (dyn.impacts): the speed change of the hardest impulse (m/s), the scrape's
   * friction power (kW), sparks from the contact points (their number and speed from the impulse, a stream while it
   * scrapes), crunch events for the sound, the camera shake and the driver's thrown body (car.thrown: torso and
   * head as two damped springs on the car's acceleration, stopped by the belt and the seat).
   */
  _hits(dt) {
    const d = this.dyn;
    let dv = 0;
    let scrape = 0;
    let at = null;
    for (const im of d.impacts) {
      const v = Math.hypot(im.j, im.jt) / d.massBody;
      if (v > dv) {
        dv = v;
        at = im;
      }
      scrape += (im.jt * Math.abs(im.vt)) / 1000 / dt; // kW over the frame
      if (this.damage) this.damage.impact(im, 0); // (V7) the scrape of each contact (damage.js)
      // sparks: from the hit's speed change, a few from each scraping step
      const n = Math.min(24, Math.floor(v * 2.5 + (im.jt * Math.abs(im.vt) > 50 ? 0.4 + Math.random() : 0)));
      for (let k = 0; k < n; k++) this._spark(im, v);
    }
    this.scrapeKw = d.scrapeKw = scrape;
    this.lastHitDv = dv;
    // (V7) the frame's hit as one: its contacts' impulses summed (a glancing blow is many small impulses over the
    // sub-steps), at the hardest one's point: the dent, the glass, the lamps, the mirrors, the steering (damage.js)
    if (this.damage && at) {
      let jn = 0;
      let jt = 0;
      for (const im of d.impacts) {
        jn += im.j;
        jt += im.jt;
      }
      this.damage.impact(at, Math.hypot(jn, jt) / d.massBody, { scrape: false });
    }
    if (dv > 0.4) {
      this.events.push({ kind: 'crunch', dv, j: at.j, at: { x: at.x, y: at.y, z: at.z } });
      this.shake = Math.min(1, this.shake + dv * 0.06);
    }
    this.shake *= Math.exp(-5 * dt);
    if (this.shake < 1e-4) this.shake = 0;
    this.thrown.update(dt, d.accBody);
  }

  _spark(im, dv) {
    const s = this._sparks[this._sparkNext++ % this._sparks.length];
    const u = s.userData;
    u.life = u.max = 0.25 + Math.random() * 0.5;
    s.position.set(im.x + (Math.random() - 0.5) * 0.2, im.y - 0.2 + Math.random() * 0.3, im.z + (Math.random() - 0.5) * 0.2);
    // off the face along the scrape, the car's own speed carrying them
    const d = this.dyn;
    const sp = 2 + Math.random() * (3 + dv * 1.5);
    u.vel.set(d.vel.x * 0.6 + im.nx * sp * 0.6 + (Math.random() - 0.5) * sp, 0.5 + Math.random() * sp * 0.6, d.vel.z * 0.6 + im.nz * sp * 0.6 + (Math.random() - 0.5) * sp);
    s.scale.setScalar(0.05 + Math.random() * 0.05);
    s.material.color.setRGB(9, 4.2, 1.2);
    s.material.opacity = 1;
    s.visible = true;
  }

  /** At rest: the body still to a millimetre a second, no wheel turning, no input, no indicator blinking. */
  _resting() {
    const d = this.dyn;
    const i = d.input;
    if (i.throttle || i.brake || i.steer || i.steerAngle || this.indicator) return false;
    // ((V5) an engine turning, starting or running down keeps it awake; so do sparks in the air)
    if (d.ignition !== 'off' || d.engine.omega > 0.5 || this.sparkCloud.live || this._startT >= 0) return false;
    if (Math.hypot(d.vel.x, d.vel.y, d.vel.z) > 0.001 || Math.hypot(d.omega.x, d.omega.y, d.omega.z) > 0.001) return false;
    return d.wheels.every((w) => Math.abs(w.omega || 0) < 0.01);
  }

  /** Model to dynamics: body, suspension, wheels, steering, doors, lights. */
  sync() {
    const d = this.dyn;
    d.rootPose(this.root.position, this.root.quaternion);
    this.root.updateMatrixWorld(true);
    const n = this.nodes;
    d.wheels.forEach((w, i) => {
      const id = WHEELS[i];
      const sus = n['suspension_' + id];
      sus.position.copy(this.rest['suspension_' + id].pos);
      sus.position.y += w.xStatic - w.x; // + bump
      if (n['steering_' + id]) n['steering_' + id].quaternion.setFromAxisAngle(Y, w.steer);
      n['wheel_' + id].quaternion.setFromAxisAngle(X, -w.spin);
    });
    if (this.wheelBlur) for (const b of this.wheelBlur) {
      const w = d.wheels[b.i];
      const om = Math.abs(w.omega != null ? w.omega : 0);
      b.mat.opacity = THREE.MathUtils.smoothstep(om, 15, 70) * 0.92;
      b.disc.visible = b.mat.opacity > 0.01;
    }
    const sw = this.rest.steering_wheel;
    n.steering_wheel.quaternion.copy(sw.quat).multiply(_q.setFromAxisAngle(Y, d.steerWheel));
    n.door_L.quaternion.copy(this.rest.door_L.quat).multiply(_q.setFromAxisAngle(X, -DOOR_OPEN * this.doorL));
    n.door_R.quaternion.copy(this.rest.door_R.quat).multiply(_q.setFromAxisAngle(X, -DOOR_OPEN * this.doorR));
    // ((V7) the screens dimmed at night: look.js LIGHT)
    const dm = this.mats.display;
    if (dm) {
      if (dm.userData.base0 === undefined) dm.userData.base0 = dm.emissiveIntensity;
      dm.emissiveIntensity = dm.userData.base0 * LIGHT.display;
    }
    // lights
    const L = this.lightMats;
    const braking = d.input.brake > 0.05 && d.gear !== 0 ? 1 : d.gear === 0 && d.input.throttle > 0.05 ? 0 : d.input.brake > 0.05 ? 1 : 0;
    this._lightLevel.brake = braking;
    L.brake.emissiveIntensity = L.brake.userData.base * (braking ? 1.6 : this.headlights ? 0.25 : 0.03);
    L.tail.emissiveIntensity = L.tail.userData.base * (this.headlights ? 1 : 0.35);
    L.head.emissiveIntensity = L.head.userData.base * (this.headlights ? 2 : 0.5);
    // ((V7) a broken headlamp gives no beam)
    const broke = this.damage ? this.damage.broken.head : [0, 0];
    this.beams.forEach((b, i) => (b.intensity = this.headlights && !broke[i] ? 260 : 0));
    const reverse = d.gear === 0 ? 1 : 0;
    this.reverseMat.emissiveIntensity = reverse * 3;
    const blink = Math.floor(this._t * 2.6) % 2 === 0 ? 1 : 0;
    L.indL.emissiveIntensity = L.indL.userData.base * (this.indicator < 0 ? blink * 2 : 0.02);
    L.indR.emissiveIntensity = L.indR.userData.base * (this.indicator > 0 ? blink * 2 : 0.02);
    this.root.updateMatrixWorld(true);
  }

  /** Skid marks where a tyre slides, smoke from hard slides, dust off the tarmac. */
  _tyres(dt) {
    const d = this.dyn;
    const speed = Math.hypot(d.vel.x, d.vel.z);
    d.wheels.forEach((w, i) => {
      const slide = w.contact && w.fz > 600 ? w.slipSpeed : 0;
      // marks: from about 2.5 m/s of the patch sliding, darker the harder
      const mark = THREE.MathUtils.clamp((slide - 2.5) / 6, 0, 1) * (w.surface.dust ? 0 : 1);
      const p = _v.set(w.patch.x, w.groundY + 0.008, w.patch.z);
      const last = this._skidLast[i];
      if (mark > 0.02) {
        if (last && last.distanceToSquared(p) > 0.04) {
          this._skidSeg(last, p, w, mark);
          last.copy(p);
        } else if (!last) this._skidLast[i] = p.clone();
      } else this._skidLast[i] = null;
      // smoke (V3): from the power the patch turns into heat by sliding, |F| x slip speed (kW): none under 6 kW
      // (a cornering tyre's own creep), full at 70 kW (a burnout or a locked wheel at speed); dust: off the tarmac
      const power = w.contact ? (Math.hypot(w.fx || 0, w.fy || 0) * slide) / 1000 : 0;
      w.slipPower = power;
      const smoke = THREE.MathUtils.clamp((power - 6) / 64, 0, 1) * (w.surface.dust ? 0 : 1);
      const dust = w.surface.dust && w.contact ? THREE.MathUtils.clamp((speed - 2) / 15 + slide / 10, 0, 1) * w.surface.dust : 0;
      const rate = smoke > 0 ? 10 + smoke * 50 : dust * 30;
      w._emit = (w._emit || 0) + rate * dt;
      while (w._emit >= 1) {
        w._emit -= 1;
        this._puff(w, smoke > 0 && smoke >= dust ? 'smoke' : 'dust', Math.max(smoke, dust));
      }
    });
  }

  _skidSeg(a, b, w, alpha) {
    const s = this._skid;
    const k = s.n % s.max;
    s.n++;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const half = (w.front ? 0.255 : 0.315) / 2;
    const ox = (-dz / l) * half;
    const oz = (dx / l) * half;
    const P = s.pos;
    const o = k * 12;
    P.set([a.x + ox, a.y, a.z + oz, a.x - ox, a.y, a.z - oz, b.x + ox, b.y, b.z + oz, b.x - ox, b.y, b.z - oz], o);
    s.alpha.set([alpha, alpha, alpha, alpha], k * 4);
    const geo = this.skidMesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }

  clearMarks() {
    if (!this._skid) return;
    this._skid.alpha.fill(0);
    this._skid.n = 0;
    this.skidMesh.geometry.attributes.alpha.needsUpdate = true;
    for (const s of this._smoke) {
      s.visible = false;
      s.userData.life = 0;
    }
  }

  _puff(w, kind, strength) {
    const s = this._smoke[this._smokeNext++ % this._smoke.length];
    const u = s.userData;
    const smoke = kind === 'smoke';
    u.life = u.max = smoke ? 2.4 + Math.random() * 1.6 + strength * 1.5 : 1.2 + Math.random() * 0.8;
    s.position.set(w.patch.x + (Math.random() - 0.5) * 0.3, w.groundY + (smoke ? 0.15 : 0.25), w.patch.z + (Math.random() - 0.5) * 0.3);
    const d = this.dyn;
    // (V3) the smoke leaves the patch with some of the car's speed and the tread's throw, then the air has it
    u.vel.set(d.vel.x * 0.3 + (Math.random() - 0.5) * 1.6, 0.3 + Math.random() * 0.5, d.vel.z * 0.3 + (Math.random() - 0.5) * 1.6);
    u.grow = smoke ? 3.5 + strength * 2.5 : 1.8;
    u.size = smoke ? 0.5 + strength * 0.6 : 0.6 + strength * 0.5;
    u.alpha = smoke ? 0.3 + 0.35 * strength : 0.25 + 0.25 * strength;
    u.smoke = smoke;
    u.ground = w.groundY;
    u.seed = Math.random() * 100;
    // (V3) lit: the sprites are unlit, so their colour is what the sun and the sky give a white, thick, forward-
    // scattering cloud in this light (sun 8 x (1, 0.8, 0.6) at 29 deg, sky about 0.35); V2's 0.85 grey read as a
    // faint haze against the sunlit tarmac
    // ((V7) times the time of day's light on sprites: look.js LIGHT)
    const L = LIGHT.sprite;
    if (smoke) s.material.color.setRGB(2.05 * L, 1.72 * L, 1.42 * L);
    else s.material.color.setRGB(1.25 * L, 1.0 * L, 0.72 * L);
    s.visible = true;
  }

  _particles(dt) {
    for (const s of this._sparks) {
      const u = s.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) {
        s.visible = false;
        continue;
      }
      u.vel.y -= 9.81 * dt;
      s.position.addScaledVector(u.vel, dt);
      const g = groundAt(s.position.x, s.position.z);
      if (s.position.y < g + 0.02) {
        s.position.y = g + 0.02;
        u.vel.y *= -0.3;
        u.vel.x *= 0.6;
        u.vel.z *= 0.6;
      }
      s.material.opacity = Math.min(1, (u.life / u.max) * 2);
      s.material.color.setRGB(9 * (0.4 + 0.6 * u.life / u.max), 4.2 * (u.life / u.max), 1.2 * (u.life / u.max));
    }
    // (V3) a light breeze from the north-west, the cloud rising as it is warm, turbulence; it thins as it spreads
    // ((V7) the weather's wind with its gusts, terrain.js; V3 to V6 had a fixed 1.4 m/s breeze)
    const wind = _v2.copy(WEATHER.now);
    for (const s of this._smoke) {
      const u = s.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) {
        s.visible = false;
        continue;
      }
      const age = 1 - u.life / u.max;
      // velocity relaxes to the wind (drag), plus buoyancy and a slow swirl
      const k = 1 - Math.exp(-1.4 * dt);
      u.vel.x += (wind.x - u.vel.x) * k;
      u.vel.z += (wind.z - u.vel.z) * k;
      u.vel.y += ((u.smoke ? 0.35 : 0.05) - u.vel.y) * k;
      const t = this._t + u.seed;
      s.position.x += (u.vel.x + Math.sin(t * 1.3) * 0.4) * dt;
      s.position.y += u.vel.y * dt;
      s.position.z += (u.vel.z + Math.cos(t * 1.1) * 0.4) * dt;
      const size = u.size * (1 + age * u.grow);
      s.scale.set(size, size, size);
      // (a flat sprite cut by the ground shows a hard line: its centre stays 0.4 of its size up)
      if (u.ground !== undefined) s.position.y = Math.max(s.position.y, u.ground + size * 0.4);
      // in quickly, then thinning as the same smoke covers more area (alpha ~ 1 / spread)
      const fadeIn = Math.min(1, age * 8);
      const thin = (u.size * u.size) / (size * size);
      s.material.opacity = u.alpha * fadeIn * (u.smoke ? Math.min(1, 0.25 + 0.75 * Math.sqrt(thin)) * (1 - age * age) : Math.sin(Math.PI * Math.min(1, age * 1.2)));
      // (V4) seen from the cockpit, a puff whose flat sprite reaches into the cabin fades: the cabin is shut, and a
      // slide through its own cloud drew the smoke over the dashboard and the wheel
      if (this.inCockpit) {
        const l = this.root.worldToLocal(_n.copy(s.position));
        const out = Math.max(Math.abs(l.x) - 1.0, Math.abs(l.z + 0.2) - 2.4, l.y - 1.2);
        s.material.opacity *= THREE.MathUtils.smoothstep(out, 0, size * 0.5);
      }
    }
  }
}

/**
 * (V5) The driver's torso and head thrown by the car's acceleration (accBody: +x right, -z forward, m/s^2): each a
 * damped spring per axis driven by the inertial load, torso about 2.5 Hz, head about 3 Hz and looser, so both lag
 * the car and the head lags more; the belt stops the torso at 15 deg forward and 9 deg sideways, the seat back at
 * 3 deg back; the head at 35 deg forward, 20 back, 25 sideways. At a steady 1 g braking: torso about 3 deg, head 4.
 * A hit's speed change arrives in one frame's acceleration, so it throws them against the stops. Angles in rad,
 * pitch + forward, roll + toward the driver's left (the car accelerating to the right).
 */
export class BodyThrow {
  constructor() {
    this.torso = { p: 0, pv: 0, r: 0, rv: 0 };
    this.head = { p: 0, pv: 0, r: 0, rv: 0 };
  }

  update(dt, acc) {
    if (!(dt > 0)) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      // (the frame's mean acceleration over each sub-step)
      spring(this.torso, h, acc.z, acc.x, 15.7, 0.6, 1.31, [-0.05, 0.26], 0.16);
      spring(this.head, h, acc.z, acc.x, 18.8, 0.4, 2.5, [-0.35, 0.6], 0.44);
    }
  }
}
function spring(s, h, lon, lat, w, zeta, k, [lo, hi], side) {
  s.pv += (k * lon - w * w * s.p - 2 * zeta * w * s.pv) * h;
  s.p += s.pv * h;
  if (s.p > hi) {
    s.p = hi;
    if (s.pv > 0) s.pv *= -0.3;
  } else if (s.p < lo) {
    s.p = lo;
    if (s.pv < 0) s.pv *= -0.3;
  }
  s.rv += (k * lat - w * w * s.r - 2 * zeta * w * s.rv) * h;
  s.r += s.rv * h;
  if (Math.abs(s.r) > side) {
    s.r = Math.sign(s.r) * side;
    if (s.rv * s.r > 0) s.rv *= -0.3;
  }
}
