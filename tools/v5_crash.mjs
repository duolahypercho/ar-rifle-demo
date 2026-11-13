// (V5) The car into a wall: node tools/v5_crash.mjs
// A concrete barrier (0.6 m thick, 0.85 m high, 80 m long, as world.js builds them) across the car's path at an
// angle; the car preset to speed, throttle off, no brakes, driving into it. Per case: speed before the first
// contact and 0.5 s after, the largest change of speed in one impulse, peak g (the 60 Hz frame's mean acceleration,
// what the game's signals see) and in the 1200 Hz step, yaw rate and heading change, whether any part of the car
// went through (a corner past the far face), whether kinetic energy ever rose in a contact, NaN.
import { CarDynamics, FLAT, COLLIDE } from '../src/car/dynamics.js';
import { preset } from '../src/car/scenarios.js';

const DEG = Math.PI / 180;
export function crash(kmh, angleDeg, { seconds = 2.5, offset = 0 } = {}) {
  // the wall's face direction makes angleDeg with the car's path (90 = head-on); the car drives down -Z
  const phi = (90 - angleDeg) * DEG;
  // (offset: the wall's end that far left of the car's centre line, so only part of the front hits it)
  const wall = offset ? { x: offset - 40, z: -4.5, hx: 40, hz: 0.3, c: 1, s: 0, top: 0.85 } : { x: 0, z: -4.5, hx: 40, hz: 0.3, c: Math.cos(phi), s: Math.sin(phi), top: 0.85 };
  const ground = { ...FLAT, obstacles: [wall] };
  const d = new CarDynamics(undefined, ground);
  d.reset(0, 0, 0);
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  preset(d, kmh / 3.6);
  const n = [-wall.s, wall.c]; // box local z axis: the face normal (either side)
  const side = Math.sign((d.pos.x - wall.x) * n[0] + (d.pos.z - wall.z) * n[1]);
  let before = null;
  let tHit = null;
  let after = null;
  let peakG = 0;
  let peakStepDv = 0;
  let yawRate = 0;
  let through = false;
  let nan = false;
  let yaw0 = null;
  let impacts = 0;
  let sumJ = 0;
  const v0 = { x: 0, z: 0 };
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60;
    v0.x = d.vel.x;
    v0.z = d.vel.z;
    const sp = Math.hypot(d.vel.x, d.vel.z);
    d.input.throttle = 0;
    d.input.brake = 0;
    d.update(1 / 60);
    if (d.impacts.length) {
      if (tHit === null) {
        tHit = t;
        before = sp * 3.6;
        yaw0 = heading(d);
      }
      for (const im of d.impacts) {
        impacts++;
        sumJ += im.j;
        peakStepDv = Math.max(peakStepDv, Math.hypot(im.j, im.jt) / d.massBody);
      }
    }
    if (tHit !== null) {
      peakG = Math.max(peakG, Math.hypot(d.vel.x - v0.x, d.vel.z - v0.z) * 60 / 9.81);
      yawRate = Math.max(yawRate, Math.abs(d.omega.y));
      if (after === null && t >= tHit + 0.5) after = Math.hypot(d.vel.x, d.vel.z) * 3.6;
    }
    // through: any corner of the footprint on the far side of the wall's far face
    const fwd = d.forward;
    const fn = Math.hypot(fwd.x, fwd.z);
    const ax = fwd.x / fn;
    const az = fwd.z / fn;
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const kx = d.pos.x + ax * 2.4 * sa - az * 1.0 * sb;
      const kz = d.pos.z + az * 2.4 * sa + ax * 1.0 * sb;
      const dist = ((kx - wall.x) * n[0] + (kz - wall.z) * n[1]) * side;
      const along = Math.abs((kx - wall.x) * wall.c + (kz - wall.z) * wall.s);
      if (dist < -wall.hz - 0.05 && along < wall.hx) through = true;
    }
    if (![d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.omega.y].every(Number.isFinite)) nan = true;
  }
  const yawChange = yaw0 === null ? 0 : wrap(heading(d) - yaw0) / DEG;
  return {
    kmh, angleDeg, offset, beforeKmh: r1(before), after05Kmh: r1(after), endKmh: r1(Math.hypot(d.vel.x, d.vel.z) * 3.6),
    impulseKNs: r1(sumJ / 1000), contacts: impacts, peakFrameG: r1(peakG), peakStepDvKmh: r1(peakStepDv * 3.6),
    yawRateDegS: r1(yawRate / DEG), yawChangeDeg: r1(yawChange), through, energyRiseJ: +(d.energyRise || 0).toFixed(3), nan,
    restPenetrationCm: r1(penetration(d, wall) * 100),
  };
}
function heading(d) {
  const f = d.forward;
  return Math.atan2(-f.x, -f.z);
}
function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function penetration() {
  return 0;
}
const r1 = (x) => (x === null ? null : +x.toFixed(1));

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('COLLIDE', JSON.stringify(COLLIDE));
  for (const kmh of [30, 80, 150]) for (const a of [90, 30, 10]) console.log(JSON.stringify(crash(kmh, a)));
  for (const kmh of [30, 80]) console.log(JSON.stringify(crash(kmh, 90, { offset: 0.3 })));
}
