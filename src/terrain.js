// (V7) The world round the track, all procedural: ground that rises and falls off the paving (the car's suspension,
// the helicopter's skids and the feet on foot all touch it through groundAt), grass and scrub near the camera that the
// rotor wash, the car and the wind move, trees and bushes with wind sway, hills on the horizon, clouds with depth,
// runway and track furniture (edge lights, marker boards, tyre walls, a wind sock), the weather (a steady wind with
// gusts, for the flight model, the smoke and dust, the sock, the grass and the trees) and the light set by the time of
// day (look.js setTime).
//
// The ground: h(x, z) = w(x, z) * f(x, z): f a sum of four long swells and one short ripple (0 to about 2.4 m, never
// below the paving's level), w = 0 within 18 m of any paving (the yard and apron, the track and its kerbs, the skidpad,
// the road) or of anything the car can hit (buildings, barriers), rising to 1 by 70 m; the heights are made once at load on a 12.5 m grid over +-1600 m and
// read bilinearly by the physics (the mesh's own vertices: what is drawn is what is touched), so the paved and built parts of the world stay
// exactly as flat as before (V1 to V6 scenarios and the yard unchanged), and the ground starts to roll out beyond them.
// ?perf=-terrain (or demo.perf.terrain = false) puts back the flat plane.
import * as THREE from 'three/webgpu';
import { uniform, attribute, positionLocal, positionWorld, vec3, float, sin, cos, mix, smoothstep, time, max, length, instancedBufferAttribute } from 'three/tsl';
import { PERF } from './perf.js';
import { APRON, SKIDPAD, HELIPAD, nearTrack, LINE, TRACK_WIDTH, KERB_WIDTH, CAR_OBSTACLES } from './track.js';
import { SpriteCloud } from './cloud.js';
import { Grass, Trees, GRASS_LAYER } from './flora.js';
export { GRASS_LAYER };

const EXTENT = 1600; // m: the rolling ground's half width
// (V7) the world's detail (grass, trees, bushes, hills, clouds) is on its own layer: the view camera draws it (main.js
// enables it), the mirrors' camera does not (mirrors.js): a mirror shows the ground, the buildings and the vehicles
export const DETAIL_LAYER = 6;
const CELL = 12.5;
const N = (2 * EXTENT) / CELL + 1;
let DIST = null; // Float32Array N*N: m to the nearest paving or obstacle (capped 60)
let HEIGHT = null; // Float32Array N*N: the ground's rise at the grid's nodes (w x swell): the mesh's vertices and the physics

/** The long swells: 0 .. about 2.4 m (wavelengths 200 m and more: the 12.5 m grid follows them to a few mm). */
function swell(x, z) {
  const a = Math.sin(x * 0.0105 + 1.3) * Math.cos(z * 0.0083 - 0.4);
  const b = Math.sin((x + z) * 0.0061 + 2.1);
  const c = Math.sin(x * 0.023 - z * 0.017 + 0.7);
  const d = Math.cos(z * 0.031 + x * 0.007);
  return 1.15 + 0.55 * a + 0.4 * b + 0.25 * c + 0.18 * d;
}

/** Distance from (x, z) to the paving and the obstacles, exact (used to fill the grid). */
function pavedDistance(x, z) {
  let d = 60;
  // the yard's apron (a rectangle)
  const ax = Math.max(APRON.x0 - x, 0, x - APRON.x1);
  const az = Math.max(APRON.z0 - z, 0, z - APRON.z1);
  d = Math.min(d, Math.hypot(ax, az));
  d = Math.min(d, Math.max(0, Math.hypot(x - SKIDPAD.x, z - SKIDPAD.z) - SKIDPAD.pad));
  // the road from the apron to the track
  const rx = Math.max(APRON.x1 - 1 - x, 0, x - 125);
  const rz = Math.max(60 - z, 0, z - 74);
  d = Math.min(d, Math.hypot(rx, rz));
  const n = nearTrack(x, z, 60);
  if (n) d = Math.min(d, Math.max(0, n.dist - TRACK_WIDTH / 2 - KERB_WIDTH));
  return d;
}

/** Builds the distance grid (once). */
export function buildTerrainField() {
  if (DIST) return DIST;
  DIST = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -EXTENT + j * CELL;
    for (let i = 0; i < N; i++) DIST[j * N + i] = pavedDistance(-EXTENT + i * CELL, z);
  }
  // the obstacles (buildings, barriers): rasterised with their own distance
  for (const o of CAR_OBSTACLES) {
    const r = Math.hypot(o.hx, o.hz) + 40;
    const i0 = Math.max(0, Math.floor((o.x - r + EXTENT) / CELL));
    const i1 = Math.min(N - 1, Math.ceil((o.x + r + EXTENT) / CELL));
    const j0 = Math.max(0, Math.floor((o.z - r + EXTENT) / CELL));
    const j1 = Math.min(N - 1, Math.ceil((o.z + r + EXTENT) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -EXTENT + i * CELL - o.x;
        const z = -EXTENT + j * CELL - o.z;
        // into the box's frame (c, s: cos, sin of its turn)
        const lx = x * o.c - z * o.s;
        const lz = x * o.s + z * o.c;
        const dd = Math.hypot(Math.max(Math.abs(lx) - o.hx, 0), Math.max(Math.abs(lz) - o.hz, 0));
        if (dd < DIST[j * N + i]) DIST[j * N + i] = dd;
      }
    }
  }
  // the heights at the nodes: 0 within 18 m of paving (a node of any cell that touches paving is within the cell's
  // diagonal, 17.7 m, so the paving and everything built stay exactly flat), rising to the swell by 70 m, and back to 0
  // at the grid's edge
  HEIGHT = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -EXTENT + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + i * CELL;
      const e = Math.max(Math.abs(x), Math.abs(z));
      const w = ss(18, 70, DIST[j * N + i]) * (1 - ss(EXTENT - 200, EXTENT - 2 * CELL, e));
      HEIGHT[j * N + i] = w * swell(x, z);
    }
  }
  return DIST;
}

/** The distance field at (x, z), bilinear (60 outside the grid). */
export function fieldAt(x, z) {
  if (!DIST) return 60;
  const fx = (x + EXTENT) / CELL;
  const fz = (z + EXTENT) / CELL;
  if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return 60;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const k = j * N + i;
  return (DIST[k] * (1 - u) + DIST[k + 1] * u) * (1 - v) + (DIST[k + N] * (1 - u) + DIST[k + N + 1] * u) * v;
}

const ss = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The rolling ground's height at (x, z) (0 on and near the paving): the node heights read bilinearly, the same surface
 * the ground's mesh draws (its vertices are these nodes); if `n` is given, its upward normal there (the bilinear
 * patch's gradient). ground.js adds it to groundAt.
 */
export function terrainAt(x, z, n) {
  if (!PERF.terrain || !HEIGHT) {
    if (n) n.set(0, 1, 0);
    return 0;
  }
  const fx = (x + EXTENT) / CELL;
  const fz = (z + EXTENT) / CELL;
  if (!(fx >= 0 && fz >= 0 && fx < N - 1 && fz < N - 1)) {
    if (n) n.set(0, 1, 0);
    return 0;
  }
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const k = j * N + i;
  const h00 = HEIGHT[k];
  const h10 = HEIGHT[k + 1];
  const h01 = HEIGHT[k + N];
  const h11 = HEIGHT[k + N + 1];
  if (h00 === 0 && h10 === 0 && h01 === 0 && h11 === 0) {
    if (n) n.set(0, 1, 0);
    return 0;
  }
  if (n) {
    const dx = ((h10 - h00) * (1 - v) + (h11 - h01) * v) / CELL;
    const dz = ((h01 - h00) * (1 - u) + (h11 - h10) * u) / CELL;
    n.set(-dx, 1, -dz).normalize();
  }
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

// ------------------------------------------------------------------------------------------------- the weather
/**
 * Wind: a steady wind (speed m/s, from `from` rad: 0 = from the north, i.e. blowing toward +z) with gusts: the speed
 * times 1 + gust x (a sum of three incommensurate sines, about +-35 % at gust 1) and the direction wandering +-8 deg.
 * WEATHER.at(t) -> { x, z } (m/s, where it blows to); WEATHER.now holds this frame's (main.js updates it).
 */
export const WEATHER = {
  speed: 3,
  from: (225 * Math.PI) / 180, // from the south-west (blows to the north-east): the smoke drifted that way since V3
  gust: 1,
  t: 0,
  now: new THREE.Vector3(),
  u: uniform(new THREE.Vector3()), // (x, z, strength 0..1 at 12 m/s) for the shaders
  step(dt) {
    this.t += dt;
    const t = this.t;
    const g = 1 + this.gust * (0.18 * Math.sin(t * 0.37) + 0.11 * Math.sin(t * 1.13 + 1.7) + 0.07 * Math.sin(t * 2.9 + 0.3));
    const dir = this.from + this.gust * 0.14 * Math.sin(t * 0.21 + 0.5);
    const s = this.speed * Math.max(0, g);
    // blowing toward: opposite to where it comes from (from 0 = north = -z: blows to +z)
    this.now.set(-Math.sin(dir) * s, 0, Math.cos(dir) * s);
    this.u.value.set(this.now.x, this.now.z, Math.min(1, s / 12));
    return this.now;
  },
};

// ------------------------------------------------------------------------------------------------- building it
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const hash = (i, j, k = 0) => {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Terrain {
  /** `groundMesh`: world.js's flat plane (kept, shown when the terrain is off); `grassMat`: its material. */
  constructor(scene, groundMesh) {
    this.scene = scene;
    this.flat = groundMesh;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    buildTerrainField();
    this.wash = { pos: uniform(new THREE.Vector3(0, -1000, 0)), k: uniform(0) };
    this.carU = { pos: uniform(new THREE.Vector3(0, -1000, 0)), v: uniform(new THREE.Vector3()), dir: uniform(new THREE.Vector3(0, 0, -1)) };
    this.lamps = uniform(0); // the edge lights' glow (time of day)
    this.show = { grass: true, trees: true }; // (V8) for ablation (tools/v8_cost.js): within flora, each part on its own
    this._ground(groundMesh.material);
    this._hills();
    this._clouds();
    this._trees();
    this._grass();
    this._furniture();
    this.apply();
  }

  /** The rolling ground inside +-EXTENT (8 m cells, the paving's level -3 cm where flat), the old plane outside it. */
  _ground(mat) {
    const seg = N - 1;
    const geo = new THREE.PlaneGeometry(seg * CELL, seg * CELL, seg, seg).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) + EXTENT) / CELL);
      const j = Math.round((pos.getZ(k) + EXTENT) / CELL);
      pos.setY(k, HEIGHT[j * N + i] - 0.03);
    }
    geo.computeVertexNormals();
    // (its own copy of the ground's material, drawn a little behind the paving: from 200 m up the 3 cm under the
    // skidpad and the track z-fought in the fine grid)
    const own = mat.clone();
    own.polygonOffset = true;
    own.polygonOffsetFactor = 2;
    own.polygonOffsetUnits = 4;
    // ((V8) under the grass: the ground greener and darker where the blades grow thick (flora.js bareAt, the same
    // slow patches), so the cover reads as a meadow and its gaps as the shade between blades, not as sand)
    if (own.colorNode) {
      const pw = positionWorld;
      const bare = sin(pw.x.mul(0.043).add(1.1)).mul(cos(pw.z.mul(0.037).sub(0.6))).mul(0.45).add(sin(pw.x.sub(pw.z).mul(0.11).add(0.3)).mul(0.15)).add(0.2).clamp(0, 1);
      own.colorNode = own.colorNode.mul(mix(vec3(0.42, 0.55, 0.26), vec3(0.85, 0.85, 0.72), bare));
    }
    mat = own;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain ground';
    this.groundMesh = mesh;
    this.group.add(mesh);
    // the plane outside: four strips round the hole (one mesh)
    const R = 4500;
    const strips = [];
    for (const [cx, cz, w, h] of [[0, -(EXTENT + R) / 2, 2 * R, R - EXTENT], [0, (EXTENT + R) / 2, 2 * R, R - EXTENT], [-(EXTENT + R) / 2, 0, R - EXTENT, 2 * EXTENT], [(EXTENT + R) / 2, 0, R - EXTENT, 2 * EXTENT]]) {
      strips.push(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(cx, -0.03, cz));
    }
    const outer = new THREE.Mesh(mergeGeos(strips), mat);
    outer.receiveShadow = true;
    outer.name = 'terrain outer plane';
    this.outerMesh = outer;
    this.group.add(outer);
  }

  /** Hills on the horizon: a ring from 1.9 to 3.2 km, 60 to 260 m high, in the haze's colour (not fogged out). */
  _hills() {
    const segA = 220;
    const segR = 6;
    const pos = [];
    const idx = [];
    for (let a = 0; a <= segA; a++) {
      const th = (a / segA) * Math.PI * 2;
      for (let r = 0; r <= segR; r++) {
        const rr = 1900 + (r / segR) * 1300;
        const ridge = Math.sin(r / segR * Math.PI);
        const h = ridge * (60 + 110 * (0.5 + 0.5 * Math.sin(th * 5 + 1.3)) + 70 * (0.5 + 0.5 * Math.sin(th * 13 + 0.4)) + 25 * Math.sin(th * 37));
        pos.push(Math.sin(th) * rr, h - 4, Math.cos(th) * rr);
      }
    }
    for (let a = 0; a < segA; a++) for (let r = 0; r < segR; r++) {
      const k = a * (segR + 1) + r;
      idx.push(k, k + 1, k + segR + 1, k + 1, k + segR + 2, k + segR + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.haze = uniform(new THREE.Color(0.55, 0.6, 0.66));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    mat.fog = false;
    // (far: mostly the haze's colour, the slopes' light still reading through)
    mat.colorNode = vec3(0.13, 0.17, 0.1);
    mat.emissiveNode = this.haze.mul(0.42);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'hills';
    mesh.frustumCulled = false;
    mesh.layers.set(DETAIL_LAYER);
    this.hills = mesh;
    this.group.add(mesh);
  }

  /** Clouds: 46 clusters of 6 to 9 soft puffs at 700 to 1300 m, lit from the sun's side, drifting with the wind. */
  _clouds() {
    const tex = cloudDot();
    this.cloud = new SpriteCloud(this.scene, 160, tex, { renderOrder: -1 });
    this.puffs = [];
    for (let c = 0; c < 30; c++) {
      const a = hash(c, 1) * Math.PI * 2;
      const r = 400 + hash(c, 2) * 1900;
      const cx = Math.sin(a) * r;
      const cz = Math.cos(a) * r;
      const cy = 700 + hash(c, 3) * 600;
      const n = 3 + Math.floor(hash(c, 4) * 3);
      const size = 110 + hash(c, 5) * 140;
      for (let k = 0; k < n; k++) {
        const s = this.cloud.add({ base: new THREE.Vector3(cx + (hash(c, k, 6) - 0.5) * size * 2.2, cy + (hash(c, k, 7) - 0.3) * size * 0.45, cz + (hash(c, k, 8) - 0.5) * size * 1.6), up: hash(c, k, 9) });
        s.scale.setScalar(size * (0.7 + hash(c, k, 10) * 0.6));
        s.material.opacity = 0.55;
        s.position.copy(s.userData.base);
        s.visible = true;
        this.puffs.push(s);
      }
    }
    // (1 to 2.6 km away: the haze (fog to 1.9 km) would take them all; they are drawn unfogged, in the sky's light)
    this.cloud.sprite.material.fog = false;
    this.cloud.sprite.layers.set(DETAIL_LAYER);
    this.cloud.update();
  }

  /** Trees and bushes: instanced, along the track 15 to 45 m out and round the airfield, swaying in the wind. */
  _trees() {
    const trees = [];
    const bushes = [];
    // along the track
    for (let i = 0; i < LINE.length; i += 9) {
      const p = LINE[i];
      for (const side of [-1, 1]) {
        if (hash(i, side, 1) < 0.35) continue;
        const off = TRACK_WIDTH / 2 + 18 + hash(i, side, 2) * 30;
        const lx = -Math.cos(p.yaw) * side;
        const lz = Math.sin(p.yaw) * side;
        const x = p.x + lx * off + (hash(i, side, 3) - 0.5) * 8;
        const z = p.z + lz * off + (hash(i, side, 4) - 0.5) * 8;
        if (fieldAt(x, z) < 12) continue;
        (hash(i, side, 5) < 0.62 ? trees : bushes).push([x, z, hash(i, side, 6)]);
      }
    }
    // round the airfield: a loose belt outside the apron
    for (let k = 0; k < 260; k++) {
      const a = hash(k, 11) * Math.PI * 2;
      const x = (APRON.x0 + APRON.x1) / 2 + Math.sin(a) * (180 + hash(k, 12) * 120);
      const z = (APRON.z0 + APRON.z1) / 2 + Math.cos(a) * (220 + hash(k, 13) * 120);
      if (fieldAt(x, z) < 14) continue;
      (hash(k, 14) < 0.55 ? trees : bushes).push([x, z, hash(k, 15)]);
    }
    // ((V8) copses: 40 groups of 4 to 12 trees with bushes at their edges, 110 to 750 m out, on open ground)
    for (let c = 0; c < 40; c++) {
      const a = hash(c, 21) * Math.PI * 2;
      const r = 110 + hash(c, 22) * 640;
      const cx = Math.sin(a) * r;
      const cz = Math.cos(a) * r;
      if (fieldAt(cx, cz) < 30) continue;
      const n = 4 + Math.floor(hash(c, 23) * 9);
      const rad = 5 + n * 0.9;
      for (let k = 0; k < n + 4; k++) {
        const aa = hash(c, k, 24) * Math.PI * 2;
        const rr = Math.sqrt(hash(c, k, 25)) * rad * (k >= n ? 1.4 : 1);
        const x = cx + Math.sin(aa) * rr;
        const z = cz + Math.cos(aa) * rr;
        if (fieldAt(x, z) < 12) continue;
        (k < n ? trees : bushes).push([x, z, hash(c, k, 26)]);
      }
    }
    this.treeCount = trees.length;
    this.bushCount = bushes.length;
    // ((V8) flora.js: three tree shapes with near and far versions, shadow proxies, bushes; the grass)
    const deps = { fieldAt, terrainAt, groundY: (x, z) => (PERF.terrain ? terrainAt(x, z) : 0), wind: WEATHER.u, wash: this.wash, car: this.carU, layer: DETAIL_LAYER };
    this.flora = new Trees(this.group, trees, bushes, deps);
    this.trees = this.flora;
    this.bushes = this.flora.bushIM;
    this._floraDeps = deps;
  }

  /** (V8) The grass (flora.js): clumps of blades round the camera, in its view, thinning with distance. */
  _grass() {
    this.grassField = new Grass(this.group, this._floraDeps);
    this.grass = this.grassField.mesh;
  }

  /** (V8) for tools/v7_shots.js camAt: the grass round a camera placed by hand */
  _fillGrass() {
    const cam = window.demo && window.demo.camera;
    if (cam) this.grassField.update(cam, PERF.terrain, true);
  }

  /** Edge lights along the track and round the helipad, marker boards, tyre walls at the hairpins, the wind sock. */
  _furniture() {
    // edge lights: every 40 m both sides of the track (1.5 m off the kerb), 16 round the helipad, along the apron's edge
    const lights = [];
    for (let i = 0; i < LINE.length; i += 20) {
      const p = LINE[i];
      for (const side of [-1, 1]) {
        const off = TRACK_WIDTH / 2 + KERB_WIDTH + 1.5;
        lights.push([p.x - Math.cos(p.yaw) * side * off, p.z + Math.sin(p.yaw) * side * off, 0]);
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      lights.push([HELIPAD.x + Math.sin(a) * (HELIPAD.r + 1.2), HELIPAD.z + Math.cos(a) * (HELIPAD.r + 1.2), 1]);
    }
    for (let x = APRON.x0; x <= APRON.x1; x += 30) for (const z of [APRON.z0 - 1.5, APRON.z1 + 1.5]) lights.push([x, z, 2]);
    const lgeo = mergeGeos([new THREE.CylinderGeometry(0.035, 0.05, 0.36, 6).translate(0, 0.18, 0), new THREE.CylinderGeometry(0.075, 0.075, 0.09, 10).translate(0, 0.4, 0)]);
    // (the glass head: the top 0.1 m; colour by kind in the instance colour: track white, helipad green, apron blue)
    const lmat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
    const head = smoothstep(0.34, 0.36, positionLocal.y);
    const kinds = new THREE.InstancedBufferAttribute(new Float32Array(lights.map((l) => l[2])), 1);
    const kd = instancedBufferAttribute(kinds, 'float');
    const icol = mix(mix(vec3(1, 0.92, 0.75), vec3(0.2, 1, 0.35), smoothstep(0.5, 0.6, kd)), vec3(0.25, 0.45, 1), smoothstep(1.5, 1.6, kd));
    lmat.colorNode = mix(vec3(0.75, 0.62, 0.1), icol.mul(0.6), head);
    lmat.emissiveNode = icol.mul(head).mul(this.lamps).mul(9);
    const lim = new THREE.InstancedMesh(lgeo, lmat, lights.length);
    lights.forEach(([x, z], i) => lim.setMatrixAt(i, _m.makeTranslation(x, terrainAt(x, z) - 0.02, z)));
    lim.castShadow = false;
    lim.receiveShadow = true;
    lim.name = 'edge lights';
    this.lights = lim;
    this.group.add(lim);
    // tyre walls: stacks of four tyres in front of the run-off walls of the hairpins (painted white and red rows)
    const tyres = [];
    for (let i = 450; i < 510; i += 2) {
      const p = LINE[i];
      const lx = -Math.cos(p.yaw);
      const lz = Math.sin(p.yaw);
      const d = -(TRACK_WIDTH / 2 + 16 - 0.65);
      for (const row of [0, 0.82]) {
        for (const along of [-1.2, -0.4, 0.4, 1.2]) {
          const x = p.x + lx * (d + row) + -Math.sin(p.yaw) * along;
          const z = p.z + lz * (d + row) + -Math.cos(p.yaw) * along;
          for (let h = 0; h < 4; h++) tyres.push([x, z, h, (i + h + (row ? 1 : 0)) % 2]);
        }
      }
    }
    // ((V8) two rows of stacks now (1.64 m deep in front of the concrete), and they stop the car softly: one
    // deformable barrier per stack group (dynamics.js _soft), as long as the groups' spacing (they sit on the hairpin's
    // inside, closer together than the centre line's points), a progressive spring with a damper that comes in over
    // the first 20 cm: about 14 g at most at 60 km/h square on, little rebound; faster, the concrete behind takes the rest)
    this.tyreWalls = [];
    for (let i = 450; i < 510; i += 2) {
      const p = LINE[i];
      const q = LINE[i + 2];
      const d = -(TRACK_WIDTH / 2 + 16 - 1.06);
      const x = p.x - Math.cos(p.yaw) * d;
      const z = p.z + Math.sin(p.yaw) * d;
      const gap = Math.hypot(q.x - Math.cos(q.yaw) * d - x, q.z + Math.sin(q.yaw) * d - z);
      const o = { x, z, hx: 0.82, hz: Math.max(0.5, gap / 2), c: Math.cos(p.yaw), s: -Math.sin(p.yaw), top: 0.9, soft: { k: 35000, k2: 0.5, c: 45000, cIn: 0.25, mu: 0.7 } };
      CAR_OBSTACLES.push(o);
      this.tyreWalls.push(o);
    }
    const tgeo = new THREE.TorusGeometry(0.3, 0.11, 6, 12).rotateX(Math.PI / 2);
    const tmat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    const tim = new THREE.InstancedMesh(tgeo, tmat, tyres.length);
    tyres.forEach(([x, z, h, red], i) => {
      tim.setMatrixAt(i, _m.makeTranslation(x, 0.11 + h * 0.22, z));
      tim.setColorAt(i, red ? new THREE.Color(0.5, 0.05, 0.04) : new THREE.Color(0.62, 0.62, 0.6));
    });
    tim.castShadow = true;
    tim.receiveShadow = true;
    tim.name = 'tyre walls';
    this.tyres = tim;
    this.group.add(tim);
    // marker boards: the helipad's approach (H, numbered), the apron's corners
    const boards = [[HELIPAD.x - 22, HELIPAD.z, 'H'], [HELIPAD.x + 22, HELIPAD.z + 6, 'H1'], [APRON.x1 + 4, APRON.z0 + 10, 'A'], [APRON.x1 + 4, APRON.z1 - 10, 'B'], [APRON.x0 - 4, APRON.z0 + 10, 'C'], [APRON.x0 - 4, APRON.z1 - 10, 'D']];
    const bmat = new THREE.MeshStandardNodeMaterial({ map: boardTexture(boards.map((b) => b[2])), roughness: 0.6 });
    const bgeos = [];
    boards.forEach(([x, z], i) => {
      const g = new THREE.BoxGeometry(1.6, 1.0, 0.08);
      const uvs = g.attributes.uv;
      for (let k = 0; k < uvs.count; k++) uvs.setX(k, (i + uvs.getX(k)) / boards.length);
      g.translate(x, 1.1, z);
      bgeos.push(g, new THREE.BoxGeometry(0.08, 0.7, 0.08).translate(x - 0.6, 0.35, z), new THREE.BoxGeometry(0.08, 0.7, 0.08).translate(x + 0.6, 0.35, z));
    });
    const bm = new THREE.Mesh(mergeGeos(bgeos.map((g) => g.toNonIndexed ? g.toNonIndexed() : g)), bmat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    bm.name = 'marker boards';
    this.boards = bm;
    this.group.add(bm);
    // the wind sock: a 6 m mast at the helipad's edge, a 3.6 m orange and white sock that fills and swings with the wind
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6, 8).translate(0, 3, 0), new THREE.MeshStandardNodeMaterial({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.4 }));
    mast.position.set(HELIPAD.x + 26, 0, HELIPAD.z - 14);
    mast.castShadow = true;
    this.group.add(mast);
    const sockGeo = new THREE.CylinderGeometry(0.42, 0.2, 3.6, 16, 10, true).rotateZ(-Math.PI / 2).translate(1.8, 0, 0);
    const sc = [];
    const sp = sockGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const band = Math.floor(sp.getX(i) / 0.72) % 2;
      sc.push(...(band ? [0.95, 0.95, 0.92] : [0.95, 0.35, 0.06]));
    }
    sockGeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    const smat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    // (the sock droops toward its tail as the wind drops: a bend about its ring, more toward the end)
    this.sockDroop = uniform(0.3);
    this.sockFlap = uniform(0);
    const along = positionLocal.x.div(3.6).clamp(0, 1);
    const sag = along.mul(along).mul(this.sockDroop).mul(3.0);
    const flap = sin(time.mul(9).add(along.mul(7))).mul(this.sockFlap).mul(along).mul(0.12);
    smat.positionNode = positionLocal.add(vec3(0, sag.negate(), flap));
    const sock = new THREE.Mesh(sockGeo, smat);
    sock.position.set(0, 5.75, 0);
    sock.castShadow = true;
    mast.add(sock);
    this.sock = sock;
    this.mast = mast;
  }

  /** Each frame: the wind's uniforms, the sock, the grass round the camera, the wash and the car for the grass. */
  update(dt, camera, { heli = null, car = null } = {}) {
    const w = WEATHER.now;
    const speed = Math.hypot(w.x, w.z);
    // the sock: points downwind, fills by 15 kt (7.7 m/s), droops below
    if (this.sock) {
      const yaw = Math.atan2(-w.z, w.x);
      this.sock.rotation.set(0, speed > 0.05 ? yaw : this.sock.rotation.y, 0);
      this.sockDroop.value = THREE.MathUtils.clamp(1 - speed / 7.7, 0, 1);
      this.sockFlap.value = THREE.MathUtils.clamp(speed / 6, 0, 1.2);
    }
    if (camera) this._camera = camera;
    if (!PERF.flora) return;
    if (camera) {
      const p = camera.position;
      // (from high up there is nothing to see of it: none above 60 m over the ground)
      const low = p.y - terrainAt(p.x, p.z) < 60;
      this.grass.visible = low && this.show.grass;
      if (low && this.show.grass) this.grassField.update(camera, PERF.terrain);
      this.flora.update(camera);
    }
    if (heli && heli.ready) {
      const s = heli.state;
      this.wash.pos.value.set(s.position.x, 0, s.position.z);
      this.wash.k.value = heli.washStrength || 0;
    }
    if (car && car.ready) {
      const d = car.dyn;
      this.carU.pos.value.set(d.pos.x, 0, d.pos.z);
      // (x: speed m/s; y: 1 while the car's wheels are on the ground near the grass (the blades under a parked car are
      // pressed down too), dir: its heading)
      this.carU.v.value.set(Math.hypot(d.vel.x, d.vel.z), 1, 0);
      car.root.getWorldDirection(this.carU.dir.value);
      this.carU.dir.value.negate().setY(0).normalize();
    }
  }

  /** Clouds lit by the time of day (look.js calls it with the sun's colour and the sky's). */
  light(sunCol, skyCol, sunDir) {
    if (this.grassField && sunCol) this.grassField.glow.value.copy(sunCol);
    for (const s of this.puffs) {
      const u = s.userData;
      const k = 0.55 + 0.45 * u.up;
      s.material.color.setRGB(sunCol.r * k * 0.13 + skyCol.r * 0.9, sunCol.g * k * 0.13 + skyCol.g * 0.9, sunCol.b * k * 0.13 + skyCol.b * 0.9);
      s.position.copy(u.base);
      s.visible = PERF.sky;
    }
    this.cloud.update();
    void sunDir;
  }

  /** The clouds drift with the wind (slowly: they are 1 km up), wrapped round the world. */
  drift(dt) {
    if (!PERF.sky) return;
    const w = WEATHER.now;
    for (const s of this.puffs) {
      const b = s.userData.base;
      b.x += w.x * dt * 2;
      b.z += w.z * dt * 2;
      if (b.x > 2400) b.x -= 4800;
      if (b.x < -2400) b.x += 4800;
      if (b.z > 2400) b.z -= 4800;
      if (b.z < -2400) b.z += 4800;
      s.position.copy(b);
    }
    this.cloud.update();
  }

  /** The switches (perf.js) onto what is shown. */
  apply() {
    const t = PERF.terrain;
    this.groundMesh.visible = t;
    this.outerMesh.visible = t;
    this.flat.visible = !t;
    this.hills.visible = t;
    this.flora.visible = PERF.flora && this.show.trees;
    this.grass.visible = PERF.flora && this.show.grass;
    // (a re-sort only when the flora comes back on: the switches are flipped every frame by tools/v8_cost.js)
    if (PERF.flora && !this._floraWas && this._camera) this.flora.update(this._camera, true);
    this._floraWas = PERF.flora;
    for (const s of this.puffs) s.visible = PERF.sky;
    this.cloud.update();
    this.lights.visible = this.tyres.visible = this.boards.visible = this.mast.visible = PERF.furniture;
    for (const o of this.tyreWalls || []) o.off = !PERF.furniture;
  }
}

function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = geos[0].attributes[n].itemSize;
    let len = 0;
    for (const g of geos) len += g.attributes[n].count * size;
    const arr = new Float32Array(len);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[n].array, o);
      o += g.attributes[n].count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

function paint(g, rgb, vary = 0) {
  const c = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + vary * Math.sin(p.getX(i) * 5.3 + p.getY(i) * 3.7 + p.getZ(i) * 4.1);
    c.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
}

function cloudDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boardTexture(labels) {
  const c = document.createElement('canvas');
  c.width = 128 * labels.length;
  c.height = 80;
  const g = c.getContext('2d');
  labels.forEach((t, i) => {
    g.fillStyle = '#1b1d20';
    g.fillRect(i * 128, 0, 128, 80);
    g.fillStyle = '#f2c94c';
    g.fillRect(i * 128 + 6, 6, 116, 68);
    g.fillStyle = '#111';
    g.font = 'bold 54px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, i * 128 + 64, 42);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

