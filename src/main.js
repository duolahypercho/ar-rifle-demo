import * as THREE from 'three/webgpu';
import { Motion } from './motion.js';
import { Character, ROSTER, SPEED } from './character.js';
import { Player } from './player.js';
import { Weapon, MAG_SIZE, handsFromAction } from './weapon.js';
import { Shotgun } from './shotgun.js';
import { Alive } from './alive.js';
import { Sound } from './audio.js';
import { makeReview } from './review.js';
import { Effects } from './fx.js';
import { buildRange } from './range.js';
import { batchWorld, batchModel, NEAR_LAYER, FAR_LAYER } from './batch.js';
import { PERF } from './perf.js';
import { Look } from './look.js';
// pass V1: the driving world, the supercar and the vehicle framework
import { World } from './world.js';
import { Car, WORLD_GROUND } from './car/car.js';
import { CarDash, HeliPanel } from './instruments.js';
import { CarKeys, HeliKeys } from './keys.js';
import { CarSound } from './car/sound.js';
import { Vehicles } from './vehicles.js';
import { PoseInertia } from './inertia.js';
import { emptyHands } from './seated.js';
import { groundAt } from './ground.js';
// pass V2: the helicopter
import { Heli, SHADOW_LAYER } from './heli/heli.js';
import { HeliSound } from './heli/sound.js';
import { HELIPAD } from './track.js';
// pass V7: mirrors
import { CarMirrors } from './mirrors.js';
import { CarDamage, HeliDamage } from './damage.js';
import { Terrain, WEATHER, DETAIL_LAYER, GRASS_LAYER } from './terrain.js';
import { LIGHT, TIME_NAMES } from './look.js';

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('view'),
  backend: $('backend'),
  who: $('who'),
  hits: $('hits'),
  camName: $('camname'),
  ammo: $('ammo'),
  status: $('status'),
  loading: $('loading'),
  cross: $('crosshair'),
  mouse: $('mouse'),
  weapon: $('weapon'),
  swap: $('btn-swap'),
  fire: $('btn-fire'),
  reload: $('btn-reload'),
  aim: $('btn-aim'),
  camera: $('btn-camera'),
  fresh: $('btn-new'),
  picture: $('picture'),
  footHud: $('foot-hud'),
  carHud: $('car-hud'),
  carKeys: $('car-keys'),
  prompt: $('prompt'),
  kmh: $('kmh'),
  rpm: $('rpm'),
  rpmFill: $('rpmfill'),
  gear: $('gear'),
  box: $('box'),
  gmeter: $('gmeter'),
  heliHud: $('heli-hud'),
  heliKeys: $('heli-keys'),
  adi: $('adi'),
  hIas: $('h-ias'),
  hAlt: $('h-alt'),
  hVs: $('h-vs'),
  hNr: $('h-nr'),
  hTq: $('h-tq'),
  hNg: $('h-ng'),
  hEngine: $('h-engine'),
  hAssist: $('h-assist'),
  hFlags: $('h-flags'),
};

const CAMERAS = ['Third person', 'First person'];
// (the site's base path: '/' on the dev server, '/ar-rifle-demo/' on GitHub Pages; see tools/deploy_pages.sh)
const SITE_BASE = import.meta.env.BASE_URL;
const CHARACTER_BASE = SITE_BASE + 'characters/';
// m, the weld's eye from the sight's, gun frame, and the more for each 45 degrees aimed down
// (handling.py AimPose EYE_BACK and EYE_DOWN: per body, its table's cheek.back / cheek.down)
const CHEEK = new THREE.Vector3(0, 0.045, 0.06);
const CHEEK_DOWN = new THREE.Vector3(0, 0.012, 0.01);
// (and for each 45 degrees aimed up: the Tripo player's jaw came down onto the comb; pass R3, its
// table's cheek.up; none on the EarthOnline bodies)
const CHEEK_UP = new THREE.Vector3();
const TAP_HOLD = 0.5; // s a quick trigger press waits for the rifle to come up
const CAR_HOME = { x: 58, z: 14, yaw: 0 }; // where the car is parked: the apron east of the yard, facing north

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

async function main() {
  // Start-up stages (pass F2): performance marks `load:*`; demo.loadTimes() lists the gaps between them.
  performance.mark('load:start');
  // ---------------------------------------------------------------- renderer
  // (V4) ?gputime: GPU timestamps per render pass (tools/v4_cost.js reads them); off in normal play
  const renderer = new THREE.WebGPURenderer({ canvas: ui.canvas, antialias: true, trackTimestamp: new URLSearchParams(location.search).has('gputime') });
  // (V4) render scale: at most 1.5 device pixels per CSS pixel (2048 x 1536 -> 1536 x 1152 in the 1024 x 768 pane, 1.78 x
  // fewer pixels; the GPU's share of a frame 6.2 -> 3.7 ms); a display at 1 or 1.5 is drawn at its own resolution
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.scale ? 1.5 : 2));
  renderer.setSize(Math.max(1, ui.canvas.clientWidth), Math.max(1, ui.canvas.clientHeight), false);
  await renderer.init();
  performance.mark('load:renderer');
  const webgpu = renderer.backend.isWebGPUBackend === true;
  ui.backend.textContent = webgpu ? 'WebGPU' : 'WebGL 2 fallback';
  ui.backend.classList.add(webgpu ? 'webgpu' : 'fallback');

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  // sky, sun, shadows, environment light, haze and the post-processing chain (look.js)
  const look = new Look(renderer, scene);
  performance.mark('load:look');

  // ---------------------------------------------------------------- actors
  const fx = new Effects(scene);
  const player = new Player();
  player.obstacles = buildRange(scene, fx);
  player.pos.set(0, 0, 1.5);
  // (pass V1) the world round the yard; the player may walk all of it
  const world = new World(scene, fx, player.obstacles);
  // (V4) the yard's and the world's static meshes merged per material, their shadows into patch proxies
  world.batch = batchWorld(scene);
  // (V7) the rolling ground, grass, trees, hills, clouds, furniture and the wind (terrain.js)
  const terrain = new Terrain(scene, world.ground);
  performance.mark('load:terrain');
  player.bounds = { minX: -2500, maxX: 2500, minZ: -2500, maxZ: 2500 };
  const car = new Car(scene);
  car.groundAt = (x, z) => groundAt(x, z);
  const carLoaded = car.load(SITE_BASE + 'vehicles/supercar.glb', SITE_BASE + 'vehicles/supercar_specs.json').then(() => {
    car.place(CAR_HOME.x, CAR_HOME.z, CAR_HOME.yaw);
    car.dash = new CarDash(car); // (V5) the live cluster and centre screen
    // (V7) the rear-view and door mirrors, rendered from their virtual eyes before each picture
    car.mirrors = new CarMirrors(renderer, scene, car);
    car.mirrors.build();
    look.before.push((cam, lk) => car.mirrors.update(cam, lk));
    // (V7) dents, scrapes, cracked glass, broken lamps and mirrors, a bent steering arm (damage.js)
    car.damage = new CarDamage(car);
    car.damage.init();
    performance.mark('load:car');
  });

  // (pass V2) the helicopter, parked cold on the helipad, nose north
  const heli = new Heli(scene);
  look.sun.shadow.camera.layers.enable(SHADOW_LAYER); // (the spinning blades: shadow only)
  look.sun.shadow.camera.layers.enable(NEAR_LAYER); // ((V4) batch.js's shadow proxies; look.js picks per cascade)
  look.sun.shadow.camera.layers.enable(FAR_LAYER);
  const heliLoaded = heli.load(SITE_BASE + 'vehicles/utility_helicopter.glb', SITE_BASE + 'vehicles/utility_helicopter_specs.json').then(() => {
    heli.place(HELIPAD.x, HELIPAD.z, 0);
    heli.panel = new HeliPanel(heli); // (V5) the live displays
    heli.damage = new HeliDamage(heli); // (V7) bent skids, tail strikes
    heli.damage.init();
    performance.mark('load:heli');
  });

  // One clip pack per body family (the roster entry names it: rifle-motion-tripo-v1 for the Tripo
  // player, rifle-motion-ue5-v1 for the EarthOnline bodies), loaded the first time a body needs it.
  const motions = new Map();
  const motionFor = (entry) => {
    if (!motions.has(entry.pack)) {
      const frames = entry.frames ? fetch(CHARACTER_BASE + entry.frames).then((r) => r.json()) : Promise.resolve(null);
      motions.set(entry.pack, frames.then((f) => new Motion().load(CHARACTER_BASE, entry.pack, f)));
    }
    return motions.get(entry.pack);
  };
  let motion = null;
  const rifle = new Weapon();
  const shotgun = new Shotgun();
  [motion] = await Promise.all([motionFor(ROSTER[0]), rifle.load(SITE_BASE + 'ar_rifle.glb'), shotgun.load(SITE_BASE + 'pump_shotgun.glb'), carLoaded, heliLoaded]);
  performance.mark('load:pack+guns');
  rifle.clips = shotgun.clips = motion.actions; // the reloads and the pump
  // (V4) each gun's parts merged per material except what moves (batch.js): 24 draws a pass -> 10
  rifle.batch = batchModel(rifle.pivot, { anchors: ['magazine', 'charging_handle', 'trigger'], keep: (o) => o.name === 'muzzle_point', far: false });
  shotgun.batch = batchModel(shotgun.pivot, { anchors: ['pump', 'trigger'], keep: (o) => o.name === 'muzzle_point' || o === shotgun.shell, far: false });
  const alive = new Alive();
  const sound = new Sound();
  const carSound = new CarSound(sound);
  const heliSound = new HeliSound(sound);
  let weapon = rifle; // in the hands
  let other = shotgun; // slung across the back
  const character = new Character(scene, motion);
  // the controller plays the locomotion transitions, timed by the character's footfalls
  player.motion = motion;
  player.legs = character;
  scene.add(rifle.pivot, shotgun.pivot);
  look.dressGun(rifle.pivot);
  look.dressGun(shotgun.pivot);
  fx.attachFlash(weapon.nodes.muzzle_point);

  // The first body in the roster is the Tripo player; the button steps through the EarthOnline bodies.
  let bodyIndex = 0;
  let bodyBusy = false;
  const showBody = async (index) => {
    if (bodyBusy) return;
    bodyBusy = true;
    ui.who.textContent = 'loading character…';
    try {
      bodyIndex = ((index % ROSTER.length) + ROSTER.length) % ROSTER.length;
      const pack = await motionFor(ROSTER[bodyIndex]);
      const entry = await character.use(ROSTER[bodyIndex], CHARACTER_BASE, pack);
      // the body's own clips from here on: the gait, the transitions, the reloads, swaps and hits
      motion = pack;
      player.motion = pack;
      rifle.clips = shotgun.clips = pack.actions;
      rifle.fitBody(character.table);
      shotgun.fitBody(character.table);
      CHEEK.fromArray(character.table.cheek.back);
      CHEEK_DOWN.fromArray(character.table.cheek.down);
      CHEEK_UP.fromArray(character.table.cheek.up || [0, 0, 0]);
      if (character.table.atlas) look.dressBody(character.model); // (EarthOnline's atlas channels)
      // (pass V1) the body family's vehicle clips, if they have been built; the placeholder if not
      const frames = ROSTER[bodyIndex].frames ? await fetch(CHARACTER_BASE + ROSTER[bodyIndex].frames).then((r) => r.json()) : null;
      vehicles.loadPack(ROSTER[bodyIndex], CHARACTER_BASE, frames).then((pack) => console.info(pack ? `vehicle pack ${pack.name}: ${Object.keys(pack.clips).join(', ')}` : 'no vehicle pack yet: the seated IK placeholder is used'));
      ui.who.textContent = `${entry.source} · ${entry.label}`;
    } catch (err) {
      console.error(err);
      ui.who.textContent = `could not load ${ROSTER[bodyIndex].file}`;
    } finally {
      bodyBusy = false;
    }
  };
  const nextBody = () => showBody(bodyIndex + 1);
  const vehicles = new Vehicles({ car, heli, character, player, sound, carSound });
  // (V6) the pose carried across each hand-over between what poses the body (inertia.js)
  let inertia = null;
  const inert = () => inertia || (character.bones ? (inertia = new PoseInertia(character)) : null);
  await showBody(0);
  performance.mark('load:body');

  // ---------------------------------------------------------------- camera
  const camera = new THREE.PerspectiveCamera(46, 1, 0.03, 3000);
  camera.layers.enable(DETAIL_LAYER); // ((V7) the world's detail: terrain.js)
  camera.layers.enable(GRASS_LAYER); // ((V8) the grass: the lit pass only, flora.js / look.js)
  camera.position.set(0.5, 1.7, 4.5);
  look.setCamera(camera);
  look.focus = player.pos;
  let cameraMode = 0;
  const setCamera = (mode) => {
    cameraMode = mode % CAMERAS.length;
    player.firstPerson = cameraMode === 1;
    character.setFirstPerson(player.firstPerson);
    ui.camName.textContent = CAMERAS[cameraMode];
  };
  setCamera(0);
  const setQuality = (quality) => {
    if (ui.picture) ui.picture.textContent = quality === 'full' ? 'Full' : 'Plain';
  };
  setQuality(look.quality);

  // ---------------------------------------------------------------- input
  const input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    jog: false, // toggled: jog instead of walking
    aim: false, // worked out each frame from the two below
    aimHeld: false,
    aimToggle: false,
    fire: false, // worked out each frame from the ones below
    fireKey: false,
    fireMouse: false,
    fireButton: false,
    tap: 0, // s left for a quick press to turn into a shot
    reload: false,
    swap: null, // the weapon asked for, or 'other'
    lookX: 0,
    lookY: 0,
  };
  const setAimToggle = (on) => {
    input.aimToggle = on;
    ui.aim.classList.toggle('down', on);
  };
  // (pass V1) the car's controls while in it
  const drive = { throttle: false, brake: false, left: false, right: false, handbrake: false, steer: 0 };
  const carKeys = new CarKeys(); // (V5) keys -> shaped steering, throttle, brake (keys.js)
  const heliKeys = new HeliKeys();
  const setIndicator = (side) => {
    car.indicator = side;
    car.indicatorFrom = car.dyn.steerWheel;
    car.indicatorPeak = 0;
  };
  const carPress = (code, down) => {
    const d = car.dyn;
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        drive.throttle = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        drive.brake = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        drive.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        drive.right = down;
        break;
      case 'Space':
        drive.handbrake = down;
        break;
      case 'KeyE':
        if (down) d.input.shiftUp = true;
        break;
      case 'KeyQ':
        if (down) d.input.shiftDown = true;
        break;
      case 'KeyM':
        if (down) d.auto = !d.auto;
        break;
      case 'KeyL':
        if (down) car.headlights = !car.headlights;
        break;
      case 'KeyI':
        // (V5) the engine: start (lamp check, starter, fire) or stop (below 5 km/h)
        if (down) {
          if (car.dyn.ignition === 'off') car.startSequence();
          else if (Math.abs(d.speed) < 1.4) {
            car.switchOff();
            car.userOff = true;
          }
        }
        break;
      case 'KeyZ':
        if (down) setIndicator(car.indicator < 0 ? 0 : -1);
        break;
      case 'KeyC':
        if (down) setIndicator(car.indicator > 0 ? 0 : 1);
        break;
      case 'KeyP':
        if (down) car.nextPaint();
        break;
      case 'KeyV':
        if (down) ui.camName.textContent = vehicles.cameras.cycle();
        break;
      case 'KeyT':
      case 'Enter':
        if (down) vehicles.toggle();
        break;
      case 'KeyG':
        if (down) setQuality(look.cycle());
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        // (V7) held: lean in to the instruments (cockpit view)
        vehicles.carCams.leanHeld = down;
        break;
      case 'Digit0':
        if (down) repair(); // (V7) both vehicles as new
        break;
      case 'Digit9':
        if (down) nextTime(); // (V7) the time of day
        break;
      case 'Digit8':
        if (down) nextWind(); // (V7) the wind: calm, 3, 6, 10 m/s
        break;
      default:
        return false;
    }
    return true;
  };
  // (pass V2) the helicopter's controls while in it: rates held by keys, the lever stays where it is put
  const fly = { fwd: false, back: false, left: false, right: false, pedL: false, pedR: false, up: false, down: false, lever: 0, cp: 0, cr: 0, ped: 0, mouse: false };
  const heliPress = (code, down) => {
    const fm = heli.fm;
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        fly.fwd = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        fly.back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        fly.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        fly.right = down;
        break;
      case 'KeyQ':
        fly.pedL = down;
        break;
      case 'KeyE':
        fly.pedR = down;
        break;
      case 'KeyR':
      case 'PageUp':
        fly.up = down;
        break;
      case 'KeyF':
      case 'PageDown':
        fly.down = down;
        break;
      case 'KeyI':
        // (V5) I starts a cold engine and shuts a running one down on the ground (idle, cool-down, fuel off, rotor
        // brake below 40 %)
        if (down && !heli.damaged) {
          if (fm.state.engine.lit && !fm.state.engine.starter) {
            if (heli.shutdown()) fly.lever = 0;
          } else if (!heli.shut) {
            heli.power = true;
            fm.controls.rotorBrake = 0;
            fm.startEngine({ quick: false });
          }
        }
        break;
      case 'KeyY':
        // (V5) force trim: with the assist off the stick and pedals' trim point becomes where they are; with it on,
        // the attitude it holds hands-off becomes the attitude now (within 10 deg), e.g. the hover's left skid low
        if (down) {
          if (heli.assist.enabled) {
            const s = heli.state;
            heli.assist.pitchTrim = THREE.MathUtils.clamp(s.pitch, -0.17, 0.17);
            heli.assist.rollTrim = THREE.MathUtils.clamp(s.bank, -0.17, 0.17);
          } else heliKeys.setTrim();
        }
        break;
      case 'KeyU':
        if (down && !heli.damaged && !heli.shut) {
          heli.power = true;
          fm.controls.rotorBrake = 0;
          fm.startEngine({ quick: true });
        }
        break;
      case 'KeyO':
        if (down) fm.cutEngine();
        break;
      case 'KeyJ':
        if (down) {
          heli.assist.enabled = !heli.assist.enabled;
          // (V5) switched off, the raw stick's trim is what the assist was giving: letting go keeps the aircraft
          if (!heli.assist.enabled) {
            const c = heli.state.controls;
            heliKeys.setTrim({ cp: c.cyclicPitch, cr: c.cyclicRoll, ped: c.pedal });
            heliKeys.cp = c.cyclicPitch;
            heliKeys.cr = c.cyclicRoll;
            heliKeys.ped = c.pedal;
          } else heliKeys.cp = heliKeys.cr = heliKeys.ped = 0;
          heli.assist.reset(heli.state);
        }
        break;
      case 'KeyH':
        if (down) {
          const on = heli.assist.toggle('hoverHold');
          if (!on) fly.lever = heli.state.controls.collective; // (the lever where the hold left it)
        }
        break;
      case 'KeyK':
        if (down) fly.mouse = !fly.mouse;
        break;
      case 'KeyL':
        if (down) heli.landingLight = !heli.landingLight;
        break;
      case 'KeyV':
        if (down) ui.camName.textContent = vehicles.cameras.cycle();
        break;
      case 'KeyT':
      case 'Enter':
        // (V5) on the ground with the rotor turning: the shutdown first; he gets out once the blades have stopped
        if (down) {
          const r = vehicles.toggle();
          if (r === 'rotor') {
            if (heli.shutdown()) fly.lever = 0;
            heli.exitWhenStopped = !!heli.shut || heli.exitWhenStopped;
          }
        }
        break;
      case 'KeyG':
        if (down) setQuality(look.cycle());
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        // (V7) held: the pilot leans in to read the displays (cockpit view)
        vehicles.heliCams.leanHeld = down;
        break;
      case 'Digit0':
        if (down) repair(); // (V7) both vehicles as new
        break;
      case 'Digit9':
        if (down) nextTime(); // (V7) the time of day
        break;
      case 'Digit8':
        if (down) nextWind(); // (V7) the wind: calm, 3, 6, 10 m/s
        break;
      default:
        return false;
    }
    return true;
  };
  const press = (code, down) => {
    if (vehicles.mode !== 'foot') {
      // (getting in, sitting, getting out: the vehicle's keys; on the way to it, nothing but the look)
      if (vehicles.inside) return vehicles.kind === 'heli' ? heliPress(code, down) : carPress(code, down);
      return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyR', 'KeyE', 'KeyQ', 'KeyT'].includes(code);
    }
    switch (code) {
      case 'KeyT':
      case 'Enter':
        if (down) vehicles.toggle();
        break;
      case 'KeyW':
      case 'ArrowUp':
        input.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        input.back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        input.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        input.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        input.sprint = down;
        break;
      case 'Space':
      case 'KeyF':
        input.fireKey = down;
        if (down) input.tap = TAP_HOLD;
        break;
      case 'KeyR':
        if (down) input.reload = true;
        break;
      case 'KeyE':
        if (down) input.swap = 'other';
        break;
      case 'Digit1':
        if (down) input.swap = rifle;
        break;
      case 'Digit2':
        if (down) input.swap = shotgun;
        break;
      case 'KeyQ':
        if (down) setAimToggle(!input.aimToggle);
        break;
      case 'KeyX':
        if (down) input.jog = !input.jog;
        break;
      case 'KeyC':
        // (not Ctrl: Ctrl+W closes the browser tab)
        if (down) player.toggleCrouch();
        break;
      case 'KeyV':
        if (down) setCamera(cameraMode + 1);
        break;
      case 'KeyN':
        if (down) nextBody();
        break;
      case 'KeyG':
        if (down) setQuality(look.cycle());
        break;
      case 'KeyB':
        if (down) sound.speech = !sound.speech; // spoken calls on or off
        break;
      case 'Digit0':
        if (down) repair(); // (V7) both vehicles as new
        break;
      case 'Digit9':
        if (down) nextTime(); // (V7) the time of day
        break;
      case 'Digit8':
        if (down) nextWind(); // (V7) the wind: calm, 3, 6, 10 m/s
        break;
      case 'KeyH':
        // debug: be struck, each press from the next way round (front, right, back, left), every
        // fifth press a heavy blow from the front or back
        if (down) {
          const n = hitPresses++;
          if (n % 5 === 4) strike(n % 10 === 4 ? 'f' : 'b', 0.9);
          else strike('frbl'[n % 5], 0.45);
        }
        break;
      default:
        return false;
    }
    return true;
  };
  window.addEventListener('pointerdown', () => sound.unlock());
  window.addEventListener('keydown', (ev) => {
    sound.unlock(); // browsers only allow sound after a click or a key
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (press(ev.code, true)) ev.preventDefault();
  });
  window.addEventListener('keyup', (ev) => {
    press(ev.code, false);
  });
  const release = () => {
    drive.throttle = drive.brake = drive.left = drive.right = drive.handbrake = false;
    fly.fwd = fly.back = fly.left = fly.right = fly.pedL = fly.pedR = fly.up = fly.down = false;
    vehicles.carCams.leanHeld = vehicles.heliCams.leanHeld = false;
    input.forward = input.back = input.left = input.right = input.sprint = false;
    input.fireKey = input.fireMouse = input.fireButton = input.aimHeld = false;
    ui.fire.classList.remove('down');
  };
  window.addEventListener('blur', release);

  // Mouse: the first click on the view captures the pointer; after that moving looks, the
  // left button fires and the right button aims. Where capture is refused, dragging looks.
  const canvas = ui.canvas;
  const captured = () => document.pointerLockElement === canvas;
  let dragging = false;
  canvas.addEventListener('pointerdown', (ev) => {
    if (captured()) {
      if (ev.button === 0) {
        input.fireMouse = true;
        input.tap = TAP_HOLD;
      } else if (ev.button === 2) input.aimHeld = true;
      return;
    }
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    if (ev.button === 2) input.aimHeld = true;
    else if (ev.pointerType === 'mouse' && ev.button === 0 && canvas.requestPointerLock) {
      const asked = canvas.requestPointerLock();
      if (asked && asked.catch) asked.catch(() => {}); // refused: dragging still works
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!captured() && !dragging) return;
    input.lookX += ev.movementX;
    input.lookY += ev.movementY;
  });
  const pointerUp = (ev) => {
    if (ev.button === 0) input.fireMouse = false;
    if (ev.button === 2) input.aimHeld = false;
    dragging = false;
  };
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const on = captured();
    ui.mouse.textContent = on ? 'Esc frees the mouse' : 'Click the view to capture the mouse';
    if (!on) input.fireMouse = input.aimHeld = false;
  });

  const holdFire = (down) => {
    input.fireButton = down;
    if (down) input.tap = TAP_HOLD;
    ui.fire.classList.toggle('down', down);
  };
  ui.fire.addEventListener('pointerdown', (ev) => {
    ui.fire.setPointerCapture(ev.pointerId);
    holdFire(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    ui.fire.addEventListener(type, () => holdFire(false));
  }
  ui.reload.addEventListener('click', () => (input.reload = true));
  ui.swap.addEventListener('click', () => (input.swap = 'other'));
  ui.aim.addEventListener('click', () => setAimToggle(!input.aimToggle));
  ui.camera.addEventListener('click', () => setCamera(cameraMode + 1));
  ui.fresh.addEventListener('click', nextBody);
  for (const button of [ui.fire, ui.reload, ui.aim, ui.swap, ui.camera, ui.fresh]) {
    button.addEventListener('keydown', (ev) => ev.code === 'Space' && ev.preventDefault()); // Space fires, never clicks
    button.addEventListener('click', () => button.blur());
  }

  // The canvas can be 0 x 0 while its tab or pane is hidden; WebGPU cannot make a swap chain
  // that small, so sizing follows the element and rendering waits until it has an area.
  let viewW = 0;
  let viewH = 0;
  const resize = () => {
    viewW = ui.canvas.clientWidth;
    viewH = ui.canvas.clientHeight;
    if (viewW === 0 || viewH === 0) return;
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    renderer.setSize(viewW, viewH, false);
  };
  new ResizeObserver(resize).observe(ui.canvas);
  resize();

  // ---------------------------------------------------------------- frame
  const rootQuat = new THREE.Quaternion();
  const aimPoint = new THREE.Vector3();
  const sight = new THREE.Vector3();
  const eyeSeat = new THREE.Vector3();
  const viewFrom = new THREE.Vector3().copy(camera.position); // where the player's camera is
  let debugView = null; // { az, el, dist, y }: look at the character from outside instead
  const ctx = { rootQuat, wantFire: false, canFire: false, wantReload: false, aimPoint, spread: 0, fx, act: character.act, chestPos: character.chestPos, chestQuat: character.chestQuat };
  const body = { speed: 0, heading: 0, moving: false, strafe: false, aim: 0, ready: 0, sprint: 0, lookYaw: 0, lookPitch: 0, pitch: 0, twist: 0, leanPitch: 0, leanRoll: 0, recoil: 0, recoilTwist: 0 };
  const hold = { chestPos: character.chestPos, chestQuat: character.chestQuat, gunPos: character.gunPos, gunQuat: character.gunQuat, pocket: null, aimQuat: player.aimQuat, aim: 0, sprint: 0, firstPerson: false, dt: 0, clear: null };
  const clear = (points, count, dir, margin) => character.clearance(points, count, dir, margin);
  let lastHands = null;
  const reach = { left: new THREE.Vector3(), right: new THREE.Vector3(), arm: 0.5 };
  const idle = { rootQuat, wantFire: false, canFire: false, wantReload: false, aimPoint, spread: 0, fx, act: null };
  const standing = { standing: true, aim: 0, busy: false };
  // The weapon swap: a handling clip (swap-<from>-<to>, Motion.actions) played over the upper
  // body. `out` is the gun going onto the back (the clip's Gun track), `in` the one coming off it
  // (GunIn); the hands change guns at the clip's handOver moment.
  let swap = null; // { clip, t, out, in, handed }
  // A hit reaction (hit-light-<way>, hit-heavy-<f|b>, Motion.actions) played over everything else
  // as a difference from the low hold (character.js); `w` scales it by the blow's strength.
  let struck = null; // { clip, t, w }
  let hitPresses = 0;
  const gaze = { point: new THREE.Vector3(), work: false, aim: 0, fired: false };
  let firedLast = false;
  const strike = (way, strength = 0.5) => {
    const r = player.hit(way, strength);
    const clip = motion.actions[`hit-${r.heavy ? 'heavy' : 'light'}-${way}`];
    struck = clip ? { clip, t: 0, w: Math.min(1, r.heavy ? strength : 0.4 + strength) } : null;
    sound.hit(r.heavy);
    sound.grunt(r.heavy);
    return struck;
  };
  const EASE = 0.2; // s over which a gun goes from the gait clips' hold to a handling clip's and back
  const SWAP_SOUNDS = { draw: 'sling', slung: 'sling' };
  const actionHands = { rPalm: new THREE.Vector3(), rQuat: new THREE.Quaternion(), rCurl: 1, rIndex: 0, lPalm: new THREE.Vector3(), lQuat: new THREE.Quaternion(), lCurl: 1, lElbow: null, rElbow: null };
  const slung = { slung: true, chestPos: character.chestPos, chestQuat: character.chestQuat, gunPos: new THREE.Vector3(), gunQuat: new THREE.Quaternion() };
  const inPos = new THREE.Vector3();
  const inQuat = new THREE.Quaternion();
  /** Where a gun hangs on the back, in track terms (the clips' stow, less its carry shift). */
  const stowOf = (gun, pos, quat) => {
    const stow = motion.stow[gun.key];
    pos.copy(stow.pos).sub(gun.carryShift);
    quat.copy(stow.quat);
  };
  const ramp = (x) => THREE.MathUtils.smoothstep(x, 0, 1);
  // (V3) where the guns lie in each cabin, in the vehicle root's frame (glTF: +X right, +Y up, -Z forward):
  // the butt, the muzzle, and which way the gun's top faces. They go there as the door shuts (the door hides
  // the moment: the guns leave the back behind the closed door and the seated body) and back onto the back as it
  // opens. Car: across the passenger seat's cushion and down into its footwell, on their sides; helicopter: on
  // the left front seat's footwell, butts on the floor, leaning back against the cushion's front edge.
  const CABIN_GUNS = {
    car: {
      rifle: { butt: [0.3, 0.43, 0.15], muzzle: [0.33, 0.26, -0.7], up: [-1, 0.25, 0] },
      shotgun: { butt: [0.45, 0.42, 0.17], muzzle: [0.42, 0.25, -0.7], up: [1, 0.25, 0] },
    },
    heli: {
      rifle: { butt: [-0.55, 0.9, -1.8], muzzle: [-0.52, 1.6, -1.49], up: [0, 0.35, -1] },
      shotgun: { butt: [-0.33, 0.86, -1.78], muzzle: [-0.35, 1.6, -1.45], up: [0, 0.35, -1] },
    },
  };
  // (V3) Doppler: each vehicle's sound pitched by its speed toward the listener (the camera) relative to the
  // listener's own; riding along (cockpit, chase) leaves it at 1. Measured offline, a 220 km/h pass had no shift.
  const _ear = { last: new THREE.Vector3(), vel: new THREE.Vector3(), n: new THREE.Vector3() };
  const doppler = (pos, vel) => {
    const n = _ear.n.subVectors(camera.position, pos);
    const d = n.length();
    if (d < 1) return 1;
    n.divideScalar(d);
    const vs = vel.x * n.x + vel.y * n.y + vel.z * n.z;
    const vl = _ear.vel.dot(n);
    return THREE.MathUtils.clamp((343 - vl) / (343 - vs), 0.6, 1.6);
  };
  // (the camera's own velocity, from where it was on the last step)
  const earStep = (dt) => {
    if (dt > 0) _ear.vel.subVectors(camera.position, _ear.last).divideScalar(dt).clampLength(0, 120);
    _ear.last.copy(camera.position);
  };
  const cabinFrame = { slung: true, chestPos: new THREE.Vector3(), chestQuat: new THREE.Quaternion(), gunPos: new THREE.Vector3(), gunQuat: new THREE.Quaternion() };
  const _cb = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const _cm = [new THREE.Matrix4(), new THREE.Matrix4()];
  const cabinGuns = (veh, kind) => {
    const root = veh.root;
    root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    for (const gun of [rifle, shotgun]) {
      const c = CABIN_GUNS[kind][gun.key] || CABIN_GUNS[kind].rifle;
      const [f, u, F, U, x] = _cb;
      f.fromArray(c.muzzle).sub(x.fromArray(c.butt)).normalize();
      u.fromArray(c.up);
      u.addScaledVector(f, -u.dot(f)).normalize();
      // the gun's own bore and top (pivot frame) onto them
      F.copy(gun.boreLocal).normalize();
      U.set(0, 1, 0).addScaledVector(F, -F.y).normalize();
      _cm[0].makeBasis(f, u, x.crossVectors(f, u));
      _cm[1].makeBasis(F, U, new THREE.Vector3().crossVectors(F, U));
      cabinFrame.chestQuat.setFromRotationMatrix(_cm[0].multiply(_cm[1].invert())).premultiply(rq);
      root.localToWorld(cabinFrame.chestPos.fromArray(c.butt));
      cabinFrame.gunPos.copy(gun.carryShift).negate();
      cabinFrame.gunQuat.identity();
      gun.place(cabinFrame);
      gun.pivot.position.copy(gun.basePos);
      gun.pivot.quaternion.copy(gun.baseQuat);
      gun.pivot.updateMatrixWorld(true);
    }
  };
  // (V4) getting in: the guns leave the back for the cabin at the moment the body turns its back to the cabin (the
  // car's entry, about f72 of car-enter: from there the back faces the seat and the sill, where the guns went 5 to 7 cm
  // in at f153 and the shotgun into the door at f93) or, in the helicopter, where the pilot climbs in facing the cabin,
  // when he has turned to sit with his back to the seat's; the body is between them and the camera on the entry side.
  // Getting out, they go back on the back once the hips are clear of the doorway. There is no hand-off clip: this is the swap
  // a camera on the entry side does not see.
  let gunsAboard = false;
  const _gb = new THREE.Vector3();
  const _gq = new THREE.Quaternion();
  const _gq2 = new THREE.Quaternion();
  const gunsInCabin = (veh, kind, doorShut) => {
    const mode = vehicles.mode;
    if (demo.gunsAtDoor) return vehicles.gunsHidden && doorShut; // (V3's rule, for comparing: demo.gunsAtDoor = true)
    if (vehicles.gunsHidden && doorShut) return (gunsAboard = true);
    if (mode !== 'entering' && mode !== 'leaving' && mode !== 'seated') return (gunsAboard = false);
    const local = veh.root.worldToLocal(_gb.copy(character.root.position));
    const inboard = kind === 'heli' ? -1 : 1; // (the car is entered on its left, the helicopter on its right)
    const doorway = kind === 'heli' ? 1.0 : 0.95; // m from the centre line
    if (mode === 'entering') {
      const lateral = local.x * -inboard; // (how far out on the entry side)
      veh.root.getWorldQuaternion(_gq).invert();
      _gb.set(0, 0, 1).applyQuaternion(character.root.getWorldQuaternion(_gq2)).applyQuaternion(_gq); // the back
      // (the car: the back to the cabin; the helicopter, where the pilot climbs in facing the cabin with his back to
      // the entry side, only once he has turned to sit, his back to the seat's, inside the doorway)
      if (kind === 'car' ? _gb.x * inboard > 0.7 : _gb.z > 0.7 && lateral < doorway) gunsAboard = true;
    } else if (mode === 'leaving' && Math.abs(local.x) > doorway + 0.4) gunsAboard = false;
    return gunsAboard;
  };
  // (V7) the clip's own hand-off of the guns (the second request's contract): a clip's notes may carry `guns: {from, to,
  // rifle: [[x, y, z, qx, qy, qz, qw] per frame], shotgun: [...]}` in the vehicle root's frame. Entering: on the back
  // before `from`, on the track from `from` to `to`, at the cabin places (CABIN_GUNS) after; leaving, the reverse.
  // Per-frame arrays may cover the clip (length = its frames) or only from..to. Packs without it use gunsInCabin's rule.
  const gunTrack = () => {
    const v = vehicles;
    if (!v.usingPack || !v.clip || (v.mode !== 'entering' && v.mode !== 'leaving')) return null;
    const g = v.clip.note && v.clip.note.guns;
    if (!g || !(g.from >= 0) || !(g.to >= g.from)) return null;
    const f = Math.min(v.t, v.clip.duration) * 30;
    const exit = v.mode === 'leaving';
    if (f < g.from) return { at: exit ? 'cabin' : 'back' };
    if (f > g.to) return { at: exit ? 'back' : 'cabin' };
    return { at: 'track', f, g, frames: v.clip.frames };
  };
  const _tp = [new THREE.Vector3(), new THREE.Vector3()];
  const _tq = [new THREE.Quaternion(), new THREE.Quaternion()];
  const trackGuns = (veh, tr) => {
    const root = veh.root;
    root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    for (const gun of [rifle, shotgun]) {
      const arr = tr.g[gun.key] || tr.g.rifle;
      if (!arr || !arr.length) continue;
      const base = arr.length >= tr.frames ? 0 : tr.g.from;
      const x = THREE.MathUtils.clamp(tr.f - base, 0, arr.length - 1);
      const i0 = Math.floor(x);
      const i1 = Math.min(arr.length - 1, i0 + 1);
      const u = x - i0;
      _tp[0].fromArray(arr[i0], 0).lerp(_tp[1].fromArray(arr[i1], 0), u);
      _tq[0].fromArray(arr[i0], 3).slerp(_tq[1].fromArray(arr[i1], 3), u);
      // (the track keys the gun's own frame as the packs' Gun node does: placed as the stow places it, less the carry shift)
      root.localToWorld(cabinFrame.chestPos.copy(_tp[0]));
      cabinFrame.chestQuat.copy(rq).multiply(_tq[0]);
      cabinFrame.gunPos.copy(gun.carryShift).negate();
      cabinFrame.gunQuat.identity();
      gun.place(cabinFrame);
      gun.pivot.position.copy(gun.basePos);
      gun.pivot.quaternion.copy(gun.baseQuat);
      gun.pivot.updateMatrixWorld(true);
    }
  };
  /** The guns in a vehicle mode this frame: the clip's track if it has one, else the V4 rule. */
  const placeVehicleGuns = (veh, kind, doorShut) => {
    const tr = gunTrack();
    rifle.pivot.visible = shotgun.pivot.visible = true;
    const at = tr ? tr.at : gunsInCabin(veh, kind, doorShut) ? 'cabin' : 'back';
    if (tr) gunsAboard = at !== 'back';
    if (at === 'track') trackGuns(veh, tr);
    else if (at === 'cabin') cabinGuns(veh, kind);
    else {
      for (const gun of [weapon, other]) {
        stowOf(gun, slung.gunPos, slung.gunQuat);
        gun.place(slung);
        // (V3: place() only sets the hold; nothing moved the pivots in a vehicle, so the guns stayed where the
        // last on-foot frame left them while the body walked into the seat)
        gun.pivot.position.copy(gun.basePos);
        gun.pivot.quaternion.copy(gun.baseQuat);
      }
    }
    demo.gunsAt = at;
    return at;
  };
  /** (V7) The time of day: midday, late afternoon, dusk, night (look.setTime), and what follows it here. */
  const setTime = (name) => {
    look.setTime(name);
    terrain.lamps.value = LIGHT.lamps;
    terrain.haze.value.setRGB(...LIGHT.haze);
    terrain.light(LIGHT.cloudSun, LIGHT.cloudSky);
    // (the headlamps come on by themselves at dusk and at night, as an automatic headlamp switch does)
    if (LIGHT.lamps > 0) car.headlights = true;
    return name;
  };
  const nextTime = () => setTime(TIME_NAMES[(TIME_NAMES.indexOf(look.time) + 1) % TIME_NAMES.length]);
  setTime('afternoon');
  const WINDS = [0, 3, 6, 10];
  const nextWind = () => {
    const i = WINDS.findIndex((w) => w >= WEATHER.speed - 0.01);
    WEATHER.speed = WINDS[(i + 1) % WINDS.length];
    return WEATHER.speed;
  };
  /** (V7) Both vehicles as new: the car's dents, scrapes, glass, lamps, mirrors and steering; the helicopter's skids. */
  const repair = () => {
    if (car.damage) car.damage.repair();
    if (heli.damage) heli.damage.repair();
  };
  let timeScale = 1;
  let shown = { ammo: -1, status: '', hits: -1, gap: -1, fade: -1 };

  // ---- (pass V1) vehicles ----
  // stow: the swap clip's outgoing half, forwards (the gun onto the back) or backwards (off it)
  let stow = null; // { clip, t, dir }
  let handsFree = false; // both guns on the back
  const emptyOut = {};
  const standBody = {};
  let revHold = 0;
  let lastDoor = 0;
  let lastGearSeen = null;
  const carView = new THREE.Vector3();
  const updateCarHud = () => {
    const d = car.dyn;
    const kmh = Math.round(Math.abs(d.speed) * 3.6);
    if (kmh !== shown.kmh) ui.kmh.textContent = String((shown.kmh = kmh));
    const rpm = Math.round(d.rpm / 50) * 50;
    if (rpm !== shown.rpm) {
      shown.rpm = rpm;
      ui.rpm.textContent = String(rpm);
      ui.rpmFill.style.width = `${Math.min(100, (d.rpm / 9000) * 100).toFixed(1)}%`;
    }
    const gear = d.shift ? `${d.gearName}·` : d.gearName;
    if (gear !== shown.gear) ui.gear.textContent = shown.gear = gear;
    const box = d.auto ? 'auto' : 'manual';
    if (box !== shown.box) ui.box.textContent = shown.box = box;
    // the g-meter: a dot for the car's acceleration (lateral across, longitudinal up), rings at 0.5 and 1 g
    const g = ui.gmeter.getContext('2d');
    g.clearRect(0, 0, 96, 96);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    for (const r of [20, 40]) {
      g.beginPath();
      g.arc(48, 48, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(8, 48);
    g.lineTo(88, 48);
    g.moveTo(48, 8);
    g.lineTo(48, 88);
    g.stroke();
    const gx = THREE.MathUtils.clamp(d.accBody.x / 9.81, -1.5, 1.5) * 40;
    const gy = THREE.MathUtils.clamp(d.accBody.z / 9.81, -1.5, 1.5) * 40; // braking up
    g.fillStyle = '#f2c94c';
    g.beginPath();
    g.arc(48 + gx, 48 - gy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '10px sans-serif';
    g.fillText(`${Math.hypot(d.accBody.x, d.accBody.z) / 9.81 >= 0.05 ? (Math.hypot(d.accBody.x, d.accBody.z) / 9.81).toFixed(2) : '0.00'} g`, 4, 94);
  };
  const showCarHud = (on) => {
    if (ui.carHud.hidden === !on) return;
    ui.carHud.hidden = !on;
    ui.footHud.hidden = on;
    ui.carKeys.hidden = !on;
    ui.camName.textContent = on ? vehicles.cameras.names[vehicles.cameras.mode] : CAMERAS[cameraMode];
  };

  // ---- (pass V2) the helicopter ----
  const toward = (x, to, rate, dt) => x + THREE.MathUtils.clamp(to - x, -rate * dt, rate * dt);
  /** The pilot's inputs this frame -> the assist (or straight through) -> the flight model. */
  const heliControls = (dt, seated) => {
    const fm = heli.fm;
    if (demo.heliInput) {
      demo.heliInput(heli, dt);
      return;
    }
    if (!seated) {
      // (getting in or out: hands off, the lever down)
      fm.setControls({ cyclicPitch: 0, cyclicRoll: 0, pedal: 0, collective: Math.min(fm.controls.collective, fly.lever) });
      return;
    }
    // keyboard: the stick and pedals move at a rate toward where the keys hold them, and back to centre
    const want = { cp: (fly.fwd ? 1 : 0) - (fly.back ? 1 : 0), cr: (fly.right ? 1 : 0) - (fly.left ? 1 : 0), ped: (fly.pedR ? 1 : 0) - (fly.pedL ? 1 : 0) };
    if (fly.mouse) {
      fly.cp = THREE.MathUtils.clamp(fly.cp - input.lookY * 0.004, -1, 1);
      fly.cr = THREE.MathUtils.clamp(fly.cr + input.lookX * 0.004, -1, 1);
      if (want.cp) fly.cp = toward(fly.cp, want.cp, 2.5, dt);
      if (want.cr) fly.cr = toward(fly.cr, want.cr, 2.5, dt);
      fly.ped = toward(fly.ped, want.ped, want.ped ? 2.5 : 4, dt);
    } else {
      // (V5) keys.js: back to the trim point when released (with the assist off, the raw stick's trim)
      heliKeys.lever = fly.lever;
      const k = heliKeys.update(fly, dt, heli.assist.enabled);
      fly.cp = k.cyclicPitch;
      fly.cr = k.cyclicRoll;
      fly.ped = k.pedal;
    }
    if (heli.shut) fly.lever = 0; // (the shutdown: the collective fully down)
    const rate = (fly.up ? 1 : 0) - (fly.down ? 1 : 0);
    fly.lever = THREE.MathUtils.clamp(fly.lever + rate * 0.3 * dt, 0, 1);
    const keys = { cyclicPitch: fly.cp, cyclicRoll: fly.cr, pedal: fly.ped, collective: fly.lever, collectiveRate: rate };
    const out = heli.assist.update(heli.state, keys, dt);
    fm.setControls(out);
  };
  let lastHeliDoor = 0;
  const shownH = {};
  const setText = (el, key, text) => {
    if (shownH[key] !== text) el.textContent = shownH[key] = text;
  };
  const updateHeliHud = () => {
    const s = heli.state;
    setText(ui.hIas, 'ias', String(Math.round(s.ias * 3.6)));
    setText(ui.hAlt, 'alt', s.radarHeight < 10 ? s.radarHeight.toFixed(1) : String(Math.round(s.radarHeight)));
    setText(ui.hVs, 'vs', (s.verticalSpeed >= 0 ? '+' : '') + s.verticalSpeed.toFixed(1));
    setText(ui.hNr, 'nr', String(Math.round(s.rotor.percent)));
    setText(ui.hTq, 'tq', String(Math.round(s.engine.torquePercent)));
    setText(ui.hNg, 'ng', String(Math.round(s.engine.ng)));
    setText(ui.hEngine, 'eng', heli.shut ? heli.shutLabel : `engine ${s.engine.state}${s.engine.startMode === 'quick' && s.engine.lit ? ' (quick start)' : ''}${heli.damaged ? ' · ROTOR STRUCK' : ''}${heli.exitWhenStopped ? ' · out when the rotor stops' : ''}`);
    const a = heli.assist;
    const st = a.status || {};
    const ch = st.channels || {};
    setText(ui.hAssist, 'assist', !a.enabled ? 'assist off: raw controls' : `assist: ${(st.active || []).join(', ') || 'standing by'}${ch.collective && ch.collective !== 'pilot lever' ? ' · ' + ch.collective : ''}${fly.mouse ? ' · mouse cyclic' : ''}`);
    const flags = Object.entries(s.flags).filter(([k, v]) => v && k !== 'quickStart').map(([k]) => k.replace(/([A-Z])/g, ' $1').toUpperCase());
    if (heli.damaged && !flags.includes('ROTOR STRIKE')) flags.push('ROTOR STRIKE');
    setText(ui.hFlags, 'flags', flags.join(' · '));
    // a small attitude indicator: horizon by pitch and bank, the aircraft symbol fixed
    const g = ui.adi.getContext('2d');
    g.save();
    g.clearRect(0, 0, 96, 96);
    g.beginPath();
    g.arc(48, 48, 44, 0, Math.PI * 2);
    g.clip();
    g.translate(48, 48);
    g.rotate(-s.bank);
    const py = (s.pitch * 180) / Math.PI * 1.6;
    g.fillStyle = '#3d7fc4';
    g.fillRect(-80, -160 + py, 160, 160);
    g.fillStyle = '#7a5532';
    g.fillRect(-80, py, 160, 160);
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    for (const d of [-20, -10, 10, 20]) {
      g.beginPath();
      g.moveTo(-12, py - d * 1.6);
      g.lineTo(12, py - d * 1.6);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(-80, py);
    g.lineTo(80, py);
    g.stroke();
    g.restore();
    g.strokeStyle = '#f2c94c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(22, 48);
    g.lineTo(40, 48);
    g.lineTo(44, 54);
    g.moveTo(74, 48);
    g.lineTo(56, 48);
    g.lineTo(52, 54);
    g.stroke();
    g.fillStyle = '#f2c94c';
    g.fillRect(46, 46, 4, 4);
  };
  const showHeliHud = (on) => {
    if (ui.heliHud.hidden === !on) return;
    ui.heliHud.hidden = !on;
    ui.heliKeys.hidden = !on;
    if (on) ui.footHud.hidden = true;
    else if (ui.carHud.hidden) ui.footHud.hidden = false;
    ui.camName.textContent = on ? vehicles.cameras.names[vehicles.cameras.mode] : CAMERAS[cameraMode];
  };

  /**
   * (V5) The helicopter's warnings from the flight model's state, one decision for the caution lamps and the cabin
   * tones: ROTOR LOW (flag lowRotor, Nr under 95 %) with the horn when off the ground or with the collective raised,
   * not with the throttle at ground idle nor in a commanded shutdown (inhibited there, as real ones are);
   * ENG OUT once the engine has been running and Ng is under 55 % or it is off with the rotor turning (the tone
   * not during a commanded shutdown); OVERTORQ (torque over 100 %) with the chime; VRS (the model's vortex-ring
   * flag); also DOOR, GEN (engine not driving), AP OFF (assist off), LDG LT, PITOT HT.
   */
  let heliRan = false;
  const heliWarnings = () => {
    const s = heli.state;
    const e = s.engine;
    const f = s.flags;
    const nr = s.rotor.percent;
    if (e.state === 'flight' && nr > 95) heliRan = true;
    if (!e.lit && nr < 1) heliRan = false;
    const engOut = heliRan && (e.ng < 55 || !e.lit) && nr > 5;
    const air = !s.contact.onGround || s.controls.collective > 0.1;
    const warn = { horn: f.lowRotor && air && !heli.shut && !(e.lit && s.controls.throttle <= 0.5), engineOut: engOut && !heli.shut, overtorque: f.overtorque };
    const lamps = {
      'ROTOR LOW': f.lowRotor || (nr > 5 && nr < 95) ? 'red' : null,
      'ENG OUT': engOut || (heliRan && heli.shut && !e.lit) ? 'red' : null,
      OVERTORQ: f.overtorque ? 'red' : null,
      VRS: f.vortexRing ? 'amber' : null,
      DOOR: heli.door > 0.02 ? 'amber' : null,
      GEN: e.ng < 55 ? 'amber' : null,
      'AP OFF': !heli.assist.enabled ? 'amber' : null,
      'LDG LT': heli.landingLight ? 'green' : null,
      'PITOT HT': 'green',
    };
    heli.warn = warn;
    heli.lamps = lamps;
    return warn;
  };

  /** A frame inside the helicopter: getting in, flying, getting out. */
  const stepInsideHeli = (dt) => {
    const seated = vehicles.mode === 'seated';
    heliControls(dt, seated);
    heli.update(dt, camera);
    // the car stays where it is (parked) while the helicopter flies
    car.update(dt, camera);
    world.update(dt, car);
    const standingFn = () => {
      Object.assign(standBody, body, { speed: 0, pace: 1, moving: false, strafe: true, yawRate: 0, aim: 0, ready: 0, sprint: 0, action: null, hit: null, move: null, crouch: 0, crouchMove: null, crouchChanging: false, leanPitch: 0, leanRoll: 0, recoil: 0, recoilTwist: 0 });
      character.poseBody(dt, standBody);
    };
    vehicles.poseInside(dt, standingFn);
    if (inert()) inertia.record('inside');
    character.bones.Spine2.getWorldPosition(character.chestPos);
    character.bones.Spine2.getWorldQuaternion(character.chestQuat);
    player.pos.copy(character.root.position);
    // (V3: the guns lie on the left front seat while the door is shut, no longer out of sight; (V7) or on the clip's track)
    placeVehicleGuns(heli, 'heli', heli.door < 0.02);
    if (vehicles.mode === 'leaving' && heli.door > 0.02) vehicles.gunsHidden = false;
    if (lastHeliDoor < 0.02 && heli.door >= 0.02) heliSound.door(false);
    if (lastHeliDoor >= 0.02 && heli.door < 0.02) heliSound.door(true);
    lastHeliDoor = heli.door;
    const cams = vehicles.cameras;
    car.inCockpit = false;
    character.setFirstPerson(cams.mode === 1 && seated);
    if (fly.mouse && seated) cams.look(0, 0, dt);
    else cams.look(input.lookX, input.lookY, dt);
    input.lookX = input.lookY = 0;
    if (!seated && cams.mode === 1) cams.mode = 0;
    cams.place(dt, camera, heli);
    look.focus = carView.copy(heli.root.position);
    look.setShadow(cams.mode === 1 ? 12 : 20);
    look.blur.maxPx.value = 10;
    if (debugView) {
      const { az = 0, el = 0.1, dist = 14, y = 1.5, fov = 46, target = null } = debugView;
      const c = target ? _v.fromArray(target) : heli.root.localToWorld(_v.set(0, y, 0));
      const yaw = Math.atan2(-_dir.set(0, 0, -1).applyQuaternion(heli.root.quaternion).x, -_dir.z) + az;
      camera.position.set(c.x + Math.sin(yaw) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.cos(yaw) * Math.cos(el) * dist);
      camera.lookAt(c);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    viewFrom.copy(camera.position);
    fx.update(dt, camera);
    earStep(dt);
    heliSound.update(dt, heli.state, 1, seated && cams.mode === 1, doppler(heli.root.position, heli.state.velocity), heli.warn);
    carSound.update(dt, car.dyn, Math.max(0, 1 - camera.position.distanceTo(car.root.position) / 60), false, doppler(car.root.position, car.dyn.vel));
    carEvents(Math.max(0, 1 - camera.position.distanceTo(car.root.position) / 60), dt);
    // (V5) out once the rotor has stopped (T pressed with it turning started the shutdown)
    if (seated && heli.exitWhenStopped && !heli.shut && heli.state.rotor.percent < 0.5) {
      heli.exitWhenStopped = false;
      vehicles.toggle();
    }
    showCarHud(false);
    showHeliHud(seated);
    if (seated) updateHeliHud();
    ui.prompt.hidden = true;
  };

  /** (V5) The car's events this frame: the lamp check, the first firing, crunches; the indicator's relay. */
  let lastBlink = 0;
  const carEvents = (listen, dt) => {
    for (const ev of car.events) {
      if (ev.kind === 'ignition' && car.dash) car.dash.lampCheck();
      else if (ev.kind === 'fire') carSound.fire();
      else if (ev.kind === 'crunch') carSound.crunch(ev.dv, listen);
    }
    car.events.length = 0;
    const blink = car.indicator ? (Math.floor(car._t * 2.6) % 2 === 0 ? 1 : 0) : 0;
    if (car.indicator && blink !== lastBlink && listen > 0.5) carSound.tick(!!blink);
    lastBlink = blink;
    if (car.dash) car.dash.update(dt);
  };

  /** A frame inside the car: getting in, driving, getting out. */
  const stepInside = (dt) => {
    if (vehicles.kind === 'heli') {
      stepInsideHeli(dt);
      return;
    }
    const d = car.dyn;
    const seated = vehicles.mode === 'seated';
    // ---- controls ----
    if (seated) {
      const reverse = d.gear === 0;
      const stopped = Math.abs(d.speed) < 0.6;
      // S held at a standstill selects reverse; W at a standstill in reverse, first
      if (!reverse && drive.brake && !drive.throttle && stopped) {
        revHold += dt;
        if (revHold > 0.35) d.shiftTo(0);
      } else revHold = 0;
      if (reverse && drive.throttle && !drive.brake && stopped) d.shiftTo(2);
      if (!demo.carInput) {
        // (V5) shaped by keys.js: steering ramps by speed, short throttle and brake ramps
        const k = carKeys.update({ left: drive.left, right: drive.right, throttle: reverse ? drive.brake : drive.throttle, brake: reverse ? drive.throttle : drive.brake }, d.speed, dt);
        d.input.throttle = k.throttle;
        d.input.brake = k.brake;
        d.input.steer = k.steer;
        d.input.handbrake = drive.handbrake ? 1 : 0;
      }
      // (V5) the engine starts by itself once he is seated (the dash's lamp check, the starter, the first firing)
      if (!car.ignitionOn && !car.userOff && !demo.carInput && d.ignition === 'off') car.startSequence();
      // the indicator cancels as the wheel comes back after a turn of more than 60 deg its way
      if (car.indicator) {
        const turned = (d.steerWheel - car.indicatorFrom) * -car.indicator; // (indicator -1 = left = + wheel)
        car.indicatorPeak = Math.max(car.indicatorPeak || 0, -turned);
        if (car.indicatorPeak > 1.05 && Math.abs(d.steerWheel) < 0.2) car.indicator = 0;
      }
    } else if (!demo.carInput) {
      Object.assign(d.input, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
      carKeys.reset();
    }
    // (V5) getting out: ignition off
    if (vehicles.mode === 'leaving' && car.ignitionOn && !demo.carInput) {
      car.switchOff();
      car.userOff = false;
    }
    if (demo.carInput) demo.carInput(d, dt);
    car.update(dt, camera);
    world.update(dt, car);
    heliControls(dt, false);
    heli.update(dt, camera);
    heliSound.update(dt, heli.state, Math.max(0, 1 - camera.position.distanceTo(heli.root.position) / 250), false, doppler(heli.root.position, heli.state.velocity));
    // paddle flicks on every change
    if (lastGearSeen !== null && d.gear !== lastGearSeen && d.gear > 1 && lastGearSeen > 1) vehicles.seated.paddle(d.gear > lastGearSeen);
    lastGearSeen = d.gear;
    // ---- the body ----
    const standing = () => {
      Object.assign(standBody, body, { speed: 0, pace: 1, moving: false, strafe: true, yawRate: 0, aim: 0, ready: 0, sprint: 0, action: null, hit: null, move: null, crouch: 0, crouchMove: null, crouchChanging: false, leanPitch: 0, leanRoll: 0, recoil: 0, recoilTwist: 0 });
      character.poseBody(dt, standBody);
    };
    vehicles.poseInside(dt, standing);
    if (inert()) inertia.record('inside');
    // (V7) the driver sets the mirrors from where his eye is once he is seated (each time he gets in)
    if (car.mirrors) {
      if (seated && !car.mirrors.seatAimed && character.eye) {
        car.mirrors.aim(car.root.worldToLocal(_v.copy(character.eye)));
        car.mirrors.seatAimed = true;
      } else if (!seated) car.mirrors.seatAimed = false;
    }
    character.bones.Spine2.getWorldPosition(character.chestPos);
    character.bones.Spine2.getWorldQuaternion(character.chestQuat);
    player.pos.copy(character.root.position);
    // ---- the guns: on the back while the door is open; out of sight (in the cabin) once it is shut ----
    // (V3: across the passenger seat and footwell while the door is shut, no longer out of sight)
    placeVehicleGuns(car, 'car', car.doorL < 0.02);
    if (vehicles.mode === 'leaving' && car.doorL > 0.02) vehicles.gunsHidden = false;
    // door sounds
    if (lastDoor < 0.02 && car.doorL >= 0.02) carSound.door(false);
    if (lastDoor >= 0.02 && car.doorL < 0.02) carSound.door(true);
    lastDoor = car.doorL;
    // ---- camera ----
    const cams = vehicles.cameras;
    car.inCockpit = cams.mode === 1 && seated; // ((V4) car.js fades smoke reaching into the cabin in this view)
    character.setFirstPerson(cams.mode === 1 && seated);
    cams.look(input.lookX, input.lookY, dt);
    input.lookX = input.lookY = 0;
    if (!seated && cams.mode === 1) cams.mode = 0; // (getting in and out, from outside)
    cams.place(dt, camera, car, cams.started ? null : camera.position);
    look.focus = carView.copy(car.root.position);
    look.setShadow(cams.mode === 1 ? 8 : 14);
    look.blur.maxPx.value = 10;
    if (debugView) {
      const { az = 0, el = 0.1, dist = 6, y = 0.8, fov = 46, target = null } = debugView;
      const c = target ? _v.fromArray(target) : car.root.localToWorld(_v.set(0, y, 0));
      const yaw = Math.atan2(-_dir.set(0, 0, -1).applyQuaternion(car.root.quaternion).x, -_dir.z) + az;
      camera.position.set(c.x + Math.sin(yaw) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.cos(yaw) * Math.cos(el) * dist);
      camera.lookAt(c);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    viewFrom.copy(camera.position);
    fx.update(dt, camera);
    // ---- sound and HUD ----
    earStep(dt);
    carSound.update(dt, d, 1, seated && cams.mode === 1, doppler(car.root.position, d.vel));
    carEvents(1, dt);
    showCarHud(seated);
    if (seated) updateCarHud();
    ui.prompt.hidden = true;
  };

  // (V7) the weather first (the flight model reads the wind), the world's moving parts last (they follow the camera)
  const step = (dt) => {
    WEATHER.step(dt);
    if (heli.fm) {
      heli.fm.wind[0] = WEATHER.now.x;
      heli.fm.wind[2] = WEATHER.now.z;
    }
    stepGame(dt);
    terrain.update(dt, camera, { heli, car });
    terrain.drift(dt);
  };
  const stepGame = (dt) => {
    look.steps += 1; // (motion blur only trusts a frame one step after the last)
    // ((V4) the vehicle nobody is in, or being scripted, may sleep when it is at rest: car.js, heli.js)
    car.driven = (vehicles.inside && vehicles.kind === 'car') || !!demo.carInput;
    // (V5) the helicopter's hull is a body the car's contacts push against (and it wakes the parked car when it
    // comes near, so a helicopter sliding into it is felt)
    if (!WORLD_GROUND.bodies) WORLD_GROUND.bodies = () => {
      const b = heli.contactBody();
      return b ? [b] : [];
    };
    if (!car.driven && heli.ready && car.ready && heli.root.position.distanceTo(car.root.position) < 9 && heli.speed > 0.05) car.driven = true;
    heliWarnings();
    if (heli.panel) heli.panel.update(dt, heli.lamps);
    if (!vehicles.inside) car.inCockpit = false;
    heli.flown = (vehicles.inside && vehicles.kind === 'heli') || !!demo.heliInput;
    // ---- (pass V1) in the car: everything is the car's ----
    if (vehicles.inside) {
      stepInside(dt);
      return;
    }
    car.update(dt, camera);
    world.update(dt, car);
    earStep(dt);
    carSound.update(dt, car.dyn, Math.max(0, 1 - player.pos.distanceTo(car.root.position) / 60), false, doppler(car.root.position, car.dyn.vel));
    carEvents(Math.max(0, 1 - player.pos.distanceTo(car.root.position) / 60), dt);
    heliControls(dt, false);
    heli.update(dt, camera);
    heliSound.update(dt, heli.state, Math.max(0, 1 - player.pos.distanceTo(heli.root.position) / 250), false, doppler(heli.root.position, heli.state.velocity));
    showCarHud(false);
    showHeliHud(false);
    look.focus = player.pos;
    look.setShadow(9);
    rifle.pivot.visible = shotgun.pivot.visible = true;
    character.setFirstPerson(player.firstPerson);
    lastGearSeen = null;
    const vmode = vehicles.mode;
    if (vmode !== 'foot') {
      // on the way to the car or back from it: no shooting, aiming, reloading or swapping
      input.swap = null;
      input.reload = false;
      input.fireKey = input.fireMouse = input.fireButton = input.aimHeld = false;
      input.tap = 0;
      if (input.aimToggle) setAimToggle(false);
      if (vmode === 'walking' && vehicles.walkTo(input, dt)) vehicles.arrived();
    }
    if (vmode === 'stowing' && !stow && !swap && weapon.state === 'ready') stow = { clip: motion.actions[`swap-${weapon.key}-${other.key}`], t: 0, dir: 1 };
    if (vmode === 'drawing' && !stow) {
      const clip = motion.actions[`swap-${weapon.key}-${other.key}`];
      // (V6) the stow's outgoing half backwards from its end, as it went forwards: the empty right hand goes back
      // to the gun on the back from beside the thigh (V1-V5 began at `slung`, the hand already on the gun: 48 cm in
      // one frame from where the exit clip left it)
      stow = { clip, t: clip.duration, dir: -1 };
    }
    if (stow) {
      stow.t += dt * stow.dir;
      if (stow.dir > 0 && stow.t >= stow.clip.events.slung) handsFree = true;
      if (stow.dir < 0 && stow.t < stow.clip.events.slung) handsFree = false;
      if ((stow.dir > 0 && stow.t >= stow.clip.duration) || (stow.dir < 0 && stow.t <= 0)) {
        stow = null;
        vehicles.stowed();
      }
    }
    if (vmode === 'foot') handsFree = false;
    // ---- controls ----
    input.tap = Math.max(0, input.tap - dt);
    input.fire = input.fireKey || input.fireMouse || input.fireButton || input.tap > 0;
    input.aim = input.aimHeld || input.aimToggle;
    // ---- swapping weapons: one goes over the shoulder onto the back as the other comes off it ----
    if (!swap && input.swap && input.swap !== weapon && weapon.state === 'ready') {
      swap = { clip: motion.actions[`swap-${weapon.key}-${other.key}`], t: 0, out: weapon, in: other, handed: false };
    }
    input.swap = null;
    if (swap) {
      const before = swap.t;
      swap.t += dt;
      for (const [name, at] of Object.entries(swap.clip.events)) {
        if (before < at && swap.t >= at && SWAP_SOUNDS[name]) sound.handle(SWAP_SOUNDS[name]);
      }
      if (!swap.handed && swap.t >= swap.clip.events.handOver) {
        // the firing hand has the new gun: it is the one in use from here
        [weapon, other] = [swap.in, swap.out];
        fx.attachFlash(weapon.nodes.muzzle_point);
        swap.handed = true;
      }
      if (swap.t >= swap.clip.duration) swap = null;
    }
    const swapping = !!swap;
    // (no aiming with the hands busy: the reload and the swap bring the gun in to the body)
    const busy = weapon.state === 'reloading' || swapping;
    player.update(dt, input, busy, busy);
    character.root.position.copy(player.pos);
    // ((V6) all three: an exit hands over from a tilted vehicle's frame, and the hand-over's offset turns the root too)
    character.root.rotation.set(0, player.yaw, 0);
    standing.standing = !player.moving && player.speed < 0.2;
    standing.aim = player.aim;
    standing.busy = weapon.state !== 'ready' || swapping || input.fire;
    alive.update(dt, standing);
    if (alive.resettle) weapon.settle();

    // ---- what is in the middle of the view; the rifle is pointed at it ----
    _dir.set(0, 0, -1).applyQuaternion(player.viewQuat(_q));
    const near = Math.max(0, _v.subVectors(character.eye, viewFrom).dot(_dir)) + 0.6;
    fx.sight(viewFrom, _dir, near, aimPoint);
    player.aimAt(aimPoint, character.eye);

    // ---- body, then the rifle, then the arms that hold it ----
    body.speed = player.speed;
    body.pace = player.pace;
    body.heading = player.heading;
    body.moving = player.moving;
    body.strafe = player.strafe;
    body.yawRate = player.yawRate;
    body.aim = player.aim;
    body.ready = player.ready;
    body.sprint = player.sprint;
    body.lookYaw = player.lookYaw;
    body.lookPitch = player.lookPitch;
    body.pitch = player.pitch;
    body.twist = player.twist;
    body.leanPitch = player.leanPitch;
    body.leanRoll = player.leanRoll;
    body.recoil = weapon.climb.x * 0.6 + weapon.kick.x * 1.5;
    body.recoilTwist = weapon.kick.x * 3;
    body.alive = alive;
    // (the gun going out follows the clip's Gun track from the gait clips' hold, eased in)
    body.gun = weapon.key;
    body.move = player.move;
    body.crouch = player.crouch;
    body.crouchMove = player.crouchMove;
    body.crouchChanging = player.crouchChanging;
    if (swap) body.action = { clip: swap.clip, t: swap.t, gun: ramp(swap.t / EASE) };
    else if (stow) body.action = { clip: stow.clip, t: Math.max(0, stow.t), gun: Math.min(ramp(stow.t / EASE), stow.dir > 0 ? 1 : ramp(stow.t / EASE)) };
    else if (weapon.action) {
      // a reload or the pump: the gun follows the clip's Gun track, eased in from the gait clips'
      // hold where a run of clips begins and back where it ends (the shotgun's reload is three)
      const { clip, t } = weapon.action;
      const first = !/-(shell|end|end-pump)$/.test(clip.name);
      const last = !/-(start|shell)$/.test(clip.name);
      body.action = { clip, t, gun: Math.min(first ? ramp(t / EASE) : 1, last ? ramp((clip.duration - t) / EASE) : 1) };
    } else body.action = null;
    if (struck) {
      struck.t += dt;
      if (struck.t >= struck.clip.duration) struck = null;
    }
    body.hit = struck;
    // where the eyes go: on the work during a reload, else on what is in the middle of the view
    // (where the head is about to turn; aiming, the target)
    const work = weapon.state === 'reloading';
    gaze.work = work;
    gaze.aim = player.aim;
    gaze.fired = firedLast;
    if (work) (weapon.nodes.magazine || weapon.nodes.pump || weapon.pivot).getWorldPosition(gaze.point);
    else gaze.point.copy(aimPoint);
    body.gaze = gaze;
    character.poseBody(dt, body);
    // (V6) a hand-over (into the stow, out of it, out of an exit clip, the draw's end): the last frame's pose carried on
    const footTag = 'foot:' + (vehicles.inside ? 'walking' : vehicles.mode);
    const I = inert();
    if (I) {
      I.check(footTag);
      I.apply(dt, 'body');
    }
    player.pos.y = character.root.position.y; // (on the ramps, steps and kerb: ground.js)
    character.root.getWorldQuaternion(rootQuat);

    hold.dt = dt;
    hold.pocket = character.pocket;
    hold.aimPocket = character.aimPocket;
    hold.aimSupport = character.aimSupport;
    hold.acting = body.action ? body.action.gun : 0;
    hold.aim = player.aim;
    hold.sprint = player.sprint;
    hold.firstPerson = player.firstPerson;
    hold.reach = character.reach(reach);
    hold.life = character.life;
    hold.fidget = alive.carry;
    hold.sway = alive.sway;
    hold.clear = clear;
    if (swapping) {
      // both guns where the clip has them: the outgoing on its Gun track, the incoming on GunIn,
      // eased at the end into the gait clips' hold
      const s = character.act.sample;
      inPos.copy(s.nodes.GunIn.pos);
      inQuat.copy(s.nodes.GunIn.quat);
      const settle = ramp((swap.clip.duration - swap.t) / EASE);
      inPos.lerp(character.locoGunPos, 1 - settle);
      inQuat.slerp(character.locoGunQuat, 1 - settle);
      slung.gunPos.copy(character.gunPos);
      slung.gunQuat.copy(character.gunQuat);
      swap.out.place(slung);
      slung.gunPos.copy(inPos);
      slung.gunQuat.copy(inQuat);
      swap.in.place(slung);
    } else if (stow && !handsFree) {
      // the gun on its way to or from the back, as the clip's Gun track has it
      slung.gunPos.copy(character.gunPos);
      slung.gunQuat.copy(character.gunQuat);
      weapon.place(slung);
    } else if (handsFree) {
      stowOf(weapon, slung.gunPos, slung.gunQuat);
      weapon.place(slung);
    } else weapon.place(hold);
    ctx.wantFire = input.fire && !swapping;
    ctx.canFire = player.aim > 0.7 && !swapping;
    ctx.wantReload = input.reload && !swapping;
    ctx.spread = player.spread + weapon.spread;
    ctx.actWeight = body.action ? body.action.gun : 0;
    input.reload = false;
    const ammoBefore = weapon.ammo;
    const fired = weapon.update(dt, ctx);
    firedLast = fired;
    if (fired) {
      player.recoil(weapon.recoil);
      sound.shot(weapon === shotgun);
    }
    for (const event of weapon.events) {
      sound.handle(event);
      if (event === 'magOut' || event === 'shellIn') sound.say('Reloading!');
    }
    weapon.events.length = 0;
    other.events.length = 0;
    // the voice: breathing follows how hard the body works (walk barely, jog some, sprint fully)
    sound.breathe(dt, Math.min(1, Math.max(player.sprint, (player.speed - 1.6) / 4.5)));
    if (character.life.footfall) sound.step(character.life.step * (1 - 0.6 * player.crouch)); // (crouched: quieter)
    // the other gun rides on the back
    if (!swapping) {
      stowOf(other, slung.gunPos, slung.gunQuat);
      other.place(slung);
    }
    other.update(dt, idle);
    if (fired || weapon.state === 'reloading' || weapon.ammo !== ammoBefore) input.tap = 0;
    // the head comes down to the sights: the eye belongs just behind the rear sight, and in third
    // person a little further back and higher (CHEEK), where the cheek rests on the comb's side
    // rather than going through the stock (the aiming poses' weld: handling.py AimPose.EYE_BACK)
    eyeSeat.copy(weapon.eyeLocal);
    // (read from the body's table every frame, so a value tuned from the console takes at once)
    const cheekT = character.table && character.table.cheek;
    if (cheekT) {
      CHEEK.fromArray(cheekT.back);
      CHEEK_DOWN.fromArray(cheekT.down);
      CHEEK_UP.fromArray(cheekT.up || [0, 0, 0]);
    }
    if (!character.firstPerson) eyeSeat.add(CHEEK).addScaledVector(CHEEK_DOWN, Math.max(0, -player.pitch) / (Math.PI / 4)).addScaledVector(CHEEK_UP, Math.max(0, player.pitch) / (Math.PI / 4));
    eyeSeat.applyQuaternion(player.aimQuat).add(weapon.basePos);
    let hands = weapon.hands;
    if (swapping) {
      const s = character.act.sample;
      hands = handsFromAction(character.act, character.chestPos, character.chestQuat,
        { 1: { weapon: swap.out, pos: s.pose.gun, quat: s.gunQuat }, 2: { weapon: swap.in, pos: s.nodes.GunIn.pos, quat: s.nodes.GunIn.quat } }, actionHands);
      // (the trigger finger along whichever gun the firing hand has by its grip, off the trigger)
      const gripped = s.hold[1] === 2 ? swap.in : s.hold[1] === 1 ? swap.out : null;
      if (gripped) gripped.fingerTargets(hands);
      else hands.rOn = 0;
    }
    if (stow || handsFree) {
      // (pass V1) empty hands by the thighs; the firing hand with the gun until it is on the back
      const empty = emptyHands(character, emptyOut, character.phase, Math.min(1, player.speed / 1.5) * 0.5);
      if (stow) {
        const slungAt = stow.clip.events.slung;
        const s = character.act.sample;
        const held = handsFromAction(character.act, character.chestPos, character.chestQuat, { 1: { weapon, pos: s.pose.gun, quat: s.gunQuat } }, actionHands);
        const kr = ramp((stow.t - slungAt) / 0.25);
        const kl = ramp(stow.t / 0.2);
        empty.rPalm.lerpVectors(held.rPalm, empty.rPalm, kr);
        empty.rQuat.slerpQuaternions(held.rQuat, empty.rQuat, kr);
        empty.rCurl = THREE.MathUtils.lerp(held.rCurl, 0.35, kr);
        empty.rElbow = kr < 0.5 ? held.rElbow : null;
        empty.lPalm.lerpVectors(weapon.hands.lPalm, empty.lPalm, kl);
        empty.lQuat.slerpQuaternions(weapon.hands.lQuat, empty.lQuat, kl);
      }
      hands = empty;
    }
    lastHands = hands;
    character.poseArms(hands, eyeSeat, player.aim);
    if (I) {
      if (I.apply(dt, 'arms')) {
        character.model.updateMatrixWorld(true);
        character.rig.apply();
      }
      I.record(footTag);
    }

    fx.update(dt, camera);

    // ---- camera (the sun's shadow box follows the player when the frame is drawn: look.js) ----
    sight.copy(weapon.sightLocal).add(_v.set(-0.004, 0.03, 0.2)).applyQuaternion(player.aimQuat).add(weapon.basePos);
    player.placeCamera(dt, camera, character.eye, sight, character.life);
    // (first person the gun fills the bottom of the view and kicks towards it on every shot: a short
    // smear cap there, so the near gun does not smudge; pass 11)
    look.blur.maxPx.value = player.firstPerson ? 3 : 10;
    viewFrom.copy(camera.position);
    if (debugView) {
      const { az = 0, el = 0.1, dist = 3.5, y = 1 } = debugView;
      _v.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
      camera.position.set(player.pos.x, y, player.pos.z).add(_v);
      camera.lookAt(player.pos.x, y, player.pos.z);
      camera.fov = debugView.fov || 46;
      camera.updateProjectionMatrix();
    }

    // ---- HUD ----
    const nearKind = vehicles.mode === 'foot' ? vehicles.nearest() : null;
    if (ui.prompt.hidden === !!nearKind || shown.nearKind !== nearKind) {
      shown.nearKind = nearKind;
      ui.prompt.hidden = !nearKind;
      ui.prompt.innerHTML = nearKind === 'heli' ? '<kbd>T</kbd> get in the helicopter' : '<kbd>T</kbd> get in the car';
    }
    if (weapon !== shown.weapon) {
      shown.weapon = weapon;
      ui.weapon.textContent = weapon.name;
    }
    if (weapon.ammo !== shown.ammo) {
      shown.ammo = weapon.ammo;
      ui.ammo.textContent = String(weapon.ammo);
      ui.ammo.parentElement.classList.toggle('low', weapon.ammo > 0 && weapon.ammo <= weapon.capacity * 0.27);
      ui.ammo.parentElement.classList.toggle('empty', weapon.ammo === 0);
    }
    const status = weapon.status;
    if (status !== shown.status) {
      shown.status = status;
      ui.status.textContent = status === 'reloading' ? 'Reloading…' : status === 'empty' ? 'Empty — press R' : 'Ready';
      ui.status.classList.toggle('busy', status !== 'ready');
    }
    if (fx.hits !== shown.hits) {
      shown.hits = fx.hits;
      ui.hits.textContent = String(fx.hits);
    }
    // the crosshair opens with the cone of fire and fades while the rifle is carried
    const gap = Math.round(4 + (Math.tan(player.spread + weapon.spread) * viewH) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    if (gap !== shown.gap) {
      shown.gap = gap;
      ui.cross.style.setProperty('--gap', `${gap}px`);
    }
    const fade = Math.round((0.25 + 0.75 * player.aim) * (1 - 0.8 * (player.firstPerson ? player.sights : 0)) * 20) / 20;
    if (fade !== shown.fade) {
      shown.fade = fade;
      ui.cross.style.opacity = String(fade);
    }
  };

  const afterRender = []; // callbacks for the end of the next frame, while the canvas still holds it
  let last = performance.now();
  let frames = 0;
  performance.mark('load:loop'); // (the first frame waits for the browser's next animation frame)
  renderer.setAnimationLoop((now) => {
    const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05) * timeScale; // the first timestamp can predate `last`
    last = now;
    if (frames < 2) performance.mark(`load:frame${frames + 1}-start`);
    step(dt);
    if (viewW > 0 && viewH > 0) look.render();
    if (frames < 2) performance.mark(`load:frame${frames + 1}-end`);
    frames++;
    if (afterRender.length) for (const done of afterRender.splice(0)) done();
  });

  ui.loading.classList.add('done');

  // Handy from the browser console:
  //   demo.input.forward = true; demo.advance(2)     walk for two seconds of simulation
  //   demo.weapon.freeze = { t: 0.6, empty: true }   hold the reload at one moment (null to release)
  //   demo.view = { az: 1.57, el: 0.1, dist: 3.5, y: 1 }   watch the character from outside (null to go back)
  const demo = (window.demo = {
    renderer,
    scene,
    camera,
    get motion() {
      return motion;
    },
    character,
    player,
    car,
    heli,
    heliSound,
    fly,
    heliInput: null, // (review: a function (heli, dt) that sets the helicopter's controls each frame)
    world,
    vehicles,
    get inertia() {
      return inertia;
    },
    carSound,
    carKeys,
    heliKeys,
    THREE, // (V5: for the tools)
    perf: PERF, // (V7: the features' switches, for before / after in one page)
    repair: () => repair(),
    terrain,
    weather: WEATHER,
    setTime: (name) => setTime(name),
    /** (V7) after changing demo.perf: shows or hides what the switches cover */
    applyPerf: () => terrain.apply(),
    drive,
    carInput: null, // (review: a function (dyn, dt) that sets the car's input each frame)
    get weapon() {
      return weapon;
    },
    alive,
    get hands() {
      return lastHands; // where the palms were asked to be this frame
    },
    sound,
    rifle,
    shotgun,
    fx,
    input,
    setCamera,
    showBody,
    ROSTER,
    MAG_SIZE,
    SPEED,
    step,
    /** Struck from `way` ('f', 'b', 'l', 'r', where the blow comes from) with `strength` 0..1. */
    hit: (way, strength) => strike(way, strength),
    get struck() {
      return struck;
    },
    advance(seconds) {
      for (let i = 0, n = Math.round(seconds * 60); i < n; i++) step(1 / 60);
    },
    /**
     * Draws a frame now, outside the animation loop, through the same picture (look.js): the frame
     * counter is moved on so the shadow map, skinning, TRAA history and motion vectors update. Motion
     * blur and TRAA use the previous frame: step once between renders (two or three in a row before
     * a frame you keep); after demo.advance() the next frame is drawn without blur.
     */
    render() {
      if (look.quality === 'plain') character.model.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
      if (viewW > 0 && viewH > 0) look.render(true);
    },
    look,
    /** The start-up stages (pass F2): each `load:*` performance mark and the ms since the one before. */
    loadTimes() {
      const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('load:')).sort((a, b) => a.startTime - b.startTime);
      return marks.map((m, i) => ({ stage: m.name.slice(5), at: Math.round(m.startTime), ms: Math.round(m.startTime - (i ? marks[i - 1].startTime : 0)) }));
    },
    /** 'full' or 'plain' (the G key). */
    get quality() {
      return look.quality;
    },
    set quality(value) {
      look.quality = value;
      setQuality(value);
    },
    /** Resolves once the next frame has been drawn, before the browser presents it. */
    nextFrame() {
      return new Promise((resolve) => afterRender.push(resolve));
    },
    get view() {
      return debugView;
    },
    set view(value) {
      debugView = value;
    },
    get timeScale() {
      return timeScale;
    },
    set timeScale(value) {
      timeScale = value;
    },
  });
  Object.assign(demo, makeReview(demo));
}

main().catch((err) => {
  console.error(err);
  ui.loading.classList.remove('done');
  ui.loading.textContent = `Could not start the demo.\n${err.message}`;
});
