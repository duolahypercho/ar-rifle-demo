// (V4) Frame cost in the four cases the pass is judged on, by the method of the main session's check:
// one frame = demo.step(1/60) + demo.render() + await device.queue.onSubmittedWorkDone(), at the canvas's
// backing size. In the page (load it with ?gputime for GPU timestamps per pass):
//   const C = await import('/tools/v4_cost.js'); C.run('car', 90).then(r => window.__c = r)
// cases: 'foot' (standing in the yard, the default third-person view), 'car' (the lap's main straight at speed,
// chase view), 'cockpit' (the same, cockpit view), 'heli' (100 m up at 150 km/h, chase view).
// Per frame: step (ms), render call (CPU ms), wait for the GPU (ms), whole frame; per render pass: exclusive CPU
// ms (the pass's own renderer.render call, nested passes taken out), draw calls, triangles and, with ?gputime,
// GPU ms from the pass's timestamps. Medians over the frames.
import { preset } from '/src/car/scenarios.js';
import { LINE } from '/src/track.js';

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const p95 = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
};
const r2 = (x) => +x.toFixed(2);

/** Wraps renderer.render and the backend's beginRender to attribute CPU time, draws and timestamps to passes. */
function instrument(D) {
  const R = D.renderer;
  const look = D.look;
  const stack = [];
  const frame = { cpu: {}, draws: {}, tris: {}, ctx: new Map() };
  const label = (scene, camera) => {
    const csm = look.csm;
    if (csm && csm.lights) {
      const i = csm.lights.findIndex((l) => l.shadow.camera === camera);
      if (i >= 0) return `shadow${i}`;
    }
    const rt = R.getRenderTarget();
    const n = look._nodes || {};
    if (n.pre && rt === n.pre.renderTarget) return 'pre';
    if (n.scenePass && rt === n.scenePass.renderTarget) return 'scene';
    if (!rt) return scene.isScene ? 'direct' : 'output';
    const name = (rt.texture && rt.texture.name) || 'rt';
    return name.replace(/\.?\d+$/, '') || 'rt';
  };
  const render = R.render;
  R.render = function (scene, camera) {
    const name = label(scene, camera);
    const t = performance.now();
    const d0 = R.info.render.drawCalls;
    const tr0 = R.info.render.triangles;
    stack.push({ name, child: 0, childDraws: 0, childTris: 0 });
    try {
      return render.call(this, scene, camera);
    } finally {
      const e = stack.pop();
      const dt = performance.now() - t;
      const dd = R.info.render.drawCalls - d0;
      const dtr = R.info.render.triangles - tr0;
      frame.cpu[name] = (frame.cpu[name] || 0) + dt - e.child;
      frame.draws[name] = (frame.draws[name] || 0) + dd - e.childDraws;
      frame.tris[name] = (frame.tris[name] || 0) + dtr - e.childTris;
      if (stack.length) {
        const top = stack[stack.length - 1];
        top.child += dt;
        top.childDraws += dd;
        top.childTris += dtr;
      }
    }
  };
  const be = R.backend;
  // (three 0.187 gives every pass descriptor the same timestampWrites object, so a reused descriptor writes its
  // timestamps to the indices of whichever pass allocated last: each pass gets its own copy here)
  const initTs = be.initTimestampQuery;
  be.initTimestampQuery = function (type, uid, descriptor) {
    initTs.call(this, type, uid, descriptor);
    if (descriptor.timestampWrites) descriptor.timestampWrites = { ...descriptor.timestampWrites };
  };
  const begin = be.beginRender;
  be.beginRender = function (rc) {
    if (stack.length) frame.ctx.set(rc.id, stack[stack.length - 1].name);
    return begin.call(this, rc);
  };
  return {
    frame,
    reset() {
      frame.cpu = {};
      frame.draws = {};
      frame.tris = {};
    },
    undo() {
      R.render = render;
      be.beginRender = begin;
      be.initTimestampQuery = initTs;
    },
  };
}

/** GPU ms per pass for the frame(s) since the last call (needs ?gputime); resolved every frame. */
async function gpuTimes(D, ctx) {
  const be = D.renderer.backend;
  const pool = be.timestampQueryPool && be.timestampQueryPool.render;
  if (!pool) return null;
  await pool.resolveQueriesAsync();
  const per = {};
  for (const [uid, ms] of pool.timestamps) {
    const m = uid.match(/:(\d+):f(\d+)$/);
    if (!m) continue;
    const name = ctx.get(+m[1]) || 'other';
    per[name] = (per[name] || 0) + ms;
  }
  return per;
}

/** Puts the game in one of the cases; returns a per-frame control function. */
export function setupCase(D, kind) {
  D.timeScale = 0;
  const v = D.vehicles;
  if (kind === 'foot') {
    // (the yard, the default third-person view, standing with the rifle; looks over the yard toward the berm)
    D.player.pos.set(0, 0, 4);
    D.player.vel.set(0, 0, 0);
    D.player.yaw = 0;
    D.player.pitch = -0.05;
    D.character.root.position.copy(D.player.pos);
    D.character.snapToGround && D.character.snapToGround();
    return () => {};
  }
  if (kind === 'car' || kind === 'cockpit') {
    D.seatInCar();
    const d = D.car.dyn;
    // on the main straight heading north, past the pit building, at 200 km/h
    d.reset(120, -100, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    preset(d, 200 / 3.6);
    v.carCams.mode = kind === 'cockpit' ? 1 : 0;
    v.carCams.started = false;
    // pure pursuit on the centre line, holding about 200 km/h
    let idx = 0;
    D.carInput = (dyn) => {
      const p = dyn.pos;
      let best = Infinity;
      for (let k = idx; k < idx + 60; k++) {
        const q = LINE[k % LINE.length];
        const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (dd < best) {
          best = dd;
          idx = k % LINE.length;
        }
      }
      const tgt = LINE[(idx + 18) % LINE.length];
      const f = { x: -Math.sin(dyn.yaw ?? 0), z: -Math.cos(dyn.yaw ?? 0) };
      const vel = Math.hypot(dyn.vel.x, dyn.vel.z);
      // heading from velocity when moving
      const hx = vel > 1 ? dyn.vel.x / vel : f.x;
      const hz = vel > 1 ? dyn.vel.z / vel : f.z;
      const dx = tgt.x - p.x;
      const dz = tgt.z - p.z;
      const cross = hx * dz - hz * dx; // + = target to the right? (x east, z south)
      const dot = hx * dx + hz * dz;
      const ang = Math.atan2(cross, dot);
      const want = 200 / 3.6;
      Object.assign(dyn.input, { throttle: vel < want ? 0.75 : 0.2, brake: 0, handbrake: 0, steer: 0, steerAngle: -ang * 0.35 });
    };
    return () => {};
  }
  if (kind === 'heli') {
    D.seatInHeli();
    const h = D.heli;
    // 100 m up at 150 km/h, from the helipad's side heading north over the yard toward the hangar
    h.fm.reset({ position: [-78, 100, 160], heading: 0, running: 'flight', inAir: true, velocity: [0, 0, -150 / 3.6], controls: { collective: 0.55, cyclicPitch: 0.2, pedal: -0.15 } });
    h.assist.reset(h.fm.state);
    v.heliCams.mode = 0;
    // (a plain altitude and speed hold on the collective and the cyclic for the few seconds measured)
    D.heliInput = (hh) => {
      const s = hh.fm.state;
      const vy = s.velocity ? s.velocity.y : 0;
      const kmh = (hh.speed || 0) * 3.6;
      hh.fm.setControls({ collective: Math.min(0.9, Math.max(0.2, 0.5 + 0.02 * (100 - s.position.y) - 0.08 * vy)), cyclicPitch: Math.max(-0.2, Math.min(0.5, 0.15 + 0.01 * (150 - kmh))), cyclicRoll: 0, pedal: -0.15 });
    };
    return () => {};
  }
  throw new Error('no case ' + kind);
}

export async function run(kind = 'car', n = 90, { warm = 30, loop = 'paused', rounds = 1, passes = true } = {}) {
  const D = window.demo;
  // (loop 'paused': the game's own animation loop is held while measuring, so each measured frame is one step and
  // one render; 'running' leaves it going, as the main session's measurement did: with timeScale 0 it draws an extra
  // frame whenever the browser asks for one while this one waits for the GPU)
  const anim = D.renderer._animation;
  const gameLoop = anim.getAnimationLoop();
  if (loop === 'paused') anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const res = (window.__cost = { kind, done: false, size: [D.renderer.domElement.width, D.renderer.domElement.height] });
  const drive = setupCase(D, kind);
  // (passes false: no wrapping of the renderer, for the headline numbers; rounds: blocks of n frames with a quarter
  // second between them, pooled, so a burst of load from another process lands in one block)
  const ins = passes ? instrument(D) : { frame: { cpu: {}, draws: {}, tris: {}, ctx: new Map() }, reset() {}, undo() {} };
  const rows = { step: [], renderCpu: [], gpuWait: [], frame: [], draws: [], tris: [] };
  const passCpu = {};
  const passDraws = {};
  const passTris = {};
  const passGpu = {};
  try {
    for (let i = 0; i < warm; i++) {
      D.step(1 / 60);
      D.render();
      await device.queue.onSubmittedWorkDone();
    }
    await gpuTimes(D, ins.frame.ctx); // (drop the warm-up's timestamps)
    for (let i = 0; i < n * rounds; i++) {
      if (i && i % n === 0) await new Promise((r) => setTimeout(r, 250));
      drive(i);
      ins.reset();
      if (loop === 'paused') D.renderer.info.reset();
      const t0 = performance.now();
      D.step(1 / 60);
      const t1 = performance.now();
      D.render();
      const t2 = performance.now();
      await device.queue.onSubmittedWorkDone();
      const t3 = performance.now();
      rows.step.push(t1 - t0);
      rows.renderCpu.push(t2 - t1);
      rows.gpuWait.push(t3 - t2);
      rows.frame.push(t3 - t0);
      rows.draws.push(D.renderer.info.render.drawCalls);
      rows.tris.push(D.renderer.info.render.triangles);
      for (const [k, x] of Object.entries(ins.frame.cpu)) (passCpu[k] = passCpu[k] || []).push(x);
      for (const [k, x] of Object.entries(ins.frame.draws)) (passDraws[k] = passDraws[k] || []).push(x);
      for (const [k, x] of Object.entries(ins.frame.tris)) (passTris[k] = passTris[k] || []).push(x);
      const g = passes ? await gpuTimes(D, ins.frame.ctx) : null;
      if (g) for (const [k, x] of Object.entries(g)) (passGpu[k] = passGpu[k] || []).push(x);
    }
    const gpu = Object.keys(passGpu).length ? Object.fromEntries(Object.entries(passGpu).map(([k, a]) => [k, med(a)])) : null;
    res.frame = { median: r2(med(rows.frame)), p95: r2(p95(rows.frame)), worst: r2(Math.max(...rows.frame)) };
    res.step = r2(med(rows.step));
    res.renderCpu = r2(med(rows.renderCpu));
    res.gpuWait = r2(med(rows.gpuWait));
    res.draws = med(rows.draws);
    res.tris = med(rows.tris);
    res.passes = {};
    for (const k of Object.keys(passCpu)) res.passes[k] = { cpu: r2(med(passCpu[k])), draws: med(passDraws[k]), tris: med(passTris[k]), gpu: gpu && gpu[k] != null ? r2(gpu[k]) : null };
    if (gpu) res.gpuTotal = r2(Object.values(gpu).reduce((a, b) => a + b, 0));
    if (kind === 'car' || kind === 'cockpit') res.kmh = Math.round(Math.hypot(D.car.dyn.vel.x, D.car.dyn.vel.z) * 3.6);
    if (kind === 'heli') res.heli = { y: Math.round(D.heli.fm.state.position.y), kmh: Math.round(D.heli.speed * 3.6) };
  } finally {
    ins.undo();
    D.carInput = null;
    D.heliInput = null;
    if (loop === 'paused') anim.setAnimationLoop(gameLoop);
    res.done = true;
  }
  return res;
}
