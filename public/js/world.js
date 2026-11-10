// ─────────────────────────────────────────────────────────────
// World — the corridor, rendered live. Everything that moves on
// screen is generated here: no video, no textures, no models.
//   · instanced voxel architecture
//   · torches that stay dark until the visitor reaches them
//   · a shader portal at the far end
//   · a swarm of voxels that re-assembles into a symbol per chapter
//   · the warm light the visitor carries (their cursor)
//   · a film pass: chromatic aberration, warp blur, vignette, grain
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SHAPES } from './shapes.js';

const BASE_FOV = 64;
const PORTAL_Z = -62;

// Camera stop per chapter. The camera leans away from the side the hologram stands on.
const STOPS = [
  { x: 0,    y: 3.0, z: 3 },
  { x: -2.2, y: 3.0, z: -8 },
  { x: 2.2,  y: 3.0, z: -19 },
  { x: -2.2, y: 3.0, z: -30 },
  { x: 2.2,  y: 3.0, z: -41 },
  { x: 0,    y: 3.6, z: -50 },
];
const TORCH_Z = [null, -14, -25, -36, -47, -57.5];   // torch pair lit on arriving at chapter i
const MOOD = [
  { shape: 'loopOpen',   bloom: 1.0,  torch: 1.0 },
  { shape: 'network',    bloom: 1.0,  torch: 1.0 },
  { shape: 'merkle',     bloom: 1.0,  torch: 1.0 },
  { shape: 'lattice',    bloom: 1.0,  torch: 1.0 },
  { shape: 'rings',      bloom: 0.8,  torch: 0.28, portal: 0.4 },
  { shape: 'loopClosed', bloom: 1.1,  torch: 1.0, portal: 0.75 },
];

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uKick: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uKick;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      float ca = (0.0022 + uKick*0.012) * r2 * 4.0;
      vec3 col = vec3(0.0);
      // radial streak toward the vanishing point while warping between chapters
      for (int i = 0; i < SAMPLES; i++){
        float s = 1.0 - uKick * 0.085 * float(i) / float(SAMPLES);
        vec2 uv = 0.5 + c * s;
        col.r += texture2D(tDiffuse, uv + c*ca).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv - c*ca).b;
      }
      col /= float(SAMPLES);
      float v = smoothstep(0.92, 0.22, length(c * vec2(1.0, 1.12)));
      col *= mix(0.12, 1.0, v);
      col += (hash(vUv * 900.0 + fract(uTime) * 61.0) - 0.5) * 0.028;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

const PortalShader = {
  uniforms: { uTime: { value: 0 }, uWarm: { value: 0 }, uPulse: { value: 0 }, uPower: { value: 0.5 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform float uTime, uWarm, uPulse, uPower; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+7.1; a*=0.5; } return s; }
    void main(){
      vec2 p = vUv*2.0 - 1.0;
      float r = length(p);
      float a = atan(p.y, p.x) + uTime*0.12 + 1.4/(r+0.35);
      vec2 q = vec2(cos(a), sin(a)) * (r*2.4) - vec2(0.0, uTime*0.25);
      float n = fbm(q + fbm(q*1.7 + uTime*0.1));
      float arms = smoothstep(0.35, 0.85, n);
      // voxel-quantised rings so the vortex still belongs to this blocky world
      float rings = 0.5 + 0.5*sin(floor(r*14.0)/14.0*26.0 - uTime*1.6);
      float core = smoothstep(0.55, 0.0, r);
      vec3 violet = vec3(0.42, 0.25, 0.95), pale = vec3(0.86, 0.82, 1.0), amber = vec3(1.0, 0.62, 0.28);
      vec3 col = mix(violet, pale, arms) * (0.25 + 0.75*arms) * (0.7 + 0.3*rings);
      col += mix(pale, amber, uWarm) * core * (0.55 + uPulse*0.5);
      col = mix(col, col*vec3(1.25,0.9,0.7), uWarm*0.5);
      float edge = smoothstep(1.0, 0.72, r);
      gl_FragColor = vec4(col * edge * uPower, edge);
    }`,
};

export function createWorld(canvas, { reduce = false, coarse = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040106');
  scene.fog = new THREE.FogExp2('#040106', 0.011);

  const cam = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.3, 200);
  cam.position.set(0, 1.2, 17);

  // ── Lights ──────────────────────────────────────
  scene.add(new THREE.AmbientLight('#2a1640', 1.5));
  const portalLight = new THREE.PointLight('#ede9fe', 90, 70);
  portalLight.position.set(0, 4.5, PORTAL_Z + 2.5);
  scene.add(portalLight);
  const indigoR = new THREE.PointLight('#6366f1', 40, 46); indigoR.position.set(15, 3.5, -30); scene.add(indigoR);
  const purpleL = new THREE.PointLight('#5b21b6', 30, 44); purpleL.position.set(-15, 3.5, -22); scene.add(purpleL);
  const floorGlow = new THREE.PointLight('#7c3aed', 16, 22); floorGlow.position.set(0, -2.5, -22); scene.add(floorGlow);

  // ── Architecture (instanced) ────────────────────
  const MATS = {
    dark:   new THREE.MeshStandardMaterial({ color: '#0e0817', roughness: 0.62, metalness: 0.18 }),
    mid:    new THREE.MeshStandardMaterial({ color: '#160d23', roughness: 0.6,  metalness: 0.2 }),
    light:  new THREE.MeshStandardMaterial({ color: '#1d122c', roughness: 0.5,  metalness: 0.28 }),
    accent: new THREE.MeshStandardMaterial({ color: '#251137', roughness: 0.5,  metalness: 0.3 }),
    violet: new THREE.MeshStandardMaterial({ color: '#2d123c', roughness: 0.5,  metalness: 0.3, emissive: '#1a0820', emissiveIntensity: 0.3 }),
    wall:   new THREE.MeshStandardMaterial({ color: '#0b0713', roughness: 0.72, metalness: 0.15 }),
    iron:   new THREE.MeshStandardMaterial({ color: '#1a1414', roughness: 0.3,  metalness: 0.8 }),
    rune:   new THREE.MeshBasicMaterial({ color: '#4c2fa0' }),
  };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const batches = {};
  const box = (mat, x, y, z, sx, sy, sz, rz = 0) => (batches[mat] ||= []).push([x, y, z, sx, sy, sz, rz]);
  const jit = (a, b) => a + Math.random() * b;

  // floor
  for (let z = -1; z > PORTAL_Z - 3; z -= 2)
    for (let x = -9; x <= 9; x += 2)
      box((Math.abs(x) + Math.abs(z)) % 4 === 0 ? 'light' : 'dark', x, -0.65 + (Math.random() < 0.08 ? 0.05 : 0), z, 2, 0.3, 2);
  // two rune channels in the floor, running toward the portal
  for (const x of [-3, 3]) box('rune', x, -0.495, (PORTAL_Z - 1) / 2, 0.06, 0.02, -PORTAL_Z + 1);
  // pillars + stepped arches
  for (let z = -2.5; z > PORTAL_Z + 3; z -= 9) {
    for (const side of [-1, 1]) {
      const x = side * 7.5;
      box('accent', x, 0, z, 2, 0.3, 2);
      for (let y = 0.5; y < 6; y += 0.6)
        box(y < 1.5 ? 'mid' : (y < 3.5 ? 'light' : 'accent'), x, y, z, 1.2 * jit(0.9, 0.2), 0.6 * jit(0.85, 0.3), 1.2 * jit(0.9, 0.2));
      box('violet', x, 6.3, z, 1.6, 0.4, 1.6);
      for (let s = 0; s < 8; s++) box(s < 4 ? 'accent' : 'violet', side * (7.5 - s * 0.5), 5.5 + s * 0.4, z, 0.5, 0.4, 0.5);
    }
    box('violet', 0, 5.5 + 8 * 0.4, z, 1.5, 0.4, 0.7);
  }
  // walls
  for (let z = -2; z > PORTAL_Z + 2; z -= 1.05)
    for (const side of [-1, 1])
      for (let row = 0; row < 6; row++)
        box(row < 2 ? 'wall' : (row === 2 ? 'mid' : 'dark'), side * (8.8 - (row % 2 ? 1.1 : 0)), row * 1.05 + 0.5, z,
          2.2 * jit(0.85, 0.3), 1.05 * jit(0.85, 0.3), 1.05 * jit(0.85, 0.3));
  // torch brackets
  TORCH_Z.forEach(z => { if (z !== null) for (const side of [-1, 1]) box('iron', side * 8.15, 4.6, z, 0.7, 0.14, 0.14, side * 0.5); });

  const dummy = new THREE.Object3D(), tmpCol = new THREE.Color();
  for (const [key, arr] of Object.entries(batches)) {
    const m = new THREE.InstancedMesh(unit, MATS[key], arr.length);
    arr.forEach((a, i) => {
      dummy.position.set(a[0], a[1], a[2]); dummy.scale.set(a[3], a[4], a[5]); dummy.rotation.set(0, 0, a[6]);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, tmpCol.setScalar(key === 'rune' ? 1 : 0.8 + Math.random() * 0.5));
    });
    m.frustumCulled = false;
    scene.add(m);
  }
  dummy.rotation.set(0, 0, 0);

  // ── Torches ─────────────────────────────────────
  const COLD = new THREE.Color('#3a2a78'), HOT = new THREE.Color('#ffb066');
  const torches = [];   // one entry per side
  TORCH_Z.forEach((z, ch) => {
    if (z === null) return;
    for (const side of [-1, 1]) {
      const flame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.36, 0.24), new THREE.MeshBasicMaterial({ color: COLD.clone() }));
      flame.position.set(side * 7.9, 5.0, z);
      scene.add(flame);
      const light = new THREE.PointLight('#6366f1', 3, 15, 1.7);
      light.position.set(side * 7.3, 5.2, z);
      // phones get one light per pair to keep the fragment cost down
      if (!coarse || side === 1) { if (coarse) light.position.x = 0; scene.add(light); }
      torches.push({ ch, side, flame, light, lit: 0, target: 0, phase: Math.random() * 6 });
    }
  });
  const SPARKS_PER = 5;
  const sparkMesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({
    color: '#ffb066', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }), torches.length * SPARKS_PER);
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // ── Portal ──────────────────────────────────────
  const portalGroup = new THREE.Group();
  const portalRing = new THREE.Group();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? '#ffffff' : '#c4b5fd', transparent: true, opacity: 0.6 }));
    b.position.set(Math.cos(a) * 4.4, Math.sin(a) * 4.4, 0); b.rotation.z = a;
    portalRing.add(b);
  }
  portalRing.position.y = 3.8;
  portalGroup.add(portalRing);
  const portalMat = new THREE.ShaderMaterial({ ...PortalShader, uniforms: THREE.UniformsUtils.clone(PortalShader.uniforms),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const portalDisc = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 8.6), portalMat);
  portalDisc.position.set(0, 3.8, -0.4);
  portalGroup.add(portalDisc);
  portalGroup.position.set(0, 0, PORTAL_Z);
  scene.add(portalGroup);

  // ── Drifting light cubes ────────────────────────
  const FLOAT_N = coarse ? 36 : 64;
  const floatMesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }), FLOAT_N);
  floatMesh.frustumCulled = false;
  const floaters = [];
  for (let i = 0; i < FLOAT_N; i++) {
    floaters.push({ x: (Math.random() - 0.5) * 13, y: 1 + Math.random() * 6, z: -3 - Math.random() * 58,
      s: 0.05 + Math.random() * 0.14, sp: 0.3 + Math.random() * 0.6, ph: Math.random() * 6.28 });
    floatMesh.setColorAt(i, tmpCol.setHSL(0.75 + Math.random() * 0.05, 0.6, 0.12 + Math.random() * 0.3));
  }
  scene.add(floatMesh);

  // ── Data pulses running down the rune channels ──
  const PULSE_N = 28;
  const pulseMesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({
    color: '#8f78e6', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }), PULSE_N);
  pulseMesh.frustumCulled = false;
  const pulses = Array.from({ length: PULSE_N }, (_, i) => ({ x: i % 2 ? 3 : -3, z: -Math.random() * 62, sp: 5 + Math.random() * 5, len: 0.5 + Math.random() * 1.3 }));
  scene.add(pulseMesh);

  // ── Dust ────────────────────────────────────────
  const DUST_N = coarse ? 300 : 600;
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) { dPos[i * 3] = (Math.random() - 0.5) * 14; dPos[i * 3 + 1] = Math.random() * 7; dPos[i * 3 + 2] = 4 - Math.random() * 66; }
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.05, color: '#d6c8ff', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  scene.add(dust);

  // ── The light you carry ─────────────────────────
  const lamp = new THREE.PointLight('#ffa860', 0, 20, 1.4);
  scene.add(lamp);
  const ember = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshBasicMaterial({ color: '#ffd9a8' }));
  ember.visible = false;
  scene.add(ember);
  const lampTarget = new THREE.Vector3(0, 3, 0);
  const pointer = { x: 0, y: 0, has: !coarse };

  // ── The swarm: voxels that assemble into each chapter's symbol ──
  const N = coarse ? 220 : 340;
  const swarmMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
  const swarm = new THREE.InstancedMesh(unit, swarmMat, N);
  swarm.frustumCulled = false;
  const swarmGroup = new THREE.Group();
  swarmGroup.add(swarm);
  scene.add(swarmGroup);
  const PAL = [new THREE.Color('#6f4fd6'), new THREE.Color('#e8862c'), new THREE.Color('#bfb2ee')];
  const cur = new Float32Array(N * 3), tgt = new Float32Array(N * 3);
  const ccol = new Float32Array(N * 3), tcol = new Float32Array(N * 3);
  const cscl = new Float32Array(N), tscl = new Float32Array(N), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    seed[i] = Math.random();
    cur[i * 3] = (Math.random() - 0.5) * 12; cur[i * 3 + 1] = (Math.random() - 0.5) * 6; cur[i * 3 + 2] = (Math.random() - 0.5) * 12;
    swarm.setColorAt(i, PAL[0]);
  }
  let shapeName = '', shapeMeta = { spin: 0, tilt: 0 };
  function setShape(name) {
    if (name === shapeName || !SHAPES[name]) return;
    shapeName = name;
    const { pts, spin = 0, tilt = 0 } = SHAPES[name](N);
    shapeMeta = { spin, tilt };
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      tgt[i * 3] = p[0]; tgt[i * 3 + 1] = p[1]; tgt[i * 3 + 2] = p[2];
      const c = PAL[p[3] | 0];
      tcol[i * 3] = c.r; tcol[i * 3 + 1] = c.g; tcol[i * 3 + 2] = c.b;
      tscl[i] = p[4];
    }
  }
  const anchor = new THREE.Vector3(0, 5, -8), anchorT = new THREE.Vector3(0, 5, -8);
  let swScale = 1, swScaleT = 1, swOp = 0, swOpT = 0, swSpin = 0;
  const layouts = [];   // per chapter: { ndc, narrow } supplied by the page

  function placeSwarm(ch) {
    const s = STOPS[ch], aspect = cam.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    if (ch === 0) {                       // a crest above the headline
      const portrait = aspect < 0.8;
      anchorT.set(s.x, s.y + (portrait ? 3.7 : 2.3), s.z - 9.5);
      swScaleT = portrait ? 0.36 : 0.62; swOpT = 1;
    } else if (ch === STOPS.length - 1) { // the loop closes around the portal
      anchorT.set(0, 3.8, PORTAL_Z + 1.2);
      swScaleT = 2.0 * THREE.MathUtils.clamp(aspect / 1.3, 0.42, 1); swOpT = 1;
    } else {
      const lay = layouts[ch];
      if (lay && !lay.narrow) {           // stand in the free half of the screen
        const depth = 8.5, halfW = depth * tanH * aspect;
        const size = Math.min(0.92, (lay.width * halfW) / 5.4);
        // the camera turns slightly back toward the corridor's axis; follow that turn
        anchorT.set(s.x - (0.8 * s.x / 14) * depth + lay.ndc * halfW, s.y - 0.25, s.z - depth);
        swScaleT = size; swOpT = 1;
      } else {                            // no room: hang back behind the text, dimmed
        anchorT.set(s.x, s.y + 2.6, s.z - 13);
        swScaleT = 0.8; swOpT = 0.3;
      }
    }
  }

  // ── Post ────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), coarse ? 0.55 : 0.8, 0.55, 0.2);
  composer.addPass(bloom);
  const film = new ShaderPass({ ...FilmShader, defines: { SAMPLES: coarse ? 2 : 6 } });
  composer.addPass(film);
  composer.addPass(new OutputPass());
  const bloomBase = bloom.strength;

  // ── State ───────────────────────────────────────
  let chapter = 0, begun = false, beginT = 0, kick = 0, level = 0;
  let moodBloom = 1, moodTorch = 1, moodPortal = 1, warm = 0;
  const mouse = { x: 0, y: 0 };
  const look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  const bursts = [];
  setShape('loopOpen'); placeSwarm(0); anchor.copy(anchorT);

  const ray = new THREE.Vector3();
  function spawnBurst(cx, cy) {
    if (reduce || bursts.length > 4) return;
    const nx = (cx / window.innerWidth) * 2 - 1, ny = -(cy / window.innerHeight) * 2 + 1;
    const dir = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    const p = cam.position.clone().addScaledVector(dir, 7);
    const g = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const s = 0.06 + Math.random() * 0.14;
      const m = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.06 + Math.random() * 0.06, 0.95, 0.55 + Math.random() * 0.25),
        transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.scale.setScalar(s); m.position.copy(p);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.2) * 4, (Math.random() - 0.5) * 4);
      m.userData.rs = (Math.random() - 0.5) * 6;
      g.add(m);
    }
    g.userData.life = 1;
    scene.add(g); bursts.push(g);
  }

  // ── Loop ────────────────────────────────────────
  const clock = new THREE.Clock();
  const v3 = new THREE.Vector3();
  let rafId = null;

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = performance.now() * 0.001;
    const k1 = a => 1 - Math.exp(-dt * a);

    // camera
    const stop = STOPS[chapter];
    const introSlow = begun && t - beginT < 3.2;
    if (begun) {
      const kz = k1(introSlow ? 1.25 : 3.3);
      const dz = stop.z - cam.position.z;
      const bob = reduce ? 0 : Math.sin(t * 10.5) * 0.055 * Math.min(1, Math.abs(dz) / 3.5);
      cam.position.x += (stop.x + mouse.x * 1.3 - cam.position.x) * kz;
      cam.position.y += (stop.y - mouse.y * 0.6 + Math.sin(t * 0.6) * 0.07 + bob - cam.position.y) * kz;
      cam.position.z += dz * kz;
    } else {
      cam.position.y = 1.2 + Math.sin(t * 0.5) * 0.08;
    }
    cam.lookAt(cam.position.x * 0.2 + mouse.x * 2, cam.position.y - 0.5, cam.position.z - 14);
    cam.rotation.z = -mouse.x * 0.035;
    look.yaw += (look.tYaw - look.yaw) * k1(5);
    look.pitch += (look.tPitch - look.pitch) * k1(5);
    if (Math.abs(look.yaw) > 0.0004 || Math.abs(look.pitch) > 0.0004) { cam.rotateY(-look.yaw); cam.rotateX(-look.pitch); }

    // warp kick + mood
    kick = Math.max(0, kick - dt * 1.7);
    const k = kick * kick;
    const mood = MOOD[chapter];
    moodBloom += (mood.bloom - moodBloom) * k1(1.5);
    moodTorch += (mood.torch - moodTorch) * k1(1.2);
    moodPortal += ((mood.portal ?? 1) - moodPortal) * k1(1.2);
    warm += (chapter / (STOPS.length - 1) - warm) * k1(0.8);
    cam.fov = BASE_FOV + k * 11;
    cam.updateProjectionMatrix();
    bloom.strength = bloomBase * moodBloom + k * 0.7 + level * 0.35;
    film.uniforms.uKick.value = reduce ? 0 : k;
    film.uniforms.uTime.value = t;

    // the carried light follows the pointer into the scene
    if (begun) {
      if (pointer.has) ray.set(pointer.x, pointer.y, 0.5);
      else ray.set(Math.sin(t * 0.5) * 0.45, 0.1 + Math.cos(t * 0.37) * 0.3, 0.5);
      ray.unproject(cam).sub(cam.position).normalize();
      lampTarget.copy(cam.position).addScaledVector(ray, 6.5);
      ember.position.lerp(lampTarget, k1(6));
      lamp.position.copy(ember.position);
      lamp.intensity += (70 - lamp.intensity) * k1(0.8);
      ember.rotation.x += dt * 1.2; ember.rotation.y += dt * 1.7;
      ember.scale.setScalar(1 + Math.sin(t * 5) * 0.15 + level);
    }

    // torches
    let si = 0;
    for (let i = 0; i < torches.length; i++) {
      const tc = torches[i];
      tc.lit += (tc.target - tc.lit) * k1(tc.target > tc.lit ? 3.5 : 1.5);
      const flick = 0.82 + Math.sin(t * 9 + tc.phase) * 0.1 + Math.sin(t * 23.7 + tc.phase * 2) * 0.08;
      tc.light.color.copy(COLD).lerp(HOT, tc.lit);
      tc.light.intensity = (3 + tc.lit * (coarse ? 20 : 12) * flick) * (0.25 + 0.75 * moodTorch);
      tc.flame.material.color.copy(COLD).lerp(HOT, tc.lit).multiplyScalar(0.5 + tc.lit * (0.6 + 0.5 * moodTorch));
      tc.flame.scale.set(1, 1 + tc.lit * (0.25 + Math.sin(t * 12 + tc.phase) * 0.18), 1);
      for (let s = 0; s < SPARKS_PER; s++, si++) {
        const life = (t * (0.55 + s * 0.07) + tc.phase + s * 0.37) % 1;
        const sz = tc.lit * moodTorch * (1 - life) * 0.11;
        dummy.position.set(tc.flame.position.x + Math.sin(t * 3 + s * 2 + tc.phase) * 0.09 * life, tc.flame.position.y + 0.2 + life * 1.1, tc.flame.position.z + Math.cos(t * 2.3 + s) * 0.09 * life);
        dummy.scale.setScalar(Math.max(sz, 0.0001));
        dummy.rotation.set(t + s, t * 1.3, 0);
        dummy.updateMatrix(); sparkMesh.setMatrixAt(si, dummy.matrix);
      }
    }
    sparkMesh.instanceMatrix.needsUpdate = true;

    // portal
    portalRing.rotation.z += dt * (0.15 + k * 2);
    portalMat.uniforms.uTime.value = t;
    portalMat.uniforms.uWarm.value = warm;
    portalMat.uniforms.uPulse.value = level * 2 + k;
    portalMat.uniforms.uPower.value = (0.4 + warm * 0.3) * moodPortal;
    portalLight.intensity = (70 + warm * 50 + Math.sin(t * 0.6) * 12) * (0.6 + 0.4 * moodTorch);
    portalLight.color.setRGB(0.93 + warm * 0.07, 0.91 - warm * 0.12, 1 - warm * 0.3);

    // floaters
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < FLOAT_N; i++) {
      const f = floaters[i];
      dummy.position.set(f.x, f.y + Math.sin(t * f.sp + f.ph) * 1.2, f.z);
      dummy.rotation.set(t * 0.3 + f.ph, t * 0.2, 0);
      dummy.scale.setScalar(f.s);
      dummy.updateMatrix(); floatMesh.setMatrixAt(i, dummy.matrix);
    }
    floatMesh.instanceMatrix.needsUpdate = true;

    // rune pulses
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < PULSE_N; i++) {
      const p = pulses[i];
      p.z -= dt * (p.sp + k * 40);
      if (p.z < PORTAL_Z) p.z = 0;
      dummy.position.set(p.x, -0.48, p.z);
      dummy.scale.set(0.05, 0.02, p.len * (1 + k * 3));
      dummy.updateMatrix(); pulseMesh.setMatrixAt(i, dummy.matrix);
    }
    pulseMesh.instanceMatrix.needsUpdate = true;

    // swarm
    anchor.lerp(anchorT, k1(2.4));
    swScale += (swScaleT - swScale) * k1(2.4);
    swOp += ((begun ? swOpT : 0) - swOp) * k1(1.6);
    swarmMat.opacity = swOp;
    swarmGroup.position.copy(anchor);
    swSpin += dt * shapeMeta.spin;
    swarmGroup.rotation.y = shapeMeta.spin ? swSpin : Math.sin(t * 0.45) * 0.28;
    swarmGroup.rotation.x += (shapeMeta.tilt - swarmGroup.rotation.x) * k1(2);
    swarmGroup.scale.setScalar(swScale * (1 + level * 0.25));
    const base = 0.1;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, sd = seed[i];
      const kk = k1(1.6 + sd * 3.2);
      cur[i3] += (tgt[i3] - cur[i3]) * kk; cur[i3 + 1] += (tgt[i3 + 1] - cur[i3 + 1]) * kk; cur[i3 + 2] += (tgt[i3 + 2] - cur[i3 + 2]) * kk;
      ccol[i3] += (tcol[i3] - ccol[i3]) * kk; ccol[i3 + 1] += (tcol[i3 + 1] - ccol[i3 + 1]) * kk; ccol[i3 + 2] += (tcol[i3 + 2] - ccol[i3 + 2]) * kk;
      cscl[i] += (tscl[i] - cscl[i]) * kk;
      const w = 0.035 + k * 0.5 * sd;
      dummy.position.set(cur[i3] + Math.sin(t * 0.9 + sd * 40) * w, cur[i3 + 1] + Math.cos(t * 1.1 + sd * 31) * w, cur[i3 + 2] + Math.sin(t * 0.7 + sd * 17) * w);
      dummy.rotation.set(sd * 6 + t * 0.2, sd * 3 + t * 0.15, 0);
      dummy.scale.setScalar(Math.max(0.0001, cscl[i] * base * (0.9 + Math.sin(t * 2 + sd * 20) * 0.1)));
      dummy.updateMatrix(); swarm.setMatrixAt(i, dummy.matrix);
      const tw = 0.8 + Math.sin(t * 1.7 + sd * 50) * 0.2;
      swarm.setColorAt(i, tmpCol.setRGB(ccol[i3] * tw, ccol[i3 + 1] * tw, ccol[i3 + 2] * tw));
    }
    swarm.instanceMatrix.needsUpdate = true;
    swarm.instanceColor.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);

    // click sparks
    for (let i = bursts.length - 1; i >= 0; i--) {
      const g = bursts[i];
      g.userData.life -= dt * 1.1;
      const life = g.userData.life;
      if (life <= 0) { g.children.forEach(m => m.material.dispose()); scene.remove(g); bursts.splice(i, 1); continue; }
      g.children.forEach(m => {
        m.position.addScaledVector(m.userData.v, dt); m.userData.v.y -= dt * 2.2;
        m.rotation.x += dt * m.userData.rs; m.rotation.y += dt * m.userData.rs; m.material.opacity = life;
      });
    }

    // dust streaks forward during a warp
    const dp = dust.geometry.attributes.position.array, ds = 0.15 + k * 7;
    for (let i = 0; i < DUST_N; i++) {
      dp[i * 3 + 1] += Math.sin(t + i) * 0.0015;
      dp[i * 3 + 2] -= dt * ds;
      if (dp[i * 3 + 2] < -62) dp[i * 3 + 2] = 4;
    }
    dust.geometry.attributes.position.needsUpdate = true;

    composer.render();
  }
  frame();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
    else if (rafId === null) { clock.getDelta(); frame(); }
  });
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h); composer.setSize(w, h);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    placeSwarm(chapter);
  });

  return {
    chapters: STOPS.length,
    begin() { begun = true; beginT = performance.now() * 0.001; ember.visible = true; ember.position.copy(cam.position).add(v3.set(0, 0.5, -5)); },
    setChapter(i, { warp = true } = {}) {
      chapter = Math.max(0, Math.min(STOPS.length - 1, i));
      setShape(MOOD[chapter].shape); placeSwarm(chapter);
      if (warp && !reduce) kick = 1;
    },
    // light the torches for chapter i; returns true if they were dark until now
    ignite(i) {
      let fresh = false;
      torches.forEach(tc => { if (tc.ch === i && tc.target === 0) { tc.target = 1; fresh = true; } });
      return fresh;
    },
    litCount() { return torches.filter(tc => tc.target === 1).length / 2; },
    torchDim() { return MOOD[chapter].torch; },
    setShape,
    setLayout(i, lay) { layouts[i] = lay; if (i === chapter) placeSwarm(chapter); },
    setMouse(x, y) { mouse.x = x; mouse.y = y; pointer.x = x; pointer.y = y; pointer.has = true; },
    setLook(yaw, pitch) { look.tYaw = yaw; look.tPitch = pitch; },
    setLevel(v) { level = v; },
    burst: spawnBurst,
    // 0 far from the portal → 1 standing in front of it
    proximity() { return THREE.MathUtils.clamp(1 - (cam.position.z - PORTAL_Z - 9) / 50, 0, 1); },
  };
}
