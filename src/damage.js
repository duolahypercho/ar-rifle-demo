// (V7) Damage that shows, for the car and the helicopter. Nothing here adds a draw call: the car's panels are the
// vertices of its skinned batches (batch.js) rewritten in place; the paint's scrapes, the cracked windscreen and the
// broken lamps are node inputs of the batches' own materials; the helicopter's bent skids are its contact points (the
// flight model's) and the skid tubes' vertices.
//
// Car, from each contact impulse of the dynamics (dyn.impacts: point, normal, normal and tangential impulse, slide speed):
//   dent      the body's vertices (paint, carbon, trim, lamp lenses; not the wheels, the steering wheel or the seat)
//             within R of the contact pushed along the impulse with a smooth falloff ((1 - (r/R)^2)^2), depth
//             0.35 (1 - exp(-dv / 14)) m ((V8); V7 0.2 (1 - exp(-dv / 18))) and R 0.25 + 0.012 dv m for a speed change dv (m/s), added to what is there;
//             each vertex is held to its own limit: never closer than 3 cm to the cabin's box or a wheel's envelope
//             along the push (so no panel goes through the cabin or a tyre) and never more than 0.22 m from new.
//             The dented vertices' normals are re-made from their own faces (the shading shows the dent).
//   scrape    the paint's `scrape` (0..1 per vertex): bare primer and metal where a panel slid on a wall, from the
//             friction work at the contact (|jt| x slide speed), on the vertices within 0.35 m facing the wall.
//   glass     the windscreen cracks (a star of cracks round the point in line with the hit) from dv 12 m/s, fully at 30.
//   lamps     a headlamp (front hit on its side, dv over 6 m/s) or a tail lamp (rear) breaks: its lens dark, its beam off.
//   mirrors   a side hit or scrape within 0.45 m of a door mirror folds it back (dv over 1.5 m/s, or 1 kJ of scraping);
//             over 7 m/s it comes off.
//   steering  a hit within 0.7 m of a front wheel with dv over 6 m/s bends its arm: the wheel toes by up to 3 degrees
//             (dyn.wheels[i].toe; the car pulls to that side); over 10 m/s the tyre is flat-spotted (dyn.wheels[i].flat,
//             a thump once a turn).
// Helicopter, from the skid loads: a touchdown faster than 3.0 m/s bends the cross tubes, each side by its share of the
// load (the body sits lower on that side by up to 25 cm: its skid contact points move up in the body's frame, the skid
// tubes' vertices with them); the tail bumper touching the ground is a tail strike (flagged; over 15 kN the tail rotor
// is struck, as a rotor strike is). Blades already bend (heli.js).
// demo.repair() / the key `0` puts both back to new. ?perf=-damage (or demo.perf.damage = false) turns it all off.
import * as THREE from 'three/webgpu';
import { attribute, materialColor, materialEmissive, materialRoughness, materialOpacity, mix, vec3, float, uniform, select, texture, vec2, smoothstep, max } from 'three/tsl';
import { PERF } from './perf.js';
import { partVerts, movePart } from './mirrors.js';

const BODY_MATS = ['body_paint', 'carbon_fiber', 'black_trim', 'light_headlight', 'light_brake', 'light_tail', 'light_indicator'];
const FIXED_BONES = /^(wheel_|steering_|suspension_|seat_)/; // (and steering_wheel) never dented
// the cabin's box and the wheels' envelopes in the car's frame (glTF: forward -Z, right +X)
const CABIN = new THREE.Box3(new THREE.Vector3(-0.74, 0.28, -1.0), new THREE.Vector3(0.74, 1.12, 0.52));
const WHEELS = [[-0.86, 0.345, -1.35, 0.4], [0.86, 0.345, -1.35, 0.4], [-0.85, 0.36, 1.35, 0.42], [0.85, 0.36, 1.35, 0.42]];
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _near = new THREE.Vector3(); // ((V8) _dent's panel point: room() uses _v)
const _p0 = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Distance from p (car frame) to the nearest of the cabin box and the wheel envelopes, along -dir (how far it may go). */
function room(p, dir) {
  let best = Infinity;
  // march along the push in 1 cm steps up to 25 cm: the first step inside the cabin or a wheel's cylinder
  for (let s = 0; s <= 0.25; s += 0.01) {
    _v.copy(p).addScaledVector(dir, s);
    if (CABIN.containsPoint(_v)) {
      best = s;
      break;
    }
    let hit = false;
    for (const [x, y, z, r] of WHEELS) {
      if (Math.abs(_v.x - x) < 0.17 && Math.hypot(_v.y - y, _v.z - z) < r) hit = true;
    }
    if (hit) {
      best = s;
      break;
    }
  }
  return best;
}

export class CarDamage {
  constructor(car) {
    this.car = car;
    this.parts = []; // { mesh, rest (positions), normals (rest), fixed (Uint8: 1 = not dented), scrape attribute }
    this.dents = 0;
    this.log = []; // what each impact did
    this.crack = uniform(0);
    this.crackAt = uniform(new THREE.Vector2(0.5, 0.5));
    this.broken = { head: [0, 0], tail: [0, 0] };
    this._u = { head: [uniform(1), uniform(1)], tail: [uniform(1), uniform(1)] };
    this._scrapeWork = { L: 0, R: 0 };
    this.ready = false;
  }

  init() {
    const car = this.car;
    const model = car.model;
    model.updateMatrixWorld(true);
    car.root.parent.traverse((o) => {
      // (the skinned batches (pieces under moving nodes) and the plain ones under the body: both in the car's frame)
      if (!o.isMesh || !o.userData.batch || !o.material || !o.name.includes('(merged')) return;
      if (o.isSkinnedMesh ? !(o.skeleton && o.skeleton.bones.includes(model)) : o.parent !== model) return;
      const name = o.material.name;
      if (!BODY_MATS.includes(name) && name !== 'glass') return;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const si = geo.attributes.skinIndex;
      const fixed = new Uint8Array(pos.count);
      const bones = o.skeleton ? o.skeleton.bones : [];
      if (si) for (let i = 0; i < pos.count; i++) {
        const b = bones[si.getX(i)];
        if (b && b !== model && (FIXED_BONES.test(b.name) || b.name === 'steering_wheel')) fixed[i] = 1;
      }
      const part = { mesh: o, name, rest: pos.array.slice(), normals: geo.attributes.normal ? geo.attributes.normal.array.slice() : null, fixed, limit: null, adj: null };
      if (name === 'body_paint' || name === 'carbon_fiber') {
        const s = new THREE.BufferAttribute(new Float32Array(pos.count), 1);
        geo.setAttribute('scrape', s);
        part.scrape = s;
      }
      this.parts.push(part);
    });
    // node inputs on the batches' materials: scraped paint, the cracked windscreen, the broken lamps
    for (const p of this.parts) {
      const m = this._nodeMaterial(p.mesh);
      if (p.scrape) {
        const s = attribute('scrape', 'float');
        // primer grey, then bare aluminium where it is worn through; rougher, no clear coat
        const bare = mix(vec3(0.42, 0.43, 0.42), vec3(0.62, 0.63, 0.64), smoothstep(0.55, 1.0, s));
        m.colorNode = mix(materialColor, bare, smoothstep(0.02, 0.35, s));
        m.roughnessNode = mix(materialRoughness, float(0.62), smoothstep(0.02, 0.35, s));
        if ('clearcoat' in m) m.clearcoatNode = float(m.clearcoat || 0).mul(float(1).sub(smoothstep(0.02, 0.3, s)));
      }
      if (p.name === 'glass') {
        const P = attribute('position', 'vec3'); // (the bind pose: the car's own frame)
        const onScreen = smoothstep(0.735, 0.76, P.y).mul(smoothstep(-0.41, -0.44, P.z)).mul(smoothstep(-1.29, -1.25, P.z));
        const uv = vec2(P.x.add(0.8).div(1.6), P.z.add(1.27).div(0.84));
        this.crackTex = this._crackTexture();
        const c = texture(this.crackTex, uv).r.mul(this.crack).mul(onScreen);
        m.colorNode = mix(materialColor, vec3(0.9, 0.92, 0.93), c);
        m.opacityNode = max(materialOpacity, c.mul(0.85));
      }
      if (p.name === 'light_headlight' || p.name === 'light_tail' || p.name === 'light_brake') {
        const which = p.name === 'light_headlight' ? 'head' : 'tail';
        const P = attribute('position', 'vec3');
        const [uL, uR] = this._u[which];
        const on = select(P.x.lessThan(0), uL, uR);
        m.emissiveNode = materialEmissive.mul(on);
        m.colorNode = materialColor.mul(on.mul(0.6).add(0.4));
      }
      m.needsUpdate = true;
    }
    this.ready = true;
  }

  /** A batch's material as a node material (the GLTF ones are not): copied, put on the batch and in car.mats. */
  _nodeMaterial(mesh) {
    const mat = mesh.material;
    if (mat.isNodeMaterial) return mat;
    const nm = mat.isMeshPhysicalMaterial ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
    for (const key in mat) {
      if (key === 'uuid' || key === 'id' || key === 'type' || key.startsWith('is') || typeof mat[key] === 'function') continue;
      try {
        nm[key] = mat[key];
      } catch (e) {
        /* read-only */
      }
    }
    nm.name = mat.name;
    mesh.material = nm;
    // (the car's own references: paint presets, lights)
    const car = this.car;
    for (const [k, v] of Object.entries(car.mats)) if (v === mat) car.mats[k] = nm;
    for (const [k, v] of Object.entries(car.lightMats)) if (v === mat) {
      nm.userData.base = mat.userData.base;
      car.lightMats[k] = nm;
    }
    // the hidden originals keep the old one (never drawn); bodyClearance reads geometry only
    return nm;
  }

  _crackTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    this._crackCanvas = c;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    this._drawCracks(0.5, 0.5, 0);
    return t;
  }

  /** A star of cracks round (u, v) (0..1 across the windscreen), with rings, `n` grows with the hit. */
  _drawCracks(u, v, k) {
    const c = this._crackCanvas;
    const g = c.getContext('2d');
    if (!k) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 512, 512);
      if (this.crackTex) this.crackTex.needsUpdate = true;
      return;
    }
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    const cx = u * 512;
    const cy = v * 512;
    let seed = Math.floor(u * 1000 + v * 7919 + k * 31);
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const arms = 9 + Math.round(k * 10);
    for (let i = 0; i < arms; i++) {
      let a = (i / arms) * Math.PI * 2 + rnd() * 0.5;
      let x = cx;
      let y = cy;
      const len = (90 + rnd() * 260) * (0.4 + k);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < len; s += 14) {
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a) * 14;
        y += Math.sin(a) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let r = 18; r < 120 * (0.4 + k); r += 22 + rnd() * 18) {
      g.lineWidth = 1.2;
      g.beginPath();
      for (let s = 0; s <= 24; s++) {
        const a = (s / 24) * Math.PI * 2;
        const rr = r * (0.85 + rnd() * 0.3);
        if (s === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.stroke();
    }
    // the shattered middle
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.arc(cx, cy, 10 + 20 * k, 0, Math.PI * 2);
    g.fill();
    this.crackTex.needsUpdate = true;
  }

  /**
   * One contact impulse (dyn.impacts entry) with its speed change dv (m/s). Called by car.js for each impact of a frame.
   */
  impact(im, dv, { scrape = true } = {}) {
    if (!PERF.damage || !this.ready) return;
    const car = this.car;
    const root = car.root;
    root.updateMatrixWorld(true);
    const p = root.worldToLocal(_a.set(im.x, im.y, im.z));
    // the push on the car (the wall's normal into the car), in the car's frame
    const n = _n.set(im.nx, 0, im.nz).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    const work = scrape ? Math.abs(im.jt * im.vt) : 0; // J of friction work in this step
    const entry = { dv: +dv.toFixed(2), at: p.toArray().map((x) => +x.toFixed(2)), n: n.toArray().map((x) => +x.toFixed(2)) };
    if (dv > 1.5) {
      // ((V8) was 0.2 (1 - exp(-dv / 18)): 7.8 cm for the 30 km/h barrier hit, hard to see; a real nose crushes about
      // 15 to 20 cm at that speed. Now 0.35 (1 - exp(-dv / 14)): 16 cm at dv 8.8 m/s, 12 at 6.4; the 22 cm limit stays)
      const depth = 0.35 * (1 - Math.exp(-dv / 14));
      const R = 0.25 + 0.012 * dv;
      entry.depthCm = +(depth * 100).toFixed(1);
      entry.moved = this._dent(p.clone(), n, depth, R);
      if (this._lastShift) entry.centredOnPanelM = this._lastShift;
      this.dents++;
    }
    if (!scrape && dv <= 1.5) return; // (the frame's sum below a dent: nothing to log)
    if (work > 40 || dv > 1.5) entry.scraped = this._scrape(p, n, Math.min(1, work / 2500 + (dv > 1.5 ? 0.25 : 0)));
    // glass
    if (dv > 12) {
      const k = THREE.MathUtils.smoothstep(dv, 12, 30);
      if (k > this.crack.value + 0.05) {
        this.crack.value = k;
        // the crack's centre: in line with the hit across the screen (x), low on it
        this.crackAt.value.set(THREE.MathUtils.clamp((p.x + 0.8) / 1.6, 0.12, 0.88), 0.35);
        this._drawCracks(this.crackAt.value.x, this.crackAt.value.y, k);
        if (car.mirrors) car.mirrors.setCrack('centre', k);
        entry.crack = +k.toFixed(2);
      }
    }
    // lamps
    const side = p.x < 0 ? 0 : 1;
    if (dv > 6 && p.z < -1.6) {
      this.broken.head[side] = 1;
      this._u.head[side].value = 0;
      entry.lamp = `head ${side ? 'R' : 'L'}`;
    }
    if (dv > 6 && p.z > 1.8) {
      this.broken.tail[side] = 1;
      this._u.tail[side].value = 0;
      entry.lamp = `tail ${side ? 'R' : 'L'}`;
    }
    // door mirrors
    if (car.mirrors) {
      for (const m of car.mirrors.list) {
        if (m.name === 'centre' || m.off) continue;
        const d = Math.hypot(p.x - m.pivot.x, p.z - (m.pivot.z - 0.1));
        // ((V8) or the flank flat against the wall on the mirror's side (within 18 deg of parallel): the contact is
        // then reported at the middle of the flank, but the mirror, the widest point, is on the wall too)
        const flank = Math.abs(n.x) > 0.95 && Math.sign(p.x) === Math.sign(m.pivot.x) && Math.abs(p.z) < 2.6;
        if ((d > 0.55 && !flank) || Math.abs(n.x) < 0.5) continue;
        this._scrapeWork[m.name] += work;
        if (dv > 7) {
          car.mirrors.knockOff(m.name);
          entry.mirror = m.name + ' off';
        } else if (dv > 1.5 || this._scrapeWork[m.name] > 1000) {
          car.mirrors.setFold(m.name, Math.min(1, m.fold + 0.5 + dv * 0.1));
          entry.mirror = m.name + ' folded';
        }
      }
    }
    // the steering arms and the tyres
    const dyn = car.dyn;
    WHEELS.forEach(([x, , z], i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > 0.7 || dv < 6) return;
      const w = dyn.wheels[i];
      if (i < 2) {
        const add = Math.min(0.052, (dv - 6) * 0.004) * (i === 0 ? 1 : -1);
        w.toe = THREE.MathUtils.clamp((w.toe || 0) + add, -0.052, 0.052);
        entry.toeDeg = +((w.toe * 180) / Math.PI).toFixed(2);
      }
      if (dv > 10 && !w.flat) {
        w.flat = Math.min(0.012, 0.004 + (dv - 10) * 0.0004);
        w.flatAt = w.spin;
        entry.flat = `${['FL', 'FR', 'RL', 'RR'][i]} ${(w.flat * 1000).toFixed(1)} mm`;
      }
    });
    if (dv > 1.5 || entry.mirror || entry.scraped > 0) this.log.push(entry);
    if (this.log.length > 40) this.log.shift();
  }

  /** Pushes the body's vertices within R of p (car frame) along n by depth x falloff; holds each to its limit. */
  _dent(p, n, depth, R) {
    let moved = 0;
    // ((V8) the contact comes from the collision footprint, a rectangle: at a corner it lies where the car is rounded
    // off, up to 0.4 m outside any panel (the 80 km/h corner hit at (1.12, 0.45, -2.2) moved no vertex). The dent is
    // centred on the nearest panel vertex instead when none is within half the radius)
    let best = Infinity;
    const near = _near;
    for (const part of this.parts) {
      if (part.name === 'glass') continue;
      const arr = part.mesh.geometry.attributes.position.array;
      for (let i = 0, k = 0; i < arr.length / 3; i++, k += 3) {
        if (part.fixed[i]) continue;
        const d2 = (arr[k] - p.x) ** 2 + ((arr[k + 1] - p.y) * 0.8) ** 2 + (arr[k + 2] - p.z) ** 2;
        if (d2 < best) {
          best = d2;
          near.set(arr[k], arr[k + 1], arr[k + 2]);
        }
      }
    }
    if (best > (R * 0.5) ** 2 && best < 1) {
      this._lastShift = +Math.sqrt(best).toFixed(3);
      p = _p0.copy(near);
    } else this._lastShift = 0;
    for (const part of this.parts) {
      if (part.name === 'glass') continue;
      const pos = part.mesh.geometry.attributes.position;
      const arr = pos.array;
      const rest = part.rest;
      if (!part.limit) part.limit = new Float32Array(pos.count).fill(-1);
      const touched = [];
      for (let i = 0; i < pos.count; i++) {
        if (part.fixed[i]) continue;
        const k = i * 3;
        const dx = arr[k] - p.x;
        const dy = (arr[k + 1] - p.y) * 0.8; // (a bumper-height hit reaches up the panel a little further)
        const dz = arr[k + 2] - p.z;
        const r2 = (dx * dx + dy * dy + dz * dz) / (R * R);
        if (r2 >= 1) continue;
        const f = (1 - r2) * (1 - r2);
        // the vertex's own limit along this push (from its rest place): room to the cabin / wheels less 3 cm, at most 22 cm
        _b.set(rest[k], rest[k + 1], rest[k + 2]);
        const lim = Math.max(0, Math.min(0.22, room(_b, n) - 0.03));
        let x = arr[k] + n.x * depth * f;
        let y = arr[k + 1] + n.y * depth * f;
        let z = arr[k + 2] + n.z * depth * f;
        // held to the limit (the whole displacement from new)
        const ox = x - rest[k];
        const oy = y - rest[k + 1];
        const oz = z - rest[k + 2];
        const len = Math.hypot(ox, oy, oz);
        if (len > lim) {
          const s = lim / len;
          x = rest[k] + ox * s;
          y = rest[k + 1] + oy * s;
          z = rest[k + 2] + oz * s;
        }
        arr[k] = x;
        arr[k + 1] = y;
        arr[k + 2] = z;
        touched.push(i);
      }
      if (touched.length) {
        pos.needsUpdate = true;
        this._renormal(part, touched);
        moved += touched.length;
      }
    }
    return moved;
  }

  /** The touched vertices' normals from their faces as they are now (area-weighted). */
  _renormal(part, list) {
    const geo = part.mesh.geometry;
    const nAttr = geo.attributes.normal;
    if (!nAttr || !geo.index) return;
    const pos = geo.attributes.position.array;
    if (!part.adj) {
      // vertex -> faces (CSR), once
      const idx = geo.index.array;
      const count = new Uint32Array(geo.attributes.position.count + 1);
      for (let i = 0; i < idx.length; i++) count[idx[i] + 1]++;
      for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
      const fill = count.slice();
      const faces = new Uint32Array(idx.length);
      for (let i = 0; i < idx.length; i++) faces[fill[idx[i]]++] = (i / 3) | 0;
      part.adj = { start: count, faces };
    }
    const { start, faces } = part.adj;
    const idx = geo.index.array;
    const na = nAttr.array;
    for (const v of list) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let k = start[v]; k < start[v + 1]; k++) {
        const f = faces[k] * 3;
        const a = idx[f] * 3;
        const b = idx[f + 1] * 3;
        const c = idx[f + 2] * 3;
        const ux = pos[b] - pos[a];
        const uy = pos[b + 1] - pos[a + 1];
        const uz = pos[b + 2] - pos[a + 2];
        const wx = pos[c] - pos[a];
        const wy = pos[c + 1] - pos[a + 1];
        const wz = pos[c + 2] - pos[a + 2];
        nx += uy * wz - uz * wy;
        ny += uz * wx - ux * wz;
        nz += ux * wy - uy * wx;
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      // (keep the authored side: the face normals' sum agrees with the old normal's side)
      const s = nx * na[v * 3] + ny * na[v * 3 + 1] + nz * na[v * 3 + 2] < 0 ? -1 : 1;
      na[v * 3] = (s * nx) / l;
      na[v * 3 + 1] = (s * ny) / l;
      na[v * 3 + 2] = (s * nz) / l;
    }
    nAttr.needsUpdate = true;
  }

  _scrape(p, n, amount) {
    let n0 = 0;
    for (const part of this.parts) {
      if (!part.scrape) continue;
      const pos = part.mesh.geometry.attributes.position.array;
      const nor = part.mesh.geometry.attributes.normal.array;
      const s = part.scrape.array;
      for (let i = 0; i < s.length; i++) {
        const k = i * 3;
        const d = Math.hypot(pos[k] - p.x, (pos[k + 1] - p.y) * 0.6, pos[k + 2] - p.z);
        if (d > 0.35) continue;
        // facing the wall (its normal against the push)
        const facing = -(nor[k] * n.x + nor[k + 1] * n.y + nor[k + 2] * n.z);
        if (facing < 0.25) continue;
        s[i] = Math.min(1, s[i] + amount * (1 - d / 0.35) * facing);
        n0++;
      }
      part.scrape.needsUpdate = true;
    }
    return n0;
  }

  /** As new. */
  repair() {
    for (const part of this.parts) {
      const geo = part.mesh.geometry;
      geo.attributes.position.array.set(part.rest);
      geo.attributes.position.needsUpdate = true;
      if (part.normals) {
        geo.attributes.normal.array.set(part.normals);
        geo.attributes.normal.needsUpdate = true;
      }
      if (part.scrape) {
        part.scrape.array.fill(0);
        part.scrape.needsUpdate = true;
      }
    }
    this.crack.value = 0;
    if (this._crackCanvas) this._drawCracks(0, 0, 0);
    this.broken = { head: [0, 0], tail: [0, 0] };
    for (const u of [...this._u.head, ...this._u.tail]) u.value = 1;
    this._scrapeWork = { L: 0, R: 0 };
    const car = this.car;
    if (car.mirrors) {
      // (the mirror housings' vertices are the batch's too: set back after the positions above)
      car.mirrors.reset();
    }
    for (const w of car.dyn.wheels) {
      w.toe = 0;
      w.flat = 0;
    }
    this.dents = 0;
    this.log.length = 0;
  }

  /** How dented it is now: the most any vertex has moved (cm) and how many moved more than 1 cm. */
  measure() {
    let worst = 0;
    let n = 0;
    for (const part of this.parts) {
      const a = part.mesh.geometry.attributes.position.array;
      const r = part.rest;
      for (let k = 0; k < a.length; k += 3) {
        const d = Math.hypot(a[k] - r[k], a[k + 1] - r[k + 1], a[k + 2] - r[k + 2]);
        if (d > worst) worst = d;
        if (d > 0.01) n++;
      }
    }
    return { worstCm: +(worst * 100).toFixed(1), movedOver1cm: n, crack: +this.crack.value.toFixed(2), broken: JSON.parse(JSON.stringify(this.broken)), toeDeg: this.car.dyn.wheels.map((w) => +(((w.toe || 0) * 180) / Math.PI).toFixed(2)), flatMm: this.car.dyn.wheels.map((w) => +((w.flat || 0) * 1000).toFixed(1)), mirrors: this.car.mirrors ? this.car.mirrors.list.map((m) => `${m.name}:${m.off ? 'off' : m.fold.toFixed(2)}`) : [] };
  }
}

/** The helicopter's bent skids and tail strikes (see the header). */
export class HeliDamage {
  constructor(heli) {
    this.heli = heli;
    this.bend = { L: 0, R: 0 };
    this.tailStrike = 0;
    this.log = [];
    this._rest = null;
    this._wasOn = false;
  }

  init() {
    const h = this.heli;
    const fm = h.fm;
    this._rest = fm.contacts.map((c) => c.r[1]);
    // the skid tubes' and cross tubes' vertices in the batch, to show the bend
    const fake = { model: h.model, root: h.root };
    this.parts = {};
    for (const side of ['L', 'R']) if (h.nodes['skid_' + side]) this.parts[side] = partVerts(fake, { node: h.nodes['skid_' + side] });
    if (h.nodes.skid_supports) this.parts.supports = partVerts(fake, { node: h.nodes.skid_supports });
    this.ready = true;
  }

  /** Each frame after the flight model: touchdowns and tail strikes. */
  update(dt) {
    if (!PERF.damage || !this.ready || !(dt > 0)) return;
    const s = this.heli.state;
    const c = s.contact || {};
    const on = !!c.onGround;
    const vs = s.verticalSpeed;
    if (on && !this._wasOn && this._lastVs < -3.0) {
      // the hardest touchdowns spread the cross tubes: each side by its share of the skid load
      const total = (c.L || 0) + (c.R || 0) || 1;
      const sink = -this._lastVs;
      const amount = Math.min(0.25, (sink - 3.0) * 0.06);
      const shareL = (c.L || 0) / total;
      for (const [side, share] of [['L', shareL], ['R', 1 - shareL]]) this.bend[side] = Math.min(0.25, this.bend[side] + amount * (0.5 + share));
      this._apply();
      this.log.push({ kind: 'hard landing', sink: +sink.toFixed(2), bendCm: { L: +(this.bend.L * 100).toFixed(1), R: +(this.bend.R * 100).toFixed(1) } });
    }
    if ((c.tail || 0) > 0) {
      this.tailStrike = Math.max(this.tailStrike, c.tail);
      if (!this._tailLogged) this.log.push({ kind: 'tail strike', kN: +(c.tail / 1000).toFixed(1) });
      this._tailLogged = true;
      if (c.tail > 15000) this.heli.damaged = true;
    } else this._tailLogged = false;
    this._wasOn = on;
    this._lastVs = vs;
  }

  _apply() {
    const fm = this.heli.fm;
    const skidX = 1.1;
    fm.contacts.forEach((c, i) => {
      if (c.skid === 'L') c.r[1] = this._rest[i] + this.bend.L;
      else if (c.skid === 'R') c.r[1] = this._rest[i] + this.bend.R;
    });
    // the tubes: each skid up by its bend; the cross tubes' ends with it (along x toward the skid)
    for (const side of ['L', 'R']) if (this.parts[side]) movePart(this.parts[side], new THREE.Matrix4().makeTranslation(0, this.bend[side], 0));
    const sup = this.parts.supports;
    if (sup) {
      for (const { mesh, idx, rest } of sup) {
        const pos = mesh.geometry.attributes.position;
        idx.forEach((i, k) => {
          const x = rest[k * 3];
          const b = x < 0 ? this.bend.L : this.bend.R;
          pos.setXYZ(i, x, rest[k * 3 + 1] + b * THREE.MathUtils.smoothstep(Math.abs(x), 0.3, skidX), rest[k * 3 + 2]);
        });
        pos.needsUpdate = true;
      }
    }
  }

  repair() {
    this.bend = { L: 0, R: 0 };
    this.tailStrike = 0;
    if (this._rest) this._apply();
    this.log.length = 0;
    this.heli.damaged = false;
  }
}
