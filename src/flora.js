// (V8) Grass, trees and bushes, rebuilt for cost and looks (terrain.js owns the ground, the weather and the rest).
//
// What made V7's flora dear (VEHICLE_NOTES / notes/V8_log_entry.md has the numbers): the grass was drawn in the
// depth / normal / velocity pre-pass as well as the lit pass, and on this GPU (Apple, tile-based) that pass was where
// copies of it cost (3 extra copies of the grass: +12 ms a frame with them in both passes, about 0 in the lit pass
// alone); every tuft round the camera was drawn, behind it too; the trees cast in two cascades with their full crowns.
//
// Grass now: clumps of 16 thin opaque blades (5 vertices, 3 triangles each, no alpha test or blending, so the GPU's
// hidden-surface removal works), each blade curved, leaning, its own green or straw colour, the clump turned, sized and
// tinted by its hash and by a slow patchiness over the world. The clumps sit on a 0.42 m world grid in 8 m chunks (each
// chunk's list made once and kept, sorted by the clump's rank); a clump is kept where its rank is under the density at
// its distance: 1 up to D0 (7 m on foot), falling as (D0 / d)^1.5 and to 0 by RMAX (46 m); a clump near its distance
// shrinks into the ground and the remaining far clumps spread wider (no pop, the cover stays even). Only the chunks in
// the view's sector (plus a 6 m circle round the camera) are drawn. The grass is on its own layer (GRASS_LAYER): the
// view's lit pass draws it, the pre-pass, the shadow cascades and the mirrors do not (its pixels take the ground's
// depth, velocity and AO under them). Bent by the wind (a lean with the gusts and a flutter travelling across the
// field), flattened outward under the rotor wash and pushed aside by the car.
//
// Trees: three shapes (a round broadleaf, a tall oval broadleaf, a conifer), each a trunk with boughs and a crown
// broken into 30 to 45 leaf clusters (the conifer: seven jagged skirts), merged per shape and instanced; within 110 m
// the full version, past it a far version of 6 to 8 blobs; nothing behind the camera past 20 m. The shadows come from
// one depth-only proxy per shape (the far version, every tree within 170 m) in the first two cascades. Bushes: one
// shape of nine clusters, instanced. All sway with the wind (the crown more than the trunk, the leaves rustling) and
// lean away from the rotor wash.
import * as THREE from 'three/webgpu';
import {
  uniform, attribute, positionLocal, vec2, vec3, float, sin, cos, mix, smoothstep, time, max, min, length, pow, clamp,
  instancedBufferAttribute, cameraPosition, uv, vertexColor, fract, normalViewGeometry, inverseSqrt, abs,
} from 'three/tsl';
import { NEAR_LAYER } from './batch.js';

export const GRASS_LAYER = 7; // the lit pass only (look.js takes it out of the pre-pass; mirrors.js out of the mirrors)

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const hash = (i, j, k = 0) => {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** A seeded random stream (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------------------------------- grass
const GCELL = 0.36; // m between clump sites
const CHUNK = 8; // m: a chunk's side
const PER = Math.round(CHUNK / GCELL); // sites per chunk side
const MAX_CLUMPS = 9000;
const BLADES = 20;

/** One clump: BLADES blades in a 0.36 m tuft, curved and leaning, root dark, tip green or straw (vertex colours). */
function clumpGeometry() {
  const R = rng(91);
  const pos = [];
  const col = [];
  const nrm = [];
  const uvs = [];
  const idx = [];
  for (let b = 0; b < BLADES; b++) {
    const a = R() * Math.PI * 2;
    const r0 = Math.sqrt(R()) * 0.26;
    const ox = Math.cos(a) * r0;
    const oz = Math.sin(a) * r0;
    // leaning outward from the tuft's middle, more for the outer blades, a little random
    const la = a + (R() - 0.5) * 1.2;
    const lean = 0.04 + r0 * 0.6 + R() * 0.12;
    const H = 0.22 + R() * 0.32;
    const W = 0.011 + R() * 0.009;
    const face = R() * Math.PI; // the blade's flat side
    const px = Math.cos(face) * W;
    const pz = Math.sin(face) * W;
    const lx = Math.cos(la) * lean;
    const lz = Math.sin(la) * lean;
    const at = (t) => [ox + lx * t * t, H * t, oz + lz * t * t];
    const b0 = at(0);
    const m = at(0.55);
    const tip = at(1);
    const k = pos.length / 3;
    pos.push(b0[0] + px, 0, b0[2] + pz, b0[0] - px, 0, b0[2] - pz);
    pos.push(m[0] + px * 0.7, m[1], m[2] + pz * 0.7, m[0] - px * 0.7, m[1], m[2] - pz * 0.7);
    pos.push(tip[0], tip[1], tip[2]);
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2, k + 2, k + 3, k + 4);
    // colour: a dark root, the blade green, yellow-green or straw toward the tip (one in four dry)
    const dry = R() < 0.25;
    const g = R();
    const tipC = dry ? [0.5 + g * 0.12, 0.45 + g * 0.08, 0.22] : [0.2 + g * 0.16, 0.33 + g * 0.12, 0.08 + g * 0.05];
    const midC = dry ? [0.36, 0.33, 0.15] : [0.13 + g * 0.06, 0.22 + g * 0.06, 0.06];
    const rootC = [0.07, 0.09, 0.035];
    col.push(...rootC, ...rootC, ...midC, ...midC, ...tipC);
    // normal: the blade's face normal bent well toward the sky (thin leaves lit from above, no black backs)
    const fn = new THREE.Vector3(-pz, 0, px).normalize().multiplyScalar(0.45).add(new THREE.Vector3(lx, 0, lz).multiplyScalar(0.8)).add(_up).normalize();
    for (let i = 0; i < 5; i++) nrm.push(fn.x, fn.y, fn.z);
    uvs.push(0, 0, 1, 0, 0, 0.55, 1, 0.55, 0.5, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

/** Bare patches (0 lush .. 1 bare), slow over the world, cheap. */
export const bareAt = (x, z) => {
  const a = Math.sin(x * 0.043 + 1.1) * Math.cos(z * 0.037 - 0.6);
  const b = Math.sin((x - z) * 0.11 + 0.3) * 0.5;
  const c = Math.sin(x * 0.29 + z * 0.23) * 0.25;
  return Math.min(1, Math.max(0, 0.2 + 0.45 * a + 0.3 * b + 0.2 * c));
};

export class Grass {
  /**
   * `deps`: { fieldAt, terrainAt, wind (WEATHER.u), wash: {pos, k}, car: {pos, v} } (terrain.js's).
   */
  constructor(group, deps) {
    this.deps = deps;
    this.D0 = uniform(7);
    this.RMAX = uniform(46);
    this.EXP = 1.5;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.cache = new Map();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    const ip = instancedBufferAttribute(this.pos);
    const base = ip.xyz;
    const r = ip.w;
    const t = uv().y; // 0 root .. 1 tip
    // the density at the clump's distance (the same as fill()'s), the clump's own visibility and spread
    const d = length(base.xz.sub(cameraPosition.xz));
    const dens = min(float(1), pow(this.D0.div(max(d, 0.5)), float(this.EXP))).mul(float(1).sub(smoothstep(this.RMAX.mul(0.72), this.RMAX, d)));
    const vis = clamp(dens.sub(r).div(0.1), 0, 1);
    const spread = clamp(inverseSqrt(max(dens, 0.02)).mul(0.8), 1, 3.2);
    // the clump: turned, sized (0.7 .. 1.3 high, lusher where the ground is), shrunk into the ground as it fades
    const ang = r.mul(628.3);
    const ca = cos(ang);
    const sa = sin(ang);
    const hs = fract(r.mul(91.7)).mul(0.6).add(0.7).mul(vis);
    const ws = spread.mul(mix(float(0.35), float(1), vis));
    const p = positionLocal;
    const local = vec3(p.x.mul(ca).sub(p.z.mul(sa)).mul(ws), p.y.mul(hs), p.x.mul(sa).add(p.z.mul(ca)).mul(ws));
    // the bend: the wind's lean with the gusts and a flutter that runs across the field, the wash, the car
    const wnd = deps.wind;
    // (a wave that runs downwind: the phase falls along the wind's direction)
    const along = base.x.mul(wnd.x).add(base.z.mul(wnd.y)).div(length(vec2(wnd.x, wnd.y)).add(0.5));
    const flutter = sin(time.mul(2.7).sub(along.mul(0.35)).add(r.mul(3))).mul(0.45).add(0.75);
    const windPush = vec3(wnd.x, 0, wnd.y).mul(0.05).mul(flutter);
    const dw = base.sub(deps.wash.pos);
    const rw = length(dw.xz).add(0.5);
    const washShake = sin(time.mul(17).add(r.mul(40))).mul(0.25).add(1);
    const washPush = vec3(dw.x, 0, dw.z).div(rw).mul(deps.wash.k.mul(1.9).mul(washShake).div(rw.div(9).mul(rw.div(9)).add(1)));
    // the car: the blades within its footprint (a 4.6 m segment along its heading, 1.0 m half width, fading out by
    // 2.3 m) pushed out sideways from its centre line and forward with its motion, by its speed
    const cdir = deps.car.dir;
    const dc = base.sub(deps.car.pos);
    const onAxis = dc.x.mul(cdir.x).add(dc.z.mul(cdir.z)).toVar();
    const alongC = onAxis.clamp(-2.3, 2.3);
    const side = vec3(dc.x.sub(cdir.x.mul(alongC)), 0, dc.z.sub(cdir.z.mul(alongC))).toVar();
    const rc = length(side.xz).add(0.15);
    const near = smoothstep(2.3, 0.9, rc);
    const carPush = side.div(rc).add(vec3(cdir.x, 0, cdir.z).mul(0.6)).mul(near).mul(deps.car.v.x.mul(0.09).add(0.35).min(1.2)).mul(deps.car.v.y);
    const push = windPush.add(washPush).add(carPush);
    // the blade bends over toward the push, keeping its length: each point turned about the root by an angle that
    // grows toward the tip (theta x t), theta from the push (1.2 rad per unit, at most 1.4 rad: laid nearly flat)
    const pl = length(push.xz);
    const dir = push.div(max(pl, 1e-4));
    const a = min(pl.mul(1.2), 1.4).mul(t);
    const y = local.y;
    mat.positionNode = base.add(vec3(local.x, 0, local.z)).add(dir.mul(y.mul(sin(a)))).add(vec3(0, y.mul(cos(a)), 0));
    // the clump's tint: drier where the ground is bare-ish and in one clump in five, a little hue per clump
    const dryK = fract(r.mul(37.13)).mul(0.6).add(smoothstep(0.4, 0.9, sin(base.x.mul(0.043).add(1.1)).mul(cos(base.z.mul(0.037).sub(0.6))).mul(0.45).add(0.35))).clamp(0, 1);
    const tint = mix(vec3(0.92, 1.06, 0.86), vec3(1.25, 1.08, 0.8), dryK).mul(fract(r.mul(13.7)).mul(0.25).add(0.88));
    mat.colorNode = vertexColor().mul(tint);
    // (light through the blades toward their tips: the sun's colour, set with the time of day by terrain.light)
    this.glow = uniform(new THREE.Color(0, 0, 0));
    mat.emissiveNode = vertexColor().mul(tint).mul(this.glow).mul(t.mul(0.4));
    mat.normalNode = normalViewGeometry; // (not flipped on the back: both faces lit from above)
    const im = new THREE.InstancedMesh(clumpGeometry(), mat, MAX_CLUMPS);
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = true;
    im.layers.set(GRASS_LAYER);
    im.name = 'grass';
    this.mesh = im;
    group.add(im);
    this._at = new THREE.Vector3(1e9, 0, 0);
    this._dir = new THREE.Vector3(0, 0, 1);
    this._fov = 0;
    this.fills = 0;
    this.terrainOn = null;
  }

  /** The density at d (m), as the shader has it. */
  dens(d) {
    const D0 = this.D0.value;
    const R = this.RMAX.value;
    const s = Math.min(1, Math.max(0, (d - R * 0.72) / (R * 0.28)));
    return Math.min(1, Math.pow(D0 / Math.max(d, 0.5), this.EXP)) * (1 - s * s * (3 - 2 * s));
  }

  /** A chunk's clump sites (x, y, z, rank), sorted by rank; made once. */
  chunk(ci, cj, terrainOn) {
    const key = ci * 100003 + cj;
    let c = this.cache.get(key);
    if (c) return c;
    const { fieldAt, terrainAt } = this.deps;
    const out = [];
    for (let j = 0; j < PER; j++) {
      for (let i = 0; i < PER; i++) {
        const gi = ci * PER + i;
        const gj = cj * PER + j;
        const x = (gi + 0.15 + hash(gi, gj, 4) * 0.7) * GCELL;
        const z = (gj + 0.15 + hash(gi, gj, 5) * 0.7) * GCELL;
        const f = fieldAt(x, z);
        if (f < 2.2) continue; // (not on or at the edge of the paving)
        // bare patches thin the cover (and nearer the paving it thins too)
        const keep = (1 - 0.85 * bareAt(x, z)) * Math.min(1, (f - 2.2) / 4 + 0.35);
        if (hash(gi, gj, 6) > keep) continue;
        out.push([x, (terrainOn ? terrainAt(x, z) : 0) - 0.03, z, hash(gi, gj, 3)]);
      }
    }
    out.sort((a, b) => a[3] - b[3]);
    c = new Float32Array(out.length * 4);
    out.forEach((v, k) => c.set(v, k * 4));
    if (this.cache.size > 900) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  /**
   * Refills the drawn clumps round the camera when it has moved 1 m, turned 5 degrees or zoomed: the chunks within
   * RMAX in the view's sector (and within 6 m whatever the direction), each chunk's clumps whose rank is under the
   * density at the chunk's nearest point.
   */
  update(camera, terrainOn, force = false) {
    const p = camera.position;
    if (terrainOn !== this.terrainOn) {
      // (one cache per ground: flat or rolling)
      this.caches = this.caches || new Map();
      if (!this.caches.has(terrainOn)) this.caches.set(terrainOn, new Map());
      this.cache = this.caches.get(terrainOn);
      this.terrainOn = terrainOn;
      force = true;
    }
    camera.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
    _v.normalize();
    const moved = Math.hypot(p.x - this._at.x, p.z - this._at.z);
    if (!force && moved < 1 && _v.dot(this._dir) > Math.cos((5 * Math.PI) / 180) && camera.fov === this._fov) return false;
    this._at.copy(p);
    this._dir.copy(_v);
    this._fov = camera.fov;
    const R = this.RMAX.value;
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (camera.aspect || 1.33));
    const cosLimit = halfH + THREE.MathUtils.degToRad(14);
    const arr = this.pos.array;
    let n = 0;
    const c0 = Math.floor((p.x - R) / CHUNK);
    const c1 = Math.floor((p.x + R) / CHUNK);
    const r0 = Math.floor((p.z - R) / CHUNK);
    const r1 = Math.floor((p.z + R) / CHUNK);
    for (let cj = r0; cj <= r1; cj++) {
      for (let ci = c0; ci <= c1; ci++) {
        const x0 = ci * CHUNK;
        const z0 = cj * CHUNK;
        const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK));
        const dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK));
        const dmin = Math.hypot(dx, dz);
        if (dmin > R) continue;
        if (dmin > 6) {
          // in the view's sector? (the chunk's centre's bearing, widened by the chunk's own angular half-width)
          const cx = x0 + CHUNK / 2 - p.x;
          const cz = z0 + CHUNK / 2 - p.z;
          const dc = Math.hypot(cx, cz);
          const ang = Math.acos(Math.max(-1, Math.min(1, (cx * _v.x + cz * _v.z) / dc)));
          if (ang > cosLimit + Math.asin(Math.min(1, (CHUNK * 0.75) / dc))) continue;
        }
        const k = this.dens(dmin);
        if (k <= 0) continue;
        const c = this.chunk(ci, cj, terrainOn);
        // (sorted by rank: the kept clumps are a prefix)
        let m = 0;
        const cnt = c.length / 4;
        while (m < cnt && c[m * 4 + 3] < k) m++;
        m = Math.min(m, MAX_CLUMPS - n);
        if (m <= 0) continue;
        arr.set(c.subarray(0, m * 4), n * 4);
        n += m;
      }
    }
    this.mesh.count = n;
    this.pos.needsUpdate = true;
    this.fills++;
    return true;
  }
}

// --------------------------------------------------------------------------------------------------- trees
/** Merges geometries (position, normal, color) into one indexed geometry. */
function merge(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, ov * 3);
    nrm.set(g.attributes.normal.array, ov * 3);
    col.set(g.attributes.color.array, ov * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi++] = g.index.array[i] + ov;
    else for (let i = 0; i < c; i++) idx[oi++] = i + ov;
    ov += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function colorAll(g, f) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const rgb = f(p.getX(i), p.getY(i), p.getZ(i), i);
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** A limb from a to b (radii ra, rb), `sides` around, bark coloured. */
function limb(a, b, ra, rb, sides, bark) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rb, ra, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, _v.copy(b).sub(a).normalize());
  g.applyQuaternion(_q);
  g.translate(a.x, a.y, a.z);
  return colorAll(g, (x, y, z) => {
    const k = 0.85 + 0.3 * Math.sin(x * 9.1 + y * 5.3 + z * 7.7);
    return [bark[0] * k, bark[1] * k, bark[2] * k];
  });
}

/**
 * A leaf cluster: a lumpy blob (icosahedron, `detail`) of radius r at c, its normals turned toward the crown's outside
 * (from `centre`), coloured `leaf` lighter on top and outside, darker underneath.
 */
function cluster(c, r, centre, leaf, R, detail = 0, squash = 0.8) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const seed = R() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 5.1 / r + seed) * Math.cos(z * 4.3 / r - seed) + 0.12 * Math.sin(y * 7.3 / r + seed * 2);
    p.setXYZ(i, c.x + x * k, c.y + y * k * squash, c.z + z * k);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const tint = 0.82 + R() * 0.36;
  const hue = (R() - 0.5) * 0.08;
  for (let i = 0; i < n.count; i++) {
    _v.set(p.getX(i) - centre.x, (p.getY(i) - centre.y) * 0.7, p.getZ(i) - centre.z).normalize();
    _s.set(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(0.45).addScaledVector(_v, 0.55).normalize();
    n.setXYZ(i, _s.x, _s.y, _s.z);
  }
  return colorAll(g, (x, y, z, i) => {
    const up = n.getY(i);
    const k = tint * (0.72 + 0.38 * Math.max(0, up) + 0.12 * Math.min(0, up));
    return [leaf[0] * k * (1 + hue * 2), leaf[1] * k, leaf[2] * k * (1 - hue)];
  });
}

/**
 * A leafy spray: a dark core blob (0.55 r) and `n` leaves (small double-sided diamonds, 0.3 to 0.45 r long) set on the
 * spray's sphere at random tilts: a broken outline with light and sky between the leaves. Normals point out of the
 * crown (from `centre`), colours vary per leaf, lighter on top and outside.
 */
function leafy(c, r, centre, leaf, R, n = 14) {
  const core = cluster(c, r * 0.6, centre, [leaf[0] * 0.62, leaf[1] * 0.62, leaf[2] * 0.62], R, 0, 0.85);
  const pos = [];
  const nrm = [];
  const col = [];
  const out = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const u = R() * 2 - 1;
    const th = R() * Math.PI * 2;
    const sr = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(Math.cos(th) * sr, u * 0.8 + 0.15, Math.sin(th) * sr).normalize();
    const at = c.clone().addScaledVector(dir, r * (0.55 + R() * 0.45));
    // the leaf's plane: across the outward direction, turned at random
    t1.set(-dir.z, 0, dir.x);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    t2.crossVectors(dir, t1).normalize();
    const a = R() * Math.PI;
    const L = r * (0.3 + R() * 0.15);
    const W = L * 0.55;
    const ax = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).multiplyScalar(L);
    const ay = t1.clone().multiplyScalar(-Math.sin(a)).addScaledVector(t2, Math.cos(a)).multiplyScalar(W);
    // tilt the leaf a little out of the sphere's tangent plane (droop)
    ax.y -= L * 0.25;
    const p0 = at.clone().sub(ax);
    const p1 = at.clone().add(ay);
    const p2 = at.clone().add(ax);
    const p3 = at.clone().sub(ay);
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    out.copy(at).sub(centre);
    out.y *= 0.7;
    out.normalize().multiplyScalar(0.7).addScaledVector(dir, 0.3).normalize();
    const up = out.y;
    const tint = (0.78 + R() * 0.42) * (0.78 + 0.32 * Math.max(0, up));
    const yellow = R() < 0.15 ? 1.25 : 1;
    for (let i = 0; i < 6; i++) {
      nrm.push(out.x, out.y, out.z);
      col.push(leaf[0] * tint * yellow, leaf[1] * tint, leaf[2] * tint);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merge([core, g]);
}

/** A broadleaf: `tall` 0 (round, spreading) .. 1 (tall oval). Returns { near, far, height }. */
function broadleaf(seed, tall) {
  const R = rng(seed);
  const bark = [0.2, 0.15, 0.1];
  const leaf = tall ? [0.1, 0.17, 0.045] : [0.12, 0.18, 0.05];
  const H = tall ? 10 : 8.2;
  const trunkH = tall ? 3.0 : 2.6;
  const crownC = new THREE.Vector3(0, tall ? 6.2 : 5.3, 0);
  const rad = tall ? new THREE.Vector3(2.0, 3.6, 2.0) : new THREE.Vector3(3.3, 2.5, 3.3);
  const near = [];
  const far = [];
  // the trunk, a slight bend, rooted 0.3 m into the ground
  const t0 = new THREE.Vector3(0, -0.3, 0);
  const t1 = new THREE.Vector3(0.1, trunkH * 0.55, 0.05);
  const t2 = new THREE.Vector3(-0.05, trunkH + 1.2, 0.08);
  near.push(limb(t0, t1, 0.3, 0.22, 8, bark), limb(t1, t2, 0.22, 0.12, 7, bark));
  far.push(limb(t0, t2, 0.28, 0.12, 5, bark));
  // boughs: from the trunk's top half outward and up, ends inside the crown's shell
  const ends = [];
  const nb = tall ? 5 : 6;
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * Math.PI * 2 + R() * 0.8;
    const from = new THREE.Vector3(0, trunkH * (0.75 + R() * 0.35), 0);
    const to = new THREE.Vector3(Math.cos(a) * rad.x * 0.7, crownC.y + (R() - 0.3) * rad.y * 0.6, Math.sin(a) * rad.z * 0.7);
    near.push(limb(from, to, 0.11, 0.05, 5, bark));
    ends.push(to);
    // a twig off each bough
    const mid = from.clone().lerp(to, 0.6);
    const tw = mid.clone().add(new THREE.Vector3(Math.cos(a + 0.9) * 0.9, 0.8, Math.sin(a + 0.9) * 0.9));
    near.push(limb(mid, tw, 0.05, 0.025, 4, bark));
    ends.push(tw);
  }
  // the crown: clusters round the bough ends and over the shell, gaps left (a broken outline, light through it)
  const pts = [];
  for (const e of ends) for (let k = 0; k < 3; k++) pts.push([e.clone().add(new THREE.Vector3((R() - 0.5) * 1.3, (R() - 0.2) * 1.0, (R() - 0.5) * 1.3)), 0.55 + R() * 0.4]);
  const shell = tall ? 22 : 26;
  for (let k = 0; k < shell; k++) {
    const u = R() * 2 - 1;
    const th = R() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const rr = 0.6 + R() * 0.4;
    const p = new THREE.Vector3(Math.cos(th) * s * rad.x * rr, u * rad.y * rr, Math.sin(th) * s * rad.z * rr).add(crownC);
    if (p.y < trunkH + 0.6) continue;
    pts.push([p, 0.6 + R() * 0.5]);
  }
  for (const [p, r] of pts) near.push(leafy(p, r * 1.15, crownC, leaf, R));
  // the far version: seven blobs over the crown's mass
  const Rf = rng(seed + 7);
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI * 2;
    const p = k === 6 ? crownC.clone().add(new THREE.Vector3(0, rad.y * 0.35, 0)) : crownC.clone().add(new THREE.Vector3(Math.cos(a) * rad.x * 0.5, (Rf() - 0.5) * rad.y * 0.6, Math.sin(a) * rad.z * 0.5));
    far.push(cluster(p, Math.min(rad.x, rad.y) * 0.62, crownC, leaf, Rf, 0, 0.9));
  }
  return { near: merge(near), far: merge(far), height: H };
}

/**
 * A conifer: a straight trunk and eight whorls of drooping branches (each branch a narrowing double-sided strip of
 * needles, three segments, its tip turned up), over a dark inner cone for density; the whorls narrow to a spire.
 */
function conifer(seed) {
  const R = rng(seed);
  const bark = [0.17, 0.12, 0.08];
  const leaf = [0.07, 0.14, 0.06];
  const H = 11;
  const near = [limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H * 0.97, 0), 0.26, 0.04, 7, bark)];
  const far = [limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H * 0.4, 0), 0.24, 0.12, 5, bark)];
  // the dark inner cone
  const inner = new THREE.ConeGeometry(1.15, H - 2.6, 9, 1, true).translate(0, 2.2 + (H - 2.6) / 2, 0);
  colorAll(inner, () => [leaf[0] * 0.55, leaf[1] * 0.55, leaf[2] * 0.55]);
  near.push(inner);
  const pos = [];
  const nrm = [];
  const col = [];
  const tiers = 8;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const y = 1.7 + f * (H - 2.6);
    const len = 3.3 * (1 - f) + 0.6;
    const nb = Math.max(6, Math.round(13 - f * 6));
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + k * 0.7 + R() * 0.4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const px = -dz;
      const pz = dx;
      const L = len * (0.8 + R() * 0.35);
      const droop = 0.35 + R() * 0.25;
      const pts = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const w = (0.42 * (1 - t) + 0.08) * (0.7 + 0.5 * (1 - f));
        const yy = y - droop * L * t * (1 - t * 0.6) + (t > 0.85 ? 0.1 : 0);
        pts.push([dx * L * t, yy, dz * L * t, w]);
      }
      const tint = 0.8 + R() * 0.4;
      for (let i = 0; i < 3; i++) {
        const [x0, y0, z0, w0] = pts[i];
        const [x1, y1, z1, w1] = pts[i + 1];
        const v = [[x0 + px * w0, y0, z0 + pz * w0], [x0 - px * w0, y0, z0 - pz * w0], [x1 + px * w1, y1, z1 + pz * w1], [x1 - px * w1, y1, z1 - pz * w1]];
        for (const q of [v[0], v[1], v[2], v[1], v[3], v[2]]) pos.push(...q);
        const lift = 0.55 + 0.45 * (i / 2);
        for (let j = 0; j < 6; j++) {
          _s.set(dx * 0.6, 0.8, dz * 0.6).normalize();
          nrm.push(_s.x, _s.y, _s.z);
          col.push(leaf[0] * tint * lift * (1 + f * 0.3), leaf[1] * tint * lift * (1 + f * 0.3), leaf[2] * tint * lift);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  near.push(g);
  // far: one jagged cone
  const fc = new THREE.ConeGeometry(3.0, H - 1.3, 8, 3, false).translate(0, 1.3 + (H - 1.3) / 2, 0);
  const fp = fc.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const yy = fp.getY(i);
    const ring = Math.abs(((yy - 1.3) / (H - 1.3)) * 3 - Math.round(((yy - 1.3) / (H - 1.3)) * 3)) < 0.01;
    if (ring && yy < H - 0.5) {
      fp.setX(i, fp.getX(i) * 1.25);
      fp.setZ(i, fp.getZ(i) * 1.25);
      fp.setY(i, yy - 0.5);
    }
  }
  fc.computeVertexNormals();
  colorAll(fc, (x, y) => {
    const kk = 0.6 + 0.35 * (y / H);
    return [leaf[0] * kk, leaf[1] * kk, leaf[2] * kk];
  });
  far.push(fc);
  return { near: merge(near), far: merge(far), height: H };
}

function bush(seed) {
  const R = rng(seed);
  const leaf = [0.12, 0.16, 0.05];
  const parts = [];
  const c = new THREE.Vector3(0, 0.55, 0);
  for (let k = 0; k < 9; k++) {
    const a = R() * Math.PI * 2;
    const rr = R() * 0.75;
    parts.push(leafy(new THREE.Vector3(Math.cos(a) * rr, 0.35 + R() * 0.5, Math.sin(a) * rr), 0.42 + R() * 0.3, c, leaf, R, 10));
  }
  return merge(parts);
}

/**
 * The sway (TSL position node for an instanced mesh whose positionLocal is already in the world): the top moves most
 * ((y / height)^2), a slow lean with the wind's gusts and a faster flutter per instance, the leaves rustling by their
 * own position, and a lean away from the rotor wash.
 */
function swayNode(inst, height, amp, deps) {
  const iv = instancedBufferAttribute(inst, 'vec2');
  const ph = iv.x;
  const wnd = deps.wind;
  const y = max(attribute('position', 'vec3').y, 0);
  const h = y.div(height);
  const k = h.mul(h).mul(amp);
  const gust = sin(time.mul(0.9).add(ph.mul(6.28))).mul(0.3).add(sin(time.mul(2.3).add(ph.mul(11))).mul(0.12)).add(1);
  const lean = vec3(wnd.x, 0, wnd.y).mul(0.07).mul(gust);
  const p = positionLocal;
  const rustle = sin(time.mul(7.3).add(p.x.mul(2.1)).add(p.z.mul(1.7)).add(p.y.mul(1.3))).mul(wnd.z.mul(0.04).add(0.006)).mul(h);
  const dw = p.sub(deps.wash.pos);
  const rw = length(dw.xz).add(1);
  const wash = vec3(dw.x, 0, dw.z).div(rw).mul(deps.wash.k.mul(1.1).div(rw.div(10).mul(rw.div(10)).add(1)));
  const moved = p.add(lean.add(wash).mul(k)).add(vec3(rustle, rustle.mul(0.5), rustle.negate()));
  // (the merged shapes: a vertex of another shape than the instance's collapses onto the instance's root, a
  // degenerate triangle the rasteriser drops)
  const keep = float(1).sub(smoothstep(0.25, 0.5, abs(attribute('shape', 'float').sub(iv.y))));
  return mix(vec3(0, -1000, 0), moved, keep);
}

/** The three shapes' versions merged into one geometry, with a per-vertex `shape` (0, 1, 2). */
function mergeShapes(list) {
  const g = merge(list);
  const shape = new Float32Array(g.attributes.position.count);
  let o = 0;
  list.forEach((x, i) => {
    shape.fill(i, o, o + x.attributes.position.count);
    o += x.attributes.position.count;
  });
  g.setAttribute('shape', new THREE.BufferAttribute(shape, 1));
  return g;
}

const NEAR_D = 110; // m: the full trees within this
const SHADOW_D = 170; // m: the shadow proxies' trees

export class Trees {
  /** `trees`: [[x, z, r]] (r 0..1: the hash), `bushes` the same; `deps` as Grass's plus groundY(x, z). */
  constructor(group, trees, bushes, deps) {
    this.deps = deps;
    this.group = group;
    const shapes = [broadleaf(11, 0), broadleaf(23, 1), conifer(37)];
    this.shapes = shapes;
    // shape by hash: round 45 %, tall 25 %, conifer 30 %
    this.items = trees.map(([x, z, r]) => {
      const s = r < 0.45 ? 0 : r < 0.7 ? 1 : 2;
      const sc = 0.75 + ((r * 7.31) % 1) * 0.55;
      return { x, z, r, s, sc, y: deps.groundY(x, z) - 0.05 };
    });
    // (the bushes are shape 3 of the far and shadow versions: no draws of their own)
    this.bushItems = bushes.map(([x, z, r]) => ({ x, z, r, s: 3, sc: 0.6 + r * 0.8, y: deps.groundY(x, z) - 0.05 }));
    // ((V8) one draw per version: the three shapes merged, each instance picking its own; was one per shape and
    // version, 22 draws a frame for the trees, now 10)
    const mk = (geo, n, height, amp, { shadow = false } = {}) => {
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 2), 2);
      inst.setUsage(THREE.DynamicDrawUsage);
      if (!geo.attributes.shape) geo.setAttribute('shape', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
      const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
      mat.normalNode = normalViewGeometry; // (leaves lit by their crown-outward normals on both faces)
      mat.positionNode = swayNode(inst, height, amp, deps);
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      im.userData.inst = inst;
      if (shadow) {
        // depth-only caster on the near cascades' layer (no camera draws it)
        im.layers.set(NEAR_LAYER);
        im.castShadow = true;
        im.receiveShadow = false;
      } else {
        im.layers.set(deps.layer);
        im.castShadow = false;
        im.receiveShadow = true;
      }
      group.add(im);
      return im;
    };
    const n = this.items.length;
    const nb = this.bushItems.length;
    const bushGeo = bush(51);
    this.nearIM = mk(mergeShapes(shapes.map((s) => s.near)), n, 10, 1.0);
    this.farIM = mk(mergeShapes([...shapes.map((s) => s.far), bushGeo]), n + nb, 10, 1.0);
    this.shadowIM = mk(mergeShapes([...shapes.map((s) => s.far), bushGeo]), n + nb, 10, 1.0, { shadow: true });
    this.nearIM.name = 'trees near';
    this.farIM.name = 'trees far and bushes';
    this.shadowIM.name = 'trees and bushes shadow';
    this.bushIM = this.farIM;
    this._at = new THREE.Vector3(1e9, 0, 0);
    this._dir = new THREE.Vector3();
    this._vis = true;
    this.fills = 0;
    this.tris = shapes.map((s) => [s.near.index.count / 3, s.far.index.count / 3]);
  }

  _put(im, n, it) {
    _q.setFromAxisAngle(_up, it.r * 6.28);
    _s.set(it.sc, it.sc * (0.88 + ((it.r * 3.7) % 1) * 0.24), it.sc);
    im.setMatrixAt(n, _m.compose(_v.set(it.x, it.y, it.z), _q, _s));
    im.userData.inst.array[n * 2] = it.r;
    im.userData.inst.array[n * 2 + 1] = it.s;
  }

  /** Re-sorts the trees into near / far / none and the shadow casters, when the camera has moved 6 m or turned 10 deg. */
  update(camera, force = false) {
    const p = camera.position;
    const dir = _v.set(0, 0, 0);
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    if (!force && Math.hypot(p.x - this._at.x, p.z - this._at.z) < 6 && dir.dot(this._dir) > Math.cos((10 * Math.PI) / 180) && camera.fov === this._fov) return false;
    this._at.copy(p);
    this._dir.copy(dir);
    this._fov = camera.fov;
    const dx0 = dir.x;
    const dz0 = dir.z;
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (camera.aspect || 1.33)) + THREE.MathUtils.degToRad(28);
    const cosH = Math.cos(Math.min(Math.PI, halfH));
    let nn = 0;
    let nf = 0;
    let ns = 0;
    const hgt = Math.max(0, p.y);
    for (const it of this.items) {
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < SHADOW_D) this._put(this.shadowIM, ns++, it);
      // in view? (the bearing within the half angle plus a margin; anything within 20 m is kept)
      if (d > 20 && (dx * dx0 + dz * dz0) / d < cosH) continue;
      if (Math.hypot(d, hgt) < NEAR_D) this._put(this.nearIM, nn++, it);
      else this._put(this.farIM, nf++, it);
    }
    let nb = 0;
    for (const it of this.bushItems) {
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 60) this._put(this.shadowIM, ns++, it);
      if (d > 20 && (dx * dx0 + dz * dz0) / d < cosH) continue;
      this._put(this.farIM, nf++, it);
      nb++;
    }
    for (const [im, c] of [[this.nearIM, nn], [this.farIM, nf], [this.shadowIM, ns]]) {
      im.count = c;
      im.visible = this._vis && c > 0;
      im.instanceMatrix.needsUpdate = true;
      im.userData.inst.needsUpdate = true;
    }
    this.fills++;
    this.counts = { near: nn, far: nf, shadow: ns, bushes: nb };
    return true;
  }

  set visible(v) {
    this._vis = v;
    for (const m of [this.nearIM, this.farIM, this.shadowIM]) m.visible = v && m.count > 0;
  }
}
