// The place: a concrete yard with a backstop, things to move around and steel plates to shoot.
import * as THREE from 'three/webgpu';
import { buildGround } from './ground.js';
import { APRON, CAR_OBSTACLES } from './track.js';
import { concrete, earth, wood, corrugated, roadPaint } from './surfaces.js';

function groundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  // (a multiplier over the concrete shader in surfaces.js: white, with speckle and the slab joints)
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const shade = 200 + Math.floor(Math.random() * 55);
    g.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(70,72,74,0.6)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, size, size); // slab joints
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(75, 75); // one slab every 4 m
  tex.anisotropy = 8;
  return tex;
}

// x, z = centre; w, h, d = size along x, y and z
const BOXES = [
  // concrete barriers
  { kind: 'concrete', x: -3.2, z: -6, w: 2.4, h: 0.85, d: 0.5 },
  { kind: 'concrete', x: 3.6, z: -9.5, w: 2.4, h: 0.85, d: 0.5 },
  { kind: 'concrete', x: -7.5, z: -12, w: 0.5, h: 0.85, d: 2.4 },
  { kind: 'concrete', x: 8.5, z: -3.5, w: 0.5, h: 0.85, d: 2.4 },
  { kind: 'concrete', x: 0.5, z: 9, w: 2.4, h: 0.85, d: 0.5 },
  { kind: 'concrete', x: -9, z: 6.5, w: 2.4, h: 0.85, d: 0.5 },
  // crates
  { kind: 'crate', x: 5.2, z: -2.6, w: 1, h: 1, d: 1 },
  { kind: 'crate', x: 6.25, z: -2.5, w: 1, h: 1, d: 1 },
  { kind: 'crate', x: 5.7, z: -2.55, w: 0.9, h: 0.9, d: 0.9, y: 1 },
  { kind: 'crate', x: -6.2, z: -1.8, w: 1.1, h: 1.1, d: 1.1 },
  { kind: 'crate', x: -4.6, z: 5.2, w: 1, h: 1, d: 1 },
  { kind: 'crate', x: 4.4, z: 6.4, w: 1.2, h: 0.7, d: 0.8 },
  { kind: 'crate', x: 11, z: -13, w: 1, h: 1, d: 1 },
  // shipping containers
  { kind: 'blue', x: -15, z: -8, w: 2.44, h: 2.6, d: 6.06 },
  { kind: 'rust', x: 15.5, z: 5, w: 2.44, h: 2.6, d: 6.06 },
  { kind: 'rust', x: -6, z: 17, w: 6.06, h: 2.6, d: 2.44 },
  { kind: 'blue', x: 9, z: 19.5, w: 6.06, h: 2.6, d: 2.44 },
];

// x, z, facing (rad): plates hang at chest height all round the yard
const PLATES = [
  [-3.9, -14.5, 0.26],
  [0, -15, 0],
  [3.9, -14.5, -0.26],
  [-10, -19, 0.4],
  [10.5, -19.5, -0.45],
  [-12.2, -1, 1.2],
  [13.5, -6, -1.3],
  [-11, 12, 2.3],
  [2, 15.5, 3.14],
  [12, 13, -2.4],
];

/**
 * Fills the scene. Everything a bullet can hit goes into fx.colliders, and every box the
 * player cannot walk through is returned as { minX, maxX, minZ, maxZ }.
 */
export function buildRange(scene, fx) {
  const obstacles = [];

  // (pass V1) the yard's concrete is the apron of the driving world (track.js APRON); grass and the
  // track round it are world.js's. Slabs stay 4 m.
  const map = groundTexture();
  const w = APRON.x1 - APRON.x0;
  const d = APRON.z1 - APRON.z0;
  map.repeat.set(w / 4, d / 4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), concrete(0x7f8180, { map }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((APRON.x0 + APRON.x1) / 2, 0, (APRON.z0 + APRON.z1) / 2);
  ground.receiveShadow = true;
  ground.userData.static = true; // ((V4) batch.js)
  scene.add(ground);
  fx.colliders.push(ground);

  const berm = new THREE.Mesh(
    new THREE.BoxGeometry(110, 7, 5),
    earth(0x8c8068),
  );
  berm.position.set(0, 3.5, -27);
  berm.userData.static = true;
  berm.castShadow = false; // (as before: the berm never cast)
  CAR_OBSTACLES.push({ x: 0, z: -27, hx: 55, hz: 2.5, c: 1, s: 0, top: 7 });
  scene.add(berm);
  fx.colliders.push(berm);

  const paint = roadPaint(0xd9b23c);
  const stripe = (x, z, w, d) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.004, z);
    mesh.receiveShadow = true;
    mesh.userData.static = true;
    scene.add(mesh);
  };
  stripe(0, -0.75, 9, 0.1); // firing line
  for (const x of [-4.5, -1.5, 1.5, 4.5]) stripe(x, -8, 0.06, 14); // lanes

  const materials = {
    concrete: concrete(0xa3a5a4),
    crate: wood(0x8b6b45),
    blue: corrugated(0x35607f),
    rust: corrugated(0x9a4a2f),
  };
  for (const box of BOXES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), materials[box.kind]);
    mesh.position.set(box.x, (box.y || 0) + box.h / 2, box.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.static = true;
    scene.add(mesh);
    fx.colliders.push(mesh);
    if (!box.y) {
      obstacles.push({ minX: box.x - box.w / 2, maxX: box.x + box.w / 2, minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2 });
      CAR_OBSTACLES.push({ x: box.x, z: box.z, hx: box.w / 2, hz: box.d / 2, c: 1, s: 0, top: box.h });
    }
  }

  for (const [x, z, facing] of PLATES) fx.addTarget(x, 1.32, z, facing);
  // the ramps, the stairs and the kerb (ground.js), behind the start, clear of the boxes
  buildGround(scene, fx, obstacles);
  return obstacles;
}
