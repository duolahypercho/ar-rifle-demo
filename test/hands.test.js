// (V3) push-pull steering hands (src/car/hands.js): one hand always gripping, the hands in their own halves
// of the rim and apart, no regrip at speed under 90 degrees of wheel.  node --test test/hands.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RimHands } from '../src/car/hands.js';

const D = Math.PI / 180;
function run(profile, seconds, speed) {
  const h = new RimHands();
  const out = { noGrip: 0, off: 0, minGap: Infinity, releases: 0, crossed: 0, slideMax: 0 };
  let was = { Left: true, Right: true };
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    const H = h.update(profile(t), 1 / 60, speed);
    if (!H.Left.grip && !H.Right.grip) out.noGrip += 1 / 60;
    if (H.Left.off || H.Right.off) out.off += 1 / 60;
    out.minGap = Math.min(out.minGap, h.gap() / D);
    if (H.Left.w < -1e-6 || H.Left.w > Math.PI + 1e-6 || H.Right.w > 1e-6 || H.Right.w < -Math.PI - 1e-6) out.crossed += 1 / 60;
    for (const s of ['Left', 'Right']) {
      if (was[s] && !H[s].grip) out.releases++;
      was[s] = H[s].grip;
    }
  }
  out.final = [h.hands.Left.w / D, h.hands.Right.w / D];
  return out;
}
const lock = 420 * D;
const lockToLock = (t) => (t < 3 ? lock * (t / 3) : t < 6 ? lock * (1 - 2 * ((t - 3) / 3)) : t < 9 ? -lock * (1 - (t - 6) / 3) : 0);

test('lock to lock standing: a hand always grips, halves kept, apart', () => {
  const r = run(lockToLock, 11, 0);
  console.log('lockToLock', r);
  assert.equal(r.noGrip, 0);
  assert.equal(r.off, 0);
  assert.equal(r.crossed, 0);
  assert.ok(r.minGap >= 35, `gap ${r.minGap}`);
  assert.ok(Math.abs(r.final[0] - 90) < 1 && Math.abs(r.final[1] + 90) < 1, `home ${r.final}`);
});

test('at speed, inputs under 90 degrees: no regrip', () => {
  const slalom = (t) => 75 * D * Math.sin(t * Math.PI * 2 * 0.6);
  const r = run(slalom, 8, 25);
  console.log('slalom', r);
  assert.equal(r.releases, 0);
  const sweep = (t) => (t < 1 ? 88 * D * t : t < 3 ? 88 * D : 88 * D * Math.max(0, 4 - t));
  assert.equal(run(sweep, 5, 30).releases, 0);
});

test('at speed past 90 degrees (hairpin, 200 deg): push-pull, a hand always grips', () => {
  const hairpin = (t) => (t < 1.5 ? 200 * D * (t / 1.5) : t < 3 ? 200 * D : 200 * D * Math.max(0, 1 - (t - 3) / 1.5));
  const r = run(hairpin, 6, 15);
  console.log('hairpin', r);
  assert.equal(r.noGrip, 0);
  assert.equal(r.off, 0);
  assert.ok(r.crossed < 0.5, `past 12 or 6 ${r.crossed} s`); // (the bottom hand rides on past 6 for a moment)
  assert.ok(r.minGap >= 30, `gap ${r.minGap}`);
});

test('fast parking flick (720 deg/s)', () => {
  const flick = (t) => Math.min(lock, 720 * D * t);
  const r = run(flick, 2, 0);
  console.log('flick', r);
  assert.equal(r.noGrip, 0);
  assert.equal(r.crossed, 0);
});
