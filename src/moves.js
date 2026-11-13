// Locomotion transitions, played as root motion: turning on the spot, setting off, stopping and
// the running about-turn (clips authored in Blender, blender/rifle_motion/transitions.py; loaded
// by motion.js). While one plays it moves and turns the character, exactly as its root track says,
// so that the feet it puts down stay where they were put down; the character (character.js) blends
// its pose over the loops and holds its feet.
//
// A Move is one transition playing: one clip, or (turning on the spot) two clips of the same shape
// blended so that their turns add up to the angle wanted, both played over the same share of their
// lengths. `t` runs from `t0` (0, or part way in) to `duration`.
const _r = { x: 0, z: 0, yaw: 0 };
const ENTRY_EASE = 0.12; // s over which a mismatch of entry speed is taken up
const SHORT_TIME = 0.26; // s of the clip over which a short plant is made up (the about-turn's braking)

export class Move {
  /**
   * clips: [[clip, weight], ...]; at: where the root starts (world) and yaw its heading; turn:
   * how much of the clips' turn to make, and travel how much of their way over the ground; speed:
   * how fast the body was going along its heading as the clip began (see below); bend: a turn (rad) made on
   * top over the clip, eased in and out (setting off a little away from where the body faced);
   * start: s into the clip to begin at (a stop begun between two of its entries into the stride);
   * short: see below.
   */
  constructor(motion, kind, clips, at, yaw, { turn = 1, travel = 1, speed = null, bend = 0, start = 0, short = null } = {}) {
    this.motion = motion;
    this.kind = kind;
    this.clips = clips;
    this.duration = clips.reduce((sum, [clip, w]) => sum + clip.duration * w, 0);
    this.t = this.t0 = start;
    this.at = at.clone();
    this.yaw = yaw;
    this.turn = turn;
    this.travel = travel;
    this.bend = bend;
    const lead = clips[0][0];
    this.exit = lead.exit;
    // the clip's own head and chest look where it turns; the view's look is not added on top
    this.ownsLook = kind === 'pivot' || kind === 'runTurn';
    // (begun part way in, the clip is already braking: measured from its own root there)
    const authored = speed === null || !lead.entry ? null : start > 0 ? this._speedAt(lead, start) : lead.entry.speed;
    // A faster entry is taken up by playing the clip's first steps faster, easing back to its own
    // pace, rather than by adding travel: the clip covers the ground it was authored to (a stop
    // stops as short; the about-turn's outside foot is planted from the first frame, and travel
    // added to the root would carry the body, and the inside foot's swing that goes round with it,
    // further past that foot until the two feet met). A slower one carries its shortfall on along
    // the old heading and lets it die away.
    this.rate0 = authored ? Math.min(1.6, Math.max(1, speed / authored)) : 1;
    this.extra = authored ? speed - authored * this.rate0 : 0;
    this.real = 0; // s of real time since it began
    // short: { x, z } (m, the clip's frame) by which the foot it begins planted on is nearer than
    // the clip has it (the about-turn's outside foot, put down by the loop wherever the run had
    // it). The body is brought up that much short as it brakes, so it stops over that foot as
    // authored and the other foot comes round it by the clip's path.
    this.short = short;
    // the root track is relative to the clip's start: begun part way in, to where it is there
    motion.rootAt(lead, start, _r);
    this.from = { x: _r.x, z: _r.z, yaw: _r.yaw };
  }

  /** How fast a clip's root goes along its way at `t` s. */
  _speedAt(clip, t) {
    const dt = 1 / 120;
    this.motion.rootAt(clip, t + dt, _r);
    const z1 = _r.z;
    this.motion.rootAt(clip, t - dt, _r);
    return (z1 - _r.z) / (2 * dt);
  }

  /** Seconds of the clips played since this move began (it may have begun part way into them). */
  get age() {
    return this.t - this.t0;
  }

  /** Plays on by `dt` s of real time. */
  advance(dt) {
    this.t = Math.min(this.duration, this.t + dt * (1 + (this.rate0 - 1) * Math.exp(-this.real / ENTRY_EASE)));
    this.real += dt;
  }

  /** The share of each clip's length played. */
  get u() {
    return Math.min(1, this.t / this.duration);
  }

  get done() {
    return this.t >= this.duration;
  }

  /** Where the root is at this moment: world position into `pos`, returns the heading. */
  root(pos) {
    let x = 0;
    let z = 0;
    let yaw = 0;
    for (const [clip, w] of this.clips) {
      this.motion.rootAt(clip, this.u * clip.duration, _r);
      x += _r.x * w;
      z += _r.z * w;
      yaw += _r.yaw * w;
    }
    x = (x - this.from.x) * this.travel;
    z = (z - this.from.z) * this.travel;
    yaw -= this.from.yaw;
    if (this.short) {
      const k = Math.min(1, this.age / SHORT_TIME);
      const m = k * k * k * (10 - 15 * k + 6 * k * k);
      x -= this.short.x * m;
      z -= this.short.z * m;
    }
    // (a faster entry carries on along the old heading and dies away)
    z += this.extra * ENTRY_EASE * (1 - Math.exp(-this.real / ENTRY_EASE));
    // the clip's frame (+x left, +z forward) at the starting heading, into the world (heading 0
    // looks down -Z, its left is -X)
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    pos.set(this.at.x - x * c - z * s, this.at.y, this.at.z + x * s - z * c);
    const u = this.u;
    return this.yaw + yaw * this.turn + this.bend * u * u * (3 - 2 * u);
  }
}

/**
 * The turn on the spot for `angle` (rad, + = left): the two clips either side of it when they
 * have the same shape of steps (45 and 90, 135 and 180), weighted so that their turns add up to
 * it; otherwise the nearer one, its turn stretched or shrunk to fit. Returns [clips, scale].
 */
export function pivotFor(pivots, angle) {
  const side = pivots.filter((clip) => Math.sign(clip.angle) === Math.sign(angle));
  const a = Math.abs(angle);
  const steps = (clip) => (Math.abs(clip.angle) > 1.75 ? 3 : 2);
  let below = null;
  let above = null;
  for (const clip of side) {
    if (Math.abs(clip.angle) <= a && (!below || Math.abs(clip.angle) > Math.abs(below.angle))) below = clip;
    if (Math.abs(clip.angle) >= a && (!above || Math.abs(clip.angle) < Math.abs(above.angle))) above = clip;
  }
  if (!below) return [[[above, 1]], a / Math.abs(above.angle)];
  if (!above) return [[[below, 1]], a / Math.abs(below.angle)];
  if (below === above) return [[[below, 1]], 1];
  const lo = Math.abs(below.angle);
  const hi = Math.abs(above.angle);
  if (steps(below) === steps(above)) {
    const w = (a - lo) / (hi - lo);
    return [[[below, 1 - w], [above, w]], 1];
  }
  const near = a - lo < hi - a ? below : above;
  return [[[near, 1]], a / Math.abs(near.angle)];
}
