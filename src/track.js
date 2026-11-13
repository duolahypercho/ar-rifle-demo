// The driving world's plan (pass V1), pure (no Three.js): the track's centre line, its kerbs, the
// paved areas and what the car can hit. ground.js asks it for the kerbs' height; world.js builds the
// meshes from it; the car asks it for the surface under each tyre.
//
// Coordinates as the game's: +X east, -Z north, Y up. The yard (range.js) is round the origin.
//
// The track: a 2.6 km clockwise loop east of the yard, 13 m wide:
//   main straight north 900 m -> hairpin (right, 35 m) -> 250 m -> left 90 (60 m) -> 150 m ->
//   fast sweeper (right 180, 150 m) -> 60 m -> chicane (left 20, right 40, left 20 at 50 m) -> 60 m ->
//   left 90 (50 m) -> straight -> tight hairpin (right 180) back onto the main straight.
// The back straights are 250 + 150 m and the closing straight 240 m; the main straight is the one for
// top speed (900 m, flat out from the hairpin's exit: 330 km/h by its end).

export const TRACK_WIDTH = 13;
export const KERB_WIDTH = 1.2;
export const KERB_HEIGHT = 0.045; // m at its outer edge, sloping up from the track's edge
const STEP = 2; // m between centre-line points

const X0 = 120;
const Z0 = 100;
// [kind, length or radius, angle (deg, + left)]
const PLAN = [
  ['S', 900],
  ['A', 35, -180],
  ['S', 250],
  ['A', 60, 90],
  ['S', 150],
  ['A', 150, -180],
  ['S', 60],
  ['A', 50, 20],
  ['A', 50, -40],
  ['A', 50, 20],
  ['S', 60],
  ['A', 50, 90],
  ['S', 240],
  ['A', 20.8, -180],
];

/** The centre line: points every 2 m with heading (yaw: 0 looks down -Z, + left) and curvature. */
export const LINE = (() => {
  const pts = [];
  let x = X0;
  let z = Z0;
  let yaw = 0;
  let s = 0;
  const push = (k) => pts.push({ x, z, yaw, s, k });
  for (const [kind, a, b] of PLAN) {
    if (kind === 'S') {
      const n = Math.round(a / STEP);
      for (let i = 0; i < n; i++) {
        push(0);
        x += -Math.sin(yaw) * (a / n);
        z += -Math.cos(yaw) * (a / n);
        s += a / n;
      }
    } else {
      const R = a;
      const turn = (b * Math.PI) / 180;
      const len = Math.abs(turn) * R;
      const n = Math.max(2, Math.round(len / STEP));
      const k = Math.sign(turn) / R;
      for (let i = 0; i < n; i++) {
        push(k);
        // exact arc step
        const d = len / n;
        const dy = turn / n;
        const mid = yaw + dy / 2;
        const chord = 2 * R * Math.sin(Math.abs(dy) / 2);
        x += -Math.sin(mid) * chord;
        z += -Math.cos(mid) * chord;
        yaw += dy;
        s += d;
      }
    }
  }
  return pts;
})();
export const TRACK_LENGTH = LINE.length ? LINE[LINE.length - 1].s + STEP : 0;
/** How far the loop's end misses its start (m): it should close. */
export const CLOSURE = Math.hypot(LINE[0].x - (LINE[LINE.length - 1].x - Math.sin(LINE[LINE.length - 1].yaw) * STEP), LINE[0].z - (LINE[LINE.length - 1].z - Math.cos(LINE[LINE.length - 1].yaw) * STEP));

// bounding box, and a grid of centre-line points for the nearest-point search
const BOX = LINE.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
const MARGIN = TRACK_WIDTH / 2 + KERB_WIDTH + 30;
const CELL = 25;
const GRID = new Map();
LINE.forEach((p, i) => {
  const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
  if (!GRID.has(key)) GRID.set(key, []);
  GRID.get(key).push(i);
});

const _near = { d: 0, i: -1, s: 0, k: 0, dist: Infinity };
/**
 * The nearest centre-line point to (x, z) within `reach` m: { i, d (lateral offset, + left of the way
 * round), dist, s, k (curvature, + left) }, or null.
 */
export function nearTrack(x, z, reach = 12) {
  if (x < BOX.x0 - MARGIN || x > BOX.x1 + MARGIN || z < BOX.z0 - MARGIN || z > BOX.z1 + MARGIN) return null;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  let bi = -1;
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const list = GRID.get(`${cx + a},${cz + b}`);
      if (!list) continue;
      for (const i of list) {
        const p = LINE[i];
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 < best) {
          best = d2;
          bi = i;
        }
      }
    }
  }
  if (bi < 0 || best > (reach + STEP) ** 2) return null;
  // refine on the segment to the next point
  const p = LINE[bi];
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const along = (x - p.x) * fx + (z - p.z) * fz;
  const left = (x - p.x) * fz - (z - p.z) * fx; // + to the left of the way round
  _near.i = bi;
  _near.d = left;
  _near.dist = Math.abs(left);
  _near.s = p.s + along;
  _near.k = p.k;
  return _near;
}

/** Kerbs: on both edges through every corner (curvature over 1/400 m), red and white, raised. */
export function kerbAt(n) {
  if (!n) return 0;
  const k = Math.abs(n.k) > 1 / 400 ? 1 : 0;
  if (!k) return 0;
  const e = n.dist - TRACK_WIDTH / 2;
  if (e < 0 || e > KERB_WIDTH) return 0;
  // a ramp up across the kerb, with low ridges every 0.25 m along it
  const ridge = 0.004 * Math.max(0, Math.sin((n.s / 0.25) * Math.PI * 2));
  return (KERB_HEIGHT * e) / KERB_WIDTH + ridge;
}

// paved areas (axis-aligned rectangles and discs): concrete or tarmac
export const APRON = { x0: -110, x1: 104, z0: -140, z1: 140 }; // the yard's concrete, grown
export const SKIDPAD = { x: -260, z: 30, r: 65, pad: 92 }; // a painted 65 m circle on an asphalt disc
export const HELIPAD = { x: -78, z: 112, r: 12 }; // marked; the helicopter lands here (a later pass)
export const SLALOM = { x: 60, z0: -40, gap: 18, count: 7 }; // cones down the apron's east side

/** What is under (x, z): 'tarmac', 'kerb', 'concrete' or 'dirt'. */
export function surfaceKind(x, z) {
  if (x >= APRON.x0 && x <= APRON.x1 && z >= APRON.z0 && z <= APRON.z1) return 'tarmac';
  if ((x - SKIDPAD.x) ** 2 + (z - SKIDPAD.z) ** 2 < SKIDPAD.pad ** 2) return 'tarmac';
  const n = nearTrack(x, z);
  if (n) {
    if (n.dist <= TRACK_WIDTH / 2) return 'tarmac';
    if (n.dist <= TRACK_WIDTH / 2 + KERB_WIDTH && Math.abs(n.k) > 1 / 400) return 'kerb';
  }
  // the road from the apron to the track's closing straight
  if (z > 60 && z < 74 && x > APRON.x1 - 1 && x < 125) return 'tarmac';
  return 'dirt';
}

/**
 * What the car can hit: oriented boxes { x, z, hx, hz, c, s (cos, sin of its turn), top }.
 * Filled by world.js (the buildings, the barriers) and range.js's boxes.
 */
export const CAR_OBSTACLES = [];
