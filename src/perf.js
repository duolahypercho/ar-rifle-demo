// (V4) The frame-time changes, each switchable from the page's address for before / after measurements in one
// sitting: ?v3 turns them all off (the V3 way of drawing), ?perf=-batch,-far,... turns single ones off.
//   batch   merged static meshes and shadow proxies (batch.js)
//   far     each cascade draws only its own casters: layer 0 in the first, the per-part proxies in the first two,
//           the rest-pose proxies in the last two (look.js, batch.js)
//   matrix  the scene's matrices updated once a frame, not in every pass (look.js)
//   scale   at most 1.5 device pixels per CSS pixel (main.js) instead of 2
//   sleep   the parked vehicle nobody uses skips its physics (car.js, heli.js)
// (V7) the new features, each switchable from the address (?perf=-mirrors) or at run time (demo.perf.mirrors = false),
// so before / after can be measured in alternating blocks in one page load (tools/v7_cost.js):
//   mirrors   the car's three mirrors rendered to textures (mirrors.js)
//   damage    dents, scrapes, cracked glass, broken lamps and mirrors (damage.js; off = the car stays new)
//   terrain   the undulating ground off the track, hills on the horizon (terrain.js)
//   flora     grass, trees and bushes (flora.js, V8)
//   sky       clouds with depth (terrain.js)
//   furniture runway and track lights, boards, tyre walls, the wind sock (terrain.js)
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const all = !params.has('v3');
// ((V8) a '+' in the address reads as a space: both are taken as "on", and each name is trimmed)
const off = new Set((params.get('perf') || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('-')).map((s) => s.slice(1)));
export const PERF = {
  batch: all && !off.has('batch'),
  far: all && !off.has('far'),
  matrix: all && !off.has('matrix'),
  scale: all && !off.has('scale'),
  sleep: all && !off.has('sleep'),
  mirrors: all && !off.has('mirrors'),
  damage: all && !off.has('damage'),
  terrain: all && !off.has('terrain'),
  // ((V8) on again: rebuilt (flora.js), the scenery (flora, terrain, sky, furniture) adds 1.3 to 1.9 ms a frame in the four
  // cases (notes/V8_log_entry.md); the main session had switched it off after measuring 65 to 69 ms with it on foot)
  flora: all && !off.has('flora'),
  sky: all && !off.has('sky'),
  furniture: all && !off.has('furniture'),
  // (V9) warm   every pipeline and buffer made under the loading veil (main.js): no first-time stalls on turning
  warm: !off.has('warm'),
  // (V9) adapt  the render scale steps between 1.5 and 1.0 device pixels per CSS pixel to hold 60 frames a second
  //            when the GPU is the limit (adapt.js); off: always the top scale. At run time: demo.adapt.enabled
  adapt: !off.has('adapt'),
  // (V9) fartrees  the far trees' tiered firs and per-tree shade, the far ground's variation and the trees' shade on
  //                it (flora.js, terrain.js); off: V8's far versions and ground. At run time: demo.perf + applyPerf()
  fartrees: all && !off.has('fartrees'),
};
