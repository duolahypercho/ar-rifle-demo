// (V7) Is the keyboard slalom limit the key shaping or the car? node tools/v7_slalom.mjs
// The V5 scripted person (tools/v5_keys.mjs: looks every 50 ms, presses at least 80 ms) through the slalom (7 cones 18 m
// apart, the line 1.5 m either side) at 45 to 65 km/h, steering four ways:
//   keys     V5's: keys -> keys.js CarKeys (the shaping) -> dyn.input.steer (the dynamics' keyboard path)
//   fast     the same keys with the shaping's steering rates x 3 (out and back): is the shaping's ramp the limit?
//   instant  the same keys with no ramp at all (steer = the key, at once): the fastest a key can be
//   analog   no keys: the person's own wanted road-wheel angle each look into dyn.input.steerAngle (a perfect wheel)
// Copies v5_keys.mjs's person and runner (unchanged but for the steering mode); the car's physics is not touched.
import { CarDynamics, SURFACES } from '../src/car/dynamics.js';
import { LINE, TRACK_LENGTH, surfaceKind, SLALOM, nearTrack } from '../src/track.js';
import { CarKeys, HeliKeys } from '../src/keys.js';
import { Helicopter } from '../src/heli/flight.js';
import { FlightAssist } from '../src/heli/assist.js';

const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DT = 1 / 60;

const GROUND = {
  height(x, z, n) {
    if (n) {
      n.x = 0;
      n.y = 1;
      n.z = 0;
    }
    return 0;
  },
  surface(x, z) {
    const k = surfaceKind(x, z);
    return k === 'kerb' ? SURFACES.kerb : k === 'dirt' ? SURFACES.dirt : SURFACES.tarmac;
  },
  obstacles: [],
};

/** A key a person holds: pressed at least `min` s once down; `want` decides each look. */
class Key {
  constructor(min = 0.08) {
    this.down = false;
    this.t = 0;
    this.min = min;
    this.presses = [];
  }
  set(want, now) {
    if (want && !this.down) {
      this.down = true;
      this.t = now;
    } else if (!want && this.down && now - this.t >= this.min) {
      this.down = false;
      this.presses.push(now - this.t);
    }
  }
}
const stats = (a) => {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, median: +s[Math.floor(s.length / 2)].toFixed(3), min: +s[0].toFixed(3), max: +s[s.length - 1].toFixed(3), under200ms: a.filter((x) => x <= 0.2).length };
};



/** CarKeys with the steering mode: 'keys' as keys.js, 'fast' its rates x 3, 'instant' no ramp. */
class ModeKeys extends CarKeys {
  update(keys, speed, dt, mode = 'keys') {
    if (mode === 'keys' || mode === 'analog') return super.update(keys, speed, dt);
    const s = this.steer;
    super.update(keys, speed, dt);
    const want = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    if (mode === 'instant') this.steer = want;
    else if (mode === 'fast') this.steer = s + (this.steer - s) * 3 > 1 ? 1 : s + (this.steer - s) * 3 < -1 ? -1 : s + (this.steer - s) * 3;
    return this;
  }
}
function carPerson(d, path, { look = 0.05, speedOf, lookAhead = (v) => Math.max(9, v * 0.75) }) {
  const keys = { left: new Key(), right: new Key(), throttle: new Key(), brake: new Key() };
  let next = 0;
  let i0 = 0;
  const fn = (now) => {
    if (now < next) return keys;
    next = now + look;
    const rp = {};
    d.rootPose(rp);
    const v = d.speed;
    // the nearest path point ahead, then the aim point a look-ahead further on
    let best = Infinity;
    for (let k = 0; k < 60; k++) {
      const p = path[(i0 + k) % path.length];
      const dd = (p.x - rp.x) ** 2 + (p.z - rp.z) ** 2;
      if (dd < best) {
        best = dd;
        i0 = (i0 + k) % path.length;
      }
    }
    const L = lookAhead(v);
    let j = i0;
    let acc = 0;
    while (acc < L) {
      const a = path[j % path.length];
      const b = path[(j + 1) % path.length];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      j++;
    }
    const tgt = path[j % path.length];
    const f = d.forward;
    const yaw = Math.atan2(-f.x, -f.z);
    const ang = wrap(Math.atan2(-(tgt.x - rp.x), -(tgt.z - rp.z)) - yaw); // + left
    const kappa = (2 * Math.sin(ang)) / L;
    const want = Math.atan(kappa * 2.7); // road-wheel angle wanted (+ left)
    fn.want = want;
    const now_ = d.steerWheel / 15;
    const dead = 0.4 * D2R + 0.002 * Math.abs(want);
    keys.left.set(want - now_ > dead, now);
    keys.right.set(want - now_ < -dead, now);
    // speed: what the curvature ahead allows, braking at 0.85 g toward it
    let allowed = 99;
    let dist = 0;
    for (let k = 0; k < 120; k++) {
      const p = path[(i0 + k) % path.length];
      const q = path[(i0 + k + 1) % path.length];
      dist += Math.hypot(q.x - p.x, q.z - p.z);
      const vt = speedOf(p);
      allowed = Math.min(allowed, Math.sqrt(vt * vt + 2 * 0.85 * 9.81 * Math.max(0, dist - v * 0.3)));
    }
    keys.throttle.set(v < allowed - 1.0, now);
    keys.brake.set(v > allowed + 1.5, now);
    return keys;
  };
  fn.keys = keys;
  fn.want = 0;
  return fn;
}

function runCar({ path, start, seconds, speedOf, lookAhead, stopWhen, record, mode = 'keys' }) {
  const d = new CarDynamics(undefined, GROUND);
  d.reset(start.x, start.z, start.yaw);
  for (let i = 0; i < 60; i++) d.update(DT);
  const ck = new ModeKeys();
  const person = carPerson(d, path, { speedOf, lookAhead });
  const personWant = () => person.want;
  void personWant;
  let off = 0;
  let offMax = 0;
  let t = 0;
  let worstLat = 0;
  for (; t < seconds; t += DT) {
    const k = person(t);
    const o = ck.update({ left: k.left.down, right: k.right.down, throttle: k.throttle.down, brake: k.brake.down }, d.speed, DT, mode);
    if (mode === 'analog') d.input.steerAngle = person.want;
    else d.input.steer = o.steer;
    d.input.throttle = o.throttle;
    d.input.brake = o.brake;
    d.update(DT);
    let dirt = 0;
    for (const w of d.wheels) if (surfaceKind(w.patch.x, w.patch.z) === 'dirt') dirt++;
    if (dirt) off += DT;
    offMax = Math.max(offMax, dirt);
    worstLat = Math.max(worstLat, Math.abs(d.accBody.x) / 9.81);
    if (record) record(d, t, k);
    if (stopWhen && stopWhen(d, t)) break;
  }
  const keyStats = {};
  return { d, t, off, offMax, worstLat, person, ck, keyStatsOf: (k) => k };
}

export function carSlalom(kmh = 60, mode = 'keys') {
  // cones at x 60, z -40 - 18 i; pass them alternately, the line 1.5 m either side of each, from 60 m before the first
  const pts = [];
  const z0 = SLALOM.z0 + 80;
  for (let z = z0; z > SLALOM.z0 - SLALOM.gap * (SLALOM.count + 3); z -= 0.5) {
    const u = (SLALOM.z0 - z) / SLALOM.gap; // cone index
    const off = u < -0.5 ? 0 : u > SLALOM.count - 0.5 ? 0 : 1.5 * Math.cos(Math.PI * u) * Math.min(1, (u + 0.5) * 2) * Math.min(1, (SLALOM.count - 0.5 - u) * 2);
    pts.push({ x: SLALOM.x + off, z, k: 0 });
  }
  let conesHit = 0;
  const hit = new Set();
  let minClear = Infinity;
  let maxSide = 0;
  const r = runCar({
    path: pts, start: { x: SLALOM.x, z: z0, yaw: 0 }, seconds: 30, speedOf: () => kmh / 3.6, lookAhead: (v) => Math.max(5, v * 0.4),
    mode,
    record: (d) => {
      const rp = {};
      d.rootPose(rp);
      for (let i = 0; i < SLALOM.count; i++) {
        const cz = SLALOM.z0 - i * SLALOM.gap;
        // the cone against the footprint (half width 1.015, half length 2.4)
        const f = d.forward;
        const dx = SLALOM.x - rp.x;
        const dz = cz - rp.z;
        const along = dx * f.x + dz * f.z;
        const side = Math.abs(dx * -f.z + dz * f.x);
        if (Math.abs(along) < 2.4) {
          minClear = Math.min(minClear, side - 1.015);
          if (side < 1.015 + 0.15) hit.add(i);
        }
      }
      maxSide = Math.max(maxSide, Math.abs(d.accBody.x) / 9.81);
    },
    stopWhen: (d) => {
      const rp = {};
      d.rootPose(rp);
      return rp.z < SLALOM.z0 - SLALOM.gap * (SLALOM.count + 1);
    },
  });
  const pk = r.person.keys;
  return { kmh, timeS: +r.t.toFixed(2), conesHit: hit.size, minConeClearanceM: +minClear.toFixed(2), maxLatG: +maxSide.toFixed(2), endKmh: +(r.d.speed * 3.6).toFixed(1),
    presses: { left: stats(pk.left.presses), right: stats(pk.right.presses), throttle: stats(pk.throttle.presses), brake: stats(pk.brake.presses) } };
}


const out = [];
for (const mode of ['keys', 'fast', 'instant', 'analog']) {
  for (const kmh of [45, 50, 55, 60, 65]) {
    const r = carSlalom(kmh, mode);
    out.push({ mode, kmh, conesHit: r.conesHit, minConeClearanceM: r.minConeClearanceM, maxLatG: r.maxLatG, endKmh: r.endKmh, leftPresses: r.presses.left.n, medianPressS: r.presses.left.median });
    console.log(JSON.stringify(out[out.length - 1]));
  }
}
