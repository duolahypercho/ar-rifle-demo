// (V5) Keyboard feel, driven like a person: node tools/v5_keys.mjs [car|heli|taps|all]
// The person looks at the road (or the instruments) every 50 ms, decides which keys to hold, presses for at least
// 80 ms and never taps shorter; it never sends anything but key down / up into keys.js (CarKeys, HeliKeys), whose
// output goes into the same dynamics and flight model (and assist) as the game. The ground is flat (the track's 4.5
// cm kerbs left out); the surface under each tyre is the track's (track.js surfaceKind), so "off the tarmac" is a
// tyre on dirt.
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

// ------------------------------------------------------------------------------------------- car
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
  return fn;
}

function runCar({ path, start, seconds, speedOf, lookAhead, stopWhen, record }) {
  const d = new CarDynamics(undefined, GROUND);
  d.reset(start.x, start.z, start.yaw);
  for (let i = 0; i < 60; i++) d.update(DT);
  const ck = new CarKeys();
  const person = carPerson(d, path, { speedOf, lookAhead });
  let off = 0;
  let offMax = 0;
  let t = 0;
  let worstLat = 0;
  for (; t < seconds; t += DT) {
    const k = person(t);
    const o = ck.update({ left: k.left.down, right: k.right.down, throttle: k.throttle.down, brake: k.brake.down }, d.speed, DT);
    d.input.steer = o.steer;
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

export function carLap() {
  // the track's centre line from a rolling start just before the line, one full loop
  const path = LINE;
  const p0 = LINE[0];
  const speedOf = (p) => (Math.abs(p.k) > 0 ? Math.sqrt((0.9 * 9.81) / Math.abs(p.k)) : 95);
  const d0 = { x: p0.x, z: p0.z, yaw: p0.yaw };
  let s0 = null;
  let lapT = null;
  let lastS = 0;
  let wrapped = false;
  let maxDev = 0;
  let maxDevAt = null;
  const keysLog = { left: [], right: [], throttle: [], brake: [] };
  const r = runCar({
    path, start: d0, seconds: 200, speedOf,
    record: (d, t) => {
      const rp = {};
      d.rootPose(rp);
      const n = nearTrack(rp.x, rp.z, 30);
      if (!n) return;
      if (n.dist > maxDev) {
        maxDev = n.dist;
        maxDevAt = Math.round(n.s);
      }
      if (s0 === null) s0 = n.s;
      if (n.s < lastS - 1000) wrapped = true;
      lastS = n.s;
      if (wrapped && n.s >= s0 && lapT === null) lapT = t;
    },
    stopWhen: () => lapT !== null,
  });
  const pk = r.person.keys;
  return { lapS: lapT && +lapT.toFixed(2), trackM: Math.round(TRACK_LENGTH), offTarmacS: +r.off.toFixed(2), wheelsOffMax: r.offMax, maxFromCentreM: +maxDev.toFixed(2), maxAtS: maxDevAt, maxLatG: +r.worstLat.toFixed(2),
    presses: { left: stats(pk.left.presses), right: stats(pk.right.presses), throttle: stats(pk.throttle.presses), brake: stats(pk.brake.presses) } };
}

export function carSlalom(kmh = 60) {
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

/** What one tap does: the wheel, the road wheels, the throttle, at 0, 50, 100, 200 km/h. */
export function carTaps() {
  const out = [];
  for (const kmh of [0, 50, 100, 200]) {
    for (const ms of [80, 120, 200]) {
      const d = new CarDynamics(undefined, GROUND);
      d.reset(0, 0, 0);
      for (let i = 0; i < 30; i++) d.update(DT);
      const ck = new CarKeys();
      if (kmh) {
        d.vel.z = -kmh / 3.6;
        for (const w of d.wheels) w.omega = kmh / 3.6 / w.r;
        d.engine.locked = false;
        d.hold = 0;
      }
      let peakWheel = 0;
      let peakThr = 0;
      let backAt = null;
      for (let t = 0; t < 1.2; t += DT) {
        const down = t < ms / 1000 - 1e-9;
        const o = ck.update({ left: down, right: false, throttle: down, brake: false }, d.speed, DT);
        d.input.steer = o.steer;
        d.input.throttle = 0;
        d.update(DT);
        peakWheel = Math.max(peakWheel, d.steerWheel / D2R);
        peakThr = Math.max(peakThr, o.throttle);
        if (!down && backAt === null && d.steerWheel / D2R < 0.5) backAt = t;
      }
      out.push({ kmh, tapMs: ms, wheelDeg: +peakWheel.toFixed(1), roadDeg: +(peakWheel / 15).toFixed(2), throttlePct: Math.round(peakThr * 100), backToCentreS: backAt && +(backAt - ms / 1000).toFixed(2) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ helicopter
const FLAT = () => ({ height: 0, normal: [0, 1, 0], friction: 1 });

function heliRig({ assistOn = true }) {
  const fm = new Helicopter({ groundAt: FLAT });
  fm.reset({ position: [0, 0, 0], heading: 0, running: 'flight', controls: { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0 } });
  for (let i = 0; i < 120; i++) fm.step(DT);
  const as = new FlightAssist();
  as.reset(fm.state);
  const hk = new HeliKeys();
  const keys = { fwd: new Key(), back: new Key(), left: new Key(), right: new Key(), pedL: new Key(), pedR: new Key(), up: new Key(), down: new Key() };
  const rig = { fm, as, hk, keys, assistOn };
  rig.step = () => {
    const k = Object.fromEntries(Object.entries(keys).map(([n, x]) => [n, x.down]));
    const c = hk.update(k, DT, rig.assistOn);
    fm.setControls(rig.assistOn ? as.update(fm.state, c, DT) : { cyclicPitch: c.cyclicPitch, cyclicRoll: c.cyclicRoll, pedal: c.pedal, collective: c.collective });
    fm.step(DT);
  };
  return rig;
}

/**
 * The person flying. A key gives 0 or 1, so the person flies by the length of the presses: every 0.25 s (0.3 s with
 * the assist off: slower, more careful) it judges how much of a control it wants (a stick position, a lever change)
 * and holds the key for that share of the period (at least 80 ms, nothing for less than 40 ms of want), then waits for
 * the next look. Height: the lever by the vertical-speed error (vertical speed wanted from the height error); ground
 * position or velocity: the attitude wanted (assist on: the stick commands attitude, 20 deg pitch / 35 deg bank at
 * full; off: raw stick, the person watches attitude and rate); heading: the pedals (assist on: only to turn, the
 * assist holds the heading).
 */
class Pulse {
  constructor(key) {
    this.key = key;
    this.until = 0;
  }
  plan(now, share, period) {
    const hold = Math.min(1, Math.max(0, share)) * period;
    this.until = hold < 0.04 ? 0 : now + Math.max(0.08, hold);
  }
  tick(now) {
    this.key.set(now < this.until, now);
  }
}
function heliPerson(rig, look = 0.25) {
  const { fm, keys } = rig;
  let next = 0;
  const P = Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, new Pulse(k)]));
  const T = { h: 0, vf: 0, vr: 0, heading: 0, gx: null, gz: null, vsMax: 2, vsMin: -1.5 };
  const pair = (now, pos, neg, x) => {
    P[pos].plan(now, x, look);
    P[neg].plan(now, -x, look);
  };
  const fn = (now) => {
    if (now >= next) {
      next = now + look;
      const s = fm.state;
      const hd = s.heading;
      const fx = Math.sin(hd);
      const fz = -Math.cos(hd);
      const rx = Math.cos(hd);
      const rz = Math.sin(hd);
      const vf = s.velocity.x * fx + s.velocity.z * fz;
      const vr = s.velocity.x * rx + s.velocity.z * rz;
      let wf = T.vf;
      let wr = T.vr;
      if (T.gx !== null) {
        const dx = T.gx - s.position.x;
        const dz = T.gz - s.position.z;
        const vmax = T.vmax || 3;
        // (closing on the point no faster than it can stop: v^2 = 2 a d with a = 1 m/s^2)
        const df = dx * fx + dz * fz;
        const dr = dx * rx + dz * rz;
        wf = clamp(Math.sign(df) * Math.min(Math.abs(df) * 0.3, Math.sqrt(2 * 1.0 * Math.abs(df))), -vmax, vmax);
        wr = clamp(Math.sign(dr) * Math.min(Math.abs(dr) * 0.3, Math.sqrt(2 * 1.0 * Math.abs(dr))), -vmax, vmax);
      }
      // the lever: a change of lever per look by the vertical-speed error, as a press of the rate key (0.3 / s)
      const vsT = clamp((T.h - s.radarHeight) * 0.4, T.vsMin, T.vsMax);
      // (and against the vertical acceleration it feels: a person eases off before the speed is there)
      const az = fn.vsPrev === undefined ? 0 : (s.verticalSpeed - fn.vsPrev) / look;
      fn.vsPrev = s.verticalSpeed;
      const dLever = clamp((vsT - s.verticalSpeed) * 0.02 - az * 0.015, -0.05, 0.05);
      pair(now, 'up', 'down', dLever / (0.3 * look));
      const ef = wf - vf;
      const er = wr - vr;
      if (rig.assistOn) {
        // the stick held off centre by the share of the look: its mean is the attitude command (/ 20 or 35 deg)
        // (a person leans on a drift that goes on: the share grows while the error keeps its sign)
        if (Math.abs(ef) < 2) fn.If = clamp((fn.If || 0) + ef * look * 0.08, -0.4, 0.4);
        if (Math.abs(er) < 2) fn.Ir = clamp((fn.Ir || 0) + er * look * 0.08, -0.4, 0.4);
        const fast = Math.hypot(vf, vr) > 8;
        const thW = clamp(-ef * (fast ? 0.025 : 0.06), -0.17, 0.17);
        const phW = clamp(er * (fast ? 0.03 : 0.08), -0.3, 0.3);
        if (fast) fn.If = fn.Ir = 0;
        pair(now, 'back', 'fwd', (thW / (20 * D2R)) * 2.5 - fn.If);
        pair(now, 'right', 'left', (phW / (35 * D2R)) * 2.5 + fn.Ir);
        const eh = wrap(T.heading - hd);
        pair(now, 'pedR', 'pedL', Math.abs(eh) > 15 * D2R ? eh / (45 * D2R) * 2 : 0);
      } else {
        // raw: the stick moved off its trim by what the attitude (and its rate) is short of
        const thW = clamp(-ef * 0.02, -0.12, 0.12) + T.theta0;
        const phW = clamp(er * 0.03, -0.15, 0.15) + T.phi0;
        const eth = thW - (s.pitch + s.rates.pitchUp * 0.5);
        const eph = phW - (s.bank + s.rates.rollRight * 0.8);
        pair(now, 'back', 'fwd', eth * 6);
        pair(now, 'right', 'left', eph * 6);
        const eh = wrap(T.heading - hd) - s.rates.yawRight * 0.7;
        pair(now, 'pedR', 'pedL', eh * 4);
      }
    }
    for (const p of Object.values(P)) p.tick(now);
  };
  fn.T = T;
  return fn;
}

export function heliHover({ assistOn = true, seconds = 20, height = 10, trim = false } = {}) {
  const rig = heliRig({ assistOn: true });
  const P = heliPerson(rig);
  P.T.h = height;
  P.T.gx = 0;
  P.T.gz = 0;
  P.T.vmax = 1.5;
  let t = 0;
  const log = [];
  // the take-off with the assist on; at the hover, the assist off if asked (the trim from its last output)
  for (; t < 25; t += DT) {
    P(t);
    rig.step();
    if (t > 12 && Math.abs(rig.fm.state.radarHeight - height) < 0.5 && Math.abs(rig.fm.state.verticalSpeed) < 0.3) break;
  }
  const tAt = t;
  // (trim: the force-trim key Y pressed once in the hover: the assist holds the attitude of that moment hands-off)
  if (trim && assistOn) {
    rig.as.pitchTrim = Math.max(-0.17, Math.min(0.17, rig.fm.state.pitch));
    rig.as.rollTrim = Math.max(-0.17, Math.min(0.17, rig.fm.state.bank));
    P.If = P.Ir = 0;
  }
  if (!assistOn) {
    const c = rig.fm.state.controls;
    rig.assistOn = false;
    rig.hk.setTrim({ cp: c.cyclicPitch, cr: c.cyclicRoll, ped: c.pedal });
    rig.hk.cp = c.cyclicPitch;
    rig.hk.cr = c.cyclicRoll;
    rig.hk.ped = c.pedal;
  }
  const P2 = assistOn ? P : heliPerson(rig, 0.2);
  Object.assign(P2.T, P.T, { theta0: rig.fm.state.pitch, phi0: rig.fm.state.bank });
  let hMin = Infinity;
  let hMax = -Infinity;
  let drift = 0;
  let maxBank = 0;
  const x0 = rig.fm.state.position.x;
  const z0 = rig.fm.state.position.z;
  const h0 = rig.fm.state.heading;
  let hdg = 0;
  for (let u = 0; u < seconds; u += DT) {
    P2(t + u);
    rig.step();
    const s = rig.fm.state;
    hMin = Math.min(hMin, s.radarHeight);
    hMax = Math.max(hMax, s.radarHeight);
    drift = Math.max(drift, Math.hypot(s.position.x - x0, s.position.z - z0));
    maxBank = Math.max(maxBank, Math.abs(s.bank) / D2R);
    hdg = Math.max(hdg, Math.abs(wrap(s.heading - h0)) / D2R);
  }
  const K = rig.keys;
  return { assist: assistOn, trim, takeoffToHoverS: +tAt.toFixed(1), holdS: seconds, heightMinM: +hMin.toFixed(2), heightMaxM: +hMax.toFixed(2), driftMaxM: +drift.toFixed(2), maxBankDeg: +maxBank.toFixed(1), headingDevDeg: +hdg.toFixed(1),
    presses: Object.fromEntries(Object.entries(K).map(([n, k]) => [n, stats(k.presses)])) };
}

export function heliCircuit() {
  const rig = heliRig({ assistOn: true });
  const P = heliPerson(rig);
  const T = P.T;
  let t = 0;
  const legs = [
    // take off to 10 m over the pad
    { h: 10, gx: 0, gz: 0, vmax: 1.5, until: (s) => s.radarHeight > 9 && t > 8 },
    // climb out north to 60 m, then a 400 x 300 m box, back to a point 150 m south of the pad, then the approach
    { h: 60, gx: 0, gz: -350, vmax: 25, until: (s) => s.position.z < -330 },
    { h: 60, gx: 300, gz: -350, vmax: 28, until: (s) => s.position.x > 280 },
    { h: 60, gx: 300, gz: 150, vmax: 28, until: (s) => s.position.z > 130 },
    { h: 40, gx: 0, gz: 150, vmax: 22, until: (s) => s.position.x < 20 },
    // the approach: down to 10 m over the pad, slowing
    { h: 10, gx: 0, gz: 0, vmax: 12, until: (s) => Math.hypot(s.position.x, s.position.z) < 2 && Math.hypot(s.velocity.x, s.velocity.z) < 0.6 },
    // down to 2 m over the H, then let down at under 0.5 m/s
    { h: 2, gx: 0, gz: 0, vmax: 1.5, vsMin: -1, until: (s) => s.radarHeight < 2.5 && Math.hypot(s.position.x, s.position.z) < 1 && Math.hypot(s.velocity.x, s.velocity.z) < 0.3 },
    { h: -1, gx: 0, gz: 0, vmax: 1, vsMin: -0.45, until: (s) => s.contact.onGround && s.contact.points >= 8 && Math.abs(s.verticalSpeed) < 0.05 },
  ];
  const out = { legs: [] };
  let touch = null;
  for (const leg of legs) {
    Object.assign(T, { h: leg.h, gx: leg.gx, gz: leg.gz, vmax: leg.vmax, vsMin: leg.vsMin || -2.5, vsMax: 3 });
    P.If = P.Ir = 0;
    const t0 = t;
    for (; t < t0 + 160; t += DT) {
      // turn to face the way to go (pedals) on the transit legs
      const s = rig.fm.state;
      const dx = leg.gx - s.position.x;
      const dz = leg.gz - s.position.z;
      if (Math.hypot(dx, dz) > 40) T.heading = Math.atan2(dx, -dz);
      P(t);
      rig.step();
      if (process.env.V5DEBUG && leg.h < 0 && Math.abs(t % 1) < DT) console.log(t.toFixed(0), JSON.stringify({ p: [rig.fm.state.position.x.toFixed(1), rig.fm.state.position.z.toFixed(1), rig.fm.state.radarHeight.toFixed(2)], vs: rig.fm.state.verticalSpeed.toFixed(2), gs: rig.fm.state.groundSpeed.toFixed(2), on: rig.fm.state.contact.points, hdg: (rig.fm.state.heading / D2R).toFixed(0), Th: (T.heading / D2R).toFixed(0), col: rig.fm.state.controls.collective.toFixed(2), bank: (rig.fm.state.bank / D2R).toFixed(1), pitch: (rig.fm.state.pitch / D2R).toFixed(1) }));
      if (leg.h < 0 && !touch && rig.fm.state.contact.onGround) touch = { vs: rig.fm.state.verticalSpeed, x: rig.fm.state.position.x, z: rig.fm.state.position.z };
      if (leg.until(rig.fm.state)) break;
    }
    const s = rig.fm.state;
    out.legs.push({ to: [leg.gx, leg.gz, leg.h], s: +(t - t0).toFixed(1), at: [Math.round(s.position.x), Math.round(s.position.z), +s.radarHeight.toFixed(1)], kmh: Math.round(s.groundSpeed * 3.6) });
  }
  const s = rig.fm.state;
  out.landedFromH_m = +Math.hypot(s.position.x, s.position.z).toFixed(2);
  out.touchdownVs = touch && +touch.vs.toFixed(2);
  out.totalS = +t.toFixed(1);
  out.presses = Object.fromEntries(Object.entries(rig.keys).map(([n, k]) => [n, stats(k.presses)]));
  return out;
}

/** What one tap does in the hover: degrees of bank and pitch, heading, collective, with the assist on and off. */
export function heliTaps() {
  const out = [];
  for (const assistOn of [true, false]) {
    for (const [key, what] of [['right', 'bank'], ['fwd', 'pitch'], ['pedR', 'heading'], ['up', 'vs']]) {
      for (const ms of [100, 200]) {
        const rig = heliRig({ assistOn: true });
        const P = heliPerson(rig);
        P.T.h = 10;
        P.T.gx = 0;
        P.T.gz = 0;
        for (let t = 0; t < 20; t += DT) {
          P(t);
          rig.step();
        }
        for (const k of Object.values(rig.keys)) k.down = false;
        if (!assistOn) {
          const c = rig.fm.state.controls;
          rig.assistOn = false;
          rig.hk.setTrim({ cp: c.cyclicPitch, cr: c.cyclicRoll, ped: c.pedal });
          rig.hk.cp = c.cyclicPitch;
          rig.hk.cr = c.cyclicRoll;
          rig.hk.ped = c.pedal;
        }
        const s0 = { ...rig.fm.state };
        let peak = 0;
        let stick = 0;
        for (let t = 0; t < 2.0; t += DT) {
          rig.keys[key].down = t < ms / 1000 - 1e-9;
          rig.step();
          const s = rig.fm.state;
          const v = what === 'bank' ? (s.bank - s0.bank) / D2R : what === 'pitch' ? (s.pitch - s0.pitch) / D2R : what === 'heading' ? wrap(s.heading - s0.heading) / D2R : s.verticalSpeed - s0.verticalSpeed;
          if (Math.abs(v) > Math.abs(peak)) peak = v;
          const c = rig.hk;
          stick = Math.max(stick, Math.abs(key === 'right' ? c.cr - c.trim.cr * !assistOn : key === 'fwd' ? c.cp - c.trim.cp * !assistOn : key === 'pedR' ? c.ped - c.trim.ped * !assistOn : 0));
        }
        out.push({ assist: assistOn, key, tapMs: ms, stickTravel: key === 'up' ? +(0.3 * ms / 1000).toFixed(3) : +stick.toFixed(2), peak: +peak.toFixed(2), unit: what === 'vs' ? 'm/s' : 'deg' });
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const what = process.argv[2] || 'all';
  if (what === 'car' || what === 'all') {
    console.log('lap', JSON.stringify(carLap()));
    console.log('slalom', JSON.stringify(carSlalom(60)));
  }
  if (what === 'taps' || what === 'all') {
    for (const r of carTaps()) console.log('carTap', JSON.stringify(r));
    for (const r of heliTaps()) console.log('heliTap', JSON.stringify(r));
  }
  if (what === 'heli' || what === 'all') {
    console.log('hover', JSON.stringify(heliHover({ assistOn: true })));
    console.log('hoverTrimmed', JSON.stringify(heliHover({ assistOn: true, trim: true })));
    console.log('hoverRaw', JSON.stringify(heliHover({ assistOn: false })));
    console.log('circuit', JSON.stringify(heliCircuit()));
  }
}
