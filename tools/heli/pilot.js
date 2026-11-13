// Scripted test pilot for the H1 scenarios. Reads only heli.state (what a pilot can see and feel)
// and moves only the four raw controls. Cascaded loops: speed -> pitch attitude -> cyclic,
// lateral speed or bank -> roll attitude -> cyclic, height or vertical speed or torque -> collective,
// heading or yaw rate or sideslip -> pedal. Integrators find the trims, so the trim values reported
// by the scenarios are what the physics needs, not numbers put in by hand.

const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export class TestPilot {
  constructor(heli, targets = {}) {
    this.heli = heli;
    this.t = { speed: null, vLat: 0, alt: null, vs: null, heading: null, yawRate: null, sideslip: null,
      bank: null, pitch: null, collective: null, torque: null, maxVs: 6, maxBank: 30 * D2R, maxPitch: 25 * D2R,
      minPitch: -25 * D2R, rpm: null, torqueMax: 100, altByPitch: false, ...targets };
    const s = heli.state;
    const c = heli.controls;
    this.I = { theta: s.pitch, phi: 0, cp: c.cyclicPitch, cr: c.cyclicRoll, col: c.collective, ped: c.pedal };
    this.gain = { kv: 0.02, kvi: 0.003, kvl: 0.035, kvli: 0.006, kth: 2.5, kq: 0.8, kthi: 1.5,
      kph: 1.9, kp: 0.15, kphi: 1.5, kvs: 0.08, kvsi: 0.12, kh: 0.6, kpsi: 1.2, kr: 0.6, kri: 0.8 };
    this.on = { pitch: true, roll: true, collective: true, pedal: true };
  }

  set(targets) { Object.assign(this.t, targets); }

  update(dt) {
    const s = this.heli.state, t = this.t, g = this.gain, I = this.I;
    const c = this.heli.controls;
    const hd = s.heading;
    const fx = Math.sin(hd), fz = -Math.cos(hd);          // horizontal forward
    const rx = Math.cos(hd), rz = Math.sin(hd);           // horizontal right
    const vx = s.velocity.x, vz = s.velocity.z;
    const u = vx * fx + vz * fz, vl = vx * rx + vz * rz;  // ground-referenced speeds in the heading frame
    // filtered forward acceleration (what the seat of the pants feels) for speed-loop damping
    if (this.uPrev == null) this.uPrev = u;
    this.acc = (this.acc || 0) + (((u - this.uPrev) / dt) - (this.acc || 0)) * Math.min(1, dt / 0.4);
    this.uPrev = u;

    // ---- pitch: speed hold or attitude
    if (this.on.pitch) {
      let thC;
      if (t.pitch != null) thC = t.pitch;
      else if (t.altByPitch) {
        // power-limited top speed: collective holds torque, pitch holds altitude
        const vsC = clamp(g.kh * (t.alt - s.altitude), -3, 3);
        const e = vsC - s.verticalSpeed;
        I.theta = clamp(I.theta + 0.004 * e * dt * 10, -0.35, 0.35);
        thC = clamp(I.theta + 0.01 * e, t.minPitch, t.maxPitch);
      } else if (t.speed != null) {
        const e = t.speed - u;
        I.theta = clamp(I.theta - g.kvi * e * dt * 10, -0.35, 0.35);
        thC = clamp(I.theta - g.kv * e + 0.06 * this.acc, t.minPitch, t.maxPitch);
      } else thC = I.theta;
      const eth = s.pitch - thC;
      I.cp = clamp(I.cp + g.kthi * eth * dt, -1, 1);
      c.cyclicPitch = clamp(I.cp + g.kth * eth + g.kq * s.rates.pitchUp, -1, 1);
    }
    // ---- roll: lateral speed hold or bank
    if (this.on.roll) {
      let phC;
      const coord = t.bank == null && u > 15 && t.heading != null;
      if (t.bank != null) phC = t.bank;
      else if (coord) {
        // forward flight: bank steers the heading (coordinated), pedals hold the sideslip
        const e = wrapPi(t.heading - hd);
        I.phi = clamp(I.phi + 0.02 * e * dt * 10, -0.15, 0.15);
        phC = clamp(I.phi + 1.5 * e - 0.6 * s.rates.yawRight, -t.maxBank, t.maxBank);
      } else {
        const e = (t.vLat || 0) - vl;
        I.phi = clamp(I.phi + g.kvli * e * dt * 10, -0.3, 0.3);
        phC = clamp(I.phi + g.kvl * e, -t.maxBank, t.maxBank);
      }
      const eph = phC - s.bank;
      I.cr = clamp(I.cr + g.kphi * eph * dt, -1, 1);
      c.cyclicRoll = clamp(I.cr + g.kph * eph - g.kp * s.rates.rollRight, -1, 1);
    }
    // ---- collective
    if (this.on.collective) {
      if (t.collective != null) c.collective = t.collective;
      else if (t.rpm != null) {
        // autorotation: hold rotor rpm with collective (more collective = slower rotor)
        const e = s.rotor.percent - t.rpm;
        I.col = clamp(I.col + 0.004 * e * dt * 10, 0, 1);
        c.collective = clamp(I.col + 0.01 * e, 0, 1);
      } else if (t.torque != null) {
        const e = t.torque - s.engine.torquePercent;
        I.col = clamp(I.col + 0.0015 * e * dt * 10, 0, 1);
        c.collective = clamp(I.col + 0.002 * e, 0, 1);
      } else {
        let vsC = t.vs != null ? t.vs : 0;
        if (t.alt != null) vsC = clamp(g.kh * (t.alt - s.altitude) + (t.vs || 0), -t.maxVs, t.maxVs);
        const e = vsC - s.verticalSpeed;
        I.col = clamp(I.col + g.kvsi * e * dt, 0, 1);
        c.collective = clamp(I.col + g.kvs * e, 0, 1);
      }
      if (t.torqueMax != null && s.engine.torquePercent > t.torqueMax) {
        I.col = clamp(I.col - 0.005 * (s.engine.torquePercent - t.torqueMax) * dt * 10, 0, 1);
        c.collective = Math.min(c.collective, I.col);
      }
    }
    // ---- pedals
    if (this.on.pedal) {
      let rC;
      const coordY = t.bank == null && t.yawRate == null && u > 15 && t.heading != null;
      if (t.yawRate != null) rC = t.yawRate;
      else if (coordY) rC = clamp(-2.0 * (0 - s.sideslip), -0.5, 0.5) + 9.80665 * Math.tan(s.bank) / Math.max(u, 5);
      else if (t.sideslip != null) rC = clamp(-2.0 * (t.sideslip - s.sideslip), -0.5, 0.5) + (t.turnRate || 0);
      else if (t.heading != null) rC = clamp(g.kpsi * wrapPi(t.heading - hd), -0.6, 0.6);
      else rC = 0;
      const e = rC - s.rates.yawRight;
      I.ped = clamp(I.ped + g.kri * e * dt, -1, 1);
      c.pedal = clamp(I.ped + g.kr * e, -1, 1);
    }
    return c;
  }
}

/** (V2) The game's review sets hooks.fly to fly through its own frame loop (demo.step). */
export const hooks = { fly: null };

/** Fly `heli` with `pilot` for `seconds`, calling `each(state, t)` every frame (60 Hz). */
export function fly(heli, pilot, seconds, each) {
  if (hooks.fly) return hooks.fly(heli, pilot, seconds, each);
  const dt = 1 / 60;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    if (pilot) pilot.update(dt);
    heli.step(dt);
    if (each && each(heli.state, i * dt) === false) break;
  }
  return heli.state;
}

/** Average of f(state) over `seconds` of flight. */
export function average(heli, pilot, seconds, fns) {
  const acc = {}; let n = 0;
  for (const k in fns) acc[k] = 0;
  fly(heli, pilot, seconds, (s) => { for (const k in fns) acc[k] += fns[k](s); n++; });
  for (const k in acc) acc[k] /= Math.max(n, 1);
  return acc;
}
