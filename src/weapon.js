// Loads ar_rifle.glb and drives it: where it is carried or shouldered, firing, recoil, and a
// reload that moves the real `magazine` and `charging_handle` nodes. It also works out where
// both hands should be.
//
// The GLB is glTF Y-up, so in three.js the barrel points along -Z, the top is +Y and the
// ejection port is on +X. The magazine leaves the well along its local -Y.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PALM_LOCAL, ELBOW_POLE } from './character.js';

export const MAG_SIZE = 30;
export const EYE_RELIEF = 0.085; // centre of the eyeball to the rear sight (m)
const ROUNDS_PER_MINUTE = 700;
// how far the trigger finger must be into the guard for a shot to go (Weapon._finger: the second
// frame at 60 fps after the trigger is pulled)
export const TRIGGER_ON = 0.75;
const MAG_TRAVEL = 0.09; // how far the magazine slides before it is clear of the well (m)

// Where the palm presses on the magazine, in magazine space: half way down its left face (the
// reload clips carry it there: blender/rifle_motion/handling.py MAG_PALM).
const MAG_PALM = new THREE.Vector3(-0.0165, -0.062, -0.011);

// Carried, the gun is where the clips hold it: the Gun track authored in Blender with the low
// and high ready and the sprint's carry (blender/rifle_motion/carry.py), which the character
// blends with its clips and hands over in the chest joint's frame (f.gunPos, f.gunQuat). One hold
// is still a rule, from the shoulder pocket: in first person the gun is kept in sight. Angles are
// in the chest's frame (yaw + = muzzle to the shooter's left, pitch + = muzzle down, roll + = top
// of the rifle towards the shooter's right); `drop` moves the butt down from its place in the
// shoulder, `out` forward.
const VIEW_CARRY = { yaw: 0.07, pitch: 0.04, roll: -0.04, drop: 0.05, out: 0.02 };
// Carried, the support hand holds the handguard this far behind grip_support (m), where that arm
// reaches with its elbow bent (blender/rifle_motion/carry.py); the handguard's back end is 13 cm
// behind grip_support and the front of the magazine well 10, so the hand may come back along it
// to SLIDE_MAX to stay in reach.
const CARRY_SLIDE = 0.06;
const SLIDE_MAX = 0.08;



/**
 * World rotation of a hand whose palm faces `p` and whose fingers run along `f` before they
 * curl. It matches the character's hand bones, which at rest have fingers along -Y and the
 * palm facing +Z.
 */
export function handQuat(px, py, pz, fx, fy, fz) {
  const p = new THREE.Vector3(px, py, pz).normalize();
  const f = new THREE.Vector3(fx, fy, fz);
  f.addScaledVector(p, -f.dot(p)).normalize();
  const x = new THREE.Vector3().crossVectors(p, f);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, f.negate(), p));
}

// Hand poses in rifle space.
const HAND = {
  // Firing hand: palm on the right of the pistol grip, turned about the palm so that the wrist
  // stays straight, carried with the elbow down at the ribs and shouldered alike
  // (blender/rifle_motion/carry.py measures it carried, review.js wristDeg shouldered: with the
  // fingers run square across the grip the shouldered wrist was bent 60 to 70 degrees towards the
  // little finger)
  grip: handQuat(-1, 0, 0, 0, 0.35, -0.94),
  support: handQuat(0, 1, 0, 0.82, 0, -0.57), // palm up under the handguard
  mag: handQuat(1, 0, 0, 0, 0.35, -0.94), // palm on the magazine's left face (as the reload clips hold it)
};
const MAG_HAND_INVERSE = HAND.mag.clone().invert();

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const _box = new THREE.Box3();
const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _clipPos = new THREE.Vector3();
const _clipQuat = new THREE.Quaternion();
const _delta = new THREE.Quaternion();
const _keep = { lPalm: new THREE.Vector3(), lQuat: new THREE.Quaternion(), rPalm: new THREE.Vector3(), rQuat: new THREE.Quaternion() };

/**
 * The hands as a handling clip has them (Character.act): a hand on a gun stays on that gun as it
 * really is (recoil, a gun eased in from the gait clips' hold), and a hand on its way between
 * holds moves with the gun in the hands the same way. `guns` maps the clip's hold codes (1 the Gun track's gun, 2 GunIn's) to
 * { weapon, pos, quat }: that weapon and where the clip has its butt (chest frame, track terms).
 * Fills `out` like Weapon.hands, with the clip's elbows (rElbow / lElbow, world).
 */
export function handsFromAction(act, chestPos, chestQuat, guns, out) {
  const sample = act.sample;
  for (let k = 0; k < 2; k++) {
    const palm = k ? out.rPalm : out.lPalm;
    const quat = k ? out.rQuat : out.lQuat;
    palm.copy(act.palm[k]);
    quat.copy(act.hand[k]);
    // (a hand between holds goes with the gun in the hands, so it arrives where that gun is)
    const held = guns[sample.hold[k]] || guns[1];
    if (held) {
      // the clip's gun in the world, and the real one: the hand goes with the difference
      _clipPos.copy(held.pos).add(held.weapon.carryShift).applyQuaternion(chestQuat).add(chestPos);
      _clipQuat.copy(chestQuat).multiply(held.quat);
      const pivot = held.weapon.pivot;
      _delta.copy(pivot.quaternion).multiply(_clipQuat.invert());
      palm.sub(_clipPos).applyQuaternion(_delta).add(pivot.position);
      quat.premultiply(_delta);
    }
    if (k) out.rCurl = sample.curl[1];
    else out.lCurl = sample.curl[0];
  }
  out.rIndex = 0;
  out.lElbow = act.elbow[0];
  out.rElbow = act.elbow[1];
  return out;
}

export class Spring {
  constructor(stiffness, damping) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  step(dt) {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
}


export class Weapon {
  constructor() {
    // The pivot's origin is the middle of the butt pad, so the rifle swings about the shoulder.
    this.pivot = new THREE.Group();
    this.pivot.name = 'weapon_pivot';
    this.name = 'Rifle';
    this.key = 'rifle'; // as the handling clips name it
    this.capacity = MAG_SIZE;
    this.recoil = 1; // how hard a shot jolts the view
    this.spread = 0; // extra half angle of the cone of fire (rad)
    this.ammo = MAG_SIZE;
    this.state = 'ready'; // 'ready' | 'reloading'
    // the handling clip the gun is playing (the reload; the shotgun's pump too): { clip, t }, its
    // clips by name (Motion.actions, set by main.js)
    this.action = null;
    this.clips = null;
    this.cooldown = 0;
    this.triggerPull = 0;
    this.kick = new Spring(520, 30); // straight back into the shoulder (m)
    this.climb = new Spring(420, 30); // muzzle rise (rad)
    this.sway = new Spring(300, 24); // sideways twitch (rad)
    // Per hand: where the middle of the palm goes, the hand's world rotation, finger closure.
    this.hands = {
      rPalm: new THREE.Vector3(),
      rQuat: new THREE.Quaternion(),
      rCurl: 1,
      lPalm: new THREE.Vector3(),
      lQuat: new THREE.Quaternion(),
      lCurl: 1,
    };
    this._qW = new THREE.Quaternion();
    this._qCarry = new THREE.Quaternion();
    this.eyeLocal = new THREE.Vector3(); // shooter's eye behind the rear sight, in pivot space
    this.sightLocal = new THREE.Vector3(); // rear sight aperture, in pivot space
    this.events = []; // moments in the handling since the last frame, for sound: 'magOut', ...
    this.index = 0; // 1 = finger on the trigger, 0 = straight along the gun
    this.hands.rIndex = 0;
    this.gripSlide = 0; // the support hand further down the handguard (m)
    // Keeping the support hand on the gun: where it holds (pivot space), how the hand is turned
    // there, how far back along the gun it may slide to stay in reach, and what that took.
    this.supportLocal = new THREE.Vector3();
    this.supportHand = HAND.support;
    this.supportAim = new THREE.Quaternion().copy(HAND.support); // shouldered (the aiming poses': place())
    this.supportLocalOffset = new THREE.Vector3(0, 0.004, 0); // the palm from grip_support (z: the slide)
    this.aimSlide = 0; // shouldered, how far back along the handguard the support hand holds (m)
    this.slideMax = SLIDE_MAX; // (counted from grip_support, the carried slide included)
    this.reachSlide = 0; // m the hand has come back along the gun
    this.reachTurn = 0; // rad the gun was swung towards the support shoulder
    this.guard = []; // points on the rifle that must stay out of the body, in pivot space
    this.push = 0; // how far the rifle is being held off the body (m)
    this._guardWorld = [];
    this._pushDir = new THREE.Vector3();
    // inertia: the gun trails behind sudden moves and turns, then settles
    this._lag = new THREE.Vector3(); // rotation, rad about the gun's own axes
    this._lagV = new THREE.Vector3();
    this._spin = new THREE.Vector3(); // how fast the hold is turning, smoothed
    this._drift = new THREE.Vector3(); // position, world
    this._driftV = new THREE.Vector3();
    this._speed = new THREE.Vector3(); // how fast the hold is moving, smoothed
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._prevSpeed = new THREE.Vector3();
    this._settled = false;
    this._carryPos = new THREE.Vector3();
    this._carryQuat = new THREE.Quaternion();
    this._clipPos = new THREE.Vector3();
    this._clipQuat = new THREE.Quaternion();
    this.basePos = new THREE.Vector3(); // where the butt is before recoil, world
    this.baseQuat = new THREE.Quaternion(); // where the rifle points before recoil, world
    this.aimShare = 0; // how far up to the shoulder it is, eased (place() sets it)
    // The firing hand, aimed and carried: palm from grip_main (gun frame), the hand's turn on
    // the gun, and where its elbow points (chest frame). carrySlide: how far back along the
    // handguard the support hand holds when carried (m). The rifle is the gun the clips' hold
    // was authored for; another gun may adjust it (shotgun.js).
    // (shouldered, the palm 1.6 cm further forward and 1 cm higher on the grip than carried, as high
    // as the web of the hand goes, so the trigger finger reaches the trigger: pass 11, its knuckle
    // 9.3 -> 7.6 cm from it)
    this.grip = { palm: new THREE.Vector3(0.016, 0.01, -0.012), hand: HAND.grip };
    this.gripCarry = { palm: new THREE.Vector3(0.016, 0, 0.004), hand: HAND.grip, pole: ELBOW_POLE.right };
    this.carrySlide = CARRY_SLIDE;
    this.carryShift = new THREE.Vector3(); // the butt moved from where the clips hold it (chest frame)
    this.hands.rPole = new THREE.Vector3().copy(ELBOW_POLE.right);
    // the support elbow, carried and shouldered (chest frame; per body: fitBody)
    this.hands.lPole = new THREE.Vector3().copy(ELBOW_POLE.left);
    this.carryLPole = new THREE.Vector3().copy(ELBOW_POLE.left);
    this.aimLPole = new THREE.Vector3().copy(ELBOW_POLE.left);
    // The trigger finger, on the gun itself (pivot space; character.js _index): `rest` is where its
    // tip lies, straight along the side of the lower receiver above the trigger guard; `trigger`
    // where the middle of its end pad presses, the front face of the trigger blade. `side` is the
    // receiver's side the finger rests on (x of the surface, the y and z it spans), for the review.
    this.finger = {
      rest: new THREE.Vector3(0.023, -0.025, -0.35),
      trigger: new THREE.Vector3(0.002, -0.05, -0.336),
      side: { x: 0.015, y: [-0.04, 0.01], z: [-0.42, -0.26] },
    };
    this._gripPalm = new THREE.Vector3(); // where the firing palm holds the grip this frame (world)
    this.hands.rOn = 1;
    this.hands.rRest = new THREE.Vector3();
    this.hands.rTrig = new THREE.Vector3();
  }

  /**
   * The body's own numbers for this gun (its table, public/characters/<body>.game.json `guns`): how
   * far back along the handguard or pump the support hand holds carried and may slide to stay in
   * reach, and where its elbow points carried and shouldered, as the clips were authored for it.
   */
  fitBody(table) {
    const g = table && table.guns && table.guns[this.key];
    if (!g) return;
    this.carrySlide = g.carrySlide;
    if (g.slideMax) this.slideMax = g.slideMax;
    if (g.supportPole) this.carryLPole.fromArray(g.supportPole);
    if (table.aimSupportPole) this.aimLPole.fromArray(table.aimSupportPole);
  }

  /**
   * The trigger finger's targets in the world for the hand `h` (this gun's hands, or a swap's): on
   * as much as its palm is on this gun's firing grip (rOn: 1 within 2 cm of it, 0 from 5 cm), so a
   * hand that lets go of the grip (the swap) takes the clip's fingers.
   */
  fingerTargets(h) {
    const d = h.rPalm.distanceTo(this._gripPalm);
    h.rOn = 1 - THREE.MathUtils.smoothstep(d, 0.02, 0.05);
    h.rGun = this; // (whose grip: review.js)
    if (!h.rRest) h.rRest = new THREE.Vector3();
    if (!h.rTrig) h.rTrig = new THREE.Vector3();
    this.pivot.localToWorld(h.rRest.copy(this.finger.rest));
    this.pivot.localToWorld(h.rTrig.copy(this.finger.trigger));
    return h;
  }

  /**
   * Decides where the rifle is before recoil and the reload move it.
   *
   * Carried, it is where the clips hold it (gunPos / gunQuat: the low or high ready or the
   * sprint's carry, riding the chest). Shouldered, its butt is in the shoulder pocket and it
   * points along `aimQuat`; the shooter's head comes down to the sights.
   *
   * f: { dt, chestPos, chestQuat, gunPos, gunQuat, pocket, aimQuat, aim, sprint, firstPerson,
   *      clear, held, life, fidget, sway }
   *    gunPos, gunQuat: the carried gun's butt and turn in the chest joint's frame (character.js).
   *    reach is { left, right, arm }: the shoulder joints (world) and the length of an arm.
   *    fidget is the way the gun happens to be carried just now, as small offsets on the clips'
   *    hold, and sway the wobble of a gun held on aim (both from alive.js); life is the body's
   *    footfall motion.
   *    pocket is the shoulder pocket read off the body (first person), aimPocket where the aiming
   *    poses put the butt (chest frame, track terms) and aimSupport how they turn the support hand
   *    on the gun.
   *    slung: the gun is not in the hands but where gunPos / gunQuat say (track terms, chest
   *    frame), nothing added: slung across the back, or carried by a handling clip that moves it
   *    between the hands and the back (the swap).
   *    acting: 0..1, how far a handling clip has the gun (gunPos / gunQuat follow its Gun track):
   *    what it was checked for in Blender is not added to, so the fidget, the clearance push, the
   *    inertia and the swing towards the support hand fade out under it.
   *    aim and sprint are 0..1 (sprinting, the fidgets are let go).
   *    clear(points, count, dir, margin) says how far the rifle has to move along `dir` to be
   *    out of the shooter's body and clothes.
   */
  place(f) {
    if (f.slung) {
      this.basePos.copy(f.gunPos).add(this.carryShift).applyQuaternion(f.chestQuat).add(f.chestPos);
      this.baseQuat.copy(f.chestQuat).multiply(f.gunQuat);
      this.aimShare = 0;
      this.push = this.reachSlide = this.reachTurn = 0;
      this._settled = false;
      return;
    }
    const fid = f.fidget;
    // how much of the fidget shows (none while a handling clip has the gun)
    const free = 1 - (f.acting || 0);
    const loose = fid ? (1 - f.sprint) * (f.firstPerson ? 0.3 : 1) * free : 0;
    const a = f.aim * f.aim * (3 - 2 * f.aim);
    this.aimShare = a;
    this.gripSlide = (this.carrySlide + (fid ? fid.slide * loose : 0)) * (1 - f.aim) + this.aimSlide * f.aim;
    if (f.aimSupport) this.supportAim.copy(f.aimSupport);

    // carried: the clips' hold, with the fidget's offsets about the butt, in the chest's frame
    // (first person: kept in sight instead)
    const pos = this._carryPos;
    const quat = this._carryQuat;
    if (f.firstPerson) this._view(f, pos, quat);
    else {
      pos.copy(f.gunPos).add(this.carryShift);
      quat.copy(f.gunQuat);
      if (fid) {
        pos.y -= fid.drop * loose;
        quat.premultiply(_q.setFromEuler(_e.set(fid.pitch * loose, fid.yaw * loose, fid.roll * loose, 'YXZ')));
      }
      pos.applyQuaternion(f.chestQuat).add(f.chestPos);
      quat.premultiply(f.chestQuat);
    }
    // (the clips' own hold, which Blender has checked against the posed body: see below)
    this._clipPos.copy(f.gunPos).add(this.carryShift).applyQuaternion(f.chestQuat).add(f.chestPos);
    this._clipQuat.copy(f.chestQuat).multiply(f.gunQuat);
    // shouldered: the butt where the aiming poses put it (the shoulder pocket)
    _v2.copy(f.aimPocket).add(this.carryShift).applyQuaternion(f.chestQuat).add(f.chestPos);
    this.basePos.lerpVectors(pos, _v2, a);
    this.baseQuat.slerpQuaternions(quat, f.aimQuat, a);
    // the firing elbow goes from where the carry wants it to where the aim does
    this.hands.rPole.lerpVectors(this.gripCarry.pole, ELBOW_POLE.right, a);
    this.hands.lPole.lerpVectors(this.carryLPole, this.aimLPole, a);

    // Keep it out of the clothes: carried, it is held further off the chest; shouldered, it
    // slides forward along its own length. The butt may press a little way into the shoulder.
    // This is a safety net. The test is coarse (the corners of each part's box against a height
    // field of the body at rest), so carried it only answers for what has moved the gun from the
    // clips' own hold, which was checked against the posed, skinned body when it was authored
    // (blender/rifle_motion/review.py): the fidgets, the gun's inertia, the body's own run-time
    // layers. Carried as the clips hold it, it pushes nothing.
    if (f.clear && free > 0) {
      const dir = this._pushDir;
      dir.set(0, 0, 1).applyQuaternion(f.chestQuat).multiplyScalar(1 - a);
      dir.addScaledVector(_v.set(0, 0, -1).applyQuaternion(f.aimQuat), a).normalize();
      const margin = THREE.MathUtils.lerp(0.006, 0, a);
      const trust = (1 - a) * (f.firstPerson ? 0 : 1);
      let base = 0;
      if (trust > 0) {
        for (let i = 0; i < this.guard.length; i++) {
          this._guardWorld[i].copy(this.guard[i]).applyQuaternion(this._clipQuat).add(this._clipPos);
        }
        base = f.clear(this._guardWorld, this.guard.length, dir, margin) * trust;
      }
      for (let i = 0; i < this.guard.length; i++) {
        this._guardWorld[i].copy(this.guard[i]).applyQuaternion(this.baseQuat).add(this.basePos);
      }
      const need = Math.max(0, f.clear(this._guardWorld, this.guard.length, dir, margin) - base) * free;
      // out at once, back slowly, so the rifle does not pump with every step
      if (need > this.push) this.push += (need - this.push) * (1 - Math.exp(-12 * f.dt));
      else this.push = Math.max(need, this.push - 0.05 * f.dt);
      this.basePos.addScaledVector(dir, this.push);
    } else this.push = 0;

    // Shouldered, the gun shows a little of every footfall (carried, it rides on the chest,
    // which already does).
    if (f.life) {
      const sway = f.sway;
      _e.set((f.life.nod * 0.5 + (sway ? sway.pitch : 0)) * a, (f.life.yaw * 0.45 + (sway ? sway.yaw : 0)) * a, f.life.roll * 0.6 * a, 'YXZ');
      this.baseQuat.multiply(_q.setFromEuler(_e));
    }

    // ---- inertia ----
    // The hold above is where the hands want the gun. The gun itself follows on springs: it
    // trails a turn, hangs back when the body starts or stops, and overshoots a little when
    // it is snapped up to the shoulder before it settles.
    const dt = f.dt;
    if (this._settled && dt > 0) {
      _q.copy(this._prevQuat).invert().multiply(this.baseQuat); // how the hold turned this frame
      const sign = _q.w < 0 ? -2 : 2;
      _v.set(_q.x, _q.y, _q.z).multiplyScalar(sign / dt).clampLength(0, 12);
      this._spin.lerp(_v, 1 - Math.exp(-28 * dt));
      _v.copy(this._spin).multiplyScalar(-THREE.MathUtils.lerp(0.03, 0.012, a)).clampLength(0, 0.1); // trail the turn
      this._lagV.addScaledVector(_v.sub(this._lag), 420 * dt).multiplyScalar(Math.exp(-15 * dt));
      this._lag.addScaledVector(this._lagV, dt).clampLength(0, 0.14);

      _v.subVectors(this.basePos, this._prevPos).divideScalar(dt).clampLength(0, 12);
      this._speed.lerp(_v, 1 - Math.exp(-28 * dt));
      _v.subVectors(this._speed, this._prevSpeed).divideScalar(dt).clampLength(0, 45); // acceleration
      this._driftV.addScaledVector(this._drift, -520 * dt).addScaledVector(_v, -0.8 * dt).multiplyScalar(Math.exp(-17 * dt));
      this._drift.addScaledVector(this._driftV, dt).clampLength(0, 0.035);
      this._prevSpeed.copy(this._speed);
    } else {
      this._lag.set(0, 0, 0);
      this._lagV.set(0, 0, 0);
      this._drift.set(0, 0, 0);
      this._driftV.set(0, 0, 0);
      this._spin.set(0, 0, 0);
      this._speed.set(0, 0, 0);
      this._prevSpeed.set(0, 0, 0);
    }
    this._settled = true;
    this._prevPos.copy(this.basePos);
    this._prevQuat.copy(this.baseQuat);
    // (a handling clip's gun moves as it was authored: the inertia fades out under it)
    this.baseQuat.multiply(_q.setFromEuler(_e.set(this._lag.x * free, this._lag.y * free, this._lag.z * free, 'YXZ')));
    this.basePos.addScaledVector(this._drift, free);
    this._keepInReach(f, a, free);
  }

  /**
   * First person, world: from the shoulder pocket (VIEW_CARRY), the gun turned with the chest but
   * taking only half of its lean, so it does not nod with every stride.
   */
  _view(f, pos, quat) {
    const c = VIEW_CARRY;
    _e.set(c.pitch, c.yaw, c.roll, 'YXZ');
    quat.setFromEuler(_e).multiply(HALF_TURN);
    _v.set(0, 0, 1).applyQuaternion(f.chestQuat);
    quat.premultiply(_q.setFromAxisAngle(UP, Math.atan2(_v.x, _v.z)).slerp(f.chestQuat, 0.5));
    pos.copy(f.pocket);
    pos.y -= c.drop;
    pos.z += c.out;
    pos.applyQuaternion(f.chestQuat).add(f.chestPos);
  }

  /**
   * Keeps the support hand on the gun. A hold is no use if the arm cannot reach it: swing the
   * gun about its butt towards the support shoulder until it can (carried only: on aim it has
   * to stay on the target), then let the hand come back along the gun if need be. This runs
   * last, so that whatever the fidgets and the gun's inertia did, the hand still reaches.
   */
  _keepInReach(f, a, free) {
    this.reachSlide = 0;
    this.reachTurn = 0;
    if (f.reach && free > 0) {
      const limit = f.reach.arm * 0.955;
      const wrist = (slide) => {
        _q.copy(this.baseQuat).multiply(this.supportHand);
        _v.copy(this.supportLocal);
        _v.z += this.gripSlide + slide;
        return _v.applyQuaternion(this.baseQuat).add(this.basePos).sub(_v2.copy(PALM_LOCAL).applyQuaternion(_q));
      };
      const room = Math.max(0, this.slideMax - this.gripSlide); // what is left of the handguard or pump
      for (let pass = 0; pass < 3 && a < 0.999; pass++) {
        const dist = wrist(room).distanceTo(f.reach.left);
        if (dist <= limit) break;
        _s.subVectors(_v, f.reach.left).multiplyScalar(limit / dist).add(f.reach.left).sub(this.basePos).normalize();
        _v.sub(this.basePos).normalize();
        _q.setFromUnitVectors(_v, _s);
        _q2.set(0, 0, 0, 1).slerp(_q, (1 - a) * free);
        this.reachTurn += 2 * Math.acos(Math.min(1, Math.abs(_q2.w)));
        this.baseQuat.premultiply(_q2);
      }
      // (in steps, and the last one all the way back: the turn above aimed for that)
      for (let slide = 0; ; slide = Math.min(room, slide + 0.015)) {
        this.reachSlide = slide;
        if (slide >= room || wrist(slide).distanceTo(f.reach.left) <= limit) break;
      }
    }
  }

  /** Records the corners of one part, so that place() can keep them out of the body. */
  _addGuard(piece, butt, trimRear) {
    piece.geometry.computeBoundingBox();
    const box = _box.copy(piece.geometry.boundingBox);
    if (trimRear) box.max.z = THREE.MathUtils.lerp(box.min.z, box.max.z, 0.55);
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      this.guard.push(corner.applyMatrix4(piece.matrixWorld).sub(butt));
      this._guardWorld.push(new THREE.Vector3());
    }
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
      'receiver', 'barrel', 'handguard', 'stock', 'pistol_grip', 'magazine', 'trigger', 'charging_handle',
      'ejection_cover', 'front_sight', 'rear_sight', 'muzzle_point', 'eject_point', 'grip_main', 'grip_support',
    ];
    this.nodes = {};
    for (const name of names) {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`ar_rifle.glb has no node called "${name}"`);
      this.nodes[name] = node;
    }

    // Measure the butt pad and the rear sight while the rifle is still at the origin.
    root.updateMatrixWorld(true);
    const stock = new THREE.Box3().setFromObject(this.nodes.stock);
    const butt = new THREE.Vector3(0, THREE.MathUtils.lerp(stock.min.y, stock.max.y, 0.62), stock.max.z);
    const sight = new THREE.Box3().setFromObject(this.nodes.rear_sight);
    this.sightLocal.set(0, sight.max.y - 0.012, sight.max.z).sub(butt);
    this.nodes.grip_support.getWorldPosition(this.supportLocal).sub(butt);
    this.supportLocal.y += 0.004;
    this.eyeLocal.copy(this.sightLocal).add(_v.set(0, 0, EYE_RELIEF));
    this.boreLocal = this.nodes.muzzle_point.getWorldPosition(new THREE.Vector3()).sub(butt);
    this.finger.triggerBox = new THREE.Box3().setFromObject(this.nodes.trigger).translate(butt.clone().negate()); // (review.js)

    // Corners of the parts that sit against the body or swing past the legs.
    // A part made of two materials loads as a group of unnamed pieces. The butt pad itself is
    // left out: it is meant to press into the shoulder.
    for (const name of ['stock', 'receiver', 'pistol_grip', 'magazine', 'handguard', 'barrel']) {
      const node = this.nodes[name];
      const pieces = node.isMesh ? [node] : node.children.filter((child) => child.isMesh && !names.includes(child.name));
      for (const piece of pieces) this._addGuard(piece, butt, name === 'stock');
    }

    root.position.copy(butt).negate();
    this.pivot.add(root);

    const n = this.nodes;
    this.seat = n.magazine.position.clone();
    this.seatQuat = n.magazine.quaternion.clone();
    this.handleRest = n.charging_handle.position.clone();
    this.triggerRest = n.trigger.quaternion.clone();
    return this;
  }

  get status() {
    if (this.state === 'reloading') return 'reloading';
    return this.ammo === 0 ? 'empty' : 'ready';
  }

  startReload() {
    if (this.state !== 'ready') return false;
    this.state = 'reloading';
    // from empty the reload ends with a pull of the charging handle (motion.js actions)
    this.action = { clip: this.clips[this.ammo === 0 ? 'reload-rifle-empty' : 'reload-rifle-tac'], t: 0 };
    return true;
  }

  /**
   * ctx: { rootQuat, wantFire, canFire, wantReload, aimPoint, spread, fx, act, chestPos, chestQuat }
   * Call place() first. aimPoint is what the shooter is looking at (world); rootQuat is the way
   * the shooter faces; canFire is false while the rifle is not yet up; spread is the half angle of
   * the cone of fire (rad). act is the character's handling clip as it posed the body this frame
   * (Character.act), the one this gun asked for (this.action); chestPos / chestQuat the chest joint.
   */
  update(dt, ctx) {
    const n = this.nodes;
    this.cooldown -= dt;
    let fired = false;

    // ---- state ----
    // (the finger goes into the guard first: the shot waits until it is on the trigger)
    this._finger(dt, ctx, this.state !== 'ready');
    if (this.state === 'ready') {
      if (ctx.wantReload) this.startReload(); // allowed with a full magazine too, so the reload can always be watched
      else if (ctx.wantFire && this.cooldown <= 0) {
        if (this.ammo === 0) this.startReload(); // pulling the trigger on an empty rifle reloads it
        else if (ctx.canFire && this.index >= TRIGGER_ON) fired = true;
      }
    }
    const reloading = this.state === 'reloading';

    // ---- recoil ----
    if (fired) {
      this.ammo -= 1;
      // Carry the overshoot so the rate of fire does not depend on the frame rate.
      this.cooldown = Math.max(this.cooldown, -dt) + 60 / ROUNDS_PER_MINUTE;
      this.kick.v += 0.55;
      this.climb.v += 0.32;
      this.sway.v += (Math.random() - 0.5) * 0.4;
      this.triggerPull = 1;
    }
    this.kick.step(dt);
    this.climb.step(dt);
    this.sway.step(dt);
    this.triggerPull = ctx.wantFire && ctx.canFire && this.ammo > 0 && !reloading ? 1 : Math.max(0, this.triggerPull - dt * 9);

    // ---- pose the rifle: recoil on top of where it is held ----
    this.pivot.quaternion.copy(this.baseQuat).multiply(_q.setFromEuler(_e.set(this.climb.x, this.sway.x, 0, 'YXZ')));
    this.pivot.position.copy(this.basePos).add(_v.set(0, 0, this.kick.x).applyQuaternion(this.pivot.quaternion));
    this._qW.copy(this.pivot.quaternion);

    // ---- the reload, where its clip has the magazine and the charging handle ----
    const act = reloading && ctx.act && ctx.act.on ? this.action : null;
    const parts = act ? act.clip.track : null;
    const frame = act ? Math.min(act.clip.frames - 1, Math.round(act.t * 30)) : 0;
    const mag = parts ? parts.mag[frame] : ['w', 0];
    n.magazine.position.copy(this.seat);
    if (Array.isArray(mag)) n.magazine.position.y -= mag[1];
    n.magazine.quaternion.copy(this.seatQuat);
    n.magazine.visible = mag !== 'x';
    n.charging_handle.position.copy(this.handleRest);
    if (parts && parts.handle) n.charging_handle.position.z += parts.handle[frame];
    n.trigger.quaternion.copy(this.triggerRest).multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), -0.3 * this.triggerPull));
    this.pivot.updateMatrixWorld(true);

    // ---- hands: on the gun, or where the reload clip has them ----
    const h = this.hands;
    this._firingHand();
    h.rCurl = 1;
    h.lElbow = h.rElbow = null;
    this._support(h);
    if (act) this._actionHands(ctx);
    this.fingerTargets(h);

    // ---- a magazine in the hand is carried rigidly by the hand ----
    if (mag === 'h') {
      this._qCarry.copy(h.lQuat).multiply(MAG_HAND_INVERSE);
      _v2.copy(h.lPalm).sub(_v.copy(MAG_PALM).applyQuaternion(this._qCarry));
      _m.compose(_v2, this._qCarry, ONE);
      _m.premultiply(_inv.copy(n.receiver.matrixWorld).invert());
      _m.decompose(n.magazine.position, n.magazine.quaternion, _s);
      n.magazine.updateMatrixWorld(true);
    }

    // ---- the reload's clock, and what happens on the way ----
    if (reloading) {
      const clip = this.action.clip;
      const before = this.action.t;
      const t = (this.action.t += dt);
      const at = clip.events;
      const crossed = (name) => at[name] !== undefined && before < at[name] && t >= at[name];
      if (crossed('magOut')) {
        this.sway.v += 0.5; // the tug as the magazine comes out
        this.events.push('magOut');
      }
      if (crossed('magFree')) {
        this._dropMagazine(ctx);
        this.climb.v -= 0.35;
      }
      if (crossed('magIn')) {
        this.ammo = MAG_SIZE;
        this.climb.v += 0.3; // the push shows on the rifle
        this.events.push('magIn');
      }
      if (crossed('boltBack')) this.events.push('boltBack');
      if (crossed('boltForward')) {
        this.events.push('boltForward');
        this.kick.v -= 0.25;
      }
      if (t >= clip.duration) {
        this.state = 'ready';
        this.action = null;
      }
    }

    this.hands.rIndex = this.index;
    if (fired) this._shoot(ctx);
    return fired;
  }

  /**
   * The hands where the handling clip has them, eased from where the carry has them as the clip's
   * gun is eased in (ctx.actWeight) and back as it is eased out.
   */
  _actionHands(ctx) {
    const h = this.hands;
    const w = ctx.actWeight;
    _keep.lPalm.copy(h.lPalm);
    _keep.lQuat.copy(h.lQuat);
    _keep.rPalm.copy(h.rPalm);
    _keep.rQuat.copy(h.rQuat);
    const s = ctx.act.sample;
    handsFromAction(ctx.act, ctx.chestPos, ctx.chestQuat, { 1: { weapon: this, pos: s.pose.gun, quat: s.gunQuat } }, h);
    if (w < 1) {
      h.lPalm.lerpVectors(_keep.lPalm, h.lPalm, w);
      h.lQuat.slerpQuaternions(_keep.lQuat, h.lQuat, w);
      h.rPalm.lerpVectors(_keep.rPalm, h.rPalm, w);
      h.rQuat.slerpQuaternions(_keep.rQuat, h.rQuat, w);
      h.lCurl += (1 - h.lCurl) * (1 - w);
      h.rCurl += (1 - h.rCurl) * (1 - w);
    }
  }

  /** The firing hand on grip_main: carried and aimed holds, eased by how far up the gun is. */
  _firingHand() {
    const h = this.hands;
    const a = this.aimShare;
    _v.lerpVectors(this.gripCarry.palm, this.grip.palm, a).applyQuaternion(this._qW);
    this.nodes.grip_main.getWorldPosition(h.rPalm).add(_v);
    h.rQuat.copy(this._qW).multiply(_q.slerpQuaternions(this.gripCarry.hand, this.grip.hand, a));
    this._gripPalm.copy(h.rPalm);
  }

  /**
   * Trigger discipline: the finger only goes onto the trigger to fire (quickly: about 2 frames to
   * TRIGGER_ON, when the shot may go), and comes off it, more slowly, when the trigger is let go
   * or the hands are busy (reload, the shotgun's pump).
   */
  _finger(dt, ctx, busy) {
    const on = !busy && (ctx.wantFire || this.triggerPull > 0.05) ? 1 : 0;
    this.index += (on - this.index) * (1 - Math.exp(-(on ? 45 : 14) * dt));
    this.hands.rIndex = this.index;
  }

  /** The hold is re-seated: a small dip and a shrug of the gun back into the shoulder. */
  settle() {
    this.climb.v -= 0.4;
    this.kick.v += 0.14;
    this.sway.v += (Math.random() - 0.5) * 0.5;
  }

  /**
   * The support hand on the handguard (or pump: shotgun.js), as far back along it as the carry and
   * the reach have it, turned as the carry has it, or shouldered as the aiming poses have it.
   */
  _support(h) {
    const q = this._qW;
    h.lQuat.copy(q).multiply(_q.slerpQuaternions(this.supportHand, this.supportAim, this.aimShare));
    this.nodes.grip_support.getWorldPosition(h.lPalm).add(_v.copy(this.supportLocalOffset).setZ(this.gripSlide + this.reachSlide).applyQuaternion(q));
    h.lCurl = 1;
  }

  _dropMagazine(ctx) {
    const mag = this.nodes.magazine;
    mag.position.copy(this.seat);
    mag.position.y -= MAG_TRAVEL;
    mag.quaternion.copy(this.seatQuat);
    mag.updateWorldMatrix(true, false);
    ctx.fx.dropMagazine(mag);
  }

  _shoot(ctx) {
    const n = this.nodes;
    // Blender's local +Y on the empties is local -Z after the glTF axis swap.
    n.muzzle_point.getWorldPosition(_v);
    n.muzzle_point.getWorldQuaternion(_q);
    // The round goes to what the shooter is looking at, as long as that is in front of the
    // muzzle; recoil shows on the rifle and the camera rather than on the point of impact.
    _v2.set(0, 0, -1).applyQuaternion(_q);
    if (ctx.aimPoint) {
      _s.subVectors(ctx.aimPoint, _v);
      const range = _s.length();
      if (range > 1.2 && _s.dot(_v2) > range * 0.5) _v2.copy(_s).divideScalar(range);
    }
    const spread = ctx.spread || 0;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    _s.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0).applyQuaternion(_q);
    _v2.add(_s).normalize();
    ctx.fx.shot(_v, _v2);
    ctx.fx.flash();

    n.eject_point.getWorldPosition(_v);
    n.eject_point.getWorldQuaternion(_q);
    _v2.set(0, 0, -1).applyQuaternion(_q);
    ctx.fx.shell(_v, _v2, this._qW);
  }
}
