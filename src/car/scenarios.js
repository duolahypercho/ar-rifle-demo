// Test drives for the supercar (pass V1), pure (no Three.js): each is a controller that sets the
// car's input from the time and the car's state, and a measure that reads the car; the same
// scenario runs headless in Node (test/dynamics.test.js) and through the game's own frame loop
// (review.js: demo.vehicleReview()), where the driver, the cameras and the visuals run with it.
//
//   scenario = { name, place: { x, z, yaw }, setup(car), seconds, control(car, t, s), measure(car, t, s),
//                result(s) -> row, ground? (Node only: a test ground) }

const KMH = 3.6;
const G = 9.81;
const DEG = 180 / Math.PI;

const still = (car) => Object.assign(car.input, { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerAngle: null, shiftUp: false, shiftDown: false });

/** Yaw rate controller: road wheel angle that holds the car on a circle of `radius` (left +). */
function circleSteer(car, s, radius, h) {
  const v = Math.max(1, car.speed);
  const want = v / radius; // rad/s yaw rate
  const yaw = car.omega.y;
  s.ys = s.ys || 0;
  const err = want - yaw;
  s.ys += err * h;
  const ff = Math.atan(car.spec.wheelbase / radius);
  return Math.max(-0.5, Math.min(0.5, ff + 0.08 * err * 10 + 0.4 * s.ys));
}

/** Speed controller on the throttle (and brake). */
function holdSpeed(car, s, kmh, h) {
  const err = kmh / KMH - car.speed;
  s.vi = Math.max(-2, Math.min(2, (s.vi || 0) + err * h));
  const u = 0.25 * err + 0.3 * s.vi + 0.15;
  return u >= 0 ? { throttle: Math.min(1, u), brake: 0 } : { throttle: 0, brake: Math.min(1, -u * 0.5) };
}

export const SCENARIOS = {
  // full throttle from rest: 0-100, 0-200 and the shifts
  launch: {
    seconds: 12,
    control(car, t) {
      still(car);
      // launch control: brake and throttle held, the revs come up; let the brake go at 0
      car.input.throttle = t >= -0.6 ? 1 : 0;
      car.input.brake = t < 0 ? 1 : 0;
    },
    measure(car, t, s) {
      if (t < 0) return;
      const kmh = car.speed * KMH;
      if (!s.t100 && kmh >= 100) s.t100 = t;
      if (!s.t200 && kmh >= 200) s.t200 = t;
      if (!s.d100 && kmh >= 100) s.d100 = s.dist;
      s.dist = (s.dist || 0) + Math.max(0, car.speed) / 60;
      s.peakRpm = Math.max(s.peakRpm || 0, car.rpm);
      s.maxG = Math.max(s.maxG || 0, -car.accBody.z / G);
    },
    result(s, car) {
      const ups = car.shiftLog.filter((x) => x.to > x.from && x.from >= 2);
      return { t100: s.t100, t200: s.t200, d100: s.d100, peakRpm: s.peakRpm, launchG: s.maxG, shifts: ups.length, upshiftS: ups.length ? ups[0].time : null };
    },
  },
  // flat out until the speed stops rising
  topSpeed: {
    seconds: 70,
    control(car) {
      still(car);
      car.input.throttle = 1;
    },
    measure(car, t, s) {
      s.vmax = Math.max(s.vmax || 0, car.speed * KMH);
      s.gear = car.gearName;
      s.rpm = car.rpm;
    },
    result(s) {
      return { topKmh: s.vmax, gear: s.gear, rpm: s.rpm };
    },
  },
  // from 100 km/h, full brakes: stopping distance and peak deceleration; dive
  brake100: {
    seconds: 8,
    setup(car) {
      car._presetSpeed = 100 / KMH;
    },
    control(car, t, s) {
      still(car);
      if (t < 0) Object.assign(car.input, holdSpeed(car, s, 100, 1 / 60));
      else car.input.brake = 1;
    },
    measure(car, t, s) {
      if (t < 0) return;
      const v = car.speed;
      if (!s.done) {
        s.dist = (s.dist || 0) + Math.max(0, v) / 60;
        s.peak = Math.max(s.peak || 0, car.accBody.z / G);
        const a = car.attitude();
        s.dive = Math.min(s.dive || 0, a.pitch * DEG);
        if (t > 0.6) s.sumG = (s.sumG || 0) + car.accBody.z / G, (s.n = (s.n || 0) + 1);
        if (v < 0.05) s.done = t;
        s.v0 = s.v0 || v * KMH;
      }
    },
    result(s) {
      return { fromKmh: s.v0, stopM: s.dist, stopS: s.done, peakG: s.peak, meanG: s.sumG / s.n, diveDeg: -s.dive };
    },
  },
  // steady state on a circle at a speed: lateral g, roll per g, slip angles
  skidpad: {
    seconds: 14,
    radius: 65,
    kmh: 100,
    setup(car) {
      car._presetSpeed = this.kmh / KMH;
    },
    control(car, t, s) {
      still(car);
      const h = 1 / 60;
      car.input.steerAngle = circleSteer(car, s, this.radius, h);
      Object.assign(car.input, holdSpeed(car, s, this.kmh, h));
    },
    measure(car, t, s) {
      if (t < 8) return;
      const a = car.attitude();
      const lat = car.accBody.x / G; // + right
      s.n = (s.n || 0) + 1;
      s.lat = (s.lat || 0) + Math.abs(lat);
      s.roll = (s.roll || 0) + Math.abs(a.roll * DEG);
      s.kmh = (s.kmh || 0) + car.speed * KMH;
      s.yaw = (s.yaw || 0) + Math.abs(car.omega.y);
      s.af = (s.af || 0) + Math.abs(car.wheels[0].alpha + car.wheels[1].alpha) * 0.5 * DEG;
      s.ar = (s.ar || 0) + Math.abs(car.wheels[2].alpha + car.wheels[3].alpha) * 0.5 * DEG;
      s.steer = (s.steer || 0) + Math.abs(car.steerWheel) * DEG;
    },
    result(s) {
      const n = s.n || 1;
      const lat = s.lat / n;
      return { latG: lat, kmh: s.kmh / n, radiusM: (s.kmh / n / KMH) / (s.yaw / n), rollDeg: s.roll / n, rollPerG: s.roll / n / lat, alphaF: s.af / n, alphaR: s.ar / n, wheelDeg: s.steer / n };
    },
  },
  // the limit: speed raised slowly on the circle until it no longer holds the radius
  skidpadLimit: {
    seconds: 40,
    radius: 65,
    setup(car) {
      car._presetSpeed = 70 / KMH;
    },
    control(car, t, s) {
      still(car);
      const h = 1 / 60;
      car.input.steerAngle = circleSteer(car, s, this.radius, h);
      Object.assign(car.input, holdSpeed(car, s, 70 + Math.max(0, t) * 1.5, h));
    },
    measure(car, t, s) {
      const lat = Math.abs(car.accBody.x) / G;
      s.best = s.best || 0;
      // steady: a second's average
      s.win = s.win || [];
      s.win.push(lat);
      if (s.win.length > 60) s.win.shift();
      const avg = s.win.reduce((a, b) => a + b, 0) / s.win.length;
      if (avg > s.best) {
        s.best = avg;
        s.at = car.speed * KMH;
      }
    },
    result(s) {
      return { maxLatG: s.best, atKmh: s.at };
    },
  },
}

// the same, with downforce: a wide circle at 200 km/h
SCENARIOS.skidpad200 = { ...SCENARIOS.skidpadLimit, radius: 230, setup(car) { car._presetSpeed = 170 / KMH; }, control(car, t, s) { still(car); const h = 1 / 60; car.input.steerAngle = circleSteer(car, s, this.radius, h); Object.assign(car.input, holdSpeed(car, s, 170 + Math.max(0, t) * 2, h)); } };
// roll and pitch per g: a steady 0.8 g circle, and a 0.8 g brake
SCENARIOS.rollPitch = {
  seconds: 10,
  setup(car) { car._presetSpeed = 80 / KMH; },
  control(car, t, s) {
    still(car);
    const h = 1 / 60;
    if (t < 6) {
      car.input.steerAngle = circleSteer(car, s, 63, h);
      Object.assign(car.input, holdSpeed(car, s, 80, h));
    } else {
      car.input.steerAngle = 0;
      car.input.brake = 0.42;
    }
  },
  measure(car, t, s) {
    const a = car.attitude();
    if (t > 3 && t < 6) {
      s.n = (s.n || 0) + 1;
      s.lat = (s.lat || 0) + Math.abs(car.accBody.x / G);
      s.roll = (s.roll || 0) + Math.abs(a.roll * DEG);
    }
    if (t > 6.6 && t < 7.4 && car.speed > 3) {
      s.m = (s.m || 0) + 1;
      s.lon = (s.lon || 0) + car.accBody.z / G;
      s.pitch = (s.pitch || 0) - a.pitch * DEG;
    }
  },
  result(s) {
    return { latG: s.lat / s.n, rollPerG: s.roll / s.lat, lonG: s.lon / s.m, divePerG: s.pitch / s.lon };
  },
};
// a slalom: cones 18 m apart at 80 km/h, steered by a sine to the cones' phase
SCENARIOS.slalom = {
  seconds: 8,
  gap: 18,
  setup(car) { car._presetSpeed = 80 / KMH; },
  control(car, t, s) {
    still(car);
    const h = 1 / 60;
    Object.assign(car.input, holdSpeed(car, s, 80, h));
    const v = 80 / KMH;
    const w = (Math.PI * v) / this.gap; // a full left-right every two gaps
    car.input.steerAngle = t > 0 ? 0.055 * Math.sin(w * t) : 0;
  },
  measure(car, t, s) {
    if (t < 1) return;
    s.lat = Math.max(s.lat || 0, Math.abs(car.accBody.x / G));
    s.yaw = Math.max(s.yaw || 0, Math.abs(car.omega.y));
    s.rear = Math.max(s.rear || 0, Math.abs(car.wheels[2].alpha) * DEG);
    s.kmh = car.speed * KMH;
  },
  result(s) {
    return { peakLatG: s.lat, peakYawDegS: s.yaw * DEG, rearSlipDeg: s.rear, endKmh: s.kmh };
  },
};
// at the limit on the circle, the throttle snapped shut: how far the car tucks in (yaw rate up)
SCENARIOS.liftOff = {
  seconds: 7,
  setup(car) { car._presetSpeed = 95 / KMH; },
  control(car, t, s) {
    still(car);
    const h = 1 / 60;
    if (t < 4) {
      car.input.steerAngle = circleSteer(car, s, 60, h);
      Object.assign(car.input, holdSpeed(car, s, 95, h));
      s.hold = car.input.steerAngle;
    } else car.input.steerAngle = s.hold; // steering held, throttle off
  },
  measure(car, t, s) {
    if (t > 3 && t < 4) s.base = car.omega.y;
    if (t >= 4 && t < 6) {
      s.peak = Math.max(s.peak || 0, car.omega.y);
      s.rear = Math.max(s.rear || 0, Math.abs(car.wheels[2].alpha + car.wheels[3].alpha) * 0.5 * DEG);
      s.spun = s.spun || Math.abs(car.wheels[2].alpha) > 0.35;
    }
  },
  result(s) {
    return { yawBefore: s.base * DEG, yawPeak: s.peak * DEG, tuckPct: (100 * (s.peak - s.base)) / s.base, rearSlipDeg: s.rear, spun: !!s.spun };
  },
};
// second gear, a tight corner, floored: power oversteer (traction control off)
SCENARIOS.powerOver = {
  seconds: 5,
  setup(car) { car._presetSpeed = 50 / KMH; },
  control(car, t, s) {
    still(car);
    car.input.tc = false;
    const h = 1 / 60;
    if (t < 1.5) {
      car.input.steerAngle = circleSteer(car, s, 30, h);
      Object.assign(car.input, holdSpeed(car, s, 50, h));
      s.hold = car.input.steerAngle;
    } else {
      car.input.steerAngle = s.hold;
      car.input.throttle = 1;
    }
  },
  measure(car, t, s) {
    if (t < 1.5) return;
    s.rear = Math.max(s.rear || 0, Math.abs(car.wheels[2].alpha + car.wheels[3].alpha) * 0.5 * DEG);
    s.front = Math.max(s.front || 0, Math.abs(car.wheels[0].alpha + car.wheels[1].alpha) * 0.5 * DEG);
    s.kappa = Math.max(s.kappa || 0, car.wheels[3].kappa, car.wheels[2].kappa);
    s.yaw = Math.max(s.yaw || 0, car.omega.y * DEG);
  },
  result(s) {
    return { rearSlipDeg: s.rear, frontSlipDeg: s.front, rearKappa: s.kappa, yawDegS: s.yaw };
  },
};
// standing still: speed of the body once settled
SCENARIOS.standstill = {
  seconds: 6,
  control(car) { still(car); },
  measure(car, t, s) {
    if (t < 3) return;
    const v = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    s.v = Math.max(s.v || 0, v);
    s.w = Math.max(s.w || 0, Math.hypot(car.omega.x, car.omega.y, car.omega.z));
  },
  result(s) {
    return { maxMmS: s.v * 1000, maxDegS: s.w * DEG };
  },
};
// straight at 60, 120, 240 km/h: wheel surface speed against road speed (no slip expected but rolling)
SCENARIOS.wheelSpeed = {
  seconds: 12,
  setup(car) { car._presetSpeed = 60 / KMH; },
  control(car, t, s) {
    still(car);
    Object.assign(car.input, holdSpeed(car, s, t < 4 ? 60 : t < 8 ? 120 : 200, 1 / 60));
  },
  measure(car, t, s) {
    if (!(t > 3 && t < 4) && !(t > 7 && t < 8) && !(t > 11)) return;
    const v = car.speed;
    for (const w of car.wheels) s.err = Math.max(s.err || 0, Math.abs(w.omega * w.r - v) / v);
  },
  result(s) {
    return { worstPct: s.err * 100 };
  },
};
// a kerb strike: 60 km/h, the left wheels over a 5 cm kerb 3 m long (test ground: Node; the game's
// own kerb in review.js)
SCENARIOS.kerb = {
  seconds: 3,
  ground: {
    height(x, z, n) {
      if (n) { n.x = 0; n.y = 1; n.z = 0; }
      return x < -0.3 && x > -1.6 && z < -20 && z > -23 ? 0.05 : 0;
    },
    surface() { return { name: 'tarmac', grip: 1, roll: 1, dust: 0 }; },
    obstacles: [],
  },
  setup(car) { car._presetSpeed = 60 / KMH; },
  control(car, t, s) {
    still(car);
    Object.assign(car.input, holdSpeed(car, s, 60, 1 / 60));
    car.input.steerAngle = 0;
  },
  measure(car, t, s) {
    const a = car.attitude();
    s.roll = Math.max(s.roll || 0, Math.abs(a.roll * DEG));
    s.fz = Math.max(s.fz || 0, car.wheels[0].fz);
    s.air = s.air || 0;
    if (!car.wheels[0].contact) s.air += 1 / 60;
    s.travel = Math.min(s.travel || 0, car.wheels[0].x - car.wheels[0].xStatic);
    s.yaw = Math.max(s.yaw || 0, Math.abs(car.omega.y * DEG));
  },
  result(s) {
    return { rollDeg: s.roll, peakLoadN: s.fz, bumpCm: -s.travel * 100, airS: s.air, yawDegS: s.yaw };
  },
};

/** Runs a scenario on a car (headless): `step(car, dt)` advances it one 60 Hz frame. */
export function runScenario(car, scenario, { step = (c, dt) => c.update(dt), settle = 1.5, place = { x: 0, z: 0, yaw: 0 } } = {}) {
  const s = {};
  car.reset(place.x, place.z, place.yaw);
  car.shiftLog.length = 0;
  car._presetSpeed = 0;
  if (scenario.setup) scenario.setup.call(scenario, car);
  if (car._presetSpeed) preset(car, car._presetSpeed);
  const frames = Math.round((scenario.seconds + settle) * 60);
  for (let i = 0; i < frames; i++) {
    const t = i / 60 - settle;
    scenario.control.call(scenario, car, t, s);
    step(car, 1 / 60);
    scenario.measure.call(scenario, car, t, s);
  }
  return scenario.result.call(scenario, s, car);
}

/** Sets the car rolling straight ahead at `v` m/s, wheels turning with it, in the gear that suits. */
export function preset(car, v) {
  const f = car.forward;
  car.vel.x = f.x * v;
  car.vel.y = 0;
  car.vel.z = f.z * v;
  for (const w of car.wheels) {
    w.omega = v / w.r;
    w.u = w.s = 0;
  }
  // the gear an auto box would hold here
  let g = 2;
  const ratios = car.spec.gearbox.ratios;
  while (g < ratios.length - 1 && (v / car.wheels[2].r) * ratios[g] * car.spec.gearbox.final * (30 / Math.PI) > 6500) g++;
  car.gear = g;
  car.shift = null;
  car.engine.locked = true;
  car.engine.omega = (v / car.wheels[2].r) * ratios[g] * car.spec.gearbox.final;
  car.hold = 0;
}
