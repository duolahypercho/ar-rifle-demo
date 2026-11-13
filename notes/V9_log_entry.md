- 2026-11-13, pass V9: the draw's jolt, frame time and the slow frames (moved ahead of the rest by the main session
  after the user asked "why is it so laggy?"), the feet at the start of each entry, the far trees.
  Load averages are given with every frame-time figure (`uptime`). Packs: `vehicle-motion-tripo-v1` and
  `rifle-motion-tripo-v1` as shipped before this pass (not rebuilt; no Blender used).

  1. DRAW JOLT (done, game side; no clip changed).
     - Cause (measured per frame through the draw after the car exit, `weapon.pivot`, `demo.hands.rPalm`, the skin
       bones): the game, not the clip. In the swap clip the outgoing gun goes on settling into its place on the back
       for about 0.1 s after the right hand lets go: at `slung` (rifle 0.963 s, shotgun 0.837 s) its Gun track is still
       7.2 cm from the stow place ((-0.207, 0.311, -0.209) against (-0.17, 0.25, -0.20) in the chest frame) and reaches it
       only at `handOver`; the track's last frame is exactly the stow place (shotgun too, with its carry shift). The game
       put the gun at the stow place from `slung` on (`handsFree`), so in the draw the gun jumped 7.2 cm in one frame at
       `slung` (8.8 cm/frame of gun speed, 5.24 m/s of change), and the reaching right hand, which is placed relative to
       the real gun, with it (6.7 cm in a frame: 4.09 m/s). The old stow (`demo.gunsCabin`) did the same the other way
       (4.08).
     - Second fault found on the way: the draw switched the right elbow's pole from the clip's elbow to the empty
       hand's at kr = 0.5 (`empty.rElbow = kr < 0.5 ? held.rElbow : null`): the elbow (`lowerarm_r`) jumped about 14
       cm, 17.0 and 17.8 m/s of change in two frames (the chain does not measure elbows).
     - Fix (`src/main.js`): during the stow or draw the gun follows the clip's Gun track for the whole half, not only
       until `slung` (the track ends on the stow place, so the hand-over to the back is exact); the elbow's pole turns
       from the clip's elbow to the empty hand's with the hand's own blend weight.
     - Numbers (60 Hz, world, one frame's velocity change):
       | measure | before | after |
       |---|---|---|
       | draw after the car exit, hand_r (`chainReview('car')` "in drawing") | 4.09 / 4.10 | 1.67 (worst of the draw) |
       | draw, the gun (weapon pivot) | 5.24 | 0.82 |
       | draw, right elbow (lowerarm_r) | 17.78 | 6.36 (the swap clip's own elbow: an on-foot swap reads 6.42) |
       | `chainReview('car')`, worst anywhere | hand_r 4.10 drawing, 4.01 car-enter | hand_r 4.01 in car-enter at 3.85 s (the clip's own move, between the handle and the door grip: no pin active there) |
       | `chainReview('heli')`, worst anywhere | hand_r 4.09 drawing | foot_l 3.19 in heli-exit; nothing over 4 |
       | `chainReview` joins, car / heli | 1.43 / 1.81 | 1.44 / 1.82 (leaving > drawing 1.39 / 1.82) |
       | on-foot swaps (`demo.review`), snap: swap / swapWalk / swapJog / crouchSwap | 2.5 / 2.7 / 2.7 / 2.8, grip 0 / 0 | the same, grip 0 / 0 (code path unchanged) |
       | on-foot swap, world hand_r rifle > shotgun / shotgun > rifle | - | 1.67 / 1.56 (elbow 6.42 / 3.88) |
     - Not met: `car-enter`'s own right hand at 3.85 s, 4.01 m/s (target 4.0; the clip pass's gate allows 4.5). It is in
       the vehicle clip, not the draw; left as it is. The swap clip's elbow (6.4 m/s) is A3's known one.
     - Not verified: the old stow with `demo.gunsCabin = true` was not re-measured (the same code path, forward).

  2. FRAME TIME AND THE SLOW FRAMES (done; moved up by the main session after the user's "why is it so laggy?" and
     "especially when I turn the camera around"). Measured at the full-window size the user plays at (the pane emulating
     1512 x 900 CSS at devicePixelRatio 2: canvas 2268 x 1350) unless said; load average 2.3 to 4.6 all through (quiet;
     the busiest processes were the Claude app and WindowServer). Tool: `tools/v9_cost.js` (new): `turn(case, {rate |
     flick})` turns the view while recording every frame (step, render call, GPU wait) with what happened in it (render
     pipelines and shader modules created and their ms, textures created and uploaded, buffers created and re-uploaded
     with kB, grass refills and tree re-sorts with ms, the instrument canvases redrawn, a fall of the JS heap = a garbage
     collection, renders into targets); `blocks(case)` the main session's blocks of 90 frames with the slowest tenth's
     events against the rest; `real(case, s)` the game's own loop running (frame intervals as the browser schedules them);
     `trace(act, n)` any scripted action. One measured frame = `demo.step(1/60)` + `demo.render()` + GPU done.
     A first finding about measuring: the browser pane's tab was in the background (another tab in front) for the first
     runs; a background tab's GPU work stalls for seconds at a time (frames of 0.5 to 8 s with nothing happening in them).
     Every figure below is with the game's tab in front.

     a. The lag on turning: one-time pipeline builds. From a fresh load, on foot, the first 360-degree turn after loading
        against a second turn straight after it:
        | turn (2268 x 1350) | first turn: frames over 22 ms, worst | second turn: over 22, worst | built during the first turn |
        |---|---|---|---|
        | on foot, 90 deg/s | 18, 104 ms | 0, 7.4 ms | 104 render pipelines, 157 shader modules, 29 textures, 285 buffers (12.5 MB) |
        | on foot, 360 deg/s | 12, 176 ms | 0, 7.4 ms | 92 pipelines |
        | on foot, flick (180 deg in 0.15 s, twice) | 7, 228 ms | 0, 8.1 ms | 80 pipelines |
        | car chase at 200 km/h, 90 deg/s (free look to +-149 deg) | 12, 210 ms | 0, 11.5 ms | 57 pipelines |
        | car chase, then 360 deg/s | 2, 257 ms (the first mirror render: 20 pipelines) | - | - |
        | car chase, then flick | 2, 348 ms | - | - |
        Every slow frame of a first turn was a frame that built pipelines and shaders (the render call's CPU, 12 to 170 ms,
        building the materials' node shaders) and then waited for the GPU to compile them (10 to 205 ms). What turns
        reveal: buildings, trees, the far yard, the vehicles' parts, shadow casters entering a cascade, the car's mirrors.
        Per-turn costs were small: grass refills 60 in a turn at 0.01 to 0.1 ms each (1.6 ms in all), tree re-sorts 34 at
        about 0.05 ms; no chunk-cache thrash (the cache never neared 900 chunks while turning in place).
        Fix (`src/main.js`, end of loading, `PERF.warm`): one frame drawn under the loading veil with nothing culled
        (every mesh in the pre-pass, the lit pass and the four cascades), each car mirror once, what the game shows later
        made visible for that frame (the effects' pools, the wheels' blur, anything hidden that is not a merged original
        and holds no light: a light joining the scene would rebuild every material, as the main session found with the
        flash), and the helicopter's blades drawn both opaque and faded (the spin-up turns their material transparent).
        Loading takes about 1.5 s longer (warm-start to warm-end 1.5 to 1.6 s). After, same tests, fresh loads:
        | turn (2268 x 1350) | first turn after load: over 22 ms, worst | second | built during the turns |
        |---|---|---|---|
        | on foot, 90 deg/s | 0, 15.6 ms | 0, 8.8 ms | nothing |
        | on foot, 360 deg/s | 0, 8.2 ms | 0, 9.0 ms | nothing |
        | on foot, flick | 0, 8.8 ms | - | nothing |
        | car chase, 90 deg/s | 0, 10.5 ms | 0, 11.8 ms | nothing |
        | car chase, 360 deg/s / flick | 0, 17.5 ms / 0, 9.2 ms | - | nothing |
        Other first-use moments, after the change: the first burst of fire worst 11.3 ms (2 pipelines; 18.8 ms before the
        effects were warmed), reload and swap 7.0 ms; getting into and out of the car the first time 12.0 / 12.4 ms,
        the helicopter 17.6 / 11.6 ms (nothing built); the helicopter's quick start and lift-off 14.3 ms worst (before:
        596 ms the first time on this machine and 31 ms once the browser's shader cache had it, at 3.9 s when the blades
        turn transparent, and 27 to 32 ms at 4.05 s for the rotor disc).
     b. The light list (the main session's find, its fix in fx.js): every material's shader carries every light in the
        scene. The five lights other than the sun (the flash, the car's two headlamps, the helicopter's beacon and
        landing light) cost 0.7 ms a frame on foot at 2268 x 1350 when dark (blocks of 90, alternated three times: 6.5 to
        6.7 ms with them, 5.9 to 6.0 without; GPU 3.9 -> 3.5, CPU 2.0 -> 1.8). Changing the light set rebuilds everything:
        15 s the first time (a frame of 15 081 ms) and 0.35 to 0.46 s each time after, so they were not taken out at
        run time; nothing else in the code adds or removes a light or hides an object holding one (the headlamps, beacon
        and landing light change intensity only).
     c. Every frame, three's WebGPU renderer re-uploads any buffer marked DynamicDrawUsage in every pass that draws it,
        whether it changed or not: the trees' three instance buffers (47 kB each), the skid marks (192 kB), the effects'
        clouds and the cones: 13 uploads and 332 kB a frame on foot. Now static, uploaded when they change: a 4 s turn
        972 uploads / 13 MB (was 3370 / 98 MB). (`src/flora.js`, `src/car/car.js`, `src/cloud.js`, `src/world.js`)
     d. The slow frames in the vehicles: not reproduced with the tab in front. Blocks of 90 x 5 at 2268 x 1350: car chase
        at 200 km/h median 7.2, p95 8.7, worst 19.4 ms; cockpit 7.4 / 8.9 / 17.6; no frame over 22 ms. The slowest tenth
        had the cluster's canvas redrawn and uploaded twice as often as the rest (46 to 51 % of those frames against 22 %:
        about +1 ms of GPU on those frames) and, in the chase at 200 km/h, the tree re-sort (56 % against 15 %, 0.05 ms of
        CPU each). The main session's p95 of 35 to 51 ms came from first-use builds in its blocks and, likely, the same
        background-tab stalls.
     e. What dominates, case by case (2268 x 1350, blocks, median ms: step / render call CPU / GPU wait): on foot 0.7 /
        2.1 / 4.5; car chase 0.7 / 2.4 / 4.2; cockpit 0.7 / 2.6 / 4.5; helicopter hovering at 97 m, chase 0.5 / 3.7 / 4.9,
        cockpit 0.5 / 3.6 / 4.8. The GPU is the larger part everywhere; in the game's own loop the CPU and GPU overlap and
        every case ran at the display's 120 frames a second (intervals median 8.3 ms, p95 10.3, worst 10.4, CPU 2.8 to
        3.7 ms a frame). Interleaved on foot at the yard's edge (60 rounds): all on 5.7 ms (GPU 3.7, CPU 1.7); render
        scale 1.0 instead of 1.5: 4.1 ms (GPU 2.0); the plain picture (G, no post chain) 3.9 ms (GPU 2.8, CPU 0.9): the
        post chain is about 0.9 ms of GPU and 0.8 ms of CPU at this size; the car's 1200 Hz physics is in the step (0.7 ms
        with everything else).
     f. Adaptive render scale (`src/adapt.js`, new; `PERF.adapt`, `?perf=-adapt`, `demo.adapt.enabled`): the scale steps
        by 0.1 between 1.5 and 1.0 device pixels per CSS pixel when the GPU is what holds the frame back (its time, from
        `onSubmittedWorkDone` after each submit, over 13.5 ms and over the CPU's, or frames slower than 54 a second while
        the GPU is the larger part, for 0.5 s; at most one step a second), and back up when it has room (under 8 ms and
        frames on time for 3 s; one step every 3 s); a CPU-bound frame never lowers it. A step costs one frame of about
        13 ms here (render targets re-made), no slow frame. Checked with 12 ms of GPU time added by hand
        (`demo.adapt.fakeGpu`): 1.5 -> 1.0 in five steps a second apart, and back to 1.5 in five steps three seconds apart
        once the load went. On this machine at 2268 x 1350 it never steps down by itself (GPU 4 to 5 ms).
     g. Frame-time readout: the ` key (left of 1; free in every mode, never B), in the top-right panel: fps, the frame
        interval (mean and worst over the last second), CPU and GPU ms, the render scale and the canvas size.

  3. FOOT GLIDE AT THE START OF EACH ENTRY (done, game side).
     - Measured per frame (the balls of the feet in the world and `vehicles.stats.contact` from the hand-over on): the car
       had none (walk end: root 0 cm, feet 0 cm; contacts 0.00 cm from the clip's first frame on; the balls moved 0.00 cm
       across the hand-over). The helicopter: contacts foot_l 1.91 / foot_r 2.51 cm on the first frame, falling to 0 by
       0.15 s, while the balls moved only 0.01 to 0.04 cm a frame sideways: the glide was DOWNWARD. The helicopter at rest
       sits 5.5 cm lower than the ground under it (its root at y -0.055: the skids settle), and the clips' ground contacts
       are on the vehicle's ground plane (its root's y = 0): the clip pinned the feet 5.3 cm into the ground; at the
       hand-over the walk's planted feet (on the real ground) sank there over the join while the hips came down. The
       same 5 cm stood under the whole of the ground phase of heli-enter and heli-exit, and at the end of heli-exit the
       body rose 5 cm over 0.5 s after the hand-over to the draw. It is also what the chain's foot-drift measure read as
       47 to 63 cm of "drift" in heli-enter (the swinging feet passed within 1.5 cm of a ground they were under).
     - Fix (`src/vehicles.js`): through an entry or exit clip's ground phase (from its start to when both feet are on
       the vehicle, or from before the first foot reaches the ground to its end, read from the clip's ground contacts),
       the clip stands on the real ground: the character's root and the ground contacts' points are raised (or lowered)
       from the vehicle's ground plane onto `groundAt`, eased in or out over 15 frames (0.5 s) while the feet are on the
       vehicle (the skid). The contact measure uses the same points. The car sits on its plane: nothing changes there.
       And (`src/inertia.js`) a foot the hand-over blend holds planted is held for the whole blend: it was let go at once
       when it rose 3 cm into a step, and jumped to where the blend's offset had it (with the exit now ending on the real
       ground, heli-exit > draw read 2.9 m/s at the right foot before this second change).
     - Numbers (before -> after; Tripo unless said):
       | measure | before | after |
       |---|---|---|
       | heli-enter contacts, worst over the clip (`demo.enterExit('heli')`) | foot_l 1.91 to 2.2, foot_r 2.51 to 2.6 (first 0.15 s) | foot_l 0.10, foot_r 0 |
       | heli-enter, first frame of the clip | 1.91 / 2.51 cm | 0 / 0 cm |
       | the balls of the feet across the hand-over | sank 2.6 to 2.9 cm in 0.15 s | 0.05 cm in the first frame, then under 0.02 a frame |
       | heli-exit contacts | 0 | 0 |
       | car-enter / car-exit contacts | foot_l 0.58 / 0.44 (later in the clip), first frame 0 | unchanged |
       | `chainReview('heli')` walking > entering | 1.49 (foot_l), 1.08 (foot_r) | 0.63 |
       | `chainReview('heli')` leaving > drawing | 1.82 (foot_r) | 0.56 |
       | `chainReview('heli')` planted-foot slide per frame / drift | 6.3 / 63 cm (in entering) | 0.75 / 1.31 cm |
       | `chainReview('car')` walking > entering / leaving > drawing | 0.63 / 1.43 | 0.63 / 0.63 |
       | EarthOnline (`showBody(1)`), heli-enter / heli-exit contacts | - | 0 / 0.02 cm |
       | EarthOnline `chainReview('heli')` joins / walking > entering / leaving > drawing | - | 1.93 (drawing > foot, left hand) / 0.63 / 0.57; nothing over 4 |
       | EarthOnline `chainReview('car')` joins | - | at most 1.65; nothing over 4 |
       (Root jumps at the joins 0.01 to 0.18 cm, as before.)
     - Seen but not changed: the walk to the car's door slides a planted foot during its last settle: the chain's slide
       measure read 0.8, 8.4, 5.0 cm of drift "in walking" over three Tripo runs and 4.5 cm for the EarthOnline body (the
       hand-over itself 0 cm). Not chased (time).
     - Not looked at in pictures: the feet at the hand-over were judged by numbers only.

  4. FAR TREES AND THE FAR GROUND (done; a far mesh, not an impostor).
     - Looked at first (`tools/v9_shots.js` `farTrees`: two views from the ground at 160 to 250 m, four from 100, 150, 250
       and 500 m up, at midday and dusk; sheets in the scratchpad's `a3check/`): `v9_trees_before_midday.jpg`,
       `v9_trees_before_dusk.jpg`. The far firs were smooth teal cones (from the ground and from 100 to 150 m up the
       plainest thing in the picture); the far broadleaves seven-blob lumps; the ground beyond the grass one tan-to-green
       wash in 60 to 170 m blotches; no tree beyond the near cascades (45 m on foot, 100 m in the helicopter's chase view)
       had a shadow, so from the air every far tree floated on the ground.
     - Why not an impostor: from the helicopter the far trees are seen from above as much as from the side, so a side-view
       atlas would need many elevations (or an octahedral layout), and a baked picture keeps one sun: the times of day
       and the moving sun would need normal and albedo atlases relit in the shader. A far mesh built from the near tree's
       own parts reads from every side and is lit like the near one, for 0.1 to 0.4 ms (below).
     - Changed (`src/flora.js`): the far fir is the near fir's eight tiers as jagged drooping skirts (alternate tips and
       gaps, each segment its own tint, dark at the trunk, lighter at the tips) over the near tree's dark inner cone, 89
       triangles (V8's cone 58); the far broadleaf is the near crown's own clusters (fifteen outer ones, which make the
       outline, and three inner), each a lumpy blob half again as big as the near spray, some darker, on the trunk and the
       boughs' first halves, about 400 triangles (V8: 150). Every tree (near and far, so the hand-over at 110 m keeps it)
       has its own shade (0.85 to 1.15) and hue (warmer or bluer) from its hash. The shadow proxy keeps V8's far shapes.
       (`src/terrain.js`) the ground's colour: two octaves of a tiling value noise (61 m and 17 m across) from greener and
       darker to drier and lighter (-25 to +15 %), a tree map (1024 x 1024 over +-1024 m, drawn once from where the trees
       and bushes stand) darkening the ground round each crown and copse (a soft footprint 1.6 x the crown, up to 32 %),
       and, past the near cascades' reach (fading in from 60 to 110 m from the camera, where the trees' own shadows stop),
       each crown's shadow cast away from the sun by a 5 m crown height (at most 25 m; weaker as the sun gets low; the
       time of day sets it through `terrain.light`, now given the sun's direction by main.js).
       Switch: `PERF.fartrees` (`?perf=-fartrees`, or `demo.perf.fartrees = false; demo.applyPerf()`): V8's far versions
       (kept, sharing the same instances: one of the two is drawn) and V8's ground.
     - Pictures after: `v9_trees_after_midday.jpg`, `v9_trees_after_dusk.jpg` (the same six views);
       `v9_trees_ab6_midday.jpg` / `v9_trees_ab4_midday.jpg` (V8 and V9 side by side, the same frames: 100 m up, 150 m up
       with the east copse, the ground view), `v9_trees_ab3_dusk.jpg`; the near / far hand-over at 105 and 115 m for each
       shape, `v9_nearfar7_midday.jpg`, `v9_nearfar7_dusk.jpg`. Seen: from the ground the far firs read as firs (tiers,
       a dark core) and the broadleaves keep their crowns' outline; from 100 to 150 m up the firs are dark tiered firs,
       not cones, the copses carry their shade and shadow and the ground is mottled at the 20 to 60 m scale instead of one
       wash; at 250 to 500 m the trees are specks in both versions (the haze); at dusk both read as dark silhouettes.
     - Not as good as wanted: the hand-over at 110 m still shows: at 105 m the near fir reads as a dark slim cone (its
       thin branch strips are edge-on and sub-pixel) and at 115 m the far fir shows its tiers more clearly and a little
       lighter; the near broadleaf's leafy edge becomes the far one's smoother lumps. The far ground is still one hue
       family (no fields, paths or rock).
     - Cost, interleaved (`tools/v8_cost.js` `inter`, 80 rounds, off / off (A/A) / on, 2268 x 1350, load average 3.1 to
       4.5): on foot at the yard's edge (173 far trees): 7.0 / 7.1 / 7.0 ms, paired +0.1 [-0.8, 0.9], GPU 3.1 -> 3.3;
       the helicopter's chase view (421 far trees): 11.2 / 11.1 / 11.6 ms, paired +0.3 [-0.6, 2.0] against the A/A's +0.2
       [-0.8, 1.4], GPU 4.3 -> 4.7. Draw calls unchanged (one far set is drawn either way).

  5. FINAL MEASURES (frame time; one frame = step + render + GPU done, blocks of 90 x 3, median / p95 / worst ms; the
     split is step / render-call CPU / GPU wait; load average 2.3 to 4.6 throughout, under 15 every time it was read).
     a. With the game's tab in front and the pane shown (10:32 to 10:52; the warm-up and the buffer change in; before
        the far trees, which cost 0.1 to 0.4 ms interleaved, and the helicopter ground lift, which is not in these cases):
        | case, 2268 x 1350 (full window) | blocks | split | the game's own loop |
        |---|---|---|---|
        | on foot | 7.6 / 10.1 / 19.2 | 0.7 / 2.1 / 4.5 | 120 fps, interval 8.3 / 10.3 / 10.4, CPU 2.8 |
        | on foot, turning 180 deg/s | - | - | 120 fps, 8.3 / 10.1 / 10.4, CPU 3.0 |
        | car chase, 200 km/h | 7.3 / 10.8 / 27.0 (1 frame over 22: the cluster's upload and a GC) | 0.7 / 2.4 / 4.2 | 120 fps, 8.3 / 10.2 / 10.4, CPU 3.3 |
        | car chase, turning 90 deg/s | - | - | 120 fps, 8.3 / 10.1 / 10.4, CPU 3.6 |
        | car cockpit | 7.7 / 9.1 / 16.9 | 0.7 / 2.6 / 4.5 | 120 fps, 8.3 / 10.2 / 10.4, CPU 2.9 |
        | helicopter hovering at 97 m, chase | 9.2 / 10.3 / 19.8 (a second load 8.7 / 10.3) | 0.5 / 3.7 / 4.9 | 120 fps, 8.3 / 10.3 / 10.4, CPU 3.7 |
        | helicopter, cockpit | 8.9 / 9.9 / 20.0 | 0.5 / 3.6 / 4.8 | - |
        (Longer runs: car chase 90 x 5: 7.2 / 8.7 / 19.4; cockpit 7.4 / 8.9 / 17.6.) Targets (median at most 16.7, p95 at
        most 22 in the vehicles): met in every case, with the adaptive scale on or off: on this machine it never left 1.5
        (the GPU needs 4 to 5 ms), so on and off are the same frames; what it buys under a slower GPU is 1.5 -> 1.0 = 2.25 x
        fewer pixels (on foot, interleaved: GPU 3.7 -> 2.0 ms, frame 5.7 -> 4.1 ms).
     b. Final code (11:13 to 11:22), the pane HIDDEN by then (the app showed another panel; the page's animation frames
        stopped, so the game's own loop could not be measured, and a hidden page's CPU work read 0.5 to 2 ms slower than
        in (a): the same code with every V9 switch off read the same as with them on in this state, 11.5 against 12.0 ms
        in the helicopter's cockpit):
        | case | 2268 x 1350 (full window) | 1536 x 1152 (the 1024 x 768 pane) |
        |---|---|---|
        | on foot | 6.4 / 8.7 / 10.5 (0.4 / 2.7 / 3.3) | 7.4 / 10.3 / 16.8 (0.8 / 4.2 / 2.3) |
        | car chase | 7.7 / 9.8 / 13.3 (1.0 / 2.8 / 3.8) | 9.3 / 13.1 / 20.5 (2.3 / 4.2 / 2.6) |
        | car cockpit | 8.1 / 10.0 / 13.4 (0.8 / 2.9 / 4.0) | 9.9 / 14.1 / 21.7 (2.1 / 4.4 / 2.6) |
        | helicopter chase | 11.8 / 15.7 / 21.7 (1.2 / 5.8 / 4.5) | 10.4 / 13.8 / 19.0 (1.2 / 5.5 / 3.3) |
        | helicopter cockpit | 12.0 / 15.0 / 19.7 (1.2 / 5.6 / 4.8) | 10.3 / 13.6 / 16.6 (1.2 / 5.3 / 3.4) |
        No frame over 22 ms in any block at either size. The GPU's share grows with the pixels (2.3 to 3.4 ms at 1536 x
        1152, 3.3 to 4.8 at 2268 x 1350, 1.7 times the pixels); the CPU's does not.
  6. Regression: `demo.review` (idle 0.6, walk 1.7, jog 2.0, aimHold 0.9 frozen 5, burst 0.9, reload 1.2, swap 2.5,
     crouchIdle 0.0, rampUp20 2.7 sink 0.1, stairsUp 2.4 to 2.6 sink 0.4 to 1.2, grip 0 / 0 everywhere; stairsUp on the
     same load with every V9 switch off: 2.5 to 3.3, sink 1.0: the stairs' toe touch is the run's own, not this pass's);
     on-foot swaps as before (item 1). `node --test test/dynamics.test.js` 8 pass, `test/hands.test.js` 4 pass.
     `demo.vehicleReview()` and `demo.heliReview()` not run (no physics changed).
  7. Files. New: `src/adapt.js`, `tools/v9_cost.js`, `tools/v9_shots.js`, `notes/V9_log_entry.md`. Changed:
     `src/main.js` (the stow / draw gun track and elbow, the warm-up, the frame meter and the ` key, the sun's direction
     to the terrain), `src/vehicles.js` (the clips on the real ground), `src/inertia.js` (held feet through the blend),
     `src/flora.js` (far firs and broadleaves, per-tree shade, the far switch, static buffers), `src/terrain.js` (far
     ground noise, tree map, cast shadows, the switch), `src/perf.js` (`warm`, `adapt`, `fartrees`), `src/cloud.js`,
     `src/world.js`, `src/car/car.js` (static buffers), `index.html` (the readout's row, the key hint), `README.md`
     (controls row, "Vehicles, pass V9"). `src/audio.js` and the voice lines untouched; no Blender, no assets, no
     packages; `public/` unchanged. The main session's own edits to `src/fx.js` and `src/main.js` (the flash light,
     'entering' in the guns-away hide) were kept as they were.
  Not verified: the final code's frame time with the pane shown (the pane was hidden from about 11:13 to the end);
  the game's own loop at 1536 x 1152; a real person's 60 Hz display (this pane runs at 120); the adaptive scale on a
  GPU-bound machine (only with GPU time added by hand); the far trees from the car's chase view at speed and at night;
  the old stow (`demo.gunsCabin`); the walk's settle slide to the car's door (0.8 to 8.4 cm over runs, not chased);
  first use of the plain picture (G) and a body switch (N) still build their pipelines when first used.
