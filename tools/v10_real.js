// (V10) Frame time of the new paths in the game's own loop (requestAnimationFrame, real time), with the pane shown.
//   const R = await import('/tools/v10_real.js');
//   R.path('bail', { kmh: 80 }).then(r => window.__real = r)
//   R.path('jump', { height: 60 }), R.path('para', { height: 300 }), R.path('heliGround'), R.path('stop', { kmh: 20 })
//   R.traced('bail', { kmh: 80 })   the same, step-driven (one frame = step + render + GPU done: tools/v9_cost.js trace),
//                                   for when the pane is hidden and the page gets no animation frames
// The set-up (getting in by the game's own path, the vehicle placed and brought up to speed or height) runs step-driven
// first; then the game's loop runs in real time, T is pressed (and Space for the parachute at 150 m) by the clock, and
// every frame's interval, CPU time and what was built or uploaded in it (tools/v9_cost.js hooks) is kept until he has
// stood for 1.5 s on foot. Reports median / p95 / worst interval, frames over 22 ms with what happened in them.
import { hooks, trace } from '/tools/v9_cost.js';

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const pct = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
};
const r2 = (x) => +x.toFixed(2);

async function setup(kind, { kmh, height }) {
  const D = window.demo;
  const V = D.vehicles;
  const step = (n) => {
    for (let i = 0; i < n; i++) D.step(1 / 60);
  };
  D.timeScale = 0;
  // ---- set-up, step-driven ----
  if (kind === 'para') D.pickUp();
  if (kind === 'bail' || kind === 'stop') {
    D.entryReview ? null : null;
    const r = await import('/src/car/scenarios.js');
    const e = V.entryPoint(new D.THREE.Vector3(), 'car');
    D.player.move = D.player._pending = null;
    D.player.pos.set(e.x - 2, 0, e.z + 2);
    D.player.vel.set(0, 0, 0);
    D.character.root.position.copy(D.player.pos);
    D.character.snapToGround();
    step(20);
    V.toggle();
    for (let i = 0; i < 1500 && V.mode !== 'seated'; i++) step(1);
    D.car.dyn.reset(120, 40, 0);
    for (let i = 0; i < 30; i++) D.car.dyn.update(1 / 60);
    r.preset(D.car.dyn, kmh / 3.6);
    V.carCams.started = false;
    step(30);
  } else {
    const e = V.entryPoint(new D.THREE.Vector3(), 'heli');
    D.player.move = D.player._pending = null;
    D.player.pos.set(e.x + 2.5, 0, e.z - 1.5);
    D.player.vel.set(0, 0, 0);
    D.character.root.position.copy(D.player.pos);
    D.character.snapToGround();
    step(20);
    V.toggle();
    for (let i = 0; i < 1500 && V.mode !== 'seated'; i++) step(1);
    if (kind === 'heliGround') {
      D.heli.power = true;
      D.heli.fm.controls.rotorBrake = 0;
      D.heli.fm.startEngine({ quick: true });
      for (let i = 0; i < 1200 && D.heli.state.rotor.percent < 99; i++) step(1);
    } else D.heliUp(kind === 'para' ? 300 : height, kind === 'para' ? { x: -150, z: 170, heading: Math.PI / 2, hold: 1 } : { x: -58, z: 102, hold: 1.5 });
  }
}

/** The scripted presses (T after 1 s; Space at 150 m; the flare at 5 m) for frame time t (s). */
function presses(kind, st, t) {
  const D = window.demo;
  const V = D.vehicles;
  const X = D.exits;
  if (!st.pressed && t > 1 && !st.noPress) {
    st.pressed = true;
    D.carInput = null;
    D.heliInput = null;
    D.fly.lever = D.heli.state.controls.collective;
    const r = V.toggle();
    if (r === 'out') D.fly.lever = 0;
    st.toggle = r;
  }
  if (kind === 'para' && !st.pulled && X.s && X.canPull && X.height < 150) {
    st.pulled = true;
    X.key('Space', true);
    X.key('Space', false);
  }
  if (kind === 'para' && X.s && X.s.chute && X.s.chute.state === 'canopy') X.keys.flare = X.height < 5;
}

function holdCar(kmh) {
  const D = window.demo;
  const want = kmh / 3.6;
  D.carInput = (dyn) => {
    dyn.input.throttle = Math.max(0, Math.min(1, (want - dyn.speed) * 0.6 + 0.15));
    dyn.input.brake = 0;
    dyn.input.steer = 0;
  };
}

/** Step-driven: one frame = step + render + GPU done (v9_cost trace), `seconds` of it from the set-up. */
export async function traced(kind = 'bail', { kmh = 80, height = 60, seconds = null, press = true } = {}) {
  const D = window.demo;
  await setup(kind, { kmh, height });
  if (kind === 'bail' || kind === 'stop') holdCar(kmh);
  const st = { noPress: !press };
  const frames = Math.round((seconds || { bail: 6, stop: 12, jump: height > 20 ? 9 : 6, para: 34, heliGround: 16 }[kind] || 8) * 60);
  const r = await trace((i) => presses(kind, st, i / 60), frames, { warm: 5 });
  D.exits.keys.flare = false;
  return { kind, kmh, height, toggle: st.toggle, frames, canvas: [D.renderer.domElement.width, D.renderer.domElement.height], median: r.median, p95: r.p95, worst: r.worst, over22: r.over22, split: [r.step, r.render, r.gpu], pipelines: r.totals && r.totals.pipelines, programs: r.totals && r.totals.programs, slow: (r.slow || []).slice(0, 12).map((x) => Object.fromEntries(Object.entries(x).filter(([, y]) => y !== 0 && y !== null && y !== undefined))), totals: r.totals, last: D.exits.stats.last };
}

export async function path(kind = 'bail', { kmh = 80, height = 60, maxS = 45 } = {}) {
  const D = window.demo;
  const V = D.vehicles;
  const X = D.exits;
  await setup(kind, { kmh, height });
  // ---- the game's own loop ----
  const res = { kind, kmh, height, canvas: [D.renderer.domElement.width, D.renderer.domElement.height], done: false };
  window.__real = res;
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  const H = hooks(D);
  H.take();
  const rows = [];
  let last = null;
  let t0 = null;
  let pressed = false;
  let pulled = false;
  let footFor = 0;
  let finished = false;
  // (the car held at its speed until T)
  if (kind === 'bail' || kind === 'stop') {
    const want = kmh / 3.6;
    D.carInput = (dyn) => {
      dyn.input.throttle = Math.max(0, Math.min(1, (want - dyn.speed) * 0.6 + 0.15));
      dyn.input.brake = 0;
      dyn.input.steer = 0;
    };
  }
  D.timeScale = 1;
  await new Promise((resolve) => {
    anim.setAnimationLoop((now) => {
      if (t0 === null) t0 = now;
      const t = (now - t0) / 1000;
      if (!pressed && t > 1) {
        pressed = true;
        D.carInput = null;
        D.heliInput = null;
        D.fly.lever = D.heli.state.controls.collective;
        const r = V.toggle();
        if (r === 'out') D.fly.lever = 0;
        res.toggle = r;
        res.pressAt = r2(t);
      }
      if (kind === 'para' && !pulled && X.s && X.canPull && X.height < 150) {
        pulled = true;
        X.key('Space', true);
        X.key('Space', false);
      }
      if (kind === 'para' && X.s && X.s.chute && X.s.chute.state === 'canopy') X.keys.flare = X.height < 5;
      const c0 = performance.now();
      loop(now);
      const c1 = performance.now();
      const e = H.take();
      rows.push({ t: r2(t), gap: last === null ? 0 : r2(now - last), cpu: r2(c1 - c0), mode: V.mode, ...e });
      last = now;
      if (pressed && V.mode === 'foot') footFor += 1;
      if ((pressed && footFor > 90) || t > maxS) {
        if (!finished) {
          finished = true;
          resolve();
        }
      }
    });
  });
  anim.setAnimationLoop(loop);
  D.timeScale = 0;
  X.keys.flare = false;
  const body = rows.slice(3);
  const g = body.map((r) => r.gap);
  const c = body.map((r) => r.cpu);
  const byMode = {};
  for (const r of body) (byMode[r.mode] = byMode[r.mode] || []).push(r.gap);
  Object.assign(res, {
    frames: rows.length,
    seconds: r2(rows.length ? rows[rows.length - 1].t : 0),
    fps: r2(body.length / Math.max(1e-3, (body.reduce((a, r) => a + r.gap, 0)) / 1000)),
    gapMedian: r2(med(g)),
    gapP95: r2(pct(g, 0.95)),
    gapP99: r2(pct(g, 0.99)),
    gapWorst: r2(Math.max(...g)),
    over22: g.filter((x) => x > 22).length,
    cpuMedian: r2(med(c)),
    cpuP95: r2(pct(c, 0.95)),
    byMode: Object.fromEntries(Object.entries(byMode).map(([m, a]) => [m, { n: a.length, median: r2(med(a)), worst: r2(Math.max(...a)) }])),
    pipelines: body.reduce((a, r) => a + (r.pipelines || 0), 0),
    slow: body.filter((r) => r.gap > 22).slice(0, 20),
    last: X.stats.last,
    done: true,
  });
  return res;
}
