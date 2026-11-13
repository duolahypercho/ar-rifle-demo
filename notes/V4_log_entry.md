- 2026-11-12, pass V4: frame time, the guns while getting in, rotor wash, the small leftovers.
  Method throughout (`tools/v4_cost.js`): one frame = `demo.step(1/60)` + `demo.render()` + `await
  device.queue.onSubmittedWorkDone()`, the game's own animation loop held while measuring (with it running, as in the
  main session's check, it draws an extra frame whenever the browser asks while the measured one waits), blocks of 90
  frames, three blocks pooled (270 frames), a quarter second between blocks. Cases (`setupCase`): on foot in the yard
  (third person, looking north over the range), the lap's main straight at 200 km/h in the chase view (pure pursuit on
  the centre line), the same in the cockpit view, the helicopter at 100 m and 150 km/h (chase). Before = the same code
  with `?v3` (every V4 change off: no batching, no proxies, no layer split, matrices in every pass, full pixel ratio, no
  sleeping); same sitting, page reloaded between the car and the helicopter. The machine was shared all the time
  (load average 36 to 42 on 18 cores, another agent's Blender and Node jobs, frames of 100 to 1200 ms in both
  modes): medians move by up to 2x between blocks; p95 is mostly other processes.
  1. Frame time, before -> after (ms, median / p95; draw calls; triangles):

     | case | V3 set A | V3 set B | V4 set A | V4 set B (3 runs) | draws | triangles |
     |---|---|---|---|---|---|---|
     | on foot | 33.8 / 64.1 | 46.0 / 161.8 | 20.2 / 48.8 | 15.8 / 46.4; 17.0 / 58.1; 9.2 / 17.1 | 1320 -> 194 | 756,755 -> 656,675 |
     | car chase 200 km/h | 32.7 / 65.0 | 35.2 / 47.6 | 19.2 / 48.3 | 17.3 / 36.1; 12.7 / 18.4; 19.6 / 57.7 | 1289 -> 171 | 1,039,036 -> 920,446 |
     | car cockpit | 23.4 / 30.1 | 28.9 / 39.8 | 10.7 / 44.5 | 13.1 / 78.1; 10.1 / 15.9; 12.6 / 43.1 | 1094 -> 132 | 915,784 -> 884,928 |
     | helicopter 100 m 150 km/h | 45.2 / 65.5 | 43.1 / 111.4 | 13.8 / 21.7; 14.6 / 19.3 | 24.3 / 81.7; 15.1 / 81.4 | 1630 -> 224 | 1,286,690 -> 1,130,536 |

     (Set A about 23:58 to 00:05, set B 00:45 to 00:55. Canvas 2048 x 1536 before, 1536 x 1152 after.) Target (median
     <= 16.7, p95 < 22): met in quiet blocks in all four cases (foot 9.2 / 17.1, car 12.7 / 18.4, cockpit 10.1 / 15.9,
     helicopter 13.8 / 21.7 and 14.6 / 19.3); medians over 16.7 in the loaded blocks for the car chase (17.3, 19.6) and
     on foot (17.0, 19.1, 21.0) and p95 over 22 in most loaded blocks. Not met reliably on this machine as it was;
     V4 is 2.0 to 3.1 x faster than V3 in every same-sitting pair.
     Split (median ms: step / render call CPU / GPU after submit), set B: car V3 2.1 / 25.2 / 6.9 -> V4 2.0 / 8.2 /
     5.8 (quiet 1.9 / 7.1 / 3.3); cockpit 2.1 / 20.0 / 5.8 -> 1.9 / 6.7 / 3.8; foot 2.3 / 30.8 / 8.3 -> 1.0 / 9.0 / 6.5;
     helicopter 2.0 / 29.7 / 9.8 -> 1.1 / 8.6 / 5.2.
     Per pass (CPU ms exclusive / draw calls, `passes: true`; V3 set A, V4 final code):
     | pass | foot V3 | foot V4 | car V3 | car V4 | cockpit V3 | cockpit V4 | heli V3 | heli V4 |
     |---|---|---|---|---|---|---|---|---|
     | cascade 1 | 1.3 / 58 | 0.3 / 15 | 5.2 / 131 | 0.5 / 14 | 4.4 / 131 | 0.5 / 14 | 6.6 / 131 | 0.7 / 19 |
     | cascade 2 | 3.4 / 189 | 0.3 / 28 | 3.6 / 142 | 0.3 / 13 | 2.7 / 132 | 0.3 / 13 | 5.5 / 228 | 0.7 / 33 |
     | cascade 3 | 2.7 / 320 | 0.1 / 8 | 2.2 / 189 | 0.2 / 7 | 2.0 / 169 | 0.2 / 5 | 3.0 / 428 | 0.4 / 13 |
     | cascade 4 | 3.7 / 420 | 0.1 / 14 | 3.8 / 420 | 0.2 / 14 | 3.2 / 420 | 0.2 / 14 | 3.1 / 428 | 0.2 / 14 |
     | pre-pass | 4.9 / 158 | 1.8 / 56 | 6.4 / 189 | 2.5 / 51 | 4.7 / 106 | 2.7 / 34 | 6.7 / 195 | 2.2 / 63 |
     | lit pass | 4.1 / 159 | 1.9 / 57 | 6.3 / 208 | 1.9 / 58 | 3.8 / 117 | 1.8 / 39 | 4.6 / 214 | 1.7 / 70 |
     The post chain (GTAO, denoise, TRAA, motion blur, bloom 12 small passes, output): 0.0 to 0.3 ms CPU each, 17 draws,
     unchanged. GPU per pass could not be measured: with `?gputime` (three's timestamp queries) this GPU reports about
     7.9 ms for every small quad pass, more than the whole frame's wall time (three 0.187 also shares one
     timestampWrites object between pass descriptors: `v4_cost.js` copies it per pass; the readings stayed absurd).
     By ablation instead: the GPU's tail after the last submit is 6.1 ms at 2048 x 1536, 4.3 at 1024 x 768, about the
     same with the sun's shadows off (-0.5) or the whole post chain off (plain); removing 290 k shadow triangles (the
     vehicles' far proxies) changed nothing measurable. Pipelined (no wait per frame) the frame was 11.8 to 12.7 ms with
     10 ms of CPU: CPU-bound.
     What took the time: three's per-object work in every pass (node uniform updates 1.5 ms, bindings 2 ms, the
     object / geometry / pipeline lookups and the draw itself, about 13 to 25 us per draw call when quiet, 50 when
     loaded), times 1100 to 1800 draws a frame, 420 of them shadow casters drawn again in each cascade (cascade 4 drew
     every caster in the world, 420).
     What each change bought (draws a frame, car chase unless said):
     - World static meshes merged per material (`batchWorld`, the yard's boxes, ramps, rails, stripes, buildings with
       doors, plant, boards, kerbs and lines; 260 meshes -> 19 merged + singletons); originals out of the scene, still in
       `fx.colliders` (a bullet mark on one goes on the scene); on foot 1320 -> 407 with the shadow proxies below.
     - Shadow proxies (depth-only meshes on their own layers, `batch.js`): the world in 80 m patches for the first two
       cascades and 400 m patches for the last two; each vehicle one skinned proxy (first two) and one rest-pose proxy
       (last two); each rotor's blades one proxy; layer 0 (the body, loose cases and magazines) in the first cascade
       only. Cascade 4: 420 -> 14 draws, cascade 3: 189 -> 7.
     - Vehicles as one rigid skeleton: every moving node (doors, suspension, steering, wheels, steering wheel, seat;
       the helicopter's doors, cyclic, collective, pedals) is a bone; each material is one skinned draw for the whole
       vehicle (car 106 -> 23, helicopter 86 -> 30 of which 16 are the rotors and the pilot's seat, kept as they were).
       The skinned meshes hang from the scene, not the vehicle: under the moving vehicle the velocity pass compared the
       previous frame's bones with this frame's bind matrix and the whole car smeared at speed (seen in the first after
       sheet, fixed). Culling on the rest sphere + 1 m, moved with the vehicle each frame.
     - Guns (merged except magazine, charging handle, trigger, pump; 24 -> 14 a pass), the belt kit (one material per
       colour; 10 -> 4), the target frames (legs, feet, bars into the world; chains one per target).
     - Scene matrices updated once a frame, not in each of the pre-pass, lit pass and post passes.
     - The parked vehicle nobody is in sleeps once settled: no flight model (1.2 ms a frame for the cold helicopter on
       the pad: 8 sub-steps, 26 ground contacts), no car physics, no re-placing of their nodes.
     - Tyre smoke, dust and rotor wash: one instanced sprite each (`src/cloud.js`) instead of one draw per puff (a
       handbrake slide put about 100 sprite draws in a frame).
     - Render scale: at most 1.5 device pixels per CSS pixel: 2048 x 1536 -> 1536 x 1152 (1.78 x fewer pixels), GPU
       tail 6.2 -> 3.7 ms in the same page, alternating.
     Not done, with reasons: the vehicles' `_lod1` / `_lod2` (draw calls were the cost, not triangles: 290 k fewer
     shadow triangles measured no change); far cascades every second frame (cascades 3 and 4 now cost 0.1 to 0.2 ms CPU
     each); taking zero-intensity lights out of the light list (the car's beams, the landing light, the beacon flash:
     each change of the light set recompiles every lit shader, which V3 measured at 1 to 17 s).
     Nothing renders twice: the merged originals are hidden (vehicles, guns: `visible = false`, or off the view's
     layer when they carry child nodes; bodyClearance still reads them) or out of the scene (world); 380 hidden smoke and
     dust sprites are gone from the scene (two instanced sprites).
  2. What was lost (pictures in the scratchpad's `sheets/`: `v4_cmp_cases.jpg` foot, chase, cockpit with crops,
     `v4_cmp_heli.jpg`, `v4_cmp_parts_car.jpg` doors open and wheels steered from four sides, `v4_cmp_parts_heli.jpg`,
     `v4_zoom_car_edge.jpg`): the render scale. The crops (the same quarter of the picture, at screen size) are softer
     after; high-contrast edges show more stair steps at 2x zoom (the car's rear crease, the engine cover's slats); from
     100 m up, thin far road paint and the skidpad's dashes break up (`v4_cmp_parts_heli.jpg` view 4). Everything else
     matches tile for tile: the car with both doors open and the wheels steered, its shadow with the doors, the
     helicopter with its doors open, the rotor shadow, buildings' shadows. Revert with `?perf=-scale`.
  3. Leftovers.
     a. `car-exit`: not shipped. The pack was re-shipped at 00:38:26 (`public/characters/vehicle-motion-tripo-v1.*`,
        2.08 -> 2.26 MB, still 16 clips, no car-exit): getting out of the car is still the placeholder. Of the three
        enter / exit clips only car-enter changed in the game's measures (heli-enter and heli-exit gave the same numbers
        to 0.02 cm). New car-enter on the clip path (`v4pack_enter_car.jpg`, `v4pack_exit_car.jpg`): contacts foot_l
        0.58, foot_r 0.06, hands 0 cm, root step 2.11 cm; crossings seat 12.6 (head, 7.0 s), wheel 4.5 (right forearm,
        5.75 s), door 2.8 (fingers, 1.5 s), body shell 2.2 (thumb, 5.0 s), interior 7.1 (ball_r, 5.75 s); against the
        23:14 clip below: door 5.6 -> 2.8, body shell 3.3 -> 2.2, wheel 5.5 -> 4.5, seat 11.2 -> 12.6 (the head now, the
        clavicle before). With it the guns still go to the cabin at f71 and stay at 0 cm against every part
        (`v4pack_entryguns_car_L.jpg`). The numbers below are the 23:14 pack's, measured before the re-ship.
        `demo.enterExit` re-run on the final code: car-enter (clip) contacts foot_l 0.43, foot_r 0.01, hands 0 cm, root step
        1.59 cm, crossings seat 11.2 (clavicle_l, 7.0 s), wheel 5.5, door 5.6, body shell 3.3, interior 7.0 (ball_r);
        car exit (placeholder) seat 24.2, interior 24.0, body shell 12.8, door 10.5; heli-enter feet 0.28 / 1.13, hands 0,
        seat 7.6, door 8.4 (thigh_r at 2.75 s), cyclic 2.9, collective 2.5; heli-exit feet 0 / 0.01, hands 0, seat 21.9,
        cyclic 9.1, fuselage 7.8, interior 7.5 (sampled every 15 frames; V3 sampled every 10 or 12, so single maxima
        differ). Sheets `v4_enter_car.jpg`, `v4_exit_car.jpg`, `v4_enter_heli.jpg`, `v4_exit_heli.jpg`.
     b. Guns while getting in (`gunsInCabin` in main.js): car: to the cabin at the frame the body's back turns to the
        cabin (back axis within 45 degrees of inboard: f71, t 2.37 s), before the shotgun reaches the door (f93) and the
        sill (f153); helicopter: once the pilot has turned to sit, his back to the seat's, inside the doorway (f169;
        switching when the hips pass the doorway, f91, showed the guns vanish off the back in full view of the entry
        side); out: back on the back when the hips are 0.4 m outside the doorway. Gun vertices against the car's parts
        through car-enter (every 3rd vertex, every 3rd frame, V2's depth): V3's rule door_L 6.7 cm (f140, shotgun),
        seat_driver 5.2 (f182), interior 10.5 (f150, rifle), body_shell 7.0 (f155); V4: 0 for every part. Pictures:
        `v4_entryguns_car_L.jpg` (driver's side: the guns are behind the turning body when they go),
        `v4_entryguns_car_R.jpg` (passenger side: they appear on the passenger seat through the glass at f72 while the
        driver is still outside: the cost of no hand-off clip), `v4b_entryguns_heli_R.jpg`. The helicopter's gun depth
        through heli-enter was not measured.
     c. Rotor wash: what was there (V2's `_wash`) emitted 139 sprites at 2 m over dirt and nothing showed
        (`v4_wash_hovers.jpg`): dirt-coloured, unlit, at most half opaque, thrown at 4 m/s. Rebuilt in `Heli._wash`: the
        induced velocity (9.9 m/s in the 2200 kg hover) as a wall jet under the disc's edge falling off as 1/r, dust
        lifted there, lit as the sun and sky light it, rolling up and hanging where the jet has slowed, the wake's foot
        trailing the motion; 260 puffs/s over dirt and 90 over paving at full strength; strength = thrust / weight x the
        fade of the hub's height from a quarter to one rotor diameter (as before). Hover (`v4b_wash_hovers.jpg`): dirt 2.2 m
        strength 0.91, 479 puffs, mean 11.9 m from the hub's foot, farthest 20.3, outward 4.1 m/s mean (all live puffs);
        5.1 m 0.33, 205 puffs; 10 m none. Helipad edge: 2.2 m 192 puffs (thin grey haze), 5.1 m 71, 10 m none. Lift-off
        from dirt (`v4b_wash_liftoff.jpg`): T/W 0.35 -> 44 puffs, 0.87 -> 311 and a visible cloud, 1.21 at the skids
        leaving -> a full brown-out round the aircraft, at 10.7 m strength 0 and the cloud drifting. No grass reacts:
        there is no grass geometry (the ground is a shaded plane).
     d. Small ones.
        - Seated soles: the pedal points are the soles under the balls (the pack's 'ball' contacts); the seated layers
          (heli `seat.js` legs, car `seated.js` legs) now put the joint the body's ballSole (1.66 cm) above them, as the
          clip path does. heliReach now measures the sole (joint + ballSole), not the joint: 0.0 cm at all 11 positions.
        - Cyclic hand: with the stick centred it stays hidden under the knees at the frame's bottom edge (`v4_cyclic_view_047.jpg`); -0.53 rad
          tried, not enough (`v4_cyclic_view_053.jpg`); it shows from about -0.62 (their "mouse a little down" tiles), which puts
          the horizon at the top tenth. Kept -0.47.
        - Cascade borders in motion: 12-frame strips (`v4_borders_car.jpg`: lamp-post shadows crossing 70 and 14 m at
          200 km/h; `v4_borders_heli.jpg`: the hangar's shadow from 100 m at 150 km/h): no popping or swimming seen.
        - Tyre smoke from the cockpit (`v4_smoke_cockpit_before.jpg`, `v4_smoke_cockpit_after.jpg`): it was drawn over the dashboard and the wheel when the
          car slid through its own cloud (flat sprites with their centres inside the cabin); now a puff reaching into
          the shut cabin fades in the cockpit view; the cloud shows through the windscreen and the side window.
  4. Regression (final code): `demo.review(...)`: idle 0.6, walk 1.8, jog 2.1, aimHold 0.9 frozen 5, burst 0.9 fire 0.6,
     reload 1.1, swap 2.5, crouchIdle 0.1 head 113, rampUp20 3.1 sink 0.1, stairsUp 2.6 sink 0.5; grip 0 / 0 everywhere.
     `demo.vehicleReview()` (13): 0-100 2.98, 0-200 8.53, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at
     102.28, skidpad200 1.392, roll 2.673, dive 0.826, upshift 0.10, standstill 0, wheel 2.13 %, slalom 0.792 g, liftOff
     +13.14 %, powerOver 2.679 / 6.789, kerb 3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock palm 0.6 hands off 0 s;
     palms launch / topSpeed / brake / standstill / wheelSpeed / kerb 0, skidpadLimit 1.54, skidpad200 1.3, rollPitch
     1.33, slalom 1.1, liftOff 1.56, powerOver 1.27 (identical to V3). `demo.heliReview()`: start 35.8 s (quick 8.7),
     hover 70.75 % / 81.83 % (2500), climb 9.36 m/s, cruise 69.99 % pitch -2.258, turns 1.178 / 1.454 g, autorotation
     10.305 m/s at 102.1 % Nr, flare 1.226 m/s, gentle 0.317, firm 2.819 (identical to V3). `demo.heliReach()` palms
     0.00, soles 0.0 cm. `node --test test/dynamics.test.js` 8 pass, `test/hands.test.js` 4 pass,
     `tools/heli/flight.test.js` 19 pass, `node tools/heli/run.js` 65 PASS 0 MISS 46 rows.
     src/audio.js and the voice lines in src/main.js untouched.
  5. Files. New: `src/batch.js`, `src/cloud.js`, `src/perf.js`, `tools/v4_cost.js`, `tools/v4_shots.js`,
     `tools/v4_wash.js`, `tools/v4_misc.js`, `notes/V4_log_entry.md`. Changed: `src/main.js` (render scale, `?gputime`,
     batching calls, the shadow camera's layers, `gunsInCabin`, vehicle sleep and cockpit flags), `src/look.js`
     (matrices once, cascade layers, skinned spheres), `src/world.js`, `src/range.js`, `src/ground.js` (static tags, one
     board material per number), `src/fx.js` (one steel for the targets, static frames, chains merged, marks on merged
     meshes), `src/character.js` (kit materials per colour, kit merged), `src/car/car.js` (batching, sleep, smoke cloud,
     cockpit smoke fade), `src/heli/heli.js` (batching, blade shadow proxies, sleep, dust cloud, wash rebuilt),
     `src/heli/seat.js`, `src/seated.js` (soles), `src/review.js` (gunSurface skips batch copies, heliReach sole),
     `README.md` (section "Vehicles, pass V4"), `tools/heli/report.txt` (regenerated). Originals copied to the
     scratchpad's `v4_orig/` before editing. No Blender, no assets, no packages; `public/vehicles/` unchanged.
  6. Not verified: the target on a quiet machine (none was available: every block shared the CPU with other jobs);
     GPU time per pass (timestamps unusable here); the frame time of getting in and out, of a hover over dirt with the
     full dust cloud, and of a slide with smoke (no case measured them); the EarthOnline bodies (placeholder IK, as
     before); the helicopter's guns against its cabin during heli-enter; the WGSL error 'unresolved value null' in a
     MeshStandardNodeMaterial pipeline at load (`render.nodeUniform * null`) is V3's (the original src/ swapped back in
     for one load: the same error, 8 messages) and was not traced; sound not touched.
