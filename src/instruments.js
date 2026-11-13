// (V5) Live instruments: the car's cluster and centre screen and the helicopter's displays drawn into canvas textures
// that replace the display materials' emissive maps, in the artwork's own layout and style.
//
// Car: the asset's display_emissive.png (1024 x 512) is two screens: the cluster (u 0..1, v 0..0.44: the image's top
// 225 rows) and the centre screen (u 0..0.4, v 0.5..1: 410 x 256 at the bottom left), read from the GLB's UVs. The
// cluster keeps the artwork's two rings and the bar row between them: left ring speed (km/h, digits in it), right ring
// the rev counter (0..9000, red from 8500), the bars the shift lights (6500 .. 8250 rpm, all flashing at the limiter),
// the gear and A / M under them, then the lamps (TC and ABS lit while they act, headlights, handbrake), fuel and
// coolant as steady values. The centre screen: the g-meter with its last 3 s of trace, and the four tyres' slip.
// On ignition the needles sweep and every lamp lights for a second (the lamp check).
//
// Helicopter: displays_emissive.png (2048 x 1024) has thirteen screens (utility_helicopter/source/hb/interior.py
// DISP). Redrawn live: PFD (attitude with pitch ladder and bank pointer, IAS tape in knots, altitude tape in feet with
// the radar altitude, vertical speed, heading strip), EICAS (TQ %, TOT, N1 = Ng %, one dial with the NR and N2
// needles, fuel, fuel flow), the caution panel (lamps from the flight model's flags) and the three standby dials (ASI,
// attitude, altimeter). The radios, GPS, map, clock and overhead panel keep the artwork (drawn once from it).
// Values come from the flight model's state; derived ones are said where they are made (TOT, N2, fuel flow).
//
// Rate: each texture is redrawn and uploaded at most RATE times a second (car 15, its centre screen 7.5, helicopter 10 at 1024 x 512, the
// helicopter's slow screens every other time); nothing is drawn while the vehicle is dark.
import * as THREE from 'three/webgpu';

const D2R = Math.PI / 180;
const FONT = '"DIN Alternate", "Arial Narrow", Arial, sans-serif';
const C = {
  white: 'rgb(235,240,240)', green: 'rgb(60,235,90)', cyan: 'rgb(70,215,240)', magenta: 'rgb(240,80,235)',
  amber: 'rgb(250,180,40)', red: 'rgb(245,60,50)', grey: 'rgb(120,128,135)', dim: 'rgb(55,62,68)',
  sky: 'rgb(40,120,215)', ground: 'rgb(125,82,40)', bg: 'rgb(4,6,8)',
  // the car's artwork
  carBg: 'rgb(13,17,23)', carPanel: 'rgb(19,25,33)', yellow: 'rgb(248,204,64)', ice: 'rgb(120,220,248)', mint: 'rgb(152,236,170)', bar: 'rgb(138,142,150)',
};

function canvasTexture(w, h, like) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = like ? like.flipY : false;
  if (like) {
    t.wrapS = like.wrapS;
    t.wrapT = like.wrapT;
  }
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { c, g: c.getContext('2d'), t };
}
const font = (px, bold = true) => `${bold ? 'bold ' : ''}${px}px ${FONT}`;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function text(g, s, x, y, px, col, align = 'center', base = 'middle') {
  g.font = font(px);
  g.fillStyle = col;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillText(s, x, y);
}
function line(g, pts, col, w) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}
function arc(g, x, y, r, a0, a1, col, w) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.arc(x, y, r, a0 * D2R, a1 * D2R);
  g.stroke();
}

// ================================================================================================ car
export class CarDash {
  constructor(car) {
    this.car = car;
    this.mat = car.mats && car.mats.display;
    this.ok = !!(this.mat && this.mat.emissiveMap && this.mat.emissiveMap.image);
    this.rate = 15;
    this._acc = 1;
    this._n = 0;
    this.sweep = -1; // s since the lamp check started (-1: none)
    this.trace = [];
    this.shown = {}; // what the last drawing showed (for the comparisons)
    if (!this.ok) return;
    const W = 1024;
    const H = 512;
    this.tex = canvasTexture(W, H, this.mat.emissiveMap);
    this.base = this.mat.emissiveMap;
    this.mat.emissiveMap = this.tex.t;
    this.mat.needsUpdate = true;
    this.drawCount = 0;
    this.ms = 0;
  }

  /** The lamp check (ignition on). */
  lampCheck() {
    this.sweep = 0;
  }

  update(dt, force = false) {
    if (!this.ok) return;
    const car = this.car;
    if (this.sweep >= 0) this.sweep += dt;
    if (this.sweep > 1.4) this.sweep = -1;
    const d = car.dyn;
    // the trace (every frame, so its 3 s are even)
    this.trace.push(d.accBody.x / 9.81, -d.accBody.z / 9.81);
    if (this.trace.length > 2 * 180) this.trace.splice(0, 2);
    this._acc += dt;
    if (!force && this._acc < 1 / this.rate) return;
    this._acc = 0;
    // (lit with the ignition: the key on, or the engine running, as in the scripted drives; dark once it is off)
    if (!car.ignitionOn && car.dyn.ignition === 'off' && !force) {
      if (this._lit) {
        this._lit = false;
        this.tex.g.fillStyle = 'rgb(0,0,0)';
        this.tex.g.fillRect(0, 0, 1024, 512);
        this.tex.t.needsUpdate = true;
      }
      return;
    }
    this._lit = true;
    const t0 = performance.now();
    this._cluster();
    if (force || this._n++ % 2 === 0) this._centre(); // (the centre screen at half the rate)
    this.tex.t.needsUpdate = true;
    this.drawCount++;
    this.ms += performance.now() - t0;
  }

  _cluster() {
    const { g } = this.tex;
    const car = this.car;
    const d = car.dyn;
    const W = 1024;
    const H = 225;
    g.fillStyle = C.carBg;
    g.fillRect(0, 0, W, 256);
    // the lamp check: needles to the end and back, every lamp on
    const sw = this.sweep >= 0 ? Math.sin(Math.PI * clamp(this.sweep / 1.2, 0, 1)) : 0;
    const check = this.sweep >= 0 && this.sweep < 1.2;
    const kmh = Math.abs(d.speed) * 3.6;
    const rpm = d.rpm;
    const showKmh = check ? Math.max(kmh, 360 * sw) : kmh;
    const showRpm = check ? Math.max(rpm, 9000 * sw) : rpm;
    // ---- left ring: speed (yellow, as the artwork) ----
    const L = { x: 250, y: 133, r: 92 };
    const a0 = 125;
    const span = 290;
    arc(g, L.x, L.y, L.r, a0, a0 + span, 'rgb(96,102,112)', 7);
    arc(g, L.x, L.y, L.r, a0, a0 + span * clamp(showKmh / 360, 0, 1), C.yellow, 12);
    arc(g, L.x, L.y, L.r - 22, a0, a0 + span, 'rgb(128,132,140)', 1.5);
    for (let v = 0; v <= 360; v += 20) {
      const a = (a0 + (span * v) / 360) * D2R;
      const big = v % 60 === 0;
      line(g, [L.x + Math.cos(a) * (L.r - 14), L.y + Math.sin(a) * (L.r - 14), L.x + Math.cos(a) * (L.r - (big ? 2 : 7)), L.y + Math.sin(a) * (L.r - (big ? 2 : 7))], C.white, big ? 2.5 : 1.5);
      if (big) text(g, String(v), L.x + Math.cos(a) * (L.r - 34), L.y + Math.sin(a) * (L.r - 34), 13, 'rgb(170,176,184)');
    }
    text(g, String(Math.round(showKmh)), L.x, L.y - 28, 54, C.white);
    text(g, 'km/h', L.x, L.y + 8, 16, 'rgb(150,156,164)');
    // ---- right ring: revs (cyan, red from 8500) ----
    const R = { x: 775, y: 133, r: 92 };
    arc(g, R.x, R.y, R.r, a0, a0 + span, 'rgb(96,102,112)', 7);
    arc(g, R.x, R.y, R.r, a0 + (span * 8500) / 9000, a0 + span, C.red, 7);
    const rf = clamp(showRpm / 9000, 0, 1);
    arc(g, R.x, R.y, R.r, a0, a0 + span * rf, showRpm > 8500 ? C.red : C.ice, 12);
    for (let v = 0; v <= 9000; v += 500) {
      const a = (a0 + (span * v) / 9000) * D2R;
      const big = v % 1000 === 0;
      line(g, [R.x + Math.cos(a) * (R.r - 14), R.y + Math.sin(a) * (R.r - 14), R.x + Math.cos(a) * (R.r - (big ? 2 : 7)), R.y + Math.sin(a) * (R.r - (big ? 2 : 7))], v >= 8500 ? C.red : C.white, big ? 2.5 : 1.5);
      if (big) text(g, String(v / 1000), R.x + Math.cos(a) * (R.r - 30), R.y + Math.sin(a) * (R.r - 30), 14, v >= 8500 ? C.red : 'rgb(170,176,184)');
    }
    // the needle
    const an = (a0 + span * rf) * D2R;
    line(g, [R.x + Math.cos(an) * 18, R.y + Math.sin(an) * 18, R.x + Math.cos(an) * (R.r - 6), R.y + Math.sin(an) * (R.r - 6)], C.white, 3);
    text(g, String(Math.round(showRpm / 10) * 10), R.x, R.y - 30, 30, C.white);
    text(g, 'rpm', R.x, R.y - 6, 13, 'rgb(150,156,164)');
    // ---- the bars between them: shift lights 6500 .. 8250, all flashing at the limiter ----
    const lim = d.engine.cut || rpm > 8450;
    const flash = lim && Math.floor(performance.now() / 70) % 2 === 0;
    for (let i = 0; i < 7; i++) {
      const x = 418 + i * 28;
      const h = 8 + i * 6;
      const on = check || rpm >= 6500 + (i * (8250 - 6500)) / 6;
      const col = i < 3 ? C.mint : i < 5 ? C.yellow : C.red;
      g.fillStyle = lim ? (flash ? C.red : 'rgb(40,44,50)') : on ? col : 'rgb(48,52,58)';
      g.fillRect(x, 66 - h, 18, h);
    }
    // gear and the box's mode (in the middle, under the bars)
    const gear = d.gearName;
    text(g, d.ignition === 'off' && !check ? 'P' : gear, 505, 104, 50, d.shift ? C.yellow : C.white);
    text(g, d.auto ? 'A' : 'M', 556, 112, 22, d.auto ? C.ice : C.yellow);
    // ---- lamps (row on the line the artwork draws at y 215) ----
    g.fillStyle = 'rgb(120,124,130)';
    g.fillRect(60, 214, 904, 2);
    const tcOn = check || d.tc < 0.97;
    const absOn = check || d.wheels.some((w) => w.abs < 0.97);
    const lamps = [
      ['TC', tcOn, C.amber, 412],
      ['ABS', absOn, C.amber, 466],
      ['◖≡', check || car.headlights, C.mint, 560], // headlamp tell-tale
      ['(P)', check || d.input.handbrake > 0.5 || (d.ignition === 'off' && car.ignitionOn), C.red, 612],
    ];
    for (const [s, on, col, x] of lamps) text(g, s, x, 146, 19, on ? col : 'rgb(44,48,54)');
    // indicators
    const blink = Math.floor(car._t * 2.6) % 2 === 0;
    text(g, '◀', 330, 40, 22, (car.indicator < 0 && blink) || check ? C.mint : 'rgb(40,44,50)');
    text(g, '▶', 694, 40, 22, (car.indicator > 0 && blink) || check ? C.mint : 'rgb(40,44,50)');
    // fuel and coolant: steady (no burn, no heat modelled): bars under the rings
    g.fillStyle = 'rgb(40,44,50)';
    g.fillRect(200, 196, 100, 6);
    g.fillRect(725, 196, 100, 6);
    g.fillStyle = C.ice;
    g.fillRect(200, 196, 100 * (check ? 1 : 0.68), 6);
    g.fillStyle = C.mint;
    g.fillRect(725, 196, 100 * (check ? 1 : d.ignition === 'off' ? 0.5 : 0.55), 6);
    text(g, 'FUEL', 180, 199, 11, 'rgb(150,156,164)', 'right');
    text(g, '90°C', 840, 199, 11, 'rgb(150,156,164)', 'left');
    this.shown = { kmh: Math.round(showKmh), rpm: Math.round(showRpm / 10) * 10, gear, auto: d.auto, tc: tcOn, abs: absOn, lights: car.headlights, check };
  }

  _centre() {
    const { g } = this.tex;
    const d = this.car.dyn;
    const x0 = 0;
    const y0 = 256;
    const W = 410;
    const H = 256;
    g.fillStyle = C.carPanel;
    g.fillRect(x0, y0, W, H);
    // g-meter: rings at 0.5, 1.0, 1.5 g
    const cx = x0 + 120;
    const cy = y0 + 132;
    const S = 64; // px per g
    g.strokeStyle = 'rgb(70,78,88)';
    g.lineWidth = 1.5;
    for (const r of [0.5, 1, 1.5]) {
      g.beginPath();
      g.arc(cx, cy, r * S, 0, Math.PI * 2);
      g.stroke();
    }
    line(g, [cx - 1.6 * S, cy, cx + 1.6 * S, cy], 'rgb(70,78,88)', 1);
    line(g, [cx, cy - 1.6 * S, cx, cy + 1.6 * S], 'rgb(70,78,88)', 1);
    // the trace: last 3 s, fading
    const T = this.trace;
    const n = T.length / 2;
    for (let i = 1; i < n; i++) {
      g.strokeStyle = `rgba(120,220,248,${(0.15 + 0.85 * (i / n)).toFixed(2)})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx + clamp(T[i * 2 - 2], -1.6, 1.6) * S, cy - clamp(T[i * 2 - 1], -1.6, 1.6) * S);
      g.lineTo(cx + clamp(T[i * 2], -1.6, 1.6) * S, cy - clamp(T[i * 2 + 1], -1.6, 1.6) * S);
      g.stroke();
    }
    const lat = d.accBody.x / 9.81;
    const lon = -d.accBody.z / 9.81;
    g.fillStyle = C.yellow;
    g.beginPath();
    g.arc(cx + clamp(lat, -1.6, 1.6) * S, cy - clamp(lon, -1.6, 1.6) * S, 7, 0, Math.PI * 2);
    g.fill();
    text(g, `${Math.hypot(lat, lon).toFixed(2)} g`, x0 + 14, y0 + 22, 20, C.white, 'left');
    // the tyres: slip (combined, against the peak), a tile each like the artwork's tiles
    const ty = d.spec.tyre;
    d.wheels.forEach((w, i) => {
      const s = Math.hypot(w.kappa / ty.kappaPeak, Math.tan(w.alpha) / Math.tan(ty.alphaPeak));
      const col = s < 0.6 ? C.mint : s < 1.0 ? C.yellow : C.red;
      const x = x0 + 268 + (i % 2) * 66;
      const y = y0 + 34 + Math.floor(i / 2) * 104;
      g.fillStyle = 'rgb(30,36,44)';
      g.fillRect(x, y, 50, 80);
      g.fillStyle = col;
      const h = 80 * clamp(s / 1.5, 0.04, 1);
      g.fillRect(x, y + 80 - h, 50, h);
      text(g, `${Math.round(s * 100)}`, x + 25, y + 92, 14, 'rgb(190,196,204)');
    });
    text(g, 'SLIP %', x0 + 324, y0 + 18, 13, 'rgb(150,156,164)');
  }
}

// ================================================================================================ helicopter
const DISP = {
  pfd: [8, 8, 664, 498], mfd: [688, 8, 664, 498], eicas: [1368, 8, 664, 498],
  asi: [1128, 524, 240, 240], att: [1384, 524, 240, 240], alt: [1640, 524, 240, 240], caution: [1128, 780, 752, 96],
};
const KT = 1.943844; // m/s -> kt
const FT = 3.28084;

export class HeliPanel {
  constructor(heli) {
    this.heli = heli;
    this.mat = heli.mats && heli.mats.display_emissive;
    this.ok = !!(this.mat && this.mat.emissiveMap && this.mat.emissiveMap.image);
    this.rate = 10;
    this._acc = 1;
    this.n = 0;
    this.shown = {};
    this.drawCount = 0;
    this.ms = 0;
    if (!this.ok) return;
    const src = this.mat.emissiveMap;
    // ((V5) drawn at 1024 x 512: the PFD is still 332 px wide, more than it covers on the screen from the seat, and
    // the 2048 canvas cost 5.9 ms a drawing and four times the upload)
    this.W = Math.min(1024, src.image.width);
    this.H = Math.min(512, src.image.height);
    this.k = this.W / 2048; // the shrunk texture's scale against the artwork's 2048
    this.tex = canvasTexture(this.W, this.H, src);
    // the artwork once (the screens that are not redrawn keep it)
    this.tex.g.drawImage(src.image, 0, 0, this.W, this.H);
    this.mat.emissiveMap = this.tex.t;
    this.mat.needsUpdate = true;
    this.cautions = {};
  }

  /** Lamps to light on the caution panel this frame (main.js / heli.js decide them). */
  update(dt, lamps = {}, force = false) {
    if (!this.ok) return;
    this._acc += dt;
    this.cautions = lamps;
    // (a lamp changing is drawn the same frame, so the panel lights with the tone; the rest at the rate)
    const key = Object.keys(lamps).filter((k) => lamps[k]).join();
    if (key !== this._lampKey && this.ok && (this.heli.power || this.heli.state.engine.lit)) {
      this._lampKey = key;
      this._screen(this.tex.g, 'caution', (s, w, hh) => this._caution(s, w, hh));
      this.tex.t.needsUpdate = true;
    }
    if (!force && this._acc < 1 / this.rate) return;
    this._acc = 0;
    const h = this.heli;
    const e = h.state.engine;
    if (!force && !(h.power || e.lit || e.starter)) return;
    const t0 = performance.now();
    const g = this.tex.g;
    const slow = force || this.n % 2 === 0;
    this.n++;
    this._screen(g, 'pfd', (s, w, hh) => this._pfd(s, w, hh));
    if (slow) {
      this._screen(g, 'eicas', (s, w, hh) => this._eicas(s, w, hh));
      this._screen(g, 'caution', (s, w, hh) => this._caution(s, w, hh));
      this._screen(g, 'asi', (s, w) => this._asi(s, w));
      this._screen(g, 'att', (s, w) => this._att(s, w));
      this._screen(g, 'alt', (s, w) => this._alt(s, w));
    }
    this.tex.t.needsUpdate = true;
    this.drawCount++;
    this.ms += performance.now() - t0;
  }

  _screen(g, name, draw) {
    const [x, y, w, h] = DISP[name];
    const k = this.k;
    g.save();
    g.translate(x * k, y * k);
    g.scale(k, k);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, w, h);
    g.restore();
  }

  _pfd(g, w, h) {
    const s = this.heli.state;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    const cx = w * 0.47;
    const cy = h * 0.46;
    const aw = 360;
    const ah = 300;
    const pitch = s.pitch / D2R;
    const bank = s.bank / D2R;
    const ppd = 6.0;
    // attitude: the horizon turned by the bank (right side down: the horizon turns counter-clockwise)
    g.save();
    g.beginPath();
    g.rect(cx - aw / 2, cy - ah / 2, aw, ah);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-bank * D2R);
    const mid = pitch * ppd;
    g.fillStyle = C.sky;
    g.fillRect(-500, -900 + mid, 1000, 900);
    g.fillStyle = C.ground;
    g.fillRect(-500, mid, 1000, 900);
    line(g, [-500, mid, 500, mid], C.white, 3);
    for (let deg = -30; deg <= 30; deg += 5) {
      if (!deg) continue;
      const y = mid - deg * ppd;
      if (Math.abs(y) > 170) continue;
      const half = deg % 10 === 0 ? 46 : 22;
      line(g, [-half, y, half, y], C.white, 2);
      if (deg % 10 === 0) for (const sx of [-1, 1]) text(g, String(Math.abs(deg)), sx * (half + 18), y, 16, C.white);
    }
    g.restore();
    // bank scale and pointer
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r0 = 132;
      const r1 = 132 + (a % 30 === 0 ? 14 : 8);
      const t = (a - 90) * D2R;
      line(g, [cx + r0 * Math.cos(t), cy + r0 * Math.sin(t), cx + r1 * Math.cos(t), cy + r1 * Math.sin(t)], C.white, 2);
    }
    g.save();
    g.translate(cx, cy);
    g.rotate(-clamp(bank, -65, 65) * D2R);
    g.fillStyle = C.white;
    g.beginPath();
    g.moveTo(0, -131);
    g.lineTo(-8, -117);
    g.lineTo(8, -117);
    g.fill();
    g.restore();
    // aircraft symbol
    for (const sx of [-1, 1]) line(g, [cx + sx * 96, cy, cx + sx * 38, cy, cx + sx * 38, cy + 12], C.amber, 5);
    g.fillStyle = C.amber;
    g.fillRect(cx - 5, cy - 5, 10, 10);
    // ---- airspeed tape (IAS, kt) ----
    const spd = s.ias * KT;
    const tx0 = 18;
    const tx1 = 92;
    g.fillStyle = 'rgb(22,28,34)';
    g.fillRect(tx0, cy - 150, tx1 - tx0, 300);
    g.strokeStyle = C.grey;
    g.lineWidth = 1.5;
    g.strokeRect(tx0, cy - 150, tx1 - tx0, 300);
    for (let v = Math.max(0, Math.floor(spd / 10) * 10 - 60); v <= spd + 60; v += 10) {
      const y = cy - (v - spd) * 2.6;
      if (y < cy - 146 || y > cy + 146) continue;
      line(g, [tx1 - 12, y, tx1, y], C.white, 2);
      if (v % 20 === 0) text(g, String(v), tx1 - 16, y, 19, C.white, 'right');
    }
    // never-exceed (260 km/h = 140 kt): red from it
    const yv = cy - (140 - spd) * 2.6;
    if (yv > cy - 150) {
      g.fillStyle = C.red;
      g.fillRect(tx1 - 4, cy - 150, 4, Math.max(0, yv - (cy - 150)));
    }
    this._box(g, [tx0 + 2, cy - 17, tx1 - 14, cy - 17, tx1 - 2, cy, tx1 - 14, cy + 17, tx0 + 2, cy + 17]);
    const spdTxt = spd < 20 ? '--' : String(Math.round(spd));
    text(g, spdTxt, tx0 + 34, cy, 26, C.green);
    text(g, 'IAS KT', (tx0 + tx1) / 2, cy - 164, 14, C.cyan);
    // ---- altitude tape (ft) ----
    const alt = s.altitude * FT;
    const ax0 = w - 118;
    const ax1 = w - 22;
    g.fillStyle = 'rgb(22,28,34)';
    g.fillRect(ax0, cy - 150, ax1 - ax0, 300);
    g.strokeStyle = C.grey;
    g.strokeRect(ax0, cy - 150, ax1 - ax0, 300);
    for (let v = Math.floor(alt / 100) * 100 - 300; v <= alt + 300; v += 20) {
      const y = cy - (v - alt) * 0.55;
      if (y < cy - 146 || y > cy + 146) continue;
      const big = v % 100 === 0;
      line(g, [ax0, y, ax0 + (big ? 12 : 6), y], C.white, big ? 2 : 1);
      if (v % 200 === 0) text(g, String(v), ax0 + 16, y, 19, C.white, 'left');
    }
    // the ground on the tape (radar altitude)
    const gy = cy + s.radarHeight * FT * 0.55;
    if (gy < cy + 150) {
      g.fillStyle = 'rgb(125,82,40)';
      g.fillRect(ax0 + 1, gy, ax1 - ax0 - 2, cy + 150 - gy);
    }
    this._box(g, [ax1 - 2, cy - 17, ax0 + 14, cy - 17, ax0 + 2, cy, ax0 + 14, cy + 17, ax1 - 2, cy + 17]);
    text(g, String(Math.round(alt)), ax0 + 56, cy, 26, C.green);
    text(g, 'ALT FT', (ax0 + ax1) / 2, cy - 164, 14, C.cyan);
    const ra = s.radarHeight * FT;
    text(g, ra < 2500 ? `RA ${Math.round(ra)}` : '29.92 IN', (ax0 + ax1) / 2, cy + 166, 18, ra < 2500 ? C.green : C.cyan);
    // ---- vertical speed (fpm), the artwork's scale at the right edge: +-2000 fpm over +-110 px ----
    const vs = s.verticalSpeed * FT * 60;
    line(g, [w - 12, cy - 110, w - 12, cy + 110], C.grey, 2);
    for (const v of [-2000, -1000, 0, 1000, 2000]) line(g, [w - 16, cy - (v / 2000) * 110, w - 8, cy - (v / 2000) * 110], C.grey, 1.5);
    const vy = cy - clamp(vs / 2000, -1, 1) * 110;
    g.fillStyle = C.green;
    g.beginPath();
    g.moveTo(w - 20, vy);
    g.lineTo(w - 6, vy - 6);
    g.lineTo(w - 6, vy + 6);
    g.fill();
    text(g, (vs >= 0 ? '+' : '') + Math.round(vs / 10) * 10, w - 72, cy - 128, 18, C.green);
    // ---- heading strip ----
    const hdg = ((s.heading / D2R) % 360 + 360) % 360;
    const hy = h - 62;
    g.fillStyle = 'rgb(22,28,34)';
    g.fillRect(110, hy - 18, w - 250, 36);
    g.strokeStyle = C.grey;
    g.strokeRect(110, hy - 18, w - 250, 36);
    for (let v = 0; v < 360; v += 5) {
      const x = cx + (((v - hdg + 540) % 360) - 180) * 5.2;
      if (x < 114 || x > w - 144) continue;
      line(g, [x, hy - 18, x, hy - (v % 10 === 0 ? 8 : 13)], C.white, 2);
      if (v % 30 === 0) text(g, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] || String(v / 10).padStart(2, '0'), x, hy + 4, 18, C.white);
    }
    g.fillStyle = C.magenta;
    g.beginPath();
    g.moveTo(cx, hy - 20);
    g.lineTo(cx - 8, hy - 32);
    g.lineTo(cx + 8, hy - 32);
    g.fill();
    text(g, `HDG ${String(Math.round(hdg) % 360).padStart(3, '0')}`, cx, hy - 46, 19, C.magenta);
    // annunciators: what the assist is doing
    const a = this.heli.assist;
    const m = a.enabled ? a.modes : {};
    const ann = [['ATT', m.attitudeHold], ['HDG', m.headingHold], ['HOVER', m.hoverHold], ['SAS', a.enabled]];
    ann.forEach(([lab, on], i) => {
      g.strokeStyle = C.dim;
      g.lineWidth = 1.5;
      g.strokeRect(118 + i * 92, 6, 84, 22);
      text(g, lab, 118 + i * 92 + 42, 17, 17, on ? C.green : 'rgb(70,76,82)');
    });
    this._softkeys(g, w, h, ['PFD', 'HSI', 'BARO', 'BRG', 'TMR', 'MENU']);
    this.shown.pfd = { iasKt: spd < 20 ? null : Math.round(spd), altFt: Math.round(alt), raFt: Math.round(ra), vsFpm: Math.round(vs / 10) * 10, hdg: Math.round(hdg) % 360, pitch: +pitch.toFixed(1), bank: +bank.toFixed(1) };
  }

  _box(g, pts) {
    g.fillStyle = C.bg;
    g.strokeStyle = C.white;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fill();
    g.stroke();
  }

  _softkeys(g, w, h, labels) {
    const y = h - 16;
    g.fillStyle = 'rgb(6,9,12)';
    g.fillRect(0, y - 15, w, h);
    labels.forEach((lab, i) => {
      const x0 = 8 + (i * (w - 16)) / labels.length;
      const x1 = x0 + (w - 16) / labels.length - 6;
      g.strokeStyle = C.dim;
      g.lineWidth = 1.5;
      g.strokeRect(x0, y - 11, x1 - x0, 22);
      text(g, lab, (x0 + x1) / 2, y, 12, C.cyan);
    });
  }

  _arcGauge(g, x, y, r, frac, label, value, unit, redFrom = 0.9, amberFrom = 0.78) {
    const a0 = 150;
    const a1 = 390;
    const at = (f) => a0 + (a1 - a0) * f;
    arc(g, x, y, r, a0, a1, C.grey, 5);
    arc(g, x, y, r, a0, at(Math.min(frac, amberFrom)), C.green, 5);
    arc(g, x, y, r, at(amberFrom), at(redFrom), C.amber, 5);
    arc(g, x, y, r, at(redFrom), a1, C.red, 5);
    const t = at(clamp(frac, 0, 1.08)) * D2R;
    line(g, [x, y, x + (r - 8) * Math.cos(t), y + (r - 8) * Math.sin(t)], C.white, 3);
    g.fillStyle = C.white;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
    text(g, label, x, y - r - 12, 13, C.cyan);
    text(g, value, x, y + 26, 20, frac >= redFrom ? C.red : frac >= amberFrom ? C.amber : C.green);
    text(g, unit, x, y + 46, 11, C.grey);
  }

  _eicas(g, w, h) {
    const s = this.heli.state;
    const e = s.engine;
    const r = s.rotor;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(10,16,22)';
    g.fillRect(0, 0, w, 28);
    text(g, 'ENGINE / SYSTEMS', 12, 14, 14, C.cyan, 'left');
    const tq = Math.max(0, e.torquePercent);
    // TOT (derived, not a state of the model: a turbine's outlet temperature follows its power):
    // 150 C cold-soaked when off; lit: 450 C at ground idle rising with the gas generator's power to 810 C at its
    // 100 % (the power map's fraction), so it follows power and spools down with Ng after the fuel is cut
    const pFrac = e.powerThermo / 560e3;
    const tot = e.lit ? 450 + 360 * Math.pow(clamp(pFrac, 0, 1.2) / 1.0, 0.8) : Math.max(150, 150 + (e.ng / 60) * 300);
    this._arcGauge(g, 100, 120, 62, tq / 110, 'TQ', String(Math.round(tq)), '%', 100 / 110, 90 / 110);
    this._arcGauge(g, 260, 120, 62, tot / 900, 'TOT', String(Math.round(tot)), '°C', 810 / 900, 738 / 900);
    this._arcGauge(g, 420, 120, 62, e.ng / 110, 'N1', e.ng.toFixed(1), '%', 104 / 110, 101 / 110);
    // NR and N2 on one dial (0..120 %): N2 is the power turbine. With the freewheel driving (torque on the shaft)
    // it turns with the rotor; with no torque it is shown falling with the gas generator (Ng / ground idle: an
    // approximation, the model has no free-turbine speed of its own)
    const nr = r.percent;
    const n2 = tq > 0.5 && e.lit ? nr : Math.min(nr, (e.ng / 60) * 100);
    const dx = 590;
    const dy = 125;
    const R = 70;
    const ang = (p) => (135 + (clamp(p, 0, 120) / 120) * 270) * D2R;
    g.strokeStyle = C.grey;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(dx, dy, R, 135 * D2R, 405 * D2R);
    g.stroke();
    arc(g, dx, dy, R - 4, (ang(95) / D2R), (ang(107) / D2R), C.green, 6);
    arc(g, dx, dy, R - 4, (ang(85) / D2R), (ang(95) / D2R), C.amber, 6);
    arc(g, dx, dy, R - 4, (ang(107) / D2R), (ang(110) / D2R), C.red, 6);
    for (let p = 0; p <= 120; p += 20) {
      const a = ang(p);
      line(g, [dx + Math.cos(a) * (R - 12), dy + Math.sin(a) * (R - 12), dx + Math.cos(a) * R, dy + Math.sin(a) * R], C.white, 2);
    }
    for (const [p, col, len, lw] of [[n2, C.cyan, R - 22, 3], [nr, C.white, R - 6, 4]]) {
      const a = ang(p);
      line(g, [dx, dy, dx + Math.cos(a) * len, dy + Math.sin(a) * len], col, lw);
    }
    text(g, 'NR', dx - 24, dy - R - 12, 13, C.white);
    text(g, 'N2', dx + 24, dy - R - 12, 13, C.cyan);
    text(g, String(Math.round(nr)), dx - 24, dy + 44, 17, nr < 95 && nr > 10 ? C.amber : C.green);
    text(g, String(Math.round(n2)), dx + 24, dy + 44, 17, C.cyan);
    // the artwork's bars (oil, transmission, hydraulics, battery): the system values the model does not have,
    // shown as the artwork has them while the engine runs, falling to zero pressure with it stopped
    const run = clamp(e.ng / 60, 0, 1);
    const bars = [['OIL PRESS', 0.58 * run, `${Math.round(72 * run)} PSI`], ['OIL TEMP', 0.46, '82 °C'], ['XMSN PRESS', 0.55 * clamp(nr / 80, 0, 1), `${Math.round(48 * clamp(nr / 80, 0, 1))} PSI`], ['XMSN TEMP', 0.4, '74 °C'], ['HYD', 0.62 * clamp(nr / 60, 0, 1), `${Math.round(1020 * clamp(nr / 60, 0, 1))} PSI`], ['BATT', 0.86, e.ng > 55 ? '27.9 V' : '24.6 V']];
    bars.forEach(([lab, frac, val], i) => {
      const x0 = 20 + (i % 2) * 322;
      const y = 262 + Math.floor(i / 2) * 46;
      text(g, lab, x0, y, 12, C.cyan, 'left');
      g.strokeStyle = C.grey;
      g.lineWidth = 1.5;
      g.strokeRect(x0 + 100, y - 7, 140, 14);
      g.fillStyle = C.green;
      g.fillRect(x0 + 102, y - 5, 136 * frac, 10);
      text(g, val, x0 + 300, y, 13, C.white, 'right');
    });
    // fuel: the load's fuel (386 kg) as a steady value (fuel burn is not modelled); flow from the engine's power
    // at a specific fuel consumption of 0.36 kg/kWh (derived)
    const flow = e.lit ? 0.36 * Math.max(e.powerThermo, 0.12 * 560e3) / 1000 : 0;
    g.strokeStyle = C.dim;
    g.strokeRect(20, 398, w - 40, 54);
    text(g, 'FUEL', 32, 412, 13, C.cyan, 'left');
    g.strokeStyle = C.grey;
    g.strokeRect(96, 404, 324, 18);
    g.fillStyle = C.green;
    g.fillRect(98, 406, 320 * 0.64, 14);
    text(g, '386 KG', 436, 413, 16, C.green, 'left');
    text(g, `FLOW ${Math.round(flow)} KG/H     ENDURANCE ${flow > 1 ? fmtTime(386 / flow) : '--:--'}     OAT +15 °C`, 32, 438, 12, C.white, 'left');
    this._softkeys(g, w, h, ['ENG', 'ELEC', 'FUEL', 'HYD', 'STAT', 'MENU']);
    this.shown.eicas = { tq: Math.round(tq), tot: Math.round(tot), n1: +e.ng.toFixed(1), nr: Math.round(nr), n2: Math.round(n2), flow: Math.round(flow) };
  }

  _caution(g, w, h) {
    const labs = ['ENG CHIP', 'ENG OIL', 'FUEL LOW', 'FUEL FILT', 'GEN', 'BATT HOT', 'XMSN OIL', 'XMSN CHIP', 'HYD', 'ROTOR LOW', 'DOOR', 'PITOT HT', 'TR CHIP', 'FIRE', 'ENG OUT', 'AP OFF', 'VRS', 'BUS TIE', 'OVERTORQ', 'LDG LT'];
    const lit = this.cautions;
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(0, 0, w, h);
    const cw = (w - 8) / 10;
    const ch = (h - 8) / 2;
    labs.forEach((lab, i) => {
      const x0 = 4 + (i % 10) * cw;
      const y0 = 4 + Math.floor(i / 10) * ch;
      const col = lit[lab] ? (lit[lab] === 'red' ? C.red : lit[lab] === 'green' ? C.green : C.amber) : null;
      // (lit: the lamp's whole face in its colour, the legend dark, as caution lamps are; the artwork's 30 % fill
      // could not be told from an unlit lamp from the seat)
      g.fillStyle = col || 'rgb(10,11,12)';
      g.fillRect(x0 + 2, y0 + 2, cw - 4, ch - 4);
      g.strokeStyle = 'rgb(40,42,44)';
      g.lineWidth = 1;
      g.strokeRect(x0 + 2, y0 + 2, cw - 4, ch - 4);
      text(g, lab, x0 + cw / 2, y0 + ch / 2, 11, col ? 'rgb(20,12,8)' : 'rgb(62,60,50)');
    });
    this.shown.caution = Object.keys(lit).filter((k) => lit[k]);
  }

  _dialFace(g, w) {
    const c = w / 2;
    const R = w / 2 - 6;
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(0, 0, w, w);
    g.fillStyle = 'rgb(12,13,14)';
    g.strokeStyle = 'rgb(70,74,78)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    return [c, R];
  }

  _asi(g, w) {
    const [c, R] = this._dialFace(g, w);
    const kt = this.heli.state.ias * KT;
    const at = (v) => (-90 + 30 + 300 * clamp(v / 200, 0, 1.05)) * D2R; // 20 kt per 30 deg as the artwork (0..200 over 300)
    for (let v = 0; v <= 200; v += 4) {
      const a = at(v);
      const big = v % 20 === 0;
      const r0 = R - (big ? 16 : 9);
      line(g, [c + r0 * Math.cos(a), c + r0 * Math.sin(a), c + (R - 3) * Math.cos(a), c + (R - 3) * Math.sin(a)], C.white, big ? 2.4 : 1.2);
      if (big && v) text(g, String(v), c + (R - 32) * Math.cos(a), c + (R - 32) * Math.sin(a), 17, C.white);
    }
    arc(g, c, c, R - 5, at(40) / D2R, at(120) / D2R, C.green, 4);
    arc(g, c, c, R - 5, at(120) / D2R, at(140) / D2R, C.amber, 4);
    const vne = at(140);
    line(g, [c + (R - 2) * Math.cos(vne), c + (R - 2) * Math.sin(vne), c + (R - 16) * Math.cos(vne), c + (R - 16) * Math.sin(vne)], C.red, 4);
    text(g, 'KNOTS', c, c + 36, 12, C.grey);
    const a = at(kt);
    line(g, [c - 12 * Math.cos(a), c - 12 * Math.sin(a), c + (R - 22) * Math.cos(a), c + (R - 22) * Math.sin(a)], C.white, 3.5);
    g.fillStyle = 'rgb(60,62,66)';
    g.beginPath();
    g.arc(c, c, 8, 0, Math.PI * 2);
    g.fill();
    this.shown.asi = Math.round(kt);
  }

  _att(g, w) {
    const [c, R] = this._dialFace(g, w);
    const s = this.heli.state;
    g.save();
    g.beginPath();
    g.arc(c, c, R - 6, 0, Math.PI * 2);
    g.clip();
    g.translate(c, c);
    g.rotate(-s.bank);
    const mid = (s.pitch / D2R) * 3.2;
    g.fillStyle = C.sky;
    g.fillRect(-w, -w + mid, 2 * w, w);
    g.fillStyle = C.ground;
    g.fillRect(-w, mid, 2 * w, w);
    line(g, [-w, mid, w, mid], C.white, 2);
    for (const dy of [-20, -10, 10, 20]) line(g, [-22, mid - dy * 3.2, 22, mid - dy * 3.2], C.white, 1.5);
    g.restore();
    for (const sx of [-1, 1]) line(g, [c + sx * 60, c, c + sx * 24, c, c + sx * 24, c + 9], C.amber, 4);
    g.fillStyle = C.amber;
    g.beginPath();
    g.arc(c, c, 4, 0, Math.PI * 2);
    g.fill();
  }

  _alt(g, w) {
    const [c, R] = this._dialFace(g, w);
    const ft = this.heli.state.altitude * FT;
    for (let i = 0; i < 50; i++) {
      const a = (-90 + (i / 50) * 360) * D2R;
      const big = i % 5 === 0;
      const r0 = R - (big ? 16 : 9);
      line(g, [c + r0 * Math.cos(a), c + r0 * Math.sin(a), c + (R - 3) * Math.cos(a), c + (R - 3) * Math.sin(a)], C.white, big ? 2.4 : 1.2);
      if (big) text(g, String(i / 5), c + (R - 32) * Math.cos(a), c + (R - 32) * Math.sin(a), 17, C.white);
    }
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(c + 18, c - 12, 52, 24);
    g.strokeStyle = C.grey;
    g.lineWidth = 1.5;
    g.strokeRect(c + 18, c - 12, 52, 24);
    text(g, '29.92', c + 44, c, 13, C.white);
    text(g, 'ALT', c, c - 38, 12, C.grey);
    // hundreds (long) and thousands (short)
    for (const [v, len, lw] of [[ft / 10000, R - 48, 5], [ft / 1000, R - 20, 3.5]]) {
      const a = (-90 + 360 * (v % 1)) * D2R;
      line(g, [c - 12 * Math.cos(a), c - 12 * Math.sin(a), c + len * Math.cos(a), c + len * Math.sin(a)], C.white, lw);
    }
    g.fillStyle = 'rgb(60,62,66)';
    g.beginPath();
    g.arc(c, c, 8, 0, Math.PI * 2);
    g.fill();
    this.shown.alt = Math.round(ft);
  }
}

function fmtTime(h) {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
