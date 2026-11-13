// The rig adapter (pass R3): the game poses the old 56-joint skeleton's names in canonical frames,
// and this turns that pose into the UE5 Mannequin-style skeleton (earthonline-ue5-v1) of whichever
// body is in use.
//
// Canonical frames (blender/ue5_rig/UE5_SKELETON.md, "Clips on this skeleton"): for every bone b a
// fixed turn R[b] (the frames file's `R`, or the rest world rotation for a body whose rest is the
// canonical I-pose) with   boneWorld = canonicalWorld * R[b].   In canonical frames every rest is the
// identity and a bone that took over an old joint has exactly that joint's local rotation, so all
// of character.js's math (blending, foot holding, leg and arm IK, trigger finger, face, hits) is
// kept: it poses a PROXY skeleton of plain THREE.Bones under the old names (Hips, Spine, ...,
// RightHandIndex3), every rest the identity, joints at the body's canonical joint positions. After
// the arms are posed, `apply()` writes the real bones:
//
//   mapped bones     world = proxyWorld[old joint] * R[b]  (spine_01 / 03 / 05 <- Spine / Spine1 /
//                    Spine2, neck_01 <- Neck, clavicle <- Shoulder, ...)
//   in-between       spine_02 / spine_04 take half of the old Spine / Spine1 turn (spine_01 / 03 the
//                    other half, as the weights are split); spine_02 / spine_04 and the chest
//                    (spine_05) keep the proxy's world rotation exactly, and spine_03 / spine_05 are
//                    pinned to the proxy's joints (at most 2 to 3 mm of bone translation), so the
//                    shoulders, arms and hands are where the game solved them; neck_02 stays at its
//                    canonical local (the exact mapping: see SPREAD)
//   metacarpals      at their canonical local (the palm rigid, as the clips have them)
//   twist bones      local = canonicalLocal * twistY(share * a), the body's own shares (frames file
//                    `twistBones`, else the table's), a measured on the FINAL pose (after the run-time
//                    arm and leg IK) as blender/rifle_motion/skel.py does, unwrapped frame to frame
//   IK bones         re-driven to follow the final feet and hands (ik_foot_l/r = foot, ik_hand_gun =
//                    hand_r, ik_hand_l = hand_l in ik_hand_gun's frame, ik_hand_r identity)
//   root             held at rest: the character is moved by the transitions' notes `root`
import * as THREE from 'three/webgpu';

/** The old joints the game poses (earthonline-humanoid-v1), parent first, and their UE5 bones. */
const FINGER_NAMES = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Pinky: 'pinky' };
export const OLD_JOINTS = (() => {
  const list = [
    ['Root', null, 'root'],
    ['Hips', 'Root', 'pelvis'],
    ['Spine', 'Hips', 'spine_01'],
    ['Spine1', 'Spine', 'spine_03'],
    ['Spine2', 'Spine1', 'spine_05'],
    ['Neck', 'Spine2', 'neck_01'],
    ['Head', 'Neck', 'head'],
    ['Jaw', 'Head', 'jaw'],
    ['LeftEye', 'Head', 'eye_l'],
    ['RightEye', 'Head', 'eye_r'],
  ];
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']]) {
    list.push([side + 'Shoulder', 'Spine2', `clavicle_${s}`]);
    list.push([side + 'Arm', side + 'Shoulder', `upperarm_${s}`]);
    list.push([side + 'ForeArm', side + 'Arm', `lowerarm_${s}`]);
    list.push([side + 'Hand', side + 'ForeArm', `hand_${s}`]);
    for (const [finger, f] of Object.entries(FINGER_NAMES)) {
      for (let k = 1; k <= 3; k++) list.push([`${side}Hand${finger}${k}`, k === 1 ? side + 'Hand' : `${side}Hand${finger}${k - 1}`, `${f}_0${k}_${s}`]);
    }
  }
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']]) {
    list.push([side + 'UpLeg', 'Hips', `thigh_${s}`]);
    list.push([side + 'Leg', side + 'UpLeg', `calf_${s}`]);
    list.push([side + 'Foot', side + 'Leg', `foot_${s}`]);
    list.push([side + 'ToeBase', side + 'Foot', `ball_${s}`]);
  }
  return list.map(([name, parent, bone]) => ({ name, parent, bone }));
})();
export const UE5_OF = Object.fromEntries(OLD_JOINTS.map((j) => [j.name, j.bone]));

// In-between bones: which old joint's turn they share and how much of it they take; the mapped
// bone below them takes the rest (spine_01 / spine_03 / neck_01).
const SPREAD = {
  spine_02: { below: 'spine_01', joint: 'Spine', share: 0.5 },
  spine_04: { below: 'spine_03', joint: 'Spine1', share: 0.5 },
};
// (neck_02 is NOT spread: the aim's cheek weld (character.js _seatEye) turns the old Neck a long way
// and counter-turns the Head, and 30 % of that on neck_02 put the head joint 19 mm off the place the
// game solved for (walking aimed, Tripo); held at its canonical local the neck is exact)
// mapped bones whose joint is pinned to the proxy's (the bone above each in-between one)
const PIN = new Set(['spine_03', 'spine_05']);
const IK = { ik_foot_l: 'foot_l', ik_foot_r: 'foot_r', ik_hand_gun: 'hand_r' };
const EXTRA_NODES = new Set(['Gun', 'GunIn', 'PalmL', 'PalmR', 'ElbowL', 'ElbowR']);

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Swing-twist: the angle (rad, -pi..pi) of q's twist about +Y (skel.py twist_angle). */
function twistY(q) {
  let { y, w } = q;
  if (w < 0) {
    y = -y;
    w = -w;
  }
  return Math.abs(y) + Math.abs(w) > 1e-12 ? 2 * Math.atan2(y, w) : 0;
}
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * Canonical frames of one skeleton: per UE5 bone its parent, rest local transform, R[b], canonical
 * local rotation (R[p]^-1 R[b]: "straight", "no twist") and canonical joint position.
 * `scene` is the loaded glTF scene (a body or a clip pack's nodes); `frames` the body's frames JSON
 * (null: the rest world rotations are R, true for the EarthOnline I-pose bodies).
 */
export class Frames {
  constructor(scene, frames = null, twistBones = null) {
    let rootNode = null;
    scene.traverse((o) => {
      if (!rootNode && o.name === 'root' && !o.isMesh) rootNode = o;
    });
    if (!rootNode) throw new Error('not an earthonline-ue5-v1 skeleton (no root)');
    // (a clip pack's nodes are plain Object3Ds; its extra nodes under spine_05 are not bones)
    const isJoint = (o) => !o.isMesh && !o.isSkinnedMesh && o.name && !EXTRA_NODES.has(o.name) && o.name !== 'proxy' && (o.isBone || o.type === 'Object3D');
    this.order = [];
    this.parent = {};
    this.restQ = {};
    this.restT = {};
    this.R = {};
    this.canonLocal = {};
    this.head = {}; // canonical joint positions, skeleton space
    const restW = {};
    const restP = {};
    const walk = (node, parent) => {
      const name = node.name;
      this.order.push(name);
      this.parent[name] = parent;
      this.restQ[name] = node.quaternion.clone();
      this.restT[name] = node.position.clone();
      restW[name] = parent ? restW[parent].clone().multiply(node.quaternion) : node.quaternion.clone();
      restP[name] = parent ? node.position.clone().applyQuaternion(restW[parent]).add(restP[parent]) : node.position.clone();
      for (const child of node.children) if (isJoint(child)) walk(child, name);
    };
    walk(rootNode, null);
    if (!this.parent.pelvis && !this.order.includes('pelvis')) throw new Error('not an earthonline-ue5-v1 skeleton (no pelvis)');
    const fb = frames && frames.bones;
    for (const name of this.order) {
      const f = fb && fb[name];
      this.R[name] = f && f.R ? new THREE.Quaternion().fromArray(f.R).normalize() : restW[name].clone();
      this.head[name] = f && f.canonicalHead ? new THREE.Vector3().fromArray(f.canonicalHead) : restP[name].clone();
    }
    for (const name of this.order) {
      const p = this.parent[name];
      this.canonLocal[name] = p ? this.R[p].clone().invert().multiply(this.R[name]) : this.R[name].clone();
    }
    // twist bones: name -> { parent, share, measure ('child' | 'self'), source }
    this.twist = {};
    const spec = (frames && frames.twistBones) || twistBones || {};
    for (const [pattern, t] of Object.entries(spec)) {
      for (const s of ['l', 'r']) {
        const name = pattern.replace('{s}', s);
        if (!this.parent[name]) continue;
        this.twist[name] = { parent: t.parent.replace('{s}', s), share: t.share, measure: t.measure, source: t.source.replace('{s}', s) };
      }
    }
  }

  /** Canonical offset of an old joint from its old parent (the proxy's rest position). */
  offset(joint) {
    const j = OLD_JOINTS.find((x) => x.name === joint);
    if (!j.parent) return this.head[j.bone].clone();
    return this.head[j.bone].clone().sub(this.head[UE5_OF[j.parent]]);
  }

  has(bone) {
    return !!this.parent[bone];
  }
}

/**
 * The adapter for one body: the real bones by name, the proxy skeleton the game poses, and
 * apply(), which poses the real bones from it.
 */
export class Rig {
  constructor(scene, framesJson, table) {
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    this.bones = bones; // real, UE5 names
    this.frames = new Frames(scene, framesJson, table && table.twistBones);
    const fr = this.frames;
    // (twist bones after everything they measure, IK bones last: they follow the final hands and feet)
    const real = fr.order.filter((name) => bones[name]);
    const ik = (name) => name.startsWith('ik_');
    this.order = [...real.filter((n) => !fr.twist[n] && !ik(n)), ...real.filter((n) => fr.twist[n]), ...real.filter(ik)];
    // the proxy: old names, identity rests, canonical joint positions, under the same parent as the
    // real root bone
    this.proxy = {};
    const root = bones.root;
    this.space = root.parent;
    for (const j of OLD_JOINTS) {
      if (!bones[j.bone] || (j.parent && !this.proxy[j.parent])) continue;
      const bone = new THREE.Bone();
      bone.name = j.name;
      bone.position.copy(fr.offset(j.name));
      this.proxy[j.name] = bone;
      if (j.parent) this.proxy[j.parent].add(bone);
    }
    this.proxyRoot = this.proxy.Root;
    this.proxyRoot.name = 'proxy';
    this.space.add(this.proxyRoot);
    this.proxy.Root.name = 'Root';
    // world (skeleton space) rotation and position of every real bone, filled by apply()
    this.Q = {};
    this.P = {};
    for (const name of this.order) {
      this.Q[name] = new THREE.Quaternion();
      this.P[name] = new THREE.Vector3();
    }
    // the proxy's, likewise
    this.CQ = {};
    this.CP = {};
    for (const name of Object.keys(this.proxy)) {
      this.CQ[name] = new THREE.Quaternion();
      this.CP[name] = new THREE.Vector3();
    }
    this.oldOf = {};
    for (const j of OLD_JOINTS) if (this.proxy[j.name]) this.oldOf[j.bone] = j.name;
    this.twistAngle = {}; // unwrapped, per twist bone (rad)
    this.pinMm = 0; // the most a pinned joint was moved from the bone's own place this frame (mm)
    this.twistStepDeg = 0; // the largest change of a twist bone's angle this frame
  }

  /** Forgets the unwrapped twist (a body put down somewhere new). */
  reset() {
    this.twistAngle = {};
  }

  /** Puts the proxy at its rest (the canonical pose) and the real bones there too. */
  canonical() {
    for (const [name, bone] of Object.entries(this.proxy)) {
      bone.quaternion.identity();
      bone.position.copy(this.frames.offset(name));
      bone.scale.set(1, 1, 1);
    }
    this.reset();
    this.apply();
  }

  /** Poses the real skeleton from the proxy (call after the game has posed the proxy). */
  apply() {
    const fr = this.frames;
    const proxy = this.proxy;
    const CQ = this.CQ;
    const CP = this.CP;
    // proxy FK in skeleton space
    for (const j of OLD_JOINTS) {
      const bone = proxy[j.name];
      if (!bone) continue;
      if (!j.parent) {
        CQ[j.name].copy(bone.quaternion);
        CP[j.name].copy(bone.position);
        continue;
      }
      CQ[j.name].copy(CQ[j.parent]).multiply(bone.quaternion);
      CP[j.name].copy(bone.position).applyQuaternion(CQ[j.parent]).add(CP[j.parent]);
    }
    const Q = this.Q;
    const P = this.P;
    const bones = this.bones;
    this.pinMm = 0;
    this.twistStepDeg = 0;
    for (const name of this.order) {
      const bone = bones[name];
      const p = fr.parent[name];
      const q = Q[name];
      const pos = P[name];
      if (!p) {
        // root: at rest
        q.copy(fr.restQ[name]);
        pos.copy(fr.restT[name]);
        bone.quaternion.copy(q);
        bone.position.copy(pos);
        continue;
      }
      const old = this.oldOf[name];
      const spread = SPREAD[name];
      const twist = fr.twist[name];
      let pin = false;
      if (spread && proxy[spread.joint]) {
        // in-between: the old joint's world turn (its canonical place)
        q.copy(CQ[spread.joint]).multiply(fr.R[name]);
      } else if (old && name !== 'root') {
        q.copy(CQ[old]).multiply(fr.R[name]);
        const above = Object.values(SPREAD).find((s) => s.below === name);
        if (above && proxy[above.joint]) {
          // the mapped bone under an in-between one takes only the rest of the old joint's turn:
          // world = proxyWorld[old parent] * L^(1 - share) * R[b]
          const L = proxy[above.joint].quaternion;
          _q.identity().slerp(L, 1 - above.share);
          q.copy(CQ[OLD_JOINTS.find((x) => x.name === above.joint).parent]).multiply(_q).multiply(fr.R[name]);
        }
        pin = PIN.has(name);
        if (name === 'pelvis') pin = true;
      } else if (twist) {
        // the twist bone's share of its source's twist, on the pose as it now is
        const src = twist.source;
        let a;
        if (twist.measure === 'child') {
          // q = local[child] * canonLocal[child]^-1 (in the parent's frame)
          _q.copy(Q[fr.parent[src]]).invert().multiply(Q[src]).multiply(_q2.copy(fr.canonLocal[src]).invert());
        } else {
          // q = canonLocal^-1 * local
          _q2.copy(Q[fr.parent[src]]).invert().multiply(Q[src]);
          _q.copy(fr.canonLocal[src]).invert().multiply(_q2);
        }
        const raw = twistY(_q);
        const last = this.twistAngle[name];
        // (swing-twist has no twist to speak of where the swing nears a half turn, an upper arm raised
        // over the shoulder in the swap: there the twist is held, fading back to the measure as the
        // swing comes down, rather than jumping)
        const sure = THREE.MathUtils.smoothstep(Math.hypot(_q.y, _q.w), 0.2, 0.45);
        a = last === undefined ? raw : last + wrap(raw - last) * sure;
        // (a whole turn too far, which no move needs: back to the principal turn)
        if (Math.abs(a) > Math.PI * 1.6) a -= Math.sign(a) * Math.PI * 2;
        if (last !== undefined) this.twistStepDeg = Math.max(this.twistStepDeg, Math.abs(a - last) * 57.2958 * Math.abs(twist.share));
        this.twistAngle[name] = a;
        _q2.setFromAxisAngle(Y_AXIS, twist.share * a);
        q.copy(Q[p]).multiply(fr.canonLocal[name]).multiply(_q2);
      } else if (IK[name] || name === 'ik_hand_l') {
        const src = IK[name] || 'hand_l';
        q.copy(Q[src]);
        pos.copy(P[src]);
        bone.quaternion.copy(_q.copy(Q[p]).invert().multiply(q));
        bone.position.copy(_v.subVectors(pos, P[p]).applyQuaternion(_q.copy(Q[p]).invert()));
        continue;
      } else if (name === 'ik_hand_r') {
        q.copy(Q[p]).multiply(fr.restQ[name]);
        bone.quaternion.copy(fr.restQ[name]);
        bone.position.copy(fr.restT[name]);
        pos.copy(fr.restT[name]).applyQuaternion(Q[p]).add(P[p]);
        continue;
      } else {
        // metacarpals, jaw without a proxy joint, IK roots: their canonical local
        q.copy(Q[p]).multiply(fr.canonLocal[name]);
        if (name.startsWith('ik_')) q.copy(Q[p]).multiply(fr.restQ[name]);
      }
      // position: the bone's own rest offset from its parent, or the proxy's joint where pinned
      pos.copy(fr.restT[name]).applyQuaternion(Q[p]).add(P[p]);
      if (pin && old) {
        if (name !== 'pelvis') {
          const mm = pos.distanceTo(CP[old]) * 1000;
          if (mm > this.pinMm) {
            this.pinMm = mm;
            this.pinBone = name;
          }
        }
        pos.copy(CP[old]);
        bone.position.copy(_v.subVectors(pos, P[p]).applyQuaternion(_q.copy(Q[p]).invert()));
      } else bone.position.copy(fr.restT[name]);
      bone.quaternion.copy(_q.copy(Q[p]).invert().multiply(q));
    }
    // first person shrinks the head away
    if (proxy.Head && bones.head) bones.head.scale.copy(proxy.Head.scale);
  }
}
