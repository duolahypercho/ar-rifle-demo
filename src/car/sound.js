// The supercar's sound (pass V1), synthesised like src/audio.js (no files), on the same audio context
// and output as the game's Sound. Nothing here has been listened to: it is built from what a V12 is.
//
//   engine    a 60-degree V12 fires evenly, 6 times a crank turn: the firing frequency is rpm / 10 Hz.
//             A harmonic stack on it: half-order (rpm/120: the rumble of one bank's uneven exhaust
//             pulses), the firing order 1 (strongest), 2, 3 and 4.5 (the shriek at high rpm), each a
//             sawtooth or square through its own gain that follows rpm and load; a low-passed noise
//             rasp that opens with load. Intake (band-passed noise, throttle) and exhaust (low-passed
//             sum) are separate paths with their own filters: the exhaust filter's corner rises with
//             rpm, the intake howl's centre follows the 3rd order.
//   shift     on each change the ignition is cut for the shift time: the stack ducks, then a crack
//             (a short noise burst) on upshifts and a blip (rpm swoops up) on downshifts
//   pops      lifting off above 6000 rpm, a few random cracks for half a second (overrun)
//   tyres     squeal: a band of noise near 900 Hz plus a wavering tone at 1.1 to 1.6 kHz, loudness from
//             the sliding speed of the tyres, its pitch from the slip
//   wind      low-passed noise rising with the square of the speed; road roar from the tyres' rolling
//   doors     a thunk: a low falling tone and a short low noise burst, with a latch click
//   (V5) start  the starter motor: a geared whine at 0.55 x crank rpm Hz and the compression pulses at the firing
//             rate while it cranks; a low cough at the first firing; nothing from the engine with the ignition off
//   (V5) limiter at the cut the stack drops to 6 % (it was 40 %, a dip that did not read as the limiter) with a
//             small pop at each cut: the stutter at the limiter's own rate
//   (V5) hits  a crunch per impact by its speed change: a low body thump, a mid crushing noise and a bright
//             metal clatter, louder and longer with the impulse; scraping: band-passed noise near 2.5 kHz from the
//             friction power at the contact
//   (V5) indicator  the relay's tick and tock (a click on and a duller one off)
export class CarSound {
  constructor(sound) {
    this.sound = sound; // src/audio.js Sound: its ctx, out and noise buffer
    this.on = false;
    this.lastGear = null;
    this.overrun = 0;
  }

  _build() {
    const s = this.sound;
    const ctx = s.ctx;
    if (!ctx || this.on) return !!this.on;
    const bus = ctx.createGain();
    bus.gain.value = 0.0;
    bus.connect(s.out);
    this.bus = bus;
    // exhaust path: harmonics -> exhaust low-pass -> bus ; intake path: noise -> band-pass -> bus
    const exhaust = ctx.createBiquadFilter();
    exhaust.type = 'lowpass';
    exhaust.Q.value = 0.9;
    exhaust.connect(bus);
    this.exhaust = exhaust;
    this.orders = [0.5, 1, 2, 3, 4.5].map((order, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 1 ? 'sawtooth' : i === 4 ? 'square' : 'triangle';
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(exhaust);
      osc.start();
      return { order, osc, g };
    });
    const noise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = s.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g);
      src.start();
      return { src, f, g };
    };
    this.rasp = noise('lowpass', 900, 0.7);
    this.rasp.g.connect(exhaust);
    this.intake = noise('bandpass', 1200, 3);
    this.intake.g.connect(bus);
    this.wind = noise('lowpass', 500, 0.5);
    this.wind.g.connect(s.out);
    this.road = noise('bandpass', 140, 0.8);
    this.road.g.connect(s.out);
    this.squeal = noise('bandpass', 950, 6);
    this.squeal.g.connect(s.out);
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    const tg = ctx.createGain();
    tg.gain.value = 0;
    tone.connect(tg).connect(s.out);
    tone.start();
    this.squealTone = { osc: tone, g: tg };
    // (V5) starter, scrape
    const st = ctx.createOscillator();
    st.type = 'sawtooth';
    const stf = ctx.createBiquadFilter();
    stf.type = 'bandpass';
    stf.frequency.value = 400;
    stf.Q.value = 1.2;
    const stg = ctx.createGain();
    stg.gain.value = 0;
    st.connect(stf).connect(stg).connect(s.out);
    st.start();
    this.starter = { osc: st, f: stf, g: stg };
    this.scrape = noise('bandpass', 2500, 1.5);
    this.scrape.g.connect(s.out);
    this.on = true;
    return true;
  }

  /**
   * Every frame while the car exists. `listen` 0..1: how much of it is heard (inside, near). `pitch` (V3): the
   * Doppler factor for a listener the car moves relative to (1 inside or riding along with the chase camera).
   */
  update(dt, dyn, listen = 1, inside = false, pitch = 1) {
    if (!this._build()) return;
    const ctx = this.sound.ctx;
    const now = ctx.currentTime;
    const T = 0.04; // s, smoothing of every parameter
    // (V5) the ignition: the engine is heard only while it turns over on its own (running), or cranking
    const ign = dyn.ignition || 'running';
    const turning = ign === 'running' ? 1 : 0;
    const rpm = ign === 'running' ? Math.max(600, dyn.rpm) : Math.max(1, dyn.rpm);
    const load = Math.max(0, dyn.engine.load);
    const fire = (rpm / 10) * pitch; // Hz, firing frequency (as heard)
    const shifting = !!dyn.shift;
    const cut = (shifting ? 0.25 : dyn.engine.cut ? 0.06 : 1) * turning;
    if (dyn.engine.cut && !this._wasCut && turning) this.sound._burst('bandpass', 700, 0.12 * listen, 0.04, 0, 1.5);
    this._wasCut = dyn.engine.cut;
    const cranking = ign === 'cranking' ? 1 : 0;
    this.starter.osc.frequency.setTargetAtTime(Math.max(20, dyn.rpm * 0.55), now, 0.03);
    this.starter.f.frequency.setTargetAtTime(Math.max(60, dyn.rpm * 1.1), now, 0.03);
    // (the compression pulses: the starter's load rises and falls 6 times a turn, its gain wobbling with them)
    const pulse = cranking ? 0.6 + 0.4 * Math.sin(now * 2 * Math.PI * (dyn.rpm / 10)) : 0;
    this.starter.g.gain.setTargetAtTime(0.09 * pulse * listen * (inside ? 0.8 : 1), now, 0.01);
    // (V3: measured offline, part load (0.3) was only 7 dB under full with the same spectrum; a throttled V12
    // is quieter and darker, its upper orders falling away: the overall level 0.12 .. 1 with load, and the
    // orders above the firing order tilted down at part load, the half order (the bank rumble) up)
    const level = (0.12 + 0.88 * load) * cut;
    const tilt = 0.35 + 0.65 * load;
    const gains = [0.22 * (1.3 - 0.3 * load), 0.5, 0.28 * tilt, 0.16 * (0.4 + rpm / 9000) * tilt, 0.07 * Math.max(0, (rpm - 4000) / 4500) * tilt * tilt];
    this.orders.forEach((o, i) => {
      o.osc.frequency.setTargetAtTime(fire * o.order, now, T * 0.5);
      o.g.gain.setTargetAtTime(gains[i] * level * 0.35, now, T);
    });
    this.exhaust.frequency.setTargetAtTime((500 + rpm * 0.45 + load * 1500) * pitch, now, T);
    this.rasp.f.frequency.setTargetAtTime((400 + rpm * 0.25) * pitch, now, T);
    this.rasp.g.gain.setTargetAtTime((0.04 + 0.12 * load) * cut, now, T);
    // (V5) the crash's noises (from the car's events) and the scrape
    if (dyn.hits) {
      for (const ev of dyn.hits) this.crunch(ev.dv, listen);
      dyn.hits.length = 0;
    }
    this.scrape.g.gain.setTargetAtTime(Math.min(0.35, (dyn.scrapeKw || 0) / 150) * listen, now, 0.03);
    this.scrape.f.frequency.setTargetAtTime(1800 + Math.min(2500, (dyn.scrapeKw || 0) * 10), now, 0.05);
    this.intake.f.frequency.setTargetAtTime(fire * 3, now, T);
    this.intake.g.gain.setTargetAtTime(0.05 * load * (rpm / 8500) * cut * (inside ? 1.4 : 0.8), now, T);
    this.bus.gain.setTargetAtTime(0.9 * listen * (inside ? 0.8 : 1), now, 0.1);
    // gear changes: a crack up, a blip down
    if (this.lastGear !== null && dyn.gear !== this.lastGear && dyn.gear > 1 && this.lastGear > 1) {
      if (dyn.gear > this.lastGear) this.sound._burst('bandpass', 1800, 0.22 * listen, 0.07, 0.02, 1.5);
      else this.sound._burst('lowpass', 700, 0.18 * listen, 0.12);
    }
    this.lastGear = dyn.gear;
    // overrun pops: lifting off at high revs
    if (load < 0.05 && rpm > 6000 && this.prevLoad > 0.5) this.overrun = 0.6;
    this.prevLoad = load;
    if (this.overrun > 0) {
      this.overrun -= dt;
      if (Math.random() < dt * 14) this.sound._burst('bandpass', 900 + Math.random() * 900, 0.25 * listen, 0.05, 0, 2);
    }
    // tyres, wind, road
    let slide = 0;
    let slip = 0;
    let roll = 0;
    for (const w of dyn.wheels) {
      if (!w.contact || w.surface.dust) continue;
      slide += Math.max(0, w.slipSpeed - 1.5) * Math.min(1, w.fz / 4000);
      slip = Math.max(slip, Math.abs(w.alpha), Math.abs(w.kappa) * 0.5);
      roll += Math.abs(w.vx || 0);
    }
    const sq = Math.min(1, slide / 12);
    this.squeal.g.gain.setTargetAtTime(0.25 * sq * listen, now, 0.05);
    this.squeal.f.frequency.setTargetAtTime((800 + slip * 1200) * pitch, now, 0.05);
    this.squealTone.osc.frequency.setTargetAtTime((1100 + slip * 900 + Math.sin(now * 23) * 40) * pitch, now, 0.03);
    this.squealTone.g.gain.setTargetAtTime(0.05 * sq * listen, now, 0.05);
    const v = Math.hypot(dyn.vel.x, dyn.vel.z);
    this.wind.g.gain.setTargetAtTime(Math.min(0.35, (v * v) / 9000) * (inside ? 0.6 : 1) * listen, now, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + v * 12, now, 0.1);
    this.road.g.gain.setTargetAtTime(Math.min(0.15, roll / 600) * listen, now, 0.1);
  }

  /** (V5) An impact by its speed change (m/s): body thump, crushing, metal. */
  crunch(dv, listen = 1) {
    const s = this.sound;
    const k = Math.min(1, dv / 12);
    const g = (0.25 + 0.75 * k) * listen;
    s._thump(110, 38, 0.7 * g, 0.18 + 0.25 * k);
    s._burst('lowpass', 900, 0.55 * g, 0.12 + 0.35 * k);
    s._burst('bandpass', 2600, 0.35 * g, 0.08 + 0.3 * k, 0.01, 1.2);
    if (k > 0.3) s._burst('highpass', 4500, 0.2 * g, 0.4 * k, 0.04, 0.7); // (glass and trim)
  }

  /** (V5) The indicator relay: tick as the lamp lights, a duller tock as it goes out. */
  tick(on) {
    this.sound.click(on ? 3000 : 1900, on ? 0.06 : 0.04);
  }

  /** (V5) The engine's first firing: a low cough. */
  fire() {
    this.sound._burst('lowpass', 260, 0.35, 0.25);
    this.sound._thump(90, 45, 0.3, 0.2);
  }

  /** The door shutting (or opening: lighter, no thunk). */
  door(shut) {
    const s = this.sound;
    if (shut) {
      // (V5) a heavier thunk: the door's mass on the seals (a low falling tone), the panel's ring and the latch
      s._thump(120, 50, 0.45, 0.16);
      s._thump(210, 150, 0.12, 0.09);
      s._burst('lowpass', 260, 0.35, 0.1);
      s.click(1800, 0.15, 0.04);
    } else {
      s.click(1500, 0.18);
      s._burst('lowpass', 600, 0.06, 0.25);
    }
  }

  silence() {
    if (!this.on) return;
    const now = this.sound.ctx.currentTime;
    this.bus.gain.setTargetAtTime(0, now, 0.2);
    for (const n of [this.wind, this.road, this.squeal, this.scrape]) n.g.gain.setTargetAtTime(0, now, 0.1);
    this.squealTone.g.gain.setTargetAtTime(0, now, 0.1);
  }
}
