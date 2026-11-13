// Headless checks of the supercar's dynamics (pass V1): `node --test test/`
// Reference values: VEHICLE_NOTES.md, "How to judge".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CarDynamics } from '../src/car/dynamics.js';
import { SCENARIOS, runScenario } from '../src/car/scenarios.js';

const run = (name) => runScenario(new CarDynamics(undefined, SCENARIOS[name].ground), SCENARIOS[name]);
const within = (x, lo, hi, what) => assert.ok(x >= lo && x <= hi, `${what} ${x.toFixed(3)} not in ${lo}..${hi}`);

test('0-100 about 2.9 s, 0-200 8.5 to 9.5 s, upshift 0.08 to 0.15 s, redline 8500', () => {
  const r = run('launch');
  within(r.t100, 2.7, 3.1, '0-100 s');
  within(r.t200, 8.3, 9.5, '0-200 s');
  within(r.upshiftS, 0.08, 0.15, 'upshift s');
  within(r.peakRpm, 8000, 8600, 'peak rpm');
});
test('top speed about 350 km/h', () => within(run('topSpeed').topKmh, 335, 360, 'top km/h'));
test('100-0 in 30 to 34 m, dive 1 to 2 deg', () => {
  const r = run('brake100');
  within(r.stopM, 29.5, 34, 'stop m');
  within(r.diveDeg, 1, 2, 'dive deg');
});
test('steady cornering 1.1 to 1.3 g at 100 km/h, more at 200', () => {
  const a = run('skidpadLimit');
  within(a.maxLatG, 1.1, 1.3, 'lat g at 100');
  within(a.atKmh, 85, 115, 'speed of the limit');
  const b = run('skidpad200');
  assert.ok(b.maxLatG > a.maxLatG, `downforce: ${b.maxLatG} at 200 not over ${a.maxLatG}`);
});
test('roll 1.5 to 3 deg per g', () => within(run('rollPitch').rollPerG, 1.5, 3, 'roll deg/g'));
test('standing still: under 1 mm/s once settled', () => within(run('standstill').maxMmS, 0, 1, 'mm/s'));
test('wheel speed against road speed within 3 % rolling', () => within(run('wheelSpeed').worstPct, 0, 3, '%'));
test('kerb strike: no spin, stays on the ground mostly', () => {
  const r = run('kerb');
  within(r.yawDegS, 0, 5, 'yaw deg/s');
  within(r.airS, 0, 0.2, 'airborne s');
});
