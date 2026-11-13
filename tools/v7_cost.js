// (V7) What the pass's features cost a frame, measured as V4 did: in one page load, alternating blocks with the features
// on and off through src/perf.js's switches (demo.perf), each frame = demo.step(1/60) + demo.render() + the GPU done.
//   const C = await import('/tools/v7_cost.js');
//   C.ab('car', ['mirrors'], { blocks: 8, n: 30 }).then(r => window.__ab = r)
// cases as tools/v4_cost.js ('foot', 'car', 'cockpit', 'heli'); `flags`: the switches turned off in the "off" blocks
// (all of the pass's when omitted). Returns medians and p95 of the on and off frames, their difference, and the step,
// render-call and GPU-wait medians for each.
import { setupCase } from '/tools/v4_cost.js';

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const p95 = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
};
const r2 = (x) => +x.toFixed(2);
export const V7_FLAGS = ['mirrors', 'damage', 'terrain', 'flora', 'sky', 'furniture'];

export async function ab(kind = 'car', flags = V7_FLAGS, { blocks = 8, n = 30, warm = 20 } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const was = Object.fromEntries(flags.map((f) => [f, D.perf[f]]));
  const rows = { on: { frame: [], step: [], render: [], gpu: [], draws: [] }, off: { frame: [], step: [], render: [], gpu: [], draws: [] } };
  const res = (window.__ab = { kind, flags, done: false });
  try {
    setupCase(D, kind);
    const set = (on) => {
      for (const f of flags) D.perf[f] = on ? was[f] : false;
      if (D.applyPerf) D.applyPerf();
    };
    for (const on of [true, false]) {
      set(on);
      for (let i = 0; i < warm; i++) {
        D.step(1 / 60);
        D.render();
        await device.queue.onSubmittedWorkDone();
      }
    }
    for (let b = 0; b < blocks; b++) {
      const on = b % 2 === 0;
      set(on);
      // (two frames to let a switch settle, not counted)
      for (let i = 0; i < 2; i++) {
        D.step(1 / 60);
        D.render();
        await device.queue.onSubmittedWorkDone();
      }
      const r = rows[on ? 'on' : 'off'];
      for (let i = 0; i < n; i++) {
        D.renderer.info.reset();
        const t0 = performance.now();
        D.step(1 / 60);
        const t1 = performance.now();
        D.render();
        const t2 = performance.now();
        await device.queue.onSubmittedWorkDone();
        const t3 = performance.now();
        r.frame.push(t3 - t0);
        r.step.push(t1 - t0);
        r.render.push(t2 - t1);
        r.gpu.push(t3 - t2);
        r.draws.push(D.renderer.info.render.drawCalls);
      }
      await new Promise((ok) => setTimeout(ok, 100));
    }
    for (const k of ['on', 'off']) {
      const r = rows[k];
      res[k] = { median: r2(med(r.frame)), p95: r2(p95(r.frame)), step: r2(med(r.step)), render: r2(med(r.render)), gpu: r2(med(r.gpu)), draws: med(r.draws), frames: r.frame.length };
    }
    res.diff = r2(res.on.median - res.off.median);
    res.diffStep = r2(res.on.step - res.off.step);
    res.diffRender = r2(res.on.render - res.off.render);
    res.diffGpu = r2(res.on.gpu - res.off.gpu);
  } finally {
    for (const f of flags) D.perf[f] = was[f];
    if (D.applyPerf) D.applyPerf();
    D.carInput = null;
    D.heliInput = null;
    anim.setAnimationLoop(loop);
    res.done = true;
  }
  return res;
}
