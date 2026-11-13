// Nobody holding a gun stands like a statue. This decides, at random moments, the small
// things a person does without thinking: shifting weight from one leg to the other, moving
// their feet, changing how the gun is carried, rolling their shoulders, stretching their
// neck, looking about. Held on aim, the gun wobbles with breath and tiring arms and is
// re-seated every few seconds. character.js and weapon.js read the values from here.
import { Smooth } from './character.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Ways of carrying the gun at rest, as small offsets on the clips' own hold (the Gun track, which
// already breathes and drifts in rifle-idle), in the chest's frame: yaw + = muzzle to the left,
// pitch + = muzzle down, roll + = top to the right (rad), drop (m); `slide` moves the support hand
// along the handguard (m). They are kept small so the gun stays clear of the body without the
// run-time clearance having to push it (weapon.js).
const CARRIES = [
  { yaw: 0, pitch: 0, roll: 0, drop: 0, slide: 0 }, // as the clips hold it
  { yaw: 0.04, pitch: 0.1, roll: -0.03, drop: 0.015, slide: 0.015 }, // relaxed, muzzle lower
  { yaw: -0.04, pitch: -0.1, roll: 0.03, drop: -0.005, slide: -0.01 }, // a little higher
  { yaw: 0.05, pitch: 0.03, roll: -0.1, drop: 0.01, slide: 0.005 }, // canted over
];
const KEYS = ['yaw', 'pitch', 'roll', 'drop', 'slide'];

export class Alive {
  constructor() {
    this.weight = 0; // -1 = standing on the left leg, +1 = on the right
    this.stagger = 0; // lead foot further forward (+) or back (m)
    this.width = 0; // feet further apart (+) or closer (m)
    this.scanYaw = 0; // head and shoulders turning to look about (rad)
    this.scanPitch = 0;
    this.carry = { yaw: 0, pitch: 0, roll: 0, drop: 0, slide: 0 };
    this.shrug = 0; // shoulders rolling, 0..1
    this.tilt = 0; // neck stretched to one side (rad)
    this.sway = { yaw: 0, pitch: 0 }; // wobble of a gun held on aim (rad)
    this.resettle = false; // true on the frame the aim is re-seated
    this.restep = 0; // s left in which the feet should step into the new stance
    this.changes = 0; // how many things have changed so far (for review)

    this._s = { weight: new Smooth(), stagger: new Smooth(), width: new Smooth(), scanYaw: new Smooth(), scanPitch: new Smooth(), tilt: new Smooth() };
    this._carry = KEYS.map(() => new Smooth());
    this._to = { weight: 0, stagger: 0, width: 0, scanYaw: 0, scanPitch: 0, tilt: 0, carry: 0 };
    this._in = { weight: 2, stance: 6, scan: 2, carry: 5, shrug: 9, tilt: 14, settle: 6 };
    this._shrugT = 9;
    this._tiltT = 9;
    this._held = 0; // s on aim since the last re-seat
    this._t = 0;
  }

  /** s: { standing, aim (0..1), busy } - busy while firing, reloading or swapping. */
  update(dt, s) {
    const to = this._to;
    const wait = this._in;
    this._t += dt;
    this.resettle = false;
    this.restep = Math.max(0, this.restep - dt);
    const carried = s.aim < 0.3 && !s.busy;
    for (const key in wait) wait[key] -= dt;

    // weight: on one leg, then the other
    if (!s.standing) to.weight = 0;
    else if (wait.weight <= 0) {
      const side = to.weight > 0 ? -1 : 1;
      to.weight = side * rand(0.45, 1);
      wait.weight = rand(3.5, 8);
      this.changes++;
    }
    // feet: a new stance every so often (the body steps into it)
    if (s.standing && wait.stance <= 0) {
      const small = s.aim > 0.5 ? 0.5 : 1;
      to.stagger = rand(-0.11, 0.1) * small;
      to.width = rand(-0.035, 0.07) * small;
      wait.stance = rand(7, 14);
      this.restep = 1.6; // long enough for both feet to move
      this.changes++;
    }
    // eyes: look ahead most of the time, off to one side now and then
    if (!carried) to.scanYaw = to.scanPitch = 0;
    else if (wait.scan <= 0) {
      const away = to.scanYaw === 0 && Math.random() < 0.75;
      to.scanYaw = away ? (Math.random() < 0.5 ? -1 : 1) * rand(0.22, s.standing ? 0.75 : 0.5) : 0;
      to.scanPitch = away ? rand(-0.08, 0.06) : 0;
      wait.scan = away ? rand(1, 2.6) : rand(1.5, 4.5);
      this.changes++;
    }
    // the gun: carried a different way every few seconds
    if (!carried) {
      to.carry = 0;
      wait.carry = Math.max(wait.carry, 2.5);
    } else if (wait.carry <= 0) {
      let next = Math.floor(Math.random() * CARRIES.length);
      if (next === to.carry) next = (next + 1) % CARRIES.length;
      to.carry = next;
      wait.carry = rand(6, 13);
      this.changes++;
    }
    // shoulders roll, neck stretches
    this._shrugT += dt;
    if (s.standing && carried && wait.shrug <= 0) {
      this._shrugT = 0;
      wait.shrug = rand(11, 24);
      this.changes++;
    }
    this.shrug = this._shrugT < 0.9 ? Math.sin((this._shrugT / 0.9) * Math.PI) ** 2 : 0;
    this._tiltT += dt;
    if (s.standing && carried && wait.tilt <= 0) {
      this._tiltT = 0;
      to.tilt = (Math.random() < 0.5 ? -1 : 1) * rand(0.1, 0.17);
      wait.tilt = rand(14, 28);
      this.changes++;
    }
    if (this._tiltT > 0.9) to.tilt = 0;

    const smooth = this._s;
    this.weight = smooth.weight.to(to.weight, 0.55, dt);
    this.stagger = smooth.stagger.to(to.stagger, 0.3, dt);
    this.width = smooth.width.to(to.width, 0.3, dt);
    this.scanYaw = smooth.scanYaw.to(to.scanYaw, 0.42, dt);
    this.scanPitch = smooth.scanPitch.to(to.scanPitch, 0.42, dt);
    this.tilt = smooth.tilt.to(to.tilt, 0.32, dt);
    const carry = CARRIES[to.carry];
    for (let i = 0; i < KEYS.length; i++) this.carry[KEYS[i]] = this._carry[i].to(carry[KEYS[i]], 0.4, dt);

    // on aim: the muzzle wanders with breathing and tiring arms, until the hold is re-seated
    if (s.aim > 0.9 && !s.busy) {
      this._held += dt;
      if (wait.settle <= 0) {
        this.resettle = true;
        this._held = 0;
        wait.settle = rand(5, 9);
        this.changes++;
      }
    } else {
      this._held = 0;
      wait.settle = Math.max(wait.settle, 3);
    }
    const t = this._t;
    const tired = 0.006 + Math.min(0.005, this._held * 0.0007);
    this.sway.yaw = (Math.sin(t * 0.83) + Math.sin(t * 2.1 + 1) * 0.35) * tired;
    this.sway.pitch = (Math.sin(t * 1.7) * 0.8 + Math.sin(t * 0.61 + 2) * 0.5) * tired;
  }
}
