import * as THREE from 'three';
import { TANK, HALF_W, HALF_D, GAME_MIN_PER_SEC } from '../config.js';
import { containGroup } from './contain.js';
import { SPECIES } from './species.js';
import { sandHeight } from '../world/substrate.js';
import { patchUnderwater } from '../render/water.js';
import { Agent } from '../eco/Agent.js';
import { Brain } from '../eco/Brain.js';
import { FootPlanter } from '../eco/legs.js';
import { twoBoneIK } from '../eco/ik.js';
import { FISH_PROFILES } from './fishBrain.js';

/*
 * Caridea anatomisi (yerel +Z ileri, +Y sırt): dikenli rostrum, yanlardan
 * basık kabuk (karapaks), birbirine geçen 6 karın halkası ve kuyruk yelpazesi
 * (telson + 4 uropod). 5 çift eklemli yürüme bacağı (ilk ikisi tüylü uçlu,
 * yem toplayan kıskaçlar), karın altında 5 çift yüzme bacağı, sapın ucunda
 * gözler, uzun antenler ve çatallı antenciklerle.
 */

const SEG = [
  { L: 0.24, rx: 0.19, ry: 0.29, rest: 0.1, pl: 1.3 },
  { L: 0.25, rx: 0.185, ry: 0.3, rest: 0.08, pl: 1.35 },
  { L: 0.27, rx: 0.175, ry: 0.28, rest: -0.45, pl: 1.3 },
  { L: 0.22, rx: 0.145, ry: 0.22, rest: -0.25, pl: 1.15 },
  { L: 0.2, rx: 0.115, ry: 0.17, rest: -0.15, pl: 1.1 },
  { L: 0.3, rx: 0.08, ry: 0.12, rest: -0.05, pl: 1.05 },
];
// yürüme bacakları: z konumu, öne açı, uyluk/baldır boyu
const LEGS = [
  { z: 1.0, fwd: 1.0, a: 0.2, b: 0.2, chela: true },
  { z: 0.86, fwd: 0.75, a: 0.22, b: 0.24, chela: true },
  { z: 0.7, fwd: 0.2, a: 0.3, b: 0.36 },
  { z: 0.54, fwd: -0.15, a: 0.31, b: 0.37 },
  { z: 0.38, fwd: -0.5, a: 0.32, b: 0.38 },
];
const LEG_Y = -0.27;
// gövde eğimi için zemin örnek noktaları (gövde yereli, ölçek 1): bacak alanı + baş + karın
const SUPPORT = [[-0.45, 0.2], [0.45, 0.2], [-0.45, 0.8], [0.45, 0.8], [0, 1.3], [0, -0.2], [-0.3, 0.5], [0.3, 0.5], [0, 0.5]];

/** Kesiti yanlardan basık, alt yanları (pleura) aşağı sarkan tüp */
function loft(L, rx, ry, prof, rings = 10, radial = 14, pleura = 1.12) {
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, k = prof(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const x = rx * k * s * (c < 0 ? 0.78 + 0.22 * (1 + c) : 1);
      const y = c > 0 ? ry * k * c : ry * k * pleura * c;
      pos.push(x, y, -t * L);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flatBlade(len, w, tip = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.5, 0);
  s.quadraticCurveTo(-w * 0.62, -len * 0.6, -w * tip * 0.5, -len);
  s.quadraticCurveTo(0, -len * 1.06, w * tip * 0.5, -len);
  s.quadraticCurveTo(w * 0.62, -len * 0.6, w * 0.5, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(-Math.PI / 2); // XZ düzlemi, -Z geriye
  g.scale(1, 1, -1);
  return g;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const carapace = loft(1.05, 0.19, 0.3, (t) => (t < 0.22 ? 0.4 + 0.6 * Math.pow(t / 0.22, 0.6) : 1 - 0.07 * (t - 0.22)), 14, 18, 1.15);
  const segs = SEG.map((s, i) => loft(s.L + 0.04, s.rx, s.ry, (t) => (i === 5 ? 1 - 0.3 * t : 0.9 + 0.1 * Math.min(1, t / 0.6) - 0.03 * Math.max(0, t - 0.8) / 0.2), 6, 14, s.pl));
  const rostrum = new THREE.ConeGeometry(0.04, 0.48, 6);
  rostrum.rotateX(Math.PI / 2);
  rostrum.scale(0.45, 1, 1);
  const telson = flatBlade(0.36, 0.12, 0.3);
  const uropod = flatBlade(0.38, 0.13, 0.5);
  const legA = new THREE.CylinderGeometry(0.016, 0.013, 1, 5);
  legA.translate(0, -0.5, 0);
  const legB = new THREE.CylinderGeometry(0.012, 0.005, 1, 5);
  legB.translate(0, -0.5, 0);
  const tuft = new THREE.ConeGeometry(0.045, 0.07, 6, 1, true);
  tuft.translate(0, -0.035, 0);
  const pleopod = flatBlade(0.2, 0.06, 0.6);
  const antLong = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, 0.1, 0.4), new THREE.Vector3(0.25, 0.2, 0.72),
    new THREE.Vector3(0.48, 0.16, 0.6), new THREE.Vector3(0.68, 0.04, -0.3), new THREE.Vector3(0.85, -0.08, -1.7),
  ]), 28, 0.011, 4);
  const antShort = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.1, 0.22), new THREE.Vector3(0.1, 0.2, 0.42),
  ]), 8, 0.012, 4);
  const stalk = new THREE.CylinderGeometry(0.035, 0.04, 0.11, 6);
  stalk.rotateX(Math.PI / 2);
  const eyeGeo = new THREE.SphereGeometry(0.068, 10, 8);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x060606, clearcoat: 1, roughness: 0.15 });
  SHARED = { carapace, segs, rostrum, telson, uropod, legA, legB, tuft, pleopod, antLong, antShort, stalk, eyeGeo, eyeMat };
  return SHARED;
}

// Kromatofor deseni: cherry'de koyu kırmızı benekler, amano'da yan sıra noktalar ve açık sırt çizgisi
const SHRIMP_FRAG = /* glsl */ `
  {
    float n = shN(vSP * 9.0) * 0.6 + shN(vSP * 23.0) * 0.4;
    if (uAmano < 0.5) {
      float chrom = smoothstep(0.45, 0.85, n);
      diffuseColor.rgb *= mix(1.15, 0.5, chrom);
      diffuseColor.a = mix(diffuseColor.a, 1.0, chrom * 0.4);
    } else {
      vec2 q = vec2(vSP.z * 14.0, vSP.y * 9.0);
      float row = abs(fract(q.y) - 0.5);
      float dash = step(0.5, shH(vec3(floor(q.x), floor(q.y), 1.0))) * smoothstep(0.32, 0.2, length(vec2((fract(q.x) - 0.5) * 0.75, row * 1.4)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.16, 0.1), dash * 0.85);
      diffuseColor.a = mix(diffuseColor.a, 0.95, dash);
      float dorsal = smoothstep(0.03, 0.012, abs(vSP.x)) * step(0.0, vSP.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.78), dorsal * 0.8);
      diffuseColor.a = mix(diffuseColor.a, 0.9, dorsal);
    }
  }
`;

const MATS = {};
function materialsFor(sp) {
  const amano = sp.color ? 1 : 0;
  const key = amano ? 'amano' : 'cherry';
  if (MATS[key]) return MATS[key];
  const col = new THREE.Color(sp.color ?? 0xb3141a);
  const make = (opts, k) => patchUnderwater(new THREE.MeshPhysicalMaterial({
    color: col, transparent: true, side: THREE.DoubleSide, depthWrite: true,
    roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, ...opts,
  }), {
    key: k,
    uniforms: { uAmano: { value: amano } },
    extra: (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSP; uniform float uAmano;
          float shH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float shN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(shH(i), shH(i + vec3(1,0,0)), f.x), mix(shH(i + vec3(0,1,0)), shH(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(shH(i + vec3(0,0,1)), shH(i + vec3(1,0,1)), f.x), mix(shH(i + vec3(0,1,1)), shH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SHRIMP_FRAG);
    },
  });
  const mat = make({ opacity: amano ? 0.5 : 0.9 }, 'shrimp-body-' + key);
  const legMat = make({ opacity: amano ? 0.4 : 0.7, clearcoat: 0.2 }, 'shrimp-leg-' + key);
  MATS[key] = { mat, legMat };
  return MATS[key];
}

export const SHRIMP_LABEL = {
  walk: 'Yürüyor', pick: 'Yüzeyi didikliyor', eat: 'Yem yiyor', track: 'Koku izliyor', swim: 'Yüzüyor',
  flee: 'Kuyruk çırpıp kaçıyor', hide: 'Saklanıyor', rest: 'Dinleniyor', molt: 'Kabuk değiştiriyor',
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _pole = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = (s, a, b) => a + s.rand() * (b - a);

// Exuvia: eski kabuk yerde kalır, yavaşça solar (karidesler sonra kemirip mineralini geri alır)
const EXUVIAE = [];
const exuviaMat = new THREE.MeshPhysicalMaterial({ color: 0xe8dccb, transparent: true, opacity: 0.35, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false });

// ------------------------------------------------------------------ karar repertuvarı
// Ayrıntılar ve kaynaklar: docs/species/shrimp-snail.md
const ACTIONS = [
  {
    id: 'flee', label: 'Kuyruk çırpıp kaç', emergency: true,
    score: (s) => (s.alarm > 0.55 && !s.molting ? [Math.min(1, 0.6 + s.alarm * 0.4), s.alarmWhy] : [0, '']),
    start(s) { s.tailFlip(); s.flips = 0; },
    tick(s) {
      s.state = 'flee';
      // tehdit sürüyorsa ikinci, üçüncü kuyruk vuruşu
      if (s.flip <= 0 && s.alarm > 0.7 && s.flips < 2) { s.tailFlip(); s.flips++; }
      return s.flip > 0 || s.mode === 'swim' ? 'run' : 'done';
    },
    lock: (s) => s.flip > 0,
    end(s) { s.alarm *= 0.5; },
  },
  {
    id: 'molt', label: 'Kabuk değiştir', inertia: 5,
    score: (s) => (s.data.molt >= 1 && s.atShelter ? [0.9, 'kabuk değişimi zamanı geldi, sığınakta'] : [0, '']),
    start(s) { s.moltT = 0; s.molting = true; },
    tick(s, dt) {
      s.moltT += dt; s.state = 'molt'; s.mv.to = null;
      s.note = s.moltT < 2.5 ? 'Karnını kasıp kabuğun arkasını açıyor' : 'Eski kabuktan geriye doğru sıyrılıyor';
      if (s.moltT > 4) { s.leaveExuvia(); return 'done'; }
      return 'run';
    },
    lock: () => true,
    end(s) { s.molting = false; s.data.molt = 0; s.soft = 90; },
  },
  {
    id: 'hide', label: 'Saklan',
    score(s) {
      const st = s.data.stress / 100, pre = s.data.molt > 0.92 ? 0.55 : 0, soft = s.soft > 0 ? 0.6 : 0;
      const v = Math.min(0.85, st * 0.55 + s.threatLvl * 0.7 + pre + soft);
      const why = soft ? 'yeni kabuk henüz yumuşak' : pre ? 'kabuk değişimi yaklaşıyor' : s.threatLvl > 0.2 ? 'yakında avcı balık var' : 'stresli';
      return [v, why];
    },
    start(s) { s.shelter = s.findShelter(); s.hideT = pick(s, 15, 40); },
    tick(s, dt) {
      if (!s.shelter) return 'fail';
      const d = Math.hypot(s.pos.x - s.shelter.x, s.pos.z - s.shelter.z);
      s.atShelter = d < 1.2;
      if (!s.atShelter) { s.go(s.shelter, 1.3); s.state = 'walk'; s.note = 'Taşın / kökün dibine gidiyor'; return 'run'; }
      s.mv.to = null; s.state = 'hide';
      s.picking = s.rand() < 0.5;
      s.remember('shelter', s.shelter, 1, 3);
      s.hideT -= dt;
      s.note = 'Kuytuda bekliyor, antenleri dışarıda';
      return s.hideT > 0 || s.soft > 0 ? 'run' : 'done';
    },
    end(s) { s.atShelter = false; },
  },
  {
    id: 'track', label: 'Kokuyu izle',
    score(s) {
      const o = s.odor;
      if (!o || o.item.eaten) return [0, ''];
      return [Math.min(0.8, o.conf * (0.35 + (s.data.hunger / 100) * 0.7)), 'antenciklerle yem kokusu aldı'];
    },
    start(s) { s.eatT = 0; },
    tick(s, dt) {
      const o = s.odor;
      if (!o || o.item.eaten) return 'done';
      const f = o.item;
      s.headPos(_v);
      const d = Math.hypot(_v.x - f.pos.x, _v.z - f.pos.z);
      if (d < 0.5 * s.scale + 0.25) {
        // kıskaçlarla yemi didikleyip ağza götürür
        s.mv.to = null; s.state = 'eat'; s.picking = true; s.pickAt = f.pos;
        s.eatT += dt;
        s.note = 'Kıskaçlarıyla yemi parçalayıp ağzına götürüyor';
        s.data.hunger = Math.max(0, s.data.hunger - dt * 1.2);
        if (s.eatT > 6) { f.eaten = true; s.w.events.push({ type: 'eat', fish: s, food: f }); s.remember('food', f.pos, 1, 6); return 'done'; }
        return 'run';
      }
      // klinotaksi: sol/sağ antencik farkına göre dön, kokuya doğru yürü
      const turn = THREE.MathUtils.clamp(o.lr * 6, -0.9, 0.9);
      _w.set(s.pos.x + Math.sin(s.heading + turn) * 3, 0, s.pos.z + Math.cos(s.heading + turn) * 3);
      const fd = Math.hypot(f.pos.x - s.pos.x, f.pos.z - s.pos.z);
      if (o.conf > 0.6 && fd < 6) {
        // yakında: gövdeyi, başı (ağız) yemin üstüne gelecek noktaya götür
        const k = Math.max(0, fd - 1.35 * s.scale) / Math.max(fd, 1e-3);
        _w.set(s.pos.x + (f.pos.x - s.pos.x) * k, 0, s.pos.z + (f.pos.z - s.pos.z) * k);
        if (fd < 1.35 * s.scale + 0.3) _w.set(s.pos.x + (f.pos.x - s.pos.x) * 0.05, 0, s.pos.z + (f.pos.z - s.pos.z) * 0.05);
      }
      s.go(_w, fd < 3 ? 0.8 : 1.6);
      s.state = 'track';
      s.note = `Koku ${o.lr > 0.02 ? 'solda daha güçlü' : o.lr < -0.02 ? 'sağda daha güçlü' : 'önde'}; antencikleri sık sık çırpıyor`;
      return 'run';
    },
    end(s) { s.pickAt = null; },
  },
  {
    id: 'graze', label: 'Yüzey didikle',
    score(s) {
      const h = s.data.hunger / 100;
      return [0.3 + h * 0.25 + (s.w.night > 0.5 ? 0.05 : 0), s.surfaceYield > 0.6 ? 'taş/kök üstünde zengin biyofilm' : 'kum ve yüzeyden biyofilm topluyor'];
    },
    start(s) { s.patch = s.choosePatch(); s.patchT = pick(s, 6, 16); },
    tick(s, dt) {
      if (!s.patch) return 'fail';
      const d = Math.hypot(s.pos.x - s.patch.x, s.pos.z - s.patch.z);
      if (d > 0.8) { s.go(s.patch, 0.7); s.state = 'walk'; s.note = 'Yeni bir yüzeye yürüyor'; return 'run'; }
      s.mv.to = null; s.state = 'pick'; s.picking = true;
      s.patchT -= dt;
      const y = s.surfaceYield;
      s.data.hunger = Math.max(0, s.data.hunger - dt * 0.03 * y);
      s.note = `Kıskaçlarla yüzeyi tarıyor (verim ${(y * 100) | 0}%)`;
      if (s.patchT < 0) {
        s.remember('graze', s.pos, y, 4);
        s.patch = s.choosePatch(); s.patchT = pick(s, 6, 16);
      }
      return 'run';
    },
  },
  {
    id: 'swim', label: 'Yüz',
    score(s) {
      const fr = s.frenzy;
      return [0.05 + fr * 0.55 + (s.w.night > 0.5 ? -0.03 : 0.03) * s.restless, fr > 0.2 ? 'suya yem düştü: yüzerek arıyor' : 'yer değiştirmek için yüzüyor'];
    },
    start(s) {
      const a = s.rand() * 6.28, r = pick(s, 6, 16);
      const x = THREE.MathUtils.clamp(s.pos.x + Math.sin(a) * r, -HALF_W + 2, HALF_W - 2);
      const z = THREE.MathUtils.clamp(s.pos.z + Math.cos(a) * r, -HALF_D + 2, HALF_D - 2);
      s.swimTo = new THREE.Vector3(x, s.w.ground(x, z) + pick(s, 3, 9), z);
      s.swimT = 0;
    },
    tick(s, dt) {
      s.swimT += dt;
      s.state = 'swim';
      if (s.swimT < 4 && s.pos.distanceTo(s.swimTo) > 1.5) { s.mv.to = s.swimTo; s.mv.swim = true; s.mv.speed = s.sp.cruise * 2.4; s.note = 'Yüzme bacaklarıyla kürek çekiyor'; return 'run'; }
      s.mv.swim = false; s.mv.to = null; s.note = 'Bacaklarını açıp süzülerek iniyor';
      return s.mode === 'swim' ? 'run' : 'done';
    },
    end(s) { s.mv.swim = false; s.frenzy *= 0.3; },
  },
  {
    id: 'rest', label: 'Dinlen',
    score: (s) => [0.12 + (s.w.night > 0.5 ? 0.12 : 0) + (s.soft > 0 ? 0.2 : 0), s.w.night > 0.5 ? 'gece: daha az hareket' : 'kısa mola'],
    start(s) { s.restT = pick(s, 6, 20); },
    tick(s, dt) {
      s.mv.to = null; s.state = 'rest'; s.restT -= dt;
      s.picking = s.rand() < 0.02 ? !s.picking : s.picking;
      s.note = 'Yerinde duruyor, yüzme bacaklarıyla su çeviriyor';
      return s.restT > 0 ? 'run' : 'done';
    },
  },
];

export class Shrimp extends Agent {
  constructor(data, eco) {
    super(eco, { species: data.species, seed: (data.seed ?? Math.random() * 100) * 1e6 + (data.id ?? 0) % 1e6, thinkInterval: 0.25 });
    this.kind = 'shrimp';
    this.data = data;
    this.sp = SPECIES[data.species] ?? SPECIES.shrimp;
    this.label = this.sp.name;
    data.molt ??= Math.random();
    const s = shared();
    const m = materialsFor(this.sp);
    this.group = new THREE.Group();
    const mesh = (g, mat, parent) => { const o = new THREE.Mesh(g, mat); o.castShadow = true; parent.add(o); return o; };

    // gövde: kabuk + karın halkaları zinciri (her halka kendi ekleminde döner)
    const head = new THREE.Group();
    head.position.z = 1.2;
    this.group.add(head);
    this.head = head;
    mesh(s.carapace, m.mat, head);
    const ros = mesh(s.rostrum, m.mat, head);
    ros.position.set(0, 0.1, 0.2);
    ros.rotation.x = -0.12;
    this.segs = [];
    let parent = new THREE.Group();
    parent.position.set(0, 0.0, 1.2 - 1.05 + 0.04);
    this.group.add(parent);
    SEG.forEach((d, i) => {
      const joint = i === 0 ? parent : new THREE.Group();
      if (i > 0) { joint.position.z = -SEG[i - 1].L; parent.add(joint); }
      mesh(s.segs[i], m.mat, joint);
      if (i < 5) for (const side of [-1, 1]) {
        const pl = mesh(s.pleopod, m.legMat, joint);
        pl.position.set(side * d.rx * 0.45, -d.ry * 0.95, -d.L * 0.45);
        pl.userData = { i, side };
        (this.pleo ??= []).push(pl);
      }
      this.segs.push(joint);
      parent = joint;
    });
    const fan = new THREE.Group();
    fan.position.z = -SEG[5].L;
    parent.add(fan);
    mesh(s.telson, m.mat, fan);
    this.uropods = [];
    for (const side of [-1, 1]) for (const k of [0, 1]) {
      const u = mesh(s.uropod, m.mat, fan);
      u.position.set(side * 0.03, -0.01 - k * 0.012, 0.02);
      u.userData = { side, k };
      this.uropods.push(u);
    }

    // yürüme bacakları: kalça → uyluk → diz → baldır → uç
    this.legs = [];
    LEGS.forEach((d, i) => {
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.rotation.order = 'YZX';
        hip.position.set(side * 0.1, LEG_Y, d.z);
        this.group.add(hip);
        const fem = mesh(s.legA, m.legMat, hip);
        fem.scale.y = d.a;
        const knee = new THREE.Group();
        knee.position.y = -d.a;
        hip.add(knee);
        const tib = mesh(s.legB, m.legMat, knee);
        tib.scale.y = d.b;
        if (d.chela) {
          const tf = mesh(s.tuft, m.legMat, knee);
          tf.position.y = -d.b;
        }
        const tip = new THREE.Object3D();
        tip.position.y = -d.b;
        knee.add(tip);
        this.legs.push({ hip, knee, tip, side, i, d });
      }
    });

    this.ants = [];
    this.antennules = [];
    for (const side of [-1, 1]) {
      const st = mesh(s.stalk, m.mat, head);
      st.position.set(side * 0.1, 0.07, 0.03);
      st.rotation.y = side * 0.5;
      const e = new THREE.Mesh(s.eyeGeo, s.eyeMat);
      e.position.set(side * 0.15, 0.08, 0.08);
      head.add(e);
      const a = mesh(s.antLong, m.legMat, head);
      a.position.set(side * 0.06, -0.06, 0.02);
      a.scale.x = side;
      a.castShadow = false;
      this.ants.push(a);
      for (const k of [0, 1]) {
        const b = mesh(s.antShort, m.legMat, head);
        b.position.set(side * 0.04, 0.02, 0.1);
        b.scale.x = side * (k ? 1.6 : 0.7);
        b.castShadow = false;
        this.antennules.push(b);
      }
    }

    this.initFeet();
    this.applySize();

    const p = data.pos ?? [(Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 20];
    this.pos.set(p[0], p[1] ?? 0, p[2]);
    this.heading = this.rand() * Math.PI * 2;
    this.vel = new THREE.Vector3();
    this.mode = 'swim';                 // ilk karede zemine süzülerek iner
    this.mv = { to: null, speed: 0, swim: false };
    this.speed = 0;
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.state = 'pick';
    this.t = this.rand() * 10;
    this.flip = 0;
    this.flee = 0;
    this.alarm = 0; this.alarmWhy = '';
    this.threatLvl = 0;
    this.frenzy = 0;
    this.soft = 0;
    this.restless = this.trait(0.5, 0.25);
    this.surfaceYield = 0.5;
    this.flick = 0;
    this.picking = false;
    this.brain = new Brain(ACTIONS);
    this.u = { uHighlight: { value: 0 } };
    this.body = { feet: this.planter.feet };
  }

  get species() { return this.data.species; }
  get radius() { return this.total * 0.6; }
  get size() { return this.total; }

  // Nötr yürüme duruşunda bacak uçlarından ayak "ev" noktaları ve gövde yüksekliği
  initFeet() {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
    for (const L of this.legs) this.legPose(L, L.d.fwd, 0.95, 0.8);
    this.group.updateMatrixWorld(true);
    const homes = [];
    let ty = 0, n = 0;
    for (const L of this.legs) {
      L.tip.getWorldPosition(_v);
      L.hip.getWorldPosition(_w);
      if (L.d.chela) continue;
      // kalçaya göre biraz içeri: bacak tam gerilmez, dizler bükük kalır
      homes.push({ L, home: new THREE.Vector3(_w.x + (_v.x - _w.x) * 1.3, 0, _w.z + (_v.z - _w.z) * 1.05) });
      ty += _v.y; n++;
    }
    // gövde alçakta: bacaklar yana açılır, dizler gövdenin üstüne kalkar (yayvan eklembacaklı duruşu)
    this.standLocal = -ty / n * 0.62;
    // metakronal dalga: her yanda arkadan öne, karşı taraf yarım faz geride
    this.walkLegs = homes.map((h) => h.L);
    this.planter = new FootPlanter(homes.map(({ L, home }) => ({ home, offset: ((4 - L.i) / 3 + (L.side > 0 ? 0.5 : 0)) % 1 })), {
      duty: 0.65, lift: 0.12, stride: 0.55, reset: 0.32, quick: 0.14,
      // ayak, gövdenin altındaki zeminden bacak boyunun ötesinde yüksek/alçak ya da dik bir yere basmaz
      valid: (x, z, y) => {
        const base = this.pos.y - this.standLocal * this.scale;
        return y - base < 0.45 * this.scale && base - y < 0.6 * this.scale && !(this.w?.hf && Math.hypot(...this.w.hf.grad(x, z)) > 3.5);
      },
    });
  }

  legPose(L, yaw, splay, bend) {
    L.hip.rotation.set(0, -L.side * yaw, L.side * splay);
    L.knee.rotation.set(0, 0, -L.side * bend);
  }

  headPos(out) { return this.head.localToWorld(out.set(0, -0.15, 0.25)); }

  // ------------------------------------------------------------------ algı
  sense() {
    const w = this.w;
    if (!w) return;
    const sc = this.scale;
    // koku: yere çökmüş / batan yem, yaşı ilerledikçe yayılan bulut (difüzyon) — iki antencik ucu ayrı ölçer
    const hd = this.heading, c = Math.cos(hd), s = Math.sin(hd);
    const lx = this.pos.x + (0.5 * c + 1.9 * s) * sc, lz = this.pos.z + (-0.5 * s + 1.9 * c) * sc;
    const rx = this.pos.x + (-0.5 * c + 1.9 * s) * sc, rz = this.pos.z + (0.5 * s + 1.9 * c) * sc;
    const D = 0.7 * (1 + (w.flow ?? 0.25));
    let best = null, bc = 0, cl = 0, cr = 0;
    for (const f of w.food) {
      if (f.eaten || f.state === 'float') continue;
      if (f.pos.y - w.ground(f.pos.x, f.pos.z) > 4) continue;
      const sig = Math.min(18, 0.8 + Math.sqrt(2 * D * Math.min(f.age ?? 30, 400)));
      const amp = 3 / sig;
      const k = 1 / (2 * sig * sig);
      const L = amp * Math.exp(-((lx - f.pos.x) ** 2 + (lz - f.pos.z) ** 2) * k);
      const R = amp * Math.exp(-((rx - f.pos.x) ** 2 + (rz - f.pos.z) ** 2) * k);
      cl += L; cr += R;
      if (L + R > bc) { bc = L + R; best = f; }
    }
    const C = (cl + cr) / 2;
    if (best && C > 0.02) {
      const conf = Math.min(1, C * 2.5);
      this.odor = { item: best, conf, lr: (cl - cr) / Math.max(C, 1e-3) * 0.5 };
      const p = this.perceive(null, 'koku', best.pos, conf, { food: true });
      p.role = 'yem'; p.why = 'antenciklerdeki koku almaçları';
      this.flick = Math.min(1, this.flick + 0.4);
    } else this.odor = null;

    // avcı balıklar: bileşik gözlerle büyük hareketli gölge, yakında suyun kıpırdaması (setalar)
    this.threatLvl *= 0.8;
    for (const o of w.fish) {
      if (o === this || o.kind !== 'fish' || !o.alive) continue;
      const d = o.pos.distanceTo(this.pos);
      if (d > 12) continue;
      const pred = FISH_PROFILES[o.species]?.predator?.prey.includes(this.species) ? 1 : 0;
      const big = o.total > this.total * 2.5 ? 0.3 : 0;
      if (!pred && !big) continue;
      _v.subVectors(this.pos, o.pos);
      const approach = o.vel ? Math.max(0, o.vel.dot(_v) / Math.max(d, 0.1)) : 0;
      let lvl = (pred || big) * (1 - d / 12) * (0.35 + Math.min(1, approach / 6) * 0.65);
      if (o.prey === this) lvl = Math.max(lvl, 1 - d / 14);
      const sense = d < 3 ? 'su akıntısı' : 'görme';
      const p = this.perceive(o, sense, o.pos, Math.min(1, lvl + 0.2), {});
      p.role = 'tehdit'; p.why = o.prey === this ? `${o.sp.name} ona saldırıyor` : pred ? `${o.sp.name}: avcı` : `${o.sp.name}: iri balık`;
      if (lvl > this.threatLvl) this.threatLvl = lvl;
      if (lvl > this.alarm) { this.alarm = lvl; this.alarmWhy = p.why; }
      if (lvl > 0.3) this.remember('danger', o.pos, lvl, 6);
    }
    for (const p of this.percepts.values()) p.dist = p.pos.distanceTo(this.pos);
    this.surfaceYield = this.surfaceAt(this.pos.x, this.pos.z);
  }

  // sığınak: taş, kök, ekipman ve bitki diplerinden yakın olanı (tehlike hafızasından uzak)
  findShelter() {
    let best = null, bs = Infinity;
    const danger = this.recall('danger');
    for (const o of this.w.obstacles) {
      const r = o.core ?? o.r;
      if (!r || r > 12) continue;
      const a = Math.atan2(this.pos.x - o.pos.x, this.pos.z - o.pos.z);
      const x = o.pos.x + Math.sin(a) * (r + 0.4), z = o.pos.z + Math.cos(a) * (r + 0.4);
      if (this.blocked(x, z)) continue;
      let sc = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (danger) sc += Math.max(0, 8 - Math.hypot(x - danger.pos.x, z - danger.pos.z)) * 2;
      if (sc < bs) { bs = sc; best = new THREE.Vector3(x, 0, z); }
    }
    return best;
  }

  // yüzey verimi: taş ve kök üstünde biyofilm kumdan zengindir; yosun miktarıyla artar
  surfaceAt(x, z) {
    const hard = this.w.ground(x, z) - sandHeight(x, z) > 0.4 ? 1 : 0.45;
    return Math.min(1, hard * (0.35 + (this.w.algae ?? 0.3) * 1.3));
  }

  choosePatch() {
    let best = null, bs = -1;
    const m = this.recall('graze');
    for (let k = 0; k < 7; k++) {
      const a = this.rand() * 6.28, r = pick(this, 1.5, 7);
      const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
      if (this.blocked(x, z)) continue;
      let sc = this.surfaceAt(x, z) - r * 0.02 + this.rand() * 0.15;
      if (m && Math.hypot(x - m.pos.x, z - m.pos.z) < 3) sc += 0.1 * m.value;
      if (sc > bs) { bs = sc; best = new THREE.Vector3(x, 0, z); }
    }
    return best;
  }

  // engel: cam ya da bacağın aşamayacağı basamak (taş kenarı, kök). Çakıl ve kum dalgaları engel değildir.
  // from verilirse oradan x,z'ye adımlık yükseklik farkına bakar; yoksa noktanın çevresindeki keskin kenara
  blocked(x, z, from) {
    const m = 1 + this.total * 0.3;
    if (Math.abs(x) > HALF_W - m || Math.abs(z) > HALF_D - m) return true;
    const g = this.w.ground, h = g(x, z), lim = 0.55 * this.scale;
    if (from) return Math.abs(h - g(from.x, from.z)) > Math.max(lim, 0.6 * Math.hypot(x - from.x, z - from.z));
    const r = 0.5 * this.scale;
    return Math.max(Math.abs(g(x + r, z) - h), Math.abs(g(x - r, z) - h), Math.abs(g(x, z + r) - h), Math.abs(g(x, z - r) - h)) > lim * 1.6;
  }

  go(to, speedMul = 1) {
    this.mv.to = to;
    this.mv.swim = false;
    this.mv.speed = this.sp.cruise * speedMul * (this.soft > 0 ? 0.6 : 1);
  }

  hopOver(to) {
    let top = 0;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      top = Math.max(top, this.w.ground(this.pos.x + (to.x - this.pos.x) * t, this.pos.z + (to.z - this.pos.z) * t));
    }
    // ısıtıcı, filtre gibi uzun dikey engellerin üstünden aşmaz: hedefi bırakır, başka yer seçer
    if (top - this.w.ground(this.pos.x, this.pos.z) > 5 || top - this.w.ground(to.x, to.z) > 5) {
      this.patch = null; this.shelter = null; this.mv.to = null;
      return;
    }
    this.hop = { to: new THREE.Vector3(to.x, Math.min(TANK.water - 1, top + 1.5 + this.standLocal * this.scale), to.z), t: 0 };
    this.mode = 'swim';
    this.planter.release();
    this.vel.set(0, 1.5, 0);
  }

  tailFlip() {
    this.flip = 0.3;
    this.flee = 0.6;
    this.mode = 'swim';
    this.planter.release();
    _v.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    // karın bir anda kıvrılır: geriye ve hafif yukarı fırlar
    this.vel.copy(_v).multiplyScalar(-this.sp.burst * (0.8 + this.rand() * 0.4));
    this.vel.y += this.sp.burst * 0.3;
    this.vel.x += (this.rand() - 0.5) * 3; this.vel.z += (this.rand() - 0.5) * 3;
    this.data.stress = Math.min(100, this.data.stress + 4);
  }

  scare(from, strength = 1, why = 'su titreşimi') {
    const d = this.pos.distanceTo(from);
    const lvl = strength * (1 - d / 22);
    if (lvl <= 0.1) return;
    if (lvl > this.alarm) { this.alarm = Math.min(1, lvl * 1.1); this.alarmWhy = why; }
    this.perceive(null, 'titreşim', from, Math.min(1, lvl), {}).role = 'tehdit';
    if (lvl > 0.55) this.brain.decide(this);
  }

  leaveExuvia() {
    const g = new THREE.Group();
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (!o.isMesh || o.material === shared().eyeMat) return;
      const c = new THREE.Mesh(o.geometry, exuviaMat);
      c.matrixAutoUpdate = false;
      c.matrix.copy(o.matrixWorld);
      g.add(c);
    });
    this.group.parent?.add(g);
    EXUVIAE.push({ g, life: 900 });
    this.w.events.push({ type: 'molt', fish: this });
  }

  // ------------------------------------------------------------------ döngü
  update(dt, world) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.05);
    this.w = world;
    this.applySize();
    this.t += dt;
    const d = this.data;
    d.molt = Math.min(1.05, d.molt + dt * GAME_MIN_PER_SEC / (1440 * (8 + 4 * (d.size ?? 1))));
    this.soft = Math.max(0, this.soft - dt);
    this.alarm = Math.max(0, this.alarm - dt * 0.3);
    this.flee = Math.max(0, this.flee - dt);
    this.flick = Math.max(0, this.flick - dt * 0.8);
    // suya yem düşünce titreşim: yem arayışında karidesler sık sık yüzer
    for (const v of this.eco.vib) if (v.kind === 'food' && this.eco.time - v.t < 0.1) this.frenzy = Math.min(1, this.frenzy + 0.35);
    this.frenzy = Math.max(0, this.frenzy - dt * 0.03);

    this.thinkAcc = (this.thinkAcc ?? this.rand() * this.thinkInterval) + dt;
    if (this.thinkAcc >= this.thinkInterval) { this.sense(this.thinkAcc); this.decayPercepts(this.thinkAcc); this.brain.decide(this); this.thinkAcc = 0; }
    this.picking = false;
    this.brain.tick(this, dt);
    if (this.mode === 'swim') this.swimMove(dt); else this.walkMove(dt);
    this.animate(dt);
    for (let i = EXUVIAE.length - 1; i >= 0; i--) {
      const e = EXUVIAE[i];
      e.life -= dt / Math.max(1, (world.counts?.shrimp ?? 0) + (world.counts?.amano ?? 0));
      if (e.life < 0) { e.g.parent?.remove(e.g); EXUVIAE.splice(i, 1); }
    }
  }

  walkMove(dt) {
    const w = this.w, g = w.ground, mv = this.mv;
    if (mv.swim && mv.to) { this.mode = 'swim'; this.planter.release(); this.vel.set(0, 1.5, 0); return; }
    let want = 0, turn = 0;
    if (mv.to) {
      const dx = mv.to.x - this.pos.x, dz = mv.to.z - this.pos.z;
      const L = Math.hypot(dx, dz);
      if (L > 0.3) {
        let h = Math.atan2(dx, dz);
        // engel: önü dik taş yüzeyi ya da cam ise boş yön ara
        const look = 0.5 + this.total * 0.25;
        if (this.blocked(this.pos.x + Math.sin(h) * look, this.pos.z + Math.cos(h) * look, this.pos)) {
          let free = false;
          for (const o of [0.5, -0.5, 1, -1, 1.6]) {
            const hh = h + o * (this.detour ?? 1);
            if (!this.blocked(this.pos.x + Math.sin(hh) * look, this.pos.z + Math.cos(hh) * look, this.pos)) { h = hh; free = true; break; }
          }
          // yürüyerek geçilemeyen taş/kök: kısa bir yüzüşle üstünden aşar
          if (!free && L > 2) { this.hopOver(mv.to); return; }
        } else if (this.rand() < dt * 0.2) this.detour = this.rand() < 0.5 ? -1 : 1;
        const e = wrap(h - this.heading);
        turn = THREE.MathUtils.clamp(e, -2.4 * dt, 2.4 * dt);
        want = mv.speed * Math.max(0, Math.cos(e)) * Math.min(1, L / 1.5 + 0.3);
      } else if (L > 0.02) {
        // son milimetreler: yerinde dönüp hedefe yüzünü çevir
        turn = THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - this.heading), -2 * dt, 2 * dt);
      }
    }
    // takıldı (dar köşe, dönüp duruyor): üstünden yüzerek geç
    this.stuckT = want > 0.1 && this.speed < 0.08 ? (this.stuckT ?? 0) + dt : 0;
    if (this.stuckT > 3 && mv.to) { this.stuckT = 0; this.hopOver(mv.to); return; }
    this.heading += turn;
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, turn / dt, 0.3);
    this.speed += (want - this.speed) * Math.min(1, dt * 4);
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt, nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    if (!this.blocked(nx, nz, this.pos)) { this.pos.x = nx; this.pos.z = nz; } else this.speed = 0;
    this.vel.set(Math.sin(this.heading) * this.speed, 0, Math.cos(this.heading) * this.speed);

    // gövde: dört köşedeki zemine göre yükseklik, öne/yana eğim
    // gövde düzlemi: bacak alanındaki zemine en küçük kareler düzlemi; çakıl üstünde gövde dengede kalır, bacaklar uzanır
    const sc = this.scale, c = Math.cos(this.heading), s = Math.sin(this.heading);
    let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxh = 0, szh = 0;
    for (const [lx, lz] of SUPPORT) {
      const h = g(this.pos.x + (lx * c + lz * s) * sc, this.pos.z + (-lx * s + lz * c) * sc);
      n++; sx += lx; sz += lz; sh += h; sxx += lx * lx; szz += lz * lz; sxh += lx * h; szh += lz * h;
    }
    const mx = sx / n, mz = sz / n, mh = sh / n;
    const bx = (sxh / n - mx * mh) / Math.max(1e-4, sxx / n - mx * mx), bz = (szh / n - mz * mh) / Math.max(1e-4, szz / n - mz * mz);
    const pt = THREE.MathUtils.clamp(-Math.atan(bz / sc), -0.6, 0.6), rl = THREE.MathUtils.clamp(Math.atan(bx / sc), -0.4, 0.4);
    this.pitch += (pt - this.pitch) * Math.min(1, dt * 6);
    this.roll += (rl - this.roll) * Math.min(1, dt * 6);
    let y = mh - bz * mz + this.standLocal * sc;
    // menzil: hiçbir bacak %95 uzunluğundan fazla gerilmesin; karın da zemine gömülmesin
    this.place();
    for (const [k, f] of this.planter.feet.entries()) {
      if (!f.init) continue;
      const L = this.walkLegs[k];
      L.hip.getWorldPosition(_v);
      const len = (L.d.a + L.d.b) * sc * 0.95;
      const hz = Math.hypot(_v.x - f.pos.x, _v.z - f.pos.z);
      const maxDy = Math.sqrt(Math.max(0, len * len - hz * hz));
      y = Math.min(y, f.pos.y + maxDy + (this.pos.y - _v.y));
    }
    y = Math.max(y, g(this.pos.x, this.pos.z) + 0.3 * sc);
    this.pos.y += (y - this.pos.y) * Math.min(1, dt * 10);
    // gövde hiçbir durumda zemine gömülmez (basamak çıkarken yumuşatma geride kalsa da)
    this.pos.y = Math.max(this.pos.y, g(this.pos.x, this.pos.z) + 0.25 * sc);
    this.place();
    this.planter.update(dt, { pos: this.pos, heading: this.heading, scale: sc }, this.vel, this.yawRate, g);
  }

  swimMove(dt) {
    const w = this.w, mv = this.mv;
    if (this.hop) {
      this.hop.t += dt;
      if (this.hop.t > 5 || Math.hypot(this.hop.to.x - this.pos.x, this.hop.to.z - this.pos.z) < 0.8 || this.flip > 0) this.hop = null;
    }
    const goal = this.hop?.to ?? (mv.swim ? mv.to : null);
    const prop = !!goal && this.flip <= 0;
    if (prop) {
      _v.subVectors(goal, this.pos);
      const L = _v.length();
      _v.multiplyScalar((this.hop ? this.sp.cruise * 2.2 : mv.speed) / Math.max(L, 0.01));
      // engelin üstünden geçerken önce yüksel
      if (this.hop && this.pos.y < goal.y - 0.5) _v.y = Math.max(_v.y, this.sp.cruise * 1.5);
      this.vel.lerp(_v, Math.min(1, dt * 2.5));
      const e = wrap(Math.atan2(this.vel.x, this.vel.z) - this.heading);
      this.heading += THREE.MathUtils.clamp(e, -3 * dt, 3 * dt);
    } else {
      // süzülme: hafif negatif yüzerlik, su direnci
      this.vel.multiplyScalar(Math.exp(-dt * (this.flip > 0 ? 0.6 : 2.2)));
      this.vel.y -= dt * 2.2;
      this.vel.y = Math.max(this.vel.y, -2.4);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 1, HALF_W - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 1, HALF_D - 1);
    this.pos.y = Math.min(this.pos.y, TANK.water - 0.6);
    const floor = w.ground(this.pos.x, this.pos.z) + this.standLocal * this.scale;
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      if (!prop && this.flip <= 0) { this.mode = 'ground'; this.vel.set(0, 0, 0); this.speed = 0; }
      else this.vel.y = Math.max(0, this.vel.y);
    }
    this.yawRate = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.pitch += (THREE.MathUtils.clamp(-this.vel.y * 0.08, -0.5, 0.5) - this.pitch) * Math.min(1, dt * 4);
    this.roll *= Math.exp(-dt * 3);
    this.place();
  }

  place() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
    containGroup(this.group, this.pos);
    this.group.updateMatrixWorld(true);
  }

  animate(dt) {
    const t = this.t;
    const swim = this.mode === 'swim';
    const prop = swim && (this.mv.swim || !!this.hop);
    const curl = this.flip > 0 ? Math.sin((1 - this.flip / 0.3) * Math.PI) : 0;
    this.flip = Math.max(0, this.flip - dt);
    const breathe = Math.sin(t * 1.7) * 0.015;
    const molt = this.state === 'molt' ? Math.sin(t * 9) * 0.25 * Math.min(1, this.moltT) : 0;

    // karın: dinlenme kavsi, yüzerken hafif dalga, kaçışta sert kıvrılma
    this.segs.forEach((j, i) => {
      const wave = prop ? Math.sin(t * 9 - i * 0.7) * 0.05 : 0;
      j.rotation.x = SEG[i].rest + breathe + wave - curl * (i < 2 ? 0.25 : 0.6) - molt * (i < 3 ? 1 : 0.3);
    });
    const spread = swim || curl > 0 ? 1 : 0.35;
    for (const u of this.uropods) {
      const { side, k } = u.userData;
      u.rotation.y = side * (0.18 + k * 0.28) * (0.6 + spread * 0.7);
      u.rotation.z = side * 0.1;
    }
    // yüzme bacakları: metakronal dalga; dururken de yavaşça su çevirir
    const pw = prop ? 18 : this.speed > 0.2 ? 4 : 2.2, pa = prop ? 0.65 : 0.22;
    for (const pl of this.pleo) {
      const { i, side } = pl.userData;
      pl.rotation.x = -0.9 - Math.sin(t * pw - i * 0.85) * pa;
      pl.rotation.z = side * 0.15;
    }

    const grounded = this.mode === 'ground';
    for (const L of this.legs) {
      if (!grounded || curl > 0) this.legPose(L, L.d.fwd * 0.3 - 0.6, swim && !prop && this.vel.y < 0 ? 0.85 : 0.5, 1.2);
      else this.legPose(L, L.d.fwd, L.d.chela ? 0.6 : 0.95, L.d.chela ? 0.9 : 0.8);
    }
    this.group.updateMatrixWorld(true);
    if (grounded && curl <= 0) {
      // yürüme bacakları: ayak uçları zemindeki kilitli noktalara
      this.planter.feet.forEach((f, k) => {
        const L = this.walkLegs[k];
        _pole.set(0, 1, 0);
        for (let it = 0; it < 2; it++) twoBoneIK(L.hip, L.knee, L.tip, _a.copy(f.pos).setY(f.pos.y + 0.01), _pole);
        // uzanamadığı (gövde yükseldi / döndü) basan ayak yeniden yerleşir
        if (f.planted && L.tip.getWorldPosition(_b).distanceTo(_a) > 0.1 * this.scale) this.planter.step(f);
      });
      // kıskaçlı bacaklar: sırayla zemini (ya da yemi) tarar ve ağza götürür
      if (this.picking) {
        const g = this.w.ground;
        for (const L of this.legs) {
          if (!L.d.chela) continue;
          const ph = t * (this.state === 'eat' ? 3.2 : 2.4) * Math.PI * 2 / 2 + (L.side > 0 ? Math.PI : 0) + L.i * 1.3;
          const p = 0.5 + 0.5 * Math.sin(ph);
          if (this.pickAt) _a.copy(this.pickAt);
          else this.group.localToWorld(_a.set(L.side * (0.16 + 0.05 * Math.sin(ph * 0.37)), 0, 1.45 + 0.12 * Math.sin(ph * 0.21 + L.i)));
          _a.y = g(_a.x, _a.z) + 0.01;
          this.head.localToWorld(_b.set(L.side * 0.04, -0.2, 0.05));
          _a.lerp(_b, p * p);
          twoBoneIK(L.hip, L.knee, L.tip, _a, _pole.set(0, 1, 0));
        }
      }
    }
    // antenler sürekli tarar; antencikler koku alınca sık çırpılır (koku örneklemesi)
    this.ants.forEach((a, k) => {
      a.rotation.y = Math.sin(t * 1.1 + k * 2.1) * 0.22 * (k ? 1 : -1);
      a.rotation.x = Math.sin(t * 0.8 + k) * 0.12 + (swim ? 0.25 : 0);
    });
    const rate = 2.3 + this.flick * 9;
    this.antennules.forEach((b, k) => {
      const flick = Math.pow(Math.max(0, Math.sin(t * rate + k * 1.7)), 12);
      b.rotation.x = -flick * 0.5;
    });
  }

  applySize() {
    const scale = (this.data.size ?? 1) * (this.sp.size ?? 1) * 0.95;
    if (this.scale !== undefined && Math.abs(scale - this.scale) < 1e-4) return;
    this.scale = scale;
    this.group.scale.setScalar(scale);
    this.total = 2.7 * scale;
  }

  inspect() {
    const o = super.inspect();
    const d = this.data;
    o.meta = [
      `${(this.total).toFixed(1)} cm · ${d.trait ?? ''} · ${this.mode === 'swim' ? 'suda' : `${this.planter.feet.filter((f) => f.planted).length}/6 bacak yerde`}`,
      `kabuk değişimine %${Math.round(Math.min(1, d.molt) * 100)}${this.soft > 0 ? ' · yeni kabuk yumuşak' : ''} · yüzey verimi %${Math.round(this.surfaceYield * 100)}`,
    ];
    o.bars = [['Tokluk', 100 - d.hunger, d.hunger > 70], ['Stres', d.stress, d.stress > 60], ['Sağlık', d.health, d.health < 50], ['Tedirginlik', this.alarm * 100, this.alarm > 0.5]];
    return o;
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    return this.data;
  }
  dispose() {}
}
