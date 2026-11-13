// The yard's materials, made in code (pass 10, rendering): no image files. Each is a standard PBR
// material whose colour, roughness and normal are shaded from noise in world space (TSL), so a box
// or a ramp of any size gets detail at the same scale, and nothing repeats on a visible tile.
// Kept calm on purpose: the character is the subject.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, color, mix, smoothstep, abs, sin, fract, floor, clamp,
  positionWorld, positionView, normalView, normalWorld, faceDirection, cameraPosition,
  mx_noise_float, mx_fractal_noise_float, texture, uv,
} from 'three/tsl';

/** A view-space normal bent by the screen-space slope of a height (any node, not only a texture). */
const bump = (height, scale) =>
  Fn(() => {
    const dH = vec2(height.dFdx(), height.dFdy()).mul(scale);
    const vSigmaX = positionView.dFdx().normalize();
    const vSigmaY = positionView.dFdy().normalize();
    const vN = normalView;
    const R1 = vSigmaY.cross(vN);
    const R2 = vN.cross(vSigmaX);
    const fDet = vSigmaX.dot(R1).mul(faceDirection);
    const vGrad = fDet.sign().mul(dH.x.mul(R1).add(dH.y.mul(R2)));
    return fDet.abs().mul(vN).sub(vGrad).normalize();
  })();

// fine bumps fade out with distance (they would only shimmer there)
const near = (d0, d1) => float(1).sub(smoothstep(d0, d1, positionWorld.distance(cameraPosition)));

/**
 * Cast concrete: broad blotches and stains, fine grain, small pits; rougher where it is stained.
 * `map` (optional) is multiplied in (the ground's slab joints).
 */
export function concrete(hex, { map = null, side = THREE.FrontSide, scale = 1, stains = 1 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ side });
  const p = positionWorld.mul(scale);
  // (four noise lookups in all: these run on every pixel of the yard; a Worley pore pattern and more
  // octaves cost ten times as much at 2560 x 1440 for nothing visible)
  const broad = mx_fractal_noise_float(p.mul(0.35), 2, 2, 0.5).toVar(); // -1..1, metres
  const mid = mx_noise_float(p.mul(2.7)).toVar();
  const grain = mx_noise_float(p.mul(38)).toVar();
  const pits = smoothstep(0.42, 0.62, mx_noise_float(p.mul(13).add(5.1))).mul(smoothstep(0.1, -0.3, mid)).toVar(); // small dark pores
  const stain = smoothstep(0.1, 0.55, broad.mul(-0.6).add(mid.mul(0.15)).add(0.25)).mul(stains).toVar();
  let base = color(hex).mul(float(1).add(broad.mul(0.09)).add(mid.mul(0.035)).add(grain.mul(0.03)));
  base = base.mul(float(1).sub(pits.mul(0.08))).mul(float(1).sub(stain.mul(0.16)));
  if (map) base = base.mul(texture(map, uv().mul(map.repeat)).rgb);
  m.colorNode = base;
  m.roughnessNode = clamp(float(0.86).add(grain.mul(0.05)).add(stain.mul(0.06)).sub(broad.mul(0.03)), 0.6, 1);
  m.metalnessNode = float(0);
  const h = grain.mul(0.6).add(mid.mul(0.4)).sub(pits.mul(0.5));
  m.normalNode = bump(h, near(6, 25).mul(0.012));
  return m;
}

/** Packed earth for the berm: browner, coarser. */
export function earth(hex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const broad = mx_fractal_noise_float(p.mul(0.25), 2, 2, 0.5).toVar();
  const clods = mx_noise_float(p.mul(3.1)).toVar();
  m.colorNode = color(hex).mul(float(1).add(broad.mul(0.14)).add(clods.mul(0.08)));
  m.roughnessNode = float(0.97);
  m.metalnessNode = float(0);
  m.normalNode = bump(clods, near(10, 40).mul(0.03));
  return m;
}

/** Sawn boards: grain along x, a gap every 15 cm down the face, a little variation per board. */
export function wood(hex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  // boards run along the box's longer horizontal side; for a cube either reads right
  const across = p.y.mul(6.6); // boards 15 cm high
  const board = floor(across);
  const gap = smoothstep(0.035, 0.0, fract(across)).add(smoothstep(0.965, 1.0, fract(across)));
  const grain = mx_noise_float(vec3(p.x.mul(1.5), p.y.mul(40), p.z.mul(1.5)).add(board.mul(7.1)));
  const tone = mx_noise_float(vec3(board.mul(3.7), board, 0)).mul(0.1);
  m.colorNode = color(hex).mul(float(1).add(grain.mul(0.08)).add(tone)).mul(float(1).sub(gap.mul(0.45)));
  m.roughnessNode = float(0.82).add(grain.mul(0.05));
  m.metalnessNode = float(0);
  m.normalNode = bump(grain.mul(0.3).sub(gap), near(5, 20).mul(0.02));
  return m;
}

/**
 * Painted corrugated steel (shipping containers): vertical corrugations every 28 cm on the walls,
 * the paint worn and streaked with dirt down from the top, rust coming through at the bottom.
 */
export function corrugated(hex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = normalWorld;
  // along the wall: x on the walls facing z, z on the walls facing x; roofs flat
  const along = mix(p.z, p.x, smoothstep(0.4, 0.6, abs(n.z)));
  const wall = smoothstep(0.7, 0.5, abs(n.y));
  const ridge = sin(along.mul((2 * Math.PI) / 0.28)).mul(wall);
  const streak = mx_fractal_noise_float(vec3(along.mul(6), p.y.mul(0.35), 0), 2, 2, 0.5).toVar();
  const low = smoothstep(0.9, 0.0, p.y); // grime splashed up from the ground
  const rust = smoothstep(0.35, 0.75, mx_fractal_noise_float(p.mul(1.7), 2, 2, 0.5).add(low.mul(0.4))).toVar();
  const paint = color(hex).mul(float(1).add(streak.mul(0.1)).sub(low.mul(0.12)));
  m.colorNode = mix(paint, color(0x5a3320), rust.mul(0.55));
  m.roughnessNode = clamp(float(0.55).add(streak.mul(0.1)).add(rust.mul(0.3)), 0.3, 1);
  m.metalnessNode = mix(float(0.25), float(0.5), rust);
  m.normalNode = bump(ridge.mul(0.5).add(streak.mul(0.05)), near(20, 60).mul(0.06));
  return m;
}

/** Bare or painted steel for posts and rails: brushed, a little worn. */
export function steel(hex, rough = 0.42, metal = 0.85) {
  const m = new THREE.MeshStandardNodeMaterial();
  const wear = mx_fractal_noise_float(positionWorld.mul(4), 2, 2, 0.5);
  m.colorNode = color(hex).mul(float(1).add(wear.mul(0.12)));
  m.roughnessNode = clamp(float(rough).add(wear.mul(0.12)), 0.15, 1);
  m.metalnessNode = float(metal);
  return m;
}

/** Road paint (lines, nosings): matt, worn through in places to what is under it. */
export function roadPaint(hex, under = 0x8e908f) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const wear = smoothstep(0.25, 0.55, mx_fractal_noise_float(p.mul(3.3), 3, 2, 0.5).add(mx_noise_float(p.mul(30)).mul(0.25)));
  m.colorNode = mix(color(hex), color(under), wear.mul(0.7));
  m.roughnessNode = float(0.78).add(wear.mul(0.12));
  m.metalnessNode = float(0);
  return m;
}


/**
 * Asphalt (pass V1, the track and the skidpad): dark aggregate with lighter stones, the racing line
 * polished and darkened by rubber where `rubber` (0..1, a node, optional) says, fine grain bumped.
 */
export function asphalt(hex, { rubber = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const broad = mx_fractal_noise_float(p.mul(0.08), 2, 2, 0.5).toVar();
  const mid = mx_noise_float(p.mul(1.9)).toVar();
  const grain = mx_noise_float(p.mul(55)).toVar();
  const stones = smoothstep(0.55, 0.75, mx_noise_float(p.mul(23).add(3.3))).toVar();
  let base = color(hex).mul(float(1).add(broad.mul(0.12)).add(mid.mul(0.05)).add(grain.mul(0.06)).add(stones.mul(0.25)));
  let rough = clamp(float(0.88).add(grain.mul(0.05)).sub(stones.mul(0.08)), 0.5, 1);
  if (rubber) {
    base = base.mul(float(1).sub(rubber.mul(0.35)));
    rough = rough.sub(rubber.mul(0.2));
  }
  m.colorNode = base;
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  m.normalNode = bump(grain.mul(0.5).add(stones.mul(0.5)), near(5, 30).mul(0.01));
  return m;
}

/** Dry grass and dirt (pass V1, everything off the paving): patchy, browner where it is worn. */
export function grass(hex, dirtHex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const broad = mx_fractal_noise_float(p.mul(0.02), 3, 2, 0.5).toVar();
  const patch = smoothstep(-0.1, 0.35, broad.add(mx_noise_float(p.mul(0.3)).mul(0.25))).toVar();
  const blades = mx_noise_float(p.mul(9)).toVar();
  const base = mix(color(dirtHex), color(hex), patch);
  m.colorNode = base.mul(float(1).add(blades.mul(0.1)).add(broad.mul(0.08)));
  m.roughnessNode = float(0.96);
  m.metalnessNode = float(0);
  m.normalNode = bump(blades, near(8, 30).mul(0.03));
  return m;
}
