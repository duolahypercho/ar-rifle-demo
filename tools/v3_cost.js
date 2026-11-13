// (V3) Frame cost while driving and flying: in the page,
//   const C = await import('/tools/v3_cost.js'); C.run('car')  (background; window.__cost when done)
// Per frame (600 by default): the vehicle's physics (car.dyn.update / heli.fm.step, timed by wrapping them),
// the rest of the game's step (posing, cameras, sound, particles), the render call's CPU time, and the GPU
// (render submitted to the queue's work being done). Median and worst. Then 120 frames each with the sun's
// shadows off and with the plain picture (no post chain), to see what the GPU time is made of.
import { preset } from '/src/car/scenarios.js';

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { median: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), worst: +s[s.length - 1].toFixed(2) };
};

async function frames(n, drive) {
  const D = window.demo;
  const device = D.renderer.backend.device;
  const out = { physics: [], step: [], renderCpu: [], gpu: [], frame: [] };
  for (let i = 0; i < n; i++) {
    drive(i);
    D.__phys = 0;
    const t0 = performance.now();
    D.step(1 / 60);
    const t1 = performance.now();
    D.render();
    const t2 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t3 = performance.now();
    out.physics.push(D.__phys);
    out.step.push(t1 - t0 - D.__phys);
    out.renderCpu.push(t2 - t1);
    out.gpu.push(t3 - t2);
    out.frame.push(t3 - t0);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stats(v)]));
}

/** The same frames with V2's single sun shadow map (68 m box round the car, 4096) instead of the cascades. */
export async function runSingle(kind = 'car', n = 300) {
  const D = window.demo;
  const look = D.look;
  const sun = look.sun;
  sun.shadow.shadowNode = null;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -34;
  cam.right = cam.top = 34;
  cam.near = 1;
  cam.far = 221;
  cam.updateProjectionMatrix();
  const follow = look.follow;
  look.follow = function () {
    this.sky.position.copy(this.camera.position);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 34 * 3.2);
    this.sun.target.updateMatrixWorld();
  };
  D.scene.traverse((o) => {
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
  });
  try {
    return await run(kind, n, false);
  } finally {
    look.follow = follow;
    sun.shadow.shadowNode = look.csm;
    D.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }
}

export async function run(kind = 'car', n = 600, extra = true) {
  const D = window.demo;
  const res = (window.__cost = { kind, done: false, size: [D.renderer.domElement.width, D.renderer.domElement.height] });
  D.timeScale = 0;
  const wrap = (obj, name) => {
    const f = obj[name];
    obj[name] = function (...args) {
      const t = performance.now();
      const r = f.apply(this, args);
      D.__phys += performance.now() - t;
      return r;
    };
    return () => (obj[name] = f);
  };
  let unwrap;
  let drive;
  if (kind === 'car') {
    D.seatInCar();
    const d = D.car.dyn;
    d.reset(120, 60, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    preset(d, 50);
    D.vehicles.carCams.mode = 0;
    D.carInput = (dyn) => Object.assign(dyn.input, { throttle: 0.7, brake: 0, handbrake: 0, steer: 0, steerAngle: 0.01 });
    unwrap = wrap(d, 'update');
    drive = () => {};
  } else {
    D.seatInHeli();
    const h = D.heli;
    h.fm.reset({ position: [10, 60, 80], heading: 0, running: 'flight', inAir: true, velocity: [0, 0, -50], controls: { collective: 0.6, cyclicPitch: 0.3, pedal: -0.2 } });
    h.assist.reset(h.fm.state);
    D.vehicles.heliCams.mode = 0;
    unwrap = wrap(h.fm, 'step');
    drive = () => {};
  }
  try {
    await frames(30, drive); // (shaders compiled, warm)
    res.full = await frames(n, drive);
    if (!extra) return res;
    const sun = D.look.sun;
    sun.castShadow = false;
    res.noShadows = await frames(120, drive);
    sun.castShadow = true;
    D.look.quality = 'plain';
    res.plain = await frames(120, drive);
    D.look.quality = 'full';
    res.cascades = D.look.cascades;
  } finally {
    unwrap();
    D.carInput = null;
    res.done = true;
  }
  return res;
}
