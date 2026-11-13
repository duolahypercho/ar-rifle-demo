// (V8) Ablation in one page load: several named variants measured in round-robin blocks (same sitting), each frame =
// demo.step(1/60) + demo.render() + the GPU done (as tools/v4_cost.js and v7_cost.js).
//   const C = await import('/tools/v8_cost.js');
//   C.rr('foot', { base: () => {...}, grassOnly: () => {...} }, { blocks: 4, n: 20 }); // then poll window.__rr
// Each variant is a function that puts the page into that state (it is called before each of its blocks); `reset` (in
// opts) is called before each variant's function. Returns per variant the median / p95 frame, step, render call and GPU
// wait, and draw calls, plus the load average if the caller passes it in (it cannot be read from the page).
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

/**
 * The cases: v4_cost.js's ('foot', 'car', 'cockpit', 'heli') plus 'edge' (on foot at the yard's south edge, looking south
 * over the grass toward the tree belt: the brief's on-foot case for the scenery; the yard's own 'foot' view has no grass).
 */
export function setupEdge(D, kind) {
  if (kind !== 'edge' && kind !== 'field') return setupCase(D, kind);
  setupCase(D, 'foot');
  // (the yard's south edge looking south over the grass to the tree belt; 'field' 37 m further out, in the grass)
  D.player.pos.set(-20, 0, kind === 'edge' ? 138 : 175);
  D.player.yaw = Math.PI;
  D.player.camYaw = Math.PI;
  D.player.pitch = -0.08;
  D.player.camPitch = -0.08;
  D.character.root.position.copy(D.player.pos);
  D.character.snapToGround && D.character.snapToGround();
  // (the camera's spring needs game time to come round behind the player: a second of it, then held again)
  D.timeScale = 1;
  for (let i = 0; i < 60; i++) D.step(1 / 60);
  D.timeScale = 0;
  return () => {};
}

/**
 * Frame-interleaved: every round draws one frame of each variant in a shuffled order (after one unmeasured frame in
 * that state), so slow changes in the machine's load fall on all variants alike. Reports each variant's median, and
 * against `ref` (the first variant) the median of the per-round differences, with its spread (the quartiles) — the
 * noise floor is a second copy of the reference (an A/A pair).
 */
export async function inter(kind, variants, { rounds = 100, warm = 10, reset = null, setup = true, settle = 1 } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const names = Object.keys(variants);
  const rows = Object.fromEntries(names.map((k) => [k, { frame: [], gpu: [], render: [], step: [] }]));
  const res = (window.__rr = { kind, mode: 'inter', done: false, t0: new Date().toTimeString().slice(0, 8), rounds: 0 });
  const set = (k) => {
    if (reset) reset();
    variants[k]();
    if (D.applyPerf) D.applyPerf();
  };
  const frame = async (r) => {
    const t0 = performance.now();
    D.step(1 / 60);
    const t1 = performance.now();
    D.render();
    const t2 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t3 = performance.now();
    if (r) {
      r.frame.push(t3 - t0);
      r.step.push(t1 - t0);
      r.render.push(t2 - t1);
      r.gpu.push(t3 - t2);
    }
  };
  try {
    if (setup) setupEdge(D, kind);
    for (const k of names) {
      set(k);
      for (let i = 0; i < warm; i++) await frame(null);
    }
    for (let i = 0; i < rounds; i++) {
      const order = [...names].sort(() => Math.random() - 0.5);
      for (const k of order) {
        set(k);
        for (let s = 0; s < settle; s++) await frame(null);
        await frame(rows[k]);
      }
      res.rounds = i + 1;
    }
    const ref = names[0];
    for (const k of names) {
      const r = rows[k];
      const diffs = r.frame.map((v, i) => v - rows[ref].frame[i]).sort((a, b) => a - b);
      const q = (p) => diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * p))];
      const sf = [...r.frame].sort((a, b) => a - b);
      res[k] = { p10: r2(sf[Math.floor(sf.length * 0.1)]), p25: r2(sf[Math.floor(sf.length * 0.25)]), min: r2(sf[0]), median: r2(med(r.frame)), p95: r2(p95(r.frame)), step: r2(med(r.step)), render: r2(med(r.render)), gpu: r2(med(r.gpu)), dMed: r2(q(0.5)), dQ1: r2(q(0.25)), dQ3: r2(q(0.75)), frames: r.frame.length };
    }
  } catch (e) {
    res.error = String((e && e.stack) || e);
  } finally {
    if (reset) reset();
    if (D.applyPerf) D.applyPerf();
    D.carInput = null;
    D.heliInput = null;
    anim.setAnimationLoop(loop);
    res.done = true;
    res.t1 = new Date().toTimeString().slice(0, 8);
  }
  return res;
}

/** The result as lines (for reading back). */
export function lines(r = window.__rr) {
  return Object.entries(r).filter(([, v]) => v && v.median).map(([k, v]) => `${k}: ${v.p10 !== undefined ? `min ${v.min} p10 ${v.p10} p25 ${v.p25} ` : ''}med ${v.median}/${v.p95} gpu ${v.gpu} cpu ${v.render} step ${v.step}` + (v.dMed !== undefined ? ` | d ${v.dMed} [${v.dQ1}, ${v.dQ3}]` : '')).join('\n') + ` ${r.t0}-${r.t1} ${r.error || ''}`;
}

export async function rr(kind, variants, { blocks = 4, n = 20, warm = 10, reset = null, setup = true } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const names = Object.keys(variants);
  const rows = Object.fromEntries(names.map((k) => [k, { frame: [], step: [], render: [], gpu: [], draws: [], tris: [] }]));
  const res = (window.__rr = { kind, done: false, t0: new Date().toTimeString().slice(0, 8) });
  const frame = async (r) => {
    D.renderer.info.reset();
    const t0 = performance.now();
    D.step(1 / 60);
    const t1 = performance.now();
    D.render();
    const t2 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t3 = performance.now();
    if (r) {
      r.frame.push(t3 - t0);
      r.step.push(t1 - t0);
      r.render.push(t2 - t1);
      r.gpu.push(t3 - t2);
      r.draws.push(D.renderer.info.render.drawCalls);
      r.tris.push(D.renderer.info.render.triangles);
    }
  };
  try {
    if (setup) setupEdge(D, kind);
    const set = (k) => {
      if (reset) reset();
      variants[k]();
      if (D.applyPerf) D.applyPerf();
    };
    for (const k of names) {
      set(k);
      for (let i = 0; i < warm; i++) await frame(null);
    }
    for (let b = 0; b < blocks; b++) {
      for (const k of names) {
        set(k);
        for (let i = 0; i < 2; i++) await frame(null);
        for (let i = 0; i < n; i++) await frame(rows[k]);
        await new Promise((ok) => setTimeout(ok, 50));
      }
    }
    for (const k of names) {
      const r = rows[k];
      res[k] = { median: r2(med(r.frame)), p95: r2(p95(r.frame)), step: r2(med(r.step)), render: r2(med(r.render)), gpu: r2(med(r.gpu)), draws: med(r.draws), tris: med(r.tris), frames: r.frame.length };
    }
  } catch (e) {
    res.error = String(e && e.stack || e);
  } finally {
    if (reset) reset();
    if (D.applyPerf) D.applyPerf();
    D.carInput = null;
    D.heliInput = null;
    anim.setAnimationLoop(loop);
    res.done = true;
    res.t1 = new Date().toTimeString().slice(0, 8);
  }
  return res;
}

/** The pass's table: one case, the scenery switches (flora, terrain, sky, furniture) all off / all on, an A/A pair, and
 * (cockpit) the mirrors alone. Interleaved frames (see inter()). */
export const SCENERY = ['flora', 'terrain', 'sky', 'furniture'];
export function table(kind, { rounds = 60 } = {}) {
  const D = window.demo;
  const T = D.terrain;
  const reset = () => {
    for (const f of [...SCENERY, 'mirrors']) D.perf[f] = true;
    T.show.grass = true;
    T.show.trees = true;
  };
  const off = () => {
    for (const f of SCENERY) D.perf[f] = false;
  };
  const v = { off, offB: off, on: () => {}, floraOff: () => (D.perf.flora = false) };
  if (kind === 'cockpit') v.mirrorsOff = () => (D.perf.mirrors = false);
  return inter(kind, v, { rounds, reset });
}
