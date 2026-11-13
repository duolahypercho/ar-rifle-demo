// (V9) Pictures of the far trees and the far ground, in the page:
//   const S = await import('/tools/v9_shots.js'); await S.farTrees('v9_trees_before')
// Six views (two from the ground, four from 100 to 500 m up) at midday and at dusk, posted to the sheet receiver
// (tools/sheet_receiver.mjs, 127.0.0.1:5199) as <tag>_midday.jpg and <tag>_dusk.jpg; plus close crops of one copse.
import { sheet, cam, time } from '/tools/v8_shots.js';
import { groundAt } from '/src/ground.js';

export const VIEWS = [
  ['ground, yard edge to the south copse (160 to 250 m)', [-20, 1.7, 138], [0, 7, 320], 50],
  ['ground, apron to the east copse (200 m)', [120, 1.7, 40], [320, 7, 100], 50],
  ['100 m up, 250 m off', [-78, 100, 160], [40, 0, 330], 55],
  ['250 m up, over the field', [-150, 250, 220], [250, 0, -80], 55],
  ['500 m up', [-200, 500, 300], [300, 0, -150], 55],
  ['150 m up, the east copse 300 m off', [80, 150, 260], [320, 0, 100], 40],
];

export async function farTrees(tag = 'v9_trees', { times = ['midday', 'dusk'], views = VIEWS, w = 760, h = 452 } = {}) {
  const D = window.demo;
  D.timeScale = 0;
  const was = D.look.time;
  const out = [];
  try {
    for (const t of times) {
      time(t);
      const tiles = views.map(([label, p, at, fov]) => [`${t}: ${label}`, cam(p, at, fov)]);
      out.push(await sheet(`${tag}_${t}`, tiles, { cols: 2, w, h, n: 6 }));
    }
  } finally {
    time(was || 'afternoon');
  }
  return out;
}

/** One view, larger, for a close look (index into VIEWS). */
export async function one(tag, i, t = 'midday', { w = 1200, h = 714 } = {}) {
  const D = window.demo;
  D.timeScale = 0;
  const [label, p, at, fov] = VIEWS[i];
  time(t);
  return sheet(`${tag}_${i}_${t}`, [[`${t}: ${label}`, cam(p, at, fov)]], { cols: 1, w, h, n: 6 });
}

/** The same views with the far set off (V8's) and on, side by side (PERF.fartrees flipped through applyPerf). */
export async function farAB(tag = 'v9_trees_ab', { t = 'midday', views = [2, 5, 0], w = 760, h = 452 } = {}) {
  const D = window.demo;
  D.timeScale = 0;
  time(t);
  const set = (on) => async () => {
    D.perf.fartrees = on;
    D.applyPerf();
  };
  const tiles = [];
  for (const i of views) {
    const [label, p, at, fov] = VIEWS[i];
    tiles.push([`${t} V8: ${label}`, cam(p, at, fov), set(false)]);
    tiles.push([`${t} V9: ${label}`, cam(p, at, fov), set(true)]);
  }
  try {
    return await sheet(`${tag}_${t}`, tiles, { cols: 2, w, h, n: 6 });
  } finally {
    D.perf.fartrees = true;
    D.applyPerf();
  }
}

/**
 * One tree of each shape seen from the ground just inside the near distance (105 m: the full tree) and just outside it
 * (115 m: the far version), with a narrow field so it fills the tile: the hand-over should not show.
 */
export async function nearFar(tag = 'v9_nearfar', { t = 'midday', w = 480, h = 360 } = {}) {
  const D = window.demo;
  D.timeScale = 0;
  time(t);
  const F = D.terrain.flora;
  const lone = (s) => F.items.find((it) => it.s === s && F.items.every((o) => o === it || Math.hypot(o.x - it.x, o.z - it.z) > 18) && F.bushItems.every((o) => Math.hypot(o.x - it.x, o.z - it.z) > 8));
  const tiles = [];
  for (const s of [0, 1, 2]) {
    const it = lone(s);
    if (!it) continue;
    // (a side with nothing else within 5 degrees of the line of sight)
    const all = [...F.items, ...F.bushItems].filter((o) => o !== it);
    let a = Math.atan2(it.x, it.z) + 0.6;
    for (let k = 0; k < 24; k++) {
      const b = Math.atan2(it.x, it.z) + (k / 24) * Math.PI * 2;
      const cx = it.x + Math.sin(b) * 115;
      const cz = it.z + Math.cos(b) * 115;
      const clear = all.every((o) => {
        const d = Math.hypot(o.x - cx, o.z - cz);
        const ang = Math.acos(Math.min(1, ((o.x - cx) * (it.x - cx) + (o.z - cz) * (it.z - cz)) / (d * 115)));
        return d > 125 || ang > 0.09;
      });
      if (clear) {
        a = b;
        break;
      }
    }
    for (const d of [105, 115]) {
      const x = it.x + Math.sin(a) * d;
      const z = it.z + Math.cos(a) * d;
      const p = [x, groundAt(x, z) + 2.5, z];
      tiles.push([`${t} shape ${s} at ${d} m (${d < 110 ? 'near' : 'far'})`, cam(p, [it.x, it.y + 5, it.z], 7)]);
    }
  }
  return sheet(`${tag}_${t}`, tiles, { cols: 2, w, h, n: 6 });
}
