// (V6) The whole use of a vehicle as one chain, measured at every hand-over:
//   on foot with a gun -> stowing (the swap's outgoing half) -> walking to the entry point -> entering (car-enter /
//   heli-enter) -> seated -> leaving (car-exit / heli-exit) -> drawing (the swap's half backwards) -> on foot.
// demo.chainReview('car' | 'heli', { film }) plays it through demo.step at 60 Hz and records every frame the world
// positions of both hands, both feet, the head and the pelvis (the body's own skin bones, what is drawn), the
// character's root and the door. Per part: the largest one-frame change of velocity (m/s; a part moving with a clip
// at speed is not a jump, a change of its speed in one frame is), where it falls (the join within 12 frames of it,
// or the stage), and the largest one-frame step (cm). Per join the same, the root's jump (the change of its step
// from one frame to the next, cm) and the planted feet's slide on the ground outside the vehicle (cm per frame and
// the drift over one plant). With `film`, 25 frames round each join (12 either side) from a fixed three-quarter
// view at full frame rate, posted to the sheet receiver as chain_<kind>_<n>_<from>-<to>.jpg.
// Run as demo.chainReview('car').then(r => window.__cr = r): it takes a while (with film, minutes).
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';

const FPS = 60;
const PARTS = {
  handL: ['hand_l', 'LeftHand'],
  handR: ['hand_r', 'RightHand'],
  footL: ['foot_l', 'LeftFoot'],
  footR: ['foot_r', 'RightFoot'],
  head: ['head', 'Head'],
  pelvis: ['pelvis', 'Hips'],
};
const BALL = { footL: ['ball_l', 'LeftToeBase'], footR: ['ball_r', 'RightToeBase'] };
const WINDOW = 12; // frames either side of a join
const VEL_LIMIT = 4; // m/s of velocity change in one frame

function boneOf(ch, names) {
  const mesh = ch._body && ch._body.mesh;
  if (mesh) for (const b of mesh.skeleton.bones) if (b.name === names[0]) return b;
  return ch.bones[names[1]];
}

export function makeChain(demo, sheet) {
  async function chainReview(kind = 'car', { film = false, after = 60, post = 'http://127.0.0.1:5199/', tag = '' } = {}) {
    const v = demo.vehicles;
    const ch = demo.character;
    const p = demo.player;
    const veh = kind === 'heli' ? demo.heli : demo.car;
    const R = veh.root;
    if (v.mode !== 'foot') throw new Error('start on foot');
    // from 3.2 m off the entry point, as enterExit
    const out = R.localToWorld(new THREE.Vector3(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6));
    p.pos.set(out.x, 0, out.z);
    p.vel.set(0, 0, 0);
    p.move = p._pending = null;
    ch.root.position.copy(p.pos);
    ch.snapToGround();
    demo.view = null;
    for (let i = 0; i < 40; i++) demo.step(1 / 60);
    const bones = Object.fromEntries(Object.entries(PARTS).map(([k, n]) => [k, boneOf(ch, n)]));
    const balls = Object.fromEntries(Object.entries(BALL).map(([k, n]) => [k, boneOf(ch, n)]));
    const rec = []; // per frame
    const tmp = new THREE.Vector3();
    // the fixed three-quarter view (vehicle frame): from the front quarter on the entry side, looking at the door
    const camPos = kind === 'heli' ? [5.6, 2.1, -5.4] : [-5.4, 1.9, -3.6];
    const camAt = kind === 'heli' ? [1.6, 1.0, -1.4] : [-1.3, 0.85, -0.2];
    const view = () => sheet.cam(R.localToWorld(new THREE.Vector3(...camPos)).toArray(), R.localToWorld(new THREE.Vector3(...camAt)).toArray(), 46);
    // (film) the last WINDOW + 1 frames kept as small pictures; a join opens a sheet of 25
    const TW = 256;
    const TH = 192;
    const ring = film ? Array.from({ length: WINDOW + 1 }, () => Object.assign(document.createElement('canvas'), { width: TW, height: TH })) : null;
    const ringLabel = [];
    const sheets = [];
    let open = null; // { left, n, name }
    const grab = (i, label) => {
      view();
      demo.render();
      view();
      demo.render(); // (twice: the anti-aliasing settles on the fixed view)
      const src = demo.renderer.domElement;
      const c = ring[i % ring.length];
      const g = c.getContext('2d');
      const tar = TW / TH;
      let sw = src.width;
      let sh = src.height;
      if (sw / sh > tar) sw = sh * tar;
      else sh = sw / tar;
      g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, TW, TH);
      ringLabel[i % ring.length] = label;
    };
    const putTile = (i) => {
      const k = open.n++;
      const g = sheet.ov.getContext('2d');
      const x = (k % 5) * TW;
      const y = Math.floor(k / 5) * TH;
      g.drawImage(ring[i % ring.length], x, y);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(x, y, TW, 14);
      g.fillStyle = '#fff';
      g.font = '10px sans-serif';
      g.fillText(ringLabel[i % ring.length], x + 3, y + 10);
    };
    let i = 0;
    let lastMode = v.mode;
    const frame = async () => {
      demo.step(1 / 60);
      const r = { mode: v.mode, t: +(v.t || 0).toFixed(3), door: +(v.door || 0).toFixed(4) };
      for (const [k, b] of Object.entries(bones)) r[k] = b.getWorldPosition(new THREE.Vector3());
      for (const [k, b] of Object.entries(balls)) r[k + 'Ball'] = b.getWorldPosition(new THREE.Vector3());
      r.root = ch.root.getWorldPosition(new THREE.Vector3());
      r.local = {};
      for (const k of ['footL', 'footR']) r.local[k] = R.worldToLocal(tmp.copy(r[k])).clone();
      rec.push(r);
      if (film) {
        grab(i, `${i} ${r.mode} ${r.t.toFixed(2)}`);
        if (v.mode !== lastMode) {
          if (open) {
            await sheet.post(open.name, post);
            sheets.push(open.name);
          }
          sheet.open(5, 5, TW, TH);
          open = { n: 0, left: WINDOW, name: `${tag}chain_${kind}_${sheets.length + 1}_${lastMode}-${v.mode}` };
          for (let k = Math.max(0, i - WINDOW); k <= i; k++) putTile(k);
        } else if (open) {
          putTile(i);
          if (--open.left <= 0) {
            await sheet.post(open.name, post);
            sheets.push(open.name);
            sheet.close();
            open = null;
          }
        }
      }
      lastMode = v.mode;
      i++;
    };
    for (let k = 0; k < 10; k++) await frame();
    if (v.toggle() !== 'in') throw new Error('not near enough to get in');
    for (let k = 0; k < 2400 && v.mode !== 'seated'; k++) await frame();
    for (let k = 0; k < after; k++) await frame();
    const why = v.toggle();
    if (why !== 'out') throw new Error('could not get out: ' + why);
    for (let k = 0; k < 2400 && v.mode !== 'foot'; k++) await frame();
    for (let k = 0; k < after; k++) await frame();
    if (open) {
      await sheet.post(open.name, post);
      sheets.push(open.name);
    }
    sheet.close();
    const res = analyse(rec, kind);
    res.sheets = sheets;
    res.pack = v.pack ? v.pack.name : null;
    res.paths = { ...v.stats.paths };
    return res;
  }

  /** The numbers from the recorded frames. */
  function analyse(rec, kind) {
    const n = rec.length;
    const joins = [];
    for (let i = 1; i < n; i++) if (rec[i].mode !== rec[i - 1].mode) joins.push({ frame: i, name: `${rec[i - 1].mode}>${rec[i].mode}` });
    const where = (i) => {
      let best = null;
      for (const j of joins) if (Math.abs(i - j.frame) <= WINDOW && (!best || Math.abs(i - j.frame) < Math.abs(i - best.frame))) best = j;
      return best ? best.name : `in ${rec[i].mode}`;
    };
    const perJoin = Object.fromEntries(joins.map((j) => [j.name, { frame: j.frame }]));
    const parts = {};
    const over = [];
    const d0 = new THREE.Vector3();
    const d1 = new THREE.Vector3();
    for (const part of [...Object.keys(PARTS), 'root']) {
      const best = { dv: 0, at: 0, step: 0, stepAt: 0 };
      for (let i = 2; i < n; i++) {
        d1.subVectors(rec[i][part], rec[i - 1][part]);
        d0.subVectors(rec[i - 1][part], rec[i - 2][part]);
        const dv = d1.clone().sub(d0).length() * FPS; // m/s
        const step = d1.length() * 100; // cm
        const w = where(i);
        if (dv > best.dv) Object.assign(best, { dv, at: i });
        if (step > best.step) Object.assign(best, { step, stepAt: i });
        if (dv > VEL_LIMIT) over.push({ part, frame: i, t: rec[i].t, mode: rec[i].mode, where: w, dv: +dv.toFixed(2) });
        if (perJoin[w]) {
          const J = perJoin[w];
          const key = part === 'root' ? 'rootJumpCm' : part;
          const val = part === 'root' ? dv * 100 / FPS : dv;
          J[key] = Math.max(J[key] || 0, +val.toFixed(part === 'root' ? 2 : 2));
        }
      }
      parts[part] = { dvMax: +best.dv.toFixed(2), frame: best.at, where: where(best.at), mode: rec[best.at] ? rec[best.at].mode : null, t: rec[best.at] ? rec[best.at].t : null, stepMaxCm: +best.step.toFixed(2), stepWhere: where(best.stepAt) };
    }
    // the root's jump: the change of its step in one frame (cm), worst anywhere
    let rootJump = 0;
    let rootJumpAt = 0;
    for (let i = 2; i < n; i++) {
      d1.subVectors(rec[i].root, rec[i - 1].root);
      d0.subVectors(rec[i - 1].root, rec[i - 2].root);
      const j = d1.sub(d0).length() * 100;
      if (j > rootJump) {
        rootJump = j;
        rootJumpAt = i;
      }
    }
    // planted feet on the ground outside the vehicle: the lower of heel (ankle) and ball, within 1.5 cm of how
    // they stand at the start; their slide per frame and the drift over one plant (cm)
    const slide = {};
    for (const k of ['footL', 'footR']) {
      const base = { ankle: rec[0][k].y - groundAt(rec[0][k].x, rec[0][k].z), ball: rec[0][k + 'Ball'].y - groundAt(rec[0][k + 'Ball'].x, rec[0][k + 'Ball'].z) };
      const downOf = (i) => {
        const r = rec[i];
        const L = r.local[k];
        if (kind === 'car' ? Math.abs(L.x) < 1.0 && Math.abs(L.z) < 2.45 : Math.abs(L.x) < 0.95 && L.z > -4.5 && L.z < 3) return null; // (over the vehicle's own footprint)
        const a = r[k].y - groundAt(r[k].x, r[k].z) - base.ankle;
        const b = r[k + 'Ball'].y - groundAt(r[k + 'Ball'].x, r[k + 'Ball'].z) - base.ball;
        if (Math.min(a, b) > 0.015) return null;
        return a < b ? 'ankle' : 'ball';
      };
      const s = { perFrameCm: 0, perFrameAt: null, driftCm: 0, driftAt: null, framesOver2: 0 };
      let start = null;
      let startPart = null;
      for (let i = 1; i < n; i++) {
        const part = downOf(i);
        const prev = downOf(i - 1);
        const pt = (j, which) => (which === 'ankle' ? rec[j][k] : rec[j][k + 'Ball']);
        if (!part || part !== prev) {
          start = part ? pt(i, part).clone() : null;
          startPart = part;
          continue;
        }
        const a = pt(i - 1, part);
        const b = pt(i, part);
        const cm = Math.hypot(b.x - a.x, b.z - a.z) * 100;
        if (cm > s.perFrameCm) Object.assign(s, { perFrameCm: +cm.toFixed(2), perFrameAt: `${i} ${where(i)}` });
        if (cm > 2) s.framesOver2++;
        if (start && startPart === part) {
          const drift = Math.hypot(b.x - start.x, b.z - start.z) * 100;
          if (drift > s.driftCm) Object.assign(s, { driftCm: +drift.toFixed(2), driftAt: `${i} ${where(i)}` });
        }
      }
      slide[k] = s;
    }
    let door = 0;
    let doorAt = 0;
    for (let i = 2; i < n; i++) {
      const dv = Math.abs(rec[i].door - 2 * rec[i - 1].door + rec[i - 2].door) * FPS;
      if (dv > door) {
        door = dv;
        doorAt = i;
      }
    }
    return {
      kind,
      frames: n,
      joins: joins.map((j) => `${j.frame} ${j.name}`),
      parts,
      perJoin,
      rootJumpCm: +rootJump.toFixed(2),
      rootJumpWhere: where(rootJumpAt),
      footSlide: slide,
      doorRateChange: +door.toFixed(3),
      doorWhere: where(doorAt),
      over4: over.slice(0, 40),
      overCount: over.length,
    };
  }

  return { chainReview, chainAnalyse: analyse };
}
