// The driving world round the yard (pass V1): open ground, the track loop with its kerbs, lines and
// braking boards, the skidpad, the helipad (marked for the helicopter's pass), a slalom of cones, a
// few buildings, barriers and lamp posts to judge speed against. All procedural (surfaces.js); the
// plan is track.js.
import * as THREE from 'three/webgpu';
import { float, vec3, color, mix, smoothstep, attribute, positionWorld, normalWorld, abs, fract, step, uv, mx_noise_float } from 'three/tsl';
import { asphalt, grass, concrete, corrugated, steel, roadPaint } from './surfaces.js';
import { SHADOW_LAYER } from './batch.js';
import { LINE, TRACK_WIDTH, KERB_WIDTH, KERB_HEIGHT, TRACK_LENGTH, SKIDPAD, HELIPAD, SLALOM, APRON, CAR_OBSTACLES, kerbAt } from './track.js';

const _m = new THREE.Matrix4();
/** Paint lies a centimetre over the surface: pulled forward in depth too, so it never fights it far off. */
const decal = (m) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** A ribbon along the centre line between lateral offsets `a` and `b` (m, + left), at height fn(i, side). */
function ribbon(from, to, a, b, y = () => 0, colours = null) {
  const pos = [];
  const col = [];
  const idx = [];
  const n = to - from;
  for (let k = 0; k <= n; k++) {
    const p = LINE[(from + k) % LINE.length];
    const lx = -Math.cos(p.yaw); // left of the way round
    const lz = Math.sin(p.yaw);
    for (const [off, side] of [[a, 0], [b, 1]]) {
      pos.push(p.x + lx * off, y(from + k, side), p.z + lz * off);
      if (colours) col.push(...colours(from + k, side));
    }
    if (k < n) {
      const i = k * 2;
      // (wound so the top faces up whichever side is which)
      if (b > a) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      else idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colours) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Runs of corner points (curvature over 1/400 m), as [from, to] index pairs. */
function cornerRuns() {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= LINE.length; i++) {
    const corner = i < LINE.length && Math.abs(LINE[i].k) > 1 / 400;
    if (corner && start < 0) start = i;
    if (!corner && start >= 0) {
      runs.push([Math.max(0, start - 1), Math.min(LINE.length - 1, i)]);
      start = -1;
    }
  }
  return runs;
}

function boardTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#1b1d22';
  g.font = 'bold 120px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  /** `obstacles` is the player's list of boxes (range.js); `fx` gets what a bullet can hit near the yard. */
  constructor(scene, fx, obstacles) {
    this.scene = scene;
    this.cones = [];
    const add = (mesh, shadow = true) => {
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      // ((V4) never moves: merged with its material's other meshes and its shadow into a proxy, batch.js)
      if (mesh.isInstancedMesh) mesh.userData.staticInstances = true;
      else mesh.userData.static = true;
      scene.add(mesh);
      return mesh;
    };

    // ---- the open ground: dry grass and dirt, just under the paving ----
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), grass(0x7d7a4a, 0x8a7458));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    add(ground, false);
    this.ground = ground; // ((V7) terrain.js shows it when the rolling ground is switched off)

    // ---- the track ----
    const track = new THREE.Mesh(ribbon(0, LINE.length, -TRACK_WIDTH / 2, TRACK_WIDTH / 2), asphalt(0x3a3b3d));
    add(track, false);
    // edge lines and the start line
    const white = decal(roadPaint(0xe9e9e4, 0x3a3b3d));
    for (const side of [-1, 1]) {
      const a = side * (TRACK_WIDTH / 2 - 0.35);
      const b = side * (TRACK_WIDTH / 2 - 0.15);
      add(new THREE.Mesh(ribbon(0, LINE.length, Math.min(a, b), Math.max(a, b), () => 0.012), white), false);
    }
    // centre dashes on the straights (3 m on, 6 off): speed reads off them
    const dash = [];
    for (let i = 0; i < LINE.length; i += 5) {
      const p = LINE[i];
      if (Math.abs(p.k) > 0) continue;
      dash.push(p);
    }
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.01, 3), white, dash.length);
    dash.forEach((p, i) => dashes.setMatrixAt(i, _m.compose(_v.set(p.x, 0.012, p.z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw), _s)));
    add(dashes, false);
    const start = LINE[25];
    const chequer = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 1.2), decal(new THREE.MeshStandardNodeMaterial({ map: this._chequer(), roughness: 0.8 })));
    chequer.rotation.set(-Math.PI / 2, 0, start.yaw);
    chequer.position.set(start.x, 0.014, start.z);
    add(chequer, false);
    // kerbs through every corner, red and white in 2 m blocks, raised at their outer edge
    const kerbMat = decal(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }));
    for (const [from, to] of cornerRuns()) {
      for (const side of [-1, 1]) {
        const a = side * (TRACK_WIDTH / 2);
        const b = side * (TRACK_WIDTH / 2 + KERB_WIDTH);
        const y = (i, s) => (s === 1 ? KERB_HEIGHT : 0) + 0.006;
        const colours = (i) => (Math.floor(LINE[i].s / 2) % 2 ? [0.75, 0.06, 0.05] : [0.85, 0.85, 0.82]);
        const geo = ribbon(from, to, Math.min(a, b), Math.max(a, b), (i, s) => y(i, a < b ? s : 1 - s), colours);
        add(new THREE.Mesh(geo, kerbMat), false);
      }
    }
    // braking boards before both hairpins and the sweeper (300, 200, 100 m), on the right
    const boardMats = { 3: boardTexture('3'), 2: boardTexture('2'), 1: boardTexture('1') };
    const legs = steel(0x8a8f96, 0.5, 0.6);
    for (const end of [900, 900 + 110 + 250 + 94 + 150]) {
      for (const k of [3, 2, 1]) {
        const p = LINE[Math.round((end - k * 100) / 2)];
        const rx = Math.cos(p.yaw);
        const rz = -Math.sin(p.yaw);
        // ((V4) one material per number: batch.js merges the boards that show it)
        boardMats['m' + k] = boardMats['m' + k] || new THREE.MeshStandardNodeMaterial({ map: boardMats[k], roughness: 0.7 });
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), boardMats['m' + k]);
        board.position.set(p.x + rx * (TRACK_WIDTH / 2 + 4), 2.4, p.z + rz * (TRACK_WIDTH / 2 + 4));
        board.rotation.y = p.yaw;
        add(board);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), legs);
        post.position.set(board.position.x, 0.75, board.position.z);
        add(post);
      }
    }
    // lamp posts every 50 m down both sides of the main straight
    const poles = [];
    for (let s = 0; s <= 900; s += 50) for (const side of [-1, 1]) poles.push([120 + side * (TRACK_WIDTH / 2 + 5), 100 - s]);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0), steel(0x9aa0a6, 0.4, 0.8), poles.length);
    poles.forEach(([x, z], i) => pole.setMatrixAt(i, _m.makeTranslation(x, 0, z)));
    add(pole);
    // concrete barriers down the outside of the main straight and round the north hairpin
    // (V2) the barrier: weathered grey concrete (was a near-white 0xb9bbb8 that read as a wall of light),
    // a red and white painted band along the top quarter in blocks, dark joints at the segment ends
    const barrier = concrete(0x8c8e8a, { stains: 1.4 });
    {
      const u = uv().x;
      const v = uv().y;
      const side = smoothstep(0.7, 0.5, abs(normalWorld.y));
      const band = step(0.7, v).mul(side);
      const block = step(0.5, fract(u.mul(4)));
      const paint = mix(color(0xb3261e), color(0xe8e6df), block);
      const joint = smoothstep(0.012, 0.0, u).add(smoothstep(0.988, 1.0, u)).mul(side);
      barrier.colorNode = mix(mix(barrier.colorNode, paint, band.mul(0.92)), color(0x2a2b2a), joint.clamp(0, 1).mul(0.8));
    }
    const segs = [];
    for (let i = 10; i < 450; i += 5) segs.push([i, -1, 9]);
    for (let i = 450; i < 510; i += 2) segs.push([i, -1, 16]); // the hairpin's run-off wall
    for (const [i, side, off] of segs) {
      const p = LINE[i];
      const lx = -Math.cos(p.yaw);
      const lz = Math.sin(p.yaw);
      const d = side * (TRACK_WIDTH / 2 + off);
      const x = p.x + lx * d;
      const z = p.z + lz * d;
      const len = Math.abs(p.k) > 0 ? 4.4 : 10.2;
      CAR_OBSTACLES.push({ x, z, hx: 0.3, hz: len / 2, c: Math.cos(p.yaw), s: -Math.sin(p.yaw), top: 0.85 });
      segs.mesh = segs.mesh || [];
      segs.mesh.push([x, z, p.yaw, len]);
    }
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.85, 1).translate(0, 0.425, 0), barrier, segs.mesh.length);
    segs.mesh.forEach(([x, z, yaw, len], i) => walls.setMatrixAt(i, _m.compose(_v.set(x, 0, z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, len))));
    add(walls);

    // ---- the skidpad: an asphalt disc with a painted 65 m circle ----
    const pad = new THREE.Mesh(new THREE.CircleGeometry(SKIDPAD.pad, 96).rotateX(-Math.PI / 2), asphalt(0x45464a));
    pad.position.set(SKIDPAD.x, 0, SKIDPAD.z);
    add(pad, false);
    const ring = new THREE.Mesh(new THREE.RingGeometry(SKIDPAD.r - 0.15, SKIDPAD.r + 0.15, 256).rotateX(-Math.PI / 2), decal(roadPaint(0xe2c23a, 0x45464a)));
    ring.position.set(SKIDPAD.x, 0.012, SKIDPAD.z);
    add(ring, false);
    // the road from the apron to the track
    const road = new THREE.Mesh(new THREE.PlaneGeometry(22, 14).rotateX(-Math.PI / 2), asphalt(0x3d3e40));
    road.position.set(APRON.x1 + 10, 0.002, 67);
    add(road, false);

    // ---- the helipad (marked; the helicopter comes in a later pass) ----
    const yellow = decal(roadPaint(0xe0b93a, 0x9b9d9c));
    const hp = new THREE.Mesh(new THREE.RingGeometry(HELIPAD.r - 0.4, HELIPAD.r, 96).rotateX(-Math.PI / 2), yellow);
    hp.position.set(HELIPAD.x, 0.012, HELIPAD.z);
    add(hp, false);
    const whiteYard = decal(roadPaint(0xeeeeea, 0x9b9d9c));
    for (const [w, d, x, z] of [[0.8, 7, -1.6, 0], [0.8, 7, 1.6, 0], [2.4, 0.8, 0, 0]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), whiteYard);
      bar.position.set(HELIPAD.x + x, 0.013, HELIPAD.z + z);
      add(bar, false);
    }
    this.helipad = HELIPAD;

    // ---- buildings: a hangar, a workshop, a control tower, a pit building along the straight ----
    const blocks = [
      { kind: 'hangar', x: -55, z: -100, w: 46, h: 13, d: 28 },
      { kind: 'shed', x: 20, z: -105, w: 24, h: 7, d: 14 },
      { kind: 'tower', x: 88, z: -40, w: 7, h: 18, d: 7 },
      { kind: 'pits', x: 99, z: -320, w: 8, h: 6, d: 160 },
      { kind: 'shed', x: -95, z: 60, w: 12, h: 5, d: 22 },
    ];
    // (V2) facades: windows (dark reflective glass in frames) on a 3 m x 3.5 m storey grid, sills, a plinth;
    // the hangar has a clerestory band and a high door; doors added as their own meshes below
    const facade = (m, { rows = [1.1, 2.6], every = 3.4, storey = 3.5, wide = 1.5, from = 0, clerestory = null }) => {
      const p = positionWorld;
      const n = normalWorld;
      const along = mix(p.z, p.x, smoothstep(0.4, 0.6, abs(n.z)));
      const wall = smoothstep(0.7, 0.5, abs(n.y));
      const fx = fract(along.div(every)).mul(every); // m into this bay
      const inBay = smoothstep(0.02, 0.0, abs(fx.sub(every / 2)).sub(wide / 2));
      const yy = p.y.sub(from);
      const fy = fract(yy.div(storey)).mul(storey);
      let inRow = smoothstep(0.02, 0.0, abs(fy.sub((rows[0] + rows[1]) / 2)).sub((rows[1] - rows[0]) / 2)).mul(step(from, p.y));
      if (clerestory) inRow = smoothstep(0.02, 0.0, abs(p.y.sub((clerestory[0] + clerestory[1]) / 2)).sub((clerestory[1] - clerestory[0]) / 2));
      const win = inBay.mul(inRow).mul(wall).toVar();
      const frame = smoothstep(0.0, 0.06, abs(fx.sub(every / 2)).sub(wide / 2 - 0.06)).mul(win); // the frame's edge
      const sill = smoothstep(0.05, 0.0, abs(fy.sub(rows[0] - 0.05))).mul(inBay).mul(wall).mul(clerestory ? 0 : 1);
      const plinth = smoothstep(0.62, 0.58, p.y).mul(wall);
      const glass = mix(color(0x1a232c), color(0x3b4a57), smoothstep(0.0, 1.0, fy.div(storey)));
      m.colorNode = mix(mix(mix(m.colorNode, color(0x55585c), plinth.mul(0.8)), glass, win), color(0xc9ccce), frame.add(sill).clamp(0, 1).mul(0.9));
      m.roughnessNode = mix(m.roughnessNode, float(0.06), win.mul(float(1).sub(frame)));
      m.metalnessNode = mix(m.metalnessNode, float(0.1), win);
      return m;
    };
    const mats = {
      hangar: facade(corrugated(0x5d6d78), { clerestory: [9.6, 11.2], every: 4, wide: 3.2 }),
      shed: facade(corrugated(0x8b5a3c), { rows: [1.2, 2.4], every: 4, wide: 1.6 }),
      tower: facade(concrete(0xa9a7a0), { rows: [1.0, 2.3], every: 2.33, wide: 1.2, storey: 3.0 }),
      pits: facade(concrete(0x9fa1a0), { rows: [3.6, 5.2], every: 5, wide: 3.6, storey: 6 }),
    };
    for (const b of blocks) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mats[b.kind]);
      mesh.position.set(b.x, b.h / 2, b.z);
      add(mesh);
      fx.colliders.push(mesh);
      obstacles.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
      CAR_OBSTACLES.push({ x: b.x, z: b.z, hx: b.w / 2, hz: b.d / 2, c: 1, s: 0, top: b.h });
      this._doors(b, add);
      if (b.kind === 'tower') {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 9), new THREE.MeshPhysicalNodeMaterial({ color: 0x223040, roughness: 0.08, metalness: 0.2 }));
        cab.position.set(b.x, b.h + 1.5, b.z);
        add(cab);
      }
    }

    // ---- cones: the slalom down the apron's east side (knocked flying by the car) ----
    const coneGeo = new THREE.ConeGeometry(0.17, 0.7, 16).translate(0, 0.35, 0);
    const coneMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
    const band = smoothstep(0.38, 0.4, positionWorld.y).mul(smoothstep(0.52, 0.5, positionWorld.y));
    coneMat.colorNode = mix(color(0xf05a14), color(0xf2f2f0), band);
    const cones = [];
    for (let i = 0; i < SLALOM.count; i++) cones.push([SLALOM.x, SLALOM.z0 - i * SLALOM.gap]);
    // and a gate at the chicane's apexes
    for (const i of [Math.round((900 + 110 + 250 + 94 + 150 + 471 + 60) / 2) + 9, Math.round((900 + 110 + 250 + 94 + 150 + 471 + 60) / 2) + 26]) {
      const p = LINE[i];
      cones.push([p.x - Math.cos(p.yaw) * (TRACK_WIDTH / 2 + 0.6), p.z + Math.sin(p.yaw) * (TRACK_WIDTH / 2 + 0.6)]);
    }
    this.coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
    cones.forEach(([x, z], i) => {
      this.cones.push({ pos: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Vector3(), moving: false, i });
      this.coneMesh.setMatrixAt(i, _m.makeTranslation(x, 0, z));
    });
    // ((V9) static usage: uploaded when a cone moves (needsUpdate), not in every pass of every frame)
    add(this.coneMesh);
    this.coneMesh.userData.staticInstances = false; // (knocked flying: not batched)
    this.coneMesh.layers.enable(SHADOW_LAYER); // ((V4) the far cascades draw SHADOW_LAYER only)
  }

  /** (V2) Doors on the buildings: the hangar's sliding doors, roller doors, personnel doors, and roof plant. */
  _doors(b, add) {
    this._doorMats = this._doorMats || {
      roller: corrugated(0x6d7176),
      slide: corrugated(0x3d4650),
      door: steel(0x40464d, 0.5, 0.4),
      frame: steel(0x2b2e31, 0.6, 0.3),
      plant: steel(0x9aa0a4, 0.45, 0.6),
    };
    const M = this._doorMats;
    const box = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      add(mesh);
      return mesh;
    };
    const south = b.z + b.d / 2; // faces +Z (toward the yard)
    if (b.kind === 'hangar') {
      // two sliding leaves 15 m x 9 m, a track above, a personnel door to the side
      box(15, 9, 0.25, b.x - 7.6, 4.5, south + 0.13, M.slide);
      box(15, 9, 0.25, b.x + 7.6, 4.5, south + 0.33, M.slide);
      box(31, 0.4, 0.5, b.x, 9.25, south + 0.25, M.frame);
      box(1.0, 2.1, 0.12, b.x + 19, 1.05, south + 0.06, M.door);
      for (const dx of [-14, 0, 14]) box(2.2, 1.2, 1.6, b.x + dx, b.h + 0.6, b.z, M.plant); // roof units
    } else if (b.kind === 'shed') {
      if (b.w > b.d) {
        box(5, 4.5, 0.2, b.x - 4, 2.25, south + 0.1, M.roller);
        box(1.0, 2.1, 0.12, b.x + 6, 1.05, south + 0.06, M.door);
      } else {
        const east = b.x + b.w / 2;
        box(0.2, 4, 5, east + 0.1, 2, b.z - 3, M.roller);
        box(0.12, 2.1, 1.0, east + 0.06, 1.05, b.z + 6, M.door);
      }
      box(1.6, 0.9, 1.2, b.x, b.h + 0.45, b.z, M.plant);
    } else if (b.kind === 'tower') {
      box(1.1, 2.2, 0.12, b.x, 1.1, south + 0.06, M.door);
    } else if (b.kind === 'pits') {
      // garages along the track side (+X), every 10 m, 4 m wide, 3.2 m high, with a dark frame
      const east = b.x + b.w / 2;
      for (let z = b.z - b.d / 2 + 6; z < b.z + b.d / 2 - 4; z += 10) {
        box(0.14, 3.2, 4, east + 0.07, 1.6, z, M.roller);
        box(0.2, 0.25, 4.4, east + 0.1, 3.3, z, M.frame);
      }
    }
  }

  _chequer() {
    const c = document.createElement('canvas');
    c.width = 260;
    c.height = 24;
    const g = c.getContext('2d');
    for (let i = 0; i < 26; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#eee';
      g.fillRect(i * 10, j * 12, 10, 12);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Cones the car runs into are knocked away; they tumble and come to rest. */
  update(dt, car) {
    if (dt <= 0) return;
    let dirty = false;
    for (const c of this.cones) {
      if (car) {
        // the car's footprint, grown by the cone's radius
        const local = car.toLocal(c.pos, _v);
        if (Math.abs(local.x) < 1.2 && local.z > -2.6 && local.z < 2.6 && c.pos.y < 0.5) {
          const v = car.velocityAt(c.pos);
          c.vel.copy(v).multiplyScalar(1.15);
          c.vel.y = 1.5 + v.length() * 0.12;
          c.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
          c.moving = true;
          c.pos.addScaledVector(c.vel, 0.02);
        }
      }
      if (!c.moving) continue;
      c.vel.y -= 9.81 * dt;
      c.pos.addScaledVector(c.vel, dt);
      _q.setFromEuler(new THREE.Euler(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt));
      c.quat.premultiply(_q);
      if (c.pos.y < 0) {
        c.pos.y = 0;
        c.vel.y = Math.abs(c.vel.y) * 0.25;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.6);
        if (c.vel.lengthSq() < 0.05) {
          c.moving = false;
          // at rest on its side
          _v.set(0, 1, 0).applyQuaternion(c.quat);
          if (_v.y < 0.7) c.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.set(_v.x, 0, _v.z).normalize());
        }
      }
      this.coneMesh.setMatrixAt(c.i, _m.compose(_v.copy(c.pos).setY(c.pos.y + (c.moving || _v2.set(0, 1, 0).applyQuaternion(c.quat).y > 0.7 ? 0 : 0.17)), c.quat, _s));
      dirty = true;
    }
    if (dirty) this.coneMesh.instanceMatrix.needsUpdate = true;
  }

  /** Stands every cone back up where it was. */
  resetCones() {
    for (const c of this.cones) {
      c.pos.copy(c.home);
      c.vel.set(0, 0, 0);
      c.quat.identity();
      c.moving = false;
      this.coneMesh.setMatrixAt(c.i, _m.makeTranslation(c.pos.x, 0, c.pos.z));
    }
    this.coneMesh.instanceMatrix.needsUpdate = true;
  }
}

export { TRACK_LENGTH };
