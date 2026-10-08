import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Agent, senseVision, senseVibration } from '../eco/Agent.js';
import { Brain } from '../eco/Brain.js';
import { NEWT_ACTIONS } from './newtActions.js';
import { twoBoneIK, dropToGround } from '../eco/ik.js';
import { physicalMaterial, skinShader } from '../render/materials.js';

// Japon kırmızı karınlı semenderi (Cynops pyrrhogaster), ffish.asia CC0 taraması.
// Modeldeki tek animasyon bir solucan yeme sahnesi; yürüme, yüzme, nefes ve av hareketleri
// burada iskelet kemikleri doğrudan döndürülerek üretilir.

const LENGTH = 11;                 // burun-kuyruk ucu (cm)
const MODEL_LEN = 8.6;             // modelin kendi birimiyle boyu
const S = LENGTH / MODEL_LEN;
const FOOT_Y = 0.62;               // gövde yere yakın: dirsekler yana açık, karın neredeyse yere değer
const TRUNK_MID = -0.2;            // dönüş ekseni: gövde ortası (model x)
const SPRAWL = 0.32;               // semenderin yayvan duruşu: üst kol/uyluk yataya yakın
const UNKEN = 1;                   // unken kavisinin yönü (model ekseni)
const CLOSED_JAW = -0.32;          // calibrated against the scan: exported rest pose is feeding gape
const STEP_LIFT = 0.28;            // salınımda ayak yerden en çok bu kadar kalkar (cm, boyla ölçeklenir)

const TRUNK = ['Bone_109', 'Bone001_84', 'Bone018_83', 'Bone002_82', 'Bone003_81', 'Bone016_80', 'Bone004_79', 'Bone005_78'];
const TAIL = ['Bone006_51', 'Bone007_50', 'Bone008_49', 'Bone009_48', 'Bone010_47', 'Bone011_46', 'Bone012_45', 'Bone013_44', 'Bone014_43', 'Bone015_42', 'Bone017_41'];
// [omuz/kalça, üst kol/uyluk, ön kol/baldır, el/ayak], side: +1 sol (model +z), -1 sağ
const LEGS = {
  LF: { bones: ['Bone048_108', 'Bone049_107', 'Bone050_106', 'Bone090_105'], side: 1, front: true, off: 0 },
  RF: { bones: ['Bone037_96', 'Bone038_95', 'Bone039_94', 'Bone091_93'], side: -1, front: true, off: 0.5 },
  LH: { bones: ['Bone059_65', 'Bone060_64', 'Bone061_63', 'Bone088_62'], side: 1, front: false, off: 0.5 },
  RH: { bones: ['Bone072_77', 'Bone073_76', 'Bone074_75', 'Bone089_74'], side: -1, front: false, off: 0 },
};

// çarpışma noktaları: [ileri (cm), yana, yarıçap] — burun, baş, omuzlar, gövde, kalça, kuyruk
const BODY = [[3.3, 0, 0.5], [2.2, 0, 0.7], [1.6, 1.3, 0.3], [1.6, -1.3, 0.3], [0, 0, 0.8], [-1.6, 1.2, 0.3], [-1.6, -1.2, 0.3], [-3.5, 0, 0.5], [-5.6, 0, 0.6], [-7.6, 0, 1.2]];

const UP = new THREE.Vector3(0, 1, 0);
const LONG = new THREE.Vector3(1, 0, 0);   // model x: kuyruğa doğru
const LAT = new THREE.Vector3(0, 0, 1);    // model z: sol
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = new THREE.Vector3();
const _hp = new THREE.Vector3(), _fw = new THREE.Vector3(), _lv = new THREE.Vector3(), _q1 = new THREE.Vector3();
const _fk = new THREE.Vector3(), _tg = new THREE.Vector3(), _h = new THREE.Vector3(), _sv = new THREE.Vector3(), _tip = new THREE.Vector3(), _k = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let PROTO = null;
export async function loadNewt() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/terra/newt.glb`);
  PROTO = gltf.scene;
}

class Joint {
  constructor(bone) {
    this.bone = bone;
    this.rest = bone.quaternion.clone();
    this.inv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  }
  reset() { this.bone.quaternion.copy(this.rest); }
  // model uzayındaki bir eksen etrafında, kemiğin kendi ekleminden döndür
  rot(axis, angle) {
    if (!angle) return;
    _v.copy(axis).applyQuaternion(this.inv);
    _q.setFromAxisAngle(_v, angle);
    this.bone.quaternion.multiply(_q);
  }
}

// Algı: hareket eden avı görme (ışığa bağlı), suda yayılan / karada zayıf koku, suda yan çizgi.
const VISION = { fovCos: -0.35, night: 0.45, still: 0.15, motionRef: 0.6, thresh: 0.06 };

export class Newt extends Agent {
  constructor(world, data = {}) {
    super(world.eco, { species: 'cynops', thinkInterval: 0.25, seed: data.seed });
    this.world = world;
    this.kind = 'newt';
    this.label = 'Semender';
    this.data = { name: 'Beni', size: 0.8, adultSize: 1, sex: Math.random() < 0.5 ? 'F' : 'M', shed: Math.random() * 0.6, feedHours: new Array(24).fill(0), ...data };
    delete this.data.seed;
    const d = this.data;
    if (d.needs) Object.assign(this.needs, d.needs);
    else this.needs.energy = 100 - (d.hunger ?? 40);
    delete this.needs.water;
    if (!Number.isFinite(this.needs.stress)) this.needs.stress = 0;
    this.needs.oxygen ??= 100;
    this.needs.moisture ??= 100;
    this.traits = d.traits ?? {
      activity: this.trait(0.5, 0.18), boldness: this.trait(0.45, 0.18), terrestrial: this.trait(0.35, 0.15),
      olfaction: this.trait(0.5, 0.15),
    };
    d.traits = this.traits;
    this.brain = new Brain(NEWT_ACTIONS);
    this.root = new THREE.Group();
    this.pitchGroup = new THREE.Group();
    this.root.add(this.pitchGroup);

    const model = SkeletonUtils.clone(PROTO);
    model.updateMatrixWorld(true);
    const joints = {};
    model.traverse((o) => {
      if (o.isBone) joints[o.name] = new Joint(o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.name === 'Object_7') o.visible = false;      // sahnedeki solucan
        else this.mesh = o;
      }
    });
    this.j = joints;
    model.scale.setScalar(S);
    model.rotation.y = Math.PI / 2;                          // baş (model -x) → yerel +z
    model.position.set(0, FOOT_Y * S, TRUNK_MID * S);
    this.pitchGroup.add(model);
    this.model = model;

    // Islak deri: hafif parlak, ince kabarık doku
    const m = physicalMaterial(this.mesh.material, {
      roughness: 0.48, metalness: 0, clearcoat: 0.24,
      clearcoatRoughness: 0.24, ior: 1.38,
    });
    m.onBeforeCompile = skinShader;
    m.customProgramCacheKey = () => 'newt-skin';
    this.mesh.material = m;

    this.initFeet();
    const p = d.pos ?? [0, 0, 0];
    this.pos = new THREE.Vector3(...p);
    this.heading = d.heading ?? this.rand() * Math.PI * 2;
    this.speed = 0;
    this.vy = 0;
    this.phase = 0;
    this.swimPhase = 0;
    this.swimBlend = world.depthAt(this.pos.x, this.pos.z) > 1.5 ? 1 : 0;
    this.state = 'rest';
    this.aim = new THREE.Vector3();
    this.mv = { to: null, face: null, speed: 0, depth: 'cruise' };
    this.look = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, timer: 1 };
    this.jaw = 0;
    this.strikeT = 0;
    this.swallowT = 0;
    this.breath = this.rand() * 10;
    this.breathRate = 0.8 + this.rand() * 0.35;
    this.strokeTimer = 0;
    this.strokeActive = true;
    this.swimDrive = 1;
    this.pitch = 0;
    this.roll = 0;
    this.bendSmooth = 0;
    this.unkenW = 0;
    this.prey = null;
    this.threat = null;
    this.threatLevel = 0;
    this.odor = null;
    this.restless = 0;            // uzun hareketsizlikten sonra artan gezinme dürtüsü
    this.knownFood = new Set();   // daha önce fark ettiği yiyecekler (yem anını öğrenmek için)
    this.seedMemory();
    this.constrain();
    this.place();
  }

  get inWater() { return this.swimBlend > 0.5; }
  get size() { return LENGTH * this.data.size; }
  get radius() { return 2; }
  get q() { return 2 ** (((this.world.temperature ?? 20) - 20) / 10); }      // Q10 ≈ 2 (ektoterm)

  serialize() {
    const fs = this.recall('feedSpot');
    return { ...this.data, needs: { ...this.needs }, feedSpot: fs ? fs.pos.toArray() : null, pos: this.pos.toArray().map((v) => +v.toFixed(2)), heading: +this.heading.toFixed(3) };
  }

  // Bu terrarumda yaşayan bir hayvan: yuvasını, gölet derinliklerini ve kuytuları bilir
  seedMemory() {
    const w = this.world;
    if (w.hidePos) this.remember('shelter', w.hidePos, 1.2, 4);
    for (const o of w.obstacles) if (o.top) this.remember('shelter', new THREE.Vector3(o.x, 0, o.z), 0.7, 4);
    for (let k = 0; k < 40; k++) {
      const x = -26 + (k % 8) * 5, z = -20 + Math.floor(k / 8) * 8;
      if (w.depthAt(x, z) > 2.5) this.remember('pool', new THREE.Vector3(x, w.waterY - 2, z), 0.6 + w.depthAt(x, z) * 0.1, 5);
    }
    if (this.data.feedSpot) this.remember('feedSpot', new THREE.Vector3(...this.data.feedSpot), 2, 8);
    for (const m of this.mem.places) m.value = Math.min(m.value, 3);
  }

  // ---------------------------------------------------------------- algı
  sense(dt) {
    const w = this.world;
    this.forget(dt, 0.0003);
    const head = this.headPos(_hp);
    // gözler başın üst-yanında: görüş alanı yukarıyı da kapsar (yukarıdan yaklaşan gölge)
    const fwd = _fw.set(Math.sin(this.heading), 0.55, Math.cos(this.heading)).normalize();
    // 1) görme: amfibi gözü hareket eden küçük nesnelere duyarlı; su tanenli → menzil kısa
    senseVision(this, head, fwd, { ...VISION, range: this.inWater ? 12 : 18 });
    // 2) yan çizgi (yalnızca suda) ve karada zemin titreşimi (iç kulak / bacaklar yoluyla)
    senseVibration(this, head, { water: { lambda: 5, gain: 1, thresh: 0.04 }, ground: { lambda: 4, gain: 0.8, thresh: 0.05 } }, { water: this.inWater ? 1 : 0, ground: this.inWater ? 0.2 : 1 });
    // 3) koku: yiyeceğin çevresine yayılan koku alanı; iki burun deliği arasındaki farkla yön
    this.smell(head);
    this.classify(head);
  }

  odorAt(p) {
    let c = 0, src = null, best = 0;
    for (const e of this.eco.entities) {
      if (!e.scent || e.eaten || e.alive === false) continue;
      const wet = e.pos.y < this.world.waterY - 0.1;
      if (wet !== this.inWater) continue;                    // su altı kokusu havaya, hava kokusu suya geçmez
      const age = Math.max(0, this.eco.time - (e.t0 ?? 0));
      const L = wet ? Math.min(25, 1.5 + 3 * Math.sqrt(age / 10)) : 3;    // suda difüzyonla genişler
      const k = e.scent * Math.exp(-p.distanceTo(e.pos) / L) * Math.sqrt(2 / L);
      c += k;
      if (k > best) { best = k; src = e; }
    }
    return [c, src];
  }

  smell(head) {
    const left = _lv.set(Math.cos(this.heading), 0, -Math.sin(this.heading)).multiplyScalar(0.7);
    const [c, src] = this.odorAt(head);
    const thr = 0.04 * (1.5 - this.traits.olfaction);
    if (c < thr || !src) { this.odor = null; return; }
    const [cl] = this.odorAt(_q1.copy(head).add(left));
    const [cr] = this.odorAt(_q1.copy(head).sub(left));
    this.odor = { conc: c, side: (cl - cr) / (cl + cr + 1e-6), src };
    // gözlem paneli için: koku tek başına konum vermez, yalnızca yoğunluk ve yan farkı
    this.perceive(src, 'koku', src.pos, Math.min(0.5, c), { odorOnly: true });
  }

  classify(head) {
    this.prey = null; this.threat = null; this.threatLevel = 0;
    let bp = 0;
    for (const p of this.percepts.values()) {
      const e = p.e;
      p.dist = p.pos.distanceTo(head);
      if (!e) { p.role = 'önemsiz'; p.why = 'kaynağı belirsiz su hareketi'; continue; }
      if (e.kind === 'worm') {
        p.role = 'av';
        // yeni bir yiyeceği ilk fark ettiği an: yem saati ve yeri öğrenilir (koşullanma)
        if (!this.knownFood.has(e.id)) { this.knownFood.add(e.id); if (this.eco.time - (e.t0 ?? 0) < 40) this.learnFeeding(e.pos); }
        // konumu bilmek için görme / yan çizgi ya da çok yakın koku gerekir
        const located = p.senses.has('görme') || p.senses.has('titreşim:water') || (p.info.odorOnly && p.dist < 2.5);
        p.why = located ? 'yerini biliyor' : 'yalnızca kokusu var: yönü kestiriliyor';
        if (!located || e.eaten || e.captured) continue;
        const s = p.conf / (1 + p.dist * 0.05);
        if (s > bp) { bp = s; this.prey = p; }
      } else if (e.kind === 'hand' || e.kind === 'big') {
        p.role = 'tehdit';
        const t = (1 - THREE.MathUtils.smoothstep(p.dist, 3, 14)) * p.conf;
        p.why = 'büyük, hızla yaklaşan nesne';
        if (t > this.threatLevel) { this.threatLevel = t; this.threat = p; }
      } else { p.role = 'önemsiz'; p.why = ''; }
    }
    if (this.threat) this.remember('danger', this.threat.pos, this.threatLevel, 6);
  }

  // ---------------------------------------------------------------- öğrenme: yem saati ve yeri
  learnFeeding(pos) {
    const h = Math.floor((this.world.state.minutes / 60) % 24);
    const H = this.data.feedHours;
    for (let i = 0; i < 24; i++) H[i] *= 0.97;
    H[h] += 1;
    this.remember('feedSpot', pos, 1, 8);
  }
  feedExpectation() {
    const H = this.data.feedHours;
    const tot = H.reduce((a, b) => a + b, 0);
    if (tot < 2) return 0;
    const hr = (this.world.state.minutes / 60) % 24;
    const h = Math.floor(hr), nx = (h + 1) % 24;
    // yem saatinden biraz önce başlayan beklenti
    return Math.min(1, (H[h] * 0.6 + H[nx] * (hr - h)) / (tot * 0.3));
  }

  // ---------------------------------------------------------------- hareket komutları (eylemler kullanır)
  goTo(p, speed, arrive = 1) {
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    this.mv.to = d > arrive ? p : null; this.mv.face = null;
    this.mv.speed = d > arrive ? speed : 0;
    this.mv.depth = this.inWater ? (this.mv.depth === 'bottom' ? 'bottom' : 'cruise') : 'cruise';
    return d;
  }
  halt(depth = 'cruise') { this.mv.to = null; this.mv.face = null; this.mv.speed = 0; this.mv.depth = depth; }
  face(p) { this.mv.to = null; this.mv.face = p; this.mv.speed = 0; }
  angleTo(p) { return wrap(Math.atan2(p.x - this.pos.x, p.z - this.pos.z) - this.heading); }
  randomSpot(water) {
    const w = this.world;
    for (let k = 0; k < 40; k++) {
      const x = (this.rand() - 0.5) * (w.w - 18), z = (this.rand() - 0.5) * (w.d - 16);
      if ((w.depthAt(x, z) > 2) !== water || w.blocked(x, z, 3)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(-11, 0, 11);
  }

  // ---------------------------------------------------------------- yaşam
  metabolism(dt) {
    const N = this.needs, d = this.data, w = this.world;
    const q = this.q, act = 1 + Math.min(2, this.speed * 0.25);
    N.energy = Math.max(0, N.energy - dt * 0.012 * q * act);
    // akciğer: suda azalır (deri solunumu yavaşlatır), sıcakta ve hareketle hızlanır
    if (this.inWater) N.oxygen = Math.max(0, N.oxygen - dt * 0.55 * q * act);
    else N.oxygen = Math.min(100, N.oxygen + dt * 20);
    // deri nemi: karada ortam nemine bağlı kurur, suda hemen ıslanır
    if (this.inWater) N.moisture = Math.min(100, N.moisture + dt * 3);
    else N.moisture = Math.max(0, N.moisture - dt * 0.0012 * (100 - w.humidity) * q * 3);
    N.fatigue = THREE.MathUtils.clamp(N.fatigue + (this.speed > 3 ? dt * 0.8 : -dt * 0.4), 0, 100);
    N.stress = Math.max(0, N.stress + (this.threatLevel * 25 - 2 + (w.temperature > 25 ? 3 : 0)) * dt);
    if (N.energy <= 0 || N.moisture < 10 || N.oxygen <= 0) N.health = Math.max(0, N.health - dt * 0.05);
    else N.health = Math.min(100, N.health + dt * 0.01);
    // deri değiştirme: birkaç günde bir, tok ve sağlıklıyken
    if (!this.sh) d.shed = Math.min(1, d.shed + dt / (1440 * 3.5) * q * (N.energy > 30 ? 1 : 0.3));
    // çok yavaş büyüme (1 sn = 1 oyun dakikası): tokken birkaç oyun haftasında yetişkin boyuna ulaşır
    if (d.size < d.adultSize && N.energy > 40) d.size = Math.min(d.adultSize, d.size + (d.adultSize - d.size) * 0.004 * dt / 60);
    d.hunger = 100 - N.energy;
    const resting = this.brain.current?.id === 'rest';
    this.restless = THREE.MathUtils.clamp(this.restless + (resting ? dt / (w.night ? 50 : 160) : -dt / 25), 0, 1);
  }

  update(dt, lod = 0) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.05);
    this.metabolism(dt);
    this.root.scale.setScalar(this.data.size);
    const prevState = this.state;
    this.state = null;
    this.brain.tick(this, dt);
    this.strokeTimer -= dt;
    if (this.strokeTimer <= 0) {
      this.strokeActive = !this.strokeActive;
      this.strokeTimer = this.strokeActive ? 0.7 + this.rand() * 1.4 : 0.4 + this.rand() * 1.1;
    }
    const drive = this.state === 'strike' || this.state === 'flee' || this.state === 'air' || this.strokeActive ? 1 : 0.12;
    this.swimDrive += (drive - this.swimDrive) * (1 - Math.exp(-dt * 5));
    this.move(dt);
    this.watchdog(dt);
    if (!this.state) {
      if (this.inWater) this.state = this.speed > 0.4 ? 'swim' : this.mv.depth === 'bottom' ? 'rest' : 'swim';
      else this.state = this.speed > 0.12 || Math.abs(this.yawRate) > 0.15 ? 'walk' : 'rest';
    }
    if (this.state !== prevState && this.state === 'strike') this.strikeT = 0;
    if (lod < 2) this.animate(dt);
    this.place();
    if (lod < 2) this.legIK(dt);
  }

  // ---------------------------------------------------------------- Ayaklar (zemine basan IK)
  // Her bacağın doğal duruştaki el/ayak noktası (gövde uzayında), taban köşeleri ve parmak zincirleri
  initFeet() {
    const j = this.j;
    for (const k in j) j[k].reset();
    for (const key in LEGS) {
      const L = LEGS[key];
      const [, upper, lower] = L.bones.map((n) => j[n]);
      upper.rot(UP, -L.side * (L.front ? 0.12 : -0.1));
      upper.rot(LONG, -L.side * SPRAWL);
      lower.rot(LONG, L.side * SPRAWL * 0.6);
    }
    this.root.updateMatrixWorld(true);
    const geo = this.mesh.geometry, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, pos = geo.attributes.position;
    const bones = this.mesh.skeleton.bones;
    this.feet = {};
    for (const key in LEGS) {
      const L = LEGS[key];
      const foot = j[L.bones[3]].bone;
      const set = new Set();
      foot.traverse((b) => { if (b.isBone) set.add(bones.indexOf(b)); });
      // tabana ait köşeler: ağırlığı el/ayak kemiklerinde olan, bağ pozunda en alttaki %35
      const cand = [];
      for (let i = 0; i < pos.count; i++) {
        let best = 0, bi = -1;
        for (let c = 0; c < 4; c++) { const wv = sw.getComponent(i, c); if (wv > best) { best = wv; bi = si.getComponent(i, c); } }
        if (set.has(bi)) cand.push([i, this.mesh.getVertexPosition(i, _sv).applyMatrix4(this.mesh.matrixWorld).y]);
      }
      cand.sort((a, b) => a[1] - b[1]);
      const low = cand.slice(0, Math.max(6, Math.round(cand.length * 0.35)));
      const step = Math.max(1, Math.floor(low.length / 28));
      const sole = low.filter((_, i) => i % step === 0).map((c) => c[0]);
      // doğal duruş: dirsek/diz bükük, el omzun yanında (bacak tam gerilmez, adım için pay kalır)
      j[L.bones[1]].bone.getWorldPosition(_k);
      foot.getWorldPosition(_h);
      const hx = _k.x + (_h.x - _k.x) * 0.72, hz = _k.z + (_h.z - _k.z) * 0.72;
      const fingers = foot.children.filter((b) => b.isBone).map((b) => [b, b.children.find((c) => c.isBone)]);
      this.feet[key] = {
        home: new THREE.Vector3(hx, 0, hz), wristH: _h.y - low[0][1],
        sole, fingers, plant: null, from: new THREE.Vector3(), wasSwing: false, force: -1, contact: 0,
      };
    }
    for (const k in j) j[k].reset();
  }

  // karada kuyruk zemini izler: her omur bir sonrakini yere (kalınlığı kadar yukarıya) indirir; unken'de kalkık kalır
  tailOnGround(lb) {
    const w = this.world, sz = this.data.size, k = lb * (1 - smooth(this.unkenW));
    if (k < 0.02) return;
    this.root.updateMatrixWorld(true);
    const gnd = (x, z) => w.ground(x, z);
    for (let i = 0; i < TAIL.length - 1; i++) {
      const t = i / (TAIL.length - 1);
      this.j[TAIL[i + 1]].bone.getWorldPosition(_tip);
      dropToGround(this.j[TAIL[i]].bone, _tip, gnd, (0.32 - t * 0.24) * sz, 0.45 * k);
    }
  }

  // gövde uzayındaki noktayı dünyaya taşı (yalnız yatay: baş yönü ve boy)
  bodyToWorld(lx, lz, out) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), k = this.data.size;
    return out.set(this.pos.x + (lx * c + lz * s) * k, 0, this.pos.z + (-lx * s + lz * c) * k);
  }

  legIK(dt) {
    const lb = 1 - smooth(THREE.MathUtils.clamp(this.swimBlend, 0, 1));
    if (lb < 0.02) { for (const k in this.feet) this.feet[k].plant = null; return; }
    this.tailOnGround(lb);
    const w = this.world, g = this.gait, sz = this.data.size;
    const gnd = (x, z) => w.ground(x, z);
    this.root.updateMatrixWorld(true);
    const T = Math.min(3, 1 / Math.max(g.f, 1e-3));
    const vx = Math.sin(this.heading) * this.speed, vz = Math.cos(this.heading) * this.speed;
    const yr = this.yawRate ?? 0;
    const predict = (F, tA, out) => {
      this.bodyToWorld(F.home.x, F.home.z, out);
      const a = yr * tA, dx = out.x - this.pos.x, dz = out.z - this.pos.z, c = Math.cos(a), s = Math.sin(a);
      out.x = this.pos.x + dx * c + dz * s + vx * tA;
      out.z = this.pos.z - dx * s + dz * c + vz * tA;
      out.y = gnd(out.x, out.z);
      return out;
    };
    const walking = g.moving > 0.05;
    let stepping = false;
    for (const k in this.feet) if (this.feet[k].force >= 0) stepping = true;
    for (const key in LEGS) {
      const L = LEGS[key], F = this.feet[key];
      const [, upper, lower, foot] = L.bones.map((n) => this.j[n].bone);
      foot.getWorldPosition(_fk);
      if (!F.plant) F.plant = predict(F, 0, new THREE.Vector3());
      const lp = (this.phase + L.off) % 1;
      let swing = walking && lp >= g.duty, u = swing ? (lp - g.duty) / (1 - g.duty) : 0;
      // dururken: gövde kaydıysa (dönüş, itilme) ayağı tek tek yeniden yerleştir
      // ayak gövdeden fazla uzak kaldıysa (itilme, ani dönüş) ya da dururken gövde kaydıysa: hızlı ara adım
      if (F.force >= 0) { F.force = Math.min(1, F.force + dt / 0.22); swing = F.force < 1; u = F.force; if (!swing) F.force = -1; }
      else if (!swing) {
        const off = predict(F, 0, _h).distanceTo(F.plant);
        if ((!walking && !stepping && off > 0.8 * sz) || off > 1.25 * sz) { F.force = 0; stepping = true; swing = true; u = 0; }
      }
      if (swing && !F.wasSwing) F.from.copy(F.plant);
      F.wasSwing = swing;
      if (swing) {
        const tA = walking && F.force < 0 ? (1 - u) * (1 - g.duty) * T + g.duty * T * 0.5 : (1 - u) * 0.22;
        predict(F, tA, F.plant);
        _tg.lerpVectors(F.from, F.plant, smooth(u));
        // taşın kenarına çarpmasın: yol üstündeki en yüksek noktanın üstünden geç
        const clear = Math.max(gnd(_tg.x, _tg.z), F.from.y + (F.plant.y - F.from.y) * smooth(u));
        _tg.y = clear + STEP_LIFT * sz * Math.sin(Math.PI * u);
      } else _tg.copy(F.plant);
      _tg.y += F.wristH * sz;
      _tg.lerpVectors(_fk, _tg, lb);
      const planted = !swing || u < 0.08 || u > 0.92;
      for (let it = 0; it < (planted ? 4 : 1); it++) {
        twoBoneIK(upper, lower, foot, _tg);
        // parmaklar zemine yatar (salınımda gevşek)
        if (planted) for (const [f1, f2] of F.fingers) {
          if (!f2) continue;
          f1.getWorldPosition(_k); f2.getWorldPosition(_tip);
          _tip.sub(_k).multiplyScalar(1.8).add(_k);
          dropToGround(f1, _tip, gnd, 0.04 * sz, 0.7);
          f1.getWorldPosition(_k); f2.getWorldPosition(_tip);
          _tip.multiplyScalar(2).sub(_k);
          dropToGround(f2, _tip, gnd, 0.03 * sz, 0.7);
        }
        if (!planted) break;
        // taban köşelerinin en alçağı tam zemine değsin: boşluk da batma da olmasın
        let m = Infinity;
        for (const i of F.sole) {
          this.mesh.getVertexPosition(i, _sv).applyMatrix4(this.mesh.matrixWorld);
          m = Math.min(m, _sv.y - gnd(_sv.x, _sv.z));
        }
        F.contact = m;
        F.reach = foot.getWorldPosition(_h).distanceTo(_tg);
        if (Math.abs(m) < 0.004 || it === 3) break;
        _tg.y -= m * lb;
      }
    }
  }

  move(dt) {
    const w = this.world, mv = this.mv;
    const depth = w.depthAt(this.pos.x, this.pos.z);
    this.swimBlend += ((depth > 1.6 ? 1 : depth < 0.9 ? 0 : this.swimBlend) - this.swimBlend) * Math.min(1, dt * 2.5);
    const st = this.state;
    const actQ = THREE.MathUtils.clamp(this.q, 0.4, 1.3) * (this.needs.health < 30 ? 0.5 : 1);
    let want = mv.speed * (st === 'strike' ? 1 : actQ);
    if (this.inWater && st !== 'strike') want *= 0.65 + this.swimDrive * 0.35;
    let turnTo = this.heading;
    const goal = mv.to ?? mv.face;
    if (goal) { turnTo = Math.atan2(goal.x - this.pos.x, goal.z - this.pos.z); this.aim.copy(goal); }
    else this.aim.set(this.pos.x + Math.sin(this.heading) * 5, 0, this.pos.z + Math.cos(this.heading) * 5);

    // engellerden ve camdan kaçınma: istenen yön kapalıysa ona en yakın açık yönü seç;
    // seçilen tarafa bir süre bağlı kal (iki yön arasında titreyip kilitlenmesin)
    if (want > 0 && st !== 'strike') {
      const free = (a) => !w.blocked(this.pos.x + Math.sin(a) * 4, this.pos.z + Math.cos(a) * 4, 1) && !w.blocked(this.pos.x + Math.sin(a) * 2, this.pos.z + Math.cos(a) * 2, 1);
      this.detourT = Math.max(0, (this.detourT ?? 0) - dt);
      if (!free(turnTo)) {
        const sgn = this.detourT > 0 ? this.detourSign : (wrap(turnTo - this.heading) >= 0 ? 1 : -1);
        let found = null;
        for (const k of [0.45, 0.9, 1.35, 1.8, 2.4]) {
          if (free(turnTo + sgn * k)) { found = turnTo + sgn * k; this.detourSign = sgn; break; }
          if (this.detourT <= 0 && free(turnTo - sgn * k)) { found = turnTo - sgn * k; this.detourSign = -sgn; break; }
        }
        if (found !== null) { turnTo = found; if (this.detourT <= 0) this.detourT = 1.5; }
      }
    }
    const err = wrap(turnTo - this.heading);
    const turnRate = (this.inWater ? 1.8 : 0.9) * actQ;
    const h0 = this.heading;
    if (goal || want > 0) this.heading += THREE.MathUtils.clamp(err, -turnRate * dt, turnRate * dt);
    // yerinde dönerken de ayaklar adım atar: dönüş hızını yürüme hızına çevir (ayak kayması olmasın)
    this.yawRate = (this.heading - h0) / Math.max(dt, 1e-4);
    if (Math.abs(err) > 1.2 && st !== 'strike') want *= 0.25;   // önce yerinde dön
    this.speed += (want - this.speed) * Math.min(1, dt * (st === 'strike' ? 20 : this.inWater ? 1.5 : 3));

    const oldX = this.pos.x, oldZ = this.pos.z;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.constrain();
    const travelled = (this.pos.x - oldX) * Math.sin(this.heading) + (this.pos.z - oldZ) * Math.cos(this.heading);
    this.speed = Math.min(this.speed, Math.max(0, travelled / Math.max(dt, 1e-4)));

    // yükseklik: karada zemine bas, suda yüz
    const ground = w.ground(this.pos.x, this.pos.z);
    if (this.swimBlend > 0.5) {
      let ty = THREE.MathUtils.clamp(ground + 1.5 + Math.sin(this.swimPhase * 0.13) * 0.6, ground + 0.4, w.waterY - 1.1);
      if (mv.depth === 'surface') ty = w.waterY - 0.55;
      if (mv.depth === 'bottom') ty = ground + 0.05;
      this.vy += ((ty - this.pos.y) * 2 - this.vy) * Math.min(1, dt * 2);
      this.pos.y += this.vy * dt;
      this.pos.y = Math.max(this.pos.y, ground);
    }

    // karada gövde dört ayağın altındaki zemine göre: yükseklik ortalama, eğim ön-arka, yatış sol-sağ
    const F = this.feet, gh = {};
    for (const k in F) { this.bodyToWorld(F[k].home.x, F[k].home.z, _h); gh[k] = w.ground(_h.x, _h.z); }
    const fl = (F.LF.home.z + F.RF.home.z - F.LH.home.z - F.RH.home.z) * 0.5 * this.data.size;
    const wd = (F.LF.home.x + F.LH.home.x - F.RF.home.x - F.RH.home.x) * 0.5 * this.data.size;
    const slope = Math.atan2((gh.LF + gh.RF - gh.LH - gh.RH) * 0.5, fl);
    let tp = this.swimBlend > 0.5 ? THREE.MathUtils.clamp(-this.vy * 0.12, -0.5, 0.5) : -slope;
    if (st === 'air') tp = -0.75;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 6);
    const side = Math.atan2((gh.LF + gh.LH - gh.RF - gh.RH) * 0.5, wd);
    this.roll += ((this.swimBlend > 0.5 ? 0 : side) - this.roll) * Math.min(1, dt * 6);
    if (this.swimBlend <= 0.5) {
      // karın ve kuyruk kökü yere gömülmesin
      let ty = (gh.LF + gh.RF + gh.LH + gh.RH) / 4;
      const sp = Math.sin(this.pitch), k = this.data.size;
      for (const f of [2.2, 1, 0, -1.6, -3.5]) { this.bodyToWorld(0, f, _h); ty = Math.max(ty, w.ground(_h.x, _h.z) + f * k * sp - 0.3 * k); }
      this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 12);
      this.vy = 0;
    }
  }

  // takılma bekçisi: hedefe 15 sn boyunca hiç yaklaşamıyorsa eylemi bırakıp yeniden karar ver
  watchdog(dt) {
    const to = this.mv.to;
    if (!to || this.mv.speed <= 0) { this.wd = null; return; }
    const d = Math.hypot(to.x - this.pos.x, to.z - this.pos.z);
    if (!this.wd || this.wd.to !== to) this.wd = { to, best: d, t: 0 };
    if (d < this.wd.best - 0.5) { this.wd.best = d; this.wd.t = 0; } else this.wd.t += dt;
    if (this.wd.t > 15) {
      this.wd = null;
      const a = this.brain.current;
      if (a) { a.end?.(this, null); this.brain.current = null; this.brain.history.unshift({ t: this.eco.time, id: a.id, why: 'yol bulamadı', end: true }); }
      this.detourT = 0;
      this.brain.decide(this);
    }
  }

  headPos(out) {
    const k = 4.4 * this.data.size;
    return out.set(this.pos.x + Math.sin(this.heading) * k, this.pos.y + 0.6 * this.data.size, this.pos.z + Math.cos(this.heading) * k);
  }

  inspect() {
    const o = super.inspect();
    const d = this.data, N = this.needs;
    o.meta = [
      `${d.sex === 'F' ? 'Dişi' : 'Erkek'} · ${this.size.toFixed(1)} cm${d.size < d.adultSize - 0.01 ? ' (büyüyor)' : ''} · ${this.inWater ? 'suda' : 'karada'} · sıcaklık etkisi ×${this.q.toFixed(2)}`,
      `Deri değişimi %${Math.round(d.shed * 100)} · yem beklentisi %${Math.round(this.feedExpectation() * 100)}${this.odor ? ` · koku ${(this.odor.conc * 100) | 0} (${this.odor.side > 0.02 ? 'solda' : this.odor.side < -0.02 ? 'sağda' : 'önde'})` : ''}`,
      `Kişilik: etkinlik ${(this.traits.activity * 100) | 0} · cesaret ${(this.traits.boldness * 100) | 0} · karaya eğilim ${(this.traits.terrestrial * 100) | 0} · koku duyarlılığı ${(this.traits.olfaction * 100) | 0}`,
    ];
    o.bars = [['Tokluk', N.energy, N.energy < 25], ['Oksijen', N.oxygen, N.oxygen < 20], ['Deri nemi', N.moisture, N.moisture < 35], ['Stres', N.stress, N.stress > 60], ['Sağlık', N.health, N.health < 50]];
    return o;
  }

  // Gövdenin hiçbir noktası cama ya da engellere girmesin: burun, gövde, bacaklar, kuyruk ucu
  constrain() {
    const w = this.world;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const x0 = -w.w / 2 + 0.7, x1 = w.w / 2 - 0.7, z0 = -w.d / 2 + 0.9, z1 = w.d / 2 - 0.7;
    for (let it = 0; it < 3; it++) {
      let px = 0, pz = 0;
      const k = this.data.size;
      for (const [f0, l0, rad0] of BODY) {
        const f = f0 * k, l = l0 * k, rad = rad0 * k;
        const x = this.pos.x + fx * f - fz * l, z = this.pos.z + fz * f + fx * l;
        px += Math.max(0, x0 + rad - x) - Math.max(0, x - (x1 - rad));
        pz += Math.max(0, z0 + rad - z) - Math.max(0, z - (z1 - rad));
        // dik yüzey (mantar tüp, yüksek yosun kenarı): yokuş aşağı it
        if (w.hf?.isSteep(x, z)) { const [gx, gz] = w.hf.grad(x, z), g = Math.hypot(gx, gz) || 1; px -= gx / g * 0.05; pz -= gz / g * 0.05; }
        for (const o of w.obstacles) {
          if (o.top || o.solid) continue;
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + rad;
          if (d < min && d > 1e-4) { px += dx / d * (min - d) * 0.5; pz += dz / d * (min - d) * 0.5; }
        }
      }
      if (!px && !pz) break;
      this.pos.x += px;
      this.pos.z += pz;
    }
  }

  place() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    this.pitchGroup.rotation.set(this.pitch, 0, this.roll);
  }

  // ---------------------------------------------------------------- İskelet
  animate(dt) {
    const j = this.j;
    for (const k in j) j[k].reset();
    const sb = smooth(THREE.MathUtils.clamp(this.swimBlend, 0, 1));
    const lb = 1 - sb;
    const st = this.state;

    // --- yürüme: çapraz bacak çiftleri, gövde duran dalga ile S çizer
    const STRIDE = 1.6 * this.data.size;   // bir döngüde alınan yol (cm); duruşta ayak bunun duty katı kadar geriye süpürülür
    const gait = Math.max(Math.abs(this.speed), Math.abs(this.yawRate ?? 0) * 2.2);
    const f = gait / STRIDE;
    this.phase = (this.phase + f * dt * lb) % 1;
    const moving = THREE.MathUtils.clamp(gait / 1.2, 0, 1) * lb;
    const duty = 0.68, A = 0.8, LIFT = 0.45;
    this.gait = { duty, moving, f };
    const p2 = this.phase * Math.PI * 2;

    // --- yüzme: kuyruktan geriye akan dalga, bacaklar gövdeye yapışık
    const swimF = 0.6 + Math.abs(this.speed) * 0.35 + (st === 'air' ? 0.6 : 0);
    this.swimPhase += swimF * dt * Math.PI * 2 * Math.max(sb, 0.001);
    const swimAmp = sb * (st === 'rest' ? 0.008 : (0.18 + Math.min(this.speed, 5) * 0.09) * this.swimDrive);

    // gövde (omurga) — kara: tek kavis (C) salınımı; su: geriye ilerleyen dalga
    const bend = 0.1 * moving * Math.cos(p2);   // önde olan ön ayağın tarafı dışbükey
    let total = 0;
    const trunkAngles = TRUNK.map((_, i) => {
      if (i === 0) return 0;
      const t = i / (TRUNK.length - 1);
      const a = bend + swimAmp * 0.35 * (0.3 + t * 0.7) * Math.sin(this.swimPhase - t * 1.6);
      total += a;
      return a;
    });
    // gövde dönüşü (yön değiştirirken kıvrılma)
    const turn = THREE.MathUtils.clamp(wrap(Math.atan2(this.aim.x - this.pos.x, this.aim.z - this.pos.z) - this.heading), -1, 1) * (this.speed > 0.2 ? 0.035 : 0.02);
    // unken refleksi: gövde yukarı kavis, baş ve kuyruk kalkar; karın (turuncu) görünür hale gelir
    this.unkenW += ((st === 'unken' ? 1 : 0) - this.unkenW) * Math.min(1, dt * 2.5);
    const uk = smooth(this.unkenW);
    const shedW = st === 'shed' ? 1 : 0;
    this.bendSmooth += (turn - this.bendSmooth) * Math.min(1, dt * 3);
    TRUNK.forEach((n, i) => {
      if (!i) return;
      const t = i / (TRUNK.length - 1);
      j[n].rot(UP, trunkAngles[i] - this.bendSmooth + shedW * 0.09 * Math.sin((this.shedPhase ?? 0) * 2.2 - t * 3));
      if (uk > 0.001) j[n].rot(LAT, UNKEN * uk * 0.07 * Math.sin(Math.PI * t));
    });
    // omuz kuşağı kökte: gövde orta hattı düz kalsın diye yarısını geri çevir
    const rootYaw = -total * 0.5 + this.bendSmooth * 3;
    j[TRUNK[0]].rot(UP, rootYaw);

    // kuyruk: karada sürüklenip hafifçe salınır, suda asıl itici
    TAIL.forEach((n, i) => {
      const t = (i + 1) / TAIL.length;
      const land = moving * 0.06 * Math.sin(p2 - 1.2 - t * 2.2) + 0.003 * Math.sin(this.breath * 0.4 + t * 3) * lb;
      const water = swimAmp * (0.25 + t * 0.9) * Math.sin(this.swimPhase - 1.6 - t * 3.2) * 0.42;
      j[n].rot(UP, land + water - this.bendSmooth * 0.6);
      if (uk > 0.001) { j[n].rot(LAT, UNKEN * uk * (0.03 + t * 0.13)); j[n].rot(UP, uk * 0.08 * t * Math.sin(this.breath * 2.2 - t * 4)); }
    });

    // bacaklar
    for (const key in LEGS) {
      const L = LEGS[key];
      const [girdle, upper, lower, foot] = L.bones.map((n) => j[n]);
      const lp = (this.phase + L.off) % 1;
      let sw, lift = 0;
      if (lp < duty) sw = A * (1 - 2 * lp / duty);
      else { const u = (lp - duty) / (1 - duty); sw = A * (-1 + 2 * smooth(u)); lift = LIFT * Math.sin(Math.PI * u); }
      sw *= moving;
      lift *= moving;
      // ön bacaklar biraz daha öne, arka bacaklar geriye dayanır
      const base = L.front ? 0.12 : -0.1;
      // suda: kollar geriye, gövdeye yatık
      const fold = sb * (L.front ? -1.25 : -1.05);
      const swing = (base + sw) * lb + fold;
      upper.rot(UP, -L.side * swing);
      upper.rot(LONG, -L.side * ((lift + SPRAWL) * lb + sb * 0.35));
      lower.rot(LONG, L.side * SPRAWL * 0.6 * lb);
      // salınımda dirsek/diz kıvrılır, el yerden kalkıp öne uzanır
      lower.rot(LONG, -L.side * lift * 0.6 * lb);
      foot.rot(LAT, (L.front ? 1 : -1) * (lift * 0.5 * lb - sb * 0.6));
      girdle.rot(UP, -L.side * sw * 0.15);
    }

    // baş: gövde salınımını dengeler, çevreye bakar, ava kilitlenir
    this.breath += dt * this.breathRate * (1 + this.needs.stress * 0.006 + Math.min(this.speed, 4) * 0.08);
    const lk = this.look;
    lk.timer -= dt;
    if (lk.timer < 0) {
      lk.timer = st === 'rest' ? 4 + this.rand() * 10 : 1.5 + this.rand() * 4;
      const idle = st === 'rest';
      lk.tyaw = idle ? (this.rand() - 0.5) * 0.6 : (this.rand() - 0.5) * 0.25;
      lk.tpitch = idle ? (this.rand() - 0.4) * 0.16 : 0;
      if (this.sniffing) {
        lk.tyaw = (this.rand() - 0.5) * 0.7 * this.sniffing;
        lk.timer = 1.2 + this.rand() * 2.8;
      }
    }
    const tgt = this.ht?.pos;
    if (tgt && (st === 'stalk' || st === 'strike')) {
      const a = wrap(Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z) - this.heading);
      lk.tyaw = THREE.MathUtils.clamp(a, -0.6, 0.6);
      lk.tpitch = this.inWater ? 0 : 0.2;
    } else if (this.sniffing) {
      // koklarken burun aşağıda, baş yavaşça iki yana
      lk.tpitch = 0.18 * this.sniffing;
    } else if (this.lookUp) { lk.tyaw = 0; lk.tpitch = -0.3; }
    if (st === 'shed') { lk.tyaw = Math.sin((this.shedPhase ?? 0) * 2.6) * 0.35; lk.tpitch = 0.25; }
    // bakış ani değil: semender başını yavaş, kesik kesik çevirir
    lk.yaw += (lk.tyaw - lk.yaw) * Math.min(1, dt * 2.2);
    lk.pitch += (lk.tpitch - lk.pitch) * Math.min(1, dt * 2.2);
    const head = j.Bone019_129;
    head.rot(UP, rootYaw * 0.8 + lk.yaw + Math.sin(this.breath * 13) * 0.3 * (this.headShake ?? 0));
    let strikeDip = 0;
    if (st === 'strike') {
      const s = this.strikeT;
      strikeDip = s < 0.12 ? s / 0.12 : Math.max(0, 1 - (s - 0.12) / 0.3);
    }
    head.rot(LAT, -(lk.pitch + strikeDip * 0.35) + (st === 'air' ? 0.25 : 0) - uk * UNKEN * 0.45);

    // çene: avda açılıp kapanır, yutarken yutkunur, yüzeyde hava yutar; gırtlak pompası sürekli
    let jaw = 0.002 * Math.max(0, Math.sin(this.breath * 4.5));            // bukkal pompalama
    if (st === 'strike') jaw = this.strikeT < 0.1 ? 0.32 * (this.strikeT / 0.1) : Math.max(0, 0.32 - (this.strikeT - 0.1) * 3);
    if (st === 'swallow') jaw = Math.max(0, Math.sin(this.swallowT * 5)) * 0.05;
    if (st === 'shed') jaw = Math.max(0, Math.sin((this.shedPhase ?? 0) * 3.1)) * 0.08;
    if (st === 'air' && this.pos.y > this.world.waterY - 0.8) jaw = Math.max(0, Math.sin(this.breath * 3)) * 0.22;
    this.jaw += (jaw - this.jaw) * Math.min(1, dt * 25);
    j.Bone020_120.rot(LAT, CLOSED_JAW + this.jaw);
  }
}
