// (V5) Pictures for the live instruments, the crashes and the shutdown. In the page:
//   const S = await import('/tools/v5_shots.js'); await S.sheet('name', tiles)
// Each tile: { label, step(D) -> sets the state and steps, view(D) -> sets the camera, crop: [[x, y, z], ...] world
// points whose screen box is cut out at the canvas's own pixels (what the game draws, no scaling) }. A tile is drawn
// 6 frames (TRAA settles) after its last step with the camera set before each render; the canvas is copied in the
// same task as the last render. Sheets go to tools/sheet_receiver.mjs (port 5199).
const W = 512;
const H = 384;

export async function sheet(name, tiles, { cols = 4 } = {}) {
  const D = window.demo;
  const rows = Math.ceil(tiles.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * W;
  c.height = rows * H;
  c.style.cssText = `position:fixed;left:0;top:0;z-index:99999;width:${cols * 128}px;height:${rows * 96}px`;
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const src = D.renderer.domElement;
  const prevScale = D.timeScale;
  D.timeScale = 0;
  try {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.step) await t.step(D);
      for (let k = 0; k < 6; k++) {
        if (t.view) t.view(D);
        D.render();
      }
      if (t.view) t.view(D);
      D.render();
      const x = (i % cols) * W;
      const y = Math.floor(i / cols) * H;
      if (t.crop) {
        const box = t.crop.at ? { cx: t.crop.at[0] * src.width, cy: t.crop.at[1] * src.height, w: 0, h: 0 } : screenBox(D, typeof t.crop === 'function' ? t.crop(D) : t.crop, src);
        // centred on the box, at the canvas's own pixels (or scaled down to fit when bigger than the tile)
        const s = Math.max(1, box.w / W, box.h / H);
        const cw = W * s;
        const ch = H * s;
        g.drawImage(src, box.cx - cw / 2, box.cy - ch / 2, cw, ch, x, y, W, H);
      } else g.drawImage(src, 0, 0, src.width, src.height, x, y, W, H);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(x, y + H - 18, W, 18);
      g.fillStyle = '#fff';
      g.font = '12px sans-serif';
      g.fillText(t.label || '', x + 4, y + H - 5);
    }
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: b });
  } finally {
    c.remove();
    D.timeScale = prevScale;
  }
}

/** The screen box (canvas pixels) of world points. */
export function screenBox(D, pts, src = D.renderer.domElement) {
  const cam = D.camera;
  cam.updateMatrixWorld();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const v = p.clone().project(cam);
    const x = ((v.x + 1) / 2) * src.width;
    const y = ((1 - v.y) / 2) * src.height;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** The car's cluster and centre screen corners (vehicle_root frame, from the GLB) in the world. */
export function carScreens(D) {
  const THREE = D.THREE;
  const m = D.car.nodes.interior || D.car.model;
  m.updateWorldMatrix(true, false);
  return [[-0.514, 0.716, -0.651], [-0.226, 0.781, -0.662], [-0.08, 0.505, -0.669], [0.08, 0.704, -0.613]].map((p) => m.localToWorld(new THREE.Vector3(...p)));
}

/** The helicopter's display meshes' world box corners. */
export function heliScreens(D) {
  const THREE = D.THREE;
  const box = new THREE.Box3();
  D.heli.model.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.name !== 'display_emissive' || o.isSkinnedMesh) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * The helicopter's warnings in flight (results in window.__warn): quick start, a climb to a 10 m hover, the
 * collective pulled past the torque limit for 3 s (the lever straight to the model, the assist's limiter bypassed),
 * back to the hover, the engine cut; per moment the flags, the tones asked for and the lamps, plus a sheet of the
 * caution panel (native crop) at each.
 */
export async function heliWarnings() {
  const D = window.demo;
  const out = (window.__warn = { done: false, log: [] });
  D.timeScale = 0;
  D.seatInHeli();
  const h = D.heli;
  const fm = h.fm;
  h.power = true;
  fm.startEngine({ quick: true });
  for (let i = 0; i < 60 * 14; i++) D.step(1 / 60);
  D.vehicles.heliCams.mode = 1;
  const snap = (tag) => {
    const s = fm.state;
    out.log.push({ tag, t: +fm.time.toFixed(2), nr: +s.rotor.percent.toFixed(1), ng: +s.engine.ng.toFixed(1), tq: +s.engine.torquePercent.toFixed(0), h: +s.radarHeight.toFixed(1), tones: Object.keys(h.warn).filter((k) => h.warn[k]), lamps: Object.keys(h.lamps).filter((k) => h.lamps[k] && k !== 'PITOT HT'), hudFlags: document.getElementById('h-flags').textContent, panel: (h.panel.shown.caution || []).filter((k) => k !== 'PITOT HT') });
  };
  let mode = 'climb';
  let lever = 0.45;
  D.heliInput = (heli, dt) => {
    const s = heli.state;
    if (mode === 'climb') lever = Math.min(0.56, lever + 0.1 * dt);
    if (mode === 'hover') lever += ((10 - s.radarHeight) * 0.02 - s.verticalSpeed * 0.03) * dt * 3;
    if (mode === 'pull') lever = Math.min(1, lever + 0.5 * dt);
    const c = { cyclicPitch: 0, cyclicRoll: 0, pedal: 0, collective: lever, collectiveRate: 0 };
    const a = heli.assist.update(s, c, dt);
    heli.fm.setControls(mode === 'pull' || mode === 'cut' ? { ...a, collective: lever } : a);
  };
  const tiles = [];
  const crop = { at: [0.41, 0.66] };
  const tile = (label) => tiles.push({ label, crop });
  try {
    for (let i = 0; i < 60 * 8; i++) D.step(1 / 60);
    mode = 'hover';
    for (let i = 0; i < 60 * 6; i++) D.step(1 / 60);
    snap('hover 10 m');
    await sheet('v5_warn_hover', [{ label: 'hover: no cautions', crop }], { cols: 1 });
    mode = 'pull';
    let first = false;
    for (let i = 0; i < 60 * 3; i++) {
      D.step(1 / 60);
      if (h.warn.overtorque && !first) {
        first = true;
        snap('overtorque first frame');
      }
    }
    snap('pulled 3 s');
    await sheet('v5_warn_overtorque', [{ label: `overtorque ${Math.round(fm.state.engine.torquePercent)} %`, crop }], { cols: 1 });
    mode = 'hover';
    for (let i = 0; i < 60 * 8; i++) D.step(1 / 60);
    snap('back in the hover');
    fm.cutEngine();
    mode = 'cut';
    let horn = false;
    let eo = false;
    for (let i = 0; i < 60 * 1.5; i++) {
      D.step(1 / 60);
      if (h.warn.horn && !horn) {
        horn = true;
        snap('horn on');
      }
      if (h.warn.engineOut && !eo) {
        eo = true;
        snap('engine out on');
      }
    }
    snap('1.5 s after the cut');
    await sheet('v5_warn_engout', [{ label: `engine cut +1.5 s: Nr ${Math.round(fm.state.rotor.percent)} %`, crop }], { cols: 1 });
  } finally {
    D.heliInput = null;
    out.done = true;
  }
  void tile;
  return out;
}

/**
 * The car into a barrier in the game (results in window.__crash): seated, the barrier nearest the main straight's
 * middle chosen from track.js's obstacles, the car set 12 m from its face at `angle` deg to it (90 head-on), preset
 * to `kmh`, no throttle or brakes. Per frame from just before the hit: speed, the frame's acceleration, the thrown
 * torso and head (deg), the camera shake, sparks alive, crunch events. Tiles: outside at the hit and after, and the
 * driver seen from the passenger side.
 */
export async function crash(kmh = 80, angle = 90, { name = 'v5_crash' } = {}) {
  const D = window.demo;
  const THREE = D.THREE;
  const { CAR_OBSTACLES } = await import('/src/track.js');
  const { preset } = await import('/src/car/scenarios.js');
  const out = (window.__crash = { done: false, rows: [] });
  D.timeScale = 0;
  D.seatInCar();
  const car = D.car;
  const d = car.dyn;
  // a barrier: long and thin, near (126, -300) (the main straight's side)
  const bar = CAR_OBSTACLES.filter((o) => o.top < 1 && Math.max(o.hx, o.hz) > 3).sort((a, b) => Math.hypot(a.x - 126, a.z + 300) - Math.hypot(b.x - 126, b.z + 300))[0];
  // its face normal (the thin axis) and along-axis
  const thinX = bar.hx < bar.hz;
  const n = thinX ? [bar.c, bar.s] : [-bar.s, bar.c];
  const along = thinX ? [-bar.s, bar.c] : [bar.c, bar.s];
  const half = thinX ? bar.hx : bar.hz;
  // the car on the side of the face toward +n, heading into it at `angle` to the face
  const a = (angle * Math.PI) / 180;
  const dir = [-n[0] * Math.sin(a) + along[0] * Math.cos(a), -n[1] * Math.sin(a) + along[1] * Math.cos(a)];
  const hit = [bar.x + n[0] * half, bar.z + n[1] * half];
  const start = [hit[0] - dir[0] * 12, hit[1] - dir[1] * 12];
  const yaw = Math.atan2(-dir[0], -dir[1]);
  d.reset(start[0], start[1], yaw);
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  preset(d, kmh / 3.6);
  car.thrown.torso.p = car.thrown.torso.pv = car.thrown.head.p = car.thrown.head.pv = 0;
  D.carInput = (dyn) => Object.assign(dyn.input, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
  D.vehicles.carCams.mode = 0;
  const R2D = 180 / Math.PI;
  let tHit = null;
  let peak = { torso: 0, head: 0, shake: 0, sparks: 0, accG: 0 };
  const tiles = [];
  const side = (D2) => {
    const c = car.root.localToWorld(new THREE.Vector3(0, 0.6, 0));
    const p = car.root.localToWorld(new THREE.Vector3(7, 3, 2));
    D2.camera.position.copy(p);
    D2.camera.lookAt(c);
  };
  const driver = (D2) => {
    const c = car.root.localToWorld(new THREE.Vector3(-0.35, 0.85, 0.05));
    const p = car.root.localToWorld(new THREE.Vector3(1.6, 1.2, 0.1));
    D2.camera.position.copy(p);
    D2.camera.lookAt(c);
  };
  const hidden = [];
  const cut = (on) => {
    // the passenger door and the body shell off for the driver's tiles
    for (const name of ['door_R']) {
      const o = car.nodes[name];
      if (o) {
        if (on) hidden.push([o, o.visible]);
        o.visible = !on;
      }
    }
  };
  let f = 0;
  const stepTo = (frames) => {
    for (let i = 0; i < frames; i++) {
      const v0 = Math.hypot(d.vel.x, d.vel.z);
      D.step(1 / 60);
      f++;
      const sp = Math.hypot(d.vel.x, d.vel.z);
      if (d.impacts.length && tHit === null) tHit = f;
      const accG = Math.hypot(d.accBody.x, d.accBody.z) / 9.81;
      const row = { f, kmh: +(sp * 3.6).toFixed(1), accG: +accG.toFixed(1), torso: +(car.thrown.torso.p * R2D).toFixed(1), head: +(car.thrown.head.p * R2D).toFixed(1), torsoRoll: +(car.thrown.torso.r * R2D).toFixed(1), shake: +car.shake.toFixed(2), sparks: car.sparkCloud.live, hits: d.impacts.length, yawRate: +(d.omega.y * R2D).toFixed(1) };
      if (tHit !== null && f - tHit < 40) out.rows.push(row);
      peak.torso = Math.max(peak.torso, Math.abs(row.torso));
      peak.head = Math.max(peak.head, Math.abs(row.head));
      peak.shake = Math.max(peak.shake, row.shake);
      peak.sparks = Math.max(peak.sparks, row.sparks);
      if (tHit !== null) peak.accG = Math.max(peak.accG, accG);
      void v0;
    }
  };
  try {
    // to 2 frames before the hit (12 m at the speed)
    const pre = Math.max(1, Math.floor((12 - 2.6) / (kmh / 3.6) * 60) - 2);
    tiles.push({ label: `${kmh} km/h, ${angle} deg: before`, step: () => stepTo(pre), view: side });
    tiles.push({ label: 'hit +2 frames', step: () => stepTo(4), view: side });
    tiles.push({ label: 'hit +6 frames', step: () => stepTo(4), view: side });
    tiles.push({ label: 'driver, hit +8 frames (door off)', step: () => {
      stepTo(2);
      cut(true);
    }, view: driver });
    tiles.push({ label: 'driver, hit +12 frames', step: () => stepTo(4), view: driver });
    tiles.push({ label: 'driver, hit +40 frames', step: () => {
      stepTo(28);
    }, view: driver });
    await sheet(`${name}_${kmh}_${angle}`, tiles, { cols: 3 });
  } finally {
    for (const [o, v] of hidden) o.visible = v;
    D.carInput = null;
    out.peak = peak;
    out.tHit = tHit;
    out.done = true;
    out.barrier = bar;
  }
  return out;
}
