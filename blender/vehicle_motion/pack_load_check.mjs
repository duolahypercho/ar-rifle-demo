// Loads a vehicle pack with three.js's own GLTFLoader (Node, no browser) and checks it against its body:
//   node blender/vehicle_motion/pack_load_check.mjs <pack.glb> <body.glb> <out.txt>
// Every clip's every track must name a bone of the body (or one of the pack's extra nodes under spine_05,
// which the game adds), every rotation track 4 values per key, every translation 3, all keys at 30 fps;
// the JSON beside the pack must carry the contract's fields for every clip.
import { readFileSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const [packPath, bodyPath, outPath] = process.argv.slice(2);
const lines = [];
const fail = [];
const log = (s) => { lines.push(s); console.log(s); };

function glbJson(path) {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const body = glbJson(bodyPath);
const joints = new Set(body.skins[0].joints.map((j) => body.nodes[j].name));
const extra = new Set(['Gun', 'GunIn', 'PalmL', 'PalmR', 'ElbowL', 'ElbowR']);
const buf = readFileSync(packPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
const notes = JSON.parse(readFileSync(packPath.replace(/\.glb$/, '.json'), 'utf8'));
log(`pack ${packPath.split('/').pop()}: ${gltf.animations.length} clips; body ${bodyPath.split('/').pop()}: ${joints.size} joints`);
let packBones = new Set();
gltf.scene.traverse((o) => { if (o.name) packBones.add(o.name); });
const missingInPack = [...joints].filter((j) => !packBones.has(j));
log(`bones: pack nodes cover the body's joints: ${missingInPack.length === 0 ? 'yes' : 'NO, missing ' + missingInPack.join(',')}`);
if (missingInPack.length) fail.push('bones');
for (const clip of gltf.animations) {
  let bad = [];
  const nodes = new Set();
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split('.');
    nodes.add(node);
    if (!joints.has(node) && !extra.has(node)) bad.push(t.name);
    const w = prop === 'quaternion' ? 4 : 3;
    if (t.values.length !== t.times.length * w) bad.push(`${t.name} size`);
    for (let i = 1; i < t.times.length; i++) if (Math.abs(t.times[i] - t.times[i - 1] - 1 / 30) > 1e-4) { bad.push(`${t.name} fps`); break; }
  }
  const unkeyed = [...joints].filter((j) => !nodes.has(j));
  const n = notes.clips[clip.name];
  const need = ['vehicle', 'events', 'door', 'contacts', 'root', 'frames', 'loop', 'duration'];
  const missing = n ? need.filter((k) => !(k in n)) : ['(no notes)'];
  const frames = clip.tracks[0].times.length;
  const lenOk = n && n.door.length === n.frames && n.root.length === n.frames && (n.loop ? frames === n.frames + 1 : frames === Math.max(1, n.frames) || frames === n.frames);
  const cOk = n && n.contacts.every((c) => ['hand_l', 'hand_r', 'foot_l', 'foot_r'].includes(c.part) && Number.isInteger(c.from) && Number.isInteger(c.to) && 'node' in c && c.at.length === 3 && c.kind);
  log(`${clip.name}: ${clip.tracks.length} tracks, ${frames} keys, ${clip.duration.toFixed(3)} s; unbound ${bad.length}; joints not keyed ${unkeyed.length}; notes fields ${missing.length ? 'MISSING ' + missing : 'ok'}; door/root per frame ${lenOk ? 'ok' : 'BAD'}; contacts ${n ? n.contacts.length : 0} ${cOk ? 'ok' : 'BAD'}`);
  if (bad.length || missing.length || !lenOk || !cOk || unkeyed.length) fail.push(clip.name);
}
const top = ['version', 'skeleton', 'body', 'fps', 'clipSpace', 'seatedReference', 'controls', 'events', 'door', 'contacts', 'clips'];
const topMissing = top.filter((k) => !(k in notes));
log(`top-level notes: ${topMissing.length ? 'MISSING ' + topMissing : 'ok'} (${top.join(', ')})`);
if (topMissing.length) fail.push('top');
log(fail.length ? `FAIL: ${fail.join(', ')}` : 'PASS');
writeFileSync(outPath, lines.join('\n') + '\n');
process.exit(fail.length ? 1 : 0);
