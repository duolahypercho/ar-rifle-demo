// (V10) Review calls for getting out at speed, the falls and the parachute, run through demo.step at 60 Hz (headless or
// with the pane shown). Each walks up to the vehicle and gets in by the game's own path (T, the jog, the settle, the entry
// clip), puts the vehicle where the test needs it, gets out by T, and steps until he stands; every frame it records the
// body's parts (hands, feet, head, pelvis: the skin's bones, what is drawn), the root, the camera and the mode. Then it
// checks that he can walk, fire and get back in. With `film` a 4 x 3 sheet of the path from the game's own camera is
// posted to the sheet receiver (v10_<name>.jpg) and a second from a fixed witness view.
//   demo.bailReview(kmh)            car: T at kmh (<= 29 km/h: the stop first, then car-exit; more: the bail)
//   demo.jumpReview(height)         helicopter hovering `height` m up: T (heli-jump, the fall, the landing or WASTED)
//   demo.heliGroundExit()           helicopter on the ground, engine running: T (heli-exit at once), and back in
//   demo.paraReview(height, opts)   pick up a pack, fly up, jump, open at opts.open m, steer, flare, land (opts.at: where)
//   demo.entryReview(kind, from)    the walk / jog to the door and the entry from `from` m; controls from handsOn
// Run as demo.bailReview(80).then(r => window.__r = r): they take a while.
import * as THREE from 'three/webgpu';
import { groundAt } from './ground.js';
import { surfaceKind, HELIPAD } from './track.js';
import { FlightAssist } from './heli/assist.js';
import { preset } from './car/scenarios.js';

const PARTS = { handL: ['hand_l', 'LeftHand'], handR: ['hand_r', 'RightHand'], footL: ['foot_l', 'LeftFoot'], footR: ['foot_r', 'RightFoot'], head: ['head', 'Head'], pelvis: ['pelvis', 'Hips'] };
const FPS = 60;

function boneOf(ch, names) {
  const mesh = ch._body && ch._body.mesh;
  if (mesh) for (const b of mesh.skeleton.bones) if (b.name === names[0]) return b;
  return ch.bones[names[1]];
}

export function makeExitReview(demo, sheet) {
  const v = () => demo.vehicles;
  const X = () => demo.vehicles.exits;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) demo.step(1 / FPS);
  };
  const r2 = (x) => +x.toFixed(2);

  /** Records a frame: parts, root, camera, mode. */
  function recorder() {
    const ch = demo.character;
    const bones = Object.fromEntries(Object.entries(PARTS).map(([k, n]) => [k, boneOf(ch, n)]));
    const rec = [];
    return {
      rec,
      frame(extra = {}) {
        const r = { mode: v().mode, t: rec.length / FPS, cam: demo.camera.position.clone(), ...extra };
        for (const [k, b] of Object.entries(bones)) r[k] = b.getWorldPosition(new THREE.Vector3());
        r.root = ch.root.getWorldPosition(new THREE.Vector3());
        const s = X().s;
        r.phase = s ? s.phase : null;
        r.clip = s ? s.clip.name : v().clip ? v().clip.name : null;
        rec.push(r);
        return r;
      },
    };
  }

  /** Velocity changes per frame (m/s) per part, outside the 3 frames after each ground contact; the camera's steps. */
  function analyse(rec) {
    const out = { parts: {}, camera: {} };
    const impacts = [];
    for (let i = 1; i < rec.length; i++) if ((rec[i].phase === 'land' || rec[i].phase === 'wasted') && rec[i - 1].phase !== rec[i].phase) impacts.push(i);
    // ((V10, integration) the impact's own frames: the contact frame and the 2 after it)
    const nearImpact = (i) => impacts.some((j) => i >= j && i <= j + 2);
    for (const part of [...Object.keys(PARTS), 'root']) {
      let best = { dv: 0, i: 0 };
      let bestAll = { dv: 0, i: 0 };
      let vmax = 0;
      for (let i = 2; i < rec.length; i++) {
        const a = rec[i][part].clone().sub(rec[i - 1][part]);
        const b = rec[i - 1][part].clone().sub(rec[i - 2][part]);
        const dv = a.clone().sub(b).length() * FPS;
        vmax = Math.max(vmax, a.length() * FPS);
        if (dv > bestAll.dv) bestAll = { dv, i };
        if (!nearImpact(i) && dv > best.dv) best = { dv, i };
      }
      const at = (k) => (rec[k.i] ? `${rec[k.i].mode}${rec[k.i].clip ? ' ' + rec[k.i].clip : ''} @${rec[k.i].t.toFixed(2)}` : '-');
      out.parts[part] = { dv: r2(best.dv), at: at(best), dvWithImpact: r2(bestAll.dv), atImpact: at(bestAll), vmax: r2(vmax) };
    }
    // the camera: its largest step (cm) and change of velocity in a frame (m/s): a cut shows as a jump
    let cs = { d: 0, i: 0 };
    let cv = { dv: 0, i: 0 };
    for (let i = 2; i < rec.length; i++) {
      const a = rec[i].cam.clone().sub(rec[i - 1].cam);
      const b = rec[i - 1].cam.clone().sub(rec[i - 2].cam);
      const dv = a.clone().sub(b).length() * FPS;
      if (dv > cv.dv) cv = { dv, i };
      const d = a.length();
      if (d > cs.d) cs = { d, i };
    }
    out.camera = { maxStepCm: r2(cs.d * 100), stepAt: rec[cs.i] ? `${rec[cs.i].mode} @${rec[cs.i].t.toFixed(2)}` : '-', maxDv: r2(cv.dv), dvAt: rec[cv.i] ? `${rec[cv.i].mode} @${rec[cv.i].t.toFixed(2)}` : '-' };
    out.impactFrames = impacts.length;
    // per hand-over (a change of mode, phase or clip): the worst change of velocity in a frame at a hand, foot, head or
    // pelvis from 3 frames before it to 8 after (the impact's frames left out)
    const marks = [];
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1];
      const b = rec[i];
      if (a.mode !== b.mode || a.phase !== b.phase || a.clip !== b.clip) marks.push({ i, name: `${a.clip || a.mode}>${b.clip || b.mode}` });
    }
    out.handovers = marks.map(({ i, name }) => {
      let worst = { dv: 0, part: null };
      for (let k = Math.max(2, i - 3); k <= Math.min(rec.length - 1, i + 8); k++) {
        if (nearImpact(k)) continue;
        for (const part of Object.keys(PARTS)) {
          const a = rec[k][part].clone().sub(rec[k - 1][part]);
          const b = rec[k - 1][part].clone().sub(rec[k - 2][part]);
          const dv = a.sub(b).length() * FPS;
          if (dv > worst.dv) worst = { dv, part, at: k - i };
        }
      }
      return `${name} @${rec[i].t.toFixed(2)}: ${worst.part} ${worst.dv.toFixed(2)} (${worst.at >= 0 ? '+' : ''}${worst.at})`;
    });
    return out;
  }

  /**
   * Walks up from `from` m (a three-quarter approach from behind the door) and gets in by T; steps until seated (+0.5 s).
   * `controls`: hold the vehicle's keys from events.handsOn (the early seat). Returns the timings.
   */
  function getIn(kind, { from = 4.5, controls = false } = {}) {
    const V = v();
    const veh = kind === 'heli' ? demo.heli : demo.car;
    // (a helicopter left a wreck by the last run: back on the helipad, as the game's own wreck watch does it)
    if (kind === 'heli' && new THREE.Vector3(0, 1, 0).applyQuaternion(veh.root.quaternion).y < 0.7) {
      veh.place(HELIPAD.x, HELIPAD.z, 0);
      if (veh.damage) veh.damage.repair();
      step(10);
    }
    const p = demo.player;
    const R = veh.root;
    const e = V.entryPoint(new THREE.Vector3(), kind);
    // (from behind the door and out from it: the car's left side and rear; the helicopter's right side and nose)
    const dir = kind === 'heli' ? new THREE.Vector3(0.8, 0, -0.6) : new THREE.Vector3(-0.6, 0, 0.8);
    dir.applyQuaternion(R.quaternion).setY(0).normalize();
    p.pos.set(e.x + dir.x * from, 0, e.z + dir.z * from);
    p.pos.y = groundAt(p.pos.x, p.pos.z);
    p.vel.set(0, 0, 0);
    p.move = p._pending = null;
    p.yaw = p.camYaw = Math.atan2(dir.x, dir.z);
    p._yaw.x = p.yaw;
    demo.character.root.position.copy(p.pos);
    demo.character.snapToGround();
    demo.view = null;
    step(30);
    const out = { kind, from };
    const r = V.toggle();
    if (r !== 'in') throw new Error('not near enough to get in: ' + r);
    let n = 0;
    let clipAt = null;
    let handsOnAt = null;
    for (; n < 1200 && V.mode !== 'seated'; n++) {
      step();
      if (V.mode === 'entering' && clipAt === null) {
        clipAt = n / FPS;
        out.walkEnd = V.stats.walkEnd ? { ...V.stats.walkEnd } : null;
      }
      const ho = V.clip && V.clip.note.events && V.clip.note.events.handsOn;
      if (V.mode === 'entering' && typeof ho === 'number' && V.t >= ho && handsOnAt === null) {
        handsOnAt = n / FPS;
        if (controls) demo.controlHeld = true;
      }
    }
    out.toClipS = clipAt === null ? null : r2(clipAt);
    out.toHandsOnS = handsOnAt === null ? null : r2(handsOnAt);
    out.toSeatedS = r2(n / FPS);
    out.path = V.stats.paths[kind === 'heli' ? 'heli-enter' : 'car-enter'];
    out.clipS = V.pack && V.pack.clips[kind === 'heli' ? 'heli-enter' : 'car-enter'] ? r2(V.pack.clips[kind === 'heli' ? 'heli-enter' : 'car-enter'].duration) : null;
    out.early = V.stats.early ? { ...V.stats.early } : null;
    if (controls) {
      // the door closing by itself after the early seat
      let k = 0;
      for (; k < 120 && (kind === 'heli' ? demo.heli.door : demo.car.doorL) > 0.001; k++) step();
      out.doorShutAfterS = r2(k / FPS);
      demo.controlHeld = false;
    }
    step(30);
    if (V.mode !== 'seated') throw new Error('not seated: ' + V.mode);
    return out;
  }

  /** After a path: on foot, walk 1 s, fire, and get back into `kind` (the vehicle brought to rest first) and out again. */
  function afterCheck(kind) {
    const V = v();
    const p = demo.player;
    const out = {};
    for (let i = 0; i < 600 && V.mode !== 'foot'; i++) step();
    out.onFoot = V.mode === 'foot';
    out.gunsShown = demo.rifle.pivot.visible && demo.shotgun.pivot.visible;
    const was = p.pos.clone();
    demo.input.forward = true;
    step(60);
    demo.input.forward = false;
    out.walkedM = r2(p.pos.distanceTo(was));
    step(30);
    // (walking into a crate's pack picks it up (WASTED stands him by the helipad's crate): that played out first)
    for (let i = 0; i < 400 && V.mode !== 'foot'; i++) step();
    if (V.stats.paths['para-pickup'] && demo.para.worn) out.pickedUpOnTheWay = true;
    const ammo = demo.weapon.ammo;
    demo.input.fireKey = true;
    step(45);
    demo.input.fireKey = false;
    step(30);
    out.shots = ammo - demo.weapon.ammo;
    // the vehicle at rest (it may have coasted or come down on its own)
    const veh = kind === 'heli' ? demo.heli : demo.car;
    let k = 0;
    const still = () => (kind === 'heli' ? veh.speed < 0.5 && veh.state.contact.onGround : Math.abs(veh.dyn.speed) < 1);
    for (; k < 60 * 150 && !still(); k++) step();
    // (a helicopter come down on its side is put back on the helipad 5 s later, the player 25 m or more away)
    const upright = () => new THREE.Vector3(0, 1, 0).applyQuaternion(veh.root.quaternion).y > 0.7;
    if (kind === 'heli' && !upright()) {
      if (p.pos.distanceTo(veh.root.position) < 26) out.wreckNear = true;
      for (let i = 0; i < 60 * 8 && !upright(); i++) step();
      out.wreckReturned = upright();
    }
    out.vehicleRestS = r2(k / FPS);
    out.vehicleAt = veh.root.position.toArray().map((x) => r2(x));
    if (kind === 'heli') out.heli = { damaged: veh.damaged, upright: r2(new THREE.Vector3(0, 1, 0).applyQuaternion(veh.root.quaternion).y), engine: veh.state.engine.state, rotor: r2(veh.state.rotor.percent) };
    if (kind === 'car') out.car = { ignition: veh.dyn.ignition, abandoned: !!veh.abandoned, door: r2(veh.doorL) };
    try {
      const g = getIn(kind, { from: 4 });
      out.backIn = { toSeatedS: g.toSeatedS, path: g.path };
      const r = V.toggle();
      out.outAgain = r;
      for (let i = 0; i < 900 && V.mode !== 'foot'; i++) step();
      out.outAgainOnFoot = V.mode === 'foot';
    } catch (err) {
      out.backIn = 'FAILED: ' + err.message;
    }
    return out;
  }

  /** Film helpers: tiles from the game's camera, and from a fixed witness view. */
  function filmer(name, cols = 4, rows = 3) {
    const tiles = [];
    return {
      tiles,
      want(label, extra = {}) {
        tiles.push({ label, ...extra });
      },
    };
  }

  async function shoot(name, list, place) {
    sheet.open(4, 3, 400, 280);
    for (const t of list) {
      // (a list item replays nothing: each was grabbed as it happened into a canvas)
      const g = sheet.ov.getContext('2d');
      const i = sheet.n++;
      g.drawImage(t.canvas, (i % 4) * 400, Math.floor(i / 4) * 280);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect((i % 4) * 400, Math.floor(i / 4) * 280, 400, 16);
      g.fillStyle = '#fff';
      g.font = '11px sans-serif';
      g.fillText(t.label, (i % 4) * 400 + 4, Math.floor(i / 4) * 280 + 12);
    }
    await sheet.post(name);
    sheet.close();
    void place;
  }

  /** Grabs the frame now (the game's camera, or `place` sets it) into a small canvas. */
  function grab(label, place = null) {
    // (a witness view moves the game's camera: put back after, so the game's own camera (and the follow camera taken up
    // from it) never sees it)
    const cam = demo.camera;
    const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    if (place) place();
    demo.render();
    if (place) place();
    demo.render();
    if (place) {
      cam.position.copy(keep.p);
      cam.quaternion.copy(keep.q);
      cam.fov = keep.fov;
      cam.updateProjectionMatrix();
    }
    const src = demo.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 280;
    const g = c.getContext('2d');
    const tar = 400 / 280;
    let sw = src.width;
    let sh = src.height;
    if (sw / sh > tar) sw = sh * tar;
    else sh = sw / tar;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 400, 280);
    // (WASTED is a page overlay, not in the canvas: drawn here as the page shows it)
    const w = X().wastedT;
    if (w >= 0) {
      g.fillStyle = `rgba(7,8,10,${Math.min(1, w / 1.2) * 0.88})`;
      g.fillRect(0, 0, 400, 280);
      if (w >= 0.3) {
        g.fillStyle = '#c8312b';
        g.font = 'bold 54px Georgia';
        g.fillText('WASTED', 92, 160);
      }
    }
    return { label, canvas: c };
  }

  /** Steps until he stands (on foot, the draw done), grabbing tiles at the given moments; returns the record. */
  function playOut({ maxS = 30, grabs = [], witness = null, each = null }) {
    const V = v();
    const R = recorder();
    const shots = [];
    const wit = [];
    let i = 0;
    let lastMode = V.mode;
    const events = [];
    for (; i < maxS * FPS && V.mode !== 'foot'; i++) {
      if (each) each(i / FPS, i);
      step();
      const r = R.frame({ kmh: r2(Math.abs(demo.car.dyn.speed) * 3.6) });
      if (V.mode !== lastMode || (X().s && X().s.phase !== (R.rec[i - 1] || {}).phase)) events.push(`${r.t.toFixed(2)} ${V.mode}${X().s ? ':' + X().s.phase : ''}${r.clip ? ' ' + r.clip : ''}`);
      lastMode = V.mode;
      for (const gq of grabs) if (!gq.done && gq.when(r, i)) {
        gq.done = true;
        shots.push(grab(`${gq.label} ${r.t.toFixed(2)} s ${V.mode}${r.clip ? ' ' + r.clip : ''}`));
        if (witness && wit.length < 12) wit.push(grab(`${gq.label} ${r.t.toFixed(2)} s`, witness));
      }
    }
    return { rec: R.rec, shots, wit, events, seconds: r2(i / FPS) };
  }

  const atModes = (list) => list.map(([label, fn]) => ({ label, when: fn }));

  /**
   * demo.bailReview(kmh): the car on the main straight (x 120, heading north) at kmh, T. Up to 29 km/h the driver brakes
   * to a stop and gets out with car-exit; over it he bails.
   */
  async function bailReview(kmh = 80, { film = true, tag = 'v10_', check = true } = {}) {
    const V = v();
    if (V.mode !== 'foot') throw new Error('start on foot');
    const car = demo.car;
    const d = car.dyn;
    const res = { kmh };
    res.entry = getIn('car', { from: 4.5 });
    // the car to the straight, at speed, held there for a second
    d.reset(120, 40, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    preset(d, kmh / 3.6);
    V.carCams.started = false;
    const want = kmh / 3.6;
    demo.carInput = (dyn) => {
      const e = want - dyn.speed;
      dyn.input.throttle = THREE.MathUtils.clamp(e * 0.6 + 0.15, 0, 1);
      dyn.input.brake = e < -1 ? 0.3 : 0;
      dyn.input.steer = THREE.MathUtils.clamp((120 - car.root.position.x) * 0.02, -0.2, 0.2);
    };
    step(90);
    demo.carInput = null;
    res.atT = { kmh: r2(Math.abs(d.speed) * 3.6), x: r2(car.root.position.x), z: r2(car.root.position.z) };
    const carAt = car.root.position.clone();
    res.toggle = V.toggle();
    // (the witness rides beside the body on the side he leaves by, a little ahead)
    const witness = () => {
      const b = demo.character.root.position;
      sheet.cam([b.x - 8.5, b.y + 2.0, b.z - 2.5], [b.x, b.y + 0.7, b.z], 52);
    };
    const grabs = res.toggle === 'bail'
      ? atModes([
          ['T', (r, i) => i === 0],
          ['bail', (r) => r.mode === 'bailing' && demo.vehicles.t > 0.25],
          ['release', (r) => r.mode === 'air'],
          ['air', (r) => r.phase === 'air' && r.clip === 'bail-roll'],
          ['ground', (r) => r.phase === 'land'],
          ['roll', (r) => r.phase === 'land' && X().s && X().s.t > X().s.groundT + 0.35],
          ['slide', (r) => r.phase === 'land' && X().s && X().s.t > X().s.groundT + 0.7],
          ['rising', (r) => r.phase === 'land' && X().s && X().s.t > X().s.freeT - 0.3],
          ['standing', (r) => r.mode === 'drawing'],
          ['draw', (r) => r.mode === 'drawing' && demo.vehicles.t > 0.4],
          ['on foot', (r) => r.mode === 'foot'],
        ])
      : atModes([
          ['T', (r, i) => i === 0],
          ['braking', (r, i) => i === 20],
          ['stopped', (r) => r.mode === 'leaving'],
          ['exit', (r) => r.mode === 'leaving' && demo.vehicles.t > 0.8],
          ['exit', (r) => r.mode === 'leaving' && demo.vehicles.t > 1.8],
          ['exit', (r) => r.mode === 'leaving' && demo.vehicles.t > 3],
          ['exit', (r) => r.mode === 'leaving' && demo.vehicles.t > 5],
          ['standing', (r) => r.mode === 'drawing'],
          ['on foot', (r) => r.mode === 'foot'],
        ]);
    const P = playOut({ maxS: 40, grabs: film ? grabs : [], witness: film ? witness : null });
    res.events = P.events;
    res.seconds = P.seconds;
    res.last = { ...X().stats.last };
    res.paths = Object.fromEntries(['car-bail', 'bail-roll', 'car-exit'].map((n) => [n, V.stats.paths[n]]));
    res.motion = analyse(P.rec);
    res.carAfter = { coastM: r2(car.root.position.distanceTo(carAt)), kmh: r2(Math.abs(d.speed) * 3.6), door: r2(car.doorL), ignition: d.ignition };
    if (film) {
      await shoot(`${tag}bail_${kmh}`, P.shots);
      if (P.wit.length) await shoot(`${tag}bail_${kmh}_witness`, P.wit);
    }
    if (check) res.after = afterCheck('car');
    return res;
  }

  /** The helicopter taken to `height` m over (x, z), hovering, held there by an assist for `hold` s. */
  function heliUp(height, { x = HELIPAD.x, z = HELIPAD.z, heading = 0, speed = 0, hold = 2 } = {}) {
    const heli = demo.heli;
    const fm = heli.fm;
    const g = groundAt(x, z);
    fm.reset({ position: [x, g + height, z], heading, running: 'flight', inAir: true, velocity: [-Math.sin(heading) * speed, 0, -Math.cos(heading) * speed], controls: { collective: 0.45 } });
    heli.sync();
    demo.vehicles.heliCams.started = false;
    const A = new FlightAssist({ hoverHold: speed < 4, altitudeHold: true });
    A.reset(fm.state);
    demo.heliInput = (h, dt) => fm.setControls(A.update(h.state, { cyclicPitch: speed > 4 ? 0.0 : 0, cyclicRoll: 0, pedal: 0, collective: 0.45, collectiveRate: 0 }, dt));
    step(Math.round(hold * FPS));
    demo.heliInput = null;
    return { radar: r2(heli.state.radarHeight), vs: r2(heli.state.verticalSpeed), gs: r2(heli.speed) };
  }

  /** demo.jumpReview(height): hovering `height` m up over the helipad's edge, T: heli-jump, the fall, the landing. */
  async function jumpReview(height = 8, { film = true, tag = 'v10_', check = true, x = HELIPAD.x + 20, z = HELIPAD.z - 10 } = {}) {
    const V = v();
    if (V.mode !== 'foot') throw new Error('start on foot');
    const res = { height, packWorn: demo.para.worn };
    res.entry = getIn('heli', { from: 4.5 });
    res.hover = heliUp(height, { x, z });
    demo.fly.lever = demo.heli.state.controls.collective; // (the pilot's lever where the collective is)
    res.toggle = V.toggle();
    // (the witness out on the jumping side, 10 m off, level with the body as it falls, the helicopter behind it)
    const side = new THREE.Vector3(1, 0, 0.35).applyQuaternion(demo.heli.root.quaternion).setY(0).normalize();
    const witness = () => {
      const h = demo.character.bones.Hips.getWorldPosition(new THREE.Vector3());
      const g = groundAt(h.x, h.z);
      sheet.cam([h.x + side.x * 10, Math.max(g + 1.6, h.y + 0.8), h.z + side.z * 10], [h.x, Math.max(g + 0.6, h.y - 0.2), h.z], 50);
    };
    const heliY0 = demo.heli.root.position.y;
    const P = playOut({
      maxS: 40,
      witness: film ? witness : null,
      grabs: film
        ? atModes([
            ['T', (r, i) => i === 0],
            ['jump', (r) => r.mode === 'jumping' && V.t > 0.35],
            ['release', (r) => r.mode === 'air'],
            ['fall', (r) => r.phase === 'air' && X().s && X().s.time > 0.35],
            ['fall', (r) => r.phase === 'air' && X().height < Math.max(1.4, height * 0.35)],
            ['impact', (r) => r.phase === 'land' || r.phase === 'wasted'],
            ['down', (r) => (r.phase === 'land' && X().s && X().s.t > X().s.groundT + 0.3) || (r.phase === 'wasted' && X().wastedT > 0.5)],
            ['up', (r) => (r.phase === 'land' && X().s && X().s.t > X().s.freeT - 0.35) || (r.phase === 'wasted' && X().wastedT > 1.6)],
            ['standing', (r) => r.mode === 'drawing' || (r.phase === 'wasted' && X().wastedT > 2.8)],
            ['on foot', (r) => r.mode === 'foot'],
          ])
        : [],
    });
    res.events = P.events;
    res.seconds = P.seconds;
    res.last = { ...X().stats.last };
    res.paths = Object.fromEntries(['heli-jump', 'fall', 'land-roll', 'land-hard'].map((n) => [n, V.stats.paths[n]]));
    res.motion = analyse(P.rec);
    res.heliAfter = { dropM: r2(heliY0 - demo.heli.root.position.y), onGround: demo.heli.state.contact.onGround, vs: r2(demo.heli.state.verticalSpeed), collective: r2(demo.heli.state.controls.collective), damaged: demo.heli.damaged };
    if (film) {
      await shoot(`${tag}jump_${height}`, P.shots);
      if (P.wit.length) await shoot(`${tag}jump_${height}_witness`, P.wit);
    }
    if (check) res.after = afterCheck('heli');
    return res;
  }

  /** demo.heliGroundExit(): engine running on the ground, T: heli-exit at once (no shutdown), and back into it running. */
  async function heliGroundExit({ film = true, tag = 'v10_' } = {}) {
    const V = v();
    if (V.mode !== 'foot') throw new Error('start on foot');
    const heli = demo.heli;
    const res = {};
    res.entry = getIn('heli', { from: 4.5 });
    heli.power = true;
    heli.fm.controls.rotorBrake = 0;
    heli.fm.startEngine({ quick: true });
    let k = 0;
    for (; k < 60 * 20 && heli.state.rotor.percent < 99; k++) step();
    res.spoolS = r2(k / FPS);
    res.atT = { rotor: r2(heli.state.rotor.percent), engine: heli.state.engine.state, onGround: heli.state.contact.onGround };
    res.toggle = V.toggle();
    if (res.toggle === 'out') demo.fly.lever = 0;
    const R = heli.root;
    const witness = () => sheet.cam(R.localToWorld(new THREE.Vector3(7, 2.4, -6)).toArray(), R.localToWorld(new THREE.Vector3(1.4, 1.2, -1.2)).toArray(), 50);
    const P = playOut({
      maxS: 30,
      witness: film ? witness : null,
      grabs: film ? atModes([0.02, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => [`exit ${f}`, (r) => r.mode === 'leaving' && V.clip && V.t >= f * V.clip.duration]).concat([['standing', (r) => r.mode === 'drawing'], ['on foot', (r) => r.mode === 'foot']])) : [],
    });
    res.events = P.events;
    res.seconds = P.seconds;
    res.path = V.stats.paths['heli-exit'];
    res.motion = analyse(P.rec);
    res.heliAfter = { rotor: r2(heli.state.rotor.percent), engine: heli.state.engine.state, collective: r2(heli.state.controls.collective), moved: r2(heli.speed) };
    if (film) {
      await shoot(`${tag}heli_ground_exit`, P.shots);
      if (P.wit.length) await shoot(`${tag}heli_ground_exit_witness`, P.wit);
    }
    res.after = afterCheck('heli');
    res.after.heliRunningOnReentry = heli.state.engine.lit;
    return res;
  }

  /** Walks into the nearest crate's pack (from 4 m) until it is worn. */
  function pickUp({ film = false, crate = null } = {}) {
    const para = demo.para;
    const p = demo.player;
    const V = v();
    const c = crate !== null ? para.crates[crate] : para.crates.reduce((a, b) => (Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < Math.hypot(a.x - p.pos.x, a.z - p.pos.z) ? b : a));
    if (!c.has) c.t = 1e9; // (the review does not wait 30 s for a refill)
    step(2);
    const dir = new THREE.Vector2(1, 0.4).normalize();
    p.move = p._pending = null;
    p.pos.set(c.x + dir.x * 4, 0, c.z + dir.y * 4);
    p.pos.y = groundAt(p.pos.x, p.pos.z);
    p.vel.set(0, 0, 0);
    p.yaw = p.camYaw = Math.atan2(dir.x, dir.y);
    p._yaw.x = p.yaw;
    demo.character.root.position.copy(p.pos);
    demo.character.snapToGround();
    step(20);
    demo.input.forward = true;
    // ((V10, integration) para-pickup when the pack has it: walked into, played, the draw after; film from the side)
    const shots = [];
    const side = () => sheet.cam([c.x - dir.y * 3.2, groundAt(c.x, c.z) + 1.5, c.z + dir.x * 3.2], [c.x + dir.x * 0.4, groundAt(c.x, c.z) + 0.8, c.z + dir.y * 0.4], 46);
    const R = recorder();
    const marks = [0.0, 0.2, 0.34, 0.5, 0.7, 0.94, 1.1, 1.25];
    let k = 0;
    for (; k < 900 && (V.mode !== 'foot' || !para.worn); k++) {
      if (V.mode === 'foot' && !para.worn) p.camYaw = Math.atan2(-(c.x - p.pos.x), -(c.z - p.pos.z));
      else demo.input.forward = false;
      step();
      R.frame();
      const s = X().s;
      if (film && s && s.kind === 'pickup' && shots.length < marks.length && s.t >= marks[shots.length]) shots.push(grab(`pickup ${s.t.toFixed(2)} s${s.grabbed ? ' carried' : ''}${s.onBack ? ' on back' : ''}`, side));
      if (film && V.mode === 'drawing' && shots.length < 11 && R.rec.length % 25 === 0) shots.push(grab(`draw ${V.t.toFixed(2)} s`, side));
    }
    demo.input.forward = false;
    step(20);
    return { worn: para.worn, s: r2(k / FPS), crate: [r2(c.x), r2(c.z)], path: V.stats.paths['para-pickup'], last: { ...X().stats.last }, contact: V.stats.clipWorst && V.stats.clipWorst['para-pickup'], motion: analyse(R.rec), shots };
  }

  /**
   * demo.paraReview(height, { open, steer, at }): picks up a pack, gets into the helicopter, hovers `height` m up over
   * `at` ('grass' | 'tarmac' | [x, z]), jumps, opens at `open` m over the ground, steers (a list of [key, from s, to s]
   * under the canopy), flares at 6 m, lands. Film from the game's camera and a witness view.
   */
  async function paraReview(height = 300, { open = 150, steer = [['right', 2, 4.5], ['left', 6, 7.5]], at = 'grass', flareAt = 4, film = true, tag = 'v10_', check = true } = {}) {
    const V = v();
    if (V.mode !== 'foot') throw new Error('start on foot');
    const res = { height, open, at };
    const pk = pickUp({ film });
    if (film && pk.shots.length) await shoot(`${tag}pickup_${height}`, pk.shots);
    delete pk.shots;
    res.pickup = pk;
    res.entry = getIn('heli', { from: 4.5 });
    // where: grass west of the helipad, or tarmac on the apron north of the yard (headed so the canopy flies over it)
    const spot = Array.isArray(at) ? at : at === 'tarmac' ? [-20, -40] : [-150, 170];
    const heading = at === 'tarmac' ? 0 : Math.PI / 2;
    res.hover = heliUp(height, { x: spot[0], z: spot[1], heading, hold: 1.5 });
    demo.fly.lever = demo.heli.state.controls.collective; // (the pilot's lever where the collective is)
    res.toggle = V.toggle();
    const x = X();
    let opened = null;
    let flared = false;
    let canopyT = null;
    const canopyStats = {};
    const jp = demo.character.root.position.clone();
    const each = (t) => {
      const s = x.s;
      if (!s) return;
      if (!opened && s.phase === 'air' && x.height <= open && x.canPull) {
        x.key('Space', true);
        x.key('Space', false);
        opened = { t: r2(t), height: r2(x.height), vy: r2(s.vel.y) };
      }
      if (s.chute && s.chute.state === 'canopy') {
        if (canopyT === null) canopyT = t;
        const ct = t - canopyT;
        // (canopy flight measured: straight and level, and in the turns)
        const turning = steer.some(([, a, b]) => ct >= a && ct < b);
        const k = turning ? 'turn' : flared ? 'flare' : 'straight';
        const st = (canopyStats[k] = canopyStats[k] || { n: 0, vy: 0, gs: 0, rate: 0, bank: 0 });
        if (ct > 1.2 || k === 'flare') {
          st.n++;
          st.vy += -s.vel.y;
          st.gs += Math.hypot(s.vel.x, s.vel.z);
          st.rate = Math.max(st.rate, Math.abs(s.chute.yawRate || 0) * 57.3);
          st.bank = Math.max(st.bank, Math.abs(s.chute.bank || 0) * 57.3);
        }
        for (const [key, a, b] of steer) x.keys[key] = ct >= a && ct < b;
        if (!flared && x.height <= flareAt + 1.0) {
          flared = { t: r2(t), height: r2(x.height), vy: r2(s.vel.y), h: r2(Math.hypot(s.vel.x, s.vel.z)) };
          x.keys.left = x.keys.right = false;
        }
        if (flared) x.keys.flare = true;
      }
    };
    const witness = () => {
      const s = x.s;
      const c = s ? s.c : demo.character.root.position;
      sheet.cam([c.x + 22, c.y + 6, c.z + 16], [c.x, c.y + 2, c.z], 50);
    };
    const P = playOut({
      maxS: 120,
      each,
      witness: film ? witness : null,
      grabs: film
        ? atModes([
            ['jump', (r) => r.mode === 'jumping' && V.t > 0.4],
            ['free fall', (r) => r.phase === 'air' && x.s && !x.s.chute && x.s.time > 1.5],
            ['pull', (r) => x.s && x.s.chute && x.s.chute.t > 0.25],
            ['opening', (r) => x.s && x.s.chute && x.s.chute.t > 0.75],
            ['canopy', (r) => x.s && x.s.chute && x.s.chute.state === 'canopy'],
            ['canopy', (r) => x.s && x.s.chute && x.s.chute.state === 'canopy' && x.s.chute.t > 3],
            ['turn', (r) => x.s && x.s.chute && x.s.chute.state === 'canopy' && Math.abs(x.s.chute.bank) > 0.25],
            ['low', (r) => x.s && x.s.chute && x.s.chute.state === 'canopy' && x.height < 20],
            ['flare', (r) => !!flared && x.s && x.s.phase === 'air'],
            ['touchdown', (r) => r.phase === 'land' || r.phase === 'wasted'],
            ['landing', (r) => r.phase === 'land' && x.s && x.s.t > x.s.groundT + 0.5],
            ['standing', (r) => r.mode === 'drawing'],
          ])
        : [],
    });
    for (const k of ['left', 'right', 'flare', 'fast']) x.keys[k] = false;
    res.opened = opened;
    res.flared = flared;
    res.canopy = Object.fromEntries(Object.entries(canopyStats).map(([k, x]) => [k, { descentMs: r2(x.vy / Math.max(1, x.n)), groundMs: r2(x.gs / Math.max(1, x.n)), maxTurnDegS: r2(x.rate), maxBankDeg: r2(x.bank), s: r2(x.n / FPS) }]));
    res.events = P.events;
    res.seconds = P.seconds;
    res.last = { ...x.stats.last };
    const end = demo.character.root.position;
    res.landedOn = surfaceKind(end.x, end.z);
    res.driftM = r2(Math.hypot(end.x - jp.x, end.z - jp.z));
    res.paths = Object.fromEntries(['heli-jump', 'fall', 'para-deploy', 'para-hang', 'para-land', 'land-roll', 'land-hard'].map((n) => [n, V.stats.paths[n]]));
    res.motion = analyse(P.rec);
    res.packAfter = { worn: demo.para.worn };
    if (film) {
      await shoot(`${tag}para_${height}_${at}`, P.shots);
      if (P.wit.length) await shoot(`${tag}para_${height}_${at}_witness`, P.wit);
    }
    if (check) res.after = afterCheck('heli');
    return res;
  }

  /** demo.entryReview(kind, from): the approach and the entry, with and without the controls taken from handsOn. */
  function entryReview(kind = 'car', from = 4.5) {
    const V = v();
    const res = { kind, from };
    res.plain = getIn(kind, { from });
    V.toggle();
    for (let i = 0; i < 1200 && V.mode !== 'foot'; i++) step();
    res.early = getIn(kind, { from, controls: true });
    V.toggle();
    for (let i = 0; i < 1200 && V.mode !== 'foot'; i++) step();
    return res;
  }

  void filmer;
  return { bailReview, jumpReview, heliGroundExit, paraReview, entryReview, exitAnalyse: analyse, pickUp, heliUp };
}
