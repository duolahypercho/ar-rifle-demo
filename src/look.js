// The picture (pass 10, rendering): a procedural sky and the light it gives, a low warm sun with a
// tight shadow that follows the player, run-time material changes for the bodies and the guns, and
// the post-processing chain. Everything is made in code; nothing is loaded.
//
// Full quality (the default) draws each frame as:
//   pre-pass     depth, view normals and per-pixel velocity (skinned meshes included), opaque only
//   GTAO         ambient occlusion from that depth and those normals, half resolution, temporal
//   scene pass   the lit scene in HDR, the AO darkening only the sky and bounce light (not the sun)
//   TRAA         temporal anti-aliasing (camera jittered every frame, history reprojected by velocity)
//   motion blur  along each pixel's own velocity, a short shutter, capped in length
//   bloom        only what is brighter than anything lit: muzzle flash, tracers, sparks, glints
//   grade        AgX tone mapping, then a gentle filmic grade (cool shadows, warm highlights, a
//                touch of contrast and saturation) and a light vignette
// Plain (G) is the same scene, lights and materials drawn straight to the screen with MSAA and
// AgX tone mapping: no AO, TRAA, motion blur, bloom or grade.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, screenUV,
  builtinAOContext, renderOutput, uniform, vec2, vec3, vec4, float, int, Fn, mix, smoothstep, max, min, abs,
  dot, length, luminance, saturation, texture, normalWorld, positionWorld, cameraPosition, fog, rangeFogFactor,
  pmremTexture, normalize, rtt,
} from 'three/tsl';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { SHADOW_LAYER, NEAR_LAYER, FAR_LAYER, followSkinned } from './batch.js';
import { PERF } from './perf.js';
import { GRASS_LAYER } from './flora.js';

export const QUALITIES = ['full', 'plain'];

// Late afternoon: the sun 29 degrees up, behind and to the right of the start's view (which
// looks down -Z), so the play camera sees the body side-lit with its shadow falling forward-left.
const SUN_ELEVATION = THREE.MathUtils.degToRad(29);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(68); // from +Z towards +X
const SUN_COLOR = new THREE.Color(1.0, 0.8, 0.6);
const SUN_INTENSITY = 8;
// (V3) the sun's shadow in four cascades along the view (CSMShadowNode), so buildings, barriers, the
// vehicles and the far ground keep their shadows from the cockpit at 300 km/h and from 200 m up. The
// splits are near x [1, 5, 25] then SHADOW_FAR; `near` is set per view (setShadow): 9 m on foot (the
// first cascade is 21 m across, 5.1 mm texels at 4096, as the old 22 m box), 14 m in the car's chase view,
// 8 m in its cockpit, 20 / 12 m for the helicopter. Each cascade is sized once for a 68-degree field of
// view (the widest the game uses) and only resized when `near` changes, and its centre is snapped to its
// own texel grid in the sun's frame, so nothing swims or pops while the view moves; neighbours cross-fade.
const SHADOW_NEAR = 9;
const SHADOW_FAR = 1100; // m: past this the haze has most of the ground
// (five cascades cost 25 ms of CPU and 48 ms of GPU a frame at 2048 x 1536 while driving, against 16 and 7 for
// V2's one map: every fragment looks up every cascade's PCF. Four, the last three at 2048, measured below)
const SHADOW_SPLITS = [1, 5, 25];
const SHADOW_MAPS = [4096, 2048, 2048, 2048];
const SHADOW_FOV = 68;
const SHADOW_MARGIN = 300; // m of casters kept toward the sun beyond each cascade's slice
const FAR_CASCADE = 2; // (V4) from this cascade on the far proxies cast, before it the near ones (batch.js)
// (the sky shader's own scale is far brighter than the sun's light here: `gain` brings it to a
// clear afternoon's balance, about 1 : 3.5 shade to sun on the ground)
const SKY = { turbidity: 3.4, rayleigh: 1.35, mie: 0.0045, mieG: 0.82, clouds: 0.32, gain: 0.3 };

const _size = new THREE.Vector2();

// (V7) Times of day, the sun, sky, haze, exposure and ambient changing together (look.setTime). Elevation and azimuth in
// degrees (azimuth from +Z toward +X); `sky` the sky shader's gain; `bounce` the ground's light as the sky sees it;
// `exposure` the tone mapping's; `env` the environment light's scale; `sprite` the lit sprites' (smoke, dust, clouds)
// scale against the afternoon's; `lamps` the edge lights' and street lamps' glow; `display` the cockpit screens'
// brightness (they dim at night, as real ones do, so they read and do not bloom). Night: the sun's light is the moon's
// (the sky shader keeps the sun below the horizon), a dim blue light from high in the south-west.
// ((V8) sprite at dusk 0.42 -> 0.2 and at night 0.07 -> 0.025: the rotor wash's dust and the tyre smoke were brighter than
// the ground they rose from, white blobs over a dark field in the chase view)
export const TIMES = {
  midday: { elev: 62, az: 20, color: [1.0, 0.96, 0.9], intensity: 9.5, sky: 0.3, turbidity: 2.6, bounce: [0.24, 0.23, 0.21], exposure: 0.74, env: 1.0, sprite: 1.12, lamps: 0, display: 1 },
  afternoon: { elev: 29, az: 68, color: [1.0, 0.8, 0.6], intensity: 8, sky: 0.3, turbidity: 3.4, bounce: [0.2, 0.18, 0.15], exposure: 0.85, env: 1.0, sprite: 1, lamps: 0, display: 1 },
  dusk: { elev: 2.5, az: 95, color: [1.0, 0.42, 0.18], intensity: 3.2, sky: 0.36, turbidity: 6, bounce: [0.07, 0.05, 0.045], exposure: 1.7, env: 1.3, sprite: 0.2, lamps: 0.7, display: 0.6 },
  night: { elev: -16, az: 100, moon: { elev: 38, az: 215 }, color: [0.55, 0.66, 1.0], intensity: 0.22, sky: 0.3, turbidity: 2, bounce: [0.012, 0.014, 0.02], exposure: 3.2, env: 6, sprite: 0.025, lamps: 1, display: 0.3 },
};
export const TIME_NAMES = ['midday', 'afternoon', 'dusk', 'night'];
/** (V7) What the time of day makes of light that is not lit by the renderer (sprites, lamps, screens): look.setTime. */
export const LIGHT = { sprite: 1, lamps: 0, display: 1, time: 'afternoon' };
const dirOf = (elev, az, out) => {
  const e = THREE.MathUtils.degToRad(elev);
  const a = THREE.MathUtils.degToRad(az);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

function makeSky(scale, sunDir, disc, gain) {
  const sky = new SkyMesh();
  const raw = sky.material.colorNode;
  sky.material.colorNode = vec4(raw.rgb.mul(gain), 1);
  sky.scale.setScalar(scale);
  sky.turbidity.value = SKY.turbidity;
  sky.rayleigh.value = SKY.rayleigh;
  sky.mieCoefficient.value = SKY.mie;
  sky.mieDirectionalG.value = SKY.mieG;
  sky.cloudCoverage.value = SKY.clouds;
  sky.cloudDensity.value = 0.35;
  sky.sunPosition.value.copy(sunDir);
  sky.showSunDisc.value = disc ? 1 : 0;
  sky.frustumCulled = false;
  return sky;
}

export class Look {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    // (V4) the scene's matrices are brought up to date once a frame (render()), not by every pass's render call
    scene.matrixWorldAutoUpdate = !PERF.matrix;
    this.camera = null;
    this.focus = new THREE.Vector3(); // where the player is (the shadow box follows it)
    this.quality = 'full';
    this.steps = 1; // simulation steps since the last frame drawn (motion blur needs exactly one)
    this.pipeline = null;
    this.debug = null; // 'ao' | 'velocity' | 'normal' | null: show one buffer instead of the picture

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 0.85;
    this.toneMapping = renderer.toneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // ---- sun ----
    this.sunDir = new THREE.Vector3(
      Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
      Math.sin(SUN_ELEVATION),
      Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    );
    const sun = (this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY));
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -11;
    cam.right = cam.top = 11;
    cam.near = 1;
    cam.far = 70;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = 2.2; // texels: PCF on a rotated disc (TRAA smooths the rotation's noise)
    scene.add(sun, sun.target);
    // (V3) cascades: the sun's own map is replaced by the CSM node's per-cascade maps (set up on the first frame)
    this.shadowNear = SHADOW_NEAR;
    this.csm = new CSMShadowNode(sun, {
      cascades: SHADOW_SPLITS.length + 1,
      maxFar: SHADOW_FAR,
      mode: 'custom',
      lightMargin: SHADOW_MARGIN,
      customSplitsCallback: (n, near, far, out) => {
        for (const k of SHADOW_SPLITS) out.push(Math.min(1, (this.shadowNear * k) / far));
        out.push(1);
      },
    });
    this.csm.fade = true;
    sun.shadow.shadowNode = this.csm;
    this.sunColor = uniform(new THREE.Color().copy(SUN_COLOR).multiplyScalar(SUN_INTENSITY));
    this.sunDirU = uniform(this.sunDir.clone());

    // ---- sky, and the light it gives (PMREM of the same sky over a warm concrete ground) ----
    this.skyGain = uniform(SKY.gain);
    this.sky = makeSky(2600, this.sunDir, true, this.skyGain);
    scene.add(this.sky);
    scene.background = null;
    this.bounce = uniform(new THREE.Color(0.2, 0.18, 0.15)); // the sunlit yard, as the sky sees it
    performance.mark('load:pmrem-start');
    this.bakeSky();
    performance.mark('load:pmrem-end');
    scene.environmentIntensity = 1.0;
    // aerial haze: the far yard fades to the sky behind it (the same sky, blurred), never to grey
    const viewDir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const hazeDir = normalize(vec3(viewDir.x, max(viewDir.y, 0.04), viewDir.z));
    scene.fog = null;
    // (pass V1: the world is 2.6 km across now; the haze starts further out and ends before the far
    // plane, which is 3 km; the near distance stays where the yard had it)
    this.fogNear = uniform(70);
    this.fogFar = uniform(1900);
    scene.fogNode = fog(pmremTexture(this.envTarget.texture, hazeDir, float(0.35)).rgb.mul(0.92), rangeFogFactor(this.fogNear, this.fogFar));

    // grading and post uniforms (tweak live from the console: demo.look.grade.contrast.value = ...)
    this.grade = {
      contrast: uniform(0.25),
      saturation: uniform(1.12),
      vignette: uniform(0.28),
      warm: uniform(new THREE.Vector3(0.022, 0.009, -0.016)),
      cool: uniform(new THREE.Vector3(-0.01, 0.0, 0.018)),
    };
    this.blur = {
      shutter: uniform(0.45), // fraction of a frame's motion the smear covers
      maxPx: uniform(10), // longest smear, pixels at 720p (scaled with the height)
      minPx: uniform(0.75), // slower than this per frame stays sharp
      on: uniform(1),
      samples: 10,
    };
    this._res = uniform(new THREE.Vector2(1280, 720));
    // (V7) work done each frame just before the picture, after the matrices: the car's mirrors (mirrors.js)
    this.before = [];
    this.onTime = []; // (V7) called with (name, LIGHT) when the time of day changes
    this.time = 'afternoon';
  }

  /** Renders the sky (no sun disc) over a ground of bounce light into the environment map. */
  bakeSky(sunPos = this.sunDir, turbidity = SKY.turbidity) {
    const envScene = new THREE.Scene();
    const sky = makeSky(90, sunPos, false, this.skyGain);
    sky.turbidity.value = turbidity;
    envScene.add(sky);
    const ground = new THREE.MeshBasicNodeMaterial();
    ground.colorNode = this.bounce;
    envScene.add(new THREE.Mesh(new THREE.CircleGeometry(80, 48).rotateX(-Math.PI / 2).translate(0, -1.6, 0), ground));
    const pmrem = this._pmrem || (this._pmrem = new THREE.PMREMGenerator(this.renderer));
    // ((V7) a re-bake (the time of day) renders into the same target: the haze and the materials keep sampling it)
    const target = pmrem.fromScene(envScene, 0.015, 0.1, 200, this.envTarget ? { renderTarget: this.envTarget } : {});
    if (!this.envTarget) {
      this.envTarget = target;
      this.scene.environment = target.texture;
    }
  }

  /**
   * (V7) The time of day ('midday', 'afternoon', 'dusk', 'night'): the sun's direction, colour and strength, the sky
   * shader's sun and gain, the environment light re-baked from that sky (the haze samples it, so the fog follows), the
   * exposure, and LIGHT for what the renderer does not light. No light is added or removed (that recompiles every lit
   * shader): the sun's light is the moon's at night. Returns the name.
   */
  setTime(name = 'afternoon') {
    const T = TIMES[name];
    if (!T) return this.time;
    this.time = name;
    const sunPos = dirOf(T.elev, T.az, new THREE.Vector3());
    const lightDir = T.moon ? dirOf(T.moon.elev, T.moon.az, new THREE.Vector3()) : sunPos.clone();
    this.sunDir.copy(lightDir);
    this.sunDirU.value.copy(lightDir);
    this.sun.color.setRGB(...T.color);
    this.sun.intensity = T.intensity;
    this.sunColor.value.setRGB(...T.color).multiplyScalar(T.intensity);
    this.skyGain.value = T.sky;
    for (const sky of [this.sky]) {
      sky.sunPosition.value.copy(sunPos);
      sky.turbidity.value = T.turbidity;
      sky.showSunDisc.value = T.elev > -1 ? 1 : 0;
    }
    this._envSun = sunPos;
    this.bounce.value.setRGB(...T.bounce);
    this.bakeSky(sunPos, T.turbidity);
    this.renderer.toneMappingExposure = T.exposure;
    this.scene.environmentIntensity = T.env;
    LIGHT.sprite = T.sprite;
    LIGHT.lamps = T.lamps;
    LIGHT.display = T.display;
    LIGHT.time = name;
    // the haze's colour for things drawn without the fog (the hills): the sky at the horizon toward the sun, roughly
    // ((V8) night 0.02 -> 0.006: the hills read lighter than the night sky above them)
    const k = name === 'night' ? 0.006 : name === 'dusk' ? 0.32 : name === 'midday' ? 0.62 : 0.55;
    LIGHT.haze = name === 'dusk' ? [k * 1.25, k * 0.85, k * 0.8] : name === 'night' ? [k * 0.6, k * 0.7, k * 1.1] : [k, k * 1.08, k * 1.2];
    LIGHT.cloudSun = new THREE.Color(...T.color).multiplyScalar(T.intensity * 0.12);
    LIGHT.cloudSky = name === 'night' ? new THREE.Color(0.012, 0.014, 0.02) : name === 'dusk' ? new THREE.Color(0.32, 0.22, 0.24) : new THREE.Color(0.62, 0.66, 0.72).multiplyScalar(name === 'midday' ? 1.15 : 1);
    for (const f of this.onTime) f(name, LIGHT);
    return name;
  }

  /** The play camera; builds the post-processing chain for it. */
  setCamera(camera) {
    this.camera = camera;
    this._buildPipeline();
  }

  _buildPipeline() {
    const { renderer, scene, camera } = this;
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false; // tone mapping and the grade are done below

    // pre-pass: depth, normals and velocity of everything opaque
    const pre = pass(scene, camera, { samples: 0 });
    pre.transparent = false;
    // ((V8) the grass is drawn in the lit pass only: its pixels take the ground's depth, velocity and AO under them.
    // Measured: copies of it cost in the pre-pass, not in the lit pass; the mask follows the camera's, render())
    this._preLayers = new THREE.Layers();
    this._preLayers.mask = camera.layers.mask & ~(1 << GRASS_LAYER);
    pre.setLayers(this._preLayers);
    pre.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
    pre.getTexture('output').type = THREE.UnsignedByteType;
    const preColor = pre.getTextureNode('output');
    const preNormal = sample((uvNode) => unpackRGBToNormal(preColor.sample(uvNode)));
    const preDepth = pre.getTextureNode('depth');
    const preVelocity = pre.getTextureNode('velocity');

    // ambient occlusion
    const aoNode = ao(preDepth, preNormal, camera);
    aoNode.resolutionScale = 0.5;
    aoNode.useTemporalFiltering = true;
    aoNode.radius.value = 0.6; // m
    aoNode.thickness.value = 1.0;
    aoNode.distanceExponent.value = 1.0;
    aoNode.scale.value = 1.6;
    aoNode.samples.value = 12;
    // edge-aware denoise (depth and normals), so the AO does not crawl on a moving body
    const aoClean = denoise(aoNode.getTextureNode(), preDepth, preNormal, camera);
    aoClean.radius.value = 4;
    const aoTex = rtt(aoClean, null, null, { resolutionScale: 0.5 }); // (at the AO's own resolution)

    // the lit scene, with the AO on its indirect light only
    const scenePass = pass(scene, camera, { samples: 0 });
    scenePass.contextNode = builtinAOContext(aoTex.sample(screenUV).r);
    const beauty = scenePass.getTextureNode('output');

    // anti-aliasing
    const aa = traa(beauty, preDepth, preVelocity, camera);
    const aaTex = aa.getTextureNode();

    // motion blur along the velocity (uv per frame), capped, gated off when frames were skipped
    const b = this.blur;
    const vel = Fn(() => {
      const v = preVelocity.sample(screenUV).xy.mul(vec2(0.5, -0.5)).mul(b.shutter).toVar();
      const px = length(v.mul(this._res));
      const cap = b.maxPx.mul(this._res.y.div(720));
      const keep = min(float(1), cap.div(max(px, 1e-4))).mul(smoothstep(b.minPx, b.minPx.mul(2), px));
      return v.mul(keep).mul(b.on);
    })();
    const blurred = motionBlur(aaTex, vel, int(b.samples));

    // bloom on the HDR picture: only what is far brighter than anything lit
    // (V2: was strength 0.5, radius 0.3, threshold 3.0: the afternoon sun's highlight on the car's clear
    // coat and the wheel arches is 3 to 8 x and bloomed into large white blobs. Now a threshold of 7 with a
    // soft knee, a shorter radius and the glow of broad highlights capped: the flash, tracers, sparks and
    // the lamps, 20 x and up, still glow; the paint's sun glint keeps a small halo)
    const glow = bloom(aaTex, 0.42, 0.16, 7.0);
    glow.smoothWidth.value = 3.0;
    const hdr = blurred.add(vec4(glow.rgb, 0));

    // tone mapping, then the grade in display space
    const g = this.grade;
    const graded = Fn(() => {
      const c = renderOutput(hdr, this.toneMapping, THREE.SRGBColorSpace).rgb.toVar();
      const l = luminance(c);
      c.addAssign(g.cool.mul(smoothstep(0.5, 0.05, l)));
      c.addAssign(g.warm.mul(smoothstep(0.4, 0.95, l)));
      c.assign(c.clamp(0, 1));
      c.assign(mix(c, c.mul(c).mul(float(3).sub(c.mul(2))), g.contrast));
      c.assign(saturation(c, g.saturation));
      const d = screenUV.sub(0.5).mul(vec2(1.25, 1)).length();
      const vig = float(1).sub(smoothstep(0.35, 0.95, d).mul(g.vignette));
      return vec4(c.mul(vig), 1);
    })();

    this._nodes = { graded, aoTex, preVelocity, preNormal, pre, scenePass, aa, aoNode, glow };
    pipeline.outputNode = graded;
    this.pipeline = pipeline;
  }

  /** Rebuilds the chain (after changing `toneMapping` or the motion blur's sample count). */
  rebuild() {
    if (this.pipeline) this.pipeline.dispose();
    this.renderer.toneMapping = this.toneMapping;
    this._buildPipeline();
    if (this.debug) this.show(this.debug);
  }

  /** Shows one buffer instead of the picture ('ao', 'velocity', 'normal'), or null for the picture. */
  show(what = null) {
    this.debug = what;
    const n = this._nodes;
    let out = n.graded;
    if (what === 'ao') out = vec4(vec3(n.aoTex.sample(screenUV).r), 1);
    else if (what === 'velocity') out = vec4(abs(n.preVelocity.sample(screenUV).xy).mul(40), 0, 1);
    else if (what === 'normal') out = vec4(n.preNormal.mul(0.5).add(0.5), 1);
    else if (what === 'hdr') out = vec4(n.scenePass.getTextureNode('output').rgb.div(4), 1); // linear / 4, for reading values
    this.pipeline.outputNode = out;
    this.pipeline.needsUpdate = true;
  }

  /** Cycles full / plain; returns the new one. */
  cycle() {
    this.quality = QUALITIES[(QUALITIES.indexOf(this.quality) + 1) % QUALITIES.length];
    return this.quality;
  }

  /**
   * The bodies' materials: the atlas is one PBR material for skin, cloth, hair and shoes, told
   * apart by the roughness/specular each region carries in its ORM texture (skin 0.55 / 0.44,
   * cloth 0.73 to 0.86 / 0.56). Cloth goes rougher with less specular and a soft sheen at grazing
   * angles; skin gets a warm wrap of light past the sun's terminator (light scattered under it).
   */
  dressBody(model) {
    model.traverse((o) => {
      if (!o.isSkinnedMesh || o.userData.dressed) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((mat) => this._dressAtlas(mat));
      o.material = Array.isArray(o.material) ? out : out[0];
      o.userData.dressed = true;
    });
  }

  _dressAtlas(mat) {
    if (!mat.roughnessMap || !mat.map || mat.isNodeMaterial) return mat;
    const nm = new THREE.MeshPhysicalNodeMaterial();
    for (const key in mat) nm[key] = mat[key]; // (as the renderer's own conversion does: NodeLibrary)
    nm.name = `${mat.name} (dressed)`;
    const orm = texture(mat.roughnessMap);
    const r = orm.g;
    const s = orm.a;
    const albedo = texture(mat.map).rgb;
    const skin = smoothstep(0.05, 0.02, abs(r.sub(0.55))).mul(smoothstep(0.07, 0.03, abs(s.sub(0.44))));
    const cloth = smoothstep(0.695, 0.715, r).mul(smoothstep(0.895, 0.88, r));
    nm.roughnessNode = mix(r, max(r, 0.93), cloth).sub(skin.mul(0.03));
    nm.specularIntensityNode = s.mul(mix(float(1), float(0.4), cloth));
    nm.sheenNode = mix(albedo, vec3(1), 0.25).mul(cloth).mul(0.55);
    nm.sheenRoughnessNode = float(0.55);
    // skin: the light that bleeds past the terminator, reddened
    const ndl = dot(normalWorld, this.sunDirU);
    const band = smoothstep(-0.4, 0.12, ndl).mul(float(1).sub(smoothstep(0.12, 0.65, ndl)));
    nm.emissiveNode = albedo.mul(this.sunColor).mul(vec3(1.0, 0.42, 0.28)).mul(band.mul(skin).mul(0.055));
    nm.needsUpdate = true;
    return nm;
  }

  /** The guns: metal reads as metal under the sky (more of the environment in it). */
  dressGun(root) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.isMeshBasicMaterial) return;
      const m = o.material;
      if (m.userData.dressed) return;
      m.envMapIntensity = /steel|metal/i.test(m.name) ? 1.25 : 1.0;
      m.userData.dressed = true;
    });
  }

  /**
   * (V3) The first cascade's far edge (m along the view): 9 on foot, 14 / 8 in the car (chase / cockpit),
   * 20 / 12 in the helicopter. The cascades are resized only when it changes.
   */
  setShadow(near) {
    if (near === this.shadowNear) return;
    this.shadowNear = near;
    if (this.csm.camera) this._sizeCascades();
  }

  /** Sizes each cascade for SHADOW_FOV (whatever the camera's own), its map, depth range and biases. */
  _sizeCascades() {
    const csm = this.csm;
    const camera = this.camera;
    const fov = camera.fov;
    camera.fov = SHADOW_FOV;
    camera.updateProjectionMatrix();
    csm.updateFrustums();
    camera.fov = fov;
    camera.updateProjectionMatrix();
    csm.lights.forEach((light, i) => {
      const s = light.shadow;
      const size = SHADOW_MAPS[i] || 2048;
      if (s.mapSize.x !== size) s.mapSize.set(size, size);
      const width = s.camera.right - s.camera.left;
      const texel = width / size;
      s.camera.near = 1;
      s.camera.far = SHADOW_MARGIN + width * 1.3 + 60;
      s.camera.updateProjectionMatrix();
      // (the sun's own biases were for 5.4 mm texels over a 70 m depth: scaled to each cascade's texel)
      s.normalBias = texel * 2.2;
      s.bias = -(texel * 0.9) / (s.camera.far - s.camera.near);
      s.radius = this.sun.shadow.radius;
    });
    this.cascades = csm.lights.map((l) => ({ width: +(l.shadow.camera.right - l.shadow.camera.left).toFixed(1), map: l.shadow.mapSize.x, texelCm: +(((l.shadow.camera.right - l.shadow.camera.left) / l.shadow.mapSize.x) * 100).toFixed(2) }));
  }

  /** Puts the sky round the camera and the sun's direction over the player (the cascades follow the view). */
  follow() {
    const camera = this.camera;
    this.sky.position.copy(camera.position);
    const csm = this.csm;
    if (!csm.camera) {
      csm._init({ camera, renderer: this.renderer });
      this._sizeCascades();
    }
    // ((V4) layer 0 (the body, the loose cases and magazines) casts in the first cascade only: the body is always in
    // it (9 m on foot with the camera 3 m behind, 14 / 8 m in the car, 20 / 12 m in the helicopter with the pilot 15 m
    // ahead of the chase camera at most); the first two draw batch.js's per-part proxies and small world patches
    // (NEAR_LAYER), the last two one rest-pose proxy per vehicle and the large patches (FAR_LAYER); SHADOW_LAYER (the
    // blades, the cones, the plates) in all four)
    const all = this.sun.shadow.camera.layers.mask;
    csm.lights.forEach((l, i) => {
      l.shadow.camera.layers.mask = !PERF.far ? all : i === 0 ? (all & ~(1 << FAR_LAYER)) : i < FAR_CASCADE ? (1 << SHADOW_LAYER) | (1 << NEAR_LAYER) : (1 << SHADOW_LAYER) | (1 << FAR_LAYER);
    });
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 100);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /**
   * Draws a frame. `outside` is set when called outside the animation loop (demo.render()): the
   * renderer's frame counter only moves in its own loop, and the per-frame work (shadow map, TRAA
   * history, velocity, skinning's previous bones) keys on it, so it is moved on here.
   */
  render(outside = false) {
    const renderer = this.renderer;
    if (outside) renderer._nodes.nodeFrame.update();
    this.follow();
    if (PERF.matrix) this.scene.updateMatrixWorld();
    followSkinned(); // ((V4) batch.js: the skinned batches' culling spheres onto their vehicles)
    if (this._preLayers) this._preLayers.mask = this.camera.layers.mask & ~(1 << GRASS_LAYER);
    for (const f of this.before) f(this.camera, this);
    if (this.quality === 'plain' || !this.pipeline) {
      renderer.render(this.scene, this.camera);
    } else {
      renderer.getDrawingBufferSize(_size);
      this._res.value.copy(_size);
      this.blur.on.value = this.steps === 1 ? 1 : 0;
      this.pipeline.render();
    }
    this.steps = 0;
  }
}
