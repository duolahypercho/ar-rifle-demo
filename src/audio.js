// Sound, synthesised in the browser: no audio files. Everything is built from filtered noise
// and a few oscillators. Browsers only allow sound after a click or key press, so unlock()
// is called from those.
// The mouth's resonances for two vowels, [frequency Hz, sharpness, level], for a man's voice.
const AH = [[730, 6, 1], [1090, 8, 0.5], [2440, 9, 0.2]];
const UH = [[520, 6, 1], [1190, 8, 0.4], [2390, 9, 0.15]];

export class Sound {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.noise = null;
    this.throat = 0.97 + Math.random() * 0.06; // this throat's size: shifts every resonance a little
    this.winded = 0; // 0..1, how out of breath
    this.nextBreath = 1;
    this.speech = true; // spoken calls on or off
    this.lastSaid = -10;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.out = this.ctx.createDynamicsCompressor();
    const master = this.ctx.createGain();
    master.gain.value = 0.55;
    this.out.connect(master).connect(this.ctx.destination);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** A burst of filtered noise: `type` and `freq` set the filter, `decay` how fast it dies (s). */
  _burst(type, freq, gain, decay, delay = 0, q = 0.8) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(filter).connect(amp).connect(this.out);
    src.start(at, Math.random() * 0.5, decay + 0.05);
  }

  /** A falling tone, for the thump under a shot. */
  _thump(from, to, gain, decay) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(amp).connect(this.out);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  shot(shotgun) {
    if (shotgun) {
      this._burst('lowpass', 1500, 1.1, 0.34);
      this._burst('bandpass', 700, 0.7, 0.22);
      this._thump(120, 34, 1.0, 0.3);
    } else {
      this._burst('bandpass', 1900, 0.9, 0.11);
      this._burst('lowpass', 900, 0.55, 0.16);
      this._thump(150, 48, 0.6, 0.13);
    }
    this._burst('lowpass', 500, 0.12, 0.9, 0.05); // the tail rolling off the backstop
  }

  /** A metallic click; two close together make a clack. */
  click(freq = 2600, gain = 0.25, delay = 0) {
    this._burst('bandpass', freq, gain, 0.035, delay, 4);
  }

  /** Named moments in the handling of the guns (see Weapon.events). */
  handle(event) {
    if (event === 'magOut') {
      this.click(1700, 0.3);
      this.click(900, 0.2, 0.03);
    } else if (event === 'magIn') {
      this.click(1300, 0.4);
      this.click(2400, 0.25, 0.025);
    } else if (event === 'boltBack') this.click(1500, 0.3);
    else if (event === 'boltForward') {
      this.click(2100, 0.45);
      this.click(1100, 0.3, 0.02);
    } else if (event === 'pumpBack') {
      this.click(1000, 0.45);
      this._burst('bandpass', 600, 0.2, 0.08);
    } else if (event === 'pumpForward') {
      this.click(1250, 0.5);
      this.click(2300, 0.25, 0.02);
    } else if (event === 'shellIn') this.click(1500, 0.3);
    else if (event === 'dry') this.click(3200, 0.2);
    else if (event === 'sling') this._burst('lowpass', 900, 0.12, 0.18);
  }

  /** Struck: a dull body blow, and a grunt-like low thump for a heavy one; the kit rattles. */
  hit(heavy) {
    this._burst('lowpass', 180, heavy ? 0.5 : 0.3, heavy ? 0.22 : 0.12);
    this._thump(heavy ? 120 : 160, 55, heavy ? 0.35 : 0.18, heavy ? 0.25 : 0.14);
    this._burst('bandpass', 2600, 0.04, 0.06, 0.03, 2);
  }

  /**
   * The character's voice, synthesised: a buzzing source (the vocal folds) and some breath noise
   * through three resonances (the mouth's formants), which is what makes a tone sound like a
   * throat rather than a beep. `formants` picks the vowel; `breath` 0..1 is how airy it is.
   */
  _voice(from, to, length, gain, formants, breath = 0.3, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + delay;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.03, length * 0.25));
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    amp.connect(this.out);
    const mouth = formants.map(([freq, q, level]) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * this.throat;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      f.connect(g).connect(amp);
      return f;
    });
    if (breath < 1) {
      const folds = ctx.createOscillator();
      folds.type = 'sawtooth';
      folds.frequency.setValueAtTime(from, at);
      folds.frequency.exponentialRampToValueAtTime(to, at + length);
      const g = ctx.createGain();
      g.gain.value = 1 - breath;
      folds.connect(g);
      for (const f of mouth) g.connect(f);
      folds.start(at);
      folds.stop(at + length + 0.05);
    }
    if (breath > 0) {
      const air = ctx.createBufferSource();
      air.buffer = this.noise;
      const g = ctx.createGain();
      g.gain.value = breath * 0.6;
      air.connect(g);
      for (const f of mouth) g.connect(f);
      air.start(at, Math.random() * 0.5, length + 0.05);
    }
  }

  /** One breath in or out: air only, swelling and fading. */
  _breath(out, length, gain, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + delay;
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime((out ? 900 : 1700) * this.throat, at);
    f.frequency.linearRampToValueAtTime((out ? 600 : 2100) * this.throat, at + length);
    f.Q.value = 0.9;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + length * (out ? 0.25 : 0.55));
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    air.connect(f).connect(amp).connect(this.out);
    air.start(at, Math.random() * 0.4, length + 0.05);
  }

  /**
   * Breathing, called every frame. `effort` 0..1 is how hard the body is working now (a sprint is
   * 1); being out of breath builds up over seconds and wears off slowly, so the breathing is
   * heard after a run, not only during it.
   */
  breathe(dt, effort) {
    this.winded += ((effort > this.winded ? 0.22 : 0.09) * (effort - this.winded)) * dt * 4;
    this.winded = Math.min(1, Math.max(0, this.winded));
    this.nextBreath -= dt;
    if (this.nextBreath > 0) return;
    const w = this.winded;
    const cycle = 3.6 - 2.5 * w + Math.random() * 0.3; // s for one breath in and out
    this.nextBreath = cycle;
    if (w < 0.12) return; // at rest it is too quiet to hear
    const loud = 0.03 + 0.2 * w;
    this._breath(false, cycle * 0.4, loud * 0.7);
    this._breath(true, cycle * 0.48, loud, cycle * 0.44);
    // hard out of breath, a little voice comes with the breath out
    if (w > 0.7 && Math.random() < 0.5) this._voice(120, 95, 0.22, 0.05 * w, AH, 0.75, cycle * 0.46);
  }

  /** Struck: a grunt, longer and lower for a heavy blow. */
  grunt(heavy) {
    const pitch = (heavy ? 135 : 150) * (0.94 + Math.random() * 0.12);
    if (heavy) {
      this._voice(pitch * 1.25, pitch * 0.7, 0.42, 0.5, AH, 0.3, 0.03);
      this._breath(true, 0.35, 0.12, 0.4);
    } else this._voice(pitch * 1.15, pitch * 0.8, 0.16, 0.38, UH, 0.35, 0.02);
    this.winded = Math.min(1, this.winded + (heavy ? 0.35 : 0.12));
  }

  /** A short push of effort (standing up from a crouch, the swap going over the shoulder). */
  effort() {
    this._voice(118, 100, 0.12, 0.12, UH, 0.6);
  }

  /**
   * A spoken call ("Reloading"). Words cannot be built from noise and tones, so this uses the
   * browser's own speech voice; it is skipped where the browser has none.
   */
  say(text) {
    const synth = window.speechSynthesis;
    if (!this.speech || !synth || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastSaid < 6 || synth.speaking) return;
    this.lastSaid = now;
    const line = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
    const pick = voices.find((v) => /male|daniel|alex|fred|aaron|david|guy/i.test(v.name) && !/female/i.test(v.name)) || voices[0];
    if (pick) line.voice = pick;
    line.rate = 1.25;
    line.pitch = 0.75;
    line.volume = 0.8;
    synth.speak(line);
  }

  /** A footfall; `weight` is 1 at a walk and more at a run. */
  step(weight) {
    this._burst('lowpass', 260 + Math.random() * 90, 0.45 + 0.3 * weight, 0.11);
    this._burst('bandpass', 1400 + Math.random() * 600, 0.1 + 0.07 * weight, 0.05);
  }
}
