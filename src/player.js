// Third-person shooter controls: where the character goes, which way it faces, how the rifle
// is held, and where the camera sits.
//
//   walk, jog    the character faces where the camera looks and moves in eight directions
//                relative to that: forward, back, sideways and the diagonals, aimed or not
//   run, sprint  (Shift) it turns to face the way it is going
import * as THREE from 'three/webgpu';
import { SPEED, Smooth, damp, wrapAngle } from './character.js';
import { Move, pivotFor } from './moves.js';
import { onStairs } from './ground.js';

const ACCELERATION = 10; // m/s^2
const BRAKING = 13;
const RADIUS = 0.34; // the character's footprint
const LOOK = 0.0023; // rad per pixel of mouse travel
const PITCH_MIN = -1.2;
const PITCH_MAX = 1.1;
const SHOULDER_HOLD = 0.5; // s the rifle stays up after the trigger is let go
const READY_HOLD = 2.4; // s it then stays at the ready before going back down
const SIGHTED_SPEED = 1.15; // m/s while looking down the sights
const SPRINT_AFTER = 0.9; // s of running before it becomes a sprint
// Share of the forward pace kept stepping sideways and backing up. Side steps cannot be long
// (the trailing foot only closes up to the leading one, it never crosses it, so each cycle
// the feet open as wide as the ground covered), so they come quicker and cover less ground.
const SIDE_PACE = 0.6;
const BACK_PACE = 0.75;
const LOOK_FREE = 0.9; // rad the view can leave a standing, carried body before it turns after it
// Turning on the spot: shouldered, the trunk and head take the view this far round (rad) before the
// legs turn; a turn is not begun for less than PIVOT_LEAST.
const PIVOT_AIMED = 0.4;
const PIVOT_LEAST = 0.3;
const PIVOT_LEAD = 0.15; // s of the view's turning a turn on the spot is sized ahead by
const PIVOT_LEAD_MAX = 0.8; // rad, at most
const PIVOT_SETTLED = 1.0; // rad/s: the view has as good as stopped
const PIVOT_FAR = 2.4; // rad the view may be from a carried body before it turns while the view still swings
const START_BEND = 0.95; // rad setting off may turn the body towards the view on top of the clip
// The running about-turn: begun when asked to go this far round (rad) from at least this speed (m/s).
const RUN_TURN_LEAST = 2.3;
const RUN_TURN_SPEED = 2.6;
// The crouch: C toggles it; Shift (a run) or the jog stands the body up. Crouched it walks at
// CROUCH_SPEED forward (the same pace ellipse sideways and back). Going down or coming up standing
// plays the authored clip (rifle-crouch-down / -up); moving, the crouch blends in over CROUCH_TIME.
export const CROUCH_SPEED = 1.0;
const CROUCH_TIME = 0.35;
const STAIRS_WALK = 0.85; // m/s on stairs: a tread a step at the walk's cadence
const STAIRS_RUN = 1.9;
const CROUCH_DROP = 0.37; // m the head comes down crouched (the clips' 37 cm): the camera follows

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;

class Spring {
  constructor(stiffness, damping) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  step(dt) {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
}

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; // facing: 0 looks down -Z, + turns left
    this.camYaw = 0;
    this.camPitch = -0.1;
    this.firstPerson = false;
    this.obstacles = []; // { minX, maxX, minZ, maxZ }
    this.bounds = { minX: -48, maxX: 48, minZ: -23, maxZ: 48 };

    // what the character is doing, as smoothed 0..1 weights
    this.aim = 0; // rifle shouldered
    this.sights = 0; // looking down the sights (camera pulled in)
    this.ready = 0; // carried high rather than low
    this.sprint = 0;
    this.shouldered = false;
    this.sprinting = false;

    // read by the character
    this.speed = 0;
    this.pace = 1; // share of the forward pace this direction of travel keeps (side steps are slower)
    this._pace = new Smooth(1);
    this.heading = 0; // direction of travel relative to the facing direction (+ = left)
    this.moving = false;
    this.strafe = false;
    this.yawRate = 0;
    this.leanPitch = 0;
    this.leanRoll = 0;
    this.pitch = 0; // where the rifle has to point, relative to level
    this.twist = 0; // and relative to the facing direction
    this.aimQuat = new THREE.Quaternion();
    this.aimPoint = new THREE.Vector3(0, 1.4, -50);

    this.kickPitch = new Spring(260, 26);
    this.kickYaw = new Spring(260, 26);
    this.punch = new Spring(320, 24); // a shot narrows the view for an instant (degrees)
    this.shakeX = new Spring(420, 22); // and jolts the camera (m)
    this.shakeY = new Spring(420, 22);
    this._t = 0;
    this.bloom = 0; // extra spread from firing, rad
    this._shoulderT = 0;
    this._readyT = 0;
    this._runT = 0;
    this._following = true; // the body is turning after the view
    // transitions (moves.js): set by main, the clips and the character's legs (which say when a
    // foot lands and which loop they are in)
    this.motion = null;
    this.legs = null;
    this.move = null; // the transition playing
    this._pending = null; // an about-turn waiting for its footfall
    this._wasMoving = false;
    this._camBefore = 0;
    this._lookYaw = new Smooth();
    this._lookPitch = new Smooth();
    this.lookYaw = 0; // where the head turns while the rifle is carried
    this.lookPitch = 0;
    this._yaw = new Smooth();
    this._vx = new Smooth();
    this._vz = new Smooth();
    this._aim = new Smooth();
    this._sights = new Smooth();
    this._ready = new Smooth();
    this._sprint = new Smooth();
    this._leanPitch = new Smooth();
    this._leanRoll = new Smooth();
    this._pivot = new THREE.Vector3(0, 1.5, 0);
    this._camQuat = new THREE.Quaternion();
    this._fov = 50;
    this.crouched = false; // asked to crouch (C)
    this.crouch = 0; // how far crouched, 0..1
    this.crouchMove = null; // { clip, t, w }: going down or coming up standing
    this.crouchChanging = false;
    this._crouchU = 0; // progress towards crouched, 0..1, before easing
    this._stairs = new Smooth(); // how far onto a flight of stairs (ground.js), for the pace
  }

  /** C: crouch, or stand up. */
  toggleCrouch() {
    this.crouched = !this.crouched;
  }

  /**
   * input: { forward, back, left, right, sprint, jog, aim, fire, lookX, lookY }
   * lookX and lookY are pixels of mouse travel since the last call and are cleared here.
   * `reloading` and `swapping` say what the hands are busy with.
   */
  update(dt, input, reloading, swapping = false) {
    // ---- look ----
    const sensitivity = LOOK * mix(1, 0.6, this.sights);
    this.camYaw = wrapAngle(this.camYaw - input.lookX * sensitivity);
    this.camPitch = clamp(this.camPitch - input.lookY * sensitivity, PITCH_MIN, PITCH_MAX);
    input.lookX = 0;
    input.lookY = 0;

    // ---- what the rifle is doing ----
    if (input.fire && !reloading) this._shoulderT = SHOULDER_HOLD;
    else this._shoulderT -= dt;
    const shouldered = !swapping && (input.aim || this._shoulderT > 0); // no aiming with the gun half way to the back
    if (shouldered || reloading) this._readyT = READY_HOLD;
    else this._readyT -= dt;

    // ---- which way, how fast ----
    const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const mz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const moving = mx !== 0 || mz !== 0;
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    _dir.set(-sin * mz + cos * mx, 0, -cos * mz - sin * mx);
    if (moving) _dir.normalize();

    // Pace: a tactical walk unless told otherwise; Shift runs and, held, builds into a sprint.
    const straight = !this.firstPerson || (mz > 0 && mx === 0);
    const running = input.sprint && moving && !shouldered && !reloading && straight;
    // (running stands the body up; crouching drops the jog)
    if (running && this.crouched) this.crouched = false;
    if (this.crouched) input.jog = false;
    this._updateCrouch(dt);
    this._runT = running ? this._runT + dt : 0;
    const sprinting = running && this._runT > SPRINT_AFTER;
    let top = input.jog ? SPEED.run : mix(SPEED.walk, CROUCH_SPEED, this.crouch);
    if (running) top = sprinting ? SPEED.sprint : SPEED.run;
    if (shouldered) top = input.aim ? mix(SIGHTED_SPEED, 0.85, this.crouch) : mix(SPEED.walk, CROUCH_SPEED, this.crouch);
    // On stairs (and over the last metre before them) the pace drops so that each step is one tread:
    // the walk blended down to 0.85 m/s keeps its cadence and takes 0.29 m steps (the treads are 0.30)
    const stairs = this._stairs.to(onStairs(this.pos.x, this.pos.z, 1.0) ? 1 : 0, 0.3, dt);
    top = mix(top, Math.min(top, running ? STAIRS_RUN : STAIRS_WALK), stairs);
    // Only a run turns the body to the way it is going; otherwise it keeps facing the view.
    const strafe = !running;
    let pace = 1;
    if (strafe && moving) {
      // the pace falls off on an ellipse from forward to sideways to backwards
      const n = Math.hypot(mx, mz);
      pace = 1 / Math.hypot(mx / n / SIDE_PACE, mz / n / (mz < 0 ? BACK_PACE : 1));
      top *= pace;
    }
    // (eased, as the speed is: the legs pick their gait from speed and pace together)
    this.pace = this._pace.to(pace, 0.17, dt);

    // ---- transitions: turning on the spot, setting off, stopping, the running about-turn ----
    const yawBefore = this.yaw;
    const velBefore = _v.copy(this.vel);
    if (this.motion) this._transitions(dt, { mx, mz, moving, running, shouldered, strafe, jog: input.jog });
    const move = this.move;
    if (move) {
      // the clip moves and turns the body (root motion, moves.js)
      move.advance(dt);
      _p.copy(this.pos);
      this.yaw = wrapAngle(move.root(this.pos));
      if (dt > 0) this.vel.subVectors(this.pos, _p).divideScalar(dt).setY(0);
      this._collide();
    } else {
      // Turning eases in and out and has a top speed, so a reversal is a quick pivot, not a snap.
      // Standing with the gun carried, the head looks about on its own and the body only turns
      // after the view once it has gone too far round, then all the way (standing, by turns on the
      // spot: see _transitions).
      let targetYaw = this.yaw;
      if (strafe) {
        const away = Math.abs(wrapAngle(this.camYaw - this.yaw));
        const free = !moving && !shouldered && !this.firstPerson && this.speed < 0.2;
        if (!free || away > LOOK_FREE) this._following = true;
        else if (away < 0.05) this._following = false;
        if (this._following && !this._onSpot(moving)) targetYaw = this.camYaw;
      } else if (moving && !this._pending) targetYaw = Math.atan2(-_dir.x, -_dir.z);
      const off = wrapAngle(targetYaw - this.yaw);
      this._yaw.x = this.yaw;
      this.yaw = wrapAngle(this._yaw.to(this.yaw + off, strafe ? 0.12 : sprinting ? 0.16 : 0.11, dt, strafe ? 10 : 11));

      if (moving && !strafe) {
        // Run where the body faces, and ease off through a sharp turn so the legs can follow it.
        const along = top * clamp(1.25 - Math.abs(off) / 1.6, 0.2, 1);
        _dir.set(-Math.sin(this.yaw) * along, 0, -Math.cos(this.yaw) * along);
      } else {
        _dir.multiplyScalar(moving ? top : 0);
      }
      // Ease into and out of a pace: speed builds and dies away on a curve, never a straight ramp.
      // (Waiting for the footfall that an about-turn begins on, the body keeps its pace.)
      if (!this._pending) {
        const time = moving ? 0.17 : 0.2;
        this._vx.x = this.vel.x;
        this._vz.x = this.vel.z;
        this.vel.x = this._vx.to(_dir.x, time, dt, moving ? ACCELERATION * 1.6 : BRAKING * 1.6);
        this.vel.z = this._vz.to(_dir.z, time, dt, moving ? ACCELERATION * 1.6 : BRAKING * 1.6);
      }
      this.pos.addScaledVector(this.vel, dt);
      this._collide();
    }

    // ---- what the legs need to know ----
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const forward = this.vel.x * fx + this.vel.z * fz;
    const right = this.vel.x * -fz + this.vel.z * fx;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.2) this.heading = Math.atan2(-right, forward);
    this.moving = moving;
    this.strafe = strafe;
    this.yawRate = move ? wrapAngle(this.yaw - yawBefore) / Math.max(dt, 1e-6) : this._yaw.v;

    // lean into acceleration: forwards when setting off, back when stopping, into a turn (a
    // transition leans the body as it was authored to)
    if (dt > 0) {
      velBefore.sub(this.vel).multiplyScalar(-1 / dt);
      const ax = move ? 0 : velBefore.x * -fz + velBefore.z * fx; // to the character's right
      const az = move ? 0 : velBefore.x * fx + velBefore.z * fz; // forwards
      this.leanPitch = this._leanPitch.to(clamp(az * 0.012, -0.1, 0.13), 0.22, dt);
      this.leanRoll = this._leanRoll.to(clamp(ax * 0.012, -0.11, 0.11), 0.22, dt);
    }
    if (move && move.done) this._endMove();

    // ---- weights ----
    this.shouldered = shouldered;
    this.sprinting = sprinting;
    this.aim = this._aim.to(shouldered ? 1 : 0, shouldered ? 0.13 : 0.22, dt);
    this.sights = this._sights.to(input.aim ? 1 : 0, 0.13, dt);
    this.ready = this._ready.to(this._readyT > 0 || this.firstPerson ? 1 : 0, 0.24, dt);
    this.sprint = this._sprint.to(sprinting && this.speed > SPEED.run * 0.85 ? 1 : 0, 0.22, dt);

    this.lookYaw = this._lookYaw.to(this._lookTarget || 0, 0.14, dt);
    this.lookPitch = this._lookPitch.to(this._lookTargetPitch || 0, 0.14, dt);

    this.kickPitch.step(dt);
    this.kickYaw.step(dt);
    this.punch.step(dt);
    this.shakeX.step(dt);
    this.shakeY.step(dt);
    this._t += dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.035);
  }

  /**
   * How far crouched. Standing still, going down or coming up plays the authored clip: its share
   * comes in over its first 0.06 s and goes out over its last 0.1 s, and the crouch weight follows
   * its hips (eased over the clip). Moving, or turned round part way, the crouch eases in or out.
   */
  _updateCrouch(dt) {
    const want = this.crouched ? 1 : 0;
    const motion = this.motion;
    const still = this.speed < 0.2 && !this.move;
    let cm = this.crouchMove;
    if (!cm && still && motion && motion.crouch && Math.abs(want - this.crouch) > 0.5) {
      cm = this.crouchMove = { clip: motion.crouch[want ? 'down' : 'up'], t: 0, w: 0, from: this.crouch, to: want };
    }
    if (cm && (cm.to !== want || !still)) {
      // let go of part way (asked back, or set off): the crouch eases on from where it is
      this.crouchMove = cm = null;
    }
    if (cm) {
      cm.t = Math.min(cm.clip.duration, cm.t + dt);
      const u = cm.t / cm.clip.duration;
      const ease = (x) => THREE.MathUtils.smoothstep(x, 0, 1);
      cm.w = Math.min(ease(cm.t / 0.06), ease((cm.clip.duration - cm.t) / 0.1));
      this.crouch = mix(cm.from, cm.to, ease(Math.min(1, u * 1.15)));
      // (the eased curve's progress at this crouch, should the clip be let go of part way)
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (THREE.MathUtils.smootherstep(mid, 0, 1) < this.crouch) lo = mid;
        else hi = mid;
      }
      this._crouchU = (lo + hi) / 2;
      if (cm.t >= cm.clip.duration) this.crouchMove = null;
    } else {
      // (along an eased curve: the hips start and stop going down without a jolt; turned back part
      // way, it carries on from where it is along the same curve)
      const before = this._crouchU;
      const step = dt / CROUCH_TIME;
      this._crouchU = want > before ? Math.min(want, before + step) : Math.max(want, before - step);
      this.crouch = THREE.MathUtils.smootherstep(this._crouchU, 0, 1);
    }
    this.crouchChanging = Math.abs(want - this.crouch) > 0.01 || !!this.crouchMove;
  }

  /** Stay out of the furniture and inside the yard. */
  _collide() {
    for (const box of this.obstacles) {
      const cx = clamp(this.pos.x, box.minX, box.maxX);
      const cz = clamp(this.pos.z, box.minZ, box.maxZ);
      let dx = this.pos.x - cx;
      let dz = this.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d < 1e-6) {
        // inside the box: leave through the nearest face
        const left = this.pos.x - box.minX;
        const right = box.maxX - this.pos.x;
        const near = this.pos.z - box.minZ;
        const far = box.maxZ - this.pos.z;
        const least = Math.min(left, right, near, far);
        if (least === left) this.pos.x = box.minX - RADIUS;
        else if (least === right) this.pos.x = box.maxX + RADIUS;
        else if (least === near) this.pos.z = box.minZ - RADIUS;
        else this.pos.z = box.maxZ + RADIUS;
        continue;
      }
      dx /= d;
      dz /= d;
      this.pos.x = cx + dx * RADIUS;
      this.pos.z = cz + dz * RADIUS;
      const into = this.vel.x * dx + this.vel.z * dz;
      if (into < 0) {
        this.vel.x -= dx * into;
        this.vel.z -= dz * into;
      }
    }
    const bounds = this.bounds;
    this.pos.x = clamp(this.pos.x, bounds.minX, bounds.maxX);
    this.pos.z = clamp(this.pos.z, bounds.minZ, bounds.maxZ);
  }

  /**
   * Standing, the body turns after the view by turns on the spot (authored clips) rather than by
   * swivelling: true while it does (`moving` stops them).
   */
  _onSpot(moving) {
    return !!this.motion && !moving && this.speed < 0.2 && !this.firstPerson && this.crouch < 0.01 && !this.crouched;
  }

  /**
   * Starts and ends the transitions (moves.js). Standing: a turn on the spot when the view has
   * gone far enough round (shouldered, past PIVOT_AIMED: the trunk and head take less than that;
   * carried, once the body follows the view at all), sized to where the view is going, and
   * chained while it keeps going; and setting off forward. Moving forward at the walk or the jog
   * and letting go: a stop, begun at once. Running and asked to go back the other
   * way: the about-turn, begun as the outside foot lands.
   */
  _transitions(dt, { mx, mz, moving, running, shouldered, strafe, jog }) {
    const motion = this.motion;
    const legs = this.legs;
    const camRate = dt > 0 ? wrapAngle(this.camYaw - this._camBefore) / dt : 0;
    this._camBefore = this.camYaw;
    const move = this.move;
    if (move) {
      // let go of a transition the player no longer wants: its velocity carries on from here
      const quit = move.kind === 'start' ? mz <= 0 || mx !== 0 || shouldered || (strafe && running) : move.kind === 'runTurn' ? !moving : moving;
      if (quit) this._endMove();
      return;
    }
    const pending = this._pending;
    if (pending) {
      pending.wait += dt;
      if (!pending.still(moving) || pending.wait > 0.45) this._pending = null;
      else if (legs.landed) {
        const begun = pending.begin(legs.landed);
        if (begun) this._pending = null;
      }
      return;
    }
    // (the turns, starts and stops are standing clips: crouched, the body turns and the feet step
    // round by the run-time stepper, and the walk starts and stops by blending)
    if (this.crouch > 0.01 || this.crouched) {
      this._wasMoving = moving;
      return;
    }
    const standing = !moving && this.speed < 0.2 && !this.firstPerson;
    const fwd = -Math.sin(this.yaw) * this.vel.x - Math.cos(this.yaw) * this.vel.z;
    if (standing && strafe) {
      // turning on the spot
      const away = wrapAngle(this.camYaw - this.yaw);
      // (carried, while the view is still swinging round, wait for it to slow before sizing the
      // turn, unless it has gone so far that the head cannot follow it; shouldered, the aim's
      // twist has less room, so the legs set off at once)
      const settled = shouldered || Math.abs(camRate) < PIVOT_SETTLED || Math.abs(away) > PIVOT_FAR;
      const want = settled && (shouldered ? Math.abs(away) > PIVOT_AIMED : this._following && Math.abs(away) > PIVOT_LEAST);
      if (want) {
        // (sized a little past where the view is when it is still going, but not much: a hand on
        // the mouse slows down to stop)
        const angle = clamp(away + clamp(camRate * PIVOT_LEAD, -PIVOT_LEAD_MAX, PIVOT_LEAD_MAX), -Math.PI, Math.PI);
        if (Math.abs(angle) > PIVOT_LEAST) {
          const [clips, scale] = pivotFor(motion.pivots, angle);
          this.move = new Move(motion, 'pivot', clips, this.pos, this.yaw, { turn: scale, travel: Math.min(1, scale) });
        }
      } else if (!shouldered && Math.abs(away) < PIVOT_LEAST) this._following = false;
    } else if (this.speed < 0.2 && moving && !this._wasMoving && mz > 0 && mx === 0 && !shouldered && !this.firstPerson) {
      // setting off forward (from standing, not passing through a standstill in a reversal), from
      // where the body faces to where the view does
      const bend = wrapAngle(this.camYaw - this.yaw);
      if (Math.abs(bend) < START_BEND) {
        const clip = motion.starts[jog || running ? 'jog' : 'walk'];
        this.move = new Move(motion, 'start', [[clip, 1]], this.pos, this.yaw, { bend });
        this._following = true;
      }
    } else if (!moving && this._wasMoving && !shouldered && Math.abs(this.heading) < 0.3) {
      // stopping from the forward walk or jog: at once, wherever the stride is. The stops begin
      // at each eighth of the loop's cycle; the one just behind the legs' phase is begun the rest
      // of the way in, so its feet are where the loop has them now.
      const gait = legs.forwardGait();
      if (gait) {
        const stops = motion.stops[gait];
        const at = (((legs.phase % 1) + 1) % 1) * stops.length;
        const clip = stops[Math.floor(at) % stops.length];
        const start = (at - Math.floor(at)) * (clip.entry.cycle / stops.length);
        this.move = new Move(motion, 'stop', [[clip, 1]], this.pos, this.yaw, { speed: fwd, start });
      }
    } else if (running && moving && this.speed > RUN_TURN_SPEED) {
      // the running about-turn: on the outside foot's footfall (whichever lands first, for a
      // straight reversal)
      const travel = Math.atan2(-_dir.x, -_dir.z);
      const off = wrapAngle(travel - this.yaw);
      if (Math.abs(off) > RUN_TURN_LEAST) {
        this._pending = {
          wait: 0,
          still: (going) => going,
          begin: (side) => {
            const sense = side === 'Right' ? 1 : -1; // the outside foot plants: right to turn left
            if (Math.abs(off) < Math.PI - 0.35 && Math.sign(off) !== sense) return false;
            const angle = Math.sign(off) === sense ? off : off + sense * Math.PI * 2;
            const speed = -Math.sin(this.yaw) * this.vel.x - Math.cos(this.yaw) * this.vel.z;
            // where the run has put the outside foot (its ankle, in the clip's frame: +x left, +z
            // forward) against where the clip plants it
            const clip = motion.runTurns[sense];
            const ankle = legs.feet[side === 'Left' ? 0 : 1].ankle;
            const dx = ankle.x - this.pos.x;
            const dz = ankle.z - this.pos.z;
            const c = Math.cos(this.yaw);
            const s = Math.sin(this.yaw);
            const short = { x: clip.plant[0] - (-dx * c + dz * s), z: clamp(clip.plant[1] - (-dx * s - dz * c), 0, 0.25) };
            this.move = new Move(motion, 'runTurn', [[clip, 1]], this.pos, this.yaw, { turn: Math.abs(angle) / Math.PI, speed, short });
            return true;
          },
        };
      }
    }
    this._wasMoving = moving;
  }

  /** A transition has finished, or been let go of: the controls take over from where it left the body. */
  _endMove() {
    const move = this.move;
    this.move = null;
    this._yaw.x = this.yaw;
    this._yaw.v = 0;
    this._vx.x = this.vel.x;
    this._vz.x = this.vel.z;
    this._vx.v = this._vz.v = 0;
    if (move.kind === 'runTurn') this._runT = 0; // a sprint builds up again from the turn
    this._wasMoving = move.kind !== 'stop';
  }

  /** Half angle of the cone of fire (rad): tighter down the sights, wider on the move. */
  get spread() {
    return mix(0.011, 0.0025, this.sights) + this.speed * 0.0016 + this.bloom;
  }

  /** A shot was fired: the view jumps and the cone of fire opens. */
  recoil(scale = 1) {
    this.kickPitch.v += mix(1.1, 0.7, this.sights) * scale;
    this.kickYaw.v += (Math.random() - 0.5) * 0.9 * scale;
    this.punch.v -= 13 * scale;
    this.shakeX.v += (Math.random() - 0.5) * 0.22 * scale;
    this.shakeY.v += (0.04 + Math.random() * 0.1) * scale;
    this.bloom = Math.min(0.02, this.bloom + 0.0028);
  }

  /**
   * Struck by something: `way` is where it came from relative to the body ('f', 'b', 'l', 'r'),
   * `strength` 0..1 (from 0.6 a stagger). A heavy blow shoves the body away from it, so the feet
   * step after it (the stagger's step); every blow jolts the view a little the way the body goes,
   * and with it the shouldered gun, which then comes back on line as the view settles. Returns the
   * reaction for the game to play (main.js).
   */
  hit(way, strength = 0.5) {
    const heavy = strength >= 0.6;
    // the push, in the body's frame (+x right, -z forward), away from the blow
    const push = { f: [0, 1], b: [0, -1], l: [1, 0], r: [-1, 0] }[way];
    if (heavy && !this.move) {
      _v.set(push[0], 0, push[1]).applyAxisAngle(_up, this.yaw).multiplyScalar(1.4 * strength);
      this.vel.add(_v);
    }
    const k = 0.4 + 0.6 * strength;
    this.kickPitch.v += (way === 'f' ? 0.5 : way === 'b' ? -0.6 : 0.15) * k;
    this.kickYaw.v += (way === 'l' ? -0.7 : way === 'r' ? 0.7 : (Math.random() - 0.5) * 0.3) * k;
    this.shakeX.v += push[0] * 0.25 * k;
    this.shakeY.v += 0.12 * k;
    return { way, heavy: heavy && (way === 'f' || way === 'b'), strength };
  }

  /** Camera rotation, including the recoil jump. */
  viewQuat(target) {
    // a hand-held drift keeps the view from ever being dead still
    const t = this._t;
    const driftPitch = Math.sin(t * 0.9) * 0.0018 + Math.sin(t * 2.3 + 1) * 0.0008;
    const driftYaw = Math.sin(t * 0.7 + 2) * 0.002 + Math.sin(t * 1.9) * 0.0008;
    _e.set(this.camPitch + this.kickPitch.x + driftPitch, this.camYaw + this.kickYaw.x + driftYaw, 0, 'YXZ');
    return target.setFromEuler(_e);
  }

  /**
   * Works out where the shouldered rifle has to point so that it bears on `point`, the thing
   * in the middle of the view. `eye` is the character's aiming eye.
   */
  aimAt(point, eye) {
    this.aimPoint.copy(point);
    _v.subVectors(point, eye);
    const flat = Math.hypot(_v.x, _v.z);
    const yaw = Math.atan2(-_v.x, -_v.z);
    this.pitch = clamp(Math.atan2(_v.y, flat), -1.15, 1.15);
    this.twist = clamp(wrapAngle(yaw - this.yaw), -1.3, 1.3);
    _e.set(this.pitch, this.yaw + this.twist, 0, 'YXZ');
    this.aimQuat.setFromEuler(_e);
    // The head follows the view as far as a neck turns, and lets go of what is behind.
    const side = wrapAngle(yaw - this.yaw);
    const fade = 1 - THREE.MathUtils.smoothstep(Math.abs(side), 1.5, 2.3);
    this._lookTarget = clamp(side, -1.1, 1.1) * fade * 0.85;
    this._lookTargetPitch = clamp(this.pitch, -0.5, 0.5) * fade * 0.6;
  }

  /**
   * Places the camera. Third person: over the right shoulder, closer when aiming. First
   * person: at the eye, and behind the rear sight when the rifle is up. `sight` is that
   * point behind the rear sight, in world space. `life` is the character's footfall motion,
   * which the third-person camera shares a little of.
   */
  placeCamera(dt, camera, eye, sight, life) {
    const q = this.viewQuat(this._camQuat);
    let fov;
    if (this.firstPerson) {
      _v.set(0.01, 0.02, -0.06).applyQuaternion(q).add(eye);
      camera.position.lerpVectors(_v, sight, this.aim);
      fov = mix(64, 50, this.sights);
    } else {
      _v.set(this.pos.x, this.pos.y + 1.5 - CROUCH_DROP * this.crouch, this.pos.z);
      this._pivot.lerp(_v, 1 - Math.exp(-22 * dt));
      const back = mix(mix(mix(3.3, 2.8, this.aim), 3.7, this.sprint), 1.35, this.sights);
      _v.set(mix(0.6, 0.5, this.sights), mix(0.05, 0.24, this.sights), back).applyQuaternion(q).add(this._pivot);
      _v.y = Math.max(_v.y, this.pos.y + 0.25);
      camera.position.copy(_v);
      fov = mix(mix(50, 56, this.sprint), 32, this.sights);
      if (life) {
        // the view rides the footfalls: a bob and a slight roll, stronger at a run
        camera.position.y += life.nod * 0.55;
        q.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), life.roll * 0.3));
      }
    }
    camera.position.add(_v.set(this.shakeX.x, this.shakeY.x, 0).applyQuaternion(q));
    camera.quaternion.copy(q);
    this._fov = damp(this._fov, fov, 14, dt);
    const shown = this._fov + this.punch.x;
    if (Math.abs(camera.fov - shown) > 0.01) {
      camera.fov = shown;
      camera.updateProjectionMatrix();
    }
  }
}
