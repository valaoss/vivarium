import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { containGroup } from './contain.js';
import { SPECIES } from './species.js';
import { sandHeight } from '../world/substrate.js';
import { patchUnderwater } from '../render/water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Agent } from '../eco/Agent.js';
import { Brain } from '../eco/Brain.js';
import { SlimeTrail } from './slimeTrail.js';

// Gerçek nerit kabuğu taraması (RISD Nature Lab, CC-BY). Yüklenemezse prosedürel kabuk kalır.
let SCAN = null;
export function loadSnailShell() {
  return new Promise((resolve) => {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/creatures/nerite.glb`, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let src = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      geo.computeBoundingBox();
      const b = geo.boundingBox, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      // tabanı y=0, en uzun yatay eksen +Z olacak şekilde hizala; boy 2.2 birim
      geo.translate(-c.x, -b.min.y, -c.z);
      if (size.x > size.z) geo.rotateY(Math.PI / 2);
      const k = 2.2 / Math.max(size.x, size.z);
      geo.scale(k, k, k);
      geo.computeVertexNormals();
      const mat = patchUnderwater(new THREE.MeshPhysicalMaterial({
        map: src.material.map, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3,
      }), {
        key: 'snailshell-scan',
        extra: (sh) => {
          // Neritina natalensis: beyaz bantları zeytin-altın tonuna çevir (zebra nerit)
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
              diffuseColor.rgb = mix(vec3(0.02, 0.018, 0.012), vec3(0.62, 0.48, 0.12), smoothstep(0.08, 0.5, l)); }`);
        },
      });
      SCAN = { geo, mat };
      resolve();
    }, undefined, () => resolve());
  });
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // Nerit kabuğu: basık kubbe, tepeden kenara uzanan zigzag zebra çizgileri
  const shell = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = shell.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    // spiral kubbe: bir yana doğru asimetrik
    v.y *= 0.72;
    v.x *= 1.05;
    v.z += v.y * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
    const ang = Math.atan2(v.z, v.x);
    const rad = Math.hypot(v.x, v.z);
    const zig = Math.sin(ang * 11 + Math.sin(rad * 14) * 1.2);
    const dark = zig > 0.15 ? 1 : 0;
    const c = dark ? [0.05, 0.04, 0.03] : [0.78, 0.62, 0.18];
    col.set(c, i * 3);
  }
  shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shell.computeVertexNormals();
  const shellMat = patchUnderwater(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 }), { key: 'snailshell' });
  // ayak: yassı tabanlı, önü küt, arkası sivrilen oval kas
  const foot = new THREE.SphereGeometry(1, 32, 16);
  {
    const fp = foot.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      let x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
      const back = Math.max(0, -z);
      x *= 0.58 * (1 - back * 0.35);
      y = y < 0 ? y * 0.06 : y * 0.42 * (1 - back * 0.4);
      z *= z > 0 ? 1.15 : 1.35;
      fp.setXYZ(i, x, y, z);
    }
    foot.computeVertexNormals();
  }
  const footMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xa89a86, roughness: 0.5 }), { key: 'snailfoot' });
  const tent = new THREE.CylinderGeometry(0.035, 0.07, 0.8, 8);
  tent.translate(0, 0.4, 0);
  // baş: dokunaçların arasında öne uzanan ağız (snout)
  const snout = new THREE.SphereGeometry(1, 14, 10);
  snout.scale(0.2, 0.13, 0.26);
  SHARED = { shell, shellMat, foot, footMat, tent, snout };
  return SHARED;
}

export const SNAIL_LABEL = {
  crawl: 'Sürünüyor', graze: 'Yosun kazıyor', climb: 'Camda geziyor', rest: 'Dinleniyor', retract: 'Kabuğuna çekilmiş',
  emerge: 'Kabuğundan çıkıyor', track: 'Koku izliyor', eat: 'Yem yiyor',
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = (s, a, b) => a + s.rand() * (b - a);

// ------------------------------------------------------------------ karar repertuvarı
// Ayrıntılar ve kaynaklar: docs/species/shrimp-snail.md
const ACTIONS = [
  {
    id: 'retract', label: 'Kabuğuna çekil', emergency: true,
    score: (s) => (s.alarm > 0.35 ? [Math.min(1, 0.6 + s.alarm * 0.4), s.alarmWhy] : [0, '']),
    start(s) { s.retractT = pick(s, 6, 18) * (0.6 + s.alarm); s.trail?.cut(); },
    tick(s, dt) {
      s.retracted = true; s.state = 'retract'; s.mv.speed = 0;
      s.retractT -= dt;
      s.note = 'Ayağını kabuğa çekti, kapağı (operkulum) kapalı';
      return s.retractT > 0 || s.alarm > 0.35 ? 'run' : 'done';
    },
    lock: (s) => s.retractT > 0,
    end(s) { s.retracted = false; s.emergeT = 3; s.alarm = 0; },
  },
  {
    id: 'eat', label: 'Kokuyu izle / ye',
    score(s) {
      const o = s.odor;
      if (!o || o.item.eaten || s.surface !== 'ground') return [0, ''];
      return [Math.min(0.75, o.conf * (0.3 + s.data.hunger / 100 * 0.6)), 'dokunaçlarıyla yem kokusu aldı'];
    },
    start(s) { s.eatT = 0; },
    tick(s, dt) {
      const o = s.odor;
      if (!o || o.item.eaten) return 'done';
      const f = o.item;
      s.headPos(_v);
      const d = Math.hypot(_v.x - f.pos.x, _v.z - f.pos.z);
      if (d < 0.6) {
        s.mv.speed = 0; s.state = 'eat'; s.eatT += dt;
        s.note = 'Radulasıyla yemi kazıyor';
        s.data.hunger = Math.max(0, s.data.hunger - dt * 0.6);
        if (s.eatT > 20) { f.eaten = true; s.w.events.push({ type: 'eat', fish: s, food: f }); return 'done'; }
        return 'run';
      }
      // dokunaçlarla iki yandan koku karşılaştırması: yavaş klinotaksi
      s.steer = THREE.MathUtils.clamp(o.lr * 3, -0.6, 0.6) + wrap(Math.atan2(f.pos.x - s.pos.x, f.pos.z - s.pos.z) - s.heading) * o.conf * 0.5;
      s.mv.speed = s.sp.cruise; s.state = 'track';
      s.note = 'Dokunaçlarını kokuya doğru uzatıp ilerliyor';
      return 'run';
    },
  },
  {
    id: 'graze', label: 'Yosun kazı',
    score(s) {
      const h = s.data.hunger / 100;
      return [0.32 + h * 0.3, s.surface === 'glass' ? 'camdaki yosun tabakasını kazıyor' : s.hardSurface ? 'taş/kök üstündeki yosunu kazıyor' : 'yüzeyde biyofilm arıyor'];
    },
    start(s) { s.turnT = 0; },
    tick(s, dt) {
      // ilişkili rastgele yürüyüş: yosunlu yerde yavaşlayıp kıvrılır, yosunsuz yerde düz ilerler
      const y = s.yieldHere;
      s.turnT -= dt;
      if (s.turnT < 0) { s.steer = (s.rand() - 0.5) * (0.3 + y * 1.2); s.turnT = pick(s, 2, 6); }
      s.mv.speed = s.sp.cruise * (0.9 - y * 0.5);
      s.state = s.surface === 'glass' ? 'climb' : y > 0.25 ? 'graze' : 'crawl';
      s.data.hunger = Math.max(0, s.data.hunger - dt * 0.02 * y);
      s.note = `Radulayla kazıyor (yosun ${(y * 100) | 0}%)`;
      // camda uzun süre ve yosunu bitmişse inmeye, kumda ön cama yakınsa tırmanmaya karar verir
      if (s.surface === 'glass' && y < 0.08 && s.rand() < dt * 0.05) s.goal = 'ground';
      if (s.surface === 'ground' && s.pos.z > HALF_D - 7 && s.rand() < dt * 0.04) s.goal = 'glass';
      return 'run';
    },
  },
  {
    id: 'rest', label: 'Dinlen',
    score: (s) => [0.12 + (s.fatigue ?? 0) * 0.5, 'hareketsiz bir dönem'],
    start(s) { s.restT = pick(s, 20, 90); },
    tick(s, dt) {
      s.mv.speed = 0; s.state = 'rest'; s.restT -= dt;
      s.fatigue = Math.max(0, (s.fatigue ?? 0) - dt * 0.02);
      s.note = 'Ayağı yapışık, dokunaçlar yarı çekik';
      return s.restT > 0 ? 'run' : 'done';
    },
  },
];

/**
 * Nerit salyangoz: zemin, taş, kök ve ön camın iç yüzünde tabanıyla kayar. Taban dalgaları geriye doğru ilerler,
 * arkasında parlak mukus izi kalır. Titreşim, ani gölge ya da dokunuşta kabuğuna çekilir.
 */
export class Snail extends Agent {
  constructor(data, eco) {
    super(eco, { species: 'snail', seed: (data.seed ?? Math.random() * 100) * 1e6 + (data.id ?? 0) % 1e6, thinkInterval: 0.4 });
    this.kind = 'snail';
    this.data = data;
    this.sp = SPECIES.snail;
    this.label = this.sp.name;
    const s = shared();
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    const shell = SCAN ? new THREE.Mesh(SCAN.geo, SCAN.mat) : new THREE.Mesh(s.shell, s.shellMat);
    shell.position.y = SCAN ? 0.1 : 0.35;
    shell.castShadow = true;
    this.shell = shell;
    this.shellY = shell.position.y;
    // taban: her salyangozun kendi dalga fazı (malzeme kopyası)
    this.footU = { uWave: { value: 0 }, uRetract: { value: 0 } };
    const foot = new THREE.Mesh(s.foot, footMaterial(this.footU));
    foot.position.set(0, 0.06, 0.15);
    foot.scale.set(0.95, 1, 0.95);
    this.foot = foot;
    this.footBase = { pos: foot.position.clone(), scale: foot.scale.clone() };
    // operkulum: kabuğa çekilince ağzı kapatan kapak
    const oper = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshStandardMaterial({ color: 0x2a2116, roughness: 0.7 }));
    oper.position.set(0, 0.25, 0.55);
    oper.rotation.x = -1.2;
    oper.visible = false;
    this.oper = oper;
    const snout = new THREE.Mesh(s.snout, s.footMat);
    snout.position.set(0, 0.16, 1.18);
    this.snout = snout;
    this.body.add(shell, foot, oper, snout);
    this.tents = [];
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(s.tent, s.footMat);
      t.position.set(side * 0.25, 0.3, 1.1);
      t.rotation.set(1.1, 0, side * 0.35);
      this.tents.push(t);
      this.body.add(t);
    }
    this.group.add(this.body);
    this.applySize();

    const p = data.pos ?? [(Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 16];
    this.surface = data.surface === 'glass' ? 'glass' : 'ground';
    this.pos.set(p[0], p[1] ?? 0, p[2]);
    this.heading = this.rand() * Math.PI * 2;
    this.mv = { speed: 0 };
    this.steer = 0;
    this.state = 'crawl';
    this.t = this.rand() * 10;
    this.alarm = 0; this.alarmWhy = '';
    this.retracted = false;
    this.retractK = 0;
    this.emergeT = 0;
    this.yieldHere = 0.3;
    this.fatigue = this.rand() * 0.3;
    this.up = new THREE.Vector3(0, 1, 0);
    this.brain = new Brain(ACTIONS);
    this.u = { uHighlight: { value: 0 } };
  }

  get species() { return 'snail'; }
  get radius() { return this.total * 0.6; }
  get size() { return this.total; }

  applySize() {
    const sc = (this.data.size ?? 1) * 0.85;
    if (this.scale !== undefined && Math.abs(sc - this.scale) < 1e-4) return;
    this.scale = sc;
    this.body.scale.setScalar(sc);
    this.total = 2 * sc;
  }

  headPos(out) { return this.body.localToWorld(out.set(0, 0.2, 1.2)); }

  // ------------------------------------------------------------------ algı
  sense() {
    const w = this.w;
    if (!w) return;
    // kimyasal: dokunaçlarla yem kokusu (yalnızca zeminde; camda yem yok)
    this.odor = null;
    if (this.surface === 'ground' && !this.retracted) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading), sc = this.scale;
      const lx = this.pos.x + (0.4 * c + 1.4 * s) * sc, lz = this.pos.z + (-0.4 * s + 1.4 * c) * sc;
      const rx = this.pos.x + (-0.4 * c + 1.4 * s) * sc, rz = this.pos.z + (0.4 * s + 1.4 * c) * sc;
      let best = null, bc = 0, cl = 0, cr = 0;
      for (const f of w.food) {
        if (f.eaten || f.state !== 'settled') continue;
        const sig = Math.min(14, 0.8 + Math.sqrt(1.2 * Math.min(f.age ?? 30, 400)));
        const amp = 2.5 / sig, k = 1 / (2 * sig * sig);
        const L = amp * Math.exp(-((lx - f.pos.x) ** 2 + (lz - f.pos.z) ** 2) * k);
        const R = amp * Math.exp(-((rx - f.pos.x) ** 2 + (rz - f.pos.z) ** 2) * k);
        cl += L; cr += R;
        if (L + R > bc) { bc = L + R; best = f; }
      }
      const C = (cl + cr) / 2;
      if (best && C > 0.03) {
        this.odor = { item: best, conf: Math.min(1, C * 2), lr: (cl - cr) / Math.max(C, 1e-3) * 0.5 };
        const p = this.perceive(null, 'koku', best.pos, this.odor.conf, { food: true });
        p.role = 'yem'; p.why = 'dokunaçlardaki kimyasal almaçlar';
      }
    }
    // gölge: üstünden yakın geçen büyük balık (göz dokunaç dibinde, yalnız ışık/gölge seçer)
    for (const o of w.fish) {
      if (o.kind !== 'fish' || !o.alive) continue;
      const d = o.pos.distanceTo(this.pos);
      if (d > 4 + o.total * 0.4) continue;
      const sp = o.vel ? o.vel.length() : 0;
      const lvl = (1 - d / (4 + o.total * 0.4)) * Math.min(1, sp / 8) * (o.total / 6) * (1 - w.night * 0.8);
      if (lvl > 0.2) {
        const p = this.perceive(o, 'gölge', o.pos, Math.min(1, lvl), {});
        p.role = 'tehdit'; p.why = `${o.sp.name} hızla üstünden geçti`;
        if (lvl * 0.8 > this.alarm) { this.alarm = Math.min(1, lvl * 0.8); this.alarmWhy = p.why; }
      }
    }
    for (const p of this.percepts.values()) p.dist = p.pos.distanceTo(this.pos);
  }

  scare(from, strength = 1, why = 'titreşim') {
    const d = this.pos.distanceTo(from);
    const lvl = strength * (1 - d / 25);
    if (lvl <= 0.15) return;
    if (lvl > this.alarm) { this.alarm = Math.min(1, lvl); this.alarmWhy = why; }
    this.perceive(null, 'dokunma/titreşim', from, Math.min(1, lvl), {}).role = 'tehdit';
    if (lvl > 0.35) this.brain.decide(this);
  }

  // ------------------------------------------------------------------ hareket
  update(dt, world) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.05);
    this.w = world;
    this.applySize();
    this.t += dt;
    this.alarm = Math.max(0, this.alarm - dt * 0.08);
    this.fatigue = Math.min(1, this.fatigue + dt * 0.002);
    this.thinkAcc = (this.thinkAcc ?? this.rand() * this.thinkInterval) + dt;
    if (this.thinkAcc >= this.thinkInterval) { this.sense(this.thinkAcc); this.decayPercepts(this.thinkAcc); this.brain.decide(this); this.thinkAcc = 0; }
    this.mv.speed = 0;
    this.brain.tick(this, dt);
    // kabuktan çıkış: önce dokunaçlar, sonra ayak; tam çıkmadan yürümez
    this.emergeT = Math.max(0, this.emergeT - dt);
    const out = !this.retracted && this.emergeT <= 0;
    this.retractK += ((this.retracted ? 1 : this.emergeT > 0 ? 0.5 : 0) - this.retractK) * Math.min(1, dt * (this.retracted ? 6 : 0.8));
    if (this.emergeT > 0) { this.state = 'emerge'; this.note = 'Önce dokunaçlarını uzatıp çevreyi yokluyor'; }
    const speed = out ? this.mv.speed * (world.night > 0.5 ? 1.2 : 1) : 0;
    this.speed = speed;

    if (this.trans) this.transition(dt);
    else if (this.surface === 'glass') this.glassMove(dt, speed);
    else this.groundMove(dt, speed);
    this.animate(dt, speed);
  }

  // engel: cam kenarı ya da tırmanamayacağı kadar uzun dikey yüzey (ısıtıcı, filtre)
  wall(x, z) {
    const m = this.total * 0.6 + 0.5;
    if (Math.abs(x) > HALF_W - m || z < -HALF_D + m || z > HALF_D - m) return true;
    const g = this.w.ground, h = g(this.pos.x, this.pos.z);
    return Math.abs(g(x, z) - h) > 2.2 * this.scale;
  }

  groundMove(dt, speed) {
    const w = this.w, g = w.ground, sc = this.scale;
    // hedef yön: ön cama gitme kararı, ya da eylemin dümeni
    if (this.goal === 'glass') {
      const e = wrap(0 - this.heading);
      this.heading += THREE.MathUtils.clamp(e, -dt * 0.35, dt * 0.35);
      if (this.pos.z >= HALF_D - this.total - 0.3 && Math.abs(e) < 0.3) { this.trans = { t: 0, to: 'glass' }; this.trail?.cut(); return; }
    } else this.heading += THREE.MathUtils.clamp(this.steer, -0.5, 0.5) * dt * 0.6;
    const look = this.total * 0.7;
    const fx = this.pos.x + Math.sin(this.heading) * look, fz = this.pos.z + Math.cos(this.heading) * look;
    if (speed > 0 && this.wall(fx, fz) && !(this.goal === 'glass' && fz > HALF_D - this.total)) {
      // dokunaçla dokundu: yön değiştir (dokunaç bir an kısalır)
      this.heading += (this.steer >= 0 ? 1 : -1) * dt * 0.9;
      this.touchT = 0.6;
      speed *= 0.2;
    }
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    const m = this.total * 0.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + m, HALF_W - m);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + m, HALF_D - m);

    // yüzeye uyum: taban (≈2 cm) altındaki zeminden normal ve yükseklik; taban esnek, çukurlara biraz uyar
    if (w.hf) w.hf.normal(this.pos.x, this.pos.z, _n, 0.55 * sc); else _n.set(0, 1, 0);
    this.up.lerp(_n, Math.min(1, dt * 4)).normalize();
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    let y = g(this.pos.x, this.pos.z), hi = y;
    for (const [lx, lz] of [[0, 0.8], [0, -0.7], [0.4, 0], [-0.4, 0]]) {
      const h = g(this.pos.x + (lx * c + lz * s) * sc, this.pos.z + (-lx * s + lz * c) * sc);
      y += h; hi = Math.max(hi, h);
    }
    y = Math.max(y / 5, hi - 0.25 * sc);
    this.pos.y += (y - this.pos.y) * Math.min(1, dt * 5);
    this.hardSurface = y - sandHeight(this.pos.x, this.pos.z) > 0.4;
    this.yieldHere = Math.min(1, (this.hardSurface ? 1 : 0.4) * (0.2 + (w.algae ?? 0.3) * 1.2));
    _f.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _f.addScaledVector(this.up, -_f.dot(this.up)).normalize();
    _r.crossVectors(this.up, _f);
    this.group.position.copy(this.pos);
    this.group.quaternion.setFromRotationMatrix(_m.makeBasis(_r, this.up, _f));
    containGroup(this.group, this.pos, 0.35);
    if (speed > 0) this.trailAdd(this.pos, this.up, _r);
    if (speed > 0) this.data.hunger = Math.max(0, this.data.hunger - dt * 0.012 * this.yieldHere);
  }

  glassMove(dt, speed) {
    const w = this.w;
    if (this.goal === 'ground') {
      const e = wrap(Math.PI - this.heading);
      this.heading += THREE.MathUtils.clamp(e, -dt * 0.35, dt * 0.35);
      const glassY = w.ground(this.pos.x, HALF_D - 1) + 0.5;
      if (this.pos.y <= glassY + 0.05 && Math.abs(e) < 0.3) { this.trans = { t: 0, to: 'ground' }; this.trail?.cut(); return; }
    } else this.heading += THREE.MathUtils.clamp(this.steer, -0.5, 0.5) * dt * 0.6;
    // camda: x yana, y yukarı (heading 0 = yukarı); su yüzeyine ve yan camlara gelince döner
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.y += Math.cos(this.heading) * speed * dt;
    if (this.pos.y > TANK.water - 1.6 || this.pos.x < -HALF_W + 2 || this.pos.x > HALF_W - 2) this.heading += Math.PI * dt * 0.5;
    this.pos.z = HALF_D - 0.25;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + this.radius, HALF_W - this.radius);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, w.ground(this.pos.x, HALF_D - 1) + 0.5, TANK.water - 1.5);
    const gy = w.glassAlgae ? w.glassAlgae(this.pos.x, this.pos.y) : 0.3;
    this.yieldHere = Math.min(1, gy * 1.5);
    if (speed > 0 && w.cleanGlass) {
      const cleaned = w.cleanGlass(this.pos.x, this.pos.y, dt * (this.state === 'climb' ? 0.35 : 0.2));
      if (cleaned > 0.002) {
        this.data.hunger = Math.max(0, this.data.hunger - cleaned * 20);
        if (!this.reported) { this.reported = true; w.events.push({ type: 'snailGlass', fish: this }); }
      }
    }
    this.up.set(0, 0, -1);
    _f.set(Math.sin(this.heading), Math.cos(this.heading), 0);
    _r.crossVectors(this.up, _f);
    this.group.position.copy(this.pos);
    this.group.quaternion.setFromRotationMatrix(_m.makeBasis(_r, this.up, _f));
    containGroup(this.group, this.pos, 0.35);
    if (speed > 0) this.trailAdd(_v.copy(this.pos).setZ(HALF_D - 0.03), this.up, _r);
  }

  // zemin (yatay, cama bakar) ile cam (dikey, yukarı bakar) duruşları arasında ~5 sn'lik yumuşak geçiş:
  // salyangoz ayağının önünü cama yapıştırıp gövdesini yavaşça yukarı çeker
  transition(dt) {
    const tr = this.trans, w = this.w;
    tr.t = Math.min(1, tr.t + dt / 5);
    const x = this.pos.x, R = this.total * 0.6;
    const sandP = _v.set(x, w.ground(x, HALF_D - R), HALF_D - R);
    const glassP = _w.set(x, w.ground(x, HALF_D - 1) + 0.5, HALF_D - 0.25);
    const qSand = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tr.to === 'glass' ? 0 : Math.PI, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, tr.to === 'glass' ? 1 : -1, 0), up = new THREE.Vector3(0, 0, -1);
    const qGlass = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(new THREE.Vector3().crossVectors(up, fwd), up, fwd));
    const k = tr.t * tr.t * (3 - 2 * tr.t);
    const a = tr.to === 'glass' ? k : 1 - k;
    this.pos.lerpVectors(sandP, glassP, a);
    this.group.position.copy(this.pos);
    this.group.quaternion.slerpQuaternions(qSand, qGlass, a);
    this.speed = this.sp.cruise * 0.5;
    if (tr.t >= 1) {
      this.surface = tr.to;
      this.heading = tr.to === 'glass' ? 0 : Math.PI;
      this.trans = null;
      this.goal = null;
      this.up.set(...(tr.to === 'glass' ? [0, 0, -1] : [0, 1, 0]));
    }
  }

  trailAdd(p, n, side) {
    if (!this.trail && this.group.parent) this.trail = new SlimeTrail(this.group.parent, { width: 0.9 * this.scale });
    this.trail?.add(p, n, side, this.eco.time, 0.9 * this.scale);
  }

  animate(dt, speed) {
    const k = this.retractK;
    // taban dalgası: geriye ilerleyen (retrograd) iki sıralı dalgalar, hızla orantılı
    this.footU.uWave.value += dt * speed * 2.2;
    this.footU.uRetract.value = k;
    // kabuğa çekilme: ayak kabuğun içine, kabuk zemine iner, operkulum ağzı kapar
    const fs = 1 - k * 0.75;
    this.foot.scale.set(this.footBase.scale.x * fs, this.footBase.scale.y * fs, this.footBase.scale.z * (1 - k * 0.85));
    this.foot.position.set(0, this.footBase.pos.y * (1 - k * 0.5), this.footBase.pos.z * (1 - k) + k * 0.15);
    // hareket ederken taban hafifçe uzar-kısalır (kas dalgası)
    this.foot.scale.z *= 1 + Math.sin(this.footU.uWave.value * 2.5) * 0.02 * (speed > 0 ? 1 : 0);
    this.shell.position.y = this.shellY - k * 0.12;
    this.oper.visible = k > 0.85;
    this.snout.scale.setScalar(Math.max(0.01, 1 - k));
    this.snout.rotation.x = this.state === 'eat' || this.state === 'graze' || this.state === 'climb' ? Math.sin(this.t * 5) * 0.15 : 0;
    this.touchT = Math.max(0, (this.touchT ?? 0) - dt);
    const ext = (1 - Math.max(k, this.state === 'rest' ? 0.5 : 0)) * (this.touchT > 0 ? 0.4 : 1) * (this.emergeT > 0 ? 1 - this.emergeT / 3 * 0.6 : 1);
    this.tents.forEach((t, i) => {
      t.scale.y += (Math.max(0.05, ext) - t.scale.y) * Math.min(1, dt * (ext < t.scale.y ? 10 : 1.5));
      t.visible = t.scale.y > 0.08;
      // dokunaçlar yürürken öne ve yana doğru tarar
      t.rotation.y = Math.sin(this.t * 0.8 + i * 2) * 0.3 + (this.steer ?? 0) * 0.4;
      t.rotation.x = 1.1 + Math.sin(this.t * 0.6 + i) * 0.12;
    });
    this.trail?.update(this.eco.time);
  }

  inspect() {
    const o = super.inspect();
    const d = this.data;
    o.meta = [
      `${this.total.toFixed(1)} cm · ${this.surface === 'glass' ? 'ön camda' : this.hardSurface ? 'taş/kök üstünde' : 'zeminde'} · ${(this.speed * 10).toFixed(1)} mm/s`,
      `yüzey yosunu %${Math.round(this.yieldHere * 100)}${this.retracted ? ' · kabuğunda' : ''}`,
    ];
    o.bars = [['Tokluk', 100 - d.hunger, d.hunger > 70], ['Stres', d.stress, d.stress > 60], ['Sağlık', d.health, d.health < 50], ['Tedirginlik', this.alarm * 100, this.alarm > 0.35]];
    return o;
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    this.data.surface = this.trans ? this.trans.to : this.surface;
    return this.data;
  }
  dispose() { this.trail?.dispose(); }
}

// Taban: alttan (camdan) bakınca geriye akan koyu-açık bantlar; sağ ve sol yarı aynı anda (Nerita tipi)
const FOOT_MATS = [];
function footMaterial(u) {
  const m = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x8c8478, roughness: 0.45 }), {
    key: 'snailfoot-wave',
    uniforms: u,
    extra: (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFP; uniform float uWave; uniform float uRetract;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float sole = smoothstep(0.01, -0.03, vFP.y);
            float lat = smoothstep(0.03, 0.12, abs(vFP.x)) * (1.0 - smoothstep(0.42, 0.56, abs(vFP.x)));
            float band = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(vFP.z * 7.0 + uWave * 6.2831));
            diffuseColor.rgb *= 1.0 - sole * lat * band * 0.5 * (1.0 - uRetract);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.05, 1.0), sole * (1.0 - lat));
          }`);
    },
  });
  FOOT_MATS.push(m);
  return m;
}
