// Everything that reacts to the rifle: muzzle flash, tracers, spent cases, dropped magazines,
// bullet marks and the steel targets.
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';
import { batchModel, NEAR_LAYER } from './batch.js';

const GRAVITY = 9.81;
const TRACER_SPEED = 320; // m/s, slowed down enough to be seen
const TRACER_LENGTH = 3.5;
const MAX_SHELLS = 48;
const MAX_HULLS = 10;
const MAX_MAGS = 5;
const MAX_MARKS = 90;
// HDR brightness of the self-lit effects (pass 10): above anything the sun lights, so the bloom
// (look.js) picks out the flash, tracers and sparks and nothing else
const HOT = { flash: 9, tracer: 7, spark: 5 };

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.22, 'rgba(255,224,150,0.95)');
  grad.addColorStop(0.55, 'rgba(255,150,50,0.4)');
  grad.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.hits = 0;
    this.colliders = []; // what a bullet can hit
    this.targets = [];
    this.bodies = []; // loose cases and magazines
    this.shells = [];
    this.mags = [];
    this.tracers = [];
    this.sparks = [];
    this.marks = [];
    this._markNext = 0;
    this._shellNext = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 150;

    this.glow = glowTexture();
    const additive = (color = 0xffffff, map = null) =>
      new THREE.MeshBasicMaterial({
        color,
        map,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });

    // ---- muzzle flash: two crossed streaks along the bore and a disc facing it ----
    this.flashGroup = new THREE.Group();
    this.flashGroup.visible = false;
    const flashMat = additive(0xffffff, this.glow);
    flashMat.color.multiplyScalar(HOT.flash);
    const streak = new THREE.PlaneGeometry(0.3, 0.12);
    for (const roll of [0, Math.PI / 2]) {
      const holder = new THREE.Group();
      holder.rotation.z = roll;
      const plane = new THREE.Mesh(streak, flashMat);
      plane.rotation.y = Math.PI / 2;
      plane.position.z = -0.12;
      holder.add(plane);
      this.flashGroup.add(holder);
    }
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
    disc.position.z = -0.03;
    this.flashGroup.add(disc);
    // (the light stands 40 cm out from the muzzle, not 15: inverse-square, at 15 cm the barrel's own
    // steel took about 40 times the sun and went white for a frame; pass 11)
    this.flashLight = new THREE.PointLight(0xffb060, 0, 7, 2);
    // (2026-11-13) the light lives in the scene and follows the muzzle (_followFlash), not under the gun: hiding a gun
    // (getting into a vehicle) took the light out of the scene's light list, and a change in that list rebuilds every
    // material's shaders, 0.7 to 1 s of work at each hide and show (the freeze on getting into the car)
    this._flashAt = new THREE.Vector3(0, 0, -0.4);
    this.muzzle = null;
    scene.add(this.flashLight);
    this.flashTime = 0;

    // ---- pools ----
    const shellGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.044, 8).rotateX(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8a24c, metalness: 1, roughness: 0.32 });
    for (let i = 0; i < MAX_SHELLS; i++) {
      const mesh = new THREE.Mesh(shellGeo, brass);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      const body = this._body(mesh, 0.005, 'shell');
      this.shells.push(body);
    }
    // shotgun hulls: bigger, red plastic
    this.hulls = [];
    this._hullNext = 0;
    const hullGeo = new THREE.CylinderGeometry(0.0102, 0.0102, 0.06, 10).rotateX(Math.PI / 2);
    const plastic = new THREE.MeshStandardMaterial({ color: 0xa3261c, metalness: 0.1, roughness: 0.5 });
    for (let i = 0; i < MAX_HULLS; i++) {
      const mesh = new THREE.Mesh(hullGeo, plastic);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.hulls.push(this._body(mesh, 0.0102, 'shell'));
    }
    const tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(tracerGeo, additive(0xffd9a0));
      mesh.material.color.multiplyScalar(HOT.tracer);
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, active: false, origin: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, hit: null });
    }
    const sparkGeo = new THREE.PlaneGeometry(0.22, 0.22);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(sparkGeo, additive(0xffffff, this.glow));
      mesh.material.color.multiplyScalar(HOT.spark);
      mesh.visible = false;
      scene.add(mesh);
      this.sparks.push({ mesh, life: 0 });
    }
    this.markGeo = new THREE.CircleGeometry(0.011, 10);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0x141414 });
  }

  _body(mesh, radius, kind) {
    const body = {
      mesh,
      kind,
      radius,
      active: false,
      resting: false,
      life: 0,
      vel: new THREE.Vector3(),
      axis: new THREE.Vector3(1, 0, 0),
      spin: 0,
    };
    this.bodies.push(body);
    return body;
  }

  /** Parents the flash to the rifle's muzzle_point empty. */
  attachFlash(muzzleNode) {
    muzzleNode.add(this.flashGroup);
    this.muzzle = muzzleNode;
    this._followFlash();
  }

  /** The flash light onto the muzzle (40 cm out along its bore), where it would be as the muzzle's child. */
  _followFlash() {
    if (!this.muzzle) return;
    this.muzzle.updateWorldMatrix(true, false);
    this.flashLight.position.copy(this._flashAt).applyMatrix4(this.muzzle.matrixWorld);
  }

  flash() {
    this._followFlash();
    this.flashTime = 0.05;
    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    this.flashGroup.scale.setScalar(0.75 + Math.random() * 0.5);
    this.flashLight.intensity = 5;
  }

  /**
   * What a ray lands on, starting `near` metres along it: the point in the middle of the
   * view, which is where the rifle gets pointed. Empty sky counts as 200 m away.
   */
  sight(origin, dir, near, out) {
    for (const collider of this.colliders) collider.updateWorldMatrix(true, false);
    this.raycaster.set(origin, dir);
    this.raycaster.near = near;
    this.raycaster.far = 200;
    const hit = this.raycaster.intersectObjects(this.colliders, false)[0];
    this.raycaster.near = 0;
    this.raycaster.far = 150;
    return hit ? out.copy(hit.point) : out.copy(origin).addScaledVector(dir, 200);
  }

  /** One bullet: a tracer now, and whatever it hits when the tracer gets there. */
  shot(origin, dir) {
    // Plates swing, and nothing guarantees a render since they last moved.
    for (const collider of this.colliders) collider.updateWorldMatrix(true, false);
    this.raycaster.set(origin, dir);
    const hit = this.raycaster.intersectObjects(this.colliders, false)[0] || null;
    const tracer = this.tracers.find((t) => !t.active) || this.tracers[0];
    tracer.active = true;
    tracer.origin.copy(origin);
    tracer.dir.copy(dir);
    tracer.dist = hit ? hit.distance : 150;
    tracer.t = 0;
    tracer.hit = hit;
    tracer.mesh.quaternion.setFromUnitVectors(FORWARD, dir);
  }

  /** A spent case leaving the ejection port along `dir`; `hull` makes it a shotgun's. */
  shell(position, dir, weaponQuat, hull = false) {
    let body;
    if (hull) {
      body = this.hulls[this._hullNext];
      this._hullNext = (this._hullNext + 1) % MAX_HULLS;
    } else {
      body = this.shells[this._shellNext];
      this._shellNext = (this._shellNext + 1) % MAX_SHELLS;
    }
    body.active = true;
    body.resting = false;
    body.life = 7;
    body.mesh.visible = true;
    body.mesh.position.copy(position);
    body.mesh.quaternion.copy(weaponQuat);
    body.vel
      .copy(dir)
      .multiplyScalar(2.6 + Math.random() * 0.8)
      .add(_v.set(0, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.5).applyQuaternion(weaponQuat));
    body.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    body.spin = 18 + Math.random() * 20;
  }

  /** Leaves a copy of the magazine falling from where the real one was pulled out. */
  dropMagazine(source) {
    let body = this.mags.find((b) => !b.active);
    if (!body && this.mags.length < MAX_MAGS) {
      const mesh = source.clone();
      mesh.visible = true;
      this.scene.add(mesh);
      body = this._body(mesh, 0.05, 'mag');
      this.mags.push(body);
    }
    if (!body) body = this.mags.reduce((oldest, b) => (b.life < oldest.life ? b : oldest));
    body.active = true;
    body.resting = false;
    body.life = 14;
    body.mesh.visible = true;
    source.matrixWorld.decompose(body.mesh.position, body.mesh.quaternion, body.mesh.scale);
    body.vel.set(-0.25, -0.9, 0.15).applyQuaternion(body.mesh.quaternion);
    body.axis.set(1, 0.2, 0.4).normalize();
    body.spin = 5 + Math.random() * 3;
  }

  /** A hanging steel plate on an A-frame, facing the shooter. */
  addTarget(x, y, z, facing) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = facing;
    // ((V4) one steel for every frame, so batch.js merges the frames' legs, feet and bars into one mesh)
    const steel = (this._targetSteel = this._targetSteel || new THREE.MeshStandardMaterial({ color: 0x2d3034, roughness: 0.6, metalness: 0.6 }));
    const paint = new THREE.MeshStandardMaterial({ color: 0xebe7dc, roughness: 0.55, metalness: 0.2, emissive: 0xff8a2a, emissiveIntensity: 0 });
    const top = y + 0.34;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, top + 0.03, 0.04), steel);
      leg.position.set(sx * 0.36, (top + 0.03) / 2, 0);
      leg.castShadow = true;
      leg.userData.static = true;
      group.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.6), steel);
      foot.position.set(sx * 0.36, 0.02, 0);
      foot.userData.static = true;
      group.add(foot);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.04), steel);
    bar.position.set(0, top, 0);
    bar.userData.static = true;
    group.add(bar);
    const hinge = new THREE.Group();
    hinge.position.set(0, top, 0);
    group.add(hinge);
    for (const sx of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.012), steel);
      chain.position.set(sx * 0.1, -0.08, 0);
      hinge.add(chain);
    }
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.014, 32).rotateX(Math.PI / 2), paint);
    plate.position.set(0, -0.34, 0);
    plate.castShadow = true;
    plate.layers.enable(NEAR_LAYER); // ((V4) the second cascade draws it too, look.js)
    hinge.add(plate);
    batchModel(hinge, { keep: (o) => o === plate, far: false }); // ((V4) the two chains: one draw)
    this.scene.add(group);
    const target = { hinge, plate, paint, angle: 0, vel: 0, glow: 0 };
    plate.userData.target = target;
    this.targets.push(target);
    this.colliders.push(plate);
    return target;
  }

  _impact(hit) {
    const spark = this.sparks.find((s) => s.life <= 0) || this.sparks[0];
    spark.life = 0.09;
    spark.mesh.visible = true;
    spark.mesh.position.copy(hit.point);

    _n.copy(hit.face ? hit.face.normal : UP).transformDirection(hit.object.matrixWorld);
    let mark = this.marks[this._markNext];
    if (!mark) {
      mark = new THREE.Mesh(this.markGeo, this.markMat);
      this.marks[this._markNext] = mark;
    }
    this._markNext = (this._markNext + 1) % MAX_MARKS;
    this.scene.add(mark);
    mark.position.copy(hit.point).addScaledVector(_n, 0.003);
    mark.lookAt(_v.copy(mark.position).add(_n));
    mark.scale.setScalar(0.8 + Math.random() * 0.6);
    // so marks swing with a plate ((V4) a mesh batch.js merged is out of the scene: the mark goes on the scene)
    (hit.object.parent ? hit.object : this.scene).attach(mark);

    const target = hit.object.userData.target;
    if (target) {
      this.hits += 1;
      target.vel += 2.4;
      target.glow = 1;
    }
  }

  update(dt, camera) {
    // muzzle flash
    this._followFlash();
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flashGroup.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 130);

    // tracers
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      const head = Math.min(t.t * TRACER_SPEED, t.dist);
      const tail = Math.max(0, t.t * TRACER_SPEED - TRACER_LENGTH);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        if (t.hit) this._impact(t.hit);
        continue;
      }
      t.mesh.visible = true;
      t.mesh.position.copy(t.origin).addScaledVector(t.dir, (head + tail) / 2);
      t.mesh.scale.set(1, 1, Math.max(head - tail, 0.01));
    }

    // impact sparks face the camera
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.quaternion.copy(camera.quaternion);
      s.mesh.scale.setScalar(0.5 + s.life * 8);
      if (s.life <= 0) s.mesh.visible = false;
    }

    // loose cases and magazines
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      if (b.resting) continue;
      b.vel.y -= GRAVITY * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.quaternion.premultiply(_q.setFromAxisAngle(b.axis, b.spin * dt));
      const floor = groundAt(b.mesh.position.x, b.mesh.position.z); // (the ramps, steps and kerb too)
      if (b.mesh.position.y < floor + b.radius) {
        b.mesh.position.y = floor + b.radius;
        if (Math.abs(b.vel.y) < 1.1) {
          b.resting = true;
          const yaw = Math.random() * Math.PI * 2;
          if (b.kind === 'mag') {
            b.mesh.rotation.set(0, yaw, Math.PI / 2); // flat on its side
            b.mesh.position.y = floor + 0.017;
          } else {
            b.mesh.rotation.set(0, yaw, 0);
          }
        } else {
          b.vel.y *= -0.32;
          b.vel.x *= 0.55;
          b.vel.z *= 0.55;
          b.spin *= 0.6;
        }
      }
    }

    // swinging plates
    for (const target of this.targets) {
      target.vel += (-34 * target.angle - 1.5 * target.vel) * dt;
      target.angle += target.vel * dt;
      target.hinge.rotation.x = target.angle;
      target.glow = Math.max(0, target.glow - dt * 5);
      target.paint.emissiveIntensity = target.glow * 0.9;
    }
  }
}
