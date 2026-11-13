/*
 * Utility helicopter flight model (pass H1).
 *
 * Pure ES module: no Three.js, no DOM, no imports. Runs in Node (tools/heli) and in the browser.
 *
 * ---------------------------------------------------------------------------------------------
 * FRAMES AND UNITS
 *   Body frame = the glTF frame of `helicopter_root`: +X right, +Y up, -Z forward (nose), +Z aft.
 *   The body origin is helicopter_root itself: on the ground plane directly below the mast.
 *   World frame = the game's Three.js world: +Y up, any horizontal orientation. Sea level is
 *   world y = opts.seaLevelY (default 0); air density and engine power follow ISA altitude.
 *   SI units throughout: metres, kilograms, seconds, newtons, radians, watts. rpm and % only in
 *   the reported state, where named so.
 *   Attitude is a unit quaternion body -> world. state.quaternion is {x, y, z, w} so it can go
 *   straight into THREE.Quaternion.set(x, y, z, w); state.position is helicopter_root in world,
 *   so the GLB root can be placed with it directly.
 *   Rotation senses: body angular velocity (state.angularVelocity) is about body +X/+Y/+Z with the
 *   right-hand rule. Friendlier names in state.rates: pitchUp (= +X), yawRight (= -Y), rollRight (= -Z).
 *   Main rotor spins counter-clockwise seen from above = positive about body +Y; state.rotor.azimuth
 *   is that angle (rad, 0..2pi) for main_rotor_pivot local +Y. Tail rotor azimuth is positive about
 *   local +X of tail_rotor_pivot (flip the sign in the game if the asset clip turns the other way).
 *
 * CONTROLS IN (heli.controls, set directly or with setControls):
 *   collective   0..1     0 = low-pitch stop, 1 = high-pitch stop (blade pitch THETA75_MIN..MAX)
 *   cyclicPitch  -1..1    +1 = stick fully forward (disc tilts forward, nose down)
 *   cyclicRoll   -1..1    +1 = stick fully right
 *   pedal        -1..1    +1 = full right pedal (nose right; less tail-rotor pitch)
 *   throttle     0..1     0 = fuel cut-off, 0.5 = ground idle detent, 1 = flight (N2 governor on).
 *                         Between 0.5 and 1 the fuel control caps gas-generator speed (twist grip).
 *   rotorBrake   0..1     only effective below 40 % rotor speed
 *   startEngine({quick, autoThrottle}) engages the starter; with autoThrottle (default true) the
 *   model moves the throttle itself: idle at light-off, flight when ground idle is stable.
 *   cutEngine() closes the throttle (fuel off): the freewheel lets the rotor autorotate.
 *
 * STEP:  heli.step(dt) with the frame time in seconds. Internally the model runs fixed sub-steps of
 *   1/SUBSTEP_HZ (default 480 Hz, i.e. 8 per 60 Hz frame) and keeps the remainder for the next call;
 *   dt above 0.1 s is clipped (a stalled tab does not explode the body). heli.state is refreshed
 *   after every call. Deterministic: same inputs and dt sequence -> same result.
 *   The ground comes from opts.groundAt(x, z) in world coordinates. It returns either a number
 *   (height, flat normal) or {height, normal: [nx, ny, nz], friction?} (friction scales the
 *   skid friction coefficients; 1 = dry concrete).
 *
 * WHAT IS PHYSICAL AND WHAT IS APPROXIMATED (details over each block and in notes/H1_log_entry.md):
 *   Physical: 6-DOF rigid body (semi-implicit Euler, quaternion attitude, gyroscopic term); rotor speed
 *   from a torque balance on the rotor inertia (engine through a freewheel, main rotor aero torque,
 *   tail rotor and accessory drive); main and tail rotor thrust from blade-element theory with uniform
 *   inflow; induced velocity from momentum theory (Glauert) with a first-order dynamic-inflow lag;
 *   power from thrust x (induced + climb) inflow plus profile power; translational lift, climb and
 *   descent power and autorotation fall out of that; Cheeseman-Bennett ground effect; tip-path-plane
 *   tilt with a first-order flapping lag (16/(gamma Omega)) driven by cyclic, flapback with speed,
 *   pitch/roll-rate lag and gyroscopic cross terms; hub moment from hinge offset plus thrust tilt;
 *   coning from thrust against centrifugal stiffness; fin, stabiliser and fuselage elements in their
 *   local airflow (with rotor wake); skid contact points with spring, damper and anchored friction.
 *   Approximated (empirical fits, stated): vortex-ring induced velocity (Leishman's measured curve)
 *   plus a ring state that re-ingests inflow; lateral tilt toward the advancing side as
 *   (4/3) mu beta0 (coning) + tan(chi/2) lambda_i (transverse flow, Coleman Kx); retreating-blade
 *   stall as a soft cap on CT/sigma that falls with mu, adds drag and pitches up / rolls left;
 *   compressibility as a profile-drag rise above advancing tip Mach 0.86; engine as a gas-generator
 *   speed lag with a power map and a PI governor with collective anticipation.
 *   Not modelled: blade lead-lag, ground resonance, rotor wake on the tail rotor, fuel burn,
 *   flexible airframe, rotor-blade strike damage (only flagged).
 * ---------------------------------------------------------------------------------------------
 */

const D2R = Math.PI / 180;
const G0 = 9.80665;

/* =============================================================================================
 * CONSTANTS. Geometry from utility_helicopter_specs.json and the Blender build scripts
 * (utility_helicopter/source/hb/gear.py, empennage.py), converted to glTF axes (x, z_up, -y).
 * Masses, inertias, aerodynamic and engine numbers are estimates for a 2.2 to 2.5 t single-turbine
 * four-blade light utility helicopter (Bell 407 / H125 / H130 class), stated where they come from.
 * ============================================================================================= */
export const HELI = {
  // ---- mass properties --------------------------------------------------------------------
  massDefault: 2200,          // kg, typical mission mass (empty ~1350 + pilot, 3 pax, fuel)
  massMax: 2500,              // kg, concept max take-off mass (specs.json)
  massEmpty: 1350,            // kg, estimate (H125: 1170, Bell 407: 1210, ours is 4-bladed and longer)
  cg: [0.0, 1.25, 0.02],      // m, body frame. Under the mast (y 3.02) by 1.77 m, 2 cm aft: light
                              // singles fly with the CG within +-10 cm of the mast.
  // Inertia about the CG, body axes, at 2200 kg (kg m^2). Estimated from mass distribution
  // (fuselage 10.5 m with a 6.9 m tail arm, engine and gearbox high under the mast) and checked
  // against published values for the class (H125 roughly Ixx_roll 1600, Iyy_pitch 5500, Izz_yaw 4600).
  inertia: [6000, 5200, 1800], // [about X = pitch, about Y = yaw, about Z = roll]
  inertiaPerKg: 0.25,          // fraction of inertia that scales with mass (payload sits near the CG)

  // ---- main rotor -------------------------------------------------------------------------
  main: {
    R: 5.5,                   // m (specs: 11.0 m diameter)
    blades: 4,
    chord: 0.28,              // m, gives solidity 0.065 (Bell 407 0.07, H125 0.063)
    hub: [0.0, 3.02, 0.0],    // main_rotor_pivot, body frame
    mastTilt: 4.0 * D2R,      // shaft tilted forward (class: 3 to 5 deg)
    twist: -10.0 * D2R,       // linear blade twist root to tip
    liftSlope: 5.7,           // per rad, 2-D section with tip and Mach losses folded in
    cd0: 0.008,               // profile drag coefficient (NACA 0012-class blade at low lift)
    kappa: 1.10,              // induced power factor (non-uniform inflow, tip loss)
    rpm100: 390,              // 100 % Nr (task: governor 385 to 395); tip speed 224.6 m/s
    bladeMass: 32,            // kg per blade (composite, 5.3 m span)
    hingeOffset: 0.05,        // e/R, effective flapping hinge offset (soft-in-plane / starflex class)
    flapSpring: 2000,         // N m/rad per blade, elastomeric bearing stiffness
    hubDrag: 0.30,            // m^2 flat-plate drag of hub and mast fairing
    inertiaPolar: 1400,       // kg m^2: 4 blades (4 x 32 x 5.5^2 / 3 = 1291) + hub + drive train
    theta75Min: 0.5 * D2R,    // blade pitch at 75 % radius on the low stop (set for autorotation rpm)
    theta75Max: 15.0 * D2R,   // high stop
    cyclicLong: 12.0 * D2R,   // full stick forward/aft tilts the control plane by this much
    cyclicLat: 7.0 * D2R,     // full stick left/right
    inflowLag: 0.08,          // s, dynamic inflow time constant (Pitt-Peters hover value 0.85/(4 lambda Omega))
    // blade stall: thrust coefficient over solidity limit against advance ratio (McHugh-style boundary)
    stallCtSigma0: 0.125,
    stallCtSigmaSlope: 0.12,
    machDrag: 0.86,           // advancing tip Mach where the drag rise starts
    vortexRingLoss: 0.10,     // thrust fluctuation share in a fully developed vortex ring (empirical)
  },

  // ---- tail rotor (tail_rotor_pivot, on the left of the fin, thrust to +X in the hover) ------
  tail: {
    R: 0.785,                 // m (specs: 1.57 m)
    blades: 4,
    chord: 0.095,             // m, solidity 0.154
    hub: [-0.265, 1.86, 6.90],
    gear: 6.54,               // tail rotor / main rotor speed: 2551 rpm, tip 210 m/s
    liftSlope: 5.7,
    cd0: 0.009,
    kappa: 1.15,
    twist: 0,
    pitchCentre: 6.0 * D2R,   // blade pitch with pedals centred
    pitchPerPedal: 14.0 * D2R,// full left pedal +20 deg (H1, kept: the left-pedal margin at full power)
    pitchPerPedalRight: 7.5 * D2R, // V2: full right pedal -1.5 deg (H1: -8); with yawDamping this brings
                              // the full-pedal hover yaw rates from 204 / 152 to about 120 / 91 deg/s
    inflowLag: 0.04,
  },

  // ---- engine and drive ---------------------------------------------------------------------
  engine: {
    powerMaxSL: 560e3,        // W, thermodynamic shaft power at Ng 100 %, ISA sea level (~750 shp)
    powerRated: 520e3,        // W, transmission take-off rating = 100 % torque at 100 % Nr (~700 shp;
                              // Bell 407 gearbox 674 shp, H125 B3e about 700+)
    powerMaxCont: 468e3,      // W, maximum continuous (90 % torque)
    densityLapse: 0.85,       // P_max ~ (rho/rho0)^0.85
    // gas-generator speed (%) -> fraction of powerMaxSL, a free-turbine power map
    ngTable: [[0, 0], [20, 0], [30, 0.02], [40, 0.05], [50, 0.085], [60, 0.12], [70, 0.20],
              [80, 0.34], [90, 0.58], [100, 1.0], [105, 1.16]],
    ngIdle: 60,               // % ground idle
    ngMax: 104,               // % top of the fuel schedule
    ngLightOff: 12,           // % starter speed at which fuel is lit
    ngStarterOut: 56,         // % starter drops out
    starterRate: 3.0,         // %/s cranking
    startAccel: 2.5,          // %/s light-off to idle (temperature-limited start schedule)
    govRefRate: 8,            // %/s: governor reference ramps up to 100 % Nr when the throttle goes to flight
    accelLimit: 15,           // %/s gas-generator acceleration limit above idle
    decelLimit: 25,           // %/s
    ngLag: 0.40,              // s, gas-generator first-order response
    govKp: 3.0,               // %Ng per %Nr
    govKi: 2.0,               // %Ng per %Nr per s
    quickFactor: 6,           // quick-start option: start schedule this many times faster
    efficiency: 0.97,         // gearbox
    accessoryPower: 8e3,      // W at 100 % Nr (hydraulics, generator, oil cooler fan)
    flatPitchPower: 110e3,    // W, governor collective-anticipator estimate at low pitch
  },

  // ---- airframe aerodynamics ----------------------------------------------------------------
  airframe: {
    // equivalent flat-plate areas (m^2) along body axes; parasite drag of the class is 1.2 to 1.5 m^2
    // cabin and tail boom are separate drag elements, each in its local airflow (so they also damp
    // yaw and pitch rates): cabin side/vertical, tail boom + engine cowl side/vertical
    cdaForward: 1.15, cpForward: [0, 1.40, 0.0],
    cabin: { side: 5.0, vertical: 5.0, pos: [0, 1.35, 0.2] },
    boom: { side: 2.5, vertical: 2.0, pos: [0, 1.55, 4.6] },
    // (V2) the tail boom and cowl as stations along the boom when set (a single point at 4.6 m under-
    // weights the r^3 of yaw-rate drag); null keeps the H1 single element
    boomStations: null,
    yawDamping: 1850,         // N m s/rad (V2, empirical: see the airframe block); hover Nr -0.33 -> -0.69 /s
    downwashOnFuselage: 1.25, // x induced velocity reaching the cabin roof in the hover
    // horizontal stabiliser (stabilizer_L/R): span 2.3 m, mean chord 0.41 m
    stab: { area: 0.95, pos: [0, 1.795, 5.60], slope: 3.8, stall: 16 * D2R, cd0: 0.02, incidence: 1.0 * D2R },
    // vertical fin, upper + ventral: about 1.1 m^2, cambered/toed to offload the tail rotor in cruise
    fin: { area: 1.10, pos: [0, 2.10, 6.75], slope: 2.6, stall: 18 * D2R, cd0: 0.02, incidence: 3.0 * D2R },
  },

  // ---- landing gear -------------------------------------------------------------------------
  gear: {
    // Skid shoes from hb/gear.py: tubes at x = +-1.1, from z = +1.62 (aft) to z = -2.12, toe arc
    // up to (z -2.52, y 0.145). Shoe bottom at y = 0.
    skidX: 1.1,
    skidZ: [1.62, 0.90, 0.0, -1.45, -2.12],
    toe: [-2.52, 0.145],
    k: 40000,                 // N/m per contact point (10 shoe points: 400 kN/m, 5.4 cm static deflection)
    cCompress: 3000,          // N s/m per point (about 0.7 of critical, no bounce on a gentle set-down)
    cRebound: 4000,
    kT: 40000,                // N/m tangential (friction anchor spring)
    cT: 3000,
    muLong: 0.40,             // skid along its tube (steel shoe on concrete, sliding)
    muSide: 0.65,             // across the tube: the shoe edge digs in
    hullMu: 0.5,
  },

  SUBSTEP_HZ: 480,
  VNE_KMH: 260,               // placard never-exceed (indicated); see report for where the model's limits fall
  NR_LOW: 95, NR_HIGH: 107, NR_HIGH_POWER_OFF: 110, TORQUE_LIMIT: 100,
};

/* =============================================================================================
 * Small vector / quaternion helpers. Vectors are [x, y, z]; quaternions [w, x, y, z].
 * ============================================================================================= */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a); return l > 1e-12 ? scl(a, 1 / l) : [0, 0, 0]; };
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

function qMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
function qNorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
function qAxisAngle(ax, ang) { const s = Math.sin(ang / 2); const n = norm(ax); return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s]; }
function qMat(q) {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
          2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
          2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mtv = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Heading/pitch/bank from a body->world quaternion [w,x,y,z]. Heading 0 = nose toward world -Z,
 *  positive turning right (toward +X). Pitch positive nose up. Bank positive right side down. */
export function eulerFromQuat(q) {
  const m = qMat(q);
  const f = [-m[2], -m[5], -m[8]], r = [m[0], m[3], m[6]], u = [m[1], m[4], m[7]];
  return { heading: Math.atan2(f[0], -f[2]), pitch: Math.asin(clamp(f[1], -1, 1)), bank: Math.atan2(-r[1], u[1]) };
}
/** Quaternion [w,x,y,z] for heading/pitch/bank as above (applied yaw, then pitch, then bank). */
export function quatFromEuler(heading, pitch = 0, bank = 0) {
  const qy = qAxisAngle([0, 1, 0], -heading);
  const qp = qAxisAngle([1, 0, 0], pitch);
  const qr = qAxisAngle([0, 0, 1], -bank);
  return qNorm(qMul(qMul(qy, qp), qr));
}

/* ---- ISA atmosphere ---------------------------------------------------------------------- */
export function atmosphere(alt, dT = 0) {
  const h = clamp(alt, -500, 11000);
  const T = 288.15 - 0.0065 * h + dT;
  const p = 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return { rho: p / (287.053 * T), T, a: Math.sqrt(1.4 * 287.053 * T) };
}

function tableLookup(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  const n = tab.length; const [x0, y0] = tab[n - 2], [x1, y1] = tab[n - 1];
  return y1 + (y1 - y0) * (x - x1) / (x1 - x0);
}
function tableInverse(tab, y) {
  for (let i = 1; i < tab.length; i++) {
    if (y <= tab[i][1]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y1 > y0 ? x0 + (x1 - x0) * (y - y0) / (y1 - y0) : x1; }
  }
  return tab[tab.length - 1][0];
}

/* =============================================================================================
 * Induced velocity (momentum theory).
 *  T: thrust (N), Vn: velocity of the disc along its normal relative to the air (climb +, m/s),
 *  Ve: edgewise speed. Returns the uniform induced velocity (m/s, down through the disc).
 *  - Climb, hover, forward flight and descent in forward flight: Glauert's formula
 *        vi = vh^2 / sqrt(Ve^2 + (Vn + vi)^2), solved by Newton (normal working state).
 *  - Axial descent at low edgewise speed: the momentum solution does not exist between
 *    Vn = 0 and Vn = -2 vh (vortex ring / turbulent wake). There the measured curve fitted by
 *    Leishman (Principles of Helicopter Aerodynamics, eq. 3.?: vi/vh = k + k1 x + ... + k4 x^4,
 *    x = Vn/vh) is used, and the windmill-brake momentum branch below -2 vh. Blended into Glauert as
 *    the edgewise speed rises past 1.2 vh.
 * ============================================================================================= */
function inducedVelocity(T, rho, A, Vn, Ve) {
  const sgn = T >= 0 ? 1 : -1;
  const vh = Math.sqrt(Math.abs(T) / (2 * rho * A));
  if (vh < 1e-3) return 0;
  const x = Vn / vh, ve = Ve / vh;
  let ax;
  if (x >= 0) ax = -x / 2 + Math.sqrt(x * x / 4 + 1);
  else if (x <= -2) ax = -x / 2 - Math.sqrt(x * x / 4 - 1);
  else ax = 1 + x * (-1.125 + x * (-1.372 + x * (-1.718 + x * -0.655)));
  const w = x < 0 ? Math.pow(Math.max(0, 1 - ve / 1.2), 2) : 0;
  let v = ax;
  if (w < 1) {
    // start on the branch nearest the physical one: windmill side in steep descent, else hover side
    v = x < 0 ? Math.min(1 / Math.sqrt(ve * ve + x * x), ax) : ax / Math.sqrt(1 + ve * ve);
    for (let i = 0; i < 30; i++) {
      const s = x + v; const u = Math.sqrt(ve * ve + s * s);
      const f = v * u - 1; const df = u + v * s / u;
      if (Math.abs(f) < 1e-7) break;
      if (df > 0.05) v = Math.max(1e-4, v - clamp(f / df, -0.5, 0.5));
      else v = 0.5 * v + 0.5 / u;
    }
  }
  return sgn * vh * (w * ax + (1 - w) * v);
}

/* ---- aerofoil surface (stabiliser, fin): linear lift to stall, flat plate beyond ----------- */
function surfaceForce(flow, N, C, s, rho) {
  // flow: air velocity relative to the surface (body frame); N: lift normal; C: chord direction (aft)
  const V2 = dot(flow, flow);
  if (V2 < 1e-6) return [0, 0, 0];
  const V = Math.sqrt(V2); const fh = scl(flow, 1 / V);
  const q = 0.5 * rho * V2 * s.area;
  const alpha = wrapPi(Math.atan2(dot(flow, N), dot(flow, C)) + s.incidence);
  const aa = Math.abs(alpha);
  // linear regime
  let Fl = [0, 0, 0];
  if (aa < Math.PI / 2) {
    const Np = norm(sub(N, scl(fh, dot(N, fh))));
    const al = clamp(alpha, -s.stall - 0.3, s.stall + 0.3);
    Fl = add(scl(Np, q * s.slope * al), scl(fh, q * (s.cd0 + 0.5 * al * al)));
  }
  // flat plate: normal force along N
  const Fp = add(scl(N, q * 1.2 * Math.sin(alpha)), scl(fh, q * s.cd0));
  const t = aa < Math.PI / 2 ? smooth(s.stall, s.stall + 0.25, aa) : 1;
  return add(scl(Fl, 1 - t), scl(Fp, t));
}

/* =============================================================================================
 * The aircraft
 * ============================================================================================= */
export class Helicopter {
  constructor(opts = {}) {
    this.opts = opts;
    this.groundAt = opts.groundAt || (() => 0);
    // (V2) optional obstacles (buildings, barriers): obstacleAt(x, y, z) -> null or {depth, normal: [x, y, z]}
    // for a world point inside one; the hull and skid points are pushed out along the normal, and the
    // rotor tips are tested against it for a strike (state.flags.rotorStrike, state.strike).
    this.obstacleAt = opts.obstacleAt || null;
    this.seaLevelY = opts.seaLevelY || 0;
    this.isaDeltaT = opts.isaDeltaT || 0;
    this.wind = opts.wind ? opts.wind.slice() : [0, 0, 0];
    this.substepHz = opts.substepHz || HELI.SUBSTEP_HZ;
    this.h = 1 / this.substepHz;
    this.controls = { collective: 0, cyclicPitch: 0, cyclicRoll: 0, pedal: 0, throttle: 0, rotorBrake: 0 };
    this._buildContacts();
    this.reset(opts);
  }

  /** Re-place the aircraft. opts: position [x,y,z] of helicopter_root (default: on the ground at
   *  0,0), heading (rad), velocity [x,y,z], mass, running ('cold' | 'idle' | 'flight'), inAir. */
  reset(opts = {}) {
    const H = HELI;
    this.time = 0; this._acc = 0;
    this.setMass(opts.mass || this.mass || H.massDefault);
    const heading = opts.heading || 0;
    this.q = opts.quaternion ? opts.quaternion.slice() : quatFromEuler(heading, opts.pitch || 0, opts.bank || 0);
    let root = opts.position ? opts.position.slice() : null;
    if (!root) { const g = this._ground(0, 0); root = [0, g.h - (this.mass * G0) / (10 * H.gear.k), 0]; }
    const m = qMat(this.q);
    this.x = add(root, mv(m, H.cg));            // CG position, world
    this.v = opts.velocity ? opts.velocity.slice() : [0, 0, 0];
    this.w = opts.angularVelocity ? opts.angularVelocity.slice() : [0, 0, 0]; // body
    const running = opts.running || 'cold';
    const rp = H.main.rpm100 * 2 * Math.PI / 60;
    this.Omega0 = rp;
    this.Omega = running === 'flight' ? rp : running === 'idle' ? 0.72 * rp : 0;
    this.psi = 0; this.psiT = 0;
    this.ng = running === 'flight' ? 75 : running === 'idle' ? H.engine.ngIdle : 0;
    this.lit = running !== 'cold';
    this.starter = false; this.startMode = running === 'cold' ? 'off' : 'instant';
    this.autoThrottle = false; this._idleTimer = 0;
    this.govI = 0; this.govRef = running === 'flight' ? 100 : null; this._nrPrev = null;
    this.controls.throttle = running === 'flight' ? 1 : running === 'idle' ? 0.5 : 0;
    if (opts.controls) Object.assign(this.controls, opts.controls);
    if (running === 'flight') {
      // start the gas generator where the governor's collective anticipator puts it
      const E = H.engine, col = clamp(this.controls.collective, 0, 1);
      const pAnt = E.flatPitchPower + (E.powerRated * 0.75 - E.flatPitchPower) * Math.pow(col / 0.5, 1.5);
      const dens = Math.pow(atmosphere(this.x[1] - this.seaLevelY, this.isaDeltaT).rho / 1.225, E.densityLapse);
      this.ng = tableInverse(E.ngTable, clamp(pAnt / (E.powerMaxSL * dens), 0, 1.15));
    }
    this.vi = running === 'flight' && opts.inAir ? Math.sqrt(this.mass * G0 / (2 * 1.225 * Math.PI * H.main.R ** 2)) : 0;
    this.viT = 0; this.ring = 0;
    this.a1 = 0; this.b1 = 0;            // disc tilt relative to the shaft, rad (forward, right)
    this.coning = -0.036;
    for (const c of this.contacts) c.anchor = null;
    this.events = [];
    this._lastAccel = [0, 0, 0];
    this._out = {};
    this.state = {};
    this._updateState(0);
  }

  setMass(kg) {
    const H = HELI;
    this.mass = clamp(kg, H.massEmpty, H.massMax * 1.1);
    const s = 1 - H.inertiaPerKg + H.inertiaPerKg * this.mass / H.massDefault;
    this.I = H.inertia.map((i) => i * s);
  }

  setControls(c) { Object.assign(this.controls, c); }

  startEngine({ quick = false, autoThrottle = true } = {}) {
    if (this.lit && this.ng > 20) return;
    this.starter = true; this.startMode = quick ? 'quick' : 'normal';
    this.autoThrottle = autoThrottle; this._idleTimer = 0;
    this.events.push({ t: this.time, e: 'starter' });
  }
  cutEngine() { this.controls.throttle = 0; this.autoThrottle = false; this.starter = false; }

  _ground(x, z) {
    const g = this.groundAt(x, z);
    if (typeof g === 'number') return { h: g, n: [0, 1, 0], mu: 1 };
    return { h: g.height, n: g.normal ? norm(g.normal) : [0, 1, 0], mu: g.friction == null ? 1 : g.friction };
  }

  _buildContacts() {
    const g = HELI.gear;
    const pts = [];
    for (const side of [-1, 1]) {
      for (const z of g.skidZ) pts.push({ r: [side * g.skidX, 0, z], skid: side < 0 ? 'L' : 'R', k: g.k });
      pts.push({ r: [side * g.skidX, g.toe[1], g.toe[0]], skid: side < 0 ? 'L' : 'R', k: g.k });
    }
    // hull points (fuselage corners, tail bumper, fin, stabiliser tips): stop the body passing
    // through the ground after a roll-over or tail strike
    const hull = [[0.85, 0.55, -2.0], [-0.85, 0.55, -2.0], [0.85, 0.55, 1.2], [-0.85, 0.55, 1.2],
      [0.9, 2.2, -1.4], [-0.9, 2.2, -1.4], [0.75, 2.5, 0.6], [-0.75, 2.5, 0.6], [0, 0.9, -3.15],
      [0, 0.95, 7.0], [0, 2.96, 7.25], [1.2, 1.8, 5.6], [-1.2, 1.8, 5.6], [0, 1.3, 4.0]];
    for (const r of hull) pts.push({ r, skid: r[1] < 1 && Math.abs(r[2] - 7) < 0.1 ? 'tail' : 'hull', k: g.k * 1.5 });
    this.contacts = pts;
  }

  /** Advance by dt seconds of game time. */
  step(dt) {
    this._acc += Math.min(Math.max(dt, 0), 0.1);
    let n = 0;
    while (this._acc >= this.h - 1e-9) { this._substep(this.h); this._acc -= this.h; n++; }
    this._updateState(n);
    return this.state;
  }

  /* -------------------------------------------------------------------------------------------
   * One fixed sub-step.
   * ------------------------------------------------------------------------------------------- */
  _substep(h) {
    const H = HELI, M = H.main, TR = H.tail, E = H.engine, AF = H.airframe;
    const c = this.controls;
    const col = clamp(c.collective, 0, 1), cp = clamp(c.cyclicPitch, -1, 1), cr = clamp(c.cyclicRoll, -1, 1);
    const ped = clamp(c.pedal, -1, 1);
    const m = qMat(this.q);
    const cg = H.cg;
    const alt = this.x[1] - this.seaLevelY;
    const atm = atmosphere(alt, this.isaDeltaT);
    const rho = atm.rho;
    const vAirBody = mtv(m, sub(this.v, this.wind)); // velocity of CG relative to air, body frame
    const w = this.w;
    const Om = this.Omega, Om0 = this.Omega0, nr = Om / Om0;
    let F = [0, 0, 0];      // body-frame force (aero)
    let Mo = [0, 0, 0];     // body-frame moment about CG
    const pointVel = (rb) => add(vAirBody, cross(w, sub(rb, cg)));
    const applyAt = (f, rb) => { F = add(F, f); Mo = add(Mo, cross(sub(rb, cg), f)); };
    const out = this._out;

    /* ---------------- main rotor ---------------- */
    const R = M.R, A = Math.PI * R * R, sigma = M.blades * M.chord / (Math.PI * R);
    const OR = Math.max(Om * R, 1e-3);
    const s0 = [0, Math.cos(M.mastTilt), -Math.sin(M.mastTilt)];   // shaft
    const fP = [0, -Math.sin(M.mastTilt), -Math.cos(M.mastTilt)];  // forward, in the shaft plane
    const rP = [1, 0, 0];                                          // right, in the shaft plane
    const n = norm(add(add(s0, scl(fP, Math.tan(this.a1))), scl(rP, Math.tan(this.b1))));
    const vHub = pointVel(M.hub);
    const Vn = dot(vHub, n);
    const vEdge = sub(vHub, scl(n, Vn));
    const Ve = len(vEdge);
    const mu = Ve / OR;
    const spin = smooth(0.02, 0.15, nr);
    // ground effect (Cheeseman-Bennett) at the hub, fading with forward speed
    const hubW = add(this.x, mv(m, sub(M.hub, cg)));
    const gH = this._ground(hubW[0], hubW[2]);
    const zHub = Math.max(hubW[1] - gH.h, 0.1);
    const vhRef = Math.sqrt(this.mass * G0 / (2 * rho * A));
    const ge = Math.pow(R / (4 * Math.max(zHub, 0.55 * R)), 2) / (1 + Math.pow(Ve / (0.9 * vhRef), 2));
    const geFactor = 1 - ge;
    // blade element thrust, uniform inflow, linear twist
    const th75 = lerp(M.theta75Min, M.theta75Max, col);
    const th0 = th75 - 0.75 * M.twist;
    // vortex ring (empirical): a ring state builds while the descent rate is 0.2 to 1.9 x the hover
    // induced velocity and the edgewise speed is low; it decays when either condition goes. The ring
    // is modelled as extra inflow re-ingested through the disc, growing with how hard the blades pump
    // (blade pitch over the hover value): more collective feeds the ring, so thrust gained per unit of
    // collective collapses and power rises. A fixed thrust-loss share adds the measured roughness.
    const xD = -Vn / Math.max(vhRef, 1);                       // descent rate over hover induced velocity
    const band = smooth(0.2, 0.55, xD) * (1 - smooth(1.4, 2.0, xD));
    const edgeOk = 1 - smooth(0.35, 1.0, Ve / vhRef);
    const pump = clamp((th75 - 2 * D2R) / (5 * D2R), 0, 2.5);
    const ringTarget = band * edgeOk * spin;
    const ringTau = ringTarget > this.ring ? 1.0 : 2.0;
    this.ring += (ringTarget - this.ring) * h / ringTau;
    const ringInflow = this.ring * vhRef * clamp(0.25 + 2.0 * (pump - 1.2), 0.1, 1.4);
    const ringLoss = 1 - M.vortexRingLoss * this.ring * (0.6 + 0.4 * Math.sin(this.time * 7.3) * Math.sin(this.time * 2.1));
    const lam = (Vn + this.vi + ringInflow) / OR;
    const ctRaw = sigma * M.liftSlope / 2 * (th0 * (1 / 3 + mu * mu / 2) + M.twist / 4 * (1 + mu * mu) - lam / 2);
    // retreating blade stall: soft cap on CT/sigma, the excess raises profile drag and pitches up/rolls left
    const ctsLim = (M.stallCtSigma0 - M.stallCtSigmaSlope * clamp(mu, 0, 0.5));
    const cts = ctRaw / sigma;
    let ctsEff = cts, stallEx = 0;
    const k0 = 0.8 * ctsLim;
    if (cts > k0) { const d = cts - k0, span = ctsLim - k0 + 0.03; ctsEff = k0 + span * Math.tanh(d / span); stallEx = Math.tanh(Math.max(0, cts - ctsLim) / (0.25 * ctsLim)); }
    // compressibility: advancing tip Mach
    const machAdv = (OR + Ve) / atm.a;
    const dCdComp = machAdv > M.machDrag ? 6.0 * Math.pow(machAdv - M.machDrag, 2) + 40 * Math.pow(machAdv - M.machDrag, 3) : 0;
    const dCdStall = 0.012 * stallEx + 0.004 * Math.min(1, Math.max(0, cts - k0) / ctsLim);
    const Cd = M.cd0 + dCdComp + dCdStall;
    const qOR = rho * A * OR * OR;
    const T = ctsEff * sigma * qOR * spin * ringLoss;
    // dynamic inflow toward the momentum value
    const viT = inducedVelocity(T, rho, A, Vn, Ve) * geFactor;
    this.vi += (viT - this.vi) * Math.min(1, h / M.inflowLag);
    // power and torque
    const kap = M.kappa;
    const Pind = T * (kap * (this.vi + ringInflow) + Vn);
    const P0 = sigma * Cd / 8 * (1 + 2.65 * mu * mu) * rho * A * OR * OR * OR * spin;
    const Hf = sigma * Cd / 4 * rho * A * OR * Ve * spin;            // profile H-force (in-plane drag)
    const Qaero = (Pind + P0) / Math.max(Om, 1);
    // coning
    const Ib = M.bladeMass * R * R / 3;
    const coning = clamp((T / M.blades * 0.75 * R - M.bladeMass * G0 * R / 2) / (Ib * Om * Om + M.flapSpring + 1), -0.036, 0.2);
    this.coning = coning;
    // flapping: disc tilt follows the cyclic with a first-order lag, plus blowback, coning/transverse
    // flow lateral tilt toward the advancing side, rate-lag and gyroscopic cross terms, and stall
    const gamma = rho * M.liftSlope * M.chord * Math.pow(R, 4) / Ib;      // Lock number ~5.5
    const OmS = Math.max(Om, 2);
    const qUp = w[0], pRt = -w[2];
    const uf = dot(vEdge, fP), ur = dot(vEdge, rP);
    const lamI = this.vi / OR;
    const kBlow = (8 / 3 * th75 - 2 * lam) / (1 + 1.5 * mu * mu);
    const chi = Math.atan2(Ve, Math.max(Vn + this.vi, 0.1));             // wake skew
    const kAdv = (4 / 3) * coning / (1 + mu * mu / 2) + Math.tan(Math.min(chi, 1.4) / 2) * lamI / Math.max(mu, 1e-3) * 1.0;
    let a1T = M.cyclicLong * cp - kBlow * uf / OR - kAdv * ur / OR + (16 / gamma) * qUp / OmS + pRt / OmS;
    let b1T = M.cyclicLat * cr - kBlow * ur / OR + kAdv * uf / OR + qUp / OmS - (16 / gamma) * pRt / OmS;
    a1T -= 0.035 * stallEx; b1T -= 0.025 * stallEx;  // retreating-side stall: nose up, roll to the retreating (left) side
    const tauF = 16 / (gamma * OmS);
    this.a1 += (clamp(a1T, -0.35, 0.35) - this.a1) * Math.min(1, h / tauF);
    this.b1 += (clamp(b1T, -0.35, 0.35) - this.b1) * Math.min(1, h / tauF);
    // forces and moments on the airframe
    const eR = M.hingeOffset;
    const Khub = (M.blades / 2) * (1.5 * eR / (1 - eR) * Ib * Om * Om + M.flapSpring);
    const fMain = add(scl(n, T), Ve > 1e-3 ? scl(vEdge, -Hf / Ve) : [0, 0, 0]);
    applyAt(fMain, M.hub);
    Mo = add(Mo, scl(cross(s0, n), Khub));
    // VRS roughness: small rocking moments while the ring is strong
    if (this.ring > 0.05) {
      const r = this.ring * 2500;
      Mo = add(Mo, [r * Math.sin(this.time * 5.1 + 1), 0, r * Math.sin(this.time * 4.3)]);
    }

    /* ---------------- tail rotor ---------------- */
    const RT = TR.R, AT = Math.PI * RT * RT, sigT = TR.blades * TR.chord / (Math.PI * RT);
    const OmT = Om * TR.gear, ORT = Math.max(OmT * RT, 1e-3);
    const nT = [1, 0, 0];
    const vT = pointVel(TR.hub);
    const VnT = dot(vT, nT);
    const VeT = Math.hypot(vT[1], vT[2]);
    const muT = VeT / ORT;
    const thT = TR.pitchCentre - (ped > 0 && TR.pitchPerPedalRight != null ? TR.pitchPerPedalRight : TR.pitchPerPedal) * ped;
    const lamT = (VnT + this.viT) / ORT;
    const ctT = sigT * TR.liftSlope / 2 * (thT * (1 / 3 + muT * muT / 2) - lamT / 2);
    const ctsTLim = 0.14;                                           // tail rotor blade stall, soft cap
    const ctT2 = sigT * ctsTLim * Math.tanh(ctT / (sigT * ctsTLim));
    const TT = ctT2 * rho * AT * ORT * ORT * spin;
    const viTT = inducedVelocity(TT, rho, AT, Math.sign(TT || 1) * VnT, VeT);
    this.viT += (viTT - this.viT) * Math.min(1, h / TR.inflowLag);
    const PT = Math.abs(TT) * TR.kappa * Math.abs(this.viT) + TT * VnT + sigT * TR.cd0 / 8 * (1 + 4.65 * muT * muT) * rho * AT * ORT ** 3 * spin;
    applyAt(scl(nT, TT), TR.hub);

    /* ---------------- engine, governor, freewheel, rotor speed ---------------- */
    const th = clamp(c.throttle, 0, 1);
    const qf = this.startMode === 'quick' ? E.quickFactor : 1;
    if (this.starter) {
      if (!this.lit) this.ng = Math.min(this.ng + E.starterRate * qf * h, 22);
      if (!this.lit && this.ng >= E.ngLightOff) {
        if (this.autoThrottle && th < 0.5) c.throttle = 0.5;
        if (c.throttle > 0) { this.lit = true; this.events.push({ t: this.time, e: 'lightoff' }); }
      }
      if (this.ng >= E.ngStarterOut) { this.starter = false; this.events.push({ t: this.time, e: 'starterOut' }); }
    }
    if (c.throttle <= 0 && this.lit) { this.lit = false; this.events.push({ t: this.time, e: 'fuelOff' }); }
    const dens = Math.pow(rho / 1.225, E.densityLapse);
    let ngCmd = 0;
    if (this.lit) {
      if (c.throttle <= 0.5) { ngCmd = E.ngIdle; this.govI = 0; this.govRef = null; }
      else {
        const cap = lerp(E.ngIdle, E.ngMax, (c.throttle - 0.5) / 0.5);
        if (this.govRef == null) this.govRef = Math.min(100, 100 * nr);
        this.govRef = Math.min(100, this.govRef + E.govRefRate * qf * h);
        const e = (this.govRef - 100 * nr);
        const pAnt = E.flatPitchPower + (E.powerRated * 0.75 - E.flatPitchPower) * Math.pow(col / 0.5, 1.5);
        const ngFF = tableInverse(E.ngTable, clamp(pAnt / (E.powerMaxSL * dens), 0, 1.15));
        let cmd = ngFF + E.govKp * e + this.govI;
        if (cmd < cap && cmd > E.ngIdle - 5 && this.govRef >= 100) this.govI = clamp(this.govI + E.govKi * e * h, -40, 40);
        ngCmd = clamp(cmd, E.ngIdle - 5, cap);
      }
      // start schedule below idle, acceleration limit above
      let rate = (ngCmd - this.ng) / E.ngLag;
      const accel = this.ng < E.ngIdle - 0.5 ? E.startAccel * qf : E.accelLimit;
      rate = clamp(rate, -E.decelLimit, accel);
      if (this.starter && this.ng < E.ngIdle) rate = Math.max(rate, E.startAccel * qf * 0.5);
      this.ng += rate * h;
    } else if (!this.starter) {
      this.ng = Math.max(0, this.ng - this.ng * h / 3.0 - 0.5 * h); // spools down in ~10 s
    }
    if (this.autoThrottle && this.lit && !this.starter) {
      if (Math.abs(this.ng - E.ngIdle) < 1.0 && c.throttle <= 0.5) {
        // wait at ground idle until the rotor has stopped accelerating (or 15 s), as the checklist does
        this._idleTimer += h;
        const steady = this._nrPrev != null && (nr - this._nrPrev) / h < 0.004;
        if ((this._idleTimer > 2.0 / qf && (steady || nr > 0.55)) || this._idleTimer > 15 / qf) { c.throttle = 1; this.events.push({ t: this.time, e: 'throttleFly' }); }
      }
      this._nrPrev = nr;
      if (c.throttle >= 1 && nr > 0.99) { this.autoThrottle = false; this.events.push({ t: this.time, e: 'flightRpm' }); }
    }
    const pTh = this.lit ? E.powerMaxSL * dens * tableLookup(E.ngTable, this.ng) : 0;
    // free power turbine: torque falls linearly with N2, twice design torque at stall; freewheel: >= 0
    let Qeng = Math.max(0, pTh / Om0 * (2 - nr)) * E.efficiency;
    // QUICK START (game option, not physical): extra spin-up torque until the rotor first reaches flight rpm
    if (this.startMode === 'quick' && this.autoThrottle) Qeng *= E.quickFactor / 2;
    const Qacc = E.accessoryPower / Om0 * nr;                       // accessories: power ~ (Om/Om0)^2
    const QT = PT / Math.max(Om, 1);                                 // tail rotor drive torque at main shaft
    const brake = c.rotorBrake > 0 && nr < 0.4 ? c.rotorBrake * 3000 * Math.sign(Om) : 0;
    const Qm = Qeng - QT - Qacc * Math.min(1, nr * 5) - brake;     // torque in the main rotor shaft
    let dOm = (Qm - (Om > 0 ? Qaero : 0)) / M.inertiaPolar;
    this.Omega = Math.max(0, Om + dOm * h);
    if (this.Omega < 0.05 && Qm <= 0) this.Omega = 0;
    Mo = add(Mo, scl(s0, -Qm));                                       // reaction on the airframe
    this.psi = (this.psi + this.Omega * h) % (2 * Math.PI);
    this.psiT = (this.psiT + this.Omega * TR.gear * h) % (2 * Math.PI);

    /* ---------------- airframe aerodynamics ---------------- */
    // rotor wake reaching fuselage and stabiliser: skewed cylinder (wake skew chi)
    const tanChi = Math.tan(Math.min(chi, 1.52));
    const wakeAt = (rb) => {
      const d = M.hub[1] - rb[1];                  // depth below the disc
      if (d <= 0) return 0;
      const xa = rb[2] - M.hub[2];                 // aft distance (wake moves aft in forward flight)
      const ux = uf >= 0 ? xa : -xa;
      const c0 = d * tanChi;                       // wake centre displacement at that depth
      const off = Math.hypot(ux - c0, rb[0]);
      const rc = R * 0.92;
      return 1 - smooth(rc - 0.4, rc + 0.4, off);
    };
    const wakeV = scl(n, -this.vi * spin);         // air velocity in the far wake ~ 2 vi; scaled below
    {
      for (const el of (AF.boomStations ? [AF.cabin, ...AF.boomStations] : [AF.cabin, AF.boom])) {
        const ww = wakeAt(el.pos) * AF.downwashOnFuselage;
        const flowRel = sub(scl(wakeV, ww), pointVel(el.pos));   // air relative to this element
        const q = 0.5 * rho * len(flowRel);
        applyAt([q * el.side * flowRel[0], q * el.vertical * flowRel[1], 0], el.pos);
      }
      { const fr = scl(pointVel(AF.cpForward), -1); applyAt([0, 0, 0.5 * rho * len(fr) * AF.cdaForward * fr[2]], AF.cpForward); }
      // hub and mast drag, in the free stream
      const vh = pointVel(M.hub); const Vh = len(vh);
      applyAt(scl(vh, -0.5 * rho * Vh * M.hubDrag), M.hub);
    }
    const wsStab = wakeAt(AF.stab.pos) * 1.6;
    const fStab = surfaceForce(sub(scl(wakeV, wsStab), pointVel(AF.stab.pos)), [0, 1, 0], [0, 0, 1], AF.stab, rho);
    applyAt(fStab, AF.stab.pos);
    const fFin = surfaceForce(scl(pointVel(AF.fin.pos), -1), [1, 0, 0], [0, 0, 1], AF.fin, rho);
    applyAt(fFin, AF.fin.pos);
    // (V2, empirical) yaw damping the element model leaves out: the main-rotor wake and the tail
    // rotor's own wake on the fin and boom in a spot turn (H1 lists "rotor wake on the tail rotor" as
    // not modelled). Linear in the yaw rate, faded out with forward speed as the fin takes over.
    if (AF.yawDamping) Mo = add(Mo, [0, -AF.yawDamping * w[1] * spin * (1 - smooth(10, 30, Ve)), 0]);

    /* ---------------- gravity, ground, integration ---------------- */
    let Fw = mv(m, F);
    Fw[1] -= this.mass * G0;
    const r = this._contactForces(m, h);
    Fw = add(Fw, r.F);
    Mo = add(Mo, mtv(m, r.M));

    const acc = scl(Fw, 1 / this.mass);
    this.v = madd(this.v, acc, h);
    this.x = madd(this.x, this.v, h);
    const I = this.I;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    const dw = [(Mo[0] - gyro[0]) / I[0], (Mo[1] - gyro[1]) / I[1], (Mo[2] - gyro[2]) / I[2]];
    this.w = madd(w, dw, h);
    const wq = [0, this.w[0], this.w[1], this.w[2]];
    const dq = qMul(this.q, wq);
    this.q = qNorm([this.q[0] + 0.5 * dq[0] * h, this.q[1] + 0.5 * dq[1] * h, this.q[2] + 0.5 * dq[2] * h, this.q[3] + 0.5 * dq[3] * h]);
    this.time += h;

    // keep what the state needs
    Object.assign(out, {
      T, Tt: TT, Vn, Ve, ringInflow, mu, lam, ctsEff, stallEx, machAdv, rho, a: atm.a, alt, geFactor, ring: this.ring,
      Pmain: Pind + P0 + Hf * Ve, Ptail: PT, Qeng, Qm, Qaero, pTh, dens, contact: r.info, zHub,
      specific: mtv(m, sub(acc, [0, -G0, 0])), th75, thT, n, vhRef, viT, spin,
      fStab, fFin,
    });
  }

  _contactForces(m, h) {
    const H = HELI, g = H.gear;
    let F = [0, 0, 0], Mw = [0, 0, 0];
    const info = { L: 0, R: 0, LF: 0, RF: 0, other: 0, tail: 0, points: 0, slide: 0 };
    const wW = mv(m, this.w);
    const skidAxis = mv(m, [0, 0, 1]);
    for (const c of this.contacts) {
      const rw = mv(m, sub(c.r, H.cg));
      const p = add(this.x, rw);
      let gr = this._ground(p[0], p[2]);
      let nG = gr.n;
      let depth = (gr.h - p[1]) * nG[1];
      if (this.obstacleAt) {
        const ob = this.obstacleAt(p[0], p[1], p[2]);
        if (ob && ob.depth > Math.max(depth, 0)) { depth = ob.depth; nG = ob.normal; gr = { h: gr.h, n: nG, mu: 0.6 }; info.obstacle = (info.obstacle || 0) + 1; }
      }
      if (depth <= 0) { c.anchor = null; c.fn = 0; continue; }
      const vp = add(this.v, cross(wW, rw));
      const vn = dot(vp, nG);
      let Fn = c.k * depth - (vn < 0 ? g.cCompress : g.cRebound) * vn * (c.k / g.k);
      if (Fn < 0) Fn = 0;
      if (!c.anchor) c.anchor = p.slice();
      let d = sub(p, c.anchor); d = sub(d, scl(nG, dot(d, nG)));
      const vt = sub(vp, scl(nG, vn));
      let Ft = add(scl(d, -g.kT), scl(vt, -g.cT));
      const isSkid = c.skid === 'L' || c.skid === 'R';
      const muL = (isSkid ? g.muLong : H.gear.hullMu) * gr.mu, muS = (isSkid ? g.muSide : H.gear.hullMu) * gr.mu;
      let eL = sub(skidAxis, scl(nG, dot(skidAxis, nG)));
      eL = len(eL) > 1e-3 ? norm(eL) : [0, 0, 1];
      const eS = cross(nG, eL);
      const fl = dot(Ft, eL), fs = dot(Ft, eS);
      const ell = Math.pow(fl / (muL * Fn + 1e-9), 2) + Math.pow(fs / (muS * Fn + 1e-9), 2);
      if (ell > 1) {
        const k = 1 / Math.sqrt(ell);
        Ft = scl(Ft, k);
        c.anchor = add(p, scl(Ft, 1 / g.kT));
        info.slide++;
      }
      const f = add(scl(nG, Fn), Ft);
      F = add(F, f); Mw = add(Mw, cross(rw, f));
      c.fn = Fn;
      info.points++;
      if (c.skid === 'L') { info.L += Fn; info.LF += len(Ft); }
      else if (c.skid === 'R') { info.R += Fn; info.RF += len(Ft); }
      else if (c.skid === 'tail') info.tail += Fn;
      else info.other += Fn;
    }
    return { F, M: Mw, info };
  }

  /* -------------------------------------------------------------------------------------------
   * State for the game. Plain numbers; refreshed after every step().
   * ------------------------------------------------------------------------------------------- */
  _updateState(nSub) {
    const H = HELI, M = H.main, E = H.engine;
    const o = this._out;
    const m = qMat(this.q);
    const root = sub(this.x, mv(m, H.cg));
    const eul = eulerFromQuat(this.q);
    const nr = this.Omega / this.Omega0;
    const alt = this.x[1] - this.seaLevelY;
    const atm = atmosphere(alt, this.isaDeltaT);
    const vAir = sub(this.v, this.wind);
    const vAirB = mtv(m, vAir);
    const tas = len(vAir);
    const fwd = [-m[2], -m[5], -m[8]];
    const g0 = this._ground(root[0], root[2]);
    const pTh = this.lit ? E.powerMaxSL * Math.pow(atm.rho / 1.225, E.densityLapse) * tableLookup(E.ngTable, this.ng) : 0;
    const Pused = (o.Qeng || 0) / E.efficiency * this.Omega;   // engine output power
    const Pavail = Math.min(E.powerRated, E.powerMaxSL * Math.pow(atm.rho / 1.225, E.densityLapse) * tableLookup(E.ngTable, E.ngMax));
    const torquePct = 100 * (o.Qeng || 0) / E.efficiency / (E.powerRated / this.Omega0);
    const ci = o.contact || { L: 0, R: 0, LF: 0, RF: 0, other: 0, tail: 0, points: 0, slide: 0 };
    const ias = tas * Math.sqrt(atm.rho / 1.225);
    const spec = o.specific || [0, G0, 0];
    // rotor tip clearance at 8 azimuths
    let strike = false;
    this._strikeAt = null; this._strikeTail = false;
    const hub = add(root, mv(m, M.hub));
    const nW = mv(m, o.n || [0, 1, 0]);
    const e1 = norm(cross(nW, [0, 0, 1])), e2 = cross(nW, e1);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const tip = add(add(hub, scl(add(scl(e1, Math.cos(a)), scl(e2, Math.sin(a))), M.R * Math.cos(this.coning))), scl(nW, M.R * Math.sin(this.coning)));
      if (tip[1] < this._ground(tip[0], tip[2]).h + 0.05) { strike = true; this._strikeAt = tip; }
      if (this.obstacleAt) {
        // (V2) the disc against obstacles: the tip and the mid-span point of each of the 8 azimuths
        for (const f of [1, 0.6]) {
          const q = add(hub, scl(sub(tip, hub), f));
          if (this.obstacleAt(q[0], q[1], q[2])) { strike = true; this._strikeAt = q; }
        }
      }
    }
    // (V2) tail rotor disc against the ground and obstacles
    {
      const th = add(root, mv(m, H.tail.hub));
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        const q = add(th, mv(m, [0, Math.cos(a) * H.tail.R, Math.sin(a) * H.tail.R]));
        if (q[1] < this._ground(q[0], q[2]).h + 0.02 || (this.obstacleAt && this.obstacleAt(q[0], q[1], q[2]))) { strike = true; this._strikeAt = q; this._strikeTail = true; }
      }
    }
    const lowest = Math.min(...this.contacts.slice(0, 12).map((c) => { const p = add(root, mv(m, c.r)); return p[1] - this._ground(p[0], p[2]).h; }));
    const rpm = nr * M.rpm100;
    const s = this.state;
    Object.assign(s, {
      time: this.time,
      substeps: nSub,
      position: { x: root[0], y: root[1], z: root[2] },
      cgPosition: { x: this.x[0], y: this.x[1], z: this.x[2] },
      quaternion: { x: this.q[1], y: this.q[2], z: this.q[3], w: this.q[0] },
      heading: eul.heading, pitch: eul.pitch, bank: eul.bank,
      velocity: { x: this.v[0], y: this.v[1], z: this.v[2] },
      velocityBody: { x: vAirB[0], y: vAirB[1], z: vAirB[2] },       // relative to the air
      angularVelocity: { x: this.w[0], y: this.w[1], z: this.w[2] },
      rates: { pitchUp: this.w[0], yawRight: -this.w[1], rollRight: -this.w[2] },
      airspeed: tas, ias, groundSpeed: Math.hypot(this.v[0], this.v[2]),
      forwardSpeed: -vAirB[2], sideSpeed: vAirB[0],
      verticalSpeed: this.v[1],
      altitude: root[1] - this.seaLevelY,                            // of helicopter_root
      radarHeight: Math.max(0, root[1] - g0.h),
      skidClearance: lowest,
      loadFactor: spec[1] / G0,                                        // body-up specific force / g
      sideslip: Math.atan2(vAirB[0], Math.max(-vAirB[2], 0.5)),
      rotor: {
        rpm, percent: 100 * nr, omega: this.Omega, azimuth: this.psi,
        tailRpm: rpm * H.tail.gear, tailAzimuth: this.psiT,
        coning: this.coning, discTiltForward: this.a1, discTiltRight: this.b1,
        thrust: o.T || 0, tailThrust: o.Tt || 0, inducedVelocity: this.vi,
        advanceRatio: o.mu || 0, ctSigma: o.ctsEff || 0, advancingTipMach: o.machAdv || 0,
        groundEffect: 1 - (o.geFactor == null ? 1 : o.geFactor), vortexRing: this.ring,
        bladePitch75: o.th75 || 0, tailPitch: o.thT || 0,
        powerMain: o.Pmain || 0, powerTail: o.Ptail || 0,
      },
      engine: {
        state: !this.lit ? (this.starter ? 'cranking' : this.ng > 1 ? 'spooling down' : 'off')
          : this.starter ? 'starting' : this.controls.throttle <= 0.5 ? 'ground idle' : 'flight',
        startMode: this.startMode, ng: this.ng, lit: this.lit, starter: this.starter,
        torquePercent: torquePct, powerUsed: Pused, powerAvailable: Pavail,
        powerPercent: 100 * Pused / Pavail, powerThermo: pTh,
      },
      contact: {
        onGround: ci.points > 0, points: ci.points, sliding: ci.slide,
        leftSkid: { normal: ci.L, friction: ci.LF }, rightSkid: { normal: ci.R, friction: ci.RF },
        tail: ci.tail, hull: ci.other,
      },
      controls: { ...this.controls },
      flags: {
        vortexRing: this.ring > 0.3,
        overspeed: ias * 3.6 > H.VNE_KMH,
        lowRotor: nr * 100 < H.NR_LOW && (this.lit || nr > 0.5),
        rotorOverspeed: nr * 100 > (this.lit ? H.NR_HIGH : H.NR_HIGH_POWER_OFF),
        overtorque: torquePct > H.TORQUE_LIMIT,
        retreatingBladeStall: (o.stallEx || 0) > 0,
        compressibility: (o.machAdv || 0) > M.machDrag,
        rotorStrike: strike && nr > 0.1,
        obstacleContact: (ci.obstacle || 0) > 0,
        tailStrike: ci.tail > 0,
        quickStart: this.startMode === 'quick',
      },
      mass: this.mass,
      strikeAt: strike && this._strikeAt ? { x: this._strikeAt[0], y: this._strikeAt[1], z: this._strikeAt[2], tail: !!this._strikeTail } : null,
    });
    return s;
  }
}

export default Helicopter;
