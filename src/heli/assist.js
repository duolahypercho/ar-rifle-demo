/*
 * Keyboard flight assist for src/heli/flight.js (pass H1).
 *
 * A separate, switchable layer between the player's keys and the aircraft. It reads only
 * heli.state (attitude, rates, velocities, heights, torque: what an autopilot's sensors give) and
 * writes only the four raw controls (collective, cyclicPitch, cyclicRoll, pedal). It never touches
 * the physics. With every mode off it passes the player's inputs straight through.
 *
 *   const assist = new FlightAssist();                 // default: rate damping, attitude, heading, torque limit
 *   assist.setMode('hoverHold', true);
 *   const c = assist.update(heli.state, keys, dt);     // keys: {cyclicPitch, cyclicRoll, pedal, collective, collectiveRate}
 *   heli.setControls(c);                               // c also says what each channel did: assist.status
 *
 * Inputs (keys): cyclicPitch, cyclicRoll, pedal in -1..1 (keyboard: -1, 0 or 1, or a smoothed ramp);
 * collective = the lever position 0..1 the player has set; collectiveRate -1..1 = up/down keys held
 * (used as a climb-rate command when altitudeHold or hoverHold is on).
 *
 * Modes:
 *   rateDamping   adds -K x body rate to cyclic and pedal (a stability augmentation system),
 *                 authority limited to +-0.3 of travel.
 *   attitudeHold  stick commands an attitude (full stick = 20 deg pitch, 35 deg bank from the
 *                 reference); stick centred holds wings level and assist.pitchTrim (default +3 deg, the
 *                 hover attitude, so hands-off it slows toward the hover; set about -2 deg to cruise at
 *                 ~220 km/h hands-off). The cyclic trim is found by an integrator, not taken from the model.
 *   headingHold   pedal commands a yaw rate (full = 45 deg/s); pedals released hold the heading. Above
 *                 20 m/s the held heading follows a coordinated turn (rate = g tan(bank) / V).
 *   hoverHold     below 4 m/s ground speed with the stick centred: holds zero ground velocity (drift
 *                 is trimmed out through the attitude command) and holds height (radar below 30 m,
 *                 else altitude).
 *   altitudeHold  holds altitude; collectiveRate commands a climb or descent (+-5 m/s).
 *   torqueLimit   never lets collective take engine torque above 100 %.
 */

const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export const ASSIST_MODES = ['rateDamping', 'attitudeHold', 'headingHold', 'hoverHold', 'altitudeHold', 'torqueLimit'];

export class FlightAssist {
  constructor(modes = {}) {
    this.enabled = true;
    this.pitchTrim = 3 * D2R;   // attitude reference with the stick centred (hover attitude); the game may trim it
    this.rollTrim = 0;          // (V5) bank reference with the stick centred (0: wings level); the force-trim key sets both
    this.modes = { rateDamping: true, attitudeHold: true, headingHold: true, hoverHold: false, altitudeHold: false, torqueLimit: true, ...modes };
    this.reset();
  }

  reset(state) {
    this.I = { cp: 0, cr: 0, ped: -0.3, col: null, velX: 0, velZ: 0 };
    this.headingRef = state ? state.heading : null;
    this.heightRef = null; this.heightKind = null;
    this.tqCap = null;
    this.status = { active: [], channels: {} };
  }

  setMode(name, on) { if (name in this.modes) this.modes[name] = !!on; }
  toggle(name) { this.setMode(name, !this.modes[name]); return this.modes[name]; }

  update(s, keys = {}, dt = 1 / 60) {
    const k = { cyclicPitch: 0, cyclicRoll: 0, pedal: 0, collective: s.controls ? s.controls.collective : 0, collectiveRate: 0, ...keys };
    const out = { collective: clamp(k.collective, 0, 1), cyclicPitch: clamp(k.cyclicPitch, -1, 1), cyclicRoll: clamp(k.cyclicRoll, -1, 1), pedal: clamp(k.pedal, -1, 1) };
    const st = { active: [], channels: {}, targets: {} };
    this.status = st;
    if (!this.enabled) { st.channels = { all: 'off: raw controls' }; return out; }
    const M = this.modes;
    const onGround = s.contact && s.contact.onGround && s.radarHeight < 0.3;
    const V = Math.hypot(s.velocity.x, s.velocity.z);
    const hd = s.heading;
    const fx = Math.sin(hd), fz = -Math.cos(hd), rx = Math.cos(hd), rz = Math.sin(hd);
    const u = s.velocity.x * fx + s.velocity.z * fz, vl = s.velocity.x * rx + s.velocity.z * rz;
    const stickCentred = Math.abs(k.cyclicPitch) < 0.05 && Math.abs(k.cyclicRoll) < 0.05;
    const hover = M.hoverHold && stickCentred && V < 4 && !onGround;

    // ---------------- cyclic ----------------
    if (M.attitudeHold && !onGround) {
      let thC = this.pitchTrim - 20 * D2R * k.cyclicPitch;
      let phC = this.rollTrim + 35 * D2R * k.cyclicRoll;
      if (hover) {
        // velocity hold: slow integrators find the drift trim (tail-rotor side force, wind)
        this.I.velX = clamp(this.I.velX + 0.004 * u * dt * 10, -0.12, 0.12);
        this.I.velZ = clamp(this.I.velZ - 0.004 * vl * dt * 10, -0.12, 0.12);
        thC = this.pitchTrim + this.I.velX + 0.03 * u;
        phC = this.I.velZ - 0.035 * vl;
        st.channels.velocity = `hover hold: fwd ${u.toFixed(2)} m/s, right ${vl.toFixed(2)} m/s`;
      }
      const eth = s.pitch - thC, eph = phC - s.bank;
      this.I.cp = clamp(this.I.cp + 1.2 * eth * dt, -0.8, 0.8);
      this.I.cr = clamp(this.I.cr + 1.2 * eph * dt, -0.8, 0.8);
      out.cyclicPitch = clamp(this.I.cp + 2.2 * eth + 0.7 * s.rates.pitchUp, -1, 1);
      out.cyclicRoll = clamp(this.I.cr + 1.7 * eph - 0.15 * s.rates.rollRight, -1, 1);
      st.active.push('attitudeHold');
      st.targets.pitch = thC; st.targets.bank = phC;
      st.channels.cyclic = `attitude: pitch ${(thC / D2R).toFixed(1)} deg, bank ${(phC / D2R).toFixed(1)} deg`;
    } else {
      if (onGround) { this.I.cp = out.cyclicPitch; this.I.cr = out.cyclicRoll; }
      if (M.rateDamping && !onGround) {
        out.cyclicPitch = clamp(out.cyclicPitch + clamp(0.6 * s.rates.pitchUp, -0.3, 0.3), -1, 1);
        out.cyclicRoll = clamp(out.cyclicRoll - clamp(0.25 * s.rates.rollRight, -0.3, 0.3), -1, 1);
        st.active.push('rateDamping');
        st.channels.cyclic = 'rate damping on pilot cyclic';
      } else st.channels.cyclic = onGround ? 'on ground: pilot cyclic' : 'pilot';
    }

    // ---------------- pedals ----------------
    // (V2) also on the ground once the collective is up: the skids get light and the torque would turn it
    const light = onGround && out.collective > 0.25;
    if (M.headingHold && (!onGround || light)) {
      let rC;
      if (Math.abs(k.pedal) > 0.05) { rC = 45 * D2R * k.pedal; this.headingRef = null; }
      else {
        if (this.headingRef == null) this.headingRef = hd;
        if (V > 20) { rC = 9.80665 * Math.tan(s.bank) / V; this.headingRef = hd; }
        else rC = clamp(1.2 * wrapPi(this.headingRef - hd), -0.5, 0.5);
      }
      const e = rC - s.rates.yawRight;
      this.I.ped = clamp(this.I.ped + 0.8 * e * dt, -1, 1);
      out.pedal = clamp(this.I.ped + 0.6 * e, -1, 1);
      st.active.push('headingHold');
      st.targets.yawRate = rC;
      st.channels.pedal = this.headingRef == null ? `yaw rate ${(rC / D2R).toFixed(0)} deg/s` : `heading hold ${(this.headingRef / D2R).toFixed(1)} deg`;
    } else {
      if (onGround) { this.I.ped = out.pedal; this.headingRef = null; }
      if (M.rateDamping && !onGround) {
        out.pedal = clamp(out.pedal - clamp(0.5 * s.rates.yawRight, -0.3, 0.3), -1, 1);
        st.channels.pedal = 'yaw damping on pilot pedal';
      } else st.channels.pedal = 'pilot';
    }

    // ---------------- collective ----------------
    const holdH = (M.altitudeHold || hover) && !onGround;
    if (holdH) {
      const useRadar = s.radarHeight < 30;
      const hNow = useRadar ? s.radarHeight : s.altitude;
      if (this.heightRef == null || this.heightKind !== useRadar || Math.abs(k.collectiveRate) > 0.05) { this.heightRef = hNow; this.heightKind = useRadar; }
      const vsC = Math.abs(k.collectiveRate) > 0.05 ? 5 * k.collectiveRate : clamp(0.6 * (this.heightRef - hNow), -3, 3);
      if (this.I.col == null) this.I.col = out.collective;
      const e = vsC - s.verticalSpeed;
      this.I.col = clamp(this.I.col + 0.12 * e * dt, 0, 1);
      out.collective = clamp(this.I.col + 0.08 * e, 0, 1);
      st.active.push(hover ? 'hoverHold' : 'altitudeHold');
      st.targets.verticalSpeed = vsC;
      st.channels.collective = `${useRadar ? 'radar' : 'altitude'} hold ${this.heightRef.toFixed(1)} m (vs cmd ${vsC.toFixed(1)})`;
    } else {
      this.I.col = null; this.heightRef = null;
      st.channels.collective = 'pilot lever';
    }
    if (M.torqueLimit && s.engine) {
      // (V2) a collective cap that walks down while torque is over 98 % and back up slowly below 95 %
      // (H1's per-frame cut chattered against a held lever: 0.3 <-> 1.0 at 104 to 112 %)
      const tq = s.engine.torquePercent;
      if (this.tqCap == null) this.tqCap = 1;
      if (tq > 98) this.tqCap = Math.min(this.tqCap, s.controls.collective + 0.01) - clamp((tq - 98) * 0.006, 0, 0.08) * dt * 10;
      else if (tq < 95) this.tqCap += 0.15 * dt;
      this.tqCap = clamp(this.tqCap, 0, 1);
      if (out.collective > this.tqCap) {
        out.collective = this.tqCap;
        if (this.I.col != null) this.I.col = Math.min(this.I.col, out.collective);
        st.active.push('torqueLimit');
        st.channels.collective += ' | torque limit';
      }
    }
    st.output = { ...out };
    return out;
  }
}

export default FlightAssist;
