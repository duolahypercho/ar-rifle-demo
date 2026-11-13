// (V3) The vehicles' synthesised sound rendered offline and measured (nobody can listen here).
// In the page: const A = await import('/tools/v3_sound.js'); A.runAll() (in the background; results in
// window.__sound when done, spectrograms posted to tools/sheet_receiver.mjs as sound_<case>.png).
//
// Each case drives CarSound / HeliSound (src/car/sound.js, src/heli/sound.js) on an OfflineAudioContext at
// 48 kHz, through the same output chain as src/audio.js Sound.unlock() (compressor, then 0.55 master), the
// sound's update() called every 1/60 s of audio time (the context suspended there). The state is either made
// up for the case (the car: rpm, load, gear, shift, slide) or the flight model's own (the helicopter's start).
// Measures: peak (dBFS) and samples at full scale, loudness every 100 ms (RMS dBFS), the largest sample-to-
// sample jump and when, the strongest spectral peaks at chosen moments against the expected frequencies.
import { Sound } from '/src/audio.js';
import { CarSound } from '/src/car/sound.js';
import { HeliSound } from '/src/heli/sound.js';
import { Helicopter } from '/src/heli/flight.js';

const SR = 48000;

function fakeSound(ctx) {
  const s = Object.create(Sound.prototype);
  // (Sound's helpers play only while the context runs; the offline one reads 'suspended' at each update)
  s.ctx = new Proxy(ctx, {
    get(t, p) {
      if (p === 'state') return 'running';
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  s.out = ctx.createDynamicsCompressor();
  const master = ctx.createGain();
  master.gain.value = 0.55;
  s.out.connect(master).connect(ctx.destination);
  s.noise = ctx.createBuffer(1, SR, SR);
  const d = s.noise.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < SR; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return s;
}

/** Renders `seconds` with `step(t, dt, sound)` called every 1/60 s. */
export async function render(seconds, make, step) {
  const ctx = new OfflineAudioContext(1, Math.round(seconds * SR), SR);
  const sound = fakeSound(ctx);
  const obj = make(sound);
  const dt = 1 / 60;
  const n = Math.floor(seconds / dt);
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    ctx.suspend(t).then(() => {
      step(t, dt, obj);
      ctx.resume();
    });
  }
  step(0, dt, obj);
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

// ---- analysis ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude spectrum (dB) of N samples centred at time t (Hann). */
export function spectrum(x, t, N = 16384) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const c = Math.round(t * SR) - N / 2;
  for (let i = 0; i < N; i++) {
    const v = x[c + i] || 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  fft(re, im);
  const db = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) db[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / (N / 4) + 1e-12);
  return db;
}

/** The strongest local peaks between f0 and f1 Hz: [[Hz, dB]], interpolated. */
export function peaks(db, N = 16384, f0 = 15, f1 = 8000, count = 8) {
  const out = [];
  const bin = SR / N;
  for (let i = Math.max(2, Math.floor(f0 / bin)); i < Math.min(db.length - 2, f1 / bin); i++) {
    if (db[i] > db[i - 1] && db[i] >= db[i + 1] && db[i] > db[i - 2] && db[i] >= db[i + 2]) {
      const a = db[i - 1];
      const b = db[i];
      const c = db[i + 1];
      const p = (0.5 * (a - c)) / (a - 2 * b + c || 1e-9);
      out.push([(i + p) * bin, b - 0.25 * (a - c) * p]);
    }
  }
  out.sort((u, v) => v[1] - u[1]);
  return out.slice(0, count).map(([f, d]) => [+f.toFixed(1), +d.toFixed(1)]);
}

/** Level of the spectrum near f (the highest bin within +-3 %), dB. */
function levelAt(db, f, N = 16384) {
  const bin = SR / N;
  let best = -200;
  let at = f;
  for (let i = Math.floor((f * 0.97) / bin); i <= Math.ceil((f * 1.03) / bin); i++) if (db[i] > best) {
    best = db[i];
    at = i * bin;
  }
  return [+at.toFixed(1), +best.toFixed(1)];
}

export function measure(x, { expect = [], at = [], skipJumps = [] } = {}) {
  let peak = 0;
  let full = 0;
  let jump = 0;
  let jumpAt = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a >= 0.999) full++;
    if (i) {
      const j = Math.abs(x[i] - x[i - 1]);
      const t = i / SR;
      if (j > jump && !skipJumps.some(([u, v]) => t >= u && t <= v)) {
        jump = j;
        jumpAt = t;
      }
    }
  }
  // clicks: the largest sample-to-sample step in a 5 ms block against the median of the blocks round it
  // (+-50 ms): a waveform's own steepness (a 800 Hz sawtooth steps 0.08 every cycle) reads 1, a click 3 and up
  const B = SR / 200;
  const blocks = [];
  for (let i = 1; i + B <= x.length; i += B) {
    let m = 0;
    for (let k = i; k < i + B; k++) m = Math.max(m, Math.abs(x[k] - x[k - 1]));
    blocks.push(m);
  }
  let click = 0;
  let clickAt = 0;
  for (let b = 10; b < blocks.length - 10; b++) {
    const t = (b * B) / SR;
    if (skipJumps.some(([u, v]) => t >= u && t <= v)) continue;
    const near = blocks.slice(b - 10, b).concat(blocks.slice(b + 1, b + 11)).sort((u, v) => u - v);
    const r = blocks[b] / Math.max(1e-5, near[10]);
    if (blocks[b] > 0.003 && r > click) {
      click = r;
      clickAt = t;
    }
  }
  const rms = [];
  const W = SR / 10;
  for (let i = 0; i + W <= x.length; i += W) {
    let s = 0;
    for (let k = 0; k < W; k++) s += x[i + k] * x[i + k];
    rms.push(+(10 * Math.log10(s / W + 1e-12)).toFixed(1));
  }
  const spectra = at.map((t) => {
    const db = spectrum(x, t);
    const e = (typeof expect === 'function' ? expect(t) : expect).map(([name, f]) => [name, f, ...levelAt(db, f)]);
    return { t, peaks: peaks(db), expected: e };
  });
  return { peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2), fullScale: full, jump: +jump.toFixed(4), jumpAt: +jumpAt.toFixed(3), click: +click.toFixed(1), clickAt: +clickAt.toFixed(3), rmsDb: rms, spectra };
}

/** A spectrogram (log frequency 20 Hz .. 10 kHz, dB) posted as PNG to the sheet receiver. */
export async function spectrogram(x, name, title) {
  const N = 4096;
  const hop = 960; // 20 ms
  const cols = Math.floor((x.length - N) / hop);
  const H = 360;
  const W = Math.max(200, cols);
  const c = document.createElement('canvas');
  c.width = W + 60;
  c.height = H + 40;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const img = g.createImageData(W, H);
  const lf0 = Math.log(20);
  const lf1 = Math.log(10000);
  for (let col = 0; col < cols; col++) {
    const db = spectrum(x, (col * hop + N / 2) / SR, N);
    for (let row = 0; row < H; row++) {
      const f = Math.exp(lf1 - ((lf1 - lf0) * row) / (H - 1));
      const bin = Math.round((f * N) / SR);
      const v = Math.max(0, Math.min(1, (db[bin] + 90) / 80));
      const i = (row * W + col) * 4;
      img.data[i] = Math.round(255 * Math.min(1, v * 1.8));
      img.data[i + 1] = Math.round(255 * Math.max(0, v * 1.6 - 0.5));
      img.data[i + 2] = Math.round(255 * Math.max(0, 1 - Math.abs(v - 0.3) * 3) * 0.8);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 50, 10);
  g.fillStyle = '#ddd';
  g.font = '11px sans-serif';
  for (const f of [25, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const y = 10 + ((lf1 - Math.log(f)) / (lf1 - lf0)) * (H - 1);
    g.fillText(String(f), 4, y + 4);
    g.fillRect(44, y, 5, 1);
  }
  g.fillText(`${title}   (${(x.length / SR).toFixed(1)} s, 20 ms columns, -90..-10 dB)`, 50, H + 30);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await fetch(`http://127.0.0.1:5199/?n=sound_${name}.png`, { method: 'POST', body: blob });
}

// ---- the car ----
function carState() {
  const wheels = [0, 1, 2, 3].map(() => ({ contact: true, surface: { dust: 0 }, slipSpeed: 0, fz: 4000, alpha: 0, kappa: 0, vx: 0 }));
  return { rpm: 1000, engine: { load: 0, cut: false }, shift: null, gear: 3, wheels, vel: { x: 0, z: 0 } };
}
const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));

export const CAR_CASES = {
  idle: { seconds: 3, at: [1.5], drive: (d, t) => Object.assign(d, { rpm: 1000 }, { engine: { load: 0.08, cut: false } }) },
  sweepPart: { seconds: 7, at: [1, 3.5, 6], drive: (d, t) => Object.assign(d, { rpm: lerp(1000, 8500, (t - 0.5) / 6), engine: { load: 0.3, cut: false } }) },
  sweepFull: { seconds: 7, at: [1, 3.5, 6], drive: (d, t) => Object.assign(d, { rpm: lerp(1000, 8500, (t - 0.5) / 6), engine: { load: 1, cut: false } }) },
  upshift: {
    seconds: 2.5,
    at: [0.6, 1.6],
    skip: [[1.0, 1.15]],
    // 3rd to 4th at 8250 rpm: the dual clutch's 0.10 s, the revs falling by the ratio (8250 -> 6200)
    drive: (d, t) => {
      const s = 1.0;
      d.gear = t < s + 0.1 ? 3 : 4;
      d.shift = t >= s && t < s + 0.1 ? { t: t - s } : null;
      d.rpm = t < s ? lerp(7600, 8250, t / s) : t < s + 0.1 ? lerp(8250, 6200, (t - s) / 0.1) : lerp(6200, 6900, (t - s - 0.1) / 1.4);
      d.engine = { load: 1, cut: false };
    },
  },
  liftOff: {
    seconds: 3.5,
    at: [0.4, 1.5],
    skip: [[0.5, 1.2]],
    drive: (d, t) => {
      d.engine = { load: t < 0.5 ? 1 : 0, cut: false };
      d.rpm = t < 0.5 ? 7500 : lerp(7500, 3500, (t - 0.5) / 3);
    },
  },
  pass200: {
    seconds: 4,
    at: [1, 3],
    // 200 km/h in 5th at 6400 rpm past a listener 15 m off the line, closest at 2 s
    drive: (d, t) => {
      d.rpm = 6400;
      d.engine = { load: 0.7, cut: false };
      d.vel = { x: 0, z: -55.6 };
      d.listen = Math.max(0, 1 - Math.hypot(15, 55.6 * (t - 2)) / 60);
      d.pitch = 343 / (343 - (55.6 * 55.6 * (2 - t)) / Math.hypot(15, 55.6 * (t - 2)));
    },
  },
  squeal: {
    seconds: 3,
    at: [1.5],
    drive: (d, t) => {
      d.rpm = 4500;
      d.engine = { load: 0.5, cut: false };
      d.vel = { x: 0, z: 20 };
      for (const w of d.wheels) Object.assign(w, { slipSpeed: t > 0.5 ? 6 : 0, alpha: 0.12, vx: 20 });
    },
  },
};

export async function carCase(name, inside = false) {
  const C = CAR_CASES[name];
  const d = carState();
  const x = await render(C.seconds, (s) => new CarSound(s), (t, dt, cs) => {
    C.drive(d, t);
    cs.update(dt, d, d.listen ?? 1, inside, d.pitch ?? 1);
  });
  const expect = (t) => {
    const dd = carState();
    C.drive(dd, t);
    const f = (dd.rpm / 10) * (dd.pitch ?? 1);
    return [['half order rpm/120', f / 2], ['firing rpm/10', f], ['2nd', 2 * f], ['3rd', 3 * f]];
  };
  return { x, m: measure(x, { expect, at: C.at, skipJumps: C.skip || [] }) };
}

// ---- the helicopter ----
const BPF = (rpm) => (rpm / 60) * 4;

export async function heliCase(name, { after = null } = {}) {
  const fm = new Helicopter({ groundAt: () => ({ height: 0, normal: [0, 1, 0], friction: 1 }) });
  let seconds = 4;
  let at = [2];
  let inside = false;
  let listen = () => 1;
  let skip = [];
  let pre = () => {};
  let pitch = () => 1;
  if (name === 'start') {
    fm.reset({ running: 'cold' });
    fm.startEngine({ quick: false });
    seconds = 40;
    at = [3, 12, 25, 38];
    skip = [[0, 40]]; // (the igniter's clicks are meant)
  } else if (name === 'flightIdle') {
    fm.reset({ running: 'idle' });
  } else if (name === 'hoverOut' || name === 'hoverIn') {
    fm.reset({ running: 'flight', inAir: true, position: [0, 30, 0], controls: { collective: 0.473, pedal: -0.38 } });
    inside = name === 'hoverIn';
  } else if (name === 'pass220') {
    fm.reset({ running: 'flight', inAir: true, position: [0, 60, 0], velocity: [0, 0, -61], pitch: -0.04, controls: { collective: 0.62, cyclicPitch: 0.35, pedal: -0.2 } });
    seconds = 8;
    at = [2, 4, 6];
    // the listener 40 m beside the track; closest at t = 4 s; the game's own fall-off (main.js: 1 - d / 250)
    listen = (t) => Math.max(0, 1 - Math.hypot(40, 61 * (t - 4)) / 250);
    // (V3) the Doppler factor main.js now gives: 343 / (343 - v . n), n from the aircraft to the listener
    pitch = (t) => 343 / (343 - (61 * 61 * (4 - t)) / Math.hypot(40, 61 * (t - 4)));
  } else if (name === 'cruiseIn') {
    fm.reset({ running: 'flight', inAir: true, position: [0, 60, 0], velocity: [0, 0, -61], pitch: -0.04, controls: { collective: 0.62, cyclicPitch: 0.35, pedal: -0.2 } });
    inside = true;
  } else if (name === 'slapDescent') {
    // 90 km/h, 3 m/s down (blade-vortex interaction)
    fm.reset({ running: 'flight', inAir: true, position: [0, 200, 0], velocity: [0, -3, -25], controls: { collective: 0.3, cyclicPitch: 0.1, pedal: -0.1 } });
    seconds = 4;
    at = [2];
    pre = (st) => {
      st.verticalSpeed = -3;
      st.airspeed = 25;
    };
  }
  const x = await render(seconds, (s) => new HeliSound(s), (t, dt, hs) => {
    if (t > 0) fm.step(dt);
    const st = { ...fm.state };
    pre(st);
    hs.update(dt, st, listen(t), inside, pitch(t));
    if (after) after(hs, t);
  });
  const st = fm.state;
  const expect = (t) => [['main blade pass 4 x rotor rps (x Doppler)', BPF(st.rotor.rpm) * pitch(t)], ['tail blade pass 4 x tail rps', ((st.rotor.tailRpm || 0) / 60) * 4], ['2 x main bpf', 2 * BPF(st.rotor.rpm)]];
  const m = measure(x, { expect, at, skipJumps: skip });
  m.state = { nr: +st.rotor.percent.toFixed(1), rotorRpm: +st.rotor.rpm.toFixed(1), tailRpm: +(st.rotor.tailRpm || 0).toFixed(0), ng: +st.engine.ng.toFixed(1), thrustW: +(st.rotor.thrust / (st.mass * 9.81)).toFixed(2) };
  return { x, m };
}

export async function runAll({ car = Object.keys(CAR_CASES), heli = ['start', 'flightIdle', 'hoverOut', 'hoverIn', 'pass220', 'cruiseIn', 'slapDescent'], pictures = true, tag = '' } = {}) {
  const out = (window.__sound = { done: false, car: {}, heli: {} });
  for (const name of car) {
    const r = await carCase(name);
    out.car[name] = r.m;
    if (pictures) await spectrogram(r.x, `${tag}car_${name}`, `car ${name}`);
  }
  for (const name of heli) {
    const r = await heliCase(name);
    out.heli[name] = r.m;
    if (pictures) await spectrogram(r.x, `${tag}heli_${name}`, `helicopter ${name}`);
  }
  out.done = true;
  return out;
}
