- 2026-11-11, pass V2: the helicopter in the game, the vehicle clip packs wired in, the car's faults.
  - Works end to end (driven through demo.step, both vehicles): walk to the helicopter on the helipad, T, gun
    on the back, walk to entry_cockpit_R, cockpit_door_R opens, placeholder entry, door shuts, seated pose from
    the Tripo pack (heli-fly + 8 pose clips added by the controls, IK to the pack's contacts on the live
    cyclic / collective / pedal nodes); start (I real 35.8 s, U quick 8.7 s), lift-off, hover, cruise at
    220 km/h, steep bank, autorotation to touchdown, landing, T out. The car the same way (pack seated path).
    Game loads with no errors; page left reloaded in normal play.
  - Flight model change (src/heli/flight.js): full-pedal hover yaw 204 / 152 -> 122.6 / 91.5 deg/s by
    (a) an empirical yaw damping 1850 N m s/rad (hover Nr -0.33 -> -0.69 /s; the element model leaves out the
    rotor wakes on fin and boom, which H1 listed as not modelled) faded out between 10 and 30 m/s edgewise, and
    (b) right-pedal travel of the tail rotor 14 -> 7.5 deg per unit (full right -8 -> -1.5 deg; left travel kept).
    Left-pedal margin at 100 % torque in the vertical climb: 27.76 % of travel at 2200 kg (H1: 27.8), 30.0 %
    at 2500 kg. Cost: the steady autorotation needs pedal +0.92, so 8 % of right travel is left there.
    Also: obstacleAt hook (hull and skid points pushed out of buildings / barriers, rotor disc at 8 azimuths x
    2 radii and the tail-rotor disc tested -> flags.rotorStrike, state.strikeAt, flags.obstacleContact).
    Assist: heading hold also on the ground once collective > 0.25 (it turned 32 deg on lift-off without);
    torque limiter rewritten as a walking cap (H1's per-frame cut chattered 0.3 <-> 1.0 against a held lever).
    `node --test tools/heli/flight.test.js` 19 pass 0 todo; `node tools/heli/run.js` 65 PASS 0 MISS 46 rows
    (new row: left-pedal margin).
  - Game numbers against Node (demo.heliReview: tools/heli scenarios through demo.step, game's own aircraft
    over the helipad, the same TestPilot): engineStart, hover OGE/IGE (2200 and 2500 kg), verticalClimb,
    cruise 220 (70.0 % power, pitch -2.26), levelTurn (1.178 / 1.454 g), autorotation, gentle / firm
    landings: identical to Node to the printed digit after resetting the controls between scenarios, except
    autorotation flare touchdown 1.226 vs 1.239 m/s and final bank 0.001 vs 0.003 deg (it lands on the game's
    ground, about 2 km north of the pad: dirt friction 0.75, not Node's flat concrete). Before that reset
    cruise read 73.3 % and the 30-deg turn torque 53.4 vs 49.9 (controls carried over from the scenario before).
  - Pilot at the control limits (demo.heliReach, 11 positions incl. combined corners): Tripo (pack path) palms
    0.94 cm both hands at every position (a constant offset, not explained), soles 0.0 cm; EarthOnline
    (placeholder IK) palms 0.0, left 2.9 to 3.2 cm at collective down; soles 0.0.
  - Body against the cabins (demo.bodyClearance, skin vertices vs part triangles, depth behind the nearest
    face within 5 cm of it; open meshes can give false depth): car seated, wheel 0 / 420 deg: seat 4.5 cm
    (clavicles, as the clip agent said), wheel 1.0 / 1.2 (fingers), door 0, body_shell 15.6 / 15.4 at the left
    calf (into the footwell side or a false reading: not looked at), interior 4.8 (left foot). Helicopter, centre
    / all limits: seat 6.8 / 6.4 (right thigh), cyclic 0.8 / 1.7, collective 2.3 (left fingers), door 0,
    fuselage 14.5 / 15.5 (right calf), instrument_panel 22 / 0 (left thumb at centre: not looked at).
  - Car driver (B1), Tripo pack with vehicleFit applied to seat_driver, seat_driver_point, steering_wheel:
    car-drive + car-steer-l/-r added by wheel/90 + car-look-back when reversing; hands by the push-pull riding
    the rim to +-90 then regripping (targets lowered to 10 / 2 o'clock), clavicle protraction up to 18 deg when a
    grip is past reach. Static palms (wheel 0, +-45, +-90, +-135, +-180, 270, +-420): left 0.0 everywhere,
    right 0.0 to 4.0 (V1 placeholder: right 6.5 to 7.7). Drives: launch / brake / standstill / topSpeed 0.08,
    powerOver 1.8, skidpad200 2.2, rollPitch 2.6, skidpadLimit 3.2, liftOff 3.9, slalom 5.6, lockToLock worst
    15.3 (transient during a regrip), handsOffRimS 3.8 of 9 s (V1 4.7). hipsOffSeatCm 8.1 is now meaningless
    (measures against the placeholder's offset). EarthOnline bodies fall back to V1's IK (pack has no fit).
  - Car numbers (demo.vehicleReview, all 13): 0-100 2.98, 0-200 8.53, top 348.8, 100-0 30.21 m / 1.268 g mean /
    1.368 deg dive, skidpad 1.165 g at 102, skidpad200 1.392, roll 2.673 deg/g, dive 0.826 deg/g, upshift 0.10,
    standstill 0, wheel speed 2.13 %, slalom 0.792 g 21.8 deg/s, liftOff +13.1 % no spin, powerOver rear 2.68 /
    front 6.79 deg, kerbGame bump 3.69 cm peak 14.65 kN air 0.167 s roll 0.88 (V1: 3.9 cm, 15.5 kN). Node
    `node --test test/dynamics.test.js` 8 pass.
  - Character (Tripo, rifle): idle 0.6, walk 1.8, jog 2.0, aimHold 0.9 frozen 6, burst 0.9 fire 0.6, reload 1.1,
    swap 2.5, crouchIdle 0.0 head 113, rampUp20 2.9 sink 0.1, stairsUp 2.6 sink 1.2; grip 0 / 0 everywhere.
    Misses against V1: aimHold frozen 6 (5), stairsUp sink 1.2 (0.1; earlier passes 0.1 to 1.2).
  - Seen (contact sheets, overlay copies): helicopter parked from 4 sides and top; start at Nr 0 / 20 / 40 / 60 /
    80 / 99 (blades fade from 40 %, disc in); lift-off with the wash; hover 3 m from the front (bank -3.6, left
    skid low); hover from above; cockpit and chase in the hover; cruise 211 to 214 km/h chase and cockpit; fast
    pass from the ground at 210 km/h; 51-deg bank from outside and chase; 200 m above; autorotation descent,
    flare at 25 m, level at 4.9 m, touchdown 1.27 m/s at 43 km/h (dust), stopped; hard landing 4.3 m/s (skid load
    6.0 W, no strike, bank 3.9); rotor strike on the hangar's east wall (it leans on the wall, rotor stopped,
    1.5 s later Nr 7 %); pilot from outside; cockpit view after moving the lens 10 cm ahead of the eye (before:
    the pilot's own shoulders and the inside of the hidden head showed as dark and skin-coloured shards); every
    stage of the placeholder entry and exit of both vehicles; driver at full lock both ways; car cockpit
    standing and at 160 km/h; wheel blur at 160; buildings and barrier at 176; paint in the sun; car chase from
    200 m; down the straight past the shadow box; handbrake slide (marks dark, smoke faint); kerb strike at
    60 km/h from outside.
  - Not looked at / not fixed: the placeholder entries pass through the car's sill and door frame and the
    helicopter's floor (feet below the cabin floor at 1.7 to 1.8 s); no hand on a handle (no clip yet). Shadows
    still stop at the sun's box (lamp posts past it unshadowed). The 51-deg bank strip read 0.90 g (a transient
    of my strip's pilot, not a trim). Cabin doors, rear seats, night, wind, sound (not heard: described in
    src/heli/sound.js). GPU texture memory not measured in the browser (estimate below).
  - Clip packs used: vehicle-motion-tripo-v1 21:06:52 (car-drive, car-steer-l, car-steer-r, car-look-back,
    heli-fly, heli-cyclic-f/b/l/r, heli-collective-up/down, heli-pedal-l/r; vehicleFit car + heli);
    vehicle-motion-ue5-v1 20:44:18 (car-drive, car-steer-l/-r, car-look-back; no vehicleFit -> placeholder).
    Real clips: car seated (Tripo), helicopter seated (Tripo). Placeholder only: car-enter, car-exit,
    heli-enter, heli-exit (not in either pack), every EarthOnline seated pose. The pack path for enter / exit
    (root, door track, contacts pinned with IK, vehicleFit) is written and has never run with a real clip.
  - Asset: public/vehicles/utility_helicopter.glb 15.2 MB (LOD0, 124.6 k tris; textures ext_normal, int_basecolor,
    int_normal 2048, displays 2048x1024, rotor_blur 1024x512, the rest 1024; est. 108 MB GPU with mips vs about
    700 MB at the source sizes); in the page it finished loading 39 ms after the car (parallel). Harness straps:
    the 116 fabric triangles of pilot_seat above 25 % height and ahead of 30 % depth are hidden while the seat is
    taken (669 kept), not checked in a picture.
  - Bloom (look.js) 0.5 / 0.3 / threshold 3.0 -> 0.42 / 0.16 / 7.0, soft knee 3.0: no blobs in the sun sheet.
    Cockpit camera (car): -4 deg / 68-74 fov -> -8 deg / 54-59 fov. Buildings: windows, frames, sills, plinth,
    doors, hangar leaves, garage doors, roof plant; barrier darker with a red and white top band and joints.
