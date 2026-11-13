// (V10) The parachute (VEHICLE_NOTES.md, "Parachute"): packs on crates (walk into one to pick it up: no key),
// worn on the back with the slung gun resting against it; in a fall from 30 m up, Space opens it (exits.js plays the
// deploy and hang clips or their stand-ins); a ram-air canopy flies it: about 10 m/s forward and 5 m/s down, A / D pull
// a toggle (a turn of up to about 60 deg/s with bank, and a faster descent in it), S pulls both (the flare: slower and
// flatter for about 1.5 s, then a stall if held), W lets both up (a little faster), the wind drifts it.
// Everything here is built in code: the pack, its crate and marker, a 9-cell canopy, its suspension and steering lines,
// the risers at the shoulders, the toggles drawn at the palms every frame. Every mesh is in the scene from the start
// (hidden until used) so the loading screen's warm-up builds their pipelines; nothing holds a light.
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';
import { WEATHER } from './terrain.js';
import { PALM_LOCAL } from './character.js';
import { uv, uniform, float } from 'three/tsl';

const CELLS = 9;
const SPAN = 7.6; // m
const CHORD = 2.7;
const THICK = 0.36; // at a quarter chord
const ARC = 6.2; // m, the radius the span is curved round (the tips lower)
const LINES = 5.0; // m from the riser tops to the canopy's underside
const RISER = 0.45;
const REFILL = 30; // s, a crate's pack back after it was taken
const D = Math.PI / 180;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const ease = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** A box with its edges rounded (the vertices pushed onto a superellipsoid): the pack. */
function roundedBox(w, h, d, r = 0.035) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 8, 3);
  const p = g.attributes.position;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const cx = THREE.MathUtils.clamp(x, -hx, hx);
    const cy = THREE.MathUtils.clamp(y, -hy, hy);
    const cz = THREE.MathUtils.clamp(z, -hz, hz);
    _v.set(x - cx, y - cy, z - cz);
    if (_v.lengthSq() > 1e-9) _v.setLength(r);
    p.setXYZ(i, cx + _v.x, cy + _v.y, cz + _v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The canopy: top and bottom skins over 9 cells, curved round the span, an airfoil in section (open mouths at the
 * leading edge shown dark), the top skin dipping a little at each rib; cells alternate orange and off-white. Local
 * frame: span X, up Y, the leading edge toward -Z; the origin at the middle of the span on the underside's mid-chord.
 */
function canopyGeometry() {
  const nS = CELLS * 6;
  const nC = 14;
  const pos = [];
  const col = [];
  const idx = [];
  const orange = new THREE.Color(0xe2602a);
  const white = new THREE.Color(0xeeeae0);
  const dark = new THREE.Color(0x2a2522);
  const under = (c) => c.clone().multiplyScalar(0.72);
  const at = (s, c, top) => {
    // s -1..1 along the span, c 0..1 from the leading edge
    const th = (s * SPAN) / 2 / ARC;
    const cell = (s + 1) / 2 * CELLS;
    const inCell = cell - Math.floor(cell);
    const t = THICK * 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c * c * c - 0.1036 * c ** 4);
    const scallop = top ? 0.82 + 0.18 * Math.sin(Math.PI * inCell) : 1;
    const y = top ? t * scallop : -t * 0.25;
    const r = ARC + y;
    return [Math.sin(th) * r, Math.cos(th) * r - ARC, -CHORD / 2 + c * CHORD];
  };
  for (const top of [true, false]) {
    const base = pos.length / 3;
    for (let i = 0; i <= nS; i++) {
      const s = -1 + (2 * i) / nS;
      const cell = Math.min(CELLS - 1, Math.floor(((s + 1) / 2) * CELLS));
      const c0 = cell % 2 ? white : orange;
      for (let j = 0; j <= nC; j++) {
        const c = (j / nC) ** 1.6;
        pos.push(...at(s, c, top));
        const k = top ? c0 : under(c0);
        const mouth = !top && c < 0.09 ? dark : k;
        col.push(mouth.r, mouth.g, mouth.b);
      }
    }
    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nC; j++) {
        const a = base + i * (nC + 1) + j;
        const b = a + nC + 1;
        if (top) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.at = at;
  return g;
}

export class Parachute {
  constructor(scene) {
    this.scene = scene;
    this.worn = false;
    this.jumped = false;
    this.crates = [];
    this.events = [];
    this.t = 0;
    const nylon = new THREE.MeshStandardNodeMaterial({ color: 0x2c3328, roughness: 0.78, metalness: 0 });
    const strap = new THREE.MeshStandardNodeMaterial({ color: 0x1b1d1f, roughness: 0.7, metalness: 0 });
    const handle = new THREE.MeshStandardNodeMaterial({ color: 0xe0661c, roughness: 0.5, metalness: 0 });
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x7c5a37, roughness: 0.85, metalness: 0 });
    const toggleMat = new THREE.MeshStandardNodeMaterial({ color: 0xe8c22c, roughness: 0.55, metalness: 0 });
    this.mats = { nylon, strap, handle, wood, toggleMat };
    this._packGeo = roundedBox(0.33, 0.44, 0.15);
    this._handleGeo = new THREE.SphereGeometry(0.028, 12, 8);
    this._flapGeo = roundedBox(0.3, 0.06, 0.16, 0.02);
    // the pack worn on the back
    this.back = this._pack();
    this.back.visible = false;
    scene.add(this.back);
    // the canopy
    const cg = canopyGeometry();
    this._at = cg.userData.at;
    this.fabric = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    this.canopy = new THREE.Mesh(cg, this.fabric);
    this.canopy.castShadow = true;
    this.canopy.visible = false;
    this.canopy.frustumCulled = false;
    scene.add(this.canopy);
    // the lines: per rib (10) two suspension lines (A at 12 %, C at 68 % chord) to the riser top of its side, and from
    // the trailing edge's outer three ribs a steering line to the toggle of its side
    this._ribs = [];
    for (let i = 0; i <= CELLS; i++) this._ribs.push(-1 + (2 * i) / CELLS);
    this._lineCount = this._ribs.length * 2 + 6;
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this._lineCount * 6), 3));
    this.lineMat = new THREE.LineBasicNodeMaterial({ color: 0x3a3632 });
    this.lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    // risers (webbing from the shoulders up) and toggles (in the hands)
    const riserGeo = new THREE.BoxGeometry(0.035, 1, 0.012).translate(0, 0.5, 0);
    this.risers = [0, 1].map(() => {
      const m = new THREE.Mesh(riserGeo, strap);
      m.visible = false;
      scene.add(m);
      return m;
    });
    const tg = new THREE.CylinderGeometry(0.018, 0.018, 0.11, 10).rotateZ(Math.PI / 2);
    this.toggles = [0, 1].map(() => {
      const m = new THREE.Mesh(tg, toggleMat);
      m.visible = false;
      scene.add(m);
      return m;
    });
    // (the marker: a soft column of light round the crate, brightest at the ground and gone by its top, pulsing)
    this.markerMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.markerPulse = uniform(0.3);
    this.markerMat.opacityNode = float(1).sub(uv().y).pow(2.2).mul(this.markerPulse);
    this._markerGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.6, 32, 1, true).translate(0, 0.8, 0);
    this.collapse = null;
    this.packLocal = null;
    this.packShift = new THREE.Vector3(); // the slung gun's stow place moved out by the pack (chest frame)
  }

  /** The pack as a group: the container, its top flap, the orange pilot-chute handle low on the right. */
  _pack() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this._packGeo, this.mats.nylon);
    const flap = new THREE.Mesh(this._flapGeo, this.mats.strap);
    flap.position.set(0, 0.19, 0.005);
    const h = new THREE.Mesh(this._handleGeo, this.mats.handle);
    h.position.set(0.12, -0.2, 0.08);
    for (const m of [body, flap, h]) {
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  /** A low crate with a pack on it and a soft marker round it (yaw: which way the crate faces). */
  addCrate(x, z, yaw = 0) {
    const g = groundAt(x, z);
    // ((V10, integration) a low eight-sided crate 0.5 m across: para-pickup stands the body 0.45 m from the pack facing it,
    // from whichever side he walks in (the toes 0.33 m from its middle, clear of its 0.25 m)
    const crate = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.42, 8), this.mats.wood);
    crate.position.set(x, g + 0.21, z);
    crate.rotation.y = yaw;
    crate.castShadow = crate.receiveShadow = true;
    this.scene.add(crate);
    const pack = this._pack();
    pack.position.set(x, g + 0.42 + 0.075, z);
    pack.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
    this.scene.add(pack);
    const marker = new THREE.Mesh(this._markerGeo, this.markerMat);
    marker.position.set(x, g, z);
    marker.renderOrder = 3;
    this.scene.add(marker);
    const c = { x, z, yaw, crate, pack, marker, has: true, t: 0, home: { pos: pack.position.clone(), quat: pack.quaternion.clone() } };
    this.crates.push(c);
    return c;
  }

  // ---------------------------------------------------------------- (V10, integration) the pickup clip
  /** events.grab: the crate's pack goes with the right palm from here (its place kept in the hand's frame). */
  carryStart(c, ch) {
    const hand = ch.bones.RightHand;
    hand.updateWorldMatrix(true, false);
    c.pack.updateMatrixWorld(true);
    this.carrying = { c, rel: new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(c.pack.matrixWorld) };
  }

  /** Each frame between grab and onBack: the pack where the right hand has it. */
  carryUpdate(ch) {
    const C = this.carrying;
    if (!C) return;
    const hand = ch.bones.RightHand;
    hand.updateWorldMatrix(true, false);
    _m.multiplyMatrices(hand.matrixWorld, C.rel);
    _m.decompose(C.c.pack.position, C.c.pack.quaternion, _v);
    C.c.pack.updateMatrixWorld(true);
  }

  /** events.onBack: it is worn; the worn pack takes over from where the hand left it, eased onto its place (0.15 s). */
  putOn(ch) {
    const C = this.carrying;
    this.carrying = null;
    this.worn = true;
    this.jumped = false;
    if (!this.packLocal || this.packLocal.body !== ch._body) this._fitPack(ch);
    if (C) {
      this.backBlend = { pos: C.c.pack.position.clone(), quat: C.c.pack.quaternion.clone(), t: 0 };
      C.c.pack.visible = false;
      C.c.pack.position.copy(C.c.home.pos);
      C.c.pack.quaternion.copy(C.c.home.quat);
    }
    this.events.push('pickup');
  }

  /** The pickup starts: the place on the back fitted on the body standing as it is now (before it bends). */
  fitFor(ch) {
    this._fitPack(ch);
  }

  /**
   * Each frame: refills, the pickup (walking into a crate's pack on foot), the marker's pulse, the worn pack on the back.
   * `onFoot`: the player can pick up now; `showBack`: the pack is shown on the back (not in a cabin).
   */
  update(dt, ch, player, { onFoot, showBack }) {
    this.t += dt;
    for (const c of this.crates) {
      if (!c.has) {
        c.t += dt;
        if (c.t >= REFILL && !(this.carrying && this.carrying.c === c)) {
          c.has = true;
          c.pack.position.copy(c.home.pos);
          c.pack.quaternion.copy(c.home.quat);
          c.pack.visible = c.marker.visible = true;
        }
      }
      if (onFoot && !this.worn && c.has && Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 0.6) {
        c.has = false;
        c.t = 0;
        c.marker.visible = false;
        // ((V10, integration) para-pickup when the body's pack has it (exits.js: the pack goes with the right palm from
        // its events.grab to events.onBack); else on at once
        if (this.onPickup && this.onPickup(c)) continue;
        c.pack.visible = false;
        this.worn = true;
        this.jumped = false;
        this.packLocal = null;
        this.events.push('pickup');
      }
    }
    this.markerPulse.value = 0.24 + 0.1 * Math.sin(this.t * 2.4);
    // the pack on the back, from the chest's frame (its place taken from the body standing as it is when it goes on)
    const show = this.worn && showBack;
    if (this.worn && (!this.packLocal || this.packLocal.body !== ch._body)) this._fitPack(ch);
    this.back.visible = show;
    if (show) this._placeBack(ch, dt);
    if (!this.worn) this.packShift.set(0, 0, 0);
    this._collapse(dt);
  }

  /** Where the pack sits on this body, in its chest's frame: 17 cm behind the chest, 8 cm down; the gun moved 13 cm out. */
  _fitPack(ch) {
    const b = ch.bones;
    b.Spine2.updateWorldMatrix(true, false);
    const cp = b.Spine2.getWorldPosition(new THREE.Vector3());
    const cq = b.Spine2.getWorldQuaternion(new THREE.Quaternion());
    const rq = ch.root.getWorldQuaternion(new THREE.Quaternion());
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(rq);
    const inv = cq.clone().invert();
    const world = cp.clone().addScaledVector(back, 0.17).add(new THREE.Vector3(0, -0.08, 0));
    this.packLocal = { body: ch._body, pos: world.sub(cp).applyQuaternion(inv), quat: inv.clone().multiply(rq) };
    this.packShift.copy(back).multiplyScalar(0.13).applyQuaternion(inv);
  }

  _placeBack(ch, dt = 0) {
    const b = ch.bones;
    const cp = b.Spine2.getWorldPosition(_v);
    const cq = b.Spine2.getWorldQuaternion(_q);
    this.back.position.copy(this.packLocal.pos).applyQuaternion(cq).add(cp);
    this.back.quaternion.copy(cq).multiply(this.packLocal.quat);
    const B = this.backBlend;
    if (B) {
      B.t += dt;
      const u = ease(B.t / 0.15);
      this.back.position.lerpVectors(B.pos, _v2.copy(this.back.position), u);
      this.back.quaternion.slerpQuaternions(B.quat, _q2.copy(this.back.quaternion), u);
      if (u >= 1) this.backBlend = null;
    }
  }

  /** The pack's gone (WASTED). */
  drop() {
    this.worn = false;
    this.back.visible = false;
  }

  // ---------------------------------------------------------------- the canopy's flight
  /** Opening: exits.js has started para-deploy; the canopy streams out from the back. */
  deploy(s) {
    const c = s.chute;
    c.yaw = s.heldYaw;
    c.bank = 0;
    c.yawRate = 0;
    c.toggleL = c.toggleR = 0;
    c.toggleLv = c.toggleRv = 0;
    c.flareE = 1;
    this.collapse = null;
    this.events.push('deploy');
  }

  /** The canopy's own velocity (airspeed along its heading, its sink, the wind). */
  flyVel(c, out) {
    const fwdX = -Math.sin(c.yaw);
    const fwdZ = -Math.cos(c.yaw);
    return out.set(fwdX * 10 + WEATHER.now.x, -5, fwdZ * 10 + WEATHER.now.z);
  }

  /**
   * One step of canopy flight: the toggles (A / D one, S both) ramp at 4 a second; the turn rate up to 60 deg/s with
   * the bank it needs; speed and sink by the input; the body's velocity eased onto it (0.7 s along, 0.5 s down).
   */
  fly(dt, c, vel, keys) {
    // ((V10, integration) each toggle on a critically damped spring (about 0.35 s from up to down): a pull that reverses
    // half way (letting a turn go into the flare) turns the hand round smoothly; at a constant rate it reversed in a frame)
    const W = 12;
    for (const [k, want] of [['L', keys.left || keys.flare ? 1 : 0], ['R', keys.right || keys.flare ? 1 : 0]]) {
      const x = c['toggle' + k];
      const vk = 'toggle' + k + 'v';
      c[vk] = (c[vk] || 0) + (W * W * (want - x) - 2 * W * (c[vk] || 0)) * dt;
      c['toggle' + k] = THREE.MathUtils.clamp(x + c[vk] * dt, 0, 1);
    }
    const turn = c.toggleR - c.toggleL; // + right
    const both = Math.min(c.toggleL, c.toggleR);
    if (both > 0.5) c.flareE = Math.max(0, c.flareE - dt / 1.5);
    else c.flareE = Math.min(1, c.flareE + dt / 3);
    let va = 10 + (keys.fast ? 1.8 : 0);
    let w = 5 + (keys.fast ? 0.8 : 0);
    va -= 1.2 * Math.abs(turn);
    w += 2.5 * Math.abs(turn);
    if (both > 0.05) {
      if (c.flareE > 0) {
        va = THREE.MathUtils.lerp(va, 4, both);
        w = THREE.MathUtils.lerp(w, 1.2, both);
      } else {
        va = THREE.MathUtils.lerp(va, 3, both);
        w = THREE.MathUtils.lerp(w, 5.6, both); // (held past the flare: mushing down, nearly a stall)
      }
    }
    c.va = va;
    c.sink = w;
    c.yawRate += (-turn * 60 * D - c.yawRate) * (1 - Math.exp(-dt / 0.35));
    c.yaw += c.yawRate * dt;
    const bank = THREE.MathUtils.clamp(Math.atan((va * -c.yawRate) / 9.81), -0.6, 0.6);
    c.bank += (bank - c.bank) * (1 - Math.exp(-dt / 0.4));
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const kh = 1 - Math.exp(-dt / 0.7);
    const kv = 1 - Math.exp(-dt / (both > 0.05 ? 0.35 : 0.5));
    vel.x += (fx * va + WEATHER.now.x - vel.x) * kh;
    vel.z += (fz * va + WEATHER.now.z - vel.z) * kh;
    vel.y += (-w - vel.y) * kv;
  }

  // ---------------------------------------------------------------- drawing it
  /** The canopy, lines, risers and toggles for the frame (after the body is posed). */
  pose(dt, ch, s) {
    const c = s && s.chute;
    const flying = c && (c.state === 'deploy' || c.state === 'canopy');
    if (!flying && !this.collapse) {
      this._hide();
      return;
    }
    if (!flying) return;
    const b = ch.bones;
    // ((V10, integration) the risers meet the harness at the clavicles (the clip pass's note): 60 % out along them)
    const clav = (side) => (b[side + 'Shoulder'] ? b[side + 'Shoulder'].getWorldPosition(new THREE.Vector3()).lerp(b[side + 'Arm'].getWorldPosition(new THREE.Vector3()), 0.6) : b[side + 'Arm'].getWorldPosition(new THREE.Vector3()));
    const L = clav('Left');
    const R = clav('Right');
    const harness = L.clone().add(R).multiplyScalar(0.5);
    // the canopy's frame: heading and bank, trimmed nose-down a little, above the harness and a little ahead
    let k = 1;
    let up = LINES + RISER;
    let spread = 1;
    if (c.state === 'deploy') {
      const u = (c.t - c.pullT) / Math.max(0.05, c.openT - c.pullT); // streaming out
      const w = (c.t - c.openT) / Math.max(0.05, c.clip.duration - c.openT); // inflating
      if (u <= 0) {
        this._hide();
        return;
      }
      up = (LINES + RISER) * ease(u);
      k = 0.12 + 0.88 * ease(w);
      spread = 0.25 + 0.75 * ease(w);
    }
    _q.setFromEuler(_e.set(-6 * D, c.yaw, c.bank, 'YXZ'));
    const cpos = _v.set(0, up, -0.5 * k).applyQuaternion(_q).add(harness);
    this.canopy.position.copy(cpos);
    this.canopy.quaternion.copy(_q);
    this.canopy.scale.set(spread, k, 0.4 + 0.6 * k);
    this.canopy.visible = true;
    this.canopy.updateMatrixWorld(true);
    // risers: from each shoulder up toward the canopy
    const riserTop = [];
    for (const [i, P] of [[0, L], [1, R]]) {
      const top = _v2.set(i === 0 ? -0.08 : 0.08, RISER, 0).applyQuaternion(_q).add(P);
      riserTop.push(top.clone());
      const m = this.risers[i];
      m.position.copy(P);
      m.quaternion.setFromUnitVectors(UP, _v3.subVectors(top, P).normalize());
      m.scale.set(1, top.distanceTo(P), 1);
      m.visible = true;
    }
    // the toggles at the palms
    const palms = [];
    for (const [i, side] of [[0, 'Left'], [1, 'Right']]) {
      const hand = b[side + 'Hand'];
      hand.getWorldQuaternion(_q2);
      const palm = hand.getWorldPosition(new THREE.Vector3()).add(_v3.copy(PALM_LOCAL).applyQuaternion(_q2));
      palms.push(palm);
      const t = this.toggles[i];
      t.position.copy(palm);
      t.quaternion.copy(_q2);
      t.visible = true;
    }
    // the lines
    const arr = this.lineGeo.attributes.position.array;
    let n = 0;
    const put = (a, bb) => {
      arr[n++] = a.x;
      arr[n++] = a.y;
      arr[n++] = a.z;
      arr[n++] = bb.x;
      arr[n++] = bb.y;
      arr[n++] = bb.z;
    };
    const m = this.canopy.matrixWorld;
    for (const s2 of this._ribs) {
      const side = s2 < 0 ? 0 : 1;
      for (const cc of [0.12, 0.68]) put(_v.fromArray(this._at(s2, cc, false)).applyMatrix4(m), riserTop[side]);
    }
    for (const [i, s2] of [[0, -1], [0, -7 / 9], [0, -5 / 9], [1, 1], [1, 7 / 9], [1, 5 / 9]]) put(_v.fromArray(this._at(s2, 0.98, false)).applyMatrix4(m), palms[i]);
    this.lineGeo.attributes.position.needsUpdate = true;
    this.lines.visible = true;
  }

  _hide() {
    this.canopy.visible = this.lines.visible = false;
    for (const m of this.risers) m.visible = false;
    for (const m of this.toggles) m.visible = false;
  }

  /** Down: the canopy settles behind the body and goes; the pack is used up if it was opened. */
  landed(s, kind) {
    const c = s.chute;
    if (!c) return;
    if (c.state === 'canopy' || c.state === 'deploy') {
      this.worn = false;
      this.back.visible = false;
      this.packLocal = null;
      const g = groundAt(this.canopy.position.x, this.canopy.position.z);
      // (it overflies the flared body a little and settles on the ground ahead of it, nose down, spread)
      const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      const end = s.c.clone().addScaledVector(fwd, 4.5);
      end.y = groundAt(end.x, end.z) + 0.05;
      this.collapse = { t: 0, from: this.canopy.position.clone(), fromQ: this.canopy.quaternion.clone(), fromS: this.canopy.scale.clone(), to: end, toQ: new THREE.Quaternion().setFromEuler(_e.set(0, c.yaw, 0, 'YXZ')), g };
      this.lines.visible = false;
      for (const m of this.risers) m.visible = false;
      for (const m of this.toggles) m.visible = false;
    }
    c.state = 'landed';
    void kind;
  }

  _collapse(dt) {
    const C = this.collapse;
    if (!C) return;
    C.t += dt;
    const u = ease(C.t / 1.3);
    this.canopy.position.lerpVectors(C.from, C.to, u);
    this.canopy.quaternion.slerpQuaternions(C.fromQ, C.toQ, u);
    this.canopy.scale.set(THREE.MathUtils.lerp(C.fromS.x, 0.75, u), THREE.MathUtils.lerp(C.fromS.y, 0.06, u), THREE.MathUtils.lerp(C.fromS.z, 1.1, u));
    // then it sinks out of sight
    if (C.t > 3) this.canopy.position.y -= Math.min(0.5, (C.t - 3) * 0.4);
    this.canopy.visible = true;
    if (C.t > 4.3) {
      this.canopy.visible = false;
      this.collapse = null;
    }
  }

  /** Everything shown for one frame (the loading screen's warm-up). */
  warmShow() {
    const was = [this.back, this.canopy, this.lines, ...this.risers, ...this.toggles].map((o) => o.visible);
    for (const o of [this.back, this.canopy, this.lines, ...this.risers, ...this.toggles]) o.visible = true;
    return () => [this.back, this.canopy, this.lines, ...this.risers, ...this.toggles].forEach((o, i) => (o.visible = was[i]));
  }
}
