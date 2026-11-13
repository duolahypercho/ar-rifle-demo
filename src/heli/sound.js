// The helicopter's sound (pass V2), synthesised like src/car/sound.js on the game's audio context and
// output (src/audio.js Sound: ctx, out, noise, _burst, _thump, click). Nothing here has been listened to;
// it is built from what a single-turbine, four-blade light helicopter makes, and follows the flight
// model's state:
//
//   start     the starter / igniter: a ticking spark (about 6 Hz clicks) from the starter's engagement
//             to light-off, a soft whoomph at light-off, then the turbine's run-up
//   turbine   gas-generator whine: two tones at Ng x 380 Hz and its 2nd multiple, band-passed noise
//             round them; loudest outside behind the exhaust, faint inside
//   rotor     blade passage: 4 blades x rotor rps (26 Hz at 100 % Nr) as a pulse train (a narrow periodic
//             pulse, the oscillator's own wave) through a low-pass, with its 2nd and 3rd
//             harmonics; the thump's loudness follows thrust
//   slap      blade-vortex interaction: in descents of 1 to 6 m/s at 40 to 140 km/h and in hard turns
//             (load factor over 1.4) the pulse sharpens (wider low-pass, more drive) and gets louder
//   tail      tail-rotor buzz: 4 x tail rps (170 Hz at 100 %) as a buzzy square, louder with its thrust
//   gearbox   transmission whine: a tone at 68 x the rotor's rps (442 Hz at 100 %) plus a faint mesh at 2 x that
//   wind      low-passed noise with the square of the airspeed
//   (V5) warnings, in the cabin (gated by `warn` from main.js, the same moments the caution lamps light):
//             low rotor rpm horn: a steady 600 Hz horn (square through a band-pass) below 95 % Nr in flight;
//             engine out: a warble alternating 600 / 1000 Hz at 2.5 Hz; overtorque: a two-note chime (1320 then
//             990 Hz, decaying) every 1.2 s while torque is over 100 %. Heard inside only (the headset)
//   inside    the cabin muffles: the turbine and wind lower and low-passed, the gearbox (overhead) and
//             the rotor's low thump stronger; outside the turbine whine and the slap carry
export class HeliSound {
  constructor(sound) {
    this.sound = sound;
    this.on = false;
    this._spark = 0;
    this._lit = false;
  }

  _build() {
    const s = this.sound;
    const ctx = s.ctx;
    if (!ctx || this.on) return !!this.on;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    // the cabin's muffling: a low-pass on everything that is not the gearbox
    const cabin = ctx.createBiquadFilter();
    cabin.type = 'lowpass';
    cabin.frequency.value = 18000;
    cabin.Q.value = 0.5;
    bus.connect(cabin).connect(s.out);
    this.bus = bus;
    this.cabin = cabin;
    const tone = (type, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(dest);
      o.start();
      return { o, g };
    };
    const noise = (type, freq, q, dest) => {
      const src = ctx.createBufferSource();
      src.buffer = s.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(dest);
      src.start();
      return { src, f, g };
    };
    // turbine
    this.whine1 = tone('sine', bus);
    this.whine2 = tone('triangle', bus);
    this.whineNoise = noise('bandpass', 6000, 4, bus);
    this.combust = noise('lowpass', 300, 0.7, bus);
    // rotor: a narrow pulse per blade pass -> low-pass
    // (V3: was a sawtooth through a wave shaper; the band-limited sawtooth sweeps through every value as it
    // wraps, the shaper turned that into a one-sample spike each blade pass, 0.034 per sample at the output 26
    // times a second (offline render, cruise inside). Now the pulse train itself is the oscillator's wave: a
    // periodic Gaussian pulse 6 % of the period wide, from its first 48 harmonics, band-limited by construction)
    const H = 48;
    const real = new Float32Array(H + 1);
    const imag = new Float32Array(H + 1);
    for (let n = 1; n <= H; n++) real[n] = Math.exp(-0.5 * Math.pow(2 * Math.PI * n * 0.06, 2));
    const pulseWave = ctx.createPeriodicWave(real, imag);
    const shaper = ctx.createGain(); // (the pulse, scaled as the V2 shaper's 2 x Gaussian)
    shaper.gain.value = 1.6;
    this.rotorLP = ctx.createBiquadFilter();
    this.rotorLP.type = 'lowpass';
    this.rotorLP.frequency.value = 200;
    this.rotorLP.Q.value = 0.8;
    this.rotorG = ctx.createGain();
    this.rotorG.gain.value = 0;
    this.rotorOsc = ctx.createOscillator();
    this.rotorOsc.setPeriodicWave(pulseWave);
    this.rotorOsc.connect(shaper).connect(this.rotorLP).connect(this.rotorG).connect(bus);
    this.rotorOsc.start();
    this.harm2 = tone('sine', bus);
    this.harm3 = tone('sine', bus);
    this.slapNoise = noise('bandpass', 900, 1.2, ctx.createGain());
    // (the slap noise is gated by the rotor pulse: noise x pulse through a gain driven by the shaper)
    this.slapGate = ctx.createGain();
    this.slapGate.gain.value = 0;
    this.slapNoise.g.disconnect();
    this.slapNoise.g.gain.value = 1;
    this.slapNoise.g.connect(this.slapGate).connect(bus);
    const pulseToGate = ctx.createGain();
    pulseToGate.gain.value = 0;
    shaper.connect(pulseToGate).connect(this.slapGate.gain);
    this.pulseToGate = pulseToGate;
    // tail rotor, gearbox (straight to the output: overhead, heard inside), wind
    this.tail = tone('square', bus);
    this.tailLP = null;
    this.gear1 = tone('sine', s.out);
    this.gear2 = tone('sine', s.out);
    this.wind = noise('lowpass', 500, 0.5, s.out);
    // (V5) the warning tones, straight to the output (the headset)
    const hornF = ctx.createBiquadFilter();
    hornF.type = 'bandpass';
    hornF.frequency.value = 900;
    hornF.Q.value = 0.7;
    hornF.connect(s.out);
    this.horn = tone('square', hornF);
    this.horn.o.frequency.value = 600;
    this.engOut = tone('triangle', hornF);
    this._chimeT = 0;
    this.on = true;
    return true;
  }

  /**
   * Every frame. `listen` 0..1 how much is heard (distance), `inside` in the cabin, `pitch` (V3) the Doppler
   * factor for a listener the aircraft moves relative to (1 inside or riding along with the chase camera).
   */
  update(dt, st, listen = 1, inside = false, pitch = 1, warn = null) {
    if (!this._build() || !st || !st.rotor) return;
    const ctx = this.sound.ctx;
    const now = ctx.currentTime;
    // ---- (V5) warnings ----
    const w = inside && warn ? warn : {};
    this.horn.g.gain.setTargetAtTime(w.horn ? 0.07 : 0, now, 0.01);
    this.engOut.o.frequency.setValueAtTime(Math.floor(now * 5) % 2 ? 1000 : 600, now);
    this.engOut.g.gain.setTargetAtTime(w.engineOut ? 0.08 : 0, now, 0.01);
    if (w.overtorque) {
      this._chimeT -= dt;
      if (this._chimeT <= 0) {
        this._chimeT = 1.2;
        this.chime();
      }
    } else this._chimeT = 0;
    const T = 0.05;
    const e = st.engine;
    const r = st.rotor;
    const ng = e.ng / 100;
    const nr = r.percent / 100;
    const rps = (r.rpm || 0) / 60;
    const thrustW = Math.max(0, r.thrust) / (st.mass * 9.81);
    // ---- start: the igniter ticks while cranking until light-off; a whoomph at light-off ----
    if (e.starter && !e.lit) {
      this._spark += dt * 6;
      if (this._spark >= 1) {
        this._spark -= 1;
        this.sound.click(3200, 0.08 * listen, 0.01);
      }
    }
    if (e.lit && !this._lit) this.sound._burst('lowpass', 220, 0.4 * listen, 0.5);
    this._lit = e.lit;
    // ---- turbine ----
    const out = inside ? 0.35 : 1;
    this.whine1.o.frequency.setTargetAtTime(Math.max(20, ng * 380 * 10 * pitch), now, T);
    this.whine2.o.frequency.setTargetAtTime(Math.max(20, ng * 380 * 20 * pitch), now, T);
    this.whine1.g.gain.setTargetAtTime(0.05 * ng * ng * out * listen, now, T);
    this.whine2.g.gain.setTargetAtTime(0.025 * ng * ng * out * listen, now, T);
    this.whineNoise.f.frequency.setTargetAtTime((1500 + ng * 6000) * pitch, now, T);
    this.whineNoise.g.gain.setTargetAtTime(0.06 * ng * out * listen, now, T);
    this.combust.g.gain.setTargetAtTime((e.lit ? 0.05 + 0.08 * (e.torquePercent / 100) : 0) * listen, now, T);
    // ---- rotor thump and slap ----
    const bpf = Math.max(0.5, rps * 4 * pitch);
    this.rotorOsc.frequency.setTargetAtTime(bpf, now, T);
    const vKmh = (st.airspeed || 0) * 3.6;
    const desc = -st.verticalSpeed;
    const bvi = Math.max(0, Math.min(1, (desc - 1) / 2) * (desc < 7 ? 1 : 0)) * (vKmh > 40 && vKmh < 140 ? 1 : 0);
    const turn = Math.max(0, Math.min(1, (st.loadFactor - 1.35) / 0.4));
    const slap = Math.max(bvi, turn);
    this.slap = slap;
    const thump = (0.12 + 0.35 * thrustW) * Math.min(1, nr * 1.3);
    // (V3: inside was 1.2 x the outside thump, so the cabin measured 0.8 dB louder than standing beside the
    // aircraft in the hover; the cabin structure carries the low thump but takes some off: 0.8)
    this.rotorG.gain.setTargetAtTime(thump * (1 + slap) * listen * (inside ? 0.8 : 1), now, T);
    this.rotorLP.frequency.setTargetAtTime((160 + 300 * slap + 80 * thrustW) * pitch, now, T);
    this.harm2.o.frequency.setTargetAtTime(bpf * 2, now, T);
    this.harm3.o.frequency.setTargetAtTime(bpf * 3, now, T);
    this.harm2.g.gain.setTargetAtTime(0.06 * thump * listen, now, T);
    this.harm3.g.gain.setTargetAtTime(0.03 * thump * listen, now, T);
    this.pulseToGate.gain.setTargetAtTime(0.25 * slap * (inside ? 0.6 : 1) * listen, now, T);
    // ---- tail rotor, gearbox, wind ----
    const tailF = Math.max(1, ((r.tailRpm || 0) / 60) * 4 * pitch);
    this.tail.o.frequency.setTargetAtTime(tailF, now, T);
    this.tail.g.gain.setTargetAtTime((0.01 + 0.03 * Math.min(1, Math.abs(r.tailThrust) / 2500)) * nr * (inside ? 0.5 : 1) * listen, now, T);
    // (the main gearbox's mesh: 68 x rotor rps, 442 Hz at 100 %, and its 2nd; V2's header said 17 x)
    this.gear1.o.frequency.setTargetAtTime(Math.max(1, rps * 17 * 4 * pitch), now, T);
    this.gear2.o.frequency.setTargetAtTime(Math.max(1, rps * 34 * 4 * pitch), now, T);
    this.gear1.g.gain.setTargetAtTime((inside ? 0.025 : 0.006) * nr * listen, now, T);
    this.gear2.g.gain.setTargetAtTime((inside ? 0.01 : 0.002) * nr * listen, now, T);
    const v = st.airspeed || 0;
    this.wind.g.gain.setTargetAtTime(Math.min(0.3, (v * v) / 9000) * (inside ? 0.5 : 1) * listen, now, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + v * 10, now, 0.1);
    this.bus.gain.setTargetAtTime(0.8, now, 0.1);
    this.cabin.frequency.setTargetAtTime(inside ? 1400 : 18000, now, 0.1);
  }

  /** (V5) The overtorque chime: two falling notes. */
  chime() {
    const ctx = this.sound.ctx;
    if (!ctx || ctx.state !== 'running') return;
    for (const [f, d] of [[1320, 0], [990, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = ctx.currentTime + d;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      o.connect(g).connect(this.sound.out);
      o.start(at);
      o.stop(at + 0.55);
    }
  }

  door(shut) {
    const s = this.sound;
    if (shut) {
      // (V5) the cockpit door: lighter than the car's, a hollow panel and the latch
      s._burst('lowpass', 300, 0.25, 0.09);
      s._thump(140, 60, 0.3, 0.12);
      s.click(2000, 0.15, 0.03);
    } else s.click(1600, 0.15);
  }

  silence() {
    if (!this.on) return;
    const now = this.sound.ctx.currentTime;
    this.bus.gain.setTargetAtTime(0, now, 0.2);
    for (const n of [this.wind, this.gear1, this.gear2, this.horn, this.engOut]) n.g.gain.setTargetAtTime(0, now, 0.1);
  }
}
