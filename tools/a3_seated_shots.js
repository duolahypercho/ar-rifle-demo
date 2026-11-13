// (A3 check) Cut-away pictures of the seated driver or pilot, taken in the game: the player walks in through the
// real entry, and six views are taken with the camera's near plane cutting the door, the other seat or the roof
// away. Needs the sheet receiver (node tools/sheet_receiver.mjs <out dir>, port 5199). After a fresh page load:
//
//   demo.timeScale = 0;
//   const shots = <this function>;
//   shots('car', 'driver_seated').then((r) => (window.__s = r));   // or 'heli'; takes about 25 s, then read window.__s
//
// Returns where the pelvis sits in the vehicle's frame and demo.bodyClearance's crossings per part.
async (kind, tag) => {
  const v = demo.vehicles;
  const veh = kind === 'heli' ? demo.heli : demo.car;
  const p = demo.player;
  const ch = demo.character;
  const V = (x, y, z) => p.pos.clone().set(x, y, z);
  const out = veh.root.localToWorld(V(kind === 'heli' ? 3.2 : -3.2, 0, kind === 'heli' ? -1.0 : 0.6));
  p.pos.set(out.x, 0, out.z);
  p.vel.set(0, 0, 0);
  ch.root.position.copy(p.pos);
  ch.snapToGround();
  for (let i = 0; i < 20; i++) demo.step(1 / 60);
  const t = v.toggle();
  let n = 0;
  while (v.mode !== 'seated' && n < 2400) {
    demo.step(1 / 60);
    n++;
    if (n % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  for (let i = 0; i < 90; i++) demo.step(1 / 60);
  const pel = ch._body.mesh.skeleton.bones.find((b) => b.name === 'pelvis');
  ch._body.mesh.updateMatrixWorld(true);
  veh.root.updateMatrixWorld(true);
  const pl = veh.root.worldToLocal(pel.getWorldPosition(V(0, 0, 0)));
  const W = (dx, dy, dz) => veh.root.localToWorld(V(pl.x + dx, pl.y + dy, pl.z + dz)).toArray();
  const cam = demo.camera;
  const near0 = cam.near;
  const view = (pos, at, fov, near) => () => {
    cam.near = near;
    demo.sheet.cam(W(...pos), W(...at), fov);
  };
  demo.sheet.open(3, 2, 420, 320);
  const shots =
    kind === 'heli'
      ? [
          ['door side, cut 1.15', view([1.7, 0.35, -0.15], [0, 0.25, -0.25], 46, 1.15)],
          ['door side, cut 1.35', view([1.7, 0.35, -0.15], [0, 0.25, -0.25], 46, 1.35)],
          ['inboard side, cut 1.0', view([-1.6, 0.35, -0.15], [0, 0.25, -0.25], 46, 1.0)],
          ['inboard side, cut 1.25', view([-1.6, 0.35, -0.15], [0, 0.25, -0.25], 46, 1.25)],
          ['front', view([0.15, 0.55, -2.3], [0, 0.3, 0], 40, 0.1)],
          ['front high', view([0.5, 1.2, -1.9], [0, 0.2, -0.2], 44, 0.1)],
        ]
      : [
          ['door side, cut 1.05', view([-1.6, 0.4, -0.2], [0, 0.25, -0.3], 46, 1.05)],
          ['door side, cut 1.25', view([-1.6, 0.4, -0.2], [0, 0.25, -0.3], 46, 1.25)],
          ['inboard side, cut 0.9', view([1.5, 0.4, -0.2], [0, 0.25, -0.3], 46, 0.9)],
          ['inboard side, cut 1.15', view([1.5, 0.4, -0.2], [0, 0.25, -0.3], 46, 1.15)],
          ['front', view([0.1, 0.55, -2.1], [0, 0.3, 0], 40, 0.1)],
          ['above, cut 0.85', view([0, 1.6, -0.2], [0, 0, -0.25], 55, 0.85)],
        ];
  for (const [label, place] of shots) {
    // (two settled frames first, then the tile in the same task as its render)
    for (let k = 0; k < 2; k++) {
      place();
      demo.render();
      await demo.renderer.backend.device.queue.onSubmittedWorkDone();
    }
    demo.sheet.tile(label, place);
  }
  await demo.sheet.post(tag);
  cam.near = near0;
  cam.updateProjectionMatrix();
  const c = demo.bodyClearance(kind, { step: 2 });
  return { toggled: t, pelvisLocal: pl.toArray().map((x) => +x.toFixed(3)), clearance: Object.fromEntries(Object.entries(c).map(([k, x]) => [k, [x.crossCm, x.crossBone, x.crossN]])) };
};
