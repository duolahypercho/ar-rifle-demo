// (V3) The driver's hands round the steering wheel's rim: push-pull steering as taught, pure (no Three.js),
// so it can be tested in Node (test/hands.test.js). Angles in radians on the rim as the driver sees it,
// from 12 o'clock, + to the left (9 o'clock = +pi/2, 3 o'clock = -pi/2); `theta` is the wheel's own angle
// (+ = turned left). Each hand has a world angle `w` (where it is on the rim in the car) and is either
// gripping (w turns with the wheel) or sliding (palm on the rim, loose, the rim moving under it while the
// hand goes to a new place).
//
//   at speed   (car over 4 m/s) the hands stay where they are on the rim, at 9 and 3, and turn with it up to
//              +-90 degrees of wheel; no regrip for normal inputs
//   push-pull  past that, or at low speed for big turns: the left hand works on the left half of the rim, the
//              right on the right half (they never cross 12 or 6, so never each other or the other arm). The
//              hand going toward its stroke's end grips and turns the wheel; the other slides back along the
//              rim to the start of its stroke, three times as fast as the wheel turns, and takes over when the
//              first reaches the end. One hand is always gripping. Strokes: left 20 .. 160 degrees, right
//              -160 .. -65 (85 degrees apart at the top, 40 either side of the bottom spoke at 6)
//   home       with the wheel steady and near centre the hands slide back to 9 and 3, one at a time
const D = Math.PI / 180;
export const HOME = { Left: 90 * D, Right: -90 * D };
// (the right stroke stops short of 2 o'clock: with the pack's seated trunk the right palm is 4 to 10 cm short of the
// rim from 1 o'clock up, the left reaches 11:20 with no error)
export const STROKE = { Left: [20 * D, 160 * D], Right: [-160 * D, -65 * D] };
const RIDE = 90 * D; // at speed, how far the hands ride from 9 and 3 before push-pull
// a gripping hand past this lets go (off the rim); past 90 degrees at speed the hand at the bottom rides on
// past 6 while the one at the top slides down its side (both hands were opposite each other at 90)
const HARD = { Left: [-10 * D, 250 * D], Right: [-250 * D, 10 * D] };
const OVER = 100 * D; // that top hand's slide target from 12
const SLIDE_MIN = 420 * D; // rad/s of a sliding hand along the rim (at least)
const EARLY = 25 * D; // low speed: the first slide starts once the wheel is this far from where both gripped

export class RimHands {
  constructor() {
    this.reset(0);
  }

  reset(theta = 0) {
    this.hands = {
      Left: { w: HOME.Left + theta, grip: true, to: null },
      Right: { w: HOME.Right + theta, grip: true, to: null },
    };
    this.theta = theta;
    this.rate = 0;
    this.dir = 0;
    this.both = theta; // wheel angle when both last gripped
    this.ride = true; // both at home and riding (at speed)
  }

  /** One step: the wheel's angle now, dt, the car's speed (m/s). Returns this.hands. */
  update(theta, dt, speed = 0) {
    if (Math.abs(theta - this.theta) > 0.4) this.reset(theta); // (a jump no hands make, 23 deg in a step: the car or a
    // scenario was reset; start over at 9 and 3)
    const d = theta - this.theta;
    this.theta = theta;
    if (dt > 0) this.rate += (d / dt - this.rate) * Math.min(1, dt * 25);
    const H = this.hands;
    if (Math.abs(this.rate) > 15 * D) {
      const r = Math.sign(this.rate);
      if (r !== this.dir && this.dir !== 0) {
        // the turn reversed: a sliding hand goes to its stroke's start for the new way instead
        for (const side of ['Left', 'Right']) if (!H[side].grip) H[side].to = r > 0 ? STROKE[side][0] : STROKE[side][1];
      }
      this.dir = r;
    }
    const fast = speed > 4;
    // gripping hands turn with the wheel
    for (const side of ['Left', 'Right']) if (H[side].grip) H[side].w += d;
    const atHome = (side) => Math.abs(H[side].w - (HOME[side] + theta)) < 2 * D;
    const both = H.Left.grip && H.Right.grip;
    const r = this.dir;
    if (both) {
      // riding at speed: hold at 9 and 3 until +-90 degrees of wheel
      const riding = fast && Math.abs(theta) < RIDE && atHome('Left') && atHome('Right');
      if (!riding && r !== 0) {
        // the hand nearer its stroke's end in the turning direction lets go (it would reach it first);
        // at low speed only once the wheel has turned EARLY from where both gripped
        const end = (side) => (r > 0 ? (side === 'Left' ? STROKE.Left[1] : STROKE.Right[1]) : side === 'Left' ? STROKE.Left[0] : STROKE.Right[0]);
        const left = (side) => (end(side) - H[side].w) * r; // travel left to the end
        const go = fast ? Math.abs(theta - this.both) >= RIDE || Math.min(left('Left'), left('Right')) < 0 : Math.abs(theta - this.both) >= EARLY || Math.min(left('Left'), left('Right')) < 10 * D;
        if (go && fast) {
          // at speed past 90: the hand nearer 12 slides down its own side; the other rides on past 6
          const side = Math.abs(H.Left.w) < Math.abs(H.Right.w) ? 'Left' : 'Right';
          this._release(side, r);
          H[side].to = side === 'Left' ? OVER : -OVER;
        } else if (go) {
          const side = left('Left') <= left('Right') ? 'Left' : 'Right';
          this._release(side, r);
        }
      }
    } else {
      for (const side of ['Left', 'Right']) {
        const h = H[side];
        const o = H[side === 'Left' ? 'Right' : 'Left'];
        if (h.grip) {
          // the gripping hand: at its stroke's end (or past) it hands over when the other is in place
          const [lo, hi] = STROKE[side];
          const past = r > 0 ? h.w >= hi : r < 0 ? h.w <= lo : false;
          if (past && !o.grip && o.arrived) {
            o.grip = true;
            o.to = null;
            this.both = theta;
            this._release(side, r);
          } else if (h.w < HARD[side][0] || h.w > HARD[side][1]) {
            // (cannot follow the wheel further: it lets go; counted as off the rim)
            h.off = true;
          }
        }
      }
    }
    // sliding hands go to their target along their half of the rim
    for (const side of ['Left', 'Right']) {
      const h = H[side];
      if (h.grip) {
        h.off = h.w < HARD[side][0] - 1e-6 || h.w > HARD[side][1] + 1e-6;
        continue;
      }
      h.off = false;
      const speed2 = Math.max(SLIDE_MIN, Math.abs(this.rate) * 3);
      const step = speed2 * dt;
      const dw = h.to - h.w;
      h.w += Math.abs(dw) <= step ? dw : Math.sign(dw) * step;
      h.arrived = Math.abs(h.to - h.w) < 1e-4;
      // a slid hand with the wheel still: grips where it is
      if (h.arrived && (this.dir === 0 || Math.abs(this.rate) < 15 * D)) {
        h.grip = true;
        h.to = null;
        this.both = theta;
      }
    }
    // home: wheel steady near the centre, a hand away from 9 / 3 slides back (one at a time)
    if (Math.abs(this.rate) < 20 * D && Math.abs(theta) < 12 * D && H.Left.grip && H.Right.grip) {
      for (const side of ['Left', 'Right']) {
        if (!atHome(side)) {
          H[side].grip = false;
          H[side].to = HOME[side] + theta;
          H[side].arrived = false;
          this.both = theta;
          break;
        }
      }
    } else if (Math.abs(this.rate) < 20 * D && H.Left.grip && H.Right.grip && !(fast && Math.abs(theta) < RIDE && atHome('Left') && atHome('Right'))) {
      // held steady in a corner: a hand left past its stroke (beyond reach, or past 6) slides back into it
      for (const side of ['Left', 'Right']) {
        const [lo, hi] = STROKE[side];
        const h = H[side];
        if (h.w < lo - 1e-3 || h.w > hi + 1e-3) {
          h.grip = false;
          h.to = Math.min(hi, Math.max(lo, h.w));
          h.arrived = false;
          break;
        }
      }
    }
    if (Math.abs(this.rate) < 15 * D) this.dir = 0;
    return H;
  }

  _release(side, r) {
    const h = this.hands[side];
    h.grip = false;
    h.arrived = false;
    // back to the start of its stroke for the turning direction
    h.to = r > 0 ? STROKE[side][0] : STROKE[side][1];
  }

  /** Smallest angle between the hands on the rim (rad). */
  gap() {
    const a = Math.abs(this.hands.Left.w - this.hands.Right.w) % (2 * Math.PI);
    return Math.min(a, 2 * Math.PI - a);
  }
}
