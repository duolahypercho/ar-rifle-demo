### H1 (2026-11-11): helicopter flight model, pure module, tested headless in Node

Built `src/heli/flight.js` (physics, no imports) and `src/heli/assist.js` (switchable keyboard assist),
with `tools/heli/` (scripted test pilot, 11 scenarios, `node --test` file, `report.txt`). Not wired
into the game; no browser, no Blender, no packages. Nothing outside `src/heli/`, `tools/heli/` and
this file was touched.

Run: `node tools/heli/run.js` (writes `tools/heli/report.txt`, about 10 s) and
`node --test tools/heli/flight.test.js` (18 pass, 1 todo = the known yaw miss). Note: in Node 24
`node --test tools/heli/` with a directory argument fails to resolve; give the file.

**Result: 62 PASS, 2 MISS, 45 reported-only rows.** Misses: full-pedal yaw rate in the hover is
204 deg/s right and 152 deg/s left against my assumed 60 to 120 deg/s (no checked real figure).

Model (constants and their sources are in `HELI` in flight.js):
- Frames: glTF body frame of `helicopter_root` (forward -Z, up +Y, right +X); state.position is the
  root, state.quaternion is {x,y,z,w} body to world, so the GLB root takes them directly. SI units.
- 480 Hz fixed sub-steps (8 per 60 Hz frame), semi-implicit Euler, quaternion attitude, gyroscopic
  term. 0.053 ms per 60 Hz frame in Node. 240/480/960 Hz agree within 1 mm over 20 s.
- Physical: rotor-speed torque balance (rotor inertia 1400 kg m^2, engine through a freewheel, aero
  torque, tail-rotor and accessory drive, reaction on the airframe = main-shaft torque); blade-element
  thrust (4 blades, chord 0.28, solidity 0.065, twist -10 deg, a 5.7, Cd0 0.008) with uniform inflow;
  Glauert momentum induced velocity with a 0.08 s dynamic-inflow lag; power = T x (kappa vi + climb
  inflow) + profile (1 + 4.65 mu^2, part as an H-force); translational lift, the power bucket and
  autorotation fall out of this. Cheeseman-Bennett ground effect at the hub, fading with speed.
  Tip-path plane: first-order flapping lag 16/(gamma Omega) = 0.07 s (Lock number 5.5) driven by
  cyclic (+-12 deg long., +-7 lat.), flapback, rate lag and gyroscopic cross terms (CCW rotor); hub
  moment from 5 % hinge offset plus thrust tilt about the CG; mast tilted 4 deg forward. Coning from
  thrust vs centrifugal stiffness (2.3 deg in the hover). Tail rotor (4 blades, 1.57 m, 2551 rpm,
  pitch +20/-8 deg) uses the same blade-element/momentum code, so its yaw damping, pedal-with-collective
  and any loss of effectiveness come out of the inflow. Fin 1.1 m^2 (+3 deg toe), stabiliser
  0.95 m^2 (+1 deg), cabin and tail boom drag elements in their local airflow including the rotor wake
  (skewed-cylinder test, gives hover download 3 % and stabiliser wake hits in transition), forward
  flat-plate area 1.45 m^2 incl. hub.
- Approximated, empirical: vortex ring = Leishman's measured axial induced-velocity curve plus a ring
  state (builds in 1 s when descent is 0.2 to 2.0 vh at edgewise speed < vh, decays in 2 s) that
  re-ingests inflow through the disc in proportion to blade pitch over the hover value. The pump gain
  (2.0) was set so that adding power in a developed ring deepens it, as the task asks; with 1.3 power
  only barely helped (12.8 -> 11.9 m/s). Lateral tilt toward the advancing side = (4/3) mu beta0
  (coning) + tan(chi/2) lambda_i (transverse flow, Coleman Kx). Retreating-blade stall = soft cap on
  CT/sigma at 0.125 - 0.12 mu with extra drag and a pitch-up/roll-left tilt. Compressibility =
  profile drag rise above advancing tip Mach 0.86. Engine = gas-generator speed lag (0.4 s, 15 %/s
  accel limit) on a power map (560 kW thermodynamic at Ng 100 %, rated 520 kW = 100 % torque,
  MCP 468 kW), PI N2 governor with collective anticipation and a rate-limited reference on spool-up.
- Mass 2200 kg (max 2500), CG 1.77 m under the hub, 2 cm aft; inertia pitch 6000, yaw 5200,
  roll 1800 kg m^2 (estimates for the class, no products of inertia).
- Ground: 12 skid points (5 shoes + toe per skid at x +-1.1) + 14 hull points; 40 kN/m and
  3000/4000 N s/m per point (5.4 cm static deflection, ~0.7 critical); friction by an anchored
  spring (stiction, no creep) with an ellipse: 0.40 along the skid, 0.65 across, scaled by the
  `friction` the ground callback returns.
- Not modelled: lead-lag, ground resonance, main-rotor wake on the tail rotor, fuel burn, blade
  strike damage (flagged only), products of inertia, mast bumping.

Numbers (2200 kg, ISA sea level): start to 99 % Nr 35.8 s (quick start 8.7 s, labelled, uses a
non-physical spin-up torque); flight idle 390 rpm, Ng 70 %; droop 2.1 % on a 0.2 collective pull in
0.4 s; hover OGE 70.8 % of 520 kW (collective 0.473, pedal -0.38, bank -3.0 left skid low, pitch
+3.5); IGE at 1 m skid height 9.4 % less power; vertical climb at 100 % torque 9.4 m/s, forward
11.8 m/s; bucket 110 km/h at 40 %; cruise 220 km/h at 70 %, pitch -2.3; Vmax 247 km/h at MCP,
256 km/h at 100 %; 260 km/h IAS reached in a 5 m/s dive with tip Mach 0.873; stall flag at 2.0 g in
a pull at 260; turns 1.18 g at 30 deg, 1.45 g at 45 deg; autorotation 10.3 m/s at 120 km/h, Nr 96.8
to 103.8 % (collective fully down 105.6 %), entry droop to 88 % with 1 s pilot delay, flare to a
1.23 m/s touchdown at 43 km/h; VRS: a requested 6 m/s vertical descent runs away to 15.8 m/s,
hover collective in the ring 12.8 m/s, 100 % torque 14.7 m/s, forward to 72 km/h recovers in 6.2 s;
landings: gentle 0.32 m/s no bounce, firm 2.82 m/s 3.7 deg max bank (one short contact loss),
6 deg slope sits at -6.15 deg, run-on at 40 km/h stops upright, side drift rolls it over at 3 m/s on
soft ground and never on hard ground (slides); 60 s on the ground under 0.04 mm/s.

For the integrator: see the header of flight.js (frames, units, step, controls) and the assist
header. `heli.reset({position, heading, running: 'cold'|'idle'|'flight', inAir})`, then per frame
`heli.setControls(assist.update(heli.state, keys, dt)); const s = heli.step(dt);`. Placing the root
on the ground at y = ground drops it 5 cm onto its springs in the first second (reset without a
position puts it at the static deflection). The assist's centred-stick pitch reference is
`assist.pitchTrim` (+3 deg, slows toward the hover hands-off).

Not verified: real-aircraft reference figures are approximate numbers from memory, not looked up;
nothing seen in a browser or with the asset; feel with a keyboard untested (only scripted pilots);
yaw-rate reference unknown; wind and gusts exist as `opts.wind` but no scenario flies them; LTE was
not provoked; altitude performance above 1500 m not checked; the hover with the assist off diverges
(bank 50 deg in 20 s), as real helicopters do, but whether a person can fly it with care was not tried.
