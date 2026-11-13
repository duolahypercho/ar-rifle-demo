- 2026-11-12, pass V5: live instruments, engine start and stop, warnings and cabin sounds, impulse collisions, keyboard
  feel, frame time, car-exit on the clip path. Originals copied to the scratchpad's `v5_orig/` before editing.
  Works: all seven items run in the game. Not met: the helicopter's PFD digits are not readable at the game's render
  scale from the default cockpit view; the hover with the assist off was not held by the scripted person (28.9 m
  drift in 20 s); the slalom at 50 and 60 km/h touched one cone each (45 km/h clean); the right hand jumps 49.6 cm in
  one frame at the hand-over out of car-exit (also with the V4 code and the new pack).
  1. Live instruments (`src/instruments.js`; canvas textures replacing the display materials' emissive maps; screen
     rectangles from the GLB's UVs for the car (cluster u 0..1 v 0..0.44, centre screen u 0..0.4 v 0.5..1) and from
     `utility_helicopter/source/hb/interior.py` DISP for the helicopter).
     Car: speed ring + digits, rev ring 0-9000 red from 8500 + digits, 7 shift lights 6500-8250 rpm (all flash at the
     limiter), gear + A/M, TC and ABS lamps (lit when tc < 0.97 or any wheel's abs < 0.97), headlamp tell-tale, (P)
     lamp, indicator arrows, fuel and coolant steady; centre screen: g-meter with 3 s trace, four tyres' combined slip
     against the peak. Lamp check 1.2 s at ignition; dark with the ignition off. 15 redraws/s (centre 7.5), 0.87 to
     0.94 ms per redraw. Readouts moved above the rim after the first sheet (the rim hid the lamps and gear: digits,
     gear and lamps now in the cluster's top 65 %).
     Launch (game, cockpit, `v5_car_launch.jpg`, `v5_car_dash2.jpg`), dash / HUD / model at five moments plus braking:
     t 0.52 s 10 / 10 / 10.0 km/h, 6400 / 6400 / 6400 rpm, gear 1; 1.2 s 34 / 34 / 34.4, 6400; 2.02 s 63 / 63 / 63.5,
     6400; 3.02 s 97 / 97 / 96.6 km/h, 7740 / 7750 / 7736 rpm; 4.52 s 132 / 132 / 131.9, 7390 / 7400 / 7393, gear 2;
     braking 5.02 s 109 / 109 / 109.0, ABS lamp on (worst wheel abs 0.59). (The HUD rounds rpm to 50, the dash to 10.)
     Seen at native pixels: speed digits and the rev digits readable over the rim; the centre screen's g figure and the
     slip bars readable; the lamp row half hidden by the rim top.
     Helicopter (1024 x 512 canvas, 10 redraws/s, slow screens every other one, the caution panel the same frame a lamp
     changes; 1.2 ms per redraw; 5.9 ms at 2048 x 1024 15/s before halving): PFD (attitude, ladder, bank pointer, IAS
     tape in kt with Vne mark, '--' under 20 kt, altitude tape in ft with the ground shaded at the radar height and
     'RA' under 2500 ft, VSI fpm, heading strip, assist annunciators), engine page (TQ, TOT derived, N1 = Ng, one dial
     NR + N2 (N2 derived), the artwork's oil / transmission / hydraulic bars falling with Ng / Nr, fuel 386 kg steady,
     flow 0.36 kg/kWh x power), caution panel (lit = full-colour face: the artwork's 30 % fill could not be told from
     unlit from the seat), standby ASI / attitude / altimeter. Take-off (game), HUD / model / PFD at five moments: t 1.0
     IAS 0 km/h / 0 kt / '--', alt 0.0 m / 0 ft / 0 ft, VS +0.0 / 0.02 / 0 fpm, Nr 100 / 99.8 / 100, TQ 26 / 26.4 / 26, Ng
     73 / 73.2 / 73.2; t 3.52 IAS 5 km/h / 2.7 kt / '--', alt 0.4 m / 1 ft / 1 ft, VS +1.2 / 1.15 m/s / 230 fpm, TQ 81 /
     81.2 / 81, Ng 94 / 94 / 94.0, hdg 9.5 / 10; t 6.02 IAS 20 / 11 kt / '--', alt 9.5 m / 31 ft / 31, VS +5.2 / 1020
     fpm, TQ 93 / 93 / 93; t 10.0 IAS 32 / 17.4 kt / '--', alt 36 m / 119 ft / 119, VS +7.3 / 1440 fpm, pitch -4.8 /
     -4.8; t 14.0 IAS 47 km/h / 25.1 kt / 25, alt 66 m / 215 ft / 215, VS +7.5 / 1470 fpm, TQ 97 / 96.5 / 97. Every
     reading matches its source (km/h and m on the HUD, kt and ft on the PFD, as the artwork is labelled).
     Seen (`v5_heli_panel.jpg`, native crops): the PFD in front of the pilot is about 130 x 95 px on the 1536 x 1152
     canvas; its horizon, ladder and tapes move and read as shapes, its digits (4 to 5 px) do not; looking down 0.3 rad
     brings it closer, still not readable. The standby dials and engine arcs read as shapes. Not fixed (layout of the
     cockpit and the 88-degree field).
  2. Engine start and stop. Car (`dynamics.js` ignition 'off' / 'cranking' / 'running', `startEngine()`,
     `stopEngine()`, starter 160 Nm falling to 0 at 320 rpm, crank 0.7 s, flare +500 rpm on the idle governor decaying
     over 0.9 s; both clutches open when not running; `reset()` leaves it running so every test and scenario is as
     before). Auto-start once seated (my call), I to stop / start. Game: ignition 0 s, starter at 0.9 s (after the lamp
     check), 270 rpm cranking, fires at 1.6 s, 1554 rpm at 1.9 s, 1070 rpm idle from 2.8 s. Getting out: off.
     Helicopter: I (engine running, on the ground) or T: `Heli.shutdown()`: ground idle, collective down, 10 s
     cool-down (labelled on the HUD 'game: 10 s; real about 2 min'), fuel off, run-down to 40 % in 29.6 s, rotor brake
     to 0.3 % in 7.2 s, battery off. With T the pilot stays in until the rotor has stopped (my call): out 46.7 s after
     the key. Lamps on the way: ROTOR LOW from 90 % Nr, ENG OUT and GEN at fuel off; no tones (inhibited in a
     commanded shutdown).
  3. Warnings and sounds (offline, 48 kHz, the game's compressor and 0.55 master, `/tools/v5_sound.js`, spectrograms
     `sound_v5_*.png`). Helicopter in the hover inside (rotor 26 Hz at -20 dB): horn 600 Hz at -28 dB, engine-out warble
     600 / 1000 Hz (-30 / -48 dB at the sampled instant), overtorque chime 990 / 1320 Hz (-32 / -53 dB); peaks -8.7 to
     -9.4 dBFS; in the game: overtorque lamp + chime at 102 % (first frame), horn + ROTOR LOW at 93.8 % Nr 0.09 s after
     the cut, ENG OUT + warble 0.03 s after the cut (Ng 85.6 %, torque 0). Car: start (starter 149 Hz -40.7 dB with its
     2nd at 298 Hz while cranking; first firing at 0.98 s; firing order 120 Hz at the flare, 107 Hz at idle), limiter
     (firing 845 Hz -29.5 dB; level drops to 6 % at each cut plus a pop), indicator ticks (peak -29.5 dBFS), crunch
     at speed changes 1.5 / 6 / 22 m/s: peak -14.0 / -10.6 / -8.4 dBFS, loudest 100 ms -26.3 / -20.9 / -17.3 dB
     (body mode 95 to 99 Hz strongest), scrape (2.5 kHz band, -42.5 dB at 90 kW over the 4000 rpm engine), car door
     peak -10.1 dBFS (105 Hz + 205 Hz panel mode), helicopter door -14.2 dBFS. No sample at full scale in any case.
     No brake squeal (not convincing from noise and a tone; left out).
  4. Collisions (`dynamics.js` `_collide` / `_contact`, `COLLIDE = { e: 0.15, mu: 0.45, height: 0.45 }`; the
     helicopter's hull as a moving body, `Heli.contactBody()`). `node tools/v5_crash.mjs`, an 80 m x 0.6 m x 0.85 m
     barrier, no throttle or brakes; before -> 0.5 s after (km/h), impulse, peak g (60 Hz frame), yaw rate, heading
     change: head-on 30: 29.6 -> 1.8, 16.1 kN s, 56.5 g, 0; 80: 79.8 -> 2.4, 43.3 kN s, 155.7 g; 150: 149.9 -> 12.2,
     81.4 kN s, 292.4 g; 30 deg 30: 30 -> 16.6, 14.6 g, 62 deg/s, 25.1 deg; 80: 80 -> 53.1, 39.0 g, 165 deg/s, 27.2 deg;
     150: 150 -> 97.6, 73.5 g, 309 deg/s, 24.9 deg; 10 deg 30: 30 -> 24.2, 2.7 g, 25 deg/s, 9.4 deg; 80: 80 -> 72.4,
     10.9 g, 66 deg/s, 8.9 deg; 150: 150 -> 134.3, 37.1 g, 122 deg/s, 8.0 deg; offset (wall's end 0.3 m right of the
     centre line) 80: 79.8 -> 10.2, 31 deg/s, -5.8 deg. Speed change = impulse / mass (80 head-on: 43.3 kN s / 1700 kg
     = 91.7 km/h = 79.8 + 11.9 rebound, e 0.15). Nothing went through in any case, no NaN, kinetic energy never rose
     (largest rise 0 J over every impulse). The peak g is a 60 Hz frame's mean: the impulse is one 1/1200 s step
     (rigid car, rigid barrier, no crumple zone). In the game (80 km/h head-on, `v5_crash_80_90.jpg`): rebound 11.5
     km/h, sparks 24 live, camera shake 0.92, torso to the belt stop 14.9 deg and head 34.4 deg forward in the hit
     frame, back through the seat (head -20 deg at +5 frames) and settled by +12. Car into the parked helicopter's side
     at 30 km/h: the helicopter pushed to 9.4 km/h and turned at 48 deg/s, slid 1.85 m and stopped upright, car 29.6 ->
     15.7 km/h then stopped against it, energy never rose. Found on the way: the parked helicopter slept through the
     impulse (its state not refreshed), the car passed through it: a knock now wakes it for 3 s. No damage model
     (README says so). Pictures: the driver's tiles were filmed through the passenger glass; dust from the dirt in
     front of the barrier fills the +40 frames tile.
  5. Keyboard (`src/keys.js`; `node tools/v5_keys.mjs`, a scripted person: looks every 50 ms (car) or every 0.25 s
     (helicopter: holds a key for the share of the look it wants, min 80 ms), keys only, through the same keys.js,
     dynamics, flight model and assist; flat ground, the track's surfaces). Car tap (80 / 120 / 200 ms): 0 km/h 70 /
     110 / 160 deg of wheel; 50 km/h 50 / 84 / 126; 100 km/h 31.5 / 51 / 78 (2.1 / 3.4 / 5.2 deg road); 200 km/h 12.6
     / 20 / 31; back to centre 0.05 to 0.32 s; throttle 69 % after an 80 ms tap. Lap: 81.27 s for 2549 m from rest,
     0 s with a tyre off the tarmac, 3.78 m from the centre line at most (half width 6.5), 1.13 g, 511 steering presses
     (median 0.1 s, 501 under 200 ms). Slalom (7 cones 18 m apart, the line 1.5 m either side): 45 km/h clean (0.17 m
     clearance), 50 km/h one cone, 60 km/h one cone touched (0.11 m). Helicopter taps in a 10 m hover, assist on (100 /
     200 ms): bank 3.2 / 5.0 deg, pitch -0.8 / -3.0 deg, heading 0.7 / 2.8 deg, collective 0.03 / 0.06 (vertical speed
     +1.45 / +2.47 m/s peak); assist off: bank 13 / 8.5 deg, pitch 2.4 / 10.8, heading 6 / 5.8 (with the aircraft's own
     divergence in the 2 s). Take-off to a 10 m hover held 20 s with the assist: height 9.48 to 10.63 m, drift 0.93 m,
     bank 4.4 deg, heading 3.4 deg; with Y (force trim, new: the assist's hands-off attitude becomes the hover's,
     `assist.rollTrim` added, 0 by default) 9.52 to 10.67 m, 0.84 m, cyclic presses 162 -> 80. Assist off (the trim
     from the assist's last output): height 9.47 to 10.59 m held, drift 28.9 m, bank 28 deg: not held. Circuit
     (climb north to 60 m, a 300 x 500 m box at 30 to 40 km/h of ground speed (the person's own limit), approach, 2 m
     hover, let-down): landed 1.72 m from the H at 0.21 m/s, 133 s. Changes: the car's keys were raw 0/1 into the
     dynamics' rate limit; now shaped as the README says. The helicopter's stick returned to 0; it returns to the trim.
  6. Frame time (`tools/v4_cost.js`, 3 x 90 frames). Start, original code (served from a temporary copy of
     `v5_orig/src`, removed after), load average 27.9 to 35: foot 9.5 / 20.8, car 10.6 / 19.7, cockpit 9.2 / 18.5
     (first run 11.2 / 19.8), helicopter 9.0 / 11.0 (median / p95 ms). End, same sitting, load average 65 to 81: V5 foot
     11.7 / 34.0, car 14.5 / 44.7, cockpit 12.9 / 38.2, helicopter 13.5 / 27.7; original foot 10.5 / 43.7, car 13.7 /
     71.3, cockpit 11.8 / 48.9, helicopter 18.9 / 51.4. The load swamps 1 ms; measured by parts instead: the car dash
     0.87 to 0.94 ms per redraw at 15 / s = 0.23 ms a frame, the helicopter panel 1.2 ms per redraw at 10 / s = 0.2 ms
     a frame (CPU drawing; the upload is in the render call); A / B in one page, car case, 20 alternating blocks of 30
     frames with the dash and the helicopter body on / off: frame median 16.1 / 16.3 ms, step mean 3.06 / 2.97 ms.
     Draw calls unchanged (foot 195 vs 194, car 171, cockpit 132, helicopter 225 vs 224).
  7. car-exit (pack shipped 00:51:52, 17 clips): runs on the clip path (`stats.paths['car-exit'] = 'clip'`), door by
     its track, guns back on the back. `demo.enterExit('car')` (`v5_enter_car.jpg`, `v5_exit_car.jpg`): exit 7.82 s,
     contacts worst foot_l 0.58, foot_r 0, hand_l 0, hand_r 0.87 cm; root step 1.80 cm; crossings seat 13.1 (head, 1.75
     s), interior 7.0 (ball_r, 0.25 s), steering wheel 4.2 (thigh_twist_01_r, 3.25 s), body shell 2.6 (calf_twist_01_l,
     3.0 s), door 2.2 (ring_03_r, 4.25 s). Enter (the 00:51 car-enter): contacts foot_l 0.58, foot_r 0.01, hands 0;
     root step 1.77 cm; seat 12.6 (head, 7.0 s), interior 7.1 (ball_r), wheel 4.5 (lowerarm_twist_01_r), door 2.8
     (middle_03_r), body shell 2.2 (thumb_03_l): identical to V4's figures for the 00:38 clip. Hand-over: the player is
     now placed where the clip's last frame stands and faces (V4 put him at the entry point, a jump); root step 0,
     head 2.1, hips 1.6, left foot 6.7 cm, right hand 49.6 cm in one frame (the draw's first frame; the same with the V4
     code and this pack; an eased blend made it 73 cm and was taken out). Seen: door up, legs out, stand, step clear,
     door pulled down, guns on the back, standing; nothing wrong seen at the 9 sampled frames; full speed not watched.
  Regression: `demo.review(...)`: idle 0.7, walk 1.9, jog 1.9, aimHold 0.9 frozen 8, burst 0.9 fire 0.6, reload 1.1,
  swap 2.5, crouchIdle 0.1 head 113, rampUp20 3.1 sink 0.1, stairsUp 3.0 sink 0.8; grip 0 / 0 everywhere (V4: aimHold
  frozen 5, stairsUp 2.6 sink 0.5; earlier passes 0 to 7 and 2.2 to 3.4). `demo.vehicleReview()`: identical to V4
  (0-100 2.98, 0-200 8.53, top 348.78, 100-0 30.21 m 1.268 g 1.368 deg, skidpad 1.165 at 102.28, roll 2.673, dive
  0.826, upshift 0.10, standstill 0, wheel 2.13 %, slalom 0.792 g, liftOff +13.14 %, powerOver 2.679 / 6.789, kerb
  3.69 cm 14.65 kN 0.167 s 0.879 deg, lockToLock palm 0.6, hands off 0) except skidpad200 1.392 -> 1.236 g (atKmh
  -4.09): the run ends with the car leaving the pad and hitting the yard's back wall (impulse 81.9 kN s at x -33.5, z
  -24.5); V4's 1.392 included that hit through the old push-out (not re-run with V4's code); with the walls taken out the run gives 1.004 g at 175 km/h.
  Palms: skidpadLimit 1.52, skidpad200 1.19, rollPitch 1.25, slalom 1.07, liftOff 1.53, powerOver 1.24 (V4 1.54, 1.3,
  1.33, 1.1, 1.56, 1.27: the trunk now also moves with the thrown body). `demo.heliReview()` identical to V4 (start
  35.8 s, quick 8.7, hover 70.75 / 81.83 %, climb 9.36, cruise 69.99 % -2.258, turns 1.178 / 1.454, autorotation 10.305
  m/s 102.1 %, flare 1.226, gentle 0.317, firm 2.819). `demo.heliReach()` on a fresh page: palms 0.00, soles 0.0 at all
  11; run straight after heliReview in the same page: soles up to 4.0 cm (pedal full right) (not traced). Node:
  dynamics 8 pass, hands 4 pass, flight 19 pass, `run.js` 65 PASS 0 MISS 46 rows (report identical but for the dates).
  Physics changed on purpose: the car's contact (only when touching a box), the ignition (only after `stopEngine()`),
  `assist.rollTrim` (0 unless set). src/audio.js and the voice lines in src/main.js untouched.
  Files. New: `src/instruments.js`, `src/keys.js`, `tools/v5_crash.mjs`, `tools/v5_keys.mjs`, `tools/v5_shots.js`,
  `tools/v5_sound.js`, `notes/V5_log_entry.md`. Changed: `src/car/dynamics.js` (ignition, `_collide`, `_contact`,
  `_energy`, `COLLIDE`, `impacts`), `src/car/car.js` (place parks it off, ignition sequence, `_hits`, sparks, shake,
  `BodyThrow`), `src/car/sound.js` (starter, fire, limiter, crunch, scrape, tick, door), `src/heli/heli.js`
  (`shutdown`, `contactBody`, wake on a knock), `src/heli/sound.js` (horn, warble, chime, door), `src/heli/assist.js`
  (`rollTrim`), `src/vehicles.js` (body throw, camera shake, 'rotor' on T, exit hand-over at the clip's end),
  `src/main.js` (instruments, keys, warnings, shutdown and trim keys, indicators, car events, the helicopter as a
  body), `README.md` (controls, "Vehicles, pass V5"), `tools/heli/report.txt` (regenerated). No Blender, no assets, no
  packages; `public/` unchanged.
  Not verified: the sounds by ear; the instruments at night or in other light; the car's lamps under the rim from a
  taller eye; a crash filmed from the cockpit; the helicopter hitting the car from the air (only the car into the
  parked helicopter); the circuit flown in the game (Node only); full-speed playback of car-exit; frame time on a quiet
  machine (load 65 to 81 at the end).
