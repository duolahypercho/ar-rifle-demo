// (A3 check) Peak speeds of the hands, feet, head and pelvis while getting into and out of a vehicle, measured in
// the game at 60 Hz in the vehicle's frame. Paste into the page's console (or the browser tool) after a fresh load:
//
//   demo.timeScale = 0;
//   const speeds = <this function>;
//   JSON.stringify(await speeds('heli'))       // or 'car'; reload the page between the two vehicles
//
// Per phase (enter, exit) and part: speed [m/s, clip time], dv60 [velocity change between two 60 Hz frames, m/s,
// clip time], over [spans of clip time above the limit, with the peak]. Limits: hands 4.5, feet 4.5, head 2.0,
// pelvis 1.8 m/s. For reference the car clips read hands 4.4, feet 4.6, head 1.2, pelvis 1.35 (2026-11-12).
// The dv60 column catches what a 30 fps measure cannot: between two clip frames the game interpolates joint
// rotations, so a limb whose solution changes a lot in one frame leaves the straight line between the two poses
// (heli-enter's left foot was 6.5 cm off it between frames 107 and 108: dv60 7.87 where the 30 fps measure read 4.2).
async (kind) => {
  const v = demo.vehicles;
  const veh = kind === 'heli' ? demo.heli : demo.car;
  const p = demo.player;
  const ch = demo.character;
  const V = () => p.pos.clone();
  const out = veh.root.localToWorld(V().set(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6));
  p.pos.set(out.x, 0, out.z);
  p.vel.set(0, 0, 0);
  ch.root.position.copy(p.pos);
  ch.snapToGround();
  for (let i = 0; i < 20; i++) demo.step(1 / 60);
  v.toggle();
  const bones = ch._body.mesh.skeleton.bones;
  const LIM = { hand_l: 4.5, hand_r: 4.5, foot_l: 4.5, foot_r: 4.5, head: 2, pelvis: 1.8 };
  const B = Object.fromEntries(Object.keys(LIM).map((n) => [n, bones.find((b) => b.name === n)]));
  const res = {};
  const track = (phase, busy) => {
    const rec = [];
    let n = 0;
    while (busy() && n < 2400) {
      demo.step(1 / 60);
      n++;
      if (v.mode === phase) {
        ch._body.mesh.updateMatrixWorld(true);
        const row = { t: v.t };
        for (const [k, b] of Object.entries(B)) row[k] = veh.root.worldToLocal(b.getWorldPosition(V())).toArray();
        rec.push(row);
      }
    }
    const o = { seconds: +(rec.length / 60).toFixed(2) };
    for (const k of Object.keys(B)) {
      let sp = [0, 0];
      let dv = [0, 0];
      const spans = [];
      let open = null;
      for (let i = 2; i < rec.length; i++) {
        const a = rec[i][k];
        const b = rec[i - 1][k];
        const c = rec[i - 2][k];
        const v1 = a.map((x, j) => (x - b[j]) * 60);
        const v0 = b.map((x, j) => (x - c[j]) * 60);
        const s = Math.hypot(...v1);
        const d = Math.hypot(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
        if (s > sp[0]) sp = [+s.toFixed(2), +rec[i].t.toFixed(2)];
        if (d > dv[0]) dv = [+d.toFixed(2), +rec[i].t.toFixed(2)];
        if (s > LIM[k]) {
          if (!open) open = { from: +rec[i].t.toFixed(2), to: 0, peak: 0 };
          open.to = +rec[i].t.toFixed(2);
          open.peak = Math.max(open.peak, +s.toFixed(1));
        } else if (open) {
          spans.push(`${open.from}-${open.to} peak ${open.peak}`);
          open = null;
        }
      }
      if (open) spans.push(`${open.from}-${open.to} peak ${open.peak}`);
      o[k] = { speed: sp, dv60: dv, over: spans };
    }
    return o;
  };
  res.enter = track('entering', () => v.mode !== 'seated');
  for (let i = 0; i < 60; i++) demo.step(1 / 60);
  v.toggle();
  res.exit = track('leaving', () => v.mode === 'leaving' || v.mode === 'seated');
  for (let i = 0; i < 200 && v.mode !== 'foot'; i++) demo.step(1 / 60);
  return res;
};
