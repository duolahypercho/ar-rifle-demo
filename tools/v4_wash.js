// (V4) Rotor wash, looked at: the helicopter held in a hover at 2, 5 and 10 m (skid height) over dirt and over the
// helipad's edge, and a lift-off from the dirt. In the page: const W = await import('/tools/v4_wash.js');
// await W.hovers('v4'); (reload) await W.liftoff('v4'). Sheets go to tools/sheet_receiver.mjs (port 5199).
// Per tile: the wash strength heli.js computes (thrust / weight x the fade with the hub's height over one rotor
// diameter), the dust sprites alive, their mean and largest distance from the hub's foot and their mean outward speed.
import { groundAt } from '/src/ground.js';

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

/** Dust sprites alive: count, mean / largest horizontal distance from (x, z), mean outward speed. */
function dust(h, x, z) {
  let n = 0;
  let dist = 0;
  let far = 0;
  let out = 0;
  for (const p of h._dust) {
    if (!p.visible || p.userData.life <= 0) continue;
    n++;
    const dx = p.position.x - x;
    const dz = p.position.z - z;
    const r = Math.hypot(dx, dz) || 1;
    dist += r;
    far = Math.max(far, r);
    out += (p.userData.vel.x * dx + p.userData.vel.z * dz) / r;
  }
  return { n, meanM: n ? +(dist / n).toFixed(1) : 0, farM: +far.toFixed(1), outMs: n ? +(out / n).toFixed(1) : 0 };
}

/** Holds the helicopter at skid height `h` over (x, z): collective on height and climb, stick and pedal centred. */
function hold(D, x, z, h) {
  const g = groundAt(x, z);
  D.heliInput = (hh) => {
    const s = hh.fm.state;
    const y = s.position.y - g;
    hh.fm.setControls({ collective: Math.min(0.95, Math.max(0.15, 0.47 + 0.06 * (h - y) - 0.12 * s.velocity.y)), cyclicPitch: 0.02 * s.velocity.z, cyclicRoll: -0.02 * s.velocity.x, pedal: -0.38 });
  };
  return g;
}

export async function hovers(tag = 'v4') {
  const D = window.demo;
  D.timeScale = 0;
  D.seatInHeli();
  const h = D.heli;
  const places = [
    ['dirt', -160, 200],
    ['helipad edge', -78 + 12, 112],
  ];
  const heights = [2, 5, 10];
  const c = overlay(3, 2);
  const g2 = c.getContext('2d');
  const rows = [];
  for (const [r, [name, x, z]] of places.entries()) {
    for (const [k, hgt] of heights.entries()) {
      const g = hold(D, x, z, hgt);
      h.fm.reset({ position: [x, g + hgt, z], heading: 0, running: 'flight', inAir: true, controls: { collective: 0.47, pedal: -0.38 } });
      h.assist.reset(h.fm.state);
      for (const p of h._dust) {
        p.userData.life = 0;
        p.visible = false;
      }
      for (let i = 0; i < 150; i++) D.step(1 / 60);
      const s = h.fm.state;
      const st = dust(h, s.position.x, s.position.z);
      const row = { place: name, skidM: +(s.position.y - g).toFixed(1), wash: +(h.washStrength || 0).toFixed(2), ...st };
      rows.push(row);
      for (let i = 0; i < 6; i++) {
        D.step(1 / 60);
        D.sheet.cam([s.position.x + 22, g + 2.2, s.position.z + 14], [s.position.x, g + Math.min(hgt, 4), s.position.z], 50);
        D.render();
      }
      const src = D.renderer.domElement;
      g2.drawImage(src, 0, 0, src.width, src.height, k * W, r * H, W, H);
      label(g2, k * W, r * H, `${tag} ${name} skid ${row.skidM} m wash ${row.wash} dust ${st.n} mean ${st.meanM} m far ${st.farM} m out ${st.outMs} m/s`);
    }
  }
  D.heliInput = null;
  await post(c, `${tag}_wash_hovers`);
  c.remove();
  return rows;
}

/** From standing on the dirt with the rotor at flight speed, the collective raised over 4 s: tiles at skid heights. */
export async function liftoff(tag = 'v4', x = -160, z = 200) {
  const D = window.demo;
  D.timeScale = 0;
  D.seatInHeli();
  const h = D.heli;
  const g = groundAt(x, z);
  h.fm.reset({ position: [x, g, z], heading: 0, running: 'flight', inAir: false, controls: { collective: 0.1, pedal: -0.2 } });
  h.assist.reset(h.fm.state);
  for (const p of h._dust) {
    p.userData.life = 0;
    p.visible = false;
  }
  let t = 0;
  D.heliInput = (hh) => {
    const s = hh.fm.state;
    hh.fm.setControls({ collective: Math.min(0.62, 0.1 + 0.13 * t), cyclicPitch: 0.02 * s.velocity.z, cyclicRoll: -0.02 * s.velocity.x, pedal: -0.2 - 0.3 * Math.min(1, t / 4) });
  };
  const c = overlay(3, 2);
  const g2 = c.getContext('2d');
  const marks = [0.5, 2.0, 3.0, 3.6, 4.3, 5.5];
  const rows = [];
  let n = 0;
  for (let i = 0; i < 600 && n < marks.length; i++) {
    t = i / 60;
    D.step(1 / 60);
    if (t >= marks[n]) {
      const s = h.fm.state;
      const st = dust(h, s.position.x, s.position.z);
      const row = { t: marks[n], skidM: +(s.position.y - g).toFixed(2), wash: +(h.washStrength || 0).toFixed(2), thrustW: +((s.rotor.thrust || 0) / (s.mass * 9.81)).toFixed(2), ...st };
      rows.push(row);
      for (let k = 0; k < 6; k++) {
        D.step(1 / 60);
        D.sheet.cam([x + 22, g + 2.2, z + 14], [x, g + 2, z], 50);
        D.render();
      }
      const src = D.renderer.domElement;
      g2.drawImage(src, 0, 0, src.width, src.height, (n % 3) * W, Math.floor(n / 3) * H, W, H);
      label(g2, (n % 3) * W, Math.floor(n / 3) * H, `${tag} lift-off t ${row.t} s skid ${row.skidM} m T/W ${row.thrustW} wash ${row.wash} dust ${st.n} far ${st.farM} m`);
      n++;
    }
  }
  D.heliInput = null;
  await post(c, `${tag}_wash_liftoff`);
  c.remove();
  return rows;
}
