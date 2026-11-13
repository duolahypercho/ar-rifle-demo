// (V7) Pictures and small measures for pass V7, in the page:
//   const S = await import('/tools/v7_shots.js')
// Sheets are posted to tools/sheet_receiver.mjs (127.0.0.1:5199) as demo.sheet does.
const D = () => window.demo;

/** Settles a picture: the game stepped once, then `n` renders (TRAA history), the camera set again before each. */
export function settle(place, n = 4) {
  const d = D();
  d.step(1 / 60);
  for (let i = 0; i < n; i++) {
    if (place) place();
    d.render();
  }
}

/** A sheet of tiles: tiles = [[label, place]] where place() sets the camera (or null: the game's own camera). */
export async function sheet(name, tiles, { cols = 2, w = 640, h = 480, n = 4, before = null } = {}) {
  const d = D();
  const S = d.sheet;
  const rows = Math.ceil(tiles.length / cols);
  S.open(cols, rows, w, h);
  try {
    for (const [label, place, pre] of tiles) {
      if (pre) await pre();
      if (before) before();
      d.step(1 / 60);
      for (let i = 0; i < n; i++) {
        if (place) place();
        d.render();
      }
      if (place) place();
      S.tile(label, place);
    }
    await S.post(name);
  } finally {
    S.close();
  }
  return name;
}

/** Puts the player in the car's seat, the game held, cockpit (1) or chase (0) view. */
export function inCar(mode = 1) {
  const d = D();
  d.timeScale = 0;
  if (d.vehicles.mode !== 'seated' || d.vehicles.kind !== 'car') d.seatInCar();
  d.vehicles.carCams.mode = mode;
  d.vehicles.carCams.started = false;
  for (let i = 0; i < 3; i++) d.step(1 / 60);
}

/** Two coloured boxes behind the car (red behind-right, green behind-left) for checking the mirrors' sides. */
export function testBoxes(back = 14, side = 2.2) {
  const d = D();
  const T = d.THREE;
  const car = d.car;
  const out = [];
  for (const [c, x] of [[0xff2020, side], [0x20ff20, -side]]) {
    const b = new T.Mesh(new T.BoxGeometry(2.5, 3, 1), new T.MeshBasicNodeMaterial({ color: c }));
    b.position.copy(car.root.localToWorld(new T.Vector3(x, 1.5, back)));
    b.quaternion.copy(car.root.quaternion);
    d.scene.add(b);
    b.updateMatrixWorld(true);
    out.push(b);
  }
  return () => out.forEach((b) => b.removeFromParent());
}

/** Reads a mirror's texture and posts it, 3x, tone-mapped roughly. */
export async function dumpMirror(idx, name) {
  const m = D().car.mirrors.list[idx];
  const buf = await D().renderer.readRenderTargetPixelsAsync(m.rt, 0, 0, m.rw, m.rh);
  const c = document.createElement('canvas');
  c.width = m.rw;
  c.height = m.rh;
  const g = c.getContext('2d');
  const img = g.createImageData(m.rw, m.rh);
  const f16 = (h) => {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 31;
    const f = h & 1023;
    return e === 0 ? (s * Math.pow(2, -14) * f) / 1024 : e === 31 ? 0 : s * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  const isF = buf instanceof Float32Array;
  for (let i = 0; i < m.rw * m.rh; i++) {
    for (let k = 0; k < 3; k++) {
      let v = isF ? buf[i * 4 + k] : f16(buf[i * 4 + k]);
      v = (v / (1 + v)) * 1.6;
      img.data[i * 4 + k] = Math.max(0, Math.min(255, Math.pow(Math.max(v, 0), 1 / 2.2) * 255));
    }
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = m.rw * 3;
  big.height = m.rh * 3;
  const bg = big.getContext('2d');
  bg.imageSmoothingEnabled = false;
  bg.drawImage(c, 0, 0, big.width, big.height);
  const b = await new Promise((r) => big.toBlob(r, 'image/jpeg', 0.9));
  await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: b });
  return name;
}

/** A crop of the canvas (x, y, w, h in canvas pixels) at `scale`, posted. */
export async function crop(name, x, y, w, h, scale = 1) {
  const src = D().renderer.domElement;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = scale < 1;
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: b });
  return name;
}

/** Where a world point lands on the canvas (pixels), for crops. */
export function onCanvas(p) {
  const d = D();
  const v = p.clone().project(d.camera);
  const el = d.renderer.domElement;
  return { x: ((v.x + 1) / 2) * el.width, y: ((1 - v.y) / 2) * el.height, z: v.z };
}

/**
 * (V7) The car into a barrier at `kmh` and `angle` (90 head-on) from new, as tools/v5_shots.js crash() sets it up; the
 * damage measured 1 s after. Returns { kmh, angle, damage: damage.measure(), log, draws: [before, after] } and, with
 * `views`, adds tiles [label, place] before and after to `tiles` (views: functions (car) => camera set).
 */
export async function crashDamage(kmh = 80, angle = 90, { tiles = null, views = [], settleS = 1.2 } = {}) {
  const d0 = D();
  const THREE = d0.THREE;
  // (the game's own obstacle list: an import of /src/track.js from here can be a second module instance, empty)
  const CAR_OBSTACLES = d0.car.dyn.ground.obstacles;
  const { preset } = await import('/src/car/scenarios.js');
  d0.timeScale = 0;
  d0.seatInCar();
  d0.repair();
  const car = d0.car;
  const d = car.dyn;
  const bar = CAR_OBSTACLES.filter((o) => o.top < 1 && Math.max(o.hx, o.hz) > 3).sort((a, b) => Math.hypot(a.x - 126, a.z + 300) - Math.hypot(b.x - 126, b.z + 300))[0];
  const thinX = bar.hx < bar.hz;
  const n = thinX ? [bar.c, bar.s] : [-bar.s, bar.c];
  const along = thinX ? [-bar.s, bar.c] : [bar.c, bar.s];
  const half = thinX ? bar.hx : bar.hz;
  const a = (angle * Math.PI) / 180;
  const dir = [-n[0] * Math.sin(a) + along[0] * Math.cos(a), -n[1] * Math.sin(a) + along[1] * Math.cos(a)];
  const hit = [bar.x + n[0] * half, bar.z + n[1] * half];
  const start = [hit[0] - dir[0] * 12, hit[1] - dir[1] * 12];
  const yaw = Math.atan2(-dir[0], -dir[1]);
  d.reset(start[0], start[1], yaw);
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  d0.vehicles.carCams.mode = 0;
  d0.step(1 / 60);
  void tiles;
  void views;
  void THREE;
  preset(d, kmh / 3.6);
  // (coasting into the wall, braking once it has hit)
  let hitAt = -1;
  d0.carInput = (dyn) => Object.assign(dyn.input, { throttle: 0, brake: hitAt >= 0 ? 1 : 0, steer: 0, handbrake: 0 });
  let f = 0;
  try {
    for (; f < 600; f++) {
      d0.step(1 / 60);
      if (d.impacts.length && hitAt < 0) hitAt = f;
      if (hitAt >= 0 && f - hitAt > settleS * 60) break;
    }
  } finally {
    d0.carInput = null;
  }
  const out = { kmh, angle, hitFrame: hitAt, damage: car.damage.measure(), log: car.damage.log.slice(), kmhAfter: +(Math.hypot(d.vel.x, d.vel.z) * 3.6).toFixed(1) };
  return out;
}

/** A camera place for sheet tiles that also fills the grass round it (the game fills it round its own camera). */
export function camAt(p, t, fov = 55) {
  return () => {
    D().sheet.cam(p, t, fov);
    const T = D().terrain;
    if (T && Math.hypot(p[0] - T._grassAt.x, p[2] - T._grassAt.z) > 6) T._fillGrass(p[0], p[2]);
    if (T) T.grass.visible = true;
  };
}
