// The yard's ground: flat concrete at y = 0, with two ramps (10 and 20 degrees, each up to a flat
// top and down the other side), a flight of four steps up to a platform and four down again, and a
// 12 cm kerb (pass 9). Everything that stands on the ground asks groundAt() rather than assuming
// y = 0: the player and the body over the feet (character.js), each foot and its sole, the spent
// shells (fx.js) and the review (review.js).
//
// Every feature runs along z (walked up going -z or +z), `x0`..`x1` across, with a profile of
// [z, y] points: straight between them, a riser where two points share a z (the higher side is
// the one further along the profile). The sides of the ramps and the stairs are railed: the
// player cannot walk off them (`rails`, added to the obstacles).
import * as THREE from 'three/webgpu';
import { concrete as concreteSurface, roadPaint, steel as steelSurface } from './surfaces.js';
import { nearTrack, kerbAt, CAR_OBSTACLES } from './track.js';
import { terrainAt } from './terrain.js';

const RAMP = (x0, x1, z0, deg, length, top) => {
  const rise = Math.tan((deg * Math.PI) / 180) * length;
  return { kind: 'ramp', deg, x0, x1, profile: [[z0, 0], [z0 + length, rise], [z0 + length + top, rise], [z0 + 2 * length + top, 0]], railed: true };
};
const STAIRS = (x0, x1, z0, count, rise, tread, top) => {
  const profile = [[z0, 0]];
  for (let k = 0; k < count; k++) {
    const z = z0 + k * tread;
    profile.push([z, (k + 1) * rise]);
    if (k < count - 1) profile.push([z + tread, (k + 1) * rise]);
  }
  const z1 = z0 + (count - 1) * tread + top; // the platform (the top step is its front edge)
  profile.push([z1, count * rise]);
  for (let k = count - 1; k >= 0; k--) {
    const z = z1 + (count - 1 - k) * tread;
    profile.push([z, k * rise]);
    if (k > 0) profile.push([z + tread, k * rise]);
  }
  return { kind: 'stairs', x0, x1, profile, railed: true, rise, tread };
};

export const FEATURES = [
  RAMP(-14.5, -11, 26, 10, 8, 3), // 10 degrees: up 26..34 (1.41 m), top to 37, down to 45
  RAMP(-8, -4.5, 28, 20, 6, 3), // 20 degrees: up 28..34 (2.18 m), top to 37, down to 43
  STAIRS(0, 3, 30, 4, 0.17, 0.3, 3), // up at 30, 30.3, 30.6, 30.9 to 0.68 m; down from 33.9 to 34.8
  { kind: 'kerb', x0: 6, x1: 10, profile: [[30, 0], [30, 0.12], [33, 0.12], [33, 0]], railed: false },
];
// where the review's situations walk (x, z start, facing yaw: 0 looks down -Z, pi down +Z)
export const PLACES = {
  ramp10: { x: -12.75, up: 25, top: 35.5, across: 30 },
  ramp20: { x: -6.25, up: 27, top: 35.5, across: 31 },
  stairs: { x: 1.5, up: 28.0, near: 29.2, top: 32.4, down: 35.6 },
  kerb: { x: 8, z: 28.5 },
};

const _n = new THREE.Vector3();

/**
 * Height of the ground at (x, z), and, if `normal` is given, its upward normal there. On a riser
 * the higher side counts from its z on.
 */
export function groundAt(x, z, normal) {
  let y = 0;
  let slope = 0;
  for (const f of FEATURES) {
    if (x < f.x0 || x > f.x1) continue;
    const p = f.profile;
    if (z < p[0][0] || z >= p[p.length - 1][0]) continue;
    for (let i = 0; i < p.length - 1; i++) {
      const [za, ya] = p[i];
      const [zb, yb] = p[i + 1];
      if (zb <= za || z < za || z >= zb) continue;
      const u = (z - za) / (zb - za);
      const h = ya + (yb - ya) * u;
      if (h > y) {
        y = h;
        slope = (yb - ya) / (zb - za);
      }
      break;
    }
  }
  // (pass V1) the track's kerbs, raised a few centimetres at the edges of every corner (track.js)
  if (slope === 0) {
    const n = nearTrack(x, z);
    if (n) {
      const k = kerbAt(n);
      if (k > y) y = k;
    }
  }
  // (V7) the rolling ground off the paving (terrain.js: 0 within 10 m of any paving or obstacle, so the yard, the track,
  // the skidpad and everything built stand where they did)
  if (y === 0 && slope === 0) {
    const t = terrainAt(x, z, normal);
    if (t > 0) return t;
  }
  if (normal) normal.set(0, 1, -slope).normalize();
  return y;
}

/**
 * How far the point (x, y, z) is inside the ground: 0 above it, else the distance to the nearest
 * surface, the tread above (vertically) or a riser's face (along z, the way the features run).
 */
export function depthAt(x, y, z) {
  const down = groundAt(x, z) - y;
  if (down <= 0) return 0;
  let side = down;
  for (let d = 0.005; d < down; d += 0.005) {
    if (groundAt(x, z - d) <= y || groundAt(x, z + d) <= y) {
      side = d;
      break;
    }
  }
  return Math.min(down, side);
}

/** Whether (x, z) is on a flight of stairs or within `r` m of one (along its run). */
export function onStairs(x, z, r = 0) {
  for (const f of FEATURES) {
    if (f.kind !== 'stairs' || x < f.x0 || x > f.x1) continue;
    const p = f.profile;
    if (z >= p[0][0] - r && z <= p[p.length - 1][0] + r) return true;
  }
  return false;
}

/** Whether a riser (a step's or the kerb's edge) is within `r` m of (x, z): only there do the feet
 * have to be fitted onto a tread (character.js _treadFix). */
export function edgeNear(x, z, r) {
  for (const f of FEATURES) {
    if (x < f.x0 - r || x > f.x1 + r) continue;
    const p = f.profile;
    for (let i = 0; i < p.length - 1; i++) if (p[i][0] === p[i + 1][0] && Math.abs(z - p[i][0]) < r) return true;
  }
  return false;
}

/** The yard's height features as meshes (for the scene and the bullets) and their rails. */
export function buildGround(scene, fx, obstacles) {
  const concrete = concreteSurface(0x9b9d9c, { side: THREE.DoubleSide });
  const edge = roadPaint(0xd9b23c, 0x9b9d9c);
  const steel = steelSurface(0x4a4f55, 0.45, 0.75);
  for (const f of FEATURES) {
    const geo = profileGeometry(f.profile, f.x0, f.x1);
    const mesh = new THREE.Mesh(geo, concrete);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.static = true; // ((V4) batch.js)
    scene.add(mesh);
    fx.colliders.push(mesh);
    // painted nosings on every riser and where a slope meets the flat: the eye reads the edges
    const p = f.profile;
    for (let i = 0; i < p.length - 1; i++) {
      if (p[i][0] === p[i + 1][0]) {
        const y = Math.max(p[i][1], p[i + 1][1]);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(f.x1 - f.x0, 0.006, 0.04), edge);
        // (on the tread of the higher side, at its front)
        const along = p[i + 1][1] > p[i][1] ? 0.02 : -0.02;
        strip.position.set((f.x0 + f.x1) / 2, y + 0.003, p[i][0] + along);
        strip.receiveShadow = true;
        strip.userData.static = true;
        scene.add(strip);
      }
    }
    if (f.railed) {
      const z0 = p[0][0];
      const z1 = p[p.length - 1][0];
      // (pass V1) the car keeps off the ramps and stairs: they are railed, for people
      CAR_OBSTACLES.push({ x: (f.x0 + f.x1) / 2, z: (z0 + z1) / 2, hx: (f.x1 - f.x0) / 2 + 0.1, hz: (z1 - z0) / 2, c: 1, s: 0, top: 3 });
      for (const x of [f.x0 - 0.05, f.x1 + 0.05]) {
        obstacles.push({ minX: x - 0.05, maxX: x + 0.05, minZ: z0 - 0.05, maxZ: z1 + 0.05 });
        // a rail on posts that follows the profile
        for (let z = z0; z <= z1 + 1e-6; z += 1) {
          const y = groundAt((f.x0 + f.x1) / 2, Math.min(z, z1 - 1e-3));
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), steel);
          post.position.set(x, y + 0.5, z);
          post.castShadow = post.receiveShadow = true;
          post.userData.static = true;
          scene.add(post);
        }
        const pts = [];
        for (let z = z0; z <= z1 + 1e-6; z += 0.1) pts.push(new THREE.Vector3(x, groundAt((f.x0 + f.x1) / 2, Math.min(z, z1 - 1e-3)) + 1.0, z));
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, 0.025, 6), steel);
        rail.castShadow = rail.receiveShadow = true;
        rail.userData.static = true;
        scene.add(rail);
      }
    }
  }
}

/** Top, sides and ends of a profile swept across x0..x1 (vertical risers included). */
function profileGeometry(profile, x0, x1) {
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < profile.length - 1; i++) {
    const [za, ya] = profile[i];
    const [zb, yb] = profile[i + 1];
    // the top (or a riser) between two profile points, facing up / out
    if (zb === za) {
      // riser: faces -z where it rises going +z, +z where it falls
      if (yb > ya) quad([x0, ya, za], [x1, ya, za], [x1, yb, za], [x0, yb, za]);
      else quad([x1, yb, za], [x0, yb, za], [x0, ya, za], [x1, ya, za]);
    } else quad([x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]);
    // the two sides, down to the ground
    quad([x0, 0, za], [x0, 0, zb], [x0, yb, zb], [x0, ya, za]);
    quad([x1, 0, zb], [x1, 0, za], [x1, ya, za], [x1, yb, zb]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
