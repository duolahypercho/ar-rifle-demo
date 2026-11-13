// H1 scenarios: each one flies the model with the scripted TestPilot (or the FlightAssist) and
// returns rows { group, item, value, unit, target, ref, pass } for tools/heli/report.txt.
// Real-aircraft reference figures are approximate public numbers for the class (flight manuals and
// type data as remembered, not looked up in this pass): Bell 407 (2722 kg, 10.67 m 4-blade, 413 rpm,
// Vne 259 km/h), H125/AS350 B3 (2250 kg, 10.69 m, 386 rpm, Vne 287 km/h), Bell 206L-4, H130.

import { Helicopter, HELI, quatFromEuler } from '../../src/heli/flight.js';
import { FlightAssist } from '../../src/heli/assist.js';
import { TestPilot, fly, average } from './pilot.js';

const D2R = Math.PI / 180, KMH = 1 / 3.6, G = 9.80665;
export const flat = () => 0;
export const slopeX = (deg) => (x) => ({ height: x * Math.tan(deg * D2R), normal: [-Math.sin(deg * D2R), Math.cos(deg * D2R), 0] });

/** (V2) The game's review flies these same scenarios with its own aircraft: hooks.make builds the
 *  helicopter (Node: a fresh one; the game: its own, re-placed). */
export const hooks = { make: (opts) => new Helicopter(opts) };

function row(group, item, value, unit, target, ref, pass) { return { group, item, value, unit, target: target || '', ref: ref || '', pass }; }
const inRange = (v, a, b) => v >= a && v <= b;
const finite = (s) => [s.position.x, s.position.y, s.position.z, s.quaternion.w, s.velocity.x, s.velocity.y, s.rotor.omega].every(Number.isFinite);

export function makeAirborne({ alt = 300, speed = 0, mass = 2200, heading = 0, collective = 0.48, groundAt = flat, x = 0, z = 0 } = {}) {
  const h = hooks.make({ groundAt });
  const v = [Math.sin(heading) * speed, 0, -Math.cos(heading) * speed];
  h.reset({ position: [x, alt, z], heading, running: 'flight', inAir: true, velocity: v, mass, controls: { collective, throttle: 1 } });
  return h;
}

/** Trimmed level flight at a speed; returns averages. */
export function trimLevel(speed, { mass = 2200, alt = 300, settle = 35, avg = 8, extra = {} } = {}) {
  const h = makeAirborne({ alt, speed, mass, collective: 0.42 });
  const p = new TestPilot(h, { speed, vLat: 0, alt, heading: 0, ...extra });
  fly(h, p, settle);
  const a = average(h, p, avg, {
    tq: (s) => s.engine.torquePercent, pw: (s) => s.engine.powerPercent, kw: (s) => s.engine.powerUsed / 1e3,
    col: (s) => s.controls.collective, cp: (s) => s.controls.cyclicPitch, cr: (s) => s.controls.cyclicRoll,
    ped: (s) => s.controls.pedal, pitch: (s) => s.pitch / D2R, bank: (s) => s.bank / D2R, u: (s) => s.forwardSpeed,
    vs: (s) => s.verticalSpeed, nr: (s) => s.rotor.percent, mach: (s) => s.rotor.advancingTipMach,
    cts: (s) => s.rotor.ctSigma, beta: (s) => s.sideslip / D2R, a1: (s) => s.rotor.discTiltForward / D2R,
    b1: (s) => s.rotor.discTiltRight / D2R, tt: (s) => s.rotor.tailThrust, ias: (s) => s.ias,
  });
  a.state = h.state; a.heli = h; a.pilot = p;
  return a;
}

/* ------------------------------------------------------------------------------------------ */
export function engineStart() {
  const rows = [];
  for (const quick of [false, true]) {
    const h = hooks.make();
    h.reset({ running: 'cold' });
    fly(h, null, 2);
    const t0 = h.time;
    h.startEngine({ quick });
    let tLight = null, tIdle = null, tFly = null, nrIdle = null, ngIdle = null, maxNr = 0;
    fly(h, null, 90, (s) => {
      const ev = h.events;
      if (tLight == null && ev.find((e) => e.e === 'lightoff')) tLight = h.time - t0;
      if (tIdle == null && ev.find((e) => e.e === 'throttleFly')) { tIdle = h.time - t0; nrIdle = s.rotor.percent; ngIdle = s.engine.ng; }
      if (tFly == null && s.rotor.percent >= 99) tFly = h.time - t0;
      maxNr = Math.max(maxNr, s.rotor.percent);
      return !(tFly != null && h.time - t0 > tFly + 10);
    });
    const tag = quick ? 'quick start (labelled game option)' : 'normal start';
    rows.push(row('engine', `${tag}: light-off after starter`, tLight, 's', '', 'real: Ng 12-15 % in 3-6 s'));
    rows.push(row('engine', `${tag}: ground idle stable`, tIdle, 's', '', 'real: 25-45 s to idle'));
    rows.push(row('engine', `${tag}: rotor rpm at ground idle`, nrIdle * HELI.main.rpm100 / 100, 'rpm', '', `${nrIdle.toFixed(0)} % Nr, Ng ${ngIdle.toFixed(0)} %`));
    rows.push(row('engine', `${tag}: start to 99 % Nr (flight)`, tFly, 's', quick ? 'labelled, < 20 s' : '20-40 s', 'notes target', quick ? tFly < 20 : inRange(tFly, 20, 40)));
    rows.push(row('engine', `${tag}: rotor overshoot on reaching flight rpm`, maxNr, '% Nr', '<= 103', '', maxNr <= 103));
    if (!quick) {
      // flight idle: governed rotor, collective down, on the ground
      fly(h, null, 10);
      const s = h.state;
      rows.push(row('engine', 'flight idle (governed, collective down): rotor', s.rotor.rpm, 'rpm', '385-395', 'Bell 407 413, H125 386-394', inRange(s.rotor.rpm, 385, 395)));
      rows.push(row('engine', 'flight idle: torque / Ng', s.engine.torquePercent, '%', '', `Ng ${s.engine.ng.toFixed(1)} %`));
      rows.push(row('engine', 'flight idle: airframe sliding on the ground', s.groundSpeed * 1000, 'mm/s', '< 1', '', s.groundSpeed < 1e-3));
      // engine cut on the ground: rotor coasts down
      h.cutEngine();
      let t50 = null; const tc = h.time;
      fly(h, null, 60, (st) => { if (t50 == null && st.rotor.percent < 50) t50 = h.time - tc; });
      rows.push(row('engine', 'fuel off on the ground: rotor to 50 % (no brake)', t50, 's', '', 'real: 30-60 s coast'));
    }
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function governorDroop() {
  const rows = [];
  const h = makeAirborne({ alt: 300 });
  const p = new TestPilot(h, { speed: 0, alt: 300, heading: 0 });
  fly(h, p, 25);
  const c0 = h.controls.collective;
  p.on.collective = false;
  // pull: +0.2 collective in 0.4 s (hover to about full climb power), held 8 s
  let minNr = 200, maxTq = 0, tRec = null; const t0 = h.time;
  fly(h, p, 10, (s, t) => {
    h.controls.collective = c0 + 0.2 * Math.min(1, (h.time - t0) / 0.4);
    minNr = Math.min(minNr, s.rotor.percent); maxTq = Math.max(maxTq, s.engine.torquePercent);
    if (tRec == null && h.time - t0 > 0.5 && s.rotor.percent > 99.5) tRec = h.time - t0;
  });
  rows.push(row('governor', 'droop on a 0.2 collective pull in 0.4 s (hover to climb)', 100 - minNr, '% Nr', '2-6 %', 'hydromechanical 3-6 %, FADEC 1-2 %', inRange(100 - minNr, 1, 6)));
  rows.push(row('governor', 'droop: recovery to 99.5 % Nr', tRec, 's', '< 5', '', tRec != null && tRec < 5));
  rows.push(row('governor', 'droop: peak torque in the pull', maxTq, '%', '', 'overtorque flag above 100'));
  // dump: back to hover collective quickly
  let maxNr = 0; const t1 = h.time;
  fly(h, p, 8, () => { h.controls.collective = c0 + 0.2 - 0.3 * Math.min(1, (h.time - t1) / 0.4); maxNr = Math.max(maxNr, h.state.rotor.percent); });
  rows.push(row('governor', 'overshoot on a 0.3 collective dump in 0.4 s', maxNr - 100, '% Nr', '< 5', '', maxNr - 100 < 5));
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function hover() {
  const rows = [];
  const res = {};
  for (const [mass, label] of [[2200, '2200 kg'], [2500, '2500 kg']]) {
    const h = makeAirborne({ alt: 200, mass });
    const p = new TestPilot(h, { speed: 0, vLat: 0, alt: 200, heading: 0 });
    fly(h, p, 40);
    const a = average(h, p, 10, {
      col: (s) => s.controls.collective, tq: (s) => s.engine.torquePercent, pw: (s) => s.engine.powerPercent, kw: (s) => s.engine.powerUsed / 1e3,
      ped: (s) => s.controls.pedal, cp: (s) => s.controls.cyclicPitch, cr: (s) => s.controls.cyclicRoll, bank: (s) => s.bank / D2R, pitch: (s) => s.pitch / D2R,
      tt: (s) => s.rotor.tailThrust, T: (s) => s.rotor.thrust, coning: (s) => s.rotor.coning / D2R, th: (s) => s.rotor.bladePitch75 / D2R,
      pm: (s) => s.rotor.powerMain / 1e3, pt: (s) => s.rotor.powerTail / 1e3, vi: (s) => s.rotor.inducedVelocity,
    });
    res[mass] = a;
    const main = mass === 2200;
    rows.push(row('hover OGE', `${label}: power used / available (520 kW)`, a.pw, '%', main ? '60-75' : '', `${a.kw.toFixed(0)} kW (main ${a.pm.toFixed(0)}, tail ${a.pt.toFixed(0)}); H125 class hover OGE ~65-80 % TQ`, main ? inRange(a.pw, 60, 75) : undefined));
    rows.push(row('hover OGE', `${label}: collective`, a.col, '0..1', '', `blade pitch 0.75R ${a.th.toFixed(1)} deg`));
    rows.push(row('hover OGE', `${label}: pedal`, a.ped, '-1..1', 'left of centre', 'real: some left pedal in the hover', a.ped < 0));
    rows.push(row('hover OGE', `${label}: bank (left skid low = negative)`, a.bank, 'deg', '-1 to -4', 'US-rotation singles hang 1-3 deg left skid low', inRange(a.bank, -4, -1)));
    rows.push(row('hover OGE', `${label}: pitch attitude`, a.pitch, 'deg', '+1 to +6', 'class: 2-5 nose up', inRange(a.pitch, 1, 6)));
    if (main) {
      rows.push(row('hover OGE', `${label}: cyclic pitch / roll trim`, a.cp, '', '', `roll ${a.cr.toFixed(3)}`));
      rows.push(row('hover OGE', `${label}: thrust / weight (fuselage download)`, a.T / (mass * G), '', '1.02-1.06', 'class 3-6 % download', inRange(a.T / (mass * G), 1.02, 1.06)));
      rows.push(row('hover OGE', `${label}: tail rotor thrust`, a.tt, 'N', '', ''));
      rows.push(row('hover OGE', `${label}: coning`, a.coning, 'deg', '2-5', 'class 2-4 deg', inRange(a.coning, 1.5, 5)));
      rows.push(row('hover OGE', `${label}: induced velocity`, a.vi, 'm/s', '9-11', `momentum vh ${Math.sqrt(mass * G / (2 * 1.225 * Math.PI * 5.5 * 5.5)).toFixed(2)}`, inRange(a.vi, 9, 11.5)));
    }
  }
  // in ground effect: skid height sweep (root height above ground)
  const ige = [];
  for (const hs of [0.3, 1, 2, 4, 6, 11, 20]) {
    const h = makeAirborne({ alt: hs + 0.0 });
    const p = new TestPilot(h, { speed: 0, vLat: 0, alt: hs, heading: 0, maxVs: 1 });
    fly(h, p, 30);
    const a = average(h, p, 8, { pw: (s) => s.engine.powerPercent, col: (s) => s.controls.collective, ped: (s) => s.controls.pedal, bank: (s) => s.bank / D2R, rh: (s) => s.radarHeight, ge: (s) => s.rotor.groundEffect });
    ige.push([hs, a]);
  }
  const oge = res[2200].pw;
  for (const [hs, a] of ige) {
    const tgt = hs === 1 ? 'clearly below OGE' : '';
    rows.push(row('hover IGE', `skid height ${hs} m (z/D ${((hs + 3.02) / 11).toFixed(2)}): power`, a.pw, '%', tgt, `OGE ${oge.toFixed(1)} %, ${(100 * (1 - a.pw / oge)).toFixed(1)} % less; collective ${a.col.toFixed(3)}, pedal ${a.ped.toFixed(3)}, bank ${a.bank.toFixed(1)}`,
      hs === 1 ? a.pw < oge * 0.93 : hs === 20 ? Math.abs(a.pw - oge) < 1.5 : undefined));
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function verticalClimb() {
  const rows = [];
  for (const mass of [2200, 2500]) {
    const h = makeAirborne({ alt: 100, mass });
    const p = new TestPilot(h, { speed: 0, vLat: 0, alt: 100, heading: 0 });
    fly(h, p, 25);
    p.set({ alt: null, vs: null, torque: 100 });
    fly(h, p, 25);
    const a = average(h, p, 5, { vs: (s) => s.verticalSpeed, tq: (s) => s.engine.torquePercent, nr: (s) => s.rotor.percent, col: (s) => s.controls.collective, ped: (s) => s.controls.pedal });
    rows.push(row('climb', `left-pedal margin at 100 % torque (vertical climb), ${mass} kg`, 100 * (1 - Math.abs(a.ped)), '% travel', mass === 2200 ? '>= 25 (H1 27.8)' : '', `pedal ${a.ped.toFixed(3)}`, mass === 2200 ? 100 * (1 - Math.abs(a.ped)) >= 25 : undefined));
    rows.push(row('climb', `vertical climb at 100 % torque, ${mass} kg`, a.vs, 'm/s', mass === 2200 ? '8-10' : '', `torque ${a.tq.toFixed(0)} %, Nr ${a.nr.toFixed(1)} %, collective ${a.col.toFixed(2)}; class vertical ROC 5-8 m/s, forward ROC ~10`, mass === 2200 ? inRange(a.vs, 7, 10.5) : undefined));
  }
  // best forward climb at 100 % torque, 110 km/h
  const h = makeAirborne({ alt: 300, speed: 30 });
  const p = new TestPilot(h, { speed: 30, alt: 300, heading: 0 });
  fly(h, p, 30);
  p.set({ alt: null, torque: 100 });
  fly(h, p, 25);
  const a = average(h, p, 5, { vs: (s) => s.verticalSpeed, tq: (s) => s.engine.torquePercent });
  rows.push(row('climb', 'forward climb at 108 km/h, 100 % torque, 2200 kg', a.vs, 'm/s', '9-13', 'H125 max ROC 10.3 m/s, Bell 407 ~8.4 m/s', inRange(a.vs, 8, 14)));
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function levelSpeed() {
  const rows = [];
  const pts = [];
  let prev = null;
  for (const kmh of [0, 40, 70, 90, 100, 110, 120, 130, 140, 160, 180, 200, 220, 240, 245, 250, 255, 260]) {
    let a;
    if (kmh <= 240) a = trimLevel(kmh * KMH, { extra: { torqueMax: 125 } });
    else {
      // above 240 km/h: accelerate from the previous trim (a cold start at speed falls into a droop spiral)
      prev.pilot.set({ speed: kmh * KMH }); fly(prev.heli, prev.pilot, 60);
      a = average(prev.heli, prev.pilot, 6, { pw: (s) => s.engine.powerPercent, col: (s) => s.controls.collective, cp: (s) => s.controls.cyclicPitch, cr: (s) => s.controls.cyclicRoll, ped: (s) => s.controls.pedal, pitch: (s) => s.pitch / D2R, bank: (s) => s.bank / D2R, beta: (s) => s.sideslip / D2R, a1: (s) => s.rotor.discTiltForward / D2R, b1: (s) => s.rotor.discTiltRight / D2R, mach: (s) => s.rotor.advancingTipMach, u: (s) => s.forwardSpeed });
      a.heli = prev.heli; a.pilot = prev.pilot;
      a.kmhActual = a.u * 3.6;
    }
    prev = a;
    const kmhA = a.kmhActual || kmh;
    pts.push([kmhA, a]);
    rows.push(row('level flight', `${kmhA.toFixed(0)} km/h: power`, a.pw, '%', '', `collective ${a.col.toFixed(3)}, cyclic ${a.cp.toFixed(2)}/${a.cr.toFixed(2)}, pedal ${a.ped.toFixed(2)}, pitch ${a.pitch.toFixed(1)}, bank ${a.bank.toFixed(1)}, sideslip ${a.beta.toFixed(1)}, flapping ${a.a1.toFixed(1)}/${a.b1.toFixed(1)} deg, tip M ${a.mach.toFixed(3)}`));
  }
  // bucket
  let best = pts[0];
  for (const p of pts) if (p[1].pw < best[1].pw) best = p;
  rows.push(row('level flight', 'minimum-power speed (bucket)', best[0], 'km/h', '110-130 (60-70 kt)', `power ${best[1].pw.toFixed(1)} %; class Vy 55-65 kt`, inRange(best[0], 105, 135)));
  const cr = pts.find((p) => Math.abs(p[0] - 220) < 1)[1];
  rows.push(row('level flight', 'cruise 220 km/h: power', cr.pw, '%', '<= 90 (max continuous)', `pitch ${cr.pitch.toFixed(1)} deg; class cruise at 75-90 % TQ`, cr.pw <= 90));
  rows.push(row('level flight', 'cruise 220 km/h: pitch attitude', cr.pitch, 'deg', '-1 to -6', 'class cruise 2-5 nose down', inRange(cr.pitch, -6, -1)));
  // top speed at max continuous (90 %) and take-off (100 %) torque: where the trimmed power curve crosses
  for (const tq of [90, 100]) {
    let v = null;
    for (let i = 1; i < pts.length; i++) {
      const [k0, a0] = pts[i - 1], [k1, a1] = pts[i];
      if (k0 > 100 && a0.pw <= tq && a1.pw > tq) v = k0 + (k1 - k0) * (tq - a0.pw) / (a1.pw - a0.pw);
    }
    const last = pts[pts.length - 1];
    rows.push(row('level flight', `max level speed at ${tq} % torque (trimmed power curve)`, v == null ? `> ${last[0]}` : v, 'km/h', tq === 100 ? '245-265' : '', `Bell 407 Vh ~250, H125 ~260; ${v == null ? `power at ${last[0]} km/h only ${last[1].pw.toFixed(0)} %` : ''}`, tq === 100 ? v == null || inRange(v, 240, 270) : undefined));
  }
  // dive to 260 km/h and beyond: what the model shows at never-exceed
  {
    const h = makeAirborne({ alt: 400, speed: 62 });
    const p = new TestPilot(h, { speed: 62, alt: 400, heading: 0 });
    fly(h, p, 20);
    p.set({ alt: null, vs: -5, speed: 260 * KMH, torqueMax: 90 });
    fly(h, p, 40, (s) => { p.t.speed = 260 * KMH * s.airspeed / Math.max(s.ias, 1); });
    const a = average(h, p, 5, { ias: (s) => s.ias * 3.6, mach: (s) => s.rotor.advancingTipMach, cts: (s) => s.rotor.ctSigma, cp: (s) => s.controls.cyclicPitch, vne: (s) => +s.flags.overspeed, comp: (s) => +s.flags.compressibility });
    rows.push(row('never-exceed', 'shallow dive (5 m/s) to 260 km/h IAS: reached', a.ias, 'km/h', '~260', `forward cyclic ${a.cp.toFixed(2)} of 1.0, tip M ${a.mach.toFixed(3)}, CT/sigma ${a.cts.toFixed(3)}`, inRange(a.ias, 245, 275)));
    rows.push(row('never-exceed', 'at 260 km/h: advancing tip Mach (drag rise from 0.86)', a.mach, '', '0.86-0.90', 'Vne set where tip Mach ~0.87 and the stall margin at 1.5 g closes', inRange(a.mach, 0.85, 0.91)));
    // 1.5 g pull at 260: retreating blade stall
    p.set({ vs: 8, speed: null, pitch: 5 * D2R, torqueMax: 100 });
    let stallN = null, maxN = 0;
    fly(h, p, 4, (s) => { if (s.flags.retreatingBladeStall && stallN == null) stallN = s.loadFactor; maxN = Math.max(maxN, s.loadFactor); });
    rows.push(row('never-exceed', 'pull-up from 260 km/h: load factor at first retreating-blade-stall flag', stallN, 'g', '1.3-2.0', `peak load factor ${maxN.toFixed(2)} g in the pull`, stallN != null && inRange(stallN, 1.2, 2.1)));
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function yaw() {
  const rows = [];
  // pedal against collective in the hover (vertical speed changes)
  const peds = [];
  for (const vs of [-3, 0, 3, 6]) {
    const h = makeAirborne({ alt: 300 });
    const p = new TestPilot(h, { speed: 0, alt: null, vs, heading: 0 });
    fly(h, p, 20);
    const a = average(h, p, 5, { ped: (s) => s.controls.pedal, col: (s) => s.controls.collective, tq: (s) => s.engine.torquePercent });
    peds.push([vs, a]);
    rows.push(row('yaw', `vertical speed ${vs} m/s at zero airspeed: pedal`, a.ped, '-1..1', '', `collective ${a.col.toFixed(3)}, torque ${a.tq.toFixed(0)} %`));
  }
  const slope = (peds[3][1].ped - peds[0][1].ped) / (peds[3][1].col - peds[0][1].col);
  rows.push(row('yaw', 'pedal per unit collective in the hover (left = negative)', slope, '', '< 0 (more collective, more left pedal)', 'real: a few cm of pedal per cm of collective', slope < 0));
  // full pedal: steady yaw rate, height held by collective
  for (const ped of [1, -1]) {
    const h = makeAirborne({ alt: 300 });
    const p = new TestPilot(h, { speed: 0, alt: 300, heading: 0 });
    fly(h, p, 20);
    p.on.pedal = false; h.controls.pedal = ped;
    let rmax = 0;
    fly(h, p, 8, (s) => { rmax = Math.max(rmax, Math.abs(s.rates.yawRight)); });
    const a = average(h, p, 2, { r: (s) => s.rates.yawRight / D2R, tq: (s) => s.engine.torquePercent });
    rows.push(row('yaw', `full ${ped > 0 ? 'right' : 'left'} pedal in the hover: yaw rate after 8 s`, a.r, 'deg/s', '90-120 (V2)', `torque ${a.tq.toFixed(0)} %; class spot-turn limits 60-90 deg/s`, inRange(Math.abs(a.r), 85, 125)));
  }
  // pedal turn: 30 deg/s for 360 deg holding height
  {
    const h = makeAirborne({ alt: 50 });
    const p = new TestPilot(h, { speed: 0, alt: 50, heading: 0 });
    fly(h, p, 20);
    p.set({ yawRate: 30 * D2R, heading: null });
    let dh = 0, drift = 0, pedMin = 1, pedMax = -1;
    fly(h, p, 12, (s) => { dh = Math.max(dh, Math.abs(s.altitude - 50)); drift = Math.max(drift, s.groundSpeed); pedMin = Math.min(pedMin, s.controls.pedal); pedMax = Math.max(pedMax, s.controls.pedal); });
    rows.push(row('yaw', 'pedal turn 30 deg/s, 360 deg: max height error', dh, 'm', '< 1', `max drift ${drift.toFixed(2)} m/s, pedal ${pedMin.toFixed(2)} to ${pedMax.toFixed(2)}`, dh < 1));
  }
  // weathercock: sideslip at 150 km/h with pedals frozen
  {
    const a = trimLevel(150 * KMH);
    const h = a.heli, p = a.pilot;
    p.on.pedal = false; const ped0 = h.controls.pedal;
    h.controls.pedal = ped0 + 0.15;
    fly(h, p, 6);
    const b = average(h, p, 2, { beta: (s) => s.sideslip / D2R });
    rows.push(row('yaw', 'directional stability at 150 km/h: sideslip from +0.15 pedal step', b.beta, 'deg', 'steady, |beta| < 10', 'fin + tail rotor weathercock', Math.abs(b.beta) < 10));
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function levelTurn() {
  const rows = [];
  const V = 150 * KMH;
  for (const bankDeg of [30, 45]) {
    const a = trimLevel(V);
    const h = a.heli, p = a.pilot;
    p.set({ bank: bankDeg * D2R, heading: null, sideslip: 0, turnRate: 0 });
    let maxN = 0;
    fly(h, p, 20, (s) => { p.t.turnRate = G * Math.tan(s.bank) / Math.max(s.forwardSpeed, 5); maxN = Math.max(maxN, s.loadFactor); });
    const b = average(h, p, 6, { n: (s) => s.loadFactor, tq: (s) => s.engine.torquePercent, vs: (s) => s.verticalSpeed, u: (s) => s.forwardSpeed * 3.6, r: (s) => s.rates.yawRight / D2R, bank: (s) => s.bank / D2R, col: (s) => s.controls.collective, cts: (s) => s.rotor.ctSigma });
    const nIdeal = 1 / Math.cos(bankDeg * D2R);
    rows.push(row('turn', `${bankDeg} deg bank, 150 km/h level: load factor`, b.n, 'g', nIdeal.toFixed(3), `bank ${b.bank.toFixed(1)}, vs ${b.vs.toFixed(2)}, speed ${b.u.toFixed(0)} km/h, turn rate ${b.r.toFixed(1)} deg/s`, Math.abs(b.n - nIdeal) < 0.05));
    rows.push(row('turn', `${bankDeg} deg bank, 150 km/h: torque`, b.tq, '%', '', `straight ${a.tq.toFixed(0)} %; collective ${b.col.toFixed(3)}, CT/sigma ${b.cts.toFixed(3)}`));
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function autorotation() {
  const rows = [];
  const V = 120 * KMH;
  const h = makeAirborne({ alt: 300, speed: V });
  const p = new TestPilot(h, { speed: V, alt: 300, heading: 0 });
  fly(h, p, 30);
  h.cutEngine();
  // pilot reaction: collective held for 1.0 s after the cut (the rotor droops), then lowered fully
  p.on.collective = false;
  let entryMin = 200; const tCut = h.time;
  fly(h, p, 1.0, (s) => { entryMin = Math.min(entryMin, s.rotor.percent); });
  h.controls.collective = 0; p.I.col = 0; p.on.collective = true;
  p.set({ alt: null, vs: null, rpm: 103 });
  let minNr = 200, maxNr = 0;
  fly(h, p, 120, (s) => { entryMin = Math.min(entryMin, s.rotor.percent); if (h.time - tCut > 6) { minNr = Math.min(minNr, s.rotor.percent); maxNr = Math.max(maxNr, s.rotor.percent); } return s.radarHeight > 100; });
  rows.push(row('autorotation', 'entry: lowest rotor speed with a 1 s pilot delay at 120 km/h', entryMin, '% Nr', '85-95 (low-rotor horn at 95)', 'decay ~9 %/s at cruise power; real light singles reach the horn in 1-2 s', inRange(entryMin, 85, 96)));
  const a = average(h, p, 4, { vs: (s) => s.verticalSpeed, nr: (s) => s.rotor.percent, col: (s) => s.controls.collective, u: (s) => s.forwardSpeed * 3.6, ped: (s) => s.controls.pedal });
  rows.push(row('autorotation', 'steady descent at 120 km/h, engine off', -a.vs, 'm/s', '8-12', `collective ${a.col.toFixed(3)}, pedal ${a.ped.toFixed(2)} (right of hover trim), speed ${a.u.toFixed(0)} km/h; H125 ~8.5, Bell 206 ~8-10`, inRange(-a.vs, 8, 12)));
  rows.push(row('autorotation', 'rotor speed in the steady descent', a.nr, '% Nr', '95-107', `range after entry ${minNr.toFixed(1)}-${maxNr.toFixed(1)} %`, inRange(minNr, 93, 110) && inRange(maxNr, 93, 110)));
  // with collective fully down (no rpm management)
  {
    const h2 = makeAirborne({ alt: 600, speed: V });
    const p2 = new TestPilot(h2, { speed: V, alt: 600, heading: 0 });
    fly(h2, p2, 30); h2.cutEngine(); p2.set({ alt: null, collective: 0 });
    fly(h2, p2, 25);
    const b = average(h2, p2, 5, { nr: (s) => s.rotor.percent, vs: (s) => s.verticalSpeed });
    rows.push(row('autorotation', 'collective fully down: rotor speed', b.nr, '% Nr', '100-110', `descent ${(-b.vs).toFixed(1)} m/s; low-pitch stop rigged for this`, inRange(b.nr, 100, 112)));
  }
  // flare and touchdown (phase-scripted pilot): flare 20 deg nose up at 25 m with the collective down
  // (Nr allowed to 110 %), ease the attitude if it balloons, level at 5 m or 30 km/h, then use the
  // collective (rotor energy) to fly a height-proportional sink down to 0.5 m/s
  let phase = 'glide', tdVs = null, tdU = null, tdNr = null, maxPitch = 0, maxN = 0, contactLost = false, firstTouch = null, minH = 1e9;
  fly(h, p, 60, (s) => {
    const hgt = s.radarHeight;
    if (phase === 'glide' && hgt < 25) { phase = 'flare'; p.set({ speed: null, pitch: 20 * D2R, rpm: 110 }); }
    if (phase === 'flare') p.t.pitch = (s.verticalSpeed > 0 ? 8 : s.verticalSpeed > -1.5 ? 13 : 20) * D2R;
    if (phase === 'flare' && (hgt < 5 || s.forwardSpeed < 8)) { phase = 'level'; p.I.col = s.controls.collective; p.set({ pitch: 5 * D2R, rpm: null, alt: null, maxVs: 3 }); }
    if (phase === 'level') p.t.vs = -Math.min(Math.max(0.3 * hgt, 0.5), 4);
    maxPitch = Math.max(maxPitch, s.pitch / D2R);
    if (phase !== 'glide') maxN = Math.max(maxN, s.loadFactor);
    if (s.contact.onGround && firstTouch == null) {
      firstTouch = h.time; tdVs = s.verticalSpeed; tdU = s.groundSpeed * 3.6; tdNr = s.rotor.percent; phase = 'ground';
      p.on.pitch = false; p.on.roll = false; p.on.collective = false; h.controls.cyclicPitch = 0; h.controls.cyclicRoll = 0;
    }
    if (firstTouch != null) h.controls.collective = Math.max(0, h.controls.collective - 0.4 / 60);
    if (firstTouch != null && !s.contact.onGround && h.time - firstTouch > 0.05) contactLost = true;
    return !(firstTouch != null && h.time - firstTouch > 10);
  });
  const s = h.state;
  rows.push(row('autorotation', 'flare: touchdown vertical speed', tdVs == null ? NaN : -tdVs, 'm/s', '< 1.5', `ground speed ${tdU == null ? '-' : tdU.toFixed(0)} km/h (real: 0-40 km/h run-on), Nr ${tdNr == null ? '-' : tdNr.toFixed(0)} %, max pitch ${maxPitch.toFixed(0)} deg, peak ${maxN.toFixed(2)} g in the flare`, tdVs != null && -tdVs < 1.5));
  rows.push(row('autorotation', 'after touchdown: upright and stopped', Math.abs(s.bank / D2R), 'deg bank', '< 10, no contact loss', `contact lost after first touch: ${contactLost}; final speed ${(s.groundSpeed * 1000).toFixed(0)} mm/s`, Math.abs(s.bank / D2R) < 10 && !contactLost));
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function vortexRing() {
  const rows = [];
  const h = makeAirborne({ alt: 1500 });
  const p = new TestPilot(h, { speed: 0, alt: 1500, heading: 0, torqueMax: 100 });
  fly(h, p, 25);
  const hov = average(h, p, 3, { col: (s) => s.controls.collective, tq: (s) => s.engine.torquePercent });
  // gentle vertical descent: no ring
  p.set({ alt: null, vs: -2.5 }); fly(h, p, 20);
  const g = average(h, p, 5, { col: (s) => s.controls.collective, ring: (s) => s.rotor.vortexRing, vs: (s) => s.verticalSpeed });
  rows.push(row('vortex ring', 'vertical descent 2.5 m/s, zero airspeed: collective vs hover', g.col - hov.col, '', '< 0 (less than hover)', `ring ${g.ring.toFixed(2)}, achieved ${g.vs.toFixed(1)} m/s, hover collective ${hov.col.toFixed(3)} (1500 m)`, g.col < hov.col && g.ring < 0.3));
  // the pilot asks for 6 m/s straight down at zero airspeed, torque limited to 100 %
  p.set({ vs: -6 });
  let tRing = null; const t0 = h.time;
  fly(h, p, 20, (s) => { if (tRing == null && s.flags.vortexRing) tRing = h.time - t0; });
  const a = average(h, p, 5, { col: (s) => s.controls.collective, ring: (s) => s.rotor.vortexRing, vs: (s) => s.verticalSpeed, tq: (s) => s.engine.torquePercent, ri: (s) => h._out.ringInflow });
  rows.push(row('vortex ring', 'asked for 6 m/s vertical descent: achieved sink (thrust lost, cannot hold it)', -a.vs, 'm/s', '> 6 (runs away)', `ring ${a.ring.toFixed(2)} flagged after ${tRing == null ? '-' : tRing.toFixed(1)} s, collective ${a.col.toFixed(3)} (hover ${hov.col.toFixed(3)}), torque ${a.tq.toFixed(0)} %, re-ingested inflow ${a.ri.toFixed(1)} m/s`, -a.vs > 6.5));
  // in the ring: hover collective for 8 s, then add power to 100 % torque, still no forward speed
  p.set({ vs: null, collective: hov.col });
  fly(h, p, 8);
  const hc = average(h, p, 3, { vs: (s) => s.verticalSpeed, ring: (s) => s.rotor.vortexRing, tq: (s) => s.engine.torquePercent, T: (s) => s.rotor.thrust });
  rows.push(row('vortex ring', 'in the ring, hover collective, 8 s: sink', -hc.vs, 'm/s', '> 5', `thrust ${(hc.T / (2200 * G)).toFixed(2)} W (thrust/weight at the hover collective, 3 s average), ring ${hc.ring.toFixed(2)}, torque ${hc.tq.toFixed(0)} %`, -hc.vs > 5));
  p.set({ collective: null, torque: 100 });
  fly(h, p, 8);
  const pw = average(h, p, 4, { vs: (s) => s.verticalSpeed, ring: (s) => s.rotor.vortexRing, tq: (s) => s.engine.torquePercent });
  rows.push(row('vortex ring', 'then 100 % torque, zero airspeed, 8 s: sink', -pw.vs, 'm/s', `>= ${(-hc.vs).toFixed(1)} (power makes it no better)`, `ring ${pw.ring.toFixed(2)}, torque ${pw.tq.toFixed(0)} %`, -pw.vs >= -hc.vs - 0.3));
  // fly forward: 20 m/s with the same torque
  p.set({ speed: 20, minPitch: -12 * D2R });
  let tOut = null; const t1 = h.time;
  fly(h, p, 15, (s) => { if (tOut == null && s.rotor.vortexRing < 0.1 && s.verticalSpeed > -2) tOut = h.time - t1; });
  const fwd = average(h, p, 3, { vs: (s) => s.verticalSpeed, ring: (s) => s.rotor.vortexRing, u: (s) => s.forwardSpeed });
  rows.push(row('vortex ring', 'then forward cyclic to 72 km/h: time to recover (ring gone, sink < 2 m/s)', tOut, 's', '< 10', `after 15 s: vertical speed ${fwd.vs.toFixed(1)} m/s (climbing at 100 % torque), ring ${fwd.ring.toFixed(2)}, speed ${(fwd.u * 3.6).toFixed(0)} km/h; real: 15-20 kt forward recovers`, tOut != null && tOut < 10));
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function landing({ sink, groundAt = flat, fwd = 0, side = 0, label, hold = 8 }) {
  // hover at 3 m, then fly down at `sink` with fwd/side ground speed held to touchdown, then collective down
  const h = makeAirborne({ alt: 4, groundAt, speed: 0 });
  const p = new TestPilot(h, { speed: fwd, vLat: side, alt: 4, heading: 0, maxVs: Math.max(3, sink + 0.5) });
  if (fwd || side) { h.reset({ position: [0, 4, 0], running: 'flight', inAir: true, velocity: [side, 0, -fwd], controls: { collective: 0.45, throttle: 1 } }); }
  const g0 = groundAt(0, 0); const gh = typeof g0 === 'number' ? g0 : g0.height;
  p.set({ alt: gh + 4 });
  fly(h, p, 15);
  p.set({ alt: null, vs: -sink });
  let first = null, vsTd = null, uTd = null, lost = false, maxBank = 0, maxPitchD = 0, maxN = 0, peakF = 0, touches = 0, wasOn = false;
  fly(h, p, 60, (s) => {
    const on = s.contact.onGround;
    if (on && !wasOn) touches++;
    wasOn = on;
    if (on && first == null) {
      first = h.time; vsTd = s.verticalSpeed; uTd = s.groundSpeed;
      // pilot: lower the collective over 2 s, cyclic centred-ish, pedals frozen
      p.on.pitch = false; p.on.roll = false; p.on.pedal = false; p.on.collective = false;
      p.col0 = s.controls.collective; p.cp0 = s.controls.cyclicPitch; p.cr0 = s.controls.cyclicRoll;
    }
    if (first != null) {
      const t = h.time - first;
      h.controls.collective = Math.max(0, p.col0 * (1 - t / 2.5));
      if (t > 0.05 && !on) lost = true;
      maxN = Math.max(maxN, (s.contact.leftSkid.normal + s.contact.rightSkid.normal) / (h.mass * G));
      peakF = Math.max(peakF, s.contact.leftSkid.normal, s.contact.rightSkid.normal);
    }
    maxBank = Math.max(maxBank, Math.abs(s.bank / D2R)); maxPitchD = Math.max(maxPitchD, Math.abs(s.pitch / D2R));
    return !(first != null && h.time - first > hold);
  });
  const s = h.state;
  return { h, s, vsTd, uTd, lost, maxBank, maxPitchD, maxN, peakF, touches, label };
}

export function landings() {
  const rows = [];
  const gentle = landing({ sink: 0.4, label: 'gentle' });
  rows.push(row('landing', 'gentle: touchdown sink', -gentle.vsTd, 'm/s', '< 1', '', -gentle.vsTd < 1));
  rows.push(row('landing', 'gentle: bounce (contact lost after first touch)', gentle.lost ? 1 : 0, 'flag', '0', `touch-downs ${gentle.touches}; peak skid load ${gentle.maxN.toFixed(2)} W; settled speed ${(gentle.s.groundSpeed * 1000).toFixed(2)} mm/s`, !gentle.lost));
  const firm = landing({ sink: 2.5, label: 'firm' });
  rows.push(row('landing', 'firm 2.5 m/s: touchdown sink', -firm.vsTd, 'm/s', '~2.5', '', inRange(-firm.vsTd, 2.0, 3.0)));
  rows.push(row('landing', 'firm 2.5 m/s: max bank (no tip)', firm.maxBank, 'deg', '< 10', `peak skid load ${firm.maxN.toFixed(2)} W (real skid gear designed for ~2.5-3 g at 2.4-3 m/s), contact lost: ${firm.lost}`, firm.maxBank < 10));
  const sl = landing({ sink: 0.4, groundAt: slopeX(6), label: 'slope' });
  rows.push(row('landing', '6 deg cross-slope: final bank', sl.s.bank / D2R, 'deg', '~ -6 / +6 (sits on the slope)', `max bank ${sl.maxBank.toFixed(1)}, settled speed ${(sl.s.groundSpeed * 1000).toFixed(2)} mm/s, contact lost ${sl.lost}`, inRange(Math.abs(sl.s.bank / D2R), 4.5, 8) && sl.s.groundSpeed < 0.01));
  const run = landing({ sink: 0.6, fwd: 40 * KMH, label: 'run-on', hold: 12 });
  const slide = Math.hypot(run.s.position.x, run.s.position.z);
  rows.push(row('landing', 'run-on at 40 km/h: upright, max pitch', run.maxPitchD, 'deg', '< 10', `touchdown ${(run.uTd * 3.6).toFixed(0)} km/h, sink ${(-run.vsTd).toFixed(2)} m/s; stopped ${(run.s.groundSpeed).toFixed(3)} m/s; max bank ${run.maxBank.toFixed(1)}`, run.maxPitchD < 10 && run.maxBank < 10 && run.s.groundSpeed < 0.05));
  // side drift at touchdown: find the drift speed that rolls it over. Hard ground: shoe slides
  // (side friction 0.65 < half-track / CG height 0.88). Soft or rough ground (friction x1.6): the
  // skid digs in and becomes the pivot of a dynamic roll-over.
  const soft = () => ({ height: 0, normal: [0, 1, 0], friction: 1.6 });
  for (const [gname, gfn] of [['hard', flat], ['soft (skid digs in)', soft]]) {
    let tipAt = null; const tried = [];
    for (const side of [1, 2, 3, 4, 5, 6]) {
      const r = landing({ sink: 0.8, side, groundAt: gfn, label: 'drift', hold: 6 });
      tried.push(`${side} m/s: ${r.maxBank.toFixed(0)} deg (td drift ${(r.uTd || 0).toFixed(1)})`);
      if (r.maxBank > 60) { tipAt = side; break; }
    }
    const isSoft = gname !== 'hard';
    rows.push(row('landing', `side drift at touchdown, ${gname} ground: lowest drift that rolls it over`, tipAt == null ? '> 6' : tipAt, 'm/s', isSoft ? '2-5 (tips when it should)' : 'slides, no tip', `max bank: ${tried.join(', ')}`, isSoft ? tipAt != null && inRange(tipAt, 2, 5) : tipAt == null));
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
export function stability() {
  const rows = [];
  // release controls (frozen at trim) with the assist off: cruise and hover
  for (const [label, speed] of [['cruise 220 km/h', 220 * KMH], ['hover', 0]]) {
    const a = speed ? trimLevel(speed) : (() => { const h = makeAirborne({ alt: 300 }); const p = new TestPilot(h, { speed: 0, alt: 300, heading: 0 }); fly(h, p, 30); return { heli: h, pilot: p }; })();
    const h = a.heli; const s0 = { ...h.state }; const pitch0 = s0.pitch, bank0 = s0.bank, hdg0 = s0.heading, u0 = s0.forwardSpeed, alt0 = s0.altitude;
    let maxP = 0, maxB = 0, maxH = 0, t10 = null, ok = true;
    fly(h, null, 20, (s, t) => {
      maxP = Math.max(maxP, Math.abs(s.pitch - pitch0) / D2R); maxB = Math.max(maxB, Math.abs(s.bank - bank0) / D2R);
      maxH = Math.max(maxH, Math.abs(s.heading - hdg0) / D2R);
      if (t10 == null && (Math.abs(s.pitch - pitch0) > 10 * D2R || Math.abs(s.bank - bank0) > 10 * D2R)) t10 = t;
      if (!finite(s)) ok = false;
    });
    rows.push(row('stability', `${label}, assist off, controls frozen 20 s: time to 10 deg attitude change`, t10 == null ? 20 : t10, 's', 'diverges slowly (> 2 s), no NaN', `max pitch change ${maxP.toFixed(1)}, bank ${maxB.toFixed(1)}, heading ${maxH.toFixed(1)} deg; real helicopters are unstable hands-off`, ok && (t10 == null || t10 > 2)));
    // assist on, sticks centred: attitude + heading (+ hover hold in the hover)
    const h2 = speed ? trimLevel(speed).heli : (() => { const hh = makeAirborne({ alt: 300 }); const pp = new TestPilot(hh, { speed: 0, alt: 300, heading: 0 }); fly(hh, pp, 30); return hh; })();
    const as = new FlightAssist({ hoverHold: !speed, altitudeHold: true });
    as.reset(h2.state);
    // pre-load the assist trims from the current controls (what a pilot engaging it at trim does)
    as.I.cp = h2.controls.cyclicPitch; as.I.cr = h2.controls.cyclicRoll; as.I.ped = h2.controls.pedal;
    const st0 = { ...h2.state };
    let mP = 0, mB = 0, mAlt = 0, mU = 0;
    const keys = { cyclicPitch: 0, cyclicRoll: 0, pedal: 0, collective: h2.controls.collective };
    fly(h2, null, 30, (s, t) => {
      h2.setControls(as.update(s, keys, 1 / 60));
      if (t > 5) { mP = Math.max(mP, Math.abs(s.pitch - as.status.targets.pitch) / D2R); mB = Math.max(mB, Math.abs(s.bank - as.status.targets.bank) / D2R); mAlt = Math.max(mAlt, Math.abs(s.altitude - st0.altitude)); mU = Math.max(mU, Math.abs(s.groundSpeed - (speed ? 0 : 0))); }
    });
    rows.push(row('stability', `${label}, assist on (attitude, heading, ${speed ? 'altitude' : 'hover'} hold), sticks centred 30 s: max bank error`, mB, 'deg', '< 3', `max pitch error ${mP.toFixed(1)} deg, height error ${mAlt.toFixed(1)} m${speed ? '' : `, drift ${mU.toFixed(2)} m/s`}; channels: ${Object.values(as.status.channels).join('; ')}`, mB < 3 && mAlt < 5));
  }
  // numerics: sub-step counts and frame rates
  const runAt = (hz, frame) => {
    const h = new Helicopter({ substepHz: hz });
    h.reset({ position: [0, 300, 0], running: 'flight', inAir: true, velocity: [0, 0, -40], controls: { collective: 0.42, throttle: 1 } });
    const p = new TestPilot(h, { speed: 40, alt: 300, heading: 0 });
    for (let t = 0; t < 20; t += frame) { p.update(frame); h.step(frame); }
    return h.state;
  };
  const a = runAt(480, 1 / 60), b = runAt(960, 1 / 60), c = runAt(480, 1 / 30), d = runAt(240, 1 / 60);
  const dpos = (x, y) => Math.hypot(x.position.x - y.position.x, x.position.y - y.position.y, x.position.z - y.position.z);
  rows.push(row('numerics', '20 s at 144 km/h: position difference 480 Hz vs 960 Hz sub-steps', dpos(a, b), 'm', '< 2', `240 Hz vs 480: ${dpos(a, d).toFixed(2)} m; 30 Hz frames vs 60: ${dpos(a, c).toFixed(2)} m; all finite: ${[a, b, c, d].every(finite)}`, dpos(a, b) < 2 && [a, b, c, d].every(finite)));
  // frame hitch: a 0.5 s frame is clipped to 0.1 s
  {
    const h = makeAirborne({ alt: 300 });
    h.step(0.5); h.step(1 / 60);
    rows.push(row('numerics', 'single 0.5 s frame (clipped to 0.1 s): state finite', finite(h.state) ? 1 : 0, 'flag', '1', '', finite(h.state)));
  }
  // energy on the ground: engine off, and rotor at flight idle
  for (const running of ['cold', 'flight']) {
    const h = new Helicopter();
    h.reset({ running, controls: { collective: 0, throttle: running === 'flight' ? 1 : 0 } });
    let vmax = 0, ke0 = null, ke1 = 0;
    fly(h, null, 70, (s, t) => {
      const v = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
      const w = Math.hypot(s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z);
      const ke = 0.5 * h.mass * v * v + 0.5 * 6000 * w * w;
      if (t > 10) { vmax = Math.max(vmax, v); if (ke0 == null) ke0 = ke; ke1 = ke; }
    });
    rows.push(row('numerics', `on the ground 60 s (${running === 'cold' ? 'engine off' : 'rotor at flight idle'}): max airframe speed`, vmax * 1000, 'mm/s', '< 1', `body kinetic energy ${ke0.toExponential(2)} J at 10 s -> ${ke1.toExponential(2)} J at 70 s`, vmax < 1e-3 && ke1 <= ke0 * 1.01 + 1e-9));
  }
  return rows;
}

export const ALL = { engineStart, governorDroop, hover, verticalClimb, levelSpeed, yaw, levelTurn, autorotation, vortexRing, landings, stability };
