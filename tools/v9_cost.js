// (V9) Frame time per frame, with what happened in each frame, for tracing slow frames.
//   const C = await import('/tools/v9_cost.js');
//   C.turn('foot', { rate: 90 }).then(r => window.__t = r)     // turn the view 360 degrees at 90 deg/s, per-frame trace
//   C.blocks('heli', { n: 90, blocks: 3 }).then(r => window.__b = r) // the main session's blocks: median / p95
//   C.real('foot', 5).then(r => window.__r = r)               // the game's own loop running: frame-to-frame times
// One measured frame = demo.step(1/60) + demo.render() + await device.queue.onSubmittedWorkDone(), the game's loop held
// (as tools/v4_cost.js and v8_cost.js), split into step (CPU), render call (CPU) and GPU wait. Per frame it also records
// (hooks on the WebGPU backend and the game): render pipelines and shader modules created (and the ms spent creating
// them), textures uploaded, vertex / instance buffers created or re-uploaded (count and kB), the grass refills and tree
// re-sorts (and their ms), renders into targets other than the view (mirrors, the environment), the instrument
// canvases redrawn, and the JS heap falling (a garbage collection) with the MB freed.
// Cases: 'foot' (fresh page: where the page put the player, third person), 'edge' (yard's south edge, over the grass),
// 'car' / 'cockpit' (V4's main straight at 200 km/h), 'heli' / 'heliCockpit' (hovering at 97 m, hover hold).
import { setupCase } from '/tools/v4_cost.js';

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const pct = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
};
const r2 = (x) => +x.toFixed(2);

/** Wraps the backend and the game so each frame's events can be read and reset. */
export function hooks(D) {
  if (D.__v9hooks) return D.__v9hooks;
  const be = D.renderer.backend;
  const ev = { pipelines: 0, pipeMs: 0, programs: 0, progMs: 0, compute: 0, texUp: 0, texNew: 0, attrNew: 0, attrNewKB: 0, attrUp: 0, attrUpKB: 0, rt: 0, grass: 0, grassMs: 0, trees: 0, treesMs: 0, dash: 0 };
  const wrap = (obj, name, fn) => {
    const orig = obj[name];
    if (!orig) return;
    obj[name] = function (...args) {
      return fn.call(this, orig, args);
    };
  };
  const timed = (cnt, ms) => function (orig, args) {
    const t = performance.now();
    try {
      return orig.apply(this, args);
    } finally {
      ev[cnt]++;
      if (ms) ev[ms] += performance.now() - t;
    }
  };
  wrap(be, 'createRenderPipeline', timed('pipelines', 'pipeMs'));
  wrap(be, 'createProgram', timed('programs', 'progMs'));
  wrap(be, 'createComputePipeline', timed('compute', null));
  wrap(be, 'createTexture', timed('texNew', null));
  wrap(be, 'updateTexture', timed('texUp', null));
  wrap(be, 'createAttribute', function (orig, args) {
    ev.attrNew++;
    ev.attrNewKB += (args[0].array ? args[0].array.byteLength : 0) / 1024;
    return orig.apply(this, args);
  });
  wrap(be, 'createIndexAttribute', function (orig, args) {
    ev.attrNew++;
    ev.attrNewKB += (args[0].array ? args[0].array.byteLength : 0) / 1024;
    return orig.apply(this, args);
  });
  wrap(be, 'updateAttribute', function (orig, args) {
    ev.attrUp++;
    ev.attrUpKB += (args[0].array ? args[0].array.byteLength : 0) / 1024;
    return orig.apply(this, args);
  });
  const R = D.renderer;
  wrap(R, 'render', function (orig, args) {
    if (R.getRenderTarget()) ev.rt++;
    return orig.apply(this, args);
  });
  const T = D.terrain;
  if (T && T.grassField) wrap(T.grassField, 'update', function (orig, args) {
    const t = performance.now();
    const did = orig.apply(this, args);
    if (did) {
      ev.grass++;
      ev.grassMs += performance.now() - t;
    }
    return did;
  });
  if (T && T.flora) wrap(T.flora, 'update', function (orig, args) {
    const t = performance.now();
    const did = orig.apply(this, args);
    if (did) {
      ev.trees++;
      ev.treesMs += performance.now() - t;
    }
    return did;
  });
  const dash = () => (D.car.dash ? D.car.dash.drawCount || 0 : 0) + (D.heli.panel ? D.heli.panel.drawCount || 0 : 0);
  let dash0 = dash();
  let heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  const H = {
    ev,
    reset() {
      for (const k of Object.keys(ev)) ev[k] = 0;
      dash0 = dash();
    },
    /** This frame's events (non-zero only), and the heap's fall since the last read (MB). */
    take() {
      const out = {};
      for (const [k, x] of Object.entries(ev)) if (x) out[k] = k.endsWith('Ms') || k.endsWith('KB') ? r2(x) : x;
      const d = dash() - dash0;
      if (d) out.dash = d;
      if (performance.memory) {
        const h = performance.memory.usedJSHeapSize;
        if (h < heap0 - 256 * 1024) out.gcMB = r2((heap0 - h) / 1048576);
        heap0 = h;
      }
      H.reset();
      return out;
    },
  };
  D.__v9hooks = H;
  return H;
}

/** The cases (V4's, plus a hover at 97 m with the hover hold, chase or cockpit). */
export function setup(D, kind) {
  D.timeScale = 0;
  if (kind === 'foot') return () => {};
  if (kind === 'edge') {
    D.player.pos.set(-20, 0, 138);
    D.player.yaw = D.player.camYaw = Math.PI;
    D.player.pitch = D.player.camPitch = -0.08;
    D.character.root.position.copy(D.player.pos);
    D.character.snapToGround && D.character.snapToGround();
    return () => {};
  }
  if (kind === 'heli' || kind === 'heliCockpit') {
    D.seatInHeli();
    const h = D.heli;
    h.fm.reset({ position: [-78, 97, 160], heading: 0, running: 'flight', inAir: true });
    h.assist.reset(h.fm.state);
    if (h.assist.setMode) h.assist.setMode('hoverHold', true);
    D.vehicles.heliCams.mode = kind === 'heliCockpit' ? 1 : 0;
    D.vehicles.heliCams.started = false;
    return () => {};
  }
  return setupCase(D, kind);
}

async function oneFrame(D, device, H, out) {
  const t0 = performance.now();
  D.step(1 / 60);
  const t1 = performance.now();
  D.render();
  const t2 = performance.now();
  await device.queue.onSubmittedWorkDone();
  const t3 = performance.now();
  const e = H ? H.take() : {};
  if (out) out.push({ ms: r2(t3 - t0), step: r2(t1 - t0), render: r2(t2 - t1), gpu: r2(t3 - t2), ...e });
  return t3 - t0;
}

const summary = (rows) => {
  const cv = window.demo.renderer.domElement;
  const f = rows.map((r) => r.ms);
  return {
    canvas: [cv.width, cv.height],
    n: rows.length,
    median: r2(med(f)),
    p95: r2(pct(f, 0.95)),
    worst: r2(Math.max(...f)),
    over22: f.filter((x) => x > 22).length,
    over33: f.filter((x) => x > 33.4).length,
    step: r2(med(rows.map((r) => r.step))),
    render: r2(med(rows.map((r) => r.render))),
    gpu: r2(med(rows.map((r) => r.gpu))),
  };
};

/**
 * Turns the view while measuring every frame. rate: deg/s (or flick: [deg, seconds] repeated `flicks` times with a
 * pause between); deg: how far in all (on foot 360; in the car the chase view's free look sweeps to +149 and to -149
 * deg and back, its limits). warm: unmeasured frames before (still view). after: frames after the turn.
 */
export async function turn(kind = 'foot', { rate = 90, flick = null, flicks = 2, deg = 360, warm = 20, after = 30, setupCase: doSetup = true } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const H = hooks(D);
  const res = (window.__turn = { kind, rate, flick, done: false, t0: new Date().toTimeString().slice(0, 8), canvas: [D.renderer.domElement.width, D.renderer.domElement.height] });
  const rows = [];
  try {
    if (doSetup) setup(D, kind);
    for (let i = 0; i < warm; i++) await oneFrame(D, device, H, null);
    H.reset();
    // the yaw to add each frame (rad)
    const plan = [];
    const R = Math.PI / 180;
    if (flick) {
      const [fd, fs] = flick;
      const n = Math.max(1, Math.round(fs * 60));
      for (let k = 0; k < flicks; k++) {
        // (eased as a hand moves the mouse: 1 - cos)
        for (let i = 0; i < n; i++) plan.push(fd * R * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / n)) / n);
        for (let i = 0; i < 30; i++) plan.push(0);
      }
    } else {
      const per = (rate * R) / 60;
      const total = deg * R;
      for (let a = 0; a < total - 1e-6; a += per) plan.push(Math.min(per, total - a));
    }
    const car = kind === 'car' || kind === 'cockpit';
    const cams = car ? D.vehicles.carCams : null;
    let sign = 1;
    for (let i = 0; i < plan.length + after; i++) {
      const dy = i < plan.length ? plan[i] : 0;
      if (car) {
        // (the chase view's free look: out to +149 deg, across to -149, back to 0)
        const ly = cams.lookYaw + sign * dy;
        if (ly > 2.59) sign = -1;
        if (ly < -2.59 && sign < 0) sign = 2;
        D.input.lookX = (-(sign > 1 ? 1 : sign) * dy) / 0.003;
        if (sign === 2 && cams.lookYaw > -0.01) sign = 0;
      } else D.input.lookX = dy / 0.0023;
      await oneFrame(D, device, H, rows);
      rows[rows.length - 1].yaw = r2(((car ? cams.lookYaw : D.player.camYaw) * 180) / Math.PI);
    }
    Object.assign(res, summary(rows));
    res.slow = rows.map((r, i) => ({ i, ...r })).filter((r) => r.ms > 22);
    res.rows = rows;
    res.totals = {};
    for (const r of rows) for (const [k, x] of Object.entries(r)) if (!['ms', 'step', 'render', 'gpu', 'yaw'].includes(k)) res.totals[k] = r2((res.totals[k] || 0) + x);
  } finally {
    D.input.lookX = 0;
    anim.setAnimationLoop(loop);
    res.done = true;
  }
  return res;
}

/** The main session's method: blocks of n frames (median, p95 pooled), with per-frame events kept for the slow ones. */
export async function blocks(kind = 'foot', { n = 90, blocks: nb = 3, warm = 30, setupCase: doSetup = true } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const H = hooks(D);
  const res = (window.__blocks = { kind, done: false, t0: new Date().toTimeString().slice(0, 8), canvas: [D.renderer.domElement.width, D.renderer.domElement.height] });
  const rows = [];
  try {
    if (doSetup) setup(D, kind);
    for (let i = 0; i < warm; i++) await oneFrame(D, device, H, null);
    H.reset();
    for (let b = 0; b < nb; b++) {
      if (b) await new Promise((r) => setTimeout(r, 250));
      for (let i = 0; i < n; i++) await oneFrame(D, device, H, rows);
    }
    Object.assign(res, summary(rows));
    res.blockMedians = Array.from({ length: nb }, (_, b) => r2(med(rows.slice(b * n, (b + 1) * n).map((r) => r.ms))));
    res.slow = rows.map((r, i) => ({ i, ...r })).filter((r) => r.ms > 22).slice(0, 40);
    // (what the slowest tenth of the frames had, against the rest: the share of frames with each event)
    const cut = pct(rows.map((r) => r.ms), 0.9);
    const share = (list) => {
      const o = {};
      for (const r of list) for (const k of Object.keys(r)) if (!['ms', 'step', 'render', 'gpu'].includes(k)) o[k] = (o[k] || 0) + 1;
      for (const k of Object.keys(o)) o[k] = r2(o[k] / Math.max(1, list.length));
      return o;
    };
    const top = rows.filter((r) => r.ms >= cut);
    const rest = rows.filter((r) => r.ms < cut);
    res.p90 = r2(cut);
    res.topShare = share(top);
    res.restShare = share(rest);
    res.topSplit = [r2(med(top.map((r) => r.step))), r2(med(top.map((r) => r.render))), r2(med(top.map((r) => r.gpu)))];
    res.draws = D.renderer.info.render.drawCalls;
    if (kind.startsWith('heli')) res.heli = { y: Math.round(D.heli.fm.state.position.y), kmh: Math.round(D.heli.speed * 3.6) };
    if (kind === 'car' || kind === 'cockpit') res.kmh = Math.round(Math.hypot(D.car.dyn.vel.x, D.car.dyn.vel.z) * 3.6);
  } finally {
    D.carInput = null;
    anim.setAnimationLoop(loop);
    res.done = true;
  }
  return res;
}

/**
 * The game's own loop running, as played (timeScale 1): the time between frames as the browser schedules them (what a
 * player sees), and per frame the CPU time of step + render. `seconds` of it after `setupCase`.
 */
export async function real(kind = 'foot', seconds = 5, { doSetup = true, lookRate = 0 } = {}) {
  const D = window.demo;
  const res = (window.__real = { kind, done: false, canvas: [D.renderer.domElement.width, D.renderer.domElement.height] });
  if (doSetup) setup(D, kind);
  D.timeScale = 1;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  const H = hooks(D);
  const rows = [];
  let last = null;
  anim.setAnimationLoop((now) => {
    if (lookRate) D.input.lookX = ((lookRate * Math.PI) / 180 / 60) / 0.0023;
    const t0 = performance.now();
    loop(now);
    const t1 = performance.now();
    const e = H.take();
    rows.push({ gap: last === null ? 0 : r2(now - last), cpu: r2(t1 - t0), ...e });
    last = now;
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  anim.setAnimationLoop(loop);
  D.timeScale = 0;
  const g = rows.slice(2).map((r) => r.gap);
  const c = rows.slice(2).map((r) => r.cpu);
  Object.assign(res, { frames: rows.length, fps: r2(rows.length / seconds), gapMedian: r2(med(g)), gapP95: r2(pct(g, 0.95)), gapWorst: r2(Math.max(...g)), cpuMedian: r2(med(c)), cpuP95: r2(pct(c, 0.95)), slow: rows.map((r, i) => ({ i, ...r })).filter((r) => r.gap > 22).slice(0, 40), done: true });
  return res;
}

/**
 * Plays `frames` frames, calling act(i, demo) before each step, and records each frame as turn() does: for first-use
 * hitches of actions (the first shot, a swap, getting in). Returns the summary and the slow frames.
 */
export async function trace(act, frames = 120, { warm = 10 } = {}) {
  const D = window.demo;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null);
  const device = D.renderer.backend.device;
  const H = hooks(D);
  const rows = [];
  const res = (window.__trace = { done: false });
  try {
    D.timeScale = 0;
    for (let i = 0; i < warm; i++) await oneFrame(D, device, H, null);
    H.reset();
    for (let i = 0; i < frames; i++) {
      if (act) act(i, D);
      await oneFrame(D, device, H, rows);
      rows[rows.length - 1].mode = D.vehicles.mode;
    }
    Object.assign(res, summary(rows));
    res.slow = rows.map((r, i) => ({ i, ...r })).filter((r) => r.ms > 22);
    res.totals = {};
    for (const r of rows) for (const [k, x] of Object.entries(r)) if (typeof x === 'number' && !['ms', 'step', 'render', 'gpu'].includes(k)) res.totals[k] = r2((res.totals[k] || 0) + x);
  } finally {
    anim.setAnimationLoop(loop);
    res.done = true;
  }
  return res;
}

/**
 * The final table for one page load: per case the blocks (median / p95 / worst, the split) and the game's own loop
 * with the adaptive render scale on and then off (fps, frame interval median / p95 / worst, CPU, the scale it ended at).
 */
export async function table(cases = ['foot', 'car', 'cockpit'], { seconds = 4 } = {}) {
  const D = window.demo;
  const out = (window.__table = { done: false, canvas: [D.renderer.domElement.width, D.renderer.domElement.height], rows: {} });
  for (const k of cases) {
    const b = await blocks(k);
    const row = { blocks: [b.median, b.p95, b.worst, b.over22], split: [b.step, b.render, b.gpu] };
    for (const on of [true, false]) {
      D.adapt.enabled = on;
      const r = await real(k, seconds);
      row[on ? 'adaptOn' : 'adaptOff'] = { fps: r.fps, gap: [r.gapMedian, r.gapP95, r.gapWorst], cpu: r.cpuMedian, scale: D.adapt.scale, canvas: [D.renderer.domElement.width, D.renderer.domElement.height] };
    }
    D.adapt.enabled = true;
    out.rows[k] = row;
  }
  out.done = true;
  return out;
}
