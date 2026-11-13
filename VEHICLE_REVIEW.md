# Vehicle review (2026-11-12, 23:45)

The supercar and the utility helicopter in the game, after passes V1 to V8 (game), H1 (flight model)
and A1 to A3 (character clips). Numbers were re-measured by the main session unless marked "pass".
Details per pass are in `VEHICLE_NOTES.md`; controls are in `README.md`. A clip pass is still running
until 23:10; this page includes its second round (helicopter step speeds, the EarthOnline bodies'
helicopter clips).

## What is there

- **Supercar.** A 6-degree-of-freedom rigid body at 1200 Hz with four sprung wheels, anti-roll bars, a
  slip-based tyre model, a V12 torque curve, a 7-speed dual-clutch gearbox, all-wheel drive, ABS and
  traction control, drag and downforce (`src/car/dynamics.js`, tested in Node). Engine start and stop,
  live cluster and centre screen, headlights, brake and reverse lights, tyre smoke and skid marks,
  impact physics against walls and the helicopter, visible damage (dents, scrapes, cracked glass,
  broken lamps, folded or knocked-off mirrors, bent toe, flat spots), three mirrors that show the world
  behind, chase and cockpit cameras, synthesised engine, tyre and impact sound.
- **Helicopter.** A flight model with rotor speed and governor, blade-element thrust, induced flow,
  ground effect, translational lift, flapping, torque and tail rotor, autorotation, vortex ring, skid
  and hull contact, wind (`src/heli/flight.js`, tested in Node), a switchable keyboard assist, real and
  quick start, shutdown with rotor run-down, live flight and engine displays with a lean-in key,
  warning horn and lamps, rotor blur, rotor wash dust, lights, rotor-strike handling, bent skids and
  tail strike damage, chase and cockpit cameras, synthesised turbine and rotor sound.
- **The character.** Your Tripo model has authored clips for getting into and out of both vehicles,
  seated loops that stay alive, steering poses and control poses; hands and feet are pinned to the real
  door, wheel, cyclic, collective and pedals; push-pull steering; guns go on the back before getting in
  and lie in the cabin while seated. The four EarthOnline bodies have their own seated clips and
  authored clips for getting into and out of both vehicles.
- **World.** A 2.55 km track loop, skidpad, helipad, buildings with windows and doors, barriers, cones,
  rolling ground off the paving, grass, trees, bushes, hills, clouds, edge lights, tyre walls, a wind
  sock, four times of day, four shadow cascades.

## Main measures

| Measure | Game | Reference |
| --- | --- | --- |
| Car 0 to 100 km/h | 2.98 s | about 2.9 s |
| Car 0 to 200 km/h | 8.53 s | 8.5 to 9.5 s |
| Car top speed (pass) | 348.8 km/h | about 350 |
| Car 100 to 0 km/h | 30.2 m, 1.27 g mean | 30 to 34 m |
| Dive under full braking | 1.37 degrees | 1 to 2 |
| Steady cornering at 100 / 207 km/h (pass) | 1.165 g / 1.284 g | 1.1 to 1.3, more at speed |
| Body roll (pass) | 2.67 degrees per g | 1.5 to 3 |
| Upshift | 0.10 s | 0.08 to 0.15 s |
| Driver's palms on the rim, lock to lock | 0.6 cm worst, never off the rim | on the rim |
| Helicopter rotor speed in flight | 390 to 395 rpm | 385 to 395 |
| Start to flight rotor speed (pass) | 35.8 s (quick start 8.7 s) | 20 to 40 s |
| Hover power, 2200 kg (pass) | 70.8 % | 60 to 75 % |
| Vertical climb at full power (pass) | 9.4 m/s | 8 to 10 |
| Cruise 220 km/h (pass) | 70 % power | under 90 % |
| Full pedal in the hover (pass) | 123 / 92 degrees a second | about 90 to 120 |
| Autorotation descent (pass) | 10.3 m/s, rotor 97 to 104 % | 8 to 12 m/s |
| Gentle landing (pass) | 0.32 m/s, no bounce | under 1 m/s |
| Pilot's palms and soles on the controls (pass) | 0.0 cm at 11 control positions | on the controls |
| Joins in the get-in, drive, get-out chain | car 2.2 m/s worst, helicopter 2.0 m/s worst velocity change in a frame; root 0.3 cm | under 4 m/s, no teleport |
| Velocity change inside the helicopter clips | 3.2 m/s worst (was 7.9) | 4.5 m/s |
| Hands and feet on their contacts while getting in and out of the car | 0.6 cm worst (Tripo), 0.9 cm (EarthOnline) | under 1.5 cm |
| Peak limb speed getting into and out of the car | hands 4.4 to 5.1, feet 4.6, head 1.2, pelvis 1.35 m/s | hands and feet 4.5, head 2.0, pelvis 1.8 |
| Peak limb speed getting into and out of the helicopter | hands 4.05, feet 4.26, head and pelvis 1.65 m/s (both bodies) | hands and feet 4.5, head 2.0, pelvis 1.8 |
| Frame time on foot (quiet machine, median / 95th percentile) | 6.8 to 8.3 / 8.6 to 10.3 ms | 16.7 ms |
| Frame time, car chase view | 13.5 to 15.7 / 35 to 40 ms | 16.7 ms |
| Frame time, car cockpit | 8.8 / 17.6 ms | 16.7 ms |
| Frame time, helicopter at 97 m, chase / cockpit | 14.7 to 18.5 / 18.5 ms median, 21 to 51 ms at the 95th percentile | 16.7 ms: **at or just over** |

## What was looked at

Contact sheets and film strips from the game: the car parked, at full lock, braking, sliding on dirt
and tarmac, at 80 to 300 km/h in the chase view, the car's cockpit view with live instruments, the
mirrors, damage after impacts, each stage of getting into and out of the car for the Tripo model and
an EarthOnline body; the helicopter starting, lifting off with dust, hovering, cruising, banking,
autorotating, landing hard, striking a wall, its cockpit view in twelve attitudes, its live displays,
each stage of getting in; the four times of day, the grass and trees from the ground and the air, the
vehicles at night; cut-away pictures of the seated driver (both bodies) and pilot. The clips' sheets
in Blender for the entry and exit clips.

## Below target or not verified

- **Gun hand-off.** The guns still jump between the back and the cabin. Getting in, the gun on the
  back passes into the seat's back as he sits; getting out, a gun stands in the cabin and then appears
  on his back in one frame. The `guns` track is implemented in the game but no clip carries one. A
  hand-off that reads right needs a design choice (about 2.4 s more at the doorway, or other cabin
  places, or carrying one gun in and laying it across once seated); not built.
- **Start of each entry.** For the first 0.1 s the feet glide 2 to 3 cm from where the walk left them
  to the clip's first frame.
- **EarthOnline helicopter seat.** Its seat is lowered 0.06 m to clear the thigh; the back leaves the
  backrest by up to 1.7 cm during the seated loop.
- **Frame time in the helicopter and frame spikes.** The helicopter is at or just over 16.7 ms, and in
  both vehicles the slowest frames reach 35 to 51 ms. The spikes are not traced. The render scale is
  1.5 device pixels per CSS pixel; edges are a little softer than at 2.
- **Right hand in the stow and draw.** It changes speed by 4.1 m/s in one frame where the gun reaches
  the back (the rifle pack's swap clip; limit 4).
- **Postures accepted with faults.** Getting into and out of the car goes through a very deep squat
  beside the sill. The pilot's thigh is 5.6 cm into the seat cushion, the driver's shoulders 2 to 3 cm
  into the seat's wings. Balance is up to 22 cm outside the support for a moment in the car exit.
- **Foot drift measure.** The helicopter clips read up to 63 cm of foot drift near the ground; the
  measure counts a low swing as a slide, and it has not been separated from real sliding.
- **Keyboard limits.** With the assist off a scripted key presser cannot hold the hover. The slalom is
  clean at 45 and 55 km/h, clips a cone at 50 (key ramps) and at 60 (the car's grip limit).
- **Helicopter displays.** Readable when leaning in (Shift); from the default eye point the figures are
  4 to 5 pixels high.
- **Far trees.** From about 100 m the firs are plain cones on flat-coloured ground.
- **Unreal export.** `unreal/` holds the bodies, guns and the 80 + 80 rifle clips; the vehicle clips
  are not exported.
- **The Tripo face** cannot blink or move its eyes (no eyelid geometry in the mesh).

## What this cannot reach, or has not tried

- **Sound by ear.** Every sound is synthesised and was judged only by spectra and levels.
- **Feel in the hands.** Nobody has driven or flown it with real hands on a keyboard; only scripted
  inputs.
- **Captured motion.** The clips are authored by rule; weight shifts and small irregularities of a real
  body getting into a low car are thinner than a recording would give.
- **Other traffic and people.** The world has no other cars, aircraft or characters.
- **Paint reflections.** The paint reflects the sky only; the mirrors do show the world behind.
