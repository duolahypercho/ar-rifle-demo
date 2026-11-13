// (V7) The car's mirrors: the rear-view mirror on the windscreen header and the two door mirrors show the world
// behind, rendered from the mirror's own virtual eye into a small texture.
//
// For each mirror the viewer's eye (the camera, wherever it is) is reflected in the mirror's plane; a camera at that
// virtual eye looking along the mirror's normal, with an off-axis frustum whose window is the mirror's own rectangle,
// sees exactly what the mirror shows (near plane = the mirror's plane, so the cabin roof and windscreen in front of the
// mirror are cut away). The mirror surface samples that picture at the projection of its own points through the same
// camera, so the picture is the right way round (a mirror's left-right reversal) without any flipping by hand.
// The door mirrors are convex (a wider field in the same glass): their window is widened by CONVEX about its centre for
// the render and the surface maps the whole picture onto the glass, which is what a convex mirror does to the image.
// The rear-view mirror is flat; through it the cabin's rear bulkhead and the small rear window frame the view.
//
// Cost: one mirror is rendered every second frame in turn ((V8); V7 every frame, each every third), only while the camera is within NEAR m of
// the car and the mirror faces it and is inside the view; the textures are 256 x 64 (rear-view) and 160 x 128 (doors),
// about the mirror's size on screen from the driver's seat. The shadow maps are not redrawn for the mirror's camera
// (the main camera's cascades are used as they are). Switch off with ?perf=-mirrors or demo.perf.mirrors = false.
import * as THREE from 'three/webgpu';
import { texture, uniform, positionLocal, vec2, vec4, float, smoothstep, max, abs } from 'three/tsl';
import { PERF } from './perf.js';
import { DETAIL_LAYER, GRASS_LAYER } from './terrain.js';

const NEAR = 4.5; // m: the mirrors are drawn while the camera is this close to the glass (the cockpit, or beside the car)
const FAR = 1500; // m: what a mirror shows (the sky's box is 1300 m out)
const CONVEX = 1.55; // the door mirrors' window, widened (a convex mirror of about 1.4 m radius at this size)
const REFLECT = { centre: 0.82, door: 0.62 }; // silvered glass; chromed convex glass
// the driver's eye in the car's frame with the seat fitted (the cockpit camera's place): the mirrors are aimed from it
const EYE = new THREE.Vector3(-0.37, 0.99, -0.06);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

/**
 * (V7) The vertices of a part inside the vehicle's skinned batches (batch.js merges each material's pieces into one
 * skinned mesh whose bind pose is the car's frame at load): by matching the part's own (hidden) meshes' vertices, moved
 * into the car's frame, to the batch's, or by a box (car frame) and a material name. Returns [{ mesh, idx, rest }]:
 * the batch mesh, its vertex indices and their rest positions, so the part can be turned, folded or dented by
 * rewriting them (the draw stays the batch's own: no extra draw call).
 */
export function partVerts(car, { node = null, box = null, material = null } = {}) {
  const model = car.model;
  model.updateMatrixWorld(true);
  const toCar = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const keys = new Map(); // material name -> Set of rounded positions
  const key = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
  if (node) {
    node.traverse((o) => {
      if (!o.isMesh || o.userData.mirrorGlass || !o.geometry || !o.material) return;
      const m = new THREE.Matrix4().multiplyMatrices(toCar, o.matrixWorld);
      const pos = o.geometry.attributes.position;
      const set = keys.get(o.material.name) || new Set();
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m);
        set.add(key(_v.x, _v.y, _v.z));
      }
      keys.set(o.material.name, set);
    });
  }
  const out = [];
  car.root.parent.traverse((o) => {
    if (!o.isSkinnedMesh || !o.userData.batch || !o.material || !o.name.includes('(merged')) return;
    const name = o.material.name;
    if (material && name !== material) return;
    const set = keys.get(name);
    if (node && !set) return;
    const pos = o.geometry.attributes.position;
    const idx = [];
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (node ? set.has(key(_v.x, _v.y, _v.z)) : box.containsPoint(_v)) idx.push(i);
    }
    if (!idx.length) return;
    const rest = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => rest.set([pos.getX(i), pos.getY(i), pos.getZ(i)], k * 3));
    out.push({ mesh: o, idx, rest });
  });
  return out;
}

/** Writes a part's vertices as `matrix` (car frame) times their rest positions. */
export function movePart(part, matrix) {
  for (const { mesh, idx, rest } of part) {
    const pos = mesh.geometry.attributes.position;
    idx.forEach((i, k) => {
      _v.fromArray(rest, k * 3).applyMatrix4(matrix);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    });
    pos.needsUpdate = true;
  }
}

export class CarMirrors {
  constructor(renderer, scene, car) {
    this.renderer = renderer;
    this.scene = scene;
    this.car = car;
    this.list = [];
    this.next = 0;
    this.frame = 0;
    this.renders = 0; // mirror renders so far (for the cost measures)
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.05, 1500);
    this.enabled = true;
  }

  /** Builds the three mirror surfaces once the car's model is loaded. */
  build() {
    const car = this.car;
    const model = car.model;
    model.updateMatrixWorld(true);
    // rear-view: the interior's mirror face, 19.6 x 4.6 cm at z -0.529 facing aft (found in the GLB: the 4-vertex
    // 'metal' quad in `interior` at x +-0.098, y 0.983..1.029), its black housing behind it on a stalk from the header
    const cbox = new THREE.Box3(new THREE.Vector3(-0.112, 0.974, -0.572), new THREE.Vector3(0.112, 1.054, -0.522));
    const cpart = [...partVerts(car, { box: cbox, material: 'black_trim' }), ...partVerts(car, { box: cbox, material: 'metal' })];
    this._add('centre', model, cpart, new THREE.Vector3(0, 1.046, -0.552), new THREE.Vector3(0, 1.006, -0.529), 0.196, 0.046, 256, 64, 1, (dir) => dir.set(0, 0.012, 1));
    for (const side of ['L', 'R']) {
      const node = car.nodes['mirror_' + side];
      if (!node) continue;
      // the glass: the mirror node's 'metal' part (its face, about 14 x 13 cm, facing aft); the housing turns about its
      // root on the door (the driver sets it), the glass with it
      let glass = null;
      node.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === 'metal') glass = o;
      });
      if (!glass) continue;
      const toCar = new THREE.Matrix4().copy(model.matrixWorld).invert();
      glass.geometry.computeBoundingBox();
      const gb = glass.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toCar, glass.matrixWorld));
      const hb = new THREE.Box3().setFromObject(node).applyMatrix4(toCar);
      const out = side === 'L' ? -1 : 1;
      const pivot = new THREE.Vector3(out < 0 ? hb.max.x : hb.min.x, (hb.min.y + hb.max.y) / 2, (hb.min.z + hb.max.z) / 2);
      const c = gb.getCenter(new THREE.Vector3());
      c.z = gb.max.z;
      const part = partVerts(car, { node });
      this._add(side, node, part, pivot, c, (gb.max.x - gb.min.x) * 1.02, (gb.max.y - gb.min.y) * 1.02, 160, 128, CONVEX, (dir) => dir.set(out * 0.08, -0.03, 1));
    }
    this.hidden = this.list.reduce((n, m) => n + m.part.reduce((k, p) => k + p.idx.length, 0), 0);
  }

  /**
   * Sets each mirror as a driver does on getting in: the rear-view mirror's view straight back through the rear window,
   * the door mirrors' straight back and a little out, from `eye` (the car's frame; default EYE). The housing turns about
   * its root with the glass (its vertices in the batch rewritten: no extra draw).
   */
  aim(eye = EYE) {
    for (const m of this.list) {
      const toEye = _u.copy(eye).sub(m.glass).normalize();
      const n = m.aimDir(_v2).normalize().add(toEye).normalize();
      m.turn.setFromUnitVectors(_n.set(0, 0, 1), n);
      this._pose(m);
    }
    this.aimedFrom = eye.clone();
  }

  /** The housing and glass of mirror m: turned by m.turn about m.pivot, then folded / knocked off (damage). */
  _pose(m) {
    // car-frame matrix: about the pivot, the set turn, then the fold (about the vertical through the pivot)
    const T = _m.makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z);
    const F = new THREE.Matrix4().makeRotationY(m.fold * (m.name === 'L' ? -1.2 : m.name === 'R' ? 1.2 : 0));
    const R = new THREE.Matrix4().makeRotationFromQuaternion(m.turn);
    const Ti = new THREE.Matrix4().makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z);
    const M = new THREE.Matrix4().multiplyMatrices(T, F).multiply(R).multiply(Ti);
    if (m.off) M.makeScale(0, 0, 0).setPosition(m.pivot); // (knocked off: gone from the door; damage.js drops a loose one)
    movePart(m.part, M);
    // the glass plane: in the car frame, then into its parent's rest frame
    const g = _v.copy(m.glass).applyMatrix4(M);
    const q = _q.setFromRotationMatrix(M);
    const W = new THREE.Matrix4().compose(g, q, new THREE.Vector3(1, 1, 1));
    W.premultiply(m.parentRestInv);
    W.decompose(m.mesh.position, m.mesh.quaternion, _u);
    m.mesh.position.add(_v2.set(0, 0, 0.0015).applyQuaternion(m.mesh.quaternion));
    m.mesh.visible = !m.off;
    m.mesh.updateMatrixWorld(true);
  }

  _add(name, parent, part, pivot, glassCar, w, h, rw, rh, convex, aimDir) {
    const model = this.car.model;
    // the model's own glass (the 'metal' faces, a flat grey) folded to a point behind ours
    for (const p of part) {
      if (p.mesh.material.name !== 'metal') continue;
      for (let k = 0; k < p.idx.length; k++) p.rest.set([glassCar.x, glassCar.y, glassCar.z - 0.004], k * 3);
    }
    const rt = new THREE.RenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    rt.texture.name = 'mirror ' + name;
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    // the surface: projects its own points through the mirror camera of the last render (in the surface's frame, so it
    // stays right while the car moves between renders)
    const mapU = uniform(new THREE.Matrix4());
    const mat = new THREE.MeshBasicNodeMaterial({ name: 'mirror glass ' + name });
    const clip = mapU.mul(vec4(positionLocal, 1));
    const ndc = clip.xy.div(clip.w);
    const uv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5));
    const edge = smoothstep(0.5, 0.47, max(abs(uv.x.sub(0.5)), abs(uv.y.sub(0.5))).mul(1));
    const seen = uniform(0); // 0 until the first render: dark glass
    const crack = uniform(0); // (damage: cracked glass darkens and breaks the picture up)
    mat.colorNode = texture(rt.texture, uv).rgb.mul(float(name === 'centre' ? REFLECT.centre : REFLECT.door)).mul(seen).mul(edge.mul(0.15).add(0.85)).mul(float(1).sub(crack.mul(0.3)));
    mat.fog = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.name = 'mirror ' + name;
    mesh.userData.mirrorGlass = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    // the parent's frame at rest (door shut) against the car's: the plane is placed through it
    model.updateMatrixWorld(true);
    const parentRestInv = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(model.matrixWorld).invert(), parent.matrixWorld).invert();
    const m = { name, part, pivot: pivot.clone(), glass: glassCar.clone(), parentRestInv, turn: new THREE.Quaternion(), fold: 0, off: false, aimDir, mesh, rt, mapU, seen, crack, w, h, convex, rw, rh, last: -1, broken: false, uv, color: mat.colorNode };
    const toEye = _u.copy(EYE).sub(m.glass).normalize();
    m.turn.setFromUnitVectors(_n.set(0, 0, 1), aimDir(_v2).normalize().add(toEye).normalize());
    this.list.push(m);
    this._pose(m);
  }

  /** Should mirror `m` be drawn for this camera? (near, facing it, inside the view) */
  _wanted(m, camera) {
    if (!m.mesh.visible || m.broken || m.off) return false;
    for (let p = m.mesh.parent; p; p = p.parent) if (!p.visible) return false;
    m.mesh.getWorldPosition(_v);
    if (_v.distanceTo(camera.position) > NEAR) return false;
    _n.set(0, 0, 1).applyQuaternion(m.mesh.getWorldQuaternion(_q));
    if (_v2.subVectors(camera.position, _v).dot(_n) <= 0.01) return false;
    _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
    _sphere.set(_v, Math.max(m.w, m.h));
    return _frustum.intersectsSphere(_sphere);
  }

  /**
   * Called once a frame before the picture is drawn: renders at most one mirror (the next one wanted, in turn).
   * Returns the mirror's name, or null.
   */
  update(camera, look) {
    this.frame++;
    if (!PERF.mirrors || !this.enabled || !this.list.length || !this.car.ready) return null;
    camera.updateMatrixWorld();
    const n = this.list.length;
    // ((V8) at most one mirror every second frame (V7: one every frame), the mirrors in turn, each at most every fourth:
    // with all three wanted each is redrawn 10 times a second; V7's rate cost 2.0 ms a frame in the cockpit (V8 table),
    // over the 1.3 ms allowed)
    if (this.frame - (this.lastAny || -9) < 2) return null;
    for (let k = 0; k < n; k++) {
      const m = this.list[(this.next + k) % n];
      if (!this._wanted(m, camera)) continue;
      if (this.frame - m.last < 4) continue; // (each at most every fourth frame)
      this.lastAny = this.frame;
      this.next = (this.list.indexOf(m) + 1) % n;
      this._render(m, camera, look);
      m.last = this.frame;
      return m.name;
    }
    return null;
  }

  _render(m, camera, look) {
    const cam = this.cam;
    const mesh = m.mesh;
    mesh.updateMatrixWorld(true);
    const P = mesh.getWorldPosition(new THREE.Vector3());
    const q = mesh.getWorldQuaternion(new THREE.Quaternion());
    const N = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const U = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const E = camera.getWorldPosition(new THREE.Vector3());
    const d = _v.subVectors(E, P).dot(N);
    const Ev = E.clone().addScaledVector(N, -2 * d);
    // camera at the virtual eye looking along +N (through the glass, to the scene on the viewer's side)
    const Z = N.clone().negate();
    const X = new THREE.Vector3().crossVectors(U, Z).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X);
    cam.position.copy(Ev);
    cam.quaternion.setFromRotationMatrix(_m.makeBasis(X, Y, Z));
    cam.updateMatrixWorld(true);
    // the glass's corners in the camera's frame: the window at depth d
    const hw = m.w / 2;
    const hh = m.h / 2;
    let l = Infinity;
    let r = -Infinity;
    let b = Infinity;
    let t = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      _v.set(sx * hw, sy * hh, 0).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
      const s = d / -_v.z; // (onto the plane z = -d; the corners are on it already)
      l = Math.min(l, _v.x * s);
      r = Math.max(r, _v.x * s);
      b = Math.min(b, _v.y * s);
      t = Math.max(t, _v.y * s);
    }
    const near = Math.max(0.01, d);
    const far = FAR;
    const cs = this.renderer.coordinateSystem;
    cam.coordinateSystem = cs;
    // the surface's map: the flat window (projection of its points onto the whole texture)
    const flat = new THREE.Matrix4().makePerspective(l, r, t, b, near, far, cs);
    m.mapU.value.multiplyMatrices(flat, cam.matrixWorldInverse).multiply(mesh.matrixWorld);
    // the render: widened about the centre for a convex mirror
    const cx = (l + r) / 2;
    const cy = (b + t) / 2;
    const k = m.convex;
    cam.projectionMatrix.makePerspective(cx + (l - cx) * k, cx + (r - cx) * k, cy + (t - cy) * k, cy + (b - cy) * k, near, far, cs);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.layers.mask = camera.layers.mask & ~(1 << DETAIL_LAYER) & ~(1 << GRASS_LAYER); // (no grass, trees, hills or clouds in the mirrors)
    // (the shadow maps stay the main camera's: no cascade redraw for this camera)
    const shadows = [];
    if (look && look.csm && look.csm.lights) for (const lt of look.csm.lights) {
      shadows.push([lt.shadow, lt.shadow.autoUpdate]);
      lt.shadow.autoUpdate = false;
    }
    const was = this.renderer.getRenderTarget();
    const own = [];
    for (const o of this.list) {
      own.push(o.mesh.visible);
      o.mesh.visible = false;
    }
    const sky = look && look.sky;
    const skyAt = sky ? sky.position.clone() : null;
    if (sky) sky.position.copy(Ev);
    try {
      this.renderer.setRenderTarget(m.rt);
      this.renderer.render(this.scene, cam);
    } finally {
      this.renderer.setRenderTarget(was);
      this.list.forEach((o, i) => (o.mesh.visible = own[i]));
      for (const [s, a] of shadows) s.autoUpdate = a;
      if (sky) sky.position.copy(skyAt);
    }
    m.seen.value = 1;
    this.renders++;
  }

  /** (debug) true: the glass shows its texture coordinates (red = u, blue = v) instead of the picture. */
  debugUv(on) {
    for (const m of this.list) {
      m.mesh.material.colorNode = on ? vec4(m.uv.x, 0, m.uv.y, 1).rgb.mul(3) : m.color;
      m.mesh.material.needsUpdate = true;
    }
  }

  /** (damage) A door mirror folded back on its hinge (0..1, 1 = flat against the door) or knocked off. */
  setFold(name, fold) {
    const m = this.list.find((o) => o.name === name);
    if (!m || m.off) return;
    m.fold = THREE.MathUtils.clamp(fold, 0, 1);
    this._pose(m);
  }

  knockOff(name) {
    const m = this.list.find((o) => o.name === name);
    if (!m || m.off) return null;
    m.off = true;
    this._pose(m);
    return m;
  }

  /** (damage) Cracked glass on mirror `name` (0..1). */
  setCrack(name, k) {
    const m = this.list.find((o) => o.name === name);
    if (m) m.crack.value = k;
  }

  /** As new: every mirror on, unfolded, uncracked, set as the driver set them. */
  reset() {
    for (const m of this.list) {
      m.off = false;
      m.fold = 0;
      m.crack.value = 0;
      this._pose(m);
    }
  }
}
