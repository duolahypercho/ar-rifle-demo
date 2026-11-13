// (V3) Picture sets used by pass V3, run in the page: const S = await import('/tools/v3_shots.js');
// await S.carShots('after'). Each posts a contact sheet to tools/sheet_receiver.mjs (port 5199).
import { preset } from '/src/car/scenarios.js';

const demo = () => window.demo;

export async function footShots(tag) {
  const D = demo();
  const sh = D.sheet;
  D.timeScale = 0;
  sh.open(2, 1, 512, 384);
  D.view = null;
  const p = D.player;
  p.pos.set(20, 0, 30);
  p.camYaw = p.yaw = p._yaw.x = 0.5;
  p.camPitch = -0.05;
  D.character.root.position.copy(p.pos);
  D.character.snapToGround();
  for (let i = 0; i < 40; i++) D.step(1 / 60);
  sh.tile(tag + ' on foot', () => {});
  sh.tile(tag + ' on foot, close', () => {
    const c = D.character.root.position;
    sh.cam([c.x + 2.2, c.y + 1.6, c.z + 2.2], [c.x, c.y + 0.9, c.z], 40);
  });
  await sh.post(tag + '_foot');
}

export async function carShots(tag) {
  const D = demo();
  const sh = D.sheet;
  D.timeScale = 0;
  sh.open(2, 2, 512, 384);
  D.seatInCar();
  const d = D.car.dyn;
  d.reset(120, 60, 0);
  for (let i = 0; i < 30; i++) d.update(1 / 60);
  preset(d, 75);
  D.carInput = (dyn) => Object.assign(dyn.input, { throttle: 1, brake: 0, handbrake: 0, steer: 0, steerAngle: 0 });
  const cams = D.vehicles.carCams;
  cams.mode = 0;
  cams.started = false;
  for (let i = 0; i < 90; i++) D.step(1 / 60);
  sh.tile(`${tag} car chase ${(d.speed * 3.6).toFixed(0)} km/h`, () => {});
  cams.mode = 1;
  for (let i = 0; i < 10; i++) D.step(1 / 60);
  sh.tile(`${tag} car cockpit ${(d.speed * 3.6).toFixed(0)} km/h`, () => {});
  cams.mode = 0;
  D.carInput = (dyn) => Object.assign(dyn.input, { throttle: 0, brake: 1, handbrake: 0, steer: 0, steerAngle: 0 });
  for (let i = 0; i < 400 && d.speed > 0.2; i++) D.step(1 / 60);
  D.carInput = null;
  sh.tile(`${tag} car parked, close`, () => {
    const c = D.car.root.position;
    sh.cam([c.x - 4, c.y + 2.2, c.z + 3], [c.x, c.y + 0.6, c.z], 45);
  });
  sh.tile(`${tag} grandstand and barrier from the car`, () => {
    const c = D.car.root.position;
    sh.cam([c.x - 2, c.y + 3, c.z + 6], [99, 2, c.z - 120], 55);
  });
  await sh.post(tag + '_car');
  return d.speed * 3.6;
}

export async function heliShots(tag) {
  const D = demo();
  const sh = D.sheet;
  D.timeScale = 0;
  sh.open(2, 2, 512, 384);
  D.seatInHeli();
  const h = D.heli;
  const fm = h.fm;
  fm.reset({ position: [10, 200, 80], heading: 0, running: 'flight', inAir: true });
  h.assist.reset(fm.state);
  const cams = D.vehicles.heliCams;
  cams.mode = 0;
  cams.started = false;
  for (let i = 0; i < 60; i++) D.step(1 / 60);
  cams.lookPitch = -0.45;
  sh.tile(tag + ' heli 200 m chase, looking down', () => cams.place(0, D.camera, h));
  sh.tile(tag + ' heli 200 m: yard from above', () => sh.cam([h.root.position.x + 25, h.root.position.y + 8, h.root.position.z + 30], [-10, 0, -60], 50));
  cams.lookPitch = 0;
  cams.mode = 1;
  cams.lookPitch = -0.6;
  for (let i = 0; i < 5; i++) D.step(1 / 60);
  sh.tile(tag + ' heli 200 m cockpit look down', () => {});
  cams.mode = 0;
  cams.lookPitch = 0;
  sh.tile(tag + ' yard buildings from 40 m', () => sh.cam([60, 40, 40], [0, 0, -80], 50));
  await sh.post(tag + '_heli');
  return [fm.state.position.y, fm.state.groundSpeed];
}

const D2R = Math.PI / 180;
// the cockpit view's attitudes: [label, reset opts, controls, lookYaw, lookPitch]
export const COCKPIT_CASES = [
  ['hover 3 m', { y: 3, pitch: 3 * D2R, bank: -3 * D2R, v: 0 }, { collective: 0.47, cyclicPitch: 0, cyclicRoll: 0, pedal: -0.38 }, 0, 0],
  ['cruise 214 km/h', { y: 150, pitch: -2.3 * D2R, v: 59.4 }, { collective: 0.62, cyclicPitch: 0.35, cyclicRoll: 0, pedal: -0.2 }, 0, 0],
  ['bank 45 left', { y: 150, bank: -45 * D2R, v: 45 }, { collective: 0.6, cyclicPitch: 0.1, cyclicRoll: -0.6, pedal: -0.4 }, 0, 0],
  ['bank 45 right', { y: 150, bank: 45 * D2R, v: 45 }, { collective: 0.6, cyclicPitch: 0.1, cyclicRoll: 0.6, pedal: 0 }, 0, 0],
  ['nose down accelerating', { y: 150, pitch: -15 * D2R, v: 20 }, { collective: 0.85, cyclicPitch: 1, cyclicRoll: 0, pedal: -0.6 }, 0, 0],
  ['autorotation flare', { y: 20, pitch: 18 * D2R, v: 25 }, { collective: 0.05, cyclicPitch: -1, cyclicRoll: 0, pedal: 0.9 }, 0, 0],
  ['look left (mouse)', { y: 150, pitch: -2 * D2R, v: 40 }, { collective: 0.55, cyclicPitch: 0.2, cyclicRoll: 0, pedal: -0.3 }, 1.4, -0.1],
  ['look right (mouse)', { y: 150, pitch: -2 * D2R, v: 40 }, { collective: 0.55, cyclicPitch: 0.2, cyclicRoll: 0, pedal: -0.3 }, -1.4, -0.1],
  ['look down a little', { y: 3, v: 0 }, { collective: 0.47, cyclicPitch: 0, cyclicRoll: 0, pedal: -0.38 }, 0, -0.2],
  ['look down at the controls', { y: 3, v: 0 }, { collective: 0.47, cyclicPitch: 0, cyclicRoll: 0, pedal: -0.38 }, 0, -0.6],
  ['look up', { y: 30, v: 0 }, { collective: 0.47, cyclicPitch: 0, cyclicRoll: 0, pedal: -0.38 }, 0, 0.6],
  ['cyclic full aft-left, collective up', { y: 30, v: 10 }, { collective: 0.9, cyclicPitch: -1, cyclicRoll: -1, pedal: -0.8 }, 0, 0],
];

/** The helicopter's cockpit view in each of COCKPIT_CASES (3 x 3 sheet). */
export async function cockpitShots(tag, cases = COCKPIT_CASES) {
  const D = demo();
  const sh = D.sheet;
  D.timeScale = 0;
  sh.open(3, Math.ceil(cases.length / 3), 400, 300);
  D.seatInHeli();
  const h = D.heli;
  const fm = h.fm;
  const cams = D.vehicles.heliCams;
  const out = [];
  for (const [label, o, c, yaw, pitch] of cases) {
    const g = 0;
    fm.reset({ position: [-78, g + o.y, 112], heading: 0, pitch: o.pitch || 0, bank: o.bank || 0, running: 'flight', inAir: o.y > 2, velocity: [0, 0, -(o.v || 0)], controls: c });
    D.heliInput = () => fm.setControls({ ...c });
    cams.mode = 1;
    cams.started = false;
    for (let i = 0; i < 12; i++) {
      cams.lookYaw = yaw;
      cams.lookPitch = pitch;
      D.step(1 / 60);
      if (i >= 4) D.render(); // (TRAA's history: the frames before the tile drawn, not the last tile's view)
    }
    cams._idle = 0;
    sh.tile(`${tag} ${label}`, () => {
      cams.lookYaw = yaw;
      cams.lookPitch = pitch;
      cams.place(0, D.camera, h);
    });
    out.push([label, (fm.state.groundSpeed * 3.6).toFixed(0)]);
  }
  D.heliInput = null;
  cams.lookYaw = cams.lookPitch = 0;
  await sh.post(tag + '_cockpit');
  return out;
}
