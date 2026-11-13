// The pump shotgun. It is held and carried like the rifle (see weapon.js), but it is pumped
// after every shot, fires a spread of pellets, and is reloaded one shell at a time through
// the loading port under the receiver.
//
// pump_shotgun.glb is glTF Y-up like the rifle: the barrel points along -Z, the top is +Y and
// the ejection port is on +X. The `pump` node slides back along +Z, with `grip_support` on it.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Weapon, Spring, handQuat, EYE_RELIEF, TRIGGER_ON } from './weapon.js';

const CAPACITY = 6;
const PELLETS = 8;
const PELLET_SPREAD = 0.028; // half angle of the pattern (rad)
const PUMP_TIME = 0.6; // s, the pump stroke after a shot (shotgun-pump)

// Hand poses in gun space.
const HAND = {
  // firing hand round the wrist of the stock, shouldered: the fingers run up and forward, along
  // the forearm as it rises to the stock, so the wrist stays straight (measured in the game,
  // review.js wristDeg: it was bent about 110 degrees, with the fingers run down the stock); 37
  // degrees up (pass 11; was 45), so the trigger finger needs less swing to lie along the receiver
  grip: handQuat(-1, 0, 0, 0, 0.6, -0.8),
  // carried, turned up about the palm so the wrist stays straight with the elbow down
  gripCarry: handQuat(-1, 0, 0, 0, 0.3, -0.95),
  pump: handQuat(0, 1, 0, 0.82, 0, -0.57), // palm up under the pump
};
// Carried (the clips' Gun track, the same as the rifle's), the hands sit for this gun's long,
// straight stock and pump (blender/rifle_motion/carry.py checks it on the posed body): the firing
// palm further round the wrist of the stock and its elbow out to the side, or the forearm would
// pass through the stock's toe; the support hand on the back of the pump, CARRY_SLIDE behind
// grip_support, where the arm reaches with the elbow bent. Its deeper stock is held CARRY_SHIFT
// (chest frame) from where the clips put the butt: a little lower, further in and further off the
// chest, clear of the upper arm.
const CARRY_PALM = new THREE.Vector3(0.04, 0.004, 0);
const CARRY_SHIFT = new THREE.Vector3(0.015, -0.01, 0.02);
const CARRY_POLE = new THREE.Vector3(-1, -0.3, -0.2);
const CARRY_SLIDE = 0.12;
// Shouldered, the support hand holds the pump 10 cm behind grip_support, where the arm reaches it
// (blender/rifle_motion/handling.py AimPose).
const AIM_SLIDE = 0.1;
// Shouldered, the firing palm from grip_main (gun frame): forward along the stock's wrist and down
// its side to the curve of its underside, so the trigger finger reaches the trigger (pass 11: at
// grip_main + (0.02, 0.004, 0) the index's knuckle sat 11.6 cm from it, now 7.6; the finger is 8.7
// cm long, 7.8 to the middle of its end pad). Carried it stays where it was (CARRY_PALM).
const AIM_PALM = new THREE.Vector3(0.02, -0.015, -0.035);


const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);

export class Shotgun extends Weapon {
  constructor() {
    super();
    this.pivot.name = 'shotgun_pivot';
    this.name = 'Shotgun';
    this.key = 'shotgun';
    this.capacity = CAPACITY;
    this.ammo = CAPACITY;
    this.recoil = 2.3;
    this.spread = PELLET_SPREAD;
    this.kick = new Spring(380, 26);
    this.climb = new Spring(300, 24);
    this.chamber = false; // the reload began empty, so it ends with a pump
    this.stop = false; // the trigger was pulled: stop after this shell
    this.port = new THREE.Vector3(); // loading port, in pivot space
    this.grip = { palm: AIM_PALM, hand: HAND.grip };
    // the trigger finger (weapon.js): along the receiver's side above the guard, or on the trigger
    this.finger = {
      rest: new THREE.Vector3(0.033, 0.072, -0.362),
      trigger: new THREE.Vector3(0.002, 0.022, -0.342),
      side: { x: 0.024, y: [0.029, 0.115], z: [-0.5, -0.3] },
    };
    this.gripCarry = { palm: CARRY_PALM, hand: HAND.gripCarry, pole: CARRY_POLE };
    this.carrySlide = CARRY_SLIDE;
    this.carryShift = CARRY_SHIFT;
    this.aimSlide = AIM_SLIDE;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      for (const key of ['map', 'normalMap', 'roughnessMap']) {
        if (o.material[key]) o.material[key].anisotropy = 8;
      }
    });
    const names = [
      'barrel', 'barrel_band', 'butt_pad', 'magazine_tube', 'pump', 'receiver', 'stock', 'trigger', 'trigger_guard',
      'muzzle_point', 'eject_point', 'grip_main', 'grip_support',
    ];
    this.nodes = {};
    for (const name of names) {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`pump_shotgun.glb has no node called "${name}"`);
      this.nodes[name] = node;
    }
    const n = this.nodes;

    // Measure while the gun is still at the origin. There are no sights to speak of: the eye
    // looks along the top of the barrel, as far in front of the butt as it does on the rifle.
    root.updateMatrixWorld(true);
    const pad = new THREE.Box3().setFromObject(n.butt_pad);
    const butt = new THREE.Vector3(0, THREE.MathUtils.lerp(pad.min.y, pad.max.y, 0.62), pad.max.z);
    const top = new THREE.Box3().setFromObject(n.barrel).max.y;
    this.eyeLocal.set(0, top + 0.012 - butt.y, -0.158);
    this.sightLocal.copy(this.eyeLocal);
    this.sightLocal.z -= EYE_RELIEF;
    this.boreLocal = n.muzzle_point.getWorldPosition(new THREE.Vector3()).sub(butt);
    this.finger.triggerBox = new THREE.Box3().setFromObject(n.trigger).translate(butt.clone().negate()); // (review.js)
    const receiver = new THREE.Box3().setFromObject(n.receiver);
    this.port.set(0, receiver.min.y, THREE.MathUtils.lerp(receiver.min.z, receiver.max.z, 0.45)).sub(butt);
    // the support hand holds the pump, anywhere along its back half
    n.grip_support.getWorldPosition(this.supportLocal).sub(butt);
    this.supportLocal.y -= 0.002;
    this.supportHand = HAND.pump;
    this.supportAim.copy(HAND.pump);
    this.supportLocalOffset.set(0, -0.002, 0);
    this.slideMax = 0.13;
    for (const name of ['stock', 'receiver', 'magazine_tube', 'pump', 'barrel']) {
      const node = n[name];
      const pieces = node.isMesh ? [node] : node.children.filter((child) => child.isMesh && !names.includes(child.name));
      for (const piece of pieces) this._addGuard(piece, butt, name === 'stock');
    }

    root.position.copy(butt).negate();
    this.pivot.add(root);
    this.pumpRest = n.pump.position.clone();
    this.triggerRest = n.trigger.quaternion.clone();

    // the shell being carried to the loading port
    this.shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0102, 0.0102, 0.06, 12).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xa3261c, metalness: 0.1, roughness: 0.5 }),
    );
    this.shell.visible = false;
    this.shell.castShadow = true;
    this.pivot.add(this.shell);
    return this;
  }

  startReload() {
    if (this.state !== 'ready' || this.ammo >= CAPACITY) return false;
    this.state = 'reloading';
    this.chamber = this.ammo === 0;
    this.stop = false;
    this.action = { clip: this.clips['reload-shotgun-start'], t: 0 };
    return true;
  }

  /**
   * ctx: as for the rifle (see Weapon.update). Call place() first.
   *
   * The reload is the clips reload-shotgun-start, -shell (once a shell) and -end (-end-pump from
   * empty), each beginning where the last one left the hands; the pump after a shot is
   * shotgun-pump. All of them say how far the pump is drawn back, frame by frame.
   */
  update(dt, ctx) {
    const n = this.nodes;
    this.cooldown -= dt;
    let fired = false;

    // ---- state ----
    // (the finger goes into the guard first and stays off the trigger while the gun is pumped or
    // reloaded)
    this._finger(dt, ctx, this.state !== 'ready');
    if (this.state === 'ready') {
      if (ctx.wantReload) this.startReload();
      else if (ctx.wantFire && this.cooldown <= 0) {
        if (this.ammo === 0) this.startReload(); // pulling the trigger on an empty gun reloads it
        else if (ctx.canFire && this.index >= TRIGGER_ON) fired = true;
      }
    } else if (this.state === 'reloading' && this.action.clip.name === 'reload-shotgun-shell' && ctx.wantFire && this.ammo > 0) {
      this.stop = true; // the trigger breaks off the reload after the shell in hand
    }
    const reloading = this.state === 'reloading';

    // ---- recoil ----
    if (fired) {
      this.ammo -= 1;
      this.cooldown = PUMP_TIME + 0.1;
      this.kick.v += 1.0;
      this.climb.v += 1.0;
      this.sway.v += (Math.random() - 0.5) * 0.7;
      this.triggerPull = 1;
      this.state = 'pumping';
      this.action = { clip: this.clips['shotgun-pump'], t: 0 };
    }
    this.kick.step(dt);
    this.climb.step(dt);
    this.sway.step(dt);
    this.triggerPull = Math.max(0, this.triggerPull - dt * 6);

    // ---- pose the gun: recoil on top of where it is held ----
    this.pivot.quaternion.copy(this.baseQuat).multiply(_q.setFromEuler(_e.set(this.climb.x, this.sway.x, 0, 'YXZ')));
    this.pivot.position.copy(this.basePos).add(_v.set(0, 0, this.kick.x).applyQuaternion(this.pivot.quaternion));
    this._qW.copy(this.pivot.quaternion);
    const act = this.action;
    const frame = act ? Math.min(act.clip.frames - 1, Math.round(act.t * 30)) : 0;
    const parts = act ? act.clip.track : null;
    n.pump.position.copy(this.pumpRest);
    if (parts && parts.pump) n.pump.position.z += parts.pump[frame];
    n.trigger.quaternion.copy(this.triggerRest).multiply(_q.setFromAxisAngle(X_AXIS, -0.3 * this.triggerPull));
    this.pivot.updateMatrixWorld(true);

    // ---- hands: the firing hand stays on the stock; the other on the pump, or where a reload
    // clip has it (the pump stroke only moves the pump, which the hand rides) ----
    const h = this.hands;
    this._firingHand();
    h.rCurl = 1;
    h.lElbow = h.rElbow = null;
    this._support(h);
    if (reloading && ctx.act && ctx.act.on) this._actionHands(ctx);
    this.fingerTargets(h);

    // ---- the shell lies across the fingers, then goes up into the port ----
    const seat = parts && parts.shell ? parts.shell[frame] : -1;
    this.shell.visible = seat >= 0 && reloading;
    if (this.shell.visible) {
      _v.set(0, -0.02, 0.016).applyQuaternion(h.lQuat).add(h.lPalm);
      _v.lerp(this.pivot.localToWorld(_v2.copy(this.port)), seat);
      this.shell.position.copy(this.pivot.worldToLocal(_v));
    }

    // ---- the clips' clocks, and what happens on the way ----
    if (act) {
      const before = act.t;
      const t = (act.t += dt);
      const at = act.clip.events;
      const crossed = (name) => at[name] !== undefined && before < at[name] && t >= at[name];
      if (crossed('pumpBack')) {
        n.eject_point.getWorldPosition(_v);
        n.eject_point.getWorldQuaternion(_q);
        ctx.fx.shell(_v, _v2.set(0, 0, -1).applyQuaternion(_q), this._qW, true);
        this.events.push('pumpBack');
        this.kick.v += 0.3; // the pump hits its stop at the back...
      }
      if (crossed('pumpForward')) {
        this.events.push('pumpForward');
        this.kick.v -= 0.35; // ...and slams home at the front
        this.climb.v -= 0.25;
      }
      if (crossed('shellIn')) {
        this.ammo += 1;
        this.events.push('shellIn');
        this.climb.v += 0.2; // the push shows on the gun
      }
      if (t >= act.clip.duration) this._next(t - act.clip.duration);
    }
    this.hands.rIndex = this.index;
    if (fired) this._shoot(ctx);
    return fired;
  }

  /** The clip that follows the one just ended, `over` s into it. */
  _next(over) {
    const name = this.action.clip.name;
    let next = null;
    if (name === 'reload-shotgun-start' || name === 'reload-shotgun-shell') {
      next = this.ammo >= CAPACITY || this.stop ? (this.chamber ? 'reload-shotgun-end-pump' : 'reload-shotgun-end') : 'reload-shotgun-shell';
    }
    if (next) this.action = { clip: this.clips[next], t: over };
    else {
      this.action = null;
      this.state = 'ready';
    }
  }

  /** One shot is a pattern of pellets around the point under the crosshair. */
  _shoot(ctx) {
    const n = this.nodes;
    n.muzzle_point.getWorldPosition(_v);
    n.muzzle_point.getWorldQuaternion(_q);
    _v2.set(0, 0, -1).applyQuaternion(_q);
    if (ctx.aimPoint) {
      _s.subVectors(ctx.aimPoint, _v);
      const range = _s.length();
      if (range > 1.2 && _s.dot(_v2) > range * 0.5) _v2.copy(_s).divideScalar(range);
    }
    const spread = ctx.spread || PELLET_SPREAD;
    for (let i = 0; i < PELLETS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spread;
      _s.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0).applyQuaternion(_q).add(_v2).normalize();
      ctx.fx.shot(_v, _s);
    }
    ctx.fx.flash();
  }
}
