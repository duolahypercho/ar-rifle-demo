// (V5) Keyboard feel: a key is 0 or 1; these turn held keys into the controls the car and the helicopter get, so a
// person can hold a line and a hover. Pure (no Three.js): main.js uses them and tools/v5_keys.mjs drives the same
// code with scripted key presses in Node.
//
// Car (CarKeys): the steering command moves toward the key's side at a rate that falls with speed (full in 0.18 s
// standing, 0.5 s at 200 km/h), so a tap is a small correction and a hold a full turn; it comes back to centre 1.6 x
// as fast as it goes out, and pressing the other key while the wheel is turned moves it through the centre at that
// return rate too (counter-steer is never slowed by the ramp); the dynamics then limit the road wheels' angle with
// speed and the rack's rate as before. Throttle 0 -> 1 in 0.12 s and off in 0.08 s; brake 0 -> 1 in 0.10 s and off in
// 0.06 s (the brake line adds its own 60 ms).
//
// Helicopter (HeliKeys): cyclic and pedals move at 2.5 per s toward the key and, released, return at 4 per s to the
// trim point, not to zero. Trim is where the controls sit hands-off: with the assist on, zero (the assist's own
// attitude reference and integrators hold the aircraft); with the assist off, the raw stick's trim, set from the
// controls the assist was giving when it was switched off and moved by the force-trim key (Y: the trim point becomes
// where the stick and pedals are now), so letting go keeps the hover instead of snapping the stick to the middle.
// The collective is a rate (0.3 of travel per s while R or F is held), the lever stays where it is put.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const toward = (x, to, rate, dt) => x + clamp(to - x, -rate * dt, rate * dt);

export class CarKeys {
  constructor() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
  }

  reset() {
    this.steer = this.throttle = this.brake = 0;
  }

  /** keys: { left, right, throttle, brake } booleans; speed m/s. Returns this ({ steer, throttle, brake }). */
  update(keys, speed, dt) {
    const want = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const v = Math.abs(speed);
    const out = 1 / (0.18 + 0.32 * clamp(v / 55, 0, 1)); // full travel per s going out
    const back = out * 1.6;
    // going out from centre on the key's side: the out rate; back toward centre (released, or the other key
    // through the centre): the return rate
    const outward = want !== 0 && Math.sign(want) === Math.sign(this.steer || want) && Math.abs(want) > Math.abs(this.steer);
    this.steer = toward(this.steer, want, outward ? out : back, dt);
    this.throttle = toward(this.throttle, keys.throttle ? 1 : 0, keys.throttle ? 1 / 0.12 : 1 / 0.08, dt);
    this.brake = toward(this.brake, keys.brake ? 1 : 0, keys.brake ? 1 / 0.1 : 1 / 0.06, dt);
    return this;
  }
}

export class HeliKeys {
  constructor() {
    this.cp = 0;
    this.cr = 0;
    this.ped = 0;
    this.lever = 0;
    this.trim = { cp: 0, cr: 0, ped: 0 };
  }

  /** Force trim: the trim point becomes where the controls are now. */
  setTrim(c = { cp: this.cp, cr: this.cr, ped: this.ped }) {
    this.trim.cp = c.cp;
    this.trim.cr = c.cr;
    this.trim.ped = c.ped;
  }

  /**
   * keys: { fwd, back, left, right, pedL, pedR, up, down } booleans; assist: true when the assist is on (trim 0).
   * Returns { cyclicPitch, cyclicRoll, pedal, collective, collectiveRate }.
   */
  update(keys, dt, assist = true) {
    const tr = assist ? { cp: 0, cr: 0, ped: 0 } : this.trim;
    const wcp = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    const wcr = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const wped = (keys.pedR ? 1 : 0) - (keys.pedL ? 1 : 0);
    this.cp = toward(this.cp, wcp ? wcp : tr.cp, wcp ? 2.5 : 4, dt);
    this.cr = toward(this.cr, wcr ? wcr : tr.cr, wcr ? 2.5 : 4, dt);
    this.ped = toward(this.ped, wped ? wped : tr.ped, wped ? 2.5 : 4, dt);
    const rate = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    this.lever = clamp(this.lever + rate * 0.3 * dt, 0, 1);
    return { cyclicPitch: this.cp, cyclicRoll: this.cr, pedal: this.ped, collective: this.lever, collectiveRate: rate };
  }
}
