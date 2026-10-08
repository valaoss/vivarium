import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TANK, setEnclosure, MOBILE, LIGHT_ON_HOUR, LIGHT_OFF_HOUR } from '../config.js';
import { createRenderer, createCamera, createControls, createRoom } from '../render/scene.js';
import { pbrSet } from '../render/assets.js';
import { fbm3, mulberry } from '../render/textures.js';
import { Newt, loadNewt } from './Newt.js';
import { Ecosystem } from '../eco/Ecosystem.js';
import { bakeHeightfield } from './heightfield.js';

// Exo Terra tarzı 60 × 45 × 45 cm cam teraryum; içinde yarı karasal semender için gölet
const W = 60, D = 45, H = 45;
const WATER_Y = 5.5;
const SAVE_KEY = 'vivarium.terra.v1';
const loader = new GLTFLoader();
const MB = `${import.meta.env.BASE_URL}models/terra/`;

// Zemin: arkaya ve sağa doğru yükselen kara, ön solda gölet çanağı
export function groundHeight(x, z) {
  const back = (D / 2 - z) / D;
  let h = 7 + back * 6 + fbm3(x * 0.07, z * 0.07, 1.3, 3) * 1.4;
  const pond = Math.exp(-(((x + 11) / 16) ** 2 + ((z - 11) / 12) ** 2));
  h -= pond * 9.5;
  return Math.max(0.8, h);
}

export class Terrarium {
  constructor(canvas) {
    setEnclosure({ w: W, h: H, d: D, water: 0, glass: 0.4, key: 'terra' });
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.scene = new THREE.Scene();
    this.camera = createCamera();
    this.controls = createControls(this.camera, canvas);
    this.controls.target.set(0, 20, 0);
    this.camera.position.set(8, 30, 118);
    this.controls.maxPolarAngle = 1.65;
    this.room = createRoom(this.scene, this.renderer);
    this.time = 0;
    this.listeners = {};
    this.food = [];
    this.drops = [];
    this.w = W; this.d = D; this.waterY = WATER_Y;
    this.obstacles = [];
    this.night = false;
    this.eco = new Ecosystem(this);
    this.speedMul = 1;

    this.buildEnclosure();
    this.buildGround();
    this.buildWater();
    this.buildMistParticles();
    this.load();
    this.decor = this.buildDecor();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    setInterval(() => this.save(), 10000);
    this.bindInput();
    this.resize();
  }

  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  emit(ev, data) { for (const fn of this.listeners[ev] ?? []) fn(data); }
  toast(text, kind = 'info') { this.emit('toast', { text, kind }); }

  // ---------------------------------------------------------------- Dünya sorguları (semender için)
  // yükseklik haritası görünen yüzeyden çıkarılır (yosun, yaprak, mantar dahil)
  ground(x, z) { return this.hf ? this.hf.at(x, z) : groundHeight(x, z); }
  groundNormal(x, z, out) { return this.hf ? this.hf.normal(x, z, out) : out.set(0, 1, 0); }
  depthAt(x, z) { return WATER_Y - this.ground(x, z); }
  blocked(x, z, m) {
    if (Math.abs(x) > W / 2 - 3 - m || Math.abs(z) > D / 2 - 3 - m) return true;
    for (const o of this.obstacles) if (!o.top && !o.solid && Math.hypot(x - o.x, z - o.z) < o.r + m) return true;
    if (this.hf) {
      if (this.hf.isSteep(x, z)) return true;
      for (let a = 0; a < 6.28 && m > 0.2; a += 1.0472) if (this.hf.isSteep(x + Math.cos(a) * m, z + Math.sin(a) * m)) return true;
    }
    return false;
  }
  get hide() { return this.hidePos; }

  // ---------------------------------------------------------------- Kafes
  buildEnclosure() {
    const g = TANK.glass;
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.04, transmission: 0, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      clearcoat: 1, depthWrite: false, envMapIntensity: 1.4,
    });
    // ön cam: buğu ve damlalar için ayrı malzeme
    this.fog = { value: 0 };
    const front = glass.clone();
    front.onBeforeCompile = (sh) => {
      sh.uniforms.uFog = this.fog;
      sh.uniforms.uTime = { get value() { return performance.now() / 1000; } };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvGUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uFog; uniform float uTime; varying vec2 vGUv;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // buğu: üstte daha yoğun; damlalar hücrelere bölünmüş noktalar, bazıları aşağı süzülür
            vec2 uv = vGUv * vec2(60.0, 45.0) / 1.2;
            vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
            float rnd = gh(id);
            float fall = step(0.93, rnd) * fract(uTime * 0.02 * (0.5 + rnd) + rnd * 7.0);
            f.y += fall * 2.0 - 1.0 * step(0.93, rnd);
            float drop = smoothstep(0.22 * rnd + 0.05, 0.0, length(f * vec2(1.0, 0.8))) * step(0.35, rnd);
            float haze = uFog * (0.35 + 0.65 * smoothstep(0.2, 1.0, vGUv.y));
            diffuseColor.a = clamp(diffuseColor.a + haze * 0.35 + drop * uFog * 0.55, 0.0, 0.85);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 1.0), haze * 0.6);
          }`);
    };
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; this.scene.add(m); return m; };
    add(new THREE.PlaneGeometry(W, H), front, 0, H / 2, D / 2 + g / 2);
    add(new THREE.PlaneGeometry(D, H), glass, -W / 2 - g / 2, H / 2, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(D, H), glass, W / 2 + g / 2, H / 2, 0, -Math.PI / 2);

    // siyah alüminyum çerçeve: alt bant (ön kesiti gizler), üst çerçeve, kapı ortası
    const frame = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.5 });
    const bar = (w, h, d, x, y, z) => { const m = add(new THREE.BoxGeometry(w, h, d), frame, x, y, z); m.castShadow = true; return m; };
    bar(W + 1.2, 3.4, 1.2, 0, 1.7, D / 2 + 0.6);          // ön alt panel (alçak: göletin ön camı görünsün)
    bar(1.2, 3.4, D + 1.2, -W / 2 - 0.6, 1.7, 0);
    bar(1.2, 3.4, D + 1.2, W / 2 + 0.6, 1.7, 0);
    bar(W + 1.2, 2.2, 1.2, 0, H - 1.1, D / 2 + 0.6);      // üst
    bar(W + 1.2, 2.2, 1.2, 0, H - 1.1, -D / 2 - 0.6);
    bar(1.2, 2.2, D + 1.2, -W / 2 - 0.6, H - 1.1, 0);
    bar(1.2, 2.2, D + 1.2, W / 2 + 0.6, H - 1.1, 0);
    for (const x of [-W / 2 - 0.6, W / 2 + 0.6]) bar(1.2, H, 1.2, x, H / 2, D / 2 + 0.6);
    bar(0.8, H - 5.6, 1.0, 0, (H - 5.6) / 2 + 3.4, D / 2 + 0.7); // iki kanatlı kapının birleşimi
    // kapı kilitleri
    const lockMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.7 });
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.4, 3, 0.8), lockMat, s * 1.4, 26, D / 2 + 1.2);
    // havalandırma ızgarası (ön alt panelde)
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(W - 12, 2.6), new THREE.MeshStandardMaterial({ map: meshTexture(48, 6), transparent: true, alphaTest: 0.3, color: 0x050505 }));
    vent.position.set(0, H - 1.1, D / 2 + 1.25);
    this.scene.add(vent);
    // tel örgü kapak
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: meshTexture(120, 90), transparent: true, alphaTest: 0.25, color: 0x111111, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }));
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = H;
    this.scene.add(lid);
    // LED çubuk lamba (kapak üstünde)
    const lampBody = add(new THREE.BoxGeometry(W - 4, 1.4, 7), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4, metalness: 0.6 }), 0, H + 1.2, -2);
    lampBody.castShadow = true;
    this.lampEmit = new THREE.MeshBasicMaterial({ color: 0xfff6e8 });
    const emit = add(new THREE.PlaneGeometry(W - 6, 5), this.lampEmit, 0, H + 0.45, -2);
    emit.rotation.x = Math.PI / 2;

    // arka duvar: mantar kaplama (cork bark) — yükleme sonrası dolar
    this.backPanel = add(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 1 }), 0, H / 2, -D / 2 + 0.2);
  }

  buildGround() {
    const set = pbrSet('forest_leaves_02', [2.2, 1.6]);
    const seg = MOBILE ? 90 : 140;
    const geo = new THREE.PlaneGeometry(W, D, seg, Math.round(seg * D / W));
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = groundHeight(x, z);
      p.setY(i, h);
      // su altı ve kıyı: ıslak, koyu; göletin dibi çamurlu çakıl tonu
      const wet = 1 - THREE.MathUtils.smoothstep(h, WATER_Y - 0.2, WATER_Y + 1.2);
      const k = 1 - wet * 0.55;
      col[i * 3] = k * (1 - wet * 0.1); col[i * 3 + 1] = k; col[i * 3 + 2] = k * (1 + wet * 0.05);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ ...set, vertexColors: true, roughness: 1, color: 0xb8a890 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    this.scene.add(mesh);
    this.groundMesh = mesh;

    // ön camdan görünen toprak kesiti (katmanlar: drenaj kili, ağ, toprak)
    const cut = new THREE.PlaneGeometry(W, 1, seg, 1);
    const cp = cut.attributes.position;
    const cc = new Float32Array(cp.count * 3);
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), top = cp.getY(i) > 0;
      cp.setXYZ(i, x, top ? groundHeight(x, D / 2 - 0.05) : 0, D / 2 - 0.05);
    }
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x2e2116, roughness: 1 });
    cutMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvY = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vY;').replace('#include <color_fragment>', `#include <color_fragment>
        float clay = 1.0 - smoothstep(2.6, 2.9, vY);
        float spec = fract(sin(dot(floor(gl_FragCoord.xy / 3.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.8 + spec * 0.4), vec3(0.42, 0.24, 0.14) * (0.7 + spec * 0.5), clay);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), smoothstep(2.75, 2.85, vY) * (1.0 - smoothstep(2.95, 3.05, vY)));`);
    };
    this.scene.add(new THREE.Mesh(cut, cutMat));
  }

  buildWater() {
    // Gölet yüzeyi: hafif dalgalı, gökyüzü/oda yansıtan ince su; altında koyu çay rengi hacim
    const geo = new THREE.PlaneGeometry(W, D, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1e2a1a, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.38, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false,
    });
    this.ripples = { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, -100, 0)) };
    this.ripI = 0;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.waterTime = { value: 0 };
      sh.uniforms.uRip = this.ripples;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform vec4 uRip[12]; varying vec3 vWp;
          float wv(vec2 p, float t) { return sin(p.x * 0.9 + t * 1.1) * 0.5 + sin(p.y * 1.3 - t * 0.8) * 0.4 + sin((p.x + p.y) * 2.1 + t * 1.7) * 0.2; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 p = vWp.xz; float t = uTime;
            float e = 0.15;
            vec2 g = vec2(wv(p + vec2(e, 0.0), t) - wv(p - vec2(e, 0.0), t), wv(p + vec2(0.0, e), t) - wv(p - vec2(0.0, e), t)) * 0.02 / e;
            // halkalar: küçük kaynaklarda sık ve hızlı sönen, büyüklerde geniş dalga
            for (int i = 0; i < 12; i++) {
              vec4 R = uRip[i];
              float age = uTime - R.z;
              if (age < 0.0 || age > 4.0) continue;
              float d = length(p - R.xy);
              float k = 7.0 / (0.4 + R.w);
              float ring = R.w * exp(-age * (2.6 - R.w)) * sin(d * k - age * 11.0) * smoothstep(age * 5.0 + 0.6, age * 5.0 - 1.0, d);
              g += normalize(p - R.xy + 0.0001) * ring * 0.18;
            }
            normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
          }`);
    };
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WATER_Y;
    water.renderOrder = 2;
    // yalnızca gölet çanağının üstünde görünsün: kenarları zeminin altında kalır
    this.scene.add(water);
    this.water = water;

    // su hacmi: çay rengi (tanin) bulanıklık — zeminin hemen üstünde koyulaşan ince katman
    const vol = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, WATER_Y - 0.6, D - 0.2), new THREE.MeshBasicMaterial({ color: 0x3b3a1e, transparent: true, opacity: 0.16, depthWrite: false }));
    vol.position.y = (WATER_Y + 0.6) / 2;
    this.scene.add(vol);
  }

  buildMistParticles() {
    const N = 500;
    const geo = new THREE.BufferGeometry();
    this.mistPos = new Float32Array(N * 3);
    this.mistVel = new Float32Array(N * 3);
    this.mistLife = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.mistPos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xeef6ff, size: 0.35, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
    this.mist = new THREE.Points(geo, mat);
    this.mist.frustumCulled = false;
    this.scene.add(this.mist);
    this.mistN = N;
    for (let i = 0; i < N; i++) this.mistPos[i * 3 + 1] = -999;
  }

  async buildDecor() {
    const r = mulberry(11);
    const load = (n) => loader.loadAsync(MB + n + '.glb').then((g) => g.scene);
    const norm = (obj, size, axis = 'max') => {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const s = b.getSize(new THREE.Vector3());
      const k = size / (axis === 'max' ? Math.max(s.x, s.y, s.z) : s[axis]);
      const wrap = new THREE.Group();
      obj.position.sub(b.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, s.y / 2, 0));
      wrap.add(obj);
      wrap.scale.setScalar(k);
      wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return wrap;
    };
    const [cork1, cork2, moss, fern, calathea] = await Promise.all(['cork1', 'cork2', 'moss', 'fern_02', 'calathea_orbifolia_01'].map(load));

    const tint = (obj, c) => obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(c); } });
    const part = (scene, name) => { let m = null; scene.traverse((o) => { if (o.isMesh && o.name === name) m = o; }); const c = m.clone(); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1); return c; };

    // arka duvar: düz mantar meşe kabuğu levhaları, ince ve hafif açılı
    tint(cork1, 0x6e5a4a);
    tint(cork2, 0x7a6655);
    [[-23, 20, 0.1], [-8, 26, -0.15], [7, 19, 0.2], [21, 25, -0.08], [-17, 36, 0.12], [13, 37, -0.1], [27, 38, 0.05]].forEach(([x, y, rz]) => {
      const c = norm(cork1.clone(), 34 + r() * 6);
      c.scale.y *= 0.4;
      c.rotation.set(Math.PI / 2, 0, rz);
      c.position.set(x, y, -D / 2 + 0.4 + r() * 0.6);
      this.fit(c, 0.3, false);
      this.scene.add(c);
    });
    this.backPanel.material.color.set(0x1d140d);

    // saklanak: yatık mantar tüp (sağ arka karada)
    const tube = norm(cork2, 20);
    const tx = 15, tz = -7;
    tube.rotation.y = 0.5;
    tube.position.set(tx, groundHeight(tx, tz) - 2, tz);
    this.fit(tube, 0.6, false);
    this.scene.add(tube);
    this.obstacles.push({ x: tube.position.x, z: tube.position.z, r: 6, solid: true });
    this.hidePos = new THREE.Vector3(tx - 5, 0, tz + 6);

    // yosun yamaları: kare taramanın kenarları gürültüyle eritilir
    moss.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      m.color.setRGB(0.36, 0.5, 0.22);
      m.alphaTest = 0.5;
      m.userData.heightDiscard = `{ vec2 q = vMapUv - 0.5; float n = fract(sin(dot(floor(vMapUv * 40.0), vec2(12.9898, 78.233))) * 43758.5453);
        if (length(q) + sin(atan(q.y, q.x) * 5.0) * 0.05 + n * 0.06 > 0.42) discard; }`;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
          { vec2 q = vMapUv - 0.5; float n = fract(sin(dot(floor(vMapUv * 40.0), vec2(12.9898, 78.233))) * 43758.5453);
            float edge = length(q) + (sin(atan(q.y, q.x) * 5.0) * 0.05) + n * 0.06;
            if (edge > 0.42) discard; }
          #include <alphatest_fragment>`);
      };
    });
    const walk = [this.groundMesh, tube];
    for (const [x, z, s] of [[5, -12, 16], [-22, -12, 14], [22, 6, 13], [-1, 2, 10], [9, 12, 9], [-26, 0, 9]]) {
      const m = norm(moss.clone(), s);
      m.scale.y *= 0.6;
      m.position.set(x, groundHeight(x, z) - 0.35, z);
      m.rotation.y = r() * 6.28;
      this.fit(m, 0.4, true, 0.35);
      drapeOnGround(m, 0.12);
      this.scene.add(m);
      walk.push(m);
      // yosun yastığı yürünebilir bir yükselti: semender üstüne basar, içinden geçmez
      const mb = new THREE.Box3().setFromObject(m);
      this.obstacles.push({ x: m.position.x, z: m.position.z, r: Math.min(mb.max.x - mb.min.x, mb.max.z - mb.min.z) * 0.45, top: m.position.y + (mb.max.y - m.position.y) * 0.55 });
    }
    // bitkiler: tek tek varyantlar (Poly Haven taramaları) gerçek boyutta
    const placePlant = (mesh, x, z, width, ry = r() * 6.28) => {
      const p = norm(mesh, width);
      p.position.set(x, groundHeight(x, z) - 0.4, z);
      p.rotation.y = ry;
      this.fit(p, 0.5, true, 0.4);
      this.scene.add(p);
      const b = new THREE.Box3().setFromObject(p);
      // engel yalnızca gövde/kök kümesi; yapraklar üstten sarkar, altından geçilir
      this.obstacles.push({ x: p.position.x, z: p.position.z, r: Math.min(2.6, Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.12), canopy: Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.4 });
      return p;
    };
    placePlant(part(fern, 'fern_02_b'), -20, -13, 30);
    placePlant(part(fern, 'fern_02_c'), 25, -14, 24);
    placePlant(part(calathea, 'calathea_orbifolia_01_a'), 3, -15, 24);
    placePlant(part(calathea, 'calathea_orbifolia_01_b'), 24, 13, 13);
    placePlant(part(fern, 'fern_02_d'), -27, -2, 16);

    // yaprak döküntüsü: kurumuş çeşitli yapraklar
    const litter = leafLitter(this, 70);
    this.scene.add(litter);
    walk.push(litter);
    this.hf = bakeHeightfield(this.renderer, walk, { w: W, d: D, top: H });

    // semender
    await loadNewt();
    const d = this.state.newt;
    this.newt = new Newt(this, d.pos ? d : { ...d, pos: [-4, this.ground(-4, 0), 0] });
    this.scene.add(this.newt.root);
    this.eco.add(this.newt);
    this.emit('ready');
  }

  // Nesneyi camların ve kapağın içine sığdır: taşarsa içeri kaydır, sığmıyorsa küçült.
  // onGround: tabanı zemine oturt (kaydırma sonrası yeni noktanın yüksekliği)
  fit(obj, margin, onGround, sink = 0) {
    const lim = { x0: -W / 2 + margin, x1: W / 2 - margin, z0: -D / 2 + 0.3 + margin, z1: D / 2 - margin, y1: H - 1.5 };
    for (let k = 0; k < 4; k++) {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z, sy = b.max.y - obj.position.y;
      const kk = Math.min(1, (lim.x1 - lim.x0) / sx, (lim.z1 - lim.z0) / sz, (lim.y1 - obj.position.y) / Math.max(sy, 0.01));
      if (kk < 0.999) { obj.scale.multiplyScalar(kk * 0.98); continue; }
      const dx = Math.max(0, lim.x0 - b.min.x) - Math.max(0, b.max.x - lim.x1);
      const dz = Math.max(0, lim.z0 - b.min.z) - Math.max(0, b.max.z - lim.z1);
      if (!dx && !dz) break;
      obj.position.x += dx;
      obj.position.z += dz;
      if (onGround) obj.position.y = groundHeight(obj.position.x, obj.position.z) - sink;
    }
    obj.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- Yem ve sis
  dropWorm(x, z) {
    const y = this.ground(x, z);
    const worm = makeWorm();
    const inWater = y < WATER_Y - 0.3;
    worm.position.set(x, inWater ? WATER_Y - 0.2 : y + 0.15, z);
    worm.rotation.y = Math.random() * 6.28;
    this.scene.add(worm);
    // ekosistem varlığı: hareket eder (görülür), koku yayar, suda kıvranırken su hareketi üretir
    const f = { kind: 'worm', label: 'Solucan', pos: worm.position, mesh: worm, sink: inWater, eaten: false, phase: Math.random() * 6, size: 3.2, speed: 0.25, food: 30, scent: 1, t0: this.eco.time };
    this.food.push(f);
    this.eco.add(f);
    if (inWater) this.ripple(worm.position, 1);
    this.eco.vibrate(null, worm.position, inWater ? 'water' : 'ground', 0.6, 0.1, 0.1);   // düşüş: tek seferlik
  }
  eat(f) {
    this.scene.remove(f.mesh);
    const i = this.food.indexOf(f);
    if (i >= 0) this.food.splice(i, 1);
    this.eco.remove(f);
    f.eaten = true;
    this.state.fed++;
  }
  ripple(p, amp = 0.5) {
    this.ripples.value[this.ripI].set(p.x, p.z, this.waterTime?.value ?? 0, Math.min(1.5, amp));
    this.ripI = (this.ripI + 1) % this.ripples.value.length;
  }
  get temperature() { return this.temp ?? 20; }
  get humidity() { return this.state.humidity; }
  // gözlem testi: büyük, hızla yaklaşan bir nesne (el) — görülür ve zemin titreşimi yapar
  pokeThreat(at) {
    const p = (at ?? new THREE.Vector3()).clone();
    const from = this.camera.position.clone().sub(p).setLength(13).add(p);    // el oyuncunun tarafından gelir
    const hand = { kind: 'hand', label: 'El', pos: from, size: 9, speed: 25, t: 0 };
    hand.to = p.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.eco.add(hand);
    (this.hands ??= []).push(hand);
  }
  updateHands(dt) {
    if (!this.hands?.length) return;
    for (const h of this.hands) {
      h.t += dt;
      h.pos.lerp(h.to, Math.min(1, dt * 2.4));
      h.speed = h.t < 1.5 ? 25 : 0;
      const wet = h.pos.y < WATER_Y && groundHeight(h.pos.x, h.pos.z) < WATER_Y;
      if (Math.random() < dt * 10) this.eco.vibrate(h, h.pos, wet ? 'water' : 'ground', 0.5, 0.2, 0.1);
      if (wet && Math.random() < dt * 4) this.ripple(h.pos, 0.8);
      if (h.t > 3) this.eco.remove(h);
    }
    this.hands = this.hands.filter((h) => h.alive);
  }
  // semenderin eski derisi: o anki pozun saydam kopyası; sonra semender onu yer
  onNewtShed(n) {
    const src = n.mesh;
    n.root.updateMatrixWorld(true);
    const g = src.geometry, pos = g.attributes.position;
    const out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { src.getVertexPosition(i, v); v.applyMatrix4(src.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    geo.setIndex(g.index);
    geo.computeVertexNormals();
    // buruşukluk: deri ince ve kırışık, yer yer içe çökmüş
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const k = 0.12 * Math.sin(P.getX(i) * 9.1 + P.getZ(i) * 7.3) * Math.cos(P.getY(i) * 11.7);
      P.setXYZ(i, P.getX(i) + k * 0.5, P.getY(i) + k * 0.6, P.getZ(i) - k * 0.4);
    }
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    // yerel çerçeve: +z semenderin baktığı yön; sıyrılırken deri kuyruğa doğru toplanır
    geo.translate(-c.x, -c.y, -c.z);
    geo.rotateY(-n.heading);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbdb39c, roughness: 0.7, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false });
    const skin = new THREE.Mesh(geo, mat);
    skin.position.copy(c);
    skin.rotation.y = n.heading;
    skin.scale.set(0.95, 0.7, 1);
    this.scene.add(skin);
    const tail = new THREE.Vector3(-Math.sin(n.heading), 0, -Math.cos(n.heading));
    skin.userData.peel = (dt) => {
      if (skin.scale.z > 0.42) { skin.scale.z -= dt * 0.07; skin.position.addScaledVector(tail, dt * 0.25); }
    };
    skin.userData.eat = (dt) => {
      const h = n.headPos(new THREE.Vector3());
      skin.position.lerp(h, Math.min(1, dt * 0.3));
      skin.scale.multiplyScalar(1 - dt * 0.18);
    };
    skin.userData.done = () => { skin.removeFromParent(); geo.dispose(); mat.dispose(); };
    this.toast(`${n.data.name} deri değiştiriyor: eski deri ağzından başlayarak sıyrılıyor. Çoğu semender derisini yer.`, 'good');
    return skin;
  }
  spray() {
    this.state.humidity = Math.min(100, this.state.humidity + 18);
    this.sprayT = 1.6;
    this.emit('sfx', 'spray');
  }

  // ---------------------------------------------------------------- Durum
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { s = null; }
    this.state = s ?? { minutes: 10 * 60, humidity: 72, fed: 0, newt: { name: 'Beni', hunger: 40 } };
    if (s?.savedAt) {
      const mins = Math.min(12 * 60, (Date.now() - s.savedAt) / 60000);
      this.state.minutes += mins;
      this.state.humidity = Math.max(35, this.state.humidity - mins * 0.03);
      const nd = this.state.newt;
      if (nd.needs) nd.needs.energy = Math.max(5, nd.needs.energy - mins * 0.012);
      else nd.hunger = Math.min(100, (nd.hunger ?? 40) + mins * 0.012);
    }
  }
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...this.state, newt: this.newt?.serialize() ?? this.state.newt, savedAt: Date.now() }));
    } catch { /* depolama dolu */ }
  }

  // ---------------------------------------------------------------- Döngü
  update(dt) {
    dt = Math.min(dt, 0.1);
    // simülasyon hızı (gözlem paneli): alt adımlara bölünür
    const total = dt * this.speedMul;
    const n = Math.min(12, Math.ceil(total / 0.05));
    for (let i = 0; i < n; i++) this.step(total / n);
    this.controls.update();
  }

  step(dt) {
    this.time += dt;
    this.temp = THREE.MathUtils.lerp(this.temp ?? 20, (this.night ? 18.5 : 21.5) + (this.heatOffset ?? 0), Math.min(1, dt * 0.01));
    const s = this.state;
    s.minutes += dt;
    s.humidity = Math.max(30, s.humidity - dt * 0.012);
    const hour = (s.minutes / 60) % 24;
    const on = hour >= LIGHT_ON_HOUR && hour < LIGHT_OFF_HOUR;
    this.night = !on;
    const lv = this.lightLevel = THREE.MathUtils.lerp(this.lightLevel ?? 1, on ? 1 : 0.06, Math.min(1, dt * 0.8));
    this.room.lamp.intensity = 3.2 * lv;
    this.room.spill.intensity = 900 * lv;
    this.lampEmit.color.setScalar(0.15 + lv * 0.85);
    this.room.floorLamp.intensity = on ? 3000 : 9000;
    if (this.waterTime) this.waterTime.value = this.time;
    this.fog.value += (THREE.MathUtils.smoothstep(s.humidity, 70, 95) - this.fog.value) * Math.min(1, dt * 0.5);

    // sis püskürtme: tepeden yayılan ince damlacıklar, yavaşça çöker
    if (this.sprayT > 0) {
      this.sprayT -= dt;
      for (let k = 0; k < 14; k++) {
        const i = Math.floor(Math.random() * this.mistN);
        this.mistPos.set([-W / 2 + 4 + Math.random() * 8, H - 2, -D / 2 + 5 + Math.random() * 30], i * 3);
        const sp = 8 + Math.random() * 10;
        this.mistVel.set([sp * (0.6 + Math.random() * 0.5), -2 - Math.random() * 3, (Math.random() - 0.5) * 6], i * 3);
        this.mistLife[i] = 3 + Math.random() * 3;
      }
    }
    for (let i = 0; i < this.mistN; i++) {
      if (this.mistLife[i] <= 0) continue;
      this.mistLife[i] -= dt;
      const v = this.mistVel;
      v[i * 3] *= 1 - dt * 1.4; v[i * 3 + 2] *= 1 - dt * 1.4;
      v[i * 3 + 1] = v[i * 3 + 1] * (1 - dt * 1.4) - dt * 1.2;
      for (let a = 0; a < 3; a++) this.mistPos[i * 3 + a] += v[i * 3 + a] * dt;
      const x = this.mistPos[i * 3], y = this.mistPos[i * 3 + 1], z = this.mistPos[i * 3 + 2];
      if (y < this.ground(x, z) || Math.abs(x) > W / 2 || this.mistLife[i] <= 0) { this.mistLife[i] = 0; this.mistPos[i * 3 + 1] = -999; }
    }
    this.mist.geometry.attributes.position.needsUpdate = true;

    // solucanlar: kıvrılır; suda yavaşça dibe çöker
    for (const f of this.food) {
      f.phase += dt;
      const m = f.mesh;
      if (f.sink && Math.random() < dt * 3) this.eco.vibrate(f, f.pos, 'water', 0.45, 0.9, 1.2);
      m.userData.u.uTime.value = f.phase;
      if (f.sink) {
        const floor = this.ground(f.pos.x, f.pos.z) + 0.15;
        f.pos.y = Math.max(floor, f.pos.y - dt * 0.9);
      } else {
        // karada yavaşça sürünür
        m.rotation.y += Math.sin(f.phase * 0.7) * dt * 0.4;
        const sp = 0.25 * dt;
        const nx = f.pos.x + Math.sin(m.rotation.y) * sp, nz = f.pos.z + Math.cos(m.rotation.y) * sp;
        if (this.ground(nx, nz) > WATER_Y && !this.blocked(nx, nz, -1.5)) { f.pos.x = nx; f.pos.z = nz; f.pos.y = this.ground(nx, nz) + 0.12; } else m.rotation.y += dt * 1.2;   // su kenarında yavaşça geri döner
      }
    }
    this.updateHands(dt);
    this.eco.update(dt, this.camera);
  }

  renderFrame() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 54 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const need = Math.max(112, (W / 2 + 15) / Math.tan(hfov / 2));   // ön köşeler kameraya daha yakın: pay bırak
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.length() < need) { dir.setLength(need); this.camera.position.copy(this.controls.target).add(dir); }
  }

  // ---------------------------------------------------------------- Girdi
  bindInput() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    this.mode = 'view';
    this.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      if (this.mode === 'feed') {
        const hit = ray.intersectObject(this.groundMesh)[0];
        if (hit) {
          this.dropWorm(hit.point.x, hit.point.z);
          this.toast('Bir solucan bıraktın. Semender kokusunu alınca yavaşça yaklaşacak.');
        }
        return;
      }
      if (this.newt) {
        const hit = ray.intersectObject(this.newt.root, true)[0];
        this.emit('select', hit ? this.newt : null);
      }
    });
  }
}

// ---------------------------------------------------------------- yardımcılar
function meshTexture(nx, ny) {
  const c = document.createElement('canvas');
  c.width = nx * 4; c.height = ny * 4;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  for (let x = 0; x < nx; x++) g.fillRect(x * 4, 0, 1, c.height);
  for (let y = 0; y < ny; y++) g.fillRect(0, y * 4, c.width, 1);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

// Düz taranmış yamayı zemine giydir: her köşe kendi altındaki zeminin üstüne, kalınlığı korunarak iner
function drapeOnGround(obj, sink) {
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3(), inv = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone();
    const p = o.geometry.attributes.position;
    inv.copy(o.matrixWorld).invert();
    let y0 = Infinity;
    for (let i = 0; i < p.count; i++) y0 = Math.min(y0, v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).y);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      v.y = groundHeight(v.x, v.z) - sink + (v.y - y0);
      v.applyMatrix4(inv);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    o.geometry.computeVertexNormals();
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
}

function leafLitter(world, n) {
  // tek yaprak: sivri oval, orta damarı hafif katlı ve kıvrık
  const geo = new THREE.PlaneGeometry(1, 1.8, 4, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const t = y / 1.8 + 0.5;
    const w = Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.95;
    p.setX(i, x * w);
    p.setZ(i, Math.abs(x) * 0.16 + Math.sin(t * Math.PI) * 0.05 + (t - 0.5) ** 2 * 0.25 + Math.sin(x * 4 + t * 7) * 0.02);
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const r = mulberry(5);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const x = (r() - 0.5) * (W - 3), z = (r() - 0.5) * (D - 3);
    const h = groundHeight(x, z);
    if (h < WATER_Y + 0.4 || world.blocked(x, z, 0.8) || world.ground(x, z) > h + 0.05) continue;
    e.set((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4);
    q.setFromEuler(e);
    const sz = 0.6 + r() * 0.8;
    s.set(sz, sz, sz);
    v.set(x, h + 0.02, z);
    m4.compose(v, q, s);
    mesh.setMatrixAt(k, m4);
    // kahverengi, sarımsı, koyu kırmızımsı tonlar (meşe, kayın, badem yaprağı)
    c.setHSL(0.04 + r() * 0.05, 0.35 + r() * 0.25, 0.03 + r() * 0.05);
    mesh.setColorAt(k, c);
    k++;
  }
  mesh.count = k;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// Solucan (Lumbricus): halkalı pembe-kahve tüp; kıvrılma shader'da
function makeWorm() {
  const L = 3.2, R = 0.13;
  const geo = new THREE.CylinderGeometry(R, R, L, 8, 40, false);
  geo.rotateX(Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / L + 0.5;                 // 0..1
    const taper = Math.min(1, z * 6, (1 - z) * 4) * (1 + 0.25 * Math.exp(-(((z - 0.3) / 0.06) ** 2))); // klitellum şişkinliği
    p.setX(i, p.getX(i) * (0.4 + 0.6 * taper));
    p.setY(i, p.getY(i) * (0.4 + 0.6 * taper));
  }
  geo.computeVertexNormals();
  const u = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a4a42, roughness: 0.35 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vZ;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vZ = position.z;
        float s = position.z;
        transformed.x += sin(s * 1.6 - uTime * 3.0) * 0.35 + sin(s * 3.1 + uTime * 1.7) * 0.08;
        transformed.y += max(0.0, sin(s * 1.2 - uTime * 2.2)) * 0.12;
        transformed.z *= 1.0 + sin(uTime * 2.5 + s) * 0.06;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ring = 0.85 + 0.15 * sin(vZ * 50.0);
        float cl = exp(-pow((vZ / 3.2 + 0.5 - 0.3) / 0.06, 2.0));
        diffuseColor.rgb *= ring;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.4, 0.35), cl * 0.6);`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.userData.u = u;
  return m;
}
