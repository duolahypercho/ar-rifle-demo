// (V8) Pictures for pass V8, in the page:  const S = await import('/tools/v8_shots.js')
// Sheets go to tools/sheet_receiver.mjs (127.0.0.1:5199) as demo.sheet does.
const D = () => window.demo;

/** Sets the camera (position, target, fov) and lets the flora refill round it. */
export function cam(p, t, fov = 55) {
  return () => {
    const d = D();
    d.sheet.cam(p, t, fov);
    d.camera.updateMatrixWorld();
    const T = d.terrain;
    if (T && T.grassField) {
      T.grassField.update(d.camera, d.perf.terrain);
      T.flora.update(d.camera);
    }
  };
}

/**
 * A sheet: tiles = [[label, place, pre]]; each tile: pre() (async, optional), one game step, `n` renders with the
 * camera set before each (TRAA settles), then copied in the same task as the last render.
 */
export async function sheet(name, tiles, { cols = 2, w = 640, h = 480, n = 6, step = true } = {}) {
  const d = D();
  const S = d.sheet;
  S.open(cols, Math.ceil(tiles.length / cols), w, h);
  try {
    for (const [label, place, pre] of tiles) {
      if (pre) await pre();
      if (step) d.step(1 / 60);
      for (let i = 0; i < n; i++) {
        if (place) place();
        d.render();
      }
      S.tile(label, place);
    }
    await S.post(name);
  } finally {
    S.close();
  }
  return name;
}

/** The time of day by name (main.js's setTime: the look, the lamps, the clouds). */
export function time(name) {
  const d = D();
  if (d.setTime) d.setTime(name);
  else d.look.setTime(name);
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

/** The car on the track at LINE[i], heading along it, the player in it, held; chase (0) or cockpit (1) view. */
export async function carAt(i = 300, mode = 0, kmh = 0) {
  const d = D();
  const { LINE } = await import('/src/track.js');
  const { preset } = await import('/src/car/scenarios.js');
  d.timeScale = 0;
  if (d.vehicles.mode !== 'seated' || d.vehicles.kind !== 'car') d.seatInCar();
  const p = LINE[i % LINE.length];
  const q = LINE[(i + 3) % LINE.length];
  const yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
  d.car.dyn.reset(p.x, p.z, yaw);
  for (let k = 0; k < 30; k++) d.car.dyn.update(1 / 60);
  if (kmh) preset(d.car.dyn, kmh / 3.6);
  d.vehicles.carCams.mode = mode;
  d.vehicles.carCams.started = false;
  for (let k = 0; k < 20; k++) d.step(1 / 60);
}

/** The helicopter at (x, y, z) heading `hdg` (rad), hovering (or on the ground when y is 0), held. */
export function heliAt(x, z, y = 0, hdg = 0, mode = 0) {
  const d = D();
  d.timeScale = 0;
  if (d.vehicles.mode !== 'seated' || d.vehicles.kind !== 'heli') d.seatInHeli();
  const h = d.heli;
  h.fm.reset({ position: [x, y, z], heading: hdg, running: 'flight', inAir: y > 0.5, velocity: [0, 0, 0], controls: { collective: y > 0.5 ? 0.5 : 0.1, cyclicPitch: 0, pedal: -0.15 } });
  h.assist.reset(h.fm.state);
  d.vehicles.heliCams.mode = mode;
  d.vehicles.heliCams.started = false;
  for (let k = 0; k < 20; k++) d.step(1 / 60);
}

/**
 * (V8) A crash from new (tools/v7_shots.js crashDamage), then the car lifted away from the wall to open ground (its
 * damage kept) and filmed from the side that was hit: a three-quarter view, the side, and a close-up of the worst dent.
 */
export async function crashFilm(kmh, angle, name, { extra = [] } = {}) {
  const d = D();
  const T = d.THREE;
  const V = await import('/tools/v7_shots.js');
  const r = await V.crashDamage(kmh, angle);
  const dyn = d.car.dyn;
  // the dent's place in the car's frame: the hardest logged hit
  const hard = r.log.filter((e) => e.dv > 1.5).sort((a, b) => b.dv - a.dv)[0] || r.log[0];
  const at = new T.Vector3(...(hard ? hard.at : [1, 0.5, 0]));
  const side = at.x >= 0 ? 1 : -1;
  dyn.reset(30, 60, 0);
  for (let k = 0; k < 40; k++) dyn.update(1 / 60);
  d.carInput = null;
  for (let k = 0; k < 10; k++) d.step(1 / 60);
  const R = d.car.root;
  const w = (x, y, z) => R.localToWorld(new T.Vector3(x, y, z)).toArray();
  const tiles = [
    [`${kmh} km/h ${angle} deg: three-quarter, the hit side`, () => d.sheet.cam(w(side * 4.2, 1.6, at.z - 3.2), w(side * 0.6, 0.5, at.z), 45)],
    [`${kmh} km/h ${angle} deg: the hit side`, () => d.sheet.cam(w(side * 5.5, 1.0, at.z), w(0, 0.5, at.z), 45)],
    [`close-up at the dent (${at.toArray().map((x) => x.toFixed(2)).join(', ')}), dv ${hard ? hard.dv : '-'}`, () => d.sheet.cam(w(at.x + side * 1.3, at.y + 0.5, at.z - 0.9), w(at.x, at.y, at.z), 40)],
    ...extra,
  ];
  await sheet(name, tiles, { cols: 3, w: 480, h: 360, step: false });
  return r;
}
