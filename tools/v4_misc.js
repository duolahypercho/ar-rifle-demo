// (V4) The small checks: shadows crossing the cascade borders in motion, tyre smoke from the cockpit, the cyclic hand
// in the helicopter's cockpit view. In the page: const M = await import('/tools/v4_misc.js'); await M.borders('car')
// (reload between the car and the helicopter). Sheets go to tools/sheet_receiver.mjs (port 5199).
import { setupCase } from '/tools/v4_cost.js';
import { preset } from '/src/car/scenarios.js';

const W = 512;
const H = 384;

function overlay(cols, rows) {
  const c = document.createElement('canvas');
  c.width = cols * W;
  c.height = rows * H;
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;width:' + Math.min(1024, cols * W) / 2 + 'px';
  document.body.appendChild(c);
  return c;
}

function label(g, x, y, text) {
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillRect(x, y, W, 18);
  g.fillStyle = '#fff';
  g.font = '12px sans-serif';
  g.fillText(text, x + 5, y + 13);
}

async function post(c, name) {
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: b });
}

/**
 * Consecutive frames (every `every` steps) of the case's own view, each tile a crop of the canvas around (u, v): a
 * lamp post's or a building's shadow moving through the cascade borders (car chase: 14 and 70 m ahead; helicopter at
 * 100 m: 100 and 500 m along the view). 4 x 3 tiles.
 */
export async function borders(kind = 'car', { every = 5, u = 0.62, v = 0.62, zoom = 0.5 } = {}) {
  const D = window.demo;
  const c = overlay(4, 3);
  const g = c.getContext('2d');
  setupCase(D, kind);
  for (let i = 0; i < 20; i++) D.step(1 / 60);
  for (let n = 0; n < 12; n++) {
    for (let i = 0; i < every; i++) {
      D.step(1 / 60);
      D.render();
    }
    const src = D.renderer.domElement;
    const cw = src.width * zoom;
    const ch = src.height * zoom;
    const sx = Math.max(0, Math.min(src.width - cw, u * src.width - cw / 2));
    const sy = Math.max(0, Math.min(src.height - ch, v * src.height - ch / 2));
    g.drawImage(src, sx, sy, cw, ch, (n % 4) * W, Math.floor(n / 4) * H, W, H);
    label(g, (n % 4) * W, Math.floor(n / 4) * H, `${kind} frame ${20 + (n + 1) * every} (${(((n + 1) * every) / 60).toFixed(2)} s), near ${D.look.shadowNear} m`);
  }
  D.carInput = null;
  D.heliInput = null;
  await post(c, `v4_borders_${kind}`);
  c.remove();
}

/** A handbrake slide from 80 km/h on the apron, seen from the cockpit: 6 tiles, 0.4 s apart. */
export async function smokeCockpit() {
  const D = window.demo;
  D.timeScale = 0;
  D.seatInCar();
  const d = D.car.dyn;
  d.reset(40, 60, 0);
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  preset(d, 80 / 3.6);
  D.car.clearMarks();
  D.vehicles.carCams.mode = 1;
  let t = 0;
  D.carInput = (dyn) => Object.assign(dyn.input, { throttle: t < 0.3 ? 0.4 : 0.15, brake: 0, handbrake: t > 0.3 ? 1 : 0, steer: 0, steerAngle: t > 0.3 ? 0.35 : 0 });
  const c = overlay(3, 2);
  const g = c.getContext('2d');
  let n = 0;
  for (let i = 0; i < 300 && n < 6; i++) {
    t = i / 60;
    D.step(1 / 60);
    D.render();
    if (i > 30 && i % 24 === 0) {
      // (looking back over the left shoulder from 1.2 s, where the smoke is)
      if (n >= 3) D.vehicles.carCams.lookYaw = 2.2;
      const src = D.renderer.domElement;
      g.drawImage(src, 0, 0, src.width, src.height, (n % 3) * W, Math.floor(n / 3) * H, W, H);
      const kw = D.car.dyn.wheels.map((w) => Math.round(Math.abs(w.fy || 0) / 1000)).join('/');
      label(g, (n % 3) * W, Math.floor(n / 3) * H, `cockpit, handbrake slide t ${t.toFixed(2)} s ${(d.speed * 3.6).toFixed(0)} km/h lat kN ${kw}`);
      n++;
    }
  }
  D.carInput = null;
  D.vehicles.carCams.lookYaw = 0;
  await post(c, 'v4_smoke_cockpit');
  c.remove();
}

/** The helicopter's cockpit view with the stick centred, forward, aft, and looking a little down. */
export async function cyclicView() {
  const D = window.demo;
  D.timeScale = 0;
  D.seatInHeli();
  const h = D.heli;
  h.fm.reset({ position: [-78, 40, 112], heading: 0, running: 'flight', inAir: true });
  h.assist.reset(h.fm.state);
  const cams = D.vehicles.heliCams;
  cams.mode = 1;
  const c = overlay(2, 2);
  const g = c.getContext('2d');
  const cases = [['centred', 0, 0], ['forward 0.5', 0.5, 0], ['aft 0.5', -0.5, 0], ['centred, mouse a little down', 0, -0.15]];
  cases.forEach(([name, cp, look], n) => {
    D.heliInput = (hh) => hh.fm.setControls({ collective: 0.47, cyclicPitch: cp, cyclicRoll: 0, pedal: -0.38 });
    cams.lookPitch = look;
    for (let i = 0; i < 20; i++) {
      D.step(1 / 60);
      D.render();
    }
    const src = D.renderer.domElement;
    g.drawImage(src, 0, 0, src.width, src.height, (n % 2) * W, Math.floor(n / 2) * H, W, H);
    label(g, (n % 2) * W, Math.floor(n / 2) * H, `cockpit, stick ${name}`);
  });
  cams.lookPitch = 0;
  D.heliInput = null;
  await post(c, 'v4_cyclic_view');
  c.remove();
}
