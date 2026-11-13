// (V5) The new sounds rendered offline and measured as V3 did (tools/v3_sound.js: same render, same output chain,
// same measures). In the page: const A = await import('/tools/v5_sound.js'); A.runAll().then(r => window.__s5 = r)
// Cases: the car's start (starter cranking 0.7 s, first firing, flare, idle), the rev limiter at 8550 rpm, the
// indicator relay, crunches at three impact sizes, a scrape; the helicopter's low-rotor horn, engine-out warble,
// overtorque chime (inside, in the hover's own sound), both door thunks.
import { render, measure, spectrogram } from '/tools/v3_sound.js';
import { CarSound } from '/src/car/sound.js';
import { HeliSound } from '/src/heli/sound.js';
import { CarDynamics } from '/src/car/dynamics.js';
import { Helicopter } from '/src/heli/flight.js';

/** The car's real dynamics through a start, its state handed to the sound each 1/60 s. */
async function carStart() {
  const d = new CarDynamics();
  d.reset(0, 0, 0);
  d.stopEngine();
  d.engine.omega = 0;
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  let fired = null;
  const x = await render(4, (s) => new CarSound(s), (t, dt, cs) => {
    if (t >= 0.3 && d.ignition === 'off' && t < 0.4) d.startEngine();
    const was = d.ignition;
    if (t > 0) d.update(dt);
    if (was === 'cranking' && d.ignition === 'running') {
      fired = t;
      cs.fire();
    }
    cs.update(dt, d, 1, true, 1);
  });
  // during cranking: the starter's tone at 0.55 x crank rpm; after: firing order at rpm / 10
  return { x, m: measure(x, { at: [0.7, 2.0, 3.5], expect: (t) => [['starter 0.55 x rpm', 0.55 * (t < 1 ? 270 : 1070)], ['firing rpm/10', (t < 1 ? 270 : t < 2.5 ? 1300 : 1070) / 10]], skipJumps: [[0, 4]] }), fired };
}

async function carCase(seconds, drive, at, expect) {
  const d = { rpm: 1000, engine: { load: 0, cut: false }, shift: null, gear: 4, wheels: [0, 1, 2, 3].map(() => ({ contact: true, surface: { dust: 0 }, slipSpeed: 0, fz: 4000, alpha: 0, kappa: 0, vx: 0 })), vel: { x: 0, z: 0 }, ignition: 'running' };
  const x = await render(seconds, (s) => new CarSound(s), (t, dt, cs) => {
    drive(d, t, cs);
    cs.update(dt, d, 1, true, 1);
  });
  return { x, m: measure(x, { at, expect, skipJumps: [[0, seconds]] }) };
}

export async function runAll({ pictures = true } = {}) {
  const out = { car: {}, heli: {} };
  const keep = async (group, name, r) => {
    out[group][name] = r.m;
    if (pictures) await spectrogram(r.x, `v5_${group}_${name}`, `${group} ${name}`);
  };
  const s = await carStart();
  s.m.fired = s.fired;
  await keep('car', 'start', s);
  // the limiter: full load at the cut, the dynamics' own hysteresis (cut at 8550, back below 8350), the revs
  // swinging at about 12 Hz between them as a held limiter does
  await keep('car', 'limiter', await carCase(2, (d, t) => {
    const ph = (t * 12) % 1;
    d.rpm = 8350 + 200 * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
    d.engine = { load: 1, cut: ph >= 0.35 && ph < 0.75 };
  }, [1.0], () => [['firing 845 Hz', 845]]));
  await keep('car', 'indicator', await carCase(3, (d, t, cs) => {
    const on = Math.floor(t * 2.6) % 2 === 0 ? 1 : 0;
    if (on !== cs._ind) cs.tick(!!on);
    cs._ind = on;
    d.rpm = 1000;
    d.engine = { load: 0.05, cut: false };
  }, [1.0], () => []));
  for (const dv of [1.5, 6, 22]) {
    await keep('car', `crunch_${dv}`, await carCase(1.5, (d, t, cs) => {
      if (t > 0.2 && !cs._hit) {
        cs._hit = true;
        cs.crunch(dv, 1);
      }
      d.rpm = 3000;
      d.engine = { load: 0, cut: false };
    }, [0.3], () => []));
  }
  await keep('car', 'scrape', await carCase(2, (d, t) => {
    d.scrapeKw = t > 0.5 ? 90 : 0;
    d.rpm = 4000;
    d.engine = { load: 0.2, cut: false };
  }, [1.2], () => [['scrape band', 2700]]));
  await keep('car', 'door', await carCase(1.5, (d, t, cs) => {
    if (t > 0.2 && !cs._door) {
      cs._door = true;
      cs.door(true);
    }
    d.rpm = 0;
    d.ignition = 'off';
  }, [0.25], () => []));
  // helicopter: the hover's own sound inside, the warnings over it
  for (const [name, warn] of [['hoverIn', {}], ['horn', { horn: true }], ['engineOut', { engineOut: true }], ['overtorque', { overtorque: true }]]) {
    const fm = new Helicopter({ groundAt: () => ({ height: 0, normal: [0, 1, 0], friction: 1 }) });
    fm.reset({ running: 'flight', inAir: true, position: [0, 30, 0], controls: { collective: 0.473, pedal: -0.38 } });
    const x = await render(4, (s) => new HeliSound(s), (t, dt, hs) => {
      if (t > 0) fm.step(dt);
      hs.update(dt, { ...fm.state }, 1, true, 1, t > 1 ? warn : {});
    });
    await keep('heli', name, { x, m: measure(x, { at: [0.6, 2.5], expect: () => [['horn 600', 600], ['warble high 1000', 1000], ['chime 1320', 1320], ['chime 990', 990]], skipJumps: [[0, 4]] }) });
  }
  {
    const x = await render(1.5, (s) => new HeliSound(s), (t, dt, hs) => {
      if (t > 0.2 && !hs._door) {
        hs._door = true;
        hs.door(true);
      }
    });
    await keep('heli', 'door', { x, m: measure(x, { at: [0.25], skipJumps: [[0, 1.5]] }) });
  }
  // compact: rms over the case, peak, and the strongest peaks at each moment
  const brief = (m) => ({ peakDb: m.peakDb, fullScale: m.fullScale, rmsMaxDb: Math.max(...m.rmsDb), rmsDb: m.rmsDb.filter((_, i) => i % 5 === 0), spectra: m.spectra.map((s) => ({ t: s.t, peaks: s.peaks.slice(0, 5), expected: s.expected })) });
  window.__s5 = { car: Object.fromEntries(Object.entries(out.car).map(([k, m]) => [k, brief(m)])), heli: Object.fromEntries(Object.entries(out.heli).map(([k, m]) => [k, brief(m)])), fired: out.car.start.fired };
  return window.__s5;
}
