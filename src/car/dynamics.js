// Supercar dynamics (pass V1): a pure module, no Three.js, so it runs in Node (`node --test test/`).
//
// A rigid body in six degrees of freedom on four suspended wheels, stepped at a fixed 1200 Hz:
//
//   body         mass and inertia tensor about the centre of mass, forces and torques in the world,
//                semi-implicit Euler, quaternion orientation (gyroscopic term included)
//   suspension   per corner an unsprung wheel mass travelling along the body's down axis: coil spring
//                with a free length chosen so the car sits at the model's ride height, bump / rebound
//                dampers, progressive bump stop, rebound stop, anti-roll bar per axle. The body gets the
//                spring and bar force at the mount; the tyre's vertical force acts on the wheel only
//   tyre         vertical spring and damper against the ground (enveloped over the contact length, so
//                a kerb is a ramp, not a step); slip from a transient (relaxation-length) brush model:
//                deflection states that settle to the slip ratio and slip angle, so it is stable at any
//                speed and holds the car still like a real tyre; Magic-Formula shape on the normalised
//                combined slip vector (friction ellipse), load-sensitive friction, surface grip
//   drivetrain   NA V12 torque curve, rev limiter, idle governor, engine braking; launch-controlled
//                clutch (slips to hold the launch revs, locks when the speeds meet: Coulomb clutch with a
//                lock state, exact engine-inertia coupling in lock); 7-speed dual clutch with torque fill
//                and shift time, auto or manual; 30 / 70 torque-split centre with a viscous coupling,
//                clutch LSD at the rear; traction control on the driven wheels' slip
//   brakes       per-corner torque, front bias, ABS on each wheel's slip ratio; static friction (a
//                braked wheel stops exactly, no chatter), handbrake on the rear, auto-hold at rest
//   aero         drag and downforce (40 / 60 at the axles), rolling resistance
//   steering     rack ratio 15:1 (the asset's +-420 degrees at the wheel for +-28 at the road),
//                Ackermann (60 %), rate-limited, a speed-sensitive limit for keyboard input
//   collision    the car's footprint against oriented boxes (barriers, buildings): push out and an
//                impulse with friction at the contact corner
//
// Frames: the body frame is the glTF vehicle_root's: +X right, +Y up, -Z forward, origin on the ground
// midway between the axles. World: Three.js's (Y up).

const G = 9.81;
const RHO = 1.225;
export const STEP = 1 / 1200;
const DEG = Math.PI / 180;
const RPM = 30 / Math.PI; // rad/s -> rpm

/** The car as the notes decide it (VEHICLE_NOTES.md, "How to judge"). */
export const SPEC = {
  mass: 1700, // kg: 1650 kerb + driver
  com: [0, 0.45, 0.216], // body frame: 42 / 58 front / rear
  inertia: [2400, 2700, 560], // kg m^2 about body X (pitch), Y (yaw), Z (roll)
  wheelbase: 2.7,
  wheels: [
    // name, x, z, radius, front, unsprung mass, wheel + brake inertia
    { name: 'FL', x: -0.86, z: -1.35, r: 0.345, front: true, mu: 45, I: 1.0, grip: 0.97 },
    { name: 'FR', x: 0.86, z: -1.35, r: 0.345, front: true, mu: 45, I: 1.0, grip: 0.97 },
    { name: 'RL', x: -0.85, z: 1.35, r: 0.36, front: false, mu: 50, I: 1.2, grip: 1.04 },
    { name: 'RR', x: 0.85, z: 1.35, r: 0.36, front: false, mu: 50, I: 1.2, grip: 1.04 },
  ],
  mount: 0.12, // m from the static wheel centre up to the spring's top mount (static spring length)
  bump: 0.075, // m of bump travel from static to the bump stop's full compression
  droop: 0.085, // m of droop from static to the rebound stop
  springF: 44000, // N/m wheel rate (1.8 Hz front)
  springR: 76000, // (2.0 Hz rear)
  damp: { F: [2600, 4400], R: [3800, 6200] }, // N s/m bump, rebound
  antiDive: 0.14, antiSquat: 0.16,
  arbF: 10000, // N/m of left-right compression difference (roll stiffness k * track^2)
  arbR: 4500,
  tyreK: 280000, // N/m vertical
  tyreC: 350,
  tyre: {
    muX: 1.36, muY: 1.36, // peak friction at the nominal load
    load0: 4000, loadSens: 0.14, // the peak falls by this share per nominal load more
    kappaPeak: 0.1, alphaPeak: 7.5 * DEG,
    B: 1.497, C: 1.6, // Magic-Formula shape on the normalised slip: peak 1 at 1, about 0.78 at 4
    relaxX: 0.12, relaxY: 0.45, // m relaxation lengths
    roll: 0.012, // rolling resistance coefficient
  },
  engine: {
    idle: 1000, redline: 8500, cut: 8550, inertia: 0.24,
    // rpm, Nm at full throttle (750 hp / 559 kW at 8250, 720 Nm at 6750)
    curve: [[0, 300], [1000, 380], [2000, 470], [3000, 550], [4000, 612], [5000, 665], [6000, 706], [6750, 720], [7500, 706], [8250, 647], [8500, 618], [9000, 520]],
    dragBase: 22, dragPerRpm: 0.0085, // Nm closed-throttle friction and pumping
    launch: 6400, // rpm held by the clutch when setting off at full throttle
    // (V5) start: the starter motor's torque at the crank (stall torque falling to 0 at its free speed), how long it
    // cranks before the first firing, the flare above idle after firing and how fast the governor brings it down
    starterT: 160, starterFree: 320, crank: 0.7, flare: 500, flareTime: 0.9,
  },
  gearbox: {
    ratios: [-2.9, 0, 3.1, 2.19, 1.68, 1.35, 1.12, 0.97, 0.86], // R, N, 1..7
    final: 3.35,
    efficiency: 0.84,
    upTime: 0.1, downTime: 0.14,
    fill: 0.55, // share of the torque carried through mid-shift (torque fill)
    up: 8250, down: 3600, kick: 5200, // auto: shift points (rpm)
  },
  split: [0.15, 0.15, 0.35, 0.35], // torque share per wheel (30 / 70 centre, open axles)
  centreVisc: 140, centreMax: 420, // Nm s/rad, Nm
  lsd: { visc: 380, preload: 150, bias: 0.4 },
  brake: { front: 3900, rear: 2400, handbrake: 3200, absSlip: -0.085, abs: true },
  tc: { slip: 0.12, on: true },
  aero: { cdA: 0.8, clA: 1.0, front: 0.4 },
  steer: { ratio: 15, lock: 28 * DEG, ackermann: 0.6, rate: 600 * DEG, rateHigh: 160 * DEG },
  footprint: { hx: 1.015, front: -2.4, back: 2.4, top: 1.14 },
};

// ---------------------------------------------------------------- small vector and quaternion math
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const set = (o, x, y, z) => ((o.x = x), (o.y = y), (o.z = z), o);
const copy = (o, a) => set(o, a.x, a.y, a.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (o, a, b) => set(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const addS = (o, a, s) => set(o, o.x + a.x * s, o.y + a.y * s, o.z + a.z * s);
const len = (a) => Math.hypot(a.x, a.y, a.z);
/** o = R(q) a */
function rot(o, q, a) {
  const { x, y, z, w } = q;
  const ix = w * a.x + y * a.z - z * a.y;
  const iy = w * a.y + z * a.x - x * a.z;
  const iz = w * a.z + x * a.y - y * a.x;
  const iw = -x * a.x - y * a.y - z * a.z;
  return set(o, ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x);
}
/** o = R(q)^-1 a */
const unrot = (o, q, a) => rot(o, { x: -q.x, y: -q.y, z: -q.z, w: q.w }, a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

/** (V5) Contacts against the world: restitution, wall friction, the contact's height above the ground (m). */
export const COLLIDE = { e: 0.15, mu: 0.45, height: 0.45 };

function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1];
      const [x1, y1] = curve[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1][1];
}

/** A flat world: y = 0 everywhere, tarmac. */
export const FLAT = {
  height(x, z, n) {
    if (n) set(n, 0, 1, 0);
    return 0;
  },
  surface() {
    return SURFACES.tarmac;
  },
  obstacles: [],
};
export const SURFACES = {
  tarmac: { name: 'tarmac', grip: 1, roll: 1, dust: 0 },
  kerb: { name: 'kerb', grip: 0.92, roll: 1.2, dust: 0 },
  dirt: { name: 'dirt', grip: 0.62, roll: 4, dust: 1 },
  grass: { name: 'grass', grip: 0.5, roll: 5, dust: 0.6 },
};

export class CarDynamics {
  constructor(spec = SPEC, ground = FLAT) {
    this.spec = spec;
    this.ground = ground;
    this.pos = v3(); // centre of mass, world
    this.vel = v3();
    this.quat = { x: 0, y: 0, z: 0, w: 1 };
    this.omega = v3(); // world angular velocity
    this.com = v3(...spec.com);
    this.massBody = spec.mass;
    this.massSprung = spec.mass - spec.wheels.reduce((s, w) => s + w.mu, 0);
    const L = spec.wheelbase;
    // static spring forces (sprung weight per corner), so the free lengths put the car at ride height
    const frontShare = (spec.wheels[2].z - spec.com[2]) / L;
    this.wheels = spec.wheels.map((w, i) => {
      const share = (w.front ? frontShare : 1 - frontShare) / 2;
      const k = w.front ? spec.springF : spec.springR;
      const fs = this.massSprung * G * share;
      const fz = fs + w.mu * G;
      return {
        ...w,
        index: i,
        k,
        cBump: (w.front ? spec.damp.F : spec.damp.R)[0],
        cReb: (w.front ? spec.damp.F : spec.damp.R)[1],
        x0: spec.mount + fs / k, // spring free length
        xStatic: spec.mount,
        rFree: w.r + fz / spec.tyreK, // unloaded tyre radius: loaded it is w.r at the static load
        mount: v3(w.x, w.r + spec.mount, w.z), // body frame
        x: spec.mount, // spring length now (m, along the body's down axis)
        xv: 0,
        omega: 0, // rad/s, + rolling forward
        spin: 0, // rad, accumulated (for the visual)
        steer: 0, // rad, + left
        toe: 0, // (V7) rad added to the steer angle: damage (a bent arm)
        flat: 0, // (V7) m: a flat spot's depth (damage), 0 = round
        flatAt: 0, // (V7) rad: where on the tyre the flat spot is (wheel spin angle)
        u: 0, // longitudinal tyre deflection (m)
        s: 0, // lateral tyre deflection (m)
        kappa: 0,
        alpha: 0, // rad, + = force to the left
        fz: fz,
        fx: 0,
        fy: 0,
        contact: true,
        surface: SURFACES.tarmac,
        abs: 1,
        slipSpeed: 0, // m/s of the contact patch sliding over the ground
        groundY: 0,
        center: v3(), // wheel centre, world
        patch: v3(), // contact point, world
        normal: v3(0, 1, 0),
        vM: v3(), // mount velocity last step (for the wheel's frame acceleration)
        driveT: 0,
        brakeT: 0,
      };
    });
    this.engine = { omega: spec.engine.idle / RPM, torque: 0, locked: false, cut: false, load: 0 };
    // (V5) ignition: 'off' | 'cranking' | 'running'; the starter turns the engine for spec.engine.crank s, it fires,
    // flares to about 1500 rpm and the idle governor brings it down to idle (engine.flare decays)
    this.ignition = 'running';
    this.crankT = 0;
    this.flare = 0;
    this.impacts = []; // (V5) contact impulses this frame (cleared by update): { x, y, z, nx, nz, j, jt, vn, vt, body }
    this.gear = 1; // index into ratios: 0 R, 1 N, 2.. first..
    this.auto = true;
    this.shift = null; // { from, to, t, time }
    this.shiftLog = []; // { from, to, time }
    this.tc = 1;
    this.steerWheel = 0; // steering wheel angle (rad, + left)
    this.time = 0;
    this.acc = v3(); // world acceleration of the centre of mass (last frame, smoothed over its steps)
    this.accBody = v3(); // in the body frame: +x right, +y up, -z forward
    this.hold = 0;
    this.pressure = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerAngle: null, shiftUp: false, shiftDown: false, clutch: null };
    this.contacts = []; // collisions this frame: { x, z, impulse }
    this._acc = 0;
    this._f = v3();
    this._t = v3();
    this._tmp = v3();
    this._tmp2 = v3();
    this._tmp3 = v3();
    this._vPrev = v3();
    this.reset(0, 0, 0);
  }

  /** Puts the car at rest on the ground at (x, z), facing `yaw` (0 looks down -Z, + turns left). */
  reset(x, z, yaw = 0) {
    const h = this.ground.height(x, z);
    this.quat = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    rot(this.pos, this.quat, this.com);
    this.pos.x += x;
    this.pos.y += h;
    this.pos.z += z;
    set(this.vel, 0, 0, 0);
    set(this.omega, 0, 0, 0);
    for (const w of this.wheels) {
      w.x = w.xStatic;
      w.xv = 0;
      w.omega = 0;
      w.u = w.s = 0;
      w.abs = 1;
      set(w.vM, 0, 0, 0);
    }
    this.engine.omega = this.spec.engine.idle / RPM;
    this.engine.locked = false;
    this.engine.cut = false;
    this.ignition = 'running';
    this.crankT = 0;
    this.flare = 0;
    this.pressure = 0;
    this.tc = 1;
    Object.assign(this.input, { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerAngle: null, shiftUp: false, shiftDown: false, tc: undefined, abs: undefined });
    set(this.acc, 0, 0, 0);
    set(this.accBody, 0, 0, 0);
    this.gear = 2;
    this.shift = null;
    this.steerWheel = 0;
    this.hold = 1;
    this._acc = 0;
  }

  /** The vehicle_root's world position and quaternion. */
  rootPose(outPos, outQuat) {
    rot(this._tmp, this.quat, this.com);
    outPos.x = this.pos.x - this._tmp.x;
    outPos.y = this.pos.y - this._tmp.y;
    outPos.z = this.pos.z - this._tmp.z;
    if (outQuat) {
      outQuat.x = this.quat.x;
      outQuat.y = this.quat.y;
      outQuat.z = this.quat.z;
      outQuat.w = this.quat.w;
    }
  }

  get forward() {
    return rot(v3(), this.quat, v3(0, 0, -1));
  }

  /** Forward speed (m/s, + forwards). */
  get speed() {
    rot(this._tmp3, this.quat, set(this._tmp2, 0, 0, -1));
    return dot(this.vel, this._tmp3);
  }

  get rpm() {
    return this.engine.omega * RPM;
  }

  /** (V5) The starter: the engine cranks for spec.engine.crank s, fires and flares to about 1500 rpm, then idles. */
  startEngine() {
    if (this.ignition !== 'off') return false;
    this.ignition = 'cranking';
    this.crankT = 0;
    return true;
  }

  /** (V5) Ignition off: no fuel, the clutches open, the engine runs down against its own friction. */
  stopEngine() {
    if (this.ignition === 'off') return false;
    this.ignition = 'off';
    this.flare = 0;
    this.engine.locked = false;
    this.engine.cut = false;
    return true;
  }

  get running() {
    return this.ignition === 'running';
  }

  /** The gear as shown: 'R', 'N', 1..7. */
  get gearName() {
    return this.gear === 0 ? 'R' : this.gear === 1 ? 'N' : String(this.gear - 1);
  }

  /** Steps the simulation on by `dt` seconds of real time (fixed steps; the remainder carries over). */
  update(dt) {
    this.impacts.length = 0;
    this._acc += dt;
    copy(this._vPrev, this.vel);
    let n = 0;
    while (this._acc >= STEP) {
      this._acc -= STEP;
      this._step(STEP);
      n++;
    }
    if (n > 0) {
      const t = n * STEP;
      set(this.acc, (this.vel.x - this._vPrev.x) / t, (this.vel.y - this._vPrev.y) / t, (this.vel.z - this._vPrev.z) / t);
      unrot(this.accBody, this.quat, this.acc);
    }
    return n;
  }

  _ratio(gear) {
    const gb = this.spec.gearbox;
    return gb.ratios[gear] * gb.final;
  }

  /** The ratio now: through a shift, eased from the old gear's to the new one's. */
  _ratioNow() {
    const s = this.shift;
    if (!s) return this._ratio(this.gear);
    const u = clamp(s.t / s.time, 0, 1);
    const e = u * u * (3 - 2 * u);
    return lerp(this._ratio(s.from), this._ratio(s.to), e);
  }

  shiftTo(gear) {
    const ratios = this.spec.gearbox.ratios;
    if (gear < 0 || gear >= ratios.length || gear === this.gear || this.shift) return false;
    const up = gear > this.gear && gear > 1 && this.gear > 1;
    const time = gear <= 1 || this.gear <= 1 ? 0.25 : up ? this.spec.gearbox.upTime : this.spec.gearbox.downTime;
    this.shift = { from: this.gear, to: gear, t: 0, time, up };
    this.gear = gear;
    this.shiftLog.push({ from: this.shift.from, to: gear, time, at: this.time });
    if (this.shiftLog.length > 50) this.shiftLog.shift();
    return true;
  }

  _engineTorque(omega, throttle) {
    const e = this.spec.engine;
    const rpm = omega * RPM;
    if (rpm > e.cut) this.engine.cut = true;
    else if (rpm < e.redline - 150) this.engine.cut = false;
    let thr = throttle;
    const drag = e.dragBase + e.dragPerRpm * rpm;
    // (V5) ignition off: friction only (it never turns the engine backwards); cranking: the starter's torque
    if (this.ignition !== 'running') {
      const starter = this.ignition === 'cranking' ? e.starterT * Math.max(0, 1 - rpm / e.starterFree) : 0;
      return starter - drag * Math.min(1, rpm / 50);
    }
    // idle governor (V5: its target raised by the start's flare)
    const idle = e.idle + this.flare * e.flare;
    if (rpm < idle + 100) thr = Math.max(thr, clamp((idle + 100 - rpm) / 400, 0, 0.35));
    if (this.engine.cut) thr = 0;
    const full = curveAt(e.curve, rpm);
    return full * thr - drag * (1 - thr);
  }

  _step(h) {
    const spec = this.spec;
    const inp = this.input;
    const q = this.quat;
    this.time += h;
    const up = rot(this._up || (this._up = v3()), q, v3(0, 1, 0));
    const fwdB = this._fwdB || (this._fwdB = v3());
    rot(fwdB, q, set(this._tmp, 0, 0, -1));
    const vx = dot(this.vel, fwdB);
    const speed = Math.abs(vx);

    // ---- steering ----
    const st = spec.steer;
    let wantRoad;
    if (inp.steerAngle !== null && inp.steerAngle !== undefined) wantRoad = clamp(inp.steerAngle, -st.lock, st.lock);
    else {
      // keyboard: the most the road wheels may turn falls with speed (about the angle for 1.5 g plus
      // a few degrees of slip), so a held key corners hard without spinning the car at 250 km/h
      const geo = Math.atan((spec.wheelbase * 1.5 * G) / Math.max(1, speed * speed));
      const slip = lerp(6 * DEG, 3 * DEG, clamp((speed - 14) / 70, 0, 1));
      wantRoad = clamp(inp.steer, -1, 1) * Math.min(st.lock, geo + slip);
    }
    const rate = lerp(st.rate, st.rateHigh, clamp(speed / 60, 0, 1)) * (inp.steerAngle !== null && inp.steerAngle !== undefined ? 4 : 1);
    const wantWheel = wantRoad * st.ratio;
    this.steerWheel += clamp(wantWheel - this.steerWheel, -rate * h, rate * h);
    const road = this.steerWheel / st.ratio;
    // Ackermann: the inner wheel turns further
    if (Math.abs(road) > 1e-5) {
      const R = spec.wheelbase / Math.tan(Math.abs(road));
      const t = Math.abs(spec.wheels[0].x) * 2;
      const inner = Math.atan(spec.wheelbase / (R - t / 2));
      const outer = Math.atan(spec.wheelbase / (R + t / 2));
      const a = st.ackermann;
      const sgn = Math.sign(road);
      const innerA = lerp(Math.abs(road), inner, a) * sgn;
      const outerA = lerp(Math.abs(road), outer, a) * sgn;
      // turning left (+): the left wheel is the inner one
      this.wheels[0].steer = road > 0 ? innerA : outerA;
      this.wheels[1].steer = road > 0 ? outerA : innerA;
    } else this.wheels[0].steer = this.wheels[1].steer = 0;
    // (V7) damage: a bent steering arm or knocked suspension leaves a wheel toed in or out (rad, + left; 0 when new)
    for (const w of this.wheels) if (w.toe) w.steer += w.toe;

    // ---- gearbox ----
    const gb = spec.gearbox;
    if (this.shift) {
      this.shift.t += h;
      if (this.shift.t >= this.shift.time) this.shift = null;
    }
    const rpmNow = this.engine.omega * RPM;
    if (inp.shiftUp) {
      inp.shiftUp = false;
      if (this.gear >= 1 && this.gear < gb.ratios.length - 1) this.shiftTo(this.gear + 1);
    }
    if (inp.shiftDown) {
      inp.shiftDown = false;
      if (this.gear > 2) {
        const after = Math.abs(this._wheelOut()) * Math.abs(this._ratio(this.gear - 1)) * RPM;
        if (after < spec.engine.redline - 200) this.shiftTo(this.gear - 1);
      } else if (this.gear >= 1) this.shiftTo(this.gear - 1);
    }
    if (this.auto && !this.shift && this.gear >= 2) {
      // (decided on the gearbox's road speed, not the engine's: the clutch is open under hard braking)
      const out = this._wheelOut();
      const road = Math.abs(out * this._ratio(this.gear)) * RPM;
      if (rpmNow > gb.up && this.gear < gb.ratios.length - 1 && this.engine.locked) this.shiftTo(this.gear + 1);
      else if (this.gear > 2) {
        const lower = Math.abs(out * this._ratio(this.gear - 1)) * RPM;
        const want = inp.throttle > 0.85 ? gb.kick : gb.down;
        if (road < want && lower < gb.up - 600) this.shiftTo(this.gear - 1);
      }
    }

    // ---- per wheel: suspension, tyre ----
    const F = set(this._f, 0, -this.massSprung * G, 0);
    const T = set(this._t, 0, 0, 0);
    const r = this._r || (this._r = v3());
    const M = this._M || (this._M = v3());
    const vM = this._vMn || (this._vMn = v3());
    const n = this._n || (this._n = v3());
    const f = this._fw || (this._fw = v3());
    const l = this._lw || (this._lw = v3());
    const vp = this._vp || (this._vp = v3());
    const tmp = this._tmp;
    const ty = spec.tyre;
    // root in the world
    rot(tmp, q, this.com);
    const rootX = this.pos.x - tmp.x;
    const rootY = this.pos.y - tmp.y;
    const rootZ = this.pos.z - tmp.z;
    const wheels = this.wheels;
    for (const w of wheels) {
      rot(M, q, w.mount);
      M.x += rootX;
      M.y += rootY;
      M.z += rootZ;
      // mount velocity
      set(r, M.x - this.pos.x, M.y - this.pos.y, M.z - this.pos.z);
      cross(vM, this.omega, r);
      vM.x += this.vel.x;
      vM.y += this.vel.y;
      vM.z += this.vel.z;
      // wheel centre
      const C = w.center;
      set(C, M.x - up.x * w.x, M.y - up.y * w.x, M.z - up.z * w.x);
      // wheel heading on the body (steered)
      const sd = Math.sin(w.steer);
      const cd = Math.cos(w.steer);
      rot(f, q, set(tmp, -sd, 0, -cd));
      // the ground under the tyre, enveloped along its contact length (a wheel rolls up a kerb's edge)
      let gy = this.ground.height(C.x, C.z, n);
      const reach = 0.13;
      const drop = w.r - Math.sqrt(w.r * w.r - reach * reach);
      const ga = this.ground.height(C.x + f.x * reach, C.z + f.z * reach) - drop;
      const gb2 = this.ground.height(C.x - f.x * reach, C.z - f.z * reach) - drop;
      if (ga > gy) gy = ga;
      if (gb2 > gy) gy = gb2;
      w.groundY = gy;
      w.surface = this.ground.surface(C.x, C.z);
      // tyre vertical
      // (V7) damage: a flat spot (m deep, at spin angle flatAt) shortens the radius as it comes round: a thump once a turn
      const rNow = w.flat ? w.rFree - w.flat * Math.pow(Math.max(0, Math.cos(w.spin - w.flatAt)), 24) : w.rFree;
      const pen = gy - (C.y - rNow);
      const wheelV = vM.y - up.y * w.xv; // vertical speed of the wheel centre
      let fz = 0;
      if (pen > 0) fz = Math.max(0, spec.tyreK * pen - spec.tyreC * wheelV);
      w.contact = pen > 0;
      w.fz = fz;
      // spring, dampers, stops (force pushing the wheel down and the body up, along the body's axis)
      let fs = w.x < w.x0 ? w.k * (w.x0 - w.x) : 0;
      fs -= w.xv * (w.xv < 0 ? w.cBump : w.cReb); // xv < 0: compressing
      const bumpAt = w.xStatic - spec.bump + 0.025;
      if (w.x < bumpAt) {
        const d = bumpAt - w.x;
        fs += 60000 * d + 4.0e6 * d * d;
      }
      const reboundAt = w.xStatic + spec.droop;
      if (w.x > reboundAt) fs -= 300000 * (w.x - reboundAt);
      w.fs = fs;
      // tyre forces: contact frame on the ground plane
      const nd = dot(f, n);
      set(f, f.x - n.x * nd, f.y - n.y * nd, f.z - n.z * nd);
      const fl = len(f) || 1;
      set(f, f.x / fl, f.y / fl, f.z / fl);
      cross(l, n, f); // left
      const P = w.patch;
      set(P, C.x - n.x * (C.y - gy), Math.min(C.y, gy) + 0 * n.y, C.z - n.z * (C.y - gy));
      P.y = gy;
      set(r, P.x - this.pos.x, P.y - this.pos.y, P.z - this.pos.z);
      cross(vp, this.omega, r);
      vp.x += this.vel.x;
      vp.y += this.vel.y;
      vp.z += this.vel.z;
      const vxw = dot(vp, f);
      const vyw = dot(vp, l);
      w.vx = vxw;
      // transient slip (relaxation lengths)
      const ax = Math.abs(vxw);
      const slipX = w.omega * w.r - vxw;
      w.u += (slipX - (ax * w.u) / ty.relaxX) * h;
      w.s += (-vyw - (ax * w.s) / ty.relaxY) * h;
      w.u = clamp(w.u, -ty.relaxX * 1.2, ty.relaxX * 20);
      w.s = clamp(w.s, -ty.relaxY * 4, ty.relaxY * 4);
      const kappa = w.u / ty.relaxX;
      const tanA = w.s / ty.relaxY;
      w.kappa = kappa;
      w.alpha = Math.atan(tanA);
      w.slipSpeed = Math.hypot(slipX, vyw);
      let fx = 0;
      let fy = 0;
      if (fz > 0) {
        const grip = w.grip * w.surface.grip * Math.max(0.5, 1 - ty.loadSens * (fz / ty.load0 - 1));
        const muX = ty.muX * grip;
        const muY = ty.muY * grip;
        const sx = kappa / ty.kappaPeak;
        const sy = tanA / Math.tan(ty.alphaPeak);
        const S = Math.hypot(sx, sy);
        if (S > 1e-9) {
          const shape = Math.sin(ty.C * Math.atan(ty.B * S));
          fx = (muX * fz * shape * sx) / S;
          fy = (muY * fz * shape * sy) / S;
        }
        // at a crawl, viscous damping of the patch's slip (a tyre's own hysteresis): settles the car
        const b = clamp(1 - ax / 1.5, 0, 1);
        if (b > 0) {
          fx += b * 0.9 * fz * slipX * 0.6;
          fy += -b * 0.9 * fz * vyw * 0.6;
          const cap = Math.max(muX, muY) * fz;
          const m = Math.hypot(fx, fy);
          if (m > cap) {
            fx *= cap / m;
            fy *= cap / m;
          }
        }
        // rolling resistance
        fx -= ty.roll * w.surface.roll * fz * Math.tanh(vxw / 0.3);
      }
      w.fx = fx;
      w.fy = fy;
      // onto the body: tyre forces at the patch, the spring at the mount
      set(tmp, f.x * fx + l.x * fy, f.y * fx + l.y * fy, f.z * fx + l.z * fy);
      F.x += tmp.x;
      F.y += tmp.y;
      F.z += tmp.z;
      cross(this._tmp2, r, tmp);
      T.x += this._tmp2.x;
      T.y += this._tmp2.y;
      T.z += this._tmp2.z;
      // wheel frame acceleration along its axis (the mount's)
      w.aM = ((vM.x - w.vM.x) * -up.x + (vM.y - w.vM.y) * -up.y + (vM.z - w.vM.z) * -up.z) / h;
      copy(w.vM, vM);
      w._M = w._M || v3();
      copy(w._M, M);
    }
    // anti-dive / anti-squat: the links' angles carry a share of each tyre's longitudinal force
    // into the body vertically (front: braking lifts the nose; rear: drive lifts the tail)
    for (const w of wheels) w.fs += w.fx * (w.front ? -spec.antiDive : spec.antiSquat);
    // anti-roll bars
    for (const [a, b, k] of [[0, 1, spec.arbF], [2, 3, spec.arbR]]) {
      const d = k * (wheels[b].x - wheels[a].x); // left more compressed (shorter): + on the left
      wheels[a].fs += d;
      wheels[b].fs -= d;
    }
    for (const w of wheels) {
      // body: spring force up along the body's axis at the mount
      set(tmp, up.x * w.fs, up.y * w.fs, up.z * w.fs);
      F.x += tmp.x;
      F.y += tmp.y;
      F.z += tmp.z;
      set(r, w._M.x - this.pos.x, w._M.y - this.pos.y, w._M.z - this.pos.z);
      cross(this._tmp2, r, tmp);
      T.x += this._tmp2.x;
      T.y += this._tmp2.y;
      T.z += this._tmp2.z;
      // wheel along the body's down axis: spring down, tyre up, gravity, less the frame's acceleration
      const acc = (w.fs - w.fz * up.y + w.mu * G * up.y) / w.mu - w.aM;
      w.xv += acc * h;
      w.x += w.xv * h;
      const lo = w.xStatic - spec.bump - 0.01;
      if (w.x < lo) {
        w.x = lo;
        if (w.xv < 0) w.xv = 0;
      }
    }

    // ---- aero ----
    const ae = spec.aero;
    const v2 = dot(this.vel, this.vel);
    if (v2 > 1e-6) {
      const vmag = Math.sqrt(v2);
      const drag = 0.5 * RHO * ae.cdA * v2;
      F.x -= (this.vel.x / vmag) * drag;
      F.y -= (this.vel.y / vmag) * drag;
      F.z -= (this.vel.z / vmag) * drag;
      const down = 0.5 * RHO * ae.clA * vx * vx;
      for (const [share, z] of [[ae.front, -1.35], [1 - ae.front, 1.35]]) {
        rot(r, q, set(tmp, 0, 0.3 - this.com.y, z - this.com.z));
        set(tmp, -up.x * down * share, -up.y * down * share, -up.z * down * share);
        F.x += tmp.x;
        F.y += tmp.y;
        F.z += tmp.z;
        cross(this._tmp2, r, tmp);
        T.x += this._tmp2.x;
        T.y += this._tmp2.y;
        T.z += this._tmp2.z;
      }
    }
    this.downforce = 0.5 * RHO * ae.clA * vx * vx;

    // ---- drivetrain and brakes: wheel spin ----
    this._drive(h, vx);

    // ---- body ----
    const m = this.massBody;
    this.vel.x += (F.x / m) * h;
    this.vel.y += (F.y / m) * h;
    this.vel.z += (F.z / m) * h;
    // angular: world inverse inertia R I^-1 R^T, gyroscopic term
    const I = spec.inertia;
    const wb = unrot(this._wb || (this._wb = v3()), q, this.omega);
    const tb = unrot(this._tb || (this._tb = v3()), q, T);
    // tau - w x (I w), body frame
    const Iw = set(this._Iw || (this._Iw = v3()), I[0] * wb.x, I[1] * wb.y, I[2] * wb.z);
    const gyro = cross(this._gy || (this._gy = v3()), wb, Iw);
    wb.x += ((tb.x - gyro.x) / I[0]) * h;
    wb.y += ((tb.y - gyro.y) / I[1]) * h;
    wb.z += ((tb.z - gyro.z) / I[2]) * h;
    rot(this.omega, q, wb);
    this.pos.x += this.vel.x * h;
    this.pos.y += this.vel.y * h;
    this.pos.z += this.vel.z * h;
    const o = this.omega;
    const dq = { x: o.x * h * 0.5, y: o.y * h * 0.5, z: o.z * h * 0.5 };
    const nx = q.x + (dq.x * q.w + dq.y * q.z - dq.z * q.y);
    const ny = q.y + (dq.y * q.w + dq.z * q.x - dq.x * q.z);
    const nz = q.z + (dq.z * q.w + dq.x * q.y - dq.y * q.x);
    const nw = q.w - (dq.x * q.x + dq.y * q.y + dq.z * q.z);
    const qn = Math.hypot(nx, ny, nz, nw);
    q.x = nx / qn;
    q.y = ny / qn;
    q.z = nz / qn;
    q.w = nw / qn;

    this._collide(h);
  }

  /** The gearbox output's speed: the torque-split mean of the four wheels (rad/s). */
  _wheelOut() {
    const s = this.spec.split;
    let o = 0;
    for (let i = 0; i < 4; i++) o += s[i] * this.wheels[i].omega;
    return o;
  }

  _drive(h, vx) {
    const spec = this.spec;
    const inp = this.input;
    const wheels = this.wheels;
    const e = this.engine;
    const es = spec.engine;
    const split = spec.split;
    const ratio = this.gear === 1 ? 0 : this._ratioNow();
    const eta = spec.gearbox.efficiency;
    const out = this._wheelOut();
    const shaft = ratio * out; // engine-side speed of the gearbox input
    // (V5) the start: cranking until it fires (spec.engine.crank s and turning), then the flare decays
    if (this.ignition === 'cranking') {
      this.crankT += h;
      if (this.crankT >= es.crank && e.omega * RPM > 120) {
        this.ignition = 'running';
        this.fireT = 0;
        this.flare = 1;
      }
    } else if (this.ignition === 'running' && this.flare > 0) {
      this.fireT += h;
      this.flare = this.fireT < 0.3 ? 1 : Math.max(0, 1 - (this.fireT - 0.3) / es.flareTime);
    }
    const running = this.ignition === 'running';
    // traction control: the driven wheels' slip over the threshold takes torque away
    let worst = 0;
    for (const w of wheels) if (w.contact) worst = Math.max(worst, Math.sign(ratio || 1) * w.kappa);
    if (spec.tc.on && inp.tc !== false && Math.abs(vx) > 0.5) this.tc = clamp(this.tc + h * 12 * clamp((spec.tc.slip - worst) / 0.04, -1, 1), 0.15, 1);
    else this.tc = Math.min(1, this.tc + h * 6);
    let throttle = clamp(inp.throttle, 0, 1) * (ratio ? this.tc : 1);
    // launch control: brake and throttle together at rest hold the engine at the launch revs
    if (inp.brake > 0.5 && Math.abs(vx) < 1 && inp.throttle > 0.5) throttle = Math.min(throttle, clamp((spec.engine.launch / RPM - e.omega) / 60 + 0.25, 0, 1));
    e.load = throttle;
    // shift: torque fill through the change
    let fill = 1;
    if (this.shift) {
      const u = this.shift.t / this.shift.time;
      fill = 1 - (1 - spec.gearbox.fill) * Math.sin(Math.PI * clamp(u, 0, 1));
    }
    const Te = this._engineTorque(e.omega, throttle);
    e.torque = Te;
    // clutch: open in neutral; launching, it slips to hold the launch revs (or idle when crawling)
    const idle = es.idle / RPM;
    let cap;
    if (ratio === 0) cap = 0;
    else {
      const target = lerp(idle * 1.2, es.launch / RPM, clamp(inp.throttle, 0, 1));
      // what the clutch passes: the engine's torque, plus more while it is above the target revs
      cap = Math.max(0, Te + 40 * (e.omega - target));
      if (inp.throttle < 0.05 && Math.abs(shaft) < idle * 1.05) cap = 0; // stopped in gear: open
      if (inp.handbrake > 0.5) cap = 0;
      if (Math.abs(shaft) > idle * 1.1 && inp.throttle < 0.05 && !(inp.handbrake > 0.5)) cap = 2000; // rolling: closed (engine braking)
      if (e.locked) cap = Math.max(cap, 2000);
      // hard on the brakes (ABS working), or launch control (brake and throttle at rest): open, as a
      // dual clutch box does, so the engine's inertia does not fight the wheels
      if (inp.brake > 0.5) {
        cap = 0;
        e.locked = false;
      }
      if (e.locked && Math.abs(shaft) < idle * 0.95 && inp.throttle < 0.5) {
        e.locked = false; // falling below idle: open
      }
      // (V5) engine not running: both clutches open
      if (!running) {
        cap = 0;
        e.locked = false;
      }
    }
    // the wheels' own torques: tyre reaction, LSD, centre coupling
    const R = this._R || (this._R = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) R[i] = -wheels[i].fx * wheels[i].r;
    const rearT = Math.abs(Te * ratio);
    const lsd = spec.lsd;
    const lim = lsd.preload + lsd.bias * rearT * split[2] * 2;
    const tl = clamp(lsd.visc * (wheels[2].omega - wheels[3].omega), -lim, lim);
    R[2] -= tl;
    R[3] += tl;
    const tcv = clamp(spec.centreVisc * ((wheels[2].omega + wheels[3].omega) / 2 - (wheels[0].omega + wheels[1].omega) / 2), -spec.centreMax, spec.centreMax);
    R[2] -= tcv / 2;
    R[3] -= tcv / 2;
    R[0] += tcv / 2;
    R[1] += tcv / 2;
    const dw = this._dw || (this._dw = [0, 0, 0, 0]);
    if (e.locked && ratio !== 0) {
      // engine and wheels move together: exact coupling through the engine's inertia
      const A = ratio * ratio * es.inertia;
      let num = 0;
      let den = 1;
      for (let i = 0; i < 4; i++) {
        R[i] += split[i] * ratio * eta * Te * fill;
        num += (split[i] * R[i]) / wheels[i].I;
        den += (A * split[i] * split[i]) / wheels[i].I;
      }
      const S = num / den;
      for (let i = 0; i < 4; i++) dw[i] = (R[i] - split[i] * A * S) / wheels[i].I;
      // the torque the clutch carries to do it: over its capacity (a launch, idle), it slips
      const need = Te - es.inertia * ratio * S;
      if (Math.abs(need) > Math.max(cap, 2000) * 1.0001 && !this.shift) e.locked = false;
      for (let i = 0; i < 4; i++) {
        wheels[i].driveT = split[i] * ratio * eta * Te * fill;
        wheels[i].omega += dw[i] * h;
      }
    } else {
      // slipping (or open): Coulomb clutch between the engine and the gearbox
      const slip = e.omega - shaft;
      const tc = ratio === 0 ? 0 : Math.sign(slip) * cap;
      for (let i = 0; i < 4; i++) {
        const drive = split[i] * ratio * eta * tc * fill;
        wheels[i].driveT = drive;
        wheels[i].omega += ((R[i] + drive) / wheels[i].I) * h;
      }
      e.omega += ((Te - tc) / es.inertia) * h;
      const shaft2 = ratio * this._wheelOut();
      // the speeds have met (or crossed): lock
      if (ratio !== 0 && cap > 0 && Math.sign(e.omega - shaft2) !== Math.sign(slip || 1) && Math.abs(shaft2) > idle * 0.9) e.locked = true;
      if (running && !this.flare && e.omega < idle * 0.5) e.omega = idle * 0.5;
      else if (e.omega < 0) e.omega = 0;
    }
    if (e.locked && ratio !== 0) e.omega = ratio * this._wheelOut();
    // brakes (after the drive: static friction that never turns a wheel backwards)
    const b = spec.brake;
    // (the line pressure follows the pedal in about 60 ms)
    this.pressure += (clamp(inp.brake, 0, 1) - this.pressure) * Math.min(1, h / 0.06);
    const pedal = clamp(Math.max(this.pressure, this.hold * 0.35), 0, 1);
    for (const w of wheels) {
      let tb = pedal * (w.front ? b.front : b.rear);
      // ABS: from the wheel's own speed against the road's (as its sensors see it), the brake torque
      // is held at what the tyre is carrying, plus or minus as the slip is short of or past the peak
      w.abs = 1;
      if (b.abs && inp.abs !== false && Math.abs(w.vx) > 2 && tb > 0) {
        const kappa = ((w.omega * w.r - w.vx) / Math.abs(w.vx)) * Math.sign(w.vx);
        const hold = Math.max(0, -w.fx * Math.sign(w.vx) * w.r + 250 * Math.abs(w.vx) * (kappa - b.absSlip));
        if (hold < tb) {
          w.abs = hold / tb;
          tb = hold;
        }
      }
      if (!w.front) tb += clamp(inp.handbrake, 0, 1) * b.handbrake;
      w.brakeT = tb;
      const d = (tb * h) / w.I;
      if (Math.abs(w.omega) <= d) w.omega = 0;
      else w.omega -= Math.sign(w.omega) * d;
      w.spin += w.omega * h;
    }
    if (e.locked && ratio !== 0) e.omega = ratio * this._wheelOut();
    // auto-hold: stopped with no throttle, the brakes hold the car
    const still = Math.abs(vx) < 0.15 && inp.throttle < 0.05;
    this.hold = still ? Math.min(1, this.hold + h * 4) : 0;
  }

  /**
   * (V5) The footprint against the world's oriented boxes (barriers, buildings: ground.obstacles) and against moving
   * bodies (the helicopter's hull: ground.bodies(), each { x, z, c, s, hx, hz, top, bottom, mass, invI (world
   * 3x3 as a function of a vector), vel, omega, cg, apply(J, p) }). Per contact: separating-axis test in the ground
   * plane; the contact point is the car's corner inside the box (a face of the box is the least overlap) or the box's
   * corner inside the car (a face of the car is), at bumper height; then a normal impulse with restitution
   * COLLIDE.e (only for approach speeds over 0.5 m/s, none when resting against it), Coulomb friction along the
   * face (COLLIDE.mu, never more than stops the sliding), both through the full inverse mass and inertia at the
   * point (so an off-centre hit spins the car), the depth pushed out (split by mass with a body). Energy can only
   * fall: each impulse is checked (kinetic energy after <= before, `energyRise` keeps the worst, should stay 0).
   * V1 pushed out and applied an impulse with restitution 0.25 at the car's corner only.
   */
  _collide(h) {
    const obs = this.ground.obstacles;
    const bodies = this.ground.bodies ? this.ground.bodies() : null;
    if ((!obs || !obs.length) && (!bodies || !bodies.length)) return;
    const fp = this.spec.footprint;
    const q = this.quat;
    const rp = this._rp || (this._rp = v3());
    this.rootPose(rp);
    // the car's axes on the ground
    const fwd = rot(this._cf || (this._cf = v3()), q, set(this._tmp, 0, 0, -1));
    const fn = Math.hypot(fwd.x, fwd.z) || 1;
    const ax = fwd.x / fn;
    const az = fwd.z / fn; // forward
    const bx = -az;
    const bz = ax; // right
    const cx = rp.x + ax * -(fp.front + fp.back) / 2;
    const cz = rp.z + az * -(fp.front + fp.back) / 2;
    const hl = (fp.back - fp.front) / 2;
    const hw = fp.hx;
    const test = (o, body) => {
      const dx = o.x - cx;
      const dz = o.z - cz;
      if (dx * dx + dz * dz > (hl + hw + o.hx + o.hz + 1) ** 2) return;
      if (o.top !== undefined && rp.y > o.top + 0.1) return;
      if (o.bottom !== undefined && rp.y + fp.top < o.bottom) return;
      // SAT over the four axes; k < 2: a face of the car is the least overlap
      let best = Infinity;
      let nX = 0;
      let nZ = 0;
      let kBest = 0;
      for (let k = 0; k < 4; k++) {
        const ux = k === 0 ? ax : k === 1 ? bx : k === 2 ? o.c : -o.s;
        const uz = k === 0 ? az : k === 1 ? bz : k === 2 ? o.s : o.c;
        const carR = hl * Math.abs(ax * ux + az * uz) + hw * Math.abs(bx * ux + bz * uz);
        const obR = o.hx * Math.abs(o.c * ux + o.s * uz) + o.hz * Math.abs(-o.s * ux + o.c * uz);
        const d = dx * ux + dz * uz;
        const over = carR + obR - Math.abs(d);
        if (over <= 0) return;
        // (a tie goes to the box's face: a car square on a wall touches with its corners)
        if (over < best - 1e-9 || (k >= 2 && over < best + 1e-6)) {
          best = over;
          kBest = k;
          nX = d > 0 ? -ux : ux; // from the box towards the car
          nZ = d > 0 ? -uz : uz;
        }
      }
      // the contact point: the deepest corner of the other shape along the normal, among the corners inside this
      // one (an end of a wall across half the car's nose: its corner inside the car, not the car's far corner); two
      // corners equally deep (square on): the middle of them
      let px = 0;
      let pz = 0;
      let deep = -Infinity;
      let sx = 0;
      let sz = 0;
      let cnt = 0;
      const corners = this._corners || (this._corners = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 4; i++) {
          const sa = i & 1 ? 1 : -1;
          const sb = i & 2 ? 1 : -1;
          let kx;
          let kz;
          let dd;
          let inside;
          if (kBest >= 2) {
            kx = cx + ax * hl * sa + bx * hw * sb;
            kz = cz + az * hl * sa + bz * hw * sb;
            dd = -(kx * nX + kz * nZ);
            const lx = (kx - o.x) * o.c + (kz - o.z) * o.s;
            const lz = -(kx - o.x) * o.s + (kz - o.z) * o.c;
            inside = Math.abs(lx) <= o.hx + 0.02 && Math.abs(lz) <= o.hz + 0.02;
          } else {
            kx = o.x + o.c * o.hx * sa - o.s * o.hz * sb;
            kz = o.z + o.s * o.hx * sa + o.c * o.hz * sb;
            dd = kx * nX + kz * nZ;
            const lx = (kx - cx) * ax + (kz - cz) * az;
            const lz = (kx - cx) * bx + (kz - cz) * bz;
            inside = Math.abs(lx) <= hl + 0.02 && Math.abs(lz) <= hw + 0.02;
          }
          corners[i * 3] = kx;
          corners[i * 3 + 1] = kz;
          corners[i * 3 + 2] = inside || pass === 1 ? dd : -Infinity;
          if (corners[i * 3 + 2] > deep) deep = corners[i * 3 + 2];
        }
        if (deep > -Infinity) break;
      }
      for (let i = 0; i < 4; i++) {
        if (deep - corners[i * 3 + 2] < 0.02) {
          sx += corners[i * 3];
          sz += corners[i * 3 + 1];
          cnt++;
        }
      }
      px = sx / cnt;
      pz = sz / cnt;
      // ((V8) a deformable barrier (the tyre walls): a spring and damper on the depth, no push-out)
      if (o.soft) {
        if (o.off) return;
        // (the length of the stack the car's footprint covers, along the stack: its force is per 2 m of it, so a car
        // across two or three short stacks is held as by one wall)
        const ux = -o.s;
        const uz = o.c;
        const pc = (cx - o.x) * ux + (cz - o.z) * uz;
        const ext = hl * Math.abs(ax * ux + az * uz) + hw * Math.abs(bx * ux + bz * uz);
        const width = Math.max(0, Math.min(o.hz, pc + ext) - Math.max(-o.hz, pc - ext));
        this._soft(px, Math.min(rp.y + COLLIDE.height, o.top !== undefined ? o.top : Infinity), pz, nX, nZ, best, o, h, width / 2);
        return;
      }
      this._contact(px, Math.min(rp.y + COLLIDE.height, o.top !== undefined ? o.top : Infinity), pz, nX, nZ, best, body, o);
    };
    if (obs) for (const o of obs) test(o, null);
    if (bodies) for (const b of bodies) test(b, b);
  }

  /** (V5) One contact: push-out and the impulse (normal with restitution, friction) at world point p, normal n. */
  _contact(px, py, pz, nX, nZ, depth, body, o) {
    const m = this.massBody;
    const I = this.spec.inertia;
    const q = this.quat;
    // push out (with a body, shared by mass)
    const share = body ? body.mass / (body.mass + m) : 1;
    this.pos.x += nX * depth * share;
    this.pos.z += nZ * depth * share;
    if (body && body.push) body.push(-nX * depth * (1 - share), -nZ * depth * (1 - share));
    px += nX * depth * share;
    pz += nZ * depth * share;
    const r = set(this._cr || (this._cr = v3()), px - this.pos.x, py - this.pos.y, pz - this.pos.z);
    // velocity of the car's point, relative to the body's
    const vpt = cross(this._cv || (this._cv = v3()), this.omega, r);
    vpt.x += this.vel.x;
    vpt.y += this.vel.y;
    vpt.z += this.vel.z;
    const rb = body ? set(this._crb || (this._crb = v3()), px - body.cg.x, py - body.cg.y, pz - body.cg.z) : null;
    if (body) {
      const vb = cross(this._cvb || (this._cvb = v3()), body.omega, rb);
      vpt.x -= vb.x + body.vel.x;
      vpt.y -= vb.y + body.vel.y;
      vpt.z -= vb.z + body.vel.z;
    }
    const vn = vpt.x * nX + vpt.z * nZ;
    if (vn >= 0) return;
    // the inverse mass along a direction u at the point: 1/m + u . ((I^-1 (r x u)) x r), plus the body's
    const invI = (out, a) => {
      unrot(out, q, a);
      set(out, out.x / I[0], out.y / I[1], out.z / I[2]);
      return rot(out, q, out);
    };
    const kAlong = (u) => {
      const rxu = cross(this._k1 || (this._k1 = v3()), r, u);
      const w = invI(this._k2 || (this._k2 = v3()), rxu);
      const t = cross(this._k3 || (this._k3 = v3()), w, r);
      let k = 1 / m + dot(u, t);
      if (body) {
        cross(rxu, rb, u);
        body.invI(w, rxu);
        cross(t, w, rb);
        k += 1 / body.mass + dot(u, t);
      }
      return k;
    };
    const nrm = set(this._cn || (this._cn = v3()), nX, 0, nZ);
    const kn = kAlong(nrm);
    const e = COLLIDE.e * clamp((-vn - 0.5) / 1.5, 0, 1);
    const j = (-(1 + e) * vn) / kn;
    // friction along the face (and up or down it), at most mu j, never more than stops the sliding there
    const tv = set(this._ct || (this._ct = v3()), vpt.x - vn * nX, vpt.y, vpt.z - vn * nZ);
    const vt = len(tv);
    let jt = 0;
    if (vt > 1e-6) {
      set(tv, tv.x / vt, tv.y / vt, tv.z / vt);
      jt = Math.min(COLLIDE.mu * j, vt / kAlong(tv));
    }
    const J = set(this._cj || (this._cj = v3()), nX * j - tv.x * jt, -tv.y * jt, nZ * j - tv.z * jt);
    const e0 = this._energy(body);
    addS(this.vel, J, 1 / m);
    const dw = invI(this._k2, cross(this._k1, r, J));
    addS(this.omega, dw, 1);
    if (body) body.apply(set(this._k3, -J.x, -J.y, -J.z), { x: px, y: py, z: pz });
    const e1 = this._energy(body);
    if (e1 > e0 + 1e-6) this.energyRise = Math.max(this.energyRise || 0, e1 - e0);
    this.contacts.push({ x: px, z: pz, impulse: j });
    if (this.contacts.length > 20) this.contacts.shift();
    this.impacts.push({ x: px, y: py, z: pz, nx: nX, nz: nZ, j, jt, vn, vt, body: !!body, dE: e1 - e0, t: this.time });
  }

  /**
   * (V8) A deformable barrier (o.soft = { k N/m, k2 m, c N s/m, cIn m, mu }): the stack is pressed in by `depth` (m);
   * it pushes back with k depth (1 + depth / k2) plus c min(1, depth / cIn) times the closing speed (never pulls), through the car's inverse mass and inertia at the
   * point as an impulse of that force over this sub-step `h`, with friction along its face (mu, never more than stops
   * the sliding). The damper takes the energy: the car is caught over the stack's depth instead of bouncing off a
   * wall. If it goes through the stack, the hard wall behind (its own obstacle) stops it as before.
   */
  _soft(px, py, pz, nX, nZ, depth, o, h, share = 1) {
    const m = this.massBody;
    const I = this.spec.inertia;
    const q = this.quat;
    const r = set(this._sr || (this._sr = v3()), px - this.pos.x, py - this.pos.y, pz - this.pos.z);
    const vpt = cross(this._sv || (this._sv = v3()), this.omega, r);
    vpt.x += this.vel.x;
    vpt.y += this.vel.y;
    vpt.z += this.vel.z;
    const vn = vpt.x * nX + vpt.z * nZ;
    // (progressive: the spring stiffens as the stacks close up (k (1 + depth / k2)); the damper comes in over the first
    // cIn m, so the first touch is not a blow)
    const sf = o.soft;
    const F = share * (sf.k * depth * (1 + depth / (sf.k2 || 1e9)) - sf.c * Math.min(1, depth / (sf.cIn || 1e-9)) * vn);
    if (F <= 0) return;
    const j = F * h;
    const invI = (out, a) => {
      unrot(out, q, a);
      set(out, out.x / I[0], out.y / I[1], out.z / I[2]);
      return rot(out, q, out);
    };
    const kAlong = (u) => {
      const rxu = cross(this._k1 || (this._k1 = v3()), r, u);
      const w = invI(this._k2 || (this._k2 = v3()), rxu);
      const t = cross(this._k3 || (this._k3 = v3()), w, r);
      return 1 / m + dot(u, t);
    };
    const tv = set(this._st || (this._st = v3()), vpt.x - vn * nX, vpt.y, vpt.z - vn * nZ);
    const vt = len(tv);
    let jt = 0;
    if (vt > 1e-6) {
      set(tv, tv.x / vt, tv.y / vt, tv.z / vt);
      jt = Math.min((o.soft.mu ?? 0.6) * j, vt / kAlong(tv));
    }
    const J = set(this._sj || (this._sj = v3()), nX * j - tv.x * jt, -tv.y * jt, nZ * j - tv.z * jt);
    addS(this.vel, J, 1 / m);
    addS(this.omega, invI(this._k2, cross(this._k1, r, J)), 1);
    o.pressed = Math.max(o.pressed || 0, depth);
    this.softDepth = Math.max(this.softDepth || 0, depth);
    this.impacts.push({ x: px, y: py, z: pz, nx: nX, nz: nZ, j, jt, vn, vt, body: false, soft: true, dE: 0, t: this.time });
  }

  /** Kinetic energy (J) of the car's body, plus a colliding body's if given. */
  _energy(body) {
    const I = this.spec.inertia;
    const wb = unrot(this._ew || (this._ew = v3()), this.quat, this.omega);
    let E = 0.5 * this.massBody * dot(this.vel, this.vel) + 0.5 * (I[0] * wb.x * wb.x + I[1] * wb.y * wb.y + I[2] * wb.z * wb.z);
    if (body && body.energy) E += body.energy();
    return E;
  }

  /** Body roll and pitch relative to the ground plane (rad): roll + right side down, pitch + nose up. */
  attitude(out = {}) {
    const right = rot(v3(), this.quat, v3(1, 0, 0));
    const fwd = rot(v3(), this.quat, v3(0, 0, -1));
    out.roll = Math.asin(clamp(-right.y, -1, 1));
    out.pitch = Math.asin(clamp(fwd.y, -1, 1));
    return out;
  }
}
