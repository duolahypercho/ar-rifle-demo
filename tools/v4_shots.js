// (V4) Before / after pictures for the frame-time pass, in the page (?v3 for before):
//   const S = await import('/tools/v4_shots.js'); await S.cases('after', ['foot', 'car', 'cockpit'])
//   (reload, then) await S.cases('after', ['heli']); await S.parts('after')
// Each row: the game's own view of the case (tools/v4_cost.js setupCase, 40 frames in) scaled into 512 x 384, and
// a 512 x 384 crop at 100 % of the canvas (its pixels one for one). Posted to tools/sheet_receiver.mjs (port 5199).
import { setupCase } from '/tools/v4_cost.js';

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

/** `crop`: [u, v] of the crop's centre on the canvas (0..1). */
export async function cases(tag, kinds = ['foot', 'car', 'cockpit'], { frames = 40, crop = {} } = {}) {
  const D = window.demo;
  const c = overlay(2, kinds.length);
  const g = c.getContext('2d');
  const anim = D.renderer._animation;
  const loop = anim.getAnimationLoop();
  anim.setAnimationLoop(null); // (only these frames are drawn: the draw count is theirs)
  kinds.forEach((kind, row) => {
    setupCase(D, kind);
    for (let i = 0; i < frames; i++) {
      D.step(1 / 60);
      if (i === frames - 1) D.renderer.info.reset();
      D.render();
    }
    // (copied in the same task as the last render)
    const src = D.renderer.domElement;
    g.drawImage(src, 0, 0, src.width, src.height, 0, row * H, W, H);
    // (the same quarter of the picture whatever the canvas size: 512 x 384 canvas pixels at 2048 x 1536, one for one
    // as the pane's screen shows them; 384 x 288 at 1536 x 1152, drawn over the same 512 x 384 screen pixels)
    const [u, v] = crop[kind] || [0.5, 0.5];
    const cw = Math.round(src.width / 4);
    const chh = Math.round(src.height / 4);
    const sx = Math.round(Math.min(src.width - cw, Math.max(0, u * src.width - cw / 2)));
    const sy = Math.round(Math.min(src.height - chh, Math.max(0, v * src.height - chh / 2)));
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, cw, chh, W, row * H, W, H);
    g.strokeStyle = '#ff0';
    g.strokeRect((sx / src.width) * W, row * H + (sy / src.height) * H, W / 4, H / 4);
    label(g, 0, row * H, `${tag} ${kind} ${src.width}x${src.height}, draws ${D.renderer.info.render.drawCalls}`);
    label(g, W, row * H, `${tag} ${kind}: yellow box at screen size (${cw}x${chh} canvas px)`);
  });
  anim.setAnimationLoop(loop);
  D.carInput = null;
  D.heliInput = null;
  await post(c, `${tag}_${kinds.join('-')}`);
  c.remove();
}

/** The car's moving parts (both doors open, wheels steered) and the helicopter's doors from outside. */
export async function parts(tag, kind = 'car') {
  const D = window.demo;
  D.timeScale = 0;
  const c = overlay(2, 2);
  const g = c.getContext('2d');
  const veh = kind === 'car' ? D.car : D.heli;
  const R = veh.root;
  const V = R.position.constructor;
  const at = (x, y, z) => R.localToWorld(new V(x, y, z)).toArray();
  const pose = () => {
    if (kind === 'car') {
      veh.doorL = 1;
      veh.doorR = 0.6;
    } else {
      veh.door = 1;
      veh.doorL = 0.5;
    }
    veh.sync();
  };
  if (kind === 'car') {
    veh.dyn.input.steerAngle = 0.45;
    for (let i = 0; i < 40; i++) veh.dyn.update(1 / 60);
  }
  const views = kind === 'car'
    ? [[[-4.2, 1.7, -3.2], [0, 0.6, 0]], [[3.6, 1.2, -4.2], [0.6, 0.4, -1.3]], [[-2.8, 1.4, 1.2], [-0.5, 0.6, -0.4]], [[2.5, 7, 4], [0, 0, 0]]]
    : [[[7, 3, -8], [0, 1.5, 0]], [[3.5, 1.8, -2.5], [0.5, 1.2, -1.3]], [[-6, 2.5, 6], [0, 1.5, 0]], [[4, 12, 6], [0, 0, 0]]];
  views.forEach(([p, t], i) => {
    for (let k = 0; k < 8; k++) {
      pose();
      D.sheet.cam(at(...p), at(...t), 45);
      D.render();
    }
    const src = D.renderer.domElement;
    const x = (i % 2) * W;
    const y = Math.floor(i / 2) * H;
    g.drawImage(src, 0, 0, src.width, src.height, x, y, W, H);
    label(g, x, y, `${tag} ${kind} parts view ${i + 1}`);
  });
  await post(c, `${tag}_parts_${kind}`);
  c.remove();
}

/**
 * (V4) The guns while getting in: walks up to the vehicle, gets in, and films 9 stages from `side` (-1 the car's left /
 * driver's side, +1 its right; the helicopter is entered on its right). Labels say where the guns are (back or cabin).
 * Returns the clip time and frame at which they went to the cabin.
 */
export async function entryGuns(tag, kind = 'car', side = -1) {
  const D = window.demo;
  D.timeScale = 0;
  const v = D.vehicles;
  const veh = kind === 'heli' ? D.heli : D.car;
  const p = D.player;
  const V = veh.root.position.constructor;
  const out = veh.root.localToWorld(new V(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6));
  p.pos.set(out.x, 0, out.z);
  p.vel.set(0, 0, 0);
  D.character.root.position.copy(p.pos);
  D.character.snapToGround();
  for (let i = 0; i < 20; i++) D.step(1 / 60);
  if (v.toggle() !== 'in') throw new Error('not near enough');
  for (let i = 0; i < 600 && v.mode !== 'entering'; i++) D.step(1 / 60);
  const c = overlay(3, 3);
  const g = c.getContext('2d');
  const R = veh.root;
  const at = (x, y, z) => R.localToWorld(new V(x, y, z)).toArray();
  const cam = kind === 'heli' ? [side * 4.2, 2.2, -0.6] : [side * 3.6, 1.9, 0.6];
  const look = kind === 'heli' ? [side * 0.4, 1.3, -1.2] : [side * 0.4, 0.7, -0.3];
  const dur = v.clip ? v.clip.duration : 3.6;
  const marks = [0.15, 0.25, 0.3, 0.35, 0.45, 0.6, 0.7, 0.85, 0.99];
  let n = 0;
  let switched = null;
  let last = null;
  const where = () => {
    // (on the back the rifle's pivot is within half a metre of the chest; in the cabin it is not)
    const r = D.rifle.pivot.getWorldPosition(new V());
    return r.distanceTo(D.character.bones.Spine2.getWorldPosition(new V())) < 0.5 ? 'back' : 'cabin';
  };
  for (let i = 0; i < 1200 && v.mode !== 'seated' && n < marks.length; i++) {
    D.step(1 / 60);
    const w = where();
    if (last === 'back' && w === 'cabin' && switched === null) switched = { t: +v.t.toFixed(2), frame: Math.round(v.t * 30) };
    last = w;
    if (v.t >= marks[n] * dur) {
      for (let k = 0; k < 6; k++) {
        D.sheet.cam(at(...cam), at(...look), 50);
        D.render();
      }
      const src = D.renderer.domElement;
      const x = (n % 3) * W;
      const y = Math.floor(n / 3) * H;
      g.drawImage(src, 0, 0, src.width, src.height, x, y, W, H);
      label(g, x, y, `${tag} ${kind} from ${side < 0 ? 'left' : 'right'} t ${v.t.toFixed(2)} f${Math.round(v.t * 30)} guns: ${w}`);
      n++;
    }
  }
  await post(c, `${tag}_entryguns_${kind}_${side < 0 ? 'L' : 'R'}`);
  c.remove();
  return switched;
}

/**
 * (V4) Gun vertices (every 3rd, both guns) against the vehicle's parts during the entry, every 3rd frame from the walk's
 * end to seated (V2's depth measure: behind the nearest face within 5 cm; open shells read deep). Returns per part the
 * deepest (cm), its frame and the gun. Run on a freshly loaded page.
 */
export async function entryGunDepth(kind = 'car', { atDoor = false } = {}) {
  const { gunSurface, gunDepth } = await import('/src/review.js');
  const D = window.demo;
  D.timeScale = 0;
  D.gunsAtDoor = atDoor; // (true: V3's rule, the guns on the back until the door shuts)
  const v = D.vehicles;
  const veh = kind === 'heli' ? D.heli : D.car;
  const parts = kind === 'heli' ? ['pilot_seat', 'cockpit_door_R', 'fuselage', 'interior', 'passenger_seat_01'] : ['seat_driver', 'seat_passenger', 'door_L', 'body_shell', 'interior'];
  const p = D.player;
  const V = veh.root.position.constructor;
  const M = veh.root.matrixWorld.constructor;
  const out = veh.root.localToWorld(new V(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6));
  p.pos.set(out.x, 0, out.z);
  p.vel.set(0, 0, 0);
  D.character.root.position.copy(p.pos);
  D.character.snapToGround();
  for (let i = 0; i < 20; i++) D.step(1 / 60);
  v.toggle();
  for (let i = 0; i < 600 && v.mode !== 'entering'; i++) D.step(1 / 60);
  veh._surfaces = veh._surfaces || {};
  const res = {};
  const w = new V();
  const inv = new M();
  const d = { depth: 0, part: null };
  for (let i = 0; i < 1200 && v.mode !== 'seated'; i++) {
    D.step(1 / 60);
    if (i % 3) continue;
    await new Promise((r) => setTimeout(r, 0)); // (lets the page answer between samples)
    D.scene.updateMatrixWorld();
    for (const name of parts) {
      const node = veh.nodes[name];
      if (!node) continue;
      const surf = veh._surfaces[name] || (veh._surfaces[name] = gunSurface({ pivot: node, nodes: {} }));
      inv.copy(node.matrixWorld).invert();
      for (const gun of [D.rifle, D.shotgun]) {
        gun.pivot.traverse((o) => {
          if (!o.isMesh || o.userData.batch || o.userData.shadowProxy || !o.geometry.attributes.position) return;
          const pos = o.geometry.attributes.position;
          for (let k = 0; k < pos.count; k += 3) {
            w.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
            gunDepth(surf, w, d);
            if (d.depth > ((res[name] && res[name].cm / 100) || 0)) res[name] = { cm: +(d.depth * 100).toFixed(1), frame: Math.round(v.t * 30), gun: gun.key || gun.name };
          }
        });
      }
    }
  }
  D.gunsAtDoor = false;
  res.samples = Math.round(v.t * 10);
  return res;
}
