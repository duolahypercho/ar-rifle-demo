// (V4) Fewer draw calls. Three's WebGPU renderer spends most of a frame's CPU on each object in each pass
// (6 scene passes: four shadow cascades, the depth / normal / velocity pre-pass and the lit pass), so:
//  - meshes that never move against each other (the world's static meshes; the parts of a vehicle that move
//    with the same node: the body, a door, a wheel) are merged into one mesh per material, in that node's frame;
//  - their shadows come from one depth-only proxy per node (or per patch of the world), whatever the materials,
//    on SHADOW_LAYER: the sun's cascades draw it, the view camera never does; the visible meshes stop casting.
// The originals stay where code or measures look them up: a vehicle's in its graph, hidden (bodyClearance still
// reads their triangles); the world's out of the scene, still in fx.colliders for the bullets (a ray needs no scene).
// Nothing is changed in how anything looks: the same materials on the same triangles in the same places.
import * as THREE from 'three/webgpu';

import { PERF } from './perf.js';

export const SHADOW_LAYER = 3; // (= heli.js's: main.js enables it on the sun's shadow camera) every cascade draws it
export const NEAR_LAYER = 4; // per-part proxies and the world's small patches: the first two cascades (look.js)
export const FAR_LAYER = 5; // one rest-pose proxy per model and the world's large patches: the last two
const HIDDEN_LAYER = 31; // (merged originals that carry other nodes: no camera draws it)

/** One depth-only shadow proxy for `meshes` (they stop casting), under `parent`, on `layer`. */
export function shadowProxy(parent, meshes, layer = SHADOW_LAYER) {
  if (!PERF.batch || !meshes.length) return null;
  parent.updateMatrixWorld(true);
  _inv.copy(parent.matrixWorld).invert();
  const side = shadowFaces(meshes[0].material);
  const proxy = new THREE.Mesh(merge(meshes.map((o) => bake(o.geometry, _m.multiplyMatrices(_inv, o.matrixWorld), ['position']))), proxyMaterial(side));
  proxy.name = `${parent.name} shadow`;
  proxy.castShadow = true;
  proxy.layers.set(layer);
  proxy.userData.shadowProxy = true;
  parent.add(proxy);
  for (const o of meshes) o.castShadow = false;
  return proxy;
}

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _c = new THREE.Vector3();

const signature = (geo) =>
  Object.keys(geo.attributes)
    .sort()
    .map((k) => `${k}${geo.attributes[k].itemSize}`)
    .join(',');

/** A float copy of a geometry's attributes (`only`: names to keep) moved by `matrix`, winding kept right. */
function bake(geo, matrix, only = null) {
  const out = new THREE.BufferGeometry();
  const n = geo.attributes.position.count;
  for (const name of Object.keys(geo.attributes)) {
    if (only && !only.includes(name)) continue;
    const a = geo.attributes[name];
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < n; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const idx = new Uint32Array(geo.index ? geo.index.count : n);
  for (let i = 0; i < idx.length; i++) idx[i] = geo.index ? geo.index.getX(i) : i;
  // (only the range a single-material draw would use)
  const dr = geo.drawRange;
  const from = Math.max(0, dr.start);
  const to = Math.min(idx.length, dr.count === Infinity ? idx.length : from + dr.count);
  let index = idx.subarray(from, to);
  out.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    // a mirrored part: flip the winding back and the tangent frame's handedness
    index = index.slice();
    for (let i = 0; i + 2 < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
    const tg = out.attributes.tangent;
    if (tg && tg.itemSize === 4) for (let i = 0; i < tg.count; i++) tg.setW(i, -tg.getW(i));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Concatenates baked geometries (same attributes). */
function merge(list) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  let verts = 0;
  let tris = 0;
  for (const g of list) {
    verts += g.attributes.position.count;
    tris += g.index.count;
  }
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new list[0].attributes[name].array.constructor(verts * size);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = verts > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
  let o = 0;
  let base = 0;
  for (const g of list) {
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) idx[o + i] = src[i] + base;
    o += src.length;
    base += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Tags a baked piece as moving with bone `i` (rigid: weight 1). */
function rigid(geo, i) {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    idx[k * 4] = i;
    w[k * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

const SKINNED = []; // { mesh, model, centre (in the model's frame) }

/**
 * A mesh on `geo`: plain, in `parent`'s frame; or skinned to `skeleton` (geometry in world space) when its pieces
 * move apart. A skinned one hangs from the scene itself, as a character's body does: its bones carry it, and the
 * velocity pass (motion blur, TRAA) then compares like with like (under the moving model, the previous frame's
 * bones met this frame's bind matrix and the whole car smeared at speed).
 */
function placed(parent, geo, material, skeleton, model) {
  let mesh;
  if (skeleton) {
    mesh = new THREE.SkinnedMesh(geo, material);
    let top = model;
    while (top.parent) top = top.parent;
    top.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
    // (culled on the rest pose's sphere grown by a metre, moved with the model every frame (followSkinned): a door
    // or a wheel never goes further; three would otherwise skin every vertex on the CPU once to find it)
    mesh.boundingSphere = geo.boundingSphere.clone();
    mesh.boundingSphere.radius += 1;
    SKINNED.push({ mesh, model, centre: model.worldToLocal(geo.boundingSphere.center.clone()) });
  } else {
    mesh = new THREE.Mesh(geo, material);
    parent.add(mesh);
  }
  return mesh;
}

/** Moves the skinned batches' culling spheres with their models (look.js, once a frame after the matrices). */
export function followSkinned() {
  for (const s of SKINNED) {
    s.mesh.boundingSphere.center.copy(s.centre).applyMatrix4(s.model.matrixWorld);
    let shown = true;
    for (let p = s.model; p; p = p.parent) if (!p.visible) shown = false;
    s.mesh.visible = shown;
  }
}

const proxyMats = {};
const FLIP = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
/** The faces a material's shadow is drawn with (three's rule for PCF maps: shadowSide, else the other side). */
const shadowFaces = (m) => (m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : FLIP[m.side]);
/** The proxies' material: never drawn by a view camera; the shadow pass takes only its shadowSide. */
function proxyMaterial(faces) {
  if (!proxyMats[faces]) {
    proxyMats[faces] = new THREE.MeshBasicNodeMaterial({ colorWrite: false, name: 'shadow proxy' });
    proxyMats[faces].shadowSide = faces;
  }
  return proxyMats[faces];
}

const casts = (o) => o.castShadow && !(o.material && (o.material.transparent || o.material.alphaTest > 0 || o.material.alphaMap));

function visibleIn(o, root) {
  for (let p = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * A vehicle (or any rigid assembly): `anchors` names the nodes that move (doors, wheels, the steering wheel, a
 * seat on its rails...); every mesh is merged with the others of its material under the same nearest anchor
 * (or the model root), and every caster under an anchor goes into that anchor's shadow proxy. `keep(node)`:
 * true leaves that node's whole subtree as it is (casting itself), for parts the game changes per mesh (blades).
 * Returns { draws: [before, after], casters: [before, after] }.
 */
export function batchModel(model, { anchors = [], keep = () => false, far = true, farSkip = () => false, skin = false } = {}) {
  if (!PERF.batch) return null;
  model.updateMatrixWorld(true);
  const isAnchor = new Set(anchors);
  const meshes = [];
  const kept = [];
  const walk = (o, anchor) => {
    if (o !== model && keep(o)) {
      // (left as it is; its casters also go on NEAR_LAYER (the near cascades draw layer 0 only in the first) and
      // into the far proxy)
      o.traverse((k) => {
        if (k.isMesh && k.castShadow) {
          k.layers.enable(NEAR_LAYER);
          if (casts(k) && visibleIn(k, model) && !farSkip(k)) kept.push(k);
        }
      });
      return;
    }
    if (o !== model && isAnchor.has(o.name)) anchor = o;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes.position && !Array.isArray(o.material) && !Object.keys(o.geometry.morphAttributes).length && visibleIn(o, model)) meshes.push({ o, anchor });
    for (const c of o.children) walk(c, anchor);
  };
  walk(model, model);
  let castersBefore = 0;
  model.traverse((o) => o.isMesh && o.castShadow && visibleIn(o, model) && castersBefore++);
  // (skin: every moving node is a bone of one rigid skeleton, so a material's pieces under different nodes are one
  // skinned draw: the car's four tyres, its paint on the body and both doors...)
  let skeleton = null;
  const boneOf = new Map([[model, 0]]);
  if (skin) {
    const bones = [model];
    for (const { anchor } of meshes) if (!boneOf.has(anchor)) boneOf.set(anchor, bones.push(anchor) - 1);
    if (bones.length > 1) skeleton = new THREE.Skeleton(bones);
  }
  // visible meshes: by anchor (all one when skinned), material, attributes and draw state
  const groups = new Map();
  for (const m of meshes) {
    const { o } = m;
    const key = [skeleton ? 'skin' : m.anchor.uuid, o.material.uuid, signature(o.geometry), o.renderOrder, o.receiveShadow, o.frustumCulled, o.layers.mask].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  let made = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const moving = !!skeleton && list.some((m) => m.anchor !== list[0].anchor);
    const anchor = moving ? model : list[0].anchor;
    if (moving) _inv.identity();
    else _inv.copy(anchor.matrixWorld).invert();
    const geo = merge(list.map(({ o, anchor: a }) => {
      const g = bake(o.geometry, _m.multiplyMatrices(_inv, o.matrixWorld));
      return moving ? rigid(g, boneOf.get(a)) : g;
    }));
    const first = list[0].o;
    const mesh = placed(anchor, geo, first.material, moving ? skeleton : null, model);
    mesh.name = `${anchor.name || 'root'}:${first.material.name || 'mat'} (merged ${list.length}${moving ? ', skinned' : ''})`;
    mesh.receiveShadow = first.receiveShadow;
    mesh.castShadow = list.some(({ o }) => o.castShadow);
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    mesh.layers.mask = first.layers.mask;
    mesh.userData.batch = true;
    for (const { o } of list) {
      // (hidden; one carrying other nodes leaves the view's layer instead, so they still draw)
      if (o.children.length) o.layers.set(HIDDEN_LAYER);
      else o.visible = false;
      o.userData.batchedInto = mesh;
    }
    made++;
  }
  // shadow proxies: one per anchor (one skinned for the whole model) and face side
  const proxies = new Map();
  for (const { o, anchor } of meshes) {
    if (!o.visible && !o.userData.batchedInto) continue;
    if (!casts(o)) continue;
    const side = shadowFaces(o.material);
    const key = (skeleton ? 'skin' : anchor.uuid) + '|' + side;
    if (!proxies.has(key)) proxies.set(key, { anchor: skeleton ? model : anchor, side, list: [], owners: [] });
    proxies.get(key).list.push(o);
    proxies.get(key).owners.push(anchor);
  }
  for (const { anchor, side, list, owners } of proxies.values()) {
    if (skeleton) _inv.identity();
    else _inv.copy(anchor.matrixWorld).invert();
    const geo = merge(list.map((o, i) => {
      const g = bake(o.geometry, _m.multiplyMatrices(_inv, o.matrixWorld), ['position']);
      return skeleton ? rigid(g, boneOf.get(owners[i])) : g;
    }));
    const proxy = placed(anchor, geo, proxyMaterial(side), skeleton, model);
    proxy.name = `${anchor.name || 'root'} shadow`;
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.layers.set(NEAR_LAYER);
    proxy.userData.shadowProxy = true;
    for (const o of list) {
      o.castShadow = false;
      if (o.userData.batchedInto) o.userData.batchedInto.castShadow = false;
    }
  }
  // the far cascades: the whole model as it stands now, one proxy per face side (a door or a wheel turning does not
  // show in a shadow 50 m and more from the camera)
  let farProxies = 0;
  if (far) {
    const bySide = new Map();
    for (const list of proxies.values()) for (const o of list.list) {
      if (farSkip(o)) continue;
      const side = shadowFaces(o.material);
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side).push(o);
    }
    for (const o of kept) {
      const side = shadowFaces(o.material);
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side).push(o);
    }
    _inv.copy(model.matrixWorld).invert();
    for (const [side, list] of bySide) {
      const proxy = new THREE.Mesh(merge(list.map((o) => bake(o.geometry, _m.multiplyMatrices(_inv, o.matrixWorld), ['position']))), proxyMaterial(side));
      proxy.name = `${model.name || 'model'} far shadow`;
      proxy.castShadow = true;
      proxy.layers.set(FAR_LAYER);
      proxy.userData.shadowProxy = true;
      model.add(proxy);
      farProxies++;
    }
  }
  let draws = 0;
  let castersAfter = 0;
  model.traverse((o) => {
    if (!o.isMesh || !visibleIn(o, model)) return;
    if (o.layers.isEnabled(0)) draws++;
    if (o.castShadow) castersAfter++;
  });
  return { draws: [meshes.length, draws], casters: [castersBefore, castersAfter], merged: made, proxies: proxies.size, farProxies };
}

/**
 * The world: every mesh tagged `userData.static` (and every InstancedMesh tagged `userData.staticInstances` for its
 * shadow only), under the scene, merged per material into world-frame meshes; their shadows into proxies cut into
 * `cell`-metre patches so a cascade only draws the patches in its box. The merged originals leave the scene.
 */
export function batchWorld(scene, { cell = 80, farCell = 400 } = {}) {
  if (!PERF.batch) return null;
  scene.updateMatrixWorld(true);
  const statics = [];
  const instanced = [];
  scene.traverse((o) => {
    if (o.userData.static && o.isMesh && !o.isInstancedMesh && visibleIn(o, scene)) statics.push(o);
    else if (o.userData.staticInstances && o.isInstancedMesh) instanced.push(o);
  });
  const groups = new Map();
  for (const o of statics) {
    const key = [o.material.uuid, signature(o.geometry), o.renderOrder, o.receiveShadow, o.frustumCulled, o.layers.mask].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  // shadow casters first (from the originals, in world space), per patch and side: small patches for the near
  // cascades, large ones for the far
  const patches = new Map();
  const addCaster = (geo, matrix, material) => {
    _box.copy(geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox)).applyMatrix4(matrix);
    _box.getCenter(_c);
    const side = shadowFaces(material);
    const baked = bake(geo, matrix, ['position']);
    // (a caster bigger than a patch goes into the patch of its centre: the proxy's own bounds cover it)
    for (const [size, layer] of [[cell, NEAR_LAYER], [farCell, FAR_LAYER]]) {
      const key = `${layer === FAR_LAYER ? 'far ' : ''}${Math.floor(_c.x / size)},${Math.floor(_c.z / size)}|${side}`;
      if (!patches.has(key)) patches.set(key, { side, layer, list: [] });
      patches.get(key).list.push(baked);
    }
  };
  for (const o of statics) if (casts(o)) addCaster(o.geometry, o.matrixWorld, o.material);
  for (const o of instanced) {
    if (!casts(o)) continue;
    const im = new THREE.Matrix4();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, im);
      addCaster(o.geometry, _m.multiplyMatrices(o.matrixWorld, im).clone(), o.material);
    }
    o.castShadow = false;
  }
  let made = 0;
  for (const list of groups.values()) {
    if (list.length < 2) {
      if (casts(list[0])) list[0].castShadow = false;
      continue;
    }
    const geo = merge(list.map((o) => bake(o.geometry, o.matrixWorld)));
    const first = list[0];
    const mesh = new THREE.Mesh(geo, first.material);
    mesh.name = `world:${first.material.name || first.material.type} (merged ${list.length})`;
    mesh.receiveShadow = first.receiveShadow;
    mesh.castShadow = false;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    mesh.layers.mask = first.layers.mask;
    mesh.userData.batch = true;
    scene.add(mesh);
    for (const o of list) {
      o.castShadow = false;
      o.userData.batchedInto = mesh;
      if (o.parent) o.parent.remove(o);
    }
    made++;
  }
  for (const [key, { side, layer, list }] of patches) {
    const proxy = new THREE.Mesh(merge(list), proxyMaterial(side));
    proxy.name = `world shadow ${key}`;
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.layers.set(layer);
    proxy.userData.shadowProxy = true;
    scene.add(proxy);
  }
  return { statics: statics.length, merged: made, groups: groups.size, patches: patches.size, instanced: instanced.length };
}
